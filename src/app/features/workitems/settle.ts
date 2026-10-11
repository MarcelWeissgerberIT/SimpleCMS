/**
 * The settle gate — the ONE place a `> [!TODO]` quote in Claude's Markdown becomes a task. Pure over a `SettleWorld`
 * (world.ts gives the live one): no store, no editor, no index import. Called by features/ai/claudeDoc.ts
 * (`claudeSettled(markdown, keep, ctx)`) after markdownToDoc and withoutWebLoads, before the `one:` links become
 * mentions — it reads the field line's links itself.
 *
 *  - Identity: tasks the replaced content (`known`) holds come back by id with every field as One has them (P0
 *    keepItems — text never changes fields); `keepSingle` lets one quote without an id be the one task it replaces.
 *    Every other quote is NEW: a fresh id (staging) or the staged one (`ids`, apply — never re-minted; an id taken by
 *    now → `idTaken`, the caller fails the change). An id Claude wrote for a task elsewhere → a new task (`copy`) or
 *    left out (`existing: 'skip'`).
 *  - Fields: people only existing ones (by id, folded exact unique name, a member's email, "me") — never created;
 *    dates / statuses / reminders validated; links resolved handle → id → unique title, only to live tasks in the
 *    writer's scope (agent scope, context marks, never a shared task onto a private one — either direction), no
 *    self links, no loops, caps.
 *  - The creation gate (`canCreate`), `creates: false` (the quote stays a quote), > MAX_NEW_ITEMS.
 *  - `strict` (tool loops at staging): what is wrong throws a SettleRefusal (model-facing English) so Claude fixes the
 *    call; otherwise (one-shot paths, apply) it becomes a warning and the value is left out.
 * The report says what happened: created / kept / removed facts, ids, handles, `Blocks:` onto existing tasks, links
 * to tasks other staged changes create (`needs`), ignored field lines, warnings.
 */
import type { JSONContent } from '@tiptap/core'
import type { ID } from '../../store/types'
import { keepItems, readClaudeQuote, type ClaudeItemDraft, type PersonDraft, type RefDraft } from '../../editor/workitem/markdown'
import { itemAttrs, MAX_LINKS, MAX_PEOPLE, storedItemAttrs, WORK_ITEM, type WorkItemAttrs, type WorkItemStatus } from '../../editor/workitem/attrs'
import { isSyncedRef, outermostItems } from '../../lib/itemIds'
import { wouldLoop } from './graph'
import { factsOfNode, type FactWorld, type ItemFact, type ItemRefFact } from './facts'

export type SettleSource = 'menu' | 'transform' | 'terminal' | 'agent' | 'mcp'

/** Structural twin of agent/tools.ts ReadLimit (settle never imports the agent). */
export interface SettleReadLimit {
  mode: 'marked' | 'none'
  ids?: string[]
}

/** A task staged (not applied) in this conversation / run / call. */
export interface StagedRef {
  change: string | null
  private: boolean
}

export interface SettleContext {
  source: SettleSource
  /** may this write make NEW tasks (false: `[!TODO]` quotes stay quotes; `known` tasks still come back) */
  creates: boolean
  /** refusals throw SettleRefusal (tool loops at staging) instead of becoming warnings (one-shot paths, apply) */
  strict: boolean
  /** the page the content lands on (null: a page created by this batch) and whether it is private (team) */
  pageId: ID | null
  private: boolean
  /** pages the writer may see (custom agent scope); null = every live page of this workspace */
  visible?: ((pageId: ID) => boolean) | null
  /** the terminal's read limits (context marks) — a task in a block Claude may not read is out of scope */
  readLimit?: ((pageId: ID) => SettleReadLimit | null) | null
  /** what this write replaces (edit_page targets / whole page, MCP replace, AI-menu Replace range — read NOW) */
  known?: JSONContent | null
  /** edit_page / Replace of exactly ONE task: a single `[!TODO]` quote without a known id is that task */
  keepSingle?: boolean
  /**
   * APPLY: the ids staging minted. The n-th NEW task (document order) takes ids[n]; nothing is minted; ids[n] in use
   * elsewhere → report.idTaken (the caller fails the change); quotes beyond ids.length stay quotes. Absent: staging
   * (fresh ids) or a one-shot path.
   */
  ids?: readonly string[]
  /**
   * STAGING of a change that extends its own earlier write (an append to a pending append, a staged page written again):
   * its n-th new task keeps firstIds[n] (other changes may point at it already), the rest get fresh ids.
   */
  firstIds?: readonly string[]
  /**
   * STAGING of a change whose text was REPLACED (a page staged again, an edit revised, a row's body written again): a new
   * task takes the id of the earlier text's task with the same handle, else with the same title (each once) — never by
   * position: another change may link that id, and it must stay the task the person reviewed.
   */
  reuse?: ReadonlyArray<{ itemId: string; handle: string | null; title: string }>
  /**
   * APPLY (with `ids`): what staging resolved per new task (pins[n] ↔ ids[n]) — the people and links are these ids,
   * never names or titles resolved again; one that is gone by now is left out (a warning).
   */
  pins?: ReadonlyArray<ItemPin | null>
  /** a review render of a staged change (`ids` given): its ids are used as they are — the change itself may hold them by now */
  preview?: boolean
  /** handles known before this write (earlier calls of the conversation / run, or the staged change's own map) */
  handles?: ReadonlyMap<string, string>
  /** new tasks staged in this conversation / run / call → the change creating them + its page's privacy */
  staged?: ReadonlyMap<string, StagedRef>
  /** the change being (re)settled — links to its own new tasks are no cross-change need */
  change?: string | null
  /** `{#wi_X}` of a live task that `known` does not hold: 'copy' (default) → a new task + `copy` · 'skip' → left out + `exists` */
  existing?: 'copy' | 'skip'
  /** `me` resolves (custom agents: false — they name the person) */
  me: boolean
  /**
   * blockedBy edges the pending changes add (staged link changes, other staged tasks' links): a link of this write
   * that would close a loop through them is left out like one through live links
   */
  pendingEdges?: ReadonlyMap<string, readonly string[]>
}

export type SettleWarningCode =
  | 'person'
  | 'personAmbiguous'
  | 'members'
  | 'date'
  | 'status'
  | 'reminder'
  | 'dateReminder'
  | 'link'
  | 'linkAmbiguous'
  | 'loop'
  | 'self'
  | 'scope'
  | 'blocks'
  | 'fields'
  | 'fieldKey'
  | 'gate'
  | 'nested'
  | 'cap'
  | 'copy'
  | 'exists'
  | 'title'
  | 'tooMany'
  | 'meAgent'

export interface SettleWarning {
  code: SettleWarningCode
  /** the task's title ('' when the warning is about the whole write) */
  task: string
  value?: string
}

export interface SettleReport {
  /** new tasks, document order */
  created: ItemFact[]
  /** known tasks that came back (fields as One has them) */
  kept: ItemFact[]
  /** known outermost tasks that did not come back */
  removed: ItemFact[]
  /** itemIds of kept tasks whose title / notes differ from `known` (hold 'assigned' when they have people) */
  keptChanged: string[]
  /** the ids of the new tasks, document order (staging: minted; apply: = ctx.ids prefix) */
  ids: string[]
  /** apply: ctx.ids in use elsewhere by now — the caller fails the change */
  idTaken: string[]
  handles: Record<string, string>
  /** `Blocks:` onto EXISTING tasks (D12) */
  blocks: Array<{ itemId: string; add: string[] }>
  /** other staged changes whose new tasks this write links (→ StagedChange.needs, D16) */
  needs: string[]
  /** titles of known tasks whose field line differed (invariant 3) */
  fieldsIgnored: string[]
  /** new person mentions (hold 'names') — counted in claudeSettled step 5 */
  mentionsAdded: number
  /** per new task (↔ ids): the people and links it got — staging stores them, apply writes exactly these */
  pins: ItemPin[]
  warnings: SettleWarning[]
}

/** The people and links one new task got, with the names / titles shown when they were resolved. */
export interface ItemPin {
  people: Array<{ id: string; name: string }>
  blockedBy: Array<{ id: string; title: string }>
  related: Array<{ id: string; title: string }>
}

/** What is wrong with a strict write — model-facing English; the tool appends "Nothing was staged." */
export class SettleRefusal extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SettleRefusal'
  }
}

export const MAX_NEW_ITEMS = 100
/** Existing tasks one write may change: update_work_item's entries per call, a write's `Blocks:` targets. */
export const MAX_ITEM_UPDATES = 50

export interface SettleWorld {
  now(): number
  canCreate(): boolean
  newItemId(): string
  /** Workspace.people (team: members are mirrored there by account id) */
  people(): ReadonlyArray<{ id: string; name: string }>
  /** folded email → account id; null = the team's member list is not loaded yet (local: empty — no emails there) */
  memberEmails(): ReadonlyMap<string, string> | null
  /** team: the signed-in member · local: localPerson() · null: nobody */
  me(): string | null
  /** the index winner (live, not template, not trash) */
  entry(itemId: string): { itemId: string; pageId: ID; title: string; private: boolean; people: readonly string[]; blockedBy: readonly string[] } | null
  /** any page holds this id */
  taken(itemId: string): boolean
  /** folded title → itemIds of live winners (built lazily, only when a title ref exists) */
  titles(): ReadonlyMap<string, readonly string[]>
  /** itemIds inside the blocks `limit` lets Claude read on `pageId` (memoised per world instance — one walk per page) */
  readableItems(pageId: ID, limit: SettleReadLimit): ReadonlySet<string>
  /** same Markdown for two blocks (P0 keepItems comparator: blockMarkdown) */
  sameBlock(a: JSONContent, b: JSONContent): boolean
  /** a page's title (the ambiguous-link refusal names where each candidate is) */
  pageTitle(pageId: ID): string
}

/** A title / name as compared: NFKC, lower case, whitespace collapsed. */
export const foldTitle = (s: string): string => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()

/** Names Claude may see in a refusal: ≤ 50, sorted, never an email. */
function namesList(world: SettleWorld): string {
  const names = [...new Set(world.people().map((p) => p.name.replace(/\s+/g, ' ').trim()))].filter((n) => n && !n.includes('@')).sort((a, b) => a.localeCompare(b))
  if (!names.length) return 'none'
  const shown = names.slice(0, 50).map((n) => `"${n}"`)
  return names.length > 50 ? `${shown.join(', ')} …` : shown.join(', ')
}

/** Model-facing English for a warning (tool results: "Left out: …"). */
export function warningText(w: SettleWarning): string {
  const task = w.task ? ` (task "${w.task}")` : ''
  const v = w.value ?? ''
  switch (w.code) {
    case 'person':
      return `"${v}" is no person in this workspace — left out${task}.`
    case 'personAmbiguous':
      return `"${v}" fits more than one person — left out${task}.`
    case 'members':
      return `The member list is still loading — an email was left out${task}.`
    case 'date':
      return `"${v}" is no date — no due date${task}.`
    case 'status':
      return `"${v}" is no status — left open${task}.`
    case 'reminder':
      return `"${v}" is no reminder (or there is no due date) — left out${task}.`
    case 'dateReminder':
      return `A date's reminder was left out — only reminders already on the page stay.`
    case 'link':
      return `"${v}" is no task this may point at — left out${task}.`
    case 'linkAmbiguous':
      return `"${v}" fits more than one task — left out${task}.`
    case 'loop':
      return `A link would make a loop — left out${task}.`
    case 'self':
      return `A task can't wait for itself — left out${task}.`
    case 'scope':
      return `A shared task can't wait for a private one — left out${task}.`
    case 'blocks':
      return `"Blocks" on an existing task needs its own change — left out${task}.`
    case 'fields':
      return `Fields of "${w.task}" change only through update_work_item — its field line was not used.`
    case 'fieldKey':
      return `"${v}" is no task field — that line stayed text${task}.`
    case 'gate':
      return `Tasks can't be made here right now — they stay quotes.`
    case 'nested':
      return `A task inside a task (or a table) was moved after it${task}.`
    case 'cap':
      return `More than the limit (12 people, 20 links) — the rest was left out${task}.`
    case 'copy':
      return `"${w.task}" copies a task from elsewhere — it became a new task with its own id.`
    case 'exists':
      return `"${w.task}" is a task already — left out.`
    case 'title':
      return `A task without a title stays text.`
    case 'tooMany':
      return `More than ${MAX_NEW_ITEMS} new tasks — the rest stays text.`
    case 'meAgent':
      return `An agent names the person — "me" was left out${task}.`
  }
}

/* ------------------------------------------------------------------ helpers */

const inlineText = (inline: readonly JSONContent[]): string =>
  inline
    .map((n) => (n.type === 'text' ? (n.text ?? '') : n.type === 'hardBreak' ? ' ' : n.type === 'mention' ? `@${String(n.attrs?.label ?? '')}` : ''))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140)

const refText = (r: RefDraft): string => ('id' in r ? r.id : 'handle' in r ? `#${r.handle}` : r.title)

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x))

interface Draft {
  node: JSONContent
  draft: ClaudeItemDraft
  title: string
  /** new: `n` = its place among the write's new tasks (ids[n], pins[n]) */
  decision: { kind: 'quote' } | { kind: 'drop' } | { kind: 'restore'; old: JSONContent } | { kind: 'new'; itemId: string; n: number }
  /** new: its resolved fields */
  fields?: { status: WorkItemStatus; due: string | null; reminder: string | null; people: string[]; doneAt: number | null; blockedBy: string[]; related: string[] }
  built?: JSONContent
}

/** Every `[!TODO]` quote of a doc, pre-order (document order), with its draft — iterative. */
function draftsOf(doc: JSONContent): Draft[] {
  const out: Draft[] = []
  const stack: JSONContent[] = [doc]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === 'blockquote') {
      const draft = readClaudeQuote(n)
      if (draft) out.push({ node: n, draft, title: inlineText(draft.title), decision: { kind: 'quote' } })
    }
    if (n.type === 'codeBlock' || !Array.isArray(n.content)) continue
    for (let i = n.content.length - 1; i >= 0; i--) {
      const c = n.content[i]
      if (c && typeof c === 'object' && Array.isArray(c.content)) stack.push(c)
    }
  }
  return out
}

/** Every task node of a doc with its itemId, document order (synced references too — what the doc shows). */
function tasksOf(doc: JSONContent | null | undefined): Array<{ id: string; node: JSONContent }> {
  const out: Array<{ id: string; node: JSONContent }> = []
  if (!doc) return out
  const stack: JSONContent[] = [doc]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === WORK_ITEM) {
      const id = itemAttrs(n).itemId
      if (id) out.push({ id, node: n })
    }
    if (!Array.isArray(n.content)) continue
    for (let i = n.content.length - 1; i >= 0; i--) {
      const c = n.content[i]
      if (c && typeof c === 'object' && Array.isArray(c.content)) stack.push(c)
    }
  }
  return out
}

/**
 * `known` without the tasks of synced REFERENCES (their cached copy of the original's blocks): those tasks are the
 * original page's — written back with their id they are a copy (a new id) or left out, never this page's task again.
 * Iterative; the same object back when it holds no reference.
 */
function withoutRefTasks(doc: JSONContent): JSONContent {
  type Frame = { n: JSONContent; i: number; out: JSONContent[] | null }
  const stack: Frame[] = [{ n: doc, i: 0, out: null }]
  let result = doc
  while (stack.length) {
    const f = stack[stack.length - 1]
    const kids = Array.isArray(f.n.content) ? f.n.content : null
    if (kids && f.i < kids.length) {
      const c = kids[f.i++]
      if (c && typeof c === 'object' && isSyncedRef(c) && Array.isArray(c.content) && c.content.length) {
        if (!f.out) f.out = kids.slice(0, f.i - 1)
        f.out.push({ ...c, content: [] })
        continue
      }
      if (c && typeof c === 'object' && Array.isArray(c.content) && c.type !== 'paragraph' && c.type !== 'heading') {
        stack.push({ n: c, i: 0, out: null })
        continue
      }
      if (f.out) f.out.push(c)
      continue
    }
    stack.pop()
    const node = f.out ? { ...f.n, content: f.out } : f.n
    const parent = stack[stack.length - 1]
    if (!parent) {
      result = node
      break
    }
    if (node !== f.n && !parent.out) parent.out = (parent.n.content as JSONContent[]).slice(0, parent.i - 1)
    if (parent.out) parent.out.push(node)
  }
  return result
}

/** P0 restore semantics: a quote's title + notes into a known task (blocks that read the same stay One's own). */
function restoreInto(draft: ClaudeItemDraft, old: JSONContent, same: (a: JSONContent, b: JSONContent) => boolean): JSONContent {
  const [oldTitle, ...oldNotes] = old.content ?? []
  const title: JSONContent = { type: 'paragraph', ...(draft.title.length ? { content: draft.title } : {}) }
  const notes = draft.notes.map((n, i) => (oldNotes[i] && same(oldNotes[i], n) ? oldNotes[i] : n))
  const keepTitle = oldTitle?.type === 'paragraph' && same(oldTitle, title)
  return { ...old, content: [keepTitle ? oldTitle : { ...(oldTitle?.type === 'paragraph' && oldTitle.attrs ? { attrs: oldTitle.attrs } : {}), ...title }, ...notes] }
}

/** Did Claude's text change a known task's title or notes? */
function textChanged(now: JSONContent, old: JSONContent, same: (a: JSONContent, b: JSONContent) => boolean): boolean {
  const a = now.content ?? []
  const b = old.content ?? []
  return a.length !== b.length || a.some((x, i) => x !== b[i] && !same(x, b[i]))
}

/* ------------------------------------------------------------------ people */

/** A person as Claude names one in a tool input (update_work_item, list_work_items): an id, "me", an email or a name. */
export function personDraftOf(text: string, world: Pick<SettleWorld, 'people'>): PersonDraft {
  const s = text.replace(/\s+/g, ' ').trim()
  if (/^(me|ich)$/i.test(s)) return { me: true }
  if (world.people().some((p) => p.id === s)) return { id: s }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return { email: s }
  return { raw: s }
}

export type PersonHit = { id: string } | { message: string; code: SettleWarningCode; value: string }

/**
 * People as the gate resolves them — existing ones only (never created): by id, folded exact unique name, a member's
 * email (never named back to Claude), "me" (`me` false: custom agents — they name the person). One per write: its
 * name map is built once.
 */
export function peopleResolver(world: SettleWorld, me: boolean): { name: (id: string) => string | null; resolve: (p: PersonDraft, task: string) => PersonHit } {
  let byId: Map<string, string> | null = null
  let byName: Map<string, string[]> | null = null
  const name = (id: string): string | null => (byId ??= new Map(world.people().map((p) => [p.id, p.name]))).get(id) ?? null
  const where = (task: string) => (task ? ` in task "${task}"` : '')
  const resolve = (p: PersonDraft, task: string): PersonHit => {
    if ('id' in p) return name(p.id) !== null ? { id: p.id } : { message: `Unknown person id "${p.id}"${where(task)}. People in this workspace: ${namesList(world)}. One never creates people.`, code: 'person', value: p.id }
    if ('me' in p) {
      if (!me) return { message: `"me" means nobody for an agent — name the person${where(task)}.`, code: 'meAgent', value: 'me' }
      const id = world.me()
      return id && name(id) !== null ? { id } : { message: `"me" is nobody in this workspace${task ? ` (task "${task}")` : ''}. People in this workspace: ${namesList(world)}.`, code: 'person', value: 'me' }
    }
    if ('email' in p) {
      const emails = world.memberEmails()
      if (emails === null) return { message: 'The member list is still loading — name the person instead.', code: 'members', value: 'email' }
      const id = emails.get(p.email.trim().toLowerCase())
      // never an email back to Claude: it may come from text nobody vouches for
      return id && name(id) !== null
        ? { id }
        : { message: `An email${where(task)} is no member's. People in this workspace: ${namesList(world)}. One never creates people: use one of these names, or leave Owner out.`, code: 'person', value: 'email' }
    }
    if (!byName) {
      byName = new Map()
      for (const x of world.people()) {
        const k = foldTitle(x.name)
        byName.set(k, [...(byName.get(k) ?? []), x.id])
      }
    }
    const hits = byName.get(foldTitle(p.raw)) ?? []
    if (hits.length === 1) return { id: hits[0] }
    if (hits.length > 1) return { message: `"${p.raw}" fits more than one person${where(task)}. Copy a person link from text you read ([@Name](one:person/<id>)), or leave Owner out.`, code: 'personAmbiguous', value: p.raw }
    return { message: `Unknown person "${p.raw}"${where(task)}. People in this workspace: ${namesList(world)}. One never creates people: use one of these names, or leave Owner out.`, code: 'person', value: p.raw }
  }
  return { name, resolve }
}

/* ------------------------------------------------------------------ the gate */

export function settleDoc(input: JSONContent, ctx: SettleContext, world: SettleWorld): { doc: JSONContent; report: SettleReport } {
  const report: SettleReport = { created: [], kept: [], removed: [], keptChanged: [], ids: [], idTaken: [], handles: {}, blocks: [], needs: [], fieldsIgnored: [], mentionsAdded: 0, pins: [], warnings: [] }
  const problems: string[] = []
  const warn = (code: SettleWarningCode, task: string, value?: string) => {
    if (!report.warnings.some((w) => w.code === code && w.task === task && w.value === value)) report.warnings.push({ code, task, ...(value !== undefined ? { value } : {}) })
  }
  /** strict: a refusal (Claude fixes the call); else a warning and the value is left out */
  const fail = (message: string, code: SettleWarningCode, task: string, value?: string) => {
    if (ctx.strict) {
      if (!problems.includes(message)) problems.push(message)
    } else warn(code, task, value)
  }

  /* ---------- people ---------- */
  const people = peopleResolver(world, ctx.me)
  const personName = people.name
  /** a person draft → an existing person's id, or null (refused / warned); `quiet`: no refusal (field compare) */
  const resolvePerson = (p: PersonDraft, task: string, quiet = false): string | null => {
    const r = people.resolve(p, task)
    if ('id' in r) return r.id
    if (!quiet) fail(r.message, r.code, task, r.value)
    return null
  }

  /* ---------- scope ---------- */
  const scopeOk = (e: { itemId: string; pageId: ID }): boolean => {
    if (ctx.visible && ctx.visible(e.pageId) === false) return false
    const lim = ctx.readLimit?.(e.pageId) ?? null
    if (!lim) return true
    if (lim.mode === 'none') return false
    return world.readableItems(e.pageId, lim).has(e.itemId)
  }

  /* ---------- 1. known tasks come back (keepItems), field lines compared ---------- */
  // a synced reference's tasks are the original page's: never known here (withoutRefTasks)
  const known = ctx.known ? withoutRefTasks(ctx.known) : null
  const knownTasks = tasksOf(known)
  const knownById = new Map<string, JSONContent>()
  for (const k of knownTasks) if (!knownById.has(k.id)) knownById.set(k.id, k.node)
  /** the parsed fields of a written-back field line differ from the task's own */
  const fieldsDiffer = (d: ClaudeItemDraft, a: WorkItemAttrs): boolean => {
    if (!d.fieldLine && !d.fieldKey) return false
    if (d.fieldKey) return true
    const status = d.status ?? 'todo'
    if (typeof status !== 'string' || status !== a.status) return true
    const due = d.due ?? null
    if ((due !== null && typeof due !== 'string') || due !== a.due) return true
    const reminder = d.reminder ?? null
    if ((reminder !== null && typeof reminder !== 'string') || (a.due && reminder !== a.reminder)) return true
    const people = (d.people ?? []).map((p) => resolvePerson(p, '', true))
    if (people.some((p) => p === null) || !sameSet(people as string[], a.people)) return true
    for (const [key, list] of [['blockedBy', d.blockedBy], ['related', d.related]] as const) {
      const ids = (list ?? []).map((r) => ('id' in r ? r.id : null))
      if (ids.some((x) => x === null) || !sameSet(ids as string[], a[key])) return true
    }
    return !!d.blocks?.length
  }
  let doc = input
  if (known && knownById.size) {
    for (const d of draftsOf(doc)) {
      const old = d.draft.itemId ? knownById.get(d.draft.itemId) : undefined
      if (old && fieldsDiffer(d.draft, itemAttrs(old)) && !report.fieldsIgnored.includes(d.title)) {
        report.fieldsIgnored.push(d.title)
        warn('fields', d.title)
      }
    }
    doc = keepItems(doc, known, world.sameBlock)
  }

  /* ---------- 2. the remaining quotes: identity ---------- */
  const drafts = draftsOf(doc)
  const cameBack = new Set(tasksOf(doc).map((x) => x.id))
  // keepSingle: the one task replaced, written back without its id
  if (ctx.keepSingle && known) {
    const missing = outermostItems(known.content).filter((n) => {
      const id = itemAttrs(n).itemId
      return id && !cameBack.has(id)
    })
    const loose = drafts.filter((d) => !d.draft.itemId || !knownById.has(d.draft.itemId))
    if (missing.length === 1 && loose.length === 1) {
      const d = loose[0]
      d.decision = { kind: 'restore', old: missing[0] }
      cameBack.add(itemAttrs(missing[0]).itemId!)
      if (fieldsDiffer(d.draft, itemAttrs(missing[0])) && !report.fieldsIgnored.includes(d.title)) {
        report.fieldsIgnored.push(d.title)
        warn('fields', d.title)
      }
    }
  }
  const handles = new Map<string, string>()
  const newById = new Map<string, Draft>()
  // a replaced text's tasks: the id of the earlier task with the same handle, else the same title (each once)
  const reused = new Map<Draft, string>()
  if (ctx.reuse?.length && !ctx.ids) {
    const left = [...ctx.reuse]
    const loose = drafts.filter((d) => d.decision.kind !== 'restore')
    for (const d of loose) {
      if (!d.draft.handle) continue
      const i = left.findIndex((r) => r.handle === d.draft.handle)
      if (i >= 0) reused.set(d, left.splice(i, 1)[0].itemId)
    }
    for (const d of loose) {
      if (reused.has(d) || !d.title) continue
      const i = left.findIndex((r) => foldTitle(r.title) === foldTitle(d.title))
      if (i >= 0) reused.set(d, left.splice(i, 1)[0].itemId)
    }
  }
  let count = 0
  let gateShut: boolean | null = null
  for (const d of drafts) {
    if (d.decision.kind === 'restore') continue
    const { draft } = d
    if (draft.fieldKey) warn('fieldKey', d.title, draft.fieldKey)
    let copy = false
    if (draft.itemId && (knownById.has(draft.itemId) || world.entry(draft.itemId))) {
      if (ctx.existing === 'skip') {
        d.decision = { kind: 'drop' }
        warn('exists', d.title)
        continue
      }
      copy = true
    }
    if (!ctx.creates) continue
    if ((gateShut ??= !world.canCreate())) {
      warn('gate', '')
      continue
    }
    if (!d.title) {
      warn('title', '')
      continue
    }
    if (count >= MAX_NEW_ITEMS) {
      fail(`More than ${MAX_NEW_ITEMS} new tasks in one write — split it into several.`, 'tooMany', '')
      continue
    }
    const n = count++
    let itemId: string
    if (ctx.ids) {
      if (n >= ctx.ids.length) {
        warn('tooMany', '')
        continue
      }
      itemId = ctx.ids[n]
      if (!ctx.preview && world.taken(itemId)) {
        report.idTaken.push(itemId)
        continue
      }
    } else {
      const first = ctx.firstIds?.[n] ?? reused.get(d)
      itemId = first && !world.taken(first) && !newById.has(first) ? first : world.newItemId()
    }
    if (copy) warn('copy', d.title)
    d.decision = { kind: 'new', itemId, n }
    newById.set(itemId, d)
    report.ids.push(itemId)
    if (draft.handle) {
      if (handles.has(draft.handle)) fail(`The handle #${draft.handle} is declared twice — give each new task its own.`, 'link', d.title, `#${draft.handle}`)
      else handles.set(draft.handle, itemId)
    }
  }
  const fresh = drafts.filter((d) => d.decision.kind === 'new')
  /** the tool loops (terminal, agents, MCP) stage `Blocks:` onto existing tasks; the AI menu and Transform leave it out (said so) */
  const stages = ctx.source !== 'menu' && ctx.source !== 'transform'
  /** apply: what staging resolved for this new task (null: resolve the text — staging, a one-shot path, an older change) */
  const pinOf = (d: Draft): ItemPin | null => (ctx.ids && ctx.pins ? (ctx.pins[(d.decision as { n: number }).n] ?? null) : null)

  /* ---------- 3. fields of the new tasks ---------- */
  for (const d of fresh) {
    const { draft, title } = d
    const pin = pinOf(d)
    let status: WorkItemStatus = 'todo'
    if (draft.status !== undefined) {
      if (typeof draft.status === 'string') status = draft.status
      else fail(`"${draft.status.raw}" is no status in task "${title}". Use todo, in progress or done.`, 'status', title, draft.status.raw)
    }
    let due: string | null = null
    if (draft.due !== undefined) {
      if (typeof draft.due === 'string') due = draft.due
      else fail(`"${draft.due.raw}" is no date in task "${title}". Write YYYY-MM-DD or YYYY-MM-DDTHH:mm.`, 'date', title, draft.due.raw)
    }
    let reminder: string | null = null
    if (draft.reminder !== undefined) {
      if (typeof draft.reminder !== 'string') fail(`"${draft.reminder.raw}" is no reminder in task "${title}". Use at, -15m, -1h, -1d or -1w.`, 'reminder', title, draft.reminder.raw)
      else if (!due) fail(`Task "${title}" has a reminder but no due date — a reminder needs "Due:".`, 'reminder', title, draft.reminder)
      else reminder = draft.reminder
    }
    const people: string[] = []
    // apply: the people staging resolved — never a name resolved again (someone else may carry it by now)
    for (const p of pin?.people ?? []) {
      if (personName(p.id) === null) warn('person', title, p.name)
      else if (!people.includes(p.id) && people.length < MAX_PEOPLE) people.push(p.id)
    }
    for (const p of pin ? [] : (draft.people ?? [])) {
      const id = resolvePerson(p, title)
      if (!id || people.includes(id)) continue
      if (people.length >= MAX_PEOPLE) {
        warn('cap', title)
        break
      }
      people.push(id)
    }
    d.fields = { status, due, reminder, people, doneAt: status === 'done' ? world.now() : null, blockedBy: [], related: [] }
  }

  /* ---------- 4. links ---------- */
  const keptIds = new Set(cameBack)
  const writeTitles = new Map<string, string[]>()
  for (const d of fresh) {
    const k = foldTitle(d.title)
    writeTitles.set(k, [...(writeTitles.get(k) ?? []), (d.decision as { itemId: string }).itemId])
  }
  const needs = new Set<string>()
  const usedHandles = new Map<string, string>()
  type Hit = { id: string; kind: 'new' | 'staged' | 'live'; private: boolean } | { miss: 'link' | 'linkAmbiguous' | 'scope'; value: string; candidates?: string }
  const entryInScope = (id: string) => {
    const e = world.entry(id)
    return e && scopeOk(e) ? e : null
  }
  const classify = (id: string, label: string): Hit => {
    if (newById.has(id)) return { id, kind: 'new', private: ctx.private }
    const st = ctx.staged?.get(id)
    if (st) {
      // a task this change's earlier text made that this text no longer makes: it will not exist
      if (st.change && st.change === (ctx.change ?? null)) return { miss: 'link', value: label }
      if (!ctx.private && st.private) return { miss: 'scope', value: label }
      if (st.change && st.change !== (ctx.change ?? null)) needs.add(st.change)
      return { id, kind: 'staged', private: st.private }
    }
    if (keptIds.has(id) && !world.entry(id)) return { id, kind: 'live', private: ctx.private }
    const e = entryInScope(id)
    if (!e) return { miss: 'link', value: label }
    if (!ctx.private && e.private) return { miss: 'scope', value: label }
    return { id, kind: 'live', private: e.private }
  }
  const resolveTitle = (title: string): Hit | null => {
    const key = foldTitle(title)
    const mine = writeTitles.get(key) ?? []
    if (mine.length === 1) return { id: mine[0], kind: 'new', private: ctx.private }
    if (mine.length > 1) return { miss: 'linkAmbiguous', value: title, candidates: mine.map((id) => `"${newById.get(id)!.title}" (new in this write)`).join(', ') }
    const all = world.titles().get(key) ?? []
    const inScope = all.map((id) => entryInScope(id)).filter((e): e is NonNullable<typeof e> => !!e)
    const allowed = inScope.filter((e) => ctx.private || !e.private)
    if (allowed.length === 1) return classify(allowed[0].itemId, title)
    if (allowed.length > 1) return { miss: 'linkAmbiguous', value: title, candidates: allowed.slice(0, 8).map((e) => `${e.itemId} "${e.title}" on "${world.pageTitle(e.pageId)}"`).join(', ') }
    if (inScope.length) return { miss: 'scope', value: title }
    return null
  }
  /** a ref list → hits (whole title values first, their parts only when the whole one does not resolve) */
  const resolveRefs = (refs: readonly RefDraft[], task: string): Array<Extract<Hit, { id: string }>> => {
    const out: Array<Extract<Hit, { id: string }>> = []
    let skipParts = false
    for (const r of refs) {
      let hit: Hit | null
      if ('title' in r && r.whole) {
        hit = resolveTitle(r.title)
        skipParts = !!hit && 'id' in hit
        if (!skipParts) continue
      } else if ('title' in r) {
        if (skipParts) continue
        hit = resolveTitle(r.title) ?? { miss: 'link', value: r.title }
      } else {
        skipParts = false
        if ('handle' in r) {
          const id = handles.get(r.handle) ?? ctx.handles?.get(r.handle)
          if (id && !handles.has(r.handle)) usedHandles.set(r.handle, id)
          hit = id ? classify(id, `#${r.handle}`) : { miss: 'link', value: `#${r.handle}` }
        } else hit = classify(r.id, r.id)
      }
      const h = hit
      if (!h) continue
      if ('id' in h) {
        if (!out.some((x) => x.id === h.id)) out.push(h)
        continue
      }
      if (h.miss === 'scope') warn('scope', task)
      else if (h.miss === 'linkAmbiguous') fail(`"${h.value}" in task "${task}" fits more than one task: ${h.candidates}. Use the task id (wi_…).`, 'linkAmbiguous', task, h.value)
      else fail(`No task "${h.value}" that task "${task}" may point at. Use a task id (wi_…) you read, a #handle declared in this write, or an exact task title.`, 'link', task, h.value)
    }
    return out
  }
  /** apply: the links staging resolved, by id — gone, out of scope or no longer staged → left out (a warning) */
  const pinnedRefs = (list: ItemPin['blockedBy'], task: string): Array<Extract<Hit, { id: string }>> => {
    const out: Array<Extract<Hit, { id: string }>> = []
    for (const r of list) {
      const h = classify(r.id, r.title)
      if ('id' in h) {
        if (!out.some((x) => x.id === h.id)) out.push(h)
      } else if (h.miss === 'scope') warn('scope', task)
      else warn('link', task, r.title)
    }
    return out
  }
  // the overlay graph: live blockedBy edges + the pending changes' (other staged tasks, staged link changes) + this write's
  const added = new Map<string, string[]>()
  const overlay = {
    byId: {
      get: (v: string) => {
        const live = world.entry(v)?.blockedBy ?? []
        const pending = ctx.pendingEdges?.get(v) ?? []
        const mine = added.get(v) ?? []
        return live.length || mine.length || pending.length ? { attrs: { blockedBy: [...mine, ...pending, ...live] } } : undefined
      },
    },
  } as unknown as Parameters<typeof wouldLoop>[0]
  const addEdge = (from: string, to: string) => added.set(from, [...(added.get(from) ?? []), to])
  const blocks = new Map<string, string[]>()
  for (const d of fresh) {
    const self = (d.decision as { itemId: string }).itemId
    const f = d.fields!
    const pin = pinOf(d)
    for (const hit of pin ? pinnedRefs(pin.blockedBy, d.title) : resolveRefs(d.draft.blockedBy ?? [], d.title)) {
      if (hit.id === self) {
        warn('self', d.title)
        continue
      }
      if (f.blockedBy.includes(hit.id)) continue
      if (f.blockedBy.length >= MAX_LINKS) {
        warn('cap', d.title)
        break
      }
      if (wouldLoop(overlay, self, hit.id)) {
        warn('loop', d.title)
        continue
      }
      f.blockedBy.push(hit.id)
      addEdge(self, hit.id)
    }
    for (const hit of pin ? pinnedRefs(pin.related, d.title) : resolveRefs(d.draft.related ?? [], d.title)) {
      if (hit.id === self) {
        warn('self', d.title)
        continue
      }
      if (f.related.includes(hit.id)) continue
      if (f.related.length >= MAX_LINKS) {
        warn('cap', d.title)
        break
      }
      f.related.push(hit.id)
    }
  }
  // Blocks: a new target waits for this task; an existing one gets its own change — staged by the tool loops (the
  // terminal, agents, MCP), left out with a warning where nothing stages it (the AI menu, Transform). At most MAX_LINKS
  // per task, MAX_ITEM_UPDATES existing tasks per write. Apply: the targets' own pins hold it already.
  for (const d of fresh) {
    if (pinOf(d)) continue
    const self = (d.decision as { itemId: string }).itemId
    let n = 0
    for (const hit of resolveRefs(d.draft.blocks ?? [], d.title)) {
      if (hit.id === self) {
        warn('self', d.title)
        continue
      }
      if (n >= MAX_LINKS) {
        warn('cap', d.title)
        break
      }
      if (hit.kind !== 'new' && ctx.private && !hit.private) {
        // a shared task would wait for a private one
        warn('scope', d.title)
        continue
      }
      if (hit.kind !== 'new' && !stages) {
        warn('blocks', d.title)
        continue
      }
      if (wouldLoop(overlay, hit.id, self)) {
        warn('loop', d.title)
        continue
      }
      if (hit.kind === 'new') {
        const target = newById.get(hit.id)!.fields!
        if (target.blockedBy.includes(self)) continue
        if (target.blockedBy.length >= MAX_LINKS) {
          warn('cap', d.title)
          continue
        }
        target.blockedBy.push(self)
      } else {
        if (!blocks.has(hit.id) && blocks.size >= MAX_ITEM_UPDATES) {
          fail(`"Blocks" in task "${d.title}" reaches more than ${MAX_ITEM_UPDATES} existing tasks in this write — split it over several writes, or use update_work_item.`, 'cap', d.title)
          break
        }
        const list = blocks.get(hit.id) ?? []
        if (list.includes(self)) continue
        blocks.set(hit.id, [...list, self])
      }
      n++
      addEdge(hit.id, self)
    }
  }
  if (problems.length) throw new SettleRefusal(problems.slice(0, 8).join('\n'))

  /* ---------- 5. build (bottom-up, iterative): quotes → tasks, the rest shared ---------- */
  const byNode = new Map<JSONContent, Draft>()
  for (const d of drafts) byNode.set(d.node, d)
  type Frame = { n: JSONContent; i: number; out: JSONContent[] | null; banned: boolean }
  const isContainer = (n: JSONContent) => {
    if (n.type === WORK_ITEM || n.type === 'table') return true
    const d = byNode.get(n)
    return !!d && (d.decision.kind === 'new' || d.decision.kind === 'restore')
  }
  const stack: Frame[] = [{ n: doc, i: 0, out: null, banned: false }]
  let result: JSONContent = doc
  while (stack.length) {
    const f = stack[stack.length - 1]
    const kids = Array.isArray(f.n.content) && f.n.type !== 'codeBlock' ? f.n.content : null
    if (kids && f.i < kids.length) {
      const c = kids[f.i++]
      if (c && typeof c === 'object' && Array.isArray(c.content) && c.type !== 'paragraph' && c.type !== 'heading') {
        stack.push({ n: c, i: 0, out: null, banned: f.banned || isContainer(f.n) })
        continue
      }
      if (f.out) f.out.push(c)
      continue
    }
    stack.pop()
    let node: JSONContent | null = f.out ? { ...f.n, content: f.out } : f.n
    const d = byNode.get(f.n)
    if (d && d.decision.kind !== 'quote') {
      if (d.decision.kind === 'drop') node = null
      else {
        // read the rebuilt quote again: its notes carry the decisions made inside it
        const now = node === f.n ? d.draft : (readClaudeQuote(node!) ?? d.draft)
        if (d.decision.kind === 'restore') node = restoreInto(now, d.decision.old, world.sameBlock)
        else {
          const fl = d.fields!
          const attrs = itemAttrs({ itemId: d.decision.itemId, status: fl.status, due: fl.due, reminder: fl.reminder, people: fl.people, blockedBy: fl.blockedBy, related: fl.related, doneAt: fl.doneAt })
          node = { type: WORK_ITEM, attrs: storedItemAttrs({ ...attrs, id: null }), content: [{ type: 'paragraph', ...(now.title.length ? { content: now.title } : {}) }, ...now.notes] }
          if (f.banned) warn('nested', d.title)
        }
        d.built = node
      }
    }
    const parent = stack[stack.length - 1]
    if (!parent) {
      result = node ?? { type: 'doc', content: [{ type: 'paragraph' }] }
      break
    }
    if (node !== f.n && !parent.out) parent.out = (parent.n.content as JSONContent[]).slice(0, parent.i - 1)
    if (parent.out && node) parent.out.push(node)
  }

  /* ---------- 6. the report ---------- */
  const handleOf = new Map<string, string>()
  for (const [h, id] of handles) handleOf.set(id, h)
  for (const [h, id] of usedHandles) if (!handleOf.has(id)) handleOf.set(id, h)
  for (const [h, id] of ctx.handles ?? []) if (!handleOf.has(id)) handleOf.set(id, h)
  const factWorld: FactWorld = {
    person: personName,
    ref: (itemId): ItemRefFact => {
      const mine = newById.get(itemId)
      const handle = handleOf.get(itemId)
      if (mine) return { itemId, title: mine.title, isNew: true, inScope: true, ...(handle ? { handle } : {}) }
      if (ctx.staged?.has(itemId)) return { itemId, title: null, isNew: true, inScope: true, ...(handle ? { handle } : {}) }
      const e = world.entry(itemId)
      return { itemId, title: e?.title ?? null, isNew: false, inScope: !!e && scopeOk(e) && (ctx.private || !e.private) }
    },
  }
  const finalTasks = tasksOf(result)
  const seen = new Set<string>()
  // what the document really holds (a new task inside a quote left out went with it), document order
  for (const t of finalTasks) {
    if (!newById.has(t.id) || seen.has(t.id)) continue
    seen.add(t.id)
    report.created.push(factsOfNode(t.node, factWorld, { tag: 'new', handle: handleOf.get(t.id) ?? null }))
  }
  for (const t of finalTasks) {
    const old = knownById.get(t.id)
    if (!old || seen.has(t.id)) continue
    seen.add(t.id)
    report.kept.push(factsOfNode(t.node, factWorld, { tag: 'kept' }))
    if (textChanged(t.node, old, world.sameBlock)) report.keptChanged.push(t.id)
  }
  if (known) {
    const present = new Set(finalTasks.map((t) => t.id))
    for (const n of outermostItems(known.content)) {
      const id = itemAttrs(n).itemId
      if (id && !present.has(id)) report.removed.push(factsOfNode(n, factWorld, { tag: 'removed' }))
    }
  }
  report.blocks = [...blocks].map(([itemId, add]) => ({ itemId, add }))
  // per new task (↔ report.ids): what it got, for apply to write exactly that
  const refTitle = (id: string) => newById.get(id)?.title ?? world.entry(id)?.title ?? id
  report.pins = fresh.map((d) => {
    const f = d.fields!
    return {
      people: f.people.map((id) => ({ id, name: personName(id) ?? id })),
      blockedBy: f.blockedBy.map((id) => ({ id, title: refTitle(id) })),
      related: f.related.map((id) => ({ id, title: refTitle(id) })),
    }
  })
  report.needs = [...needs]
  report.handles = Object.fromEntries([...handles, ...usedHandles])
  return { doc: result, report }
}
