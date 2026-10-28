import { createInterface } from 'node:readline'
import { randomBytes } from 'node:crypto'
import { isAbsolute, join, resolve } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import type { LogLine, CodingAgent, TaskProgress } from '../../../src/app/features/coding/protocol.ts'
import { execFileSafe, isFile, killTree, resolveCommand, spawnSafe } from './exec.ts'
import { RUN_MARK, RunTree } from './proctree.ts'

export function findCodex(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.CODEX_BIN?.trim()
  if (explicit) return /[/\\]/.test(explicit) && !isAbsolute(explicit) ? resolve(explicit) : explicit
  if (resolveCommand('codex', [], { env, cwd: tmpdir() }, 'shim').ok) return 'codex'
  const native = [join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex')]
  if (process.platform === 'darwin') native.push('/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex', '/Applications/Codex.app/Contents/Resources/codex')
  return native.find(isFile) ?? 'codex'
}

export interface CodexRun {
  mcpOrigins?: string[]
  agent: Exclude<CodingAgent, 'claude'>
  cwd: string
  prompt: string
  readOnly: boolean
  /** Isolated text response: disable execution, browsing, apps and skill discovery. */
  textOnly?: boolean
  maxSteps: number
  signal: AbortSignal
  taskMcp: { command: string; args: string[]; env: Record<string, string> } | null
  log: (line: LogLine) => void
  env?: NodeJS.ProcessEnv
  progress?: (value: TaskProgress) => void
}
export interface CodexResult { ok: boolean; stopped: boolean; limited: boolean; text: string; steps: number; cost?: number; inputTokens?: number; outputTokens?: number; limitKind?: 'budget' | 'model' | 'context' | 'steps'; error?: string }

/** Arguments contain no task text or credentials; own MCP credentials are inherited by name. */
export function codexArgs(opts: CodexRun): string[] {
  const args = ['exec', '--json', '--ignore-user-config', '--ephemeral', '--color', 'never', '--sandbox', opts.readOnly ? 'read-only' : 'workspace-write', '-c', 'approval_policy="never"']
  if (opts.textOnly) {
    for (const feature of ['shell_tool', 'unified_exec', 'view_image', 'browser_use', 'computer_use', 'apps', 'multi_agent', 'skill_mcp_dependency_install']) args.push('--disable', feature)
    args.push('-c', 'web_search="disabled"')
  }
  const mcp = opts.taskMcp
  args.push('-c', mcp ? `mcp_servers={one_task={command=${JSON.stringify(mcp.command)},args=${JSON.stringify(mcp.args)},required=true,enabled_tools=["one_task_mcp_search","one_task_mcp_call","one_task_read","one_task_source","one_task_check_finding","one_task_note","one_task_ask"],tools={one_task_mcp_search={approval_mode="approve"},one_task_mcp_call={approval_mode="approve"},one_task_read={approval_mode="approve"},one_task_source={approval_mode="approve"},one_task_check_finding={approval_mode="approve"},one_task_note={approval_mode="approve"},one_task_ask={approval_mode="approve"}},env_vars=${JSON.stringify(Object.keys(mcp.env))}}}` : 'mcp_servers={}')
  args.push('-c', 'shell_environment_policy.exclude=["*TOKEN*","*KEY*","*SECRET*"]')
  if (opts.env?.ONE_CODEX_MODEL || process.env.ONE_CODEX_MODEL) args.push('--model', (opts.env?.ONE_CODEX_MODEL || process.env.ONE_CODEX_MODEL)!)
  args.push('-')
  return args
}

export async function runCodex(opts: CodexRun): Promise<CodexResult> {
  const result: CodexResult = { ok: false, stopped: false, limited: false, text: '', steps: 0 }
  if (opts.agent !== 'codex') return { ...result, error: 'Local tasks require the local agent adapter.' }
  if (opts.signal.aborted) return { ...result, stopped: true }
  const env: NodeJS.ProcessEnv = { ...(opts.env ?? process.env), ...(opts.taskMcp?.env ?? {}), [RUN_MARK]: randomBytes(20).toString('hex') }
  const bin = findCodex(env)
  const help = await execFileSafe(bin, ['exec', '--help'], { timeoutMs: 8000, cwd: tmpdir(), env, maxBuffer: 100000 })
  if (help.code || !help.stdout.includes('--ignore-user-config')) return { ...result, error: 'Install or update Codex CLI on this computer (codex exec must support --ignore-user-config). Set CODEX_BIN if it is not on PATH.' }
  const started = spawnSafe(bin, codexArgs(opts), { cwd: opts.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true })
  if (!started.ok) return { ...result, error: 'Codex CLI could not start. Check CODEX_BIN and retry.' }
  const child = started.child
  const tree = child.pid ? new RunTree(child.pid, env[RUN_MARK]!) : null
  const secrets = Object.entries(env).filter(([k, v]) => /TOKEN|KEY|SECRET|PASSWORD/.test(k) && v && v.length >= 8).map(([,v]) => v!)
  const safe = (s: string) => secrets.reduce((text, secret) => text.split(secret).join('<secret>'), s)
  let diagnostic = ''
  let error = ''
  let bytes = 0
  let ended = false
  const stop = () => { result.stopped = true; void killTree(child) }
  opts.signal.addEventListener('abort', stop, { once: true })
  if (opts.signal.aborted) stop()
  const timer = setTimeout(() => { error = 'The coding agent exceeded 30 minutes.'; void killTree(child) }, 30 * 60000)
  const beat = setInterval(() => opts.log({ t: Date.now(), k: 'info', s: `${opts.agent === 'local' ? 'Local coding agent' : 'Codex'} is still working…` }), 60000)
  timer.unref(); beat.unref()
  const lines = createInterface({ input: child.stdout! })
  lines.on('line', raw => {
    bytes += Buffer.byteLength(raw)
    if (bytes > 8 * 1024 * 1024 || raw.length > 512000) { error = 'The coding agent exceeded its output limit.'; void killTree(child); return }
    try {
      const event = JSON.parse(raw)
      const item = event.item
      if (event.type === 'error' || event.type === 'turn.failed') error = safe(event.message || event.error?.message || 'Codex failed')
      if (event.type === 'item.started' && item?.type === 'command_execution') tree?.bashStart(item.id)
      if (event.type === 'item.completed') {
        if (item?.type === 'command_execution') tree?.bashEnd(item.id)
        if (item?.type === 'agent_message' && typeof item.text === 'string') result.text = safe(item.text).slice(0, opts.textOnly ? 250001 : 60000)
        if (['command_execution', 'mcp_tool_call', 'file_change'].includes(item?.type)) {
          result.steps++
          opts.progress?.({ turns: result.steps, maxTurns: opts.maxSteps, cost: opts.agent === 'local' ? 0 : null, model: opts.agent === 'local' ? 'Ollama' : 'Codex' })
          const detail = item.command || item.tool || (item.changes ?? []).map((c: { path?: string }) => c.path).join(', ')
          opts.log({ t: Date.now(), k: 'info', s: safe(`${item.type}: ${String(detail).slice(0, 600)}`) })
          if (result.steps >= opts.maxSteps) { result.limited = true; void killTree(child) }
        }
      }
      if (event.type === 'turn.completed') { ended = true; tree?.atResult(); result.inputTokens = event.usage?.input_tokens; result.outputTokens = event.usage?.output_tokens }
    } catch { /* A diagnostic is never a successful agent event. */ }
  })
  child.stderr?.on('data', chunk => { diagnostic = (diagnostic + safe(chunk.toString())).slice(-4000); bytes += chunk.length; if (bytes > 8 * 1024 * 1024) void killTree(child) })
  child.stdin?.on('error', () => {})
  child.stdin?.end(opts.prompt)
  const code = await new Promise<number | null>(resolve => {
    child.once('exit', resolve)
    child.once('error', () => { error = 'Codex CLI could not start.'; resolve(null) })
  })
  tree?.exited()
  clearTimeout(timer); clearInterval(beat)
  opts.signal.removeEventListener('abort', stop)
  lines.close()
  const leftovers = await tree?.end()
  if (leftovers?.n) opts.log({ t: Date.now(), k: 'info', s: `Stopped ${leftovers.n} process(es) left by the coding agent.` })
  result.ok = code === 0 && ended && !error && !result.limited && !result.stopped
  if (!result.ok) result.error = error || (diagnostic.trim() ? diagnostic.trim() : '') || (result.limited ? 'The coding agent reached its step limit.' : result.stopped ? 'Stopped in One.' : 'Codex did not finish successfully. Run codex login on this computer for cloud tasks, or check Ollama for local tasks.')
  return result
}
