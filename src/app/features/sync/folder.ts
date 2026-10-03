/**
 * Folder target (File System Access API). One → folder on every change (only changed files;
 * renames / moves move the file; trashed pages move to `.trash/`, deleting them for good removes
 * the file), and folder → One on "Pick up changes" / focus / a poll while the tab is visible.
 *
 * Before overwriting or removing a file, its state on disk is checked against what was last
 * written: a file edited outside One in the meantime is never lost — before an overwrite it is
 * saved as a "(conflict <date>)" copy, and a file that would be removed stays where it is.
 */
import { getFile } from '../../lib/files'
import { dirname } from '../io/import/plan'
import { conflictPath, planSync } from './engine'
import { fileOf, listFiles, pruneEmpty, removeFile, writeFile, type FileMeta } from './fs'
import { gitBlobSha } from './hash'
import { applyPickup, isPickable, type ExternalFile, type PickupResult } from './pickup'
import { TRASH_DIR } from './layout'
import type { Manifest } from './types'

export interface WriteResult {
  written: number
  pages: number
  removed: number
  conflicts: number
  /** files edited outside One that were left in place instead of being removed */
  kept: number
  files: number
  /** files the file system refused (names it can't store …) */
  failed: string[]
}

const FATAL = new Set(['NotAllowedError', 'SecurityError', 'NotFoundError', 'QuotaExceededError'])

/** Name the file in a file system error ("… (Team wiki/Brand voice.md)"). */
function withPath(e: unknown, path: string): unknown {
  return e instanceof DOMException ? new DOMException(`${e.message} (${path})`, e.name) : e
}

/** The file on disk differs from what the manifest says was written (mtime/size first, then content). */
async function changedOnDisk(root: FileSystemDirectoryHandle, path: string, m: Manifest): Promise<{ data: Uint8Array; sha: string; meta: FileMeta } | null> {
  const entry = m.entries[path]
  if (!entry) return null
  const f = await fileOf(root, path)
  if (!f || (f.lastModified === entry.mtime && f.size === entry.size)) return null
  const data = new Uint8Array(await f.arrayBuffer())
  const sha = await gitBlobSha(data)
  return sha === entry.sha ? null : { data, sha, meta: { mtime: f.lastModified, size: f.size } }
}

/** A file One didn't write sits where One wants to write (and says something else). */
async function foreign(root: FileSystemDirectoryHandle, path: string, sha: string): Promise<{ data: Uint8Array } | null> {
  const f = await fileOf(root, path)
  if (!f) return null
  const data = new Uint8Array(await f.arrayBuffer())
  return (await gitBlobSha(data)) === sha ? null : { data }
}

export async function writeFolder(root: FileSystemDirectoryHandle, manifest: Manifest): Promise<WriteResult> {
  const plan = await planSync(manifest)
  const res: WriteResult = { written: 0, pages: 0, removed: 0, conflicts: 0, kept: 0, files: plan.total, failed: [] }
  for (const w of plan.writes) {
    const d = w.desired
    let data: Uint8Array | Blob
    let sha: string
    if (w.rendered) {
      data = w.rendered.data
      sha = w.rendered.sha
    } else {
      const f = d.ref ? await getFile(d.ref).catch(() => undefined) : undefined
      if (!f) continue
      data = f.blob
      sha = await gitBlobSha(new Uint8Array(await f.blob.arrayBuffer()))
    }
    if (d.kind !== 'file') {
      // edited outside One since it was written — or a file One never wrote (a note that was there first)
      const outside = manifest.entries[d.path] ? await changedOnDisk(root, d.path, manifest) : await foreign(root, d.path, sha)
      if (outside) {
        await writeFile(root, conflictPath(d.path), outside.data)
        res.conflicts++
      }
    }
    let meta: FileMeta
    try {
      meta = await writeFile(root, d.path, data)
    } catch (e) {
      // the folder itself is gone / not allowed: stop; one file the file system refuses: go on
      if (FATAL.has((e as DOMException)?.name)) throw withPath(e, d.path)
      console.warn('[one] sync: could not write', d.path, e)
      res.failed.push(d.path)
      continue
    }
    manifest.entries[d.path] = { kind: d.kind, id: d.id, ref: d.ref, sha, out: sha, mtime: meta.mtime, size: meta.size, title: d.id ? plan.ctx.pages[d.id]?.title : undefined }
    res.written++
    if (d.kind === 'page' || d.kind === 'row') res.pages++
  }
  const dirs = new Set<string>()
  for (const path of plan.deletes) {
    const entry = manifest.entries[path]
    delete manifest.entries[path]
    if (entry && entry.kind !== 'file' && (await changedOnDisk(root, path, { entries: { [path]: entry } }))) {
      res.kept++
      continue
    }
    await removeFile(root, path)
    res.removed++
    const dir = dirname(path)
    if (dir) dirs.add(dir)
  }
  // deepest first, so a moved folder disappears completely
  for (const dir of [...dirs].sort((a, b) => b.split('/').length - a.split('/').length)) await pruneEmpty(root, dir)
  return res
}

export interface FolderPickup extends PickupResult {
  /** conflict copies written */
  copies: string[]
}

/** Folder → One. Writes conflict copies; the caller runs writeFolder() afterwards. */
export async function pickupFolder(root: FileSystemDirectoryHandle, manifest: Manifest): Promise<FolderPickup> {
  const files = await listFiles(root, () => false)
  const present = new Set(files.keys())
  const changed: ExternalFile[] = []
  const added: ExternalFile[] = []
  const metas = new Map<string, FileMeta>()
  for (const [path, h] of files) {
    const entry = manifest.entries[path]
    if (entry?.kind === 'file' || (!entry && !isPickable(path))) continue
    const f = await h.getFile()
    if (entry && f.lastModified === entry.mtime && f.size === entry.size) continue
    // notes that were in the folder before it was connected stay as they are until they change
    if (!entry && manifest.since && f.lastModified < manifest.since) continue
    const data = new Uint8Array(await f.arrayBuffer())
    const sha = await gitBlobSha(data)
    const meta = { mtime: f.lastModified, size: f.size }
    if (entry && sha === entry.sha) {
      // touched, not changed
      entry.mtime = meta.mtime
      entry.size = meta.size
      continue
    }
    metas.set(path, meta)
    ;(entry ? changed : added).push({ path, data, sha })
  }
  const empty: FolderPickup = { updated: [], created: [], moved: [], conflicts: [], ignored: [], missing: [], entries: {}, removed: [], touched: [], copies: [] }
  const missing = Object.entries(manifest.entries).some(([p, e]) => (e.kind === 'page' || e.kind === 'row') && !present.has(p) && !p.startsWith(`${TRASH_DIR}/`))
  if (!changed.length && !added.length && !missing) return empty

  const plan = await planSync(manifest)
  const res = await applyPickup({
    plan,
    manifest,
    changed,
    added,
    present,
    readFile: async (path) => {
      const f = await fileOf(root, path)
      return f ? new Uint8Array(await f.arrayBuffer()) : null
    },
  })
  const copies: string[] = []
  for (const c of res.conflicts) {
    // One's version stays; the folder's version is kept next to it
    const copy = conflictPath(c.path)
    await writeFile(root, copy, c.data)
    copies.push(copy)
    const entry = manifest.entries[c.path]
    const meta = metas.get(c.path)
    if (entry && meta) manifest.entries[c.path] = { ...entry, sha: c.sha, mtime: meta.mtime, size: meta.size }
  }
  for (const [path, e] of Object.entries(res.entries)) {
    const meta = metas.get(path)
    manifest.entries[path] = { ...e, ...(meta ? { mtime: meta.mtime, size: meta.size } : {}) }
  }
  for (const p of res.removed) if (!res.entries[p]) delete manifest.entries[p]
  await refreshOut(manifest, res.touched)
  return { ...res, copies }
}

/** After a pick-up changed pages: One's rendering of them now is what the file already says. */
export async function refreshOut(manifest: Manifest, paths: string[]): Promise<void> {
  if (!paths.length) return
  const after = await planSync(manifest)
  for (const path of paths) {
    const r = after.renders.get(path)
    const entry = manifest.entries[path]
    if (r && entry && after.layout.byPath.get(path)?.id === entry.id) entry.out = r.sha
  }
}
