/**
 * Work orders — the press's reasons in words (the plate's strip, toasts, ⌘K). Each says what to do, without a prefix;
 * 'offline' is the worker link's own reason (codingConnText, as Preflight's worker card says it).
 */
import { t, currentLang } from '../../../i18n'
import { useCoding } from '../state'
import { workerDownText } from '../stateText'
import { outdatedNotice } from '../outdated'
import type { ChainProjectProblem } from '../chain'
import type { OrderPreKind, OrderPreWhy } from './pre'

export function preWhyText(why: OrderPreWhy | 'running' | 'gone' | 'planning', left: OrderPreKind[] = []): string {
  const s = useCoding.getState()
  switch (why) {
    case 'offline':
      return s.enabled && s.conn !== 'connected' && s.conn !== 'off' ? workerDownText(t, s) : t('features.coding.order.why.offline')
    case 'outdated':
      return outdatedNotice(t, s.can)
    case 'unsafe':
      return t('features.coding.worker.unsafe', { version: s.worker?.worker ?? '?' })
    case 'readOnly':
      return t('features.coding.setup.readOnly')
    case 'noProject':
      return t('features.coding.order.why.noProject', { list: left.map((k) => `${t(`features.coding.pipe.${k.kind}`)}: ${problemText(k.problem)}`).join(' · ') || '—' })
    default:
      return t(`features.coding.order.why.${why}`)
  }
}

export const problemText = (p: ChainProjectProblem | null): string => (p ? t(`features.coding.order.problem.${p}`) : '')

/** "bis Sa 14:30" — when a kept press expires (24 h after it). */
export function untilText(at: number): string {
  const lang = currentLang()
  return new Date(at).toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
}
