/** Atlas repository calls carry confidential code. The host checks the repository's
 * current model switch before a content call and again before releasing its result. */
export const ATLAS_CODE_READ_TOOLS=['atlas_code_repos','atlas_code_versions','atlas_code_files','atlas_code_search','atlas_code_read','atlas_code_compare','atlas_code_verify','atlas_code_drafts'] as const
const guarded=new Set<string>([...ATLAS_CODE_READ_TOOLS.filter(n=>n!=='atlas_code_repos'),'atlas_code_propose'])
export const codeHumanOnly=(name:string)=>['atlas_code_review','atlas_code_repo_create','atlas_code_repo_update'].includes(name)
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v)
export function codeData(raw:unknown):Record<string,any>|null{
 try{const v=typeof raw==='string'?JSON.parse(raw):raw;if(!object(v)||v.isError===true)return null
  if(object(v.structuredContent))return v.structuredContent
  if(Array.isArray(v.content)){if(v.content.length!==1||v.content[0]?.type!=='text')return null;const data=JSON.parse(v.content[0].text);return object(data)?data:null}
  return v
 }catch{return null}
}
export class AtlasCodePolicyError extends Error{}
export const codeRefusal=(error:string)=>({isError:true,oneNotExecuted:true,content:[{type:'text',text:JSON.stringify({error})}]})
/** Returns a safe refusal; no denied result or code is included in errors. Metadata
 * must come from a fresh permitted catalogue call, never model-supplied assertions. */
export async function guardedAtlasCodeCall(name:string,args:Record<string,unknown>,call:(name:string,args:Record<string,unknown>)=>Promise<unknown>,allowed:(name:string)=>boolean):Promise<unknown>{
 if(codeHumanOnly(name))return codeRefusal('Repository imports, model-switch changes and code-draft reviews require the person to act in Atlas. This agent operation was not executed.')
 if(!guarded.has(name))return call(name,args)
 const repo=name==='atlas_code_verify'?args.citation&&object(args.citation)?args.citation.repo:undefined:args.repo
 if(typeof repo!=='string'||!repo.trim())return codeRefusal('An explicit repository identity is required for this Atlas code operation.')
 if(!allowed('atlas_code_repos'))return codeRefusal('Allow atlas_code_repos on this connection to check repository model-processing permission. No code operation was executed.')
 const check=async()=>{
  let offset:number|undefined;const seen=new Set<number>()
  for(let page=0;page<100;page++){
   const data=codeData(await call('atlas_code_repos',offset===undefined?{}:{offset}))
   if(!data||data.error||!Array.isArray(data.items))throw new AtlasCodePolicyError('Repository model-processing permission could not be verified. No code is released to the model.')
   const rows=data.items.filter((r:unknown)=>object(r)&&r.id===repo)
   if(rows.length){if(rows.length!==1||rows[0].modelProcessing!==true)throw new AtlasCodePolicyError('Model processing is disabled or unknown for this repository. Ask its owner to check the Atlas setting; no code is released to the model.');return}
   if(data.next===null)return false
   if(!Number.isSafeInteger(data.next)||data.next<0||seen.has(data.next))throw new AtlasCodePolicyError('Repository pagination could not be verified. No code is released to the model.')
   seen.add(data.next);offset=data.next
  }
  throw new AtlasCodePolicyError('Repository permission lookup reached its page limit. No code is released to the model.')
 }
 try{
  if(await check()===false)return codeRefusal('Repository not found or not accessible in the current token tenant. No code operation was executed.')
  const result=await call(name,args)
  // Revocation during a long read must not release the completed read to a model.
  try{if(await check()===false)throw new AtlasCodePolicyError('Repository access changed. The result was withheld from the model.')}catch{
   return {isError:true,content:[{type:'text',text:JSON.stringify({error:'Repository model permission could not be confirmed after the operation. Its result was withheld. A proposal may already exist; inspect drafts before retrying.'})}]}
  }
  return result
 }catch(e){if(e instanceof AtlasCodePolicyError)return codeRefusal(e.message);throw e}
}

export type AtlasCodeCitation={repo:string;snapshot:string;commit:string;path:string;lines:[number,number];digest:string}
export function readCodeCitation(v:unknown):AtlasCodeCitation|undefined{
 if(!object(v)||!['repo','snapshot','commit','path','digest'].every(k=>typeof v[k]==='string'&&v[k].length>0&&v[k].length<=2000)||!Array.isArray(v.lines)||v.lines.length!==2||!v.lines.every((n:unknown)=>Number.isSafeInteger(n)&&Number(n)>0)||v.lines[1]<v.lines[0])return
 return {repo:v.repo,snapshot:v.snapshot,commit:v.commit,path:v.path,lines:[v.lines[0],v.lines[1]],digest:v.digest}
}
