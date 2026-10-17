/**
 * Coding pipeline — where a task goes in a pipeline, pure (no store, no i18n: the chain engine's Node spec and the AI
 * terminal's review read the same answers). schema.ts / tasks.ts / terminal.ts re-export these under the names they
 * always had.
 *
 *  - `nextStage`: the stage after a stage (its `next`, else the following option).
 *  - `startStageOf`: where a new task starts — `start` false: the first stage (the backlog: a task is PARKED there);
 *    `start` true: the first stage the worker takes (an Import stage while the code has yet to arrive, else the first
 *    automatic queue, else the first stage).
 *  - `skipsGate`: whether a task with these Approvals runs past a gate.
 *  - `landsOn`: where a task standing in a stage ends up (mirrors the worker's pick: automatic queues are passed on).
 *  - `runsFrom`: what runs on its own after a task enters a stage, and where it stops.
 *  - `pipelineLine`: what a task's review says about its pipeline (start, whether that starts the worker, where it stops,
 *    git) — the AI terminal's create_task review and a work order's chain step (the line confirmed with the chain; a
 *    different one when the step is to start asks first — coding/chain.ts).
 */
import type { ColorName, PipelineStage } from '../../store/types'

/** A stage of a pipeline with its Stage option's name and colour and its position (schema.ts readPipeline). */
export interface ResolvedStage extends PipelineStage {
  name: string
  color: ColorName
  /** position in the pipeline */
  index: number
}

/** The pipelines (schema.ts): Coding, Business analysis, QA — each found by its `Database.system`. */
export const PIPELINE_KINDS = ['coding', 'spec', 'qa'] as const
export type PipelineKind = (typeof PIPELINE_KINDS)[number]
export const isPipelineKind = (v: unknown): v is PipelineKind => (PIPELINE_KINDS as readonly unknown[]).includes(v)
/** what a kind may hand on to when a task is done ("Then") */
export const FOLLOW_UPS: Record<PipelineKind, PipelineKind[]> = { coding: [], spec: ['coding', 'qa'], qa: ['coding'] }

/** Which gates a task stops at on this device: 'all' (plan + review) · 'review' (the plan runs on) · 'none'. */
export type StageApprovals = 'all' | 'review' | 'none'

/** The stage after `stage` (its `next`, else the following option); null at the end. */
export function nextStage(pipeline: ResolvedStage[], stage: ResolvedStage): ResolvedStage | null {
  if (stage.next) return pipeline.find((s) => s.id === stage.next) ?? null
  return pipeline[stage.index + 1] ?? null
}

/**
 * Where a new task starts: `start` — the first stage the worker takes (an Import stage when the code has yet to
 * arrive, else the first automatic queue, else the first stage); otherwise the first stage (the backlog).
 */
export function startStageOf(pipeline: ResolvedStage[], hasRepo: boolean, start: boolean): ResolvedStage | undefined {
  const first = pipeline[0]
  // a pipeline that starts with the code (an Import stage): a task without a repo waits there for it
  const intake = !hasRepo ? pipeline.find((s) => s.kind === 'import') : undefined
  return start ? (intake ?? pipeline.find((s) => s.kind === 'queue' && s.auto) ?? first) : first
}

/**
 * Does a task with these Approvals run past this gate? A gate right after a plan stage approves the plan; every other
 * gate is a review. A gate marked "Always stop here" (hold) is never skipped.
 */
export function skipsGate(level: StageApprovals, pipeline: ResolvedStage[], gate: ResolvedStage): boolean {
  if (gate.hold) return false
  if (level === 'none') return true
  return level === 'review' && pipeline[gate.index - 1]?.kind === 'plan'
}

/**
 * Where a task standing in `stage` ends up (mirrors the worker's pick, tasks.ts pickNext): automatic queues are passed
 * on; 'worker' = an automatic stage the worker runs (or any runnable stage with "Run now"), 'waits' = a manual queue, a
 * gate, an Import, done. Repos are not looked at: a doubt counts as "starts".
 */
export function landsOn(pipeline: ResolvedStage[], stage: ResolvedStage | null | undefined, runNow = false): 'worker' | 'waits' {
  if (!stage) return 'waits'
  const go = (st: ResolvedStage) => st.auto || runNow
  let target = stage
  for (let hops = 0; target.kind === 'queue' && go(target) && hops < pipeline.length; hops++) {
    const n = nextStage(pipeline, target)
    if (!n) break
    target = n
  }
  if (target.kind === 'queue' || target.kind === 'gate' || target.kind === 'done' || target.kind === 'import' || !go(target)) return 'waits'
  return 'worker'
}

/**
 * The stages that run on their own after a task enters `from` (gates this device's approvals skip included), and where
 * it stops: the next gate it waits at, a manual stage, or done.
 */
export function runsFrom(pipeline: ResolvedStage[], from: ResolvedStage | null, approvals: StageApprovals): { runs: ResolvedStage[]; stop: ResolvedStage | null } {
  const runs: ResolvedStage[] = []
  let st = from
  for (let hops = 0; st && hops <= pipeline.length; hops++) {
    if (st.kind === 'done') return { runs, stop: st }
    if (st.kind === 'gate') {
      if (!skipsGate(approvals, pipeline, st)) return { runs, stop: st }
    } else if (st.kind === 'queue' || st.kind === 'import') {
      if (!st.auto || st.kind === 'import') return { runs, stop: st }
    } else if (!st.auto) return { runs, stop: st }
    else runs.push(st)
    st = nextStage(pipeline, st)
  }
  return { runs, stop: null }
}

/**
 * What a task's review says about its pipeline: where it starts, whether that starts the worker, where it stops (with
 * this device's Approvals) and the git stages it would reach — one string, compared as a whole (the terminal's apply,
 * a chain step at its start).
 */
export function pipelineLine(pipeline: ResolvedStage[], repo: boolean, start: boolean, approvals: StageApprovals): string {
  const first = startStageOf(pipeline, repo, start)
  return JSON.stringify([
    first?.name ?? null,
    first?.kind ?? null,
    landsOn(pipeline, first) === 'worker',
    runsFrom(pipeline, first ?? null, approvals).stop?.name ?? null,
    pipeline.filter((s) => s.kind === 'git').map((s) => [s.name, s.gitAction ?? 'pr']),
  ])
}

/**
 * Does a task of this pipeline need a repository? Claude Code stages that read or write code (plan · implement · test ·
 * git · analyze) — never document stages, never a pipeline that imports its code (an Import stage brings it).
 */
export const pipelineNeedsRepo = (pipeline: readonly ResolvedStage[]): boolean =>
  !pipeline.some((s) => s.kind === 'import') && pipeline.some((s) => s.kind === 'plan' || s.kind === 'implement' || s.kind === 'test' || s.kind === 'git' || s.kind === 'analyze')
