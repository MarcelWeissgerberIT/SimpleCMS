import { codingAgentOf } from './agent'
/**
 * Coding pipeline — who decides what the worker runs. A task runs Claude Code on the machine of the person
 * whose worker takes it, with their repos and their Claude account — so a task written or changed by
 * someone else must be seen and confirmed on THIS device first. A task version is the SHA-256 of what
 * decides the run: its title, its page (Markdown), its Repo, Branch and Stage, and the pipeline (every
 * stage's name, kind, mode, turns, git action, next stage, instructions and model — they go into the prompt, decide
 * what runs next or what runs it); the versions this device wrote or confirmed are kept per device and workspace
 * (local.ts "<scope>|trust"). In a team the check never relies on `createdBy` / `updatedBy` (clients
 * write those).
 *
 * Trusted automatically: a task made with "New task" here, the pipeline's own writes (plan, summaries,
 * stage moves), changes made in this tab of a version that was trusted (typed content — origin other
 * than 'sync' / 'file' —, its fields, the Coding database's schema and pipeline), and every task action
 * pressed here (Approve, Rework, Answer, Run now, Retry, Confirm). Never carried over: changes that came
 * from the server or another tab (isApplyingRemote) and writes of a custom agent (isAgentWriting) — a
 * teammate moving a task past a gate, or an agent reading injected text, waits for Confirm.
 *
 * Local workspaces: nothing to confirm — except a task a custom agent created or changed last
 * (`createdBy` / `updatedBy` = `agent:<id>`, stamped on this device), which waits for Confirm like a
 * team task until a version of it is trusted, a task whose version an MCP client moved (a page it refers to written
 * over MCP — local.ts `mcpTouched`, until Confirm here), and a task the folder / GitHub pick-up wrote or made (its text,
 * its title, a new row — `contentOrigin` 'file' and local.ts `fileTouched`, until Confirm here or the person's own edit
 * in the editor; an editor that only fills in block ids is no edit).
 *
 * MCP writes never carry trust (spec § 3.3): an MCP client reads text nobody vouches for, and what it writes into a
 * page a task refers to goes to Claude Code with the task.
 */
import { useWorkspace, pageChanges, type WorkspaceState } from '../../store/store'
import { isApplyingRemote } from '../../store/persistence'
import type { Database, ID, Page } from '../../store/types'
import { docToMarkdown } from '../../editor'
import { useCloud } from '../../cloud'
import { agentIdOf, isAgentWriting } from '../agents/attribution'
import { addTrusted, clearFileTouched, clearMcpTouched, isFileTouched, isMcpTouched, loadFileTouched, loadMcpTouched, markFileTouched, markMcpTouched, trustedHashes } from './local'
import { refIdsOf, refsKey } from './refs'
import { codingProps, optionName, pipelineDbIds, readPipeline } from './schema'
import { currentWriter, mcpCaused, withWriter, type Writer } from '../../store/writer'
import { isEjectWriter } from '../recorder/settled'
import { contentKey } from '../history/snapshots'

const inTeam = () => useCloud.getState().active.kind === 'cloud'

function fnv(str: string, seed: number): string {
  let h = seed >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

async function sha256(text: string): Promise<string> {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
      return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
    }
  } catch {
    /* below */
  }
  return `f${fnv(text, 0x811c9dc5)}${fnv(text, 0x01234567)}${text.length.toString(16)}`
}

/**
 * The pipeline's part of a task version: what each stage sends to the worker or decides next. A stage's model is
 * appended only when it has one (as `{ model }`, never to be read as an output): a stage without a model hashes
 * exactly as before models existed, so tasks confirmed then stay confirmed. A gate's `hold` ("Always stop here") the same
 * way, only when set — a pipeline without one hashes exactly as before.
 *
 * The task's own model (TaskLocal.model) is not part of the version: it is kept on this device only (never synced),
 * so only the person at this device can set it — the one whose worker and Claude account run the task. There is no
 * one else's change to confirm.
 */
const pipelineKey = (db: Database | undefined) =>
  JSON.stringify(readPipeline(db).map((s) => [s.id, s.name, s.kind, !!s.auto, s.permissionMode ?? null, s.maxTurns ?? null, s.gitAction ?? null, s.next ?? null, s.instructions ?? '', ...(s.output ? [s.output] : []), ...(s.model ? [{ model: s.model }] : []), ...(s.hold ? [{ hold: true }] : [])]))

/** The row's fields that decide where the worker works: the repo (by name), the branch, the stage. */
function fieldsKey(page: Page, db: Database | undefined): string {
  if (!db) return '[]'
  const props = codingProps(db)
  const branch = props.branch ? page.properties[props.branch] : null
  return JSON.stringify([...(db.system === 'coding' && codingAgentOf(db, page) !== 'claude' ? [{ agent: codingAgentOf(db, page) }] : []), optionName(db, props.repo, props.repo ? page.properties[props.repo] : null), typeof branch === 'string' ? branch.trim() : '', props.stage ? (page.properties[props.stage] ?? null) : null])
}

/**
 * The version of a task (title + page + repo / branch / stage + pipeline + the pages it refers to — they go to the
 * worker too; a task without references keeps the version it had before references existed).
 */
export function versionOf(page: Page, db: Database | undefined): Promise<string> {
  const refs = refsKey(page)
  return sha256(`${page.title}\n\u0000${docToMarkdown(page.content)}\n\u0000${fieldsKey(page, db)}\n\u0000${pipelineKey(db)}${refs ? `\n\u0000${refs}` : ''}`)
}

/** Local workspaces: a custom agent created the task or changed it last (stamped on this device). */
const agentTouched = (page: Page) => !!agentIdOf(page.createdBy) || !!agentIdOf(page.updatedBy)

/**
 * The folder / GitHub pick-up wrote the task's text (`contentOrigin` 'file' — this tab's pick-up; another tab's arrives as
 * 'sync' like any cross-tab write, so the per-device mark `fileTouched` carries it there) or wrote / made it (the mark).
 */
const fileWritten = (page: Page) => page.contentOrigin === 'file' || isFileTouched(page.id)

/** Does a task need a trusted version (team: always; local: one an agent wrote, one an MCP write moved, one a file wrote)? */
export function needsConfirm(page: Page): boolean {
  return inTeam() || agentTouched(page) || isMcpTouched(page.id) || fileWritten(page)
}

/** Why a local task waits for Confirm (the task panel's words): the newest outside writer. */
export function confirmWhy(page: Page): 'agent' | 'mcp' | 'file' | null {
  if (inTeam()) return null
  if (fileWritten(page)) return 'file'
  if (isMcpTouched(page.id)) return 'mcp'
  return agentTouched(page) ? 'agent' : null
}

/**
 * A write an MCP client made, or one it caused: a synced copy, an automation, autofill … (their `cause`), a script such an
 * automation started (its `via`) — store/writer.ts `mcpCaused`.
 */
const byMcp = (w: Writer | null): boolean => mcpCaused(w)

/**
 * Local workspaces: would a write from this tab end the task's wait for Confirm? The attribution keeper
 * (agents/attribution.ts) clears an agent's "last edited" stamp on the next change made here — a task an agent changed
 * (but did not create) then counts as the person's own again. The AI terminal never writes such a task on its own
 * (an Undo of its writes leaves it alone): only "Confirm on this device" on the task page ends the wait.
 */
export function writeEndsConfirm(page: Page): boolean {
  // a text the pick-up wrote: any content write here replaces its origin (the mark keeps the wait — but a chain or an
  // Undo leaves such a task alone all the same)
  return !inTeam() && ((!agentIdOf(page.createdBy) && !!agentIdOf(page.updatedBy)) || page.contentOrigin === 'file')
}

/** Trust the watch is still carrying over (changes made here a moment ago). */
let settling: Promise<void> = Promise.resolve()

/** May the worker on this device run the task as it is now? */
export async function isTrusted(taskId: ID): Promise<boolean> {
  await settling
  await Promise.all([loadMcpTouched(), loadFileTouched()])
  const s = useWorkspace.getState()
  const page = s.pages[taskId]
  if (!page?.databaseId) return false
  if (!needsConfirm(page)) return true
  return (await trustedHashes()).has(await versionOf(page, s.databases[page.databaseId]))
}

/** What `trustState` hashed: the version, whether this device trusts it, and the objects it was made of. */
export interface TrustState {
  ok: boolean
  version: string
  page: Page
  db: Database | undefined
  /** the pages the version took along (refIdsOf), as they were */
  refs: Page[]
}

/**
 * A task's trust in one look — ONE versionOf, read from one store snapshot (null: not a task row). `ok`: the task
 * needs no Confirm here, or this device trusts exactly this version. Readers that keep the answer (coding/waiting.ts)
 * hold it only while the page, its database and every page in `refs` are still the same objects.
 */
export async function trustState(taskId: ID): Promise<TrustState | null> {
  await settling
  await Promise.all([loadMcpTouched(), loadFileTouched()])
  const s = useWorkspace.getState()
  const page = s.pages[taskId]
  if (!page?.databaseId) return null
  const db = s.databases[page.databaseId]
  // the same tick as versionOf's own reads (refsKey reads the store before its first await)
  const refs = refIdsOf(page).map((id) => s.pages[id]).filter((p): p is Page => !!p)
  const [version, set] = await Promise.all([versionOf(page, db), trustedHashes()])
  return { ok: !needsConfirm(page) || set.has(version), version, page, db, refs }
}

/** The person saw this version here (an action on the task, "Confirm on this device"). */
export async function trustTask(taskId: ID): Promise<void> {
  const s = useWorkspace.getState()
  const page = s.pages[taskId]
  if (!page?.databaseId) return
  await addTrusted(await versionOf(page, s.databases[page.databaseId]))
  // seen and confirmed here: no longer waiting because of an MCP write or a file the pick-up read
  await Promise.all([clearMcpTouched(taskId), clearFileTouched(taskId)])
}

/**
 * Run a write of this device (the pipeline's plan / summary, a stage move, a pipeline edit): tasks whose
 * version was trusted before stay trusted after it.
 */
export async function keepTrust(taskIds: ID[], write: () => void, writer: Writer): Promise<void> {
  const s0 = useWorkspace.getState()
  const set = await trustedHashes()
  const before = await Promise.all(taskIds.map(async (id) => {
    const p = s0.pages[id]
    return !!p?.databaseId && set.has(await versionOf(p, s0.databases[p.databaseId]))
  }))
  // the write itself runs under its writer (store/writer.ts): the worker's stage, the person on the panel, the terminal
  withWriter(writer, write)
  const s = useWorkspace.getState()
  await Promise.all(taskIds.map(async (id, i) => {
    const p = s.pages[id]
    if (before[i] && p?.databaseId) await addTrusted(await versionOf(p, s.databases[p.databaseId]))
  }))
}

let watching = false

/**
 * Changes made in this tab keep a trusted task trusted: typed content (sync and file pick-ups never do),
 * its fields, a pipeline database's schema and pipeline (Coding · Business analysis · QA). Server / other-tab changes and agent writes don't.
 * The folder / GitHub pick-up never carries trust (its writer kind 'sync'): locally a task it wrote or made is marked and
 * waits for Confirm; the person's own edit of it in the editor makes it theirs again.
 */
export function startTrustWatch(): void {
  if (watching) return
  watching = true
  void loadMcpTouched()
  void loadFileTouched()
  useWorkspace.subscribe((next, prev) => {
    if (next.pages === prev.pages && next.databases === prev.databases) return
    if (isApplyingRemote() || isAgentWriting()) return
    const writer = currentWriter()
    // an eject (or its Undo) never makes a task trusted: what it put back waits for Confirm where a task needs one
    if (isEjectWriter(writer)) return
    // an MCP write never carries trust; locally the tasks whose version it moved wait for Confirm from now on
    if (byMcp(writer)) {
      if (!inTeam()) markMoved(next, prev)
      return
    }
    // a file read by the folder / GitHub pick-up (or a write it caused) never carries trust either
    if (byFile(writer)) {
      if (!inTeam()) markFileRows(next, prev)
      return
    }
    if (!inTeam() && next.pages !== prev.pages) keepFileMarks(next, prev, writer)
    for (const dbId of pipelineDbIds()) watchDb(dbId, next, prev)
  })
}

/** A write the folder / GitHub pick-up made (or one it caused: a synced copy, an automation, autofill …). */
const byFile = (w: Writer | null): boolean => !!w && (w.kind === 'sync' || ('cause' in w && typeof w.cause === 'string' && w.cause.startsWith('sync:')))

/** The pipeline rows a write changed or made (O(changed) — the store's shared diff). */
function pipelineRowsChanged(next: WorkspaceState, prev: WorkspaceState): Array<[Page, Page | undefined]> {
  if (next.pages === prev.pages) return []
  const dbs = new Set(pipelineDbIds())
  const out: Array<[Page, Page | undefined]> = []
  for (const id of pageChanges(next.pages, prev.pages).changed) {
    const now = next.pages[id]
    if (now?.databaseId && dbs.has(now.databaseId) && !now.trashed) out.push([now, prev.pages[id]])
  }
  return out
}

/**
 * Locally: the pipeline rows the pick-up made, or whose text or title it wrote, wait for Confirm (their fields that
 * move a task never come from a file — sync/pickup.ts; a priority alone is no reason to wait).
 */
function markFileRows(next: WorkspaceState, prev: WorkspaceState): void {
  const ids = pipelineRowsChanged(next, prev)
    .filter(([now, before]) => !before || now.title !== before.title || now.content !== before.content)
    .map(([now]) => now.id)
  // isTrusted waits for this (a worker asking right after the pick-up sees the mark)
  if (ids.length) settling = settling.then(() => markFileTouched(ids)).catch(() => {})
}

/**
 * Locally, outside the pick-up: a task whose text a file wrote stays waiting when its origin moves on by anything but the
 * person's own edit (an editor filling in block ids on open, a chain, an Undo) — marked; the person's own edit in the
 * editor (a change of what it says, not of its ids) ends the wait.
 */
function keepFileMarks(next: WorkspaceState, prev: WorkspaceState, writer: Writer | null): void {
  const typed = writer?.kind === 'editor'
  const mark: ID[] = []
  const clear: ID[] = []
  for (const [now, before] of pipelineRowsChanged(next, prev)) {
    if (!before || now.content === before.content) continue
    const edited = typed && contentKey(now.content) !== contentKey(before.content)
    if (edited && (before.contentOrigin === 'file' || isFileTouched(now.id))) clear.push(now.id)
    else if (before.contentOrigin === 'file' && now.contentOrigin !== 'file') mark.push(now.id)
  }
  if (mark.length) settling = settling.then(() => markFileTouched(mark)).catch(() => {})
  if (clear.length) settling = settling.then(() => Promise.all(clear.map((id) => clearFileTouched(id)))).then(() => {}).catch(() => {})
}

/**
 * The tasks whose version a write moved: a task row that changed, every task of a pipeline whose schema / pipeline
 * changed, every task referring to a changed page (refIdsOf — its text goes to the worker with the task).
 */
function markMoved(next: WorkspaceState, prev: WorkspaceState): void {
  const changed = new Set(next.pages === prev.pages ? [] : pageChanges(next.pages, prev.pages).changed)
  const moved: ID[] = []
  for (const dbId of pipelineDbIds()) {
    const schema = next.databases[dbId] !== prev.databases[dbId]
    for (const page of Object.values(next.pages)) {
      if (page.databaseId !== dbId || page.trashed) continue
      if (schema || changed.has(page.id) || (changed.size && refIdsOf(page).some((id) => changed.has(id)))) moved.push(page.id)
    }
  }
  // isTrusted waits for this (a worker asking right after the write sees the mark)
  if (moved.length) settling = settling.then(() => markMcpTouched(moved)).catch(() => {})
}

/** One pipeline database's part of the watch. */
function watchDb(dbId: ID, next: WorkspaceState, prev: WorkspaceState): void {
  const dbNow = next.databases[dbId]
  const dbBefore = prev.databases[dbId]
  if (next.pages === prev.pages && dbNow === dbBefore) return
  // the schema / pipeline changed: every task's version did; else only the changed rows'
  const ids = dbNow !== dbBefore ? Object.keys(next.pages).filter((id) => next.pages[id]?.databaseId === dbId) : pageChanges(next.pages, prev.pages).changed
  const pairs: Array<[Page, Page]> = []
  for (const id of ids) {
    const now = next.pages[id]
    const before = prev.pages[id]
    if (!now || !before || now.databaseId !== dbId || before.databaseId !== dbId || now.trashed || !needsConfirm(now)) continue
    if (now.contentRev !== before.contentRev && (now.contentOrigin === 'sync' || now.contentOrigin === 'file')) continue
    pairs.push([before, now])
  }
  if (!pairs.length) return
  // isTrusted waits for this: a panel or a worker asking right after a stage drag sees the carried trust
  settling = settling.then(async () => {
    const set = await trustedHashes()
    for (const [before, now] of pairs) if (set.has(await versionOf(before, dbBefore))) await addTrusted(await versionOf(now, dbNow))
  }).catch(() => {})
}

// Test hook (dev, or ?e2e): a task page's version as the worker checks it (P1: a linked task renamed on another
// page must not change it — editor/workitem/labels.ts)
if (typeof window !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e'))) {
  ;(window as unknown as { __oneTrust?: unknown }).__oneTrust = {
    version: (pageId: ID) => {
      const s = useWorkspace.getState()
      const page = s.pages[pageId]
      return page ? versionOf(page, page.databaseId ? s.databases[page.databaseId] : undefined) : null
    },
  }
}
