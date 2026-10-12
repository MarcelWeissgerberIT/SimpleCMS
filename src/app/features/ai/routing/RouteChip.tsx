/**
 * The route chip (§ 12.5): which model this request goes to — `[CL] SONNET 5.5 ▾` — in the AI menu's command line,
 * ⌘K "?" and the help's Ask. A click or Alt+M (`isRouteKey`) opens the route picker; a pick applies to this request
 * only (the caller keeps it, a retry reuses it); "make default" lines write this device's rules. No chip picked: the
 * rules decide (the chip shows what they choose).
 */
import { useImperativeHandle, useRef, useState, type Ref } from 'react'
import { useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import type { DataClass, Route, SourceRef } from '@/shared/ai/types'
import { isJevRouter } from '@/shared/ai/jev'
import { routeFor } from '../core/gate'
import { shortFor } from '../core/registry'
import type { Need, PurposeId } from '../core/purposes'
import { RoutePicker } from './RoutePicker'
import { isRouteKey, PLATE } from './keys'
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
  const btn = useRef<HTMLButtonElement | null>(null)
  // the rules, keys and the shortlist: the chip shows what they choose now
  useWorkspace((s) => s.settings.ai)
  useWorkspace((s) => s.ai)
  useWorkspace((s) => s.settings.aiModel)
  useWorkspace((s) => s.settings.aiApiKey)
  useWorkspace((s) => s.settings.aiKeys)
  useImperativeHandle(handle, () => ({ open: () => !disabled && setOpen(true) }), [disabled])
  const r = routeFor(purpose, { route: chip })
  const short = isJevRouter(r.route.m) ? 'JEV ROUTER' : shortFor(r.route, r.pool)
  const close = () => {
    setOpen(false)
    onClosed?.()
  }
  return (
    <>
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
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="route-chip__plate" aria-hidden>
          {PLATE[r.route.p]}
        </span>
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
    </>
  )
}
