/**
 * one-worker — comparing paths as the disk does: without case on Windows and macOS (their disks usually ignore it),
 * trailing separators off. `pathId` / `samePath` are lexical (no realpath); `inFolder` answers "inside", also through
 * links. Plus what a disk on Windows needs besides: renames and removals that wait out a file someone holds open
 * (Defender, the search indexer, an editor), and the synced folders (iCloud Drive, ~/Library/CloudStorage, OneDrive)
 * git should not work in.
 */
import { existsSync, realpathSync, renameSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, posix, resolve, sep, win32 } from 'node:path'
import { envGet } from './exec.ts'

const folds = (platform: NodeJS.Platform) => platform === 'win32' || platform === 'darwin'
const pathOf = (platform: NodeJS.Platform) => (platform === 'win32' ? win32 : posix)

/** A key for `p`: resolved, no trailing separator (the root keeps its own), lower case on Windows / macOS. */
export function pathId(p: string, platform: NodeJS.Platform = process.platform): string {
  const P = pathOf(platform)
  let s = P.resolve(p)
  const root = P.parse(s).root
  while (s.length > root.length && /[\\/]$/.test(s)) s = s.slice(0, -1)
  return folds(platform) ? s.toLowerCase() : s
}

/** The same folder or file (lexically). */
export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  return pathId(a, platform) === pathId(b, platform)
}

/** `p` as the disk resolves it: every link followed (a tail that does not exist yet kept as written). */
function onDisk(p: string, P: typeof posix): string {
  const abs = P.resolve(p)
  try {
    return realpathSync.native(abs)
  } catch {
    const up = P.dirname(abs)
    return up === abs ? abs : P.join(onDisk(up, P), P.basename(abs))
  }
}

/**
 * `path` lies in `folder` (or is it) — compared as written and as the disk resolves both (a link to the clone folder,
 * a link in it), and without case where disks usually ignore it (macOS, Windows: ~/One-Repos/x lies in ~/one-repos).
 * Wider rather than narrower: it decides that a repo's own settings stay out. A `platform` other than this computer's
 * kind of paths (tests) compares as written only.
 */
export function inFolder(path: string, folder: string, platform: NodeJS.Platform = process.platform): boolean {
  // Windows paths on either side (this computer's, or the platform asked about)
  const P = platform === 'win32' || process.platform === 'win32' ? win32 : posix
  const fold = (s: string) => (folds(platform) ? s.toLowerCase() : s)
  const within = (p: string, f: string) => {
    const rel = P.relative(fold(f), fold(p))
    return rel === '' || (!P.isAbsolute(rel) && rel.split(/[\\/]/)[0] !== '..')
  }
  if (within(P.resolve(path), P.resolve(folder))) return true
  const disk = (platform === 'win32') === (process.platform === 'win32')
  return disk && within(onDisk(path, P), onDisk(folder, P))
}

/**
 * macOS: a folder iCloud Drive syncs — its files can be "in the cloud only", and git then waits for each download.
 * iCloud Drive itself, and ~/Documents · ~/Desktop when "Desktop & Documents Folders" is on (they then appear in it).
 */
export function inICloud(path: string, home: string = homedir(), platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'darwin') return false
  // both sides resolved alike (a home written another way — relative, a trailing "/" — or, in tests on Windows, a drive)
  const p = resolve(path)
  const h = resolve(home)
  const under = (dir: string) => p === dir || p.startsWith(dir + sep)
  const mobile = join(h, 'Library', 'Mobile Documents')
  if (under(mobile)) return true
  const drive = join(mobile, 'com~apple~CloudDocs')
  return ['Documents', 'Desktop'].some((f) => under(join(h, f)) && existsSync(join(drive, f)))
}

/** A synced folder git should not work in: iCloud Drive and ~/Library/CloudStorage (macOS), OneDrive (Windows). */
export type Synced = 'icloud' | 'cloudStorage' | 'onedrive'

/** The OneDrive folders Windows names in the environment (personal, work / school). */
const ONEDRIVE_VARS = ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']

/**
 * Which synced folder `path` lies in (null: none known). macOS: iCloud Drive (inICloud), then ~/Library/CloudStorage —
 * where the File Provider clients (OneDrive, Google Drive, Dropbox …) keep theirs. Windows: inside a folder the OneDrive
 * variables name (without case, through links). Dropbox / Google Drive on Windows give no signal: not detected.
 */
export function inSyncedFolder(path: string, opts: { platform?: NodeJS.Platform; home?: string; env?: NodeJS.ProcessEnv } = {}): Synced | null {
  const platform = opts.platform ?? process.platform
  const home = opts.home ?? homedir()
  if (platform === 'darwin') {
    if (inICloud(path, home, 'darwin')) return 'icloud'
    return inFolder(path, join(home, 'Library', 'CloudStorage'), 'darwin') ? 'cloudStorage' : null
  }
  if (platform !== 'win32') return null
  const env = opts.env ?? process.env
  for (const key of ONEDRIVE_VARS) {
    const dir = envGet(env, key, 'win32')?.trim().replace(/^"(.*)"$/, '$1')
    if (dir && /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/])/.test(dir) && inFolder(path, dir, 'win32')) return 'onedrive'
  }
  return null
}

/**
 * Where a repo's task worktrees lie, said beside a synced folder's warning: `home` — ~/.one-worktrees (the default for a
 * repo in a synced folder), `own` — elsewhere outside any synced folder (worktreeDir in worker.json, a cloud worker's
 * own folder), `synced` — in a synced folder too (a worktreeDir of the person's there).
 */
export type WorktreesAt = 'home' | 'own' | 'synced'

export function worktreesAt(worktreeDir: string, opts: { platform?: NodeJS.Platform; home?: string; env?: NodeJS.ProcessEnv } = {}): WorktreesAt {
  const platform = opts.platform ?? process.platform
  const home = opts.home ?? homedir()
  if (inSyncedFolder(worktreeDir, { ...opts, platform, home })) return 'synced'
  return inFolder(worktreeDir, (platform === 'win32' ? win32 : posix).join(home, '.one-worktrees'), platform) ? 'home' : 'own'
}

/** Errors a file someone holds open gives on Windows (Defender, the indexer, an editor) — worth a second try. */
const HELD = new Set(['EPERM', 'EBUSY', 'EACCES'])

const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/**
 * renameSync that waits out a file held open on Windows: EPERM / EBUSY / EACCES are tried again (10 × 100 ms), then
 * the FIRST error is thrown. Elsewhere one try, as before (there those errors do not pass).
 */
export function renameRetry(from: string, to: string, opts: { platform?: NodeJS.Platform; rename?: (a: string, b: string) => void; wait?: (ms: number) => void; tries?: number; delayMs?: number } = {}): void {
  const rename = opts.rename ?? renameSync
  const tries = (opts.platform ?? process.platform) === 'win32' ? (opts.tries ?? 10) : 0
  let first: unknown = null
  for (let i = 0; ; i++) {
    try {
      rename(from, to)
      return
    } catch (e) {
      first ??= e
      if (i >= tries || !HELD.has(String((e as NodeJS.ErrnoException)?.code))) throw first
      ;(opts.wait ?? sleepSync)(opts.delayMs ?? 100)
    }
  }
}

/**
 * Remove a folder the worker made (recursive, force), trying again while Windows still holds a file in it (Node's
 * own retries: 10 × 200 ms). Never throws: false when it is still there — the caller says so and goes on.
 */
export async function rmRetry(path: string): Promise<boolean> {
  try {
    await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    return true
  } catch {
    return false
  }
}
