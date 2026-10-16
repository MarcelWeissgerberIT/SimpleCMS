/**
 * one-worker — what a Claude Code run left running (worker 1.11.0): a dev server it started for a check, a watcher, a
 * background shell. Claude Code runs every Bash command in a process group / session of its own (detached), so ending
 * Claude Code's own group never reaches them — and one that keeps Claude Code's output open kept the stage of 1.10.0
 * from ever ending (it waited for that pipe to close). When the run is over, the worker ends:
 *  - what is still in Claude Code's own process group (macOS / Linux: the worker starts it detached)
 *  - the processes below Claude Code — read when its result arrives (while the shells that started them still run), on
 *    Windows also sampled while it runs (every few seconds and at every tool result: a shell that started a server and
 *    ended is seen while it ran) — and below those again after they ended. macOS / Linux by parent; Windows by
 *    ParentProcessId, which Windows keeps after a parent ended: there only processes created after the run started and
 *    after the parent they name
 *  - Linux / macOS: every process of this user whose environment carries the run's own mark (RUN_MARK=<random>; every
 *    program Claude Code starts inherits it — a server a shell left behind included)
 * A process is the one seen before only with the same id, name and start time (Windows: its creation time; Linux: its
 * start in /proc; macOS: the name — its ids are not reused at once): an id Windows gave to another program meanwhile
 * is never followed, nor is an ended process's id once another one holds it.
 * Never the worker itself or its parent, never a process group but Claude Code's own, never pid 0 / 1. macOS / Linux:
 * SIGTERM, SIGKILL after 2 s for what is left; Windows: `taskkill /F` per process found (exec.ts) — never /T: the list
 * is the tree that was checked. The process list: /proc (Linux), `ps` (macOS), PowerShell's Win32_Process (Windows) —
 * read only, fixed argument lists, never a shell line. Best effort: a list that cannot be read ends nothing (and the
 * stage still ends).
 *
 * Not caught on Windows: a program whose starter ended between two samples (a shell that put a server in the
 * background and ended at once) — no sample saw the link, and Windows has no environment reader without a native
 * module.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { execFileSafe, systemTool, taskkillTree } from './exec.ts'

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

/** Every process: pid, ppid, process group (macOS / Linux) or creation time (Windows) — null when it cannot be read. */
export async function listProcs(platform: NodeJS.Platform = process.platform): Promise<Proc[] | null> {
  try {
    if (platform === 'linux') {
      const out: Proc[] = []
      for (const d of readdirSync('/proc')) {
        if (!/^\d+$/.test(d)) continue
        try {
          const p = parseStat(readFileSync(`/proc/${d}/stat`, 'utf8'))
          if (p) out.push(p)
        } catch {
          /* gone meanwhile */
        }
      }
      return out
    }
    if (platform === 'win32') {
      // one line per process; the creation time as ms (UTC) — a process created before the run is never followed
      const script = "Get-CimInstance Win32_Process | ForEach-Object { $b = 0; if ($_.CreationDate) { $b = ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() }; '{0} {1} {2} {3}' -f $_.ProcessId, $_.ParentProcessId, $b, $_.Name }"
      const r = await execFileSafe(systemTool('powershell'), ['-NoProfile', '-NonInteractive', '-Command', script], { timeoutMs: 20_000, maxBuffer: 8 * 1024 * 1024, allow: 'exe' })
      return r.code === 0 ? parseWin(r.stdout) : null
    }
    const r = await execFileSafe('ps', ['-A', '-o', 'pid=,ppid=,pgid=,comm='], { timeoutMs: 10_000, maxBuffer: 8 * 1024 * 1024, allow: 'exe' })
    return r.code === 0 ? parsePs(r.stdout) : null
  } catch {
    return null
  }
}

/**
 * The processes of this user that carry `RUN_MARK=<token>` in their environment: Linux reads /proc/<pid>/environ (only a
 * process of this user can be read), macOS `ps -E` (the environment of this user's processes). Windows: none (no
 * reader without a native module) — its parent ids hold instead.
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
 * The processes below `root` in `list` (children, their children …). Windows: only processes created after `since`, and
 * never one older than the parent it names (its parent's id may belong to another program by now) — nor, for a parent
 * no longer in the list, one older than `rootBorn` (when it was seen).
 */
export function below(list: readonly Proc[], root: number, opts: { platform?: NodeJS.Platform; since?: number; rootBorn?: number } = {}): Proc[] {
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
      }
      seen.add(kid.pid)
      out.push(kid)
      queue.push(kid.pid)
    }
  }
  return out
}

/**
 * The leftovers of a run among `now` (pure — the tests feed it lists). `before`: the processes below Claude Code read at
 * its result; `sampled`: those seen below it while it ran (Windows). Each counts only while `now` holds the SAME process
 * (sameProc), and what runs below it now counts too — below one that ended as well, unless its id belongs to another
 * process by now. Never `root` itself (killTree ends it).
 */
export function leftoversOf(opts: { root: number; since: number; before: readonly Proc[] | null; sampled?: readonly Proc[]; now: readonly Proc[]; marked?: ReadonlySet<number>; self?: number; parent?: number; platform?: NodeJS.Platform }): Proc[] {
  const platform = opts.platform ?? process.platform
  const alive = new Map(opts.now.map((p) => [p.pid, p]))
  const picked = new Set<number>()
  /** what runs below `p` now — `p` itself, when it still is the process seen */
  const from = (p: Proc) => {
    const here = alive.get(p.pid)
    if (here && !sameProc(p, here)) return // its id belongs to another process by now
    if (here) picked.add(p.pid)
    for (const k of below(opts.now, p.pid, { platform, since: opts.since, rootBorn: p.born })) picked.add(k.pid)
  }
  // below Claude Code as read at its result and as sampled while it ran (the same process still — a reused id is not it)
  const seen = [...(opts.before ? below(opts.before, opts.root, { platform, since: opts.since }) : []), ...(opts.sampled ?? [])]
  for (const p of seen) from(p)
  // below it now (Windows: also below an ended Claude Code — its id stays the parent id of what it started), unless
  // its id is another process's by now
  if (!alive.has(opts.root)) for (const p of below(opts.now, opts.root, { platform, since: opts.since })) picked.add(p.pid)
  // what it marked, and (macOS / Linux) its own process group
  for (const pid of opts.marked ?? []) if (alive.has(pid)) picked.add(pid)
  if (platform !== 'win32') for (const p of opts.now) if (p.pgid === opts.root) picked.add(p.pid)
  for (const never of [0, 1, opts.root, opts.self ?? process.pid, opts.parent ?? process.ppid]) picked.delete(never)
  return [...picked].map((pid) => alive.get(pid)!).filter(Boolean)
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

/** Windows: how often the tree is read while Claude Code runs (ONE_WORKER_SAMPLE_MS: tests). */
const sampleMs = () => Number(process.env.ONE_WORKER_SAMPLE_MS) || 5000

/**
 * One Claude Code run's process tree: `sample()` (Windows: while it runs) and `atResult()` read it, `end()` (after
 * Claude Code ended) ends what it left behind and says what that was. Never throws.
 */
export class RunTree {
  private readonly since: number
  private readonly root: number
  private readonly token: string
  private readonly platform: NodeJS.Platform
  private before: Promise<Proc[] | null> | null = null
  /** processes seen below Claude Code while it ran (Windows), by id + start time */
  private readonly sampled = new Map<string, Proc>()
  private sampling: Promise<void> | null = null
  private lastSample = 0
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(root: number, token: string, platform: NodeJS.Platform = process.platform) {
    this.root = root
    this.token = token
    this.platform = platform
    // a little before the spawn: Windows' creation times and this clock may differ by a moment
    this.since = Date.now() - 2000
    // Windows: no environment mark to find an orphan by — the tree is read while it still hangs together
    if (platform === 'win32') {
      this.timer = setInterval(() => this.sample(), sampleMs())
      this.timer.unref?.()
    }
  }

  /** Windows: read the tree now (a tool's result came; the timer) — one read at a time, at most one a second. */
  sample(): void {
    if (this.platform !== 'win32' || this.before || this.sampling || Date.now() - this.lastSample < 1000) return
    this.lastSample = Date.now()
    this.sampling = listProcs(this.platform)
      .then((list) => {
        if (list) for (const p of below(list, this.root, { platform: this.platform, since: this.since })) if (this.sampled.size < 5000) this.sampled.set(`${p.pid}:${p.born ?? ''}`, p)
      })
      .catch(() => {})
      .finally(() => {
        this.sampling = null
      })
  }

  /** Read the tree now (Claude Code's result arrived — the shells it started may still run); no samples after it. */
  atResult(): void {
    this.stopSampling()
    this.before ??= listProcs(this.platform).catch(() => null)
  }

  private stopSampling() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** End what the run left running; the count and the program names (≤ 5, no folders). */
  async end(): Promise<{ n: number; names: string[] }> {
    this.stopSampling()
    try {
      await this.sampling
      const before = this.before ? await this.before : null
      const [now, marked] = await Promise.all([listProcs(this.platform), markedProcs(this.token, this.platform)])
      if (!now) return { n: 0, names: [] }
      const left = leftoversOf({ root: this.root, since: this.since, before, sampled: [...this.sampled.values()], now, marked, platform: this.platform })
      const group = this.platform !== 'win32' && now.some((p) => p.pgid === this.root)
      if (!left.length && !group) return { n: 0, names: [] }
      await endProcs(left, { root: this.root, group, platform: this.platform })
      const names = [...new Set(left.map((p) => shortName(p.name)).filter(Boolean))].slice(0, 5)
      return { n: left.length, names }
    } catch {
      return { n: 0, names: [] }
    }
  }
}
