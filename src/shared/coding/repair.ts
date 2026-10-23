import { readCopilotChoice, type CopilotChoice } from '../copilot.ts'
/** Explicit repair authority, pinned with the confirmed chain; absent means read-only QA. */
export interface RepairPolicy { copilot?: CopilotChoice; attempts: 1 | 2; agent: 'local' | 'minimax' | 'ollama' | 'claude' | 'codex' | 'copilot' }
export function readRepairPolicy(v: unknown): RepairPolicy | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o=v as Record<string,unknown>
  if(Object.keys(o).some(k=>!['attempts','agent','copilot'].includes(k)) || ![1,2].includes(o.attempts as number) || !['local','minimax','ollama','claude','codex','copilot'].includes(String(o.agent))) return null
  if(o.copilot !== undefined && (o.agent !== 'copilot' || !readCopilotChoice(o.copilot)))return null
  return {...(o.copilot ? {copilot:readCopilotChoice(o.copilot)!} : {}),attempts:o.attempts as 1|2,agent:o.agent as RepairPolicy['agent']}
}
