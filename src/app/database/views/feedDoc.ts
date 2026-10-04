/**
 * What a feed entry shows of its page: the content as a doc (null = nothing to show), the date
 * it is stamped with, and its comment count.
 */
import type { JSONContent } from '@tiptap/core'
import type { Database, Page, PropertyDef } from '../../store/types'
import type { Resolver } from '../model/resolve'
import { dateValueStart, isDateValue } from '../model/format'
import { isDate } from '../formula'

const isBlank = (n: JSONContent) => n.type === 'paragraph' && !(n.content ?? []).length

const hasDatabase = (n: JSONContent): boolean => n.type === 'databaseBlock' || !!n.content?.some(hasDatabase)

/** An embedded database becomes a link to it: a whole database inside every entry (or the feed inside itself) is too much. */
function swapDatabases(n: JSONContent): JSONContent {
  if (n.type === 'databaseBlock') return { type: 'pageLink', attrs: { pageId: n.attrs?.databaseId ?? null } }
  return n.content ? { ...n, content: n.content.map(swapDatabases) } : n
}

/** The doc a feed entry renders: trailing empty lines dropped; null when the page has no content. */
export function feedDoc(content: JSONContent | null | undefined): JSONContent | null {
  const blocks = [...(content?.content ?? [])]
  while (blocks.length && isBlank(blocks[blocks.length - 1])) blocks.pop()
  if (!blocks.length) return null
  return { type: 'doc', content: blocks.some(hasDatabase) ? blocks.map(swapDatabases) : blocks }
}

/** The moment an entry is stamped with: its value of the feed's date property (null = none). */
export function entryDate(r: Resolver, db: Database, prop: PropertyDef, row: Page): { date: Date; time: boolean } | null {
  if (prop.type === 'created_time') return { date: new Date(row.createdAt), time: true }
  if (prop.type === 'last_edited_time') return { date: new Date(row.updatedAt), time: true }
  const v = r.value(db, prop, row)
  if (isDate(v)) return { date: v, time: true }
  if (!isDateValue(v)) return null
  const date = dateValueStart(v)
  return date ? { date, time: !!v.includeTime } : null
}

/** Comments in the page's open threads (replies included). */
export function openComments(row: Page): number {
  let n = 0
  for (const c of row.comments ?? []) if (!c.resolved) n += 1 + (c.replies?.length ?? 0)
  return n
}
