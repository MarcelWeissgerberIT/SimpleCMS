/**
 * The fuses (plan §1.3, §1.9, §1.21, §2.6) — pure, ids and message refs only. chains.ts (B3) found every path from a
 * decider to a way out with its three lamps; this module decides what each path is:
 *
 *   fuse      = a decider ∧ no gate ∧ content from outside (taint included; a data rule withholding it → off) ∧ private
 *               data in reach relative to the exit ∧ an unattended way out (fail closed for unknown tool lists)
 *   near miss = a decider and a way out with ONE closing reason (§1.21, never counted): a person in between (gate), a
 *               data rule, no private data in reach, or a way out closed on this device (a server the path needs is
 *               switched off here — other devices may keep it)
 *   unknown   = what this device cannot see (the model's unknown parts: another member's browser, Unreadable fields, a
 *               runtime the viewer may not read, team hooks, a lazy reading the cache lacks) — never a fuse, never
 *               read as safe
 *
 * Each fuse carries its path key (sig.ts `pathKey`, 64 hex — the identity of an allowance), its label (F1, F2 … in
 * order of the path keys, those whose decider only runs by hand last), the glyph's edge (the last unattended cable
 * before the exit), facts (label kind + value MsgRef), mitigations, the read tools a key leaves connected (residual),
 * the keys of §1.9 with what each changes and why it may be refused, and its signature (parts + sig) with the stored
 * allowance's state: allowed (the same sig) or lapsed (the modules whose parts changed). Nothing here reads a store;
 * every MsgRef var is an id or a plain value (plain.ts `sayMsg` / the UI resolve names).
 */
import { canBeHandOnly } from '../../store/keys'
import { moduleKey } from './ref'
import { deciderOf, outsideSources, outsideWhy, privateItems, privateWhy, reachIndex, readRoots, type Decider, type ReachIndex } from './reach'
import { keyCheck, taintOf, type StillReached } from './chains'
import { placeKey } from './rules'
import { allowedState, pathKey, sigInputOf, sigOf, type SigWorld } from './sig'
import { isLeaky, serverToolGroups, toolUse } from './tools'
import type { ID } from '../../store/types'
import type {
  AgentInput,
  Chain,
  Fact,
  FuseHint,
  FuseKey,
  FuseState,
  HintKind,
  Mitigation,
  Model,
  ModelInput,
  Module,
  ModuleKey,
  MsgRef,
  NearMiss,
  OutsideSource,
  Place,
  UnknownPart,
} from './types'

const P = 'features.patchbay'

/** A model with its fuses decided (buildModel's result): every fuse carries its state (sig, parts, allowance). */
export type FusedModel = Omit<Model, 'fuses'> & { fuses: FuseState[] }

export interface FuseAnalysis {
  fuses: FuseState[]
  nearMisses: NearMiss[]
  unknown: UnknownPart[]
}

/* ------------------------------------------------------------------ helpers */

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const isField = (prop: string | undefined): prop is string => !!prop && prop !== '*' && prop !== '+row' && prop !== '-row'

interface Ctx {
  ix: ReachIndex
  input: ModelInput
  w: SigWorld
  deciders: Map<ModuleKey, Decider | null>
  /** viewers and read-only workspaces: every key is inert */
  viewer: boolean
  /** a key's change tried out on the flow (chains.ts keyCheck): the route still unattended afterwards, or null */
  still: ReturnType<typeof keyCheck>
}

const deciderAt = (c: Ctx, key: ModuleKey | null): Decider | null => {
  if (!key) return null
  if (!c.deciders.has(key)) {
    const m = c.ix.mods.get(key)
    c.deciders.set(key, m ? deciderOf(c.ix, m) : null)
  }
  return c.deciders.get(key)!
}

const agentOf = (c: Ctx, m: Module | undefined): AgentInput | undefined => (m?.ref.kind === 'agent' ? c.ix.agents.get(m.ref.id) : undefined)

/** The module the exit's cable leaves: the automation holding the webhook, the pipeline, the sync; for MCP the processor whose tools reach it. */
function holderOf(ix: ReachIndex, chain: Chain): ModuleKey | null {
  const e = chain.exit ? ix.edge.get(chain.exit.edge) : undefined
  if (!e || !chain.exit) return null
  return (chain.exit.type === 'mcp' ? ix.jackMod.get(e.to) : ix.jackMod.get(e.from)) ?? null
}

/** The modules along a path (the decider first, then each module a step enters, the exit last). */
export function pathModules(chain: Chain): ModuleKey[] {
  const out: ModuleKey[] = chain.decider ? [chain.decider] : []
  for (const s of chain.steps) if (typeof s.to === 'string' && !out.includes(s.to)) out.push(s.to)
  return out
}

/** The tools a processor may call on a server module (its allow-list applied; OUT always off). */
function toolsOn(c: Ctx, proc: Module | undefined, server: Module | undefined): { read: string[] | null; write: string[] | null; groups: ReturnType<typeof serverToolGroups>['groups'] } | null {
  if (!proc || server?.ref.kind !== 'server') return null
  const g = serverToolGroups(c.input, server.ref)
  const ai = agentOf(c, proc)
  const allow = ai ? ai.agent.mcpTools?.[server.ref.name] : undefined
  const use = toolUse(g.groups, allow, g.profiles)
  return { read: use.read, write: use.write, groups: g.groups }
}

/* ------------------------------------------------------------------ facts and mitigations */

function factsOf(c: Ctx, chain: Chain, d: Decider): Fact[] {
  const { ix, input } = c
  const m = ix.mods.get(d.key)
  const ai = agentOf(c, m)
  const facts: Fact[] = []
  const exit = chain.exit!
  const holder = holderOf(ix, chain)
  const hm = holder ? ix.mods.get(holder) : undefined

  // what the decider changes (a hand-run autofill with review on: proposals — its fuse is an MCP path)
  if (ai) facts.push({ kind: 'writeMode', say: { key: `${P}.fact.write.${ai.write}` } })
  else facts.push({ kind: 'writeMode', say: { key: `${P}.fact.write.${d.write === 'stage' ? 'stage' : d.kind}` } })

  // what it may read beyond the one item (the private lamp's first item)
  const first = chain.why?.private[0]
  if (first) {
    const vars: Record<string, string | number> = {}
    if (first.place && 'db' in first.place) vars.db = first.place.db
    else if (first.place && 'page' in first.place) vars.page = first.place.page
    if (first.server) vars.server = first.server
    if (first.kind === 'named') vars.n = chain.why!.private.filter((i) => i.kind === 'named').length
    if (first.n !== undefined) vars.n = first.n
    facts.push({ kind: 'reach', say: { key: `${P}.fact.reach.${first.kind}`, vars } })
  }

  // what sends it out
  if (exit.type === 'webhook' && hm?.ref.kind === 'automation') {
    const r = hm.ref
    const au = ix.dbs.get(r.db)?.automations.find((a) => a.id === r.id)
    const out = ix.mods.get(exit.module)
    const method = out?.ref.kind === 'outbound' ? (out.ref.method ?? 'POST') : 'POST'
    const t = au?.trigger
    if (t?.type === 'property_changed' && t.propertyId) facts.push({ kind: 'trigger', say: { key: `${P}.fact.trigger.field`, vars: { db: r.db, prop: t.propertyId, method } } })
    else if (t?.type === 'row_created') facts.push({ kind: 'trigger', say: { key: `${P}.fact.trigger.row`, vars: { db: r.db, method } } })
    else if (t?.type === 'row_deleted') facts.push({ kind: 'trigger', say: { key: `${P}.fact.trigger.deleted`, vars: { db: r.db, method } } })
    else facts.push({ kind: 'trigger', say: { key: `${P}.fact.trigger.any`, vars: { db: r.db, method } } })
    // an MCP or Git exit is the way out itself, not what sets it off (fix ui-words): its own label
  } else if (exit.type === 'mcp') facts.push({ kind: 'exit', say: { key: `${P}.fact.trigger.tools`, vars: { server: exit.module } } })
  else if (exit.type === 'exec') facts.push({ kind: 'exit', say: { key: `${P}.fact.trigger.exec` } })
  else if (exit.type === 'sync') facts.push({ kind: 'trigger', say: { key: `${P}.fact.trigger.sync`, vars: { n: input.sync.github.everyMin } } })
  else if (exit.type === 'git') {
    const out = ix.mods.get(exit.module)
    const method = out?.ref.kind === 'outbound' ? (out.ref.method ?? '') : ''
    facts.push({ kind: 'exit', say: { key: `${P}.fact.trigger.git`, vars: { method, git: method } } })
  }

  facts.push({ kind: 'chain', say: { key: `${P}.fact.chain`, vars: { n: chain.steps.length } } })

  if (ai) {
    if (ai.agent.runner === 'server') facts.push({ kind: 'serverAgent', say: { key: `${P}.fact.serverAgent` } })
    else facts.push({ kind: 'browserAgent', say: { key: `${P}.fact.browserAgent.${input.ctx.team ? 'team' : 'local'}` } })
  }
  if (d.disabled) facts.push({ kind: 'handRunOnly', say: { key: `${P}.fact.handRunOnly` } })
  // fix (safety-data): only the creator confirms — the creator reads who changed it, everyone else whose confirm it waits for
  if (ai?.awaitsConfirm) {
    const creator = !!input.ctx.me && ai.agent.createdBy === input.ctx.me
    facts.push({ kind: 'awaitsConfirm', say: creator ? { key: `${P}.fact.awaitsConfirm`, vars: { member: ai.agent.updatedBy ?? '' } } : { key: `${P}.fact.awaitsConfirmOf`, vars: { creator: ai.agent.createdBy ?? '' } } })
  }
  // no stop before the git stage: approvals none — or a level whose gates this pipeline's stages pass (fix model)
  if ((exit.type === 'git' || exit.type === 'exec') && !chain.gate) facts.push({ kind: 'approvals', say: input.worker.approvals === 'none' ? { key: `${P}.fact.approvalsNone` } : { key: `${P}.fact.approvalsPass` } })
  // Orders B10: the planner's consent is this device's ("Ohne Bestätigung starten" — other devices confirm by hand)
  if (d.kind === 'bridge' || d.kind === 'organise' || d.kind === 'planner' || exit.type === 'sync' || (exit.type === 'mcp' && hm && hm.ref.kind !== 'agent')) facts.push({ kind: 'thisDevice', say: { key: `${P}.fact.thisDevice` } })
  if (exit.type === 'mcp') {
    const tools = toolsOn(c, hm, ix.mods.get(exit.module))
    const declared = Object.entries(tools?.groups.declared ?? {})
      .filter(([tool]) => tools?.write === null || tools?.write?.includes(tool))
      .flatMap(([, by]) => by)
    if (declared.length) facts.push({ kind: 'declaredRead', say: { key: `${P}.fact.declaredRead`, vars: { profiles: [...new Set(declared)].sort().join(', ') } } })
  }
  // the watch's bulk cap holds for automatic fills only (a hand-run one fills what the person picks)
  if (pathModules(chain).some((k) => ix.mods.get(k)?.kind === 'autofill' && !deciderAt(c, k)?.disabled)) facts.push({ kind: 'bulkCap', say: { key: `${P}.fact.bulkCap` } })
  if (chain.lamps?.out.say.key === `${P}.lamp.out.failClosed`) facts.push({ kind: 'failClosed', say: { key: `${P}.fact.failClosed`, vars: { server: exit.module } } })
  return facts
}

function mitigationsOf(c: Ctx, chain: Chain, d: Decider): Mitigation[] {
  const out: Mitigation[] = []
  const ai = agentOf(c, c.ix.mods.get(d.key))
  const exit = chain.exit!
  if (ai?.jevGate) out.push({ kind: 'jev', say: { key: `${P}.mitigation.jev` } })
  if (ai && ai.write === 'apply' && exit.type !== 'mcp') out.push({ kind: 'directSplit', say: { key: `${P}.mitigation.directSplit` } })
  if (exit.type === 'mcp') {
    const s = c.ix.mods.get(exit.module)
    const n = s?.ref.kind === 'server' ? serverToolGroups(c.input, s.ref).groups.out.length : 0
    if (n) out.push({ kind: 'outLock', say: { key: `${P}.mitigation.outLock`, vars: { n } } })
  }
  if (ai) out.push({ kind: 'webImages', say: { key: `${P}.mitigation.webImages` } })
  return out
}

/** READ tools the decider (and the processors on the path) may call that could carry data out in their arguments. */
function residualOf(c: Ctx, chain: Chain): string[] {
  const out = new Set<string>()
  for (const k of pathModules(chain)) {
    const pm = c.ix.mods.get(k)
    if (!pm || pm.col !== 2) continue
    for (const link of c.ix.tools.get(k) ?? []) {
      if (!link.read) continue
      const t = toolsOn(c, pm, c.ix.mods.get(link.server))
      for (const name of t?.read ?? []) if (isLeaky(name)) out.add(name)
    }
  }
  return [...out].sort()
}

/* ------------------------------------------------------------------ the keys (§1.9) */

const READ_ONLY: MsgRef = { key: `${P}.key.readOnly` }

/** Team: a browser agent another member created waits for its creator after any change (awaitsConfirm). */
function teamNote(c: Ctx, ai: AgentInput | undefined): MsgRef | undefined {
  if (!ai || !c.input.ctx.team || ai.agent.runner !== 'browser') return undefined
  if (ai.agent.createdBy && ai.agent.createdBy === c.input.ctx.me) return undefined
  return { key: `${P}.key.confirmAfter`, vars: { creator: ai.agent.createdBy ?? '' } }
}

/**
 * Team: the creator's own browser agent another member changed last waits for the creator's confirm — a key (an
 * upsertAgent as the creator) would run that member's version unseen: confirm it in its editor first (B10, as patch.ts).
 */
function confirmFirst(c: Ctx, ai: AgentInput | undefined): MsgRef | undefined {
  if (!ai || !c.input.ctx.team || ai.agent.runner !== 'browser' || !ai.awaitsConfirm) return undefined
  if (!c.input.ctx.me || ai.agent.createdBy !== c.input.ctx.me) return undefined
  return { key: `${P}.patch.confirmFirst`, vars: { agent: moduleKey({ kind: 'agent', id: ai.agent.id }), member: ai.agent.updatedBy ?? '' } }
}

function inert(k: FuseKey, c: Ctx): FuseKey {
  return c.viewer ? { ...k, offered: false, refusal: READ_ONLY } : k
}

/** The places an agent writes directly in every write mode (its report page — a database page as its database —, notes). */
function directPlaces(ai: AgentInput | undefined): Set<string> {
  const out = new Set<string>(['inbox'])
  const report = ai?.agent.output?.pageId
  if (report) {
    out.add(placeKey({ page: report }))
    out.add(placeKey({ db: report, prop: '*' }))
  }
  return out
}

/** The place a route's first step writes (a net flag's writer half, or the place a push / pipeline / press passes). */
function firstPlace(r: StillReached): Place | null {
  const s = r.steps[0]
  if (!s) return null
  if (s.via) return s.via
  return typeof s.to === 'string' ? null : s.to
}

/** Why key 1 leaves the path open: the report page written in every mode (the push carries it / it sets the path off). */
function stillOpenByReport(r: StillReached, exit: NonNullable<Chain['exit']>, ai: AgentInput | undefined): MsgRef {
  const report = ai?.agent.output?.pageId
  const p = firstPlace(r)
  const viaReport = !!report && !!p && (placeKey(p) === placeKey({ page: report }) || placeKey(p) === placeKey({ db: report, prop: '*' }))
  if (viaReport) return { key: `${P}.key.${exit.type === 'sync' ? 'reportPushed' : 'reportStarts'}`, vars: { page: report! } }
  return { key: `${P}.key.proposalsOpen` }
}

/** Why key 2 leaves the path open: the relay that still writes the field (autofill / another module), else in general. */
function stillOpenByRelay(c: Ctx, r: StillReached, decider: ModuleKey, db: ID, prop: string): MsgRef {
  const writes = r.steps.find((s) => s.from !== decider && typeof s.to !== 'string' && 'db' in s.to && s.to.db === db && (s.to.prop === prop || s.to.prop === '*' || s.to.prop === undefined))
  const writer = writes ? c.ix.mods.get(writes.from) : undefined
  if (writer?.kind === 'autofill') return { key: `${P}.key.handOnlyAutofill`, vars: { db, prop } }
  if (writer) return { key: `${P}.key.handOnlyRelay`, vars: { db, prop, module: writer.key } }
  return { key: `${P}.key.handOnlyOpen`, vars: { db, prop } }
}

/**
 * What still happens once key 1 put the agent on proposals (§6 U8): the first relay after the decider — an automation
 * still fires, any other relay (autofill, a pipeline, an agent, a kit value, a script) is still started — or, with none,
 * the push that still carries what is applied; else each proposal simply waits.
 */
function proposalsNote(c: Ctx, chain: Chain): MsgRef {
  const exit = chain.exit!
  const relay = pathModules(chain).slice(1).find((k) => k !== exit.module)
  const m = relay ? c.ix.mods.get(relay) : undefined
  if (m?.kind === 'automation') return { key: `${P}.key.proposalsLeft`, vars: { automation: m.key } }
  if (m) return { key: `${P}.key.proposalsStarts`, vars: { module: m.key } }
  if (exit.type === 'sync') return { key: `${P}.key.proposalsPush` }
  return { key: `${P}.key.proposalsWait` }
}

function key1(c: Ctx, chain: Chain, d: Decider): FuseKey | null {
  const exit = chain.exit!
  const m = c.ix.mods.get(d.key)
  if (m?.ref.kind === 'agent') {
    const ai = c.ix.agents.get(m.ref.id)
    const base: FuseKey = { n: 1, kind: 'proposals', target: { agent: m.ref.id }, offered: false, label: { key: `${P}.key.proposals` }, what: { key: `${P}.key.proposalsWhat`, vars: { agent: d.key } } }
    // the decider's own MCP tools run inside the AI's tool loop: no proposal stops them (§6 A29)
    if (exit.type === 'mcp' && holderOf(c.ix, chain) === d.key) return inert({ ...base, refusal: { key: `${P}.key.mcpNoReview` } }, c)
    if (ai?.write !== 'apply') {
      // already on proposals and still a fuse: what it writes in every mode carries the path (its report page) — said so
      const why = ai?.write === 'stage' ? c.still(d.key, exit.edge, { kind: 'proposals', direct: directPlaces(ai) }) : null
      const report = why ? stillOpenByReport(why, exit, ai) : null
      return inert({ ...base, refusal: report && report.key !== `${P}.key.proposalsOpen` ? report : { key: `${P}.key.proposalsAlready` } }, c)
    }
    const waits = confirmFirst(c, ai)
    if (waits) return inert({ ...base, refusal: waits }, c)
    // fix mid: what the agent writes in every mode (its report page, its notes) is no proposal — a path it still takes
    // with nobody in between is not closed by the key: refused, with the write that keeps it open
    const direct = directPlaces(ai)
    const left = c.still(d.key, exit.edge, { kind: 'proposals', direct })
    if (left) return inert({ ...base, refusal: stillOpenByReport(left, exit, ai) }, c)
    const team = teamNote(c, ai)
    return inert({ ...base, offered: true, note: proposalsNote(c, chain), ...(team ? { team } : {}) }, c)
  }
  if (m?.ref.kind === 'autofill') {
    const r = m.ref
    const db = c.ix.dbs.get(r.db)
    const af = db?.properties.find((p) => p.id === r.prop)?.autofill
    const base: FuseKey = { n: 1, kind: 'autofillHand', target: { db: r.db, prop: r.prop }, offered: false, label: { key: `${P}.key.autofillHand` }, what: { key: `${P}.key.autofillHandWhat`, vars: { db: r.db, prop: r.prop } } }
    // fix (safety-data): a fill a person starts still carries the "All AI calls" servers (their write tools run inside
    // the AI's tool loop — §6 A29 as for agents) and, with "Apply without review", writes straight into the cells: by
    // hand only closes neither — refused with why (key 2 takes the server off autofill). Offered only where the review
    // then really stops the path.
    if (exit.type === 'mcp' && holderOf(c.ix, chain) === d.key) return inert({ ...base, refusal: { key: `${P}.key.autofillMcp`, vars: { server: exit.module } } }, c)
    if (af?.skipReview) return inert({ ...base, refusal: { key: `${P}.key.autofillDirect` } }, c)
    if (!af?.auto) return inert({ ...base, refusal: { key: `${P}.key.autofillAlready` } }, c)
    const locked = !!db?.locked
    return inert({ ...base, offered: !locked, ...(locked ? { refusal: { key: `${P}.key.locked` } } : {}) }, c)
  }
  // Orders B10: the planner — back to "Kette bestätigen" on this device (its consent dropped; Undo puts it back)
  if (m?.ref.kind === 'planner') {
    const db = m.ref.db
    const base: FuseKey = { n: 1, kind: 'autoOff', target: { orders: db }, offered: false, device: true, label: { key: `${P}.key.autoOff` }, what: { key: `${P}.key.autoOffWhat`, vars: { db } }, note: { key: `${P}.key.deviceOnly` } }
    if (!c.input.orders?.find((o) => o.db === db)?.auto) return inert({ ...base, refusal: { key: `${P}.key.autoOffAlready` } }, c)
    return inert({ ...base, offered: true }, c)
  }
  if (m?.ref.kind === 'organise') return inert({ n: 1, kind: 'organiseHand', target: { organise: true }, offered: true, device: true, label: { key: `${P}.key.organiseHand` }, what: { key: `${P}.key.organiseHandWhat` }, note: { key: `${P}.key.deviceOnly` } }, c)
  if (m?.ref.kind === 'bridge') return inert({ n: 1, kind: 'bridgeAsk', target: { bridge: true }, offered: true, device: true, label: { key: `${P}.key.bridgeAsk` }, what: { key: `${P}.key.bridgeAskWhat` }, note: { key: `${P}.key.deviceOnly` } }, c)
  return null
}

function key2(c: Ctx, chain: Chain, d: Decider): { key: FuseKey; residual?: string[] } | null {
  const { ix } = c
  const exit = chain.exit!
  // Orders B10: the planner's server — its read tools only, already so (never a write tool); untested: test it first
  if (d.kind === 'planner') {
    const src = chain.why?.outside.find((x) => x.kind === 'mcp' && !x.withheld)
    const sm = src ? ix.mods.get(src.source) : undefined
    if (!src || sm?.ref.kind !== 'server') return null
    const g = serverToolGroups(c.input, sm.ref)
    const base: FuseKey = { n: 2, kind: 'readTools', target: { server: sm.ref.id ?? '' }, offered: false, label: { key: `${P}.key.readTools` }, what: { key: `${P}.key.readToolsWhat`, vars: { server: src.source } } }
    if (!g.groups.tested && sm.ref.id) return { key: inert({ ...base, refusal: { key: `${P}.key.readToolsUntested`, vars: { server: src.source } }, open: { to: 'mcp', server: sm.ref.id } }, c) }
    const residual = g.groups.read.filter(isLeaky)
    return { key: inert({ ...base, refusal: { key: `${P}.key.readToolsAlready`, vars: { server: src.source } } }, c), ...(residual.length ? { residual } : {}) }
  }
  if (exit.type === 'mcp') {
    const holder = holderOf(ix, chain)
    const hm = holder ? ix.mods.get(holder) : undefined
    const server = ix.mods.get(exit.module)
    if (server?.ref.kind !== 'server' || !hm) return null
    const name = server.ref.name
    if (hm.ref.kind === 'agent') {
      const ai = ix.agents.get(hm.ref.id)
      const tools = toolsOn(c, hm, server)
      const keep = [...(tools?.read ?? [])].sort()
      const team = teamNote(c, ai)
      const waits = confirmFirst(c, ai)
      const key: FuseKey = {
        n: 2,
        kind: 'cutTools',
        target: { agent: hm.ref.id, server: name, keep },
        offered: !waits,
        ...(waits ? { refusal: waits } : {}),
        label: { key: `${P}.key.cutTools` },
        what: keep.length ? { key: `${P}.key.cutToolsWhat`, vars: { agent: hm.key, server: exit.module, n: keep.length } } : { key: `${P}.key.cutToolsAll`, vars: { agent: hm.key, server: exit.module } },
        ...(ai?.agent.mirrorOf ? { asks: { key: `${P}.key.mirrorAsk`, vars: { agent: hm.key } } } : {}),
        ...(team ? { team } : {}),
      }
      const residual = keep.filter(isLeaky)
      return { key: inert(key, c), ...(residual.length ? { residual } : {}) }
    }
    if (hm.ref.kind === 'autofill' && server.ref.id) {
      return { key: inert({ n: 2, kind: 'noAutofill', target: { server: server.ref.id }, offered: true, device: true, label: { key: `${P}.key.noAutofill`, vars: { server: exit.module } }, what: { key: `${P}.key.noAutofillWhat`, vars: { server: exit.module } }, note: { key: `${P}.key.deviceOnly` } }, c) }
    }
    return null
  }
  // „<field>“ by hand only — enforced only for agents and the bridge (§1.18)
  if (d.kind !== 'agent' && d.kind !== 'bridge') return null
  // the decider's first write, where a listener takes the path on (a way out right at the decider — a push, a
  // pipeline — has no field to protect: no key 2)
  const first = chain.steps[0]
  const place = first && typeof first.to !== 'string' ? first.to : null
  if (!place) return null
  const label = (db: ID, prop: string): MsgRef => (isField(prop) ? { key: `${P}.key.handOnly`, vars: { db, prop } } : { key: `${P}.key.handOnlyNone` })
  if (!('db' in place)) {
    const id = 'page' in place ? place.page : ''
    return { key: inert({ n: 2, kind: 'handOnly', target: { db: id, prop: '' }, offered: false, label: label(id, ''), refusal: { key: `${P}.key.noField.any` } }, c) }
  }
  const prop = place.prop ?? '*'
  const db = ix.dbs.get(place.db)
  const base = { n: 2 as const, kind: 'handOnly' as const, target: { db: place.db, prop: isField(prop) ? prop : '' }, label: label(place.db, prop), what: { key: `${P}.key.handOnlyWhat`, vars: { db: place.db } } }
  let refusal: MsgRef | undefined
  if (!isField(prop)) refusal = { key: `${P}.key.noField.${prop === '*' ? 'any' : 'row'}` }
  else {
    const def = db?.properties.find((p) => p.id === prop)
    if (!def || !canBeHandOnly(def)) refusal = { key: `${P}.key.noField.title` }
    else if (db?.locked) refusal = { key: `${P}.key.locked` }
    else {
      // fix mid: hand-only binds agents and the bridge only — a relay the decider still starts (autofill, a kit value, an
      // automation's set_property …) may write the field and set the path off all the same: refused, the relay named
      const left = c.still(d.key, chain.exit!.edge, { kind: 'handOnly', db: place.db, prop })
      if (left) refusal = stillOpenByRelay(c, left, d.key, place.db, prop)
    }
  }
  return { key: inert({ ...base, offered: !refusal, ...(refusal ? { refusal } : {}) }, c) }
}

function key3(c: Ctx, path: string, allowed: FuseState['allowed']): FuseKey {
  const { ctx } = c.input
  const withdraw = allowed?.state === 'allowed'
  let refusal: MsgRef | undefined
  if (c.viewer) refusal = READ_ONLY
  else if (ctx.team && ctx.role !== 'owner' && ctx.role !== 'admin') refusal = { key: `${P}.key.adminsOnlyNone` }
  else if (ctx.team && !ctx.supports.includes('signoffs')) refusal = { key: `${P}.key.serverOld` }
  return { n: 3, kind: withdraw ? 'withdraw' : 'allow', target: { path }, offered: !refusal, ...(refusal ? { refusal } : {}), label: { key: `${P}.key.${withdraw ? 'withdraw' : 'allow'}` }, what: { key: `${P}.key.allowWhat` } }
}

/* ------------------------------------------------------------------ near misses */

/**
 * One closing reason (§1.21) — or none (a path with two reasons, or no outside content at all, is neither). Data rules
 * are one reason however many lamps they switch off: 'mcp' withheld turns off both the MCP source and the MCP way out.
 */
function nearWhy(chain: Chain): NearMiss['why'] | null {
  const L = chain.lamps
  if (!L) return null
  if (chain.gate) return L.outside.on && L.private.on ? 'gate' : null
  const outsideRule = !L.outside.on && L.outside.say.key === `${P}.lamp.outside.dataRule`
  const outRule = !L.out.on && chain.withheld === 'mcp'
  if ((outsideRule || outRule) && L.private.on && (L.outside.on || outsideRule) && (L.out.on || outRule)) return 'dataRule'
  const off = [L.outside.on, L.private.on, L.out.on].filter((on) => !on).length
  if (off !== 1) return null
  if (!L.outside.on || !L.out.on) return null
  return 'noPrivate'
}

/**
 * Orders B10 — the planner's near misses, each with its own sentence (spec §4): (c) a data rule withholds 'mcp' — the
 * server's content never reaches the planner; (a) confirm mode — only "Kette starten ↵" stands between the server's
 * content and a git step that goes out with nobody in between; (b) auto mode — only an approval stands before the
 * worker's AI writes code. Null: not one of these (the general reasons apply).
 */
function plannerNear(c: Ctx, chain: Chain, d: Decider): { why: NearMiss['why']; say: MsgRef } | null {
  const L = chain.lamps
  if (d.kind !== 'planner' || !L || !chain.exit) return null
  if (!L.outside.on && L.outside.say.key === `${P}.lamp.outside.dataRule` && L.outside.say.vars?.cls === 'mcp') return { why: 'dataRule', say: { key: `${P}.near.plannerRule` } }
  if (!L.outside.on || !L.private.on) return null
  if (chain.gate === 'byHand' && chain.exit.type === 'git' && !c.ix.edge.get(chain.exit.edge)?.afterApproval) return { why: 'gate', say: { key: `${P}.near.plannerHand` } }
  if (chain.gate === 'afterApproval' && chain.exit.type === 'exec') return { why: 'gate', say: { key: `${P}.near.plannerApprove` } }
  return null
}

/**
 * Ways out closed on this device (§1.21 'closedHere'): a write tool the decider would call on a server that is set up
 * here but switched off — a browser agent's named server on its creator's device, autofill's "every AI call" servers.
 * Another device of the same person may have it on: listed, never counted.
 */
function closedHere(c: Ctx, model: Model): NearMiss[] {
  const { ix, input } = c
  const off = input.servers.filter((s) => !s.server.enabled)
  if (!off.length) return []
  const out: NearMiss[] = []
  let oi: ReturnType<typeof taintOf>['oi'] | null = null
  for (const m of model.modules) {
    const d = deciderAt(c, m.key)
    // a decider none of whose providers takes MCP servers never attaches one, on any device (D-S2-7)
    if (!d?.mcp) continue
    const ai = agentOf(c, m)
    let candidates = off
    if (ai) {
      if (ai.agent.runner !== 'browser' || !ai.creatorHere) continue
      candidates = off.filter((s) => ai.agent.mcpServers.includes(s.server.name) && !(ai.agent.mcpTools?.[s.server.name]?.length === 0))
    } else if (d.kind === 'autofill') candidates = off.filter((s) => s.server.scope === 'all')
    else continue
    for (const s of candidates) {
      const ref = { kind: 'server' as const, id: s.server.id, name: s.server.name }
      const g = serverToolGroups(input, ref)
      const allow = ai?.agent.mcpTools?.[s.server.name]
      const use = toolUse(g.groups, allow, g.profiles)
      if (use.leftOut || (use.write !== null && !use.write.length)) continue
      oi ??= taintOf(ix).oi
      const roots = readRoots(ix, m)
      const sources = outsideSources(ix, oi, m, roots, d)
      const server = moduleKey(ref)
      const exit = { module: server, type: 'mcp' as const, edge: '' }
      const reach = sources.filter((x) => !x.withheld)
      let primary: OutsideSource | null = null
      let items = privateItems(ix, m, d, roots, null, exit, sources)
      for (const src of reach) {
        const its = privateItems(ix, m, d, roots, src, exit, sources)
        if (!primary) {
          primary = src
          items = its
        }
        if (its.length) {
          primary = src
          items = its
          break
        }
      }
      const outside = outsideWhy(sources, primary)
      const priv = privateWhy(items)
      if (!outside.on || !priv.on) continue
      const source = primary?.source ?? d.key
      const chainKey = `${source}>${d.key}>${server}`
      out.push({
        key: pathKey(chainKey),
        why: 'closedHere',
        chain: {
          key: chainKey,
          source,
          decider: d.key,
          steps: [{ from: d.key, to: server, edge: '' }],
          shown: 1,
          exit,
          edges: [],
          lamps: { outside, private: priv, out: { on: false, say: { key: `${P}.lamp.out.closedHere`, vars: { server } } } },
          why: { outside: sources, private: items },
        },
      })
    }
  }
  return out
}

/**
 * The near miss a fuse becomes after a key that works on this device only (key 1 bridge / organise, key 2 "no longer
 * for autofill"): the path is gone from this device's model, the row stays for the visit (B10) — never counted.
 */
export const closedNearMiss = (f: Pick<FuseState, 'key' | 'chain'>): NearMiss => ({ key: f.key, chain: f.chain, why: 'closedHere' })

/* ------------------------------------------------------------------ the analysis */

/** The fuses, near misses and unknown parts of a model with its chains (pure). */
export function fusesOf(model: Model, input: ModelInput): FuseAnalysis {
  const ix = reachIndex(model, input)
  const w: SigWorld = {
    model,
    input,
    mods: ix.mods,
    servers: (k) => (ix.tools.get(k) ?? []).map((t) => t.server),
    exitHolder: (chain) => holderOf(ix, chain),
  }
  const c: Ctx = { ix, input, w, deciders: new Map(), viewer: input.ctx.readOnly || input.ctx.role === 'viewer', still: keyCheck(ix) }
  const fuses: FuseState[] = []
  const nearMisses: NearMiss[] = []
  for (const chain of model.chains) {
    const d = deciderAt(c, chain.decider)
    if (!d || !chain.lamps || !chain.exit) continue
    const L = chain.lamps
    if (chain.gate || !L.outside.on || !L.private.on || !L.out.on) {
      const own = plannerNear(c, chain, d)
      const why = own?.why ?? nearWhy(chain)
      if (why) nearMisses.push({ key: pathKey(chain.key), chain, why, ...(own ? { say: own.say } : {}) })
      continue
    }
    const key = pathKey(chain.key)
    const si = sigInputOf(chain, w)
    const s = sigOf(si)
    const allowed = allowedState(input.signoffs[key], s, si.owners)
    const k1 = key1(c, chain, d)
    const k2 = key2(c, chain, d)
    const residual = [...new Set([...residualOf(c, chain), ...(k2?.residual ?? [])])].sort()
    fuses.push({
      key,
      label: '',
      chain,
      lamps: L,
      at: chain.exit.edge,
      facts: factsOf(c, chain, d),
      mitigations: mitigationsOf(c, chain, d),
      ...(residual.length ? { residual } : {}),
      keys: [k1, k2?.key ?? null, key3(c, key, allowed)].filter((x): x is FuseKey => !!x),
      sigInput: si.parts,
      sig: s.sig,
      parts: s.parts,
      ...(allowed ? { allowed } : {}),
    })
  }
  // F-order: by path key, a decider that only runs by hand after the others (§1.3 A13)
  const handOnly = (f: FuseState) => (deciderAt(c, f.chain.decider)?.disabled ? 1 : 0)
  fuses.sort((a, b) => handOnly(a) - handOnly(b) || cmp(a.key, b.key))
  fuses.forEach((f, i) => (f.label = `F${i + 1}`))
  nearMisses.push(...closedHere(c, model))
  const order: Record<NearMiss['why'], number> = { gate: 0, dataRule: 1, noPrivate: 2, closedHere: 3 }
  nearMisses.sort((a, b) => order[a.why] - order[b.why] || cmp(a.key, b.key))
  return { fuses, nearMisses, unknown: [...model.unknown] }
}

/** The model with its fuses, near misses and unknown parts (B4) — a new model; the one passed in is not changed. */
export function withFuses(model: Model, input: ModelInput): FusedModel {
  const a = fusesOf(model, input)
  return { ...model, fuses: a.fuses, nearMisses: a.nearMisses, unknown: a.unknown }
}

/** An unknown part's words (`who` = the member id who can see it — the UI shows the name). */
export const unknownSay = (u: UnknownPart): MsgRef =>
  u.who ? { key: `${P}.unknown.${u.what}`, vars: { who: u.who } } : { key: u.what === 'otherBrowser' ? `${P}.unknown.otherBrowserAnyone` : `${P}.unknown.${u.what}` }

/** A near miss's closing reason in words. */
export const nearSay = (n: NearMiss): MsgRef => n.say ?? { key: `${P}.near.${n.why}` }

/** LED = Preflight lamp = readout: open (a lapsed allowance counts open), allowed, unknown parts. */
export function fuseCounts(model: Pick<FusedModel, 'fuses' | 'unknown'>): { open: number; allowed: number; unknown: number } {
  const allowed = model.fuses.filter((f) => f.allowed?.state === 'allowed').length
  return { open: model.fuses.length - allowed, allowed, unknown: model.unknown.length }
}

/**
 * Where each open fuse's settings live (hint.ts `setFuseHints`, §1.20): the decider agent, an agent's server on an MCP
 * way out, every automation and autofill on the path.
 */
export function fuseHints(model: FusedModel): Array<{ kind: HintKind; id: string; fuse: FuseHint }> {
  const mods = new Map(model.modules.map((m) => [m.key, m]))
  const out: Array<{ kind: HintKind; id: string; fuse: FuseHint }> = []
  for (const f of model.fuses) {
    if (f.allowed?.state === 'allowed') continue
    const fuse: FuseHint = { key: f.key, label: f.label }
    for (const k of pathModules(f.chain)) {
      const r = mods.get(k)?.ref
      if (r?.kind === 'agent' && k === f.chain.decider) out.push({ kind: 'agent', id: r.id, fuse })
      else if (r?.kind === 'automation') out.push({ kind: 'automation', id: `${r.db}:${r.id}`, fuse })
      else if (r?.kind === 'autofill') out.push({ kind: 'autofill', id: `${r.db}:${r.prop}`, fuse })
    }
    const key2 = f.keys.find((k) => k.kind === 'cutTools')
    if (key2 && 'server' in key2.target && 'agent' in key2.target) out.push({ kind: 'agentServer', id: `${key2.target.agent}:${key2.target.server}`, fuse })
  }
  return out
}
