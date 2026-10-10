/**
 * Task block: `workItem` (UI "Task" / "Aufgabe") — a placard with an editable title line and free notes.
 * content `paragraph block*`: the first paragraph is the title (rich text), the rest are notes.
 * The attrs contract and its one sanitizer live in ../workitem/attrs.ts (`itemAttrs`).
 *
 * Schema release (P0): every client understands, shows, stores, exports and diffs a task — nothing
 * creates one yet (no slash item, no input rule, no Turn into, no AI path; the Markdown reader is off,
 * ../workitem/markdown.ts). Team workspaces: an older tab would DELETE this node from a shared document,
 * so the collab server only lets clients of DOC_SCHEMA_VERSION ≥ its minimum write (docs/CLOUD.md § Schema gate).
 *
 * Editor rules (one plugin, local transactions only):
 *  - no task inside a task: a nested one is unwrapped (its title + notes stay, as plain blocks)
 *  - never inside a table cell (heavy, like databases or tabs): unwrapped there the same way
 * HTML: <div data-type="work-item" data-item-id data-status data-due …> head (key + label) +
 *   <div class="workitem__body"> title + notes + <div class="workitem__chips"> — a static placard (exports).
 * Markdown: `> [!TODO] Title {#wi_…}` + the field line + the notes (../workitem/markdown.ts).
 */
import { Node, mergeAttributes } from '@tiptap/core'
import type { Fragment, Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { ySyncPluginKey } from '@tiptap/y-tiptap'
import { currentLang, t } from '../../i18n'
import { useWorkspace } from '../../store/store'
import { itemAttrs, readDoneAt, readDue, readFrozen, readItemId, readLinks, readPeople, readReminder, readStatus, WORK_ITEM } from '../workitem/attrs'
import { chipWords, placardModel } from '../workitem/format'
import { workItemMarkdown } from '../workitem/markdown'

export { WORK_ITEM }

const isItem = (n: PMNode | null | undefined): boolean => !!n && n.type.name === WORK_ITEM
const CELLS = new Set(['tableCell', 'tableHeader'])

/* ------------------------------------------------------------------ */
/* No task inside a task, none in a table cell                         */
/* ------------------------------------------------------------------ */

/** Tasks that sit inside another task or a table cell (outermost first, in document order). */
export function misplacedItems(doc: PMNode): Array<{ pos: number; node: PMNode }> {
  const hits: Array<{ pos: number; node: PMNode }> = []
  const walk = (node: PMNode, pos: number, banned: boolean) => {
    node.forEach((child, offset) => {
      const at = pos + offset
      if (child.isTextblock || child.isLeaf) return
      if (isItem(child) && banned) hits.push({ pos: at, node: child })
      walk(child, at + 1, banned || isItem(child) || CELLS.has(child.type.name))
    })
  }
  walk(doc, 0, false)
  return hits
}

function insertsItem(tr: Transaction): boolean {
  return tr.steps.some((step) => {
    const slice = (step as unknown as { slice?: { content: Fragment } }).slice
    let found = false
    slice?.content.descendants((n) => {
      if (isItem(n)) found = true
      return !found && !n.isTextblock
    })
    return found
  })
}

/** Replace each misplaced task by its blocks — later (and inner) ones first, so earlier positions stay valid. */
function unwrap(tr: Transaction, hits: Array<{ pos: number }>): Transaction {
  for (const { pos } of [...hits].reverse()) {
    // read again: an inner one may have been unwrapped into it already
    const cur = tr.doc.nodeAt(pos)
    if (cur && isItem(cur)) tr.replaceWith(pos, pos + cur.nodeSize, cur.content)
  }
  return tr
}

const isRemote = (tr: Transaction) => !!(tr.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin

/* ------------------------------------------------------------------ */
/* Node                                                                */
/* ------------------------------------------------------------------ */

const listAttr = (v: unknown) => (Array.isArray(v) && v.length ? v.join(' ') : null)

/** One attr ⇄ a `data-*` attribute, read through the attrs contract. */
const dataAttr = (name: string, key: string, read: (v: string | null) => unknown, write: (v: unknown) => string | null, def: unknown) => ({
  default: def,
  parseHTML: (el: HTMLElement) => read(el.getAttribute(`data-${name}`)),
  renderHTML: (a: Record<string, unknown>) => {
    const v = write(a[key])
    return v === null ? {} : { [`data-${name}`]: v }
  },
})

export const WorkItem = Node.create({
  name: WORK_ITEM,
  group: 'block',
  content: 'paragraph block*',
  defining: true,
  isolating: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      itemId: dataAttr('item-id', 'itemId', readItemId, (v) => readItemId(v), null),
      status: dataAttr('status', 'status', readStatus, (v) => readStatus(v), 'todo'),
      due: dataAttr('due', 'due', readDue, (v) => readDue(v), null),
      reminder: dataAttr('reminder', 'reminder', readReminder, (v) => readReminder(v), null),
      people: dataAttr('people', 'people', readPeople, (v) => listAttr(readPeople(v)), []),
      blockedBy: dataAttr('blocked-by', 'blockedBy', (v) => readLinks(v), (v) => listAttr(readLinks(v)), []),
      related: dataAttr('related', 'related', (v) => readLinks(v), (v) => listAttr(readLinks(v)), []),
      doneAt: dataAttr('done-at', 'doneAt', readDoneAt, (v) => (readDoneAt(v) === null ? null : String(readDoneAt(v))), null),
      frozen: dataAttr('frozen', 'frozen', readFrozen, (v) => (readFrozen(v) ? JSON.stringify(readFrozen(v)) : null), null),
    }
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-type="work-item"]',
        // only a task's own copy (clipboard, drag: it carries its itemId) comes back as a task. Exported or shared
        // HTML (frozen, no ids) reads as plain blocks — in this release nothing creates a task, not even an import
        getAttrs: (dom) => (readItemId((dom as HTMLElement).getAttribute('data-item-id')) ? null : false),
        contentElement: (dom) => (dom as HTMLElement).querySelector<HTMLElement>(':scope > .workitem__body') ?? (dom as HTMLElement),
      },
    ]
  },
  renderHTML({ node, HTMLAttributes }) {
    const a = itemAttrs(node)
    const m = placardModel(a, { t, lang: currentLang(), people: useWorkspace.getState().people, now: Date.now() })
    const words = chipWords(m, t)
    const chips: unknown[] = []
    if (m.due && words.due) chips.push(['span', { class: 'workitem__chip workitem__chip--due', ...(m.due.late ? { 'data-late': '' } : {}) }, words.due])
    for (const p of m.people)
      chips.push([
        'span',
        { class: 'workitem__chip workitem__chip--person' },
        ['span', { class: 'workitem__avatar', style: `background:var(--c-${p.color}-bg);color:var(--c-${p.color}-text)`, 'aria-hidden': 'true' }, p.initials],
        p.name,
      ])
    if (words.blockedBy) chips.push(['span', { class: 'workitem__chip workitem__chip--blocked' }, words.blockedBy])
    if (words.related) chips.push(['span', { class: 'workitem__chip workitem__chip--related' }, words.related])
    const led = a.status === 'in_progress' ? 'led led--on' : a.status === 'done' ? 'led led--ok' : 'led'
    const out: unknown[] = [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'work-item', class: 'workitem', 'data-status': a.status, ...(m.due?.late ? { 'data-late': '' } : {}) }),
      [
        'div',
        { class: 'workitem__head', contenteditable: 'false' },
        ['span', { class: 'workitem__key', role: 'img', 'aria-label': m.statusText, title: m.statusText }, ['span', { class: led }]],
        ['span', { class: 'workitem__label' }, m.label],
      ],
      ['div', { class: 'workitem__body' }, 0],
    ]
    if (chips.length) out.push(['div', { class: 'workitem__chips', contenteditable: 'false' }, ...chips])
    return out as never
  },
  renderMarkdown(node, h) {
    const a = itemAttrs(node)
    const [first, ...rest] = node.content ?? []
    const title = first ? h.renderChildren([first]).trim() : ''
    const notes = rest.length ? h.renderChildren(rest, '\n\n') : ''
    const people = useWorkspace.getState().people
    return workItemMarkdown(a, title, notes, { person: (id) => people.find((p) => p.id === id)?.name ?? null })
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('workItem'),
        // a page that opens with a misplaced task (written elsewhere) is repaired once, when it can be edited
        view(view) {
          const timer = window.setTimeout(() => {
            if (view.isDestroyed || !view.editable) return
            const hits = misplacedItems(view.state.doc)
            if (hits.length) view.dispatch(unwrap(view.state.tr, hits))
          }, 0)
          return { destroy: () => window.clearTimeout(timer) }
        },
        appendTransaction(trs, _old, state) {
          if (!trs.some((tr) => tr.docChanged && !isRemote(tr) && insertsItem(tr))) return null
          const hits = misplacedItems(state.doc)
          if (!hits.length) return null
          const tr = unwrap(state.tr, hits)
          return tr.docChanged ? tr : null
        },
      }),
    ]
  },
})
