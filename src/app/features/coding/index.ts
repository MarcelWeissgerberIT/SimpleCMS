/**
 * Coding pipeline (features/coding) — re-exported by features/index.ts. One keeps the tasks, the pipeline,
 * approvals, logs and diffs; `one-worker` (mcp/src/worker → public/mcp/one-worker.mjs) runs git and Claude
 * Code on the person's machine. Docs: docs/CODING.md · protocol: ./protocol.ts.
 *  - startCoding(): background service (main.tsx); idle until Settings → Coding worker is switched on
 *  - CodingRoute (#/coding) · CodingTaskSlot { pageId } (the task panel on a task page; nothing elsewhere)
 *  - CodingWorkerTab: Settings → Coding worker · CodingStatusCell: status bar "WORKER" LED
 *  - openCodingSettings() / consumeCodingSettingsRequest(): open Settings on that tab
 *  - codingDbId(): the Coding database (Database.system 'coding') · useCoding: the worker link's state
 */
import { t } from '../../i18n'
import { inTeam, pipelineDbIds } from './schema'
import { useCodingLocal } from './local'
import { defaultApprovals, useCoding, type ApprovalsLevel, type CodingState } from './state'
import { workerDownText } from './stateText'
import { workerOutdated, workerUnsafe } from './protocol'

export { startCoding } from './service'
export { CodingRoute, CodingTaskSlot } from './slot'
export { WorkerTab as CodingWorkerTab } from './WorkerTab'
export { CodingStatusCell } from './WorkerStatus'
export { openCodingSettings, consumeCodingSettingsRequest } from './open'
/** a worker older than 1.9.0 on this Windows computer (Local link) — the #/coding plate and the Preflight lamp name it */
export { workerOldHere } from './service'
export { useCoding } from './state'
export { codingDbId } from './schema'
/** the worker link's state in words (Settings → Coding worker, the workspace page's Automation section) */
export { workerStateText as codingWorkerStateText } from './stateText'
/** why the link is down, as Preflight's worker card says it (a Local link that waits: is the worker running) — MCP · Connections */
export { workerDownText as codingWorkerDownText } from './stateText'
/**
 * Why the worker link is down, in words, now (Preflight's worker card): the state text Settings → Coding worker shows —
 * a refusal, the browser's block — and for a Local link that waits, what to check (is the worker running in a terminal;
 * the browser's question). '' while connected or switched off.
 */
export function codingConnText(): string {
  const s = useCoding.getState()
  return s.enabled && s.conn !== 'connected' && s.conn !== 'off' ? workerDownText(t, s) : ''
}
/** "Change repositories": the connected worker opens its setup page (renders only while it has one) — MCP · Connections */
export { ChangeReposButton as CodingChangeReposButton } from './SetupCard'
/** the AI terminal (features/ai/agent/coding.ts): reading the pipelines, planning + applying task changes the person reviewed */
export {
  taskPhase,
  landsOn,
  taskBriefs,
  useTaskBriefs,
  briefRank,
  pipelineOverview,
  taskDetail,
  planNewTask,
  applyNewTask,
  planTaskAction,
  applyTaskAction,
  startsNow,
  taskNeedsConfirm,
  mayNeedConfirm,
  isPipelineTask,
  textRefs,
  textRefsGained,
  taskWriteEndsConfirm,
  taskSig,
  newProjectNow,
  codingRoleOf,
  CodingPlanError,
  TASK_OPS,
  REPO_NAME,
  SHOWN_MAX,
  type TaskBrief,
  type TaskFilter,
  type TaskStatus,
  type TaskPhase,
  type TaskDetail,
  type PipelineOverview,
  type ProjectInfo,
  type NewTaskInput,
  type NewTaskPlan,
  type TaskOp,
  type TaskActionPlan,
  type ReadLimitFn,
  type SigSteps,
  type StagedPages,
} from './terminal'
export type { RefPage } from './refs'
export { stopTask as stopCodingTask, isRunning as isCodingTaskRunning } from './service'
export { PIPELINE_KINDS, FOLLOW_UPS, isPipelineKind, kindOfDb, type PipelineKind } from './schema'
/** is there any pipeline (a project of any kind)? */
export const hasPipelines = (): boolean => pipelineDbIds().length > 0
export { lineText as codingLogText } from './lines'
export { gitSummary as codingGitSummary } from './tasks'
export { useTaskLocal as useCodingTaskLocal } from './local'
/**
 * The Preflight lamps (Gate · Coding question · Task failed): the tasks that wait on the person, without a page-map walk
 * (waiting.ts) — waitingTasks() (sync) · onWaitingChanged(fn) · loadTasks(ids): many tasks' run states in one read
 */
export { waitingTasks, onWaitingChanged, type WaitingTask } from './waiting'
export { loadTasks } from './local'
/**
 * Preflight's coding cards (P2): taskVersionView(id) — a task version exactly as it is hashed (title, page, fields,
 * stages, linked pages) with its hash · confirmTaskVersion(id, hash) → 'ok' | 'changed' | 'gone' — trusts exactly the
 * version shown · actionTook(plan) — did an applied task action move the task (the actions return silently on their
 * guards). Every other key goes through planTaskAction → applyTaskAction (never confirms a version).
 */
export { taskVersionView, actionTook, type TaskVersionView } from './terminal'
export { confirmTaskVersion } from './tasks'
/**
 * worker 1.11.0 — Preflight's "Claude möchte" lamp and the step-limit card: the permission requests running stages wait
 * for on this device are `useCoding.asks` (task id → PermissionAsk; only on the worker's own tab) ·
 * answerPermission(taskId, askId, verb) — only the request's id and a fixed verb go to the worker ('gone': answered
 * elsewhere, timed out, the stage ended) · askOf(taskId) · AskWhat (the request as the task panel shows it) ·
 * canContinue() (no connected worker that lacks 'continue')
 */
export { answerPermission, askOf } from './service'
export { canContinue } from './tasks'
export { AskWhat } from './PermissionCard'
export type { PermissionAsk, PermissionVerb } from './protocol'
/** bumped whenever this device trusts another task version (Confirm …, also in another tab): a trust readout re-checks with it */
export const useCodingTrustRev = (): number => useCodingLocal((s) => s.trustRev)
/** admins: every member's cloud worker with Revoke (the workspace page's Automation section; renders nothing otherwise) */
export { CloudWorkers as CodingCloudWorkers } from './CloudWorkers'
/**
 * The Patchbay's reads (features/patchbay — §1.3 gates, §1.4 the GIT exit, §1.7 live; the rules stay this area's own):
 *  - pipelineDbIdsOf(kind) (every live project of a kind, oldest first; team: private ones) · readPipeline(db) (the
 *    stages in Stage-option order, each with its git action, gate, hold) · gitStageWarnings(action, repos)
 *  - onShipRecord(fn) / lastShip(dbId): ship records as they arrive in this tab (pipeline → GIT, live)
 *  - approvalsDefault(): this device's Approvals for new tasks ('all' · 'review' · 'none')
 *  - taskConfirmRule(): who waits for a confirmed version — 'always' (team) · 'agent' (local: tasks an agent created or
 *    changed last, trust.ts needsConfirm)
 *  - worker state: workerOnline(s) · workerCaps(s) (what the connected worker runs; null: not known) ·
 *    workerVerdict(s) ('ok' | 'outdated' | 'unsafe' | null offline) · workerUnsafe(version) · workerOutdated(can)
 */
export { pipelineDbIdsOf, readPipeline, type ResolvedStage } from './schema'
export { gitStageWarnings, onShipRecord, lastShip, type ShipNote } from './ship'
export { workerUnsafe, workerOutdated } from './protocol'
/** The outdated-worker notice in the person's language (what the newer one adds; before 1.11.0 the stage-end fix first). */
export { outdatedNotice as codingOutdatedNotice } from './outdated'
export type { ApprovalsLevel } from './state'
/**
 * Work orders (Prüfaufträge, orders/** — the contract, B1): the config of a `system: 'workorders'` database as every
 * reader keeps it (readOrderConfig: 'none' · 'unreadable' (a later build's: acts on nothing) · 'ok' + missing Status
 * options), the planner's typed plan, this device's record of a request, the limits; the chain roles on a project are
 * codingProps(db).order / .step (display only, never part of a task version).
 */
export { readOrderConfig, newOrderConfig, orderCheckpoint, orderConfigUsable, ORDER_KINDS, ORDER_STATUS_KEYS, BUDGET_RANGE, type OrderConfigRead } from './orders/config'
export { PLAN_LIMITS, ORDER_LIMITS, type OrderPlanV1, type OrderStepPlan, type OrderRecord, type OrderDraft, type OrderChain, type OrderChainStep, type OrderDoneBy, type OrderHaltWhy, type OrderState, type OrderProv, type OrderCall, type OrderToolLeft, type OrderConfig, type OrderKind, type OrderStatusKey } from './orders/types'

/** This device's Approvals for new tasks (localStorage one.coding.approvals). */
export const approvalsDefault = (): ApprovalsLevel => defaultApprovals()

/** Who waits for a confirmed task version before the worker runs it: every task in a team, local tasks an agent wrote. */
export const taskConfirmRule = (): 'always' | 'agent' => (inTeam() ? 'always' : 'agent')

/** The worker link is up (switched on here and connected). */
export const workerOnline = (s: Pick<CodingState, 'enabled' | 'conn'> = useCoding.getState()): boolean => s.enabled && s.conn === 'connected'

/** What the connected worker runs, from its last `next` (null: offline, or it has not asked yet). */
export const workerCaps = (s: Pick<CodingState, 'enabled' | 'conn' | 'can'> = useCoding.getState()): readonly string[] | null => (workerOnline(s) ? s.can : null)

/** The connected worker's verdict: 'unsafe' (the ZIP-import gap — the security notice), 'outdated' (a stage it cannot run), 'ok'; null while offline. */
export function workerVerdict(s: Pick<CodingState, 'enabled' | 'conn' | 'can' | 'worker'> = useCoding.getState()): 'ok' | 'outdated' | 'unsafe' | null {
  if (!workerOnline(s)) return null
  if (workerUnsafe(s.worker?.worker)) return 'unsafe'
  return workerOutdated(s.can) ? 'outdated' : 'ok'
}
