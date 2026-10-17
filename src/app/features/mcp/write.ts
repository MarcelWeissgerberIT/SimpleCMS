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
import { t } from '../../i18n'
import type { ID } from '../../store/types'
import { inTemplate } from '../../store/selectors'
import { aiWrite, contentKey, snapshotNow } from '../history/snapshots'
import { pagePrivate, registerItems, stageBlocks, type ItemStaging } from '../ai/agent/workItems'
import { getItemIndex, SettleRefusal, type SettleReport } from '../workitems'
import { holdsOfReport } from '../workitems/holds'
import { applyStaged, assertStageWritable, callStage, itemLine, itemPlan, mcpMessage, stageWith } from './stage'
import { assertNotSystem } from './system'
import { livePage, withPageNodes, type LinkTarget } from '../ai/agent/links'
import type { McpToolName } from './contract'
import { databaseOrThrow, iconText, live, McpToolError, pageUrl, propertyJson, q, titleOf, ws } from './values'
import { chars, checkFileScope, pageOrThrow, parseIcon, preview, str, tasksOf, type PlanLine, type WritePlan } from './plan'
import { stripRefLabels } from '../../../shared/mcp/refs'
import { TIDY_PLANNERS } from './tidy'
import { STRUCTURE_PLANNERS } from './structure'
import { withWriter } from '../../store/writer'

export type { Applied, PlanLine, WritePlan } from './plan'
export { mcpMessage } from './stage'
import { planUpdateWorkItems } from './workItems'
import { planCreatePage } from './pages'
import { planCreateRow, planUpdateRow, planUpsertRows } from './rows'
import { planCreateDatabase } from './database'
import { addProperties, propertySpec } from './schema'

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** A page a replace may turn a link into a mention / page link block for: live, never a template's. */
const linkTarget = (id: ID): LinkTarget | null => (inTemplate(ws().pages, id) ? null : livePage(id))

/* ------------------------------------------------------------------ */
/* Pages                                                               */
/* ------------------------------------------------------------------ */

function planUpdatePage(args: Record<string, unknown>): WritePlan {
  const page = pageOrThrow(args.id)
  // One's own databases (a pipeline task, a memory, a mail …): read-only over MCP — title and icon too
  assertNotSystem(page.id)
  const mode = args.mode === undefined || args.mode === null || args.mode === '' ? 'append' : args.mode
  if (mode !== 'append' && mode !== 'replace') throw new McpToolError('"mode" must be "append" or "replace".')
  const titleRaw = args.title === undefined || args.title === null ? null : str(args.title, 'title', { max: 300 }).replace(/\s+/g, ' ').trim()
  if (titleRaw === '') throw new McpToolError('"title" must not be empty.')
  const markdown = args.markdown === undefined || args.markdown === null ? null : stripRefLabels(str(args.markdown, 'markdown', { max: 200_000 }))
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
/* Schema                                                              */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */

const PLANNERS: Partial<Record<McpToolName, (args: Record<string, unknown>) => WritePlan>> = {
  one_update_work_item: planUpdateWorkItems,
  one_create_page: planCreatePage,
  one_update_page: planUpdatePage,
  one_create_row: planCreateRow,
  one_update_row: planUpdateRow,
  one_upsert_rows: planUpsertRows,
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
