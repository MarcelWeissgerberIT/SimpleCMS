/** Quiet guidance and acceptance rules. No model may turn a narrative success into evidence. */
import { stableCandidate, readChallenge, readHostExecution } from '../../../../shared/coding/evidence.ts'
export interface GuidedEvidence {
  state: string
  contract: boolean
  sourceChanged: boolean
  steps: Array<{
    id: string; kind: string; done: boolean; skipped: boolean; failed: boolean
    test: { ok: boolean; code: number | null; skipped?: boolean; execution?:unknown; challenge?:unknown } | null
    qa: { at: number; branch: string } | null
    changedAt: number
  }>
}

export type AcceptanceIssue = 'contract' | 'unfinished' | 'skipped' | 'checks' | 'qa' | 'sources' | 'afterQa' | 'candidate'

export function acceptanceIssues(e: GuidedEvidence): AcceptanceIssue[] {
  const out: AcceptanceIssue[] = []
  if (!e.contract) out.push('contract')
  if (e.state !== 'done' || !e.steps.length || e.steps.some(s => !s.done || s.failed)) out.push('unfinished')
  if (e.steps.some(s => s.skipped)) out.push('skipped')
  if (e.sourceChanged) out.push('sources')
  const coding = e.steps.filter(s => s.kind === 'coding')
  if (coding.length) {
    const last = e.steps.at(-1)
    if (!last || last.kind !== 'qa' || !last.qa?.branch) out.push('qa')
    if (!last?.test?.ok || last.test.skipped || last.test.code !== 0) out.push('checks')
    const challenge=last?.test?.challenge===undefined?undefined:readChallenge(last.test.challenge)
    if (!stableCandidate(last?.test?.execution)||challenge===null||challenge&&(['failed','unavailable'].includes(challenge.state)||challenge.state==='passed'&&(challenge.execution?.candidate?.before!==readHostExecution(last?.test?.execution)?.candidate?.after||challenge.execution!.startedAt<readHostExecution(last?.test?.execution)!.finishedAt))) out.push('candidate')
    if (last?.qa && coding.some(s => s.changedAt > last.qa!.at)) out.push('afterQa')
  }
  return out
}

export type GuidePhase = 'prepare' | 'plan' | 'work' | 'verify' | 'accept'
export function guidePhase(state: string | null, planning: boolean, activeKind?: string): GuidePhase {
  if (planning || state === 'plan' || state === 'ready') return 'plan'
  if (state === 'done') return 'accept'
  if (state === 'running' || state === 'halted') return activeKind === 'qa' ? 'verify' : 'work'
  return 'prepare'
}
