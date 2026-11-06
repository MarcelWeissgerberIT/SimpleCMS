import {createStore,get,update} from 'idb-keyval'
import {sha256Hex} from '@/shared/mcp/sha256'
import {looksLikeKey} from '@/shared/ai/keys'
import {sourceBytes} from '@/shared/mcp/sourceLimits'
import {useCloud} from '../../../cloud/state'
import {useWorkspace} from '../../../store/store'
import {currentSetup,mcpAccessIdentity} from '../mcp-servers/config'
import {flowSignature} from './dataFlow'
const storage=createStore('one-mcp-work','records')
const DAY=24*60*60*1000,MAX_BYTES=24*1024*1024,MAX_ENTRIES=160
interface Row {scope:string;key:string;at:number;value:string;bytes:number}
/** Only the digest is persisted: never connection credentials or OAuth configuration. */
export function mcpWorkScope(){const c=useCloud.getState();return sha256Hex(JSON.stringify([useWorkspace.getState().epoch??'local',c.active,c.user?.id??null,flowSignature(),currentSetup().servers.map(mcpAccessIdentity),useWorkspace.getState().integrations]))}
const valid=(r:Row,now:number)=>r&&typeof r.scope==='string'&&typeof r.key==='string'&&typeof r.value==='string'&&Number.isFinite(r.at)&&now>=r.at&&now-r.at<DAY&&r.bytes===sourceBytes(r.value)&&r.bytes<=MAX_BYTES
export async function readMcpWork<T>(scope:string,key:string):Promise<T|null>{
 if(scope!==mcpWorkScope())return null
 const stored=await get('rows',storage),rows:Row[]=Array.isArray(stored)?stored:[],now=Date.now()
 if(scope!==mcpWorkScope())return null
 const row=rows.find(r=>valid(r,now)&&r.scope===scope&&r.key===key)
 if(!row)return null
 try{return JSON.parse(row.value) as T}catch{return null}
}
export async function saveMcpWork(scope:string,key:string,value:unknown):Promise<boolean>{
 if(scope!==mcpWorkScope())return false
 const text=JSON.stringify(value),bytes=sourceBytes(text)
 if(bytes>MAX_BYTES||looksLikeKey(text))return false
 let saved=false
 await update<Row[]>('rows',rows=>{
  if(scope!==mcpWorkScope())return rows??[]
  const at=Date.now(),next:Row[]=[{scope,key,value:text,bytes,at}],existing=(Array.isArray(rows)?rows:[]).filter(r=>valid(r,at)&&!(r.scope===scope&&r.key===key)).sort((a,b)=>b.at-a.at)
  let total=bytes
  for(const r of existing){if(next.length>=MAX_ENTRIES||total+r.bytes>MAX_BYTES)continue;next.push(r);total+=r.bytes}
  saved=true;return next
 },storage)
 return saved
}
export async function clearMcpWork(scope:string){await update<Row[]>('rows',rows=>(Array.isArray(rows)?rows:[]).filter(r=>r&&r.scope!==scope),storage)}
export async function listMcpWork<T>(scope:string,prefix:string):Promise<Array<{key:string;value:T}>>{
 const stored=await get('rows',storage),rows:Row[]=Array.isArray(stored)?stored:[]
 if(scope!==mcpWorkScope())return []
 return rows.filter(r=>valid(r,Date.now())&&r.scope===scope&&r.key.startsWith(prefix)).sort((a,b)=>b.at-a.at).flatMap(r=>{try{return [{key:r.key,value:JSON.parse(r.value) as T}]}catch{return []}})
}
export async function deleteMcpWork(scope:string,key:string){await update<Row[]>('rows',rows=>(Array.isArray(rows)?rows:[]).filter(r=>r&&(r.scope!==scope||r.key!==key)),storage)}
