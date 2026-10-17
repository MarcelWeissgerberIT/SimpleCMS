/**
 * THE PATCHBAY — public API (features/patchbay; re-exported by features/index.ts). "Patchbay" / "Schaltplan": what runs
 * by itself, drawn as a rack — agents, automations, scripts, MCP servers, pipelines and every cable between them, with
 * a fuse on each path that could carry private data out (plan: killer/8-patchbay). Contract: types.ts.
 *
 *  - PatchbayRoute { m?, f?, setup? } (#/patchbay, lazy) · openPatchbay({ m?, f?, setup? }) — the one way in
 *  - startPatchbay(): background service (main.tsx after startRecorder — B8 wires it)
 *  - PatchbayNavRow (sidebar, B6) · usePatchbayCounts() / patchbayCounts() (LED = Preflight lamp = readout, B8) ·
 *    PatchbayStatusCells (status bar, B8 / B12) · PatchbayReturnChip (topbar, B11)
 *  - fuseHintOf / useFuseHint / FuseHintLine — also importable from './hint' directly (the one dependency-free module
 *    other areas may import, like features/preflight/registry)
 *  - wiringInventory(source, WIRING_READERS) → agents, scripts, automations, own commands, repeating templates, live
 *    databases (pure, no page-map walk — Workspace › Automation counts the same) · wiringCount(inventory)
 *  - moduleKey(ref) / inventoryKeys / scheduleKey(trigger): THE spelling of a module's key (`#/patchbay?m=`)
 *  - PATCHBAY_DB / PATCHBAY_STORE / wipePatchbay(scope | null) / inPatchbayScope(key, scope) / PATCHBAY_LS_PREFIX /
 *    PATCHBAY_RETURN_KEY: the device stores (the device-copy wipe and the local reset, B9) — `wipePatchbay('cloud:<ws>')`
 *    takes every member's scope of that workspace along (`cloud:<ws>:u:<account>`); every wipe first drops the run counts
 *    still waiting to be written (live/bus.ts forgetTally via cache.ts onPatchbayWipe); `{ records: false }` leaves
 *    IndexedDB unopened
 *  - Orders B11: plannerFuses(db, consent | 'stored') → the open fuses "Ohne Bestätigung starten" adds for a work-orders
 *    database's planner (its label + sentence; asked at switch-on and at every auto create) · allowPlannerFuse(db,
 *    consent, key) = key 3 "Weg zulassen" on such a path (orderAsk.ts — both lazy: the model never loads at boot)
 */
export { PatchbayRoute, type PatchbayRouteProps } from './route'
export { openPatchbay, type OpenPatchbayOptions } from './open'
export { startPatchbay } from './service'
export { usePatchbayCounts, patchbayCounts } from './counts'
export { PatchbayNavRow, type PatchbayKeyProps } from './ui/NavRow'
/** Has this device opened the Patchbay? (the sidebar's NEW: its row, and the tool strip's readout) */
export { useSeen as usePatchbaySeen } from './ui/seen'
export { PatchbayStatusCells } from './ui/StatusCells'
export { PatchbayReturnChip } from './ui/ReturnChip'
export { fuseHintOf, useFuseHint, FuseHintLine } from './hint'
export { wiringInventory, wiringCount, liveDatabases, type WiringInventory, type WiringReaders, type WiringSource } from './inventory'
export { WIRING_READERS } from './readers'
export { moduleKey, inventoryKeys, scheduleKey } from './ref'
export { PATCHBAY_DB, PATCHBAY_STORE, wipePatchbay, inPatchbayScope, LS_PREFIX as PATCHBAY_LS_PREFIX, SS_RETURN as PATCHBAY_RETURN_KEY } from './cache'
export type { ModuleKey, ModuleRef, PatchbayCounts, FuseHint, HintKind } from './types'
export type { PlannerFuse } from './orderAsk'
/** Orders B11 (orderAsk.ts, lazy): the open fuses this device's consent adds for the planner of `db`. */
export const plannerFuses = (db: string, consent: { sig: string; at: number } | 'stored'): Promise<import('./orderAsk').PlannerFuse[]> => import('./orderAsk').then((m) => m.plannerFuses(db, consent))
/** Orders B11 (orderAsk.ts, lazy): "Weg zulassen" (key 3) on a path the consent opens. */
export const allowPlannerFuse = (db: string, consent: { sig: string; at: number } | 'stored', key: string): Promise<{ ok: true } | { ok: false; refused: string }> => import('./orderAsk').then((m) => m.allowPlannerFuse(db, consent, key))
