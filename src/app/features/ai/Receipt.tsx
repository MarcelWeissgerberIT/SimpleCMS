/**
 * The receipt of an AI run (features/ai/core/meter.ts — the sum of its ledger entries): one mono line under the
 * result — the model that answered, what the run cost, how it was priced ("Claude Sonnet 5.5 · $0.0040 · TABLE",
 * "≈ $0.0021 · ESTIMATE", "Price unknown"), and a line per step on the way ("Anthropic passed this to Claude Sonnet
 * 5.5"). At phone width the model's name is cut with "…" first; the title holds everything, tokens included.
 */
import { CornerDownRight } from 'lucide-react'
import type { CostSource, ProviderId, StepNote } from '@/shared/ai/types'
import { labelOf } from '@/shared/ai/models'
import { PRICES_DATE } from '@/shared/ai/prices'
import type { Lang } from '@/shared/i18n'
import { t as tt, useLang, useT } from '../../i18n'
import { fmtCost } from '../../lib/money'
import { HelpLink } from '../../help'
import type { Receipt } from './core/meter'
import './runs.css'

type T = typeof tt

/** The company that runs a provider's models (receipts name it for its own steps). */
const COMPANY: Record<ProviderId, string> = { anthropic: 'Anthropic', openai: 'OpenAI', openrouter: 'OpenRouter' }

/** What a receipt says the run cost: an amount, "≈ amount" for an estimate, "Price unknown" without a price. */
export function costText(t: T, lang: Lang, usd: number | null, source: CostSource): string {
  if (usd === null) return t('features.ai.receipt.unknown')
  return source === 'estimate' ? `≈ ${fmtCost(usd, lang)}` : fmtCost(usd, lang)
}

/** How it was priced (TABLE · ESTIMATE · REPORTED · CATALOGUE; nothing without a price). */
export const sourceText = (t: T, usd: number | null, source: CostSource): string => (usd === null || source === 'none' ? '' : t(`features.ai.receipt.src.${source}`))

/** A step on the way, as a receipt line (null: none to show). */
export function stepText(t: T, s: StepNote, p: ProviderId): string | null {
  if (s.k === 'refusal-fallback' && s.to) return t('features.ai.receipt.fallback', { provider: COMPANY[p], model: labelOf({ p, m: s.to }) })
  return null
}

/** The price table's date as the UI's language writes it ("October 12, 2026" · "12. Oktober 2026"). */
export const pricesDate = (lang: Lang): string => new Date(`${PRICES_DATE}T12:00:00`).toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' })

/** The receipt as one text (the title, tests): model · requests · cost · source, then the tokens and the steps. */
export function receiptText(t: T, lang: Lang, r: Receipt): string {
  const model = labelOf({ p: r.served.p, m: r.served.model })
  const head = [model, r.requests > 1 ? t('features.ai.receipt.requests', { count: r.requests }) : '', costText(t, lang, r.usd, r.costSource), sourceText(t, r.usd, r.costSource)].filter(Boolean).join(' · ')
  const n = (x: number) => x.toLocaleString(lang)
  const tokens = t('features.ai.receipt.tokens', { input: n(r.usage.input), write: n(r.usage.cacheWrite + r.usage.cacheWrite1h), read: n(r.usage.cacheRead), output: n(r.usage.output) })
  const steps = r.steps.map((s) => stepText(t, s, r.served.p)).filter((x): x is string => !!x)
  return [head, tokens, ...steps, r.usd !== null && r.costSource !== 'reported' ? t('features.ai.receipt.prices', { date: pricesDate(lang) }) : ''].filter(Boolean).join('\n')
}

export function ReceiptLine({ receipt: r, testId = 'ai-receipt' }: { receipt: Receipt; testId?: string }) {
  const t = useT()
  const lang = useLang()
  const model = labelOf({ p: r.served.p, m: r.served.model })
  const steps = r.steps.map((s) => stepText(t, s, r.served.p)).filter((x): x is string => !!x)
  const src = sourceText(t, r.usd, r.costSource)
  return (
    <div className="ai-receipt" data-testid={testId} data-src={r.costSource} title={receiptText(t, lang, r)}>
      <p className="ai-receipt__line">
        <span className="ai-receipt__k">{t('features.ai.receipt.label')}</span>
        <span className="ai-receipt__model">{model}</span>
        {r.requests > 1 && <span className="ai-receipt__n">{` · ${t('features.ai.receipt.requests', { count: r.requests })}`}</span>}
        <span className="ai-receipt__usd" data-testid={`${testId}-usd`}>{` · ${costText(t, lang, r.usd, r.costSource)}`}</span>
        {src && (
          <span className="ai-receipt__src" data-src={r.costSource}>
            {src}
          </span>
        )}
        <HelpLink id="ai-costs" topic={t('features.ai.receipt.help')} className="ai-receipt__help" />
      </p>
      {steps.map((s) => (
        <p key={s} className="ai-receipt__step" data-testid={`${testId}-step`}>
          <CornerDownRight size={11} strokeWidth={1.75} aria-hidden />
          <span>{s}</span>
        </p>
      ))}
    </div>
  )
}
