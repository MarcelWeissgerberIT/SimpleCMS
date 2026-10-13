/**
 * 01 CONSUMERS · TODAY (Regler § 10.1): one row per source of today's spend on this device — the AI terminal, the AI
 * menu & Transform, each agent, autofill per database, mail, the Outbox, scripts, ⌘K, help … — with its count, the model
 * it used most ("+2" when more answered), its share of the day budget (of today's total without one), the amount and
 * what it may do by itself. An agent the governor held today is listed even without spend ("HELD · 3 × not started",
 * the lock). The sum row closes it. At phone width the rows are cards.
 */
import { Lock } from 'lucide-react'
import { labelOf } from '@/shared/ai/models'
import type { ProviderId } from '@/shared/ai/types'
import { useLang, useT } from '../../../i18n'
import { fmtUsd } from '../../../lib/money'
import { servedLabel } from '../../ai/core/registry'
import type { Consumer } from '../consumers'
import { consumerCount, consumerName, iconOf, mayOf, type NameWorld } from './labels'

export interface HeldAgent {
  id: string
  /** starts not made today (the day's record) */
  notStarted: number
  /** a run stopped at the line today */
  stopped: boolean
}

/** A model's short name for the column ("Opus 5.5", an OpenRouter model's label). */
const modelName = (p: ProviderId, model: string): string => (p === 'anthropic' ? labelOf({ p, m: model }).replace(/^Claude /, '') : servedLabel(p, model))

export function Consumers({ consumers, held, world, total, budget, loading }: { consumers: Consumer[]; held: HeldAgent[]; world: NameWorld; total: number | null; budget: number | null; loading: boolean }) {
  const t = useT()
  const lang = useLang()
  // held agents without spend today get a row of their own (after the spenders)
  const rows: Consumer[] = [...consumers]
  for (const h of held) if (!rows.some((c) => c.kind === 'agent' && c.id === h.id)) rows.push({ key: `agent:${h.id}`, kind: 'agent', id: h.id, usd: 0, unpriced: 0, runs: 0, requests: 0, models: [], last: 0 })
  const sum = rows.reduce((a, c) => a + c.usd, 0)
  const base = budget ?? (sum > 0 ? sum : null)
  const share = (usd: number) => (base ? Math.min(100, (usd / base) * 100) : 0)
  const runs = rows.reduce((a, c) => a + c.runs, 0)
  return (
    <section className="gv-sec" aria-labelledby="gv-cons-title" data-testid="regler-consumers">
      <div className="gv-sec__head">
        <span className="label gv-sec__n">01</span>
        <h2 id="gv-cons-title" className="label gv-sec__t">
          {t('features.governor.cons.title')}
        </h2>
        <span className="gv-sec__rule" aria-hidden />
        <span className="label gv-sec__legend">
          <Lock size={11} strokeWidth={1.8} aria-hidden /> {t('features.governor.cons.legend')}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="gv-sec__empty">{loading ? '—' : t('features.governor.cons.empty')}</p>
      ) : (
        <div className="gv-cons" role="table" aria-labelledby="gv-cons-title">
          <div className="gv-cons__h" role="row">
            <span className="label" role="columnheader">
              {t('features.governor.cons.h.source')}
            </span>
            <span className="label" role="columnheader">
              {t('features.governor.cons.h.model')}
            </span>
            <span className="label" role="columnheader">
              {budget !== null ? t('features.governor.cons.h.share') : t('features.governor.cons.h.shareToday')}
            </span>
            <span className="label gv-cons__r" role="columnheader">
              {t('features.governor.cons.h.usd')}
            </span>
            <span className="label" role="columnheader">
              {t('features.governor.cons.h.may')}
            </span>
          </div>
          {rows.map((c) => {
            const Icon = iconOf(c.kind)
            const h = c.kind === 'agent' ? held.find((x) => x.id === c.id) : undefined
            const may = mayOf(c.kind, c.id, world)
            const top = c.models[0]
            const sub = h
              ? h.notStarted > 0
                ? t('features.governor.cons.heldNot', { count: h.notStarted })
                : t('features.governor.cons.heldStop')
              : consumerCount(t, c.kind, c.runs, c.requests)
            return (
              <div key={c.key} className="gv-con" role="row" data-testid="regler-consumer" data-kind={c.kind} data-held={h ? '' : undefined}>
                <span className="gv-con__name" role="cell">
                  <Icon size={15} strokeWidth={1.7} aria-hidden />
                  <span className="gv-con__t">{consumerName(t, c.kind, c.id, world)}</span>
                  <span className="gv-con__s" data-testid="regler-consumer-sub">
                    {sub}
                  </span>
                </span>
                <span className="gv-con__model" role="cell">
                  {top ? modelName(top.p, top.model) : '—'}
                  {c.models.length > 1 && <span className="gv-dim"> {t('features.governor.cons.more', { count: c.models.length - 1 })}</span>}
                </span>
                <span className="gv-con__bar" role="cell" aria-label={base ? t('features.governor.cons.shareAria', { pct: Math.round(share(c.usd)) }) : undefined}>
                  <i style={{ width: `${share(c.usd)}%` }} />
                </span>
                <span className="gv-con__amt" role="cell" data-testid="regler-consumer-usd">
                  {fmtUsd(c.usd, lang)}
                  {c.unpriced > 0 && <span className="gv-dim" title={t('features.governor.cons.unpriced', { count: c.unpriced })}> +?</span>}
                </span>
                <span className="gv-con__may" role="cell">
                  {h ? (
                    <span className="gv-tag gv-tag--held" data-testid="regler-consumer-held">
                      <Lock size={11} strokeWidth={1.8} aria-hidden />
                      {t('features.governor.may.held')}
                    </span>
                  ) : may ? (
                    <span className="gv-tag">{t(`features.governor.may.${may}`)}</span>
                  ) : null}
                </span>
              </div>
            )
          })}
          <div className="gv-con gv-con--sum" role="row" data-testid="regler-consumers-sum">
            <span className="gv-con__name" role="cell">
              <span className="gv-con__t">{t('features.governor.cons.sum')}</span>
              <span className="gv-con__s">
                {t(runs === 1 ? 'features.governor.cons.runs.one' : 'features.governor.cons.runs.other', { count: runs })} · {t(rows.length === 1 ? 'features.governor.cons.sources.one' : 'features.governor.cons.sources.other', { count: rows.length })}
              </span>
            </span>
            <span className="gv-con__model" role="cell" />
            <span className="gv-con__bar gv-con__bar--sum" role="cell" data-budget={budget !== null || undefined}>
              <i style={{ width: `${budget !== null ? share(sum) : sum > 0 ? 100 : 0}%` }} />
            </span>
            <span className="gv-con__amt" role="cell">
              {fmtUsd(total ?? sum, lang)}
            </span>
            <span className="gv-con__may" role="cell" />
          </div>
        </div>
      )}
    </section>
  )
}
