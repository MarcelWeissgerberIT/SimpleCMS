/**
 * one-worker — a ZIP of source code becomes a new git repository in the clone folder (default ~/one-repos), only
 * from the person's upload on the LOCAL setup page or an Import stage of theirs (intake.ts). Then the page ticks it
 * like a folder added by hand.
 *
 * Unpacked with fflate's streaming reader, file by file, never through a shell or an unzip tool:
 *  - every path must stay inside the new folder: an absolute path, a drive letter or a ".." anywhere refuses the
 *    whole ZIP, and so does a name with ":", a control character or a Windows device name (entryPath); links are
 *    written as plain files (the streaming reader never makes a link)
 *  - left out: every name some file system reads as ".git" (isDotGit — its hooks and config could run commands),
 *    __MACOSX, .DS_Store
 *  - caps: the upload (500 MB, ONE_WORKER_ZIP_MAX), unpacked bytes (2 GB) and files (100,000)
 *  - one folder at the top (project-main/…) becomes the repository itself
 * Then, only while the new folder holds no ".git" in any spelling (dotGitIn, asked of the file system too), `git
 * init`, branch main, everything added (the ZIP's .gitignore applies) and one commit "Import <file>" — fsmonitor off,
 * hooks from an empty folder, --no-verify (commitImport). A failed import leaves no folder behind.
 * Nothing is pushed: the repo has no remote until the person adds one.
 */
import { Unzip, UnzipInflate } from 'fflate'
import { closeSync, createReadStream, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, renameSync, rmSync, statSync, writeSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
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

/** A ZIP entry's path inside the new folder ("src/a.ts"), null to leave it out, Unsafe to refuse the ZIP. */
export function entryPath(name: string): string | null | Unsafe {
  const n = name.replace(/\\/g, '/')
  if (!n) return OUTSIDE
  // control characters: Windows forbids them in names; elsewhere a newline or an escape in a name breaks git's
  // line-by-line output the worker reads and can paint over a terminal or a log. U+0080–U+009F stay allowed: a ZIP
  // without the UTF-8 flag (CP437 from older Windows tools) is read as Latin-1, and its umlauts land there
  if (/[\u0000-\u001f\u007f]/.test(n)) return CONTROL
  if (n.startsWith('/') || /^[A-Za-z]:/.test(n)) return OUTSIDE
  const parts = n.split('/').filter((p) => p && p !== '.')
  // "..", and any name of only dots and spaces: Windows drops trailing dots and spaces (".. " can be ".."), HFS+
  // ignores some code points ("..‌" compares as "..")
  if (parts.some((p) => /^[. ]*$/.test(p.replace(HFS_IGNORABLE, '')))) return OUTSIDE
  // ":" — on NTFS "name:stream" writes into a data stream of "name" (".git::$INDEX_ALLOCATION" is the .git folder
  // itself) and "C:name" is relative to drive C; no portable source tree needs it
  if (parts.some((p) => p.includes(':'))) return COLON
  if (parts.some(isDevice)) return DEVICE
  if (!parts.length || n.endsWith('/')) return null
  if (parts.some((p) => isDotGit(p) || p.length > 255) || parts[0] === '__MACOSX' || parts[parts.length - 1] === '.DS_Store') return null
  return parts.join('/')
}
export const isUnsafe = (v: unknown): v is Unsafe => typeof v === 'object' && v !== null && 'unsafe' in v

/** A name as it may be shown on the setup page, in One and in the log. */
const shown = (name: string) => name.replace(/[\u0000-\u001f\u007f]/g, '?').slice(0, 120)

/**
 * The second guard, after unpacking and before `git init`: the first entry anywhere in `dir` that is named like
 * ".git" (isDotGit) or that the file system itself answers for ".git" (a case-insensitive or otherwise folding
 * volume), else null. entryPath left every such name out already — this catches a folding nobody foresaw.
 */
export function dotGitIn(dir: string): string | null {
  const todo = [dir]
  while (todo.length) {
    const d = todo.pop()!
    if (lstatSync(join(d, '.git'), { throwIfNoEntry: false })) return join(d, '.git')
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (isDotGit(e.name)) return join(d, e.name)
      if (e.isDirectory()) todo.push(join(d, e.name))
    }
  }
  return null
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
    try {
      const planted = dotGitIn(dir)
      if (planted) throw new Error(`the ZIP holds a git folder under another spelling (${shown(relative(dir, planted))}) — nothing was imported`)
      await commitImport(dir, label)
    } catch (e) {
      rmSync(dir, { recursive: true, force: true })
      throw e
    }
    return { dir, files }
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })
  }
}

/**
 * `git init`, branch main, everything added, one commit "Import <label>" — run so that nothing in the folder can
 * start a program, even a .git that slipped past both guards: fsmonitor off (`git add` would run core.fsmonitor as
 * a command), hooks only from an empty folder made for this import and removed after it (pre-commit,
 * post-index-change, reference-transaction …, also the person's own core.hooksPath), --no-verify on the commit.
 * The person's identity (user.email / user.name from their git config) is used as before.
 */
export async function commitImport(dir: string, label: string): Promise<void> {
  const hooks = mkdtempSync(join(tmpdir(), 'one-import-hooks-'))
  const safe = ['-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${hooks}`]
  const run = async (args: string[], timeoutMs = 120_000) => {
    const r = await git(dir, [...safe, ...args], timeoutMs)
    const verb = args.find((a, i) => !a.startsWith('-') && args[i - 1] !== '-c')
    if (r.code !== 0) throw new Error(`git ${verb} failed: ${(r.stderr || r.stdout).trim().split('\n').slice(-2).join(' ')}`)
  }
  try {
    await run(['init', '-q'])
    await run(['symbolic-ref', 'HEAD', 'refs/heads/main'])
    await run(['add', '-A'], 10 * 60_000)
    const who = (await git(dir, [...safe, 'config', 'user.email'])).stdout.trim()
    const identity = who ? [] : ['-c', 'user.name=One worker', '-c', 'user.email=one-worker@localhost']
    await run([...identity, 'commit', '-q', '--no-verify', '--allow-empty', '-m', `Import ${label.slice(0, 200)}`], 10 * 60_000)
  } finally {
    rmSync(hooks, { recursive: true, force: true })
  }
}
