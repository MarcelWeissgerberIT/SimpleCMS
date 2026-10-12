/**
 * What the governor's plates (the brake note, the halt card) share:
 *  - useKeyGuard: their letter keys never act on a held key's repeats, nor in the first moment after the plate appeared
 *    — a letter typed elsewhere just before (a sentence in the editor while a background task reached the line) never
 *    allows money or switches the model;
 *  - useLateLive: a polite live region filled a moment AFTER it is mounted (a region born with its text is rarely
 *    read) — only when the plate did not take focus; with focus, its aria-describedby speaks.
 */
import { useEffect, useRef, useState } from 'react'

/** after the plate appeared, its letter keys wait this long */
export const KEY_ARM_MS = 350
/** the live region's text arrives this long after it was mounted */
export const LIVE_DELAY_MS = 150

/** True when a letter key may act now. */
export function useKeyGuard(): (e: { repeat: boolean }) => boolean {
  const shown = useRef(0)
  useEffect(() => {
    shown.current = performance.now()
  }, [])
  return (e) => !e.repeat && shown.current > 0 && performance.now() - shown.current >= KEY_ARM_MS
}

/** The live region's text: empty at first, `text` a moment later while `on` (empty again when it goes off). */
export function useLateLive(text: string, on: boolean): string {
  const [live, setLive] = useState('')
  useEffect(() => {
    if (!on) {
      setLive('')
      return
    }
    const id = setTimeout(() => setLive(text), LIVE_DELAY_MS)
    return () => clearTimeout(id)
  }, [text, on])
  return live
}
