/**
 * Presentation mode: the page becomes a deck (split at H1/H2/rules), shown full-screen on a
 * 16:9 "screen" with crop marks, a mono slide counter and a thin signal-orange progress bar.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { JSONContent } from '@tiptap/core'
import { ChevronLeft, ChevronRight, LayoutGrid, Maximize, Minimize, Moon, Sun, X } from 'lucide-react'
import { useLang, useT } from '../../i18n'
import { usePage } from '../../store/selectors'
import type { ID } from '../../store/types'
import { ReadOnlyDoc } from '../../editor'
import { PageIcon } from '../../ui/PageIcon'
import { Kbd } from '../../ui/controls'
import { safeLocalGet, safeLocalSet } from '@/shared/brand'
import { buildDeck, mapBlocks, slideText, type Slide } from './slides'
import { databaseTable } from '../share/codec'
import { claimKeyboard } from './keys'
import './present.css'
import '../share/readonly.css'

const DARK_KEY = 'one.present.dark'
const pad2 = (n: number) => String(n).padStart(2, '0')

export function Presentation({ pageId, onClose }: { pageId: ID; onClose: () => void }) {
  const t = useT()
  const lang = useLang()
  const page = usePage(pageId)
  const title = page?.title?.trim() || t('common.untitled')
  // Embedded databases are shown as static tables: a click during a talk must never create rows.
  const { slides } = useMemo(() => {
    const deck = buildDeck(page?.content, title)
    const staticDb = (n: JSONContent) => (n.type === 'databaseBlock' ? databaseTable(String(n.attrs?.databaseId ?? '')) : null)
    return { ...deck, slides: deck.slides.map((sl) => ({ ...sl, blocks: mapBlocks(sl.blocks, staticDb) })) }
  }, [page?.content, title])
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
  const overviewRef = useRef(false)

  overviewRef.current = overview
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

  // hand focus back to whatever started the show (topbar button, menu item …)
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    return () => {
      if (opener && opener !== document.body && opener.isConnected) requestAnimationFrame(() => opener.focus({ preventScroll: true }))
    }
  }, [])

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
      // Ask for Esc to reach the page in full screen (Chromium): it then closes the overview or
      // ends the show like everywhere else; holding Esc still leaves full screen.
      if (on) void keyboardLock()?.lock?.(['Escape']).catch(() => undefined)
      else keyboardLock()?.unlock?.()
      // Without the lock the browser consumes Esc to leave full screen: in the overview that
      // just closes the overview, otherwise it ends the show.
      if (!on && enteredFs.current) {
        enteredFs.current = false
        if (overviewRef.current) setOverview(false)
        else onCloseRef.current()
      }
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => {
      document.removeEventListener('fullscreenchange', onFs)
      keyboardLock()?.unlock?.()
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

  /* ---------- overlong slides scroll: "next" reads on first, then turns the page ---------- */
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const scrollSlide = (d: 1 | -1): boolean => {
    const el = scrollerRef.current
    if (!el || !el.hasAttribute('data-scroll')) return false
    const room = d > 0 ? el.scrollHeight - el.clientHeight - el.scrollTop : el.scrollTop
    if (room <= 4) return false
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollBy({ top: d * Math.max(80, el.clientHeight * 0.8), behavior: reduce ? 'auto' : 'smooth' })
    return true
  }
  const forward = () => scrollSlide(1) || next()
  const backward = () => scrollSlide(-1) || prev()

  /* ---------- keyboard (owns every key while presenting, see keys.ts) ---------- */
  const onKeyRef = useRef<(e: KeyboardEvent) => boolean>(() => false)
  onKeyRef.current = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return false
    const k = e.key
    if (overview) {
      if (k === 'Escape' || k === 'g' || k === 'o') setOverview(false)
      else if (k === 'ArrowRight') go(cur + 1)
      else if (k === 'ArrowLeft') go(cur - 1)
      else if (k === 'ArrowDown') go(cur + 4)
      else if (k === 'ArrowUp') go(cur - 4)
      else if (k === 'Enter' || k === ' ') setOverview(false)
      else return false
      return true
    }
    // a focused HUD button keeps Enter for itself
    if (k === 'Enter' && (e.target as HTMLElement | null)?.closest?.('button')) return false
    if (['ArrowDown', 'PageDown', 'Enter', 'j'].includes(k) || (k === ' ' && !e.shiftKey)) forward()
    else if (['ArrowUp', 'PageUp', 'k'].includes(k) || (k === ' ' && e.shiftKey)) backward()
    else if (['ArrowRight', 'l'].includes(k)) next()
    else if (['ArrowLeft', 'Backspace', 'h'].includes(k)) prev()
    else if (k === 'Home') go(0)
    else if (k === 'End') go(count - 1)
    else if (k === 'Escape') onCloseRef.current()
    else if (k === 'd') setDark((d) => !d)
    else if (k === 'f') toggleFs()
    else if (k === 'g' || k === 'o') setOverview(true)
    else return false
    return true
  }
  useEffect(() => claimKeyboard((e) => onKeyRef.current(e)), [])

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
    // a swipe inside something that scrolls sideways (wide table, code) scrolls it instead
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) return inScroller(e.target as HTMLElement) ? undefined : dx < 0 ? next() : prev()
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) {
      if (window.getSelection()?.toString()) return
      if (e.clientX < window.innerWidth * 0.3) backward()
      else forward()
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
            <SlideView
              key={cur}
              slide={slide}
              dir={dir}
              icon={page?.icon ?? null}
              title={title}
              meta={`${t('features.present.slides', { count })} · ${date}`}
              hint={t(coarse ? 'features.present.beginTouch' : 'features.present.begin')}
              more={t('features.present.more')}
              scrollerRef={scrollerRef}
            />
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

type SlideViewProps = {
  slide: Slide
  dir: 1 | -1
  icon: Parameters<typeof PageIcon>[0]['icon']
  title: string
  meta: string
  hint: string
  /** label of the "more below" cue */
  more: string
  /** the slide's scroll box, for "next reads on first" */
  scrollerRef: React.MutableRefObject<HTMLDivElement | null>
}

const MIN_SCALE = 0.5

function SlideView({ slide, dir, icon, title, meta, hint, more, scrollerRef }: SlideViewProps) {
  const fitRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState(false)
  const [atEnd, setAtEnd] = useState(false)
  const [atStart, setAtStart] = useState(true)

  // Shrink-to-fit: long slides are scaled down (never below 50 %). What still does not fit
  // scrolls — with a "more below" cue — instead of being cut off.
  useLayoutEffect(() => {
    const fit = fitRef.current
    const content = contentRef.current
    if (!fit || !content) return
    let raf = 0
    const measure = () => {
      content.style.width = '100%'
      content.style.transform = ''
      content.style.marginBottom = ''
      const availH = fit.clientHeight
      const availW = content.clientWidth
      const needH = content.scrollHeight
      // wide blocks (tables, code) scroll inside their own box: measure how much they overflow
      let extra = 0
      content.querySelectorAll<HTMLElement>('.tableWrapper, pre, .columns').forEach((el) => {
        extra = Math.max(extra, el.scrollWidth - el.clientWidth)
      })
      const sH = needH > availH && availH > 0 ? availH / needH : 1
      const sW = extra > 1 && availW > 0 ? availW / (availW + extra) : 1
      const s = Math.max(MIN_SCALE, Math.min(sH, sW))
      if (s < 1) {
        content.style.width = `${100 / s}%`
        content.style.transform = `scale(${s})`
        // a transform does not shrink the layout box: give back the space it no longer uses,
        // so the scroll range ends with the last line
        content.style.marginBottom = `${-needH * (1 - s)}px`
      }
      const over = needH * s > availH + 2
      setOverflow(over)
      if (!over) fit.scrollTop = 0
      setAtEnd(!over || fit.scrollHeight - fit.clientHeight - fit.scrollTop <= 4)
      setAtStart(fit.scrollTop <= 4)
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
    <>
      <div
        className="pres__fit"
        ref={(el) => {
          fitRef.current = el
          scrollerRef.current = el
        }}
        data-scroll={overflow || undefined}
        data-more={(overflow && !atEnd) || undefined}
        data-scrolled={(overflow && !atStart) || undefined}
        onScroll={(e) => {
          const el = e.currentTarget
          setAtEnd(el.scrollHeight - el.clientHeight - el.scrollTop <= 4)
          setAtStart(el.scrollTop <= 4)
        }}
      >
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
      {overflow && !atEnd && (
        <span className="pres__more mono" aria-hidden>
          {more} ↓
        </span>
      )}
    </>
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

/* ------------------------------------------------------------------ */

function inScroller(el: HTMLElement | null): boolean {
  for (let n = el; n && !n.classList.contains('pres__fit'); n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(n).overflowX)) return true
  }
  return false
}

type KeyboardLock = { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void }
const keyboardLock = (): KeyboardLock | undefined => (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard
