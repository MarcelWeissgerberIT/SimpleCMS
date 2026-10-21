/** Explicit content checkout, preview snapshots and guarded merge. Session and current membership required. */
import { Hono } from 'hono'
import { z } from 'zod'
import * as Y from 'yjs'
import type { AppEnv, Services } from '../context.ts'
import { access } from './access.ts'
import { body, idSchema } from '../http/util.ts'
import { badRequest, conflict, forbidden } from '../errors.ts'
import { docJson, docStateHash } from '../mcp/pageRead.ts'
import { fragmentText } from '../api/content.ts'
import { keyText } from '../api/keys.ts'
import { CHECKOUT_DB_SKIP, equalJson, isObject, type CheckoutSnapshot, type CheckoutData, type Json, type ObjectJson } from '../../../src/shared/checkout.ts'

const OMIT = new Set(['updatedAt', 'updatedBy', 'createdBy', 'plain'])
const pageKeys = new Set(['kind', 'title', 'icon', 'cover', 'parentId', 'databaseId', 'order', 'trashed', 'trashedAt', 'createdAt', 'settings', 'hidden', 'template', 'recordType', 'properties', 'comments'])
const metaName = (id: string) => `ws:${id}`
const pageName = (id: string, page: string) => `${metaName(id)}:p:${page}`
const rawPage = (v: Y.Map<unknown>) => Object.fromEntries(Object.entries(v.toJSON()).filter(([k]) => !OMIT.has(k))) as ObjectJson
const pageIds = (d: Y.Doc) => [...d.getMap('pages').keys()].sort()
const rawDatabase = (v: Y.Map<unknown>) => Object.fromEntries(Object.entries(v.toJSON()).filter(([k]) => !(CHECKOUT_DB_SKIP as readonly string[]).includes(k))) as ObjectJson

const jsonObject = z.record(z.string(), z.json())
const input = z.strictObject({
  revisions: z.record(z.string().max(180), z.string().regex(/^[a-f0-9]{64}$/)),
  data: z.strictObject({
    pages: z.record(idSchema, z.strictObject({ meta: jsonObject, content: jsonObject })),
    databases: z.record(idSchema, jsonObject),
  }),
})

function writeMap(target: Y.Map<unknown>, next: ObjectJson, nested: Set<string>, keep: readonly string[] = []) {
  for (const key of target.keys()) if (!Object.hasOwn(next, key) && !OMIT.has(key) && !keep.includes(key)) target.delete(key)
  for (const [key, value] of Object.entries(next)) {
    const current = target.get(key)
    if (equalJson(current instanceof Y.Map ? current.toJSON() : current, value)) continue
    if (nested.has(key) && isObject(value)) {
      const map: Y.Map<unknown> = current instanceof Y.Map ? current as Y.Map<unknown> : new Y.Map<unknown>()
      if (!(current instanceof Y.Map)) target.set(key, map)
      for (const k of map.keys()) if (!Object.hasOwn(value, k)) map.delete(k)
      for (const [k, v] of Object.entries(value)) if (!equalJson(map.get(k), v)) map.set(k, v)
    } else target.set(key, value)
  }
}

/** All editor node kinds and marks survive, including tables, spreadsheets and attachment nodes. */
function xmlNodes(node: ObjectJson): Array<Y.XmlElement | Y.XmlText> {
  const children = Array.isArray(node.content) ? node.content.filter(isObject) : []
  const out: Array<Y.XmlElement | Y.XmlText> = []
  let delta: Array<{ insert: string; attributes: Record<string, unknown> }> = []
  const flush = () => { if (delta.length) { const text = new Y.XmlText(); text.applyDelta(delta); out.push(text); delta = [] } }
  for (const child of children) {
    if (child.type === 'text') {
      const marks: Record<string, unknown> = Object.create(null)
      for (const mark of Array.isArray(child.marks) ? child.marks.filter(isObject) : []) if (typeof mark.type === 'string') marks[mark.type] = mark.attrs ?? {}
      delta.push({ insert: String(child.text ?? ''), attributes: marks })
    } else if (typeof child.type === 'string') {
      flush()
      const el = new Y.XmlElement(child.type)
      if (isObject(child.attrs)) for (const [k, v] of Object.entries(child.attrs)) el.setAttribute(k, v as string)
      el.insert(0, xmlNodes(child))
      out.push(el)
    }
  }
  flush()
  return out
}

function validateData(data: CheckoutData) {
  if (Object.keys(data.pages).length > 5000) throw badRequest('checkout_too_large', 'A checkout supports up to 5,000 pages.')
  for (const [id, p] of Object.entries(data.pages)) {
    if (Object.keys(p.meta).some(k => !pageKeys.has(k)) || !['page', 'database'].includes(String(p.meta.kind)) || typeof p.meta.title !== 'string' || p.meta.title.length > 10000 || p.content.type !== 'doc') throw badRequest('invalid_request', `Invalid checkout page: ${id}`)
    const seen = new Set([id])
    let parent = p.meta.parentId
    while (typeof parent === 'string') {
      if (seen.has(parent) || !Object.hasOwn(data.pages, parent)) throw badRequest('checkout_structure', `A parent is missing or cyclic: ${id}`)
      seen.add(parent)
      parent = data.pages[parent]!.meta.parentId
    }
    const db = p.meta.databaseId
    if (typeof db === 'string' && !Object.hasOwn(data.databases, db)) throw badRequest('checkout_structure', `A database is missing: ${id}`)
  }
  for (const [id, db] of Object.entries(data.databases)) {
    if (data.pages[id]?.meta.kind !== 'database') throw badRequest('checkout_structure', `A database page is missing: ${id}`)
    if (CHECKOUT_DB_SKIP.some(k => Object.hasOwn(db, k))) throw badRequest('invalid_request', 'Automation and command configuration cannot be merged through a checkout.')
    const definitions = isObject(db.properties) ? Object.values(db.properties).filter(isObject) : []
    for (const property of definitions.filter(p => p.key === true && ['text', 'number', 'url'].includes(String(p.type)))) {
      const seen = new Set<string>()
      for (const row of Object.values(data.pages).filter(p => p.meta.databaseId === id && p.meta.trashed !== true)) {
        const props = isObject(row.meta.properties) ? row.meta.properties : {}
        const value = keyText(String(property.type), props[String(property.id)])
        if (value && seen.has(value)) throw conflict('checkout_duplicate_key', 'The combined rows would duplicate a database key. Resolve the values locally and compare again.')
        if (value) seen.add(value)
      }
    }
  }
  const inspect = (v: unknown, depth: number) => {
    if (depth > 80) throw badRequest('invalid_request', 'Checkout content is nested too deeply.')
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
      if (['__proto__', 'prototype', 'constructor'].includes(k)) throw badRequest('invalid_request', 'Invalid checkout key.')
      inspect(x, depth + 1)
    }
  }
  inspect(data, 0)
}

export function checkoutRoutes(s: Services) {
  const app = new Hono<AppEnv>()
  app.get('/:id/checkout', async c => {
    const { workspace } = access(s, c, 'viewer')
    const id = workspace.id
    for (let attempt = 0; attempt < 3; attempt++) {
      const meta = await s.collab.read(metaName(id), d => ({
        rev: docStateHash(d),
        pages: Object.fromEntries([...d.getMap('pages').entries()].filter((entry): entry is [string, Y.Map<unknown>] => entry[1] instanceof Y.Map).map(([key, value]) => [key, rawPage(value)])),
        databases: Object.fromEntries([...d.getMap('databases').entries()].filter((entry): entry is [string, Y.Map<unknown>] => entry[1] instanceof Y.Map).map(([key, value]) => [key, rawDatabase(value)])),
        context: {
          people: [...d.getMap('people').values(), ...s.repo.members(id).map(m => ({ id: m.id, name: m.name || m.email.split('@')[0], color: 'default' }))] as Json[], functions: d.getMap('functions').toJSON() as ObjectJson,
          lists: d.getMap('lists').toJSON() as ObjectJson, propTypes: d.getMap('propTypes').toJSON() as ObjectJson, recordTypes: d.getMap('recordTypes').toJSON() as ObjectJson,
        },
      }))
      if (Object.keys(meta.pages).length > 5000) throw badRequest('checkout_too_large', 'A checkout supports up to 5,000 pages.')
      const snapshot: CheckoutSnapshot = { version: 1, workspaceId: id, name: workspace.name, at: Date.now(), revisions: { [metaName(id)]: meta.rev }, data: { pages: {}, databases: meta.databases }, context: meta.context }
      for (const key of Object.keys(meta.pages)) {
        const name = pageName(id, key)
        const page = await s.collab.read(name, d => ({ content: docJson(d) as ObjectJson, rev: docStateHash(d) }))
        snapshot.data.pages[key] = { meta: meta.pages[key]!, content: page.content }
        snapshot.revisions[name] = page.rev
      }
      if (await s.collab.read(metaName(id), d => docStateHash(d) === meta.rev)) {
        // Access can change while a large workspace is being read.
        access(s, c, 'viewer')
        return c.json(snapshot)
      }
    }
    throw conflict('checkout_stale', 'The cloud changed during the comparison. Compare again.')
  })
  app.post('/:id/checkout/merge', async c => {
    const { workspace, auth } = access(s, c, 'member')
    const id = workspace.id
    const next = await body(c, input)
    validateData(next.data)
    const names = Object.keys(next.revisions)
    const meta = metaName(id)
    if (!names.includes(meta) || names.some(n => n !== meta && (!n.startsWith(`${meta}:p:`) || !idSchema.safeParse(n.slice(`${meta}:p:`.length)).success))) throw badRequest('invalid_request', 'Checkout revisions belong to another workspace.')
    const all = [...new Set([...names, ...Object.keys(next.data.pages).map(key => pageName(id, key))])]
    await s.collab.withDocuments(all, (docs, transact) => {
      access(s, c, 'member')
      const root = docs.get(meta)!
      if (!equalJson(names.filter(n => n !== meta).sort(), pageIds(root).map(key => pageName(id, key)).sort()) || names.some(n => docStateHash(docs.get(n)!) !== next.revisions[n])) throw conflict('checkout_stale', 'The cloud changed since the comparison. Compare again; nothing was merged.')
      // A page whose locks changed while detached must be unlocked in the cloud first.
      const pages = root.getMap<Y.Map<unknown>>('pages')
      for (const [key, page] of pages) if (isObject(page.get('settings')) && (page.get('settings') as ObjectJson).locked === true) {
        const after = next.data.pages[key]
        if (!after || !equalJson(after.meta, rawPage(page)) || !equalJson(after.content, docJson(docs.get(pageName(id, key))!))) throw forbidden('checkout_locked', `Unlock the page in the cloud before merging: ${key}`)
      }
      for (const [key, database] of root.getMap<Y.Map<unknown>>('databases')) if (database.get('locked') === true && !equalJson(rawDatabase(database), next.data.databases[key])) throw forbidden('checkout_locked', `Unlock the database in the cloud before merging: ${key}`)
      // Do not let detached row allocation duplicate a cloud row's computed unique_id.
      // Refuse rather than silently renumber a reviewed result; the comparison must show the repair.
      for (const [dbId, db] of Object.entries(next.data.databases)) {
        const definitions = isObject(db.properties) ? Object.values(db.properties).filter(isObject) : []
        for (const prop of definitions.filter(p => p.type === 'unique_id')) {
          const seen = new Set<number>()
          for (const row of Object.values(next.data.pages).filter(p => p.meta.databaseId === dbId)) {
            const value = isObject(row.meta.properties) ? row.meta.properties[String(prop.id)] : undefined
            if (typeof value !== 'number') continue
            if (seen.has(value)) throw conflict('checkout_unique_id', 'Detached and cloud rows share a computed id. Refresh the local content and compare again.')
            seen.add(value)
          }
        }
      }
      // Prepare detached XML before any live mutation, so malformed content cannot half-apply a batch.
      const prepared = new Map(Object.entries(next.data.pages).filter(([key, p]) => !equalJson(docJson(docs.get(pageName(id, key))!), p.content)).map(([key, p]) => [key, xmlNodes(p.content)]))
      // Every check above precedes every write. No await below: live edits cannot enter between the guard and apply.
      for (const key of Object.keys(next.data.pages)) {
        const name = pageName(id, key)
        const nodes = prepared.get(key)
        if (!nodes) continue
        transact(name, d => { const fragment = d.getXmlFragment('default'); fragment.delete(0, fragment.length); fragment.insert(0, nodes) })
      }
      transact(meta, d => {
        const ps = d.getMap<Y.Map<unknown>>('pages')
        for (const key of ps.keys()) if (!next.data.pages[key]) ps.delete(key)
        for (const [key, page] of Object.entries(next.data.pages)) {
          const before = ps.get(key)
          const contentChanged = !next.revisions[pageName(id, key)] || docStateHash(docs.get(pageName(id, key))!) !== next.revisions[pageName(id, key)]
          if (before && equalJson(rawPage(before), page.meta) && !contentChanged) continue
          const yp = before ?? new Y.Map<unknown>()
          if (!before) { ps.set(key, yp); yp.set('createdBy', auth.user.id) }
          writeMap(yp, page.meta, new Set(['properties', 'comments']))
          yp.set('plain', fragmentText(docs.get(pageName(id, key))!))
          yp.set('updatedAt', Date.now()); yp.set('updatedBy', auth.user.id)
        }
        const dbs = d.getMap<Y.Map<unknown>>('databases')
        for (const key of dbs.keys()) if (!next.data.databases[key]) dbs.delete(key)
        for (const [key, database] of Object.entries(next.data.databases)) {
          const ydb = dbs.get(key) ?? new Y.Map<unknown>()
          if (!dbs.has(key)) dbs.set(key, ydb)
          writeMap(ydb, database, new Set(['properties', 'views']), CHECKOUT_DB_SKIP)
        }
      })
      // Store the batch together before releasing any pinned document.
      s.db.tx(() => { for (const [name, doc] of docs) s.repo.saveDocument(name, id, Y.encodeStateAsUpdate(doc)) })
    }, auth.user.id)
    return c.json({ merged: true })
  })
  return app
}
