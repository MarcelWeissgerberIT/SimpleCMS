/** Two-step, colour-specific acknowledgement. A changed signal closes its cover again. */
import { useId, useRef, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { useT } from '../../../i18n'
import { ackLamps } from '../engine'
import { usePreflight } from '../state'
import type { LampView } from '../types'

function fingerprint(views: readonly LampView[], level: 'amber' | 'red'): string {
  return JSON.stringify(views.filter((v) => v.level === level && v.isNew).map((v) => [v.id, v.idsHash, v.count]))
}

function GuardedMaster({ level }: { level: 'amber' | 'red' }) {
  const t = useT()
  const id = useId()
  const lid = useRef<HTMLButtonElement>(null)
  const views = usePreflight((s) => s.views)
  const key = fingerprint(views, level)
  const [cover, setCover] = useState({ key, open: false })
  if (cover.key !== key) setCover({ key, open: false })
  const open = cover.key === key && cover.open
  const lit = views.filter((v) => v.level === level)
  const fresh = lit.filter((v) => v.isNew)
  const name = t(level === 'red' ? 'features.preflight.guard.warning' : 'features.preflight.mc.name')
  const acknowledge = () => {
    // Check the current store too: a signal arriving between render and click must be inspected afresh.
    const current = usePreflight.getState().views
    if (!open || fingerprint(current, level) !== cover.key) return
    lid.current?.focus()
    setCover({ key, open: false })
    ackLamps(current.filter((v) => v.level === level && v.isNew).map((v) => v.id), 'mc')
  }
  return (
    <div className="pf-guard" data-level={level} data-state={fresh.length ? 'new' : lit.length ? 'acked' : 'dark'} data-open={open || undefined}>
      <div className="pf-guard__socket">
        <button ref={lid} type="button" className="pf-guard__glass" data-testid={`pf-cover-${level}`} aria-controls={id} aria-expanded={open}
          aria-label={t(open ? 'features.preflight.guard.close' : 'features.preflight.guard.open', { name })} onClick={() => setCover({ key, open: !open })}>
          <span className="pf-guard__hinge" aria-hidden />
          <span className="pf-guard__tab" aria-hidden />
        </button>
        <button type="button" id={id} className="pf-guard__push" data-testid={level === 'red' ? 'pf-warning' : 'pf-mkey'} disabled={!open || !fresh.length}
          aria-label={t('features.preflight.guard.ack', { name, n: fresh.length })} onClick={acknowledge}>
          {level === 'red' && <TriangleAlert size={13} aria-hidden />}
          <span>{name.replace(' ', '\n')}</span>
        </button>
      </div>
      <div className="pf-guard__count" aria-hidden="true">
        <b>{fresh.length || lit.length || '—'}</b>
        <span>{t(fresh.length ? 'features.preflight.guard.new' : 'features.preflight.guard.lit')}</span>
      </div>
      <span className="pf-guard__hint">{t(open ? 'features.preflight.guard.press' : 'features.preflight.guard.lift')}</span>
    </div>
  )
}

export function GuardedMasters() {
  const t = useT()
  return <div className="pf-guards">
    <GuardedMaster level="amber" />
    <GuardedMaster level="red" />
    <p className="pf-guards__note">{t('features.preflight.guard.note')}</p>
  </div>
}
