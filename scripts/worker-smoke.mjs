#!/usr/bin/env node
/**
 * Smoke test of the coding worker as a person gets it — on macOS, Linux and Windows (CI: .github/workflows/mcp.yml):
 *  - the built public/mcp/one-worker.mjs with a download's preset line (workspace, origin, port, pairing key), saved in
 *    the Downloads folder of a home folder with a space and an umlaut ("Smoke Jürgen");
 *  - started with the very line One's card shows for this computer (src/app/features/coding/startLines.ts: cmd on
 *    Windows — PowerShell's too when $HOME follows the test home —, sh elsewhere), the port set by that line;
 *  - Claude Code = a dependency-free fake installed as a real npm global package (npm's own shim on Windows), found by
 *    its name on PATH — no CLAUDE_BIN; `check` must find it;
 *  - a repository whose test is `npm test` (npm's own npm.cmd on Windows) with a local bare remote;
 *  - a fake One tab pairs and hands out plan → implement → test → commit: every outcome ok, the commit on the task's
 *    branch, and no frame the worker sent holds this machine's paths — the home folders, the temp folder, the user name
 *    inside a path, an 8.3 short name — in any case, slash, MSYS, JSON-escaped or percent-encoded form.
 * No network (npm --offline, a local remote), no fixed port. Exit 1 with a report.
 *   npm ci --prefix mcp && npm --prefix mcp run build && node scripts/worker-smoke.mjs [--keep] [--frames <file>]
 * macOS / Linux: the scrubber promises a path as written (scrub.ts) — a percent-encoded one (file:///…%20…) is reported
 * as a note there, not a failure; on Windows every form counts.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { homedir, tmpdir, userInfo } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BUNDLE = join(ROOT, 'public', 'mcp', 'one-worker.mjs')
const WIN = process.platform === 'win32'
const KEEP = process.argv.includes('--keep')
const FRAMES = process.argv.includes('--frames') ? process.argv[process.argv.indexOf('--frames') + 1] : null
const STAGE_MS = 90_000

/* ------------------------------------------------------------------ the report */

const checks = []
let failed = false
/** ok: true · false (fails the smoke) · null (skipped) · 'note' (said, never a failure) */
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail })
  if (ok === false) failed = true
  process.stdout.write(`${ok === null ? 'skip' : ok === 'note' ? 'note' : ok ? ' ok ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}\n`)
  return ok
}
class Stop extends Error {}
const must = (name, ok, detail) => {
  if (!check(name, ok, detail)) throw new Stop(name)
}

/* ------------------------------------------------------------------ what the app and the worker share */

// the app's own start lines (pure TypeScript, no imports: Node ≥ 22.18 strips the types) and the protocol's constants
let startLines
let WORKER_SUBPROTOCOL
try {
  ;({ startLines } = await import(pathToFileURL(join(ROOT, 'src', 'app', 'features', 'coding', 'startLines.ts')).href))
  ;({ WORKER_SUBPROTOCOL } = await import(pathToFileURL(join(ROOT, 'src', 'app', 'features', 'coding', 'protocol.ts')).href))
} catch (e) {
  process.stderr.write(`worker-smoke: cannot load the app's TypeScript (${e.message}) — it needs Node.js 22.18 or newer\n`)
  process.exit(1)
}
// ws from the bridge's own install (npm ci --prefix mcp): the root's node_modules are not needed
const WebSocket = createRequire(join(ROOT, 'mcp', 'package.json'))('ws')

/* ------------------------------------------------------------------ helpers */

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(ok, ms, what) {
  const end = Date.now() + ms
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out: ${what()}`)
    await sleep(50)
  }
}

/** npm's own CLI script (the one next to this node — or the npm running us). */
function npmCli() {
  const near = WIN ? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js') : join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  for (const p of [process.env.npm_execpath, near]) if (p && /npm-cli\.js$/.test(p) && existsSync(p)) return p
  throw new Error('npm-cli.js not found next to node')
}

/** PATH under the key this environment keeps it ("Path" on most Windows machines). */
const pathKeyOf = (env) => Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'

/** git for the test's own setup (never with a working folder that could hold a planted program — exec.ts' rule). */
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: smokeEnv, stdio: ['ignore', 'pipe', 'pipe'] })

/* ------------------------------------------------------------------ leak forms */

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Every way `p` may be written: as is, JSON-escaped; Windows also any case, "/", MSYS /c/…, percent-encoded. */
function forms(p) {
  const out = new Set([p, JSON.stringify(p).slice(1, -1)])
  if (WIN) {
    const fwd = p.replace(/\\/g, '/')
    out.add(fwd)
    out.add(encodeURI(fwd))
    const drive = /^([A-Za-z]):\//.exec(fwd)
    if (drive) for (const pre of ['/', '/cygdrive/', '/mnt/']) out.add(`${pre}${drive[1].toLowerCase()}${fwd.slice(2)}`)
  }
  return [...out].filter((f) => f.length > 3).map((f) => (WIN ? f.toLowerCase() : f))
}

/** The 8.3 forms of the folders TEMP / TMP / LOCALAPPDATA name in short form (C:\Users\RUNNER~1). */
function shortForms() {
  if (!WIN) return []
  const out = new Set()
  for (const key of ['TEMP', 'TMP', 'LOCALAPPDATA']) {
    const v = process.env[key] ?? ''
    const parts = v.split(/[\\/]/)
    const i = parts.findIndex((x) => x.includes('~'))
    if (i >= 1) out.add(parts.slice(0, i + 1).join('\\'))
  }
  return [...out]
}

/* ------------------------------------------------------------------ the fake Claude Code */

const FAKE_CLI = String.raw`#!/usr/bin/env node
// A dependency-free stand-in for Claude Code (worker smoke): stream-json, plan mode → ExitPlanMode, else writes
// feature.txt. It says its working folder in every form Windows and Git Bash write one — the worker must scrub them all.
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')
const args = process.argv.slice(2)
if (args.includes('--version')) { process.stdout.write('9.9.9 (Claude Code)\n'); process.exit(0) }
if (args.includes('--help')) {
  process.stdout.write('Usage: claude [options]\n  --max-budget-usd <amount>  Maximum dollar amount\n  --setting-sources <sources>  Comma-separated list of setting sources\n  --permission-mode <mode>  Permission mode (choices: "acceptEdits", "default", "plan")\n')
  process.exit(0)
}
const arg = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null)
const mode = arg('--permission-mode')
let turn = 0
const out = (ev) => process.stdout.write(JSON.stringify({ ...ev, session_id: 'smoke' }) + '\n')
const message = (content) => ({ id: 'msg_' + ++turn, model: 'claude-smoke', content, usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } })
const say = (text) => out({ type: 'assistant', message: message([{ type: 'text', text }]) })
const tool = (name, input) => out({ type: 'assistant', message: message([{ type: 'tool_use', id: 'tu_' + turn, name, input }]) })
const result = (text) => out({ type: 'result', subtype: 'success', is_error: false, num_turns: turn, total_cost_usd: 0.01, result: text })
let prompt = ''
process.stdin.on('data', (d) => (prompt += d))
process.stdin.on('end', () => {
  out({ type: 'system', subtype: 'init', permissionMode: mode, cwd: process.cwd(), tools: [], model: 'claude-smoke' })
  const cwd = process.cwd()
  const fwd = cwd.replace(/\\/g, '/')
  const msys = fwd.replace(/^([A-Za-z]):/, (m, d) => '/' + d.toLowerCase())
  say('Working in ' + cwd + ' | ' + fwd + ' | ' + msys + ' | ' + JSON.stringify(cwd) + ' | file:///' + encodeURI(fwd.replace(/^\//, '')) + ' | ' + cwd.toUpperCase())
  if (mode === 'plan') {
    const plan = '## Steps\n1. Add feature.txt.\n\nRead in ' + cwd
    tool('ExitPlanMode', { plan })
    result(plan)
    return
  }
  const file = join(cwd, 'feature.txt')
  tool('Write', { file_path: file, content: 'ok\n' })
  writeFileSync(file, 'ok\n')
  result('- Added feature.txt in ' + cwd)
})
`

/* ------------------------------------------------------------------ setup */

const base = (WIN ? realpathSync.native : realpathSync)(mkdtempSync(join(tmpdir(), 'one-smoke-')))
const home = join(base, 'Smoke Jürgen')
const PAIR = randomBytes(32).toString('base64url')
const WS = { id: 'local:smoke-ws-1', name: 'Smoke', kind: 'local', readOnly: false }
const ORIGIN = 'http://127.0.0.1:5350'
let smokeEnv = { ...process.env }
let worker = null
let workerOut = ''
const frames = []

function stopWorker() {
  if (!worker || worker.exitCode !== null) return
  // the start line runs node under cmd / sh: the whole tree goes
  if (WIN) spawnSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(worker.pid), '/T', '/F'], { stdio: 'ignore' })
  else {
    try {
      process.kill(-worker.pid, 'SIGTERM')
    } catch {
      /* gone */
    }
  }
}

/** Run a start line in its own shell, as the person would paste it. */
function runLine(line, shell, opts = {}) {
  if (shell === 'cmd') {
    const cmd = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe')
    return spawn(cmd, ['/d', '/s', '/c', `"${line}"`], { env: smokeEnv, windowsVerbatimArguments: true, stdio: ['ignore', 'pipe', 'pipe'], ...opts })
  }
  if (shell === 'powershell') {
    // UTF-8 out: the console's code page would garble "Jürgen"
    const ps = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    return spawn(ps, ['-NoProfile', '-NonInteractive', '-Command', `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${line}`], { env: smokeEnv, stdio: ['ignore', 'pipe', 'pipe'], ...opts })
  }
  return spawn('sh', ['-c', line], { env: smokeEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: true, ...opts })
}

const collect = (child) =>
  new Promise((resolve) => {
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    child.on('close', (code) => resolve({ code, out }))
  })

async function main() {
  process.stdout.write(`worker smoke · ${process.platform} · Node ${process.versions.node} · ${BUNDLE}\n`)
  must('the worker is built', existsSync(BUNDLE), 'npm --prefix mcp run build')
  for (const d of ['Downloads', 'code', 'remotes', join('.config', 'one')]) mkdirSync(join(home, d), { recursive: true })

  // the person's environment: this home folder everywhere a program looks for it, an identity for git, npm quiet
  const pathKey = pathKeyOf(process.env)
  const npmGlobal = join(home, WIN ? join('AppData', 'Roaming', 'npm') : '.npm-global')
  const npmBin = WIN ? npmGlobal : join(npmGlobal, 'bin')
  smokeEnv = { ...process.env, HOME: home, USERPROFILE: home, [pathKey]: `${npmBin}${delimiter}${process.env[pathKey] ?? ''}`, ONE_WORKER_BROWSER: 'none', npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false' }
  if (WIN) {
    // Windows PowerShell 5.1 takes $HOME from these
    const [, drive, rest] = /^([A-Za-z]:)(.*)$/.exec(home)
    Object.assign(smokeEnv, { HOMEDRIVE: drive, HOMEPATH: rest })
  }
  for (const k of Object.keys(smokeEnv)) if (/^(CLAUDE_BIN|ONE_WORKER_(?!BROWSER)\w+|GIT_CONFIG_\w+|NODE_OPTIONS)$/i.test(k)) delete smokeEnv[k]
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Smoke Person\n\temail = smoke@example.invalid\n[init]\n\tdefaultBranch = main\n')

  // Claude Code, installed with npm the way people do it (from a tarball here: offline, its own cache)
  const npm = (args, cwd) => execFileSync(process.execPath, [npmCli(), ...args, '--offline', '--cache', join(base, 'npm-cache'), '--loglevel=error'], { cwd, env: smokeEnv, encoding: 'utf8' })
  const pkg = join(base, 'claude-pkg')
  mkdirSync(pkg)
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'claude-code-smoke', version: '9.9.9', bin: { claude: 'cli.js' } }))
  writeFileSync(join(pkg, 'cli.js'), FAKE_CLI)
  npm(['pack', '--pack-destination', base], pkg)
  npm(['install', '--global', '--prefix', npmGlobal, '--ignore-scripts', join(base, 'claude-code-smoke-9.9.9.tgz')], base)
  must('Claude Code installed with npm', existsSync(join(npmBin, WIN ? 'claude.cmd' : 'claude')), npmBin)

  // the repository: `npm test`, a local bare remote
  const repo = join(home, 'code', 'shop')
  const remote = join(home, 'remotes', 'shop.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote], { env: smokeEnv })
  execFileSync('git', ['init', '-q', '-b', 'main', repo], { env: smokeEnv })
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'shop', version: '1.0.0', private: true, scripts: { test: 'node check.mjs' } }, null, 2))
  writeFileSync(join(repo, 'check.mjs'), "import { existsSync } from 'node:fs'\nconsole.log('checking in ' + process.cwd())\nif (!existsSync('feature.txt')) { console.log('FAIL no feature.txt'); process.exit(1) }\nconsole.log('PASS 1 check')\n")
  writeFileSync(join(repo, 'README.md'), '# Shop\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'initial')
  git(repo, 'remote', 'add', 'origin', remote)
  git(repo, 'push', '-q', '-u', 'origin', 'main')
  writeFileSync(join(home, '.config', 'one', 'worker.json'), `${JSON.stringify({ workspace: WS.id, name: 'smoke-box', repos: [{ name: 'shop', path: '~/code/shop', baseBranch: 'main', remote: 'origin', testCommand: ['npm', 'test'], push: false, pr: 'none' }] }, null, 2)}\n`)

  // the download: the bundle with its preset line, in Downloads; the preset's port is not the one the line sets
  const port = await freePort()
  const src = readFileSync(BUNDLE, 'utf8')
  const nl = src.indexOf('\n')
  const preset = { workspace: WS.id, origin: ORIGIN, port: 47322, pair: PAIR, name: WS.name }
  writeFileSync(join(home, 'Downloads', 'one-worker.mjs'), `${src.slice(0, nl + 1)}globalThis.ONE_WORKER_PRESET = ${JSON.stringify(preset)}\n${src.slice(nl + 1)}`)

  const os = WIN ? 'windows' : 'posix'
  const shell = WIN ? 'cmd' : 'sh'
  const lineFor = (opts) => startLines('one-worker.mjs', { os, ...opts }).find((l) => l.shell === shell).line

  // `check` through the card's line: Claude Code found by its name (Windows: through npm's shim), the repo ok
  const checkLine = lineFor({ args: ['check'] })
  const checked = await collect(runLine(checkLine, shell))
  must(`check (${shell}: ${checkLine})`, checked.code === 0 && /All good\./.test(checked.out), checked.out.trim().split('\n').slice(-6).join(' / '))
  check('check finds Claude Code by its name', new RegExp(`claude {5}9\\.9\\.9${WIN ? ' · npm shim → .*cli\\.js' : ''}`).test(checked.out), /claude .*/.exec(checked.out)?.[0] ?? '')

  // PowerShell's line too, where $HOME follows this home folder (Windows PowerShell 5.1: HOMEDRIVE + HOMEPATH)
  if (WIN) {
    const ps = startLines('one-worker.mjs', { os, args: ['--version'] }).find((l) => l.shell === 'powershell').line
    const where = await collect(runLine('Write-Output $HOME', 'powershell'))
    if (where.out.trim().toLowerCase() === home.toLowerCase()) {
      const v = await collect(runLine(ps, 'powershell'))
      check(`PowerShell line (${ps})`, v.code === 0 && /^\d+\.\d+\.\d+/m.test(v.out), v.out.trim().slice(0, 200))
    } else check('PowerShell line', null, `$HOME is ${where.out.trim() || '(nothing)'} here, not the test home — the owner's checklist covers it`)
  }

  // start: the card's line with the port
  const startLine = lineFor({ port, args: ['--no-browser'] })
  process.stdout.write(`      start (${shell}): ${startLine}\n`)
  worker = runLine(startLine, shell)
  worker.stdout.on('data', (d) => (workerOut += d))
  worker.stderr.on('data', (d) => (workerOut += d))
  await waitFor(() => /ready on ws:\/\/127\.0\.0\.1:\d+|cannot listen|in use/.test(workerOut) || worker.exitCode !== null, 30_000, () => workerOut)
  must('the worker listens on the port the start line set', new RegExp(`ready on ws://127\\.0\\.0\\.1:${port}\\b`).test(workerOut), workerOut.trim().split('\n').slice(-3).join(' / '))

  // the One tab: pairs, takes the welcome, hands out the stages
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, [WORKER_SUBPROTOCOL], { origin: ORIGIN })
  const queue = []
  const outcomes = []
  let welcome = null
  ws.on('message', (d) => {
    const text = d.toString()
    frames.push(text)
    const msg = JSON.parse(text)
    if (msg.type === 'welcome') welcome = msg
    if (msg.type !== 'req') return
    const reply = (result) => ws.send(JSON.stringify({ type: 'res', id: msg.id, ok: true, result }))
    if (msg.op === 'next') return reply({ task: queue.shift() ?? null })
    if (msg.op === 'heartbeat') return reply({ ok: true })
    if (msg.op === 'finish') {
      outcomes.push(msg)
      return reply({ ok: true })
    }
  })
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  ws.send(JSON.stringify({ type: 'hello', app: 'one', version: 'smoke', workspace: WS, pair: PAIR }))
  await waitFor(() => welcome !== null, 10_000, () => frames.slice(-3).join('\n'))
  must('paired: the welcome names the repo', welcome.repos?.[0]?.name === 'shop' && welcome.claude?.found === true, JSON.stringify({ repos: welcome.repos, claude: welcome.claude }))

  const stage = (kind, extra = {}) => ({ id: `st-${kind}`, name: kind[0].toUpperCase() + kind.slice(1), instructions: '', permissionMode: kind === 'plan' ? 'plan' : 'acceptEdits', maxTurns: 10, gitAction: null, model: null, kind, ...extra })
  let branch = null
  const run = async (kind, extra = {}, stageExtra = {}) => {
    const before = outcomes.length
    queue.push({ id: 'smoke1abc', title: 'Add the feature file', repo: 'shop', stage: stage(kind, stageExtra), text: 'Goal: a feature file.', rework: null, answers: [], branch, spent: 0, summary: null, trusted: true, ...extra })
    ws.send(JSON.stringify({ type: 'nudge' }))
    await waitFor(() => outcomes.length > before, STAGE_MS, () => `${kind}: ${workerOut.trim().split('\n').slice(-3).join(' / ')}`)
    return outcomes[outcomes.length - 1].outcome
  }

  const plan = await run('plan')
  must('plan', plan.status === 'ok' && /## Steps/.test(plan.plan ?? '') && !!plan.branch, JSON.stringify(plan).slice(0, 300))
  branch = plan.branch
  const impl = await run('implement')
  must('implement (Claude Code through its npm install)', impl.status === 'ok', JSON.stringify(impl).slice(0, 300))
  const tested = await run('test')
  must(`test (\`npm test\`${WIN ? ' through npm.cmd' : ''})`, tested.status === 'ok' && tested.test?.ok === true && /PASS 1 check/.test(tested.test?.output ?? ''), JSON.stringify(tested).slice(0, 400))
  const commit = await run('git', { summary: '- Added feature.txt' }, { gitAction: 'commit' })
  must('commit', commit.status === 'ok', JSON.stringify(commit).slice(0, 300))
  const subject = git(repo, 'log', '-1', '--format=%s', branch).trim()
  const files = git(repo, 'show', '--name-only', '--format=', branch).trim().split(/\r?\n/)
  check('the commit is on the task\'s branch', subject === 'Add the feature file' && files.includes('feature.txt'), `${branch}: ${subject} · ${files.join(', ')}`)
  check('the main checkout stays on main', git(repo, 'branch', '--show-current').trim() === 'main')

  // nothing of this machine's paths in any frame
  const all = WIN ? frames.join('\n').toLowerCase() : frames.join('\n')
  const user = userInfo().username
  const paths = [home, base, tmpdir(), homedir(), repo, npmGlobal, ...shortForms()]
  const found = []
  for (const p of paths) for (const f of forms(p)) if (all.includes(f)) found.push(`${p} as ${f}`)
  for (const lit of ['Jürgen', ...(WIN ? [encodeURIComponent('Jürgen')] : [])]) if (all.includes(WIN ? lit.toLowerCase() : lit)) found.push(lit)
  if (user && user.length > 1 && new RegExp(`[\\\\/]${esc(user)}(?:[\\\\/"]|$)`, WIN ? 'im' : 'm').test(all)) found.push(`the user name ${user} inside a path`)
  const short = user.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase()
  if (WIN && short && new RegExp(`${esc(short)}~\\d`, 'i').test(all)) found.push(`${short}~n (8.3)`)
  check(`no path of this machine in ${frames.length} frames`, found.length === 0, found.slice(0, 5).join(' · '))
  if (!WIN) {
    const at = all.indexOf(encodeURIComponent('Jürgen'))
    if (at >= 0) check('a percent-encoded path (file:///…) went out — macOS / Linux scrub paths as written only', 'note', all.slice(Math.max(0, at - 60), at + 40))
  }
  if (FRAMES) writeFileSync(FRAMES, frames.join('\n'))
  check('the working folder was said and scrubbed', frames.some((f) => /Working in \./.test(f)), 'the fake says its folder in every form; One gets "."')
}

let crashed = null
try {
  await main()
} catch (e) {
  if (!(e instanceof Stop)) {
    crashed = e
    check('the smoke ran to its end', false, e instanceof Error ? e.stack ?? e.message : String(e))
  }
} finally {
  stopWorker()
  await sleep(300)
  if (KEEP) process.stdout.write(`kept: ${base}\n`)
  else
    try {
      rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    } catch (e) {
      process.stdout.write(`(temp folder left behind: ${e.message})\n`)
    }
}
const bad = checks.filter((c) => c.ok === false)
const passed = checks.filter((c) => c.ok === true).length
const aside = [checks.some((c) => c.ok === null) && 'some skipped', checks.some((c) => c.ok === 'note') && 'notes above'].filter(Boolean).join(', ')
process.stdout.write(`\n${bad.length ? `WORKER SMOKE FAILED — ${bad.length} of ${checks.length} checks` : `worker smoke passed — ${passed} checks${aside ? ` (${aside})` : ''}`}\n`)
if (bad.length || crashed) {
  process.stdout.write(`\nworker output (last 40 lines):\n${workerOut.trim().split('\n').slice(-40).join('\n')}\n`)
  process.exit(1)
}
process.exit(failed ? 1 : 0)
