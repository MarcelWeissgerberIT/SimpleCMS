/** Bounded host observations of Git-visible bytes. No file contents or local paths leave this module.
 * Ignored build output, external services and installed dependencies are outside this fingerprint.
 * Two observations detect changes, but are not an OS lock against concurrent/transient writes.
 */
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readlink, realpath } from 'node:fs/promises'
import { dirname, resolve, relative, isAbsolute } from 'node:path'
import { git } from './git.ts'

export interface Candidate { hash: string | null; files: number; reason?: 'unavailable' | 'limit' | 'changed' }
export async function candidateSnapshot(cwd: string, signal: AbortSignal): Promise<Candidate> {
  let count = 0
  const fail = (reason: Candidate['reason']): Candidate => ({ hash: null, files: count, reason })
  try {
    signal.throwIfAborted()
    const root = await realpath(cwd), started = Date.now()
    const list = () => git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--deduplicate'], 10000, { local: true })
    const before = await list(), head = await git(root,['rev-parse','HEAD'],5000,{local:true})
    if (before.code !== 0 || head.code !== 0 || !/^[a-f0-9]{40,64}$/.test(head.stdout.trim())) return fail('unavailable')
    const paths = [...new Set(before.stdout.split('\0').filter(Boolean))].sort()
    if (paths.length > 25000) return fail('limit')
    const hash = createHash('sha256').update('one-git-visible-v1\0').update(head.stdout.trim()).update('\0'), chunk = Buffer.allocUnsafe(65536)
    let total = 0
    for (const name of paths) {
      signal.throwIfAborted()
      if (Date.now() - started > 20000) return fail('limit')
      const path = resolve(root, name), rel = relative(root, path)
      if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) return fail('unavailable')
      // Refuse parent symlinks rather than opening a file outside the observed worktree.
      if (await realpath(dirname(path)) !== dirname(path)) return fail('unavailable')
      hash.update(JSON.stringify(name)).update('\0')
      let stat
      try { stat = await lstat(path, { bigint: true }) } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
        hash.update('deleted\0'); count++; continue
      }
      if (stat.isSymbolicLink()) { hash.update('symlink\0').update(await readlink(path)).update('\0'); count++; continue }
      // Submodules and special files need their own evidence; never silently claim full coverage.
      if (!stat.isFile()) return fail('unavailable')
      if (stat.size > 128n * 1024n * 1024n || (total += Number(stat.size)) > 512 * 1024 * 1024) return fail('limit')
      const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
      try {
        const opened = await file.stat({ bigint: true })
        if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size !== stat.size) return fail('changed')
        const content = createHash('sha256'); let bytes = 0
        while (true) {
          signal.throwIfAborted()
          const { bytesRead } = await file.read(chunk, 0, chunk.length, null)
          if (!bytesRead) break
          bytes += bytesRead
          if (bytes > Number(stat.size) || Date.now() - started > 20000) return fail('changed')
          content.update(chunk.subarray(0, bytesRead))
        }
        const after = await file.stat({ bigint: true }), current = await lstat(path, { bigint: true })
        if (bytes !== Number(stat.size) || [after, current].some(s => s.ino !== stat.ino || s.dev !== stat.dev || s.size !== stat.size || s.mtimeNs !== stat.mtimeNs || s.ctimeNs !== stat.ctimeNs)) return fail('changed')
        hash.update(`${stat.mode & 0o111n}\0`).update(content.digest('hex')).update('\0')
      } finally { await file.close() }
      count++
    }
    const after = await list()
    const afterHead=await git(root,['rev-parse','HEAD'],5000,{local:true})
    if (after.code !== 0 || before.stdout !== after.stdout || afterHead.code!==0 || head.stdout!==afterHead.stdout) return fail('changed')
    return { hash: hash.digest('hex'), files: count }
  } catch (e) { if (signal.aborted) throw e; return fail('unavailable') }
}
