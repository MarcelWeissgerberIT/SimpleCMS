/**
 * one-worker — a ZIP of source code becomes a new git repository in the clone folder (default ~/one-repos), only
 * from the person's upload on the LOCAL setup page. Then the page ticks it like a folder added by hand.
 *
 * Unpacked with fflate's streaming reader, file by file, never through a shell or an unzip tool:
 *  - every path must stay inside the new folder: an absolute path, a drive letter or a ".." anywhere refuses the
 *    whole ZIP; links are written as plain files (the streaming reader never makes a link)
 *  - left out: every ".git" folder (its hooks and config could run commands), __MACOSX, .DS_Store
 *  - caps: the upload (500 MB, ONE_WORKER_ZIP_MAX), unpacked bytes (2 GB) and files (100,000)
 *  - one folder at the top (project-main/…) becomes the repository itself
 * Then `git init`, branch main, everything added (the ZIP's .gitignore applies) and one commit "Import <file>".
 * Nothing is pushed: the repo has no remote until the person adds one.
 */
import { Unzip, UnzipInflate } from 'fflate'
import { closeSync, createReadStream, existsSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, statSync, writeSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, join, resolve, sep } from 'node:path'
import { git } from './git.ts'

export const ZIP_MAX = () => Number(process.env.ONE_WORKER_ZIP_MAX) || 500 * 1024 * 1024
const UNPACKED_MAX = 2 * 1024 * 1024 * 1024
const FILES_MAX = 100_000

const UNSAFE = Symbol('unsafe')

/** A ZIP entry's path inside the new folder ("src/a.ts"), null to leave it out, UNSAFE to refuse the ZIP. */
export function entryPath(name: string): string | null | typeof UNSAFE {
  const n = name.replace(/\\/g, '/')
  if (!n || n.includes('\0') || n.startsWith('/') || /^[A-Za-z]:/.test(n)) return UNSAFE
  const parts = n.split('/').filter((p) => p && p !== '.')
  if (parts.some((p) => p === '..')) return UNSAFE
  if (!parts.length || n.endsWith('/')) return null
  if (parts.some((p) => p === '.git' || p.length > 255) || parts[0] === '__MACOSX' || parts[parts.length - 1] === '.DS_Store') return null
  return parts.join('/')
}
export const isUnsafe = (v: unknown): v is typeof UNSAFE => v === UNSAFE

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
        fail = `the ZIP has a path outside its folder (${file.name.slice(0, 120)}) — nothing was imported`
        return
      }
      if (rel === null) return
      if (++files > FILES_MAX) {
        fail = `the ZIP has more than ${FILES_MAX.toLocaleString('en')} files`
        return
      }
      const dest = resolve(tmp, rel)
      if (!dest.startsWith(tmp + sep)) {
        fail = `the ZIP has a path outside its folder (${file.name.slice(0, 120)})`
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
          fail ??= `${file.name.slice(0, 120)} could not be unpacked (${err.message}) — zip it again with a usual tool`
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
        fail ??= `${file.name.slice(0, 120)}: ${(e as Error).message} — zip it again with a usual tool`
        close()
      }
    })
    uz.register(UnzipInflate)
    for await (const chunk of createReadStream(zipFile, { highWaterMark: 1024 * 1024 })) {
      uz.push(chunk as Uint8Array)
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

    await gitOk(dir, ['init', '-q'])
    await gitOk(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
    await gitOk(dir, ['add', '-A'], 10 * 60_000)
    const who = (await git(dir, ['config', 'user.email'])).stdout.trim()
    const identity = who ? [] : ['-c', 'user.name=One worker', '-c', 'user.email=one-worker@localhost']
    await gitOk(dir, [...identity, 'commit', '-q', '--allow-empty', '-m', `Import ${label.slice(0, 200)}`], 10 * 60_000)
    return { dir, files }
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })
  }
}

async function gitOk(dir: string, args: string[], timeoutMs = 120_000): Promise<void> {
  const r = await git(dir, args, timeoutMs)
  if (r.code !== 0) throw new Error(`git ${args.filter((a) => !a.startsWith('user.')).join(' ')} failed: ${(r.stderr || r.stdout).trim().split('\n').slice(-2).join(' ')}`)
}
