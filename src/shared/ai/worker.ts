import type { WorkerProvider } from './providers.ts'

/** Model data only: no credentials, filesystem paths or arbitrary URLs. */
export interface WorkerVision { mediaTypes: string[]; maxImages: number; maxBytes: number }
export interface WorkerAttachment { mediaType: string; data: string }
export const WORKER_MEDIA_BYTES = 3 * 1024 * 1024
export const WORKER_MEDIA_COUNT = 4
export function validWorkerVision(value: unknown): value is WorkerVision {
  if (!value || typeof value !== 'object') return false
  const v = value as WorkerVision
  return Array.isArray(v.mediaTypes) && v.mediaTypes.length > 0 && v.mediaTypes.length <= 4 && v.mediaTypes.every(t => ['image/png','image/jpeg','image/webp','image/gif'].includes(t)) && Number.isSafeInteger(v.maxImages) && v.maxImages > 0 && v.maxImages <= WORKER_MEDIA_COUNT && Number.isSafeInteger(v.maxBytes) && v.maxBytes > 0 && v.maxBytes <= WORKER_MEDIA_BYTES
}
export interface WorkerModel { provider: WorkerProvider; model: string; context: number; chat?: true; maxOutput?: number; vision?: WorkerVision }
export interface WorkerFunction { name: string; description: string; parameters: Record<string, unknown> }
export interface WorkerCall { id: string; name: string; arguments: Record<string, unknown> }
export interface WorkerTextRequest { provider: WorkerProvider; model: string; messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>; maxTokens: number; tools?: WorkerFunction[]; schema?: Record<string, unknown>; attachments?: WorkerAttachment[] }
export interface WorkerTextResult { model: string; text: string; inputTokens: number | null; outputTokens: number | null; usd: number | null; calls?: WorkerCall[] }
/** Explicit user-selected remote connections. Never included in a model request or persisted by the worker. */
export interface WorkerMcpServer { name: string; url: string; token: string; allow: string[] | null; deny: string[] }
export type WorkerMcpRequest = { servers: WorkerMcpServer[]; action: 'list' } | { servers: WorkerMcpServer[]; action: 'search'; query: string } | { servers: WorkerMcpServer[]; action: 'call'; server: string; name: string; arguments: Record<string, unknown> }
export interface WorkerMcpTool extends WorkerFunction { server: string; tool: string }
export const WORKER_TEXT_MAX = 180000
export const validWorkerModel = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(v)
