/**
 * Boot: is there a server, which workspace does this tab show, is there a session?
 *
 *  - The GitHub Pages build (base ≠ '/') never asks: local only, no request at all.
 *  - Local workspace chosen: boot at once; the server / session are looked up in the background
 *    (for the workspace switcher). api/session is only asked when this browser has signed in before
 *    (or just came back from a magic link) — anonymous visitors cause no session lookups at all.
 *  - Cloud workspace chosen: GET api/config + api/session, then the store is hydrated from the
 *    workspace's local copy (IndexedDB) and syncs in the background. Without a connection the
 *    local copy opens offline (when this browser has been signed in before).
 */
import { useWorkspace, emptyWorkspace } from '../store/store'
import { fetchConfig, getSession, notifyUnauthenticated, setServerKnown, setServerProbe, type ServerConfig } from './api'
import { listenForForget, runPendingForget } from './device'
import { readChoice, readSession, SERVER_CAPABLE, writeChoice, writeSession } from './env'
import { useCloud, useCloudSync, type CloudUser, type CloudWorkspace, type WorkspaceRef } from './state'
import { emptySettings, openCloudWorkspace } from './workspace'

const LOCAL: WorkspaceRef = { kind: 'local', id: 'local' }

/** One GET api/config at a time; REST calls made before it answered wait for it (see api.ts). */
let detection: Promise<ServerConfig | 'absent' | 'network'> | null = null
function probeServer(timeoutMs: number): Promise<ServerConfig | 'absent' | 'network'> {
  detection ??= fetchConfig(timeoutMs).then((cfg) => {
    if (cfg === 'absent') setServerKnown(false)
    else if (cfg !== 'network') applyConfig(cfg)
    return cfg
  })
  return detection
}

/** Is there a server here? (Waits for the boot's detection, or asks.) A network failure counts as yes: the call itself reports it. */
export async function ensureServer(): Promise<boolean> {
  const cfg = await probeServer(6000)
  if (cfg === 'network') detection = null
  return cfg !== 'absent'
}
setServerProbe(ensureServer)

/** URL marker a magic link brings back (see requestSignIn): ask /api/me even in local mode. */
export const SIGNED_IN_PARAM = 'signed-in'

function consumeSignedInMarker(): boolean {
  try {
    const url = new URL(window.location.href)
    if (!url.searchParams.has(SIGNED_IN_PARAM)) return false
    url.searchParams.delete(SIGNED_IN_PARAM)
    history.replaceState(history.state, '', url.toString())
    return true
  } catch {
    return false
  }
}

/** What the server says about itself, into useCloud / useCloudSync. */
export function applyConfig(cfg: ServerConfig): void {
  setServerKnown(true)
  useCloudSync.setState({ maxUploadMb: cfg.max_upload_mb })
  const mode = cfg.signup?.mode
  useCloud.setState({
    available: true,
    signup: mode === 'open' || mode === 'invite' || mode === 'domains' ? mode : null,
    signupDomains: Array.isArray(cfg.signup?.domains) ? cfg.signup.domains : [],
  })
}

function overrideActive(): boolean {
  try {
    return new URLSearchParams(window.location.search).has('w')
  } catch {
    return false
  }
}

async function hydrateSignedOut(): Promise<void> {
  const ws = emptyWorkspace()
  ws.settings = await emptySettings()
  useWorkspace.getState().hydrate(ws)
}

async function openOffline(choice: { id: string }): Promise<'cloud' | null> {
  const cached = readSession()
  const ws = cached?.workspaces.find((w) => w.id === choice.id)
  if (!cached || !ws) return null
  useCloud.setState({ available: true, user: cached.user, workspaces: cached.workspaces, role: ws.role, readOnly: ws.role === 'viewer', status: 'offline' })
  await openCloudWorkspace(ws, cached.user, false)
  return 'cloud'
}

function fallBackToLocal(error: string | null, forget: boolean) {
  if (forget && !overrideActive()) writeChoice(LOCAL)
  useCloud.setState({ status: 'local', active: LOCAL, role: null, readOnly: false, error })
}

export async function bootCloud(): Promise<'local' | 'cloud' | 'signed-out'> {
  if (!SERVER_CAPABLE) {
    setServerKnown(false)
    useCloud.setState({ available: false, status: 'local', active: LOCAL })
    return 'local'
  }
  // copies of team workspaces removed from this browser (sign-out on a shared computer, "remove
  // this workspace's copy") go first — before anything opens their databases
  await runPendingForget()
  listenForForget(
    () => (useCloud.getState().active.kind === 'cloud' ? useCloud.getState().active.id : null),
    () => switchWorkspaceImpl(LOCAL),
  )
  const choice = readChoice()
  const signedInMarker = consumeSignedInMarker()
  if (choice.kind === 'local') {
    useCloud.setState({ status: 'local', active: LOCAL })
    void detect(signedInMarker)
    return 'local'
  }

  useCloud.setState({ status: 'checking', active: choice })
  const cfg = await probeServer(4000)
  if (cfg === 'absent') {
    setServerKnown(false)
    fallBackToLocal(null, false)
    return 'local'
  }
  if (cfg === 'network') {
    // offline, or the server is down right now: the local copy, if this browser has one
    if (await openOffline(choice)) return 'cloud'
    fallBackToLocal('network', false)
    return 'local'
  }
  applyConfig(cfg)

  // GET api/session (not /api/me): signed out is a 200 with `user: null`, no 401 in the console
  let me: { user: CloudUser; workspaces: CloudWorkspace[] } | null
  try {
    me = await getSession()
  } catch {
    if (await openOffline(choice)) return 'cloud'
    fallBackToLocal('network', false)
    return 'local'
  }
  if (!me) {
    writeSession(null)
    useCloud.setState({ status: 'signed-out', user: null, workspaces: [], role: null, readOnly: true, error: null })
    await hydrateSignedOut()
    return 'signed-out'
  }
  writeSession({ ...me, at: Date.now() })
  useCloud.setState({ user: me.user, workspaces: me.workspaces })
  const ws = me.workspaces.find((w) => w.id === choice.id)
  if (!ws) {
    fallBackToLocal('workspace_not_found', true)
    return 'local'
  }
  useCloud.setState({ role: ws.role, readOnly: ws.role === 'viewer', status: 'connecting', error: null })
  await openCloudWorkspace(ws, me.user, true)
  return 'cloud'
}

/** Local mode: find the server and the session for the switcher, without delaying the boot. */
async function detect(signedInMarker: boolean): Promise<void> {
  const cfg = await probeServer(8000)
  if (cfg === 'absent') {
    setServerKnown(false)
    return
  }
  if (cfg === 'network') {
    detection = null // ask again next time
    // offline: what we knew last time
    const cached = readSession()
    if (cached) useCloud.setState({ user: cached.user, workspaces: cached.workspaces })
    window.addEventListener('online', () => void detect(false), { once: true })
    return
  }
  applyConfig(cfg)
  if (!signedInMarker && !readSession()) return
  await refreshMe()
}

/** GET api/session → useCloud user / workspaces (null when signed out). */
export async function refreshMe(): Promise<{ user: CloudUser; workspaces: CloudWorkspace[] } | null> {
  let me: { user: CloudUser; workspaces: CloudWorkspace[] } | null
  try {
    me = await getSession()
  } catch {
    return null
  }
  if (!me) {
    writeSession(null)
    useCloud.setState({ user: null, workspaces: [] })
    // an open cloud workspace stops syncing (as on a 401)
    notifyUnauthenticated()
    return null
  }
  writeSession({ ...me, at: Date.now() })
  useCloud.setState({ user: me.user, workspaces: me.workspaces })
  return me
}

/** Remember the choice for this browser and reload the app into that workspace. */
export function switchWorkspaceImpl(ref: WorkspaceRef): void {
  writeChoice(ref.kind === 'local' ? LOCAL : ref)
  try {
    const url = new URL(window.location.href)
    url.searchParams.delete('w')
    url.searchParams.delete(SIGNED_IN_PARAM)
    url.hash = ''
    window.location.replace(url.toString())
  } catch {
    window.location.reload()
  }
}
