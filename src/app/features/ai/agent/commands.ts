/**
 * AI terminal — the prompt's /commands (EN names + DE aliases, both always work) and Tab
 * completion of /commands and @page / @database mentions (title search).
 */
import { useWorkspace } from '../../../store/store'
import { inTemplate, isEffectivelyTrashed, selectBreadcrumbs } from '../../../store/selectors'
import type { Page } from '../../../store/types'
import type { TermMention } from './types'

export type CommandId = 'new' | 'stop' | 'apply' | 'discard' | 'history' | 'help' | 'mcp' | 'cost'

/** Names per command: English first, then the German aliases. */
export const COMMANDS: Array<{ id: CommandId; en: string; de: string[] }> = [
  { id: 'new', en: 'new', de: ['neu'] },
  { id: 'stop', en: 'stop', de: ['stopp'] },
  { id: 'apply', en: 'apply', de: ['übernehmen', 'uebernehmen'] },
  { id: 'discard', en: 'discard', de: ['verwerfen'] },
  { id: 'history', en: 'history', de: ['verlauf'] },
  { id: 'help', en: 'help', de: ['hilfe'] },
  { id: 'mcp', en: 'mcp', de: [] },
  { id: 'cost', en: 'cost', de: ['kosten'] },
]

/** The name shown for a command in the UI language. */
export const commandName = (id: CommandId, lang: 'en' | 'de') => {
  const c = COMMANDS.find((x) => x.id === id)!
  return `/${lang === 'de' && c.de[0] ? c.de[0] : c.en}`
}

/** A prompt that is a command ("/help", "/hilfe "): its id, 'unknown' for another "/word", null for a task. */
export function parseCommand(input: string): CommandId | 'unknown' | null {
  const m = /^\/([\p{L}\d_-]+)\s*$/u.exec(input.trim())
  if (!m) return null
  const word = m[1].toLowerCase()
  return COMMANDS.find((c) => c.en === word || c.de.includes(word))?.id ?? 'unknown'
}

export interface CompletionItem {
  key: string
  /** what replaces the token */
  insert: string
  label: string
  /** command id (its description) or the mention */
  command?: CommandId
  mention?: TermMention & { where: string }
}

export interface Completion {
  kind: 'command' | 'mention'
  /** the token's range in the draft */
  from: number
  to: number
  query: string
  items: CompletionItem[]
}

const MENTION_MAX = 6

function mentionCandidates(query: string): CompletionItem[] {
  const { pages } = useWorkspace.getState()
  const q = query.trim().toLowerCase()
  const scored: Array<{ p: Page; score: number }> = []
  for (const p of Object.values(pages)) {
    // pages and databases (rows belong to their database), live, not inside a template
    if (p.databaseId || p.trashed || p.hidden) continue
    const title = p.title.trim()
    if (!title) continue
    const lower = title.toLowerCase()
    let score: number
    if (!q) score = 3
    else if (lower.startsWith(q)) score = 0
    else if (lower.includes(` ${q}`)) score = 1
    else if (lower.includes(q)) score = 2
    else continue
    if (isEffectivelyTrashed(pages, p.id) || inTemplate(pages, p.id)) continue
    scored.push({ p, score })
  }
  scored.sort((a, b) => a.score - b.score || b.p.updatedAt - a.p.updatedAt)
  return scored.slice(0, MENTION_MAX).map(({ p }) => {
    const title = p.title.trim()
    const where = selectBreadcrumbs(pages, p.id)
      .slice(0, -1)
      .map((x) => x.title.trim())
      .filter(Boolean)
      .join(' / ')
    return { key: p.id, insert: `@${title} `, label: title, mention: { id: p.id, title, kind: p.kind === 'database' ? 'database' : 'page', where } }
  })
}

/** What Tab would complete at the caret (null = nothing to complete). */
export function completionAt(draft: string, caret: number, lang: 'en' | 'de'): Completion | null {
  const before = draft.slice(0, caret)
  // a command: "/wor" at the very start of the prompt
  const cmd = /^\s*\/([\p{L}\d_-]*)$/u.exec(before)
  if (cmd) {
    const word = cmd[1].toLowerCase()
    const from = before.length - cmd[1].length - 1
    const items: CompletionItem[] = []
    for (const c of COMMANDS) {
      const names = lang === 'de' ? [...c.de, c.en] : [c.en, ...c.de]
      const hit = names.find((n) => n.startsWith(word))
      if (hit) items.push({ key: c.id, insert: `/${hit}`, label: `/${hit}`, command: c.id })
    }
    return items.length ? { kind: 'command', from, to: caret, query: word, items } : null
  }
  // a mention: "@" at a word start, up to 40 characters, no line break
  const at = /(^|\s)@([^\n@]{0,40})$/.exec(before)
  if (at) {
    const query = at[2]
    const items = mentionCandidates(query)
    if (!items.length) return null
    return { kind: 'mention', from: before.length - query.length - 1, to: caret, query, items }
  }
  return null
}
