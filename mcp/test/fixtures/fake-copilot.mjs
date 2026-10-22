#!/usr/bin/env node
// An SDK-protocol peer, never a model/network call. Also runs through Windows npm-style shims.
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
const args=process.argv.slice(2)
if(args.includes('--version')){console.log('GitHub Copilot CLI '+(process.env.COPILOT_FAKE_VERSION||'1.0.102'));process.exit(0)}
let data=Buffer.alloc(0),session=null
const out=x=>{const b=Buffer.from(JSON.stringify({jsonrpc:'2.0',...x}));process.stdout.write('Content-Length: '+b.length+'\r\n\r\n');process.stdout.write(b)}
const record=x=>{const file=process.env.COPILOT_CAPTURE;if(!file)return;const list=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[];list.push(x);writeFileSync(file,JSON.stringify(list))}
process.stdin.on('data',chunk=>{data=Buffer.concat([data,chunk]);while(true){const i=data.indexOf('\r\n\r\n');if(i<0)return;const m=/Content-Length:\s*(\d+)/i.exec(data.subarray(0,i).toString());if(!m)throw Error('No frame');const n=Number(m[1]);if(data.length<i+4+n)return;const request=JSON.parse(data.subarray(i+4,i+4+n));data=data.subarray(i+4+n);handle(request)}})
function handle(r){
 if(r.id==='native-permission'){record({permissionResponse:r});return}
 record({args,method:r.method,params:r.params,cwd:process.cwd(),env:{ANTHROPIC_API_KEY:process.env.ANTHROPIC_API_KEY,ONE_WORKER_TOKEN:process.env.ONE_WORKER_TOKEN,COPILOT_ALLOW_ALL:process.env.COPILOT_ALLOW_ALL}})
 const reply=result=>out({id:r.id,result})
 if(r.method==='ping')return reply({message:'pong',protocolVersion:3})
 if(r.method==='auth.getStatus')return reply({isAuthenticated:process.env.COPILOT_FAKE_SIGNED_OUT!=='1'})
 if(r.method==='models.list')return reply({models:[{id:'claude-opus-5.5'},{id:'gpt-6.1-sol'},{id:'blocked-model',policy:{state:'disabled'}}]})
 if(r.method==='session.create'){session=r.params.sessionId;return reply({sessionId:session})}
 if(r.method==='session.delete')return reply({success:true})
 if(r.method!=='session.send')return out({id:r.id,error:{code:-32601,message:'Unknown method'}})
 reply({messageId:'m1'})
 if(process.env.COPILOT_FAKE_HANG)return
 if(process.env.COPILOT_FAKE_PERMISSION)out({id:'native-permission',method:'permission.request',params:{sessionId:session,permissionRequest:{kind:'shell',fullCommandText:'forbidden'}}})
 const file=process.env.COPILOT_INDEX,index=file&&existsSync(file)?Number(readFileSync(file,'utf8')):0
 if(file)writeFileSync(file,String(index+1))
 const answers=JSON.parse(process.env.COPILOT_ANSWERS||'[]')
 const answer=answers[index]??{content:'Completed by Copilot fixture.',tool_calls:[]}
 out({method:'session.event',params:{sessionId:session,event:{type:'assistant.message',data:{content:typeof answer==='string'?answer:JSON.stringify(answer)}}}})
 out({method:'session.event',params:{sessionId:session,event:{type:'assistant.usage',data:{inputTokens:50,outputTokens:20}}}})
 out({method:'session.event',params:{sessionId:session,event:{type:'session.idle',data:{}}}})
}
