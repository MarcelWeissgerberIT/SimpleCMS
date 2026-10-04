/**
 * Keyboard way into a block's own links and keys: with a breadcrumb, file / PDF or embed block
 * selected, Tab focuses the first link or key of its toolbar ([data-block-tools]); from there Tab
 * walks them (keys inside a node view never reach ProseMirror) and Escape returns to the block.
 */
import { Extension } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'

const TOOL_BLOCKS = new Set(['breadcrumb', 'fileBlock', 'embed'])

export const BlockToolKeys = Extension.create({
  name: 'blockToolKeys',
  // before BlockSelection (1050) and the Tab trap
  priority: 1060,
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const { view } = this.editor
        const sel = view.state.selection
        if (!(sel instanceof NodeSelection) || !TOOL_BLOCKS.has(sel.node.type.name)) return false
        const dom = view.nodeDOM(sel.from) as HTMLElement | null
        const first = dom?.querySelector<HTMLElement>('[data-block-tools] a[href], [data-block-tools] button:not([disabled])')
        if (!first) return false
        first.focus()
        return true
      },
    }
  },
})
