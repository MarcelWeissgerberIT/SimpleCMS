/** Detached workspaces never attach a cloud document. Only an explicit comparison/merge makes a request. */
import { create } from 'zustand'
import { createStore, del, get, set } from 'idb-keyval'
import * as Y from 'yjs'
import { newId } from '../lib/ids'
import { localStorageId } from '../lib/localWorkspace'
import { getLocalFile, saveDetachedFile } from '../lib/files'
import { emptyWorkspace, getWorkspaceSnapshot, useWorkspace } from '../store/store'
import { withWriter } from '../store/writer'
import type { Workspace, Person } from '../store/types'
import { createLocalWorkspace } from '../store/localWorkspaces'
import { newDatabaseMap, newPageMap, readDatabase, readPage } from './schema'
import { CloudError, useCloud, useCloudSync } from './state'
import { request, getFileBlob, putFile } from './api'
import { switchWorkspaceImpl } from './boot'
import { CHECKOUT_DB_SKIP, checkoutFileIds, equalJson, planCheckout, prepareCheckoutIds, type CheckoutData, type CheckoutSnapshot, type ObjectJson, type Choice } from '@/shared/checkout'

interface CheckoutRecord {
  version: 1
  localId: string
  epoch: string
  origin: string
  userId: string
  source: CheckoutSnapshot
  /** Normalized local shape at the last checkpoint; metadata conversions are not user edits. */
  initial: CheckoutData
  /** Fresh local attachment ids → the immutable source ids. */
  files: Record<string, string>
}
const storage = createStore('one-checkouts', 'kv')
export const useCheckout = create<{ record: CheckoutRecord | null }>(() => ({ record: null }))
export async function loadCheckout(): Promise<void> {
  const record = await get<CheckoutRecord>(`checkout:${localStorageId}`, storage)
  useCheckout.setState({ record: record?.version === 1 && typeof record.epoch === 'string' ? record : null })
  // Reset/replace means a new workspace lifetime, never a proposal to delete the old cloud's contents.
  useWorkspace.subscribe((state, before) => {
    const current = useCheckout.getState().record
    if (current && before.epoch === current.epoch && state.epoch !== current.epoch && useCloud.getState().active.kind === 'local') {
      useCheckout.setState({ record: null })
      void del(`checkout:${current.localId}`, storage).catch(e => console.warn('[one] checkout checkpoint cleanup failed', e))
    }
  })
}
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const omit = new Set(['updatedAt', 'updatedBy', 'createdBy', 'plain'])
const rewriteFiles = <T,>(v: T, files: Record<string, string>): T => JSON.parse(JSON.stringify(v).replace(/onefile:([A-Za-z0-9_-]+)/g, (ref, id: string) => files[id] ? `onefile:${files[id]}` : ref)) as T

function project(ws: Workspace, files: Record<string, string>): CheckoutData {
  const doc = new Y.Doc()
  try {
    const pages = doc.getMap<Y.Map<unknown>>('pages')
    const dbs = doc.getMap<Y.Map<unknown>>('databases')
    for (const p of Object.values(ws.pages)) if (!p.private) pages.set(p.id, newPageMap(p, 'checkout'))
    for (const db of Object.values(ws.databases)) dbs.set(db.id, newDatabaseMap(db))
    return rewriteFiles({
      pages: Object.fromEntries([...pages.entries()].map(([id, p]) => [id, {
        meta: Object.fromEntries(Object.entries(p.toJSON()).filter(([key]) => !omit.has(key))) as ObjectJson,
        content: (ws.pages[id].content ?? { type: 'doc', content: [] }) as ObjectJson,
      }])),
      databases: Object.fromEntries(Object.entries(dbs.toJSON()).map(([id, db]) => [id, Object.fromEntries(Object.entries(db as ObjectJson).filter(([k]) => !(CHECKOUT_DB_SKIP as readonly string[]).includes(k)))])),
    }, files)
  } finally { doc.destroy() }
}

function yMap(value: ObjectJson, nested: string[]) {
  const map = new Y.Map<unknown>()
  for (const [k, v] of Object.entries(value)) map.set(k, nested.includes(k) && v && typeof v === 'object' && !Array.isArray(v) ? new Y.Map(Object.entries(v)) : v)
  return map
}

function workspaceFrom(source: CheckoutSnapshot): Workspace {
  const ws = emptyWorkspace()
  ws.epoch = newId()
  ws.settings.workspaceName = source.name
  const doc = new Y.Doc()
  try {
    const pages = doc.getMap<Y.Map<unknown>>('pages')
    const databases = doc.getMap<Y.Map<unknown>>('databases')
    for (const [id, p] of Object.entries(source.data.pages)) {
      const map = yMap(p.meta, ['properties', 'comments']); pages.set(id, map)
      ws.pages[id] = { ...readPage(id, map, undefined, false), content: p.content }
    }
    for (const [id, db] of Object.entries(source.data.databases)) {
      const map = yMap(db, ['properties', 'views', 'automations', 'templates']); databases.set(id, map)
      const database = readDatabase(id, map, undefined)
      // Nothing starts merely because a detached copy was opened.
      database.automations = database.automations?.map(a => ({ ...a, enabled: false }))
      database.templates = database.templates?.map(t => ({ ...t, repeat: null }))
      ws.databases[id] = database
    }
    ws.people = source.context.people as unknown as Person[]
    ws.functions = source.context.functions as unknown as Workspace['functions']
    ws.kit = { lists: source.context.lists, propTypes: source.context.propTypes, recordTypes: source.context.recordTypes } as unknown as Workspace['kit']
    return ws
  } finally { doc.destroy() }
}

async function flushLocal() {
  const { flushOpenEditors } = await import('../editor')
  flushOpenEditors()
  const { flushSave, getSaveStatus } = await import('../store/persistence')
  await flushSave()
  if (getSaveStatus() === 'error') throw new CloudError('checkout_save', 'Local changes could not be saved.')
}

export async function checkoutWorkspace(onProgress?: (n: number) => void): Promise<void> {
  const c = useCloud.getState()
  if (c.active.kind !== 'cloud' || c.status !== 'online' || !c.user || c.readOnly || !c.supports?.includes('checkout:1')) throw new CloudError('offline', 'Connect to an up-to-date writable team workspace first.')
  const { flushOpenEditors } = await import('../editor')
  flushOpenEditors()
  const deadline = Date.now() + 20000
  while (useCloudSync.getState().unsynced || useCloudSync.getState().pendingUploads > 0) {
    if (Date.now() > deadline || useCloud.getState().status !== 'online') throw new CloudError('checkout_pending', 'Wait until all cloud changes and files are synchronized.')
    await new Promise(r => setTimeout(r, 80))
  }
  const source = await request<CheckoutSnapshot>('GET', `api/workspaces/${c.active.id}/checkout`)
  const ws = workspaceFrom(source)
  const ids = checkoutFileIds(source.data)
  const files: Record<string, string> = {}
  const forward: Record<string, string> = {}
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]
    // Fetch under current server authorization, never reuse a similarly named file from another workspace.
    const file = await getFileBlob(c.active.id, id)
    if (!file) throw new CloudError('checkout_file', 'An attachment could not be downloaded. The checkout was not opened.')
    const ref = await saveDetachedFile(file.blob, file.name, `local:${ws.epoch}`)
    forward[id] = ref.slice(8); files[ref.slice(8)] = id
    onProgress?.((i + 1) / Math.max(1, ids.length))
  }
  const local = rewriteFiles(ws, forward)
  const initial = project(local, files)
  const localId = await createLocalWorkspace(source.name, local)
  const record: CheckoutRecord = { version: 1, localId, epoch: local.epoch!, origin: window.location.origin, userId: c.user.id, source, initial, files }
  await set(`checkout:${localId}`, record, storage)
  switchWorkspaceImpl({ kind: 'local', id: localId })
}

export interface CheckoutReview {
  snapshot: CheckoutSnapshot
  local: CheckoutData
  proposed: CheckoutData
  record: CheckoutRecord
}

function localProposal(record: CheckoutRecord, local: CheckoutData): CheckoutData {
  // Map only actual local edits back onto the source's raw shape.
  const first = planCheckout(record.initial, local, record.source.data)
  const choices = Object.fromEntries(first.changes.map(c => [c.key, 'local' as const]))
  const data = planCheckout(record.initial, local, record.source.data, choices).data
  // Automation/command configuration is never merged through a content checkout.
  for (const [id, db] of Object.entries(data.databases)) for (const key of CHECKOUT_DB_SKIP) {
    const value = record.source.data.databases[id]?.[key]
    if (value === undefined) delete db[key]; else db[key] = clone(value)
  }
  return data
}

export async function compareCheckout(): Promise<CheckoutReview> {
  const record = useCheckout.getState().record
  if (!record || record.origin !== window.location.origin || record.epoch !== useWorkspace.getState().epoch || useCloud.getState().active.kind !== 'local') throw new CloudError('invalid_request', 'No checkout is open on its original server.')
  await flushLocal()
  const { refreshMe } = await import('./boot')
  const me = await refreshMe()
  if (!me || me.user.id !== record.userId) throw new CloudError('unauthenticated', 'Sign in with the account that checked out this workspace.')
  if (!me.workspaces.some(w => w.id === record.source.workspaceId && w.role !== 'viewer')) throw new CloudError('forbidden', 'Your account no longer has write access to this workspace.')
  const local = project(getWorkspaceSnapshot(), record.files)
  const snapshot = await request<CheckoutSnapshot>('GET', `api/workspaces/${record.source.workspaceId}/checkout`)
  return { snapshot, local, proposed: prepareCheckoutIds(record.source.data, localProposal(record, local), snapshot.data), record }
}

export async function mergeCheckout(review: CheckoutReview, choices: Record<string, Choice>): Promise<void> {
  const run = () => mergeSavedCheckout(review, choices)
  if (navigator.locks) await navigator.locks.request(`one-checkout:${review.record.localId}`, run)
  else await run()
}
async function mergeSavedCheckout(review: CheckoutReview, choices: Record<string, Choice>): Promise<void> {
  const current = await get<CheckoutRecord>(`checkout:${review.record.localId}`, storage)
  if (!current || current.epoch !== useWorkspace.getState().epoch || current.localId !== review.record.localId || JSON.stringify(current) !== JSON.stringify(review.record)) throw new CloudError('checkout_stale', 'This local checkout changed. Compare again.')
  await flushLocal()
  if (JSON.stringify(project(getWorkspaceSnapshot(), current.files)) !== JSON.stringify(review.local)) throw new CloudError('checkout_stale', 'The local content changed during review. Compare again.')
  const plan = planCheckout(current.source.data, review.proposed, review.snapshot.data, choices)
  if (plan.unresolved.length) throw new CloudError('checkout_conflicts', 'Resolve every conflict first.')
  const sourceFiles = new Set(checkoutFileIds(review.snapshot.data))
  for (const id of checkoutFileIds(plan.data)) if (!sourceFiles.has(id)) {
    const localId = Object.keys(current.files).find(key => current.files[key] === id) ?? id
    const file = await getLocalFile(`onefile:${localId}`)
    const { fileWorkspace } = await import('../lib/files')
    if (!file || file.ws !== fileWorkspace()) throw new CloudError('checkout_file', 'An attachment is missing from this local workspace.')
    await putFile(current.source.workspaceId, id, file.blob, file.name)
  }
  // Cache newly arrived cloud files before committing; the refreshed local copy must remain self-contained.
  const files = { ...current.files }
  const forward = Object.fromEntries(Object.entries(files).map(([local, original]) => [original, local]))
  const epoch = useWorkspace.getState().epoch!
  for (const id of checkoutFileIds(plan.data)) if (!forward[id]) {
    const own = await getLocalFile(`onefile:${id}`)
    if (own?.ws === `local:${epoch}`) continue
    const remote = await getFileBlob(current.source.workspaceId, id)
    if (!remote) throw new CloudError('checkout_file', 'A cloud attachment could not be downloaded.')
    const ref = await saveDetachedFile(remote.blob, remote.name, `local:${epoch}`)
    forward[id] = ref.slice(8); files[ref.slice(8)] = id
  }
  await request('POST', `api/workspaces/${current.source.workspaceId}/checkout/merge`, { revisions: review.snapshot.revisions, data: plan.data })
  // First checkpoint the acknowledged result. A local storage failure must never be reported as a refused cloud merge.
  let next: CheckoutRecord = { ...current, files, source: { ...review.snapshot, data: plan.data }, initial: review.local }
  try {
    await set(`checkout:${current.localId}`, next, storage)
    useCheckout.setState({ record: next })
    const live = getWorkspaceSnapshot()
    // A different tab/agent may have written during the request. Keep those unreviewed edits, never overwrite them.
    if (!equalJson(project(live, current.files), review.local)) return
    const merged = rewriteFiles(workspaceFrom(next.source), forward)
    const contents = Object.fromEntries(Object.entries(merged.pages).map(([id, p]) => [id, p.content]))
    for (const [id, p] of Object.entries(merged.pages)) {
      p.content = live.pages[id]?.content ?? null
      p.contentRev = live.pages[id]?.contentRev ?? 0
      p.contentOrigin = live.pages[id]?.contentOrigin ?? null
      p.favorite = live.pages[id]?.favorite ?? false
    }
    withWriter({ kind: 'you', via: 'ui', ref: 'checkout' }, () => {
      useWorkspace.getState().hydrate({ ...live, pages: merged.pages, databases: merged.databases, recent: live.recent.filter(id => merged.pages[id]), people: merged.people })
      for (const [id, content] of Object.entries(contents)) if (!equalJson(content, useWorkspace.getState().pages[id]?.content)) useWorkspace.getState().setContent(id, content, 'checkout')
    })
    await flushLocal()
    next = { ...next, initial: project(getWorkspaceSnapshot(), files) }
    await set(`checkout:${current.localId}`, next, storage)
    useCheckout.setState({ record: next })
  } catch (e) {
    throw new CloudError('checkout_checkpoint', 'The cloud merge succeeded, but saving the local checkpoint failed. Open the cloud workspace to see the result.')
  }
}
