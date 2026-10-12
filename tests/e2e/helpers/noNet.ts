/**
 * No real host from a Node spec (multi-provider S2): importing this module FIRST replaces `globalThis.fetch` with a
 * function that throws — a spec that reaches the network without its own stub fails loudly. A case installs a stub
 * with `stubFetch(fn)` (returns the undo) — the stub sees every request and answers it; nothing goes out either way.
 */

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
