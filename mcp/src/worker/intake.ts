/**
 * one-worker — "Import" stages: the code a task starts from, handed over in One's task panel — a ZIP the person
 * picked there (sent in chunks over the link) or a clone address they typed — becomes a NEW repository in the
 * worker's clone folder (zipimport.ts / clone.ts, the same checks as the setup page), is added to worker.json and
 * its name goes back to One (an `intake` event per task). One never names a path: the folder is the worker's
 * choice (the clone folder + a fresh name); an existing repository is never changed. `"intake": false` in
 * worker.json switches this off (the setup page still imports).
 *
 *  - begin → chunk … → end: ≤ ZIP_MAX (500 MB) into a 0600 temp file, the declared size must match; one intake at
 *    a time; an upload nobody finishes is dropped after 10 minutes, when its tab goes away, or when the same task
 *    begins again
 *  - clone: parseCloneUrl (no tokens in https addresses, no ext:: / file::, nothing option-like)
 */
import { createWriteStream, rmSync, type WriteStream } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { IntakeState } from '../../../src/app/features/coding/protocol.ts'
import { cloneBase, cloneInto, folderName, parseCloneUrl } from './clone.ts'
import { ZIP_MAX, importZip } from './zipimport.ts'
import { suggestName } from './publish.ts'
import { repoFacts } from './scan.ts'
import { saveRepos, type RepoChoice, type WorkerConfig } from './config.ts'

export interface IntakeHost {
  config: () => WorkerConfig
  /** worker.json */
  configFile: string
  /** read worker.json again (the new repo joins) */
  reload: () => Promise<void>
  log: (msg: string) => void
  /** progress / result for One (the task's panel) */
  event: (taskId: string, state: IntakeState) => void
}

interface Upload {
  id: string
  taskId: string
  file: string
  tmp: string
  out: WriteStream
  size: number
  declared: number
  timer: ReturnType<typeof setTimeout>
  /** the temp file could not be written (a full disk) — or the upload was dropped while a write was under way */
  error: Error | null
}

/** raw bytes per chunk (base64 on the wire stays below the link's 8 MB) */
export const INTAKE_CHUNK = 4 * 1024 * 1024
const IDLE_MS = 10 * 60_000
const TASK_ID = /^[A-Za-z0-9_-]{1,64}$/

export class Intake {
  private upload: Upload | null = null
  private running: string | null = null

  private host: IntakeHost

  constructor(host: IntakeHost) {
    this.host = host
  }

  private check(taskId: unknown): string {
    if (this.host.config().intake === false) throw new Error('This worker does not take imports from One ("intake": false in worker.json) — use its setup page.')
    if (typeof taskId !== 'string' || !TASK_ID.test(taskId)) throw new Error('bad task id')
    // the same task starts its upload again (the tab that sent it went away, or the person retried): that one is over
    if (!this.running && this.upload?.taskId === taskId) this.drop('started again', true)
    if (this.running || this.upload) throw new Error('Another import is running on this worker — wait until it is done.')
    return taskId
  }

  private base(): string {
    const base = cloneBase(this.host.config().cloneDir, homedir())
    if (typeof base !== 'string') throw new Error(base.error)
    return base
  }

  /** A ZIP is coming: name (".zip") and size first. */
  begin(taskId: unknown, name: unknown, size: unknown): { uploadId: string; chunk: number } {
    const id = this.check(taskId)
    const file = typeof name === 'string' ? name.replace(/[\u0000-\u001f/\\]/g, '').trim().slice(0, 200) : ''
    if (!/\.zip$/i.test(file)) throw new Error('Pick a .zip file.')
    const max = ZIP_MAX()
    const declared = typeof size === 'number' && Number.isFinite(size) ? Math.floor(size) : -1
    if (declared <= 0) throw new Error('The ZIP is empty.')
    if (declared > max) throw new Error(`The ZIP is larger than ${Math.round(max / 1024 / 1024)} MB.`)
    this.base()
    const tmp = join(tmpdir(), `one-intake-${randomBytes(8).toString('hex')}.zip`)
    const upload: Upload = { id: randomBytes(12).toString('hex'), taskId: id, file, tmp, out: createWriteStream(tmp, { mode: 0o600 }), size: 0, declared, timer: setTimeout(() => this.drop('the upload stopped'), IDLE_MS), error: null }
    upload.timer.unref?.()
    // a stream error never ends the worker: the upload fails with it
    upload.out.on('error', (e) => {
      upload.error ??= e
    })
    this.upload = upload
    this.host.log(`import for task ${id}: receiving ${file} (${Math.round(declared / 1024)} KB)`)
    this.host.event(id, { state: 'running', source: 'zip', label: file, line: 'Receiving…', percent: 0 })
    return { uploadId: upload.id, chunk: INTAKE_CHUNK }
  }

  /** The next piece (base64, in order). */
  async chunk(uploadId: unknown, data: unknown): Promise<{ received: number }> {
    const u = this.upload
    if (!u || uploadId !== u.id) throw new Error('No such upload.')
    if (typeof data !== 'string' || data.length > Math.ceil(INTAKE_CHUNK / 3) * 4 + 4) throw new Error('bad chunk')
    if (u.error) {
      this.drop(`the file could not be written: ${u.error.message}`)
      throw new Error('The upload could not be written on the worker\'s computer.')
    }
    const buf = Buffer.from(data, 'base64')
    u.size += buf.length
    if (u.size > u.declared) {
      this.drop('more bytes than announced')
      throw new Error('The upload is larger than announced.')
    }
    if (!u.out.write(buf)) await new Promise<void>((r) => u.out.once('drain', () => r()))
    u.timer.refresh()
    this.host.event(u.taskId, { state: 'running', source: 'zip', label: u.file, line: 'Receiving…', percent: Math.round((u.size / u.declared) * 50) })
    return { received: u.size }
  }

  /** All bytes are here: unpack into a new repository (followed by events). */
  async end(uploadId: unknown): Promise<{ ok: true }> {
    const u = this.upload
    if (!u || uploadId !== u.id) throw new Error('No such upload.')
    clearTimeout(u.timer)
    this.upload = null
    await new Promise<void>((done, fail) => u.out.end((e?: Error | null) => (e || u.error ? fail(e ?? u.error) : done())))
    if (u.size !== u.declared) {
      rmSync(u.tmp, { force: true })
      this.host.event(u.taskId, { state: 'failed', source: 'zip', label: u.file, line: '', percent: null, error: 'The upload was cut off — try again.' })
      throw new Error('The upload was cut off.')
    }
    const base = this.base()
    const name = folderName(u.file.replace(/\.zip$/i, ''))
    this.running = u.taskId
    this.host.log(`import for task ${u.taskId}: unpacking ${u.file} into ${base}`)
    void importZip(u.tmp, base, name, u.file, (p) => this.host.event(u.taskId, { state: 'running', source: 'zip', label: u.file, line: `${p.files} files · ${(p.bytes / 1024 / 1024).toFixed(1)} MB`, percent: 60 }))
      .then(async ({ dir, files }) => this.adopt(u.taskId, 'zip', u.file, dir, `${files} files`, suggestName(dir, name)))
      .catch((e: unknown) => this.fail(u.taskId, 'zip', u.file, e))
      .finally(() => {
        this.running = null
        rmSync(u.tmp, { force: true })
      })
    return { ok: true }
  }

  /** Clone an address into a new repository (followed by events). */
  clone(taskId: unknown, url: unknown): { ok: true } {
    const id = this.check(taskId)
    const target = parseCloneUrl(url, process.env.ONE_WORKER_CLONE_LOCAL === '1')
    if ('error' in target) throw new Error(target.error)
    const base = this.base()
    this.running = id
    this.host.log(`import for task ${id}: cloning ${target.url} into ${base}`)
    this.host.event(id, { state: 'running', source: 'clone', label: target.url, line: 'Cloning…', percent: null })
    void cloneInto(target, base, (p) => this.host.event(id, { state: 'running', source: 'clone', label: target.url, line: p.line, percent: p.percent }), { local: target.kind === 'local' })
      .then(async ({ dir, already }) => this.adopt(id, 'clone', target.url, dir, already ? 'Already cloned — added.' : 'Cloned.'))
      .catch((e: unknown) => this.fail(id, 'clone', target.url, e))
      .finally(() => {
        this.running = null
      })
    return { ok: true }
  }

  /** The new folder joins worker.json (everything else stays as it is), then One learns its name. */
  private async adopt(taskId: string, source: IntakeState['source'], label: string, dir: string, line: string, suggest?: string) {
    const cfg = this.host.config()
    const known = cfg.repos.find((r) => r.path === dir)
    let name = known?.name
    if (!known) {
      const facts = await repoFacts(dir, new Set(cfg.repos.map((r) => r.name.toLowerCase())))
      const keep: RepoChoice[] = cfg.repos.map((r) => ({ path: r.path, name: r.name, baseBranch: r.baseBranch, remote: r.remote, testCommand: r.testCommand, push: r.push, pr: r.pr, maxUsdPerTask: r.maxUsdPerTask }))
      keep.push({ path: dir, name: facts.name, baseBranch: facts.base, remote: facts.remote, testCommand: facts.test, push: !!facts.remote, pr: facts.remote ? 'gh' : 'none', maxUsdPerTask: null })
      const problems = saveRepos(this.host.configFile, keep, cfg.workspace)
      if (problems.length) throw new Error(`The repository is at ${dir}, but worker.json could not take it: ${problems.join('; ')}`)
      name = facts.name
      await this.host.reload()
    }
    this.host.log(`import for task ${taskId}: ready as repo "${name}"`)
    this.host.event(taskId, { state: 'done', source, label, line, percent: 100, repo: name, ...(suggest ? { suggest } : {}) })
  }

  private fail(taskId: string, source: IntakeState['source'], label: string, e: unknown) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 600)
    this.host.log(`import for task ${taskId} failed — ${error}`)
    this.host.event(taskId, { state: 'failed', source, label, line: '', percent: null, error })
  }

  /** Give up an unfinished upload (idle, the tab went away; `quiet`: the same task starts it again — no "failed"). */
  drop(why: string, quiet = false): void {
    const u = this.upload
    if (!u) return
    clearTimeout(u.timer)
    this.upload = null
    u.out.destroy()
    rmSync(u.tmp, { force: true })
    this.host.log(`import for task ${u.taskId}: dropped (${why})`)
    if (!quiet) this.host.event(u.taskId, { state: 'failed', source: 'zip', label: u.file, line: '', percent: null, error: `The upload stopped (${why}).` })
  }
}
