/**
 * The Patchbay's allowed paths (Workspace.fuseSignoffs — "Allow this path" / "Weg zulassen", plan §1.10 / §2.8): the
 * reader every caller goes through, the pure helpers the store's writers use, and who may write them here. Pure — no
 * store, no i18n, no DOM: Node specs import this file directly.
 *
 *  - sanitizeFuseSignoffs(raw): keys are path keys (64 lower-case hex); `sig` 64 hex; `parts` ≤ 24 entries of
 *    `[a-z]\d{0,2}` → 16 hex; `at` finite; `updatedBy` a string of 1–200 characters or null (absent = null). An entry
 *    that breaks a rule is left out — its fuse stays open, the fail-safe side. At most 500 entries: the newest kept
 *    (`at`, then the key). Unknown fields of an entry (a later build's) are kept while together ≤ 1 KB as JSON, else
 *    dropped (the entry stays). The same input keeps its reference: a clean map comes back as it is, any other
 *    object's answer is remembered — a memo over the answer (the model's inputs, B2) keeps its reference. Nothing, or
 *    no object, reads as one frozen {}. The input is read as data: a caller never changes it afterwards.
 *  - sameSignoffs(a, b): by value (absent = none) — the store and the team binding keep their reference when equal.
 *  - signoffEntry / withSignoff / withoutSignoff: an entry built and checked, a map with one entry more (the newest 500
 *    kept, as the reader keeps them) or one less — what signOffFuse / withdrawSignoff (store.ts) write; restoredEntry:
 *    an entry put back as it was (restoreSignoff — the Patchbay's Undo of key 3).
 *  - setSignoffGuard / signoffRefusal / signoffsAllowed / signoffAdmins: locally the person; in a team owners and
 *    admins on a server that guards the map (`supports ∋ 'signoffs'`) — cloud/workspace.ts registers the guard.
 *
 * No stampGen (an allowed path changes no AI policy) and no schema gate (not a document node). An older build that
 * saves the local record without the field drops it: the fuses come back open.
 */
import type { FuseSignoff } from './types'

export const SIGNOFF_LIMITS = {
  /** entries kept (the newest) */
  entries: 500,
  /** part digests per entry */
  parts: 24,
  /** unknown fields of an entry, together, as JSON (UTF-8 bytes) */
  extraBytes: 1024,
  /** `updatedBy` characters */
  updatedBy: 200,
} as const

const HEX64 = /^[0-9a-f]{64}$/
const HEX16 = /^[0-9a-f]{16}$/
const PART = /^[a-z]\d{0,2}$/
const KNOWN = new Set(['sig', 'parts', 'at', 'updatedBy'])
/** keys never copied into an object built here */
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype'])

const NONE: Record<string, FuseSignoff> = Object.freeze({}) as Record<string, FuseSignoff>

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

/** A path key (SHA-256 hex of the path's ids, features/patchbay sig.ts). */
export const isPathKey = (v: unknown): v is string => typeof v === 'string' && HEX64.test(v)

/* ------------------------------------------------------------------ */
/* Entries                                                              */
/* ------------------------------------------------------------------ */

/** The part digests as stored, or null when one breaks the rules (the entry is then no allowance). */
function cleanParts(raw: unknown): Record<string, string> | null {
  if (!isObj(raw)) return null
  const keys = Object.keys(raw)
  if (keys.length > SIGNOFF_LIMITS.parts) return null
  const out: Record<string, string> = {}
  for (const k of keys) {
    const v = raw[k]
    if (!PART.test(k) || typeof v !== 'string' || !HEX16.test(v)) return null
    out[k] = v
  }
  return out
}

/** JSON with sorted keys (equal values in another key order read the same); undefined: not JSON. */
function stable(v: unknown): string | undefined {
  try {
    return JSON.stringify(v, (_k, x: unknown) => {
      if (!isObj(x)) return x
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(x).sort()) out[k] = x[k]
      return out
    })
  } catch {
    return undefined
  }
}

let encoder: TextEncoder | null = null
const bytes = (s: string) => (encoder ??= new TextEncoder()).encode(s).length

/** An entry's unknown fields as plain JSON while together ≤ 1 KB, else none. */
function extrasOf(raw: Record<string, unknown>): Record<string, unknown> {
  const pick: Record<string, unknown> = {}
  let any = false
  for (const k of Object.keys(raw)) {
    if (KNOWN.has(k) || UNSAFE.has(k)) continue
    pick[k] = raw[k]
    any = true
  }
  if (!any) return {}
  let json: string | undefined
  try {
    json = JSON.stringify(pick)
  } catch {
    return {}
  }
  if (json === undefined || bytes(json) > SIGNOFF_LIMITS.extraBytes) return {}
  const parsed: unknown = JSON.parse(json)
  if (!isObj(parsed)) return {}
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(parsed)) if (!UNSAFE.has(k)) out[k] = parsed[k]
  return out
}

/** One entry as stored, or null when it is no allowance. */
function cleanEntry(raw: unknown): FuseSignoff | null {
  if (!isObj(raw)) return null
  const { sig, at, updatedBy } = raw
  if (typeof sig !== 'string' || !HEX64.test(sig)) return null
  const parts = cleanParts(raw.parts)
  if (!parts) return null
  if (typeof at !== 'number' || !Number.isFinite(at)) return null
  let by: string | null = null
  if (updatedBy !== undefined && updatedBy !== null) {
    if (typeof updatedBy !== 'string' || !updatedBy || updatedBy.length > SIGNOFF_LIMITS.updatedBy) return null
    by = updatedBy
  }
  return { sig, parts, at, updatedBy: by, ...extrasOf(raw) }
}

/** One stored entry as this build reads it (null: no allowance) — the team binding compares the document's with the store's. */
export const readSignoff = (raw: unknown): FuseSignoff | null => cleanEntry(raw)

const extraKeys = (e: object) => Object.keys(e).filter((k) => !KNOWN.has(k))

/** Two stored entries hold the same (every field, unknown ones included). */
export function sameSignoff(a: FuseSignoff, b: FuseSignoff): boolean {
  if (a === b) return true
  // (callers may hand in what a store holds unread: anything that is not an entry is the same only as itself)
  if (!isObj(a) || !isObj(b) || !isObj(a.parts) || !isObj(b.parts)) return false
  if (a.sig !== b.sig || a.at !== b.at || (a.updatedBy ?? null) !== (b.updatedBy ?? null)) return false
  const pa = Object.keys(a.parts)
  if (pa.length !== Object.keys(b.parts).length || pa.some((k) => !own(b.parts, k) || b.parts[k] !== a.parts[k])) return false
  const xa = extraKeys(a)
  const xb = extraKeys(b)
  if (!xa.length && !xb.length) return true
  const pick = (e: object, keys: string[]) => Object.fromEntries(keys.map((k) => [k, (e as Record<string, unknown>)[k]]))
  return stable(pick(a, xa)) === stable(pick(b, xb))
}

/** Is `raw` exactly the entry the reader makes of it (no field dropped, none changed)? */
const unchanged = (raw: unknown, clean: FuseSignoff): boolean =>
  isObj(raw) && Object.keys(raw).length === Object.keys(clean).length && raw.updatedBy !== undefined && sameSignoff(raw as unknown as FuseSignoff, clean)

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v)
    for (const x of Object.values(v as Record<string, unknown>)) deepFreeze(x)
  }
  return v
}

/** Newest first (`at`), then by key — the order the cap keeps. */
const newestFirst = (a: [string, FuseSignoff], b: [string, FuseSignoff]) => b[1].at - a[1].at || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)

/* ------------------------------------------------------------------ */
/* The reader                                                           */
/* ------------------------------------------------------------------ */

const answers = new WeakMap<object, Record<string, FuseSignoff>>()

/** The allowed paths as this build reads them (see the header). */
export function sanitizeFuseSignoffs(raw: unknown): Record<string, FuseSignoff> {
  if (!isObj(raw)) return NONE
  const known = answers.get(raw)
  if (known) return known
  const out = read(raw)
  answers.set(raw, out)
  return out
}

function read(raw: Record<string, unknown>): Record<string, FuseSignoff> {
  const entries: Array<[string, FuseSignoff]> = []
  let clean = true
  for (const key of Object.keys(raw)) {
    const v = raw[key]
    const entry = HEX64.test(key) ? cleanEntry(v) : null
    if (!entry) {
      clean = false
      continue
    }
    if (clean && !unchanged(v, entry)) clean = false
    entries.push([key, entry])
  }
  if (!entries.length) return NONE
  if (entries.length > SIGNOFF_LIMITS.entries) {
    clean = false
    entries.sort(newestFirst)
    entries.length = SIGNOFF_LIMITS.entries
  }
  if (clean) return raw as Record<string, FuseSignoff>
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const out: Record<string, FuseSignoff> = {}
  for (const [k, e] of entries) out[k] = e
  return deepFreeze(out)
}

/** Two maps of allowed paths hold the same (absent / null = none). */
export function sameSignoffs(a: Record<string, FuseSignoff> | null | undefined, b: Record<string, FuseSignoff> | null | undefined): boolean {
  if (a === b) return true
  const ka = a ? Object.keys(a) : []
  const kb = b ? Object.keys(b) : []
  if (ka.length !== kb.length) return false
  for (const k of ka) if (!b || !own(b, k) || !sameSignoff(a![k], b[k])) return false
  return true
}

/* ------------------------------------------------------------------ */
/* What the writers write                                               */
/* ------------------------------------------------------------------ */

/** An allowance as stored (null: not one — a signature or a part digest that breaks the rules). */
export function signoffEntry(input: { sig: unknown; parts: unknown; at: number; updatedBy: string | null }): FuseSignoff | null {
  const e = cleanEntry({ sig: input.sig, parts: input.parts, at: input.at, updatedBy: input.updatedBy })
  return e ? deepFreeze(e) : null
}

/**
 * An allowance put back exactly as it was stored (an Undo of the Patchbay's key 3: `at` and `updatedBy` kept, unknown
 * fields too while ≤ 1 KB) — null when it is no allowance. A team server stamps `updatedBy` with whoever writes it.
 */
export function restoredEntry(raw: unknown): FuseSignoff | null {
  const e = cleanEntry(raw)
  return e ? deepFreeze(e) : null
}

/** The map with `key` allowed as `entry` (its other entries as they were; the newest 500 kept, as the reader keeps them). */
export function withSignoff(cur: Record<string, FuseSignoff> | undefined, key: string, entry: FuseSignoff): Record<string, FuseSignoff> {
  const list = Object.entries(cur ?? {}).filter(([k]) => k !== key)
  list.push([key, entry])
  if (list.length > SIGNOFF_LIMITS.entries) {
    list.sort(newestFirst)
    // the new entry is the one written now: it never goes for an older one
    const keep = list.filter(([k]) => k !== key).slice(0, SIGNOFF_LIMITS.entries - 1)
    list.length = 0
    list.push(...keep, [key, entry])
  }
  const out: Record<string, FuseSignoff> = {}
  for (const [k, e] of list) out[k] = e
  return out
}

/** The map without `key` (undefined: none left). */
export function withoutSignoff(cur: Record<string, FuseSignoff> | undefined, key: string): Record<string, FuseSignoff> | undefined {
  const list = Object.entries(cur ?? {}).filter(([k]) => k !== key)
  return list.length ? Object.fromEntries(list) : undefined
}

/* ------------------------------------------------------------------ */
/* Who may write them here                                              */
/* ------------------------------------------------------------------ */

/**
 * Why a write is refused here: 'readOnly' (a viewer, a read-only or outdated tab, a stopped workspace), 'rights' (a team
 * member who is not an owner or admin — the server puts such a change back too), 'server' (a team server that does not
 * guard the map: `/api/config` `supports` without 'signoffs' — the Patchbay says `features.patchbay.key.serverOld`).
 */
export type SignoffRefusal = 'readOnly' | 'rights' | 'server'

/**
 * A writer's answer: 'invalid' = not a path key, a signature or part digests; with 'rights' the owners' and admins'
 * names (the refusal names them — "Only owners and admins: …"; [] while not known).
 */
export interface SignoffResult {
  ok: boolean
  why?: SignoffRefusal | 'invalid'
  admins?: string[]
}

/** The refusal as a writer answers it (null: allowed). */
export function signoffRefused(): SignoffResult | null {
  const why = signoffRefusal()
  if (!why) return null
  return why === 'rights' ? { ok: false, why, admins: guard.admins() } : { ok: false, why }
}

export interface SignoffGuard {
  /** may this tab write the workspace at all */
  writable: () => boolean
  /** owners and admins */
  rights: () => boolean
  /** the server guards the map (`supports ∋ 'signoffs'`) */
  server: () => boolean
  /** the owners' and admins' names, for the refusal ("Only owners and admins: …"; [] while not known) */
  admins: () => string[]
}

const LOCAL: SignoffGuard = { writable: () => true, rights: () => true, server: () => true, admins: () => [] }
let guard: SignoffGuard = LOCAL

/** The team workspace registers who may write the allowed paths (null: the local workspace — the person). */
export function setSignoffGuard(g: SignoffGuard | null): void {
  guard = g ?? LOCAL
}

/** Why a write would be refused here (null: allowed). */
export const signoffRefusal = (): SignoffRefusal | null => (!guard.writable() ? 'readOnly' : !guard.rights() ? 'rights' : !guard.server() ? 'server' : null)
export const signoffsAllowed = (): boolean => signoffRefusal() === null
/** The owners' and admins' names (team; [] locally and while not known). */
export const signoffAdmins = (): string[] => guard.admins()
