/**
 * A VON HAND key of the work orders' plate (B6, shared by the chain's card — B7): acts only on a fresh press ≥ 300 ms
 * after it became ready; `aria-disabled` with its reason (never `disabled`); a held key never presses it.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useT } from '../../../i18n'

export function HandKey({ ready, reason, onPress, children, primary, testId, describedBy }: { ready: boolean; reason?: string; onPress: () => void; children: ReactNode; primary?: boolean; testId: string; describedBy?: string }) {
  const t = useT()
  const readyAt = useRef(0)
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!ready) {
      setArmed(false)
      return
    }
    readyAt.current = Date.now()
    const id = window.setTimeout(() => setArmed(true), 300)
    return () => window.clearTimeout(id)
  }, [ready])
  const live = ready && armed
  const why = !ready ? reason : !armed ? t('features.coding.order.key.readying') : undefined
  return (
    <button
      type="button"
      className={`btn btn--sm${primary ? ' btn--primary' : ''}`}
      aria-disabled={!live || undefined}
      aria-describedby={describedBy}
      title={why}
      data-testid={testId}
      data-ready={live ? '' : undefined}
      onKeyDown={(e) => {
        // a held key never presses it (a repeat began before it was ready)
        if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault()
      }}
      onClick={() => {
        if (!live || Date.now() - readyAt.current < 300) return
        onPress()
      }}
    >
      {children}
    </button>
  )
}
