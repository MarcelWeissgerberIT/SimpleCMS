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
 * Placement (../workitem/place.ts): never inside another task, never in a table — a task that lands there
 * (paste, drop) is moved out whole, after the outermost task / table, fields and all. Local transactions
 * only; documents written elsewhere are repaired when they are loaded (sanitize), never on mount in a
 * shared document (two members opening it would both repair it).
 * HTML: <div data-type="work-item" data-item-id data-status data-due …> head (key + label) +
 *   <div class="workitem__body"> title + notes + <div class="workitem__chips"> — a static placard (exports).
 *   It parses back into a task ONLY as this One's own clipboard copy (../workitem/clip.ts): raw HTML in
 *   Markdown, Claude's answers, imports and other sites' clipboards read it as plain blocks.
 * Markdown: `> [!TODO] Title {#wi_…}` + the field line + the notes (../workitem/markdown.ts).
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { DOMSerializer, type DOMOutputSpec, type Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state'
import { ySyncPluginKey } from '@tiptap/y-tiptap'
import { currentLang, t } from '../../i18n'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { itemAttrs, readDoneAt, readDue, readFrozen, readItemId, readLinks, readPeople, readReminder, readStatus, WORK_ITEM } from '../workitem/attrs'
import { CLIP_ATTR, clipKey, isOwnCopy } from '../workitem/clip'
import { chipWords, placardModel } from '../workitem/format'
import { workItemMarkdown } from '../workitem/markdown'
import { liftMisplaced } from '../workitem/place'

export { WORK_ITEM }

const isItem = (n: PMNode | null | undefined): boolean => !!n && n.type.name === WORK_ITEM

/* ------------------------------------------------------------------ */
/* No task inside a task, none in a table (workitem/place.ts)          */
/* ------------------------------------------------------------------ */

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

const isRemote = (tr: Transaction) => !!(tr.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin
const byHand = (tr: Transaction) => {
  const ui = tr.getMeta('uiEvent')
  return ui === 'paste' || ui === 'drop'
}

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
        // only a task's own clipboard copy (copy / cut / drag in an editor of this device: it carries the clip
        // key) comes back as a task — raw HTML in Markdown, Claude's answers, imports, exported or shared pages
        // and other sites' clipboards read it as plain blocks: in this release nothing creates a task
        getAttrs: (dom) => (isOwnCopy(dom as HTMLElement) && readItemId((dom as HTMLElement).getAttribute('data-item-id')) ? null : false),
        contentElement: (dom) => (dom as HTMLElement).querySelector<HTMLElement>(':scope > .workitem__body') ?? (dom as HTMLElement),
      },
      // a placard read as plain blocks: its key, label and chips are chrome, not text
      { tag: 'div.workitem__head', ignore: true },
      { tag: 'div.workitem__chips', ignore: true },
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
        [
          'span',
          { class: 'workitem__label' },
          ['span', { class: 'workitem__state', ...(m.state.signal ? { 'data-signal': '' } : {}) }, m.state.word],
          ...(m.state.id ? [['span', { class: 'workitem__id' }, ` · ${m.state.id}`]] : []),
        ],
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
    const type = this.type
    return [
      new Plugin({
        key: new PluginKey('workItem'),
        props: {
          // copy / cut / drag: every task carries this device's clip key, so it pastes back as a task (clip.ts)
          clipboardSerializer: clipSerializer(this.editor.schema, type.name),
        },
        appendTransaction(trs, _old, state) {
          if (!trs.some((tr) => tr.docChanged && !isRemote(tr) && insertsItem(tr))) return null
          const tr = state.tr
          const at = liftMisplaced(tr)
          if (at === null || !tr.docChanged) return null
          // the caret goes with the task (the end of its title)
          const moved = tr.doc.nodeAt(at)
          if (moved && isItem(moved)) tr.setSelection(TextSelection.create(tr.doc, at + 1 + moved.child(0).nodeSize - 1))
          if (trs.some(byHand)) useUI.getState().toast({ message: t('editor.workItem.moved') })
          return tr
        },
      }),
    ]
  },
})

/** The schema's clipboard serializer, with the clip key on every task (clip.ts). */
function clipSerializer(schema: Parameters<typeof DOMSerializer.fromSchema>[0], name: string): DOMSerializer {
  const base = DOMSerializer.fromSchema(schema)
  const render = base.nodes[name]
  if (!render) return base
  const nodes = {
    ...base.nodes,
    [name]: (node: PMNode): DOMOutputSpec => {
      const spec = render(node)
      if (!Array.isArray(spec)) return spec
      const [tag, maybeAttrs, ...rest] = spec as unknown as [string, unknown, ...unknown[]]
      const isAttrs = !!maybeAttrs && typeof maybeAttrs === 'object' && !Array.isArray(maybeAttrs) && !(maybeAttrs as { nodeType?: unknown }).nodeType
      const attrs = { ...(isAttrs ? (maybeAttrs as Record<string, unknown>) : {}), [CLIP_ATTR]: clipKey() }
      return [tag, attrs, ...(isAttrs ? rest : [maybeAttrs, ...rest])] as unknown as DOMOutputSpec
    },
  }
  return new DOMSerializer(nodes, base.marks)
}
