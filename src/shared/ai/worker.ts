import type { WorkerProvider } from './providers.ts'

/** No credentials, tool calls, filesystem paths or arbitrary URLs cross this request boundary. */
export interface WorkerModel { provider: WorkerProvider; model: string; context: number }
export interface WorkerTextRequest { provider: WorkerProvider; model: string; messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>; maxTokens: number }
export interface WorkerTextResult { model: string; text: string; inputTokens: number | null; outputTokens: number | null; usd: number | null }
export const WORKER_TEXT_MAX = 180000
export const validWorkerModel = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(v)
