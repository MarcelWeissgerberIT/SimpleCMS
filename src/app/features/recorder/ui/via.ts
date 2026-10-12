/**
 * The AI route a run's writes came from (RunMeta.ai — route keys only), as the window plate and the after-eject plate
 * both say it: "via Claude Sonnet 5.5" (Claude's labels name it), "via OpenRouter · <model>", the Jev Router "via
 * OpenRouter · Jev Router → <the model it chose>". null: the run names no route.
 */
import type { ProviderId } from '@/shared/ai/types'
import { isRouteKey } from '@/shared/ai/route'
import { providerLabel } from '@/shared/ai/models'
import { isJevRouter } from '@/shared/ai/jev'
import { servedLabel } from '../../ai/core/registry'
import type { JRun } from '../model/types'

export function viaLine(t: (k: string, v?: Record<string, string | number>) => string, meta: JRun['meta'] | undefined): string | null {
  const key = meta?.ai
  if (!key || !isRouteKey(key)) return null
  const route = keyRoute(key)
  const label = servedLabel(route.p, route.m)
  if (route.p === 'openrouter' && (meta.aiAlso ?? []).some((k) => isRouteKey(k) && isJevRouter(keyRoute(k).m))) return t('features.recorder.viaRouter', { model: label })
  return t('features.recorder.via', { route: route.p === 'anthropic' ? label : `${providerLabel(route.p)} · ${label}` })
}

/** A checked route key → its provider and model (the provider is the part before the first ':'). */
function keyRoute(key: string): { p: ProviderId; m: string } {
  const i = key.indexOf(':')
  return { p: key.slice(0, i) as ProviderId, m: key.slice(i + 1) }
}
