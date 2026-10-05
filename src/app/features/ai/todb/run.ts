/**
 * "Turn into database" — the Claude request and the one-step apply.
 *
 *  requestTable(): one structured-output request (no MCP server: the selection is the data).
 *  convertToDatabase(): a version snapshot, the inline database with its rows (row bodies via the
 *  Markdown converter, origin 'ai'), then ONE editor transaction that puts the database block where the
 *  first consumed block was — kept blocks stay as they were. ⌘Z brings the text back in one step; the
 *  toast's Undo also removes the database again.
 */
import type { Editor } from '@tiptap/core'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { markdownToDoc } from '../../../editor'
import { useWorkspace } from '../../../store/store'
import { useUI } from '../../../store/ui'
import type { ID } from '../../../store/types'
import { t } from '../../../i18n'
import { snapshotNow } from '../../history/snapshots'
import { completeStructured } from '../client'
import { buildDatabase, buildTodbPrompt, parseTodbAnswer, readBlocks, type BlockRange, type ResolvedBlocks, type TableDraft, type TablePlan } from './plan'

export interface TableRequest {
  /** the blocks as they were sent (convert checks they are still the same) */
  source: ResolvedBlocks
  plan: TablePlan
}

/** Why a request or a conversion did not happen (an i18n key under features.ai.todb.err). */
export type TodbIssue = 'none' | 'bad' | 'changed' | 'gone'

export class TodbError extends Error {
  issue: TodbIssue
  constructor(issue: TodbIssue) {
    super(issue)
    this.issue = issue
  }
}

/** Ask Claude for the table. Throws AIError (client.ts: no key, offline, aborted …) or TodbError. */
export async function requestTable(editor: Editor, range: BlockRange, opts: { pageTitle?: string; instruction?: string; signal?: AbortSignal }): Promise<TableRequest> {
  const source = editor.isDestroyed ? null : readBlocks(editor.state.doc, range)
  if (!source) throw new TodbError('changed')
  const { system, prompt, schema } = buildTodbPrompt(source.blocks, opts)
  const raw = await completeStructured({ system, prompt, schema, maxTokens: 16000, signal: opts.signal, mcp: false })
  const plan = parseTodbAnswer(raw, source.blocks)
  if (!plan) throw new TodbError('bad')
  if (!plan.entries.length) throw new TodbError('none')
  return { source, plan }
}

/** Are the blocks at `range` still the ones Claude read? */
function stillSame(editor: Editor, range: BlockRange, source: ResolvedBlocks): ResolvedBlocks | null {
  if (editor.isDestroyed) return null
  const now = readBlocks(editor.state.doc, range)
  if (!now || now.blocks.length !== source.blocks.length) return null
  return now.blocks.every((b, i) => b.node.eq(source.blocks[i].node)) ? now : null
}

/**
 * Create the database and swap the blocks for it. Resolves with the database id; throws TodbError
 * ('changed': the blocks were edited meanwhile, 'gone': the page or editor went away).
 */
export async function convertToDatabase(editor: Editor, pageId: ID, range: BlockRange, req: TableRequest, draft: TableDraft): Promise<ID> {
  if (!stillSame(editor, range, req.source)) throw new TodbError('changed')
  await snapshotNow(pageId, 'ai')
  const at = stillSame(editor, range, req.source)
  if (!at) throw new TodbError('changed')
  const ws = useWorkspace.getState()
  if (!ws.pages[pageId] || ws.pages[pageId].trashed) throw new TodbError('gone')
  const dbType = editor.schema.nodes.databaseBlock
  if (!dbType) throw new TodbError('gone')

  const spec = buildDatabase(req.plan, draft, { board: t('features.ai.todb.view.board'), table: t('features.ai.todb.view.table'), untitled: t('common.untitled') })
  const dbId = ws.createDatabase({ parentId: pageId, inline: true, title: spec.title, properties: spec.properties, views: spec.views })
  for (const row of spec.rows) {
    const rowId = useWorkspace.getState().createRow(dbId, { title: row.title, properties: row.properties })
    if (row.body) useWorkspace.getState().setContent(rowId, markdownToDoc(row.body), 'ai')
  }

  // the range, block for block: kept ones as they are, the database where the first consumed one was
  const keep = new Set(req.plan.keep)
  const dbNode = dbType.create({ databaseId: dbId, viewId: null })
  const nodes: PMNode[] = []
  const consumed: PMNode[] = []
  at.blocks.forEach((b, i) => {
    if (keep.has(i)) return void nodes.push(b.node)
    if (!consumed.length) nodes.push(dbNode)
    consumed.push(b.node)
  })
  if (!consumed.length) nodes.push(dbNode)
  const content = Fragment.from(nodes)
  if (!at.parent.canReplace(at.start, at.end, content)) {
    useWorkspace.getState().deletePagePermanently(dbId)
    throw new TodbError('changed')
  }
  const tr = closeHistory(editor.state.tr).replaceWith(at.from, at.to, content)
  // the caret just after the database block (never a node selection: typing would replace it)
  let dbPos = at.from
  for (const n of nodes) {
    if (n === dbNode) break
    dbPos += n.nodeSize
  }
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(dbPos + dbNode.nodeSize, tr.doc.content.size)))).scrollIntoView()
  editor.view.dispatch(tr)
  editor.view.focus()
  const after = editor.state.doc

  useUI.getState().toast({
    message: t('features.ai.todb.done', { n: spec.rows.length }),
    kind: 'success',
    action: { label: t('common.undo'), run: () => undoConversion(editor, dbId, after, consumed) },
  })
  return dbId
}

/** The toast's Undo: the text back (the editor's own undo while nothing changed since), the database gone. */
function undoConversion(editor: Editor, dbId: ID, after: PMNode, consumed: PMNode[]) {
  if (!editor.isDestroyed) {
    if (editor.state.doc.eq(after)) editor.commands.undo()
    else {
      // edited since: the database block (wherever it is now) becomes the original blocks again
      let pos = -1
      editor.state.doc.descendants((n, p) => {
        if (pos >= 0) return false
        if (n.type.name === 'databaseBlock' && n.attrs.databaseId === dbId) pos = p
        return pos < 0
      })
      const node = pos >= 0 ? editor.state.doc.nodeAt(pos) : null
      if (node) editor.view.dispatch(closeHistory(editor.state.tr).replaceWith(pos, pos + node.nodeSize, Fragment.from(consumed)))
    }
  }
  const ws = useWorkspace.getState()
  if (ws.pages[dbId]) ws.deletePagePermanently(dbId)
}
