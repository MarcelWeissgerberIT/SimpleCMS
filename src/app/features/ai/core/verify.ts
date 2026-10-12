/**
 * verifyProvider(): is a provider's key good — without sending any text (multi-provider S2, A9). Claude: one
 * `models.list` (limit 1); OpenRouter: `GET /api/v1/key` (its credit comes back too). Never on the boot path: the
 * OpenRouter transport is loaded here on first use. The key is the one given, else this device's (getAIKey).
 */
import type { ProviderId } from '@/shared/ai/types'
import { keyOfOther } from '@/shared/ai/providers'
import type { VerifyResult } from '@/shared/ai/adapter'
import { getAIKey } from '../../../store/secrets'
import { verifyKey } from '../providers/anthropic'

export async function verifyProvider(p: ProviderId, key?: string, signal?: AbortSignal): Promise<VerifyResult> {
  const k = (key ?? (await getAIKey(p))).trim()
  if (!k) return { ok: false, code: 'no_key' }
  // another provider's key (pasted into the wrong tab): never sent to this provider's check
  if (keyOfOther(p, k)) return { ok: false, code: 'invalid_key' }
  if (p === 'anthropic') {
    const r = await verifyKey(k, signal)
    return r === 'ok' ? { ok: true } : { ok: false, code: r }
  }
  if (p === 'openrouter') {
    try {
      const { verify } = await import('../providers/openrouter')
      return await verify(k, signal)
    } catch {
      return { ok: false, code: navigator.onLine ? 'outdated' : 'offline' }
    }
  }
  return { ok: false, code: 'capability' }
}
