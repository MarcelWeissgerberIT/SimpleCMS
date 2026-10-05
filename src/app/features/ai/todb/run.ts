/**
 * "Turn into database" — the Claude request and the one-step apply.
 *
 *  requestTable(): one structured-output request (no MCP server: the selection is the data). The answer
 *  comes back as plain data (the plan + the blocks it was read from as JSON), so a run can keep it in the
 *  background and across a reload (features/ai/runs.ts).
 *  convertToDatabase(): a version snapshot, the inline database with its rows (row bodies via the
 *  Markdown converter, origin 'ai'), then ONE editor transaction that puts the database block where the
 *  first consumed block was — kept blocks stay as they were. ⌘Z brings the text back in one step; the
 *  toast's Undo also removes the database again. Without a range (the text changed meanwhile), the
 *  database goes to the end of the page and every block stays.
 */
import type { Editor, JSONContent } from '@tiptap/core'
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
import { blockGist, buildDatabase, buildTodbPrompt, initialDraft, parseTodbAnswer, rangeNodes, readBlocks, type BlockRange, type RangeNodes, type TableDraft, type TablePlan } from './plan'

/** Why a request or a conversion did not happen (an i18n key under features.ai.todb.err). */
export type TodbIssue = 'none' | 'bad' | 'changed' | 'gone'

export class TodbError extends Error {
  issue: TodbIssue
  constructor(issue: TodbIssue) {
    super(issue)
    this.issue = issue
  }
}

export interface TableAnswer {
  plan: TablePlan
  /** the blocks Claude read, as they were (convert checks they are still the same) */
  blocks: JSONContent[]
  gists: string[]
  draft: TableDraft
}

/** Ask Claude for the table. Throws AIError (client.ts: no key, offline, aborted …) or TodbError. */
export async function requestTable(doc: PMNode, range: BlockRange, opts: { pageTitle?: string; instruction?: string; signal?: AbortSignal }): Promise<TableAnswer> {
  const source = readBlocks(doc, range)
  if (!source) throw new TodbError('changed')
  const { system, prompt, schema } = buildTodbPrompt(source.blocks, opts)
  const raw = await completeStructured({ system, prompt, schema, maxTokens: 16000, signal: opts.signal, mcp: false })
  const plan = parseTodbAnswer(raw, source.blocks)
  if (!plan) throw new TodbError('bad')
  if (!plan.entries.length) throw new TodbError('none')
  return {
    plan,
    blocks: source.blocks.map((b) => b.node.toJSON() as JSONContent),
    gists: source.blocks.map((b) => blockGist(b.node)),
    draft: initialDraft(plan),
  }
}

/** The blocks at `range` when they are still the ones Claude read, else null. */
export function sameBlocks(doc: PMNode, range: BlockRange | null, blocks: JSONContent[]): RangeNodes | null {
  if (!range) return null
  const now = rangeNodes(doc, range)
  if (!now || now.nodes.length !== blocks.length) return null
  return now.nodes.every((n, i) => JSON.stringify(n.toJSON()) === JSON.stringify(blocks[i])) ? now : null
}

/**
 * Create the database and put it in place of the blocks (or, `range` null, at the end of the page).
 * Resolves with the database id; throws TodbError ('changed': the blocks were edited meanwhile, 'gone':
 * the page or the editor went away).
 */
export async function convertToDatabase(editor: Editor, pageId: ID, range: BlockRange | null, answer: Pick<TableAnswer, 'plan' | 'blocks'>, draft: TableDraft): Promise<ID> {
  if (editor.isDestroyed) throw new TodbError('gone')
  if (range && !sameBlocks(editor.state.doc, range, answer.blocks)) throw new TodbError('changed')
  await snapshotNow(pageId, 'ai')
  if (editor.isDestroyed) throw new TodbError('gone')
  const at = range ? sameBlocks(editor.state.doc, range, answer.blocks) : null
  if (range && !at) throw new TodbError('changed')
  const ws = useWorkspace.getState()
  if (!ws.pages[pageId] || ws.pages[pageId].trashed) throw new TodbError('gone')
  const dbType = editor.schema.nodes.databaseBlock
  if (!dbType) throw new TodbError('gone')

  const spec = buildDatabase(answer.plan, draft, { board: t('features.ai.todb.view.board'), table: t('features.ai.todb.view.table'), untitled: t('common.untitled') })
  const dbId = ws.createDatabase({ parentId: pageId, inline: true, title: spec.title, properties: spec.properties, views: spec.views })
  for (const row of spec.rows) {
    const rowId = useWorkspace.getState().createRow(dbId, { title: row.title, properties: row.properties })
    if (row.body) useWorkspace.getState().setContent(rowId, markdownToDoc(row.body), 'ai')
  }

  const dbNode = dbType.create({ databaseId: dbId, viewId: null })
  const consumed: PMNode[] = []
  let tr = closeHistory(editor.state.tr)
  let dbPos: number
  if (at) {
    // the range, block for block: kept ones as they are, the database where the first consumed one was
    const keep = new Set(answer.plan.keep)
    const nodes: PMNode[] = []
    at.nodes.forEach((node, i) => {
      if (keep.has(i)) return void nodes.push(node)
      if (!consumed.length) nodes.push(dbNode)
      consumed.push(node)
    })
    if (!consumed.length) nodes.push(dbNode)
    const content = Fragment.from(nodes)
    if (!at.parent.canReplace(at.start, at.end, content)) {
      useWorkspace.getState().deletePagePermanently(dbId)
      throw new TodbError('changed')
    }
    tr = tr.replaceWith(at.from, at.to, content)
    dbPos = at.from
    for (const n of nodes) {
      if (n === dbNode) break
      dbPos += n.nodeSize
    }
  } else {
    dbPos = tr.doc.content.size
    tr = tr.insert(dbPos, dbNode)
  }
  // the caret just after the database block (never a node selection: typing would replace it)
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(dbPos + dbNode.nodeSize, tr.doc.content.size)))).scrollIntoView()
  editor.view.dispatch(tr)
  editor.view.focus()
  const after = editor.state.doc

  useUI.getState().toast({
    message: spec.rows.length === 1 ? t('features.ai.todb.doneOne') : t('features.ai.todb.done', { n: spec.rows.length }),
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
