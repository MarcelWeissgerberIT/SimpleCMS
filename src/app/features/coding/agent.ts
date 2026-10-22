import type { Database, Page, PropertyDef } from '../../store/types'
import { newId } from '../../lib/ids'
import { t, useT } from '../../i18n'
import { useWorkspace } from '../../store/store'
import { CODING_AGENTS, type CodingAgent } from './protocol'

export const AGENT_LABELS: Record<CodingAgent, string> = { claude: 'Claude Code', codex: 'Codex', local: 'Local · Ollama', minimax: 'MiniMax · API', ollama: 'Ollama Cloud', copilot: 'GitHub Copilot' }
export const codingAgentProperty = (db: Database) => db.properties.find(p => p.type === 'select' && (p.id.startsWith('coding_agent_') || p.name === 'Coding-Agent'))
export const agentProperty = (): PropertyDef => ({ id: `coding_agent_${newId()}`, name: t('features.coding.agent.label'), type: 'select', options: CODING_AGENTS.map((id, i) => ({ id: `coding_agent_${id}`, name: t(`features.coding.agent.${id}`), color: (['orange', 'green', 'purple', 'yellow', 'blue', 'gray'] as const)[i]! })) })

/** Missing means the historical Claude default; an unknown explicit choice never falls back. */
export function codingAgentOf(db: Database, row: Page): CodingAgent | null {
  const p = codingAgentProperty(db)
  const value = p ? row.properties[p.id] : null
  if (value == null || value === '') return 'claude'
  const choice = p?.options?.find(o => o.id === value)
  return CODING_AGENTS.find(id => choice?.id === `coding_agent_${id}` || choice?.name === AGENT_LABELS[id]) ?? null
}

/** Task-specific UI name; unknown or missing task data stays provider-neutral. */
export function codingAgentName(taskId: string, tr = t): string {
  const s = useWorkspace.getState()
  const row = s.pages[taskId]
  const db = row?.databaseId ? s.databases[row.databaseId] : null
  const agent = row && db ? codingAgentOf(db, row) : null
  return agent ? tr(`features.coding.agent.${agent}`) : tr('features.coding.agent.label')
}

export function useCodingAgentName(taskId: string): string {
  const tr = useT()
  useWorkspace(s => s.pages[taskId])
  useWorkspace(s => s.databases)
  return codingAgentName(taskId, tr)
}
