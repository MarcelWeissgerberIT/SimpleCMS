import {useCloud} from '../../../cloud/state'
import {request} from '../../../cloud/api'
import {isTestAccess} from '../../../cloud/testScope'
import {useWorkspace} from '../../../store/store'
import {compileProgram,readProgram,type ProgramSpec,type SavedProgram,type ProgramRun} from '@/shared/quandprofile/program'
import {looksLikeKey} from '@/shared/ai/keys'
export function programScope(){const c=useCloud.getState();return c.active.kind==='cloud'?{key:c.active.id+':'+c.user?.id,cloud:c.active.id}:{key:'local:'+useWorkspace.getState().epoch,cloud:null}}
const db=()=>new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('one-compiled-programs',1);r.onupgradeneeded=()=>{r.result.createObjectStore('library');r.result.createObjectStore('runs')};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})
async function local<T>(store:string,key:string,update?:(v:T|undefined)=>T){const d=await db();try{return await new Promise<T|undefined>((resolve,reject)=>{const tx=d.transaction(store,update?'readwrite':'readonly'),s=tx.objectStore(store),r=s.get(key);let value:T|undefined;r.onsuccess=()=>{try{value=update?update(r.result):r.result;if(update)s.put(value,key)}catch(e){tx.abort();reject(e)}};tx.oncomplete=()=>resolve(value);tx.onabort=tx.onerror=()=>reject(tx.error??Error('Local artifact storage failed'))})}finally{d.close()}}
function guard(scope:ReturnType<typeof programScope>){if(isTestAccess()||scope.key!==programScope().key)throw Error('Workspace or account changed. Open the library again.')}
export async function listPrograms(){const scope=programScope();guard(scope);const all=scope.cloud?(await request<{programs:SavedProgram[]}>('GET',`api/workspaces/${scope.cloud}/programs`)).programs:await local<SavedProgram[]>('library',scope.key)??[];guard(scope);for(const p of all)readProgram(p.compiled);return all}
export async function saveProgram(name:string,spec:ProgramSpec,previous?:SavedProgram){const scope=programScope();guard(scope);const compiled=compileProgram(spec);if(!name.trim()||name.length>120||looksLikeKey(name+' '+compiled.canonical))throw Error('Provide a name; keep credentials out of artifacts.');const id=previous?.id??crypto.randomUUID();let value:SavedProgram
 if(scope.cloud)value=await request<SavedProgram>('POST',`api/workspaces/${scope.cloud}/programs`,{id,name:name.trim(),previous:previous?.version??0,compiled})
 else {value={id,name:name.trim(),version:(previous?.version??0)+1,createdAt:Date.now(),compiled};await local<SavedProgram[]>('library',scope.key,rows=>{guard(scope);const all=rows??[];if(Math.max(0,...all.filter(p=>p.id===id).map(p=>p.version))!==(previous?.version??0))throw Error('Version changed. Reload.');if(value.version>100)throw Error('Version limit (100). Create a new program.');if(all.length>=200)throw Error('Library limit (200 versions).');return [value,...all]})}
 guard(scope);return value
}
export async function listProgramRuns(){const scope=programScope();guard(scope);const rows=scope.cloud?(await request<{runs:ProgramRun[]}>('GET',`api/workspaces/${scope.cloud}/programs/runs`)).runs:await local<ProgramRun[]>('runs',scope.key)??[];guard(scope);return rows}
export async function saveProgramRun(run:ProgramRun,scope:ReturnType<typeof programScope>){guard(scope);if(looksLikeKey(JSON.stringify(run)))throw Error('Receipt may contain credentials; not saved.');if(scope.cloud)await request('POST',`api/workspaces/${scope.cloud}/programs/runs`,run);else await local<ProgramRun[]>('runs',scope.key,rows=>{guard(scope);return [run,...(rows??[]).filter(r=>r.id!==run.id)].slice(0,100)})}
