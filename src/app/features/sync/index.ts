/**
 * Folder + GitHub sync (features/sync) — re-exported by features/index.ts.
 *  - startSync(): background service (main.tsx, after the workspace loaded)
 *  - SyncTab: Settings → Sync · SyncStatusCell: status bar read-out
 *  - openSyncSettings() / consumeSyncSettingsRequest(): open Settings on the Sync tab
 */
export { startSync, stopSync, openSyncSettings, consumeSyncSettingsRequest, useSync } from './service'
export { SyncTab } from './SyncTab'
export { SyncStatusCell } from './SyncStatus'
