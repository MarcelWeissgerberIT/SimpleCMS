import type { Route } from '@/shared/ai/types'
import { SHARED_PREFIX, type SharedModel } from '@/shared/ai/shared-model'

const canonical = new Set(['atlas-flow', 'atlas-flow:latest'])
// Compatibility profiles created by our earlier local-coder setup. This is an
// explicit profile migration, not a claim that arbitrary models with similar names
// or the same weights have identical prompts, capabilities or destinations.
const previous = new Set(['marcel-flow', 'marcel-flow:latest', 'marcel-coder', 'marcel-coder:latest', 'qwen3-coder:30b'])
type ModelChoice = { route: Route; ok?: boolean }

/** One normal Atlas Flow choice. Keep the full catalog for stored routes and
 * execution. Another person's host and genuinely different models stay distinct. */
export function flowChoices<T extends ModelChoice>(models: readonly T[], shares: readonly Pick<SharedModel, 'id' | 'model' | 'mine'>[], preferred?: Route | null): T[] {
  const own = new Set(shares.filter(s => s.mine && canonical.has(s.model)).map(s => SHARED_PREFIX + s.id))
  const isCurrent = (r: Route) => r.p === 'local' && (canonical.has(r.m) || own.has(r.m))
  const candidates = models.filter(m => isCurrent(m.route) && m.ok !== false)
  const selected = candidates.find(m => m.route.p === preferred?.p && m.route.m === preferred.m)
    ?? candidates.find(m => canonical.has(m.route.m)) ?? candidates[0]
  if (!selected) return [...models]
  return models.filter(m => m === selected || m.route.p !== 'local' || (!isCurrent(m.route) && !previous.has(m.route.m)))
}
