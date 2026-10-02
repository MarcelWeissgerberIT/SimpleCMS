import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { shortcutLabel } from '../../ui/controls'
import { getSaveStatus, onSaveStatus } from '../../store/persistence'
import { safeLocalGet, safeLocalSet } from '@/shared/brand'

export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false)
  const [match, setMatch] = useState(get)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatch(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return match
}

export const MOBILE_QUERY = '(max-width: 767px)'
export const useIsMobile = () => useMediaQuery(MOBILE_QUERY)

export type SaveStatus = ReturnType<typeof getSaveStatus>
export function useSaveStatus(): SaveStatus {
  return useSyncExternalStore(onSaveStatus, getSaveStatus, getSaveStatus)
}

/** Per-viewer UI preference stored in localStorage (never workspace data). */
export function useLocalPref<T>(key: string, initial: T): [T, (v: T) => void] {
  const [val, setVal] = useState<T>(() => {
    const raw = safeLocalGet(key)
    if (raw === null) return initial
    try {
      return JSON.parse(raw) as T
    } catch {
      return initial
    }
  })
  const set = (v: T) => {
    setVal(v)
    safeLocalSet(key, JSON.stringify(v))
  }
  return [val, set]
}

/** Re-render every `ms` (for relative timestamps). */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(id)
  }, [ms])
  return now
}

/** The theme actually applied to <html data-theme> ('system' resolved). */
export function useResolvedTheme(): 'light' | 'dark' {
  return useSyncExternalStore(
    (cb) => {
      const mo = new MutationObserver(cb)
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
      return () => mo.disconnect()
    },
    () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'),
    () => 'light',
  )
}

/** Touch-first device (no hover, coarse pointer): keyboard hints are noise there. */
export const TOUCH_QUERY = '(hover: none) and (pointer: coarse)'
export const useIsTouch = () => useMediaQuery(TOUCH_QUERY)

/** Shortcut label for hints, or undefined on touch devices. */
export function useKbdHint(): (shortcut: string) => string | undefined {
  const touch = useIsTouch()
  return (s: string) => (touch ? undefined : shortcutLabel(s))
}

/**
 * Scroll behaviour of a page column (main page, stacked pane, peek):
 *
 *  - Hold: until the reader touches the column (wheel, touch, pointer, any key), scrolls
 *    nobody asked for are undone. Embedded widgets that call scrollIntoView() while they
 *    mount scroll every ancestor too, and would open the page below its cover and title.
 *  - Keep: a column folded into a spine stays mounted but hidden; unfolding puts the
 *    reader back where they were.
 *  - `key`: a new page in the same column (the peek navigating in place) starts at the top.
 *
 * `hold: false` for scrolls the shell itself wants (deep links to a block).
 */
export function useColumnScroll(ref: RefObject<HTMLElement | null>, opts: { key?: unknown; folded?: boolean; hold?: boolean } = {}) {
  const { key, folded = false, hold = true } = opts
  const st = useRef({ armed: hold, top: 0, left: 0, folded })
  st.current.folded = folded
  if (!hold) st.current.armed = false

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const s = st.current
    const release = () => {
      s.armed = false
    }
    const onScroll = () => {
      if (s.folded || !el.clientHeight) return // hidden: nothing to read, nothing to remember
      if (s.armed) {
        if (el.scrollTop !== s.top) el.scrollTop = s.top
        if (el.scrollLeft !== s.left) el.scrollLeft = s.left
        return
      }
      s.top = el.scrollTop
      s.left = el.scrollLeft
    }
    const passive = { passive: true, capture: true }
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('wheel', release, passive)
    el.addEventListener('touchstart', release, passive)
    el.addEventListener('pointerdown', release, true)
    window.addEventListener('keydown', release, true)
    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', release, passive)
      el.removeEventListener('touchstart', release, passive)
      el.removeEventListener('pointerdown', release, true)
      window.removeEventListener('keydown', release, true)
    }
  }, [ref])

  const firstKey = useRef(true)
  useEffect(() => {
    if (firstKey.current) {
      firstKey.current = false
      return
    }
    const el = ref.current
    const s = st.current
    s.armed = hold
    s.top = 0
    s.left = 0
    if (el) {
      el.scrollTop = 0
      el.scrollLeft = 0
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const el = ref.current
    if (folded || !el) return
    const s = st.current
    if (el.scrollTop !== s.top) el.scrollTop = s.top
    if (el.scrollLeft !== s.left) el.scrollLeft = s.left
  }, [folded, ref])
}
