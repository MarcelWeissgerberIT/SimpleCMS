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

export function runTests(repo: RepoConfig, cwd: string, signal: AbortSignal, onLine?: (s: string) => void): Promise<RunResult> {
  return runCommand(repo.testCommand, repo.testTimeoutSec, 'tests', cwd, signal, onLine)
}

/** The Static analysis stage: the repo's analyzeCommand, like the tests (a non-zero exit is a finding, not a failure). */
export function runAnalysis(repo: RepoConfig, cwd: string, signal: AbortSignal, onLine?: (s: string) => void): Promise<RunResult> {
  return runCommand(repo.analyzeCommand, repo.analyzeTimeoutSec, 'analysis', cwd, signal, onLine)
}

const notStarted = (why: 'missing' | 'refused'): RunResult => ({ ok: false, output: '', ms: 0, code: -1, notStarted: why })

function runCommand(argv: string[] | null, timeoutSec: number, what: string, cwd: string, signal: AbortSignal, onLine?: (s: string) => void): Promise<RunResult> {
  if (!argv?.length) return Promise.resolve({ ok: true, output: '', ms: 0, code: null, skipped: true })
  const started = Date.now()
  const env = { ...process.env, CI: process.env.CI ?? '1', FORCE_COLOR: '0', NO_COLOR: '1' }
  // the person's own command: a .cmd / .bat the reader cannot read may run through cmd.exe (escaped)
  const s = spawnSafe(argv[0]!, argv.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true, allow: 'person' })
  if (!s.ok) return Promise.resolve(s.why === 'failed' ? { ok: false, output: s.error, ms: 0, code: -1 } : notStarted(s.why))
  const child = s.child
  return new Promise((done) => {
    let out = ''
    let timedOut = false
    let missing = false
    let settled = false
    // live lines are whole lines: a path cut between two pieces of output would pass the scrubber in halves
    const partial = { out: '', err: '' }
    const line = (l: string) => {
      if (onLine && l.trim()) onLine(l.slice(0, 500))
    }
    const add = (which: 'out' | 'err') => (text: string) => {
      out = (out + text).slice(-TEST_OUTPUT_MAX * 2)
      const lines = (partial[which] + text).split(/\r?\n/)
      partial[which] = lines.pop() ?? ''
      // a line without an end that keeps growing still goes out (its first 500 characters, as every live line)
      if (partial[which].length > 4000) {
        line(partial[which])
        partial[which] = ''
      }
      for (const l of lines) line(l)
    }
    // text, decoded across pieces: a character split between two pieces stays whole (else "ü" arrives as two U+FFFD)
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', add('out'))
    child.stderr?.on('data', add('err'))
    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      line(partial.out)
      line(partial.err)
      partial.out = partial.err = ''
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      if (missing) return done(notStarted('missing'))
      // strip ANSI colours, keep the tail
      let output = out.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
      if (output.length > TEST_OUTPUT_MAX) output = `…\n${output.slice(-TEST_OUTPUT_MAX)}`
      if (timedOut) output += `\n[one-worker] the ${what} ran longer than ${timeoutSec} s and were stopped`
      done({ ok: code === 0 && !timedOut && !signal.aborted, output, ms: Date.now() - started, code })
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
      else out += `\n${commandName(argv[0]!)} could not start (${(e as NodeJS.ErrnoException).code ?? e.name})`
    })
    child.on('close', (code) => finish(code))
  })
}
