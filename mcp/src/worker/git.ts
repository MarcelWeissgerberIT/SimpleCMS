/**
 * one-worker — git, always as a program with an argument list (exec.ts: never a shell line; on Windows only a git.exe
 * from PATH, never one from the repository; hooks and the person's git config apply as usual; no terminal — and on
 * Windows ssh in BatchMode unless they set their own —, so git never waits for a typed password — gitenv.ts). The main checkout's
 * working tree is never touched: every task works in its own worktree. Nothing here deletes work the worker did not
 * create, and nothing is force-pushed unless the person picked "Force push" in One (then --force-with-lease).
 *
 *  - ensureWorktree: a new branch <prefix><slug>-<shortid> from <remote>/<base> (after a fetch — one that fails
 *    or takes over 60 s is noted and the local state is used) in its own
 *    worktree, or the branch the task names (must exist; never reset)
 *  - info: ahead / behind, pushed, commits, per-file diff (size-capped, binary skipped), conflicts, the web address
 *  - commit · push · openPr (gh / glab, else a compare link; on GitLab an open merge request is found first) ·
 *    updateFromBase (the remote task branch merged in first when it has commits HEAD lacks — never a rebase or a force
 *    there —, then the base: rebase only if never pushed, else merge; conflicts reported per file, left for a stage to
 *    resolve) · discard · cleanup
 *  - the web address per forge (webBase / webOf, worker.json "forge"; an ssh host alias named by `ssh -G`, nothing
 *    connects): scheme + host + project path, never credentials or a local path — what One links commits, branches and
 *    requests with; info marks each commit pushed or not (GitCommit.remote)
 */
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, statSync } from 'node:fs'
import { dirname, join, posix, resolve, win32 } from 'node:path'
import { GIT_SHA, cleanWeb, type Forge, type ForgeSetting, type ForgeWeb, type GitCommit, type GitFile, type GitInfo } from '../../../src/app/features/coding/protocol.ts'
import type { RepoConfig } from './config.ts'
import { execFileSafe, killTree, spawnSafe } from './exec.ts'
import { FOLDER_BUSY, GIT_ENV, folderBusyCode, gitArgs, gitEnv } from './gitenv.ts'
import { inFolder, pathId, rmRetry, samePath } from './paths.ts'
import type { WorkerState } from './state.ts'

export interface GitRun {
  code: number
  stdout: string
  stderr: string
  /** killed at the time limit */
  timedOut?: boolean
  /** git was ended (time limit, too much output): settles once it is gone — before its folder is removed */
  ended?: Promise<void>
}

export class GitError extends Error {
  /** a log code that says more (folderBusy: Windows still holds files in a folder the worker removes) */
  code?: string
  /**
   * git's whole message (≤ 16 KB) — what the hints read (gitenv.ts gitHint: the line that names a lock file or dubious
   * ownership may be anywhere in it) and this computer's terminal only. Never sent to One: `message` is.
   */
  detail?: string
  constructor(message: string, code?: string, detail?: string) {
    super(message)
    if (code) this.code = code
    if (detail) this.detail = detail.slice(0, 16 * 1024)
  }
}

/** A line of Git for Windows' ownership report: an account (computer / user) with its SID, and the lines around it. */
const ACCOUNT_LINE = /\(S-1-[0-9-]+\)\s*$|^\s*'[^'\n]*' is owned by:\s*$|^\s*but the current user is:\s*$/i

/**
 * git's message as One may get it: its last `lines` lines — without the account names and SIDs of an ownership report
 * (Git for Windows names the folder's owner and the current user: computer, user name, SID). A dubious-ownership refusal
 * is its first line only (the folder: the scrubber makes it <repo>); the safe.directory line stays in the terminal. An
 * identity refusal loses the identity git guessed — account and computer name (`(got 'max@DESKTOP-4F2K9QL.(none)')`,
 * `(for <max@desktop>)`) — the hint gitIdentity says what to do.
 */
export function gitMessage(text: string, lines = 6): string {
  const s = text
    .replace(/\r\n?/g, '\n')
    .trim()
    .replace(/\(got '[^'\n]*'\)/g, "(got '…')")
    .replace(/\(for <[^>\n]*>\)/g, '(for <…>)')
  const dubious = /^.*detected dubious ownership.*$/im.exec(s)?.[0]
  if (dubious) return dubious.trim()
  return s
    .split('\n')
    .filter((l) => !ACCOUNT_LINE.test(l))
    .slice(-lines)
    .join('\n')
}

/** A GitError from a git run: the clipped message for One, git's whole text for the hints and the terminal. */
export const gitFailure = (r: { stderr: string; stdout: string }, fallback: string, lines = 6, code?: string): GitError => {
  const text = r.stderr || r.stdout
  return new GitError(gitMessage(text, lines) || fallback, code, text)
}

/** Per-file and total diff caps (what goes to One). */
export const DIFF_FILE_MAX = 120_000
export const DIFF_TOTAL_MAX = 1_500_000
export const DIFF_FILES_MAX = 200

const OUT_MAX = 32 * 1024 * 1024

/**
 * Run git. Resolves with the exit code — never throws for a non-zero exit. On macOS / Linux git runs in its own
 * session without a terminal: a password, SSH passphrase or host-key question fails at once (git says why)
 * instead of waiting for someone to type into the worker's terminal; on Windows ssh runs in BatchMode for the same
 * (gitenv.ts). An SSH agent or a credential helper still works. At the time limit it answers at once — git and what it
 * started are ended behind it (`ended`). `local`: a call that never reaches a remote (the ZIP import) — no config is
 * read for ssh in `cwd`.
 */
export async function git(cwd: string, args: string[], timeoutMs = 120_000, opts: { local?: boolean } = {}): Promise<GitRun> {
  const env = opts.local ? { ...process.env, ...GIT_ENV } : await gitEnv(cwd, process.env, { timeoutMs })
  return new Promise((done) => {
    const out: Buffer[] = []
    const err: Buffer[] = []
    let size = 0
    let why: string | null = null
    let settled = false
    let ended: Promise<void> | undefined
    const finish = (code: number, extra = '') => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const stderr = Buffer.concat(err).toString()
      done({ code, stdout: Buffer.concat(out).toString(), stderr: why ?? (stderr || extra), timedOut: why !== null && why.includes('did not finish'), ...(ended ? { ended } : {}) })
    }
    const s = spawnSafe('git', gitArgs(args), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true, allow: 'exe' })
    const timer = setTimeout(() => {
      why = `git ${args[0]} did not finish within ${Math.round(timeoutMs / 1000)} s — no network, files still coming from iCloud Drive, or it waits for a password or an SSH key passphrase (the worker cannot type one: use an SSH agent or a credential helper)`
      if (s.ok) ended = killTree(s.child)
      // a git stuck in the file system (an iCloud file being fetched) may not die at once: give up on it now, never wait
      finish(1)
    }, timeoutMs)
    if (!s.ok) return finish(127, s.error)
    const child = s.child
    const take = (into: Buffer[]) => (d: Buffer) => {
      size += d.length
      if (size > OUT_MAX) {
        if (!why) {
          why = `git ${args[0]}: output too large`
          ended = killTree(child)
        }
        return
      }
      into.push(d)
    }
    child.stdout!.on('data', take(out))
    child.stderr!.on('data', take(err))
    child.on('error', (e) => finish(127, e.message))
    child.on('close', (code) => finish(why ? 1 : (code ?? 1)))
  })
}

/** Run git; throw a GitError with git's message on a non-zero exit. */
export async function gitOk(cwd: string, args: string[], timeoutMs?: number): Promise<string> {
  const r = await git(cwd, args, timeoutMs)
  if (r.code !== 0) throw gitFailure(r, `git ${args[0]} failed`)
  return r.stdout
}

const same = (a: string, b: string) => samePath(a, b)

/* ------------------------------------------------------------------ repo facts */

/** The repo's main checkout (toplevel); throws when `path` is not a git checkout. */
export async function checkRepo(repo: RepoConfig): Promise<string> {
  if (!existsSync(repo.path)) throw new GitError(`the folder does not exist`)
  const r = await git(repo.path, ['rev-parse', '--show-toplevel'], 30_000, { local: true })
  if (r.code !== 0) throw gitFailure(r, 'git rev-parse failed')
  const top = r.stdout.trim()
  if (!top) throw new GitError('not a git checkout')
  return nativePath(top)
}

/**
 * A path git printed, in this computer's own form: Git for Windows writes C:/Users/… — the worker keeps and compares
 * C:\Users\… (what join / resolve give it). Elsewhere as git wrote it (resolved: no trailing separator, no "//").
 */
export function nativePath(p: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? win32.resolve(p) : posix.resolve(p)
}

/** `git worktree list --porcelain` read: each worktree's path in this computer's form (nativePath). */
export function parseWorktrees(out: string, platform: NodeJS.Platform = process.platform): Worktree[] {
  const list: Worktree[] = []
  let cur: Worktree | null = null
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      cur = { path: nativePath(line.slice(9), platform), branch: null, head: null, bare: false }
      list.push(cur)
    } else if (cur && line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '')
    else if (cur && line.startsWith('HEAD ')) cur.head = line.slice(5)
    else if (cur && line === 'bare') cur.bare = true
  }
  return list
}

export async function hasRemote(repo: RepoConfig): Promise<boolean> {
  return (await git(repo.path, ['remote', 'get-url', repo.remote])).code === 0
}

export interface Worktree {
  path: string
  branch: string | null
  head: string | null
  bare: boolean
}

export async function listWorktrees(repo: RepoConfig): Promise<Worktree[]> {
  const r = await git(repo.path, ['worktree', 'list', '--porcelain'], 120_000, { local: true })
  if (r.code !== 0) throw gitFailure(r, 'git worktree failed')
  return parseWorktrees(r.stdout)
}

/** Branch names only — the newest first, at most BRANCHES_MAX (what One offers in a task's Branch field). */
export const BRANCHES_MAX = 100

export async function localBranches(repo: RepoConfig, timeoutMs = 5000): Promise<string[]> {
  const r = await git(repo.path, ['for-each-ref', '--sort=-committerdate', `--count=${BRANCHES_MAX}`, '--format=%(refname:short)', 'refs/heads'], timeoutMs, { local: true })
  if (r.code !== 0) return []
  return r.stdout
    .split(/\r?\n/)
    .map((b) => b.trim())
    .filter((b) => b && b.length <= 200)
}

export async function prune(repo: RepoConfig): Promise<void> {
  await git(repo.path, ['worktree', 'prune'], 30_000, { local: true })
}

const refExists = async (cwd: string, ref: string) => (await git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).code === 0
export const branchExists = (repo: RepoConfig, b: string) => refExists(repo.path, `refs/heads/${b}`)
export const remoteBranchExists = (repo: RepoConfig, b: string) => refExists(repo.path, `refs/remotes/${repo.remote}/${b}`)

/** A valid branch name? (git's own rules) */
export async function validBranch(repo: RepoConfig, b: string): Promise<boolean> {
  if (!b || b.length > 200 || b.startsWith('-')) return false
  return (await git(repo.path, ['check-ref-format', '--branch', b])).code === 0
}

/** How long a fetch may take (ONE_WORKER_FETCH_MS for tests). */
const fetchMs = () => Number(process.env.ONE_WORKER_FETCH_MS) || 60_000

/** Fetch the remote (quietly; a repo without that remote is fine). Throws when it fails or takes too long. */
export async function fetchRemote(repo: RepoConfig): Promise<boolean> {
  if (!(await hasRemote(repo))) return false
  await gitOk(repo.path, ['fetch', '--quiet', '--prune', repo.remote], fetchMs())
  return true
}

/** What a task's preparation tells the log (`detail`: git's whole message behind a failure — for the hints, never One). */
export type GitNote = (kind: 'git' | 'warn', text: string, code?: string, vars?: Record<string, string | number>, detail?: string) => void

/** How much of git's reason a failed fetch shows (cut after the scrubber). */
export const FETCH_WHY_MAX = 300

/**
 * Fetch for a new task: a failure is noted and the task goes on from what this computer has. `scrub` takes this
 * computer's paths out of git's reason BEFORE it is cut to FETCH_WHY_MAX (a path cut in two passes the scrubber).
 */
export async function tryFetch(repo: RepoConfig, note?: GitNote, scrub: (s: string) => string = (s) => s): Promise<boolean> {
  if (!(await hasRemote(repo))) return false
  note?.('git', `Fetching ${repo.remote}…`, 'fetching', { remote: repo.remote })
  try {
    return await fetchRemote(repo)
  } catch (e) {
    const why = scrub((e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').trim()).slice(0, FETCH_WHY_MAX)
    note?.('warn', `Could not fetch ${repo.remote} (${why}) — going on with what this computer has.`, 'fetchFailed', { remote: repo.remote, why }, e instanceof GitError ? e.detail : undefined)
    return false
  }
}

/** "<remote>/<base>" when the remote has it, else the local base branch. */
export async function baseRef(repo: RepoConfig): Promise<string> {
  if (await refExists(repo.path, `refs/remotes/${repo.remote}/${repo.baseBranch}`)) return `${repo.remote}/${repo.baseBranch}`
  if (await refExists(repo.path, `refs/heads/${repo.baseBranch}`)) return repo.baseBranch
  throw new GitError(`the base branch "${repo.baseBranch}" exists neither on ${repo.remote} nor locally`)
}

/* ------------------------------------------------------------------ worktrees */

/** "Fix the login form!" → "fix-the-login-form" */
export function slug(title: string, max = 40): string {
  const s = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '')
  return s || 'task'
}

export const shortId = (taskId: string) => taskId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6) || 'task'

/** A Windows device name (with any extension): such a folder opens the device, never a folder. */
const DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)$/i

/**
 * The worktree's folder name for a branch. macOS / Linux: the branch with "/" as "-" (as always). Windows: also nothing
 * but letters, digits, "." "_" "-" (else "_"), no trailing dot, no device name, and at most 32 characters + "-" + 6 hex
 * of the branch's hash whenever a name was changed or cut — distinct per branch, short enough for deep repos under
 * the 260-character limit. The branch itself keeps its name on every OS.
 */
export function worktreeFolder(branch: string, platform: NodeJS.Platform = process.platform): string {
  const plain = branch.replace(/[\\/]+/g, '-')
  if (platform !== 'win32') return plain
  // letters, digits, "." "_" "-" only: a branch name One or a remote chose never puts a character cmd.exe or a command
  // line reads (= , ; & ^ % ! space …) into the worktree's path — exec.ts names files inside it relatively anyway
  let s = plain.replace(/[^A-Za-z0-9._-]/g, '_').replace(/[. ]+$/, '')
  if (DEVICE.test(s.split('.')[0]!)) s = `_${s}`
  if (s === plain && s.length <= 32) return s
  const cut = s.slice(0, 32).replace(/[. ]+$/, '') || '_'
  return `${cut}-${createHash('sha1').update(branch).digest('hex').slice(0, 6)}`
}

/**
 * The folders of the worker's own failed checkouts that Windows still held (worker-state.json keeps them, so a restart
 * forgets none): removed now where they can be — only inside the repo's worktree folder, never while git has another
 * branch checked out there or a task works there — and with each the branch that checkout made, while that still
 * points where the checkout left it, nothing has it checked out and no task took it. Runs before every new worktree of
 * the repo and at the worker's start. Never throws; a folder still held stays for the next time. Returns what went.
 */
export async function sweepLeftovers(repo: RepoConfig, state: WorkerState): Promise<string[]> {
  const removed: string[] = []
  for (const l of state.leftovers(repo.name)) {
    try {
      const used = state.created(repo.name, l.branch)
      const at = (await listWorktrees(repo)).find((w) => same(w.path, l.dir))
      // not the failed checkout's any more: another branch there, a task works in it, or it is no longer this repo's
      // checkout (another repo's worktree in a shared worktreeDir, a folder made anew) — the folder stays
      if (!insideWorktrees(repo, l.dir) || (at && at.branch !== l.branch) || (used?.worktree && same(used.worktree, l.dir)) || !(await stillOurs(repo, state, l))) {
        state.dropLeftover(repo.name, l.dir)
        continue
      }
      if (existsSync(l.dir) && !(await rmRetry(l.dir))) continue
      await prune(repo)
      if (l.tip && !used && (await branchExists(repo, l.branch))) {
        const tip = (await git(repo.path, ['rev-parse', '--verify', '--quiet', `refs/heads/${l.branch}^{commit}`], 30_000, { local: true })).stdout.trim()
        const out = !(await listWorktrees(repo)).some((w) => w.branch === l.branch)
        if (tip === l.tip && out) await git(repo.path, ['branch', '-D', l.branch], 30_000, { local: true })
      }
      state.dropLeftover(repo.name, l.dir)
      removed.push(l.dir)
    } catch {
      /* git or the disk refused: tried again next time */
    }
  }
  return removed
}

/** A folder's own id on its disk ("<dev>:<ino>"), null when it cannot be read. */
export function folderId(dir: string): string | null {
  try {
    const st = statSync(dir, { bigint: true })
    return `${st.dev}:${st.ino}`
  } catch {
    return null
  }
}

/**
 * Is the leftover's folder still `repo`'s own failed checkout — the only thing sweepLeftovers and freeFolder remove? Not
 * when any repo's task works there (worker-state.json), when the folder was made anew since it was left (another
 * folder id), or when it holds a `.git` that is not a worktree link into this repo's own git folder
 * (`<common dir>/worktrees/…`): a worktree of another repo sharing the worktreeDir, a repository of its own.
 */
export async function stillOurs(repo: RepoConfig, state: WorkerState, l: { dir: string; id?: string }): Promise<boolean> {
  if (state.inUse(l.dir)) return false
  if (l.id && existsSync(l.dir) && folderId(l.dir) !== l.id) return false
  const dotGit = join(l.dir, '.git')
  const st = lstatSync(dotGit, { throwIfNoEntry: false })
  if (!st) return true
  if (!st.isFile()) return false
  const link = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, 'utf8').slice(0, 4096))?.[1]
  if (!link) return false
  const common = (await git(repo.path, ['rev-parse', '--git-common-dir'], 30_000, { local: true })).stdout.trim()
  if (!common) return false
  const into = resolve(l.dir, link)
  const worktrees = join(resolve(repo.path, common), 'worktrees')
  return inFolder(into, worktrees) && !samePath(into, worktrees)
}

/** The task's worktree folder, free: a leftover of the worker's own is removed now (it failed before) — else refused. */
async function freeFolder(repo: RepoConfig, state: WorkerState, dir: string, branch: string): Promise<void> {
  if (!existsSync(dir)) {
    // gone meanwhile (the person removed it): nothing left to remember — the new worktree there is a task's
    if (state.isLeftover(repo.name, dir)) state.dropLeftover(repo.name, dir)
    return
  }
  const left = state.leftovers(repo.name).find((l) => same(l.dir, dir))
  // a leftover no longer this repo's own checkout: forgotten, the folder stays (refused below, as any foreign folder)
  if (left && !(await stillOurs(repo, state, left))) state.dropLeftover(repo.name, dir)
  else if (left && insideWorktrees(repo, dir)) {
    if (await rmRetry(dir)) {
      state.dropLeftover(repo.name, dir)
      await prune(repo)
      return
    }
    throw new GitError(`the worktree folder for ${branch}, left by a failed checkout, could not be removed yet`, folderBusyCode())
  }
  throw new GitError(`the worktree folder for ${branch} already exists and is not a worktree of this repo — move it away first`)
}

export interface TaskWorktree {
  dir: string
  branch: string
  /** the worker created the branch */
  created: boolean
}

/**
 * The worktree a task works in. `wanted` = the task's Branch field: reuse that branch (its worktree when
 * it has one) — it must exist, it is never reset. Without one: a new branch from the base in a new worktree.
 */
export async function ensureWorktree(repo: RepoConfig, state: WorkerState, task: { id: string; title: string }, wanted: string | null, note?: GitNote, scrub?: (s: string) => string): Promise<TaskWorktree> {
  const top = await checkRepo(repo)
  const known = state.taskAt(task.id)
  const trees = await listWorktrees(repo)
  // the task's own worktree from an earlier stage
  if (known && known.repo === repo.name && (!wanted || wanted === known.branch)) {
    const tree = trees.find((w) => w.branch === known.branch && same(w.path, known.worktree))
    if (tree && existsSync(tree.path)) return { dir: tree.path, branch: known.branch, created: !!state.created(repo.name, known.branch)?.branchCreated }
  }
  if (wanted) return reuse(repo, state, task, wanted, top, trees, note, scrub)
  // what a failed checkout left (Windows held a file): its folder and branch go first, so the task gets its own name again
  await sweepLeftovers(repo, state)
  await tryFetch(repo, note, scrub)
  const base = await baseRef(repo)
  const fork = (await gitOk(repo.path, ['rev-parse', `${base}^{commit}`])).trim()
  let branch = `${repo.branchPrefix}${slug(task.title)}-${shortId(task.id)}`
  for (let n = 2; (await branchExists(repo, branch)) && n < 50; n++) branch = `${repo.branchPrefix}${slug(task.title)}-${shortId(task.id)}-${n}`
  if (!(await validBranch(repo, branch))) throw new GitError(`"${branch}" is not a valid branch name (check branchPrefix in worker.json)`)
  const dir = join(repo.worktreeDir, worktreeFolder(branch))
  await freeFolder(repo, state, dir, branch)
  mkdirSync(dirname(dir), { recursive: true })
  note?.('git', `New branch ${branch} from ${base} in its own worktree…`, 'newBranch', { branch, base })
  await addWorktree(repo, state, ['-b', branch, dir, base], dir, branch, branch, note)
  state.remember(repo.name, branch, { task: task.id, worktree: dir, branchCreated: true, fork, at: Date.now() })
  state.setTask(task.id, { repo: repo.name, branch, worktree: dir })
  return { dir, branch, created: true }
}

/** How long a checkout may take (ONE_WORKER_CHECKOUT_MS for tests): a big repo, or one waiting for iCloud. */
const checkoutMs = () => Number(process.env.ONE_WORKER_CHECKOUT_MS) || 600_000
const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.round(ms / 1000) % 60).padStart(2, '0')}`

/**
 * `git worktree add …` with a sign of life every 30 s. When it fails or runs out of time nothing half-made stays:
 * the folder (always inside the worker's worktree folder — it did not exist before), its worktree entry and the
 * branch this call created. git is gone first (its whole tree, on Windows too); a folder Windows still holds is tried
 * again and named (folderBusy) — git's own error is what the stage reports, whatever the cleanup met.
 */
async function addWorktree(repo: RepoConfig, state: WorkerState, args: string[], dir: string, branch: string, newBranch: string | null, note?: GitNote): Promise<void> {
  const started = Date.now()
  const beat = setInterval(() => {
    const time = clock(Date.now() - started)
    note?.('git', `Still checking out the files · ${time}`, 'checkout', { time })
  }, Number(process.env.ONE_WORKER_QUIET_MS) || 30_000)
  beat.unref()
  try {
    const r = await git(repo.path, ['worktree', 'add', ...args], checkoutMs())
    if (r.code === 0) return
    const failed = gitFailure(r, 'git worktree add failed')
    await r.ended
    try {
      let held = false
      if (insideWorktrees(repo, dir)) {
        await git(repo.path, ['worktree', 'remove', '--force', dir])
        held = !(await rmRetry(dir))
      }
      await prune(repo)
      if (newBranch && (await branchExists(repo, newBranch))) await git(repo.path, ['branch', '-D', newBranch])
      if (held) {
        // kept in worker-state.json: removed before the repo's next new worktree or at the next start (sweepLeftovers) —
        // the branch this call made with it, when it is still there, at the commit it has now
        const made = !!newBranch && (await branchExists(repo, newBranch))
        const tip = made ? (await git(repo.path, ['rev-parse', '--verify', '--quiet', `refs/heads/${newBranch}^{commit}`], 30_000, { local: true })).stdout.trim() || null : null
        const id = folderId(dir)
        state.addLeftover(repo.name, { dir, branch, tip, at: Date.now(), ...(id ? { id } : {}) })
        const busy = folderBusyCode()
        if (busy) note?.('warn', FOLDER_BUSY, busy, {})
      }
    } catch {
      /* the cleanup's own trouble never hides git's error */
    }
    throw failed
  } finally {
    clearInterval(beat)
  }
}

async function reuse(repo: RepoConfig, state: WorkerState, task: { id: string }, branch: string, top: string, trees: Worktree[], note?: GitNote, scrub?: (s: string) => string): Promise<TaskWorktree> {
  if (!(await validBranch(repo, branch))) throw new GitError(`"${branch}" is not a valid branch name`)
  const own = state.created(repo.name, branch)
  const tree = trees.find((w) => w.branch === branch)
  if (tree && same(tree.path, top)) throw new GitError(`the branch "${branch}" is checked out in the main checkout — the worker never works there. Switch the main checkout to another branch, or let the task make its own branch (clear the Branch field).`)
  // a task never works on (and Ship never pushes to) the base branch itself
  if (branch === repo.baseBranch) throw new GitError(`"${branch}" is the base branch of ${repo.name} — the worker never works on it. Let the task make its own branch (clear the Branch field).`)
  if (tree) {
    state.setTask(task.id, { repo: repo.name, branch, worktree: tree.path })
    return { dir: tree.path, branch, created: !!own?.branchCreated }
  }
  const dir = join(repo.worktreeDir, worktreeFolder(branch))
  await freeFolder(repo, state, dir, branch)
  mkdirSync(dirname(dir), { recursive: true })
  if (await branchExists(repo, branch)) {
    await addWorktree(repo, state, [dir, branch], dir, branch, null, note)
  } else {
    await tryFetch(repo, note, scrub)
    if (!(await remoteBranchExists(repo, branch))) throw new GitError(`the branch "${branch}" does not exist (locally or on ${repo.remote}) — check the task's Branch field`)
    await addWorktree(repo, state, ['--track', '-b', branch, dir, `${repo.remote}/${branch}`], dir, branch, branch, note)
  }
  // the worktree is the worker's (it may remove it); the branch stays the person's
  state.remember(repo.name, branch, { task: task.id, worktree: dir, branchCreated: !!own?.branchCreated, fork: own?.fork ?? null, at: own?.at ?? Date.now() })
  state.setTask(task.id, { repo: repo.name, branch, worktree: dir })
  return { dir, branch, created: !!own?.branchCreated }
}

/** The worktree of a branch, if it has one (and it is not the main checkout). */
export async function worktreeOf(repo: RepoConfig, branch: string): Promise<string | null> {
  const top = await checkRepo(repo)
  const tree = (await listWorktrees(repo)).find((w) => w.branch === branch)
  return tree && !same(tree.path, top) && existsSync(tree.path) ? tree.path : null
}

/**
 * What a branch changes against the base, as unified diff text for a prompt (document stages, e.g. an AI review): in the
 * task's worktree its committed and uncommitted changes (+ the names of new files), else the branch's commits. Clipped at
 * `max` characters on a line end; null when the branch is unknown or changes nothing.
 */
export async function branchDiff(repo: RepoConfig, branch: string, dir: string | null, max = 80_000): Promise<{ text: string; files: number; clipped: boolean } | null> {
  if (!dir && !(await branchExists(repo, branch))) return null
  let base: string
  try {
    base = await baseRef(repo)
  } catch {
    return null
  }
  const cwd = dir ?? repo.path
  const mb = (await git(cwd, ['merge-base', base, dir ? 'HEAD' : branch])).stdout.trim()
  if (!mb) return null
  const range = dir ? [mb] : [mb, branch]
  const stat = (await git(cwd, ['diff', '--stat=120', '-M', ...range])).stdout.trimEnd()
  const files = (await git(cwd, ['diff', '--name-only', '-M', ...range])).stdout.split(/\r?\n/).filter(Boolean).length
  const fresh = dir ? (await git(cwd, ['ls-files', '--others', '--exclude-standard'])).stdout.split(/\r?\n/).filter(Boolean).slice(0, 100) : []
  // git's own diff (--no-ext-diff): never the person's diff.external / GIT_EXTERNAL_DIFF, a command that runs in the repo
  let diff = (await git(cwd, ['diff', '--no-ext-diff', '-M', ...range], 120_000)).stdout
  if (!diff.trim() && !fresh.length) return null
  let clipped = false
  if (diff.length > max) {
    diff = diff.slice(0, max)
    diff = diff.slice(0, diff.lastIndexOf('\n') + 1)
    clipped = true
  }
  const text = [stat, fresh.length ? `New files (not in git yet): ${fresh.join(', ')}` : '', '', diff, clipped ? '[… the diff goes on — read the files for the rest]' : ''].filter((x, i) => x || i === 2).join('\n')
  return { text, files: files + fresh.length, clipped }
}

/* ------------------------------------------------------------------ status, diff */

interface StatusEntry {
  path: string
  xy: string
}

async function statusOf(dir: string): Promise<StatusEntry[]> {
  const out = await gitOk(dir, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const parts = out.split('\0')
  const list: StatusEntry[] = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!
    if (p.length < 4) continue
    const xy = p.slice(0, 2)
    list.push({ xy, path: p.slice(3) })
    // renames / copies carry the old path next
    if (xy[0] === 'R' || xy[0] === 'C') i++
  }
  return list
}

const CONFLICT = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

/** Still has conflict markers (a both-modified file someone resolved but did not stage has none). */
function hasMarkers(path: string): boolean {
  try {
    return /^(<{7}|>{7})( |$)/m.test(readFileSync(path, 'utf8'))
  } catch {
    return false
  }
}

/** Unresolved conflicts: unmerged entries — both-modified / both-added ones only while markers remain. */
function unresolved(dir: string, status: StatusEntry[]): string[] {
  return status.filter((e) => CONFLICT.has(e.xy) && (!(e.xy === 'UU' || e.xy === 'AA') || hasMarkers(join(dir, e.path)))).map((e) => e.path)
}

export async function conflictsOf(dir: string): Promise<string[]> {
  return unresolved(dir, await statusOf(dir))
}

export async function isDirty(dir: string): Promise<boolean> {
  return (await statusOf(dir)).length > 0
}

const count = (s: string) => {
  const n = Number(s.trim())
  return Number.isFinite(n) ? n : 0
}

/** Is the file binary (a NUL byte in its first 8 KB)? */
function binaryFile(path: string): boolean {
  try {
    const buf = readFileSync(path)
    return buf.subarray(0, 8000).includes(0)
  } catch {
    return false
  }
}

/** A symbolic link's target as git shows it — never what it points at (that may be anywhere on this machine). */
function linkTarget(path: string): string {
  try {
    return readlinkSync(path)
  } catch {
    return ''
  }
}

/** At most this many local-only commits are listed to tell the pushed ones apart (more: none is linked). */
const LOCAL_MAX = 2000

/** The branch's state, its commits and its diff against the base (working tree included). */
export async function info(repo: RepoConfig, state: WorkerState, dir: string, branch: string): Promise<GitInfo> {
  const base = await baseRef(repo).catch(() => repo.baseBranch)
  const lr = await git(dir, ['rev-list', '--left-right', '--count', `${base}...HEAD`])
  const [behind = '0', ahead = '0'] = lr.code === 0 ? lr.stdout.trim().split(/\s+/) : []
  const pushed = await remoteBranchExists(repo, branch)
  const unpushed = pushed ? count((await git(dir, ['rev-list', '--count', `${repo.remote}/${branch}..HEAD`])).stdout) : count(ahead)
  // which commits are only here — per commit (the log below is by date: after a merge of the remote branch, local and
  // pushed ones interleave). Not known (git failed, more than LOCAL_MAX): none counts as pushed — no link to a 404.
  let local: Set<string> | null = new Set()
  if (pushed && unpushed > 0) {
    const r = unpushed <= LOCAL_MAX ? await git(dir, ['rev-list', '-n', String(LOCAL_MAX), `${repo.remote}/${branch}..HEAD`]) : null
    local = r && r.code === 0 ? new Set(r.stdout.split('\n').map((l) => l.trim()).filter(Boolean)) : null
  }
  const status = await statusOf(dir)
  const conflicts = unresolved(dir, status)
  const log = await git(dir, ['log', '--format=%H%x1f%s%x1f%an%x1f%at%x1e', '-n', '20', `${base}..HEAD`])
  const commits: GitCommit[] = log.code === 0
    ? log.stdout
        .split('\x1e')
        .map((r) => r.trim())
        .filter(Boolean)
        .map((r) => {
          const [sha = '', subject = '', author = '', at = '0'] = r.split('\x1f')
          return { sha: sha.slice(0, 40), subject: subject.slice(0, 200), author: author.slice(0, 80), at: Number(at) * 1000, remote: pushed && !!local && !local.has(sha) }
        })
    : []
  const files = await diffFiles(dir, base, status)
  const own = state.created(repo.name, branch)
  const head = (await git(dir, ['rev-parse', 'HEAD'])).stdout.trim()
  const merged = count(ahead) === 0 && status.length === 0 && !!own?.fork && head !== own.fork && (await git(dir, ['merge-base', '--is-ancestor', 'HEAD', base])).code === 0
  // the repo's web address (One links commits and the branch with it) — never the remote's URL itself
  const web = await webOf(repo).catch(() => null)
  return { branch, base, ahead: count(ahead), behind: count(behind), pushed, unpushed, dirty: status.length, commits, files, conflicts, created: !!own?.branchCreated, merged, at: Date.now(), web }
}

async function diffFiles(dir: string, base: string, status: StatusEntry[]): Promise<GitFile[]> {
  const mb = (await git(dir, ['merge-base', base, 'HEAD'])).stdout.trim()
  const files: GitFile[] = []
  let total = 0
  const take = (diff: string): { diff: string | null; truncated: boolean } => {
    if (total >= DIFF_TOTAL_MAX) return { diff: null, truncated: true }
    let d = diff
    let truncated = false
    if (d.length > DIFF_FILE_MAX) {
      d = d.slice(0, DIFF_FILE_MAX)
      d = d.slice(0, d.lastIndexOf('\n') + 1)
      truncated = true
    }
    total += d.length
    return { diff: d, truncated }
  }
  if (mb) {
    const numstat = await gitOk(dir, ['diff', '--numstat', '-z', '-M', mb])
    const names = await gitOk(dir, ['diff', '--name-status', '-z', '-M', mb])
    const statusOfPath = new Map<string, GitFile['status']>()
    const ns = names.split('\0').filter((x) => x !== '')
    for (let i = 0; i < ns.length; i++) {
      const code = ns[i]![0]
      if (code === 'R' || code === 'C') {
        statusOfPath.set(ns[i + 2] ?? '', 'R')
        i += 2
      } else {
        statusOfPath.set(ns[i + 1] ?? '', code === 'A' ? 'A' : code === 'D' ? 'D' : code === 'U' ? 'U' : 'M')
        i += 1
      }
    }
    // numstat -z: "add\tdel\tpath\0" or, for renames, "add\tdel\t\0old\0new\0"
    const parts = numstat.split('\0')
    for (let i = 0; i < parts.length && files.length < DIFF_FILES_MAX; i++) {
      const p = parts[i]!
      if (!p) continue
      const [add = '0', del = '0', path0 = ''] = p.split('\t')
      let path = path0
      if (!path) {
        path = parts[i + 2] ?? ''
        i += 2
      }
      if (!path) continue
      const binary = add === '-' && del === '-'
      const st = statusOfPath.get(path) ?? 'M'
      const piece = binary ? { diff: null, truncated: false } : take((await git(dir, ['diff', '--no-ext-diff', '-M', mb, '--', path])).stdout)
      files.push({ path, status: st, add: binary ? 0 : count(add), del: binary ? 0 : count(del), binary, ...piece })
    }
  }
  // untracked files: not in `git diff`
  for (const e of status) {
    if (e.xy !== '??' || files.length >= DIFF_FILES_MAX) continue
    const abs = join(dir, e.path)
    let size = 0
    try {
      const st = lstatSync(abs)
      // a link shows as its target (like git shows it): the file it points at is never read — a link to
      // ~/.ssh/… would otherwise send that file's text to One
      if (st.isSymbolicLink()) {
        const piece = take(`diff --git a/${e.path} b/${e.path}\nnew file mode 120000\n--- /dev/null\n+++ b/${e.path}\n@@ -0,0 +1 @@\n+${linkTarget(abs)}\n\\ No newline at end of file\n`)
        files.push({ path: e.path, status: '?', add: 1, del: 0, binary: false, ...piece })
        continue
      }
      if (!st.isFile()) continue
      size = st.size
    } catch {
      continue
    }
    const binary = binaryFile(abs)
    if (binary) {
      files.push({ path: e.path, status: '?', add: 0, del: 0, binary: true, diff: null, truncated: false })
      continue
    }
    const text = size > DIFF_FILE_MAX * 2 ? '' : readFileSync(abs, 'utf8')
    const lines = text ? text.replace(/\n$/, '').split('\n') : []
    const body = `--- /dev/null\n+++ b/${e.path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join('\n')}\n`
    const piece = size > DIFF_FILE_MAX * 2 ? { diff: null, truncated: true } : take(`diff --git a/${e.path} b/${e.path}\nnew file\n${body}`)
    files.push({ path: e.path, status: '?', add: lines.length, del: 0, binary: false, ...piece })
  }
  return files
}

/* ------------------------------------------------------------------ commit, push, PR */

/** Commit everything in the worktree (git add -A); null when there was nothing to commit. */
export async function commitAll(dir: string, message: string): Promise<string | null> {
  const merging = existsSync(join(await gitDir(dir), 'MERGE_HEAD'))
  if (!(await isDirty(dir)) && !merging) return null
  const conflicts = await conflictsOf(dir)
  if (conflicts.length) throw new GitError(`conflicts in ${conflicts.length} file(s) are not resolved: ${conflicts.slice(0, 5).join(', ')}`)
  await gitOk(dir, ['add', '-A'])
  await gitOk(dir, ['commit', '-m', message.trim().slice(0, 4000) || 'One task'])
  return (await gitOk(dir, ['rev-parse', 'HEAD'])).trim()
}

async function gitDir(dir: string): Promise<string> {
  const d = (await gitOk(dir, ['rev-parse', '--git-dir'])).trim()
  return resolve(dir, d)
}

export async function push(repo: RepoConfig, dir: string, branch: string, force = false): Promise<void> {
  if (!(await hasRemote(repo))) throw new GitError(`the repo has no remote "${repo.remote}"`)
  await gitOk(dir, ['push', ...(force ? ['--force-with-lease'] : []), '-u', repo.remote, branch], 300_000)
}

/** HEAD of a worktree (a full object id), null when git cannot say. */
export async function headOf(dir: string): Promise<string | null> {
  const r = await git(dir, ['rev-parse', 'HEAD'], 30_000)
  const sha = r.code === 0 ? r.stdout.trim() : ''
  return GIT_SHA.test(sha) ? sha : null
}

/** A remote host's forge by its name ("github" / "gitlab" in it), else null — the setup page's "Automatic" says the same. */
export const forgeOfHost = (host: string | null | undefined): Forge | null => (!host ? null : /github/i.test(host) ? 'github' : /gitlab/i.test(host) ? 'gitlab' : null)

/**
 * The remote's web address (credentials stripped): https://<host>/<project> for ssh / scp / git remotes, the remote's
 * own scheme, host and port for http(s) ones; the forge from `forge`, else from the host's name. Null for a local path,
 * file://, an unknown host with forge 'auto', or anything cleanWeb refuses. `sshHost`: ssh's own name for an ssh / scp
 * remote's host (sshHostName — an alias in ~/.ssh/config, git@gitlab-work:…, names the real host); the web host is
 * then sshWebHost's pick, and the forge is read from it first, then from the host as written.
 */
export function webBase(remoteUrl: string, forge: ForgeSetting = 'auto', sshHost?: string | null): ForgeWeb | null {
  let host = ''
  let named = ''
  let path = ''
  let origin = ''
  const scp = /^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/.exec(remoteUrl)
  try {
    if (/^(https?|ssh|git):\/\//.test(remoteUrl)) {
      const u = new URL(remoteUrl)
      host = named = u.hostname.toLowerCase()
      path = u.pathname
      if (u.protocol === 'ssh:') host = sshWebHost(host, sshHost)
      // http(s): the remote's own scheme and port (a self-hosted GitLab on :8443); ssh's port is never the web's
      origin = /^https?:$/.test(u.protocol) ? `${u.protocol}//${host}${u.port ? `:${u.port}` : ''}` : `https://${host}`
    } else if (scp) {
      host = named = scp[1]!.toLowerCase()
      path = scp[2]!
      host = sshWebHost(host, sshHost)
      origin = `https://${host}`
    }
  } catch {
    return null
  }
  path = path.replace(/^\/+/, '').replace(/\.git$/, '').replace(/\/+$/, '')
  if (!host || !/^[\w.-]+$/.test(host) || !/^[\w.-]+(\/[\w.-]+)+$/.test(path)) return null
  const kind = forge === 'github' || forge === 'gitlab' ? forge : (forgeOfHost(host) ?? forgeOfHost(named))
  return kind ? cleanWeb({ base: `${origin}/${path}`, forge: kind }) : null
}

/** A host name ssh may be asked about (never an option: no leading "-"). */
const SSH_HOST = /^[a-z0-9][a-z0-9.-]{0,252}$/

/**
 * The ssh-only front-ends GitHub and GitLab document for "SSH over the HTTPS port" (Host github.com → HostName
 * ssh.github.com, Port 443; ssh://git@altssh.gitlab.com:443/…) — they speak ssh on 443, never HTTPS: their forge's web host.
 */
const SSH_FRONTS: Readonly<Record<string, string>> = { 'ssh.github.com': 'github.com', 'altssh.gitlab.com': 'gitlab.com' }
/** Forge web hosts a remote may name as written: ssh's answer never replaces them (their HostName is a front-end). */
const FORGE_WEB_HOSTS = new Set(['github.com', 'gitlab.com'])
/** An IPv4 literal (SSH_HOST takes one; an IPv6 one never passes it): an address, no web host — certificates and virtual hosts name the host. */
const IP_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/

/**
 * The web host of an ssh / scp remote: ssh's answer (`ssh -G`'s hostname) only where it resolves an alias — never where
 * it would replace a working web host: the host as written stays when it is a forge's own web host (github.com,
 * gitlab.com), when the answer is an IP literal or a host below the written one (HostName ssh.gitlab.company.de for
 * gitlab.company.de), or when the answer is no host name. A documented ssh-only front-end (ssh.github.com,
 * altssh.gitlab.com) — ssh's answer or the host as written — stands for its forge's web host.
 */
export function sshWebHost(written: string, answer?: string | null): string {
  const real = answer?.toLowerCase()
  const host =
    real && real !== written && SSH_HOST.test(real) && !IP_LITERAL.test(real) && !FORGE_WEB_HOSTS.has(written) && !real.endsWith(`.${written}`) ? real : written
  return SSH_FRONTS[host] ?? host
}

/** The host an ssh remote names ("git@gitlab-work:a/b.git", "ssh://git@host:2222/a/b"); null for any other remote (a drive letter is no host). */
export function sshHostOf(remoteUrl: string): string | null {
  let host: string | null = null
  if (/^ssh:\/\//i.test(remoteUrl)) {
    try {
      host = new URL(remoteUrl).hostname.toLowerCase()
    } catch {
      return null
    }
  } else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(remoteUrl)) host = /^(?:[^@/]+@)?([^:/\\]{2,}):(?!\/)(.+)$/.exec(remoteUrl)?.[1]?.toLowerCase() ?? null
  return host && SSH_HOST.test(host) ? host : null
}

/** ssh's answers per host, for SSH_NAME_MS (asked again after: ~/.ssh/config may have changed). */
const SSH_NAME_MS = 10 * 60_000
const sshNames = new Map<string, { at: number; name: Promise<string> }>()

/** Forget what ssh said (tests). */
export function forgetSshNames(): void {
  sshNames.clear()
}

/**
 * ssh's own name for a host: `ssh -G <host>` prints the configuration it would use, after Host / Match blocks — its
 * "hostname" line names the real host of an alias (Host gitlab-work → HostName gitlab.com). Nothing connects; the
 * person's own ssh and config, as git uses them for this remote. The host itself when ssh is missing, refuses, takes
 * over 5 s or names nothing usable.
 */
export function sshHostName(host: string): Promise<string> {
  if (!SSH_HOST.test(host)) return Promise.resolve(host)
  const hit = sshNames.get(host)
  if (hit && Date.now() - hit.at < SSH_NAME_MS) return hit.name
  const name = execFileSafe('ssh', ['-G', host], { timeoutMs: 5000, maxBuffer: 256 * 1024, allow: 'exe' })
    .then((r) => {
      const real = r.code === 0 ? /^hostname[ \t]+(\S+)[ \t]*$/im.exec(r.stdout)?.[1]?.toLowerCase() : undefined
      return real && SSH_HOST.test(real) ? real : host
    })
    .catch(() => host)
  sshNames.set(host, { at: Date.now(), name })
  return name
}

/** The repo's web address (webBase of its remote — an ssh host alias resolved — its worker.json forge); null without one. */
export async function webOf(repo: RepoConfig): Promise<ForgeWeb | null> {
  const r = await git(repo.path, ['remote', 'get-url', repo.remote], 30_000)
  if (r.code !== 0) return null
  const url = r.stdout.trim()
  const alias = sshHostOf(url)
  // a forge's own web host is never replaced (sshWebHost): ssh is not asked about it
  return webBase(url, repo.forge, alias && !FORGE_WEB_HOSTS.has(alias) ? await sshHostName(alias) : null)
}

/**
 * The web address a request's own address names (the part before /-/merge_requests/<n> · /pull/<n>; the host
 * lower-cased) — an SSH host alias (git@gitlab-work:…) or a web host other than the remote's still links right.
 */
export function webFromRequest(url: string, forge: Forge): ForgeWeb | null {
  // as a URL writes it: the host lower-cased, a default port (:443 / :80) left out
  let href: string
  try {
    href = new URL(url).href
  } catch {
    return null
  }
  const m = forge === 'gitlab' ? /^(https?:\/\/[^/?#]+\/.+?)\/-\/merge_requests\/\d+/.exec(href) : /^(https?:\/\/[^/?#]+\/[^/?#]+\/[^/?#]+)\/pull\/\d+/.exec(href)
  if (!m) return null
  const parts = /^(https?:\/\/[^/?#]+)(\/.*)$/.exec(m[1]!)
  return parts ? cleanWeb({ base: `${parts[1]!.toLowerCase()}${parts[2]}`, forge }) : null
}

const encRef = (s: string) => s.split('/').map(encodeURIComponent).join('/')

/** The compare / new-merge-request link of a branch on a web address. */
export function compareFor(web: ForgeWeb, base: string, branch: string): string {
  return web.forge === 'github'
    ? `${web.base}/compare/${encRef(base)}...${encRef(branch)}?expand=1`
    : `${web.base}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${encodeURIComponent(branch)}&merge_request%5Btarget_branch%5D=${encodeURIComponent(base)}`
}

export function compareUrl(remoteUrl: string, base: string, branch: string, forge: ForgeSetting = 'auto'): string | null {
  const w = webBase(remoteUrl, forge)
  return w ? compareFor(w, base, branch) : null
}

/** gh / glab: an .exe, or a shim the reader reads (exec.ts — never through cmd.exe). `input` goes to stdin. */
async function run(cmd: 'gh' | 'glab', args: string[], cwd: string, timeoutMs = 120_000, input?: string): Promise<GitRun> {
  const r = await execFileSafe(cmd, args, { cwd, env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' }, timeoutMs, maxBuffer: 8 * 1024 * 1024, allow: 'shim', ...(input !== undefined ? { input } : {}) })
  return { code: r.code, stdout: r.stdout, stderr: r.stderr || r.error || '' }
}

/** What a request's text may hold: gh reads it from stdin (any length); glab takes it as an argument — on Windows a command line holds 32,767 characters, and every " may become \" there. */
export const BODY_MAX = 60_000
export const GLAB_TEXT_MAX_WIN = 15_000
const glabText = (text: string, platform: NodeJS.Platform = process.platform) => text.slice(0, platform === 'win32' ? GLAB_TEXT_MAX_WIN : BODY_MAX)

/** What openPr did: a request on the host (opened, or `existing` — found open), the compare / new-request link, or nothing. */
export interface OpenPr {
  url: string | null
  via: 'gh' | 'glab' | 'link' | 'none'
  /** the request was open already (found, not created) */
  existing?: true
  /** why the link instead of a request: the host tool's own words (scrubbed by the caller before it is logged) */
  why?: string
}

/**
 * Open a pull request: `gh pr create` when the repo wants it, gh is installed and the remote is a GitHub
 * host; on a GitLab host the branch's open merge request (`glab mr view`) — else a new one with `glab mr create`
 * (glab installed and signed in); otherwise the compare / new-merge-request link (null when the remote has no web
 * page One could link to). The host follows worker.json "forge" (a self-hosted GitLab under its own name).
 */
export async function openPr(repo: RepoConfig, dir: string, branch: string, title: string, body: string): Promise<OpenPr> {
  const web = await webOf(repo)
  if (repo.pr === 'gh' && web?.forge === 'github') {
    const gh = await run('gh', ['--version'], dir, 10_000)
    if (gh.code === 0) {
      const made = await run('gh', ['pr', 'create', '--base', repo.baseBranch, '--head', branch, '--title', title.slice(0, 250), '--body-file', '-'], dir, 120_000, body.slice(0, BODY_MAX))
      const url = /https?:\/\/\S+/.exec(made.stdout)?.[0] ?? /https?:\/\/\S+\/pull\/\d+/.exec(made.stderr)?.[0]
      if (made.code === 0 && url) return { url, via: 'gh' }
      if (/already exists/i.test(made.stderr)) {
        const view = await run('gh', ['pr', 'view', branch, '--json', 'url', '--jq', '.url'], dir)
        if (view.code === 0 && /^https?:\/\/\S+$/.test(view.stdout.trim())) return { url: view.stdout.trim(), via: 'gh', existing: true }
      }
      throw new GitError(`gh pr create failed: ${(made.stderr || made.stdout).trim().split('\n').slice(-3).join(' ')}`)
    }
  }
  // GitLab: the branch's open merge request, else a new one with glab when it is installed and signed in — else the link
  let why: string | undefined
  if (repo.pr === 'gh' && web?.forge === 'gitlab') {
    const glab = await run('glab', ['--version'], dir, 10_000)
    if (glab.code === 0) {
      // a Ship again (a rework, a Retry): the merge request is there already — never a second one
      const found = await requestOf('glab', dir, branch)
      if (found?.open) return { url: found.url, via: 'glab', existing: true }
      const made = await run('glab', ['mr', 'create', '--source-branch', branch, '--target-branch', repo.baseBranch, '--title', title.slice(0, 250), '--description', glabText(body), '--yes'], dir)
      const url = /https?:\/\/\S+\/-\/merge_requests\/\d+/.exec(`${made.stdout}\n${made.stderr}`)?.[0]
      if (url) return { url, via: 'glab' }
      // glab said no without an address ("already exists" in another form, a refused field …): look once more
      const again = await requestOf('glab', dir, branch)
      if (again?.open) return { url: again.url, via: 'glab', existing: true }
      why = lastLines(made, 2) || undefined
    }
  }
  const url = web ? compareFor(web, repo.baseBranch, branch) : null
  return { url, via: url ? 'link' : 'none', ...(why ? { why } : {}) }
}

/** The host CLI for this repo's merge / pull requests: gh on a GitHub remote, glab on a GitLab one (installed, `pr: "gh"`). */
async function hostCli(repo: RepoConfig, dir: string): Promise<{ tool: 'gh' | 'glab'; web: ForgeWeb }> {
  if (repo.pr !== 'gh') throw new GitError('pull / merge requests are off for this repo (worker.json "pr": "none")')
  const web = await webOf(repo)
  if (!web) throw new GitError(`the remote "${repo.remote}" is neither a GitHub nor a GitLab address — pick the host type on the worker's setup page if it is one`)
  const tool = web.forge === 'github' ? 'gh' : 'glab'
  if ((await run(tool, ['--version'], dir, 10_000)).code !== 0) throw new GitError(`${tool} is not installed on this computer — install it and sign in (${tool} auth login)`)
  return { tool, web }
}

const lastLines = (r: GitRun, n = 3) => (r.stderr || r.stdout).trim().split('\n').slice(-n).join(' ')

/** The branch's merge / pull request on the host: its address and whether it is open (glab --output json · gh --json url,state). */
async function requestOf(tool: 'gh' | 'glab', dir: string, branch: string): Promise<{ url: string; open: boolean } | null> {
  const view = tool === 'gh' ? await run('gh', ['pr', 'view', branch, '--json', 'url,state'], dir, 30_000) : await run('glab', ['mr', 'view', branch, '--output', 'json'], dir, 30_000)
  if (view.code !== 0) return null
  const out = view.stdout.trim()
  let url: unknown
  let state: unknown
  try {
    const o = JSON.parse(out) as { url?: unknown; web_url?: unknown; state?: unknown }
    url = tool === 'gh' ? o.url : o.web_url
    state = o.state
  } catch {
    // not JSON (an older tool, a plain address): the address it names, taken as open
    url = (tool === 'gh' ? /https?:\/\/\S+/ : /https?:\/\/\S+\/-\/merge_requests\/\d+/).exec(out)?.[0]
    state = undefined
  }
  if (typeof url !== 'string' || !/^https?:\/\/\S+$/.test(url)) return null
  return { url, open: state === undefined || state === null || (typeof state === 'string' && /^open/i.test(state)) }
}

/** The address of the branch's merge / pull request (null when there is none). */
async function requestUrl(tool: 'gh' | 'glab', dir: string, branch: string): Promise<string | null> {
  return (await requestOf(tool, dir, branch))?.url ?? null
}

/** Post a comment (the review) to the branch's merge / pull request — the person's own gh / glab. */
export async function commentPr(repo: RepoConfig, dir: string, branch: string, body: string): Promise<{ via: 'gh' | 'glab'; url: string | null }> {
  const text = body.trim().slice(0, BODY_MAX)
  if (!text) throw new GitError('there is nothing to post')
  const { tool } = await hostCli(repo, dir)
  const made = tool === 'gh' ? await run('gh', ['pr', 'comment', branch, '--body-file', '-'], dir, 120_000, text) : await run('glab', ['mr', 'note', branch, '--message', glabText(text)], dir)
  if (made.code !== 0) throw new GitError(`${tool === 'gh' ? 'gh pr comment' : 'glab mr note'} failed: ${lastLines(made)}`)
  return { via: tool, url: (await requestUrl(tool, dir, branch)) ?? /https?:\/\/\S+/.exec(made.stdout)?.[0] ?? null }
}

/**
 * Merge the branch's merge / pull request on the host (confirmed in One, or a git stage after a gate): gh with a merge
 * commit (squash, then rebase when the repository allows only those), glab with the project's own merge method. The
 * branch is not deleted (Clean up does that); the base is fetched afterwards so the task shows "merged".
 */
export async function mergePr(repo: RepoConfig, dir: string, branch: string): Promise<{ via: 'gh' | 'glab'; url: string | null }> {
  const { tool } = await hostCli(repo, dir)
  const url = await requestUrl(tool, dir, branch)
  if (!url) throw new GitError(`"${branch}" has no open ${tool === 'gh' ? 'pull' : 'merge'} request — open one first (Ship / Pull request)`)
  if (tool === 'gh') {
    let last: GitRun | null = null
    for (const how of ['--merge', '--squash', '--rebase']) {
      last = await run('gh', ['pr', 'merge', branch, how], dir, 300_000)
      if (last.code === 0) break
      if (!/not allowed|not enabled|merge method/i.test(`${last.stderr}${last.stdout}`)) break
    }
    if (!last || last.code !== 0) throw new GitError(`gh pr merge failed: ${last ? lastLines(last) : ''}`)
  } else {
    const made = await run('glab', ['mr', 'merge', branch, '--yes'], dir, 300_000)
    if (made.code !== 0) throw new GitError(`glab mr merge failed: ${lastLines(made)}`)
  }
  // merged on the host: a fetch that fails now changes nothing about that
  await tryFetch(repo)
  return { via: tool, url }
}

/* ------------------------------------------------------------------ update from base */

export interface UpdateResult {
  how: 'up-to-date' | 'rebased' | 'merged' | 'conflicts'
  conflicts: string[]
  /** the remote task branch had commits HEAD lacked: merged in first (pushed from elsewhere, changed on the host) */
  remote?: boolean
}

/**
 * Bring the base in: rebase when the branch was never pushed, else merge (no history rewrite of a pushed
 * branch). First the remote task branch, when it has commits HEAD lacks (a push from elsewhere, a change on the host —
 * what makes a push "rejected"): merged in, a fast-forward when it can be — never a rebase, never a force. Refuses a
 * worktree with uncommitted changes. Conflicts are left in the worktree (a merge in progress) and listed — a stage (or
 * the person) resolves them; nothing is resolved automatically.
 */
export async function updateFromBase(repo: RepoConfig, dir: string, branch: string): Promise<UpdateResult> {
  if (await isDirty(dir)) {
    const conflicts = await conflictsOf(dir)
    if (conflicts.length) return { how: 'conflicts', conflicts }
    throw new GitError('the worktree has uncommitted changes — commit them first (Commit), nothing was changed')
  }
  await fetchRemote(repo)
  let remote = false
  if (await remoteBranchExists(repo, branch)) {
    const theirs = count((await gitOk(dir, ['rev-list', '--count', `HEAD..${repo.remote}/${branch}`])).trim())
    if (theirs > 0) {
      // fast-forward when it can; a merge commit otherwise — never a rebase of what is on the remote
      const mg = await git(dir, ['merge', '--no-edit', `${repo.remote}/${branch}`])
      if (mg.code !== 0) {
        const conflicts = await conflictsOf(dir)
        if (conflicts.length) return { how: 'conflicts', conflicts, remote: true }
        throw gitFailure(mg, 'merge failed', 4)
      }
      remote = true
    }
  }
  const base = await baseRef(repo)
  const behind = count((await gitOk(dir, ['rev-list', '--count', `HEAD..${base}`])).trim())
  if (behind === 0) return { how: 'up-to-date', conflicts: [], remote }
  const pushed = await remoteBranchExists(repo, branch)
  if (!pushed) {
    const rb = await git(dir, ['rebase', base])
    if (rb.code === 0) return { how: 'rebased', conflicts: [], remote }
    await git(dir, ['rebase', '--abort'])
  }
  const mg = await git(dir, ['merge', '--no-edit', '--no-ff', base])
  if (mg.code === 0) return { how: 'merged', conflicts: [], remote }
  const conflicts = await conflictsOf(dir)
  if (conflicts.length) return { how: 'conflicts', conflicts, remote }
  throw gitFailure(mg, 'merge failed', 4)
}

/* ------------------------------------------------------------------ cleanup */

/**
 * Discard (double-confirmed in One): remove the worktree the worker created (also with uncommitted
 * changes) and delete the branch — only when the worker created that branch.
 */
export async function discard(repo: RepoConfig, state: WorkerState, branch: string): Promise<{ worktree: boolean; branch: boolean }> {
  const own = state.created(repo.name, branch)
  if (!own) throw new GitError(`the worker did not create "${branch}" or its worktree — it removes only its own`)
  const top = await checkRepo(repo)
  const tree = (await listWorktrees(repo)).find((w) => w.branch === branch)
  let removedTree = false
  if (tree && !same(tree.path, top) && own.worktree && same(tree.path, own.worktree)) {
    const r = await git(repo.path, ['worktree', 'remove', '--force', tree.path])
    if (r.code !== 0) {
      // Windows: a file someone holds open (an editor, the indexer) — the folder is the worker's own: remove it, then
      // let git forget it; git's own error when it still cannot go
      if (!insideWorktrees(repo, tree.path)) throw gitFailure(r, 'git worktree remove failed')
      if (!(await rmRetry(tree.path))) throw gitFailure(r, 'git worktree remove failed', 6, folderBusyCode())
      await prune(repo)
    }
    removedTree = true
  }
  let removedBranch = false
  if (own.branchCreated && (await branchExists(repo, branch))) {
    if (tree && same(tree.path, top)) throw new GitError(`"${branch}" is checked out in the main checkout — not deleted`)
    await gitOk(repo.path, ['branch', '-D', branch])
    removedBranch = true
  }
  state.forget(repo.name, branch)
  return { worktree: removedTree, branch: removedBranch }
}

/** Clean up after a merge: only the worker's own, merged, clean branch + worktree (never forced). */
export async function cleanup(repo: RepoConfig, state: WorkerState, branch: string): Promise<{ worktree: boolean; branch: boolean }> {
  const own = state.created(repo.name, branch)
  if (!own?.branchCreated) throw new GitError(`the worker did not create "${branch}" — it cleans up only its own branches (Discard removes only its worktree)`)
  const dir = await worktreeOf(repo, branch)
  if (dir) {
    const now = await info(repo, state, dir, branch)
    if (now.dirty) throw new GitError('the worktree has uncommitted changes — nothing was removed')
    if (!now.merged) throw new GitError(`"${branch}" is not merged into ${now.base} yet — nothing was removed (Discard removes it anyway)`)
    await gitOk(repo.path, ['worktree', 'remove', dir])
  }
  let removedBranch = false
  if (own.branchCreated && (await branchExists(repo, branch))) {
    await gitOk(repo.path, ['branch', '-d', branch])
    removedBranch = true
  }
  state.forget(repo.name, branch)
  return { worktree: !!dir, branch: removedBranch }
}

/**
 * Lock files a stopped git left in the worker's OWN worktrees (index.lock in each one's git folder) — named in the
 * terminal at start (a killed git on Windows leaves one, and every later git step there fails). Never removed here.
 */
export function ownLocks(repo: RepoConfig, state: WorkerState): string[] {
  const out: string[] = []
  for (const entry of Object.values(state.data.created[repo.name] ?? {})) {
    if (!entry.worktree) continue
    try {
      const link = readFileSync(join(entry.worktree, '.git'), 'utf8')
      const gitdir = /^gitdir:\s*(.+)$/m.exec(link)?.[1]?.trim()
      if (!gitdir) continue
      const lock = join(resolve(entry.worktree, gitdir), 'index.lock')
      if (existsSync(lock)) out.push(lock)
    } catch {
      /* gone, or not a linked worktree */
    }
  }
  return out
}

/**
 * Is `dir` inside the repo's worktree folder (not the folder itself — never the main checkout)? As written (no link
 * followed: it decides what may be removed), without case on Windows / macOS.
 */
export function insideWorktrees(repo: RepoConfig, dir: string, platform: NodeJS.Platform = process.platform): boolean {
  const root = pathId(repo.worktreeDir, platform)
  const sep = platform === 'win32' ? '\\' : '/'
  const d = pathId(dir, platform)
  return d.startsWith(root.endsWith(sep) ? root : root + sep) && d !== pathId(repo.path, platform)
}
