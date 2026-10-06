/**
 * Coding pipeline — who decides what the worker runs in a team workspace. A task runs Claude Code on the
 * machine of the person whose worker takes it, with their repos and their Claude account — so a task
 * written or changed by someone else must be seen and confirmed on THIS device first. A task version is
 * the SHA-256 of its title, its page (Markdown) and the pipeline's stage instructions; the versions this
 * device wrote or confirmed are kept per device and workspace (local.ts "<scope>|trust"). The check never
 * relies on `createdBy` / `updatedBy` (clients write those).
 *
 * Trusted automatically: a task made with "New task" here, the pipeline's own writes (plan, summaries),
 * edits typed in this tab (content origin other than 'sync' / 'file') of a version that was trusted, and
 * every task action pressed here (Approve, Rework, Answer, Run now, Retry, Confirm). Local workspaces:
 * nothing to confirm.
 */
import { useWorkspace, pageChanges } from '../../store/store'
import type { Database, ID, Page } from '../../store/types'
import { docToMarkdown } from '../../editor'
import { useCloud } from '../../cloud'
import { addTrusted, trustedHashes } from './local'
import { codingDbId } from './schema'

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

/** The pipeline's part of a task version: every stage's kind and instructions. */
const pipelineKey = (db: Database | undefined) => JSON.stringify((db?.pipeline ?? []).map((s) => [s.id, s.kind, s.instructions ?? '']))

/** The version of a task (title + page + stage instructions). */
export function versionOf(page: Page, db: Database | undefined): Promise<string> {
  return sha256(`${page.title}\n\u0000${docToMarkdown(page.content)}\n\u0000${pipelineKey(db)}`)
}

/** May the worker on this device run the task as it is now? */
export async function isTrusted(taskId: ID): Promise<boolean> {
  if (!inTeam()) return true
  const s = useWorkspace.getState()
  const page = s.pages[taskId]
  if (!page?.databaseId) return false
  return (await trustedHashes()).has(await versionOf(page, s.databases[page.databaseId]))
}

/** The person saw this version here (an action on the task, "Confirm on this device"). */
export async function trustTask(taskId: ID): Promise<void> {
  if (!inTeam()) return
  const s = useWorkspace.getState()
  const page = s.pages[taskId]
  if (page?.databaseId) await addTrusted(await versionOf(page, s.databases[page.databaseId]))
}

/**
 * Run a write of this device (the pipeline's plan / summary, a pipeline edit): tasks whose version was
 * trusted before stay trusted after it.
 */
export async function keepTrust(taskIds: ID[], write: () => void): Promise<void> {
  if (!inTeam()) return write()
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

/** Team workspaces: edits typed here keep a trusted task trusted (sync and file pick-ups never do). */
export function startTrustWatch(): void {
  if (watching) return
  watching = true
  useWorkspace.subscribe((next, prev) => {
    if (!inTeam() || next.pages === prev.pages) return
    const dbId = codingDbId()
    if (!dbId) return
    const changed = pageChanges(next.pages, prev.pages).changed
    if (!changed.length) return
    for (const id of changed) {
      const now = next.pages[id]
      const before = prev.pages[id]
      if (!now || !before || now.databaseId !== dbId || now.contentRev === before.contentRev) continue
      if (now.contentOrigin === 'sync' || now.contentOrigin === 'file') continue
      const db = next.databases[dbId]
      void (async () => {
        const set = await trustedHashes()
        if (set.has(await versionOf(before, db))) await addTrusted(await versionOf(now, db))
      })()
    }
  })
}
