/**
 * `/cost` in the AI terminal: what this conversation cost, one row per provider × model that answered (its ledger
 * entries summed — a model change mid-conversation or a refusal fallback gets its own row): requests, tokens in,
 * cache write / read, out, the price and how it was priced (TABLE · ESTIMATE …), then the total. At phone width each
 * row folds into a block whose cells carry their own labels. IN is always the input outside the cache — cache writes
 * and reads have their own figures on every surface (table, footer, agent runs).
 */
import { labelOf } from '@/shared/ai/models'
import type { Lang } from '@/shared/i18n'
import { useLang, useT } from '../../../i18n'
import { fmtUsd } from '../../../lib/money'
import type { ModelLine } from '../core/meter'
import { costText, sourceText } from '../Receipt'

const nums = new Map<string, Intl.NumberFormat>()
const num = (lang: Lang, digits: number) => {
  const key = `${lang}:${digits}`
  let f = nums.get(key)
  if (!f) nums.set(key, (f = new Intl.NumberFormat(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits })))
  return f
}

/** Tokens, short: 950 · 4.3K · 12K · 3.46M — the decimal sign of the UI's language (German "4,3K"). */
export function fmtTokens(n: number, lang: Lang): string {
  if (n < 1000) return num(lang, 0).format(n)
  if (n < 1_000_000) return `${num(lang, n < 10_000 ? 1 : 0).format(n / 1000)}K`
  return `${num(lang, 2).format(n / 1_000_000)}M`
}

/** A conversation's or run's amount as the meters show it: "≈" only when a response in it was estimated. */
export function meterUsd(usd: number, lines: readonly ModelLine[] | null | undefined, lang: Lang): string {
  return `${(lines ?? []).some((l) => l.source === 'estimate') ? '≈ ' : ''}${fmtUsd(usd, lang)}`
}

export function CostTable({ lines }: { lines: ModelLine[] }) {
  const t = useT()
  const lang = useLang()
  const sum = lines.reduce(
    (a, l) => ({ requests: a.requests + l.requests, input: a.input + l.input, cacheWrite: a.cacheWrite + l.cacheWrite, cacheRead: a.cacheRead + l.cacheRead, output: a.output + l.output, usd: a.usd + (l.usd ?? 0) }),
    { requests: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, usd: 0 },
  )
  const estimated = lines.some((l) => l.source === 'estimate')
  const unpriced = lines.some((l) => l.usd === null)
  const allUnpriced = lines.every((l) => l.usd === null)
  const head = {
    model: t('features.agent.cost.model'),
    requests: t('features.agent.meter.requests'),
    in: t('features.agent.meter.in'),
    cache: t('features.agent.cost.cacheWR'),
    out: t('features.agent.meter.out'),
    usd: t('features.agent.meter.usd'),
    source: t('features.agent.cost.source'),
  }
  return (
    <table className="term-cost" data-testid="term-cost">
      <caption className="visually-hidden">{t('features.agent.cost.caption')}</caption>
      <thead>
        <tr>
          <th scope="col">{head.model}</th>
          <th scope="col">{head.requests}</th>
          <th scope="col">{head.in}</th>
          <th scope="col">{head.cache}</th>
          <th scope="col">{head.out}</th>
          <th scope="col">{head.usd}</th>
          <th scope="col">{head.source}</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={`${l.p}:${l.model}`} data-model={`${l.p}:${l.model}`}>
            <th scope="row" className="term-cost__model">
              {labelOf({ p: l.p, m: l.model })}
            </th>
            <td data-label={head.requests}>{l.requests}</td>
            <td data-label={head.in}>{fmtTokens(l.input, lang)}</td>
            <td data-label={head.cache}>
              {fmtTokens(l.cacheWrite, lang)} / {fmtTokens(l.cacheRead, lang)}
            </td>
            <td data-label={head.out}>{fmtTokens(l.output, lang)}</td>
            <td data-label={head.usd} className="term-cost__usd">
              {costText(t, lang, l.usd, l.source)}
            </td>
            <td data-label={head.source} className="term-cost__src">
              {sourceText(t, l.usd, l.source)}
            </td>
          </tr>
        ))}
      </tbody>
      {lines.length > 1 && (
        <tfoot>
          <tr>
            <th scope="row" className="term-cost__model">
              {t('features.agent.cost.total')}
            </th>
            <td data-label={head.requests}>{sum.requests}</td>
            <td data-label={head.in}>{fmtTokens(sum.input, lang)}</td>
            <td data-label={head.cache}>
              {fmtTokens(sum.cacheWrite, lang)} / {fmtTokens(sum.cacheRead, lang)}
            </td>
            <td data-label={head.out}>{fmtTokens(sum.output, lang)}</td>
            <td data-label={head.usd} className="term-cost__usd" data-testid="term-cost-total">
              {/* a model without a price: said in words, never a bare "+" */}
              {allUnpriced ? t('features.ai.receipt.unknown') : `${costText(t, lang, sum.usd, estimated ? 'estimate' : 'table')}${unpriced ? ` ${t('features.agent.cost.plusUnknown')}` : ''}`}
            </td>
            <td data-label={head.source} className="term-cost__src" />
          </tr>
        </tfoot>
      )}
    </table>
  )
}
