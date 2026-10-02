import type { MouseEvent } from 'react'

/**
 * Toggle helper for useMenu(): reads currentTarget synchronously (React clears it
 * after dispatch, so it must not be read inside a state updater).
 */
export function toggleMenu(menu: { open: boolean; openAt: (el: Element) => void; close: () => void }) {
  return (e: MouseEvent) => {
    const el = e.currentTarget
    if (menu.open) menu.close()
    else menu.openAt(el)
  }
}
