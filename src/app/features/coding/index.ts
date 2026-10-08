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
import { pipelineDbIds } from './schema'

export { startCoding } from './service'
export { CodingRoute, CodingTaskSlot } from './slot'
export { WorkerTab as CodingWorkerTab } from './WorkerTab'
export { CodingStatusCell } from './WorkerStatus'
export { openCodingSettings, consumeCodingSettingsRequest } from './open'
export { useCoding } from './state'
export { codingDbId } from './schema'
/** the worker link's state in words (Settings → Coding worker, the workspace page's Automation section) */
export { workerStateText as codingWorkerStateText } from './stateText'
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
} from './terminal'
export { stopTask as stopCodingTask, isRunning as isCodingTaskRunning } from './service'
export { PIPELINE_KINDS, FOLLOW_UPS, isPipelineKind, kindOfDb, type PipelineKind } from './schema'
/** is there any pipeline (a project of any kind)? */
export const hasPipelines = (): boolean => pipelineDbIds().length > 0
export { lineText as codingLogText } from './lines'
export { gitSummary as codingGitSummary } from './tasks'
export { useTaskLocal as useCodingTaskLocal } from './local'
