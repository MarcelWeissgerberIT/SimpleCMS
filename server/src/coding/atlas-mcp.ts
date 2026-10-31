/** Personal AJ-Atlas handoff for cloud workspaces. Credentials exist only for this request. */
import {Hono} from 'hono'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/sdk/validation/ajv-provider.js'
import {z} from 'zod'
import type {AppEnv,Services} from '../context.ts'
import {ApiError,badRequest,forbidden,rateLimited} from '../errors.ts'
import {access} from '../routes/access.ts'
import {body} from '../http/util.ts'
import {mcpDestinationAllowed} from '../../../src/shared/ai/dataFlow.ts'
import {sanitizeWorkspaceAI} from '../../../src/shared/ai/policy.ts'
import type {WorkerMcpRequest} from '../../../src/shared/ai/worker.ts'

const ENDPOINT='https://aj-atlas.com/api/atlas/mcp'
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v)
export function checkAtlasMcp(v:unknown):v is WorkerMcpRequest{
 if(!object(v)||!['list','search','call'].includes(v.action)||Object.keys(v).some(k=>!['action','servers','query','server','name','arguments'].includes(k))||!Array.isArray(v.servers)||v.servers.length!==1)return false
 const s=v.servers[0],names=(x:unknown)=>Array.isArray(x)&&x.length<=600&&x.every(n=>typeof n==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(n))
 if(!object(s)||Object.keys(s).some(k=>!['name','url','token','allow','deny'].includes(k))||!(/^[a-z][a-z0-9_-]{0,31}$/.test(s.name))||s.url!==ENDPOINT||typeof s.token!=='string'||s.token.length<8||s.token.length>8192||/\s/.test(s.token)||s.allow!==null&&!names(s.allow)||!names(s.deny))return false
 if(v.action==='search'&&(typeof v.query!=='string'||v.query.length>200))return false
 if(v.action==='call'&&(v.server!==s.name||typeof v.name!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(v.name)||!object(v.arguments)||JSON.stringify(v.arguments).length>20000))return false
 return true
}

export async function runAtlasMcp(request:WorkerMcpRequest,signal:AbortSignal,createClient=()=>new Client({name:'one-personal-atlas',version:'1.0.0'})){
 if(!checkAtlasMcp(request))throw badRequest('invalid_mcp','Use the prepared personal AJ-Atlas connection.')
 const selected=request.servers[0]!,client=createClient(),endpoint=new URL(ENDPOINT)
 const safeFetch:typeof fetch=(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input))
  if(url.origin!==endpoint.origin)throw new Error('Cross-origin MCP request refused')
  const headers=new Headers(init?.headers);headers.set('authorization','Bearer '+selected.token)
  return fetch(input,{...init,headers,redirect:'error',credentials:'omit',signal})
 }
 const transport=new StreamableHTTPClientTransport(endpoint,{fetch:safeFetch,requestInit:{redirect:'error'}})
 const scrub=(s:string)=>s.replaceAll(selected.token,'[redacted]')
 try{
  await client.connect(transport,{signal})
  const found=await client.listTools({}, {signal}),tools=found.tools.slice(0,200).filter(t=>(selected.allow===null||selected.allow.includes(t.name))&&!selected.deny.includes(t.name))
  if(request.action==='call'){
   const tool=tools.find(t=>t.name===request.name)
   if(!tool||!new AjvJsonSchemaValidator().getValidator(tool.inputSchema)(request.arguments).valid)throw badRequest('mcp_tool_unavailable','Tool unavailable or arguments invalid; nothing was executed.')
   const result=await client.callTool({name:request.name,arguments:request.arguments},undefined,{signal})
   const raw=JSON.stringify(result);if(Buffer.byteLength(raw)>180000)throw new ApiError(502,'mcp_response_limit','Atlas result exceeds 180 KB; request a smaller result.')
   return {result:scrub(raw)}
  }
  if(request.action==='search'){
   const words=request.query.toLowerCase().split(/[\s_]+/).filter(Boolean);let size=0
   const rows=tools.filter(t=>words.every(w=>(t.name+' '+(t.description??'')).toLowerCase().includes(w))).slice(0,6).map(t=>({server:selected.name,name:t.name,description:t.description?.slice(0,1600)??'',inputSchema:t.inputSchema})).filter(t=>{size+=JSON.stringify(t).length;return size<=12000})
   return JSON.parse(scrub(JSON.stringify({tools:rows})))
  }
  return JSON.parse(scrub(JSON.stringify({tools:tools.map((t,i)=>({name:'remote_mcp_'+i,server:selected.name,tool:t.name,description:`[${selected.name} / ${t.name}] ${(t.description??'').slice(0,1600)}`,parameters:t.inputSchema}))})))
 }catch(e){
  if(e instanceof ApiError)throw e
  // Do not echo provider errors, URLs or tokens; an Atlas 401 must never sign the caller out of ONE.
  const message=e instanceof Error?e.message:''
  if(/401|403|unauthoriz|forbidden/i.test(message))throw new ApiError(502,'mcp_auth','AJ-Atlas hat diesen persönlichen Token abgelehnt. Bitte Token und Rechte prüfen.')
  throw new ApiError(502,'mcp_unavailable','AJ-Atlas ist nicht erreichbar oder hat die Anfrage abgelehnt. Es wurde kein anderer Server verwendet.')
 }finally{await client.close().catch(()=>{})}
}

export function atlasMcpRoutes(s:Services){
 const app=new Hono<AppEnv>()
 app.post('/:id/atlas-mcp',async c=>{
  const {workspace,auth}=access(s,c,'member')
  const policy=await s.collab.read('ws:'+workspace.id,doc=>sanitizeWorkspaceAI(doc.getMap('workspace').get('ai')))
  const setup=policy?.onboarding
  if(!mcpDestinationAllowed(ENDPOINT,policy?.dataFlow))throw forbidden('mcp_destination','Atlas is excluded by this workspace data-flow rule.')
  if(setup?.mcpUrl!==ENDPOINT)throw forbidden('atlas_not_prepared','This workspace has no prepared personal AJ-Atlas connection.')
  const input=await body(c,z.custom<WorkerMcpRequest>(checkAtlasMcp))
  if(input.servers[0]!.name!==setup.mcpName)throw badRequest('mcp_scope','Use this workspace’s prepared Atlas connection.')
  const wait=s.limiter.hit('atlas-mcp:'+workspace.id+':'+auth.user.id,60,60000);if(wait)throw rateLimited(wait/1000)
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000)
  const disconnected=()=>controller.abort();c.req.raw.signal.addEventListener('abort',disconnected,{once:true})
  try{return c.json(await runAtlasMcp(input,controller.signal))}finally{clearTimeout(timer);c.req.raw.signal.removeEventListener('abort',disconnected)}
 })
 return app
}
