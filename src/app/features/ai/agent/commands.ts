/**
 * AI terminal — the prompt's /commands (EN and DE names, all of them always work) and Tab
 * completion of /commands, @page / @database mentions (title search), "one:" (pages and entries on the level of
 * the open page first, then a title search — any page or entry) and "<codeword>:" at the start (the tools of that
 * MCP server, from its connection test).
 */
import { useWorkspace } from '../../../store/store'
import { inTemplate, isEffectivelyTrashed, selectBreadcrumbs } from '../../../store/selectors'
import type { ID, Page } from '../../../store/types'
import { t } from '../../../i18n'
import { readServers } from '../mcp-servers/config'
import type { TermMention } from './types'
import { examples } from '../memory/example'
import { memoryInUse } from '../memory/settings'

export type CommandId = 'new' | 'stop' | 'continue' | 'apply' | 'discard' | 'history' | 'clearhistory' | 'help' | 'mcp' | 'pipelines' | 'connect' | 'cost' | 'context' | 'redo' | 'remember' | 'nomemory' | 'example'

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
  // a task that stopped at the tool-call limit goes on with a fresh budget (session.ts continueTask)
  { id: 'continue', en: ['continue'], de: ['weiter'] },
  { id: 'apply', en: ['apply'], de: ['übernehmen', 'uebernehmen'] },
  { id: 'discard', en: ['discard'], de: ['verwerfen'] },
  { id: 'history', en: ['history'], de: ['verlauf'] },
  // asks y / n first (session.ts): this device's prompt history of the workspace goes
  { id: 'clearhistory', en: ['clear-history'], de: ['verlauf-leeren'] },
  { id: 'help', en: ['help'], de: ['hilfe'] },
  { id: 'mcp', en: ['mcp'], de: [] },
  // the coding pipelines: open tasks, what they wait for (session.ts; also with a kind: /pipelines qa)
  { id: 'pipelines', en: ['pipelines'], de: [] },
  // an MCP server: list, sign in (the window opens from the key press), test, or add one by its address (connect.ts)
  { id: 'connect', en: ['connect'], de: ['verbinden'] },
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
const WITH_TEXT: CommandId[] = ['remember', 'nomemory', 'example', 'pipelines', 'connect']

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
  /** a tool of an MCP server ("kb: search_records") */
  tool?: { server: string; name: string }
  /** an MCP server after /connect */
  server?: { id: string; name: string; host: string; codeword?: string }
}

export interface Completion {
  kind: 'command' | 'mention' | 'tag' | 'tool' | 'server'
  /** the token's range in the draft */
  from: number
  to: number
  query: string
  items: CompletionItem[]
}

const MENTION_MAX = 6

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

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

const REF_MAX = 8

/** "one:" — pages and entries next to `here` (same parent or database) and inside it first, then by title. */
function refCandidates(query: string, here: ID | null): CompletionItem[] {
  const { pages } = useWorkspace.getState()
  const q = query.trim().toLowerCase()
  const at = here ? pages[here] : undefined
  const scored: Array<{ p: Page; score: number; where: string }> = []
  for (const p of Object.values(pages)) {
    if (p.id === here || p.trashed || p.hidden) continue
    const title = p.title.trim()
    if (!title) continue
    const lower = title.toLowerCase()
    const level = !!at && p.parentId === at.parentId ? 0 : !!at && p.parentId === at.id ? 1 : 2
    let match: number
    if (!q) match = level < 2 ? 0 : -1
    else if (lower.startsWith(q)) match = 0
    else if (lower.includes(` ${q}`)) match = 1
    else if (lower.includes(q)) match = 2
    else match = -1
    if (match < 0) continue
    if (isEffectivelyTrashed(pages, p.id) || inTemplate(pages, p.id)) continue
    const where =
      level === 0
        ? t('features.agent.complete.sameLevel')
        : level === 1
          ? t('features.agent.complete.inside')
          : selectBreadcrumbs(pages, p.id)
              .slice(0, -1)
              .map((x) => x.title.trim())
              .filter(Boolean)
              .join(' / ')
    scored.push({ p, score: level * 3 + match, where })
  }
  scored.sort((a, b) => a.score - b.score || b.p.updatedAt - a.p.updatedAt)
  return scored.slice(0, REF_MAX).map(({ p, where }) => {
    const title = p.title.trim()
    return { key: p.id, insert: `@${title} `, label: title, mention: { id: p.id, title, kind: p.kind === 'database' ? 'database' : 'page', where } }
  })
}

/** "<codeword>:" at the start — the tools of that server (from its connection test), by name. */
function toolCandidates(word: string, query: string): CompletionItem[] | null {
  const server = readServers().find((s) => s.codeword === word.toLowerCase())
  if (!server) return null
  const q = query.toLowerCase()
  return (server.tools ?? [])
    .filter((name) => !q || name.toLowerCase().includes(q))
    .sort((a, b) => Number(!a.toLowerCase().startsWith(q)) - Number(!b.toLowerCase().startsWith(q)))
    .slice(0, REF_MAX)
    .map((name) => ({ key: `${server.id}:${name}`, insert: `${server.codeword}: ${name} `, label: name, tool: { server: server.name, name } }))
}

/** What Tab would complete at the caret (null = nothing to complete). `here`: the page open in One (for "one:"). */
export function completionAt(draft: string, caret: number, lang: 'en' | 'de', here: ID | null = null): Completion | null {
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
  // "/connect <server>": the servers by name or codeword
  const cn = /^\s*\/(connect|verbinden)\s+([^\s]{0,60})$/iu.exec(before)
  if (cn) {
    const query = cn[2].toLowerCase().replace(/:$/, '')
    const items = readServers()
      .filter((s) => !query || s.name.includes(query) || (!!s.codeword && s.codeword.startsWith(query)))
      .slice(0, MENTION_MAX)
      .map((s) => ({ key: s.id, insert: `/${cn[1]} ${s.name}`, label: s.name, server: { id: s.id, name: s.name, host: hostOf(s.url), ...(s.codeword ? { codeword: s.codeword } : {}) } }))
    return items.length ? { kind: 'server', from: 0, to: caret, query, items } : null
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
  // "one:" at a word start: a page or entry, next to the open page first
  const one = /(^|\s)one:([^\n]{0,40})$/i.exec(before)
  if (one) {
    const query = one[2]
    if (/\s$/.test(query) && query.trim()) return null
    const items = refCandidates(query, here)
    return items.length ? { kind: 'mention', from: before.length - query.length - 4, to: caret, query, items } : null
  }
  // "<codeword>:" at the start of the prompt: that server's tools
  const cw = /^(\s*)([a-z0-9_-]{1,24}):([\w.-]{0,40})$/i.exec(before)
  if (cw && cw[2].toLowerCase() !== 'one') {
    const items = toolCandidates(cw[2], cw[3])
    if (items?.length) return { kind: 'tool', from: cw[1].length, to: caret, query: cw[3], items }
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
