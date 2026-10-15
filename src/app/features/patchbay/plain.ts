/**
 * "§ In plain words" / "§ Im Klartext" (plan §3.6) — pure: the model in sentences, EN + DE from `features.patchbay.*`
 * (messages-fuses.ts), names looked up live from the model input (titles, agent / automation / script names, property
 * names — the model itself holds ids only).
 *
 *  - `plainOf(model, input, ctx)` → one strand per drawn processor (agents, automations, scripts, autofill, mail
 *    sorting, computed values, pipelines, the bridge) and per source that acts on its own (repeating templates, buttons
 *    and commands that send or add rows, incoming webhooks, the syncs, Clippings): who starts it, what it reads, writes
 *    and sends, and the fuses it sits on. Parts carry `b` for names (the page bolds them).
 *  - `describe(model, input, key, ctx)` → a module's one-line description for `aria-describedby` ("Agent „Inbox-Helfer“
 *    · on every new row in „Mails“ (from outside) · can set „Weiterleiten“ in „Mails“ · fuse F1").
 *  - `fuseSay(fuse, model, input, ctx)` → the plate's sentence ("If the agent „Inbox-Helfer“ sets „Weiterleiten“
 *    without review, the automation „An Team-Chat“ sends the row out by webhook. A mail with a hidden instruction can
 *    get what the agent read sent.").
 *  - `sayMsg(msg, model, input, ctx)` → a lamp / fact / key MsgRef in words (id vars resolved: {db} {page} {title}
 *    titles, {prop} a property, module keys names, {place} a place, {cls} a data class; `.one` for n = 1).
 *
 * German without pronouns (§6 U31): every sentence repeats the kind noun and the name — "Der Agent „Inbox-Helfer“
 * liest …", never "Er liest …"; names always in „…“.
 */
import { serverToolGroups, toolUse } from './tools'
import { placeKey } from './rules'
import type { Chain, Edge, Fuse, Model, ModelInput, Module, ModuleKey, MsgRef, Place } from './types'

export type Lang = 'en' | 'de'

/** One run of text; `b`: a name (bold on the page). */
export interface Part {
  t: string
  b?: true
}

/** One strand: the sentences of one module. */
export interface Strand {
  module: ModuleKey
  parts: Part[]
}

export interface PlainCtx {
  lang: Lang
  /** the translator (the app's `t` / `useT()`; Node specs build one from messages-fuses.ts) */
  t: (key: string, vars?: Record<string, string | number>) => string
}

type Val = Part[] | string | number

const P = 'features.patchbay'

/** The text of parts. */
export const text = (parts: readonly Part[]): string => parts.map((p) => p.t).join('')

const upperFirst = (s: string): string => (s ? s[0].toLocaleUpperCase() + s.slice(1) : s)
const lowerFirst = (s: string): string => (s ? s[0].toLocaleLowerCase() + s.slice(1) : s)

/** Merge neighbouring runs of the same weight. */
function merged(parts: Part[]): Part[] {
  const out: Part[] = []
  for (const p of parts) {
    if (!p.t) continue
    const last = out[out.length - 1]
    if (last && !!last.b === !!p.b) last.t += p.t
    else out.push(p.b ? { t: p.t, b: true } : { t: p.t })
  }
  return out
}

/** A raw template with its vars filled as parts ({Who} = {who} with a capital first letter). */
function fill(raw: string, vars: Record<string, Val>): Part[] {
  const out: Part[] = []
  const re = /\{(\w+)\}/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    if (m.index > last) out.push({ t: raw.slice(last, m.index) })
    const name = m[1]
    let v = vars[name]
    let cap = false
    if (v === undefined && /^[A-Z]/.test(name)) {
      v = vars[lowerFirst(name)]
      cap = true
    }
    if (v === undefined) out.push({ t: m[0] })
    else if (Array.isArray(v)) {
      const parts = v.map((p) => ({ ...p }))
      if (cap && parts.length) parts[0].t = upperFirst(parts[0].t)
      out.push(...parts)
    } else out.push({ t: cap ? upperFirst(String(v)) : String(v) })
    last = re.lastIndex
  }
  if (last < raw.length) out.push({ t: raw.slice(last) })
  return merged(out)
}

/* ------------------------------------------------------------------ the world: names and lookups */

interface World {
  model: Model
  input: ModelInput
  ctx: PlainCtx
  mods: Map<ModuleKey, Module>
  jackMod: Map<string, ModuleKey>
  into: Map<ModuleKey, Edge[]>
  from: Map<ModuleKey, Edge[]>
}

const worlds = new WeakMap<Model, Map<string, World>>()

function worldOf(model: Model, input: ModelInput, ctx: PlainCtx): World {
  let byCtx = worlds.get(model)
  if (!byCtx) worlds.set(model, (byCtx = new Map()))
  const k = ctx.lang
  const had = byCtx.get(k)
  if (had && had.input === input && had.ctx.t === ctx.t) return had
  const mods = new Map(model.modules.map((m) => [m.key, m]))
  const jackMod = new Map<string, ModuleKey>()
  for (const m of model.modules) for (const j of [...m.inJacks, ...m.outJacks]) jackMod.set(j.key, m.key)
  const into = new Map<ModuleKey, Edge[]>()
  const from = new Map<ModuleKey, Edge[]>()
  for (const e of model.edges) {
    const a = jackMod.get(e.from)
    const b = jackMod.get(e.to)
    if (a) from.set(a, [...(from.get(a) ?? []), e])
    if (b) into.set(b, [...(into.get(b) ?? []), e])
  }
  const w: World = { model, input, ctx, mods, jackMod, into, from }
  byCtx.set(k, w)
  return w
}

/** A key's words ({n} picks the `.one` twin for 1). */
function say(w: World, key: string, vars: Record<string, Val> = {}): Part[] {
  const n = vars.n
  let k = key
  if (n === 1) {
    const one = `${key}.one`
    if (w.ctx.t(one) !== one) k = one
  }
  return fill(w.ctx.t(k), vars)
}

const sayText = (w: World, key: string, vars: Record<string, Val> = {}): string => text(say(w, key, vars))

const titleOf = (w: World, id: string | null | undefined): string => (id ? w.input.pages[id]?.title.trim() : '') || w.ctx.t(`${P}.untitled`)
const propOf = (w: World, db: string, prop: string): string => w.input.databases.find((d) => d.id === db)?.properties.find((p) => p.id === prop)?.name.trim() || w.ctx.t(`${P}.untitled`)

/** A name as a bold part in „…“. */
const q = (name: string): Part[] => [{ t: '„' }, { t: name, b: true }, { t: '“' }]

/** A module's name in plain text (no quotes) — live from the input. */
export function moduleName(w: World, key: ModuleKey): string {
  const m = w.mods.get(key)
  const t = (k: string, v: Record<string, string> = {}) => sayText(w, k, v)
  if (!m) return key
  const r = m.ref
  switch (r.kind) {
    case 'server':
      return r.name
    case 'clock':
      return r.template ? t(`${P}.name.repeat`, { db: titleOf(w, r.template.db) }) : text(whenOfSchedule(w, r.schedule))
    case 'rowTrigger':
      if (r.event === 'created') return t(`${P}.name.rowTrigger.created`, { db: titleOf(w, r.db) })
      if (r.event === 'deleted') return t(`${P}.name.rowTrigger.deleted`, { db: titleOf(w, r.db) })
      return r.prop && r.prop !== '*' ? t(`${P}.name.rowTrigger.prop`, { db: titleOf(w, r.db), prop: propOf(w, r.db, r.prop) }) : t(`${P}.name.rowTrigger.any`, { db: titleOf(w, r.db) })
    case 'button':
      return t(`${P}.name.button`, { page: titleOf(w, r.page) })
    case 'command': {
      if (r.command.startsWith('send:')) return t(`${P}.module.outbox.name`, { route: r.command.split(':').slice(2).join(':') })
      const cmd = w.input.databases.find((d) => d.id === r.db)?.commands.find((c) => c.id === r.command)
      return cmd?.label?.trim() || w.ctx.t(`${P}.untitled`)
    }
    case 'incoming':
      if (r.agent) return t(`${P}.name.incomingAgent`, { agent: agentName(w, r.agent) })
      if (r.hook?.startsWith('api:')) return t(`${P}.name.incomingApi`)
      if (r.hook) return t(`${P}.name.incoming`, { hook: r.hook })
      return t(`${P}.name.incomingAny`)
    case 'sync':
      return t(r.source === 'github' ? `${P}.name.syncGithub` : `${P}.name.syncFolder`)
    case 'clippings':
      return t(`${P}.name.clippings`, { page: titleOf(w, r.inbox) })
    case 'agent':
      return agentName(w, r.id)
    case 'automation':
      return w.input.databases.find((d) => d.id === r.db)?.automations.find((a) => a.id === r.id)?.name.trim() || w.ctx.t(`${P}.untitled`)
    case 'script':
      return w.input.scripts.find((s) => s.script.id === r.id)?.script.name.trim() || w.ctx.t(`${P}.untitled`)
    case 'autofill':
      return t(`${P}.name.autofill`, { db: titleOf(w, r.db), prop: propOf(w, r.db, r.prop) })
    case 'organise':
      return t(`${P}.name.organise`)
    case 'pipeline':
      return titleOf(w, r.db)
    case 'bridge':
      return t(`${P}.name.bridge`)
    case 'kit':
      return t(`${P}.name.kit`, { db: titleOf(w, r.db), prop: propOf(w, r.db, r.prop) })
    case 'database':
    case 'page':
      return titleOf(w, r.id)
    case 'inbox':
      return t(`${P}.name.inbox`)
    case 'everything':
      return t(`${P}.name.everything`)
    case 'outbound':
      if (r.exit === 'sync') return t(`${P}.name.githubPush`, { host: r.host ?? '' })
      if (r.host) return t(`${P}.name.outbound`, { exit: t(`${P}.exit.${r.exit}`), host: r.host })
      return r.exit === 'git' && r.method ? t(`${P}.name.outbound`, { exit: t(`${P}.exit.git`), host: r.method }) : t(`${P}.exit.${r.exit}`)
    case 'outbox':
      return t(`${P}.module.outbox.name`, { route: r.route })
  }
}

const agentName = (w: World, id: string): string => w.input.agents.find((a) => a.agent.id === id)?.agent.name.trim() || w.ctx.t(`${P}.untitled`)

/** A place in plain text ("„Weiterleiten“ in Mails", "Mails", "Whole workspace"). */
function placeName(w: World, p: Place): string {
  if ('db' in p) {
    const prop = p.prop
    if (!prop || prop === '*') return titleOf(w, p.db)
    if (prop === '+row' || prop === '-row') return sayText(w, `${P}.name.newRows`, { db: titleOf(w, p.db) })
    return sayText(w, `${P}.name.field`, { prop: propOf(w, p.db, prop), db: titleOf(w, p.db) })
  }
  if ('page' in p) return titleOf(w, p.page)
  if ('inbox' in p) return w.ctx.t(`${P}.name.inbox`)
  if ('everything' in p) return w.ctx.t(`${P}.name.everything`)
  return p.external
}

/** A place key back to its place (`<db>:<prop>` · `page:<id>` · `inbox` · `everything` · `ext:<x>`). */
function placeOfKey(key: string): Place {
  if (key === 'inbox') return { inbox: true }
  if (key === 'everything') return { everything: true }
  if (key.startsWith('page:')) return { page: key.slice(5) }
  if (key.startsWith('ext:')) return { external: key.slice(4) }
  const cut = key.lastIndexOf(':')
  return cut > 0 ? { db: key.slice(0, cut), prop: key.slice(cut + 1) as '*' } : { db: key }
}

/** A list of parts joined with ", " and " and " / " or ". */
function list(w: World, items: Part[][], how: 'and' | 'or' = 'and'): Part[] {
  const out: Part[] = []
  items.forEach((it, i) => {
    if (i > 0) out.push({ t: w.ctx.t(i === items.length - 1 ? `${P}.plain.join.${how}` : `${P}.plain.join.comma`) })
    out.push(...it)
  })
  return merged(out)
}

/* ------------------------------------------------------------------ starts */

function whenOfSchedule(w: World, schedule: string): Part[] {
  const [every, at, weekday, day] = schedule.split('|')
  if (every === 'hour') return say(w, `${P}.plain.when.hour`, { min: at })
  if (every === 'week') {
    const name = new Intl.DateTimeFormat(w.ctx.lang, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 9, 4 + Number(weekday || 0))))
    return say(w, `${P}.plain.when.week`, { day: name, at })
  }
  if (every === 'month') return say(w, `${P}.plain.when.month`, { day: day || '1', at })
  if (every === 'weekday') return say(w, `${P}.plain.when.weekday`, { at })
  return say(w, `${P}.plain.when.day`, { at })
}

function whenOfPlace(w: World, p: Place, opts: { outside?: boolean; remote?: boolean } = {}): Part[] {
  if (!('db' in p)) return say(w, `${P}.plain.when.any`, { db: q(placeName(w, p)) })
  const db = q(titleOf(w, p.db))
  const prop = p.prop ?? '*'
  let parts: Part[]
  if (prop === '+row') parts = say(w, `${P}.plain.when.created`, { db })
  else if (prop === '-row') parts = say(w, `${P}.plain.when.deleted`, { db })
  else if (prop === '*') parts = say(w, opts.remote ? `${P}.plain.when.anyRemote` : `${P}.plain.when.any`, { db })
  else parts = say(w, `${P}.plain.when.prop`, { prop: q(propOf(w, p.db, prop)), db })
  return opts.outside ? say(w, `${P}.plain.when.outside`, { when: parts }) : parts
}

/** What starts a module, one phrase per start cable ("On every new row in „Mails“ (from outside)"). */
function startsOf(w: World, key: ModuleKey): Part[][] {
  const m = w.mods.get(key)
  const out: Part[][] = []
  const seen = new Set<string>()
  for (const e of w.into.get(key) ?? []) {
    if (e.to !== `${key}.start` || (e.kind !== 'starts' && e.kind !== 'relay')) continue
    let parts: Part[] | null = null
    if (e.from.startsWith('net:')) {
      const net = w.model.nets.find((n) => n.key === e.from)
      if (net) parts = whenOfPlace(w, net.place, { remote: m?.kind === 'kit' })
    } else {
      const src = w.mods.get(w.jackMod.get(e.from) ?? '')
      const r = src?.ref
      if (r?.kind === 'rowTrigger') {
        const prop = r.event === 'created' ? '+row' : r.event === 'deleted' ? '-row' : (r.prop ?? '*')
        parts = whenOfPlace(w, { db: r.db, prop: prop as '*' }, { outside: src!.tags.includes('outside'), remote: m?.kind === 'kit' })
      } else if (r?.kind === 'clock') parts = r.template ? say(w, `${P}.plain.when.repeat`, { db: q(titleOf(w, r.template.db)) }) : whenOfSchedule(w, r.schedule)
      else if (r?.kind === 'command') parts = say(w, `${P}.plain.when.command`, { name: q(moduleName(w, src!.key)), db: q(titleOf(w, r.db)) })
      else if (r?.kind === 'button') parts = say(w, `${P}.plain.when.button`, { page: q(titleOf(w, r.page)) })
      else if (r?.kind === 'incoming') parts = say(w, `${P}.plain.when.hook`)
      else if (r?.kind === 'automation') parts = say(w, `${P}.plain.when.automation`, { name: q(moduleName(w, src!.key)) })
    }
    if (!parts) continue
    const k = text(parts)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(parts)
  }
  return out
}

/* ------------------------------------------------------------------ who */

function who(w: World, key: ModuleKey): Part[] {
  const m = w.mods.get(key)
  if (!m) return [{ t: key }]
  const r = m.ref
  const name = q(moduleName(w, key))
  switch (r.kind) {
    case 'agent':
    case 'automation':
    case 'script':
    case 'pipeline':
      return say(w, `${P}.plain.who.${r.kind}`, { name })
    case 'autofill':
    case 'kit':
      return say(w, `${P}.plain.who.${r.kind}`, { prop: q(propOf(w, r.db, r.prop)), db: q(titleOf(w, r.db)) })
    case 'organise':
      return say(w, `${P}.plain.who.organise`, { db: q(titleOf(w, r.db)) })
    case 'bridge':
      return say(w, `${P}.plain.who.bridge`)
    case 'button':
      return say(w, `${P}.plain.who.button`, { page: q(titleOf(w, r.page)) })
    case 'command':
      return say(w, `${P}.plain.who.command`, { name, db: q(titleOf(w, r.db)) })
    case 'clock':
      return say(w, `${P}.plain.who.clock`, { db: q(titleOf(w, r.template?.db ?? '')) })
    case 'incoming':
      return say(w, `${P}.plain.who.incoming`, { name: q(r.hook ?? moduleName(w, key)) })
    case 'sync':
      return say(w, r.source === 'github' ? `${P}.plain.who.syncGithub` : `${P}.plain.who.syncFolder`)
    case 'clippings':
      return say(w, `${P}.plain.who.clippings`)
    default:
      return name
  }
}

/* ------------------------------------------------------------------ clauses */

/** The server tool counts a processor gets (its allow-list applied). */
function toolCounts(w: World, proc: Module, server: Module): { read: number | null; write: number | null } {
  if (server.ref.kind !== 'server') return { read: null, write: null }
  const g = serverToolGroups(w.input, server.ref)
  const ai = proc.ref.kind === 'agent' ? w.input.agents.find((a) => a.agent.id === (proc.ref as { id: string }).id) : undefined
  const use = toolUse(g.groups, ai?.agent.mcpTools?.[server.ref.name], g.profiles)
  return { read: use.read === null ? null : use.read.length, write: use.write === null ? null : use.write.length }
}

function serverClauses(w: World, m: Module): { reads: Part[][]; writes: Part[][] } {
  const reads: Part[][] = []
  const writes: Part[][] = []
  for (const e of w.into.get(m.key) ?? []) {
    if (e.to !== `${m.key}.tools`) continue
    const s = w.mods.get(w.jackMod.get(e.from) ?? '')
    if (!s) continue
    const counts = toolCounts(w, m, s)
    const server = q(moduleName(w, s.key))
    if (e.kind === 'reads') reads.push(counts.read === null ? say(w, `${P}.plain.c.readsServerUnknown`, { server }) : say(w, `${P}.plain.c.readsServer`, { server, n: counts.read }))
    else if (e.kind === 'out') writes.push(e.failClosed || counts.write === null ? say(w, `${P}.plain.c.everyTool`, { server }) : say(w, `${P}.plain.c.writeTools`, { server, n: counts.write }))
  }
  return { reads, writes }
}

/** The places a module's drawn write cables reach, grouped: whole workspace, fields, databases / pages, report, notes. */
function writeTargets(w: World, m: Module): { everything: boolean; fields: Part[][]; places: Part[][]; report: Part[] | null; notes: boolean; solid: Part[][] } {
  const res = { everything: false, fields: [] as Part[][], places: [] as Part[][], report: null as Part[] | null, notes: false, solid: [] as Part[][] }
  const seen = new Set<string>()
  for (const e of w.from.get(m.key) ?? []) {
    if (e.kind !== 'writes' || !e.place) continue
    const role = e.from.slice(e.from.lastIndexOf('.') + 1)
    const p = e.place
    const k = `${role}|${placeKey(p)}`
    if (seen.has(k)) continue
    seen.add(k)
    if (role === 'report' && 'page' in p) res.report = q(titleOf(w, p.page))
    else if (role === 'notes') res.notes = true
    else if ('everything' in p) res.everything = true
    else if ('db' in p && p.prop && p.prop !== '*' && p.prop !== '+row' && p.prop !== '-row') res.fields.push([...q(propOf(w, p.db, p.prop)), { t: ' ' }, ...say(w, `${P}.plain.join.in`), ...q(titleOf(w, p.db))])
    else {
      const id = 'db' in p ? p.db : 'page' in p ? p.page : ''
      const key = `place|${id}`
      if (seen.has(key)) continue
      seen.add(key)
      ;(e.can ? res.places : res.solid).push(q(titleOf(w, id)))
    }
  }
  return res
}

function agentClauses(w: World, m: Module): Part[][] {
  const ai = m.ref.kind === 'agent' ? w.input.agents.find((a) => a.agent.id === (m.ref as { id: string }).id) : undefined
  const out: Part[][] = []
  const startDbs = new Set<string>()
  const t = ai?.agent.trigger
  if (t && (t.type === 'row_created' || t.type === 'row_changed')) startDbs.add(t.databaseId)
  const reads = m.nets.filter((n) => !('db' in n.place && startDbs.has(n.place.db)))
  if (reads.some((n) => 'everything' in n.place)) out.push(say(w, `${P}.plain.c.readsAll`))
  else if (reads.length) out.push(say(w, `${P}.plain.c.reads`, { places: list(w, reads.map((n) => q(placeName(w, n.place)))) }))
  const tools = serverClauses(w, m)
  out.push(...tools.reads)
  const stage = ai?.write === 'stage'
  const wt = writeTargets(w, m)
  if (wt.everything) out.push(say(w, stage ? `${P}.plain.c.proposesAll` : `${P}.plain.c.writesAll`))
  if (wt.solid.length) out.push(say(w, stage ? `${P}.plain.c.proposes` : `${P}.plain.c.writes`, { places: list(w, wt.solid) }))
  if (wt.places.length) out.push(say(w, stage ? `${P}.plain.c.proposes` : `${P}.plain.c.canWrite`, { places: list(w, wt.places) }))
  if (wt.fields.length) out.push(say(w, stage ? `${P}.plain.c.proposesSet` : `${P}.plain.c.canSet`, { fields: list(w, wt.fields) }))
  if (wt.report) out.push(say(w, `${P}.plain.c.report`, { page: wt.report }))
  if (wt.notes) out.push(say(w, `${P}.plain.c.notes`))
  out.push(...tools.writes)
  return out
}

function hostOf(url: unknown): string {
  if (typeof url !== 'string') return ''
  try {
    return new URL(url.trim()).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function automationClauses(w: World, m: Module): Part[][] {
  if (m.ref.kind !== 'automation') return []
  const r = m.ref
  const db = w.input.databases.find((d) => d.id === r.db)
  const au = db?.automations.find((a) => a.id === r.id)
  const out: Part[][] = []
  for (const act of au?.actions ?? []) {
    if (act.type === 'webhook') out.push(say(w, `${P}.plain.c.webhook`, { host: hostOf(act.url) }))
    else if (act.type === 'set_property' && act.propertyId) out.push(say(w, `${P}.plain.c.sets`, { fields: q(propOf(w, r.db, act.propertyId)) }))
    else if (act.type === 'notify') out.push(say(w, `${P}.plain.c.notify`))
    else if (act.type === 'run_script' && act.scriptId) {
      const script = q(w.input.scripts.find((s) => s.script.id === act.scriptId)?.script.name.trim() || w.ctx.t(`${P}.untitled`))
      if (m.folds?.script === act.scriptId) {
        out.push(say(w, `${P}.plain.c.runsScript`, { script }))
        // the folded script's own writes (the automation's set_property places are said above)
        const own = new Set((au?.actions ?? []).flatMap((a) => (a.type === 'set_property' ? [`${r.db}:${a.propertyId}`] : [])))
        const places = (w.model.flow?.writes[m.key] ?? []).filter((x) => !own.has(placeKey(x.place)))
        const names = [...new Set(places.map((x) => ('db' in x.place ? titleOf(w, x.place.db) : placeName(w, x.place))))]
        if (names.length) out.push(say(w, `${P}.plain.c.writes`, { places: list(w, names.map(q)) }))
      } else out.push(say(w, `${P}.plain.c.startsScript`, { script }))
    }
  }
  out.push(...effectClauses(w, m))
  return out
}

/** Outbound cables of a module: script effects, git actions, webhooks of buttons and commands, the Outbox. */
function effectClauses(w: World, m: Module): Part[][] {
  const out: Part[][] = []
  for (const e of w.from.get(m.key) ?? []) {
    if (e.kind !== 'out') continue
    const t = w.mods.get(w.jackMod.get(e.to) ?? '')
    if (t?.ref.kind === 'outbox') {
      out.push(say(w, `${P}.plain.c.outbox`))
      continue
    }
    if (t?.ref.kind !== 'outbound') continue
    const r = t.ref
    let what: Part[] | null = null
    if (r.exit === 'http') what = say(w, `${P}.plain.c.http`)
    else if (r.exit === 'mail') what = say(w, `${P}.plain.c.mail`)
    else if (r.exit === 'git') what = say(w, `${P}.plain.c.git.${r.method ?? 'push'}`)
    else if (r.exit === 'webhook' && m.kind !== 'automation') what = say(w, `${P}.plain.c.webhook`, { host: r.host ?? '' })
    if (!what) continue
    if (r.exit === 'git') what = say(w, e.afterApproval ? `${P}.plain.c.afterApproval` : `${P}.plain.c.outbound`, { what })
    else if (e.byHand) what = say(w, `${P}.plain.c.byHand`, { what })
    out.push(what)
  }
  return out
}

function scriptClauses(w: World, m: Module): Part[][] {
  const out: Part[][] = []
  const reads = m.nets
  if (reads.length) out.push(say(w, `${P}.plain.c.reads`, { places: list(w, reads.map((n) => q(placeName(w, n.place)))) }))
  const wt = writeTargets(w, m)
  const places = [...wt.solid, ...wt.places, ...wt.fields]
  if (places.length) out.push(say(w, `${P}.plain.c.writes`, { places: list(w, places) }))
  out.push(...effectClauses(w, m))
  return out
}

/* ------------------------------------------------------------------ strands */

/** The fuses (open) a module sits on: "On fuse F1." */
function fusesOn(w: World, key: ModuleKey): string[] {
  const out: string[] = []
  for (const f of w.model.fuses as Array<Fuse & { allowed?: { state: string } }>) {
    if (f.allowed?.state === 'allowed') continue
    const on = f.chain.decider === key || f.chain.exit?.module === key || f.chain.steps.some((s) => s.to === key)
    if (on) out.push(f.label)
  }
  return out
}

function fuseLine(w: World, key: ModuleKey): Part[] {
  const labels = fusesOn(w, key)
  if (!labels.length) return []
  return [{ t: ' ' }, ...say(w, labels.length === 1 ? `${P}.plain.onFuse` : `${P}.plain.onFuses`, { f: labels.join(', ') })]
}

const sentence = (w: World, whoParts: Part[], clauses: Part[][]): Part[] => (clauses.length ? say(w, `${P}.plain.does`, { who: whoParts, clauses: list(w, clauses) }) : [])

/** What a processor does, as clauses (the strand's second sentence and the module's description). */
function clausesOf(w: World, m: Module): Part[][] {
  const r = m.ref
  switch (r.kind) {
    case 'agent':
      return agentClauses(w, m)
    case 'automation':
      return automationClauses(w, m)
    case 'script':
      return scriptClauses(w, m)
    case 'autofill': {
      const clauses: Part[][] = [say(w, `${P}.plain.c.fills`, { prop: q(propOf(w, r.db, r.prop)) })]
      const related = m.nets.filter((n) => 'db' in n.place && n.place.db !== r.db)
      if (related.length) clauses.push(say(w, `${P}.plain.c.readsTitles`, { places: list(w, related.map((n) => q(placeName(w, n.place)))) }))
      const tools = serverClauses(w, m)
      return [...clauses, ...tools.reads, ...tools.writes]
    }
    case 'organise': {
      const fields = (w.input.mail?.organiseProps ?? []).map((p) => q(propOf(w, r.db ?? '', p)))
      const clauses: Part[][] = [fields.length ? say(w, `${P}.plain.c.sorts`, { fields: list(w, fields) }) : say(w, `${P}.plain.c.sortsOnly`)]
      if (w.input.mail?.relationDb) clauses.push(say(w, `${P}.plain.c.readsTitles`, { places: q(titleOf(w, w.input.mail.relationDb)) }))
      return clauses
    }
    case 'kit':
      return [say(w, `${P}.plain.c.recomputes`, { prop: q(propOf(w, r.db, r.prop)) })]
    case 'pipeline':
      return effectClauses(w, m)
    case 'bridge': {
      const mode = w.input.bridge.mode
      return [say(w, `${P}.plain.c.readsAll`), ...(mode === 'apply' ? [say(w, `${P}.plain.c.writesAll`)] : mode === 'ask' ? [say(w, `${P}.plain.c.asksFirst`)] : [])]
    }
    default:
      return []
  }
}

function processorStrand(w: World, m: Module): Part[] {
  const whoParts = who(w, m.key)
  const out: Part[] = []
  if (m.ref.kind === 'pipeline') {
    const clauses = clausesOf(w, m)
    out.push(...say(w, `${P}.plain.pipeline`, { who: whoParts, db: q(titleOf(w, m.ref.db)), and: clauses.length ? say(w, `${P}.plain.pipelineAnd`, { clauses: list(w, clauses) }) : '' }))
  } else if (m.ref.kind === 'bridge') out.push(...say(w, `${P}.plain.bridge.${w.input.bridge.mode}`))
  else {
    const starts = startsOf(w, m.key)
    if (m.ref.kind === 'agent' && m.tags.includes('disabled')) out.push(...say(w, `${P}.plain.startOff`, { who: whoParts }))
    else if (starts.length) out.push(...say(w, `${P}.plain.start`, { when: list(w, starts, 'or'), who: whoParts }))
    else out.push(...say(w, `${P}.plain.startHand`, { who: whoParts }))
    const does = sentence(w, whoParts, clausesOf(w, m))
    if (does.length) out.push({ t: ' ' }, ...does)
  }
  out.push(...fuseLine(w, m.key))
  return merged(out)
}

/** A source that acts on its own (not only by starting a processor): what it does. */
function sourceStrand(w: World, m: Module): Part[] {
  const whoParts = who(w, m.key)
  const clauses: Part[][] = []
  const r = m.ref
  const rowDbs = [...new Set((w.from.get(m.key) ?? []).filter((e) => e.kind === 'writes' && e.place && 'db' in e.place).map((e) => (e.place as { db: string }).db))]
  switch (r.kind) {
    case 'clock':
      if (!r.template) return []
      for (const db of rowDbs) clauses.push(say(w, `${P}.plain.c.newRows`, { db: q(titleOf(w, db)) }))
      break
    case 'button':
    case 'command':
      for (const db of rowDbs) clauses.push(say(w, `${P}.plain.c.byHand`, { what: say(w, `${P}.plain.c.addsRow`, { db: q(titleOf(w, db)) }) }))
      clauses.push(...effectClauses(w, m))
      break
    case 'incoming':
      if (r.agent) return []
      for (const db of rowDbs) clauses.push(say(w, `${P}.plain.c.hookRows`, { db: q(titleOf(w, db)) }))
      break
    case 'sync':
      if (r.source === 'github') {
        const repo = w.input.sync.github.repo ?? ''
        clauses.push(say(w, `${P}.plain.c.picksUp`, { repo }))
        if (w.input.sync.github.auto) clauses.push(say(w, `${P}.plain.c.pushes`, { repo, n: w.input.sync.github.everyMin }))
      } else clauses.push(say(w, `${P}.plain.c.picksUpFolder`))
      break
    case 'clippings':
      return merged([...say(w, `${P}.plain.clippings`, { clauses: say(w, `${P}.plain.c.lands`, { page: q(titleOf(w, r.inbox)) }) }), ...fuseLine(w, m.key)])
    default:
      return []
  }
  if (!clauses.length) return []
  return merged([...sentence(w, whoParts, clauses), ...fuseLine(w, m.key)])
}

const PROCESSORS = new Set(['agent', 'automation', 'script', 'autofill', 'organise', 'kit', 'pipeline', 'bridge'])
/** Kinds whose modules carry a name of their own (the rest are named after what they are). */
const OWN_NAME = new Set(['server', 'agent', 'automation', 'script', 'pipeline', 'database', 'page', 'command'])

/** "§ In plain words": one strand per drawn processor, then the sources that act on their own (in rack order). */
export function plainOf(model: Model, input: ModelInput, ctx: PlainCtx): Strand[] {
  const w = worldOf(model, input, ctx)
  const out: Strand[] = []
  for (const m of model.modules) {
    if (m.idle || !PROCESSORS.has(m.kind)) continue
    const parts = processorStrand(w, m)
    if (parts.length) out.push({ module: m.key, parts })
  }
  for (const m of model.modules) {
    if (m.idle || m.col !== 1) continue
    const parts = sourceStrand(w, m)
    if (parts.length) out.push({ module: m.key, parts })
  }
  return out
}

/* ------------------------------------------------------------------ names for the page (B6) */

/** A module's name in plain text, live from the input (the rack's name line, the strands, the static picture). */
export const nameOf = (model: Model, input: ModelInput, key: ModuleKey, ctx: PlainCtx): string => moduleName(worldOf(model, input, ctx), key)

/** A place in plain text ("„Weiterleiten“ in Mails", "Mails", "Whole workspace") — a net tag's words. */
export const placeNameOf = (model: Model, input: ModelInput, place: Place, ctx: PlainCtx): string => placeName(worldOf(model, input, ctx), place)

/* ------------------------------------------------------------------ module descriptions (aria-describedby) */

/** A module's kind label (the rack's mono label). */
function kindLabel(w: World, m: Module): string {
  if (m.kind === 'outbox') return w.ctx.t(`${P}.module.outbox.kind`)
  if (m.kind === 'outbound' && m.exit) return w.ctx.t(`${P}.exit.${m.exit}`)
  return w.ctx.t(`${P}.kind.${m.kind}`)
}

/** One line: kind „name“ · what starts it · what it does · who it starts / who writes it · its fuses. */
export function describe(model: Model, input: ModelInput, key: ModuleKey, ctx: PlainCtx): string {
  const w = worldOf(model, input, ctx)
  const m = w.mods.get(key)
  if (!m) return key
  const name = moduleName(w, key)
  // a name of its own reads „quoted“ after the kind; a made-up one (Webhook · host, Autofill · db · „prop“ …) holds it
  const bits: string[] = [OWN_NAME.has(m.kind) ? `${kindLabel(w, m)} „${name}“` : m.kind === 'clock' || m.kind === 'rowTrigger' ? `${kindLabel(w, m)} · ${name}` : name]
  if (PROCESSORS.has(m.kind)) {
    if (m.tags.includes('disabled') && m.kind === 'agent') bits.push(w.ctx.t(`${P}.plain.c.off`))
    for (const s of startsOf(w, key)) bits.push(lowerFirst(text(s)))
    for (const c of clausesOf(w, m)) bits.push(text(c))
  } else if (m.kind === 'server') {
    const read = m.outJacks.find((j) => j.role === 'read')
    const write = m.outJacks.find((j) => j.role === 'write')
    bits.push(sayText(w, `${P}.plain.desc.jacks`, { r: read?.count ?? '?', w: write?.count ?? '?' }))
    const out = m.outJacks.find((j) => j.role === 'out')
    if (out?.count) bits.push(sayText(w, `${P}.plain.desc.out`, { n: out.count }))
  } else if (m.col === 1) {
    if (m.tags.includes('outside')) bits.push(w.ctx.t(`${P}.plain.desc.outside`))
    const started = [...new Set((w.from.get(key) ?? []).filter((e) => e.kind === 'starts' || e.kind === 'relay').map((e) => w.jackMod.get(e.to)).filter((x): x is ModuleKey => !!x))]
    if (started.length) bits.push(sayText(w, `${P}.plain.desc.starts`, { who: list(w, started.map((k) => q(moduleName(w, k)))) }))
    const own = text(sourceStrand(w, m))
    if (own) bits.push(lowerFirst(own.replace(/\.\s.*$/, '').replace(/\.$/, '')))
  } else {
    const by = [...new Set((w.into.get(key) ?? []).map((e) => w.jackMod.get(e.from)).filter((x): x is ModuleKey => !!x))]
    if (by.length) bits.push(sayText(w, m.kind === 'outbound' || m.kind === 'outbox' ? `${P}.plain.desc.sentBy` : `${P}.plain.desc.writtenBy`, { who: list(w, by.map((k) => q(moduleName(w, k)))) }))
  }
  if (m.idle) bits.push(w.ctx.t(`${P}.plain.desc.idle`))
  const fuses = fusesOn(w, key)
  if (fuses.length) bits.push(sayText(w, fuses.length === 1 ? `${P}.plain.desc.fuse` : `${P}.plain.desc.fuses`, { f: fuses.join(', ') }))
  return bits.join(' · ')
}

/* ------------------------------------------------------------------ the fuse's sentence */

/** The plate's sentence of a fuse: what the decider does, what sends it out, what a hidden instruction can get. */
export function fuseSay(fuse: Pick<Fuse, 'chain'>, model: Model, input: ModelInput, ctx: PlainCtx): Part[] {
  const w = worldOf(model, input, ctx)
  const chain: Chain = fuse.chain
  const d = chain.decider ? w.mods.get(chain.decider) : undefined
  if (!d || !chain.exit) return []
  const dWho = who(w, d.key)
  const exit = chain.exit
  const holderKey = (() => {
    const e = w.model.edges.find((x) => x.id === exit.edge)
    if (!e) return null
    return (exit.type === 'mcp' ? w.jackMod.get(e.to) : w.jackMod.get(e.from)) ?? null
  })()
  const out: Part[] = []
  const serverName = q(moduleName(w, exit.module))
  if (exit.type === 'mcp' && holderKey === d.key) out.push(...say(w, `${P}.plain.fuse.tools`, { who: dWho, server: serverName }))
  else {
    const first = chain.steps[0]
    const place = first && typeof first.to !== 'string' ? first.to : first?.via
    let act = 'write'
    const vars: Record<string, Val> = { who: dWho }
    if (place && 'db' in place) {
      const isPipe = typeof first.to === 'string' && w.mods.get(first.to)?.kind === 'pipeline'
      const prop = place.prop ?? '*'
      if (isPipe) act = 'task'
      else if (prop === '+row') act = 'row'
      else if (prop === '*' || prop === '-row') act = 'any'
      else {
        act = 'set'
        vars.prop = q(propOf(w, place.db, prop))
      }
      vars.db = q(titleOf(w, place.db))
    } else if (place && 'page' in place) {
      act = 'page'
      vars.page = q(titleOf(w, place.page))
    }
    const hWho = holderKey ? who(w, holderKey) : []
    const outRef = w.mods.get(exit.module)?.ref
    let exitParts: Part[]
    if (exit.type === 'webhook') exitParts = say(w, `${P}.plain.fuse.exit.webhook`, { who: hWho })
    else if (exit.type === 'git') exitParts = say(w, `${P}.plain.fuse.exit.git`, { who: hWho, action: say(w, `${P}.plain.fuse.git.${outRef?.kind === 'outbound' ? (outRef.method ?? 'push') : 'push'}`) })
    else if (exit.type === 'sync') exitParts = say(w, `${P}.plain.fuse.exit.sync`, { repo: input.sync.github.repo ?? '' })
    else exitParts = say(w, `${P}.plain.fuse.exit.mcp`, { who: hWho, server: serverName })
    // the steps between the first write and the hop that sends (net-flag halves count as one hop)
    const hops = chain.steps.filter((s) => typeof s.to === 'string' && s.to !== exit.module).length
    const more = Math.max(0, hops - 1)
    vars.exit = exitParts
    vars.more = more ? say(w, `${P}.plain.fuse.more`, { n: more }) : ''
    out.push(...say(w, `${P}.plain.fuse.${act}`, vars))
  }
  // the threat, from the path's source
  const src = chain.why?.outside.find((s) => !s.withheld)
  if (src) {
    const sv: Record<string, Val> = {}
    if (src.kind === 'mcp') sv.server = q(moduleName(w, src.source))
    if (src.kind === 'tainted' && src.place) sv.place = q(placeName(w, src.place))
    const decKind = d.ref.kind === 'agent' || d.ref.kind === 'autofill' || d.ref.kind === 'organise' || d.ref.kind === 'bridge' ? d.ref.kind : 'agent'
    out.push({ t: ' ' }, ...say(w, `${P}.plain.fuse.threat`, { source: say(w, `${P}.plain.fuse.src.${src.kind}`, sv), sent: say(w, `${P}.plain.fuse.sent.${decKind}`).map((p) => ({ ...p, b: true as const })) }))
  }
  return merged(out)
}

/* ------------------------------------------------------------------ message refs in words */

const MODULE_VARS = new Set(['agent', 'automation', 'module', 'server', 'source', 'writer', 'from', 'via', 'decider'])

/**
 * A lamp / fact / key / near-miss MsgRef in words: id vars resolved (db / page / title → titles, prop → the property's
 * name, module keys → names, place → the place, cls → the data class), `.one` for n = 1. Other vars stay as given
 * (host, method, n, repo, member names the UI filled in).
 */
export function sayMsg(msg: MsgRef, model: Model, input: ModelInput, ctx: PlainCtx): string {
  const w = worldOf(model, input, ctx)
  const v = msg.vars ?? {}
  const out: Record<string, Val> = {}
  for (const [k, raw] of Object.entries(v)) {
    const s = String(raw)
    if (k === 'db' || k === 'page') out[k] = titleOf(w, s)
    else if (k === 'prop') out[k] = typeof v.db === 'string' ? propOf(w, v.db, s) : s
    else if (k === 'place') out[k] = placeName(w, placeOfKey(s))
    else if (k === 'cls') out[k] = ctx.t(`${P}.cls.${s}`)
    else if (MODULE_VARS.has(k)) out[k] = w.mods.has(s) ? moduleName(w, s) : s
    else out[k] = typeof raw === 'number' ? raw : s
  }
  if (out.title === undefined && (v.db !== undefined || v.page !== undefined)) out.title = titleOf(w, String(v.db ?? v.page))
  return text(say(w, msg.key, out))
}
