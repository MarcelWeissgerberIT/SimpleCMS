/**
 * one-worker — the terminal fallback of the setup page (--no-browser, or no browser to open): the found
 * repos as a numbered checklist. Numbers tick / untick, "a" all, "n" none, Enter saves, "q" (or the end of
 * the input) leaves without saving. Each ticked repo gets the page's defaults: the detected base branch, the
 * guessed test command, push when it has a remote, pull requests via gh.
 */
import { createInterface } from 'node:readline'
import type { FoundRepo } from './scan.ts'

const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length))

export function checklistText(repos: FoundRepo[], ticked: Set<string>): string {
  if (!repos.length) return '  (no git repositories found)\n'
  const w = Math.min(28, Math.max(...repos.map((r) => r.name.length)))
  const pw = Math.min(40, Math.max(...repos.map((r) => r.short.length)))
  return repos
    .map((r, i) => {
      const facts = [r.base, r.host ?? 'no remote', r.dirty === null ? null : r.dirty ? `${r.dirty} changed` : 'clean', r.test ? r.test.join(' ') : 'no tests'].filter(Boolean).join(' · ')
      return `${String(i + 1).padStart(3)} [${ticked.has(r.path) ? 'x' : ' '}] ${pad(r.name, w)}  ${pad(r.short, pw)}  ${facts}`
    })
    .join('\n')
    .concat('\n')
}

export interface ChecklistOptions {
  input: NodeJS.ReadableStream
  output: NodeJS.WritableStream
  /** the workspace's name */
  title: string
  repos: FoundRepo[]
  /** paths ticked at the start (the repos already in worker.json) */
  ticked: Set<string>
}

/** Run the checklist; resolves with the ticked paths (Enter) or null (q / end of input). */
export function terminalChecklist(opts: ChecklistOptions): Promise<Set<string> | null> {
  const { output, repos } = opts
  const ticked = new Set(opts.ticked)
  const write = (s: string) => void output.write(s)
  const prompt = 'Numbers tick or untick (e.g. 1 3) · a = all · n = none · Enter = save · q = skip\n> '
  write(`\n§ ONE WORKER — ${opts.title}\nPick the repositories One may hand coding tasks to. Paths stay on this computer.\n\n`)
  write(checklistText(repos, ticked))
  write(`\n${prompt}`)
  return new Promise((resolve) => {
    const rl = createInterface({ input: opts.input, terminal: false })
    let settled = false
    const end = (v: Set<string> | null) => {
      if (settled) return
      settled = true
      rl.close()
      resolve(v)
    }
    rl.on('line', (raw) => {
      const line = raw.trim().toLowerCase()
      if (!line) return end(ticked)
      if (line === 'q' || line === 'quit') return end(null)
      if (line === 'a' || line === 'all') repos.forEach((r) => ticked.add(r.path))
      else if (line === 'n' || line === 'none') ticked.clear()
      else {
        const nums = line.split(/[\s,]+/).filter(Boolean)
        const bad = nums.filter((n) => !/^\d+$/.test(n) || Number(n) < 1 || Number(n) > repos.length)
        if (bad.length) {
          write(`Not on the list: ${bad.join(', ')}\n> `)
          return
        }
        for (const n of nums) {
          const r = repos[Number(n) - 1]!
          if (ticked.has(r.path)) ticked.delete(r.path)
          else ticked.add(r.path)
        }
      }
      write(`\n${checklistText(repos, ticked)}\n${prompt}`)
    })
    rl.on('close', () => end(null))
  })
}
