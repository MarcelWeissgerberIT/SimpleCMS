import {oneActivity} from '../workflow/activity'
import type {TaskRecovery} from '@/shared/ai/taskRecovery'
/** Text only; checkpoint content is never rendered as HTML or executable operations. */
export function RecoveryDetails({saved,de}:{saved:TaskRecovery;de:boolean}){
 let c:any;try{c=JSON.parse(saved.checkpoint)}catch{return null}
 const tools=Array.isArray(c.tools)?c.tools.slice(-24):[],draft=typeof c.unverifiedDraft==='string'?c.unverifiedDraft.slice(0,24000):''
 return <details className="term-recovery-details"><summary>{de?'Arbeitsstand und Fortsetzung prüfen':'Review checkpoint and continuation'}</summary>
 <p>{de?'Erhalten: abgeschlossene Schritte, offene Vorschläge und der letzte Entwurf. Quellen werden vor der Weiterverwendung erneut gelesen. Externe Schreibaktionen werden nicht wiederholt.':'Retained: completed steps, pending proposals and the last draft. Sources are read again before reuse. External writes are not repeated.'}</p>
 <ul>{tools.filter((x:any)=>typeof x?.tool==='string').map((x:any,i:number)=><li key={i}>{oneActivity(x.tool,undefined,{},de).action} · {x.state==='ok'?(de?'abgeschlossen':'completed'):x.state==='err'?(de?'fehlgeschlagen':'failed'):(de?'offen':'pending')}</li>)}</ul>
 {c.earlierToolsOmitted&&<p>{de?'Ältere Schritte sind in diesem kompakten Arbeitsstand ausgelassen.':'Earlier steps are omitted from this compact checkpoint.'}</p>}
 {draft&&<details><summary>{de?'Gesicherter Entwurf · erneut prüfen':'Saved draft · requires rechecking'}</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{draft}</pre>{c.draftTruncated&&<p>{de?'Der Entwurf ist auf 24.000 Zeichen gekürzt.':'Draft limited to 24,000 characters.'}</p>}</details>}
 </details>
}
