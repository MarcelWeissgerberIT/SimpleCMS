/**
 * "Turn into database" — the pure part: which blocks a selection covers, what Claude gets and must
 * answer (structured output), and how the answer becomes properties, options and row values.
 *
 *  - findBlockRange(doc, from, to): the selection expanded to whole blocks of the container it sits in
 *    (a list or a table goes as a whole), or null where no database block may go (inside a list item, a
 *    table cell, a quote …), or for a selection inside one line.
 *  - readBlocks(doc, range): those blocks, numbered for the prompt ([B1] …) — mapped positions are
 *    re-checked, so a range that no longer sits between blocks is refused.
 *  - buildTodbPrompt / TODB_SCHEMA / parseTodbAnswer: the request and its validated answer.
 *  - buildDatabase(plan, draft): property definitions (options with colours), views and row values.
 */
import type { Node as PMNode, NodeType } from '@tiptap/pm/model'
import type { JSONContent } from '@tiptap/core'
import { COLOR_NAMES, type ColorName, type ID, type NumberFormat, type PropertyDef, type PropertyValue, type SelectOption, type View } from '../../../store/types'
import { defaultView } from '../../../store/store'
import { newId } from '../../../lib/ids'
import { toMarkdown } from '../../share/markdown'
import { parseDateValue, parseNumber, splitList } from '../../io/import/csv'

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

export const TODB_MAX_ENTRIES = 500
export const TODB_MAX_COLUMNS = 20
/** Characters of block Markdown sent at most (like the other AI-menu actions). */
export const TODB_MAX_INPUT = 60_000

/* ------------------------------------------------------------------ */
/* The blocks a selection covers                                       */
/* ------------------------------------------------------------------ */

/** Whole lists and tables go along when the selection is inside them (their items / rows are not containers). */
const WRAPPERS = new Set(['bulletList', 'orderedList', 'taskList', 'table', 'tableRow'])
/** A selection inside one of these offers nothing — and no database block goes below them. */
const INSIDE = new Set(['listItem', 'taskItem', 'tableCell', 'tableHeader', 'blockquote', 'detailsSummary', 'codeBlock'])
/** Blocks Claude may turn into rows. Anything else in the range (a callout, an image …) stays as it is. */
const CONSUMABLE = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'table', 'blockquote', 'horizontalRule'])
/** Nodes that must never disappear with a consumed block (files, embeds, sub-page links, live blocks …). */
const PRECIOUS = new Set([
  'image',
  'video',
  'audio',
  'fileBlock',
  'databaseBlock',
  'pageLink',
  'embed',
  'bookmark',
  'chart',
  'spreadsheet',
  'mermaid',
  'blockMath',
  'syncedBlock',
  'meetingNotes',
  'button',
  'tabs',
  'columns',
])

/** Positions just before the first and just after the last block of the range (between blocks). */
export interface BlockRange {
  from: number
  to: number
}

/** The selection as whole blocks where a database block may replace them; null = the action is not offered. */
export function findBlockRange(doc: PMNode, from: number, to: number, dbType: NodeType | undefined): BlockRange | null {
  if (!dbType || from >= to) return null
  const $from = doc.resolve(from)
  const $to = doc.resolve(to)
  // inside one line: the other actions edit text, there are no blocks to turn into rows
  if ($from.sameParent($to) && $from.parent.isTextblock) return null
  const base = $from.blockRange($to)
  if (!base) return null
  let depth = base.depth
  let start = base.startIndex
  let end = base.endIndex
  // a range that only touches the very end of its first block / the very start of its last one leaves them out
  const parent0 = $from.node(depth)
  if (end - start > 1 && !doc.textBetween(from, $from.posAtIndex(start + 1, depth), ' ', ' ').trim() && from > $from.posAtIndex(start, depth)) start++
  if (end - start > 1) {
    const lastStart = $from.posAtIndex(end - 1, depth)
    if (to <= lastStart + 1 || !doc.textBetween(lastStart, to, ' ', ' ').trim()) {
      if (to < lastStart + parent0.child(end - 1).nodeSize) end--
    }
  }
  // inside a list or a table: the whole list / table is the block
  while (depth >= 0) {
    const name = $from.node(depth).type.name
    if (INSIDE.has(name)) return null
    if (!WRAPPERS.has(name)) break
    if (depth === 0) return null
    start = $from.index(depth - 1)
    end = start + 1
    depth--
  }
  for (let d = depth - 1; d >= 0; d--) if (INSIDE.has($from.node(d).type.name)) return null
  const parent = $from.node(depth)
  if (parent.inlineContent || !parent.canReplaceWith(start, end, dbType)) return null
  let consumable = false
  for (let i = start; i < end; i++) if (isConsumable(parent.child(i))) consumable = true
  if (!consumable) return null
  return { from: $from.posAtIndex(start, depth), to: $from.posAtIndex(end, depth) }
}

function isConsumable(node: PMNode): boolean {
  if (!CONSUMABLE.has(node.type.name)) return false
  let precious = false
  node.descendants((n) => {
    if (precious) return false
    if (PRECIOUS.has(n.type.name)) precious = true
    return !precious
  })
  return !precious
}

/** One block of the range as Claude sees it. */
export interface SourceBlock {
  node: PMNode
  markdown: string
  /** stays on the page whatever Claude says: not text, holds a file / embed / link, or cut off for length */
  fixed: boolean
}

export interface ResolvedBlocks {
  from: number
  to: number
  /** the container node and the child indexes [start, end) of the range */
  parent: PMNode
  start: number
  end: number
  blocks: SourceBlock[]
}

export interface RangeNodes {
  from: number
  to: number
  /** the container node and the child indexes [start, end) of the range */
  parent: PMNode
  start: number
  end: number
  nodes: PMNode[]
}

/** The block nodes of a (mapped) range — null when it no longer sits between the blocks of one container. */
export function rangeNodes(doc: PMNode, range: BlockRange): RangeNodes | null {
  if (range.from < 0 || range.to > doc.content.size || range.from >= range.to) return null
  const $a = doc.resolve(range.from)
  const $b = doc.resolve(range.to)
  if (!$a.sameParent($b) || $a.parent.inlineContent) return null
  const start = $a.index()
  const end = $b.index()
  if (start >= end || $a.posAtIndex(start) !== range.from || $b.posAtIndex(end) !== range.to) return null
  const nodes: PMNode[] = []
  for (let i = start; i < end; i++) nodes.push($a.parent.child(i))
  return { from: range.from, to: range.to, parent: $a.parent, start, end, nodes }
}

/** The blocks of a (mapped) range, numbered for the prompt — null when the range is no longer one. */
export function readBlocks(doc: PMNode, range: BlockRange): ResolvedBlocks | null {
  const at = rangeNodes(doc, range)
  if (!at) return null
  const { parent, start, end } = at
  const blocks: SourceBlock[] = []
  let budget = TODB_MAX_INPUT
  for (let i = start; i < end; i++) {
    const node = parent.child(i)
    let markdown = blockMarkdown(node)
    let fixed = !isConsumable(node)
    if (budget <= 0) {
      // not sent at all: it stays where it is
      markdown = ''
      fixed = true
    } else if (markdown.length > budget) {
      markdown = `${markdown.slice(0, budget)}\n[…]`
      fixed = true
    }
    budget -= markdown.length
    blocks.push({ node, markdown, fixed })
  }
  return { from: range.from, to: range.to, parent, start, end, blocks }
}

function blockMarkdown(node: PMNode): string {
  try {
    const md = toMarkdown({ type: 'doc', content: [node.toJSON() as JSONContent] }).trim()
    if (md) return md
  } catch {
    /* fall through */
  }
  return node.textContent.trim()
}

/** First words of a block (the preview's "Kept as text"). */
export function blockGist(node: PMNode, max = 48): string {
  const text = node.textContent.replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const sp = cut.lastIndexOf(' ')
  return `${(sp > max * 0.5 ? cut.slice(0, sp) : cut).trimEnd()}…`
}

/* ------------------------------------------------------------------ */
/* Request                                                             */
/* ------------------------------------------------------------------ */

export const COLUMN_TYPES = ['text', 'number', 'select', 'multi_select', 'date', 'url', 'checkbox'] as const
export type ColumnType = (typeof COLUMN_TYPES)[number]

const SYSTEM = `You turn structured text from a page in One, a local-first workspace, into a database: one row (entry) per item the text lists.
You get the selected text as numbered top-level blocks ([B1], [B2] …) in Markdown.

Rules:
- Extract every entry the text lists (an item, ticket, task, person, product, table row …), one per item, in the order of the text. Never merge, skip or summarise entries.
- Never invent values. A value the text does not state stays empty (null). "unassigned", "nicht zugewiesen", "n/a", "none", "—" and the like are empty.
- title: a short name for the database in the language of the text — the text's own heading for the list when it has one.
- columns: the fields the entries have (not the entry title — that is separate). Short names (1–3 words) in the language of the text. At most ${TODB_MAX_COLUMNS}.
  - select for small sets of repeated values (status, type, priority, assignee, category, stage); list every value used as an option.
  - multi_select for tag lists (several values per entry).
  - number for amounts, counts and estimates; date for dates (value YYYY-MM-DD); url for web links; checkbox for yes/no or done/not done; text for everything else.
  - Reference codes and ids ("/r/10527", "#123", "ABC-42") go into a text column of their own (e.g. "Ref"), exactly as written.
- Headings or numbered sections that group entries become a select column (e.g. "Topic" / "Thema"); every entry gets the section it is listed under.
- groupBy: the select column a board groups the entries by — the section column when there is one, else the most useful select column (status, stage), else null.
- entries[].title: what the entry is about, in the author's words, without the values that went into columns (no reference code, status, assignee or tags).
- entries[].values: one item per column that has a value for this entry; column = the exact column name. Text, select and url values are strings, multi_select values are lists of strings, number values numbers, checkbox values booleans.
- entries[].body: longer free text of the entry that fits no column (a description, notes) as Markdown, else null.
- keep: the numbers of the blocks that hold no entries — introductions, source lines, notes, conclusions. They stay on the page as they are. Do not keep a block that only names the list you used as the database title, nor blocks whose entries you extracted.
- Write everything in the language of the text. At most ${TODB_MAX_ENTRIES} entries.`

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] })

export const TODB_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    columns: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: { type: 'string', enum: [...COLUMN_TYPES] },
          options: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'type', 'options'],
        additionalProperties: false,
      },
    },
    entries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          values: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                column: { type: 'string' },
                value: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'array', items: { type: 'string' } }, { type: 'null' }] },
              },
              required: ['column', 'value'],
              additionalProperties: false,
            },
          },
          body: nullable({ type: 'string' }),
        },
        required: ['title', 'values', 'body'],
        additionalProperties: false,
      },
    },
    groupBy: nullable({ type: 'string' }),
    keep: { type: 'array', items: { type: 'integer' } },
  },
  required: ['title', 'columns', 'entries', 'groupBy', 'keep'],
  additionalProperties: false,
}

/** System prompt, user prompt and schema. Exported for tests / debugging. */
export function buildTodbPrompt(blocks: SourceBlock[], opts: { pageTitle?: string; instruction?: string } = {}): { system: string; prompt: string; schema: Record<string, unknown> } {
  const parts: string[] = []
  if (opts.pageTitle?.trim()) parts.push(`Page: ${opts.pageTitle.trim()}`)
  const numbered = blocks.map((b, i) => (b.markdown ? `[B${i + 1}] ${b.markdown}` : '')).filter(Boolean)
  parts.push(`<blocks>\n${numbered.join('\n\n')}\n</blocks>`)
  if (opts.instruction?.trim()) parts.push(`Request from the user: ${opts.instruction.trim()}`)
  parts.push('Turn the entries in these blocks into a database.')
  return { system: SYSTEM, prompt: parts.join('\n\n'), schema: TODB_SCHEMA }
}

/* ------------------------------------------------------------------ */
/* Answer                                                              */
/* ------------------------------------------------------------------ */

export type CellValue = string | number | boolean | string[]

export interface PlanColumn {
  name: string
  type: ColumnType
  /** select / multi_select: the option names in order (declared ones first, then the ones values bring) */
  options: string[]
}

export interface PlanEntry {
  title: string
  /** by column name (as in `columns`) */
  values: Record<string, CellValue>
  body: string | null
}

export interface TablePlan {
  title: string
  columns: PlanColumn[]
  entries: PlanEntry[]
  /** a select column's name, or null */
  groupBy: string | null
  /** 0-based indexes of the blocks that stay on the page (Claude's `keep` + the fixed ones) */
  keep: number[]
}

const line = (v: unknown, max = 300) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const lower = (s: string) => s.trim().toLowerCase()

/** Text-ish: "unassigned" and friends are no value. */
const EMPTY_WORDS = new Set(['', '-', '–', '—', 'n/a', 'na', 'none', 'null', 'unassigned', 'unknown', 'nicht zugewiesen', 'keine', 'kein', 'ohne', 'tbd'])

function cleanValue(v: unknown): CellValue | null {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const s = v.trim()
    return EMPTY_WORDS.has(lower(s)) ? null : s.slice(0, 2000)
  }
  if (Array.isArray(v)) {
    const list = [...new Set(v.map((x) => line(x, 200)).filter((x) => x && !EMPTY_WORDS.has(lower(x))))]
    return list.length ? list : null
  }
  return null
}

/** The answer, validated, capped and typed so nothing is lost; null when it is not the JSON we asked for. */
export function parseTodbAnswer(raw: string, blocks: SourceBlock[]): TablePlan | null {
  let data: unknown
  try {
    data = JSON.parse(raw.trim())
  } catch {
    return null
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const d = data as Record<string, unknown>
  if (!Array.isArray(d.columns) || !Array.isArray(d.entries)) return null

  // columns: named, unique (case-insensitive), not the title's name, known types
  const columns: PlanColumn[] = []
  const byKey = new Map<string, PlanColumn>()
  for (const c of d.columns) {
    if (columns.length >= TODB_MAX_COLUMNS) break
    if (!c || typeof c !== 'object') continue
    const col = c as Record<string, unknown>
    const name = line(col.name, 100)
    if (!name || byKey.has(lower(name)) || lower(name) === lower(TITLE_NAME)) continue
    const type = (COLUMN_TYPES as readonly string[]).includes(col.type as string) ? (col.type as ColumnType) : 'text'
    const options = Array.isArray(col.options) ? dedupe(col.options.map((o) => line(o, 100)).filter(Boolean)) : []
    const out: PlanColumn = { name, type, options }
    columns.push(out)
    byKey.set(lower(name), out)
  }

  const entries: PlanEntry[] = []
  for (const e of d.entries) {
    if (entries.length >= TODB_MAX_ENTRIES) break
    if (!e || typeof e !== 'object') continue
    const en = e as Record<string, unknown>
    const values: Record<string, CellValue> = {}
    if (Array.isArray(en.values))
      for (const pair of en.values) {
        if (!pair || typeof pair !== 'object') continue
        const p = pair as Record<string, unknown>
        const col = byKey.get(lower(line(p.column, 100)))
        const v = cleanValue(p.value)
        if (col && v !== null && !(col.name in values)) values[col.name] = v
      }
    const title = line(en.title, 500)
    const body = typeof en.body === 'string' && en.body.trim() ? en.body.trim().slice(0, 20_000) : null
    if (!title && !Object.keys(values).length && !body) continue
    entries.push({ title, values, body })
  }

  settleTypes(columns, entries)

  const keep = new Set<number>()
  if (Array.isArray(d.keep)) for (const n of d.keep) if (Number.isInteger(n) && (n as number) >= 1 && (n as number) <= blocks.length) keep.add((n as number) - 1)
  blocks.forEach((b, i) => b.fixed && keep.add(i))

  const group = typeof d.groupBy === 'string' ? byKey.get(lower(d.groupBy)) : undefined
  return {
    title: line(d.title, 200),
    columns,
    entries,
    groupBy: group && group.type === 'select' ? group.name : null,
    keep: [...keep].sort((a, b) => a - b),
  }
}

function dedupe(names: string[]): string[] {
  const seen = new Set<string>()
  return names.filter((n) => {
    const k = lower(n)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

const YES = new Set(['true', 'yes', 'y', 'ja', 'x', '✓', '✔', 'done', 'erledigt', '1'])
const NO = new Set(['false', 'no', 'n', 'nein', '', '0', 'open', 'offen'])

/** A number (dot, then comma decimals), or null. */
function asNumber(v: CellValue): { value: number; format: NumberFormat | null } | null {
  if (typeof v === 'number') return { value: v, format: null }
  if (typeof v !== 'string') return null
  return parseNumber(v, 'dot') ?? parseNumber(v, 'comma')
}

const asText = (v: CellValue): string => (Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? '✓' : '') : String(v))

/**
 * Types that fit every value: a number / date / checkbox column with a value that is none of those
 * becomes text, a select with several values in one entry a multi-select; options gain the values.
 */
function settleTypes(columns: PlanColumn[], entries: PlanEntry[]) {
  for (const col of columns) {
    const vals = entries.map((e) => e.values[col.name]).filter((v): v is CellValue => v !== undefined)
    if (col.type === 'number' && !vals.every((v) => asNumber(v))) col.type = 'text'
    if (col.type === 'date' && !vals.every((v) => typeof v === 'string' && parseDateValue(v, isDayFirst(vals)))) col.type = 'text'
    if (col.type === 'checkbox' && !vals.every((v) => typeof v === 'boolean' || (typeof v === 'string' && (YES.has(lower(v)) || NO.has(lower(v)))))) col.type = 'text'
    if (col.type === 'select' && vals.some((v) => Array.isArray(v) && v.length > 1)) col.type = 'multi_select'
    if (col.type === 'select' || col.type === 'multi_select') {
      const names = [...col.options]
      for (const v of vals) for (const n of optionNames(col.type, v)) names.push(n)
      col.options = dedupe(names)
    } else col.options = []
  }
}

function isDayFirst(vals: CellValue[]): boolean {
  return vals.some((v) => typeof v === 'string' && /^(\d{1,2})\/\d{1,2}\/\d{4}/.test(v) && +v.split('/')[0] > 12)
}

function optionNames(type: 'select' | 'multi_select', v: CellValue): string[] {
  const list = Array.isArray(v) ? v : type === 'multi_select' && typeof v === 'string' ? splitList(v) : [asText(v)]
  return list.map((x) => line(x, 100)).filter(Boolean)
}

/* ------------------------------------------------------------------ */
/* Draft (what the preview changes) → database                         */
/* ------------------------------------------------------------------ */

export type TodbView = 'board' | 'table'

export interface TableDraft {
  title: string
  /** names of the columns switched off */
  dropped: string[]
  groupBy: string | null
  view: TodbView
}

export function initialDraft(plan: TablePlan): TableDraft {
  return { title: plan.title, dropped: [], groupBy: plan.groupBy, view: plan.groupBy ? 'board' : 'table' }
}

/** Columns that stay (switched on). */
export function liveColumns(plan: TablePlan, draft: TableDraft): PlanColumn[] {
  return plan.columns.filter((c) => !draft.dropped.includes(c.name))
}

/** The group column the board would use (a live select column), or null. */
export function liveGroup(plan: TablePlan, draft: TableDraft): PlanColumn | null {
  return liveColumns(plan, draft).find((c) => c.name === draft.groupBy && c.type === 'select') ?? null
}

/** The view the database opens with: a board only while there is a group column. */
export function effectiveView(plan: TablePlan, draft: TableDraft): TodbView {
  return liveGroup(plan, draft) ? draft.view : 'table'
}

/** The title property's name. */
export const TITLE_NAME = 'Name'

const PALETTE: ColorName[] = COLOR_NAMES.filter((c) => c !== 'default')

export interface DatabaseSpec {
  title: string
  properties: PropertyDef[]
  views: View[]
  rows: Array<{ title: string; properties: Record<ID, PropertyValue>; body: string | null }>
}

/** Properties, views (the chosen one first) and converted row values. */
export function buildDatabase(plan: TablePlan, draft: TableDraft, names: { board: string; table: string; untitled: string }): DatabaseSpec {
  const cols = liveColumns(plan, draft)
  const titleProp: PropertyDef = { id: newId(), name: TITLE_NAME, type: 'title' }
  const defs = cols.map((c) => {
    const def: PropertyDef = { id: newId(), name: c.name, type: c.type }
    if (c.type === 'select' || c.type === 'multi_select') def.options = c.options.map((name, i): SelectOption => ({ id: newId(), name, color: PALETTE[i % PALETTE.length] }))
    if (c.type === 'number') {
      const formats = new Set(plan.entries.map((e) => (e.values[c.name] !== undefined ? (asNumber(e.values[c.name])?.format ?? null) : undefined)).filter((f) => f !== undefined))
      const only = formats.size === 1 ? [...formats][0] : null
      if (only) def.numberFormat = only
    }
    return { col: c, def }
  })
  const properties = [titleProp, ...defs.map((x) => x.def)]

  const rows = plan.entries.map((e) => {
    const values: Record<ID, PropertyValue> = {}
    for (const { col, def } of defs) {
      const v = e.values[col.name]
      if (v === undefined) continue
      const out = convert(def, v, plan)
      if (out !== null && out !== undefined) values[def.id] = out
    }
    return { title: e.title || names.untitled, properties: values, body: e.body }
  })

  const group = liveGroup(plan, draft)
  const groupDef = group ? defs.find((x) => x.col === group)?.def : undefined
  const table = defaultView('table', { properties }, names.table)
  const views: View[] = [table]
  if (groupDef) {
    const board = defaultView('board', { properties }, names.board)
    board.groupBy = groupDef.id
    if (effectiveView(plan, draft) === 'board') views.unshift(board)
    else views.push(board)
  }
  return { title: draft.title.trim() || plan.title || names.untitled, properties, views, rows }
}

function convert(def: PropertyDef, v: CellValue, plan: TablePlan): PropertyValue | undefined {
  switch (def.type) {
    case 'number':
      return asNumber(v)?.value ?? null
    case 'date': {
      const all = plan.entries.map((e) => e.values[def.name]).filter((x): x is CellValue => x !== undefined)
      return typeof v === 'string' ? parseDateValue(v, isDayFirst(all)) : null
    }
    case 'checkbox':
      return typeof v === 'boolean' ? v : YES.has(lower(String(v)))
    case 'select': {
      const name = optionNames('select', v)[0]
      return name ? (def.options?.find((o) => lower(o.name) === lower(name))?.id ?? null) : null
    }
    case 'multi_select': {
      const ids = optionNames('multi_select', v)
        .map((n) => def.options?.find((o) => lower(o.name) === lower(n))?.id)
        .filter((id): id is string => !!id)
      return [...new Set(ids)]
    }
    case 'url':
    case 'text':
      return asText(v)
    default:
      return undefined
  }
}
