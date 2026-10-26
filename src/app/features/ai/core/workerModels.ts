import { assertModelFlow } from './dataFlow'
import { sharedModelRows, sharedModels, refreshSharedModels, useSharedModels, sendSharedText } from './sharedModels'
import { flowChoices } from './flowChoices'
import { SHARED_PREFIX } from '@/shared/ai/shared-model'
/** Request-only routes discovered from the paired worker. No credentials or persisted model claims. */
import { useEffect, useSyncExternalStore } from 'react'
import type { Caps, ModelInfo, Route } from '@/shared/ai/types'
import { isWorkerProvider } from '@/shared/ai/providers'
import { validWorkerModel, validWorkerVision, type WorkerModel, type WorkerFunction, type WorkerAttachment } from '@/shared/ai/worker'
import { useCoding } from '../../coding'
import { AIError } from './errors'

const TEXT_CAPS: Caps = { structured: false, tools: false, vision: false, pdf: false, mcp: false, mcpListing: false, cache: false, effort: false, reasoning: false, web: false, notes: false, refusalFallback: false, context: 32768, maxOutput: 16384 }
let rows: ModelInfo[] = []
let details: WorkerModel[] = []
export const workerModelDetails = (model:string) => details.find(r=>r.provider==='copilot'&&r.model===model)
let revision = 0
const listeners = new Set<() => void>()
const publish = (next: ModelInfo[]) => { if (!next.length) details=[]; rows = next; revision++; for (const fn of listeners) fn() }
let loading: Promise<void> | null = null
export const workerModelRows = () => [...rows, ...sharedModelRows()]
export const listedWorkerModelRows = (preferred?: Route | null) => flowChoices(workerModelRows(), sharedModels(), preferred)
export const workerModelInfo = (route: Route) => workerModelRows().find(r => r.route.p === route.p && r.route.m === route.m) ?? null
export const workerProviderReady = (p: string) => (p === 'local' && sharedModelRows().length > 0) || (useCoding.getState().conn === 'connected' && rows.some(r => r.route.p === p))

export function refreshWorkerModels(): Promise<void> {
  if (loading) return loading
  loading = (async () => {
    await refreshSharedModels()
    const api = await import('../../coding')
    if (!api.workerOnline() || !api.workerCaps()?.includes('text-models')) { publish([]); return }
    const before = api.useCoding.getState().worker
    try {
      const result = await api.requestTextModels()
      if (before !== api.useCoding.getState().worker || !api.workerOnline()) return
      const next: ModelInfo[] = []
      details = result.filter(m=>m.provider==='copilot'&&validWorkerModel(m.model)).map(m=>({...m,reasoningEfforts:Array.isArray(m.reasoningEfforts)?m.reasoningEfforts.filter(x=>typeof x==='string'&&/^[a-z][a-z0-9_-]{0,23}$/.test(x)).slice(0,12):[]}))
      for (const m of result.slice(0, 120)) {
        if (!isWorkerProvider(m.provider) || !validWorkerModel(m.model) || !Number.isSafeInteger(m.context) || m.context < 2048 || m.context > 2000000) continue
        const row: WorkerModel = m
        next.push({ route: { p: row.provider, m: row.model }, label: row.model, short: row.model.toUpperCase().slice(0, 22), vendor: row.provider,
          caps: { ...TEXT_CAPS, context: row.context, ...(row.provider === 'local' && row.chat === true && api.workerCaps()?.includes('local-chat') ? {structured:true,tools:true,mcp:'allow-only' as const,mcpListing:true} : {}), ...(row.provider === 'copilot' && row.chat === true && api.workerCaps()?.includes('copilot-chat') ? { structured: true, tools: true, mcp: 'allow-only' as const, mcpListing: true, maxOutput: 8192, ...(api.workerCaps()?.includes('copilot-media') ? { pdf: {maxBytes:23*1024*1024,maxPages:100}, vision: validWorkerVision(row.vision) ? {maxEdge:1568,maxBytes:row.vision.maxBytes} : false } : {}) } : {}) }, price: row.provider === 'local' ? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, source: 'table', at: 'local' } : row.provider === 'minimax' ? { input: 0.15, output: 0.60, cacheRead: 0.015, cacheWrite: 0.15, source: 'bound', at: '2026-10-19' } : null })
      }
      publish(next)
    } catch { publish([]) }
  })().finally(() => { loading = null })
  return loading
}
export function useWorkerModels(): number {
  const sharedRevision = useSharedModels()
  const conn = useCoding(s => s.conn)
  const can = useCoding(s => s.can?.includes('text-models') ?? false)
  useEffect(() => {
    if (conn !== 'connected') { publish([]); return }
    void refreshWorkerModels()
  }, [conn, can])
  return sharedRevision + useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn) }, () => revision)
}
export async function sendWorkerText(route: Route, messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, maxTokens: number, signal?: AbortSignal, extra: { tools?: WorkerFunction[]; schema?: Record<string, unknown>; attachments?: WorkerAttachment[] } = {}) {
  assertModelFlow(route.p)
  if (!isWorkerProvider(route.p)) throw new AIError('capability')
  if (route.p === 'local' && route.m.startsWith(SHARED_PREFIX)) {
    if (extra.attachments?.length) throw new AIError('capability')
    try { return await sendSharedText(route.m, messages, maxTokens, signal, undefined, extra) } catch (e) { throw new AIError(signal?.aborted ? 'aborted' : 'unknown', e instanceof Error ? e.message : String(e)) }
  }
  const api = await import('../../coding')
  if (!workerProviderReady(route.p)) throw new AIError('offline')
  const result = await api.requestWorkerText({ provider: route.p, model: route.m, messages, maxTokens, ...extra }, signal)
  if (signal?.aborted) throw new AIError('aborted')
  if (!result || result.model !== route.m || typeof result.text !== 'string' || result.text.length > 250000 || (result.usd !== null && (!Number.isFinite(result.usd) || result.usd < 0))) throw new AIError('unknown', 'Invalid worker response')
  if (result.calls && (!['copilot','local'].includes(route.p) || !Array.isArray(result.calls) || result.calls.length > 8 || result.calls.some(c => !c || typeof c.id !== 'string' || !extra.tools?.some(t => t.name === c.name) || !c.arguments || typeof c.arguments !== 'object' || Array.isArray(c.arguments)))) throw new AIError('capability', 'Invalid worker tool response')
  return result
}
