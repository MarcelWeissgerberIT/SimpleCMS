/**
 * EVERY call from Preflight into another area's action (§14 of the design) lives here and nowhere else — one file for
 * the Flight Recorder's writers (store/writer.ts), one file the static guard checks
 * (preflight-engine.spec, T-P1-6). Each call is the source's own entry point with its own safety rules: Preflight adds
 * none of its own writes and passes nothing that widens what the person reviewed (applyTaskAction runs with
 * `confirm: false`; only "Confirm version" trusts a version, exactly the one its card rendered).
 * The AI terminal's session, memory saving and the MCP connection check are loaded on first use (lazy chunks).
 */
import type { ID } from '../../../store/types'
import { resolveMissing, resumeFolder } from '../../sync'
import { applyRun, discardRun, runAgentNow, undoChangeEach, type Discarded } from '../../agents'
import type { AgentRun } from '../../agents/types'
import type { DiscardReason } from '../../ai/agent/types'
import type { CustomAgent } from '../../../store/types'
import { applyTaskAction, confirmTaskVersion, type TaskActionPlan } from '../../coding'
import { archiveItems, markRead, type InboxItem } from '../../inbox/state'
import { openInboxItem } from '../../inbox/engine'
import { signIn } from '../../ai/mcp-servers/oauth'
import { syncNow } from '../../mail'
import { openAutofillPanel } from '../../../database'
import type { ApplyResult } from '../../ai/agent/apply'
import type { AIRun } from '../../ai/runs'

/* ---------------- sync */

/** Ask the browser again for the sync folder's permission — call inside the key press (the browser asks). */
export function grantFolder(): Promise<void> {
  return Promise.resolve(resumeFolder()).then(() => undefined)
}

/** Files that went missing from the folder: write them again (false) or move their pages to the trash (true). */
export const settleMissing = (trash: boolean): Promise<void> => resolveMissing(trash)

/* ---------------- agents (review.ts: the run lock, the stored run read again, open proposals only) */

/** `judged`: ONE card shown in full at its revision — the decision counts as a verdict of the agent's per-field trust */
export const applyAgent = (run: AgentRun, ids: string[], judged = false): Promise<ApplyResult | null> => applyRun(run, ids, { row: true, judged })
/** The Undo of a batch applied from a card: what it did to each change (null: nothing to undo here any more). */
export const undoAgent = (run: AgentRun, changeId: string): Promise<Record<string, 'undone' | 'kept' | 'final'> | null> => undoChangeEach(run, changeId)
/** `reason`: why (1–4 / F / W); `judged`: as for applyAgent */
export const discardAgent = (run: AgentRun, ids: string[], opts: { reason?: DiscardReason; judged?: boolean } = {}): Promise<Discarded> => discardRun(run, ids, { undo: true, ...opts })
/** "Run now" of a missed scheduled agent (it costs tokens: VON HAND). */
export const runAgent = (agent: CustomAgent): Promise<void> => runAgentNow(agent)

/* ---------------- the AI terminal (its session, loaded on first use) */

const session = () => import('../../ai/agent/session')

export async function applyTerminal(ids: string[], bulk = false) {
  const { applyStaged } = await session()
  return applyStaged(ids, { quiet: true, bulk })
}

export async function undoTerminal(res: ApplyResult): Promise<{ kept: string[]; final: string[] }> {
  const { undoStagedBatch } = await session()
  return undoStagedBatch(res, { quiet: true })
}

export async function discardTerminal(id: string | string[]): Promise<string[]> {
  const { discardStaged } = await session()
  return discardStaged(id)
}

export async function undiscardTerminal(ids: string[]): Promise<string[]> {
  const { undiscardStaged } = await session()
  return undiscardStaged(ids)
}

export async function saveTerminalMemory(cardId: string, itemId: string, asNew = false): Promise<boolean> {
  const { saveProposal } = await session()
  return saveProposal(cardId, itemId, asNew)
}

export async function undoTerminalMemory(cardId: string, itemId: string): Promise<void> {
  const { undoProposal } = await session()
  undoProposal(cardId, itemId)
}

export async function dismissTerminalMemory(cardId: string, itemId: string): Promise<void> {
  const { dismissProposal } = await session()
  dismissProposal(cardId, itemId)
}

/* ---------------- AI-menu memory runs (memory/open.ts, ai/runs.ts) */

const memory = () => import('../../ai/memory/open')
const runs = () => import('../../ai/runs')

/**
 * Save an AI-menu memory run's proposal (no toast: the queue says so); its Undo takes the memory back and the run too.
 * `shown`: the near-identical memory the card showed it would update (null: none) — when that is not what it would
 * update NOW (a memory saved meanwhile, one deleted), nothing is saved: 'changed' (the card reads it again).
 */
export async function saveMenuMemory(runId: string, asNew = false, shown?: ID | null) {
  const { saveRunMemory, duplicateOf } = await memory()
  const { useAIRuns } = await runs()
  const p = useAIRuns.getState().runs[runId]?.proposals?.[0]
  // checked and saved in one step (no await between): what is updated is exactly what the card showed
  if (!asNew && shown !== undefined && p && duplicateOf(p) !== shown) return 'changed' as const
  return saveRunMemory(runId, { asNew, toast: false })
}

/** The near-identical memory a run's proposal would update (null: none). */
export async function menuMemoryDuplicate(run: AIRun): Promise<ID | null> {
  const p = run.proposals?.[0]
  if (!p) return null
  const { duplicateOf } = await memory()
  return duplicateOf(p)
}

export async function dropMenuRun(runId: string): Promise<void> {
  const { removeRun } = await runs()
  removeRun(runId)
}

export async function bringBackMenuRun(run: AIRun): Promise<boolean> {
  const { restoreRun } = await runs()
  return restoreRun(run)
}

/* ---------------- coding (the terminal's planner → apply; never `confirm: true`) */

/**
 * Apply a planned task action: the person's key in Preflight's queue — its writes (the stage move, a note, a follow-up)
 * are `you~preflight:<task id>` (store/writer.ts; design §14, brief step 39 — the task's id: a queue item's id holds
 * characters a writer key's ref does not take). Its Undo (a "Then" put back) is the source's own `you~undo`.
 */
export const applyTask = (plan: TaskActionPlan): Promise<{ undo: (() => boolean) | null }> =>
  applyTaskAction(plan, { writer: { kind: 'you', via: 'preflight', ref: plan.taskId } })

/** Trust exactly the version the card rendered ('changed': it is not that version any more; 'gone'). */
export const confirmVersion = (taskId: ID, hash: string): Promise<'ok' | 'changed' | 'gone'> => confirmTaskVersion(taskId, hash)

/* ---------------- inbox (IndexedDB one-inbox) */

export const readInbox = (ids: string[], read = true): Promise<unknown> => Promise.resolve(markRead(ids, read))
export const archiveInbox = (ids: string[], archived = true): Promise<unknown> => Promise.resolve(archiveItems(ids, archived))
/** Open what an inbox item is about (it marks it read: the card ends when its id leaves the reading). */
export const openInboxEntry = (item: InboxItem): void => openInboxItem(item)

/* ---------------- sign-ins (inside the key press: the browser opens a window) */

/** An MCP server's sign-in in a window (never the same tab: the queue stays). */
export const signInServer = (serverId: string): Promise<void> => signIn(serverId, { sameTab: false })

/** Test an MCP server's connection now (it costs tokens: VON HAND). */
export async function checkConnection(serverId: string): Promise<void> {
  const { checkServer } = await import('../../ai/mcp-servers/checks')
  await checkServer(serverId, 'test')
}

/** Gmail's sign-in, then a sync (the nudge toast's own action). */
export const connectMail = (): Promise<void> => syncNow({ connect: true })

/* ---------------- autofill (its review lives in the database's panel) */

export const openAutofill = (dbId: ID, propId: ID): void => openAutofillPanel(dbId, propId)
