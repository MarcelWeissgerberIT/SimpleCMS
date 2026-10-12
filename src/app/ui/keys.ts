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

/**
 * typing() for the keys of a panel that may itself sit inside a dialog (the governor's brake note in the AI menu, ⌘K, a
 * modal): a text field, or a menu / listbox / dialog nested inside `root`, owns the letter keys — the dialog the panel
 * lives in does not.
 */
export function typingWithin(el: Element | null, root: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable) return true
  const inner = el.closest('[role="menu"], [role="listbox"], [role="dialog"]')
  return !!inner && !!root && inner !== root && root.contains(inner)
}
