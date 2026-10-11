/** A coarse pointer (touch) on this device — Preflight's own (features never import shell/**). */
import { useEffect, useState } from 'react'

const QUERY = '(pointer: coarse)'

export const coarsePointer = (): boolean => typeof window !== 'undefined' && !!window.matchMedia?.(QUERY).matches

export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(coarsePointer)
  useEffect(() => {
    const mq = window.matchMedia?.(QUERY)
    if (!mq) return
    const on = () => setCoarse(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  return coarse
}

/** prefers-reduced-motion: reduce, read now (the lamp test and the blink check it before adding any motion). */
export const reducedMotion = (): boolean => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
