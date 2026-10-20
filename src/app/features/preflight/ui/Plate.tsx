/**
 * The full plate (§8.1): a screwed placard with the head line (§ 00 — PREFLIGHT · day · time ── n lamps · lamp test ·
 * cost 0 tokens · ⋯), the housing of caps (a 2-D roving group, keys only with focus inside), the master column
 * (MASTER CAUTION, the read-out, the key hints) and the foot legend of the states.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { ChevronUp, CircleHelp, Eye, MoreHorizontal, Settings2 } from 'lucide-react'
import { useLang, useT } from '../../../i18n'
import { useUI } from '../../../store/ui'
import { Screws } from '../../../ui/controls'
import { Menu, useMenu } from '../../../ui/Menu'
import { openHelp } from '../../../help'
import { lampSource } from '../registry'
import { ackLamps, blinkStartAt, fold, noteRender, runLampTest, setHidden } from '../engine'
import { writeHidden } from '../prefs'
import { isLit } from '../lamps'
import { fmtDay, fmtTime } from '../format'
import { usePreflight } from '../state'
import { useQueue } from '../queue/state'
import { CAP_SELECTOR, onPlateKey } from '../queue/keys'
import { useCoarsePointer } from '../touch'
import { useLog } from '../log'
import type { PreflightLog } from '../types'
import { tn } from '../sources/util'
import type { LampView } from '../types'
import { Cap } from './Cap'
import { GuardedMasters } from './GuardedMasters'
import '../annunciator.css'

/** The first tab stop: the first new lamp, else the first lit, else the first. */
export function firstStop(views: readonly LampView[]): number {
  const n = views.findIndex((v) => v.isNew)
  if (n >= 0) return n
  const l = views.findIndex((v) => isLit(v.level))
  return l >= 0 ? l : 0
}

/**
 * What ↵ / a click on a cap does: lit → acknowledge + its queue tab (the card takes the keyboard; a lamp without a queue:
 * its screen); grey → its fix, else the rule; dark → the rule.
 */
export function activateLamp(v: LampView): void {
  const src = lampSource(v.id)
  if (isLit(v.level)) {
    ackLamps([v.id])
    if (src?.queue) useQueue.setState({ lamp: v.id, aside: v.id, overflow: false, pendingFocus: 'card', confirm: null, input: null, bulk: null })
    else {
      useQueue.setState({ aside: v.id })
      src?.open?.()
    }
    return
  }
  if (v.level === 'grey' && src?.fix) {
    // the browser asks for permission (a folder, a popup): it must start inside this key press
    void Promise.resolve(src.fix.run()).catch((e) => console.warn('[one] preflight: a fix failed', e))
  }
  useQueue.setState({ aside: v.id, overflow: false })
}

/** Show every lamp hidden on this device again. */
function showHiddenLamps(): void {
  const scope = usePreflight.getState().scope
  if (!scope) return
  writeHidden(scope, [])
  setHidden(new Set())
}

export function PlateHead({ strip, onTest }: { strip?: boolean; onTest?: () => void }) {
  const t = useT()
  const lang = useLang()
  const views = usePreflight((s) => s.views)
  const lastChange = usePreflight((s) => s.lastChange)
  const test = usePreflight((s) => s.today.test)
  const hidden = usePreflight((s) => s.hidden)
  const overflow = usePreflight((s) => s.overflow)
  const menu = useMenu()
  const now = Date.now()
  const dark = views.filter((v) => v.level === 'dark').length
  const grey = views.filter((v) => v.level === 'grey').length
  const lamps = tn('features.preflight.head.lamps', views.length)
  const parts = strip
    ? [lamps, ...(dark ? [t('features.preflight.head.dark', { n: dark })] : []), ...(grey ? [t('features.preflight.head.grey', { n: grey })] : [])]
    : [lamps, ...(test === 'ran' ? [t('features.preflight.head.testOk')] : test ? [t('features.preflight.head.testOff')] : [])]
  if (hidden) parts.push(t('features.preflight.head.hidden', { n: hidden }))
  return (
    <div className="pf__head">
      {/* the name never cuts; the day gives way first, the time last (each its own text, cut with "…") */}
      <span className="label pf__name">
        <span className="pf__no">§ 00</span> — <span className="pf__title">{t('features.preflight.title')}</span>
      </span>
      <span className="label pf__cut pf__day pf-hide-s">· {fmtDay(now, lang)}</span>
      {lastChange ? <span className="label pf__time">· {fmtTime(lastChange)}</span> : null}
      <span className="pf__rule" aria-hidden />
      <span className="label pf-hide-s pf__cut">{parts.join(' · ')}</span>
      {overflow.length > 0 && (
        <button
          type="button"
          className="label pf__over"
          title={t('features.preflight.head.overflowTitle')}
          aria-label={t('features.preflight.head.overflow', { n: overflow.length })}
          onClick={() => useQueue.setState({ overflow: true, aside: null })}
        >
          {/* narrow: only "+n" (the rule card names them) */}
          <span className="pf__over-long">{t('features.preflight.head.overflow', { n: overflow.length })}</span>
          <span className="pf__over-short">+{overflow.length}</span>
        </button>
      )}
      <span className="label pf__cost">
        <span className="pf-hide-s">{t('features.preflight.head.cost')} </span>
        <b>{t('features.preflight.unit.tokens', { n: 0 })}</b>
      </span>
      {onTest && <button type="button" className="label pf__test" onClick={onTest}>{t('features.preflight.guard.test')}</button>}
      {!strip && (
        <>
          <button type="button" className="pf__icon-btn" aria-label={t('features.preflight.head.menu')} aria-haspopup="menu" aria-expanded={menu.open} onClick={menu.toggle}>
            <MoreHorizontal size={15} aria-hidden />
          </button>
          <Menu
            {...menu.props}
            placement="bottom-end"
            entries={[
              { label: t('features.preflight.head.fold'), icon: <ChevronUp size={14} />, onSelect: () => fold() },
              ...(hidden ? [{ label: t('features.preflight.head.showHidden', { n: hidden }), icon: <Eye size={14} />, onSelect: () => showHiddenLamps() }] : []),
              { label: t('features.preflight.head.settings'), icon: <Settings2 size={14} />, onSelect: () => useUI.getState().openModal({ type: 'settings', tab: 'appearance' }) },
              { label: t('features.preflight.head.help'), icon: <CircleHelp size={14} />, onSelect: () => openHelp('preflight') },
            ]}
          />
        </>
      )}
    </div>
  )
}

function ReadOut() {
  const t = useT()
  const open = usePreflight((s) => s.open)
  const ackedAt = usePreflight((s) => s.ackedAt)
  const events = useLog((s) => s.events)
  const pace = useLog((s) => s.pace)
  // this device's pace from the Bordbuch (median seconds per card, 30 days), else ≈ 45 s a card
  const minutes = Math.max(1, Math.round((open * (pace ?? 45)) / 60))
  const today = doneToday(events)
  return (
    <dl className="pf__read" aria-label={t('features.preflight.read.aria')}>
      <dt className="label">{t('features.preflight.read.open')}</dt>
      <dd>
        <b>{open}</b>
        {open > 0 ? ` · ${t('features.preflight.unit.minApprox', { n: minutes })}` : ''}
      </dd>
      <dt className="label">{t('features.preflight.read.done')}</dt>
      <dd>{today.n ? t('features.preflight.read.doneSince', { n: today.n, time: fmtTime(today.since!) }) : t('features.preflight.read.none')}</dd>
      <dt className="label pf-hide-s">{t('features.preflight.read.acked')}</dt>
      <dd className="pf-hide-s">{ackedAt ? t('features.preflight.read.ackedAt', { time: fmtTime(ackedAt) }) : t('features.preflight.read.none')}</dd>
    </dl>
  )
}

/** Cards done today (this member, this device): card events less the ones taken back; since the first. */
export function doneToday(events: readonly PreflightLog[]): { n: number; since: number | null } {
  const undone = new Set(events.filter((e) => e.k === 'undo').map((e) => (e as { item: string }).item))
  const cards = events.filter((e): e is Extract<PreflightLog, { k: 'card' }> => e.k === 'card' && !undone.has(e.item))
  return { n: cards.length, since: cards.length ? Math.min(...cards.map((c) => c.at)) : null }
}

export function StateLegend() {
  const t = useT()
  return (
    <ul className="pf__foot" aria-label={t('features.preflight.state.legend')}>
      <li className="label">
        <span className="pf-sw pf-sw--amber" aria-hidden />
        <span className="pf-chip" aria-hidden>
          +n
        </span>
        {t('features.preflight.state.flash')}
      </li>
      <li className="label">
        <span className="pf-sw pf-sw--amber" aria-hidden />
        {t('features.preflight.state.steady')}
      </li>
      <li className="label">
        <span className="pf-sw pf-sw--red" aria-hidden>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
          </svg>
        </span>
        {t('features.preflight.state.red')}
      </li>
      <li className="label">
        <span className="pf-sw pf-sw--dark" aria-hidden />
        {t('features.preflight.state.dark')}
      </li>
      <li className="label">
        <span className="pf-sw pf-sw--grey" aria-hidden />
        {t('features.preflight.state.grey')}
      </li>
    </ul>
  )
}

export function Plate({ views, busy }: { views: LampView[]; busy: boolean }) {
  noteRender('plate')
  const t = useT()
  const hintId = useId()
  const coarse = useCoarsePointer()
  const testing = usePreflight((s) => s.testing)
  const ready = usePreflight((s) => s.ready)
  // the lamp cursor (one ink double ring): the cap the aside describes — the one holding focus in the plate, else the
  // lamp picked (an open queue's lamp is marked by its "↵ i/n" badge besides)
  const ringed = useQueue((s) => s.cursor ?? s.aside)
  const pendingFocus = useQueue((s) => s.pendingFocus)
  const openLamp = useQueue((s) => s.lamp)
  const openPos = useQueue((s) => {
    const tab = s.lamp
    if (!tab || tab === 'all') return null
    const order = s.order[tab] ?? []
    const cur = s.card[tab]
    return order.length ? `${cur ? order.indexOf(cur) + 1 : 0}/${order.length}` : null
  })
  const grid = useRef<HTMLDivElement>(null)
  const [stop, setStop] = useState(() => firstStop(views))
  const at = Math.min(stop, Math.max(0, views.length - 1))
  // new lamps blink in unison after the lamp test — planned before the caps render (the test runs in the layout effect)
  const flashAt = busy || !ready ? 0 : blinkStartAt(views.filter((v) => isLit(v.level)).length)

  // the day's lamp test, on the first full render once counted (never on "…" placeholders)
  useLayoutEffect(() => {
    if (busy || !ready) return
    runLampTest(grid.current)
  }, [busy, ready])

  // ⌘K "Preflight" / MASTER CAUTION with nothing new: focus the first tab stop
  useEffect(() => {
    if (pendingFocus !== 'plate' || busy) return
    useQueue.setState({ pendingFocus: null })
    const s = firstStop(views)
    setStop(s)
    grid.current?.querySelectorAll<HTMLElement>(CAP_SELECTOR)[s]?.focus()
  }, [pendingFocus, busy, views])

  const next = useCallback(
    (from: number): number | null => {
      const n = views.length
      const pick = (ok: (v: LampView) => boolean) => {
        for (let k = 1; k <= n; k++) {
          const i = (((from < 0 ? -1 : from) + k) % n + n) % n
          if (ok(views[i])) return i
        }
        return null
      }
      return pick((v) => v.isNew) ?? pick((v) => isLit(v.level))
    },
    [views],
  )

  const viewsRef = useRef(views)
  viewsRef.current = views
  const onCapFocus = useCallback((view: LampView) => {
    setStop(viewsRef.current.findIndex((v) => v.id === view.id))
    useQueue.setState({ cursor: view.id })
  }, [])

  const onKey = (e: React.KeyboardEvent<HTMLElement>) => {
    const i = onPlateKey(e, next)
    if (i !== null) setStop(i)
  }

  return (
    <section
      className="pf"
      aria-label={t('features.preflight.title')}
      data-mode="full"
      data-testid="pf-plate"
      onKeyDown={onKey}
      onKeyUp={onKey}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) useQueue.setState({ cursor: null })
      }}
    >
      <PlateHead onTest={() => runLampTest(grid.current, true)} />
      <div className="pf__body screw-plate">
        <Screws seed="preflight" />
        <div ref={grid} className="pf__grid" role="group" aria-label={t('features.preflight.plate.grid')} aria-describedby={hintId} data-grid="" data-test={testing === 'phase1' ? '1' : testing === 'phase2' ? '2' : undefined}>
          {views.map((v, i) => (
            <Cap
              key={v.id}
              view={v}
              busy={busy}
              tabStop={i === at}
              cursor={ringed === v.id}
              // the open badge only on a lamp still lit (the last card gone: it went dark)
              open={openLamp === v.id && openPos && isLit(v.level) ? openPos : null}
              flashAt={flashAt}
              onActivate={activateLamp}
              onFocus={onCapFocus}
            />
          ))}
        </div>
        <span id={hintId} className="visually-hidden">
          {t('features.preflight.plate.keysHint')}
        </span>
        <div className="pf__master">
          <GuardedMasters />
          <ReadOut />
          {!coarse && (
            <div className="pf__keys">
              <span>
                <span className="kbd">␣</span>
                {t('features.preflight.keys.next')}
              </span>
              <span>
                <span className="kbd">↵</span>
                {t('features.preflight.keys.queue')}
              </span>
              <span className="label">{t('features.preflight.keys.focusOnly')}</span>
            </div>
          )}
        </div>
      </div>
      <StateLegend />
    </section>
  )
}
