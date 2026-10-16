/**
 * one-worker — Claude Code's permission requests (worker 1.11.0, --permission-prompt-tool → one_task_permission). Pure:
 *  - what a request is about (its kind, the command / file / address) and whether a file lies outside the task's folders
 *  - the repo's own rules first (worker.json claude.allowedTools / disallowedTools, Claude Code's syntax): a refusing rule
 *    wins; an allowing one only for a simple command (no ; && || | > < ` $( or line break — Claude Code splits those
 *    itself, the worker never guesses)
 *  - the rule "Always for this repo" would add: only narrow ones — a Bash command by its program (and subcommand:
 *    `Bash(npm run lint:*)`), an MCP tool by its name, a web address by its host. Never a shell, an interpreter, a tool
 *    that deletes, moves, fetches or runs other programs, git (the worker's own), a command with a path outside the
 *    repository, a file tool (Read / Edit / Write — reads outside the repo stay "Once"), nor anything with a wildcard
 *    of its own: then the person can only allow it once.
 */
import { isAbsolute, resolve } from 'node:path'
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

/** The file a Read / Edit tool names ('' when none). */
export const pathOf = (req: PermRequest): string => req.input.file_path ?? req.input.notebook_path ?? req.input.path ?? ''

/** What the request is about, as one line (unscrubbed — the worker scrubs it before it goes to One). */
export function subjectOf(req: PermRequest): string {
  const kind = kindOf(req.tool)
  const pick =
    kind === 'bash'
      ? req.input.command
      : kind === 'read' || kind === 'edit'
        ? pathOf(req) || req.input.pattern
        : kind === 'web'
          ? (req.input.url ?? req.input.query)
          : (req.input.description ?? req.input.command ?? req.input.url ?? req.input.file_path ?? req.input.path)
  return (pick ?? '').replace(/\s+/g, ' ').trim()
}

/** A Read / Edit tool's file outside every one of `dirs` (relative paths are read from `cwd`). */
export function isOutside(req: PermRequest, dirs: Array<string | null | undefined>, cwd: string): boolean {
  const kind = kindOf(req.tool)
  if (kind !== 'read' && kind !== 'edit') return false
  const p = pathOf(req)
  if (!p) return false
  const full = isAbsolute(p) ? p : resolve(cwd, p)
  return !dirs.some((d) => !!d && inFolder(full, d))
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
    'sh bash zsh fish dash ksh csh tcsh pwsh powershell cmd wsl ' +
    'sudo doas su runas env eval exec source command builtin xargs nohup nice timeout time watch setsid script ' +
    'rm rmdir del erase rd dd mkfs shred chmod chown chgrp ln mv cp install truncate find ' +
    'sed awk gawk perl ruby python python3 py node deno bun php lua osascript java ' +
    'curl wget nc ncat netcat ssh scp sftp rsync ftp telnet socat ' +
    'git gh glab ' +
    'kill pkill killall taskkill ' +
    'open xdg-open start explorer launchctl systemctl service crontab at schtasks reg ' +
    'docker podman kubectl'
  ).split(' '),
)
/** Programs whose second word is the real command (`npm test`, `cargo build`): the rule keeps it. */
const SUBCOMMAND = new Set('npm pnpm yarn npx pnpx bunx cargo go dotnet make gradle gradlew mvn mvnw composer pip pip3 poetry uv mix rake bundle swift flutter dart tsc jest vitest pytest'.split(' '))
/** …and for these the third (`npm run lint`). */
const SCRIPT_RUNNER = new Set(['run', 'run-script', 'exec', 'x'])
const WORD = /^[A-Za-z0-9][A-Za-z0-9._:@=+-]*$/
const PROGRAM = /^(?:\.\/)?[A-Za-z0-9][A-Za-z0-9._+-]*$/
/** An argument that names a place outside the repository (absolute, home, up a folder, another drive). */
const OUTSIDE_ARG = /^(?:[/\\~]|[A-Za-z]:|.*\.\.)/

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
  if (!simpleCommand(cmd) || /[*?[\]{}$'"\\]/.test(cmd)) return null
  const words = norm(cmd).split(' ')
  const program = words[0] ?? ''
  if (!PROGRAM.test(program)) return null
  const base = program.replace(/^\.\//, '').replace(/\.(exe|cmd|bat)$/i, '').toLowerCase()
  if (NEVER_ALWAYS.has(base)) return null
  if (words.slice(1).some((w) => OUTSIDE_ARG.test(w))) return null
  const prefix = [program]
  if (SUBCOMMAND.has(base) && words[1] && WORD.test(words[1]) && !words[1].startsWith('-')) {
    prefix.push(words[1])
    if (SCRIPT_RUNNER.has(words[1]) && words[2] && WORD.test(words[2]) && !words[2].startsWith('-')) prefix.push(words[2])
    // a runner of other programs with nothing after it would allow them all
    else if (SCRIPT_RUNNER.has(words[1])) return null
  } else if (SUBCOMMAND.has(base) && (base === 'npx' || base === 'pnpx' || base === 'bunx')) return null
  return `Bash(${prefix.join(' ')}:*)`
}
