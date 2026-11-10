import type {Page} from '../../store/types'
import {sha256Hex} from '@/shared/mcp/sha256'
import {overviewSources,overviewSignature} from '../../shell/page/overview/model'
import {codeReference,type CodeReference} from '@/shared/mcp/codeReference'
export const levels=['Vermutung','Quelle vorhanden','Im Code geprüft','Getestet','Freigegeben']
export const levelsEn=['Assumption','Source available','Code reviewed','Tested','Approved']
export type CardSource={kind:'page'|'file'|'code'|'note';pageId:string;blockId:string;quote:string;signature:string;label:string;fileId?:string;fileHash?:string;code?:CodeReference}
export type Stamp={at:number;by:string}
export type Card=Stamp&{type:'card';id:string;title:string;detail:string;source:CardSource;x:number;y:number;group:string;level:number;evidence:string;evidenceUrl:string;removed?:boolean;taskId?:string;assessment?:Stamp}
export type Link=Stamp&{type:'link';id:string;a:string;b:string;relation:'conflict'|'supports'|'depends';detail:string;resolution?:string;removed?:boolean}
export type Decision=Stamp&{type:'decision';id:string;text:string;cards:string[];basis:string}
export type Finding={text:string;cards:string[]}
export type Patch={card:string;before:string;after:string;reason:string}
export type Analysis=Stamp&{type:'analysis';id:string;mode:'compare'|'impact'|'scenario';question:string;cards:string[];basis:string;summary:string;findings:Finding[];conflicts:{a:string;b:string;reason:string}[];patches:Patch[];tasks:Finding[];decisionId?:string}
export type Adoption=Stamp&{type:'adoption';id:string;analysisId:string;index:number;pageId:string;after:string}
export type Focus=Stamp&{type:'focus';id:string;dimension:string;question:string;cards:string[]}
export const slideLayouts=['statement','metric','compare','timeline','quote','decision'] as const
export type SlideLayout=typeof slideLayouts[number]
export type StoryFrame=Stamp&{type:'slide';id:string;layout:SlideLayout;title:string;caption:string;metric:string;cards:string[];order:number;content?:{card:string;title?:string;text:string}[];generated?:boolean;removed?:boolean}
export type DeskRecord=StoryFrame|Card|Link|Decision|Analysis|Adoption|Focus
export type DeskRecords=Record<string,DeskRecord>
/** A usable source must stay inside the desk's scope all the way to its root. */
export function deskSourceVisible(pages:Record<string,Page>,deskId:string,sourceId:string):boolean{
 const desk=pages[deskId];if(!desk)return false
 const seen=new Set<string>();let current:Page|undefined=pages[sourceId]
 if(!current)return false
 while(current){
  if(seen.has(current.id)||current.hidden||current.trashed||current.template||!!current.private!==!!desk.private)return false
  seen.add(current.id)
  if(current.parentId&&!pages[current.parentId])return false
  current=current.parentId?pages[current.parentId]:undefined
 }
 return true
}
const obj=(x:unknown):x is Record<string,any>=>!!x&&typeof x==='object'&&!Array.isArray(x)
const str=(x:unknown,max=6000)=>typeof x==='string'&&x.length<=max
const ids=(x:unknown,max=30):x is string[]=>Array.isArray(x)&&x.length<=max&&x.every(v=>str(v,160))
export function safeEvidenceUrl(value:string){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:''}catch{return value.startsWith('#/p/')?value:''}}
export function sanitizeDeskRecords(value:unknown):DeskRecords{
 const out:DeskRecords={};if(!obj(value))return out
 for(const [id,r] of Object.entries(value).slice(0,1000)){
  if(!/^[a-zA-Z0-9-]{1,160}$/.test(id)||!obj(r)||r.id!==id||!str(r.by,200)||!Number.isFinite(r.at))continue
  const base={id,at:r.at,by:r.by}
  if(r.type==='card'){
   const s=r.source;if(!obj(s)||!['page','file','code','note'].includes(s.kind)||!str(s.pageId,160)||!str(s.blockId,160)||!str(s.quote,12000)||!str(s.signature,64)||!str(s.label,300)||!str(r.title,300)||!str(r.detail,12000)||!str(r.group,100)||!str(r.evidence,2000)||!str(r.evidenceUrl,2000)||!Number.isInteger(r.level)||r.level<0||r.level>4||![r.x,r.y].every(n=>Number.isFinite(n)&&n>=0&&n<=10000))continue
   const code=s.code?codeReference(JSON.stringify(s.code)):undefined
   if(s.kind==='code'&&!code||s.kind==='file'&&(!str(s.fileId,160)||!str(s.fileHash,64)))continue
   out[id]={...base,type:'card',title:r.title,detail:r.detail,source:{kind:s.kind,pageId:s.pageId,blockId:s.blockId,quote:s.quote,signature:s.signature,label:s.label,...(code?{code}:{}),...(s.kind==='file'?{fileId:s.fileId,fileHash:s.fileHash}:{})},x:r.x,y:r.y,group:r.group,level:s.kind==='note'?0:r.level,evidence:r.evidence,evidenceUrl:safeEvidenceUrl(r.evidenceUrl),...(r.removed===true?{removed:true}:{}),...(str(r.taskId,160)?{taskId:r.taskId}:{}),...(obj(r.assessment)&&Number.isFinite(r.assessment.at)&&str(r.assessment.by,200)?{assessment:{at:r.assessment.at,by:r.assessment.by}}:{})}
  }else if(r.type==='link'&&str(r.a,160)&&str(r.b,160)&&r.a!==r.b&&['conflict','supports','depends'].includes(r.relation)&&str(r.detail,2000))out[id]={...base,type:'link',a:r.a,b:r.b,relation:r.relation,detail:r.detail,...(str(r.resolution,160)?{resolution:r.resolution}:{}),...(r.removed===true?{removed:true}:{})}
  else if(r.type==='slide'&&slideLayouts.includes(r.layout)&&str(r.title,180)&&str(r.caption,800)&&str(r.metric,40)&&ids(r.cards,r.layout==='compare'?2:r.layout==='timeline'?4:r.layout==='decision'?3:1)&&new Set(r.cards).size===r.cards.length&&(r.content===undefined||Array.isArray(r.content)&&r.content.length<=r.cards.length&&r.content.every((c:any)=>obj(c)&&r.cards.includes(c.card)&&(c.title===undefined||str(c.title,100))&&str(c.text,600))&&new Set(r.content.map((c:any)=>c.card)).size===r.content.length)&&Number.isFinite(r.order)&&r.order>=0&&r.order<=10000)out[id]={...base,type:'slide',layout:r.layout,title:r.title,caption:r.caption,metric:r.metric,cards:r.cards,order:r.order,...(r.content?{content:r.content.map((c:any)=>({card:c.card,...(c.title!==undefined?{title:c.title}:{}),text:c.text}))}:{}),...(r.generated===true?{generated:true}:{}),...(r.removed===true?{removed:true}:{})}
  else if(r.type==='focus'&&str(r.dimension,100)&&str(r.question,6000)&&r.question.trim()&&ids(r.cards,20)&&r.cards.length>0)out[id]={...base,type:'focus',dimension:r.dimension,question:r.question,cards:r.cards}
  else if(r.type==='decision'&&str(r.text,6000)&&ids(r.cards)&&str(r.basis,64))out[id]={...base,type:'decision',text:r.text,cards:r.cards,basis:r.basis}
  else if(r.type==='adoption'&&str(r.analysisId,160)&&Number.isInteger(r.index)&&r.index>=-1&&str(r.pageId,160)&&str(r.after,12000))out[id]={...base,type:'adoption',analysisId:r.analysisId,index:r.index,pageId:r.pageId,after:r.after}
  else if(r.type==='analysis'&&['compare','impact','scenario'].includes(r.mode)&&str(r.question,6000)&&ids(r.cards)&&str(r.basis,64)&&str(r.summary,4000)&&Array.isArray(r.findings)&&r.findings.length<=20&&r.findings.every((f:any)=>obj(f)&&str(f.text,2000)&&ids(f.cards))&&Array.isArray(r.tasks)&&r.tasks.length<=20&&r.tasks.every((f:any)=>obj(f)&&str(f.text,2000)&&ids(f.cards))&&Array.isArray(r.conflicts)&&r.conflicts.length<=20&&r.conflicts.every((f:any)=>obj(f)&&str(f.a,160)&&str(f.b,160)&&str(f.reason,2000))&&Array.isArray(r.patches)&&r.patches.length<=20&&r.patches.every((f:any)=>obj(f)&&str(f.card,160)&&str(f.before,12000)&&str(f.after,12000)&&str(f.reason,2000)))out[id]={...base,type:'analysis',mode:r.mode,question:r.question,cards:r.cards,basis:r.basis,summary:r.summary,findings:r.findings.map((f:any)=>({text:f.text,cards:f.cards})),tasks:r.tasks.map((f:any)=>({text:f.text,cards:f.cards})),conflicts:r.conflicts.map((f:any)=>({a:f.a,b:f.b,reason:f.reason})),patches:r.patches.map((f:any)=>({card:f.card,before:f.before,after:f.after,reason:f.reason})),...(str(r.decisionId,160)?{decisionId:r.decisionId}:{})}
 }
 return out
}
export const cardsOf=(records:DeskRecords)=>Object.values(records).filter((r):r is Card=>r.type==='card'&&!r.removed)
export const basisOf=(cards:Card[])=>sha256Hex(JSON.stringify(cards.map(c=>(sanitizeDeskRecords({[c.id]:c})[c.id]??c) as Card).map(c=>[c.id,c.title,c.detail,c.source,c.level,c.evidence,c.evidenceUrl]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))))
export function sourceState(card:Card,pages:Record<string,Page>):'current'|'changed'|'unavailable'{
 const s=card.source,p=pages[s.pageId]
 if(!p||p.trashed||p.hidden)return 'unavailable'
 if(s.kind==='note')return 'current'
 if(!p.content)return 'unavailable'
 if(overviewSignature(p)!==s.signature)return 'changed'
 if(s.kind==='page'&&!overviewSources(p).some(b=>b.id===s.blockId&&b.text.includes(s.quote)))return 'changed'
 return 'current'
}
export function sourceHref(card:Card){return '#/p/'+encodeURIComponent(card.source.pageId)+(card.source.blockId&&!card.source.blockId.startsWith('block:')?'?b='+encodeURIComponent(card.source.blockId):'')}

/** A resolution remains current only while all decision sources and cards still match. */
export function resolutionCurrent(link:Link,records:DeskRecords,pages:Record<string,Page>){
 const d=link.resolution?records[link.resolution]:undefined
 if(d?.type!=='decision')return false
 const cards=cardsOf(records).filter(c=>d.cards.includes(c.id))
 return cards.length===d.cards.length&&basisOf(cards)===d.basis&&cards.every(c=>sourceState(c,pages)==='current')
}
