/** Local IndexedDB readiness is not server synchronization. Require both before reading sources. */
interface SourceHandle {
 ready: Promise<void>
 provider: {isSynced:boolean;on:(event:string,fn:()=>void)=>unknown;off:(event:string,fn:()=>void)=>unknown}
}
export async function waitForSource(handle:SourceHandle,signal:AbortSignal,timeoutMs=20000):Promise<void>{
 signal.throwIfAborted()
 let timer:ReturnType<typeof setTimeout>|undefined
 let synced=()=>{},abort=()=>{}
 try{
  const server=new Promise<void>(resolve=>{
   synced=()=>{if(handle.provider.isSynced)resolve()}
   handle.provider.on('synced',synced)
   synced()
  })
  const interrupted=new Promise<never>((_,reject)=>{
   abort=()=>reject(new DOMException('Aborted','AbortError'))
   signal.addEventListener('abort',abort,{once:true})
   timer=setTimeout(()=>reject(Error('Source sync timed out')),timeoutMs)
   if(signal.aborted)abort()
  })
  await Promise.race([Promise.all([handle.ready,server]),interrupted])
  signal.throwIfAborted()
  if(!handle.provider.isSynced)throw Error('Source not synced')
 }finally{
  clearTimeout(timer)
  signal.removeEventListener('abort',abort)
  handle.provider.off('synced',synced)
 }
}
