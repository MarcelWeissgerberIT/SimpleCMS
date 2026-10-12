/**
 * Whose ledger: the per-device record of AI responses is scoped like Preflight's — 'local:local', or in a team
 * workspace this member's own ('cloud:<ws>:u:<account>'). Another member signing in on the same browser never sees
 * or adds to it. Until the team account is known there is no scope: entries stay in memory for the tab.
 */
import { activeWorkspace, useCloud } from '../../cloud'

/** 'local:local' · 'cloud:<ws>:u:<account>' · null (a team workspace whose account is not known yet). */
export function ledgerScope(): string | null {
  const ref = activeWorkspace()
  if (ref.kind !== 'cloud') return `${ref.kind}:${ref.id}`
  const uid = useCloud.getState().user?.id
  return uid ? `cloud:${ref.id}:u:${uid}` : null
}
