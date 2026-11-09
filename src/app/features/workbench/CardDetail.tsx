import {useState,useEffect,useRef} from 'react'
import {useLang} from '../../i18n'
import {useWorkspace} from '../../store/store'
import {levels,levelsEn,sourceState,sourceHref,safeEvidenceUrl,type Card} from './model'
import {saveRecords,stamp,refreshCard,trackCard} from './actions'
export function CardDetail({deskId,card,readOnly,onClose,onError}:{deskId:string;card:Card;readOnly:boolean;onClose:()=>void;onError:(e:unknown)=>void}){
 const de=useLang()==='de',pages=useWorkspace(s=>s.pages),[draft,setDraft]=useState(()=>({title:card.title,detail:card.detail,group:card.group,level:card.level,evidence:card.evidence,evidenceUrl:card.evidenceUrl})),[base]=useState(()=>JSON.stringify(card)),[busy,setBusy]=useState(false),[editing,setEditing]=useState(false)
 const host=useRef<HTMLElement>(null)
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;host.current?.focus({preventScroll:true});host.current?.scrollIntoView({block:'nearest'});return()=>{if(previous?.isConnected)previous.focus({preventScroll:true})}},[])
 const state=sourceState(card,pages),conflict=JSON.stringify(card)!==base
 const run=async(fn:()=>unknown)=>{try{await fn()}catch(e){onError(e)}}
 return <aside ref={host} tabIndex={-1} className="wb-detail" aria-label={de?'Kartendetails':'Card details'}>
  <div className="wb-detail-head"><strong>{de?'Karte und Belege':'Card and evidence'}</strong><button className="btn btn--sm" onClick={onClose}>{de?'Schließen':'Close'}</button></div>
  <a href={sourceHref(card)}>{card.source.label} ↗</a>
  <p className={'wb-source-state '+state}>{state==='current'?(de?'Gespeicherte Quelle vorhanden':'Saved source available'):state==='changed'?(de?'Quelle geändert · erneut prüfen':'Source changed · review needed'):(de?'Quelle nicht geladen oder nicht verfügbar':'Source not loaded or unavailable')}</p>
  <blockquote>{card.source.quote}</blockquote>
  {!readOnly&&state==='changed'&&<button className="btn btn--sm" disabled={busy} onClick={()=>void run(async()=>{setBusy(true);try{await refreshCard(deskId,card.id,new AbortController().signal);onClose()}finally{setBusy(false)}})}>{de?'Auszug erneut abgleichen':'Recheck excerpt'}</button>}
  {!editing&&<div className="wb-card-preview"><h3>{card.title}</h3>{card.detail!==card.source.quote&&<p>{card.detail}</p>}<p className="wb-muted">{(de?levels:levelsEn)[card.level]}{card.group?' · '+card.group:''}</p>{!readOnly&&<button className="btn btn--sm" onClick={()=>setEditing(true)}>{de?'Bearbeiten':'Edit'}</button>}</div>}
  {editing&&<>
  <label>{de?'Titel':'Title'}<input maxLength={300} value={draft.title} disabled={readOnly} onChange={e=>setDraft({...draft,title:e.target.value})}/></label>
  <label>{de?'Einordnung':'Interpretation'}<textarea maxLength={12000} rows={4} value={draft.detail} disabled={readOnly} onChange={e=>setDraft({...draft,detail:e.target.value})}/></label>
  <label>{de?'Gruppe':'Group'}<input maxLength={100} value={draft.group} disabled={readOnly} onChange={e=>setDraft({...draft,group:e.target.value})}/></label>
  <label>{de?'Gewissheit':'Evidence level'}<select aria-label={de?'Gewissheit':'Evidence level'} value={draft.level} disabled={readOnly||state!=='current'} onChange={e=>setDraft({...draft,level:Number(e.target.value)})}>{(de?levels:levelsEn).map((name,i)=><option key={name} value={i} disabled={card.source.kind==='note'&&i>0}>{i} · {name}</option>)}</select></label>
  <p className="wb-muted">{de?'Codeprüfung, Tests und Freigabe sind dokumentierte menschliche Bestätigungen. Eine Quellenangabe allein beweist die Aussage nicht.':'Code review, tests and approval are recorded human confirmations. A citation alone does not prove a claim.'}</p>
  <label>{de?'Begründung / Prüfergebnis':'Rationale / test result'}<textarea maxLength={2000} value={draft.evidence} disabled={readOnly} onChange={e=>setDraft({...draft,evidence:e.target.value})}/></label>
  <label>{de?'Beleg oder Prüfbericht (Link)':'Evidence or test report (link)'}<input maxLength={2000} value={draft.evidenceUrl} disabled={readOnly} onChange={e=>setDraft({...draft,evidenceUrl:e.target.value})}/></label>
  </>}
  {!editing&&card.evidence&&<p className="wb-muted">{card.evidence}</p>}
  {card.evidenceUrl&&<a href={safeEvidenceUrl(card.evidenceUrl)} target="_blank" rel="noopener noreferrer">{de?'Beleg öffnen':'Open evidence'} ↗</a>}
  {card.level>=2&&<p className="wb-muted">{de?'Festgehalten von':'Recorded by'} {card.assessment?.by??card.by} · {new Date(card.assessment?.at??card.at).toLocaleString()}</p>}
  {conflict&&<p role="alert">{de?'Die Karte wurde inzwischen geändert. Schließe und öffne sie erneut.':'The card changed. Close and reopen it.'}</p>}
  {!readOnly&&<div className="wb-actions">{editing&&<button className="btn" disabled={conflict||!draft.title.trim()||draft.level>=2&&(!draft.evidence.trim()||!safeEvidenceUrl(draft.evidenceUrl))||draft.level!==card.level&&state!=='current'} onClick={()=>void run(()=>{saveRecords(deskId,[{...card,...draft,evidenceUrl:safeEvidenceUrl(draft.evidenceUrl),...stamp(),...((draft.level!==card.level||draft.evidence!==card.evidence||draft.evidenceUrl!==card.evidenceUrl)?{assessment:stamp()}:{})}],{[card.id]:base});onClose()})}>{de?'Speichern':'Save'}</button>}
  {card.taskId?<a className="btn" href={'#/p/'+card.taskId}>{de?'Nachverfolgung öffnen':'Open follow-up'}</a>:<button className="btn" onClick={()=>void run(()=>{trackCard(deskId,card.id);onClose()})}>{de?'Nachverfolgen':'Track'}</button>}
  <button className="btn btn--ghost" onClick={()=>void run(()=>{saveRecords(deskId,[{...card,...stamp(),removed:true}],{[card.id]:base});onClose()})}>{de?'Vom Schreibtisch nehmen':'Remove from desk'}</button></div>}
 </aside>
}
