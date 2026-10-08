/**
 * Custom agents — the run history of one agent: one instrument row per run (LED, trigger, start,
 * duration, cost), unfolding to the report, the step chips (tools, MCP calls, notes) and the review
 * of what the run staged (apply all / one, discard; the workspace agent's diff UI).
 */
import { useState, type ReactNode } from 'react'
import { ChevronRight, ExternalLink, Undo2 } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { openPage } from '../../lib/router'
import { useCloud } from '../../cloud'
import { useLang, useT } from '../../i18n'
import { MarkdownLite } from '../ai/MarkdownLite'
import { MediaToPage } from '../ai/media/MediaToPage'
import { PropDiff, Preview } from '../ai/agent/AgentSheet'
import { EditDiff } from '../ai/agent/EditDiff'
import type { StagedChange } from '../ai/agent/types'
import { canUndoRun, undoRun } from './exec'
import { applyRun, discardRun } from './review'
import { awaitsReview, putRun } from './runs'
import { fmtDuration, fmtUsd, fmtWhen, statusLed } from './format'
import type { AgentRun } from './types'

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
          {run.usage ? fmtUsd(run.usage.usd) : '—'}
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
            <p className="agx-run__usage mono">
              IN {run.usage.input.toLocaleString()} · CACHE {run.usage.cacheRead.toLocaleString()} · OUT {run.usage.output.toLocaleString()} · ≈ {fmtUsd(run.usage.usd)}
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

function Review({ run }: { run: AgentRun }) {
  const t = useT()
  const readOnly = useCloud((s) => s.readOnly)
  const changes = run.staged ?? []
  const open = changes.filter((c) => c.status === 'pending' || c.status === 'failed').length
  const applied = changes.filter((c) => c.status === 'applied').length
  const undoable = run.runner === 'browser' && canUndoRun(run.id)
  const disabled = readOnly || run.status === 'running'
  // a long batch (upsert_rows: one change per row): what is open, by kind — the head stays in view while scrolling
  const kinds = new Map<StagedChange['kind'], number>()
  for (const c of changes) if (c.status === 'pending' || c.status === 'failed') kinds.set(c.kind, (kinds.get(c.kind) ?? 0) + 1)
  const long = changes.length > LONG_REVIEW
  return (
    <section className="agx-review" data-long={long || undefined} aria-label={t(changes.length === 1 ? 'features.agent.review.title.one' : 'features.agent.review.title.other', { count: changes.length })}>
      <div className="agx-review__head">
        <span className="label">{t(changes.length === 1 ? 'features.agent.review.title.one' : 'features.agent.review.title.other', { count: changes.length })}</span>
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
            onClick={() => {
              const kept = undoRun(run.id)
              if (kept === null) return
              void putRun({ ...run, staged: changes.map((c) => (c.status === 'applied' ? { ...c, status: 'pending' } : c)), applied: 0, status: run.status === 'ok' ? 'staged' : run.status })
              useUI.getState().toast(kept ? t(kept === 1 ? 'features.agent.toast.undoneKept.one' : 'features.agent.toast.undoneKept.other', { count: kept }) : t('features.agent.toast.undone'))
            }}
          >
            <Undo2 size={12} strokeWidth={1.75} aria-hidden /> {t('features.agents.review.undo')}
          </button>
        )}
        {open > 0 && (
          <>
            <button type="button" className="btn btn--ghost btn--sm" disabled={disabled} onClick={() => void discardRun(run, null)}>
              {t('features.agent.review.discardAll')}
            </button>
            <button type="button" className="btn btn--primary btn--sm" disabled={disabled} onClick={() => void applyRun(run)}>
              {t('features.agent.review.applyAll')}
            </button>
          </>
        )}
      </div>
      {readOnly && open > 0 && <p className="agx-note">{t('features.agent.review.readOnly')}</p>}
      <ol className="agent-changes agx-changes">
        {changes.map((c) => (
          <Change key={c.id} run={run} change={c} disabled={disabled} />
        ))}
      </ol>
    </section>
  )
}

function Change({ run, change: c, disabled }: { run: AgentRun; change: StagedChange; disabled: boolean }) {
  const t = useT()
  const pages = useWorkspace((s) => s.pages)
  const all = run.staged ?? []
  const titleOf = (id: string | null | undefined) => {
    if (!id) return ''
    const staged = all.find((x) => (x.kind === 'create_page' || x.kind === 'create_row') && x.pageId === id)
    if (staged && !pages[id]) return staged.title ?? ''
    return pages[id]?.title.trim() || t('common.untitled')
  }
  const parent = c.dependsOn ? all.find((x) => x.id === c.dependsOn) : undefined
  const blocked = !!parent && parent.status !== 'applied'
  let where = ''
  if (c.kind === 'create_page') where = c.parentId ? t('features.agent.review.under', { title: titleOf(c.parentId) }) : t('features.agent.review.topLevel')
  else if (c.kind === 'create_row' || c.kind === 'update_row') where = t('features.agent.review.in', { title: titleOf(c.databaseId) })
  const label = `#${c.n}`
  const targetId = run.rowIds?.[c.pageId] ?? c.pageId
  const target = c.status === 'applied' && pages[targetId] && !pages[targetId].trashed ? targetId : null
  let title: ReactNode = c.title
  if (c.kind === 'rename')
    title = (
      <>
        <s className="agent-diff__before">{c.beforeTitle}</s> <span className="agent-diff__arrow">→</span> {c.title}
      </>
    )
  else if (c.kind === 'append' || c.kind === 'update_row' || c.kind === 'edit') title = titleOf(targetId) || c.title
  return (
    <li className="agent-change" data-status={c.status} data-kind={c.kind} aria-label={`${label} ${t(`features.agent.kind.${c.kind}`)}`}>
      <div className="agent-change__head">
        <span className="agent-change__n mono">{label}</span>
        <span className="agent-change__kind label">{t(`features.agent.kind.${c.kind}`)}</span>
        {where && <span className="agent-change__where">{where}</span>}
        <span className="agent-spacer" />
        {c.status === 'pending' || c.status === 'failed' ? (
          <span className="agent-change__actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void discardRun(run, c.id)} disabled={disabled} aria-label={`${t('features.agent.review.discard')} ${label}`}>
              {t('features.agent.review.discard')}
            </button>
            <button
              type="button"
              className="btn btn--sm btn--ink"
              onClick={() => void applyRun(run, [c.id])}
              disabled={disabled || blocked}
              aria-label={`${t('features.agent.review.apply')} ${label}`}
              title={blocked && parent ? t('features.agent.review.needs', { n: parent.n }) : undefined}
            >
              {t('features.agent.review.apply')}
            </button>
          </span>
        ) : c.status === 'applied' ? (
          <span className="agent-change__actions">
            <span className="agent-change__state label">
              <span className="led led--ok" aria-hidden /> {t('features.agent.review.applied')}
            </span>
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
        ) : (
          <span className="agent-change__actions">
            <span className="agent-change__state label">{t('features.agent.review.discarded')}</span>
          </span>
        )}
      </div>
      {title && <div className="agent-change__title">{title}</div>}
      {c.props && c.props.length > 0 && <PropDiff props={c.props} />}
      {c.kind === 'edit' && <EditDiff change={c} />}
      {c.markdown?.trim() && c.kind !== 'rename' && c.kind !== 'edit' && <Preview markdown={c.markdown} append={c.kind === 'append'} />}
      {c.status === 'failed' && c.error && <p className="agent-change__error">{t(c.kind === 'edit' ? 'features.agent.review.skipped' : 'features.agent.review.failed', { error: c.error })}</p>}
      {blocked && parent && c.status === 'pending' && <p className="agent-change__hint label">{t('features.agent.review.needs', { n: parent.n })}</p>}
    </li>
  )
}
