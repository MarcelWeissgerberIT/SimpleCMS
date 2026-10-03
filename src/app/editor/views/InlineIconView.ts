/**
 * Node view of the inline `icon` atom — plain DOM (no React root per icon: a page may hold hundreds).
 * Objects render their ceramic image, glyphs their SVG once the glyph registry is loaded (a
 * line-sized blank until then, so nothing jumps). In an editable editor a click (or ↵ on the
 * selected icon, extensions/kit.ts) asks the overlay for the change / remove popover.
 */
import { Extension, type AnyExtension, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection } from '@tiptap/pm/state'
import type { NodeView } from '@tiptap/pm/view'
import { resolveAssetUrl } from '../../lib/files'
import { ICON, ICON_EDIT_EVENT, iconAssetPath, iconAttrs, iconLabel, validIcon, type IconAttrs } from '../schema/icon'
import { glyphElement, loadGlyphs, loadedGlyphs, subscribeGlyphs } from '../icons/glyphs'
import '../icons/icons.css'

const same = (a: IconAttrs, b: IconAttrs) => a.kind === b.kind && a.name === b.name && a.color === b.color

/** Ask the editor's overlay to open the popover of the icon at `pos`. */
export function requestIconEdit(editor: Editor, pos: number) {
  editor.view.dom.dispatchEvent(new CustomEvent(ICON_EDIT_EVENT, { detail: { pos } }))
}

class InlineIconView implements NodeView {
  dom: HTMLElement
  private attrs: IconAttrs
  private selected = false
  private unsubscribe: (() => void) | null = null

  constructor(
    node: PMNode,
    private editor: Editor,
    private getPos: () => number | undefined,
  ) {
    this.dom = document.createElement('span')
    this.dom.setAttribute('data-type', 'icon')
    this.dom.contentEditable = 'false'
    this.attrs = iconAttrs(node.attrs)
    this.dom.addEventListener('click', this.onClick)
    this.render()
  }

  private onClick = (e: MouseEvent) => {
    const pos = this.getPos()
    if (!this.editor.isEditable || typeof pos !== 'number' || e.button !== 0) return
    requestIconEdit(this.editor, pos)
  }

  private render() {
    const a = this.attrs
    const label = iconLabel(a)
    this.unsubscribe?.()
    this.unsubscribe = null
    // a re-render (new attrs) keeps the selection outline: ProseMirror won't select the node again
    this.dom.className = `one-icon one-icon--${a.kind}${this.selected ? ' ProseMirror-selectednode' : ''}`
    this.dom.dataset.kind = a.kind
    this.dom.dataset.name = a.name
    if (a.color) this.dom.dataset.color = a.color
    else delete this.dom.dataset.color
    this.dom.style.color = a.color ? `var(--c-${a.color}-text)` : ''
    this.dom.title = label
    this.dom.setAttribute('role', 'img')
    this.dom.setAttribute('aria-label', label)
    this.dom.replaceChildren()
    if (!validIcon(a)) return this.unknown()
    if (a.kind === 'asset') {
      const img = document.createElement('img')
      img.src = resolveAssetUrl(iconAssetPath(a.name))
      img.alt = ''
      img.draggable = false
      img.decoding = 'async'
      img.addEventListener('error', () => img.parentNode === this.dom && this.unknown(), { once: true })
      this.dom.append(img)
      return
    }
    const registry = loadedGlyphs()
    if (!registry) {
      this.dom.classList.add('is-loading')
      this.unsubscribe = subscribeGlyphs(() => this.render())
      void loadGlyphs().catch(() => {})
      return
    }
    const glyph = registry.GLYPH_BY_NAME.get(a.name)
    if (!glyph) return this.unknown()
    this.dom.append(glyphElement(glyph.node))
  }

  /** A file or glyph that doesn't exist (any more): a hairline box, the name in the tooltip. */
  private unknown() {
    this.dom.replaceChildren()
    this.dom.classList.add('is-unknown')
  }

  update(node: PMNode) {
    if (node.type.name !== ICON) return false
    const next = iconAttrs(node.attrs)
    if (!same(next, this.attrs)) {
      this.attrs = next
      this.render()
    }
    return true
  }

  selectNode() {
    this.selected = true
    this.dom.classList.add('ProseMirror-selectednode')
    // like ProseMirror's own views: a selected atom can be dragged elsewhere
    this.dom.draggable = true
  }

  deselectNode() {
    this.selected = false
    this.dom.classList.remove('ProseMirror-selectednode')
    this.dom.draggable = false
  }

  ignoreMutation() {
    return true
  }

  stopEvent() {
    return false
  }

  destroy() {
    this.unsubscribe?.()
    this.dom.removeEventListener('click', this.onClick)
  }
}

/** Attach the node view to the schema node (see views/index.ts). */
export function withInlineIconView(ext: AnyExtension): AnyExtension {
  return (ext as AnyExtension & { extend: (c: object) => AnyExtension }).extend({
    addNodeView() {
      return ({ node, editor, getPos }: { node: PMNode; editor: Editor; getPos: () => number | undefined }) => new InlineIconView(node, editor, getPos)
    },
  })
}

/**
 * ↵ on a selected inline icon opens its popover (instead of splitting the line, which would
 * replace the icon). Runs before the list / toggle Enter handling.
 */
export const IconKeys = Extension.create({
  name: 'inlineIconKeys',
  priority: 1040,
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const sel = editor.state.selection
        if (!(sel instanceof NodeSelection) || sel.node.type.name !== ICON || !editor.isEditable) return false
        requestIconEdit(editor, sel.from)
        return true
      },
    }
  },
})
