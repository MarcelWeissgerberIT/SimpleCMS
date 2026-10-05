/** Error messages of One Script in the UI language (features.script.err.<code>). */
import type { Translate } from '@/shared/i18n'
import type { ErrorInfo } from '../runtime/types'

export function errorMessage(e: Pick<ErrorInfo, 'code' | 'params'>, t: Translate): string {
  const key = `features.script.err.${e.code}`
  const text = t(key, e.params)
  return text === key ? t('features.script.err.internal', { detail: e.code }) : text
}
