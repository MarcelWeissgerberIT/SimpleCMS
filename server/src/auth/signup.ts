import type { SignupPolicy } from '../config.ts'
import type { InviteRow, Repo } from '../repo.ts'
import { normalizeEmail } from '../repo.ts'

export const isOpenInvite = (inv: InviteRow | undefined, now = Date.now()): inv is InviteRow => !!inv && !inv.accepted_by && inv.expires_at > now

/**
 * May this email create a NEW account? Existing users can always sign in.
 * - open: anyone
 * - invite: an open invite addressed to the email, or an open link invite the person holds
 * - domains: an allowed email domain — or an invite as above (an admin's explicit decision)
 */
export function mayCreateAccount(policy: SignupPolicy, repo: Repo, email: string, inviteHash: string | null): boolean {
  if (policy.mode === 'open') return true
  const addr = normalizeEmail(email)
  if (policy.mode === 'domains') {
    const domain = addr.slice(addr.lastIndexOf('@') + 1)
    if (policy.domains.includes(domain)) return true
  }
  if (repo.hasOpenInviteForEmail(addr)) return true
  if (inviteHash) {
    const inv = repo.inviteByHash(inviteHash)
    if (isOpenInvite(inv) && (!inv.email || inv.email === addr)) return true
  }
  return false
}
