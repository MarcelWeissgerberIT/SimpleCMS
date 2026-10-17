/**
 * Work orders — the chain's words that land in step pages (the slot, the Grundlage heading, the skipped line, the cut
 * note), pure: the caller passes its translator (the app: i18n `t` + `currentLang()`; a Node spec: makeTranslator over
 * coding/messages.ts). Step numbers are two digits ("01"), counts in the UI's number format.
 */
import type { Lang, Translate } from '@/shared/i18n'
import type { OrderKind } from './types'

/** A step number as the chain shows it: 1 → "01". */
export const stepNo = (n: number): string => String(n).padStart(2, '0')

export interface ChainWords {
  /** analysis · coding · QA */
  kind: (kind: OrderKind) => string
  /** "From step 01 (analysis): ‹title›" — the Grundlage's heading */
  basisHeading: (n: number, kind: OrderKind, title: string) => string
  /** "Step 02 skipped — no basis" */
  skipped: (n: number) => string
  /** "Waits for step 01" — the slot a step page starts with */
  waits: (n: number) => string
  /** "Cut: 20,000 of 31,204 characters of step 01" */
  cutNote: (n: number) => (shown: number, total: number) => string
}

export function chainWords(tr: Translate, lang: Lang): ChainWords {
  const num = new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US')
  const kind = (k: OrderKind) => tr(`features.coding.order.kind.${k}`)
  return {
    kind,
    basisHeading: (n, k, title) => `${tr('features.coding.order.chain.basis', { n: stepNo(n), kind: kind(k) })} ${title.replace(/\s+/g, ' ').trim()}`.trim(),
    skipped: (n) => tr('features.coding.order.chain.skipped', { n: stepNo(n) }),
    waits: (n) => tr('features.coding.order.chain.waitsStep', { n: stepNo(n) }),
    cutNote: (n) => (shown, total) => tr('features.coding.order.chain.basisCut', { shown: num.format(shown), total: num.format(total), n: stepNo(n) }),
  }
}
