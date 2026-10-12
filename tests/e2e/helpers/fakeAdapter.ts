/**
 * A fake provider adapter (Node-only, never in src): scripted per case, it checks the contract harness itself — a case
 * that passes for OpenRouter must pass for an adapter written from the contract alone. It serves both request kinds so
 * the decide types are exercised at type level. Its marker string never appears in a build (the names guard greps dist).
 */
import type { McpRendering, ProviderAdapter, SendContext, TurnOf, VerifyResult } from '../../../src/shared/ai/adapter'
import type { AIEvent, ChatRequest, DecideTurn, McpPlan, Turn, WireRequest } from '../../../src/shared/ai/types'
import { ProviderError } from '../../../src/shared/ai/errors'

export const FAKE_MARKER = '__ONE_FAKE_ADAPTER__'

export type FakeStep =
  | { events: AIEvent[]; turn: Turn }
  | { decide: DecideTurn }
  | { error: ProviderError; events?: AIEvent[] }
  /** the stream never ends: only the abort signal ends it (with this partial turn) */
  | { hang: Turn; events?: AIEvent[] }

export interface Fake extends ProviderAdapter {
  /** requests the fake was asked to send */
  readonly sent: WireRequest[]
}

export function fakeAdapter(script: FakeStep[]): Fake {
  const sent: WireRequest[] = []
  let n = 0
  const fake: Fake = {
    id: 'openrouter',
    kinds: ['chat', 'decide'],
    retriesInside: false,
    sent,
    build: (req: ChatRequest) => ({ url: `fake://${FAKE_MARKER}`, body: { model: req.route.m, messages: req.messages.length }, headers: {} }),
    async send<R extends WireRequest>(req: R, ctx: SendContext): Promise<TurnOf<R>> {
      if (ctx.signal?.aborted) throw new ProviderError('aborted', undefined, { reach: 'none' })
      sent.push(req)
      const step = script[n++]
      if (!step) throw new ProviderError('unknown', `${FAKE_MARKER}: no scripted step`, { reach: 'none' })
      if ('decide' in step) {
        if (req.kind !== 'decide') throw new ProviderError('bad_request', 'scripted a decide turn for a chat request', { reach: 'refused' })
        return step.decide as TurnOf<R>
      }
      for (const e of 'events' in step ? (step.events ?? []) : []) ctx.onEvent(e)
      if ('error' in step) throw step.error
      if ('hang' in step)
        return new Promise<TurnOf<R>>((_, reject) => {
          const end = () => reject(new ProviderError('aborted', undefined, { reach: 'sent', partial: step.hang }))
          if (ctx.signal?.aborted) end()
          else ctx.signal?.addEventListener('abort', end, { once: true })
        })
      return step.turn as TurnOf<R>
    },
    mcp: (plan: McpPlan): McpRendering => ({ native: null, skipped: plan.servers.map((s) => ({ server: s.name, why: 'provider' as const })) }),
    verify: async (): Promise<VerifyResult> => ({ ok: true }),
  }
  return fake
}
