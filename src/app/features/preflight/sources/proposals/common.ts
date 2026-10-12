/**
 * Shared by the proposals lamp and its card sources: which agents' proposals count here, the open changes of a run,
 * this tab's nonce (terminal and memory ids never repeat across reloads), a page's title and a row's key, live.
 */
import { useWorkspace } from '../../../../store/store'
import type { CustomAgent, ID } from '../../../../store/types'
import { useCloud } from '../../../../cloud'
import { useAgentRuns, useServerAgents } from '../../../agents'
import type { AgentRun } from '../../../agents/types'
import type { StagedChange } from '../../../ai/agent/types'
import { slipProbe } from '../../registry'

/** this tab's load: terminal and memory ids never repeat across reloads (their change ids restart at c1) */
export const TAB_NONCE = Math.random().toString(36).slice(2, 8)

/** A change that waits for the person: open, or held back by the agent's Vorprüfer (slice SJ — a card, never in bulk). */
export const waits = (status: string) => status === 'pending' || status === 'failed' || status === 'held'

/** Agents whose proposals count here: own browser agents (this device's runs), own server agents (agent-runs/open). */
export function countsHere(a: CustomAgent, me: string | null, team: boolean): 'browser' | 'server' | null {
  if (a.runner === 'server') return team && !!me && a.createdBy === me ? 'server' : null
  if (!team) return 'browser'
  return !!me && a.createdBy === me ? 'browser' : null
}

/** The open changes of one run, held ones too (none while it is still running; a `send` only while its slip is open). */
export function openChangesOf(run: AgentRun): StagedChange[] {
  if (run.status === 'running') return []
  const probe = slipProbe()
  return (run.staged ?? []).filter((c) => waits(c.status) && !(c.kind === 'send' && c.send?.slipId && probe && probe.isOpen(c.send.slipId) === false))
}

/** Every agent whose proposals count here, with its runs as this device holds them. */
export function agentRunsHere(): Array<{ agent: CustomAgent; runs: AgentRun[] }> {
  const ws = useWorkspace.getState()
  const cloud = useCloud.getState()
  const team = cloud.active.kind === 'cloud'
  const me = cloud.user?.id ?? null
  const byAgent = useAgentRuns.getState().byAgent
  const server = useServerAgents.getState().open ?? []
  const out: Array<{ agent: CustomAgent; runs: AgentRun[] }> = []
  for (const a of Object.values(ws.agents ?? {})) {
    const where = countsHere(a, me, team)
    if (!where) continue
    out.push({ agent: a, runs: where === 'browser' ? (byAgent[a.id] ?? []) : server.filter((r) => r.agentId === a.id) })
  }
  return out
}

/** A page's title now ('' when gone). */
export const titleOf = (id: ID | null | undefined): string => (id ? (useWorkspace.getState().pages[id]?.title ?? '') : '')

/** A database row's key ("NL-201"): the value of its database's key property, if it has one. */
export function rowKey(rowId: ID | null | undefined): string {
  if (!rowId) return ''
  const s = useWorkspace.getState()
  const row = s.pages[rowId]
  const db = row?.databaseId ? s.databases[row.databaseId] : undefined
  const key = db?.properties.find((p) => p.key)
  const v = key ? row?.properties[key.id] : undefined
  return typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, 40) : ''
}
