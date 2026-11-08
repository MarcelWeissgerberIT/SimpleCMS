import type {BlockLocation} from '../../../lib/blockLocation'
import type {JSONContent} from '@tiptap/core'
import {readAnalysis,type Analysis,type Revision} from '@/shared/codeAnalysis/model'
import {readChange} from '@/shared/codeChange/model'
import {currentMockSourceCheck} from '@/shared/ai/mockReview'
import {mockBlockData} from '@/shared/ai/mockBlock'
import {codeReference,type CodeReference} from '@/shared/mcp/codeReference'
export type WorkKind='review'|'note'|'markdown'|'failed'|'finding'|'stale'
export interface WorkItem {location?:BlockLocation;id:string;page:string;block?:string;kind:WorkKind;title:string;detail:string}
export interface SourceLink {key:string;title:string;version?:string;changed?:boolean}
export interface Trace {location?:BlockLocation;sources?:SourceLink[];id:string;page:string;block?:string;title:string;detail:string;gap?:string;references:CodeReference[];checkedAt?:number}
export interface RecipeSource {page:string;block?:string;analysis:Analysis;revision:Revision}
/** Saved facts only. No network, model call or inferred cross-document relationship. */
export function inventory(pages:Array<{id:string;title:string;content:JSONContent|null}>,de:boolean){
 const work:WorkItem[]=[],completed:WorkItem[]=[],traces:Trace[]=[],recipes:RecipeSource[]=[]
 const say=(a:string,b:string)=>de?a:b
 let visited=0,limited=false
 const visit=(n:JSONContent,page:string,depth=0)=>{
  if(depth>40||visited++>=50000){limited=true;return}
  const block=typeof n.attrs?.id==='string'?n.attrs.id:undefined,id=page+':'+(block??visited)
  const add=(kind:WorkKind,title:string,detail='',location?:BlockLocation)=>work.push({id:id+':'+kind+':'+work.length,page,block,kind,title,detail,location})
  const done=(title:string,detail:string,location?:BlockLocation)=>completed.push({id:id+':done',page,block,kind:'review',title,detail,location})
  const raw=n.type==='codeBlock'?(n.content??[]).map(c=>c.text??'').join(''):''
  try{
   if(n.type==='designMock'){
    const m=mockBlockData(n.attrs?.spec),title=m.preview?.title||say('Mock','Mock')
    if(currentMockSourceCheck(m)?.rows.some(r=>r.changed))add('stale',title,say('Designquellen geändert – im Atlas-Tab gezielte Aktualisierung vormerken','Design sources changed — queue a targeted update in the Atlas tab'),{view:'atlas'})
    for(const note of m.journal?.notes??[]){
     if(!note.resolved)add('note',note.text,title,{view:'feedback',item:note.id})
     if(note.md==='pending')add('markdown',note.text,title+' · '+say('Designsystem-Änderung vorgemerkt','Design system change pending'),{view:'feedback',item:note.id})
    }
    for(const p of m.journal?.proposals??[])if(p.status==='pending')add('review',p.preview.title,say('Mock-Vorschlag vergleichen und annehmen oder verwerfen','Compare and accept or reject mock proposal'),{view:'proposal',item:p.id})
    if(m.preview)done(title,say('Mock-Vorschau auf der Seite gespeichert','Mock preview saved on page'),{view:'mock'})
    traces.push({id,page,block,title,location:{view:'atlas'},sources:(m.preview?.provenance?.sources??[]).map(s=>({key:'atlas:'+s.server+':'+s.url,title:s.title,version:s.hash.slice(0,12),changed:currentMockSourceCheck(m)?.rows.some(r=>r.ref===s.ref&&r.changed)})),detail:[m.requirement,m.source].filter(Boolean).join(' · '),gap:!m.requirement?say('Keine Anforderung am Mock hinterlegt','No requirement linked to this mock'):undefined,references:[]})
   }
   if(n.type==='codeBlock'&&n.attrs?.language==='code-analysis'&&raw!=='{}'&&raw.length<1000000){
    const a=readAnalysis(raw),latest=a.revisions.at(-1),active=a.revisions.find(r=>r.id===a.active)
    if(active)done(a.question,say('Analyse in One angenommen','Analysis accepted in One'),{view:'overview',revision:active.id})
    if(latest){
     const location={view:'overview',revision:latest.id}
     if(['failed','paused'].includes(latest.state))add('failed',a.question,latest.error,location)
     if(latest.state==='ready')add('review',a.question,say('Analyse wartet auf Annahme','Analysis awaiting acceptance'),{...location,view:'versions'})
    }
    // A failed or unfinished successor must not hide unresolved findings in the accepted report.
    for(const r of a.revisions.filter(r=>r.id===a.active||r.id===latest?.id)){
     const version='V'+(a.revisions.indexOf(r)+1)+' · '+(r.id===a.active?say('Angenommen','Accepted'):say('Vorschlag','Proposal'))
     for(const f of r.report.findings){
      const location={view:'findings',revision:r.id,item:f.id}
      if(f.status==='open')add('finding',f.title,version+' · '+a.question,location)
      const ids=[...f.support,...f.against],es=ids.flatMap(id=>r.report.evidence.filter(e=>e.id===id))
      const review=r.reviews?.find(x=>x.finding===f.id)
      if(r.sourceChecks?.some(c=>ids.includes(c.evidence)&&c.state==='different'))add('stale',f.title,version+' · '+say('Anderer Atlas-Snapshot – Finding gezielt nachprüfen','Different Atlas snapshot — recheck this finding'),location)
      const reqs=r.report.requirements.filter(q=>review?.requirements.includes(q.id)||[...q.implementation,...q.tests].some(e=>ids.includes(e)))
      const missing=ids.filter(id=>!r.report.evidence.some(e=>e.id===id))
      traces.push({id:id+':'+r.id+':'+f.id,page,block,location,title:f.title,detail:[version,f.claim,...reqs.map(q=>say('Anforderung: ','Requirement: ')+q.text)].join('\n'),references:es.map(e=>e.reference),checkedAt:es.length?Math.min(...es.map(e=>e.checkedAt)):undefined,gap:!es.length||missing.length?say('Quellcode-Beleg fehlt oder ist nicht auflösbar','Source evidence missing or unresolved'):!reqs.length?say('Keine Anforderung mit gemeinsamem Beleg verknüpft','No requirement linked through shared evidence'):undefined})
     }
     for(const q of r.report.requirements)if(q.gap||![...q.implementation,...q.tests].length)traces.push({id:id+':'+r.id+':req:'+q.id,page,block,location:{view:'requirements',revision:r.id,item:q.id},title:q.text,detail:version+' · '+say('Anforderungsabdeckung','Requirement coverage'),gap:q.gap||say('Implementierung und Tests unbelegt','Implementation and tests not evidenced'),references:[...q.implementation,...q.tests].flatMap(id=>r.report.evidence.filter(e=>e.id===id).map(e=>e.reference))})
    }
    const reusable=a.revisions.filter(r=>r.completed.length===4&&['ready','accepted'].includes(r.state)).at(-1)
    if(reusable)recipes.push({page,block,analysis:a,revision:reusable})
   }
   if(n.type==='codeBlock'&&n.attrs?.language==='code-change'&&raw!=='{}'&&raw.length<1000000){
    const c=readChange(raw)
    if(c.accepted)done(c.origin.title,say('Patch in One angenommen · Atlas-Übernahme separat prüfen','Patch accepted in One · check Atlas delivery separately'),{revision:c.accepted})
    if(c.proposals.length&&c.proposals.at(-1)?.id!==c.accepted)add('review',c.origin.title,say('Code-Änderungen einzeln prüfen','Review code changes'),{revision:c.proposals.at(-1)!.id})
    if(c.deliveries.some(d=>d.state==='uncertain'))add('failed',c.origin.title,say('Atlas-Übernahme unklar: Verlauf prüfen, nicht erneut senden','Atlas delivery uncertain: inspect history before sending again'),{view:'delivery'})
   }
   if(n.type==='codeBlock'&&n.attrs?.language==='atlas-code'){
    const ref=codeReference(raw)
    if(ref)traces.push({id,page,block,title:ref.finding||ref.citation.path,detail:ref.citation.path+':'+ref.citation.lines.join('–'),references:[ref]})
    else traces.push({id,page,block,title:say('Unvollständiger Quellcode-Beleg','Incomplete source reference'),detail:'',gap:say('Referenzdaten prüfen','Check reference data'),references:[]})
   }
  }catch{add('failed',say('Gespeicherter Block nicht lesbar','Saved block could not be read'),say('Block öffnen und Referenzdaten prüfen','Open the block and check its reference data'))}
  for(const c of n.content??[]){if(visited>=50000){limited=true;break}visit(c,page,depth+1)}
 }
 for(const p of pages)if(p.content){if(visited>=50000){limited=true;break}visit(p.content,p.id)}
 return {work,traces,recipes,completed,limited}
}
