/**
 * one-worker — the Test stage: the repo's testCommand (an argv list from worker.json, never a shell line)
 * in the task's worktree, with a timeout; the output's tail goes to One (paths of this machine replaced).
 * The program is looked up in PATH only — never in the worktree (exec.ts); one inside the repo needs its path.
 */
import type { TestResult } from '../../../src/app/features/coding/protocol.ts'
import type { RepoConfig } from './config.ts'
import { commandName, killTree, spawnSafe } from './exec.ts'

/** What of the output One gets (the tail: failures are usually at the end). */
export const TEST_OUTPUT_MAX = 64_000

/** notStarted: the program was not found (PATH only) or cannot run (a .cmd cmd.exe cannot pass the arguments to) — ok false, output '', ms 0, code -1 */
export type RunResult = TestResult & { notStarted?: 'missing' | 'refused' }

export function runTests(repo: RepoConfig, cwd: string, signal: AbortSignal, onLine?: (s: string) => void, scrub?: (s: string) => string): Promise<RunResult> {
  return runCommand(repo.testCommand, repo.testTimeoutSec, 'tests', cwd, signal, onLine, scrub)
}

/** The Static analysis stage: the repo's analyzeCommand, like the tests (a non-zero exit is a finding, not a failure). */
export function runAnalysis(repo: RepoConfig, cwd: string, signal: AbortSignal, onLine?: (s: string) => void, scrub?: (s: string) => string): Promise<RunResult> {
  return runCommand(repo.analyzeCommand, repo.analyzeTimeoutSec, 'analysis', cwd, signal, onLine, scrub)
}

const notStarted = (why: 'missing' | 'refused'): RunResult => ({ ok: false, output: '', ms: 0, code: -1, notStarted: why })

/** A line longer than this (no line break yet): its head is kept, the rest up to the next break dropped. */
export const LONG_LINE = 4000
/** What of a live line goes out. */
export const LIVE_LINE = 500
/** A path cut where a long line is cut can be this long: that much of the scrubbed head's end is never sent. */
const PATH_ROOM = 1024
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g
/** Line breaks as programs write them — a bare "\r" too (progress bars). */
const BREAK = /\r\n|\r|\n/

/**
 * The first `n` characters of a line cut at LONG_LINE, scrubbed: whatever lies within PATH_ROOM of the cut is left out,
 * so a path the cut split in two never goes out as a half no rule can match.
 */
export function safeHead(raw: string, scrub: (s: string) => string, n: number): string {
  const s = scrub(raw)
  return s.slice(0, Math.max(0, Math.min(n, s.length - PATH_ROOM)))
}

/**
 * Live lines and the output's tail, scrubbed BEFORE anything is cut (a path cut in two would pass the scrubber in
 * halves): every line whole, split at \r\n, \r and \n, its colours stripped, scrubbed, then cut to LIVE_LINE for the
 * live log. A line that grows past LONG_LINE without a break: its head goes out once (safeHead), the rest up to its
 * next break is dropped. The tail One gets starts at a line.
 */
export class OutputLines {
  private out = ''
  private partial: Record<'out' | 'err', string> = { out: '', err: '' }
  private skipping: Record<'out' | 'err', number | null> = { out: null, err: null }

  private readonly scrub: (s: string) => string
  private readonly onLine?: (s: string) => void
  private readonly max: number

  constructor(scrub: (s: string) => string = (s) => s, onLine?: (s: string) => void, max = TEST_OUTPUT_MAX) {
    this.scrub = scrub
    this.onLine = onLine
    this.max = max
  }

  /** A piece of a stream's text (decoded). */
  add(which: 'out' | 'err', text: string): void {
    let rest = text
    if (this.skipping[which] !== null) {
      const at = rest.search(BREAK)
      const dropped = this.skipping[which] ?? 0
      if (at < 0) {
        this.skipping[which] = dropped + rest.length
        return
      }
      this.endLong(which, dropped + at)
      rest = rest.slice(at + (rest.startsWith('\r\n', at) ? 2 : 1))
    }
    let buf = this.partial[which] + rest
    // a "\r" at the end may be the first half of "\r\n": it waits for the next piece
    const held = buf.endsWith('\r') ? '\r' : ''
    if (held) buf = buf.slice(0, -1)
    const lines = buf.split(BREAK)
    let last = lines.pop() ?? ''
    for (const l of lines) this.whole(l)
    if (last.length > LONG_LINE) {
      const head = last.slice(0, LONG_LINE)
      this.long(head)
      this.skipping[which] = last.length - LONG_LINE + held.length
      last = ''
      this.partial[which] = ''
      return
    }
    this.partial[which] = last + held
  }

  /** The stream ended: what is left of it is a line. */
  flush(): void {
    for (const which of ['out', 'err'] as const) {
      const dropped = this.skipping[which]
      if (dropped !== null) this.endLong(which, dropped)
      const rest = this.partial[which].replace(/\r$/, '')
      this.partial[which] = ''
      if (rest) this.whole(rest)
    }
  }

  /** What One gets: the tail, starting at a line ("…" first when lines were left out). */
  output(): string {
    if (this.out.length <= this.max) return this.out.replace(/\n$/, '')
    const from = this.out.indexOf('\n', this.out.length - this.max)
    return `…\n${this.out.slice(from + 1).replace(/\n$/, '')}`
  }

  /** text added at the end of the output (scrubbed) */
  note(text: string): void {
    this.keep(this.scrub(text))
  }

  /** A whole line: scrubbed as a whole first, then cut (a long one that came in one piece too). */
  private whole(raw: string): void {
    const line = this.scrub(raw.replace(ANSI, ''))
    if (this.onLine && line.trim()) this.onLine(line.slice(0, LIVE_LINE))
    this.keep(line.length > LONG_LINE ? `${line.slice(0, LONG_LINE)} … [one-worker] ${line.length - LONG_LINE} more characters of that line left out` : line)
  }

  private long(head: string): void {
    const clean = head.replace(ANSI, '')
    const live = safeHead(clean, this.scrub, LIVE_LINE)
    if (this.onLine && live.trim()) this.onLine(`${live} …`)
    this.keep(`${safeHead(clean, this.scrub, LONG_LINE)} …`)
  }

  private endLong(which: 'out' | 'err', dropped: number): void {
    this.skipping[which] = null
    this.keep(`[one-worker] ${dropped} more characters of that line left out`)
  }

  private keep(line: string): void {
    this.out += `${line}\n`
    // bounded, cut at a line (every kept line is scrubbed already)
    if (this.out.length > this.max * 2) {
      const from = this.out.indexOf('\n', this.out.length - this.max * 2)
      this.out = this.out.slice(from + 1)
    }
  }
}

function runCommand(argv: string[] | null, timeoutSec: number, what: string, cwd: string, signal: AbortSignal, onLine?: (s: string) => void, scrub?: (s: string) => string): Promise<RunResult> {
  if (!argv?.length) return Promise.resolve({ ok: true, output: '', ms: 0, code: null, skipped: true })
  const started = Date.now()
  const env = { ...process.env, CI: process.env.CI ?? '1', FORCE_COLOR: '0', NO_COLOR: '1' }
  // the person's own command: a .cmd / .bat the reader cannot read may run through cmd.exe (escaped); its environment
  // as it is (no NoDefaultCurrentDirectoryInExePath: its scripts may call a program in their folder by its bare name)
  const s = spawnSafe(argv[0]!, argv.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true, allow: 'person' })
  if (!s.ok) return Promise.resolve(s.why === 'failed' ? { ok: false, output: s.error, ms: 0, code: -1 } : notStarted(s.why))
  const child = s.child
  return new Promise((done) => {
    const lines = new OutputLines(scrub, onLine)
    let timedOut = false
    let missing = false
    let settled = false
    // text, decoded across pieces: a character split between two pieces stays whole (else "ü" arrives as two U+FFFD)
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (t: string) => lines.add('out', t))
    child.stderr?.on('data', (t: string) => lines.add('err', t))
    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      lines.flush()
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      if (missing) return done(notStarted('missing'))
      if (timedOut) lines.note(`[one-worker] the ${what} ran longer than ${timeoutSec} s and were stopped`)
      done({ ok: code === 0 && !timedOut && !signal.aborted, output: lines.output(), ms: Date.now() - started, code })
    }
    const timer = setTimeout(() => {
      timedOut = true
      // the whole tree first (Windows: taskkill /T), then the result
      void killTree(child).then(() => finish(child.exitCode))
    }, timeoutSec * 1000)
    const onAbort = () => void killTree(child)
    signal.addEventListener('abort', onAbort, { once: true })
    child.on('error', (e) => {
      // macOS / Linux look the program up when it starts: not found arrives here
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') missing = true
      else lines.note(`${commandName(argv[0]!)} could not start (${(e as NodeJS.ErrnoException).code ?? e.name})`)
    })
    child.on('close', (code) => finish(code))
  })
}
