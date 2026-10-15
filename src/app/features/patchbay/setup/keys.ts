/**
 * The setup's module keys (plan §1.11, §3.7) — what a recipe's lamps make, keyed exactly as the model keys the real
 * modules (ref.ts `moduleKey`): a saved agent is `agent:<id>`, its database `database:<id>`, its clock the schedule's
 * own `clock:s:<scheduleKey>`. What does not exist yet has a ghost id instead of a real one —
 * `~<profile>~<recipe>~<what>` (never an id the store hands out: those never start with "~") — so a ghost keeps its
 * key from one render to the next and turns into the real key the moment its lamp makes it. Pure.
 */
import type { AgentTrigger, ID } from '../../../store/types'
import type { ModuleKey } from '../types'
import { moduleKey, scheduleKey } from '../ref'

/** What a recipe's setup makes (ghosts.ts draws each until it exists). */
export type GhostPart = 'server' | 'database' | 'page' | 'agent'

/** A ghost's id: `~<profile>~<recipe>~<what>` — percent-encoded by ref.ts like every key part. */
export const ghostId = (profileId: string, recipeId: string | null, what: GhostPart): string => `~${profileId}~${recipeId ?? '-'}~${what}`

/** Is this id a ghost's (ghostId)? */
export const isGhostId = (id: string | null | undefined): boolean => typeof id === 'string' && id.startsWith('~')

/** The module key of a ghost (a part not made yet). */
export function ghostKey(profileId: string, recipeId: string | null, what: GhostPart, name = ''): ModuleKey {
  const id = ghostId(profileId, recipeId, what)
  switch (what) {
    case 'server':
      return moduleKey({ kind: 'server', id, name })
    case 'database':
      return moduleKey({ kind: 'database', id })
    case 'page':
      return moduleKey({ kind: 'page', id })
    case 'agent':
      return moduleKey({ kind: 'agent', id })
  }
}

/** The clock a schedule trigger starts on (the model's own key — agents with one schedule share one clock); null: none. */
export function clockKey(trigger: AgentTrigger | null | undefined): ModuleKey | null {
  if (!trigger || trigger.type !== 'schedule') return null
  return moduleKey({ kind: 'clock', schedule: scheduleKey(trigger), agents: [] })
}

/** Two-digit lamp number as shown ("04"). */
export const lampNo = (n: number): string => String(n).padStart(2, '0')

/** The real module key of a part that exists (null id: none). */
export function realKey(what: 'database' | 'page' | 'agent', id: ID | null): ModuleKey | null {
  if (!id) return null
  return what === 'database' ? moduleKey({ kind: 'database', id }) : what === 'page' ? moduleKey({ kind: 'page', id }) : moduleKey({ kind: 'agent', id })
}
