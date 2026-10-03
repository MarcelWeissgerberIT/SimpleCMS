import { CloudError } from '../../cloud'
import type { Translate } from '@/shared/i18n'

/** Error codes from docs/CLOUD.md → plain-language message keys. */
const KEYS: Record<string, string> = {
  unavailable: 'shell.cloud.err.unavailable',
  network: 'shell.cloud.err.network',
  offline: 'shell.cloud.err.network',
  rate_limited: 'shell.cloud.err.rateLimited',
  signup_closed: 'shell.cloud.err.signup',
  signup_not_allowed: 'shell.cloud.err.signup',
  invite_not_found: 'shell.cloud.err.inviteNotFound',
  invite_used: 'shell.cloud.err.inviteUsed',
  invite_expired: 'shell.cloud.err.inviteExpired',
  invite_email_mismatch: 'shell.cloud.err.inviteEmail',
  forbidden: 'shell.cloud.err.forbidden',
  owner_only: 'shell.cloud.err.forbidden',
  owner_must_transfer: 'shell.cloud.err.ownerMustTransfer',
  already_member: 'shell.cloud.err.alreadyMember',
  unauthenticated: 'shell.cloud.err.unauthenticated',
  workspace_not_found: 'shell.cloud.err.notFound',
  member_not_found: 'shell.cloud.err.notFound',
  not_found: 'shell.cloud.err.notFound',
  invalid_request: 'shell.cloud.err.invalid',
  workspace_not_empty: 'shell.cloud.err.notEmpty',
  file_too_large: 'shell.cloud.err.tooLarge',
  payload_too_large: 'shell.cloud.err.tooLarge',
}

export function errorCode(e: unknown): string {
  if (e instanceof CloudError) return e.code
  // fetch() rejects with a TypeError when the network is down
  if (e instanceof TypeError) return 'network'
  return 'unknown'
}

/** One sentence a person can act on. */
export function errorText(e: unknown, t: Translate): string {
  const code = errorCode(e)
  if (code === 'rate_limited') {
    // the core may attach Retry-After (seconds); show minutes when it does
    const retry = Number((e as { retryAfter?: unknown }).retryAfter)
    if (retry > 0) return t('shell.cloud.err.rateLimitedIn', { n: Math.max(1, Math.ceil(retry / 60)) })
  }
  const key = KEYS[code]
  if (key) return t(key)
  const msg = e instanceof Error ? e.message : String(e)
  return t('shell.cloud.err.generic', { msg })
}

/** Invite codes that mean "this link is dead" (not a passing network problem). */
export const DEAD_INVITE = new Set(['invite_not_found', 'invite_used', 'invite_expired', 'not_found'])
