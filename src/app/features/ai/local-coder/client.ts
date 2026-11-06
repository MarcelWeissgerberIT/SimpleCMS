import { useWorkspace } from '../../../store/store'
import { assertModelFlow, flowRestrictions } from '../core/dataFlow'
import { AIError } from '../core/errors'
import { hasFlowLimits } from '@/shared/ai/dataFlow'
import { clearSecret, openSecret, sealSecret, vaultAvailable } from '../../../lib/vault'

const SLOT = 'one.local-coder'
const SCOPE = 'device:local-coder'
export const DEFAULT_CODER_URL = 'http://127.0.0.1:11435/mcp'
const secretName = (url: string) => `local-coder:${url}`

/** Never let this connector send a device credential or source code to a remote host. */
export function coderUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim())
    if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/mcp') return null
    return url.href
  } catch { return null }
}

export function savedCoderUrl(): string {
  try { return coderUrl(localStorage.getItem(SLOT) || '') || DEFAULT_CODER_URL } catch { return DEFAULT_CODER_URL }
}

export async function saveCoder(url: string, key: string): Promise<void> {
  if (!coderUrl(url) || key.length < 32 || /\s/.test(key)) throw new Error('key')
  if (!vaultAvailable()) throw new Error('vault')
  const previous = savedCoderUrl()
  await sealSecret(secretName(url), key, SCOPE)
  localStorage.setItem(SLOT, url)
  if (previous !== url) await clearSecret(secretName(previous), SCOPE)
}
export const coderKey = (url: string) => openSecret(secretName(url), SCOPE)
export async function forgetCoder(url: string) {
  await clearSecret(secretName(url), SCOPE)
  localStorage.removeItem(SLOT)
}

export class CoderError extends Error {
  constructor(readonly reason: 'address' | 'key' | 'offline' | 'protocol' | 'task' | 'busy') { super(reason) }
}

/** MCP Streamable HTTP in stateless JSON mode; credentials never follow redirects. */
export async function coderCall(url: string, key: string, method: string, params: object, signal?: AbortSignal): Promise<any> {
  if (!coderUrl(url)) throw new CoderError('address')
  if (!key || key.length < 32 || /\s/.test(key)) throw new CoderError('key')
  let response: Response
  const notification = method.startsWith('notifications/')
  const id = notification ? undefined : crypto.randomUUID()
  try {
    response = await fetch(url, {
      method: 'POST', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' },
      body: JSON.stringify({ jsonrpc: '2.0', ...(id ? { id } : {}), method, params }),
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(600000)]),
    })
  } catch { throw new CoderError('offline') }
  if (response.status === 401) throw new CoderError('key')
  if (response.status === 429) throw new CoderError('busy')
  if (!response.ok) throw new CoderError('offline')
  if (notification && response.status === 202) return {}
  let message: any
  try { message = await response.json() } catch { throw new CoderError('protocol') }
  if (message.jsonrpc !== '2.0' || message.id !== id || message.error || !message.result) throw new CoderError('protocol')
  return message.result
}

export async function checkCoder(url: string, key: string, signal?: AbortSignal): Promise<{ model: string; mcpServers: string[] }> {
  const init = await coderCall(url, key, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'simplecms-one', version: '1.0.0' } }, signal)
  if (init.serverInfo?.name !== 'one-local-coder') throw new CoderError('protocol')
  await coderCall(url, key, 'notifications/initialized', {}, signal)
  const list = await coderCall(url, key, 'tools/list', {}, signal)
  if (!['coding_task', 'coding_status'].every(name => list.tools?.some((t: { name: string }) => t.name === name))) throw new CoderError('protocol')
  const status = await coderCall(url, key, 'tools/call', { name: 'coding_status', arguments: {} }, signal)
  if (status.isError) throw new CoderError('offline')
  try {
    const info = JSON.parse(status.content?.find((p: { type: string }) => p.type === 'text')?.text ?? '')
    if (typeof info.model !== 'string') throw new Error('model')
    return { model: info.model, mcpServers: Array.isArray(info.mcpServers) ? info.mcpServers.filter((s: unknown): s is string => typeof s === 'string').slice(0, 20) : [] }
  } catch { throw new CoderError('protocol') }
}

export async function codingTask(url: string, key: string, task: string, context: string, signal?: AbortSignal): Promise<string> {
  assertModelFlow('local')
  // This legacy connector cannot attest local model metadata or carry per-task boundaries.
  if (hasFlowLimits(useWorkspace.getState().ai?.dataFlow) || flowRestrictions().length) throw new AIError('policy', 'legacy-flow')
  const result = await coderCall(url, key, 'tools/call', { name: 'coding_task', arguments: { task, context } }, signal)
  if (result.isError) throw new CoderError('task')
  if (!Array.isArray(result.content)) throw new CoderError('protocol')
  return result.content.filter((p: { type: string }) => p.type === 'text').map((p: { text: string }) => p.text).join('\n')
}
