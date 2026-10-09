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
 *    (MirrorDiscard.tsx, trashMirror / restoreMirror). The report page is remembered for the database on this device
 *    (mirrorMemory.ts).
 *  - The rule for taking back: the setup only ever trashes what THIS setup created (`MirrorMade.created`) — never a
 *    database or page that was there before, never one a saved agent uses at that moment (agentUses: its scope, its
 *    trigger, its report page — or a page below one of them), never for good (trash + Undo) — and in a team workspace
 *    it only ever touches or reuses PRIVATE pages.
 *  - sameNamedDb() / reuseMirror(): a live database with the name the setup is about to use is never duplicated
 *    silently — the setup says so and, when it holds the recipe's key property (in either language; private in a
 *    team) and no saved agent mirrors into it already (mirrorAgentOf: the agent the recipe set up for it — `mirrorOf` —,
 *    or an older one that reads one of the profile's servers; in a team only the member's own), sets the agent up for
 *    it: with a report page this device's setup made for that database before (the newest one that is free, keptReport
 *    — a deleted agent's report goes on), else a NEW report page next to it. A page is never taken by its title (it
 *    could be another mirror's report or a hand-written page). A database of that name in the trash that one of the
 *    member's saved agents is marked for (`mirrorOf`) is named too: restore it, open that agent, or pick another name.
 *  - Titles the setup makes (mirrorTitles — the one function for the setup's spec plate, createMirror and reuseMirror)
 *    are distinct (distinctTitle): a report title another live page or database has already — never the mirror's own
 *    database: a report page may share its database's name — gets " (<database>)" (then " (2)", " (3)" …), the agent's
 *    name likewise among the agents; the first mirror keeps the configured names exactly. So prompts, notes and toasts
 *    that name pages by title stay unambiguous, and the plate shows what the offered action makes.
 *  - mirrorDraft(): the agent the editor opens with — the recipe's schedule in this browser's time zone, browser
 *    runner, its write mode and budget, the source server with the recipe's tools (default: its reading tools from
 *    the last connection test), scope = the database (and `mirrorOf` = it), the report page, its instructions (`{db}` /
 *    `{server}` / `{report}` filled in) with the PLACEHOLDERS the person replaces (the editor refuses to save a
 *    switched-on agent that still holds one).
 *
 * Generic on purpose: no service is named or preset; the source is whatever MCP server the person added, the recipe
 * whatever profile the person configured.
 */
import { useWorkspace } from '../../store/store'
import { inTemplate, isEffectivelyTrashed } from '../../store/selectors'
import { AGENT_LIMITS, localTimeZone } from '../../store/agents'
import { variants } from '../../store/integrations'
import type { CustomAgent, Database, ID, IntegrationProfile, Page } from '../../store/types'
import type { Lang } from '@/shared/i18n'
import { createPrivateDatabase, createPrivatePage, useCloud } from '../../cloud'
import { ALL_MESSAGES, t } from '../../i18n'
import { readServers } from '../ai/mcp-servers/config'
import { isReadTool, testedTools } from './mcpTools'
import { blankAgent } from './recipes'
import { buildMirror, fillTokens, type ResolvedRecipe } from './integrations/recipe'
import { rememberReport, rememberedReports } from './mirrorMemory'
import { trashedRoot } from './gone'

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
 * leaves the list to the editor unless the recipe names tools. Set up for a database, it carries `mirrorOf` = that
 * database (mirrorAgentOf).
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
  if (input.dbId) draft.mirrorOf = input.dbId
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
  /**
   * the pages this setup created — the only ones it may ever trash (trashMirror; never one a saved agent uses): both;
   * set up for a database that was there, its new report page — or nothing when its report page was taken back
   */
  created: ID[]
  /** set up for a database that was there already (reuseMirror) */
  reused?: boolean
}

/** What the setup created: both, only the report page (a database that was there), or nothing (its report page taken back too). */
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

/** The signed-in member in a team workspace (only their own agents count there), undefined locally (every agent). */
const ownerHere = (team: boolean): string | null | undefined => (team ? (useCloud.getState().user?.id ?? null) : undefined)

/**
 * The saved agent that mirrors into the database already (the oldest of them):
 *  1. the agent the recipe set up for it (`mirrorOf` = the database) while it still reaches it: its scope names it, or —
 *     in a local workspace — its scope is "everything" (in a team "everything" means the shared pages only, never the
 *     member's private database) — whatever its switch, write mode or servers (a server switched off, renamed or no
 *     longer matching changes nothing);
 *  2. an agent without that marker (saved before it existed): scoped to the database, it may write, and it reads one
 *     of the recipe's source servers — `servers`: every MCP server of this device that matches the profile, switched
 *     on or off — with tools (a server whose tool list is empty is left out of its runs, exec.ts).
 * An agent marked for another database, one that only reports on it, or one that reads another server is not its
 * mirror. `owner` (team workspace): only that member's own agents count — a teammate's agent never reaches the
 * member's private database, so it is never offered there; undefined = every agent (a local workspace).
 */
export function mirrorAgentOf(agents: Record<ID, CustomAgent> | undefined, dbId: ID, servers: readonly string[], owner?: string | null, team: boolean = owner !== undefined): CustomAgent | null {
  const reads = (a: CustomAgent) =>
    a.mcpServers.some((s) => servers.includes(s) && !(a.mcpTools && Object.prototype.hasOwnProperty.call(a.mcpTools, s) && a.mcpTools[s].length === 0))
  const reaches = (a: CustomAgent) => a.scope.databases.includes(dbId) || (a.scope.everything && !team)
  const mirrors = (a: CustomAgent) =>
    a.mirrorOf ? a.mirrorOf === dbId && reaches(a) : !a.scope.everything && a.scope.databases.includes(dbId) && a.write !== 'none' && reads(a)
  return (
    Object.values(agents ?? {})
      .filter((a) => (owner === undefined || a.createdBy === owner) && mirrors(a))
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
  /** a saved agent (in a team: the member's own) mirrors into it already: that one is opened instead of making a second */
  agent?: { id: ID; name: string }
  /**
   * it is in the trash (no live one has the name) and `agent` is marked for it (`mirrorOf`): `root` is the page in the
   * trash that holds it (itself, or a page above it) — restoring that brings it back
   */
  trashed?: { root: ID }
}

/**
 * A live database named like `name` (NFC, spaces and case folded): the setup never makes a second one silently.
 * `keys`: the recipe's key property name per language; `servers`: the recipe's source servers, switched on or off
 * (mirrorAgentOf); `owner`: whose agents count (team: the signed-in member). The usable one first (fits, no agent on
 * it yet), then the fitting one, then the newest. No live one: a database of that name in the trash that a saved agent
 * (team: the member's own) is marked for (`mirrorOf`) — `trashed`, with that agent (the newest such database).
 */
export function sameNamedDb(
  pages: Record<ID, Page>,
  databases: Record<ID, Database>,
  agents: Record<ID, CustomAgent> | undefined,
  name: string,
  keys: KeyName[],
  servers: readonly string[],
  team = inTeam(),
  owner: string | null | undefined = ownerHere(team),
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
      const agent = mirrorAgentOf(agents, p.id, servers, owner, team)
      const out: SameNamed = { id: p.id, title: p.title.trim(), fits: !!lang && !shared }
      if (lang) out.lang = lang
      if (shared) out.shared = true
      if (agent) out.agent = { id: agent.id, name: agent.name }
      return { out, at: p.createdAt }
    })
    .sort((a, b) => Number(usable(b.out)) - Number(usable(a.out)) || Number(b.out.fits) - Number(a.out.fits) || b.at - a.at)[0]
  if (found) return found.out
  // in the trash, and a saved agent mirrors into it: never a second database silently next to that agent
  const marked = Object.values(agents ?? {})
    .filter((a) => !!a.mirrorOf && (owner === undefined || a.createdBy === owner))
    .sort((a, b) => a.createdAt - b.createdAt)
  const binned = Object.values(pages)
    .filter((p) => p.kind === 'database' && fold(p.title) === want && !inTemplate(pages, p.id) && marked.some((a) => a.mirrorOf === p.id))
    .map((p) => ({ p, root: trashedRoot(pages, p.id) }))
    .filter((x): x is { p: Page; root: Page } => !!x.root)
    .sort((a, b) => b.p.createdAt - a.p.createdAt)[0]
  if (!binned) return null
  const agent = marked.find((a) => a.mirrorOf === binned.p.id)!
  return { id: binned.p.id, title: binned.p.title.trim(), fits: false, agent: { id: agent.id, name: agent.name }, trashed: { root: binned.root.id } }
}

/* ------------------------------------------------------------------ distinct titles */

/**
 * Folded titles of the live pages and databases as this device sees them (rows and templates left out) — `except`: the
 * mirror's own database (a report page may share its name).
 */
export function pageTitles(pages: Record<ID, Page>, except?: ID | null): Set<string> {
  const out = new Set<string>()
  for (const p of Object.values(pages)) if (p.id !== except && !p.databaseId && p.title.trim() && live(pages, p)) out.add(fold(p.title))
  return out
}

/** Folded names of the saved agents. */
const agentNames = (agents: Record<ID, CustomAgent> | undefined) => new Set(Object.values(agents ?? {}).map((a) => fold(a.name)))

/**
 * A title the setup makes that none of `taken` (folded) has: `title` itself when free — the first mirror keeps the
 * configured names exactly —, else `title (<db>)`, then `title (<db>) (2)`, `… (3)` until free. A title that names the
 * database already skips the ` (<db>)` step (it would only repeat the name): `title (2)`, `title (3)` … At most `max`
 * characters (the title is cut, the suffix stays whole).
 */
export function distinctTitle(title: string, db: string, taken: ReadonlySet<string>, max: number): string {
  const first = title.slice(0, max)
  if (!taken.has(fold(first))) return first
  const fit = (suffix: string) => {
    const room = max - suffix.length
    return room > 0 ? `${title.slice(0, room).trimEnd()}${suffix}` : `${title}${suffix}`.slice(0, max)
  }
  const named = !fold(db) || fold(title).includes(fold(db))
  const dbPart = named ? '' : ` (${db.replace(/\s+/g, ' ').trim()})`
  if (dbPart && !taken.has(fold(fit(dbPart)))) return fit(dbPart)
  for (let n = 2; n < 10_000; n++) {
    const next = fit(`${dbPart} (${n})`)
    if (!taken.has(fold(next))) return next
  }
  return first
}

/* ------------------------------------------------------------------ the report page */

/** The report page (private in a team workspace). */
function makeReport(parentId: ID | null, title: string, team: boolean): ID {
  const input = { parentId, title, icon: REPORT_ICON }
  return team ? createPrivatePage(input) : ws().createPage(input)
}

/** `id` and the pages above it (parents, a row's database …), cycle-safe. */
function selfAndAbove(pages: Record<ID, Page>, id: ID): Set<ID> {
  const out = new Set<ID>()
  for (let p: Page | undefined = pages[id]; p && !out.has(p.id); p = p.parentId ? pages[p.parentId] : p.databaseId ? pages[p.databaseId] : undefined) out.add(p.id)
  return out
}

/**
 * The saved agent that keeps a remembered report page from being taken back (null: none):
 *  - one that uses the page or a page below it — its scope pages and databases, the database its trigger watches, its
 *    report page (agentUses; whatever its write mode);
 *  - one that may write (write !== 'none') and names the page or ANY page above it in its scope or as its report page —
 *    a scope covers everything below a scoped page (scope.ts), so such an agent may change it.
 * An agent whose scope is "everything" names no page and keeps none.
 */
function holdsReport(pages: Record<ID, Page>, agents: Record<ID, CustomAgent> | undefined, id: ID): string | null {
  const below = usedBy(pages, agentUses(agents), id)
  if (below) return below
  const above = selfAndAbove(pages, id)
  for (const a of Object.values(agents ?? {}).sort((x, y) => x.createdAt - y.createdAt)) {
    if (a.write === 'none') continue
    const named = [...(a.scope.everything ? [] : [...a.scope.pages, ...a.scope.databases]), ...(a.output?.pageId ? [a.output.pageId] : [])]
    if (named.some((n) => above.has(n))) return a.name
  }
  return null
}

/**
 * The report page "Use" takes back for the database: the newest of the pages this device's setups made (or took back)
 * for it (mirrorMemory.ts) that is a live, ordinary page (private in a team) and that no saved agent holds (holdsReport):
 * a deleted agent's report goes on, and a page set aside for a newer one comes back once that newer one is gone. A page
 * no setup here made is never taken (it is never remembered — a page is never found by its title).
 */
function keptReport(pages: Record<ID, Page>, agents: Record<ID, CustomAgent> | undefined, dbId: ID, team: boolean): Page | null {
  for (const id of rememberedReports(dbId)) {
    const p = pages[id]
    if (!p || p.kind !== 'page' || p.databaseId || !live(pages, p) || (team && !p.private)) continue
    if (!holdsReport(pages, agents, p.id)) return p
  }
  return null
}

/** What a setup names: the report page's title (or the page it takes back) and the agent's name. */
export interface MirrorTitles {
  reportTitle: string
  /** "Use": the report page it takes back (keptReport) — null: it makes a new one titled `reportTitle` */
  keptId: ID | null
  agentName: string
}

/**
 * The titles a setup makes — the one function for the setup's spec plate, createMirror and reuseMirror, so the plate
 * shows exactly what the offered action makes. `name`: the database's name (for "Use" the title of the database that
 * is there); `dbId`: that database (or the one just created) — it never counts against its own report page's title;
 * `reuse`: "Use" — the kept report page when one is free (keptReport). The recipe as the action resolves it (for "Use":
 * in the language its key is named in). Distinct (distinctTitle): the report title among the live pages and databases,
 * the agent's name among the saved agents.
 */
export function mirrorTitles(
  input: { recipe: ResolvedRecipe; server: string; name: string; dbId: ID | null; reuse?: boolean },
  ctx: { pages: Record<ID, Page>; agents: Record<ID, CustomAgent> | undefined; team: boolean } = { pages: ws().pages, agents: ws().agents, team: inTeam() },
): MirrorTitles {
  const { recipe, server, name, dbId } = input
  const kept = input.reuse && dbId ? keptReport(ctx.pages, ctx.agents, dbId, ctx.team) : null
  const reportTitle = kept ? kept.title.trim() || t('common.untitled') : distinctTitle(fillTokens(recipe.reportName, { db: name, server }), name, pageTitles(ctx.pages, dbId), 200)
  const agentName = distinctTitle(fillTokens(recipe.agent.name, { db: name, server, report: reportTitle }).slice(0, 80), name, agentNames(ctx.agents), AGENT_LIMITS.name)
  return { reportTitle, keptId: kept?.id ?? null, agentName }
}

/** The agent draft for a database, named as mirrorTitles says. */
function draftFor(recipe: ResolvedRecipe, server: string, name: string, dbId: ID, reportId: ID, titles: MirrorTitles): CustomAgent {
  const draft = mirrorDraft({ recipe, server, name, dbId, reportId, reportTitle: titles.reportTitle, tools: testedTools(server, readServers()) })
  draft.name = titles.agentName
  return draft
}

/**
 * Create the mirror database and its report page (private in a team workspace; the page remembered for the database on
 * this device). Returns them with the agent draft for the editor (its note carries the Undo). Throws when nothing can
 * be created here (a viewer, no name, a recipe that does not build — its problems are listed under Workspace →
 * Integrations).
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
  // distinct from every other live page (never from its own database), the agent's name among the saved agents
  const titles = mirrorTitles({ recipe: input.recipe, server: input.server, name, dbId })
  let reportId: ID
  try {
    reportId = makeReport(parentId, titles.reportTitle, team)
  } catch (e) {
    ws().deletePagePermanently(dbId)
    throw e
  }
  rememberReport(dbId, reportId)
  const draft = draftFor(input.recipe, input.server, name, dbId, reportId, titles)
  return { dbId, reportId, name, reportTitle: titles.reportTitle, views: schema.views.length, placeholders: placeholdersIn(draft.instructions).length, draft, created: [dbId, reportId] }
}

/**
 * The agent draft for a database that is there already (sameNamedDb, `fits`; the recipe resolved in the language its
 * key is named in): with the report page this device's setup made for it before while one is free (keptReport — then
 * nothing is `created`: the note has no Undo, closing asks nothing), else a NEW report page right next to it (private in
 * a team; remembered) — the only page `created`, so discarding takes back only that page. Never a page found by its
 * title. Throws when the database is gone, shared in a team workspace, or nothing can be written here.
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
  const titles = mirrorTitles({ recipe: input.recipe, server: input.server, name, dbId: db.id, reuse: true }, { pages, agents: ws().agents, team })
  const created: ID[] = []
  let reportId: ID
  if (titles.keptId) reportId = titles.keptId
  else {
    reportId = makeReport(canHoldMirror(pages, db.parentId, team) ? db.parentId : null, titles.reportTitle, team)
    created.push(reportId)
  }
  // the newest entry either way (the memory keeps the 100 databases used last, ≤ 5 pages each)
  rememberReport(db.id, reportId)
  const draft = draftFor(input.recipe, input.server, name, db.id, reportId, titles)
  return { dbId: db.id, reportId, name, reportTitle: titles.reportTitle, views: ws().databases[db.id]?.views.length ?? 0, placeholders: placeholdersIn(draft.instructions).length, draft, created, reused: true }
}
