/**
 * `/cost` in the AI terminal: what this conversation cost, one row per provider × model that answered (its ledger
 * entries summed — a model change mid-conversation or a refusal fallback gets its own row): requests, tokens in,
 * cache write / read, out, the price and how it was priced (TABLE · ESTIMATE …), then the total. At phone width each
 * row folds into a block whose cells carry their own labels.
 */
import { labelOf } from '@/shared/ai/models'
import { useLang, useT } from '../../../i18n'
import type { ModelLine } from '../core/meter'
import { costText, sourceText } from '../Receipt'

export function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`
  return `${(n / 1_000_000).toFixed(2)}M`
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
            <td data-label={head.in}>{fmtTokens(l.input)}</td>
            <td data-label={head.cache}>
              {fmtTokens(l.cacheWrite)} / {fmtTokens(l.cacheRead)}
            </td>
            <td data-label={head.out}>{fmtTokens(l.output)}</td>
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
            <td data-label={head.in}>{fmtTokens(sum.input)}</td>
            <td data-label={head.cache}>
              {fmtTokens(sum.cacheWrite)} / {fmtTokens(sum.cacheRead)}
            </td>
            <td data-label={head.out}>{fmtTokens(sum.output)}</td>
            <td data-label={head.usd} className="term-cost__usd" data-testid="term-cost-total">
              {costText(t, lang, sum.usd, estimated ? 'estimate' : 'table')}
              {unpriced ? ' +' : ''}
            </td>
            <td data-label={head.source} className="term-cost__src" />
          </tr>
        </tfoot>
      )}
    </table>
  )
}
