/**
 * Patching (B15) on top of tests/fixtures/patchbay.ts: the PatchCtx of a world (its source and plain readers, a fixed
 * new id, the commands' "Run <agent> now" rule as a Node stand-in), a world with the writes applied (what the store
 * would hold after commitWrites), and a recording sink for commitWrites. Fictional names only; hosts `*.example`.
 */
import { sanitizeAgent } from '../../src/app/store/agents'
import { currentWriter, formatWriterKey, type Writer } from '../../src/app/store/writer'
import type { Automation, CustomAgent, Database, DbCommand, ID, IntegrationProfile } from '../../src/app/store/types'
import type { PatchCtx, PatchSink } from '../../src/app/features/patchbay/patch'
import type { PatchWrite } from '../../src/app/features/patchbay/types'
import { nodeReaders, sourceOf, type PbWorld } from './patchbay'

/**
 * The commands area's rule (features/commands/defaults.ts hasDefaultCommand — not Node-loadable): the agent watches the
 * database (a row trigger) or names it in its scope, and its default "Run <agent> now" is not switched off.
 */
export function hasDefaultCommand(db: ID, agentId: ID, ws: { databases: Record<ID, Database>; agents?: Record<ID, CustomAgent> }): boolean {
  const d = ws.databases[db]
  const a = ws.agents?.[agentId]
  if (!d || !a) return false
  const watches = ((a.trigger.type === 'row_created' || a.trigger.type === 'row_changed') && a.trigger.databaseId === db) || a.scope.databases.includes(db)
  return watches && !(Array.isArray(d.commands) ? d.commands : []).some((c) => c.kind === 'default' && c.id === `agent:${agentId}` && c.hidden)
}

/** A world's PatchCtx (the model and its input built by plan() from the source). */
export function patchCtx(w: PbWorld, over: Partial<PatchCtx> = {}): PatchCtx {
  return { src: sourceOf(w), read: nodeReaders(w), newId: () => 'cmdPatched', hasDefaultCommand, ...over }
}

/** The world after writes, as the store would hold it (agents sanitized and stamped like upsertAgent; lists as written). */
export function withWrites(w: PbWorld, writes: PatchWrite[], opts: { me?: string | null } = {}): PbWorld {
  const ws = { ...w.ws, agents: { ...(w.ws.agents ?? {}) }, databases: { ...w.ws.databases }, integrations: [...((w.ws.integrations as IntegrationProfile[] | undefined) ?? [])] }
  for (const x of writes) {
    if (x.w === 'agent') {
      const clean = sanitizeAgent(x.agent.id, { ...JSON.parse(JSON.stringify(x.agent)), updatedBy: opts.me ?? x.agent.updatedBy ?? null, updatedAt: (x.agent.updatedAt ?? 0) + 1 })
      if (clean) ws.agents[clean.id] = clean
    } else if (x.w === 'automations') ws.databases[x.db] = { ...ws.databases[x.db], automations: JSON.parse(JSON.stringify(x.list)) }
    else if (x.w === 'commands') ws.databases[x.db] = { ...ws.databases[x.db], commands: JSON.parse(JSON.stringify(x.list)) }
    else {
      const list = ws.integrations as IntegrationProfile[]
      const at = list.findIndex((p) => p.id === (x.replaces ?? x.profile.id))
      if (at >= 0) list[at] = x.profile
      else list.push(x.profile)
    }
  }
  return { ...w, ws }
}

/** A sink that records every write with the writer frame it ran under (and refuses what `refuse` names). */
export function recordingSink(w: PbWorld, refuse: Partial<Record<'agent' | 'automations' | 'commands' | 'integration', boolean>> = {}) {
  const log: Array<{ w: string; writer: string | null }> = []
  const agents: Record<ID, CustomAgent> = { ...(w.ws.agents ?? {}) }
  const frame = () => {
    const f = currentWriter()
    return f ? formatWriterKey(f) : null
  }
  const sink: PatchSink = {
    upsertAgent: (agent) => {
      log.push({ w: 'agent', writer: frame() })
      if (refuse.agent) return
      const clean = sanitizeAgent(agent.id, JSON.parse(JSON.stringify(agent)))
      if (clean) agents[clean.id] = clean
    },
    agent: (id) => agents[id],
    saveAutomations: (_db: ID, _list: Automation[], writer: Writer) => {
      log.push({ w: 'automations', writer: formatWriterKey(writer) })
      return !refuse.automations
    },
    saveDbCommands: (_db: ID, _list: DbCommand[]) => {
      log.push({ w: 'commands', writer: frame() })
      return !refuse.commands
    },
    upsertIntegration: () => {
      log.push({ w: 'integration', writer: frame() })
      return !refuse.integration
    },
  }
  return { sink, log, agents }
}
