import type {JSONContent} from '@tiptap/core'
import type {Page} from '../../../store/types'
import {sha256Hex} from '../../../../shared/mcp/sha256.ts'
export const kinds=['summary','finding','decision','action','question'] as const
export type OverviewKind=typeof kinds[number]
export interface OverviewItem {id:string;kind:OverviewKind;title:string;detail:string;role:string;doneWhen:string;options:string[];sourceId:string;quote:string;sourcePageId?:string;sourcePageTitle?:string;sourceBlockId?:string|null}
export interface PageOverview {version:1;signature:string;at:number;language:'de'|'en';items:OverviewItem[];sourcePages?:Array<{id:string;title:string;signature:string}>}
export interface OverviewReview {item:OverviewItem;signature:string;at:number;by:string;state:'confirmed'|'deferred'|'question';note:string;owner:string;taskId?:string}
export interface OverviewSource {id:string;blockId:string|null;index:number;text:string;pageId?:string;pageTitle?:string;localId?:string}
export const overviewSignature=(page:Pick<Page,'title'|'content'>)=>sha256Hex(JSON.stringify([page.title,page.content]))
export function nodeText(n:JSONContent):string {return n.text??(n.content?.map(nodeText).join(n.type==='paragraph'||n.type==='heading'?'':'\n')??'')}
export function overviewSources(page:Pick<Page,'content'>):OverviewSource[]{return (page.content?.content??[]).map((node,index)=>({id:typeof node.attrs?.id==='string'?node.attrs.id:'block:'+index,blockId:typeof node.attrs?.id==='string'?node.attrs.id:null,index,text:nodeText(node).trim()})).filter(s=>s.text)}
const str=(max:number,min=0)=>({type:'string',minLength:min,maxLength:max})
export const overviewSchema={type:'object',additionalProperties:false,required:['items'],properties:{items:{type:'array',minItems:1,maxItems:18,items:{type:'object',additionalProperties:false,required:['kind','title','detail','role','doneWhen','options','sourceId','quote'],properties:{kind:{type:'string',enum:[...kinds]},title:str(160,1),detail:str(900,1),role:str(100),doneWhen:str(400),options:{type:'array',maxItems:4,items:str(240,1)},sourceId:str(160,1),quote:str(600,8)}}}}}
const bounds = {title:[1,160],detail:[1,900],role:[0,100],doneWhen:[0,400],sourceId:[1,160],quote:[8,600]} as const
function itemValue(v:any):v is OverviewItem {
 return !!v && kinds.includes(v.kind) && typeof v.id==='string' && /^[a-f0-9]{64}$/.test(v.id)
  && Object.entries(bounds).every(([key,[min,max]])=>typeof v[key]==='string'&&v[key].trim().length>=min&&v[key].length<=max)
  && Array.isArray(v.options)&&v.options.length<=4&&v.options.every((x:unknown)=>typeof x==='string'&&x.trim().length>0&&x.length<=240)
  && (v.sourcePageId===undefined||typeof v.sourcePageId==='string'&&v.sourcePageId.length>0&&v.sourcePageId.length<=160)
  && (v.sourcePageTitle===undefined||typeof v.sourcePageTitle==='string'&&v.sourcePageTitle.length<=300)
  && (v.sourceBlockId===undefined||v.sourceBlockId===null||typeof v.sourceBlockId==='string'&&v.sourceBlockId.length<=160)
  && (v.kind!=='action'||!!v.doneWhen.trim())
}
function cleanItem(v:OverviewItem):OverviewItem {
 const {id,kind,title,detail,role,doneWhen,options,sourceId,quote}=v
 return {id,kind,title,detail,role,doneWhen,options:[...options],sourceId,quote,...(v.sourcePageId?{sourcePageId:v.sourcePageId,sourcePageTitle:v.sourcePageTitle??'',sourceBlockId:v.sourceBlockId??null}:{})}
}
export function parseOverview(raw:string,sources:OverviewSource[],signature:string,language:'de'|'en'):PageOverview {
 const data=JSON.parse(raw),ids=new Set<string>()
 if(!Array.isArray(data.items)||!data.items.length||data.items.length>18)throw Error('Invalid overview')
 const items=data.items.map((v:any)=>{
  const source=sources.find(s=>s.id===v.sourceId)
  const id=sha256Hex(JSON.stringify([v.kind,v.sourceId,v.quote]))
  const item={...v,id,sourcePageId:source?.pageId,sourcePageTitle:source?.pageTitle,sourceBlockId:source?.blockId}
  if(!itemValue(item)||!v.title.trim()||!v.detail.trim()||v.quote.length<8||!source?.text.includes(v.quote)||v.kind==='action'&&!v.doneWhen.trim()||ids.has(id))throw Error('Overview source check failed')
  ids.add(id);return cleanItem(item)
 })
 if(!items.some((i:OverviewItem)=>i.kind==='summary'))throw Error('Missing overview summary')
 return {version:1,signature,language,at:Date.now(),items}
}
export function sanitizeOverview(v:unknown):PageOverview|undefined {
 const x=v as PageOverview
 if(!x||x.version!==1||!['de','en'].includes(x.language)||typeof x.signature!=='string'||!/^[a-f0-9]{64}$/.test(x.signature)||!Number.isFinite(x.at)||!Array.isArray(x.items)||!x.items.length||x.items.length>18||!x.items.every(itemValue))return
 const scope=x.sourcePages
 if(scope!==undefined&&(!Array.isArray(scope)||!scope.length||scope.length>31||new Set(scope.map(p=>p?.id)).size!==scope.length||scope.some(p=>!p||typeof p.id!=='string'||!p.id||p.id.length>160||typeof p.title!=='string'||p.title.length>300||typeof p.signature!=='string'||!/^[a-f0-9]{64}$/.test(p.signature))))return
 return {version:1,signature:x.signature,language:x.language,at:x.at,items:x.items.map(cleanItem),...(scope?{sourcePages:scope.map(({id,title,signature})=>({id,title,signature}))}:{})}
}
export function sanitizeOverviewReviews(v:unknown):Record<string,OverviewReview>{
 const out:Record<string,OverviewReview>={}
 if(!v||typeof v!=='object'||Array.isArray(v))return out
 for(const [key,value]of Object.entries(v).slice(0,200)){
  const r=value as OverviewReview
  if(!/^[a-f0-9]{64}$/.test(key)||!r||!itemValue(r.item)||r.item.id!==key||!['confirmed','deferred','question'].includes(r.state)||typeof r.signature!=='string'||r.signature.length!==64||!Number.isFinite(r.at)||typeof r.by!=='string'||r.by.length>200||typeof r.note!=='string'||r.note.length>2000||typeof r.owner!=='string'||r.owner.length>200||r.taskId!==undefined&&(typeof r.taskId!=='string'||r.taskId.length>160))continue
  out[key]={item:cleanItem(r.item),signature:r.signature,at:r.at,by:r.by,state:r.state,note:r.note,owner:r.owner,...(r.taskId?{taskId:r.taskId}:{})}
 }
 return out
}

/** Incremental JSON scanner: only complete, source-checked cards become a preview.
 * A malformed prefix stops previews; the final response must still pass parseOverview.
 * Strings/escapes are tracked across network chunks, including braces inside quotes.
 */
export function overviewPreview(sources:OverviewSource[],signature:string,language:'de'|'en') {
 let raw='',cursor=0,start=-1,depth=0,inString=false,escaped=false,stopped=false,count=0
 return (delta:string):OverviewItem[]|undefined=>{
  if(stopped)return
  raw+=delta
  if(raw.length>200000){stopped=true;return}
  if(start<0){
   const head=/^\s*\{\s*"items"\s*:\s*\[/.exec(raw)
   if(!head)return
   start=head[0].length;cursor=start
  }
  let latest:OverviewItem[]|undefined
  for(;cursor<raw.length;cursor++){
   const c=raw[cursor]
   if(inString){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')inString=false;continue}
   if(c==='"'){inString=true;continue}
   if(c==='{')depth++
   if(c==='}'){
    depth--
    if(depth===0){
     try{
      const parsed=parseOverview('{"items":['+raw.slice(start,cursor+1)+']}',sources,signature,language)
      if(parsed.items.length>count){count=parsed.items.length;latest=parsed.items}
     }catch{stopped=true;return latest}
    }
   }
   if(c===']'&&depth===0){stopped=true;break}
  }
  return latest
 }
}

/** Only ordinary descendants in the same visibility scope; never traverse databases,
 * hidden branches, trash, or tracking records. Selection is explicit, not automatically expanded.
 */
export function overviewChildren(root:Page,pages:Record<string,Page>):Page[]{
 const byParent=new Map<string,Page[]>()
 for(const p of Object.values(pages))if(p.parentId){const list=byParent.get(p.parentId)??[];list.push(p);byParent.set(p.parentId,list)}
 const seen=new Set([root.id]),out:Page[]=[]
 const walk=(id:string)=>{for(const p of (byParent.get(id)??[]).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id))){
  if(seen.has(p.id))continue;seen.add(p.id)
  if(p.kind!=='page'||p.databaseId||p.trashed||p.hidden||p.overviewFollowUp||!!p.private!==!!root.private)continue
  out.push(p);walk(p.id)
 }}
 walk(root.id);return out
}
export function overviewScope(root:Page,pages:Record<string,Page>,ids:readonly string[]):Page[]{
 const selected=[...new Set(ids.filter(id=>id!==root.id))].sort(),eligible=new Set(overviewChildren(root,pages).map(p=>p.id))
 if(selected.length>30||selected.some(id=>!eligible.has(id)))throw Error('Overview source scope changed')
 return [root,...selected.map(id=>pages[id])]
}
export function overviewScopeSignature(scope:Page[]):string {
 return scope.length===1?overviewSignature(scope[0]):sha256Hex(JSON.stringify(scope.map(p=>[p.id,overviewSignature(p)])))
}
export function currentOverviewSignature(root:Page,pages:Record<string,Page>):string {
 try{return overviewScopeSignature(overviewScope(root,pages,root.overview?.sourcePages?.map(p=>p.id)??[]))}catch{return 'unavailable'}
}
export function overviewScopeSources(scope:Page[]):OverviewSource[]{
 return scope.flatMap((p,index)=>overviewSources(p).map(s=>({...s,id:index===0?s.id:`page:${p.id}:${s.id}`,localId:s.id,pageId:p.id,pageTitle:p.title.slice(0,300)})))
}
export interface OverviewFollowUp {pageId:string;itemId?:string}
export function sanitizeOverviewFollowUp(value:unknown):OverviewFollowUp|undefined {
 const x=value as OverviewFollowUp
 if(!x||typeof x.pageId!=='string'||!x.pageId||x.pageId.length>160||x.itemId!==undefined&&(typeof x.itemId!=='string'||!/^[a-f0-9]{64}$/.test(x.itemId)))return
 return {pageId:x.pageId,...(x.itemId?{itemId:x.itemId}:{})}
}
