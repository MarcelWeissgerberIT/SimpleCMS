/**
 * The ONLY module of the Patchbay that reads stores (plan §1.2 / §2.3): the workspace's wiring, this device's facts and
 * the lazy readings → an InputSource → ModelInput through the pure core (source.ts) and its memo. The areas are read
 * through their index files only (store modules directly, as other areas do).
 *
 *  - readInput(): the model input now — the same object while the wiring did not change (the memo); called after first
 *    paint, in idle (B8) and by the page (B6) — never at boot.
 *  - openInputs(): the route opened — read the expensive inputs once, in idle: the lazy cache (IndexedDB
 *    `one-patchbay`, `<scope>|lazy`), the script scan (the engine's chunk), the server-agent runtime (team), the capture
 *    Inbox (one id-prefix lookup), the button index (idle slices, then kept up to date per page). Each reading that
 *    arrives bumps `onInputs` listeners.
 *  - onInputs(fn): hear a lazy reading arrive (the state slice rebuilds then).
 * The row index tells the memo when the referenced pages may have moved (`structure`, or a changed id it read): typing
 * in a page reads no page facts again and rebuilds nothing.
 */
import { useWorkspace } from '../../store/store'
import { isEffectivelyTrashed } from '../../store/selectors'
import { ensureRowIndex, onRowsChanged } from '../../store/rowIndex'
import { readDeviceAI, readWorkspaceAI } from '../../store/ai'
import { findInboxIn } from '../../lib/capture'
import { activeWorkspace, useCloud } from '../../cloud'
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
import { ButtonIndex } from './buttons'
import { ScanCache, type ScanEngine } from './scripts'
import { lazyKey, readCache } from './cache'
import { patchbayScope } from './scope'
import type { ID } from '../../store/types'
import type { LazyCache, MailInput, ModelInput, PipelineInput } from './types'

/* ------------------------------------------------------------------ the readers */

const MAIL_ORGANISE_ROLES = ['category', 'priority', 'needsReply', 'summary', 'project'] as const

export const APP_READERS: InputReaders = {
  automations: readAutomations,
  commands: readDbCommands,
  pipeline: (db) => readPipeline(db).map((s) => ({ id: s.id, kind: s.kind, auto: s.auto, ...(s.gitAction ? { gitAction: s.gitAction } : {}), ...(s.hold ? { hold: true } : {}) })),
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

let lazy: LazyReadings = { buttons: null, scans: null, runtime: null, hooks: null, inbox: null, cache: null }
const listeners = new Set<() => void>()
const changed = (patch: Partial<LazyReadings>) => {
  lazy = { ...lazy, ...patch }
  for (const fn of [...listeners]) fn()
}

/** Hear a lazy reading arrive. */
export function onInputs(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

const isLazyCache = (v: unknown): v is LazyCache => !!v && typeof v === 'object' && (v as LazyCache).v === 1 && typeof (v as LazyCache).scripts === 'object'

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
let opened = false
let unsubscribeRows: (() => void) | null = null
/** what the open route listens to (dropped by resetInputs) */
const openSubs: Array<() => void> = []

/** The route opened: read the expensive inputs once (each in idle), then keep the button index current. */
export function openInputs(): void {
  if (opened) return
  opened = true
  void loadLazyCache()
  idle(scanScripts)
  idle(readInbox)
  idle(readRuntime)
  idle(buildButtons)
  // later script saves scan again (only what changed — by id + updatedAt)
  let scripts = useWorkspace.getState().scripts
  openSubs.push(
    useWorkspace.subscribe((s) => {
      if (s.scripts === scripts) return
      scripts = s.scripts
      idle(scanScripts)
    }),
  )
}

function scanScripts(): void {
  void loadScriptEngine().then((engine) => {
    const list = Object.values(useWorkspace.getState().scripts ?? {})
    const fresh = scanCache.fill(list, engine as unknown as ScanEngine)
    if (fresh || !lazy.scans) changed({ scans: scanCache.byId(list) })
  })
}

function readInbox(): void {
  const pages = useWorkspace.getState().pages
  const inbox = findInboxIn(pages, (id) => isEffectivelyTrashed(pages, id))
  if (inbox !== lazy.inbox) changed({ inbox })
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

function buildButtons(): void {
  const pages = useWorkspace.getState().pages
  buttonIndex.begin(Object.keys(pages))
  const slice = () => {
    if (!buttonIndex.step(useWorkspace.getState().pages)) return idle(slice)
    changed({ buttons: buttonIndex.list() })
  }
  idle(slice)
  ensureRowIndex()
  unsubscribeRows ??= onRowsChanged((c) => {
    if (!buttonIndex.ready) return
    if (buttonIndex.update(useWorkspace.getState().pages, c.changed)) changed({ buttons: buttonIndex.list() })
  })
}

/* ------------------------------------------------------------------ the memo */

const memo = createInputMemo(APP_READERS)
/** the row index said the referenced pages may have moved since the last read */
let pagesMoved = true
let unsubscribePages: (() => void) | null = null

function watchPages(): void {
  if (unsubscribePages) return
  ensureRowIndex()
  unsubscribePages = onRowsChanged((c) => {
    if (c.reset || c.structure) {
      pagesMoved = true
      return
    }
    const refs = memo.referenced()
    for (const id of c.changed)
      if (refs.has(id)) {
        pagesMoved = true
        return
      }
  })
}

/** The model input now (the same object while the wiring did not change). */
export function readInput(): ModelInput {
  watchPages()
  const s = useWorkspace.getState()
  const src: InputSource = {
    ws: { pages: s.pages, databases: s.databases, agents: s.agents, scripts: s.scripts, integrations: s.integrations, kit: s.kit, ai: s.ai, governor: s.governor, fuseSignoffs: s.fuseSignoffs, settings: s.settings },
    device: deviceFacts(),
    lazy,
    now: Date.now(),
  }
  const input = memo.read(src, { pagesMoved })
  pagesMoved = false
  return input
}

/** Perf seams (B17): how often the input was built and the referenced pages read again. */
export const inputStats = (): { builds: number; pageChecks: number } => memo.stats()

/** Forget everything read (another workspace): the next read builds afresh, the lazy readings start over. */
export function resetInputs(): void {
  memo.reset()
  pagesMoved = true
  lazy = { buttons: null, scans: null, runtime: null, hooks: null, inbox: null, cache: null }
  opened = false
  for (const stop of openSubs.splice(0)) stop()
  unsubscribeRows?.()
  unsubscribeRows = null
  for (const fn of [...listeners]) fn()
}
