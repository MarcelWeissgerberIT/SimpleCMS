/**
 * Custom agents — never two runs of one agent at once: a Web Lock per agent across the tabs of this
 * browser (without Web Locks: this tab only). Light on purpose: the runner asks before it loads the
 * run code (exec.ts).
 */
import type { ID } from '../../store/types'
import { useCloud } from '../../cloud'

const runningHere = new Set<ID>()

export const wsKey = () => {
  const a = useCloud.getState().active
  return `${a.kind}:${a.id}`
}

const lockName = (agentId: ID) => `one-agent-run:${wsKey()}:${agentId}`

/** Is a run of this agent going on in this tab? */
export const isRunningHere = (agentId: ID) => runningHere.has(agentId)

/** Run `fn` unless the agent runs already (in this tab or another tab of this browser). */
export async function exclusive<T>(agentId: ID, fn: () => Promise<T>): Promise<T | 'busy'> {
  if (runningHere.has(agentId)) return 'busy'
  const go = async () => {
    runningHere.add(agentId)
    try {
      return await fn()
    } finally {
      runningHere.delete(agentId)
    }
  }
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!locks?.request) return go()
  return locks.request(lockName(agentId), { ifAvailable: true }, (lock) => (lock ? go() : 'busy'))
}

/** Is any tab of this browser running the agent? (Web Locks; without them: this tab.) */
export async function isRunningAnywhere(agentId: ID): Promise<boolean> {
  if (runningHere.has(agentId)) return true
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!locks?.query) return false
  try {
    const q = await locks.query()
    return (q.held ?? []).some((l) => l.name === lockName(agentId))
  } catch {
    return false
  }
}
