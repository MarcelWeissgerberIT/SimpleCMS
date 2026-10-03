/**
 * An open cloud workspace: the meta document (y-indexeddb copy first, then Hocuspocus), the store
 * hydrated from it, the binding, page content documents, presence, files, this device's overlay
 * (settings, favourites, recent) and the connection status / close reasons.
 */
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { IndexeddbPersistence } from 'y-indexeddb'
import { get as idbGet } from 'idb-keyval'
import { useWorkspace, defaultSettings, WORKSPACE_VERSION } from '../store/store'
import { migrate } from '../store/persistence'
import type { ID, Person, Settings } from '../store/types'
import { parseHash } from '../lib/router'
import { getMe, getMembers, onUnauthenticated, patchMe, patchWorkspace } from './api'
import { readAll, startBinding, structuralRepairs, type Binding } from './binding'
import { bridgeContent, contentHasUnsynced, detachAll, reauthenticate, enqueueSync, forget, onRemotePages, reattachAll, revertContent, staleAtBoot, startContent, type ContentContext } from './content'
import { displayName, toneCss, userTone, within, writeSession } from './env'
import { kickUploads, startFiles } from './files'
import { loadContentCache, loadOverlay, saveOverlay, type Overlay } from './local'
import { LOCAL, roots } from './schema'
import { closeSocket, getSocket, isConnected, onConnection, reconnectSocket } from './socket'
import { useCloud, useCloudSync, type CloudUser, type CloudWorkspace, type Peer, type Role } from './state'

export interface ActiveCloud {
  ws: CloudWorkspace
  user: CloudUser
  doc: Y.Doc
  provider: HocuspocusProvider
  binding: Binding
  writable: () => boolean
}

let active: ActiveCloud | null = null
/** Signed out / removed: nothing syncs any more (the local copy stays readable). */
let stopped = false

export function activeCloud(): ActiveCloud | null {
  return active
}

const canWrite = (role: Role | null) => role === 'owner' || role === 'admin' || role === 'member'

function writable(): boolean {
  const c = useCloud.getState()
  return !stopped && !c.readOnly && canWrite(c.role)
}

function setStatus(status: 'connecting' | 'online' | 'offline') {
  if (stopped) return
  if (useCloud.getState().status !== status) useCloud.setState({ status })
}

/** Settings a new cloud workspace starts with on this device: the local workspace's (theme, language, AI key …). */
async function localSettings(): Promise<Partial<Settings>> {
  try {
    const raw = await idbGet('one.workspace.v1')
    if (!raw) return {}
    const s = migrate(raw).settings
    return { ...s, startPageId: null, lastPageId: null }
  } catch {
    return {}
  }
}

export async function emptySettings(): Promise<Settings> {
  return { ...defaultSettings(), ...(await localSettings()) }
}

/* ------------------------------------------------------------------ open */

export async function openCloudWorkspace(ws: CloudWorkspace, user: CloudUser, online: boolean): Promise<void> {
  stopped = false
  const overlayP = loadOverlay(ws.id)
  const cacheP = loadContentCache(ws.id)
  const doc = new Y.Doc()
  const idb = new IndexeddbPersistence(`one:ws:${ws.id}`, doc)
  await idb.whenSynced

  const socket = getSocket()
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: `ws:${ws.id}`, document: doc })
  let firstSynced = false
  let resolveFirst!: () => void
  const firstSync = new Promise<void>((r) => (resolveFirst = r))
  provider.on('synced', () => {
    firstSynced = true
    resolveFirst()
    setStatus('online')
  })
  provider.attach()

  // a device that has never seen this workspace waits (briefly) for the server's copy
  if (online && roots(doc).pages.size === 0) await within(firstSync, 8000, undefined)

  const overlay: Overlay = (await overlayP) ?? { settings: null, favorites: [], recent: [], pending: [] }
  const cache = await cacheP
  const baseSettings = overlay.settings ? { ...defaultSettings(), ...overlay.settings } : await emptySettings()
  // no await from here to the binding: every remote change after this read reaches the store
  const favorites = new Set(overlay.favorites)
  const data = readAll(doc, (id) => favorites.has(id))
  for (const [id, c] of cache) {
    const p = data.pages[id]
    if (p && c.json) p.content = c.json
  }
  const settings: Settings = { ...baseSettings, workspaceName: data.name ?? ws.name, userName: displayName(user) }
  useWorkspace.getState().hydrate({
    version: WORKSPACE_VERSION,
    epoch: `cloud:${ws.id}`,
    pages: data.pages,
    databases: data.databases,
    people: data.people ?? [],
    settings,
    recent: overlay.recent.filter((id) => !!data.pages[id]),
  })

  // From here on the store shows the cloud workspace: a failing service must not throw (the
  // caller would fall back to the local workspace while the binding is already live).
  try {
    /* ---------------- overlay (this device) */

    const pending = new Set<ID>(overlay.pending)
    let overlayTimer: number | undefined
    const saveOverlayNow = () => {
      window.clearTimeout(overlayTimer)
      overlayTimer = undefined
      const s = useWorkspace.getState()
      const favs: ID[] = []
      for (const p of Object.values(s.pages)) if (p.favorite) favs.push(p.id)
      void saveOverlay(ws.id, { settings: s.settings, favorites: favs, recent: s.recent, pending: [...pending] }).catch(() => {})
    }
    const scheduleOverlay = () => {
      window.clearTimeout(overlayTimer)
      overlayTimer = window.setTimeout(saveOverlayNow, 400)
    }
    useWorkspace.subscribe((s, prev) => {
      if (s.settings !== prev.settings || s.recent !== prev.recent || s.pages !== prev.pages) scheduleOverlay()
    })
    window.addEventListener('pagehide', () => overlayTimer !== undefined && saveOverlayNow())

    /* ---------------- presence */

    const tone = userTone(user.id)
    const me = () => {
      const u = useCloud.getState().user ?? user
      return { id: u.id, name: displayName(u), color: toneCss(tone), tone }
    }
    const awareness = provider.awareness
    const currentPage = (): string | null => {
      const r = parseHash(window.location.hash)
      return r.name === 'page' ? r.id : null
    }
    awareness?.setLocalState({ user: me(), pageId: currentPage() })
    const updatePeers = () => {
      if (!awareness) return
      const peers: Peer[] = []
      awareness.getStates().forEach((st, clientId) => {
        if (clientId === doc.clientID) return
        const u = (st as { user?: { id?: unknown; name?: unknown; tone?: unknown } }).user
        if (!u || typeof u.id !== 'string') return
        const t = typeof u.tone === 'string' && /^[a-z]+$/.test(u.tone) ? u.tone : userTone(u.id)
        const pageId = (st as { pageId?: unknown }).pageId
        peers.push({ clientId, userId: u.id, name: typeof u.name === 'string' ? u.name.slice(0, 80) : '', color: `var(--c-${t}-text)`, pageId: typeof pageId === 'string' ? pageId : null })
      })
      peers.sort((a, b) => a.name.localeCompare(b.name) || a.clientId - b.clientId)
      useCloud.setState({ peers })
    }
    awareness?.on('change', updatePeers)
    window.addEventListener('hashchange', () => setPresencePageImpl(currentPage()))

    /* ---------------- content documents */

    const unsynced = () => {
      const any = provider.hasUnsyncedChanges || contentHasUnsynced()
      useCloudSync.setState((s) => (s.unsynced === any ? s : { ...s, unsynced: any }))
    }
    const contentCtx: ContentContext = {
      wsId: ws.id,
      writable,
      user: me,
      onClose: (reason) => handleClose(reason),
      onUnsynced: unsynced,
      pending,
      savePending: scheduleOverlay,
      cache,
    }
    startContent(contentCtx)

    /* ---------------- binding */

    let repairTimer: number | undefined
    const scheduleRepairs = () => {
      window.clearTimeout(repairTimer)
      repairTimer = window.setTimeout(() => {
        if (!writable() || !firstSynced) return
        const s = useWorkspace.getState()
        for (const { id, patch } of structuralRepairs(s.pages, s.databases)) useWorkspace.getState().updatePage(id, patch)
      }, 1500)
    }

    let renameTimer: number | undefined
    let profileTimer: number | undefined
    const binding = startBinding({
      doc,
      userId: () => user.id,
      writable,
      isFavorite: (id) => favorites.has(id),
      onRemotePages: (r) => {
        onRemotePages(r)
        scheduleRepairs()
      },
      bridge: bridgeContent,
      onLocalRemoved: (ids) => ids.forEach(forget),
      revertContent,
      onSettings: (next, prev) => {
        // the workspace name is the team's (admins), the user name is the account's
        if (next.workspaceName !== prev.workspaceName && next.workspaceName.trim()) {
          const role = useCloud.getState().role
          if (role === 'owner' || role === 'admin') {
            window.clearTimeout(renameTimer)
            renameTimer = window.setTimeout(() => void renameActive(next.workspaceName.trim()).catch((e) => console.warn('[one] rename failed', e)), 800)
          }
        }
        if (next.userName !== prev.userName && next.userName.trim()) {
          window.clearTimeout(profileTimer)
          profileTimer = window.setTimeout(() => {
            const name = next.userName.trim()
            const u = useCloud.getState().user
            if (u && displayName(u) !== name) void updateProfileImpl(name).catch((e) => console.warn('[one] profile update failed', e))
          }, 800)
        }
      },
    })

    active = { ws, user, doc, provider, binding, writable }

    /* ---------------- status & close reasons */

    provider.on('unsyncedChanges', unsynced)
    provider.on('authenticated', ({ scope }: { scope: string }) => {
      const ro = scope === 'readonly'
      if (useCloud.getState().readOnly !== ro && !stopped) useCloud.setState({ readOnly: ro })
    })
    provider.on('authenticationFailed', ({ reason }: { reason: string }) => handleClose(reason === 'unauthenticated' ? 'session-ended' : reason === 'forbidden' ? 'membership-revoked' : reason))
    provider.on('close', ({ event }: { event: { reason?: string } }) => {
      if (event?.reason) handleClose(event.reason)
    })

    let lastCheck = 0
    let checkTimer: number | undefined
    onConnection((up) => {
      if (up) {
        window.clearTimeout(checkTimer)
        kickUploads()
        return
      }
      setStatus(firstSynced ? 'offline' : navigator.onLine === false ? 'offline' : 'connecting')
      // a socket that can't get in while the network is fine: maybe the session ended
      window.clearTimeout(checkTimer)
      checkTimer = window.setTimeout(() => {
        if (isConnected() || stopped || navigator.onLine === false || Date.now() - lastCheck < 30_000) return
        lastCheck = Date.now()
        getMe().catch(() => {}) // a 401 reaches onUnauthenticated
      }, 6000)
    })
    onUnauthenticated(() => {
      if (active) handleClose('session-ended')
    })
    if (!isConnected()) setStatus(online ? 'connecting' : 'offline')
    if (firstSynced) setStatus('online')

    /* ---------------- after the first sync */

    void firstSync.then(async () => {
      if (stopped || !writable()) return
      const r = roots(doc)
      if (r.workspace.get('name') === undefined) {
        doc.transact(() => {
          r.workspace.set('name', ws.name)
          r.workspace.set('icon', ws.icon ?? null)
          r.workspace.set('createdAt', Date.now())
        }, LOCAL)
      }
      await mirrorMembers(ws.id, user)
      scheduleRepairs()
    })

    // files: uploads + downloads
    void startFiles(ws.id, writable)

    // page content: whatever this device doesn't have fresh, in the background
    enqueueSync(staleAtBoot(useWorkspace.getState().pages, contentCtx))
  } catch (e) {
    console.error('[one] a cloud workspace service failed to start', e)
    if (!stopped) useCloud.setState({ status: 'error', error: 'internal' })
  }
}

/** Members are mirrored as workspace people (person properties, mentions). */
async function mirrorMembers(wsId: string, user: CloudUser): Promise<void> {
  const members = await getMembers(wsId).catch(() => null)
  const list = members?.map((m) => m.user) ?? [user]
  const s = useWorkspace.getState()
  const people: Person[] = [...s.people]
  let changed = false
  for (const u of list) {
    const name = displayName(u)
    const i = people.findIndex((p) => p.id === u.id)
    if (i < 0) {
      people.push({ id: u.id, name, color: userTone(u.id) })
      changed = true
    } else if (people[i].name !== name) {
      people[i] = { ...people[i], name }
      changed = true
    }
  }
  // a store change like any other: the binding writes it into the meta document
  if (changed && writable()) s.cloudPatch({ people })
}

/* ------------------------------------------------------------------ close reasons */

let roleTimer: number | undefined

function handleClose(reason: string): void {
  if (!active || stopped) return
  switch (reason) {
    case 'role-changed':
      window.clearTimeout(roleTimer)
      roleTimer = window.setTimeout(() => void refreshRole(), 250)
      return
    case 'membership-revoked':
    case 'forbidden':
      stop('error', 'membership-revoked')
      return
    case 'workspace-deleted':
      stop('error', 'workspace-deleted')
      return
    case 'session-ended':
    case 'unauthenticated':
      stop('signed-out', 'session-ended')
      return
    case 'invalid-document':
      console.error('[one] the server refused a document name')
      return
    default:
    // a plain disconnect: the socket reconnects by itself
  }
}

/** The role changed on the server: fetch it and let every document authenticate again. */
async function refreshRole(): Promise<void> {
  const a = active
  if (!a) return
  try {
    const me = await getMe()
    writeSession({ ...me, at: Date.now() })
    const ws = me.workspaces.find((w) => w.id === a.ws.id)
    if (!ws) {
      useCloud.setState({ workspaces: me.workspaces })
      stop('error', 'membership-revoked')
      return
    }
    useCloud.setState({ user: me.user, workspaces: me.workspaces, role: ws.role, readOnly: ws.role === 'viewer' })
  } catch {
    /* offline: the reconnect authenticates with whatever the server says */
  }
  reauthenticate(a.provider)
  reattachAll()
  // a viewer's view of the data is whatever Y says
  if (!writable()) a.binding.resync()
}

function stop(status: 'error' | 'signed-out', error: string): void {
  const a = active
  if (!a || stopped) return
  stopped = true
  try {
    a.provider.detach()
  } catch {
    /* gone */
  }
  detachAll()
  closeSocket()
  useCloud.setState({
    status,
    error,
    readOnly: true,
    peers: [],
    ...(status === 'signed-out' ? { user: null, workspaces: [] } : {}),
  })
  if (status === 'signed-out') writeSession(null)
}

/* ------------------------------------------------------------------ actions used by the public API */

export function setPresencePageImpl(pageId: string | null): void {
  const aw = active?.provider.awareness
  if (!aw || stopped) return
  const cur = (aw.getLocalState() as { pageId?: unknown } | null)?.pageId ?? null
  if (cur !== pageId) aw.setLocalStateField('pageId', pageId)
}

/** Rename the active workspace: the server's record (lists, invites) and the meta document. */
export async function renameActive(name: string): Promise<void> {
  const a = active
  if (!a) return
  const ws = await patchWorkspace(a.ws.id, { name })
  setNameEverywhere(a.ws.id, ws.name)
}

export function setNameEverywhere(wsId: string, name: string): void {
  useCloud.setState((s) => ({ workspaces: s.workspaces.map((w) => (w.id === wsId ? { ...w, name } : w)) }))
  const a = active
  if (!a || a.ws.id !== wsId || stopped) return
  if (writable()) {
    const r = roots(a.doc)
    if (r.workspace.get('name') !== name) a.doc.transact(() => r.workspace.set('name', name), LOCAL)
  }
  const s = useWorkspace.getState()
  if (s.settings.workspaceName !== name) s.updateSettings({ workspaceName: name })
}

export async function updateProfileImpl(name: string): Promise<CloudUser> {
  const user = await patchMe(name)
  useCloud.setState({ user })
  const a = active
  if (a) {
    a.user = user
    const aw = a.provider.awareness
    const cur = aw?.getLocalState() as { user?: Record<string, unknown> } | null
    if (aw && cur?.user) aw.setLocalStateField('user', { ...cur.user, name: displayName(user) })
    const s = useWorkspace.getState()
    if (s.settings.userName !== displayName(user)) s.updateSettings({ userName: displayName(user) })
    void mirrorMembers(a.ws.id, user)
  }
  return user
}

/** Re-authenticate everything (e.g. after accepting an invite into the active workspace). */
export function reconnectAll(): void {
  reconnectSocket()
}
