/**
 * The Donate link of the site ("Own it" plate, footer). The address comes from src/shared/pricing.ts
 * (`donateUrl()`): while DONATE_URL is empty there is no link anywhere — the wording next to it
 * ("a donation is welcome, never required") stays. Pure: no DOM, no import.meta.
 */
import { esc } from './util'

export function donateLink(href: string | null, label: string, cls = ''): string {
  if (!href) return ''
  return `<a${cls ? ` class="${esc(cls)}"` : ''} href="${esc(href)}" rel="noopener" data-donate>${esc(label)}</a>`
}
