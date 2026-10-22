/**
 * #/outbox: every slip of this workspace on this device. The readout and the counter plate (the same numbers as the
 * sidebar, the dock and the status bar), tabs (All · Clean · Foreign text · Held · Sent) and a server filter, two
 * bins — A: clean and ready, B: stay, with why — "Slips come from", and on the right this device's receipts of
 * today and the send routes. A card opens its slip in its database's dock. Keys act on the card that holds the focus
 * (else the one J / K last went to); ⌘↵ opens the slip in its dock — a card shows its text clipped, so nothing is
 * copied from here.
 */
import { ListTree } from 'lucide-react'
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { Send } from 'lucide-react'
import { useWorkspace } from '../../../store/store'
import { useUI } from '../../../store/ui'
import { Screws } from '../../../ui/controls'
import { onRovingKey } from '../../../ui/roving'
import { useLang, useT, t as translate } from '../../../i18n'
import { HelpLink } from '../../../help'
import { isChanged, isClean, isForeign, isOpen, sentToday } from '../counts'
import { openSlip, useOutboxCounts, useSlips } from '../hooks'
import { focusSlipEl, onOutboxKey } from '../keys'
import { useOutbox } from '../store'
import { slipText } from '../text'
import { handArgs } from './HandPlate'
import { ForeignMark, Lid, OriginChip, Quote, ServerTag, Shown, ToolTarget, clock, shownText } from './parts'
import { ReceiptStrip } from './ReceiptStrip'
import { RoutesPanel } from './RoutesPanel'
import { ReceiptCard } from './ReceiptCard'
import { runRedraft } from './Slip'
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
  const stored = order.includes(focusId ?? '') ? focusId : null
  /** The card the keys act on: the one holding the focus, else the one J / K last went to (if shown). */
  const targetOf = (e: KeyboardEvent<HTMLElement>): string | null => {
    const id = (e.target as HTMLElement | null)?.closest?.('[data-slip]')?.getAttribute('data-slip') ?? null
    return id && order.includes(id) ? id : stored
  }
  /** After a card went (withdrawn): the next card, else the bin's heading. */
  const afterGone = (id: string) => {
    const i = order.indexOf(id)
    const next = order[i + 1] ?? order[i - 1]
    if (next) {
      useOutbox.setState({ focus: next })
      focusSlipEl(next)
    } else requestAnimationFrame(() => document.querySelector<HTMLElement>('#obx-bin-a')?.focus())
  }

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
      onKeyDown={(e) => {
        const focus = targetOf(e)
        onOutboxKey(e, {
          order,
          focus,
          setFocus: (id) => useOutbox.setState({ focus: id }),
          edit: () => focus && openSlip(focus),
          redraft: () => {
            const s = all.find((x) => x.id === focus)
            if (s?.draft && s.draft.by !== 'person') void runRedraft(s, setBusy)
          },
          // a card shows its text clipped: ⌘↵ opens the slip in its dock, where the text is read and copied
          copy: () => focus && openSlip(focus),
        })
      }}
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
              <h2 className="obx-bin__head label" id="obx-bin-a" tabIndex={-1}>
                {t('features.outbox.bin.clean')}
                <span className="obx-bin__rule" aria-hidden />
              </h2>
              <div className="obx-cards">
                {binA.map((s) => (
                  <Card key={s.id} slip={s} focused={s.id === stored} lang={lang} onGone={afterGone} />
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
                    <Card key={s.id} slip={s} focused={s.id === stored} lang={lang} onGone={afterGone} />
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

type ReasonKind = 'foreign' | 'hidden' | 'unclear' | 'held' | 'changed' | 'missing' | 'incomplete'
interface Reason {
  kind: ReasonKind
  text: string
  quote?: string
}

/**
 * Why a slip stays in bin B. Each reason has its kind (and its colour): red only for foreign text, addresses, hidden
 * characters and UNCLEAR; the signal colour for held and changed; plain ink for a missing text or unknown sources.
 */
function reasons(s: Slip, t: (k: string, v?: Record<string, string | number>) => string, lang: 'en' | 'de'): Reason[] {
  const out: Reason[] = []
  if (s.state === 'unclear') out.push({ kind: 'unclear', text: t('features.outbox.reason.unclear') })
  if (s.state === 'held') {
    const at = [...s.log].reverse().find((l) => l.code === 'held')?.at ?? s.updatedAt
    const latest = s.lastCheck?.latest
    out.push({ kind: 'held', text: t('features.outbox.reason.held', { time: clock(at, lang) }), ...(latest ? { quote: latest.length > 60 ? `${latest.slice(0, 60)}…` : latest } : {}) })
  }
  if (s.state === 'missing') out.push({ kind: 'missing', text: t('features.outbox.reason.missing') })
  if (isChanged(s)) out.push({ kind: 'changed', text: t('features.outbox.reason.changed') })
  for (const a of s.seal.addresses) {
    if (a.ticked) continue
    if (a.only === 'foreign') out.push({ kind: 'foreign', text: t('features.outbox.addr.foreign', { source: a.source ?? '' }) })
    else out.push({ kind: a.only === 'internal' ? 'incomplete' : 'foreign', text: `${t(`features.outbox.addr.${a.only}`)}: ${a.text}` })
  }
  if (s.seal.hidden.length) out.push({ kind: 'hidden', text: t('features.outbox.reason.hidden') })
  if (!out.length && s.seal.foreign) out.push({ kind: 'foreign', text: t('features.outbox.reason.foreignText', { labels: s.sources.filter((x) => !x.trusted && !x.typed).slice(0, 2).map((x) => x.label).join(', ') }) })
  if (!out.length && !s.seal.complete) out.push({ kind: 'incomplete', text: t('features.outbox.reason.incomplete') })
  return out
}

/** The pre-read line: the field the slip read — as a change when the mirror moved it since, else as read at draft time. */
function CheckLine({ slip, lang }: { slip: Slip; lang: 'en' | 'de' }) {
  const t = useT()
  const b = slip.baseline
  if (!b) return null
  const checks = Object.entries(b.fields).filter(([k]) => k === 'srcStatus' || k === 'comments')
  const check = checks.find(([k]) => slip.sources.some((s) => s.label === b.labels?.[k])) ?? checks[0]
  if (!check) return null
  const [field, value] = check
  const change = slip.lastCheck?.changed.find((c) => c.field === field)
  return (
    <p className="obx-checkline">
      <span className="label">{change && slip.lastCheck ? t('features.outbox.line.checked', { time: clock(slip.lastCheck.at, lang) }) : t('features.outbox.line.read', { time: clock(b.at, lang) })}</span>
      <span className="obx-checkline__sep" aria-hidden>
        ·
      </span>
      <span className="obx-checkline__v">
        <b>
          <Shown text={b.labels?.[field] ?? field} />
        </b>{' '}
        ={' '}
        {change ? (
          <>
            <Shown text={change.before || '—'} /> → <Shown text={change.now || '—'} />
          </>
        ) : (
          <Shown text={value || '—'} />
        )}
      </span>
    </p>
  )
}

function Card({ slip, focused, lang, onGone }: { slip: Slip; focused: boolean; lang: 'en' | 'de'; onGone: (id: string) => void }) {
  const t = useT()
  const clean = isClean(slip)
  const foreign = isForeign(slip)
  const text = slipText(slip)
  const why = clean ? [] : reasons(slip, t, lang)
  const args = handArgs(slip)
  const comment = slip.sources.find((s) => s.role === 'comment' && !s.trusted && !s.typed) ?? slip.sources.find((s) => !s.trusted && !s.typed)
  return (
    <article
      className="obx-card"
      data-foreign={foreign || undefined}
      data-clean={clean || undefined}
      data-slip={slip.id}
      data-current={focused || undefined}
      tabIndex={-1}
      data-testid="outbox-card"
      aria-labelledby={`obx-c-${slip.id}`}
      onFocus={() => useOutbox.getState().focus !== slip.id && useOutbox.setState({ focus: slip.id })}
    >
      <div className="obx-slip__head">
        <ServerTag name={slip.target.serverName} />
        <ToolTarget slip={slip} />
      </div>
      <h3 className="obx-card__title" id={`obx-c-${slip.id}`}>
        <button type="button" className="obx-card__open" onClick={() => openSlip(slip.id)} title={shownText(slip.title)}>
          <Shown text={slip.title} />
        </button>
      </h3>
      {text && (
        <p className="obx-card__text">
          <Quote text={text} />
        </p>
      )}
      <div className="obx-card__meta">
        <OriginChip slip={slip} lang={lang} />
      </div>
      <CheckLine slip={slip} lang={lang} />
      {why.length > 0 && (
        <ul className="obx-card__why">
          {why.map((w, i) => (
            <li key={`${w.kind}${i}`} data-kind={w.kind}>
              {(w.kind === 'foreign' || w.kind === 'hidden' || w.kind === 'unclear') && <ForeignMark />}
              {(w.kind === 'held' || w.kind === 'changed') && <span className="led led--on" aria-hidden />}
              <span>
                <Shown text={w.text} />
                {w.quote && (
                  <>
                    {' · '}
                    <Quote text={w.quote} />
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="obx-card__foot">
        {foreign ? (
          <span className="obx-card__fword label" title={comment ? shownText(comment.label) : undefined}>
            <ForeignMark /> {t('features.outbox.src.foreign')}
            {comment ? (
              <>
                {' · '}
                <Shown text={comment.label} />
              </>
            ) : null}
          </span>
        ) : (
          <span className="obx-argline" title={shownText(args)}>
            <Shown text={args} />
          </span>
        )}
        <span className="obx-sp" />
        {!clean && slip.state !== 'unclear' && (
          <button
            type="button"
            className="icon-btn icon-btn--sm"
            aria-label={shownText(`${t('features.outbox.act.withdraw')}: ${slip.title}`)}
            onClick={async () => {
              if ((await withdrawSlip(slip.id, 'person')) !== 'withdrawn') return
              useUI.getState().toast({ message: translate('features.outbox.act.withdrawn') })
              onGone(slip.id)
            }}
            data-testid="outbox-card-withdraw"
          >
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
            <ListTree size={14} aria-hidden />
          </span>
          {t('features.outbox.from.command')}
        </li>
      </ul>
      <p>{t('features.outbox.from.footer')}</p>
    </aside>
  )
}
