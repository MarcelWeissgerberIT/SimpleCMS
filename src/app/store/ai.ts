/**
 * The AI rules as the store keeps them: Workspace.ai (synced; team: meta map 'workspace' key 'ai', owners / admins only),
 * settings.ai (this device) and settings.aiKeys (vault markers of the other providers' keys). Every reader goes through
 * these; the shapes and their sanitizers are shared with the team server (src/shared/ai/policy.ts). Who may write the
 * workspace's rules here: aiRulesAllowed() / claudeRulesAllowed() (the team binding registers its guard); the setters
 * are in store/aiRules.ts.
 */
import { sanitizeDeviceAI, sanitizeWorkspaceAI } from '@/shared/ai/policy'
import type { DeviceAI, WorkspaceAI } from '@/shared/ai/types'
import { isSecretMarker } from '../lib/vault'
import type { Settings, Workspace } from './types'

export const readWorkspaceAI = (v: unknown): WorkspaceAI | undefined => sanitizeWorkspaceAI(v)
export const readDeviceAI = (v: unknown): DeviceAI | undefined => sanitizeDeviceAI(v)

/** settings.aiKeys as every reader keeps it: markers only, per known provider (undefined: none). */
export function readAIKeys(v: unknown): Settings['aiKeys'] {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const out: NonNullable<Settings['aiKeys']> = {}
  for (const p of ['openai', 'openrouter'] as const) {
    const m = (v as Record<string, unknown>)[p]
    // a vault marker — the only thing a key slot ever holds
    if (isSecretMarker(m)) out[p] = m
  }
  return Object.keys(out).length ? out : undefined
}

/** Stable JSON (keys sorted) — for "the same rules?" by value. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(v ?? null)
}

/** The same workspace AI rules (by value; both absent = the same). */
export function sameWorkspaceAI(a: WorkspaceAI | null | undefined, b: WorkspaceAI | null | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return !a && !b
  return stable(a) === stable(b)
}

/**
 * Settings read from anywhere (storage, a team overlay): aiKeys holds markers only and settings.ai is sanitized; both
 * are left out when there is nothing valid (never keys with undefined values — the record stays byte-equal).
 */
export function withCleanAISettings(s: Settings): Settings {
  const keys = readAIKeys(s.aiKeys)
  const ai = readDeviceAI(s.ai)
  const workspaceAI = readDeviceAI(s.workspaceAI)
  if (keys === s.aiKeys && ai === s.ai && workspaceAI === s.workspaceAI) return s
  const out: Settings = { ...s }
  delete out.aiKeys
  delete out.ai
  delete out.workspaceAI
  if (keys) out.aiKeys = keys
  if (ai) out.ai = ai
  if (workspaceAI) out.workspaceAI = workspaceAI
  return out
}

/** The stored policy generation of this workspace + device (1 without any rule). */
export function workspaceDeviceAI(ws: Pick<Workspace, 'ai' | 'settings'>): DeviceAI | undefined {
  const base = ws.settings.ai, scoped = ws.ai?.onboarding ? readDeviceAI(ws.settings.workspaceAI) : undefined
  if (!ws.ai?.onboarding) return base
  const defaults = Object.fromEntries(Object.entries(ws.ai.routes??{}).filter(([k])=>k!=='*'))
  return {...base,...scoped,default:scoped?.default??ws.ai.routes?.['*']??base?.default,allow:{...base?.allow,...scoped?.allow},narrow:{...base?.narrow,...scoped?.narrow},routes:{...base?.routes,...defaults,...scoped?.routes},gen:Math.max(base?.gen??1,scoped?.gen??1)}
}
export const aiOf = (ws: Pick<Workspace, 'ai' | 'settings'>): { ws: WorkspaceAI | undefined; device: DeviceAI | undefined } => ({ ws: ws.ai, device: workspaceDeviceAI(ws) })

/* ------------------------------------------------------------------ */
/* Who may write the workspace's rules (the team binding registers)     */
/* ------------------------------------------------------------------ */

let guard: { rules: () => boolean; claude: () => boolean } = { rules: () => true, claude: () => true }

/**
 * Who may write Workspace.ai here: locally the person; in a team owners / admins on a server that guards the rules
 * (`supports ∋ 'ai'`). Claude's own rules additionally need a server whose agents read them (`supports ∋ 'providers'`,
 * S9 — D-S2-30): until then the workspace's Claude column stays as it is. The binding registers its guard; null = local.
 */
export function setAIRulesGuard(g: { rules: () => boolean; claude: () => boolean } | null): void {
  guard = g ?? { rules: () => true, claude: () => true }
}
export const aiRulesAllowed = (): boolean => guard.rules()
export const claudeRulesAllowed = (): boolean => guard.rules() && guard.claude()
