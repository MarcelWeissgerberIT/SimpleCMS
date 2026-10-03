/**
 * Comments in the live editor: highlight decorations for the `comment` marks of known threads,
 * the draft range of a thread being written, click on a highlight → focus its thread,
 * Mod+Alt+M → comment the selection, and paste hygiene (anchors of threads that don't belong to
 * this page are dropped). Thread data lives on the page (store), UI state on the bridge.
 */
import { Extension, type Editor } from '@tiptap/core'
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { newId } from '../../lib/ids'
import type { Bridge, CommentsUI } from '../lib/bridge'

export interface CommentsPluginState {
  /** Range of the thread being written (mapped through edits until it is saved or dropped). */
  draft: { id: string; from: number; to: number } | null
  active: string | null
  /** Known threads of this page: id → resolved. */
  threads: Record<string, boolean>
  showResolved: boolean
  deco: DecorationSet
}

export type CommentsMeta = Partial<Pick<CommentsPluginState, 'draft' | 'active' | 'threads' | 'showResolved'>>

export const commentsKey = new PluginKey<CommentsPluginState>('comments')

function build(doc: PMNode, st: Omit<CommentsPluginState, 'deco'>): DecorationSet {
  const decos: Decoration[] = []
  const type = doc.type.schema.marks.comment
  if (type && Object.keys(st.threads).length) {
    doc.descendants((node, pos) => {
      if (!node.isInline) return true
      for (const m of node.marks) {
        if (m.type !== type) continue
        const id = String(m.attrs.id ?? '')
        if (!(id in st.threads)) continue
        const resolved = st.threads[id]
        if (resolved && !st.showResolved) continue
        decos.push(Decoration.inline(pos, pos + node.nodeSize, { class: `cmark-hl${id === st.active ? ' is-active' : ''}${resolved ? ' is-resolved' : ''}`, 'data-thread': id }))
      }
      return false
    })
  }
  const d = st.draft
  if (d && d.to > d.from) decos.push(Decoration.inline(d.from, d.to, { class: 'cmark-hl is-active is-draft', 'data-thread': d.id }))
  return decos.length ? DecorationSet.create(doc, decos) : DecorationSet.empty
}

/** Drop comment marks whose thread doesn't belong to this page (pasted from elsewhere). */
function foreignFree(fragment: Fragment, known: Record<string, boolean>): Fragment {
  const out: PMNode[] = []
  fragment.forEach((node) => {
    if (node.isText) {
      const keep = node.marks.filter((m) => m.type.name !== 'comment' || String(m.attrs.id) in known)
      out.push(keep.length === node.marks.length ? node : node.mark(keep))
    } else out.push(node.copy(foreignFree(node.content, known)))
  })
  return Fragment.fromArray(out)
}

const setUI = (bridge: Bridge, patch: Partial<CommentsUI>) => bridge.setState((s) => ({ comments: { ...s.comments, ...patch } }))

/** Comment the current text selection: a draft range + the composer in the rail. */
export function startComment(editor: Editor, bridge: Bridge): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false
  const { state } = editor
  const sel = state.selection
  if (sel.empty || !(sel instanceof TextSelection) || sel.$from.parent.type.spec.code) return false
  const quote = state.doc.textBetween(sel.from, sel.to, ' ', ' ').replace(/\s+/g, ' ').trim()
  if (!quote) return false
  const id = newId()
  const tr = state.tr.setMeta(commentsKey, { draft: { id, from: sel.from, to: sel.to }, active: id } satisfies CommentsMeta)
  // the highlight shows the range; a live text selection on top of it would hide it
  tr.setSelection(TextSelection.create(tr.doc, sel.to))
  editor.view.dispatch(tr)
  setUI(bridge, { draft: { id, quote: quote.slice(0, 400) }, active: id, via: 'text', panel: true })
  return true
}

/** Turn the draft into a real anchor (the comment mark). Returns the anchored range, or null. */
export function anchorDraft(editor: Editor): { id: string; from: number; to: number } | null {
  if (editor.isDestroyed) return null
  const d = commentsKey.getState(editor.state)?.draft
  const type = editor.schema.marks.comment
  if (!d || !type || d.to <= d.from) return null
  const tr = editor.state.tr.addMark(d.from, d.to, type.create({ id: d.id })).setMeta(commentsKey, { draft: null } satisfies CommentsMeta)
  editor.view.dispatch(tr)
  return d
}

export function dropDraft(editor: Editor): void {
  if (editor.isDestroyed || !commentsKey.getState(editor.state)?.draft) return
  editor.view.dispatch(editor.state.tr.setMeta(commentsKey, { draft: null } satisfies CommentsMeta))
}

/** Remove a thread's anchors from the doc (deleting the thread). */
export function removeAnchors(editor: Editor, id: string): void {
  if (editor.isDestroyed || !editor.isEditable) return
  const { state } = editor
  const type = state.schema.marks.comment
  if (!type) return
  const tr = state.tr
  state.doc.descendants((node, pos) => {
    if (!node.isInline) return true
    const m = node.marks.find((x) => x.type === type && x.attrs.id === id)
    if (m) tr.removeMark(pos, pos + node.nodeSize, m)
    return false
  })
  if (tr.docChanged) editor.view.dispatch(tr)
}

/** First anchored range of every thread in the doc (document order). */
export function anchorRanges(doc: PMNode): Map<string, { from: number; to: number }> {
  const out = new Map<string, { from: number; to: number }>()
  const type = doc.type.schema.marks.comment
  if (!type) return out
  doc.descendants((node, pos) => {
    if (!node.isInline) return true
    for (const m of node.marks) {
      if (m.type !== type) continue
      const id = String(m.attrs.id ?? '')
      const hit = out.get(id)
      if (!hit) out.set(id, { from: pos, to: pos + node.nodeSize })
      else if (hit.to === pos) hit.to = pos + node.nodeSize
    }
    return false
  })
  return out
}

/** Push thread / focus state into the decorations. */
export function syncComments(view: EditorView, meta: CommentsMeta): void {
  if (view.isDestroyed) return
  view.dispatch(view.state.tr.setMeta(commentsKey, meta).setMeta('addToHistory', false))
}

export function commentsExtension(bridge: Bridge) {
  return Extension.create({
    name: 'oneComments',
    addKeyboardShortcuts() {
      return { 'Mod-Alt-m': () => startComment(this.editor, bridge) }
    },
    addProseMirrorPlugins() {
      return [
        new Plugin<CommentsPluginState>({
          key: commentsKey,
          state: {
            init: () => ({ draft: null, active: null, threads: {}, showResolved: false, deco: DecorationSet.empty }),
            apply(tr, prev, _old, state) {
              const meta = tr.getMeta(commentsKey) as CommentsMeta | undefined
              if (!meta && !tr.docChanged) return prev
              let draft = meta && 'draft' in meta ? (meta.draft ?? null) : prev.draft
              if (draft && tr.docChanged && !(meta && 'draft' in meta)) {
                const from = tr.mapping.map(draft.from, 1)
                const to = tr.mapping.map(draft.to, -1)
                draft = to > from ? { ...draft, from, to } : null
              }
              const next = { ...prev, ...meta, draft }
              return { ...next, deco: build(state.doc, next) }
            },
          },
          props: {
            decorations: (state) => commentsKey.getState(state)?.deco,
            handleClick(view, _pos, event) {
              const hit = (event.target as Element | null)?.closest?.('[data-thread]')
              const id = hit?.getAttribute('data-thread') ?? null
              const st = commentsKey.getState(view.state)
              if (!st) return false
              if (id && id !== st.draft?.id) {
                setUI(bridge, { active: id, via: 'text', panel: true })
              } else if (!id && bridge.getState().comments.active && !st.draft) {
                setUI(bridge, { active: null, via: 'text' })
              }
              return false
            },
            transformPasted(slice, view) {
              const known = commentsKey.getState(view.state)?.threads ?? {}
              return new Slice(foreignFree(slice.content, known), slice.openStart, slice.openEnd)
            },
          },
        }),
      ]
    },
  })
}
