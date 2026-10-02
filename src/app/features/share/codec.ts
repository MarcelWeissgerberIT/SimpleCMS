/**
 * Serverless share links: the page itself is the URL.
 *   #/s/<base64url(deflate(JSON))>
 * Internal references (page links, mentions, embedded databases) are flattened into
 * self-contained content; local images ("onefile:") are inlined as data URLs when small
 * enough (re-encoded if needed), otherwise replaced by a note.
 */
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate'
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../store/store'
import type { ID, Page, PageCover, PageIcon } from '../../store/types'
import { FILE_PREFIX, getFile, readAsDataUrl } from '../../lib/files'
import { propertyValueToText } from '../../database'
import { t } from '../../i18n'

export interface SharePayload {
  v: 1
  title: string
  icon: PageIcon | null
  cover: PageCover | null
  content: JSONContent | null
  /** created at (ms) */
  at?: number
}

export interface PrepareStats {
  images: number
  inlined: number
  dropped: number
  /** bytes of inlined images (after re-encoding) */
  imageBytes: number
}

/** Inline local images in a share link only up to this total. */
export const SHARE_IMAGE_BUDGET = 300 * 1024
/** Links above this size get a warning (some chat apps cut them). */
export const SHARE_WARN_BYTES = 50 * 1024

export class ShareDecodeError extends Error {
  code: 'empty' | 'corrupt' | 'version'
  constructor(code: 'empty' | 'corrupt' | 'version') {
    super(code)
    this.code = code
  }
}

/* ------------------------------------------------------------------ */
/* base64url                                                           */
/* ------------------------------------------------------------------ */

export function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : ''
  const bin = atob(b64 + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/* ------------------------------------------------------------------ */
/* encode / decode                                                     */
/* ------------------------------------------------------------------ */

export function encodePayload(p: SharePayload): string {
  return bytesToBase64Url(deflateSync(strToU8(JSON.stringify(p)), { level: 9 }))
}

export function decodePayload(raw: string): SharePayload {
  let s = (raw ?? '').trim()
  try {
    s = decodeURIComponent(s)
  } catch {
    /* already decoded */
  }
  s = s.replace(/[\s=]/g, '')
  if (!s) throw new ShareDecodeError('empty')
  let data: unknown
  try {
    data = JSON.parse(strFromU8(inflateSync(base64UrlToBytes(s))))
  } catch {
    throw new ShareDecodeError('corrupt')
  }
  if (!data || typeof data !== 'object') throw new ShareDecodeError('corrupt')
  const d = data as Partial<SharePayload>
  if (d.v !== 1) throw new ShareDecodeError('version')
  const content = d.content && typeof d.content === 'object' && d.content.type === 'doc' ? sanitizeShared(d.content) : null
  return {
    v: 1,
    title: typeof d.title === 'string' ? d.title.slice(0, 500) : '',
    icon: sanitizeIcon(d.icon),
    cover: sanitizeCover(d.cover),
    content,
    at: typeof d.at === 'number' ? d.at : undefined,
  }
}

function sanitizeIcon(icon: unknown): PageIcon | null {
  const i = icon as PageIcon | null
  if (!i || typeof i !== 'object' || typeof i.value !== 'string') return null
  if (i.type === 'emoji') return { type: 'emoji', value: i.value.slice(0, 16) }
  if (i.type === 'asset' && /^[\w-]{1,64}$/.test(i.value)) return { type: 'asset', value: i.value }
  if (i.type === 'lucide' && /^[A-Za-z0-9]{1,64}$/.test(i.value)) return { type: 'lucide', value: i.value, color: i.color }
  return null
}

const COVER_URL = /^(https:\/\/|assets\/[\w./-]+$|data:image\/(png|jpe?g|webp|gif|avif);base64,)/i
function sanitizeCover(cover: unknown): PageCover | null {
  const c = cover as PageCover | null
  if (!c || typeof c !== 'object' || typeof c.value !== 'string') return null
  const positionY = Math.max(0, Math.min(100, Number(c.positionY) || 50))
  if (c.type === 'image' && COVER_URL.test(c.value)) return { type: 'image', value: c.value, positionY }
  // gradients: allow only gradient functions / colours (no url(), no expressions)
  if (c.type === 'gradient' && /^[\w\s#%(),.-]+$/.test(c.value) && !/url\s*\(/i.test(c.value)) return { type: 'gradient', value: c.value, positionY }
  if (c.type === 'color') return { type: 'color', value: c.value, positionY }
  return null
}

const SAFE_HREF = /^(https?:|mailto:|tel:|#(?!\/p\/))/i
const SAFE_SRC = /^(https:\/\/|data:image\/(png|jpe?g|webp|gif|avif|svg\+xml);base64,|assets\/)/i

/** Defensive cleanup of a received doc: unsafe links and sources are removed. Schema validation happens in ReadOnlyDoc. */
function sanitizeShared(node: JSONContent): JSONContent {
  const n: JSONContent = { ...node }
  if (n.marks) n.marks = n.marks.filter((m) => m.type !== 'link' || SAFE_HREF.test(String(m.attrs?.href ?? '')))
  if (n.attrs) {
    const a = { ...n.attrs }
    if ('src' in a && a.src && !SAFE_SRC.test(String(a.src))) a.src = ''
    if (n.type === 'bookmark' && a.image && !SAFE_SRC.test(String(a.image))) a.image = null
    if ((n.type === 'bookmark' || n.type === 'embed') && a.url && !/^https?:\/\//i.test(String(a.url))) a.url = ''
    n.attrs = a
  }
  if (n.content) n.content = n.content.map(sanitizeShared)
  return n
}

/* ------------------------------------------------------------------ */
/* Preparing a page for sharing / export                               */
/* ------------------------------------------------------------------ */

const text = (s: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text: s, ...(marks ? { marks } : {}) })
const para = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content: content.filter((c) => c.text !== '') })

function iconPrefix(p: Page | undefined): string {
  return p?.icon?.type === 'emoji' ? `${p.icon.value} ` : ''
}

function databaseTable(dbId: ID, pages: Record<ID, Page>): JSONContent[] {
  const st = useWorkspace.getState()
  const db = st.databases[dbId]
  const dbPage = pages[dbId]
  const title = `${iconPrefix(dbPage)}${dbPage?.title?.trim() || t('common.untitled')}`
  if (!db) return [para(text(title, [{ type: 'bold' }]))]
  const view = db.views[0]
  const titleProp = db.properties.find((p) => p.type === 'title')
  const visible = (view?.visibleProperties ?? db.properties.map((p) => p.id))
    .map((id) => db.properties.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => !!p && p.type !== 'title')
    .slice(0, 5)
  const cols = titleProp ? [titleProp, ...visible] : visible
  const rows = Object.values(pages)
    .filter((p) => p.databaseId === dbId && !p.trashed)
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
  const shown = rows.slice(0, 50)
  const cell = (type: 'tableHeader' | 'tableCell', s: string): JSONContent => ({ type, content: [s ? para(text(s)) : { type: 'paragraph' }] })
  const out: JSONContent[] = [para(text(title, [{ type: 'bold' }]))]
  if (!cols.length) return out
  out.push({
    type: 'table',
    content: [
      { type: 'tableRow', content: cols.map((c) => cell('tableHeader', c.name)) },
      ...shown.map((r) => ({
        type: 'tableRow',
        content: cols.map((c) => {
          let v = ''
          try {
            v = c.type === 'title' ? r.title : propertyValueToText(db, c, r)
          } catch {
            v = ''
          }
          return cell('tableCell', v.slice(0, 300))
        }),
      })),
    ],
  })
  if (rows.length > shown.length) out.push(para(text(t('features.share.moreRows', { count: rows.length - shown.length }), [{ type: 'italic' }])))
  return out
}

/** Make a doc self-contained: no references into this workspace remain. Image refs are collected. */
function flatten(nodes: JSONContent[] | undefined, pages: Record<ID, Page>, images: Set<string>): JSONContent[] {
  if (!nodes) return []
  const out: JSONContent[] = []
  for (const raw of nodes) {
    const n: JSONContent = { ...raw }
    if (n.marks) {
      n.marks = n.marks.filter((m) => !(m.type === 'link' && /^#\/p\//.test(String(m.attrs?.href ?? ''))))
      if (!n.marks.length) delete n.marks
    }
    switch (n.type) {
      case 'pageLink': {
        const p = pages[String(n.attrs?.pageId ?? '')]
        out.push(para(text(`→ ${iconPrefix(p)}${p?.title?.trim() || t('common.untitled')}`, [{ type: 'bold' }])))
        continue
      }
      case 'databaseBlock':
        out.push(...databaseTable(String(n.attrs?.databaseId ?? ''), pages))
        continue
      case 'mention': {
        if (n.attrs?.kind === 'page') {
          const p = pages[String(n.attrs?.id ?? '')]
          out.push(text(`@${p?.title?.trim() || n.attrs?.label || t('common.untitled')}`, n.marks))
          continue
        }
        break
      }
      case 'fileBlock': {
        const src = String(n.attrs?.src ?? '')
        if (src.startsWith(FILE_PREFIX) || !src) {
          out.push(para(text(`📎 ${n.attrs?.name ?? 'file'} — ${t('features.share.fileNotIncluded')}`, [{ type: 'italic' }])))
          continue
        }
        break
      }
      case 'image': {
        const src = String(n.attrs?.src ?? '')
        if (src.startsWith(FILE_PREFIX)) images.add(src)
        break
      }
    }
    if (n.content) n.content = flatten(n.content, pages, images)
    out.push(n)
  }
  return out
}

function replaceImages(nodes: JSONContent[] | undefined, map: Map<string, string | null>): JSONContent[] {
  if (!nodes) return []
  return nodes.map((n) => {
    if (n.type === 'image') {
      const src = String(n.attrs?.src ?? '')
      if (map.has(src)) {
        const url = map.get(src)
        if (url) return { ...n, attrs: { ...n.attrs, src: url } }
        const label = String(n.attrs?.alt || n.attrs?.caption || '').trim()
        return para(text(`▢ ${t('features.share.imageNotIncluded')}${label ? ` — ${label}` : ''}`, [{ type: 'italic' }]))
      }
    }
    return n.content ? { ...n, content: replaceImages(n.content, map) } : n
  })
}

/** Re-encode an image as WebP within a max edge length; resolves null if not possible. */
async function shrinkImage(blob: Blob, maxEdge: number, quality: number): Promise<Blob | null> {
  try {
    if (blob.type === 'image/svg+xml' || blob.type === 'image/gif') return null
    const bmp = await createImageBitmap(blob)
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close?.()
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/webp', quality))
  } catch {
    return null
  }
}

/**
 * Turn a page into a self-contained payload.
 * budget: max total bytes of inlined images (Infinity for file exports).
 */
export async function preparePage(pageId: ID, budget = SHARE_IMAGE_BUDGET): Promise<{ payload: SharePayload; stats: PrepareStats }> {
  const st = useWorkspace.getState()
  const page = st.pages[pageId]
  if (!page) throw new Error('Page not found')
  const images = new Set<string>()
  const content: JSONContent | null = page.content ? { ...page.content, content: flatten(page.content.content, st.pages, images) } : null
  const stats: PrepareStats = { images: images.size, inlined: 0, dropped: 0, imageBytes: 0 }

  const map = new Map<string, string | null>()
  if (images.size) {
    const files = await Promise.all([...images].map(async (ref) => ({ ref, file: await getFile(ref).catch(() => undefined) })))
    let blobs = files.map(({ ref, file }) => ({ ref, blob: file?.blob ?? null }))
    const total = () => blobs.reduce((s, b) => s + (b.blob?.size ?? 0), 0)
    if (Number.isFinite(budget) && budget > 0 && total() > budget) {
      // try progressively smaller re-encodes before giving up on inlining
      for (const [edge, q] of [
        [1400, 0.8],
        [1000, 0.7],
        [720, 0.6],
      ] as const) {
        const next = await Promise.all(blobs.map(async (b) => ({ ref: b.ref, blob: b.blob ? ((await shrinkImage(b.blob, edge, q)) ?? b.blob) : null })))
        blobs = next.map((b, i) => (b.blob && blobs[i].blob && b.blob.size < blobs[i].blob!.size ? b : blobs[i]))
        if (total() <= budget) break
      }
    }
    const fits = !Number.isFinite(budget) || total() <= budget
    for (const b of blobs) {
      if (fits && b.blob) {
        map.set(b.ref, await readAsDataUrl(b.blob))
        stats.inlined++
        stats.imageBytes += b.blob.size
      } else {
        map.set(b.ref, null)
        stats.dropped++
      }
    }
  }

  const cover = page.cover
  const shareCover: PageCover | null =
    !cover || (cover.type === 'image' && cover.value.startsWith(FILE_PREFIX)) ? null : cover

  return {
    payload: {
      v: 1,
      title: page.title,
      icon: page.icon,
      cover: shareCover,
      content: content ? { ...content, content: replaceImages(content.content, map) } : null,
      at: Date.now(),
    },
    stats,
  }
}

/** Absolute URL of the app (same origin + path), used as the base of share links. */
export function appBaseUrl(): string {
  return `${window.location.origin}${window.location.pathname}`
}

export function shareUrl(encoded: string): string {
  return `${appBaseUrl()}#/s/${encoded}`
}
