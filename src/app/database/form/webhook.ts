/**
 * Form responses → the owner's webhook (n8n / Make / Zapier / anything that accepts a POST).
 * There is no server: the respondent's browser posts the JSON itself.
 */
import { postWebhook as sendWebhook, type WebhookOutcome } from '../../lib/webhook'
import { isValidWebhookUrl } from './fields'

export interface FormWebhookBody {
  event: 'form_submitted' | 'form_test'
  /** only on "Send test" requests, so receivers can ignore them */
  test?: true
  form: { title: string }
  submittedAt: string
  answers: Record<string, unknown>
  source: 'simplecms-one'
  /** added when sent (lib/webhook.ts): the same for a request and its no-cors retry */
  deliveryId?: string
}

export interface HookResult {
  /** delivered (2xx) or sent without a readable answer (see `opaque`) */
  ok: boolean
  /** delivered | failed | unconfirmed (no-cors: sent, but the browser can't confirm delivery) */
  outcome: WebhookOutcome
  /** HTTP status; 0 when unknown (network error, or an opaque no-cors response) */
  status: number
  /** Sent as a "simple" no-cors request: it left the browser, delivery can't be confirmed. */
  opaque?: boolean
  error?: 'url' | 'timeout' | 'network' | 'http'
  /** sent in the body, so the receiver can drop the duplicate of a retried request */
  deliveryId: string
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
 * POST the body as JSON through the shared webhook helper (lib/webhook.ts): CORS first, one
 * no-cors text/plain retry on a network/CORS failure (same `deliveryId`, outcome "unconfirmed").
 * Shared forms only post to https:// webhooks (http://localhost for local testing).
 */
export async function postWebhook(url: string, body: FormWebhookBody): Promise<HookResult> {
  if (!isValidWebhookUrl(url)) return { ok: false, outcome: 'failed', status: 0, error: 'url', deliveryId: '', ms: 0 }
  const res = await sendWebhook(url, 'POST', body, { timeoutMs: TIMEOUT_MS })
  return {
    ok: res.outcome !== 'failed',
    outcome: res.outcome,
    status: res.status,
    ...(res.outcome === 'unconfirmed' ? { opaque: true } : {}),
    ...(res.error ? { error: res.error } : {}),
    deliveryId: res.deliveryId,
    ms: res.ms,
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}
