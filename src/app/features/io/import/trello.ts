/**
 * Trello board export (Board menu → Print, export and share → Export as JSON) → ImportPlan.
 * Pure (no DOM / store) — unit-testable in Node.
 *
 * The board becomes a database that opens on a Board view grouped by Status, whose options are
 * the board's lists in list order. Properties: Labels (multi-select, Trello colours mapped),
 * Members (person — people are created by name), Due (date) + Done (checkbox), Start and the card
 * link when the board uses them. A card's description (Markdown), checklists (to-dos), attachment
 * links and comments become the row page. Archived lists and cards are left out (reported).
 */
import type { ColorName, DateValue, Person, PropertyDef, PropertyValue, SelectOption, StatusGroup } from '../../../store/types'
import { newId } from '../../../lib/ids'
import { statusGroupFor } from './csv'
import type { ImportPlan, PlanNode } from './plan'
import type { ReportItem } from './report'

interface TrelloList {
  id: string
  name?: string
  closed?: boolean
  pos?: number
}
interface TrelloLabel {
  id: string
  name?: string
  color?: string | null
}
interface TrelloMember {
  id: string
  fullName?: string
  username?: string
}
interface TrelloCheckItem {
  id?: string
  name?: string
  state?: string
  pos?: number
}
interface TrelloChecklist {
  id: string
  name?: string
  idCard?: string
  pos?: number
  checkItems?: TrelloCheckItem[]
}
interface TrelloAttachment {
  name?: string
  url?: string
}
interface TrelloCard {
  id: string
  name?: string
  desc?: string
  idList?: string
  closed?: boolean
  pos?: number
  due?: string | null
  dueComplete?: boolean
  start?: string | null
  idLabels?: string[]
  labels?: TrelloLabel[]
  idMembers?: string[]
  idChecklists?: string[]
  attachments?: TrelloAttachment[]
  shortUrl?: string
  url?: string
  dateLastActivity?: string
}
interface TrelloAction {
  type?: string
  date?: string
  data?: { text?: string; card?: { id?: string } }
  memberCreator?: { fullName?: string; username?: string }
}
export interface TrelloBoard {
  name: string
  lists: TrelloList[]
  cards: TrelloCard[]
  labels?: TrelloLabel[]
  members?: TrelloMember[]
  checklists?: TrelloChecklist[]
  actions?: TrelloAction[]
}

/** A Trello board export: a name plus lists and cards. */
export function isTrelloBoard(o: unknown): o is TrelloBoard {
  if (!o || typeof o !== 'object') return false
  const b = o as Record<string, unknown>
  return typeof b.name === 'string' && Array.isArray(b.lists) && Array.isArray(b.cards)
}

export interface TrelloLabels {
  name: string
  status: string
  labels: string
  members: string
  due: string
  done: string
  start: string
  link: string
  attachments: string
  comments: string
  /** an unnamed label is called by its colour */
  colorName: (c: ColorName) => string
  /** report line: "3 cards, 1 list" */
  archived: (cards: number, lists: number) => string
}

const TRELLO_COLOR: Record<string, ColorName> = {
  green: 'green',
  yellow: 'yellow',
  orange: 'orange',
  red: 'red',
  purple: 'purple',
  blue: 'blue',
  sky: 'blue',
  lime: 'green',
  pink: 'pink',
  black: 'gray',
}
export const trelloColor = (c?: string | null): ColorName => (c ? (TRELLO_COLOR[c.replace(/_(dark|light)$/, '')] ?? 'gray') : 'default')

const PERSON_COLORS: ColorName[] = ['orange', 'blue', 'green', 'purple', 'pink', 'brown', 'yellow', 'red']
const GROUP_COLOR: Record<StatusGroup, ColorName> = { todo: 'gray', in_progress: 'blue', done: 'green' }

const pad = (n: number) => String(n).padStart(2, '0')

/** ISO timestamp → local date (with time unless it is midnight). */
export function trelloDate(iso?: string | null): DateValue | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return time === '00:00' ? { start: date } : { start: `${date}T${time}`, includeTime: true }
}

/** Trello ids start with the creation time (seconds, hex). */
const createdOf = (id: string) => (/^[0-9a-f]{24}$/i.test(id) ? parseInt(id.slice(0, 8), 16) * 1000 : undefined)
const byPos = <T extends { pos?: number }>(a: T, b: T) => (a.pos ?? 0) - (b.pos ?? 0)
const label = (s: string) => s.replace(/[[\]\\]/g, '\\$&')
const quote = (s: string) =>
  s
    .trim()
    .split('\n')
    .map((l) => (l.trim() ? `> ${l}` : '>'))
    .join('\n')

export function buildTrelloPlan(boards: TrelloBoard[], L: TrelloLabels): ImportPlan {
  const nodes: PlanNode[] = []
  const roots: string[] = []
  const people: Person[] = []
  const report: ReportItem[] = []
  const personByName = new Map<string, Person>()

  boards.forEach((board, bi) => {
    const dbKey = `trello${bi}`
    const lists = board.lists.filter((l) => !l.closed).sort(byPos)
    const openList = new Set(lists.map((l) => l.id))
    const cards = board.cards
      .filter((c) => !c.closed && c.idList && openList.has(c.idList))
      .sort((a, b) => lists.findIndex((l) => l.id === a.idList) - lists.findIndex((l) => l.id === b.idList) || byPos(a, b))
    const archivedLists = board.lists.length - lists.length
    const archivedCards = board.cards.length - cards.length
    if (archivedCards || archivedLists) report.push({ code: 'archived', detail: L.archived(archivedCards, archivedLists), where: board.name })

    /* ---------- schema ---------- */
    const title: PropertyDef = { id: newId(), name: L.name, type: 'title' }
    const optionByList = new Map<string, string>()
    const statusOptions: SelectOption[] = lists.map((l) => {
      const group = statusGroupFor(l.name ?? '')
      const o: SelectOption = { id: newId(), name: (l.name ?? '').trim() || '—', color: GROUP_COLOR[group], group }
      optionByList.set(l.id, o.id)
      return o
    })
    const status: PropertyDef = { id: newId(), name: L.status, type: 'status', options: statusOptions }
    const props: PropertyDef[] = [title, status]

    // labels: board labels + any only found on cards; unnamed ones are called by their colour
    const labelOption = new Map<string, string>()
    const labelOptions: SelectOption[] = []
    const addLabel = (l: TrelloLabel) => {
      if (!l?.id || labelOption.has(l.id) || (!l.name?.trim() && !l.color)) return
      const color = trelloColor(l.color)
      const o: SelectOption = { id: newId(), name: l.name?.trim() || L.colorName(color), color }
      labelOption.set(l.id, o.id)
      labelOptions.push(o)
    }
    for (const l of board.labels ?? []) addLabel(l)
    for (const c of cards) for (const l of c.labels ?? []) addLabel(l)
    const labels: PropertyDef | null = labelOptions.length ? { id: newId(), name: L.labels, type: 'multi_select', options: labelOptions } : null
    if (labels) props.push(labels)

    const memberIds = new Map<string, string>()
    for (const m of board.members ?? []) {
      const name = (m.fullName || m.username || '').trim()
      if (!m.id || !name) continue
      let p = personByName.get(name.toLowerCase())
      if (!p) {
        p = { id: newId(), name, color: PERSON_COLORS[people.length % PERSON_COLORS.length] }
        personByName.set(name.toLowerCase(), p)
        people.push(p)
      }
      memberIds.set(m.id, p.id)
    }
    const members: PropertyDef | null = cards.some((c) => c.idMembers?.some((id) => memberIds.has(id))) ? { id: newId(), name: L.members, type: 'person' } : null
    if (members) props.push(members)

    const hasDue = cards.some((c) => trelloDate(c.due))
    const due: PropertyDef | null = hasDue ? { id: newId(), name: L.due, type: 'date' } : null
    const done: PropertyDef | null = hasDue ? { id: newId(), name: L.done, type: 'checkbox' } : null
    if (due && done) props.push(due, done)
    const start: PropertyDef | null = cards.some((c) => trelloDate(c.start)) ? { id: newId(), name: L.start, type: 'date' } : null
    if (start) props.push(start)
    const link: PropertyDef | null = cards.some((c) => c.shortUrl || c.url) ? { id: newId(), name: L.link, type: 'url' } : null
    if (link) props.push(link)

    nodes.push({ key: dbKey, kind: 'database', title: board.name.trim() || 'Trello', hex: null, parentKey: null, dir: dbKey, body: '', format: 'markdown', attachments: [], properties: props, primaryView: 'board' })
    roots.push(dbKey)

    /* ---------- rows ---------- */
    const checklists = new Map<string, TrelloChecklist>()
    for (const cl of board.checklists ?? []) if (cl?.id) checklists.set(cl.id, cl)
    const comments = new Map<string, TrelloAction[]>()
    for (const a of board.actions ?? []) {
      const id = a.data?.card?.id
      if (a.type !== 'commentCard' || !id || !a.data?.text?.trim()) continue
      const list = comments.get(id)
      if (list) list.push(a)
      else comments.set(id, [a])
    }

    for (const card of cards) {
      const values: Record<string, PropertyValue> = {}
      values[status.id] = optionByList.get(card.idList!) ?? null
      if (labels) {
        const ids = (card.idLabels ?? card.labels?.map((l) => l.id) ?? []).map((id) => labelOption.get(id)).filter((x): x is string => !!x)
        if (ids.length) values[labels.id] = [...new Set(ids)]
      }
      if (members) {
        const ids = (card.idMembers ?? []).map((id) => memberIds.get(id)).filter((x): x is string => !!x)
        if (ids.length) values[members.id] = [...new Set(ids)]
      }
      const dueValue = trelloDate(card.due)
      if (due && done && dueValue) {
        values[due.id] = dueValue
        values[done.id] = !!card.dueComplete
      }
      const startValue = trelloDate(card.start)
      if (start && startValue) values[start.id] = startValue
      if (link && (card.shortUrl || card.url)) values[link.id] = (card.shortUrl || card.url)!

      // page: description, checklists, attachments, comments
      const parts: string[] = []
      if (card.desc?.trim()) parts.push(card.desc.trim())
      const own = (card.idChecklists?.length ? card.idChecklists.map((id) => checklists.get(id)) : [...checklists.values()].filter((cl) => cl.idCard === card.id)).filter((cl): cl is TrelloChecklist => !!cl).sort(byPos)
      for (const cl of own) {
        const items = [...(cl.checkItems ?? [])].sort(byPos).filter((i) => i.name?.trim())
        if (!items.length) continue
        parts.push(`### ${(cl.name ?? '').trim() || '—'}\n\n${items.map((i) => `- [${i.state === 'complete' ? 'x' : ' '}] ${i.name!.trim().replace(/\n+/g, ' ')}`).join('\n')}`)
      }
      const atts = (card.attachments ?? []).filter((a) => a.url && /^https?:\/\//i.test(a.url))
      if (atts.length) parts.push(`### ${L.attachments}\n\n${atts.map((a) => `- [${label((a.name ?? '').trim() || a.url!)}](<${a.url}>)`).join('\n')}`)
      const said = (comments.get(card.id) ?? []).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
      if (said.length)
        parts.push(
          `### ${L.comments}\n\n${said
            .map((a) => {
              const who = (a.memberCreator?.fullName || a.memberCreator?.username || '').trim()
              const when = trelloDate(a.date)?.start.replace('T', ' ') ?? ''
              return `**${label(who || '—')}** · ${when}\n\n${quote(a.data!.text!)}`
            })
            .join('\n\n')}`,
        )

      const createdAt = createdOf(card.id)
      const touched = card.dateLastActivity ? Date.parse(card.dateLastActivity) : NaN
      nodes.push({
        key: `${dbKey}/${card.id}`,
        kind: 'row',
        title: (card.name ?? '').trim(),
        hex: null,
        parentKey: dbKey,
        dbKey,
        dir: dbKey,
        body: parts.join('\n\n'),
        format: 'markdown',
        attachments: [],
        values,
        ...(createdAt ? { createdAt } : {}),
        ...(Number.isFinite(touched) ? { updatedAt: touched } : createdAt ? { updatedAt: createdAt } : {}),
      })
    }
  })

  return {
    nodes,
    files: new Map(),
    pathKeys: new Map(),
    roots,
    isNotion: false,
    warnings: [],
    source: 'trello',
    name: boards.length === 1 ? boards[0].name : undefined,
    people,
    report,
  }
}
