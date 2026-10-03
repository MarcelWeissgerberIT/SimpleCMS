/**
 * Boot: is there a server, which workspace does this tab show, is there a session?
 *
 *  - The GitHub Pages build (base ≠ '/') never asks: local only, no request at all.
 *  - Local workspace chosen: boot at once; the server / session are looked up in the background
 *    (for the workspace switcher). /api/me is only asked when this browser has signed in before
 *    (or just came back from a magic link), so anonymous visitors see no 401 in the console.
 *  - Cloud workspace chosen: GET api/config + /api/me, then the store is hydrated from the
 *    workspace's local copy (IndexedDB) and syncs in the background. Without a connection the
 *    local copy opens offline (when this browser has been signed in before).
 */
import { useWorkspace, emptyWorkspace } from '../store/store'
import { fetchConfig, getMe, setServerKnown } from './api'
import { readChoice, readSession, SERVER_CAPABLE, writeChoice, writeSession } from './env'
import { useCloud, useCloudSync, type CloudUser, type CloudWorkspace, type WorkspaceRef } from './state'
import { emptySettings, openCloudWorkspace } from './workspace'

const LOCAL: WorkspaceRef = { kind: 'local', id: 'local' }

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
  const choice = readChoice()
  const signedInMarker = consumeSignedInMarker()
  if (choice.kind === 'local') {
    useCloud.setState({ status: 'local', active: LOCAL })
    void detect(signedInMarker)
    return 'local'
  }

  useCloud.setState({ status: 'checking', active: choice })
  const cfg = await fetchConfig(4000)
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
  setServerKnown(true)
  useCloudSync.setState({ maxUploadMb: cfg.max_upload_mb })
  useCloud.setState({ available: true })

  let me: { user: CloudUser; workspaces: CloudWorkspace[] }
  try {
    me = await getMe()
  } catch (e) {
    if ((e as { status?: number }).status === 401) {
      writeSession(null)
      useCloud.setState({ status: 'signed-out', user: null, workspaces: [], role: null, readOnly: true, error: null })
      await hydrateSignedOut()
      return 'signed-out'
    }
    if (await openOffline(choice)) return 'cloud'
    fallBackToLocal('network', false)
    return 'local'
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
  const cfg = await fetchConfig(8000)
  if (cfg === 'absent') {
    setServerKnown(false)
    return
  }
  if (cfg === 'network') {
    // offline: what we knew last time
    const cached = readSession()
    if (cached) useCloud.setState({ user: cached.user, workspaces: cached.workspaces })
    window.addEventListener('online', () => void detect(false), { once: true })
    return
  }
  setServerKnown(true)
  useCloudSync.setState({ maxUploadMb: cfg.max_upload_mb })
  useCloud.setState({ available: true })
  if (!signedInMarker && !readSession()) return
  await refreshMe()
}

/** GET /api/me → useCloud user / workspaces (null when signed out). */
export async function refreshMe(): Promise<{ user: CloudUser; workspaces: CloudWorkspace[] } | null> {
  try {
    const me = await getMe()
    writeSession({ ...me, at: Date.now() })
    useCloud.setState({ user: me.user, workspaces: me.workspaces })
    return me
  } catch (e) {
    if ((e as { status?: number }).status === 401) {
      writeSession(null)
      useCloud.setState({ user: null, workspaces: [] })
    }
    return null
  }
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
