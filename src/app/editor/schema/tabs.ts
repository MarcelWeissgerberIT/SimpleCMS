/**
 * Tabs block: `tabs` (container, attrs: id) holding `tab` panels (attrs: title; content: blocks).
 *
 * - Every tab stays in the document (search, export, history); only the active one is shown.
 * - Which tab is active is VIEW state, kept per editor in the `tabs` plugin below. Switching
 *   dispatches a meta-only transaction: the document (and its contentRev) never changes.
 * - The caret never stays in a hidden tab: switching moves it along, and a selection that lands
 *   in a hidden tab (undo, block link, search …) shows that tab.
 * - Tabs inside tabs are not allowed: nested ones are flattened (title line + content).
 * - Static HTML (export): radio inputs + labels, the panels switch with CSS (:has), no script.
 * - Markdown: "<!-- tabs -->" … "<!-- tab -->" + "**Title**" + content … "<!-- /tabs -->"
 *   (renders as bold title lines on GitHub, imports back into a tabs block).
 * The React node view (strip, rename, add, menu) lives in ../views/TabsView.tsx.
 */
import { Node, mergeAttributes, type JSONContent } from '@tiptap/core'
import { Fragment, type Node as PMNode, type ResolvedPos, type Schema } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { t } from '../../i18n'
import { escapeMarkdownText } from '../lib/mdText'

/* ------------------------------------------------------------------ */
/* View state                                                          */
/* ------------------------------------------------------------------ */

export interface TabsInfo {
  /** Index of the active tab. */
  index: number
  /** Key of the tabs block in the plugin state (its id, or "#<n>" for blocks without one). */
  key: string
  /** Prefix for DOM ids (tab ↔ panel ARIA links), unique per editor. */
  idBase: string
}

interface TabsState {
  /** Active tab per tabs block: by tab id when it has one, else by index. */
  active: Record<string, { id: string | null; index: number }>
  deco: DecorationSet
  /** Number of tabs blocks in the doc (0 → most work is skipped). */
  count: number
  base: string
}

interface TabsMeta {
  key: string
  index: number
  id?: string | null
}

export const tabsKey = new PluginKey<TabsState>('tabs')
let editorSeq = 0

const isTabs = (n: PMNode | null | undefined): n is PMNode => !!n && n.type.name === 'tabs'

/** Key of a tabs block: its id; blocks without one are keyed by their order in the doc. */
function keyAt(doc: PMNode, pos: number, node: PMNode): string {
  const id = node.attrs.id as string | null
  if (id) return id
  let n = 0
  let found = -1
  doc.descendants((child, p) => {
    if (found >= 0) return false
    if (isTabs(child)) {
      if (p === pos) found = n
      n++
      return false
    }
    return !child.isTextblock && !child.isAtom
  })
  return `#${Math.max(0, found)}`
}

function activeIndex(st: Pick<TabsState, 'active'>, key: string, node: PMNode): number {
  const e = st.active[key]
  if (!e) return 0
  if (e.id) for (let i = 0; i < node.childCount; i++) if (node.child(i).attrs.id === e.id) return i
  return Math.min(Math.max(0, e.index), node.childCount - 1)
}

const domSafe = (s: string) => s.replace(/[^\w-]/g, '')

function buildDecos(doc: PMNode, st: Pick<TabsState, 'active' | 'base'>): { deco: DecorationSet; count: number } {
  const decos: Decoration[] = []
  let n = 0
  doc.descendants((node, pos) => {
    if (!isTabs(node)) return !node.isTextblock && !node.isAtom
    const key = (node.attrs.id as string | null) || `#${n}`
    n++
    const index = activeIndex(st, key, node)
    const idBase = `${st.base}-${domSafe(key)}`
    const info: TabsInfo = { index, key, idBase }
    decos.push(Decoration.node(pos, pos + node.nodeSize, { 'data-active-tab': String(index) }, { tabs: info }))
    let p = pos + 1
    node.forEach((tab, _o, i) => {
      decos.push(
        Decoration.node(p, p + tab.nodeSize, {
          class: i === index ? 'is-active' : 'is-inactive',
          role: 'tabpanel',
          id: `${idBase}-p${i}`,
          'aria-labelledby': `${idBase}-t${i}`,
        }),
      )
      p += tab.nodeSize
    })
    return false
  })
  return { deco: n ? DecorationSet.create(doc, decos) : DecorationSet.empty, count: n }
}

/** The tabs block around a position (nested tabs are not allowed, so there is at most one). */
export function tabsAround($pos: ResolvedPos): { tabsPos: number; node: PMNode; index: number } | null {
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.name === 'tab' && d > 1 && isTabs($pos.node(d - 1))) return { tabsPos: $pos.before(d - 1), node: $pos.node(d - 1), index: $pos.index(d - 1) }
  }
  return null
}

/** The tabs view state of the block at `tabsPos` (null when it is not a tabs block). */
export function tabsInfoAt(state: EditorState, tabsPos: number): TabsInfo | null {
  const node = state.doc.nodeAt(tabsPos)
  const st = tabsKey.getState(state)
  if (!isTabs(node) || !st) return null
  const key = keyAt(state.doc, tabsPos, node)
  return { index: activeIndex(st, key, node), key, idBase: `${st.base}-${domSafe(key)}` }
}

/** Start of tab `index` of the tabs block at `tabsPos`. */
export function tabPos(tabs: PMNode, tabsPos: number, index: number): number {
  let p = tabsPos + 1
  for (let i = 0; i < index; i++) p += tabs.child(i).nodeSize
  return p
}

/** A caret (or block selection) at the start of a tab's content. */
function selectionInTab(doc: PMNode, tabsPos: number, index: number): Selection | null {
  const tabs = doc.nodeAt(tabsPos)
  if (!isTabs(tabs) || index < 0 || index >= tabs.childCount) return null
  const start = tabPos(tabs, tabsPos, index)
  const end = start + tabs.child(index).nodeSize
  const text = Selection.findFrom(doc.resolve(start + 1), 1, true)
  if (text && text.to < end) return text
  const any = Selection.findFrom(doc.resolve(start + 1), 1, false)
  return any && any.to < end ? any : null
}

/**
 * Make tab `index` the active one (meta-only transaction, the doc is untouched). A caret inside
 * this tabs block moves into the newly shown tab, so typing never edits hidden text.
 * `tr`: add to that transaction instead of dispatching (used after structural edits).
 */
export function activateTab(view: EditorView, tabsPos: number, index: number, tr?: Transaction): Transaction | null {
  const own = !tr
  const t0 = tr ?? view.state.tr
  const node = t0.doc.nodeAt(tabsPos)
  if (!isTabs(node) || index < 0 || index >= node.childCount) return null
  t0.setMeta(tabsKey, { key: keyAt(t0.doc, tabsPos, node), index, id: (node.child(index).attrs.id as string | null) ?? null } satisfies TabsMeta)
  const { from, to } = t0.selection
  if (from > tabsPos && to < tabsPos + node.nodeSize) {
    const sel = selectionInTab(t0.doc, tabsPos, index)
    if (sel) t0.setSelection(sel)
  }
  if (own) view.dispatch(t0)
  return t0
}

/** Show the tab that contains `pos` (block links, comments in a hidden tab). */
export function revealPos(view: EditorView, pos: number): boolean {
  const { state } = view
  if (pos < 0 || pos > state.doc.content.size) return false
  const hit = tabsAround(state.doc.resolve(pos))
  if (!hit) return false
  const info = tabsInfoAt(state, hit.tabsPos)
  if (!info || info.index === hit.index) return false
  const tr = state.tr.setMeta(tabsKey, { key: info.key, index: hit.index, id: (hit.node.child(hit.index).attrs.id as string | null) ?? null } satisfies TabsMeta)
  view.dispatch(tr)
  return true
}

/** Mod+Alt+←/→ inside a tab: the previous / next tab, caret at the start of its content. */
function switchFromCaret(view: EditorView, dir: -1 | 1): boolean {
  const { state } = view
  const hit = tabsAround(state.selection.$head)
  if (!hit) return false
  const target = hit.index + dir
  if (target < 0 || target >= hit.node.childCount) return true
  const tr = activateTab(view, hit.tabsPos, target, state.tr)
  if (!tr) return false
  const sel = selectionInTab(tr.doc, hit.tabsPos, target)
  if (sel) tr.setSelection(sel)
  view.dispatch(tr.scrollIntoView())
  return true
}

/* ------------------------------------------------------------------ */
/* No tabs inside tabs                                                 */
/* ------------------------------------------------------------------ */

export const tabTitle = (tab: PMNode | JSONContent, i: number) => String(tab.attrs?.title ?? '').trim() || t('editor.tabs.untitled', { n: i + 1 })

/** A tabs block as plain blocks: each tab becomes a bold title line followed by its content. */
function flattenTabs(schema: Schema, tabs: PMNode): Fragment {
  const out: PMNode[] = []
  tabs.forEach((tab, _o, i) => {
    out.push(schema.nodes.paragraph.create(null, schema.text(tabTitle(tab, i), [schema.marks.bold.create()])))
    tab.forEach((child) => out.push(child))
  })
  return Fragment.from(out)
}

function nestedTabs(doc: PMNode): Array<{ pos: number; node: PMNode }> {
  const hits: Array<{ pos: number; node: PMNode }> = []
  doc.descendants((node, pos) => {
    if (!isTabs(node)) return !node.isTextblock && !node.isAtom
    node.descendants((inner, ip) => {
      if (isTabs(inner)) {
        hits.push({ pos: pos + 1 + ip, node: inner })
        return false
      }
      return !inner.isTextblock && !inner.isAtom
    })
    return false
  })
  return hits
}

/** Does a transaction insert a tabs block anywhere? (cheap check while the doc has none) */
function insertsTabs(tr: Transaction): boolean {
  return tr.steps.some((step) => {
    const slice = (step as unknown as { slice?: { content: Fragment } }).slice
    let found = false
    slice?.content.descendants((n) => {
      if (isTabs(n)) found = true
      return !found
    })
    return found
  })
}

/* ------------------------------------------------------------------ */
/* Nodes                                                               */
/* ------------------------------------------------------------------ */

const unescapeTitle = (s: string) => s.replace(/\\([\\`*_[\]~<&>])/g, '$1')

/** HTML ids / radio names of exported tabs blocks without an id. */
let staticSeq = 0

export const Tab = Node.create({
  name: 'tab',
  content: 'block+',
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      title: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-title') ?? '',
        renderHTML: (a) => ({ 'data-title': String(a.title ?? '') }),
      },
    }
  },
  parseHTML() {
    return [
      { tag: 'div[data-type="tab"]' },
      // the static export's tab bar is not content
      { tag: 'div.tabs__bar', ignore: true },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'tab', class: 'tab-panel' }), 0]
  },
})

export const Tabs = Node.create({
  name: 'tabs',
  group: 'block',
  content: 'tab+',
  defining: true,
  isolating: true,
  selectable: true,
  draggable: false,
  parseHTML() {
    return [{ tag: 'div[data-type="tabs"]', contentElement: (dom) => (dom as HTMLElement).querySelector<HTMLElement>(':scope > .tabs__panels') ?? (dom as HTMLElement) }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const name = `tabs-${domSafe(String(node.attrs.id ?? '')) || `s${++staticSeq}`}`
    const labels: unknown[] = []
    node.forEach((tab, _o, i) => {
      labels.push([
        'label',
        { class: 'tabs__tab' },
        ['input', { type: 'radio', name, class: 'tabs__radio', ...(i === 0 ? { checked: 'checked' } : {}) }],
        ['span', { class: 'tabs__n' }, String(i + 1).padStart(2, '0')],
        ['span', { class: 'tabs__title' }, tabTitle(tab, i)],
      ])
    })
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'tabs', class: 'tabs' }),
      ['div', { class: 'tabs__bar', role: 'radiogroup', 'aria-label': t('editor.tabs.label') }, ...labels],
      ['div', { class: 'tabs__panels' }, 0],
    ] as never
  },

  // "<!-- tabs -->" block: the HTML comments are invisible in rendered Markdown
  markdownTokenizer: {
    name: 'tabs',
    level: 'block',
    start: (src: string) => src.search(/<!--\s*tabs\s*-->/i),
    tokenize(src: string, _tokens: unknown, lexer: { blockTokens: (s: string) => unknown[] }) {
      const open = /^<!--\s*tabs\s*-->[ \t]*(?:\n|$)/i.exec(src)
      if (!open) return undefined
      const close = /(?:^|\n)<!--\s*\/tabs\s*-->[ \t]*(?:\n|$)/i.exec(src.slice(open[0].length))
      if (!close) return undefined
      const inner = src.slice(open[0].length, open[0].length + close.index)
      const raw = src.slice(0, open[0].length + close.index + close[0].length)
      const tabs = inner
        .split(/^<!--\s*tab\s*-->[ \t]*$/im)
        .slice(1)
        .map((part) => {
          const body = part.replace(/^\s*\n/, '')
          const head = /^\*\*(.*?)\*\*[ \t]*(?:\n|$)/.exec(body)
          return { title: head ? unescapeTitle(head[1]) : '', tokens: lexer.blockTokens((head ? body.slice(head[0].length) : body).trim()) }
        })
      if (!tabs.length) return undefined
      return { type: 'tabs', raw, tabs } as never
    },
  },
  parseMarkdown(token, h) {
    const list = (token.tabs as Array<{ title: string; tokens: never[] }>) ?? []
    const tabs = list.map((tb) => {
      const body = h.parseChildren(tb.tokens ?? [])
      return h.createNode('tab', { title: tb.title }, body.length ? body : [{ type: 'paragraph' }])
    })
    return h.createNode('tabs', {}, tabs)
  },
  renderMarkdown(node, h) {
    const parts = (node.content ?? []).map((tab) => {
      const title = String(tab.attrs?.title ?? '').trim()
      const body = h.renderChildren(tab.content ?? [], '\n\n').trim()
      const head = title ? `<!-- tab -->\n**${escapeMarkdownText(title)}**` : '<!-- tab -->'
      return body ? `${head}\n\n${body}` : head
    })
    return `<!-- tabs -->\n${parts.join('\n\n')}\n<!-- /tabs -->`
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-ArrowLeft': () => switchFromCaret(this.editor.view, -1),
      'Mod-Alt-ArrowRight': () => switchFromCaret(this.editor.view, 1),
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<TabsState>({
        key: tabsKey,
        state: {
          init: (_, state) => {
            const st = { active: {}, base: `tabs${++editorSeq}` }
            return { ...st, ...buildDecos(state.doc, st) }
          },
          apply(tr, prev, _old, state) {
            const meta = tr.getMeta(tabsKey) as TabsMeta | undefined
            let active = prev.active
            if (meta) active = { ...active, [meta.key]: { id: meta.id ?? null, index: meta.index } }
            if (!meta && !tr.docChanged && !tr.selectionSet) return prev
            if (!meta && !prev.count && !insertsTabs(tr)) return prev.deco === DecorationSet.empty ? prev : { ...prev, deco: DecorationSet.empty }
            // a selection that lands in a hidden tab shows that tab
            if (!meta && state.selection.from === state.selection.to) {
              const hit = tabsAround(state.selection.$head)
              if (hit) {
                const key = keyAt(state.doc, hit.tabsPos, hit.node)
                if (activeIndex({ active }, key, hit.node) !== hit.index) active = { ...active, [key]: { id: (hit.node.child(hit.index).attrs.id as string | null) ?? null, index: hit.index } }
              }
            } else if (!meta && state.selection instanceof NodeSelection) {
              const hit = tabsAround(state.doc.resolve(state.selection.from))
              if (hit) {
                const key = keyAt(state.doc, hit.tabsPos, hit.node)
                if (activeIndex({ active }, key, hit.node) !== hit.index) active = { ...active, [key]: { id: (hit.node.child(hit.index).attrs.id as string | null) ?? null, index: hit.index } }
              }
            }
            if (active === prev.active && !tr.docChanged) return prev
            return { active, base: prev.base, ...buildDecos(state.doc, { active, base: prev.base }) }
          },
        },
        props: {
          decorations: (state) => tabsKey.getState(state)?.deco,
        },
        appendTransaction(trs, _old, state) {
          if (!trs.some((tr) => tr.docChanged) || !tabsKey.getState(state)?.count) return null
          const hits = nestedTabs(state.doc)
          if (!hits.length) return null
          const tr = state.tr
          for (const { pos, node } of hits.reverse()) tr.replaceWith(pos, pos + node.nodeSize, flattenTabs(state.schema, node))
          return tr
        },
      }),
    ]
  },
})

/** JSON of a new tabs block (one tab, an empty line in it). */
export function newTabsJson(): JSONContent {
  return { type: 'tabs', content: [{ type: 'tab', attrs: { title: t('editor.tabs.untitled', { n: 1 }) }, content: [{ type: 'paragraph' }] }] }
}

/** Caret at the first text position inside the tabs block at `tabsPos` (after inserting it). */
export function caretIntoTabs(tr: Transaction, tabsPos: number): void {
  const sel = selectionInTab(tr.doc, tabsPos, 0)
  if (sel) tr.setSelection(sel)
  else tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(tabsPos + 3, tr.doc.content.size))))
}
