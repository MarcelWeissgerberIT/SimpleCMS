/**
 * PREFLIGHT ("Vorflug-Check") — public API (re-exported by features/index.ts). The lamp panel on Start: a lamp for
 * each kind of thing that waits on the person (proposals, gates, a refused token …), counted for 0 tokens — no
 * Claude call, no page-map walk, read in idle. MASTER CAUTION in the topbar; keys only with focus in the plate.
 * Other areas add lamps with `registerLampSource` imported from './registry' directly (dependency-free).
 *  - startPreflight(): main.tsx, once, after the Outbox
 *  - preflightHoldsStart(): bootRedirect — the first boot of a Preflight day stays on "#/" when lamps were lit
 *  - MasterCautionKey (Topbar .tb-right, first) · PreflightHome (Home, first child of .home__inner) ·
 *    PreflightSettings (Settings → Appearance)
 *  - usePreflightOn() · usePlateMode() · usePreflightSections() · openPreflight() (⌘K "Preflight")
 */
import './preflight.css'

export * from './registry'
export { startPreflight } from './start'
export { preflightHoldsStart } from './boot'
export { MasterCautionKey } from './ui/MasterCaution'
export { PreflightHome } from './ui/PreflightHome'
export { PreflightSettings } from './ui/Settings'
export { usePreflightOn, preflightIsOn, usePlateModeOnly as usePlateMode, usePreflightSections, openPreflight } from './hooks'
