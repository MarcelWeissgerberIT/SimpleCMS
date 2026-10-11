/**
 * MASTER CAUTION — the topbar key (every route) and the plate's own keys. Lit with the number of new lamps; a click
 * acknowledges every new lamp (there is no keyboard shortcut for "acknowledge all" — a key press on the focused button
 * is a click). Nothing new: the off window — with the number of lit lamps in ink-3, or a green LED when all is dark —
 * and a click opens the panel. On a phone the topbar key shows the triangle and the count; the name is its label.
 */
import { memo } from 'react'
import { TriangleAlert } from 'lucide-react'
import { useT } from '../../../i18n'
import { ackAll, noteRender } from '../engine'
import { openPreflight } from '../hooks'
import { usePreflight } from '../state'
import { tn } from '../sources/util'

type McState = 'lit' | 'acked' | 'dark'

function useMc(): { state: McState; mc: number; lit: number } {
  const mc = usePreflight((s) => s.mc)
  const lit = usePreflight((s) => s.lit)
  return { state: mc > 0 ? 'lit' : lit > 0 ? 'acked' : 'dark', mc, lit }
}

/** The click: acknowledge every new lamp; with nothing new, open the panel. */
export function pressMasterCaution(): void {
  if (usePreflight.getState().mc > 0) ackAll()
  else openPreflight()
}

/** memo: the topbar re-renders with its page (typing, saving); the key only with `mc` / `lit` (PB5) */
export const MasterCautionKey = memo(function MasterCautionKey() {
  noteRender('mc')
  const t = useT()
  const on = usePreflight((s) => s.on)
  const ready = usePreflight((s) => s.ready)
  const { state, mc, lit } = useMc()
  if (!on || !ready) return null
  const name = t('features.preflight.mc.name')
  const label = state === 'lit' ? tn('features.preflight.mc.aria', mc) : state === 'acked' ? tn('features.preflight.mc.ariaLit', lit) : t('features.preflight.mc.ariaOff')
  return (
    <button type="button" className="pf-mc" data-state={state} data-testid="pf-mc" title={name.toUpperCase()} aria-label={label} onClick={pressMasterCaution}>
      <span className="pf-mc__win">
        <span className="pf-mc__name">{name}</span>
        <TriangleAlert className="pf-mc__icon" size={14} strokeWidth={2} aria-hidden />
      </span>
      {state === 'dark' ? <span className="led led--ok" aria-hidden /> : <span className="pf-mc__n">{state === 'lit' ? mc : lit}</span>}
    </button>
  )
})

/** The plate's key (the master column) — `small` for the strip. */
export function MasterKey({ small }: { small?: boolean }) {
  const t = useT()
  const { state, mc, lit } = useMc()
  const name = t('features.preflight.mc.name')
  const label = state === 'lit' ? tn('features.preflight.mc.ariaPlate', mc) : state === 'acked' ? tn('features.preflight.mc.ariaLit', lit) : t('features.preflight.mc.ariaStrip')
  return (
    <button type="button" className={small ? 'pf-mkey pf-mkey--s' : 'pf-mkey'} data-state={state === 'lit' ? undefined : state} data-testid={small ? 'pf-mkey-strip' : 'pf-mkey'} aria-label={label} onClick={pressMasterCaution}>
      <span className="pf-mkey__win">{small ? name : name.replace(' ', '\n')}</span>
      <span className="pf-mkey__side">
        {state === 'dark' ? <span className="led led--ok pf-mkey__led" aria-hidden /> : <span className="pf-mkey__n">{state === 'lit' ? mc : lit}</span>}
        <span className="label">{state === 'lit' ? tn('features.preflight.mc.flashing', mc) : state === 'acked' ? t('features.preflight.mc.lit') : t('features.preflight.mc.dark')}</span>
      </span>
    </button>
  )
}
