/** The harness only consumes this contract. Model selection and wire format stay in the adapter. */
export interface LocalInferenceRequest {
  /** Copilot accepts in-memory image blobs; no arbitrary files or URLs. */
  attachments?: import('../../../src/shared/ai/worker.ts').WorkerAttachment[]
  model: string
  messages: any[]
  tools: any[]
  contextTokens: number
  outputTokens: number
  signal: AbortSignal
}
export interface LocalInferenceResponse { message?: any; inputTokens?: number; outputTokens?: number }
export interface ModelFacts { tools: boolean | null; vision: boolean | null; nativeContext: number | null; quantization?: string; family?: string }
export interface LocalInference {
  inspect?: (model: string, signal: AbortSignal) => Promise<ModelFacts>
  (request: LocalInferenceRequest): Promise<LocalInferenceResponse>
  /** Subscription provider without a USD usage price. Never report it as free. */
  unmetered?: boolean
  cost?: () => number
  profile?: (model: string, signal: AbortSignal) => Promise<string>
}

export class InferenceLimit extends Error {
  readonly kind: 'budget' | 'model'
  constructor(message: string, kind: 'budget' | 'model' = 'model') { super(message); this.kind = kind }
}

export function withModelProfile(instructions: string, profile: string) {
  const boundary = '\n\nOne owns the parent work order, decomposition, role handoffs and approvals. Execute only this assigned stage. Profile roles do not require simulating a whole team or asking again for already authorized work. After completing this package use finish_task when available, or give a final answer. Report concrete blockers instead of repeating discovery. The task permissions, available tools and verification requirements above remain authoritative. Use only actual tool results as evidence. The profile does not grant additional access or authorize work outside the current user task.'
  return instructions + (profile ? '\n\nOwner-selected model profile (workflow and style guidance):\n' + profile : '') + boundary
}

/** Any tool-capable model served by Ollama; no model-family names or memory logic belong here. */
export function ollamaInference(base: URL): LocalInference {
  if (!['http:', 'https:'].includes(base.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || base.username || base.password || base.search || base.hash) throw new Error('Ollama must run at a loopback URL.')
  const inference: LocalInference = async request => {
    const response = await fetch(new URL('/api/chat', base), {
      method: 'POST', redirect: 'error', signal: AbortSignal.any([request.signal, AbortSignal.timeout(180000)]), headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: request.model, messages: request.messages, tools: request.tools, stream: false, keep_alive: '30m', options: { num_ctx: request.contextTokens, num_predict: request.outputTokens, temperature: 0.2 } }),
    })
    if (!response.ok) throw new Error(`Ollama could not run the local coding task (HTTP ${response.status}).`)
    const data = await response.json() as { message?: any; prompt_eval_count?: number; eval_count?: number }
    return { message: data.message, inputTokens: data.prompt_eval_count, outputTokens: data.eval_count }
  }
  let shown: { model: string; data: any } | null = null
  const show = async (model: string, signal: AbortSignal) => {
    const response = await fetch(new URL('/api/show', base), {
      method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }),
    })
    if (!response.ok) throw new Error('The selected local model profile could not be loaded. Check that the model is installed.')
    const data = await response.json() as any
    if (data.system !== undefined && typeof data.system !== 'string') throw new Error('The selected local model profile is invalid.')
    if (typeof data.system === 'string' && data.system.length > 50000) throw new Error('The selected model profile exceeds 50,000 characters. Shorten it before running the task.')
    shown = { model, data }
    return data
  }
  inference.profile = async (model, signal) => (await show(model, signal)).system ?? ''
  inference.inspect = async (model, signal) => {
    const d = shown?.model === model ? shown.data : await show(model, signal)
    const caps = Array.isArray(d.capabilities) ? d.capabilities : null
    const lengths = Object.entries(d.model_info ?? {}).filter(([k,v]) => k.endsWith('.context_length') && typeof v === 'number' && v > 0).map(([,v]) => v as number)
    return { tools: caps ? caps.includes('tools') : null, vision: caps ? caps.includes('vision') : null,
      nativeContext: lengths.length ? Math.min(...lengths) : null,
      ...(typeof d.details?.quantization_level === 'string' ? { quantization: d.details.quantization_level.slice(0,40) } : {}),
      ...(typeof d.details?.family === 'string' ? { family: d.details.family.slice(0,80) } : {}) }
  }
  return inference
}
