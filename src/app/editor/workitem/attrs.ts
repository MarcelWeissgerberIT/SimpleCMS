/**
 * Task block (`workItem`) — the attribute contract and its ONE sanitizer, `itemAttrs()`.
 * Pure (no store, no DOM, no editor): the schema, the node views, the Markdown form, DiffDoc,
 * freezeWorkItems and the share codec all read a task's fields through it.
 *
 * attrs (stored as written, read through itemAttrs):
 *  - id: the block id (UniqueID — `?b=` links, edit_page refs)
 *  - itemId: 'wi_' + 10 URL-safe characters — the task's identity across the workspace
 *  - status: 'todo' | 'in_progress' | 'done' (the database StatusGroup names; "blocked" / "overdue"
 *    are computed, never stored)
 *  - due: 'yyyy-MM-dd' | 'yyyy-MM-ddTHH:mm' (local wall clock) | null
 *  - reminder: a reminder code ('at' | '-<n><m|h|d|w>', features/inbox/reminders.ts) — null without `due`
 *  - people: person ids (account ids in teams), ≤ 12 — ids that no longer resolve are hidden, not deleted
 *  - blockedBy: itemIds this task waits for, ≤ 20 (stored on the dependent only)
 *  - related: itemIds, ≤ 20 (never blocking)
 *  - doneAt: epoch ms the task was finished — only while status is 'done'
 *  - frozen: ONLY in documents that left the workspace (share links, the published site, HTML exports —
 *    freezeWorkItems): { people: names, blockedBy: count, related: count }; every id above is gone there.
 * No titles or names are ever cached in the stored attrs.
 */

export const WORK_ITEM = 'workItem'

export type WorkItemStatus = 'todo' | 'in_progress' | 'done'
export const WORK_ITEM_STATUSES: readonly WorkItemStatus[] = ['todo', 'in_progress', 'done']

export const MAX_PEOPLE = 12
export const MAX_LINKS = 20
/** A frozen name is display text only: kept short. */
const MAX_NAME = 80

export interface FrozenWorkItem {
  /** the names of the people, resolved when the document left the workspace */
  people: string[]
  blockedBy: number
  related: number
}

export interface WorkItemAttrs {
  id: string | null
  itemId: string | null
  status: WorkItemStatus
  due: string | null
  reminder: string | null
  people: string[]
  blockedBy: string[]
  related: string[]
  doneAt: number | null
  frozen: FrozenWorkItem | null
}

export const ITEM_ID = /^wi_[A-Za-z0-9_-]{10}$/
/** Person ids: local ids (12 lowercase) and account ids (base64url) — never whitespace or markup. */
export const PERSON_ID = /^[A-Za-z0-9_.:@-]{1,64}$/
const DUE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/
const REMINDER = /^(?:at|-\d{1,3}[mhdw])$/

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** A valid 'yyyy-MM-dd' / 'yyyy-MM-ddTHH:mm' (a real calendar day, a real time) or null. */
export function readDue(v: unknown): string | null {
  const m = DUE.exec(str(v).trim())
  if (!m) return null
  const [y, mo, d, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 0 : Number(m[4]), m[5] === undefined ? 0 : Number(m[5])]
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59) return null
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  if (d > days) return null
  return m[0]
}

export const dueHasTime = (due: string): boolean => due.length > 10

export function readReminder(v: unknown): string | null {
  const s = str(v)
  return REMINDER.test(s) ? s : null
}

export function readStatus(v: unknown): WorkItemStatus {
  return WORK_ITEM_STATUSES.includes(v as WorkItemStatus) ? (v as WorkItemStatus) : 'todo'
}

export function readItemId(v: unknown): string | null {
  const s = str(v)
  return ITEM_ID.test(s) ? s : null
}

/** A list attr: an array, a JSON array or a space / comma separated string (HTML) — valid, unique, capped. */
function readList(v: unknown, valid: RegExp, max: number, not?: string | null): string[] {
  let list: unknown = v
  if (typeof v === 'string') {
    const s = v.trim()
    if (s.startsWith('[')) {
      try {
        list = JSON.parse(s)
      } catch {
        list = []
      }
    } else list = s ? s.split(/[\s,]+/) : []
  }
  if (!Array.isArray(list)) return []
  const out: string[] = []
  for (const x of list) {
    if (out.length >= max) break
    if (typeof x !== 'string' || !valid.test(x) || x === not || out.includes(x)) continue
    out.push(x)
  }
  return out
}

export const readPeople = (v: unknown): string[] => readList(v, PERSON_ID, MAX_PEOPLE)
export const readLinks = (v: unknown, own?: string | null): string[] => readList(v, ITEM_ID, MAX_LINKS, own)

const count = (v: unknown, max: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : 0
  return Number.isFinite(n) ? Math.max(0, Math.min(max, Math.floor(n))) : 0
}

/** Visible text only: no control characters, one line, capped. */
export function cleanName(v: unknown): string {
  return str(v)
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME)
}

export function readFrozen(v: unknown): FrozenWorkItem | null {
  let raw: unknown = v
  if (typeof v === 'string') {
    try {
      raw = JSON.parse(v)
    } catch {
      return null
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const people = (Array.isArray(r.people) ? r.people : []).map(cleanName).filter(Boolean).slice(0, MAX_PEOPLE)
  return { people, blockedBy: count(r.blockedBy, MAX_LINKS), related: count(r.related, MAX_LINKS) }
}

export function readDoneAt(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

type AttrSource = { attrs?: Record<string, unknown> | null } | Record<string, unknown> | null | undefined

/**
 * The typed, valid fields of a task — a ProseMirror node, TipTap JSON or a bare attrs object (anything
 * invalid falls back to its default; limits and formats of the contract above).
 */
export function itemAttrs(source: AttrSource): WorkItemAttrs {
  const holder = source as { attrs?: unknown; type?: unknown } | null | undefined
  const a = (holder && typeof holder === 'object' && 'attrs' in holder && (typeof holder.type === 'string' || typeof holder.type === 'object') ? holder.attrs : holder) as
    | Record<string, unknown>
    | null
    | undefined
  const attrs = a && typeof a === 'object' ? a : {}
  const itemId = readItemId(attrs.itemId)
  const status = readStatus(attrs.status)
  const due = readDue(attrs.due)
  return {
    id: str(attrs.id) || null,
    itemId,
    status,
    due,
    reminder: due ? readReminder(attrs.reminder) : null,
    people: readPeople(attrs.people),
    blockedBy: readLinks(attrs.blockedBy, itemId),
    related: readLinks(attrs.related, itemId),
    doneAt: status === 'done' ? readDoneAt(attrs.doneAt) : null,
    frozen: readFrozen(attrs.frozen),
  }
}

/** The attrs as stored (JSON): the sanitized fields, nothing else. */
export function storedItemAttrs(a: WorkItemAttrs): Record<string, unknown> {
  return {
    id: a.id,
    itemId: a.itemId,
    status: a.status,
    due: a.due,
    reminder: a.reminder,
    people: a.people,
    blockedBy: a.blockedBy,
    related: a.related,
    doneAt: a.doneAt,
    ...(a.frozen ? { frozen: a.frozen } : {}),
  }
}

/** "7F3A" — the last four characters of an itemId, for the placard's spec label. */
export function shortItemId(itemId: string | null): string {
  return itemId ? itemId.slice(-4).toUpperCase() : ''
}
