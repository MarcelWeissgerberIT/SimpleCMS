/**
 * GOVERNOR (Regler) — public API. The ledger (one entry per AI response, per device and member, IndexedDB `one-ledger`),
 * reservations (in this tab and, through the book, across tabs), the estimate band, and the Regler's totals, the device
 * line, allowances and paused rows (G1 — nothing of it is wired to the gate yet).
 *  - meter(entry) · registerMeter(fn) · onLedgerPing(fn) · onLedgerDelta(fn) · flushLedger()
 *  - ledgerEntries({ from, to }) · ledgerDay(scope, day) · ledgerTotals(by) · totalsOf(list, by) (pure)
 *  - reserve(usd, source) · adjust(id, usd) · settle(id) · reservedUsd()
 *  - estimate(route, req) → { low, high } | null
 *  - ledgerScope() · LEDGER_DB / GOVERNOR_DB (cloud/device.ts, shell/lib/reset.ts)
 *  - totalsNow() · startTotals() · loadToday() · loadMonth() · useGovernorTotals · wipeGovernorScope()
 *  - readDeviceLimit() · deviceLimitOf() · setDeviceLimit(next) · knownScopes() · noteScope() · deviceLineScopes()
 *  - allowOnce(usd) · allowTask(source, usd) · allowanceOf(ctx) · consume(id)
 *  - readPaused(scope) · addPaused(scope, rows) · takePaused(scope, match)
 * The price table itself is src/shared/ai/prices.ts (PRICES, costOf, PRICES_DATE) — re-exported here.
 */
export { meter, registerMeter, onLedgerPing, onLedgerDelta, flushLedger, ledgerEntries, ledgerDay, ledgerTotals, totalsOf, wipeLedgerScope, reserve, adjust, settle, reservedUsd, dayOf, LEDGER_DB, LEDGER_DAYS, type LedgerDelta, type LedgerRange, type LedgerTotal, type TotalsBy } from './ledger'
export { estimate, CHARS_PER_TOKEN, type Band, type EstimateRequest } from './estimate'
export { ledgerScope } from './scope'
export { totalsNow, startTotals, loadToday, loadMonth, useGovernorTotals, wipeGovernorScope, governorOpened, GOVERNOR_DB, TODAY_PREFIX, type TotalsNow, type GovernorTotalsView } from './totals'
export { readDeviceLimit, deviceLimitOf, setDeviceLimit, knownScopes, noteScope, forgetScopes, deviceLineScopes, DEVICE_KEY, SCOPES_KEY, DEVICE_LINE_SPANS_BROWSER, type DeviceLimitResult, type ScopeSeen } from './device'
export { allowOnce, allowTask, allowanceOf, consume, allowedBy, clearAllowances, type AllowToken } from './allow'
export { readPaused, addPaused, takePaused, wipePaused, PAUSED_PREFIX, PAUSED_MAX, type PausedRow, type PausedList } from './paused'
export { BOOK_CHANNEL } from './book'
export type { Binding, Limits, Rest } from './limits'
export type { BrakeFix, BrakeRun, Halt, HaltCheaper, RefuseDetail, RoundVerdict, RunMode, StartVerdict } from './brake'
export { PRICES, PRICES_DATE, costOf, priceRow } from '@/shared/ai/prices'
