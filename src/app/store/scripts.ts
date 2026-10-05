/**
 * One Script (Workspace.scripts): the shape rules, and the sanitizer every copy from outside this tab
 * goes through — stored records, backups, the team meta document, the store's own writes. A script is
 * text (its code) plus a little metadata; nothing in it is ever executed by a reader. Unknown fields
 * are dropped, strings clamped, ids checked; fresh objects only.
 */
import { COLOR_NAMES, type ColorName, type ID, type OneScript, type PageIcon } from './types'

export const SCRIPT_LIMITS = {
  name: 80,
  description: 2000,
  /** characters of code */
  code: 100_000,
  /** scripts per workspace */
  scripts: 500,
} as const

const SAFE_ID = /^[\w-]{1,64}$/
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined)
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const actorId = (v: unknown): string | null => (typeof v === 'string' && v && v.length <= 128 ? v : null)

export const isSafeScriptId = (id: unknown): id is ID => typeof id === 'string' && SAFE_ID.test(id) && !RESERVED_KEYS.has(id)

function sanitizeIcon(v: unknown): PageIcon | null {
  if (!isObj(v)) return null
  const type = own(v, 'type')
  const value = own(v, 'value')
  if (typeof value !== 'string' || !value || value.length > 64) return null
  if (type === 'emoji' || type === 'asset') return { type, value }
  if (type === 'lucide') {
    const color = own(v, 'color')
    return COLOR_NAMES.includes(color as ColorName) ? { type, value, color: color as ColorName } : { type, value }
  }
  return null
}

/** A clean copy of a script, or null when it is not one. `id`: the key it was stored under. */
export function sanitizeScript(id: unknown, raw: unknown): OneScript | null {
  if (!isObj(raw) || !isSafeScriptId(id) || own(raw, 'id') !== id) return null
  const rawName = own(raw, 'name')
  const name = typeof rawName === 'string' ? rawName.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, SCRIPT_LIMITS.name) : ''
  if (!name) return null
  const code = own(raw, 'code')
  const description = own(raw, 'description')
  const createdAt = num(own(raw, 'createdAt'), 0)
  const script: OneScript = {
    id,
    name,
    icon: sanitizeIcon(own(raw, 'icon')),
    code: typeof code === 'string' ? code.slice(0, SCRIPT_LIMITS.code) : '',
    kind: own(raw, 'kind') === 'query' ? 'query' : 'script',
    createdBy: actorId(own(raw, 'createdBy')),
    updatedBy: actorId(own(raw, 'updatedBy')),
    createdAt,
    updatedAt: num(own(raw, 'updatedAt'), createdAt),
  }
  if (typeof description === 'string' && description.trim()) script.description = description.slice(0, SCRIPT_LIMITS.description)
  return script
}

/** Every valid script of a stored / imported map (`dropped`: entries that were not valid). */
export function sanitizeScripts(raw: unknown): { scripts: Record<ID, OneScript>; dropped: number } {
  const scripts: Record<ID, OneScript> = {}
  let dropped = 0
  if (raw === undefined || raw === null) return { scripts, dropped }
  if (!isObj(raw)) return { scripts, dropped: 1 }
  for (const id of Object.keys(raw)) {
    const s = Object.keys(scripts).length < SCRIPT_LIMITS.scripts ? sanitizeScript(id, own(raw, id)) : null
    if (s) scripts[id] = s
    else dropped++
  }
  return { scripts, dropped }
}

/** Two scripts hold the same definition (ignoring updatedAt). */
export function sameScript(a: OneScript | undefined, b: OneScript | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return JSON.stringify({ ...a, updatedAt: 0 }) === JSON.stringify({ ...b, updatedAt: 0 })
}
