import type {JSONContent} from '@tiptap/core'
import type {Page} from '../../../store/types'
import {sha256Hex} from '../../../../shared/mcp/sha256.ts'
export const kinds=['summary','finding','decision','action','question'] as const
export type OverviewKind=typeof kinds[number]
export interface OverviewItem {id:string;kind:OverviewKind;title:string;detail:string;role:string;doneWhen:string;options:string[];sourceId:string;quote:string}
export interface PageOverview {version:1;signature:string;at:number;language:'de'|'en';items:OverviewItem[]}
export interface OverviewReview {item:OverviewItem;signature:string;at:number;by:string;state:'confirmed'|'deferred'|'question';note:string;owner:string;taskId?:string}
export interface OverviewSource {id:string;blockId:string|null;index:number;text:string}
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
  && (v.kind!=='action'||!!v.doneWhen.trim())
}
function cleanItem(v:OverviewItem):OverviewItem {
 const {id,kind,title,detail,role,doneWhen,options,sourceId,quote}=v
 return {id,kind,title,detail,role,doneWhen,options:[...options],sourceId,quote}
}
export function parseOverview(raw:string,sources:OverviewSource[],signature:string,language:'de'|'en'):PageOverview {
 const data=JSON.parse(raw),ids=new Set<string>()
 if(!Array.isArray(data.items)||!data.items.length||data.items.length>18)throw Error('Invalid overview')
 const items=data.items.map((v:any)=>{
  const source=sources.find(s=>s.id===v.sourceId)
  const id=sha256Hex(JSON.stringify([v.kind,v.sourceId,v.quote]))
  const item={...v,id}
  if(!itemValue(item)||!v.title.trim()||!v.detail.trim()||v.quote.length<8||!source?.text.includes(v.quote)||v.kind==='action'&&!v.doneWhen.trim()||ids.has(id))throw Error('Overview source check failed')
  ids.add(id);return cleanItem(item)
 })
 if(!items.some((i:OverviewItem)=>i.kind==='summary'))throw Error('Missing overview summary')
 return {version:1,signature,language,at:Date.now(),items}
}
export function sanitizeOverview(v:unknown):PageOverview|undefined {
 const x=v as PageOverview
 if(!x||x.version!==1||!['de','en'].includes(x.language)||typeof x.signature!=='string'||!/^[a-f0-9]{64}$/.test(x.signature)||!Number.isFinite(x.at)||!Array.isArray(x.items)||!x.items.length||x.items.length>18||!x.items.every(itemValue))return
 return {version:1,signature:x.signature,language:x.language,at:x.at,items:x.items.map(cleanItem)}
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
