/**
 * Work orders — the press's reasons in words (the plate's strip, toasts, ⌘K). Each says what to do, without a prefix;
 * 'offline' is the worker link's own reason (codingConnText, as Preflight's worker card says it).
 */
import { t, currentLang } from '../../../i18n'
import { useCoding } from '../state'
import { workerDownText } from '../stateText'
import { outdatedNotice } from '../outdated'
import type { OrderPreKind, OrderPreWhy } from './pre'
import type { KindProblem } from './preconditions'
import type { PlanOutcome } from './planner'

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

export const problemText = (p: KindProblem | null): string => (p ? t(`features.coding.order.problem.${p}`) : '')

const P = 'features.coding.order.planner'
/** Items 1–6: the strip says these from the live preconditions (preWhyText) — a run that ended on one adds nothing. */
const LIVE_WHYS = new Set(['codingOff', 'readOnly', 'elsewhere', 'offline', 'outdated', 'unsafe', 'noRepos', 'noProject'])

/**
 * How the planner's last run in this tab ended, when it made no plan — the plate's strip line (the planner's words,
 * plannerMessages.ts). null: it planned (Kette bereit / Rückfrage), or the live preconditions already say it.
 */
export function outcomeText(out: PlanOutcome, id: string): string | null {
  switch (out.kind) {
    case 'ready':
    case 'questions':
      return null
    case 'blocked': {
      const b = out.block
      if (LIVE_WHYS.has(b.why)) return null
      if (b.why === 'refused') return b.error instanceof Error && b.error.message ? b.error.message : t(`${P}.why.failed`)
      if (b.why === 'ai') return t(`${P}.why.ai`)
      return t(`${P}.why.${b.why}`)
    }
    case 'brake':
      return out.error.message || t('features.coding.order.chip.regler')
    case 'held':
      return t(`${P}.held`, { id })
    case 'stopped':
      return t(`${P}.stopped`)
    case 'failed':
      return t(out.code === 'malformed' ? `${P}.why.malformed` : `${P}.why.failed`)
    default:
      return t(`${P}.why.${out.kind}`)
  }
}

/** "bis Sa 14:30" — when a kept press expires (24 h after it). */
export function untilText(at: number): string {
  const lang = currentLang()
  return new Date(at).toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
}
