/**
 * The first-visit intro: a deliberately awful 1997 spreadsheet "homepage". After `idleMs`
 * without ANY input a 3D sledgehammer smashes it and the pieces fall away, revealing the
 * new site underneath.
 *
 *   idle  ~20%  → GPU warm-up starts (Three.js stage built in idle-callback slices)
 *         ~67%  → "(Not Responding)" + white wash + busy cursor, animations freeze
 *         ~73%  → html2canvas snapshot of the frozen window (texture for WebGL)
 *         ~87%  → rumble: window jitter + dust specks (+ low rumble if audio is unlocked)
 *         100%  → smash (Three.js, lazy-loaded) — or a reduced-motion fade / DOM fallback
 *
 * Any input (pointermove/down, key, wheel, touch, scroll) resets the timer and reverts teasers.
 * Visitors who keep moving get a hint after ~6 s: the status bar blinks "do nothing for 15 s",
 * the webmaster's Tip! note opens (pinned) and the NUM slot turns into an idle meter.
 * A resize also counts as input and throws away the size-bound GPU stage + snapshot.
 * Idle time only counts while the tab is visible: a background tab never uses up the intro.
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
  /**
   * Optional: the old page breaks apart (final hit / tiles start falling). The new site can
   * start its entrance here so it lights up behind the falling shards. Fires before onRevealed.
   */
  onShatter?: () => void
  /**
   * Fired after the old page has fully fallen away and the overlay can be removed.
   * `focus`: keyboard focus was inside the old page (e.g. "Skip intro") and is about to be
   * lost with it — the site should take it.
   */
  onRevealed: (info: { focus: boolean }) => void
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
/** If capture + GPU warm-up are not ready by then (visible time), use the DOM fallback. */
const PREP_TIMEOUT_MS = 6000
/** The sequence must make progress at least this often (else: reveal right away). */
const STALL_MS = 3000
/** Absolute guard (visible time) from the smash trigger: very slow GPUs still finish. */
const HARD_TIMEOUT_MS = 40000
/** After this long on the page (visible time) without the smash, hint at the trick. */
const HINT_AFTER_MS = 6000
/** Steps of the idle meter in the status bar (the copy says "15 seconds"). */
const IDLE_STEPS = 15

const isMobileViewport = () => Math.min(window.innerWidth, window.innerHeight) < 600 || window.innerWidth < 720

/** A clock that only advances while the document is visible. */
function visibleClock() {
  let acc = 0
  let since = document.hidden ? -1 : performance.now()
  const onVis = () => {
    const now = performance.now()
    if (document.hidden) {
      if (since >= 0) acc += now - since
      since = -1
    } else if (since < 0) since = now
  }
  document.addEventListener('visibilitychange', onVis)
  const now = () => acc + (since >= 0 ? performance.now() - since : 0)
  return {
    /** Like setTimeout, but only visible time counts. Returns a cancel function. */
    timeout(fn: () => void, ms: number): () => void {
      const due = now() + ms
      const id = window.setInterval(() => {
        if (now() >= due) {
          window.clearInterval(id)
          fn()
        }
      }, 200)
      return () => window.clearInterval(id)
    },
    dispose: () => document.removeEventListener('visibilitychange', onVis),
  }
}

const noop = () => {}

export function mountIntro(root: HTMLElement, opts: IntroOptions): IntroHandle {
  const params = new URLSearchParams(window.location.search)
  const idleMs = params.has('fast') ? 2000 : opts.idleMs
  const manualClock = params.get('smashclock') === 'manual'
  const noWebGL = params.has('nowebgl') // test aid: force the DOM fallback
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let mobile = isMobileViewport()
  const t = makeTranslator(messages, opts.lang)
  const sfx = new Sfx()
  const vclock = visibleClock()

  let phase: Phase = 'watch'
  let startedNotified = false
  let shatterNotified = false
  let cancelHard = noop
  let cancelPrep = noop
  let playTimer = 0
  let playing = false
  /** Keyboard focus sat inside the old page when it started to go away. */
  let hadFocus = false
  /** The hint is showing (after HINT_AFTER_MS): the idle meter runs from `idleSince`. */
  let hinted = false
  let idleSince = performance.now()
  let meterTimer = 0
  const timers: number[] = []

  const sheet = mountSheet(root, { t, lang: opts.lang, reducedMotion: reduced, onUpgrade: () => smashNow(), onSkip: () => skip() })

  // ------------------------------------------------------------------ lazy modules / GPU stage
  let smashModP: Promise<typeof import('./smash/smash')> | null = null
  const loadSmash = () => (smashModP ??= import('./smash/smash'))
  let stageP: Promise<SmashStage | null> | null = null
  let stage: SmashStage | null = null
  /** Bumped whenever the stage must be rebuilt (resize): late results of older builds are dropped. */
  let stageGen = 0
  function ensureStage(): Promise<SmashStage | null> {
    if (reduced || noWebGL) return Promise.resolve(null)
    if (stageP) return stageP
    const gen = stageGen
    const t0 = performance.now()
    stageP = loadSmash()
      .then((m) => m.createSmashStage(root, { mobile, sfx, manualClock }))
      .then((s) => {
        if (phase === 'done' || gen !== stageGen) {
          s.dispose()
          return null
        }
        const ms = Math.round(performance.now() - t0)
        console.debug(`[intro] GPU stage ready in ${ms} ms`)
        stage = s
        return s
      })
      .catch((err) => {
        console.warn('[intro] WebGL smash unavailable, using DOM fallback', err)
        return null
      })
    return stageP
  }
  /** The window size changed: the stage, the snapshot and the uploaded texture are stale. */
  function dropStage() {
    stageGen++
    stage?.dispose()
    stage = null
    stageP = null
    uploaded = null
    snap = null
    mobile = isMobileViewport()
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
        if (phase !== 'done') snap = { canvas, version }
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
    if (s && s === stage && canvas && canvas !== uploaded && phase !== 'done') {
      s.setPage(canvas)
      uploaded = canvas
    }
  }

  // ------------------------------------------------------------------ idle detection + teasers
  function clearTimers() {
    while (timers.length) window.clearTimeout(timers.pop())
  }
  function calm() {
    sheet.setHung(false)
    sheet.setRumble(false)
    sfx.rumble(false)
  }
  function schedule() {
    clearTimers()
    idleSince = performance.now()
    sheet.setIdle(hinted ? 0 : null)
    if (document.hidden) return // resumes from zero on visibilitychange
    if (!reduced) {
      // Build the GPU stage early, in idle slices (shader compiles must never delay the smash).
      timers.push(window.setTimeout(() => void ensureStage(), (idleMs * 3) / 15))
    }
    timers.push(
      window.setTimeout(() => {
        if (hinted) sheet.setIdle(10) // the meter freezes with the window
        sheet.setHung(true)
      }, (idleMs * 10) / 15),
    )
    if (!reduced) {
      timers.push(window.setTimeout(() => void prepare(), (idleMs * 11) / 15))
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
    calm()
    schedule()
  }
  for (const type of INPUT_EVENTS) window.addEventListener(type, onInput, { capture: true, passive: true })

  /** Background tab: nothing counts while hidden; idle starts from zero when visible again. */
  function onVisibility() {
    if (phase !== 'watch') return
    if (document.hidden) {
      clearTimers()
      calm()
    } else schedule()
  }
  document.addEventListener('visibilitychange', onVisibility)

  let lastW = window.innerWidth
  let lastH = window.innerHeight
  function onResize() {
    if (phase !== 'watch') return
    if (window.innerWidth === lastW && window.innerHeight === lastH) return
    lastW = window.innerWidth
    lastH = window.innerHeight
    dropStage()
    inputVersion++
    calm()
    schedule()
  }
  window.addEventListener('resize', onResize)

  function removeInputListeners() {
    for (const type of INPUT_EVENTS) window.removeEventListener(type, onInput, { capture: true })
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('resize', onResize)
  }

  // Visitors who keep moving never trigger the smash: surface the trick (status bar blink,
  // pinned Tip! note) and turn the NUM slot into an idle meter fed by the idle timer.
  const cancelHint = vclock.timeout(() => {
    if (phase !== 'watch') return
    hinted = true
    sheet.setHint(true)
    const step = idleMs / IDLE_STEPS
    const tick = () => {
      if (phase !== 'watch' || document.hidden) return
      sheet.setIdle(Math.min(IDLE_STEPS, Math.floor((performance.now() - idleSince) / step)))
    }
    tick()
    meterTimer = window.setInterval(tick, Math.max(50, step / 4))
  }, HINT_AFTER_MS)
  function stopMeter() {
    window.clearInterval(meterTimer)
    meterTimer = 0
  }

  // ------------------------------------------------------------------ smash
  /** The old page is really going away in front of the visitor: persist "seen". */
  function notifyStart() {
    if (startedNotified) return
    startedNotified = true
    try {
      opts.onSmashStart()
    } catch (err) {
      console.error(err)
    }
  }
  function notifyShatter() {
    if (shatterNotified) return
    shatterNotified = true
    try {
      opts.onShatter?.()
    } catch (err) {
      console.error(err)
    }
  }

  /** Remember whether the keyboard was inside the old page (it is about to disappear). */
  function noteFocus() {
    const a = document.activeElement
    hadFocus = !!a && a !== document.body && root.contains(a)
  }

  function smashNow() {
    if (phase !== 'watch') return
    noteFocus()
    phase = 'smashing'
    clearTimers()
    cancelHint()
    stopMeter()
    removeInputListeners()
    sheet.closeDialog()
    sheet.freeze(true)
    if (!manualClock) {
      // Visible-time guards: a hidden tab (no rAF) must not burn through them unseen.
      cancelHard = vclock.timeout(finish, HARD_TIMEOUT_MS)
      cancelPrep = vclock.timeout(() => {
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
      calm()
      void domFallback()
      return
    }
    try {
      playing = true
      cancelPrep()
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
      s.play(
        {
          onSwap: () => {
            calm()
            sheet.el.style.visibility = 'hidden'
            notifyStart()
          },
          onShatter: notifyShatter,
          onDone: finish,
        },
        { wash },
      )
    } catch (err) {
      console.error('[intro] smash failed', err)
      sheet.el.style.visibility = ''
      void domFallback()
    }
  }

  /** Keyboard skip link: no theatrics, just reveal. */
  function skip() {
    if (phase !== 'watch') return
    noteFocus()
    phase = 'smashing'
    clearTimers()
    cancelHint()
    stopMeter()
    removeInputListeners()
    fade()
  }

  /** prefers-reduced-motion: a short fade + drop instead of the hammer. */
  function fade() {
    notifyStart()
    notifyShatter()
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
    cancelPrep()
    try {
      const { runDomShatter } = await import('./fallback')
      if (phase !== 'smashing') return
      stage?.dispose()
      stage = null
      notifyStart()
      await runDomShatter(root, sheet.el, { mobile, onBreak: notifyShatter })
      finish()
    } catch (err) {
      console.error('[intro] fallback failed', err)
      fade()
    }
  }

  /** Drop every reference to big buffers (snapshot, stage, canvases) so they can be collected. */
  function release() {
    cancelHard()
    cancelPrep()
    cancelHint()
    stopMeter()
    window.clearInterval(playTimer)
    clearTimers()
    removeInputListeners()
    vclock.dispose()
    try {
      stage?.dispose()
    } catch {
      /* ignore */
    }
    stageGen++
    stage = null
    stageP = null
    smashModP = null
    snap = null
    inflight = null
    uploaded = null
    if (window.__oneIntro === hooks) delete window.__oneIntro
  }

  /**
   * Reveal the site. Only a visible sequence (swap / fallback / fade) marks the intro as seen;
   * the timeout paths (stalled GPU, hard guard) reveal without consuming it.
   */
  function finish() {
    if (phase === 'done') return
    phase = 'done'
    release()
    sheet.destroy()
    sfx.dispose()
    try {
      opts.onRevealed({ focus: hadFocus })
    } catch (err) {
      console.error(err)
    }
  }

  // Warm the lazy chunks after first paint so the smash is ready when needed.
  const warmTimer = window.setTimeout(() => {
    if (reduced) return
    void loadSmash().catch(() => {})
    void import('html2canvas-pro').catch(() => {})
  }, 1200)

  const hooks: NonNullable<Window['__oneIntro']> = {
    smashNow: () => smashNow(),
    phase: () => phase,
    advance: manualClock ? (ms: number) => stage?.advance?.(ms) : undefined,
  }
  window.__oneIntro = hooks

  schedule()

  return {
    smashNow,
    destroy() {
      const wasDone = phase === 'done'
      phase = 'done'
      window.clearTimeout(warmTimer)
      release()
      if (!wasDone) sheet.destroy()
      sfx.dispose()
      root.innerHTML = ''
    },
  }
}
