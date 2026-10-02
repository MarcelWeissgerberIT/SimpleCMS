/**
 * Custom TipTap nodes & marks (schema only — no React node views here).
 * Node names / attrs are the shared contract documented in CLAUDE.md.
 * React node views are attached in ../extensions/kit.ts via .extend({ addNodeView }).
 */
import { Extension, Node, mergeAttributes, type JSONContent } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import Highlight from '@tiptap/extension-highlight'
import { Details } from '@tiptap/extension-details'
import { InlineMath } from '@tiptap/extension-mathematics'
import { useWorkspace } from '../../store/store'
import { domainOf, embedSrc, detectProvider, PROVIDER_LABEL, type EmbedProvider } from '../lib/embeds'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textColor: {
      setTextColor: (color: string) => ReturnType
      unsetTextColor: () => ReturnType
    }
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const titleOf = (id: string) => {
  const p = id ? useWorkspace.getState().pages[id] : undefined
  return p?.title?.trim() || ''
}
const mdEscape = (s: string) => s.replace(/([[\]\\])/g, '\\$1')

/** Callout icon stored as an emoji string or "asset:<name>". */
export function calloutIconText(icon: unknown): string {
  if (typeof icon === 'string') return icon.startsWith('asset:') ? '' : icon
  if (icon && typeof icon === 'object' && 'value' in icon) return String((icon as { value: string }).value)
  return '💡'
}

/* ------------------------------------------------------------------ */
/* Callout                                                             */
/* ------------------------------------------------------------------ */

const ALERT_FOR_COLOR: Record<string, string> = {
  blue: 'NOTE',
  green: 'TIP',
  purple: 'IMPORTANT',
  yellow: 'WARNING',
  orange: 'WARNING',
  red: 'CAUTION',
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  draggable: false,
  addAttributes() {
    return {
      icon: {
        default: '💡',
        parseHTML: (el) => el.getAttribute('data-icon') || '💡',
        renderHTML: (a) => ({ 'data-icon': typeof a.icon === 'string' ? a.icon : calloutIconText(a.icon) }),
      },
      color: {
        default: 'gray',
        parseHTML: (el) => el.getAttribute('data-color') || 'gray',
        renderHTML: (a) => ({ 'data-color': a.color }),
      },
    }
  },
  parseHTML() {
    return [
      { tag: 'div[data-type="callout"]', contentElement: (dom) => (dom as HTMLElement).querySelector<HTMLElement>(':scope > .callout__body') ?? (dom as HTMLElement) },
      { tag: 'aside' },
    ]
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'callout', class: `callout callout--${node.attrs.color || 'gray'}` }),
      ['span', { class: 'callout__icon', contenteditable: 'false' }, calloutIconText(node.attrs.icon) || '•'],
      ['div', { class: 'callout__body' }, 0],
    ]
  },
  renderMarkdown(node, h) {
    const kind = ALERT_FOR_COLOR[node.attrs?.color as string] ?? 'NOTE'
    const icon = calloutIconText(node.attrs?.icon)
    const body = h.renderChildren(node.content ?? [], '\n\n')
    const lines = [`[!${kind}]`, ...(icon ? [`${icon} ${body}`] : [body]).join('\n').split('\n')]
    return lines.map((l) => (l ? `> ${l}` : '>')).join('\n')
  },
})

/* ------------------------------------------------------------------ */
/* Columns                                                             */
/* ------------------------------------------------------------------ */

export const Columns = Node.create({
  name: 'columns',
  group: 'block',
  content: 'column{2,4}',
  defining: true,
  isolating: true,
  parseHTML() {
    return [{ tag: 'div[data-type="columns"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'columns', class: 'columns', style: `--cols:${node.childCount}` }), 0]
  },
  renderMarkdown(node, h) {
    return h.renderChildren(node.content ?? [], '\n\n')
  },
})

export const Column = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-type="column"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'column', class: 'column' }), 0]
  },
  renderMarkdown(node, h) {
    return h.renderChildren(node.content ?? [], '\n\n')
  },
})

/* ------------------------------------------------------------------ */
/* Atom blocks                                                         */
/* ------------------------------------------------------------------ */

export const Mermaid = Node.create({
  name: 'mermaid',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      code: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-code') ?? el.textContent ?? '',
        renderHTML: (a) => ({ 'data-code': a.code }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="mermaid"]' }, { tag: 'pre.mermaid', priority: 60 }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'mermaid' }), ['pre', { class: 'mermaid' }, str(node.attrs.code)]]
  },
  renderText({ node }) {
    return str(node.attrs.code)
  },
  renderMarkdown(node) {
    return '```mermaid\n' + str(node.attrs?.code) + '\n```'
  },
})

export const PageLink = Node.create({
  name: 'pageLink',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      pageId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-page-id'),
        renderHTML: (a) => ({ 'data-page-id': a.pageId }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="page-link"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const id = str(node.attrs.pageId)
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'page-link', class: 'page-link' }), ['a', { href: `#/p/${id}` }, titleOf(id) || 'Untitled']]
  },
  renderText({ node }) {
    return titleOf(str(node.attrs.pageId)) || 'Untitled'
  },
  renderMarkdown(node) {
    const id = str(node.attrs?.pageId)
    return `[${mdEscape(titleOf(id) || 'Untitled')}](#/p/${id})`
  },
})

export const DatabaseBlock = Node.create({
  name: 'databaseBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      databaseId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-database-id'),
        renderHTML: (a) => ({ 'data-database-id': a.databaseId }),
      },
      viewId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-view-id'),
        renderHTML: (a) => (a.viewId ? { 'data-view-id': a.viewId } : {}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="database"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const id = str(node.attrs.databaseId)
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'database', class: 'database-block' }), ['a', { href: `#/p/${id}` }, titleOf(id) || 'Database']]
  },
  renderText({ node }) {
    return titleOf(str(node.attrs.databaseId)) || 'Database'
  },
  renderMarkdown(node) {
    const id = str(node.attrs?.databaseId)
    return `[${mdEscape(titleOf(id) || 'Database')}](#/p/${id})`
  },
})

export const Bookmark = Node.create({
  name: 'bookmark',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    const a = (name: string) => ({
      default: name === 'url' ? '' : null,
      parseHTML: (el: HTMLElement) => el.getAttribute(`data-${name}`),
      renderHTML: (attrs: Record<string, unknown>) => (attrs[name] ? { [`data-${name}`]: attrs[name] } : {}),
    })
    return { url: a('url'), title: a('title'), description: a('description'), image: a('image') }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="bookmark"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const url = str(node.attrs.url)
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'bookmark', class: 'bookmark' }),
      ['a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, str(node.attrs.title) || domainOf(url)],
      ['span', { class: 'bookmark__url' }, url],
    ]
  },
  renderText({ node }) {
    return str(node.attrs.url)
  },
  renderMarkdown(node) {
    const url = str(node.attrs?.url)
    return `[${mdEscape(str(node.attrs?.title) || domainOf(url))}](${url})`
  },
})

export const Embed = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      url: { default: '', parseHTML: (el) => el.getAttribute('data-url') ?? '', renderHTML: (a) => ({ 'data-url': a.url }) },
      provider: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-provider'),
        renderHTML: (a) => (a.provider ? { 'data-provider': a.provider } : {}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="embed"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const url = str(node.attrs.url)
    const src = embedSrc(url, node.attrs.provider)
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'embed', class: 'embed' }),
      src
        ? ['iframe', { src, loading: 'lazy', allowfullscreen: 'true', sandbox: 'allow-scripts allow-same-origin allow-popups allow-presentation allow-forms', referrerpolicy: 'strict-origin-when-cross-origin' }]
        : ['a', { href: url }, url],
    ]
  },
  renderText({ node }) {
    return str(node.attrs.url)
  },
  renderMarkdown(node) {
    const url = str(node.attrs?.url)
    const p = (node.attrs?.provider as EmbedProvider) || detectProvider(url) || 'web'
    return `[${PROVIDER_LABEL[p] ?? 'Embed'}: ${mdEscape(domainOf(url))}](${url})`
  },
})

export const Toc = Node.create({
  name: 'toc',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div[data-type="toc"]' }, { tag: 'nav[data-type="toc"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['nav', mergeAttributes(HTMLAttributes, { 'data-type': 'toc', class: 'toc' })]
  },
  renderMarkdown() {
    return ''
  },
})

export const FileBlock = Node.create({
  name: 'fileBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      src: { default: '', parseHTML: (el) => el.getAttribute('data-src') ?? '', renderHTML: (a) => ({ 'data-src': a.src }) },
      name: { default: 'file', parseHTML: (el) => el.getAttribute('data-name') ?? 'file', renderHTML: (a) => ({ 'data-name': a.name }) },
      size: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute('data-size') ?? 0),
        renderHTML: (a) => ({ 'data-size': String(a.size ?? 0) }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="file"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'file', class: 'file-block' }), ['a', { href: str(node.attrs.src), download: str(node.attrs.name) }, str(node.attrs.name)]]
  },
  renderText({ node }) {
    return str(node.attrs.name)
  },
  renderMarkdown(node) {
    return `[📎 ${mdEscape(str(node.attrs?.name))}](${str(node.attrs?.src)})`
  },
})

/* ------------------------------------------------------------------ */
/* Mention (inline)                                                    */
/* ------------------------------------------------------------------ */

export const Mention = Node.create({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute('data-id'), renderHTML: (a) => ({ 'data-id': a.id }) },
      label: { default: null, parseHTML: (el) => el.getAttribute('data-label'), renderHTML: (a) => ({ 'data-label': a.label }) },
      kind: { default: 'page', parseHTML: (el) => el.getAttribute('data-kind') ?? 'page', renderHTML: (a) => ({ 'data-kind': a.kind }) },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-type="mention"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const label = node.attrs.kind === 'page' ? titleOf(str(node.attrs.id)) || str(node.attrs.label) : str(node.attrs.label)
    const attrs = mergeAttributes(HTMLAttributes, { 'data-type': 'mention', class: `mention mention--${node.attrs.kind}` })
    if (node.attrs.kind === 'page') return ['span', attrs, ['a', { href: `#/p/${str(node.attrs.id)}` }, label || 'Untitled']]
    return ['span', attrs, `@${label}`]
  },
  renderText({ node }) {
    const label = node.attrs.kind === 'page' ? titleOf(str(node.attrs.id)) || str(node.attrs.label) : str(node.attrs.label)
    return `@${label}`
  },
  renderMarkdown(node) {
    const a = node.attrs ?? {}
    if (a.kind === 'page') return `[@${mdEscape(titleOf(str(a.id)) || str(a.label) || 'Untitled')}](#/p/${str(a.id)})`
    return `@${str(a.label)}`
  },
})

/* ------------------------------------------------------------------ */
/* Extended stock nodes / marks                                        */
/* ------------------------------------------------------------------ */

/** Image with caption, width (px) and alignment. Rendered as <figure>. */
export const BlockImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      caption: { default: '', parseHTML: (el) => el.getAttribute('data-caption') ?? el.querySelector?.('figcaption')?.textContent ?? '' },
      width: {
        default: null,
        parseHTML: (el) => {
          const w = el.getAttribute('data-width') ?? el.getAttribute('width')
          return w ? Number(w) || null : null
        },
      },
      align: { default: 'center', parseHTML: (el) => el.getAttribute('data-align') ?? 'center' },
    }
  },
  parseHTML() {
    return [
      {
        tag: 'figure[data-type="image"]',
        getAttrs: (el) => {
          const img = (el as HTMLElement).querySelector('img')
          if (!img) return false
          return {
            src: img.getAttribute('src'),
            alt: img.getAttribute('alt'),
            caption: (el as HTMLElement).querySelector('figcaption')?.textContent ?? '',
            width: Number((el as HTMLElement).getAttribute('data-width')) || null,
            align: (el as HTMLElement).getAttribute('data-align') ?? 'center',
          }
        },
      },
      { tag: 'img[src]' },
    ]
  },
  renderHTML({ node }) {
    const { src, alt, caption, width, align } = node.attrs
    const fig: Record<string, string> = { 'data-type': 'image', class: 'image', 'data-align': align || 'center' }
    if (width) {
      fig['data-width'] = String(width)
      fig.style = `width:${width}px;max-width:100%`
    }
    const img = ['img', { src, alt: alt ?? '', loading: 'lazy' }] as const
    return caption ? ['figure', fig, img, ['figcaption', {}, caption]] : ['figure', fig, img]
  },
}).configure({ inline: false, allowBase64: true })

/** Highlight with a ColorName (rendered via CSS vars). */
export const ColorHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: 'yellow',
        parseHTML: (el) => el.getAttribute('data-color') || 'yellow',
        renderHTML: (a) => ({ 'data-color': a.color, style: `background-color: var(--c-${a.color}-bg); color: inherit` }),
      },
    }
  },
}).configure({ multicolor: true })

/** `color` attribute on the textStyle mark (ColorName). */
export const TextColor = Extension.create({
  name: 'textColor',
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          color: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-color') || null,
            renderHTML: (a) => (a.color ? { 'data-color': a.color, style: `color: var(--c-${a.color}-text)` } : {}),
          },
        },
      },
    ]
  },
  addCommands() {
    return {
      setTextColor:
        (color: string) =>
        ({ chain }) =>
          chain().setMark('textStyle', { color }).run(),
      unsetTextColor:
        () =>
        ({ chain }) =>
          chain().setMark('textStyle', { color: null }).removeEmptyTextStyle().run(),
    }
  },
})

/* ------------------------------------------------------------------ */
/* Toggle (details) — markdown as <details><summary>                   */
/* ------------------------------------------------------------------ */

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function findDetailsEnd(src: string): number {
  // returns index right after the matching </details>, honouring nesting
  const re = /<details\b[^>]*>|<\/details>/gi
  let depth = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    if (m[0][1] === '/') {
      depth--
      if (depth === 0) return m.index + m[0].length
    } else depth++
  }
  return -1
}

export const MarkdownDetails = Details.extend({
  markdownTokenizer: {
    name: 'details',
    level: 'block',
    start: (src: string) => src.search(/<details\b/i),
    tokenize(src: string, _tokens: unknown, lexer: { blockTokens: (s: string) => unknown[] }) {
      if (!/^<details\b/i.test(src)) return undefined
      const end = findDetailsEnd(src)
      if (end < 0) return undefined
      const raw = src.slice(0, end)
      const open = /^<details\b[^>]*\bopen\b/i.test(raw)
      const sm = raw.match(/^<details\b[^>]*>\s*<summary>([\s\S]*?)<\/summary>/i)
      const summary = sm ? sm[1].trim() : ''
      const inner = raw.slice(sm ? sm[0].length : raw.indexOf('>') + 1, raw.length - '</details>'.length)
      const trailing = src.slice(end).match(/^[ \t]*\n?/)?.[0] ?? ''
      return { type: 'details', raw: raw + trailing, open, summary, tokens: lexer.blockTokens(inner.trim()) } as never
    },
  },
  parseMarkdown(token, h) {
    const summaryTokens = h.tokenizeInline ? h.tokenizeInline(String(token.summary ?? '')) : []
    const summary = summaryTokens.length ? h.parseInline(summaryTokens) : token.summary ? [h.createTextNode(String(token.summary))] : []
    let body = h.parseChildren((token.tokens as never[]) ?? [])
    if (!body.length) body = [{ type: 'paragraph' }]
    return h.createNode('details', { open: !!token.open }, [h.createNode('detailsSummary', {}, summary), h.createNode('detailsContent', {}, body)])
  },
  renderMarkdown(node, h) {
    const [summary, content] = (node.content ?? []) as JSONContent[]
    const sum = summary?.content ? escHtml(h.renderChildren(summary.content)) : ''
    const body = content?.content ? h.renderChildren(content.content, '\n\n') : ''
    return `<details${node.attrs?.open ? ' open' : ''}>\n<summary>${sum}</summary>\n\n${body}\n\n</details>`
  },
})

/** Inline math with a stricter `$…$` tokenizer (doesn't eat currency like "$5 and $10"). */
export const StrictInlineMath = InlineMath.extend({
  markdownTokenizer: {
    name: 'inlineMath',
    level: 'inline',
    start: (src: string) => src.indexOf('$'),
    tokenize(src: string) {
      const m = src.match(/^\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/)
      if (!m) return undefined
      return { type: 'inlineMath', raw: m[0], latex: m[1].trim() } as never
    },
  },
})
