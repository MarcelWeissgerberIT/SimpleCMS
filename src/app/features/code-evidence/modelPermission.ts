/** Permission is read again for each model-bound excerpt, never inferred from a saved citation. */
export async function requireModelProcessing(repoId:string,invoke:(name:string,args:Record<string,unknown>)=>Promise<Record<string,any>|null>){
 let offset:number|undefined;const seen=new Set<number>()
 for(let i=0;i<100;i++){
  const catalogue=await invoke('atlas_code_repos',offset===undefined?{}:{offset})
  if(!catalogue||catalogue.error||!Array.isArray(catalogue.items))throw Error('Repository catalogue unavailable')
  const repo=catalogue.items.find((r:any)=>r?.id===repoId)
  if(repo){if(repo.modelProcessing===true)return;break}
  if(catalogue.next===null)break
  if(!Number.isSafeInteger(catalogue.next)||catalogue.next<0||seen.has(catalogue.next))break
  seen.add(catalogue.next);offset=catalogue.next
 }
 throw Error('Repository is not available for model processing')
}
