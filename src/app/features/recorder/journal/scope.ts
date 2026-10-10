import { useCloud } from '../../../cloud'
import type { Scope } from '../model/types'

/** The scope of the workspace this tab shows: the local workspace, or a team workspace's copy. */
export function scopeNow(): Scope {
  const a = useCloud.getState().active
  return a.kind === 'cloud' ? `cloud:${a.id}` : 'local:local'
}
