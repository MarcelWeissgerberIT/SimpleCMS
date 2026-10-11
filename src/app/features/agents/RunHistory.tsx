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
import { useReducer, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, Undo2 } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { openPage } from '../../lib/router'
import { useCloud } from '../../cloud'
import { t, useLang, useT } from '../../i18n'
import { MarkdownLite } from '../ai/MarkdownLite'
import { MediaToPage } from '../ai/media/MediaToPage'
import { PropDiff, Preview } from '../ai/agent/AgentSheet'
import { EditDiff } from '../ai/agent/EditDiff'
import type { DiscardReason, StagedChange } from '../ai/agent/types'
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
import { fmtDuration, fmtUsd, fmtWhen, statusLed } from './format'
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
  const dur = run.endedAt ? fmtDuration(run.endedAt - run.startedAt) : '…'
  const pending = (run.staged ?? []).filter((c) => c.status === 'pending' || c.status === 'failed').length
  return (
    <li className="agx-run" data-status={run.status} data-review={review || undefined}>
      <button type="button" className="agx-run__head" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <ChevronRight size={14} strokeWidth={1.8} className="agx-run__chev" aria-hidden />
        <span className={statusLed(run.status)} aria-hidden />
        <span className="agx-run__n mono">#{pad(n)}</span>
        <span className="agx-run__status label">{t(`features.agents.status.${run.status}`)}</span>
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
          {run.error && (
            <p className="agx-run__err" role={first ? 'alert' : undefined}>
              <span className="label">ERR</span> {run.error}
            </p>
          )}
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
          {run.usage && (
            <p className="agx-run__usage mono" data-testid="agx-run-usage">
              IN {run.usage.input.toLocaleString(lang)} · CACHE {run.usage.cacheRead.toLocaleString(lang)} · OUT {run.usage.output.toLocaleString(lang)} · ≈ {fmtUsd(run.usage.usd, lang)}
            </p>
          )}
        </div>
      )}
    </li>
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
        <li key={i} className="agx-step" data-kind={s.kind} data-state={s.state} title={s.label}>
          <span className={s.state === 'err' ? 'led agx-led--err' : s.kind === 'note' ? 'led' : 'led led--ok'} aria-hidden />
          <span className="agx-step__text">{s.label}</span>
        </li>
      ))}
    </ul>
  )
}

/** More proposals than this: the review's head (counts, Apply all) stays in view while scrolling. */
const LONG_REVIEW = 8

const isOpen = (c: StagedChange) => c.status === 'pending' || c.status === 'failed'

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
      const open = [...el.querySelectorAll<HTMLElement>('li.agent-change[data-status="pending"], li.agent-change[data-status="failed"]')].filter((li) => li.dataset.change !== to.not)
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

function Review({ run }: { run: AgentRun }) {
  const t = useT()
  const lang = useLang()
  const coarse = useCoarse()
  const root = useRef<HTMLElement>(null)
  const readOnly = useCloud((s) => s.readOnly)
  const pages = useWorkspace((s) => s.pages)
  const databases = useWorkspace((s) => s.databases)
  // the Undo kept for a discarded row is registered after the run is stored: draw again once it is there
  const [, redraw] = useReducer((x: number) => x + 1, 0)
  // what a row's own Undo did (undone; some of it kept because it was edited since) — shown while it is open again
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [live, setLive] = useState({ text: '', k: 0 })
  const [current, setCurrent] = useState<string | null>(null)
  const [touchOpen, setTouchOpen] = useState<string | null>(null)
  const changes = run.staged ?? []
  const open = changes.filter(isOpen).length
  const applied = changes.filter((c) => c.status === 'applied').length
  const undoable = run.runner === 'browser' && canUndoRun(run.id)
  const disabled = readOnly || run.status === 'running'
  const inert = readOnly ? 'readOnly' : run.status === 'running' ? 'running' : null
  // a long batch (upsert_rows: one change per row): what is open, by kind — the head stays in view while scrolling
  const kinds = new Map<StagedChange['kind'], number>()
  const fields = new Map<string, number>()
  for (const c of changes) {
    if (!isOpen(c)) continue
    kinds.set(c.kind, (kinds.get(c.kind) ?? 0) + 1)
    if (c.kind === 'update_row') for (const p of c.props ?? []) fields.set(p.name, (fields.get(p.name) ?? 0) + 1)
  }
  const long = changes.length > LONG_REVIEW
  const headId = `agx-review-${run.id}`
  const keysId = `agx-review-keys-${run.id}`
  const say = (text: string) => setLive((l) => ({ text, k: l.k + 1 }))
  const parentOf = (c: StagedChange) => (c.dependsOn ? changes.find((x) => x.id === c.dependsOn) : undefined)
  const blockedBy = (c: StagedChange) => {
    const p = parentOf(c)
    return p && p.status !== 'applied' ? p : null
  }
  const undoOf = (c: StagedChange): 'apply' | 'discard' | null =>
    c.status === 'applied' && canUndoChange(run.id, c.id) ? 'apply' : c.status === 'discarded' && canUndoDiscard(run.id, c.id) ? 'discard' : null
  const quiet = quietGroups(run, changes)
  const quietOf = new Map<string, StagedChange[]>()
  for (const list of quiet.values()) for (const c of list) quietOf.set(c.id, list)

  // the person's decision on ONE proposal (a verdict per field: judged)
  const apply = (c: StagedChange) => {
    setNotes((m) => ({ ...m, [c.id]: '' }))
    void applyRun(run, [c.id], { row: true, judged: true }).then((res) => {
      if (res?.applied.includes(c.id)) say(t('features.agents.trust.live.applied', { n: c.n }))
      focusIn(root, { after: c.n, not: c.id })
    }, notRead)
  }
  const discard = (c: StagedChange, reason: DiscardReason | null) => {
    setNotes((m) => ({ ...m, [c.id]: '' }))
    setTouchOpen(null)
    void discardRun(run, c.id, { undo: true, judged: true, ...(reason ? { reason } : {}) }).then((out) => {
      redraw()
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

  // the keys (trust/runKeys.ts): only where the buttons would act, never while typing
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.defaultPrevented || typing(e.target as Element)) return
    const li = (e.target as HTMLElement).closest<HTMLElement>('li.agent-change[data-keys]')
    const key = runKeyOf(e, lang, !!li && e.target === li)
    if (!key) return
    if (key.kind === 'next' || key.kind === 'prev') {
      const rows = [...(root.current?.querySelectorAll<HTMLElement>('li.agent-change[data-keys]') ?? [])]
      if (!rows.length) return
      e.preventDefault()
      const at = li ? rows.indexOf(li) : -1
      const to = at < 0 ? (key.kind === 'next' ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, at + (key.kind === 'next' ? 1 : -1)))
      rows[to].focus()
      return
    }
    const c = li ? changes.find((x) => x.id === li.dataset.change) : undefined
    if (!c) return
    if (key.kind === 'undo') {
      if (!undoOf(c)) return
      e.preventDefault()
      if (disabled) inertSay(c, false)
      else undo(c)
      return
    }
    if (!isOpen(c)) return
    e.preventDefault()
    if (key.kind === 'apply') {
      if (disabled || blockedBy(c)) inertSay(c, true)
      else apply(c)
    } else if (disabled) inertSay(c, false)
    else discard(c, key.reason)
  }

  // roving: the row last focused (else the first with a key) is the one Tab reaches
  const keyRows = changes.filter((c) => isOpen(c) || undoOf(c))
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
        {open > 0 && (
          <>
            <button type="button" className="btn btn--ghost btn--sm" disabled={disabled} onClick={() => void discardRun(run, null).then(() => focusIn(root, 'head'), notRead)}>
              {t('features.agent.review.discardAll')}
            </button>
            <button type="button" className="btn btn--primary btn--sm" disabled={disabled} onClick={() => void applyRun(run).then(() => focusIn(root, 'head'), notRead)}>
              {t('features.agent.review.applyAll')}
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
              tabRow={tabRow}
              keysId={keysId}
              coarse={coarse}
              touchOpen={touchOpen === c.id}
              onTouch={() => setTouchOpen((x) => (x === c.id ? null : c.id))}
              onFocus={() => setCurrent(c.id)}
              onApply={() => apply(c)}
              onDiscard={(r) => discard(c, r)}
              onUndo={() => undo(c)}
            />
          )
        })}
      </ol>
      <p className="visually-hidden" role="status" aria-live="polite" key={live.k}>
        {live.text}
      </p>
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
  tabRow: string | null
  keysId: string
  coarse: boolean
  touchOpen: boolean
  onTouch: () => void
  onFocus: () => void
  onApply: () => void
  onDiscard: (reason: DiscardReason | null) => void
  onUndo: () => void
}

function Change({ run, change: c, disabled, blocked, undo, note, tabRow, keysId, coarse, touchOpen, onTouch, onFocus, onApply, onDiscard, onUndo }: ChangeProps) {
  const t = useT()
  const lang = useLang()
  const pages = useWorkspace((s) => s.pages)
  const all = run.staged ?? []
  let where = ''
  if (c.kind === 'create_page') where = c.parentId ? t('features.agent.review.under', { title: titleIn(pages, all, c.parentId, t('common.untitled')) }) : t('features.agent.review.topLevel')
  else if (c.kind === 'create_row' || c.kind === 'update_row') where = t('features.agent.review.in', { title: titleIn(pages, all, c.databaseId, t('common.untitled')) })
  const label = `#${c.n}`
  const targetId = run.rowIds?.[c.pageId] ?? c.pageId
  const target = c.status === 'applied' && pages[targetId] && !pages[targetId].trashed ? targetId : null
  const open = isOpen(c)
  const keys = open || !!undo
  const touchId = `agx-touch-${run.id}-${c.id}`
  const undoKey = (
    <button type="button" className="btn btn--ghost btn--sm agent-change__undo" onMouseDown={keepFocus} onClick={onUndo} disabled={disabled} aria-label={`${t('common.undo')} ${label}`}>
      <Undo2 size={12} strokeWidth={1.75} aria-hidden /> {t('common.undo')}
      {!coarse && (
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
      data-change={c.id}
      data-n={c.n}
      data-keys={keys || undefined}
      aria-label={`${label} ${t(`features.agent.kind.${c.kind}`)}`}
      tabIndex={keys ? (tabRow === c.id ? 0 : -1) : undefined}
      aria-keyshortcuts={keys ? rowShortcuts(lang, open) : undefined}
      aria-describedby={keys ? keysId : undefined}
      onFocus={keys ? onFocus : undefined}
    >
      <div className="agent-change__head">
        <span className="agent-change__n mono">{label}</span>
        <span className="agent-change__kind label">{t(`features.agent.kind.${c.kind}`)}</span>
        {where && <span className="agent-change__where">{where}</span>}
        <span className="agent-spacer" />
        {open ? (
          <span className="agent-change__actions">
            <button
              type="button"
              className="btn btn--sm btn--ink agt-apply"
              onMouseDown={keepFocus}
              onClick={onApply}
              disabled={disabled || !!blocked}
              aria-label={`${t('features.agent.review.apply')} ${label}`}
              aria-keyshortcuts={coarse ? undefined : 'Enter A'}
              title={blocked ? t('features.agent.review.needs', { n: blocked.n }) : undefined}
            >
              {!coarse && (
                <kbd className="kbd agt-cap" aria-hidden="true">
                  ↵
                </kbd>
              )}
              {t('features.agent.review.apply')}
            </button>
            {coarse ? (
              <button type="button" className="btn btn--sm agt-discard" onClick={onTouch} disabled={disabled} aria-expanded={touchOpen} aria-controls={touchId} aria-label={t('features.agents.trust.touch.open', { n: c.n })}>
                {t('features.agent.review.discard')}
                <ChevronDown size={13} strokeWidth={1.8} aria-hidden className="agt-discard__chev" />
              </button>
            ) : (
              <button type="button" className="btn btn--ghost btn--sm agt-discard" onMouseDown={keepFocus} onClick={() => onDiscard(null)} disabled={disabled} aria-label={`${t('features.agent.review.discard')} ${label}`} aria-keyshortcuts="Delete D">
                <kbd className="kbd agt-cap" aria-hidden="true">
                  {isMac ? t('features.agents.trust.key.delMac') : t('features.agents.trust.key.del')}
                </kbd>
                {t('features.agent.review.discard')}
              </button>
            )}
          </span>
        ) : c.status === 'applied' ? (
          <span className="agent-change__actions">
            <span className="agent-change__state label">
              <span className="led led--ok" aria-hidden /> {t('features.agent.review.applied')}
            </span>
            {undo === 'apply' && undoKey}
            {target && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
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
            <span className="agent-change__state label" data-testid="agx-superseded">
              {c.supersededBy ? t('features.agents.review.superseded', { when: fmtWhen(t, c.supersededBy.at, lang) }) : t('features.agents.review.supersededPlain')}
            </span>
          </span>
        ) : (
          <span className="agent-change__actions">
            <span className="agent-change__state label" data-testid="agx-discarded">
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
      {/* a discard that keeps its Undo here reads as one line: the body folds away */}
      {undo !== 'discard' && <AgentChangeBody run={run} change={c} />}
      {open && !coarse && <ReasonsRow n={c.n} disabled={disabled} onPick={(r) => onDiscard(r)} />}
      {open && coarse && touchOpen && <ReasonsTouch id={touchId} n={c.n} disabled={disabled} onPick={onDiscard} />}
    </li>
  )
}

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
  return (
    <li className="agx-quiet" data-testid="agx-quiet" data-n={list[0].n} aria-label={t('features.agents.trust.quiet.aria', { n: list.length, keys: keys.join(', ') })}>
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

/**
 * A custom agent's proposal as the run history shows it: its title (a rename: the old title struck), property diffs,
 * the word diff of an edit, the content preview, the error and "needs #n" — every part with `data-part`. The run
 * history's rows render it, and so does Preflight's card: both show the same parts.
 */
export function AgentChangeBody({ run, change: c }: { run: AgentRun; change: StagedChange }) {
  const t = useT()
  const pages = useWorkspace((s) => s.pages)
  const all = run.staged ?? []
  const parent = c.dependsOn ? all.find((x) => x.id === c.dependsOn) : undefined
  const blocked = !!parent && parent.status !== 'applied'
  const targetId = run.rowIds?.[c.pageId] ?? c.pageId
  let title: ReactNode = c.title
  if (c.kind === 'rename')
    title = (
      <>
        <s className="agent-diff__before">{c.beforeTitle}</s> <span className="agent-diff__arrow">→</span> {c.title}
      </>
    )
  else if (c.kind === 'append' || c.kind === 'update_row' || c.kind === 'edit') title = titleIn(pages, all, targetId, t('common.untitled')) || c.title
  return (
    <>
      {title && (
        <div className="agent-change__title" data-part="title">
          {title}
        </div>
      )}
      {c.props && c.props.length > 0 && (
        <div className="chg-part" data-part="props">
          <PropDiff props={c.props} />
        </div>
      )}
      {c.kind === 'edit' && (
        <div className="chg-part" data-part="edit">
          <EditDiff change={c} />
        </div>
      )}
      {c.markdown?.trim() && c.kind !== 'rename' && c.kind !== 'edit' && (
        <div className="chg-part" data-part="preview">
          <Preview markdown={c.markdown} append={c.kind === 'append'} />
        </div>
      )}
      {c.status === 'failed' && c.error && (
        <p className="agent-change__error" data-part="error">
          {t(c.kind === 'edit' ? 'features.agent.review.skipped' : 'features.agent.review.failed', { error: c.error })}
        </p>
      )}
      {blocked && parent && c.status === 'pending' && (
        <p className="agent-change__hint label" data-part="needs">
          {t('features.agent.review.needs', { n: parent.n })}
        </p>
      )}
    </>
  )
}
