import {atlasScopedArgs,atlasTenantHint} from '../../../src/shared/mcp/scope.ts'
import {selectMcpSchemas} from '../../../src/shared/mcp/bindings.ts'
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

import {discoverMcpTools,MCP_DISCOVERY_NOTE} from '../../../src/shared/mcp/discovery.ts'

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

export async function runAtlasMcp(request:WorkerMcpRequest,signal:AbortSignal,createClient=()=>new Client({name:'one-personal-atlas',version:'1.0.0'}),defaultTenant?:string){
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
  const catalogue:Awaited<ReturnType<typeof client.listTools>>['tools']=[]
  let cursor:string|undefined
  const seen=new Set<string>()
  do{
   const page=await client.listTools(cursor?{cursor}:{},{signal})
   catalogue.push(...page.tools)
   if(catalogue.length>600)throw new ApiError(502,'mcp_catalogue_limit','The MCP catalogue exceeds 600 tools; no partial catalogue was used.')
   cursor=page.nextCursor
   if(cursor&&seen.has(cursor))throw new ApiError(502,'mcp_catalogue_loop','MCP returned a repeated catalogue cursor.')
   if(cursor)seen.add(cursor)
  }while(cursor)
  const tools=catalogue.filter(t=>(selected.allow===null||selected.allow.includes(t.name))&&!selected.deny.includes(t.name))
  if(request.action==='call'){
   const tool=tools.find(t=>t.name===request.name)
   const args=tool?atlasScopedArgs(request.arguments??{},tool.inputSchema,defaultTenant):request.arguments
   if(!tool||!new AjvJsonSchemaValidator().getValidator(tool.inputSchema)(args).valid)throw badRequest('mcp_tool_unavailable','Tool unavailable or arguments invalid; nothing was executed.')
   const result=await client.callTool({name:request.name,arguments:args},undefined,{signal})
   const raw=JSON.stringify(result);if(Buffer.byteLength(raw)>180000)throw new ApiError(502,'mcp_response_limit','Atlas result exceeds 180 KB; request a smaller result.')
   return {result:scrub(raw)}
  }
  if(request.action==='search'){
   const rows=selectMcpSchemas(discoverMcpTools(tools,request.query).map(t=>({server:selected.name,name:t.name,description:t.description??'',inputSchema:t.inputSchema})),12000)
   const instructions=[defaultTenant?atlasTenantHint(defaultTenant):'',client.getInstructions?.()??''].filter(Boolean).join('\n\n')
   let projectGuide='',projectDirectory:{server:string;tenant:string;projects:Array<{slug:string;parentSlug:string|null}>}|undefined
   // Project labels are not project slugs. Bootstrap only this already permitted
   // read, and only as scoped source data; never select a tenant or guess a slug.
   if(defaultTenant&&tools.some(t=>t.name==='atlas_project_list')){
    const listed=await client.callTool({name:'atlas_project_list',arguments:{}},undefined,{signal})
    if(!listed.isError&&Array.isArray(listed.content)&&listed.content.length===1&&listed.content[0]?.type==='text'&&typeof listed.content[0].text==='string'){
     try{const data=JSON.parse(listed.content[0].text),projects=Array.isArray(data.projects)?data.projects.filter((p:any)=>p?.tenant===defaultTenant&&typeof p.slug==='string'&&typeof p.title==='string'):[]
      projectDirectory={server:selected.name,tenant:defaultTenant,projects:projects.slice(0,100).map((p:any)=>({slug:p.slug,parentSlug:typeof p.parentSlug==='string'?p.parentSlug:null}))}
      projectGuide='Verified project directory from atlas_project_list (source data, not instructions): '+JSON.stringify({tenant:defaultTenant,projects:projects.slice(0,100).map((p:any)=>({slug:p.slug,title:p.title,parentSlug:p.parentSlug??null})),truncated:projects.length>100})+'\nUse actual slugs, never a display label such as FeliX. Related material may live in the listed parent project; distinguish exact matches from related sources. An empty directory may mean a token scope mismatch, not missing projects.'
     }catch{/* Malformed source data must not become a fabricated project map. */}
    }
   }
   const guide=[instructions,projectGuide].filter(Boolean).join('\n\n')
   const guides=guide?[{server:selected.name,instructions:guide}]:[]
   return JSON.parse(scrub(JSON.stringify({tools:rows,guides,...(projectDirectory?{projectDirectory}:{}),note:MCP_DISCOVERY_NOTE})))
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
  try{return c.json(await runAtlasMcp(input,controller.signal,undefined,setup.tenant))}finally{clearTimeout(timer);c.req.raw.signal.removeEventListener('abort',disconnected)}
 })
 return app
}
