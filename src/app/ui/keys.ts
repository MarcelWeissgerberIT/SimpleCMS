/**
 * Shared single-key rules (Preflight's queue, the agent run review): a letter key belongs to whatever holds the focus
 * when that is a text field, a menu, a listbox or a dialog.
 */

/** Focus is in a text field, a menu, a listbox or a dialog: single-letter keys belong to it. */
export function typing(el: Element | null = document.activeElement): boolean {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable) return true
  return !!el.closest('[role="menu"], [role="listbox"], [role="dialog"]')
}
