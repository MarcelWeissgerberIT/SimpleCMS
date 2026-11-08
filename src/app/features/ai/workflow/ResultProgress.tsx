import {useLang} from '../../../i18n'
import './result-progress.css'
export type ResultPhase='request'|'working'|'proposal'|'review'|'adopted'
/** Shared vocabulary only. Every caller supplies its actual persistence/effect boundary. */
export function ResultProgress({phase,saved,next,blocked=false}:{phase:ResultPhase;saved:string;next:string;blocked?:boolean}){
 const de=useLang()==='de',steps:ResultPhase[]=['request','working','proposal','review','adopted'],at=steps.indexOf(phase)
 const labels=de?['Auftrag','Bearbeitung','Vorschlag','Prüfung','Übernahme']:['Request','Work','Proposal','Review','Adoption']
 return <section className="result-progress" aria-label={de?'Ergebnisstand':'Result status'} data-phase={phase} data-blocked={blocked||undefined}>
  <ol aria-label={de?'Bearbeitungsweg':'Result workflow'}>{steps.map((step,i)=><li key={step} aria-current={step===phase?'step':undefined} data-past={i<at||undefined}>{labels[i]}</li>)}</ol>
  <p><strong>{de?'Gespeicherter Stand: ':'Saved state: '}</strong>{saved}</p><p><strong>{de?'Nächster Schritt: ':'Next step: '}</strong>{next}</p>
 </section>
}
