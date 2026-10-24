import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ArrowRight, Check, Compass } from 'lucide-react'
import { useWorkspace } from '../../../store/store'
import { withWriter } from '../../../store/writer'
import { useT } from '../../../i18n'
import { useUI } from '../../../store/ui'
import { useCoding } from '../state'
import { scope as codingScope, useCodingLocal } from '../local'
import { codingProps, readPipeline, stageOfRow } from '../schema'
import { acceptanceIssues, guidePhase, type GuidePhase } from './guidance'
import { acceptGuidedOrder, acceptanceSnapshot, atlasHandoffPrompt, type AcceptanceSnapshot } from './guidedAcceptance'
import { pressPlan } from './press'
import type { OrderRecord, OrderStatusKey } from './types'
import {makeEvidencePacket,publishEvidencePacket,downloadEvidencePacket} from './evidencePacket'
import {verifyAtlasHandoff} from './guidedHandoff'
import {patchOrderRecord} from './records'
import './guided.css'

const G = 'features.coding.guide'
const PHASES: GuidePhase[] = ['prepare', 'plan', 'work', 'verify', 'accept']
const PREF = 'one:guided-orders:compact:v1'

/** One quiet, collapsible companion on the existing work order; no extra polling, notifications or AI calls. */
export default function GuidedOrder({ rowId, rec, status, planning, viewer, server }: {
  rowId: string; rec: OrderRecord | null; status: OrderStatusKey | null; planning: boolean; viewer: boolean; server: string | null
}) {
  const t = useT()
  const row = useWorkspace(s => s.pages[rowId])
  const dbs = useWorkspace(s => s.databases)
  const pages = useWorkspace(useShallow(s => [rowId, ...(rec?.chain?.steps.map(st => st.id) ?? []), ...Object.keys(rec?.draft?.source.pins ?? {}), ...new Set(rec?.chain?.steps.flatMap(st => Object.keys(st.refs)) ?? [])].map(id => s.pages[id])))
  const locals = useCodingLocal(useShallow(s => (rec?.chain?.steps ?? []).map(st => s.tasks[`${codingScope()}|${st.id}`])))
  const coding = useCoding(useShallow(s => ({ conn: s.conn, worker: s.worker })))
  const [compact, setCompact] = useState(() => { try { return localStorage.getItem(PREF) === '1' } catch { return false } })
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [atlasRef,setAtlasRef]=useState(''),[project,setProject]=useState(()=>{const all=[...new Set(Object.values(useWorkspace.getState().databases).flatMap(d=>d.readiness?.automation?.atlasProjects??[]))];return all.length===1?all[0]!:''})
  const [parent,setParent]=useState(''),[packetId,setPacketId]=useState('')
  const verifyAbort=useRef<AbortController|null>(null)
  useEffect(()=>()=>{verifyAbort.current?.abort()},[rowId])
  const [snapshot, setSnapshot] = useState<AcceptanceSnapshot | null>(null)
  const steps = rec?.chain?.steps ?? []
  const active = steps.find(st => {
    const p = useWorkspace.getState().pages[st.id], db = p?.databaseId ? dbs[p.databaseId] : undefined
    return !p || !db || stageOfRow(readPipeline(db), codingProps(db), p)?.kind !== 'done'
  })
  const phase = guidePhase(status, planning, active?.kind)
  const phaseN = PHASES.indexOf(phase)
  const needsInput = !!rec?.draft?.plan.questions.length
  const targetServer = rec?.draft?.source.server ?? null
  const empty = !row?.content?.content?.some(b => b.type !== 'paragraph' || !!b.content?.length)
  useEffect(() => {
    let live = true
    setSnapshot(null)
    if (rec?.chain && rec.state === 'done') void acceptanceSnapshot(rowId, rec).then(s => { if (live) setSnapshot(s) }).catch(() => { if (live) setNote(t(`${G}.reload`)) })
    return () => { live = false }
  }, [rowId, rec, pages, locals, dbs, t])
  const toggle = () => {
    const next = !compact
    setCompact(next)
    try { localStorage.setItem(PREF, next ? '1' : '0') } catch { /* view preference only */ }
  }
  const plan = async () => {
    if (busy || viewer || !row) return
    setBusy(true); setNote('')
    try {
      if (empty && goal.trim()) withWriter({ kind: 'you', via: 'ui' }, () => {
        if (!row.title.trim()) useWorkspace.getState().updatePage(rowId, { title: goal.trim().split('\n')[0]!.slice(0, 200) })
        useWorkspace.getState().setContent(rowId, { type: 'doc', content: goal.trim().split('\n').filter(Boolean).map(text => ({ type: 'paragraph', content: [{ type: 'text', text }] })) }, 'edit')
      })
      await pressPlan(rowId, 'plate')
    } catch { setNote(t(`${G}.reload`)) } finally { setBusy(false) }
  }
  const accept = async () => {
    if (!snapshot || busy || viewer) return
    setBusy(true); setNote('')
    try { if (!await acceptGuidedOrder(rowId, snapshot.hash)) setNote(t(`${G}.reload`)) }
    catch { setNote(t(`${G}.reload`)) }
    finally { setBusy(false) }
  }
  const issues = snapshot ? acceptanceIssues(snapshot.evidence) : []
  const handoff = async () => {
    if (!snapshot?.accepted || !rec?.chain || !targetServer || viewer || busy) return
    const { openAgent, useAgent } = await import('../../ai/agent/state')
    if (useAgent.getState().status === 'running' || useAgent.getState().draft.trim()) { setNote(t(`${G}.terminalBusy`)); return }
    setBusy(true)
    try{
    const saved=await patchOrderRecord(rowId,r=>r?.chain?.run===rec.chain!.run&&r.accepted?.evidence===snapshot.hash?{...r,handoff:r.handoff?.evidence===snapshot.hash?r.handoff:{run:rec.chain!.run,evidence:snapshot.hash,state:'prepared',at:Date.now(),server:targetServer}}:r)
    if(saved.rec?.handoff?.evidence!==snapshot.hash){setNote(t(`${G}.reload`));return}
    if(useAgent.getState().status==='running'||useAgent.getState().draft.trim()){setNote(t(`${G}.terminalBusy`));return}
    openAgent({ task: atlasHandoffPrompt(targetServer, snapshot.report, rec?.draft?.plan.context?.links ?? []), run: false })
    }catch{setNote(t(`${G}.reload`))}finally{setBusy(false)}
  }
  const verifyHandoff=async()=>{
    if(!snapshot?.accepted||busy||viewer)return
    setBusy(true);setNote('');const ac=new AbortController();verifyAbort.current=ac;const deadline=setTimeout(()=>ac.abort(),30000)
    try{setNote(t(`${G}.${await verifyAtlasHandoff(rowId,snapshot.hash,project,atlasRef,ac.signal)?'handoffVerified':'handoffUnverified'}`))}catch{setNote(t(`${G}.handoffUnverified`))}finally{clearTimeout(deadline);setBusy(false)}
  }
  const downloadPacket=async()=>{
    if(!snapshot||!rec?.chain||busy)return
    setBusy(true)
    try{const checked=await acceptanceSnapshot(rowId,rec);if(!checked||checked.hash!==snapshot.hash){setNote(t(`${G}.reload`));return}downloadEvidencePacket(makeEvidencePacket(rowId,rec,checked))}catch{setNote(t(`${G}.reload`))}finally{setBusy(false)}
  }
  const publishPacket=async()=>{
    if(!snapshot||!rec?.chain||busy||viewer||!parent)return
    setBusy(true);setNote('')
    try{const id=await publishEvidencePacket(rowId,rec,snapshot,parent);if(id)setPacketId(id);else setNote(t(`${G}.reload`))}catch{setNote(t(`${G}.reload`))}finally{setBusy(false)}
  }
  const focusNext = () => {
    const root = document.querySelector(`[data-testid="order-plate"][data-row="${rowId}"]`)
    const el = root?.querySelector<HTMLElement>('[data-testid="order-questions"] textarea, [data-testid="order-note"], [data-testid="order-card-go"], [data-testid="order-resume"], [data-testid="order-start"]')
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); el?.focus()
  }
  const hint = planning ? 'planning' : needsInput ? 'blocking' : rec?.state === 'halted' ? 'halted' : snapshot?.accepted ? 'accepted' : status === 'plan' && !rec?.draft ? 'waiting' : `${phase}Hint`
  return <aside className="og" data-testid="guided-order" data-phase={phase}>
    <button type="button" className="og-head" onClick={toggle} aria-expanded={!compact} data-testid="guided-toggle">
      <Compass size={18} aria-hidden /><span className="label">{t(`${G}.title`)}</span><strong>{t(`${G}.phase.${phase}`)}</strong><span className="og-fold" aria-hidden>{compact ? '+' : '−'}</span>
    </button>
    {!compact && <div className="og-body">
      <ol className="og-track" aria-label={t(`${G}.title`)}>{PHASES.map((p, i) => <li key={p} data-state={i < phaseN ? 'past' : i === phaseN ? 'current' : 'next'} aria-current={p === phase ? 'step' : undefined}><span aria-hidden>{i < phaseN ? <Check size={12} /> : `0${i + 1}`}</span>{t(`${G}.phase.${p}`)}</li>)}</ol>
      <p className="og-hint" data-testid="guided-next">{t(`${G}.${hint}`)}</p>
      {phase === 'prepare' && !viewer && <>
        {empty && <label className="og-goal"><span className="label">{t(`${G}.goal`)}</span><textarea className="input" rows={3} maxLength={8000} value={goal} onChange={e => setGoal(e.target.value)} placeholder={t(`${G}.goalPh`)} data-testid="guided-goal" /></label>}
        <button type="button" className="btn btn--primary btn--sm" disabled={busy || (empty && !goal.trim())} onClick={() => void plan()} data-testid="guided-plan">{t(`${G}.prepare`)}<ArrowRight size={14} aria-hidden /></button>
      </>}
      {!planning && (needsInput || rec?.state === 'halted') && <button type="button" className="btn btn--sm" onClick={focusNext}>{t(`${G}.resolve`)}</button>}
      {active && (phase === 'work' || phase === 'verify') && <a className="og-active" href={`#/p/${active.id}`}>{t(`${G}.current`)}: {useWorkspace.getState().pages[active.id]?.title || active.title}<ArrowRight size={14} aria-hidden /></a>}
      {phase === 'accept' && <div className="og-accept" data-testid="guided-acceptance">
        {!snapshot ? <p>{t(`${G}.loading`)}</p> : <>
          {issues.length > 0 && <ul className="og-issues">{issues.map(k => <li key={k}>{t(`${G}.issue.${k}`)}</li>)}</ul>}
          {!viewer && issues.some(k => ['qa', 'checks', 'afterQa'].includes(k)) && steps.at(-1)?.kind === 'qa' && <a className="btn btn--sm" href={`#/p/${steps.at(-1)!.id}`}>{t(`${G}.openQa`)}</a>}
          <details><summary>{t(`${G}.showEvidence`)}</summary><pre className="og-evidence">{snapshot.report}</pre></details>
          {!viewer && !snapshot.accepted && <button type="button" className="btn btn--primary btn--sm" disabled={busy || issues.length > 0} onClick={() => void accept()} data-testid="guided-accept">{t(`${G}.accept`)}</button>}
          {!viewer && targetServer && <button type="button" className="btn btn--sm" disabled={busy||!snapshot.accepted} onClick={() => void handoff()} data-testid="guided-atlas">{t(`${G}.handoff`, { server: targetServer })}</button>}
          <p className="og-quiet">{t(`${G}.handoffHint`)}</p>
          <div className="og-proof-tools" data-testid="guided-proof-tools">
            <button className="btn btn--sm" type="button" disabled={busy} onClick={()=>void downloadPacket()}>{t(`${G}.packetDownload`)}</button>
            {!viewer&&<><label>{t(`${G}.packetTarget`)}<select className="input" value={parent} onChange={e=>setParent(e.target.value)} data-testid="packet-target"><option value="">{t(`${G}.packetChoose`)}</option>{Object.values(useWorkspace.getState().pages).filter(p=>!p.private&&!p.trashed&&p.kind==='page'&&!p.databaseId).map(p=><option key={p.id} value={p.id}>{p.title||t('common.untitled')}</option>)}</select></label>
            <p className="og-quiet">{t(`${G}.packetShareHint`)}</p><button className="btn btn--sm" disabled={busy||!parent} type="button" onClick={()=>void publishPacket()} data-testid="packet-publish">{t(`${G}.packetPublish`)}</button></>}
            {packetId&&<a href={`#/p/${packetId}`} data-testid="packet-link">{t(`${G}.packetOpen`)}</a>}
          </div>
          {rec?.handoff?.evidence===snapshot.hash&&<section className="og-handoff" data-testid="handoff-status"><strong>{t(`${G}.handoffState.${rec.handoff.state}`)}</strong>{rec.handoff.url&&<a href={rec.handoff.url} target="_blank" rel="noopener noreferrer">{rec.handoff.project} · #{rec.handoff.ref}</a>}
            {!viewer&&<><label>{t(`${G}.atlasProject`)}<input className="input" value={project} maxLength={100} onChange={e=>setProject(e.target.value)} data-testid="handoff-project"/></label><label>{t(`${G}.atlasRecord`)}<input className="input" value={atlasRef} maxLength={200} onChange={e=>setAtlasRef(e.target.value)} data-testid="handoff-record"/></label><button type="button" className="btn btn--sm" disabled={busy||!project||!atlasRef||!snapshot.accepted} onClick={()=>void verifyHandoff()} data-testid="handoff-verify">{t(`${G}.handoffVerify`)}</button></>}
          </section>}
        </>}
      </div>}
      <details className="og-details"><summary>{t(`${G}.prepared`)}</summary>
        <p>{t(`${G}.worker`)}: {coding.conn === 'connected' ? coding.worker?.name : t(`${G}.notConnected`)}</p>
        <p>{t(`${G}.context`)}: {rec?.draft?.source.server ?? server ?? t(`${G}.noServer`)}</p>
        {rec?.draft && <p>{t(`${G}.contextCalls`, { n: rec.draft.source.calls.filter(c => c.ok).length })}</p>}
        <p>{t(`${G}.quietPolicy`)}</p>
      </details>
      {note && <p role="status" className="og-note">{note}</p>}
    </div>}
  </aside>
}
