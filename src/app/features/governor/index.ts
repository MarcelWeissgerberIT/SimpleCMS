/**
 * GOVERNOR (Regler) — public API. The ledger (one entry per AI response, per device and member, IndexedDB `one-ledger`),
 * reservations (in this tab and, through the book, across tabs), the estimate band, and the Regler's totals, the device
 * line, allowances and paused rows. The brake at the gate is install.ts (features/index.ts installGovernor — not exported
 * here: it imports the gate, which imports this index).
 *  - meter(entry) · registerMeter(fn) · onLedgerPing(fn) · onLedgerDelta(fn) · flushLedger()
 *  - ledgerEntries({ from, to }) · ledgerDay(scope, day) · ledgerTotals(by) · totalsOf(list, by) (pure)
 *  - reserve(usd, source) · adjust(id, usd) · settle(id) · reservedUsd()
 *  - estimate(route, req) → { low, high } | null
 *  - ledgerScope() · LEDGER_DB / GOVERNOR_DB (cloud/device.ts, shell/lib/reset.ts)
 *  - totalsNow() · startTotals() · loadToday() · loadMonth() · useGovernorTotals · wipeGovernorScope()
 *  - readDeviceLimit() · deviceLimitOf() · setDeviceLimit(next) · writeDeviceLimit(next) (+ the device AI stamp) · knownScopes()
 *    · noteScope() · deviceLineScopes()
 *  - allowOnce(usd) · allowTask(source, usd) · allowanceOf(ctx) · consume(id)
 *  - readPaused(scope) · addPaused(scope, rows) · takePaused(scope, match)
 *  - background work at the line (background.ts): budgetRefusal · brakeFixOf · watchSource · pauseRows · takeRows ·
 *    pausedRows · onLineChange; BrakeSlot (lazy) — the brake note for a refused request, its E / B keys wired
 *  - RUN_MODES · modeOf(purpose, given) · missesMode · minOut(purpose, thinks) · sourceFor(purpose, id) (modes.ts)
 *  - reserveDecide(…) · decideUsd(…) · takeDecide(id, band) · decideLeft(id) — a run's decide reservation for Jev's
 *    pre-checks (decide.ts; decideUsd: what it would take — the start check counts it)
 * The price table itself is src/shared/ai/prices.ts (PRICES, costOf, PRICES_DATE) — re-exported here.
 */
import { lazy } from 'react'
export { meter, registerMeter, onLedgerPing, onLedgerDelta, flushLedger, ledgerEntries, ledgerDay, ledgerTotals, totalsOf, wipeLedgerScope, reserve, adjust, settle, reservedUsd, dayOf, LEDGER_DB, LEDGER_DAYS, type LedgerDelta, type LedgerRange, type LedgerTotal, type TotalsBy } from './ledger'
export { estimate, CHARS_PER_TOKEN, type Band, type EstimateRequest } from './estimate'
export { ledgerScope } from './scope'
export { totalsNow, startTotals, loadToday, loadMonth, useGovernorTotals, wipeGovernorScope, governorOpened, GOVERNOR_DB, TODAY_PREFIX, type TotalsNow, type GovernorTotalsView } from './totals'
export { readDeviceLimit, deviceLimitOf, setDeviceLimit, knownScopes, noteScope, forgetScopes, deviceLineScopes, DEVICE_KEY, SCOPES_KEY, DEVICE_LINE_SPANS_BROWSER, type DeviceLimitResult, type ScopeSeen } from './device'
export { writeDeviceLimit } from './line'
export { allowOnce, allowTask, allowanceOf, consume, allowedBy, clearAllowances, type AllowToken } from './allow'
export { readPaused, addPaused, takePaused, wipePaused, PAUSED_PREFIX, PAUSED_MAX, type PausedRow, type PausedList } from './paused'
export { BOOK_CHANNEL } from './book'
export { RUN_MODES, CALLER_MODE, isRunMode, modeRow, modeOf, missesMode, minOut, sourceFor, SOURCE_RE, type AnswerKind, type ModeRow } from './modes'
export type { Binding, Limits, Rest } from './limits'
export type { BrakeFix, BrakeRun, Halt, HaltCheaper, HCandidate, HistoryNeeds, RefuseDetail, RoundVerdict, RunMode, StartVerdict } from './brake'
export { ALLOW_USD } from './brake'
export { budgetRefusal, brakeFixOf, watchSource, pauseRows, takeRows, pausedRows, onLineChange, type BudgetRefusal, type BrakeFixData } from './background'
export { FIRST_STEP_OUT } from './mcpBand'
export { reserveDecide, decideUsd, takeDecide, decideLeft, decideBand, DECIDE_CHECKS, DECIDE_STATE_CHARS } from './decide'
export { planBand, type PlanBand } from './plan'
export { noteHalt, noteHeld, useGovernorMarks } from './marks'
export { openRegler, openBudgets, budgetSet, reglerLine, reglerRest } from './lampSource'
/** the static mini bar (spent · this request · the red line) — a run row's Regler line, the brake note, the status cell */
export { MiniBar } from './ui/MiniBar'
/** #/regler (the page is a lazy chunk) */
export { ReglerRoute } from './route'
/** the status bar's REGLER cell, wired (shown while a budget exists) */
export { GovernorStatusCell, ReglerRestLine } from './statusGate'
export { fmtBand, fmtLimit, fmtOf } from './format'
export type { HaltCardProps } from './ui/HaltCard'
/** The halt card (lazy chunk: the AI terminal renders it when a task waits at the red line) */
export const loadHaltCard = () => import('./ui/HaltCard').then((m) => ({ default: m.HaltCard }))
export type { BrakeForProps } from './ui/BrakeFor'
/**
 * The brake note for a refused request (AIError 'budget') with its keys wired (E / B retry through `onRetry`, Esc):
 * lazy — the chunk loads only when a note is shown (only ever with a budget set). Render it inside <Suspense>.
 */
export const BrakeSlot = lazy(() => import('./ui/BrakeFor'))
/** Workspace › AI § 06 — the workspace's day / month budget (lazy; render it inside <Suspense>). */
export const BudgetSlot = lazy(() => import('./ui/BudgetSection'))
export { PRICES, PRICES_DATE, costOf, priceRow } from '@/shared/ai/prices'
