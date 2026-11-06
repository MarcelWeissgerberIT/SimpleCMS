import { useCloud } from '../../../cloud'
import type { Scope } from '../model/types'

/**
 * The scope of the workspace this tab shows: the local workspace, or a team workspace's copy as the signed-in member
 * sees it (`cloud:<ws>:u:<account>` — another account in this browser profile has a tape and pins of its own, like its
 * private documents; `cloud:<ws>` only while nobody is signed in).
 */
export function scopeNow(): Scope {
  const c = useCloud.getState()
  const a = c.active
  if (a.kind !== 'cloud') return `local:${a.id}`
  const uid = c.user?.id
  return uid && /^[A-Za-z0-9_-]{1,64}$/.test(uid) ? `cloud:${a.id}:u:${uid}` : `cloud:${a.id}`
}

/** The team workspace a scope belongs to (null: the local workspace). */
export function workspaceOfScope(s: Scope): string | null {
  if (!s.startsWith('cloud:')) return null
  const rest = s.slice('cloud:'.length)
  const i = rest.indexOf(':u:')
  return i < 0 ? rest : rest.slice(0, i)
}
