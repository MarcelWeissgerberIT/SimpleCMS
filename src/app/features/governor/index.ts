/**
 * GOVERNOR (Regler) — public API. Slice 1 holds its first part: the ledger (one entry per AI response, per device and
 * member, IndexedDB `one-ledger`), the in-tab reservations and the estimate band. The Regler's UI, budgets and the brake
 * come later and read the same ledger.
 *  - meter(entry) · registerMeter(fn) · onLedgerPing(fn) · onLedgerDelta(fn) · flushLedger()
 *  - ledgerEntries({ from, to }) · ledgerDay(scope, day) · ledgerTotals(by) · totalsOf(list, by) (pure)
 *  - reserve(usd, source) · adjust(id, usd) · settle(id) · reservedUsd()
 *  - estimate(route, req) → { low, high } | null
 *  - ledgerScope() · LEDGER_DB (cloud/device.ts, shell/lib/reset.ts)
 * The price table itself is src/shared/ai/prices.ts (PRICES, costOf, PRICES_DATE) — re-exported here.
 */
export { meter, registerMeter, onLedgerPing, onLedgerDelta, flushLedger, ledgerEntries, ledgerDay, ledgerTotals, totalsOf, wipeLedgerScope, reserve, adjust, settle, reservedUsd, dayOf, LEDGER_DB, LEDGER_DAYS, type LedgerDelta, type LedgerRange, type LedgerTotal, type TotalsBy } from './ledger'
export { estimate, CHARS_PER_TOKEN, type Band, type EstimateRequest } from './estimate'
export { ledgerScope } from './scope'
export { PRICES, PRICES_DATE, costOf, priceRow } from '@/shared/ai/prices'
