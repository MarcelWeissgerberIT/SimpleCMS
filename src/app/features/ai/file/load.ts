/**
 * A file block's file, read in this browser — for Claude (a PDF as a base64 `document`, everything else as
 * its text) and for the local conversions.
 *
 *  - local files ("onefile:<id>") come from IndexedDB (a team workspace fetches missing ones), data: URLs and
 *    public assets are read directly, web files are fetched by this browser — a site that does not allow it
 *    (CORS) ends in a friendly 'cors' issue: upload a copy. Nothing goes through a proxy.
 *  - Claude's limits (Messages API, document blocks): a request is at most 32 MB, a PDF at most 600 pages
 *    (100 on the 200k-context Haiku 4.5). The PDF goes base64 (4 / 3 of its size) with the page text and the
 *    prompt, so a PDF may have at most PDF_MAX_BYTES; its pages are counted here first (page objects, also
 *    inside compressed object streams) — a larger one is refused before anything is sent, with the numbers.
 *  - text sent to Claude is at most TEXT_MAX_CHARS characters; a longer file is cut, and the panel says so.
 */
import { unzlibUpTo } from './zip'
import { FILE_PREFIX, getFile, readAsDataUrl, resolveAssetUrl } from '../../../lib/files'

/** PDF bytes at most: base64 (× 4 / 3) + page context + prompt stay below the API's 32 MB per request. */
export const PDF_MAX_BYTES = 23 * 1024 * 1024
/** Pages of one PDF at most (1M-context models) · on Claude Haiku 4.5 (200k context). */
export const PDF_MAX_PAGES = 600
export const PDF_MAX_PAGES_SMALL = 100
/** Files converted here at most (Word, Excel, CSV, text …) — what a mail attachment may be. */
export const FILE_READ_MAX = 25 * 1024 * 1024
/** Characters of a text file sent to Claude at most (about 100k tokens). */
export const TEXT_MAX_CHARS = 400_000

/** Why a file could not be used. */
export type FileIssue = 'missing' | 'cors' | 'offline' | 'too_large' | 'pages' | 'unreadable' | 'empty'

/** A refusal with the numbers the message needs. */
export interface FileProblem {
  issue: FileIssue
  /** the file's size (too_large) */
  bytes?: number
  /** its pages (pages) */
  pages?: number
  /** the limit (bytes for too_large, pages for pages) */
  max?: number
}

export class FileLoadError extends Error {
  problem: FileProblem
  constructor(problem: FileProblem | FileIssue, detail?: string) {
    const p = typeof problem === 'string' ? { issue: problem } : problem
    super(detail ? `${p.issue}: ${detail}` : p.issue)
    this.name = 'FileLoadError'
    this.problem = p
  }
}

const aborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

/** The file of a block's `src` (with the type it was stored with). */
export async function fileBlob(src: string, signal?: AbortSignal): Promise<Blob> {
  if (src.startsWith(FILE_PREFIX)) {
    const f = await getFile(src)
    if (!f) throw new FileLoadError('missing')
    return f.blob
  }
  const remote = /^https?:/i.test(src)
  let res: Response
  try {
    res = await fetch(remote ? src : resolveAssetUrl(src), remote ? { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal } : { signal })
  } catch (e) {
    aborted(signal)
    // a cross-origin file without CORS headers fails exactly like this; offline says so instead
    throw new FileLoadError(remote && navigator.onLine ? 'cors' : 'offline', e instanceof Error ? e.message : String(e))
  }
  if (!res.ok) throw new FileLoadError('missing', String(res.status))
  return res.blob()
}

/** The size of a block's file when it is known without fetching (local files), else null. */
export async function fileBytes(src: string): Promise<number | null> {
  if (src.startsWith(FILE_PREFIX)) return (await getFile(src).catch(() => undefined))?.size ?? null
  const m = src.match(/^data:[^,]*;base64,(.*)$/i)
  return m ? Math.floor((m[1].length * 3) / 4) : null
}

/** The bytes of a block's file, refused above `max`. */
export async function fileData(src: string, max: number, signal?: AbortSignal): Promise<{ bytes: Uint8Array; type: string }> {
  const blob = await fileBlob(src, signal)
  aborted(signal)
  if (blob.size > max) throw new FileLoadError({ issue: 'too_large', bytes: blob.size, max })
  if (!blob.size) throw new FileLoadError('empty')
  const bytes = new Uint8Array(await blob.arrayBuffer())
  aborted(signal)
  return { bytes, type: blob.type }
}

export const isPdfBytes = (b: Uint8Array): boolean => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d

/* ------------------------------------------------------------------ */
/* PDF pages                                                            */
/* ------------------------------------------------------------------ */

const latin1 = (b: Uint8Array) => new TextDecoder('latin1').decode(b)
const PAGE = /\/Type\s*\/Page(?![A-Za-z])/g
/** Bytes of one compressed object stream read for page counting at most. */
const OBJSTM_MAX = 8 * 1024 * 1024

/**
 * The pages of a PDF: the root page tree's /Count, else its page objects (also those inside compressed
 * object streams, PDF 1.5+). Null when neither can be found (Claude then checks it itself).
 */
export function pdfPageCount(bytes: Uint8Array): number | null {
  const all = latin1(bytes)
  // up to the last "endobj": an object that never ends would make every later start scan to the end
  const stop = all.lastIndexOf('endobj')
  const text = stop < 0 ? '' : all.slice(0, stop + 6)
  let count = 0
  let objects = 0
  const OBJ = /\d+\s+\d+\s+obj\b([\s\S]*?)\bendobj\b/g
  for (let m = OBJ.exec(text); m; m = OBJ.exec(text)) {
    const body = m[1]
    const s = body.search(/\bstream\r?\n/)
    const dict = s < 0 ? body : body.slice(0, s)
    if (/\/Type\s*\/Pages\b/.test(dict)) {
      const c = Number(dict.match(/\/Count\s+(\d+)/)?.[1] ?? 0)
      if (c > count) count = c
    } else if (/\/Type\s*\/Page(?![A-Za-z])/.test(dict)) objects++
    else if (s >= 0 && /\/Type\s*\/ObjStm\b/.test(dict) && /\/FlateDecode\b/.test(dict)) objects += pagesInObjStm(body.slice(s).replace(/^stream\r?\n/, ''))
  }
  if (count) return count
  return objects || null
}

/** Page objects inside one compressed object stream. */
function pagesInObjStm(raw: string): number {
  const end = raw.lastIndexOf('endstream')
  const data = (end < 0 ? raw : raw.slice(0, end)).replace(/\r?\n$/, '')
  const bytes = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i) & 0xff
  try {
    // a stream that inflates without end (a crafted PDF) is read only so far: enough to count pages
    return latin1(unzlibUpTo(bytes, OBJSTM_MAX)).match(PAGE)?.length ?? 0
  } catch {
    return 0
  }
}

/* ------------------------------------------------------------------ */
/* For Claude                                                           */
/* ------------------------------------------------------------------ */

/** A PDF ready for a `document` block. */
export interface LoadedPdf {
  /** base64, no data: prefix */
  data: string
  bytes: number
  pages: number | null
}

/** The PDF of a block, checked against the API's limits. Throws FileLoadError or an AbortError. */
export async function loadPdfForClaude(src: string, maxPages: number, signal?: AbortSignal): Promise<LoadedPdf> {
  const blob = await fileBlob(src, signal)
  aborted(signal)
  if (blob.size > PDF_MAX_BYTES) throw new FileLoadError({ issue: 'too_large', bytes: blob.size, max: PDF_MAX_BYTES })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  aborted(signal)
  if (!isPdfBytes(bytes)) throw new FileLoadError('unreadable', 'not a PDF')
  const pages = pdfPageCount(bytes)
  if (pages && pages > maxPages) throw new FileLoadError({ issue: 'pages', pages, max: maxPages })
  const url = await readAsDataUrl(new Blob([bytes], { type: 'application/pdf' }))
  aborted(signal)
  return { data: url.slice(url.indexOf(',') + 1), bytes: blob.size, pages }
}

/** Text for Claude: at most TEXT_MAX_CHARS (cut at a line end when one is near). */
export function clipText(text: string): { text: string; clipped: boolean } {
  if (text.length <= TEXT_MAX_CHARS) return { text, clipped: false }
  const cut = text.lastIndexOf('\n', TEXT_MAX_CHARS)
  return { text: text.slice(0, cut > TEXT_MAX_CHARS - 2000 ? cut : TEXT_MAX_CHARS), clipped: true }
}

/** "1.2 MB" / "640 KB" / "426 B" in the UI language. */
export function formatBytes(bytes: number, lang: string): string {
  const loc = lang === 'de' ? 'de-DE' : 'en-US'
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toLocaleString(loc, { maximumFractionDigits: 1 })} MB`
  if (bytes < 1024) return `${bytes} B`
  return `${Math.round(bytes / 1024).toLocaleString(loc)} KB`
}
