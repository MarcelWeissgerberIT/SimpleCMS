/**
 * one-worker — Claude Code, headless: `claude -p --output-format stream-json --verbose --permission-mode …
 * --max-turns N [--model …] [--allowedTools …] [--disallowedTools …] [--max-budget-usd …] --mcp-config
 * <task tools> [--strict-mcp-config]` in the task's worktree. The prompt goes in on stdin (task text never
 * shows in the process list). Claude Code keeps its own permission rules: no flag that skips them is ever
 * passed. Stop kills the whole process tree.
 *
 * The CLI is `CLAUDE_BIN` or `claude` on PATH. What it supports is read from its --help once (the budget
 * flag, the permission mode names), so older and newer versions both work.
 */
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { LogLine, PermissionMode } from '../../../src/app/features/coding/protocol.ts'

export interface ClaudeCaps {
  found: boolean
  version: string | null
  /** --max-budget-usd is known */
  budget: boolean
  /** --permission-mode choices it lists ([] = unknown: pass ours as they are) */
  modes: string[]
}

export const claudeBin = (env: NodeJS.ProcessEnv = process.env) => (env.CLAUDE_BIN && env.CLAUDE_BIN.trim()) || 'claude'

function capture(bin: string, args: string[], timeoutMs = 15_000): Promise<{ code: number; out: string }> {
  return new Promise((done) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: { ...process.env, NO_COLOR: '1' } }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 127) : 0
      done({ code, out: `${stdout}\n${stderr}` })
    })
  })
}

/** What the installed CLI supports (never calls the API: --version and --help only). */
export async function detectClaude(bin = claudeBin()): Promise<ClaudeCaps> {
  const v = await capture(bin, ['--version'])
  if (v.code === 127 || (v.code !== 0 && !v.out.trim())) return { found: false, version: null, budget: false, modes: [] }
  const version = /(\d+\.\d+\.\d+[\w.-]*)/.exec(v.out)?.[1] ?? null
  const help = await capture(bin, ['--help'])
  const modeLine = /--permission-mode[\s\S]{0,400}?\(choices:([^)]*)\)/.exec(help.out)?.[1] ?? ''
  const modes = [...modeLine.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]!)
  return { found: true, version, budget: /--max-budget-usd/.test(help.out), modes }
}

/** Our mode name → the CLI's ('default' is called 'manual' by some versions). Never a bypassing mode. */
export function cliMode(mode: PermissionMode, caps: ClaudeCaps): string {
  if (!caps.modes.length || caps.modes.includes(mode)) return mode
  if (mode === 'default' && caps.modes.includes('manual')) return 'manual'
  return mode
}

export interface ClaudeRun {
  bin: string
  cwd: string
  prompt: string
  mode: PermissionMode
  maxTurns: number
  model: string | null
  allowedTools: string[]
  disallowedTools: string[]
  mcpConfig: string | null
  strictMcp: boolean
  /** $ this run may spend (null = no limit) */
  budgetUsd: number | null
  caps: ClaudeCaps
  env: NodeJS.ProcessEnv
  signal: AbortSignal
  onLog: (line: LogLine) => void
}

export interface ClaudeResult {
  ok: boolean
  stopped: boolean
  /** the closing text (result) */
  text: string
  /** plan mode: the plan Claude handed in (ExitPlanMode), else null */
  plan: string | null
  cost: number
  turns: number
  sessionId: string | null
  /** the result's subtype (success, error_max_turns, error_max_budget_usd, error_during_execution …) */
  subtype: string | null
  error?: string
}

/** The argv for a run (exported for the tests: no bypassing flag ever). */
export function claudeArgs(r: Omit<ClaudeRun, 'bin' | 'cwd' | 'prompt' | 'env' | 'signal' | 'onLog'>): string[] {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', cliMode(r.mode, r.caps), '--max-turns', String(r.maxTurns)]
  if (r.model) args.push('--model', r.model)
  if (r.allowedTools.length) args.push('--allowedTools', r.allowedTools.join(','))
  if (r.disallowedTools.length) args.push('--disallowedTools', r.disallowedTools.join(','))
  if (r.budgetUsd !== null && r.caps.budget) args.push('--max-budget-usd', r.budgetUsd.toFixed(2))
  if (r.mcpConfig) {
    args.push('--mcp-config', r.mcpConfig)
    if (r.strictMcp) args.push('--strict-mcp-config')
  }
  return args
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

/** "Edit src/a.ts" · "Bash npm test" · "Grep login" — a tool call as one log line. */
export function toolLine(name: string, input: unknown): string {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const pick = ['file_path', 'path', 'command', 'pattern', 'url', 'query', 'description'].map((k) => i[k]).find((v) => typeof v === 'string' && v.trim()) as string | undefined
  return clip(`${name}${pick ? ` ${oneLine(pick)}` : ''}`, 300)
}

/** Kill the process and everything it started. */
export function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return
  try {
    if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {})
    else process.kill(-child.pid, 'SIGTERM')
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
      if (process.platform !== 'win32') process.kill(-child.pid!, 'SIGKILL')
      else child.kill('SIGKILL')
    } catch {
      /* gone */
    }
  }, 3000)
  hard.unref()
}

/** 75_000 → "1:15" */
const clock = (ms: number) => {
  const sec = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

/** Run Claude Code once; streams log lines; resolves when it exits (or was stopped). */
export function runClaude(r: ClaudeRun): Promise<ClaudeResult> {
  return new Promise((done) => {
    const result: ClaudeResult = { ok: false, stopped: false, text: '', plan: null, cost: 0, turns: 0, sessionId: null, subtype: null }
    let child: ChildProcess
    try {
      child = spawn(r.bin, claudeArgs(r), { cwd: r.cwd, env: r.env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true })
    } catch (e) {
      done({ ...result, error: `Claude Code could not start: ${e instanceof Error ? e.message : String(e)}` })
      return
    }
    let stderr = ''
    let gotResult = false
    const log = (k: LogLine['k'], s: string) => r.onLog({ t: Date.now(), k, s })
    // a sign of life while Claude Code works quietly (reading, thinking): one line per quiet minute
    const started = Date.now()
    let heard = started
    const quietMs = Number(process.env.ONE_WORKER_QUIET_MS) || 60_000
    const beat = setInterval(() => {
      if (Date.now() - heard < quietMs) return
      log('info', `Claude Code is still working · ${clock(Date.now() - started)} so far · last output ${clock(Date.now() - heard)} ago`)
    }, quietMs)
    beat.unref()
    const onAbort = () => {
      result.stopped = true
      log('warn', 'Stopped — Claude Code was ended.')
      killTree(child)
    }
    if (r.signal.aborted) onAbort()
    r.signal.addEventListener('abort', onAbort, { once: true })
    child.on('error', (e) => {
      stderr += `\n${e.message}`
    })
    child.stdin?.on('error', () => {})
    child.stdin?.end(r.prompt)
    child.stderr?.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-4000)
    })
    const lines = createInterface({ input: child.stdout! })
    lines.on('line', (line) => {
      const s = line.trim()
      if (!s) return
      heard = Date.now()
      let ev: Record<string, unknown>
      try {
        ev = JSON.parse(s) as Record<string, unknown>
      } catch {
        log('info', clip(s, 500))
        return
      }
      if (typeof ev.session_id === 'string') result.sessionId = ev.session_id
      switch (ev.type) {
        case 'system':
          if (ev.subtype === 'init') log('info', `Claude Code started · ${String(ev.permissionMode ?? r.mode)} mode${result.sessionId ? ` · session ${result.sessionId.slice(0, 8)}` : ''}`)
          return
        case 'assistant': {
          const content = ((ev.message as { content?: unknown })?.content ?? []) as Array<Record<string, unknown>>
          for (const block of Array.isArray(content) ? content : []) {
            if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) log('claude', clip(block.text.trim(), 4000))
            else if (block.type === 'tool_use' && typeof block.name === 'string') {
              log('tool', toolLine(block.name, block.input))
              const input = block.input as { plan?: unknown } | undefined
              if (block.name === 'ExitPlanMode' && typeof input?.plan === 'string') result.plan = input.plan
            }
          }
          return
        }
        case 'user': {
          const content = ((ev.message as { content?: unknown })?.content ?? []) as Array<Record<string, unknown>>
          for (const block of Array.isArray(content) ? content : []) {
            if (block.type !== 'tool_result' || block.is_error !== true) continue
            const text = typeof block.content === 'string' ? block.content : Array.isArray(block.content) ? (block.content as Array<{ text?: string }>).map((c) => c.text ?? '').join(' ') : ''
            log('warn', clip(`tool error: ${oneLine(text)}`, 500))
          }
          return
        }
        case 'result': {
          gotResult = true
          result.subtype = typeof ev.subtype === 'string' ? ev.subtype : null
          result.cost = typeof ev.total_cost_usd === 'number' && Number.isFinite(ev.total_cost_usd) ? ev.total_cost_usd : 0
          result.turns = typeof ev.num_turns === 'number' ? ev.num_turns : 0
          result.text = typeof ev.result === 'string' ? ev.result : ''
          result.ok = ev.is_error !== true && result.subtype === 'success'
          if (!result.ok) result.error = result.subtype === 'error_max_turns' ? `Claude Code stopped after ${result.turns} turns (the stage's limit)` : /budget/i.test(result.subtype ?? '') ? 'Claude Code stopped at the cost limit' : result.text || `Claude Code ended with ${result.subtype ?? 'an error'}`
          log(result.ok ? 'info' : 'warn', `Claude Code finished · ${result.turns} turns · $${result.cost.toFixed(2)}${result.ok ? '' : ` · ${result.subtype ?? 'error'}`}`)
          return
        }
      }
    })
    child.on('close', (code) => {
      clearInterval(beat)
      r.signal.removeEventListener('abort', onAbort)
      if (!gotResult && !result.stopped) {
        result.ok = false
        result.error = code === null ? 'Claude Code was ended' : `Claude Code exited with code ${code}${stderr.trim() ? `: ${clip(oneLine(stderr.trim().split('\n').slice(-3).join(' ')), 400)}` : ''}`
        if (/ENOENT|not found/i.test(stderr)) result.error = `Claude Code was not found ("${r.bin}"). Install it (npm i -g @anthropic-ai/claude-code) or set CLAUDE_BIN.`
      }
      done(result)
    })
  })
}
