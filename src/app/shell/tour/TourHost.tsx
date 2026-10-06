/**
 * The guided tour's overlay (lazy — loads on the first start): a hairline frame around the real UI element of
 * the step (the rest dimmed, no blur; the page stays usable — the dim lets every click through) and a placard
 * pinned next to it ("Step 3 / 8", Back · Do it for me · Next, ← → Esc). Phones: the placard docks at the bottom.
 * Each step change is announced (aria-live); motion follows prefers-reduced-motion.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, Check, Compass, KeyRound, Trash2, X } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { navigate } from '../../lib/router'
import { shortcutLabel } from '../../ui/controls'
import { useT } from '../../i18n'
import { useIsMobile } from '../lib/hooks'
import { endTour, rememberTour, useTour, TOUR_STEP_COUNT } from './state'
import { TOUR_STEPS, isShown, type TourStep } from './steps'
import { liveTourPage, trashTourPage } from './tourPage'
import './tour.css'

const PAD = 6
const GAP = 14
const EDGE = 12

export default function TourHost() {
  const running = useTour((s) => s.running)
  return running ? createPortal(<Tour />, document.body) : null
}

type Box = { x: number; y: number; w: number; h: number }

function Tour() {
  const t = useT()
  const step = useTour((s) => s.step)
  const finished = useTour((s) => s.finished)
  const def = TOUR_STEPS[step] ?? TOUR_STEPS[0]
  const hasKey = useWorkspace((s) => !!s.settings.aiApiKey.trim())
  const mobile = useIsMobile()
  const [target, setTarget] = useState<Box | null>(null)
  const [busy, setBusy] = useState(false)
  const [did, setDid] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const placardRef = useRef<HTMLDivElement>(null)

  const go = useCallback((to: number) => {
    if (to < 0) return
    if (to >= TOUR_STEP_COUNT) {
      rememberTour({ done: true })
      useTour.setState({ finished: true })
      return
    }
    useTour.setState({ step: to, finished: false })
  }, [])
  const next = useCallback(() => (finished ? endTour() : go(step + 1)), [finished, go, step])
  const back = useCallback(() => (finished ? useTour.setState({ finished: false, step: TOUR_STEP_COUNT - 1 }) : go(step - 1)), [finished, go, step])

  // the step's place: entered on arrival, what it opened closed on the way out
  useEffect(() => {
    if (finished) return
    setDid(false)
    setNote(null)
    void Promise.resolve()
      .then(() => def.enter?.())
      .catch((e) => console.warn('[one] tour step failed to start', e))
    return () => {
      try {
        def.leave?.()
      } catch (e) {
        console.warn('[one] tour step failed to clean up', e)
      }
    }
  }, [def, finished])

  // the frame follows its element (it moves, opens, closes): measured every frame while the tour runs
  useEffect(() => {
    let raf = 0
    let last = 'init'
    const tick = () => {
      const box = finished ? null : boxOf(def.target())
      const key = box ? `${box.x},${box.y},${box.w},${box.h}` : ''
      if (key !== last) {
        last = key
        setTarget(box)
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [def, finished])

  // every step starts with the keyboard on the placard (← → Esc work from there)
  useEffect(() => {
    const id = requestAnimationFrame(() => placardRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(id)
  }, [step, finished])

  // ← → Esc also while nothing has the focus (after a click on the dimmed page, the keyboard is on the body)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      const a = document.activeElement
      if (a && a !== document.body && !placardRef.current?.contains(a)) return
      if (placardRef.current?.contains(a) && (e.target as HTMLElement).closest('input, textarea')) return
      if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') back()
      else if (e.key === 'Escape') endTour()
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, back])

  const act = async () => {
    if (!def.act || busy) return
    setBusy(true)
    const at = useTour.getState().step
    try {
      const res = await def.act({ hasKey })
      // moved on meanwhile: the result belongs to the step it was for
      if (useTour.getState().step !== at) return
      setNote(res?.note ?? null)
      setDid(true)
    } catch (e) {
      console.warn('[one] tour: "Do it for me" failed', e)
    } finally {
      setBusy(false)
    }
  }

  const n = step + 1
  const title = finished ? t('shell.tour.finish.title') : t(`shell.tour.step.${def.id}.title`, { key: def.key ? shortcutLabel(def.key) : '' })
  const live = finished ? title : t('shell.tour.live', { n, total: TOUR_STEP_COUNT, title })

  return (
    <div className="tour" data-mobile={mobile || undefined}>
      <Frame box={target} />
      <Placard
        ref={placardRef}
        target={mobile ? null : target}
        docked={mobile}
        centred={finished}
        title={title}
        label={finished ? t('shell.tour.finish.label') : t('shell.tour.stepOf', { n: String(n).padStart(2, '0'), total: String(TOUR_STEP_COUNT).padStart(2, '0') })}
        onKeyDown={(e) => {
          if (e.key === 'Tab') e.stopPropagation()
        }}
      >
        {finished ? (
          <Finish />
        ) : (
          <StepBody def={def} hasKey={hasKey} note={note} />
        )}
        <div className="tour-placard__keys">
          <button type="button" className="btn btn--sm btn--ghost" onClick={back} disabled={!finished && step === 0}>
            <ArrowLeft size={13} strokeWidth={1.8} aria-hidden /> {t('shell.tour.back')}
          </button>
          <span className="tour-placard__spacer" />
          {!finished && def.act && (
            <button type="button" className="btn btn--sm tour-placard__do" data-done={did || undefined} onClick={() => void act()} disabled={busy} aria-busy={busy || undefined}>
              {did ? <Check size={13} strokeWidth={2} aria-hidden /> : <span className={`led${busy ? ' led--on' : ''}`} aria-hidden />}
              {did ? t('shell.tour.didIt') : t('shell.tour.doIt')}
            </button>
          )}
          <button type="button" className="btn btn--sm btn--primary tour-placard__next" onClick={next}>
            {finished ? t('shell.tour.finish.done') : step === TOUR_STEP_COUNT - 1 ? t('shell.tour.finishKey') : t('shell.tour.next')}
            {!finished && <ArrowRight size={13} strokeWidth={1.8} aria-hidden />}
          </button>
        </div>
        <div className="tour-placard__foot">
          <ol className="tour-ticks" aria-hidden>
            {TOUR_STEPS.map((s, i) => (
              <li key={s.id} data-state={finished || i < step ? 'done' : i === step ? 'now' : undefined} />
            ))}
          </ol>
          <span className="label tour-placard__hint">
            <span className="kbd">←</span>
            <span className="kbd">→</span> {t('shell.tour.keys.step')} · <span className="kbd">Esc</span> {t('shell.tour.keys.end')}
          </span>
        </div>
      </Placard>
      <div className="visually-hidden" aria-live="polite" role="status">
        {live}
      </div>
    </div>
  )
}

/** The box around what a step frames (several elements: their union); null when nothing of it shows. */
function boxOf(target: HTMLElement | HTMLElement[] | null): Box | null {
  const list = (Array.isArray(target) ? target : target ? [target] : []).filter((el) => !covered(el))
  if (!list.length) return null
  const rects = list.map((el) => el.getBoundingClientRect())
  const x = Math.min(...rects.map((r) => r.left))
  const y = Math.min(...rects.map((r) => r.top))
  const r = Math.max(...rects.map((q) => q.right))
  const b = Math.max(...rects.map((q) => q.bottom))
  return { x: Math.round(x), y: Math.round(y), w: Math.round(r - x), h: Math.round(b - y) }
}

/** Something other than the tour lies over the element's middle (a dialog opened from the key line …). */
function covered(el: HTMLElement): boolean {
  if (!isShown(el)) return true
  const r = el.getBoundingClientRect()
  const x = Math.min(window.innerWidth - 1, Math.max(0, r.left + r.width / 2))
  const y = Math.min(window.innerHeight - 1, Math.max(0, r.top + Math.min(r.height / 2, 40)))
  const hit = document.elementFromPoint(x, y)
  if (!hit || el.contains(hit) || hit.contains(el)) return false
  return !hit.closest('.tour')
}

/** The hairline frame and the dim around it (no element: no dim either — the placard alone). */
function Frame({ box }: { box: Box | null }) {
  if (!box) return null
  const vw = window.innerWidth
  const vh = window.innerHeight
  const x = Math.max(2, box.x - PAD)
  const y = Math.max(2, box.y - PAD)
  const w = Math.min(vw - 2 - x, box.w + 2 * PAD + Math.min(0, box.x - PAD - 2))
  const h = Math.min(vh - 2 - y, box.h + 2 * PAD + Math.min(0, box.y - PAD - 2))
  const style = { '--tx': `${x}px`, '--ty': `${y}px`, '--tw': `${Math.max(8, w)}px`, '--th': `${Math.max(8, h)}px` } as CSSProperties
  return (
    <div className="tour-frame" style={style} aria-hidden>
      <i className="tour-frame__mark tour-frame__mark--tl" />
      <i className="tour-frame__mark tour-frame__mark--tr" />
      <i className="tour-frame__mark tour-frame__mark--bl" />
      <i className="tour-frame__mark tour-frame__mark--br" />
    </div>
  )
}

interface PlacardProps {
  target: Box | null
  docked: boolean
  /** the finish card: in the middle of the screen */
  centred?: boolean
  title: string
  label: string
  children: React.ReactNode
  onKeyDown: (e: ReactKeyboardEvent) => void
  ref: React.Ref<HTMLDivElement>
}

/** The placard: next to the frame (below, right, above, left — the first that fits), else in the corner. */
function Placard({ target, docked, centred, title, label, children, onKeyDown, ref }: PlacardProps) {
  const t = useT()
  const own = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const setRefs = (el: HTMLDivElement | null) => {
    own.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = el
  }

  // after every render (the placard's size follows its text): only a real move updates the state
  useLayoutEffect(() => {
    if (docked) return setPos(null)
    const el = own.current
    if (!el) return
    const next = centred ? centre(el.offsetWidth, el.offsetHeight) : place(target, el.offsetWidth, el.offsetHeight)
    setPos((p) => (p && p.left === next.left && p.top === next.top ? p : next))
  })

  const style: CSSProperties | undefined = docked || !pos ? undefined : { left: pos.left, top: pos.top }
  return (
    <div ref={setRefs} className="tour-placard" data-docked={docked || undefined} style={style} role="dialog" aria-modal="false" aria-labelledby="tour-title" tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="tour-placard__bar">
        <Compass size={13} strokeWidth={1.8} aria-hidden className="tour-placard__mark" />
        <span className="label tour-placard__label">{label}</span>
        <span className="tour-placard__spacer" />
        <button type="button" className="icon-btn icon-btn--sm" onClick={endTour} aria-label={t('shell.tour.end')} title={`${t('shell.tour.end')} (Esc)`}>
          <X size={13} strokeWidth={1.8} />
        </button>
      </div>
      <h2 id="tour-title" className="tour-placard__title">
        {title}
      </h2>
      {children}
    </div>
  )
}

const centre = (w: number, h: number) => ({ left: Math.round((window.innerWidth - w) / 2), top: Math.round(Math.max(EDGE, window.innerHeight * 0.3 - h / 2)) })

/** Where the placard goes for a frame (viewport px). */
function place(target: Box | null, w: number, h: number): { left: number; top: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  // the status bar (24 px) stays readable
  const bottom = vh - 28
  const corner = { left: vw - w - EDGE - 8, top: bottom - h - EDGE }
  if (!target) return corner
  const clampX = (x: number) => Math.max(EDGE, Math.min(vw - w - EDGE, x))
  const clampY = (y: number) => Math.max(EDGE, Math.min(bottom - h - EDGE, y))
  const t = { x: target.x - PAD, y: target.y - PAD, r: target.x + target.w + PAD, b: target.y + target.h + PAD }
  const below = { left: clampX(t.x), top: t.b + GAP }
  const right = { left: t.r + GAP, top: clampY(t.y) }
  const above = { left: clampX(t.x), top: t.y - GAP - h }
  const left = { left: t.x - GAP - w, top: clampY(t.y) }
  const fits = {
    below: below.top + h <= bottom - EDGE,
    right: right.left + w <= vw - EDGE,
    above: above.top >= EDGE,
    left: left.left >= EDGE,
  }
  // a narrow element (a sidebar row, a key): beside it; a wide one (a list, a toolbar): under or over it
  const order = target.w < 420 ? (['right', 'below', 'above', 'left'] as const) : (['below', 'above', 'right', 'left'] as const)
  const at = { below, right, above, left }
  for (const k of order) if (fits[k]) return at[k]
  return corner
}

/** A step: what it is, how, the key line (needs Claude), what "Do it for me" found. */
function StepBody({ def, hasKey, note }: { def: TourStep; hasKey: boolean; note: string | null }) {
  const t = useT()
  const noKey = def.needsKey && !hasKey
  return (
    <>
      <p className="tour-placard__body">{t(`shell.tour.step.${def.id}.body`, { key: def.key ? shortcutLabel(def.key) : '' })}</p>
      {noKey && def.id === 'ai' && <WouldDo />}
      {noKey && (
        <p className="tour-placard__keyline" data-testid="tour-keyline">
          <KeyRound size={13} strokeWidth={1.8} aria-hidden />
          <span>{t('shell.tour.keyLine')}</span>
          <button type="button" className="tour-placard__link" onClick={() => useUI.getState().openModal({ type: 'settings', tab: 'ai' })}>
            {t('shell.tour.keyOpen')}
          </button>
        </p>
      )}
      {note && (
        <p className="tour-placard__note label" data-testid="tour-note">
          <span className="led led--ok" aria-hidden /> {note}
        </p>
      )}
    </>
  )
}

/** Without a key: what Transform into → Diagram would make of the Tour page's list. */
function WouldDo() {
  const t = useT()
  return (
    <figure className="tour-would" aria-label={t('shell.tour.step.ai.would')}>
      <span className="tour-would__list" aria-hidden>
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="tour-would__arrow" aria-hidden>
        →
      </span>
      <span className="tour-would__chart" aria-hidden>
        <b>1</b>
        <em />
        <b>2</b>
        <em />
        <b>3</b>
        <em />
        <b>4</b>
      </span>
      <figcaption className="label">{t('shell.tour.step.ai.would')}</figcaption>
    </figure>
  )
}

/** The finish card: keep or delete the Tour page, "What can One do?". */
function Finish() {
  const t = useT()
  const tourPage = useWorkspace(() => liveTourPage())
  return (
    <>
      <p className="tour-placard__body">{t('shell.tour.finish.body', { key: shortcutLabel('Mod+K') })}</p>
      <div className="tour-placard__finish">
        {tourPage && (
          <button
            type="button"
            className="btn btn--sm btn--ghost btn--danger"
            onClick={() => {
              trashTourPage()
              endTour()
            }}
          >
            <Trash2 size={13} strokeWidth={1.8} aria-hidden /> {t('shell.tour.finish.delete')}
          </button>
        )}
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => {
            endTour()
            navigate('#/discover')
          }}
        >
          <Compass size={13} strokeWidth={1.8} aria-hidden /> {t('shell.discover.title')}
        </button>
      </div>
    </>
  )
}
