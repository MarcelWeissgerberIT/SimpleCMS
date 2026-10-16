/**
 * one-worker — Claude Code's permission requests (worker 1.11.0, --permission-prompt-tool → one_task_permission). Pure:
 *  - the tools the worker answers itself, never on a card (HANDLED): ExitPlanMode (the plan is taken from the call — the
 *    plan gate in One approves it, never "Allow" on a card), AskUserQuestion (questions go through one_task_ask),
 *    EnterPlanMode (a stage keeps the mode it was started in)
 *  - what a request is about (its kind, the command / file / address — an MCP tool's whole input) and whether a file
 *    lies outside the task's folders; a line break stays visible (↵): a command never reads as one line it is not
 *  - the repo's own rules first (worker.json claude.allowedTools / disallowedTools, Claude Code's syntax): a refusing rule
 *    wins; an allowing one only for a simple command (no ; && || | > < ` $( or line break — Claude Code splits those
 *    itself, the worker never guesses)
 *  - the rule "Always for this repo" would add: only narrow ones — a Bash command by its program AND a real subcommand
 *    (`Bash(npm run lint:*)`, `Bash(cargo test:*)`), an MCP tool by its name, a web address by its host. Never a shell,
 *    an interpreter (any version: python3.12, node22 …), a runner of other programs (npx, uvx, `npm exec`, `yarn dlx`,
 *    `uv run` …), a package install, a tool that reads, writes, deletes, moves or fetches files by path, git (the
 *    worker's own), a command with a path outside the repository, a runner without a subcommand (`npm --version`,
 *    `make -j4`), a file tool (Read / Edit / Write — reads outside the repo stay "Once"), nor anything with a wildcard of
 *    its own: then the person can only allow it once.
 */
import { posix, win32 } from 'node:path'
import type { PermissionKind } from '../../../src/app/features/coding/protocol.ts'
import { inFolder } from './paths.ts'

export interface PermRequest {
  /** Claude Code's tool name */
  tool: string
  /** what of its input came along (taskmcp.ts briefInput) */
  input: Record<string, string>
}

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead'])
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

export function kindOf(tool: string): PermissionKind {
  if (tool === 'Bash' || tool === 'BashOutput' || tool === 'KillShell' || tool === 'KillBash') return 'bash'
  if (READ_TOOLS.has(tool)) return 'read'
  if (EDIT_TOOLS.has(tool)) return 'edit'
  if (tool === 'WebFetch' || tool === 'WebSearch') return 'web'
  if (tool.startsWith('mcp__')) return 'mcp'
  return 'other'
}

/**
 * Tools that would put something to the person themselves — the worker answers them at once (taskmcp.ts sends the
 * answer as Claude Code's deny, with this text). The texts start "Handled by the One worker" (claude.ts leaves such
 * lines to the worker).
 */
export const HANDLED: Readonly<Record<string, string>> = {
  ExitPlanMode:
    'Handled by the One worker: your plan was received and goes to the person in One, who approves it there. Do not call ExitPlanMode again and do not start implementing — end your turn now with the whole plan as your final message.',
  AskUserQuestion:
    'Handled by the One worker: nobody can answer this here. Ask the person in One with the one_task_ask tool (one question; then end your turn — the stage runs again with the answer), or decide yourself and say so in your summary.',
  EnterPlanMode: 'Handled by the One worker: this stage keeps the mode it was started in — go on without plan mode.',
}

/** The file a Read / Edit tool names ('' when none). */
export const pathOf = (req: PermRequest): string => req.input.file_path ?? req.input.notebook_path ?? req.input.path ?? ''

/**
 * What the request is about, as one line (unscrubbed — the worker scrubs it before it goes to One): whole, never cut. A
 * line break shows as ↵ (a second command never hides as more words of the first); an MCP / other tool shows its whole
 * input (`args`, taskmcp.ts) — what it is called with.
 */
export function subjectOf(req: PermRequest): string {
  const kind = kindOf(req.tool)
  const pick =
    kind === 'bash'
      ? req.input.command
      : kind === 'read' || kind === 'edit'
        ? pathOf(req) || req.input.pattern
        : kind === 'web'
          ? (req.input.url ?? req.input.query)
          : (req.input.args ?? req.input.description ?? req.input.command ?? req.input.url ?? req.input.file_path ?? req.input.path)
  return (pick ?? '')
    .replace(/\r\n|\r|\n/g, ' ↵ ')
    .replace(/[^\S ]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
}

/**
 * A Read / Edit tool's file outside every one of `dirs` (relative paths are read from `cwd`) — compared as paths.ts
 * `inFolder` does: Windows paths without case, either slash, a drive or a UNC share of their own (another drive is
 * outside), a way out (`..`) resolved first. `platform`: the kind of paths (tests of the Windows branch elsewhere).
 */
export function isOutside(req: PermRequest, dirs: Array<string | null | undefined>, cwd: string, platform: NodeJS.Platform = process.platform): boolean {
  const kind = kindOf(req.tool)
  if (kind !== 'read' && kind !== 'edit') return false
  const p = pathOf(req)
  if (!p) return false
  const P = platform === 'win32' ? win32 : posix
  const full = P.isAbsolute(p) ? p : P.resolve(cwd, p)
  return !dirs.some((d) => !!d && inFolder(full, d, platform))
}

/** A command Claude Code runs as one program: no shell operator, no substitution, no second line. */
export const simpleCommand = (cmd: string): boolean => !!cmd.trim() && !/[;&|`<>\r\n]|\$\(/.test(cmd)

const norm = (s: string) => s.trim().replace(/\s+/g, ' ')
const RULE = /^(mcp__[A-Za-z0-9_-]+(?:__[A-Za-z0-9_.-]+)?|[A-Za-z][A-Za-z0-9_]*)(?:\(([\s\S]*)\))?$/

/** Host of an http(s) address, lower case ('' when none). */
const hostOf = (url: string | undefined): string => {
  try {
    const u = new URL(url ?? '')
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname.toLowerCase() : ''
  } catch {
    return ''
  }
}

function bashMatches(spec: string, cmd: string): boolean {
  const c = norm(cmd)
  const prefix = spec.endsWith(':*') ? norm(spec.slice(0, -2)) : null
  if (prefix !== null) return c === prefix || c.startsWith(`${prefix} `)
  return c === norm(spec)
}

/** Does `rule` (Claude Code's syntax) cover the request? `deny`: a Bash rule matches any part of a compound command. */
export function ruleMatches(rule: string, req: PermRequest, mode: 'allow' | 'deny'): boolean {
  const m = RULE.exec(rule.trim())
  if (!m) return false
  const name = m[1]!
  const spec = m[2]
  if (name.startsWith('mcp__')) return spec === undefined && (req.tool === name || req.tool.startsWith(`${name}__`))
  if (name !== req.tool) return false
  if (spec === undefined) return true
  if (req.tool === 'Bash') {
    const cmd = req.input.command ?? ''
    if (mode === 'deny') return cmd.split(/&&|\|\||[;|\r\n]/).some((part) => !!part.trim() && bashMatches(spec, part))
    return simpleCommand(cmd) && bashMatches(spec, cmd)
  }
  if (req.tool === 'WebFetch' && spec.startsWith('domain:')) return !!hostOf(req.input.url) && hostOf(req.input.url) === spec.slice('domain:'.length).trim().toLowerCase()
  // path rules (Read(./src/**) …): Claude Code applied them itself before it asked
  return false
}

/** The repo's own lists decide first: a refusing rule wins, then an allowing one; null: they say nothing — ask the person. */
export function ruleDecision(req: PermRequest, allowed: readonly string[], disallowed: readonly string[]): 'allow' | 'deny' | null {
  if (disallowed.some((r) => ruleMatches(r, req, 'deny'))) return 'deny'
  if (allowed.some((r) => ruleMatches(r, req, 'allow'))) return 'allow'
  return null
}

/** Programs whose "always" would open far more than the one command — only "Once" for them. */
const NEVER_ALWAYS = new Set(
  (
    // shells, and what runs a command line of its own
    'sh bash zsh fish dash ksh csh tcsh pwsh powershell cmd wsl busybox ' +
    'sudo doas su runas env eval exec source command builtin xargs nohup nice timeout time watch setsid script parallel ' +
    'cross-env dotenv dotenvx npm-run-all run-p run-s concurrently nodemon entr ' +
    // interpreters and runners of other programs (versioned names: INTERPRETER below)
    'node nodejs deno bun tsx ts-node esno jiti python python3 py pypy ipython ruby irb perl php lua luajit osascript java jshell ' +
    'npx pnpx bunx uvx pipx dlx ' +
    // what reads, writes, moves or deletes files by path (a rule could not keep them inside the repository)
    'rm rmdir del erase rd dd mkfs shred chmod chown chgrp ln mv cp install truncate find tee touch mkdir ' +
    'cat tac head tail less more nl ls dir tree stat file wc du grep egrep fgrep rg ag ack sort diff cmp xxd od hexdump strings base64 ' +
    'tar zip unzip gzip gunzip bzip2 xz 7z unrar ' +
    'sed awk gawk jq yq ' +
    'curl wget nc ncat netcat ssh scp sftp rsync ftp telnet socat ' +
    'git gh glab ' +
    'kill pkill killall taskkill ' +
    'open xdg-open start explorer launchctl systemctl service crontab at schtasks reg ' +
    'docker podman kubectl'
  ).split(' '),
)
/** An interpreter in any version (python3.12, node22, ruby3.3 …). */
const INTERPRETER = /^(?:python|pypy|node|nodejs|ruby|perl|php|lua|java|deno|bun)[0-9._-]*$/
/** Programs whose second word is the real command (`npm test`, `cargo build`): the rule keeps it — and needs one. */
const SUBCOMMAND = new Set(
  'npm pnpm yarn bun cargo go dotnet make gradle gradlew mvn mvnw composer pip pip3 poetry pdm hatch rye uv mix rake bundle gem swift flutter dart'.split(' '),
)
/** JS package managers: `run <script>` keeps the script's name (`npm run lint`). */
const SCRIPTS = new Set(['npm', 'pnpm', 'yarn', 'bun'])
const SCRIPT_RUNNER = new Set(['run', 'run-script', 'rum', 'urn'])
/**
 * Subcommands that run, fetch or install OTHER programs (`npm exec`, `yarn dlx`, `pip install`, `uv run`, `go run`,
 * `cargo install` …): never "Always" — a rule would allow any program after them.
 */
const RUNS_OTHERS = new Set(
  (
    'exec x dlx create init innit node global link ln add install i in ins inst insta instal isnt isntall ci clean-install ' +
    'install-test it install-ci-test cit update up upgrade uninstall remove rm un unlink r publish pack ' +
    'run-script-os shell env eval repl console self self-update tool tools get generate pip plugin plugins patch ' +
    'workspace workspaces import deploy setup store server config set npm require create-project download wheel'
  ).split(' '),
)
const WORD = /^[A-Za-z0-9][A-Za-z0-9._:@=+-]*$/
const PROGRAM = /^(?:\.\/)?[A-Za-z0-9][A-Za-z0-9._+-]*$/
/** An argument that names a place outside the repository (absolute, home, up a folder, another drive — also after `=`). */
const OUTSIDE_ARG = /(?:^|=)(?:[/\\~]|[A-Za-z]:)|(?:^|[/\\=])\.\.(?:[/\\]|$)/

/** The rule "Always for this repo" adds — null: only "Once" (see the file's head). */
export function alwaysRule(req: PermRequest, opts: { outside?: boolean } = {}): string | null {
  const kind = kindOf(req.tool)
  if (kind === 'mcp') return /^mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_.-]+$/.test(req.tool) && !req.tool.startsWith('mcp__one-task__') ? req.tool : null
  if (req.tool === 'WebSearch') return 'WebSearch'
  if (req.tool === 'WebFetch') {
    const host = hostOf(req.input.url)
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? `WebFetch(domain:${host})` : null
  }
  if (req.tool !== 'Bash' || opts.outside) return null
  const cmd = req.input.command ?? ''
  if (!simpleCommand(cmd) || /[*?[\]{}$'"\\%!^]/.test(cmd)) return null
  const words = norm(cmd).split(' ')
  const program = words[0] ?? ''
  if (!PROGRAM.test(program)) return null
  const base = program.replace(/^\.\//, '').replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase()
  if (NEVER_ALWAYS.has(base) || INTERPRETER.test(base)) return null
  if (words.slice(1).some((w) => OUTSIDE_ARG.test(w))) return null
  // a versioned runner (pip3.12, gradle8) is the runner
  const runner = base.replace(/[0-9._-]+$/, '') || base
  if (!SUBCOMMAND.has(base) && !SUBCOMMAND.has(runner)) return `Bash(${program}:*)`
  const name = SUBCOMMAND.has(base) ? base : runner
  // a runner needs its real subcommand: `npm --version` / bare `yarn` / `make -j4` would allow every subcommand
  const sub = words[1]
  if (!sub || !WORD.test(sub) || sub.startsWith('-')) return null
  // `mvn exec:exec`: a plugin goal counts by its plugin
  const s = sub.toLowerCase()
  if (RUNS_OTHERS.has(s) || RUNS_OTHERS.has(s.split(':')[0]!)) return null
  if (SCRIPT_RUNNER.has(s)) {
    // `npm run lint`: the script's name stays in the rule; any other runner's `run` (uv, poetry, go, cargo, dotnet …)
    // starts any program
    if (!SCRIPTS.has(name)) return null
    const script = words[2]
    if (!script || !WORD.test(script) || script.startsWith('-')) return null
    return `Bash(${program} ${sub} ${script}:*)`
  }
  return `Bash(${program} ${sub}:*)`
}
