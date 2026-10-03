/**
 * A page's content document → Markdown (MCP `one_get_page`), without TipTap on the server: the
 * y-prosemirror tree (Y.XmlElements named after the node contract in CLAUDE.md, Y.XmlText with marks
 * as formatting attributes) is read into plain nodes, then written out like the app's docToMarkdown:
 * headings, lists, to-dos, quotes, code, tables, toggles, callouts, math, links and page links.
 *
 * - Page links and page mentions take the title from the workspace's meta document (`title()`); a page
 *   that isn't there (another member's private page, or deleted) is "No access" — a stored mention
 *   label is never shown for it.
 * - Comment marks and button actions never leave: comments are dropped, buttons show their label only.
 */
import * as Y from 'yjs'

export interface MarkdownContext {
  /** Title of a page in the workspace's meta document; null when it isn't there. */
  title(pageId: string): string | null
}

interface MdText {
  text: string
  marks: Record<string, unknown>
}

interface MdNode {
  type: string
  attrs: Record<string, unknown>
  /** block / inline children (elements and text runs, in order) */
  children: Array<MdNode | MdText>
}

const isText = (n: MdNode | MdText): n is MdText => 'text' in n
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')

/* ------------------------------------------------------------------ Y → nodes */

function readElement(el: Y.XmlElement, depth: number): MdNode {
  const node: MdNode = { type: el.nodeName, attrs: el.getAttributes() as Record<string, unknown>, children: [] }
  if (depth > 64) return node
  for (const c of el.toArray()) {
    if (c instanceof Y.XmlText) {
      for (const d of c.toDelta() as Array<{ insert?: unknown; attributes?: Record<string, unknown> }>) {
        if (typeof d.insert === 'string' && d.insert) node.children.push({ text: d.insert, marks: markNames(d.attributes) })
      }
    } else if (c instanceof Y.XmlElement) node.children.push(readElement(c, depth + 1))
  }
  return node
}

/** y-prosemirror keys marks that may repeat as `<name>--<hash>`: back to the mark name. */
function markNames(attributes: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(attributes ?? {})) out[k.replace(/--[A-Za-z0-9+/=_-]+$/, '')] = v
  return out
}

/* ------------------------------------------------------------------ inline */

/** Leading / trailing spaces stay outside the markers (`** bold**` is not bold). */
function wrap(text: string, open: string, close = open): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)
  if (!m || !m[2]) return text
  return `${m[1]}${open}${m[2]}${close}${m[3]}`
}

function textRun(t: MdText): string {
  const m = t.marks
  if ('code' in m) return wrap(t.text, '`')
  let s = t.text
  if ('bold' in m) s = wrap(s, '**')
  if ('italic' in m) s = wrap(s, '*')
  if ('strike' in m) s = wrap(s, '~~')
  return s
}

const linkOf = (n: MdNode | MdText): string | null => {
  if (!isText(n) || 'code' in n.marks) return null
  const link = n.marks.link as { href?: unknown } | undefined
  return link && typeof link.href === 'string' && link.href ? link.href : null
}

function inline(children: Array<MdNode | MdText>, ctx: MarkdownContext): string {
  let out = ''
  for (let i = 0; i < children.length; i++) {
    const c = children[i]!
    const href = linkOf(c)
    if (href) {
      // neighbouring runs of one link (bold inside a link …) are one link
      let label = ''
      while (i < children.length && linkOf(children[i]!) === href) label += textRun(children[i++] as MdText)
      i--
      out += `[${label}](${href})`
      continue
    }
    out += isText(c) ? textRun(c) : inlineNode(c, ctx)
  }
  return out
}

function pageRef(id: string, ctx: MarkdownContext, prefix = ''): string {
  const title = id ? ctx.title(id) : null
  if (title === null) return `${prefix}(No access)`
  return `[${prefix}${title || 'Untitled'}](#/p/${id})`
}

function inlineNode(n: MdNode, ctx: MarkdownContext): string {
  switch (n.type) {
    case 'hardBreak':
      return '\n'
    case 'mention': {
      if (n.attrs.kind === 'date' || n.attrs.kind === 'person') return `@${str(n.attrs.label) || str(n.attrs.id)}`
      return pageRef(str(n.attrs.id), ctx, '@')
    }
    case 'inlineMath':
      return `$${str(n.attrs.latex)}$`
    case 'icon': {
      // inline icon (the app's editor/schema/icon.ts): an object as [Clock], a glyph as :rocket: — like its plain text
      const name = str(n.attrs.name)
      if (!/^[\w-]{1,64}$/.test(name)) return ''
      if (n.attrs.kind !== 'asset') return `:${name}:`
      const label = name.replace(/[-_]+/g, ' ')
      return `[${label.charAt(0).toUpperCase()}${label.slice(1)}]`
    }
    case 'pageLink':
      return pageRef(str(n.attrs.pageId), ctx)
    default:
      return inline(n.children, ctx)
  }
}

/* ------------------------------------------------------------------ blocks */

/** Text of a block's inline content (its first paragraph for list items and cells). */
function blockText(n: MdNode, ctx: MarkdownContext): string {
  return inline(n.children, ctx)
}

const indent = (text: string, first: string, rest: string) =>
  text
    .split('\n')
    .map((l, i) => (i === 0 ? first + l : l ? rest + l : l))
    .join('\n')

const quote = (text: string) =>
  text
    .split('\n')
    .map((l) => (l ? `> ${l}` : '>'))
    .join('\n')

const fence = (code: string, lang = '') => {
  const ticks = /```/.test(code) ? '````' : '```'
  return `${ticks}${lang}\n${code}\n${ticks}`
}

const blockChildren = (n: MdNode) => n.children.filter((c): c is MdNode => !isText(c))

function listItem(item: MdNode, marker: string, ctx: MarkdownContext): string {
  const [first, ...rest] = blockChildren(item)
  const head = first ? (first.type === 'paragraph' ? blockText(first, ctx) : block(first, ctx)) : ''
  const tail = rest.map((b) => block(b, ctx)).filter(Boolean)
  const pad = ' '.repeat(marker.length)
  const body = [head, ...tail].join('\n')
  return indent(body, marker, pad)
}

function table(n: MdNode, ctx: MarkdownContext): string {
  const rows = blockChildren(n).map((row) =>
    blockChildren(row).map((cell) =>
      blockChildren(cell)
        .map((b) => (b.type === 'paragraph' ? blockText(b, ctx) : block(b, ctx)))
        .join('<br>')
        .replace(/\n/g, '<br>')
        .replace(/\|/g, '\\|'),
    ),
  )
  if (!rows.length) return ''
  const width = Math.max(...rows.map((r) => r.length), 1)
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`
  return [line(rows[0]!), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n')
}

function blocks(list: MdNode[], ctx: MarkdownContext): string {
  return list
    .map((b) => block(b, ctx))
    .filter((s) => s !== '')
    .join('\n\n')
}

const transcriptLines = (t: unknown): string[] =>
  Array.isArray(t) ? t.flatMap((seg) => (seg && typeof (seg as { text?: unknown }).text === 'string' ? [(seg as { text: string }).text] : [])) : []

function block(n: MdNode, ctx: MarkdownContext): string {
  const kids = blockChildren(n)
  switch (n.type) {
    case 'paragraph':
      return blockText(n, ctx)
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(n.attrs.level) || 1))
      return `${'#'.repeat(level)} ${blockText(n, ctx)}`
    }
    case 'bulletList':
      return kids.map((it) => listItem(it, '- ', ctx)).join('\n')
    case 'orderedList': {
      const start = Number(n.attrs.start) || 1
      return kids.map((it, i) => listItem(it, `${start + i}. `, ctx)).join('\n')
    }
    case 'taskList':
      return kids.map((it) => listItem(it, it.attrs.checked === true || it.attrs.checked === 'true' ? '- [x] ' : '- [ ] ', ctx)).join('\n')
    case 'listItem':
    case 'taskItem':
      return listItem(n, '- ', ctx)
    case 'blockquote':
      return quote(blocks(kids, ctx))
    case 'codeBlock':
      return fence(n.children.map((c) => (isText(c) ? c.text : '')).join(''), str(n.attrs.language))
    case 'horizontalRule':
      return '---'
    case 'callout': {
      const kind = ({ blue: 'NOTE', green: 'TIP', purple: 'IMPORTANT', yellow: 'WARNING', orange: 'WARNING', red: 'CAUTION' } as Record<string, string>)[str(n.attrs.color)] ?? 'NOTE'
      return quote(`[!${kind}]\n${blocks(kids, ctx)}`)
    }
    case 'details': {
      const summary = kids.find((k) => k.type === 'detailsSummary')
      const content = kids.find((k) => k.type === 'detailsContent')
      return `<details>\n<summary>${summary ? blockText(summary, ctx) : ''}</summary>\n\n${content ? blocks(blockChildren(content), ctx) : ''}\n\n</details>`
    }
    case 'image': {
      const alt = str(n.attrs.alt) || str(n.attrs.caption)
      return `![${alt}](${str(n.attrs.src)})${str(n.attrs.caption) ? `\n*${str(n.attrs.caption)}*` : ''}`
    }
    case 'video':
    case 'audio':
    case 'fileBlock': {
      const name = str(n.attrs.name) || str(n.attrs.caption) || n.type
      const src = str(n.attrs.src)
      return /^https?:\/\//i.test(src) ? `[${name}](${src})` : `[File: ${name}]`
    }
    case 'table':
      return table(n, ctx)
    case 'columns':
      return kids.map((col) => blocks(blockChildren(col), ctx)).filter(Boolean).join('\n\n')
    case 'blockMath':
      return `$$\n${str(n.attrs.latex)}\n$$`
    case 'mermaid':
      return fence(str(n.attrs.code), 'mermaid')
    case 'pageLink':
      return pageRef(str(n.attrs.pageId), ctx)
    case 'databaseBlock':
      return pageRef(str(n.attrs.databaseId), ctx, 'Database: ')
    case 'bookmark': {
      const url = str(n.attrs.url)
      return url ? `[${str(n.attrs.title) || url}](${url})` : ''
    }
    case 'embed': {
      const url = str(n.attrs.url)
      return url ? `[Embed${str(n.attrs.provider) ? ` (${str(n.attrs.provider)})` : ''}](${url})` : ''
    }
    case 'button':
      return `[Button: ${str(n.attrs.label)}]`
    case 'toc':
      return ''
    case 'tabs':
      return kids.map((tab) => `**${str(tab.attrs.title) || 'Tab'}**\n\n${blocks(blockChildren(tab), ctx)}`).join('\n\n')
    case 'meetingNotes': {
      const lines = transcriptLines(n.attrs.transcript)
      const head = `**${str(n.attrs.title) || 'Meeting notes'}**`
      const body = blocks(kids, ctx)
      const transcript = lines.length ? `\n\n<details>\n<summary>Transcript</summary>\n\n${lines.join('\n')}\n\n</details>` : ''
      return `${head}${body ? `\n\n${body}` : ''}${transcript}`
    }
    default:
      // syncedBlock, column, tab, unknown containers: their blocks; unknown leaves: their text
      return kids.length && kids.length === n.children.length ? blocks(kids, ctx) : blockText(n, ctx)
  }
}

/**
 * Markdown of a content document's fragment (`default`). Long documents are cut at `max` characters
 * (at a block boundary when possible).
 */
export function fragmentMarkdown(doc: Y.Doc, ctx: MarkdownContext, max = 100_000): { markdown: string; truncated: boolean } {
  const top: MdNode[] = []
  for (const c of doc.getXmlFragment('default').toArray()) if (c instanceof Y.XmlElement) top.push(readElement(c, 0))
  let out = ''
  let truncated = false
  for (const b of top) {
    const md = block(b, ctx)
    if (md === '') continue
    const next = out ? `${out}\n\n${md}` : md
    if (next.length > max) {
      truncated = true
      if (!out) out = md.slice(0, max)
      break
    }
    out = next
  }
  return { markdown: out.replace(/\n{3,}/g, '\n\n'), truncated }
}

/** Page ids a content document links to: page links, page mentions, `#/p/<id>` links, database blocks. */
export function fragmentLinks(doc: Y.Doc): Set<string> {
  const out = new Set<string>()
  const walk = (el: Y.XmlElement | Y.XmlFragment, depth: number) => {
    if (depth > 64) return
    for (const c of el.toArray()) {
      if (c instanceof Y.XmlText) {
        for (const d of c.toDelta() as Array<{ attributes?: Record<string, unknown> }>) {
          const href = (d.attributes?.link as { href?: unknown } | undefined)?.href
          const m = typeof href === 'string' ? /#\/p\/([\w-]+)/.exec(href) : null
          if (m?.[1]) out.add(m[1])
        }
      } else if (c instanceof Y.XmlElement) {
        const a = c.getAttributes() as Record<string, unknown>
        if (c.nodeName === 'pageLink' && typeof a.pageId === 'string') out.add(a.pageId)
        if (c.nodeName === 'mention' && (a.kind ?? 'page') === 'page' && typeof a.id === 'string') out.add(a.id)
        if (c.nodeName === 'databaseBlock' && typeof a.databaseId === 'string') out.add(a.databaseId)
        walk(c, depth + 1)
      }
    }
  }
  walk(doc.getXmlFragment('default'), 0)
  return out
}
