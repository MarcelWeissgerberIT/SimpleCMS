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

function formatCount(kind: string, n: number, lang: Lang): string {
  const v = Math.round(n)
  if (kind === 'cost') {
    const num = new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US').format(v)
    return lang === 'de' ? `${num} €` : `$${num}`
  }
  return String(v)
}

function countReadout(root: HTMLElement, lang: Lang, tl: gsap.core.Timeline, at: number): void {
  root.querySelectorAll<HTMLElement>('[data-count]').forEach((el, i) => {
    const kind = el.dataset.count ?? 'n'
    const final = el.dataset.final ?? el.textContent ?? ''
    const from = Number(el.dataset.from ?? 0)
    const o = { v: kind === 'inf' ? 0 : from }
    const to = kind === 'inf' ? 9999 : 0
    tl.to(
      o,
      {
        v: to,
        duration: 0.62,
        ease: kind === 'inf' ? 'power2.in' : 'power3.out',
        onStart: () => el.classList.add('is-counting'),
        onUpdate: () => (el.textContent = formatCount(kind, o.v, lang)),
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
    copy: q('.hero-sub, .hero-ctas, .hero-fine, .bom, .hero-plate'),
    media: q('.frame-hero .frame-media'),
    cap: q('.frame-hero .frame-cap'),
    balloons: q('.frame-hero .balloon'),
    leaders: q('.frame-hero .leaders'),
    dims: q('.hero-fig .dim'),
    crops: q('.frame-hero .crop'),
    cells: q('.readout-cell'),
    led: q('.hero-label .led'),
  })

  function prepare(): void {
    window.scrollTo(0, 0)
    if (prefersReducedMotion()) return
    const t = targets()
    const label = root.querySelector<HTMLElement>('.hero-label [data-type]')
    if (label && !chars.length) chars = splitChars(label)
    gsap.set(t.tb, { yPercent: -100 })
    gsap.set(chars, { opacity: 0 })
    gsap.set(t.led, { opacity: 0 })
    gsap.set(t.lines, { yPercent: 108 })
    gsap.set(t.copy, { opacity: 0, y: 16 })
    gsap.set(t.media, { clipPath: 'inset(0% 0% 100% 0%)' })
    gsap.set(t.cap, { opacity: 0 })
    gsap.set(t.balloons, { scale: 0, opacity: 0 })
    gsap.set(t.leaders, { opacity: 0 })
    gsap.set(t.dims, { opacity: 0.35 })
    gsap.set(t.cells, { opacity: 0.25 })
    root.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => {
      if (el.dataset.count !== 'inf') el.textContent = formatCount(el.dataset.count ?? 'n', Number(el.dataset.from ?? 0), lang)
    })
    // While the bar is tucked away, the strip behind it must already be Carbon.
    root.classList.add('is-pre', 'tone-carbon')
    prepared = true
  }

  function play(instant: boolean): void {
    const t = targets()
    const wasPrepared = prepared
    prepared = false
    const all = [t.tb, chars, t.led, t.lines, t.copy, t.media, t.cap, t.balloons, t.leaders, t.dims, t.cells].flat()
    root.classList.remove('is-pre')
    if (instant || !wasPrepared || prefersReducedMotion()) {
      root.classList.remove('tone-carbon')
      gsap.killTweensOf(all)
      gsap.set(all, { clearProps: CLEAR })
      root.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => (el.textContent = el.dataset.final ?? el.textContent))
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
      .to(t.lines, { yPercent: 0, duration: 0.7, stagger: 0.085 }, 0.1)
      .to(t.media, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.62, ease: 'power3.inOut' }, 0.3)
      .fromTo(scan, { top: '0%', opacity: 1 }, { top: '100%', duration: 0.62, ease: 'power3.inOut' }, 0.3)
      .to(scan, { opacity: 0, duration: 0.12 }, 0.9)
      .to(t.dims, { opacity: 1, duration: 0.3, ease: 'none' }, 0.32)
      .to(t.copy, { opacity: 1, y: 0, duration: 0.5, stagger: 0.05, ease: 'power3.out' }, 0.38)
      .to(t.leaders, { opacity: 1, duration: 0.2, ease: 'none' }, 0.78)
      .to(t.balloons, { scale: 1, opacity: 1, duration: 0.24, stagger: 0.07, ease: 'power3.out' }, 0.8)
      .to(t.cap, { opacity: 1, duration: 0.2, ease: 'none' }, 0.9)
      .to(t.cells, { opacity: 1, duration: 0.2, stagger: 0.04, ease: 'none' }, 0.45)
    countReadout(root, lang, tl, 0.5)
  }

  return { prepare, play }
}

/* ------------------------------------------------------------------ */
/* Scroll reveals (once)                                                */
/* ------------------------------------------------------------------ */

export function initReveals(root: HTMLElement, opts: { skip: boolean }): () => void {
  const triggers: ScrollTrigger[] = []
  if (opts.skip || prefersReducedMotion()) return () => {}

  root.querySelectorAll<HTMLElement>('.sec .sec-head').forEach((head) => {
    const rule = head.querySelector('.sec-rule')
    const label = head.querySelector<HTMLElement>('[data-type]')
    const line = head.querySelector('.line-in')
    const lead = head.querySelector('.sec-lead')
    const chars = label ? splitChars(label) : []
    if (rule) gsap.set(rule, { scaleX: 0 })
    if (chars.length) gsap.set(chars, { opacity: 0 })
    if (line) gsap.set(line, { yPercent: 108 })
    if (lead) gsap.set(lead, { opacity: 0, y: 12 })
    triggers.push(
      ScrollTrigger.create({
        trigger: head,
        start: 'top 88%',
        once: true,
        onEnter: () => {
          const tl = gsap.timeline({ defaults: { ease: EASE } })
          if (rule) tl.to(rule, { scaleX: 1, duration: 0.7, ease: 'power3.inOut', clearProps: 'transform' }, 0)
          if (chars.length) tl.to(chars, { opacity: 1, duration: 0.01, stagger: 0.014, ease: 'none' }, 0.05)
          if (line) tl.to(line, { yPercent: 0, duration: 0.7, clearProps: 'transform' }, 0.08)
          if (lead) tl.to(lead, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out', clearProps: 'transform,opacity' }, 0.22)
        },
      }),
    )
  })

  const items = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'))
  gsap.set(items, { opacity: 0, y: 18 })
  triggers.push(
    ...ScrollTrigger.batch(items, {
      start: 'top 92%',
      once: true,
      onEnter: (batch) =>
        gsap.to(batch, { opacity: 1, y: 0, duration: 0.55, stagger: 0.05, ease: 'power3.out', overwrite: true, clearProps: 'transform,opacity' }),
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

export { ScrollTrigger }
