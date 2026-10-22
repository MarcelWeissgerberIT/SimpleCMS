import type { WorkerProvider } from './providers.ts'

/** No credentials, tool calls, filesystem paths or arbitrary URLs cross this request boundary. */
export interface WorkerModel { provider: WorkerProvider; model: string; context: number; chat?: true; maxOutput?: number }
export interface WorkerFunction { name: string; description: string; parameters: Record<string, unknown> }
export interface WorkerCall { id: string; name: string; arguments: Record<string, unknown> }
export interface WorkerTextRequest { provider: WorkerProvider; model: string; messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>; maxTokens: number; tools?: WorkerFunction[]; schema?: Record<string, unknown> }
export interface WorkerTextResult { model: string; text: string; inputTokens: number | null; outputTokens: number | null; usd: number | null; calls?: WorkerCall[] }
/** Explicit user-selected remote connections. Never included in a model request or persisted by the worker. */
export interface WorkerMcpServer { name: string; url: string; token: string; allow: string[] | null; deny: string[] }
export type WorkerMcpRequest = { servers: WorkerMcpServer[]; action: 'list' } | { servers: WorkerMcpServer[]; action: 'search'; query: string } | { servers: WorkerMcpServer[]; action: 'call'; server: string; name: string; arguments: Record<string, unknown> }
export interface WorkerMcpTool extends WorkerFunction { server: string; tool: string }
export const WORKER_TEXT_MAX = 180000
export const validWorkerModel = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(v)
