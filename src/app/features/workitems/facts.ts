/**
 * Task facts — what a review shows of a task Claude makes, keeps, changes or removes (the terminal's and agents'
 * cards, the MCP approval card, the AI menu's strip) and what a tool result tells Claude. Pure: the caller passes what
 * a fact needs to know (names, linked tasks) and, for the UI line, the translator.
 *
 *  - factsOfNode(json, world, opts): a task node's facts (title ≤ 140, fields, people with names, linked tasks).
 *  - factLine(fact, lang, t): one line in the UI's language ("Ship pricing · Owner Alex · Due Fri 17 Oct · −1 d ·
 *      Blocked by Draft copy").
 *  - factLineEn(fact, inScope?): one line for Claude (English; a linked task outside the writer's scope by id only —
 *      never its title).
 */
import type { JSONContent } from '@tiptap/core'
import type { Lang } from '@/shared/i18n'
import type { ID } from '../../store/types'
import { itemAttrs, type WorkItemStatus } from '../../editor/workitem/attrs'
import { itemTitleText } from '../../editor/workitem/text'
import { dueText, reminderShort } from '../../editor/workitem/format'

type T = (key: string, vars?: Record<string, string | number>) => string

/** A linked task as a fact: `title` null when unknown here (a task staged elsewhere, gone); `inScope` false → by id only. */
export interface ItemRefFact {
  itemId: string
  title: string | null
  /** made by this write or a pending change (not in the workspace yet) */
  isNew: boolean
  handle?: string
  inScope: boolean
}

export interface ItemFact {
  itemId: string
  handle: string | null
  tag: 'new' | 'kept' | 'changed' | 'removed'
  /** itemTitleText, ≤ 140 */
  title: string
  status: WorkItemStatus
  due: string | null
  reminder: string | null
  people: Array<{ id: string; name: string }>
  blockedBy: ItemRefFact[]
  related: ItemRefFact[]
  /** changed / removed / list */
  page?: { id: ID; title: string }
  /** tag 'changed': the fields before */
  before?: Pick<ItemFact, 'status' | 'due' | 'reminder' | 'people' | 'blockedBy' | 'related'>
}

/** What a fact needs from outside: names and linked tasks as the writer sees them. */
export interface FactWorld {
  /** a person's name; null: no such person (the fact shows the id) */
  person(id: string): string | null
  /** a linked task as this write sees it */
  ref(itemId: string): ItemRefFact
}

/** A task node (TipTap JSON) → its facts. */
export function factsOfNode(json: JSONContent, world: FactWorld, opts: { tag: ItemFact['tag']; handle?: string | null; page?: { id: ID; title: string }; before?: ItemFact['before'] }): ItemFact {
  const a = itemAttrs(json)
  return {
    itemId: a.itemId ?? '',
    handle: opts.handle ?? null,
    tag: opts.tag,
    title: itemTitleText(json),
    status: a.status,
    due: a.due,
    reminder: a.reminder,
    people: a.people.map((id) => ({ id, name: world.person(id) ?? id })),
    blockedBy: a.blockedBy.map((id) => world.ref(id)),
    related: a.related.map((id) => world.ref(id)),
    ...(opts.page ? { page: opts.page } : {}),
    ...(opts.before ? { before: opts.before } : {}),
  }
}

/* ------------------------------------------------------------------ the UI's line */

const refLabel = (r: ItemRefFact, t: T): string => {
  const name = r.title ?? (r.handle ? `#${r.handle}` : r.itemId)
  return r.isNew ? `${name} · ${t('features.workItems.facts.newRef')}` : name
}

const sameRefs = (a: readonly ItemRefFact[], b: readonly ItemRefFact[]) => a.length === b.length && a.every((x, i) => x.itemId === b[i].itemId)
const samePeople = (a: ItemFact['people'], b: ItemFact['people']) => a.length === b.length && a.every((x, i) => x.id === b[i].id)

/** The fields of a fact as UI words (null: not set). */
function words(f: Pick<ItemFact, 'status' | 'due' | 'reminder' | 'people' | 'blockedBy' | 'related'>, lang: Lang, t: T) {
  const reminder = f.reminder ? reminderShort(f.reminder, t) || t('features.workItems.facts.reminder') : null
  return {
    status: t(`editor.workItem.status.${f.status}`),
    due: f.due ? `${dueText(f.due, lang)}${reminder ? ` · ${reminder}` : ''}` : null,
    people: f.people.length ? f.people.map((p) => p.name).join(', ') : null,
    blockedBy: f.blockedBy.length ? f.blockedBy.map((r) => refLabel(r, t)).join(', ') : null,
    related: f.related.length ? f.related.map((r) => refLabel(r, t)).join(', ') : null,
  }
}

/**
 * One line in the UI's language: the title, then the fields that are set — for a 'changed' fact the fields that
 * changed, before → after ("Status Open → Done").
 */
export function factLine(fact: ItemFact, lang: Lang, t: T): string {
  const now = words(fact, lang, t)
  const none = '—'
  const label = (key: string) => t(`features.workItems.facts.${key}`)
  const parts: string[] = [fact.title]
  if (fact.tag === 'changed' && fact.before) {
    const was = words(fact.before, lang, t)
    if (fact.before.status !== fact.status) parts.push(`${label('status')} ${was.status} → ${now.status}`)
    if (fact.before.due !== fact.due || fact.before.reminder !== fact.reminder) parts.push(`${label('due')} ${was.due ?? none} → ${now.due ?? none}`)
    if (!samePeople(fact.before.people, fact.people)) parts.push(`${label('owner')} ${was.people ?? none} → ${now.people ?? none}`)
    if (!sameRefs(fact.before.blockedBy, fact.blockedBy)) parts.push(`${label('blockedBy')} ${was.blockedBy ?? none} → ${now.blockedBy ?? none}`)
    if (!sameRefs(fact.before.related, fact.related)) parts.push(`${label('related')} ${was.related ?? none} → ${now.related ?? none}`)
    return parts.join(' · ')
  }
  if (fact.status !== 'todo') parts.push(`${label('status')} ${now.status}`)
  if (now.people) parts.push(`${label('owner')} ${now.people}`)
  if (now.due) parts.push(`${label('due')} ${now.due}`)
  if (now.blockedBy) parts.push(`${label('blockedBy')} ${now.blockedBy}`)
  if (now.related) parts.push(`${label('related')} ${now.related}`)
  return parts.join(' · ')
}

/* ------------------------------------------------------------------ Claude's line */

const STATUS_EN: Record<WorkItemStatus, string> = { todo: 'todo', in_progress: 'in progress', done: 'done' }

/** A linked task for Claude: its title only while it is in the writer's scope. */
function refEn(r: ItemRefFact, inScope?: (itemId: string) => boolean): string {
  const visible = inScope ? inScope(r.itemId) : r.inScope
  if (!visible) return `${r.itemId} (outside your scope)`
  const title = r.title ? ` "${r.title}"` : ''
  const handle = r.handle ? ` #${r.handle}` : ''
  return `${r.itemId}${title}${handle}${r.isNew ? ' (new)' : ''}`
}

function fieldsEn(f: Pick<ItemFact, 'status' | 'due' | 'reminder' | 'people' | 'blockedBy' | 'related'>, inScope?: (itemId: string) => boolean) {
  return {
    status: STATUS_EN[f.status],
    due: f.due ? `${f.due}${f.reminder ? ` (reminder ${f.reminder})` : ''}` : 'none',
    people: f.people.length ? f.people.map((p) => p.name).join(', ') : 'nobody',
    blockedBy: f.blockedBy.length ? f.blockedBy.map((r) => refEn(r, inScope)).join(', ') : 'nothing',
    related: f.related.length ? f.related.map((r) => refEn(r, inScope)).join(', ') : 'nothing',
  }
}

/**
 * One line for Claude (English): `wi_… "Title" — status in progress · due 2026-10-17 (reminder -1d) · owner: Alex ·
 * blocked by wi_… "Draft copy"`; for 'changed' the fields that changed, before → after. A linked task outside the
 * writer's scope (`inScope`, else each ref's own flag) is named by id only.
 */
export function factLineEn(fact: ItemFact, inScope?: (itemId: string) => boolean): string {
  const head = `${fact.itemId || (fact.handle ? `#${fact.handle}` : 'task')} "${fact.title}"`
  const now = fieldsEn(fact, inScope)
  const parts: string[] = []
  if (fact.tag === 'changed' && fact.before) {
    const was = fieldsEn(fact.before, inScope)
    if (fact.before.status !== fact.status) parts.push(`status ${was.status} → ${now.status}`)
    if (fact.before.due !== fact.due || fact.before.reminder !== fact.reminder) parts.push(`due ${was.due} → ${now.due}`)
    if (!samePeople(fact.before.people, fact.people)) parts.push(`owner ${was.people} → ${now.people}`)
    if (!sameRefs(fact.before.blockedBy, fact.blockedBy)) parts.push(`blocked by ${was.blockedBy} → ${now.blockedBy}`)
    if (!sameRefs(fact.before.related, fact.related)) parts.push(`related ${was.related} → ${now.related}`)
  } else {
    parts.push(`status ${now.status}`)
    if (fact.due) parts.push(`due ${now.due}`)
    if (fact.people.length) parts.push(`owner: ${now.people}`)
    if (fact.blockedBy.length) parts.push(`blocked by ${now.blockedBy}`)
    if (fact.related.length) parts.push(`related ${now.related}`)
  }
  return parts.length ? `${head} — ${parts.join(' · ')}` : head
}
