/**
 * One MCP — duplicate calls (spec § 2.0), pure: a creating call (MCP_CREATING_TOOLS) whose tool and canonical arguments
 * equal one that still waits for approval joins it (both calls get its result); one equal to a call applied in the last
 * 2 minutes answers that call's result with `duplicateOf` and a note — nothing new is made. No `requestId` argument:
 * the arguments are the key, so a different call is never mistaken for a repeat. Rejected, failed and timed-out calls
 * are not remembered. The tab keeps a map per MCP session (≤ 50 entries); the team server its idempotency store, keyed
 * by token + the key's SHA-256.
 */
import { MCP_CREATING_TOOLS, MCP_LIMITS } from './tables.ts'

/** Is a repeat of this tool's call a duplicate (it makes something new)? */
export const createsSomething = (tool: string): boolean => MCP_CREATING_TOOLS.includes(tool)

/** JSON with sorted object keys at every level (arrays keep their order); `undefined` members are left out. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
}

/**
 * The duplicate key of a call: its tool and its arguments in canonical form, without `workspace` (the bridge's
 * routing argument — the workspace is part of the map the key lives in).
 */
export function duplicateKey(tool: string, args: Record<string, unknown>): string {
  const { workspace: _workspace, ...rest } = args
  return `${tool}\n${canonicalJson(rest)}`
}

/** The note of an answered duplicate (model-facing). */
export const duplicateNote = (seconds: number): string =>
  `already applied ${Math.max(0, Math.round(seconds))} s ago; nothing new was made — to make another, change something (e.g. the title)`

/**
 * The answer to a duplicate: the first call's result, `duplicateOf` = what that call made (its `id`; `true` when the
 * result names none) and the note.
 */
export function duplicateAnswer(result: unknown, appliedAt: number, now: number): Record<string, unknown> {
  const obj = result && typeof result === 'object' && !Array.isArray(result) ? (result as Record<string, unknown>) : { result }
  const made = typeof obj.id === 'string' ? obj.id : true
  const note = duplicateNote((now - appliedAt) / 1000)
  return { ...obj, duplicateOf: made, note: typeof obj.note === 'string' && obj.note ? `${note} · ${obj.note}` : note }
}

/** How long an applied call answers its repeats. */
export const DUPLICATE_MS = MCP_LIMITS.duplicateMs
