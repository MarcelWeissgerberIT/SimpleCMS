/**
 * The plate's chain part (spec §1.5–§1.6, B6 — B8 builds the full stations, edits and phone bar on it):
 *  - Kette bereit: the plan's steps (number · kind · title · project · repo; why, goal, criteria in full), the older
 *    chain's parked steps that go to the trash, why the last start was refused, and ↵ Kette starten — VON HAND: a fresh
 *    press ≥ 300 ms after the key became ready, `aria-disabled` with its reason (never `disabled`), no key repeat;
 *    "· mit Server-Inhalt" when a server took part. It confirms the plan as resolved now (planHashNow).
 *  - creating: "Kette wird angelegt …"; interrupted: what was made, with the two VON HAND keys "Angelegte verwerfen" ·
 *    "Rest anlegen".
 *  - running / halted / done: the Laufleiste — one row per step: LED + state word + stage (the word always beside the
 *    LED); while step 01 counts down: "Schritt 01 startet in 9 s · ↵ jetzt · Z Rückgängig"; once it was taken: "läuft
 *    schon — H anhalten, ⌘. stoppen"; a halt names its reason.
 * Keys (focus inside the plate, never while typing, never on a repeat, no modifier but ⇧): ↵ = the part's main key
 * (start / now), Z = Undo while it can.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useWorkspace } from '../../../store/store'
import type { ID } from '../../../store/types'
import { Led } from '../../../ui/controls'
import { typing } from '../../../ui/keys'
import { useLang, useT } from '../../../i18n'
import { useUI } from '../../../store/ui'
import { useCoding } from '../state'
import { codingProps, readPipeline, stageOfRow } from '../schema'
import { startStageOf } from '../stages'
import { loadTask, useTaskLocal } from '../local'
import { stepNo } from './words'
import { discardMade, finishRest, olderParked, planHashNow, startChain, undoChain, type FinishOutcome, type StartRefusal, type UndoOutcome } from './confirm'
import { startNow } from './chainRun'
import { preWhyText, problemText } from './text'
import { kindProjects } from './facts'
import type { OrderPreResult, OrderPreWhy } from './pre'
import type { OrderChain, OrderChainStep, OrderRecord } from './types'

type Tr = ReturnType<typeof useT>

/** Why a start (or "Rest anlegen") was refused, in words. */
export function refusalText(r: StartRefusal | { why: 'taken' }, t: Tr): string {
  const O = 'features.coding.order'
  switch (r.why) {
    case 'pre': {
      const b = r.block
      if (b.why === 'offline') return b.text || preWhyText('offline')
      if (b.why === 'noProject') return preWhyText('noProject', b.unusable.map((u) => ({ kind: u.kind, project: null, problem: u.problem })))
      return preWhyText(b.why as OrderPreWhy)
    }
    case 'kind':
      return t(`${O}.start.why.kind`, { n: stepNo(r.step), problem: problemText(r.problem) })
    case 'draft': {
      const issue = r.issues[0]
      return t(`${O}.start.why.draft`, { n: stepNo(r.step), problem: issue ? t(`${O}.draft.${issue.code}`, { repo: '', branch: '', ...(issue.vars ?? {}) }) : '' })
    }
    case 'repo':
      return t(`${O}.start.why.repo`, { n: stepNo(r.step) })
    case 'props':
      return t(`${O}.start.why.props.${r.result}`, { n: stepNo(r.step) })
    case 'failed':
      return t(`${O}.start.why.failed`, { n: stepNo(r.step), error: r.error })
    case 'taken':
      return t(`${O}.undo.taken`)
    default:
      return t(`${O}.start.why.${r.why}`)
  }
}

/** A VON HAND key: acts only on a fresh press ≥ 300 ms after it became ready; `aria-disabled` with its reason. */
function HandKey({ ready, reason, onPress, children, primary, testId }: { ready: boolean; reason?: string; onPress: () => void; children: ReactNode; primary?: boolean; testId: string }) {
  const t = useT()
  const readyAt = useRef(0)
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!ready) {
      setArmed(false)
      return
    }
    readyAt.current = Date.now()
    const id = window.setTimeout(() => setArmed(true), 300)
    return () => window.clearTimeout(id)
  }, [ready])
  const live = ready && armed
  const why = !ready ? reason : !armed ? t('features.coding.order.key.readying') : undefined
  return (
    <button
      type="button"
      className={`btn btn--sm${primary ? ' btn--primary' : ''}`}
      aria-disabled={!live || undefined}
      title={why}
      data-testid={testId}
      data-ready={live ? '' : undefined}
      onKeyDown={(e) => {
        // a held key never presses it (a repeat began before it was ready)
        if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault()
      }}
      onClick={() => {
        if (!live || Date.now() - readyAt.current < 300) return
        onPress()
      }}
    >
      {children}
    </button>
  )
}

/** A goal's Markdown links as their labels (the plate shows the text; B8 draws the goal as its blocks). */
const MD_LINK = /\[((?:\\.|[^\]\\\n])*)\]\(\s*<?[^)\s>]*>?(?:\s+"[^"\n]*")?\s*\)/g
const goalText = (md: string): string => md.replace(MD_LINK, (_all, label: string) => label.replace(/\\(.)/g, '$1'))

/** One step's state on this device, as a word beside its LED. */
type Lane = 'parked' | 'running' | 'waiting' | 'failed' | 'done' | 'trashed' | 'queued'
const LANE_LED: Record<Lane, 'off' | 'on' | 'ok'> = { parked: 'off', running: 'on', waiting: 'on', failed: 'on', done: 'ok', trashed: 'off', queued: 'off' }

function StepRow({ step, chain }: { step: OrderChainStep; chain: OrderChain }) {
  const t = useT()
  const page = useWorkspace((s) => s.pages[step.id])
  const db = useWorkspace((s) => (page?.databaseId ? s.databases[page.databaseId] : undefined))
  const local = useTaskLocal(step.id)
  const busy = useCoding((s) => s.busy.some((b) => b.taskId === step.id))
  useEffect(() => void loadTask(step.id), [step.id])
  let lane: Lane = 'queued'
  let stageName = ''
  if (!page || page.trashed || !db) lane = 'trashed'
  else {
    const pipeline = readPipeline(db)
    const props = codingProps(db)
    const stage = stageOfRow(pipeline, props, page)
    stageName = stage?.name ?? ''
    const repo = props.repo ? page.properties[props.repo] : null
    const park = startStageOf(pipeline, !!repo, false)
    if (stage?.kind === 'done') lane = 'done'
    else if (busy || local.state === 'running') lane = 'running'
    else if (local.state === 'failed' || local.state === 'stopped') lane = 'failed'
    else if (local.state === 'question' || stage?.kind === 'gate') lane = 'waiting'
    else if (chain.advanced?.[step.n] === undefined && stage?.id === park?.id) lane = 'parked'
  }
  return (
    <li className="orc-row" data-lane={lane} data-testid="order-chain-row">
      <span className="orc-row__state">
        {lane === 'parked' || lane === 'trashed' ? <span className="orp-ring" aria-hidden /> : <Led state={LANE_LED[lane]} />}
        <span className="label">{t(`features.coding.order.lane.${lane}`)}</span>
      </span>
      <span className="orc-row__n label">{stepNo(step.n)}</span>
      <a className="orc-row__title" href={`#/p/${step.id}`} title={page?.title}>
        {page?.title || step.title || '—'}
      </a>
      <span className="orc-row__stage label">{stageName}</span>
    </li>
  )
}

/** Seconds left until `at` (ticks while counting). */
function useLeft(at: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (at === null) return
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [at])
  return at === null ? 0 : Math.max(0, Math.ceil((at - now) / 1000))
}

export default function ChainPart({ rowId, rec, ready, pre, headId, viewer, aside }: { rowId: ID; rec: OrderRecord; ready: boolean; pre: OrderPreResult; headId: string; viewer: boolean; aside?: ReactNode }) {
  const t = useT()
  const lang = useLang()
  const O = 'features.coding.order'
  const [note, setNote] = useState<string | null>(null)
  const [hash, setHash] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // the plan as it resolves now (projects, pipelines, this device's Approvals): what ↵ confirms
  const databases = useWorkspace((s) => s.databases)
  const draft = rec.state === 'draft' && ready ? rec.draft : undefined
  useEffect(() => {
    let live = true
    if (!draft) return setHash(null)
    void planHashNow(rowId, draft).then((h) => live && setHash(h))
    return () => {
      live = false
    }
  }, [rowId, draft, databases])
  useEffect(() => setNote(null), [rec.state])
  const focusHead = () => window.setTimeout(() => document.getElementById(headId)?.focus(), 0)
  const chain = rec.chain
  const sorted = chain ? [...chain.steps].sort((a, b) => a.n - b.n) : []
  const first = sorted[0]
  const counting = rec.state === 'running' && !!chain && !chain.halted && !!first && chain.advanced?.[first.n] === undefined
  const left = useLeft(counting ? chain!.startAt : null)

  const start = useCallback(async () => {
    if (!draft || !hash || pending) return
    setPending(true)
    const out = await startChain(rowId, hash)
    setPending(false)
    if (!out.ok) {
      setNote(refusalText(out, t))
      if (out.why === 'changed') void planHashNow(rowId, draft).then(setHash)
      return
    }
    focusHead()
  }, [draft, hash, pending, rowId, t])
  const undo = useCallback(async () => {
    const out: UndoOutcome = await undoChain(rowId)
    if (out.ok) {
      useUI.getState().toast({ message: t(`${O}.chain.undone`), kind: 'info' })
      focusHead()
    } else setNote(t(`${O}.undo.${out.why}`))
  }, [rowId, t])
  const now = useCallback(() => void startNow(rowId), [rowId])
  const after = (out: FinishOutcome) => {
    if (out.ok) focusHead()
    else setNote(refusalText(out, t))
  }

  // the keys: with focus anywhere in the plate (its heading too), never while typing, never on a repeat
  const root = useRef<HTMLDivElement>(null)
  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  keys.current = (e: KeyboardEvent) => {
    if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || viewer || !counting) return
    const el = e.target as HTMLElement
    if (typing(el)) return
    // a focused key acts by itself (Enter clicks it)
    if (e.key === 'Enter' && !el.closest('button, a, [role="button"]')) {
      e.preventDefault()
      now()
    } else if (e.key === 'z' || e.key === 'Z') {
      e.preventDefault()
      void undo()
    }
  }

  let body: ReactNode = null
  if (draft && draft.plan.steps.length) {
    const projects = kindProjects(rowId)
    const older = olderParked(rec)
    const base = rec.chain ? Math.max(...rec.chain.steps.map((s) => s.n)) : 0
    const foreign = !!draft.source.server
    body = (
      <>
        <ol className="orc-steps" data-testid="order-plan-steps">
          {draft.plan.steps.map((st, i) => {
            const kp = projects.find((k) => k.kind === st.kind)
            const project = { title: kp?.title || t(`features.coding.pipe.${st.kind}`), made: !kp?.project }
            return (
              <li key={i} className="orc-step" data-testid="order-plan-step">
                <p className="orc-step__head">
                  <span className="label orc-step__n">{stepNo(base + i + 1)}</span>
                  <span className="label">{t(`features.coding.pipe.${st.kind}`)}</span>
                  <strong className="orc-step__title">{st.title}</strong>
                  {foreign && <span className="label orc-foreign">{t(`${O}.plan.foreign`)}</span>}
                </p>
                <p className="orc-step__meta label">
                  {t(project.made ? `${O}.plan.projectNew` : `${O}.plan.project`, { name: project.title })} · {st.repo ? t(`${O}.plan.repo`, { repo: st.repo }) : t(`${O}.plan.noRepo`)}
                </p>
                {st.why && <p className="orc-step__why">{st.why}</p>}
                <p className="orc-step__goal">{goalText(st.goal)}</p>
                {st.criteria.length > 0 && (
                  <ul className="orc-step__criteria" aria-label={t(`${O}.plan.criteria`)}>
                    {st.criteria.map((c, k) => (
                      <li key={k}>{c}</li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ol>
        {older.length > 0 && (
          <p className="orc-line" data-testid="order-plan-older">
            {t(`${O}.plan.older`, { list: older.length > 1 ? `${stepNo(older[0]!.n)}–${stepNo(older[older.length - 1]!.n)}` : stepNo(older[0]!.n) })}
          </p>
        )}
        {!viewer && (
          <div className="orp-keys">
            {aside}
            <HandKey ready={pre.ok && !!hash && !pending} reason={!pre.ok ? preWhyText(pre.why, pre.left) : undefined} onPress={() => void start()} primary testId="order-start">
              <span className="kbd" aria-hidden>
                ↵
              </span>
              {t(foreign ? `${O}.key.startForeign` : `${O}.key.start`)}
            </HandKey>
          </div>
        )}
      </>
    )
  } else if (rec.state === 'creating') {
    body = (
      <p className="orc-line" role="status" data-testid="order-chain-creating">
        {t(`${O}.chain.creating`)}
      </p>
    )
  } else if (rec.state === 'interrupted' && chain) {
    const made = chain.steps.filter((s) => useWorkspace.getState().pages[s.id]).length
    body = (
      <>
        <p className="orc-line orc-line--warn" data-testid="order-chain-interrupted">
          {t(`${O}.chain.interrupted`, { made, total: chain.steps.length })}
        </p>
        {!viewer && (
          <div className="orp-keys">
            <HandKey ready onPress={() => void discardMade(rowId).then(after)} testId="order-discard-made">
              {t(`${O}.key.discardMade`)}
            </HandKey>
            <HandKey ready={pre.ok} reason={!pre.ok ? preWhyText(pre.why, pre.left) : undefined} onPress={() => void finishRest(rowId).then(after)} primary testId="order-finish-rest">
              {t(`${O}.key.finishRest`)}
            </HandKey>
          </div>
        )}
      </>
    )
  } else if (chain && (rec.state === 'running' || rec.state === 'halted' || rec.state === 'done')) {
    const halt = chain.halted
    body = (
      <>
        <ol className="orc-lane" data-testid="order-chain">
          {sorted.map((st) => (
            <StepRow key={st.id} step={st} chain={chain} />
          ))}
        </ol>
        {halt ? (
          <p className="orc-line orc-line--warn" data-testid="order-chain-halted">
            {t(`${O}.chain.halted`, { why: t(`${O}.halt.${halt.why}`, { n: halt.step !== undefined ? stepNo(halt.step) : '' }) })}
          </p>
        ) : counting ? (
          <div className="orc-count" data-testid="order-countdown">
            <p className="orc-line" aria-live="polite">
              {t(`${O}.chain.countdown`, { n: stepNo(first!.n), s: new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US').format(left) })}
            </p>
            {!viewer && (
              <span className="orc-count__keys">
                <button type="button" className="btn btn--sm" onClick={now} data-testid="order-start-now">
                  <span className="kbd" aria-hidden>
                    ↵
                  </span>
                  {t(`${O}.key.startNow`)}
                </button>
                <button type="button" className="btn btn--sm" onClick={() => void undo()} data-testid="order-undo">
                  <span className="kbd" aria-hidden>
                    Z
                  </span>
                  {t(`${O}.key.undoChain`)}
                </button>
              </span>
            )}
          </div>
        ) : rec.state === 'running' ? (
          <p className="orc-line" data-testid="order-chain-taken">
            {t(`${O}.chain.taken`)}
          </p>
        ) : null}
      </>
    )
  }
  const hasBody = !!body
  useEffect(() => {
    const plate = root.current?.closest('section')
    if (!plate) return
    const on = (e: Event) => keys.current(e as KeyboardEvent)
    plate.addEventListener('keydown', on)
    return () => plate.removeEventListener('keydown', on)
  }, [hasBody])
  if (!body) return null
  return (
    <div className="orc" ref={root} data-testid="order-chain-part">
      <p className="label orc-title">
        § {t(`${O}.plan.title`)} · {t(`${O}.plan.steps.${(draft?.plan.steps.length ?? chain?.steps.length ?? 0) === 1 ? 'one' : 'other'}`, { n: draft?.plan.steps.length ?? chain?.steps.length ?? 0 })}
      </p>
      {body}
      {note && (
        <p className="orc-line orc-line--warn" role="alert" data-testid="order-chain-note">
          {note}
        </p>
      )}
    </div>
  )
}
