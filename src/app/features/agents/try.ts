/**
 * The "Try it" key of the pre-check entry (`try: agent-precheck`, slice SJ): the first agent's editor, scrolled to section
 * 06 "Check" with the focus on its first key — or the agents gallery when there is none. Registered with the help when
 * the agents start (lazily: the help's own module imports the features, a static import here would be a cycle at boot).
 */
import { navigate } from '../../lib/router'
import { useWorkspace } from '../../store/store'

let pending: string | null = null

/** Is the agent page of `id` asked to open its editor at section 06? (one-shot) */
export function takeSectionRequest(id: string): boolean {
  if (pending !== id) return false
  pending = null
  return true
}

function openPrecheck(): void {
  const first = Object.values(useWorkspace.getState().agents ?? {}).sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name))[0]
  if (!first) return navigate({ name: 'agents' })
  pending = first.id
  navigate({ name: 'agents', id: first.id })
}

export function registerAgentTry(): void {
  void import('../../help')
    .then(({ registerTry }) => registerTry('agent-precheck', openPrecheck))
    .catch((e) => console.warn('[one] agents: the "Try it" key could not be registered', e))
}
