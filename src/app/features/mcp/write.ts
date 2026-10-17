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
import { claudeSettled } from '../ai/claudeDoc'
import { webImagesOf } from '../agents/images'
import { newId } from '../../lib/ids'
import { t } from '../../i18n'
import type { Database, ID, PropertyDef, PropertyType } from '../../store/types'
import { inTemplate, isEffectivelyTrashed } from '../../store/selectors'
import { aiWrite, contentKey, snapshotNow } from '../history/snapshots'
import { pagePrivate, registerItems, stageBlocks, type ItemStaging } from '../ai/agent/workItems'
import type { PropChange } from '../ai/agent/types'
import { getItemIndex, SettleRefusal, type SettleReport } from '../workitems'
import { holdsOfReport } from '../workitems/holds'
import { applyStaged, assertStageWritable, callStage, itemLine, itemPlan, mcpMessage, stageWith } from './stage'
import { assertNotSystem } from './system'
import { privateRefsFor, privateScopeRefusal } from '../ai/claudeFiles'
import { livePage, withPageNodes, type LinkTarget } from '../ai/agent/links'
import { MCP_PROPERTY_TYPES, type McpToolName } from './contract'
import { databaseOrThrow, iconText, kindOf, live, McpToolError, pageUrl, pathOf, propertyJson, q, rowProperties, titleOf, TWO_WAY_SUFFIX, ws } from './values'
import { chars, optionsOf, pageOrThrow, parseIcon, preview, str, type PlanLine, type WritePlan } from './plan'
import { TIDY_PLANNERS } from './tidy'
import { STRUCTURE_PLANNERS } from './structure'
import { withWriter, type Writer } from '../../store/writer'

export type { Applied, PlanLine, WritePlan } from './plan'
export { mcpMessage } from './stage'
import { planUpdateWorkItems } from './workItems'

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** The new tasks of a write, for its result (Claude uses these ids in later calls). */
const tasksOf = (created: Array<{ id: string; title: string; handle?: string }>) => (created.length ? { tasks: created } : {})

/**
 * Private files may not go into a shared page (spec § 3.3): a shared write would publish them for the whole workspace.
 * `private`: the target's privacy (team; locally nothing is private).
 */
function checkFileScope(markdown: string, targetPrivate: boolean, target: string): void {
  if (!markdown.includes('onefile:')) return
  const refs = privateRefsFor(markdown, targetPrivate)
  if (refs.length) throw new McpToolError(privateScopeRefusal(refs, target))
}

/** A page a replace may turn a link into a mention / page link block for: live, never a template's. */
const linkTarget = (id: ID): LinkTarget | null => (inTemplate(ws().pages, id) ? null : livePage(id))

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
  checkFileScope(markdown, parent ? pagePrivate(parent.id) : false, q(title))
  const where = parent ? titleOf(parent) : t('features.mcp.plan.topLevel')
  const lines: PlanLine[] = [{ k: 'fact', label: t('features.mcp.plan.in'), value: parent ? [pathOf(parent.id), titleOf(parent)].filter(Boolean).join(' / ') : where }]
  if (icon) lines.push({ k: 'fact', label: t('features.mcp.plan.icon'), value: iconText(icon) ?? '' })
  if (markdown.trim()) lines.push({ k: 'md', label: t('features.mcp.plan.content', { n: chars(markdown.trim().length) }), value: preview(markdown) })
  // the tasks its text makes (and a folded Blocks: onto existing ones) — a change that holds waits for approval
  const items = itemPlan(stage.changes)
  lines.push(...items.lines)
  return {
    tool: 'one_create_page',
    verb: t('features.mcp.verb.createPage'),
    summary: t('features.mcp.sum.createPage', { title, where }),
    target: title,
    lines,
    ...(items.holds.length ? { alwaysAsk: true } : {}),
    async apply(writer) {
      const { undo } = await applyStaged(stage.changes, writer)
      if (icon) withWriter(writer, () => ws().updatePage(c.pageId, { icon }))
      return { result: { id: c.pageId, title, url: pageUrl(c.pageId), parentId: c.parentId ?? null, path: pathOf(c.pageId), ...tasksOf(items.created) }, undo }
    },
  }
}

function planUpdatePage(args: Record<string, unknown>): WritePlan {
  const page = pageOrThrow(args.id)
  // One's own databases (a pipeline task, a memory, a mail …): read-only over MCP — title and icon too
  assertNotSystem(page.id)
  const mode = args.mode === undefined || args.mode === null || args.mode === '' ? 'append' : args.mode
  if (mode !== 'append' && mode !== 'replace') throw new McpToolError('"mode" must be "append" or "replace".')
  const titleRaw = args.title === undefined || args.title === null ? null : str(args.title, 'title', { max: 300 }).replace(/\s+/g, ' ').trim()
  if (titleRaw === '') throw new McpToolError('"title" must not be empty.')
  const markdown = args.markdown === undefined || args.markdown === null ? null : str(args.markdown, 'markdown', { max: 200_000 })
  const icon = parseIcon(args.icon)
  if (titleRaw === null && markdown === null && icon === undefined) throw new McpToolError('Nothing to change: pass "title", "icon" and/or "markdown".')
  if (markdown !== null && page.kind === 'database') throw new McpToolError(`${q(titleOf(page))} is a database: its content is its rows. Use one_create_row.`)
  if (markdown !== null && page.settings.locked) throw new McpToolError(`locked: ${q(titleOf(page))} is locked in One: its content cannot change (its title and icon can). Nothing was changed. Ask the person to unlock it.`)
  if (mode === 'append' && markdown !== null && !markdown.trim()) throw new McpToolError('"markdown" is empty: nothing to append.')
  if (markdown !== null) checkFileScope(markdown, pagePrivate(page.id), q(titleOf(page)))

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
  let replaced: SettleReport | null = null
  const rev = page.contentRev
  const name = titleOf(page)
  if (markdown !== null && mode === 'append') {
    stageWith(stage, 'append_to_page', { id: page.id, markdown })
    lines.push({ k: 'md', label: t('features.mcp.plan.append', { n: chars(markdown.trim().length) }), value: preview(markdown) })
    changed.push('content')
  } else if (markdown !== null) {
    // Claude's Markdown through the settle gate (features/ai/claudeDoc.ts): web images become links, raw-HTML mentions
    // text; the page's tasks written back as `> [!TODO] … {#wi_…}` stay those tasks (fields as they are), new quotes
    // become tasks with ids minted now — what the card shows is what is written
    const priv = pagePrivate(page.id)
    try {
      const settled = claudeSettled(markdown, webImagesOf(page.content), { source: 'mcp', creates: true, strict: true, known: page.content, pageId: page.id, private: priv, me: true, existing: 'copy', handles: stage.items.handles, staged: stage.items.staged })
      // page links come back as what a person makes (agent/links.ts — as the terminal's and an append's writes)
      replaceWith = withPageNodes(settled.doc, linkTarget)
      replaced = settled.report
    } catch (e) {
      if (e instanceof SettleRefusal) throw new McpToolError(mcpMessage(`${e.message} Nothing was changed.`))
      throw e
    }
    // the replace is no staged change: its new tasks are the call's own (a folded update may link them)
    const staging: ItemStaging = { items: undefined, lines: [], blocks: replaced.blocks, needs: [], report: replaced, target: { pageId: page.id, private: priv } }
    registerItems(stage.items, '', staging)
    for (const id of replaced.ids) stage.items.staged.set(id, { change: null, private: priv, pageId: page.id })
    const before = (page.plain ?? '').length
    lines.push({ k: 'md', label: t('features.mcp.plan.replace', { before: chars(before), after: chars(markdown.trim().length) }), value: preview(markdown) || '—' })
    const ignored = new Set(replaced.fieldsIgnored)
    for (const f of [...replaced.created, ...replaced.kept, ...replaced.removed]) lines.push(itemLine(f, f.tag === 'kept' && ignored.has(f.title) ? t('features.workItems.settle.fields', { task: f.title, value: '' }) : undefined))
    for (const w of replaced.warnings) if (w.code !== 'fields') lines.push({ k: 'note', value: t(`features.workItems.settle.${w.code}`, { value: w.value ?? '', task: w.task }) })
    // Blocks: onto existing tasks — folded into this call (same card, same approval), applied after the replace
    stageBlocks(stage, { id: '', n: 0, kind: 'append', status: 'pending', pageId: page.id }, staging)
    // a folded change onto a task that lives in One's own databases: refused like a direct one
    assertStageWritable(stage.changes)
    lines.push({ k: 'note', value: t('features.mcp.plan.historyNote') })
    changed.push('content')
  }
  // the replace's holds with the staged changes' (one "Always asked" line)
  const items = itemPlan(stage.changes, replaced ? holdsOfReport(replaced) : [])
  lines.push(...items.lines)
  const holds = items.holds
  const created = [...(replaced?.created.map((f) => ({ id: f.itemId, title: f.title, ...(f.handle ? { handle: f.handle } : {}) })) ?? []), ...items.created]
  const result = () => ({ id: page.id, title: ws().pages[page.id]?.title ?? page.title, url: pageUrl(page.id), changed, ...(markdown !== null ? { content: mode } : {}), ...tasksOf(created) })
  return {
    tool: 'one_update_page',
    verb: t('features.mcp.verb.updatePage'),
    summary: replaceWith ? t('features.mcp.sum.replacePage', { title: name }) : t('features.mcp.sum.updatePage', { title: name }),
    target: name,
    lines,
    ...(holds.length ? { alwaysAsk: true } : {}),
    noop: changed.length ? undefined : { id: page.id, title: page.title, url: pageUrl(page.id), changed: [], note: 'No change: the page already looks like that.' },
    async apply(writer) {
      if (!live(page.id)) throw new McpToolError(`${q(name)} is gone (deleted or in the trash). Nothing was changed.`)
      const undos: Array<() => boolean> = []
      if (replaceWith) {
        // the page changed while the call waited for approval (typed into, synced), or one of its new ids is taken by
        // now: nothing is replaced — the client reads it again and calls again
        const taken = replaced?.ids.some((id) => getItemIndex().everywhere.has(id))
        if (ws().pages[page.id]?.contentRev !== rev || taken) throw new McpToolError(`${q(name)} changed while this call waited. Nothing was changed. Read it again with one_get_page and call again.`)
        // the replace FIRST (its new tasks exist before a folded change links them), then the rest; one rollback
        await snapshotNow(page.id, 'ai')
        const prev = ws().pages[page.id]?.content ?? null
        withWriter(writer, () => ws().setContent(page.id, replaceWith!, 'ai'))
        const after = ws().pages[page.id]?.contentRev
        const afterKey = contentKey(ws().pages[page.id]?.content)
        undos.push(() => {
          const now = ws().pages[page.id]
          // untouched since: the same revision, or the same content (a folded task change of this page undone first
          // writes it back — a new revision of the replaced text)
          if (!now || (now.contentRev !== after && contentKey(now.content) !== afterKey)) return false
          ws().setContent(page.id, prev, 'ai')
          return true
        })
        try {
          const staged = await applyStaged(stage.changes, writer)
          undos.push(staged.undo)
        } catch (e) {
          withWriter(writer, () => ws().setContent(page.id, prev, 'ai'))
          throw e
        }
      } else {
        const staged = await applyStaged(stage.changes, writer)
        undos.push(staged.undo)
      }
      if (iconChanged) {
        const prev = ws().pages[page.id]?.icon ?? null
        // the page as it was is kept as an "AI" version first (features/history)
        withWriter(writer, () => aiWrite(() => ws().updatePage(page.id, { icon: icon ?? null })))
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
  assertNotSystem(db.id)
  const split = splitTitle(db, args.properties)
  const title = (str(args.title, 'title', { max: 300 }) || split.title || '').replace(/\s+/g, ' ').trim()
  if (!title) throw new McpToolError('Missing required parameter "title".')
  const markdown = str(args.markdown, 'markdown', { max: 200_000 })
  checkFileScope(markdown, pagePrivate(db.id), q(title))
  const stage = callStage()
  stageWith(stage, 'create_row', { database_id: db.id, title, ...(split.props ? { properties: split.props } : {}), ...(markdown.trim() ? { markdown } : {}) })
  const c = stage.changes[0]
  const dbName = titleOf(dbPage)
  const lines = propLines(c.props, false)
  if (markdown.trim()) lines.push({ k: 'md', label: t('features.mcp.plan.content', { n: chars(markdown.trim().length) }), value: preview(markdown) })
  const first = c.props?.[0]
  const items = itemPlan(stage.changes)
  lines.push(...items.lines)
  return {
    tool: 'one_create_row',
    verb: t('features.mcp.verb.createRow'),
    summary: `${t('features.mcp.sum.createRow', { title, db: dbName })}${first ? ` · ${first.name}: ${first.after}` : ''}`,
    target: dbName,
    lines,
    ...(items.holds.length ? { alwaysAsk: true } : {}),
    async apply(writer) {
      const { rowIds, undo } = await applyStaged(stage.changes, writer)
      const id = rowIds[c.pageId] ?? c.pageId
      const row = ws().pages[id]
      const live = ws().databases[db.id]
      return { result: { id, databaseId: db.id, title, url: pageUrl(id), properties: row && live ? rowProperties(live, row) : {}, ...tasksOf(items.created) }, undo }
    },
  }
}

function planUpdateRow(args: Record<string, unknown>): WritePlan {
  const row = pageOrThrow(args.id)
  if (!row.databaseId) throw new McpToolError(`${q(titleOf(row))} is a ${kindOf(row)}, not a database row. Use one_update_page for pages.`)
  const { db, page: dbPage } = databaseOrThrow(row.databaseId)
  assertNotSystem(row.id)
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
    async apply(writer) {
      const { undo } = await applyStaged(stage.changes, writer)
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
  assertNotSystem(db.id)
  const dbTitle = titleOf(page)
  if (db.locked) throw new McpToolError(`locked: ${q(dbTitle)} is locked in One: its properties cannot change. Nothing was changed. Ask the person to unlock it.`)
  const spec = propertySpec(args, { dbId: db.id, dbTitle, taken: db.properties.map((p) => p.name) }, 'property')
  return {
    tool: 'one_create_property',
    verb: t('features.mcp.verb.createProperty'),
    summary: t('features.mcp.sum.createProperty', { name: spec.def.name, db: dbTitle }),
    target: dbTitle,
    lines: spec.lines,
    async apply(writer) {
      const now = ws().databases[db.id]
      if (!now || !live(db.id)) throw new McpToolError(`${q(dbTitle)} is gone. Nothing was changed.`)
      if (now.properties.some((p) => p.name.toLowerCase() === spec.def.name.toLowerCase())) throw new McpToolError(`A property named ${q(spec.def.name)} exists by now. Nothing was changed.`)
      const undo = withWriter(writer, () => addProperties(db.id, [spec]))
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
  // nothing new below a row of One's own databases
  if (parent) assertNotSystem(parent.id)
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
    async apply(writer) {
      if (parent && !live(parent.id)) throw new McpToolError(`${q(titleOf(parent))} is gone. Nothing was changed.`)
      const titleProp: PropertyDef = { id: newId(), name: titleName, type: 'title' }
      // the reverse sides of two-way relations live on the related databases
      const reverses = withWriter(writer, () => {
        ws().createDatabase({ id, title, parentId: parent?.id ?? null, ...(specs ? { properties: [titleProp, ...specs.map((s) => s.def)] } : {}) })
        const back = (specs ?? []).flatMap((s) => (s.reverse && ws().databases[s.reverse.dbId] ? [s.reverse] : []))
        for (const r of back) ws().addProperty(r.dbId, r.def)
        return back
      })
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
          const { pages } = ws()
          const now = pages[id]
          // in the trash already (the person put it there): it stays there, never deleted for good
          if (!now || now.trashed) return true
          // rows or sub-pages added since, or a page above it in the trash: keep it recoverable
          const touched = now.contentRev !== rev || isEffectivelyTrashed(pages, id) || Object.values(pages).some((p) => p.parentId === id)
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
  one_update_work_item: planUpdateWorkItems,
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
