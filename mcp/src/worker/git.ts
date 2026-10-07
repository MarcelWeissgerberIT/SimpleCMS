/**
 * one-worker — git, always as `spawn('git', [args…])` (never a shell line; hooks and the person's git
 * config apply as usual; no terminal, so git never waits for a typed password). The main checkout's working tree is never touched: every task works in its own
 * worktree. Nothing here deletes work the worker did not create, and nothing is force-pushed unless the
 * person picked "Force push" in One (then --force-with-lease).
 *
 *  - ensureWorktree: a new branch <prefix><slug>-<shortid> from <remote>/<base> (after a fetch — one that fails
 *    or takes over 60 s is noted and the local state is used) in its own
 *    worktree, or the branch the task names (must exist; never reset)
 *  - info: ahead / behind, pushed, commits, per-file diff (size-capped, binary skipped), conflicts
 *  - commit · push · openPr (gh, else a compare link) · updateFromBase (rebase only if never pushed,
 *    else merge; conflicts reported per file, left for a stage to resolve) · discard · cleanup
 */
import { execFile, spawn } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import type { GitCommit, GitFile, GitInfo } from '../../../src/app/features/coding/protocol.ts'
import type { RepoConfig } from './config.ts'
import type { WorkerState } from './state.ts'

export interface GitRun {
  code: number
  stdout: string
  stderr: string
  /** killed at the time limit */
  timedOut?: boolean
}

export class GitError extends Error {}

/** Per-file and total diff caps (what goes to One). */
export const DIFF_FILE_MAX = 120_000
export const DIFF_TOTAL_MAX = 1_500_000
export const DIFF_FILES_MAX = 200

const ENV = { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C', GCM_INTERACTIVE: 'never' }
const OUT_MAX = 32 * 1024 * 1024

/**
 * Run git. Resolves with the exit code — never throws for a non-zero exit. On macOS / Linux git runs in its own
 * session without a terminal: a password, SSH passphrase or host-key question fails at once (git says why)
 * instead of waiting for someone to type into the worker's terminal. An SSH agent or a credential helper still works.
 */
export function git(cwd: string, args: string[], timeoutMs = 120_000): Promise<GitRun> {
  return new Promise((done) => {
    const out: Buffer[] = []
    const err: Buffer[] = []
    let size = 0
    let why: string | null = null
    let settled = false
    const finish = (code: number, extra = '') => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const stderr = Buffer.concat(err).toString()
      done({ code, stdout: Buffer.concat(out).toString(), stderr: why ?? (stderr || extra), timedOut: why !== null && why.includes('did not finish') })
    }
    const child = spawn('git', args, { cwd, env: { ...process.env, ...ENV }, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true })
    const stop = () => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL')
        else child.kill('SIGKILL')
      } catch {
        /* gone */
      }
    }
    const timer = setTimeout(() => {
      why = `git ${args[0]} did not finish within ${Math.round(timeoutMs / 1000)} s — no network, or it waits for a password or an SSH key passphrase (the worker cannot type one: use an SSH agent or a credential helper)`
      stop()
    }, timeoutMs)
    const take = (into: Buffer[]) => (d: Buffer) => {
      size += d.length
      if (size > OUT_MAX) {
        why = `git ${args[0]}: output too large`
        stop()
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
  if (r.code !== 0) throw new GitError((r.stderr || r.stdout).trim().split('\n').slice(-6).join('\n') || `git ${args[0]} failed`)
  return r.stdout
}

const same = (a: string, b: string) => {
  const norm = (p: string) => resolve(p).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b)
}

/* ------------------------------------------------------------------ repo facts */

/** The repo's main checkout (toplevel); throws when `path` is not a git checkout. */
export async function checkRepo(repo: RepoConfig): Promise<string> {
  if (!existsSync(repo.path)) throw new GitError(`the folder does not exist`)
  const top = (await gitOk(repo.path, ['rev-parse', '--show-toplevel'])).trim()
  if (!top) throw new GitError('not a git checkout')
  return top
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
  const out = await gitOk(repo.path, ['worktree', 'list', '--porcelain'])
  const list: Worktree[] = []
  let cur: Worktree | null = null
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      cur = { path: line.slice(9), branch: null, head: null, bare: false }
      list.push(cur)
    } else if (cur && line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '')
    else if (cur && line.startsWith('HEAD ')) cur.head = line.slice(5)
    else if (cur && line === 'bare') cur.bare = true
  }
  return list
}

/** Branch names only — the newest first, at most BRANCHES_MAX (what One offers in a task's Branch field). */
export const BRANCHES_MAX = 100

export async function localBranches(repo: RepoConfig, timeoutMs = 5000): Promise<string[]> {
  const r = await git(repo.path, ['for-each-ref', '--sort=-committerdate', `--count=${BRANCHES_MAX}`, '--format=%(refname:short)', 'refs/heads'], timeoutMs)
  if (r.code !== 0) return []
  return r.stdout
    .split('\n')
    .map((b) => b.trim())
    .filter((b) => b && b.length <= 200)
}

export async function prune(repo: RepoConfig): Promise<void> {
  await git(repo.path, ['worktree', 'prune'])
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

/** What a task's preparation tells the log. */
export type GitNote = (kind: 'git' | 'warn', text: string, code?: string, vars?: Record<string, string | number>) => void

/** Fetch for a new task: a failure is noted and the task goes on from what this computer has. */
export async function tryFetch(repo: RepoConfig, note?: GitNote): Promise<boolean> {
  if (!(await hasRemote(repo))) return false
  note?.('git', `Fetching ${repo.remote}…`, 'fetching', { remote: repo.remote })
  try {
    return await fetchRemote(repo)
  } catch (e) {
    const why = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').trim().slice(0, 300)
    note?.('warn', `Could not fetch ${repo.remote} (${why}) — going on with what this computer has.`, 'fetchFailed', { remote: repo.remote, why })
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
export async function ensureWorktree(repo: RepoConfig, state: WorkerState, task: { id: string; title: string }, wanted: string | null, note?: GitNote): Promise<TaskWorktree> {
  const top = await checkRepo(repo)
  const known = state.taskAt(task.id)
  const trees = await listWorktrees(repo)
  // the task's own worktree from an earlier stage
  if (known && known.repo === repo.name && (!wanted || wanted === known.branch)) {
    const tree = trees.find((w) => w.branch === known.branch && same(w.path, known.worktree))
    if (tree && existsSync(tree.path)) return { dir: tree.path, branch: known.branch, created: !!state.created(repo.name, known.branch)?.branchCreated }
  }
  if (wanted) return reuse(repo, state, task, wanted, top, trees, note)
  await tryFetch(repo, note)
  const base = await baseRef(repo)
  const fork = (await gitOk(repo.path, ['rev-parse', `${base}^{commit}`])).trim()
  let branch = `${repo.branchPrefix}${slug(task.title)}-${shortId(task.id)}`
  for (let n = 2; (await branchExists(repo, branch)) && n < 50; n++) branch = `${repo.branchPrefix}${slug(task.title)}-${shortId(task.id)}-${n}`
  if (!(await validBranch(repo, branch))) throw new GitError(`"${branch}" is not a valid branch name (check branchPrefix in worker.json)`)
  const dir = join(repo.worktreeDir, branch.replace(/[\\/]+/g, '-'))
  if (existsSync(dir)) throw new GitError(`the worktree folder for ${branch} already exists and is not a worktree of this repo — move it away first`)
  mkdirSync(dirname(dir), { recursive: true })
  note?.('git', `New branch ${branch} from ${base} in its own worktree…`, 'newBranch', { branch, base })
  await addWorktree(repo, ['-b', branch, dir, base], dir, branch, note)
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
 * branch this call created.
 */
async function addWorktree(repo: RepoConfig, args: string[], dir: string, newBranch: string | null, note?: GitNote): Promise<void> {
  const started = Date.now()
  const beat = setInterval(() => {
    const time = clock(Date.now() - started)
    note?.('git', `Still checking out the files · ${time}`, 'checkout', { time })
  }, Number(process.env.ONE_WORKER_QUIET_MS) || 30_000)
  beat.unref()
  try {
    const r = await git(repo.path, ['worktree', 'add', ...args], checkoutMs())
    if (r.code === 0) return
    if (insideWorktrees(repo, dir)) {
      await git(repo.path, ['worktree', 'remove', '--force', dir])
      rmSync(dir, { recursive: true, force: true })
    }
    await prune(repo)
    if (newBranch && (await branchExists(repo, newBranch))) await git(repo.path, ['branch', '-D', newBranch])
    throw new GitError((r.stderr || r.stdout).trim().split('\n').slice(-6).join('\n') || 'git worktree add failed')
  } finally {
    clearInterval(beat)
  }
}

async function reuse(repo: RepoConfig, state: WorkerState, task: { id: string }, branch: string, top: string, trees: Worktree[], note?: GitNote): Promise<TaskWorktree> {
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
  const dir = join(repo.worktreeDir, branch.replace(/[\\/]+/g, '-'))
  if (existsSync(dir)) throw new GitError(`the worktree folder for ${branch} already exists and is not a worktree of this repo — move it away first`)
  mkdirSync(dirname(dir), { recursive: true })
  if (await branchExists(repo, branch)) {
    await addWorktree(repo, [dir, branch], dir, null, note)
  } else {
    await tryFetch(repo, note)
    if (!(await remoteBranchExists(repo, branch))) throw new GitError(`the branch "${branch}" does not exist (locally or on ${repo.remote}) — check the task's Branch field`)
    await addWorktree(repo, ['--track', '-b', branch, dir, `${repo.remote}/${branch}`], dir, branch, note)
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

/** The branch's state, its commits and its diff against the base (working tree included). */
export async function info(repo: RepoConfig, state: WorkerState, dir: string, branch: string): Promise<GitInfo> {
  const base = await baseRef(repo).catch(() => repo.baseBranch)
  const lr = await git(dir, ['rev-list', '--left-right', '--count', `${base}...HEAD`])
  const [behind = '0', ahead = '0'] = lr.code === 0 ? lr.stdout.trim().split(/\s+/) : []
  const pushed = await remoteBranchExists(repo, branch)
  const unpushed = pushed ? count((await git(dir, ['rev-list', '--count', `${repo.remote}/${branch}..HEAD`])).stdout) : count(ahead)
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
          return { sha: sha.slice(0, 40), subject: subject.slice(0, 200), author: author.slice(0, 80), at: Number(at) * 1000 }
        })
    : []
  const files = await diffFiles(dir, base, status)
  const own = state.created(repo.name, branch)
  const head = (await git(dir, ['rev-parse', 'HEAD'])).stdout.trim()
  const merged = count(ahead) === 0 && status.length === 0 && !!own?.fork && head !== own.fork && (await git(dir, ['merge-base', '--is-ancestor', 'HEAD', base])).code === 0
  return { branch, base, ahead: count(ahead), behind: count(behind), pushed, unpushed, dirty: status.length, commits, files, conflicts, created: !!own?.branchCreated, merged, at: Date.now() }
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
      const piece = binary ? { diff: null, truncated: false } : take((await git(dir, ['diff', '-M', mb, '--', path])).stdout)
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

/** The remote's web address (credentials stripped), for github / gitlab-like hosts only. */
export function webBase(remoteUrl: string): { host: string; path: string; kind: 'github' | 'gitlab' } | null {
  let host = ''
  let path = ''
  const scp = /^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/.exec(remoteUrl)
  try {
    if (/^(https?|ssh|git):\/\//.test(remoteUrl)) {
      const u = new URL(remoteUrl)
      host = u.hostname
      path = u.pathname
    } else if (scp) {
      host = scp[1]!
      path = scp[2]!
    }
  } catch {
    return null
  }
  path = path.replace(/^\/+/, '').replace(/\.git$/, '').replace(/\/+$/, '')
  if (!host || !/^[\w.-]+$/.test(host) || !/^[\w.-]+(\/[\w.-]+)+$/.test(path)) return null
  const kind = /github/i.test(host) ? 'github' : /gitlab/i.test(host) ? 'gitlab' : null
  return kind ? { host: host.toLowerCase(), path, kind } : null
}

export function compareUrl(remoteUrl: string, base: string, branch: string): string | null {
  const w = webBase(remoteUrl)
  if (!w) return null
  const enc = (s: string) => s.split('/').map(encodeURIComponent).join('/')
  return w.kind === 'github'
    ? `https://${w.host}/${w.path}/compare/${enc(base)}...${enc(branch)}?expand=1`
    : `https://${w.host}/${w.path}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${encodeURIComponent(branch)}&merge_request%5Btarget_branch%5D=${encodeURIComponent(base)}`
}

function run(cmd: string, args: string[], cwd: string, timeoutMs = 120_000): Promise<GitRun> {
  return new Promise((done) => {
    execFile(cmd, args, { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' }, windowsHide: true }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 127) : 0
      done({ code, stdout: String(stdout), stderr: String(stderr || (err && code === 127 ? err.message : '')) })
    })
  })
}

/**
 * Open a pull request: `gh pr create` when the repo wants it, gh is installed and the remote is a GitHub
 * host; otherwise the compare link (null when the remote has no web page One could link to).
 */
export async function openPr(repo: RepoConfig, dir: string, branch: string, title: string, body: string): Promise<{ url: string | null; via: 'gh' | 'link' | 'none' }> {
  const remoteUrl = (await git(repo.path, ['remote', 'get-url', repo.remote])).stdout.trim()
  const web = webBase(remoteUrl)
  if (repo.pr === 'gh' && web?.kind === 'github') {
    const gh = await run('gh', ['--version'], dir, 10_000)
    if (gh.code === 0) {
      const made = await run('gh', ['pr', 'create', '--base', repo.baseBranch, '--head', branch, '--title', title.slice(0, 250), '--body', body.slice(0, 60_000)], dir)
      const url = /https?:\/\/\S+/.exec(made.stdout)?.[0] ?? /https?:\/\/\S+\/pull\/\d+/.exec(made.stderr)?.[0]
      if (made.code === 0 && url) return { url, via: 'gh' }
      if (/already exists/i.test(made.stderr)) {
        const view = await run('gh', ['pr', 'view', branch, '--json', 'url', '--jq', '.url'], dir)
        if (view.code === 0 && view.stdout.trim()) return { url: view.stdout.trim(), via: 'gh' }
      }
      throw new GitError(`gh pr create failed: ${(made.stderr || made.stdout).trim().split('\n').slice(-3).join(' ')}`)
    }
  }
  const url = compareUrl(remoteUrl, repo.baseBranch, branch)
  return { url, via: url ? 'link' : 'none' }
}

/* ------------------------------------------------------------------ update from base */

export interface UpdateResult {
  how: 'up-to-date' | 'rebased' | 'merged' | 'conflicts'
  conflicts: string[]
}

/**
 * Bring the base in: rebase when the branch was never pushed, else merge (no history rewrite of a pushed
 * branch). Refuses a worktree with uncommitted changes. Conflicts are left in the worktree (a merge in
 * progress) and listed — a stage (or the person) resolves them; nothing is resolved automatically.
 */
export async function updateFromBase(repo: RepoConfig, dir: string, branch: string): Promise<UpdateResult> {
  if (await isDirty(dir)) {
    const conflicts = await conflictsOf(dir)
    if (conflicts.length) return { how: 'conflicts', conflicts }
    throw new GitError('the worktree has uncommitted changes — commit them first (Commit), nothing was changed')
  }
  await fetchRemote(repo)
  const base = await baseRef(repo)
  const behind = count((await gitOk(dir, ['rev-list', '--count', `HEAD..${base}`])).trim())
  if (behind === 0) return { how: 'up-to-date', conflicts: [] }
  const pushed = await remoteBranchExists(repo, branch)
  if (!pushed) {
    const rb = await git(dir, ['rebase', base])
    if (rb.code === 0) return { how: 'rebased', conflicts: [] }
    await git(dir, ['rebase', '--abort'])
  }
  const mg = await git(dir, ['merge', '--no-edit', '--no-ff', base])
  if (mg.code === 0) return { how: 'merged', conflicts: [] }
  const conflicts = await conflictsOf(dir)
  if (conflicts.length) return { how: 'conflicts', conflicts }
  throw new GitError((mg.stderr || mg.stdout).trim().split('\n').slice(-4).join('\n') || 'merge failed')
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
    await gitOk(repo.path, ['worktree', 'remove', '--force', tree.path])
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

/** Is `dir` inside the repo's worktree folder (never the main checkout)? */
export function insideWorktrees(repo: RepoConfig, dir: string): boolean {
  const root = resolve(repo.worktreeDir) + sep
  return resolve(dir).startsWith(root)
}
