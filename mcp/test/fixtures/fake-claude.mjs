#!/usr/bin/env node
/**
 * A stand-in for the Claude Code CLI (CLAUDE_BIN) for the worker's tests and the e2e spec — it never calls
 * any API. It speaks `-p --output-format stream-json`, reads the prompt from stdin and acts on markers in
 * the task text:
 *   plan mode            → hands in a plan (ExitPlanMode)
 *   implement            → writes feature.txt (the task title; "BROKEN" with FAKE:FAILTEST until a rework
 *                          note exists), reports progress through the task tools (one_task_note)
 *   FAKE:ASK             → asks a question (one_task_ask) until the prompt carries answers
 *   FAKE:SLOW            → keeps "working" until it is killed (Stop)
 *   FAKE:QUIET           → says nothing for 20 s (the worker's sign of life), then ends
 *   FAKE:EXPENSIVE       → costs $4.00
 *   FAKE:DEMO            → a realistic TypeScript change to src/login.ts (the changelog screenshot)
 * The task tools are reached like Claude Code does: the MCP server from --mcp-config, over stdio.
 * FAKE_CLAUDE_LOG=<file> appends {args, cwd} per run.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
if (args.includes('--version')) {
  process.stdout.write('9.9.9 (Claude Code)\n')
  process.exit(0)
}
if (args.includes('--help')) {
  process.stdout.write(`Usage: claude [options] [command] [prompt]
  --max-budget-usd <amount>             Maximum dollar amount to spend on API calls (only works with --print)
  --permission-mode <mode>              Permission mode to use for the session
                                        (choices: "acceptEdits", "default", "plan")
`)
  process.exit(0)
}
if (process.env.FAKE_CLAUDE_LOG) appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify({ args, cwd: process.cwd() })}\n`)
if (args.some((a) => /dangerously|bypass/i.test(a))) {
  process.stderr.write('fake-claude: refusing a bypassing flag\n')
  process.exit(3)
}

const arg = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}
const mode = arg('--permission-mode')
const session = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0'
const out = (ev) => process.stdout.write(`${JSON.stringify({ ...ev, session_id: session })}\n`)
const say = (text) => out({ type: 'assistant', message: { content: [{ type: 'text', text }] } })
const tool = (name, input) => out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `tu_${Math.random().toString(36).slice(2)}`, name, input } ] } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let prompt = ''
for await (const chunk of process.stdin) prompt += chunk

out({ type: 'system', subtype: 'init', permissionMode: mode, cwd: process.cwd(), tools: [] })

/** Call a task tool through the MCP server Claude Code was given (--mcp-config). */
async function taskTool(name, input) {
  const file = arg('--mcp-config')
  if (!file) return null
  const cfg = JSON.parse(readFileSync(file, 'utf8')).mcpServers['one-task']
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
  const client = new Client({ name: 'fake-claude', version: '9.9.9' })
  await client.connect(new StdioClientTransport({ command: cfg.command, args: cfg.args, env: { PATH: process.env.PATH ?? '', ...cfg.env } }))
  try {
    tool(`mcp__one-task__${name}`, input)
    const res = await client.callTool({ name, arguments: input })
    return (res.content ?? []).map((c) => c.text ?? '').join('')
  } finally {
    await client.close()
  }
}

const result = (text, cost, extra = {}) => out({ type: 'result', subtype: 'success', is_error: false, num_turns: 3, total_cost_usd: cost, result: text, ...extra })
const title = /^# (.+)$/m.exec(prompt.split('<<<TASK')[1] ?? '')?.[1]?.trim() ?? 'task'
const hasAnswers = prompt.includes('<<<ANSWERS')
const hasRework = prompt.includes('<<<REWORK')

if (mode === 'plan') {
  say('Reading the repository.')
  tool('Read', { file_path: join(process.cwd(), 'README.md') })
  const plan = `## Steps\n1. Add \`feature.txt\` with the task title.\n2. Run the checks.\n\n## Risks\nNone.`
  tool('ExitPlanMode', { plan })
  result(plan, 0.05)
  process.exit(0)
}

if (prompt.includes('FAKE:ASK') && !hasAnswers) {
  say('One thing is unclear.')
  const answer = await taskTool('one_task_ask', { question: 'Which colour should the button have?' })
  say(answer ?? '')
  result('Waiting for the answer about the colour.', 0.02)
  process.exit(0)
}

if (prompt.includes('FAKE:QUIET')) {
  await sleep(20_000)
  result('quiet done', 0.01)
  process.exit(0)
}

if (prompt.includes('FAKE:SLOW')) {
  for (let i = 0; i < 600; i++) {
    say(`Working… step ${i + 1}`)
    await sleep(100)
  }
  result('slow done', 0.01)
  process.exit(0)
}

// a realistic change for screenshots: the login form shows the error under the field
const login = join(process.cwd(), 'src', 'login.ts')
if (prompt.includes('FAKE:DEMO') && existsSync(login)) {
  say('Reading src/login.ts — the form fails silently on a wrong password.')
  tool('Read', { file_path: login })
  tool('Edit', { file_path: login })
  writeFileSync(
    login,
    `export interface LoginResult {\n  ok: boolean\n  /** shown under the field it belongs to */\n  error?: { field: 'user' | 'password'; message: string }\n}\n\nexport function login(user: string, password: string): LoginResult {\n  if (!user) return { ok: false, error: { field: 'user', message: 'Enter your email address.' } }\n  if (password.length < 8) return { ok: false, error: { field: 'password', message: 'The password is too short.' } }\n  return { ok: true }\n}\n`,
  )
  await taskTool('one_task_note', { text: 'login() now returns the field and a message; the form can show it.' })
  say('Done: login() names the field and the message.')
  result('- `login()` returns `error: { field, message }`\n- Wrong or short passwords name the password field', 0.14)
  process.exit(0)
}

const broken = prompt.includes('FAKE:FAILTEST') && !hasRework
const colour = /A: (.+)/.exec(prompt.split('<<<ANSWERS')[1] ?? '')?.[1]?.trim()
const file = join(process.cwd(), 'feature.txt')
tool('Write', { file_path: file, content: '…' })
writeFileSync(file, `${title}\n${broken ? 'BROKEN' : 'ok'}${colour ? `\ncolour: ${colour}` : ''}\n`)
await taskTool('one_task_note', { text: `Wrote ${file} for "${title}".` })
say(`Added feature.txt for "${title}".`)
result(`- Added \`feature.txt\` (${broken ? 'first try' : 'checks pass'})${colour ? `\n- Colour: ${colour}` : ''}`, prompt.includes('FAKE:EXPENSIVE') ? 4 : 0.12)
