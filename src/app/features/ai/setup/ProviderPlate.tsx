/**
 * A provider's rating plate (UX § 4.2): metal head strip with two screws, the code plate (CL · OA · OR — a provider is
 * told by letters, never by colour), its state (LED + word, the key's last 4), one plain sentence, the spec rows
 * (billing · price · models · MCP · images / PDF · data · access) and a foot with its keys. The setup's step 01 shows
 * all of it; Settings › AI the compact plate (state, marker, keys). Phones: the one line + price / MCP / data, "All
 * details" opens the rest.
 */
import { useId, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ProviderId } from '@/shared/ai/types'
import { providerInfo } from '@/shared/ai/providers'
import { useWorkspace } from '../../../store/store'
import { Screws, Switch } from '../../../ui/controls'
import { useLang, useT } from '../../../i18n'
import { keyedState, keyHint, modelsLine, NO_ROWS, perM, priceRange, type PlateState } from './facts'
import './plates.css'

export function CodePlate({ p, size = 'md' }: { p: ProviderId; size?: 'md' | 'lg' }) {
  return (
    <span className={size === 'lg' ? 'pcode pcode--lg' : 'pcode'} aria-hidden>
      {providerInfo(p).code}
    </span>
  )
}

export interface ProviderPlateProps {
  p: ProviderId
  state: PlateState
  /** step 01: the switch "Set up <P>" (absent: no switch) */
  onPick?: (on: boolean) => void
  compact?: boolean
  /** the foot's keys (Change key · Remove … / Check key) */
  keys?: ReactNode
  /** the foot's text when there are no keys */
  footNote?: string
  /** a line under the state row (no credit / refused / the Jev line) */
  children?: ReactNode
  testId?: string
}

export function ProviderPlate({ p, state, onPick, compact, keys, footNote, children, testId }: ProviderPlateProps) {
  const t = useT()
  const lang = useLang()
  const info = providerInfo(p)
  const hint = useWorkspace((s) => keyHint(s.settings, p))
  const list = useWorkspace((s) => s.settings.ai?.models ?? NO_ROWS)
  const [more, setMore] = useState(false)
  const moreId = useId()
  const range = priceRange(p, list)
  const price =
    p === 'openrouter'
      ? range
        ? t('features.ai.prov.price.from', { min: perM(range.min, lang) })
        : t('features.ai.prov.price.perModel')
      : range
        ? t('features.ai.prov.price.range', { min: perM(range.min, lang), max: perM(range.max, lang) })
        : '—'
  const yes = (v: string) => <span className="pplate__yes">{v}</span>
  const no = (v: string) => <span className="pplate__no">— {v}</span>
  const rows: Array<{ k: string; v: ReactNode; x?: boolean }> = [
    { k: t('features.ai.prov.spec.billing'), v: p === 'openrouter' ? t('features.ai.prov.billing.credits') : t('features.ai.prov.billing.payg', { company: info.company }), x: true },
    { k: t('features.ai.prov.spec.price'), v: price },
    { k: t('features.ai.prov.spec.models'), v: p === 'openrouter' ? t('features.ai.prov.models.openrouter') : modelsLine(p), x: true },
    {
      k: t('features.ai.prov.spec.mcp'),
      v: p === 'anthropic' ? yes(t('features.ai.prov.mcp.yes', { company: info.company })) : p === 'openai' ? no(t('features.ai.prov.mcp.notYet')) : no(t('features.ai.prov.mcp.no')),
    },
    { k: t('features.ai.prov.spec.media'), v: t(`features.ai.prov.media.${p}`, { pages: 600 }), x: true },
    { k: t('features.ai.prov.spec.data'), v: t(`features.ai.prov.dataLine.${p}`) },
    { k: t('features.ai.prov.spec.access'), v: p === 'openrouter' ? t('features.ai.prov.access.connect') : t('features.ai.prov.access.paste'), x: true },
  ]
  const led = state === 'ready' ? 'led led--ok' : state === 'picked' || state === 'empty' ? 'led led--on' : 'led'
  const stateWord =
    state === 'ready'
      ? t('features.ai.prov.state.ready')
      : state === 'empty'
        ? t('features.ai.prov.state.empty')
        : state === 'picked'
        ? t('features.ai.prov.state.picked')
        : state === 'refused'
          ? t('features.ai.prov.state.refused')
          : state === 'no_credit'
            ? t('features.ai.prov.state.noCredit')
            : state === 'soon'
              ? t('features.ai.prov.state.soon')
              : t('features.ai.prov.state.none')
  return (
    <article className="pplate" data-provider={p} data-state={state} data-picked={state === 'picked' || undefined} data-compact={compact || undefined} data-testid={testId ?? `plate-${p}`} aria-label={info.name}>
      <div className="pplate__head">
        <Screws seed={`plate-${p}`} count={2} />
        <CodePlate p={p} size="lg" />
        <span className="pplate__name">
          <b>{info.name}</b>
          <span className="label">{info.sub[lang === 'de' ? 'de' : 'en']}</span>
        </span>
        {onPick && !keyedState(state) && (
          <Switch seed={p} size="sm" checked={state === 'picked'} disabled={state === 'soon'} onChange={onPick} label={t('features.ai.prov.pick', { p: info.name })} />
        )}
      </div>
      <div className="pplate__state">
        {state === 'refused' || state === 'no_credit' ? (
          <span className="lampcap" data-tone={state === 'refused' ? 'red' : 'amber'} aria-hidden>
            {state === 'refused' ? '401' : '402'}
          </span>
        ) : (
          <span className={led} aria-hidden />
        )}
        <span className="label pplate__word">{stateWord}</span>
        <span className="pplate__sp" />
        {state === 'picked' && <span className="tag pplate__tag">{t('features.ai.prov.tag.picked')}</span>}
        {keyedState(state) && hint && <span className="label pplate__marker">{t('features.ai.prov.keyMarker', { last4: hint })}</span>}
      </div>
      {!compact && <p className="pplate__why">{t(`features.ai.prov.why.${p}`)}</p>}
      {children}
      {!compact && (
        <>
          <dl className="pplate__spec" id={moreId} data-more={more || undefined}>
            {rows.map((r) => (
              <div key={r.k} className="pplate__row" data-x={r.x || undefined}>
                <dt>{r.k}</dt>
                <dd>{r.v}</dd>
              </div>
            ))}
          </dl>
          <button type="button" className="pplate__more" aria-expanded={more} aria-controls={moreId} onClick={() => setMore((v) => !v)}>
            {t('features.ai.prov.plate.more')} <ChevronDown size={12} aria-hidden />
          </button>
        </>
      )}
      {(keys || footNote) && <div className="pplate__foot">{keys ?? <span className="label">{footNote}</span>}</div>}
    </article>
  )
}
