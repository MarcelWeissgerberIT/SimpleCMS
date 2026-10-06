/**
 * one-worker — the Test stage: the repo's testCommand (an argv list from worker.json, never a shell line)
 * in the task's worktree, with a timeout; the output's tail goes to One (paths of this machine replaced).
 */
import { spawn } from 'node:child_process'
import type { TestResult } from '../../../src/app/features/coding/protocol.ts'
import type { RepoConfig } from './config.ts'
import { killTree } from './claude.ts'

/** What of the output One gets (the tail: failures are usually at the end). */
export const TEST_OUTPUT_MAX = 64_000

export function runTests(repo: RepoConfig, cwd: string, signal: AbortSignal, onLine?: (s: string) => void): Promise<TestResult> {
  const argv = repo.testCommand
  if (!argv?.length) return Promise.resolve({ ok: true, output: '', ms: 0, code: null, skipped: true })
  const started = Date.now()
  return new Promise((done) => {
    let out = ''
    let timedOut = false
    const child = spawn(argv[0]!, argv.slice(1), { cwd, env: { ...process.env, CI: process.env.CI ?? '1', FORCE_COLOR: '0', NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true, shell: false })
    const add = (d: Buffer) => {
      const s = d.toString()
      out = (out + s).slice(-TEST_OUTPUT_MAX * 2)
      if (onLine) for (const line of s.split('\n')) if (line.trim()) onLine(line.slice(0, 500))
    }
    child.stdout?.on('data', add)
    child.stderr?.on('data', add)
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, repo.testTimeoutSec * 1000)
    const onAbort = () => killTree(child)
    signal.addEventListener('abort', onAbort, { once: true })
    child.on('error', (e) => {
      out += `\n${e.message}`
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      // strip ANSI colours, keep the tail
      let output = out.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
      if (output.length > TEST_OUTPUT_MAX) output = `…\n${output.slice(-TEST_OUTPUT_MAX)}`
      if (timedOut) output += `\n[one-worker] the tests ran longer than ${repo.testTimeoutSec} s and were stopped`
      done({ ok: code === 0 && !timedOut && !signal.aborted, output, ms: Date.now() - started, code })
    })
  })
}
