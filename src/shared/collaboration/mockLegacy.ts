import type {JSONContent} from '@tiptap/core'
import {mockBlockData} from '../ai/mockBlock.ts'
import {mockVersionKey} from '../ai/mockReview.ts'

/** A pre-generation-7 pending copy has no field operations. Import its additional notes and
 * snapshots, while keeping current decisions for existing IDs and the current active preview.
 * Read the old copy itself: a Yjs probe may already have lost its whole spec attribute. */
export function recoverLegacyMockNotes(current:JSONContent|null,merged:JSONContent|null,legacy:JSONContent|null):JSONContent|null {
 const index=(doc:JSONContent|null)=>{
  const map=new Map<string,JSONContent>(),walk=(n:JSONContent)=>{
   if(n.type==='designMock'&&typeof n.attrs?.id==='string')map.set(n.attrs.id,n)
   n.content?.forEach(walk)
  }
  if(doc)walk(doc)
  return map
 }
 const live=index(current),old=index(legacy)
 const walk=(n:JSONContent):JSONContent=>{
  let out=n
  if(n.type==='designMock'&&live.has(n.attrs?.id)&&old.has(n.attrs?.id)){
   const now=mockBlockData(live.get(n.attrs!.id)!.attrs?.spec),then=mockBlockData(old.get(n.attrs!.id)!.attrs?.spec)
   // Existing limits guard creation, but never drop imported concurrent history.
   const checkpoint=(s:typeof now)=>{
    if(!s.preview)return s
    const key=mockVersionKey(s.preview),j=s.journal??{id:`recovered-${String(n.attrs?.id).replace(/[^a-zA-Z0-9-]/g,'').slice(0,60)}`,notes:[],versions:[]}
    return {...s,journal:j.versions.some(v=>v.key===key)?j:{...j,versions:[...j.versions,{key,at:s.preview.createdAt,label:'Recovered offline version',preview:s.preview}]}}
   }
   const a=checkpoint(now),b=checkpoint(then)
   if(a.journal||b.journal){
    const j=a.journal??b.journal!,other=b.journal
    const unique=<T,>(first:T[],second:T[],id:(v:T)=>string)=>[...first,...second.filter(v=>!first.some(x=>id(x)===id(v)))]
    const journal={...j,notes:unique(j.notes,other?.notes??[],n=>n.id),versions:unique(j.versions,other?.versions??[],v=>v.key),proposals:unique(j.proposals??[],other?.proposals??[],p=>p.id).map(p=>({...p,review:{...p.review,journal:j.id}}))}
    out={...n,attrs:{...n.attrs,spec:{...mockBlockData(n.attrs?.spec),preview:now.preview,journal}}}
   }
  }
  if(out.content)out={...out,content:out.content.map(walk)}
  return out
 }
 return merged?walk(merged):merged
}
