/**
 * One MCP — one_create_database (spec § 2.3), the ONLY tool that makes a database: a full-page one under a page
 * (`parentId`, the usual "sub-page with a board") or one inside a page's text (`inline`: a database block at the end or
 * after a block); its icon, properties (≤ 40), views (1–5, validated like one_create_view) and rows (≤ 50, coerced like
 * one_create_row) in ONE call — one card, one Undo. A board with nothing to group by gets a Status property; a table
 * view follows a first view that is not one (the rows stay editable in a grid) — `note` says what was added.
 */
import type { JSONContent } from '@tiptap/core'
import { t } from '../../i18n'
import { newId } from '../../lib/ids'
import type { Database, ID, Page, PropertyDef, View, ViewType } from '../../store/types'
import { defaultStatusOptions, defaultView } from '../../store/store'
import { contentKey, snapshotNow } from '../history/snapshots'
import { coerceProperties, withFilesWritable } from '../ai/agent/props'
import { ToolInputError, withToolScope } from '../ai/agent/tools'
import { commitItems, pagePrivate, stageItems } from '../ai/agent/workItems'
import { blockHash, idsFor, parseRef, stripRefLabels, type PMJson } from '../../../shared/mcp/refs'
import { refIndex } from '../../../shared/mcp/pageRead'
import { mcpError } from '../../../shared/mcp/errors'
import { MCP_LIMITS, MCP_VIEW_TYPES } from '../../../shared/mcp/tables'
import { applyStaged, assertStageWritable, callStage, itemPlan, mcpMessage, outsideTemplates } from './stage'
import { assertNotSystem } from './system'
import { iconText, live, McpToolError, pageUrl, pathOf, propertyJson, q, titleOf, ws } from './values'
import { atPath, chars, checkFileScope, cleanName, pageOrThrow, parseIcon, str, tasksOf, type PlanLine, type WritePlan } from './plan'
import { propertySpec } from './schema'
import { checkFiles, splitTitle } from './rows'
import { layoutName, viewChange } from './structure'
import { withWriter } from '../../store/writer'

/** What a board groups by when the call names nothing (spec § 2.3): the first of these types. */
const GROUPABLE: PropertyDef['type'][] = ['status', 'select', 'multi_select', 'person', 'checkbox']

const isEmptyDoc = (doc: JSONContent | null | undefined) => (doc?.content ?? []).every((b) => b.type === 'paragraph' && !(b.content ?? []).length)

/**
 * A top-level block of a page by the ref a client passes (`#<id prefix>~<h>` or `@<index>~<h>` from one_get_page, spec
 * § 2.1) → its index. With the content hash `~h` (as reads hand refs out) the block must still hold what was read — a
 * block changed since is `stale_ref` with the ref it has now; without one the block found is the block, whatever it holds.
 */
function blockIndex(page: Page, raw: unknown, path: string): number {
  const ref = parseRef(raw)
  if (!ref) throw new McpToolError(mcpError('bad_argument', path, `${q(String(raw).slice(0, 60))} is no block ref ("#<id>~<hash>" or "@<index>" from one_get_page)`))
  const blocks = page.content?.content ?? []
  // the block must still hold what the read saw (when the ref carries its content hash)
  const unchanged = (i: number): number => {
    if (ref.hash && blockHash(blocks[i] as PMJson) !== ref.hash)
      throw new McpToolError(mcpError('stale_ref', path, `${q(String(raw))} changed since the read (it is ${refNow(page.content, i)} now)`, 'Read the page again (one_get_page { format: "blocks" }) and pass the block\'s ref from there.'))
    return i
  }
  if (ref.kind === 'path') {
    if (ref.path.length !== 1 || ref.path[0]! >= blocks.length) throw new McpToolError(mcpError('stale_ref', path, `${q(String(raw))} is no top-level block of ${q(titleOf(page))} now`))
    return unchanged(ref.path[0]!)
  }
  const ids = blocks.map((b) => (typeof b.attrs?.id === 'string' ? b.attrs.id : '')).filter(Boolean)
  const hit = idsFor(ref.prefix, ids)
  if (hit.length !== 1) throw new McpToolError(mcpError('stale_ref', path, hit.length ? `${q(String(raw))} fits ${hit.length} blocks` : `no top-level block of ${q(titleOf(page))} has the id ${q(ref.prefix)} now`))
  return unchanged(blocks.findIndex((b) => b.attrs?.id === hit[0]))
}

/** The ref a top-level block of a page has now (as one_get_page hands it out). */
const refNow = (doc: JSONContent | null | undefined, index: number): string | null => {
  const node = doc?.content?.[index]
  return node ? refIndex(doc as PMJson).refOf(node as PMJson, [index]) : null
}

/** The new database block's ref in its page (a full ref, as a read would hand it out). */
function blockRef(pageId: ID, blockId: string | null): string {
  const doc = ws().pages[pageId]?.content
  const i = (doc?.content ?? []).findIndex((b) => b.attrs?.id === blockId)
  return (i >= 0 ? refNow(doc, i) : null) ?? `#${blockId}`
}

/** The properties a database gets when the call gives none (the store's default schema, its words in the UI language). */
function defaultProps(): PropertyDef[] {
  const de = ws().settings.language === 'de'
  return [
    { id: newId(), name: 'Name', type: 'title' },
    { id: newId(), name: 'Status', type: 'status', options: defaultStatusOptions() },
    { id: newId(), name: 'Tags', type: 'multi_select', options: [] },
    { id: newId(), name: de ? 'Datum' : 'Date', type: 'date' },
  ]
}

export function planCreateDatabase(args: Record<string, unknown>): WritePlan {
  const title = str(args.title, 'title', { required: true, max: 300 }).replace(/\s+/g, ' ').trim()
  if (!title) throw new McpToolError(mcpError('bad_argument', 'title', 'a database needs a title'))
  const parentRaw = str(args.parentId, 'parentId', { max: 80 }).trim()
  const inlineRaw = args.inline
  if (parentRaw && inlineRaw !== undefined && inlineRaw !== null) throw new McpToolError(mcpError('bad_argument', 'inline', 'pass parentId (a full-page database) or inline (inside a page\'s text), not both'))

  // where it goes: under a page, or into a page's text (the page is its parent then, as the app's inline databases)
  let parent: Page | null = null
  let inline: { at: number | null } | null = null
  const wherePath = inlineRaw !== undefined && inlineRaw !== null ? 'inline.pageId' : 'parentId'
  if (inlineRaw !== undefined && inlineRaw !== null) {
    if (typeof inlineRaw !== 'object' || Array.isArray(inlineRaw)) throw new McpToolError(mcpError('bad_argument', 'inline', 'an object {pageId, afterBlock?} is expected'))
    const o = inlineRaw as Record<string, unknown>
    const extra = Object.keys(o).find((k) => k !== 'pageId' && k !== 'afterBlock')
    if (extra) throw new McpToolError(mcpError('bad_argument', `inline.${extra}`, 'inline takes pageId and afterBlock'))
    try {
      parent = pageOrThrow(o.pageId, 'inline.pageId')
      assertNotSystem(parent.id)
    } catch (e) {
      atPath(e, 'inline.pageId')
    }
    if (parent.kind === 'database') throw new McpToolError(mcpError('bad_argument', 'inline.pageId', `${q(titleOf(parent))} is a database: it has no text to hold another one`))
    if (parent.settings.locked) throw new McpToolError(mcpError('locked', 'inline.pageId', `${q(titleOf(parent))} is locked in One: nothing can go into its text`))
    inline = { at: o.afterBlock === undefined || o.afterBlock === null || o.afterBlock === '' ? null : blockIndex(parent, o.afterBlock, 'inline.afterBlock') }
  } else if (parentRaw) {
    try {
      parent = pageOrThrow(parentRaw, 'parentId')
      // nothing new below a row of One's own databases
      assertNotSystem(parent.id)
    } catch (e) {
      atPath(e, 'parentId')
    }
    if (parent.kind === 'database') throw new McpToolError(mcpError('bad_argument', 'parentId', `${q(titleOf(parent))} is a database; a database goes under a page`))
  }
  const icon = parseIcon(args.icon)
  const id = newId()

  // the schema
  const raw = args.properties
  if (raw !== undefined && raw !== null && !Array.isArray(raw)) throw new McpToolError(mcpError('bad_argument', 'properties', 'a list of {name, type, options?, relation?} is expected'))
  if (Array.isArray(raw) && raw.length > MCP_LIMITS.properties) throw new McpToolError(mcpError('too_large', 'properties', `at most ${MCP_LIMITS.properties} properties (got ${raw.length})`))
  // a { type: "title" } entry names the title property (default "Name")
  const titleSpecs = Array.isArray(raw) ? raw.filter((r) => r && typeof r === 'object' && (r as { type?: unknown }).type === 'title') : []
  if (titleSpecs.length > 1) throw new McpToolError(mcpError('bad_argument', 'properties', 'only one property can be of type "title"'))
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
  const props: PropertyDef[] = specs ? [{ id: newId(), name: titleName, type: 'title' }, ...specs.map((s) => s.def)] : defaultProps()
  const notes: string[] = []
  const cardNotes: string[] = []

  // the views: a board groups by what the call names or the first groupable property — none: a Status is added
  let views: View[] | null = null
  if (args.views !== undefined && args.views !== null) {
    if (!Array.isArray(args.views) || !args.views.length) throw new McpToolError(mcpError('bad_argument', 'views', 'a list of 1–5 views {type, …} is expected'))
    if (args.views.length > 5) throw new McpToolError(mcpError('too_large', 'views', `at most 5 views (got ${args.views.length})`))
    const list = (args.views as unknown[]).map((v, i) => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new McpToolError(mcpError('bad_argument', `views[${i}]`, 'an object {type, name?, groupBy?, …} is expected'))
      const o = v as Record<string, unknown>
      if (!(MCP_VIEW_TYPES as readonly string[]).includes(String(o.type))) throw new McpToolError(mcpError('bad_argument', `views[${i}].type`, `one of ${MCP_VIEW_TYPES.join(', ')} is expected (chart and form views are set up in One)`))
      return o
    })
    if (list.some((v) => v.type === 'board' && (v.groupBy === undefined || v.groupBy === null)) && !props.some((p) => GROUPABLE.includes(p.type))) {
      const name = props.some((p) => p.name.toLowerCase() === 'status') ? 'Board status' : 'Status'
      const status: PropertyDef = { id: newId(), name, type: 'status', options: defaultStatusOptions() }
      props.push(status)
      notes.push(`A board needs a property to group by: a "${name}" property (status: ${status.options!.map((o) => o.name).join(', ')}) was added.`)
      cardNotes.push(t('features.mcp.plan.autoStatus', { name, options: status.options!.map((o) => o.name).join(', ') }))
    }
    const virtual: Database = { id, properties: props, views: [], nextUniqueId: 1 }
    views = list.map((o, i) => {
      const type = o.type as ViewType
      const base = defaultView(type, virtual, t(`features.mcp.viewName.${type}`))
      if (type === 'board' && !base.groupBy) base.groupBy = props.find((p) => GROUPABLE.includes(p.type))?.id ?? null
      try {
        const { patch } = viewChange(virtual, { ...o, type: undefined }, base)
        return { ...base, ...patch }
      } catch (e) {
        atPath(e, `views[${i}]`)
      }
    })
    if (views[0]!.type !== 'table' && !views.some((v) => v.type === 'table')) {
      views.push(defaultView('table', virtual, t('features.mcp.viewName.table')))
      notes.push(`A table view was added after the ${views[0]!.type} view, so the rows stay editable in a grid.`)
      cardNotes.push(t('features.mcp.plan.autoTable', { layout: layoutName(views[0]!.type) }))
    }
  }
  const db: Database = { id, properties: props, views: views ?? [], nextUniqueId: 1 }

  // the rows: coerced like one_create_row against the new schema, created after it
  const stage = callStage()
  const dbPriv = parent ? pagePrivate(parent.id) : false
  const rowsRaw = args.rows
  if (rowsRaw !== undefined && rowsRaw !== null) {
    if (!Array.isArray(rowsRaw)) throw new McpToolError(mcpError('bad_argument', 'rows', 'a list of rows {title, properties?, markdown?} is expected'))
    if (rowsRaw.length > MCP_LIMITS.rows) throw new McpToolError(mcpError('too_large', 'rows', `${rowsRaw.length} rows (at most ${MCP_LIMITS.rows} per call)`, 'Add the rest with one_create_row { rows } afterwards.'))
    let chars_ = 0
    rowsRaw.forEach((r, i) => {
      const path = `rows[${i}]`
      if (!r || typeof r !== 'object' || Array.isArray(r)) throw new McpToolError(mcpError('bad_argument', path, 'an object {title, properties?, markdown?} is expected'))
      const o = r as Record<string, unknown>
      const split = splitTitle(db, o.properties, `${path}.properties`)
      const rowTitle = (str(o.title, `${path}.title`, { max: 300 }) || split.title || '').replace(/\s+/g, ' ').trim()
      if (!rowTitle) throw new McpToolError(mcpError('bad_argument', `${path}.title`, 'a row needs a title'))
      const markdown = stripRefLabels(str(o.markdown, `${path}.markdown`, { max: 200_000 }))
      chars_ += markdown.length
      checkFileScope(markdown, dbPriv, q(rowTitle))
      checkFiles(db, split.props, dbPriv, `${path}.properties`)
      const res = withFilesWritable(() => coerceProperties(db, split.props, null))
      if (!res.ok) throw new McpToolError(mcpError('bad_argument', `${path}.properties`, mcpMessage(res.error).replace(/^Nothing was changed\. /, '')))
      const pageId = newId()
      let staging: ReturnType<typeof stageItems> | null = null
      try {
        staging = markdown.trim() ? withToolScope(outsideTemplates, () => stageItems(markdown, stage, { pageId, private: dbPriv })) : null
      } catch (e) {
        if (e instanceof ToolInputError) throw new McpToolError(mcpError('bad_argument', `${path}.markdown`, mcpMessage(e.message)))
        throw e
      }
      const c = stage.add({
        kind: 'create_row',
        pageId,
        databaseId: id,
        title: rowTitle,
        props: res.changes,
        ...(markdown.trim() ? { markdown } : {}),
        ...(staging?.needs.length ? { needs: staging.needs } : {}),
        ...(staging?.items ? { items: staging.items } : {}),
      })
      if (staging) commitItems(stage, c, staging)
    })
    if (chars_ > MCP_LIMITS.pagesChars) throw new McpToolError(mcpError('too_large', 'rows', `the rows hold ${chars_.toLocaleString('en')} characters of Markdown (at most ${MCP_LIMITS.pagesChars.toLocaleString('en')})`))
  }
  assertStageWritable(stage.changes)
  const rows = stage.changes.filter((c) => c.kind === 'create_row')

  // the card
  const where = parent ? [pathOf(parent.id), titleOf(parent)].filter(Boolean).join(' / ') : t('features.mcp.plan.topLevel')
  const lines: PlanLine[] = [
    inline
      ? { k: 'fact', label: t('features.mcp.plan.inline'), value: inline.at === null ? t('features.mcp.plan.inlineEnd', { title: titleOf(parent!) }) : t('features.mcp.plan.inlineAfter', { title: titleOf(parent!), n: inline.at + 1 }) }
      : { k: 'fact', label: t('features.mcp.plan.in'), value: where },
  ]
  if (icon) lines.push({ k: 'fact', label: t('features.mcp.plan.icon'), value: iconText(icon) ?? '' })
  lines.push({ k: 'fact', label: t('features.mcp.plan.properties'), value: props.map((p) => (p.type === 'title' ? p.name : `${p.name} (${p.type})`)).join(', ') })
  if (views) {
    const groupName = (v: View) => (v.groupBy ? props.find((p) => p.id === v.groupBy)?.name : v.dateProperty ? props.find((p) => p.id === v.dateProperty)?.name : undefined)
    lines.push({ k: 'fact', label: t('features.mcp.plan.views'), value: views.map((v) => [layoutName(v.type), groupName(v)].filter(Boolean).join(' · ')).join(', ') })
  }
  for (const n of cardNotes) lines.push({ k: 'note', value: n })
  if (rows.length) {
    lines.push({ k: 'fact', label: t('features.mcp.plan.rows'), value: t(rows.length === 1 ? 'features.mcp.plan.rowsN.one' : 'features.mcp.plan.rowsN.other', { n: chars(rows.length) }) })
    rows.forEach((c, i) =>
      lines.push({
        k: 'fact',
        label: `${String(i + 1).padStart(2, '0')} · ${c.title ?? ''}`,
        value:
          (c.props ?? [])
            .slice(0, 3)
            .map((p) => `${p.name}: ${p.after || '—'}`)
            .join(' · ') || '—',
      }),
    )
  }
  const tasks = itemPlan(stage.changes)
  lines.push(...tasks.lines)

  return {
    tool: 'one_create_database',
    verb: t('features.mcp.verb.createDatabase'),
    summary: inline ? t('features.mcp.sum.createInline', { title, page: titleOf(parent!) }) : t('features.mcp.sum.createDatabase', { title, where: parent ? titleOf(parent) : t('features.mcp.plan.topLevel') }),
    target: title,
    lines,
    ...(tasks.holds.length ? { alwaysAsk: true } : {}),
    async apply(writer) {
      if (parent && !live(parent.id)) throw new McpToolError(`${q(titleOf(parent))} is gone. Nothing was changed.`)
      if (inline && ws().pages[parent!.id]?.settings.locked) throw new McpToolError(mcpError('locked', 'inline.pageId', `${q(titleOf(parent!))} was locked meanwhile`))
      // the reverse sides of two-way relations live on the related databases
      const reverses = withWriter(writer, () => {
        ws().createDatabase({ id, title, parentId: parent?.id ?? null, properties: props, ...(views ? { views } : {}), ...(icon ? { icon } : {}), ...(inline ? { inline: true } : {}) })
        const back = (specs ?? []).flatMap((s) => (s.reverse && ws().databases[s.reverse.dbId] ? [s.reverse] : []))
        for (const r of back) ws().addProperty(r.dbId, r.def)
        return back
      })
      const undos: Array<() => boolean> = []
      // the block in the page's text (a version of the page first): at the end, or after the block named
      let blockId: string | null = null
      if (inline && parent) {
        const pageId = parent.id
        await snapshotNow(pageId, 'ai')
        const prev = ws().pages[pageId]?.content ?? null
        blockId = newId()
        const block: JSONContent = { type: 'databaseBlock', attrs: { id: blockId, databaseId: id, viewId: null } }
        const blocks = isEmptyDoc(prev) ? [] : [...(prev?.content ?? [])]
        // the block named may have moved meanwhile: found again by its id (else at the end)
        const anchorId = inline.at !== null ? (prev?.content?.[inline.at]?.attrs?.id as string | undefined) : undefined
        const at = inline.at === null ? blocks.length : anchorId ? blocks.findIndex((b) => b.attrs?.id === anchorId) + 1 : Math.min(inline.at + 1, blocks.length)
        blocks.splice(at > 0 ? at : blocks.length, 0, block)
        withWriter(writer, () => ws().setContent(pageId, { type: 'doc', content: blocks }, 'ai'))
        const rev = ws().pages[pageId]?.contentRev
        const key = contentKey(ws().pages[pageId]?.content)
        undos.push(() => {
          const now = ws().pages[pageId]
          if (!now || (now.contentRev !== rev && contentKey(now.content) !== key)) return false
          ws().setContent(pageId, prev, 'ai')
          return true
        })
      }
      // the rows (after the schema); a failure takes the whole call back
      let rowIds: Record<string, ID> = {}
      let rowsUndo: () => boolean = () => true
      if (stage.changes.length) {
        try {
          const done = await applyStaged(stage.changes, writer)
          rowIds = done.rowIds
          rowsUndo = done.undo
        } catch (e) {
          withWriter(writer, () => {
            for (const u of undos) u()
            for (const r of reverses) if (ws().databases[r.dbId]?.properties.some((p) => p.id === r.def.id)) ws().deleteProperty(r.dbId, r.def.id)
            ws().deletePagePermanently(id)
          })
          throw e
        }
      }
      const d = ws().databases[id]
      const madeRows = rows.map((c) => rowIds[c.pageId] ?? c.pageId)
      const note = notes.length ? notes.join(' ') : undefined
      return {
        result: {
          id,
          title,
          url: pageUrl(id),
          parentId: parent?.id ?? null,
          ...(inline ? { pageId: parent!.id, block: blockRef(parent!.id, blockId) } : {}),
          properties: d.properties.map((p) => propertyJson(d, p)),
          views: d.views.map((v) => ({ id: v.id, name: v.name, type: v.type, groupBy: v.groupBy ? (d.properties.find((p) => p.id === v.groupBy)?.name ?? null) : null })),
          ...(rows.length ? { rows: rows.map((c, index) => ({ index, id: madeRows[index], title: c.title ?? '' })) } : {}),
          ...(reverses.length ? { reverse: reverses.map((r) => ({ databaseId: r.dbId, property: r.def.name })) } : {}),
          ...tasksOf(tasks.created),
          ...(note ? { note } : {}),
        },
        undo: () => {
          // the rows (to the trash while untouched), the block in the page, the reverse properties, then the database
          const kept = [rowsUndo(), ...undos.reverse().map((u) => u())]
          for (const r of reverses) if (ws().databases[r.dbId]?.properties.some((p) => p.id === r.def.id)) ws().deleteProperty(r.dbId, r.def.id)
          const { pages } = ws()
          const now = pages[id]
          // in the trash already (the person put it there): it stays there, never deleted for good
          if (!now || now.trashed) return kept.every(Boolean)
          // rows someone added since keep the database where it is
          const others = Object.values(pages).some((p) => p.parentId === id && !p.trashed && !madeRows.includes(p.id))
          if (others) return false
          ws().trashPage(id)
          return kept.every(Boolean)
        },
      }
    },
  }
}
