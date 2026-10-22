import { useWorkspace } from '../../../store/store'
import { useWorkerModels } from '../core/workerModels'
/**
 * The route picker (§ 12.5): a cmdk list in a popover (a sheet on phones) under the route chip. Rows: the route this
 * device's rules choose now ("Default on this device"), the kind of work's rule, the models with a key here (Claude,
 * the OpenRouter shortlist), the ROUTER group (the Jev Router's three tiers, once ≥ 2 shortlist models fit) — rows that
 * do not fit this request dimmed with one reason. ↵ / click = this request only; the lines under the list (Tab) make the
 * highlighted model this device's default for this kind of work, or for everything. The lead line names where the
 * request goes ("Reads: the selection · goes to Anthropic"); the router's adds "Jev (TypeSafe) picks" and a "Why?".
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Command } from 'cmdk'
import { useLang, useT } from '../../../i18n'
import { useUI } from '../../../store/ui'
import { Popover } from '../../../ui/Popover'
import { setDeviceDefault, setDeviceRule } from '../../../store/aiRules'
import type { DataClass, FeatureClass, ProviderId, Route, SourceRef } from '@/shared/ai/types'
import { routeKey } from '@/shared/ai/route'
import { isJevRouter } from '@/shared/ai/jev'
import { PROVIDER_ORDER, PROVIDERS } from '@/shared/ai/providers'
import { routeChoices, type ChoiceWhy, type RouteChoice } from '../core/gate'
import type { Need, PurposeId } from '../core/purposes'
import { PLATE } from './keys'
import { classLabel } from './classLabel'

type T = ReturnType<typeof useT>

const COMPANY: Record<Route['p'], string> = { anthropic: 'Anthropic', openai: 'OpenAI', openrouter: 'OpenRouter', local: 'Ollama (worker)', ollama: 'Ollama Cloud', minimax: 'MiniMax', codex: 'Codex', copilot: 'GitHub Copilot' }

/** A kind of work as people read it ("Writing" · "Schreiben"). */
export { classLabel } from './classLabel'

/** The one reason a route does not fit this request. */
export function whyText(t: T, w: ChoiceWhy | undefined): string {
  if (!w) return ''
  switch (w.code) {
    case 'no_key':
      return t('features.ai.prov.chip.why.nokey')
    case 'capability':
      if (w.detail === 'vision') return t('features.ai.prov.chip.why.vision')
      if (w.detail === 'pdf') return t('features.ai.prov.chip.why.pdf')
      if (w.detail === 'mcp' || w.detail === 'listing') return t('features.ai.prov.chip.why.mcp')
      if (w.detail === 'structured') return t('features.ai.prov.chip.why.json')
      if (w.detail === 'tools') return t('features.ai.prov.chip.why.tools')
      if (w.detail === 'pool') return t('features.ai.jev.router.needs2')
      return t('features.ai.prov.chip.why.other')
    case 'policy':
      return t('features.ai.prov.chip.why.rule', { class: w.detail ? t(`features.ai.cls.${w.detail}`) : '—' })
    case 'model_gone':
      return t('features.ai.prov.chip.why.gone')
    case 'later':
      return t('features.ai.prov.chip.why.later')
    case 'typesafe':
      return t('features.ai.prov.chip.why.typesafe')
    case 'needs2':
      return t('features.ai.jev.router.needs2')
    default:
      return t('features.ai.prov.chip.why.other')
  }
}

const phone = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 600px)').matches

export interface RoutePickerProps {
  anchor: Element | null
  purpose: PurposeId
  chip: Route | null
  /** Provider chosen in the separate control; ordinary model search starts across providers. */
  provider?: ProviderId
  sources?: readonly SourceRef[]
  carries?: readonly DataClass[]
  needs?: readonly Need[]
  reads: string
  /** a row picked: this request only (null: the rules decide) */
  onPick: (route: Route | null) => void
  onClose: () => void
}

export function RoutePicker({ anchor, purpose, chip, provider: initialProvider, sources, carries, needs, reads, onPick, onClose }: RoutePickerProps) {
  const t = useT()
  const lang = useLang()
  const modelRevision = useWorkerModels()
  const settings = useWorkspace(s => s.settings)
  const policy = useWorkspace(s => s.ai)
  const choices = useMemo(() => routeChoices(purpose, { sources, carries, needs }), [purpose, sources, carries, needs, modelRevision, settings, policy])
  const picked = chip ? `${routeKey(chip)}${chip.effort ? `#${chip.effort}` : ''}` : ''
  // the highlighted row starts on the pick (the lead line names where it goes)
  const [active, setActive] = useState(picked)
  const [why, setWhy] = useState(false)
  const [provider, setProvider] = useState<ProviderId | ''>(initialProvider ?? '')
  const [search, setSearch] = useState('')
  const [sheet] = useState(phone)
  const root = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  // Esc closes the picker only (never the AI menu or the palette under it): taken before their own listeners
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      closeRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  // the sheet takes the keyboard at once (the popover focuses its field itself)
  useEffect(() => {
    if (sheet) root.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
  }, [sheet])

  const rows = useMemo(() => choices.rows.filter(r => !provider || r.route.p === provider), [choices, provider])
  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows])
  const current = byKey.get(active) ?? rows.find((r) => r.key === picked) ?? rows[0]
  const leadRoute = current?.route ?? choices.now
  const router = !!leadRoute && leadRoute.p === 'openrouter' && isJevRouter(leadRoute.m)
  const target = current && current.ok && current.group !== 'now' ? current : null
  const cls = classLabel(t, choices.cls)

  const now = rows.filter((r) => r.group === 'now')
  const rule = rows.filter((r) => r.group === 'rule')
  const models = [...rows.filter((r) => r.group === 'models' && r.ok), ...rows.filter((r) => r.group === 'models' && !r.ok)]
  const routerRows = rows.filter((r) => r.group === 'router')
  // every tier refused for the same reason: one dimmed row says why
  const routerOne = routerRows.length > 0 && routerRows.every((r) => !r.ok && r.why?.code === routerRows[0]!.why?.code) ? routerRows[0]! : null

  const makeDefault = (all: boolean) => {
    if (!target) return
    const ok = all ? setDeviceDefault([target.route]) : setDeviceRule(choices.cls, [target.route])
    if (!ok) return
    useUI.getState().toast({ message: all ? t('features.ai.prov.chip.madeAll', { model: target.label }) : t('features.ai.prov.chip.made', { model: target.label, class: cls }), kind: 'success' })
    // the default now is this model: no chip needed
    onPick(null)
  }

  const item = (r: RouteChoice, o: { label?: string; sub?: string } = {}) => (
    <Command.Item
      key={r.key}
      value={r.key}
      keywords={[r.label, r.short]}
      disabled={!r.ok}
      className="route-row"
      data-route={r.key}
      data-group={r.group}
      data-ok={r.ok ? '' : undefined}
      data-picked={r.key === picked || (!picked && r.group === 'now') ? '' : undefined}
      onSelect={() => r.ok && onPick(r.group === 'now' ? null : r.route)}
    >
      <span className="route-row__plate" aria-hidden>
        {PLATE[r.route.p]}
      </span>
      <span className="route-row__text">
        <span className="route-row__label">{o.label ?? r.label}</span>
        {(o.sub ?? (!r.ok ? whyText(t, r.why) : '')) && <span className="route-row__sub">{o.sub ?? whyText(t, r.why)}</span>}
      </span>
      {(r.key === picked || (!picked && r.group === 'now')) && <span className="route-row__picked label">{t('features.ai.prov.chip.picked')}</span>}
    </Command.Item>
  )

  const routerSub = (r: RouteChoice): string => {
    if (!r.ok) return whyText(t, r.why)
    const n = (v: number | undefined) => (v ?? 0).toLocaleString(lang, { maximumFractionDigits: 2 })
    return [t('features.ai.jev.router.lead'), t('features.ai.jev.router.pool', { n: r.pool?.length ?? 0 }), t('features.ai.jev.router.price'), t('features.ai.jev.router.bound', { in: n(r.price?.input), out: n(r.price?.output) })].join(' · ')
  }

  const body = (
    <div ref={root} className="route-picker" data-sheet={sheet ? '' : undefined}>
      <label className="route-picker__provider">
        <span className="label">{t('features.ai.prov.chip.providerModels')}</span>
        <select className="input" value={provider} onChange={e => { setProvider(e.target.value as ProviderId | ''); setActive(''); setSearch('') }}>
          <option value="">{t('features.ai.prov.chip.allProviders')}</option>
          {PROVIDER_ORDER.filter(p => PROVIDERS[p].shipped).map(p => <option key={p} value={p}>{PROVIDERS[p].name}</option>)}
        </select>
      </label>
      <p className="route-picker__lead" data-testid="route-lead">
        {router ? t('features.ai.prov.chip.leadRouter', { reads }) : t('features.ai.prov.chip.lead', { reads, company: leadRoute ? COMPANY[leadRoute.p] : '—' })}
        {router && (
          <button type="button" className="route-picker__why" aria-expanded={why} onClick={() => setWhy((v) => !v)}>
            {t('features.ai.prov.chip.why')}
          </button>
        )}
      </p>
      {router && why && (
        <p className="route-picker__privacy" role="note">
          {PROVIDERS.openrouter.routerPrivacy[lang]}
        </p>
      )}
      <Command label={t('features.ai.prov.chip.title')} value={active} onValueChange={setActive} loop className="route-picker__cmd">
        <Command.Input className="route-picker__input" placeholder={t('features.ai.prov.chip.filter')} value={search} onValueChange={setSearch} data-autofocus="" />
        <Command.List className="route-picker__list">
          <Command.Empty className="route-picker__lead">{t('features.ai.prov.chip.noModels')}</Command.Empty>
          {now.length > 0 && <Command.Group>{now.map((r) => item(r, { label: t('features.ai.prov.chip.now'), sub: r.label }))}</Command.Group>}
          {rule.length > 0 && <Command.Group heading={t('features.ai.prov.chip.group.rule', { class: cls })}>{rule.map((r) => item(r))}</Command.Group>}
          {models.length > 0 && <Command.Group heading={t('features.ai.prov.chip.group.models')}>{models.map((r) => item(r))}</Command.Group>}
          {choices.router && routerRows.length > 0 && (
            <Command.Group heading={t('features.ai.prov.chip.group.router')}>
              {routerOne
                ? item(routerOne, { label: 'Jev Router', sub: whyText(t, routerOne.why) })
                : routerRows.map((r) => item(r, { label: t('features.ai.jev.router.row', { tier: t(`features.ai.jev.router.tier.${r.route.effort ?? 'medium'}`) }), sub: routerSub(r) }))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
      <div className="route-picker__foot">
        <button type="button" className="route-picker__make" disabled={!target} onClick={() => makeDefault(false)} data-testid="route-make-default">
          {t('features.ai.prov.chip.default', { class: cls })}
        </button>
        <button type="button" className="route-picker__make" disabled={!target} onClick={() => makeDefault(true)} data-testid="route-make-all">
          {t('features.ai.prov.chip.everything')}
        </button>
      </div>
    </div>
  )

  if (sheet)
    return createPortal(
      <div className="route-sheet" data-popover="">
        <button type="button" className="route-sheet__scrim" aria-label={t('common.close')} tabIndex={-1} onClick={onClose} />
        <div className="route-sheet__panel" role="dialog" aria-modal="true" aria-label={t('features.ai.prov.chip.title')}>
          {body}
        </div>
      </div>,
      document.body,
    )
  return (
    <Popover open anchor={anchor} onClose={onClose} placement="bottom-end" offset={6} className="route-pop" role="dialog" aria-label={t('features.ai.prov.chip.title')}>
      {body}
    </Popover>
  )
}
