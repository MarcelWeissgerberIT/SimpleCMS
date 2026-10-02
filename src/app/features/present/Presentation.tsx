/**
 * Presentation mode: the page becomes a deck (split at H1/H2/rules), shown full-screen on a
 * 16:9 "screen" with crop marks, a mono slide counter and a thin signal-orange progress bar.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, LayoutGrid, Maximize, Minimize, Moon, Sun, X } from 'lucide-react'
import { useLang, useT } from '../../i18n'
import { usePage } from '../../store/selectors'
import type { ID } from '../../store/types'
import { ReadOnlyDoc } from '../../editor'
import { PageIcon } from '../../ui/PageIcon'
import { Kbd } from '../../ui/controls'
import { safeLocalGet, safeLocalSet } from '@/shared/brand'
import { buildDeck, slideText, type Slide } from './slides'
import './present.css'

const DARK_KEY = 'one.present.dark'
const pad2 = (n: number) => String(n).padStart(2, '0')

export function Presentation({ pageId, onClose }: { pageId: ID; onClose: () => void }) {
  const t = useT()
  const lang = useLang()
  const page = usePage(pageId)
  const title = page?.title?.trim() || t('common.untitled')
  const { slides } = useMemo(() => buildDeck(page?.content, title), [page?.content, title])
  const [index, setIndex] = useState(0)
  const [dir, setDir] = useState<1 | -1>(1)
  const [dark, setDark] = useState(() => safeLocalGet(DARK_KEY) === '1')
  const [overview, setOverview] = useState(false)
  const [chrome, setChrome] = useState(true)
  const [fs, setFs] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const enteredFs = useRef(false)

  const count = slides.length
  const coarse = useMemo(() => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches, [])
  const cur = Math.min(index, count - 1)

  const indexRef = useRef(0)
  indexRef.current = cur
  const go = useCallback(
    (to: number) => {
      const n = Math.max(0, Math.min(count - 1, to))
      if (n === indexRef.current) return
      setDir(n > indexRef.current ? 1 : -1)
      setIndex(n)
    },
    [count],
  )
  const next = useCallback(() => go(indexRef.current + 1), [go])
  const prev = useCallback(() => go(indexRef.current - 1), [go])

  /* ---------- full screen ---------- */
  useEffect(() => {
    const el = rootRef.current
    if (el?.requestFullscreen && !document.fullscreenElement) {
      el.requestFullscreen({ navigationUI: 'hide' })
        .then(() => (enteredFs.current = true))
        .catch(() => undefined)
    }
    const onFs = () => {
      const on = !!document.fullscreenElement
      setFs(on)
      // Esc in full screen is consumed by the browser: leaving full screen ends the show.
      if (!on && enteredFs.current) {
        enteredFs.current = false
        onCloseRef.current()
      }
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => {
      document.removeEventListener('fullscreenchange', onFs)
      if (document.fullscreenElement) {
        enteredFs.current = false
        document.exitFullscreen().catch(() => undefined)
      }
    }
  }, [])

  const toggleFs = () => {
    if (document.fullscreenElement) {
      enteredFs.current = false
      void document.exitFullscreen().catch(() => undefined)
    } else
      rootRef.current
        ?.requestFullscreen()
        .then(() => (enteredFs.current = true))
        .catch(() => undefined)
  }

  /* ---------- dark stage (temporarily switches the theme) ---------- */
  useEffect(() => {
    const html = document.documentElement
    const before = html.dataset.theme
    if (dark) html.dataset.theme = 'dark'
    safeLocalSet(DARK_KEY, dark ? '1' : '0')
    return () => {
      if (before) html.dataset.theme = before
    }
  }, [dark])

  /* ---------- chrome auto-hide ---------- */
  useEffect(() => {
    let timer = window.setTimeout(() => setChrome(false), 2400)
    const wake = () => {
      setChrome(true)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setChrome(false), 2400)
    }
    window.addEventListener('pointermove', wake)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointermove', wake)
    }
  }, [])

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key
      let handled = true
      if (overview) {
        if (k === 'Escape' || k === 'g' || k === 'o') setOverview(false)
        else if (k === 'ArrowRight') go(cur + 1)
        else if (k === 'ArrowLeft') go(cur - 1)
        else if (k === 'ArrowDown') go(cur + 4)
        else if (k === 'ArrowUp') go(cur - 4)
        else if (k === 'Enter' || k === ' ') setOverview(false)
        else handled = false
      } else if (['ArrowRight', 'ArrowDown', 'PageDown', 'Enter', 'l', 'j'].includes(k) || (k === ' ' && !e.shiftKey)) next()
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'h', 'k'].includes(k) || (k === ' ' && e.shiftKey)) prev()
      else if (k === 'Home') go(0)
      else if (k === 'End') go(count - 1)
      else if (k === 'Escape') onCloseRef.current()
      else if (k === 'd') setDark((d) => !d)
      else if (k === 'f') toggleFs()
      else if (k === 'g' || k === 'o') setOverview(true)
      else handled = false
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  /* ---------- click / swipe ---------- */
  const down = useRef<{ x: number; y: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    down.current = { x: e.clientX, y: e.clientY }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const d = down.current
    down.current = null
    if (!d || (e.target as HTMLElement).closest('a, button, input, summary, [data-no-nav]')) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) return dx < 0 ? next() : prev()
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) {
      if (window.getSelection()?.toString()) return
      if (e.clientX < window.innerWidth * 0.3) prev()
      else next()
    }
  }

  const progress = count > 1 ? cur / (count - 1) : 1
  const slide = slides[cur]
  const date = useMemo(
    () => new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(page?.updatedAt ?? Date.now()),
    [lang, page?.updatedAt],
  )

  return createPortal(
    <div
      ref={rootRef}
      className="pres"
      data-chrome={chrome || overview || undefined}
      role="dialog"
      aria-modal="true"
      aria-roledescription={t('features.present.deck')}
      aria-label={title}
    >
      {overview ? (
        <Overview slides={slides} current={cur} title={title} onPick={(i) => (go(i), setOverview(false))} />
      ) : (
        <div className="pres__stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
          <div className="pres__frame">
            <span className="pres__crop pres__crop--tl" />
            <span className="pres__crop pres__crop--tr" />
            <span className="pres__crop pres__crop--bl" />
            <span className="pres__crop pres__crop--br" />
            <div className="pres__corner pres__corner--tl">{slide.kind === 'title' ? '§ 00' : `§ ${pad2(cur)}`}</div>
            <div className="pres__corner pres__corner--tr">{title}</div>
            <div className="pres__corner pres__corner--br" aria-live="polite">
              {pad2(cur + 1)} / {pad2(count)}
            </div>
            <SlideView key={cur} slide={slide} dir={dir} icon={page?.icon ?? null} title={title} meta={`${t('features.present.slides', { count: count - 1 })} · ${date}`} hint={t(coarse ? 'features.present.beginTouch' : 'features.present.begin')} />
          </div>
        </div>
      )}

      <div className="pres__progress" aria-hidden>
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>

      <div className="pres__hud" data-no-nav="">
        <div className="pres__keys">
          <button className="pres__key" onClick={prev} disabled={cur === 0} aria-label={t('features.present.prev')} title={t('features.present.prev')}>
            <ChevronLeft size={16} />
          </button>
          <button className="pres__key" onClick={next} disabled={cur >= count - 1} aria-label={t('features.present.next')} title={t('features.present.next')}>
            <ChevronRight size={16} />
          </button>
          <span className="pres__keys-sep" />
          <button className="pres__key" aria-pressed={overview} onClick={() => setOverview((o) => !o)} title={`${t('features.present.overview')} (G)`} aria-label={t('features.present.overview')}>
            <LayoutGrid size={15} />
          </button>
          <button className="pres__key" aria-pressed={dark} onClick={() => setDark((d) => !d)} title={`${t('features.present.darkStage')} (D)`} aria-label={t('features.present.darkStage')}>
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          {typeof document !== 'undefined' && document.fullscreenEnabled && (
            <button className="pres__key" onClick={toggleFs} title={`${t('features.present.fullscreen')} (F)`} aria-label={t('features.present.fullscreen')}>
              {fs ? <Minimize size={15} /> : <Maximize size={15} />}
            </button>
          )}
          <button className="pres__key" onClick={() => onCloseRef.current()} title={`${t('features.present.exit')} (Esc)`} aria-label={t('features.present.exit')}>
            <X size={16} />
          </button>
        </div>
        <span className="pres__help">
          <Kbd>←</Kbd>
          <Kbd>→</Kbd> {t('features.present.navigate')}
          <Kbd>esc</Kbd> {t('features.present.exit')}
        </span>
      </div>
    </div>,
    document.body,
  )
}

/* ------------------------------------------------------------------ */

function SlideView({ slide, dir, icon, title, meta, hint }: { slide: Slide; dir: 1 | -1; icon: Parameters<typeof PageIcon>[0]['icon']; title: string; meta: string; hint: string }) {
  const fitRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // Shrink-to-fit: long slides are scaled down (never below 50 %) instead of overflowing.
  useLayoutEffect(() => {
    const fit = fitRef.current
    const content = contentRef.current
    if (!fit || !content) return
    let raf = 0
    const measure = () => {
      content.style.width = '100%'
      content.style.transform = ''
      const avail = fit.clientHeight
      const need = content.scrollHeight
      const s = need > avail && avail > 0 ? Math.max(0.5, avail / need) : 1
      if (s < 1) {
        content.style.width = `${100 / s}%`
        content.style.transform = `scale(${s})`
      }
    }
    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    }
    measure()
    schedule()
    const ro = new ResizeObserver(schedule)
    ro.observe(fit)
    content.addEventListener('load', schedule, true)
    void document.fonts?.ready.then(schedule)
    const late = window.setTimeout(schedule, 400)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(late)
      ro.disconnect()
      content.removeEventListener('load', schedule, true)
    }
  }, [slide])

  return (
    <div className="pres__fit" ref={fitRef}>
      <div className={`pres__content pres__content--${slide.kind}`} ref={contentRef} style={{ ['--dir' as string]: dir }}>
        {slide.kind === 'title' ? (
          <div className="pres__title-slide">
            {icon && (
              <div className="pres__icon">
                <PageIcon icon={icon} size={96} fallback={false} />
              </div>
            )}
            <h1 className="pres__title">{title}</h1>
            {slide.blocks.length > 0 && <ReadOnlyDoc content={{ type: 'doc', content: slide.blocks }} className="pres__lede" />}
            <div className="pres__meta">
              <span>{meta}</span>
              <span className="pres__begin">{hint}</span>
            </div>
          </div>
        ) : (
          <ReadOnlyDoc content={{ type: 'doc', content: slide.blocks }} className="pres__doc" />
        )}
      </div>
    </div>
  )
}

function Overview({ slides, current, title, onPick }: { slides: Slide[]; current: number; title: string; onPick: (i: number) => void }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [current])
  const snippet = (s: Slide) => slideText(s).slice(0, 140)
  return (
    <div className="pres__overview" ref={ref}>
      <div className="pres__ov-head">
        <span className="label">{t('features.present.overview')}</span>
        <span className="pres__ov-title">{title}</span>
      </div>
      <div className="pres__grid">
        {slides.map((s, i) => (
          <button key={i} className="pres__thumb" aria-current={i === current} onClick={() => onPick(i)}>
            <span className="pres__thumb-no mono">{s.kind === 'title' ? '§ 00' : `§ ${pad2(i)}`}</span>
            <span className="pres__thumb-h">{s.kind === 'title' ? title : s.heading || '—'}</span>
            <span className="pres__thumb-p">{s.kind === 'title' ? t('features.present.titleSlide') : snippet(s)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
