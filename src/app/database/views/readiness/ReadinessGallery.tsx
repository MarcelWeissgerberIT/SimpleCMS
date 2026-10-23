import { useId, useState } from 'react'
import { Check, ChevronDown, Circle, Clock3, TriangleAlert } from 'lucide-react'
import { useLang } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { useCloud } from '../../../cloud'
import type { Page, PropertyValue, ReadinessConfig } from '../../../store/types'
import { Screws } from '../../../ui/controls'
import { HelpLink } from '../../../help'
import type { DbModel } from '../../hooks'
import { writeValue } from '../../model/actions'
import { CHECKS, participant, type CheckState, type Overall } from './model'
import './readiness.css'
const DE = {
 title:'STARTAMPEL', subtitle:'Persönliche Einrichtung · gemeinsam startklar', manual:'Manuell bestätigter Stand. Eine grüne Leuchte bedeutet: Dieser Schritt wurde tatsächlich geprüft. Die Ampel verbindet keine Konten und startet keine KI.',
 automatic:'Automatisch aus erfolgreichen ONE-Ereignissen. Quelle und Zeitpunkt stehen pro Schritt dabei. Ein manueller Blocker bleibt bestehen; die Ampel ist kein dauernder Online-Monitor.',auto:'Automatisch',localWorkerSource:'Lokaler Worker verbunden · vom Gerät gemeldet',manualSource:'Manuell',sources:{session:'ONE-Sitzung',relay:'Worker zuletzt verbunden','device-mcp':'MCP-Lesezugriff · vom Gerät gemeldet','device-worker':'Erfolgreicher Worker-Lauf · vom Gerät gemeldet'},ready:'Startbereit', open:'Offen', blocked:'Blockiert', later:'Später', na:'Entfällt', team:'ONE-Team', guest:'Gast · nur lesen', all:'Alle', guests:'Gäste', teams:'Team', deferred:'Spätere Nutzer',
 checks:{one:'ONE-Zugang',atlas:'Atlas lesen',worker:'Worker',copilot:'Copilot',repo:'Repo / Testweg'},
 proof:{one:'Mit dem eigenen Konto im richtigen Workshop-Workspace angemeldet; Rolle geprüft.',atlas:'Mit der eigenen Verbindung einen erlaubten Atlas-Record im richtigen Tenant/Projekt gelesen.',worker:'Persönlicher Worker ist für diesen Workspace gekoppelt und verbunden.',copilot:'CLI angemeldet; erlaubtes Modell und ein ausdrücklich freigegebener kleiner Aufruf funktionieren.',repo:'Richtiges lokales Repo und Branch gewählt; vereinbarter Build-/Simulations-Testweg auf diesem Gerät geprüft.'},
 details:'Details für', verified:'geprüft', blocker:'Blocker / Ursache', next:'Nächster Schritt', owner:'Verantwortlich', note:'Notiz / datensparsamer Beleg', noteHint:'Zum Beispiel Prüfschritt, Datum oder freigegebener Record-Link. Keine Tokens, persönlichen Zugangslinks oder internen Rohlogs.', changedAuto:'Zuletzt geändert',changed:'Zuletzt manuell geändert', unknown:'Noch keine Statusänderung erfasst', readonly:'Leseansicht · Änderungen nur durch Teammitglieder', planned:'Planungsrolle, keine Änderung von Zugriffsrechten.', laterHint:'Beim Workshop nicht dabei. Einrichtung für die spätere Nutzung getrennt planen.', guestHint:'Als Gast nur ONE- und Atlas-Lesezugriff prüfen. Worker, Coding und Repo sind für die Gastteilnahme nicht erforderlich.', pending:'Keine automatischen Verbindungs- oder Testnachweise.', zero:'Keine Personen in dieser Auswahl.', view:'In dieser Ansicht', unset:'Nicht benannt'
}
const EN = {
 title:'START CHECK',subtitle:'Personal setup · ready together',manual:'Manually confirmed status. Green means the step was actually checked. This tracker connects no accounts and starts no AI.',
 automatic:'Updated automatically from successful ONE events. Each step shows its source and time. A manual blocker remains a hold; this is not a continuous online monitor.',auto:'Automatic',localWorkerSource:'Local worker connected · reported by device',manualSource:'Manual',sources:{session:'ONE session',relay:'Worker last connected','device-mcp':'MCP read · reported by device','device-worker':'Successful worker run · reported by device'},ready:'Ready',open:'Open',blocked:'Blocked',later:'Later',na:'Not needed',team:'ONE team',guest:'Guest · read only',all:'All',guests:'Guests',teams:'Team',deferred:'Later users',
 checks:{one:'ONE access',atlas:'Atlas read',worker:'Worker',copilot:'Copilot',repo:'Repo / test path'},
 proof:{one:'Signed in with the personal account to the correct workshop workspace; role checked.',atlas:'Read an allowed Atlas record in the correct tenant/project using the personal connection.',worker:'Personal worker paired and connected to this workspace.',copilot:'CLI signed in; approved model and an explicitly permitted small request work.',repo:'Correct local repository and branch selected; agreed build/simulation test path checked on this device.'},
 details:'Details for',verified:'checked',blocker:'Blocker / cause',next:'Next step',owner:'Responsible person',note:'Note / minimal evidence',noteHint:'For example check, date or an approved record link. No tokens, personal access links or internal raw logs.',changedAuto:'Last changed',changed:'Last manually changed',unknown:'No status change recorded yet',readonly:'Read only · team members can edit',planned:'Planning role; does not change access permissions.',laterHint:'Not attending this workshop. Plan setup for later use separately.',guestHint:'Only check ONE and Atlas read access for guests. Worker, coding and repository access are not needed for guest participation.',pending:'No automatic connection or test evidence.',zero:'No people in this selection.',view:'In this view',unset:'Not named'
}
type Copy = typeof DE
function Lamp({ state }: { state: CheckState | Overall }) {
 const Icon = state==='ready'?Check:state==='blocked'?TriangleAlert:state==='later'||state==='na'?Clock3:Circle
 return <span className="ws-start__lamp" data-state={state} aria-hidden="true"><Icon size={12}/></span>
}
export function ReadinessGallery({ m, config:c }: { m:DbModel; config:ReadinessConfig }) {
 const text = useLang()==='de'?DE:EN
 const [filter,setFilter] = useState('all')
 const states=m.rows.map(row=>({row,state:participant(row,c)}))
 const active=states.filter(x=>!x.state.later),ready=active.filter(x=>x.state.overall==='ready').length,blocked=active.filter(x=>x.state.overall==='blocked').length
 const filters=[['all',text.all],['team',text.teams],['guest',text.guests],['later',text.deferred]]
 const matches=({state:s}:typeof states[number])=>filter==='all'||filter==='later'&&s.later||filter==='guest'&&s.guest&&!s.later||filter==='team'&&!s.guest&&!s.later
 return <div className="ws-start" data-testid="workshop-start">
  <section className="screw-plate ws-start__panel" aria-label={text.title}>
   <Screws seed={m.db.id}/><div className="ws-start__eyebrow"><span>§ START · ONE</span><HelpLink id="workshop-startampel"/></div>
   <div className="ws-start__intro"><div><h3>{text.title}</h3><p>{text.subtitle}</p></div><div className="ws-start__count"><strong>{ready}<span>/{active.length}</span></strong><span>{text.ready}</span></div></div>
   <div className="ws-start__summary" aria-live="polite"><span><Lamp state="open"/>{active.length-ready-blocked} {text.open}</span><span><Lamp state="blocked"/>{blocked} {text.blocked}</span><span><Lamp state="later"/>{states.length-active.length} {text.later}</span><small>{text.view}</small></div>
   <p className="ws-start__manual">{c.automation?text.automatic:text.manual}</p>
  </section>
  <div className="ws-start__filters" role="group" aria-label={text.title}>{filters.map(([key,label])=><button key={key} type="button" aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label} <span>{states.filter(x=>key==='all'||key==='later'&&x.state.later||key==='guest'&&x.state.guest&&!x.state.later||key==='team'&&!x.state.guest&&!x.state.later).length}</span></button>)}</div>
  {m.readOnly&&<p className="ws-start__readonly">{text.readonly}</p>}
  <div className="ws-start__grid">{states.filter(matches).map(({row})=><ParticipantPlate key={row.id} m={m} row={row} config={c} text={text}/> )}</div>
  {!states.filter(matches).length&&<p>{text.zero}</p>}
 </div>
}
function ParticipantPlate({m,row,config:c,text}: {m:DbModel;row:Page;config:ReadinessConfig;text:Copy}) {
 const lang=useLang(),s=participant(row,c),[expanded,setExpanded]=useState(false),id=useId(),account=useCloud(x=>x.user?.name),localName=useWorkspace(x=>x.settings.userName)
 let evidence:Record<string,{at:number;source:string}>={}
 try{const raw=c.automation&&row.properties[c.automation.evidence];const parsed=typeof raw==='string'?JSON.parse(raw):null;if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))evidence=parsed}catch{}
 const proofText=(k:string)=>{const e=evidence[k];return e&&Number.isFinite(e.at)&&Number.isFinite(new Date(e.at).getTime())&&Object.hasOwn(text.sources,e.source)?`${text.auto} · ${k==='worker'&&e.source==='device-worker'?text.localWorkerSource:text.sources[e.source as keyof typeof text.sources]} · ${new Intl.DateTimeFormat(lang==='de'?'de-DE':'en-GB',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Berlin'}).format(new Date(e.at))}`:text.manualSource}
 const value=(key:string)=>typeof row.properties[key]==='string'?String(row.properties[key]):''
 const write=(key:string,val:PropertyValue)=>{
  if(m.readOnly)return
  const prop=m.db.properties.find(p=>p.id===key);if(!prop)return
  writeValue(m.db.id,prop,row.id,val)
  if(c.automation){const check=CHECKS.find(k=>c.checks[k]===key);if(check&&evidence[check]){const next={...evidence};delete next[check];const def=m.db.properties.find(d=>d.id===c.automation!.evidence);if(def)writeValue(m.db.id,def,row.id,JSON.stringify(next))}}
  const set=(p:string,v:string)=>{const def=m.db.properties.find(d=>d.id===p);if(def)writeValue(m.db.id,def,row.id,v)}
  set(c.changedAt,new Date().toISOString());set(c.changedBy,account||localName||text.unset)
 }
 const changed=value(c.changedAt),date=new Date(changed)
 const stamp=changed&&Number.isFinite(date.getTime())?new Intl.DateTimeFormat(lang==='de'?'de-DE':'en-GB',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Berlin'}).format(date):''
 return <article className="screw-plate ws-start__person" data-state={s.overall} data-expanded={expanded} data-participant={row.id}>
  <Screws seed={row.id}/><button type="button" className="ws-start__head" aria-expanded={expanded} aria-controls={id} onClick={()=>setExpanded(v=>!v)}>
   <div className="ws-start__identity"><span className="ws-start__role">{s.later?text.deferred:s.guest?text.guest:text.team}</span><strong>{row.title}</strong></div>
   <div className="ws-start__overall"><Lamp state={s.overall}/><span>{text[s.overall]}</span><ChevronDown size={16}/></div>
   <div className="ws-start__steps">{CHECKS.map(k=><span key={k} title={`${text.checks[k]}: ${text[s.states[k]]}`}><Lamp state={s.states[k]}/><span>{text.checks[k]}</span><small>{text[s.states[k]]}</small></span>)}</div>
   <div className="ws-start__progress"><span>{s.later?'—':`${s.done}/${s.total}`} {text.verified}</span><span className="ws-start__bar" aria-hidden="true">{s.required.map(k=><i key={k} data-state={s.states[k]}/>)}</span></div>
  </button>
  {expanded&&<div id={id} className="ws-start__body">
   {(s.later||s.guest)&&<p className="ws-start__notice">{s.later?text.laterHint:text.guestHint}</p>}
   <div className="ws-start__checklist">{CHECKS.map(k=><label key={k}><span><strong>{text.checks[k]}</strong><small>{text.proof[k]}</small>{(evidence[k]||s.states[k]==='ready')&&<small className="ws-start__evidence">{proofText(k)}</small>}</span><select aria-label={`${row.title} · ${text.checks[k]}`} value={s.states[k]} disabled={m.readOnly||s.later||!s.required.includes(k)} onChange={e=>write(c.checks[k],e.target.value)}>{(s.states[k]==='na'?['na']:['open','ready','blocked']).map(v=><option key={v} value={v}>{text[v as CheckState]}</option>)}</select></label>)}</div>
   <div className="ws-start__notes">{[[c.blocker,text.blocker],[c.next,text.next],[c.owner,text.owner],[c.note,text.note]].map(([key,label])=><label key={key}><span>{label}</span>{m.readOnly?<p>{value(key)||'—'}</p>:<textarea aria-label={`${row.title} · ${label}`} rows={key===c.owner?1:2} value={value(key)} onChange={e=>write(key,e.target.value)}/>}</label>)}</div>
   <p className="ws-start__hint">{text.noteHint}</p><p className="ws-start__audit">{stamp?`${c.automation?text.changedAuto:text.changed}: ${stamp} · ${value(c.changedBy)}`:text.unknown}</p><p className="ws-start__hint">{text.planned} {text.pending}</p>
  </div>}
 </article>
}
