/**
 * one-worker — finds the git repositories on this computer for the setup page (and the terminal checklist).
 *
 * Where: the usual places first (~/code, ~/projects, ~/dev, ~/src, ~/repos, ~/git, ~/GitHub,
 * ~/Documents/GitHub, ~/Developer, ~/workspace, ~/Desktop), then the whole home folder — at most 4 levels
 * below it. Never: symbolic links (not followed), hidden folders, node_modules, caches, Library / AppData,
 * the trash, vendor folders, virtual envs, build outputs. A folder whose `.git` is a folder is a repo (its
 * inside is not searched further); a `.git` FILE is a linked worktree or a submodule — skipped. Caps: ~5 s,
 * 300 repos, 50 000 folders.
 *
 * What is read of a repo — nothing of its content except: the current branch, the base branch
 * (origin/HEAD, else main / master), the remote's HOST (never its URL: no user names, no tokens), the last
 * commit's date, dirty or clean, and a guess of its test command from top-level files (package.json's
 * "test" script, Cargo.toml, go.mod, pyproject.toml / pytest.ini, a Makefile with a test target) — always
 * an argv list. Git runs as an argument list with fsmonitor off (a repo's config can never start a program).
 */
import type { Dirent } from 'node:fs'
import { lstatSync, readFileSync } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, sep } from 'node:path'
import { REPO_NAME } from '../../../src/app/features/coding/protocol.ts'
import { git } from './git.ts'

export const USUAL_PLACES = ['code', 'projects', 'dev', 'src', 'repos', 'git', 'GitHub', 'Documents/GitHub', 'Developer', 'workspace', 'Desktop']

/** Folder names never searched (hidden folders — a leading dot — are skipped as well). */
export const SKIP_DIRS = new Set([
  'node_modules',
  'bower_components',
  'Library',
  'AppData',
  'Application Data',
  'vendor',
  'venv',
  'site-packages',
  '__pycache__',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  'Pods',
  'DerivedData',
])

export interface ScanOptions {
  home?: string
  /** levels below the home folder a repo may sit (default 4) */
  maxDepth?: number
  /** time cap in ms (default 5000) */
  timeMs?: number
  /** most repos (default 300) */
  maxRepos?: number
  /** most folders looked into (default 50 000) */
  maxDirs?: number
}

export interface FindResult {
  /** absolute paths of the main checkouts found, in the order found */
  paths: string[]
  /** why the search stopped early (null: it looked everywhere it may) */
  capped: 'time' | 'count' | 'dirs' | null
  dirs: number
  ms: number
}

/** Walk the usual places, then the home folder; collect folders that hold a `.git` folder. */
export async function findRepos(opts: ScanOptions = {}): Promise<FindResult> {
  const home = opts.home ?? homedir()
  const maxDepth = opts.maxDepth ?? 4
  const maxRepos = opts.maxRepos ?? 300
  const maxDirs = opts.maxDirs ?? 50_000
  const start = Date.now()
  const deadline = start + (opts.timeMs ?? 5000)
  const seen = new Set<string>()
  const paths: string[] = []
  let capped: FindResult['capped'] = null
  let dirs = 0

  const key = async (p: string): Promise<string | null> => {
    try {
      const st = await lstat(p)
      // a symbolic link (or anything but a folder) is never entered
      return st.isDirectory() ? `${st.dev}:${st.ino}` : null
    } catch {
      return null
    }
  }

  const queue: Array<{ path: string; depth: number }> = []
  for (const place of USUAL_PLACES) queue.push({ path: join(home, ...place.split('/')), depth: place.split('/').length })
  queue.push({ path: home, depth: 0 })

  while (queue.length) {
    if (Date.now() > deadline) {
      capped = 'time'
      break
    }
    if (dirs >= maxDirs) {
      capped = 'dirs'
      break
    }
    const { path, depth } = queue.shift()!
    const k = await key(path)
    if (!k || seen.has(k)) continue
    seen.add(k)
    dirs++
    let entries: Dirent[]
    try {
      entries = await readdir(path, { withFileTypes: true })
    } catch {
      continue
    }
    const dotGit = entries.find((e) => e.name === '.git')
    // the home folder itself is never offered (a dotfiles repo there would hide everything below it)
    if (dotGit && depth > 0) {
      // a .git folder: a main checkout · a .git file: a linked worktree or a submodule — neither is searched further
      if (dotGit.isDirectory()) {
        paths.push(path)
        if (paths.length >= maxRepos) {
          capped = 'count'
          break
        }
      }
      continue
    }
    if (depth >= maxDepth) continue
    for (const e of entries) {
      // Dirent of a symbolic link says isSymbolicLink(), never isDirectory(): links are not followed
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue
      queue.push({ path: join(path, e.name), depth: depth + 1 })
    }
  }
  return { paths, capped, dirs, ms: Date.now() - start }
}

/* ------------------------------------------------------------------ facts of one repo */

export interface FoundRepo {
  path: string
  /** the path for people: "~/code/website" */
  short: string
  /** a name One may show (REPO_NAME), from the folder's name */
  name: string
  branch: string | null
  /** the base branch: origin/HEAD, else main / master, else the current branch */
  base: string
  /** local branches (≤ 200) */
  branches: string[]
  /** the remote tasks push to ("origin", else the first one; null: none) */
  remote: string | null
  /** that remote's host ("github.com"; "local" for a path) — never the URL */
  host: string | null
  /** files with changes (null: unknown) */
  dirty: number | null
  /** last commit, ms since epoch */
  lastCommit: number | null
  /** the test command guess (argv) */
  test: string[] | null
}

const GIT_MS = 3000

/** "~/code/website" (forward slashes) for a path inside the home folder. */
export function shortPath(path: string, home = homedir()): string {
  const h = home.replace(/[\\/]+$/, '')
  if (path === h) return '~'
  if (path.startsWith(h + sep) || path.startsWith(`${h}/`)) return `~/${path.slice(h.length + 1).replace(/\\/g, '/')}`
  return path.replace(/\\/g, '/')
}

/** A repo name One may show (letters, digits, . _ -), unique among `taken`. */
export function suggestName(path: string, taken: Set<string>): string {
  const raw = basename(path).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  let base = raw.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').replace(/-+$/, '').slice(0, 58)
  if (!REPO_NAME.test(base)) base = 'repo'
  let name = base
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base}-${n}`
  taken.add(name.toLowerCase())
  return name
}

/** The host of a remote URL — never the URL itself (it may carry a user name or a token). */
export function remoteHost(url: string): string | null {
  const u = url.trim()
  if (!u) return null
  let host: string | null = null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) {
    try {
      const parsed = new URL(u)
      if (parsed.protocol === 'file:') return 'local'
      host = parsed.hostname
    } catch {
      return null
    }
  } else {
    // scp-like: git@github.com:owner/repo.git (but not a Windows drive "C:\…")
    const scp = /^(?:[^@/\\\s]+@)?([^:/\\\s]+):(?!\/\/)/.exec(u)
    if (scp && !/^[A-Za-z]$/.test(scp[1]!)) host = scp[1]!
    else return 'local'
  }
  host = (host ?? '').toLowerCase()
  return /^[a-z0-9.\-[\]:]{1,253}$/.test(host) ? host : null
}

/** A top-level regular file of the repo (never through a symbolic link), at most `max` bytes. */
function topFile(dir: string, name: string, max = 256 * 1024): string | null {
  try {
    const p = join(dir, name)
    const st = lstatSync(p)
    if (!st.isFile() || st.size > max) return null
    return readFileSync(p, 'utf8')
  } catch {
    return null
  }
}
const has = (dir: string, name: string) => {
  try {
    return lstatSync(join(dir, name)).isFile()
  } catch {
    return false
  }
}

/** The test command from the repo's top-level files — an argv list, never a shell line (null: no guess). */
export function guessTest(dir: string): string[] | null {
  const pkg = topFile(dir, 'package.json')
  if (pkg) {
    try {
      const json = JSON.parse(pkg) as { scripts?: Record<string, unknown> }
      const script = json.scripts?.test
      // npm init's placeholder is not a test
      if (typeof script === 'string' && script.trim() && !/no test specified/.test(script)) {
        if (has(dir, 'pnpm-lock.yaml')) return ['pnpm', 'test']
        if (has(dir, 'yarn.lock')) return ['yarn', 'test']
        return ['npm', 'test']
      }
    } catch {
      /* not JSON: no guess from it */
    }
  }
  if (has(dir, 'Cargo.toml')) return ['cargo', 'test']
  if (has(dir, 'go.mod')) return ['go', 'test', './...']
  if (has(dir, 'pyproject.toml') || has(dir, 'pytest.ini')) return ['pytest']
  for (const name of ['Makefile', 'makefile', 'GNUmakefile']) {
    const mk = topFile(dir, name)
    if (mk !== null) {
      if (/^test\s*:(?!=)/m.test(mk)) return ['make', 'test']
      break
    }
  }
  return null
}

/** What the setup page shows of one repo (git as argv, short timeouts; a slow repo shows "—"). */
export async function repoFacts(path: string, taken: Set<string>, home = homedir()): Promise<FoundRepo> {
  // named before anything is awaited: names follow the order of the calls
  const name = suggestName(path, taken)
  const out = async (args: string[]) => {
    const r = await git(path, args, GIT_MS)
    return r.code === 0 ? r.stdout.trim() : null
  }
  const [head, heads, remotes, last, status] = await Promise.all([
    out(['symbolic-ref', '--quiet', '--short', 'HEAD']),
    out(['for-each-ref', '--count=200', '--format=%(refname:short)', 'refs/heads']),
    out(['remote']),
    out(['log', '-1', '--format=%ct']),
    // fsmonitor off: a repo's own config never starts a program here
    out(['-c', 'core.fsmonitor=false', 'status', '--porcelain', '--untracked-files=normal']),
  ])
  const branches = (heads ?? '').split('\n').map((s) => s.trim()).filter(Boolean)
  const remoteNames = (remotes ?? '').split('\n').map((s) => s.trim()).filter(Boolean)
  const remote = remoteNames.includes('origin') ? 'origin' : (remoteNames[0] ?? null)
  let base: string | null = null
  let host: string | null = null
  if (remote) {
    const [originHead, url] = await Promise.all([out(['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`]), out(['remote', 'get-url', remote])])
    if (originHead?.startsWith(`${remote}/`)) base = originHead.slice(remote.length + 1)
    host = url ? remoteHost(url) : null
    if (!base) {
      const remoteHeads = await out(['for-each-ref', '--format=%(refname:short)', `refs/remotes/${remote}/main`, `refs/remotes/${remote}/master`])
      const list = (remoteHeads ?? '').split('\n')
      base = list.includes(`${remote}/main`) ? 'main' : list.includes(`${remote}/master`) ? 'master' : null
    }
  }
  base ??= branches.includes('main') ? 'main' : branches.includes('master') ? 'master' : (head ?? 'main')
  const at = last && /^\d+$/.test(last) ? Number(last) * 1000 : null
  return {
    path,
    short: shortPath(path, home),
    name,
    branch: head,
    base,
    branches: branches.includes(base) ? branches : [base, ...branches],
    remote,
    host,
    dirty: status === null ? null : status.split('\n').filter(Boolean).length,
    lastCommit: at,
    test: guessTest(path),
  }
}

/** Facts for many repos, a few at a time. */
export async function factsOf(paths: string[], taken: Set<string>, home = homedir(), parallel = 6): Promise<FoundRepo[]> {
  const out: FoundRepo[] = new Array(paths.length)
  let next = 0
  const worker = async () => {
    while (next < paths.length) {
      const i = next++
      out[i] = await repoFacts(paths[i]!, taken, home)
    }
  }
  await Promise.all(Array.from({ length: Math.min(parallel, paths.length) }, worker))
  return out
}

/** Is `dir` the main checkout of a git repo (a `.git` FOLDER right there, not reached through a link)? */
export function isMainCheckout(dir: string): boolean {
  try {
    if (!lstatSync(dir).isDirectory()) return false
    return lstatSync(join(dir, '.git')).isDirectory()
  } catch {
    return false
  }
}
