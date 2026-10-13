/**
 * Custom agents — the run history of one agent: one instrument row per run (LED, trigger, start,
 * duration, cost), unfolding to the report, the step chips (tools, MCP calls, notes — notes wrap, never cut) and the
 * review of what the run staged (apply all / one, discard; the workspace agent's diff UI). ONE proposal applied or
 * discarded keeps its result in its row with an Undo there (no toast over the next key). The review's keys (trust/
 * runKeys.ts, the same map as Preflight): on a proposal's row ↵ / A apply, Del / D discard, 1 (or F / W) wrong, 2 not
 * now, 3 duplicate, 4 handled already — each a verdict of the person on that proposal (trust/book.ts); Z undoes a
 * decision in its row; J / K move between rows with a key. Keys act only where the buttons would (read only, a run
 * still going, "needs #n" — the live region says why). After a decision focus goes to the next open proposal's row,
 * the heading once none is left; after an Undo to that row — never the page body. Key caps, the orange Apply and the
 * reasons row show only on the row holding the focus; touch screens get "Discard ▾" with the reasons instead.
 * Numbers in the UI's language. Fits 390 px.
 */
import { memo, useEffect, useId, useMemo, useReducer, useRef, useState, type KeyboardEvent, type MouseEvent, type MutableRefObject, type ReactNode, type RefObject } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, Undo2 } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { openPage } from '../../lib/router'
import { useCloud } from '../../cloud'
import { t, useLang, useT } from '../../i18n'
import { MarkdownLite } from '../ai/MarkdownLite'
import { costText, sourceText } from '../ai/Receipt'
import { readLines } from '../ai/core/meter'
import { labelOf } from '@/shared/ai/models'
import { JEV_DEFAULTS, isJevSnapshot } from '@/shared/ai/jev'
import { JevLine } from '../ai/decide/ui/JevLine'
import { jevName } from '../ai/decide/text'
import { fmtTokens } from '../ai/agent/CostOut'
import { MediaToPage } from '../ai/media/MediaToPage'
import { PropDiff, Preview } from '../ai/agent/AgentSheet'
import { EditDiff } from '../ai/agent/EditDiff'
import { depsOf, makesTasks, onEjected, type DiscardReason, type StagedChange } from '../ai/agent/types'
import { ItemFacts } from '../workitems/ItemFacts'
import type { Database, Page } from '../../store/types'
import { keyPropOf } from '../../store/keys'
import { typing } from '../../ui/keys'
import { isMac } from '../../ui/controls'
import { canUndoRun } from './undos'
import { applyRun, canUndoChange, canUndoDiscard, discardRun, undoChange, undoDiscard, undoRunAll } from './review'
import { rowShortcuts, runKeyOf, wrongLetter } from './trust/runKeys'
import { ReasonsRow, ReasonsTouch } from './trust/ui/Reasons'
import { useCoarse } from './trust/ui/coarse'
import { serverErrorText } from './server'
import { awaitsReview } from './runs'
import { fmtDuration, fmtUsd, fmtWhen, statusKey, statusLed } from './format'
import type { AgentRun } from './types'

/** A server run could not be read again before a review (nothing was done): said in a toast. */
const notRead = (e: unknown) => {
  console.warn('[one] agents: the server run could not be read', e)
  useUI.getState().toast({ message: `${t('features.agents.review.serverRead')} ${serverErrorText(e)}`, kind: 'error' })
}

const pad = (n: number) => String(n).padStart(2, '0')

export function RunHistory({ runs, empty }: { runs: AgentRun[]; empty: ReactNode }) {
  const t = useT()
  if (!runs.length) return <div className="agx-empty">{empty}</div>
  return (
    <ol className="agx-runs" aria-label={t('features.agents.runs.title')}>
      {runs.map((r, i) => (
        <RunItem key={r.id} run={r} n={runs.length - i} first={i === 0} />
      ))}
    </ol>
  )
}

function RunItem({ run, n, first }: { run: AgentRun; n: number; first: boolean }) {
  const t = useT()
  const lang = useLang()
  const review = awaitsReview(run)
  const [open, setOpen] = useState(review || (first && run.status !== 'skipped'))
  const id = `agx-run-${run.id}`
  // a day's not-started record spans the starts it counts — it has no duration
  const dur = run.held?.kind === 'notStarted' ? '—' : run.endedAt ? fmtDuration(run.endedAt - run.startedAt) : '…'
  // proposals waiting for the person: a change a Vorprüfer held back counts (ChangeStatus 'held', slice SJ) — a run the
  // Regler held (AgentRunStatus 'held') is the run's own status, its proposals count by theirs
  const pending = (run.staged ?? []).filter((c) => c.status === 'pending' || c.status === 'failed' || c.status === 'held').length
  return (
    <li className="agx-run" data-status={run.status} data-review={review || undefined}>
      <button type="button" className="agx-run__head" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <ChevronRight size={14} strokeWidth={1.8} className="agx-run__chev" aria-hidden />
        <span className={statusLed(run.status)} aria-hidden />
        <span className="agx-run__n mono">#{pad(n)}</span>
        <span className="agx-run__status label">{t(statusKey(run.status))}</span>
        <span className="agx-run__trig">{t(`features.agents.trig.${run.trigger.type}`)}{run.trigger.detail && run.trigger.type !== 'schedule' ? ` · ${run.trigger.detail}` : ''}</span>
        <span className="agx-spacer" />
        {review && (
          <span className="agx-run__badge label">
            {t(pending === 1 ? 'features.agents.review.badge.one' : 'features.agents.review.badge.other', { count: pending })}
          </span>
        )}
        <span className="agx-run__meta agx-run__meta--when mono">{fmtWhen(t, run.startedAt, lang)}</span>
        <span className="agx-run__meta agx-run__meta--dur mono">{dur}</span>
        <span className="agx-run__meta agx-run__meta--usd mono" data-testid="agx-run-usd">
          {run.usage ? fmtUsd(run.usage.usd, lang) : '—'}
        </span>
      </button>
      {open && (
        <div className="agx-run__body" id={id}>
          {run.status === 'held' && run.held ? (
            <HeldLine run={run} held={run.held} />
          ) : (
            run.error && (
              <p className="agx-run__err" role={first ? 'alert' : undefined}>
                <span className="label">ERR</span> {run.error}
              </p>
            )
          )}
          {!!run.pruned && <p className="agx-run__pruned label">{t(run.pruned === 1 ? 'features.governor.run.pruned.one' : 'features.governor.run.pruned.other', { count: run.pruned })}</p>}
          {run.summary.trim() ? (
            <div className="agx-run__summary">
              <span className="label">{t('features.agents.runs.report')}</span>
              <MarkdownLite source={run.summary} />
            </div>
          ) : run.status === 'running' ? (
            <p className="agx-run__wait label">
              <span className="led led--on agx-led--live" aria-hidden /> {t('features.agents.runs.working')}
            </p>
          ) : null}
          {!!run.media?.length && <RunMedia run={run} />}
          {run.steps.length > 0 && <Steps run={run} />}
          {(run.staged?.length ?? 0) > 0 && <Review run={run} />}
          {run.usage && <UsageLine usage={run.usage} />}
          {!!run.usage?.byModel?.length && <ModelLines lines={run.usage.byModel} />}
        </div>
      )}
    </li>
  )
}

/**
 * A run the Regler held (status 'held', features/governor): stopped between two steps — the line that bound, its
 * proposals waiting, the old state kept — or the day's record of starts it did not let begin ("Today 3 × not started:
 * the day budget is used up (6,00 $ of 6,00 $). Next run as planned." and the times).
 */
function HeldLine({ run, held }: { run: AgentRun; held: NonNullable<AgentRun['held']> }) {
  const t = useT()
  const lang = useLang()
  const money = (x: number | undefined) => (x === undefined ? '—' : fmtUsd(x, lang))
  if (held.kind === 'stopped')
    return (
      <div className="agx-run__held" data-testid="agx-run-held" data-held="stopped">
        <span className="label">{t('features.governor.run.held.title')}</span>
        <span>{t(`features.governor.run.stopped.${held.binding}`, { budget: money(held.limit) })}</span>
        <span className="agx-run__held-sub">{t('features.governor.run.held.state')}</span>
      </div>
    )
  const count = held.count ?? 1
  const today = new Date(run.startedAt).toDateString() === new Date().toDateString()
  const times = (held.times ?? [run.startedAt]).map((x) => {
    const d = new Date(x)
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  })
  const why = t(`features.governor.run.notStarted.why.${held.binding}`, { spent: money(held.spent), budget: money(held.limit) })
  return (
    <div className="agx-run__held" data-testid="agx-run-held" data-held="notStarted">
      <span className="label">{t('features.governor.run.held.title')}</span>
      <span>{t('features.governor.run.notStarted.line', { count: t(today ? 'features.governor.run.notStarted.today' : 'features.governor.run.notStarted.past', { count }), why })}</span>
      <span className="agx-run__held-sub mono">{t('features.governor.run.notStarted.times', { times: times.join(' · ') })}</span>
    </div>
  )
}

/**
 * The run's usage in one line. With its lines per model (browser runs since receipts) IN is the input outside the
 * cache, as in the lines and the terminal; "≈" only when a response was estimated. Older and server runs counted cache
 * writes into their input: their line says so (IN + CACHE W) and stays an estimate.
 */
function UsageLine({ usage }: { usage: NonNullable<AgentRun['usage']> }) {
  const lang = useLang()
  const n = (x: number) => x.toLocaleString(lang)
  const lines = readLines(usage.byModel)
  if (!lines.length)
    return (
      <p className="agx-run__usage mono" data-testid="agx-run-usage">
        IN + CACHE W {n(usage.input)} · CACHE R {n(usage.cacheRead)} · OUT {n(usage.output)} · ≈ {fmtUsd(usage.usd, lang)}
      </p>
    )
  const sum = lines.reduce((a, l) => ({ input: a.input + l.input, write: a.write + l.cacheWrite, read: a.read + l.cacheRead, output: a.output + l.output }), { input: 0, write: 0, read: 0, output: 0 })
  const estimated = lines.some((l) => l.source === 'estimate')
  return (
    <p className="agx-run__usage mono" data-testid="agx-run-usage">
      IN {n(sum.input)} · CACHE W/R {n(sum.write)}/{n(sum.read)} · OUT {n(sum.output)} · {estimated ? '≈ ' : ''}
      {fmtUsd(usage.usd, lang)}
    </p>
  )
}

/** The run's receipt per model: one line per provider × model that answered — requests, tokens, the price and its source. */
function ModelLines({ lines }: { lines: unknown }) {
  const t = useT()
  const lang = useLang()
  const list = readLines(lines)
  if (!list.length) return null
  const n = (x: number) => x.toLocaleString(lang)
  return (
    <ul className="agx-run__models" aria-label={t('features.agents.runs.byModel')}>
      {list.map((l) => {
        // a Vorprüfer's decisions (slice SJ): input only, the output is free
        const jev = l.p === 'openrouter' && isJevSnapshot(l.model)
        const name = jev ? `${jevName(l.model)} · ${t('features.ai.jev.cost.role')}` : labelOf({ p: l.p, m: l.model })
        const tokens = jev
          ? t('features.ai.jev.cost.tokens', { requests: l.requests, input: fmtTokens(l.input, lang), output: fmtTokens(l.output, lang) })
          : t('features.agents.runs.modelLine', { requests: l.requests, input: n(l.input), write: n(l.cacheWrite), read: n(l.cacheRead), output: n(l.output) })
        const src = sourceText(t, l.usd, l.source)
        // the whole line as a title: a name or token figures cut short stay readable
        return (
          <li key={`${l.p}:${l.model}`} className="agx-run__model" data-testid="agx-run-model" data-model={`${l.p}:${l.model}`} title={[name, tokens, costText(t, lang, l.usd, l.source), src].filter(Boolean).join(' · ')}>
            <span className="agx-run__model-name">{name}</span>
            <span className="agx-run__model-tok">{tokens}</span>
            <span className="agx-run__model-usd">{costText(t, lang, l.usd, l.source)}</span>
            {src && <span className="agx-run__model-src">{src}</span>}
          </li>
        )
      })}
    </ul>
  )
}

/** Media the run's MCP servers returned: "Save to One" puts them into the agent's report page (else a new page). */
function RunMedia({ run }: { run: AgentRun }) {
  const reportPage = useWorkspace((s) => s.agents?.[run.agentId]?.output?.pageId ?? null)
  const readOnly = useCloud((s) => s.readOnly)
  return <MediaToPage items={run.media ?? []} pageId={reportPage} disabled={readOnly} />
}

function Steps({ run }: { run: AgentRun }) {
  const t = useT()
  return (
    <ul className="agx-steps" aria-label={t('features.agents.runs.steps')}>
      {run.steps.map((s, i) => (
        // a Vorprüfer's step: its check, or the run it made wait (amber — caution, not an error)
        <li key={i} className="agx-step" data-kind={s.kind} data-state={s.state} data-jev={s.jev && (s.jev === 'wait' || s.state === 'err') ? 'wait' : s.jev} title={s.label}>
          <span className={s.jev && (s.jev === 'wait' || s.state === 'err') ? 'led agx-led--amber' : s.state === 'err' ? 'led agx-led--err' : s.kind === 'note' ? 'led' : 'led led--ok'} aria-hidden />
          <span className="agx-step__text">{s.label}</span>
        </li>
      ))}
    </ul>
  )
}

/** More proposals than this: the review's head (counts, Apply all) stays in view while scrolling. */
const LONG_REVIEW = 8

const isOpen = (c: StagedChange) => c.status === 'pending' || c.status === 'failed'
/** A row a person decides on: open, or held back by the agent's Vorprüfer (slice SJ — its own key, never "Apply all"). */
const reviewable = (c: StagedChange) => isOpen(c) || c.status === 'held'
/** Held back or marked by the Vorprüfer (an open change Jev has concerns about). */
const concern = (c: StagedChange) => reviewable(c) && (c.status === 'held' || !!c.jev?.mark || !!c.jev?.sticky)
/** What a row's Jev line says in its frame: held · marked (an amber edge) — nothing for a clear one. */
const jevState = (c: StagedChange): 'held' | 'marked' | undefined => (!reviewable(c) ? undefined : c.status === 'held' ? 'held' : c.jev?.mark || c.jev?.sticky ? 'marked' : undefined)

const SORT_JEV = 'one.agents.sortJev'
function readSortJev(): boolean {
  try {
    return localStorage.getItem(SORT_JEV) === '1'
  } catch {
    return false
  }
}
function writeSortJev(on: boolean) {
  try {
    if (on) localStorage.setItem(SORT_JEV, '1')
    else localStorage.removeItem(SORT_JEV)
  } catch {
    /* storage refused: this view only */
  }
}

/**
 * Where focus goes once a key acted (D15): after Apply / Discard the next open proposal's row (by number, wrapping to the
 * first; never the one just decided) or the heading once none is left; after an Undo that row; Apply all → the heading.
 */
type FocusTo = { row: string } | { after: number; not: string } | 'head'

/** Move focus inside the review once the store has the run's new state. Rows, never a key inside them. */
function focusIn(root: RefObject<HTMLElement | null>, to: FocusTo) {
  requestAnimationFrame(() => {
    const el = root.current
    if (!el) return
    const head = el.querySelector<HTMLElement>('.agx-review__title')
    let target: HTMLElement | null = null
    if (to === 'head') target = head
    else if ('row' in to) target = el.querySelector<HTMLElement>(`li.agent-change[data-change="${CSS.escape(to.row)}"]`)
    else {
      const open = [...el.querySelectorAll<HTMLElement>('li.agent-change[data-status="pending"], li.agent-change[data-status="failed"], li.agent-change[data-status="held"]')].filter((li) => li.dataset.change !== to.not)
      target = open.find((li) => Number(li.dataset.n) > to.after) ?? open[0] ?? null
    }
    ;(target ?? head)?.focus()
  })
}

/** Proposals of one field and one value this run discarded as wrong, their Undo gone: one quiet row ("Wrong × 3"). */
function quietGroups(run: AgentRun, changes: StagedChange[]): Map<string, StagedChange[]> {
  const groups = new Map<string, StagedChange[]>()
  for (const c of changes) {
    if (c.status !== 'discarded' || c.reason !== 'wrong' || c.kind !== 'update_row' || c.props?.length !== 1 || canUndoDiscard(run.id, c.id)) continue
    const k = `${c.props[0].propId}|${c.props[0].after}`
    groups.set(k, [...(groups.get(k) ?? []), c])
  }
  for (const [k, list] of groups) if (list.length < 2) groups.delete(k)
  return groups
}

/** What a row asks of its review — ONE stable object for every row (memoised rows; it acts on the run as shown now). */
interface RowHandlers {
  focus(id: string): void
  touch(id: string): void
  apply(id: string): void
  discard(id: string, reason: DiscardReason | null): void
  undo(id: string): void
  /** the row's body was shown whole ("Show n more lines"): a decision on it counts as seen in full */
  whole(id: string): void
}

/** The review's live region: one region that stays, each announcement a new node inside it (read even when repeated). */
function Live({ say }: { say: MutableRefObject<(text: string) => void> }) {
  const [live, setLive] = useState({ text: '', k: 0 })
  useEffect(() => {
    say.current = (text) => setLive((l) => ({ text, k: l.k + 1 }))
  }, [say])
  return (
    <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
      {live.text ? <span key={live.k}>{live.text}</span> : null}
    </p>
  )
}

function Review({ run }: { run: AgentRun }) {
  const t = useT()
  const lang = useLang()
  const coarse = useCoarse()
  const root = useRef<HTMLElement>(null)
  const sayRef = useRef<(text: string) => void>(() => {})
  // rows whose cut body the person opened whole (this mount)
  const whole = useRef(new Set<string>())
  const readOnly = useCloud((s) => s.readOnly)
  const pages = useWorkspace((s) => s.pages)
  const databases = useWorkspace((s) => s.databases)
  // a row's Undo can go without the run changing (nothing left to put back): draw again then
  const [, redraw] = useReducer((x: number) => x + 1, 0)
  // what a row's own Undo did (undone; some of it kept because it was edited since) — shown while it is open again
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [current, setCurrent] = useState<string | null>(null)
  const [touchOpen, setTouchOpen] = useState<string | null>(null)
  const staged = run.staged ?? []
  // "Concerns first" (per device): the proposals Jev held back or marked lead — the numbers stay
  const [jevFirst, setJevFirst] = useState(readSortJev)
  const flagged = staged.some((c) => reviewable(c) && concern(c))
  const changes = jevFirst && flagged ? [...staged.filter((c) => concern(c)), ...staged.filter((c) => !concern(c))] : staged
  const open = changes.filter(isOpen).length
  const held = changes.filter((c) => c.status === 'held').length
  const applied = changes.filter((c) => c.status === 'applied').length
  const undoable = run.runner === 'browser' && canUndoRun(run.id)
  const disabled = readOnly || run.status === 'running'
  const inert = readOnly ? 'readOnly' : run.status === 'running' ? 'running' : null
  // a long batch (upsert_rows: one change per row): what is open, by kind — the head stays in view while scrolling
  const kinds = new Map<StagedChange['kind'], number>()
  const fields = new Map<string, number>()
  for (const c of changes) {
    if (!reviewable(c)) continue
    kinds.set(c.kind, (kinds.get(c.kind) ?? 0) + 1)
    if (c.kind === 'update_row') for (const p of c.props ?? []) fields.set(p.name, (fields.get(p.name) ?? 0) + 1)
  }
  const long = changes.length > LONG_REVIEW
  const headId = `agx-review-${run.id}`
  const keysId = `agx-review-keys-${run.id}`
  const say = (text: string) => sayRef.current(text)
  const byId = (id: string) => changes.find((x) => x.id === id)
  // the first change it builds on that is not applied yet (dependsOn, then needs)
  const blockedBy = (c: StagedChange) =>
    depsOf(c)
      .map(byId)
      .find((x) => x && x.status !== 'applied') ?? null
  // an ejected change has no key here: the eject's own Undo gives it back (never a row's Undo, never Apply again) — nor
  // a discarded one that builds on it (its discard's Undo could never make it applicable; another tab's eject too)
  const ejectedOrOn = onEjected(changes)
  const undoOf = (c: StagedChange): 'apply' | 'discard' | null =>
    c.status === 'applied' && canUndoChange(run.id, c.id) ? 'apply' : c.status === 'discarded' && !ejectedOrOn.has(c.id) && canUndoDiscard(run.id, c.id) ? 'discard' : null
  const quiet = quietGroups(run, changes)
  const quietOf = new Map<string, StagedChange[]>()
  for (const list of quiet.values()) for (const c of list) quietOf.set(c.id, list)
  const clearNote = (id: string) => setNotes((m) => (m[id] ? { ...m, [id]: '' } : m))

  // the person's decision on ONE proposal (a verdict per field: judged — a cut body only once shown whole)
  const apply = (c: StagedChange) => {
    clearNote(c.id)
    // ONE row: a held proposal goes only this way (`single`)
    void applyRun(run, [c.id], { row: true, judged: true, whole: whole.current.has(c.id), single: true }).then((res) => {
      if (res?.applied.includes(c.id)) say(t('features.agents.trust.live.applied', { n: c.n }))
      focusIn(root, { after: c.n, not: c.id })
    }, notRead)
  }
  const discard = (c: StagedChange, reason: DiscardReason | null) => {
    clearNote(c.id)
    setTouchOpen(null)
    // its Undo is kept in its row (and the rows of its cascade) before the run is stored
    void discardRun(run, c.id, { undo: true, row: true, judged: true, whole: whole.current.has(c.id), ...(reason ? { reason } : {}) }).then((out) => {
      if (out.refused) {
        // the server did not take it: nothing was discarded
        useUI.getState().toast({ message: out.refused, kind: 'error' })
        say(out.refused)
        focusIn(root, { row: c.id })
        return
      }
      if (out.dropped.includes(c.id))
        say(reason ? t('features.agents.trust.live.discardedWhy', { reason: t(`features.agents.trust.why.${reason}`), n: c.n }) : t('features.agents.trust.live.discarded', { n: c.n }))
      focusIn(root, { after: c.n, not: c.id })
    }, notRead)
  }
  const undo = (c: StagedChange) => {
    const how = undoOf(c)
    if (how === 'apply')
      void undoChange(run, c.id).then((kept) => {
        setNotes((m) => ({ ...m, [c.id]: kept ? t(kept === 1 ? 'features.agent.toast.undoneKept.one' : 'features.agent.toast.undoneKept.other', { count: kept }) : t('features.agent.toast.undone') }))
        if (kept !== null) say(t('features.agents.trust.live.undone', { n: c.n }))
        focusIn(root, { row: c.id })
      })
    else if (how === 'discard')
      void undoDiscard(run.id, c.id).then((ok) => {
        redraw()
        if (ok) say(t('features.agents.trust.live.undone', { n: c.n }))
        focusIn(root, { row: c.id })
      })
  }
  const inertSay = (c: StagedChange, needs: boolean) => {
    const p = needs ? blockedBy(c) : null
    if (inert) say(t(`features.agents.trust.live.inert.${inert}`))
    else if (p) say(t('features.agents.trust.live.inert.needs', { n: p.n }))
  }

  // the rows' handlers: one object for the review's life, always acting on what this render shows
  const act = useRef({ apply, discard, undo, byId })
  act.current = { apply, discard, undo, byId }
  const handlers = useMemo<RowHandlers>(
    () => ({
      focus: (id) => setCurrent(id),
      touch: (id) => setTouchOpen((x) => (x === id ? null : id)),
      apply: (id) => {
        const c = act.current.byId(id)
        if (c) act.current.apply(c)
      },
      discard: (id, reason) => {
        const c = act.current.byId(id)
        if (c) act.current.discard(c, reason)
      },
      undo: (id) => {
        const c = act.current.byId(id)
        if (c) act.current.undo(c)
      },
      whole: (id) => void whole.current.add(id),
    }),
    [],
  )

  // the keys (trust/runKeys.ts): only where the buttons would act, never while typing
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.defaultPrevented || typing(e.target as Element)) return
    const li = (e.target as HTMLElement).closest<HTMLElement>('li.agent-change[data-keys]')
    const key = runKeyOf(e, lang, !!li && e.target === li)
    if (!key) return
    // a key the review takes is its own: prevented, and nothing behind it sees it
    const take = () => {
      e.preventDefault()
      e.stopPropagation()
    }
    if (key.kind === 'next' || key.kind === 'prev') {
      const rows = [...(root.current?.querySelectorAll<HTMLElement>('li.agent-change[data-keys]') ?? [])]
      if (!rows.length) return
      take()
      const at = li ? rows.indexOf(li) : -1
      const to = at < 0 ? (key.kind === 'next' ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, at + (key.kind === 'next' ? 1 : -1)))
      rows[to].focus()
      return
    }
    const c = li ? changes.find((x) => x.id === li.dataset.change) : undefined
    if (!c) return
    if (key.kind === 'undo') {
      if (!undoOf(c)) return
      take()
      if (disabled) inertSay(c, false)
      else undo(c)
      return
    }
    if (!reviewable(c)) return
    take()
    if (key.kind === 'apply') {
      if (disabled || blockedBy(c)) inertSay(c, true)
      else apply(c)
    } else if (disabled) inertSay(c, false)
    else discard(c, key.reason)
  }

  // roving: the row last focused (else the first with a key) is the one Tab reaches
  const keyRows = changes.filter((c) => reviewable(c) || undoOf(c))
  const tabRow = keyRows.some((c) => c.id === current) ? current : (keyRows[0]?.id ?? null)
  const letter = wrongLetter(lang).toUpperCase()

  return (
    <section ref={root} className="agx-review" data-long={long || undefined} aria-labelledby={headId} onKeyDown={onKeyDown}>
      <div className="agx-review__head">
        <h3 className="agx-review__title label" id={headId} tabIndex={-1}>
          {t(changes.length === 1 ? 'features.agent.review.title.one' : 'features.agent.review.title.other', { count: changes.length })}
        </h3>
        {kinds.size > 0 && (long || kinds.size > 1) && (
          <span className="agx-review__counts mono" data-testid="agx-review-counts">
            {[...kinds].sort((a, b) => b[1] - a[1]).map(([kind, n]) => t('features.agents.review.count', { count: n, kind: t(`features.agent.kind.${kind}`) })).join(' · ')}
          </span>
        )}
        <span className="agx-spacer" />
        {flagged && (
          <button
            type="button"
            className="btn btn--ghost btn--sm agx-sortjev"
            aria-pressed={jevFirst}
            title={t('features.ai.jev.sortHint')}
            data-testid="agx-sort-jev"
            onClick={() => {
              setJevFirst(!jevFirst)
              writeSortJev(!jevFirst)
            }}
          >
            {t('features.ai.jev.sort')}
          </button>
        )}
        {undoable && applied > 0 && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() =>
              void undoRunAll(run).then((kept) => {
                if (kept !== null) focusIn(root, 'head')
              })
            }
          >
            <Undo2 size={12} strokeWidth={1.75} aria-hidden /> {t('features.agents.review.undo')}
          </button>
        )}
        {open + held > 0 && (
          <>
            <button type="button" className="btn btn--ghost btn--sm" disabled={disabled} onClick={() => void discardRun(run, null).then(() => focusIn(root, 'head'), notRead)}>
              {t('features.agent.review.discardAll')}
            </button>
            {/* held proposals stay out of "Apply all" (each has its own key) */}
            <button type="button" className="btn btn--primary btn--sm" data-testid="agx-apply-all" disabled={disabled || !open} onClick={() => void applyRun(run).then(() => focusIn(root, 'head'), notRead)}>
              {held ? t(held === 1 ? 'features.ai.jev.applyAll.except.one' : 'features.ai.jev.applyAll.except.other', { n: held }) : t('features.agent.review.applyAll')}
            </button>
          </>
        )}
      </div>
      {open > 0 && (fields.size > 0 || !coarse) && (
        <div className="agx-review__sub">
          {fields.size > 0 && (
            <span
              className="label agx-review__fields"
              data-testid="agx-review-fields"
              aria-label={t('features.agents.trust.review.fieldsAria', { list: [...fields].map(([name, n]) => `${name} ${n}`).join(', ') })}
            >
              {[...fields]
                .sort((a, b) => b[1] - a[1])
                .map(([name, n]) => t('features.agents.trust.review.fields', { name, n }))
                .join(' · ')}
            </span>
          )}
          {!coarse && (
            <span className="agx-review__hint" aria-hidden="true">
              <kbd className="kbd">J</kbd>
              <kbd className="kbd">K</kbd> {t('features.agents.trust.review.select')}
            </span>
          )}
        </div>
      )}
      {readOnly && open > 0 && <p className="agx-note">{t('features.agent.review.readOnly')}</p>}
      <p id={keysId} className="visually-hidden">
        {t('features.agents.trust.review.keys', { wrong: letter })}
      </p>
      <ol className="agent-changes agx-changes">
        {changes.map((c) => {
          const group = quietOf.get(c.id)
          if (group) return group[0].id === c.id ? <QuietRow key={c.id} run={run} list={group} pages={pages} databases={databases} /> : null
          return (
            <Change
              key={c.id}
              run={run}
              change={c}
              disabled={disabled}
              blocked={blockedBy(c)}
              undo={undoOf(c)}
              note={notes[c.id] ?? ''}
              tab={tabRow === c.id}
              active={current === c.id}
              keysId={keysId}
              coarse={coarse}
              touchOpen={touchOpen === c.id}
              h={handlers}
            />
          )
        })}
      </ol>
      <Live say={sayRef} />
    </section>
  )
}

/**
 * A row's keys keep the focus where it is on a mouse press: the row holding the focus shows key caps, so a press that
 * moved the focus into the row would widen its keys between press and release (the click would miss). The decision
 * moves the focus on itself (D15).
 */
const keepFocus = (e: MouseEvent) => e.preventDefault()

interface ChangeProps {
  run: AgentRun
  change: StagedChange
  disabled: boolean
  blocked: StagedChange | null
  undo: 'apply' | 'discard' | null
  note: string
  /** the review's roving tab stop */
  tab: boolean
  /** the row last focused: its key caps and reasons row are drawn (trust.css shows them while it holds the focus) */
  active: boolean
  keysId: string
  coarse: boolean
  touchOpen: boolean
  h: RowHandlers
}

/**
 * A memoised row: it draws again only when what it shows changed — its proposal, its state, its focus marks — never
 * because another row took the focus or the review announced something. `run` itself counts by its id and row ids
 * (a decision stores the run anew; the rows that did not change keep their proposal objects, runs.ts).
 */
const sameRow = (a: ChangeProps, b: ChangeProps) =>
  a.change === b.change &&
  a.run.id === b.run.id &&
  a.run.rowIds === b.run.rowIds &&
  a.disabled === b.disabled &&
  a.blocked === b.blocked &&
  a.undo === b.undo &&
  a.note === b.note &&
  a.tab === b.tab &&
  a.active === b.active &&
  a.keysId === b.keysId &&
  a.coarse === b.coarse &&
  a.touchOpen === b.touchOpen &&
  a.h === b.h

const Change = memo(function Change({ run, change: c, disabled, blocked, undo, note, tab, active, keysId, coarse, touchOpen, h }: ChangeProps) {
  const t = useT()
  const lang = useLang()
  const id = useId()
  const [full, setFull] = useState(false)
  const all = run.staged ?? []
  const untitled = t('common.untitled')
  // only what this row shows of the workspace: a write elsewhere draws no row again
  const where = useWorkspace((s) =>
    c.kind === 'create_page'
      ? c.parentId
        ? t('features.agent.review.under', { title: titleIn(s.pages, all, c.parentId, untitled) })
        : t('features.agent.review.topLevel')
      : c.kind === 'create_row' || c.kind === 'update_row'
        ? t('features.agent.review.in', { title: titleIn(s.pages, all, c.databaseId, untitled) })
        : '',
  )
  const label = `#${c.n}`
  const targetId = run.rowIds?.[c.pageId] ?? c.pageId
  const target = useWorkspace((s) => (c.status === 'applied' && s.pages[targetId] && !s.pages[targetId].trashed ? targetId : null))
  const open = reviewable(c)
  const held = c.status === 'held'
  const keys = open || !!undo
  const touchId = `agx-touch-${run.id}-${c.id}`
  const caps = active && !coarse
  // folded (a discard keeping its Undo here): the title is not drawn — the row's name still says it
  const folded = undo === 'discard'
  const hiddenTitle = useWorkspace((s) => (folded ? titleText(s.pages, run, c, untitled) : ''))
  // described by: its state (decided), its field changes, its tasks (a task's fields, the tasks a text makes, why it
  // waits for review), why it waits or failed, then the keys
  const hint = (c.status === 'failed' && !!c.error) || (c.status === 'pending' && !!blocked)
  const items = !!c.workItem || !!c.items || !!c.notes?.length
  const describedBy = keys
    ? [open ? '' : `${id}-s`, c.held && c.status === 'applied' ? `${id}-h` : '', !folded && c.props?.length ? `${id}-d` : '', !folded && items ? `${id}-i` : '', !folded && hint ? `${id}-x` : '', keysId].filter(Boolean).join(' ')
    : undefined
  const undoKey = (
    <button type="button" className="btn btn--ghost btn--sm agent-change__undo" onMouseDown={keepFocus} onClick={() => h.undo(c.id)} disabled={disabled} aria-label={`${t('common.undo')} ${label}`}>
      <Undo2 size={12} strokeWidth={1.75} aria-hidden /> {t('common.undo')}
      {caps && (
        <kbd className="kbd agt-cap" aria-hidden="true">
          Z
        </kbd>
      )}
    </button>
  )
  return (
    <li
      className="agent-change"
      data-status={c.status}
      data-kind={c.kind}
      data-jev={jevState(c)}
      data-change={c.id}
      data-n={c.n}
      data-keys={keys || undefined}
      // a row with keys takes the focus: its name is its number, kind and title; its state, field change and keys describe it
      aria-label={keys ? undefined : `${label} ${t(`features.agent.kind.${c.kind}`)}`}
      aria-labelledby={keys ? `${id}-n ${id}-k ${id}-t` : undefined}
      tabIndex={keys ? (tab ? 0 : -1) : undefined}
      aria-keyshortcuts={keys ? rowShortcuts(lang, open) : undefined}
      aria-describedby={describedBy}
      onFocus={keys ? () => h.focus(c.id) : undefined}
    >
      <div className="agent-change__head">
        <span className="agent-change__n mono" id={`${id}-n`}>
          {label}
        </span>
        <span className="agent-change__kind label" id={`${id}-k`}>
          {t(`features.agent.kind.${c.kind}`)}
        </span>
        {where && <span className="agent-change__where">{where}</span>}
        <span className="agent-spacer" />
        {open ? (
          <span className="agent-change__actions">
            {held && (
              <span className="jev-cap agx-held-cap" data-testid="agx-held">
                {t('features.ai.jev.cap.held')}
              </span>
            )}
            <button
              type="button"
              className="btn btn--sm btn--ink agt-apply"
              onMouseDown={keepFocus}
              onClick={() => h.apply(c.id)}
              disabled={disabled || !!blocked}
              aria-label={`${held ? t('features.ai.jev.applyAlone') : t('features.agent.review.apply')} ${label}`}
              aria-keyshortcuts={coarse ? undefined : 'Enter A'}
              title={blocked ? t('features.agent.review.needs', { n: blocked.n }) : undefined}
            >
              {caps && (
                <kbd className="kbd agt-cap" aria-hidden="true">
                  ↵
                </kbd>
              )}
              {held ? t('features.ai.jev.applyAlone') : t('features.agent.review.apply')}
            </button>
            {coarse ? (
              <button type="button" className="btn btn--sm agt-discard" onClick={() => h.touch(c.id)} disabled={disabled} aria-expanded={touchOpen} aria-controls={touchId} aria-label={t('features.agents.trust.touch.open', { n: c.n })}>
                {t('features.agent.review.discard')}
                <ChevronDown size={13} strokeWidth={1.8} aria-hidden className="agt-discard__chev" />
              </button>
            ) : (
              <button type="button" className="btn btn--ghost btn--sm agt-discard" onMouseDown={keepFocus} onClick={() => h.discard(c.id, null)} disabled={disabled} aria-label={`${t('features.agent.review.discard')} ${label}`} aria-keyshortcuts="Delete D">
                {caps && (
                  <kbd className="kbd agt-cap" aria-hidden="true">
                    {isMac ? t('features.agents.trust.key.delMac') : t('features.agents.trust.key.del')}
                  </kbd>
                )}
                {t('features.agent.review.discard')}
              </button>
            )}
          </span>
        ) : c.status === 'applied' ? (
          <span className="agent-change__actions">
            <span className="agent-change__state label" id={`${id}-s`}>
              <span className="led led--ok" aria-hidden /> {t('features.agent.review.applied')}
            </span>
            {c.held && (
              // an eject held it: another writer changed its place since, so it stays applied (its Undo still here)
              <span className="agent-change__state agent-change__state--held label" data-testid="agx-held" id={`${id}-h`}>
                {t('features.agents.review.held')}
              </span>
            )}
            {undo === 'apply' && undoKey}
            {target && (
              <button
                type="button"
                className="btn btn--ghost btn--sm agent-change__open"
                onClick={() => (c.kind === 'create_row' || c.kind === 'update_row' ? useUI.getState().openPeek(target) : openPage(target))}
                aria-label={`${t('features.agent.review.open')} ${label}`}
              >
                <ExternalLink size={12} strokeWidth={1.75} aria-hidden /> {t('features.agent.review.open')}
              </button>
            )}
          </span>
        ) : c.status === 'superseded' ? (
          // a newer run's proposal for the same row (with at least these fields) replaces it: no keys, never counted
          <span className="agent-change__actions">
            <span className="agent-change__state label" data-testid="agx-superseded" id={`${id}-s`}>
              {c.supersededBy ? t('features.agents.review.superseded', { when: fmtWhen(t, c.supersededBy.at, lang) }) : t('features.agents.review.supersededPlain')}
            </span>
          </span>
        ) : c.ejected ? (
          // the flight recorder took its writes back: no keys, never open again (the eject's own Undo gives it back)
          <span className="agent-change__actions">
            <span className="agent-change__state label" data-testid="agx-ejected" id={`${id}-s`}>
              {t('features.agents.review.ejected', { when: fmtWhen(t, c.ejected.at, lang) })}
            </span>
          </span>
        ) : (
          <span className="agent-change__actions">
            <span className="agent-change__state label" data-testid="agx-discarded" id={`${id}-s`}>
              {c.reason ? t('features.agents.trust.row.discardedWhy', { reason: t(`features.agents.trust.why.${c.reason}`) }) : t('features.agent.review.discarded')}
            </span>
            {undo === 'discard' && undoKey}
          </span>
        )}
      </div>
      {note && c.status === 'pending' && (
        <p className="agent-change__note" role="status">
          {note}
        </p>
      )}
      {/* a discard that keeps its Undo here reads as one line: the body folds away (its title stays the row's name) */}
      {folded ? (
        <span className="visually-hidden" id={`${id}-t`}>
          {hiddenTitle}
        </span>
      ) : (
        <AgentChangeBody
          run={run}
          change={c}
          ids={id}
          full={full}
          capped
          more={{
            label: (rest) => t(rest === 1 ? 'features.agents.trust.review.more.one' : 'features.agents.trust.review.more.other', { count: rest }),
            less: t('features.agents.trust.review.less'),
            run: () => {
              setFull((f) => !f)
              h.whole(c.id)
            },
          }}
        />
      )}
      {open && caps && <ReasonsRow n={c.n} disabled={disabled} onPick={(r) => h.discard(c.id, r)} />}
      {open && coarse && touchOpen && <ReasonsTouch id={touchId} n={c.n} disabled={disabled} onPick={(r) => h.discard(c.id, r)} />}
    </li>
  )
}, sameRow)

/** "WRONG × 3 · ~~NL-216~~ ~~NL-217~~ ~~NL-218~~ · Klarheit → Blockiert": discarded as wrong, no Undo any more. */
function QuietRow({ run, list, pages, databases }: { run: AgentRun; list: StagedChange[]; pages: Record<string, Page>; databases: Record<string, Database> }) {
  const t = useT()
  const p = list[0].props![0]
  const keys = list.map((c) => {
    const row = pages[run.rowIds?.[c.pageId] ?? c.pageId]
    const key = row?.databaseId ? keyPropOf(databases[row.databaseId]) : undefined
    const v = key && row ? row.properties[key.id] : undefined
    return (typeof v === 'string' || typeof v === 'number' ? String(v) : '') || row?.title.trim() || c.title || `#${c.n}`
  })
  // the drawn line is for the eye; the sentence beside it says the same in words (read in browse mode too)
  return (
    <li className="agx-quiet" data-testid="agx-quiet" data-n={list[0].n}>
      <span className="visually-hidden">{t('features.agents.trust.quiet.aria', { n: list.length, keys: keys.join(', '), field: p.name, value: p.after || '—' })}</span>
      <span className="agx-quiet__stamp" aria-hidden="true">
        {t('features.agents.trust.quiet.wrong', { n: list.length })}
      </span>
      <span className="agx-quiet__keys" aria-hidden="true">
        {keys.map((k, i) => (
          <s key={i}>{k}</s>
        ))}
      </span>
      <span className="agx-quiet__chg" aria-hidden="true">
        {p.name} <span className="agent-diff__arrow">→</span> <span className="agx-quiet__after">{p.after || '—'}</span>
      </span>
    </li>
  )
}

/** A page's title for the review: a page the run proposed and that does not exist yet by its proposed title. */
function titleIn(pages: Record<string, Page>, all: StagedChange[], id: string | null | undefined, untitled: string): string {
  if (!id) return ''
  const staged = all.find((x) => (x.kind === 'create_page' || x.kind === 'create_row') && x.pageId === id)
  if (staged && !pages[id]) return staged.title ?? ''
  return pages[id]?.title.trim() || untitled
}

/** The title a proposal's body shows, in words (a rename: "old → new"). */
function titleText(pages: Record<string, Page>, run: AgentRun, c: StagedChange, untitled: string): string {
  if (c.kind === 'rename') return `${c.beforeTitle ?? ''} → ${c.title ?? ''}`
  if (c.kind === 'append' || c.kind === 'update_row' || c.kind === 'edit') return titleIn(pages, run.staged ?? [], run.rowIds?.[c.pageId] ?? c.pageId, untitled) || c.title || ''
  // a task's fields: its title, on its page
  if (c.kind === 'workItem') return `${c.title ?? ''} · ${titleIn(pages, run.staged ?? [], run.rowIds?.[c.pageId] ?? c.pageId, untitled)}`
  return c.title ?? ''
}

/** The agent's mark threshold now (review v2), else the start value. */
function markBelowOf(review: unknown): number {
  const r = review as { v?: unknown; pre?: { markBelow?: unknown } } | null | undefined
  const m = r && r.v === 2 ? r.pre?.markBelow : undefined
  return typeof m === 'number' && m >= 0.3 && m <= 0.95 ? m : JEV_DEFAULTS.markBelow
}

/** The run read text from outside — mails, MCP results — or started on rows it did not write: Jev's high values are no guarantee. */
const foreignRun = (run: AgentRun): boolean => !!run.touched?.some((c) => c === 'mail' || c === 'mcp') || run.trigger.type === 'row_created'

interface BodyProps {
  run: AgentRun
  change: StagedChange
  /** the row's id prefix: the title gets `<ids>-t`, the field changes `<ids>-d`, the tasks `<ids>-i`, "needs #n" / the error `<ids>-x` */
  ids?: string
  /** the cut content preview: shown whole, and the key that opens it (the run review; Preflight shows the cut one) */
  full?: boolean
  more?: { label: (rest: number) => string; less: string; run: () => void }
  /** the row's head carries the HELD BACK cap already (the run review): the Jev line leaves its own out */
  capped?: boolean
}

/**
 * A custom agent's proposal as the run history shows it: its title (a rename: the old title struck), property diffs,
 * the word diff of an edit, the content preview, the error and "needs #n" — every part with `data-part`. The run
 * history's rows render it, and so does Preflight's card: both show the same parts.
 */
export function AgentChangeBody({ run, change: c, ids, full, more, capped }: BodyProps) {
  const t = useT()
  const all = run.staged ?? []
  // the first change it builds on that is not applied yet (dependsOn, then needs)
  const parent = depsOf(c)
    .map((id) => all.find((x) => x.id === id))
    .find((x) => x && x.status !== 'applied')
  const blocked = !!parent
  const untitled = t('common.untitled')
  // only the title of what it is about: a write elsewhere draws it not again
  const text = useWorkspace((s) => titleText(s.pages, run, c, untitled))
  // the threshold the run marked below: as the run had it (its record), else the agent's now, else the start value
  const markBelow = useWorkspace((s) => run.jev?.markBelow ?? markBelowOf(s.agents?.[run.agentId]?.review))
  const id = (part: string) => (ids ? `${ids}-${part}` : undefined)
  const title: ReactNode =
    c.kind === 'rename' ? (
      <>
        <s className="agent-diff__before">{c.beforeTitle}</s> <span className="agent-diff__arrow">→</span> {c.title}
      </>
    ) : (
      text
    )
  return (
    <>
      {title && (
        <div className="agent-change__title" data-part="title" id={id('t')}>
          {title}
        </div>
      )}
      {c.jev && (c.status === 'pending' || c.status === 'held' || c.status === 'failed') && (
        <JevLine check={c.jev} markBelow={markBelow} foreign={foreignRun(run)} capped={capped && c.status === 'held'} />
      )}
      {c.props && c.props.length > 0 && (
        <div className="chg-part" data-part="props" id={id('d')}>
          <PropDiff props={c.props} />
        </div>
      )}
      {c.kind === 'edit' && (
        <div className="chg-part" data-part="edit">
          <EditDiff change={c} />
        </div>
      )}
      {(c.items || c.workItem || !!c.notes?.length) && (
        <div className="chg-part" data-part="items" id={id('i')}>
          <ItemFacts facts={c.workItem ? [c.workItem.facts] : (c.items?.facts ?? [])} warnings={c.items?.warnings} holds={c.workItem?.holds ?? c.items?.holds} notes={c.notes} />
        </div>
      )}
      {c.markdown?.trim() && c.kind !== 'rename' && c.kind !== 'edit' && (
        <div className="chg-part" data-part="preview">
          <Preview markdown={c.markdown} append={c.kind === 'append'} full={full} more={more} tasks={makesTasks(c, run.runner === 'server')} />
        </div>
      )}
      {c.status === 'failed' && c.error && (
        <p className="agent-change__error" data-part="error" id={id('x')}>
          {t(c.kind === 'edit' ? 'features.agent.review.skipped' : 'features.agent.review.failed', { error: c.error })}
        </p>
      )}
      {blocked && parent && c.status === 'pending' && (
        <p className="agent-change__hint label" data-part="needs" id={id('x')}>
          {t('features.agent.review.needs', { n: parent.n })}
        </p>
      )}
    </>
  )
}
