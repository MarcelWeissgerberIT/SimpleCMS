/**
 * uploadLocalWorkspace: copy this browser's local workspace into an empty team workspace — files
 * first, then every page's content document, the meta document (pages, databases, rows, comments,
 * people, custom functions) last. Until the meta document is written the team workspace still looks empty, so an
 * interrupted upload can simply be started again (content documents are diffed, not duplicated).
 */
import * as Y from 'yjs'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { prosemirrorJSONToYXmlFragment } from '@tiptap/y-tiptap'
import type { JSONContent } from '@tiptap/core'
import { getWorkspaceSnapshot } from '../store/store'
import { flushSave, migrate, readStoredWorkspace } from '../store/persistence'
import type { ID, Workspace } from '../store/types'
import { FILE_PREFIX, getLocalFile } from '../lib/files'
import { newId } from '../lib/ids'
import { docSchema, prepareCollabContent } from '../editor'
import { putFile } from './api'
import { refreshMe } from './boot'
import { PAGE_ID, WS_ID, within } from './env'
import { loadOverlay, saveContentCache, saveOverlay } from './local'
import { newDatabaseMap, newPageMap, roots } from './schema'
import { collabUrl, getSocket } from './socket'
import { CloudError, useCloud, useCloudSync } from './state'

const UPLOAD_ORIGIN = 'upload'
const FILE_ID = /^[A-Za-z0-9_-]{1,64}$/
const REF_RE = /onefile:([A-Za-z0-9_-]+)/g

/** Page / database ids the server can't name a document after get fresh ids (references follow). */
function remapUnsafeIds(ws: Workspace): void {
  const map = new Map<string, string>()
  for (const id of [...Object.keys(ws.pages), ...Object.keys(ws.databases)]) if (!PAGE_ID.test(id) && !map.has(id)) map.set(id, newId())
  if (!map.size) return
  const fix = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (map.has(v)) return map.get(v)
      return v.includes('#/p/') ? v.replace(/#\/p\/([^?&#/\s]+)/g, (all, id: string) => (map.has(id) ? `#/p/${map.get(id)}` : all)) : v
    }
    if (Array.isArray(v)) return v.map(fix)
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v)) out[map.get(k) ?? k] = fix(x)
      return out
    }
    return v
  }
  ws.pages = fix(ws.pages) as Workspace['pages']
  ws.databases = fix(ws.databases) as Workspace['databases']
  ws.recent = ws.recent.map((id) => map.get(id) ?? id)
  ws.settings = { ...ws.settings, startPageId: ws.settings.startPageId ? (map.get(ws.settings.startPageId) ?? ws.settings.startPageId) : null }
}

function openDoc(socket: HocuspocusProviderWebsocket, name: string) {
  const doc = new Y.Doc()
  const provider = new HocuspocusProvider({ websocketProvider: socket, name, document: doc, awareness: null })
  const auth = new Promise<string>((resolve, reject) => {
    provider.on('authenticated', ({ scope }: { scope: string }) => resolve(scope))
    provider.on('authenticationFailed', ({ reason }: { reason: string }) => reject(new CloudError(reason === 'unauthenticated' ? 'unauthenticated' : 'forbidden', `The server refused the document (${reason}).`, 403)))
  })
  auth.catch(() => {})
  const synced = new Promise<void>((resolve) => provider.on('synced', () => resolve()))
  provider.attach()
  return {
    doc,
    provider,
    async ready(): Promise<void> {
      const scope = await within(auth, 20_000, 'timeout')
      if (scope === 'timeout') throw new CloudError('network', 'The server did not answer in time.')
      if (scope !== 'read-write') throw new CloudError('forbidden', 'Viewers cannot upload into this workspace.', 403)
      if ((await within(synced.then(() => true), 20_000, false)) === false) throw new CloudError('network', 'The server did not answer in time.')
    },
    async flushed(timeoutMs = 60_000): Promise<void> {
      const t0 = Date.now()
      while (provider.hasUnsyncedChanges || !provider.isSynced) {
        if (Date.now() - t0 > timeoutMs) throw new CloudError('network', 'The server did not confirm the upload in time.')
        await new Promise((r) => setTimeout(r, 50))
      }
    },
    destroy() {
      provider.destroy()
      doc.destroy()
    },
  }
}

export async function uploadLocalWorkspaceImpl(wsId: string, onProgress?: (p: number) => void): Promise<void> {
  if (!WS_ID.test(wsId)) throw new CloudError('invalid_request', 'Not a workspace id.', 400)
  // in the local workspace the account may not be looked up yet
  if (!useCloud.getState().user) await refreshMe()
  const c = useCloud.getState()
  if (!c.user) throw new CloudError('unauthenticated', 'Sign in first.', 401)
  const target = c.workspaces.find((w) => w.id === wsId)
  if (target && target.role === 'viewer') throw new CloudError('forbidden', 'Viewers cannot upload into this workspace.', 403)
  const progress = (p: number) => onProgress?.(Math.max(0, Math.min(1, p)))
  progress(0)

  // 1. this browser's local workspace (the live store when it is the open one)
  let local: Workspace
  if (c.active.kind === 'local') {
    await flushSave()
    local = JSON.parse(JSON.stringify(getWorkspaceSnapshot())) as Workspace
  } else {
    const raw = await readStoredWorkspace()
    if (!raw) throw new CloudError('nothing_to_upload', 'This browser has no local workspace.')
    local = migrate(raw)
  }
  remapUnsafeIds(local)
  const pages = Object.values(local.pages)
  const userId = c.user.id

  const ownSocket = c.active.kind === 'local'
  const socket = ownSocket ? new HocuspocusProviderWebsocket({ url: collabUrl() }) : getSocket()
  const meta = openDoc(socket, `ws:${wsId}`)
  const opened: Array<ReturnType<typeof openDoc>> = [meta]
  try {
    await meta.ready()
    if (roots(meta.doc).pages.size > 0) throw new CloudError('workspace_not_empty', 'This team workspace already has pages.', 409)

    // 2. files (30 %)
    const json = JSON.stringify({ pages: local.pages, databases: local.databases })
    const fileIds = [...new Set([...json.matchAll(REF_RE)].map((m) => m[1]))].filter((id) => FILE_ID.test(id))
    const max = useCloudSync.getState().maxUploadMb
    let done = 0
    for (const id of fileIds) {
      const file = await getLocalFile(FILE_PREFIX + id).catch(() => undefined)
      if (file && !(max && file.size > max * 1024 * 1024)) {
        try {
          await putFile(wsId, id, file.blob, file.name)
        } catch (e) {
          if (!(e instanceof CloudError) || e.status !== 413) throw e
          useCloudSync.setState((s) => ({ failedUploads: [...s.failedUploads, { id, name: file.name, code: e.code }].slice(-20) }))
        }
      } else if (file) {
        useCloudSync.setState((s) => ({ failedUploads: [...s.failedUploads, { id, name: file.name, code: 'file_too_large' }].slice(-20) }))
      }
      done++
      progress(0.3 * (done / Math.max(1, fileIds.length)))
    }
    progress(0.3)

    // 3. page content documents (55 %), a few at a time
    const withContent = pages.filter((p) => p.content && p.content.content?.length)
    const schema = docSchema()
    const prepared = new Map<ID, JSONContent>()
    let next = 0
    let written = 0
    const worker = async () => {
      while (next < withContent.length) {
        const page = withContent[next++]
        const content = prepareCollabContent(page.content!, true)
        prepared.set(page.id, content)
        const d = openDoc(socket, `ws:${wsId}:p:${page.id}`)
        try {
          await d.ready()
          d.doc.transact(() => prosemirrorJSONToYXmlFragment(schema, content, d.doc.getXmlFragment('default')), UPLOAD_ORIGIN)
          await d.flushed()
        } finally {
          d.destroy()
        }
        written++
        progress(0.3 + 0.55 * (written / withContent.length))
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, withContent.length) }, worker))
    progress(0.85)

    // 4. the meta document, in one transaction
    const r = roots(meta.doc)
    meta.doc.transact(() => {
      for (const p of pages) r.pages.set(p.id, newPageMap({ ...p, content: prepared.get(p.id) ?? p.content }, userId))
      for (const db of Object.values(local.databases)) r.databases.set(db.id, newDatabaseMap(db))
      for (const person of local.people) if (person?.id) r.people.set(person.id, { id: person.id, name: person.name, color: person.color })
      // custom functions: one JSON entry each, as the binding writes them (every reader sanitizes them)
      for (const fn of Object.values(local.functions ?? {})) r.functions.set(fn.id, JSON.parse(JSON.stringify(fn)))
      // scripts (features/script): the same; the uploader becomes their author
      const scripts = meta.doc.getMap<unknown>('scripts')
      for (const sc of Object.values(local.scripts ?? {})) scripts.set(sc.id, { ...JSON.parse(JSON.stringify(sc)), createdBy: userId, updatedBy: userId })
      if (r.workspace.get('name') === undefined) {
        r.workspace.set('name', target?.name ?? local.settings.workspaceName)
        r.workspace.set('icon', target?.icon ?? null)
        r.workspace.set('createdAt', Date.now())
      }
    }, UPLOAD_ORIGIN)
    await meta.flushed(120_000)

    // this device already knows the content: no download on the first visit, favourites kept
    for (const p of pages) {
      const content = prepared.get(p.id) ?? p.content
      if (content) saveContentCache(wsId, p.id, { json: content, at: p.updatedAt })
    }
    if (!(await loadOverlay(wsId))) {
      await saveOverlay(wsId, {
        settings: { ...local.settings, lastPageId: null },
        favorites: pages.filter((p) => p.favorite).map((p) => p.id),
        recent: local.recent,
        pending: [],
      }).catch(() => {})
    }
    progress(1)
  } finally {
    for (const d of opened) d.destroy()
    if (ownSocket) socket.destroy()
  }
}
