/**
 * Toggle headings — the `details` node (toggle) with attr `heading`: 0 = plain toggle list,
 * 1–3 = "Toggle heading 1–3". Existing documents (no attr) stay plain toggles.
 *
 * - The title (detailsSummary) takes that heading's typography; a node decoration gives it
 *   role="heading" + aria-level with the same outline offset as schema/heading.ts.
 * - Node view: the stock one, but it keeps every attr when the chevron flips `open`
 *   (the stock view resets id + heading) and mirrors `data-heading` on updates.
 * - Markdown: <details><summary><h2>Title</h2></summary> … </details> (heading level = tag).
 * - Static HTML: <details data-heading="2"> — exports wrap the summary into <hN> themselves.
 * - Shortcuts: "> " at the start of a heading, ">## " at the start of a line, "## " at the
 *   start of a toggle title.
 */
import { Extension, InputRule, mergeAttributes, type JSONContent, type MarkdownToken } from '@tiptap/core'
import { DetailsSummary, type DetailsOptions } from '@tiptap/extension-details'
import type { Fragment, Node as PMNode, ResolvedPos, Schema } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type ViewMutationRecord } from '@tiptap/pm/view'
import { MarkdownDetails } from './nodes'

export type ToggleHeadingLevel = 0 | 1 | 2 | 3

/** Heading level of a toggle (0 = plain toggle list). */
export function toggleHeadingLevel(node: { attrs?: Record<string, unknown> | null } | null | undefined): ToggleHeadingLevel {
  const n = Number(node?.attrs?.heading)
  return n === 1 || n === 2 || n === 3 ? n : 0
}

const HEADING_TAGS = 'h1, h2, h3, h4, h5, h6'

/** data-heading, else the level of a heading inside the summary (our exports, GitHub-style HTML). */
function headingFromDom(el: HTMLElement): ToggleHeadingLevel {
  const own = toggleHeadingLevel({ attrs: { heading: el.getAttribute('data-heading') } })
  if (own) return own
  const h = el.querySelector(`:scope > summary > :is(${HEADING_TAGS})`)
  if (!h) return 0
  const level = Number(h.getAttribute('data-level')) || Number(h.tagName.slice(1))
  return Math.max(1, Math.min(3, level)) as ToggleHeadingLevel
}

export interface ToggleDetailsOptions extends DetailsOptions {
  /** Added to the heading level for aria-level (1 under a page title, like OutlineHeading). */
  outlineOffset: number
}

const decoKey = new PluginKey<DecorationSet>('toggleHeadings')

/** role="heading" + aria-level on the titles of toggle headings. */
function headingDecos(doc: PMNode, offset: number): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.isTextblock || node.isAtom) return false
    const level = node.type.name === 'details' ? toggleHeadingLevel(node) : 0
    const summary = level ? node.firstChild : null
    if (summary && summary.type.name === 'detailsSummary')
      decos.push(Decoration.node(pos + 1, pos + 1 + summary.nodeSize, { role: 'heading', 'aria-level': String(Math.min(6, level + Math.max(0, offset))) }))
    return true
  })
  return decos.length ? DecorationSet.create(doc, decos) : DecorationSet.empty
}

const baseTokenizer = MarkdownDetails.config.markdownTokenizer!

export const ToggleDetails = MarkdownDetails.extend<ToggleDetailsOptions>({
  addOptions() {
    return { ...(this.parent?.() as DetailsOptions), outlineOffset: 0 }
  },

  addAttributes() {
    const parent = this.parent?.()
    return {
      ...(parent && !Array.isArray(parent) ? parent : {}),
      heading: {
        default: 0,
        parseHTML: (el: HTMLElement) => headingFromDom(el),
        renderHTML: (a: Record<string, unknown>) => {
          const level = toggleHeadingLevel({ attrs: a })
          return level ? { 'data-heading': String(level) } : {}
        },
      },
    }
  },

  markdownTokenizer: {
    ...baseTokenizer,
    tokenize(src, tokens, lexer) {
      const tok = baseTokenizer.tokenize(src, tokens, lexer) as (MarkdownToken & { summary?: string }) | undefined
      if (!tok) return undefined
      const m = /^<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>$/i.exec(String(tok.summary ?? '').trim())
      return m ? ({ ...tok, heading: Math.min(3, Number(m[1])), summary: m[2].trim() } as MarkdownToken) : tok
    },
  },

  parseMarkdown(token, h) {
    const out = this.parent?.(token, h) as JSONContent | undefined
    const level = toggleHeadingLevel({ attrs: { heading: token.heading } })
    return out && level ? { ...out, attrs: { ...out.attrs, heading: level } } : (out ?? [])
  },

  renderMarkdown(node, h) {
    const [summary, content] = (node.content ?? []) as JSONContent[]
    // renderChildren already escapes HTML-significant characters in text
    const sum = summary?.content ? h.renderChildren(summary.content).replace(/\n/g, ' ') : ''
    const body = content?.content ? h.renderChildren(content.content, '\n\n') : ''
    const level = toggleHeadingLevel(node)
    const title = level ? `<h${level}>${sum}</h${level}>` : sum
    return `<details${node.attrs?.open ? ' open' : ''}>\n<summary>${title}</summary>\n\n${body}\n\n</details>`
  },

  addNodeView() {
    return ({ editor, getPos, node, HTMLAttributes }) => {
      const { openClassName } = this.options
      const dom = document.createElement('div')
      const attributes = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-type': this.name })
      Object.entries(attributes).forEach(([key, value]) => dom.setAttribute(key, String(value)))
      const toggle = document.createElement('button')
      toggle.type = 'button'
      const content = document.createElement('div')
      dom.append(toggle, content)
      let current = node

      const syncHeading = (n: PMNode) => {
        const level = toggleHeadingLevel(n)
        if (level) dom.setAttribute('data-heading', String(level))
        else dom.removeAttribute('data-heading')
      }
      const setOpen = (open: boolean) => {
        if (dom.classList.contains(openClassName) === open) return
        dom.classList.toggle(openClassName, open)
        this.options.renderToggleButton({ element: toggle, isOpen: open, node: current })
        // DetailsContent's own view hides itself until it hears this event
        content.querySelector(':scope > div[data-type="detailsContent"]')?.dispatchEvent(new Event('toggleDetailsContent'))
      }

      this.options.renderToggleButton({ element: toggle, isOpen: Boolean(node.attrs.open), node })
      // the content view is created right after this one: open once it exists
      if (node.attrs.open) setTimeout(() => setOpen(true))

      toggle.addEventListener('click', () => {
        const open = !dom.classList.contains(openClassName)
        setOpen(open)
        if (!editor.isEditable || typeof getPos !== 'function') return
        const { from, to } = editor.state.selection
        editor
          .chain()
          .command(({ tr }) => {
            const pos = getPos()
            const at = typeof pos === 'number' ? tr.doc.nodeAt(pos) : null
            if (typeof pos !== 'number' || at?.type !== this.type) return false
            // keep id + heading: only `open` flips
            tr.setNodeMarkup(pos, undefined, { ...at.attrs, open })
            return true
          })
          .setTextSelection({ from, to })
          .focus(undefined, { scrollIntoView: false })
          .run()
      })

      return {
        dom,
        contentDOM: content,
        ignoreMutation(mutation: ViewMutationRecord) {
          if (mutation.type === 'selection') return false
          return toggle.contains(mutation.target) || !dom.contains(mutation.target) || dom === mutation.target
        },
        update: (updated: PMNode) => {
          if (updated.type !== this.type) return false
          current = updated
          syncHeading(updated)
          setOpen(Boolean(updated.attrs.open))
          return true
        },
      }
    }
  },

  addProseMirrorPlugins() {
    const offset = this.options.outlineOffset
    return [
      ...(this.parent?.() ?? []),
      new Plugin<DecorationSet>({
        key: decoKey,
        state: {
          init: (_, state) => headingDecos(state.doc, offset),
          apply: (tr, set) => (tr.docChanged ? headingDecos(tr.doc, offset) : set),
        },
        props: {
          decorations: (state) => decoKey.getState(state),
        },
      }),
    ]
  },
})

/** <summary><h2>Title</h2></summary> (exports, GitHub) → the title text, not a lost heading. */
export const ToggleSummary = DetailsSummary.extend({
  parseHTML() {
    return [{ tag: 'summary', contentElement: (dom: Node) => (dom as HTMLElement).querySelector<HTMLElement>(`:scope > :is(${HEADING_TAGS})`) ?? (dom as HTMLElement) }]
  },
})

/** A toggle heading holding `content` as its title and an empty body. */
export function toggleHeadingNode(schema: Schema, level: ToggleHeadingLevel, content: Fragment | null, attrs: Record<string, unknown> = {}): PMNode {
  return schema.nodes.details.create({ ...attrs, open: true, heading: level }, [
    schema.nodes.detailsSummary.create(null, content),
    schema.nodes.detailsContent.create(null, schema.nodes.paragraph.create()),
  ])
}

/** May the block at `$pos` be replaced by a toggle (not inside a list item's first line …)? */
function fitsToggle($pos: ResolvedPos): boolean {
  const index = $pos.index(-1)
  return $pos.node(-1).canReplaceWith(index, index + 1, $pos.doc.type.schema.nodes.details)
}

/**
 * Markdown shortcuts. Runs before StarterKit's rules ("> " in a heading would otherwise
 * wrap it in a quote); never on a node priority (that would reorder the schema).
 */
export const ToggleHeadingInput = Extension.create({
  name: 'toggleHeadingInput',
  priority: 1000,
  addInputRules() {
    return [
      // "> " at the start of a heading → toggle heading of that level (the text stays the title)
      new InputRule({
        find: /^>\s$/,
        handler: ({ state, range }) => {
          const $from = state.doc.resolve(range.from)
          const block = $from.parent
          if (block.type.name !== 'heading' || $from.parentOffset !== 0 || !fitsToggle($from)) return null
          const level = Math.max(1, Math.min(3, Number(block.attrs.level))) as ToggleHeadingLevel
          const rest = block.content.cut(range.to - $from.start())
          const from = $from.before()
          const node = toggleHeadingNode(state.schema, level, rest, { id: block.attrs.id ?? null })
          const { tr } = state
          tr.replaceWith(from, $from.after(), node)
          tr.setSelection(TextSelection.create(tr.doc, from + 2))
        },
      }),
      // ">## " at the start of a line → toggle heading 2 (the line's text stays the title)
      new InputRule({
        find: /^>(#{1,3})\s$/,
        handler: ({ state, range, match }) => {
          const $from = state.doc.resolve(range.from)
          const block = $from.parent
          if (block.type.name !== 'paragraph' || $from.parentOffset !== 0 || !fitsToggle($from)) return null
          const rest = block.content.cut(range.to - $from.start())
          const from = $from.before()
          const { tr } = state
          tr.replaceWith(from, $from.after(), toggleHeadingNode(state.schema, match[1].length as ToggleHeadingLevel, rest))
          tr.setSelection(TextSelection.create(tr.doc, from + 2))
        },
      }),
      // "## " at the start of a toggle title → that toggle becomes a toggle heading 2
      new InputRule({
        find: /^(#{1,3})\s$/,
        handler: ({ state, range, match }) => {
          const $from = state.doc.resolve(range.from)
          if ($from.parent.type.name !== 'detailsSummary' || $from.parentOffset !== 0) return null
          const details = $from.node(-1)
          const { tr } = state
          tr.delete(range.from, range.to)
          tr.setNodeMarkup($from.before(-1), undefined, { ...details.attrs, heading: match[1].length })
        },
      }),
    ]
  },
})
