/**
 * one-worker — a ZIP of source code becomes a new git repository in the clone folder (default ~/one-repos), only
 * from the person's upload on the LOCAL setup page or an Import stage of theirs (intake.ts). Then the page ticks it
 * like a folder added by hand.
 *
 * Unpacked with fflate's streaming reader, file by file, never through a shell or an unzip tool:
 *  - left out first (never written, so their names cannot matter): every name some file system reads as ".git"
 *    (isDotGit — its hooks and config could run commands), __MACOSX, .DS_Store and Finder's "Icon\r"
 *  - every other path must stay inside the new folder: an absolute path, a drive letter or a ".." anywhere refuses
 *    the whole ZIP, and so does a control character; on Windows also ":" and a device name (entryPath); links are
 *    written as plain files (the streaming reader never makes a link)
 *  - caps: the upload (500 MB, ONE_WORKER_ZIP_MAX), unpacked bytes (2 GB) and files (100,000)
 *  - one folder at the top (project-main/…) becomes the repository itself
 * Then, only while the new folder holds no git folder — no ".git" in any spelling and no folder git would take for
 * a repository (gitDirIn, asked of the file system too) — one commit "Import <file>" made against a fresh git folder
 * outside it, moved in at the end (commitImport). A failed import leaves no folder behind. The repository is marked
 * as the worker's import (SOURCE_MARK): Claude Code runs on it without the repo's own settings (config.ts).
 * Nothing is pushed: the repo has no remote until the person adds one.
 */
import { Unzip, UnzipInflate } from 'fflate'
import { closeSync, createReadStream, existsSync, lstatSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { SOURCE_MARK } from './config.ts'
import { git } from './git.ts'

export const ZIP_MAX = () => Number(process.env.ONE_WORKER_ZIP_MAX) || 500 * 1024 * 1024
const UNPACKED_MAX = 2 * 1024 * 1024 * 1024
const FILES_MAX = 100_000
/** what Unzip.push gets at a time (≤ a few hundred entries end inside one piece) */
const PUSH_PIECE = 16 * 1024

/** Why a ZIP is refused as a whole (it reads "the ZIP has <why>"). */
export interface Unsafe {
  readonly unsafe: string
}
const OUTSIDE: Unsafe = { unsafe: 'a path outside its folder' }
const CONTROL: Unsafe = { unsafe: 'a name with a control character' }
const COLON: Unsafe = { unsafe: 'a name with ":", which Windows reads as a hidden data stream' }
const DEVICE: Unsafe = { unsafe: 'a name Windows keeps for a device like CON, NUL, AUX, COM1 or LPT1' }

/** Code points HFS+ leaves out when it compares names (git's next_hfs_char, utf8.c). */
const HFS_IGNORABLE = /[‌-‏‪-‮⁪-⁯﻿]/g

/**
 * A name some file system resolves to the ".git" folder — git's own is_ntfs_dotgit (path.c) and is_hfs_dotgit
 * (utf8.c), which git uses to refuse such paths in a checkout, folded into one check:
 *  - NTFS and APFS / HFS+ (the macOS default) ignore case: ".GIT" and ".Git" are ".git"
 *  - NTFS (Win32 names) drops trailing dots and spaces: ".git." and ".git . " are ".git"
 *  - NTFS: "name:stream" is a data stream of "name" itself (".git::$INDEX_ALLOCATION" is the folder)
 *  - NTFS 8.3 short names: ".git" is also "GIT~1" (git checks ~1; any ~<n> here)
 *  - HFS+ ignores U+200C–U+200F, U+202A–U+202E, U+206A–U+206F and U+FEFF: ".g‌it" is ".git"
 * git keeps the NTFS and HFS checks apart; one fold drops a few more names than either — none a source tree needs.
 */
export function isDotGit(part: string): boolean {
  const s = part.replace(HFS_IGNORABLE, '').toLowerCase().split(':')[0]!.replace(/[. ]+$/, '')
  return s === '.git' || /^git~\d+$/.test(s)
}

/**
 * A Windows device name, with or without an extension ("nul", "NUL.txt", "con .tar.gz"): writing it opens the
 * device — the console, a serial or printer port, NUL that swallows everything — never a file. Git for Windows
 * refuses them in a checkout for the same reason.
 */
const isDevice = (part: string) => /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)$/i.test(part.split('.')[0]!.replace(/ +$/, ''))

/** Finder's own files: folder view settings and a custom folder icon ("Icon" + CR, its picture in __MACOSX). */
const FINDER_FILES = new Set(['.DS_Store', 'Icon\r'])

/**
 * A ZIP entry's path inside the new folder ("src/a.ts"), null to leave it out, Unsafe to refuse the ZIP. What is
 * left out is never written, so it is dropped before any name is checked. ":" and device names only matter where
 * Windows writes the file (`platform`): elsewhere they are plain names git keeps (the kernel's aux.c, con.go).
 */
export function entryPath(name: string, platform: NodeJS.Platform = process.platform): string | null | Unsafe {
  const n = name.replace(/\\/g, '/')
  if (!n) return OUTSIDE
  const parts = n.split('/').filter((p) => p && p !== '.')
  if (parts.some(isDotGit) || parts[0] === '__MACOSX' || FINDER_FILES.has(parts.at(-1) ?? '')) return null
  // control characters: Windows forbids them in names; elsewhere a newline or an escape in a name breaks git's
  // line-by-line output the worker reads and can paint over a terminal or a log. U+0080–U+009F stay allowed: a ZIP
  // without the UTF-8 flag (CP437 from older Windows tools) is read as Latin-1, and its umlauts land there
  if (/[\u0000-\u001f\u007f]/.test(n)) return CONTROL
  if (n.startsWith('/') || /^[A-Za-z]:/.test(n)) return OUTSIDE
  // "..", and any name of only dots and spaces: Windows drops trailing dots and spaces (".. " can be ".."), HFS+
  // ignores some code points ("..\u200c" compares as "..")
  if (parts.some((p) => /^[. ]*$/.test(p.replace(HFS_IGNORABLE, '')))) return OUTSIDE
  if (platform === 'win32') {
    // ":" — on NTFS "name:stream" writes into a data stream of "name" and "C:name" is relative to drive C
    if (parts.some((p) => p.includes(':'))) return COLON
    if (parts.some(isDevice)) return DEVICE
  }
  if (!parts.length || n.endsWith('/')) return null
  if (parts.some((p) => p.length > 255)) return null
  return parts.join('/')
}
export const isUnsafe = (v: unknown): v is Unsafe => typeof v === 'object' && v !== null && 'unsafe' in v

/** A name as it may be shown on the setup page, in One and in the log. */
const shown = (name: string) => name.replace(/[\u0000-\u001f\u007f]/g, '?').slice(0, 120)

const entry = (path: string) => lstatSync(path, { throwIfNoEntry: false })

/**
 * A folder git would take for a repository of its own (git's is_git_directory, setup.c): a HEAD, and objects/ +
 * refs/ (or a commondir pointing at them). Asked of the file system, so a case-insensitive disk answers as git does.
 * git uses such a folder — a bare repository — for any git command run inside it, its config included.
 */
function isRepoDir(d: string): boolean {
  const head = entry(join(d, 'HEAD'))
  if (!head || head.isDirectory()) return false
  if (entry(join(d, 'commondir'))?.isFile()) return true
  return !!entry(join(d, 'objects'))?.isDirectory() && !!entry(join(d, 'refs'))?.isDirectory()
}

export interface PlantedGit {
  path: string
  /** "dotgit": named like .git · "repo": a folder git takes for a repository (a bare one) */
  kind: 'dotgit' | 'repo'
}

/**
 * The second guard, after unpacking and before any git step: the first git folder anywhere in `dir` — an entry named
 * like ".git" (isDotGit), one the file system itself answers for ".git" (a case-insensitive or otherwise folding
 * volume), or a folder git would use as a repository (isRepoDir) — else null. entryPath left every ".git" name out
 * already: this catches a folding nobody foresaw, and a bare repository planted under any name.
 */
export function gitDirIn(dir: string): PlantedGit | null {
  const todo = [dir]
  while (todo.length) {
    const d = todo.pop()!
    if (entry(join(d, '.git'))) return { path: join(d, '.git'), kind: 'dotgit' }
    if (isRepoDir(d)) return { path: d, kind: 'repo' }
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (isDotGit(e.name)) return { path: join(d, e.name), kind: 'dotgit' }
      if (e.isDirectory()) todo.push(join(d, e.name))
    }
  }
  return null
}

/** Throws when `dir` holds a git folder (gitDirIn): nothing is imported then. */
function refusePlanted(dir: string): void {
  const planted = gitDirIn(dir)
  if (!planted) return
  const at = shown(relative(dir, planted.path) || '.')
  if (planted.kind === 'dotgit') throw new Error(`the ZIP holds a git folder under another spelling (${at}) — nothing was imported`)
  throw new Error(`the ZIP holds a git repository in ${at} (HEAD, objects, refs) — git would use it, and its config, for every git command run in that folder. Leave it out (a test fixture too) and zip again — nothing was imported`)
}

export interface ImportProgress {
  files: number
  bytes: number
}

/** Unpack `zipFile` into `<base>/<name>` (or <name>-2 …), make it a repository with one commit. */
export async function importZip(zipFile: string, base: string, name: string, label: string, onProgress: (p: ImportProgress) => void = () => {}): Promise<{ dir: string; files: number }> {
  mkdirSync(base, { recursive: true })
  const tmp = join(base, `.one-import-${randomBytes(6).toString('hex')}`)
  mkdirSync(tmp)
  let files = 0
  let bytes = 0
  let fail: string | null = null
  let open = 0
  try {
    const uz = new Unzip((file) => {
      if (fail) return
      const rel = entryPath(file.name)
      if (isUnsafe(rel)) {
        fail = `the ZIP has ${rel.unsafe} (${shown(file.name)}) — nothing was imported`
        return
      }
      if (rel === null) return
      if (++files > FILES_MAX) {
        fail = `the ZIP has more than ${FILES_MAX.toLocaleString('en')} files`
        return
      }
      const dest = resolve(tmp, rel)
      if (!dest.startsWith(tmp + sep)) {
        fail = `the ZIP has a path outside its folder (${shown(file.name)})`
        return
      }
      mkdirSync(dirname(dest), { recursive: true })
      let fd: number | null = openSync(dest, 'w', 0o644)
      open++
      const close = () => {
        if (fd === null) return
        closeSync(fd)
        fd = null
        open--
      }
      file.ondata = (err, data, final) => {
        if (err) {
          fail ??= `${shown(file.name)} could not be unpacked (${err.message}) — zip it again with a usual tool`
          close()
          return
        }
        if (fail) return close()
        bytes += data.length
        if (bytes > UNPACKED_MAX) {
          fail = 'the ZIP unpacks to more than 2 GB'
          return close()
        }
        if (data.length) writeSync(fd!, data)
        if (final) {
          close()
          onProgress({ files, bytes })
        }
      }
      try {
        file.start()
      } catch (e) {
        fail ??= `${shown(file.name)}: ${(e as Error).message} — zip it again with a usual tool`
        close()
      }
    })
    uz.register(UnzipInflate)
    for await (const chunk of createReadStream(zipFile, { highWaterMark: 1024 * 1024 })) {
      // fflate's Unzip.push recurses once per entry that ends inside the piece it was given: thousands of tiny files
      // in one 1 MB read overflow the stack — hand it small pieces
      const bytes = chunk as Uint8Array
      for (let off = 0; off < bytes.length && !fail; off += PUSH_PIECE) uz.push(bytes.subarray(off, off + PUSH_PIECE))
      if (fail) break
    }
    if (!fail) uz.push(new Uint8Array(0), true)
    if (!fail && open > 0) fail = 'the ZIP ended in the middle of a file'
    if (!fail && files === 0) fail = 'the ZIP has no files'
    if (fail) throw new Error(fail)

    // one folder at the top: that folder is the project
    const top = readdirSync(tmp)
    const root = top.length === 1 && statSync(join(tmp, top[0]!)).isDirectory() ? join(tmp, top[0]!) : tmp
    let dir = join(base, name)
    for (let i = 2; existsSync(dir); i++) dir = join(base, `${name}-${i}`)
    renameSync(root, dir)
    if (root !== tmp) rmSync(tmp, { recursive: true, force: true })
    await finishImport(dir, label)
    return { dir, files }
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })
  }
}

/** After unpacking: the second guard (gitDirIn), then the commit. The folder goes again when either fails. */
export async function finishImport(dir: string, label: string): Promise<void> {
  try {
    refusePlanted(dir)
    await commitImport(dir, label)
  } catch (e) {
    rmSync(dir, { recursive: true, force: true })
    throw e
  }
}

/**
 * Branch main, everything added, one commit "Import <label>" — against a fresh git folder made next to `dir` and
 * moved in only at the end, so no config or hook in `dir` is ever read, even of a .git that slipped past both
 * guards (its fsmonitor, filter drivers, gpg.program, include.path …). The person's own git config still applies
 * (their identity, LFS) except fsmonitor and hooks: off, hooks only from an empty folder, --no-verify. Before the
 * move `dir` is checked once more; a git folder there refuses the import.
 */
export async function commitImport(dir: string, label: string): Promise<void> {
  const holder = join(dirname(dir), `.one-import-git-${randomBytes(6).toString('hex')}`)
  const gitDir = join(holder, '.git')
  const hooks = join(holder, 'no-hooks')
  mkdirSync(hooks, { recursive: true })
  const safe = ['-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${hooks}`]
  const repo = [`--git-dir=${gitDir}`, `--work-tree=${dir}`]
  const run = async (cwd: string, args: string[], timeoutMs = 120_000) => {
    const r = await git(cwd, [...safe, ...args], timeoutMs)
    const verb = args.find((a, i) => !a.startsWith('-') && args[i - 1] !== '-c')
    if (r.code !== 0) throw new Error(`git ${verb} failed: ${(r.stderr || r.stdout).trim().split('\n').slice(-2).join(' ')}`)
  }
  try {
    await run(holder, ['init', '-q'])
    await run(dir, [...repo, 'symbolic-ref', 'HEAD', 'refs/heads/main'])
    await run(dir, [...repo, 'add', '-A'], 10 * 60_000)
    const who = (await git(dir, [...safe, ...repo, 'config', 'user.email'])).stdout.trim()
    const identity = who ? [] : ['-c', 'user.name=One worker', '-c', 'user.email=one-worker@localhost']
    await run(dir, [...identity, ...repo, 'commit', '-q', '--no-verify', '--allow-empty', '-m', `Import ${label.slice(0, 200)}`], 10 * 60_000)
    writeFileSync(join(gitDir, SOURCE_MARK), 'zip\n')
    refusePlanted(dir)
    renameSync(gitDir, join(dir, '.git'))
  } finally {
    rmSync(holder, { recursive: true, force: true })
  }
}
