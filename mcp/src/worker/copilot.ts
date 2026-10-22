/** Copilot is a model transport for the existing One harness, never a second executor.
 * Uses the CLI's documented SDK JSON-RPC stream. Native tools/config discovery stay off;
 * task content travels over stdin, and credentials stay in the CLI's own login/environment.
 * Protocol reference: github/copilot-sdk nodejs/src/client.ts (CLI 1.0.102).
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { createMessageConnection, StreamMessageReader, StreamMessageWriter, ResponseError } from 'vscode-jsonrpc/node.js'
import { visionOf, checkAttachments } from './copilot-media.ts'
import { execFileSafe, resolveCommand, spawnSafe, isFile, killTree, envGet, pathAbsolute } from './exec.ts'
import { RUN_MARK, RunTree } from './proctree.ts'
import { secretValues, scrubSecretText } from './secrets.ts'
import type { LocalInference, LocalInferenceRequest, LocalInferenceResponse } from './local-inference.ts'
export const COPILOT_MIN_VERSION = '1.0.102'
export const COPILOT_CONTEXT = 32768
export const validCopilotModel = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(v) && !/^(?:gh[pousr]_|github_pat_|sk-|eyJ)/.test(v)
export function findCopilot(env: NodeJS.ProcessEnv = process.env): string {
 const explicit=envGet(env,'COPILOT_BIN')?.trim()
 if(explicit)return /[/\\]/.test(explicit)&&!isAbsolute(explicit)?resolve(explicit):explicit
 if(resolveCommand('copilot',[],{env,cwd:tmpdir()},'shim').ok)return 'copilot'
 return [join(homedir(),'.local','bin',process.platform==='win32'?'copilot.exe':'copilot'),...(process.platform==='darwin'?['/opt/homebrew/bin/copilot','/usr/local/bin/copilot']:[])].find(isFile)??'copilot'
}
export function copilotEnv(from: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
 const out:NodeJS.ProcessEnv={}
 for(const [k,v]of Object.entries(from)){
  if(/^ONE_WORKER_/i.test(k))continue
  if(/TOKEN|KEY|SECRET|PASSWORD|AUTH/i.test(k)&&!['COPILOT_GITHUB_TOKEN','GH_TOKEN','GITHUB_TOKEN'].includes(k.toUpperCase()))continue
  if(/^COPILOT_(ALLOW|MCP|AGENT|PLUGIN|SKILL|AUTO|MODEL|SYSTEM|INSTRUCTION)/i.test(k))continue
  if(['NODE_OPTIONS','BASH_ENV','ENV'].includes(k.toUpperCase()))continue
  out[k]=v
 }
 // The CLI may authenticate; its native shell/MCP children must not receive these credentials.
 out.COPILOT_ALLOW_ALL='false'
 return pathAbsolute(out)
}
export function copilotArgs(logDir: string): string[] {
 return ['--headless','--stdio','--no-auto-update','--disable-builtin-mcps','--disable-client-telemetry','--no-custom-instructions','--no-bash-env','--no-remote-export','--no-color','--log-level','none','--log-dir',logDir,
  '--secret-env-vars','COPILOT_GITHUB_TOKEN,GH_TOKEN,GITHUB_TOKEN']
}
export async function detectCopilot(env:NodeJS.ProcessEnv=process.env){
 const r=await execFileSafe(findCopilot(env),['--version'],{cwd:tmpdir(),env:copilotEnv(env),timeoutMs:8000,maxBuffer:12000})
 const match=/\b(\d+)\.(\d+)\.(\d+)\b/.exec(r.stdout)
 const version=match?match.slice(1).map(Number):null
 const supported=!!version&&(version[0]!>1||version[0]===1&&(version[1]!>0||version[2]!>=102))
 return {found:r.code===0&&!!version,supported:r.code===0&&supported,version:match?.[0]??null}
}
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const count=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:undefined
const INSTALL='Install or update GitHub Copilot CLI (1.0.102 or newer) on this computer and sign in with copilot login. The subscription and organization policy must permit Copilot CLI. Set COPILOT_BIN if it is not on PATH.'

/** A bounded, ephemeral SDK session. No API key, task text or personal MCP token in argv/config files. */
async function session<T>(env:NodeJS.ProcessEnv,signal:AbortSignal,run:(rpc:ReturnType<typeof createMessageConnection>,dir:string)=>Promise<T>):Promise<T>{
 signal.throwIfAborted()
 const cap=await detectCopilot(env)
 if(!cap.supported)throw new Error(INSTALL)
 const dir=await mkdtemp(join(tmpdir(),'one-copilot-'))
 const childEnv={...copilotEnv(env),[RUN_MARK]:randomBytes(20).toString('hex')}
 const started=spawnSafe(findCopilot(env),copilotArgs(dir),{cwd:dir,env:childEnv,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32',windowsHide:true})
 if(!started.ok){await rm(dir,{recursive:true,force:true});throw new Error(INSTALL)}
 const child=started.child,tree=child.pid?new RunTree(child.pid,childEnv[RUN_MARK]!):null
 const rpc=createMessageConnection(new StreamMessageReader(child.stdout!),new StreamMessageWriter(child.stdin!))
 let bytes=0,diagnostic='',closed=false
 const secrets=secretValues(env),clean=(s:string)=>scrubSecretText(s,secrets)
 let rejectEnd:(e:Error)=>void=()=>{}
 const ended=new Promise<never>((_,reject)=>{rejectEnd=reject});void ended.catch(()=>{})
 const fail=(e:Error)=>{rejectEnd(e);void killTree(child)}
 const stop=()=>fail(new DOMException('Stopped in One.','AbortError'))
 child.stdout!.on('data',b=>{bytes+=b.length;if(bytes>8*1024*1024)fail(new Error('Copilot exceeded the response limit.'))})
 child.stderr!.on('data',b=>{bytes+=b.length;diagnostic=(diagnostic+clean(b.toString())).slice(-1500);if(bytes>8*1024*1024)fail(new Error('Copilot exceeded the response limit.'))})
 child.on('error',()=>fail(new Error(INSTALL)))
 child.on('exit',()=>{closed=true;tree?.exited();rejectEnd(new Error('Copilot CLI ended before the response completed.'+(diagnostic?' '+diagnostic:'')))})
 rpc.onRequest(()=>{throw new ResponseError(-32000,'One owns tools and permissions; native Copilot actions are disabled.')})
 rpc.onError(()=>fail(new Error('Invalid Copilot SDK transport. Update the CLI.')))
 signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop()
 const timer=setTimeout(()=>fail(new Error('Copilot did not finish this model round within three minutes.')),180000);timer.unref()
 rpc.listen()
 try{
  const ping=await Promise.race([rpc.sendRequest<any>('ping',{message:'one-worker'}),ended])
  if(!object(ping)||!Number.isSafeInteger(ping.protocolVersion)||ping.protocolVersion<2)throw new Error('Unsupported Copilot SDK protocol. '+INSTALL)
  return await Promise.race([run(rpc,dir),ended])
 }catch(e){throw new Error(clean(e instanceof Error?e.message:'Copilot request failed.'))}
 finally{
  clearTimeout(timer);signal.removeEventListener('abort',stop)
  rpc.dispose();if(!closed)await killTree(child);await tree?.end();await rm(dir,{recursive:true,force:true}).catch(()=>{})
 }
}
export async function probeCopilot(env:NodeJS.ProcessEnv=process.env){
 const cap=await detectCopilot(env)
 if(!cap.supported)return {...cap,authenticated:false,models:[] as string[],error:INSTALL}
 try{return await session(env,AbortSignal.timeout(20000),async rpc=>{
  const status=await rpc.sendRequest<any>('auth.getStatus',{})
  if(status?.isAuthenticated!==true)return {...cap,authenticated:false,models:[] as string[],error:'Sign in locally with copilot login. No model request was sent.'}
  const models=await rpc.sendRequest<any>('models.list',{})
  const list=Array.isArray(models)?models:models?.models
  return {...cap,authenticated:true,models:Array.isArray(list)?list.filter(m=>validCopilotModel(m?.id)&&m?.policy?.state!=='disabled').map(m=>m.id).slice(0,120):[] as string[], visions:Object.fromEntries((Array.isArray(list)?list:[]).filter(m=>validCopilotModel(m?.id)&&visionOf(m)).map(m=>[m.id,visionOf(m)])), contexts:Object.fromEntries((Array.isArray(list)?list:[]).filter(m=>validCopilotModel(m?.id)&&Number.isSafeInteger(m?.capabilities?.limits?.max_context_window_tokens)&&m.capabilities.limits.max_context_window_tokens>=8192).map(m=>[m.id,Math.min(65536,m.capabilities.limits.max_context_window_tokens)]))}
 })}catch{return {...cap,authenticated:false,models:[] as string[],error:'Copilot login/model availability could not be checked. Check your CLI, subscription and organization policy. No model request was sent.'}}
}
export function parseCopilotAnswer(raw:string,tools:any[]):LocalInferenceResponse {
 let data:unknown
 try{data=JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g,''))}catch{throw new Error('Copilot returned an invalid harness response. No response tools were executed.')}
 if(!object(data)||typeof data.content!=='string'||data.content.length>100000||!Array.isArray(data.tool_calls)||data.tool_calls.length>8)throw new Error('Invalid Copilot harness response.')
 const names=new Set(tools.map(t=>t.function.name))
 const calls=data.tool_calls.map((c:any)=>{
  if(!object(c)||!object(c.function)||!names.has(c.function.name)||!object(c.function.arguments)||JSON.stringify(c.function.arguments).length>100000)throw new Error('Copilot requested an unavailable tool or invalid arguments.')
  return {id:randomUUID(),type:'function',function:{name:c.function.name,arguments:c.function.arguments}}
 })
 return {message:{role:'assistant',content:data.content,...(calls.length?{tool_calls:calls}:{})}}
}
export function copilotInference(model='auto',env:NodeJS.ProcessEnv=process.env):LocalInference {
 if(!validCopilotModel(model))throw new Error('Invalid Copilot model ID.')
 const inference:LocalInference=async(request:LocalInferenceRequest)=>session(env,request.signal,async(rpc,dir)=>{
  const auth=await rpc.sendRequest<any>('auth.getStatus',{})
  if(auth?.isAuthenticated!==true)throw new Error('Copilot is not signed in. Run copilot login on this computer; a Copilot IDE license alone does not confirm CLI access.')
  if(model!=='auto'||request.attachments?.length){
   const result=await rpc.sendRequest<any>('models.list',{}),models=Array.isArray(result)?result:result?.models
   const selected=Array.isArray(models)?models.find(m=>m.id===model&&m.policy?.state!=='disabled'):null
   if(!selected)throw new Error('The selected Copilot model is not available under this login/policy. Choose an available model on the worker setup page; no fallback was used.')
   checkAttachments(request.attachments,visionOf(selected))
  }
  const id=randomUUID()
  let answer='',error='',usage:Record<string,unknown>={}
  let ready=false,done:()=>void=()=>{}
  const finished=new Promise<void>(resolve=>{done=resolve})
  const subscription=rpc.onNotification('session.event',(n:any)=>{
   if(n?.sessionId!==id||!ready||!object(n.event))return
   const e=n.event,d=e.data
   if(e.type==='assistant.message'&&typeof d?.content==='string'){answer=d.content;if(answer.length>250000){error='Copilot response exceeded its size limit.';done()}}
   if(e.type==='assistant.usage'&&object(d))usage=d
   if(e.type==='session.error'){error='Copilot failed: '+String(d?.message??'model request rejected');done()}
   if(e.type==='tool.execution_start'){error='Unexpected native tool execution. The Copilot transport is text-only.';done()}
   if(e.type==='session.idle')done()
  })
  try{
   const created=await rpc.sendRequest<any>('session.create',{
    sessionId:id,clientName:'one-worker',model,...(model==='auto'?{}:{allowedModels:[model]}),workingDirectory:dir,
    tools:[],availableTools:[],excludedTools:['*'],requestPermission:true,requestUserInput:false,streaming:false,
    mcpServers:{},enableConfigDiscovery:false,enableFileHooks:false,enableSkills:false,enableSessionStore:false,enableHostGitOperations:false,
    enableManagedSettings:true,enableSessionTelemetry:false,enableOnDemandInstructionDiscovery:false,skipEmbeddingRetrieval:true,embeddingCacheStorage:'in-memory',
    systemMessage:{mode:'replace',content:'You are the reasoning model for the One coding harness. Do not access files or tools yourself. Return ONLY one JSON object: {"content":"your response or empty string","tool_calls":[{"function":{"name":"an EXACT provided function name","arguments":{}}}]}. Use at most eight tool calls. For a final answer use an empty tool_calls array. The supplied conversation and function definitions describe the actual task and permitted tools. Request functions using this JSON protocol; One executes them and supplies real results in the next conversation. Never invent a tool result. Preserve instructions and source data boundaries. No Markdown fences. Keep the response within '+request.outputTokens+' output tokens.'},
   })
   if(created?.sessionId!==id)throw new Error('Copilot did not create the requested isolated session.')
   ready=true
   await rpc.sendRequest('session.send',{sessionId:id,prompt:JSON.stringify({messages:request.messages,tools:request.tools}),...(request.attachments?.length?{attachments:request.attachments.map((a,i)=>({type:'blob',data:a.data,mimeType:a.mediaType,displayName:'one-image-'+(i+1)}))}:{}),mode:'immediate'})
   await finished
   if(error)throw new Error(error)
   if(!answer.trim())throw new Error('Copilot returned no final harness response.')
   return {...parseCopilotAnswer(answer,request.tools),inputTokens:count(usage.inputTokens),outputTokens:count(usage.outputTokens)}
  }finally{subscription.dispose();await Promise.race([rpc.sendRequest('session.delete',{sessionId:id}).catch(()=>{}),new Promise(r=>{const t=setTimeout(r,1500);t.unref()})])}
 })
 inference.unmetered=true
 return inference
}
