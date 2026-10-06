/**
 * The new SimpleCMS One marketing site — revealed underneath the smashed 1997
 * spreadsheet on the first visit, shown directly to returning visitors.
 * Vanilla TS + DOM strings; GSAP for motion. Public API (used by ../main.ts):
 *   mountSite(root, { lang, underIntro }) → { prepareReveal(), playEntrance({ instant }) }
 */
import './site.css'
import { STORAGE_KEYS, safeLocalGet, safeLocalSet } from '@/shared/brand'
import { makeTranslator, persistLang, type Lang } from '@/shared/i18n'
import { SECTIONS, type Ctx } from './context'
import { bindFrameTabs, bindFrames, bindLightbox, lightboxHtml } from './frame'
import { content, messages } from './messages'
import { heroMotion, initPrinter, initReveals, reprint, rollNumber, ScrollTrigger, type HeroMotion } from './motion'
import { renderCompare } from './sections/compare'
import { renderFaq, renderFooter, renderOwn } from './sections/closing'
import { renderDeep } from './sections/deep'
import { loadFeatureIcons, renderFeatures } from './sections/features'
import { bindHero, renderHero } from './sections/hero'
import { bindMcp, renderMcp } from './sections/mcp'
import { renderPrivacy } from './sections/privacy'
import { renderReview } from './sections/review'
import { bindTour, renderTour } from './sections/tour'
import { bindSavings, renderSavings } from './sections/savings'
import { renderTopbar } from './sections/topbar'
import { esc, prefersReducedMotion } from './util'

export interface SiteHandle {
  /** Called when the smash starts: get the site ready to be revealed (scroll to top, pre-entrance state). */
  prepareReveal(): void
  /** Run the entrance animation (instant=true: returning visitors, no theatrics). */
  playEntrance(opts: { instant: boolean }): void
}

/* ------------------------------------------------------------------ */
/* Theme: follow the workspace's stored choice, else the system          */
/* ------------------------------------------------------------------ */

function applyTheme(): void {
  const pref = safeLocalGet(STORAGE_KEYS.theme)
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
  const set = () => {
    const dark = pref === 'dark' || (pref !== 'light' && !!mq?.matches)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }
  set()
  if (pref !== 'dark' && pref !== 'light') mq?.addEventListener?.('change', set)
}

/* ------------------------------------------------------------------ */
/* Mount                                                                */
/* ------------------------------------------------------------------ */

export function mountSite(root: HTMLElement, opts: { lang: Lang; underIntro: boolean }): SiteHandle {
  applyTheme()
  root.classList.add('site')
  let lang = opts.lang
  /** Once true, re-renders skip the one-time scroll reveals. */
  let revealed = false
  let hero!: HeroMotion
  let cleanups: Array<() => void> = []

  const ctx = (): Ctx => ({ lang, t: makeTranslator(messages, lang), c: content[lang] })

  function render(): void {
    cleanups.forEach((f) => f())
    cleanups = []
    const c = ctx()
    document.title = c.t('meta.title')
    root.innerHTML = `
      <a class="skip" href="#main">${esc(c.t('skip'))}</a>
      ${renderTopbar(c)}
      <main id="main" tabindex="-1">
        ${renderHero(c)}
        ${renderReview(c)}
        ${renderSavings(c)}
        ${renderFeatures(c)}
        ${renderMcp(c)}
        ${renderDeep(c)}
        ${renderCompare(c)}
        ${renderPrivacy(c)}
        ${renderOwn(c)}
        ${renderFaq(c)}
      </main>
      ${renderFooter(c)}
      ${lightboxHtml(c.t('fig.close'))}
      ${renderTour(c)}`
    bindFrames(root)
    bindFrameTabs(root)
    cleanups.push(bindLightbox(root))
    cleanups.push(bindTour(root))
    bindSavings(root, c, { onReprint: reprint, rollNumber })
    void loadFeatureIcons(root)
    bindChrome()
    cleanups.push(bindHero(root))
    cleanups.push(bindMcp(root, c))
    hero = heroMotion(root, lang)
    // Reveals only on the first render and only once the visitor can actually see the site.
    cleanups.push(initReveals(root, { skip: revealed }))
    cleanups.push(initPrinter(root, { skip: revealed }))
    cleanups.push(initDial())
  }

  /* ---------- top bar: language, menu, dial, replay ---------- */

  function bindChrome(): void {
    root.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) =>
      b.addEventListener('click', () => {
        const next = b.dataset.lang as Lang
        if (next === lang) return
        switchLang(next)
      }),
    )
    const menuBtn = root.querySelector<HTMLButtonElement>('[data-menu]')
    const sheet = root.querySelector<HTMLElement>('#tb-sheet')
    const closeMenu = () => {
      if (!sheet || sheet.hidden) return
      sheet.hidden = true
      menuBtn?.setAttribute('aria-expanded', 'false')
    }
    menuBtn?.addEventListener('click', () => {
      if (!sheet) return
      sheet.hidden = !sheet.hidden
      menuBtn.setAttribute('aria-expanded', String(!sheet.hidden))
      if (!sheet.hidden) sheet.querySelector<HTMLElement>('a')?.focus()
    })
    sheet?.querySelectorAll('a').forEach((a) => a.addEventListener('click', closeMenu))
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sheet && !sheet.hidden) {
        closeMenu()
        menuBtn?.focus()
      }
    }
    const onDoc = (e: MouseEvent) => {
      if (sheet && !sheet.hidden && !(e.target as HTMLElement).closest('.tb')) closeMenu()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('click', onDoc)
    cleanups.push(() => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('click', onDoc)
    })

    root.querySelector('[data-replay]')?.addEventListener('click', () => {
      safeLocalSet(STORAGE_KEYS.introSeen, null)
      const url = new URL(window.location.href)
      url.search = '?intro'
      url.hash = ''
      window.location.href = url.toString()
    })
  }

  /** Radio-dial section scale + top-bar tone follow the scroll position. */
  function initDial(): () => void {
    const tb = root.querySelector<HTMLElement>('[data-tb]')
    const needle = root.querySelector<HTMLElement>('[data-needle]')
    const marks = Array.from(root.querySelectorAll<HTMLElement>('[data-dial]'))
    const secs = SECTIONS.map((s) => document.getElementById(s.id)).filter((x): x is HTMLElement => !!x)
    const tones = Array.from(root.querySelectorAll<HTMLElement>('[data-tone]')).filter((el) => el !== tb)
    let raf = 0
    let active = -1
    const n = secs.length - 1
    const update = () => {
      raf = 0
      if (!tb || !needle) return
      const probe = tb.offsetHeight + 4
      // Tone of whatever sits under the bar.
      for (const el of tones) {
        const r = el.getBoundingClientRect()
        if (r.top <= probe && r.bottom > probe) {
          const tone = el.dataset.tone ?? 'paper'
          if (tb.dataset.tone !== tone) {
            tb.dataset.tone = tone
            tb.classList.toggle('tone-carbon', tone === 'carbon')
            tb.classList.toggle('tone-signal', tone === 'signal')
          }
          break
        }
      }
      // Needle: piecewise-linear through the section offsets.
      const y = window.scrollY + probe
      let pos = 0
      for (let i = 0; i < secs.length; i++) {
        const top = secs[i].offsetTop
        const next = i < n ? secs[i + 1].offsetTop : document.documentElement.scrollHeight - window.innerHeight + probe
        if (y >= top) pos = i + Math.min(1, Math.max(0, (y - top) / Math.max(1, next - top))) * (i < n ? 1 : 0)
      }
      const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2
      if (atEnd) pos = n
      needle.style.setProperty('--p', (pos / n).toFixed(4))
      const idx = Math.min(n, Math.round(pos - 0.35 < 0 ? 0 : Math.floor(pos + 0.0001)))
      if (idx !== active) {
        active = idx
        marks.forEach((m, i) => (i === idx ? m.setAttribute('aria-current', 'true') : m.removeAttribute('aria-current')))
      }
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    update()
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      cancelAnimationFrame(raf)
    }
  }

  /* ---------- language switch: re-render, keep the reading position ---------- */

  function switchLang(next: Lang): void {
    // Anchor: the innermost block crossing the line under the top bar, and our offset into it.
    // Same DOM order in both languages → the index finds the twin after the re-render.
    const ANCHORS = 'main > section, .rv-gate, .rv-fig, .deep-row, .pgroup, .plac, .spec tr, .faq-item, .calc, .schematic, .plate, .mcp-port, .mcp-tools, .mcp-steps > li, .agent-plate, .mcp-agents-fig, footer'
    const probe = 90
    const before = Array.from(root.querySelectorAll<HTMLElement>(ANCHORS))
    let idx = -1
    let offset = 0
    let bestTop = -Infinity
    before.forEach((el, i) => {
      const r = el.getBoundingClientRect()
      if (r.top <= probe && r.bottom > probe && r.top >= bestTop) {
        bestTop = r.top
        idx = i
        offset = probe - r.top
      }
    })
    const focusLang = document.activeElement instanceof HTMLElement && document.activeElement.dataset.lang
    // Hold the document height while the DOM is swapped so the browser does not clamp the scroll.
    root.style.minHeight = `${root.offsetHeight}px`
    lang = next
    persistLang(next)
    revealed = true
    render()
    hero.play(true)
    const html = document.documentElement
    const prevBehavior = html.style.scrollBehavior
    html.style.scrollBehavior = 'auto'
    const el = idx >= 0 ? root.querySelectorAll<HTMLElement>(ANCHORS)[idx] : null
    if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY + offset - probe)
    html.style.scrollBehavior = prevBehavior
    root.style.minHeight = ''
    if (focusLang) root.querySelector<HTMLElement>(`[data-lang="${next}"]`)?.focus({ preventScroll: true })
    ScrollTrigger.refresh()
  }

  /* ---------- go ---------- */

  render()
  if (opts.underIntro) {
    // Stay invisible (and out of the tab order) until the smash starts, so nothing flashes
    // before the lazily loaded 1997 page covers the screen.
    root.classList.add('is-veiled')
    hero.prepare()
    // Failsafe: if the intro never shows up (chunk failed to load, script error), do not leave
    // the visitor with an empty — or unscrollable — page.
    const introMissing = () => {
      const intro = document.getElementById('intro')
      return root.classList.contains('is-veiled') && (!intro || !intro.childElementCount)
    }
    const rescue = () => {
      window.clearTimeout(timer)
      window.removeEventListener('unhandledrejection', onReject)
      if (!introMissing()) return
      // landing.css locks html/body (overflow hidden, height 100%) while .intro-active is set.
      document.documentElement.classList.remove('intro-active')
      document.getElementById('intro')?.remove()
      root.classList.remove('is-veiled')
      hero.play(true)
      ScrollTrigger.refresh()
    }
    // A failed lazy import of the intro surfaces as an unhandled rejection: rescue at once.
    const onReject = (e: PromiseRejectionEvent) => {
      const msg = String((e.reason as Error | undefined)?.message ?? e.reason ?? '')
      if (!/dynamically imported module|module script failed|Importing a module|error loading dynamically/i.test(msg)) return
      if (!introMissing()) return
      e.preventDefault() // handled: the site takes over
      console.warn('[site] intro failed to load, showing the site directly:', msg)
      rescue()
    }
    window.addEventListener('unhandledrejection', onReject)
    const timer = window.setTimeout(rescue, 5000)
  }

  // Layout settles once the variable fonts are in.
  document.fonts?.ready.then(() => ScrollTrigger.refresh()).catch(() => {})

  const handle: SiteHandle = {
    prepareReveal() {
      root.classList.remove('is-veiled')
      hero.prepare()
    },
    playEntrance({ instant }) {
      root.classList.remove('is-veiled')
      hero.play(instant || prefersReducedMotion())
      ScrollTrigger.refresh()
    },
  }
  if (import.meta.env.DEV) (window as unknown as { __oneSite?: SiteHandle }).__oneSite = handle
  return handle
}
