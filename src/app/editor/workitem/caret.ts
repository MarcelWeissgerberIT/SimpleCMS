/**
 * Task block — which task holds the caret: a node decoration `data-caret` on the innermost task around the
 * selection (its node view's outer element). The placard shows its ghost keys and the ⌄ key there — on touch
 * screens only there (no hover). Attributes only: the placard does not re-render for it.
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { WORK_ITEM } from './attrs'

const KEY = new PluginKey<DecorationSet>('workItemCaret')

/** The innermost task around the selection's head: [pos, end], or null. */
function caretItem(state: EditorState): [number, number] | null {
  const $head = state.selection.$head
  for (let d = $head.depth; d > 0; d--) {
    const node = $head.node(d)
    if (node.type.name === WORK_ITEM) return [$head.before(d), $head.after(d)]
  }
  return null
}

function decorate(state: EditorState): DecorationSet {
  const at = caretItem(state)
  return at ? DecorationSet.create(state.doc, [Decoration.node(at[0], at[1], { 'data-caret': '' })]) : DecorationSet.empty
}

export const WorkItemCaret = Extension.create({
  name: 'workItemCaret',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: KEY,
        state: {
          init: (_config, state) => decorate(state),
          apply(tr, set, old, state) {
            if (!tr.docChanged && !tr.selectionSet) return set
            const before = caretItem(old)
            const now = caretItem(state)
            // same task, same place: keep the set (mapped)
            if (!tr.docChanged && before && now && before[0] === now[0]) return set
            return decorate(state)
          },
        },
        props: { decorations: (state) => KEY.getState(state) },
      }),
    ]
  },
})
