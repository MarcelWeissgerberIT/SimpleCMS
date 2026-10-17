/**
 * Work orders — where a step stops for the person (spec §1.5 "stoppt bei: Plan freigeben, Review", the head counter
 * "hält 4× für dich"), pure (a Node spec reads it): from the stage the chain starts the step in, the stages that run on
 * their own under this device's Approvals, then each stop — a gate the Approvals do not skip, a manual stage — and on
 * from the stage after it, as if the person went on, until done. The analysis checkpoint ("Nach der Analyse anhalten")
 * adds one stop after a BA step with a step after it — unless that step already stops at its last gate before done
 * (that press is the checkpoint then: nobody presses twice).
 */
import { nextStage, runsFrom, startStageOf, type ResolvedStage, type StageApprovals } from '../stages'

/** The names of the stages a step stops at for the person, in order (done not counted). */
export function stopsOf(pipeline: ResolvedStage[], repo: boolean, approvals: StageApprovals): string[] {
  const out: string[] = []
  let from = startStageOf(pipeline, repo, true) ?? null
  for (let hops = 0; from && hops <= pipeline.length; hops++) {
    const { stop } = runsFrom(pipeline, from, approvals)
    if (!stop || stop.kind === 'done') break
    out.push(stop.name)
    from = nextStage(pipeline, stop)
  }
  return out
}

/** Does the step's last stop sit right before done (its last gate ends the step — the checkpoint's press)? */
export function endsAtGate(pipeline: ResolvedStage[], repo: boolean, approvals: StageApprovals): boolean {
  let from = startStageOf(pipeline, repo, true) ?? null
  let last: ResolvedStage | null = null
  for (let hops = 0; from && hops <= pipeline.length; hops++) {
    const { stop } = runsFrom(pipeline, from, approvals)
    if (!stop) return false
    if (stop.kind === 'done') break
    last = stop
    from = nextStage(pipeline, stop)
  }
  if (!last || last.kind !== 'gate') return false
  const after = nextStage(pipeline, last)
  return !!after && runsFrom(pipeline, after, approvals).stop?.kind === 'done'
}

/** One step of a plan as the counter reads it. */
export interface StopStep {
  kind: 'spec' | 'coding' | 'qa'
  stops: string[]
  /** its last stop is a gate right before done (BA's own last gate is the checkpoint then) */
  endsAtGate: boolean
}

/**
 * The checkpoint after a BA step: true when "Nach der Analyse anhalten" is on, the step is a BA step, a step follows it,
 * and its own last gate is not the press already.
 */
export const checkpointAfter = (steps: readonly StopStep[], i: number, checkpoint: boolean): boolean => checkpoint && steps[i]?.kind === 'spec' && i < steps.length - 1 && !steps[i]!.endsAtGate

/** How often the chain holds for the person: every stop of every step, plus the checkpoints. */
export const holdsOf = (steps: readonly StopStep[], checkpoint: boolean): number => steps.reduce((n, s, i) => n + s.stops.length + (checkpointAfter(steps, i, checkpoint) ? 1 : 0), 0)
