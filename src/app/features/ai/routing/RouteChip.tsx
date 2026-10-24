import { DataFlowNotice } from '../data-flow/DataFlowNotice'
import { sharedProgress } from '../core/sharedModels'
import { SHARED_PREFIX } from '@/shared/ai/shared-model'
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
import { PROVIDER_ORDER, PROVIDERS, isWorkerProvider } from '@/shared/ai/providers'
import { isJevRouter } from '@/shared/ai/jev'
import { routeChoices, routeFor } from '../core/gate'
import { shortFor } from '../core/registry'
import type { Need, PurposeId } from '../core/purposes'
import { RoutePicker, whyText } from './RoutePicker'
import { isRouteKey, PLATE } from './keys'
import { useWorkerModels, workerProviderReady } from '../core/workerModels'
import { Popover } from '../../../ui/Popover'
import { openAISettings, openAISetup } from '../setup/openAISetup'
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
  text?: string
  reads: string
  disabled?: boolean
  /** after the picker closed (the caller gives its field the keyboard back) */
  onClosed?: () => void
  handle?: Ref<RouteChipHandle>
  testId?: string
}

export function RouteChip({ purpose, chip, onChip, sources, carries, needs, reads, text, disabled, onClosed, handle, testId = 'route-chip' }: RouteChipProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [providersOpen, setProvidersOpen] = useState(false)
  const providerBtn = useRef<HTMLButtonElement | null>(null)
  const modelsRevision = useWorkerModels()
  const [provider, setProvider] = useState<ProviderId | undefined>()
  const btn = useRef<HTMLButtonElement | null>(null)
  // the rules, keys and the shortlist: the chip shows what they choose now
  const settings = useWorkspace((s) => s.settings)
  const wsAI = useWorkspace((s) => s.ai)
  const choices = useMemo(() => routeChoices(purpose, { sources, carries, needs }), [purpose, sources, carries, needs, settings, wsAI, modelsRevision])
  const openModels = () => { setProvidersOpen(false); setProvider(undefined); setOpen(true) }
  useImperativeHandle(handle, () => ({ open: () => !disabled && openModels() }), [disabled])
  const r = routeFor(purpose, { route: chip })
  const chosen = !!chip || !!choices.now
  const short = isJevRouter(r.route.m) ? 'JEV ROUTER' : shortFor(r.route, r.pool)
  const close = () => {
    setOpen(false)
    onClosed?.()
  }
  return (
    <span className="route-controls" data-testid={`${testId}-controls`}>
      <button type="button" ref={providerBtn} className="ai-model route-provider" aria-label={t('features.ai.prov.chip.provider')} data-testid={`${testId}-provider`}
        data-provider={r.route.p} aria-haspopup="dialog" aria-expanded={providersOpen} disabled={disabled}
        onMouseDown={e => e.preventDefault()} onClick={() => { setOpen(false); setProvidersOpen(v => !v) }}>
        <span>{chosen ? PROVIDERS[r.route.p].name : t('features.ai.prov.chip.chooseProvider')}</span><span aria-hidden>▾</span>
      </button>
      {providersOpen && <Popover open anchor={providerBtn.current} onClose={() => setProvidersOpen(false)} className="route-pop route-providers" role="dialog" aria-label={t('features.ai.prov.chip.provider')}>
        <div className="label route-providers__title">{t('features.ai.prov.chip.provider')}</div>
        <div onKeyDown={e => {
          e.stopPropagation()
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
          e.preventDefault()
          const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-provider]')]
          const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
          buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
        }}>
        {PROVIDER_ORDER.filter(p => PROVIDERS[p].shipped).map(p => {
          const rows = choices.rows.filter(row => row.route.p === p)
          const candidate = rows.find(row => row.ok)
          const ready = isWorkerProvider(p) ? workerProviderReady(p) : hasAIKey(p)
          const reason = isWorkerProvider(p) && !ready ? t('features.ai.prov.chip.workerUnavailable') : !ready ? whyText(t, { code: 'no_key' }) : rows[0]?.why ? whyText(t, rows[0].why) : t('features.ai.prov.chip.noModels')
          return <div key={p} className="route-providers__row">
            <button type="button" data-provider={p} data-available={!!candidate} aria-pressed={chosen && r.route.p === p} aria-disabled={!candidate} onClick={() => {
              if (!candidate) return
              onChip(candidate.route); setProvider(p); setProvidersOpen(false); setOpen(true)
            }}><strong>{PROVIDERS[p].name}</strong><span>{candidate ? t(`features.ai.prov.chip.modelCount.${rows.filter(row => row.ok).length === 1 ? 'one' : 'other'}`, { n: rows.filter(row => row.ok).length }) : reason}</span></button>
            {!candidate && <button type="button" className="btn btn--ghost" aria-label={t('features.ai.prov.chip.configureProvider', { provider: PROVIDERS[p].name })} onClick={() => {
              setProvidersOpen(false)
              if (isWorkerProvider(p)) openAISettings()
              else openAISetup({ provider: p, reason: !ready ? 'add' : 'policy', step: !ready ? 'key' : 'data' })
            }}>{t('features.ai.prov.chip.configure')}</button>}
          </div>
        })}
        </div>
      </Popover>}
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
        <span className="route-chip__model">{chosen ? short : t('features.ai.prov.chip.chooseModel')}</span>
        <span className="route-chip__caret" aria-hidden>
          ▾
        </span>
      </button>
      {chosen && <DataFlowNotice provider={r.route.p} model={r.route.m} sources={sources} text={text} />}
      {chosen && r.route.p === 'local' && r.route.m.startsWith(SHARED_PREFIX) && sharedProgress() && <span role="status" aria-live="polite" className="route-chip__queue">{t(sharedProgress()!.state === 'queued' ? 'features.ai.prov.share.waiting' : 'features.ai.prov.share.running', {n:sharedProgress()!.position})}</span>}
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
