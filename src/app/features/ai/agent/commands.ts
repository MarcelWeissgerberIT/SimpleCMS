/**
 * AI terminal — the prompt's /commands (EN and DE names, all of them always work) and Tab
 * completion of /commands and @page / @database mentions (title search).
 */
import { useWorkspace } from '../../../store/store'
import { inTemplate, isEffectivelyTrashed, selectBreadcrumbs } from '../../../store/selectors'
import type { Page } from '../../../store/types'
import type { TermMention } from './types'
import { examples } from '../memory/example'
import { memoryInUse } from '../memory/settings'

export type CommandId = 'new' | 'stop' | 'apply' | 'discard' | 'history' | 'clearhistory' | 'help' | 'mcp' | 'cost' | 'context' | 'redo' | 'remember' | 'nomemory' | 'example'

export interface Command {
  id: CommandId
  /** English names, the main one first */
  en: string[]
  /** German names, the main one first (spellings without umlauts work too, /help leaves them out) */
  de: string[]
}

/** The commands with their names (/help lists them in this order). */
export const COMMANDS: Command[] = [
  { id: 'new', en: ['new', 'clear'], de: ['neu', 'leeren'] },
  { id: 'stop', en: ['stop'], de: ['stopp'] },
  { id: 'apply', en: ['apply'], de: ['übernehmen', 'uebernehmen'] },
  { id: 'discard', en: ['discard'], de: ['verwerfen'] },
  { id: 'history', en: ['history'], de: ['verlauf'] },
  // asks y / n first (session.ts): this device's prompt history of the workspace goes
  { id: 'clearhistory', en: ['clear-history'], de: ['verlauf-leeren'] },
  { id: 'help', en: ['help'], de: ['hilfe'] },
  { id: 'mcp', en: ['mcp'], de: [] },
  { id: 'cost', en: ['cost'], de: ['kosten'] },
  { id: 'context', en: ['context'], de: ['kontext'] },
  { id: 'redo', en: ['redo'], de: ['neu-machen'] },
  // One memory (features/ai/memory): these two also take text after the name
  { id: 'remember', en: ['remember'], de: ['merken'] },
  { id: 'nomemory', en: ['no-memory'], de: ['ohne-gedächtnis', 'ohne-gedaechtnis'] },
  { id: 'example', en: ['example'], de: ['beispiel'] },
]

/** Every name of a command, those of the UI language first. */
export const namesOf = (c: Command, lang: 'en' | 'de'): string[] => (lang === 'de' ? [...c.de, ...c.en] : [...c.en, ...c.de])

/** "uebernehmen" spells "übernehmen" without umlauts: it works, but lists don't show it. */
const plain = (s: string) => s.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
const shown = (names: string[]) => names.filter((n) => !names.some((m) => m !== n && plain(m) === n))

/** The names /help lists: all of the UI language, then the other language's main name. */
export function helpNames(c: Command, lang: 'en' | 'de'): string[] {
  const [own, other] = lang === 'de' ? [c.de, c.en] : [c.en, c.de]
  return [...new Set([...shown(own), ...other.slice(0, 1)])]
}

const byName = (word: string) => COMMANDS.find((c) => c.en.includes(word) || c.de.includes(word))

/** Commands that take text after their name ("/remember Reports go out on Fridays"). */
const WITH_TEXT: CommandId[] = ['remember', 'nomemory', 'example']

/** A command with text after its name ("/merken Berichte auf Deutsch"): its id and the text; null for anything else. */
export function parseCommandText(input: string): { id: CommandId; text: string } | null {
  const m = /^\/([\p{L}\d_-]+)\s+([\s\S]+)$/u.exec(input.trim())
  if (!m) return null
  const cmd = byName(m[1].toLowerCase())
  return cmd && WITH_TEXT.includes(cmd.id) ? { id: cmd.id, text: m[2].trim() } : null
}

/** A prompt that is a command ("/help", "/hilfe "): its id, 'unknown' for another "/word", null for a task. */
export function parseCommand(input: string): CommandId | 'unknown' | null {
  const m = /^\/([\p{L}\d_-]+)\s*$/u.exec(input.trim())
  if (!m) return null
  return byName(m[1].toLowerCase())?.id ?? 'unknown'
}

export interface CompletionItem {
  key: string
  /** what replaces the token */
  insert: string
  label: string
  /** command id (its description) or the mention */
  command?: CommandId
  mention?: TermMention & { where: string }
  /** an example of the One memory: "#wochenbericht" → its name */
  example?: { tag: string; text: string }
}

export interface Completion {
  kind: 'command' | 'mention' | 'tag'
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
    const items: Array<CompletionItem & { primary: boolean }> = []
    for (const c of COMMANDS) {
      const names = namesOf(c, lang)
      // a name typed out exactly wins over a longer one ("/clear": new, not /clear-history)
      const hit = names.find((n) => n === word) ?? names.find((n) => n.startsWith(word))
      if (hit) items.push({ key: c.id, insert: `/${hit}`, label: `/${hit}`, command: c.id, primary: (lang === 'de' ? c.de : c.en).includes(hit) })
    }
    // names of the UI language first ("/hi" in German: /hilfe before /history)
    items.sort((a, b) => Number(b.primary) - Number(a.primary))
    return items.length ? { kind: 'command', from, to: caret, query: word, items: items.map(({ primary: _p, ...x }) => x) } : null
  }
  // an example of the One memory: "#" at a word start
  const hash = /(^|\s)#([a-z0-9-]{0,32})$/i.exec(before)
  if (hash && memoryInUse()) {
    const query = hash[2].toLowerCase()
    const items = examples()
      .filter((m) => m.tag.startsWith(query))
      .slice(0, MENTION_MAX)
      .map((m) => ({ key: m.id, insert: `#${m.tag} `, label: `#${m.tag}`, example: { tag: m.tag, text: m.text } }))
    if (items.length) return { kind: 'tag', from: before.length - query.length - 1, to: caret, query, items }
  }
  // a mention: "@" at a word start, up to 40 characters, no line break
  const at = /(^|\s)@([^\n@]{0,40})$/.exec(before)
  if (at) {
    const query = at[2]
    // a space after a completed mention ends it
    if (/\s$/.test(query)) return null
    const items = mentionCandidates(query)
    if (!items.length) return null
    return { kind: 'mention', from: before.length - query.length - 1, to: caret, query, items }
  }
  return null
}
