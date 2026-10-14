/**
 * Folder + GitHub sync on this device, as the Patchbay reads it (§1.15 / §2.3: a sync source, the GitHub push as an
 * unattended way out) — plain facts from the sync service's in-memory state, never the token: GitHub configured (a
 * repository and a token), `auto` (push on its own, every `everyMin` minutes, in the leader tab), `includePrivate`
 * (team: private pages pushed too) and the repository ("owner/repo"); the folder: one was picked.
 */
import { useSync, type SyncState } from './service'

export interface SyncFacts {
  github: { configured: boolean; auto: boolean; everyMin: number; includePrivate: boolean; repo: string | null }
  folder: { configured: boolean }
}

/** The facts of a sync state (default: this tab's now). */
export function syncState(s: Pick<SyncState, 'github' | 'folder'> = useSync.getState()): SyncFacts {
  const g = s.github
  const configured = g.state !== 'off'
  return {
    github: { configured, auto: configured && g.config.auto, everyMin: g.config.everyMin, includePrivate: g.config.includePrivate === true, repo: configured ? g.config.repo.trim() || null : null },
    folder: { configured: s.folder.state !== 'off' && s.folder.state !== 'unsupported' },
  }
}

const keyOf = (f: SyncFacts) => JSON.stringify(f)

/** Hear the facts change (not every status tick: only when a fact itself changes). Returns the unsubscribe. */
export function onSyncState(fn: (facts: SyncFacts) => void): () => void {
  let last = keyOf(syncState())
  return useSync.subscribe((s) => {
    const facts = syncState(s)
    const key = keyOf(facts)
    if (key === last) return
    last = key
    fn(facts)
  })
}
