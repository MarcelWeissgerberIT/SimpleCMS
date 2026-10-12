/**
 * The eject's toast (E17, mock-3): the eject glyph, "{back} Stellen von {writer} zurück" · "{held} gehalten", the Undo
 * key with its keycap and "Gehaltene zeigen" (the held cards flash; none on screen: their database opens); 15 s,
 * raised after the dialog unmounted. While it is shown, Mod+Z is its Undo (C26): `e.key === 'z'` (never `e.code` —
 * QWERTZ), ⌘ on a Mac / Ctrl elsewhere, no Alt, no Shift, no AltGr; never with focus in a field or an editor, never
 * while a dialog, a popover or a menu is open. Mod+Alt+Z (the deck) and redo are never taken. An Undo from anywhere
 * else (the after-plate's key) takes the toast away with its Mod+Z — the next Mod+Z is the app's own again.
 */
import { useUI } from '../../../store/ui'
import { currentLang, t } from '../../../i18n'
import { openPage } from '../../../lib/router'
import { isMac } from '../../../ui/controls'
import { fmtNum, pl, unit } from './format'
import { setLastEject, useRecorderUI } from './state'

const TIMEOUT = 15_000

/** The toast each eject raised (by eject id): an Undo from elsewhere dismisses it and disarms its Mod+Z. */
const toastOf = new Map<string, string>()

/** Take the eject's toast away (its Mod+Z goes with it). */
function dropToast(id: string): void {
  const toastId = toastOf.get(id)
  if (!toastId) return
  toastOf.delete(id)
  useUI.getState().dismissToast(toastId)
}

/** The held cards of the last eject flash (or their database opens when none is on screen). */
export function showHeld(dbId: string | null): void {
  const flash = () => {
    const cards = [...document.querySelectorAll<HTMLElement>('[data-held]:not(i)')]
    if (!cards.length) return false
    cards[0].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    for (const c of cards) {
      c.dataset.flash = ''
      window.setTimeout(() => delete c.dataset.flash, 1400)
    }
    return true
  }
  if (flash() || !dbId) return
  openPage(dbId)
  // the database renders its cards a moment later
  let tries = 0
  const again = () => {
    if (flash() || ++tries > 20) return
    window.setTimeout(again, 100)
  }
  window.setTimeout(again, 100)
}

/** The Undo of an eject, with its outcome as a toast. */
export async function runEjectUndo(id: string): Promise<void> {
  const { undoEject } = await import('../eject/undo')
  const r = await undoEject(id)
  const lang = currentLang()
  const toast = useUI.getState().toast
  if ('refused' in r) {
    // undone already (another tab, the plate): its toast has nothing left to undo
    if (r.refused.key === 'undone' || r.refused.key === 'gone') dropToast(id)
    toast({ message: t(`features.recorder.eject.${r.refused.key}`), kind: 'error' })
    return
  }
  dropToast(id)
  // the board's marks belonged to the eject
  if (useRecorderUI.getState().lastEject?.id === id) setLastEject(null)
  const back = unit(t, lang, 'places', r.back)
  const message = r.kept ? t(pl('features.recorder.toast.undoneKept', r.kept), { back, kept: fmtNum(r.kept, lang) }) : t('features.recorder.toast.undone', { back })
  toast({ message, kind: 'success', ...(r.slips ? { detail: t('features.recorder.toast.slipsStay', { n: fmtNum(r.slips, lang) }) } : {}), timeout: r.slips ? 8000 : 5000 })
}

/** Raise the eject's toast; while it shows, Mod+Z runs its Undo. Returns the toast's id. */
export function raiseEjectToast(o: { id: string; back: number; held: number; writer: string; dbId: string | null; onUndo?: () => void }): string {
  const lang = currentLang()
  const undo = () => {
    o.onUndo?.()
    void runEjectUndo(o.id)
  }
  const toastId = useUI.getState().toast({
    message: t('features.recorder.toast.ejected', { places: unit(t, lang, 'places', o.back), writer: o.writer }),
    ...(o.held ? { detail: t('features.recorder.toast.held', { n: fmtNum(o.held, lang) }) } : {}),
    glyph: 'eject',
    kind: 'success',
    action: { label: t('common.undo'), undo: true, kbd: 'Mod+Z', run: undo },
    ...(o.held ? { more: [{ label: t('features.recorder.toast.showHeld'), run: () => showHeld(o.dbId) }] } : {}),
    timeout: TIMEOUT,
  })
  toastOf.set(o.id, toastId)
  armUndoKey(toastId, undo)
  return toastId
}

/** Is focus somewhere Mod+Z belongs to (a field, an editor)? */
const inText = (el: Element | null): boolean => !!el?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), .ProseMirror')
/** Is something open that owns the keys (a dialog, a popover, a menu)? */
const somethingOpen = (): boolean => !!document.querySelector('[aria-modal="true"], .popover, [role="menu"]')

/** Mod+Z → `run` while the toast `toastId` is on screen. */
export function armUndoKey(toastId: string, run: () => void): void {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'z' || e.altKey || e.shiftKey || e.getModifierState?.('AltGraph')) return
    if (!(isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey)) return
    if (e.defaultPrevented || inText(document.activeElement) || somethingOpen()) return
    e.preventDefault()
    e.stopPropagation()
    stop()
    useUI.getState().dismissToast(toastId)
    run()
  }
  const unsub = useUI.subscribe((s) => {
    if (s.toasts.some((x) => x.id === toastId) || s.waitingToasts.some((x) => x.id === toastId)) return
    stop()
    for (const [id, tid] of toastOf) if (tid === toastId) toastOf.delete(id)
  })
  function stop() {
    window.removeEventListener('keydown', onKey, true)
    unsub()
  }
  window.addEventListener('keydown', onKey, true)
}
