/**
 * one-worker — paths of this machine never go to One. Everything the worker sends (log lines, test output,
 * Claude's text, errors) passes through a Scrubber: the worktree becomes ".", the repo "<repo>", the
 * worktree folder "<worktrees>", the home folder "~", the temp folder "<tmp>". Longest first, so a
 * worktree inside the home folder is "." and not "~/…".
 *
 * Each rule is ONE path, matched every way tools write it:
 *  - its separators "\" and "/" mixed, doubled (JSON-escaped C:\\Users\\…), percent-encoded (%5C, %2F); "\/" (JSON) on
 *    macOS / Linux
 *  - each folder name also percent-encoded in every usual way (file:///…/Max%20Muster, J%C3%BCrgen — hex digits in any
 *    case), a space also as a shell's "\ ", both Unicode normal forms; a name with letters outside ASCII also as a program
 *    writing another code page leaves it: U+FFFD for each lost byte, "?", or its UTF-8 read as Latin-1 ("JÃ¼rgen")
 *  - only as a whole name: a rule ends where a name ends (C:\w is not C:\Windows, /home/me not /home/me2)
 * Windows also (without case — NTFS ignores it): the drive as C: or C%3A (VS Code's file URIs), MSYS / Git Bash /c/…,
 * /cygdrive/c/…, /mnt/c/…, a UNC path \\server\share\…, the long form a link or junction resolves to, and the home
 * folder's 8.3 short name (C:\Users\MAXMUS~1 — learned from TEMP / TMP / LOCALAPPDATA, plus the pattern Windows makes
 * such names by). The user name alone is never replaced (a user called "test" would eat code).
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

/* ------------------------------------------------------------------ one name, every way it is written */

const hexClass = (d: string) => (/[A-Fa-f]/.test(d) ? `[${d.toUpperCase()}${d.toLowerCase()}]` : d)
/** Percent-encoded text as a source: its hex digits in either case (%c3%bc is %C3%BC). */
const pctSource = (enc: string) => escape(enc).replace(/%([0-9A-Fa-f])([0-9A-Fa-f])/g, (_m, a: string, b: string) => `%${hexClass(a)}${hexClass(b)}`)

/** Every byte but the unreserved ones percent-encoded (how VS Code and most URL writers do it). */
const pctAll = (s: string) =>
  [...Buffer.from(s, 'utf8')].map((b) => (b < 0x80 && /[A-Za-z0-9._~-]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : `%${b.toString(16).toUpperCase().padStart(2, '0')}`)).join('')

const tryEncode = (f: (s: string) => string, s: string): string | null => {
  try {
    return f(s)
  } catch {
    // a lone surrogate (a Windows file name may hold one): pctAll covers it
    return null
  }
}

/** A name as written: a space also as a shell's "\ "; a character outside ASCII also lost (U+FFFD for each byte, "?"). */
function literalSource(name: string): string {
  let out = ''
  for (const ch of name) {
    if (ch === ' ') out += '(?: |\\\\ )'
    else if (ch.codePointAt(0)! > 0x7f) out += `(?:${escape(ch)}|\\uFFFD{1,4}|\\?)`
    else out += escape(ch)
  }
  return out
}

/** One folder or file name as a regex source: every way above. */
function nameSource(name: string): string {
  const alts = new Set<string>()
  for (const form of new Set([name, name.normalize('NFC'), name.normalize('NFD')])) {
    alts.add(literalSource(form))
    for (const enc of [tryEncode(encodeURIComponent, form), tryEncode(encodeURI, form), pctAll(form)]) if (enc !== null && enc !== form) alts.add(pctSource(enc))
    const latin1 = Buffer.from(form, 'utf8').toString('latin1')
    if (latin1 !== form) alts.add(escape(latin1))
  }
  return alts.size === 1 ? [...alts][0]! : `(?:${[...alts].join('|')})`
}

/** A rule ends where a name ends: never before a letter, digit, "_" or "-", nor before a "." that goes on into a name. */
const END = '(?![\\p{L}\\p{N}_-]|\\.[\\p{L}\\p{N}_-])'

/* ------------------------------------------------------------------ macOS / Linux */

/** macOS / Linux: "/" — also JSON's "\/" and percent-encoded. */
const POSIX_ONE = '(?:\\\\?/|%2[Ff])'
const POSIX_SEP = `${POSIX_ONE}+`

/** The root's one "/" first (file:///home/… keeps its "file://"), then the names. */
function posixSource(p: string): string | null {
  const names = p.split('/').filter(Boolean)
  if (!p.startsWith('/') || !names.length) return null
  return `${POSIX_ONE}${names.map(nameSource).join(POSIX_SEP)}${END}`
}

/* ------------------------------------------------------------------ Windows */

/** Windows: one or more separators — "\" or "/", doubled (JSON), percent-encoded. */
const WIN_SEP = '(?:[\\\\/]|%5[Cc]|%2[Ff])+'

/** A Windows path without trailing separators, in backslash form (a drive root keeps its own). */
const winNorm = (p: string) => {
  const s = p.replace(/\//g, '\\')
  return /^[A-Za-z]:\\$/.test(s) ? s : s.replace(/\\+$/, '')
}

/** A Windows path's drive (null: a UNC path \\server\share\…) and names — null for anything else. */
function winParts(native: string): { drive: string | null; names: string[] } | null {
  const s = winNorm(native)
  const d = /^([A-Za-z]):\\(.*)$/.exec(s)
  if (d) return { drive: d[1]!.toLowerCase(), names: d[2]!.split('\\').filter(Boolean) }
  const unc = /^\\\\([^\\].*)$/.exec(s)
  if (unc) return { drive: null, names: unc[1]!.split('\\').filter(Boolean) }
  return null
}

/** Every way Windows writes a path, from its names as sources: C: / C%3A / MSYS /c/ … or a UNC head; any separators. */
function winSource(drive: string | null, names: string[]): string | null {
  if (!names.length) return null
  if (drive === null) return `[\\\\/]{2,4}${names.join(WIN_SEP)}${END}`
  return `(?:${drive}(?::|%3[Aa])|(?:/cygdrive|/mnt)?/${drive})${WIN_SEP}${names.join(WIN_SEP)}${END}`
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

/** The pattern Windows makes a short name by, for the home folder's own name: the first ≤ 6 letters / digits, "~" and a number. */
function shortPattern(home: string): string | null {
  const h = winNorm(home)
  const name = h.slice(h.lastIndexOf('\\') + 1)
  // a name that fits 8.3 as it is has no other short form
  if (!name || /^[A-Za-z0-9_-]{1,8}$/.test(name)) return null
  const head = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase()
  return head ? `${escape(head)}~\\d{1,6}` : null
}

/* ------------------------------------------------------------------ the scrubber */

export class Scrubber {
  private rules: Array<{ re: RegExp; to: string }> = []

  constructor(pairs: Array<[string | null | undefined, string]> = [], opts: ScrubOptions = {}) {
    const platform = opts.platform ?? process.platform
    const base: Array<[string | null | undefined, string]> = [...pairs, [opts.tmp ?? tmpdir(), '<tmp>'], [opts.home ?? homedir(), '~']]
    const list: Array<{ source: string; len: number; to: string }> = []
    const seen = new Set<string>()
    const push = (source: string | null, len: number, to: string) => {
      if (!source) return
      const key = `${source}\u0000${to}`
      if (seen.has(key)) return
      seen.add(key)
      list.push({ source, len, to })
    }
    if (platform !== 'win32') {
      const realpath = opts.realpath ?? diskPath(false)
      for (const [p, to] of base) {
        if (!p) continue
        for (const v of [p, realpath(p)]) {
          const x = v?.replace(/\/+$/, '')
          if (x && x.length >= 2) push(posixSource(x), x.length, to)
        }
      }
      list.sort((a, b) => b.len - a.len || b.source.length - a.source.length)
      this.rules = list.map(({ source, to }) => ({ re: new RegExp(source, 'gu'), to }))
      return
    }
    const realpath = opts.realpath ?? diskPath(true)
    const env = opts.env ?? process.env
    const home = winNorm(opts.home ?? homedir())
    const homeKey = home.toLowerCase()
    const homeNames = winParts(home)?.names.length ?? 0
    const shorts = shortHomes(home, env, realpath)
    const pattern = shortPattern(home)
    const from = (native: string) => {
      const parts = winParts(native)
      return parts ? { drive: parts.drive, names: parts.names.map(nameSource) } : null
    }
    for (const [p, to] of base) {
      if (!p) continue
      const longs = new Set([winNorm(p)])
      const real = realpath(p)
      if (real) longs.add(winNorm(real))
      for (const long of longs) {
        if (long.length < 3) continue
        const parts = from(long)
        if (!parts) continue
        push(winSource(parts.drive, parts.names), long.length, to)
        // inside the home folder: the same path under the home folder's short names
        const inHome = long.toLowerCase() === homeKey || long.toLowerCase().startsWith(`${homeKey}\\`)
        if (!inHome) continue
        const rest = long.slice(home.length)
        for (const s of shorts) {
          const sp = from(s + rest)
          if (sp) push(winSource(sp.drive, sp.names), long.length, to)
        }
        if (pattern && parts.drive !== null && homeNames > 0) {
          const names = [...parts.names]
          names[homeNames - 1] = pattern
          push(winSource(parts.drive, names), long.length, to)
        }
      }
    }
    // longest first; at equal length the literal before the pattern
    list.sort((a, b) => b.len - a.len || b.source.length - a.source.length)
    this.rules = list.map(({ source, to }) => ({ re: new RegExp(source, 'giu'), to }))
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
