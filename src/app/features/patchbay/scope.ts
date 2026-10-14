/**
 * Whose Patchbay stores: scoped like Preflight's and the Outbox's — 'local:local', or in a team workspace this
 * member's own ('cloud:<ws>:u:<account>'). Until the team account is known there is no scope and nothing is read or
 * written (cache.ts).
 */
import { activeWorkspace, useCloud } from '../../cloud'

/** 'local:local' · 'cloud:<ws>:u:<account>' · null (a team workspace whose account is not known yet). */
export function patchbayScope(): string | null {
  const ref = activeWorkspace()
  if (ref.kind !== 'cloud') return `${ref.kind}:${ref.id}`
  const uid = useCloud.getState().user?.id
  return uid ? `cloud:${ref.id}:u:${uid}` : null
}
