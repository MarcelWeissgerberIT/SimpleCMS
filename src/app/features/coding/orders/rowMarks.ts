/**
 * Work orders — who last wrote a request's title and fields (review Fix 2): the pure rules (a Node spec reads them;
 * rowWriters.ts keeps the marks per device). See rowWriters.ts for the whole story.
 */
import type { Database, ID, Page } from '../../../store/types'
import type { Writer } from '../../../store/writer'
import { orderStatusProps } from './status'

/** One field's last outside writer: its kind ("mcp", "script", "automation" …) and when. */
export interface OutsideMark {
  by: string
  at: number
}

export interface RowOutside {
  title?: OutsideMark
  props?: Record<ID, OutsideMark>
  /** the row was made by someone other than the person (its body without a content origin is not his) */
  made?: OutsideMark
}

/** The person's own writes of a request's title / fields here: by hand, the editor, his command (Prüfen lassen). */
export const PERSON_FIELD_VIAS: ReadonlySet<string> = new Set(['ui', 'command'])

/**
 * How a write counts for the marks: 'person' clears, a string marks (the writer's kind), null changes nothing (system
 * bookkeeping, the order writer, an eject / rewind).
 */
export function markOf(w: Writer | null, personEvent: boolean): 'person' | string | null {
  if (!w) return personEvent ? 'person' : 'unknown'
  if (w.kind === 'you') return !w.via || PERSON_FIELD_VIAS.has(w.via) ? 'person' : `you~${w.via}`
  if (w.kind === 'editor') return 'person'
  if (w.kind === 'system' || w.kind === 'order' || w.kind === 'eject' || w.kind === 'rewind') return null
  return w.kind
}

/** A field value that is no value (the row was made without it). */
const empty = (v: unknown): boolean => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)

/**
 * The marks after one write of a row (`before` undefined: it was made in this write). Pure. Returns the same object when
 * nothing changes.
 */
export function nextMarks(marks: RowOutside | undefined, db: Pick<Database, 'system' | 'orders' | 'properties'>, now: Pick<Page, 'title' | 'properties'>, before: Pick<Page, 'title' | 'properties'> | undefined, who: 'person' | string, at: number): RowOutside | undefined {
  const status = new Set(orderStatusProps(db).map((p) => p.id))
  const titleChanged = before ? now.title !== before.title : !!now.title.trim()
  const props: ID[] = []
  if (now.properties !== before?.properties)
    for (const id of new Set([...Object.keys(now.properties ?? {}), ...Object.keys(before?.properties ?? {})])) {
      if (status.has(id)) continue
      const a = now.properties?.[id]
      const b = before?.properties?.[id]
      if (before ? JSON.stringify(a ?? null) !== JSON.stringify(b ?? null) : !empty(a)) props.push(id)
    }
  if (!titleChanged && !props.length && (before || who === 'person')) return marks
  const out: RowOutside = { ...(marks ?? {}) }
  const p = { ...(out.props ?? {}) }
  if (who === 'person') {
    if (titleChanged) delete out.title
    for (const id of props) delete p[id]
  } else {
    const mark = { by: who.slice(0, 40), at }
    if (titleChanged) out.title = mark
    for (const id of props) p[id] = mark
    if (!before) out.made = mark
  }
  if (Object.keys(p).length) out.props = p
  else delete out.props
  return out.title || out.props || out.made ? out : undefined
}

/**
 * The writer that makes this row outside (null: the person's): its title or a field (never the Status) last written by
 * someone else here, or — while its body has no content origin and is not empty — made by someone else.
 */
export function outsideOf(marks: RowOutside | undefined, row: Pick<Page, 'contentOrigin' | 'content'> | undefined): string | null {
  if (!marks) return null
  if (marks.title) return marks.title.by
  const first = Object.values(marks.props ?? {})[0]
  if (first) return first.by
  const body = row?.content?.content ?? []
  const filled = body.some((b) => !(b.type === 'paragraph' && !b.content?.length))
  if (marks.made && !row?.contentOrigin && filled) return marks.made.by
  return null
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const readMark = (v: unknown): OutsideMark | undefined => {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  return typeof o.by === 'string' && o.by && typeof o.at === 'number' && Number.isFinite(o.at) ? { by: o.by.slice(0, 40), at: o.at } : undefined
}

/** A stored value as this build keeps it (anything it cannot read: no marks). */
export function readRowOutside(v: unknown): RowOutside | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const out: RowOutside = {}
  const title = readMark(o.title)
  if (title) out.title = title
  const made = readMark(o.made)
  if (made) out.made = made
  if (o.props && typeof o.props === 'object') {
    const props: Record<ID, OutsideMark> = {}
    for (const [id, m] of Object.entries(o.props as Record<string, unknown>).slice(0, 200)) {
      const mark = readMark(m)
      if (ID_RE.test(id) && mark) props[id] = mark
    }
    if (Object.keys(props).length) out.props = props
  }
  return out.title || out.props || out.made ? out : undefined
}

