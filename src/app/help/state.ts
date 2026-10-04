/**
 * Help panel state (this tab only, never persisted): open or not, and a small browser-like history of
 * places — the manual's index, a chapter, an article, the keyboard sheet or "Ask the help".
 */
import { create } from 'zustand'

export type HelpLoc =
  | { kind: 'home' }
  | { kind: 'section'; id: string }
  | { kind: 'article'; id: string }
  | { kind: 'keys' }
  | { kind: 'ask' }

export type HelpTab = 'manual' | 'ask' | 'keys'

export interface HelpState {
  open: boolean
  stack: HelpLoc[]
  index: number
  /** the search field of the manual */
  query: string
  /** the "Ask the help" draft; `askRun` bumps when a question should be sent right away */
  question: string
  askRun: number
}

const HOME: HelpLoc = { kind: 'home' }

export const useHelp = create<HelpState>()(() => ({ open: false, stack: [HOME], index: 0, query: '', question: '', askRun: 0 }))

const same = (a: HelpLoc, b: HelpLoc) => a.kind === b.kind && ('id' in a ? a.id : '') === ('id' in b ? b.id : '')

/** Go somewhere in the panel (forward history is cut, like a browser). */
export function goHelp(loc: HelpLoc): void {
  useHelp.setState((s) => {
    const cur = s.stack[s.index]
    if (cur && same(cur, loc)) return { open: true }
    const stack = [...s.stack.slice(0, s.index + 1), loc].slice(-50)
    return { open: true, stack, index: stack.length - 1 }
  })
}

export type HelpTarget = string | HelpLoc | { tab: HelpTab; question?: string; run?: boolean }

/**
 * Open the Help panel: without a target where it was left, with an article id on that article,
 * `{ tab: 'keys' }` on the keyboard sheet, `{ tab: 'ask', question, run }` on "Ask the help".
 */
export function openHelp(target?: HelpTarget): void {
  if (target === undefined) return useHelp.setState({ open: true })
  if (typeof target === 'string') return goHelp({ kind: 'article', id: target })
  if ('kind' in target) return goHelp(target)
  if (target.tab === 'ask') {
    if (target.question !== undefined) useHelp.setState((s) => ({ question: target.question!, askRun: target.run ? s.askRun + 1 : s.askRun }))
    return goHelp({ kind: 'ask' })
  }
  goHelp(target.tab === 'keys' ? { kind: 'keys' } : HOME)
}

export function closeHelp(): void {
  useHelp.setState({ open: false })
}

export function toggleHelp(): void {
  if (useHelp.getState().open) closeHelp()
  else openHelp()
}

export function helpBack(): void {
  useHelp.setState((s) => (s.index > 0 ? { index: s.index - 1 } : s))
}

export function helpForward(): void {
  useHelp.setState((s) => (s.index < s.stack.length - 1 ? { index: s.index + 1 } : s))
}

export const currentLoc = (s: HelpState): HelpLoc => s.stack[s.index] ?? HOME

export const tabOf = (loc: HelpLoc): HelpTab => (loc.kind === 'keys' ? 'keys' : loc.kind === 'ask' ? 'ask' : 'manual')
