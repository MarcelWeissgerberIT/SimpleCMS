/**
 * The MCP write tools that go beyond /api/v1: page content and title changes, new databases and
 * properties (the tidy-up tools: tidy.ts — trash, restore, moves — and structure.ts). They write the workspace's documents the way the app does
 * (docs/CLOUD.md § Server writes; store.ts createDatabase / addProperty / trashPage,
 * database/model/actions.ts enableTwoWay) — validation first, then one transaction per document.
 */
import * as Y from 'yjs'
import type { Services } from '../context.ts'
import { ApiError, notFound } from '../errors.ts'
import { appendBlocks, fragmentText, holdsWorkItem, markdownToNodes } from '../api/content.ts'
import { type PropertyDef, type Roots, TWO_WAY_SUFFIX, databaseMap, listNameOf, liveDatabase, livePage, newPageMap, nextOrder, pageMap, pairedRelation, propertiesMap, readOrdered, roots, rowsOf } from '../api/meta.ts'
import { contentDoc, findProperty, metaDoc, type WorkspaceModel, type WriteOpts } from '../api/model.ts'
import { checkKey, handOnlyMessage, isHandOnly } from '../api/keys.ts'
import { schemaOut, type ValueContext } from '../api/values.ts'
import { newId } from '../tokens.ts'
import { assertNotSystem, PARTNER_SYSTEM, TWO_WAY_SYSTEM } from './system.ts'
import { MCP_DEFAULT_PROPERTIES, MCP_DEFAULT_STATUS, MCP_LIMITS, MCP_PLAIN_MARKS, MCP_PLAIN_NODES, MCP_PROPERTY_TYPES } from '../../../src/shared/mcp/tables.ts'
import { listOptionText, mcpError } from '../../../src/shared/mcp/errors.ts'
import { isIconError, mcpIcon } from '../../../src/shared/mcp/icon.ts'

/** Property types an agent may add (the shared table: formula, rollup and button need settings the tools don't take). */
export const CREATABLE_TYPES = MCP_PROPERTY_TYPES

export type CreatableType = (typeof CREATABLE_TYPES)[number]

export const COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const
const COLOR_SET = new Set<string>(['default', ...COLORS])
const GROUPS = new Set(['todo', 'in_progress', 'done'])

export type OptionInput = string | { name: string; color?: string; group?: string }

export interface PropertyInput {
  name: string
  type: CreatableType | 'title'
  options?: OptionInput[]
  relation?: { databaseId: string; twoWay?: boolean; reverseName?: string }
}

interface Option {
  id: string
  name: string
  color: string
  group?: string
}

export const unprocessable = (code: string, message: string) => new ApiError(422, code, message)

/** The longest title a call may give (the bridge's limit, before its whitespace is collapsed). */
export const MCP_TITLE_MAX = MCP_LIMITS.title

/**
 * A title as the bridge takes it over MCP (one_update_page, a row's title through `properties`): whitespace collapsed,
 * at most 300 characters, never empty — a call that empties it or passes only whitespace is refused (bad_argument).
 */
export function cleanTitle(raw: unknown, path: string, what = '"title"'): string {
  if (typeof raw !== 'string') throw new ApiError(422, 'bad_argument', mcpError('bad_argument', path, `${what} must be a string`))
  if (raw.length > MCP_TITLE_MAX) throw new ApiError(422, 'bad_argument', mcpError('bad_argument', path, `too long (${raw.length} characters, at most ${MCP_TITLE_MAX})`))
  const t = raw.replace(/\s+/g, ' ').trim()
  if (!t) throw new ApiError(422, 'bad_argument', mcpError('bad_argument', path, `${what} must not be empty`))
  return t
}

/**
 * A row's `properties` with its title (by "title", the title property's name or id) cleaned as cleanTitle does — the
 * same rule as the bridge's one_update_row; a properties object without a title passes as it is.
 */
export function cleanRowTitle(props: ReadonlyArray<PropertyDef>, properties: Record<string, unknown>, path = 'properties'): Record<string, unknown> {
  const titleProp = props.find((p) => p.type === 'title')
  let out: Record<string, unknown> | null = null
  for (const [k, v] of Object.entries(properties)) {
    const key = k.trim().toLowerCase()
    const isTitle = (key === 'title' && !findProperty(props as PropertyDef[], k)) || (!!titleProp && (findProperty(props as PropertyDef[], k)?.id === titleProp.id))
    if (!isTitle) continue
    out ??= { ...properties }
    out[k] = cleanTitle(v ?? '', `${path}.${k}`, 'the title')
  }
  return out ?? properties
}

/** The refusal of a Markdown replace of a page holding a task (one_update_page, a server agent's report). */
export const PAGE_HOLDS_TASKS = 'This page holds tasks; a replace would turn them into plain text. Append instead, or edit the page in One.'

/** Most properties one_create_database takes (the shared limit). */
export const MAX_DB_PROPERTIES = MCP_LIMITS.properties

/**
 * What the server's Markdown (api/content.ts markdownToNodes) writes: a replace over MCP may only replace a page whose
 * content is made of these — anything else (columns, callouts, tables, media, a database block, an underline …) would
 * be lost without a card or an Undo. A pre-filter until the server's own round trip (MCP plan B4s).
 */
const REPLACEABLE_NODES = new Set<string>(MCP_PLAIN_NODES)
const REPLACEABLE_MARKS = new Set<string>(MCP_PLAIN_MARKS)

/** The node and mark names in a page's content that a Markdown replace here would lose (≤ 12, document order). */
export function lossyIn(doc: Y.Doc): string[] {
  const out = new Set<string>()
  const stack: Array<Y.XmlFragment | Y.XmlElement | Y.XmlText> = [...doc.getXmlFragment('default').toArray()].reverse() as Array<Y.XmlElement | Y.XmlText>
  while (stack.length && out.size < 12) {
    const n = stack.pop()!
    if (n instanceof Y.XmlText) {
      for (const d of n.toDelta() as Array<{ attributes?: Record<string, unknown> }>) for (const mark of Object.keys(d.attributes ?? {})) if (!REPLACEABLE_MARKS.has(mark)) out.add(mark)
      continue
    }
    if (n instanceof Y.XmlElement) {
      if (!REPLACEABLE_NODES.has(n.nodeName)) out.add(n.nodeName)
      stack.push(...([...n.toArray()].reverse() as Array<Y.XmlElement | Y.XmlText>))
    }
  }
  return [...out]
}

/**
 * PageIcon JSON from the tools' icon string: an emoji, `asset:<name>` or `lucide:<Name>`; '' clears — the local bridge's
 * rule (shared/mcp/icon.ts): a word is no icon (it would show as one in every member's sidebar).
 */
export function iconIn(raw: string | null | undefined): unknown {
  const icon = mcpIcon(raw)
  if (isIconError(icon)) throw unprocessable('invalid_icon', `bad_argument: ${icon.error}.`)
  return icon
}

/**
 * Option names a row value gives, as the app's agent takes them (ai/agent/props.ts): a name that is no option of the
 * property yet is cut to MCP_LIMITS.optionName — the option that is made carries the cut name, and so does the value.
 */
export function cutOptionNames(prop: PropertyDef, raw: unknown): unknown {
  if (prop.type !== 'select' && prop.type !== 'multi_select') return raw
  const known = (n: string) => (prop.options ?? []).some((o) => o.id === n.trim() || o.name.trim().toLowerCase() === n.trim().toLowerCase())
  const cut = (n: string) => (known(n) ? n : n.trim().slice(0, MCP_LIMITS.optionName))
  if (typeof raw === 'string') return prop.type === 'multi_select' && !known(raw) ? raw.split(',').map(cut).join(',') : cut(raw)
  if (Array.isArray(raw)) return raw.map((x) => (typeof x === 'string' ? cut(x) : x))
  return raw
}

/**
 * A select bound to a shared list (the app's building blocks): its options are the list's — an option added to the
 * property alone would go with the next list edit and leave its values pointing at nothing. Refused, as the bridge and
 * the app's agents refuse it.
 */
export function assertNoListOption(r: Roots, prop: PropertyDef, fresh: readonly string[]): void {
  if (!prop.listId || !fresh.length) return
  throw unprocessable('invalid_value', `"${prop.name}" (${prop.type}): ${listOptionText(fresh[0]!, listNameOf(r, prop.listId))}. Use one of: ${(prop.options ?? []).map((o) => JSON.stringify(o.name)).join(', ')}.`)
}

function options(type: string, input: OptionInput[] | undefined): Option[] | undefined {
  if (type !== 'select' && type !== 'multi_select' && type !== 'status') return undefined
  if (!input?.length) {
    // the contract's default status options (the local bridge makes the same — shared/mcp/tables.ts)
    return type === 'status' ? MCP_DEFAULT_STATUS.map((o) => ({ id: newId(), ...o })) : []
  }
  const seen = new Set<string>()
  return input.map((o, i) => {
    const spec = typeof o === 'string' ? { name: o } : o
    // as the bridge takes them (plan.ts optionsOf): whitespace collapsed, cut to MCP_LIMITS.optionName
    const name = spec.name.replace(/\s+/g, ' ').trim().slice(0, MCP_LIMITS.optionName)
    if (!name) throw unprocessable('invalid_option', 'Option names cannot be empty')
    if (seen.has(name.toLowerCase())) throw unprocessable('invalid_option', `Option "${name}" is listed twice`)
    seen.add(name.toLowerCase())
    if (spec.color !== undefined && !COLOR_SET.has(spec.color)) throw unprocessable('invalid_option', `${name}: color is one of ${[...COLOR_SET].join(', ')}`)
    if (spec.group !== undefined && !GROUPS.has(spec.group)) throw unprocessable('invalid_option', `${name}: group is todo, in_progress or done`)
    const opt: Option = { id: newId(), name, color: spec.color ?? COLORS[i % COLORS.length]! }
    // status options belong to a group: first "to do", last "done", the rest "in progress"
    if (type === 'status') opt.group = spec.group ?? (i === 0 ? 'todo' : i === input.length - 1 && input.length > 1 ? 'done' : 'in_progress')
    return opt
  })
}

/** A new property definition (ids fresh); relation targets checked in `r`. */
/**
 * A relation whose two-way partner lives in One's own database: a value set over MCP would write the link into that
 * database's rows too (model.ts syncPartners) — refused as `system_database`, before anything is written.
 */
export function assertNoSystemPartner(r: Roots, dbId: string, prop: PropertyDef, path: string): void {
  if (prop.type !== 'relation') return
  const pair = pairedRelation(r, dbId, prop)
  if (pair && pair.dbId !== dbId) assertNotSystem(r, pair.dbId, path, PARTNER_SYSTEM)
}

function definition(r: Roots, input: PropertyInput, selfId: string | null): PropertyDef {
  const name = input.name.replace(/\s+/g, ' ').trim()
  if (!name) throw unprocessable('invalid_property', 'A property needs a name')
  const def: PropertyDef = { id: newId(), name, type: input.type }
  const opts = options(input.type, input.options)
  if (opts) def.options = opts
  else if (input.options?.length) throw unprocessable('invalid_property', `${name}: only select, multi_select and status properties take options`)
  if (input.type === 'relation') {
    const target = input.relation?.databaseId
    if (!target) throw unprocessable('invalid_property', `${name}: a relation needs relation.databaseId`)
    if (target !== selfId && !liveDatabase(r, target)) throw notFound('database_not_found', `${name}: no database with id "${target}" in this workspace`)
    // the reverse side of a two-way relation would change One's own database (read-only over MCP, system.ts)
    if (input.relation?.twoWay && target !== selfId) assertNotSystem(r, target, `${name}.relation`, TWO_WAY_SYSTEM)
    def.relationDatabaseId = target
  } else if (input.relation) throw unprocessable('invalid_property', `${name}: only relation properties take relation`)
  return def
}

export const nextPropOrder = (ydb: Y.Map<unknown>) => {
  const m = ydb.get('properties')
  let max = -1
  if (m instanceof Y.Map) for (const v of (m as Y.Map<unknown>).values()) if (v && typeof (v as { order?: unknown }).order === 'number') max = Math.max(max, (v as { order: number }).order)
  return max + 1
}

export const propsMapOf = (ydb: Y.Map<unknown>): Y.Map<unknown> => {
  const cur = ydb.get('properties')
  if (cur instanceof Y.Map) return cur as Y.Map<unknown>
  // an older entry kept the list as one JSON value: from now on it is keyed (like the app's writeDatabase)
  const fresh = new Y.Map<unknown>()
  readOrdered<PropertyDef>(cur).forEach((p, i) => fresh.set(p.id, { ...p, order: i }))
  ydb.set('properties', fresh)
  return fresh
}

/** Add a property id to every view's visible properties (the app's addProperty). */
function showInViews(ydb: Y.Map<unknown>, propId: string) {
  const views = ydb.get('views')
  if (!(views instanceof Y.Map)) return
  for (const [id, v] of (views as Y.Map<unknown>).entries()) {
    if (!v || typeof v !== 'object') continue
    const view = v as { visibleProperties?: unknown }
    const visible = Array.isArray(view.visibleProperties) ? (view.visibleProperties as string[]) : []
    if (!visible.includes(propId)) (views as Y.Map<unknown>).set(id, JSON.parse(JSON.stringify({ ...view, visibleProperties: [...visible, propId] })))
  }
}

/** What createDatabase takes (MCP one_create_database). */
export interface DatabaseInput {
  title: string
  parentId?: string | null
  properties?: PropertyInput[]
  icon?: unknown
  inline?: boolean
  shape?: (r: Roots, defs: PropertyDef[]) => { defs: PropertyDef[]; views: Array<Record<string, unknown>> | null }
}

export class McpWrites {
  private readonly s: Services
  private readonly model: WorkspaceModel

  constructor(s: Services, model: WorkspaceModel) {
    this.s = s
    this.model = model
  }

  /* ---------------------------------------------------------------- pages */

  /**
   * Title, icon and the content (append / replace). Check, then write (spec § 3.6): every check runs before anything is
   * written — the page is live, a replace drops no task, and over MCP (`opts.mcp`; server agents keep their rules) the
   * page is not One's own database, not locked for content, and a replace loses nothing the server's Markdown cannot
   * write back. The meta check after the content write is only for a race, and a race puts the content back from this
   * call's pre-image.
   */
  async updatePage(
    wsId: string,
    input: { id: string; title?: string; icon?: string | null; markdown?: string; mode: 'append' | 'replace' },
    actor: string,
    opts: {
      mcp?: boolean
      /** the content before the write (inside its transaction) — a replace's, or with `preimageAppend` an append's too */
      preimage?: (doc: Y.Doc) => void
      /** an append keeps a pre-image too (one_upsert_rows writes a row's body this way — preimages.ts) */
      preimageAppend?: boolean
    } = {},
  ) {
    // over MCP, as the bridge answers it: a call that names nothing to change, or an append of nothing, is refused —
    // never a write that only stamps the page as edited by the token
    if (opts.mcp && input.title === undefined && input.icon === undefined && input.markdown === undefined)
      throw unprocessable('invalid_request', mcpError('bad_argument', '', 'Nothing to change: pass "title", "icon" and/or "markdown"'))
    if (opts.mcp && input.markdown !== undefined && input.mode === 'append' && !input.markdown.trim())
      throw unprocessable('invalid_request', mcpError('bad_argument', 'markdown', '"markdown" is empty: nothing to append'))
    const icon = iconIn(input.icon)
    const content = input.markdown !== undefined && (input.mode === 'replace' || input.markdown.trim())
    const check = (r: Roots) => {
      const page = livePage(r, input.id)
      if (!page) throw notFound('page_not_found', `No page with id "${input.id}" in this workspace (or it is in the trash)`)
      if (opts.mcp) assertNotSystem(r, input.id)
      if (input.markdown !== undefined && page.kind === 'database') throw unprocessable('page_is_database', 'A database page has no text to write: add rows with one_create_row')
      const settings = pageMap(r, input.id)?.get('settings') as { locked?: unknown } | undefined
      if (opts.mcp && content && settings?.locked === true) throw unprocessable('locked', `locked: ${JSON.stringify(page.title || 'Untitled')} is locked in One: its content cannot change (its title and icon can). Nothing was changed. Ask the person to unlock it.`)
      return page
    }
    const before = await this.model.read(wsId, check)
    // what the call changes (the bridge's `changed`): a title or icon equal to the page's is no change and not written
    const sameIcon = (now: unknown) => JSON.stringify(now ?? null) === JSON.stringify(icon ?? null)
    const titleNew = (now: string) => input.title !== undefined && input.title !== now
    const iconNew = (now: unknown) => icon !== undefined && !sameIcon(now)
    const head = await this.model.read(wsId, (r) => ({ title: String(pageMap(r, input.id)?.get('title') ?? ''), icon: pageMap(r, input.id)?.get('icon') }))
    if (opts.mcp && !content && !titleNew(head.title) && !iconNew(head.icon))
      return { id: input.id, title: before.title, url: this.model.url(wsId, input.id), changed: [] as string[], note: 'No change: the page already looks like that.' }
    let plain: string | undefined
    /** the call's pre-image: what the content was (replace), or what this call added (append) */
    let undoContent: ((doc: Y.Doc) => void) | null = null
    if (content) {
      const nodes = markdownToNodes(input.markdown!)
      plain = await this.s.collab.write(
        contentDoc(wsId, input.id),
        (doc) => {
          const frag = doc.getXmlFragment('default')
          if (input.mode === 'replace') {
            // a task block cannot be read or written here yet (server parity, P4): a replace would turn it into paragraphs
            // (over MCP in the contract's words: a replace that would lose them is lossy_replace — the error's own code
            // stays page_holds_tasks for the server agents' report)
            if (holdsWorkItem(doc))
              throw unprocessable(
                'page_holds_tasks',
                opts.mcp
                  ? `lossy_replace: ${JSON.stringify(before.title || 'Untitled')} holds tasks; a replace over the team server would turn them into plain text. Nothing was changed. Append instead (mode "append"), change it in One, or use the local bridge (it asks first).`
                  : PAGE_HOLDS_TASKS,
              )
            const lossy = opts.mcp ? lossyIn(doc) : []
            if (lossy.length)
              throw unprocessable(
                'lossy_replace',
                `lossy_replace: ${JSON.stringify(before.title || 'Untitled')} holds content a replace over the team server cannot write back (${lossy.join(', ')}). Nothing was changed. Append instead, change it in One, or use the local bridge (it asks first).`,
              )
            // the call's pre-image (MCP: what a restore writes back — preimages.ts), taken inside this transaction
            opts.preimage?.(doc)
            // —— changes from here on ——
            // detached copies (a copy of a copy would come out empty: Yjs keeps a detached type's children aside)
            const pre = frag.toArray().map((n) => (n as Y.XmlElement | Y.XmlText).clone())
            undoContent = (d) => {
              const f = d.getXmlFragment('default')
              if (f.length) f.delete(0, f.length)
              if (pre.length) f.insert(0, pre)
            }
            if (frag.length) frag.delete(0, frag.length)
          }
          // an append's pre-image (asked for): the content before, so a restore can take the appended blocks back
          if (input.mode === 'append' && opts.preimageAppend) opts.preimage?.(doc)
          const start = frag.length
          appendBlocks(doc, nodes)
          if (input.mode === 'append') {
            const added = frag.toArray().slice(start)
            undoContent = (d) => {
              const f = d.getXmlFragment('default')
              for (const el of added) {
                const at = f.toArray().indexOf(el)
                if (at >= 0) f.delete(at, 1)
              }
            }
          }
          return fragmentText(doc, 20_000)
        },
        actor,
      )
    }
    let page: { id: string; title: string; changed: string[] }
    try {
      page = await this.s.collab.write(
        metaDoc(wsId),
        (doc) => {
          const r = roots(doc)
          check(r)
          const yp = pageMap(r, input.id)!
          const changed: string[] = []
          if (titleNew(String(yp.get('title') ?? ''))) {
            yp.set('title', input.title)
            changed.push('title')
          }
          if (iconNew(yp.get('icon'))) {
            yp.set('icon', icon)
            changed.push('icon')
          }
          if (plain !== undefined) yp.set('plain', plain)
          if (content) changed.push('content')
          if (changed.length || !opts.mcp) {
            yp.set('updatedAt', Date.now())
            yp.set('updatedBy', actor)
          }
          return { id: input.id, title: String(yp.get('title') ?? ''), changed }
        },
        actor,
      )
    } catch (err) {
      // a race: the page went (trash, lock, …) while the content was written — the content goes back as it was
      const restore = undoContent as ((doc: Y.Doc) => void) | null
      if (restore) {
        await this.s.collab.write(contentDoc(wsId, input.id), restore, actor).catch((e: unknown) => this.s.log.error('mcp content restore failed', { workspace: wsId, page: input.id, error: e as Error }))
        this.s.log.info('mcp content restored after a failed meta check', { workspace: wsId, page: input.id, by: actor })
      }
      throw err
    }
    this.s.log.info('mcp page updated', { workspace: wsId, page: input.id, content: input.markdown !== undefined ? input.mode : undefined, by: actor })
    const { changed, ...rest } = page
    return { ...rest, url: this.model.url(wsId, input.id), ...(opts.mcp ? { changed } : {}), ...(input.markdown !== undefined && (content || !opts.mcp) ? { content: input.mode } : {}) }
  }

  /* ---------------------------------------------------------------- rows */

  /**
   * Row input the way agents write it (the local bridge takes the same): "title" sets the title even
   * when the title property has another name, people may be given by name, related rows by title, and
   * select / multi_select option names that don't exist yet are added to the property — only when
   * everything else in the input is valid, and never in a locked database. Then the regular
   * create / update path (strict: anything left that doesn't fit is a 422 listing every problem).
   */
  async prepareRow(wsId: string, target: { databaseId: string } | { rowId: string }, input: { title?: string; properties?: Record<string, unknown> }, actor: string, opts: WriteOpts & { mcp?: boolean } = {}) {
    const plan = (r: Roots) => {
      const dbId = 'databaseId' in target ? target.databaseId : (livePage(r, target.rowId)?.databaseId ?? null)
      // One's own databases are read-only over MCP (system.ts): no row is created or changed there
      if (opts.mcp) assertNotSystem(r, 'rowId' in target ? target.rowId : dbId)
      const db = dbId ? liveDatabase(r, dbId) : null
      if (!db) return null
      const ctx = this.model.context(wsId, r)
      let title = input.title
      const properties: Record<string, unknown> = {}
      const added = new Map<string, string[]>()
      for (const [key, raw] of Object.entries(input.properties ?? {})) {
        const prop = findProperty(db.properties, key)
        if (!prop && key.trim().toLowerCase() === 'title') {
          title = raw === null || raw === undefined ? '' : String(raw)
          continue
        }
        if (!prop) {
          properties[key] = raw
          continue
        }
        // "Only by hand" (api/keys.ts): refused before anything (a new option) is written
        if (opts.agent && isHandOnly(prop)) throw unprocessable('invalid_value', handOnlyMessage(prop))
        // a files value over MCP: only this workspace's files, never a web address (it would load in every viewer)
        if (opts.mcp && prop.type === 'files') checkFilesValue(prop.name, raw, ctx.files)
        // a two-way relation writes its partner rows too (model.ts syncPartners): never into One's own databases
        if (opts.mcp) assertNoSystemPartner(r, db.page.id, prop, `properties.${prop.name}`)
        const value = cutOptionNames(prop, raw)
        properties[key] = friendlyIn(r, prop, value, ctx)
        if (prop.type === 'select' || prop.type === 'multi_select') {
          const fresh = optionNames(prop, value).filter((n) => !(prop.options ?? []).some((o) => o.id === n || o.name.trim().toLowerCase() === n.toLowerCase()))
          // a select bound to a shared list takes no option of its own (before anything is written)
          if (db.ydb.get('locked') !== true) assertNoListOption(r, prop, fresh)
          if (fresh.length) added.set(prop.id, [...new Set(fresh)])
        }
      }
      if (added.size && db.ydb.get('locked') === true) added.clear()
      if (added.size) {
        // dry run against the schema with the new options: nothing is added for a row that can't be written
        const augmented = db.properties.map((p) => (added.has(p.id) ? { ...p, options: [...(p.options ?? []), ...added.get(p.id)!.map((name) => ({ id: name, name }))] } : p))
        const { values } = this.model.resolveStrict(augmented, { title, properties }, ctx, opts)
        // nor for a row whose key another row holds
        const self = 'rowId' in target ? target.rowId : null
        checkKey(r, db.page.id, db.properties, values, self, self ? livePage(r, self)?.properties : undefined)
      }
      return { dbId: db.page.id, title, properties, added }
    }
    const p = await this.model.read(wsId, plan)
    if (!p) return input
    if (p.added.size) {
      await this.s.collab.write(
        metaDoc(wsId),
        (doc) => {
          const r = roots(doc)
          const db = liveDatabase(r, p.dbId)
          if (!db) return
          const pm = propsMapOf(db.ydb)
          for (const [propId, names] of p.added) {
            const def = pm.get(propId) as (PropertyDef & { order?: number }) | undefined
            if (!def) continue
            const opts = [...(def.options ?? [])]
            for (const name of names) {
              if (opts.some((o) => o.name.trim().toLowerCase() === name.toLowerCase())) continue
              opts.push({ id: newId(), name, color: COLORS[opts.length % COLORS.length]! })
            }
            pm.set(propId, JSON.parse(JSON.stringify({ ...def, options: opts })))
          }
        },
        actor,
      )
      this.s.log.info('mcp options added', { workspace: wsId, database: p.dbId, by: actor })
    }
    return { title: p.title, properties: p.properties }
  }

  /* ---------------------------------------------------------------- databases */

  /** A new database's schema and views as createDatabase writes them (checked against `r`; nothing written). */
  planDatabase(r: Roots, input: DatabaseInput, id: string) {
    const parentId = input.parentId ?? null
    if (parentId) {
      const parent = livePage(r, parentId)
      if (!parent) throw notFound('parent_not_found', `No parent page with id "${parentId}" in this workspace`)
      if (parent.kind === 'database') throw unprocessable('parent_is_database', mcpError('bad_argument', 'parentId', `${JSON.stringify(parent.title || 'Untitled')} is a database; a database goes under a page`, 'Pass the page above it as parentId (or leave parentId out for the top level).'))
      // nothing new below a row of One's own databases
      assertNotSystem(r, parentId)
    }
    if ((input.properties?.length ?? 0) > MAX_DB_PROPERTIES) throw unprocessable('invalid_property', `At most ${MAX_DB_PROPERTIES} properties in one call (got ${input.properties!.length}).`)
    const specs: PropertyInput[] = input.properties?.length
      ? input.properties
      : MCP_DEFAULT_PROPERTIES.map((p) => ({ name: p.name, type: p.type }))
    const titles = specs.filter((p) => p.type === 'title')
    if (titles.length > 1) throw unprocessable('invalid_property', 'A database has one title property')
    const names = new Set<string>()
    for (const p of specs) {
      const k = p.name.trim().toLowerCase()
      if (names.has(k)) throw unprocessable('invalid_property', `Property "${p.name}" is listed twice`)
      names.add(k)
    }
    const all = titles.length ? specs : [{ name: names.has('name') ? 'Title' : 'Name', type: 'title' as const }, ...specs]
    const pairs: Array<{ def: PropertyDef; spec: PropertyInput }> = all.map((spec) => ({ spec, def: definition(r, spec, id) }))
    const reverse = pairs.filter(({ spec }) => spec.type === 'relation' && spec.relation?.twoWay && spec.relation.databaseId !== id)
    for (const { spec } of reverse) {
      const target = liveDatabase(r, spec.relation!.databaseId)!
      if (target.ydb.get('locked') === true) throw unprocessable('database_locked', `"${target.page.title}" is locked: unlock it in the app to add the two-way relation`)
    }
    const shaped = input.shape ? input.shape(r, pairs.map((p) => p.def)) : null
    return { pairs, reverse, defs: shaped?.defs ?? pairs.map((p) => p.def), views: shaped?.views ?? null }
  }

  /** The schema and views a createDatabase call would write (for checks before anything is written). */
  draftDatabase(wsId: string, input: DatabaseInput) {
    return this.model.read(wsId, (r) => this.planDatabase(r, input, 'draft'))
  }

  /**
   * A database (one meta transaction): its page, properties and views. `shape` (MCP one_create_database's views, batch.ts)
   * turns the properties into the views it asks for — and may add one (a board's Status); without it: one table view.
   * `inline`: it lives in its parent page's text (the caller writes the database block); `icon` as iconIn makes it.
   */
  async createDatabase(wsId: string, input: DatabaseInput, actor: string) {
    const parentId = input.parentId ?? null
    const id = newId()
    const build = (r: Roots) => this.planDatabase(r, input, id)
    await this.model.read(wsId, build)
    const out = await this.s.collab.write(
      metaDoc(wsId),
      (doc) => {
        const r = roots(doc)
        const { reverse, defs, views: shaped } = build(r)
        const at = Date.now()
        // —— changes from here on ——
        r.pages.set(id, newPageMap({ id, kind: 'database', title: input.title, icon: input.icon ?? null, parentId, databaseId: null, order: nextOrder(r, parentId), properties: {}, plain: '', at }, actor))
        const ydb = new Y.Map<unknown>()
        const pm = new Y.Map<unknown>()
        defs.forEach((d, i) => pm.set(d.id, { ...d, order: i }))
        ydb.set('properties', pm)
        const views = new Y.Map<unknown>()
        const list = shaped ?? [{ id: newId(), name: 'Table', type: 'table', filter: null, sorts: [], visibleProperties: defs.filter((d) => d.type !== 'title').map((d) => d.id), openIn: 'peek' }]
        list.forEach((v, i) => views.set(String(v.id), JSON.parse(JSON.stringify({ ...v, order: i }))))
        ydb.set('views', views)
        ydb.set('nextUniqueId', 1)
        ydb.set('inline', input.inline === true)
        r.databases.set(id, ydb)
        const backs = reverse.map(({ def, spec }) => addReverse(r, id, input.title, def, spec.relation?.reverseName))
        const nameOf = (pid: unknown) => defs.find((d) => d.id === pid)?.name ?? null
        return { properties: defs.map(schemaOut), views: list.map((v) => ({ id: String(v.id), name: String(v.name), type: String(v.type), groupBy: nameOf(v.groupBy) })), reverse: backs }
      },
      actor,
    )
    this.s.log.info('mcp database created', { workspace: wsId, database: id, by: actor })
    return { id, title: input.title, url: this.model.url(wsId, id), ...out }
  }

  async createProperty(wsId: string, input: { databaseId: string } & PropertyInput, actor: string) {
    const check = (r: Roots) => {
      const db = liveDatabase(r, input.databaseId)
      if (!db) throw notFound('database_not_found', `No database with id "${input.databaseId}" in this workspace`)
      assertNotSystem(r, input.databaseId)
      if (db.ydb.get('locked') === true) throw unprocessable('database_locked', `"${db.page.title}" is locked: properties can't be added until it is unlocked in the app`)
      if (input.type === 'title') throw unprocessable('invalid_property', 'A database has exactly one title property already')
      const name = input.name.trim().toLowerCase()
      if (db.properties.some((p) => p.name.trim().toLowerCase() === name)) throw unprocessable('property_exists', `"${db.page.title}" already has a property named "${input.name}"`)
      const def = definition(r, input, input.databaseId)
      if (input.relation?.twoWay) {
        const target = liveDatabase(r, input.relation.databaseId)!
        if (target.ydb.get('locked') === true) throw unprocessable('database_locked', `"${target.page.title}" is locked: unlock it in the app to add the two-way relation`)
      }
      return { db, def }
    }
    await this.model.read(wsId, check)
    const out = await this.s.collab.write(
      metaDoc(wsId),
      (doc) => {
        const r = roots(doc)
        const { db, def } = check(r)
        // —— changes from here on ——
        propsMapOf(db.ydb).set(def.id, { ...def, order: nextPropOrder(db.ydb) })
        showInViews(db.ydb, def.id)
        if (def.type === 'unique_id') backfillUniqueIds(r, db.ydb, input.databaseId, def.id, actor)
        const reverse = input.relation?.twoWay ? addReverse(r, input.databaseId, db.page.title, def, input.relation.reverseName) : null
        return { property: schemaOut(def), ...(reverse ? { reverse } : {}) }
      },
      actor,
    )
    this.s.log.info('mcp property created', { workspace: wsId, database: input.databaseId, type: input.type, by: actor })
    return { databaseId: input.databaseId, ...out }
  }
}

/**
 * The reverse side of a two-way relation (the app's enableTwoWay): `<id>.2way` on the target,
 * named after the source database (a self-relation: "<name> (reverse)"). New, so nothing to backfill.
 */
function addReverse(r: Roots, dbId: string, dbTitle: string, def: PropertyDef, reverseName: string | undefined) {
  const targetId = def.relationDatabaseId!
  const ydb = databaseMap(r, targetId)
  if (!ydb) return null
  const name = reverseName?.trim() || (targetId === dbId ? `${def.name} (reverse)` : dbTitle || 'Untitled')
  const back: PropertyDef = { id: def.id + TWO_WAY_SUFFIX, name, type: 'relation', relationDatabaseId: dbId }
  propsMapOf(ydb).set(back.id, { ...back, order: nextPropOrder(ydb) })
  showInViews(ydb, back.id)
  return { databaseId: targetId, property: schemaOut(back) }
}

/** Existing rows get numbers in creation order, like the app's addProperty (trashed rows included). */
function backfillUniqueIds(r: Roots, ydb: Y.Map<unknown>, dbId: string, propId: string, actor: string) {
  const rows: Array<{ yp: Y.Map<unknown>; at: number; id: string }> = []
  for (const [id, yp] of r.pages.entries()) {
    if (yp instanceof Y.Map && yp.get('databaseId') === dbId) rows.push({ yp: yp as Y.Map<unknown>, at: Number(yp.get('createdAt')) || 0, id })
  }
  rows.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))
  const counter = ydb.get('nextUniqueId')
  let next = typeof counter === 'number' && Number.isFinite(counter) ? counter : 1
  for (const row of rows) {
    propertiesMap(row.yp).set(propId, next++)
    row.yp.set('updatedBy', actor)
  }
  ydb.set('nextUniqueId', next)
}

/** Option names in a select / multi_select input ("A, B" splits unless it is one option's name — like coerce). */
export function optionNames(prop: PropertyDef, raw: unknown): string[] {
  if (raw === null || raw === undefined || raw === '') return []
  const whole = (v: string) => (prop.options ?? []).some((o) => o.id === v.trim() || o.name.trim().toLowerCase() === v.trim().toLowerCase())
  const items = Array.isArray(raw) ? raw : typeof raw === 'string' && prop.type === 'multi_select' && !whole(raw) ? raw.split(',') : [raw]
  return items.flatMap((x) => (typeof x === 'string' && x.trim() ? [x.trim()] : typeof x === 'number' ? [String(x)] : []))
}

const EMAIL = /^[^\s@]+@[^\s@]+$/

/** People by name and related rows by title (exact, case-insensitive), as ids — what coerce() takes. */
export function friendlyIn(r: Roots, prop: PropertyDef, raw: unknown, ctx: ValueContext): unknown {
  if (prop.type !== 'person' && prop.type !== 'relation') return raw
  const one = (v: unknown): unknown => {
    if (typeof v !== 'string' || !v.trim()) return v
    const s = v.trim()
    const k = s.toLowerCase()
    if (prop.type === 'person') {
      if (EMAIL.test(s) || ctx.people.has(s) || ctx.members.some((m) => m.id === s)) return v
      const named = [
        ...ctx.members.filter((m) => (ctx.people.get(m.id)?.name ?? m.name ?? '').trim().toLowerCase() === k).map((m) => m.id),
        ...[...ctx.people.values()].filter((p) => p.name.trim().toLowerCase() === k).map((p) => p.id),
      ]
      const ids = [...new Set(named)]
      return ids.length === 1 ? ids[0] : v
    }
    const target = prop.relationDatabaseId
    if (!target || pageMap(r, s)?.get('databaseId') === target) return v
    const rows = rowsOf(r, target).filter((row) => row.title.trim().toLowerCase() === k)
    return rows.length === 1 ? rows[0]!.id : v
  }
  return Array.isArray(raw) ? raw.map(one) : one(raw)
}

/** A files value as MCP may write it: `onefile:<id>` refs only (one or a list; null / [] clears). */
export function checkFilesValue(name: string, raw: unknown, files?: ValueContext['files']): void {
  if (raw === null || raw === undefined || raw === '') return
  const items = Array.isArray(raw) ? raw : [raw]
  const bad = items.find((x) => typeof x !== 'string' || !/^onefile:[A-Za-z0-9_-]{1,64}$/.test(x.trim()))
  if (bad !== undefined)
    throw unprocessable(
      'refused_type',
      `refused_type: properties.${name}: over MCP a files property takes only this workspace's files (onefile:<id>, as one_get_page / one_query_database show them) — got ${JSON.stringify(typeof bad === 'string' ? bad.slice(0, 120) : bad)}. Nothing was changed. A web address goes into a url property or the page text.`,
    )
  if (!files) return
  // a file of this workspace that everyone may see (a private upload stays its owner's; MCP B3 § 2.3)
  for (const x of items as string[]) {
    const ref = x.trim()
    const state = files(ref.slice('onefile:'.length))
    if (state === 'missing') throw new ApiError(404, 'not_found', `not_found: properties.${name}: ${ref} is no file of this workspace. Nothing was changed. Use a onefile: ref that one_get_page / one_query_database show.`)
    if (state === 'private') throw new ApiError(422, 'private_scope', `private_scope: properties.${name}: ${ref} is a private file and this row is seen by the whole workspace. Nothing was changed. Leave the file out, or ask the person to move it by hand.`)
  }
}
