/**
 * The worker link as the rest of One reads it (re-exported by coding/index.ts under these names). A leaf: the work
 * orders' eager modules (orders/facts.ts, trigger.ts) read it without importing the area's index.
 */
import { t } from '../../i18n'
import { useCoding, type CodingState } from './state'
import { workerDownText } from './stateText'
import { workerOutdated, workerUnsafe } from './protocol'

/**
 * Why the worker link is down, in words, now (Preflight's worker card): the state text Settings → Coding worker shows —
 * a refusal, the browser's block — and for a Local link that waits, what to check (is the worker running in a terminal;
 * the browser's question). '' while connected or switched off.
 */
export function codingConnText(): string {
  const s = useCoding.getState()
  return s.enabled && s.conn !== 'connected' && s.conn !== 'off' ? workerDownText(t, s) : ''
}

/** The worker link is up (switched on here and connected). */
export const workerOnline = (s: Pick<CodingState, 'enabled' | 'conn'> = useCoding.getState()): boolean => s.enabled && s.conn === 'connected'

/** What the connected worker runs, from its last `next` (null: offline, or it has not asked yet). */
export const workerCaps = (s: Pick<CodingState, 'enabled' | 'conn' | 'can'> = useCoding.getState()): readonly string[] | null => (workerOnline(s) ? s.can : null)

/** The connected worker's verdict: 'unsafe' (the ZIP-import gap — the security notice), 'outdated' (a stage it cannot run), 'ok'; null while offline. */
export function workerVerdict(s: Pick<CodingState, 'enabled' | 'conn' | 'can' | 'worker'> = useCoding.getState()): 'ok' | 'outdated' | 'unsafe' | null {
  if (!workerOnline(s)) return null
  if (workerUnsafe(s.worker?.worker)) return 'unsafe'
  return workerOutdated(s.can) ? 'outdated' : 'ok'
}
