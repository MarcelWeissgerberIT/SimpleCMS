import type {JSONContent} from '@tiptap/core'
import type {PropertyDef} from '../../store/types'
import {sourceHref,type Card} from './model'
import type {WorkItem} from './workPlan'
import {workTemplates,type WorkTemplate} from './workTemplates'

export function workProperties(template:WorkTemplate,de:boolean):PropertyDef[]{
 const t=workTemplates(de).find(t=>t.id===template)!
 return [
  {id:'work-title',name:template==='tasks'?(de?'Aufgabe':'Task'):template==='questions'?(de?'Frage':'Question'):template==='checks'?(de?'Prüfpunkt':'Check'):(de?'Entscheidungsfrage':'Decision question'),type:'title'},
  {id:'work-status',name:'Status',type:'status',options:t.statuses.map((name,i)=>({id:['work-open','work-progress','work-done'][i],name,color:(['gray','blue','green'] as const)[i],group:(['todo','in_progress','done'] as const)[i]}))},
  {id:'work-owner',name:de?'Verantwortlich':'Owner',type:'person'},
  {id:'work-due',name:de?'Fällig':'Due',type:'date'},
  {id:'work-detail',name:de?'Hintergrund':'Context',type:'text'},
  {id:'work-criterion',name:t.criterion,type:'text'},
  {id:'work-response',name:template==='questions'?(de?'Antwort':'Answer'):template==='decisions'?(de?'Beschluss':'Decision'):(de?'Ergebnis':'Result'),type:'text'},
  {id:'work-sources',name:de?'Quellen':'Sources',type:'text'},
  {id:'work-count',name:de?'Quellkarten':'Source cards',type:'number'}
 ]
}
const paragraph=(text:string):JSONContent=>({type:'paragraph',content:text?[{type:'text',text}]:[]})
const link=(label:string,href:string):JSONContent=>({type:'paragraph',content:[{type:'text',text:label,marks:[{type:'link',attrs:{href}}]}]})
export function workRow(item:WorkItem,cards:Card[],deskId:string,goal:string,template:WorkTemplate,de:boolean){
 const sources=item.cards.map(id=>cards.find(c=>c.id===id)!)
 if(sources.some(c=>!c))throw Error('Missing source card')
 const t=workTemplates(de).find(t=>t.id===template)!
 return {title:item.title,properties:{'work-status':'work-open','work-detail':item.detail,'work-criterion':item.criterion,'work-sources':[...new Set(sources.map(c=>c.source.label))].join(' · '),'work-count':sources.length},content:{type:'doc',content:[
  paragraph(item.detail),...(item.criterion?[paragraph(t.criterion+': '+item.criterion)]:[]),
  paragraph((de?'Arbeitsfokus: ':'Work focus: ')+goal),
  paragraph(de?'Aus einem geprüften KI-Entwurf übernommen. Aufgabe, Prüfkriterium oder Entscheidung sind Vorschläge; Ergebnis und Verantwortung werden im Arbeitsprozess ergänzt.':'Adopted from a reviewed AI draft. The action, criterion or decision remains a proposal; outcomes and ownership are recorded during the work.'),
  link(de?'Zum Denkraum':'Back to thinking desk','#/p/'+encodeURIComponent(deskId)+'?desk=work'),
  ...sources.flatMap(c=>[
   {type:'heading',attrs:{level:3},content:[{type:'text',text:c.title}]},
   link(c.source.label,sourceHref(c)),
   paragraph(de?(c.source.kind==='note'?'Eigene Aussage / Annahme':'Gesammelter Quellauszug'):(c.source.kind==='note'?'Own statement / assumption':'Collected source excerpt')),
   {type:'blockquote',content:[paragraph(c.source.quote)]},
   ...(c.detail!==c.source.quote?[paragraph((de?'Einordnung der Karte: ':'Card interpretation: ')+c.detail)]:[])
  ])
 ]} as JSONContent}
}
