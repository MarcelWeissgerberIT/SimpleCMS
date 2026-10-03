/**
 * Form responses → the owner's webhook (n8n / Make / Zapier / anything that accepts a POST).
 * There is no server: the respondent's browser posts the JSON itself.
 */
import { isValidHttpUrl } from './fields'

export interface FormWebhookBody {
  event: 'form_submitted' | 'form_test'
  /** only on "Send test" requests, so receivers can ignore them */
  test?: true
  form: { title: string }
  submittedAt: string
  answers: Record<string, unknown>
  source: 'simplecms-one'
}

export interface HookResult {
  ok: boolean
  /** HTTP status; 0 when unknown (network error, or an opaque no-cors response) */
  status: number
  /** Sent as a "simple" no-cors request: delivered, but the response can't be read. */
  opaque?: boolean
  error?: 'url' | 'timeout' | 'network' | 'http'
  ms: number
}

const TIMEOUT_MS = 15_000

export function formBody(title: string, answers: Record<string, unknown>, test = false): FormWebhookBody {
  return {
    event: test ? 'form_test' : 'form_submitted',
    ...(test ? { test: true as const } : {}),
    form: { title },
    submittedAt: new Date().toISOString(),
    answers,
    source: 'simplecms-one',
  }
}

/**
 * POST the body as JSON.
 *
 * 1. A normal CORS request with Content-Type: application/json. Receivers that answer the CORS
 *    preflight (n8n with "Allowed origins", Make, most serverless functions) get a proper JSON
 *    request and we can read the HTTP status.
 * 2. If that fails at the network level — almost always because the receiver doesn't answer the
 *    preflight (OPTIONS) with CORS headers — retry ONCE as a "simple" request: mode 'no-cors' and
 *    Content-Type text/plain, which browsers send without a preflight. The body is still the same
 *    JSON text (Zapier / Make / n8n parse it, or offer it as the raw body). The response is
 *    opaque, so its status can't be checked: the request left the browser, and we treat it as sent.
 *    This mirrors sendWebhook() in features/automations/engine.ts.
 * An HTTP error status from step 1 is a real answer from the receiver and is NOT retried.
 */
export async function postWebhook(url: string, body: FormWebhookBody): Promise<HookResult> {
  const started = performance.now()
  const ms = () => Math.round(performance.now() - started)
  if (!isValidHttpUrl(url)) return { ok: false, status: 0, error: 'url', ms: 0 }
  const json = JSON.stringify(body)
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { method: 'POST', mode: 'cors', headers: { 'Content-Type': 'application/json' }, body: json, signal: ctrl.signal })
    return res.ok ? { ok: true, status: res.status, ms: ms() } : { ok: false, status: res.status, error: 'http', ms: ms() }
  } catch {
    if (ctrl.signal.aborted) return { ok: false, status: 0, error: 'timeout', ms: ms() }
    try {
      await fetch(url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: json, signal: ctrl.signal })
      return { ok: true, status: 0, opaque: true, ms: ms() }
    } catch {
      return { ok: false, status: 0, error: ctrl.signal.aborted ? 'timeout' : 'network', ms: ms() }
    }
  } finally {
    window.clearTimeout(timer)
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}
