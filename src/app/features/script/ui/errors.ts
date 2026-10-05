/** Error messages of One Script in the UI language (features.script.err.<code>). */
import type { Translate } from '@/shared/i18n'
import type { ErrorInfo } from '../runtime/types'

/** Words the runtime puts into messages ("No page …", "matches 2 pages") — translated when known. */
const WHAT = new Set(['page', 'pages', 'database', 'person', 'agent', 'script', 'reference', 'list', 'text'])

export function errorMessage(e: Pick<ErrorInfo, 'code' | 'params'>, t: Translate): string {
  const key = `features.script.err.${e.code}`
  const params = { ...e.params }
  if (typeof params.what === 'string' && WHAT.has(params.what)) params.what = t(`features.script.what.${params.what}`)
  const text = t(key, params)
  return text === key ? t('features.script.err.internal', { detail: e.code }) : text
}
