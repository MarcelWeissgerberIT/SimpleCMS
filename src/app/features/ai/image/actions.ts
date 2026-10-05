/**
 * Claude for images — the entry points (image toolbar, block menu, AI menu) and what applying does.
 *
 *  - startImageAction(editor, pos, action): describe / read / table as a background run (runs.ts) — the
 *    page's AI panel opens on it (the run goes on when the panel closes or the page is left)
 *  - askAboutImage(editor, pos): the AI panel on the image with the prompt ready for a question
 *  - applyDescription / insertBelowImage / createImageDatabase: the result into the page (a version
 *    first; one transaction — one undo step)
 *  - uploadImageCopy(editor, hit): a web image the browser may not read (CORS) → a local copy picked by
 *    the user replaces its source
 */
import type { Editor, JSONContent } from '@tiptap/core'
import { TextSelection, NodeSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { create } from 'zustand'
import { useWorkspace } from '../../../store/store'
import { useUI } from '../../../store/ui'
import type { ID } from '../../../store/types'
import { saveFile } from '../../../lib/files'
import { t } from '../../../i18n'
import { snapshotNow } from '../../history/snapshots'
import { startRun, useAIRuns, type AIRun } from '../runs'
import { markdownToDoc } from '../../../editor'
import { withoutWebImages } from '../../agents/images'
import { buildDatabase, placementOf, type TableDraft, type TablePlan } from '../todb/plan'
import { afterBlock } from '../runsTarget'
import { findImage, imageAt, imageTarget, type ImageHit } from './locate'
import type { ImageAction } from './request'
import type { ImageRunRequest } from './run'

/** The mono code each action shows in the panel. */
export const IMAGE_CODES: Record<ImageAction, string> = { describe: 'ALT', read: 'OCR', table: 'TBL', ask: 'ASK' }

const pageOf = (editor: Editor): ID | null => (editor.isDestroyed ? null : editor.view.dom.getAttribute('data-page-id'))

/** The request of an action on this image (labels in the UI language). */
export function imageRequest(action: ImageAction, hit: ImageHit, extra: { question?: string; instruction?: string } = {}): ImageRunRequest {
  return {
    kind: 'image',
    action,
    label: t(`features.ai.image.act.${action}`),
    code: IMAGE_CODES[action],
    src: String(hit.node.attrs.src),
    blockId: typeof hit.node.attrs.id === 'string' ? hit.node.attrs.id : null,
    ...(extra.question?.trim() ? { question: extra.question.trim() } : {}),
    ...(extra.instruction?.trim() ? { instruction: extra.instruction.trim() } : {}),
  }
}

/** Describe / read / table (or a question) as a background run; the page's panel opens on it. */
export function startImageAction(editor: Editor, pos: number, action: ImageAction, extra: { question?: string } = {}): string | null {
  const pageId = pageOf(editor)
  const hit = editor.isDestroyed ? null : imageAt(editor.state.doc, pos)
  if (!pageId || !hit || !editor.isEditable) return null
  if (action === 'ask' && !extra.question?.trim()) {
    askAboutImage(editor, pos)
    return null
  }
  const id = startRun({ editor, pageId, req: imageRequest(action, hit, extra), target: imageTarget(editor.state.doc, pos) })
  // the page's run host (RunsHost) opens the panel on it
  useAIRuns.setState({ openRequest: id })
  return id
}

/* ------------------------------------------------------------------ */
/* "Ask about the image": the panel with the prompt                     */
/* ------------------------------------------------------------------ */

interface AskState {
  req: { editor: Editor; pos: number; n: number } | null
}

/** A request to open the AI panel on an image for a question (RunsHost of that editor shows it). */
export const useImageAsk = create<AskState>()(() => ({ req: null }))

let asks = 0

export function askAboutImage(editor: Editor, pos: number): boolean {
  if (editor.isDestroyed || !editor.isEditable || !imageAt(editor.state.doc, pos)) return false
  // the image is what the panel is about: select it (the panel reads the selection when it opens)
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)).setMeta('addToHistory', false))
  useImageAsk.setState({ req: { editor, pos, n: ++asks } })
  // the page was left before the panel closed: the request goes with its editor
  const drop = () => {
    editor.off('destroy', drop)
    if (useImageAsk.getState().req?.editor === editor) endImageAsk()
  }
  editor.on('destroy', drop)
  return true
}

export function endImageAsk() {
  useImageAsk.setState({ req: null })
}

/* ------------------------------------------------------------------ */
/* Applying                                                            */
/* ------------------------------------------------------------------ */

/** The image of a run in the editor now (mapped position, its block id, a unique source). */
export function runImage(editor: Editor, run: Pick<AIRun, 'req' | 'target'>): ImageHit | null {
  if (editor.isDestroyed || run.req.kind !== 'image') return null
  return findImage(editor.state.doc, run.req, run.target.lost ? null : run.target.from)
}

/** Where blocks go below an image now. */
function belowImage(editor: Editor, hit: ImageHit): number {
  const doc = editor.state.doc
  return afterBlock(doc.resolve(Math.min(hit.pos + hit.node.nodeSize, doc.content.size)))
}

/** Alt text + caption onto the image: one transaction (one undo step). False: the image is gone. */
export async function applyDescription(editor: Editor, pageId: ID, run: AIRun, desc: { alt: string; caption: string }): Promise<boolean> {
  await snapshotNow(pageId, 'ai')
  const hit = runImage(editor, run)
  if (!hit) return false
  const tr = closeHistory(editor.state.tr).setNodeMarkup(hit.pos, undefined, { ...hit.node.attrs, alt: desc.alt.trim() || null, caption: desc.caption.trim() })
  tr.setSelection(NodeSelection.create(tr.doc, hit.pos))
  editor.view.dispatch(tr)
  editor.view.focus()
  return true
}

/** Blocks right below the image (gone: at the end of the page). One transaction. */
export async function insertBelowImage(editor: Editor, pageId: ID, run: AIRun, blocks: JSONContent[]): Promise<void> {
  if (!blocks.length) return
  await snapshotNow(pageId, 'ai')
  if (editor.isDestroyed) return
  const hit = runImage(editor, run)
  const at = hit ? belowImage(editor, hit) : editor.state.doc.content.size
  editor.chain().focus().insertContentAt(at, blocks).run()
}

/** Markdown below the image (web images in Claude's answer become links: no auto-loading pixels from text in a picture). */
export function insertMarkdownBelow(editor: Editor, pageId: ID, run: AIRun, markdown: string): Promise<void> {
  return insertBelowImage(editor, pageId, run, (markdownToDoc(withoutWebImages(markdown)).content ?? []).filter(Boolean))
}

/**
 * A database from a table in the image (the "Turn into database" builder): inline below the image, or as
 * its own page (a child of this page) linked there. Rows are written with origin 'ai'. Resolves with its id.
 */
export async function createImageDatabase(editor: Editor, pageId: ID, run: AIRun, plan: TablePlan, draft: TableDraft, titleName: string): Promise<ID | null> {
  await snapshotNow(pageId, 'ai')
  const ws = useWorkspace.getState()
  if (editor.isDestroyed || !ws.pages[pageId] || ws.pages[pageId].trashed) return null
  const asPage = placementOf(draft) === 'page'
  const spec = buildDatabase(plan, draft, { board: t('features.ai.todb.view.board'), table: t('features.ai.todb.view.table'), untitled: t('common.untitled') })
  // the title property keeps the name of the table's first column
  const properties = spec.properties.map((p, i) => (i === 0 && p.type === 'title' ? { ...p, name: titleName.slice(0, 100) || p.name } : p))
  const dbId = ws.createDatabase({ parentId: pageId, inline: !asPage, title: spec.title, properties, views: spec.views })
  for (const row of spec.rows) {
    const rowId = useWorkspace.getState().createRow(dbId, { title: row.title, properties: row.properties })
    if (row.body) useWorkspace.getState().setContent(rowId, markdownToDoc(withoutWebImages(row.body)), 'ai')
  }
  if (editor.isDestroyed) return dbId
  const node = asPage ? editor.schema.nodes.pageLink.create({ pageId: dbId }) : editor.schema.nodes.databaseBlock.create({ databaseId: dbId, viewId: null })
  const hit = runImage(editor, run)
  const at = hit ? belowImage(editor, hit) : editor.state.doc.content.size
  const tr = closeHistory(editor.state.tr).insert(at, node)
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(at + node.nodeSize, tr.doc.content.size)))).scrollIntoView()
  editor.view.dispatch(tr)
  editor.view.focus()
  useUI.getState().toast({ message: spec.rows.length === 1 ? t('features.ai.todb.doneOne') : t('features.ai.todb.done', { n: spec.rows.length }), kind: 'success' })
  return dbId
}

/* ------------------------------------------------------------------ */
/* A local copy of a web image                                          */
/* ------------------------------------------------------------------ */

function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.style.display = 'none'
    let done = false
    const finish = (f: File | null) => {
      if (done) return
      done = true
      window.removeEventListener('focus', onFocus)
      input.remove()
      resolve(f)
    }
    const onFocus = () => window.setTimeout(() => !input.files?.length && finish(null), 400)
    input.onchange = () => finish(input.files?.[0] ?? null)
    input.addEventListener('cancel', () => finish(null))
    document.body.appendChild(input)
    window.addEventListener('focus', onFocus)
    input.click()
  })
}

/**
 * "Upload a copy": the user picks the image file (downloaded from the site); it is stored on this device
 * and becomes the block's source. Resolves with the image as it is now, or null (cancelled / gone).
 */
export async function uploadImageCopy(editor: Editor, run: AIRun): Promise<ImageHit | null> {
  const file = await pickImageFile()
  if (!file || editor.isDestroyed) return null
  const ref = await saveFile(file, file.name)
  const hit = runImage(editor, run)
  if (!hit || editor.isDestroyed) return null
  editor.view.dispatch(editor.state.tr.setNodeMarkup(hit.pos, undefined, { ...hit.node.attrs, src: ref }))
  return imageAt(editor.state.doc, hit.pos)
}
