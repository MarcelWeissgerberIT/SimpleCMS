/**
 * "Save to One" for a media card — only ever on a click:
 *
 *  - the bytes: inline ones from the result, else fetched by this browser (credentials 'omit', no referrer,
 *    no proxy). A host that does not allow it (CORS) ends in 'cors': the card then offers Open, Upload a copy
 *    and — in a team workspace — "Fetch through the team server" (fetchThroughTeam).
 *  - checks: at most 50 MB for an image, 200 MB for video / audio; the declared type must be image / video /
 *    audio and the bytes' magic numbers must agree (sniff.ts). SVG is stored as application/octet-stream and
 *    becomes a file block (download only — like mail attachments): it can carry script.
 *  - stored with saveFile() → "onefile:<id>" (IndexedDB; a team workspace uploads it in the background).
 */
import { saveFile } from '../../../lib/files'
import { activeWorkspace, cloudRequest, useCloud, CloudError } from '../../../cloud'
import { extOf, sniff } from './sniff'
import type { MediaIssue, MediaItem, MediaKind, SavedMedia } from './types'

export const IMAGE_CAP = 50 * 1024 * 1024
export const MEDIA_CAP = 200 * 1024 * 1024
const SAFE = 'application/octet-stream'

export const capOf = (kind: MediaKind) => (kind === 'image' ? IMAGE_CAP : MEDIA_CAP)

export class MediaSaveError extends Error {
  issue: MediaIssue
  constructor(issue: MediaIssue, detail?: string) {
    super(detail ? `${issue}: ${detail}` : issue)
    this.name = 'MediaSaveError'
    this.issue = issue
  }
}

/** Where the media will be used: the caption and alt text say what it was made from. */
export function captionOf(item: Pick<MediaItem, 'prompt' | 'tool' | 'server'>): { caption: string; alt: string } {
  const what = item.prompt || item.tool || ''
  const server = item.server ? item.server.toUpperCase() : ''
  return { caption: [what, server].filter(Boolean).join(' — '), alt: item.prompt }
}

/** A file name from the address (or the tool), with the extension of what was stored. */
export function nameOf(item: MediaItem, mime: string, n = 1): string {
  let base = ''
  if (item.url) {
    try {
      const last = new URL(item.url).pathname.split('/').filter(Boolean).pop() ?? ''
      base = decodeURIComponent(last)
    } catch {
      base = ''
    }
  }
  base = base.replace(/[\u0000-\u001f\u007f/\\]/g, '').replace(/\.[a-z0-9]{1,5}$/i, '').slice(0, 80)
  if (!base) base = `${(item.tool || item.server || 'media').replace(/[^\w-]+/g, '-').slice(0, 40)}-${n}`
  const ext = extOf(mime)
  return ext ? `${base}.${ext}` : base
}

function decodeBase64(data: string): Uint8Array {
  const bin = atob(data.replace(/\s+/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Read a response body, at most `cap` bytes (more: 'too_large', the download stops). */
async function readCapped(res: Response, cap: number, signal?: AbortSignal): Promise<Uint8Array> {
  const reader = res.body?.getReader()
  if (!reader) return new Uint8Array(await res.arrayBuffer())
  const parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    if (signal?.aborted) {
      await reader.cancel().catch(() => {})
      throw new MediaSaveError('aborted')
    }
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > cap) {
      await reader.cancel().catch(() => {})
      throw new MediaSaveError('too_large')
    }
    parts.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** Download the address in this browser. Throws MediaSaveError. */
export async function download(item: MediaItem, signal?: AbortSignal): Promise<{ bytes: Uint8Array; type: string }> {
  if (!item.url) throw new MediaSaveError('gone')
  let res: Response
  try {
    res = await fetch(item.url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'follow', signal })
  } catch (e) {
    if (signal?.aborted) throw new MediaSaveError('aborted')
    // a cross-origin file without CORS headers fails exactly like this; offline says so instead
    throw new MediaSaveError(navigator.onLine === false ? 'offline' : 'cors', e instanceof Error ? e.message : String(e))
  }
  if (!res.ok) throw new MediaSaveError('http', String(res.status))
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  const cap = capOf(item.kind)
  const declared = Number(res.headers.get('content-length') ?? NaN)
  if (Number.isFinite(declared) && declared > cap) {
    await res.body?.cancel().catch(() => {})
    throw new MediaSaveError('too_large')
  }
  return { bytes: await readCapped(res, cap, signal), type }
}

/**
 * The bytes checked against the declared type: image / video / audio only, the magic numbers must agree.
 * Returns what to store: the blob (SVG as application/octet-stream) and the block it becomes.
 */
export function checked(bytes: Uint8Array, declared: string, cap: number): { blob: Blob; mime: string; kind: MediaKind | 'file' } {
  if (!bytes.length) throw new MediaSaveError('empty')
  if (bytes.length > cap) throw new MediaSaveError('too_large')
  const family = declared.split('/')[0]
  if (family !== 'image' && family !== 'video' && family !== 'audio') throw new MediaSaveError('type', declared || 'none')
  const got = sniff(bytes)
  if (!got || !got.kinds.includes(family)) throw new MediaSaveError('mismatch', `${declared} vs ${got?.mime ?? 'unknown'}`)
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  if (got.svg) return { blob: new Blob([copy.buffer], { type: SAFE }), mime: 'image/svg+xml', kind: 'file' }
  // the container's own type for the family that was declared (an MP4 declared as audio stays audio)
  const mime = got.kinds[0] === family ? got.mime : declared
  return { blob: new Blob([copy.buffer], { type: mime }), mime, kind: family }
}

/** Save one card's media to One (this browser fetches it). Throws MediaSaveError. */
export async function saveMediaItem(item: MediaItem, opts: { signal?: AbortSignal; n?: number } = {}): Promise<SavedMedia> {
  let bytes: Uint8Array
  let declared: string
  if (item.data) {
    try {
      bytes = decodeBase64(item.data)
    } catch {
      throw new MediaSaveError('mismatch', 'not base64')
    }
    declared = (item.mime ?? '').toLowerCase()
  } else {
    const got = await download(item, opts.signal)
    bytes = got.bytes
    // the host's type counts; a result that declared one and a host that sends none (rare) — the result's
    declared = got.type || (item.mime ?? '')
  }
  const out = checked(bytes, declared, capOf(item.kind))
  const name = nameOf(item, out.mime, opts.n)
  const src = await saveFile(out.blob, name)
  return { src, kind: out.kind, name, size: out.blob.size, mime: out.mime, ...captionOf(item), itemId: item.id }
}

/** "Upload a copy": a file the person picked (the host refused this browser) — the same checks. */
export async function saveUploadedCopy(item: MediaItem, file: File): Promise<SavedMedia> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const declared = (file.type || sniff(bytes)?.mime || '').toLowerCase()
  const out = checked(bytes, declared, capOf(item.kind))
  const name = file.name.replace(/[\u0000-\u001f\u007f/\\]/g, '').slice(0, 120) || nameOf(item, out.mime)
  const src = await saveFile(out.blob, name)
  return { src, kind: out.kind, name, size: out.blob.size, mime: out.mime, ...captionOf(item), itemId: item.id }
}

/** A file picker for one image / video / audio file (null: cancelled). */
export function pickMediaFile(kind: MediaKind): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = `${kind}/*`
    input.style.display = 'none'
    let done = false
    const finish = (f: File | null) => {
      if (done) return
      done = true
      input.remove()
      resolve(f)
    }
    input.addEventListener('change', () => finish(input.files?.[0] ?? null))
    input.addEventListener('cancel', () => finish(null))
    document.body.append(input)
    input.click()
  })
}

/** The team server can fetch for this workspace (a team workspace this member may write to). */
export function teamFetchAvailable(): boolean {
  const c = useCloud.getState()
  return activeWorkspace().kind === 'cloud' && c.status !== 'local' && !c.readOnly
}

interface FetchedFile {
  id: string
  name: string
  mime: string
  size: number
  kind: MediaKind | 'file'
}

/**
 * "Fetch through the team server": the server downloads the address for this member (https only, no
 * private / loopback addresses, redirects checked again, size cap, image / video / audio only — docs/API.md)
 * and stores it as a workspace file; the block references it as "onefile:<id>" like an upload.
 */
export async function fetchThroughTeam(item: MediaItem, opts: { private?: boolean } = {}): Promise<SavedMedia> {
  const ws = activeWorkspace()
  if (ws.kind !== 'cloud' || !item.url) throw new MediaSaveError('server')
  let got: FetchedFile
  try {
    got = await cloudRequest<FetchedFile>('POST', `api/workspaces/${encodeURIComponent(ws.id)}/files/fetch`, { url: item.url, kind: item.kind, ...(opts.private ? { private: true } : {}) })
  } catch (e) {
    const code = e instanceof CloudError ? e.code : ''
    throw new MediaSaveError(code === 'url_blocked' ? 'blocked' : code === 'file_too_large' ? 'too_large' : code === 'media_type' ? 'type' : code === 'media_mismatch' ? 'mismatch' : 'server', code || (e instanceof Error ? e.message : String(e)))
  }
  if (!got || typeof got.id !== 'string' || !/^[\w-]{1,64}$/.test(got.id)) throw new MediaSaveError('server')
  return { src: `onefile:${got.id}`, kind: got.kind, name: got.name, size: got.size, mime: got.mime, ...captionOf(item), itemId: item.id }
}
