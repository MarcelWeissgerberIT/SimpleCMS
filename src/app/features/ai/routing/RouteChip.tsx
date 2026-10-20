/**
 * Provider + model controls (§ 12.5) in the AI menu's command line,
 * ⌘K "?" and the help's Ask. A click or Alt+M (`isRouteKey`) opens the route picker; a pick applies to this request
 * only (the caller keeps it, a retry reuses it); "make default" lines write this device's rules. No chip picked: the
 * rules decide (the chip shows what they choose). A provider pick selects its first usable route, then opens
 * its model list. Ordinary model search still spans providers; neither pick writes a default or sends a request.
 */
import { useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react'
import { useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { hasAIKey } from '../../../store/secrets'
import type { DataClass, ProviderId, Route, SourceRef } from '@/shared/ai/types'
import { PROVIDER_ORDER, PROVIDERS } from '@/shared/ai/providers'
import { isJevRouter } from '@/shared/ai/jev'
import { routeChoices, routeFor } from '../core/gate'
import { shortFor } from '../core/registry'
import type { Need, PurposeId } from '../core/purposes'
import { RoutePicker, whyText } from './RoutePicker'
import { isRouteKey } from './keys'
import './routing.css'

export { isRouteKey, PLATE }

export interface RouteChipHandle {
  open(): void
}

export interface RouteChipProps {
  purpose: PurposeId
  /** the pick for this request (null: the rules decide) */
  chip: Route | null
  onChip: (route: Route | null) => void
  /** what the request reads (the picker checks the data rule against it) */
  sources?: readonly SourceRef[]
  carries?: readonly DataClass[]
  needs?: readonly Need[]
  /** the lead line's "Reads: …" */
  reads: string
  disabled?: boolean
  /** after the picker closed (the caller gives its field the keyboard back) */
  onClosed?: () => void
  handle?: Ref<RouteChipHandle>
  testId?: string
}

export function RouteChip({ purpose, chip, onChip, sources, carries, needs, reads, disabled, onClosed, handle, testId = 'route-chip' }: RouteChipProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [provider, setProvider] = useState<ProviderId | undefined>()
  const btn = useRef<HTMLButtonElement | null>(null)
  // the rules, keys and the shortlist: the chip shows what they choose now
  const settings = useWorkspace((s) => s.settings)
  const wsAI = useWorkspace((s) => s.ai)
  const choices = useMemo(() => routeChoices(purpose, { sources, carries, needs }), [purpose, sources, carries, needs, settings, wsAI])
  const openModels = () => { setProvider(undefined); setOpen(true) }
  useImperativeHandle(handle, () => ({ open: () => !disabled && openModels() }), [disabled])
  const r = routeFor(purpose, { route: chip })
  const short = isJevRouter(r.route.m) ? 'JEV ROUTER' : shortFor(r.route, r.pool)
  const close = () => {
    setOpen(false)
    onClosed?.()
  }
  return (
    <span className="route-controls" data-testid={`${testId}-controls`}>
      <select
        className="ai-model route-provider"
        aria-label={t('features.ai.prov.chip.provider')}
        data-testid={`${testId}-provider`}
        value={r.route.p}
        disabled={disabled}
        onKeyDown={e => e.stopPropagation()}
        onChange={e => {
          const p = e.target.value as ProviderId
          const candidate = choices.rows.find(row => row.route.p === p && row.ok)
          if (!candidate) return
          onChip(candidate.route)
          setProvider(p)
          setOpen(true)
        }}
      >
        {PROVIDER_ORDER.filter(p => PROVIDERS[p].shipped).map(p => {
          const rows = choices.rows.filter(row => row.route.p === p)
          const available = rows.some(row => row.ok)
          const reason = !hasAIKey(p) ? whyText(t, { code: 'no_key' }) : rows[0]?.why ? whyText(t, rows[0].why) : t('features.ai.prov.chip.noModels')
          return <option key={p} value={p} disabled={!available}>{PROVIDERS[p].name}{!available ? ` · ${reason}` : ''}</option>
        })}
      </select>
      <button
        ref={btn}
        type="button"
        className="ai-model route-chip"
        data-testid={testId}
        data-picked={chip ? '' : undefined}
        data-provider={r.route.p}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('features.ai.prov.chip.aria', { model: r.label })}
        title={`${t('features.ai.prov.chip.title')} · Alt+M`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? close() : openModels())}
      >
        <span className="route-chip__model">{short}</span>
        <span className="route-chip__caret" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <RoutePicker
          anchor={btn.current}
          purpose={purpose}
          chip={chip}
          provider={provider}
          sources={sources}
          carries={carries}
          needs={needs}
          reads={reads}
          onPick={(route) => {
            onChip(route)
            close()
          }}
          onClose={close}
        />
      )}
    </span>
  )
}
