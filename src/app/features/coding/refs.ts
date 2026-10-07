/**
 * Pages a task refers to — page mentions (@), links to pages (`pageLink`, `#/p/<id>` links, also a pasted One
 * address as plain text) in the part of the task Claude may read, and One addresses in the person's answers and
 * rework notes — go along with the task to the worker as read-only text: ≤ 8 pages, ≤ 20,000 characters each,
 * each only what Claude may read of it (context marks). A database row brings its filled fields, a database its
 * entries' titles. Never trashed or template pages. Their text is part of the task's version (trust.ts), so in a
 * team a changed reference waits for Confirm like a changed task.
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../store/store'
import { inTemplate, isEffectivelyTrashed, selectRows } from '../../store/selectors'
import type { ID, Page } from '../../store/types'
import { docToMarkdown, readableBlocks, readableContent } from '../../editor'
import { propertyValueToText } from '../../database'
import { t } from '../../i18n'

const MAX_REFS = 8
const MAX_CHARS = 20_000
const MAX_ROWS = 50
const LINK = /#\/p\/([A-Za-z0-9_-]{4,64})/
const LINKS = /#\/p\/([A-Za-z0-9_-]{4,64})/g

/** The page ids of One addresses in a text ("https://…/app/#/p/<id>", "#/p/<id>"). */
export const idsInText = (text: string): string[] => [...text.matchAll(LINKS)].map((m) => m[1]!)

export interface TaskRef {
  id: ID
  title: string
  markdown: string
}

/** The page ids the blocks point to, in order (default: the task's readable part). */
function refIds(taskId: ID, blocks: JSONContent[] = readableBlocks(taskId)): ID[] {
  const ids: ID[] = []
  const add = (id: unknown) => {
    if (typeof id === 'string' && id && id !== taskId && !ids.includes(id)) ids.push(id)
  }
  const walk = (n: JSONContent) => {
    if (n.type === 'mention' && n.attrs?.kind === 'page') add(n.attrs.id)
    else if (n.type === 'pageLink') add(n.attrs?.pageId)
    for (const m of n.marks ?? []) if (m.type === 'link' && typeof m.attrs?.href === 'string') add(LINK.exec(m.attrs.href)?.[1])
    // a One address pasted as plain text
    if (n.type === 'text' && typeof n.text === 'string' && n.text.includes('#/p/')) for (const id of idsInText(n.text)) add(id)
    for (const c of n.content ?? []) walk(c)
  }
  for (const b of blocks) walk(b)
  return ids
}

const usable = (id: ID) => {
  const s = useWorkspace.getState()
  return !!s.pages[id] && !isEffectivelyTrashed(s.pages, id) && !inTemplate(s.pages, id)
}

const clip = (s: string) => (s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS)}\n…` : s)

/** One referenced page as text: a row's filled fields first, a database's entries, then what Claude may read of it. */
function refText(page: Page): string {
  const s = useWorkspace.getState()
  const parts: string[] = []
  const db = page.databaseId ? s.databases[page.databaseId] : undefined
  if (db) {
    const fields = db.properties
      .filter((p) => p.type !== 'title')
      .map((p) => [p.name, propertyValueToText(db, p, page).trim()] as const)
      .filter(([, v]) => v)
      .slice(0, 30)
    if (fields.length) parts.push(fields.map(([k, v]) => `- ${k}: ${v.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n'))
  }
  if (s.databases[page.id]) {
    const rows = selectRows(s.pages, page.id).filter((r) => !r.trashed)
    if (rows.length) parts.push(rows.slice(0, MAX_ROWS).map((r) => `- ${r.title.trim() || t('common.untitled')}`).join('\n') + (rows.length > MAX_ROWS ? `\n- … (${rows.length - MAX_ROWS} more)` : ''))
  }
  const body = readableContent(page.id).markdown
  if (body) parts.push(body)
  return clip(parts.join('\n\n'))
}

/** The pages a task refers to (what goes along to the worker); `extra`: more text to look for One addresses in. */
export function taskRefs(taskId: ID, extra: string[] = []): TaskRef[] {
  const s = useWorkspace.getState()
  const out: TaskRef[] = []
  const ids = refIds(taskId)
  for (const text of extra) for (const id of idsInText(text)) if (id !== taskId && !ids.includes(id)) ids.push(id)
  for (const id of ids) {
    if (out.length >= MAX_REFS) break
    if (!usable(id)) continue
    const page = s.pages[id]!
    out.push({ id, title: page.title.trim() || t('common.untitled'), markdown: refText(page) })
  }
  return out
}

/** The referenced pages as a part of the task text ('' without any). */
export function refsMarkdown(refs: TaskRef[]): string {
  if (!refs.length) return ''
  return [`## ${t('features.coding.refs.heading')}`, ...refs.map((r) => `### ${r.title} (${t('features.coding.refs.page')} ${r.id})\n\n${r.markdown || t('features.coding.refs.empty')}`)].join('\n\n')
}

/** The task text the worker gets: the task's readable part, then the pages it (and `extra`: answers, notes) refers to. */
export function taskText(taskId: ID, extra: string[] = []): string {
  const own = readableContent(taskId).markdown
  const refs = refsMarkdown(taskRefs(taskId, extra))
  return refs ? `${own}\n\n${refs}` : own
}

/**
 * The references' part of a task version: every page the task's content points to (not only the readable part),
 * by id, title, fields and full content — the same in every language and with any context marks.
 */
export function refsKey(page: Page): string {
  const s = useWorkspace.getState()
  const ids = refIds(page.id, page.content?.content ?? []).filter(usable).slice(0, MAX_REFS)
  return ids
    .map((id) => {
      const p = s.pages[id]!
      return `${id}\n${p.title}\n${JSON.stringify(p.properties ?? {})}\n${docToMarkdown(p.content)}`
    })
    .join('\u0001')
}
