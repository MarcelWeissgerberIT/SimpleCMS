/**
 * The live signal (plan §1.7, §3.10) — runs only while `#/patchbay` is open (bus.ts starts it with the route and stops
 * it when the route closes; this module is its own chunk). It feeds the pure state machine (core.ts) from:
 *
 *  1. run notes (`onRunNote`): a run starts / goes on / ends — its LED, the cable it came in by (an automation's
 *     `cause` lights the hop writer → net flag → automation; an agent's trigger comes with its run record, so its
 *     start leg waits for it), the announcement;
 *  2. writes under a run writer (`useWorkspace.subscribe`): `currentWriter()` read synchronously, then the shared page
 *     diff (`pageChanges` — a memo hit; only for a module's writer, never for typing), O(changed) → module → the places
 *     it wrote;
 *  3. ways out: an automation's webhook action (`onAutomationAction`), a pipeline's git action (`onShipRecord`); agent
 *     runs of other tabs (`onRunsChanged` → their stored runs: LED and window only, no write dots); server agents'
 *     last status from `useServerAgents` ("on the server", no dot).
 *
 * Also on open: runs today (the tally, bus.ts — this tab's counts at once, other tabs' on their ping), today's money
 * (the ledger: `ledgerEntries` from local midnight, then `registerMeter` per response here and a re-read 1 s after
 * another tab's `onLedgerDelta`), each agent's stored runs (`loadAgentRuns`: last status, open proposals per database),
 * automations' last error. Nothing here runs while the route is closed (liveStats: the spy).
 *
 * The UI (B14) reads `useLive` (LiveView) — modules' windows, legs, hot cables, FIRED clocks, the announcement, runs
 * and money today — and renders announcements with announce.ts announcementText.
 */
import { create } from 'zustand'
import { pageChanges, useWorkspace } from '../../../store/store'
import { currentWriter, onRunNote, type RunNote, type Writer } from '../../../store/writer'
import type { AgentTrigger, ID, Page } from '../../../store/types'
import { onAutomationAction, type AutomationActionNote } from '../../automations'
import { chainLegOf, onShipRecord, type ShipNote } from '../../coding'
import { loadAgentRuns, onRunsChanged, useAgentRuns, useServerAgents } from '../../agents'
import { ledgerEntries, onLedgerDelta, registerMeter } from '../../governor'
import { openModel, refreshModel, usePatchbay } from '../state'
import { moduleKey } from '../ref'
import { patchbayScope } from '../scope'
import type { LiveState, Model, ModuleCost, ModuleKey } from '../types'
import { LiveCore, type LiveLeg, type LiveSnapshot, type RunEnd } from './core'
import type { StartHow, StartPlace, WritePlace } from './legs'
import { dayOf, moduleOfKey, moduleOfWriter, nextMidnight, RunBook, runOfWriter, startOfDay, writerOfKey, type WriterLookups } from './runs'
import { costsByModule, withEntry, type CostBook, type CostResolve } from './costs'
import { APP_LOOKUPS, onTally, readTally, TALLY_CHANNEL } from './bus'

/** What the page reads (B14). */
export interface LiveView extends LiveSnapshot {
  open: boolean
  day: string
  /** runs today per module (this device: the tally) */
  runs: Record<ModuleKey, number>
  /** the last start today per module */
  lastRun: Record<ModuleKey, number>
  /** today's money per module (the ledger) — the header sums the drawn ones (costs.ts sumCosts) */
  costs: Record<ModuleKey, ModuleCost>
  /** per run (`agent:<id>:<run>`, `script:<id>:<run>`, `mail:<run>` …) — a run's window */
  runCosts: Record<string, ModuleCost>
  /** the ledger answered (until then the money reads "—", never $0) */
  costsRead: boolean
  /**
   * B14 — the cable label "3 PROPOSALS": open proposals per agent and database they target, keyed
   * `<agent module key>|<database module key>` (this device's loaded runs and the team server's staged ones)
   */
  cables: Record<string, number>
}

const CLOSED: LiveView = { open: false, day: '', modules: {}, legs: [], hot: [], fired: {}, announce: null, runs: {}, lastRun: {}, costs: {}, runCosts: {}, costsRead: false, cables: {} }

export const useLive = create<LiveView>(() => CLOSED)

/** The view now (the seam, tests). */
export const liveView = (): LiveView => useLive.getState()

/* ------------------------------------------------------------------ the spy */

let calls = 0
let active = 0
const log: LiveLeg[] = []
const LOG_MAX = 200

/** The live listeners: loaded (this chunk is), active (subscriptions now), calls (every listener call so far). */
export const liveStats = () => ({ loaded: true, active, calls })

/** The legs queued since the chunk loaded (newest last, ≤ 200) — the specs read the dot paths with it. */
export const legLog = (): LiveLeg[] => [...log]

function logLeg(leg: LiveLeg): void {
  log.push(leg)
  if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX)
}

/* ------------------------------------------------------------------ lookups on the model */

interface ModelFacts {
  /** every module on the rack */
  keys: Set<ModuleKey>
  folds: Map<ID, ModuleKey>
  kits: Array<{ key: ModuleKey; db: ID; type: ID }>
  agents: Map<ID, ModuleKey>
}
const facts = new WeakMap<Model, ModelFacts>()
const NO_FACTS: ModelFacts = { keys: new Set(), folds: new Map(), kits: [], agents: new Map() }

function factsOf(model: Model | null): ModelFacts {
  if (!model) return NO_FACTS
  let f = facts.get(model)
  if (f) return f
  f = { keys: new Set(), folds: new Map(), kits: [], agents: new Map() }
  for (const m of model.modules) {
    f.keys.add(m.key)
    if (m.folds?.script) f.folds.set(m.folds.script, m.key)
    if (m.ref.kind === 'kit') f.kits.push({ key: m.key, db: m.ref.db, type: m.ref.type })
    if (m.ref.kind === 'agent') f.agents.set(m.ref.id, m.key)
  }
  facts.set(model, f)
  return f
}

const modelNow = (): Model | null => usePatchbay.getState().model

/** The lookups with the rack's own facts (kit relays, folded scripts). */
const look: WriterLookups = {
  ...APP_LOOKUPS,
  kitIn: (type, db) => factsOf(modelNow()).kits.find((k) => k.type === type && (db === null || k.db === db))?.key ?? null,
}
/** Folded scripts are their automation's (a run of their own is not drawn). */
const foldOf = (script: ID) => factsOf(modelNow()).folds.get(script) ?? null

/** A module on the rack (the live signal lights only what is drawn; runs today count everything — bus.ts). */
const onRack = (key: ModuleKey | null): key is ModuleKey => !!key && factsOf(modelNow()).keys.has(key)
const drawn = (key: ModuleKey | null): ModuleKey | null => (onRack(key) ? key : null)

/* ------------------------------------------------------------------ the store's config, read where a run needs it */

const hostOf = (url: unknown): string | null => {
  if (typeof url !== 'string') return null
  try {
    return new URL(url.trim()).hostname.toLowerCase() || null
  } catch {
    return null
  }
}

function automationOf(db: ID, id: ID) {
  return useWorkspace.getState().databases[db]?.automations?.find((a) => a.id === id) ?? null
}

/** The place an automation listens to. */
function automationPlace(db: ID, id: ID): StartPlace | null {
  const t = automationOf(db, id)?.trigger
  if (!t) return null
  if (t.type === 'row_created') return { db, prop: '+row' }
  if (t.type === 'row_deleted') return { db, prop: '-row' }
  return { db, prop: t.propertyId ?? '*' }
}

/** The place an autofill property listens to (a translation: its source; anything else: the row). */
function autofillPlace(db: ID, prop: ID): StartPlace {
  const props = useWorkspace.getState().databases[db]?.properties ?? []
  const af = props.find((p) => p.id === prop)?.autofill
  if (af?.preset !== 'translate') return { db, prop: '*' }
  const src = af.source === 'content' ? '*' : (af.source ?? props.find((p) => p.type === 'title')?.id ?? '*')
  return { db, prop: src }
}

/** How an agent's run came: its stored run's trigger (this tab puts it right after the note), else its own trigger. */
function agentHow(agentId: ID, run: string | null): StartHow {
  const stored = run ? useAgentRuns.getState().byAgent[agentId]?.find((r) => r.id === run) : undefined
  const type: AgentTrigger['type'] | undefined = stored?.trigger.type ?? useWorkspace.getState().agents?.[agentId]?.trigger.type
  const t = useWorkspace.getState().agents?.[agentId]?.trigger
  if (type === 'schedule') return { via: 'clock' }
  if (type === 'webhook') return { via: 'hook' }
  if ((type === 'row_created' || type === 'row_changed') && t && (t.type === 'row_created' || t.type === 'row_changed')) {
    return { via: 'row', place: { db: t.databaseId, prop: t.type === 'row_created' ? '+row' : (t.propertyId ?? '*') } }
  }
  return {}
}

/** How a run of a writer came to start. */
function howOf(w: Writer): StartHow {
  switch (w.kind) {
    case 'automation':
      return { from: drawn(moduleOfKey(w.cause, look, { db: w.db })), via: 'row', place: automationPlace(w.db, w.id) }
    case 'autofill':
      return { from: drawn(moduleOfKey(w.cause, look, { db: w.db })), via: 'row', place: autofillPlace(w.db, w.prop) }
    case 'ai': {
      const db = APP_LOOKUPS.mailDb()
      return db ? { via: 'row', place: { db, prop: '+row' } } : {}
    }
    case 'script':
      return { from: drawn(moduleOfKey(w.via ?? null, look)) }
    case 'kit':
      return { from: drawn(moduleOfKey(w.cause ?? null, look)), via: 'row' }
    default:
      return {}
  }
}

/** The module and run a writer's work goes to here (a folded script's: its automation's run). */
function refOf(w: Writer, at: { db?: ID | null } = {}): { module: ModuleKey; run: string | null } | null {
  if (w.kind === 'script' && w.id) {
    const into = foldOf(w.id)
    if (into) {
      const via = writerOfKey(w.via ?? null)
      return { module: into, run: via?.kind === 'automation' ? via.run || null : null }
    }
  }
  const module = moduleOfWriter(w, look, at)
  return module ? { module, run: runOfWriter(w) } : null
}

/** Writers whose writes may light a cable (a quick check before any diff). */
const MODULE_WRITERS = new Set<Writer['kind']>(['agent', 'automation', 'script', 'autofill', 'ai', 'kit', 'coding', 'sync', 'mcp', 'template', 'order'])

/* ------------------------------------------------------------------ the session */

let core: LiveCore | null = null
let runBook: RunBook | null = null
let subs: Array<() => void> = []
let tickTimer = 0
let midnightTimer = 0
let publishQueued = false
let costBook: CostBook = { modules: {}, runs: {}, elsewhere: { usd: 0, estimate: false, unpriced: 0 } }
let costsRead = false
let runs: Record<ModuleKey, number> = {}
let lastRun: Record<ModuleKey, number> = {}
let day = ''
let refs = 0

let published: { snap: LiveSnapshot; runs: object; costs: object; day: string; read: boolean; cables: object } | null = null
/** open proposals per agent → database (the cable labels) */
let cables: Record<string, number> = {}

/** The view, once per microtask — only when something in it changed (the core's snapshot is the same object until then). */
function publish(): void {
  if (publishQueued || !core) return
  publishQueued = true
  queueMicrotask(() => {
    publishQueued = false
    if (!core) return
    const snap = core.snapshot()
    const p = published
    if (p && p.snap === snap && p.runs === runs && p.costs === costBook && p.day === day && p.read === costsRead && p.cables === cables) return
    published = { snap, runs, costs: costBook, day, read: costsRead, cables }
    useLive.setState({ ...snap, open: true, day, runs, lastRun, costs: costBook.modules, runCosts: costBook.runs, costsRead, cables })
  })
  schedule()
}

function schedule(): void {
  if (!core) return
  const due = core.nextDue()
  window.clearTimeout(tickTimer)
  tickTimer = 0
  if (due === null) return
  tickTimer = window.setTimeout(
    () => {
      tickTimer = 0
      if (!core) return
      calls++
      core.tick(Date.now())
      publish()
    },
    Math.max(16, due - Date.now()),
  )
}

const listen = <A extends unknown[]>(fn: (...a: A) => void) =>
  (...a: A): void => {
    calls++
    try {
      fn(...a)
    } catch (err) {
      console.warn('[patchbay] the live signal skipped an event', err)
    }
  }

function add(off: () => void): void {
  subs.push(off)
  active = subs.length
}

/* ---------------------------------------------------------------- 1. run notes */

function onNote(e: RunNote): void {
  if (!core || !runBook) return
  // a folded script's run is its automation's: its notes add nothing (its writes go to the automation's run)
  if (e.w.kind === 'script' && e.w.id && foldOf(e.w.id)) return
  const r = runBook.read(e)
  if (!r || !onRack(r.module)) return
  const now = Date.now()
  if (r.end) {
    if (e.w.kind === 'agent') {
      // a start still waiting for its trigger is resolved first (its legs go before the run ends)
      core.resolve(r.module, r.run, agentHow(e.w.id, r.run), now)
      const stored = useAgentRuns.getState().byAgent[e.w.id]?.find((x) => x.id === r.run)
      // the stored run says how it ended (a run without a record — the seam's — ends plainly)
      if (stored && stored.status !== 'running') endAgent(r.module, stored, now)
      else core.end(r.module, r.run, now)
    } else core.end(r.module, r.run, now)
  } else if (e.w.kind === 'agent' && r.start) {
    core.begin(r.module, r.run, now, { start: true, defer: true })
    const id = e.w.id
    const run = r.run
    // its run record comes right after the note (exec.ts puts it before its first await): the start leg waits for it
    queueMicrotask(() => {
      if (!core) return
      core.resolve(r.module, run, agentHow(id, run), Date.now())
      publish()
    })
  } else {
    // an agent's note that is no start (a review applying its proposals): its LED and writes, never its trigger again
    core.begin(r.module, r.run, now, { start: r.start, how: e.w.kind === 'agent' ? {} : howOf(e.w) })
  }
  publish()
}

/* ---------------------------------------------------------------- 2. writes */

type State = ReturnType<typeof useWorkspace.getState>

function onStore(state: State, prev: State): void {
  if (!core || state.pages === prev.pages) return
  const w = currentWriter()
  if (!w || !MODULE_WRITERS.has(w.kind)) return
  if (w.kind === 'ai' && w.action !== 'mail_organise') return
  if (w.kind === 'template' && !w.repeat) return
  const c = pageChanges(state.pages, prev.pages)
  const places: WritePlace[] = []
  let db: ID | null = null
  const n = Math.min(c.changed.length, 200)
  for (let i = 0; i < n; i++) {
    const id = c.changed[i]
    const p = placeOf(state, state.pages[id], prev.pages[id])
    if (!p) continue
    if ('db' in p) db ??= p.db
    places.push(p)
  }
  if (!places.length) return
  const ref = refOf(w, { db })
  if (!ref || !onRack(ref.module)) return
  core.write(ref.module, ref.run, places, Date.now(), core.running(ref.module, ref.run) ? {} : howOf(w))
  // Orders B10: the chain advancing (`#a<n>` — never its creation `#c<n>`, never a Status write `#s`): the next step's
  // task moved on — a leg on the hand-on cable (step before → this)
  if (w.kind === 'order' && /^a\d+$/.test(w.change ?? '')) for (let i = 0; i < n; i++) chainLeg(state, c.changed[i])
  publish()
}

/**
 * A chain's step moved on: its leg from the project of the step before (records.ts chainLegOf) — the first step's from
 * the planner (its cable to the project).
 */
function chainLeg(state: State, id: ID): void {
  const db = state.pages[id]?.databaseId
  const leg = core && db ? chainLegOf(id) : null
  if (!core || !db || !leg) return
  const pipe = (d: ID) => moduleKey({ kind: 'pipeline', db: d, pipeline: 'coding' })
  const ordersDb = state.pages[leg.row]?.databaseId
  const from = leg.prev ? state.pages[leg.prev]?.databaseId : null
  const src = leg.prev ? (from && from !== db ? pipe(from) : null) : ordersDb ? moduleKey({ kind: 'planner', db: ordersDb }) : null
  if (src && onRack(src) && onRack(pipe(db))) core.exit(src, null, pipe(db), Date.now())
}

/** What a changed page means for the rack: a row's database and its fields (a new row: `+row`), or a page. */
function placeOf(state: State, next: Page | undefined, prev: Page | undefined): WritePlace | null {
  const p = next ?? prev
  if (!p) return null
  const db = p.databaseId
  if (!db) return { page: p.id }
  if (!next) return null
  if (!prev) return { db, props: Object.keys(next.properties ?? {}), added: true }
  const props: string[] = []
  const a = next.properties ?? {}
  const b = prev.properties ?? {}
  for (const k of Object.keys(a)) if (a[k] !== b[k]) props.push(k)
  for (const k of Object.keys(b)) if (!(k in a)) props.push(k)
  if (next.title !== prev.title) {
    const title = state.databases[db]?.properties.find((x) => x.type === 'title')?.id
    if (title) props.push(title)
  }
  const content = next.content !== prev.content
  if (!props.length && !content) return null
  return { db, props, ...(content ? { content: true } : {}) }
}

/* ---------------------------------------------------------------- 3. ways out */

function onAction(note: AutomationActionNote): void {
  if (!core) return
  const module = moduleKey({ kind: 'automation', db: note.databaseId, id: note.automationId })
  const failed = note.status === 'error'
  const run = note.run || null
  if (note.action === 'webhook') {
    const act = automationOf(note.databaseId, note.automationId)?.actions[note.index]
    const target = act?.type === 'webhook' ? moduleKey({ kind: 'outbound', exit: 'webhook', host: hostOf(act.url), method: act.method === 'PUT' ? 'PUT' : 'POST', by: [] }) : ''
    core.exit(module, run, target, Date.now(), failed)
  } else if (failed) core.exit(module, run, '', Date.now(), true)
  publish()
}

const GIT_OUT = new Set(['push', 'pr', 'comment', 'merge'])

function onShip(note: ShipNote): void {
  if (!core) return
  const module = moduleKey({ kind: 'pipeline', db: note.dbId, pipeline: 'coding' })
  const s = note.ship
  if (s.failed) core.exit(module, null, '', Date.now(), true)
  else if (GIT_OUT.has(s.action) && (s.pushed || s.request || s.action === 'comment' || s.action === 'merge')) core.exit(module, null, moduleKey({ kind: 'outbound', exit: 'git', host: null, method: s.action, by: [] }), Date.now())
  publish()
}

/* ---------------------------------------------------------------- agents' stored runs */

type StoredRun = ReturnType<typeof useAgentRuns.getState>['byAgent'][string][number]

const OPEN = new Set(['pending', 'failed', 'held'])

function endAgent(module: ModuleKey, run: StoredRun, now: number): void {
  if (!core) return
  const proposals = (run.staged ?? []).filter((c) => OPEN.has(c.status)).length
  core.end(module, run.id, now, (run.status === 'running' ? 'ok' : run.status) as RunEnd, proposals ? { proposals } : {})
}

const lampOfStatus = (s: StoredRun['status']): LiveState | null => (s === 'error' ? 'error' : s === 'budget' ? 'budget' : s === 'held' ? 'held' : null)

let seenRuns: Record<ID, unknown> = {}

/** This tab's (and other tabs' loaded) agent runs: LEDs, last lamps, open proposals per database. */
function onAgentRuns(): void {
  if (!core) return
  const byAgent = useAgentRuns.getState().byAgent
  const agents = factsOf(modelNow()).agents
  const now = Date.now()
  const today = dayOf(now)
  let reviewChanged = false
  for (const [id, list] of Object.entries(byAgent)) {
    if (seenRuns[id] === list) continue
    seenRuns = { ...seenRuns, [id]: list }
    reviewChanged = true
    const key = agents.get(id)
    if (!key) continue
    const newest = list[0]
    if (!newest) continue
    if (newest.status === 'running') {
      // another tab's run (this tab's own began with its note): LED and window from its stored start
      if (!core.running(key, newest.id)) core.begin(key, newest.id, now, { start: true, since: newest.startedAt, elsewhere: true })
    } else if (core.running(key, newest.id)) endAgent(key, newest, now)
    else if (dayOf(newest.endedAt ?? newest.startedAt) === today) {
      const lamp = lampOfStatus(newest.status)
      if (lamp) core.lampTo(key, lamp, { run: newest.id })
    }
  }
  if (reviewChanged) review()
  publish()
}

let reviewed: Set<ModuleKey> = new Set()

/**
 * "+3 FOR REVIEW" on a database and "3 PROPOSALS" on the cable that carries them: open proposals per target database and
 * per agent → database — every loaded run of this device that waits for review, and the team server's staged runs of
 * this member's own server agents (`useServerAgents.open`).
 */
function review(): void {
  if (!core) return
  const perDb = new Map<ModuleKey, number>()
  const perCable: Record<string, number> = {}
  const ws = useWorkspace.getState()
  const count = (list: readonly StoredRun[]) => {
    for (const run of list)
      for (const c of run.staged ?? []) {
        if (!OPEN.has(c.status)) continue
        const db = c.databaseId ?? (ws.databases[c.pageId] ? c.pageId : ws.pages[c.pageId]?.databaseId)
        if (!db) continue
        const key = moduleKey({ kind: 'database', id: db })
        perDb.set(key, (perDb.get(key) ?? 0) + 1)
        const cable = `${moduleKey({ kind: 'agent', id: run.agentId })}|${key}`
        perCable[cable] = (perCable[cable] ?? 0) + 1
      }
  }
  for (const list of Object.values(useAgentRuns.getState().byAgent)) count(list)
  count(useServerAgents.getState().open ?? [])
  for (const key of reviewed) if (!perDb.has(key)) core.setExtra(key, null)
  for (const [key, n] of perDb) core.setExtra(key, { review: n })
  reviewed = new Set(perDb.keys())
  const same = Object.keys(perCable).length === Object.keys(cables).length && Object.entries(perCable).every(([k, n]) => cables[k] === n)
  if (!same) cables = perCable
}

/** Server agents: what the team server says of their last run ("on the server" — no dot). */
function onServerAgents(): void {
  if (!core) return
  const model = modelNow()
  if (!model) return
  const s = useServerAgents.getState()
  for (const m of model.modules) {
    if (m.ref.kind !== 'agent' || !m.tags.includes('server')) continue
    const id = m.ref.id
    const head = s.openLatest?.find((r) => r.agentId === id) ?? s.runs[id]?.[0] ?? null
    if (!head) continue
    if (head.status === 'running') core.lampTo(m.key, 'running', { server: true, since: head.startedAt, run: head.id })
    else core.lampTo(m.key, lampOfStatus(head.status) ?? 'idle', { server: true, since: null, run: head.id })
  }
  review()
  publish()
}

/* ---------------------------------------------------------------- money and runs today */

const resolve = (): CostResolve => ({ mailDb: APP_LOOKUPS.mailDb(), foldOf })

let costTimer = 0
async function readCosts(): Promise<void> {
  const from = startOfDay(Date.now())
  try {
    const entries = await ledgerEntries({ from })
    if (!core) return
    costBook = costsByModule(entries, resolve())
    costsRead = true
    publish()
  } catch (err) {
    console.warn('[patchbay] the ledger could not be read', err)
  }
}

function soonCosts(): void {
  window.clearTimeout(costTimer)
  costTimer = window.setTimeout(() => void readCosts(), 1000)
}

let tallyTimer = 0
async function readRuns(): Promise<void> {
  const scope = patchbayScope()
  const rec = await readTally(scope, day)
  if (!core) return
  runs = { ...rec.n }
  lastRun = { ...rec.last }
  publish()
}

function soonRuns(): void {
  window.clearTimeout(tallyTimer)
  tallyTimer = window.setTimeout(() => void readRuns(), 300)
}

function rollDay(): void {
  window.clearTimeout(midnightTimer)
  const now = Date.now()
  day = dayOf(now)
  runs = {}
  lastRun = {}
  costBook = { modules: {}, runs: {}, elsewhere: { usd: 0, estimate: false, unpriced: 0 } }
  costsRead = false
  void readRuns()
  void readCosts()
  midnightTimer = window.setTimeout(listen(rollDay), nextMidnight(now) - now + 50)
  publish()
}

/* ---------------------------------------------------------------- start / stop */

/** The route opened: every live listener on (counted — the route watch and a page may both hold it). Returns the release. */
export function startLive(): () => void {
  let held = true
  const release = () => {
    if (!held) return
    held = false
    refs = Math.max(0, refs - 1)
    if (refs === 0) stopLive()
  }
  refs++
  if (core) return release
  core = new LiveCore({ onLeg: logLeg })
  runBook = new RunBook(APP_LOOKUPS)
  seenRuns = {}
  reviewed = new Set()
  cables = {}
  add(openModel())
  core.setModel(modelNow() ?? safeRefresh())
  add(
    usePatchbay.subscribe(
      listen((s: ReturnType<typeof usePatchbay.getState>, p: ReturnType<typeof usePatchbay.getState>) => {
        if (s.model === p.model || !core) return
        core.setModel(s.model)
        seenRuns = {}
        onAgentRuns()
        onServerAgents()
        lampAutomations()
      }),
    ),
  )
  add(onRunNote(listen(onNote)))
  add(useWorkspace.subscribe(listen(onStore)))
  add(onAutomationAction(listen(onAction)))
  add(onShipRecord(listen(onShip)))
  add(onRunsChanged(listen((agentId: ID) => void loadAgentRuns(agentId).catch(() => undefined))))
  add(useAgentRuns.subscribe(listen(onAgentRuns)))
  add(useServerAgents.subscribe(listen(onServerAgents)))
  add(
    registerMeter(
      listen((e) => {
        if (dayOf(e.at) !== day) return
        costBook = withEntry(costBook, e, resolve())
        publish()
      }),
    ),
  )
  add(onLedgerDelta(listen(() => soonCosts())))
  add(
    onTally(
      listen((n) => {
        if (n.day !== day || n.scope !== patchbayScope()) return
        runs = { ...runs, [n.module]: (runs[n.module] ?? 0) + 1 }
        lastRun = { ...lastRun, [n.module]: n.at }
        publish()
      }),
    ),
  )
  let bc: BroadcastChannel | null = null
  try {
    bc = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(TALLY_CHANNEL)
    if (bc) bc.onmessage = listen(() => soonRuns())
  } catch {
    bc = null
  }
  add(() => bc?.close())
  add(() => {
    window.clearTimeout(tickTimer)
    window.clearTimeout(midnightTimer)
    window.clearTimeout(costTimer)
    window.clearTimeout(tallyTimer)
    tickTimer = midnightTimer = costTimer = tallyTimer = 0
  })
  rollDay()
  lampAutomations()
  // each agent's stored runs on this device (their last lamps, their open proposals)
  for (const id of factsOf(modelNow()).agents.keys()) void loadAgentRuns(id).catch(() => undefined)
  onAgentRuns()
  onServerAgents()
  return release
}

const safeRefresh = (): Model | null => {
  try {
    return refreshModel()
  } catch (err) {
    console.warn('[patchbay] the model could not be built', err)
    return null
  }
}

/** Every live listener off (the route closed). */
function stopLive(): void {
  for (const off of subs.splice(0)) {
    try {
      off()
    } catch {
      /* gone already */
    }
  }
  active = 0
  core = null
  runBook = null
  refs = 0
  published = null
  useLive.setState(CLOSED)
}

/** Automations whose last run failed: red until their next run (Automation.lastStatus). */
function lampAutomations(): void {
  if (!core) return
  const model = modelNow()
  if (!model) return
  for (const m of model.modules) {
    if (m.ref.kind !== 'automation') continue
    if (automationOf(m.ref.db, m.ref.id)?.lastStatus === 'error') core.lampTo(m.key, 'error')
  }
  publish()
}

