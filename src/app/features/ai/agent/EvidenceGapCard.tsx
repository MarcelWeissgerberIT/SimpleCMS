import {useState} from 'react'
import {useLang} from '../../../i18n'
import {isEffectivelyTrashed} from '../../../store/selectors'
import {useWorkspace} from '../../../store/store'
import {evidenceOf,EVIDENCE_BATCH_SIZE} from '@/shared/ai/evidenceGaps'
import {useAgent} from './state'
import {reviewEvidence,keepEvidencePartial} from './session'
import type {AgentTurn} from './types'
import './evidence.css'
export function EvidenceGapCard({turn,last}:{turn:AgentTurn;last:boolean}){
 const de=useLang()==='de',busy=useAgent(s=>s.status==='running'),pages=useWorkspace(s=>s.pages),[error,setError]=useState('')
 const report=evidenceOf(turn)
 if(!report?.gaps.length)return null
 const page=turn.context?.pageId,missing=!!page&&(!pages[page]||isEffectivelyTrashed(pages,page)),running=turn.status==='running'
 const kinds=de?{specification:'Spezifikation',implementation:'Code',test_definition:'Testdefinition',test_execution:'Testausführung',quotation:'Lesebeleg',atlas:'Atlas-Zuordnung'}:{specification:'Specification',implementation:'Code',test_definition:'Test definition',test_execution:'Test execution',quotation:'Quotation evidence',atlas:'Atlas mapping'}
 return <aside className="term-evidence" aria-label={de?'Offene Quellenprüfung':'Open evidence review'}>
  <strong>{running?(de?'Quellenprüfung läuft':'Evidence review running'):(de?'Teilstand · Quellenprüfung offen':'Partial result · evidence review open')}</strong>
  <p>{de?`${report.gaps.length} offene Prüfpunkte. Die Liste stammt aus der Auswertung und ist selbst kein verifizierter Beleg.`:`${report.gaps.length} open checks. This list comes from the analysis; it is not verified evidence.`}</p>
  {running&&turn.evidenceBatch&&<p role="status">{de?`Aktuelles Paket: ${turn.evidenceBatch.size} Prüfpunkte · ${turn.evidenceBatch.remaining} für danach. Die Leseschritte erscheinen im Verlauf.`:`Current batch: ${turn.evidenceBatch.size} checks · ${turn.evidenceBatch.remaining} for later. Reading steps appear in the log.`}</p>}
  <details open={!report.kept}><summary>{de?'Fehlende Belege ansehen':'View missing evidence'}</summary><ul>{report.gaps.map((gap,i)=><li key={i}><b>{kinds[gap.kind]}</b> · <code>{gap.target}</code><p>{gap.reason}</p>{(gap.repo||gap.snapshot)&&<small>{[gap.repo,gap.snapshot].filter(Boolean).join(' · ')}</small>}</li>)}</ul></details>
  {report.kept&&<p>{de?'Teilstand behalten. Die Beleglücken bleiben offen.':'Partial result kept. The evidence gaps remain open.'}</p>}
  {last&&!running&&!turn.program&&!turn.contract?.program&&<>
   <p>{de?`Nächster Schritt: bis zu ${Math.min(EVIDENCE_BATCH_SIZE,report.gaps.length)} Prüfpunkte lesend nachprüfen. Bestehende Vorschläge bleiben erhalten. Testläufe und Atlas-Schreibaktionen sind nicht Teil dieser Prüfung.`:`Next: review up to ${Math.min(EVIDENCE_BATCH_SIZE,report.gaps.length)} checks using read-only tools. Existing proposals are retained. Test execution and Atlas writes are not part of this review.`}</p>
   {missing?<p role="alert">{de?'Die ursprüngliche Quellseite ist nicht mehr verfügbar.':'The original source page is no longer available.'}</p>:<div className="term-evidence__actions"><button type="button" className="btn btn--primary" disabled={busy} onClick={()=>{setError('');void reviewEvidence(turn.n).catch(()=>setError(de?'Prüfung konnte nicht gestartet werden. Der Teilstand bleibt erhalten.':'Could not start the review. The partial result is retained.'))}}>{de?'Fehlende Belege prüfen':'Review missing evidence'}</button>{!report.kept&&<button type="button" className="btn" disabled={busy} onClick={()=>keepEvidencePartial(turn.n)}>{de?'Teilstand behalten':'Keep partial result'}</button>}</div>}
  </>}
  {error&&<p role="alert">{error}</p>}
 </aside>
}
