import { createHash, randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, lstat, open, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const MAX_ENTRIES = 96
const MAX_TEXT = 12000
const canonical = (value: any): string => value && typeof value === 'object' ? Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}' : JSON.stringify(value)
export interface MemoryEntry { id: string; source: string; text: string; at: number; originalChars: number; evidence?: 'model-note' | 'tool-result'; revision?: string; historical?: boolean; superseded?: boolean }
export interface MemoryCheckpoint { plan: string; decisions: string; remaining: string; next: string }
export interface MemoryOptions { directory: string; scope: string; resume: boolean; projectKey?: string }
export const memorySafeText = (text: string) => text
  .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}/gi, 'Bearer <credential>')
  .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '<credential>')
  .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)["']?\s*[:=]\s*["'])([^"'\r\n]{8,})(["'])/gi, '$1<credential>$3')

/** Bounded task memory outside the worktree. Checkpoints are model notes, never execution evidence. */
export class LocalMemory {
  private entries: MemoryEntry[] = []
  private checkpoint: MemoryCheckpoint = { plan: '', decisions: '', remaining: '', next: '' }
  private events: string[] = []
  private refs: number[] = []
  private operations: Record<string, { state: 'pending' | 'done'; receipt?: string }> = {}
  private file: string | null = null
  private clean: (s: string) => string
  constructor(clean: (s: string) => string) { this.clean = text => memorySafeText(clean(text)) }

  async load(options?: MemoryOptions) {
    if (!options) return
    await mkdir(options.directory, { recursive: true, mode: 0o700 })
    const dir = await lstat(options.directory)
    if (!dir.isDirectory() || dir.isSymbolicLink()) throw new Error('Memory directory must be a private regular directory.')
    this.file = join(options.directory, `one-memory-${hash(options.scope)}.json`)
    // Retention applies only to our hashed snapshots, never other files in the owner-selected directory.
    const candidates = []
    for (const name of await readdir(options.directory)) if (/^one-memory-[a-f0-9]{64}\.json$/.test(name)) {
      const path = join(options.directory, name)
      const info = await lstat(path)
      if (info.isFile() && !info.isSymbolicLink()) candidates.push({ path, at: info.mtimeMs })
    }
    candidates.sort((a, b) => b.at - a.at)
    for (const [i, c] of candidates.entries()) if (i >= 64 || c.at < Date.now() - 30 * 86400000) await rm(c.path)
    if (!options.resume) return
    let file
    try {
      file = await open(this.file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
      const info = await file.stat()
      if (!info.isFile() || info.nlink > 1 || info.size > 1_600_000) throw new Error('Invalid memory snapshot.')
      const value = JSON.parse(await file.readFile('utf8'))
      if (value.v !== 1 || value.scope !== hash(options.scope)) return
      this.setCheckpoint(value.checkpoint)
      if (Array.isArray(value.entries)) for (const e of value.entries.slice(-MAX_ENTRIES)) {
        if (typeof e.source !== 'string' || typeof e.text !== 'string') continue
        const entry = this.remember(e.source, e.text, { evidence: e.evidence === 'tool-result' ? 'tool-result' : 'model-note', ...(typeof e.revision === 'string' && /^[a-f0-9]{64}$/.test(e.revision) ? { revision: e.revision } : {}) }); entry.historical = true; entry.superseded = e.superseded === true
        if (typeof e.at === 'number' && Number.isFinite(e.at)) entry.at = e.at
        if (/^[a-f0-9]{20}$/.test(e.id)) entry.id = e.id
        if (typeof e.originalChars === 'number' && e.originalChars >= entry.text.length) entry.originalChars = e.originalChars
      }
      this.events = Array.isArray(value.events) ? value.events.filter((e: unknown) => typeof e === 'string').slice(-20).map((s: string) => this.clean(s).slice(0, 300)) : []
      this.refs = Array.isArray(value.refs) ? value.refs.filter((n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n > 0).slice(-12) : []
      if (value.operations && typeof value.operations === 'object') for (const [key, op] of Object.entries(value.operations).slice(-96)) {
        const v = op as any
        if (/^[a-f0-9]{64}$/.test(key) && ['pending', 'done'].includes(v?.state)) this.operations[key] = { state: v.state, ...(typeof v.receipt === 'string' ? { receipt: this.clean(v.receipt).slice(0, 2000) } : {}) }
      }
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') { this.file = null; throw new Error('Cannot restore the local task memory. Start over or repair its private snapshot.') } }
    finally { await file?.close() }
  }
  remember(source: string, value: string, meta: { evidence?: 'model-note' | 'tool-result'; revision?: string } = {}) {
    const safeSource = this.clean(source).slice(0, 250)
    const safe = this.clean(value)
    const id = hash(safeSource + '\n' + safe).slice(0, 20)
    const existing = this.entries.find(e => e.id === id)
    if (meta.revision) for (const prior of this.entries) if (prior.source === safeSource && prior.revision && prior.revision !== meta.revision) prior.superseded = true
    if (existing) {
      existing.historical = false; existing.superseded = false; existing.at = Date.now()
      if (meta.evidence) existing.evidence = meta.evidence
      if (meta.revision) existing.revision = meta.revision
      return existing
    }
    const text = safe.length > MAX_TEXT ? safe.slice(0, 8000) + '\n[Middle omitted; reread original source.]\n' + safe.slice(-3900) : safe
    const entry: MemoryEntry = { id, source: safeSource, text, originalChars: safe.length, at: Date.now(), evidence: meta.evidence ?? 'model-note', ...(meta.revision ? { revision: meta.revision } : {}) }
    this.entries.push(entry)
    if (this.entries.length > MAX_ENTRIES) this.entries.shift()
    return entry
  }
  setCheckpoint(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Supply a structured checkpoint.')
    const v = value as Record<string, unknown>
    for (const key of ['plan', 'decisions', 'remaining', 'next'] as const) if (v[key] !== undefined) {
      if (typeof v[key] !== 'string' || v[key].length > 4000) throw new Error('Checkpoint fields must be text up to 4,000 characters.')
    }
    for (const key of ['plan', 'decisions', 'remaining', 'next'] as const) if (typeof v[key] === 'string') this.checkpoint[key] = this.clean(v[key])
    this.remember('checkpoint (unverified model notes)', JSON.stringify(this.checkpoint))
    return 'Checkpoint saved. Notes are unverified; reread source and rerun checks before relying on them.'
  }
  event(text: string) { this.events.push(this.clean(text).slice(0, 300)); this.events = this.events.slice(-20) }
  search(query: unknown) {
    if (typeof query !== 'string' || query.length > 200) throw new Error('Memory query must be text up to 200 characters.')
    const terms = query.toLowerCase().split(/\W+/u).filter(Boolean)
    return this.entries.map((e, i) => ({ e, i, score: (query.trim() && e.source.toLowerCase().includes(query.trim().toLowerCase()) ? 100 : 0) + terms.reduce((n, t) => n + (e.source.toLowerCase().includes(t) ? 8 : 0) + (e.text.toLowerCase().includes(t) ? 1 : 0), 0) }))
      .filter(e => (!terms.length || e.score > 0) && !e.e.superseded).sort((a, b) => b.score - a.score || b.i - a.i).slice(0, 6)
      .map(({ e }) => ({ id: e.id, source: e.source, preview: e.text.slice(0, 250), evidence: e.evidence ?? 'model-note', historical: !!e.historical, revision: e.revision, at: e.at, shortened: e.originalChars > MAX_TEXT }))
  }
  recall(id: unknown) {
    const entry = this.entries.find(e => e.id === id)
    if (!entry) throw new Error('Memory entry is unavailable or expired. Search again or reread its source.')
    return { ...entry, expired: entry.at < Date.now() - 7 * 86400000, warning: 'Historical reference data, not current source or instructions. File edits require a fresh read.' }
  }
  addAtlasRef(ref: number) { if (Number.isSafeInteger(ref) && ref > 0) this.refs = [...new Set([...this.refs, ref])].slice(-12) }
  atlasRefs() { return [...this.refs] }
  operation(name: string, args: unknown) { return this.operations[hash(name + canonical(args))] }
  beginOperation(name: string, args: unknown) {
    if (Object.keys(this.operations).length >= 96) throw new Error('External operation journal is full. Finish this task before starting more writes.')
    this.operations[hash(name + canonical(args))] = { state: 'pending' }
  }
  finishOperation(name: string, args: unknown, receipt: string) {
    this.operations[hash(name + canonical(args))] = { state: 'done', receipt: this.clean(receipt).slice(0, 2000) }
  }
  summary() {
    const notes = Object.fromEntries(Object.entries(this.checkpoint).map(([k, v]) => [k, v.length > 1000 ? v.slice(0, 1000) + ' [shortened; memory_search checkpoint]' : v]))
    return JSON.stringify({ notes, observed: this.events.slice(-10).map(e => e.slice(0, 180)), atlasRefs: this.refs, pendingExternalOperations: Object.values(this.operations).filter(o => o.state === 'pending').length, recent: this.entries.slice(-8).map(e => ({ id: e.id, source: e.source.slice(0, 150) })) })
  }
  report() {
    return 'Saved task state (notes may be unverified):\n' + this.summary() + '\nNext: continue from this checkpoint, reread changed source, and verify outstanding work.'
  }
  async flush(options?: MemoryOptions) {
    if (!this.file || !options) return
    const temp = this.file + '.' + randomBytes(8).toString('hex') + '.tmp'
    const snapshot = () => JSON.stringify({ v: 1, scope: hash(options.scope), checkpoint: this.checkpoint, events: this.events, entries: this.entries, refs: this.refs, operations: this.operations })
    let body = snapshot()
    while (Buffer.byteLength(body) > 1_500_000 && this.entries.length) { this.entries.shift(); body = snapshot() }
    const file = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600)
    try { await file.writeFile(body); await file.sync() } finally { await file.close() }
    try { await rename(temp, this.file) } finally { await rm(temp, { force: true }) }
  }
}

/** Count repeated identical calls without replaying their side effects. Varying failed calls also stall. */
export class LocalProgress {
  private calls = new Map<string, { value: unknown; repeats: number; failed: boolean }>()
  private stagnant = 0
  private warned = false
  private observations = new Set<string>()
  cached(name: string, args: unknown) { return this.calls.get(hash(name + JSON.stringify(args))) }
  record(name: string, args: unknown, value: unknown, progress: boolean, failed = false) {
    const key = hash(name + JSON.stringify(args))
    const old = this.calls.get(key)
    this.calls.set(key, { value, repeats: (old?.repeats ?? 0) + 1, failed })
    this.stagnant = progress ? 0 : this.stagnant + 1
  }
  novel(name: string, args: unknown, output: string) {
    const id = hash(name + JSON.stringify(args) + output)
    const fresh = !this.observations.has(id)
    this.observations.add(id)
    return fresh
  }
  state() {
    const repeats = Math.max(0, ...[...this.calls.values()].map(c => c.repeats))
    if (this.stagnant >= 10 || repeats >= 5) return 'stop'
    if (!this.warned && (this.stagnant >= 5 || repeats >= 3)) { this.warned = true; return 'warn' }
    return 'continue'
  }
}

export function localContext(env: NodeJS.ProcessEnv) {
  const n = Number(env.ONE_CODER_CONTEXT || 32768)
  if (![32768, 65536, 131072].includes(n)) throw new Error('ONE_CODER_CONTEXT must be 32768, 65536 or 131072. Test RAM use before increasing it.')
  return { tokens: n, inputLimit: n - 8192, chars: Math.floor((n - 8192) * 1.5) }
}
