/**
 * Editor behaviour extensions: placeholder, block-selection highlight, shortcuts, input rules.
 */
import { Extension, InputRule } from '@tiptap/core'
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { isNodeRangeSelection } from '@tiptap/extension-node-range'
import { t } from '../../i18n'
import type { Bridge } from '../lib/bridge'
import { findEmoji } from '../lib/emoji'
import { duplicateBlock, moveBlock, selectBlock } from '../lib/blocks'

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

export const OnePlaceholder = Extension.create({
  name: 'onePlaceholder',
  addProseMirrorPlugins() {
    const editor = this.editor
    let cacheDoc: PMNode | null = null
    let cache: Array<{ from: number; to: number; text: string }> = []
    return [
      new Plugin({
        key: new PluginKey('onePlaceholder'),
        props: {
          decorations(state) {
            if (!editor.isEditable) return null
            const { doc, selection } = state
            if (doc !== cacheDoc) {
              cacheDoc = doc
              cache = []
              doc.descendants((node, pos) => {
                if (node.isTextblock) {
                  if (node.content.size === 0 && (node.type.name === 'heading' || node.type.name === 'detailsSummary'))
                    cache.push({ from: pos, to: pos + node.nodeSize, text: placeholderFor(node, null) })
                  return false
                }
                return !node.isAtom
              })
            }
            const decos: Decoration[] = []
            const $from = selection.$from
            const parent = $from.parent
            let curFrom = -1
            const onlyEmpty = doc.childCount === 1 && doc.firstChild?.isTextblock && doc.firstChild.content.size === 0
            const solo = onlyEmpty ? ' is-solo' : ''
            if (selection.empty && parent.isTextblock && parent.content.size === 0 && $from.depth > 0 && !parent.type.spec.code) {
              curFrom = $from.before()
              const text = placeholderFor(parent, $from)
              if (text) decos.push(Decoration.node(curFrom, $from.after(), { class: `is-empty is-current${solo}`, 'data-placeholder': text }))
            } else if (onlyEmpty) {
              decos.push(Decoration.node(0, doc.firstChild!.nodeSize, { class: 'is-empty is-solo', 'data-placeholder': placeholderFor(doc.firstChild!, null) }))
            }
            for (const c of cache) if (c.from !== curFrom) decos.push(Decoration.node(c.from, c.to, { class: 'is-empty', 'data-placeholder': c.text }))
            return decos.length ? DecorationSet.create(doc, decos) : null
          },
        },
      }),
    ]
  },
})

/* ------------------------------------------------------------------ */
/* Block selection highlight (drag handle / Esc / Shift+click ranges)  */
/* ------------------------------------------------------------------ */

export const BlockSelection = Extension.create({
  name: 'blockSelection',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('blockSelection'),
        props: {
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

const AI_PARENTS = new Set(['doc', 'column', 'callout', 'detailsContent'])

export function shortcutsExtension(bridge: Bridge) {
  return Extension.create({
    name: 'oneShortcuts',
    priority: 50,
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
        Tab: () => true,
        'Shift-Tab': () => true,
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

/* ------------------------------------------------------------------ */
/* Extra markdown input rules                                          */
/* ------------------------------------------------------------------ */

export const ExtraInputRules = Extension.create({
  name: 'extraInputRules',
  addInputRules() {
    const editor = this.editor
    const blockRule = (find: RegExp, build: () => object, opts: { selectNode?: boolean } = {}) =>
      new InputRule({
        find,
        handler: ({ state, range }) => {
          const $from = state.doc.resolve(range.from)
          if ($from.parent.type.name !== 'paragraph' || $from.parentOffset !== 0) return null
          const { tr } = state
          const from = $from.before()
          const to = $from.after()
          const rest = $from.parent.content.cut(range.to - $from.start())
          const json = build() as { type: string }
          let node
          try {
            node = state.schema.nodeFromJSON(json)
          } catch {
            return null
          }
          if (node.type.name === 'callout' && rest.size) node = node.type.create(node.attrs, state.schema.nodes.paragraph.create(null, rest))
          tr.replaceWith(from, to, node)
          if (opts.selectNode) tr.setSelection(NodeSelection.create(tr.doc, from))
          else {
            let caret = -1
            tr.doc.nodesBetween(from, from + node.nodeSize, (n, pos) => {
              if (caret >= 0) return false
              if (n.isTextblock) {
                caret = pos + 1 + n.content.size
                return false
              }
              return true
            })
            if (caret >= 0) tr.setSelection(TextSelection.create(tr.doc, caret))
          }
          return undefined
        },
      })
    void editor
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
      blockRule(/^>>\s$/, () => ({
        type: 'details',
        attrs: { open: true },
        content: [{ type: 'detailsSummary' }, { type: 'detailsContent', content: [{ type: 'paragraph' }] }],
      })),
      blockRule(/^!>\s$/, () => ({ type: 'callout', attrs: { icon: '💡', color: 'gray' }, content: [{ type: 'paragraph' }] })),
      blockRule(/^\$\$\s$/, () => ({ type: 'blockMath', attrs: { latex: '' } }), { selectNode: true }),
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

/** Scroll a block into view and flash it for ~2s. */
export function flashBlock(editor: import('@tiptap/core').Editor, pos: number) {
  if (editor.isDestroyed) return
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
