import type { RepoFilesRequest, RepoFilesResult } from '../../../shared/repo-files'
import { hasFlowLimits, modelDestinationAllowed, mcpDestinationAllowed } from '@/shared/ai/dataFlow'
import type { WorkerModel, WorkerTextRequest, WorkerTextResult, WorkerMcpRequest } from '@/shared/ai/worker'
/**
 * Coding pipeline — the tab side of the worker link (features/coding/protocol.ts).
 *
 *  - Switched on per device (a download of the worker switches it on; Settings → Coding worker): connect to
 *    ws://127.0.0.1:<port> (subprotocol one-worker.v1), say hello with this workspace's id (the same ids as
 *    the MCP bridge) and this device's pairing secret for it (download.ts), retry with backoff while no
 *    worker runs. A worker bound to another workspace (or none, or a download paired with another browser)
 *    refuses: no retry until the person asks. A newer tab of the same workspace takes over (4001).
 *  - "Change repositories" sends `open-setup`: the worker opens its local setup page; One never sees it.
 *  - The worker asks: `next` (tasks.ts picks and claims one), `heartbeat`, `finish` (the outcome into the
 *    row and the page); it streams `event`s (log lines, git state, notes, questions) into this device's log.
 *  - The person acts: Stop and the fixed git verbs go to the worker as requests; everything else is a store
 *    write that nudges the worker.
 *  - The tab only ever serves its own workspace: switching workspace drops the link (and reconnects as the
 *    new one, which a worker of the old one refuses).
 *  - Cloud (a team workspace switched to Cloud on this device, docs/CODING.md § Cloud worker): the same protocol
 *    through the team server's relay (transport.ts), end-to-end sealed with this device's pairing key of the cloud
 *    worker it downloaded (cloudKeys.ts — non-extractable, one per download whose worker still works). Only a device
 *    with that download connects (another device of the member would only take its place: it shows "paired with
 *    another device"); a device whose own newer download has not started yet waits for it while another device's
 *    worker has the member's place (online, or the active one offline for a moment); a tab opened in the background
 *    does not take the worker over; a tab another tab or device took the worker from takes it back once that tab
 *    lets it go (the server lists it online without a tab); tasks run only while such a tab is connected.
 */
import { codingAgentName } from './agent'
import { useWorkspace, pageChanges } from '../../store/store'
import { t } from '../../i18n'
import { BRAND } from '@/shared/brand'
import { currentWorkspace, workspaceInfo } from '../mcp/identity'
import {
  WORKER_CLOSE_REFUSED,
  WORKER_CLOSE_REPLACED,
  RELAY_CLOSE_FORBIDDEN,
  TAB_CAN,
  cleanAsk,
  type BusyTask,
  type GitResult,
  type GitVerb,
  type OpenSetupResult,
  type PermissionAsk,
  type PermissionVerb,
  type TabMessage,
  type WorkerMessage,
  type WorkspaceRef,
} from './protocol'
import { APPROVALS_KEY, DEFAULT_CODING, CODING_STORAGE_KEY, MAX_CLOUD_KEYS, defaultApprovals, legacyCloudSecrets, loadCodingSettings, saveCodingSettings, useCoding, validPort, type CodingRefused, type CodingSettings } from './state'
import { appendLog, patchTask, flushLogs, loadTask, taskLocal } from './local'
import { cleanCode, cleanEdit } from './lines'
import { addRepoOptions, codingProps, pipelineDbIds } from './schema'
import { startOrders } from './orders/trigger'
import { finishStage, heartbeat, intakeDone, pickNext, setNudge, startApprovalsWatch, taskContext, gitSummary, writeShipNote } from './tasks'
import { keepTrust, startTrustWatch } from './trust'
import { branchHolders } from './guards'
import { cleanShip, noteShip, prFieldNext, shipShows } from './ship'
import { openCloudLink, openLocalLink, type LinkHandle, type LinkHandlers } from './transport'
import { cloudContextOk, listCloudWorkers, relayAvailable } from './cloudWorkers'
import { cloudKey, dropCloudKeys, keepCloudKey } from './cloudKeys'
import { browserOs, workerOldOnWindows } from './winWorker'
import type { SessionKey } from './relayBox'
import { CloudError, cloudRequest, useCloud, captureReadiness, noteReadiness, noteAtlasRead } from '../../cloud'
import { SYSTEM, withWriter, type Writer } from '../../store/writer'
import { localNetworkStatus } from '../../lib/localNetwork'
import { notifyAway } from './notify'

const set = useCoding.setState
const get = useCoding.getState

/**
 * No worker (any more): nothing runs here — the running counters and the permission requests of its tasks go with it
 * (a worker that comes back names its running tasks and their open request again).
 */
const GONE = { worker: null, busy: [] as BusyTask[], can: null, progress: {}, asks: {} }

/** Permission requests One already told the person about (a browser notification once per request). */
const told = new Set<string>()

/** A new permission request: the browser says it while One is in the background (notify.ts). */
function tellAsk(taskId: string, ask: PermissionAsk) {
  if (told.has(ask.id)) return
  told.add(ask.id)
  if (told.size > 200) told.delete(told.values().next().value as string)
  const title = useWorkspace.getState().pages[taskId]?.title.trim() || t('common.untitled')
  notifyAway(taskId, t('features.coding.notify.permission', { title, tool: ask.tool, agent: codingAgentName(taskId) }))
}

/**
 * The worker's running tasks (welcome / status, worker 1.11.0): the progress of a task that no longer runs goes (the
 * JETZT line has nothing to show then), and each running task's open permission request is taken from the list — the
 * worker names it there whenever it changes.
 */
function setBusy(list: BusyTask[] | undefined, extra: Partial<ReturnType<typeof get>> = {}) {
  const busy = Array.isArray(list) ? list : []
  const running = new Set(busy.map((b) => String(b.taskId)))
  const st = get()
  const stale = Object.keys(st.progress).filter((id) => !running.has(id))
  const progress = stale.length ? Object.fromEntries(Object.entries(st.progress).filter(([id]) => running.has(id))) : st.progress
  const asks: Record<string, PermissionAsk> = {}
  for (const b of busy) {
    const a = cleanAsk(b.ask)
    if (a && ownTask(String(b.taskId))) asks[String(b.taskId)] = a
  }
  set({ busy, progress, asks, ...extra })
  for (const [id, a] of Object.entries(asks)) tellAsk(id, a)
}

/* ------------------------------------------------------------------ settings */

function patchSettings(patch: Partial<CodingSettings>) {
  const s = get()
  const next: CodingSettings = { enabled: s.enabled, port: s.port, pairs: s.pairs, via: s.via, cloudPairs: s.cloudPairs, ...patch }
  saveCodingSettings(next)
  set(next)
}

/**
 * How this device reaches the worker of a workspace: Cloud only for a team workspace switched to Cloud here — and only
 * on an https page (or this computer's own http): elsewhere the tab has no WebCrypto and the worker refuses the origin.
 */
export function viaFor(ws: { id: string; kind: string } | null): 'local' | 'cloud' {
  return !!ws && ws.kind === 'team' && useCloud.getState().active.kind === 'cloud' && get().via[ws.id] === 'cloud' && cloudContextOk() ? 'cloud' : 'local'
}

/**
 * The connected worker (by the version it names) is older than 1.9.0 and runs on this Windows computer: a Local link
 * from a browser on Windows (winWorker.ts) — it can start a program a repository brought along. Never through Cloud.
 */
export function workerOldHere(version: string | null | undefined): boolean {
  return workerOldOnWindows(version, viaFor(workspaceInfo()), browserOs())
}

/** "Where the worker runs" (Settings → Coding worker): Local | Cloud for this team workspace on this device. */
export function setCodingVia(workspaceId: string, via: 'local' | 'cloud') {
  const next = { ...get().via }
  if (via === 'cloud') next[workspaceId] = 'cloud'
  else delete next[workspaceId]
  patchSettings({ via: next })
  // a Local block or the browser's question belongs to the Local link only
  set({ relay: null, refused: null, dropped: 0, pendingHere: false, blocked: null, lna: null })
  if (get().enabled) reconnect()
}

/** The token ids this device keeps keys for (newest first); the keys of ids that leave the list are dropped. */
function setCloudTokens(workspaceId: string, tokens: readonly string[], at?: number) {
  const old = get().cloudPairs[workspaceId]
  const next = { ...get().cloudPairs }
  const list = [...new Set(tokens)].slice(0, MAX_CLOUD_KEYS)
  if (list.length) next[workspaceId] = { tokens: list, at: at ?? old?.at ?? Date.now() }
  else delete next[workspaceId]
  void dropCloudKeys(workspaceId, (old?.tokens ?? []).filter((t) => !list.includes(t)))
  patchSettings({ cloudPairs: next })
}

/**
 * A cloud worker was downloaded on this device (download.ts; its key is kept already, cloudKeys.ts): its token id
 * goes first; of the older downloads only those that still work stay — `stays`: the member's active token as the
 * server listed it before this download (a pending one is replaced by it), null: not known, keep them all. Switches
 * the link on, through the team server.
 */
export function cloudDownloaded(workspaceId: string, tokenId: string, stays: readonly string[] | null) {
  const old = get().cloudPairs[workspaceId]?.tokens ?? []
  setCloudTokens(workspaceId, [tokenId, ...old.filter((t) => !stays || stays.includes(t))], Date.now())
  patchSettings({ enabled: true, via: { ...get().via, [workspaceId]: 'cloud' } })
  fastUntil = Date.now() + 10 * 60_000
  // a worker of an older download may be connected: it stays until the new file connects (no new pairing, no new key)
  if (get().conn === 'connected') return
  set({ relay: null, refused: null })
  disconnect(false)
  attempt = 0
  failingSince = 0
  connect()
}

/** The member revoked their cloud workers here: this device forgets their keys; the link shows "no cloud worker yet". */
export function cloudRevoked(workspaceId: string) {
  setCloudTokens(workspaceId, [])
  set({ relay: { online: false, registered: false, token: null }, pendingHere: false })
  if (get().enabled && currentWorkspace()?.id === workspaceId) reconnect()
}

/** This device's pairing key for the cloud download with this token id (null: none here — another device's). */
async function pairFor(workspaceId: string, token: string | null): Promise<SessionKey | null> {
  if (!token || !get().cloudPairs[workspaceId]?.tokens.includes(token)) return null
  return cloudKey(workspaceId, token)
}

/** The newest download connected: the server revoked every older token of the member — their keys go. */
function forgetPrevious(workspaceId: string, token: string | null) {
  const p = get().cloudPairs[workspaceId]
  if (p && token && p.tokens[0] === token && p.tokens.length > 1) setCloudTokens(workspaceId, [token])
}

/** Keys an earlier build kept as plain text in localStorage: into IndexedDB as non-extractable keys, then out of localStorage. */
async function moveLegacySecrets() {
  const legacy = legacyCloudSecrets()
  if (!legacy.length) return
  for (const l of legacy) await keepCloudKey(l.workspace, l.token, l.secret).catch(() => {})
  const s = get()
  saveCodingSettings({ enabled: s.enabled, port: s.port, pairs: s.pairs, via: s.via, cloudPairs: s.cloudPairs })
}

/** Look for the worker every 1.5 s until then (after a download: the person is about to start it). */
let fastUntil = 0

/**
 * A worker was downloaded for `workspaceId` (download.ts): keep its pairing secret (replacing the last one),
 * switch the link on and look for it often for ten minutes. A connected worker stays connected.
 */
export function pairDownloaded(workspaceId: string, secret: string, connectNow = true) {
  patchSettings({ enabled: true, pairs: { ...get().pairs, [workspaceId]: { secret, at: Date.now() } } })
  if (!connectNow || currentWorkspace()?.id !== workspaceId) return
  fastUntil = Date.now() + 10 * 60_000
  if (get().conn === 'connected') return
  disconnect(false)
  attempt = 0
  failingSince = 0
  connect()
}

/** "Connect to a coding worker on this computer". */
export function setCodingEnabled(on: boolean) {
  patchSettings({ enabled: on })
  if (on) {
    attempt = 0
    connect()
  } else disconnect()
}

export function setCodingPort(port: number) {
  const p = validPort(port)
  if (!p || p === get().port) return
  patchSettings({ port: p })
  if (get().enabled) reconnect()
}

/** "Retry now" / "Use this tab". */
export function reconnect() {
  if (!get().enabled) return setCodingEnabled(true)
  disconnect(false)
  attempt = 0
  connect()
}

/* ------------------------------------------------------------------ connection */

let link: LinkHandle | null = null
let retryTimer = 0
let attempt = 0
let failingSince = 0
let seq = 0
/** bumped by every connect / disconnect: a cloud connect that waited for the server is stale when it changed */
let generation = 0
/** this tab had the worker (a cloud tab that had it may reconnect while in the background) */
let wasCurrent = false
/** the workspace of the last connect (a switch to another one reconnects) */
let lastWs: string | null = null
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: number }>()
/** the workspace this link said hello as */
let helloAs: string | null = null

const BACKOFF = [600, 1200, 2500, 5000, 8000, 12_000]
/** what a Local worker refuses a tab for — each clears once the right file runs (the person restarts it) */
const LOCAL_REFUSALS: ReadonlySet<CodingRefused> = new Set<CodingRefused>(['pair', 'workspace', 'unbound'])
const delay = () => (Date.now() < fastUntil ? 1500 : failingSince && Date.now() - failingSince > 120_000 ? 30_000 : BACKOFF[Math.min(attempt, BACKOFF.length - 1)])

function me(): WorkspaceRef {
  const { role: _role, ...info } = workspaceInfo()
  return info
}

function send(msg: TabMessage) {
  link?.send(msg)
}

function rejectPending() {
  for (const p of pending.values()) {
    window.clearTimeout(p.timer)
    p.reject(new Error(t('features.coding.err.gone')))
  }
  pending.clear()
}

/** Cloud-first AJ onboarding has no local-worker prerequisite; do not probe a worker from another workspace. */
export function workerOptionalHere(): boolean {
  const ws=currentWorkspace(),s=get()
  return !!useWorkspace.getState().ai?.onboarding && !!ws && !s.pairs[ws.id] && !s.cloudPairs[ws.id] && viaFor(ws)!=='cloud'
}

function schedule() {
  window.clearTimeout(retryTimer)
  if (!get().enabled || link) return
  retryTimer = window.setTimeout(connect, delay())
}

/**
 * @param keepRefused a Local worker's refusal stays shown while this try runs (the tab came back: has the person started
 *   the right file?) — another refusal keeps it, an answer clears it, no worker at all waits as usual
 */
function connect(keepRefused = false) {
  window.clearTimeout(retryTimer)
  if (!get().enabled || link) return
  // between workspaces (loading, signed out): wait
  const self = currentWorkspace()
  if (!self) {
    set({ conn: 'waiting' })
    return schedule()
  }
  lastWs = self.id
  if (workerOptionalHere()) { set({conn:'off',refused:null,blocked:null,lna:null}); return }
  if (viaFor(self) === 'cloud') {
    // what the browser said about the Local link does not hold for the team server's
    if (get().blocked || get().lna) set({ blocked: null, lna: null })
    return void connectCloud(self)
  }
  set({ relay: null })
  const port = get().port
  try {
    attach((h) => openLocalLink(port, h))
  } catch {
    // Safari (and older Firefox): an https page may not open ws:// at all — mixed content
    window.clearTimeout(retryTimer)
    set({ conn: 'blocked', blocked: 'insecure', lna: null })
    return
  }
  set((s) => ({ conn: keepRefused && s.conn === 'refused' ? 'refused' : attempt === 0 && s.conn !== 'waiting' ? 'connecting' : 'waiting', blocked: null }))
}

/** The Local Network Access status this service listens to (Chrome answers every query with a new object). */
let lnaStatus: PermissionStatus | null = null

/**
 * A Local link closed before it ever opened: no worker answers — or Chrome keeps this page from reaching apps on this
 * device (Local Network Access). Denied: 'blocked' with the reason and no retries until the permission changes, Retry
 * or the tab is looked at again. Still to be asked: the link keeps trying, the waiting texts say to choose Allow.
 */
function askLocalNetwork() {
  const gen = generation
  void localNetworkStatus().then((st) => {
    const self = currentWorkspace()
    // a newer link, Retry, switched off, another workspace or Cloud meanwhile: that one decides
    if (gen !== generation || link || !get().enabled || get().conn !== 'waiting' || !self || viaFor(self) !== 'local') return
    watchLocalNetwork(st)
    if (st?.state === 'denied') {
      window.clearTimeout(retryTimer)
      return set({ conn: 'blocked', blocked: 'permission', lna: null })
    }
    set({ lna: st?.state === 'prompt' ? 'prompt' : null })
    schedule()
  })
}

function watchLocalNetwork(st: PermissionStatus | null) {
  if (!st || st === lnaStatus || typeof st.addEventListener !== 'function') return
  lnaStatus?.removeEventListener('change', onLocalNetwork)
  lnaStatus = st
  st.addEventListener('change', onLocalNetwork)
}

/** The person changed the permission (site settings, the browser's question): a blocked link tries again once it is not denied. */
function onLocalNetwork() {
  const state = lnaStatus?.state
  const s = get()
  const self = currentWorkspace()
  if (!s.enabled || link || !self || viaFor(self) !== 'local') return
  if (state === 'denied') {
    if (s.conn !== 'waiting') return
    window.clearTimeout(retryTimer)
    return set({ conn: 'blocked', blocked: 'permission', lna: null })
  }
  if (s.conn !== 'waiting' && !(s.conn === 'blocked' && s.blocked === 'permission')) return
  attempt = 0
  set({ lna: state === 'prompt' ? 'prompt' : null })
  connect()
}

/**
 * Cloud: through the team server — only when the relay is there, this member may run tasks, and one of the
 * member's live cloud workers is a download of THIS device (else connecting would only take another device's place).
 */
async function connectCloud(self: { id: string }) {
  const gen = ++generation
  const serverId = useCloud.getState().active.id
  set((s) => ({ conn: s.conn === 'waiting' ? 'waiting' : 'connecting' }))
  const role = useCloud.getState().role
  // the role is not known yet (the workspace is still loading): ask the server nothing before it is
  if (!role) {
    set({ conn: 'waiting' })
    return schedule()
  }
  if (role === 'viewer') return set({ conn: 'refused', refused: 'viewer', relay: null, pendingHere: false })
  const on = await relayAvailable()
  const stale = () => gen !== generation || !!link || !get().enabled
  if (stale()) return
  if (!on) return set({ conn: 'refused', refused: 'relay-off', relay: null, pendingHere: false })
  let mine
  try {
    mine = (await listCloudWorkers(serverId)).filter((w) => w.mine)
  } catch (e) {
    if (gen !== generation || link) return
    // a member made a viewer meanwhile (the server says so before this tab heard of it)
    if (e instanceof CloudError && e.code === 'forbidden') return set({ conn: 'refused', refused: 'viewer', relay: null, pendingHere: false })
    attempt += 1
    failingSince ||= Date.now()
    set({ conn: 'waiting' })
    return schedule()
  }
  if (stale()) return
  // this device's downloads the server no longer lists (revoked, replaced, never started in a day): their keys go —
  // not a download of the last minutes (another tab of this device may have made it after this list was read)
  const live = new Set(mine.map((w) => w.id))
  const pair = get().cloudPairs[self.id]
  const kept = pair?.tokens ?? []
  const fresh = !!pair && Date.now() - pair.at < 5 * 60_000
  const still = kept.filter((t, i) => live.has(t) || (i === 0 && fresh))
  if (still.length !== kept.length) setCloudTokens(self.id, still)
  const held = new Set<string>()
  for (const t of get().cloudPairs[self.id]?.tokens ?? []) if (await cloudKey(self.id, t)) held.add(t)
  if (stale()) return
  const online = mine.find((w) => w.online) ?? null
  if (!mine.some((w) => held.has(w.id))) {
    set({ pendingHere: false, relay: { online: !!online, registered: mine.length > 0, token: null } })
    // none of the member's cloud workers came from this device: say so — nothing to connect to
    return set(mine.length ? { conn: 'refused', refused: 'other-device' } : { conn: 'waiting', refused: null })
  }
  // another device's worker has the member's place — online, or the active one offline for a moment (a restart, a
  // network blip, a server redeploy) — and this device's own download has not started yet: wait for that file (it takes
  // over once it connects). Opening the relay link now would only take the other device's place, and its worker would
  // come back to a tab that cannot use it
  const elsewhere = online ? !held.has(online.id) : mine.some((w) => w.state === 'active' && !held.has(w.id)) && !mine.some((w) => w.state === 'active' && held.has(w.id))
  if (elsewhere) {
    set({ conn: 'waiting', refused: null, pendingHere: true, relay: { online: !!online, registered: true, token: online?.id ?? null } })
    return pollCloud()
  }
  set({ pendingHere: false })
  // a tab opened in the background does not take the worker over (the one the person looks at does)
  if (!wasCurrent && typeof document !== 'undefined' && document.visibilityState !== 'visible') return set({ conn: 'waiting' })
  attach((h) => openCloudLink(serverId, (token) => pairFor(self.id, token), h))
}

const hiddenTab = () => typeof document !== 'undefined' && document.visibilityState !== 'visible'

/** Waiting for this device's own new download while another device's worker has the place: look again soon. */
function pollCloud() {
  window.clearTimeout(retryTimer)
  if (!get().enabled || link) return
  retryTimer = window.setTimeout(connect, hiddenTab() ? 60_000 : Date.now() < fastUntil ? 5000 : 15_000)
}

/** when this tab last asked the server again after another device's worker answered (a guard against a loop) */
let recheckedAt = 0

/**
 * Another device's worker answered on the relay while this device holds downloads of its own: the server's list says
 * which it is — this device's new download not started yet (wait for it), or this device's worker just replaced by
 * another device's newer file ("paired with another device"). Asked once at once, then at the poll's pace.
 */
function recheckCloud() {
  const now = Date.now()
  if (now - recheckedAt < 10_000) return pollCloud()
  recheckedAt = now
  connect()
}

/** when a replaced cloud tab last asked whether its worker is free again */
let replacedAt = 0

/**
 * A cloud tab another tab or device took the worker from (4001) looks now and then (and when it is looked at again)
 * whether this device's own worker is online with no tab handing out its work — the tab that took its place left,
 * or connected to a worker it could not use — and then takes it back. A hidden tab never does.
 */
async function checkReplaced() {
  window.clearTimeout(retryTimer)
  const self = currentWorkspace()
  if (!get().enabled || link || get().conn !== 'replaced' || !self || viaFor(self) !== 'cloud') return
  if (hiddenTab() || Date.now() - replacedAt < 3000) return watchReplaced()
  replacedAt = Date.now()
  const gen = generation
  let again = false
  try {
    const tokens = get().cloudPairs[self.id]?.tokens ?? []
    const own = (await listCloudWorkers(useCloud.getState().active.id)).filter((w) => w.mine && tokens.includes(w.id))
    // free: online, no tab hands out its work · none left: replaced or revoked meanwhile — connectCloud says what is
    // (it opens no link then)
    again = !own.length || own.some((w) => w.online && !w.tab)
  } catch {
    /* the server cannot be reached right now: look again later */
  }
  if (gen !== generation || link || get().conn !== 'replaced' || currentWorkspace()?.id !== self.id) return
  if (!again) return watchReplaced()
  attempt = 0
  connect()
}

function watchReplaced() {
  window.clearTimeout(retryTimer)
  if (!get().enabled || link) return
  retryTimer = window.setTimeout(() => void checkReplaced(), hiddenTab() ? 60_000 : 15_000)
}

/** Open a link (local or cloud) with the one set of handlers. */
function attach(open: (h: LinkHandlers) => LinkHandle) {
  let refused = false
  /** the link carried frames (local: the socket opened) — a close before that may be the browser's block */
  let opened = false
  /** cloud: closed to ask the server which of this device's downloads still work (another device's worker answered) */
  let recheck = false
  let handle: LinkHandle | null = null
  const mine = () => !!handle && link === handle
  const h: LinkHandlers = {
    open: () => {
      if (!mine()) return
      opened = true
      // the browser lets this page through: whatever it said before no longer holds
      if (get().blocked || get().lna) set({ blocked: null, lna: null })
      const self = me()
      helloAs = self.id
      // this device's pairing with the worker downloaded for this workspace (a worker.json worker ignores it) —
      // through the relay the sealed box itself is the proof: the secret never travels
      const pair = handle!.via === 'local' ? get().pairs[self.id]?.secret : undefined
      // `can`: this tab shows the worker's permission requests and answers them (an older tab says nothing: the worker
      // refuses them at once instead of holding the stage for nobody)
      handle!.send({ type: 'hello', app: 'one', version: BRAND.version, workspace: self, ...(pair ? { pair } : {}), can: [...TAB_CAN] })
    },
    message: (msg) => {
      if (!mine()) return
      if (msg.type === 'refused') {
        refused = true
        set({ refused: msg.reason === 'unbound' || msg.reason === 'pair' ? msg.reason : 'workspace', refusedPaired: msg.paired === true, refusedWorkspaceGrant: msg.workspaceGrant === true,
          refusedWorkspaceOwner: typeof msg.workspaceOwner === 'string' ? msg.workspaceOwner.slice(0, 120) : null,
          refusedWorkspaceNonce: typeof msg.workspaceNonce === 'string' ? msg.workspaceNonce.slice(0, 43) : null })
        return
      }
      void receive(msg)
    },
    relay: (view) => {
      if (!mine()) return
      set({ relay: view })
      if (view.online) forgetPrevious(currentWorkspace()?.id ?? '', view.token)
      if (!view.online && get().conn !== 'refused') set({ conn: 'waiting', ...GONE })
    },
    lost: () => {
      if (!mine()) return
      rejectPending()
      helloAs = null
      set({ ...GONE, conn: 'waiting' })
    },
    untrusted: (why) => {
      if (!mine()) return
      rejectPending()
      if (why === 'other-device' && (get().cloudPairs[currentWorkspace()?.id ?? '']?.tokens.length ?? 0) > 0) {
        // another device's worker answered while this device holds downloads of its own: leave the relay link (not that
        // device's place) and ask the server whether one of them still works — this device's new download not started
        // yet (wait for it) — or whether this device's worker was just replaced by the other device's newer file
        recheck = true
        set({ conn: 'connecting', refused: null, pendingHere: false, ...GONE })
      } else {
        refused = true
        set({ conn: 'refused', refused: why, ...GONE })
      }
      handle!.close(1000, why)
    },
    dropped: (n) => {
      if (mine() && n > 0) set((s) => ({ dropped: s.dropped + n }))
    },
    close: (code, reason) => {
      if (!mine()) return
      const via = handle!.via
      link = null
      helloAs = null
      rejectPending()
      set({ ...GONE })
      if (!get().enabled) return set({ conn: 'off' })
      if (recheck) return recheckCloud()
      if (via === 'cloud' && code === RELAY_CLOSE_FORBIDDEN) {
        const why: CodingRefused = reason === 'viewer' || reason === 'role-changed' ? 'viewer' : reason === 'forbidden' ? 'forbidden' : 'removed'
        return set({ conn: 'refused', refused: why, relay: null })
      }
      if (refused || code === WORKER_CLOSE_REFUSED) return set((s) => ({ conn: 'refused', refused: s.refused ?? (reason === 'pair' ? 'pair' : 'workspace') }))
      if (code === WORKER_CLOSE_REPLACED) {
        wasCurrent = false
        set({ conn: 'replaced' })
        // through the relay: take this device's worker back once the tab that took its place lets it go
        if (via === 'cloud') watchReplaced()
        return
      }
      const was = get().conn === 'connected'
      if (was) {
        attempt = 0
        failingSince = 0
      } else {
        attempt += 1
        failingSince ||= Date.now()
      }
      // a refusal this tab showed while it tried again (wake) no longer holds: no worker answers now
      set(via === 'local' ? { conn: 'waiting', refused: null, refusedPaired: false } : { conn: 'waiting' })
      // Local, closed before it ever opened: no worker answers — or the browser blocks this page (askLocalNetwork)
      if (via === 'local' && !opened) return askLocalNetwork()
      schedule()
    },
  }
  handle = open(h)
  link = handle
}

function disconnect(off = true) {
  window.clearTimeout(retryTimer)
  generation += 1
  const l = link
  link = null
  helloAs = null
  rejectPending()
  l?.close(1000, off ? 'switched off' : 'reconnecting')
  set({ conn: off ? 'off' : 'connecting', ...GONE, refused: null, refusedPaired: false, pendingHere: false, blocked: null, lna: null })
}

/* ------------------------------------------------------------------ messages */

function reply(id: string, result: unknown) {
  send({ type: 'res', id, ok: true, result })
}
function fail(id: string, error: string) {
  send({ type: 'res', id, ok: false, error })
}

async function receive(msg: WorkerMessage) {
  switch (msg.type) {
    case 'welcome': {
      attempt = 0
      failingSince = 0
      wasCurrent = true
      const { type: _type, ...info } = msg
      const readiness = captureReadiness();if(link?.via==='local')noteReadiness(readiness,{signal:'worker'});if(readiness)void import('../../cloud/api').then(({request})=>{const current=captureReadiness();if(current?.workspace===readiness.workspace&&current?.user===readiness.user)return request('POST',`api/workspaces/${readiness.workspace}/readiness`,{signal:'sync'})}).catch(()=>{})
      setBusy(info.busy, { conn: 'connected', refused: null, refusedPaired: false, pendingHere: false, worker: info, spentToday: info.spentToday ?? 0 })
      // the worker's repos as Repo options: upkeep, nobody's change (flight recorder)
      withWriter(SYSTEM('maintenance'), () => {
        for (const dbId of pipelineDbIds()) addRepoOptions(dbId, (info.repos ?? []).map((r) => r.name))
      })
      // tasks of this worker that were running when the link dropped: still running there
      for (const b of info.busy ?? []) void patchTask(b.taskId, { state: 'running', stageId: b.stageId })
      return
    }
    case 'status':
      setBusy(msg.busy, { spentToday: msg.spentToday ?? 0 })
      return
    case 'res': {
      const p = pending.get(msg.id)
      if (!p) return
      window.clearTimeout(p.timer)
      pending.delete(msg.id)
      if (msg.ok) p.resolve(msg.result)
      else p.reject(new Error(msg.error))
      return
    }
    case 'event':
      return onEvent(msg)
    case 'req':
      return onRequest(msg)
  }
}

/** The worker's events belong to tasks of this workspace's Coding database only. */
function ownTask(taskId: string): boolean {
  return !!taskContext(taskId)
}

function onEvent(msg: Extract<WorkerMessage, { type: 'event' }>) {
  const taskId = String(msg.taskId)
  if (!ownTask(taskId)) return
  switch (msg.kind) {
    case 'log':
      appendLog(taskId, (Array.isArray(msg.lines) ? msg.lines : []).filter((l) => l && typeof l.s === 'string').map((l) => ({ t: Number(l.t) || Date.now(), k: l.k, s: l.s.slice(0, 8000), ...cleanCode(l), ...cleanEdit(l.e) })))
      return
    case 'progress': {
      const p = msg.progress
      if (!p || typeof p !== 'object') return
      const num = (x: unknown, max: number) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.min(x, max) : 0)
      const progress = {
        turns: Math.round(num(p.turns, 10_000)),
        maxTurns: Math.round(num(p.maxTurns, 10_000)),
        cost: typeof p.cost === 'number' && Number.isFinite(p.cost) ? num(p.cost, 100_000) : null,
        model: typeof p.model === 'string' ? p.model.slice(0, 80) : null,
        at: Date.now(),
      }
      set((st) => ({ progress: { ...st.progress, [taskId]: progress } }))
      return
    }
    case 'git': {
      void patchTask(taskId, { git: msg.git })
      const ctx = taskContext(taskId)
      // the live git snapshot of a running stage: progress bookkeeping (store/writer.ts)
      if (ctx?.props.git && msg.git) withWriter(SYSTEM('bookkeeping'), () => useWorkspace.getState().setRowProperty(taskId, ctx.props.git!, gitSummary(msg.git!)))
      return
    }
    case 'note':
      return
    case 'question':
      void patchTask(taskId, { question: String(msg.text).slice(0, 4000) })
      return
    case 'permission': {
      // worker 1.11.0: the request the stage waits for now (null: none any more)
      const ask = cleanAsk(msg.ask)
      set((st) => {
        if (!ask && !st.asks[taskId]) return st
        const asks = { ...st.asks }
        if (ask) asks[taskId] = ask
        else delete asks[taskId]
        return { asks }
      })
      if (ask) tellAsk(taskId, ask)
      return
    }
    case 'intake': {
      const i = msg.intake
      if (!i || typeof i !== 'object' || !['running', 'done', 'failed'].includes(i.state)) return
      const s = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '')
      const repo = s(i.repo, 64)
      const intake = {
        state: i.state,
        source: i.source === 'clone' ? ('clone' as const) : ('zip' as const),
        label: s(i.label, 300),
        line: s(i.line, 300),
        percent: typeof i.percent === 'number' && Number.isFinite(i.percent) ? Math.max(0, Math.min(100, i.percent)) : null,
        ...(repo && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(repo) ? { repo } : {}),
        ...(i.suggest ? { suggest: s(i.suggest, 100) } : {}),
        ...(i.error ? { error: s(i.error, 600) } : {}),
        at: Date.now(),
      }
      set((st) => ({ intake: { ...st.intake, [taskId]: intake } }))
      if (intake.state === 'done' && intake.repo) void intakeDone(taskId, intake.repo, intake.label)
      return
    }
  }
}

async function onRequest(msg: Extract<WorkerMessage, { type: 'req' }>) {
  const id = String(msg.id)
  // the tab answers only while it shows the workspace it said hello as
  const now = currentWorkspace()
  if (!now || now.id !== helloAs) return fail(id, 'One switched workspace')
  try {
    switch (msg.op) {
      case 'next': {
        const name = get().worker?.name ?? String(msg.worker ?? '')
        const can = Array.isArray(msg.can) ? msg.can.filter((c): c is string => typeof c === 'string').slice(0, 32) : []
        const prev = get().can
        if (!prev || prev.join() !== can.join()) set({ can })
        const task = await pickNext(Array.isArray(msg.repos) ? msg.repos.map(String) : [], name, msg.docs === true, can)
        return reply(id, { task })
      }
      case 'heartbeat':
        heartbeat(Array.isArray(msg.taskIds) ? msg.taskIds.map(String) : [], get().worker?.name ?? '')
        return reply(id, { ok: true })
      case 'finish': {
        const taskId = String(msg.taskId)
        // the same outcome again (its answer was lost on the way back): answered, not applied twice
        const finishId = typeof msg.finishId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(msg.finishId) ? msg.finishId : null
        if (finishId) {
          await loadTask(taskId)
          if (taskLocal(taskId).finished?.includes(finishId)) return reply(id, { ok: true })
        }
        await finishStage(taskId, String(msg.stageId), msg.outcome ?? { status: 'failed', error: 'no outcome' })
        if (finishId && taskContext(taskId)) await patchTask(taskId, { finished: [...(taskLocal(taskId).finished ?? []), finishId].slice(-20) })
        void flushLogs()
        return reply(id, { ok: true })
      }
      default:
        return fail(id, 'unknown request')
    }
  } catch (e) {
    console.warn('[one] coding: a worker request failed', e)
    return fail(id, e instanceof Error ? e.message : String(e))
  }
}

/** Ask the worker (Stop, git verbs). */
function request(body: Omit<Extract<TabMessage, { type: 'req' }>, 'id' | 'type'>, timeoutMs = 120_000): Promise<unknown> {
  const l = link
  if (!l || get().conn !== 'connected') return Promise.reject(new Error(t('features.coding.err.noWorker')))
  const id = `t${++seq}`
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id)
      reject(new Error(t('features.coding.err.timeout')))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    l.send({ type: 'req', id, ...body } as TabMessage)
  })
}

/**
 * "Change repositories": the worker opens its setup page on its own screen. One never learns the page's
 * address or key — it only hears whether a browser opened.
 */
export async function openWorkerSetup(): Promise<OpenSetupResult> {
  const res = (await request({ op: 'open-setup' } as never, 20_000)) as OpenSetupResult | null
  return { opened: res?.opened === true, ...(res?.reason === 'off' || res?.reason === 'no-browser' ? { reason: res.reason } : {}) }
}

/** Ask the worker for work now (debounced). */
let nudgeTimer = 0
export function nudgeWorker() {
  if (get().conn !== 'connected') return
  window.clearTimeout(nudgeTimer)
  nudgeTimer = window.setTimeout(() => send({ type: 'nudge' }), 150)
}

/** A slice of a file as base64 (the link carries JSON). */
function base64Of(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(r.error ?? new Error('read failed'))
    r.readAsDataURL(blob)
  })
}

/** Through the relay: ZIP pieces per 10 s stay under this on the wire (the relay's budget per socket is 128 MiB). */
const CLOUD_UPLOAD_WINDOW_MS = 10_000
const CLOUD_UPLOAD_BYTES = 96 * 1024 * 1024

/** Wait until `n` more bytes fit into the last 10 s of `sent` (cloud uploads), then count them. */
async function paced(sent: Array<{ at: number; n: number }>, n: number) {
  for (;;) {
    const now = Date.now()
    while (sent.length && now - sent[0]!.at > CLOUD_UPLOAD_WINDOW_MS) sent.shift()
    if (!sent.length || sent.reduce((a, x) => a + x.n, 0) + n <= CLOUD_UPLOAD_BYTES) break
    await new Promise((r) => window.setTimeout(r, sent[0]!.at + CLOUD_UPLOAD_WINDOW_MS - now + 20))
  }
  sent.push({ at: Date.now(), n })
}

/**
 * Import stage: hand the worker a ZIP the person picked for this task — in pieces over the link (through the relay
 * paced: ≤ 96 MiB per 10 s, a 500 MB ZIP takes about a minute and a half). The worker unpacks it into a new
 * repository; its `intake` events follow (the task takes the repo when it is done).
 */
export async function sendTaskZip(taskId: string, file: File): Promise<void> {
  if (!/\.zip$/i.test(file.name)) throw new Error(t('features.coding.intake.notZip'))
  set((st) => ({ intake: { ...st.intake, [taskId]: { state: 'running', source: 'zip', label: file.name, line: t('features.coding.intake.sending'), percent: 0, at: Date.now() } } }))
  try {
    const begin = (await request({ op: 'intake-begin', taskId, name: file.name, size: file.size } as never, 30_000)) as { uploadId?: string; chunk?: number } | null
    const uploadId = String(begin?.uploadId ?? '')
    if (!uploadId) throw new Error(t('features.coding.err.timeout'))
    const step = Math.max(64 * 1024, Math.min(4 * 1024 * 1024, Number(begin?.chunk) || 4 * 1024 * 1024))
    const sent: Array<{ at: number; n: number }> = []
    for (let off = 0; off < file.size; off += step) {
      const piece = file.slice(off, off + step)
      // a boxed piece ≈ 16/9 of its bytes (base64 in the request, base64 of the ciphertext)
      if (link?.via === 'cloud') await paced(sent, Math.ceil((piece.size * 16) / 9) + 1024)
      await request({ op: 'intake-chunk', uploadId, data: await base64Of(piece) } as never, 120_000)
    }
    await request({ op: 'intake-end', uploadId } as never, 60_000)
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    set((st) => ({ intake: { ...st.intake, [taskId]: { state: 'failed', source: 'zip', label: file.name, line: '', percent: null, error, at: Date.now() } } }))
    throw e
  }
}

/** Import stage: the worker clones an address into a new repository (followed by its `intake` events). */
export async function cloneForTask(taskId: string, url: string): Promise<void> {
  set((st) => ({ intake: { ...st.intake, [taskId]: { state: 'running', source: 'clone', label: url.trim(), line: '', percent: null, at: Date.now() } } }))
  try {
    await request({ op: 'intake-clone', taskId, url: url.trim() } as never, 30_000)
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    set((st) => ({ intake: { ...st.intake, [taskId]: { state: 'failed', source: 'clone', label: url.trim(), line: '', percent: null, error, at: Date.now() } } }))
    throw e
  }
}

/** Stop the task's running stage (the worker ends Claude Code's whole process tree). */
export async function stopTask(taskId: string): Promise<void> {
  await request({ op: 'stop', taskId } as never, 15_000)
}

/**
 * The person's answer to the permission request a running stage waits for (worker 1.11.0): only the request's id and a
 * fixed verb go to the worker — "always" stores the rule the worker showed (in its own worker.json). 'gone': it was
 * answered elsewhere, timed out or the stage ended meanwhile.
 */
export async function answerPermission(taskId: string, askId: string, verb: PermissionVerb): Promise<'ok' | 'gone'> {
  const res = (await request({ op: 'permission', taskId, ask: askId, verb } as never, 20_000)) as { ok?: boolean } | null
  // answered: off the card at once (the worker's status follows)
  set((st) => {
    if (st.asks[taskId]?.id !== askId) return st
    const asks = { ...st.asks }
    delete asks[taskId]
    return { asks }
  })
  return res?.ok ? 'ok' : 'gone'
}

/** The permission request a running task waits for on this device (null: none). */
export function askOf(taskId: string): PermissionAsk | null {
  return get().asks[taskId] ?? null
}

/** A git verb the person asked for in the task panel: its results are theirs (flight recorder). */
const PERSON: Writer = { kind: 'you', via: 'ui' }

/**
 * How long a git key may take before the tab stops waiting: at least the worker's own worst case — a push (300 s), then
 * gh / glab (version 10 s, view 30 s, create 120 s, view again 30 s), a merge (gh tries up to three methods, 300 s each,
 * then a fetch). A tab that gave up earlier would drop the late answer — the push and the request happen all the same,
 * but no note and no PR / Commit would be written. A link that drops ends the wait at once (as for every request).
 */
const GIT_KEY_MS: Partial<Record<GitVerb, number>> = {
  push: 8 * 60_000,
  'force-push': 8 * 60_000,
  pr: 12 * 60_000,
  'comment-pr': 5 * 60_000,
  'merge-pr': 18 * 60_000,
  'update-base': 8 * 60_000,
  discard: 5 * 60_000,
  cleanup: 5 * 60_000,
}

/**
 * One of the fixed git verbs for a task's branch. Updates the git state, the PR field and — worker 1.10.0 — writes the
 * key's ship record into the page ("Git (by hand) · <date time>", ship.ts). `error`: the key 'pr' pushed, but the request
 * could not be opened (the push is recorded all the same).
 */
export async function gitTask(taskId: string, verb: GitVerb, message?: string): Promise<GitResult> {
  const ctx = taskContext(taskId)
  if (!ctx) throw new Error(t('features.coding.err.noTask'))
  const repo = ctx.props.repo ? ctx.db.properties.find((p) => p.id === ctx.props.repo)?.options?.find((o) => o.id === ctx.row.properties[ctx.props.repo!])?.name : null
  if (!repo) throw new Error(t('features.coding.err.noRepo'))
  const branch = ctx.props.branch ? String(ctx.row.properties[ctx.props.branch] ?? '').trim() || null : null
  // a branch another live task holds (QA on the Coding step's branch): no discard / clean-up from One (guards.ts)
  if (verb === 'discard' || verb === 'cleanup') {
    const holder = branchHolders(taskId)[0]
    if (holder) throw new Error(t('features.coding.git.shared', { branch: branch ?? '', title: holder.title || t('common.untitled') }))
  }
  const res = (await request({ op: 'git', taskId, verb, repo, branch, title: ctx.row.title.trim() || t('common.untitled'), ...(message ? { message } : {}) } as never, GIT_KEY_MS[verb] ?? 120_000)) as GitResult
  await loadTask(taskId)
  const s = useWorkspace.getState()
  const ship = cleanShip(res?.ship)
  const error = typeof res?.error === 'string' && res.error.trim() ? res.error.slice(0, 2000) : null
  if (ship) noteShip({ taskId, dbId: ctx.db.id, ship })
  // the git summary is bookkeeping (like the live snapshot); the request's address and a branch gone are the person's
  if (res?.git) {
    await patchTask(taskId, { git: res.git })
    if (ctx.props.git) withWriter(SYSTEM('bookkeeping'), () => s.setRowProperty(taskId, ctx.props.git!, gitSummary(res.git!)))
  }
  // PR / Commit and the ship note are the person's (their key) — inside keepTrust: the version takes the page and the field
  const prNow = () => (ctx.props.pr ? String(useWorkspace.getState().pages[taskId]?.properties[ctx.props.pr] ?? '') : '')
  const next = ship ? prFieldNext(prNow(), ship) : (res?.url ?? null)
  if ((next && ctx.props.pr) || (ship && shipShows(ship)))
    await keepTrust(
      [taskId],
      () => {
        if (next && ctx.props.pr && next !== prNow()) useWorkspace.getState().setRowProperty(taskId, ctx.props.pr, next)
        if (ship && shipShows(ship)) writeShipNote(taskId, t('features.coding.ship.byHand'), ship)
      },
      PERSON,
    )
  if (next) await patchTask(taskId, { url: next })
  if (verb === 'discard' || verb === 'cleanup') {
    if (ctx.props.git) withWriter(SYSTEM('bookkeeping'), () => s.setRowProperty(taskId, ctx.props.git!, null))
    if (res?.branchGone && ctx.props.branch) withWriter(PERSON, () => s.setRowProperty(taskId, ctx.props.branch!, null))
    await patchTask(taskId, { git: null })
  }
  const { ship: _raw, error: _err, ...rest } = res ?? ({} as GitResult)
  return { ...rest, ...(ship ? { ship } : {}), ...(error ? { error } : {}) }
}

/** Is the worker on this device working on the task right now? */
export function isRunning(taskId: string): boolean {
  return get().busy.some((b) => b.taskId === taskId)
}

/* ------------------------------------------------------------------ start */

let started = false

/** Background service (main.tsx, after the workspace loaded). Does nothing until switched on. */
export function startCoding() {
  if (started || typeof window === 'undefined' || typeof WebSocket === 'undefined') return
  started = true
  setNudge(nudgeWorker)
  startTrustWatch()
  // work orders: the trigger subscriber (the allow-list of presses), kept presses, the requests' Repo options
  startOrders()
  // rows that become tasks here take this device's Approvals of that moment (switched on or not)
  startApprovalsWatch()
  // an earlier build's plain-text cloud secrets become non-extractable keys before the first cloud link
  void moveLegacySecrets().finally(() => {
    if (get().enabled && !link) connect()
  })
  // the tab shows another workspace now: this link (or this refusal) belongs to the old one
  const onWorkspace = () => {
    const now = currentWorkspace()
    if (!get().enabled) return
    if (link && now?.id !== lastWs) reconnect()
    else if (!link && now && now.id !== lastWs && get().conn !== 'connecting') reconnect()
  }
  useWorkspace.subscribe((s, prev) => {
    const boundary = (x: typeof s) => JSON.stringify([x.ai?.dataFlow?.providers, x.ai?.dataFlow?.mcpOrigins, x.ai?.policy?.restricted, x.settings.ai?.restricted])
    if (s.epoch === prev.epoch && boundary(s) !== boundary(prev) && get().conn === 'connected') {
      for (const busy of get().busy) void stopTask(busy.taskId).catch(() => {})
      nudgeWorker()
    }
    if (s.epoch !== prev.epoch || s.ready !== prev.ready) onWorkspace()
    // tasks changed (a new task, a stage moved): the worker may have work
    if (get().conn !== 'connected' || s.pages === prev.pages) return
    const dbIds = new Set(pipelineDbIds())
    if (!dbIds.size) return
    for (const id of pageChanges(s.pages, prev.pages).changed) {
      const now = s.pages[id]
      const before = prev.pages[id]
      if (!now?.databaseId || !dbIds.has(now.databaseId)) continue
      const props = s.databases[now.databaseId] ? codingProps(s.databases[now.databaseId]!) : null
      if (!before || (props?.stage && now.properties[props.stage] !== before.properties[props.stage]) || (props?.repo && now.properties[props.repo] !== before.properties[props.repo])) {
        nudgeWorker()
        break
      }
    }
  })
  useCloud.subscribe((s, prev) => {
    if (s.active !== prev.active || s.status !== prev.status) onWorkspace()
    // promoted from viewer: the viewer refusal no longer holds (the worker comes back by itself; this tab asks again)
    if (s.role !== prev.role && s.role && s.role !== 'viewer' && get().enabled && !link && get().conn === 'refused' && get().refused === 'viewer') reconnect()
  })
  // settings changed in another tab: switching off disconnects everywhere
  window.addEventListener('storage', (e) => {
    // "Use for new tasks" in another tab of this device
    if (e.key === APPROVALS_KEY) set({ approvalsDefault: defaultApprovals() })
    if (e.key !== CODING_STORAGE_KEY) return
    const next = e.newValue ? loadCodingSettings() : { ...DEFAULT_CODING }
    if (!next.enabled && get().enabled) {
      set({ enabled: false })
      disconnect()
    }
    if (next.port !== get().port) set({ port: next.port })
    // a download in another tab: its pairing is this device's now (used on the next hello)
    const ws = currentWorkspace()
    const before = ws ? viaFor(ws) : 'local'
    const pairBefore = ws ? get().cloudPairs[ws.id]?.tokens[0] : undefined
    set({ pairs: next.pairs, via: next.via, cloudPairs: next.cloudPairs })
    // Local | Cloud switched, or a new cloud download, in another tab of this device
    if (ws && get().enabled && (viaFor(ws) !== before || (before === 'cloud' && get().cloudPairs[ws.id]?.tokens[0] !== pairBefore && get().conn !== 'connected'))) reconnect()
  })
  const wake = () => {
    if (document.visibilityState !== 'visible' || !get().enabled || link) return
    const s = get()
    // waiting, or blocked by the browser (the person may have allowed it meanwhile): try again now
    if (s.conn === 'waiting' || s.conn === 'blocked') {
      attempt = Math.min(attempt, 1)
      connect()
    } else if (s.conn === 'replaced') void checkReplaced()
    else if (s.conn === 'refused' && s.refused && LOCAL_REFUSALS.has(s.refused) && viaFor(currentWorkspace()) === 'local') {
      // a Local worker said no (an older download, another workspace's, an unbound one): a link it refused never tries
      // again by itself — the person comes back from the terminal where they started the right file, so try once now
      attempt = Math.min(attempt, 1)
      connect(true)
    }
  }
  document.addEventListener('visibilitychange', wake)
  window.addEventListener('focus', wake)
  window.addEventListener('online', wake)
  window.addEventListener('pagehide', () => {
    void flushLogs()
    // a page may only close with 1000 or 3000–4999 (1001 throws)
    link?.close(1000, 'tab closed')
  })
}

/** Plain inference uses the same paired link, independent of coding jobs; no repo or tool access. */
export async function requestTextModels(): Promise<WorkerModel[]> {
  const result = await request({ op: 'text-models' } as never, 45000)
  return Array.isArray(result) ? result : []
}
export async function requestWorkerText(body: WorkerTextRequest, signal?: AbortSignal): Promise<WorkerTextResult> {
  if (!modelDestinationAllowed(body.provider, useWorkspace.getState().ai?.dataFlow)) throw new Error('Model destination is excluded by the workspace data-flow rule.')
  const workspace = useWorkspace.getState()
  if ((hasFlowLimits(workspace.ai?.dataFlow) || workspace.ai?.policy?.restricted?.length || workspace.settings.ai?.restricted?.length) && !get().can?.includes('data-flow')) throw new Error('Update the coding worker to use explicit data-route boundaries.')
  signal?.throwIfAborted()
  const readiness = captureReadiness()
  const requestId = crypto.randomUUID()
  const stop = () => { void request({ op: 'text-stop', requestId } as never, 5000).catch(() => {}) }
  signal?.addEventListener('abort', stop, { once: true })
  try {
    const result = await request({ op: 'text-request', requestId, request: body } as never, 190000) as WorkerTextResult
    if(body.provider==='copilot'&&typeof result?.text==='string'&&result.text.trim()&&!signal?.aborted)noteReadiness(readiness,{signal:'copilot'})
    return result
  } finally { signal?.removeEventListener('abort', stop) }
}

export function cloudAtlasMcpReady(servers: readonly {name:string;url:string}[]): boolean {
  const cloud=useCloud.getState(),setup=useWorkspace.getState().ai?.onboarding
  return cloud.active.kind==='cloud' && !!cloud.supports?.includes('atlas-mcp:1') && !!setup && servers.length===1 && servers.every(s=>s.url===setup.mcpUrl&&s.name===setup.mcpName)
}

export async function requestWorkerMcp(body: WorkerMcpRequest, signal?: AbortSignal): Promise<unknown> {
  if (body.servers.some(s => !mcpDestinationAllowed(s.url, useWorkspace.getState().ai?.dataFlow))) throw new Error('MCP destination is excluded by the workspace data-flow rule.')
  signal?.throwIfAborted()
  const readiness = captureReadiness()
  const cloud = useCloud.getState(), setup = useWorkspace.getState().ai?.onboarding
  if (cloud.active.kind === 'cloud' && setup && cloudAtlasMcpReady(body.servers)) {
    const result = await cloudRequest<{result?:string}>('POST',`api/workspaces/${cloud.active.id}/atlas-mcp`,body,{signal})
    if(body.action==='call'&&!signal?.aborted)noteAtlasRead(readiness,setup.mcpUrl,body.name,result?.result)
    return result
  }
  const requestId = crypto.randomUUID()
  const stop = () => { void request({ op: 'text-stop', requestId } as never, 5000).catch(() => {}) }
  signal?.addEventListener('abort', stop, { once: true })
  try {
    const result = await request({ op: 'model-mcp', requestId, request: body } as never, 190000) as {result?:string}
    if(body.action==='call'&&!signal?.aborted)noteAtlasRead(readiness,body.servers.find(s=>s.name===body.server)?.url,body.name,result?.result)
    return result
  }
  finally { signal?.removeEventListener('abort', stop) }
}

/** Configure only this member’s paired cloud worker, never someone else’s model host. */
export const modelShareStatus = () => request({op:"model-share-status"} as never, 15000)
export const configureModelShare = (choice:{model:string;label:string;enabled:boolean}) => request({op:"model-share-config",choice} as never, 45000)


export interface ManagedWorkerStatus { path?: string; installed: boolean; version: string; previous: string | null; phase: string; error?: string; available?: string }
export async function manageWorker(action: 'status' | 'update' | 'rollback' | 'cancel'): Promise<ManagedWorkerStatus> {
  return await request({ op: 'worker-manage', action } as never, 50_000) as ManagedWorkerStatus
}

/** File reads always use this person's paired channel, never the shared model host. */
export async function requestRepoFiles(body: RepoFilesRequest): Promise<RepoFilesResult> {
  if (!get().can?.includes('repo-files')) throw new Error('Update and connect your own worker to browse repository files.')
  const channel=link, scope=currentWorkspace()?.id, user=useCloud.getState().user?.id
  const result=await request({op:'repo-files',request:body} as never,30000) as RepoFilesResult
  if (channel!==link || scope!==currentWorkspace()?.id || user!==useCloud.getState().user?.id) throw new Error('The workspace or worker changed. Select the files again.')
  if (result?.repo!==body.repo || typeof result.branch!=='string' || (body.action==='read' && (!result.file || result.file.path!==body.path))) throw new Error('Invalid repository file response.')
  return result
}
