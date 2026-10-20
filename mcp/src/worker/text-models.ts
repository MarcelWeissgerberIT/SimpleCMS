import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
/** Plain text inference through the existing authenticated worker link. No project or MCP tools. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isWorkerProvider } from '../../../src/shared/ai/providers.ts'
import { WORKER_TEXT_MAX, validWorkerModel, type WorkerModel, type WorkerTextRequest, type WorkerTextResult } from '../../../src/shared/ai/worker.ts'
import { readMiniMax, MINIMAX_MODEL } from './minimax-config.ts'
import { readOllamaCloud } from './ollama-cloud-config.ts'
import { miniMaxInference } from './minimax-inference.ts'
import { ollamaCloudInference } from './ollama-cloud-inference.ts'
import { ollamaInference } from './local-inference.ts'
import { findCodex, runCodex } from './codex.ts'
import { resolveCommand } from './exec.ts'

const localBase = () => {
  const url = new URL(process.env.ONE_CODER_OLLAMA || 'http://127.0.0.1:11434')
  // Reuse the adapter's loopback-only validation, including no credentials or redirect following.
  ollamaInference(url)
  return url
}
export async function textModels(file: string): Promise<WorkerModel[]> {
  const out: WorkerModel[] = []
  try {
    const res = await fetch(new URL('/api/tags', localBase()), { redirect: 'error', signal: AbortSignal.timeout(3000) })
    const data = res.ok ? await res.json() as any : null
    for (const m of (Array.isArray(data?.models) ? data.models : []).slice(0, 100)) {
      if (validWorkerModel(m.name) && !m.remote_host && !m.remote_model && !m.name.endsWith('-cloud')) out.push({ provider: 'local', model: m.name, context: 32768 })
    }
  } catch { /* An unavailable local server does not hide the other providers. */ }
  try {
    const c = readOllamaCloud(file)
    if (c.apiKey) {
      out.push({ provider: 'ollama', model: c.model, context: c.contextTokens })
      try {
        const res = await fetch('https://ollama.com/api/tags', { redirect: 'error', signal: AbortSignal.timeout(5000) })
        const data = res.ok ? await res.json() as any : null
        for (const m of (Array.isArray(data?.models) ? data.models : []).slice(0, 100)) {
          if (validWorkerModel(m.name) && m.name !== c.model && (!Array.isArray(m.capabilities) || m.capabilities.includes('completion'))) out.push({ provider: 'ollama', model: m.name, context: Math.min(c.contextTokens, 32768) })
        }
      } catch { /* The configured model stays usable when catalogue discovery is offline. */ }
    }
  } catch { /* No key is exposed. */ }
  try { const c = readMiniMax(file); if (c.apiKey) out.push({ provider: 'minimax', model: MINIMAX_MODEL, context: c.contextTokens }) } catch { /* No key is exposed. */ }
  if (resolveCommand(findCodex(), [], { cwd: tmpdir(), env: process.env }, 'shim').ok) {
    const known = [process.env.ONE_CODEX_MODEL || 'gpt-6.1-sol', 'gpt-6-luna', 'gpt-6-astra']
    try {
      const cache = readFileSync(join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'models_cache.json'), 'utf8')
      if (cache.length < 2000000) for (const m of JSON.parse(cache).models ?? []) if (validWorkerModel(m.slug) && m.visibility !== 'hide') known.push(m.slug)
    } catch { /* The CLI's configured model still works without its discovery cache. */ }
    for (const model of [...new Set(known)]) if (validWorkerModel(model)) out.push({ provider: 'codex', model, context: 64000 })
  }
  return out
}
export function checkTextRequest(raw: unknown): WorkerTextRequest {
  const r = raw as WorkerTextRequest
  if (!r || typeof r !== 'object' || !isWorkerProvider(r.provider) || !validWorkerModel(r.model) || !Number.isSafeInteger(r.maxTokens) || r.maxTokens < 1 || r.maxTokens > 16384 || !Array.isArray(r.messages) || !r.messages.length || r.messages.length > 64) throw new Error('Invalid text request.')
  if (Object.keys(r).some(k => !['provider', 'model', 'messages', 'maxTokens'].includes(k))) throw new Error('Unknown text request field.')
  let size = 0
  for (const m of r.messages) {
    if (!m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || Object.keys(m).some(k => !['role', 'content'].includes(k))) throw new Error('Only plain text messages are supported.')
    size += Buffer.byteLength(m.content)
  }
  if (size > WORKER_TEXT_MAX) throw new Error('Text request is too large. Select a smaller passage.')
  return r
}
export async function textRequest(file: string, raw: unknown, signal: AbortSignal): Promise<WorkerTextResult> {
  const r = checkTextRequest(raw)
  const model = (await textModels(file)).find(m => m.provider === r.provider && m.model === r.model)
  if (!model) throw new Error('This model is no longer available on the worker. Refresh the model list.')
  if (Buffer.byteLength(JSON.stringify(r.messages)) + r.maxTokens + 2048 > model.context) throw new Error('The text exceeds this model’s conservative context limit. Select a smaller passage.')
  if (r.provider === 'codex') {
    const cwd = await mkdtemp(join(tmpdir(), 'one-text-'))
    try {
      const result = await runCodex({ agent: 'codex', cwd, prompt: JSON.stringify(r.messages), readOnly: true, textOnly: true, maxSteps: 1, signal, taskMcp: null, log: () => {}, env: { ...process.env, ONE_CODEX_MODEL: r.model } })
      if (result.text.length > 250000) throw new Error('Codex answer is too large.')
      if (!result.ok) throw new Error('Codex could not answer this text request. Check the worker CLI login and model access.')
      return { model: r.model, text: result.text, inputTokens: result.inputTokens ?? null, outputTokens: result.outputTokens ?? null, usd: null }
    } finally { await rm(cwd, { recursive: true, force: true }) }
  }
  const inference = r.provider === 'ollama' ? ollamaCloudInference({ ...readOllamaCloud(file), model: r.model }) : r.provider === 'minimax' ? miniMaxInference(readMiniMax(file), 1) : ollamaInference(localBase())
  if (r.provider === 'local') {
    // An Ollama cloud alias must never be presented as local inference.
    const res = await fetch(new URL('/api/show', localBase()), { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: r.model }), signal })
    if (!res.ok) throw new Error('Local model metadata is unavailable.')
    const data = await res.json() as any
    if (data.remote_host || data.remote_model) throw new Error('This is a cloud model. Choose Ollama Cloud explicitly.')
  }
  const data = await inference({ model: r.model, messages: r.messages, tools: [], contextTokens: model.context, outputTokens: r.maxTokens, signal })
  if (data.message?.tool_calls?.length || typeof data.message?.content !== 'string') throw new Error('The model did not return a plain text answer.')
  if (Buffer.byteLength(data.message.content) > 250000) throw new Error('Model answer is too large.')
  return { model: r.model, text: data.message.content, inputTokens: data.inputTokens ?? null, outputTokens: data.outputTokens ?? null, usd: r.provider === 'local' ? 0 : inference.cost?.() ?? null }
}
