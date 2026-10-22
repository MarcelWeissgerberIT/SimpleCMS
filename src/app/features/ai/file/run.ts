/**
 * The file part of a background run (runs.ts, request kind 'file'):
 *  - Claude actions: load the file (a PDF checked against the API's size and page limits, anything else
 *    converted to text here), send it with the task, return the answer (Markdown; JSON for tables)
 *  - local actions: convert here and return the result as JSON — { title, doc, images } for a page,
 *    { sheets } for tables. Nothing is sent.
 */
import { useWorkspace } from '../../../store/store'
import { stripFence, type RouteOptions } from '../client'
import { precheck } from '../core/gate'
import { routeFor } from '../core/status'
import { capsFor } from '../core/registry'
import type { Caps, SourceRef } from '@/shared/ai/types'
import { withoutWebImages } from '../../agents/images'
import { clipText, fileData, FILE_READ_MAX, loadPdfForClaude, PDF_MAX_PAGES } from './load'
import { filePage, fileSheets, fileText } from './convert'
import { PPTX_MAX_BYTES } from '../../io/import/pptx'
import { isLocalAction, type FileAction, type FileKind } from './kinds'
import { requestFile, type ClaudeFileAction, type FileMaterial } from './request'

export { FileLoadError, type FileIssue, type FileProblem } from './load'
export type { FileAction, FileKind } from './kinds'

/** A file request as a run keeps it (plain data: it survives a reload). */
export interface FileRunRequest {
  kind: 'file'
  action: FileAction
  label: string
  code: string
  /** the file block's source, name and block id when the request started */
  src: string
  name: string
  blockId: string | null
  fileKind: FileKind
  /** 'ask': the question */
  question?: string
  /** a revision of an earlier answer */
  instruction?: string
}

/** What a run keeps of its file (never the content). */
export interface FileMeta {
  kind: FileKind
  bytes: number
  /** a PDF's pages (null: not counted) */
  pages?: number | null
  /** text sent: its characters (after the cut) · cut to the limit */
  chars?: number
  clipped?: boolean
  /** went to Claude (false: converted on this device) */
  sent: boolean
  /** Copilot receives locally extracted PDF text, never its figures or layout. */
  textOnly?: true
}

/**
 * Pages the model reads of one PDF (its caps: 600, 100 on a 200K-context model) — the caps of the route the request
 * resolved to (precheck), else the route a request of this purpose would take on this device (routeFor).
 */
export function maxPdfPages(caps?: Caps | null, purpose: 'documents.file' | 'terminal.task' = 'documents.file'): number {
  const r = caps === undefined ? routeFor(purpose) : null
  const pdf = (r ? capsFor(r.route, r.pool) : caps)?.pdf
  return pdf ? pdf.maxPages : PDF_MAX_PAGES
}

export async function runFileRequest(
  req: FileRunRequest,
  context: string,
  opts: { sources: readonly SourceRef[]; onToken?: (delta: string) => void; signal: AbortSignal; onFile?: (meta: FileMeta) => void } & Pick<RouteOptions, 'route' | 'applied' | 'carries'>,
): Promise<string> {
  const { signal } = opts
  // the route the caller built the page context for (its chip / the rules), what that text went through
  const gate = { purpose: 'documents.file' as const, sources: opts.sources, typed: [req.question, req.instruction], route: opts.route, applied: opts.applied, carries: opts.carries }
  // a deck is mostly pictures: it may be larger (its unpacked size is checked while reading it)
  const readMax = req.fileKind === 'pptx' ? PPTX_MAX_BYTES : FILE_READ_MAX
  if (isLocalAction(req.action)) {
    const { bytes } = await fileData(req.src, readMax, signal)
    opts.onFile?.({ kind: req.fileKind, bytes: bytes.byteLength, sent: false })
    if (req.action === 'page') return JSON.stringify(await filePage(req.fileKind, bytes, req.name))
    return JSON.stringify({ sheets: fileSheets(req.fileKind, bytes, req.name) })
  }
  // the gate first: a refused request never loads the file (a PDF needs a model that reads PDFs)
  const pre = precheck({ ...gate, needs: req.fileKind === 'pdf' ? ['pdf'] : [] })
  let material: FileMaterial
  if (req.fileKind === 'pdf') {
    const pdf = await loadPdfForClaude(req.src, maxPdfPages(pre.caps), signal)
    opts.onFile?.({ kind: 'pdf', bytes: pdf.bytes, pages: pdf.pages, sent: true, ...(pre.route?.p === 'copilot' ? {textOnly:true as const} : {}) })
    material = { type: 'pdf', name: req.name, data: pdf.data, pages: pdf.pages }
  } else {
    const { bytes } = await fileData(req.src, readMax, signal)
    const got = await fileText(req.fileKind, bytes, req.name)
    const { text, clipped } = clipText(got.text)
    opts.onFile?.({ kind: req.fileKind, bytes: bytes.byteLength, chars: text.length, clipped, sent: true })
    material = { type: 'text', name: req.name, text, format: got.format, clipped }
  }
  const lang = useWorkspace.getState().settings.language === 'de' ? 'de' : 'en'
  const action = req.action as ClaudeFileAction
  const text = await requestFile({
    ...gate,
    action,
    material,
    question: req.question,
    instruction: req.instruction,
    context,
    lang,
    // tables are not shown while they stream (the panel waits for the whole JSON)
    onToken: action === 'tables' ? undefined : opts.onToken,
    signal,
  })
  // whatever the file said: an image in the answer never loads by itself (it becomes a link)
  return action === 'tables' ? text.trim() : withoutWebImages(stripFence(text))
}
