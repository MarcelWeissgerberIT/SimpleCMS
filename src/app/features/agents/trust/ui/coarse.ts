/** A touch screen (no hover, a coarse pointer): the trust UI's own hook — features never import shell/** or Preflight. */
import { useEffect, useState } from 'react'

const QUERY = '(hover: none) and (pointer: coarse)'

export const coarse = (): boolean => typeof window !== 'undefined' && !!window.matchMedia?.(QUERY).matches

export function useCoarse(): boolean {
  const [on, setOn] = useState(coarse)
  useEffect(() => {
    const mq = window.matchMedia?.(QUERY)
    if (!mq) return
    const change = () => setOn(mq.matches)
    change()
    mq.addEventListener?.('change', change)
    return () => mq.removeEventListener?.('change', change)
  }, [])
  return on
}
