/**
 * Breadcrumb block (schema only — the live view is ../views/BreadcrumbView.tsx).
 *
 *   breadcrumb  atom; attrs: path = null — live: the path of the page the block sits on
 *               (workspace › ancestors › page, links, follows renames and moves) — or the
 *               frozen titles [workspace, …, page] that stripPrivate() / the exports write
 *               when a doc leaves the workspace (lib/breadcrumbs.ts).
 *
 * Static HTML: <nav data-type="breadcrumb"> with the frozen titles as text. A pasted breadcrumb
 * never keeps a path: it shows the page it lands on. Markdown: "<!-- breadcrumb -->" on its own
 * line with the path as plain text below — the path reads anywhere, and One reads the block back.
 */
import { Node, mergeAttributes, type MarkdownToken } from '@tiptap/core'
import { t } from '../../i18n'
import { escapeMarkdownText } from '../lib/mdText'
import { frozenPathOf } from '../lib/breadcrumbs'

export const BREADCRUMB_SEP = '›'

const MARKER = /^<!--\s*breadcrumb\s*-->[ \t]*(?:\n[^\n]*›[^\n]*)?(?:\n|$)/i

export const Breadcrumb = Node.create({
  name: 'breadcrumb',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      path: {
        default: null,
        // never read back from markup: a pasted breadcrumb shows the path of the page it lands on
        parseHTML: () => null,
        renderHTML: () => ({}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'nav[data-type="breadcrumb"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const path = frozenPathOf(node.attrs.path) ?? []
    const items = path.flatMap((label, i) => {
      const item = ['span', { class: 'breadcrumb__item' }, label] as const
      return i ? [['span', { class: 'breadcrumb__sep', 'aria-hidden': 'true' }, BREADCRUMB_SEP] as const, item] : [item]
    })
    return ['nav', mergeAttributes(HTMLAttributes, { 'data-type': 'breadcrumb', class: 'breadcrumb', 'aria-label': t('editor.block.breadcrumb') }), ...items]
  },
  renderText({ node }) {
    return (frozenPathOf(node.attrs.path) ?? []).join(` ${BREADCRUMB_SEP} `)
  },
  markdownTokenizer: {
    name: 'breadcrumb',
    level: 'block',
    start: (src: string) => src.search(/<!--\s*breadcrumb\s*-->/i),
    tokenize(src: string) {
      const m = MARKER.exec(src)
      return m ? ({ type: 'breadcrumb', raw: m[0] } as MarkdownToken) : undefined
    },
  },
  parseMarkdown(_token, h) {
    return h.createNode('breadcrumb', { path: null })
  },
  renderMarkdown(node) {
    const path = frozenPathOf(node.attrs?.path)
    return path ? `<!-- breadcrumb -->\n${path.map((s) => escapeMarkdownText(s)).join(` ${BREADCRUMB_SEP} `)}` : '<!-- breadcrumb -->'
  },
})
