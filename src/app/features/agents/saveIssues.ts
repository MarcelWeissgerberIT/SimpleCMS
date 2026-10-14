/**
 * Custom agents — the editor's save checks (moved out of AgentEditor.tsx so the Patchbay's patches run the very same
 * checks before they plan a write, §1.13). No side effects: the pages and the facts are passed in, the answer is the
 * problems by field (none: {}). Strings in the UI's language through `t`.
 */
import type { Translate } from '@/shared/i18n'
import { isEffectivelyTrashed } from '../../store/selectors'
import { AGENT_LIMITS, isTimeZone } from '../../store/agents'
import type { CustomAgent, ID, Page } from '../../store/types'
import { currentLang } from '../../i18n'
import { fmtAmount, fmtUsd, parseAmount } from './format'
import { lostPages, trashedRoot } from './gone'
import { placeholdersIn } from './mirror'

/** The problems of a draft by field (a field without one is absent). */
export type AgentSaveErrors = Partial<Record<'name' | 'instructions' | 'trigger' | 'scope' | 'output' | 'budget' | 'runner' | 'mcp', string>>

/**
 * What the checks look at besides the draft: the page map, whether the team server runs agents (`serverOk`), a team
 * workspace (`inCloud`), the titles the editor saw (a page deleted for good meanwhile is named by them), the budget
 * field's text in the UI's language, and whether the saver sees every page of the agent's (a teammate's private ones).
 */
export interface AgentSaveCtx {
  pages: Record<ID, Page>
  serverOk: boolean
  inCloud: boolean
  titles?: Record<ID, string>
  budget?: { text: string; lang: string }
  seesAll?: boolean
}

/** “A”, “B” and “C” — page titles quoted the way the UI language quotes. */
function titleList(t: Translate, titles: string[]): string {
  const q = titles.map((title) => t('features.agents.err.quoted', { title }))
  return q.length < 2 ? (q[0] ?? '') : `${q.slice(0, -1).join(', ')} ${t('features.agents.err.and')} ${q[q.length - 1]}`
}

/**
 * The draft's problems by field. Nothing is saved against a page in the trash (or below one) or one deleted for good: a
 * trashed page or database in its scope, its trigger's database or its report page is named — the person takes it out
 * or restores it (it may have gone to the trash while the editor was open: here, in another tab, by an Undo); one that
 * is only below a page in the trash names that page (the trash lists only it); a scope entry that does not exist any
 * more (deleted for good) is named by the title it had while the editor was open (`titles`), and the person takes it
 * out. `budget`: the budget field's text in the UI's language (parseAmount) — a text that is no number is refused.
 */
export function agentSaveIssues(t: Translate, d: CustomAgent, ctx: AgentSaveCtx): AgentSaveErrors {
  const e: AgentSaveErrors = {}
  const binned = (id: ID) => {
    const p = ctx.pages[id]
    return !!p && (!!p.trashed || isEffectivelyTrashed(ctx.pages, id))
  }
  const title = (id: ID) => ctx.pages[id]?.title.trim() || t('common.untitled')
  // the page in the trash that holds `id` when it is only below one (null: in the trash itself, or not at all)
  const parentBin = (id: ID) => {
    const root = trashedRoot(ctx.pages, id)
    return root && root.id !== id ? root.title.trim() || t('common.untitled') : null
  }
  if (!d.name.trim()) e.name = t('features.agents.err.name')
  if (!d.instructions.trim()) e.instructions = t('features.agents.err.instructions')
  else if (d.instructions.length > AGENT_LIMITS.instructions) e.instructions = t('features.agents.err.tooLong', { max: AGENT_LIMITS.instructions })
  else if (d.enabled && placeholdersIn(d.instructions).length) e.instructions = t('features.agents.mirror.err.placeholders', { count: placeholdersIn(d.instructions).length })
  const tr = d.trigger
  if (tr.type === 'row_created' || tr.type === 'row_changed') {
    const parent = tr.databaseId ? parentBin(tr.databaseId) : null
    if (tr.databaseId && parent) e.trigger = t('features.agents.err.databaseBelow', { title: title(tr.databaseId), parent })
    else if (tr.databaseId && binned(tr.databaseId)) e.trigger = t('features.agents.err.databaseTrashed', { title: title(tr.databaseId) })
    else if (!(tr.databaseId && ctx.pages[tr.databaseId])) e.trigger = t('features.agents.err.database')
  }
  if (tr.type === 'schedule' && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(tr.at) || !isTimeZone(tr.tz))) e.trigger = t('features.agents.err.time')
  if (tr.type === 'webhook' && d.runner !== 'server') e.trigger = t('features.agents.err.webhook')
  if (!d.scope.everything && !d.scope.pages.length && !d.scope.databases.length) e.scope = t('features.agents.err.scope')
  else if (!d.scope.everything) {
    const lost = lostPages({ scope: d.scope, trigger: { type: 'manual' }, output: null }, ctx.pages, '', ctx.seesAll ?? true)
    const out: string[] = []
    // deleted for good: named by the title it had while the editor was open, else by what it was
    const gone = lost.filter((l) => l.state === 'gone')
    const known = gone.map((l) => ctx.titles?.[l.id]?.trim() ?? '')
    if (gone.length === 1)
      out.push(known[0] ? t('features.agents.err.scopeGone.one', { title: known[0] }) : t(gone[0].database ? 'features.agents.err.scopeGone.database' : 'features.agents.err.scopeGone.page'))
    else if (gone.length) out.push(known.every(Boolean) ? t('features.agents.err.scopeGone.other', { list: titleList(t, known) }) : t('features.agents.err.scopeGone.some', { count: gone.length }))
    const trashed = lost.filter((l) => l.state === 'trashed').map((l) => l.id)
    if (trashed.length === 1) out.push(t('features.agents.err.scopeTrashed.one', { title: title(trashed[0]) }))
    else if (trashed.length) out.push(t('features.agents.err.scopeTrashed.other', { list: titleList(t, trashed.map(title)) }))
    for (const l of lost) if (l.state === 'below' && l.root) out.push(t('features.agents.err.scopeBelow', { title: title(l.id), parent: l.root.title || t('common.untitled') }))
    if (out.length) e.scope = out.join(' ')
  }
  const outParent = d.output?.pageId ? parentBin(d.output.pageId) : null
  if (d.output && d.output.pageId && !ctx.pages[d.output.pageId]) e.output = t('features.agents.err.output')
  else if (d.output?.pageId && outParent) e.output = t('features.agents.err.outputBelow', { title: title(d.output.pageId), parent: outParent })
  else if (d.output?.pageId && binned(d.output.pageId)) e.output = t('features.agents.err.outputTrashed', { title: title(d.output.pageId) })
  if (ctx.budget && parseAmount(ctx.budget.text, ctx.budget.lang) === null) e.budget = t('features.agents.err.budgetNumber', { example: fmtAmount(1.5, ctx.budget.lang) })
  else if (!(d.maxRunUsd >= AGENT_LIMITS.minRunUsd && d.maxRunUsd <= AGENT_LIMITS.maxRunUsd)) e.budget = t('features.agents.err.budget', { min: fmtUsd(AGENT_LIMITS.minRunUsd, currentLang()), max: fmtUsd(AGENT_LIMITS.maxRunUsd, currentLang()) })
  if (d.runner === 'server' && (!ctx.inCloud || !ctx.serverOk)) e.runner = t('features.agents.err.server')
  return e
}
