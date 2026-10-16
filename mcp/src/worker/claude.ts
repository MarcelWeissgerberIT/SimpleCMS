/**
 * one-worker — Claude Code, headless: `claude -p --output-format stream-json --verbose --permission-mode …
 * --max-turns N [--model …] [--allowedTools …] [--disallowedTools …] [--max-budget-usd …] [--setting-sources user]
 * [--add-dir <the task's scratch folder>] [--permission-prompt-tool mcp__one-task__one_task_permission] --mcp-config <task
 * tools> [--strict-mcp-config]` in the task's worktree. The prompt goes in on stdin (task text never shows in the process
 * list). Claude Code keeps its own permission rules: no flag that skips them is ever passed — what it may not do it asks
 * through the task tools' one_task_permission (worker 1.11.0: the repo's own lists, else the person in One). Stop kills
 * the whole process tree.
 *
 * A run ends when Claude Code ends (worker 1.11.0): its result stops the sign of life at once; the stage finishes on the
 * process's exit (a short wait for the last lines of output) — never only when every pipe closed, which a server Claude
 * Code left running kept open for ever — and what the run left running is ended (proctree.ts).
 *
 * The CLI is `CLAUDE_BIN` or `claude` on PATH — Windows: claude.exe, or the script behind npm's claude.cmd (never
 * through cmd.exe, never from the worktree; exec.ts), else the native installer's one off PATH (findClaude). What it
 * supports is read from its --help (the budget
 * flag, the permission mode names, --setting-sources, --add-dir), so older and newer versions both work.
 * --permission-prompt-tool is a hidden option (not in --help): known from the help, else from the version (1.0.0 on).
 */
import type { ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline'
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join, posix, resolve, win32 } from 'node:path'
import { EDIT_CHARS, EDIT_HUNKS, type LogLine, type PermissionMode, type TaskProgress, type ToolEdit } from '../../../src/app/features/coding/protocol.ts'
import { inFolder } from './config.ts'
import { envGet, execFileSafe, isFile, killTree, programName, resolveCommand, spawnSafe, type ExecCtx, type Via } from './exec.ts'
import { samePath } from './paths.ts'
import { estimateCost, usageOf, type Usage } from './price.ts'
import { BASH_TOOLS, RUN_MARK, RunTree } from './proctree.ts'

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
  /** worker 1.11.0: --add-dir is known (the task's scratch folder) — absent in older reads: unknown, not passed */
  addDir?: boolean
  /** worker 1.11.0: --permission-prompt-tool works (hidden from --help: the help names it, or the version is 1.0.0 or newer) */
  permissionTool?: boolean
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
 *  - else the native installer's own file while PATH does not name `claude` — Windows %USERPROFILE%\.local\bin\claude.exe,
 *    macOS / Linux ~/.local/bin/claude (the installer only prints a note about PATH, and a worker started before the
 *    install keeps its old PATH anyway) — `check` and the start say so
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
  const exists = opts.exists ?? isFile
  const onPath =
    platform === 'win32'
      ? resolveCommand('claude', [], { platform, env, exists }, 'shim').ok
      : (envGet(env, 'PATH', platform) ?? '').split(':').some((d) => d.startsWith('/') && exists(posix.join(d, 'claude')))
  if (!onPath) {
    const native = P.join(home, '.local', 'bin', platform === 'win32' ? 'claude.exe' : 'claude')
    if (exists(native)) return { bin: native, from: 'native' }
  }
  return { bin: 'claude', from: 'path' }
}

export const claudeBin = (env: NodeJS.ProcessEnv = process.env): string => findClaude(env).bin

/** The terminal's line for Claude Code found only in its native installer's folder (Windows; never sent). */
export const NATIVE_NOT_ON_PATH = 'claude.exe is in %USERPROFILE%\\.local\\bin, which is not on PATH — the worker uses it; to run `claude` yourself, add that folder to your user PATH (then open a new terminal), or set CLAUDE_BIN'

/** That line on this kind of computer (macOS / Linux: ~/.local/bin). */
export const nativeNotOnPath = (platform: NodeJS.Platform = process.platform): string =>
  platform === 'win32' ? NATIVE_NOT_ON_PATH : 'claude is in ~/.local/bin, which is not on the PATH the worker started with — the worker uses it; to run `claude` yourself, add that folder to PATH (the installer says how), or set CLAUDE_BIN'

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
    // (absolute: resolveCommand names nothing from a working folder — only a spawn does, from its own)
    const where: Pick<ClaudeCaps, 'path' | 'via'> = platform === 'win32' ? { path: r.via === 'node-shim' && r.script !== undefined ? r.args[r.script] : r.file, via: r.via } : {}
    const v = await capture(bin, ['--version'], ctx)
    if (v.code === 127 || (v.code !== 0 && !v.out.trim())) return none(v.why === 'refused' ? 'cmd-refused' : 'not-found')
    const version = /(\d+\.\d+\.\d+[\w.-]*)/.exec(v.out)?.[1] ?? null
    const help = await capture(bin, ['--help'], ctx)
    const modeLine = /--permission-mode[\s\S]{0,400}?\(choices:([^)]*)\)/.exec(help.out)?.[1] ?? ''
    const modes = [...modeLine.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]!)
    return {
      found: true,
      version,
      budget: /--max-budget-usd/.test(help.out),
      modes,
      settingSources: /--setting-sources/.test(help.out),
      addDir: /--add-dir\b/.test(help.out),
      permissionTool: /--permission-prompt-tool\b/.test(help.out) || versionAtLeast(version, PERMISSION_TOOL_SINCE),
      ...where,
    }
  } catch {
    return none('not-found')
  }
}

/** The first Claude Code version with --permission-prompt-tool (a hidden option: its --help never names it). */
export const PERMISSION_TOOL_SINCE = '1.0.0'

/** "2.1.42" ≥ "1.0.0" (numeric, part by part); an unreadable version: false. */
export function versionAtLeast(version: string | null, min: string): boolean {
  const parts = (v: string | null) => (v && /^\d+(\.\d+)*/.exec(v)?.[0].split('.').map(Number)) || null
  const a = parts(version)
  const b = parts(min)
  if (!a || !b) return false
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d) return d > 0
  }
  return true
}

/** The task tools' permission prompt as Claude Code names it (--permission-prompt-tool). */
export const PERMISSION_TOOL = 'mcp__one-task__one_task_permission'

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
  /** worker 1.11.0: the task's scratch folder (--add-dir, when the CLI knows it) — null: none */
  scratch?: string | null
  /** worker 1.11.0: the MCP tool Claude Code asks for a permission it does not have (--permission-prompt-tool) — null: none */
  permissionTool?: string | null
  caps: ClaudeCaps
  env: NodeJS.ProcessEnv
  signal: AbortSignal
  onLog: (line: LogLine) => void
  /** after every turn: turns so far, the limit, a cost estimate */
  onProgress?: (p: TaskProgress) => void
  /**
   * this machine's paths out of a text (run.ts: the stage's Scrubber) — applied BEFORE any text is cut to its length, so
   * a path is never cut in two halves no rule can match any more
   */
  scrub?: (s: string) => string
  /** true while the run waits for the person (a permission request in One): no "still working" line then */
  waiting?: () => boolean
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
  /** worker 1.11.0: tool calls Claude Code refused itself for a missing permission (it could not ask) */
  refusals: number
  /** worker 1.11.0: programs the run left running that the worker ended */
  leftovers: number
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

/** A JSON file's object (≤ 64 MB — Claude Code's own config grows with its history), null when it cannot be read. */
function readJson(file: string, max = 64 * 1024 * 1024): Record<string, unknown> | null {
  try {
    if (statSync(file).size > max) return null
    const v = JSON.parse(readFileSync(file, 'utf8')) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * The program each stdio server of an `mcpServers` object starts (its `command`). `bareOnly`: only a command given by its
 * name (`npx`, `uvx`) — a plugin's own file (`${CLAUDE_PLUGIN_ROOT}/server.js`) is a path no lookup by name takes, and
 * its base name (server, index, main) is an everyday file name in a repository.
 */
function launchers(servers: unknown, env: NodeJS.ProcessEnv, bareOnly = false): string[] {
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return []
  const out: string[] = []
  for (const s of Object.values(servers as Record<string, unknown>)) {
    if (!s || typeof s !== 'object') continue
    const { type, command } = s as { type?: unknown; command?: unknown }
    if ((type !== undefined && type !== 'stdio') || typeof command !== 'string' || !command.trim()) continue
    if (bareOnly && /[\\/$%]/.test(command)) continue
    out.push(programName(command, env))
  }
  return out
}

/** A server map as a file holds it: `{ "mcpServers": { … } }` or the map itself (a plugin's .mcp.json may be either). */
const serverMap = (o: Record<string, unknown> | null): unknown => (o && o.mcpServers && typeof o.mcpServers === 'object' ? o.mcpServers : o)

/** Plugin and organisation files are small: larger ones are not read. */
const SMALL_JSON = 1024 * 1024
/** At most this many installed plugins are looked at. */
const PLUGINS_MAX = 200

/**
 * The folders Claude Code reads an organisation's files in (managed-mcp.json, managed-settings.json — its own fixed places,
 * read from the installed CLI): Windows C:\Program Files\ClaudeCode (also under %ProgramFiles%, and %ProgramData%\ClaudeCode
 * where older versions read them), macOS /Library/Application Support/ClaudeCode, Linux /etc/claude-code.
 */
export function managedDirs(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
  if (platform === 'darwin') return ['/Library/Application Support/ClaudeCode']
  if (platform !== 'win32') return ['/etc/claude-code']
  const dirs = ['C:\\Program Files\\ClaudeCode']
  for (const key of ['ProgramFiles', 'ProgramData']) {
    const v = envGet(env, key, 'win32')?.trim()
    if (v && win32.isAbsolute(v)) dirs.push(win32.join(v, 'ClaudeCode'))
  }
  return [...new Map(dirs.map((d) => [d.toLowerCase(), d] as const)).values()]
}

/**
 * The servers an organisation sets for Claude Code: managed-mcp.json (`mcpServers`) and `managedMcpServers` in
 * managed-settings.json and its managed-settings.d/*.json drop-ins.
 */
function managedServers(dirs: string[]): unknown[] {
  const out: unknown[] = []
  for (const dir of dirs) {
    out.push(serverMap(readJson(join(dir, 'managed-mcp.json'), SMALL_JSON)))
    out.push(readJson(join(dir, 'managed-settings.json'), SMALL_JSON)?.managedMcpServers)
    let drops: string[] = []
    try {
      drops = readdirSync(join(dir, 'managed-settings.d')).filter((f) => f.toLowerCase().endsWith('.json')).slice(0, 50)
    } catch {
      /* none */
    }
    for (const f of drops) out.push(readJson(join(dir, 'managed-settings.d', f), SMALL_JSON)?.managedMcpServers)
  }
  return out
}

/**
 * The servers of the person's installed Claude Code plugins — every one installed (enabled or not: which are on is spread
 * over several settings files; one more name only makes the check stricter): <plugins folder>/installed_plugins.json
 * names each install's folder (`installPath`); a plugin's servers are its .mcp.json and the `mcpServers` of its
 * .claude-plugin/plugin.json (an object, or files inside the plugin). The plugins folder: $CLAUDE_CODE_PLUGIN_CACHE_DIR, else
 * <config folder>/plugins; also each folder of $CLAUDE_CODE_PLUGIN_SEED_DIR. And each plugin folder named in
 * $CLAUDE_CODE_PLUGIN_DIRS (loaded like --plugin-dir — the worker itself passes no --plugin-dir).
 */
function pluginServers(configDir: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): unknown[] {
  const list = (key: string) => (envGet(env, key, platform) ?? '').split(delimiter).map((d) => d.trim()).filter(Boolean)
  const cache = envGet(env, 'CLAUDE_CODE_PLUGIN_CACHE_DIR', platform)?.trim()
  const seeds = list('CLAUDE_CODE_PLUGIN_SEED_DIR')
  const roots: string[] = list('CLAUDE_CODE_PLUGIN_DIRS').filter((d) => isAbsolute(d)).slice(0, PLUGINS_MAX)
  for (const dir of [cache || join(configDir, 'plugins'), ...seeds]) {
    const plugins = readJson(join(dir, 'installed_plugins.json'), 16 * SMALL_JSON)?.plugins
    if (!plugins || typeof plugins !== 'object') continue
    for (const installs of Object.values(plugins as Record<string, unknown>))
      for (const one of Array.isArray(installs) ? installs : [installs]) {
        const at = (one as { installPath?: unknown } | null)?.installPath
        if (typeof at === 'string' && isAbsolute(at) && roots.length < PLUGINS_MAX) roots.push(at)
      }
  }
  const out: unknown[] = []
  for (const root of new Set(roots)) {
    out.push(serverMap(readJson(join(root, '.mcp.json'), SMALL_JSON)))
    const declared = readJson(join(root, '.claude-plugin', 'plugin.json'), SMALL_JSON)?.mcpServers
    if (declared && typeof declared === 'object' && !Array.isArray(declared)) out.push(declared)
    for (const rel of typeof declared === 'string' ? [declared] : Array.isArray(declared) ? declared.slice(0, 20) : []) {
      if (typeof rel !== 'string') continue
      const file = resolve(root, rel)
      if (inFolder(file, root)) out.push(serverMap(readJson(file, SMALL_JSON)))
    }
  }
  return out
}

/**
 * The programs the person's MCP servers start Claude Code with — base names, lower case (`uvx`, `docker`, `my-tool`):
 *  - user scope from Claude Code's config ($CLAUDE_CONFIG_DIR/.claude.json, else ~/.claude.json)
 *  - the organisation's (managed-mcp.json, managedMcpServers — managedDirs) and the installed plugins' (pluginServers;
 *    their commands by name only)
 *  - while the repo's own settings load (`projectSettings`), the local scope of the stage's folder and the repo
 *    (`projects[<folder>]`) and the folder's .mcp.json.
 * A file that cannot be read adds none (plantedProgram still checks PATH and its own list). Not read: a plugin folder
 * given only on Claude Code's command line (the worker passes none), the organisation's settings in Windows' policy
 * registry (HKLM / HKCU\SOFTWARE\Policies\ClaudeCode, value "Settings"), Claude Code's copy of remotely managed settings
 * (<config dir>/remote-settings.json) and servers Claude Desktop or claude.ai hand over (no program on this computer
 * starts them by name).
 */
export function mcpLaunchers(opts: { dirs: string[]; projectSettings: boolean; home?: string; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; managed?: string[] }): string[] {
  const env = opts.env ?? process.env
  // the files are this computer's (its own path rules), whatever rules `platform` asks about
  const platform = opts.platform ?? process.platform
  const dir = envGet(env, 'CLAUDE_CONFIG_DIR', platform)?.trim()
  const home = opts.home ?? homedir()
  const config = readJson(dir ? join(dir, '.claude.json') : join(home, '.claude.json'))
  const names = new Set(launchers(config?.mcpServers, env))
  for (const servers of managedServers(opts.managed ?? managedDirs(process.platform, env))) for (const n of launchers(servers, env)) names.add(n)
  for (const servers of pluginServers(dir || join(home, '.claude'), env, platform)) for (const n of launchers(servers, env, true)) names.add(n)
  if (opts.projectSettings) {
    const projects = config?.projects && typeof config.projects === 'object' ? (config.projects as Record<string, unknown>) : {}
    for (const [key, p] of Object.entries(projects))
      if (opts.dirs.some((d) => samePath(key, d)) && p && typeof p === 'object') for (const n of launchers((p as { mcpServers?: unknown }).mcpServers, env)) names.add(n)
    for (const d of opts.dirs) for (const n of launchers(readJson(join(d, '.mcp.json'))?.mcpServers, env)) names.add(n)
  }
  return [...names].filter(Boolean).sort()
}

/** The argv for a run (exported for the tests: no bypassing flag ever). */
export function claudeArgs(r: Omit<ClaudeRun, 'bin' | 'cwd' | 'prompt' | 'env' | 'signal' | 'onLog' | 'onProgress' | 'scrub' | 'waiting'>): string[] {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', cliMode(r.mode, r.caps), '--max-turns', String(r.maxTurns)]
  if (r.model) args.push('--model', r.model)
  if (r.allowedTools.length) args.push('--allowedTools', r.allowedTools.join(','))
  if (r.disallowedTools.length) args.push('--disallowedTools', r.disallowedTools.join(','))
  if (r.budgetUsd !== null && r.caps.budget) args.push('--max-budget-usd', r.budgetUsd.toFixed(2))
  // the person's own settings only: the repo's hooks, apiKeyHelper, MCP approvals, .mcp.json and CLAUDE.md stay out
  if (!r.projectSettings && r.caps.settingSources) args.push('--setting-sources', 'user')
  // the task's scratch folder: temporary files without asking (one folder — the flag takes a list: a flag follows it)
  if (r.scratch && r.caps.addDir) args.push('--add-dir', r.scratch)
  // what Claude Code may not do yet is asked through the task tools (never skipped): only with the task tools there
  if (r.permissionTool && r.mcpConfig && r.caps.permissionTool) args.push('--permission-prompt-tool', r.permissionTool)
  if (r.mcpConfig) {
    args.push('--mcp-config', r.mcpConfig)
    if (r.strictMcp) args.push('--strict-mcp-config')
  }
  return args
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
/** Claude Code's stderr kept for an error (its tail) */
export const STDERR_KEEP = 8000
/** What follows the first line break of a text whose beginning was cut off ('' when there is none: all of it is that one cut line). */
export const afterFirstBreak = (s: string): string => {
  const at = s.search(/[\r\n]/)
  return at < 0 ? '' : s.slice(at + 1)
}
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

const same = (s: string) => s

/** "Edit src/a.ts" · "Bash npm test" · "Grep login" — a tool call as one log line (scrubbed, then clipped). */
export function toolLine(name: string, input: unknown, scrub: (s: string) => string = same): string {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const pick = ['file_path', 'path', 'command', 'pattern', 'url', 'query', 'description'].map((k) => i[k]).find((v) => typeof v === 'string' && v.trim()) as string | undefined
  return clip(scrub(`${name}${pick ? ` ${oneLine(pick)}` : ''}`), 300)
}

/** What an Edit / MultiEdit / Write tool call changes (null for other tools) — scrubbed, then clipped for the log. */
export function editOf(name: string, input: unknown, scrub: (s: string) => string = same): ToolEdit | null {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const path = typeof i.file_path === 'string' ? scrub(i.file_path) : ''
  if (!path) return null
  const str = (v: unknown) => (typeof v === 'string' ? scrub(v) : '')
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

/**
 * Claude Code refused a tool call itself for a permission it does not have (it could not ask: an older CLI, no task
 * tools) — its tool_result says so. The worker's own refusals start "Not allowed" (worker.ts: logged there already), its
 * answers to ExitPlanMode / AskUserQuestion "Handled by the One worker" (permissions.ts HANDLED: no line of their own).
 */
export const PERMISSION_REFUSED = /requires approval|haven't granted it yet|has(?:n't| not) been granted|permission to use \S+ (?:has been|was) denied|was blocked by your permission settings/i
export const OWN_REFUSAL = /^(?:Not allowed|Handled by the One worker)\b/

/** After Claude Code's process exited: this long for the last lines of its output (ONE_WORKER_EXIT_GRACE_MS: tests). */
const exitGraceMs = () => Number(process.env.ONE_WORKER_EXIT_GRACE_MS) || 1500
/** After its result: this long for Claude Code to end by itself, then the worker ends it (ONE_WORKER_RESULT_EXIT_MS). */
const resultExitMs = () => Number(process.env.ONE_WORKER_RESULT_EXIT_MS) || 30_000

/**
 * Run Claude Code once; streams log lines; resolves when its run is over: its process exited (plus a short wait for
 * the last lines — never for every pipe to close: a program it left running may hold them), or was stopped. Then what
 * the run left running is ended (proctree.ts) and named in one line.
 */
export function runClaude(r: ClaudeRun): Promise<ClaudeResult> {
  return new Promise((done) => {
    const result: ClaudeResult = { ok: false, stopped: false, text: '', plan: null, cost: 0, turns: 0, sessionId: null, subtype: null, refusals: 0, leftovers: 0 }
    // every program of this run carries the mark (its leftovers are found by it — Linux / macOS)
    const mark = randomBytes(12).toString('hex')
    // an .exe or a script behind npm's shim — never through cmd.exe, never from the worktree (exec.ts)
    const spawned = spawnSafe(r.bin, claudeArgs(r), { cwd: r.cwd, env: { ...r.env, [RUN_MARK]: mark }, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true, allow: 'shim' })
    if (!spawned.ok) {
      done({ ...result, error: spawned.why === 'failed' ? `Claude Code could not start: ${spawned.error}` : claudeMissingError(spawned.why === 'refused' ? 'cmd-refused' : 'not-found') })
      return
    }
    const child: ChildProcess = spawned.child
    const tree = child.pid !== undefined ? new RunTree(child.pid, mark) : null
    let stderr = ''
    // the kept stderr lost its beginning (it is only the last STDERR_KEEP characters)
    let stderrCut = false
    let gotResult = false
    const scrub = r.scrub ?? same
    const log = (k: LogLine['k'], s: string, c?: string, v?: LogLine['v']) => r.onLog({ t: Date.now(), k, s, ...(c ? { c, v } : {}) })
    // progress: one turn per assistant message (by id), the token counts of each for the estimate
    let model: string | null = null
    let turns = 0
    let unnamed = 0
    // the plan file Claude Code wrote in plan mode (its last one)
    let planFile: string | null = null
    const usages = new Map<string, Usage>()
    // a tool call's name by its id (a refusal in its result names the tool)
    const toolNames = new Map<string, string>()
    const progress = () => r.onProgress?.({ turns, maxTurns: r.maxTurns, cost: estimateCost(model, usages.values()), model })
    // a sign of life while Claude Code works quietly (reading, thinking): one line per quiet minute — never after its
    // result, never while the stage waits for the person
    const started = Date.now()
    let heard = started
    const quietMs = Number(process.env.ONE_WORKER_QUIET_MS) || 60_000
    const beat = setInterval(() => {
      if (r.waiting?.()) {
        heard = Date.now()
        return
      }
      if (Date.now() - heard < quietMs) return
      const total = clock(Date.now() - started)
      const quiet = clock(Date.now() - heard)
      log('info', `Claude Code is still working · ${total} so far · last output ${quiet} ago`, 'stillWorking', { total, quiet })
    }, quietMs)
    beat.unref()
    let afterResult: ReturnType<typeof setTimeout> | undefined
    let afterExit: ReturnType<typeof setTimeout> | undefined
    /** the run is over (finish ran): later lines are not read */
    let finished = false
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
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (d: string) => {
      const all = stderr + d
      if (all.length > STDERR_KEEP) stderrCut = true
      stderr = all.slice(-STDERR_KEEP)
    })
    const lines = createInterface({ input: child.stdout! })
    lines.on('line', (line) => {
      if (finished) return
      const s = line.trim()
      if (!s) return
      heard = Date.now()
      let ev: Record<string, unknown>
      try {
        ev = JSON.parse(s) as Record<string, unknown>
      } catch {
        log('info', clip(scrub(s), 500))
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
            if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) log('claude', clip(scrub(block.text.trim()), 4000))
            else if (block.type === 'tool_use' && typeof block.name === 'string') {
              if (typeof block.id === 'string' && toolNames.size < 5000) toolNames.set(block.id, block.name)
              // a command that may start programs: the tree is read while it runs (proctree.ts)
              if (typeof block.id === 'string' && BASH_TOOLS.test(block.name)) tree?.bashStart(block.id)
              // a change to a file carries what changed (the log shows it as a diff)
              const e = editOf(block.name, block.input, scrub)
              r.onLog({ t: Date.now(), k: 'tool', s: toolLine(block.name, block.input, scrub), ...(e ? { e } : {}) })
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
            // a Bash command returned: what it started still hangs together now (the tree is read once more; proctree.ts)
            if (block?.type === 'tool_result' && typeof block.tool_use_id === 'string') tree?.bashEnd(block.tool_use_id)
            if (block.type !== 'tool_result' || block.is_error !== true) continue
            const text = typeof block.content === 'string' ? block.content : Array.isArray(block.content) ? (block.content as Array<{ text?: string }>).map((c) => c.text ?? '').join(' ') : ''
            // the worker's own refusal (one_task_permission): its line is in the log already
            if (OWN_REFUSAL.test(text.trim())) continue
            if (PERMISSION_REFUSED.test(text)) {
              // a permission Claude Code could not ask for: its own line (the tool's name — never the path or command)
              result.refusals++
              const tool = clip((typeof block.tool_use_id === 'string' ? toolNames.get(block.tool_use_id) : undefined) ?? 'a tool', 120)
              log('warn', `Claude Code may not use ${tool} here without your permission — it was refused`, 'permissionNeeded', { tool })
              continue
            }
            log('warn', clip(scrub(`tool error: ${oneLine(text)}`), 500))
          }
          return
        }
        case 'result': {
          gotResult = true
          // the run is over: no "still working" line after it; the tree as it stands now (its shells may still run)
          clearInterval(beat)
          tree?.atResult()
          // Claude Code ends by itself after its result — if it does not, the worker ends it
          afterResult = setTimeout(() => {
            if (child.exitCode !== null || child.signalCode !== null) return
            log('warn', 'Claude Code did not end after its result — the worker ended it', 'claudeLingered')
            void killTree(child)
          }, resultExitMs())
          afterResult.unref()
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
    const finish = async (code: number | null) => {
      if (finished) return
      finished = true
      clearInterval(beat)
      clearTimeout(afterResult)
      clearTimeout(afterExit)
      r.signal.removeEventListener('abort', onAbort)
      // what the run left running (a server it started, a watcher): ended — also what kept its output open
      const left = tree ? await tree.end() : { n: 0, names: [], spared: { n: 0, names: [] } }
      if (left.n) {
        result.leftovers = left.n
        const names = left.names.join(', ')
        log('info', `Ended ${left.n} program(s) Claude Code left running${names ? `: ${names}` : ''}`, 'claudeLeftovers', { n: left.n, names })
      }
      // a server the person's own tools share (a Gradle daemon …), or a program that made its own session: named, left running
      if (left.spared.n) {
        const names = left.spared.names.join(', ')
        log('info', `Left ${left.spared.n} program(s) running that Claude Code started and other tools may use${names ? `: ${names}` : ''}`, 'claudeSpared', { n: left.spared.n, names })
      }
      lines.close()
      child.stdout?.destroy()
      child.stderr?.destroy()
      // no ExitPlanMode, but a plan file: that file is the plan (read once the run is over)
      if (r.mode === 'plan' && !result.plan && planFile) result.plan = readPlanFile(planFile)
      if (!gotResult && !result.stopped) {
        result.ok = false
        // the kept tail starts at a line: the line the cut went through is dropped — all of it when no line break follows
        // (a path cut in two would pass the scrubber in halves) — then scrubbed, then clipped
        const tail = scrub(stderrCut ? afterFirstBreak(stderr) : stderr).trim()
        result.error = code === null ? 'Claude Code was ended' : `Claude Code exited with code ${code}${tail ? `: ${clip(oneLine(tail.split('\n').slice(-3).join(' ')), 400)}` : ''}`
        if (/ENOENT|not found/i.test(stderr)) result.error = claudeMissingError('not-found')
        else if (SIGNED_OUT.test(stderr)) {
          result.error = AUTH_HINT
          log('error', AUTH_HINT, 'claudeAuth')
        }
      }
      done(result)
    }
    // the process ended: a moment for the last lines, then the run is over — whoever still holds its output
    child.on('exit', (code) => {
      clearInterval(beat)
      // its id may be another program's from now on (Windows: what was born after this is not its)
      tree?.exited()
      // stopped: no lines are needed any more — the leftovers are ended at once (a worker that shuts down waits for it)
      afterExit = setTimeout(() => void finish(code), result.stopped ? 0 : exitGraceMs())
    })
    child.on('close', (code) => void finish(code))
  })
}
