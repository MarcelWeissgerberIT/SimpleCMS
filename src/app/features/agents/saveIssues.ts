/**
 * Custom agents — the agent editor's save checks in words: the pure core (saveChecks.ts — the one the Patchbay's patches
 * run too) over this editor's page map, its recipe placeholders (mirror.ts) and the UI's language. Only AgentEditor uses
 * it (it stays in the agents page's lazy chunk).
 */
import type { Translate } from '@/shared/i18n'
import type { CustomAgent, ID, Page } from '../../store/types'
import { currentLang } from '../../i18n'
import { placeholdersIn } from './mirror'
import { agentSaveIssues, agentSaveTexts, savePagesOf, type AgentSaveErrors } from './saveChecks'

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

/** The draft's problems by field, in words (agentSaveIssues in saveChecks.ts says which). */
export function agentSaveErrors(t: Translate, d: CustomAgent, ctx: AgentSaveCtx): AgentSaveErrors {
  const issues = agentSaveIssues(d, {
    pages: savePagesOf(ctx.pages, d),
    untitled: t('common.untitled'),
    seesAll: ctx.seesAll ?? true,
    titles: ctx.titles,
    serverOk: ctx.serverOk,
    inCloud: ctx.inCloud,
    budget: ctx.budget ? { text: ctx.budget.text } : undefined,
    lang: ctx.budget?.lang ?? currentLang(),
    placeholders: d.enabled ? placeholdersIn(d.instructions).length : 0,
  })
  return agentSaveTexts(t, issues)
}
