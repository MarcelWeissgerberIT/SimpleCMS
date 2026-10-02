import { useEffect, useState, useSyncExternalStore } from 'react'
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
