/**
 * The setup lamps' facts, read in the browser (plan §1.11): the ONLY module of setup/ that reads stores. It turns this
 * device's state into the plain data lamps.ts and ghosts.ts take (ProfileFacts, LampFacts, RecipeSetup):
 *  - 00 the key: aiStatus('agents.run') and aiStatus('mcp-setup.inspect') → offersAI; the Claude key's last 4 (its
 *    vault marker — never the key);
 *  - 01 / 02 the servers the profile matches by name / host (on or off; by its tools when it names neither), each with
 *    MCP · Connections' state, a test running (useMcpChecks) and the tools of its last test;
 *  - 03 profileStatus on this device;
 *  - 04–06 per recipe, durable facts only (never MirrorSetup's in-memory state): the mirror draft this tab keeps
 *    (agents/dialogs.ts), the saved agent marked for a database (mirrorOf) that reads one of the profile's servers, a
 *    live database holding the recipe's key that a setup here made (rememberedReports) or a mirror agent writes, or the
 *    database of the recipe's name (sameNamedDb); names as the setup gives them (mirrorTitles); runs of this device /
 *    the team server (read once on first use).
 * Recomputed when something that counts changes — never on typing (content-only page changes are left out), and
 * (fix ui-words) never for a page change the last read did not name: a row's title or values, an unrelated page's title,
 * a database's automations bookkeeping or views, a settings field the lamps do not read. What counts: a page appearing,
 * going, moving or trashed (`structure`), a database page or a page the read named (`watch.ids`), a page taking or
 * leaving a title the setup plans for a report (`watch.bases` / `watch.holders`), a database added / removed or its
 * properties, and the stores below. The status bar's setup cell reads on every route while a setup is open.
 *
 * Browser only (a lazy chunk: the patchbay page, the return chip's body, the arrival).
 */
import { useMemo, useSyncExternalStore } from 'react'
import { useWorkspace } from '../../../store/store'
import { isEffectivelyTrashed } from '../../../store/selectors'
import { ensureRowIndex, onRowsChanged } from '../../../store/rowIndex'
import { localTimeZone } from '../../../store/agents'
import { matchMiss, matchingServers, profileStatus } from '../../../store/integrations'
import type { AgentTrigger, CustomAgent, Database, ID, IntegrationProfile, McpServerConfig, Page, RecipeConfig, Settings } from '../../../store/types'
import { markerHint } from '../../../lib/vault'
import { LANGS, type Lang } from '@/shared/i18n'
import { currentLang, t, useLang } from '../../../i18n'
import { useCloud } from '../../../cloud'
import { aiStatus } from '../../ai/core'
import { offersAI } from '../../ai/setup/AINeedsSetup'
import { readServers, refusedHere, onRefusedChanged, useMcpChecks } from '../../ai/mcp-servers'
import { serverState } from '../../mcp'
import {
  agentTriggerText,
  deviceServers,
  isReadTool,
  loadAgentRuns,
  loadServerRuns,
  mirrorAgentOf,
  mirrorTitles,
  rememberedReports,
  resolveRecipe,
  sameNamedDb,
  useAgentRuns,
  useServerAgents,
  keptDraftFor,
  onKeptDrafts,
  type ResolvedRecipe,
} from '../../agents'
import type { AgentRun } from '../../agents/types'
import type { ModuleKey } from '../types'
import { lampsOf, type KeyFacts, type LampFacts, type LampSet, type ProfileFacts, type ProfileStatusFacts, type RecipeSetup, type ServerFacts } from './lamps'

/* ------------------------------------------------------------------ changes */

const listeners = new Set<() => void>()
let rev = 0
let queued = false
let started = false

/** Something that counts changed: one notification per microtask. */
function bump(): void {
  if (queued) return
  queued = true
  queueMicrotask(() => {
    queued = false
    rev++
    // what the next reads name (until one has read, every page change counts)
    watch.fresh = false
    watch.ids.clear()
    watch.bases.clear()
    watch.holders.clear()
    for (const fn of listeners) fn()
  })
}

/**
 * What the reads since the last bump named (fix ui-words): the page ids (databases found, report pages, trigger
 * databases), the folded beginnings of the report titles a setup plans (`bases`: a page whose title starts with one
 * may take it — the planned title moves on to " (2)"), and the pages holding such a title at the read (`holders`:
 * renamed, the title is free again). `fresh` false: nothing read since the last bump — every page change counts.
 */
const watch = { fresh: false, ids: new Set<ID>(), bases: new Set<string>(), holders: new Set<ID>() }

/** How a title is compared (agents/mirror.ts fold). */
const fold = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase()

/** `{db}`, `{server}` filled in — the rule of agents/integrations/recipe.ts fillTokens (a report name's tokens). */
const fillNames = (text: string, vars: { db: string; server: string }) => text.replace(/\{(db|server)\}/g, (_all, k: 'db' | 'server') => vars[k])

/** A title's beginning the setup's own variants keep (distinctTitle cuts after 24 characters at the earliest). */
const BASE_CHARS = 20

const takesBase = (title: string): boolean => {
  const f = fold(title)
  for (const b of watch.bases) if (f.startsWith(b)) return true
  return false
}

/** May this page change move a lamp? (`id` changed, not its content alone) */
function pageCounts(id: ID, pages: Record<ID, Page>): boolean {
  if (!watch.fresh || watch.ids.has(id) || watch.holders.has(id)) return true
  const p = pages[id]
  if (!p || p.kind === 'database') return true
  // a row's title and values: the setup names no row, and rows never take a report's title (mirror.ts pageTitles)
  if (p.databaseId) return false
  return takesBase(p.title)
}

/** The settings fields the lamps read (the key's marker, the AI rules for aiStatus, the MCP servers). */
const SETTINGS: ReadonlyArray<keyof Settings> = ['aiApiKey', 'aiModel', 'aiKeys', 'ai', 'mcpServers']

/** A database added or removed, or its properties (a recipe's key, a trigger's field) — never automations or views. */
function dbsMoved(next: Record<ID, Database>, prev: Record<ID, Database>): boolean {
  if (next === prev) return false
  let n = 0
  for (const id in next) {
    n++
    const was = prev[id]
    if (!was || was.properties !== next[id].properties) return true
  }
  let m = 0
  for (const id in prev) {
    void id
    m++
  }
  return n !== m
}

/** perf seams (DEV / ?e2e through the setup seam): how often a setup was read */
let reads_ = 0
export const setupStats = (): { reads: number; rev: number } => ({ reads: reads_, rev })

/** When a lamp went from busy to green (by server id: its test) — this tab's traces ("● → ● pressed 16:19"). */
const traces = new Map<ID, number>()

/** Start listening (once): the stores the facts read, never the page map's content. */
function start(): void {
  if (started) return
  started = true
  useWorkspace.subscribe((s, p) => {
    if (s.integrations !== p.integrations || s.agents !== p.agents || s.ai !== p.ai) return bump()
    if (s.settings !== p.settings && SETTINGS.some((k) => s.settings[k] !== p.settings[k])) return bump()
    if (dbsMoved(s.databases, p.databases)) bump()
  })
  ensureRowIndex()
  onRowsChanged((c) => {
    // typing changes a page's content only, a row's cells its values: nothing the lamps read (fix ui-words)
    if (c.reset || c.structure) return bump()
    const pages = useWorkspace.getState().pages
    for (const id of c.changed) if (!c.contentOnly.has(id) && pageCounts(id, pages)) return bump()
  })
  useCloud.subscribe((s, p) => {
    if (s.active !== p.active || s.user !== p.user || s.role !== p.role) bump()
  })
  useMcpChecks.subscribe((s, p) => {
    for (const id of Object.keys(p.running)) {
      if (s.running[id]) continue
      // a test ended: its lamp went green — the trace keeps when
      const srv = readServers().find((x) => x.id === id)
      if (srv && serverState(srv, Date.now(), refusedHere(srv)) === 'ok') traces.set(id, Date.now())
    }
    bump()
  })
  useAgentRuns.subscribe(bump)
  useServerAgents.subscribe((s, p) => {
    // a read that ended without a list (error, an older server) or a workspace switch counts too (fix rest)
    if (s.runs !== p.runs || s.runsState !== p.runsState || s.ws !== p.ws) bump()
  })
  onRefusedChanged(bump)
  onKeptDrafts(bump)
}

const subscribe = (fn: () => void) => {
  start()
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const revNow = () => rev

/* ------------------------------------------------------------------ reading */

/** "Tracker" for the server "tracker" — the same rule as MirrorSetup's default name (agents/mirror.ts nameFromServer). */
const nameFromServer = (server: string) => {
  const s = server.replace(/[-_]+/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}

const recipeIdOf = (r: RecipeConfig) => r.id ?? 'mirror'

/** The servers lamps 01 / 02 speak of: matched by name / host (on or off) — by the tools when the profile names neither. */
export function candidatesOf(p: Pick<IntegrationProfile, 'match'>, servers: McpServerConfig[]): McpServerConfig[] {
  const m = p.match ?? {}
  const byNameHost = !!(m.name || m.host)
  if (!byNameHost && !m.tools?.length) return []
  return servers.filter((s) => {
    const miss = matchMiss(byNameHost ? { name: m.name, host: m.host } : m, { name: s.name, url: s.url, enabled: true, tools: s.tools })
    return !miss || (!byNameHost && miss.kind === 'untested')
  })
}

function keyFacts(): KeyFacts {
  const agents = aiStatus('agents.run')
  const mcp = aiStatus('mcp-setup.inspect')
  const last4 = markerHint(useWorkspace.getState().settings.aiApiKey ?? '')
  if (offersAI(agents) && offersAI(mcp)) return { ok: true, last4 }
  const refused = offersAI(agents) ? mcp : agents
  return { ok: false, why: refused.reason === 'route' ? 'route' : 'no_key', last4 }
}

function serverFacts(s: McpServerConfig, now: number): ServerFacts {
  return {
    id: s.id,
    name: s.name,
    enabled: s.enabled,
    state: serverState(s, now, refusedHere(s)),
    testing: !!useMcpChecks.getState().running[s.id],
    access: s.oauth && s.token ? 'signedIn' : s.token ? 'token' : 'none',
    tools: s.tools ?? null,
    reads: s.tools ? s.tools.filter(isReadTool) : null,
  }
}

/**
 * The run reads this tab asked for, by `<workspace>:<runner>:<agent>` (a workspace switch reads again): `busy` while one
 * is on its way, else when the last one ended without a list (a failed request, an older server, a server agent in a
 * local workspace). A failed read is tried again on a later change that counts — never on the change its own failure
 * made (RETRY_MS), never for an older server (it will not learn the endpoint in this tab).
 */
const reads = new Map<string, { busy: boolean; at: number }>()
const RETRY_MS = 1000

/** No list could be read: lamp 06 says so (not busy) and its key opens the agent page, which reads and polls. */
const UNREADABLE = { total: 0, open: 0, unreadable: true } as const

const runsListOf = (a: CustomAgent): AgentRun[] | undefined => (a.runner === 'server' ? useServerAgents.getState().runs[a.id] : useAgentRuns.getState().byAgent[a.id])

/** This device's runs of a saved agent (its server runs for a server agent): null = being read (read now). */
function runsOf(a: CustomAgent): RecipeSetup['runs'] {
  const list = runsListOf(a)
  if (!list) {
    const active = useCloud.getState().active
    const team = active.kind === 'cloud'
    // a server agent outside a team workspace has no server runs to read
    if (a.runner === 'server' && !team) return UNREADABLE
    if (a.runner === 'server' && useServerAgents.getState().runsState[a.id] === 'unsupported') return UNREADABLE
    const key = `${team ? active.id : 'local'}:${a.runner}:${a.id}`
    const r = reads.get(key)
    if (r?.busy) return null
    if (r && Date.now() - r.at < RETRY_MS) return UNREADABLE
    reads.set(key, { busy: true, at: Date.now() })
    void (a.runner === 'server' ? loadServerRuns(a.id) : loadAgentRuns(a.id))
      .catch(() => {})
      .finally(() => {
        if (runsListOf(a)) reads.delete(key)
        else reads.set(key, { busy: false, at: Date.now() })
        bump()
      })
    return null
  }
  // a skip and a start the Regler held before it began are no runs; a run it stopped keeps its proposals
  const real = list.filter((r) => r.status !== 'skipped' && !(r.status === 'held' && r.held?.kind === 'notStarted'))
  // the proposals still waiting for the person (agents/held.ts openProposals' rule)
  const open = real.reduce((n, r) => n + (r.staged ?? []).filter((c) => c.status === 'pending' || c.status === 'failed' || c.status === 'applying' || c.status === 'held').length, 0)
  const newest = real[0]
  return { total: real.length, open, running: real.some((r) => r.status === 'running'), failed: !!newest && (newest.status === 'error' || newest.status === 'budget') }
}

interface Ctx {
  lang: Lang
  team: boolean
  owner: string | null | undefined
  /** this device's servers matching the profile, on or off (a mirror whose server is off is still its mirror) */
  sources: string[]
  /** the server MirrorSetup preselects (switched on and matching) — names what the setup makes */
  server: string
  /** databases an earlier recipe of the profile claimed */
  claimed: Set<ID>
  /** the folded beginnings of the report titles the recipes plan (fix ui-words: watched) */
  bases: string[]
}

/** The recipe's key property name in every language (a database set up in the other language still fits). */
const keysOf = (profile: IntegrationProfile, recipe: RecipeConfig, lang: Lang) =>
  [lang, ...LANGS.filter((l) => l !== lang)].flatMap((l) => {
    const key = resolveRecipe(profile, recipe, l).properties.find((p) => p.key)
    return key ? [{ name: key.name, lang: l }] : []
  })

/** The recipe's schedule in this browser's time zone (mirrorDraft's). */
function scheduleOf(r: ResolvedRecipe): AgentTrigger {
  const sc = r.agent.schedule
  return { type: 'schedule', every: sc.every, at: sc.at, tz: localTimeZone(), ...(sc.weekday !== undefined ? { weekday: sc.weekday } : {}), ...(sc.day !== undefined ? { day: sc.day } : {}) }
}

/** Which database is the recipe's (null: none yet) — and the agent marked for it when it is in the trash. */
function findDatabase(profile: IntegrationProfile, recipe: RecipeConfig, r: ResolvedRecipe, name: string, c: Ctx): { id: ID; trashed: boolean; marked?: CustomAgent } | null {
  const s = useWorkspace.getState()
  const pages = s.pages
  const live = (id: ID) => !!pages[id] && pages[id].kind === 'database' && !pages[id].trashed && !isEffectivelyTrashed(pages, id)
  // 1. the draft this tab keeps — the newest fact about this recipe
  const kept = keptDraftFor(profile.id, r.recipeId)
  if (kept && live(kept.made.dbId)) return { id: kept.made.dbId, trashed: false }
  // 2. a saved agent marked for a database (mirrorOf) that reads one of the profile's servers (team: the member's own)
  const marked = Object.values(s.agents ?? {})
    .filter((a) => !!a.mirrorOf && (c.owner === undefined || a.createdBy === c.owner) && a.mcpServers.some((x) => c.sources.includes(x)) && !c.claimed.has(a.mirrorOf))
    .sort((a, b) => a.createdAt - b.createdAt)
  for (const a of marked) {
    const id = a.mirrorOf!
    if (live(id)) return { id, trashed: false }
    if (pages[id]?.kind === 'database') return { id, trashed: true, marked: a }
  }
  // 3. a live database holding the recipe's key that a mirror agent writes or a setup here made (by id, never by title)
  const keys = keysOf(profile, recipe, c.lang)
  const holdsKey = (id: ID) => (s.databases[id]?.properties ?? []).some((p) => p.key && keys.some((k) => k.name === p.name))
  const made = Object.keys(s.databases)
    .filter((id) => !c.claimed.has(id) && live(id) && holdsKey(id) && (!!mirrorAgentOf(s.agents, id, c.sources, c.owner, c.team) || rememberedReports(id).length > 0))
    .sort((a, b) => (pages[b]?.createdAt ?? 0) - (pages[a]?.createdAt ?? 0))[0]
  if (made) return { id: made, trashed: false }
  // 4. the database of the recipe's name (MirrorSetup's check): one that holds the key is the recipe's; one in the trash
  //    that a saved agent is marked for too
  const same = sameNamedDb(pages, s.databases, s.agents, name, keys, c.sources, c.team, c.owner)
  if (same && !c.claimed.has(same.id)) {
    if (same.trashed && same.agent) return { id: same.id, trashed: true, marked: s.agents?.[same.agent.id] }
    if (same.fits) return { id: same.id, trashed: false }
  }
  return null
}

function recipeSetup(profile: IntegrationProfile, recipe: RecipeConfig, c: Ctx): RecipeSetup {
  const s = useWorkspace.getState()
  const pages = s.pages
  const r = resolveRecipe(profile, recipe, c.lang)
  const defaultName = r.dbName || nameFromServer(c.server) || r.name
  const db = findDatabase(profile, recipe, r, defaultName, c)
  if (db) c.claimed.add(db.id)
  const kept = keptDraftFor(profile.id, r.recipeId)
  const dbTitle = db ? pages[db.id]?.title.trim() || t('common.untitled') : defaultName
  const saved = db ? (db.trashed ? (db.marked ?? null) : mirrorAgentOf(s.agents, db.id, c.sources, c.owner, c.team)) : null
  const draft = !saved && kept && (!db || kept.made.dbId === db.id) ? kept.made.draft : null
  const titles = mirrorTitles({ recipe: r, server: c.server, name: dbTitle, dbId: db?.id ?? null, reuse: !!db }, { pages, agents: s.agents, team: c.team })
  const livePage = (id: ID | null | undefined): id is ID => !!id && !!pages[id] && !pages[id].trashed && !isEffectivelyTrashed(pages, id)
  // what this read names (fix ui-words): a change elsewhere moves no lamp of it
  if (db) watch.ids.add(db.id)
  if (titles.keptId) watch.ids.add(titles.keptId)
  if (kept) watch.ids.add(kept.made.reportId).add(kept.made.dbId)
  if (saved?.output?.pageId) watch.ids.add(saved.output.pageId)
  const base = fold(fillNames(r.reportName, { db: dbTitle, server: c.server })).slice(0, BASE_CHARS)
  if (base) c.bases.push(base)

  // the report page: the saved agent's, the kept draft's, the one "Use" takes back — else the title it will get
  const reportId = saved ? saved.output?.pageId : draft ? kept!.made.reportId : titles.keptId
  const report = livePage(reportId) ? { id: reportId, title: pages[reportId].title.trim() || t('common.untitled') } : { id: null, title: titles.reportTitle }

  const instructions = saved?.instructions ?? draft?.instructions ?? r.agent.instructions
  const notes = profile.unlocks.includes('notify') && /\bnotify_me\b/.test(instructions)
  const ctx = { pages, databases: s.databases, lang: c.lang }
  const agentOf = (a: CustomAgent) => ({
    name: a.name,
    runner: a.runner,
    trigger: a.trigger,
    write: a.write,
    tools: a.mcpTools?.[a.mcpServers[0] ?? ''] ?? null,
    when: agentTriggerText(t, a.trigger, ctx),
    notes,
    model: a.model ?? null,
    budgetUsd: Number.isFinite(a.maxRunUsd) ? a.maxRunUsd : null,
  })
  let agent: RecipeSetup['agent']
  if (saved) agent = { id: saved.id, ...agentOf(saved) }
  else if (draft) agent = { id: null, draft: draft.id, ...agentOf(draft) }
  else {
    const trigger = scheduleOf(r)
    const tested = readServers().find((x) => x.name === c.server)?.tools
    agent = {
      id: null,
      name: titles.agentName,
      runner: 'browser',
      trigger,
      write: r.agent.write,
      tools: r.agent.tools ?? (tested ? tested.filter(isReadTool) : null),
      when: agentTriggerText(t, trigger, ctx),
      notes,
      model: r.agent.model,
      budgetUsd: r.agent.budget,
      // the database is there (a setup here made it, or it is the recipe's) but no agent was saved: the draft is gone
      ...(db && !db.trashed ? { draftLost: rememberedReports(db.id).length > 0 } : {}),
    }
  }

  return {
    profileId: profile.id,
    recipeId: r.recipeId,
    name: r.name,
    servers: candidatesOf(profile, readServers()).map((x) => ({ id: x.id, name: x.name })),
    database: { id: db?.id ?? null, name: dbTitle, ...(db?.trashed ? { trashed: true } : {}), fields: r.properties.length },
    report,
    agent,
    runs: saved ? runsOf(saved) : null,
  }
}

/** The setup's facts for a profile on this device now (null: no such profile). */
export function readSetup(profileId: string, opts: { lang?: Lang; existing?: ReadonlySet<ModuleKey> } = {}): { profile: ProfileFacts; facts: LampFacts } | null {
  const s = useWorkspace.getState()
  const profile = (s.integrations ?? []).find((p) => p.id === profileId)
  if (!profile) {
    // no such profile: nothing named — an integrations change brings it back
    watch.fresh = true
    return null
  }
  const lang = opts.lang ?? currentLang()
  const now = Date.now()
  const all = readServers(s.settings)
  const cloud = useCloud.getState()
  const team = cloud.active.kind === 'cloud'
  const device = deviceServers(s.settings)
  const servers = candidatesOf(profile, all).map((x) => serverFacts(x, now))
  const status = profileStatus(profile, device) as ProfileStatusFacts
  const c: Ctx = {
    lang,
    team,
    owner: team ? (cloud.user?.id ?? null) : undefined,
    sources: matchingServers(profile, device.map((x) => ({ ...x, enabled: true }))),
    server: matchingServers(profile, device)[0] ?? servers[0]?.name ?? '',
    claimed: new Set(),
    bases: [],
  }
  reads_++
  const recipes = (profile.recipes ?? []).map((r) => recipeSetup(profile, r, c))
  noteBases(c.bases, s.pages)
  const picked = servers.find((x) => x.enabled && x.state === 'ok') ?? servers.find((x) => x.enabled) ?? servers[0]
  const trace = picked ? traces.get(picked.id) : undefined
  return {
    profile: { id: profile.id, name: profile.name, status, unlocks: profile.unlocks.length, recipes },
    facts: { key: keyFacts(), servers, ...(trace ? { traces: { test: trace } } : {}), ...(opts.existing ? { existing: opts.existing } : {}) },
  }
}

/**
 * Watch the report titles a read planned: the beginnings, and the pages holding one now (one walk, at a read only —
 * reads follow a change that counts, never typing). The watch is fresh from here until the next bump.
 */
function noteBases(bases: string[], pages: Record<ID, Page>): void {
  const fresh = bases.filter((b) => !watch.bases.has(b))
  for (const b of fresh) watch.bases.add(b)
  if (fresh.length) {
    for (const id in pages) {
      const p = pages[id]
      if (p.databaseId || !p.title) continue
      const f = fold(p.title)
      if (fresh.some((b) => f.startsWith(b))) watch.holders.add(id)
    }
  }
  watch.fresh = true
}

/** The lamps of a profile now (outside React: the arrival, the seam). */
export function lampsNow(profileId: string, opts: { existing?: ReadonlySet<ModuleKey> } = {}): { profile: ProfileFacts; facts: LampFacts; sets: LampSet[] } | null {
  start()
  const read = readSetup(profileId, opts)
  return read ? { ...read, sets: lampsOf(read.profile, read.facts) } : null
}

/** The lamps of a profile for React — read again when something they read changes (never while someone types). */
export function useSetupLamps(profileId: string | null, opts: { existing?: ReadonlySet<ModuleKey> } = {}): { profile: ProfileFacts; facts: LampFacts; sets: LampSet[] } | null {
  const at = useSyncExternalStore(subscribe, revNow, revNow)
  const lang = useLang()
  const existing = opts.existing
  return useMemo(() => {
    void at
    if (!profileId) return null
    const read = readSetup(profileId, { lang, ...(existing ? { existing } : {}) })
    return read ? { ...read, sets: lampsOf(read.profile, read.facts) } : null
  }, [at, lang, profileId, existing])
}

/** The recipe ids of a profile (in order). */
export const recipeIds = (p: Pick<IntegrationProfile, 'recipes'>): string[] => (p.recipes ?? []).map(recipeIdOf)
