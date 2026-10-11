/**
 * The ONE key map for discard reasons — the agent run review and Preflight use the same keys: 1 = wrong (plus the
 * language's letter: F in German, W in English), 2 = not now, 3 = duplicate, 4 = handled already. Only the UI
 * language's letter is mapped, so a key never does what its cap does not show. Pure (a Node spec loads it).
 */
import type { Lang } from '@/shared/i18n'
import type { DiscardReason } from '../../ai/agent/types'

export const REASONS: readonly DiscardReason[] = ['wrong', 'notNow', 'duplicate', 'done']

/** The letter that also means "wrong" in a language. */
export const wrongLetter = (lang: Lang): 'f' | 'w' => (lang === 'de' ? 'f' : 'w')

/** wrong: '1' + the language's letter (de 'f', en 'w'); notNow '2'; duplicate '3'; done '4'. */
export function reasonKeys(lang: Lang): Record<DiscardReason, string[]> {
  return { wrong: ['1', wrongLetter(lang)], notNow: ['2'], duplicate: ['3'], done: ['4'] }
}

/** The reason a single key stands for (case-insensitive), or null. */
export function reasonOfKey(key: string, lang: Lang): DiscardReason | null {
  if (typeof key !== 'string' || key.length !== 1) return null
  const k = key.toLowerCase()
  const map = reasonKeys(lang)
  for (const r of REASONS) if (map[r].includes(k)) return r
  return null
}
