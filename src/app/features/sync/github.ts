/**
 * GitHub target: the same file layout, committed to the person's own repository through the REST
 * API (git data API: blobs → tree → commit → ref update; one commit per push). The token is a
 * fine-grained personal access token with Contents read/write for that repository, typed into
 * Settings → Sync and kept in this browser only (storage.ts).
 *
 *  - Push writes only files whose rendering changed since the last push (the manifest keeps the
 *    blob ids) and removes files that left the layout. A file changed on GitHub meanwhile is kept
 *    as a "(conflict <date>)" copy next to One's version.
 *  - Text files travel inline in the tree request (one request instead of a blob each — GitHub
 *    limits content-creating requests); attachments are uploaded as blobs; files > 50 MB are skipped.
 *  - The branch moved while pushing (409 / 422 on the ref update): fetch it again and retry once.
 *  - Pull reads the tree and imports Markdown files changed (or added) on GitHub since the last
 *    push, like the folder's pick-up.
 */
import { getFile } from '../../lib/files'
import { gitBlobSha, fromBase64, toBase64 } from './hash'
import { conflictPath, pageCount, planSync, type SyncPlan } from './engine'
import { applyPickup, isPickable, type ExternalFile, type PickupResult } from './pickup'
import type { GitHubConfig, Manifest } from './types'

const API = 'https://api.github.com'
export const MAX_FILE_BYTES = 50 * 1024 * 1024

export type GitHubErrorCode = 'config' | 'auth' | 'forbidden' | 'not-found' | 'rate' | 'conflict' | 'invalid' | 'network'

export class GitHubError extends Error {
  constructor(
    readonly code: GitHubErrorCode,
    message: string,
    readonly status = 0,
    /** rate limit: when requests are allowed again (ms) */
    readonly resetAt: number | null = null,
  ) {
    super(message)
    this.name = 'GitHubError'
  }
}

export function parseRepo(repo: string): { owner: string; name: string } | null {
  const m = repo
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .match(/^([\w.-]+)\/([\w.-]+)$/)
  return m ? { owner: m[1], name: m[2] } : null
}

export const cleanPrefix = (p: string) =>
  p
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..')
    .join('/')

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/')

export function isConfigured(c: GitHubConfig): boolean {
  return !!parseRepo(c.repo) && !!c.token.trim() && !!c.branch.trim()
}

/* ------------------------------------------------------------------ */
/* REST                                                                */
/* ------------------------------------------------------------------ */

async function call<T>(cfg: GitHubConfig, method: string, path: string, body?: unknown): Promise<T> {
  const repo = parseRepo(cfg.repo)
  if (!repo || !cfg.token.trim()) throw new GitHubError('config', 'repository and token are required')
  let res: Response
  try {
    res = await fetch(`${API}/repos/${repo.owner}/${repo.name}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${cfg.token.trim()}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    })
  } catch (e) {
    throw new GitHubError('network', e instanceof Error ? e.message : String(e))
  }
  if (res.ok) return (res.status === 204 ? null : await res.json()) as T
  let message = res.statusText
  try {
    message = ((await res.json()) as { message?: string }).message ?? message
  } catch {
    /* not JSON */
  }
  const remaining = res.headers.get('x-ratelimit-remaining')
  const reset = Number(res.headers.get('x-ratelimit-reset'))
  const retryAfter = Number(res.headers.get('retry-after'))
  if ((res.status === 403 || res.status === 429) && (remaining === '0' || retryAfter > 0 || /rate limit/i.test(message))) {
    const at = retryAfter > 0 ? Date.now() + retryAfter * 1000 : reset > 0 ? reset * 1000 : null
    throw new GitHubError('rate', message, res.status, at)
  }
  const code: GitHubErrorCode = res.status === 401 ? 'auth' : res.status === 403 ? 'forbidden' : res.status === 404 ? 'not-found' : res.status === 409 ? 'conflict' : 'invalid'
  throw new GitHubError(code, message, res.status)
}

interface RepoInfo {
  full_name: string
  default_branch: string
  private: boolean
  permissions?: { push?: boolean }
}
interface Ref {
  object: { sha: string }
}
interface Commit {
  sha: string
  tree: { sha: string }
}
interface TreeEntry {
  path: string
  mode: string
  type: 'blob' | 'tree' | 'commit'
  sha: string
  size?: number
}

export interface ConnectionInfo {
  repo: string
  private: boolean
  branchExists: boolean
  defaultBranch: string
}

/** "Test connection": the repository is reachable with this token, and may be written. */
export async function testConnection(cfg: GitHubConfig): Promise<ConnectionInfo> {
  const info = await call<RepoInfo>(cfg, 'GET', '')
  if (info.permissions && info.permissions.push === false) throw new GitHubError('forbidden', 'no write access', 403)
  const branchExists = !!(await head(cfg).catch((e) => {
    if (e instanceof GitHubError && (e.code === 'not-found' || e.code === 'conflict')) return null
    throw e
  }))
  return { repo: info.full_name, private: info.private, branchExists, defaultBranch: info.default_branch }
}

async function head(cfg: GitHubConfig): Promise<{ commit: string; tree: string } | null> {
  try {
    const ref = await call<Ref>(cfg, 'GET', `/git/ref/heads/${encodePath(cfg.branch.trim())}`)
    const commit = await call<Commit>(cfg, 'GET', `/git/commits/${ref.object.sha}`)
    return { commit: ref.object.sha, tree: commit.tree.sha }
  } catch (e) {
    // 404: no such branch · 409: the repository is empty
    if (e instanceof GitHubError && (e.code === 'not-found' || e.code === 'conflict')) return null
    throw e
  }
}

/** The branch doesn't exist yet: branch off the default branch, or start an empty repository. */
async function createBranch(cfg: GitHubConfig): Promise<{ commit: string; tree: string }> {
  const info = await call<RepoInfo>(cfg, 'GET', '')
  const branch = cfg.branch.trim()
  const from = branch === info.default_branch ? null : await call<Ref>(cfg, 'GET', `/git/ref/heads/${encodePath(info.default_branch)}`).catch(() => null)
  if (from) {
    await call(cfg, 'POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: from.object.sha })
  } else {
    // an empty repository has no git database yet: the contents API creates the first commit
    const prefix = cleanPrefix(cfg.prefix)
    const path = `${prefix ? `${prefix}/` : ''}README.md`
    const text = '# One workspace\n\nWritten by SimpleCMS One (Settings → Sync).\n'
    await call(cfg, 'PUT', `/contents/${encodePath(path)}`, { message: 'One sync · start', content: toBase64(new TextEncoder().encode(text)), branch })
  }
  const h = await head(cfg)
  if (!h) throw new GitHubError('not-found', `branch ${branch} not found`, 404)
  return h
}

/** Blob ids of the files below the prefix, by path relative to it. */
async function remoteFiles(cfg: GitHubConfig, tree: string): Promise<Map<string, string>> {
  const res = await call<{ tree: TreeEntry[]; truncated: boolean }>(cfg, 'GET', `/git/trees/${tree}?recursive=1`)
  if (res.truncated) throw new GitHubError('invalid', 'repository tree too large to read in one request', 422)
  const prefix = cleanPrefix(cfg.prefix)
  const out = new Map<string, string>()
  for (const e of res.tree) {
    if (e.type !== 'blob') continue
    if (prefix && !e.path.startsWith(`${prefix}/`)) continue
    out.set(prefix ? e.path.slice(prefix.length + 1) : e.path, e.sha)
  }
  return out
}

async function readBlob(cfg: GitHubConfig, sha: string): Promise<Uint8Array> {
  const b = await call<{ content: string; encoding: string }>(cfg, 'GET', `/git/blobs/${sha}`)
  return b.encoding === 'base64' ? fromBase64(b.content) : new TextEncoder().encode(b.content)
}

/* ------------------------------------------------------------------ */
/* Push                                                                */
/* ------------------------------------------------------------------ */

export interface PushResult {
  commit: string | null
  pages: number
  files: number
  removed: number
  conflicts: number
  skipped: string[]
}

interface NewTreeEntry {
  path: string
  mode: '100644'
  type: 'blob'
  sha?: string | null
  content?: string
}

async function pushOnce(cfg: GitHubConfig, manifest: Manifest, plan: SyncPlan): Promise<PushResult> {
  const base = (await head(cfg)) ?? (await createBranch(cfg))
  const remote = await remoteFiles(cfg, base.tree)
  const prefix = cleanPrefix(cfg.prefix)
  const full = (p: string) => (prefix ? `${prefix}/${p}` : p)
  const entries: NewTreeEntry[] = []
  const written: Array<{ path: string; sha: string; size: number }> = []
  const skipped: string[] = []
  let conflicts = 0
  let removed = 0

  for (const w of plan.writes) {
    const path = w.desired.path
    let data: Uint8Array
    let sha: string
    if (w.rendered) {
      data = w.rendered.data
      sha = w.rendered.sha
    } else {
      const f = w.desired.ref ? await getFile(w.desired.ref).catch(() => undefined) : undefined
      if (!f) continue
      if (f.size > MAX_FILE_BYTES) {
        skipped.push(path)
        continue
      }
      data = new Uint8Array(await f.blob.arrayBuffer())
      sha = await gitBlobSha(data)
    }
    if (data.byteLength > MAX_FILE_BYTES) {
      skipped.push(path)
      continue
    }
    const remoteSha = remote.get(path)
    written.push({ path, sha, size: data.byteLength })
    if (remoteSha === sha) continue
    const known = manifest.entries[path]
    if (remoteSha && w.desired.kind !== 'file' && (known ? remoteSha !== known.sha : true)) {
      // edited on GitHub since the last push (or a file One never wrote): that version stays as a conflict copy
      entries.push({ path: full(conflictPath(path)), mode: '100644', type: 'blob', sha: remoteSha })
      conflicts++
    }
    // the BOM (CSV) must survive, or GitHub's blob id differs from ours
    if (w.rendered) entries.push({ path: full(path), mode: '100644', type: 'blob', content: new TextDecoder('utf-8', { ignoreBOM: true }).decode(data) })
    else {
      const blob = await call<{ sha: string }>(cfg, 'POST', '/git/blobs', { content: toBase64(data), encoding: 'base64' })
      entries.push({ path: full(path), mode: '100644', type: 'blob', sha: blob.sha })
    }
  }
  const forget: string[] = []
  for (const path of plan.deletes) {
    const remoteSha = remote.get(path)
    const known = manifest.entries[path]
    forget.push(path)
    // gone already, or changed on GitHub since: leave it there
    if (!remoteSha || (known && remoteSha !== known.sha)) continue
    entries.push({ path: full(path), mode: '100644', type: 'blob', sha: null })
    removed++
  }
  for (const c of manifest.conflicts ?? []) {
    entries.push({ path: full(conflictPath(c.path)), mode: '100644', type: 'blob', sha: c.sha })
    conflicts++
  }

  let commit: string | null = null
  if (entries.length) {
    const tree = await call<{ sha: string }>(cfg, 'POST', '/git/trees', { base_tree: base.tree, tree: entries })
    const pages = pageCount(plan.writes.filter((w) => written.some((x) => x.path === w.desired.path)))
    const c = await call<{ sha: string }>(cfg, 'POST', '/git/commits', { message: `One sync · ${pages} ${pages === 1 ? 'page' : 'pages'}`, tree: tree.sha, parents: [base.commit] })
    await call(cfg, 'PATCH', `/git/refs/heads/${encodePath(cfg.branch.trim())}`, { sha: c.sha, force: false })
    commit = c.sha
  }

  // bookkeeping (only after the ref moved)
  for (const w of written) {
    const d = plan.layout.byPath.get(w.path)!
    manifest.entries[w.path] = { kind: d.kind, id: d.id, ref: d.ref, sha: w.sha, out: w.sha, size: w.size, title: d.id ? plan.ctx.pages[d.id]?.title : undefined }
  }
  for (const p of forget) delete manifest.entries[p]
  manifest.conflicts = []
  if (commit) manifest.head = commit
  return { commit, pages: pageCount(plan.writes), files: plan.total, removed, conflicts, skipped }
}

/** Private pages of a team workspace stay out of the repository unless the person opts in. */
const planOpts = (cfg: GitHubConfig) => ({ excludePrivate: !cfg.includePrivate })

export async function pushToGitHub(cfg: GitHubConfig, manifest: Manifest): Promise<PushResult> {
  const plan = await planSync(manifest, planOpts(cfg))
  try {
    return await pushOnce(cfg, manifest, plan)
  } catch (e) {
    // the branch moved under us: fetch it again and retry once
    if (e instanceof GitHubError && (e.status === 409 || e.status === 422)) {
      return pushOnce(cfg, manifest, await planSync(manifest, planOpts(cfg)))
    }
    throw e
  }
}

/* ------------------------------------------------------------------ */
/* Pull                                                                */
/* ------------------------------------------------------------------ */

export interface PullResult extends PickupResult {
  head: string | null
}

export async function pullFromGitHub(cfg: GitHubConfig, manifest: Manifest): Promise<PullResult> {
  const base = await head(cfg)
  const empty: PullResult = { head: null, updated: [], created: [], moved: [], conflicts: [], ignored: [], missing: [], entries: {}, removed: [], touched: [] }
  if (!base) return empty
  const remote = await remoteFiles(cfg, base.tree)
  const changed: ExternalFile[] = []
  const added: ExternalFile[] = []
  for (const [path, sha] of remote) {
    const known = manifest.entries[path]
    if (known) {
      if (known.sha === sha) continue
      if (known.kind === 'page' || known.kind === 'row') changed.push({ path, sha, data: await readBlob(cfg, sha) })
      else known.sha = sha
    } else if (isPickable(path)) added.push({ path, sha, data: await readBlob(cfg, sha) })
  }
  if (!changed.length && !added.length && [...Object.keys(manifest.entries)].every((p) => remote.has(p) || p.startsWith('.trash/'))) return { ...empty, head: base.commit }
  const plan = await planSync(manifest, planOpts(cfg))
  const res = await applyPickup({
    plan,
    manifest,
    changed,
    added,
    present: new Set(remote.keys()),
    readFile: async (path) => {
      const sha = remote.get(path)
      return sha ? readBlob(cfg, sha) : null
    },
  })
  return { ...res, head: base.commit }
}
