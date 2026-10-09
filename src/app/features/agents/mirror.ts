/**
 * Custom agents — the recipe "Mirror a list into a database", driven by configuration: an integration profile's
 * RecipeConfig (integrations/recipe.ts — absent fields take the built-in values) says what the database, its views,
 * the agent and the report page are. Items of another tool (reached through the MCP server that matched the profile)
 * are kept in step with a One database by a scheduled agent.
 *
 *  - createMirror(): ONE action — the database (its properties, the key, the person's own fields marked
 *    "Only by hand", its views) and its report page, below the page the person picked (team workspace: in the
 *    member's Private section, createPrivateDatabase / createPrivatePage). Store actions only, like the mail and
 *    coding databases. No toast (it would sit on the editor's footer): the editor's note says what is made and
 *    carries the Undo (undoMirror); closing the editor unsaved asks whether both stay or go to the trash
 *    (MirrorDiscard.tsx, trashMirror / restoreMirror).
 *  - The rule for taking back: the setup only ever trashes what THIS setup created (`MirrorMade.created`) — never a
 *    database or page that was there before, never one a saved agent uses at that moment (agentUses: its scope, its
 *    trigger, its report page — or a page below one of them), never for good (trash + Undo) — and in a team workspace
 *    it only ever touches or reuses PRIVATE pages.
 *  - sameNamedDb() / reuseMirror(): a live database with the name the setup is about to use is never duplicated
 *    silently — the setup says so and, when it holds the recipe's key property (in either language; private in a
 *    team) and no saved agent mirrors into it already (mirrorAgentOf: scoped to it, may write, reads one of the
 *    recipe's source servers), sets the agent up for it with a NEW report page next to it — a page is never taken by
 *    its title (it could be another mirror's report, a hand-written page or a deleted agent's).
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
import { inTemplate, isEffectivelyTrashed } from '../../store/selectors'
import { localTimeZone } from '../../store/agents'
import { variants } from '../../store/integrations'
import type { CustomAgent, Database, ID, IntegrationProfile, Page } from '../../store/types'
import type { Lang } from '@/shared/i18n'
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
  /** the pages this setup created — the only ones it may ever trash (trashMirror; never one a saved agent uses): both, or (set up for a database that was there) its new report page */
  created: ID[]
  /** set up for a database that was there already (reuseMirror) */
  reused?: boolean
}

/** What the setup created: both, only the report page (a database that was there), or nothing. */
export function madeKind(made: Pick<MirrorMade, 'created' | 'dbId'>): 'both' | 'report' | 'none' {
  return made.created.includes(made.dbId) ? 'both' : made.created.length ? 'report' : 'none'
}

/** A page the setup made and a saved agent uses — kept when the rest goes to the trash. */
export interface KeptPage {
  id: ID
  title: string
  /** the (first) agent that uses it */
  agent: string
}

/**
 * The pages saved agents use, each with the first agent naming it: their scope (pages, databases), the database
 * their trigger watches and their report page. An agent that reads everything names no page.
 */
function agentUses(agents: Record<ID, CustomAgent> | undefined): Map<ID, string> {
  const uses = new Map<ID, string>()
  const add = (id: ID | null | undefined, name: string) => {
    if (id && !uses.has(id)) uses.set(id, name)
  }
  for (const a of Object.values(agents ?? {}).sort((x, y) => x.createdAt - y.createdAt)) {
    for (const id of a.scope.everything ? [] : [...a.scope.pages, ...a.scope.databases]) add(id, a.name)
    if (a.trigger.type === 'row_created' || a.trigger.type === 'row_changed') add(a.trigger.databaseId, a.name)
    add(a.output?.pageId, a.name)
  }
  return uses
}

/** The agent using `id` or a page below it (a row, a sub-page) — null: none. */
function usedBy(pages: Record<ID, Page>, uses: Map<ID, string>, id: ID): string | null {
  for (const [used, agent] of uses) {
    // walk up from the used page: `id` itself or one of its ancestors
    for (let p: Page | undefined = pages[used], n = 0; p && n < 200; p = p.parentId ? pages[p.parentId] : undefined, n++) if (p.id === id) return agent
  }
  return null
}

/**
 * What the setup created (only that) to the trash — but never a page a saved agent uses at this moment (a stale Undo
 * in a toast, an agent saved meanwhile here or on another device). Returns the ids it trashed (for restoreMirror) and
 * the pages it kept.
 */
export function trashMirror(made: Pick<MirrorMade, 'created'>): { ids: ID[]; kept: KeptPage[] } {
  const pages = ws().pages
  const uses = agentUses(ws().agents)
  const ids: ID[] = []
  const kept: KeptPage[] = []
  for (const id of made.created) {
    const p = pages[id]
    if (!p || p.trashed) continue
    const agent = usedBy(pages, uses, id)
    if (agent) kept.push({ id, title: p.title.trim(), agent })
    else ids.push(id)
  }
  for (const id of ids) ws().trashPage(id)
  return { ids, kept }
}

/** Undo of trashMirror. */
export function restoreMirror(ids: ID[]): void {
  for (const id of ids) if (ws().pages[id]?.trashed) ws().restorePage(id)
}

/**
 * The note's Undo: the agent goes when it was saved from the draft, and what the setup created goes to the trash —
 * never for good (rows or sub-pages added meanwhile, here or on another device, come back with restoreMirror).
 */
export function undoMirror(made: Pick<MirrorMade, 'created' | 'draft'>): ReturnType<typeof trashMirror> {
  if (ws().agents?.[made.draft.id]) ws().deleteAgent(made.draft.id)
  return trashMirror(made)
}

/** Names folded for comparing: Unicode NFC, spaces collapsed, case ignored. */
const fold = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
const live = (pages: Record<ID, Page>, p: Page) => !p.trashed && !isEffectivelyTrashed(pages, p.id) && !inTemplate(pages, p.id)

/**
 * A saved agent that mirrors into the database already: scoped to it, it may write, and it reads one of the recipe's
 * source servers (`servers`: the MCP servers that match the profile) — an agent that only reports on the database, or
 * reads another server, is not its mirror.
 */
export function mirrorAgentOf(agents: Record<ID, CustomAgent> | undefined, dbId: ID, servers: readonly string[]): CustomAgent | null {
  return (
    Object.values(agents ?? {})
      .filter((a) => !a.scope.everything && a.scope.databases.includes(dbId) && a.write !== 'none' && a.mcpServers.some((s) => servers.includes(s)))
      .sort((a, b) => a.createdAt - b.createdAt)[0] ?? null
  )
}

/** The recipe's key property name in one language (the recipe resolved in `lang`). */
export interface KeyName {
  name: string
  lang: Lang
}

export interface SameNamed {
  id: ID
  title: string
  /** holds the recipe's key property (either language) and — in a team — is private: the agent can mirror into it */
  fits: boolean
  /** the language its key property is named in (reuseMirror resolves the recipe in it) */
  lang?: Lang
  /** team workspace: a shared database — never used for the member's private mirror */
  shared?: boolean
  /** a saved agent mirrors into it already: that one is opened instead of making a second */
  agent?: { id: ID; name: string }
}

/**
 * A live database named like `name` (NFC, spaces and case folded): the setup never makes a second one silently.
 * `keys`: the recipe's key property name per language; `servers`: the recipe's source servers (mirrorAgentOf). The
 * usable one first (fits, no agent on it yet), then the fitting one, then the newest.
 */
export function sameNamedDb(
  pages: Record<ID, Page>,
  databases: Record<ID, Database>,
  agents: Record<ID, CustomAgent> | undefined,
  name: string,
  keys: KeyName[],
  servers: readonly string[],
  team = inTeam(),
): SameNamed | null {
  const want = fold(name)
  if (!want) return null
  const keyLang = (id: ID): Lang | undefined => {
    const props = databases[id]?.properties ?? []
    return keys.find((k) => props.some((p) => p.key && p.name === k.name))?.lang
  }
  const usable = (x: SameNamed) => x.fits && !x.agent
  const found = Object.values(pages)
    .filter((p) => p.kind === 'database' && fold(p.title) === want && live(pages, p))
    .map((p) => {
      const lang = keyLang(p.id)
      const shared = team && !p.private
      const agent = mirrorAgentOf(agents, p.id, servers)
      const out: SameNamed = { id: p.id, title: p.title.trim(), fits: !!lang && !shared }
      if (lang) out.lang = lang
      if (shared) out.shared = true
      if (agent) out.agent = { id: agent.id, name: agent.name }
      return { out, at: p.createdAt }
    })
    .sort((a, b) => Number(usable(b.out)) - Number(usable(a.out)) || Number(b.out.fits) - Number(a.out.fits) || b.at - a.at)[0]
  return found?.out ?? null
}

/** The report page (private in a team workspace). */
function makeReport(parentId: ID | null, title: string, team: boolean): ID {
  const input = { parentId, title, icon: REPORT_ICON }
  return team ? createPrivatePage(input) : ws().createPage(input)
}

/**
 * Create the mirror database and its report page (private in a team workspace). Returns them with the agent draft for
 * the editor (its note carries the Undo). Throws when nothing can be created here (a viewer, no name, a recipe that
 * does not build — its problems are listed under Workspace → Integrations).
 */
export function createMirror(input: MirrorInput): MirrorMade {
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
  let reportId: ID
  try {
    reportId = makeReport(parentId, reportTitle, team)
  } catch (e) {
    ws().deletePagePermanently(dbId)
    throw e
  }
  const server = input.server
  const draft = mirrorDraft({ recipe: input.recipe, server, name, dbId, reportId, reportTitle, tools: testedTools(server, readServers()) })
  return { dbId, reportId, name, reportTitle, views: schema.views.length, placeholders: placeholdersIn(draft.instructions).length, draft, created: [dbId, reportId] }
}

/**
 * The agent draft for a database that is there already (sameNamedDb, `fits`; the recipe resolved in the language
 * its key is named in) with a NEW report page right next to it (private in a team) — the only page `created`, so
 * discarding takes back only that page. Never a page found by its title. Throws when the database is gone, shared in a
 * team workspace, or nothing can be written here.
 */
export function reuseMirror(input: { recipe: ResolvedRecipe; server: string; dbId: ID }): MirrorMade {
  const team = inTeam()
  if (team && useCloud.getState().readOnly) throw new Error('read-only')
  const pages = ws().pages
  const db = pages[input.dbId]
  if (!db || db.kind !== 'database' || !live(pages, db)) throw new Error('gone')
  // a team mirror writes the member's own fields: only into a private database
  if (team && !db.private) throw new Error(t('features.agents.mirror.err.shared', { name: db.title.trim() }))
  const name = db.title.trim()
  const reportTitle = fillTokens(input.recipe.reportName, { db: name, server: input.server }).slice(0, 200)
  const reportId = makeReport(canHoldMirror(pages, db.parentId, team) ? db.parentId : null, reportTitle, team)
  const created: ID[] = [reportId]
  const draft = mirrorDraft({ recipe: input.recipe, server: input.server, name, dbId: db.id, reportId, reportTitle, tools: testedTools(input.server, readServers()) })
  return { dbId: db.id, reportId, name, reportTitle, views: ws().databases[db.id]?.views.length ?? 0, placeholders: placeholdersIn(draft.instructions).length, draft, created, reused: true }
}
