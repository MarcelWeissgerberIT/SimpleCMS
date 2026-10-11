/**
 * Keyboard way into a block's own links and keys: with a breadcrumb, file / PDF or embed block
 * selected, Tab focuses the first link or key of its toolbar ([data-block-tools]); from there Tab
 * walks them (keys inside a node view never reach ProseMirror) and Escape returns to the block.
 * Meeting notes: the block itself or a block directly in its notes selected → its foot keys.
 */
import { Extension } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'

const TOOL_BLOCKS = new Set(['breadcrumb', 'fileBlock', 'embed'])
const TOOLS = '[data-block-tools] a[href], [data-block-tools] button:not([disabled])'

/** The block whose tools Tab reaches: a tool block, or the meeting notes the selected block sits directly in. */
function toolsAt(sel: NodeSelection): number | null {
  const name = sel.node.type.name
  if (TOOL_BLOCKS.has(name) || name === 'meetingNotes') return sel.from
  return sel.$from.parent.type.name === 'meetingNotes' ? sel.$from.before() : null
}

export const BlockToolKeys = Extension.create({
  name: 'blockToolKeys',
  // before BlockSelection (1050) and the Tab trap
  priority: 1060,
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const { view } = this.editor
        const sel = view.state.selection
        if (!(sel instanceof NodeSelection)) return false
        const at = toolsAt(sel)
        if (at === null) return false
        const dom = view.nodeDOM(at) as HTMLElement | null
        const first = dom?.querySelector<HTMLElement>(TOOLS)
        if (!first) return false
        first.focus()
        return true
      },
    }
  },
})
