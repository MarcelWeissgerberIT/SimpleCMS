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
export { startCoding } from './service'
export { CodingRoute, CodingTaskSlot } from './slot'
export { WorkerTab as CodingWorkerTab } from './WorkerTab'
export { CodingStatusCell } from './WorkerStatus'
export { openCodingSettings, consumeCodingSettingsRequest } from './open'
export { useCoding } from './state'
export { codingDbId } from './schema'
