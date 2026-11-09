import type {JSONContent} from '@tiptap/core'
import {useWorkspace} from '../../store/store'
import {deepEqual} from '../../store/merge'
import {useCloud} from '../../cloud'
import {isEffectivelyTrashed} from '../../store/selectors'
import {withWriter,type Writer} from '../../store/writer'
import {flushOpenEditors} from '../../editor'
import {holdOverviewPages} from '../../shell/page/overview/sources'
import {overviewSignature,overviewSources,type OverviewItem} from '../../shell/page/overview/model'
import {sanitizeDeskRecords,cardsOf,basisOf,sourceState,type Card,type CardSource,type DeskRecord,type Decision,type Analysis} from './model'
const fail=(de:string,en:string):never=>{throw Error(useWorkspace.getState().settings.language==='de'?de:en)}
export const stamp=()=>({at:Date.now(),by:(useCloud.getState().user?.name??useWorkspace.getState().settings.userName??'').slice(0,200)})
export function writable(id:string){const s=useWorkspace.getState(),p=s.pages[id];if(!p||isEffectivelyTrashed(s.pages,id)||p.hidden||p.settings.locked||useCloud.getState().readOnly||useCloud.getState().outdated)fail('Die Seite ist nicht mehr bearbeitbar.','This page can no longer be edited.');return p!}
export function sourcePage(deskId:string,id:string){const s=useWorkspace.getState(),p=s.pages[id],desk=s.pages[deskId];if(!p||!desk||isEffectivelyTrashed(s.pages,id)||p.hidden||!!p.private!==!!desk.private)fail('Quelle fehlt oder gehört zu einem anderen Sichtbarkeitsbereich.','The source is unavailable or belongs to a different visibility scope.');return p!}
function prepareRecords(deskId:string,records:DeskRecord[],expected?:Record<string,string>){
 const p=writable(deskId);if(!p.workbench)fail('Kein Denkraum.','Not a thinking desk.')
 const existing=p.workbenchRecords??{}
 for(const [id,before] of Object.entries(expected??{}))if(!deepEqual(sanitizeDeskRecords({[id]:existing[id]}),sanitizeDeskRecords({[id]:JSON.parse(before)})))fail('Dieser Eintrag wurde inzwischen geändert. Bitte erneut öffnen.','This item changed. Please reopen it.')
 const next={...existing,...Object.fromEntries(records.map(r=>[r.id,r]))}
 if(Object.keys(next).length>600||JSON.stringify(next).length>1500000)fail('Dieser Denkraum ist voll. Lege einen weiteren an.','This desk is full. Create another one.')
 if(records.some(r=>!sanitizeDeskRecords({[r.id]:r})[r.id]))fail('Ungültiger Eintrag.','Invalid record.')
 return next
}
export function saveRecords(deskId:string,records:DeskRecord[],expected?:Record<string,string>,writer:Writer={kind:'you',via:'ui'}){
 const next=prepareRecords(deskId,records,expected)
 withWriter(writer,()=>useWorkspace.getState().updatePage(deskId,{workbenchRecords:next}))
}
export function createDesk(parentId:string,title?:string){const p=writable(parentId),s=useWorkspace.getState();return withWriter({kind:'you',via:'ui'},()=>{const id=s.createPage({title:title?.trim()|| (s.settings.language==='de'?'Denkraum · ':'Thinking desk · ')+p.title,parentId});s.updatePage(id,{workbench:true,workbenchRecords:{},icon:{type:'lucide',value:'Layers'},settings:{...useWorkspace.getState().pages[id].settings,fullWidth:true}});return id})}
export function addCard(deskId:string,input:{title:string;detail:string;source:CardSource}){
 const p=writable(deskId);sourcePage(deskId,input.source.pageId)
 const cards=cardsOf(p.workbenchRecords??{});if(cards.length>=100)fail('Maximal 100 Karten pro Denkraum.','At most 100 cards per desk.')
 const existing=cards.find(c=>JSON.stringify(c.source)===JSON.stringify(input.source)&&c.title===input.title);if(existing)return existing.id
 const id=crypto.randomUUID(),n=cards.length
 const card:Card={type:'card',id,...stamp(),...input,x:(n%5)*280,y:Math.floor(n/5)*280,group:'',level:input.source.kind==='note'?0:1,evidence:'',evidenceUrl:''}
 saveRecords(deskId,[card]);return id
}
export async function addOverviewCard(deskId:string,pageId:string,item:OverviewItem,signal:AbortSignal){
 const epoch=useWorkspace.getState().epoch,ids=[pageId,item.sourcePageId??pageId],release=await holdOverviewPages(ids,signal)
 try{signal.throwIfAborted();if(epoch!==useWorkspace.getState().epoch)fail('Arbeitsbereich gewechselt.','Workspace changed.');flushOpenEditors();const p=sourcePage(deskId,item.sourcePageId??pageId),block=overviewSources(p).find(s=>s.text.includes(item.quote)&&(s.id===item.sourceId||s.blockId===item.sourceBlockId||item.sourceId.endsWith(':'+s.id)))
 if(!block)fail('Die Quellenstelle hat sich geändert. Aktualisiere den Überblick.','The source passage changed. Update the overview.')
 return addCard(deskId,{title:item.title,detail:item.detail,source:{kind:'page',pageId:p.id,blockId:block!.id,quote:item.quote,signature:overviewSignature(p),label:p.title.slice(0,300)}})
 }finally{release()}
}
export async function readAttachment(pageId:string,fileId:string,signal:AbortSignal){
 const {pageFiles}=await import('../ai/agent/documentTools'),{fileData,FILE_READ_MAX,isPdfBytes}=await import('../ai/file/load'),{fileKind}=await import('../ai/file/kinds')
 const p=useWorkspace.getState().pages[pageId],f=pageFiles(p?.content??null).find(f=>f.file_id===fileId);if(!f)fail('Datei nicht verfügbar.','File unavailable.')
 const {bytes}=await fileData(f!.src,FILE_READ_MAX,signal);signal.throwIfAborted()
 let text:string
 if(isPdfBytes(bytes)){const r=await (await import('../ai/local-coder/pdf')).pdfText(bytes,200000);if(r.issue)fail('Die Datei konnte nicht vollständig gelesen werden: '+r.issue,'The file could not be read completely: '+r.issue);text=r.text}
 else{const kind=fileKind(f!.name);if(!kind)fail('Dieses Dateiformat wird nicht unterstützt.','Unsupported file format.');text=(await (await import('../ai/file/convert')).fileText(kind!,bytes,f!.name)).text}
 signal.throwIfAborted();if(!text.trim()||text.length>200000)fail('Kein vollständiger Text verfügbar oder Datei zu groß. Verwende einen kleineren Textauszug.','No complete text available or file too large. Use a smaller excerpt.')
 return {text,name:f!.name,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))).map(b=>b.toString(16).padStart(2,'0')).join('')}
}
export function recordDecision(deskId:string,cardIds:string[],text:string,resolveIds:string[]=[]){
 const p=writable(deskId),records=p.workbenchRecords??{},cards=cardsOf(records).filter(c=>cardIds.includes(c.id))
 if(!text.trim()||!cards.length)fail('Entscheidung und Karten auswählen.','Enter a decision and select cards.')
 if(cards.some(c=>sourceState(c,useWorkspace.getState().pages)!=='current'))fail('Prüfe zuerst die geänderten Quellen.','Review changed sources first.')
 const decision:Decision={type:'decision',id:crypto.randomUUID(),...stamp(),text:text.trim(),cards:cards.map(c=>c.id),basis:basisOf(cards)}
 const links=resolveIds.map(id=>records[id]).filter(r=>r?.type==='link'&&cards.some(c=>c.id===r.a)&&cards.some(c=>c.id===r.b)).map(r=>({...r,resolution:decision.id,...stamp()}))
 saveRecords(deskId,[decision,...links]);return decision
}
/** Only one exact, current text-node match. Never flatten rich text or overwrite a changed document. */
export function replaceExact(doc:JSONContent,before:string,after:string):JSONContent{
 const next=structuredClone(doc),matches:JSONContent[]=[]
 const visit=(n:JSONContent)=>{if(n.type==='text'&&n.text?.includes(before))matches.push(n);n.content?.forEach(visit)};visit(next)
 if(!before||!after.trim()||matches.length!==1||matches[0].text!.split(before).length!==2)fail('Die Stelle ist nicht eindeutig oder enthält Formatgrenzen. Bitte im Dokument bearbeiten.','The passage is ambiguous or spans formatting boundaries. Edit it in the document.')
 matches[0].text=matches[0].text!.replace(before,()=>after);return next
}
export async function applyPatch(deskId:string,analysisId:string,index:number,signal:AbortSignal){
 const p=writable(deskId),analysis=p.workbenchRecords?.[analysisId]
 if(analysis?.type!=='analysis'||analysis.mode!=='impact'||!analysis.decisionId||p.workbenchRecords?.[analysis.decisionId]?.type!=='decision')fail('Eine bestätigte Entscheidung ist erforderlich.','A confirmed decision is required.')
 const a=analysis as Analysis,patch=a.patches[index],card=p.workbenchRecords?.[patch?.card]
 if(!patch||card?.type!=='card'||card.source.kind!=='page')fail('Diese Änderung muss in der Originalquelle vorgenommen werden.','Apply this change in the original source.')
 const c=card as Card,key='apply-'+analysisId+'-'+index
 if(p.workbenchRecords?.[key])return
 const epoch=useWorkspace.getState().epoch,release=await holdOverviewPages([c.source.pageId],signal)
 try{signal.throwIfAborted();flushOpenEditors();const current=writable(deskId),target=writable(c.source.pageId);sourcePage(deskId,c.source.pageId)
 if(epoch!==useWorkspace.getState().epoch||basisOf(cardsOf(current.workbenchRecords??{}).filter(card=>a.cards.includes(card.id)))!==a.basis||JSON.stringify(current.workbenchRecords?.[analysisId])!==JSON.stringify(a)||JSON.stringify(current.workbenchRecords?.[c.id])!==JSON.stringify(c)||sourceState(c,useWorkspace.getState().pages)!=='current')fail('Quelle oder Vorschlag geändert. Bitte neu prüfen.','Source or proposal changed. Review again.')
 if(!c.source.quote.includes(patch.before))fail('Die Änderung gehört nicht zur ausgewählten Quellenstelle.','The change is outside the selected source passage.')
 const next=replaceExact(target.content!,patch.before,patch.after)
 const adoption:DeskRecord={type:'adoption',id:key,...stamp(),analysisId,index,pageId:target.id,after:patch.after}
 prepareRecords(deskId,[adoption])
 withWriter({kind:'you',via:'ui'},()=>{
  useWorkspace.getState().setContent(target.id,next,'workbench')
  saveRecords(deskId,[adoption])
 })
 }finally{release()}
}
export function saveScenarioPlan(deskId:string,analysisId:string){
 const p=writable(deskId),a=p.workbenchRecords?.[analysisId],key='plan-'+analysisId
 if(a?.type!=='analysis'||a.mode!=='scenario')fail('Kein Szenario.','Not a scenario.')
 const previous=p.workbenchRecords?.[key];if(previous?.type==='adoption')return previous.pageId
 const analysis=a as Analysis,selected=cardsOf(p.workbenchRecords??{}).filter(c=>analysis.cards.includes(c.id))
 if(basisOf(selected)!==analysis.basis||selected.some(c=>sourceState(c,useWorkspace.getState().pages)!=='current'))fail('Szenariogrundlage geändert. Bitte neu prüfen.','Scenario sources changed. Review again.')
 prepareRecords(deskId,[{type:'adoption',id:key,...stamp(),analysisId,index:-1,pageId:'pending',after:analysis.question}])
 const para=(text:string)=>({type:'paragraph',content:[{type:'text',text}]})
 return withWriter({kind:'you',via:'ui'},()=>{const s=useWorkspace.getState(),id=s.createPage({title:(s.settings.language==='de'?'Szenario · ':'Scenario · ')+analysis.question.slice(0,160),parentId:deskId});s.setContent(id,{type:'doc',content:[para('Szenario / Scenario: '+analysis.question),para(analysis.summary),para('Vorläufige Annahme · Provisional assumption'),...analysis.findings.map(f=>para(f.text)),...(analysis.tasks.length?[{type:'taskList',content:analysis.tasks.map(f=>({type:'taskItem',attrs:{checked:false,itemId:crypto.randomUUID()},content:[para(f.text)]}))}]:[]),{type:'paragraph',content:[{type:'text',text:'Denkraum / Thinking desk',marks:[{type:'link',attrs:{href:'#/p/'+deskId}}]}]}]},'workbench');saveRecords(deskId,[{type:'adoption',id:key,...stamp(),analysisId,index:-1,pageId:id,after:analysis.question}]);return id})
}
export function trackCard(deskId:string,cardId:string){const p=writable(deskId),card=p.workbenchRecords?.[cardId];if(card?.type!=='card')return
 if(card.taskId&&useWorkspace.getState().pages[card.taskId])return card.taskId
 prepareRecords(deskId,[{...card,...stamp(),taskId:'pending'}])
 return withWriter({kind:'you',via:'ui'},()=>{const s=useWorkspace.getState(),id=s.createPage({title:card.title,parentId:deskId}),para=(text:string)=>({type:'paragraph',content:[{type:'text',text}]})
 s.setContent(id,{type:'doc',content:[{type:'taskList',content:[{type:'taskItem',attrs:{checked:false,itemId:crypto.randomUUID()},content:[para(card.title)]}]},para(card.detail),{type:'paragraph',content:[{type:'text',text:card.source.label,marks:[{type:'link',attrs:{href:'#/p/'+card.source.pageId}}]}]}]},'workbench');saveRecords(deskId,[{...card,...stamp(),taskId:id}]);return id})
}
export async function refreshCard(deskId:string,cardId:string,signal:AbortSignal){
 const board=writable(deskId),card=board.workbenchRecords?.[cardId];if(card?.type!=='card')return
 const epoch=useWorkspace.getState().epoch,release=await holdOverviewPages([card.source.pageId],signal)
 try{signal.throwIfAborted();const p=sourcePage(deskId,card.source.pageId);let source={...card.source,signature:overviewSignature(p)}
 if(source.kind==='page'&&!overviewSources(p).some(b=>b.id===source.blockId&&b.text.includes(source.quote)))fail('Der Auszug ist nicht mehr vorhanden. Füge die aktuelle Stelle als neue Karte hinzu.','The excerpt is no longer present. Add the current passage as a new card.')
 if(source.kind==='file'){const file=await readAttachment(p.id,source.fileId!,signal);if(!file.text.includes(source.quote))fail('Der Dateiauszug wurde geändert. Wähle einen neuen Auszug.','The file excerpt changed. Select a new excerpt.');source.fileHash=file.hash}
 if(source.kind==='code'){const {codeReference}=await import('@/shared/mcp/codeReference');const block=overviewSources(p).find(b=>b.id===source.blockId),ref=block&&codeReference(block.text);if(!ref||JSON.stringify(ref.citation)!==JSON.stringify(source.code?.citation))fail('Der Code-Beleg wurde geändert. Füge ihn erneut hinzu.','The code reference changed. Add it again.')}
 signal.throwIfAborted();if(epoch!==useWorkspace.getState().epoch)fail('Arbeitsbereich gewechselt.','Workspace changed.')
 saveRecords(deskId,[{...card,...stamp(),source,level:source.kind==='note'?0:1,evidence:'',evidenceUrl:'',assessment:undefined}],{[cardId]:JSON.stringify(card)})
 }finally{release()}
}
