/**
 * one-worker — what it remembers between runs (worker-state.json next to worker.json, mode 0600, never
 * sent anywhere):
 *  - which branches and worktrees IT created (only those are ever removed — cleanup, discard),
 *  - the folders of its own failed checkouts that Windows still held (removed once they can be — git.ts),
 *  - which worktree a task works in,
 *  - what Claude Code cost per task and per day (the limits in worker.json).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathId, renameRetry } from './paths.ts'

export interface CreatedEntry {
  task: string
  /** the worktree's path (null: the task reused a worktree the worker did not create) */
  worktree: string | null
  /** the worker created the branch itself */
  branchCreated: boolean
  /** the base commit the branch started from */
  fork: string | null
  at: number
}

/** A folder of the worker's own failed checkout it could not remove yet (Windows held a file in it). */
export interface Leftover {
  dir: string
  /** the branch that checkout was for */
  branch: string
  /** set when that checkout created the branch and it was still there: deleted with the folder while it points here */
  tip: string | null
  at: number
}

export interface StateData {
  v: 1
  /** repo name → branch → what the worker created */
  created: Record<string, Record<string, CreatedEntry>>
  /** task id → where it works */
  tasks: Record<string, { repo: string; branch: string; worktree: string }>
  /** "YYYY-MM-DD" (local) → $ */
  spent: Record<string, number>
  /** task id → $ */
  taskSpent: Record<string, number>
  /** repo name → leftovers of failed checkouts (an older worker drops the key: it only forgets) */
  leftovers: Record<string, Leftover[]>
}

const empty = (): StateData => ({ v: 1, created: {}, tasks: {}, spent: {}, taskSpent: {}, leftovers: {} })

/** Leftovers as read from the file: well-formed entries only, at most 50 per repo. */
function readLeftovers(raw: unknown): StateData['leftovers'] {
  const out: StateData['leftovers'] = {}
  if (!isObj(raw)) return out
  for (const [repo, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) continue
    const ok = list
      .filter((l): l is Leftover => isObj(l) && typeof l.dir === 'string' && !!l.dir && typeof l.branch === 'string' && !!l.branch && (l.tip === null || typeof l.tip === 'string') && typeof l.at === 'number')
      .slice(0, 50)
      .map((l) => ({ dir: l.dir, branch: l.branch, tip: l.tip, at: l.at }))
    if (ok.length) out[repo] = ok
  }
  return out
}

export const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export class WorkerState {
  readonly file: string
  data: StateData

  constructor(configFile: string) {
    this.file = join(dirname(configFile), 'worker-state.json')
    this.data = empty()
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as unknown
        if (isObj(raw) && raw.v === 1) {
          this.data = {
            v: 1,
            created: isObj(raw.created) ? (raw.created as StateData['created']) : {},
            tasks: isObj(raw.tasks) ? (raw.tasks as StateData['tasks']) : {},
            spent: isObj(raw.spent) ? (raw.spent as StateData['spent']) : {},
            taskSpent: isObj(raw.taskSpent) ? (raw.taskSpent as StateData['taskSpent']) : {},
            leftovers: readLeftovers(raw.leftovers),
          }
        }
      }
    } catch {
      /* unreadable: start fresh (nothing is removed without an entry, so this only forgets) */
    }
  }

  save(): void {
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 })
    // Windows: Defender or the indexer may hold the file a moment
    renameRetry(tmp, this.file)
  }

  created(repo: string, branch: string): CreatedEntry | null {
    return this.data.created[repo]?.[branch] ?? null
  }

  remember(repo: string, branch: string, entry: CreatedEntry): void {
    ;(this.data.created[repo] ??= {})[branch] = entry
    this.save()
  }

  forget(repo: string, branch: string): void {
    if (this.data.created[repo]) delete this.data.created[repo][branch]
    for (const [id, t] of Object.entries(this.data.tasks)) if (t.repo === repo && t.branch === branch) delete this.data.tasks[id]
    this.save()
  }

  /** The leftovers of `repo`'s failed checkouts (git.ts removes them once Windows lets go). */
  leftovers(repo: string): Leftover[] {
    return [...(this.data.leftovers[repo] ?? [])]
  }

  /** Is `dir` a leftover of `repo` (compared as the disk does — paths.ts pathId)? */
  isLeftover(repo: string, dir: string): boolean {
    return (this.data.leftovers[repo] ?? []).some((l) => pathId(l.dir) === pathId(dir))
  }

  addLeftover(repo: string, entry: Leftover): void {
    const list = (this.data.leftovers[repo] ?? []).filter((l) => pathId(l.dir) !== pathId(entry.dir))
    this.data.leftovers[repo] = [...list, entry].slice(-50)
    this.save()
  }

  dropLeftover(repo: string, dir: string): void {
    const list = (this.data.leftovers[repo] ?? []).filter((l) => pathId(l.dir) !== pathId(dir))
    if (list.length) this.data.leftovers[repo] = list
    else delete this.data.leftovers[repo]
    this.save()
  }

  taskAt(taskId: string): { repo: string; branch: string; worktree: string } | null {
    return this.data.tasks[taskId] ?? null
  }

  setTask(taskId: string, at: { repo: string; branch: string; worktree: string }): void {
    this.data.tasks[taskId] = at
    this.save()
  }

  spentToday(): number {
    return Math.round((this.data.spent[today()] ?? 0) * 100) / 100
  }

  spentOn(taskId: string): number {
    return this.data.taskSpent[taskId] ?? 0
  }

  addCost(taskId: string, usd: number): void {
    if (!(usd > 0)) return
    const day = today()
    this.data.spent[day] = (this.data.spent[day] ?? 0) + usd
    this.data.taskSpent[taskId] = (this.data.taskSpent[taskId] ?? 0) + usd
    // keep a month of days
    const days = Object.keys(this.data.spent).sort()
    for (const d of days.slice(0, Math.max(0, days.length - 31))) delete this.data.spent[d]
    this.save()
  }
}
