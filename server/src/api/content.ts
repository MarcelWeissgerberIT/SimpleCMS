/**
 * Page content for the public API: markdown-lite text → the editor's document, written into a page's
 * content document (`ws:<id>:p:<pageId>`, XmlFragment `default`) the way y-prosemirror stores it —
 * without TipTap / ProseMirror on the server.
 *
 * - Blocks are Y.XmlElements named after the TipTap node contract (CLAUDE.md): paragraph,
 *   heading{level}, bulletList / orderedList{start} > listItem > paragraph, taskList > taskItem{checked}
 *   > paragraph, blockquote, codeBlock{language}, horizontalRule; hardBreak inside a paragraph.
 * - Every block carries a fresh `id` attribute (the editor's UniqueID / block-id contract, like the
 *   app's withBlockIds), so block links and the collaborative caret fix work at once.
 * - Text is a Y.XmlText whose formatting attributes are marks, as y-prosemirror encodes them:
 *   { bold: {} } · { italic: {} } · { strike: {} } · { code: {} } · { link: { href } }.
 * Attributes left out fall back to the schema defaults when the editor reads the document.
 */
import { randomUUID } from 'node:crypto'
import * as Y from 'yjs'

export interface Mark {
  type: 'bold' | 'italic' | 'strike' | 'code' | 'link'
  attrs?: Record<string, unknown>
}

/** A TipTap-JSON-shaped node (the subset the API writes). */
export interface Node {
  type: string
  attrs?: Record<string, unknown>
  content?: Node[]
  text?: string
  marks?: Mark[]
}

export const MAX_CONTENT_CHARS = 200_000

/* ------------------------------------------------------------------ inline */

const SAFE_HREF = /^(https?:\/\/|mailto:|#\/p\/)/i

/** `**bold**` `__bold__` `*italic*` `_italic_` `~~strike~~` `` `code` `` `[text](url)`. */
export function parseInline(src: string, marks: Mark[] = []): Node[] {
  const out: Node[] = []
  let buf = ''
  const flush = () => {
    if (buf) out.push(text(buf, marks))
    buf = ''
  }
  let i = 0
  while (i < src.length) {
    const rest = src.slice(i)
    if (rest[0] === '\\' && rest.length > 1 && /[\\`*_~[\]()#>-]/.test(rest[1] ?? '')) {
      buf += rest[1]
      i += 2
      continue
    }
    const code = /^`([^`\n]+)`/.exec(rest)
    if (code) {
      flush()
      // the code mark excludes every other mark (TipTap's Code: excludes '_')
      out.push(text(code[1] ?? '', [{ type: 'code' }]))
      i += code[0].length
      continue
    }
    const link = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(rest)
    if (link && SAFE_HREF.test(link[2] ?? '')) {
      flush()
      out.push(...parseInline(link[1] ?? '', [...marks, { type: 'link', attrs: { href: link[2] } }]))
      i += link[0].length
      continue
    }
    const strong = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest)
    if (strong) {
      flush()
      out.push(...parseInline(strong[2] ?? '', [...marks, { type: 'bold' }]))
      i += strong[0].length
      continue
    }
    const strike = /^~~(?=\S)([\s\S]*?\S)~~/.exec(rest)
    if (strike) {
      flush()
      out.push(...parseInline(strike[1] ?? '', [...marks, { type: 'strike' }]))
      i += strike[0].length
      continue
    }
    // `_` only at a word boundary (snake_case stays as it is)
    const em = /^\*(?=\S)([^*\n]*?\S)\*/.exec(rest) ?? (/[A-Za-z0-9]$/.test(buf) ? null : /^_(?=\S)([^_\n]*?\S)_(?![A-Za-z0-9])/.exec(rest))
    if (em) {
      flush()
      out.push(...parseInline(em[1] ?? '', [...marks, { type: 'italic' }]))
      i += em[0].length
      continue
    }
    buf += rest[0]
    i++
  }
  flush()
  return out
}

const text = (s: string, marks: Mark[]): Node => (marks.length ? { type: 'text', text: s, marks: marks.map((m) => ({ ...m })) } : { type: 'text', text: s })

/** Lines of one paragraph: a single newline is a hard break. */
function paragraph(lines: string[]): Node {
  const content: Node[] = []
  lines.forEach((line, i) => {
    if (i) content.push({ type: 'hardBreak' })
    content.push(...parseInline(line))
  })
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' }
}

/* ------------------------------------------------------------------ blocks */

const FENCE = /^\s*(```|~~~)\s*([A-Za-z0-9_+-]*)\s*$/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const QUOTE = /^\s*>\s?(.*)$/
const TASK = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/
const BULLET = /^(\s*)[-*+]\s+(.*)$/
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/

const indentOf = (line: string) => (/^\s*/.exec(line)?.[0] ?? '').replace(/\t/g, '  ').length

type ListKind = 'task' | 'bullet' | 'ordered'

function listMatch(line: string): { kind: ListKind; indent: number; text: string; checked?: boolean; n?: number } | null {
  const task = TASK.exec(line)
  if (task) return { kind: 'task', indent: indentOf(line), text: task[3] ?? '', checked: (task[2] ?? ' ').toLowerCase() === 'x' }
  const bullet = BULLET.exec(line)
  if (bullet && !RULE.test(line)) return { kind: 'bullet', indent: indentOf(line), text: bullet[2] ?? '' }
  const ordered = ORDERED.exec(line)
  if (ordered) return { kind: 'ordered', indent: indentOf(line), text: ordered[3] ?? '', n: Number(ordered[2]) }
  return null
}

/** Markdown-lite → block nodes (never empty: an empty input is one empty paragraph). */
export function markdownToNodes(input: string): Node[] {
  const lines = input.replace(/\r\n?/g, '\n').slice(0, MAX_CONTENT_CHARS).split('\n')
  const blocks = parseBlocks(lines, 0)
  return blocks.length ? blocks : [{ type: 'paragraph' }]
}

function parseBlocks(lines: string[], depth: number): Node[] {
  const out: Node[] = []
  let i = 0
  let para: string[] = []
  const endPara = () => {
    if (para.length) out.push(paragraph(para))
    para = []
  }
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (!line.trim()) {
      endPara()
      i++
      continue
    }
    const fence = FENCE.exec(line)
    if (fence) {
      endPara()
      const body: string[] = []
      i++
      while (i < lines.length && !new RegExp(`^\\s*${fence[1]}\\s*$`).test(lines[i] ?? '')) body.push(lines[i++] ?? '')
      i++ // the closing fence (or the end)
      const code = body.join('\n')
      out.push({ type: 'codeBlock', attrs: fence[2] ? { language: fence[2].toLowerCase() } : {}, ...(code ? { content: [{ type: 'text', text: code }] } : {}) })
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      endPara()
      const content = parseInline(heading[2] ?? '')
      out.push({ type: 'heading', attrs: { level: Math.min(3, heading[1]?.length ?? 1) }, ...(content.length ? { content } : {}) })
      i++
      continue
    }
    if (RULE.test(line)) {
      endPara()
      out.push({ type: 'horizontalRule' })
      i++
      continue
    }
    if (QUOTE.test(line) && depth < 8) {
      endPara()
      const inner: string[] = []
      while (i < lines.length && QUOTE.test(lines[i] ?? '')) inner.push(QUOTE.exec(lines[i++] ?? '')?.[1] ?? '')
      const content = parseBlocks(inner, depth + 1)
      out.push({ type: 'blockquote', content: content.length ? content : [{ type: 'paragraph' }] })
      continue
    }
    const item = listMatch(line)
    if (item && depth < 8) {
      endPara()
      i = parseList(lines, i, item.kind, item.indent, out, depth)
      continue
    }
    para.push(line.trim())
    i++
  }
  endPara()
  return out
}

/** One list of `kind` at `indent`; returns the index after it. Deeper-indented lines nest in the item. */
function parseList(lines: string[], start: number, kind: ListKind, indent: number, out: Node[], depth: number): number {
  const items: Node[] = []
  let i = start
  let first: number | undefined
  while (i < lines.length) {
    const m = listMatch(lines[i] ?? '')
    if (!m || m.kind !== kind || m.indent !== indent) break
    if (first === undefined) first = m.n
    i++
    // the item's own continuation: deeper-indented lines (blank lines inside count when more follow)
    const inner: string[] = []
    while (i < lines.length) {
      const l = lines[i] ?? ''
      if (l.trim() && indentOf(l) > indent) {
        inner.push(l.slice(Math.min(indentOf(l), indent + 2)))
        i++
        continue
      }
      if (!l.trim() && i + 1 < lines.length && (lines[i + 1] ?? '').trim() && indentOf(lines[i + 1] ?? '') > indent) {
        inner.push('')
        i++
        continue
      }
      break
    }
    const content: Node[] = [paragraph([m.text.trim()]), ...parseBlocks(inner, depth + 1)]
    items.push(kind === 'task' ? { type: 'taskItem', attrs: { checked: !!m.checked }, content } : { type: 'listItem', content })
  }
  if (kind === 'task') out.push({ type: 'taskList', content: items })
  else if (kind === 'bullet') out.push({ type: 'bulletList', content: items })
  else out.push({ type: 'orderedList', attrs: first && first !== 1 ? { start: first } : {}, content: items })
  return i
}

/** "key: value" lines as a bullet list (incoming webhooks: values that did not map to a property). */
export function keyValueList(entries: Array<[string, string]>): Node[] {
  if (!entries.length) return []
  return [
    {
      type: 'bulletList',
      content: entries.map(([k, v]) => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [text(`${k}: `, [{ type: 'bold' }]), ...(v ? [text(v, [])] : [])] }],
      })),
    },
  ]
}

/* ------------------------------------------------------------------ Y */

/** Block types that carry a unique `id` (the editor's BLOCK_ID_TYPES, src/app/editor/schema/base.ts). */
const BLOCK_ID_TYPES = new Set(['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem', 'codeBlock', 'horizontalRule'])

function toY(node: Node): Y.XmlElement {
  const el = new Y.XmlElement(node.type)
  if (BLOCK_ID_TYPES.has(node.type)) el.setAttribute('id', randomUUID())
  for (const [k, v] of Object.entries(node.attrs ?? {})) if (v !== null && v !== undefined) el.setAttribute(k, v as string)
  const children: Array<Y.XmlElement | Y.XmlText> = []
  let run: Node[] = []
  const flushText = () => {
    if (!run.length) return
    const t = new Y.XmlText()
    t.applyDelta(run.map((n) => ({ insert: n.text ?? '', attributes: Object.fromEntries((n.marks ?? []).map((m) => [m.type, m.attrs ?? {}])) })))
    children.push(t)
    run = []
  }
  for (const child of node.content ?? []) {
    if (child.type === 'text') run.push(child)
    else {
      flushText()
      children.push(toY(child))
    }
  }
  flushText()
  if (children.length) el.insert(0, children)
  return el
}

/** Append blocks to a content document's fragment (inside the caller's transaction). */
export function appendBlocks(doc: Y.Doc, nodes: Node[]): void {
  const frag = doc.getXmlFragment('default')
  frag.insert(frag.length, nodes.map(toY))
}

/* ------------------------------------------------------------------ plain text */

/** Same rules as the app's plainText() (store.ts): the meta document's `plain` search excerpt. */
export function plainText(nodes: Node[], max = 20_000): string {
  let out = ''
  const walk = (n: Node) => {
    if (out.length > max) return
    if (n.type === 'text' && n.text) out += n.text
    else if (n.type === 'mention' && n.attrs?.label) out += `@${String(n.attrs.label)}`
    if (n.content) {
      for (const c of n.content) walk(c)
      if (n.type !== 'text' && n.type !== 'doc') out += '\n'
    }
    if (n.type === 'meetingNotes') out += transcriptText(n.attrs?.transcript)
  }
  walk({ type: 'doc', content: nodes })
  return out.replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
}

/** A meeting-notes block's transcript (attr: [{ t, text }], the app's editor/schema/meetingNotes.ts) as lines. */
function transcriptText(transcript: unknown): string {
  if (!Array.isArray(transcript)) return ''
  let out = ''
  for (const seg of transcript) if (seg && typeof (seg as { text?: unknown }).text === 'string') out += `${(seg as { text: string }).text}\n`
  return out
}

/** Plain text of a content document's fragment (GET /api/v1/pages/:id), by the same rules. */
export function fragmentText(doc: Y.Doc, max = 100_000): string {
  let out = ''
  const walk = (n: Y.XmlElement | Y.XmlText | Y.XmlHook) => {
    if (out.length > max) return
    if (n instanceof Y.XmlText) {
      for (const d of n.toDelta() as Array<{ insert?: unknown }>) if (typeof d.insert === 'string') out += d.insert
      return
    }
    if (!(n instanceof Y.XmlElement)) return
    if (n.nodeName === 'mention') {
      const label = n.getAttribute('label')
      if (label) out += `@${String(label)}`
    }
    if (n.length) {
      for (const c of n.toArray()) walk(c)
      out += '\n'
    }
    if (n.nodeName === 'meetingNotes') out += transcriptText(n.getAttribute('transcript'))
  }
  for (const c of doc.getXmlFragment('default').toArray()) walk(c)
  return out.replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
}
