/**
 * AI terminal — references: a passage selected in a page editor, sent along with the next task as
 * context (page title + id + the selection as Markdown). Works in read-only editors too: there the
 * DOM selection is read (a read-only view takes no focus, so no keymap sees the shortcut).
 */
import type { Editor, JSONContent } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'
import { useWorkspace } from '../../../store/store'
import { useUI } from '../../../store/ui'
import { newId } from '../../../lib/ids'
import { t } from '../../../i18n'
import { toMarkdown } from '../../share/markdown'
import { addRef, openAgent, REF_MAX } from './state'
import type { TermRef } from './types'

/** Characters of one reference, at most (the rest is cut with a note to Claude). */
export const REF_CHARS = 8000

/** The selection as Markdown (the AI menu's conversion: inline slices become a paragraph). */
function sliceToMarkdown(state: EditorState, from: number, to: number): string {
  try {
    const slice = state.doc.slice(from, to)
    const json = slice.content.toJSON() as JSONContent[] | null
    if (!json?.length) return ''
    const first = slice.content.firstChild
    const doc: JSONContent = first?.isInline ? { type: 'doc', content: [{ type: 'paragraph', content: json }] } : { type: 'doc', content: json }
    const md = toMarkdown(doc).trim()
    if (md) return md
  } catch {
    /* fall through */
  }
  return state.doc.textBetween(from, to, '\n\n', ' ')
}

type EditorDom = HTMLElement & { editor?: Editor }

/** The editor (and the range) the DOM selection lies in, if any. */
function domSelection(): { editor: Editor; from: number; to: number } | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null
  const range = sel.getRangeAt(0)
  const node = range.commonAncestorContainer
  const el = (node instanceof Element ? node : node.parentElement)?.closest('.ProseMirror') as EditorDom | null
  const editor = el?.editor
  if (!editor || editor.isDestroyed) return null
  // a focused editor keeps its own selection in sync (node and cell selections included); a
  // read-only one (no focus) only has the DOM's
  const s = editor.state.selection
  if (editor.view.hasFocus() && !s.empty) return { editor, from: s.from, to: s.to }
  try {
    const a = editor.view.posAtDOM(range.startContainer, range.startOffset)
    const b = editor.view.posAtDOM(range.endContainer, range.endOffset)
    return a === b ? null : { editor, from: Math.min(a, b), to: Math.max(a, b) }
  } catch {
    return s.empty ? null : { editor, from: s.from, to: s.to }
  }
}

/** A reference from an editor's selection (or the DOM selection); null when nothing is selected. */
export function captureRef(editor?: Editor): TermRef | null {
  let hit: { editor: Editor; from: number; to: number } | null = null
  if (editor && !editor.isDestroyed && !editor.state.selection.empty) hit = { editor, from: editor.state.selection.from, to: editor.state.selection.to }
  else hit = domSelection()
  if (!hit) return null
  const pageId = hit.editor.view.dom.getAttribute('data-page-id')
  const page = pageId ? useWorkspace.getState().pages[pageId] : undefined
  if (!pageId || !page) return null
  const full = sliceToMarkdown(hit.editor.state, hit.from, hit.to).trim()
  if (!full) return null
  const clipped = full.length > REF_CHARS
  const markdown = clipped ? full.slice(0, REF_CHARS) : full
  return {
    id: newId(),
    pageId,
    title: page.title.trim() || t('common.untitled'),
    markdown,
    lines: full.split('\n').filter((l) => l.trim()).length || 1,
    ...(clipped ? { clipped: true } : {}),
  }
}

/**
 * "Add to terminal" (bubble toolbar, Mod+Shift+J): the selection becomes a reference chip and the
 * terminal opens (or takes focus). Returns false when nothing usable was selected.
 */
export function addSelectionRef(editor?: Editor): boolean {
  const ref = captureRef(editor)
  if (!ref) {
    useUI.getState().toast({ message: t('features.agent.ref.none') })
    return false
  }
  if (!addRef(ref)) useUI.getState().toast({ message: t('features.agent.ref.full', { max: REF_MAX }), kind: 'error' })
  openAgent()
  return true
}
