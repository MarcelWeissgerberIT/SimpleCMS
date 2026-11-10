import type {Route,DataClass,SourceRef} from '@/shared/ai/types'
import {useWorkspace} from '../../store/store'
import {useCloud} from '../../cloud'
import {flushOpenEditors} from '../../editor'
import {holdOverviewPages} from '../../shell/page/overview/sources'
import {precheck} from '../ai/core/gate'
import {sourcePage,writable,readAttachment} from './actions'
import {basisOf,sourceState,sanitizeDeskRecords,type Card} from './model'

/** Shared source boundary for analysis, slides and working databases. Always release the held pages. */
export async function prepareDeskMaterial(deskId:string,ids:string[],route:Route|null,signal:AbortSignal,progress:(text:string)=>void){
 const start=useWorkspace.getState(),epoch=start.epoch,active=JSON.stringify(useCloud.getState().active),de=start.settings.language==='de'
 const fail=(a:string,b:string):never=>{throw Error(de?a:b)}
 const check=()=>{
  signal.throwIfAborted()
  if(epoch!==useWorkspace.getState().epoch||active!==JSON.stringify(useCloud.getState().active))fail('Arbeitsbereich gewechselt.','Workspace changed.')
  const p=writable(deskId);if(!p.workbench)fail('Kein Denkraum.','Not a thinking desk.')
  return p
 }
 const records=sanitizeDeskRecords(check().workbenchRecords),cards=ids.map(id=>records[id]).filter((r):r is Card=>r?.type==='card'&&!r.removed)
 if(!cards.length||cards.length>20||cards.length!==ids.length||new Set(ids).size!==ids.length)fail('Wähle 1 bis 20 Karten.','Select 1–20 cards.')
 const refs:SourceRef[]=[{page:deskId},...[...new Set(cards.map(c=>c.source.pageId))].map(page=>({page}))]
 const carries:DataClass[]=[...(cards.some(c=>c.source.kind==='file')?['files' as const]:[]),...(cards.some(c=>c.source.kind==='code')?['mcp' as const]:[])]
 const gate=()=>{
  const pre=precheck({purpose:'workbench.analyze',sources:refs,carries,route})
  if(refs.some(r=>'page'in r&&!pre.visible(r.page))||pre.redact.people||pre.redact.transcript)fail('Die Datenregeln erlauben diese vollständige Auswertung nicht.','Data rules do not permit this complete analysis.')
  return pre
 }
 gate();flushOpenEditors();cards.forEach(c=>sourcePage(deskId,c.source.pageId))
 progress(de?'Quellen laden …':'Loading sources …')
 const release=await holdOverviewPages(cards.map(c=>c.source.pageId),signal)
 try{
  check();const basis=basisOf(cards)
  const validate=()=>{
   flushOpenEditors();const current=check();gate()
   const nowRecords=sanitizeDeskRecords(current.workbenchRecords),now=ids.map(id=>nowRecords[id]).filter((r):r is Card=>r?.type==='card'&&!r.removed)
   cards.forEach(c=>sourcePage(deskId,c.source.pageId))
   if(now.length!==cards.length||basisOf(now)!==basis||cards.some(c=>sourceState(c,useWorkspace.getState().pages)!=='current'))fail('Eine Quelle oder Karte wurde während der Erstellung geändert. Bitte erneut prüfen.','A source changed during generation, or a card changed. Please review again.')
   return current
  }
  validate()
  const material=[]
  for(const c of cards){
   let text=c.source.quote
   if(c.source.kind==='file'){
    progress(de?'Dateiauszug abgleichen …':'Checking attachment excerpt …')
    const f=await readAttachment(c.source.pageId,c.source.fileId!,signal);validate()
    if(f.hash!==c.source.fileHash||!f.text.includes(c.source.quote))fail('Der Dateiauszug hat sich geändert.','The attachment excerpt changed.')
   }
   if(c.source.kind==='code'){
    progress(de?'Code-Beleg in Atlas prüfen …':'Checking code evidence in Atlas …');gate()
    const ref=c.source.code!;if(!ref.server)fail('Dem Code-Beleg fehlt die Atlas-Verbindung.','The code reference needs an Atlas connection.')
    const result=await (await import('../code-evidence/load')).loadCodeEvidence(ref,ref.server!,false,signal,()=>{},true);validate();text=result.lines.join('\n')
    if(text.length>12000)fail('Der Code-Auszug ist zu groß. Wähle weniger Zeilen.','The code excerpt is too large. Select fewer lines.')
   }
   material.push({id:c.id,title:c.title,detail:c.detail,kind:c.source.kind,source:c.source.label,text,assessment:c.level,evidence:c.evidence})
  }
  validate()
  return {cards,material,refs,carries,basis,epoch,active,de,gate,validate,release}
 }catch(e){release();throw e}
}
