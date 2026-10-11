/**
 * The deck — the flight recorder's plate at the bottom of the content column (in flow under the page, never under
 * the sidebar; a panel under the page on phones). Head row; the 24 h strip; the track labels and the tape; the window
 * plate. It measures its own width (data-tier: the body's layout; the head fits itself), publishes its height for the toasts
 * (--deck-dock), takes focus on the playhead when opened and gives it back when closed. Esc closes it (after any
 * popover) and the playhead goes back to now.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLang, useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { Screws } from '../../../ui/controls'
import { closeHelp, useHelp } from '../../../help'
import { loupeK as kOf, makeAxis, ZOOM, type Zone } from '../model/axis'
import type { LaneKey } from '../model/types'
import { useSpan } from './clock'
import { useDeckData } from './data'
import { DeckHead } from './DeckHead'
import { fmtDayShort, hm } from './format'
import { daysRecorded, recorderMode, useTapeInfoLive } from './info'
import { laneMeta, sortLanes, visibleLanes, type LaneMeta } from './lanes'
import { laneCount } from './Lane'
import { LaneLabels } from './LaneLabels'
import { Strip } from './Strip'
import { Tape } from './Tape'
import { closeRecorder, HEIGHT_MIN, setDeckHeight, takeOpener, useRecorderUI } from './state'
import { canFocus, focusLost, focusMainRegion, focusNear, restoreFocus } from '../../../ui/focus'
import { useLive } from './live'
import { WindowPlate } from './WindowPlate'
import './recorder.css'

const PHONE = '(max-width: 767px)'

function usePhone(): boolean {
  const [on, setOn] = useState(() => !!window.matchMedia?.(PHONE).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(PHONE)
    if (!mq) return
    const fn = () => setOn(mq.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  return on
}

/**
 * The deck's body by its width (§ 8.7), counted in standard-size pixels (a larger text size needs more room): below
 * 960 the labels narrow and the plate goes under the tape ('s'). The head fits itself (DeckHead: what it sheds is
 * measured, never guessed from the width).
 */
function tierOf(w: number, el: Element): string {
  const scale = Number(getComputedStyle(el).getPropertyValue('--text-scale')) || 1
  return w / scale >= 960 ? 'xl' : 's'
}

export default function Deck() {
  const t = useT()
  const lang = useLang()
  const [host] = useState<HTMLElement | null>(() => document.querySelector<HTMLElement>('.app-main'))
  const rootRef = useRef<HTMLElement>(null)
  const phone = usePhone()
  const [tier, setTier] = useState('xl')
  const [width, setWidth] = useState(0)
  useDeckData()
  const span = useSpan()
  const zoom = useRecorderUI((s) => s.span.zoom)
  const playhead = useRecorderUI((s) => s.playhead)
  const bracket = useRecorderUI((s) => s.bracket)
  const loupe = useRecorderUI((s) => s.loupe)
  const frozen = useRecorderUI((s) => s.axisFrozen)
  const filter = useRecorderUI((s) => s.filter)
  const focusLane = useRecorderUI((s) => s.focusLane)
  const ops = useRecorderUI((s) => s.ops)
  const strip = useRecorderUI((s) => s.strip)
  const hist = useRecorderUI((s) => s.hist)
  const known = useRecorderUI((s) => s.known)
  const height = useRecorderUI((s) => s.height)
  const focusTick = useRecorderUI((s) => s.focusTick)
  const { info } = useTapeInfoLive()
  const agents = useWorkspace((s) => s.agents)
  const scripts = useWorkspace((s) => s.scripts)
  const databases = useWorkspace((s) => s.databases)
  const settings = useWorkspace((s) => s.settings)

  // the loupe: the window gets up to 6× the room (frozen while a drag runs)
  const spanLen = ZOOM[zoom].span
  const zone: Zone | null = useMemo(() => {
    if (frozen) return frozen.k > 1 ? { a: frozen.zone[0], b: frozen.zone[1], k: frozen.k } : null
    if (!bracket || !loupe || !ZOOM[zoom].loupe) return null
    return { a: bracket.a, b: bracket.b, k: kOf(spanLen, bracket.b - bracket.a) }
  }, [frozen, bracket, loupe, zoom, spanLen])
  const ax = useMemo(() => makeAxis(span.t0, span.t1, zone), [span.t0, span.t1, zone])
  const loupeK = bracket && ZOOM[zoom].loupe && bracket.b > span.t0 && bracket.a < span.t1 ? kOf(spanLen, bracket.b - bracket.a) : null

  // the tracks shown, in the tape's order, with their counts in the span
  const histLanes = (zoom === '24h' || ops.interim) && hist ? hist.lanes : null
  // a lane's meta keeps its identity while its names stay (a push must not re-render the other lanes)
  const metaCache = useRef(new Map<LaneKey, LaneMeta>())
  const lanes = useMemo(() => {
    const withOps: LaneKey[] = []
    const src = histLanes ?? ops.lanes
    for (const [l, list] of Object.entries(src)) if (laneCount(histLanes ? undefined : (list as never), histLanes ? (list as never) : undefined, span.t0, span.t1) > 0) withOps.push(l)
    const ws = { agents, scripts, databases, settings }
    const metas = visibleLanes(withOps, bracket?.lane ?? null, filter).map((l) => {
      const m = laneMeta(l, t, ws)
      const old = metaCache.current.get(l)
      if (old && old.title === m.title && old.short === m.short && old.icon === m.icon) return old
      metaCache.current.set(l, m)
      return m
    })
    return sortLanes(metas)
  }, [histLanes, ops.lanes, span.t0, span.t1, bracket?.lane, filter, agents, scripts, databases, settings, t])
  const counts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const m of lanes) out[m.lane] = laneCount(histLanes ? undefined : ops.lanes[m.lane], histLanes ? (histLanes[m.lane] ?? []) : undefined, span.t0, span.t1)
    return out
  }, [lanes, histLanes, ops.lanes, span.t0, span.t1])
  const knownAll = useMemo(() => [...new Set(['you', ...known, ...lanes.map((l) => l.lane)])].filter((l) => l !== 'system'), [known, lanes])
  const bracketMeta = bracket ? (lanes.find((l) => l.lane === bracket.lane) ?? laneMeta(bracket.lane, t, { agents, scripts, databases, settings })) : null
  // the track the window's edge keys act on: the focused one, else the window's, else "you"
  const edgeLane = [focusLane, bracket?.lane].find((l): l is string => !!l && lanes.some((m) => m.lane === l)) ?? 'you'
  const edgeMeta = lanes.find((l) => l.lane === edgeLane) ?? laneMeta(edgeLane, t, { agents, scripts, databases, settings })

  const mode = recorderMode()
  const notes: string[] = []
  if (mode.memory) notes.push(t('features.recorder.deck.memoryOnly'))
  if (mode.paused) notes.push(t('features.recorder.deck.paused'))
  if (info?.floor && info.floor > span.t0) notes.push(t('features.recorder.deck.floor', { date: fmtDayShort(t, lang, info.floor) }))
  const gaps = useRecorderUI((s) => s.gaps)
  const lost = gaps.filter((g) => g.to > span.t0 && g.from < span.t1)
  for (const g of lost) notes.push(t('features.recorder.deck.lostTailTitle', { from: hm(g.from), to: hm(g.to) }))

  // width tiers
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const measure = () => {
      const w = el.getBoundingClientRect().width
      setTier(tierOf(w, el))
      setWidth(Math.round(w))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // toasts clear the deck
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const root = document.documentElement
    const publish = () => root.style.setProperty('--deck-dock', `${el.getBoundingClientRect().height}px`)
    publish()
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    return () => {
      ro.disconnect()
      root.style.removeProperty('--deck-dock')
    }
  }, [])

  // focus: the playhead on open (and when asked again); on close back to the opener — the key handed over by a menu
  // or ⌘K, else what had focus — or a key near it, else the main region (never the page body). Focus somebody else
  // took meanwhile (the AI terminal opening) stays there.
  useEffect(() => {
    const prev = takeOpener()
    return () => {
      if (!focusLost()) return
      if (canFocus(prev)) {
        restoreFocus(prev)
        if (!focusLost()) return
      }
      if (prev && focusNear(prev)) return
      focusMainRegion()
    }
  }, [])
  useEffect(() => {
    const id = requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>('.playhead__h')?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(id)
  }, [focusTick])

  // open → first paint of the data (a dense span: its minutes); `rec-ops` when the span's ops are drawn
  const marked = useRef(false)
  const markedOps = useRef(false)
  useEffect(() => {
    if (ops.status !== 'ready') return
    const first = !marked.current
    const exact = !markedOps.current && !ops.interim
    if (!first && !exact) return
    marked.current = true
    if (exact) markedOps.current = true
    requestAnimationFrame(() => {
      try {
        if (first) {
          performance.mark('rec-ready')
          performance.measure('rec-open', 'rec-open', 'rec-ready')
        }
        if (exact) {
          performance.mark('rec-ops-ready')
          performance.measure('rec-ops', 'rec-open', 'rec-ops-ready')
        }
      } catch {
        /* no marks */
      }
    })
  }, [ops.status, ops.interim])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.nativeEvent.isComposing) return
    // a popover or a dialog takes Esc first: the Help sheet opened from the deck's "?" closes, the deck stays
    if (document.querySelector('[data-popover], [aria-modal="true"]')) return
    e.preventDefault()
    e.stopPropagation()
    if (useHelp.getState().open) {
      closeHelp()
      return
    }
    closeRecorder()
  }

  const empty = ops.status === 'ready' && !lanes.some((l) => (counts[l.lane] ?? 0) > 0)
  const body = (
    <section
      ref={rootRef}
      className={`deck${host ? '' : ' deck--float'}`}
      aria-labelledby="deck-title"
      data-tier={tier}
      data-phone={phone || undefined}
      style={{ ['--deck-h' as string]: `${height}px` }}
      onKeyDown={onKeyDown}
    >
      <Screws seed="recorder-deck" />
      <Grip fixed={phone || tier === 's'} phone={phone} />
      <Live />
      <DeckHead width={width} phone={phone} loupeK={loupeK} knownLanes={knownAll} days={daysRecorded(info)} />
      <div className="deck__body">
        <div className="ov-l">
          <span className="label">{t('features.recorder.deck.strip')}</span>
        </div>
        <Strip span={span} counts={strip?.counts ?? null} q0={strip?.q0 ?? null} bracket={bracket} />
        <WindowPlate bracket={bracket} meta={bracketMeta} run={bracket?.run ? ops.runs[bracket.run] : undefined} notes={notes} touch={phone} edgeLane={edgeMeta} />
        <div className="deck__tracks">
          <LaneLabels lanes={lanes} counts={counts} day={playhead ?? span.t1 - 1} selected={bracket?.lane ?? null} />
          <Tape
            lanes={lanes}
            laneOps={ops.lanes}
            hist={histLanes}
            runs={ops.runs}
            ax={ax}
            zoom={zoom}
            bracket={bracket}
            playhead={playhead}
            focusLane={focusLane}
            phone={phone}
            now={Math.min(Math.floor(Date.now() / 60_000) * 60_000, span.t1)}
            empty={empty}
            gaps={lost}
          />
        </div>
      </div>
    </section>
  )
  return createPortal(body, host ?? document.body)
}

/** What a jump did, said politely (§ 8.9; ui/live.ts). */
function Live() {
  const live = useLive()
  return (
    <div className="rec-live" aria-live="polite" aria-atomic="true">
      {live.text ? <span key={live.n}>{live.text}</span> : null}
    </div>
  )
}

/** The deck's height as it is drawn: the pref, never taller than 55 % of the window (recorder.css). */
const DECK_MAX = 0.55

/**
 * The top edge: drag (↑ / ↓ on it, Shift = bigger steps) to change the height, within what the deck can be (220 px –
 * 55vh); it reports the height drawn. `fixed` (a phone, a narrow deck as tall as its content): no height to set — on a
 * phone a drag down closes the deck.
 */
function Grip({ fixed, phone }: { fixed: boolean; phone: boolean }) {
  const t = useT()
  const pref = useRecorderUI((s) => s.height)
  const [drag, setDrag] = useState(false)
  const max = () => Math.max(HEIGHT_MIN, Math.round(window.innerHeight * DECK_MAX))
  const height = Math.min(pref, max())

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const y0 = e.clientY
    const h0 = (el.closest('.deck') as HTMLElement | null)?.getBoundingClientRect().height ?? height
    setDrag(true)
    const move = (ev: PointerEvent) => {
      if (fixed) return
      useRecorderUI.setState({ height: Math.max(HEIGHT_MIN, Math.min(max(), Math.round(h0 + (y0 - ev.clientY)))) })
    }
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      setDrag(false)
      if (phone && ev.type === 'pointerup' && ev.clientY - y0 > 80) closeRecorder()
      if (fixed) return
      setDeckHeight(useRecorderUI.getState().height)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  return (
    <div
      className="deck__grip"
      role="separator"
      aria-orientation="horizontal"
      aria-label={t('features.recorder.deck.resize')}
      aria-valuemin={HEIGHT_MIN}
      aria-valuemax={max()}
      aria-valuenow={height}
      aria-hidden={fixed || undefined}
      tabIndex={fixed ? -1 : 0}
      data-drag={drag || undefined}
      onPointerDown={onPointerDown}
      onKeyDown={(e) => {
        if (fixed || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
        e.preventDefault()
        e.stopPropagation()
        const step = e.shiftKey ? 40 : 10
        setDeckHeight(Math.max(HEIGHT_MIN, Math.min(max(), height + (e.key === 'ArrowUp' ? step : -step))))
      }}
    />
  )
}
