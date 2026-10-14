/**
 * Custom agents — the editor's save checks as a pure core, key-based (the Patchbay's patches run the very same checks
 * before they plan a write, plan §1.13 / §2.9). No workspace store, no i18n, no CSS — dependency-free like
 * patchbay/hint.ts: import THIS file directly (the Patchbay's patch.ts, Node specs); it is not in agents/index.ts, so it
 * stays off the boot path.
 *  - agentSaveIssues(draft, facts) → the problems by field, each a list of message refs ({ key, vars }) — never text
 *  - savePagesOf(pages, draft) → the page facts of the pages a draft names, from a page map (the editor's way in)
 *  - agentSaveText(t, issue) / agentSaveTexts(t, issues): the words, in the UI's language (`t` passed in)
 * What it looks at besides the draft are facts (AgentSaveFacts): per page it names only whether it is in the trash, the
 * page in the trash above it, its title — the Patchbay's ModelInput.pages (PageFacts) carries the same.
 */
import type { Translate } from '@/shared/i18n'
import { AGENT_LIMITS, isTimeZone } from '../../store/agents'
import type { CustomAgent, ID, Page } from '../../store/types'
import { fmtAmount, fmtUsd, parseAmount } from '../../lib/money'
import { trashedRoot } from './gone'

export type AgentSaveField = 'name' | 'instructions' | 'trigger' | 'scope' | 'output' | 'budget' | 'runner' | 'mcp'

/**
 * One sentence about a field: a message key and its values (a MsgRef). `titles`: the page titles its `{list}` names —
 * rendered only by agentSaveText (quoted and joined in the UI's language); an issue without `titles` reads with a plain
 * t(key, vars).
 */
export interface AgentSaveIssue {
  key: string
  vars?: Record<string, string | number>
  titles?: string[]
}

/** The problems of a draft by field (a field without one is absent), each one or more sentences in order. */
export type AgentSaveIssues = Partial<Record<AgentSaveField, AgentSaveIssue[]>>

/** The same in words (the editor's error lines). */
export type AgentSaveErrors = Partial<Record<AgentSaveField, string>>

/** What the checks know of one page the draft names. A page absent from AgentSaveFacts.pages is not on this device. */
export interface SavePage {
  title: string
  /** in the trash itself */
  trashed: boolean
  /** in the trash or below a page there (when `root` is not known) */
  gone?: boolean
  /** the page in the trash above it, when it is only below one (restoring that brings it back) */
  root?: { id: ID; title: string } | null
}

export interface AgentSaveFacts {
  /** the pages the draft names (scope, its trigger's database, its report page) that are on this device */
  pages: Record<ID, SavePage>
  /** the word for a page without a title, in the UI's language ('' → the title stays empty) */
  untitled?: string
  /** a page missing here is deleted for good — false where a teammate's private pages are not here (seesAllPagesOf) */
  seesAll?: boolean
  /** the titles the editor saw while it was open: a page deleted for good meanwhile is named by them */
  titles?: Record<ID, string>
  /** the team server runs agents (its runtime is enabled and available) */
  serverOk: boolean
  /** a team workspace */
  inCloud: boolean
  /** the budget field's text in the UI's language (parseAmount) — a text that is no number is refused */
  budget?: { text: string }
  /** the UI's language: amounts in the messages */
  lang: string
  /** placeholders of a recipe still open in the instructions (the editor counts them: mirror.ts placeholdersIn) */
  placeholders?: number
}

const lng = (lang: string) => (lang === 'de' ? 'de' : 'en')

/**
 * The draft's problems by field. Nothing is saved against a page in the trash (or below one) or one deleted for good: a
 * trashed page or database in its scope, its trigger's database or its report page is named — the person takes it out
 * or restores it; one that is only below a page in the trash names that page (the trash lists only it); a scope entry
 * that does not exist any more (deleted for good) is named by the title it had while the editor was open (`titles`).
 */
export function agentSaveIssues(d: CustomAgent, facts: AgentSaveFacts): AgentSaveIssues {
  const e: AgentSaveIssues = {}
  const set = (field: AgentSaveField, key: string, vars?: AgentSaveIssue['vars']) => (e[field] = [vars ? { key, vars } : { key }])
  const untitled = facts.untitled ?? ''
  const fact = (id: ID): SavePage | undefined => (Object.prototype.hasOwnProperty.call(facts.pages, id) ? facts.pages[id] : undefined)
  const title = (id: ID) => fact(id)?.title.trim() || untitled
  // the page in the trash above `id` when it is only below one (null: in the trash itself, or not at all)
  const parentBin = (id: ID) => {
    const p = fact(id)
    return p && !p.trashed && p.root && p.root.id !== id ? p.root.title.trim() || untitled : null
  }
  const binned = (id: ID) => {
    const p = fact(id)
    return !!p && (p.trashed || !!p.gone || !!p.root)
  }
  if (!d.name.trim()) set('name', 'features.agents.err.name')
  if (!d.instructions.trim()) set('instructions', 'features.agents.err.instructions')
  else if (d.instructions.length > AGENT_LIMITS.instructions) set('instructions', 'features.agents.err.tooLong', { max: AGENT_LIMITS.instructions })
  else if (d.enabled && (facts.placeholders ?? 0) > 0) set('instructions', 'features.agents.mirror.err.placeholders', { count: facts.placeholders ?? 0 })
  const tr = d.trigger
  if (tr.type === 'row_created' || tr.type === 'row_changed') {
    const parent = tr.databaseId ? parentBin(tr.databaseId) : null
    if (tr.databaseId && parent) set('trigger', 'features.agents.err.databaseBelow', { title: title(tr.databaseId), parent })
    else if (tr.databaseId && binned(tr.databaseId)) set('trigger', 'features.agents.err.databaseTrashed', { title: title(tr.databaseId) })
    else if (!(tr.databaseId && fact(tr.databaseId))) set('trigger', 'features.agents.err.database')
  }
  if (tr.type === 'schedule' && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(tr.at) || !isTimeZone(tr.tz))) set('trigger', 'features.agents.err.time')
  if (tr.type === 'webhook' && d.runner !== 'server') set('trigger', 'features.agents.err.webhook')
  if (!d.scope.everything && !d.scope.pages.length && !d.scope.databases.length) set('scope', 'features.agents.err.scope')
  else if (!d.scope.everything) {
    const out = scopeIssues(d, facts, title)
    if (out.length) e.scope = out
  }
  const out = d.output?.pageId ?? null
  const outParent = out ? parentBin(out) : null
  if (out && !fact(out)) set('output', 'features.agents.err.output')
  else if (out && outParent) set('output', 'features.agents.err.outputBelow', { title: title(out), parent: outParent })
  else if (out && binned(out)) set('output', 'features.agents.err.outputTrashed', { title: title(out) })
  const lang = lng(facts.lang)
  if (facts.budget && parseAmount(facts.budget.text, lang) === null) set('budget', 'features.agents.err.budgetNumber', { example: fmtAmount(1.5, lang) })
  else if (!(d.maxRunUsd >= AGENT_LIMITS.minRunUsd && d.maxRunUsd <= AGENT_LIMITS.maxRunUsd))
    set('budget', 'features.agents.err.budget', { min: fmtUsd(AGENT_LIMITS.minRunUsd, lang), max: fmtUsd(AGENT_LIMITS.maxRunUsd, lang) })
  if (d.runner === 'server' && (!facts.inCloud || !facts.serverOk)) set('runner', 'features.agents.err.server')
  return e
}

/**
 * The scope's lost entries (gone.ts lostPages over facts): deleted for good first (named by the titles the editor saw,
 * else by what they were), then those in the trash, then each one below a page in the trash — the editor's order.
 */
function scopeIssues(d: CustomAgent, facts: AgentSaveFacts, title: (id: ID) => string): AgentSaveIssue[] {
  const lost: Array<{ id: ID; state: 'gone' | 'trashed' | 'below'; database: boolean; root?: string }> = []
  const seesAll = facts.seesAll ?? true
  const add = (id: ID, database: boolean) => {
    if (lost.some((l) => l.id === id)) return
    const p = Object.prototype.hasOwnProperty.call(facts.pages, id) ? facts.pages[id] : undefined
    if (!p) {
      if (seesAll) lost.push({ id, state: 'gone', database })
      return
    }
    if (p.trashed) lost.push({ id, state: 'trashed', database })
    else if (p.root && p.root.id !== id) lost.push({ id, state: 'below', database, root: p.root.title.trim() || (facts.untitled ?? '') })
    else if (p.gone) lost.push({ id, state: 'trashed', database })
  }
  for (const id of d.scope.pages) add(id, false)
  for (const id of d.scope.databases) add(id, true)
  const out: AgentSaveIssue[] = []
  const gone = lost.filter((l) => l.state === 'gone')
  const known = gone.map((l) => facts.titles?.[l.id]?.trim() ?? '')
  if (gone.length === 1)
    out.push(known[0] ? { key: 'features.agents.err.scopeGone.one', vars: { title: known[0] } } : { key: gone[0].database ? 'features.agents.err.scopeGone.database' : 'features.agents.err.scopeGone.page' })
  else if (gone.length) out.push(known.every(Boolean) ? { key: 'features.agents.err.scopeGone.other', titles: known } : { key: 'features.agents.err.scopeGone.some', vars: { count: gone.length } })
  const trashed = lost.filter((l) => l.state === 'trashed').map((l) => l.id)
  if (trashed.length === 1) out.push({ key: 'features.agents.err.scopeTrashed.one', vars: { title: title(trashed[0]) } })
  else if (trashed.length) out.push({ key: 'features.agents.err.scopeTrashed.other', titles: trashed.map(title) })
  for (const l of lost) if (l.state === 'below') out.push({ key: 'features.agents.err.scopeBelow', vars: { title: title(l.id), parent: l.root ?? '' } })
  return out
}

/** The facts of the pages a draft names, read from a page map (the editor's; a team member's map lacks teammates' private pages). */
export function savePagesOf(pages: Record<ID, Page>, d: Pick<CustomAgent, 'scope' | 'trigger' | 'output'>): Record<ID, SavePage> {
  const out: Record<ID, SavePage> = {}
  const ids = [...d.scope.pages, ...d.scope.databases]
  if ((d.trigger.type === 'row_created' || d.trigger.type === 'row_changed') && d.trigger.databaseId) ids.push(d.trigger.databaseId)
  if (d.output?.pageId) ids.push(d.output.pageId)
  for (const id of ids) {
    const p = Object.prototype.hasOwnProperty.call(pages, id) ? pages[id] : undefined
    if (!p || Object.prototype.hasOwnProperty.call(out, id)) continue
    const root = trashedRoot(pages, id)
    out[id] = { title: p.title, trashed: !!p.trashed, gone: !!root, root: root && root.id !== id ? { id: root.id, title: root.title } : null }
  }
  return out
}

/** “A”, “B” and “C” — page titles quoted the way the UI language quotes. */
function titleList(t: Translate, titles: string[]): string {
  const q = titles.map((title) => t('features.agents.err.quoted', { title }))
  return q.length < 2 ? (q[0] ?? '') : `${q.slice(0, -1).join(', ')} ${t('features.agents.err.and')} ${q[q.length - 1]}`
}

/** One sentence in words. */
export function agentSaveText(t: Translate, issue: AgentSaveIssue): string {
  return t(issue.key, issue.titles ? { ...issue.vars, list: titleList(t, issue.titles) } : issue.vars)
}

/** Every field's sentences in words, joined (the editor's error lines). */
export function agentSaveTexts(t: Translate, issues: AgentSaveIssues): AgentSaveErrors {
  const out: AgentSaveErrors = {}
  for (const [field, list] of Object.entries(issues) as Array<[AgentSaveField, AgentSaveIssue[]]>) if (list.length) out[field] = list.map((i) => agentSaveText(t, i)).join(' ')
  return out
}
