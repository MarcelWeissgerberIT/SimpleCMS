/**
 * one-worker — the local setup page: http://127.0.0.1:<port>/setup#k=<token>, on the worker's own port.
 * The person ticks the repositories One may hand tasks to (found by scan.ts), sets base branch, test
 * command, push, pull requests and a cost limit per repo, and saves: worker.json is written (0600) and the
 * worker reloads — One sees the new repo names at once (a fresh `welcome`).
 *
 * The door: Host must be exactly 127.0.0.1:<port> (DNS rebinding); every API call carries the token —
 * random per worker start, only in the page's address fragment (never sent by the browser on its own),
 * read by the page's script and sent as the X-One-Setup header, compared in constant time; POSTs also
 * need Origin http://127.0.0.1:<port> and a JSON body. No CORS headers: no other page can read or call it.
 * The page is static HTML + CSS + JS from the bundle (setup-page.ts) under a strict CSP — no CDN.
 *
 * One can only ask the worker to OPEN this page (`open-setup`); it never learns the token and can never
 * tick or add a repo. A folder is offered only when it is a main checkout (a `.git` folder) the scan found,
 * that is in worker.json already, or that the person typed into the page.
 */
import { randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { REPO_NAME, type OpenSetupResult, type WorkerPreset } from '../../../src/app/features/coding/protocol.ts'
import { saveRepos, splitArgs, type RepoChoice, type WorkerConfig } from './config.ts'
import { bareRepo, factsOf, findRepos, isMainCheckout, repoFacts, shortPath, type FindResult, type FoundRepo, type ScanOptions } from './scan.ts'
import { sameSecret } from './preset.ts'
import { openUrl } from './opener.ts'
import { SETUP_CSS, SETUP_HTML, SETUP_JS } from './setup-page.ts'

export interface SetupLive {
  /** the workspace id the worker serves (null: not bound) */
  workspace: string | null
  /** the One tab connected right now */
  connected: { name: string } | null
  busy: Array<{ repo: string; title: string; stage: string; since: number }>
  /** the worker's last log lines (this page is local: paths are fine here) */
  log: string[]
  claude: { found: boolean; version: string | null }
}

export interface SetupHost {
  configFile: string
  port: number
  preset: WorkerPreset | null
  version: string
  log: (msg: string) => void
  config: () => WorkerConfig
  /** read worker.json again and use it (the worker re-announces its repos to One) */
  reload: () => Promise<void>
  live: () => SetupLive
  /** how the page is opened (default: the browser, opener.ts) */
  opener?: (url: string) => Promise<boolean>
  scan?: ScanOptions
  home?: string
}

/** One repo as the page shows it: what the scan found + what worker.json says (or the defaults). */
export interface PageRepo extends FoundRepo {
  ticked: boolean
  configured: boolean
  push: boolean
  pr: 'gh' | 'none'
  maxUsdPerTask: number | null
  /** the test command as one line (argv joined; quoted where needed) */
  testLine: string
}

const MAX_BODY = 256 * 1024
const HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY', 'cross-origin-resource-policy': 'same-origin' }
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** argv → one line people can edit ("npm run test" · 'a b' quoted). */
export function joinArgs(argv: string[] | null): string {
  return (argv ?? []).map((a) => (a === '' ? "''" : /[\s'"\\]/.test(a) ? `"${a.replace(/(["\\])/g, '\\$1')}"` : a)).join(' ')
}

/** Is gh (the GitHub CLI) installed? */
function ghInstalled(): Promise<boolean> {
  return new Promise((done) => {
    try {
      execFile('gh', ['--version'], { timeout: 5000, windowsHide: true }, (err) => done(!err))
    } catch {
      done(false)
    }
  })
}

/** How long the facts of the found repos may take before the rest are listed without them. */
const FACTS_MS = 15_000

export class SetupServer {
  readonly token = randomBytes(32).toString('base64url')
  private host: SetupHost
  private home: string
  private found = new Map<string, FoundRepo>()
  private scanned: (Omit<FindResult, 'paths'> & { at: number }) | null = null
  private scanning: Promise<void> | null = null
  /** while a search runs: folders looked into, repos found, facts read */
  private progress = { dirs: 0, found: 0, facts: 0, phase: 'search' as 'search' | 'facts' }
  private gh: Promise<boolean> | null = null

  constructor(host: SetupHost) {
    this.host = host
    this.home = host.home ?? homedir()
  }

  url(): string {
    return `http://127.0.0.1:${this.host.port}/setup#k=${this.token}`
  }

  /** Open the page in this computer's browser (the address goes to the terminal too). */
  async open(): Promise<OpenSetupResult> {
    const url = this.url()
    const ok = await (this.host.opener ?? openUrl)(url)
    this.host.log(ok ? `opened the setup page: ${url}` : `open the setup page in a browser on this computer: ${url}`)
    return ok ? { opened: true } : { opened: false, reason: 'no-browser' }
  }

  /* ------------------------------------------------------------------ the repos */

  /** Search again (one search at a time). */
  scan(): Promise<void> {
    this.scanning ??= (async () => {
      this.progress = { dirs: 0, found: 0, facts: 0, phase: 'search' }
      const configured = this.host.config().repos
      // the page lists repos the moment they are found (bare), their facts follow
      const bareNames = new Set(configured.map((r) => r.name.toLowerCase()))
      try {
        const found = await findRepos({
          home: this.home,
          ...this.host.scan,
          onProgress: (dirs, path) => {
            this.progress.dirs = dirs
            if (path) {
              this.progress.found++
              if (!this.found.has(path)) this.found.set(path, bareRepo(path, bareNames, this.home))
            }
          },
        })
        const taken = new Set(configured.map((r) => r.name.toLowerCase()))
        const paths = [...new Set([...configured.map((r) => r.path), ...found.paths])]
        this.progress.phase = 'facts'
        const facts = await factsOf(paths, taken, this.home, 6, FACTS_MS, (r) => {
          this.progress.facts++
          this.found.set(r.path, r)
        })
        // what was added by hand stays on the list
        const added = [...this.found.values()].filter((r) => !paths.includes(r.path))
        this.found = new Map([...facts, ...added].map((r) => [r.path, r]))
        this.scanned = { capped: found.capped, blocked: found.blocked, dirs: found.dirs, ms: found.ms, at: Date.now() }
      } finally {
        this.scanning = null
      }
    })()
    return this.scanning
  }

  /** The repos the page lists: worker.json's first (in its order), then the rest, most recently active first. */
  repos(): PageRepo[] {
    const config = this.host.config()
    const out: PageRepo[] = []
    const seen = new Set<string>()
    for (const r of config.repos) {
      const f = this.found.get(r.path)
      seen.add(r.path)
      out.push({
        ...(f ?? { path: r.path, short: shortPath(r.path, this.home), branch: null, branches: [r.baseBranch], remote: r.remote, host: null, dirty: null, lastCommit: null, test: null }),
        name: r.name,
        base: r.baseBranch,
        branches: f ? (f.branches.includes(r.baseBranch) ? f.branches : [r.baseBranch, ...f.branches]) : [r.baseBranch],
        ticked: true,
        configured: true,
        push: r.push,
        pr: r.pr,
        maxUsdPerTask: r.maxUsdPerTask,
        test: r.testCommand,
        testLine: joinArgs(r.testCommand),
      })
    }
    const rest = [...this.found.values()].filter((f) => !seen.has(f.path)).sort((a, b) => (b.lastCommit ?? 0) - (a.lastCommit ?? 0))
    for (const f of rest) out.push({ ...f, ticked: false, configured: false, push: !!f.remote, pr: 'gh', maxUsdPerTask: null, testLine: joinArgs(f.test) })
    return out
  }

  async state(): Promise<unknown> {
    // the first search starts here; the page gets its answer at once and asks again while it runs
    if (!this.scanned && !this.scanning) void this.scan().catch((e) => this.host.log(`the search for repositories failed: ${(e as Error).message}`))
    this.gh ??= ghInstalled()
    const config = this.host.config()
    return {
      v: 1,
      workspace: { name: this.host.preset?.name ?? null, id: config.workspace, paired: !!this.host.preset },
      worker: { name: config.name, version: this.host.version, port: config.port, config: shortPath(this.host.configFile, this.home) },
      gh: await this.gh,
      scan: this.scanning ? { ...(this.scanned ?? {}), running: true, progress: { ...this.progress } } : this.scanned ? { ...this.scanned, running: false } : null,
      repos: this.repos(),
      live: this.host.live(),
    }
  }

  /** "Add a folder…": a main checkout inside the home folder (relative or ~/…), or an absolute path typed here. */
  async add(typed: unknown): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
    const raw = typeof typed === 'string' ? typed.trim() : ''
    if (!raw || raw.length > 1000 || /[\u0000-\u001f]/.test(raw)) return { ok: false, error: 'Type the folder of a git repository.' }
    let dir: string
    if (raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')) dir = join(this.home, raw.slice(2))
    else if (isAbsolute(raw)) dir = resolve(raw)
    else {
      dir = resolve(this.home, raw)
      if (dir !== this.home && !dir.startsWith(this.home + sep)) return { ok: false, error: 'A relative folder must stay inside your home folder.' }
    }
    try {
      dir = realpathSync(dir)
    } catch {
      return { ok: false, error: 'That folder does not exist.' }
    }
    if (!isMainCheckout(dir)) return { ok: false, error: 'That folder is not the main checkout of a git repository (no .git folder in it).' }
    if (!this.found.has(dir)) {
      const taken = new Set([...this.host.config().repos.map((r) => r.name.toLowerCase()), ...[...this.found.values()].map((r) => r.name.toLowerCase())])
      this.found.set(dir, await repoFacts(dir, taken, this.home))
    }
    return { ok: true, path: dir }
  }

  /** "Save & start": write the ticked repos, reload. Returns the problems (empty: saved). */
  async save(body: unknown): Promise<string[]> {
    const list = isObj(body) && Array.isArray(body.repos) ? body.repos : null
    if (!list || list.length > 100) return ['Nothing to save.']
    const known = new Map(this.repos().map((r) => [r.path, r]))
    const choices: RepoChoice[] = []
    const names = new Set<string>()
    for (const item of list) {
      if (!isObj(item) || typeof item.path !== 'string') return ['A repository could not be read.']
      const repo = known.get(item.path)
      if (!repo) return [`${item.path} is not on the list — rescan, or add the folder first.`]
      const name = typeof item.name === 'string' ? item.name.trim() : repo.name
      if (!REPO_NAME.test(name)) return [`"${name}": a name needs letters, digits, ".", "_" or "-" (at most 64).`]
      if (names.has(name.toLowerCase())) return [`The name "${name}" is used twice.`]
      names.add(name.toLowerCase())
      const baseBranch = typeof item.baseBranch === 'string' && item.baseBranch.trim() ? item.baseBranch.trim() : repo.base
      const test = typeof item.test === 'string' ? splitArgs(item.test) : repo.test
      const limit = typeof item.maxUsdPerTask === 'number' && Number.isFinite(item.maxUsdPerTask) && item.maxUsdPerTask > 0 ? Math.min(10_000, Math.round(item.maxUsdPerTask * 100) / 100) : null
      choices.push({ path: repo.path, name, baseBranch, remote: repo.remote, testCommand: test?.length ? test : null, push: item.push === true, pr: item.pr === 'none' ? 'none' : 'gh', maxUsdPerTask: limit })
    }
    const problems = saveRepos(this.host.configFile, choices, this.host.preset?.workspace ?? this.host.config().workspace)
    if (problems.length) return problems
    this.host.log(`setup page: saved ${choices.length} repo(s) — ${choices.map((c) => c.name).join(', ') || 'none'}`)
    await this.host.reload()
    return []
  }

  /* ------------------------------------------------------------------ HTTP */

  /** Answer a request under /setup (false: not ours). */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const path = (req.url ?? '/').split(/[?#]/)[0]!
    if (path !== '/setup' && !path.startsWith('/setup/')) return false
    const send = (status: number, type: string, body: string, extra: Record<string, string> = {}) => {
      res.writeHead(status, { ...HEADERS, 'content-type': type, ...extra })
      res.end(body)
    }
    const json = (status: number, body: unknown) => send(status, 'application/json; charset=utf-8', JSON.stringify(body))
    // DNS rebinding: a page that points its own name at 127.0.0.1 still sends its own Host
    if (req.headers.host !== `127.0.0.1:${this.host.port}`) {
      send(403, 'text/plain; charset=utf-8', 'one-worker: open the setup page at the address the worker printed.\n')
      return true
    }
    if (req.method === 'GET' && path === '/setup') return send(200, 'text/html; charset=utf-8', SETUP_HTML, { 'content-security-policy': CSP }), true
    if (req.method === 'GET' && path === '/setup/app.css') return send(200, 'text/css; charset=utf-8', SETUP_CSS), true
    if (req.method === 'GET' && path === '/setup/app.js') return send(200, 'text/javascript; charset=utf-8', SETUP_JS), true
    if (!path.startsWith('/setup/api/')) return send(404, 'text/plain; charset=utf-8', 'not found\n'), true

    const token = req.headers['x-one-setup']
    if (typeof token !== 'string' || !token) return json(401, { error: 'The setup page needs its key — open it at the address the worker printed.' }), true
    if (!sameSecret(this.token, token)) return json(403, { error: 'This key does not open the setup page (the worker was restarted?) — open the address it printed last.' }), true
    const op = path.slice('/setup/api/'.length)

    if (req.method === 'GET') {
      if (op === 'state') return json(200, await this.state()), true
      if (op === 'status') return json(200, { live: this.host.live(), repos: this.host.config().repos.map((r) => r.name), scanning: !!this.scanning }), true
      return json(404, { error: 'unknown' }), true
    }
    if (req.method !== 'POST') return json(405, { error: 'method' }), true
    // a POST comes from this page only: same origin, JSON
    if (req.headers.origin !== `http://127.0.0.1:${this.host.port}`) return json(403, { error: 'forbidden' }), true
    if (!/^application\/json\b/.test(String(req.headers['content-type'] ?? ''))) return json(415, { error: 'JSON only' }), true
    let raw = ''
    let size = 0
    for await (const chunk of req) {
      size += (chunk as Buffer).length
      if (size > MAX_BODY) return json(413, { error: 'too large' }), true
      raw += String(chunk)
    }
    let body: unknown
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      return json(400, { error: 'bad JSON' }), true
    }
    if (op === 'scan') {
      await this.scan()
      return json(200, await this.state()), true
    }
    if (op === 'add') {
      const r = await this.add(isObj(body) ? body.path : null)
      if (!r.ok) return json(400, { error: r.error }), true
      return json(200, { added: r.path, state: await this.state() }), true
    }
    if (op === 'save') {
      const problems = await this.save(body)
      if (problems.length) return json(400, { error: problems.join('\n'), problems }), true
      return json(200, await this.state()), true
    }
    return json(404, { error: 'unknown' }), true
  }
}
