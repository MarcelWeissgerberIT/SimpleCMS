/**
 * one-worker — what a Claude Code run left running (worker 1.11.0): a dev server it started for a check, a watcher, a
 * background shell. Claude Code runs every Bash command in a process group / session of its own (detached), so ending
 * Claude Code's own group never reaches them — and one that keeps Claude Code's output open kept the stage of 1.10.0
 * from ever ending (it waited for that pipe to close). When the run is over, the worker ends:
 *  - what is still in Claude Code's own process group (macOS / Linux: the worker starts it detached)
 *  - the processes below Claude Code read when its result arrives (while the shells that started them still run), and
 *    what runs below them now
 *  - macOS / Linux: every process in the group of one of Claude Code's own shells (a child of Claude Code that leads its
 *    own group — the Bash tool starts each shell so). The groups are read while a Bash command runs (and after it); a
 *    group id outlives the shell (its members keep it) and is never another group's while one of them lives; a group
 *    with no member left is forgotten at once (checked every second, no program started)
 *  - Windows: the processes seen below Claude Code while a Bash command ran (and after it) — and below one of them that
 *    ended, by its ParentProcessId (Windows keeps it after a parent ended), but only what was born while that parent
 *    lived: after its creation and before the first reading that missed it (checked every second); below an ended
 *    Claude Code only what was born between its creation and its exit
 *  - Linux / macOS: every process of this user whose environment carries the run's own mark (RUN_MARK=<random>; every
 *    program Claude Code starts inherits it) — and, when the group it is in has lost its leader (a shell that put it in
 *    the background and ended), every process of that group (macOS cannot read the environment of a program signed with
 *    entitlements — the Node and Java builds most people run: their group gives them away)
 * Never ended (named in the log instead): a server the person's own tools share (a Gradle or Kotlin daemon, sccache,
 * watchman, an ssh master, MSBuild's reused nodes …, `sharedServer`) and what runs below it; a marked process whose
 * group's own leader still runs and is none of Claude Code's shells (a program that made its own session: a daemon).
 * A process is the one seen before only with the same id, name and start time (Windows: its creation time; Linux: its
 * start in /proc; macOS: the name — its ids are not reused at once). The name is its program's file (Linux: the one
 * /proc/<pid>/exe names, `exeName` — never comm, the main thread's name a program changes: Node 24's "MainThread").
 * Never the worker itself or its parent, never pid 0 / 1. macOS / Linux: SIGTERM, SIGKILL after 2 s for what is left;
 * Windows: `taskkill /F` per process found (exec.ts) — never /T: the list is the tree that was checked. The process list:
 * /proc (Linux), `ps` (macOS), PowerShell's Win32_Process (Windows: ONE PowerShell per run answers each reading — a line
 * on its stdin; a fresh one per reading only when it fails) — read only, fixed scripts, never a shell line. Best effort:
 * a list that cannot be read ends nothing (and the stage still ends).
 *
 * Not caught: a program whose starting shell ended before any reading saw it, when (macOS) no program of its group
 * shows the mark — `nohup node server.js &` alone, with Node from nodejs.org — or (Windows) at all.
 */
import type { ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync, readdirSync, readlinkSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { execFileSafe, spawnSafe, systemTool, taskkillTree } from './exec.ts'

/** The environment variable that marks every program of one Claude Code run (its value: random, per run). */
export const RUN_MARK = 'ONE_WORKER_RUN'

export interface Proc {
  pid: number
  ppid: number
  /** process group (macOS / Linux; null on Windows) */
  pgid: number | null
  /** the program's file name (no folder) */
  name: string
  /**
   * when it started — Windows: its creation time (ms); Linux: its start time in clock ticks since boot (/proc stat
   * field 22). Compared only with the same platform's; absent on macOS.
   */
  born?: number
}

/** A process seen below Claude Code (Windows): `goneBy` — the latest a program it started can have been born. */
export interface Seen extends Proc {
  goneBy?: number
}

/** Windows: how far Win32_Process creation times and this process's clock may lie apart (ms). */
export const SKEW_MS = 500

const int = (s: string | undefined): number | null => {
  const n = Number(s)
  return s !== undefined && s.trim() !== '' && Number.isInteger(n) && n >= 0 ? n : null
}

/** A program's file name for the log: the last part of a path, without .exe — never a folder. */
export const shortName = (name: string): string =>
  (name.split(/[\\/]/).pop() ?? '')
    .replace(/\.exe$/i, '')
    .replace(/[^\p{L}\p{N} ._+-]/gu, '')
    .trim()
    .slice(0, 40)

/**
 * Linux: /proc/<pid>/stat — "pid (comm) state ppid pgrp … starttime …" (comm may hold spaces and parentheses: up to the
 * LAST ")"; starttime is field 22).
 */
export function parseStat(text: string): Proc | null {
  const open = text.indexOf('(')
  const close = text.lastIndexOf(')')
  if (open < 0 || close < open) return null
  const pid = int(text.slice(0, open).trim())
  const rest = text.slice(close + 2).split(' ')
  const ppid = int(rest[1])
  const pgid = int(rest[2])
  if (pid === null || ppid === null) return null
  const born = int(rest[19])
  return { pid, ppid, pgid, name: text.slice(open + 1, close), ...(born !== null ? { born } : {}) }
}

/**
 * Linux: a process's program name — the last part of the file /proc/<pid>/exe names (" (deleted)" off: the file was
 * replaced since it started), else `comm` (another user's process, a kernel thread, one gone meanwhile). Never `comm`
 * while that file can be read: comm is the main THREAD's name, which a program may change — Node 24 names its main
 * thread "MainThread" right at its start, `process.title` / setproctitle set their own — so a leftover would be named
 * "MainThread" and a process seen before its start-up rename would not be the same one after it. Only the file's name,
 * never its folder (shortName cuts it again for the log).
 */
export function exeName(pid: number | string, comm: string, readlink: (path: string) => string = (path) => readlinkSync(path)): string {
  try {
    const name = (readlink(`/proc/${pid}/exe`).split('/').pop() ?? '').replace(/ \(deleted\)$/, '')
    return name || comm
  } catch {
    return comm
  }
}

/** The same process as one seen before: its id, its name and (where the list has it) its start time. */
export const sameProc = (a: Proc, b: Proc | undefined): boolean => !!b && a.pid === b.pid && a.name === b.name && (a.born === undefined || b.born === undefined || a.born === b.born)

/** macOS: `ps -A -o pid=,ppid=,pgid=,comm=` — comm is the program's path (it may hold spaces). */
export function parsePs(out: string): Proc[] {
  const list: Proc[] = []
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*?)\s*$/.exec(line)
    if (m) list.push({ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), name: m[4]! })
  }
  return list
}

/** Windows: PowerShell's lines "<pid> <ppid> <created ms> <name>". */
export function parseWin(out: string): Proc[] {
  const list: Proc[] = []
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*?)\s*$/.exec(line)
    if (m) list.push({ pid: Number(m[1]), ppid: Number(m[2]), pgid: null, born: Number(m[3]), name: m[4]! })
  }
  return list
}

/** Windows: one line per process — the creation time as ms (UTC): a process created before the run is never followed. */
const WIN_LIST = "Get-CimInstance Win32_Process | ForEach-Object { $b = 0; if ($_.CreationDate) { $b = ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() }; '{0} {1} {2} {3}' -f $_.ProcessId, $_.ParentProcessId, $b, $_.Name }"

/** Windows: the command lines of these processes ("<pid> <line>") — the filter is built from numbers only. */
const winCommandLines = (pids: readonly number[]) =>
  `Get-CimInstance Win32_Process -Filter '${pids.map((p) => `ProcessId=${Math.trunc(p)}`).join(' OR ')}' | ForEach-Object { '{0} {1}' -f $_.ProcessId, ([string]$_.CommandLine -replace '\\s+', ' ') }`

/** Lines "<pid> <rest>" → a map (the rest trimmed). */
export function parsePidLines(out: string): Map<number, string> {
  const map = new Map<number, string>()
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s?(.*)$/.exec(line)
    if (m) map.set(Number(m[1]), m[2]!.trim())
  }
  return map
}

/** Every process: pid, ppid, process group (macOS / Linux) or creation time (Windows) — null when it cannot be read. */
export async function listProcs(platform: NodeJS.Platform = process.platform): Promise<Proc[] | null> {
  try {
    if (platform === 'linux') {
      const out: Proc[] = []
      for (const d of readdirSync('/proc')) {
        if (!/^\d+$/.test(d)) continue
        try {
          const p = parseStat(readFileSync(`/proc/${d}/stat`, 'utf8'))
          if (p) out.push({ ...p, name: exeName(d, p.name) })
        } catch {
          /* gone meanwhile */
        }
      }
      return out
    }
    if (platform === 'win32') {
      const r = await execFileSafe(systemTool('powershell'), ['-NoProfile', '-NonInteractive', '-Command', WIN_LIST], { timeoutMs: 20_000, maxBuffer: 8 * 1024 * 1024, allow: 'exe' })
      return r.code === 0 ? parseWin(r.stdout) : null
    }
    const r = await execFileSafe('ps', ['-A', '-o', 'pid=,ppid=,pgid=,comm='], { timeoutMs: 10_000, maxBuffer: 8 * 1024 * 1024, allow: 'exe' })
    return r.code === 0 ? parsePs(r.stdout) : null
  } catch {
    return null
  }
}

/** The command lines of a few processes (for `sharedServer`) — what cannot be read is missing. Never rejects. */
export async function commandLines(pids: readonly number[], platform: NodeJS.Platform = process.platform, session?: LineSession | null): Promise<Map<number, string>> {
  const list = [...new Set(pids)].filter((p) => Number.isInteger(p) && p > 0).slice(0, 200)
  if (!list.length) return new Map()
  try {
    if (platform === 'linux') {
      const map = new Map<number, string>()
      for (const pid of list)
        try {
          map.set(pid, readFileSync(`/proc/${pid}/cmdline`, 'latin1').split('\0').join(' ').trim())
        } catch {
          /* gone */
        }
      return map
    }
    if (platform === 'win32') {
      const lines = session ? await session.run(winCommandLines(list)) : null
      if (lines) return parsePidLines(lines.join('\n'))
      const r = await execFileSafe(systemTool('powershell'), ['-NoProfile', '-NonInteractive', '-Command', winCommandLines(list)], { timeoutMs: 20_000, maxBuffer: 8 * 1024 * 1024, allow: 'exe' })
      return r.code === 0 ? parsePidLines(r.stdout) : new Map()
    }
    const r = await execFileSafe('ps', ['-ww', '-o', 'pid=,command=', '-p', list.join(',')], { timeoutMs: 10_000, maxBuffer: 8 * 1024 * 1024, allow: 'exe' })
    return parsePidLines(r.stdout)
  } catch {
    return new Map()
  }
}

/**
 * The processes of this user that carry `RUN_MARK=<token>` in their environment: Linux reads /proc/<pid>/environ (only a
 * process of this user can be read), macOS `ps -E` (the environment of this user's processes — none of a program signed
 * with entitlements, whatever it carries). Windows: none (no reader without a native module) — its parent ids hold
 * instead.
 */
export async function markedProcs(token: string, platform: NodeJS.Platform = process.platform): Promise<Set<number>> {
  const out = new Set<number>()
  const mark = `${RUN_MARK}=${token}`
  try {
    if (platform === 'linux') {
      for (const d of readdirSync('/proc')) {
        if (!/^\d+$/.test(d)) continue
        try {
          if (readFileSync(`/proc/${d}/environ`, 'latin1').split('\0').includes(mark)) out.add(Number(d))
        } catch {
          /* another user's, or gone */
        }
      }
    } else if (platform === 'darwin') {
      const r = await execFileSafe('ps', ['-E', '-A', '-ww', '-o', 'pid=,command='], { timeoutMs: 10_000, maxBuffer: 32 * 1024 * 1024, allow: 'exe' })
      if (r.code === 0)
        for (const line of r.stdout.split('\n')) {
          const m = /^\s*(\d+)\s/.exec(line)
          if (m && (line.includes(` ${mark} `) || line.endsWith(` ${mark}`))) out.add(Number(m[1]))
        }
    }
  } catch {
    /* none */
  }
  return out
}

/**
 * Servers the person's own tools share (one per user, reused by every compatible build or session — ending one breaks
 * the person's own work that uses it): never ended, named instead. By the program's file name and / or its command line.
 */
const SHARED: ReadonlyArray<{ label: string; name?: RegExp; cmd?: RegExp }> = [
  { label: 'Gradle daemon', cmd: /\borg\.gradle\.launcher\.daemon\.bootstrap\.GradleDaemon\b/ },
  { label: 'Kotlin daemon', cmd: /\bKotlinCompileDaemon\b/ },
  { label: 'MSBuild node', cmd: /[/-]nodeReuse:true\b|[/-]nodemode:\d/i },
  { label: 'VBCSCompiler', name: /^VBCSCompiler(\.exe)?$/i },
  { label: 'VBCSCompiler', cmd: /\bVBCSCompiler\.(dll|exe)\b/i },
  { label: 'sccache', name: /^sccache(\.exe)?$/i },
  { label: 'watchman', name: /^watchman(\.exe)?$/i },
  { label: 'adb server', name: /^adb(\.exe)?$/i, cmd: /\bfork-server\b/ },
  { label: 'ssh master', name: /^ssh(\.exe)?$/i, cmd: /\[mux\]|ControlPersist|ControlMaster/i },
  { label: 'gpg-agent', name: /^(gpg-agent|keyboxd|scdaemon|dirmngr)(\.exe)?$/i },
]

/** The label of a server the person's tools share ('Gradle daemon' …), null for any other program. Pure. */
export function sharedServer(name: string, cmd: string | null | undefined): string | null {
  const base = name.split(/[\\/]/).pop() ?? ''
  for (const s of SHARED) {
    if (s.name && !s.name.test(base)) continue
    if (s.cmd && !(cmd && s.cmd.test(cmd))) continue
    return s.label
  }
  return null
}

/**
 * The processes below `root` in `list` (children, their children …). Windows: only processes created after `since`, and
 * never one older than the parent it names (its parent's id may belong to another program by now) — nor, for a `root`
 * no longer in the list, one born before `rootBorn` or after `rootUntil` (while that id was the process seen).
 */
export function below(list: readonly Proc[], root: number, opts: { platform?: NodeJS.Platform; since?: number; rootBorn?: number; rootUntil?: number } = {}): Proc[] {
  const win = (opts.platform ?? process.platform) === 'win32'
  const byParent = new Map<number, Proc[]>()
  const byPid = new Map(list.map((p) => [p.pid, p]))
  for (const p of list) {
    if (p.pid === p.ppid) continue
    const kids = byParent.get(p.ppid) ?? []
    kids.push(p)
    byParent.set(p.ppid, kids)
  }
  const out: Proc[] = []
  const seen = new Set<number>([root])
  const queue = [root]
  while (queue.length) {
    const parent = queue.shift()!
    for (const kid of byParent.get(parent) ?? []) {
      if (seen.has(kid.pid)) continue
      if (win) {
        if (opts.since !== undefined && (kid.born ?? 0) < opts.since) continue
        const up = byPid.get(parent)
        const upBorn = up?.born ?? (parent === root ? opts.rootBorn : undefined)
        if (upBorn !== undefined && kid.born !== undefined && kid.born < upBorn) continue
        // the parent ended: only what it can have started while it lived
        if (!up && parent === root && opts.rootUntil !== undefined && (kid.born === undefined || kid.born > opts.rootUntil)) continue
      }
      seen.add(kid.pid)
      out.push(kid)
      queue.push(kid.pid)
    }
  }
  return out
}

export interface LeftoverInput {
  /** Claude Code's process id */
  root: number
  /** Windows: a little before the run started (ms) — nothing created earlier is followed */
  since: number
  /** the list read at Claude Code's result (null: none) */
  before: readonly Proc[] | null
  /** Windows: the processes seen below Claude Code while it ran — each with the latest a child of it can have been born */
  sampled?: readonly Seen[]
  /** macOS / Linux: the groups of Claude Code's own shells (still holding a member when last checked) */
  groups?: Iterable<number>
  now: readonly Proc[]
  /** Windows: the latest a child of a process `now` misses can have been born (when `now` was read) */
  nowAt?: number
  /** Windows: Claude Code's creation time (a reading saw it) — else a moment before its spawn */
  rootBorn?: number
  /** Windows: when Claude Code exited — its id may be another program's after that */
  exitAt?: number
  /** the processes carrying the run's mark (macOS / Linux) */
  marked?: ReadonlySet<number>
  /** command lines of the candidates (a known shared server is never ended) */
  cmds?: ReadonlyMap<number, string>
  self?: number
  parent?: number
  platform?: NodeJS.Platform
}

export interface Spared {
  proc: Proc
  /** shared: a server the person's tools share (and what runs below it); daemon: in a group its own living leader made */
  why: 'shared' | 'daemon'
  label: string
}

export interface Leftovers {
  /** to end */
  end: Proc[]
  /** left running, named in the log */
  spared: Spared[]
}

/**
 * The leftovers of a run among `now` (pure — the tests feed it lists). `before`: the processes below Claude Code read at
 * its result; `sampled`: those seen below it while it ran (Windows). Each counts only while `now` holds the SAME process
 * (sameProc), and what runs below it now counts too — below one that ended as well (Windows: only what was born while it
 * lived), unless its id belongs to another process by now. Never `root` itself (killTree ends it).
 */
export function leftoversOf(opts: LeftoverInput): Leftovers {
  const platform = opts.platform ?? process.platform
  const win = platform === 'win32'
  const alive = new Map(opts.now.map((p) => [p.pid, p]))
  const groups = new Set(opts.groups ?? [])
  const picked = new Set<number>()
  const daemons = new Set<number>()
  /** what runs below `p` now — `p` itself, when it still is the process seen */
  const from = (p: Seen) => {
    const here = alive.get(p.pid)
    if (here && !sameProc(p, here)) return // its id belongs to another process by now
    if (here) picked.add(p.pid)
    const until = here ? undefined : (p.goneBy ?? opts.nowAt)
    for (const k of below(opts.now, p.pid, { platform, since: opts.since, rootBorn: p.born, rootUntil: until })) picked.add(k.pid)
  }
  // below Claude Code as read at its result and as sampled while it ran (the same process still — a reused id is not it;
  // one both name: the sample's bound)
  const key = (p: Proc) => `${p.pid}:${p.born ?? ''}`
  const sampled = new Set((opts.sampled ?? []).map(key))
  for (const p of opts.before ? below(opts.before, opts.root, { platform, since: opts.since }) : []) if (!sampled.has(key(p))) from(p)
  for (const p of opts.sampled ?? []) from(p)
  // below it now (Windows: also below an ended Claude Code — its id stays the parent id of what it started — but only
  // what was born between its creation and its exit), unless its id is another process's by now
  if (!alive.has(opts.root)) for (const p of below(opts.now, opts.root, { platform, since: opts.since, rootBorn: opts.rootBorn, rootUntil: opts.exitAt })) picked.add(p.pid)
  if (!win) {
    // its own process group, and the groups of its shells
    for (const p of opts.now) if (p.pgid !== null && (p.pgid === opts.root || groups.has(p.pgid))) picked.add(p.pid)
    // what carries its mark: ended — unless the group it is in has a living leader none of the above (a daemon's own)
    for (const pid of opts.marked ?? []) {
      const p = alive.get(pid)
      if (!p || picked.has(pid)) continue
      const g = p.pgid
      const leader = g !== null ? alive.get(g) : undefined
      if (leader && !picked.has(leader.pid)) {
        daemons.add(pid)
        continue
      }
      picked.add(pid)
      // the group lost its leader (a shell that put it in the background): its other programs too, marked or not
      if (g !== null && g > 1 && !leader) for (const q of opts.now) if (q.pgid === g) picked.add(q.pid)
    }
  }
  for (const never of [0, 1, opts.root, opts.self ?? process.pid, opts.parent ?? process.ppid]) {
    picked.delete(never)
    daemons.delete(never)
  }
  // a server the person's tools share, and what runs below it: never ended
  const shared = new Map<number, string>()
  for (const pid of [...picked, ...daemons]) {
    const p = alive.get(pid)!
    const label = sharedServer(p.name, opts.cmds?.get(pid))
    if (!label) continue
    shared.set(pid, label)
    for (const k of below(opts.now, pid, { platform, since: opts.since })) if (!shared.has(k.pid)) shared.set(k.pid, label)
  }
  const end: Proc[] = []
  const spared: Spared[] = []
  for (const pid of picked) {
    const p = alive.get(pid)
    if (!p) continue
    const label = shared.get(pid)
    if (label) spared.push({ proc: p, why: 'shared', label })
    else end.push(p)
  }
  for (const pid of daemons) {
    const p = alive.get(pid)!
    const label = shared.get(pid)
    spared.push({ proc: p, why: label ? 'shared' : 'daemon', label: label ?? (shortName(p.name) || 'program') })
  }
  return { end, spared }
}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // EPERM: it runs, as another user — not ours to end
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** macOS / Linux: whether process group `g` still has a member (no program started). */
const groupAlive = (g: number): boolean => g > 1 && isAlive(-g)

/**
 * End `procs` (and, macOS / Linux, what is left of Claude Code's own group): SIGTERM, then SIGKILL after 2 s. Windows:
 * `taskkill /F` for each process found — never /T, which would follow parent ids nobody checked (a process whose ended
 * parent's id a leftover holds now).
 */
export async function endProcs(procs: readonly Proc[], opts: { root: number; group: boolean; platform?: NodeJS.Platform; graceMs?: number; kill?: (pid: number) => Promise<void> }): Promise<void> {
  const platform = opts.platform ?? process.platform
  if (platform === 'win32') {
    const kill = opts.kill ?? ((pid: number) => taskkillTree(pid, { tree: false }))
    await Promise.all(procs.map((p) => kill(p.pid)))
    return
  }
  const signal = (sig: NodeJS.Signals) => {
    if (opts.group)
      try {
        process.kill(-opts.root, sig)
      } catch {
        /* gone */
      }
    for (const p of procs)
      try {
        process.kill(p.pid, sig)
      } catch {
        /* gone */
      }
  }
  signal('SIGTERM')
  const until = Date.now() + (opts.graceMs ?? 2000)
  while (Date.now() < until && procs.some((p) => isAlive(p.pid))) await new Promise((r) => setTimeout(r, 100))
  if (procs.some((p) => isAlive(p.pid))) signal('SIGKILL')
}

/**
 * Windows: ONE PowerShell that answers each reading of a run (a line on its stdin; the answer between two marks on its
 * stdout) — instead of a fresh powershell.exe per reading. One reading at a time; a session that fails (no answer within
 * `timeoutMs`, ended, not started) is never used again (`run` → null: the caller reads the one-shot way).
 */
export class LineSession {
  private child: ChildProcess | null = null
  private broken = false
  private busy = false
  private onLine: ((line: string) => void) | null = null
  private onFail: (() => void) | null = null
  private readonly start: () => ChildProcess | null
  private readonly timeoutMs: number

  constructor(start: () => ChildProcess | null, timeoutMs = 20_000) {
    this.start = start
    this.timeoutMs = timeoutMs
  }

  /** Run one line of script; its output lines (null: the session failed, or a reading is under way). */
  run(script: string): Promise<string[] | null> {
    if (this.broken || this.busy) return Promise.resolve(null)
    if (!this.child && !this.open()) return Promise.resolve(null)
    const child = this.child!
    const tag = randomBytes(6).toString('hex')
    const begin = `ONE-BEGIN-${tag}`
    const end = `ONE-END-${tag}`
    this.busy = true
    return new Promise((resolve) => {
      const lines: string[] = []
      let inside = false
      const done = (out: string[] | null) => {
        clearTimeout(timer)
        this.onLine = null
        this.onFail = null
        this.busy = false
        resolve(out)
      }
      const timer = setTimeout(() => {
        this.fail()
        done(null)
      }, this.timeoutMs)
      timer.unref?.()
      this.onLine = (line) => {
        if (line.includes(end)) return done(lines)
        if (line.includes(begin)) inside = true
        else if (inside && lines.length < 100_000) lines.push(line)
      }
      this.onFail = () => done(null)
      try {
        child.stdin?.write(`'${begin}'; try { ${script} } catch { }; '${end}'\n`)
      } catch {
        this.fail()
      }
    })
  }

  private open(): boolean {
    let child: ChildProcess | null = null
    try {
      child = this.start()
    } catch {
      child = null
    }
    if (!child?.stdout || !child.stdin) {
      this.broken = true
      return false
    }
    this.child = child
    child.stdin.on('error', () => this.fail())
    child.on('error', () => this.fail())
    child.on('exit', () => this.fail())
    createInterface({ input: child.stdout }).on('line', (line) => this.onLine?.(line))
    return true
  }

  private fail() {
    if (this.broken) return
    this.broken = true
    this.close()
    this.onFail?.()
  }

  /** End the session (the run is over). */
  close(): void {
    this.broken = true
    const child = this.child
    this.child = null
    if (!child) return
    try {
      child.stdin?.end()
      // PowerShell starts nothing of its own here: the process alone
      if (child.exitCode === null) child.kill()
    } catch {
      /* gone */
    }
  }
}

/** The worker's PowerShell session for a run (Windows). */
const startPowerShell = (): ChildProcess | null => {
  const s = spawnSafe(systemTool('powershell'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'], { stdio: ['pipe', 'pipe', 'ignore'], allow: 'exe', windowsHide: true })
  return s.ok ? s.child : null
}

/** Tool calls that start programs: the tree is read while one runs and after it (BASH_TOOLS). */
export const BASH_TOOLS = /^(Bash|PowerShell)$/

/** How often the tree is read while a Bash command runs, at first (ONE_WORKER_SAMPLE_MS: tests) — doubling up to the cap while a reading finds nothing new. */
const sampleBase = (win: boolean) => Number(process.env.ONE_WORKER_SAMPLE_MS) || (win ? 5000 : 1000)
const sampleCap = (win: boolean) => (win ? 30_000 : 15_000)
/** The first reading after a Bash command starts (its shell exists by then). */
const FIRST_MS = 300

export interface RunTreeOptions {
  platform?: NodeJS.Platform
  /** a reading of every process (tests) */
  list?: () => Promise<Proc[] | null>
  /** whether a process / a process group still lives (tests) */
  alive?: (pid: number) => boolean
  groupAlive?: (g: number) => boolean
  clock?: () => number
}

/**
 * One Claude Code run's process tree: `bashStart` / `bashEnd` (a Bash command runs; it returned) and `atResult()` read
 * it, `exited()` notes Claude Code's exit, `end()` (after Claude Code ended) ends what it left behind and says what that
 * was. Never throws.
 */
export class RunTree {
  private readonly since: number
  private readonly spawnAt: number
  private readonly root: number
  private readonly token: string
  private readonly platform: NodeJS.Platform
  private readonly win: boolean
  private readonly clock: () => number
  private readonly aliveOf: (pid: number) => boolean
  private readonly groupAliveOf: (g: number) => boolean
  private readonly lister: () => Promise<Proc[] | null>
  private readonly session: LineSession | null
  private before: Promise<Proc[] | null> | null = null
  /** Windows: processes seen below Claude Code, by id + creation time */
  private readonly seen = new Map<string, Seen>()
  /** macOS / Linux: the groups of Claude Code's own shells */
  private readonly groups = new Set<number>()
  private rootBorn: number | undefined
  private exitAt: number | undefined
  private readonly inflight = new Set<string>()
  private sampling: Promise<number> | null = null
  private lastSample = 0
  private interval: number
  private timer: ReturnType<typeof setTimeout> | null = null
  private watcher: ReturnType<typeof setInterval> | null = null
  private closed = false

  constructor(root: number, token: string, opts: RunTreeOptions = {}) {
    this.root = root
    this.token = token
    this.platform = opts.platform ?? process.platform
    this.win = this.platform === 'win32'
    this.clock = opts.clock ?? Date.now
    this.aliveOf = opts.alive ?? isAlive
    this.groupAliveOf = opts.groupAlive ?? groupAlive
    // Windows: one PowerShell per run answers the readings (a fresh one only when it fails)
    this.session = !opts.list && this.win ? new LineSession(startPowerShell) : null
    this.lister = opts.list ?? (() => this.readAll())
    this.spawnAt = this.clock()
    // a little before the spawn: Windows' creation times and this clock may differ by a moment
    this.since = this.spawnAt - 2000
    this.interval = sampleBase(this.win)
  }

  private async readAll(): Promise<Proc[] | null> {
    if (this.session) {
      const lines = await this.session.run(WIN_LIST)
      if (lines) return parseWin(lines.join('\n'))
    }
    return listProcs(this.platform)
  }

  /** A Bash command starts: the tree is read soon and every few seconds while one runs (less often while nothing changes). */
  bashStart(id: string): void {
    if (this.closed || this.before) return
    this.inflight.add(id)
    this.interval = sampleBase(this.win)
    if (!this.timer) this.schedule(FIRST_MS)
  }

  /** A Bash command returned: the tree once more now (what it started still hangs together), at most once a second. */
  bashEnd(id: string): void {
    if (this.closed || this.before || !this.inflight.delete(id)) return
    this.schedule(Math.max(0, this.lastSample + 1000 - this.clock()))
  }

  private schedule(ms: number) {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.tick(), ms)
    this.timer.unref?.()
  }

  private async tick() {
    this.timer = null
    if (this.closed || this.before) return
    const fresh = await this.sample()
    if (this.closed || this.before || !this.inflight.size || this.timer) return
    // nothing new: read less often (a long test run); something new: as often as at first
    this.interval = fresh > 0 ? sampleBase(this.win) : Math.min(this.interval * 2, sampleCap(this.win))
    this.schedule(this.interval)
  }

  /** One reading (one at a time); how many processes / groups it found that no reading had found before. */
  private sample(): Promise<number> {
    if (this.sampling) return this.sampling
    this.lastSample = this.clock()
    const started = this.clock()
    this.sampling = this.lister()
      .then((list) => (list ? this.note(list, started, this.clock()) : 0))
      .catch(() => 0)
      .finally(() => {
        this.sampling = null
      })
    return this.sampling
  }

  /**
   * Take in a reading begun at `started` and done at `at`: Windows — Claude Code's creation time, the processes below
   * it, and for each one seen before that this reading misses (or whose id another process holds now) the latest a
   * child of it can have been born; macOS / Linux — the groups of its shells.
   */
  private note(list: readonly Proc[], started: number, at: number): number {
    let fresh = 0
    // begun while Claude Code ran: its id is its own (the worker holds its handle / has not reaped it)
    const running = this.exitAt === undefined || started < this.exitAt - SKEW_MS
    if (this.win) {
      const byPid = new Map(list.map((p) => [p.pid, p]))
      const me = byPid.get(this.root)
      if (me?.born !== undefined && this.rootBorn === undefined && running) this.rootBorn = me.born
      for (const s of this.seen.values()) {
        if (s.goneBy !== undefined) continue
        const here = byPid.get(s.pid)
        if (!here) s.goneBy = at + SKEW_MS
        else if (!sameProc(s, here)) s.goneBy = here.born ?? at + SKEW_MS
      }
      // Claude Code's id held by another process by now: nothing below it is Claude Code's
      const taken = !!me && (me.born === undefined || this.rootBorn === undefined || me.born !== this.rootBorn)
      if (!taken)
        for (const p of below(list, this.root, { platform: this.platform, since: this.since, rootBorn: this.rootBorn ?? this.spawnAt - SKEW_MS, rootUntil: this.exitAt })) {
          const key = `${p.pid}:${p.born ?? ''}`
          if (this.seen.has(key) || this.seen.size >= 5000) continue
          this.seen.set(key, { ...p })
          fresh++
        }
    } else if (running && list.some((p) => p.pid === this.root)) {
      for (const p of list)
        if (p.ppid === this.root && p.pgid === p.pid && p.pid !== this.root && p.pid > 1 && !this.groups.has(p.pid) && this.groups.size < 5000) {
          this.groups.add(p.pid)
          fresh++
        }
    }
    if (fresh) this.watch()
    return fresh
  }

  /**
   * Every second (no program started): Windows — a process seen that has ended: the latest a child of it can have been
   * born; macOS / Linux — a group with no member left is forgotten (its id may be another group's later).
   */
  private watch() {
    if (this.watcher || this.closed) return
    this.watcher = setInterval(() => {
      const t = this.clock()
      if (this.win) {
        for (const s of this.seen.values()) if (s.goneBy === undefined && !this.aliveOf(s.pid)) s.goneBy = t + SKEW_MS
      } else for (const g of [...this.groups]) if (!this.groupAliveOf(g)) this.groups.delete(g)
    }, 1000)
    this.watcher.unref?.()
  }

  /** Read the tree now (Claude Code's result arrived — the shells it started may still run); no readings after it. */
  atResult(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.before) return
    const started = this.clock()
    this.before = (async () => {
      await this.sampling
      const list = await this.lister().catch(() => null)
      if (list) this.note(list, started, this.clock())
      return list
    })()
  }

  /** Claude Code's process exited (Windows: its id may be another program's from now on). */
  exited(): void {
    this.exitAt ??= this.clock() + SKEW_MS
  }

  private stop() {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.watcher) clearInterval(this.watcher)
    this.watcher = null
  }

  /** No more readings, nothing ended (a run that never started Claude Code; the tests). */
  close(): void {
    this.stop()
    this.session?.close()
  }

  /** What the tree knows so far (the tests). */
  snapshot(): { groups: number[]; seen: Seen[]; rootBorn?: number; exitAt?: number } {
    return { groups: [...this.groups], seen: [...this.seen.values()].map((s) => ({ ...s })), rootBorn: this.rootBorn, exitAt: this.exitAt }
  }

  /** End what the run left running; the count and the program names (≤ 5, no folders) — and what was left running. */
  async end(): Promise<{ n: number; names: string[]; spared: { n: number; names: string[] } }> {
    const none = { n: 0, names: [], spared: { n: 0, names: [] } }
    this.exited()
    try {
      await this.sampling
      const before = this.before ? await this.before : null
      // the groups once more: one that lost its last member since the last check is forgotten
      if (!this.win) for (const g of [...this.groups]) if (!this.groupAliveOf(g)) this.groups.delete(g)
      const now = await this.lister().catch(() => null)
      const nowAt = this.clock() + SKEW_MS
      this.stop()
      if (!now) return none
      if (this.win) this.note(now, nowAt, nowAt - SKEW_MS)
      const marked = await markedProcs(this.token, this.platform)
      const input: LeftoverInput = {
        root: this.root,
        since: this.since,
        before,
        sampled: [...this.seen.values()],
        groups: this.groups,
        now,
        nowAt,
        rootBorn: this.rootBorn ?? this.spawnAt - SKEW_MS,
        exitAt: this.exitAt,
        marked,
        platform: this.platform,
      }
      const first = leftoversOf(input)
      const cands = [...first.end, ...first.spared.map((s) => s.proc)].map((p) => p.pid)
      const cmds = cands.length ? await commandLines(cands, this.platform, this.session) : new Map<number, string>()
      const { end, spared } = leftoversOf({ ...input, cmds })
      const group = !this.win && now.some((p) => p.pgid === this.root) && !spared.some((s) => s.proc.pgid === this.root)
      if (end.length || group) await endProcs(end, { root: this.root, group, platform: this.platform })
      const names = (list: readonly string[]) => [...new Set(list.filter(Boolean))].slice(0, 5)
      return { n: end.length, names: names(end.map((p) => shortName(p.name))), spared: { n: spared.length, names: names(spared.map((s) => s.label)) } }
    } catch {
      return none
    } finally {
      this.stop()
      this.session?.close()
    }
  }
}
