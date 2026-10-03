/**
 * File System Access helpers (Chromium / Edge: a folder picked with showDirectoryPicker; tests use
 * the origin private file system as a stand-in). Paths are "/"-separated, relative to the root.
 */

/** The parts of the API TypeScript's DOM lib doesn't type yet. */
interface PermissionHandle {
  queryPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
}
interface IterableDir {
  values: () => AsyncIterable<FileSystemHandle>
}
type DirectoryPicker = (opts?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<FileSystemDirectoryHandle>

export function folderSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
}

export async function pickFolder(): Promise<FileSystemDirectoryHandle> {
  const pick = (window as unknown as { showDirectoryPicker: DirectoryPicker }).showDirectoryPicker
  return pick({ mode: 'readwrite', id: 'one-sync' })
}

export async function permissionOf(h: FileSystemDirectoryHandle, ask: boolean): Promise<PermissionState> {
  const p = h as unknown as PermissionHandle
  try {
    if (ask && p.requestPermission) return await p.requestPermission({ mode: 'readwrite' })
    if (p.queryPermission) return await p.queryPermission({ mode: 'readwrite' })
  } catch {
    return 'prompt'
  }
  return 'granted'
}

async function dirOf(root: FileSystemDirectoryHandle, segs: string[], create: boolean): Promise<FileSystemDirectoryHandle | null> {
  let d = root
  for (const s of segs) {
    try {
      d = await d.getDirectoryHandle(s, { create })
    } catch (e) {
      if (!create && (e as DOMException)?.name === 'NotFoundError') return null
      if (!create && (e as DOMException)?.name === 'TypeMismatchError') return null
      throw e
    }
  }
  return d
}

const split = (path: string) => {
  const segs = path.split('/').filter(Boolean)
  return { dirs: segs.slice(0, -1), name: segs[segs.length - 1] }
}

export interface FileMeta {
  mtime: number
  size: number
}

export async function writeFile(root: FileSystemDirectoryHandle, path: string, data: Uint8Array | Blob): Promise<FileMeta> {
  const { dirs, name } = split(path)
  const dir = (await dirOf(root, dirs, true))!
  const fh = await dir.getFileHandle(name, { create: true })
  const w = await fh.createWritable()
  try {
    await w.write(data as FileSystemWriteChunkType)
  } finally {
    await w.close()
  }
  const f = await fh.getFile()
  return { mtime: f.lastModified, size: f.size }
}

export async function readFile(root: FileSystemDirectoryHandle, path: string): Promise<{ data: Uint8Array; meta: FileMeta } | null> {
  const f = await fileOf(root, path)
  if (!f) return null
  return { data: new Uint8Array(await f.arrayBuffer()), meta: { mtime: f.lastModified, size: f.size } }
}

export async function fileOf(root: FileSystemDirectoryHandle, path: string): Promise<File | null> {
  const { dirs, name } = split(path)
  const dir = await dirOf(root, dirs, false)
  if (!dir) return null
  try {
    return await (await dir.getFileHandle(name)).getFile()
  } catch {
    return null
  }
}

export async function removeFile(root: FileSystemDirectoryHandle, path: string): Promise<void> {
  const { dirs, name } = split(path)
  const dir = await dirOf(root, dirs, false)
  if (!dir) return
  try {
    await dir.removeEntry(name)
  } catch (e) {
    if ((e as DOMException)?.name !== 'NotFoundError') throw e
  }
}

/** Remove now-empty folders on the way up from `dir` (never the root). */
export async function pruneEmpty(root: FileSystemDirectoryHandle, dir: string): Promise<void> {
  const segs = dir.split('/').filter(Boolean)
  while (segs.length) {
    const parent = await dirOf(root, segs.slice(0, -1), false)
    const here = parent ? await dirOf(parent, [segs[segs.length - 1]], false) : null
    if (!parent || !here) return
    for await (const _ of (here as unknown as IterableDir).values()) return
    await parent.removeEntry(segs[segs.length - 1]).catch(() => {})
    segs.pop()
  }
}

/** Every file below the root (hidden folders like .git / .obsidian / .trash are skipped). */
export async function listFiles(root: FileSystemDirectoryHandle, skip: (path: string) => boolean): Promise<Map<string, FileSystemFileHandle>> {
  const out = new Map<string, FileSystemFileHandle>()
  const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
    for await (const h of (dir as unknown as IterableDir).values()) {
      const path = `${prefix}${h.name}`
      if (h.kind === 'directory') {
        if (!h.name.startsWith('.') && !skip(`${path}/`)) await walk(h as FileSystemDirectoryHandle, `${path}/`)
      } else if (!skip(path)) out.set(path, h as FileSystemFileHandle)
    }
  }
  await walk(root, '')
  return out
}
