/**
 * What the flight recorder learns of an AI run (D-S2 B7): the route that served its writes and the one asked when they
 * differ (the Jev Router that chose the model, a refusal fallback) — route keys only, never text (store/writer.ts
 * RunMeta.ai / aiAlso, checked again by recorder/journal/runs.ts cleanMeta). An apply site writes with `aiWriterOf(run,
 * action)`; a writer of its own (autofill, mail) notes `aiRunMeta(receipt)` itself.
 */
import type { ProviderId } from '@/shared/ai/types'
import { isRouteKey } from '@/shared/ai/route'
import { noteRun, type RunMeta, type Writer } from '../../../store/writer'

export type AIRunMeta = Pick<RunMeta, 'ai' | 'aiAlso'>

/** The run meta of a receipt (or a run holding one): `ai` = the served route, `aiAlso` = the asked one when it differs. */
export function aiRunMeta(r: { route?: string; served?: { p: ProviderId; model: string } } | null | undefined): AIRunMeta | undefined {
  if (!r?.served) return undefined
  const ai = `${r.served.p}:${r.served.model}`
  const asked = r.route && isRouteKey(r.route) && r.route !== ai ? r.route : null
  return { ai, ...(asked ? { aiAlso: [asked] } : {}) }
}

/** An AI run's writer for an apply (`{ kind: 'ai', run, action }`), its route told to the recorder first. */
export function aiWriterOf(run: { id: string; route?: string; served?: { p: ProviderId; model: string } } | null | undefined, action: string, id?: string): Writer {
  const w: Writer = { kind: 'ai', run: run?.id ?? id ?? '-', action }
  const meta = aiRunMeta(run)
  if (meta) noteRun(w, meta)
  return w
}
