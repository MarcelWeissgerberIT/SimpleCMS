import {unzipSync,strFromU8} from 'fflate'
import {readUIProject,type UIProject} from '@/shared/uiInstructions/project'
/** Bounded, in-memory import. No archive paths are ever written to disk or fetched. */
export async function readUIArchive(file:File):Promise<{name:string;project:UIProject}[]> {
 if(file.size>32_000_000)throw new Error('ZIP überschreitet 32 MB. Bitte einzelne Teil-MDs importieren.')
 let bytes=0,count=0
 const entries=unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:entry=>{
  if(++count>10000)throw new Error('Zu viele Dateien im Archiv.')
  const wanted=entry.name==='collection.json'||entry.name==='UI-INSTRUCTIONS.md'||/^parts\/[A-Za-z0-9_-]+\/instructions\.md$/.test(entry.name)
  if(wanted){bytes+=entry.originalSize;if(entry.originalSize>12_000_000||bytes>32_000_000)throw new Error('Entpackte UI-Vorgaben überschreiten 32 MB.')}
  return wanted
 }})
 if(!entries['collection.json']){if(!entries['UI-INSTRUCTIONS.md'])throw new Error('Kein UI-Projekt im ZIP gefunden.');return [{name:'UI Instructions',project:readUIProject(strFromU8(entries['UI-INSTRUCTIONS.md']))}]}
 const collection=JSON.parse(strFromU8(entries['collection.json']))
 if(collection?.format!=='component-studio-collection'||collection.version!==1||!Array.isArray(collection.parts)||collection.parts.length>1500)throw new Error('Ungültige UI-Projektsammlung.')
 const result:{name:string;project:UIProject}[]=[],ids=new Set<string>()
 for(const part of collection.parts){
  if(!part||typeof part.id!=='string'||!/^[A-Za-z0-9_-]+$/.test(part.id)||ids.has(part.id)||typeof part.name!=='string'||!/^[a-f0-9]{64}$/.test(part.sha256))throw new Error('Ungültiger Projektteil.')
  ids.add(part.id);const content=entries[`parts/${part.id}/instructions.md`];if(!content)throw new Error('Projektteil fehlt: '+part.name)
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',content as Uint8Array<ArrayBuffer>))].map(b=>b.toString(16).padStart(2,'0')).join('')
  if(hash!==part.sha256)throw new Error('Prüfsumme stimmt nicht: '+part.name)
  result.push({name:part.name,project:readUIProject(JSON.stringify({format:'component-studio-project',version:1,settings:{project:typeof collection.project==='string'?collection.project+' · '+part.name:part.name},markdown:strFromU8(content)}))})
 }
 if(!result.length)throw new Error('Das Archiv enthält keine UI-Teile.')
 return result
}
