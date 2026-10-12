/**
 * The AI rules as the store keeps them (multi-provider slice 1: kept by every reader, written by nobody yet):
 * Workspace.ai (synced; team: meta map 'workspace' key 'ai', owners / admins only), settings.ai (this device) and
 * settings.aiKeys (vault markers of the other providers' keys). Every reader goes through these; the shapes and
 * their sanitizers are shared with the team server (src/shared/ai/policy.ts).
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
  if (keys === s.aiKeys && ai === s.ai) return s
  const out: Settings = { ...s }
  delete out.aiKeys
  delete out.ai
  if (keys) out.aiKeys = keys
  if (ai) out.ai = ai
  return out
}

/** The stored policy generation of this workspace + device (1 without any rule). */
export const aiOf = (ws: Pick<Workspace, 'ai' | 'settings'>): { ws: WorkspaceAI | undefined; device: DeviceAI | undefined } => ({ ws: ws.ai, device: ws.settings.ai })
