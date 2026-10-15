/**
 * The ONLY module of the Patchbay that reads stores (plan §1.2 / §2.3): the workspace's wiring, this device's facts and
 * the lazy readings → an InputSource → ModelInput through the pure core (source.ts) and its memo. The areas are read
 * through their index files only (store modules directly, as other areas do).
 *
 *  - readInput(): the model input now — the same object while the wiring did not change (the memo); called after first
 *    paint, in idle (B8) and by the page (B6) — never at boot.
 *  - openInputs(): the route opened — read the expensive inputs once, in idle: the lazy cache (IndexedDB
 *    `one-patchbay`, `<scope>|lazy`), the script scan and the kit value codes' scan (the engine's chunk), the
 *    server-agent runtime (team), the team's
 *    incoming webhooks and API tokens (owners / admins; a member reads 'forbidden'), the capture Inbox (one id-prefix lookup), the
 *    button index (idle slices, then kept up to date per page). Each reading that
 *    arrives bumps `onInputs` listeners. B17: it returns the release (counted — the route and the seam may both hold
 *    it); while nobody holds it the button index only NOTES the pages that changed (O(changed), no content read — typing
 *    elsewhere reads nothing) and reads them, in idle slices, when the route opens again.
 *  - onInputs(fn): hear a lazy reading arrive (the state slice rebuilds then).
 *  - readSource(): the InputSource now (B15: patch.ts plans a patch on it and builds its preview with the same core).
 * The lazy cache (B4): every fuse-relevant reading that arrives (scans, the runtime, hooks, the Inbox lookup) is written
 * to IndexedDB `one-patchbay` `<scope>|lazy` in idle (ids and hosts only, cache.ts lazyCacheOf) — the LED and the
 * Preflight lamp count from the eager inputs plus this cache.
 * The row index tells the memo when the referenced pages may have moved (`structure`, or a changed id it read whose
 * facts' fields changed — B17: typing in a referenced page moves nothing): typing in a page reads no page facts again
 * and rebuilds nothing.
 */
import { useWorkspace } from '../../store/store'
import { isEffectivelyTrashed } from '../../store/selectors'
import { ensureRowIndex, onRowsChanged } from '../../store/rowIndex'
import { readDeviceAI, readWorkspaceAI } from '../../store/ai'
import { findInboxIn } from '../../lib/capture'
import { activeWorkspace, cloudRequest, useCloud } from '../../cloud'
import { readAutomations } from '../automations'
import { readDbCommands } from '../commands'
import { approvalsDefault, gitStageWarnings, readPipeline, taskConfirmRule, useCoding, workerCaps, workerOnline, workerVerdict } from '../coding'
import { routesFor } from '../outbox'
import { readMail } from '../mail'
import { readServers, refusedHere, useMcpChecks } from '../ai/mcp-servers'
import { mcpSettings, serverState } from '../mcp'
import { syncState } from '../sync'
import { useKitTrust, valuePropsOf } from '../kit'
import { routeBlock, useServerAgents, loadRuntime } from '../agents'
import { nextRun } from '../templates'
import { routeFor } from '../ai/core'
import { loadScriptEngine } from '../script'
import { hostOf } from '../../store/integrations'
import { createInputMemo, digest, type DeviceFacts, type InputReaders, type InputSource, type LazyReadings } from './source'
import { ButtonIndex, SLICE_MS } from './buttons'
import { ScanCache, scanKitCode, type ScanEngine } from './scripts'
import { isLazyCache, lazyCacheOf, lazyKey, readCache, sameLazyCache, writeCache } from './cache'
import { patchbayScope } from './scope'
import type { ID, Page } from '../../store/types'
import type { HookInput, KitScan, LazyCache, MailInput, ModelInput, PipelineInput, TokenInput } from './types'

/* ------------------------------------------------------------------ the readers */

const MAIL_ORGANISE_ROLES = ['category', 'priority', 'needsReply', 'summary', 'project'] as const

export const APP_READERS: InputReaders = {
  automations: readAutomations,
  commands: readDbCommands,
  pipeline: (db) => readPipeline(db).map((s) => ({ id: s.id, kind: s.kind, auto: s.auto, ...(s.gitAction ? { gitAction: s.gitAction } : {}), ...(s.hold ? { hold: true } : {}), ...(s.next ? { next: s.next } : {}), ...(s.output ? { output: s.output } : {}) })),
  gitWarnings: (stages) => {
    const repos = useCoding.getState().worker?.repos ?? []
    const out: PipelineInput['warnings'] = { pushOff: [], prOff: [] }
    for (const st of stages) {
      const w = gitStageWarnings(st.gitAction ?? null, repos)
      for (const r of w.pushOff) if (!out.pushOff.includes(r)) out.pushOff.push(r)
      for (const r of w.prOff) if (!out.prOff.includes(r)) out.prOff.push(r)
    }
    return out
  },
  sends: (dbId) => routesFor(dbId).map((r) => ({ profile: r.ref.profileId, route: r.ref.routeId, tool: r.tool, server: r.server.name })),
  mail: (raw): MailInput | null => {
    if (!raw) return null
    const m = readMail()
    const organiseProps = MAIL_ORGANISE_ROLES.map((r) => m.props?.[r]).filter((x): x is ID => !!x)
    return { databaseId: m.databaseId, auto: m.auto, everyMin: m.everyMin, organise: m.organise.enabled, organiseProps, relationDb: m.organise.relationDatabaseId }
  },
  servers: (settings) => readServers(settings as Parameters<typeof readServers>[0]),
  serverState: (s, now, refused) => serverState(s, now, refused),
  valueProps: (db, kit) => valuePropsOf(db, kit).map((v) => ({ prop: v.prop, type: { id: v.type.id }, code: v.code })),
  routeBlock: (a) => routeBlock(a),
  nextRun: (r, now) => nextRun(r, now)?.at ?? null,
  wsAI: (raw) => readWorkspaceAI(raw) ?? null,
  deviceAI: (raw) => readDeviceAI(raw) ?? null,
  route: () => {
    try {
      return routeFor('agents.run').route
    } catch {
      return null
    }
  },
}

/* ------------------------------------------------------------------ this device's facts */

function deviceFacts(): DeviceFacts {
  const cloud = useCloud.getState()
  const team = activeWorkspace().kind === 'cloud'
  const coding = useCoding.getState()
  const verdict = workerVerdict(coding)
  const info = coding.worker
  const servers = readServers(useWorkspace.getState().settings)
  return {
    ctx: { team, me: team ? (cloud.user?.id ?? null) : null, role: team ? cloud.role : null, readOnly: team && cloud.readOnly, supports: team ? [...(cloud.supports ?? [])] : [] },
    bridge: mcpSettings(),
    sync: syncState(),
    worker: {
      online: workerOnline(coding),
      can: workerCaps(coding),
      verdict,
      tools: info ? [...info.repos.map((r) => ({ repo: r.name, names: r.mcp ?? [] })), ...(info.mcp ? [{ repo: null, names: info.mcp }] : [])] : null,
      approvals: approvalsDefault(),
      confirm: taskConfirmRule(),
    },
    testing: Object.keys(useMcpChecks.getState().running),
    refused: servers.filter((s) => refusedHere(s)).map((s) => s.id),
    kitTrust: team ? kitTrustDigests(useKitTrust.getState().ok) : null,
  }
}

/** The kit codes this device answered for, by digest (the codes themselves stay out of the input). */
let trustSeen: { ok: Readonly<Record<string, boolean>>; out: Record<string, boolean> } | null = null
function kitTrustDigests(ok: Readonly<Record<string, boolean>>): Record<string, boolean> {
  if (trustSeen?.ok === ok) return trustSeen.out
  const out: Record<string, boolean> = {}
  for (const code in ok) out[digest(code)] = ok[code]
  trustSeen = { ok, out }
  return out
}

/* ------------------------------------------------------------------ the lazy readings */

let lazy: LazyReadings = { buttons: null, scans: null, kitScans: null, runtime: null, hooks: null, tokens: null, inbox: null, cache: null }
const listeners = new Set<() => void>()
const changed = (patch: Partial<LazyReadings>) => {
  lazy = { ...lazy, ...patch }
  // a fuse-relevant reading arrived: keep it in the lazy cache (B4) — the LED and Preflight count from it
  if ('scans' in patch || 'kitScans' in patch || 'runtime' in patch || 'hooks' in patch || 'tokens' in patch || 'inboxRead' in patch) cacheSoon()
  for (const fn of [...listeners]) fn()
}

/* ------------------------------------------------------------------ the lazy cache (B4, §1.2 / §6 A16) */

/** the cache this tab wrote last (the next write starts from it; null after a reset) */
let written: LazyCache | null = null
let cachePending = false

/** Write the lazy cache from the readings, in idle, once per burst (ids and hosts only — cache.ts lazyCacheOf). */
function cacheSoon(): void {
  if (cachePending) return
  cachePending = true
  idle(() => {
    cachePending = false
    void writeLazyCache()
  })
}

async function writeLazyCache(): Promise<void> {
  const scope = patchbayScope()
  if (!scope) return
  const base = written ?? lazy.cache
  const next = lazyCacheOf({ scans: lazy.scans, kits: lazy.kitScans ?? null, runtime: lazy.runtime, hooks: lazy.hooks, tokens: lazy.tokens ?? null, inbox: lazy.inbox, inboxRead: !!lazy.inboxRead }, base, Date.now())
  if (sameLazyCache(next, base)) return
  if (await writeCache(lazyKey(scope), next)) written = next
}

/** Hear a lazy reading arrive. */
export function onInputs(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Read the lazy cache of this scope (ids and hosts only) — the LED and Preflight count from it (B8). */
export async function loadLazyCache(): Promise<LazyCache | null> {
  const scope = patchbayScope()
  if (!scope) return null
  const cache = await readCache(lazyKey(scope), isLazyCache)
  if (cache !== lazy.cache) changed({ cache })
  return cache
}

const idle = (fn: () => void) => {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
  if (ric) ric(fn, { timeout: 500 })
  else setTimeout(fn, 16)
}

const buttonIndex = new ButtonIndex()
const scanCache = new ScanCache()
/** fix (rest): kit value codes' scans by the code's digest (null: it does not parse) */
const kitScanCache = new Map<string, KitScan | null>()
let opened = false
let unsubscribeRows: (() => void) | null = null
/** what the open route listens to (dropped by resetInputs) */
const openSubs: Array<() => void> = []
/** B17: who holds the inputs open now (the route, the seam) — 0: the button index only notes what changed */
let holders = 0
/** B17: pages changed since the button index read them (noted while closed or while the build runs) */
const dirty = new Set<ID>()
/** more changed than is worth reading one by one (or another workspace): build the index again */
let dirtyAll = false
const DIRTY_MAX = 2000
let catchingUp = false
let catchUpQueued = false
let building = false
/** B17 (perf seam): the button index's catch-ups — how many, pages read, the longest slice (ms) */
let catchUps = { runs: 0, pages: 0, maxMs: 0 }

/**
 * The route opened: read the expensive inputs once (each in idle), then keep the button index current while it is held.
 * Returns the release (B17: counted; nothing is read again on a later open but what changed meanwhile).
 */
export function openInputs(): () => void {
  holders++
  let held = true
  const release = () => {
    if (!held) return
    held = false
    holders = Math.max(0, holders - 1)
  }
  if (opened) {
    // again: the pages that changed while the route was closed
    if (dirty.size || dirtyAll) catchUpSoon()
    return release
  }
  opened = true
  void loadLazyCache()
  idle(scanScripts)
  idle(readInbox)
  idle(readRuntime)
  idle(readHooks)
  idle(buildButtons)
  // later script saves (and own types' value codes) scan again (only what changed — by id + updatedAt, by the code's digest)
  let scripts = useWorkspace.getState().scripts
  let kit = useWorkspace.getState().kit
  openSubs.push(
    useWorkspace.subscribe((s) => {
      if (s.scripts === scripts && s.kit === kit) return
      scripts = s.scripts
      kit = s.kit
      idle(scanScripts)
    }),
  )
  return release
}

function scanScripts(): void {
  void loadScriptEngine().then((engine) => {
    const list = Object.values(useWorkspace.getState().scripts ?? {})
    const fresh = scanCache.fill(list, engine as unknown as ScanEngine)
    if (fresh || !lazy.scans) changed({ scans: scanCache.byId(list) })
    scanKits(engine as unknown as ScanEngine)
  })
}

/**
 * fix (rest): the own types' value codes (they run in query mode and may read any database or page — the result lands
 * in their field): scanned like scripts, kept by the code's digest (ids only — never the code).
 */
function scanKits(engine: ScanEngine): void {
  const types = useWorkspace.getState().kit?.propTypes ?? {}
  const out: Record<string, KitScan> = {}
  const keep = new Set<string>()
  let fresh = false
  for (const t of Object.values(types)) {
    const code = t?.scripts?.value
    if (typeof code !== 'string' || !code) continue
    const d = digest(code)
    keep.add(d)
    if (!kitScanCache.has(d)) {
      kitScanCache.set(d, scanKitCode(code, engine))
      fresh = true
    }
    const scan = kitScanCache.get(d)
    if (scan) out[d] = scan
  }
  for (const d of [...kitScanCache.keys()]) if (!keep.has(d)) kitScanCache.delete(d)
  const gone = Object.keys(lazy.kitScans ?? {}).some((d) => !keep.has(d))
  if (fresh || gone || !lazy.kitScans) changed({ kitScans: out })
}

function readInbox(): void {
  const pages = useWorkspace.getState().pages
  const inbox = findInboxIn(pages, (id) => isEffectivelyTrashed(pages, id))
  if (inbox !== lazy.inbox || !lazy.inboxRead) changed({ inbox, inboxRead: true })
}

function readRuntime(): void {
  if (activeWorkspace().kind !== 'cloud') return
  const take = () => {
    const s = useServerAgents.getState()
    const runtime = s.state === 'forbidden' ? ('forbidden' as const) : s.runtime ? s.runtime.mcpServers.map((m) => ({ name: m.name, host: hostOf(m.url) || null })) : null
    if (JSON.stringify(runtime) !== JSON.stringify(lazy.runtime)) changed({ runtime })
  }
  openSubs.push(useServerAgents.subscribe(take))
  void loadRuntime().finally(take)
}

/**
 * The team's incoming webhooks (owners / admins may list them: `GET api/workspaces/<id>/hooks`, the same list Workspace ›
 * API shows) — ids and target databases only — and its API tokens (`GET api/workspaces/<id>/tokens`, fix model): ids
 * and whether they may write (scope 'write', not revoked), never a name. A member, or a 403, reads 'forbidden' (an
 * unknown part, never "none"); a failed request leaves the reading open (unknown 'lazy').
 */
function readHooks(): void {
  const ws = activeWorkspace()
  if (ws.kind !== 'cloud') return
  const role = useCloud.getState().role
  // the role not known yet (still connecting): the reading stays open
  if (!role) return
  if (role !== 'owner' && role !== 'admin') {
    if (lazy.hooks !== 'forbidden' || lazy.tokens !== 'forbidden') changed({ hooks: 'forbidden', tokens: 'forbidden' })
    return
  }
  void cloudRequest<unknown>('GET', `api/workspaces/${encodeURIComponent(ws.id)}/tokens`)
    .then((raw) => {
      if (activeWorkspace().id !== ws.id) return
      const tokens: TokenInput[] = []
      for (const t of Array.isArray(raw) ? raw : []) {
        const row = t as { id?: unknown; scope?: unknown; revoked?: unknown } | null
        if (typeof row?.id === 'string' && row.id) tokens.push({ id: row.id, write: row.scope === 'write' && row.revoked !== true })
      }
      if (JSON.stringify(tokens) !== JSON.stringify(lazy.tokens)) changed({ tokens })
    })
    .catch((err: unknown) => {
      if ((err as { code?: unknown } | null)?.code === 'forbidden' && activeWorkspace().id === ws.id) changed({ tokens: 'forbidden' })
    })
  void cloudRequest<unknown>('GET', `api/workspaces/${encodeURIComponent(ws.id)}/hooks`)
    .then((raw) => {
      if (activeWorkspace().id !== ws.id) return
      const hooks: HookInput[] = []
      for (const h of Array.isArray(raw) ? raw : []) {
        const id = (h as { id?: unknown } | null)?.id
        const db = (h as { database?: { id?: unknown } } | null)?.database?.id
        if (typeof id === 'string' && id) hooks.push({ id, db: typeof db === 'string' && db ? db : null })
      }
      if (JSON.stringify(hooks) !== JSON.stringify(lazy.hooks)) changed({ hooks })
    })
    .catch((err: unknown) => {
      if ((err as { code?: unknown } | null)?.code === 'forbidden' && activeWorkspace().id === ws.id) changed({ hooks: 'forbidden' })
    })
}

function buildButtons(): void {
  const pages = useWorkspace.getState().pages
  building = true
  dirty.clear()
  dirtyAll = false
  buttonIndex.begin(Object.keys(pages))
  const slice = () => {
    if (!buttonIndex.step(useWorkspace.getState().pages)) return idle(slice)
    building = false
    changed({ buttons: buttonIndex.list() })
    // pages that changed while the build ran (a page read early may have changed later)
    if ((dirty.size || dirtyAll) && holders) catchUpSoon()
  }
  idle(slice)
  ensureRowIndex()
  // B17: the listener only NOTES what changed (O(changed), no content read); the pages are read in idle while the route
  // is held, or when it opens again
  unsubscribeRows ??= onRowsChanged((c) => {
    if (c.reset) dirtyAll = true
    else if (!dirtyAll) for (const id of c.changed) dirty.add(id)
    if (dirty.size > DIRTY_MAX) {
      dirty.clear()
      dirtyAll = true
    }
    if (holders && !building) catchUpSoon()
  })
}

/** One catch-up in idle (however many changes ask for it meanwhile). */
function catchUpSoon(): void {
  if (catchUpQueued) return
  catchUpQueued = true
  idle(() => {
    catchUpQueued = false
    catchUpButtons()
  })
}

/** Read the pages the index has not seen since they changed — in idle slices (≤ SLICE_MS each); a flood builds anew. */
function catchUpButtons(): void {
  if (catchingUp || building || !buttonIndex.ready || (!dirty.size && !dirtyAll)) return
  if (dirtyAll) return buildButtons()
  catchingUp = true
  catchUps = { ...catchUps, runs: catchUps.runs + 1 }
  const ids = [...dirty]
  dirty.clear()
  let moved = false
  let i = 0
  const slice = () => {
    const pages = useWorkspace.getState().pages
    const t0 = performance.now()
    const from = i
    while (i < ids.length && (i === from || performance.now() - t0 < SLICE_MS)) if (buttonIndex.update(pages, [ids[i++]])) moved = true
    catchUps = { runs: catchUps.runs, pages: catchUps.pages + (i - from), maxMs: Math.max(catchUps.maxMs, performance.now() - t0) }
    if (i < ids.length) return idle(slice)
    catchingUp = false
    if (moved) changed({ buttons: buttonIndex.list() })
    // what changed meanwhile
    if (holders && (dirty.size || dirtyAll)) catchUpSoon()
  }
  slice()
}

/* ------------------------------------------------------------------ the memo */

const memo = createInputMemo(APP_READERS)
/** the row index said the referenced pages may have moved since the last read */
let pagesMoved = true
let unsubscribePages: (() => void) | null = null

/** who hears the referenced pages move (the background fuse count, compute.ts — it reads the input again in idle) */
const movedListeners = new Set<() => void>()

function watchPages(): void {
  if (unsubscribePages) return
  ensureRowIndex()
  const moved = () => {
    pagesMoved = true
    for (const fn of [...movedListeners]) fn()
  }
  unsubscribePages = onRowsChanged((c) => {
    if (c.reset || c.structure) return moved()
    const refs = memo.referenced()
    if (!refs.size) return
    // B17: a referenced page moves the input only when the fields its facts read changed (typing in it does not)
    let pages: Record<ID, Page> | null = null
    for (const id of c.changed) {
      if (!refs.has(id)) continue
      pages ??= useWorkspace.getState().pages
      if (memo.factsMoved(id, pages[id])) return moved()
    }
  })
}

/** B8: hear the referenced pages move (a page appeared, went, was trashed or restored, or a page the model names changed). */
export function onPagesMoved(fn: () => void): () => void {
  movedListeners.add(fn)
  return () => {
    movedListeners.delete(fn)
  }
}

/** The source of the input now: the workspace, this device's facts, the lazy readings (patch.ts plans on it, B15). */
export function readSource(): InputSource {
  const s = useWorkspace.getState()
  return {
    ws: { pages: s.pages, databases: s.databases, agents: s.agents, scripts: s.scripts, integrations: s.integrations, kit: s.kit, ai: s.ai, governor: s.governor, fuseSignoffs: s.fuseSignoffs, settings: s.settings },
    device: deviceFacts(),
    lazy,
    now: Date.now(),
  }
}

/** The model input now (the same object while the wiring did not change). */
export function readInput(): ModelInput {
  watchPages()
  const src = readSource()
  const input = memo.read(src, { pagesMoved })
  pagesMoved = false
  return input
}

/** Perf seams (B17): how often the input was built and the referenced pages read again; the button index's work. */
export const inputStats = (): { builds: number; pageChecks: number; buttons: { ready: boolean; holders: number; dirty: number; build: ButtonIndex['stats']; catchUps: typeof catchUps } } => ({
  ...memo.stats(),
  buttons: { ready: buttonIndex.ready, holders, dirty: dirtyAll ? -1 : dirty.size, build: buttonIndex.stats, catchUps },
})

/** Forget everything read (another workspace): the next read builds afresh, the lazy readings start over. */
export function resetInputs(): void {
  memo.reset()
  pagesMoved = true
  lazy = { buttons: null, scans: null, kitScans: null, runtime: null, hooks: null, tokens: null, inbox: null, cache: null }
  kitScanCache.clear()
  written = null
  opened = false
  dirty.clear()
  dirtyAll = false
  for (const stop of openSubs.splice(0)) stop()
  unsubscribeRows?.()
  unsubscribeRows = null
  for (const fn of [...listeners]) fn()
}
