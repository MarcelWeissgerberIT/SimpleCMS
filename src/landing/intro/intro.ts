/**
 * The first-visit intro: a deliberately awful 1997 spreadsheet "homepage". After `idleMs`
 * without ANY input a 3D sledgehammer smashes it and the pieces fall away, revealing the
 * new site underneath.
 *
 *   idle  ~67%  → "(Not Responding)" + white wash + busy cursor, animations freeze
 *         ~73%  → html2canvas snapshot of the frozen window (texture for WebGL) + GPU warm-up
 *         ~87%  → rumble: window jitter + dust specks (+ low rumble if audio is unlocked)
 *         100%  → smash (Three.js, lazy-loaded) — or a reduced-motion fade / DOM fallback
 *
 * Any input (pointermove/down, key, wheel, touch, scroll) resets the timer and reverts teasers.
 * Test hooks: window.__oneIntro = { smashNow, phase }, URL "?intro&fast" → 2 s idle.
 */
import { makeTranslator, type Lang } from '@/shared/i18n'
import { messages } from './messages'
import { mountSheet, WASH_ALPHA } from './sheet/sheet'
import { Sfx } from './audio'
import { captureViewport } from './capture'
import type { SmashStage } from './smash/smash'

export interface IntroOptions {
  lang: Lang
  /** Idle time without any user input before the hammer comes (15000). */
  idleMs: number
  /** Fired when the smash sequence begins (persist "seen", prep the site). */
  onSmashStart: () => void
  /** Fired after the old page has fully fallen away and the overlay can be removed. */
  onRevealed: () => void
}

export interface IntroHandle {
  smashNow(): void
  destroy(): void
}

type Phase = 'watch' | 'smashing' | 'done'

declare global {
  interface Window {
    __oneIntro?: { smashNow: () => void; phase: () => Phase; advance?: (ms: number) => void }
  }
}

const INPUT_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const
/** If capture + GPU warm-up are not ready by then, use the DOM fallback instead. */
const PREP_TIMEOUT_MS = 6000
/** The sequence must make progress at least this often (else: reveal right away). */
const STALL_MS = 3000
/** Absolute guard from the moment the smash was triggered (very slow GPUs still finish). */
const HARD_TIMEOUT_MS = 40000

export function mountIntro(root: HTMLElement, opts: IntroOptions): IntroHandle {
  const params = new URLSearchParams(window.location.search)
  const idleMs = params.has('fast') ? 2000 : opts.idleMs
  const manualClock = params.get('smashclock') === 'manual'
  const noWebGL = params.has('nowebgl') // test aid: force the DOM fallback
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const mobile = Math.min(window.innerWidth, window.innerHeight) < 600 || window.innerWidth < 720
  const t = makeTranslator(messages, opts.lang)
  const sfx = new Sfx()

  let phase: Phase = 'watch'
  let startedNotified = false
  let hardTimer = 0
  let prepTimer = 0
  let playTimer = 0
  let playing = false
  const timers: number[] = []

  const sheet = mountSheet(root, { t, lang: opts.lang, reducedMotion: reduced, onUpgrade: () => smashNow(), onSkip: () => skip() })

  // ------------------------------------------------------------------ lazy modules / GPU stage
  let smashModP: Promise<typeof import('./smash/smash')> | null = null
  const loadSmash = () => (smashModP ??= import('./smash/smash'))
  let stageP: Promise<SmashStage | null> | null = null
  let stage: SmashStage | null = null
  function ensureStage(): Promise<SmashStage | null> {
    if (reduced || noWebGL) return Promise.resolve(null)
    stageP ??= loadSmash()
      .then((m) => m.createSmashStage(root, { mobile, sfx, manualClock }))
      .then((s) => {
        if (phase === 'done') {
          s.dispose()
          return null
        }
        stage = s
        return s
      })
      .catch((err) => {
        console.warn('[intro] WebGL smash unavailable, using DOM fallback', err)
        return null
      })
    return stageP
  }

  // ------------------------------------------------------------------ capture (texture of the frozen window)
  let inputVersion = 0
  let snap: { canvas: HTMLCanvasElement; version: number } | null = null
  let inflight: { p: Promise<HTMLCanvasElement | null>; version: number } | null = null
  function ensureCapture(): Promise<HTMLCanvasElement | null> {
    if (snap && snap.version === inputVersion) return Promise.resolve(snap.canvas)
    if (inflight) {
      // A capture of an older state is still running: wait for it, then (re)check.
      return inflight.version === inputVersion ? inflight.p : inflight.p.then(() => ensureCapture())
    }
    const version = inputVersion
    const p = captureViewport(root)
      .then((canvas) => {
        snap = { canvas, version }
        return canvas
      })
      .catch((err) => {
        console.warn('[intro] capture failed', err)
        return null
      })
      .finally(() => {
        inflight = null
      })
    inflight = { p, version }
    // Stale result (input happened meanwhile): while watching, skip — the next idle period
    // captures again; once smashing (input is ignored) capture the final state.
    return p.then((c) => (!c || version === inputVersion ? c : phase === 'smashing' ? ensureCapture() : null))
  }

  /** Capture + GPU warm-up during the idle phase, and upload the texture early. */
  let uploaded: HTMLCanvasElement | null = null
  async function prepare() {
    const [s, canvas] = await Promise.all([ensureStage(), ensureCapture()])
    if (s && canvas && canvas !== uploaded && phase !== 'done') {
      s.setPage(canvas)
      uploaded = canvas
    }
  }

  // ------------------------------------------------------------------ idle detection + teasers
  function clearTimers() {
    while (timers.length) window.clearTimeout(timers.pop())
  }
  function schedule() {
    clearTimers()
    timers.push(window.setTimeout(() => sheet.setHung(true), (idleMs * 10) / 15))
    timers.push(window.setTimeout(() => void prepare(), (idleMs * 11) / 15))
    if (!reduced) {
      timers.push(
        window.setTimeout(() => {
          sheet.setRumble(true)
          sfx.rumble(true)
        }, (idleMs * 13) / 15),
      )
    }
    timers.push(window.setTimeout(() => smashNow(), idleMs))
  }

  let lastX = -1
  let lastY = -1
  function onInput(e: Event) {
    if (phase !== 'watch') return
    if (e.type === 'pointermove') {
      // Browsers synthesize pointermoves when content changes under a resting cursor
      // (wash, jitter). Only real movement counts.
      const p = e as PointerEvent
      if (Math.abs(p.clientX - lastX) < 1 && Math.abs(p.clientY - lastY) < 1) return
      lastX = p.clientX
      lastY = p.clientY
    }
    if (e.type === 'pointerdown' || e.type === 'keydown' || e.type === 'touchstart') sfx.unlock()
    inputVersion++
    sheet.setHung(false)
    sheet.setRumble(false)
    sfx.rumble(false)
    schedule()
  }
  for (const type of INPUT_EVENTS) window.addEventListener(type, onInput, { capture: true, passive: true })
  function removeInputListeners() {
    for (const type of INPUT_EVENTS) window.removeEventListener(type, onInput, { capture: true })
  }

  // ------------------------------------------------------------------ smash
  function notifyStart() {
    if (startedNotified) return
    startedNotified = true
    try {
      opts.onSmashStart()
    } catch (err) {
      console.error(err)
    }
  }

  function smashNow() {
    if (phase !== 'watch') return
    phase = 'smashing'
    clearTimers()
    removeInputListeners()
    sheet.closeDialog()
    sheet.freeze(true)
    if (!manualClock) {
      hardTimer = window.setTimeout(finish, HARD_TIMEOUT_MS)
      prepTimer = window.setTimeout(() => {
        if (phase === 'smashing' && !playing) {
          console.warn('[intro] smash not ready in time, using DOM fallback')
          void domFallback()
        }
      }, PREP_TIMEOUT_MS)
    }
    if (reduced) {
      fade()
      return
    }
    // If nothing is prepared yet (manual trigger), the window visibly "hangs" while we capture.
    if (!snap || snap.version !== inputVersion) sheet.setHung(true)
    void run()
  }

  async function run() {
    const [s, canvas] = await Promise.all([ensureStage(), ensureCapture(), sfx.ready()])
    if (phase !== 'smashing' || fallbackStarted) return
    if (!s || !canvas) {
      sheet.setRumble(false)
      sfx.rumble(false)
      void domFallback()
      return
    }
    try {
      playing = true
      window.clearTimeout(prepTimer)
      if (!manualClock) {
        // Watchdog: the show may run slowly on weak GPUs, but it must keep moving.
        let lastProgress = -1
        let stalledFor = 0
        playTimer = window.setInterval(() => {
          if (document.hidden) return
          const p = s.progress()
          stalledFor = p === lastProgress ? stalledFor + 500 : 0
          lastProgress = p
          if (stalledFor >= STALL_MS) finish()
        }, 500)
      }
      if (canvas !== uploaded) s.setPage(canvas)
      uploaded = canvas
      const wash = sheet.isHung() ? WASH_ALPHA : 0
      s.play({
        onSwap: () => {
          sheet.setRumble(false)
          sfx.rumble(false)
          sheet.el.style.visibility = 'hidden'
          notifyStart()
        },
        onDone: finish,
      }, { wash })
    } catch (err) {
      console.error('[intro] smash failed', err)
      sheet.el.style.visibility = ''
      void domFallback()
    }
  }

  /** Keyboard skip link: no theatrics, just reveal. */
  function skip() {
    if (phase !== 'watch') return
    phase = 'smashing'
    clearTimers()
    removeInputListeners()
    fade()
  }

  /** prefers-reduced-motion: a short fade + drop instead of the hammer. */
  function fade() {
    notifyStart()
    const anim = sheet.el.animate(
      [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: 'translateY(18px)' },
      ],
      { duration: 500, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' },
    )
    anim.onfinish = finish
  }

  /** No WebGL or capture failed: clip-path tiles that fall with CSS 3D transforms. */
  let fallbackStarted = false
  async function domFallback() {
    if (fallbackStarted) return
    fallbackStarted = true
    window.clearTimeout(prepTimer)
    try {
      const { runDomShatter } = await import('./fallback')
      if (phase !== 'smashing') return
      stage?.dispose()
      stage = null
      notifyStart()
      await runDomShatter(root, sheet.el, { mobile })
      finish()
    } catch (err) {
      console.error('[intro] fallback failed', err)
      fade()
    }
  }

  function finish() {
    if (phase === 'done') return
    phase = 'done'
    window.clearTimeout(hardTimer)
    window.clearTimeout(prepTimer)
    window.clearInterval(playTimer)
    clearTimers()
    removeInputListeners()
    try {
      stage?.dispose()
    } catch {
      /* ignore */
    }
    stage = null
    sheet.destroy()
    sfx.dispose()
    notifyStart()
    try {
      opts.onRevealed()
    } catch (err) {
      console.error(err)
    }
  }

  // Warm the lazy chunks after first paint so the smash is ready when needed.
  const warmTimer = window.setTimeout(() => {
    if (!reduced) void loadSmash().catch(() => {})
    void import('html2canvas-pro').catch(() => {})
  }, 1200)

  window.__oneIntro = {
    smashNow: () => smashNow(),
    phase: () => phase,
    advance: manualClock ? (ms: number) => stage?.advance?.(ms) : undefined,
  }

  schedule()

  return {
    smashNow,
    destroy() {
      const wasDone = phase === 'done'
      phase = 'done'
      window.clearTimeout(warmTimer)
      window.clearTimeout(hardTimer)
      window.clearTimeout(prepTimer)
      window.clearInterval(playTimer)
      clearTimers()
      removeInputListeners()
      stage?.dispose()
      stage = null
      if (!wasDone) sheet.destroy()
      sfx.dispose()
      root.innerHTML = ''
      if (window.__oneIntro) delete window.__oneIntro
    },
  }
}
