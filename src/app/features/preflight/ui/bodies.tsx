/**
 * The card bodies of the built-in kinds (§6): each shows what its key would act on, in full — the source's own body
 * where one exists (an agent's proposal: AgentChangeBody; the terminal's change: TerminalChangeBody, the same parts as
 * its review list), the task as the planner pinned it (the plan in full, the version exactly as hashed, the question),
 * the inbox entry, what a STATUS lamp's card fixes. Text from Claude or a source is shown as plain text, never loaded.
 */
import { lazy, type ReactNode } from 'react'
import { useLang, useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { useCloudSync } from '../../../cloud'
import { codingLogText, type TaskVersionView } from '../../coding'
import { AgentChangeBody, useAgentRuns, useServerAgents } from '../../agents'
import { useAgent } from '../../ai/agent/state'
import { FullText } from '../../ai/agent/CodingDiff'
import type { QueueItem } from '../registry'
import { agentChangeOf } from '../sources/proposals/agents'
import { terminalChangeOf } from '../sources/proposals/terminal'
import { menuRunDuplicate, menuRunOf, termMemoryOf } from '../sources/proposals/memory'
import { codingPrep, parseTaskItem } from '../sources/coding'
import { inboxItemOf } from '../sources/inbox'
import { fmtWhen } from '../format'
import { tn } from '../sources/util'

const TerminalChangeBody = lazy(() => import('../../ai/agent/AgentSheet').then((m) => ({ default: m.TerminalChangeBody })))

const Gone = () => {
  const t = useT()
  return <p className="pf-card__gone">{t('features.preflight.card.gone')}</p>
}

/** A row of label · value (the card's field list). */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pf-f">
      <span className="label">{label}</span>
      <span className="pf-f__v">{children}</span>
    </div>
  )
}

function ProposalBody({ item, expanded }: { item: QueueItem; expanded: boolean }) {
  const t = useT()
  // re-render with the stored run (another tab's patch, this tab's apply)
  useAgentRuns((s) => s.byAgent)
  useServerAgents((s) => s.open)
  const ctx = agentChangeOf(item)
  if (!ctx) return <Gone />
  return (
    // the card's own title line names the row (key + title); a rename keeps the body's struck old title
    <div className="pf-card__review agx-review" data-change={ctx.change.kind}>
      {/* bare: the card's Suspense waits for its code — the card is shown in full only once this rendered */}
      <AgentChangeBody run={ctx.run} change={ctx.change} bare />
      {ctx.run.runner === 'server' && <p className="pf-card__note">{t('features.preflight.card.final.server')}</p>}
      {/* E: the run's own report (plain text, as the agent wrote it) */}
      {expanded && ctx.run.summary?.trim() && <FullText label={t('features.preflight.card.report')} text={ctx.run.summary.trim()} testId="pf-run-report" />}
    </div>
  )
}

function TerminalBody({ item }: { item: QueueItem }) {
  const all = useAgent((s) => s.changes)
  const c = terminalChangeOf(item)
  if (!c) return <Gone />
  return (
    // no Suspense here: the card's (or the bulk sheet's) waits for the code — shown in full only once this rendered
    <div className="pf-card__review term-changes" data-testid="pf-term-body">
      <TerminalChangeBody change={c} all={all} head card />
    </div>
  )
}

function MemoryBody({ item }: { item: QueueItem }) {
  const t = useT()
  useAgent((s) => s.memCards)
  const term = termMemoryOf(item)
  const run = menuRunOf(item)
  const p = term ? term.item.p : run?.proposals?.[0]
  const dup = term ? term.item.dup : run ? menuRunDuplicate(run.id) : null
  const existing = useWorkspace((s) => (dup ? s.pages[dup]?.title : null))
  if (!p) return <Gone />
  return (
    <div className="pf-fields">
      <Field label={t('features.preflight.card.memText')}>
        <span className="pf-quote">{p.text}</span>
      </Field>
      <Field label={t('features.preflight.card.memType')}>{t(`features.memory.type.${p.type}`)}</Field>
      {dup && <Field label={t('features.preflight.card.memChanges')}>{existing || '—'}</Field>}
    </div>
  )
}

/** One stage of a version as hashed: kind · auto · mode · turns · git action · next · output · model · hold (what is set). */
function stageLine(t: (k: string, v?: Record<string, string | number>) => string, s: TaskVersionView['stages'][number]): string {
  const parts = [t(`features.coding.kind.${s.kind}`)]
  if (s.auto) parts.push(t('features.coding.pipeline.autoShort'))
  if (s.mode) parts.push(`${t('features.coding.pipeline.mode')}: ${t(`features.coding.mode.${s.mode}`)}`)
  if (s.maxTurns != null) parts.push(`${t('features.coding.pipeline.turns')}: ${s.maxTurns}`)
  if (s.gitAction) parts.push(`${t('features.coding.pipeline.gitAction')}: ${t(`features.coding.gitAction.${s.gitAction}`)}`)
  if (s.next) parts.push(`${t('features.coding.pipeline.next')}: ${s.next}`)
  if (s.output) parts.push(`${t('features.coding.pipeline.output')}: ${t(`features.coding.pipeline.output.${s.output}`)}`)
  if (s.model) parts.push(s.model)
  if (s.hold) parts.push(t('features.coding.pipeline.holdChip'))
  return parts.join(' · ')
}

function TaskBody({ item, expanded }: { item: QueueItem; expanded: boolean }) {
  const t = useT()
  const lang = useLang()
  const p = parseTaskItem(item.id)
  const prep = codingPrep(item.id)
  if (!p) return <Gone />
  if (p.kind === 'intake') return <p className="pf-card__note">{t('features.preflight.task.intakeNote')}</p>
  if (!prep) return <p className="pf-card__wait">{t('features.preflight.card.preparing')}</p>
  if (prep.changed) return <p className="pf-card__error">{t('features.preflight.err.changed')}</p>
  if (p.kind === 'confirm') {
    const v = prep.view
    if (!v) return <Gone />
    return (
      <div className="pf-fields" data-testid="pf-version">
        <Field label={t('features.preflight.task.title')}>
          <span className="pf-quote">{v.title || t('common.untitled')}</span>
        </Field>
        <Field label={t('features.preflight.task.fields')}>
          {[v.fields.repo ?? '—', v.fields.branch || '—', v.fields.stage ?? '—'].join(' · ')}
        </Field>
        <FullText label={t('features.preflight.task.page')} text={v.markdown || '—'} testId="pf-version-page" />
        {v.refs.map((r) => (
          <FullText key={r.id} label={t('features.preflight.task.ref', { title: r.title })} text={r.markdown || '—'} testId="pf-version-ref" />
        ))}
        {/* every stage field the version hashes — open: what "Confirm" trusts is shown in full */}
        <details className="pf-card__details" open>
          <summary className="label">{tn('features.preflight.task.stages', v.stages.length)}</summary>
          <ol className="pf-stages" data-testid="pf-version-stages">
            {v.stages.map((s, i) => (
              <li key={i}>
                <b>{s.name}</b> <span className="label">{stageLine(t, s)}</span>
                {s.instructions && <pre className="pf-pre">{s.instructions}</pre>}
              </li>
            ))}
          </ol>
        </details>
      </div>
    )
  }
  const d = prep.detail
  const plan = prep.plan
  const log = (d?.log ?? []).slice(expanded ? -25 : -8)
  return (
    <div className="pf-fields">
      {d?.stage && <Field label={t('features.preflight.task.stage')}>{d.stage}{d.project ? ` · ${d.project}` : ''}</Field>}
      {p.kind === 'gate' && plan?.approves === 'plan' && plan.output && (
        <>
          {plan.outputFrom === 'page' && <p className="pf-card__note">{t(plan.edited ? 'features.preflight.card.planChanged' : 'features.preflight.task.fromPage')}</p>}
          <FullText label={t('features.preflight.task.plan')} text={plan.output} testId="pf-plan" />
        </>
      )}
      {p.kind === 'gate' && plan?.approves === 'review' && (
        <Field label={t('features.preflight.task.review')}>
          {plan.test ? t(plan.test.ok ? 'features.preflight.task.testOk' : 'features.preflight.task.testFail') : t('features.preflight.task.noTest')} · {tn('features.preflight.task.files', plan.files ?? 0)}
        </Field>
      )}
      {p.kind === 'gate' && plan && (
        <Field label={t('features.preflight.task.then')}>
          {plan.runs?.length ? plan.runs.map((r) => r.name).join(' → ') : '—'}
          {plan.stopsAt ? ` · ${t('features.preflight.task.stopsAt', { stage: plan.stopsAt })}` : ''}
          {plan.spawns?.length ? ` · ${t('features.preflight.task.spawns', { kinds: plan.spawns.join(', ') })}` : ''}
        </Field>
      )}
      {p.kind === 'question' && (
        <Field label={t('features.preflight.task.question')}>
          <span className="pf-quote">{d?.question ?? '—'}</span>
        </Field>
      )}
      {p.kind === 'failed' && d?.error && (
        <Field label={t('features.preflight.task.error')}>
          <span className="pf-quote">{d.error}</span>
        </Field>
      )}
      {(p.kind === 'failed' || expanded) && log.length > 0 && (
        <pre className="pf-pre pf-log" aria-label={t('features.preflight.task.log')}>
          {log.map((l) => `${fmtWhen(l.t, Date.now(), lang)}  ${codingLogText(t, l, lang)}`).join('\n')}
        </pre>
      )}
      <p className="pf-card__note">{t('features.preflight.card.final.coding')}</p>
    </div>
  )
}

function InboxBody({ item }: { item: QueueItem }) {
  const t = useT()
  const lang = useLang()
  const it = inboxItemOf(item.id)
  const title = useWorkspace((s) => (it?.pageId ? s.pages[it.pageId]?.title : null))
  if (!it) return <Gone />
  return (
    <div className="pf-fields">
      <Field label={t('features.preflight.card.inboxWhat')}>
        {t(`inbox.kind.${it.kind}`)} · {fmtWhen(it.at, Date.now(), lang)}
        {it.actor ? ` · ${it.actor}` : ''}
      </Field>
      {title !== null && <Field label={t('features.preflight.card.inboxPage')}>{title || t('common.untitled')}</Field>}
      {it.excerpt && (
        <Field label={t('features.preflight.card.inboxExcerpt')}>
          <span className="pf-quote">{it.excerpt}</span>
        </Field>
      )}
    </div>
  )
}

function FixBody({ item }: { item: QueueItem }) {
  const t = useT()
  const failed = useCloudSync((s) => s.failedUploads.length)
  const tabOnly = useAgent((s) => s.changes.filter((c) => c.status === 'pending' || c.status === 'failed').length)
  return (
    <div className="pf-fields">
      {item.detail && <p className="pf-card__detail">{item.detail}</p>}
      {item.id === 'cloud:outdated' && tabOnly > 0 && <p className="pf-card__note">{tn('features.preflight.fix.cloud.drops', tabOnly)}</p>}
      {item.id.startsWith('cloud:uploads') && <p className="pf-card__note">{tn('features.preflight.fix.cloud.failed', failed)}</p>}
    </div>
  )
}

function OpenBody({ item }: { item: QueueItem }) {
  const t = useT()
  return (
    <div className="pf-fields">
      {item.detail && <p className="pf-card__detail">{item.detail}</p>}
      <p className="pf-card__note">{t('features.preflight.risk.why.editor')}</p>
    </div>
  )
}

/**
 * What E opens on this card now (the key's label) — null when the open body would show nothing more: an agent's card
 * with a report (the run's report), a coding card with more of the worker's log than it shows (the log), an area's own
 * body (its details).
 */
export function expandsOf(item: QueueItem): string | null {
  if (item.kind === 'proposal') return agentChangeOf(item)?.run.summary?.trim() ? 'features.preflight.card.e.report' : null
  if (item.kind === 'gate' || item.kind === 'question' || item.kind === 'failed') {
    const n = codingPrep(item.id)?.detail?.log?.length ?? 0
    // gate / question show no log until E; a failed task shows its last 8 lines
    return n > (item.kind === 'failed' ? 8 : 0) ? 'features.preflight.card.e.log' : null
  }
  return builtInBody(item.kind) ? null : 'features.preflight.card.e.more'
}

/** The body of a built-in kind (null: the source brings its own). */
export function builtInBody(kind: string): ((p: { item: QueueItem; expanded: boolean }) => ReactNode) | null {
  switch (kind) {
    case 'proposal':
      return ProposalBody
    case 'terminal':
      return TerminalBody
    case 'memory':
      return MemoryBody
    case 'gate':
    case 'question':
    case 'failed':
    case 'confirm':
    case 'intake':
      return TaskBody
    case 'inbox':
      return InboxBody
    case 'fix':
      return FixBody
    case 'open':
      return OpenBody
  }
  return null
}
