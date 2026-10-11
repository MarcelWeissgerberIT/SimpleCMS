/**
 * Task block — what a person's status change did, said to screen readers: one visually hidden polite live region
 * (made on first use) that reads "Done: Run the checkout with test cards". The key, ⌄, Mod+Enter, Mod+Alt+Enter and
 * the menu's Status picks change only the placard's LED and label otherwise — nothing a screen reader announces.
 */
import { t } from '../../i18n'
import type { WorkItemStatus } from './attrs'

let region: HTMLElement | null = null
let pending = 0

function liveRegion(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  if (region?.isConnected) return region
  region = document.createElement('div')
  region.className = 'visually-hidden'
  region.setAttribute('role', 'status')
  region.setAttribute('aria-live', 'polite')
  region.dataset.testid = 'wi-announce'
  document.body.appendChild(region)
  return region
}

/** "Done: <title>" (several: one line each) — after a person changed tasks' status. */
export function announceStatus(changes: ReadonlyArray<{ status: WorkItemStatus; title: string }>): void {
  const el = liveRegion()
  if (!el || !changes.length) return
  const text = changes
    .map((c) => t('editor.workItem.announce.status', { status: t(`editor.workItem.status.${c.status}`), title: c.title || t('features.workItems.untitled') }))
    .join(' ')
  // emptied first, filled a frame later: the same words twice in a row are announced again
  el.textContent = ''
  cancelAnimationFrame(pending)
  pending = requestAnimationFrame(() => {
    el.textContent = text
  })
}
