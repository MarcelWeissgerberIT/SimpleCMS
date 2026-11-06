import {readCodeCitation,type AtlasCodeCitation} from './atlasCode.ts'
/** Portable reference only. Source bytes and connection credentials never belong in the page. */
export const CODE_REFERENCE_LANGUAGE='atlas-code'
export type CodeReference={citation:AtlasCodeCitation;server?:string;repoName?:string;finding?:string;highlight?:[number,number];atlasUrl?:string}
export function codeReference(raw:string):CodeReference|null{
 try{
  if(raw.length>16000)return null
  const v=JSON.parse(raw),citation=readCodeCitation(v?.citation??v)
  if(!citation||citation.lines[1]-citation.lines[0]>=2000)return null
  const result:CodeReference={citation}
  for(const key of ['server','repoName','finding'] as const)if(typeof v[key]==='string')result[key]=v[key].slice(0,key==='finding'?4000:200)
  if(v.highlight!==undefined){const h=v.highlight;if(!Array.isArray(h)||h.length!==2||!h.every(Number.isSafeInteger)||h[0]<citation.lines[0]||h[1]>citation.lines[1]||h[1]<h[0])return null;result.highlight=[h[0],h[1]]}
  if(typeof v.atlasUrl==='string'){try{const u=new URL(v.atlasUrl);if(u.protocol==='https:'&&!u.username&&!u.password&&['aj-atlas.com','eh-atlas.com','eu-atlas.com'].includes(u.hostname))result.atlasUrl=u.href}catch{}}
  return result
 }catch{return null}
}
export function sameCodeCitation(a:AtlasCodeCitation,b:AtlasCodeCitation){return ['repo','snapshot','commit','path','digest'].every(k=>a[k as keyof AtlasCodeCitation]===b[k as keyof AtlasCodeCitation])&&a.lines[0]===b.lines[0]&&a.lines[1]===b.lines[1]}
/** Refuse wrong versions, misleading line numbers, incomplete reads and fabricated highlighting. */
export function checkedCodeExcerpt(data:Record<string,any>|null,ref:CodeReference,context:boolean){
 const c=data&&readCodeCitation(data.citation),original=ref.citation
 if(!data||data.error||typeof data.text!=='string'||data.text.length>131072||data.truncated===true||!c||c.repo!==original.repo||c.snapshot!==original.snapshot||c.commit!==original.commit||c.path!==original.path||c.lines[0]>original.lines[0]||c.lines[1]<original.lines[1]||c.lines[1]-c.lines[0]>=2000||!context&&!sameCodeCitation(c,original))throw Error('sourceMismatch')
 const lines=data.text.replace(/\r\n/g,'\n').split('\n'),count=c.lines[1]-c.lines[0]+1
 if(lines.length===count+1&&lines.at(-1)==='')lines.pop()
 if(lines.length!==count)throw Error('sourceMismatch')
 return {citation:c,lines}
}
