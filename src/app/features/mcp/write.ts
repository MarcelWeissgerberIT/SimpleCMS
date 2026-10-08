/**
 * One MCP — the writing tools. Each call is first PLANNED (validated, nothing written; the plan
 * carries a localized summary for the approval card) and applied only after approval (or right
 * away in "Apply directly").
 *
 * Pages, rows, appends and renames reuse the workspace agent: its tools validate and coerce the
 * input into a StagedChange (on a private, per-call stage) and its applyChanges() writes it —
 * one implementation of property coercion, option creation, content origin 'ai' and undo. Icons,
 * content replacement, new properties and databases are applied here; the tidy-up tools live in
 * tidy.ts (trash, restore, moves) and structure.ts (database, property and view changes).
 */
import type { JSONContent } from '@tiptap/core'
import { markdownToDoc } from '../../editor'
import { newId } from '../../lib/ids'
import { t } from '../../i18n'
import type { Database, ID, PropertyDef, PropertyType } from '../../store/types'
import { aiWrite, snapshotNow } from '../history/snapshots'
import { AGENT_TOOLS, ToolInputError, type StageApi } from '../ai/agent/tools'
import { applyChanges } from '../ai/agent/apply'
import type { PropChange, StagedChange, ToolName } from '../ai/agent/types'
import { MCP_PROPERTY_TYPES, type McpToolName } from './contract'
import { databaseOrThrow, iconText, kindOf, live, McpToolError, pageUrl, pathOf, propertyJson, q, rowProperties, titleOf, TWO_WAY_SUFFIX, ws } from './values'
import { chars, optionsOf, pageOrThrow, parseIcon, preview, str, type PlanLine, type WritePlan } from './plan'
import { TIDY_PLANNERS } from './tidy'
import { STRUCTURE_PLANNERS } from './structure'

export type { Applied, PlanLine, WritePlan } from './plan'

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const AGENT_NAMES: Record<string, string> = {
  search_pages: 'one_search',
  read_page: 'one_get_page',
  list_databases: 'one_get_database',
  query_database: 'one_query_database',
  get_current_page: 'one_overview',
  create_page: 'one_create_page',
  append_to_page: 'one_update_page',
  create_row: 'one_create_row',
  update_row: 'one_update_row',
  set_page_title: 'one_update_page (title)',
}

/** The agent's messages name its own tools and "staging": speak MCP instead. */
export function mcpMessage(msg: string): string {
  return msg
    .replace(/\b(search_pages|read_page|list_databases|query_database|get_current_page|create_page|append_to_page|create_row|update_row|set_page_title)\b/g, (m) => AGENT_NAMES[m] ?? m)
    .replace(/, or upsert_rows by "[^"]*"/g, '')
    .replace(/Nothing was staged\./g, 'Nothing was changed.')
    .replace(/staged change #\d+ \(([^)]*)\)/g, '$1')
}

/** A private stage per call: the agent's tools put their change here. */
function callStage(): StageApi & { changes: StagedChange[] } {
  const changes: StagedChange[] = []
  return {
    changes,
    list: () => changes,
    add(change) {
      const c: StagedChange = { ...change, id: `m${changes.length + 1}`, n: changes.length + 1, status: 'pending' }
      changes.push(c)
      return c
    },
    update(id, patch) {
      const i = changes.findIndex((c) => c.id === id)
      if (i < 0) throw new Error(`no staged change ${id}`)
      changes[i] = { ...changes[i], ...patch }
      return changes[i]
    },
    resolve: (id) => id,
  }
}

/** Run one agent tool on the stage; its input errors become MCP errors. */
function stageWith(stage: StageApi, name: ToolName, input: Record<string, unknown>) {
  const tool = AGENT_TOOLS.find((x) => x.name === name)
  if (!tool) throw new Error(`agent tool ${name} missing`)
  try {
    const out = tool.run(input, stage)
    // the staging tools answer at once (only run_query / write_script load the script engine)
    if (out instanceof Promise) throw new Error(`agent tool ${name} is not a staging tool`)
    return out
  } catch (e) {
    if (e instanceof ToolInputError) throw new McpToolError(mcpMessage(e.message))
    throw e
  }
}

async function applyStaged(changes: StagedChange[]): Promise<{ rowIds: Record<string, ID>; undo: () => boolean }> {
  if (!changes.length) return { rowIds: {}, undo: () => true }
  const res = await applyChanges(changes, changes, (id) => id)
  if (res.failed.length) {
    res.undo()
    throw new McpToolError(`Nothing was changed: ${res.failed.map((f) => f.error).join('; ')}.`)
  }
  return { rowIds: res.rowIds, undo: () => res.undo().kept.length === 0 }
}

function propLines(props: PropChange[] | undefined, withBefore: boolean): PlanLine[] {
  return (props ?? []).map((p) => ({ k: 'prop', name: p.name, ...(withBefore ? { before: p.before } : {}), after: p.after, ...(p.newOptions?.length ? { fresh: p.newOptions } : {}) }))
}

/** "Name" / "title" in a properties object → the row title. */
function splitTitle(db: Database, raw: unknown): { title: string | null; props: Record<string, unknown> | undefined } {
  if (raw === undefined || raw === null) return { title: null, props: undefined }
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new McpToolError('"properties" must be an object: property name → value.')
  const titleProp = db.properties.find((p) => p.type === 'title')
  let title: string | null = null
  const props: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.trim().toLowerCase()
    if (key === 'title' || (titleProp && (key === titleProp.name.trim().toLowerCase() || k === titleProp.id))) {
      if (v !== null && typeof v !== 'string') throw new McpToolError(`The title (${q(titleProp?.name ?? 'title')}) must be a string.`)
      title = (v ?? '').trim()
      continue
    }
    props[k] = v
  }
  return { title, props }
}

/* ------------------------------------------------------------------ */
/* Pages                                                               */
/* ------------------------------------------------------------------ */

function planCreatePage(args: Record<string, unknown>): WritePlan {
  const title = str(args.title, 'title', { required: true, max: 300 }).replace(/\s+/g, ' ').trim()
  const markdown = str(args.markdown, 'markdown', { max: 200_000 })
  const parentId = str(args.parentId, 'parentId', { max: 80 }).trim()
  const icon = parseIcon(args.icon)
  const stage = callStage()
  stageWith(stage, 'create_page', { title, markdown, ...(parentId ? { parent_id: parentId } : {}) })
  const c = stage.changes[0]
  const parent = c.parentId ? ws().pages[c.parentId] : undefined
  const where = parent ? titleOf(parent) : t('features.mcp.plan.topLevel')
  const lines: PlanLine[] = [{ k: 'fact', label: t('features.mcp.plan.in'), value: parent ? [pathOf(parent.id), titleOf(parent)].filter(Boolean).join(' / ') : where }]
  if (icon) lines.push({ k: 'fact', label: t('features.mcp.plan.icon'), value: iconText(icon) ?? '' })
  if (markdown.trim()) lines.push({ k: 'md', label: t('features.mcp.plan.content', { n: chars(markdown.trim().length) }), value: preview(markdown) })
  return {
    tool: 'one_create_page',
    verb: t('features.mcp.verb.createPage'),
    summary: t('features.mcp.sum.createPage', { title, where }),
    target: title,
    lines,
    async apply() {
      const { undo } = await applyStaged(stage.changes)
      if (icon) ws().updatePage(c.pageId, { icon })
      return { result: { id: c.pageId, title, url: pageUrl(c.pageId), parentId: c.parentId ?? null, path: pathOf(c.pageId) }, undo }
    },
  }
}

function planUpdatePage(args: Record<string, unknown>): WritePlan {
  const page = pageOrThrow(args.id)
  const mode = args.mode === undefined || args.mode === null || args.mode === '' ? 'append' : args.mode
  if (mode !== 'append' && mode !== 'replace') throw new McpToolError('"mode" must be "append" or "replace".')
  const titleRaw = args.title === undefined || args.title === null ? null : str(args.title, 'title', { max: 300 }).replace(/\s+/g, ' ').trim()
  if (titleRaw === '') throw new McpToolError('"title" must not be empty.')
  const markdown = args.markdown === undefined || args.markdown === null ? null : str(args.markdown, 'markdown', { max: 200_000 })
  const icon = parseIcon(args.icon)
  if (titleRaw === null && markdown === null && icon === undefined) throw new McpToolError('Nothing to change: pass "title", "icon" and/or "markdown".')
  if (markdown !== null && page.kind === 'database') throw new McpToolError(`${q(titleOf(page))} is a database: its content is its rows. Use one_create_row.`)
  if (markdown !== null && page.settings.locked) throw new McpToolError(`${q(titleOf(page))} is locked in One. Ask the person to unlock it first.`)
  if (mode === 'append' && markdown !== null && !markdown.trim()) throw new McpToolError('"markdown" is empty: nothing to append.')

  const stage = callStage()
  const lines: PlanLine[] = []
  const changed: string[] = []
  if (titleRaw !== null && titleRaw !== page.title.trim()) {
    stageWith(stage, 'set_page_title', { id: page.id, title: titleRaw })
    lines.push({ k: 'prop', name: t('features.mcp.plan.title'), before: page.title.trim() || t('common.untitled'), after: titleRaw })
    changed.push('title')
  }
  const iconChanged = icon !== undefined && iconText(icon) !== iconText(page.icon)
  if (iconChanged) {
    lines.push({ k: 'prop', name: t('features.mcp.plan.icon'), before: iconText(page.icon) ?? '—', after: iconText(icon) ?? '—' })
    changed.push('icon')
  }
  let replaceWith: JSONContent | null = null
  if (markdown !== null && mode === 'append') {
    stageWith(stage, 'append_to_page', { id: page.id, markdown })
    lines.push({ k: 'md', label: t('features.mcp.plan.append', { n: chars(markdown.trim().length) }), value: preview(markdown) })
    changed.push('content')
  } else if (markdown !== null) {
    replaceWith = markdownToDoc(markdown)
    const before = (page.plain ?? '').length
    lines.push({ k: 'md', label: t('features.mcp.plan.replace', { before: chars(before), after: chars(markdown.trim().length) }), value: preview(markdown) || '—' })
    lines.push({ k: 'note', value: t('features.mcp.plan.historyNote') })
    changed.push('content')
  }
  const name = titleOf(page)
  const result = () => ({ id: page.id, title: ws().pages[page.id]?.title ?? page.title, url: pageUrl(page.id), changed, ...(markdown !== null ? { content: mode } : {}) })
  return {
    tool: 'one_update_page',
    verb: t('features.mcp.verb.updatePage'),
    summary: replaceWith ? t('features.mcp.sum.replacePage', { title: name }) : t('features.mcp.sum.updatePage', { title: name }),
    target: name,
    lines,
    noop: changed.length ? undefined : { id: page.id, title: page.title, url: pageUrl(page.id), changed: [], note: 'No change: the page already looks like that.' },
    async apply() {
      if (!live(page.id)) throw new McpToolError(`${q(name)} is gone (deleted or in the trash). Nothing was changed.`)
      const undos: Array<() => boolean> = []
      const staged = await applyStaged(stage.changes)
      undos.push(staged.undo)
      if (replaceWith) {
        await snapshotNow(page.id, 'ai')
        const prev = ws().pages[page.id]?.content ?? null
        ws().setContent(page.id, replaceWith, 'ai')
        const rev = ws().pages[page.id]?.contentRev
        undos.push(() => {
          const now = ws().pages[page.id]
          if (!now || now.contentRev !== rev) return false
          ws().setContent(page.id, prev, 'ai')
          return true
        })
      }
      if (iconChanged) {
        const prev = ws().pages[page.id]?.icon ?? null
        // the page as it was is kept as an "AI" version first (features/history)
        aiWrite(() => ws().updatePage(page.id, { icon: icon ?? null }))
        undos.push(() => {
          const now = ws().pages[page.id]
          if (!now || iconText(now.icon) !== iconText(icon)) return false
          ws().updatePage(page.id, { icon: prev })
          return true
        })
      }
      return { result: result(), undo: () => undos.reverse().map((u) => u()).every(Boolean) }
    },
  }
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

function planCreateRow(args: Record<string, unknown>): WritePlan {
  const { db, page: dbPage } = databaseOrThrow(args.databaseId)
  const split = splitTitle(db, args.properties)
  const title = (str(args.title, 'title', { max: 300 }) || split.title || '').replace(/\s+/g, ' ').trim()
  if (!title) throw new McpToolError('Missing required parameter "title".')
  const markdown = str(args.markdown, 'markdown', { max: 200_000 })
  const stage = callStage()
  stageWith(stage, 'create_row', { database_id: db.id, title, ...(split.props ? { properties: split.props } : {}), ...(markdown.trim() ? { markdown } : {}) })
  const c = stage.changes[0]
  const dbName = titleOf(dbPage)
  const lines = propLines(c.props, false)
  if (markdown.trim()) lines.push({ k: 'md', label: t('features.mcp.plan.content', { n: chars(markdown.trim().length) }), value: preview(markdown) })
  const first = c.props?.[0]
  return {
    tool: 'one_create_row',
    verb: t('features.mcp.verb.createRow'),
    summary: `${t('features.mcp.sum.createRow', { title, db: dbName })}${first ? ` · ${first.name}: ${first.after}` : ''}`,
    target: dbName,
    lines,
    async apply() {
      const { rowIds, undo } = await applyStaged(stage.changes)
      const id = rowIds[c.pageId] ?? c.pageId
      const row = ws().pages[id]
      const live = ws().databases[db.id]
      return { result: { id, databaseId: db.id, title, url: pageUrl(id), properties: row && live ? rowProperties(live, row) : {} }, undo }
    },
  }
}

function planUpdateRow(args: Record<string, unknown>): WritePlan {
  const row = pageOrThrow(args.id)
  if (!row.databaseId) throw new McpToolError(`${q(titleOf(row))} is a ${kindOf(row)}, not a database row. Use one_update_page for pages.`)
  const { db, page: dbPage } = databaseOrThrow(row.databaseId)
  if (!args.properties || typeof args.properties !== 'object' || Array.isArray(args.properties) || !Object.keys(args.properties).length)
    throw new McpToolError('"properties" must name at least one property to change.')
  const split = splitTitle(db, args.properties)
  if (split.title === '') throw new McpToolError('The title must not be empty.')
  const stage = callStage()
  const lines: PlanLine[] = []
  if (split.title && split.title !== row.title.trim()) {
    stageWith(stage, 'set_page_title', { id: row.id, title: split.title })
    lines.push({ k: 'prop', name: db.properties.find((p) => p.type === 'title')?.name ?? t('features.mcp.plan.title'), before: row.title.trim() || t('common.untitled'), after: split.title })
  }
  if (split.props && Object.keys(split.props).length) {
    stageWith(stage, 'update_row', { id: row.id, properties: split.props })
    lines.push(...propLines(stage.changes.find((c) => c.kind === 'update_row')?.props, true))
  }
  const name = titleOf(row)
  const dbName = titleOf(dbPage)
  const result = () => {
    const now = ws().pages[row.id]
    const d = ws().databases[db.id]
    return { id: row.id, databaseId: db.id, title: now?.title ?? row.title, url: pageUrl(row.id), properties: now && d ? rowProperties(d, now) : {} }
  }
  return {
    tool: 'one_update_row',
    verb: t('features.mcp.verb.updateRow'),
    summary: t('features.mcp.sum.updateRow', { title: name, db: dbName }),
    target: `${dbName} / ${name}`,
    lines,
    noop: stage.changes.length ? undefined : { ...result(), note: 'No change: the row already has these values.' },
    async apply() {
      const { undo } = await applyStaged(stage.changes)
      return { result: result(), undo }
    },
  }
}

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

interface PropSpec {
  def: PropertyDef
  /** two-way relation: the reverse property to add on the target database */
  reverse?: { dbId: ID; def: PropertyDef }
  lines: PlanLine[]
}

/** Validate one property spec (create_property, create_database) for a database (existing or new). */
function propertySpec(raw: unknown, ctx: { dbId: ID; dbTitle: string; taken: string[] }, key = 'property'): PropSpec {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null) as Record<string, unknown> | null
  if (!o) throw new McpToolError(`${key} must be an object {name, type, options?, relation?}.`)
  const name = str(o.name, `${key}.name`, { required: true, max: 100 }).replace(/\s+/g, ' ').trim()
  if (ctx.taken.some((n) => n.toLowerCase() === name.toLowerCase())) throw new McpToolError(`${key}: a property named ${q(name)} already exists.`)
  const type = String(o.type ?? '') as PropertyType
  if (!(MCP_PROPERTY_TYPES as readonly string[]).includes(type)) throw new McpToolError(`${key}: unknown type ${q(String(o.type ?? ''))}. Use one of: ${MCP_PROPERTY_TYPES.join(', ')}.`)
  const def: PropertyDef = { id: newId(), name, type }
  const options = optionsOf(type, o.options, key)
  if (options) def.options = options
  const lines: PlanLine[] = [{ k: 'fact', label: t('features.mcp.plan.type'), value: type }]
  if (options?.length) lines.push({ k: 'fact', label: t('features.mcp.plan.options'), value: options.map((x) => x.name).join(', ') })
  let reverse: PropSpec['reverse']
  if (type === 'relation') {
    const rel = (o.relation && typeof o.relation === 'object' && !Array.isArray(o.relation) ? o.relation : null) as Record<string, unknown> | null
    if (!rel) throw new McpToolError(`${key}: a relation needs "relation": {"databaseId": …}.`)
    const self = str(rel.databaseId, `${key}.relation.databaseId`, { required: true, max: 80 }).trim() === ctx.dbId
    const target = self ? null : databaseOrThrow(rel.databaseId)
    const targetId = self ? ctx.dbId : target!.db.id
    const targetTitle = self ? ctx.dbTitle : titleOf(target!.page)
    def.relationDatabaseId = targetId
    lines.push({ k: 'fact', label: t('features.mcp.plan.relation'), value: targetTitle })
    if (rel.twoWay === true) {
      if (target?.db.locked) throw new McpToolError(`${key}: ${q(targetTitle)} is locked, so no reverse property can be added there. Create a one-way relation instead.`)
      const reverseName = str(rel.reverseName, `${key}.relation.reverseName`, { max: 100 }).trim() || (self ? t('database.relation.reverseName', { name }) : ctx.dbTitle)
      if (!self && target!.db.properties.some((p) => p.name.toLowerCase() === reverseName.toLowerCase()))
        throw new McpToolError(`${key}: ${q(targetTitle)} already has a property named ${q(reverseName)}. Pass another "reverseName".`)
      reverse = { dbId: targetId, def: { id: def.id + TWO_WAY_SUFFIX, name: reverseName, type: 'relation', relationDatabaseId: ctx.dbId } }
      lines.push({ k: 'fact', label: t('features.mcp.plan.twoWay'), value: `${targetTitle} · ${reverseName}` })
    }
  } else if (o.relation !== undefined) throw new McpToolError(`${key}: "relation" only applies to type "relation".`)
  return { def, reverse, lines }
}

/** Add properties (and the reverse sides of two-way relations); returns the undo. */
function addProperties(dbId: ID, specs: PropSpec[]): () => boolean {
  const added: Array<{ dbId: ID; id: ID }> = []
  for (const s of specs) {
    ws().addProperty(dbId, s.def)
    added.push({ dbId, id: s.def.id })
    if (s.reverse && ws().databases[s.reverse.dbId]) {
      ws().addProperty(s.reverse.dbId, s.reverse.def)
      added.push({ dbId: s.reverse.dbId, id: s.reverse.def.id })
    }
  }
  return () => {
    for (const a of added.reverse()) if (ws().databases[a.dbId]?.properties.some((p) => p.id === a.id)) ws().deleteProperty(a.dbId, a.id)
    return true
  }
}

function planCreateProperty(args: Record<string, unknown>): WritePlan {
  const { db, page } = databaseOrThrow(args.databaseId)
  const dbTitle = titleOf(page)
  if (db.locked) throw new McpToolError(`${q(dbTitle)} is locked in One: its properties cannot change. Ask the person to unlock it.`)
  const spec = propertySpec(args, { dbId: db.id, dbTitle, taken: db.properties.map((p) => p.name) }, 'property')
  return {
    tool: 'one_create_property',
    verb: t('features.mcp.verb.createProperty'),
    summary: t('features.mcp.sum.createProperty', { name: spec.def.name, db: dbTitle }),
    target: dbTitle,
    lines: spec.lines,
    async apply() {
      const now = ws().databases[db.id]
      if (!now || !live(db.id)) throw new McpToolError(`${q(dbTitle)} is gone. Nothing was changed.`)
      if (now.properties.some((p) => p.name.toLowerCase() === spec.def.name.toLowerCase())) throw new McpToolError(`A property named ${q(spec.def.name)} exists by now. Nothing was changed.`)
      const undo = addProperties(db.id, [spec])
      const d = ws().databases[db.id]
      const prop = d.properties.find((p) => p.id === spec.def.id)!
      const back = spec.reverse && ws().databases[spec.reverse.dbId]
      const backProp = back ? back.properties.find((p) => p.id === spec.reverse!.def.id) : undefined
      return { result: { databaseId: db.id, property: propertyJson(d, prop), ...(back && backProp ? { reverse: { databaseId: back.id, property: propertyJson(back, backProp) } } : {}) }, undo }
    },
  }
}

function planCreateDatabase(args: Record<string, unknown>): WritePlan {
  const title = str(args.title, 'title', { required: true, max: 300 }).replace(/\s+/g, ' ').trim()
  const parentRaw = str(args.parentId, 'parentId', { max: 80 }).trim()
  const parent = parentRaw ? pageOrThrow(parentRaw, 'parentId') : null
  if (parent?.kind === 'database') throw new McpToolError(`${q(titleOf(parent))} is a database; a database goes under a page.`)
  const id = newId()
  const raw = args.properties
  if (raw !== undefined && raw !== null && !Array.isArray(raw)) throw new McpToolError('"properties" must be a list of {name, type, options?, relation?}.')
  if (Array.isArray(raw) && raw.length > 40) throw new McpToolError('At most 40 properties.')
  // a { type: "title" } entry names the title property (default "Name")
  const titleSpecs = Array.isArray(raw) ? raw.filter((r) => r && typeof r === 'object' && (r as { type?: unknown }).type === 'title') : []
  if (titleSpecs.length > 1) throw new McpToolError('Only one property can be of type "title".')
  const titleName = titleSpecs.length ? str((titleSpecs[0] as { name?: unknown }).name, 'properties[title].name', { required: true, max: 100 }).replace(/\s+/g, ' ').trim() : 'Name'
  const taken = [titleName]
  const specs = Array.isArray(raw)
    ? raw
        .filter((r) => !titleSpecs.includes(r))
        .map((r, i) => {
          const s = propertySpec(r, { dbId: id, dbTitle: title, taken }, `properties[${i}]`)
          taken.push(s.def.name)
          return s
        })
    : null
  const where = parent ? titleOf(parent) : t('features.mcp.plan.topLevel')
  const lines: PlanLine[] = [{ k: 'fact', label: t('features.mcp.plan.in'), value: parent ? [pathOf(parent.id), titleOf(parent)].filter(Boolean).join(' / ') : where }]
  lines.push({ k: 'fact', label: t('features.mcp.plan.properties'), value: specs ? [titleName, ...specs.map((s) => `${s.def.name} (${s.def.type})`)].join(', ') : t('features.mcp.plan.defaultProps') })
  return {
    tool: 'one_create_database',
    verb: t('features.mcp.verb.createDatabase'),
    summary: t('features.mcp.sum.createDatabase', { title, where }),
    target: title,
    lines,
    async apply() {
      if (parent && !live(parent.id)) throw new McpToolError(`${q(titleOf(parent))} is gone. Nothing was changed.`)
      const titleProp: PropertyDef = { id: newId(), name: titleName, type: 'title' }
      ws().createDatabase({ id, title, parentId: parent?.id ?? null, ...(specs ? { properties: [titleProp, ...specs.map((s) => s.def)] } : {}) })
      // the reverse sides of two-way relations live on the related databases
      const reverses = (specs ?? []).flatMap((s) => (s.reverse && ws().databases[s.reverse.dbId] ? [s.reverse] : []))
      for (const r of reverses) ws().addProperty(r.dbId, r.def)
      const rev = ws().pages[id]?.contentRev
      const d = ws().databases[id]
      return {
        result: {
          id,
          title,
          url: pageUrl(id),
          parentId: parent?.id ?? null,
          properties: d.properties.map((p) => propertyJson(d, p)),
          ...(reverses.length ? { reverse: reverses.map((r) => ({ databaseId: r.dbId, property: r.def.name })) } : {}),
        },
        undo: () => {
          for (const r of reverses) if (ws().databases[r.dbId]?.properties.some((p) => p.id === r.def.id)) ws().deleteProperty(r.dbId, r.def.id)
          const now = ws().pages[id]
          if (!now) return true
          // rows or sub-pages added since: keep them recoverable
          const touched = now.contentRev !== rev || Object.values(ws().pages).some((p) => p.parentId === id)
          if (touched) ws().trashPage(id)
          else ws().deletePagePermanently(id)
          return true
        },
      }
    },
  }
}

/* ------------------------------------------------------------------ */

const PLANNERS: Partial<Record<McpToolName, (args: Record<string, unknown>) => WritePlan>> = {
  one_create_page: planCreatePage,
  one_update_page: planUpdatePage,
  one_create_row: planCreateRow,
  one_update_row: planUpdateRow,
  one_create_property: planCreateProperty,
  one_create_database: planCreateDatabase,
  ...STRUCTURE_PLANNERS,
  ...TIDY_PLANNERS,
}

/** Validate a write call and describe it. Throws McpToolError (nothing written). */
export function planWrite(tool: McpToolName, args: Record<string, unknown>): WritePlan {
  const planner = PLANNERS[tool]
  if (!planner) throw new McpToolError(`${tool} is not a writing tool.`)
  return planner(args)
}
