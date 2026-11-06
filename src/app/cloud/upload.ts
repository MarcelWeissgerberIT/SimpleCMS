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
import { sanitizeLook } from '../store/look'
import { sanitizeIntegrations } from '../store/integrations'
import { sanitizeFuseSignoffs } from '../store/fuseSignoffs'
import { readWorkspaceAI } from '../store/ai'
import { isReadableGovernor, sanitizeGovernor, stampGen } from '@/shared/ai/governor'
import { STAMP_KNOWN } from '../store/governor'
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
  const deviceSettings = local.settings
  const { portableWorkspace } = await import('../features')
  local = portableWorkspace(local, local.settings.workspaceName)
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
      // Saved agent definitions travel too, paused and without this device's grants or connections.
      const agents = meta.doc.getMap<unknown>('agents')
      for (const agent of Object.values(local.agents ?? {})) agents.set(agent.id, { ...JSON.parse(JSON.stringify(agent)), enabled: false, createdBy: userId, updatedBy: userId })
      // scripts (features/script): the same; the uploader becomes their author
      const scripts = meta.doc.getMap<unknown>('scripts')
      for (const sc of Object.values(local.scripts ?? {})) scripts.set(sc.id, { ...JSON.parse(JSON.stringify(sc)), createdBy: userId, updatedBy: userId })
      // integration profiles: the same (the uploader saves them — the server checks they may)
      const integrations = meta.doc.getMap<unknown>('integrations')
      for (const p of sanitizeIntegrations(local.integrations).integrations) integrations.set(p.id, { ...JSON.parse(JSON.stringify(p)), updatedBy: userId })
      // building blocks (features/kit): the same, one meta map per part
      for (const part of ['lists', 'propTypes', 'recordTypes'] as const) {
        const map = meta.doc.getMap<unknown>(part)
        for (const entry of Object.values(local.kit?.[part] ?? {})) map.set(entry.id, { ...JSON.parse(JSON.stringify(entry)), createdBy: userId, updatedBy: userId })
      }
      if (r.workspace.get('name') === undefined) {
        r.workspace.set('name', target?.name ?? local.settings.workspaceName)
        r.workspace.set('icon', target?.icon ?? null)
        r.workspace.set('createdAt', Date.now())
      }
      // the workspace look (sanitized again; the uploader saves it — the server checks they may)
      const look = sanitizeLook(local.look)
      if (look && r.workspace.get('look') === undefined) r.workspace.set('look', { ...JSON.parse(JSON.stringify(look)), updatedBy: userId })
      // the workspace's AI rules (sanitized again; only on a server that guards them — the uploader saves them). Claude's
      // entry waits for a server whose agents read it (D-S2-30); member classes stay on the device (settings.ai)
      const supports = useCloud.getState().supports ?? []
      // the Patchbay's allowed paths (sanitized again; only on a server that guards them — `supports ∋ 'signoffs'`): the
      // uploader allowed them, the server checks they may and stamps who
      if (supports.includes('signoffs')) {
        const signoffs = meta.doc.getMap<unknown>('fuseSignoffs')
        for (const [key, entry] of Object.entries(sanitizeFuseSignoffs(local.fuseSignoffs))) if (!signoffs.has(key)) signoffs.set(key, { ...JSON.parse(JSON.stringify(entry)), updatedBy: userId })
      }
      const ai = supports.includes('ai') ? readWorkspaceAI(local.ai) : undefined
      // the Regler (sanitized again; only on a server that guards it and the AI rules — its generation stamp travels in
      // `ai`): a value this build can read, never the marker or a newer shape it holds no say over
      const governor = supports.includes('ai') && supports.includes('governor') ? sanitizeGovernor(local.governor) : undefined
      const takeGovernor = isReadableGovernor(governor) && r.workspace.get('governor') === undefined ? governor : undefined
      if (takeGovernor) r.workspace.set('governor', { ...JSON.parse(JSON.stringify(takeGovernor)), updatedBy: userId })
      if ((ai || takeGovernor) && r.workspace.get('ai') === undefined) {
        const providers = { ...(ai?.policy?.providers ?? {}) }
        if (!supports.includes('providers')) delete providers.anthropic
        const policy = ai?.policy ? { ...ai.policy, providers } : undefined
        const { gen: _gen, ...rest } = ai ?? {}
        const rules = { ...rest, ...(policy ? { policy } : {}) }
        // ONE stamp (shared/ai/governor.ts): what the rules need and what the governor carried along needs — a newer
        // build's stamp (above what this build can compute) stays as it is
        const kept = (ai?.gen ?? 1) > STAMP_KNOWN ? (ai?.gen ?? 1) : 1
        const g = Math.max(kept, stampGen(rules, takeGovernor, ai?.gen))
        if (Object.keys(rules).length || g > 1) r.workspace.set('ai', { ...JSON.parse(JSON.stringify(rules)), ...(g > 1 ? { gen: g } : {}), updatedBy: userId })
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
        settings: { ...deviceSettings, lastPageId: null, startPageId: local.settings.startPageId },
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
