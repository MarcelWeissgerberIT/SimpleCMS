/**
 * Custom agents — what an agent may see and change. A scope is "everything" or a set of pages and
 * databases together with what lies below them (subpages, inline databases, rows). Templates are never
 * in scope. The workspace agent's tools are reused: each call runs inside withToolScope() (lists and
 * lookups only see pages in scope) and is refused up front when it names a page outside the scope.
 *
 * Team workspaces: a browser agent runs in its creator's browser, which also holds the creator's
 * PRIVATE pages — but every member who can edit may change the agent's job and report page. So
 * "everything" means the workspace's shared pages (as for the server runner, which never sees private
 * pages); a private page is in scope only when the scope names it (or a private page above it).
 */
import { useWorkspace } from '../../store/store'
import { inTemplate } from '../../store/selectors'
import type { CustomAgent, ID, Page } from '../../store/types'
import { useCloud } from '../../cloud'
import { AGENT_TOOLS, ToolInputError, withToolScope, type AgentTool, type StageApi } from '../ai/agent/tools'

/** The ids a tool input can point at. */
const ID_KEYS = ['id', 'database_id', 'parent_id'] as const

/** Is `id` (or one of its ancestors) one of `roots`? Cycle-safe. */
function under(pages: Record<ID, Page>, id: ID, roots: Set<ID>): boolean {
  const seen = new Set<ID>()
  let cur: Page | undefined = pages[id]
  let curId: ID | null = id
  while (curId && !seen.has(curId)) {
    if (roots.has(curId)) return true
    seen.add(curId)
    cur = pages[curId]
    curId = cur ? (cur.parentId ?? cur.databaseId ?? null) : null
  }
  return false
}

const inTeam = () => useCloud.getState().active.kind === 'cloud'

/** The scope check of an agent (null = everything outside templates — the tools exclude those already). */
export function scopeFilter(agent: Pick<CustomAgent, 'scope'>): ((id: ID) => boolean) | null {
  if (agent.scope.everything) {
    if (!inTeam()) return null
    // the workspace's pages, not the private ones of the person whose browser runs the agent
    return (id) => !useWorkspace.getState().pages[id]?.private
  }
  const roots = new Set<ID>([...agent.scope.pages, ...agent.scope.databases])
  return (id) => {
    const pages = useWorkspace.getState().pages
    return !inTemplate(pages, id) && under(pages, id, roots)
  }
}

/** The scope in words for Claude (titles and ids). */
export function scopeText(agent: Pick<CustomAgent, 'scope'>): string {
  if (agent.scope.everything) return inTeam() ? "the whole workspace except people's private pages" : 'the whole workspace'
  const pages = useWorkspace.getState().pages
  const items = [...agent.scope.pages, ...agent.scope.databases]
    .filter((id) => pages[id] && !pages[id].trashed)
    .map((id) => `${JSON.stringify(pages[id].title.trim() || 'Untitled')} (id: ${id}, ${pages[id].kind === 'database' ? 'database' : 'page'})`)
  return items.length ? `only these pages and databases and what is below them: ${items.join('; ')}` : 'nothing (no page in scope exists any more)'
}

const isStagedCreate = (stage: StageApi, id: string) => stage.list().some((c) => (c.kind === 'create_page' || c.kind === 'create_row') && c.pageId === id && c.status !== 'discarded')

/**
 * The tools of an agent: the workspace agent's, without get_current_page (nobody has a page open),
 * without the writing ones for read-only agents, each call checked against the scope.
 */
export function agentTools(agent: Pick<CustomAgent, 'scope' | 'write'>): AgentTool[] {
  const filter = scopeFilter(agent)
  const base = AGENT_TOOLS.filter((t) => t.name !== 'get_current_page' && (agent.write !== 'none' || !t.write))
  if (!filter) return base
  return base.map((tool) => ({
    ...tool,
    run(input, stage) {
      const pages = useWorkspace.getState().pages
      for (const key of ID_KEYS) {
        const raw = input[key]
        if (typeof raw !== 'string' || !raw.trim()) continue
        const id = raw.trim()
        if (isStagedCreate(stage, id)) continue
        const real = stage.resolve(id)
        const page = pages[real]
        if (page && !filter(real)) {
          throw new ToolInputError(`${JSON.stringify(page.title.trim() || 'Untitled')} (id: ${id}) is outside this agent's scope: refused. It may only use ${scopeText(agent)}.`)
        }
      }
      if (!agent.scope.everything && tool.name === 'create_page' && !(typeof input.parent_id === 'string' && input.parent_id.trim())) {
        throw new ToolInputError(`This agent may not create top-level pages: refused. Create the page under a page in its scope (${scopeText(agent)}).`)
      }
      return withToolScope(filter, () => tool.run(input, stage))
    },
  }))
}
