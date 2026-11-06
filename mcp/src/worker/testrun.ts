/**
 * one-worker — the Test stage: the repo's testCommand (an argv list from worker.json, never a shell line)
 * in the task's worktree, with a timeout; the output's tail goes to One (paths of this machine replaced).
 * The program is looked up in PATH only — never in the worktree (exec.ts); one inside the repo needs its path.
 */
import { git } from './git.ts'
import type { TestResult } from '../../../src/app/features/coding/protocol.ts'
import type { RepoConfig } from './config.ts'
import { commandName, killTree, spawnSafe } from './exec.ts'
import { candidateSnapshot } from './candidate.ts'
declare const __VERSION__: string
const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev'

/** What of the output One gets (the tail: failures are usually at the end). */
export const TEST_OUTPUT_MAX = 64_000

/** notStarted: the program was not found (PATH only) or cannot run (a .cmd cmd.exe cannot pass the arguments to) — ok false, output '', ms 0, code -1 */
export type RunResult = TestResult & { notStarted?: 'missing' | 'refused' }

export async function runTests(repo: RepoConfig, cwd: string, signal: AbortSignal, onLine?: (s: string) => void, scrub?: (s: string) => string): Promise<RunResult> {
  if(!repo.testCommand?.length)return runCommand(repo.testCommand,repo.testTimeoutSec,'tests',cwd,signal,onLine,scrub)
  signal.throwIfAborted()
  const before=await git(cwd,['rev-parse','HEAD'],5000,{local:true})
  const state=await git(cwd,['status','--porcelain'],5000,{local:true})
  const candidateBefore=await candidateSnapshot(cwd,signal)
  const startedAt=Date.now(),result=await runCommand(repo.testCommand,repo.testTimeoutSec,'tests',cwd,signal,onLine,scrub),finishedAt=Date.now()
  if(result.notStarted||signal.aborted)return result
  const after=await git(cwd,['rev-parse','HEAD'],5000,{local:true})
  const afterState=await git(cwd,['status','--porcelain'],5000,{local:true})
  const candidateAfter=await candidateSnapshot(cwd,signal)
  const commit=before.code===0&&/^[a-f0-9]{40,64}$/.test(before.stdout.trim())?before.stdout.trim():null
  return {...result,execution:{command:repo.testCommand.map((x,i)=>(i===0?commandName(x):scrub?scrub(x):x).slice(0,1000)).slice(0,50),commit,dirty:state.code!==0||!!state.stdout.trim(),changedDuring:before.stdout!==after.stdout||state.stdout!==afterState.stdout||!!candidateBefore.hash&&!!candidateAfter.hash&&candidateBefore.hash!==candidateAfter.hash,platform:process.platform,startedAt,finishedAt,candidate:{schema:1,before:candidateBefore.hash,after:candidateAfter.hash,files:candidateAfter.files,node:process.version,worker:VERSION}}}
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
  /** the last piece ended with a bare "\r" (its line is done): a "\n" first in the next piece is its other half */
  private cr: Record<'out' | 'err', boolean> = { out: false, err: false }

  private readonly scrub: (s: string) => string
  private readonly onLine?: (s: string) => void
  private readonly max: number

  constructor(scrub: (s: string) => string = (s) => s, onLine?: (s: string) => void, max = TEST_OUTPUT_MAX) {
    this.scrub = scrub
    this.onLine = onLine
    this.max = max
  }

  /**
   * A piece of a stream's text (decoded). A "\r" at a piece's end ends its line at once (bare or the first half of
   * "\r\n": either way a break) — a "\n" starting the next piece is then its other half, not an empty line.
   */
  add(which: 'out' | 'err', text: string): void {
    let rest = text
    if (this.cr[which]) {
      this.cr[which] = false
      if (rest.startsWith('\n')) rest = rest.slice(1)
    }
    if (this.skipping[which] !== null) {
      const at = rest.search(BREAK)
      const dropped = this.skipping[which] ?? 0
      if (at < 0) {
        this.skipping[which] = dropped + rest.length
        return
      }
      this.endLong(which, dropped + at)
      const two = rest.startsWith('\r\n', at)
      if (!two && rest[at] === '\r' && at === rest.length - 1) this.cr[which] = true
      rest = rest.slice(at + (two ? 2 : 1))
    }
    let buf = this.partial[which] + rest
    // a "\r" at the end ends the line before it now (the next piece's "\n" belongs to it: cr)
    const ended = buf.endsWith('\r')
    if (ended) {
      buf = buf.slice(0, -1)
      this.cr[which] = true
    }
    const lines = buf.split(BREAK)
    const last = ended ? '' : (lines.pop() ?? '')
    for (const l of lines) this.whole(l)
    if (last.length > LONG_LINE) {
      this.long(last.slice(0, LONG_LINE))
      this.skipping[which] = last.length - LONG_LINE
      this.partial[which] = ''
      return
    }
    this.partial[which] = last
  }

  /** The stream ended: what is left of it is a line. */
  flush(): void {
    for (const which of ['out', 'err'] as const) {
      const dropped = this.skipping[which]
      if (dropped !== null) this.endLong(which, dropped)
      const rest = this.partial[which]
      this.partial[which] = ''
      this.cr[which] = false
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
  const env: NodeJS.ProcessEnv = { ...process.env, CI: process.env.CI ?? '1', FORCE_COLOR: '0', NO_COLOR: '1' }
  delete env.OLLAMA_API_KEY
  delete env.MINIMAX_API_KEY
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
