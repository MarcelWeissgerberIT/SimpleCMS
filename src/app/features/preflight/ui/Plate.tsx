/**
 * The full plate (§8.1): a screwed placard with the head line (§ 00 — PREFLIGHT · day · time ── n lamps · lamp test ·
 * cost 0 tokens · ⋯), the housing of caps (a 2-D roving group, keys only with focus inside), the master column
 * (MASTER CAUTION, the read-out, the key hints) and the foot legend of the states.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { ChevronUp, MoreHorizontal, Settings2 } from 'lucide-react'
import { useLang, useT } from '../../../i18n'
import { useUI } from '../../../store/ui'
import { Screws } from '../../../ui/controls'
import { Menu, useMenu } from '../../../ui/Menu'
import { lampSource } from '../registry'
import { ackLamps, fold, noteRender, runLampTest } from '../engine'
import { isLit } from '../lamps'
import { fmtDay, fmtTime } from '../format'
import { usePreflight } from '../state'
import { useQueue } from '../queue/state'
import { CAP_SELECTOR, onPlateKey } from '../queue/keys'
import { useCoarsePointer } from '../touch'
import { tn } from '../sources/util'
import type { LampView } from '../types'
import { Cap } from './Cap'
import { MasterKey } from './MasterCaution'

/** The first tab stop: the first new lamp, else the first lit, else the first. */
export function firstStop(views: readonly LampView[]): number {
  const n = views.findIndex((v) => v.isNew)
  if (n >= 0) return n
  const l = views.findIndex((v) => isLit(v.level))
  return l >= 0 ? l : 0
}

/** What ↵ / a click on a cap does (P1): lit → acknowledge + its screen; grey → its fix, else the rule; dark → the rule. */
export function activateLamp(v: LampView): void {
  const src = lampSource(v.id)
  if (isLit(v.level)) {
    ackLamps([v.id])
    useQueue.setState({ aside: v.id })
    src?.open?.()
    return
  }
  if (v.level === 'grey' && src?.fix) {
    // the browser asks for permission (a folder, a popup): it must start inside this key press
    void Promise.resolve(src.fix.run()).catch((e) => console.warn('[one] preflight: a fix failed', e))
  }
  useQueue.setState({ aside: v.id, overflow: false })
}

export function PlateHead({ strip }: { strip?: boolean }) {
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
              { label: t('features.preflight.head.settings'), icon: <Settings2 size={14} />, onSelect: () => useUI.getState().openModal({ type: 'settings', tab: 'appearance' }) },
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
  // ≈ 45 s a card until the Bordbuch knows this device's pace (P2)
  const minutes = Math.max(1, Math.round((open * 45) / 60))
  return (
    <dl className="pf__read" aria-label={t('features.preflight.read.aria')}>
      <dt className="label">{t('features.preflight.read.open')}</dt>
      <dd>
        <b>{open}</b>
        {open > 0 ? ` · ${t('features.preflight.unit.minApprox', { n: minutes })}` : ''}
      </dd>
      <dt className="label">{t('features.preflight.read.done')}</dt>
      <dd>{t('features.preflight.read.none')}</dd>
      <dt className="label pf-hide-s">{t('features.preflight.read.acked')}</dt>
      <dd className="pf-hide-s">{ackedAt ? t('features.preflight.read.ackedAt', { time: fmtTime(ackedAt) }) : t('features.preflight.read.none')}</dd>
    </dl>
  )
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
  const aside = useQueue((s) => s.aside)
  const pendingFocus = useQueue((s) => s.pendingFocus)
  const grid = useRef<HTMLDivElement>(null)
  const [stop, setStop] = useState(() => firstStop(views))
  const [flashDelay, setFlashDelay] = useState(0)
  const at = Math.min(stop, Math.max(0, views.length - 1))

  // the day's lamp test, on the first full render once counted (never on "…" placeholders)
  useLayoutEffect(() => {
    if (busy || !ready) return
    const end = runLampTest(grid.current)
    if (end) setFlashDelay(end)
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
      className="pf screw-plate"
      aria-label={t('features.preflight.title')}
      data-mode="full"
      data-testid="pf-plate"
      onKeyDown={onKey}
      onKeyUp={onKey}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) useQueue.setState({ cursor: null })
      }}
    >
      <Screws seed="preflight" />
      <PlateHead />
      <div className="pf__body">
        <div ref={grid} className="pf__grid" role="group" aria-label={t('features.preflight.plate.grid')} aria-describedby={hintId} data-grid="" data-test={testing === 'phase1' ? '1' : testing === 'phase2' ? '2' : undefined}>
          {views.map((v, i) => (
            <Cap
              key={v.id}
              view={v}
              busy={busy}
              tabStop={i === at}
              cursor={aside === v.id}
              flashDelay={flashDelay}
              onActivate={activateLamp}
              onFocus={onCapFocus}
            />
          ))}
        </div>
        <span id={hintId} className="visually-hidden">
          {t('features.preflight.plate.keysHint')}
        </span>
        <div className="pf__master">
          <MasterKey />
          <ReadOut />
          {!coarse && (
            <div className="pf__keys">
              <span>
                <span className="kbd">␣</span>
                {t('features.preflight.keys.next')}
              </span>
              <span>
                <span className="kbd">↵</span>
                {t('features.preflight.keys.open')}
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
