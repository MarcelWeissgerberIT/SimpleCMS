/**
 * The return state's record as stored (setup/return.ts) — its reader, pure (Node specs load it). Ids only; anything
 * that is not exactly a record of this member scope reads as none.
 */
import type { LampId, ReturnState } from '../types'

const LAMP_IDS: readonly LampId[] = ['key', 'server', 'test', 'profile', 'database', 'agent', 'firstRun']
const PROFILE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
const RECIPE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/** The stored record: the return state, the member scope it belongs to, and whether the route left #/patchbay since. */
export interface ReturnRecord extends ReturnState {
  scope: string
  /** the route left #/patchbay since the state was set (only then is coming back an arrival) */
  away: boolean
  at: number
}

/** A stored value as a record — anything else (junk, another scope, an id of the wrong shape) reads as none. Pure. */
export function readReturnValue(raw: unknown, scope: string | null): ReturnRecord | null {
  if (typeof raw !== 'string' || !scope) return null
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return null
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  if (o.scope !== scope || typeof o.profileId !== 'string' || !PROFILE_ID.test(o.profileId)) return null
  if (typeof o.next !== 'string' || !(LAMP_IDS as readonly string[]).includes(o.next)) return null
  if (o.recipeId !== undefined && (typeof o.recipeId !== 'string' || !RECIPE_ID.test(o.recipeId))) return null
  const at = typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : 0
  return { profileId: o.profileId, ...(typeof o.recipeId === 'string' ? { recipeId: o.recipeId } : {}), next: o.next as LampId, scope, away: o.away === true, at }
}
