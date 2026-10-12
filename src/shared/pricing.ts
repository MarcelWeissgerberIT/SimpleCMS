/**
 * What One costs — the one place for the numbers and the donate address. The landing page (hero readout,
 * savings calculator, compare table, FAQ, "Own it"), Settings → About and the welcome page read them from here;
 * README, docs/CLOUD.md, docs/SELF_HOSTING.md and the help articles (team-cloud, self-hosting) say the same in
 * words — change them together.
 *
 *  - One in the browser (local): free.
 *  - Self-hosting the team server (AGPL-3.0): free. A donation is welcome, never required.
 *  - The hosted Team Cloud: 99 per user and year — euros on the German page, US dollars on the English page.
 *    It is in development: no sign-up exists yet, so every place that names the price says so.
 *
 * Pure (no DOM at import time, no import.meta, no app imports): Node specs import it directly.
 */
import type { Lang } from './i18n'

export const ONE_PRICING = {
  /** The hosted Team Cloud, per user and year. */
  cloudPerUserYear: { eur: 99, usd: 99 },
  /** Local and self-hosted: no licence fee. */
  selfHosted: 0,
} as const

/**
 * Where a donation for One goes. Empty = no donate link anywhere — the wording ("a donation is welcome") stays.
 * Set it only to an https address the owner gave. Never a made-up one.
 */
export const DONATE_URL: string = ''

/**
 * "$99" (English page) · "99 €" (German page) — the hosted Team Cloud per user and year. The German form joins
 * number and sign with a no-break space (written as an escape so nobody mistakes it for a plain one): it sits in
 * running text and must never wrap between "99" and "€".
 */
export function cloudPrice(lang: Lang): string {
  return lang === 'de' ? `${ONE_PRICING.cloudPerUserYear.eur}\u00a0€` : `$${ONE_PRICING.cloudPerUserYear.usd}`
}

/** A donate address that may become a link: https only (no javascript:, no http:), else null. */
export function donateHref(url: string): string | null {
  const s = url.trim()
  if (!s) return null
  try {
    const u = new URL(s)
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : null
  } catch {
    return null
  }
}

/** Specs only: under `?e2e` a test address from this localStorage key stands in for DONATE_URL. */
export const DONATE_TEST_KEY = 'one.donate-e2e'

/**
 * The donate link in effect: DONATE_URL — or, only when the page URL carries `?e2e`, a test address from
 * localStorage (DONATE_TEST_KEY), so the specs can show the link without a real address. A normal visit never
 * reads it, whatever localStorage holds.
 */
export function donateUrl(): string | null {
  if (typeof window !== 'undefined') {
    try {
      if (new URLSearchParams(window.location.search).has('e2e')) {
        const test = window.localStorage.getItem(DONATE_TEST_KEY)
        if (test) return donateHref(test)
      }
    } catch {
      /* storage blocked: the real address */
    }
  }
  return donateHref(DONATE_URL)
}
