/**
 * Custom agents — what the job field ("Instructions") knows: the tool names it highlights (the agent's own tools
 * for its write mode and scope, plus the tools its MCP servers listed at their last check) and the placeholders a
 * recipe leaves to fill in. Nothing here is fixed per recipe: the tools come from the agent's settings, the
 * placeholder pattern is ui/code's (one place to change it).
 */
import type { CustomAgent, Settings } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { PLACEHOLDER_PATTERN, countPlaceholders } from '../../ui/code/placeholders'
import { readServers } from '../ai/mcp-servers/config'
import { agentTools } from './scope'

/** The open placeholders of an agent's job ("[HOW TO LIST THE ITEMS]"). */
export const AGENT_PLACEHOLDERS = PLACEHOLDER_PATTERN

export const openPlaceholders = (instructions: string): number => countPlaceholders(instructions, AGENT_PLACEHOLDERS)

/** Tool names the job may mention: One's tools of this agent, then its MCP servers' (as last checked; a tool list narrows them). */
export function instructionTools(agent: Pick<CustomAgent, 'scope' | 'write' | 'mcpServers' | 'mcpTools'>, settings: Pick<Settings, 'mcpServers'> = useWorkspace.getState().settings): { own: string[]; mcp: string[] } {
  const own: string[] = agentTools(agent).map((t) => t.name)
  const chosen = new Set(agent.mcpServers)
  const mcp = readServers(settings)
    .filter((s) => chosen.has(s.name))
    .flatMap((s) => {
      const allowed = agent.mcpTools?.[s.name]
      return (s.tools ?? []).filter((n) => !allowed || allowed.includes(n))
    })
  return { own, mcp: [...new Set(mcp)].filter((n) => !own.includes(n)) }
}
