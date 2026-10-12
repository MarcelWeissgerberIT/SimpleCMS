/**
 * The Regler's workspace value as the store keeps it (Workspace.governor — write only with setGovernor; every reader
 * sanitizes through src/shared/ai/governor.ts) and the ONE generation stamp of the AI layers:
 *
 *  - governorAllowed() / governorRefusal(): who may write it here — locally the person; in a team owners and admins on a
 *    server that guards it (`supports ∋ 'governor'`, and 'ai' so the stamp travels with it). The team binding registers
 *    its guard (setGovernorGuard).
 *  - restamp(draft, before): Workspace.ai.gen and settings.ai.gen as the stored rules, the governor and this browser's own
 *    line need them (stampGen / stampDeviceGen) — called inside every store update that changes `ai`, `governor` or the
 *    device line (setGovernor, the device stamp, hydrate, replaceAll, cloudPatch); setWorkspaceAI / setDeviceAI stamp
 *    through the same helpers. A stamp this build cannot compute (a newer build's, above every generation it names) is
 *    never touched.
 *  - watchGenInvariant(store): DEV / `?e2e` — an `ai.gen` below what the governor needs after any update is a console
 *    error (every spec fails on a path that forgot the stamp).
 *
 * Nothing here imports the store (store.ts calls these with its draft).
 */
import type { DeviceAI, WorkspaceAI } from '@/shared/ai/types'
import { AI_POLICY_GEN } from '@/shared/ai/policy'
import { GEN } from '@/shared/ai/generations'
import type { Unreadable } from '@/shared/ai/route'
import {
  DEVICE_GOVERNOR_KEY,
  deviceGovernorGen,
  governorGen,
  sanitizeDeviceGovernor,
  sanitizeGovernor,
  stampDeviceGen,
  stampGen,
  type DeviceGovernor,
  type WorkspaceGovernor,
} from '@/shared/ai/governor'
import type { Settings } from './types'
import { sameWorkspaceAI } from './ai'

export const readGovernor = (v: unknown): WorkspaceGovernor | Unreadable | undefined => sanitizeGovernor(v)

/* ------------------------------------------------------------------ */
/* Who may write it                                                     */
/* ------------------------------------------------------------------ */

export type GovernorRefusal = 'rights' | 'server'

let guard: { rights: () => boolean; server: () => boolean } = { rights: () => true, server: () => true }

/** The team binding registers who may write the governor (null: the local workspace — the person). */
export function setGovernorGuard(g: { rights: () => boolean; server: () => boolean } | null): void {
  guard = g ?? { rights: () => true, server: () => true }
}

/** Why a governor write would be refused here (null: allowed). */
export const governorRefusal = (): GovernorRefusal | null => (!guard.rights() ? 'rights' : !guard.server() ? 'server' : null)
export const governorAllowed = (): boolean => governorRefusal() === null

/* ------------------------------------------------------------------ */
/* The stamp                                                            */
/* ------------------------------------------------------------------ */

/**
 * The highest generation this build can compute a stamp for: every entry its GEN table names (the reasons requiredGen and
 * governorGen judge) — also before AI_POLICY_GEN is raised to it (a build holds a budget's stamp before it enforces it).
 * A stored stamp above this is a newer build's: never rewritten here.
 */
export const STAMP_KNOWN: number = Math.max(AI_POLICY_GEN, ...Object.values(GEN))

const genOf = (ai: { gen?: number } | null | undefined): number => (typeof ai?.gen === 'number' ? ai.gen : 1)

/** The person's own line for this browser as the device stamp reads it (unreadable storage: none). */
export function deviceLine(): DeviceGovernor | Unreadable | undefined {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(DEVICE_GOVERNOR_KEY)
    return raw ? sanitizeDeviceGovernor(JSON.parse(raw)) : undefined
  } catch {
    return undefined
  }
}

/**
 * Workspace.ai with the stamp the rules and the governor need now — null: leave it as it is (already right, or a stamp
 * this build cannot compute). undefined: no value at all (no rule and no stamp left).
 */
export function stampedAI(ai: WorkspaceAI | undefined, governor: WorkspaceGovernor | Unreadable | undefined): WorkspaceAI | undefined | null {
  const stored = genOf(ai)
  if (stored > STAMP_KNOWN) return null
  const { gen: _gen, updatedAt: _at, updatedBy: _by, ...rules } = ai ?? {}
  const g = stampGen(rules, governor, ai?.gen)
  if (g === stored) return null
  const { gen: _drop, ...rest } = ai ?? ({} as WorkspaceAI)
  if (g > 1) return { ...rest, gen: g }
  return Object.keys(rules).length ? rest : undefined
}

/** settings.ai with the stamp its own rules and this browser's line need now (null: leave it; undefined: none left). */
export function stampedDeviceAI(ai: DeviceAI | undefined, line: DeviceGovernor | Unreadable | undefined): DeviceAI | undefined | null {
  const stored = genOf(ai)
  if (stored > STAMP_KNOWN) return null
  const { gen: _gen, ...rules } = ai ?? {}
  const g = stampDeviceGen(rules, line, ai?.gen)
  if (g === stored) return null
  if (g > 1) return { ...rules, gen: g }
  return Object.keys(rules).length ? rules : undefined
}

/** The parts of the store's state the stamp reads and writes (an Immer draft). */
export interface StampDraft {
  ai?: WorkspaceAI
  governor?: WorkspaceGovernor | Unreadable
  settings: Settings
}

/**
 * Re-stamp both AI layers of a draft (inside the same set() as the change that needed it). `before`: Workspace.ai before
 * the update — a stamped value equal to it keeps that reference (subscribers compare by reference; the team binding by
 * value). `device`: also the device layer (it reads this browser's line from localStorage — only where the settings or
 * the line may have changed; `line` hands in the value just written).
 */
export function restamp(s: StampDraft, opts: { before?: WorkspaceAI; device?: boolean; line?: DeviceGovernor | Unreadable | undefined } = {}): void {
  const ai = stampedAI(s.ai, s.governor)
  // never `delete`: zustand merges the next state into the previous one, a missing key stays
  if (ai !== null) s.ai = opts.before && sameWorkspaceAI(ai, opts.before) ? opts.before : ai
  if (!opts.device) return
  const dev = stampedDeviceAI(s.settings.ai, 'line' in opts ? opts.line : deviceLine())
  if (dev === null) return
  if (dev) s.settings.ai = dev
  // settings.ai is never in defaultSettings(): no key rather than an `ai: undefined` in the record
  else delete s.settings.ai
}

/* ------------------------------------------------------------------ */
/* DEV / ?e2e invariant                                                 */
/* ------------------------------------------------------------------ */

function strict(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) return true
    return new URLSearchParams(window.location.search).has('e2e')
  } catch {
    return false
  }
}

interface GenState {
  ready?: boolean
  ai?: WorkspaceAI
  governor?: WorkspaceGovernor | Unreadable
  settings: Settings
}

/**
 * DEV / `?e2e`: after any update, an `ai.gen` below the generation the governor needs (or a device stamp below this
 * browser's line, when the device layer changed) is a console error — the recorder's strict() pattern.
 */
export function watchGenInvariant(store: { subscribe: (fn: (state: GenState, prev: GenState) => void) => () => void }): void {
  if (!strict()) return
  store.subscribe((state, prev) => {
    if (!state.ready) return
    if (state.ai !== prev.ai || state.governor !== prev.governor) {
      const need = governorGen(state.governor)
      if (genOf(state.ai) < need) console.error("[governor] ai.gen below the governor's generation", genOf(state.ai), need)
    }
    if (state.settings.ai !== prev.settings.ai) {
      const need = deviceGovernorGen(deviceLine())
      if (genOf(state.settings.ai) < need) console.error("[governor] settings.ai.gen below this browser's line", genOf(state.settings.ai), need)
    }
  })
}
