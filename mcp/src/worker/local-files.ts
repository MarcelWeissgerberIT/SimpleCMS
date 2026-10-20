import { realpath, readdir, mkdir, lstat, open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

/** A filesystem boundary, also checked through symlinks and for new files' existing ancestors. */
export async function localPath(root: string, input: unknown): Promise<string> {
  if (typeof input !== 'string' || !input || input.includes('\0') || isAbsolute(input) || input.split(/[/\\]/).some(p => p === '..' || p.toLowerCase() === '.git')) throw new Error('Use a relative path inside the worktree, outside .git.')
  const dest = resolve(root, input)
  const inside = (p: string) => { const r = relative(root, p); return !r.startsWith('..') && !isAbsolute(r) }
  if (!inside(dest)) throw new Error('Path leaves the worktree.')
  let segment = root
  for (const part of relative(root, dest).split(/[/\\]/).filter(Boolean)) {
    segment = resolve(segment, part)
    try { if ((await lstat(segment)).isSymbolicLink()) throw new Error('Symbolic links are not accessible to this agent.') }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') break; throw e }
  }
  let existing = dest
  while (true) {
    try {
      const actual = await realpath(existing)
      if (!inside(actual) || relative(root, actual).split(/[/\\]/).some(p => p.toLowerCase() === '.git')) throw new Error('Symlink leaves the permitted worktree.')
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      if (existing === root) throw e
      existing = dirname(existing)
    }
  }
  return dest
}

const EXCLUDED = /^(?:\..*|node_modules|vendor|dist|build|coverage|target|__pycache__|.*\.(?:pem|key|p12|pfx|keystore)|credentials(?:\..*)?|id_(?:rsa|ed25519))$/i
const digest = (s: string) => createHash('sha256').update(s).digest('hex')
const MAX_FILE = 200_000
const integer = (v: unknown, fallback: number) => v === undefined ? fallback : typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : (() => { throw new Error('Line numbers must be positive integers.') })()

/** Tools share a snapshot: patches cannot overwrite a file changed since it was read. */
export class LocalFiles {
  private seen = new Map<string, { hash: string; full: boolean; excerpts: string[] }>()
  forgetReads() { this.seen.clear() }
  private root: string
  constructor(root: string) { this.root = root }
  private async path(input: unknown): Promise<string> {
    if (typeof input === 'string' && input.split(/[/\\]/).some(p => p !== '.' && EXCLUDED.test(p))) throw new Error('Generated, hidden and credential files are excluded.')
    return localPath(this.root, input)
  }
  private async text(path: string): Promise<string> {
    const info = await lstat(path)
    if (!info.isFile() || info.nlink > 1 || info.size > MAX_FILE) throw new Error('Read a regular source file up to 200 KB, without hard links.')
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    try {
      const bytes = await file.readFile()
      if (bytes.length > MAX_FILE || bytes.includes(0)) throw new Error('Binary or oversized file.')
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } finally { await file.close() }
  }
  async list(input: unknown) {
    return (await readdir(await this.path(input), { withFileTypes: true })).filter(e => !EXCLUDED.test(e.name) && !e.isSymbolicLink()).slice(0, 200).map(e => ({ name: e.name, directory: e.isDirectory() }))
  }
  async read(input: unknown, first?: unknown, last?: unknown) {
    const path = await this.path(input)
    const text = await this.text(path)
    const lines = text.split('\n')
    const start = integer(first, 1)
    const end = Math.min(integer(last, start + 199), start + 399, lines.length)
    if (start > lines.length || end < start) throw new Error('Line range is outside the file.')
    const content = lines.slice(start - 1, end).join('\n').slice(0, 20000)
    const full = start === 1 && end === lines.length && content === text
    const previous = this.seen.get(path)
    this.seen.set(path, { hash: digest(text), full: full || (!!previous?.full && previous.hash === digest(text)), excerpts: [...(previous?.hash === digest(text) ? previous.excerpts.slice(-7) : []), content] })
    return { revision: digest(text), path: input, start_line: start, end_line: end, total_lines: lines.length, complete: full, content }
  }
  async write(input: unknown, content: unknown) {
    if (typeof content !== 'string' || content.length > 60000) throw new Error('File content must be text up to 60,000 characters.')
    const path = await this.path(input)
    let existing: string | null = null
    try { existing = await this.text(path) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
    if (existing !== null) {
      const seen = this.seen.get(path)
      if (!seen?.full || seen.hash !== digest(existing)) throw new Error('Read the complete current file before replacing it; use edit_file for a partial change.')
    }
    await this.save(path, content, existing === null)
    return 'File written.'
  }
  async edit(input: unknown, before: unknown, after: unknown) {
    if (typeof before !== 'string' || !before || typeof after !== 'string' || before.length > 20000 || after.length > 20000) throw new Error('Supply nonempty old_text and new_text, each up to 20,000 characters.')
    const path = await this.path(input)
    const text = await this.text(path)
    const seen = this.seen.get(path)
    if (!seen || seen.hash !== digest(text) || !seen.excerpts.some(s => s.includes(before))) throw new Error('Read the current target lines before editing; the file may have changed.')
    const at = text.indexOf(before)
    if (at < 0 || text.indexOf(before, at + 1) >= 0) throw new Error('old_text must match exactly once. Include more surrounding lines.')
    const updated = text.slice(0, at) + after + text.slice(at + before.length)
    if (updated.length > MAX_FILE) throw new Error('Edited file exceeds 200 KB.')
    await this.save(path, updated)
    return 'Unique matching passage replaced. Read again before another edit.'
  }
  private async save(path: string, content: string, create = false) {
    await mkdir(dirname(path), { recursive: true })
    await this.path(relative(this.root, path))
    const file = await open(path, constants.O_WRONLY | (create ? constants.O_CREAT | constants.O_EXCL : 0) | (constants.O_NOFOLLOW || 0), 0o644)
    try {
      const info = await file.stat()
      if (!info.isFile() || info.nlink > 1) throw new Error('Only regular files without hard links may be written.')
      // Check after opening too; refuse stale snapshots before truncating.
      const seen = this.seen.get(path)
      if (seen && digest(await this.text(path)) !== seen.hash) throw new Error('File changed. Read it again.')
      await file.truncate(0)
      await file.writeFile(content)
    } finally { await file.close() }
    this.seen.delete(path)
  }
  async search(query: unknown, folder: unknown = '.') {
    if (typeof query !== 'string' || !query.trim() || query.length > 200) throw new Error('Search with literal text, 1–200 characters.')
    const matches: Array<{ path: string; line: number; text: string }> = []
    let visited = 0; let bytes = 0; let truncated = false
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 15 || visited >= 1500 || bytes > 8_000_000 || matches.length >= 60) { truncated = true; return }
      const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
      for (const entry of entries) {
        if (EXCLUDED.test(entry.name) || entry.isSymbolicLink()) continue
        if (visited >= 1500 || bytes > 8_000_000 || matches.length >= 60) { truncated = true; break }
        const path = await this.path(relative(this.root, resolve(dir, entry.name)))
        if (entry.isDirectory()) await walk(path, depth + 1)
        else {
          visited++
          try {
            const text = await this.text(path); bytes += Buffer.byteLength(text)
            for (const [index, line] of text.split('\n').entries()) if (line.toLowerCase().includes(query.toLowerCase())) {
              matches.push({ path: relative(this.root, path), line: index + 1, text: line.slice(0, 300) })
              if (matches.length >= 60) break
            }
          } catch { /* unreadable, binary or large files are not source search results */ }
        }
      }
    }
    await walk(await this.path(folder), 0)
    return { matches, scanned_files: visited, truncated }
  }
  /** Bounded source map; excerpts do not grant an edit snapshot. No executable project configuration. */
  async map(query: unknown = '') {
    if (typeof query !== 'string' || query.length > 4000) throw new Error('Map query must be bounded text.')
    const terms = [...new Set(query.toLowerCase().match(/[a-z0-9_äöüß-]{3,}/g) ?? [])].slice(0, 40)
    const entries: Array<{ path: string; revision: string; imports: string[]; symbols: string[]; score: number }> = []
    let scanned = 0, bytes = 0, truncated = false
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 12 || scanned >= 400 || bytes >= 2_000_000) { truncated = true; return }
      for (const e of (await readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
        if (EXCLUDED.test(e.name) || e.isSymbolicLink()) continue
        if (scanned >= 400 || bytes >= 2_000_000) { truncated = true; break }
        const path = relative(this.root, resolve(dir, e.name)).replaceAll('\\', '/')
        if (e.isDirectory()) await walk(await this.path(path), depth + 1)
        else if (/\.(?:tsx?|jsx?|mjs|cjs|py|go|rs|cs|java|md|json)$/i.test(path)) {
          scanned++
          try {
            const source = await this.text(await this.path(path)); bytes += Buffer.byteLength(source)
            const imports = [...source.matchAll(/(?:from\s*|require\(\s*|import\s*)['"]([^'"]+)['"]/g)].slice(0, 10).map(m => m[1]!.slice(0, 100))
            const symbols = source.split('\n').filter(l => /^\s*(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|def|func|pub\s+fn)\s+/.test(l)).slice(0, 8).map(l => l.trim().slice(0, 150))
            const score = terms.reduce((n,t) => n + (path.toLowerCase().includes(t) ? 8 : 0) + (symbols.join(' ').toLowerCase().includes(t) ? 3 : 0) + (source.toLowerCase().includes(t) ? 1 : 0), 0)
            entries.push({ path, revision: digest(source), imports, symbols, score })
          } catch { /* inaccessible/oversized/binary source is never indexed */ }
        }
      }
    }
    await walk(this.root, 0)
    entries.sort((a,b) => b.score - a.score || a.path.localeCompare(b.path))
    const selected = entries.slice(0, 16)
    // Add reverse dependencies of the best matches inside the same bounded scan.
    const names = selected.slice(0,4).map(e => e.path.replace(/\.[^.]+$/, '').split('/').at(-1)!)
    for (const e of entries) if (selected.length < 20 && !selected.includes(e) && e.imports.some(i => names.some(n => i.endsWith('/' + n)))) selected.push(e)
    return { entries: selected, scanned, truncated: truncated || entries.length > selected.length, warning: 'Partial lexical/symbol map, not a complete dependency graph. Read current source before editing.' }
  }
  async projectContext() {
    let text = ''
    for (const name of ['AGENTS.md', 'CLAUDE.md', 'GLOSSARY.md', 'CONTEXT.md', 'README.md', 'package.json']) {
      try { const textFile = await this.text(await this.path(name)); text += `\n--- ${name} (excerpt) ---\n${textFile.slice(0, 3500)}\n` } catch { /* optional project context; excerpts never count as a complete tool read */ }
    }
    return text.slice(0, 12000)
  }
}
