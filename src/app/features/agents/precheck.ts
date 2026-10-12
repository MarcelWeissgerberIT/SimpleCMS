/**
 * Custom agents × Jev (slice SJ): an agent run's proposals pre-checked after its tool loop, before its only write —
 * features/ai/decide/checkRun.ts sends the checks, this attaches them. Each change of a checked kind gets its `jev`;
 * with "Zurückhalten" a change Jev marked or could not check is status 'held' (never part of a bulk apply, applied only
 * on its own). The run gets one step ("Jev 1.13 prüft vor: …") and its numbers (`AgentRun.jev`). While the run goes on its
 * stored copy holds every unchecked change as a held placeholder (heldPlaceholders) — a run that never finishes leaves
 * held cards, never clean ones. A decision model only adds caution: nothing here applies, discards or writes the
 * workspace.
 */
import type { LedgerEntry } from '@/shared/ai/types'
import type { AgentReviewV2 } from '@/shared/ai/route'
import { markOf, type JevCheck } from '@/shared/ai/decide'
import { t } from '../../i18n'
import type { CustomAgent, ID } from '../../store/types'
import type { StagedChange } from '../ai/agent/types'
import { isCheckedKind, jevName, uncheckedOf, whyText } from '../ai/decide'
import type { AgentRun, AgentRunJev, AgentRunStep } from './types'

export type Review = Omit<AgentReviewV2, 'v'>

/**
 * The run's changes as its stored copy holds them while the run goes on: with "Zurückhalten" every pending change of a
 * checked kind is a held placeholder ("not pre-checked") until its check flips it — the tools keep working on the
 * pending copy in memory.
 */
export function heldPlaceholders(changes: readonly StagedChange[], review: Review | null, at: number): StagedChange[] {
  if (!review?.pre.hold) return [...changes]
  return changes.map((c) => (c.status === 'pending' && isCheckedKind(c.kind) ? { ...c, status: 'held' as const, jev: { ...uncheckedOf('late', { at, sent: false }), held: 'unchecked' as const } } : c))
}

export interface PrecheckInput {
  agent: CustomAgent
  run: AgentRun
  review: Review
  /** the run's changes (changed in place: `jev`, and 'held' with "Zurückhalten") */
  changes: StagedChange[]
  rowIds: Record<string, ID>
  /** the rows that started the run */
  triggerRows: readonly ID[]
  /** the scope check of the agent (null: everything) */
  scope: ((id: ID) => boolean) | null
  /** what the run may still spend (USD) */
  budgetLeft: number
  /** every decision response's ledger entry (the run's receipt) */
  onEntry?: (e: LedgerEntry) => void
}

/** Pre-check the run's proposals and attach the checks (the stored run is still 'running' — DJ16). */
export async function precheckRun(o: PrecheckInput): Promise<AgentRunJev | null> {
  const { review, changes } = o
  if (!changes.some((c) => isCheckedKind(c.kind))) return null
  const at = Date.now()
  let checks: Record<string, JevCheck>
  let usd = 0
  let model: string | null = null
  let changedTo: string | undefined
  if (o.run.status === 'budget') {
    // the run spent what it may: nothing goes out
    checks = Object.fromEntries(changes.filter((c) => isCheckedKind(c.kind)).map((c) => [c.id, uncheckedOf('budget', { at, sent: false })]))
  } else {
    const { checkChanges } = await import('../ai/decide/checkRun')
    const res = await checkChanges({
      agentId: o.agent.id,
      runId: o.run.id,
      instructions: o.agent.instructions,
      write: o.agent.write,
      trigger: { type: o.run.trigger.type, rows: o.triggerRows },
      changes,
      rowIds: o.rowIds,
      review,
      scope: o.scope,
      touched: o.run.touched ?? [],
      budgetLeft: o.budgetLeft,
      ...(o.onEntry ? { onEntry: o.onEntry } : {}),
    })
    checks = res.checks
    usd = res.usd
    model = res.model
    changedTo = res.changedTo
  }
  // attach: every checked change its check; "Zurückhalten" holds what Jev marked or could not check
  let checked = 0
  let marked = 0
  let held = 0
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i]!
    const check = checks[c.id]
    if (!check) continue
    const mark = markOf(check, review.pre.markBelow)
    const jev: JevCheck = { ...check, ...(check.state === 'ok' ? { mark } : {}) }
    if (check.state === 'ok') checked++
    if (mark) marked++
    if (review.pre.hold && (mark || check.state !== 'ok')) {
      changes[i] = { ...c, status: 'held', jev: { ...jev, held: mark ? 'mark' : 'unchecked' } }
      held++
    } else changes[i] = { ...c, status: c.status === 'held' ? 'pending' : c.status, jev }
  }
  const n = Object.keys(checks).length
  const first = changes.find((c) => checks[c.id] && checks[c.id]!.state !== 'ok')?.jev
  const summary: AgentRunJev = {
    n,
    checked,
    marked,
    held,
    usd: Math.round(usd * 1e8) / 1e8,
    ...(model ? { model } : {}),
    ...(!checked && first?.why ? { failed: first.why } : {}),
    ...(changedTo ? { changedTo } : {}),
  }
  o.run.jev = summary
  o.run.steps.push(checkStep(summary, review, whyText(t, first?.why, first?.cls)))
  return summary
}

/** The run's Jev step: "Jev 1.13 prüft vor: 6 vorgeprüft · 2 mit Bedenken · 1 zurückgehalten" — counts only. */
export function checkStep(s: AgentRunJev, review: Review, why: string): AgentRunStep {
  const name = jevName(s.model ?? review.decider?.m ?? review.on)
  if (!s.checked) return { kind: 'note', label: t('features.ai.jev.step.none', { model: name, why }), state: 'err', jev: 'check' }
  const counts = [t('features.ai.jev.step.checked', { n: s.checked }), ...(s.marked ? [t('features.ai.jev.step.marked', { n: s.marked })] : []), ...(s.held ? [t('features.ai.jev.step.held', { n: s.held })] : [])].join(' · ')
  return { kind: 'note', label: t('features.ai.jev.step.check', { model: name, counts }), state: 'ok', jev: 'check' }
}

/**
 * The checks could not run at all (an unexpected failure): every change of a checked kind is unchecked — held with
 * "Zurückhalten" — never cleaner than without Jev.
 */
export function failClosed(run: AgentRun, changes: StagedChange[], review: Review): void {
  const at = Date.now()
  let held = 0
  let n = 0
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i]!
    if (!isCheckedKind(c.kind) || (c.status !== 'pending' && c.status !== 'held')) continue
    n++
    const jev = uncheckedOf('error', { at, sent: false })
    if (review.pre.hold) {
      changes[i] = { ...c, status: 'held', jev: { ...jev, held: 'unchecked' } }
      held++
    } else changes[i] = { ...c, status: 'pending', jev }
  }
  if (!n) return
  run.jev = { n, checked: 0, marked: 0, held, usd: run.jev?.usd ?? 0, failed: 'error' }
  run.steps.push(checkStep(run.jev, review, whyText(t, 'error')))
}
