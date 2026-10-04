import { isDomain, normalizeDomain, type Config } from '../config.ts'
import type { InviteRow, Repo, SignupLinkRow, UserRow } from '../repo.ts'
import { normalizeEmail } from '../repo.ts'

/** The domain of an address ("ada@acme.com" → "acme.com"). */
export const domainOf = (email: string) => {
  const addr = normalizeEmail(email)
  return addr.slice(addr.lastIndexOf('@') + 1)
}

/** A stored allowed_domains value as a list (null = any address). */
export const domainList = (stored: string | null): string[] | null => (stored ? stored.split(',').filter(Boolean) : null)

/** May this (verified) address use an invite / registration link restricted to `stored` domains? Exact match. */
export const domainAllowed = (stored: string | null, email: string) => {
  const list = domainList(stored)
  return !list || list.includes(domainOf(email))
}

/**
 * Domains as an admin typed them ("@Acme.com, acme.de") → normalised, deduplicated; null when one is not a
 * domain (the caller answers 400).
 */
export function parseDomains(input: string[] | undefined): string[] | null {
  const list = [...new Set((input ?? []).map(normalizeDomain).filter(Boolean))]
  return list.every(isDomain) ? list : null
}

/** Open = places left and not expired (a revoked one is gone: its row is deleted). */
export const isOpenInvite = (inv: InviteRow | undefined, now = Date.now()): inv is InviteRow => !!inv && inv.uses < inv.max_uses && inv.expires_at > now
export const isOpenSignupLink = (link: SignupLinkRow, now = Date.now()) => link.uses < link.max_uses && link.expires_at > now

export const isServerAdmin = (config: Config, user: Pick<UserRow, 'email'>) => config.adminEmails.includes(normalizeEmail(user.email))

/** Why a NEW account may be created (first reason that holds), or null. */
export type Admission = { by: 'admin' | 'policy' | 'invite' } | { by: 'signup-link'; link: SignupLinkRow }

/**
 * May this email create a NEW account? Existing users can always sign in. In this order:
 * - a server admin (ADMIN_EMAILS) — the operator's own decision
 * - SIGNUP=open: anyone · domains: an allowed email domain
 * - an open invite addressed to the email, or an open link invite the person holds (its domain
 *   restriction included) — an admin's explicit decision
 * - an open registration link the person holds (its domain restriction included). Only this reason
 *   uses up a place of the link (when the account is created).
 */
export function admission(config: Config, repo: Repo, email: string, inviteHash: string | null, signupHash: string | null): Admission | null {
  const addr = normalizeEmail(email)
  const policy = config.signup
  if (config.adminEmails.includes(addr)) return { by: 'admin' }
  if (policy.mode === 'open') return { by: 'policy' }
  if (policy.mode === 'domains' && policy.domains.includes(domainOf(addr))) return { by: 'policy' }
  if (repo.hasOpenInviteForEmail(addr)) return { by: 'invite' }
  if (inviteHash) {
    const inv = repo.inviteByHash(inviteHash)
    if (isOpenInvite(inv) && (!inv.email || inv.email === addr) && domainAllowed(inv.allowed_domains, addr)) return { by: 'invite' }
  }
  if (signupHash) {
    const link = repo.signupLinkByHash(signupHash)
    if (link && isOpenSignupLink(link) && domainAllowed(link.allowed_domains, addr)) return { by: 'signup-link', link }
  }
  return null
}

export const mayCreateAccount = (config: Config, repo: Repo, email: string, inviteHash: string | null, signupHash: string | null = null): boolean =>
  admission(config, repo, email, inviteHash, signupHash) !== null
