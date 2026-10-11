/**
 * Whose Preflight: every device-local key and record is scoped like the Outbox's slips — 'local:local', or in a team
 * workspace this member's own ('cloud:<ws>:u:<account>'). Another member signing in on the same browser shares no
 * acknowledgement, day record or log. Until the team account is known there is no scope: Preflight stays not ready
 * and writes nothing.
 */
import { activeWorkspace, useCloud, type WorkspaceRef } from '../../cloud'

export const workspaceRef = (ref: WorkspaceRef = activeWorkspace()): string => `${ref.kind}:${ref.id}`

/** 'local:local' · 'cloud:<ws>:u:<account>' · null (a team workspace whose account is not known yet). */
export function scopeKey(): string | null {
  const ref = activeWorkspace()
  if (ref.kind !== 'cloud') return `${ref.kind}:${ref.id}`
  const uid = useCloud.getState().user?.id
  return uid ? `cloud:${ref.id}:u:${uid}` : null
}
