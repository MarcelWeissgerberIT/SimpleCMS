/**
 * Landing entry. Orchestrates:
 *   1. The new site (src/landing/site) — always mounted underneath (on a first visit right
 *      after the intro has painted, so the 1997 page shows up as early as possible).
 *   2. First visit only: the deliberately awful 1997 spreadsheet page (src/landing/intro)
 *      on top. After 15 s without ANY user input a 3D hammer smashes it, the old page
 *      shatters and falls away, revealing the new site.
 *   The "seen" flag lives in localStorage (STORAGE_KEYS.introSeen).
 *   ?intro forces a replay, ?skip skips it.
 */
import '@/shared/fonts'
import '@/shared/tokens.css'
import './landing.css'
import { STORAGE_KEYS, safeLocalGet, safeLocalSet } from '@/shared/brand'
import { detectLang } from '@/shared/i18n'
import { mountSite, type SiteHandle } from './site/site'
import { registerServiceWorker } from '@/shared/sw'
import { gsap } from 'gsap'

// Dev-only hook so scripts/record-intro.mjs can render the site entrance frame by frame.
if (import.meta.env.DEV) (window as unknown as { __gsap?: typeof gsap }).__gsap = gsap

const params = new URLSearchParams(window.location.search)
const forceIntro = params.has('intro')
const skipIntro = params.has('skip')
const introSeen = safeLocalGet(STORAGE_KEYS.introSeen) === '1'
const showIntro = forceIntro || (!introSeen && !skipIntro)

const lang = detectLang()
document.documentElement.lang = lang

// Lazy-load the intro (Three.js etc. stays lazy inside it) so returning visitors never
// download it. It is requested first thing: the 1997 page must not queue behind the site.
const introModule = showIntro ? import('./intro/intro') : null

const siteRoot = document.getElementById('site')!
let site: SiteHandle | null = null
/**
 * Building the site costs a few hundred ms (mostly the first layout of a long page). Under the
 * intro it is invisible anyway, so it is built right after the 1997 page has painted — or on
 * demand, whichever comes first.
 */
const getSite = (): SiteHandle => (site ??= mountSite(siteRoot, { lang, underIntro: showIntro }))

let entered = false
const enter = (instant: boolean) => {
  if (entered) return
  entered = true
  getSite().playEntrance({ instant })
}
const removeIntro = () => {
  document.documentElement.classList.remove('intro-active')
  document.getElementById('intro')?.remove()
}

if (introModule) {
  document.documentElement.classList.add('intro-active')
  // Backstop for a slow intro chunk: build the (veiled) site anyway; its own failsafe
  // unveils it if the intro never shows up.
  const backstop = window.setTimeout(getSite, 2500)
  introModule
    .then(({ mountIntro }) => {
      mountIntro(document.getElementById('intro')!, {
        lang,
        idleMs: 15000,
        onSmashStart: () => {
          safeLocalSet(STORAGE_KEYS.introSeen, '1')
          getSite().prepareReveal()
        },
        // The new site starts assembling behind the falling shards.
        onShatter: () => enter(false),
        onRevealed: ({ focus }) => {
          removeIntro()
          enter(false)
          // Keyboard focus was on the old page (e.g. "Skip intro"): hand it to the site
          // instead of letting it fall back to <body>.
          if (focus) document.getElementById('main')?.focus({ preventScroll: true })
        },
      })
      // rAF runs right before the 1997 page's first paint; the timeout right after it.
      requestAnimationFrame(() =>
        window.setTimeout(() => {
          window.clearTimeout(backstop)
          getSite()
        }, 0),
      )
    })
    .catch((err) => {
      // Never strand a visitor on the old page if the intro chunk fails to load.
      console.error('[one] intro failed to load', err)
      window.clearTimeout(backstop)
      removeIntro()
      enter(true)
    })
} else {
  removeIntro()
  enter(true)
}

registerServiceWorker()
