/** Device-local grants and isolated worker contexts. No workspace document is configuration or authority. */
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { constants, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { WebSocket } from 'ws'
import { PAIR_SECRET, type TabMessage, type WorkspaceRef } from '../../../src/app/features/coding/protocol.ts'
import { sameSecret } from './preset.ts'
import { workspaceOf } from './link.ts'
import { Worker, type WorkerOptions } from './worker.ts'
import type { WorkerConfig } from './config.ts'
import { WorkerState } from './state.ts'

type Hello = Extract<TabMessage, { type: 'hello' }>
type Grant = { workspace: WorkspaceRef; pair: string }
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const MAX = 32

export class WorkspaceGrants {
  readonly file: string
  private owner: string
  private entries = new Map<string, Grant>()
  private challenges = new Map<string, { workspace: string; until: number }>()
  constructor(configFile: string, owner: string) {
    this.owner = owner
    this.file = join(dirname(configFile), 'worker-workspaces.json')
    if (!existsSync(this.file)) return
    const fd = openSync(this.file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    try {
      const info = fstatSync(fd)
      if (!info.isFile() || info.nlink > 1 || info.size > 40000 || (process.platform !== 'win32' && (info.mode & 0o077))) throw new Error('Workspace grants must be a private regular file.')
      const raw = JSON.parse(readFileSync(fd, 'utf8'))
      if (raw.owner !== hash(owner)) return // a new owner pairing revokes the previous download's grants
      if (raw.v !== 1 || !Array.isArray(raw.grants) || raw.grants.length > MAX) throw new Error('Invalid workspace grants.')
      for (const entry of raw.grants) {
        const workspace = workspaceOf(entry?.workspace)
        if (!workspace || typeof entry.pair !== 'string' || !PAIR_SECRET.test(entry.pair)) throw new Error('Invalid workspace grant.')
        this.entries.set(workspace.id, { workspace, pair: entry.pair })
      }
    } finally { closeSync(fd) }
  }
  get(id: string) { return this.entries.get(id) }
  list() { return [...this.entries.values()].map(g => ({ id: g.workspace.id, name: g.workspace.name })) }
  challenge(workspace: string) {
    for (const [key, value] of this.challenges) if (value.until < Date.now()) this.challenges.delete(key)
    if (this.challenges.size >= 128) this.challenges.delete(this.challenges.keys().next().value!)
    const nonce = randomBytes(32).toString('base64url')
    this.challenges.set(nonce, { workspace, until: Date.now() + 120000 })
    return nonce
  }
  add(workspace: WorkspaceRef, pair: unknown, raw: unknown) {
    if (!raw || typeof raw !== 'object' || typeof pair !== 'string' || !PAIR_SECRET.test(pair) || this.entries.has(workspace.id) || this.entries.size >= MAX) return false
    const proof = raw as { nonce?: unknown; signature?: unknown }
    if (typeof proof.nonce !== 'string' || !PAIR_SECRET.test(proof.nonce) || typeof proof.signature !== 'string' || !PAIR_SECRET.test(proof.signature)) return false
    const challenge = this.challenges.get(proof.nonce)
    this.challenges.delete(proof.nonce)
    if (!challenge || challenge.workspace !== workspace.id || challenge.until < Date.now()) return false
    const expected = createHmac('sha256', this.owner).update(JSON.stringify([proof.nonce, workspace.id, pair])).digest('base64url')
    if (!sameSecret(expected, proof.signature)) return false
    this.entries.set(workspace.id, { workspace, pair })
    try { this.save() } catch (error) { this.entries.delete(workspace.id); throw error }
    return true
  }
  revoke(id: string) {
    const old = this.entries.get(id)
    this.entries.delete(id)
    try { this.save() } catch (error) { if (old) this.entries.set(id, old); throw error }
  }
  private save() {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    const temp = `${this.file}.${randomBytes(8).toString('hex')}.tmp`
    try {
      writeFileSync(temp, JSON.stringify({ v: 1, owner: hash(this.owner), grants: [...this.entries.values()] }), { mode: 0o600, flag: 'wx' })
      renameSync(temp, this.file)
    } finally { if (existsSync(temp)) unlinkSync(temp) }
  }
}

/** Primary workspace keeps its existing state. Every additional workspace gets its own state, scratch and branches. */
export function workspaceConfig(base: WorkerConfig, grant: Grant): WorkerConfig {
  const scope = hash(grant.workspace.id).slice(0, 24)
  const parent = join(dirname(base.file), 'workspaces')
  const runtimeDir = join(parent, scope)
  for (const dir of [parent, runtimeDir]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) throw new Error('Invalid workspace runtime directory.')
  }
  return { ...base, workspace: grant.workspace.id, runtimeDir,
    preset: base.preset ? { ...base.preset, workspace: grant.workspace.id, name: grant.workspace.name, pair: grant.pair } : null,
    repos: base.repos.map(r => ({ ...r, worktreeDir: join(r.worktreeDir, `ws-${scope}`), branchPrefix: `${r.branchPrefix}ws-${scope}/` })),
  }
}

/** Revocation/owner rotation changes authority, never the device's already incurred daily spending. */
export function workspaceSpending(config: WorkerConfig, primary: number): number {
  const parent = join(dirname(config.file), 'workspaces')
  if (!existsSync(parent)) return primary
  if (lstatSync(parent).isSymbolicLink() || !lstatSync(parent).isDirectory()) throw new Error('Invalid workspace runtime directory.')
  const scopes = readdirSync(parent, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && /^[a-f0-9]{24}$/.test(entry.name))
  if (scopes.length > 5000) throw new Error('Too many saved workspace contexts to check the device budget.')
  return primary + scopes.reduce((total, scope) => total + new WorkerState(config.file, join(parent, scope.name)).spentToday(), 0)
}

export class WorkerWorkspaces {
  readonly grants: WorkspaceGrants
  private children = new Map<string, Promise<Worker>>()
  private workers = new Set<Worker>()
  private claims = new Map<symbol, string[]>()
  private closed = false
  private revoking = new Set<string>()
  private primary: Worker
  private options: WorkerOptions
  constructor(primary: Worker, options: WorkerOptions) {
    this.primary = primary
    this.options = options
    if (!options.config.preset?.pair || options.config.preset.cloud) throw new Error('A local paired worker is required.')
    this.grants = new WorkspaceGrants(options.config.file, options.config.preset.pair)
    this.workers.add(primary)
    primary.state.globalSpent = () => this.spent()
  }
  busyRepos = () => new Set([...this.workers].flatMap(w => w.activeRepos()).concat([...this.claims.values()].flat()))
  reserve = (repos: string[]) => {
    if (this.closed || this.claims.size + [...this.workers].reduce((n, w) => n + w.runningCount(), 0) >= this.primary.config.parallel) return null
    if (repos.some(repo => this.busyRepos().has(repo))) return null
    const id = Symbol(); this.claims.set(id, repos)
    let released = false
    return () => { if (!released) { released = true; this.claims.delete(id) } }
  }
  changed = () => { for (const worker of this.workers) worker.tick() }
  live() {
    const live = this.primary.live()
    return { ...live, busy: [...this.workers].flatMap(worker => worker.live().busy) }
  }
  private spent() {
    return workspaceSpending(this.primary.config, this.primary.state.spentToday())
  }
  async route(socket: WebSocket, hello: Hello): Promise<boolean> {
    if (this.closed || this.revoking.has(hello.workspace.id) || hello.workspace.id === this.primary.config.workspace) return false
    const workspace = workspaceOf(hello.workspace)
    if (!workspace) return false
    let grant = this.grants.get(workspace.id)
    if (!grant && this.grants.add(workspace, hello.pair, hello.authorizeWorkspace)) grant = this.grants.get(workspace.id)
    if (!grant) return false
    if (!sameSecret(grant.pair, hello.pair)) {
      socket.send(JSON.stringify({ type: 'refused', reason: 'pair', paired: true }))
      socket.close(4003, 'not paired')
      return true
    }
    let pending = this.children.get(workspace.id)
    if (!pending) {
      const config = workspaceConfig(this.primary.config, grant)
      pending = (async () => {
        const worker = new Worker({ ...this.options, config, virtual: true, routeLocal: undefined, routeTask: undefined, workspaceChallenge: undefined, canGrantWorkspace: false, reserveWork: this.reserve, busyRepos: this.busyRepos, capacityChanged: this.changed })
        worker.state.globalSpent = () => this.spent()
        this.workers.add(worker)
        try { await worker.start(); if (this.closed) { await worker.stop(); throw new Error('Worker stopped.') }; return worker }
        catch (error) { await worker.stop().catch(() => {}); this.workers.delete(worker); this.children.delete(workspace.id); throw error }
      })()
      this.children.set(workspace.id, pending)
    }
    const worker = await pending
    if (socket.readyState === WebSocket.OPEN && !this.closed && this.grants.get(workspace.id) === grant) worker.acceptLocal(socket, hello)
    else socket.close(1008, 'workspace unavailable')
    return true
  }
  task = async (token: string, tool: string, args: Record<string, unknown>) => {
    for (const worker of this.workers) if (worker.hasTaskToken(token)) return worker.taskCall(token, tool, args)
    return { ok: false as const, status: 401, error: 'Unknown task token.' }
  }
  async reload() {
    for (const [id, pending] of this.children) {
      const grant = this.grants.get(id)
      if (grant) await (await pending).reload(workspaceConfig(this.primary.config, grant))
    }
  }
  async revoke(id: string) {
    this.revoking.add(id)
    try {
      this.grants.revoke(id)
      const pending = this.children.get(id)
      this.children.delete(id)
      if (pending) { const worker = await pending; await worker.stop(); this.workers.delete(worker) }
    } finally { this.revoking.delete(id); this.changed() }
  }
  async stop() {
    this.closed = true
    for (const worker of this.workers) worker.cancelRuns()
    await Promise.allSettled([...this.workers].filter(w => w !== this.primary).map(w => w.stop()))
  }
}
