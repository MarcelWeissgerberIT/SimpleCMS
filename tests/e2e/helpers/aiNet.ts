/**
 * The no-real-host guard for AI providers (multi-provider S1): every browser context of a test gets a route for
 * api.anthropic.com, api.openai.com and openrouter.ai registered FIRST, so a spec's own mock (registered later, or on
 * the page) always wins. A request no mock answered is aborted — it never reaches the real host — and recorded; the
 * fixture fails the test softly unless the spec called `allowUnmocked()` (a request it means to fail). `count(host)`
 * counts every request to a host (mocked or not, CORS preflights left out) — the "zero requests" assertions use it.
 */
import type { Browser, BrowserContext, Request } from '@playwright/test'

export const AI_HOSTS = { anthropic: 'api.anthropic.com', openai: 'api.openai.com', openrouter: 'openrouter.ai' } as const
export type AiHost = keyof typeof AI_HOSTS

const HOST_RE = /^https:\/\/(api\.anthropic\.com|api\.openai\.com|openrouter\.ai)(?:[/:?#]|$)/

export interface AiNet {
  /** requests no mock answered ("METHOD url"), unless allowUnmocked() was called */
  readonly unmocked: string[]
  /** requests to a provider (by name or host), mocked or not; CORS preflights are not counted */
  count(host: AiHost | string): number
  /** this test means some requests to go unanswered: they are still aborted, but not reported */
  allowUnmocked(): void
}

export interface AiNetControl extends AiNet {
  watch(ctx: BrowserContext): Promise<void>
  /** watch every context the test opens itself too (browser.newContext); returns the undo */
  hook(browser: Browser): () => void
  allowed(): boolean
}

const hostOf = (url: string): string | null => url.match(HOST_RE)?.[1] ?? null

export function makeAiNet(): AiNetControl {
  const unmocked: string[] = []
  const counts = new Map<string, number>()
  let allow = false
  const watched = new WeakSet<BrowserContext>()
  const onRequest = (req: Request) => {
    const host = hostOf(req.url())
    if (!host || req.method() === 'OPTIONS') return
    counts.set(host, (counts.get(host) ?? 0) + 1)
  }
  const net: AiNetControl = {
    unmocked,
    count: (host) => counts.get(host in AI_HOSTS ? AI_HOSTS[host as AiHost] : host) ?? 0,
    allowUnmocked: () => {
      allow = true
      unmocked.length = 0
    },
    allowed: () => allow,
    async watch(ctx) {
      if (watched.has(ctx)) return
      watched.add(ctx)
      ctx.on('request', onRequest)
      await ctx.route(HOST_RE, (route) => {
        const req = route.request()
        if (!allow) unmocked.push(`${req.method()} ${req.url()}`)
        return route.abort('failed').catch(() => undefined)
      })
    },
    hook(browser) {
      const orig = browser.newContext
      browser.newContext = async function (this: Browser, ...args: Parameters<Browser['newContext']>) {
        const ctx = await orig.apply(this, args)
        await net.watch(ctx)
        return ctx
      } as Browser['newContext']
      return () => void (browser.newContext = orig)
    },
  }
  return net
}
