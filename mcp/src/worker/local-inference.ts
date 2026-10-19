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
export type LocalInference = (request: LocalInferenceRequest) => Promise<LocalInferenceResponse>

/** Any tool-capable model served by Ollama; no model-family names or memory logic belong here. */
export function ollamaInference(base: URL): LocalInference {
  if (!['http:', 'https:'].includes(base.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || base.username || base.password || base.search || base.hash) throw new Error('Ollama must run at a loopback URL.')
  return async request => {
    const response = await fetch(new URL('/api/chat', base), {
      method: 'POST', redirect: 'error', signal: AbortSignal.any([request.signal, AbortSignal.timeout(180000)]), headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: request.model, messages: request.messages, tools: request.tools, stream: false, keep_alive: '30m', options: { num_ctx: request.contextTokens, num_predict: request.outputTokens, temperature: 0.2 } }),
    })
    if (!response.ok) throw new Error(`Ollama could not run the local coding task (HTTP ${response.status}).`)
    const data = await response.json() as { message?: any; prompt_eval_count?: number }
    return { message: data.message, inputTokens: data.prompt_eval_count }
  }
}
