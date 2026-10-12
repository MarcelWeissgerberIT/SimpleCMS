/**
 * Jev's reasons and labels in words (pure: the caller passes its translator) — a card's reason is One's fixed label of the
 * weakest question, never generated text; a check that did not happen says why.
 */
import type { JevCheck, JevCheckKey, JevWhy } from '@/shared/ai/decide'
import { jevLabel } from '@/shared/ai/jev'

type T = (key: string, vars?: Record<string, string | number>) => string

/** Why a change was not pre-checked ("Jev may not see "Database rows"", "no answer in time" …). */
export function whyText(t: T, why: JevWhy | undefined, cls?: string): string {
  if (why === 'policy') return cls ? t('features.ai.jev.why.policy', { class: t(`features.ai.cls.${cls}`) }) : t('features.ai.jev.why.policyAny')
  return t(`features.ai.jev.why.${why ?? 'error'}`)
}

/** A check's reason: the weakest question's label, or why there is none. */
export function checkReason(t: T, c: Pick<JevCheck, 'state' | 'low' | 'why' | 'cls'>): string {
  return c.state === 'ok' && c.low ? t(`features.ai.jev.q.${c.low}`) : whyText(t, c.why, c.cls)
}

/** A question's label. */
export const questionLabel = (t: T, k: JevCheckKey): string => t(`features.ai.jev.q.${k}`)

/** "Jev 1.13" for a model id or a confirmed key ('openrouter:' in front is read too). */
export const jevName = (id: string): string => jevLabel(id.replace(/^openrouter:/, ''))
