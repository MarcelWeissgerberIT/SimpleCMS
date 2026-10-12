/**
 * The error help of step 02 (UX § 4.3): one entry per normalised code × provider — what happened, in one sentence that
 * says what was sent (the free check sends no text), likely causes, and the keys that help. OAuth issues of connecting
 * OpenRouter (OROAuthIssue) read their own sentences (providers/messages.ts) and offer "Connect again" / "Paste a key".
 */
import type { AIErrorCode } from '@/shared/ai/errors'
import type { ProviderId } from '@/shared/ai/types'
import { providerInfo } from '@/shared/ai/providers'
import { t } from '../../../i18n'

export type HelpKey = 'newPaste' | 'keyPage' | 'later' | 'topUp' | 'limit' | 'retry' | 'help' | 'connectAgain'

export interface ErrorHelp {
  /** the lamp cap's text (401 · 402 · 429 …) */
  cap: string
  tone: 'red' | 'amber'
  /** one sentence (may hold <b>…</b>) */
  text: string
  causes: string[]
  keys: HelpKey[]
}

const CAPS: Partial<Record<AIErrorCode, string>> = { invalid_key: '401', permission: '403', no_credit: '402', busy: '402', rate_limit: '429', unavailable: '503', offline: 'NET', timeout: '504' }

/** The help for a failed free check of `p`. */
export function helpFor(code: AIErrorCode, p: ProviderId, which: 'credit' | 'key' | 'budget' | 'any' = 'any'): ErrorHelp {
  const info = providerInfo(p)
  const cap = CAPS[code] ?? code.toUpperCase().slice(0, 6)
  switch (code) {
    case 'invalid_key':
      return {
        cap,
        tone: 'red',
        text: t('features.ai.prov.err.invalid_key', { company: info.company }),
        causes: [t('features.ai.prov.err.invalid_key.cause1', { prefix: info.keyPrefix }), t('features.ai.prov.err.invalid_key.cause2')],
        keys: ['newPaste', 'keyPage', 'later'],
      }
    case 'permission':
      return { cap, tone: 'red', text: t('features.ai.prov.err.permission'), causes: [], keys: ['keyPage', 'later'] }
    case 'no_credit':
      return { cap, tone: 'amber', text: t('features.ai.prov.err.no_credit', { which: t(`features.ai.prov.err.no_credit.${which}`) }), causes: [], keys: p === 'openrouter' ? ['topUp', 'limit', 'later'] : ['limit', 'later'] }
    case 'busy':
      return { cap, tone: 'amber', text: t('features.ai.prov.err.busy'), causes: [], keys: ['retry'] }
    case 'rate_limit':
      return { cap, tone: 'amber', text: t('features.ai.prov.err.rate_limit', { time: '0:30' }), causes: [], keys: ['retry'] }
    case 'unavailable':
    case 'timeout':
    case 'overloaded':
      return { cap, tone: 'amber', text: t('features.ai.prov.err.unavailable', { company: info.company }), causes: [], keys: ['retry'] }
    case 'offline':
      return { cap, tone: 'amber', text: t('features.ai.prov.err.offline', { host: info.host }), causes: [], keys: ['retry', 'help'] }
    default:
      return { cap, tone: 'red', text: t('features.ai.prov.err.other', { code }), causes: [], keys: ['retry', 'later'] }
  }
}
