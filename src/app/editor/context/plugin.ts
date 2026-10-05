/**
 * Context marks in the editor: registers the live editor of its page (store.ts) and, while the picker
 * is open on it, pauses typing (editable → false) and dims the unmarked top-level blocks through a
 * DecorationSet. The marks themselves are block ids in the store, so they follow every edit.
 */
import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { blockKey } from './read'
import { bumpRev, contextStore, pageIdOfEditor, registerEditor, unregisterEditor } from './store'

interface CtxState {
  picking: boolean
  deco: DecorationSet
}

export const contextKey = new PluginKey<CtxState>('contextMarks')

function decorate(doc: PMNode, editor: Editor): CtxState {
  const picker = contextStore.getState().picker
  if (!picker || picker.editor !== editor) return { picking: false, deco: DecorationSet.empty }
  const on = new Set(picker.ids)
  const decos: Decoration[] = []
  doc.forEach((node, pos, i) => {
    decos.push(Decoration.node(pos, pos + node.nodeSize, { class: on.has(blockKey(node, i)) ? 'ctx-on' : 'ctx-off' }))
  })
  return { picking: true, deco: DecorationSet.create(doc, decos) }
}

export const ContextMarks = Extension.create<Record<string, never>, { pageId: string | null }>({
  name: 'contextMarks',

  addStorage() {
    return { pageId: null }
  },

  onCreate() {
    const pageId = pageIdOfEditor(this.editor)
    this.storage.pageId = pageId
    if (pageId) registerEditor(pageId, this.editor)
  },

  onDestroy() {
    if (this.storage.pageId) unregisterEditor(this.storage.pageId, this.editor)
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin<CtxState>({
        key: contextKey,
        state: {
          init: (_config, state) => decorate(state.doc, editor),
          apply: (tr, prev, _old, state) => (tr.getMeta(contextKey) || (prev.picking && tr.docChanged) ? decorate(state.doc, editor) : prev),
        },
        props: {
          decorations: (state) => contextKey.getState(state)?.deco ?? null,
          // the picker reads the page: no typing until Done
          editable: (state) => !contextKey.getState(state)?.picking,
        },
        view: (view) => {
          // marks or the picker changed: redraw (the decorations read the store)
          let last = contextStore.getState()
          const unsub = contextStore.subscribe((s) => {
            const changed = s.picker !== last.picker
            last = s
            if (!changed || view.isDestroyed) return
            if (s.picker?.editor === editor || contextKey.getState(view.state)?.picking) view.dispatch(view.state.tr.setMeta(contextKey, true).setMeta('addToHistory', false))
          })
          return {
            // words / blocks readouts follow typing
            update: (v, prevState) => {
              if (v.state.doc !== prevState.doc) bumpRev()
            },
            destroy: unsub,
          }
        },
      }),
    ]
  },
})
