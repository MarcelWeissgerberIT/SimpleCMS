import type {JSONContent} from '@tiptap/core'
import type {FileSource,SectionAnalysis} from './model'
import {validateAnalysis} from './model'
export const CHECKPOINT_TITLE='File analysis · checkpoint'
export function checkpointDoc(source:FileSource,analyses:Record<number,SectionAnalysis>):JSONContent {
 return {type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Resume data for this source. AI drafts remain subject to review. Atlas comparisons are repeated after reopening.'}]},{type:'codeBlock',attrs:{language:'json'},content:[{type:'text',text:JSON.stringify({version:1,sha256:source.sha256,chunks:source.chunks.length,analyses})}]}]}
}
export function readCheckpoint(doc:JSONContent|null,source:FileSource):Record<number,SectionAnalysis>|null {
 try{
  const raw=doc?.content?.find(n=>n.type==='codeBlock')?.content?.map(n=>n.text??'').join('')
  const state=JSON.parse(raw??'')
  if(state.version!==1||state.sha256!==source.sha256||state.chunks!==source.chunks.length||!state.analyses||typeof state.analyses!=='object'||Array.isArray(state.analyses))return null
  const valid:Record<number,SectionAnalysis>={}
  for(const [key,value]of Object.entries(state.analyses)){
   const chunk=source.chunks[Number(key)]
   if(!chunk||String(chunk.index)!==key)return null
   valid[chunk.index]=validateAnalysis(value,chunk,source)
  }
  return valid
 }catch{return null}
}
