import { useEffect, useRef } from 'react'

/**
 * Claim Escape before anything else (window, capture phase): the shared Popover closes on
 * Escape through `onClose`, which can't tell "cancel" from "click outside". Inline editors
 * that must treat Escape as cancel / leave-with-focus register here while open.
 */
export function useEscapeFirst(handler: () => void, active = true) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return
      e.preventDefault()
      e.stopPropagation()
      ref.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active])
}
