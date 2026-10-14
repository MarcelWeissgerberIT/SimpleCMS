/**
 * one-worker — paths of this machine never go to One. Everything the worker sends (log lines, test output,
 * Claude's text, errors) passes through a Scrubber: the worktree becomes ".", the repo "<repo>", the
 * worktree folder "<worktrees>", the home folder "~", the temp folder "<tmp>". Longest first, so a
 * worktree inside the home folder is "." and not "~/…".
 *
 * Windows writes one path many ways, and every one is replaced (without case — NTFS ignores it): C:\Users\Max Muster,
 * c:/users/max muster, MSYS / Git Bash /c/Users/… (also /cygdrive/c/…, /mnt/c/…), JSON-escaped C:\\Users\\…, percent-
 * encoded file:///C:/Users/Max%20Muster, the long form a link or junction resolves to, and the home folder's 8.3 short
 * name (C:\Users\MAXMUS~1 — learned from TEMP / TMP / LOCALAPPDATA, plus the pattern Windows makes such names by). The
 * user name alone is never replaced (a user called "test" would eat code).
 */
import { homedir, tmpdir } from 'node:os'
import { realpathSync } from 'node:fs'
import { envGet } from './exec.ts'

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export interface ScrubOptions {
  /** whose paths (default: this computer's) */
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  home?: string
  tmp?: string
  /** a path as the disk resolves it (null: not there) — tests */
  realpath?: (p: string) => string | null
}

const diskPath = (native: boolean) => (p: string): string | null => {
  try {
    return native ? realpathSync.native(p) : realpathSync(p)
  } catch {
    return null
  }
}

function variants(p: string, realpath: (p: string) => string | null): string[] {
  const out = new Set<string>()
  const add = (x: string) => {
    if (!x || x === '/' || x.length < 2) return
    out.add(x.replace(/[\\/]+$/, ''))
    if (x.includes('\\')) out.add(x.replace(/\\/g, '/').replace(/\/+$/, ''))
  }
  add(p)
  const real = realpath(p)
  if (real) add(real)
  return [...out]
}

/* ------------------------------------------------------------------ Windows */

/** A Windows path without trailing separators, in backslash form (a drive root keeps its own). */
const winNorm = (p: string) => {
  const s = p.replace(/\//g, '\\')
  return /^[A-Za-z]:\\$/.test(s) ? s : s.replace(/\\+$/, '')
}

/**
 * Every way a Windows path is written, as regex sources: `pathSource` is the backslash form as a regex source (a
 * literal, or with the 8.3 pattern inside), `literal` the path itself — null for a pattern (no percent form then).
 */
function winForms(pathSource: string, literal: string | null): string[] {
  // pathSource: the backslash form as a regex source with \\ for each separator — the forms swap the separators
  const sep = '\\\\'
  const out = new Set<string>()
  out.add(pathSource)
  const fwd = pathSource.split(sep).join('/')
  out.add(fwd)
  // JSON-escaped: every backslash doubled
  out.add(pathSource.split(sep).join(`${sep}${sep}`))
  const drive = /^([A-Za-z]):/.exec(pathSource)?.[1]?.toLowerCase()
  if (drive) {
    const rest = fwd.slice(2)
    for (const pre of [`/${drive}`, `/cygdrive/${drive}`, `/mnt/${drive}`]) out.add(`${escape(pre)}${rest}`)
  }
  // percent-encoded (a file:// URL): only where it differs — spaces, non-ASCII
  if (literal !== null) {
    const plain = literal.replace(/\\/g, '/')
    const enc = encodeURI(plain)
    if (enc !== plain) out.add(escape(enc))
  }
  return [...out]
}

/**
 * The home folder's 8.3 short form as this computer writes it: TEMP / TMP / LOCALAPPDATA usually lie in the home folder
 * and may be written short (C:\Users\MAXMUS~1\AppData\Local\Temp) while the disk resolves them long — the part that
 * maps onto the home folder is its short form.
 */
function shortHomes(home: string, env: NodeJS.ProcessEnv, realpath: (p: string) => string | null): string[] {
  const out = new Set<string>()
  const h = winNorm(home).toLowerCase()
  for (const key of ['TEMP', 'TMP', 'LOCALAPPDATA']) {
    const raw = envGet(env, key, 'win32')?.trim()
    if (!raw || !raw.includes('~')) continue
    const short = winNorm(raw)
    const long = realpath(short)
    if (!long) continue
    const l = winNorm(long)
    if (!l.toLowerCase().startsWith(`${h}\\`) && l.toLowerCase() !== h) continue
    const tail = l.slice(h.length)
    if (!short.toLowerCase().endsWith(tail.toLowerCase())) continue
    const s = short.slice(0, short.length - tail.length)
    if (s.length >= 3 && s.toLowerCase() !== h) out.add(s)
  }
  return [...out]
}

/** The pattern Windows makes a short name by: the first ≤ 6 letters / digits, upper case, "~" and a number. */
function shortPattern(home: string): string | null {
  const h = winNorm(home)
  const cut = h.lastIndexOf('\\')
  if (cut < 2) return null
  const name = h.slice(cut + 1)
  // a name that fits 8.3 as it is has no other short form
  if (/^[A-Za-z0-9_-]{1,8}$/.test(name)) return null
  const head = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase()
  if (!head) return null
  return `${escape(h.slice(0, cut))}\\\\${escape(head)}~\\d{1,6}`
}

/* ------------------------------------------------------------------ the scrubber */

export class Scrubber {
  private rules: Array<{ re: RegExp; to: string }> = []

  constructor(pairs: Array<[string | null | undefined, string]> = [], opts: ScrubOptions = {}) {
    const platform = opts.platform ?? process.platform
    const base: Array<[string | null | undefined, string]> = [...pairs, [opts.tmp ?? tmpdir(), '<tmp>'], [opts.home ?? homedir(), '~']]
    const list: Array<{ source: string; len: number; to: string }> = []
    if (platform !== 'win32') {
      const realpath = opts.realpath ?? diskPath(false)
      for (const [p, to] of base) if (p) for (const v of variants(p, realpath)) list.push({ source: escape(v), len: v.length, to })
      list.sort((a, b) => b.len - a.len)
      this.rules = list.map(({ source, to }) => ({ re: new RegExp(source, 'g'), to }))
      return
    }
    const realpath = opts.realpath ?? diskPath(true)
    const env = opts.env ?? process.env
    const home = winNorm(opts.home ?? homedir())
    const homeKey = home.toLowerCase()
    const shorts = shortHomes(home, env, realpath)
    const pattern = shortPattern(home)
    const seen = new Set<string>()
    const push = (source: string, len: number, to: string) => {
      const key = `${source.toLowerCase()}\u0000${to}`
      if (seen.has(key)) return
      seen.add(key)
      list.push({ source, len, to })
    }
    for (const [p, to] of base) {
      if (!p) continue
      const longs = new Set([winNorm(p)])
      const real = realpath(p)
      if (real) longs.add(winNorm(real))
      for (const long of longs) {
        if (long.length < 3) continue
        for (const f of winForms(escape(long), long)) push(f, long.length, to)
        // inside the home folder: the same path under the home folder's short names
        const inHome = long.toLowerCase() === homeKey || long.toLowerCase().startsWith(`${homeKey}\\`)
        if (!inHome) continue
        const rest = long.slice(home.length)
        for (const s of shorts) for (const f of winForms(escape(s + rest), s + rest)) push(f, long.length, to)
        if (pattern) for (const f of winForms(`${pattern}${escape(rest)}`, null)) push(f, long.length, to)
      }
    }
    // longest first; at equal length the literal before the pattern
    list.sort((a, b) => b.len - a.len || b.source.length - a.source.length)
    this.rules = list.map(({ source, to }) => ({ re: new RegExp(source, 'gi'), to }))
  }

  text(s: string): string {
    let out = s
    for (const r of this.rules) out = out.replace(r.re, r.to)
    return out
  }
}

/** A scrubber for one repo (and, while a task runs, its worktree). */
export function repoScrubber(repo: { path: string; worktreeDir: string }, worktree?: string | null, opts: ScrubOptions = {}): Scrubber {
  return new Scrubber(
    [
      [worktree ?? null, '.'],
      [repo.worktreeDir, '<worktrees>'],
      [repo.path, '<repo>'],
    ],
    opts,
  )
}
