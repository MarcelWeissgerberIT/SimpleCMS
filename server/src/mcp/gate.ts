/**
 * The team server's write gate (Weg 4 D4) — the local bridge's (src/app/features/mcp/gate.ts) on the meta document, the
 * same rule and words (src/shared/mcp/targets.ts): before each MCP write, tools.ts names what the call touches
 * (`targetsOf`, from its arguments) and `assertWritable` refuses a template's page, one in the trash, One's own
 * databases, a locked page's text or a locked database's schema — nothing is written. The tools' own checks inside their
 * write transactions stay as the backstop (they also see what changed between this read and the write). Context marks and
 * Private are the tab's: a team server sees neither (its MCP reaches only the workspace's shared pages).
 */
import * as Y from 'yjs'
import { ApiError } from '../errors.ts'
import { databaseMap, inTemplate, inTrash, pageMap, readProperties, type Roots } from '../api/meta.ts'
import { findProperty, type WorkspaceModel } from '../api/model.ts'
import { mergeTargets, noTargets, targetProblem, type TargetWorld, type WriteTargets } from '../../../src/shared/mcp/targets.ts'
import { codeOf } from '../../../src/shared/mcp/errors.ts'
import type { McpToolName } from '../../../src/shared/mcp/contract.ts'
import { systemBelow, systemOf, systemRefusal } from './system.ts'
import { rollupsOn } from './structure.ts'

type Args = Record<string, unknown>

const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(s).filter((x): x is string => !!x) : [])
/** The `id` / `ids` of a call. */
const idsOf = (a: Args): string[] => [...new Set([...(s(a.id) ? [s(a.id)!] : []), ...list(a.ids)])]
/** A parent a call names: an id of the workspace (never "$<n>", an earlier page of the same batch). */
const parent = (v: unknown): string[] => {
  const id = s(v)
  return id && !id.startsWith('$') ? [id] : []
}
/** The argument each id of `id` / `ids` came from. */
const idPaths = (a: Args, ids: string[]): Record<string, string> => (Array.isArray(a.ids) ? Object.fromEntries(ids.map((id, i) => [id, `ids[${i}]`])) : Object.fromEntries(ids.map((id) => [id, 'id'])))
const databaseOfRow = (r: Roots, id: string): string | null => s(pageMap(r, id)?.get('databaseId'))

/** What a write call touches, from its arguments (the ids it names; new things have none yet). */
export function targetsOf(tool: McpToolName, a: Args, r: Roots): WriteTargets {
  switch (tool) {
    case 'one_create_page': {
      const pages = Array.isArray(a.pages) ? (a.pages as Args[]) : []
      const link = a.linkInParent !== undefined && a.linkInParent !== 'none'
      const paths: Record<string, string> = {}
      for (const id of parent(a.parentId)) paths[id] = 'parentId'
      pages.forEach((p, i) => parent(p?.parentId).forEach((id) => (paths[id] ??= `pages[${i}].parentId`)))
      const parents = Object.keys(paths)
      if (link) for (const id of parents) paths[id] = 'linkInParent'
      return { ...noTargets(), places: parents, content: link ? parents : [], paths }
    }
    case 'one_update_page': {
      const id = s(a.id)
      if (!id) return noTargets()
      const meta = a.title !== undefined || a.icon !== undefined
      const db = databaseOfRow(r, id)
      return mergeTargets(
        { content: a.markdown !== undefined ? [id] : [], paths: { [id]: a.markdown !== undefined ? 'markdown' : 'id' } },
        meta ? (db && a.title !== undefined ? { rows: [{ db, ids: [id] }], places: a.icon !== undefined ? [id] : [] } : { places: [id] }) : null,
      )
    }
    case 'one_create_row':
    case 'one_upsert_rows': {
      const db = s(a.databaseId)
      const n = Array.isArray(a.rows) ? a.rows.length : 1
      return db ? { ...noTargets(), rows: [{ db, ids: [], made: n }], paths: { [db]: 'databaseId' } } : noTargets()
    }
    case 'one_update_row': {
      const batch = Array.isArray(a.rows)
      const ids = batch ? list((a.rows as Args[]).map((x) => x?.id)) : idsOf(a)
      const byDb = new Map<string, string[]>()
      const places: string[] = []
      const paths = Object.fromEntries(ids.map((id, i) => [id, batch ? `rows[${i}].id` : 'id']))
      for (const id of ids) {
        const db = databaseOfRow(r, id)
        if (db) byDb.set(db, [...(byDb.get(db) ?? []), id])
        else places.push(id)
      }
      return { ...noTargets(), places, rows: [...byDb].map(([db, rows]) => ({ db, ids: rows })), paths }
    }
    case 'one_create_property':
    case 'one_update_property':
    case 'one_create_view':
    case 'one_update_view':
    case 'one_delete_view': {
      const db = s(a.databaseId)
      return db ? { ...noTargets(), schema: [db], paths: { [db]: 'databaseId' } } : noTargets()
    }
    case 'one_delete_property': {
      const db = s(a.databaseId)
      if (!db) return noTargets()
      // the databases whose rollups the delete clears (their schema changes too)
      const ydb = databaseMap(r, db)
      const prop = ydb && s(a.property) ? findProperty(readProperties(ydb), s(a.property)!) : undefined
      const rolls = prop ? rollupsOn(r, db, prop.id).filter((x) => x.dbId !== db) : []
      return {
        ...noTargets(),
        schema: [db, ...rolls.map((x) => x.dbId)],
        paths: { [db]: 'databaseId', ...Object.fromEntries(rolls.map((x) => [x.dbId, 'property'])) },
        why: Object.fromEntries(rolls.map((x) => [x.dbId, `its rollup ${JSON.stringify(x.name)} rolls up ${JSON.stringify(prop!.name)}, and the delete would clear it`])),
      }
    }
    case 'one_create_database': {
      const inline = a.inline && typeof a.inline === 'object' ? s((a.inline as Args).pageId) : null
      const where = inline ? [inline] : parent(a.parentId)
      return { ...noTargets(), places: where, content: inline ? [inline] : [], paths: Object.fromEntries(where.map((id) => [id, inline ? 'inline.pageId' : 'parentId'])) }
    }
    case 'one_update_database': {
      const id = s(a.id)
      return id ? { ...noTargets(), places: [id], paths: { [id]: 'id' } } : noTargets()
    }
    case 'one_move_page': {
      const id = s(a.id)
      if (!id) return noTargets()
      const to = a.parentId === null ? null : s(a.parentId)
      return { ...noTargets(), places: [id, ...(to ? [to] : [])], moves: a.parentId === undefined ? [] : [{ id, to }], paths: { [id]: 'id', ...(to ? { [to]: 'parentId' } : {}) } }
    }
    case 'one_move_row': {
      const id = s(a.id)
      const to = s(a.databaseId)
      if (!id || !to) return noTargets()
      const from = databaseOfRow(r, id)
      return { ...noTargets(), places: [id], rows: [...(from ? [{ db: from, ids: [id] }] : []), { db: to, ids: [], made: 1 }], paths: { [id]: 'id', [to]: 'databaseId' } }
    }
    case 'one_trash_page': {
      const ids = idsOf(a)
      return { ...noTargets(), places: ids, trees: ids, paths: idPaths(a, ids) }
    }
    case 'one_restore_page': {
      const ids = idsOf(a)
      return { ...noTargets(), restores: ids, paths: idPaths(a, ids) }
    }
    default:
      return noTargets()
  }
}

/** The meta document as the gate reads it. */
function world(r: Roots): TargetWorld {
  const yp = (id: string) => pageMap(r, id)
  return {
    exists: (id) => !!yp(id),
    inTemplate: (id) => inTemplate(r, id),
    inTrash: (id) => inTrash(r, id),
    title: (id) => String(yp(id)?.get('title') ?? '').trim() || 'Untitled',
    system: (id, path, why) => {
      const hit = systemOf(r, id)
      return hit ? systemRefusal(hit, path, why).message : null
    },
    systemBelow: (id, path) => {
      const hit = systemBelow(r, id)
      return hit ? systemRefusal(hit, path).message : null
    },
    pageLocked: (id) => {
      const settings = yp(id)?.get('settings')
      const locked = settings instanceof Y.Map ? settings.get('locked') : (settings as { locked?: unknown } | undefined)?.locked
      return locked === true
    },
    databaseLocked: (id) => databaseMap(r, id)?.get('locked') === true,
    isPrivate: () => false,
    marked: () => false,
  }
}

const STATUS: Record<string, 404 | 422 | 403> = { not_found: 404, rejected: 403 }

/** Refuse the call before it writes when One does not let an agent write what it touches (an ApiError in the contract's words). */
export async function assertWritable(model: WorkspaceModel, wsId: string, tool: McpToolName, a: Args): Promise<void> {
  const why = await model.read(wsId, (r) => targetProblem(targetsOf(tool, a, r), world(r), 'plan'))
  if (!why) return
  const code = codeOf(why) ?? 'bad_argument'
  throw new ApiError(STATUS[code] ?? 422, code, why)
}
