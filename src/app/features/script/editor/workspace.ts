/**
 * One Script editor — what the editor knows about this workspace (store-backed WsInfo for completion,
 * signature help and docs) and the @ candidates: pages, databases (with their icon and kind), entries,
 * people, agents, scripts — found fuzzily (fuse.js), the most recently edited first.
 */
import Fuse from 'fuse.js'
import { useWorkspace } from '../../../store/store'
import { inTemplate, isEffectivelyTrashed } from '../../../store/selectors'
import type { Database, ID, PageIcon } from '../../../store/types'
import type { DbInfo, WsInfo } from './types'

const ws = () => useWorkspace.getState()

/** A database by id, else by title (the code's db("…") / @Name). */
export function dbByRef(dbId: string | null, dbName: string | null): Database | null {
  const s = ws()
  if (dbId && s.databases[dbId]) return s.databases[dbId]
  if (!dbName) return null
  const n = dbName.trim().toLowerCase()
  return Object.values(s.databases).find((d) => s.pages[d.id]?.title.trim().toLowerCase() === n && !s.pages[d.id]?.trashed) ?? null
}

const infos = new WeakMap<Database, DbInfo>()

function infoOf(db: Database): DbInfo {
  const hit = infos.get(db)
  if (hit) return hit
  const info: DbInfo = {
    id: db.id,
    name: ws().pages[db.id]?.title.trim() || '',
    props: db.properties.map((p) => ({ name: p.name, type: p.type, options: (p.options ?? []).map((o) => o.name), target: p.relationDatabaseId ?? null })),
  }
  infos.set(db, info)
  return info
}

/** The store's workspace for the editor. */
export const workspaceInfo: WsInfo = {
  db: (id, name) => {
    const d = dbByRef(id, name)
    return d ? infoOf(d) : null
  },
  ref: (id) => {
    const s = ws()
    const p = s.pages[id]
    if (!p) return null
    if (p.kind === 'database' && s.databases[id]) return { kind: 'database', dbId: id }
    if (p.databaseId) return { kind: 'row', dbId: p.databaseId }
    return { kind: 'page', dbId: null }
  },
  people: () => ws().people.map((p) => p.name),
  titles: (dbId) =>
    Object.values(ws().pages)
      .filter((p) => p.databaseId === dbId && !p.trashed && p.title.trim())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 40)
      .map((p) => p.title.trim()),
}

/** Every property name of the databases the code names (highlighting). */
export function propNamesOf(refs: Array<{ id: string | null; name: string | null }>): Set<string> {
  return new Set(refs.flatMap((r) => dbByRef(r.id, r.name)?.properties.map((p) => p.name) ?? []))
}

/* ------------------------------------------------------------------ @ candidates */

export interface RefCandidate {
  label: string
  /** 'p' page / database · 'u' person · 'a' agent · 's' script */
  kind: 'p' | 'u' | 'a' | 's'
  id: string
  /** what it is: 'database' | 'page' | 'row' | 'person' | 'agent' | 'script' */
  what: 'database' | 'page' | 'row' | 'person' | 'agent' | 'script'
  icon?: PageIcon | null
  /** a row's database */
  in?: string
}

interface Entry extends RefCandidate {
  at: number
  rank: number
}

let cache: { key: unknown[]; entries: Entry[]; fuse: Fuse<Entry> } | null = null

function entries(selfId: ID | null): { entries: Entry[]; fuse: Fuse<Entry> } {
  const s = ws()
  const key = [s.pages, s.people, s.agents, s.scripts, selfId]
  if (cache && cache.key.every((k, i) => k === key[i])) return cache
  const out: Entry[] = []
  for (const p of Object.values(s.pages)) {
    if (p.trashed || isEffectivelyTrashed(s.pages, p.id) || inTemplate(s.pages, p.id)) continue
    const title = p.title.trim()
    if (!title) continue
    const isDb = p.kind === 'database' && !!s.databases[p.id]
    const what = isDb ? 'database' : p.databaseId ? 'row' : 'page'
    out.push({ label: title, kind: 'p', id: p.id, what, icon: p.icon, in: p.databaseId ? s.pages[p.databaseId]?.title.trim() : undefined, at: p.updatedAt, rank: isDb ? 0 : p.databaseId ? 2 : 1 })
  }
  for (const p of s.people) out.push({ label: p.name, kind: 'u', id: p.id, what: 'person', at: 0, rank: 1 })
  for (const a of Object.values(s.agents ?? {})) out.push({ label: a.name, kind: 'a', id: a.id, what: 'agent', at: 0, rank: 3 })
  for (const sc of Object.values(s.scripts ?? {})) if (sc.id !== selfId) out.push({ label: sc.name, kind: 's', id: sc.id, what: 'script', at: sc.updatedAt ?? 0, rank: 3 })
  const fuse = new Fuse(out, { keys: ['label'], threshold: 0.38, ignoreLocation: true, includeScore: true })
  cache = { key, entries: out, fuse }
  return cache
}

/**
 * The @ candidates for what was typed after "@": fuzzy by title; nothing typed yet = databases and
 * pages, the most recently edited first.
 */
export function refCandidates(query: string, selfId: ID | null, max = 12): RefCandidate[] {
  const q = query.trim()
  const { entries: all, fuse } = entries(selfId)
  const strip = ({ label, kind, id, what, icon, in: inDb }: Entry): RefCandidate => ({ label, kind, id, what, icon, in: inDb })
  if (!q) {
    return [...all]
      .filter((e) => e.kind === 'p' && e.what !== 'row')
      .sort((a, b) => a.rank - b.rank || b.at - a.at)
      .slice(0, max)
      .map(strip)
  }
  const lower = q.toLowerCase()
  return fuse
    .search(q, { limit: 60 })
    .map((r) => {
      const n = r.item.label.toLowerCase()
      // a title that starts with what was typed beats a fuzzy one; then databases, then the most recent
      const head = n.startsWith(lower) ? 0 : n.split(/[\s/–-]+/).some((w) => w.startsWith(lower)) ? 1 : 2
      return { e: r.item, head, score: r.score ?? 1 }
    })
    .sort((a, b) => a.head - b.head || a.e.rank - b.e.rank || a.score - b.score || b.e.at - a.e.at)
    .slice(0, max)
    .map((x) => strip(x.e))
}
