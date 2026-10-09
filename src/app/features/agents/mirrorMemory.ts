/**
 * Custom agents — what this device's mirror setups made, per workspace: the report page each setup made for a
 * database (`{ [dbId]: reportId }`, the one made or taken back last at the end, ≤ 100 — the oldest go first). "Use …"
 * (mirror.ts reuseMirror) takes that page back instead of making another one of the same title — never a page found
 * by its title.
 *
 * localStorage `one.mirror.reports:<kind>:<id>` (local:local / cloud:<id>): per device, never synced, never in a backup
 * or export; wiped with a team workspace's copy (cloud/device.ts) and by the local reset (shell/lib/reset.ts). Every
 * read is checked (ids only) and survives blocked storage (the tab's own copy then).
 */
import { activeWorkspace } from '../../cloud'
import type { ID } from '../../store/types'

export const MIRROR_REPORTS_MAX = 100
export const mirrorReportsKey = (scope: string) => `one.mirror.reports:${scope}`

const SAFE_ID = /^[\w-]{1,64}$/
const RESERVED = new Set(['__proto__', 'constructor', 'prototype'])
const okId = (v: unknown): v is ID => typeof v === 'string' && SAFE_ID.test(v) && !RESERVED.has(v)

/** Without storage: this tab's memory per workspace. */
const memory = new Map<string, Array<[ID, ID]>>()

const scope = () => {
  const ws = activeWorkspace()
  return `${ws.kind}:${ws.id}`
}

/** The pairs in the order they were remembered (oldest first). */
function load(key: string): Array<[ID, ID]> {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw !== null) {
      const v: unknown = JSON.parse(raw)
      if (!v || typeof v !== 'object' || Array.isArray(v)) return []
      const out: Array<[ID, ID]> = []
      for (const [db, report] of Object.entries(v as Record<string, unknown>)) if (okId(db) && okId(report)) out.push([db, report])
      return out.slice(-MIRROR_REPORTS_MAX)
    }
  } catch {
    /* blocked storage or junk: the tab's own copy */
  }
  return memory.get(key) ?? []
}

/** The report page this device's setup made for `dbId` last (null: none remembered). Not checked against the pages. */
export function rememberedReport(dbId: ID): ID | null {
  return load(mirrorReportsKey(scope())).find(([db]) => db === dbId)?.[1] ?? null
}

/** Remember the report page a setup made for `dbId` (the newest entry; past MIRROR_REPORTS_MAX the oldest go). */
export function rememberReport(dbId: ID, reportId: ID): void {
  if (!okId(dbId) || !okId(reportId)) return
  const key = mirrorReportsKey(scope())
  const list = [...load(key).filter(([db]) => db !== dbId), [dbId, reportId] as [ID, ID]].slice(-MIRROR_REPORTS_MAX)
  memory.set(key, list)
  try {
    window.localStorage.setItem(key, JSON.stringify(Object.fromEntries(list)))
  } catch {
    /* this tab only */
  }
}
