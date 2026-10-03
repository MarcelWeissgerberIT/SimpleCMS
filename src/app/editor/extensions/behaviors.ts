/**
 * Editor behaviour extensions: placeholder, block-selection highlight, shortcuts, input rules.
 */
import { Extension, InputRule } from '@tiptap/core'
import type { Fragment, Node as PMNode, ResolvedPos, Schema } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { isNodeRangeSelection } from '@tiptap/extension-node-range'
import { t } from '../../i18n'
import type { Bridge } from '../lib/bridge'
import { findEmoji } from '../lib/emoji'
import { revealPos } from '../schema/tabs'
import {
  caretAfterNode,
  caretIntoBlock,
  duplicateBlock,
  enterFromToggleTitle,
  exitToggleOnEmptyLine,
  jumpColumn,
  moveBlock,
  outdentBlock,
  currentBlock,
  selectAtomBefore,
  selectBlock,
  turnInto,
} from '../lib/blocks'

/* ------------------------------------------------------------------ */
/* Placeholder                                                         */
/* ------------------------------------------------------------------ */

function placeholderFor(node: PMNode, $pos: ResolvedPos | null): string {
  switch (node.type.name) {
    case 'heading':
      return t(`editor.placeholder.h${node.attrs.level}`)
    case 'detailsSummary':
      return t('editor.placeholder.toggle')
    case 'paragraph': {
      if (!$pos) return t('editor.placeholder.default')
      const grand = $pos.node(Math.max(0, $pos.depth - 1)).type.name
      if (grand === 'listItem') return t('editor.placeholder.list')
      if (grand === 'taskItem') return t('editor.placeholder.todo')
      if (grand === 'tableCell' || grand === 'tableHeader') return ''
      return t('editor.placeholder.default')
    }
    default:
      return ''
  }
}

/** Empty headings / toggle titles keep their placeholder even when unfocused. */
function emptyTitleDecos(doc: PMNode, from: number, to: number, out: Decoration[]) {
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) {
      if (node.content.size === 0 && (node.type.name === 'heading' || node.type.name === 'detailsSummary'))
        out.push(Decoration.node(pos, pos + node.nodeSize, { class: 'is-empty', 'data-placeholder': placeholderFor(node, null) }))
      return false
    }
    return !node.isAtom
  })
}

const placeholderKey = new PluginKey<{ set: DecorationSet; lang: string }>('onePlaceholder')

export const OnePlaceholder = Extension.create({
  name: 'onePlaceholder',
  addProseMirrorPlugins() {
    const editor = this.editor
    const lang = () => t('editor.placeholder.default')
    const full = (doc: PMNode) => {
      const decos: Decoration[] = []
      emptyTitleDecos(doc, 0, doc.content.size, decos)
      return DecorationSet.create(doc, decos)
    }
    return [
      new Plugin<{ set: DecorationSet; lang: string }>({
        key: placeholderKey,
        state: {
          init: (_, state) => ({ set: full(state.doc), lang: lang() }),
          apply(tr, value, _old, state) {
            const l = lang()
            if (l !== value.lang) return { set: full(state.doc), lang: l }
            if (!tr.docChanged) return value
            // incremental: only rescan the ranges this transaction touched
            let set = value.set.map(tr.mapping, tr.doc)
            const size = tr.doc.content.size
            tr.mapping.maps.forEach((map, i) => {
              const rest = tr.mapping.slice(i + 1)
              map.forEach((_s, _e, newStart, newEnd) => {
                const from = Math.max(0, rest.map(newStart, -1) - 1)
                const to = Math.min(size, rest.map(newEnd, 1) + 1)
                set = set.remove(set.find(from, to).filter((d) => d.from < to && d.to > from))
                const add: Decoration[] = []
                emptyTitleDecos(tr.doc, from, to, add)
                if (add.length) set = set.add(tr.doc, add)
              })
            })
            return { set, lang: l }
          },
        },
        props: {
          decorations(state) {
            if (!editor.isEditable) return null
            const { doc, selection } = state
            const base = placeholderKey.getState(state)?.set ?? DecorationSet.empty
            const decos: Decoration[] = []
            const $from = selection.$from
            const parent = $from.parent
            const onlyEmpty = doc.childCount === 1 && doc.firstChild?.isTextblock && doc.firstChild.content.size === 0
            const solo = onlyEmpty ? ' is-solo' : ''
            let set = base
            if (selection.empty && parent.isTextblock && parent.content.size === 0 && $from.depth > 0 && !parent.type.spec.code) {
              const from = $from.before()
              const text = placeholderFor(parent, $from)
              if (text) {
                set = set.remove(set.find(from, from + parent.nodeSize).filter((d) => d.from === from))
                decos.push(Decoration.node(from, $from.after(), { class: `is-empty is-current${solo}`, 'data-placeholder': text }))
              }
            } else if (onlyEmpty) {
              set = set.remove(set.find(0, doc.firstChild!.nodeSize).filter((d) => d.from === 0))
              decos.push(Decoration.node(0, doc.firstChild!.nodeSize, { class: 'is-empty is-solo', 'data-placeholder': placeholderFor(doc.firstChild!, null) }))
            }
            return decos.length ? set.add(doc, decos) : set
          },
        },
      }),
    ]
  },
})

/* ------------------------------------------------------------------ */
/* Block selection highlight (drag handle / Esc / Shift+click ranges)  */
/* ------------------------------------------------------------------ */

/** A whole block is selected (Esc, grip click, clicking an image …) — not a text range. */
function isBlockSelection(sel: Selection): boolean {
  return (sel instanceof NodeSelection && sel.node.isBlock) || isNodeRangeSelection(sel)
}

export const BlockSelection = Extension.create({
  name: 'blockSelection',
  // before the core keymap (Enter would otherwise insert a line next to the block)
  priority: 1050,
  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('blockSelection'),
        props: {
          /**
           * Notion's block-selection mode: character keys never replace the selected block,
           * Enter goes back to editing its text. Backspace / Delete still remove it.
           */
          handleKeyDown(view, event) {
            const sel = view.state.selection
            if (!isBlockSelection(sel) || event.isComposing) return false
            const plain = !event.ctrlKey && !event.metaKey && !event.altKey
            if (event.key === 'Enter' && plain && !event.shiftKey && sel instanceof NodeSelection) {
              if (caretIntoBlock(editor, sel.from)) return true
              return caretAfterNode(editor, sel.from, { newLine: true })
            }
            if (plain && event.key.length === 1) {
              event.preventDefault()
              return true
            }
            return false
          },
          handleTextInput(view) {
            return isBlockSelection(view.state.selection)
          },
          decorations(state) {
            const sel = state.selection
            const decos: Decoration[] = []
            if (isNodeRangeSelection(sel)) {
              for (const r of sel.ranges) {
                try {
                  decos.push(Decoration.node(r.$from.pos, r.$to.pos, { class: 'is-block-selected' }))
                } catch {
                  /* range not on node boundaries */
                }
              }
            } else if (sel instanceof NodeSelection && sel.node.isBlock) {
              decos.push(Decoration.node(sel.from, sel.to, { class: 'is-block-selected' }))
            }
            return decos.length ? DecorationSet.create(state.doc, decos) : null
          },
        },
      }),
    ]
  },
})

/* ------------------------------------------------------------------ */
/* Keyboard shortcuts                                                  */
/* ------------------------------------------------------------------ */

const AI_PARENTS = new Set(['doc', 'column', 'callout', 'detailsContent', 'tab'])

export function shortcutsExtension(bridge: Bridge) {
  return Extension.create({
    name: 'oneShortcuts',
    // before HardBreak (Mod-Enter) and the core Backspace handling
    priority: 1000,
    addKeyboardShortcuts() {
      const editor = this.editor
      const moveUp = () => moveBlock(editor, -1)
      const moveDown = () => moveBlock(editor, 1)
      return {
        'Mod-d': () => duplicateBlock(editor),
        'Alt-Shift-ArrowUp': moveUp,
        'Alt-Shift-ArrowDown': moveDown,
        'Mod-Shift-ArrowUp': moveUp,
        'Mod-Shift-ArrowDown': moveDown,
        'Mod-Shift-x': () => editor.commands.toggleStrike(),
        // TipTap's setParagraph() on a paragraph falls back to clearNodes(), which lifts it out of a callout
        'Mod-Alt-0': () => turnInto(editor, 'paragraph'),
        // TipTap's own "double Enter leaves the toggle" never matches once paragraphs carry ids
        Enter: () => !bridge.getState().suggest && (exitToggleOnEmptyLine(editor) || enterFromToggleTitle(editor)),
        'Shift-Tab': () => !bridge.getState().suggest && (outdentBlock(editor) || jumpColumn(editor, -1)),
        Tab: () => !bridge.getState().suggest && jumpColumn(editor, 1),
        // keyboard path to the block menu (Turn into, Colour, Duplicate, Move to, Delete)
        'Alt-Enter': () => {
          const b = currentBlock(editor.state)
          if (!b || bridge.getState().suggest) return false
          bridge.setState({ blockMenu: { pos: b.pos } })
          return true
        },
        'Mod-k': () => {
          if (editor.state.selection.empty && !editor.isActive('link')) editor.commands.extendMarkRange('link')
          bridge.setState({ linkEdit: true })
          return true
        },
        'Mod-Enter': () => {
          const { $from } = editor.state.selection
          for (let d = $from.depth; d > 0; d--) {
            const node = $from.node(d)
            if (node.type.name === 'taskItem' || node.type.name === 'details') {
              const attr = node.type.name === 'taskItem' ? 'checked' : 'open'
              editor.view.dispatch(editor.state.tr.setNodeMarkup($from.before(d), undefined, { ...node.attrs, [attr]: !node.attrs[attr] }))
              return true
            }
          }
          return false
        },
        Escape: () => {
          const s = bridge.getState()
          if (s.suggest || s.ai || s.urlPaste || s.linkEdit) return false
          const sel = editor.state.selection
          if (sel instanceof NodeSelection) {
            editor.commands.blur()
            return true
          }
          return selectBlock(editor)
        },
        Space: () => {
          const { selection } = editor.state
          const { $from, empty } = selection
          if (!empty || !(selection instanceof TextSelection)) return false
          if ($from.parent.type.name !== 'paragraph' || $from.parent.content.size !== 0) return false
          if (!AI_PARENTS.has($from.node(Math.max(0, $from.depth - 1)).type.name)) return false
          bridge.setState({ ai: { mode: 'block' } })
          return true
        },
        Backspace: () => {
          const { selection } = editor.state
          const { $from, empty } = selection
          if (!empty || $from.parentOffset !== 0) return false
          // Notion: Backspace at the start of a heading turns it into text first
          if ($from.parent.type.name === 'heading') return editor.commands.setParagraph()
          // …and right after an image / embed / divider it selects that block
          if (selectAtomBefore(editor)) return true
          // Backspace in an empty toggle title unwraps the toggle (keeps its content)
          if ($from.parent.type.name === 'detailsSummary' && $from.parent.content.size === 0) {
            const d = $from.depth - 1
            const details = $from.node(d)
            const pos = $from.before(d)
            const body = details.childCount > 1 ? details.child(1).content : null
            const { state, view } = editor
            const tr = body && body.size ? state.tr.replaceWith(pos, pos + details.nodeSize, body) : state.tr.replaceWith(pos, pos + details.nodeSize, state.schema.nodes.paragraph.create())
            tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos + 1, tr.doc.content.size))))
            view.dispatch(tr)
            return true
          }
          return false
        },
      }
    },
  })
}

/** Last-resort Tab handling: lists / tables / code handle Tab first; elsewhere keep focus in the editor. */
export const TabTrap = Extension.create({
  name: 'tabTrap',
  priority: 10,
  addKeyboardShortcuts() {
    return { Tab: () => true, 'Shift-Tab': () => true }
  },
})

/* ------------------------------------------------------------------ */
/* Extra markdown input rules                                          */
/* ------------------------------------------------------------------ */

export const ExtraInputRules = Extension.create({
  name: 'extraInputRules',
  addInputRules() {
    /**
     * Block rule at the start of a paragraph. `build` receives the text after the marker
     * (the line's existing content) and must keep it — never silently drop the user's text.
     */
    const blockRule = (find: RegExp, build: (rest: Fragment, schema: Schema) => PMNode | null, opts: { selectNode?: boolean } = {}) =>
      new InputRule({
        find,
        handler: ({ state, range }) => {
          const $from = state.doc.resolve(range.from)
          if ($from.parent.type.name !== 'paragraph' || $from.parentOffset !== 0) return null
          const rest = $from.parent.content.cut(range.to - $from.start())
          let node: PMNode | null
          try {
            node = build(rest, state.schema)
            node?.check()
          } catch {
            return null
          }
          if (!node) return null
          const { tr } = state
          const from = $from.before()
          tr.replaceWith(from, $from.after(), node)
          if (opts.selectNode) tr.setSelection(NodeSelection.create(tr.doc, from))
          else {
            // caret at the start of the first textblock — where the user was typing
            let caret = -1
            tr.doc.nodesBetween(from, from + node.nodeSize, (n, pos) => {
              if (caret >= 0) return false
              if (n.isTextblock) {
                caret = pos + 1
                return false
              }
              return true
            })
            if (caret >= 0) tr.setSelection(TextSelection.create(tr.doc, caret))
          }
          return undefined
        },
      })
    const emojiRule = new InputRule({
      find: /:([a-z0-9_+-]{2,}):$/,
      handler: ({ state, range, match }) => {
        const e = findEmoji(match[1])
        if (!e) return null
        state.tr.insertText(e.emoji, range.from, range.to)
        return undefined
      },
    })
    return [
      emojiRule,
      // ">> " — the line's text becomes the toggle title
      blockRule(/^>>\s$/, (rest, schema) =>
        schema.nodes.details.create({ open: true }, [schema.nodes.detailsSummary.create(null, rest), schema.nodes.detailsContent.create(null, schema.nodes.paragraph.create())]),
      ),
      blockRule(/^!>\s$/, (rest, schema) => schema.nodes.callout.create({ icon: '💡', color: 'gray' }, schema.nodes.paragraph.create(null, rest))),
      // "$$ " only on an empty line (the text would otherwise have to become TeX)
      blockRule(/^\$\$\s$/, (rest, schema) => (rest.size ? null : schema.nodes.blockMath.create({ latex: '' })), { selectNode: true }),
    ]
  },
})

/* ------------------------------------------------------------------ */
/* Flash a block (used for ?b=<blockId> deep links and TOC jumps)      */
/* ------------------------------------------------------------------ */

export const flashKey = new PluginKey<DecorationSet>('blockFlash')

export const BlockFlash = Extension.create({
  name: 'blockFlash',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: flashKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const meta = tr.getMeta(flashKey) as { pos: number } | null | undefined
            if (meta === null) return DecorationSet.empty
            if (meta) {
              const node = tr.doc.nodeAt(meta.pos)
              if (!node) return DecorationSet.empty
              return DecorationSet.create(tr.doc, [Decoration.node(meta.pos, meta.pos + node.nodeSize, { class: 'block-flash' })])
            }
            return set.map(tr.mapping, tr.doc)
          },
        },
        props: {
          decorations(state) {
            return flashKey.getState(state)
          },
        },
      }),
    ]
  },
})

/** Scroll a block into view and flash it for ~2s (a block in a hidden tab shows that tab first). */
export function flashBlock(editor: import('@tiptap/core').Editor, pos: number) {
  if (editor.isDestroyed) return
  revealPos(editor.view, pos + 1)
  const dom = editor.view.nodeDOM(pos) as HTMLElement | null
  dom?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  editor.view.dispatch(editor.state.tr.setMeta(flashKey, { pos }).setMeta('addToHistory', false))
  window.setTimeout(() => {
    if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(flashKey, null).setMeta('addToHistory', false))
  }, 2000)
}

/** Position of the block with the given UniqueID. */
export function findBlockById(editor: import('@tiptap/core').Editor, id: string): number | null {
  let found: number | null = null
  editor.state.doc.descendants((node, pos) => {
    if (found !== null) return false
    if (node.attrs?.id === id) {
      found = pos
      return false
    }
    return true
  })
  return found
}

/* ------------------------------------------------------------------ */
/* Nothing selected until the user does something                      */
/* ------------------------------------------------------------------ */

/**
 * ProseMirror starts every editor with Selection.atStart(doc). When the doc begins with an atom
 * block (bookmark, image, embed …) that is a NodeSelection: the block renders as selected (and an
 * empty media block even focuses its URL field) although nobody touched the page. An unfocused
 * view with a node selection gets a plain caret at the first text position instead.
 */
export function quietSelection(view: EditorView): void {
  if (view.isDestroyed || view.hasFocus()) return
  const { selection, doc } = view.state
  if (!(selection instanceof NodeSelection)) return
  const caret = Selection.findFrom(doc.resolve(0), 1, true)
  if (caret) view.dispatch(view.state.tr.setSelection(caret).setMeta('addToHistory', false))
}

export const QuietStart = Extension.create({
  name: 'quietStart',
  onBeforeCreate() {
    const editor = this.editor
    // 'mount' fires right after the view exists — before any React node view has rendered
    // (an empty bookmark would otherwise autofocus its URL field on a node selection)
    editor.on('mount', () => {
      if (!editor.isDestroyed) quietSelection(editor.view)
    })
  },
})
