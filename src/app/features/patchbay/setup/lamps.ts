/**
 * The setup lamps (plan §1.11, §3.7, §6 U7 / U26 / U27) — pure. One lamp per step of the setup that exists already:
 *   00 KEY        Claude's key for agents and MCP tests (aiStatus → offersAI) — the last 4 of its vault marker
 *   01 SERVER     a server of this device the profile matches by name / host, switched on, its token not refused
 *   02 TEST       its connection test passed and found what the profile asks for (busy while a test runs)
 *   03 PROFILE    the profile active here (profileStatus) — "n unlocked · m recipes"
 *   04 DATABASE   the recipe's database and report page (MirrorSetup makes them)
 *   05 AGENT      the saved mirror agent (the AgentEditor saves it; a draft lost → MirrorSetup makes it again)
 *   06 FIRST RUN  this device's runs of it: none → run by hand; proposals open → review them; decided → done
 * A profile without a recipe has 00–03; each recipe its own 04–06 after the shared 00–03 (`lampsOf` returns one set
 * per recipe). In a set, the first lamp that is not green is the one the person works on: 'next' (its key is the
 * primary one) or 'busy' (its step runs now); every other lamp that is not green is 'dark' (its key waits: "after 04");
 * green lamps stay green wherever they sit and open their step as a quiet link. A green lamp that falls back (a
 * sign-in ran out) is next again — the lamps are read from the facts each time, never stored.
 *
 * Words are message refs (MsgRef: `features.patchbay.lamp.*`, `<b>` marks the data in a sentence); names in the vars
 * are data (titles, server names). The facts are plain data — setup/facts.ts reads them in the browser, Node specs pass
 * them in. Nothing here imports the store, i18n or CSS.
 */
import type { AgentWriteMode, CustomAgent, ID } from '../../../store/types'
import type { LampAction, LampId, LampState, ModuleKey, MsgRef, RecipeFacts, SetupLamp } from '../types'
import { clockKey, ghostKey } from './keys'

/* ------------------------------------------------------------------ facts */

/** 00 — Claude for agents and MCP tests on this device. */
export interface KeyFacts {
  /** offersAI for both purposes ('agents.run', 'mcp-setup.inspect') */
  ok: boolean
  /** why not: no key at all · only a key of another provider (this work runs on Claude) */
  why?: 'no_key' | 'route' | null
  /** the last 4 characters of the Claude key's vault marker ('' none) */
  last4: string
}

/** One of this device's servers the profile matches by name / host (switched on or off). */
export interface ServerFacts {
  id: ID
  name: string
  enabled: boolean
  /** MCP · Connections' state (connections/model.ts serverState) */
  state: 'off' | 'untested' | 'ok' | 'refusedTest' | 'refusedTab' | 'expired' | 'failed'
  /** a connection test runs now (useMcpChecks) */
  testing: boolean
  /** signed in · a token in the vault · none */
  access: 'signedIn' | 'token' | 'none'
  /** its tools from the last test (null: never tested) */
  tools: string[] | null
  /** the reading tools among them (null: never tested) */
  reads: string[] | null
}

/** The profile on this device (store/integrations.ts profileStatus, as data). */
export type ProfileStatusFacts =
  | { active: true; server: string }
  | { active: false; reason: 'noConditions' | 'noServers' | 'name' | 'host' }
  | { active: false; reason: 'disabled' | 'untested'; server: string }
  | { active: false; reason: 'tools'; server: string; missing: string[] }

/**
 * A recipe as the setup reads it — RecipeFacts (types.ts, the B1 contract) with what the lamps say beyond it (setup
 * track's own optional fields): the draft this tab holds, the trigger in words, the knobs, notes, a run going on.
 */
export interface RecipeSetup extends RecipeFacts {
  agent: RecipeFacts['agent'] & {
    /** the mirror draft this tab holds (dialogs.ts — made by MirrorSetup, not saved yet): 05 opens it in the editor */
    draft?: ID
    /** the trigger in words in the UI's language ("weekdays 07:30") — display data like a name */
    when?: string
    /** it writes notes to the inbox (notify unlocked by the profile and its instructions name notify_me) */
    notes?: boolean
    /** the knobs (null model = Standard, null budget = none) */
    model?: string | null
    budgetUsd?: number | null
  }
  /** B12: the fields the recipe's database gets (a ghost database's window: "24 fields") */
  database: RecipeFacts['database'] & { fields?: number }
  /** `unreadable` (fix rest): no list could be read (a failed request, an older server) — 06 waits on the agent page */
  runs: (NonNullable<RecipeFacts['runs']> & { running?: boolean; failed?: boolean; unreadable?: boolean }) | null
}

export interface ProfileFacts {
  id: string
  name: string
  status: ProfileStatusFacts
  /** the features it names (unlocks) */
  unlocks: number
  /** its recipes in order (setup/facts.ts reads each) */
  recipes: RecipeSetup[]
}

export interface LampFacts {
  key: KeyFacts
  /** this device's servers the profile matches by name / host (no name / host: by its tools), in Settings' order */
  servers: ServerFacts[]
  /** when a lamp last went from busy to green in this tab (by lamp; the trace "busy → ok · pressed 16:19") */
  traces?: Partial<Record<LampId, number>>
  /** module keys on the rack now (a clock another agent shares is no ghost) */
  existing?: ReadonlySet<ModuleKey>
}

export interface LampSet {
  /** the recipe of 04–06 (null: a profile without a recipe — 00–03 only) */
  recipe: string | null
  lamps: SetupLamp[]
  /** green lamps */
  done: number
  /** the lamp the person works on ('next' or 'busy') — null: every lamp green */
  next: SetupLamp | null
}

/* ------------------------------------------------------------------ helpers */

type Raw = { ok: boolean; busy?: boolean; say: MsgRef; action?: LampAction; trace?: number; creates?: ModuleKey[] }

const ref = (key: string, vars?: MsgRef['vars']): MsgRef => (vars ? { key: `features.patchbay.lamp.${key}`, vars } : { key: `features.patchbay.lamp.${key}` })

/** `n` with the `.one` key when it is 1 (the app's plural rule). */
const count = (key: string, n: number, vars: MsgRef['vars'] = {}): MsgRef => ref(n === 1 ? `${key}.one` : key, { ...vars, n })

const LAMP_IDS: LampId[] = ['key', 'server', 'test', 'profile', 'database', 'agent', 'firstRun']

/** The server lamps 01 / 02 speak of: switched on and working first, then switched on, then the first. */
export function pickServer(servers: readonly ServerFacts[]): ServerFacts | null {
  return servers.find((s) => s.enabled && s.state === 'ok') ?? servers.find((s) => s.enabled) ?? servers[0] ?? null
}

/** "query_issues · get_issue · whoami" — the first three tool names. */
const toolNames = (tools: readonly string[]): string => [...tools.slice(0, 3), ...(tools.length > 3 ? ['…'] : [])].join(' · ')

/* ------------------------------------------------------------------ 00–03 */

function keyLamp(f: LampFacts): Raw {
  const action: LampAction = { kind: 'aiSetup', provider: 'anthropic' }
  if (f.key.ok) return { ok: true, say: f.key.last4 ? ref('key.ok', { last4: f.key.last4 }) : ref('key.okNoHint'), action }
  return { ok: false, say: ref(f.key.why === 'route' ? 'key.route' : 'key.none'), action }
}

function serverLamp(p: ProfileFacts, f: LampFacts): Raw {
  const s = pickServer(f.servers)
  if (!s) return { ok: false, say: ref('server.none', { profile: p.name }), action: { kind: 'mcpSettings', add: true } }
  const action: LampAction = { kind: 'mcpSettings', server: s.id }
  if (!s.enabled) return { ok: false, say: ref('server.off', { server: s.name }), action }
  if (s.state === 'expired') return { ok: false, say: ref('server.expired', { server: s.name }), action }
  if (s.state === 'refusedTest' || s.state === 'refusedTab') return { ok: false, say: ref('server.refused', { server: s.name }), action }
  const verb = s.state === 'ok' ? 'connected' : 'set'
  return { ok: true, say: ref(`server.${verb}.${s.access}`, { server: s.name }), action }
}

function testLamp(p: ProfileFacts, f: LampFacts): Raw {
  const s = pickServer(f.servers)
  if (!s) return { ok: false, say: ref('test.noServer') }
  const action: LampAction = { kind: 'mcpTest', server: s.id }
  if (s.testing) return { ok: false, busy: true, say: ref('test.busy', { server: s.name }), action }
  const st = p.status
  if (!s.enabled || s.state === 'untested' || s.state === 'off') return { ok: false, say: ref('test.untested', { server: s.name }), action }
  if (s.state === 'failed') return { ok: false, say: ref('test.failed', { server: s.name }), action }
  if (s.state !== 'ok') return { ok: false, say: ref('test.refused', { server: s.name }), action }
  if (!st.active && st.reason === 'tools' && st.server === s.name) return { ok: false, say: ref('test.missing', { server: s.name, missing: st.missing.join(', ') }), action }
  if (!st.active && st.reason === 'untested' && st.server === s.name) return { ok: false, say: ref('test.untested', { server: s.name }), action }
  const reads = s.reads ?? []
  const say = reads.length ? count('test.ok', reads.length, { tools: toolNames(reads) }) : count('test.okNoReads', s.tools?.length ?? 0)
  return { ok: true, say, action, ...(f.traces?.test ? { trace: f.traces.test } : {}) }
}

function profileLamp(p: ProfileFacts): Raw {
  const action: LampAction = { kind: 'integrations', profile: p.id }
  const st = p.status
  if (st.active) {
    const r = p.recipes.length
    return { ok: true, say: ref(r === 0 ? 'profile.ok.none' : r === 1 ? 'profile.ok.one' : 'profile.ok', { unlocked: p.unlocks, n: r }), action }
  }
  switch (st.reason) {
    case 'disabled':
    case 'untested':
      return { ok: false, say: ref(`profile.${st.reason}`, { profile: p.name, server: st.server }), action }
    case 'tools':
      return { ok: false, say: ref('profile.tools', { profile: p.name, server: st.server, missing: st.missing.join(', ') }), action }
    default:
      return { ok: false, say: ref(`profile.${st.reason}`, { profile: p.name }), action }
  }
}

/* ------------------------------------------------------------------ 04–06 */

/** The ghosts a recipe's lamps turn real (keys.ts): 01 the server, 04 the database + report page, 05 the agent + its clock. */
export function createsOf(p: Pick<ProfileFacts, 'id'>, r: RecipeSetup, f: Pick<LampFacts, 'servers' | 'existing'>): Partial<Record<LampId, ModuleKey[]>> {
  const out: Partial<Record<LampId, ModuleKey[]>> = {}
  if (!f.servers.length) out.server = [ghostKey(p.id, r.recipeId, 'server')]
  const db: ModuleKey[] = []
  if (!r.database.id || r.database.trashed) db.push(ghostKey(p.id, r.recipeId, 'database'))
  if (!r.report.id) db.push(ghostKey(p.id, r.recipeId, 'page'))
  if (db.length) out.database = db
  if (!r.agent.id) {
    const clock = clockKey(r.agent.trigger)
    out.agent = [ghostKey(p.id, r.recipeId, 'agent'), ...(clock && !f.existing?.has(clock) ? [clock] : [])]
  }
  return out
}

function databaseLamp(p: ProfileFacts, r: RecipeSetup): Raw {
  const action: LampAction = { kind: 'mirrorSetup', profile: p.id, recipe: r.recipeId }
  const vars = { db: r.database.name, report: r.report.title }
  // fix (rest): the setup opens on the database the lamp means — by its name now (MirrorSetup finds one in the trash by name)
  if (r.database.id && r.database.trashed) return { ok: false, say: ref('database.trashed', vars), action: { ...action, name: r.database.name } }
  if (r.database.id) return { ok: true, say: ref(r.report.id ? 'database.ok' : 'database.okNoReport', vars), action }
  return { ok: false, say: ref('database.make', vars), action }
}

const tabOnly = (runner: CustomAgent['runner']) => runner === 'browser'

function agentLamp(p: ProfileFacts, r: RecipeSetup): Raw {
  const a = r.agent
  const vars = { agent: a.name, when: a.when ?? '' }
  const tab = tabOnly(a.runner) ? 'Tab' : ''
  if (a.id) return { ok: true, say: ref(`agent.ok${tab}`, vars), action: { kind: 'agentEditor', agent: a.id } }
  if (a.draft) return { ok: false, say: ref(`agent.draft${tab}`, vars), action: { kind: 'agentEditor', agent: a.draft } }
  // the database is there but no agent was saved for it: MirrorSetup makes the draft again ("Use …")
  const mirror: LampAction = { kind: 'mirrorSetup', profile: p.id, recipe: r.recipeId }
  if (a.draftLost) return { ok: false, say: ref('agent.lost', vars), action: mirror }
  return { ok: false, say: ref(`agent.later${tab}`, vars), action: mirror }
}

/** proposals first (stage): the first run's proposals are reviewed — apply mode writes directly */
const proposes = (w: AgentWriteMode) => w === 'stage'

function firstRunLamp(r: RecipeSetup): Raw {
  const a = r.agent
  if (!a.id) return { ok: false, say: ref(proposes(a.write) ? 'firstRun.later' : 'firstRun.laterDirect') }
  const run: LampAction = { kind: 'runAgent', agent: a.id }
  const review: LampAction = { kind: 'review', agent: a.id }
  const runs = r.runs
  if (!runs) return { ok: false, busy: true, say: ref('firstRun.reading'), action: review }
  if (runs.unreadable) return { ok: false, say: ref('firstRun.unreadable', { agent: a.name }), action: review }
  if (runs.running) return { ok: false, busy: true, say: ref('firstRun.running', { agent: a.name }), action: review }
  if (runs.open > 0) return { ok: false, say: count('firstRun.review', runs.open), action: review }
  if (runs.total === 0) return { ok: false, say: ref(proposes(a.write) ? 'firstRun.start' : 'firstRun.startDirect'), action: run }
  if (runs.failed) return { ok: false, say: ref('firstRun.failed', { agent: a.name }), action: review }
  return { ok: true, say: count('firstRun.ok', runs.total), action: review }
}

/* ------------------------------------------------------------------ the sets */

/** Number, id, state — the first lamp that is not green is the one worked on, every other one waits (dark). */
function sequence(raw: Raw[], recipe: string | null): LampSet {
  let current: SetupLamp | null = null
  const lamps = raw.map((x, n): SetupLamp => {
    let state: LampState
    if (x.ok) state = 'ok'
    else if (!current) state = x.busy ? 'busy' : 'next'
    else state = 'dark'
    const lamp: SetupLamp = { n: n as SetupLamp['n'], id: LAMP_IDS[n], state, say: x.say }
    if (n >= 4 && recipe) lamp.recipe = recipe
    // a dark lamp's key waits ("after 04"): no action until it is the one worked on
    if (x.action && state !== 'dark') lamp.action = x.action
    if (x.trace && state === 'ok') lamp.trace = { from: 'busy', to: 'ok', at: x.trace }
    if (x.creates?.length) lamp.creates = x.creates
    if (!x.ok && !current) current = lamp
    return lamp
  })
  return { recipe, lamps, done: lamps.filter((l) => l.state === 'ok').length, next: current }
}

/**
 * The lamps of a profile on this device: one set per recipe (00–06), or 00–03 alone for a profile without a recipe.
 * Exactly one lamp per set is worked on ('next' or 'busy') until every lamp is green.
 */
export function lampsOf(p: ProfileFacts, f: LampFacts): LampSet[] {
  const base = [keyLamp(f), serverLamp(p, f), testLamp(p, f), profileLamp(p)]
  if (!p.recipes.length) return [sequence(base, null)]
  return p.recipes.map((r) => {
    const creates = createsOf(p, r, f)
    const raw = [...base.map((x, i) => (i === 1 && creates.server ? { ...x, creates: creates.server } : x)), databaseLamp(p, r), agentLamp(p, r), firstRunLamp(r)]
    if (creates.database) raw[4] = { ...raw[4], creates: creates.database }
    if (creates.agent) raw[5] = { ...raw[5], creates: creates.agent }
    return sequence(raw, r.recipeId)
  })
}

/** The set of one recipe (null / unknown: the first set). */
export function setOf(sets: readonly LampSet[], recipe?: string | null): LampSet | null {
  return (recipe ? sets.find((s) => s.recipe === recipe) : undefined) ?? sets[0] ?? null
}

/**
 * The label of a lamp's key (`features.patchbay.setup.key.*`): the next lamp's primary key says its step ("Create
 * database", "Set up again" for a lost draft); a green lamp's quiet link says "Open"; a dark lamp's key says nothing of
 * its own (the band writes "after 04").
 */
export function keyLabel(lamp: SetupLamp): MsgRef | null {
  const a = lamp.action
  if (!a || lamp.state === 'dark') return null
  const k = (key: string): MsgRef => ({ key: `features.patchbay.setup.key.${key}` })
  if (lamp.state === 'ok') return k('open')
  switch (a.kind) {
    case 'aiSetup':
      return k('key')
    case 'mcpSettings':
      return k(a.add ? 'serverAdd' : 'server')
    case 'mcpTest':
      return k('test')
    case 'integrations':
      return k('profile')
    case 'mirrorSetup':
      return k(lamp.id === 'agent' ? 'agentAgain' : lamp.say.key.endsWith('.trashed') ? 'databaseOpen' : 'database')
    case 'agentEditor':
      return k('agent')
    case 'runAgent':
      return k('firstRun')
    case 'review':
      return k('review')
  }
}
