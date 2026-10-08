/**
 * Custom agents — the recipe "Mirror a list into a database", driven by configuration: an integration profile's
 * RecipeConfig (integrations/recipe.ts — absent fields take the built-in values) says what the database, its views,
 * the agent and the report page are. Items of another tool (reached through the MCP server that matched the profile)
 * are kept in step with a One database by a scheduled agent.
 *
 *  - createMirror(): ONE action, one Undo — the database (its properties, the key, the person's own fields marked
 *    "Only by hand", its views) and its report page, below the page the person picked (team workspace: in the
 *    member's Private section, createPrivateDatabase / createPrivatePage). Store actions only, like the mail and
 *    coding databases. The toast's Undo removes both again — and the agent, when it was saved from the draft.
 *  - mirrorDraft(): the agent the editor opens with — the recipe's schedule in this browser's time zone, browser
 *    runner, its write mode and budget, the source server with the recipe's tools (default: its reading tools from
 *    the last connection test), scope = the database, the report page, its instructions (`{db}` / `{server}` /
 *    `{report}` filled in) with the PLACEHOLDERS the person replaces (the editor refuses to save a switched-on agent
 *    that still holds one).
 *
 * Generic on purpose: no service is named or preset; the source is whatever MCP server the person added, the recipe
 * whatever profile the person configured.
 */
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { inTemplate, isEffectivelyTrashed } from '../../store/selectors'
import { localTimeZone } from '../../store/agents'
import { variants } from '../../store/integrations'
import type { CustomAgent, ID, IntegrationProfile, Page } from '../../store/types'
import { createPrivateDatabase, createPrivatePage, useCloud } from '../../cloud'
import { ALL_MESSAGES, t } from '../../i18n'
import { readServers } from '../ai/mcp-servers/config'
import { isReadTool, testedTools } from './mcpTools'
import { blankAgent } from './recipes'
import { buildMirror, fillTokens, type ResolvedRecipe } from './integrations/recipe'

const REPORT_ICON = { type: 'lucide', value: 'ClipboardList' } as const

/* ------------------------------------------------------------------ placeholders */

export const PLACEHOLDER_KEYS = ['list', 'read', 'readItem', 'me', 'clear'] as const
export type PlaceholderKey = (typeof PLACEHOLDER_KEYS)[number]

/** The built-in recipe's placeholders in both languages. */
export const MIRROR_PLACEHOLDERS: readonly string[] = [
  ...new Set(PLACEHOLDER_KEYS.flatMap((k) => [ALL_MESSAGES.en[`features.agents.mirror.ph.${k}`], ALL_MESSAGES.de[`features.agents.mirror.ph.${k}`]]).filter((s): s is string => !!s)),
]

/** "[WHO I AM IN THE SOURCE]": a bracketed part in capitals (no lower-case letter, at least three capitals). */
export function capsPlaceholders(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\[[^[\]\n]{3,80}\]/g)) {
    const s = m[0]
    if (!/\p{Ll}/u.test(s) && (s.match(/\p{Lu}/gu)?.length ?? 0) >= 3 && !out.includes(s)) out.push(s)
  }
  return out
}

let known: { from: IntegrationProfile[] | undefined; list: string[] } | null = null
/** Placeholders the editor looks for: the built-in ones and those in the instructions of every profile's recipes. */
function knownPlaceholders(): string[] {
  const profiles = useWorkspace.getState().integrations
  if (known && known.from === profiles) return known.list
  const list = [...MIRROR_PLACEHOLDERS]
  for (const p of profiles ?? []) for (const r of p.recipes ?? []) for (const text of variants(r.agent?.instructions)) for (const ph of capsPlaceholders(text)) if (!list.includes(ph)) list.push(ph)
  known = { from: profiles, list }
  return list
}

/** A recipe's placeholders still in `text`, in the order they appear (`key`: a built-in one, for its hint). */
export function placeholdersIn(text: string): Array<{ text: string; key?: PlaceholderKey; at: number }> {
  const out: Array<{ text: string; key?: PlaceholderKey; at: number }> = []
  for (const ph of knownPlaceholders()) {
    const at = text.indexOf(ph)
    if (at < 0 || out.some((o) => o.text === ph)) continue
    const key = PLACEHOLDER_KEYS.find((k) => ALL_MESSAGES.en[`features.agents.mirror.ph.${k}`] === ph || ALL_MESSAGES.de[`features.agents.mirror.ph.${k}`] === ph)
    out.push({ text: ph, at, ...(key ? { key } : {}) })
  }
  return out.sort((a, b) => a.at - b.at)
}

/* ------------------------------------------------------------------ the agent */

/**
 * The agent a mirror starts with (not saved: the editor opens with it). `tools`: the source server's tools from its
 * last connection test — the recipe's tools (default: its reading tools) are its allow-list; null (never tested)
 * leaves the list to the editor unless the recipe names tools.
 */
export function mirrorDraft(input: { recipe: ResolvedRecipe; server: string; name: string; dbId: ID | null; reportId: ID | null; reportTitle: string; tools: string[] | null }): CustomAgent {
  const base = blankAgent()
  const r = input.recipe
  const vars = { db: input.name, server: input.server, report: input.reportTitle }
  const draft: CustomAgent = {
    ...base,
    name: fillTokens(r.agent.name, vars).slice(0, 80),
    icon: r.icon,
    instructions: fillTokens(r.agent.instructions, vars),
    trigger: { type: 'schedule', every: r.agent.schedule.every, at: r.agent.schedule.at, tz: localTimeZone(), ...(r.agent.schedule.weekday !== undefined ? { weekday: r.agent.schedule.weekday } : {}), ...(r.agent.schedule.day !== undefined ? { day: r.agent.schedule.day } : {}) },
    scope: input.dbId ? { everything: false, pages: [], databases: [input.dbId] } : base.scope,
    write: r.agent.write,
    output: input.reportId ? { pageId: input.reportId, mode: 'append' } : null,
    mcpServers: input.server ? [input.server] : [],
    runner: 'browser',
    model: r.agent.model,
    effort: r.agent.effort,
    maxRunUsd: r.agent.budget,
  }
  if (input.server) {
    if (r.agent.tools) draft.mcpTools = { [input.server]: r.agent.tools }
    else if (input.tools?.length) draft.mcpTools = { [input.server]: input.tools.filter(isReadTool) }
  }
  return draft
}

/* ------------------------------------------------------------------ creating it */

export const inTeam = () => useCloud.getState().active.kind === 'cloud'
const ws = () => useWorkspace.getState()

/** A page the database may go below: a live, ordinary page (not a row, not a template) — private in a team. */
export function canHoldMirror(pages: Record<ID, Page>, id: ID | null | undefined, team = inTeam()): boolean {
  const p = id ? pages[id] : undefined
  return !!p && p.kind === 'page' && !p.databaseId && !p.trashed && !isEffectivelyTrashed(pages, p.id) && !inTemplate(pages, p.id) && (!team || !!p.private)
}

/** "Tracker" for the server "tracker", "Item list" for "item_list". */
export const nameFromServer = (server: string) => {
  const s = server.replace(/[-_]+/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}

export interface MirrorInput {
  /** the recipe (an active profile's, its defaults filled in) */
  recipe: ResolvedRecipe
  /** the MCP server's name (settings.mcpServers) */
  server: string
  /** the database's name */
  name: string
  /** the page it goes below (null = the top level / the Private section's top) */
  parentId: ID | null
}

export interface MirrorMade {
  dbId: ID
  reportId: ID
  name: string
  reportTitle: string
  views: number
  /** placeholders left in the draft's instructions */
  placeholders: number
  draft: CustomAgent
}

/** Remove what createMirror made — and the agent, when it was saved from the draft. */
export function undoMirror(made: Pick<MirrorMade, 'dbId' | 'reportId' | 'draft'>): void {
  if (ws().agents?.[made.draft.id]) ws().deleteAgent(made.draft.id)
  for (const id of [made.dbId, made.reportId]) if (ws().pages[id]) ws().deletePagePermanently(id)
}

/**
 * Create the mirror database and its report page (private in a team workspace), toast with Undo. Returns them with
 * the agent draft for the editor. Throws when nothing can be created here (a viewer, no name, a recipe that does not
 * build — its problems are listed under Workspace → Integrations).
 */
export function createMirror(input: MirrorInput, opts: { onUndo?: () => void } = {}): MirrorMade {
  const name = input.name.replace(/\s+/g, ' ').trim().slice(0, 120)
  if (!name) throw new Error('name')
  const team = inTeam()
  if (team && useCloud.getState().readOnly) throw new Error('read-only')
  let broken = 0
  const schema = buildMirror(
    input.recipe,
    (i) => {
      if ((i.severity ?? 'error') === 'error') broken++
    },
    [],
    { left: 0 },
  )
  if (broken) throw new Error(t(broken === 1 ? 'features.agents.mirror.err.recipeOne' : 'features.agents.mirror.err.recipe', { count: broken }))
  const parentId = canHoldMirror(ws().pages, input.parentId, team) ? input.parentId : null
  const dbInput = { parentId, title: name, icon: input.recipe.icon, properties: schema.properties, views: schema.views }
  const dbId = team ? createPrivateDatabase(dbInput) : ws().createDatabase(dbInput)
  const reportTitle = fillTokens(input.recipe.reportName, { db: name, server: input.server }).slice(0, 200)
  const reportInput = { parentId, title: reportTitle, icon: REPORT_ICON }
  let reportId: ID
  try {
    reportId = team ? createPrivatePage(reportInput) : ws().createPage(reportInput)
  } catch (e) {
    ws().deletePagePermanently(dbId)
    throw e
  }
  const server = input.server
  const draft = mirrorDraft({ recipe: input.recipe, server, name, dbId, reportId, reportTitle, tools: testedTools(server, readServers()) })
  const made: MirrorMade = { dbId, reportId, name, reportTitle, views: schema.views.length, placeholders: placeholdersIn(draft.instructions).length, draft }
  useUI.getState().toast({
    message: t('features.agents.mirror.created', { name, views: made.views }),
    kind: 'success',
    action: {
      label: t('common.undo'),
      run: () => {
        undoMirror(made)
        opts.onUndo?.()
      },
    },
  })
  return made
}
