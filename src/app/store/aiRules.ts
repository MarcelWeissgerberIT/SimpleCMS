/**
 * The setters of the AI rules (D-S2-2) — the only way they are written:
 *  - setWorkspaceAI(next | (prev) => next): the workspace's rules (Workspace.ai; team: owners / admins on a server that
 *    guards them — the store action refuses otherwise, keeps Claude's entry while the server's agents cannot read it,
 *    stamps `gen` / updatedAt / updatedBy). S2 writes `policy` (+ `limits`); the routes UI comes with S5.
 *  - setDeviceAI(patch): this device's layer (settings.ai — never synced), its `gen` stamped with what its own rules need
 *    (a Claude narrow → 2); device rules per kind of work, the device default (settings.aiModel kept in step when it is a
 *    Claude route, so older tabs keep working), the roles per provider.
 * Both run under the caller's writer (a press: the person; background work names its own).
 */
import type { DeviceAI, FeatureClass, ProviderId, RouteRule, WorkspaceAI } from '@/shared/ai/types'
import { policyKnown } from '@/shared/ai/policy'
import { DEVICE_GOVERNOR_KEY, sanitizeDeviceGovernor, stampDeviceGen } from '@/shared/ai/governor'
import { sanitizeRule } from '@/shared/ai/route'
import { modelRow } from '@/shared/ai/models'
import { useWorkspace } from './store'
import { readDeviceAI } from './ai'

export { aiRulesAllowed, claudeRulesAllowed } from './ai'

/** Write the workspace's AI rules (a value, or a function of the current ones). */
export function setWorkspaceAI(next: WorkspaceAI | null | ((prev: WorkspaceAI | undefined) => WorkspaceAI | null)): { ok: boolean; claudeKept?: true } {
  const s = useWorkspace.getState()
  const value = typeof next === 'function' ? next(s.ai) : next
  return s.setWorkspaceAI(value)
}

/** The person's own line for this browser (the Regler, localStorage) as the device stamp reads it (unreadable storage: none). */
function deviceLine() {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(DEVICE_GOVERNOR_KEY)
    return raw ? sanitizeDeviceGovernor(JSON.parse(raw)) : undefined
  } catch {
    return undefined
  }
}

/**
 * Change this device's AI layer: keys of `patch` replace the stored ones (undefined removes one). Refused (false) when
 * the stored layer was written by a newer build (its generation is unknown here — never overwritten). Its `gen` is
 * stamped with stampDeviceGen: its own rules and the person's line for this browser — never below a budget's stamp.
 */
export function setDeviceAI(patch: Partial<DeviceAI>): boolean {
  const s = useWorkspace.getState()
  const cur = s.settings.ai
  if (!policyKnown(null, cur)) return false
  const merged: Record<string, unknown> = { ...(cur ?? {}) }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete merged[k]
    else merged[k] = v
  }
  delete merged.gen
  const clean = readDeviceAI(JSON.parse(JSON.stringify(merged)))
  const g = stampDeviceGen(clean, deviceLine(), cur?.gen)
  const ai = clean || g > 1 ? { ...(clean ?? {}), ...(g > 1 ? { gen: g } : {}) } : undefined
  if (JSON.stringify(ai ?? null) === JSON.stringify(cur ?? null)) return true
  s.updateSettings({ ai })
  return true
}

/** This device's rule for a kind of work (null: none — the workspace's, the default, or legacy decide). */
export const deviceRule = (cls: FeatureClass): RouteRule | null => useWorkspace.getState().settings.ai?.routes?.[cls] ?? null

/** Set (or clear: null) this device's rule for a kind of work. */
export function setDeviceRule(cls: FeatureClass, rule: RouteRule | null): boolean {
  const clean = rule ? sanitizeRule(rule) : null
  if (rule && !clean) return false
  const routes = { ...(useWorkspace.getState().settings.ai?.routes ?? {}) }
  if (clean) routes[cls] = clean
  else delete routes[cls]
  return setDeviceAI({ routes: Object.keys(routes).length ? routes : undefined })
}

/**
 * Set (or clear) this device's default for every kind of work. A Claude default keeps settings.aiModel in step (an
 * older tab, which knows only that setting, then uses the same model).
 */
export function setDeviceDefault(rule: RouteRule | null): boolean {
  const clean = rule ? sanitizeRule(rule) : null
  if (rule && !clean) return false
  const ok = setDeviceAI({ default: clean ?? undefined })
  const first = clean?.[0]
  if (ok && first?.p === 'anthropic' && modelRow(first)?.selectable && useWorkspace.getState().settings.aiModel !== first.m) useWorkspace.getState().updateSettings({ aiModel: first.m })
  return ok
}

/** Set a provider's roles (fast / standard / deep → model ids; null: clear them). */
export function setRoles(p: ProviderId, roles: { fast?: string; standard?: string; deep?: string } | null): boolean {
  const all = { ...(useWorkspace.getState().settings.ai?.roles ?? {}) }
  if (roles && Object.values(roles).some(Boolean)) all[p] = roles
  else delete all[p]
  return setDeviceAI({ roles: Object.keys(all).length ? all : undefined })
}
