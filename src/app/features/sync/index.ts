/**
 * Folder + GitHub sync (features/sync) — re-exported by features/index.ts.
 *  - startSync(): background service (main.tsx, after the workspace loaded)
 *  - SyncTab: Settings → Sync · SyncStatusCell: status bar read-out
 *  - openSyncSettings() / consumeSyncSettingsRequest(): open Settings on the Sync tab
 *  - resumeFolder(): ask again for the folder's permission (call it inside the key press — the browser asks)
 *  - resolveMissing(trash): files that went missing from the folder — write them again (false) or trash their pages (true)
 */
export { startSync, stopSync, openSyncSettings, consumeSyncSettingsRequest, useSync, resumeFolder, resolveMissing } from './service'
export { SyncTab } from './SyncTab'
export { SyncStatusCell } from './SyncStatus'
