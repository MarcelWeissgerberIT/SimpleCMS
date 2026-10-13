/**
 * What Jev reads of ONE staged change (slice SJ, DJ21) — pure: a world in (the workspace as the route may see it), the
 * state out. Key order `change` · `row` · `trigger` · `agent`:
 *
 *   change   { kind, target { kind: page | row, title, database? }, fields [{ name, before, after }] ≤ 30, before?, after? }
 *   row      the target row's other values (rowFactsFor, ≤ 30 × 200) — a change to an existing row, or {} for a new one
 *   trigger  { type, title? } — a trigger row only when the agent's scope sees it and the route may
 *   agent    { instructions (whole, ≤ 8 000 — the store's cap), write_mode }
 *
 * Never in a state: an id (pages, rows, people, runs, tasks), an e-mail address, a key-shaped string; links read as the
 * page's visible title (a page the route may not see: "[Seite]"), person links / values as "@Person n" unless the route
 * may receive names, task quotes keep their title without their id and field line. Names typed into the agent's
 * instructions are its own words (class public) and stay. Before / after are clipped to 4 000 characters each; a state
 * over One's cap (JEV_STATE_TOKENS) is clipped further (before / after / row / fields — never the instructions), still
 * over → not sent ('context').
 */
import type { JSONContent } from '@tiptap/core'
import type { DecideQuestion, SourceRef } from '@/shared/ai/types'
import { redactPersonValue, type Redactor } from '@/shared/ai/redact'
import { scrubSecrets } from '@/shared/ai/keys'
import { decideTokens } from '@/shared/ai/wire/decisions'
import { JEV_STATE_TOKENS } from '@/shared/ai/jev'
import type { Database, ID, Page, PropertyDef } from '../../../store/types'
import type { PropChange, StagedChange } from '../agent/types'
import type { ItemFact, ItemRefFact } from '../../workitems/facts'
import { isCheckedKind } from './kinds'

/** The workspace as the decision's route may read it (features/ai/decide/world.ts builds it from the store and the gate). */
export interface StateWorld {
  pages: Record<ID, Page>
  databases: Record<ID, Database>
  /** a page, database or person id of this workspace (never written into a state) */
  isId(token: string): boolean
  /** may the route see this page (its member classes)? */
  visible(id: ID): boolean
  /** may the route receive people's names? */
  people: boolean
  /** one per request: the same person is the same "Person n" throughout */
  redactor: Redactor
  /** how a page the route may not see reads ("[Seite]" / "[Page]") */
  hidden: string
  /** a row's fields as the route may receive them (rowFactsFor) */
  rowFacts(db: Database, row: Page): Array<{ name: string; value: string }>
  /** a doc (or blocks) as Markdown for the route (redactDoc first) */
  markdown(doc: JSONContent): string
  /** the agent's scope (null: everything) */
  inScope: ((id: ID) => boolean) | null
}

export interface ProposalInput {
  agent: { instructions: string; write: string }
  /** what started the run, and its rows (row triggers) */
  trigger: { type: string; rows?: readonly ID[] }
  change: StagedChange
  /** the run's other changes (a page staged earlier in the run) */
  changes: readonly StagedChange[]
  /** staged row id → the id it got when applied */
  rowIds?: Record<string, ID>
}

export interface ProposalState {
  state: Record<string, unknown>
  /** what the request carries (the target, its parent or database, the trigger row) — the gate classifies them */
  sources: SourceRef[]
  /** state + questions in characters (the gate's size) */
  chars: number
}

/** The limits of a state (and the tighter ones for a state over the cap). */
export const STATE_LIMITS = { md: 4000, fields: 30, field: 200, row: 30, rowValue: 200, title: 200, instructions: 8000 } as const
const TIGHT = { ...STATE_LIMITS, md: 1000, field: 80, rowValue: 80 } as const
type Limits = { md: number; fields: number; field: number; row: number; rowValue: number; title: number; instructions: number }

/** A page this many ancestors up is as far as a staged page's parent is followed. */
const MAX_DEPTH = 50

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const tail = (s: string, n: number) => (s.length > n ? `…${s.slice(s.length - n + 1)}` : s)
const unescape = (s: string) => s.replace(/\\(.)/g, '$1')
const decode = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

const LINK = /\[(@?)((?:\\.|[^\]\\])*)\]\(([^)\s]+)\)/g
const ITEM_ID = /\s*\{#wi_[a-z0-9]+[^}\n]*\}/g
const BARE_ITEM = /\bwi_[a-z0-9]{6,16}\b/g
const FIELD_LINE = /^>\s*(?:Status|Due|Owner|Blocked by|Related):/
const TODO_HEAD = /^>\s*\[!TODO\]/
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
const TOKEN = /[A-Za-z0-9_-]{6,64}/g

/**
 * Text of the workspace or an agent as Jev may read it: links → the visible title (or the hidden label), person links →
 * "@Name" / "@Person n", date links → their label, task ids and field lines out, then any id, e-mail address and key
 * that is left.
 */
export function dataText(raw: string, w: StateWorld): string {
  let s = scrubSecrets(raw)
  s = s.replace(LINK, (_m, at: string, label: string, href: string) => {
    const text = unescape(label)
    if (href.startsWith('one:person/')) return w.people ? `@${text.replace(/^@/, '')}` : redactPersonValue(decode(href.slice('one:person/'.length)), w.redactor)
    if (href.startsWith('one:date/')) return `@${text.replace(/^@/, '')}`
    if (href.startsWith('#/p/')) {
      const id = decode(href.slice('#/p/'.length).split(/[?#/]/)[0] ?? '')
      const page = w.pages[id]
      return page && w.visible(id) ? `${at}${page.title.trim() || 'Untitled'}` : w.hidden
    }
    if (href.startsWith('#/') || href.startsWith('one:')) return `${at}${text}`
    return `[${at}${label}](${href})`
  })
  // task quotes: the title stays, its id and its field line (people, dates, linked tasks by id) go
  const lines = s.split('\n')
  const kept: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (FIELD_LINE.test(line) && i > 0 && TODO_HEAD.test(lines[i - 1]!)) continue
    kept.push(line)
  }
  s = kept.join('\n').replace(ITEM_ID, '').replace(BARE_ITEM, '[task]')
  s = s.replace(EMAIL, '[email]')
  s = s.replace(TOKEN, (tok) => (w.isId(tok) ? '[id]' : tok))
  return s
}

const PERSON_LIKE = new Set<PropertyDef['type']>(['person', 'created_by', 'last_edited_by'])

const idsOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' && v ? [v] : [])
const intentIds = (c: PropChange): string[] | null => (c.intent.kind === 'value' ? idsOf(c.intent.value) : null)

/** A row's stored person ids for a person-like field. */
function personIds(def: PropertyDef | undefined, row: Page | undefined): string[] {
  if (!def || !row) return []
  if (def.type === 'created_by') return row.createdBy ? [row.createdBy] : []
  if (def.type === 'last_edited_by') return row.updatedBy ? [row.updatedBy] : []
  return idsOf(row.properties?.[def.id])
}

/** One field a change sets, as the route may receive it. */
function fieldOf(c: PropChange, db: Database | undefined, row: Page | undefined, w: StateWorld, lim: Limits): { name: string; before: string; after: string } {
  const def = db?.properties.find((p) => p.id === c.propId)
  const type = def?.type ?? c.type
  const name = clip(dataText(c.name, w), lim.title)
  const text = (s: string) => clip(dataText(s, w), lim.field)
  if (PERSON_LIKE.has(type) && !w.people) {
    const person = (k: string) => redactPersonValue(k, w.redactor)
    const after = intentIds(c) ?? c.after.split(',').map((x) => x.trim()).filter(Boolean)
    return { name, before: clip(personIds(def, row).map(person).join(', '), lim.field), after: clip(after.map(person).join(', '), lim.field) }
  }
  if (type === 'relation') {
    const target = def?.relationDatabaseId ? w.databases[def.relationDatabaseId] : undefined
    const contacts = !w.people && target?.system === 'mail-contacts'
    const show = (id: string) => (!w.visible(id) || !w.pages[id] ? '—' : contacts ? redactPersonValue(id, w.redactor) : dataText(w.pages[id].title.trim() || 'Untitled', w))
    const after = intentIds(c)
    return { name, before: clip(idsOf(row?.properties?.[c.propId]).map(show).join(', '), lim.field), after: after ? clip(after.map(show).join(', '), lim.field) : text(c.after) }
  }
  return { name, before: text(c.before), after: text(c.after) }
}

/** A task's changed fields (update_work_item) — people by name only where names may go, linked tasks by title only in scope. */
function taskFields(f: ItemFact, w: StateWorld, lim: Limits): Array<{ name: string; before: string; after: string }> {
  const people = (list: ItemFact['people']) => list.map((p) => (w.people ? dataText(p.name, w) : redactPersonValue(p.id, w.redactor))).join(', ')
  const refs = (list: ItemRefFact[]) => list.map((r) => (r.inScope && r.title ? dataText(r.title, w) : '—')).join(', ')
  const b = f.before
  const rows: Array<{ name: string; before: string; after: string }> = [
    { name: 'Status', before: b?.status ?? '', after: f.status },
    { name: 'Due', before: b?.due ?? '', after: f.due ?? '' },
    { name: 'Reminder', before: b?.reminder ?? '', after: f.reminder ?? '' },
    { name: 'Owner', before: b ? people(b.people) : '', after: people(f.people) },
    { name: 'Blocked by', before: b ? refs(b.blockedBy) : '', after: refs(f.blockedBy) },
    { name: 'Related', before: b ? refs(b.related) : '', after: refs(f.related) },
  ]
  return rows.filter((r) => r.before !== r.after).map((r) => ({ name: r.name, before: clip(r.before, lim.field), after: clip(r.after, lim.field) }))
}

/** What a change is about: an existing page or row, the staged change that creates it, or nothing known. */
function targetOf(input: ProposalInput, pages: Record<ID, Page>): { page: Page | null; creator: StagedChange | null } {
  const c = input.change
  if (c.kind === 'create_page' || c.kind === 'create_row') return { page: null, creator: c }
  const real = input.rowIds?.[c.pageId] ?? c.pageId
  const page = pages[real] ?? null
  if (page) return { page, creator: null }
  return { page: null, creator: input.changes.find((x) => (x.kind === 'create_page' || x.kind === 'create_row') && x.pageId === c.pageId && x.status !== 'discarded') ?? null }
}

/** The sources of a staged creation: its database, else its nearest existing parent (a staged parent followed up), else the workspace. */
function creationSources(creator: StagedChange, input: ProposalInput, pages: Record<ID, Page>, databases: Record<ID, Database>): SourceRef[] {
  const real = (id: ID) => input.rowIds?.[id] ?? id
  if (creator.kind === 'create_row') {
    const db = creator.databaseId ? real(creator.databaseId) : null
    return db && databases[db] && pages[db] ? [{ db }] : [{ all: true }]
  }
  let parent = creator.parentId ?? null
  for (let depth = 0; parent && depth < MAX_DEPTH; depth++) {
    const id = real(parent)
    if (pages[id]) return pages[id].databaseId ? [{ row: id }] : [{ page: id }]
    const up = input.changes.find((x) => (x.kind === 'create_page' || x.kind === 'create_row') && x.pageId === parent)
    if (!up) break
    if (up.kind === 'create_row') return creationSources(up, input, pages, databases)
    parent = up.parentId ?? null
  }
  return [{ all: true }]
}

/** What a change's request carries before its state is built (the precheck's sources): its target, or where it is created. */
export function proposalSources(input: ProposalInput, w: Pick<StateWorld, 'pages' | 'databases'>): SourceRef[] {
  const { page, creator } = targetOf(input, w.pages)
  if (page) return page.databaseId ? [{ row: page.id }] : [{ page: page.id }]
  return creator ? creationSources(creator, input, w.pages, w.databases) : [{ all: true }]
}

/**
 * The state of one change for Jev (null: not a kind Jev checks; `refused: 'context'`: over the cap even when clipped).
 * `questions` are counted into the size.
 */
export function proposalState(input: ProposalInput, w: StateWorld, questions: Record<string, DecideQuestion>): ProposalState | { refused: 'context' } | null {
  if (!isCheckedKind(input.change.kind)) return null
  for (const lim of [STATE_LIMITS, TIGHT] as const) {
    const built = build(input, w, lim)
    if (decideTokens(built.state, questions) <= JEV_STATE_TOKENS) return { ...built, chars: JSON.stringify({ state: built.state, questions }).length }
  }
  return { refused: 'context' }
}

function build(input: ProposalInput, w: StateWorld, lim: Limits): { state: Record<string, unknown>; sources: SourceRef[] } {
  const c = input.change
  const md = (s: string | undefined) => clip(dataText(s ?? '', w).trim(), lim.md)
  const title = (s: string | undefined) => clip(dataText((s ?? '').trim() || 'Untitled', w), lim.title)
  const dbName = (id: ID | undefined) => {
    const real = id ? (input.rowIds?.[id] ?? id) : null
    const p = real ? w.pages[real] : undefined
    return p ? (w.visible(p.id) ? title(p.title) : w.hidden) : undefined
  }
  const { page, creator } = targetOf(input, w.pages)
  const sources: SourceRef[] = proposalSources(input, w)
  // a Contacts row's title is a person's name (the mail directory, features/mail/people.ts): without `people` it reads
  // "@Person n" — the same redactor as its relation values
  const contacts = (dbId: ID | null | undefined) => {
    const real = dbId ? (input.rowIds?.[dbId] ?? dbId) : null
    return !w.people && !!real && w.databases[real]?.system === 'mail-contacts'
  }
  const rowTitle = (key: string, raw: string | undefined, dbId: ID | null | undefined) => (contacts(dbId) ? redactPersonValue(key, w.redactor) : title(raw))

  // the target: what it is called (as the route may see it), and the row behind it
  let target: Record<string, unknown>
  let rowPage: Page | undefined
  let rowDb: Database | undefined
  if (page) {
    const db = page.databaseId ? w.databases[page.databaseId] : undefined
    target = { kind: page.databaseId ? 'row' : 'page', title: w.visible(page.id) ? rowTitle(page.id, page.title, page.databaseId) : w.hidden, ...(page.databaseId ? { database: dbName(page.databaseId) ?? w.hidden } : {}) }
    if (db) {
      rowPage = page
      rowDb = db
    }
  } else if (creator) {
    target = { kind: creator.kind === 'create_row' ? 'row' : 'page', title: creator.kind === 'create_row' ? rowTitle(creator.pageId, creator.title, creator.databaseId) : title(creator.title), ...(creator.kind === 'create_row' ? { database: dbName(creator.databaseId) ?? w.hidden } : {}) }
  } else target = { kind: 'page', title: w.hidden }

  // what changes: its fields, the text before and after
  const fieldDb = c.databaseId ? w.databases[input.rowIds?.[c.databaseId] ?? c.databaseId] : rowDb
  let fields: Array<{ name: string; before: string; after: string }> = []
  let before = ''
  let after = ''
  switch (c.kind) {
    case 'create_page':
    case 'create_row':
      fields = (c.props ?? []).map((p) => fieldOf(p, fieldDb, undefined, w, lim))
      after = md(c.markdown)
      break
    case 'update_row':
      fields = (c.props ?? []).map((p) => fieldOf(p, fieldDb, rowPage, w, lim))
      after = md(c.markdown)
      break
    case 'rename':
      // a contact renamed: both names are the same person ("@Person n")
      fields = [{ name: 'title', before: rowTitle(c.pageId, c.beforeTitle, page?.databaseId), after: rowTitle(c.pageId, c.title, page?.databaseId) }]
      break
    case 'append':
      before = page && w.visible(page.id) ? tail(dataText(w.markdown((page.content as JSONContent | undefined) ?? { type: 'doc', content: [] }), w).trim(), lim.md) : ''
      after = md(c.markdown)
      break
    case 'edit': {
      const e = c.edit
      const blocks = e?.op === 'replace_all' ? (e.pageBefore?.content ?? []) : (e?.targets ?? []).map((t) => t.block)
      before = page && w.visible(page.id) && blocks.length ? clip(dataText(w.markdown({ type: 'doc', content: blocks }), w).trim(), lim.md) : ''
      after = md(c.markdown)
      break
    }
    case 'workItem':
      if (c.workItem) {
        fields = taskFields(c.workItem.facts, w, lim)
        after = clip(dataText(c.workItem.facts.title, w), lim.title)
      }
      break
  }
  fields = fields.slice(0, lim.fields)

  // the row the change is about: its other values (a new row: none yet)
  let row: Record<string, string> | undefined
  if (rowPage && rowDb && w.visible(rowPage.id)) {
    const set = new Set(fields.map((f) => f.name))
    row = {}
    let n = 0
    for (const f of w.rowFacts(rowDb, rowPage)) {
      const name = clip(dataText(f.name, w), lim.title)
      if (set.has(name) || n >= lim.row) continue
      row[name] = clip(dataText(f.value, w), lim.rowValue)
      n++
    }
  } else if (c.kind === 'create_row' || creator?.kind === 'create_row') row = {}

  // the trigger: its kind, and its row only where the agent's scope and the route both see it
  const targetId = page?.id ?? null
  const rows = (input.trigger.rows ?? []).filter((id) => {
    const p = w.pages[id]
    return !!p && !p.trashed && (!w.inScope || w.inScope(id)) && w.visible(id)
  })
  const tid = targetId && rows.includes(targetId) ? targetId : (rows[0] ?? null)
  if (tid && !sources.some((s) => 'row' in s && s.row === tid)) sources.push({ row: tid })
  const trigger = { type: input.trigger.type, ...(tid ? { title: rowTitle(tid, w.pages[tid]!.title, w.pages[tid]!.databaseId) } : {}) }

  const change: Record<string, unknown> = { kind: c.kind, target, ...(fields.length ? { fields } : {}), ...(before ? { before } : {}), ...(after ? { after } : {}) }
  const agent = { instructions: dataText(input.agent.instructions.slice(0, lim.instructions), w), write_mode: input.agent.write }
  return { state: { change, ...(row ? { row } : {}), trigger, agent }, sources }
}
