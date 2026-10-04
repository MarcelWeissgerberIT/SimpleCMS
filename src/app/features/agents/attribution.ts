/**
 * Custom agents — who wrote it. Changes an agent applies carry `agent:<agentId>` as createdBy /
 * updatedBy ("Agent · <name>" in Created by / Last edited by and the page's margin):
 *  - team workspaces: the cloud binding stamps the meta document while the agent writes (writeAsAgent)
 *  - local workspace: the pages are stamped right after the write; the next edit by a person (in this
 *    tab) clears `updatedBy` again, so "Last edited by" always names the last writer.
 */
import { pageChanges, useWorkspace } from '../../store/store'
import { isApplyingRemote } from '../../store/persistence'
import type { ID } from '../../store/types'
import { useCloud, writeAsAgent } from '../../cloud'
import { contentKey } from '../history/snapshots'

let writing = 0

/** An agent is writing into the store right now (its own changes never trigger agents). */
export const isAgentWriting = () => writing > 0

export const agentActor = (agentId: ID) => `agent:${agentId}`
export const agentIdOf = (actor: string | null | undefined): ID | null => (typeof actor === 'string' && actor.startsWith('agent:') ? actor.slice(6) : null)

const inCloud = () => useCloud.getState().active.kind === 'cloud'

/** Run an agent's writes (team: stamped by the binding as `agent:<id>`). */
export async function asAgent<T>(agentId: ID, fn: () => Promise<T> | T): Promise<T> {
  writing++
  try {
    return inCloud() ? await writeAsAgent(agentActor(agentId), fn) : await fn()
  } finally {
    writing--
  }
}

/** Local workspace: mark the pages an agent changed (`created`: also as their creator). */
export function stampLocal(agentId: ID, changed: ID[], created: ID[] = []): void {
  if (inCloud()) return
  const actor = agentActor(agentId)
  const s = useWorkspace.getState()
  writing++
  try {
    for (const id of new Set([...changed, ...created])) {
      if (!s.pages[id]) continue
      s.updatePage(id, { updatedBy: actor, ...(created.includes(id) ? { createdBy: actor } : {}) })
    }
  } finally {
    writing--
  }
}

let keeper: (() => void) | null = null

/** Local workspace: a person's edit of a page an agent changed last clears the agent's `updatedBy`. */
export function startAttributionKeeper(): () => void {
  if (keeper) return keeper
  const unsub = useWorkspace.subscribe((state, prev) => {
    if (state.pages === prev.pages || writing || !state.ready || !prev.ready || isApplyingRemote() || inCloud()) return
    const clear: ID[] = []
    for (const id of pageChanges(state.pages, prev.pages).changed) {
      const p = state.pages[id]
      const b = prev.pages[id]
      if (!b || !agentIdOf(p.updatedBy) || b.updatedBy !== p.updatedBy) continue
      // an editor normalising the content on open is not an edit
      const edited = p.title !== b.title || p.properties !== b.properties || p.icon !== b.icon || (p.content !== b.content && contentKey(p.content) !== contentKey(b.content))
      if (edited) clear.push(id)
    }
    // after every listener saw this change (they must see the person's edit, not our follow-up)
    if (clear.length)
      queueMicrotask(() => {
        const s = useWorkspace.getState()
        for (const id of clear) if (agentIdOf(s.pages[id]?.updatedBy)) s.updatePage(id, { updatedBy: null })
      })
  })
  keeper = () => {
    unsub()
    keeper = null
  }
  return keeper
}
