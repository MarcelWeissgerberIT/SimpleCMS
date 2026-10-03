/**
 * One way to call a webhook from the browser (database automations, buttons, shared forms).
 *
 * 1. A normal CORS request with Content-Type: application/json. Receivers that answer the CORS
 *    preflight (n8n with "Allowed origins", Make, most serverless functions) get a proper JSON
 *    request and the HTTP status can be read: `delivered` (2xx) or `failed` (any other status).
 * 2. Only when that attempt fails at the network level (a TypeError — almost always a receiver
 *    that doesn't answer the preflight) and the method is POST: ONE retry as a "simple" request
 *    (mode 'no-cors', Content-Type text/plain), which browsers send without a preflight. The body
 *    is the same JSON text. The response is opaque, so nobody can tell whether it arrived:
 *    `unconfirmed`, never "success".
 * Both attempts carry the same `deliveryId` in the body, so a receiver that got the first
 * request after all (the browser only lost the answer) can drop the duplicate.
 * An HTTP error status, a timeout or an invalid URL is never retried.
 */
import { nanoid } from 'nanoid'

export type WebhookOutcome = 'delivered' | 'failed' | 'unconfirmed'

export interface WebhookDelivery {
  outcome: WebhookOutcome
  /** HTTP status; 0 when unknown (invalid URL, network error, timeout, opaque no-cors answer) */
  status: number
  statusText: string
  /** why it failed (outcome 'failed') */
  error?: 'url' | 'timeout' | 'network' | 'http'
  /** browser error message of a network failure */
  detail?: string
  /** first characters of a readable response body */
  body?: string
  /** the id sent in the payload ("deliveryId") */
  deliveryId: string
  ms: number
}

export interface WebhookOptions {
  /** extra request headers (dropped by the browser on the no-cors retry) */
  headers?: Record<string, string>
  timeoutMs?: number
  /** read up to this many characters of the response body (default 0: don't read) */
  readBody?: number
}

/** http(s) URL with a host — anything else is never requested. */
export function isWebhookUrl(url: string): boolean {
  try {
    const u = new URL(url.trim())
    return (u.protocol === 'https:' || u.protocol === 'http:') && !!u.hostname
  } catch {
    return false
  }
}

/** POST / PUT `payload` + a fresh `deliveryId` as JSON (see the module comment for the fallback). */
export async function postWebhook(url: string, method: 'POST' | 'PUT', payload: object, opts: WebhookOptions = {}): Promise<WebhookDelivery> {
  const started = performance.now()
  const ms = () => Math.round(performance.now() - started)
  const deliveryId = nanoid()
  const target = url.trim()
  if (!isWebhookUrl(target)) return { outcome: 'failed', status: 0, statusText: '', error: 'url', deliveryId, ms: 0 }
  const body = JSON.stringify({ ...payload, deliveryId })
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000)
  const timedOut = (): WebhookDelivery => ({ outcome: 'failed', status: 0, statusText: '', error: 'timeout', deliveryId, ms: ms() })
  try {
    let res: Response
    try {
      res = await fetch(target, { method, mode: 'cors', headers: { 'Content-Type': 'application/json', ...opts.headers }, body, signal: ctrl.signal })
    } catch (err) {
      if (ctrl.signal.aborted) return timedOut()
      const detail = (err as Error)?.message ?? ''
      // a TypeError is the browser's "could not complete the request" (CORS included); anything else is no network issue
      if (!(err instanceof TypeError) || method !== 'POST') return { outcome: 'failed', status: 0, statusText: '', error: 'network', detail, deliveryId, ms: ms() }
      try {
        await fetch(target, { method, mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body, signal: ctrl.signal })
        return { outcome: 'unconfirmed', status: 0, statusText: '', deliveryId, ms: ms() }
      } catch (err2) {
        if (ctrl.signal.aborted) return timedOut()
        return { outcome: 'failed', status: 0, statusText: '', error: 'network', detail: (err2 as Error)?.message ?? detail, deliveryId, ms: ms() }
      }
    }
    let text: string | undefined
    if (opts.readBody) {
      try {
        text = (await res.text()).slice(0, opts.readBody)
      } catch {
        /* unreadable body: the status still counts */
      }
    }
    return res.ok
      ? { outcome: 'delivered', status: res.status, statusText: res.statusText, body: text, deliveryId, ms: ms() }
      : { outcome: 'failed', status: res.status, statusText: res.statusText, error: 'http', body: text, deliveryId, ms: ms() }
  } finally {
    window.clearTimeout(timer)
  }
}
