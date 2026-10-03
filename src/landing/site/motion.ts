/**
 * Motion layer (GSAP + ScrollTrigger). Mechanical, fast, no bounce.
 *  - Hero entrance after the smash (prepare → play)
 *  - One-time scroll reveals for later sections
 *  - Receipt printing (stepped feed like a thermal printer)
 *  - Readout counters ("instrument dials")
 * Everything collapses to "instantly final" under prefers-reduced-motion.
 */
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import type { Lang } from '@/shared/i18n'
import { prefersReducedMotion, splitChars } from './util'

gsap.registerPlugin(ScrollTrigger)

const EASE = 'expo.out'
/** Only the properties the entrance touches — inline positions (balloons, dial) must survive. */
const CLEAR = 'transform,opacity,clipPath'

/* ------------------------------------------------------------------ */
/* Counters                                                             */
/* ------------------------------------------------------------------ */

const intFormats: Partial<Record<Lang, Intl.NumberFormat>> = {}

function formatCount(kind: string, n: number, lang: Lang): string {
  const v = Math.round(n)
  if (kind === 'cost') {
    // runs every frame while the dial counts: one formatter per language, not one per frame
    const num = (intFormats[lang] ??= new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US')).format(v)
    return lang === 'de' ? `${num} €` : `$${num}`
  }
  return String(v)
}

/**
 * Parse (and cache) the transforms of all targets in one pass of reads before any write.
 * gsap.set on a fresh element reads its computed transform first; interleaved with the writes
 * of the previous set, that is one forced layout of the whole page per element.
 */
function primeTransforms(els: Element[]): void {
  for (const el of els) gsap.getProperty(el, 'x')
}

function countReadout(root: HTMLElement, lang: Lang, tl: gsap.core.Timeline, at: number): void {
  root.querySelectorAll<HTMLElement>('[data-count]').forEach((el, i) => {
    const kind = el.dataset.count ?? 'n'
    const final = el.dataset.final ?? el.textContent ?? ''
    const from = Number(el.dataset.from ?? 0)
    const o = { v: kind === 'inf' ? 0 : from }
    const to = kind === 'inf' ? 9999 : 0
    const meter = el.parentElement?.querySelector<HTMLElement>('.meter')
    const level = () => (kind === 'inf' ? o.v / 9999 : from ? o.v / from : 0)
    tl.to(
      o,
      {
        v: to,
        duration: 0.62,
        ease: kind === 'inf' ? 'power2.in' : 'power3.out',
        onStart: () => el.classList.add('is-counting'),
        onUpdate: () => {
          el.textContent = formatCount(kind, o.v, lang)
          meter?.style.setProperty('--v', level().toFixed(3))
        },
        onComplete: () => {
          el.textContent = final
          el.classList.remove('is-counting')
        },
      },
      at + i * 0.06,
    )
  })
}

/* ------------------------------------------------------------------ */
/* Hero entrance                                                        */
/* ------------------------------------------------------------------ */

export interface HeroMotion {
  prepare(): void
  play(instant: boolean): void
}

export function heroMotion(root: HTMLElement, lang: Lang): HeroMotion {
  const q = <T extends Element = HTMLElement>(sel: string) => Array.from(root.querySelectorAll<T & Element>(sel)) as T[]
  let prepared = false
  let chars: HTMLElement[] = []

  const targets = () => ({
    tb: q('.tb'),
    lines: q('.hero .line-in'),
    ghosts: q('.hero .ghost'),
    copy: q('.hero-mcp, .hero-sub, .hero-ctas, .hero-fine, .bom, .hero-plate'),
    media: q('.frame-hero .frame-media'),
    cap: q('.frame-hero .frame-cap'),
    balloons: q('.frame-hero .balloon'),
    leaders: q('.frame-hero .leaders'),
    dims: q('.hero-fig .dim'),
    cells: q('.readout-cell'),
    led: q('.hero-label .led'),
  })

  function prepare(): void {
    window.scrollTo(0, 0)
    if (prefersReducedMotion()) return
    const t = targets()
    const label = root.querySelector<HTMLElement>('.hero-label [data-type]')
    if (label && !chars.length) chars = splitChars(label)
    primeTransforms([t.tb, t.lines, t.copy, t.balloons].flat())
    gsap.set(t.tb, { yPercent: -100 })
    gsap.set(chars, { opacity: 0 })
    gsap.set(t.led, { opacity: 0 })
    gsap.set(t.lines, { yPercent: 108 })
    gsap.set(t.ghosts, { opacity: 1 })
    gsap.set(t.copy, { opacity: 0, y: 16 })
    gsap.set(t.media, { clipPath: 'inset(0% 0% 100% 0%)' })
    gsap.set(t.cap, { opacity: 0 })
    gsap.set(t.balloons, { scale: 0, opacity: 0 })
    gsap.set(t.leaders, { opacity: 0 })
    gsap.set(t.dims, { opacity: 0.35 })
    gsap.set(t.cells, { opacity: 0.25 })
    root.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => {
      const inf = el.dataset.count === 'inf'
      if (!inf) el.textContent = formatCount(el.dataset.count ?? 'n', Number(el.dataset.from ?? 0), lang)
      el.parentElement?.querySelector<HTMLElement>('.meter')?.style.setProperty('--v', inf ? '0' : '1')
    })
    // While the bar is tucked away, the strip behind it must already be Carbon.
    root.classList.add('is-pre', 'tone-carbon')
    prepared = true
  }

  function play(instant: boolean): void {
    const t = targets()
    const wasPrepared = prepared
    prepared = false
    const all = [t.tb, chars, t.led, t.lines, t.ghosts, t.copy, t.media, t.cap, t.balloons, t.leaders, t.dims].flat()
    root.classList.remove('is-pre')
    if (instant || !wasPrepared || prefersReducedMotion()) {
      root.classList.remove('tone-carbon')
      gsap.killTweensOf([...all, ...t.cells])
      gsap.set([...all, ...t.cells], { clearProps: CLEAR })
      root.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => {
        el.textContent = el.dataset.final ?? el.textContent
        el.parentElement?.querySelector<HTMLElement>('.meter')?.style.setProperty('--v', el.dataset.count === 'inf' ? '1' : '0')
      })
      root.classList.add('is-live')
      return
    }
    const scan = document.createElement('i')
    scan.className = 'scanline'
    scan.setAttribute('aria-hidden', 'true')
    t.media[0]?.appendChild(scan)

    const tl = gsap.timeline({
      defaults: { ease: EASE },
      onComplete: () => {
        gsap.set(all, { clearProps: CLEAR })
        scan.remove()
        root.classList.add('is-live')
        ScrollTrigger.refresh()
      },
    })
    tl.to(t.tb, { yPercent: 0, duration: 0.42, ease: 'power3.out' }, 0)
      .call(() => root.classList.remove('tone-carbon'), [], 0.44)
      .to(t.led, { opacity: 1, duration: 0.01 }, 0.02)
      .to(chars, { opacity: 1, duration: 0.01, stagger: 0.016, ease: 'none' }, 0.06)
      .to(t.media, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.62, ease: 'power3.inOut' }, 0.3)
      .fromTo(scan, { top: '0%', opacity: 1 }, { top: '100%', duration: 0.62, ease: 'power3.inOut' }, 0.3)
      .to(scan, { opacity: 0, duration: 0.12 }, 0.9)
      .to(t.dims, { opacity: 1, duration: 0.3, ease: 'none' }, 0.32)
      .to(t.copy, { opacity: 1, y: 0, duration: 0.5, stagger: 0.05, ease: 'power3.out' }, 0.38)
      .to(t.leaders, { opacity: 1, duration: 0.2, ease: 'none' }, 0.78)
      .to(t.balloons, { scale: 1, opacity: 1, duration: 0.24, stagger: 0.07, ease: 'power3.out' }, 0.8)
      .to(t.cap, { opacity: 1, duration: 0.2, ease: 'none' }, 0.9)
    // Headline: each solid line rises into its slot and pushes the blueprint outline out ahead of
    // it — the outline is clipped exactly at the solid line's top edge, so the two never overlap
    // (matters on phones, where every line wraps into several rows).
    t.lines.forEach((line, i) => {
      const ghost = t.ghosts[i]
      const clipGhost = () => {
        if (!ghost) return
        const p = Math.min(1, Math.max(0, Number(gsap.getProperty(line, 'yPercent')) / 100))
        ghost.style.clipPath = `inset(0 0 ${((1 - p) * 100).toFixed(2)}% 0)`
        // …and the last sliver above the settling line fades instead of lingering through the ease tail.
        ghost.style.opacity = Math.min(1, p / 0.3).toFixed(3)
      }
      tl.to(line, { yPercent: 0, duration: 0.7, onUpdate: clipGhost }, 0.1 + i * 0.085)
    })
    // The dials only make sense when someone sees them: count now if the readout is on screen,
    // otherwise the first time it scrolls into view.
    const readout = root.querySelector<HTMLElement>('.readout')
    if (readout && readout.getBoundingClientRect().top < window.innerHeight - 40) {
      tl.to(t.cells, { opacity: 1, duration: 0.2, stagger: 0.04, ease: 'none' }, 0.45)
      countReadout(root, lang, tl, 0.5)
    } else if (readout) {
      const later = gsap.timeline({ paused: true })
      later.to(t.cells, { opacity: 1, duration: 0.2, stagger: 0.04, ease: 'none', clearProps: 'opacity' }, 0)
      countReadout(root, lang, later, 0.05)
      tl.call(() => {
        ScrollTrigger.create({ trigger: readout, start: 'top 92%', once: true, onEnter: () => later.play() })
      })
    }
  }

  return { prepare, play }
}

/* ------------------------------------------------------------------ */
/* Scroll reveals (once)                                                */
/* ------------------------------------------------------------------ */

/**
 * The hidden "before" state is plain CSS (`.has-reveals …:not(.is-in)` in site.css), not
 * gsap.set: setting ~60 transforms up front read and wrote them element by element, a forced
 * layout each on a cold mount. On enter, fromTo() pins the start values inline (immediate
 * render) and `.is-in` retires the CSS state underneath — no flash.
 */
export function initReveals(root: HTMLElement, opts: { skip: boolean }): () => void {
  const triggers: ScrollTrigger[] = []
  const active = !opts.skip && !prefersReducedMotion()
  root.classList.toggle('has-reveals', active)
  if (!active) return () => {}

  root.querySelectorAll<HTMLElement>('.sec .sec-head').forEach((head) => {
    triggers.push(
      ScrollTrigger.create({
        trigger: head,
        start: 'top 88%',
        once: true,
        onEnter: () => {
          const rule = head.querySelector('.sec-rule')
          const label = head.querySelector<HTMLElement>('[data-type]')
          const line = head.querySelector('.line-in')
          const lead = head.querySelector('.sec-lead')
          const chars = label ? splitChars(label) : []
          const tl = gsap.timeline({ defaults: { ease: EASE } })
          if (rule) tl.fromTo(rule, { scaleX: 0 }, { scaleX: 1, duration: 0.7, ease: 'power3.inOut', clearProps: 'transform' }, 0)
          if (chars.length) tl.fromTo(chars, { opacity: 0 }, { opacity: 1, duration: 0.01, stagger: 0.014, ease: 'none' }, 0.05)
          // (y: 0 — GSAP parses the CSS translateY(108%) as px; only yPercent may move the line)
          if (line) tl.fromTo(line, { y: 0, yPercent: 108 }, { y: 0, yPercent: 0, duration: 0.7, clearProps: 'transform' }, 0.08)
          if (lead) tl.fromTo(lead, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out', clearProps: 'transform,opacity' }, 0.22)
          head.classList.add('is-in')
        },
      }),
    )
  })

  const items = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'))
  triggers.push(
    ...ScrollTrigger.batch(items, {
      start: 'top 92%',
      once: true,
      onEnter: (batch) => {
        // A jump (nav link, dial, fast scroll) enters everything above the viewport at once:
        // those blocks just switch on — staggering them first kept the visible ones blank ~1.5 s.
        const shown = batch.filter((el) => el.getBoundingClientRect().bottom > 0)
        if (shown.length)
          gsap.fromTo(
            shown,
            { opacity: 0, y: 18 },
            { opacity: 1, y: 0, duration: 0.55, stagger: 0.05, ease: 'power3.out', overwrite: true, clearProps: 'transform,opacity' },
          )
        for (const el of batch) el.classList.add('is-in')
      },
    }),
  )
  return () => triggers.forEach((t) => t.kill())
}

/* ------------------------------------------------------------------ */
/* Receipt printer                                                      */
/* ------------------------------------------------------------------ */

export function initPrinter(root: HTMLElement, opts: { skip: boolean }): () => void {
  const receipt = root.querySelector<HTMLElement>('[data-receipt]')
  if (!receipt || opts.skip || prefersReducedMotion()) return () => {}
  gsap.set(receipt, { yPercent: -101 })
  const st = ScrollTrigger.create({
    trigger: root.querySelector('.printer'),
    start: 'top 75%',
    once: true,
    onEnter: () => gsap.to(receipt, { yPercent: 0, duration: 1.15, ease: 'steps(16)', clearProps: 'transform' }),
  })
  return () => st.kill()
}

/** Short paper feed when the numbers change. */
export function reprint(receipt: HTMLElement): void {
  if (prefersReducedMotion()) return
  gsap.fromTo(receipt, { y: -14 }, { y: 0, duration: 0.24, ease: 'steps(4)', overwrite: true, clearProps: 'transform' })
  receipt.querySelector('.r-total')?.classList.add('flash')
}

/** Instrument-style number roll (used by the savings display). */
const rolls = new WeakMap<HTMLElement, gsap.core.Tween>()
export function rollNumber(el: HTMLElement, from: number, to: number, format: (n: number) => string): void {
  rolls.get(el)?.kill()
  if (prefersReducedMotion() || from === to) {
    el.textContent = format(to)
    return
  }
  const o = { v: from }
  rolls.set(
    el,
    gsap.to(o, {
      v: to,
      duration: 0.42,
      ease: 'power3.out',
      onUpdate: () => (el.textContent = format(o.v)),
      onComplete: () => (el.textContent = format(to)),
    }),
  )
}

export { ScrollTrigger }
