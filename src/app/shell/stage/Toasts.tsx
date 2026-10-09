import { useEffect, useLayoutEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { X } from 'lucide-react'
import { useUI, type Toast } from '../../store/ui'
import { useT } from '../../i18n'
import { canFocus, dropFocusHandoff, focusLost, focusMainRegion, focusNear, handFocusOver } from '../../ui/focus'
import { armClosingGesture, pressOf, type Press } from '../../ui/gesture'

/*
 * A toast's keys remove the toast. The rest of a double-click or double tap on one never acts on what then lies under
 * the pointer — the app, a dialog, or a new toast in the old one's place (its key also ignores a click counted as a
 * double-click's second unless the click sequence began on that very toast). Focus never ends on the page body: it
 * goes back to where it was before the press (or before the keyboard came into the toasts), else to the main region.
 */

/** The toast whose key began the current mouse click sequence (null: it began elsewhere). */
let sequenceOn: string | null = null
/** Where focus was before a key in the toasts was pressed, or before the keyboard came into them. */
let focusBefore: HTMLElement | null = null
/** The last pointer press on a toast's key (null after a key of the keyboard). */
let press: Press | null = null

const toastOf = (target: EventTarget | null) => (target instanceof Element ? (target.closest<HTMLElement>('[data-toast-id]')?.dataset.toastId ?? null) : null)
const outsideToasts = (el: EventTarget | null): el is HTMLElement => canFocus(el as Element | null) && !(el as HTMLElement).closest('.toasts')

/** Focus that was in a toast going away: back where it was before (two frames later — a dialog the key opened goes first), else the main region. */
function giveFocusBack(before: HTMLElement | null) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      dropFocusHandoff(before)
      if (!focusLost()) return
      if (!focusNear(before)) focusMainRegion()
    }),
  )
}

export function Toasts() {
  const t = useT()
  const toasts = useUI((s) => s.toasts)

  // where a click sequence began (a double-click's second click on a new toast in the old one's place is not its own)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (e.detail <= 1) sequenceOn = toastOf(e.target)
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [])

  return (
    <div
      className="toasts"
      role="region"
      aria-live="polite"
      aria-label={t('shell.toast.region')}
      onPointerDownCapture={(e) => {
        // before the press moves focus onto the key
        const active = document.activeElement
        if (!active?.closest('.toasts')) focusBefore = outsideToasts(active) ? active : null
        press = e.target instanceof Element && e.target.closest('button') ? pressOf(e) : null
      }}
      onFocusCapture={(e) => {
        const from = e.relatedTarget
        if (!(from instanceof Element && from.closest('.toasts'))) focusBefore = outsideToasts(from) ? from : focusBefore
      }}
      onKeyDownCapture={() => (press = null)}
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  )
}

function ToastItem({ toast }: { toast: Toast }) {
  const t = useT()
  const dismiss = useUI((s) => s.dismissToast)
  const ref = useRef<HTMLDivElement>(null)

  // removed while it holds the focus (a key pressed, its time ran out): focus goes back
  useLayoutEffect(() => {
    const el = ref.current
    return () => {
      if (el?.contains(document.activeElement)) giveFocusBack(focusBefore)
    }
  }, [])

  /** A key: runs, removes the toast, swallows the rest of its gesture. */
  const key = (run?: () => void) => (e: ReactMouseEvent) => {
    // the second click of a double-click that began elsewhere (on a toast that stood here a moment ago): not this key's
    if (e.detail >= 2 && sequenceOn !== toast.id) return
    // a dialog the key opens gives focus back where it was before the press
    handFocusOver(focusBefore)
    run?.()
    dismiss(toast.id)
    armClosingGesture(press, { exemptModals: false })
    press = null
  }

  return (
    <div ref={ref} className="toast" data-toast-id={toast.id} data-kind={toast.kind ?? 'info'} data-more={toast.more?.length ? '' : undefined} role={toast.kind === 'error' ? 'alert' : 'status'}>
      <span className="toast__led" aria-hidden />
      <span className="toast__msg">{toast.message}</span>
      {toast.action && (
        <button type="button" className="toast__action" onClick={key(toast.action.run)}>
          {toast.action.label}
        </button>
      )}
      {toast.more?.map((m, i) => (
        <button key={i} type="button" className="toast__action" onClick={key(m.run)}>
          {m.label}
        </button>
      ))}
      <button type="button" className="toast__close" aria-label={t('common.close')} onClick={key()}>
        <X size={13} />
      </button>
    </div>
  )
}
