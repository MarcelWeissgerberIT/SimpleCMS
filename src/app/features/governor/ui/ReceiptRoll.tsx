/**
 * 02 RECEIPTS · TODAY n (Regler § 10.1): today's runs of this device grouped by run (one ledger source each), newest
 * first — "13:58 · AI menu · Reshaping · $0.21"; a stub opens (↵ / click) to the full receipt: the model that answered
 * and the cost, the steps on the way (a capped answer, +1 $ allowed, the band against the cost) and one line per model
 * when more than one answered. "All" lists the last 30 days by day (read when pressed); a day opens to its roll.
 * Names come from ids only (the ledger holds nothing else).
 */
import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, ChevronRight, ReceiptText } from 'lucide-react'
import type { LedgerEntry } from '@/shared/ai/types'
import { labelOf } from '@/shared/ai/models'
import { useLang, useT } from '../../../i18n'
import { fmtCost, fmtUsd } from '../../../lib/money'
import { ReceiptLine } from '../../ai/Receipt'
import { addToLines, addToReceipt, type ModelLine, type Receipt } from '../../ai/core/meter'
import { servedLabel } from '../../ai/core/registry'
import { ledgerEntries } from '../ledger'
import { dayOf } from '../clock'
import { daysOf, rollOf } from '../consumers'
import { fmtTok } from '../format'
import { rollLabel, type NameWorld } from './labels'

const pad = (n: number) => String(n).padStart(2, '0')
const clock = (at: number) => {
  const d = new Date(at)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function Roll({ entries, world, testId }: { entries: readonly LedgerEntry[]; world: NameWorld; testId: string }) {
  const t = useT()
  const lang = useLang()
  const items = useMemo(() => rollOf(entries), [entries])
  const [open, setOpen] = useState<string | null>(null)
  return (
    <ol className="gv-roll" data-testid={testId}>
      {items.map((it) => {
        const isOpen = open === it.source
        const label = rollLabel(t, it, world)
        const receipt = it.entries.reduce<Receipt | null>((r, e) => addToReceipt(r, e), null)
        const lines = it.entries.reduce<ModelLine[]>((ls, e) => addToLines(ls, e), [])
        const mcp = it.entries.reduce((n, e) => n + (e.mcpCalls || 0), 0)
        const id = `gv-stub-${it.source.replace(/[^A-Za-z0-9_-]/g, '-')}`
        return (
          <li key={it.source} className="gv-roll__item" data-open={isOpen || undefined}>
            <button type="button" className="gv-stub" aria-expanded={isOpen} aria-controls={id} onClick={() => setOpen(isOpen ? null : it.source)} data-testid="regler-stub" data-source={it.source}>
              <span className="gv-stub__at">{clock(it.last)}</span>
              <span className="gv-stub__t" title={label}>
                {label}
              </span>
              <span className="gv-stub__amt">{it.usd === null ? t('features.ai.receipt.unknown') : fmtUsd(it.usd, lang)}</span>
              <ChevronRight size={12} strokeWidth={1.8} aria-hidden className="gv-stub__chev" />
            </button>
            {isOpen && receipt && (
              <div id={id} className="gv-stub__receipt" data-testid="regler-stub-receipt">
                <ReceiptLine receipt={receipt} testId="regler-receipt" />
                <p className="gv-stub__tok" data-testid="regler-receipt-tokens">
                  {t('features.governor.roll.tokens', { input: fmtTok(receipt.usage.input + receipt.usage.cacheRead + receipt.usage.cacheWrite + receipt.usage.cacheWrite1h, lang), output: fmtTok(receipt.usage.output, lang) })}
                  {mcp > 0 && ` · ${t('features.governor.roll.mcp', { count: mcp })}`}
                </p>
                {lines.length > 1 && (
                  <ul className="gv-stub__models">
                    {lines.map((l) => (
                      <li key={`${l.p}:${l.model}`} className="gv-stub__model">
                        <span>{l.p === 'anthropic' ? labelOf({ p: l.p, m: l.model }) : servedLabel(l.p, l.model)}</span>
                        <span className="gv-dim">{t(l.requests === 1 ? 'features.governor.cons.requests.one' : 'features.governor.cons.requests.other', { count: l.requests })}</span>
                        <span className="gv-stub__amt">{l.usd === null ? t('features.ai.receipt.unknown') : fmtCost(l.usd, lang)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** The last 30 days, by day (read when "All" is pressed). */
function Days({ world }: { world: NameWorld }) {
  const t = useT()
  const lang = useLang()
  const [list, setList] = useState<LedgerEntry[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const from = new Date()
    from.setHours(0, 0, 0, 0)
    from.setDate(from.getDate() - 29)
    void ledgerEntries({ from: from.getTime() })
      .then((l) => alive && setList(l))
      .catch(() => alive && setList([]))
    return () => {
      alive = false
    }
  }, [])
  const days = useMemo(() => (list ? daysOf(list, dayOf) : []), [list])
  if (!list) return <p className="gv-sec__empty">—</p>
  if (!days.length) return <p className="gv-sec__empty">{t('features.governor.roll.none30')}</p>
  return (
    <ol className="gv-days" data-testid="regler-days">
      {days.map((d) => {
        const isOpen = open === d.day
        const date = new Date(`${d.day}T12:00:00`).toLocaleDateString(lang, { weekday: 'short', day: '2-digit', month: '2-digit' }).replace(',', '')
        return (
          <li key={d.day} className="gv-days__item">
            <button type="button" className="gv-day" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : d.day)} data-testid="regler-day">
              <span className="gv-stub__at">{date}</span>
              <span className="gv-stub__t">{t(d.runs === 1 ? 'features.governor.cons.runs.one' : 'features.governor.cons.runs.other', { count: d.runs })}</span>
              <span className="gv-stub__amt">{fmtUsd(d.usd, lang)}</span>
              <ChevronRight size={12} strokeWidth={1.8} aria-hidden className="gv-stub__chev" />
            </button>
            {isOpen && <Roll entries={list.filter((e) => dayOf(e.at) === d.day)} world={world} testId="regler-day-roll" />}
          </li>
        )
      })}
    </ol>
  )
}

export function ReceiptRoll({ entries, world, all, onAll }: { entries: readonly LedgerEntry[] | null; world: NameWorld; all: boolean; onAll: (v: boolean) => void }) {
  const t = useT()
  const runs = useMemo(() => (entries ? rollOf(entries).length : 0), [entries])
  return (
    <section className="gv-sec" aria-labelledby="gv-roll-title" data-testid="regler-receipts">
      <div className="gv-sec__head">
        <span className="label gv-sec__n">02</span>
        <h2 id="gv-roll-title" className="label gv-sec__t" tabIndex={-1} data-roll-head>
          {all ? t('features.governor.roll.days') : t('features.governor.roll.title', { count: runs })}
        </h2>
        <span className="gv-sec__rule" aria-hidden />
        <button type="button" className="gv-sec__lnk" aria-pressed={all} onClick={() => onAll(!all)} data-testid="regler-roll-all">
          {all ? t('features.governor.roll.today') : t('features.governor.roll.all')}
          <ArrowRight size={13} strokeWidth={1.7} aria-hidden />
        </button>
      </div>
      {all ? <Days world={world} /> : !entries ? <p className="gv-sec__empty">—</p> : entries.length === 0 ? <p className="gv-sec__empty">{t('features.governor.roll.empty')}</p> : <Roll entries={entries} world={world} testId="regler-roll" />}
      <p className="gv-roll__note">
        <ReceiptText size={13} strokeWidth={1.7} aria-hidden />
        {t('features.governor.roll.note')}
      </p>
    </section>
  )
}
