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
