/**
 * No real host from a Node spec (multi-provider S2): importing this module FIRST replaces `globalThis.fetch` with a
 * function that throws — a spec that reaches the network without its own stub fails loudly. A case installs a stub
 * with `stubFetch(fn)` (returns the undo) — the stub sees every request and answers it; nothing goes out either way.
 * `decisionsStub()` (slice SJ) is such a stub for OpenRouter's decisions surface: the decisions catalogue GET from its
 * fixture and the decisions POST from a script — anything else still throws.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const NO_NET = 'no real host in Node specs'

export type FetchStub = (url: string, init: RequestInit) => Response | Promise<Response>

let stub: FetchStub | null = null

const guarded = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!stub) throw new Error(`${NO_NET}: ${init.method ?? 'GET'} ${url}`)
  return stub(url, init)
}

globalThis.fetch = guarded as typeof fetch

/** Answer this spec's requests with `fn` until the returned undo runs. */
export function stubFetch(fn: FetchStub): () => void {
  stub = fn
  return () => {
    if (stub === fn) stub = null
  }
}

/** Is the guard in place (nothing replaced it)? */
export const netGuarded = (): boolean => globalThis.fetch === (guarded as typeof fetch)

/** What a decisions stub answers a POST with (the parsed body in, a Response out). */
export type DecisionsAnswer = (body: Record<string, unknown>, n: number) => Response | Promise<Response>

/**
 * A stub for OpenRouter's decisions surface (use with `stubFetch`): `GET /api/v1/models?output_modalities=decisions` →
 * the trimmed fixture as `{ data }` (or `catalogue: <status>`), `POST /api/alpha/decisions` → `answer(body, n)`. Every
 * request is recorded in `seen` ("METHOD url"); anything else throws as the guard would.
 */
export function decisionsStub(o: { answer?: DecisionsAnswer; catalogue?: number; seen?: string[]; bodies?: Array<Record<string, unknown>> } = {}): FetchStub {
  let n = 0
  return async (url, init) => {
    const method = init.method ?? 'GET'
    o.seen?.push(`${method} ${url}`)
    const u = new URL(url)
    if (u.host === 'openrouter.ai' && method === 'GET' && u.pathname === '/api/v1/models' && u.searchParams.get('output_modalities') === 'decisions') {
      if (o.catalogue) return new Response(JSON.stringify({ error: { code: o.catalogue, message: 'unavailable' } }), { status: o.catalogue })
      const f = JSON.parse(readFileSync(fileURLToPath(new URL('../../fixtures/openrouter-decisions.json', import.meta.url)), 'utf8')) as { data: unknown[] }
      return new Response(JSON.stringify({ data: f.data, total_count: f.data.length }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (u.host === 'openrouter.ai' && method === 'POST' && u.pathname === '/api/alpha/decisions' && o.answer) {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      o.bodies?.push(body)
      return o.answer(body, n++)
    }
    throw new Error(`${NO_NET}: ${method} ${url}`)
  }
}
