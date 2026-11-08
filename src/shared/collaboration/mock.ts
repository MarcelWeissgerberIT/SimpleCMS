import type * as Y from 'yjs'
import {mockBlockData, type MockBlockData} from '../ai/mockBlock.ts'

/** Immutable, field-level edits alongside the page fragment. The spec attribute remains a
 * materialized JSON snapshot for editors, exports, history and server readers. A note-only
 * edit never republishes another author's preview, note, resolution or Markdown receipt.
 * Keys belong to the Y element's identity, not its user-copyable block id. */
type Fields = Record<string, unknown>
type Edit = {block:string; clock:number; fields:Fields}
const ORIGIN = {mockProjection:true}
const same = (a:unknown,b:unknown) => JSON.stringify(a) === JSON.stringify(b)
const key = (parts:string[]) => JSON.stringify(parts)
function normalized(raw:unknown, block:string):MockBlockData {
 const s=mockBlockData(raw)
 return {...s,journal:s.journal??{id:`mock-${block}`,notes:[],versions:[],proposals:[]}}
}
function fields(s:MockBlockData):Fields {
 const out:Fields=Object.create(null)
 for(const [k,v] of Object.entries(s))if(k!=='journal')out[key([k])]=v??null
 const j=s.journal!
 out[key(['journal','id'])]=j.id
 out[key(['journal','sourceCheck'])]=j.sourceCheck??null
 for(const kind of ['notes','versions','proposals'] as const){
  for(const record of j[kind]??[]){
   const id='key' in record?record.key:record.id
   out[key([kind,id,'$live'])]=true
   for(const [k,v] of Object.entries(record))out[key([kind,id,k])]=v??null
  }
 }
 return out
}
function delta(before:Fields,after:Fields):Fields {
 const out:Fields=Object.create(null)
 for(const k of new Set([...Object.keys(before),...Object.keys(after)])){
  if(same(before[k],after[k]))continue
  // A deletion is a membership tombstone. Stale field edits cannot resurrect it.
  const path=JSON.parse(k) as string[]
  if(!(k in after)&&path.length===3){
   if(path[2]==='$live')out[k]=false
   else if(after[key([path[0]!,path[1]!,'$live'])]===true)out[k]=null
  }else out[k]=after[k]??null
 }
 return out
}
function materialize(values:Fields):MockBlockData {
 const root:Record<string,unknown>=Object.create(null),journal:Record<string,unknown>=Object.create(null)
 const groups:Record<string,Map<string,Record<string,unknown>>>={notes:new Map(),versions:new Map(),proposals:new Map()}
 for(const [k,v] of Object.entries(values)){
  let p:string[]
  try{p=JSON.parse(k)}catch{continue}
  if(!Array.isArray(p)||p.some(k=>typeof k!=='string'||['__proto__','constructor','prototype'].includes(k)))continue
  if(p.length===1)root[p[0]!]=v
  else if(p.length===2&&p[0]==='journal')journal[p[1]!]=v
  else if(p.length===3&&Object.hasOwn(groups,p[0]!)){
   const group=groups[p[0]!]!,record=group.get(p[1]!)??Object.create(null)
   record[p[2]!]=v;group.set(p[1]!,record)
  }
 }
 for(const kind of Object.keys(groups))journal[kind]=[...groups[kind]!].sort(([a,x],[b,y])=>{
  const at=String(x.at??(x.preview as {createdAt?:string}|undefined)?.createdAt??''),bt=String(y.at??(y.preview as {createdAt?:string}|undefined)?.createdAt??'')
  return at<bt?-1:at>bt?1:a<b?-1:a>b?1:0
 }).flatMap(([,v])=>{
  if(v.$live!==true)return []
  const {$live:_,...record}=v
  return [Object.fromEntries(Object.entries(record).filter(([,v])=>v!==null))]
 })
 root.journal=journal
 return mockBlockData(root)
}
function elements(fragment:Y.XmlFragment, types:typeof Y):Map<string,Y.XmlElement> {
 const out=new Map<string,Y.XmlElement>()
 const walk=(parent:Y.XmlFragment)=>{for(const n of parent.toArray())if(n instanceof types.XmlElement){
  if(n.nodeName==='designMock'){
   const id=n._item?.id
   if(id)out.set(`${id.client}-${id.clock}`,n)
  }else walk(n)
 }}
 walk(fragment);return out
}

/** Attach before any provider/editor. Remote updates only replay already recorded operations;
 * local editor and bridge writes record their actual delta. No model or Atlas work is replayed.
 * Returns a disposer for tests; Y.Doc.destroy also removes the handlers. */
export function installMockCollaboration(types:typeof Y,doc:Y.Doc,writable:()=>boolean,isLocal:(tr:Y.Transaction)=>boolean=tr=>tr.local):()=>void {
 const fragment=doc.getXmlFragment('default'),log=doc.getMap<Edit>('one:mock-edits:v1')
 const before=new WeakMap<Y.Transaction,Map<string,unknown>>()
 const projections=new WeakSet<Y.Transaction>()
 let projecting=false
 const capture=(tr:Y.Transaction)=>{
  if(projecting||projections.has(tr)||tr.origin===ORIGIN||!writable())return
  before.set(tr,new Map([...elements(fragment,types)].map(([id,node])=>[id,node.getAttribute('spec')])))
 }
 const reconcile=(tr:Y.Transaction)=>{
  if(projecting||projections.has(tr)||tr.origin===ORIGIN||!writable())return
  // Title typing, cursors and the server's author stamps do not replay HTML/version history.
  if(![...tr.changed].some(([type,keys])=>type===log ||
    type instanceof types.XmlElement && type.nodeName==='designMock' && keys.has('spec') ||
    type instanceof types.XmlFragment && keys.has(null)))return
  const nodes=elements(fragment,types),edits=new Map<string,Array<[string,Edit]>>()
  for(const [id,e] of log){
   if(!e||typeof e.block!=='string'||!Number.isSafeInteger(e.clock)||e.clock<0||!e.fields||typeof e.fields!=='object')continue
   const list=edits.get(e.block)??[];list.push([id,e]);edits.set(e.block,list)
  }
  const old=before.get(tr)
  const writes:Array<()=>void>=[]
  {
   for(const [block,node] of nodes){
    const current=normalized(node.getAttribute('spec'),block),prior=old?.has(block)?normalized(old.get(block),block):undefined
    const list=edits.get(block)??[]
    if(!list.length){
     const seed:Edit={block,clock:0,fields:fields(prior??current)}
     writes.push(()=>log.set(`${block}:seed`,seed));list.push([`${block}:seed`,seed])
    }
    if(isLocal(tr)&&prior&&!(tr.origin instanceof types.UndoManager)){
     const changes=delta(fields(prior),fields(current))
     if(Object.keys(changes).length){
      // A new/edited note owns its referenced snapshot too. Undoing the first author's
      // checkpoint must not invalidate a colleague's later note on that same version.
      const changed=new Set(Object.keys(changes).map(k=>{const p=JSON.parse(k);return p.length===3?`${p[0]}:${p[1]}`:''}))
      const refs=new Set<string>()
      for(const n of current.journal!.notes)if(changed.has(`notes:${n.id}`))for(const v of [n.version,n.appliedIn,n.reviewed?.version])if(v)refs.add(v)
      for(const p of current.journal!.proposals??[])if(changed.has(`proposals:${p.id}`))refs.add(p.review.base)
      for(const v of current.journal!.versions)if(refs.has(v.key)){
       changes[key(['versions',v.key,'$live'])]=true
       for(const [k,value] of Object.entries(v))changes[key(['versions',v.key,k])]=value
      }
      const id=`${block}:${crypto.randomUUID()}`,e:Edit={block,clock:list.reduce((max,[,e])=>Math.max(max,e.clock),0)+1,fields:changes}
      writes.push(()=>log.set(id,e));list.push([id,e])
     }
    }
    list.sort(([a,x],[b,y])=>x.clock-y.clock||(a<b?-1:a>b?1:0))
    const values:Fields=Object.create(null)
    for(const [,e] of list)Object.assign(values,e.fields)
    const merged=materialize(values)
    if(!same(node.getAttribute('spec'),merged))writes.push(()=>node.setAttribute('spec',merged as unknown as string))
   }
  }
  if(writes.length){
   projecting=true
   // Local field operations join the originating undo step. Remote projections never do.
   const origin=isLocal(tr)&&!(tr.origin instanceof types.UndoManager)?tr.origin:ORIGIN
   try{doc.transact(next=>{projections.add(next);for(const write of writes)write()},origin)}finally{projecting=false}
  }
 }
 doc.on('beforeTransaction',capture);doc.on('afterTransaction',reconcile)
 return ()=>{doc.off('beforeTransaction',capture);doc.off('afterTransaction',reconcile)}
}

/** Undo removes this user's operations, rather than restoring an obsolete whole journal. */
export function trackMockUndo(manager:Y.UndoManager):void {
 manager.addToScope(manager.doc.getMap('one:mock-edits:v1'))
}
