/**
 * one-worker — the ONE place that starts programs (no other worker file imports node:child_process). Every program
 * is a file with an argument list — never a shell line, never Node's shell option.
 *
 * macOS / Linux: the command goes to spawn as it is (the system looks it up in the child's PATH — for the worker's own
 * programs one of absolute folders only, see "Every OS" below).
 *
 * Windows: the worker finds the file itself, because Windows would look in the CHILD's working folder first — a
 * git.exe, claude.exe or npm.exe at the root of a cloned or imported repository would run instead of the real one.
 *  - a bare name is looked up ONLY in PATH (absolute entries, PATHEXT order of .COM .EXE .BAT .CMD) — never the
 *    working folder; a name with a folder (`.\gradlew.bat`, `C:\tools\x.exe`) is the person's own path
 *  - .exe / .com run as they are; .js / .mjs / .cjs with this Node
 *  - .cmd / .bat are READ, never run: the shims npm, yarn, pnpm, corepack and scoop write name the real program
 *    (a script for Node, an .exe) and that one runs, with the same arguments
 *  - a .cmd / .bat the reader cannot read: refused — except the person's own worker.json testCommand /
 *    analyzeCommand and ONE_WORKER_BROWSER / ONE_WORKER_PICKER (allow 'person'), which then run through cmd.exe
 *    with every argument escaped. Nothing One sends and nothing from a repository ever reaches a cmd.exe line:
 *    Claude Code never runs through cmd.exe, git only as an .exe, gh / glab as an .exe or a shim the reader reads.
 *  - system tools (cmd, taskkill, powershell) by their absolute path in %SystemRoot%\System32
 *  - the programs the worker starts by itself (git, Claude Code, gh, glab, the System32 tools) get
 *    NoDefaultCurrentDirectoryInExePath: what THEY start by a bare name is not looked up in their working folder either
 *    (cmd.exe; libuv in a Node child). The person's own commands (testCommand / analyzeCommand, ONE_WORKER_BROWSER /
 *    _PICKER: allow 'person') keep their environment as it is — their scripts may call a program in their folder by its
 *    bare name (`gradlew`). Lookups that ignore the variable (node-which in cross-spawn / execa, Bun's own) remain: a
 *    Claude Code stage never starts while its folder holds a program such a lookup could take (plantedProgram, run.ts)
 *  - a file inside the working folder is named from there (`.\tools\x.exe`) — at the spawn, from THAT spawn's working
 *    folder (spawnForm): the folder's own path (a worktree named after a branch from One) never reaches a command line
 *    or a cmd.exe line. What resolveCommand returns (and `check` shows) stays absolute.
 * Every OS: the programs the worker starts by itself get a PATH of absolute folders only (pathAbsolute) — an empty entry,
 * "." or a relative folder makes a lookup by name search the working folder (macOS / Linux: execvp, also for git's own
 * children and Claude Code's), so neither they nor what they start take a `git` from a repository; `~` / `~/…` become
 * the home folder there, as bash reads them. The person's own commands keep their PATH as it is.
 * Not covered (the launched program's own hygiene): DLLs a program loads from its own folder or the working folder.
 *
 * spawnSafe / execFileSafe / execFileSyncSafe never throw and never reject: a program that cannot start is code 127
 * (`why` says missing · refused · failed), a time limit is code 124. Error texts name the command, never a path.
 */
import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, posix, win32 } from 'node:path'

export type Via = 'direct' | 'node-shim' | 'comspec'

export interface ExecCtx {
  platform: NodeJS.Platform
  /** the CHILD's environment: PATH and PATHEXT are read from exactly what the program gets */
  env: NodeJS.ProcessEnv
  /** a regular file */
  exists: (p: string) => boolean
  /** a file's first ≤ 64 KB as text (null: unreadable) */
  readFile: (p: string) => string | null
  /** the Node that runs a script */
  execPath: string
  cwd: string
}

/** git: an .exe only · claude, gh, glab (default): an .exe or a shim the reader reads · the person's own commands: + cmd.exe */
export type Allow = 'exe' | 'shim' | 'person'

/**
 * What runs, with absolute paths (a stored one stays right whatever folder it starts from later). `script`: the index in
 * `args` of the script a Node shim runs · `line`: what a cmd.exe line is built from. spawnForm names files inside the
 * spawn's working folder from there.
 */
export type Resolved =
  | { ok: true; file: string; args: string[]; via: Via; verbatim: boolean; env?: Record<string, string>; script?: number; line?: { argv: string[]; double: boolean } }
  | { ok: false; code: 127; why: 'missing' | 'refused'; error: string }

/** What a .cmd / .bat shim runs: a script with Node, or another program (an .exe, or a shim to read next). */
export type Shim = { kind: 'node'; node: string; script: string; pre: string[]; env?: Record<string, string> } | { kind: 'target'; file: string }

const READ_MAX = 64 * 1024
const PATHEXT_DEFAULT = ['.COM', '.EXE', '.BAT', '.CMD']
const JS = new Set(['.js', '.mjs', '.cjs'])

/** A regular file (links followed). */
export const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

const readHead = (p: string): string | null => {
  let fd: number | null = null
  try {
    fd = openSync(p, 'r')
    const buf = Buffer.alloc(READ_MAX)
    const n = readSync(fd, buf, 0, READ_MAX, 0)
    return buf.subarray(0, n).toString('utf8').replace(/^\uFEFF/, '')
  } catch {
    return null
  } finally {
    if (fd !== null)
      try {
        closeSync(fd)
      } catch {
        /* closed */
      }
  }
}

function fullCtx(c: Partial<ExecCtx> = {}): ExecCtx {
  return {
    platform: c.platform ?? process.platform,
    env: c.env ?? process.env,
    exists: c.exists ?? isFile,
    readFile: c.readFile ?? readHead,
    execPath: c.execPath ?? process.execPath,
    cwd: c.cwd ?? process.cwd(),
  }
}

/* ------------------------------------------------------------------ environment */

/** The key `key` is stored under — on Windows without case, the first in sorted order (the one Node hands the child). */
export function envKey(env: NodeJS.ProcessEnv, key: string, platform: NodeJS.Platform = process.platform): string | undefined {
  if (platform !== 'win32') return Object.prototype.hasOwnProperty.call(env, key) ? key : undefined
  const want = key.toLowerCase()
  const keys = Object.keys(env)
    .filter((k) => k.toLowerCase() === want && env[k] !== undefined)
    .sort()
  return keys[0]
}

/** A variable of `env` — without case on Windows ("Path"). */
export function envGet(env: NodeJS.ProcessEnv, key: string, platform: NodeJS.Platform = process.platform): string | undefined {
  const k = envKey(env, key, platform)
  return k === undefined ? undefined : env[k]
}

/** The key PATH is stored under ("Path" on most Windows machines). */
export function pathKey(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  return envKey(env, 'PATH', platform) ?? (platform === 'win32' ? 'Path' : 'PATH')
}

/** The variable that keeps Windows from looking for a program by name in the working folder (any value counts). */
export const NO_CWD_LOOKUP = 'NoDefaultCurrentDirectoryInExePath'

/**
 * A child's environment on Windows: NoDefaultCurrentDirectoryInExePath set (unless it is), so what the child starts by a
 * bare name — cmd.exe's commands, a Node child's spawn (libuv asks NeedCurrentDirectoryForExePathW) — is looked up in PATH
 * only, never in its working folder (a repository). Unchanged elsewhere.
 */
export function noCwdLookup(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
  if (platform !== 'win32' || Object.keys(env).some((k) => k.toLowerCase() === NO_CWD_LOOKUP.toLowerCase() && env[k] !== undefined)) return env
  return { ...env, [NO_CWD_LOOKUP]: '1' }
}

const ABS_WIN = /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/])/

/** A PATH entry that names a folder by itself (Windows: C:\… or \\server\…, quotes allowed; elsewhere: /…). */
const absEntry = (d: string, platform: NodeJS.Platform) => (platform === 'win32' ? ABS_WIN.test(d.trim().replace(/^"(.*)"$/, '$1').trim()) : d.startsWith('/'))

/**
 * macOS / Linux: a PATH entry `~` or `~/…` as bash reads it at lookup — the home folder (the child's HOME, else this
 * user's) in front; null when that is no absolute folder (a HOME that is empty or relative, one holding a ":", none the
 * system can name). Any other entry as it is.
 */
const homeEntry = (d: string, env: NodeJS.ProcessEnv, home: () => string): string | null => {
  if (d !== '~' && !d.startsWith('~/')) return d
  let h = env.HOME
  if (h === undefined) {
    // spawnSafe never throws
    try {
      h = home()
    } catch {
      return null
    }
  }
  return h.startsWith('/') && !h.includes(':') ? h + d.slice(1) : null
}

/**
 * PATH with its absolute folders only — an empty entry, "." or a relative folder dropped (on Windows under every spelling
 * of the key). macOS / Linux: execvp searches the working folder for such an entry (PATH=":/usr/bin" finds ./git first);
 * Windows: such an entry is read against the working folder. macOS / Linux: `~` and `~/…` become the home folder (bash
 * expands them at lookup, execvp would read them against the working folder). Nothing left: PATH is removed (an empty
 * PATH is itself the working folder on macOS / Linux; without one the system's default folders are searched). Unchanged
 * when every entry is absolute (the same object).
 */
export function pathAbsolute(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform, home: () => string = homedir): NodeJS.ProcessEnv {
  const sep = platform === 'win32' ? ';' : ':'
  let out: NodeJS.ProcessEnv = env
  for (const k of Object.keys(env)) {
    const v = env[k]
    if (v === undefined || (platform === 'win32' ? k.toLowerCase() !== 'path' : k !== 'PATH')) continue
    const entries = platform === 'win32' ? v.split(sep) : v.split(sep).map((d) => homeEntry(d, env, home) ?? '')
    const kept = entries.filter((d) => absEntry(d, platform))
    if (kept.join(sep) === v) continue
    if (out === env) out = { ...env }
    if (kept.length) out[k] = kept.join(sep)
    else delete out[k]
  }
  return out
}

/** The environment of a program the worker starts by itself: PATH absolute only (every OS), and on Windows noCwdLookup. */
export function ownEnv(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
  return pathAbsolute(noCwdLookup(env, platform), platform)
}

/** The absolute path of a Windows system tool (System32) — the bare name elsewhere. */
export function systemTool(name: 'cmd' | 'taskkill' | 'powershell', env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, exists: (p: string) => boolean = isFile): string {
  if (platform !== 'win32') return name
  if (name === 'cmd') {
    const spec = envGet(env, 'ComSpec', platform)
    if (spec && ABS_WIN.test(spec) && win32.basename(spec).toLowerCase() === 'cmd.exe' && exists(spec)) return spec
  }
  const raw = envGet(env, 'SystemRoot', platform) ?? envGet(env, 'windir', platform)
  const root = raw && ABS_WIN.test(raw) ? raw : 'C:\\Windows'
  const sys = win32.join(root, 'System32')
  if (name === 'powershell') return win32.join(sys, 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return win32.join(sys, `${name}.exe`)
}

/** The command's name for messages — never where it lives. */
export function commandName(cmd: string, platform: NodeJS.Platform = process.platform): string {
  return (platform === 'win32' ? win32 : posix).basename(cmd) || cmd
}

/* ------------------------------------------------------------------ resolution (pure) */

function pathExts(env: NodeJS.ProcessEnv): string[] {
  const listed = (envGet(env, 'PATHEXT', 'win32') ?? '')
    .split(';')
    .map((e) => e.trim().toUpperCase())
    .filter((e, i, all) => PATHEXT_DEFAULT.includes(e) && all.indexOf(e) === i)
  return listed.length ? listed : PATHEXT_DEFAULT
}

function pathDirs(env: NodeJS.ProcessEnv): string[] {
  return (envGet(env, 'PATH', 'win32') ?? '')
    .split(';')
    .map((d) => d.trim().replace(/^"(.*)"$/, '$1').trim())
    .filter((d) => ABS_WIN.test(d))
}

/** Windows: the file a command names — PATH only for a bare name (never the working folder). */
function findWin(cmd: string, c: ExecCtx): string | null {
  // the extensions as files are usually named on disk (".exe", not PATHEXT's ".EXE")
  const exts = pathExts(c.env).map((e) => e.toLowerCase())
  if (/[\\/]/.test(cmd) || /^[A-Za-z]:/.test(cmd)) {
    const abs = win32.resolve(c.cwd, cmd)
    for (const t of [abs, ...exts.map((e) => abs + e)]) if (runnable(t) && c.exists(t)) return t
    return null
  }
  const own = win32.extname(cmd).toLowerCase()
  const names = exts.includes(own) ? [cmd] : exts.map((e) => cmd + e)
  for (const dir of pathDirs(c.env)) for (const n of names) if (c.exists(win32.join(dir, n))) return win32.join(dir, n)
  return null
}

const extOf = (p: string) => win32.extname(p).toLowerCase()
const runnable = (p: string) => ['.exe', '.com', '.cmd', '.bat'].includes(extOf(p)) || JS.has(extOf(p))

/**
 * How to start `cmd args` (pure: the file system only through ctx). macOS / Linux: unchanged. Windows: the rules above;
 * `allow` decides what may run (see Allow).
 */
export function resolveCommand(cmd: string, args: string[], ctx?: Partial<ExecCtx>, allow: Allow = 'shim'): Resolved {
  const c = fullCtx(ctx)
  if (c.platform !== 'win32') return { ok: true, file: cmd, args, via: 'direct', verbatim: false }
  const name = commandName(cmd, 'win32')
  const found = cmd ? findWin(cmd, c) : null
  if (!found) return { ok: false, code: 127, why: 'missing', error: `${name} was not found (PATH only, never the working folder)` }
  return classify(found, args, c, allow, 0, name)
}

/**
 * A file inside the working folder `cwd`, named from there (`.\tools\x.exe`) — the child resolves it against that same
 * folder. Only at a spawn, from that spawn's own working folder (spawnForm): a name made for one folder is wrong in any
 * other. So the folder's own path (a task's worktree, named after a branch One or a remote chose) never reaches argv[0],
 * a script argument or a cmd.exe line: what is left there is what the person typed, their PATH, or this Node.
 */
export function fromCwd(p: string, cwd: string): string {
  const rel = win32.relative(cwd, p)
  return rel && !rel.startsWith('..') && !win32.isAbsolute(rel) ? `.\\${rel}` : p
}

/**
 * The program and arguments a spawn in `cwd` gets (Windows): every file inside `cwd` named from there — the program, a
 * Node shim's script, a cmd.exe line's own file (the line is built here). Elsewhere `r` as it is.
 */
export function spawnForm(r: Extract<Resolved, { ok: true }>, cwd: string, platform: NodeJS.Platform = process.platform): { file: string; args: string[] } {
  if (platform !== 'win32') return { file: r.file, args: r.args }
  if (r.line) {
    const line = cmdLine([fromCwd(r.line.argv[0]!, cwd), ...r.line.argv.slice(1)], r.line.double)
    return { file: r.file, args: ['/d', '/v:off', '/s', '/c', `"${line}"`] }
  }
  return { file: fromCwd(r.file, cwd), args: r.script === undefined ? r.args : r.args.map((a, i) => (i === r.script ? fromCwd(a, cwd) : a)) }
}

function classify(file: string, args: string[], c: ExecCtx, allow: Allow, depth: number, name: string): Resolved {
  const ext = extOf(file)
  if (ext === '.exe' || ext === '.com') return { ok: true, file, args, via: 'direct', verbatim: false }
  if (allow === 'exe') return { ok: false, code: 127, why: 'refused', error: `${name} is a ${ext || 'file without an extension'} — only a program (.exe) is started for it` }
  if (JS.has(ext)) return { ok: true, file: c.execPath, args: [file, ...args], via: 'node-shim', verbatim: false, script: 0 }
  if (ext === '.cmd' || ext === '.bat') {
    const text = c.readFile(file)
    const shim = text === null ? null : readShim(text, file, c)
    if (shim?.kind === 'node') return { ok: true, file: shim.node, args: [...shim.pre, shim.script, ...args], via: 'node-shim', verbatim: false, script: shim.pre.length, ...(shim.env ? { env: shim.env } : {}) }
    if (shim?.kind === 'target' && depth < 3) return classify(shim.file, args, c, allow, depth + 1, name)
    if (allow === 'person') return comspec(file, args, c, name)
    return { ok: false, code: 127, why: 'refused', error: `${name} is a ${ext} file the worker cannot read as a shim — it never starts it through cmd.exe` }
  }
  return { ok: false, code: 127, why: 'missing', error: `${name} is not a program the worker starts (.exe, .cmd, .bat or a Node script)` }
}

/**
 * The person's own .cmd / .bat through cmd.exe: /d (no AutoRun) /v:off (no !var!) /s /c "<escaped line>" — here with
 * the file's absolute path; spawnForm builds the line a spawn gets, the file named from its working folder.
 */
function comspec(file: string, args: string[], c: ExecCtx, name: string): Resolved {
  const double = BIN_SHIM.test(file)
  const line = cmdLine([file, ...args], double)
  if (line === null) return { ok: false, code: 127, why: 'refused', error: `${name} runs through cmd.exe, which cannot pass an argument with a line break` }
  return { ok: true, file: systemTool('cmd', c.env, 'win32', c.exists), args: ['/d', '/v:off', '/s', '/c', `"${line}"`], via: 'comspec', verbatim: true, line: { argv: [file, ...args], double } }
}

/* ------------------------------------------------------------------ programs planted in a working folder */

/**
 * Programs tools start by their bare name, whatever is installed: Claude Code's own git, a test runner's node / npm /
 * npx, shells, ssh, ripgrep, Python, the host CLIs, the usual MCP server launchers (uv / uvx, bunx, deno, docker,
 * podman, pipx, java, dotnet), Windows' own helpers (Claude Code itself starts reg, rundll32 and explorer by name).
 */
export const BY_NAME = ['git', 'claude', 'node', 'npm', 'npx', 'pnpm', 'yarn', 'corepack', 'bash', 'sh', 'ssh', 'gh', 'glab', 'rg', 'cmd', 'powershell', 'pwsh', 'where', 'python', 'py', 'uv', 'uvx', 'bunx', 'bun', 'deno', 'docker', 'podman', 'pipx', 'java', 'dotnet', 'git-lfs', 'pnpx', 'python3', 'cygpath', 'taskkill', 'tasklist', 'reg', 'rundll32', 'explorer']
/** What a lookup by name may run on Windows: Windows' own PATHEXT list, PowerShell scripts — and the person's PATHEXT. */
const RUNNABLE_WINDOWS = ['.com', '.exe', '.bat', '.cmd', '.ps1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.msc']
/** Windows' own PATHEXT (what cmd.exe and node-which use while the variable is not set). */
const PATHEXT_WINDOWS = ['.com', '.exe', '.bat', '.cmd', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.msc']

const topFiles = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => !e.isDirectory())
      .map((e) => e.name)
  } catch {
    return []
  }
}

/** The extensions of PATHEXT as written in `env` (lower case; [] when it is not set). */
const ownPathExt = (env: NodeJS.ProcessEnv) =>
  (envGet(env, 'PATHEXT', 'win32') ?? '')
    .split(';')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^\.[a-z0-9]{1,8}$/.test(e))

/**
 * The three letters outside ASCII whose case partner is an ASCII letter (ı ↔ I, ſ ↔ S, the Kelvin sign K ↔ k). Whether a
 * disk takes "gıt.exe" for "git.exe" is the disk's own case table (NTFS: its $UpCase file), not JavaScript's — so these
 * are never folded here: plantedProgram asks the disk (foldsTo).
 */
const DISK_FOLDS: Record<string, string> = { '\u0131': 'i', '\u017f': 's', '\u212a': 'k' }

/**
 * A file name as Windows opens it (a trailing dot or space dropped: "git.exe." opens git.exe), lower case — the letters
 * of DISK_FOLDS as they are.
 */
const winName = (name: string) =>
  [...name]
    .map((c) => (c in DISK_FOLDS ? c : c.toLowerCase()))
    .join('')
    .replace(/[. ]+$/, '')

/** The name with the letters of DISK_FOLDS as the ASCII letters a disk may fold them to (null: none in it). */
const foldsTo = (n: string): string | null => (/[\u0131\u017f\u212a]/.test(n) ? [...n].map((c) => DISK_FOLDS[c] ?? c).join('') : null)

/** A folder as Windows compares it: separators "\\", "." / ".." resolved, no trailing separator, lower case. */
const winFolder = (d: string) => win32.normalize(d).replace(/[\\/]+$/, '').toLowerCase()

/** Windows' own folder (%SystemRoot%, %windir% — C:\Windows while neither is set), as winFolder writes it. */
export function systemRoots(env: NodeJS.ProcessEnv): string[] {
  const roots = ['SystemRoot', 'windir'].map((k) => envGet(env, k, 'win32')?.trim()).filter((r): r is string => !!r && ABS_WIN.test(r))
  return [...new Set((roots.length ? roots : ['C:\\Windows']).map(winFolder))]
}

/** A folder inside Windows' own folder (or that folder): System32, SysWOW64, Wbem, WindowsPowerShell, OpenSSH … */
export function inSystemRoot(dir: string, env: NodeJS.ProcessEnv): boolean {
  const d = winFolder(dir)
  return systemRoots(env).some((r) => d === r || d.startsWith(`${r}\\`))
}

/**
 * The base names (lower case, no extension) of every program a lookup by name finds in PATH's folders (absolute entries;
 * PATHEXT of `env`, else Windows' own) — `list` reads a folder's files. Windows' own folders (inSystemRoot: System32 and
 * the rest under %SystemRoot%) do not count: their hundreds of names (find, sort, tree, format, help, route …) are
 * everyday file names in a repository; the ones a tool does start by name (cmd, powershell, where, taskkill, tasklist,
 * reg, rundll32, explorer, ssh, bash) are in BY_NAME.
 */
export function programsOnPath(env: NodeJS.ProcessEnv, list: (dir: string) => string[] = topFiles): Set<string> {
  const own = ownPathExt(env)
  const exts = new Set(own.length ? own : PATHEXT_WINDOWS)
  const out = new Set<string>()
  // each folder once (C:\Tools\ and C:\tools are one), read as PATH names it; Windows' own folders never
  const dirs = new Map(
    pathDirs(env)
      .filter((d) => !inSystemRoot(d, env))
      .map((d) => [winFolder(d), d] as const),
  )
  for (const dir of dirs.values()) {
    for (const f of list(dir)) {
      const n = winName(f)
      const ext = win32.extname(n)
      if (ext && exts.has(ext)) out.add(n.slice(0, -ext.length))
    }
  }
  return out
}

/** The base name of a program a command names (`C:\tools\uvx.exe` → uvx, `npx` → npx): its extension off only when it is one a lookup runs. */
export function programName(cmd: string, env: NodeJS.ProcessEnv = process.env): string {
  const n = winName(win32.basename(cmd.trim().replace(/^"(.*)"$/, '$1')))
  const ext = win32.extname(n)
  return ext && new Set([...RUNNABLE_WINDOWS, ...ownPathExt(env)]).has(ext) ? n.slice(0, -ext.length) : n
}

/**
 * Windows: a program at the top of `dir` that a lookup by name could take instead of the real one (null: none; elsewhere
 * always null). The worker's own programs never look in their working folder (noCwdLookup), but some lookups ignore that:
 * node-which in cross-spawn / execa — Claude Code's own `git`, the launchers of its MCP servers — and Bun's own check the
 * working folder first. So a Claude Code stage does not start in a folder holding one (run.ts). A file counts when its
 * extension is one such a lookup runs (the worker's PATHEXT ∪ RUNNABLE_WINDOWS) AND its base name (without case) is
 *  - a program on PATH outside Windows' own folders (programsOnPath — `gradlew.bat`, `build.cmd` stay allowed unless PATH
 *    has such a program; `find.js`, `sort.js`, `route.js` stay allowed beside System32's find / sort / route),
 *  - one of `names` (run.ts: the launchers of the person's MCP servers), or
 *  - BY_NAME.
 * Without case as the disk compares names: a name holding ı, ſ or the Kelvin sign counts when the disk opens it under the
 * ASCII name it may fold to ("gıt.exe" for git.exe) — `exists` asks the disk itself, never a guess.
 * Only the file's name is returned (the first in sorted order).
 */
export function plantedProgram(dir: string, opts: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; list?: (dir: string) => string[]; names?: Iterable<string>; exists?: (p: string) => boolean } = {}): string | null {
  if ((opts.platform ?? process.platform) !== 'win32') return null
  const env = opts.env ?? process.env
  const list = opts.list ?? topFiles
  const exists = opts.exists ?? isFile
  const exts = new Set([...RUNNABLE_WINDOWS, ...ownPathExt(env)])
  const named = new Set([...BY_NAME, ...[...(opts.names ?? [])].map((n) => winName(n))])
  let onPath: Set<string> | null = null
  // PATH's folders are read once, and only for a file with such an extension
  const program = (n: string) => {
    const ext = win32.extname(n)
    if (!ext || !exts.has(ext)) return false
    const base = n.slice(0, -ext.length)
    return named.has(base) || (onPath ??= programsOnPath(env, list)).has(base)
  }
  for (const name of [...list(dir)].sort()) {
    const n = winName(name)
    if (program(n)) return name
    // "gıt.exe": the disk answers whether a lookup of git.exe opens it
    const ascii = foldsTo(n)
    // (the folder is this computer's: joined by its own rules, as topFiles reads it)
    if (ascii !== null && program(ascii) && exists(join(dir, ascii))) return name
  }
  return null
}

/* ------------------------------------------------------------------ the shim reader (pure) */

/** Lines every known shim may hold besides its command (leading "@" dropped, spaces folded, lower case). */
const BOILERPLATE = new Set([
  'echo off',
  'goto start',
  ':find_dp0',
  'set dp0=%~dp0',
  'exit /b',
  ':start',
  'setlocal',
  'call :find_dp0',
  'endlocal',
  'exit /b %errorlevel%',
  ')',
  ') else (',
  'set pathext=%pathext:;.js;=;%',
  'if not defined node_path (',
  // npm's cmd-shim: no node.exe beside the shim → Node from PATH (this Node here)
  'set "_prog=node"',
  // npm.cmd / npx.cmd of Node's installer
  'if not exist "%node_exe%" (',
  'set "node_exe=node"',
])
const LOCAL_NODE = new Set(['if exist "%dp0%\\node.exe" (', 'if exist "%~dp0\\node.exe" (', 'set "_prog=%dp0%\\node.exe"', 'set "node_exe=%~dp0\\node.exe"'])
/** npm.cmd / npx.cmd: the lines around the prefix lookup (its redirect is not followed: the bundled npm runs) */
const NPM_IGNORED = [
  /^set\s+"NPM_PREFIX_JS=%~dp0\\[^"%!]+"$/i,
  /^for\s+\/f\s+"delims="\s+%%F\s+in\s+\('CALL\s+"%NODE_EXE%"\s+"%NP[MX]_(?:PREFIX|CLI)_JS%"(?:\s+prefix\s+-g)?'\)\s+do\s+\($/i,
  /^set\s+"NPM_PREFIX_NP[MX]_CLI_JS=%%F\\node_modules\\npm\\bin\\np[mx]-cli\.js"$/i,
  /^if\s+exist\s+"%NPM_PREFIX_NP[MX]_CLI_JS%"\s+\($/i,
  /^set\s+"(NP[MX]_CLI_JS)=%NPM_PREFIX_\1%"$/i,
]
const NPM_VAR = /^set\s+"(NP[MX]_CLI_JS)=%~dp0\\([^"%!]+)"$/i
const NODE_PATH_ONLY = /^set\s+"NODE_PATH=([^"%!]*)"$/i
const NODE_PATH_MORE = /^set\s+"NODE_PATH=([^"%!]*);%NODE_PATH%"$/i
const COMMAND =
  /^(?:endlocal\s*&\s*goto\s+#_undefined_#\s+2>NUL\s*\|\|\s*title\s+%COMSPEC%\s*&\s*)?(?:("%_prog%"|"%~dp0\\node\.exe"|"%dp0%\\node\.exe"|node|"%NODE_EXE%")\s+)?((?:--[\w.=:,-]+\s+)*)"([^"]+)"\s+%\*$/i
/** a node_modules\.bin shim re-reads %* (cmd.exe arguments then need a second escape) */
const BIN_SHIM = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i

/**
 * Read a .cmd / .bat shim: npm's cmd-shim (v4–v7: npm, yarn 1, corepack, node_modules\.bin), pnpm's, Node's own
 * npm.cmd / npx.cmd, a one-line forwarder (`@"C:\…\x.exe" %*`, scoop). Every line must be one of these shapes —
 * anything else (other variables, CALL, IF, pipes) is not a shim this reader knows: null.
 */
export function readShim(text: string, shimPath: string, ctx: ExecCtx): Shim | null {
  if (text.length >= READ_MAX || /[\0]/.test(text)) return null
  const dir = win32.dirname(shimPath)
  let localNode = false
  let progNode = false
  let nodeExe = false
  let np1: string | undefined
  let np2: string | undefined
  const vars = new Map<string, string>()
  const commands: Array<{ prog: string; pre: string; target: string }> = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^@\s*/, '')
    if (!line || /^rem(\s|$)/i.test(line) || line.startsWith('::')) continue
    const k = line.replace(/\s+/g, ' ').toLowerCase()
    if (LOCAL_NODE.has(k)) {
      localNode = true
      if (k.startsWith('set "node_exe')) nodeExe = true
      continue
    }
    if (BOILERPLATE.has(k)) {
      if (k === 'set "node_exe=node"' || k === 'if not exist "%node_exe%" (') nodeExe = true
      if (k === 'set "_prog=node"') progNode = true
      continue
    }
    if (/^set "_prog=/.test(k)) return null
    let m = NODE_PATH_MORE.exec(line)
    if (m) {
      np2 = m[1]!
      continue
    }
    m = NODE_PATH_ONLY.exec(line)
    if (m) {
      np1 = m[1]!
      continue
    }
    m = NPM_VAR.exec(line)
    if (m) {
      vars.set(m[1]!.toLowerCase(), m[2]!)
      continue
    }
    if (NPM_IGNORED.some((r) => r.test(line))) continue
    m = COMMAND.exec(line)
    if (m) {
      commands.push({ prog: (m[1] ?? '').toLowerCase(), pre: (m[2] ?? '').trim().replace(/\s+/g, ' '), target: m[3]! })
      continue
    }
    return null
  }
  const first = commands[0]
  if (!first || commands.some((x) => x.pre !== first.pre || x.target !== first.target || !x.prog !== !first.prog)) return null
  for (const { prog } of commands) {
    if (prog === '"%_prog%"' && !progNode) return null
    if (prog === '"%node_exe%"' && !nodeExe) return null
    if (prog.includes('node.exe')) localNode = true
  }
  // the target: the shim's folder + a relative path, a variable set that way (npm.cmd), or an absolute path (forwarder)
  let target: string
  const v = /^%(NP[MX]_CLI_JS)%$/i.exec(first.target)
  const rel = /^%(?:~dp0|dp0%)\\?(.*)$/i.exec(first.target)
  if (v) {
    const r = vars.get(v[1]!.toLowerCase())
    if (r === undefined) return null
    target = win32.resolve(dir, r)
  } else if (rel) {
    if (/[%"!\0-\x1f]/.test(rel[1]!)) return null
    target = win32.resolve(dir, rel[1]!)
  } else if (ABS_WIN.test(first.target) && !/[%"!\0-\x1f]/.test(first.target)) target = win32.resolve(first.target)
  else return null
  if (!ctx.exists(target)) return null
  const ext = extOf(target)
  if (!first.prog) {
    if (first.pre) return null
    return ['.exe', '.com', '.cmd', '.bat'].includes(ext) ? { kind: 'target', file: target } : null
  }
  const js = JS.has(ext) || (ext === '' && /^#!.*\bnode(?:\.exe)?\b/.test((ctx.readFile(target) ?? '').split(/\r?\n/, 1)[0] ?? ''))
  if (!js) return null
  // the Node next to the shim when the shim would take it, else this one — never a second PATH lookup
  const near = win32.join(dir, 'node.exe')
  const node = localNode && ctx.exists(near) ? near : ctx.execPath
  let env: Record<string, string> | undefined
  if (np1 !== undefined || np2 !== undefined) {
    if (np1 !== undefined && np2 !== undefined && np1 !== np2) return null
    const value = (np1 ?? np2)!
    const key = envKey(ctx.env, 'NODE_PATH', 'win32')
    const had = key === undefined ? undefined : ctx.env[key]
    env = { [key ?? 'NODE_PATH']: had && np2 !== undefined ? `${value};${had}` : value }
  }
  return { kind: 'node', node, script: target, pre: first.pre ? first.pre.split(' ') : [], ...(env ? { env } : {}) }
}

/* ------------------------------------------------------------------ cmd.exe escaping (the person's own commands only) */

const META = /([()\][%!^"`<>&|;, *?])/g

/** The command: every character cmd.exe reads gets a caret. */
const escCommand = (s: string) => s.replace(META, '^$1')

/**
 * An argument (qntm.org/cmd): backslashes before a quote doubled + \", trailing backslashes doubled, quoted, then every
 * meta character caret-escaped — the quotes too, so cmd.exe never enters quote mode and eats every caret. One pass
 * (cross-spawn 7.0.6's regexes keep only one backslash of a run before a quote).
 */
function escArgument(arg: string, double: boolean): string {
  let a = ''
  let run = 0
  for (const ch of arg) {
    if (ch === '\\') {
      run++
      continue
    }
    a += ch === '"' ? `${'\\'.repeat(run * 2 + 1)}"` : `${'\\'.repeat(run)}${ch}`
    run = 0
  }
  a = `"${a}${'\\'.repeat(run * 2)}"`.replace(META, '^$1')
  return double ? a.replace(META, '^$1') : a
}

/**
 * The cmd.exe line for argv (command + arguments) — null when an argument holds a NUL or a line break, which no
 * cmd.exe line can carry. `doubleEscape`: the script re-reads %* (a node_modules\.bin shim).
 */
export function cmdLine(argv: string[], doubleEscape: boolean): string | null {
  if (!argv.length || argv.some((a) => /[\0\r\n]/.test(a))) return null
  return [escCommand(argv[0]!), ...argv.slice(1).map((a) => escArgument(a, doubleEscape))].join(' ')
}

/* ------------------------------------------------------------------ starting */

export type SpawnSafeOptions = Omit<SpawnOptions, 'shell' | 'cwd'> & { cwd?: string; allow?: Allow; ctx?: Partial<ExecCtx> }
export type Spawned = { ok: true; child: ChildProcess; via: Via; file: string } | { ok: false; code: 127; why: 'missing' | 'refused' | 'failed'; error: string }

const errCode = (e: unknown) => String((e as NodeJS.ErrnoException)?.code ?? (e instanceof Error ? e.name : 'error'))

/**
 * A child's environment: the program's own variables (a shim's NODE_PATH) on top, and — for the programs the worker
 * starts by itself, never the person's own commands (allow 'person') — PATH of absolute folders only, and on Windows
 * NoDefaultCurrentDirectoryInExePath (ownEnv).
 */
function childEnv(env: NodeJS.ProcessEnv, r: Extract<Resolved, { ok: true }>, allow: Allow, platform: NodeJS.Platform): NodeJS.ProcessEnv {
  const all = r.env ? { ...env, ...r.env } : env
  return allow === 'person' ? all : ownEnv(all, platform)
}

/** Start a program (never throws). An ENOENT on macOS / Linux arrives later, as the child's 'error' event. */
export function spawnSafe(cmd: string, args: string[], opts: SpawnSafeOptions = {}): Spawned {
  const { allow = 'shim', ctx, ...rest } = opts
  const env = rest.env ?? process.env
  const c = fullCtx({ ...ctx, env, cwd: rest.cwd ?? ctx?.cwd ?? process.cwd() })
  const r = resolveCommand(cmd, args, c, allow)
  if (!r.ok) return r
  const win = c.platform === 'win32'
  // Windows: files inside the working folder named from there — this spawn's folder (fromCwd)
  const run = spawnForm(r, c.cwd, c.platform)
  try {
    const child = spawn(run.file, run.args, {
      ...rest,
      // Windows: the folder a file inside it is named from (spawnForm) — and the worker's own programs never look there by name
      ...(win ? { cwd: c.cwd } : {}),
      // the worker's own programs: PATH absolute only (every OS), no lookup in the working folder (Windows)
      env: childEnv(env, r, allow, c.platform),
      shell: false,
      // a caller's own verbatim line only for a program started as it is (the opener's `start ""`)
      windowsVerbatimArguments: r.verbatim || (r.via === 'direct' && !!rest.windowsVerbatimArguments),
      windowsHide: rest.windowsHide ?? true,
    })
    return { ok: true, child, via: r.via, file: r.file }
  } catch (e) {
    return { ok: false, code: 127, why: 'failed', error: `${commandName(cmd, c.platform)} could not start (${errCode(e)})` }
  }
}

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
  /** killed at the time limit (code 124) */
  timedOut?: true
  /** set when the program never ran (code 127) */
  why?: 'missing' | 'refused' | 'failed'
  error?: string
}

export interface ExecOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs: number
  /** stdout + stderr together (default 8 MB): beyond it the program is ended */
  maxBuffer?: number
  /** written to stdin (else stdin is closed) */
  input?: string
  allow?: Allow
  ctx?: Partial<ExecCtx>
  windowsHide?: boolean
  /** macOS / Linux: its own process group (the time limit then ends everything it started) */
  detached?: boolean
}

/** Run a program to its end and collect its output (never rejects). */
export function execFileSafe(cmd: string, args: string[], opts: ExecOptions): Promise<ExecResult> {
  const name = commandName(cmd, opts.ctx?.platform)
  const s = spawnSafe(cmd, args, {
    cwd: opts.cwd,
    env: opts.env,
    allow: opts.allow,
    ctx: opts.ctx,
    stdio: [opts.input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    detached: opts.detached ?? false,
    windowsHide: opts.windowsHide ?? true,
  })
  if (!s.ok) return Promise.resolve({ code: 127, stdout: '', stderr: '', why: s.why, error: s.error })
  const child = s.child
  const max = opts.maxBuffer ?? 8 * 1024 * 1024
  return new Promise((done) => {
    const out: Buffer[] = []
    const err: Buffer[] = []
    let size = 0
    let settled = false
    let timedOut = false
    let tooLarge = false
    const text = (b: Buffer[]) => Buffer.concat(b).toString('utf8')
    const finish = (r: Omit<ExecResult, 'stdout' | 'stderr'>) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      done({ stdout: text(out), stderr: text(err), ...r })
    }
    const ended = (): Omit<ExecResult, 'stdout' | 'stderr'> | null => (timedOut ? { code: 124, timedOut: true } : tooLarge ? { code: 1, error: `${name}: output too large` } : null)
    const timer = setTimeout(() => {
      timedOut = true
      void killTree(child).then(() => finish(ended()!))
    }, opts.timeoutMs)
    const take = (into: Buffer[]) => (d: Buffer) => {
      if (tooLarge) return
      size += d.length
      if (size > max) {
        tooLarge = true
        void killTree(child).then(() => finish(ended()!))
        return
      }
      into.push(d)
    }
    child.stdout?.on('data', take(out))
    child.stderr?.on('data', take(err))
    child.on('error', (e) => finish(ended() ?? { code: 127, why: errCode(e) === 'ENOENT' ? 'missing' : 'failed', error: `${name} could not start (${errCode(e)})` }))
    child.on('close', (code) => finish(ended() ?? { code: typeof code === 'number' ? code : 1 }))
    if (opts.input !== undefined) {
      child.stdin?.on('error', () => {})
      child.stdin?.end(opts.input)
    }
  })
}

export interface SyncResult {
  code: number
  stdout: string
  stderr: string
  timedOut?: true
  why?: 'missing' | 'refused' | 'failed'
}

/** The synchronous form (short reads only: the time limit ends the program, not what it started). Never throws. */
export function execFileSyncSafe(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs: number; maxBuffer?: number; allow?: Allow; ctx?: Partial<ExecCtx> }): SyncResult {
  const env = opts.env ?? process.env
  const c = fullCtx({ ...opts.ctx, env, cwd: opts.cwd ?? opts.ctx?.cwd ?? process.cwd() })
  const allow = opts.allow ?? 'shim'
  const r = resolveCommand(cmd, args, c, allow)
  if (!r.ok) return { code: 127, stdout: '', stderr: '', why: r.why }
  const win = c.platform === 'win32'
  const run = spawnForm(r, c.cwd, c.platform)
  try {
    const res = spawnSync(run.file, run.args, {
      cwd: win ? c.cwd : opts.cwd,
      env: childEnv(env, r, allow, c.platform),
      encoding: 'utf8',
      timeout: opts.timeoutMs,
      maxBuffer: opts.maxBuffer ?? 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: r.verbatim,
      shell: false,
    })
    const stdout = res.stdout ?? ''
    const stderr = res.stderr ?? ''
    if (res.error) {
      const code = errCode(res.error)
      if (code === 'ETIMEDOUT') return { code: 124, stdout, stderr, timedOut: true }
      if (code === 'ENOBUFS') return { code: 1, stdout, stderr }
      return { code: 127, stdout, stderr, why: code === 'ENOENT' ? 'missing' : 'failed' }
    }
    return { code: typeof res.status === 'number' ? res.status : 1, stdout, stderr }
  } catch {
    return { code: 127, stdout: '', stderr: '', why: 'failed' }
  }
}

/**
 * End a program and everything it started. macOS / Linux: its process group (spawned `detached`) gets SIGTERM, SIGKILL
 * after 3 s. Windows: `taskkill /T /F` at once (console programs have no gentle signal), the child itself after 3 s.
 * Resolves once it closed, at the latest after 5 s.
 */
export function killTree(child: ChildProcess, platform: NodeJS.Platform = process.platform): Promise<void> {
  if (child.exitCode !== null || child.pid === undefined) return Promise.resolve()
  const pid = child.pid
  const gone = child.signalCode !== null
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(cap)
      child.off('close', finish)
      resolve()
    }
    child.once('close', finish)
    try {
      if (platform === 'win32') void taskkillTree(pid)
      else process.kill(-pid, 'SIGTERM')
    } catch {
      try {
        child.kill('SIGTERM')
      } catch {
        /* gone */
      }
    }
    const hard = setTimeout(() => {
      if (child.exitCode !== null) return
      try {
        if (platform !== 'win32') process.kill(-pid, 'SIGKILL')
        else child.kill('SIGKILL')
      } catch {
        try {
          child.kill('SIGKILL')
        } catch {
          /* gone */
        }
      }
    }, 3000)
    hard.unref()
    const cap = setTimeout(finish, 5000)
    cap.unref()
    // ended by a signal already: its close may have passed — the group still gets the signals above
    if (gone) finish()
  })
}

/**
 * Windows: `taskkill /T /F` for a process id — it and everything below it (System32's taskkill, never by its name);
 * `tree: false`: `taskkill /F`, that process only (the leftovers of a Claude Code run, proctree.ts: their list is the
 * tree that was checked). Resolves when taskkill ended (at the latest after 5 s); never rejects. killTree and proctree
 * both end processes through it.
 */
export function taskkillTree(pid: number, opts: { tree?: boolean } = {}): Promise<void> {
  return new Promise((resolve) => {
    const cap = setTimeout(resolve, 5000)
    cap.unref()
    const done = () => {
      clearTimeout(cap)
      resolve()
    }
    try {
      const k = spawn(systemTool('taskkill'), ['/pid', String(pid), ...(opts.tree === false ? [] : ['/T']), '/F'], { stdio: 'ignore', windowsHide: true, env: ownEnv(process.env, 'win32') })
      k.on('error', done)
      k.on('close', done)
    } catch {
      done()
    }
  })
}
