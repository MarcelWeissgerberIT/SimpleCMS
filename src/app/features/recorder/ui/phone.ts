/** The deck's phone layout (≤ 767 px): the deck, the read sheet and its second sheet. */
import { useEffect, useState } from 'react'

export const PHONE_QUERY = '(max-width: 767px)'

export function usePhone(): boolean {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(PHONE_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(PHONE_QUERY)
    if (!mq) return
    const fn = () => setOn(mq.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  return on
}
