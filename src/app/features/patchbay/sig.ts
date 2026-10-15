/**
 * Path keys and allowance signatures (plan §2.7) — pure, ids and digests only.
 *
 *  - `canon(v)`: the Patchbay's own canonical JSON — sorted keys, `undefined` members left out, refuses non-finite
 *    numbers, cycles, functions, symbols and bigints (it throws: a signature over something it cannot spell is no
 *    signature).
 *  - `sha256Hex(text)`: SHA-256 of the text's UTF-8 bytes, synchronous, in plain JS — the same hex WebCrypto gives
 *    (patchbay-fuses.spec compares them). Synchronous on purpose: `buildModel` is pure and synchronous, and a fuse's
 *    label (F-order by path key) and its allowed / lapsed state (what the LED, the Preflight lamp and the readout count)
 *    must exist in the same pass — an async gap would show an allowed fuse as open for a moment. Digests are cached by
 *    their canonical text.
 *  - `pathKey(chainKey)` = sha256Hex(canon(['pb1', chainKey])): a path's identity across sessions (the ids along it).
 *  - `sigInputOf(chain, …)` → the parts (§2.7) as canonical inputs + the modules each part speaks for:
 *      d   the decider (agent: effective write mode, enabled, scope, servers, tool lists, trigger, runner, the Vorprüfer
 *          summary, direct props; autofill: preset / auto / skipReview / source / allowNewOptions; organise; bridge)
 *      a…  each automation on the path (trigger + actions, config fields only; a webhook's FULL URL and its header names
 *          and values as digests — nothing readable is kept; `run_script` with the script's updatedAt)
 *      k…  each kit relay (the own type's value code digest — never this device's trust in it: a sign-off is shared,
 *          trust is per device; fix model)
 *      f…  each field on the path (type, agentReadOnly)
 *      p…  each other processor on the path (a relay agent, autofill, a script, a pipeline) — B4: a relay's settings
 *          change the path as much as the decider's
 *      s…  each server involved (name, host, READ / WRITE? / OUT tool names, the matching profiles' ids + reads + OUT
 *          tools + sends)
 *      o   the outside sources the path's decider reads (fix model): kind, source module, place, and for taint its writer
 *          and where that came from — ids only, withheld ones left out. A new source reaching an allowed path lapses
 *          the allowance ("changed: <source>"): nobody allowed that path.
 *      x   the way out (webhook: host, method, URL + header digests · GitHub push: repo, includePrivate · git: the
 *          action, this device's approvals, the confirm rule · MCP: the server)
 *    At most 24 parts named `[a-z]\d{0,2}` (the sign-off store's limit): a long group folds its tail into its last part.
 *  - `sigOf(input)` → { sig, parts }: each part the first 16 hex of its digest; `sig` = sha256Hex(canon({ v: 'pb1',
 *    parts })).
 *  - `allowedState(stored, now, owners)` → allowed / lapsed with the modules whose parts changed.
 *
 * Bookkeeping never enters a part (an automation's lastRunAt, autofill `fills`, a repeating template's lastRunAt): the
 * input carries config fields only (source.ts).
 */
import { decisionChecks } from '@/shared/ai/route'
import { keyPart } from './ref'
import { placeKey } from './rules'
import { serverToolGroups } from './tools'
import type { Automation } from '../../store/types'
import type { AgentInput, Chain, FuseState, Model, ModelInput, Module, ModuleKey, SignoffEntry } from './types'

/* ------------------------------------------------------------------ canonical JSON */

/** Canonical JSON: sorted keys, `undefined` members dropped (`null` in arrays), throws on what it cannot spell. */
export function canon(v: unknown): string {
  const seen = new Set<object>()
  const walk = (x: unknown): string => {
    if (x === null) return 'null'
    switch (typeof x) {
      case 'string':
        return JSON.stringify(x)
      case 'boolean':
        return x ? 'true' : 'false'
      case 'number':
        if (!Number.isFinite(x)) throw new Error('canon: a number that is not finite')
        return JSON.stringify(x)
      case 'undefined':
        return 'null'
      case 'object': {
        if (seen.has(x as object)) throw new Error('canon: a cycle')
        seen.add(x as object)
        let out: string
        if (Array.isArray(x)) out = `[${x.map(walk).join(',')}]`
        else {
          const o = x as Record<string, unknown>
          out = `{${Object.keys(o)
            .filter((k) => o[k] !== undefined)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${walk(o[k])}`)
            .join(',')}}`
        }
        seen.delete(x as object)
        return out
      }
      default:
        throw new Error(`canon: cannot spell a ${typeof x}`)
    }
  }
  return walk(v)
}

/* ------------------------------------------------------------------ SHA-256 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])
const W = new Uint32Array(64)
const encoder = new TextEncoder()

function digestHex(text: string): string {
  const bytes = encoder.encode(text)
  const len = bytes.length
  const total = (((len + 9 + 63) / 64) | 0) * 64
  const buf = new Uint8Array(total)
  buf.set(bytes)
  buf[len] = 0x80
  const view = new DataView(buf.buffer)
  const bits = len * 8
  view.setUint32(total - 8, Math.floor(bits / 0x100000000))
  view.setUint32(total - 4, bits >>> 0)
  let h0 = 0x6a09e667
  let h1 = 0xbb67ae85
  let h2 = 0x3c6ef372
  let h3 = 0xa54ff53a
  let h4 = 0x510e527f
  let h5 = 0x9b05688c
  let h6 = 0x1f83d9ab
  let h7 = 0x5be0cd19
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = view.getUint32(off + i * 4)
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15]
      const b = W[i - 2]
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10)
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0
    }
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    let f = h5
    let g = h6
    let h = h7
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K[i] + W[i]) | 0
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) | 0
      h = g
      g = f
      f = e
      e = (d + t1) | 0
      d = c
      c = b
      b = a
      a = (t1 + t2) | 0
    }
    h0 = (h0 + a) | 0
    h1 = (h1 + b) | 0
    h2 = (h2 + c) | 0
    h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0
    h5 = (h5 + f) | 0
    h6 = (h6 + g) | 0
    h7 = (h7 + h) | 0
  }
  let out = ''
  for (const x of [h0, h1, h2, h3, h4, h5, h6, h7]) out += (x >>> 0).toString(16).padStart(8, '0')
  return out
}

const CACHE_MAX = 4096
const cache = new Map<string, string>()

/** SHA-256 (hex) of a text's UTF-8 bytes — synchronous; the same as WebCrypto's digest. Cached by text. */
export function sha256Hex(text: string): string {
  let hex = cache.get(text)
  if (hex === undefined) {
    hex = digestHex(text)
    if (cache.size >= CACHE_MAX) cache.clear()
    cache.set(text, hex)
  }
  return hex
}

/** A short digest (16 hex) of a value's canonical text — what a part and a URL / header / code are kept as. */
export const short = (v: unknown): string => sha256Hex(canon(v)).slice(0, 16)

/** A path's identity across sessions: SHA-256 of the ids along it (64 lower hex). */
export const pathKey = (chainKey: string): string => sha256Hex(canon(['pb1', chainKey]))

/* ------------------------------------------------------------------ the parts */

/** The sign-off store's limits (store/fuseSignoffs.ts): ≤ 24 parts, names `[a-z]\d{0,2}`. */
export const MAX_PARTS = 24

export interface SigInput {
  /** part name → its canonical input (ids, flags and digests only) */
  parts: Record<string, unknown>
  /** part name → the modules (or `net:` field keys) it speaks for — a lapse names them */
  owners: Record<string, string[]>
}

/** What sig.ts reads of a model (fuses.ts hands its reach index's maps in; specs pass a model + input). */
export interface SigWorld {
  model: Model
  input: ModelInput
  mods: ReadonlyMap<ModuleKey, Module>
  /** module → the servers cabled to its tools jack */
  servers: (module: ModuleKey) => readonly ModuleKey[]
  /** the module the exit's cable leaves (the automation holding the webhook, the pipeline, the sync, the decider for MCP) */
  exitHolder: (chain: Chain) => ModuleKey | null
}

/** The bare world of a model (Node specs, B10): looks the servers and the exit's holder up from the drawn cables. */
export function sigWorld(model: Model, input: ModelInput): SigWorld {
  const mods = new Map(model.modules.map((m) => [m.key, m]))
  const jackMod = new Map<string, ModuleKey>()
  for (const m of model.modules) for (const j of [...m.inJacks, ...m.outJacks]) jackMod.set(j.key, m.key)
  const servers = new Map<ModuleKey, ModuleKey[]>()
  const edges = new Map(model.edges.map((e) => [e.id, e]))
  for (const e of model.edges) {
    if ((e.kind !== 'reads' && e.kind !== 'out') || !e.to.endsWith('.tools')) continue
    const proc = jackMod.get(e.to)
    const srv = jackMod.get(e.from)
    if (!proc || !srv || mods.get(srv)?.kind !== 'server') continue
    const list = servers.get(proc) ?? []
    if (!list.includes(srv)) list.push(srv)
    servers.set(proc, list)
  }
  return {
    model,
    input,
    mods,
    servers: (m) => [...(servers.get(m) ?? [])].sort(),
    exitHolder: (chain) => {
      const e = chain.exit ? edges.get(chain.exit.edge) : undefined
      if (!e || !chain.exit) return null
      return (chain.exit.type === 'mcp' ? jackMod.get(e.to) : jackMod.get(e.from)) ?? null
    },
  }
}

const sorted = <T>(list: readonly T[]): T[] => [...list].sort((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0))

function agentPart(a: AgentInput): Record<string, unknown> {
  const g = a.agent
  const checks = decisionChecks(g)
  const tools: Record<string, string[]> = {}
  for (const [name, list] of Object.entries(g.mcpTools ?? {})) tools[name] = sorted(list)
  return {
    k: 'agent',
    write: a.write,
    enabled: !!g.enabled,
    scope: { everything: !!g.scope.everything, pages: sorted(g.scope.pages), databases: sorted(g.scope.databases) },
    servers: sorted(g.mcpServers),
    tools,
    trigger: g.trigger,
    runner: g.runner,
    // the Vorprüfer: present, and the Schreibschranke's line ('unreadable': kept as a flag, the agent never runs here)
    checks: checks === null ? null : checks === 'unreadable' ? 'unreadable' : { gate: checks.gate?.allowAt ?? null, hold: !!checks.pre.hold },
    // future hooks, identity today (Regler G2 `effectiveWrite`, Vertrauen S2 `directProps`)
    direct: [],
  }
}

/** An automation's config as a part: a webhook's URL and headers as digests, a script with its version. */
function automationPart(au: Automation, input: ModelInput): Record<string, unknown> {
  return {
    enabled: !!au.enabled,
    trigger: au.trigger,
    actions: au.actions.map((act) => {
      if (act.type === 'webhook') return { type: 'webhook', method: act.method, url: short(act.url ?? ''), headers: short(act.headers ?? {}) }
      if (act.type === 'run_script') return { type: 'run_script', script: act.scriptId ?? null, at: input.scripts.find((s) => s.script.id === act.scriptId)?.script.updatedAt ?? null }
      if (act.type === 'notify') return { type: 'notify' }
      return { type: act.type, body: short(act) }
    }),
  }
}

function processorPart(m: Module, input: ModelInput): Record<string, unknown> | null {
  const r = m.ref
  switch (r.kind) {
    case 'agent': {
      const a = input.agents.find((x) => x.agent.id === r.id)
      return a ? agentPart(a) : null
    }
    case 'autofill': {
      const p = input.databases.find((d) => d.id === r.db)?.properties.find((x) => x.id === r.prop)
      const af = p?.autofill
      return { k: 'autofill', db: r.db, prop: r.prop, preset: af?.preset ?? null, auto: !!af?.auto, skipReview: !!af?.skipReview, source: af?.source ?? null, allowNewOptions: !!af?.allowNewOptions }
    }
    case 'organise':
      return { k: 'organise', enabled: !!input.mail?.organise, db: input.mail?.databaseId ?? null, props: sorted(input.mail?.organiseProps ?? []), related: input.mail?.relationDb ?? null }
    case 'bridge':
      return { k: 'bridge', enabled: input.bridge.enabled, mode: input.bridge.mode }
    case 'script': {
      const s = input.scripts.find((x) => x.script.id === r.id)
      return { k: 'script', id: r.id, at: s?.script.updatedAt ?? null }
    }
    case 'pipeline': {
      const p = input.pipelines.find((x) => x.db === r.db)
      // `next` / `output` only when set (they decide where a task goes and what the worker writes)
      return { k: 'pipeline', db: r.db, stages: (p?.stages ?? []).map((s) => ({ id: s.id, kind: s.kind, auto: !!s.auto, git: s.gitAction ?? null, hold: !!s.hold, ...(s.next ? { next: s.next } : {}), ...(s.output ? { output: s.output } : {}) })) }
    }
    default:
      return null
  }
}

function serverPart(m: Module, input: ModelInput): Record<string, unknown> | null {
  if (m.ref.kind !== 'server') return null
  const g = serverToolGroups(input, m.ref)
  const name = m.ref.name
  const profiles = input.profiles
    .filter((p) => p.servers.includes(name) || g.declaredBy.includes(p.profile.id))
    .map((p) => ({ id: p.profile.id, reads: sorted(p.profile.reads ?? []), out: sorted(p.profile.outTools ?? []), sends: sorted((p.profile.sends ?? []).map((s) => s.tool)) }))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
  return { name, host: g.host, runtime: !!m.ref.runtime, tested: g.groups.tested, read: sorted(g.groups.read), write: sorted(g.groups.write), out: sorted(g.groups.out), profiles }
}

const fieldKey = (db: string, prop: string) => `net:${keyPart(db)}:${keyPart(prop)}`
const isField = (prop: string | undefined): prop is string => !!prop && prop !== '*' && prop !== '+row' && prop !== '-row'

/** The way out as a part. */
function exitPart(chain: Chain, w: SigWorld, holder: ModuleKey | null): Record<string, unknown> {
  const exit = chain.exit
  if (!exit) return { t: 'none' }
  const m = w.mods.get(exit.module)
  const { input } = w
  switch (exit.type) {
    case 'webhook': {
      const ref = m?.ref.kind === 'outbound' ? m.ref : null
      const h = holder ? w.mods.get(holder) : undefined
      const au = h?.ref.kind === 'automation' ? (h.ref as { db: string; id: string }) : null
      const actions = au ? (input.databases.find((d) => d.id === au.db)?.automations.find((a) => a.id === au.id)?.actions ?? []) : []
      const hooks = actions.filter((a): a is Extract<Automation['actions'][number], { type: 'webhook' }> => a.type === 'webhook')
      return { t: 'webhook', host: ref?.host ?? null, method: ref?.method ?? null, urls: sorted(hooks.map((a) => short(a.url ?? ''))), headers: sorted(hooks.map((a) => short(a.headers ?? {}))) }
    }
    case 'sync':
      return { t: 'sync', repo: input.sync.github.repo, includePrivate: input.sync.github.includePrivate, auto: input.sync.github.auto, team: input.ctx.team }
    case 'git': {
      const ref = m?.ref.kind === 'outbound' ? m.ref : null
      return { t: 'git', action: ref?.method ?? null, approvals: input.worker.approvals, confirm: input.worker.confirm, team: input.ctx.team }
    }
    case 'mcp':
      return { t: 'mcp', server: m?.ref.kind === 'server' ? m.ref.name : exit.module }
    default:
      return { t: exit.type, module: exit.module }
  }
}

/** Cap the groups so that every part fits (≤ MAX_PARTS): a long group's tail folds into its last part. */
function fit(groups: Array<{ letter: string; items: Array<{ input: unknown; owners: string[] }> }>, room: number): Array<{ name: string; input: unknown; owners: string[] }> {
  const caps = groups.map((g) => g.items.length)
  while (caps.reduce((s, n) => s + n, 0) > room) {
    let big = 0
    for (let i = 1; i < caps.length; i++) if (caps[i] > caps[big]) big = i
    caps[big]--
  }
  const out: Array<{ name: string; input: unknown; owners: string[] }> = []
  groups.forEach((g, gi) => {
    const cap = caps[gi]
    if (!cap) return
    for (let i = 0; i < cap; i++) {
      if (i < cap - 1 || g.items.length <= cap) {
        out.push({ name: `${g.letter}${i}`, input: g.items[i].input, owners: g.items[i].owners })
        continue
      }
      // the rest of the group in one part
      const rest = g.items.slice(i)
      out.push({ name: `${g.letter}${i}`, input: { rest: rest.map((x) => x.input) }, owners: [...new Set(rest.flatMap((x) => x.owners))] })
    }
  })
  return out
}

/** The parts of a chain's path (§2.7) — canonical inputs and owners. */
export function sigInputOf(chain: Chain, w: SigWorld): SigInput {
  const { input } = w
  const parts: Record<string, unknown> = {}
  const owners: Record<string, string[]> = {}
  const decider = chain.decider ? w.mods.get(chain.decider) : undefined
  parts.d = decider ? (processorPart(decider, input) ?? { k: decider.kind }) : { k: 'none' }
  owners.d = chain.decider ? [chain.decider] : []

  // the modules along the path, in order (the exit itself is `x`)
  const path: ModuleKey[] = []
  for (const s of chain.steps) if (typeof s.to === 'string' && s.to !== chain.exit?.module && !path.includes(s.to)) path.push(s.to)
  const holder = w.exitHolder(chain)

  const a: Array<{ input: unknown; owners: string[] }> = []
  const k: Array<{ input: unknown; owners: string[] }> = []
  const p: Array<{ input: unknown; owners: string[] }> = []
  for (const key of path) {
    const m = w.mods.get(key)
    if (!m || key === chain.decider) continue
    if (m.ref.kind === 'automation') {
      const r = m.ref
      const au = input.databases.find((d) => d.id === r.db)?.automations.find((x) => x.id === r.id)
      a.push({ input: au ? automationPart(au, input) : { gone: key }, owners: [key] })
    } else if (m.ref.kind === 'kit') {
      const r = m.ref
      const kit = input.kit.find((x) => x.db === r.db && x.prop === r.prop)
      // the value code only: whether THIS device trusts it is device bookkeeping (a sign-off is shared)
      k.push({ input: { type: r.type, code: kit?.code ?? null }, owners: [key] })
    } else {
      const part = processorPart(m, input)
      if (part) p.push({ input: part, owners: [key] })
    }
  }

  // fields on the path (a write's place, a listener's place)
  const f: Array<{ input: unknown; owners: string[] }> = []
  const seenField = new Set<string>()
  for (const s of chain.steps)
    for (const pl of [s.via, typeof s.to === 'string' ? undefined : s.to]) {
      if (!pl || !('db' in pl) || !isField(pl.prop)) continue
      const fk = fieldKey(pl.db, pl.prop)
      if (seenField.has(fk)) continue
      seenField.add(fk)
      const prop = input.databases.find((d) => d.id === pl.db)?.properties.find((x) => x.id === pl.prop)
      f.push({ input: { db: pl.db, prop: pl.prop, type: prop?.type ?? null, agentReadOnly: !!prop?.agentReadOnly }, owners: [fk] })
    }

  // servers involved: those cabled to the decider and to every processor on the path, and an MCP exit's own
  const srvs: ModuleKey[] = []
  for (const key of [chain.decider, ...path].filter((x): x is ModuleKey => !!x)) for (const s of w.servers(key)) if (!srvs.includes(s)) srvs.push(s)
  if (chain.exit?.type === 'mcp' && !srvs.includes(chain.exit.module)) srvs.push(chain.exit.module)
  srvs.sort()
  const s: Array<{ input: unknown; owners: string[] }> = []
  for (const key of srvs) {
    const m = w.mods.get(key)
    const part = m ? serverPart(m, input) : null
    if (part) s.push({ input: part, owners: [key] })
  }

  for (const part of fit(
    [
      { letter: 'a', items: a },
      { letter: 'k', items: k },
      { letter: 'f', items: f },
      { letter: 'p', items: p },
      { letter: 's', items: s },
    ],
    MAX_PARTS - 3,
  )) {
    parts[part.name] = part.input
    owners[part.name] = part.owners
  }
  // the outside sources (ids only): a new one reaching the path lapses its allowance
  const outside = (chain.why?.outside ?? [])
    .filter((src) => !src.withheld)
    .map((src) => ({ kind: src.kind, source: src.source, place: src.place ? placeKey(src.place) : null, writer: src.writer ?? null, from: src.from ?? null }))
    .sort((a, b) => (canon(a) < canon(b) ? -1 : 1))
  parts.o = outside
  owners.o = [...new Set(outside.flatMap((src) => [src.source, ...(src.writer ? [src.writer] : [])]))]
  parts.x = exitPart(chain, w, holder)
  owners.x = chain.exit ? [chain.exit.module, ...(holder && holder !== chain.decider && chain.exit.type !== 'mcp' ? [holder] : [])] : []
  return { parts, owners }
}

/** The signature of a path: each part's short digest, and the digest over all of them. */
export function sigOf(si: SigInput): { sig: string; parts: Record<string, string> } {
  const parts: Record<string, string> = {}
  for (const name of Object.keys(si.parts).sort()) parts[name] = short(si.parts[name])
  return { sig: sha256Hex(canon({ v: 'pb1', parts })), parts }
}

/**
 * A stored allowance against the path now: allowed (the same sig), or lapsed — with the modules whose parts changed
 * (a part gone or new counts as changed; its owners now, else the decider). Null: nothing stored for the path.
 */
export function allowedState(stored: SignoffEntry | undefined, now: { sig: string; parts: Record<string, string> }, owners: Record<string, string[]>): FuseState['allowed'] | undefined {
  if (!stored) return undefined
  if (stored.sig === now.sig) return { state: 'allowed', at: stored.at, by: stored.updatedBy, changed: [] }
  const changed: string[] = []
  const names = [...new Set([...Object.keys(stored.parts ?? {}), ...Object.keys(now.parts)])].sort((a, b) => (a === 'd' ? -1 : b === 'd' ? 1 : a < b ? -1 : 1))
  for (const name of names) {
    if (stored.parts?.[name] === now.parts[name]) continue
    for (const o of owners[name] ?? owners.d ?? []) if (!changed.includes(o)) changed.push(o)
  }
  return { state: 'lapsed', at: stored.at, by: stored.updatedBy, changed }
}
