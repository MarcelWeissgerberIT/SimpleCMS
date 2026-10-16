/**
 * The notice for a worker older than the download on the site (#/coding plate, MCP · Verbindungen): what the newer one
 * adds. A worker older than 1.11.0 (no 'continue' / 'permission') also lacks the fix no capability names — a stage ends
 * when Claude Code ends, also after it left a dev server running — so the notice names that first and does not call
 * the update optional.
 */
import { lackingExtras, workerLacksOnlyExtras } from './protocol'

type T = (key: string, vars?: Record<string, string | number>) => string

export function outdatedNotice(t: T, can: readonly string[] | null): string {
  if (!workerLacksOnlyExtras(can)) return t('features.coding.worker.outdated')
  const lacks = lackingExtras(can)
  const before111 = lacks.includes('continue') || lacks.includes('permission')
  const adds = [...(before111 ? ['stageEnds'] : []), ...lacks].map((x) => t(`features.coding.worker.adds.${x}`)).join('; ')
  return t(before111 ? 'features.coding.worker.outdatedFix' : 'features.coding.worker.outdatedExtras', { adds })
}
