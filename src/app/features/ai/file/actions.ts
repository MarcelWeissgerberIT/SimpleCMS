/**
 * Claude for files — the entry points (the file block's AI key, the block menu, the AI menu) and what
 * applying does.
 *
 *  - startFileAction(editor, pos, action): any action of the file at `pos` as a background run (runs.ts) —
 *    the page's AI panel opens on it (the run goes on when the panel closes or the page is left)
 *  - askAboutFile(editor, pos): the AI panel on that file with the prompt ready for a question
 *  - insertBelowFile / createFilePage / createFileDatabase: the result into the page — a version first,
 *    one editor transaction (one undo step); a new page or database also gets an Undo in its toast.
 *    AI output is written with origin 'ai', local conversions with 'import'.
 *  - uploadFileCopy(editor, run): a web file the browser may not read (CORS) or a missing one → a local
 *    copy picked by the user replaces the block's source
 */
import type { Editor, JSONContent } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { endUndoStep, startUndoStep } from '../../../editor'
import { useWorkspace } from '../../../store/store'
import { useUI } from '../../../store/ui'
import type { ID } from '../../../store/types'
import { saveFile } from '../../../lib/files'
import { createPrivateDatabase, createPrivatePage, isPrivatePage } from '../../../cloud'
import { t } from '../../../i18n'
import { claudeBlocks, claudeDoc } from '../claudeDoc'
import { snapshotNow } from '../../history/snapshots'
import { startRun, useAIRuns, type AIRun } from '../runs'
import { buildDatabase, placementOf, type TableDraft, type TablePlan } from '../todb/plan'
import { afterBlock } from '../runsTarget'
import { useImageAsk } from '../image/actions'
import { fileAt, fileTarget, findFile, type FileHit } from './locate'
import { FILE_CODES, fileKind, type FileAction } from './kinds'
import type { FileRunRequest } from './run'

const pageOf = (editor: Editor): ID | null => (editor.isDestroyed ? null : editor.view.dom.getAttribute('data-page-id'))

/** The request of an action on this file (labels in the UI language). */
export function fileRequest(action: FileAction, hit: FileHit, extra: { question?: string; instruction?: string } = {}): FileRunRequest {
  return {
    kind: 'file',
    action,
    label: t(`features.ai.file.act.${action}`),
    code: FILE_CODES[action],
    src: String(hit.node.attrs.src),
    name: String(hit.node.attrs.name ?? 'file'),
    blockId: typeof hit.node.attrs.id === 'string' ? hit.node.attrs.id : null,
    fileKind: hit.kind,
    ...(extra.question?.trim() ? { question: extra.question.trim() } : {}),
    ...(extra.instruction?.trim() ? { instruction: extra.instruction.trim() } : {}),
  }
}

/** Any action of the file at `pos` as a background run; the page's panel opens on it. */
export function startFileAction(editor: Editor, pos: number, action: FileAction, extra: { question?: string } = {}): string | null {
  const pageId = pageOf(editor)
  const hit = editor.isDestroyed ? null : fileAt(editor.state.doc, pos)
  if (!pageId || !hit || !editor.isEditable) return null
  if (action === 'ask' && !extra.question?.trim()) {
    askAboutFile(editor, pos)
    return null
  }
  const id = startRun({ editor, pageId, req: fileRequest(action, hit, extra), target: fileTarget(editor.state.doc, pos) })
  // the page's run host (RunsHost) opens the panel on it
  useAIRuns.setState({ openRequest: id })
  return id
}

let asks = 0

/**
 * The AI panel on a file with the prompt ready for a question. It goes through the image's channel
 * (useImageAsk: RunsHost opens the panel on the node-selected block — the panel sees a file there).
 */
export function askAboutFile(editor: Editor, pos: number): boolean {
  if (editor.isDestroyed || !editor.isEditable || !fileAt(editor.state.doc, pos)) return false
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)).setMeta('addToHistory', false))
  // negative numbers: never the key of an image's ask
  useImageAsk.setState({ req: { editor, pos, n: -++asks } })
  const drop = () => {
    editor.off('destroy', drop)
    if (useImageAsk.getState().req?.editor === editor) useImageAsk.setState({ req: null })
  }
  editor.on('destroy', drop)
  return true
}

/* ------------------------------------------------------------------ */
/* Applying                                                            */
/* ------------------------------------------------------------------ */

/** The file of a run in the editor now (mapped position, its block id, a unique source). */
export function runFile(editor: Editor, run: Pick<AIRun, 'req' | 'target'>): FileHit | null {
  if (editor.isDestroyed || run.req.kind !== 'file') return null
  return findFile(editor.state.doc, run.req, run.target.lost ? null : run.target.from)
}

/** Where blocks go below the file now (gone: the end of the page). */
function belowFile(editor: Editor, run: AIRun): number {
  const hit = runFile(editor, run)
  const doc = editor.state.doc
  return hit ? afterBlock(doc.resolve(Math.min(hit.pos + hit.node.nodeSize, doc.content.size))) : doc.content.size
}

/** Blocks right below the file. One transaction. */
export async function insertBelowFile(editor: Editor, pageId: ID, run: AIRun, blocks: JSONContent[]): Promise<void> {
  if (!blocks.length) return
  await snapshotNow(pageId, 'ai')
  if (editor.isDestroyed) return
  startUndoStep(editor.view)
  editor
    .chain()
    .focus()
    .command(({ tr }) => (closeHistory(tr), true))
    .insertContentAt(belowFile(editor, run), blocks)
    .run()
  endUndoStep(editor.view)
}

/** Markdown below the file. */
export function insertMarkdownBelowFile(editor: Editor, pageId: ID, run: AIRun, markdown: string): Promise<void> {
  return insertBelowFile(editor, pageId, run, claudeBlocks(markdown))
}

/** A link block below the file, selected after it (one transaction). */
function linkBelow(editor: Editor, run: AIRun, node: ReturnType<Editor['schema']['nodes']['pageLink']['create']>) {
  const at = belowFile(editor, run)
  const tr = closeHistory(editor.state.tr).insert(at, node)
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(at + node.nodeSize, tr.doc.content.size)))).scrollIntoView()
  startUndoStep(editor.view)
  editor.view.dispatch(tr)
  endUndoStep(editor.view)
  editor.view.focus()
}

/** Undo of a created page / database: its link block out of the editor, the page itself gone for good. */
function undoCreated(editor: Editor, id: ID, attr: 'pageId' | 'databaseId') {
  if (!editor.isDestroyed) {
    let at = -1
    editor.state.doc.descendants((n, pos) => {
      if (at >= 0) return false
      if (n.attrs?.[attr] === id && (n.type.name === 'pageLink' || n.type.name === 'databaseBlock')) at = pos
      return at < 0
    })
    if (at >= 0) {
      const node = editor.state.doc.nodeAt(at)
      if (node) editor.view.dispatch(editor.state.tr.delete(at, at + node.nodeSize))
    }
  }
  if (useWorkspace.getState().pages[id]) useWorkspace.getState().deletePagePermanently(id)
}

/**
 * A sub-page of this page holding `doc` (private when this page is), linked right below the file.
 * `origin`: 'ai' (Claude's transcription) or 'import' (a local conversion). Resolves with its id.
 */
export async function createFilePage(editor: Editor, pageId: ID, run: AIRun, page: { title: string; doc: JSONContent; origin: 'ai' | 'import' }): Promise<ID | null> {
  await snapshotNow(pageId, 'ai')
  const ws = useWorkspace.getState()
  if (editor.isDestroyed || !ws.pages[pageId] || ws.pages[pageId].trashed) return null
  const input = { title: page.title.trim().slice(0, 200) || t('common.untitled'), parentId: pageId }
  const id = isPrivatePage(pageId) ? createPrivatePage(input) : ws.createPage(input)
  useWorkspace.getState().setContent(id, page.doc, page.origin)
  linkBelow(editor, run, editor.schema.nodes.pageLink.create({ pageId: id }))
  useUI.getState().toast({
    message: t('features.ai.file.pageDone', { title: input.title }),
    kind: 'success',
    action: { label: t('common.undo'), run: () => undoCreated(editor, id, 'pageId') },
  })
  return id
}

/**
 * A database from a table (a CSV / Excel sheet, or one Claude found in a PDF) — the "Turn into database"
 * builder: inline below the file, or as its own page (a child of this page) linked there; private when this
 * page is. Rows are written with origin `origin`. Resolves with its id.
 */
export async function createFileDatabase(
  editor: Editor,
  pageId: ID,
  run: AIRun,
  plan: TablePlan,
  draft: TableDraft,
  titleName: string,
  origin: 'ai' | 'import',
): Promise<ID | null> {
  await snapshotNow(pageId, 'ai')
  const ws = useWorkspace.getState()
  if (editor.isDestroyed || !ws.pages[pageId] || ws.pages[pageId].trashed) return null
  const asPage = placementOf(draft) === 'page'
  const spec = buildDatabase(plan, draft, { board: t('features.ai.todb.view.board'), table: t('features.ai.todb.view.table'), untitled: t('common.untitled') })
  // the title property keeps the name of the table's first column
  const properties = spec.properties.map((p, i) => (i === 0 && p.type === 'title' ? { ...p, name: titleName.slice(0, 100) || p.name } : p))
  const input = { parentId: pageId, inline: !asPage, title: spec.title, properties, views: spec.views }
  const dbId = isPrivatePage(pageId) ? createPrivateDatabase(input) : ws.createDatabase(input)
  for (const row of spec.rows) {
    const rowId = useWorkspace.getState().createRow(dbId, { title: row.title, properties: row.properties })
    if (row.body) useWorkspace.getState().setContent(rowId, claudeDoc(row.body), origin)
  }
  if (editor.isDestroyed) return dbId
  linkBelow(editor, run, asPage ? editor.schema.nodes.pageLink.create({ pageId: dbId }) : editor.schema.nodes.databaseBlock.create({ databaseId: dbId, viewId: null }))
  useUI.getState().toast({
    message: spec.rows.length === 1 ? t('features.ai.todb.doneOne') : t('features.ai.todb.done', { n: spec.rows.length }),
    kind: 'success',
    action: { label: t('common.undo'), run: () => undoCreated(editor, dbId, asPage ? 'pageId' : 'databaseId') },
  })
  return dbId
}

/* ------------------------------------------------------------------ */
/* A local copy of a web file                                           */
/* ------------------------------------------------------------------ */

function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.style.display = 'none'
    let done = false
    const finish = (f: File | null) => {
      if (done) return
      done = true
      window.removeEventListener('focus', onFocus)
      input.remove()
      resolve(f)
    }
    // 'cancel' fires in current browsers; window focus is the fallback for older ones
    const onFocus = () => window.setTimeout(() => !input.files?.length && finish(null), 400)
    input.onchange = () => finish(input.files?.[0] ?? null)
    input.addEventListener('cancel', () => finish(null))
    document.body.appendChild(input)
    window.addEventListener('focus', onFocus)
    input.click()
  })
}

/**
 * "Upload a copy": the user picks the file (downloaded from the site); it is stored on this device and
 * becomes the block's source. Resolves with the file block as it is now, or null (cancelled / gone).
 */
export async function uploadFileCopy(editor: Editor, run: AIRun): Promise<FileHit | null> {
  const file = await pickFile()
  if (!file || editor.isDestroyed) return null
  const ref = await saveFile(file, file.name)
  const hit = runFile(editor, run)
  if (!hit || editor.isDestroyed) return null
  // the copy keeps the block's name unless it is another kind of file
  const name = fileKind(file.name) ? file.name : String(hit.node.attrs.name ?? file.name)
  editor.view.dispatch(editor.state.tr.setNodeMarkup(hit.pos, undefined, { ...hit.node.attrs, src: ref, name, size: file.size }))
  return fileAt(editor.state.doc, hit.pos)
}
