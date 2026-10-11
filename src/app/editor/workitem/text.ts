/**
 * Task block — its text in one line. Pure. ONE function for every place that names a task in a single line:
 * the workspace index, the agenda, reminders, toasts, pickers, hover cards (`itemTitleText`), and the steps
 * a task's notes hold (`todoProgress`). Both take a ProseMirror node or TipTap JSON.
 */
import type { JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { WORK_ITEM } from './attrs'

/** A title longer than this is cut with "…". */
export const TITLE_MAX = 140

type AnyNode = PMNode | JSONContent

const isPM = (n: AnyNode): n is PMNode => typeof (n as PMNode).type === 'object' && (n as PMNode).type !== null
const typeName = (n: AnyNode): string => (isPM(n) ? n.type.name : (n.type ?? ''))
const TEXTBLOCKS = new Set(['paragraph', 'heading', 'codeBlock', 'detailsSummary'])
const INLINE = new Set(['text', 'hardBreak', 'mention', 'inlineMath', 'icon'])

/** The task's title block (its first child) — or the node itself when it is not a task. */
function titleOf(n: AnyNode): AnyNode | null {
  if (typeName(n) !== WORK_ITEM) return n
  if (isPM(n)) return n.childCount ? n.child(0) : null
  const first = Array.isArray(n.content) ? n.content[0] : null
  return first && typeof first === 'object' ? first : null
}

/** Collapse whitespace, cut at TITLE_MAX with "…". */
export function oneLine(s: string, max = TITLE_MAX): string {
  const line = s.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

/**
 * The title line of a task (or of a title block) as one line of text: text + mention labels with "@", a hard
 * break as a space, whitespace collapsed, at most 140 characters ("…"). Never reads the notes.
 */
export function itemTitleText(node: AnyNode | null | undefined): string {
  if (!node) return ''
  const title = titleOf(node)
  if (!title) return ''
  let out = ''
  const piece = (type: string, text: string | null | undefined, attrs: Record<string, unknown> | null | undefined) => {
    if (type === 'text') out += text ?? ''
    else if (type === 'hardBreak') out += ' '
    else if (type === 'mention' && typeof attrs?.label === 'string' && attrs.label) out += `@${attrs.label}`
  }
  if (isPM(title)) title.forEach((c) => piece(c.type.name, c.text, c.attrs))
  else for (const c of Array.isArray(title.content) ? title.content : []) if (c && typeof c === 'object') piece(c.type ?? '', c.text, c.attrs)
  return oneLine(out)
}

/**
 * The to-dos anywhere in a task's notes: { done, total } — null when the notes hold none. Walks blocks only
 * (never a line's text).
 */
export function todoProgress(node: AnyNode | null | undefined): { done: number; total: number } | null {
  if (!node) return null
  let done = 0
  let total = 0
  const count = (type: string, checked: unknown) => {
    if (type !== 'taskItem') return
    total++
    if (checked === true) done++
  }
  if (isPM(node)) {
    node.forEach((child, _offset, index) => {
      if (index === 0 && node.type.name === WORK_ITEM) return
      count(child.type.name, child.attrs.checked)
      child.descendants((d) => {
        count(d.type.name, d.attrs.checked)
        return !d.isTextblock && !d.isAtom
      })
    })
  } else {
    const kids = Array.isArray(node.content) ? node.content : []
    const stack: JSONContent[] = []
    for (let i = kids.length - 1; i >= (node.type === WORK_ITEM ? 1 : 0); i--) if (kids[i] && typeof kids[i] === 'object') stack.push(kids[i])
    while (stack.length) {
      const n = stack.pop()!
      const type = n.type ?? ''
      count(type, n.attrs?.checked)
      if (TEXTBLOCKS.has(type) || INLINE.has(type) || !Array.isArray(n.content)) continue
      for (let i = n.content.length - 1; i >= 0; i--) if (n.content[i] && typeof n.content[i] === 'object') stack.push(n.content[i])
    }
  }
  return total ? { done, total } : null
}
