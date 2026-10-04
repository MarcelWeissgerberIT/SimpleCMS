/**
 * The agents' SQL (migration v8): runtime configuration, runs, schedule slots and webhook secrets.
 * Everything that is workspace content or a secret is sealed with the workspace's key (AES-256-GCM,
 * crypto/aead.ts) under a context naming its row — the Claude key, MCP URLs and tokens, every run's
 * summary, steps and staged changes. Plain columns are only what lists, the scheduler and housekeeping
 * need (ids, status, times). Webhook secrets are stored as HMAC like every other token.
 */
import { openText, sealText } from '../crypto/aead.ts'
import type { Keyring } from '../crypto/keyring.ts'
import type { Db } from '../db/index.ts'
import { randomToken } from '../tokens.ts'
import type { SlotState } from './schedule.ts'
import type { AgentRun, Runtime, RunStatus } from './types.ts'

/** Runs kept per agent (older ones are deleted when a new one starts). */
export const RUNS_KEPT = 200

const runtimeContext = (wsId: string) => `agent-runtime\n${wsId}`
const runContext = (wsId: string, runId: string) => `agent-run\n${wsId}\n${runId}`

export interface RuntimeRow {
  enabled: boolean
  enabledAt: number
  runtime: Runtime
  updatedBy: string | null
  updatedAt: number
}

export interface HookRow {
  workspace_id: string
  agent_id: string
  secret_hash: string
  created_by: string | null
  created_at: number
  last_delivery_at: number | null
  deliveries: number
}

export const EMPTY_RUNTIME: Runtime = { claudeKey: null, mcpServers: [] }

export class AgentStore {
  private readonly db: Db
  private readonly keys: Keyring
  private readonly hash: (secret: string) => string

  constructor(db: Db, keys: Keyring, hash: (secret: string) => string) {
    this.db = db
    this.keys = keys
    this.hash = hash
  }

  private aead(wsId: string): Buffer | null {
    return this.keys.forWorkspace(wsId)?.aead ?? null
  }

  // ── runtime ──────────────────────────────────────────────────────────

  runtime(wsId: string): RuntimeRow | null {
    const row = this.db.get<{ enabled: number; enabled_at: number | null; data: string; updated_by: string | null; updated_at: number }>(
      'SELECT enabled, enabled_at, data, updated_by, updated_at FROM agent_runtime WHERE workspace_id = ?',
      wsId,
    )
    const key = row ? this.aead(wsId) : null
    if (!row || !key) return null
    const parsed = JSON.parse(openText(key, row.data, runtimeContext(wsId))) as Runtime
    return { enabled: row.enabled === 1, enabledAt: row.enabled_at ?? 0, runtime: parsed, updatedBy: row.updated_by, updatedAt: row.updated_at }
  }

  saveRuntime(wsId: string, runtime: Runtime, enabled: boolean, userId: string): void {
    const key = this.aead(wsId)
    if (!key) throw new Error(`workspace ${wsId} has no key`)
    const now = Date.now()
    const data = sealText(key, JSON.stringify(runtime), runtimeContext(wsId))
    this.db.run(
      `INSERT INTO agent_runtime (workspace_id, enabled, enabled_at, data, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
         enabled_at = CASE WHEN excluded.enabled = 1 AND agent_runtime.enabled = 0 THEN excluded.updated_at ELSE agent_runtime.enabled_at END,
         enabled = excluded.enabled, data = excluded.data, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      wsId, enabled ? 1 : 0, enabled ? now : null, data, userId, now,
    )
  }

  /** Workspaces whose runtime is switched on (the scheduler looks at these only). */
  enabledWorkspaces(): Array<{ id: string; enabledAt: number }> {
    return this.db
      .all<{ workspace_id: string; enabled_at: number | null }>('SELECT r.workspace_id, r.enabled_at FROM agent_runtime r JOIN workspaces w ON w.id = r.workspace_id WHERE r.enabled = 1')
      .map((r) => ({ id: r.workspace_id, enabledAt: r.enabled_at ?? 0 }))
  }

  isEnabled(wsId: string): boolean {
    return !!this.db.get('SELECT 1 AS x FROM agent_runtime WHERE workspace_id = ? AND enabled = 1', wsId)
  }

  // ── schedule slots ───────────────────────────────────────────────────

  slot(wsId: string, agentId: string): SlotState | undefined {
    const row = this.db.get<{ last_slot: number; sig: string; seen_at: number }>('SELECT last_slot, sig, seen_at FROM agent_slots WHERE workspace_id = ? AND agent_id = ?', wsId, agentId)
    return row ? { lastSlot: row.last_slot, sig: row.sig, seenAt: row.seen_at } : undefined
  }

  setSlot(wsId: string, agentId: string, state: SlotState): void {
    this.db.run(
      `INSERT INTO agent_slots (workspace_id, agent_id, last_slot, sig, seen_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, agent_id) DO UPDATE SET last_slot = excluded.last_slot, sig = excluded.sig, seen_at = excluded.seen_at`,
      wsId, agentId, state.lastSlot, state.sig, state.seenAt,
    )
  }

  // ── runs ─────────────────────────────────────────────────────────────

  /** A new run (and the agent's runs beyond the last RUNS_KEPT go). False when the workspace is gone. */
  insertRun(wsId: string, run: AgentRun): boolean {
    const key = this.aead(wsId)
    if (!key) return false
    return this.db.tx(() => {
      const ok =
        this.db.run(
          `INSERT INTO agent_runs (id, workspace_id, agent_id, status, trigger_type, started_at, ended_at, data)
           SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = ?)`,
          run.id, wsId, run.agentId, run.status, run.trigger.type, run.startedAt, run.endedAt ?? null, sealText(key, JSON.stringify(run), runContext(wsId, run.id)), wsId,
        ) > 0
      if (ok) {
        this.db.run(
          `DELETE FROM agent_runs WHERE workspace_id = ? AND agent_id = ? AND id NOT IN (
             SELECT id FROM agent_runs WHERE workspace_id = ? AND agent_id = ? ORDER BY started_at DESC, id DESC LIMIT ?)`,
          wsId, run.agentId, wsId, run.agentId, RUNS_KEPT,
        )
      }
      return ok
    })
  }

  updateRun(wsId: string, run: AgentRun): void {
    const key = this.aead(wsId)
    if (!key) return
    this.db.run(
      'UPDATE agent_runs SET status = ?, ended_at = ?, data = ? WHERE id = ? AND workspace_id = ?',
      run.status, run.endedAt ?? null, sealText(key, JSON.stringify(run), runContext(wsId, run.id)), run.id, wsId,
    )
  }

  run(wsId: string, runId: string): AgentRun | undefined {
    const row = this.db.get<{ data: string }>('SELECT data FROM agent_runs WHERE id = ? AND workspace_id = ?', runId, wsId)
    const key = row ? this.aead(wsId) : null
    return row && key ? (JSON.parse(openText(key, row.data, runContext(wsId, runId))) as AgentRun) : undefined
  }

  /** Newest first. */
  runs(wsId: string, opts: { agentId?: string | null; limit: number }): AgentRun[] {
    const key = this.aead(wsId)
    if (!key) return []
    const rows = opts.agentId
      ? this.db.all<{ id: string; data: string }>('SELECT id, data FROM agent_runs WHERE workspace_id = ? AND agent_id = ? ORDER BY started_at DESC, id DESC LIMIT ?', wsId, opts.agentId, opts.limit)
      : this.db.all<{ id: string; data: string }>('SELECT id, data FROM agent_runs WHERE workspace_id = ? ORDER BY started_at DESC, id DESC LIMIT ?', wsId, opts.limit)
    return rows.map((r) => JSON.parse(openText(key, r.data, runContext(wsId, r.id))) as AgentRun)
  }

  /** Runs that were 'running' when the server stopped (crash, kill): they end as errors at startup. */
  interrupted(): Array<{ id: string; workspace_id: string }> {
    return this.db.all<{ id: string; workspace_id: string }>("SELECT id, workspace_id FROM agent_runs WHERE status = 'running'")
  }

  countRunning(wsId: string, agentId: string, status: RunStatus = 'running'): number {
    return this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM agent_runs WHERE workspace_id = ? AND agent_id = ? AND status = ?', wsId, agentId, status)?.n ?? 0
  }

  // ── webhook triggers ─────────────────────────────────────────────────

  /** A new secret for the agent's webhook (the old URL stops working at once). Returned once. */
  setHook(wsId: string, agentId: string, userId: string): string {
    const secret = randomToken()
    this.db.run(
      `INSERT INTO agent_hooks (workspace_id, agent_id, secret_hash, created_by, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, agent_id) DO UPDATE SET secret_hash = excluded.secret_hash, created_by = excluded.created_by,
         created_at = excluded.created_at, last_delivery_at = NULL, deliveries = 0`,
      wsId, agentId, this.hash(secret), userId, Date.now(),
    )
    return secret
  }

  hook(wsId: string, agentId: string): HookRow | undefined {
    return this.db.get<HookRow>('SELECT * FROM agent_hooks WHERE workspace_id = ? AND agent_id = ?', wsId, agentId)
  }

  hookBySecret(secret: string): HookRow | undefined {
    return this.db.get<HookRow>('SELECT h.* FROM agent_hooks h JOIN workspaces w ON w.id = h.workspace_id WHERE h.secret_hash = ?', this.hash(secret))
  }

  deleteHook(wsId: string, agentId: string): boolean {
    return this.db.run('DELETE FROM agent_hooks WHERE workspace_id = ? AND agent_id = ?', wsId, agentId) > 0
  }

  recordDelivery(wsId: string, agentId: string, at = Date.now()): void {
    this.db.run('UPDATE agent_hooks SET deliveries = deliveries + 1, last_delivery_at = ? WHERE workspace_id = ? AND agent_id = ?', at, wsId, agentId)
  }
}
