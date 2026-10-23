/** Credential-free Copilot choices and CLI-reported receipts. Shared by browser and worker. */
export const COPILOT_CONTEXT_MAX = 262144
export const validCopilotModel = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(v) && !/^(?:gh[pousr]_|github_pat_|sk-|eyJ)/.test(v)
export const validEffort = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9_-]{0,23}$/.test(v)
export interface CopilotChoice { model?: string; reasoningEffort?: string; contextTokens?: number }
export function readCopilotChoice(v: unknown): CopilotChoice | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as CopilotChoice
  if (Object.keys(o).some(k => !['model', 'reasoningEffort', 'contextTokens'].includes(k))) return null
  if (o.model !== undefined && !validCopilotModel(o.model) || o.reasoningEffort !== undefined && !validEffort(o.reasoningEffort) || o.contextTokens !== undefined && (!Number.isSafeInteger(o.contextTokens) || o.contextTokens < 16384 || o.contextTokens > COPILOT_CONTEXT_MAX)) return null
  return { ...(o.model !== undefined ? { model: o.model } : {}), ...(o.reasoningEffort !== undefined ? { reasoningEffort: o.reasoningEffort } : {}), ...(o.contextTokens !== undefined ? { contextTokens: o.contextTokens } : {}) }
}
export interface CopilotQuota { name: string; remainingPercentage: number; resetDate?: string }
export interface CopilotUsage {
  model: string | null
  reasoningEffort: string | null
  inputTokens: number | null
  outputTokens: number | null
  nanoAiu: number | null
  quotas: CopilotQuota[]
}
export interface CopilotReceipt {
  stageKind?: 'plan' | 'doc' | 'implement'
  status?: 'ok' | 'failed' | 'stopped' | 'limit' | 'question'
  provider: 'copilot'
  requestedModel: string
  source: 'task' | 'role' | 'worker'
  requestedEffort?: string
  contextTokens: number
  startedAt: number
  finishedAt: number
  rounds: number
  usageReports: number
  models: string[]
  reasoningEfforts: string[]
  inputTokens: number | null
  outputTokens: number | null
  nanoAiu: number | null
  quotas: CopilotQuota[]
}
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
/** Accept only bounded, explicitly recognized metrics. Never persist raw provider events. */
export function readCopilotReceipt(v: unknown): CopilotReceipt | null {
  if (!v || typeof v !== 'object') return null
  const o = v as CopilotReceipt
  if (o.stageKind !== undefined && !['plan','doc','implement'].includes(o.stageKind) || o.status !== undefined && !['ok','failed','stopped','limit','question'].includes(o.status))return null
  if (o.provider !== 'copilot' || !validCopilotModel(o.requestedModel) || !['task','role','worker'].includes(o.source) || !count(o.startedAt) || !count(o.finishedAt) || o.finishedAt < o.startedAt || !count(o.rounds) || o.rounds > 1000 || !count(o.usageReports) || o.usageReports > 1000 || !count(o.contextTokens) || o.contextTokens > COPILOT_CONTEXT_MAX) return null
  if (!Array.isArray(o.models) || o.models.length > 40 || !o.models.every(validCopilotModel) || !Array.isArray(o.reasoningEfforts) || o.reasoningEfforts.length > 40 || !o.reasoningEfforts.every(validEffort) || o.requestedEffort !== undefined && !validEffort(o.requestedEffort)) return null
  if ([o.inputTokens,o.outputTokens,o.nanoAiu].some(n => n !== null && !count(n))) return null
  if (!Array.isArray(o.quotas) || o.quotas.length > 12 || o.quotas.some(q => !q || typeof q.name !== 'string' || !/^[a-zA-Z0-9_.-]{1,64}$/.test(q.name) || !Number.isFinite(q.remainingPercentage) || q.remainingPercentage < 0 || q.remainingPercentage > 100 || q.resetDate !== undefined && (typeof q.resetDate !== 'string' || q.resetDate.length > 40 || !Number.isFinite(Date.parse(q.resetDate))))) return null
  return { ...(o.stageKind ? {stageKind:o.stageKind} : {}), ...(o.status ? {status:o.status} : {}), provider:'copilot', requestedModel:o.requestedModel, source:o.source, ...(o.requestedEffort ? {requestedEffort:o.requestedEffort} : {}), contextTokens:o.contextTokens, startedAt:o.startedAt, finishedAt:o.finishedAt, rounds:o.rounds, usageReports:o.usageReports, models:[...o.models], reasoningEfforts:[...o.reasoningEfforts], inputTokens:o.inputTokens, outputTokens:o.outputTokens, nanoAiu:o.nanoAiu, quotas:o.quotas.map(q => ({name:q.name,remainingPercentage:q.remainingPercentage,...(q.resetDate ? {resetDate:q.resetDate} : {})})) }
}
