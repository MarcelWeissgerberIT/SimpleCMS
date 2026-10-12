/**
 * DECISION MODELS — public API (slice SJ: Jev as Vorprüfer, via features/index.ts). A decision model only adds caution:
 * it marks, holds a proposal out of every bulk apply, makes an apply-mode run wait, or suggests — it never applies,
 * discards, supersedes, picks, writes a Vertrauen verdict or page content.
 *  - questions.ts: QSET (versioned, hash-frozen, the data clause on every question)
 *  - kinds.ts: CHECKED_KINDS (an allow-list — never a send)
 *  - state.ts: proposalState (pure; the state Jev reads — no ids, links → visible titles, names only where allowed)
 *  - world.ts: stateWorld (the store and the gate's decision for one request)
 *  - verdict.ts: the stored check (`StagedChange.jev`) and its math
 *  - text.ts: why a change was not pre-checked, a question's label (in the UI's words)
 *  - checkRun.ts: an agent run's checks (lazy: `import('…/decide/checkRun')` — never loaded for a run without a Vorprüfer)
 */
export { DATA_CLAUSE, QSET, precheckQuestions } from './questions'
export { CHECKED_KINDS, isCheckedKind } from './kinds'
export { STATE_LIMITS, dataText, proposalSources, proposalState, type ProposalInput, type ProposalState, type StateWorld } from './state'
export { stateWorld } from './world'
export { answered, checkOf, gateAllows, markOf, nearOf, sanitizeJevCheck, uncheckedOf, weakest, type JevCheck, type JevCheckKey, type JevWhy } from './verdict'
export { checkReason, jevName, questionLabel, whyText } from './text'
export type { CheckRunInput, CheckRunResult } from './checkRun'
