/**
 * one-worker — Claude Code, headless: `claude -p --output-format stream-json --verbose --permission-mode …
 * --max-turns N [--model …] [--allowedTools …] [--disallowedTools …] [--max-budget-usd …] [--setting-sources user]
 * --mcp-config <task tools> [--strict-mcp-config]` in the task's worktree. The prompt goes in on stdin (task text
 * never shows in the process list). Claude Code keeps its own permission rules: no flag that skips them is ever
 * passed. Stop kills the whole process tree.
 *
 * The CLI is `CLAUDE_BIN` or `claude` on PATH — Windows: claude.exe, or the script behind npm's claude.cmd (never
 * through cmd.exe, never from the worktree; exec.ts), else the native installer's one off PATH (findClaude). What it
 * supports is read from its --help (the budget
 * flag, the permission mode names, --setting-sources), so older and newer versions both work.
 */
import type { ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { EDIT_CHARS, EDIT_HUNKS, type LogLine, type PermissionMode, type TaskProgress, type ToolEdit } from '../../../src/app/features/coding/protocol.ts'
import { inFolder } from './config.ts'
import { envGet, execFileSafe, isFile, killTree, resolveCommand, spawnSafe, type ExecCtx, type Via } from './exec.ts'
import { samePath } from './paths.ts'
import { estimateCost, usageOf, type Usage } from './price.ts'

export { killTree } from './exec.ts'

export interface ClaudeCaps {
  found: boolean
  version: string | null
  /** --max-budget-usd is known */
  budget: boolean
  /** --permission-mode choices it lists ([] = unknown: pass ours as they are) */
  modes: string[]
  /** --setting-sources is known (a repo's own settings can be left out) */
  settingSources: boolean
  /** Windows: the file that runs (`check` prints it — never sent) */
  path?: string
  /** Windows: how it starts (an .exe, or a script behind npm's shim) */
  via?: Via
  /** not found — or a .cmd / .bat the worker cannot read (it never starts Claude Code through cmd.exe) */
  missing?: 'not-found' | 'cmd-refused'
}

/** The CLI the worker runs, and where it was found (env: CLAUDE_BIN · path: `claude` by its name · native: below). */
export interface ClaudeBin {
  bin: string
  from: 'env' | 'path' | 'native'
}

/**
 * The Claude Code CLI — the same file for `check`, the start and every stage:
 *  - CLAUDE_BIN, one pair of quotes off (cmd's `set CLAUDE_BIN="C:\…\claude.exe"` and the Windows dialog keep them); a
 *    path with a folder (`.\tools\claude.exe`, `./claude`, `~/…`) is resolved ONCE, against the folder the worker starts
 *    in — never later against a task's worktree, where a repository could ship a file of that name
 *  - else `claude` by its name (PATH)
 *  - else, Windows: the native installer's %USERPROFILE%\.local\bin\claude.exe while PATH does not name it (the
 *    installer only prints a note about that) — `check` and the start say so
 */
export function findClaude(env: NodeJS.ProcessEnv = process.env, opts: { platform?: NodeJS.Platform; cwd?: string; home?: string; exists?: (p: string) => boolean } = {}): ClaudeBin {
  const platform = opts.platform ?? process.platform
  const P = platform === 'win32' ? win32 : posix
  const home = opts.home ?? homedir()
  const raw = (envGet(env, 'CLAUDE_BIN', platform) ?? '').trim()
  const set = (/^"(.+)"$/s.exec(raw)?.[1] ?? /^'(.+)'$/s.exec(raw)?.[1] ?? raw).trim()
  if (set) {
    if (set === '~' || /^~[\\/]/.test(set)) return { bin: P.join(home, set.slice(2)), from: 'env' }
    const withFolder = /[\\/]/.test(set) || (platform === 'win32' && /^[A-Za-z]:/.test(set))
    return { bin: withFolder ? P.resolve(opts.cwd ?? process.cwd(), set) : set, from: 'env' }
  }
  if (platform === 'win32' && !resolveCommand('claude', [], { platform, env, ...(opts.exists ? { exists: opts.exists } : {}) }, 'shim').ok) {
    const native = win32.join(home, '.local', 'bin', 'claude.exe')
    if ((opts.exists ?? isFile)(native)) return { bin: native, from: 'native' }
  }
  return { bin: 'claude', from: 'path' }
}

export const claudeBin = (env: NodeJS.ProcessEnv = process.env): string => findClaude(env).bin

/** The terminal's line for Claude Code found only in its native installer's folder (Windows; never sent). */
export const NATIVE_NOT_ON_PATH = 'claude.exe is in %USERPROFILE%\\.local\\bin, which is not on PATH — the worker uses it; to run `claude` yourself, add that folder to your user PATH (then open a new terminal), or set CLAUDE_BIN'

/** How to get Claude Code on this kind of computer (terminal lines). */
export function claudeInstallHint(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32')
    return 'Install Claude Code (native installer in PowerShell: irm https://claude.ai/install.ps1 | iex · or npm i -g @anthropic-ai/claude-code; it needs Git for Windows) and sign in once with `claude` — or set CLAUDE_BIN to claude.exe or its cli.js'
  return 'Install Claude Code (native installer: curl -fsSL https://claude.ai/install.sh | bash · or npm i -g @anthropic-ai/claude-code) and sign in once with `claude` — or set CLAUDE_BIN to its program'
}

/** The stage error when Claude Code cannot start (English, as every stage error; never the path it was looked for at). */
export function claudeMissingError(missing: ClaudeCaps['missing']): string {
  return missing === 'cmd-refused'
    ? 'Claude Code is installed as a .cmd / .bat file the worker cannot read — install it with its native installer, or set CLAUDE_BIN to claude.exe or its cli.js.'
    : 'Claude Code was not found on this computer. Install it and sign in, or set CLAUDE_BIN.'
}

/**
 * Windows: the Git Bash Claude Code needs — CLAUDE_CODE_GIT_BASH_PATH, else bin\bash.exe of the Git for Windows whose
 * git.exe PATH names (…\Git\cmd, …\Git\bin or …\Git\mingw64\bin). `check` prints it.
 */
export function gitBash(env: NodeJS.ProcessEnv = process.env, ctx?: Partial<ExecCtx>): { path: string | null; from: 'env' | 'git' | null } {
  const exists = ctx?.exists ?? isFile
  const set = envGet(env, 'CLAUDE_CODE_GIT_BASH_PATH', 'win32')?.trim()
  if (set) return { path: exists(set) ? set : null, from: 'env' }
  const git = resolveCommand('git', [], { ...ctx, platform: 'win32', env }, 'exe')
  if (!git.ok) return { path: null, from: null }
  const dir = win32.dirname(git.file)
  const up = win32.dirname(dir)
  const roots = [up, ...(/^(mingw64|mingw32|clangarm64)$/i.test(win32.basename(up)) ? [win32.dirname(up)] : [])]
  for (const root of roots) {
    const bash = win32.join(root, 'bin', 'bash.exe')
    if (exists(bash)) return { path: bash, from: 'git' }
  }
  return { path: null, from: 'git' }
}

function capture(bin: string, args: string[], ctx?: Partial<ExecCtx>, timeoutMs = 15_000): Promise<{ code: number; out: string; why?: string }> {
  return execFileSafe(bin, args, { timeoutMs, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' }, allow: 'shim', ctx }).then((r) => ({ code: r.code, out: `${r.stdout}\n${r.stderr}`, why: r.why }))
}

/** What the installed CLI supports (never calls the API: --version and --help only). Never rejects. */
export async function detectClaude(bin = claudeBin(), ctx?: Partial<ExecCtx>): Promise<ClaudeCaps> {
  const none = (missing: ClaudeCaps['missing']): ClaudeCaps => ({ found: false, version: null, budget: false, modes: [], settingSources: false, missing })
  try {
    const platform = ctx?.platform ?? process.platform
    const r = resolveCommand(bin, ['--version'], { ...ctx, env: { ...process.env, NO_COLOR: '1' } }, 'shim')
    if (!r.ok) return none(r.why === 'refused' ? 'cmd-refused' : 'not-found')
    // Windows only: what runs (macOS / Linux look it up themselves)
    const where: Pick<ClaudeCaps, 'path' | 'via'> = platform === 'win32' ? { path: r.via === 'node-shim' ? r.args[r.args.length - 2] : r.file, via: r.via } : {}
    const v = await capture(bin, ['--version'], ctx)
    if (v.code === 127 || (v.code !== 0 && !v.out.trim())) return none(v.why === 'refused' ? 'cmd-refused' : 'not-found')
    const version = /(\d+\.\d+\.\d+[\w.-]*)/.exec(v.out)?.[1] ?? null
    const help = await capture(bin, ['--help'], ctx)
    const modeLine = /--permission-mode[\s\S]{0,400}?\(choices:([^)]*)\)/.exec(help.out)?.[1] ?? ''
    const modes = [...modeLine.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]!)
    return { found: true, version, budget: /--max-budget-usd/.test(help.out), modes, settingSources: /--setting-sources/.test(help.out), ...where }
  } catch {
    return none('not-found')
  }
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
  /** the repo's own Claude Code settings may load (false: `--setting-sources user`, config.ts projectSettings) */
  projectSettings: boolean
  /** $ this run may spend (null = no limit) */
  budgetUsd: number | null
  caps: ClaudeCaps
  env: NodeJS.ProcessEnv
  signal: AbortSignal
  onLog: (line: LogLine) => void
  /** after every turn: turns so far, the limit, a cost estimate */
  onProgress?: (p: TaskProgress) => void
}

/** Claude Code's own sign-in is gone (expired login, no API key): the person fixes it with `claude` → /login. */
const SIGNED_OUT = /Failed to authenticate|OAuth (session|token)[^.]*(expired|invalid|revoked)|Invalid API key|authentication_error|Please run \/login|not logged in|Not authenticated/i
export const AUTH_HINT = 'Claude Code is not signed in on this computer (its login expired). In a terminal: run `claude`, type /login and sign in, then press Retry in One — the worker uses the same login.'

export interface ClaudeResult {
  ok: boolean
  stopped: boolean
  /** the closing text (result) */
  text: string
  /**
   * plan mode: the plan Claude handed in (ExitPlanMode) — else the plan file it wrote (newer Claude Code versions
   * write ~/.claude/plans/<name>.md and may have ExitPlanMode switched off in headless runs) — else null
   */
  plan: string | null
  cost: number
  turns: number
  sessionId: string | null
  /** the result's subtype (success, error_max_turns, error_max_budget_usd, error_during_execution …) */
  subtype: string | null
  error?: string
}

/** Claude Code's own plan files (plan mode writes the plan there). */
const PLAN_FILE = /[\\/]\.claude[\\/]plans[\\/][^\\/]+\.md$/

/** A plan file's text — only inside ~/.claude/plans (no link out of it), ≤ 200 KB; null when it cannot be read. */
export function readPlanFile(path: string, home = homedir()): string | null {
  try {
    const dir = realpathSync(join(home, '.claude', 'plans'))
    const real = realpathSync(path.startsWith('~/') || path.startsWith('~\\') ? join(home, path.slice(2)) : path)
    // inside the plans folder (without case where the disk ignores it), never the folder itself
    if (!inFolder(real, dir) || samePath(real, dir) || !/\.md$/i.test(real)) return null
    if (statSync(real).size > 200 * 1024) return null
    const text = readFileSync(real, 'utf8').trim()
    return text || null
  } catch {
    return null
  }
}

/** The argv for a run (exported for the tests: no bypassing flag ever). */
export function claudeArgs(r: Omit<ClaudeRun, 'bin' | 'cwd' | 'prompt' | 'env' | 'signal' | 'onLog' | 'onProgress'>): string[] {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', cliMode(r.mode, r.caps), '--max-turns', String(r.maxTurns)]
  if (r.model) args.push('--model', r.model)
  if (r.allowedTools.length) args.push('--allowedTools', r.allowedTools.join(','))
  if (r.disallowedTools.length) args.push('--disallowedTools', r.disallowedTools.join(','))
  if (r.budgetUsd !== null && r.caps.budget) args.push('--max-budget-usd', r.budgetUsd.toFixed(2))
  // the person's own settings only: the repo's hooks, apiKeyHelper, MCP approvals, .mcp.json and CLAUDE.md stay out
  if (!r.projectSettings && r.caps.settingSources) args.push('--setting-sources', 'user')
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

/** What an Edit / MultiEdit / Write tool call changes (null for other tools) — clipped for the log. */
export function editOf(name: string, input: unknown): ToolEdit | null {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const path = typeof i.file_path === 'string' ? i.file_path : ''
  if (!path) return null
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  let raw: Array<{ old: string; new: string }>
  if (name === 'Edit') raw = [{ old: str(i.old_string), new: str(i.new_string) }]
  else if (name === 'MultiEdit') raw = (Array.isArray(i.edits) ? i.edits : []).map((e) => ({ old: str((e as Record<string, unknown>)?.old_string), new: str((e as Record<string, unknown>)?.new_string) }))
  else if (name === 'Write') raw = [{ old: '', new: str(i.content) }]
  else return null
  raw = raw.filter((h) => h.old || h.new)
  if (!raw.length) return null
  let clipped = raw.length > EDIT_HUNKS
  const cut = (s: string) => {
    if (s.length <= EDIT_CHARS) return s
    clipped = true
    // whole lines only
    const at = s.lastIndexOf('\n', EDIT_CHARS)
    return s.slice(0, at > 0 ? at : EDIT_CHARS)
  }
  const hunks = raw.slice(0, EDIT_HUNKS).map((h) => ({ old: cut(h.old), new: cut(h.new) }))
  return { path, hunks, ...(clipped ? { clipped: true } : {}) }
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
    // an .exe or a script behind npm's shim — never through cmd.exe, never from the worktree (exec.ts)
    const spawned = spawnSafe(r.bin, claudeArgs(r), { cwd: r.cwd, env: r.env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true, allow: 'shim' })
    if (!spawned.ok) {
      done({ ...result, error: spawned.why === 'failed' ? `Claude Code could not start: ${spawned.error}` : claudeMissingError(spawned.why === 'refused' ? 'cmd-refused' : 'not-found') })
      return
    }
    const child: ChildProcess = spawned.child
    let stderr = ''
    let gotResult = false
    const log = (k: LogLine['k'], s: string, c?: string, v?: LogLine['v']) => r.onLog({ t: Date.now(), k, s, ...(c ? { c, v } : {}) })
    // progress: one turn per assistant message (by id), the token counts of each for the estimate
    let model: string | null = null
    let turns = 0
    let unnamed = 0
    // the plan file Claude Code wrote in plan mode (its last one)
    let planFile: string | null = null
    const usages = new Map<string, Usage>()
    const progress = () => r.onProgress?.({ turns, maxTurns: r.maxTurns, cost: estimateCost(model, usages.values()), model })
    // a sign of life while Claude Code works quietly (reading, thinking): one line per quiet minute
    const started = Date.now()
    let heard = started
    const quietMs = Number(process.env.ONE_WORKER_QUIET_MS) || 60_000
    const beat = setInterval(() => {
      if (Date.now() - heard < quietMs) return
      const total = clock(Date.now() - started)
      const quiet = clock(Date.now() - heard)
      log('info', `Claude Code is still working · ${total} so far · last output ${quiet} ago`, 'stillWorking', { total, quiet })
    }, quietMs)
    beat.unref()
    const onAbort = () => {
      result.stopped = true
      log('warn', 'Stopped — Claude Code was ended.', 'stopped')
      void killTree(child)
    }
    if (r.signal.aborted) onAbort()
    r.signal.addEventListener('abort', onAbort, { once: true })
    child.on('error', (e) => {
      // the code only: the message names the path it looked at
      stderr += `\nClaude Code could not start (${(e as NodeJS.ErrnoException).code ?? e.name})`
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
          if (ev.subtype === 'init') {
            if (typeof ev.model === 'string') model = ev.model
            const m = String(ev.permissionMode ?? r.mode)
            log('info', `Claude Code started · ${m} mode${result.sessionId ? ` · session ${result.sessionId.slice(0, 8)}` : ''}`, 'claudeStarted', { mode: m })
            progress()
          }
          return
        case 'assistant': {
          const message = (ev.message ?? {}) as { id?: unknown; model?: unknown; usage?: unknown }
          const id = typeof message.id === 'string' ? message.id : `n${++unnamed}`
          if (!usages.has(id)) turns++
          usages.set(id, usageOf(message.usage) ?? usages.get(id) ?? { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 })
          if (typeof message.model === 'string') model = message.model
          progress()
          const content = ((ev.message as { content?: unknown })?.content ?? []) as Array<Record<string, unknown>>
          for (const block of Array.isArray(content) ? content : []) {
            if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) log('claude', clip(block.text.trim(), 4000))
            else if (block.type === 'tool_use' && typeof block.name === 'string') {
              // a change to a file carries what changed (the log shows it as a diff)
              const e = editOf(block.name, block.input)
              r.onLog({ t: Date.now(), k: 'tool', s: toolLine(block.name, block.input), ...(e ? { e } : {}) })
              const input = block.input as { plan?: unknown; file_path?: unknown } | undefined
              if (block.name === 'ExitPlanMode' && typeof input?.plan === 'string') result.plan = input.plan
              else if ((block.name === 'Write' || block.name === 'Edit' || block.name === 'MultiEdit') && typeof input?.file_path === 'string' && PLAN_FILE.test(input.file_path)) planFile = input.file_path
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
          r.onProgress?.({ turns: Math.max(turns, result.turns), maxTurns: r.maxTurns, cost: result.cost, model })
          // an error that still says "success" (is_error with subtype success) is shown as an error
          const why = result.ok ? 'success' : result.subtype && result.subtype !== 'success' ? result.subtype : 'error'
          log(result.ok ? 'info' : 'warn', `Claude Code finished · ${result.turns} turns · $${result.cost.toFixed(2)}${result.ok ? '' : ` · ${why}`}`, result.ok ? 'claudeDone' : 'claudeEnded', { turns: result.turns, cost: result.cost.toFixed(2), why })
          if (!result.ok && SIGNED_OUT.test(result.text)) {
            result.error = AUTH_HINT
            log('error', AUTH_HINT, 'claudeAuth')
          }
          return
        }
      }
    })
    child.on('close', (code) => {
      clearInterval(beat)
      r.signal.removeEventListener('abort', onAbort)
      // no ExitPlanMode, but a plan file: that file is the plan (read once the run is over)
      if (r.mode === 'plan' && !result.plan && planFile) result.plan = readPlanFile(planFile)
      if (!gotResult && !result.stopped) {
        result.ok = false
        result.error = code === null ? 'Claude Code was ended' : `Claude Code exited with code ${code}${stderr.trim() ? `: ${clip(oneLine(stderr.trim().split('\n').slice(-3).join(' ')), 400)}` : ''}`
        if (/ENOENT|not found/i.test(stderr)) result.error = claudeMissingError('not-found')
        else if (SIGNED_OUT.test(stderr)) {
          result.error = AUTH_HINT
          log('error', AUTH_HINT, 'claudeAuth')
        }
      }
      done(result)
    })
  })
}
