/**
 * Workspace people (Workspace.people) — where each person is used, and the tools of the People section
 * (shell/workspace/People.tsx):
 *  - peopleUsage(pages, databases): per person the rows that hold them in a person property, the pages that
 *    @mention them, and (team) the pages they created or edited last (`createdBy` / `updatedBy`)
 *  - addPerson / renamePerson (mention labels follow) / recolourPerson
 *  - mergePeople(from, into): every person value and every @mention of `from` points at `into`, then `from`
 *    leaves the list — one Undo (toast) puts everything back; a version of each rewritten page is kept first
 *  - removePerson: only someone nobody uses (otherwise: merge them into someone)
 * Page content is written only with setContent(…, 'people').
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { inTemplate, isEffectivelyTrashed } from '../../store/selectors'
import type { ColorName, Database, ID, Page, Person, PropertyValue } from '../../store/types'
import { snapshotNow } from '../../features'
import { t } from '../../i18n'

/** The writer of people changes in page content (Page.contentOrigin). */
export const PEOPLE_ORIGIN = 'people'
export const PERSON_NAME_MAX = 60

export interface UseRef {
  pageId: ID
  /** the row's database */
  dbId?: ID
  /** in the trash or inside a template: counted, listed last */
  hidden?: 'trash' | 'template'
}

export interface PersonUse {
  /** rows that hold them in a person property */
  rows: UseRef[]
  /** pages that @mention them */
  mentions: UseRef[]
  /** pages and rows they created or edited last (team workspaces: their account id) */
  authored: number
}

export const usedCount = (u: PersonUse | undefined) => (u ? u.rows.length + u.mentions.length : 0)

const ws = () => useWorkspace.getState()

/* ------------------------------------------------------------------ reading */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

const isPersonMention = (n: JSONContent) => n.type === 'mention' && isObj(n.attrs) && n.attrs.kind === 'person' && typeof n.attrs.id === 'string'

/** Person ids a content @mentions, per (immutable) content object. */
const mentionCache = new WeakMap<object, ReadonlySet<ID>>()
const NONE: ReadonlySet<ID> = new Set()

export function mentionedPeople(content: JSONContent | null | undefined): ReadonlySet<ID> {
  if (!content || typeof content !== 'object') return NONE
  const hit = mentionCache.get(content)
  if (hit) return hit
  const out = new Set<ID>()
  const walk = (n: JSONContent) => {
    if (isPersonMention(n)) out.add(n.attrs!.id as string)
    if (Array.isArray(n.content)) for (const c of n.content) if (c && typeof c === 'object') walk(c)
  }
  walk(content)
  const set = out.size ? out : NONE
  mentionCache.set(content, set)
  return set
}

/** The person ids of a person value (a list; an odd single id counts too). */
export function personIds(v: PropertyValue | undefined): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  return typeof v === 'string' && v ? [v] : []
}

/** Person properties per database id. */
function personProps(databases: Record<ID, Database>): Map<ID, ID[]> {
  const out = new Map<ID, ID[]>()
  for (const db of Object.values(databases)) {
    const ids = db.properties.filter((p) => p.type === 'person').map((p) => p.id)
    if (ids.length) out.set(db.id, ids)
  }
  return out
}

function hiddenOf(pages: Record<ID, Page>, p: Page): UseRef['hidden'] {
  if (p.trashed || isEffectivelyTrashed(pages, p.id)) return 'trash'
  if (inTemplate(pages, p.id)) return 'template'
  return undefined
}

/** Where every person is used (people nobody uses have no entry). */
export function peopleUsage(pages: Record<ID, Page>, databases: Record<ID, Database>): Map<ID, PersonUse> {
  const props = personProps(databases)
  const out = new Map<ID, PersonUse>()
  const use = (id: ID) => {
    let u = out.get(id)
    if (!u) out.set(id, (u = { rows: [], mentions: [], authored: 0 }))
    return u
  }
  for (const p of Object.values(pages)) {
    const rowProps = p.databaseId ? props.get(p.databaseId) : undefined
    const mentioned = mentionedPeople(p.content)
    let hidden: UseRef['hidden'] | null = null
    const where = () => (hidden ??= hiddenOf(pages, p) ?? undefined)
    if (rowProps) {
      const ids = new Set<ID>()
      for (const propId of rowProps) for (const id of personIds(p.properties[propId])) ids.add(id)
      for (const id of ids) use(id).rows.push({ pageId: p.id, dbId: p.databaseId!, hidden: where() })
    }
    for (const id of mentioned) use(id).mentions.push({ pageId: p.id, hidden: where() })
    if (typeof p.createdBy === 'string' && p.createdBy) use(p.createdBy).authored++
    if (typeof p.updatedBy === 'string' && p.updatedBy && p.updatedBy !== p.createdBy) use(p.updatedBy).authored++
  }
  // live uses first, then the trash and templates — each by title
  const order = (a: UseRef, b: UseRef) => (a.hidden ? 1 : 0) - (b.hidden ? 1 : 0) || (pages[a.pageId]?.title ?? '').localeCompare(pages[b.pageId]?.title ?? '')
  for (const u of out.values()) {
    u.rows.sort(order)
    u.mentions.sort(order)
  }
  return out
}

/* ------------------------------------------------------------------ writing content */

/**
 * The content with every person mention passed through `fn` (it returns new attrs, or null to keep the
 * mention as it is). The same object when nothing changed.
 */
export function mapPersonMentions(node: JSONContent, fn: (attrs: Record<string, unknown>) => Record<string, unknown> | null): JSONContent {
  if (isPersonMention(node)) {
    const next = fn(node.attrs as Record<string, unknown>)
    return next ? { ...node, attrs: next } : node
  }
  if (!Array.isArray(node.content)) return node
  let changed = false
  const content = node.content.map((c) => {
    const n = c && typeof c === 'object' ? mapPersonMentions(c, fn) : c
    if (n !== c) changed = true
    return n
  })
  return changed ? { ...node, content } : node
}

/* ------------------------------------------------------------------ the tools */

export type NameCheck = 'empty' | 'long' | 'taken'

const clean = (raw: string) => raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim()

/** Is `raw` a usable name for a person (`self` may keep its own)? */
export function checkPersonName(raw: string, self?: ID): NameCheck | null {
  const name = clean(raw)
  if (!name) return 'empty'
  if ([...name].length > PERSON_NAME_MAX) return 'long'
  const lower = name.toLowerCase()
  if (ws().people.some((p) => p.id !== self && p.name.trim().toLowerCase() === lower)) return 'taken'
  return null
}

export function addPerson(raw: string): ID | NameCheck {
  const problem = checkPersonName(raw)
  return problem ?? ws().addPerson(clean(raw))
}

/** A new name; the labels of their @mentions follow (exports and copies read the label). */
export function renamePerson(id: ID, raw: string): NameCheck | null {
  const problem = checkPersonName(raw, id)
  if (problem) return problem
  const name = clean(raw)
  ws().updatePerson(id, { name })
  for (const p of Object.values(ws().pages)) {
    if (!p.content || !mentionedPeople(p.content).has(id)) continue
    const next = mapPersonMentions(p.content, (a) => (a.id === id && a.label !== name ? { ...a, label: name } : null))
    if (next !== p.content) ws().setContent(p.id, next, PEOPLE_ORIGIN)
  }
  return null
}

export function recolourPerson(id: ID, color: ColorName): void {
  ws().updatePerson(id, { color })
}

/** Take a person nobody uses off the list (Undo in the toast). False: unknown or still used. */
export function removeUnusedPerson(id: ID): boolean {
  const s = ws()
  const person = s.people.find((p) => p.id === id)
  if (!person || usedCount(peopleUsage(s.pages, s.databases).get(id))) return false
  const index = s.removePerson(id)
  useUI.getState().toast({
    message: t('shell.ws.people.removed', { name: person.name }),
    kind: 'success',
    timeout: 8000,
    action: { label: t('common.undo'), run: () => ws().restorePerson(person, index) },
  })
  return true
}

const sameValue = (a: PropertyValue | undefined, b: PropertyValue | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export interface MergeResult {
  rows: number
  pages: number
}

/**
 * Merge `fromId` into `intoId`: person values (rows of every database, the trash and templates included) and
 * @mentions (content, origin 'people') point at `into`; `from` leaves the list. A version of every page whose
 * content changes is kept first. One Undo puts the person, the values and the content back (a page edited
 * since keeps its newer content). Null: unknown people or the same person.
 */
export async function mergePeople(fromId: ID, intoId: ID): Promise<MergeResult | null> {
  const s0 = ws()
  const from = s0.people.find((p) => p.id === fromId)
  const into = s0.people.find((p) => p.id === intoId)
  if (!from || !into || fromId === intoId) return null
  const usage = peopleUsage(s0.pages, s0.databases).get(fromId)
  const mentionPages = (usage?.mentions ?? []).map((r) => r.pageId)
  // a version of every page whose text changes, before it changes
  await Promise.all(mentionPages.map((id) => snapshotNow(id, 'auto').catch(() => null)))

  const s = ws()
  const props = personProps(s.databases)
  const values: Array<{ rowId: ID; propId: ID; before: PropertyValue; after: PropertyValue }> = []
  for (const ref of usage?.rows ?? []) {
    const row = s.pages[ref.pageId]
    if (!row?.databaseId) continue
    for (const propId of props.get(row.databaseId) ?? []) {
      const ids = personIds(row.properties[propId])
      if (!ids.includes(fromId)) continue
      const after = [...new Set(ids.map((x) => (x === fromId ? intoId : x)))]
      values.push({ rowId: row.id, propId, before: row.properties[propId] ?? null, after })
    }
  }
  for (const v of values) ws().setRowProperty(v.rowId, v.propId, v.after)

  const contents: Array<{ pageId: ID; before: JSONContent; rev: number }> = []
  for (const pageId of mentionPages) {
    const page = ws().pages[pageId]
    if (!page?.content) continue
    const next = mapPersonMentions(page.content, (a) => (a.id === fromId ? { ...a, id: intoId, label: into.name } : null))
    if (next === page.content) continue
    ws().setContent(pageId, next, PEOPLE_ORIGIN)
    contents.push({ pageId, before: page.content, rev: ws().pages[pageId]?.contentRev ?? -1 })
  }
  const index = ws().removePerson(fromId)

  const undo = () => {
    const now = ws()
    now.restorePerson(from, index)
    for (const v of values) if (sameValue(ws().pages[v.rowId]?.properties[v.propId], v.after)) ws().setRowProperty(v.rowId, v.propId, v.before)
    // content edited since the merge keeps its newer state
    for (const c of contents) if (ws().pages[c.pageId]?.contentRev === c.rev) ws().setContent(c.pageId, c.before, PEOPLE_ORIGIN)
  }
  const rows = new Set(values.map((v) => v.rowId)).size
  useUI.getState().toast({
    message: t('shell.ws.people.merged', { from: from.name, into: into.name, rows, pages: contents.length }),
    kind: 'success',
    timeout: 12_000,
    action: { label: t('common.undo'), run: undo },
  })
  return { rows, pages: contents.length }
}

/** The person a merge keeps for `id`'s values: everyone else, by name. */
export function mergeTargets(people: Person[], id: ID): Person[] {
  return people.filter((p) => p.id !== id).sort((a, b) => a.name.localeCompare(b.name))
}
