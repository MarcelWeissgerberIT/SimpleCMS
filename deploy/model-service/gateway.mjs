/** Atlas Flow inference gateway. No model management, URL fetching or tool execution. */
import http from 'node:http'
import {readFileSync} from 'node:fs'
import {createHash,randomUUID} from 'node:crypto'
import {once} from 'node:events'
import {pathToFileURL} from 'node:url'

const MODEL='atlas-flow:latest', BODY_MAX=256*1024
const loopback=ip=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ip)
const fault=(status,code,message)=>Object.assign(new Error(message),{status,code})
export const keyHash=key=>createHash('sha256').update(key).digest('hex')

/** One global FIFO for the API and both ONE workspace hosts. Pending callers can cancel. */
export class Queue {
  constructor(max=12,perKey=2){this.max=max;this.perKey=perKey;this.active=false;this.waiting=[];this.counts=new Map()}
  enter(key,signal){
    signal.throwIfAborted()
    if([...this.counts.values()].reduce((a,b)=>a+b,0)>=this.max||(this.counts.get(key)??0)>=this.perKey)throw fault(429,'queue_full','Inference queue is full; retry later.')
    this.counts.set(key,(this.counts.get(key)??0)+1)
    return new Promise((resolve,reject)=>{
      const item={key,resolve,reject,signal,abort:null}
      item.abort=()=>{const i=this.waiting.indexOf(item);if(i>=0){this.waiting.splice(i,1);this.drop(key);reject(signal.reason)}}
      signal.addEventListener('abort',item.abort,{once:true});this.waiting.push(item);this.next()
    })
  }
  drop(key){const n=(this.counts.get(key)??1)-1;if(n)this.counts.set(key,n);else this.counts.delete(key)}
  next(){
    if(this.active)return
    const item=this.waiting.shift();if(!item)return
    item.signal.removeEventListener('abort',item.abort)
    if(item.signal.aborted){this.drop(item.key);item.reject(item.signal.reason);this.next();return}
    this.active=true;let released=false
    item.resolve(()=>{if(released)return;released=true;this.active=false;this.drop(item.key);this.next()})
  }
}

async function jsonBody(req){
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))throw fault(415,'content_type','Use application/json.')
  if(Number(req.headers['content-length'])>BODY_MAX)throw fault(413,'body_too_large','Request exceeds 256 KiB.')
  const chunks=[];let size=0
  for await(const b of req){size+=b.length;if(size>BODY_MAX)throw fault(413,'body_too_large','Request exceeds 256 KiB.');chunks.push(b)}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw fault(400,'invalid_json','Invalid JSON request.')}
}
const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v)
function chat(raw,native){
  const allowed=native?['model','messages','tools','format','stream','keep_alive','options']:['model','messages','tools','tool_choice','stream','stream_options','max_tokens','max_completion_tokens','temperature','top_p','response_format','seed','stop','frequency_penalty','presence_penalty','user']
  if(!object(raw)||Object.keys(raw).some(k=>!allowed.includes(k)))throw fault(400,'invalid_request','Unsupported request field.')
  if(![MODEL,'atlas-flow'].includes(raw.model))throw fault(400,'model_not_allowed','Only atlas-flow:latest is served.')
  if(raw.stream!==undefined&&typeof raw.stream!=='boolean')throw fault(400,'invalid_request','stream must be a boolean.')
  if(!Array.isArray(raw.messages)||!raw.messages.length||raw.messages.length>64||raw.messages.some(m=>!object(m)||!['system','user','assistant','tool','developer'].includes(m.role)||(typeof m.content!=='string'&&!(m.content===null&&Array.isArray(m.tool_calls)))||Object.keys(m).some(k=>!['role','content','name','tool_call_id','tool_calls',...(native?['tool_name']:[])].includes(k))))throw fault(400,'invalid_messages','Only text and function-call messages are supported; no images or files.')
  if(native&&raw.messages.some(m=>m.tool_name!==undefined&&(m.role!=='tool'||typeof m.tool_name!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(m.tool_name))))throw fault(400,'invalid_messages','Invalid native tool-result name.')
  if(raw.tools!==undefined&&(!Array.isArray(raw.tools)||raw.tools.length>160||raw.tools.some(t=>!object(t)||t.type!=='function'||!object(t.function))))throw fault(400,'invalid_tools','Invalid function definitions.')
  const out=native?(raw.options?.num_predict??4096):(raw.max_completion_tokens??raw.max_tokens??4096)
  if(!Number.isSafeInteger(out)||out<1||out>4096)throw fault(400,'output_limit','Output must be between 1 and 4096 tokens.')
  // A deliberately conservative byte bound. The model's own profile also occupies context.
  if(Buffer.byteLength(JSON.stringify([raw.messages,raw.tools,raw.format,raw.response_format]))>22000)throw fault(400,'context_limit','Select a smaller context: 22 KB maximum, including function definitions.')
  const r={...raw,model:MODEL}
  if(native){r.options={num_ctx:32768,num_predict:out,temperature:0.2};r.keep_alive='30m'}
  else{delete r.max_completion_tokens;r.max_tokens=out}
  return r
}

export function createGateway({upstream='http://127.0.0.1:11434',keyFile,keys,log=()=>{},internal=true,queue=new Queue(),inferenceTimeout=180000,queueTimeout=480000,fetchImpl=fetch}={}){
  const base=new URL(upstream)
  if(base.protocol!=='http:'||!loopback(base.hostname)||base.port==='8081')throw new Error('Gateway upstream must be a separate loopback Ollama server.')
  const rates=new Map()
  const loadKeys=()=>{
    const entries=keys??JSON.parse(readFileSync(keyFile,'utf8')).keys
    if(!Array.isArray(entries)||entries.length>1000||entries.some(k=>!object(k)||typeof k.id!=='string'||!/^[a-f0-9]{64}$/.test(k.hash)))throw new Error('Invalid key store')
    return entries
  }
  const send=(res,status,value)=>{if(res.destroyed)return;if(res.headersSent){res.destroy();return}res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value))}
  const server=http.createServer(async(req,res)=>{
    const id=randomUUID(),started=Date.now();let keyId=null,release,status=500,timer
    const abort=new AbortController(),gone=()=>{if(!res.writableEnded)abort.abort(new Error('Client disconnected'))}
    req.on('aborted',gone);res.on('close',gone);res.setHeader('x-request-id',id)
    try{
      if(req.method==='GET'&&req.url==='/healthz'){status=200;send(res,200,{status:'ok',service:'atlas-flow'});return}
      const isNative=req.url?.startsWith('/api/')===true
      if(isNative){
        if(!internal||!loopback(req.socket.remoteAddress))throw fault(404,'not_found','Not found.')
        keyId='one-host'
      }else{
        const token=/^Bearer (af_[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization??'')?.[1]
        let match
        try{match=token&&loadKeys().find(k=>k.hash===keyHash(token)&&k.enabled!==false&&(!k.expiresAt||k.expiresAt>Date.now()))}catch{throw fault(503,'key_store_unavailable','API authentication temporarily unavailable.')}
        if(!match)throw fault(401,'unauthorized','A valid Atlas Flow API key is required.')
        keyId=match.id
        const now=Date.now(),r=rates.get(keyId)
        if(r&&now-r.at<60000){if(++r.n>30)throw fault(429,'rate_limit','Request rate exceeded; retry after one minute.')}
        else rates.set(keyId,{at:now,n:1})
        if(rates.size>1000)for(const[k,v]of rates)if(now-v.at>60000)rates.delete(k)
      }
      if(req.method==='GET'&&req.url==='/v1/models'){status=200;send(res,200,{object:'list',data:[{id:MODEL,object:'model',owned_by:'atlas-flow',created:1793404800}]});return}
      if(isNative&&req.method==='GET'&&req.url==='/api/tags'){
        const r=await fetchImpl(new URL('/api/tags',base),{redirect:'error',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(3000)])})
        if(!r.ok)throw new Error('Upstream unavailable')
        const d=await r.json();status=200;send(res,200,{models:(d.models??[]).filter(m=>m.name===MODEL)});return
      }
      if(req.method!=='POST'||!['/v1/chat/completions','/api/show','/api/chat'].includes(req.url??''))throw fault(404,'not_found','Not found.')
      const raw=await jsonBody(req)
      let payload
      if(req.url==='/api/show'){
        if(!isNative||!object(raw)||raw.model!==MODEL||Object.keys(raw).some(k=>k!=='model'))throw fault(400,'model_not_allowed','Only atlas-flow:latest is served.')
        payload=raw
      }else payload=chat(raw,isNative)
      if(req.url!=='/api/show'){
        timer=setTimeout(()=>abort.abort(fault(504,'queue_timeout','Queue wait expired.')),queueTimeout);timer.unref()
        release=await queue.enter(keyId,abort.signal);clearTimeout(timer)
      }
      timer=setTimeout(()=>abort.abort(fault(504,'inference_timeout','Inference timed out.')),req.url==='/api/show'?10000:inferenceTimeout);timer.unref()
      const r=await fetchImpl(new URL(req.url,base),{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:abort.signal})
      if(!r.ok)throw fault(502,'inference_failed','The selected model could not complete this request.')
      status=200
      res.writeHead(200,{'content-type':payload.stream?(isNative?'application/x-ndjson':'text/event-stream'):'application/json','cache-control':'no-store','x-content-type-options':'nosniff','x-accel-buffering':'no'})
      let size=0
      for await(const chunk of r.body){
        size+=chunk.length;if(size>2*1024*1024)throw fault(502,'response_limit','Model response exceeded the service limit.')
        if(!res.write(chunk))await once(res,'drain',{signal:abort.signal})
      }
      res.end()
    }catch(e){
      const error=abort.signal.aborted?abort.signal.reason:e
      status=Number.isInteger(error?.status)?error.status:503
      if(status===429)res.setHeader('retry-after','10')
      if(status===401)res.setHeader('www-authenticate','Bearer realm="Atlas Flow"')
      send(res,status,{error:{type:error?.code??'service_unavailable',message:error?.status?error.message:'Model service unavailable. No fallback was used.',request_id:id}})
    }finally{
      clearTimeout(timer);release?.();req.off('aborted',gone);res.off('close',gone)
      // Metadata only. Never include payload, results, arbitrary errors or authorization headers.
      log({id,keyId,status,ms:Date.now()-started})
    }
  })
  server.requestTimeout=20000;server.headersTimeout=10000;server.keepAliveTimeout=5000;server.maxConnections=100
  return {server,queue}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const {server}=createGateway({keyFile:process.env.ATLAS_FLOW_KEYS??'/etc/atlas-flow/api-keys.json',log:r=>process.stdout.write(JSON.stringify(r)+'\n')})
  server.listen(Number(process.env.PORT??8081),process.env.HOST??'0.0.0.0')
  const stop=()=>{server.close();setTimeout(()=>{server.closeAllConnections();process.exit(0)},10000).unref()}
  process.on('SIGTERM',stop);process.on('SIGINT',stop)
}
