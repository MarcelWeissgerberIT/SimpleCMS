/**
 * Landing entry. Orchestrates:
 *   1. The new site (src/landing/site) — always mounted underneath.
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
import { mountSite } from './site/site'

const params = new URLSearchParams(window.location.search)
const forceIntro = params.has('intro')
const skipIntro = params.has('skip')
const introSeen = safeLocalGet(STORAGE_KEYS.introSeen) === '1'
const showIntro = forceIntro || (!introSeen && !skipIntro)

const lang = detectLang()
document.documentElement.lang = lang

const site = mountSite(document.getElementById('site')!, { lang, underIntro: showIntro })

let entered = false
const enter = (instant: boolean) => {
  if (entered) return
  entered = true
  site.playEntrance({ instant })
}
const removeIntro = () => {
  document.documentElement.classList.remove('intro-active')
  document.getElementById('intro')?.remove()
}

if (showIntro) {
  document.documentElement.classList.add('intro-active')
  // Lazy-load the intro (Three.js etc.) so returning visitors never download it.
  import('./intro/intro')
    .then(({ mountIntro }) => {
      mountIntro(document.getElementById('intro')!, {
        lang,
        idleMs: 15000,
        onSmashStart: () => {
          safeLocalSet(STORAGE_KEYS.introSeen, '1')
          site.prepareReveal()
        },
        // The new site starts assembling behind the falling shards.
        onShatter: () => enter(false),
        onRevealed: () => {
          removeIntro()
          enter(false)
        },
      })
    })
    .catch((err) => {
      // Never strand a visitor on the old page if the intro chunk fails to load.
      console.error('[one] intro failed to load', err)
      removeIntro()
      enter(true)
    })
} else {
  removeIntro()
  enter(true)
}
