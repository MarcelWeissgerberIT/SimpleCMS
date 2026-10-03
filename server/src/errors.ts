import type { ContentfulStatusCode } from 'hono/utils/http-status'

/**
 * Every API error is rendered as `{ error: { code, message } }`.
 * `code` is a stable machine-readable string (see docs/CLOUD.md), `message` is for humans/logs.
 */
export class ApiError extends Error {
  readonly status: ContentfulStatusCode
  readonly code: string
  readonly details?: unknown
  readonly headers?: Record<string, string>

  constructor(status: ContentfulStatusCode, code: string, message: string, extra?: { details?: unknown; headers?: Record<string, string> }) {
    super(message)
    this.status = status
    this.code = code
    this.details = extra?.details
    this.headers = extra?.headers
  }
}

export const badRequest = (code: string, message: string, details?: unknown) => new ApiError(400, code, message, { details })
export const unauthenticated = () => new ApiError(401, 'unauthenticated', 'Sign in first')
export const forbidden = (code = 'forbidden', message = 'You do not have permission to do this') => new ApiError(403, code, message)
export const notFound = (code = 'not_found', message = 'Not found') => new ApiError(404, code, message)
export const conflict = (code: string, message: string) => new ApiError(409, code, message)
export const tooLarge = (message: string) => new ApiError(413, 'file_too_large', message)
export const rateLimited = (retryAfterSec: number) =>
  new ApiError(429, 'rate_limited', 'Too many requests, try again later', { headers: { 'Retry-After': String(retryAfterSec) } })
