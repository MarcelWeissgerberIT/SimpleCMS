/**
 * #/regler v1 (Regler § 10.1, mock 1 without the lever's column — G1): the head (title, "Budgets & rights ↗", "All
 * receipts"), the readout (today · month · runs today · prices), § 00's plate (the dial, the month, the browser line,
 * the hard limits per provider in use, the server agents' line in a team), 01 consumers today and 02 the receipt roll.
 * A lazy chunk: it reads this device's ledger when it opens (key-range reads of today, the month's closed days,
 * yesterday's total) and follows the totals from then on — never before. OpenRouter's key limit is read once per tab
 * through the free key check (no text sent) and only when an OpenRouter key is here.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowUpRight, ReceiptText, SlidersHorizontal } from 'lucide-react'
import type { LedgerEntry } from '@/shared/ai/types'
import { PROVIDERS, PROVIDER_ORDER } from '@/shared/ai/providers'
import { PRICES_DATE } from '@/shared/ai/prices'
import { useWorkspace } from '../../../store/store'
import { useCloud } from '../../../cloud'
import { useLang, useT } from '../../../i18n'
import { fmtUsd } from '../../../lib/money'
import { resolveAssetUrl } from '../../../lib/files'
import { HelpLink } from '../../../help'
import { useAgentRuns, loadAgentRuns, heldId } from '../../agents'
import { ledgerDay } from '../ledger'
import { ledgerScope } from '../scope'
import { dayOf } from '../clock'
import { dayTotal, loadMonth, loadToday, startTotals, useGovernorTotals } from '../totals'
import { deviceLimitOf } from '../device'
import { deviceSnapshot, subscribeDevice } from '../statusGate'
import { limitsOf } from '../limits'
import { openBudgets } from '../lampSource'
import { consumersOf, providersOf, runsOf } from '../consumers'
import { ConsumptionPlate } from './ConsumptionPlate'
import { useHardLines } from './hard'
import { Consumers, type HeldAgent } from './Consumers'
import { ReceiptRoll } from './ReceiptRoll'
import type { NameWorld } from './labels'
import './governor.css'
import './page.css'

const pad = (n: number) => String(n).padStart(2, '0')
const daysIn = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()

/** The minute (the plate's clock, the day's roll at midnight). */
function useMinute(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

/** Today's entries of this scope, read when the page opens and again whenever the totals move. */
function useToday(at: number, scopeKey: string): LedgerEntry[] | null {
  const [list, setList] = useState<LedgerEntry[] | null>(null)
  const first = useRef(true)
  useEffect(() => {
    let alive = true
    const scope = ledgerScope()
    const id = window.setTimeout(
      () => {
        if (!scope) return alive && setList([])
        void ledgerDay(scope, dayOf(Date.now()))
          .then((l) => alive && setList(l))
          .catch(() => alive && setList([]))
      },
      first.current ? 0 : 250,
    )
    first.current = false
    return () => {
      alive = false
      window.clearTimeout(id)
    }
  }, [at, scopeKey])
  return list
}

export default function ReglerPage() {
  const t = useT()
  const lang = useLang()
  const now = useMinute()
  const governor = useWorkspace((s) => s.governor)
  const wsAI = useWorkspace((s) => s.ai)
  const settings = useWorkspace((s) => s.settings)
  const agents = useWorkspace((s) => s.agents)
  const databases = useWorkspace((s) => s.databases)
  const pages = useWorkspace((s) => s.pages)
  const active = useCloud((s) => s.active)
  const user = useCloud((s) => s.user)
  const device = useSyncExternalStore(subscribeDevice, deviceSnapshot, () => '')
  const totals = useGovernorTotals()
  const scopeKey = `${active.kind}:${active.id}:${user?.id ?? ''}`
  const today = useToday(totals.at, scopeKey)
  const [peak, setPeak] = useState<number | null>(null)
  const rollRef = useRef<HTMLDivElement>(null)
  const [all, setAll] = useState(false)

  // follow the ledger from now on: today, the month's closed days, yesterday's total
  useEffect(() => {
    startTotals()
    void loadToday().then(() => loadMonth())
    const scope = ledgerScope()
    if (!scope) return
    let alive = true
    const y = new Date()
    y.setDate(y.getDate() - 1)
    void dayTotal(scope, dayOf(y.getTime())).then((v) => alive && setPeak(v))
    return () => {
      alive = false
    }
  }, [scopeKey, totals.day])

  // the agents' runs (held records live there — every tab reads them, the page makes sure)
  useEffect(() => {
    const loaded = useAgentRuns.getState().byAgent
    for (const id of Object.keys(agents ?? {})) if (!(id in loaded)) void loadAgentRuns(id)
  }, [agents])
  const byAgent = useAgentRuns((s) => s.byAgent)

  const limits = limitsOf(governor, device ? deviceLimitOf() : undefined)
  const read = totals.known && totals.at > 0
  // the dial: this workspace's day line, else the person's line for this browser (then its device-wide total)
  const wsDay = limits.ws.day
  const devDay = limits.device.day
  const dialOnDevice = wsDay === null && devDay !== null
  const dialSpent = dialOnDevice ? totals.deviceToday : totals.spentToday
  const dialBudget = wsDay ?? devDay
  const monthLimit = limits.ws.month ?? limits.device.month
  const monthOnDevice = limits.ws.month === null && limits.device.month !== null
  const d = new Date(now)
  const world: NameWorld = { agents, databases, pages }

  const list = today ?? []
  const consumers = useMemo(() => consumersOf(list), [list])
  const runs = runsOf(list)
  const day = dayOf(now)
  const held: HeldAgent[] = useMemo(() => {
    const out: HeldAgent[] = []
    for (const [id, rs] of Object.entries(byAgent)) {
      if (!agents?.[id]) continue
      const rec = rs.find((r) => r.id === heldId(day))
      const stopped = rs.some((r) => r.status === 'held' && r.held?.kind === 'stopped' && dayOf(r.endedAt ?? r.startedAt) === day)
      if (rec || stopped) out.push({ id, notStarted: rec?.held?.count ?? (rec ? 1 : 0), stopped })
    }
    return out
  }, [byAgent, agents, day])

  const hard = useHardLines(providersOf(list))

  const soft = PROVIDER_ORDER.flatMap((p) => {
    const usd = wsAI?.limits?.[p]?.monthUsd
    return typeof usd === 'number' && usd > 0 ? [{ name: PROVIDERS[p].name, usd }] : []
  })
  const month = {
    month: d.toLocaleDateString(lang, { month: 'long' }),
    spent: read ? (monthOnDevice ? totals.deviceMonth : totals.spentMonth) : 0,
    today: read ? (monthOnDevice ? totals.deviceToday : totals.spentToday) : 0,
    limit: monthLimit,
    day: d.getDate(),
    days: daysIn(d),
    soft,
  }
  const others = Math.max(0, totals.deviceToday - totals.spentToday)
  const browser =
    devDay !== null && read
      ? { total: totals.deviceToday, limit: devDay, here: totals.spentToday, others, n: totals.otherScopes, binds: wsDay === null || devDay - totals.deviceToday < wsDay - totals.spentToday }
      : null
  const when = `${d.toLocaleDateString(lang, { weekday: 'short', day: '2-digit', month: '2-digit' }).replace(',', '')} · ${pad(d.getHours())}:${pad(d.getMinutes())}`
  const catalogue = (settings.ai?.models ?? []).reduce((a, r) => (r.at > a ? r.at : a), '')
  const date = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(lang, { day: '2-digit', month: '2-digit', year: 'numeric' })
  const dayBudgetShare = dialBudget ?? null

  const toRoll = () => {
    setAll(false)
    rollRef.current?.scrollIntoView({ block: 'start' })
    rollRef.current?.querySelector<HTMLElement>('[data-roll-head]')?.focus({ preventScroll: true })
  }

  return (
    <div className="gv-page" data-testid="regler-page">
      <header className="gv-page__head">
        <img className="gv-page__icon" src={resolveAssetUrl('assets/icons/counter.webp')} alt="" />
        <h1 className="display gv-page__title">{t('features.governor.title')}</h1>
        <span className="label gv-page__sub">{t('features.governor.sub')}</span>
        <HelpLink id="ai-costs" topic={t('features.governor.title')} />
        <span className="gv-page__sp" />
        <button type="button" className="btn gv-page__key" onClick={openBudgets} data-testid="regler-budgets">
          <SlidersHorizontal size={14} strokeWidth={1.7} aria-hidden />
          {t('features.governor.head.budgets')}
          <ArrowUpRight size={12} strokeWidth={1.7} aria-hidden className="gv-page__key-arrow" />
        </button>
        <button type="button" className="btn gv-page__key" onClick={toRoll}>
          <ReceiptText size={14} strokeWidth={1.7} aria-hidden />
          {t('features.governor.head.receipts')}
        </button>
      </header>

      <div className="gv-ro" aria-label={t('features.governor.ro.aria')} data-testid="regler-readout">
        <span className="gv-ro__cell">
          <span className="label">{t('features.governor.ro.today')}</span>
          <span className="gv-ro__val" data-testid="regler-ro-today">
            {read ? fmtUsd(dialSpent, lang) : '—'}
            {dialBudget !== null && <span className="gv-dim"> / {fmtUsd(dialBudget, lang)}</span>}
          </span>
        </span>
        <span className="gv-ro__cell">
          <span className="label">{t('features.governor.ro.month')}</span>
          <span className="gv-ro__val" data-testid="regler-ro-month">
            {read ? fmtUsd(month.spent, lang) : '—'}
            {monthLimit !== null && <span className="gv-dim"> / {fmtUsd(monthLimit, lang)}</span>}
          </span>
        </span>
        <span className="gv-ro__cell">
          <span className="label">{t('features.governor.ro.runs')}</span>
          <span className="gv-ro__val" data-testid="regler-ro-runs">
            {today ? runs : '—'}
          </span>
        </span>
        <span className="gv-ro__cell gv-ro__cell--prices">
          <span className="label">{t('features.governor.ro.prices')}</span>
          <span className="gv-ro__val">{t('features.governor.ro.table', { date: `${PRICES_DATE.slice(5, 7)}/${PRICES_DATE.slice(0, 4)}` })}</span>
        </span>
      </div>

      <ConsumptionPlate
        when={when}
        spent={read ? dialSpent : null}
        known={read}
        budget={dialBudget}
        peak={peak}
        month={month}
        browser={browser}
        hard={hard}
        server={active.kind === 'cloud'}
        onSetBudget={dialBudget === null ? openBudgets : undefined}
      />

      <div className="gv-below">
        <Consumers consumers={consumers} held={held} world={world} total={read ? totals.spentToday : null} budget={dayBudgetShare} loading={today === null} />
        <div ref={rollRef} className="gv-below__roll">
          <ReceiptRoll entries={today} world={world} all={all} onAll={setAll} />
        </div>
      </div>

      <p className="label gv-page__foot">
        {t('features.governor.page.prices', { date: date(PRICES_DATE) })}
        {catalogue && ` · ${t('features.governor.page.catalogue', { date: date(catalogue) })}`}
      </p>
    </div>
  )
}
