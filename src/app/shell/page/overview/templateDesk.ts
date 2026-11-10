import {useWorkspace} from '../../../store/store'
import {useCloud} from '../../../cloud'
import {withWriter} from '../../../store/writer'
import {flushOpenEditors} from '../../../editor'
import {createDesk,saveRecords,stamp,writable,sourcePage} from '../../../features/workbench/actions'
import {sanitizeDeskRecords,type Card,type DeskRecord} from '../../../features/workbench/model'
import {holdOverviewPages} from './sources'
import {currentOverviewSignature,overviewSignature,overviewSources} from './model'
import {templates} from './templates'
/** Copy the accepted overview into an editable desk; source records stay linked. */
export async function createOverviewDesk(pageId:string,present:boolean,signal:AbortSignal){
 const epoch=useWorkspace.getState().epoch,active=JSON.stringify(useCloud.getState().active)
 const original=writable(pageId).overview
 if(!original?.template)throw Error('Choose and adopt a template first.')
 const previous=JSON.stringify(original),release=await holdOverviewPages([pageId,...(original.sourcePages??[]).map(p=>p.id)],signal)
 try{
  signal.throwIfAborted();flushOpenEditors()
  const s=useWorkspace.getState(),page=writable(pageId),de=s.settings.language==='de'
  if(epoch!==s.epoch||active!==JSON.stringify(useCloud.getState().active)||JSON.stringify(page.overview)!==previous||currentOverviewSignature(page,s.pages)!==original.signature)throw Error(de?'Die Quellen haben sich geändert. Aktualisiere zuerst die Vorlage.':'The sources changed. Update the template first.')
  const template=templates[original.template!],sections=['summary',...template.sections.map(s=>s.id)]
  const items=[...original.items].sort((a,b)=>sections.indexOf(a.section!)-sections.indexOf(b.section!))
  const rows=new Map<string,number>()
  const cards:Card[]=items.map(item=>{
   const p=sourcePage(pageId,item.sourcePageId??pageId),block=overviewSources(p).find(b=>(b.id===item.sourceId||b.blockId===item.sourceBlockId||item.sourceId.endsWith(':'+b.id))&&b.text.includes(item.quote))
   if(!block)throw Error(de?'Eine Quellenstelle hat sich geändert.':'A source passage changed.')
   const section=template.sections.find(s=>s.id===item.section),row=rows.get(item.section!)??0;rows.set(item.section!,row+1)
   return {type:'card',id:crypto.randomUUID(),...stamp(),title:item.title,detail:item.detail,source:{kind:'page',pageId:p.id,blockId:block.id,quote:item.quote,signature:overviewSignature(p),label:p.title.slice(0,300)},x:sections.indexOf(item.section!)*280,y:row*280,group:section?(de?section.de:section.en):(de?'Kernaussage':'Main message'),level:1,evidence:'',evidenceUrl:''}
  })
  const records:DeskRecord[]=[...cards,{type:'focus',id:crypto.randomUUID(),...stamp(),dimension:de?template.de:template.en,question:de?template.questionDe:template.questionEn,cards:cards.map(c=>c.id)}]
  if(present)cards.forEach((c,order)=>records.push({type:'slide',id:crypto.randomUUID(),...stamp(),layout:'statement',title:c.title,caption:'',metric:'',cards:[c.id],order}))
  if(Object.keys(sanitizeDeskRecords(Object.fromEntries(records.map(r=>[r.id,r])))).length!==records.length)throw Error('Invalid template contents')
  return withWriter({kind:'you',via:'ui'},()=>{const id=createDesk(pageId,(de?template.de:template.en)+' · '+page.title);saveRecords(id,records);return id})
 }finally{release()}
}
