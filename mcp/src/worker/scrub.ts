/**
 * one-worker — paths of this machine never go to One. Everything the worker sends (log lines, test output,
 * Claude's text, errors) passes through a Scrubber: the worktree becomes ".", the repo "<repo>", the
 * worktree folder "<worktrees>", the home folder "~", the temp folder "<tmp>". Longest first, so a
 * worktree inside the home folder is "." and not "~/…".
 */
import { homedir, tmpdir } from 'node:os'
import { realpathSync } from 'node:fs'

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function variants(p: string): string[] {
  const out = new Set<string>()
  const add = (x: string) => {
    if (!x || x === '/' || x.length < 2) return
    out.add(x.replace(/[\\/]+$/, ''))
    if (x.includes('\\')) out.add(x.replace(/\\/g, '/').replace(/\/+$/, ''))
  }
  add(p)
  try {
    add(realpathSync(p))
  } catch {
    /* not there (yet) */
  }
  return [...out]
}

export class Scrubber {
  private rules: Array<{ re: RegExp; to: string }> = []

  constructor(pairs: Array<[string | null | undefined, string]> = []) {
    const base: Array<[string | null | undefined, string]> = [...pairs, [tmpdir(), '<tmp>'], [homedir(), '~']]
    const list: Array<{ from: string; to: string }> = []
    for (const [p, to] of base) if (p) for (const v of variants(p)) list.push({ from: v, to })
    list.sort((a, b) => b.from.length - a.from.length)
    this.rules = list.map(({ from, to }) => ({ re: new RegExp(escape(from), 'g'), to }))
  }

  text(s: string): string {
    let out = s
    for (const r of this.rules) out = out.replace(r.re, r.to)
    return out
  }
}

/** A scrubber for one repo (and, while a task runs, its worktree). */
export function repoScrubber(repo: { path: string; worktreeDir: string }, worktree?: string | null): Scrubber {
  return new Scrubber([
    [worktree ?? null, '.'],
    [repo.worktreeDir, '<worktrees>'],
    [repo.path, '<repo>'],
  ])
}
