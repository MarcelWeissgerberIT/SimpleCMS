import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * Focus going back to where it was (a dialog, the palette … closing).
 *
 * A text editor (the ProseMirror root of a TipTap editor, which carries its editor as `dom.editor`)
 * gets it through its view, which puts the editor's own caret back. A plain focus() lets the browser
 * drop the caret at the start of the document, and ProseMirror only takes that back when the last
 * click in the editor was more than 300 ms ago — quick hands (click, ⌘K, Esc) would type at the start.
 */
interface EditorRoot extends HTMLElement {
  editor?: { isDestroyed: boolean; isEditable: boolean; view: { dom: Element; focus: () => void } }
}

export function restoreFocus(el: Element | null | undefined): void {
  if (!(el instanceof HTMLElement)) return
  const editor = (el as EditorRoot).editor
  if (editor && !editor.isDestroyed && editor.isEditable && editor.view.dom === el) editor.view.focus()
  else el.focus({ preventScroll: true })
}

/**
 * Focus a field that a click is about to show — in the same commit, not a frame later: the first letters
 * typed right after the click (on a busy machine a frame can take long) would go elsewhere. Call the
 * returned function together with the state change that mounts the field (already shown: focused at once).
 */
export function useFocusWhenShown<T extends HTMLElement>(ref: RefObject<T | null>): () => void {
  const want = useRef(false)
  useLayoutEffect(() => {
    if (!want.current || !ref.current) return
    want.current = false
    ref.current.focus({ preventScroll: true })
  })
  return useCallback(() => {
    if (ref.current) ref.current.focus({ preventScroll: true })
    else want.current = true
  }, [ref])
}
