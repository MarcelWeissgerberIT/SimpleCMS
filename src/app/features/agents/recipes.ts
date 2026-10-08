/**
 * Custom agents — starter recipes (DE / EN): a filled-in draft for a common job. The draft picks
 * matching parts of the workspace when it finds them (a Mails database, a Projects database, a
 * database with a form, an MCP server that looks like a knowledge base); the editor shows what is still missing.
 * Mirror recipes are not built in: an active integration profile brings them (integrations/, MirrorSetup.tsx).
 */
import type { CustomAgent, Database, ID, PageIcon } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { inTemplate } from '../../store/selectors'
import { localTimeZone, DEFAULT_RUN_USD } from '../../store/agents'
import { newId } from '../../lib/ids'
import { t } from '../../i18n'
import { readServers } from '../ai/mcp-servers/config'

export type RecipeId = 'mail' | 'weekly' | 'forms' | 'atlas' | 'blank'
export const RECIPES: Array<{ id: RecipeId; icon: PageIcon; code: string }> = [
  { id: 'mail', icon: { type: 'lucide', value: 'Mail', color: 'orange' }, code: 'AG-M' },
  { id: 'weekly', icon: { type: 'lucide', value: 'ClipboardList', color: 'blue' }, code: 'AG-W' },
  { id: 'forms', icon: { type: 'lucide', value: 'ListChecks', color: 'green' }, code: 'AG-F' },
  { id: 'atlas', icon: { type: 'lucide', value: 'Library', color: 'purple' }, code: 'AG-K' },
  { id: 'blank', icon: { type: 'lucide', value: 'Cpu', color: 'gray' }, code: 'AG-0' },
]

function databases(): Array<{ id: ID; title: string; db: Database }> {
  const { pages, databases } = useWorkspace.getState()
  return Object.values(databases)
    .filter((db) => pages[db.id] && !pages[db.id].trashed && !inTemplate(pages, db.id))
    .map((db) => ({ id: db.id, title: pages[db.id].title.trim(), db }))
}

const findDb = (re: RegExp) => databases().find((d) => re.test(d.title))?.id ?? null

function mailsDb(): ID | null {
  const own = useWorkspace.getState().settings.mail?.databaseId
  if (own && useWorkspace.getState().databases[own]) return own
  return findDb(/^(e-?)?mails?\b|posteingang|inbox/i)
}

const formsDb = () => databases().find((d) => d.db.views.some((v) => v.type === 'form'))?.id ?? null

/** A new, empty agent. */
export function blankAgent(): CustomAgent {
  const now = Date.now()
  return {
    id: newId(),
    name: '',
    icon: { type: 'lucide', value: 'Cpu', color: 'gray' },
    instructions: '',
    trigger: { type: 'manual' },
    scope: { everything: true, pages: [], databases: [] },
    write: 'stage',
    output: null,
    mcpServers: [],
    runner: 'browser',
    model: null,
    effort: null,
    maxRunUsd: DEFAULT_RUN_USD,
    enabled: true,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
  }
}

/** The draft a recipe starts from (in the UI language). */
export function recipeDraft(id: RecipeId): CustomAgent {
  const base = blankAgent()
  const recipe = RECIPES.find((r) => r.id === id)!
  if (id === 'blank') return base
  const draft: CustomAgent = { ...base, icon: recipe.icon, name: t(`features.agents.recipe.${id}.name`), instructions: t(`features.agents.recipe.${id}.instructions`) }
  const tz = localTimeZone()
  switch (id) {
    case 'mail': {
      const db = mailsDb()
      draft.trigger = { type: 'row_created', databaseId: db ?? '' }
      draft.scope = db ? { everything: false, pages: [], databases: [db] } : draft.scope
      draft.write = 'stage'
      break
    }
    case 'weekly': {
      const db = findDb(/project|projekt/i)
      draft.trigger = { type: 'schedule', every: 'week', weekday: 1, at: '08:00', tz }
      draft.scope = db ? { everything: false, pages: [], databases: [db] } : draft.scope
      draft.write = 'none'
      draft.output = { pageId: null, mode: 'append' }
      break
    }
    case 'forms': {
      const db = formsDb()
      draft.trigger = { type: 'row_created', databaseId: db ?? '' }
      draft.scope = db ? { everything: false, pages: [], databases: [db] } : draft.scope
      draft.write = 'none'
      draft.output = { pageId: null, mode: 'append' }
      break
    }
    case 'atlas': {
      // the server that looks like a knowledge base, else the only one there is
      const servers = readServers()
      const atlas = servers.find((s) => /atlas|knowledge|wiki|kb|docs|notion|confluence/i.test(s.name)) ?? (servers.length === 1 ? servers[0] : undefined)
      draft.trigger = { type: 'schedule', every: 'week', weekday: 5, at: '16:00', tz }
      draft.mcpServers = atlas ? [atlas.name] : []
      draft.write = 'stage'
      break
    }
  }
  return draft
}
