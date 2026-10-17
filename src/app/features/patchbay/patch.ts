/**
 * Patching (P4) — the pure core (plan §1.13 / §2.9, B15). A patch (plug a cable from one jack into another, or unplug
 * one) means only what an existing writer can write — `upsertAgent`, `saveDbCommands`, `saveAutomations` and
 * `upsertIntegration` — and is planned here without touching any store:
 *
 *   plan(patch, ctx) → { writes, inverse, preview, asks?, notes?, opens? } | { refused, info?, open? }
 *
 * `writes` / `inverse` are PatchWrites over the STORED objects (the store's own agent record spread — Unreadable route /
 * review / saver / applyOn stay as they are; a database's full automation and command lists, bookkeeping kept), so the
 * inverse is the exact previous value. `preview` is the model input with the writes applied, built by the very same
 * pure core as the app's (source.ts toModelInput) — the "+F2" a plug would open comes from the model built on it
 * (`opens`, asked as patch.opensFuse). Nothing is written here: commitWrites() (below) writes a plan's writes through a
 * sink under the caller's writer frame (the app's sink: patchApply.ts, `you~patchbay`; its Undo `you~undo`), and
 * undoPlan() re-reads the targets first — a config field changed since the patch refuses ("changed since").
 *
 * The compatibility matrix (§2.9 — what a cable means):
 *   clock start → agent start                 trigger = that schedule
 *   row trigger / § 01 net flag → agent start trigger = row_created / row_changed { db, prop } (deleted rows: refused)
 *   row trigger / net flag → automation start the automation's trigger — its own database only, never on a locked one
 *   database rows → agent / script start      an own command { kind 'agent' | 'script' } (not when the default "Run
 *                                             <agent> now" is there — info; never on a locked database)
 *   server READ → agent tools                 mcpServers += s, mcpTools[s] = its READ tools
 *   server WRITE? → agent tools               mcpServers += s, every tool (the allow-list goes) — "+Fn" asks first
 *   agent writes / everything → database      scope.databases += db (an everything scope has it already — info)
 *   agent report → page                       output = { pageId, mode } (a private page for a shared agent: refused)
 *   automation out → script start             actions += run_script — never on a locked database
 *   a server tool → the Outbox (OUT lock)     profile.outTools += tool — owners / admins, a profile matching the
 *                                             server by name / address, ≤ 20 tools
 *   anything → a way out                      refused: "Ways out are made in their editor" (+ ↵ opens it)
 * Unplug writes the inverse of a cable: trigger → manual (the last start of an enabled agent asks), scope − db (never a
 * mirror's own database), mcpServers − s (READ) or narrowed to READ (WRITE?), an automation switched off (its start)
 * or its run_script / webhook / set_property action removed, an own command (or its action) removed, outTools − tool.
 * Removals stay allowed on a locked database's automations (§1.14), never on its commands (the lock blocks them).
 *
 * Before any plan: viewers and read-only workspaces are refused; the agent editor's own save checks run on the changed
 * agent for the fields the patch touches (agents/saveChecks.ts — never saving against a page in the trash); a target in
 * the trash is named in gone.ts' words; a mirror agent is never unplugged from its `mirrorOf` database and asks before
 * its tool list changes (adding a server it does not use yet widens it too); a team browser agent another member made says
 * "<creator> must confirm the agent afterwards" — and its creator's own patch on it while it waits for their confirm is
 * refused (a save as theirs would confirm the other member's change unseen: confirm it in the editor first); a change
 * past the agent's limits (AGENT_LIMITS: servers, scope, tools per server) is refused with the limit, never cut.
 * commitPlan() re-reads every target before it writes: one changed since the plan refuses ("changed since").
 *
 * Pure and Node-loadable (the specs plan against fixtures): the agents area through its dependency-free leaves only
 * (saveChecks.ts, gone.ts), the store's pure modules, the automations reader.
 */
import { agentSaveIssues, type AgentSaveField } from '../agents/saveChecks'
import { seesAllPagesOf } from '../agents/gone'
import { AGENT_LIMITS, sanitizeAgent } from '../../store/agents'
import { hostOf, sameIntegration, sanitizeIntegration, sanitizeIntegrations, serverMatch, SEND_LIMITS, TOOL_NAME } from '../../store/integrations'
import { withWriter, type Writer } from '../../store/writer'
import { automationConfigOf, lockRefusal, readAutomations } from '../automations/read'
import type { Automation, AutomationAction, AutomationTrigger, CustomAgent, Database, DbCommand, ID, IntegrationProfile } from '../../store/types'
import { buildModel } from './model'
import { kindOfKey, moduleKey, scheduleKey } from './ref'
import { serverToolGroups, toolUse } from './tools'
import { stable, toModelInput, type InputReaders, type InputSource } from './source'
import type { JackRole, Model, ModelInput, Module, ModuleKey, ModuleKind, ModuleRef, MsgRef, OpenTarget, Patch, PatchEnd, PatchPlan, PatchWrite, Place } from './types'

const P = 'features.patchbay'
const PP = `${P}.patch`

/* ------------------------------------------------------------------ the context */

/** What a plan reads: the workspace + this device (the app: inputs.ts readSource / APP_READERS; specs: fixtures). */
export interface PatchCtx {
  src: InputSource
  read: InputReaders
  /** the input built from `src` (the memo's) and its model — passed when the caller holds them, else built here */
  input?: ModelInput
  model?: Model
  /** a new own command's id (lib/ids newId; specs pass a fixed one) */
  newId: () => string
  /** commands' hasDefaultCommand: "Run <agent> now" is in the database's menu already (computed, never stored) */
  hasDefaultCommand: (db: ID, agentId: ID, ws: { databases: Record<ID, Database>; agents?: Record<ID, CustomAgent> }) => boolean
  /** owners / admins by name (team) — the OUT lock's refusal names them */
  admins?: string[]
}

interface Env {
  ctx: PatchCtx
  input: ModelInput
  model: Model
  mods: Map<ModuleKey, Module>
  team: boolean
  me: string | null
}

function envOf(ctx: PatchCtx): Env {
  const input = ctx.input ?? toModelInput(ctx.src, ctx.read).input
  const model = ctx.model ?? buildModel(input)
  return { ctx, input, model, mods: new Map(model.modules.map((m) => [m.key, m])), team: input.ctx.team, me: input.ctx.me }
}

/* ------------------------------------------------------------------ the matrix */

/** Every cable patching may plug: [from kind, from role] → [to kind, to role] ('net' = a § 01 net flag). */
export const PATCH_MATRIX: ReadonlyArray<{ from: [ModuleKind | 'net', JackRole]; to: [ModuleKind, JackRole] }> = [
  { from: ['clock', 'start'], to: ['agent', 'start'] },
  { from: ['rowTrigger', 'start'], to: ['agent', 'start'] },
  { from: ['net', 'start'], to: ['agent', 'start'] },
  { from: ['rowTrigger', 'start'], to: ['automation', 'start'] },
  { from: ['net', 'start'], to: ['automation', 'start'] },
  { from: ['database', 'rows'], to: ['agent', 'start'] },
  { from: ['database', 'rows'], to: ['script', 'start'] },
  { from: ['server', 'read'], to: ['agent', 'tools'] },
  { from: ['server', 'write'], to: ['agent', 'tools'] },
  { from: ['agent', 'writes'], to: ['database', 'writes'] },
  { from: ['agent', 'everything'], to: ['database', 'writes'] },
  { from: ['agent', 'report'], to: ['page', 'writes'] },
  { from: ['automation', 'out'], to: ['script', 'start'] },
  // Orders B10: the person's server for the planner — its READ tools only (never a write tool, never the "All AI calls" set)
  { from: ['server', 'read'], to: ['planner', 'tools'] },
]

const kindOfEnd = (e: PatchEnd): ModuleKind | 'net' | null => (e.module.startsWith('net:') ? 'net' : kindOfKey(e.module))

/**
 * May a cable go from `from` to `to` (kinds and roles only — no rules, no store)? The OUT lock (a server tool onto the
 * Outbox) counts; a way out never does (it is refused with its reason when dropped).
 */
export function canConnect(from: PatchEnd, to: PatchEnd): boolean {
  const fk = kindOfEnd(from)
  const tk = kindOfEnd(to)
  if (!fk || !tk || tk === 'net') return false
  if (fk === 'server' && from.tool && tk === 'outbox') return true
  return PATCH_MATRIX.some((r) => r.from[0] === fk && r.from[1] === from.role && r.to[0] === tk && r.to[1] === to.role)
}

/** The roles a target jack accepts (Jack.patch, §2.2) — for the accept highlight. */
export function acceptsRoles(kind: ModuleKind, role: JackRole): JackRole[] {
  return [...new Set(PATCH_MATRIX.filter((r) => r.to[0] === kind && r.to[1] === role).map((r) => r.from[1]))]
}

/** The target ends on the rack a cable from `from` may go to (the "Connect to …" picker and the lit jacks, B16). */
export function targetsOf(from: PatchEnd, model: Model): PatchEnd[] {
  const out: PatchEnd[] = []
  for (const m of model.modules) {
    if (m.tags.includes('ghost')) continue
    for (const role of ['start', 'tools', 'writes'] as JackRole[]) {
      const to = { module: m.key, role }
      if (to.module !== from.module && canConnect(from, to)) out.push(to)
    }
    if (m.kind === 'outbox' && from.tool && canConnect(from, { module: m.key, role: 'send' })) out.push({ module: m.key, role: 'send' })
  }
  return out
}

/* ------------------------------------------------------------------ ends */

type End =
  | { at: 'net'; key: string; db: ID; prop: string; role: JackRole }
  | { at: 'module'; key: ModuleKey; kind: ModuleKind; ref: ModuleRef | null; module: Module | null; role: JackRole; tool?: string }

const dec = (p: string | undefined): string | null => {
  if (p === undefined || p === '-' || p === '') return null
  try {
    return decodeURIComponent(p)
  } catch {
    return null
  }
}

/** A module's ref from its key alone (a module not on the rack yet: a database nobody writes, a folded script …). */
function refOfKey(env: Env, key: ModuleKey): ModuleRef | null {
  const kind = kindOfKey(key)
  const p = key.split(':').slice(1).map(dec)
  switch (kind) {
    case 'database':
    case 'page':
    case 'script':
    case 'agent':
      return p[0] ? ({ kind, id: p[0] } as ModuleRef) : null
    case 'automation':
      return p[0] && p[1] ? { kind, db: p[0], id: p[1] } : null
    case 'outbox':
      return p[0] ? { kind, profile: p[0], route: p[1] ?? '', db: null } : null
    case 'rowTrigger':
      return p[0] && (p[1] === 'created' || p[1] === 'changed' || p[1] === 'deleted') ? { kind, db: p[0], event: p[1], prop: p[2] ?? null } : null
    case 'server':
      if (p[0] === 'rt') return p[1] ? { kind, id: null, name: p[1], runtime: true } : null
      return p[0] ? { kind, id: p[0], name: env.input.servers.find((s) => s.server.id === p[0])?.server.name ?? '' } : null
    default:
      return null
  }
}

function endOf(env: Env, e: PatchEnd): End | null {
  if (e.module.startsWith('net:')) {
    const [, db, prop] = e.module.split(':')
    const d = dec(db)
    const pr = prop === '*' || prop === '+row' || prop === '-row' ? prop : dec(prop)
    return d && pr ? { at: 'net', key: e.module, db: d, prop: pr, role: e.role } : null
  }
  const kind = kindOfKey(e.module)
  if (!kind) return null
  const module = env.mods.get(e.module) ?? null
  const ref = module?.ref ?? refOfKey(env, e.module)
  return { at: 'module', key: e.module, kind, ref, module, role: e.role, ...(e.tool !== undefined ? { tool: e.tool } : {}) }
}

/* ------------------------------------------------------------------ helpers */

const refuse = (key: string, vars?: MsgRef['vars'], extra: { open?: OpenTarget } = {}): PatchPlan => ({ refused: vars ? { key, vars } : { key }, ...extra })
const info = (key: string, vars?: MsgRef['vars']): PatchPlan => ({ refused: vars ? { key, vars } : { key }, info: true })
const isRefusal = (p: PatchPlan): p is Extract<PatchPlan, { refused: MsgRef }> => 'refused' in p

const agentKey = (id: ID) => moduleKey({ kind: 'agent', id })
const agentOpen = (id: ID): OpenTarget => ({ to: 'route', route: { name: 'agents', id } })
const openOfEnd = (e: End): OpenTarget | undefined => (e.at === 'module' ? (e.module?.open ?? undefined) : undefined)

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** The stored agent record (the store's own object — Unreadable fields as they are), else the model's sanitized copy. */
function storedAgent(env: Env, id: ID): CustomAgent | null {
  const raw = env.ctx.src.ws.agents?.[id]
  if (isObj(raw) && raw.id === id) return raw as unknown as CustomAgent
  return env.input.agents.find((a) => a.agent.id === id)?.agent ?? null
}

/** A database's stored automations as every reader takes them (bookkeeping kept). */
const storedAutomations = (env: Env, db: ID): Automation[] => env.ctx.read.automations(env.ctx.src.ws.databases[db]?.automations)
/** A database's stored command list (defaults' entries kept: order, switched-off defaults). */
const storedCommands = (env: Env, db: ID): DbCommand[] => env.ctx.read.commands(env.ctx.src.ws.databases[db]?.commands)
const liveDb = (env: Env, id: ID) => env.input.databases.find((d) => d.id === id) ?? null

/**
 * A target in the trash or gone, in gone.ts' words (features.agents.lost.*) — null while it is live. The titles go
 * trimmed; a blank one is said as the untitled word (plain.ts sayMsg: a blank `title` / `parent`), never as empty quotes.
 */
function lostRef(env: Env, id: ID, database: boolean): MsgRef | null {
  const f = env.input.pages[id]
  if (!f) return { key: database ? 'features.agents.lost.gone.database' : 'features.agents.lost.gone.page' }
  if (!f.trashed && !f.gone) return null
  const title = f.title.trim()
  if (!f.trashed && f.root) return { key: 'features.agents.lost.below', vars: { title, parent: f.root.title.trim() } }
  return { key: 'features.agents.lost.trashed', vars: { title } }
}

/** The agent editor's save checks on the changed agent, for the fields the patch touches — the first issue, or null. */
function agentIssue(env: Env, draft: CustomAgent, fields: AgentSaveField[]): MsgRef | null {
  const issues = agentSaveIssues(draft, { pages: env.input.pages, seesAll: seesAllPagesOf(draft, env.team, env.me), serverOk: true, inCloud: env.team, lang: 'en' })
  for (const f of fields) {
    const first = issues[f]?.[0]
    if (!first) continue
    // a sentence over a list of titles (several pages lost): said with their count — the list is the editor's words
    if (first.titles) return { key: `${PP}.scopeLost`, vars: { agent: agentKey(draft.id), n: first.titles.length } }
    return first.vars ? { key: first.key, vars: first.vars } : { key: first.key }
  }
  return null
}

/** Team: a browser agent another member made waits for its creator after any change (awaitsConfirm). */
function creatorNote(env: Env, a: CustomAgent): MsgRef | null {
  if (!env.team || a.runner !== 'browser' || (a.createdBy && a.createdBy === env.me)) return null
  return { key: `${P}.key.confirmAfter`, vars: { creator: a.createdBy ?? '' } }
}

/**
 * Team: the creator's own browser agent waits for their confirm (another member changed it last — agents/confirm.ts). A
 * patch is a save as the creator (upsertAgent stamps the saver), so it would confirm that change unseen: refused — the
 * creator confirms the settings they see in the editor first (`open` = the agent). The same holds for an Undo that
 * would write another member's version back as the creator's.
 */
function waitsForMe(team: boolean, me: string | null, a: Pick<CustomAgent, 'runner' | 'createdBy' | 'updatedBy'>): boolean {
  return team && !!me && a.runner === 'browser' && !!a.createdBy && a.createdBy === me && !!a.updatedBy && a.updatedBy !== a.createdBy
}
const confirmFirst = (a: CustomAgent): MsgRef => ({ key: `${PP}.confirmFirst`, vars: { agent: agentKey(a.id), member: a.updatedBy ?? '' } })

/** A change past the agent's limits (the sanitizer would cut it — the plan would read as written while nothing is): refused with the limit. */
function overLimit(next: CustomAgent): MsgRef | null {
  const agent = agentKey(next.id)
  if (next.mcpServers.length > AGENT_LIMITS.mcpServers) return { key: `${PP}.limitServers`, vars: { agent, n: AGENT_LIMITS.mcpServers } }
  if (next.scope.pages.length + next.scope.databases.length > AGENT_LIMITS.scope) return { key: `${PP}.limitScope`, vars: { agent, n: AGENT_LIMITS.scope } }
  for (const list of Object.values(next.mcpTools ?? {})) if (list.length > AGENT_LIMITS.mcpTools) return { key: `${PP}.limitTools`, vars: { agent, n: AGENT_LIMITS.mcpTools } }
  return null
}

/** The workspace with the writes applied (the preview's source). */
function applied(env: Env, writes: PatchWrite[]): InputSource {
  const src = env.ctx.src
  const ws = { ...src.ws }
  for (const w of writes) {
    if (w.w === 'agent') {
      // what upsertAgent stamps: in a team the saver (a browser agent another member made then waits for its creator)
      const agent = env.team && env.me ? { ...w.agent, updatedBy: env.me } : w.agent
      ws.agents = { ...(ws.agents ?? {}), [w.agent.id]: agent }
    } else if (w.w === 'automations' || w.w === 'commands') {
      const db = ws.databases[w.db]
      if (db) ws.databases = { ...ws.databases, [w.db]: { ...db, [w.w]: w.list } }
    } else if (w.w === 'orders') {
      // Orders B10: the planner's server (the rest of the work orders' config as stored)
      const db = ws.databases[w.db]
      const cfg = db?.orders
      if (db && cfg && typeof cfg === 'object') ws.databases = { ...ws.databases, [w.db]: { ...db, orders: { ...cfg, server: w.server ? { name: w.server } : null } } }
    } else {
      const list = sanitizeIntegrations(ws.integrations).integrations
      const at = list.findIndex((p) => p.id === (w.replaces ?? w.profile.id))
      const next = list.filter((p) => p.id !== w.profile.id && p.id !== w.replaces)
      next.splice(at >= 0 ? at : next.length, 0, w.profile)
      ws.integrations = next
    }
  }
  return { ...src, ws }
}

/** The open fuses the preview has that the rack now has not (labels as the preview numbers them). */
function opened(env: Env, preview: ModelInput): Array<{ key: string; label: string }> {
  const open = (m: Model) => (m.fuses as Array<Model['fuses'][number] & { allowed?: { state: string } }>).filter((f) => f.allowed?.state !== 'allowed')
  const before = new Set(open(env.model).map((f) => f.key))
  return open(buildModel(preview))
    .filter((f) => !before.has(f.key))
    .map((f) => ({ key: f.key, label: f.label }))
}

/** A plan that writes: its preview, the fuses it opens (asked first), its notes. */
function done(env: Env, writes: PatchWrite[], inverse: PatchWrite[], extra: { asks?: MsgRef[]; notes?: Array<MsgRef | null> } = {}): PatchPlan {
  const preview = toModelInput(applied(env, writes), env.ctx.read).input
  const opens = opened(env, preview)
  const asks = [...(extra.asks ?? []), ...opens.map((f) => ({ key: `${PP}.opensFuse`, vars: { f: f.label } }))]
  const notes = (extra.notes ?? []).filter((n): n is MsgRef => !!n)
  return { writes, inverse, preview, ...(asks.length ? { asks } : {}), ...(notes.length ? { notes } : {}), ...(opens.length ? { opens } : {}) }
}

/** An agent patch: the changed stored record, the touched fields' save checks, the team note. */
function agentPatch(env: Env, stored: CustomAgent, next: CustomAgent, fields: AgentSaveField[], extra: { asks?: MsgRef[]; notes?: Array<MsgRef | null> } = {}): PatchPlan {
  if (waitsForMe(env.team, env.me, stored)) return { refused: confirmFirst(stored), open: agentOpen(stored.id) }
  const limit = overLimit(next)
  if (limit) return { refused: limit, open: agentOpen(stored.id) }
  const issue = agentIssue(env, next, fields)
  if (issue) return { refused: issue, open: agentOpen(stored.id) }
  return done(env, [{ w: 'agent', agent: next }], [{ w: 'agent', agent: stored }], { asks: extra.asks, notes: [...(extra.notes ?? []), creatorNote(env, stored)] })
}

/** An automations patch: refused on a locked database unless it only removes capability (§1.14). */
function automationsPatch(env: Env, db: ID, before: Automation[], after: Automation[], extra: { asks?: MsgRef[] } = {}): PatchPlan {
  if (env.ctx.src.ws.databases[db]?.locked && lockRefusal(before, after)) return refuse(`${P}.key.locked`)
  return done(env, [{ w: 'automations', db, list: after }], [{ w: 'automations', db, list: before }], extra)
}

/** A command list patch: never on a locked database (saveDbCommands refuses it). */
function commandsPatch(env: Env, db: ID, before: DbCommand[], after: DbCommand[]): PatchPlan {
  if (env.ctx.src.ws.databases[db]?.locked) return refuse(`${P}.key.locked`)
  return done(env, [{ w: 'commands', db, list: after }], [{ w: 'commands', db, list: before }])
}

/** The row event and field of a § 01 start: a row trigger, or a net flag (`+row` new rows, `-row` deleted, `*` any field). */
function rowOf(e: End): { db: ID; event: 'created' | 'changed' | 'deleted'; prop: ID | null } | null {
  if (e.at === 'net') return { db: e.db, event: e.prop === '+row' ? 'created' : e.prop === '-row' ? 'deleted' : 'changed', prop: e.prop === '*' || e.prop === '+row' || e.prop === '-row' ? null : e.prop }
  if (e.ref?.kind !== 'rowTrigger') return null
  return { db: e.ref.db, event: e.ref.event, prop: e.ref.prop === '*' ? null : e.ref.prop }
}

const sameTrigger = (a: unknown, b: unknown) => stable(a) === stable(b)

/* ------------------------------------------------------------------ plan */

/** Plan a patch (pure): what it writes and how to undo it — or why it is refused (with `info` when nothing is to do). */
export function plan(patch: Patch, ctx: PatchCtx): PatchPlan {
  const env = envOf(ctx)
  if (env.input.ctx.readOnly || env.input.ctx.role === 'viewer') return refuse(`${P}.key.readOnly`)
  const from = endOf(env, patch.from)
  const to = endOf(env, patch.to)
  if (!from || !to) return refuse(`${PP}.gone`)
  return patch.op === 'unplug' ? unplug(env, patch, from, to) : plug(env, from, to)
}

function plug(env: Env, from: End, to: End): PatchPlan {
  if (from.at === 'module' && from.kind === 'server' && from.tool !== undefined && to.at === 'module' && to.kind === 'outbox') return outLock(env, from, to)
  // no new way out by patching (§1.13): made in their editor, with its URL and headers
  if (to.at === 'module' && (to.kind === 'outbound' || to.kind === 'outbox')) return refuse(`${PP}.noOut`, undefined, openOfEnd(to) ? { open: openOfEnd(to) } : {})
  if (to.at !== 'module') return refuse(`${PP}.noMatch`)
  const fk = from.at === 'net' ? 'net' : from.kind
  switch (`${fk}.${from.role}>${to.kind}.${to.role}`) {
    case 'clock.start>agent.start':
      return clockToAgent(env, from, to)
    case 'rowTrigger.start>agent.start':
    case 'net.start>agent.start':
      return rowToAgent(env, from, to)
    case 'rowTrigger.start>automation.start':
    case 'net.start>automation.start':
      return rowToAutomation(env, from, to)
    case 'database.rows>agent.start':
    case 'database.rows>script.start':
      return commandTo(env, from, to)
    case 'server.read>agent.tools':
      return toolsToAgent(env, from, to, 'read')
    case 'server.write>agent.tools':
      return toolsToAgent(env, from, to, 'write')
    case 'agent.writes>database.writes':
    case 'agent.everything>database.writes':
      return scopeAdd(env, from, to)
    case 'agent.report>page.writes':
      return reportTo(env, from, to)
    case 'automation.out>script.start':
      return runScriptAdd(env, from, to)
    case 'server.read>planner.tools':
      return serverToPlanner(env, from, to)
  }
  return refuse(`${PP}.noMatch`)
}

/**
 * Orders B10: the planner's server (`Database.orders.server`, saveOrderConfig — the work orders' own writer): the
 * person's server by its name; its read tools only reach the planner (planner.ts). One server at a time: plugging
 * another replaces it; unplugging leaves none ("without a server" — a valid state).
 */
function plannerOf(env: Env, e: End): { db: ID; server: string | null } | null {
  const db = e.at === 'module' && e.ref?.kind === 'planner' ? e.ref.db : null
  const o = db ? env.input.orders?.find((x) => x.db === db) : undefined
  return db && o?.config ? { db, server: o.config.server } : null
}

function serverToPlanner(env: Env, from: End, to: End): PatchPlan {
  const server = from.at === 'module' && from.ref?.kind === 'server' ? from.ref : null
  const pl = plannerOf(env, to)
  if (!server || server.runtime || !server.id || !pl) return refuse(`${PP}.gone`)
  if (env.ctx.src.ws.databases[pl.db]?.locked) return refuse(`${P}.key.locked`)
  if (pl.server === server.name) return info(`${PP}.already`)
  return done(env, [{ w: 'orders', db: pl.db, server: server.name }], [{ w: 'orders', db: pl.db, server: pl.server }])
}

function plannerServerOff(env: Env, from: End, to: End): PatchPlan {
  const server = from.at === 'module' && from.ref?.kind === 'server' ? from.ref : null
  const pl = plannerOf(env, to)
  if (!server || !pl || pl.server !== server.name) return refuse(`${PP}.gone`)
  if (env.ctx.src.ws.databases[pl.db]?.locked) return refuse(`${P}.key.locked`)
  return done(env, [{ w: 'orders', db: pl.db, server: null }], [{ w: 'orders', db: pl.db, server: pl.server }])
}

const agentOf = (e: End): ID | null => (e.at === 'module' && e.ref?.kind === 'agent' ? e.ref.id : null)

function clockToAgent(env: Env, from: End, to: End): PatchPlan {
  const ref = from.at === 'module' && from.ref?.kind === 'clock' ? from.ref : null
  const id = agentOf(to)
  if (!ref || !id) return refuse(`${PP}.gone`)
  // a repeating template's clock makes rows — plug its database's new rows instead
  if (ref.template) return refuse(`${PP}.noMatch`)
  const src = env.input.agents.find((a) => ref.agents.includes(a.agent.id) && a.agent.trigger.type === 'schedule' && scheduleKey(a.agent.trigger) === ref.schedule)
  const stored = storedAgent(env, id)
  if (!src || !stored) return refuse(`${PP}.gone`)
  const trigger = { ...(src.agent.trigger as Extract<CustomAgent['trigger'], { type: 'schedule' }>) }
  if (stored.trigger.type === 'schedule' && scheduleKey(stored.trigger) === ref.schedule) return info(`${PP}.already`)
  return agentPatch(env, stored, { ...stored, trigger }, ['trigger'], { asks: webhookAsk(stored) })
}

/** A server agent's webhook trigger is replaced only after a confirm (§2.9). */
const webhookAsk = (a: CustomAgent): MsgRef[] => (a.runner === 'server' && a.trigger.type === 'webhook' ? [{ key: `${PP}.replaceWebhook`, vars: { agent: agentKey(a.id) } }] : [])

function rowToAgent(env: Env, from: End, to: End): PatchPlan {
  const row = rowOf(from)
  const id = agentOf(to)
  if (!row || !id) return refuse(`${PP}.gone`)
  if (row.event === 'deleted') return refuse(`${PP}.noDeleted`)
  const lost = lostRef(env, row.db, true)
  if (lost) return { refused: lost }
  if (!liveDb(env, row.db)) return refuse(`${PP}.noMatch`)
  const stored = storedAgent(env, id)
  if (!stored) return refuse(`${PP}.gone`)
  const trigger: CustomAgent['trigger'] = row.event === 'created' ? { type: 'row_created', databaseId: row.db } : { type: 'row_changed', databaseId: row.db, propertyId: row.prop }
  if (sameTrigger(stored.trigger, trigger)) return info(`${PP}.already`)
  return agentPatch(env, stored, { ...stored, trigger }, ['trigger'], { asks: webhookAsk(stored) })
}

function rowToAutomation(env: Env, from: End, to: End): PatchPlan {
  const row = rowOf(from)
  const ref = to.at === 'module' && to.ref?.kind === 'automation' ? to.ref : null
  if (!row || !ref) return refuse(`${PP}.gone`)
  // an automation runs on its own database's rows only
  if (row.db !== ref.db) return refuse(`${PP}.otherDb`)
  if (!liveDb(env, ref.db)) return { refused: lostRef(env, ref.db, true) ?? { key: `${PP}.gone` } }
  if (env.ctx.src.ws.databases[ref.db]?.locked) return refuse(`${P}.key.locked`)
  const list = storedAutomations(env, ref.db)
  const a = list.find((x) => x.id === ref.id)
  if (!a) return refuse(`${PP}.gone`)
  const trigger: AutomationTrigger = row.event === 'created' ? { type: 'row_created' } : row.event === 'deleted' ? { type: 'row_deleted' } : { type: 'property_changed', propertyId: row.prop }
  if (a.trigger.type === trigger.type && (trigger.type !== 'property_changed' || (a.trigger.type === 'property_changed' && (a.trigger.propertyId ?? null) === trigger.propertyId))) return info(`${PP}.already`)
  return automationsPatch(env, ref.db, list, list.map((x) => (x.id === a.id ? { ...x, trigger } : x)))
}

function commandTo(env: Env, from: End, to: End): PatchPlan {
  const db = from.at === 'module' && from.ref?.kind === 'database' ? from.ref.id : null
  const target = to.at === 'module' ? to.ref : null
  if (!db || !target || (target.kind !== 'agent' && target.kind !== 'script')) return refuse(`${PP}.gone`)
  const lost = lostRef(env, db, true)
  if (lost) return { refused: lost }
  if (!liveDb(env, db)) return refuse(`${PP}.noMatch`)
  if (env.ctx.src.ws.databases[db]?.locked) return refuse(`${P}.key.locked`)
  const list = storedCommands(env, db)
  if (target.kind === 'agent') {
    if (!storedAgent(env, target.id)) return refuse(`${PP}.gone`)
    if (env.ctx.hasDefaultCommand(db, target.id, { databases: env.ctx.src.ws.databases, agents: env.ctx.src.ws.agents })) return info(`${PP}.hasDefault`, { agent: agentKey(target.id) })
    if (list.some((c) => c.kind === 'agent' && c.config?.agentId === target.id)) return info(`${PP}.already`)
    return commandsPatch(env, db, list, [...list, { id: env.ctx.newId(), kind: 'agent', label: '', icon: null, config: { agentId: target.id } }])
  }
  const script = env.input.scripts.find((s) => s.script.id === target.id)
  if (!script) return refuse(`${PP}.gone`)
  if (script.script.kind !== 'script') return refuse(`${PP}.queryScript`)
  if (list.some((c) => c.kind === 'script' && c.config?.scriptId === target.id)) return info(`${PP}.already`)
  return commandsPatch(env, db, list, [...list, { id: env.ctx.newId(), kind: 'script', label: '', icon: null, config: { scriptId: target.id } }])
}

/** The allow-lists of an agent without one server (mcpTools stays absent when nothing is left). */
function withoutTools(a: CustomAgent, name: string): Pick<CustomAgent, 'mcpTools'> {
  const rest = { ...(a.mcpTools ?? {}) }
  delete rest[name]
  return Object.keys(rest).length ? { mcpTools: rest } : { mcpTools: undefined }
}

/** Where an agent's tools of a server are known: a browser agent's on its creator's device, a server agent's on the server. */
function toolsRefusal(env: Env, ai: ModelInput['agents'][number], server: Extract<ModuleRef, { kind: 'server' }>, serverKey: ModuleKey): MsgRef | null {
  const onServer = ai.agent.runner === 'server'
  if (onServer && !server.runtime) return { key: `${PP}.notOnServer`, vars: { server: serverKey } }
  if (!onServer && (server.runtime || !server.id || !ai.creatorHere)) return { key: `${PP}.notHere`, vars: { agent: agentKey(ai.agent.id) } }
  return null
}

function toolsToAgent(env: Env, from: End, to: End, group: 'read' | 'write'): PatchPlan {
  const server = from.at === 'module' && from.ref?.kind === 'server' ? from.ref : null
  const id = agentOf(to)
  const ai = id ? env.input.agents.find((a) => a.agent.id === id) : undefined
  const stored = id ? storedAgent(env, id) : null
  if (!server || !ai || !stored || from.at !== 'module') return refuse(`${PP}.gone`)
  const where = toolsRefusal(env, ai, server, from.key)
  if (where) return { refused: where }
  const { groups } = serverToolGroups(env.input, server)
  if (!groups.tested) return refuse(`${PP}.testFirst`, { server: from.key }, { open: { to: 'mcp', ...(server.id ? { server: server.id } : {}) } })
  const name = server.name
  const has = stored.mcpServers.includes(name)
  const cur = has ? stored.mcpTools?.[name] : undefined
  const servers = has ? stored.mcpServers : [...stored.mcpServers, name]
  let next: CustomAgent
  let widens: boolean
  if (group === 'read') {
    if (!groups.read.length) return refuse(`${PP}.noRead`, { server: from.key })
    if (has && (cur === undefined || groups.read.every((t) => cur.includes(t)))) return info(`${PP}.already`)
    const tools = cur ? [...new Set([...cur, ...groups.read])] : [...groups.read]
    next = { ...stored, mcpServers: servers, mcpTools: { ...(stored.mcpTools ?? {}), [name]: tools } }
    // a server the agent does not use yet widens it too (the biggest widening: a whole server's reads)
    widens = !has || (!!cur && tools.some((t) => !cur.includes(t)))
  } else {
    if (has && cur === undefined) return info(`${PP}.already`)
    next = { ...stored, mcpServers: servers, ...withoutTools(stored, name) }
    widens = true
  }
  if (next.mcpTools === undefined) delete next.mcpTools
  // a mirror's tool list is its recipe's: changing it asks first (§1.13)
  const asks = stored.mirrorOf && widens ? [{ key: `${PP}.mirrorWiden`, vars: { agent: agentKey(stored.id) } }] : []
  return agentPatch(env, stored, next, ['mcp'], { asks })
}

function scopeAdd(env: Env, from: End, to: End): PatchPlan {
  const id = agentOf(from)
  const db = to.at === 'module' && to.ref?.kind === 'database' ? to.ref.id : null
  const stored = id ? storedAgent(env, id) : null
  if (!stored || !db) return refuse(`${PP}.gone`)
  if (stored.scope.everything) return info(`${PP}.everything`, { agent: agentKey(stored.id) })
  const lost = lostRef(env, db, true)
  if (lost) return { refused: lost }
  const live = liveDb(env, db)
  if (!live) return refuse(`${PP}.noMatch`)
  const roots = new Set([...stored.scope.pages, ...stored.scope.databases])
  if (roots.has(db) || (live.under ?? []).some((u) => roots.has(u))) return info(`${PP}.already`)
  return agentPatch(env, stored, { ...stored, scope: { ...stored.scope, databases: [...stored.scope.databases, db] } }, ['scope'])
}

function reportTo(env: Env, from: End, to: End): PatchPlan {
  const id = agentOf(from)
  const pageId = to.at === 'module' && to.ref?.kind === 'page' ? to.ref.id : null
  const stored = id ? storedAgent(env, id) : null
  if (!stored || !pageId) return refuse(`${PP}.gone`)
  const lost = lostRef(env, pageId, false)
  if (lost) return { refused: lost }
  const f = env.input.pages[pageId]
  if (!f || f.kind !== 'page' || f.inTemplate) return refuse(`${PP}.noMatch`)
  // a team's agents are shared: a private page is the member's own
  if (env.team && f.private) return refuse(`${PP}.privateReport`)
  if (stored.output?.pageId === pageId) return info(`${PP}.already`)
  return agentPatch(env, stored, { ...stored, output: { pageId, mode: stored.output?.mode ?? 'append' } }, ['output'])
}

function runScriptAdd(env: Env, from: End, to: End): PatchPlan {
  const ref = from.at === 'module' && from.ref?.kind === 'automation' ? from.ref : null
  const scriptId = to.at === 'module' && to.ref?.kind === 'script' ? to.ref.id : null
  if (!ref || !scriptId) return refuse(`${PP}.gone`)
  const script = env.input.scripts.find((s) => s.script.id === scriptId)
  if (!script) return refuse(`${PP}.gone`)
  if (script.script.kind !== 'script') return refuse(`${PP}.queryScript`)
  if (env.ctx.src.ws.databases[ref.db]?.locked) return refuse(`${P}.key.locked`)
  const list = storedAutomations(env, ref.db)
  const a = list.find((x) => x.id === ref.id)
  if (!a) return refuse(`${PP}.gone`)
  if (a.actions.some((x) => x.type === 'run_script' && x.scriptId === scriptId)) return info(`${PP}.already`)
  return automationsPatch(env, ref.db, list, list.map((x) => (x.id === a.id ? { ...x, actions: [...x.actions, { type: 'run_script', scriptId }] } : x)))
}

/** The server a key names, with the address its profiles match (this device's URL, or the runtime's host). */
function serverAddress(env: Env, ref: Extract<ModuleRef, { kind: 'server' }>): { name: string; url: string } {
  if (!ref.runtime && ref.id) {
    const s = env.input.servers.find((x) => x.server.id === ref.id)
    if (s) return { name: s.server.name, url: s.server.url }
  }
  const rt = Array.isArray(env.input.runtime) ? env.input.runtime : (env.input.lazy?.runtime ?? [])
  const host = rt.find((r) => r.name === ref.name)?.host ?? null
  return { name: ref.name, url: host ? `https://${host}/` : '' }
}

/** The OUT lock's own rights (owners / admins) and the profile it writes — or why not. */
function outProfile(env: Env, from: End, to: End): { refused: PatchPlan } | { profile: IntegrationProfile; tool: string; server: Extract<ModuleRef, { kind: 'server' }> } {
  const ctx = env.input.ctx
  if (ctx.team && ctx.role !== 'owner' && ctx.role !== 'admin') {
    const names = env.ctx.admins?.filter(Boolean) ?? []
    return { refused: names.length ? refuse(`${PP}.outAdmins`, { names: names.join(', ') }) : refuse(`${PP}.outAdminsNone`) }
  }
  const server = from.at === 'module' && from.ref?.kind === 'server' ? from.ref : null
  const profileId = to.at === 'module' && to.ref?.kind === 'outbox' ? to.ref.profile : null
  const tool = from.at === 'module' ? from.tool : undefined
  if (!server || !profileId || !tool || !TOOL_NAME.test(tool)) return { refused: refuse(`${PP}.gone`) }
  const profile = sanitizeIntegrations(env.ctx.src.ws.integrations).integrations.find((p) => p.id === profileId)
  if (!profile) return { refused: refuse(`${PP}.gone`) }
  // a profile locks only on a server it matches by name / address (a tools-only match locks nothing — §6 A23)
  if (!serverMatch(profile, [serverAddress(env, server)])) return { refused: refuse(`${PP}.outNoMatch`) }
  return { profile, tool, server }
}

function outLock(env: Env, from: End, to: End): PatchPlan {
  const got = outProfile(env, from, to)
  if ('refused' in got) return got.refused
  const { profile, tool, server } = got
  const { groups } = serverToolGroups(env.input, server)
  if (!groups.tested) return refuse(`${PP}.testFirst`, { server: from.key }, { open: { to: 'mcp', ...(server.id ? { server: server.id } : {}) } })
  if (groups.out.includes(tool)) return info(`${PP}.already`)
  if (![...groups.read, ...groups.write].includes(tool)) return refuse(`${PP}.unknownTool`, { tool })
  if ((profile.outTools?.length ?? 0) >= SEND_LIMITS.routes) return refuse(`${PP}.outFull`, { n: SEND_LIMITS.routes })
  const next: IntegrationProfile = { ...profile, outTools: [...(profile.outTools ?? []), tool] }
  return done(env, [{ w: 'integration', profile: next, replaces: profile.id }], [{ w: 'integration', profile, replaces: profile.id }])
}

function outUnlock(env: Env, from: End, to: End): PatchPlan {
  const got = outProfile(env, from, to)
  if ('refused' in got) return got.refused
  const { profile, tool } = got
  // a route's tool stays OUT while the route exists — it is changed in the profile
  if (!(profile.outTools ?? []).includes(tool)) return (profile.sends ?? []).some((r) => r.tool === tool) ? refuse(`${PP}.inRoute`, { tool }) : info(`${PP}.notLocked`)
  const rest = (profile.outTools ?? []).filter((t) => t !== tool)
  const next: IntegrationProfile = { ...profile, ...(rest.length ? { outTools: rest } : {}) }
  if (!rest.length) delete next.outTools
  return done(env, [{ w: 'integration', profile: next, replaces: profile.id }], [{ w: 'integration', profile, replaces: profile.id }])
}

/* ------------------------------------------------------------------ unplug */

/** The cable an unplug names (its id, else the ends' jack keys). */
function edgeOf(env: Env, patch: Patch, from: End, to: End) {
  const jk = (e: End) => (e.at === 'net' ? e.key : `${e.key}.${e.role}`)
  const id = patch.edge ?? `${jk(from)}>${jk(to)}`
  return env.model.edges.find((e) => e.id === id) ?? null
}

function unplug(env: Env, patch: Patch, from: End, to: End): PatchPlan {
  if (from.at === 'module' && from.kind === 'server' && from.tool !== undefined && to.at === 'module' && to.kind === 'outbox') return outUnlock(env, from, to)
  const edge = edgeOf(env, patch, from, to)
  if (!edge) return refuse(`${PP}.gone`)
  const fk = from.at === 'net' ? 'net' : from.kind
  const tk = to.at === 'net' ? 'net' : to.kind
  const inEditor = () => refuse(`${PP}.inEditor`, undefined, openOfEnd(from) ? { open: openOfEnd(from) } : {})
  // a start of an agent: its trigger
  if (tk === 'agent' && to.role === 'start' && (fk === 'clock' || fk === 'rowTrigger' || fk === 'net' || fk === 'incoming')) return triggerOff(env, to)
  if (tk === 'automation' && to.role === 'start' && (fk === 'rowTrigger' || fk === 'net')) return automationOff(env, to)
  if (fk === 'command') return commandOff(env, from, to)
  if (fk === 'automation') return automationAction(env, from, to, edge.place ?? null) ?? inEditor()
  if (fk === 'server' && tk === 'agent') return toolsOff(env, from, to)
  if (fk === 'server' && tk === 'planner') return plannerServerOff(env, from, to)
  if (fk === 'server') return refuse(`${PP}.inSettings`, undefined, { open: { to: 'mcp', ...(from.at === 'module' && from.ref?.kind === 'server' && from.ref.id ? { server: from.ref.id } : {}) } })
  if (fk === 'agent' && from.role === 'writes') return scopeRemove(env, from, edge.place ?? null, to)
  if (fk === 'agent' && from.role === 'report') return reportOff(env, from)
  return inEditor()
}

function triggerOff(env: Env, to: End): PatchPlan {
  const id = agentOf(to)
  const stored = id ? storedAgent(env, id) : null
  if (!stored) return refuse(`${PP}.gone`)
  if (stored.trigger.type === 'manual') return info(`${PP}.already`)
  // the last start of an enabled agent: it then runs by hand only (§2.9)
  const asks = stored.enabled ? [{ key: `${PP}.lastStart`, vars: { agent: agentKey(stored.id) } }] : []
  return agentPatch(env, stored, { ...stored, trigger: { type: 'manual' } }, ['trigger'], { asks })
}

function automationOff(env: Env, to: End): PatchPlan {
  const ref = to.at === 'module' && to.ref?.kind === 'automation' ? to.ref : null
  if (!ref) return refuse(`${PP}.gone`)
  const list = storedAutomations(env, ref.db)
  const a = list.find((x) => x.id === ref.id)
  if (!a) return refuse(`${PP}.gone`)
  if (!a.enabled) return info(`${PP}.already`)
  return automationsPatch(env, ref.db, list, list.map((x) => (x.id === a.id ? { ...x, enabled: false } : x)))
}

/** The method an outbound module keys a webhook by (POST unless PUT — model.ts). */
const methodOf = (a: Extract<AutomationAction, { type: 'webhook' }>) => (a.method === 'PUT' ? 'PUT' : 'POST')

/** Unplug an automation's cable out: its webhook, its script, its folded script's or set_property's write. Null: none of these. */
function automationAction(env: Env, from: End, to: End, place: Place | null): PatchPlan | null {
  const ref = from.at === 'module' && from.ref?.kind === 'automation' ? from.ref : null
  if (!ref) return refuse(`${PP}.gone`)
  const list = storedAutomations(env, ref.db)
  const a = list.find((x) => x.id === ref.id)
  if (!a) return refuse(`${PP}.gone`)
  const folded = from.at === 'module' ? from.module?.folds?.script : undefined
  let keep: (x: AutomationAction) => boolean
  if (to.at === 'module' && to.ref?.kind === 'outbound') {
    const out = to.ref
    if (out.exit === 'webhook') keep = (x) => !(x.type === 'webhook' && (hostOf(x.url) || null) === out.host && methodOf(x) === out.method)
    // a folded script's effect (http.post / mail.send): the script's action
    else if (folded && (out.exit === 'http' || out.exit === 'mail')) keep = (x) => !(x.type === 'run_script' && x.scriptId === folded)
    else return null
  } else if (to.at === 'module' && to.ref?.kind === 'script') {
    const sid = to.ref.id
    keep = (x) => !(x.type === 'run_script' && x.scriptId === sid)
  } else {
    // a write: into a field someone listens to (a net flag: that field), else the database's cable — which carries
    // every set_property of the own database without a flag of its own; a folded script's writes are its action's
    const db = place && 'db' in place ? place.db : null
    const prop = place && 'db' in place && place.prop && place.prop !== '*' && place.prop !== '+row' ? place.prop : null
    const flagged = new Set(
      env.model.edges
        .filter((e) => e.from === `${from.key}.writes` && e.to.startsWith('net:') && e.place && 'db' in e.place && e.place.db === ref.db)
        .map((e) => (e.place as { prop?: string }).prop),
    )
    const own = (x: AutomationAction) => x.type === 'set_property' && (prop ? x.propertyId === prop : db === ref.db && !flagged.has(x.propertyId))
    if (a.actions.some(own)) keep = (x) => !own(x)
    else if (folded) keep = (x) => !(x.type === 'run_script' && x.scriptId === folded)
    else return null
  }
  const actions = a.actions.filter(keep)
  if (actions.length === a.actions.length) return refuse(`${PP}.gone`)
  return automationsPatch(env, ref.db, list, list.map((x) => (x.id === a.id ? { ...x, actions } : x)))
}

function commandOff(env: Env, from: End, to: End): PatchPlan {
  const ref = from.at === 'module' && from.ref?.kind === 'command' ? from.ref : null
  if (!ref) return refuse(`${PP}.gone`)
  // an Outbox route's command comes from the profile (computed, never stored)
  if (ref.command.startsWith('send:')) return refuse(`${PP}.inProfile`, undefined, { open: { to: 'route', route: { name: 'workspace', section: 'integrations' } } })
  if (env.ctx.src.ws.databases[ref.db]?.locked) return refuse(`${P}.key.locked`)
  const list = storedCommands(env, ref.db)
  const cmd = list.find((c) => c.id === ref.command)
  if (!cmd) return refuse(`${PP}.gone`)
  if (cmd.kind !== 'actions') return commandsPatch(env, ref.db, list, list.filter((c) => c.id !== cmd.id))
  // one cable of an "actions" command: that action goes; the last one takes the command along
  const acts = Array.isArray(cmd.config?.actions) ? (cmd.config.actions as Array<Record<string, unknown>>) : []
  const t = to.at === 'module' ? to.ref : null
  const hit = (a: Record<string, unknown>): boolean => {
    if (t?.kind === 'script') return a.type === 'run_script' && a.scriptId === t.id
    if (t?.kind === 'outbound') return a.type === 'webhook' && (hostOf(typeof a.url === 'string' ? a.url : '') || null) === t.host && (a.method === 'PUT' ? 'PUT' : 'POST') === t.method
    const db = t?.kind === 'database' ? t.id : to.at === 'net' ? to.db : null
    return a.type === 'add_page' && !!db && a.databaseId === db
  }
  const rest = acts.filter((a) => !hit(a))
  if (rest.length === acts.length) return refuse(`${PP}.gone`)
  const next = rest.length ? list.map((c) => (c.id === cmd.id ? { ...c, config: { ...c.config, actions: rest } } : c)) : list.filter((c) => c.id !== cmd.id)
  return commandsPatch(env, ref.db, list, next)
}

function toolsOff(env: Env, from: End, to: End): PatchPlan {
  const server = from.at === 'module' && from.ref?.kind === 'server' ? from.ref : null
  const id = agentOf(to)
  const stored = id ? storedAgent(env, id) : null
  if (!server || !stored || !stored.mcpServers.includes(server.name)) return refuse(`${PP}.gone`)
  const name = server.name
  const removed = (): CustomAgent => {
    const next: CustomAgent = { ...stored, mcpServers: stored.mcpServers.filter((s) => s !== name), ...withoutTools(stored, name) }
    if (next.mcpTools === undefined) delete next.mcpTools
    return next
  }
  const asks = stored.mirrorOf ? [{ key: `${PP}.mirrorNarrow`, vars: { agent: agentKey(stored.id) } }] : []
  if (from.role === 'read') return agentPatch(env, stored, removed(), ['mcp'], { asks })
  // WRITE? out: the agent keeps the server's read tools (its own list's, by the same classes the rack draws)
  const { groups, profiles } = serverToolGroups(env.input, server)
  const use = toolUse(groups, stored.mcpTools?.[name], profiles)
  const keep = use.read ?? []
  if (!keep.length) return agentPatch(env, stored, removed(), ['mcp'], { asks, notes: [{ key: `${P}.key.cutToolsAll`, vars: { agent: agentKey(stored.id), server: from.at === 'module' ? from.key : '' } }] })
  return agentPatch(env, stored, { ...stored, mcpTools: { ...(stored.mcpTools ?? {}), [name]: [...keep] } }, ['mcp'], { asks })
}

function scopeRemove(env: Env, from: End, place: Place | null, to: End): PatchPlan {
  const id = agentOf(from)
  const stored = id ? storedAgent(env, id) : null
  const db = place && 'db' in place ? place.db : to.at === 'module' && to.ref?.kind === 'database' ? to.ref.id : to.at === 'net' ? to.db : null
  if (!stored || !db) return refuse(`${PP}.gone`)
  // a mirror stays on its database (§1.13)
  if (stored.mirrorOf === db) return refuse(`${PP}.mirror`, { agent: agentKey(stored.id) }, { open: agentOpen(stored.id) })
  if (stored.scope.everything) return refuse(`${PP}.inEditor`, undefined, { open: agentOpen(stored.id) })
  // a database below a page in its scope: the page is what to change
  if (!stored.scope.databases.includes(db)) return refuse(`${PP}.viaPage`, { agent: agentKey(stored.id) }, { open: agentOpen(stored.id) })
  return agentPatch(env, stored, { ...stored, scope: { ...stored.scope, databases: stored.scope.databases.filter((d) => d !== db) } }, ['scope'])
}

function reportOff(env: Env, from: End): PatchPlan {
  const id = agentOf(from)
  const stored = id ? storedAgent(env, id) : null
  if (!stored) return refuse(`${PP}.gone`)
  if (!stored.output?.pageId) return info(`${PP}.already`)
  return agentPatch(env, stored, { ...stored, output: null }, ['output'])
}

/* ------------------------------------------------------------------ commit and undo */

/** The four writers (the app: patchApply.ts — the store and the areas' index files; specs: stand-ins). */
export interface PatchSink {
  upsertAgent(agent: CustomAgent): void
  /** the stored agent after a write (to read upsertAgent's result — it returns nothing) */
  agent(id: ID): CustomAgent | undefined
  saveAutomations(db: ID, list: Automation[], writer: Writer): boolean
  /** fix (ui-words): a database's stored automations right now (raw) — the engine's bookkeeping is taken from here */
  automations?(db: ID): unknown
  saveDbCommands(db: ID, list: DbCommand[]): boolean
  upsertIntegration(profile: IntegrationProfile, replaces?: string): boolean
  /** Orders B10: the planner's server of a work-orders database (coding saveOrderConfig — false: refused) */
  saveOrderServer?(db: ID, server: string | null, writer: Writer): boolean
}

/** An agent's config (what Undo compares): every field but the stamps the store sets. */
function agentConfig(a: CustomAgent | null | undefined): string {
  const clean = a ? sanitizeAgent(a.id, a) : null
  if (!clean) return 'null'
  const { createdAt: _ca, updatedAt: _ua, createdBy: _cb, updatedBy: _ub, ...rest } = clean
  void _ca
  void _ua
  void _cb
  void _ub
  return stable(rest)
}

const BOOKKEEPING = ['lastRunAt', 'lastStatus', 'lastMessage'] as const

/**
 * Fix (ui-words): a patch (or its Undo) writes config only — the engine's bookkeeping (`lastRunAt` / `lastStatus` /
 * `lastMessage`) of every automation is taken from the list stored NOW, so a run since the plan (a failing automation's
 * red lamp, its last message) is never written back to what the plan saw. An automation not stored any more keeps none.
 */
export function withBookkeeping(list: Automation[], storedRaw: unknown): Automation[] {
  const stored = new Map(readAutomations(storedRaw).map((a) => [a.id, a]))
  return list.map((a) => {
    const cur = stored.get(a.id)
    const out = { ...a } as Automation & Record<string, unknown>
    for (const k of BOOKKEEPING) {
      const v = cur?.[k]
      if (v === undefined) delete out[k]
      else (out as Record<string, unknown>)[k] = v
    }
    return out
  })
}

/** The fields a patch changes that the sanitizer cuts (lists past AGENT_LIMITS, names it does not take) — compared raw. */
const CUT_FIELDS = ['mcpServers', 'mcpTools', 'scope'] as const

/**
 * Write one PatchWrite through the sink (under `writer`) — false when the writer refused it. An agent is read back:
 * its config (sanitized both sides) and, raw, the fields the sanitizer cuts — a write it truncated is no write.
 */
function writeOne(w: PatchWrite, writer: Writer, sink: PatchSink): boolean {
  if (w.w === 'agent') {
    withWriter(writer, () => sink.upsertAgent(w.agent))
    const got = sink.agent(w.agent.id)
    if (agentConfig(got) !== agentConfig(w.agent)) return false
    return CUT_FIELDS.every((k) => stable(got?.[k] ?? null) === stable(w.agent[k] ?? null))
  }
  if (w.w === 'automations') return sink.saveAutomations(w.db, sink.automations ? withBookkeeping(w.list, sink.automations(w.db)) : w.list, writer)
  if (w.w === 'commands') return withWriter(writer, () => sink.saveDbCommands(w.db, w.list))
  if (w.w === 'orders') return sink.saveOrderServer?.(w.db, w.server, writer) ?? false
  return withWriter(writer, () => sink.upsertIntegration(w.profile, w.replaces))
}

/**
 * Commit writes in order under `writer` (`you~patchbay`; an Undo `you~undo`), reading every boolean a writer returns. A
 * refused write puts the earlier ones back (their inverses, as `rollback` gives them) and says so.
 */
export function commitWrites(writes: PatchWrite[], writer: Writer, sink: PatchSink, rollback: PatchWrite[] = []): { ok: true } | { ok: false; refused: MsgRef } {
  for (let i = 0; i < writes.length; i++) {
    if (writeOne(writes[i], writer, sink)) continue
    for (let j = i - 1; j >= 0; j--) if (rollback[j]) writeOne(rollback[j], writer, sink)
    return { ok: false, refused: { key: `${PP}.failed` } }
  }
  return { ok: true }
}

/**
 * Commit a plan (§2.9): every target is read again first — one whose config is no longer the plan's starting value (its
 * inverse: another tab, a member, an edit while the "+F2" popover was open) refuses ("changed since"), nothing is
 * written and the caller plans again. Then the writes, as commitWrites.
 */
export function commitPlan(p: { writes: PatchWrite[]; inverse: PatchWrite[] }, ctx: Pick<PatchCtx, 'src' | 'read'>, writer: Writer, sink: PatchSink): { ok: true } | { ok: false; refused: MsgRef } {
  for (const w of p.inverse) if (!stillWritten(w, ctx.src, ctx.read)) return { ok: false, refused: { key: `${P}.key.changedSince` } }
  return commitWrites(p.writes, writer, sink, p.inverse)
}

/** Does the stored target still hold what `w` wrote (config fields only — bookkeeping and stamps never count)? */
function stillWritten(w: PatchWrite, src: InputSource, read: InputReaders): boolean {
  const ws = src.ws
  if (w.w === 'agent') {
    const cur = ws.agents?.[w.agent.id]
    return agentConfig(isObj(cur) ? (cur as unknown as CustomAgent) : null) === agentConfig(w.agent)
  }
  if (w.w === 'automations') return stable(read.automations(ws.databases[w.db]?.automations).map(automationConfigOf)) === stable(readAutomations(w.list).map(automationConfigOf))
  if (w.w === 'commands') return stable(read.commands(ws.databases[w.db]?.commands)) === stable(read.commands(w.list))
  if (w.w === 'orders') {
    const db = ws.databases[w.db]
    const cfg = db && read.orders ? read.orders(db).config : null
    return !!cfg && cfg !== 'unreadable' && cfg.server === w.server
  }
  const cur = sanitizeIntegrations(ws.integrations).integrations.find((p) => p.id === w.profile.id)
  return sameIntegration(cur, sanitizeIntegration(w.profile))
}

/**
 * Undo a committed plan (§1.9): every target is read again — one whose config changed since the patch refuses ("changed
 * since — open the editor"); a locked database refuses putting automations or commands back (the lock blocks adds).
 * Otherwise the inverse writes, to commit as `you~undo`.
 */
export function undoPlan(done: { writes: PatchWrite[]; inverse: PatchWrite[] }, ctx: Pick<PatchCtx, 'src' | 'read'>): { writes: PatchWrite[] } | { refused: MsgRef } {
  for (const w of done.writes) if (!stillWritten(w, ctx.src, ctx.read)) return { refused: { key: `${P}.key.changedSince` } }
  const { team, me } = ctx.src.device.ctx
  for (const w of done.inverse) {
    // the creator never writes another member's version back as their own (it would run unseen — agents/confirm.ts)
    if (w.w === 'agent' && waitsForMe(team, me, w.agent)) return { refused: confirmFirst(w.agent) }
    if (w.w === 'orders') {
      if (ctx.src.ws.databases[w.db]?.locked) return { refused: { key: `${P}.key.locked` } }
      continue
    }
    if (w.w !== 'automations' && w.w !== 'commands') continue
    const db = ctx.src.ws.databases[w.db]
    if (!db) return { refused: { key: `${PP}.gone` } }
    if (!db.locked) continue
    if (w.w === 'commands' || lockRefusal(ctx.read.automations(db.automations), readAutomations(w.list))) return { refused: { key: `${P}.key.locked` } }
  }
  return { writes: done.inverse }
}

/** Is a plan a refusal (the type guard B16 reads)? */
export const refused = isRefusal
