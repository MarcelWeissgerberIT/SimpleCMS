/** Explicit repair authority, pinned with the confirmed chain; absent means read-only QA. */
export interface RepairPolicy { attempts: 1 | 2; agent: 'local' | 'minimax' | 'ollama' | 'claude' | 'codex' }
export function readRepairPolicy(v: unknown): RepairPolicy | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o=v as Record<string,unknown>
  if(Object.keys(o).some(k=>!['attempts','agent'].includes(k)) || ![1,2].includes(o.attempts as number) || !['local','minimax','ollama','claude','codex'].includes(String(o.agent))) return null
  return {attempts:o.attempts as 1|2,agent:o.agent as RepairPolicy['agent']}
}
