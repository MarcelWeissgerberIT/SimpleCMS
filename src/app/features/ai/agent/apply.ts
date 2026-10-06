/**
 * Workspace agent — apply staged changes through the store (content origin 'ai') and undo a
 * whole batch. Undo is careful: content the user edited after applying is left alone.
 * Edits of existing content (kind 'edit', edit.ts) are applied per page, all of a batch in one
 * transaction after a version is kept. Property writes run inside aiWrite (features/history): the
 * row's state right before them is kept as an "AI" version.
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../../store/store'
import { isEffectivelyTrashed } from '../../../store/selectors'
import { COLOR_NAMES, type DateValue, type ID, type PropertyDef, type PropertyValue, type SelectOption, type View } from '../../../store/types'
import { defaultView } from '../../../store/store'
import { claudeDoc } from '../claudeDoc'
import { webImagesOf } from '../../agents/images'
import { newId } from '../../../lib/ids'
import { aiWrite, snapshotNow } from '../../history/snapshots'
import { t } from '../../../i18n'
import { depsOf, type ColumnSpec, type PropChange, type StagedChange } from './types'
import { saveMemory, updateMemory } from '../memory/save'
import { applyPageEdits } from './edit'
import { livePage, withPageNodes, type LinkTarget } from './links'

const ws = () => useWorkspace.getState()
const ORIGIN = 'ai'

function alive(id: ID | null | undefined): boolean {
  if (!id) return false
  const { pages } = ws()
  return !!pages[id] && !pages[id].trashed && !isEffectivelyTrashed(pages, id)
}

function isEmptyDoc(doc: JSONContent | null | undefined): boolean {
  const blocks = doc?.content ?? []
  return blocks.every((b) => b.type === 'paragraph' && !(b.content ?? []).length)
}

/**
 * Markdown Claude wrote → a doc: nothing in it loads by itself (claudeDoc; addresses in `keep` stay), its
 * `[Title](#/p/<id>)` links as page mentions / page link blocks (links.ts).
 */
type ToDoc = (markdown: string, keep?: ReadonlySet<string>) => JSONContent

/** Claude's Markdown as blocks; `page`'s own images may stay. */
function blocksOf(markdown: string, toDoc: ToDoc, page?: JSONContent | null): JSONContent[] {
  return (toDoc(markdown, page ? webImagesOf(page) : undefined).content ?? []).filter(Boolean)
}

/** The pages links may point at while a batch is applied: live pages, pages and databases staged in it, rows created from staged rows. */
function linkTargets(all: StagedChange[], resolveRow: (id: ID) => ID, rowIds: Record<string, ID>): (id: ID) => LinkTarget | null {
  // pages and databases keep their staged id; rows get theirs on apply (rowIds)
  const staged = new Map(all.filter((c) => (c.kind === 'create_page' || c.kind === 'create_database') && c.status !== 'discarded').map((c) => [c.pageId, c.title ?? '']))
  return (id) => {
    const real = rowIds[id] ?? resolveRow(id)
    return livePage(real) ?? (real === id && staged.has(id) ? { id, title: staged.get(id)! } : null)
  }
}

/** Option names → ids; missing names become new options (select / multi_select). */
function resolveOptions(dbId: ID, prop: PropertyDef, names: string[], created: Map<ID, ID[]>): string[] {
  const live = ws().databases[dbId]?.properties.find((p) => p.id === prop.id) ?? prop
  const opts: SelectOption[] = [...(live.options ?? [])]
  const ids: string[] = []
  const fresh: SelectOption[] = []
  const palette = COLOR_NAMES.filter((c) => c !== 'default')
  for (const name of names) {
    const hit = opts.find((o) => o.name.toLowerCase() === name.toLowerCase())
    if (hit) {
      ids.push(hit.id)
      continue
    }
    if (live.type === 'status') throw new Error(`unknown status "${name}"`)
    // locked since it was staged: the options stay as they are
    if (ws().databases[dbId]?.locked) throw new Error(`the database is locked — no new option "${name}"`)
    const opt: SelectOption = { id: newId(), name, color: palette[(opts.length + fresh.length) % palette.length] }
    opts.push(opt)
    fresh.push(opt)
    ids.push(opt.id)
  }
  if (fresh.length) {
    ws().updateProperty(dbId, prop.id, { options: opts })
    created.set(prop.id, [...(created.get(prop.id) ?? []), ...fresh.map((o) => o.id)])
  }
  return ids
}

const isDate = (v: unknown): v is DateValue => !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as DateValue).start === 'string'

/** A moved date keeps the reminder set on it (like the date editor: it rides along date changes). */
function keepReminder(prev: PropertyValue | undefined, next: PropertyValue): PropertyValue {
  return isDate(prev) && prev.reminder && isDate(next) && !next.reminder ? { ...next, reminder: prev.reminder } : next
}

function resolveValue(dbId: ID, pc: PropChange, created: Map<ID, ID[]>): PropertyValue {
  const prop = ws().databases[dbId]?.properties.find((p) => p.id === pc.propId)
  if (!prop) throw new Error(`property "${pc.name}" no longer exists`)
  if (pc.intent.kind === 'value') return pc.intent.value
  const ids = resolveOptions(dbId, prop, pc.intent.names, created)
  return prop.type === 'multi_select' ? ids : (ids[0] ?? null)
}

/** Remove options this batch created if no row uses them any more. */
function dropUnusedOptions(dbId: ID, created: Map<ID, ID[]>) {
  for (const [propId, optIds] of created) {
    const db = ws().databases[dbId]
    const prop = db?.properties.find((p) => p.id === propId)
    if (!prop?.options) continue
    const used = new Set<string>()
    for (const r of Object.values(ws().pages)) {
      if (r.databaseId !== dbId) continue
      const v = r.properties[propId]
      if (typeof v === 'string') used.add(v)
      else if (Array.isArray(v)) v.forEach((x) => used.add(x))
    }
    const drop = optIds.filter((id) => !used.has(id))
    if (drop.length) ws().updateProperty(dbId, propId, { options: prop.options.filter((o) => !drop.includes(o.id)) })
  }
}

export interface ApplyResult {
  /** changes written (ids) */
  applied: string[]
  failed: Array<{ id: string; error: string }>
  /** staged row id → real row id, for rows created in this batch */
  rowIds: Record<string, ID>
  /** revert the batch; returns how many changes were kept because they were edited meanwhile */
  undo: () => number
}

/** Apply order: pages → databases → properties → everything else (rows), each in review order. */
const RANK: Partial<Record<StagedChange['kind'], number>> = { create_page: 0, create_database: 1, add_property: 2 }
const rank = (c: StagedChange) => RANK[c.kind] ?? 3

/**
 * Apply pending changes: pages, then databases, then properties, then rows and the rest, each in
 * review order. A change whose staged parent (or database, or property) is not applied — in this
 * batch or before — fails instead of landing somewhere unexpected.
 */
export async function applyChanges(changes: StagedChange[], all: StagedChange[], resolveRow: (id: ID) => ID): Promise<ApplyResult> {
  const applied: string[] = []
  const failed: ApplyResult['failed'] = []
  const rowIds: Record<string, ID> = {}
  const undos: Array<() => boolean> = []
  const done = new Set(all.filter((c) => c.status === 'applied').map((c) => c.id))
  const ordered = [...changes].filter((c) => c.status === 'pending' || c.status === 'failed').sort((a, b) => rank(a) - rank(b) || a.n - b.n)
  const targets = linkTargets(all, resolveRow, rowIds)
  const toDoc: ToDoc = (markdown, keep) => withPageNodes(claudeDoc(markdown, keep), targets)

  const editedPages = new Set<ID>()
  for (const c of ordered) {
    // edits of existing content: every edit of this page in the batch, in one transaction
    if (c.kind === 'edit') {
      const pageId = resolveRow(c.pageId)
      if (editedPages.has(pageId)) continue
      editedPages.add(pageId)
      const group = ordered.filter((x) => x.kind === 'edit' && resolveRow(x.pageId) === pageId)
      const res = await applyPageEdits(pageId, group)
      if (res.applied.length) undos.push(res.undo)
      applied.push(...res.applied)
      res.applied.forEach((id) => done.add(id))
      failed.push(...res.failed)
      continue
    }
    try {
      const missing = depsOf(c).find((id) => !done.has(id))
      if (missing) {
        const parent = all.find((x) => x.id === missing)
        throw new Error(`needs change #${parent?.n ?? '?'} first`)
      }
      undos.push(await applyOne(c, resolveRow, rowIds, toDoc))
      applied.push(c.id)
      done.add(c.id)
    } catch (e) {
      failed.push({ id: c.id, error: e instanceof Error ? e.message : String(e) })
    }
  }

  const undo = () => {
    let kept = 0
    for (let i = undos.length - 1; i >= 0; i--) if (!undos[i]()) kept += 1
    return kept
  }
  return { applied, failed, rowIds, undo }
}

/**
 * Undo of a created page / row: deleted for good while untouched; once someone edited it or
 * put pages under it, it goes to the trash instead (recoverable).
 */
function removeCreated(id: ID): () => boolean {
  const rev = ws().pages[id]?.contentRev
  const title = ws().pages[id]?.title
  return () => {
    const now = ws().pages[id]
    if (!now) return true
    const touched = now.contentRev !== rev || now.title !== title || Object.values(ws().pages).some((p) => p.parentId === id)
    if (touched) ws().trashPage(id)
    else ws().deletePagePermanently(id)
    return true
  }
}

const PALETTE = COLOR_NAMES.filter((c) => c !== 'default')

/** A staged column as a property definition (options get ids and colours). */
function columnDef(col: ColumnSpec): PropertyDef {
  const def: PropertyDef = { id: col.id, name: col.name, type: col.type }
  if (col.type === 'select' || col.type === 'multi_select') def.options = (col.options ?? []).map((name, i): SelectOption => ({ id: newId(), name, color: PALETTE[i % PALETTE.length] }))
  return def
}

/** The views of a staged database: a table (grouped when asked), a board first when it is the view. */
function viewsOf(c: StagedChange, properties: PropertyDef[]): View[] {
  const table = defaultView('table', { properties }, t('features.agent.view.table'))
  const group = c.groupBy && properties.some((p) => p.id === c.groupBy) ? c.groupBy : null
  if (c.view !== 'board' || !group) {
    if (group) table.groupBy = group
    return [table]
  }
  const board = defaultView('board', { properties }, t('features.agent.view.board'))
  board.groupBy = group
  return [board, table]
}

/** Write one change. Returns its undo (false = left alone because it was edited since). */
async function applyOne(c: StagedChange, resolveRow: (id: ID) => ID, rowIds: Record<string, ID>, toDoc: ToDoc): Promise<() => boolean> {
  const s = ws()
  switch (c.kind) {
    case 'create_page': {
      if (c.parentId && !alive(c.parentId)) throw new Error('the parent page is gone')
      if (s.pages[c.pageId]) throw new Error('already exists')
      const id = s.createPage({ id: c.pageId, parentId: c.parentId ?? null, title: c.title ?? '' })
      if (c.markdown?.trim()) ws().setContent(id, toDoc(c.markdown), ORIGIN)
      return removeCreated(id)
    }
    case 'create_row': {
      const dbId = c.databaseId!
      if (!alive(dbId) || !s.databases[dbId]) throw new Error('the database is gone')
      const created = new Map<ID, ID[]>()
      const properties: Record<ID, PropertyValue> = {}
      for (const pc of c.props ?? []) properties[pc.propId] = resolveValue(dbId, pc, created)
      const id = ws().createRow(dbId, { title: c.title ?? '', properties })
      if (c.markdown?.trim()) ws().setContent(id, toDoc(c.markdown), ORIGIN)
      rowIds[c.pageId] = id
      const remove = removeCreated(id)
      return () => {
        const ok = remove()
        dropUnusedOptions(dbId, created)
        return ok
      }
    }
    case 'update_row': {
      const id = resolveRow(c.pageId)
      const row = s.pages[id]
      if (!alive(id) || !row?.databaseId) throw new Error('the row is gone')
      const dbId = row.databaseId
      const created = new Map<ID, ID[]>()
      const prev: Record<ID, PropertyValue | undefined> = {}
      const next: Record<ID, PropertyValue> = {}
      for (const pc of c.props ?? []) {
        prev[pc.propId] = row.properties[pc.propId]
        next[pc.propId] = keepReminder(prev[pc.propId], resolveValue(dbId, pc, created))
      }
      // the row as it was is kept as an "AI" version first (features/history)
      aiWrite(() => {
        for (const [propId, v] of Object.entries(next)) ws().setRowProperty(id, propId, v)
      })
      return () => {
        const now = ws().pages[id]
        if (!now) return false
        let kept = false
        for (const [propId, v] of Object.entries(next)) {
          // only revert values nobody changed after the apply
          if (JSON.stringify(now.properties[propId] ?? null) !== JSON.stringify(v)) {
            kept = true
            continue
          }
          ws().setRowProperty(id, propId, (prev[propId] ?? null) as PropertyValue)
        }
        dropUnusedOptions(dbId, created)
        return !kept
      }
    }
    case 'edit':
      // applied per page, together (applyPageEdits in applyChanges)
      throw new Error('an edit is applied with its page')
    case 'append': {
      const id = resolveRow(c.pageId)
      if (!alive(id)) throw new Error('the page is gone')
      await snapshotNow(id, 'ai')
      const page = ws().pages[id]
      if (!page) throw new Error('the page is gone')
      const prev = page.content
      const add = blocksOf(c.markdown ?? '', toDoc, prev)
      const next: JSONContent = { type: 'doc', content: isEmptyDoc(prev) ? add : [...(prev?.content ?? []), ...add] }
      ws().setContent(id, next, ORIGIN)
      const rev = ws().pages[id]?.contentRev
      return () => {
        const now = ws().pages[id]
        if (!now || now.contentRev !== rev) return false
        ws().setContent(id, prev, ORIGIN)
        return true
      }
    }
    case 'create_database': {
      if (c.parentId && !alive(c.parentId)) throw new Error('the parent page is gone')
      if (s.pages[c.pageId]) throw new Error('already exists')
      const properties: PropertyDef[] = [{ id: c.titlePropId ?? newId(), name: 'Name', type: 'title' }, ...(c.columns ?? []).map(columnDef)]
      const id = s.createDatabase({ id: c.pageId, parentId: c.parentId ?? null, title: c.title ?? '', properties, views: viewsOf(c, properties) })
      return removeCreated(id)
    }
    case 'add_property': {
      const dbId = c.databaseId!
      const db = s.databases[dbId]
      const prop = c.prop!
      if (!alive(dbId) || !db) throw new Error('the database is gone')
      // locked since it was staged: the schema stays as it is (database/model/lock.ts)
      if (db.locked) throw new Error('the database is locked')
      if (db.properties.some((p) => p.id === prop.id)) throw new Error('already exists')
      if (db.properties.some((p) => p.name.trim().toLowerCase() === prop.name.toLowerCase())) throw new Error(`there is already a property "${prop.name}"`)
      s.addProperty(dbId, columnDef(prop))
      return () => {
        const now = ws().databases[dbId]
        if (!now?.properties.some((p) => p.id === prop.id)) return true
        // values set since (by hand) keep the property
        const used = Object.values(ws().pages).some((r) => {
          if (r.databaseId !== dbId) return false
          const v = r.properties[prop.id]
          return v !== undefined && v !== null && v !== '' && v !== false && !(Array.isArray(v) && !v.length)
        })
        if (used) return false
        ws().deleteProperty(dbId, prop.id)
        return true
      }
    }
    case 'memory': {
      // the One memory (features/ai/memory): a new row, or the near-identical memory it updates
      const m = c.memory
      if (!m) throw new Error('nothing to remember')
      if (m.updates && alive(m.updates)) {
        const undo = aiWrite(() => updateMemory(m.updates!, m))
        return () => {
          undo()
          return true
        }
      }
      let saved: ReturnType<typeof saveMemory>
      try {
        saved = saveMemory(m)
      } catch {
        throw new Error('the memory cannot be written here')
      }
      rowIds[c.pageId] = saved.id
      return () => {
        saved.undo()
        return true
      }
    }
    case 'script': {
      // One Script (write_script): saved — never run by applying; Undo puts the old version back (or removes a new one)
      const sc = c.script
      if (!sc) throw new Error('no script')
      const { saveScript } = await import('../../script')
      const prev = ws().scripts?.[sc.id] ?? null
      if (sc.before && !prev) throw new Error('the script was deleted')
      const now = Date.now()
      const next = { ...(prev ?? {}), id: sc.id, name: sc.name, kind: sc.kind, code: sc.code, ...(sc.description ? { description: sc.description } : {}), createdAt: prev?.createdAt ?? now, updatedAt: now }
      if (!saveScript(next)) throw new Error('scripts cannot be changed here')
      return () => {
        const cur = ws().scripts?.[sc.id]
        // changed by hand since: kept
        if (!cur || cur.code !== sc.code || cur.name !== sc.name) return false
        if (prev) saveScript(prev)
        else ws().deleteScript(sc.id)
        return true
      }
    }
    case 'rename': {
      const id = resolveRow(c.pageId)
      if (!alive(id)) throw new Error('the page is gone')
      const prev = s.pages[id].title
      const title = c.title ?? prev
      aiWrite(() => ws().updatePage(id, { title }))
      return () => {
        const now = ws().pages[id]
        if (!now || now.title !== title) return false
        ws().updatePage(id, { title: prev })
        return true
      }
    }
  }
}
