/**
 * Custom agents — what this device's mirror setups made, per workspace: the report pages the setups made (or took back)
 * for a database, newest first (`{ [dbId]: [reportId, …] }`, ≤ MIRROR_REPORTS_PER_DB per database, ≤ MIRROR_REPORTS_MAX
 * databases — the one used longest ago goes first). "Use …" (mirror.ts reuseMirror) takes the newest of them that is
 * still free back instead of making another page of the same title — never a page found by its title. Several are kept
 * so that a page set aside for a newer one (a saved agent used it then) comes back once that newer one is gone.
 *
 * localStorage `one.mirror.reports:<kind>:<id>` (local:local / cloud:<id>): per device, never synced, never in a backup
 * or export; wiped with a team workspace's copy (cloud/device.ts) and by the local reset (shell/lib/reset.ts). Every
 * read is checked (ids only; an older value of one id per database reads as a list of one). This tab keeps its own copy
 * too, and every read merges it in: what this tab remembered counts here even when storage refused the write (blocked,
 * full) — and with no storage at all.
 */
import { activeWorkspace } from '../../cloud'
import type { ID } from '../../store/types'

export const MIRROR_REPORTS_MAX = 100
export const MIRROR_REPORTS_PER_DB = 5
export const mirrorReportsKey = (scope: string) => `one.mirror.reports:${scope}`

const SAFE_ID = /^[\w-]{1,64}$/
const RESERVED = new Set(['__proto__', 'constructor', 'prototype'])
const okId = (v: unknown): v is ID => typeof v === 'string' && SAFE_ID.test(v) && !RESERVED.has(v)

type Entry = [ID, ID[]]

/** This tab's own memory per workspace (merged into every read). */
const memory = new Map<string, Entry[]>()

const scope = () => {
  const ws = activeWorkspace()
  return `${ws.kind}:${ws.id}`
}

/** A stored value: one id (older form) or a list of ids, newest first — only safe ids, no repeats. */
function reportsOf(v: unknown): ID[] {
  const list = typeof v === 'string' ? [v] : Array.isArray(v) ? v : []
  return [...new Set(list.filter(okId))].slice(0, MIRROR_REPORTS_PER_DB)
}

/** What storage holds (null: nothing stored, junk, or no storage). */
function stored(key: string): Entry[] | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return null
    const v: unknown = JSON.parse(raw)
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null
    const out: Entry[] = []
    for (const [db, value] of Object.entries(v as Record<string, unknown>)) {
      if (!okId(db)) continue
      const reports = reportsOf(value)
      if (reports.length) out.push([db, reports])
    }
    return out
  } catch {
    return null
  }
}

/**
 * The databases in the order they were used (oldest first), each with its pages (newest first): storage, with what this
 * tab remembered merged in — a page this tab remembered that storage lacks (its write failed) goes first for its
 * database, a database storage lacks goes last (the newest).
 */
function load(key: string): Entry[] {
  const out = (stored(key) ?? []).map(([db, reports]): Entry => [db, [...reports]])
  for (const [db, mine] of memory.get(key) ?? []) {
    const at = out.findIndex(([d]) => d === db)
    if (at < 0) {
      out.push([db, [...mine]])
      continue
    }
    const missing = mine.filter((r) => !out[at][1].includes(r))
    if (missing.length) out[at] = [db, [...missing, ...out[at][1]].slice(0, MIRROR_REPORTS_PER_DB)]
  }
  return out.slice(-MIRROR_REPORTS_MAX)
}

/** The report pages this device's setups made (or took back) for `dbId`, newest first. Not checked against the pages. */
export function rememberedReports(dbId: ID): ID[] {
  return load(mirrorReportsKey(scope())).find(([db]) => db === dbId)?.[1] ?? []
}

/** The newest of them (null: none remembered). */
export const rememberedReport = (dbId: ID): ID | null => rememberedReports(dbId)[0] ?? null

/**
 * Remember the report page a setup made or took back for `dbId`: the newest of its pages (≤ MIRROR_REPORTS_PER_DB), the
 * database the newest entry (past MIRROR_REPORTS_MAX the one used longest ago goes).
 */
export function rememberReport(dbId: ID, reportId: ID): void {
  if (!okId(dbId) || !okId(reportId)) return
  const key = mirrorReportsKey(scope())
  const all = load(key)
  const before = all.find(([db]) => db === dbId)?.[1] ?? []
  const list: Entry[] = [...all.filter(([db]) => db !== dbId), [dbId, [reportId, ...before.filter((r) => r !== reportId)].slice(0, MIRROR_REPORTS_PER_DB)] as Entry].slice(-MIRROR_REPORTS_MAX)
  memory.set(key, list)
  try {
    window.localStorage.setItem(key, JSON.stringify(Object.fromEntries(list)))
  } catch {
    /* this tab's own copy holds it (load merges it in) */
  }
}
