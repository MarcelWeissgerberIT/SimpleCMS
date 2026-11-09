import {sha256Hex} from '../../../../shared/mcp/sha256'
import {useWorkspace,defaultView} from '../../../store/store'
import type {Page,PropertyDef} from '../../../store/types'
import {withWriter} from '../../../store/writer'
import {isEffectivelyTrashed} from '../../../store/selectors'
import {useCloud} from '../../../cloud'
import {flushOpenEditors} from '../../../editor'
import {currentOverviewSignature,kinds,type OverviewItem} from './model'

export const trackingId=(pageId:string)=>'overview-tracking-'+sha256Hex(pageId).slice(0,24)
export const trackingRowId=(pageId:string,itemId:string)=>'overview-item-'+sha256Hex(JSON.stringify([pageId,itemId])).slice(0,24)
export function trackedRow(pages:Record<string,Page>,pageId:string,itemId:string):Page|undefined {
 const row=pages[trackingRowId(pageId,itemId)]
 return row?.overviewFollowUp?.pageId===pageId&&row.overviewFollowUp.itemId===itemId?row:undefined
}
/** Explicit human selection: ordinary database rows, never a confirmed decision or automatic task. */
export function trackOverviewItems(pageId:string,itemIds:readonly string[]):string {
 flushOpenEditors()
 const s=useWorkspace.getState(),page=s.pages[pageId],de=s.settings.language==='de',cloud=useCloud.getState()
 const fail=(a:string,b:string):never=>{throw Error(de?a:b)}
 if(!page||page.kind!=='page'||page.settings.locked||isEffectivelyTrashed(s.pages,pageId)||cloud.readOnly||cloud.outdated)fail('Die Seite ist nicht bearbeitbar.','This page cannot be edited.')
 if(!page.overview||currentOverviewSignature(page,s.pages)!==page.overview.signature)fail('Aktualisiere zuerst den Überblick.','Update the overview first.')
 const ids=[...new Set(itemIds)],items=ids.map(id=>page.overview!.items.find(i=>i.id===id))
 if(!items.length||items.some(i=>!i))fail('Bitte wähle gültige Karten aus dem aktuellen Überblick.','Select valid cards from the current overview.')
 const dbId=trackingId(pageId),existing=s.pages[dbId]
 if(existing&&(!s.databases[dbId]||existing.kind!=='database'||existing.overviewFollowUp?.pageId!==pageId||existing.overviewFollowUp.itemId))fail('Die Nachverfolgung konnte nicht eindeutig zugeordnet werden.','The follow-up database could not be identified.')
 if(existing&&(isEffectivelyTrashed(s.pages,dbId)||existing.settings.locked||!!existing.private!==!!page.private))fail('Die Nachverfolgung ist gesperrt, im Papierkorb oder hat einen anderen Sichtbarkeitsbereich. Öffne sie und prüfe ihren Stand.','The follow-up database is locked, trashed or has a different visibility scope. Open it to review its state.')
 for(const item of items as OverviewItem[]){
  const row=s.pages[trackingRowId(pageId,item.id)]
  if(row&&!trackedRow(s.pages,pageId,item.id))fail('Ein bestehender Eintrag kann nicht zugeordnet werden.','An existing entry could not be identified.')
 }
 return withWriter({kind:'you',via:'ui'},()=>{
  if(!existing){
   const labels=de?['Zusammenfassung','Erkenntnis','Entscheidung','Schritt','Frage']:['Summary','Finding','Decision','Action','Question']
   const properties:PropertyDef[]=[
    {id:'ov-title',name:de?'Punkt':'Item',type:'title'},
    {id:'ov-status',name:'Status',type:'status',options:[{id:'ov-open',name:de?'Offen':'Open',color:'gray',group:'todo'},{id:'ov-progress',name:de?'In Arbeit':'In progress',color:'blue',group:'in_progress'},{id:'ov-done',name:de?'Erledigt':'Done',color:'green',group:'done'}]},
    {id:'ov-kind',name:de?'Art':'Kind',type:'select',options:kinds.map((id,i)=>({id,name:labels[i],color:'gray'}))},
    {id:'ov-owner',name:de?'Verantwortlich':'Owner',type:'person'},
    {id:'ov-due',name:de?'Fällig':'Due',type:'date'},
    {id:'ov-source',name:de?'Quellseite':'Source page',type:'text'},
    {id:'ov-role',name:de?'Vorgeschlagener Bereich':'Suggested area',type:'text'},
   ]
   s.createDatabase({id:dbId,parentId:pageId,title:de?'Nachverfolgung':'Follow-up',properties,views:[{...defaultView('table',{properties},de?'Alle Punkte':'All items'),id:'ov-table'}]})
   s.updatePage(dbId,{overviewFollowUp:{pageId}})
  }
  const para=(text:string)=>({type:'paragraph',content:[{type:'text',text}]})
  for(const item of items as OverviewItem[]){
   const rowId=trackingRowId(pageId,item.id)
   if(useWorkspace.getState().pages[rowId])continue // Preserve edits, status and even a deliberately trashed row.
   const source=item.sourcePageId??pageId,sourceTitle=item.sourcePageTitle||page.title
   const content={type:'doc',content:[para(item.detail),...(item.options.length?item.options.map(para):[]),...(item.doneWhen?[para((de?'Erledigt, wenn: ':'Done when: ')+item.doneWhen)]:[]),para(de?'Aus dem Überblick ausgewählt. Entscheidungen und nächste Schritte bleiben Vorschläge.':'Selected from the overview. Decisions and next steps remain proposals.'),{type:'paragraph',content:[{type:'text',text:sourceTitle,marks:[{type:'link',attrs:{href:'#/p/'+encodeURIComponent(source)+(item.sourceBlockId?'?b='+encodeURIComponent(item.sourceBlockId):'')}}]}]},para(item.quote)]}
   const db=useWorkspace.getState().databases[dbId]
   const values:Record<string,string>={'ov-status':'ov-open','ov-kind':item.kind,'ov-source':sourceTitle,'ov-role':item.role}
   const properties=Object.fromEntries(Object.entries(values).filter(([id,value])=>db.properties.some(p=>p.id===id&&((p.type==='status'||p.type==='select')?p.options?.some(o=>o.id===value):p.type==='text'))))
   s.createRow(dbId,{id:rowId,title:item.title,content,properties,contentOrigin:'overview'})
   s.updatePage(rowId,{overviewFollowUp:{pageId,itemId:item.id}})
  }
  return dbId
 })
}
