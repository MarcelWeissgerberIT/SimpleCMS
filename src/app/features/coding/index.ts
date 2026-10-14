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
import { pipelineDbIds } from './schema'
import { useCodingLocal } from './local'
import { useCoding } from './state'
import { workerDownText } from './stateText'

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
/**
 * Why the worker link is down, in words, now (Preflight's worker card): the state text Settings → Coding worker shows —
 * a refusal, the browser's block — and for a Local link that waits, what to check (is the worker running in a terminal;
 * the browser's question). '' while connected or switched off.
 */
export function codingConnText(): string {
  const s = useCoding.getState()
  return s.enabled && s.conn !== 'connected' && s.conn !== 'off' ? workerDownText(t, s) : ''
}
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
/** bumped whenever this device trusts another task version (Confirm …, also in another tab): a trust readout re-checks with it */
export const useCodingTrustRev = (): number => useCodingLocal((s) => s.trustRev)
/** admins: every member's cloud worker with Revoke (the workspace page's Automation section; renders nothing otherwise) */
export { CloudWorkers as CodingCloudWorkers } from './CloudWorkers'
