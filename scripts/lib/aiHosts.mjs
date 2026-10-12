/**
 * No real AI host from a script (multi-provider S2, A10): api.anthropic.com, api.openai.com and openrouter.ai are routed in
 * a Playwright context. Every request is aborted (it never leaves the machine) except OpenRouter's public catalogue
 * (`/api/v1/models` → the trimmed fixture) and its endpoint lists (`/api/v1/models/<id>/endpoints` → synthesised, the
 * research-notes shape — verify with a real key). `mockOpenRouter: true` (changelog shots) also answers chat requests with
 * a short doc-shaped stream and the key check with a fixture. Returns the log: `{ hosts: { host: n }, aborted: [] }`.
 * Register it BEFORE a script's own mocks (Playwright: the route registered last wins).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const HOST_RE = /^https:\/\/(api\.anthropic\.com|api\.openai\.com|openrouter\.ai)(?:[/:?#]|$)/
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' }

let catalogue = null
const models = () => (catalogue ??= readFileSync(fileURLToPath(new URL('../../tests/fixtures/openrouter-models.json', import.meta.url)), 'utf8'))

/** Who serves a model (synthesised: one endpoint named after its maker; the Jev Router's own operator). */
function endpoints(id) {
  const router = id === 'typesafe/jev-router'
  const tag = router ? 'typesafe' : (id.split('/')[0] ?? 'nordwind')
  const name = router ? 'TypeSafe' : 'Nordwind'
  return { data: { id, name: id, endpoints: [{ name: `${name} | ${id}`, model_name: id, context_length: 131072, pricing: { prompt: '0.0000003', completion: '0.0000012' }, provider_name: name, tag, quantization: 'fp8', max_completion_tokens: 16384, max_prompt_tokens: null, supported_parameters: ['max_tokens', 'response_format', 'structured_outputs', 'tools', 'reasoning'], status: 0, uptime_last_30m: 99.5, supports_implicit_caching: false }] } }
}

/** A short streamed answer in the documented chunk shape (deltas, the finish, the usage chunk, [DONE]). */
function sse(model, text) {
  const chunk = (delta, finish = null, more = {}) => ({ id: 'gen-shots-1', provider: 'Nordwind', model, object: 'chat.completion.chunk', created: 1790000000, choices: [{ index: 0, delta, finish_reason: finish, native_finish_reason: finish, logprobs: null }], ...more })
  const parts = text.match(/[\s\S]{1,16}/g) ?? []
  const chunks = parts.map((p, i) => chunk(i === 0 ? { role: 'assistant', content: p } : { content: p }))
  chunks.push(chunk({ content: '' }, 'stop'))
  chunks.push(chunk({ content: '' }, 'stop', { usage: { prompt_tokens: 900, completion_tokens: Math.ceil(text.length / 4), total_tokens: 900 + Math.ceil(text.length / 4), cost: 0.0003, is_byok: false, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 0 } } }))
  return `: OPENROUTER PROCESSING\n\n${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('')}data: [DONE]\n\n`
}

/**
 * Route the three AI hosts in `ctx`. `o.mockOpenRouter`: answer OpenRouter's chat (`o.text(body)` or "Done.") and its key
 * check too. `o.quiet`: no line per aborted request.
 */
export async function routeAIHosts(ctx, o = {}) {
  const log = { hosts: {}, aborted: [] }
  await ctx.route(HOST_RE, async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    log.hosts[url.host] = (log.hosts[url.host] ?? 0) + 1
    const json = (status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) })
    try {
      if (url.host === 'openrouter.ai' && req.method() === 'GET') {
        if (url.pathname === '/api/v1/models') return await json(200, models())
        const ep = url.pathname.match(/^\/api\/v1\/models\/(.+)\/endpoints$/)
        if (ep) return await json(200, endpoints(ep[1]))
        if (o.mockOpenRouter && url.pathname === '/api/v1/key') return await json(200, { data: { label: 'One', limit: 10, limit_remaining: 9.25, limit_reset: 'monthly', usage: 0.75, is_free_tier: false } })
      }
      if (o.mockOpenRouter && url.host === 'openrouter.ai' && req.method() === 'POST' && url.pathname === '/api/v1/chat/completions') {
        let body = {}
        try {
          body = JSON.parse(req.postData() || '{}')
        } catch {}
        const model = typeof body.model === 'string' ? body.model : 'vendor-a/model-b'
        const text = o.text ? o.text(body) : 'Done.'
        return await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: sse(model, text) })
      }
      log.aborted.push(`${req.method()} ${url.origin}${url.pathname}`)
      if (!o.quiet) console.log(`AI host blocked (never sent): ${req.method()} ${url.origin}${url.pathname}`)
      return await route.abort('blockedbyclient')
    } catch {
      /* the page went away mid-request */
    }
  })
  return log
}
