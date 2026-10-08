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
 * team task until a version of it is trusted.
 */
import { useWorkspace, pageChanges, type WorkspaceState } from '../../store/store'
import { isApplyingRemote } from '../../store/persistence'
import type { Database, ID, Page } from '../../store/types'
import { docToMarkdown } from '../../editor'
import { useCloud } from '../../cloud'
import { agentIdOf, isAgentWriting } from '../agents/attribution'
import { addTrusted, trustedHashes } from './local'
import { refsKey } from './refs'
import { codingProps, optionName, pipelineDbIds, readPipeline } from './schema'

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
 * exactly as before models existed, so tasks confirmed then stay confirmed.
 *
 * The task's own model (TaskLocal.model) is not part of the version: it is kept on this device only (never synced),
 * so only the person at this device can set it — the one whose worker and Claude account run the task. There is no
 * one else's change to confirm.
 */
const pipelineKey = (db: Database | undefined) =>
  JSON.stringify(readPipeline(db).map((s) => [s.id, s.name, s.kind, !!s.auto, s.permissionMode ?? null, s.maxTurns ?? null, s.gitAction ?? null, s.next ?? null, s.instructions ?? '', ...(s.output ? [s.output] : []), ...(s.model ? [{ model: s.model }] : [])]))

/** The row's fields that decide where the worker works: the repo (by name), the branch, the stage. */
function fieldsKey(page: Page, db: Database | undefined): string {
  if (!db) return '[]'
  const props = codingProps(db)
  const branch = props.branch ? page.properties[props.branch] : null
  return JSON.stringify([optionName(db, props.repo, props.repo ? page.properties[props.repo] : null), typeof branch === 'string' ? branch.trim() : '', props.stage ? (page.properties[props.stage] ?? null) : null])
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

/** Does a task need a trusted version (team: always; local: only one an agent wrote)? */
export function needsConfirm(page: Page): boolean {
  return inTeam() || agentTouched(page)
}

/**
 * Local workspaces: would a write from this tab end the task's wait for Confirm? The attribution keeper
 * (agents/attribution.ts) clears an agent's "last edited" stamp on the next change made here — a task an agent changed
 * (but did not create) then counts as the person's own again. The AI terminal never writes such a task on its own
 * (an Undo of its writes leaves it alone): only "Confirm on this device" on the task page ends the wait.
 */
export function writeEndsConfirm(page: Page): boolean {
  return !inTeam() && !agentIdOf(page.createdBy) && !!agentIdOf(page.updatedBy)
}

/** Trust the watch is still carrying over (changes made here a moment ago). */
let settling: Promise<void> = Promise.resolve()

/** May the worker on this device run the task as it is now? */
export async function isTrusted(taskId: ID): Promise<boolean> {
  await settling
  const s = useWorkspace.getState()
  const page = s.pages[taskId]
  if (!page?.databaseId) return false
  if (!needsConfirm(page)) return true
  return (await trustedHashes()).has(await versionOf(page, s.databases[page.databaseId]))
}

/** The person saw this version here (an action on the task, "Confirm on this device"). */
export async function trustTask(taskId: ID): Promise<void> {
  const s = useWorkspace.getState()
  const page = s.pages[taskId]
  if (page?.databaseId) await addTrusted(await versionOf(page, s.databases[page.databaseId]))
}

/**
 * Run a write of this device (the pipeline's plan / summary, a stage move, a pipeline edit): tasks whose
 * version was trusted before stay trusted after it.
 */
export async function keepTrust(taskIds: ID[], write: () => void): Promise<void> {
  const s0 = useWorkspace.getState()
  const set = await trustedHashes()
  const before = await Promise.all(taskIds.map(async (id) => {
    const p = s0.pages[id]
    return !!p?.databaseId && set.has(await versionOf(p, s0.databases[p.databaseId]))
  }))
  write()
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
 */
export function startTrustWatch(): void {
  if (watching) return
  watching = true
  useWorkspace.subscribe((next, prev) => {
    if (next.pages === prev.pages && next.databases === prev.databases) return
    if (isApplyingRemote() || isAgentWriting()) return
    for (const dbId of pipelineDbIds()) watchDb(dbId, next, prev)
  })
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
