/**
 * An image block's picture, ready for Claude (an image content block: base64 + media type).
 *
 *  - local files ("onefile:<id>") come from IndexedDB, data: URLs and public assets are read directly,
 *    web images are fetched by this browser — a site that does not allow it (CORS) ends in a friendly
 *    'cors' issue: upload a copy. Nothing goes through a proxy.
 *  - long edge at most 1568 px (Claude's own limit — larger images are scaled down server-side anyway),
 *    at most 5 MB after base64 encoding. PNG / JPEG / WebP that already fit go as they are; everything else
 *    is drawn into a canvas: PNG for line art and tables (PNG, GIF, SVG sources), JPEG q 0.9 for photos
 *    (JPEG / WebP sources), smaller steps when it is still too big. GIF → its first frame, SVG → rasterised.
 */
import { FILE_PREFIX, getFile, readAsDataUrl, resolveAssetUrl } from '../../../lib/files'

export const IMAGE_MAX_EDGE = 1568
/** Base64 characters of one image at most (the API's 5 MB). */
export const IMAGE_MAX_BASE64 = 5 * 1024 * 1024
/** SVGs are rasterised at least this large on their long edge (crisp lines and labels). */
const SVG_MIN_EDGE = 1024

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** Why an image could not be sent. */
export type ImageIssue = 'missing' | 'cors' | 'offline' | 'decode' | 'too_large'

export class ImageLoadError extends Error {
  issue: ImageIssue
  constructor(issue: ImageIssue, detail?: string) {
    super(detail ? `${issue}: ${detail}` : issue)
    this.name = 'ImageLoadError'
    this.issue = issue
  }
}

/** What goes to Claude (and what the run shows of it). */
export interface LoadedImage {
  mediaType: ImageMediaType
  /** base64, no data: prefix */
  data: string
  width: number
  height: number
  /** bytes of the encoded image */
  bytes: number
  /** bytes of the original file */
  original: number
}

/** The meta of a sent image (kept with the run, without the pixels). */
export type ImageMeta = Omit<LoadedImage, 'data'>

const PASS = /^image\/(png|jpeg|webp)$/i
const base64Len = (bytes: number) => 4 * Math.ceil(bytes / 3)

const aborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

/** The original file of an image block's `src`. */
export async function imageBlob(src: string, signal?: AbortSignal): Promise<Blob> {
  if (src.startsWith(FILE_PREFIX)) {
    const f = await getFile(src)
    if (!f) throw new ImageLoadError('missing')
    return f.blob
  }
  const remote = /^https?:/i.test(src)
  let res: Response
  try {
    res = await fetch(remote ? src : resolveAssetUrl(src), remote ? { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal } : { signal })
  } catch (e) {
    aborted(signal)
    // a cross-origin image without CORS headers fails exactly like this; offline says so instead
    throw new ImageLoadError(remote && navigator.onLine ? 'cors' : 'offline', e instanceof Error ? e.message : String(e))
  }
  if (!res.ok) throw new ImageLoadError('missing', String(res.status))
  return res.blob()
}

/** The size of an image block's file when it is known without fetching (local / data: images), else null. */
export async function imageBytes(src: string): Promise<number | null> {
  if (src.startsWith(FILE_PREFIX)) return (await getFile(src).catch(() => undefined))?.size ?? null
  const m = src.match(/^data:[^,]*;base64,(.*)$/i)
  return m ? Math.floor((m[1].length * 3) / 4) : null
}

interface Decoded {
  img: HTMLImageElement
  width: number
  height: number
  release: () => void
}

async function decode(blob: Blob): Promise<Decoded> {
  const url = URL.createObjectURL(blob)
  const img = new Image()
  img.decoding = 'async'
  img.src = url
  try {
    await img.decode()
  } catch {
    URL.revokeObjectURL(url)
    throw new ImageLoadError('decode')
  }
  const svg = /svg/i.test(blob.type)
  let width = img.naturalWidth
  let height = img.naturalHeight
  // an SVG without a size: a 4:3 sheet
  if (!width || !height) [width, height] = [SVG_MIN_EDGE, Math.round((SVG_MIN_EDGE * 3) / 4)]
  if (svg) {
    const scale = Math.min(IMAGE_MAX_EDGE, Math.max(SVG_MIN_EDGE, width, height)) / Math.max(width, height)
    width = Math.round(width * scale)
    height = Math.round(height * scale)
  }
  return { img, width, height, release: () => URL.revokeObjectURL(url) }
}

function canvasBlob(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new ImageLoadError('decode'))), type, quality))
}

async function toBase64(blob: Blob): Promise<string> {
  const url = await readAsDataUrl(blob)
  return url.slice(url.indexOf(',') + 1)
}

/**
 * The image of a block, sized and encoded for Claude. Throws ImageLoadError ('missing', 'cors',
 * 'offline', 'decode', 'too_large') or an AbortError.
 */
export async function loadImageForClaude(src: string, signal?: AbortSignal): Promise<LoadedImage> {
  const blob = await imageBlob(src, signal)
  aborted(signal)
  const d = await decode(blob)
  try {
    aborted(signal)
    const long = Math.max(d.width, d.height)
    const type = blob.type.toLowerCase()
    // already fine: sent as it is (EXIF orientation and all)
    if (PASS.test(type) && long <= IMAGE_MAX_EDGE && base64Len(blob.size) <= IMAGE_MAX_BASE64) {
      return { mediaType: type as ImageMediaType, data: await toBase64(blob), width: d.width, height: d.height, bytes: blob.size, original: blob.size }
    }
    const photo = /^image\/(jpeg|webp|avif|heic|heif)$/.test(type)
    let scale = Math.min(1, IMAGE_MAX_EDGE / long)
    for (let round = 0; round < 5; round++) {
      const w = Math.max(1, Math.round(d.width * scale))
      const h = Math.max(1, Math.round(d.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new ImageLoadError('decode')
      // JPEG has no transparency: white paper behind it (tables and line art read best on white)
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(d.img, 0, 0, w, h)
      const tries: Array<['image/png' | 'image/jpeg', number | undefined]> = photo
        ? [['image/jpeg', 0.9], ['image/jpeg', 0.8]]
        : [['image/png', undefined], ['image/jpeg', 0.92], ['image/jpeg', 0.8]]
      for (const [mime, q] of tries) {
        const out = await canvasBlob(canvas, mime, q)
        aborted(signal)
        if (base64Len(out.size) <= IMAGE_MAX_BASE64) return { mediaType: mime, data: await toBase64(out), width: w, height: h, bytes: out.size, original: blob.size }
      }
      scale *= 0.75
    }
    throw new ImageLoadError('too_large')
  } finally {
    d.release()
  }
}

/** "1.2 MB" / "640 KB" in the UI language. */
export function formatBytes(bytes: number, lang: string): string {
  const loc = lang === 'de' ? 'de-DE' : 'en-US'
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toLocaleString(loc, { maximumFractionDigits: 1 })} MB`
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString(loc)} KB`
}
