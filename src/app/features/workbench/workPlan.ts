import {validateValue} from '@/shared/quandprofile/program'
import {type Adoption,type DeskRecords} from './model'
import {isWorkTemplate,type WorkTemplate} from './workTemplates'
export type WorkItem={id:string;title:string;detail:string;criterion:string;cards:string[]}
export type WorkPlan={title:string;summary:string;items:WorkItem[]}
const text=(maxLength:number)=>({type:'string',maxLength})
const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties})
export const WORK_PLAN_SCHEMA=object({title:text(160),summary:text(2000),items:{type:'array',maxItems:20,items:object({title:text(160),detail:text(2000),criterion:text(1000),cards:{type:'array',minItems:1,maxItems:20,items:text(160)}})}})
export function parseWorkPlan(raw:string,cardIds:string[]):WorkPlan{
 const data=JSON.parse(raw);validateValue(data,WORK_PLAN_SCHEMA,'work plan')
 const allowed=new Set(cardIds)
 if(!data.title.trim()||data.items.some((r:Omit<WorkItem,'id'>)=>!r.title.trim()||!r.detail.trim()||new Set(r.cards).size!==r.cards.length||r.cards.some(id=>!allowed.has(id))))throw Error('Invalid work plan or source references')
 return {...data,items:data.items.map((r:Omit<WorkItem,'id'>,i:number)=>({...r,id:'item-'+i}))}
}
/** Validate human edits using the same bounds without changing item identity or source attribution. */
export function reviewedWorkItems(plan:WorkPlan,items:WorkItem[],cardIds:string[]):WorkItem[]{
 if(!items.length||items.length>20||new Set(items.map(r=>r.id)).size!==items.length)throw Error('Choose 1–20 items')
 for(const item of items){const original=plan.items.find(r=>r.id===item.id);if(!original||JSON.stringify(item.cards)!==JSON.stringify(original.cards))throw Error('Source attribution changed')}
 parseWorkPlan(JSON.stringify({title:plan.title,summary:plan.summary,items:items.map(({id,...r})=>r)}),cardIds)
 return items
}
export const workOutputId=(draftId:string)=>'work-output-'+draftId
export function workOutputs(records:DeskRecords):Adoption[]{return Object.values(records).filter((r):r is Adoption=>r.type==='adoption'&&r.id===workOutputId(r.analysisId)&&r.index===-1)}
export function workReceipt(after:string):{template:WorkTemplate;title:string}|null{
 try{const x=JSON.parse(after);return isWorkTemplate(x.template)&&typeof x.title==='string'?{template:x.template,title:x.title}:null}catch{return null}
}
