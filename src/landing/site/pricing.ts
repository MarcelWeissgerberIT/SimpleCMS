/**
 * Notion list prices used by the savings calculator.
 *
 * Verified against https://www.notion.com/pricing on 2 October 2026
 * (plan data embedded in the page: plus_monthly_usd_202407 = 1200¢, plus_yearly = 12000¢,
 * business_monthly_usd_202505 = 2400¢, business_yearly = 24000¢). Notion lists prices in USD,
 * per member, excl. tax. Business includes Notion AI; Free and Plus only get an AI trial.
 * Update `asOf` together with the numbers.
 *
 * One's own prices live in src/shared/pricing.ts. The calculator counts in USD on both pages: Notion lists its
 * prices only in USD (its pricing page shows no other currency; docs/RESEARCH.md § 4.3 — the Business EUR price
 * is unconfirmed), and a bill in USD minus a price in EUR would mix currencies. So the Team Cloud enters with its
 * USD price; the German page says that next to it (99 € there, $99 here).
 */
import type { Lang } from '@/shared/i18n'
import { ONE_PRICING } from '@/shared/pricing'

export type NotionPlan = 'plus' | 'business'
export type Billing = 'monthly' | 'annual'

export const NOTION_PRICING = {
  asOf: { en: 'October 2026', de: 'Oktober 2026' } as Record<Lang, string>,
  source: 'https://www.notion.com/pricing',
  currency: 'USD',
  /** USD per member per month. */
  perSeatMonth: {
    plus: { monthly: 12, annual: 10 },
    business: { monthly: 24, annual: 20 },
  } as Record<NotionPlan, Record<Billing, number>>,
} as const

export function notionYearly(plan: NotionPlan, billing: Billing, seats: number): number {
  return NOTION_PRICING.perSeatMonth[plan][billing] * seats * 12
}

/** The One Team Cloud for `seats` users, one year, in USD (planned price; local and self-hosted cost nothing). */
export function cloudYearly(seats: number): number {
  return ONE_PRICING.cloudPerUserYear.usd * seats
}

/** What a team keeps a year with the One Team Cloud instead of Notion (USD). */
export function keptWithCloud(plan: NotionPlan, billing: Billing, seats: number): number {
  return notionYearly(plan, billing, seats) - cloudYearly(seats)
}

/** One formatter per (language, cents): building an Intl.NumberFormat is expensive (tens of ms cold). */
const usdFormats = new Map<string, Intl.NumberFormat>()

export function formatUsd(value: number, lang: Lang, cents = true): string {
  const key = `${lang}:${cents ? 1 : 0}`
  let f = usdFormats.get(key)
  if (!f) {
    f = new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: cents ? 2 : 0,
      maximumFractionDigits: cents ? 2 : 0,
    })
    usdFormats.set(key, f)
  }
  return f.format(value)
}
