/**
 * "Turn into free board" — the request and the apply.
 *
 *  requestFreeBoard(): one structured request over the selected blocks (the workspace's record types go along
 *  by name so Claude reuses them; no memory; MCP servers only with scope 'all' — client.ts decides).
 *  applyFreeBoard(): a version snapshot, the record types the answer adds (building blocks: saved first so every
 *  database can use them), then ONE store update with the database (title + lane property, the types' fields,
 *  a free board view) and its cards (their type, lane and values; origin 'ai'), then ONE editor transaction that
 *  puts the database block where the first consumed block was — kept blocks stay, lines no card shows stay as
 *  text below it. ⌘Z brings the text back in one step; the toast's Undo also removes the board (and the record
 *  types it added, while no other database holds them).
 */
import type { Editor, JSONContent } from '@tiptap/core'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { DEFAULT_PAGE_SETTINGS, useWorkspace } from '../../../store/store'
import { syncRecordTypeInto } from '../../../store/kit'
import { useUI } from '../../../store/ui'
import { COLOR_NAMES, type ColorName, type Database, type ID, type Kit, type Page, type PropertyDef, type PropertyValue, type RecordTypeProp, type SelectOption, type View } from '../../../store/types'
import { newId } from '../../../lib/ids'
import { t } from '../../../i18n'
import { snapshotNow } from '../../history/snapshots'
import { completeStructured } from '../client'
import { blockGist, readBlocks, type BlockRange } from '../todb/plan'
import { originalToggle, sameBlocks, TodbError } from '../todb/run'
import { parseDateValue, parseNumber } from '../../io/import/csv'
import { freeBoardPrompt, parseFreeBoard, type FreeBoardPlan } from './plan'

/** A free-board result of Transform into … (plain JSON: a run keeps it in the background). */
export interface FreeBoardResult {
  type: 'freeboard'
  board: FreeBoardPlan
  blocks: JSONContent[]
  gists: string[]
  keep: number[]
  left: string[]
}

export async function requestFreeBoard(doc: PMNode, range: BlockRange, opts: { pageTitle?: string; instruction?: string; signal?: AbortSignal }): Promise<FreeBoardResult | null> {
  const source = readBlocks(doc, range)
  if (!source) throw new TodbError('changed')
  const kit = useWorkspace.getState().kit
  const p = freeBoardPrompt(source.blocks, kit, opts)
  const raw = await completeStructured({ system: p.system, prompt: p.prompt, schema: p.schema, maxTokens: 12000, signal: opts.signal })
  const got = parseFreeBoard(raw, source.blocks, kit)
  if (!got) return null
  return {
    type: 'freeboard',
    board: got.plan,
    blocks: source.blocks.map((b) => b.node.toJSON() as JSONContent),
    gists: source.blocks.map((b) => blockGist(b.node)),
    keep: got.keep,
    left: got.left,
  }
}

const LANE_COLORS: ColorName[] = ['gray', 'orange', 'green', 'blue', 'purple', 'yellow', 'pink', 'brown']
const OPTION_COLORS = COLOR_NAMES.filter((c) => c !== 'default')

/** A value as written in the text → the stored value of a property (undefined: none). */
function coerce(def: PropertyDef, raw: string): PropertyValue | undefined {
  const s = raw.trim()
  if (!s) return undefined
  switch (def.type) {
    case 'number':
    case 'rating': {
      const n = parseNumber(s, 'dot') ?? parseNumber(s, 'comma')
      return n ? n.value : undefined
    }
    case 'checkbox':
      return /^(yes|true|ja|x|✓|1|done|erledigt)$/i.test(s)
    case 'date':
      return parseDateValue(s) ?? undefined
    case 'select':
    case 'status':
      return def.options?.find((o) => o.name.toLowerCase() === s.toLowerCase())?.id
    case 'multi_select': {
      const ids = s.split(/\s*,\s*/).map((x) => def.options?.find((o) => o.name.toLowerCase() === x.toLowerCase())?.id).filter((x): x is string => !!x)
      return ids.length ? ids : undefined
    }
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return s
  }
  return undefined
}

/** Save the record types the plan adds (select fields get the values the cards use as options). Returns type ids by plan index. */
function saveNewTypes(plan: FreeBoardPlan): { ids: ID[]; created: ID[] } {
  const ws = useWorkspace.getState()
  const ids: ID[] = []
  const created: ID[] = []
  plan.types.forEach((ft, i) => {
    if (ft.existing && ws.kit?.recordTypes[ft.existing]) return void ids.push(ft.existing)
    const id = newId()
    const properties: RecordTypeProp[] = ft.fields.map((f) => {
      const rp: RecordTypeProp = { id: newId(), name: f.name, type: f.type }
      if (f.type === 'select') {
        const names: string[] = []
        for (const c of plan.cards) {
          const v = c.type === i ? c.values[f.name] : undefined
          if (v && !names.some((n) => n.toLowerCase() === v.toLowerCase())) names.push(v)
        }
        rp.options = names.slice(0, 50).map((name, k): SelectOption => ({ id: newId(), name, color: OPTION_COLORS[k % OPTION_COLORS.length] }))
      }
      return rp
    })
    const now = Date.now()
    useWorkspace.getState().upsertRecordType({ id, name: ft.name, color: ft.color, icon: null, properties, createdAt: now, updatedAt: now })
    ids.push(id)
    created.push(id)
  })
  return { ids, created }
}

/** The database, its page and the cards — built here, written in one store update. */
function buildBoard(plan: FreeBoardPlan, typeIds: ID[], parentId: ID, kit: Kit, pages: Record<ID, Page>): { db: Database; page: Page; rows: Page[] } {
  const dbId = newId()
  const laneOpts: SelectOption[] = plan.lanes.map((name, i) => ({ id: newId(), name, color: LANE_COLORS[i % LANE_COLORS.length] }))
  const titleProp: PropertyDef = { id: newId(), name: t('database.free.titleProp'), type: 'title' }
  const lane: PropertyDef = { id: newId(), name: t('database.free.laneProp'), type: 'select', options: laneOpts }
  const db: Database = { id: dbId, properties: [titleProp, lane], views: [], nextUniqueId: 1, inline: true }
  for (const id of typeIds) {
    const rt = kit.recordTypes[id]
    if (rt && !(db.recordTypes ?? []).includes(id)) syncRecordTypeInto(db, rt, kit, newId)
  }
  const view: View = {
    id: newId(),
    name: t('database.view.free'),
    type: 'board',
    free: true,
    groupBy: lane.id,
    hiddenGroups: [],
    filter: null,
    sorts: [],
    openIn: 'peek',
    visibleProperties: db.properties.filter((p) => p.type !== 'title' && p.id !== lane.id).map((p) => p.id),
  }
  db.views = [view]
  const now = Date.now()
  let order = 0
  for (const p of Object.values(pages)) if (p.parentId === parentId && p.order > order) order = p.order
  const base = (id: ID, title: string, extra: Partial<Page>): Page => ({
    id,
    kind: 'page',
    title,
    icon: null,
    cover: null,
    parentId: dbId,
    databaseId: dbId,
    properties: {},
    content: null,
    contentRev: 0,
    contentOrigin: null,
    favorite: false,
    trashed: false,
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
    order: 0,
    settings: { ...DEFAULT_PAGE_SETTINGS },
    plain: '',
    ...extra,
  })
  const page = base(dbId, plan.title, { kind: 'database', parentId, databaseId: null, order: order + 1 })
  const rows = plan.cards.map((c, i) => {
    const typeId = c.type !== null ? (typeIds[c.type] ?? null) : null
    const properties: Record<ID, PropertyValue> = { [lane.id]: laneOpts[c.lane]?.id ?? laneOpts[0].id }
    if (typeId) {
      for (const [field, raw] of Object.entries(c.values)) {
        const def = db.properties.find((p) => p.fromType?.id === typeId && p.name.toLowerCase() === field.toLowerCase())
        const v = def ? coerce(def, raw) : undefined
        if (def && v !== undefined) properties[def.id] = v
      }
    }
    return base(newId(), c.title, { properties, order: i + 1, ...(typeId ? { recordType: typeId } : {}) })
  })
  return { db, page, rows }
}

/**
 * Put the free board in place of the blocks (`range` null: at the end of the page). Resolves with the database id;
 * throws TodbError ('changed': the blocks were edited meanwhile, 'gone': the page or the editor went away).
 */
export async function applyFreeBoard(editor: Editor, pageId: ID, range: BlockRange | null, res: FreeBoardResult, opts: { original?: string | null } = {}): Promise<ID> {
  if (editor.isDestroyed) throw new TodbError('gone')
  if (range && !sameBlocks(editor.state.doc, range, res.blocks)) throw new TodbError('changed')
  await snapshotNow(pageId, 'ai')
  if (editor.isDestroyed) throw new TodbError('gone')
  const at = range ? sameBlocks(editor.state.doc, range, res.blocks) : null
  if (range && !at) throw new TodbError('changed')
  const ws = useWorkspace.getState()
  if (!ws.pages[pageId] || ws.pages[pageId].trashed) throw new TodbError('gone')
  const dbType = editor.schema.nodes.databaseBlock
  if (!dbType) throw new TodbError('gone')

  const { ids, created } = saveNewTypes(res.board)
  const st = useWorkspace.getState()
  const kit: Kit = st.kit ?? { lists: {}, propTypes: {}, recordTypes: {} }
  const { db, page, rows } = buildBoard(res.board, ids, pageId, kit, st.pages)
  // ONE store update: the database, its page and every card
  useWorkspace.setState((s) => {
    s.pages[page.id] = page
    s.databases[db.id] = db
    for (const r of rows) s.pages[r.id] = r
  })

  const dbNode = dbType.create({ databaseId: db.id, viewId: null })
  const leftNodes = res.left.map((l) => editor.schema.nodes.paragraph.create(null, editor.schema.text(l)))
  const consumed: PMNode[] = []
  let tr = closeHistory(editor.state.tr)
  let dbPos: number
  if (at) {
    const keep = new Set(res.keep)
    const nodes: PMNode[] = []
    at.nodes.forEach((node, i) => {
      if (keep.has(i)) return void nodes.push(node)
      if (!consumed.length) nodes.push(dbNode, ...leftNodes)
      consumed.push(node)
    })
    if (!consumed.length) nodes.push(dbNode, ...leftNodes)
    const original = opts.original && consumed.length ? originalToggle(editor, opts.original, consumed) : null
    if (original) nodes.splice(nodes.indexOf(dbNode) + 1 + leftNodes.length, 0, original)
    const content = Fragment.from(nodes)
    if (!at.parent.canReplace(at.start, at.end, content)) {
      removeBoard(db.id, created)
      throw new TodbError('changed')
    }
    tr = tr.replaceWith(at.from, at.to, content)
    dbPos = at.from
    for (const n of nodes) {
      if (n === dbNode) break
      dbPos += n.nodeSize
    }
  } else {
    dbPos = tr.doc.content.size
    tr = tr.insert(dbPos, Fragment.from([dbNode, ...leftNodes]))
  }
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(dbPos + dbNode.nodeSize, tr.doc.content.size)))).scrollIntoView()
  editor.view.dispatch(tr)
  editor.view.focus()
  const after = editor.state.doc

  useUI.getState().toast({
    message: t('features.ai.freeboard.done', { cards: rows.length, lanes: res.board.lanes.length }),
    kind: 'success',
    action: {
      label: t('common.undo'),
      run: () => {
        if (!editor.isDestroyed && editor.state.doc.eq(after)) editor.commands.undo()
        removeBoard(db.id, created)
      },
    },
  })
  return db.id
}

/** The board gone again — and the record types it added, while no other database holds them. */
function removeBoard(dbId: ID, createdTypes: ID[]): void {
  const ws = useWorkspace.getState()
  if (ws.pages[dbId]) ws.deletePagePermanently(dbId)
  for (const id of createdTypes) {
    const held = Object.values(useWorkspace.getState().databases).some((d) => d.recordTypes?.includes(id))
    if (!held) useWorkspace.getState().deleteRecordType(id)
  }
}
