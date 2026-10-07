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
 *   FAKE:AUTH            → the CLI's expired login (an error result that says "success")
 *   FAKE:LIVE            → writes live.txt at once, then works 8 s (the live diff during a stage)
 *   FAKE:EXPENSIVE       → costs $4.00
 *   FAKE:DEMO            → a realistic TypeScript change to src/login.ts (the changelog screenshot)
 *   FAKE:DEMOLIVE        → the same change at a working pace, ~20 s (the running panel's screenshot)
 *   FAKE:PLANFILE        → plan mode without ExitPlanMode: the plan goes to ~/.claude/plans/fake-plan.md
 *   FAKE:TOOLS           → lists the task tools' read-only hints (in the plan / document)
 *   document stage       → "## Stage: … (doc)": a document from the task (the working folder's name in it);
 *                          FAKE:CASES adds a json block of two test cases; FAKE:DEMODOC writes a realistic
 *                          analysis / specification (the changelog screenshot); FAKE:PAGES a document with two
 *                          ## sections (+ a fenced "## " that is no heading); FAKE:STORIES (in a stage named
 *                          "Stories") a json block of three stories; with "Changes on the branch" in the prompt it names the files the diff touches
 * The task tools are reached like Claude Code does: the MCP server from --mcp-config, over stdio.
 * FAKE_CLAUDE_LOG=<file> appends {args, cwd} per run.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

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
const MODEL = 'claude-opus-5-5'
let turn = 0
// every message is its own turn, with token counts like the real CLI's (the worker's cost estimate)
const message = (content) => ({ id: `msg_${String(++turn).padStart(4, '0')}`, model: MODEL, content, usage: { input_tokens: 1200, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 4000 } })
const say = (text) => out({ type: 'assistant', message: message([{ type: 'text', text }]) })
const tool = (name, input) => out({ type: 'assistant', message: message([{ type: 'tool_use', id: `tu_${Math.random().toString(36).slice(2)}`, name, input }]) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let prompt = ''
for await (const chunk of process.stdin) prompt += chunk

out({ type: 'system', subtype: 'init', permissionMode: mode, cwd: process.cwd(), tools: [], model: MODEL })

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

/** The task tools' read-only hints, as Claude Code sees them ("one_task_ask:ro, …"). */
async function toolHints() {
  const file = arg('--mcp-config')
  if (!file) return ''
  const cfg = JSON.parse(readFileSync(file, 'utf8')).mcpServers['one-task']
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
  const client = new Client({ name: 'fake-claude', version: '9.9.9' })
  await client.connect(new StdioClientTransport({ command: cfg.command, args: cfg.args, env: { PATH: process.env.PATH ?? '', ...cfg.env } }))
  try {
    const { tools } = await client.listTools()
    return tools.map((t) => `${t.name}:${t.annotations?.readOnlyHint ? 'ro' : 'rw'}`).join(', ')
  } finally {
    await client.close()
  }
}

const result = (text, cost, extra = {}) => out({ type: 'result', subtype: 'success', is_error: false, num_turns: 3, total_cost_usd: cost, result: text, ...extra })
const title = /^# (.+)$/m.exec(prompt.split('<<<TASK')[1] ?? '')?.[1]?.trim() ?? 'task'
const hasAnswers = prompt.includes('<<<ANSWERS')
const hasRework = prompt.includes('<<<REWORK')

if (prompt.includes('FAKE:AUTH')) {
  // what the real CLI says when its login expired: an error result that still reads "success"
  out({ type: 'result', subtype: 'success', is_error: true, num_turns: 1, total_cost_usd: 0, result: 'Failed to authenticate: OAuth session expired and could not be refreshed' })
  process.exit(1)
}

if (mode === 'plan' && prompt.includes('FAKE:PLANFILE')) {
  // newer Claude Code: the plan goes to a plan file, ExitPlanMode is switched off in headless runs
  const tools = prompt.includes('FAKE:TOOLS') ? `\n\nTools: ${await toolHints()}` : ''
  const file = join(process.env.HOME ?? '.', '.claude', 'plans', 'fake-plan.md')
  const plan = `## Plan from the file\n1. Add \`feature.txt\`.${tools}`
  mkdirSync(join(process.env.HOME ?? '.', '.claude', 'plans'), { recursive: true })
  writeFileSync(file, plan)
  tool('Write', { file_path: file, content: plan })
  result('I wrote the plan to ~/.claude/plans/fake-plan.md.', 0.05)
  process.exit(0)
}

const DEMO_DOCS = {
  Analysis: '## Context\nInvoices above 5,000 EUR wait for a manual sign-off; today this runs by e-mail and takes 6 days on average.\n\n## Requirements\n- **FR-1** An invoice above the limit goes to the cost-centre owner for approval.\n- **FR-2** The owner approves or rejects with a reason; the requester sees it at once.\n- **NFR-1** A decision is possible within 2 working days (reminder after 1).\n\n## Open questions\n- Who approves when the owner is absent?',
  Specification: '## User stories\n**As a** cost-centre owner **I want** to approve invoices in one list **so that** nothing waits in my inbox.\n- Given an invoice above 5,000 EUR, when it is booked, then it appears in the owner\'s list.\n- Given a rejection, when it is saved, then the requester gets the reason.\n\n## Data model\n| Entity | Fields |\n|---|---|\n| Approval | invoice, owner, state, reason, decided at |',
  Record: 'Recorded the decision and FR-1 – FR-2 / NFR-1 in the knowledge base, linked to the existing record "Invoice process".',
}

const DEMO_EXPLAIN = {
  Overview: 'The billing service turns delivered orders into invoices, books the payments that come in and sends reminders.\n\n## Architecture\n```mermaid\nflowchart LR\n  Orders --> Engine[Invoice engine] --> PDF[PDF export]\n  Engine --> Tax[Tax rules]\n  Bank[Payment import] --> Engine\n```\n\n## How to run it\n`dotnet run --project Billing.Api` — needs the database `billing` and the folder `\\\\fs01\\invoices`.',
  Components: 'Four components; the invoice engine is the centre — everything else feeds it or reads from it.\n\n## Invoice engine\nCreates an invoice per delivered order (`InvoiceRun.cs`), numbers it and stores it.\n\n### How it works\n1. Reads the delivered orders of the day.\n2. Applies the tax rules.\n3. Rounds per line, then the total.\n\n## Tax rules\nVAT rates per country and the reverse-charge cases (`TaxTable.cs`).\n\n## PDF export\nRenders the invoice with the 2014 template (`InvoicePdf.cs`).\n\n## Payment import\nReads the bank\'s CAMT file every night and matches payments to invoices.',
  'Documentation check': '## Verdict\nA newcomer gets the service running from the README, but not how invoices are rounded.\n\n## Findings\n| Document | Finding | Evidence | Fix |\n|---|---|---|---|\n| README | No word on rounding | `InvoiceRun.cs:212` rounds per line | Add a section |\n| docs/tax.md | Rates from 2019 | `TaxTable.cs` has 2024 rates | Update the table |',
}

if (/^## Stage: .* \(doc\)$/m.test(prompt) && prompt.includes('FAKE:DEMOEXPLAIN')) {
  const stage = /^## Stage: (.*) \(doc\)$/m.exec(prompt)?.[1] ?? 'Overview'
  say('Reading the code and what is known about it.')
  tool('Read', { file_path: join(process.cwd(), 'README.md') })
  await sleep(400)
  result(DEMO_EXPLAIN[stage] ?? DEMO_EXPLAIN.Overview, 0.11)
  process.exit(0)
}

if (/^## Stage: .* \(doc\)$/m.test(prompt) && prompt.includes('FAKE:DEMODOC')) {
  const stage = /^## Stage: (.*) \(doc\)$/m.exec(prompt)?.[1] ?? 'Analysis'
  say('Reading the task and the pages it mentions.')
  tool('mcp__kb__search', { query: 'invoice approval' })
  await sleep(600)
  result(DEMO_DOCS[stage] ?? DEMO_DOCS.Analysis, 0.09)
  process.exit(0)
}

if (/^## Stage: .* \(doc\)$/m.test(prompt)) {
  say('Reading what is known.')
  tool('Read', { file_path: join(process.cwd(), 'README.md') })
  const tools = prompt.includes('FAKE:TOOLS') ? `\n\nTools: ${await toolHints()}` : ''
  const cases = prompt.includes('FAKE:CASES')
    ? '\n\n```json\n' + JSON.stringify([
        { id: 'TC-01', title: 'Sign in with a valid account', area: 'Login', type: 'functional', priority: 'high', preconditions: 'An account exists', steps: ['Open the login', 'Enter the address and password', 'Press Sign in'], expected: 'The dashboard opens' },
        { id: 'TC-02', title: 'Wrong password', area: 'Login', type: 'negative', priority: 'medium', preconditions: '', steps: ['Enter a wrong password'], expected: 'An error shows; no sign-in' },
      ], null, 2) + '\n```'
    : ''
  // the pages the task refers to (One sends their text along): how many, and their first finding
  const refs = (prompt.match(/^### .+ \((?:page|Seite) [A-Za-z0-9_-]+\)$/gm) ?? []).length
  const finding = /Finding 1: ([^\n]+)/.exec(prompt)?.[1]
  // a review: the branch's diff came along — which files it touches
  const diff = prompt.includes('## Changes on the branch (data)') ? `\n\nBranch diff: ${[...new Set([...prompt.matchAll(/^\+\+\+ b\/(\S+)$/gm)].map((m) => m[1]))].join(', ') || 'new files only'}` : ''
  const analysis = /Static analysis[^\n]*\n[\s\S]*?(exit code \d+)/.exec(prompt)?.[1]
  if (prompt.includes('FAKE:PAGES')) {
    result(`The system has two parts.${analysis ? ` Static analysis: ${analysis}.` : ''}\n\n## Billing\n\nCreates invoices.\n\n### How it works\n\n\`\`\`text\n## not a heading\n\`\`\`\n\n## Reports\n\nMonthly totals.`, 0.08)
    process.exit(0)
  }
  if (prompt.includes('FAKE:STORIES') && /^## Stage: Stories \(doc\)$/m.test(prompt)) {
    const stories = { project: 'Checkout', stories: [
      { title: 'Pay by card', story: 'As a buyer I want to pay by card so that I finish quickly.', criteria: ['Card form validates', 'Receipt shows'], priority: 'high' },
      { title: 'Save the address', story: 'As a buyer I want my address kept.', criteria: ['Address prefilled next time'], priority: 'medium' },
      { title: 'Order history', story: 'As a buyer I want to see my orders.', criteria: [], priority: 'low' },
    ] }
    result(`Three slices, card payment first.\n\n\`\`\`json\n${JSON.stringify(stories, null, 2)}\n\`\`\``, 0.06)
    process.exit(0)
  }
  result(`## Analysis\n\nThe document for “${title}”.\n\nWorking folder: ${basename(process.cwd())}\n\nReferences: ${refs}${finding ? `\n\nFirst finding: ${finding}` : ''}${diff}${tools}${cases}`, 0.07)
  process.exit(0)
}

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

if (prompt.includes('FAKE:LIVE')) {
  // changes a file early, then keeps working a while: the worker's live diff picks it up before the end
  tool('Write', { file_path: join(process.cwd(), 'live.txt'), content: '…' })
  writeFileSync(join(process.cwd(), 'live.txt'), 'first draft\n')
  for (let i = 0; i < 20; i++) {
    say(`Working… step ${i + 1}`)
    await sleep(400)
  }
  result('live done', 0.03)
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
const LOGIN_FIXED = `export interface LoginResult {\n  ok: boolean\n  /** shown under the field it belongs to */\n  error?: { field: 'user' | 'password'; message: string }\n}\n\nexport function login(user: string, password: string): LoginResult {\n  if (!user) return { ok: false, error: { field: 'user', message: 'Enter your email address.' } }\n  if (password.length < 8) return { ok: false, error: { field: 'password', message: 'The password is too short.' } }\n  return { ok: true }\n}\n`
// the same change, at a working pace (the running panel's screenshot: now-line, steps, estimate, files)
if (prompt.includes('FAKE:DEMOLIVE') && existsSync(login)) {
  say('Reading src/login.ts — the form fails silently on a wrong password.')
  tool('Read', { file_path: login })
  await sleep(600)
  tool('Edit', { file_path: login, old_string: readFileSync(login, 'utf8'), new_string: LOGIN_FIXED })
  writeFileSync(login, LOGIN_FIXED)
  const steps = [
    () => say('login() now returns the field and a message.'),
    () => tool('Grep', { pattern: 'login(', path: 'src' }),
    () => say('Checking where the form calls login() …'),
    () => tool('Read', { file_path: join(process.cwd(), 'README.md') }),
    () => say('The form shows error.message under error.field — no change needed there.'),
    () => tool('Bash', { command: 'node check.mjs' }),
    () => say('Checks pass. Writing the summary.'),
  ]
  for (const step of steps) {
    step()
    await sleep(2500)
  }
  result('- `login()` returns `error: { field, message }`\n- Wrong or short passwords name the password field', 0.14)
  process.exit(0)
}
if (prompt.includes('FAKE:DEMO') && existsSync(login)) {
  say('Reading src/login.ts — the form fails silently on a wrong password.')
  tool('Read', { file_path: login })
  tool('Edit', { file_path: login, old_string: readFileSync(login, 'utf8'), new_string: LOGIN_FIXED })
  writeFileSync(login, LOGIN_FIXED)
  await taskTool('one_task_note', { text: 'login() now returns the field and a message; the form can show it.' })
  say('Done: login() names the field and the message.')
  result('- `login()` returns `error: { field, message }`\n- Wrong or short passwords name the password field', 0.14)
  process.exit(0)
}

const broken = prompt.includes('FAKE:FAILTEST') && !hasRework
const colour = /A: (.+)/.exec(prompt.split('<<<ANSWERS')[1] ?? '')?.[1]?.trim()
const file = join(process.cwd(), 'feature.txt')
const content = `${title}\n${broken ? 'BROKEN' : 'ok'}${colour ? `\ncolour: ${colour}` : ''}\n`
tool('Write', { file_path: file, content })
writeFileSync(file, content)
await taskTool('one_task_note', { text: `Wrote ${file} for "${title}".` })
say(`Added feature.txt for "${title}".`)
result(`- Added \`feature.txt\` (${broken ? 'first try' : 'checks pass'})${colour ? `\n- Colour: ${colour}` : ''}`, prompt.includes('FAKE:EXPENSIVE') ? 4 : 0.12)
