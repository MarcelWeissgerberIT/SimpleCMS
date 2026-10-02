/** Tiny TipTap JSON builders (contract node names only — see CLAUDE.md). */
import type { JSONContent } from '@tiptap/core'
import type { ColorName, ID, SelectOption, StatusGroup } from '../../store/types'
import { newId } from '../../lib/ids'

type Part = JSONContent | string
export const txt = (text: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text, ...(marks ? { marks } : {}) })
export const b = (text: string) => txt(text, [{ type: 'bold' }])
export const i = (text: string) => txt(text, [{ type: 'italic' }])
export const code = (text: string) => txt(text, [{ type: 'code' }])
export const hl = (text: string, color: ColorName = 'orange') => txt(text, [{ type: 'highlight', attrs: { color } }])
export const link = (text: string, href: string) => txt(text, [{ type: 'link', attrs: { href } }])
const inl = (parts: Part[]): JSONContent[] => parts.filter((x) => x !== '').map((x) => (typeof x === 'string' ? txt(x) : x))

export const p = (...parts: Part[]): JSONContent => {
  const content = inl(parts)
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' }
}
const heading = (level: 1 | 2 | 3) => (...parts: Part[]): JSONContent => ({ type: 'heading', attrs: { level }, content: inl(parts) })
export const h1 = heading(1)
export const h2 = heading(2)
export const h3 = heading(3)
export const li = (...parts: Part[]): JSONContent => ({ type: 'listItem', content: [p(...parts)] })
export const ul = (...items: Array<JSONContent | string>): JSONContent => ({ type: 'bulletList', content: items.map((x) => (typeof x === 'string' ? li(x) : x)) })
export const ol = (...items: Array<JSONContent | string>): JSONContent => ({ type: 'orderedList', content: items.map((x) => (typeof x === 'string' ? li(x) : x)) })
export const task = (checked: boolean, ...parts: Part[]): JSONContent => ({ type: 'taskItem', attrs: { checked }, content: [p(...parts)] })
export const tasks = (...items: Array<JSONContent | string>): JSONContent => ({ type: 'taskList', content: items.map((x) => (typeof x === 'string' ? task(false, x) : x)) })
export const callout = (icon: string, color: ColorName, ...blocks: Array<JSONContent | string>): JSONContent => ({
  type: 'callout',
  attrs: { icon, color },
  content: blocks.map((x) => (typeof x === 'string' ? p(x) : x)),
})
export const quote = (...parts: Part[]): JSONContent => ({ type: 'blockquote', content: [p(...parts)] })
export const toggle = (summary: string, ...blocks: Array<JSONContent | string>): JSONContent => ({
  type: 'details',
  content: [
    { type: 'detailsSummary', content: [txt(summary)] },
    { type: 'detailsContent', content: blocks.map((x) => (typeof x === 'string' ? p(x) : x)) },
  ],
})
export const hr = (): JSONContent => ({ type: 'horizontalRule' })
export const codeBlock = (language: string, source: string): JSONContent => ({ type: 'codeBlock', attrs: { language }, content: [txt(source)] })
export const pageLink = (pageId: ID): JSONContent => ({ type: 'pageLink', attrs: { pageId } })
export const mention = (id: ID, label: string): JSONContent => ({ type: 'mention', attrs: { id, label, kind: 'page' } })
export const dateMention = (iso: string, label: string): JSONContent => ({ type: 'mention', attrs: { id: iso, label, kind: 'date' } })
export const dbBlock = (databaseId: ID, viewId: ID | null = null): JSONContent => ({ type: 'databaseBlock', attrs: { databaseId, viewId } })
export const toc = (): JSONContent => ({ type: 'toc' })
export const columns = (...cols: JSONContent[][]): JSONContent => ({ type: 'columns', content: cols.map((c) => ({ type: 'column', content: c })) })
export const table = (rows: string[][]): JSONContent => ({
  type: 'table',
  content: rows.map((r, ri) => ({ type: 'tableRow', content: r.map((cell) => ({ type: ri === 0 ? 'tableHeader' : 'tableCell', content: [p(cell)] })) })),
})
export const doc = (...blocks: JSONContent[]): JSONContent => ({ type: 'doc', content: blocks })

export const opt = (name: string, color: ColorName, group?: StatusGroup): SelectOption => ({ id: newId(), name, color, ...(group ? { group } : {}) })

/** ISO date offset from today (local). */
export function day(offset: number): string {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + offset)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Monday of this week + n days. */
export function weekday(n: number): string {
  const d = new Date()
  const dow = (d.getDay() + 6) % 7
  return day(n - dow)
}

/** Formula text for a 10-segment bar + percentage of a 0..1 expression. */
export function barFormula(expr: string): string {
  const x = `min(1, max(0, ${expr}))`
  return `slice("▰▰▰▰▰▰▰▰▰▰", 0, round(${x} * 10)) + slice("▱▱▱▱▱▱▱▱▱▱", 0, 10 - round(${x} * 10)) + "  " + format(round(${x} * 100)) + "%"`
}
