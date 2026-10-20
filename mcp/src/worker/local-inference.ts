/** The harness only consumes this contract. Model selection and wire format stay in the adapter. */
export interface LocalInferenceRequest {
  model: string
  messages: any[]
  tools: any[]
  contextTokens: number
  outputTokens: number
  signal: AbortSignal
}
export interface LocalInferenceResponse { message?: any; inputTokens?: number }
export interface LocalInference {
  (request: LocalInferenceRequest): Promise<LocalInferenceResponse>
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
    const data = await response.json() as { message?: any; prompt_eval_count?: number }
    return { message: data.message, inputTokens: data.prompt_eval_count }
  }
  inference.profile = async (model, signal) => {
    const response = await fetch(new URL('/api/show', base), {
      method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }),
    })
    if (!response.ok) throw new Error('The selected local model profile could not be loaded. Check that the model is installed.')
    const data = await response.json() as { system?: unknown }
    if (data.system !== undefined && typeof data.system !== 'string') throw new Error('The selected local model profile is invalid.')
    if (typeof data.system === 'string' && data.system.length > 50000) throw new Error('The selected model profile exceeds 50,000 characters. Shorten it before running the task.')
    return typeof data.system === 'string' ? data.system : ''
  }
  return inference
}
