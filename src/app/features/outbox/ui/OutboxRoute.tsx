/**
 * #/outbox: every slip of this workspace on this device. The readout and the counter plate (the same numbers as the
 * sidebar, the dock and the status bar), tabs (All · Clean · Foreign text · Held · Sent) and a server filter, two
 * bins — A: clean and ready, B: stay, with why — "Slips come from", and on the right this device's receipts of
 * today and the send routes. A card opens its slip in its database's dock.
 */
import { useEffect, useMemo, useState } from 'react'
import { Send } from 'lucide-react'
import { useWorkspace } from '../../../store/store'
import { Screws } from '../../../ui/controls'
import { onRovingKey } from '../../../ui/roving'
import { useLang, useT } from '../../../i18n'
import { HelpLink } from '../../../help'
import { isChanged, isClean, isForeign, isOpen, sentToday } from '../counts'
import { openSlip, useOutboxCounts, useSlips } from '../hooks'
import { focusSlipEl, onOutboxKey } from '../keys'
import { handBlock } from '../hand'
import { useOutbox } from '../store'
import { slipText } from '../text'
import { handArgs } from './HandPlate'
import { ForeignMark, Lid, OriginChip, ServerTag, ToolTarget, clock } from './parts'
import { ReceiptStrip } from './ReceiptStrip'
import { RoutesPanel } from './RoutesPanel'
import { ReceiptCard } from './ReceiptCard'
import { runCopy, runRedraft } from './Slip'
import { orderSlips } from './Dock'
import type { Slip } from '../types'
import { withdrawSlip } from '../actions'

type Tab = 'all' | 'clean' | 'foreign' | 'held' | 'sent'

export default function OutboxRoute({ slip: deep }: { slip?: string }) {
  const t = useT()
  const lang = useLang()
  const all = useSlips()
  const c = useOutboxCounts()
  const [tab, setTab] = useState<Tab>('all')
  const [server, setServer] = useState<string>('')
  const focusId = useOutbox((s) => s.focus)
  const [, setBusy] = useState(false)
  useEffect(() => {
    if (deep) {
      useOutbox.setState({ focus: deep })
      focusSlipEl(deep)
    }
  }, [deep])

  const servers = useMemo(() => [...new Set(all.map((s) => s.target.serverName))].sort(), [all])
  const byServer = (s: Slip) => !server || s.target.serverName === server
  const open = orderSlips(all).filter(byServer)
  const sent = all.filter((s) => s.receipt && (s.state === 'sent' || s.state === 'confirmed' || s.state === 'unconfirmed')).filter(byServer)
  const shown = tab === 'clean' ? open.filter((s) => isClean(s)) : tab === 'foreign' ? open.filter((s) => s.state !== 'held' && isForeign(s)) : tab === 'held' ? open.filter((s) => s.state === 'held') : tab === 'sent' ? [] : open
  const binA = shown.filter((s) => isClean(s))
  const binB = shown.filter((s) => !isClean(s))
  const order = [...binA, ...binB].map((s) => s.id)
  const focus = order.includes(focusId ?? '') ? focusId : null

  const tabs: Array<[Tab, number]> = [
    ['all', c.open],
    ['clean', c.clean],
    ['foreign', c.foreign],
    ['held', c.held],
    ['sent', sent.length],
  ]

  return (
    <div
      className="obx-page"
      data-testid="outbox-page"
      onKeyDown={(e) =>
        onOutboxKey(e, {
          order,
          focus,
          setFocus: (id) => useOutbox.setState({ focus: id }),
          edit: () => focus && openSlip(focus),
          redraft: () => {
            const s = all.find((x) => x.id === focus)
            if (s?.draft && s.draft.by !== 'person') void runRedraft(s, setBusy)
          },
          copy: () => {
            const s = all.find((x) => x.id === focus)
            if (s && !handBlock(s)) void runCopy(s)
          },
        })
      }
    >
      <div className="obx-page__main">
        <header className="obx-page__head">
          <Send size={40} strokeWidth={1.4} className="obx-page__icon" aria-hidden />
          <h1 className="display obx-page__title">{t('features.outbox.title')}</h1>
          <HelpLink id="outbox" topic={t('features.outbox.title')} />
        </header>
        <div className="obx-readout obx-readout--page" data-testid="outbox-page-readout">
          <span className="obx-readout__cell">
            <span className="label">{t('features.outbox.readout.slips')}</span>
            <b data-testid="outbox-page-open">{String(c.open).padStart(2, '0')}</b>
          </span>
          <span className="obx-readout__cell">
            <span className="led led--ok" aria-hidden />
            <b>{c.clean}</b>
            <span className="label">{t('features.outbox.readout.clean')}</span>
          </span>
          <span className="obx-readout__cell">
            <ForeignMark />
            <b>{c.foreign}</b>
            <span className="label">{t('features.outbox.readout.foreign')}</span>
          </span>
          <span className="obx-readout__cell">
            <span className="led led--on" aria-hidden />
            <b>{c.held}</b>
            <span className="label">{t('features.outbox.readout.held')}</span>
          </span>
          <span className="obx-readout__cell">
            <span className="label">{t('features.outbox.readout.sentToday')}</span>
            <b data-testid="outbox-page-sent">{c.sentToday}</b>
          </span>
        </div>

        <div className="obx-counters screw-plate">
          <Screws seed="outbox-counters" />
          <div className="obx-counter">
            <span className="obx-counter__n" data-kind="ok">
              {String(c.clean).padStart(2, '0')}
            </span>
            <span className="label">{t('features.outbox.page.going')}</span>
          </div>
          <div className="obx-counter">
            <span className="obx-counter__n" data-kind="foreign">
              <ForeignMark />
              {String(c.foreign).padStart(2, '0')}
            </span>
            <span className="label">{t('features.outbox.page.foreign')}</span>
          </div>
          <div className="obx-counter">
            <span className="obx-counter__n" data-kind="sig">
              {String(c.held).padStart(2, '0')}
            </span>
            <span className="label">{t('features.outbox.page.held')}</span>
          </div>
          <p className="obx-counters__line">{t('features.outbox.page.plateLine')}</p>
        </div>

        <div className="obx-tabs">
          <div role="radiogroup" aria-label={t('features.outbox.tab.label')} className="obx-tabs__group" onKeyDown={(e) => onRovingKey(e)}>
            {tabs.map(([id, n]) => (
              <button key={id} type="button" role="radio" aria-checked={tab === id} tabIndex={tab === id ? 0 : -1} className="obx-tab" onClick={() => setTab(id)} data-testid={`outbox-tab-${id}`}>
                {id === 'foreign' && <ForeignMark />}
                {id === 'held' && <span className="led led--on" aria-hidden />}
                {id === 'clean' && <span className="led led--ok" aria-hidden />}
                {t(`features.outbox.tab.${id}`)}
                <span className="obx-tab__n">{n}</span>
              </button>
            ))}
          </div>
          <span className="obx-sp" />
          {servers.length > 1 && (
            <label className="obx-tabs__server">
              <span className="label">{t('features.outbox.byServer')}</span>
              <select className="input" value={server} onChange={(e) => setServer(e.target.value)}>
                <option value="">{t('features.outbox.byServer.all')}</option>
                {servers.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {tab === 'sent' ? (
          <section className="obx-bin" aria-label={t('features.outbox.bin.sent')}>
            {sent.length ? sent.map((s) => <ReceiptCard key={s.id} slip={s} />) : <p className="obx-empty">{t('features.outbox.strip.none')}</p>}
          </section>
        ) : (
          <>
            <section className="obx-bin" aria-labelledby="obx-bin-a">
              <h2 className="obx-bin__head label" id="obx-bin-a">
                {t('features.outbox.bin.clean')}
                <span className="obx-bin__rule" aria-hidden />
              </h2>
              <div className="obx-cards">
                {binA.map((s) => (
                  <Card key={s.id} slip={s} focused={s.id === focus} lang={lang} />
                ))}
                <FromCard />
              </div>
            </section>
            {binB.length > 0 && (
              <section className="obx-bin" aria-labelledby="obx-bin-b">
                <h2 className="obx-bin__head label" id="obx-bin-b">
                  {t('features.outbox.bin.stay')}
                  <span className="obx-bin__rule" aria-hidden />
                </h2>
                <div className="obx-cards">
                  {binB.map((s) => (
                    <Card key={s.id} slip={s} focused={s.id === focus} lang={lang} />
                  ))}
                </div>
              </section>
            )}
            {!all.some(isOpen) && (
              <div className="obx-empty obx-empty--page">
                <p>{t('features.outbox.empty.page')}</p>
                <p>{t('features.outbox.empty.how')}</p>
              </div>
            )}
          </>
        )}
      </div>
      <aside className="obx-page__side">
        <ReceiptStrip slips={all.filter((s) => sentToday(s))} />
        <RoutesPanel />
      </aside>
    </div>
  )
}

/** Why a slip stays in bin B (first reason that holds). */
function reasons(s: Slip, t: (k: string, v?: Record<string, string | number>) => string, lang: 'en' | 'de'): string[] {
  const out: string[] = []
  if (s.state === 'unclear') out.push(t('features.outbox.reason.unclear'))
  if (s.state === 'held') {
    const at = [...s.log].reverse().find((l) => l.code === 'held')?.at ?? s.updatedAt
    out.push(t('features.outbox.reason.held', { time: clock(at, lang) }) + (s.lastCheck?.latest ? ` · „${s.lastCheck.latest.slice(0, 60)}${s.lastCheck.latest.length > 60 ? '…' : ''}“` : ''))
  }
  if (s.state === 'missing') out.push(t('features.outbox.reason.missing'))
  if (isChanged(s)) out.push(t('features.outbox.reason.changed'))
  for (const a of s.seal.addresses) if (a.only === 'foreign') out.push(t('features.outbox.addr.foreign', { source: a.source ?? '' }))
  if (s.seal.hidden.length) out.push(t('features.outbox.reason.hidden'))
  if (!out.length && s.seal.foreign) out.push(t('features.outbox.reason.foreignText', { labels: s.sources.filter((x) => !x.trusted && !x.typed).slice(0, 2).map((x) => x.label).join(', ') }))
  if (!out.length && !s.seal.complete) out.push(t('features.outbox.reason.incomplete'))
  return out
}

function Card({ slip, focused, lang }: { slip: Slip; focused: boolean; lang: 'en' | 'de' }) {
  const t = useT()
  const clean = isClean(slip)
  const foreign = isForeign(slip)
  const text = slipText(slip)
  const why = clean ? [] : reasons(slip, t, lang)
  // the pre-read field this slip read (its typed source), else the first one
  const checks = slip.baseline ? Object.entries(slip.baseline.fields).filter(([k]) => k === 'srcStatus' || k === 'comments') : []
  const check = checks.find(([k]) => slip.sources.some((s) => s.label === slip.baseline?.labels?.[k])) ?? checks[0]
  const args = handArgs(slip)
  const foreignLabel = slip.sources.find((s) => !s.trusted && !s.typed && s.label.includes(' '))?.label
  return (
    <article className="obx-card" data-foreign={foreign || undefined} data-clean={clean || undefined} data-slip={slip.id} data-focused={focused || undefined} tabIndex={-1} data-testid="outbox-card" aria-labelledby={`obx-c-${slip.id}`}>
      <div className="obx-slip__head">
        <ServerTag name={slip.target.serverName} />
        <ToolTarget slip={slip} />
      </div>
      <h3 className="obx-card__title" id={`obx-c-${slip.id}`}>
        <button type="button" className="obx-card__open" onClick={() => openSlip(slip.id)}>
          {slip.title}
        </button>
      </h3>
      {text && <p className="obx-card__text">„{text}“</p>}
      <div className="obx-card__meta">
        <OriginChip slip={slip} lang={lang} />
      </div>
      {check && slip.baseline && (
        <p className="obx-checkline">
          <span className="label">{t('features.outbox.line.mirror', { time: clock(slip.lastCheck?.at ?? slip.baseline.at, lang) })}</span> <b>{slip.baseline.labels?.[check[0]] ?? check[0]}</b> = {check[1]}
        </p>
      )}
      {why.length > 0 && (
        <ul className="obx-card__why">
          {why.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <div className="obx-card__foot">
        {foreign ? (
          <span className="obx-card__fword label">
            <ForeignMark /> {t('features.outbox.src.foreign')}
            {foreignLabel ? ` · ${foreignLabel}` : ''}
          </span>
        ) : (
          <span className="obx-argline">{args}</span>
        )}
        <span className="obx-sp" />
        {!clean && slip.state !== 'unclear' && (
          <button type="button" className="icon-btn icon-btn--sm" aria-label={t('features.outbox.act.withdraw')} onClick={() => void withdrawSlip(slip.id, 'person')}>
            ✕
          </button>
        )}
        <Lid />
      </div>
    </article>
  )
}

function FromCard() {
  const t = useT()
  const any = useWorkspace((s) => (s.integrations ?? []).some((p) => p.sends?.length))
  if (!any) return null
  return (
    <aside className="obx-from" aria-label={t('features.outbox.from.title')}>
      <span className="label">{t('features.outbox.from.title')}</span>
      <ul>
        <li>
          <span className="obx-from__ico" aria-hidden>
            ⌘
          </span>
          {t('features.outbox.from.command')}
        </li>
      </ul>
      <p>{t('features.outbox.from.footer')}</p>
    </aside>
  )
}
