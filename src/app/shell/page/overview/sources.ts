import {waitForSource} from './sourceReady'
import {acquireContentDoc,releaseContentDoc,flushPageContent,useCloud} from '../../../cloud'

/** Keep sources subscribed until the caller releases them, so concurrent edits stay visible.
 * Loading uses four connections at a time and never silently skips a failed source.
 */
export async function holdOverviewPages(ids:readonly string[],signal:AbortSignal):Promise<()=>void>{
 const held:string[]=[]
 const release=()=>{held.splice(0).forEach(id=>releaseContentDoc(id))}
 if(useCloud.getState().active.kind!=='cloud')return release
 try{
  const unique=[...new Set(ids)]
  for(let start=0;start<unique.length;start+=4){
   signal.throwIfAborted()
   const results=await Promise.allSettled(unique.slice(start,start+4).map(async id=>{
    signal.throwIfAborted()
    const handle=acquireContentDoc(id)
    if(!handle)throw Error('Source not available')
    held.push(id)
    await waitForSource(handle,signal)
    flushPageContent(id)
   }))
   const failed=results.find(r=>r.status==='rejected')
   if(failed?.status==='rejected')throw failed.reason
  }
  return release
 }catch(e){release();throw e}
}
