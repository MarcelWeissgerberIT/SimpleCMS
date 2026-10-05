/** Small text helpers of the script UI (counts, descriptions of functions). */
import type { Translate } from '@/shared/i18n'

/** "0 results" · "1 result" · "12 results" */
export function rowsLabel(t: Translate, n: number): string {
  return t(n === 0 ? 'features.script.result.rows.zero' : n === 1 ? 'features.script.result.rows.one' : 'features.script.result.rows.other', { n })
}

/** The one-line description of a function or method ('' when there is none). */
export function fnDesc(t: Translate, name: string): string {
  const key = `features.script.fn.${name}`
  const text = t(key)
  return text === key ? '' : text
}

export const pad2 = (n: number) => String(n).padStart(2, '0')
