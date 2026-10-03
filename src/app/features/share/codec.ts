/**
 * Serverless share links: the page itself is the URL.
 *   #/s/<base64url(deflate(JSON))>
 * Internal references (page links, mentions, embedded databases) are flattened into
 * self-contained content; local images ("onefile:") are inlined as data URLs when small
 * enough (re-encoded if needed), otherwise replaced by a note.
 */
import { Inflate, deflateSync, strFromU8, strToU8 } from 'fflate'
import { getSchema, type JSONContent } from '@tiptap/core'
import type { Schema } from '@tiptap/pm/model'
import { useWorkspace } from '../../store/store'
import type { ColorName, ID, Page, PageCover, PageIcon } from '../../store/types'
import { FILE_PREFIX, getFile, readAsDataUrl } from '../../lib/files'
import { propertyValueToText } from '../../database'
import { getExtensions, stripButtonActions } from '../../editor'
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
/** A received link may not expand beyond this (a few KB of zeros can inflate to gigabytes). */
export const SHARE_MAX_INFLATED = 20 * 1024 * 1024
/** …nor be longer than this to begin with. */
const SHARE_MAX_ENCODED = 8 * 1024 * 1024

export class ShareDecodeError extends Error {
  /** password: the password does not open this (encrypted) link */
  code: 'empty' | 'corrupt' | 'version' | 'password'
  constructor(code: 'empty' | 'corrupt' | 'version' | 'password') {
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

/**
 * inflateSync with an output cap: the data is fed in small chunks (each can expand at most
 * ~1000×), and decoding stops as soon as the output passes `max`.
 */
export function inflateCapped(data: Uint8Array, max = SHARE_MAX_INFLATED): Uint8Array {
  const parts: Uint8Array[] = []
  let total = 0
  let done = false
  const inflater = new Inflate((chunk, final) => {
    total += chunk.length
    if (total > max) throw new Error('inflated payload too large')
    parts.push(chunk)
    if (final) done = true
  })
  const CHUNK = 1024
  for (let i = 0; i < data.length; i += CHUNK) inflater.push(data.subarray(i, i + CHUNK), i + CHUNK >= data.length)
  if (!done) throw new Error('truncated payload')
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** The link text after "#/s/", URL-decoded and without whitespace / padding. */
function cleanRaw(raw: string): string {
  let s = (raw ?? '').trim()
  try {
    s = decodeURIComponent(s)
  } catch {
    /* already decoded */
  }
  return s.replace(/[\s=]/g, '')
}

export function decodePayload(raw: string): SharePayload {
  const s = cleanRaw(raw)
  if (!s) throw new ShareDecodeError('empty')
  if (s.length > SHARE_MAX_ENCODED) throw new ShareDecodeError('corrupt')
  if (isEncryptedPayload(s)) throw new ShareDecodeError('password')
  let bytes: Uint8Array
  try {
    bytes = base64UrlToBytes(s)
  } catch {
    throw new ShareDecodeError('corrupt')
  }
  return decodeDeflated(bytes)
}

/** deflate(JSON) bytes → a validated, sanitised payload. */
function decodeDeflated(bytes: Uint8Array): SharePayload {
  let data: unknown
  try {
    data = JSON.parse(strFromU8(inflateCapped(bytes)))
  } catch {
    throw new ShareDecodeError('corrupt')
  }
  if (!data || typeof data !== 'object') throw new ShareDecodeError('corrupt')
  const d = data as Partial<SharePayload>
  if (d.v !== 1) throw new ShareDecodeError('version')
  // a received button never brings actions along (webhooks, inserts into the reader's workspace)
  const content = d.content && typeof d.content === 'object' && d.content.type === 'doc' ? validateDoc(stripButtonActions(sanitizeShared(d.content))) : null
  return {
    v: 1,
    title: typeof d.title === 'string' ? d.title.slice(0, 500) : '',
    icon: sanitizeIcon(d.icon),
    cover: sanitizeCover(d.cover),
    content,
    at: typeof d.at === 'number' ? d.at : undefined,
  }
}

/* ------------------------------------------------------------------ */
/* password-protected links                                            */
/* ------------------------------------------------------------------ */

/*
 * #/s/e1.<base64url( iterations:u32be | salt:16 | iv:12 | AES-GCM(deflate(JSON)) )>
 *
 * The key is derived from the password with PBKDF2-SHA-256 (random salt, ≥ 310,000 iterations)
 * and the page is encrypted with AES-256-GCM, all in the browser (WebCrypto). The password is
 * never part of the link and never leaves the device. Plain links (no "e1." prefix: '.' is not
 * a base64url character) keep working as before.
 */
export const ENCRYPTED_PREFIX = 'e1.'
/** OWASP's current recommendation for PBKDF2-HMAC-SHA-256. */
export const PBKDF2_ITERATIONS = 600_000
/** Accepted when opening a link: never weaker than this… */
const MIN_ITERATIONS = 310_000
/** …and never so many that a crafted link freezes the reader's browser. */
const MAX_ITERATIONS = 5_000_000
const SALT_BYTES = 16
const IV_BYTES = 12

export function isEncryptedPayload(raw: string): boolean {
  return cleanRaw(raw).startsWith(ENCRYPTED_PREFIX)
}

/** WebCrypto is only available in secure contexts (https, localhost). */
export function canEncrypt(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle && typeof crypto.getRandomValues === 'function'
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number, usage: KeyUsage): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, material, { name: 'AES-GCM', length: 256 }, false, [usage])
}

/** Encrypt a payload with a password → the text after "#/s/" ("e1.…"). */
export async function encryptPayload(p: SharePayload, password: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  if (!password) throw new Error('password required')
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(password, salt, iterations, 'encrypt')
  const plain = deflateSync(strToU8(JSON.stringify(p)), { level: 9 })
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plain as BufferSource))
  const out = new Uint8Array(4 + SALT_BYTES + IV_BYTES + cipher.length)
  new DataView(out.buffer).setUint32(0, iterations)
  out.set(salt, 4)
  out.set(iv, 4 + SALT_BYTES)
  out.set(cipher, 4 + SALT_BYTES + IV_BYTES)
  return ENCRYPTED_PREFIX + bytesToBase64Url(out)
}

/**
 * Decrypt a protected link. A wrong password (or a tampered link — AES-GCM cannot tell them
 * apart) throws ShareDecodeError('password'); a malformed link throws 'corrupt'.
 */
export async function decryptPayload(raw: string, password: string): Promise<SharePayload> {
  const s = cleanRaw(raw)
  if (!s.startsWith(ENCRYPTED_PREFIX)) return decodePayload(s)
  if (s.length > SHARE_MAX_ENCODED) throw new ShareDecodeError('corrupt')
  let bytes: Uint8Array
  try {
    bytes = base64UrlToBytes(s.slice(ENCRYPTED_PREFIX.length))
  } catch {
    throw new ShareDecodeError('corrupt')
  }
  if (bytes.length < 4 + SALT_BYTES + IV_BYTES + 16) throw new ShareDecodeError('corrupt')
  const iterations = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0)
  if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) throw new ShareDecodeError('corrupt')
  const salt = bytes.slice(4, 4 + SALT_BYTES)
  const iv = bytes.slice(4 + SALT_BYTES, 4 + SALT_BYTES + IV_BYTES)
  const cipher = bytes.slice(4 + SALT_BYTES + IV_BYTES)
  let plain: Uint8Array
  try {
    const key = await deriveKey(password, salt, iterations, 'decrypt')
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, cipher as BufferSource))
  } catch {
    throw new ShareDecodeError('password')
  }
  return decodeDeflated(plain)
}

/** Only real emoji (pictographs, flags, keycaps with their joiners/modifiers) — never arbitrary text. */
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|[\u200d\ufe0f\u20e3#*0-9])+$/u
const EMOJI_CORE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u

function sanitizeIcon(icon: unknown): PageIcon | null {
  const i = icon as PageIcon | null
  if (!i || typeof i !== 'object' || typeof i.value !== 'string') return null
  if (i.type === 'emoji') {
    const v = i.value.trim()
    return v.length <= 16 && EMOJI_ONLY.test(v) && EMOJI_CORE.test(v) ? { type: 'emoji', value: v } : null
  }
  if (i.type === 'asset' && /^[\w-]{1,64}$/.test(i.value)) return { type: 'asset', value: i.value }
  if (i.type === 'lucide' && /^[A-Za-z0-9]{1,64}$/.test(i.value)) return { type: 'lucide', value: i.value, color: typeof i.color === 'string' && /^[a-z]{1,16}$/.test(i.color) ? (i.color as ColorName) : undefined }
  return null
}

function sanitizeCalloutIcon(icon: unknown): unknown {
  if (typeof icon === 'string') {
    const v = icon.trim()
    if (/^asset:[\w-]{1,64}$/.test(v)) return v
    return v.length <= 16 && EMOJI_ONLY.test(v) && EMOJI_CORE.test(v) ? v : '💡'
  }
  return sanitizeIcon(icon) ?? '💡'
}

const COVER_URL = /^(https:\/\/|assets\/[\w./-]+$|data:image\/(png|jpe?g|webp|gif|avif);base64,)/i
function sanitizeCover(cover: unknown): PageCover | null {
  const c = cover as PageCover | null
  if (!c || typeof c !== 'object' || typeof c.value !== 'string') return null
  const positionY = Math.max(0, Math.min(100, Number(c.positionY) || 50))
  if (c.type === 'image' && COVER_URL.test(c.value)) {
    const value = /^data:/i.test(c.value) ? safeDataImage(c.value) : /^assets\//.test(c.value) && /\.\./.test(c.value) ? null : c.value
    return value ? { type: 'image', value, positionY } : null
  }
  // gradients: allow only gradient functions / colours (no url(), no expressions)
  if (c.type === 'gradient' && /^[\w\s#%(),./-]+$/.test(c.value) && !/url\s*\(/i.test(c.value)) return { type: 'gradient', value: c.value, positionY }
  if (c.type === 'color' && /^[a-z]{1,16}$/.test(c.value)) return { type: 'color', value: c.value as ColorName, positionY }
  return null
}

const SAFE_HREF = /^(https?:|mailto:|tel:|#(?!\/p\/))/i
/** Raster images only. SVG is never accepted from a link: opened as a document it runs script on this origin. */
const SAFE_SRC = /^(https:\/\/|data:image\/(png|jpe?g|webp|gif|avif);base64,|assets\/)/i

/* ---------------- raster sniffing ---------------- */

export type RasterType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/avif'

/** Identify a raster image by its magic bytes (the declared MIME type is not trusted). */
export function sniffRaster(b: Uint8Array): RasterType | null {
  const at = (i: number, ...xs: number[]) => xs.every((x, k) => b[i + k] === x)
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif'
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'
  if (at(4, 0x66, 0x74, 0x79, 0x70) && (at(8, 0x61, 0x76, 0x69, 0x66) || at(8, 0x61, 0x76, 0x69, 0x73))) return 'image/avif'
  return null
}

/**
 * A data: URL that is provably a raster image, re-labelled with its real type — or null.
 * Only the first bytes are decoded, so this stays cheap for large images.
 */
export function safeDataImage(src: string): string | null {
  const m = /^data:image\/[\w.+-]+;base64,([A-Za-z0-9+/=_-]+)$/i.exec(src)
  if (!m) return null
  try {
    const head = atob(m[1].slice(0, 32).replace(/-/g, '+').replace(/_/g, '/'))
    const bytes = new Uint8Array(head.length)
    for (let i = 0; i < head.length; i++) bytes[i] = head.charCodeAt(i)
    const type = sniffRaster(bytes)
    return type ? `data:${type};base64,${m[1]}` : null
  } catch {
    return null
  }
}

function safeSrc(src: unknown): string {
  const s = String(src ?? '').trim()
  if (!s || !SAFE_SRC.test(s)) return ''
  if (/^data:/i.test(s)) return safeDataImage(s) ?? ''
  if (/^assets\//.test(s) && /\.\.|\/\//.test(s)) return ''
  return s
}

/* ---------------- embeds ---------------- */

/** Providers a received link may embed as an iframe. Anything else becomes a plain bookmark. */
function embedProvider(url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'https:') return null
  const h = u.hostname.replace(/^www\./, '').toLowerCase()
  const is = (d: string) => h === d || h.endsWith(`.${d}`)
  if (is('youtube.com') || h === 'youtu.be' || is('youtube-nocookie.com')) return 'youtube'
  if (is('vimeo.com')) return 'vimeo'
  if (is('loom.com')) return 'loom'
  if (is('figma.com')) return 'figma'
  if (is('codepen.io')) return 'codepen'
  if ((/^(maps\.)?google\.[a-z.]{2,6}$/.test(h) && u.pathname.startsWith('/maps')) || h === 'maps.app.goo.gl') return 'maps'
  return null
}

/** Defensive cleanup of a received doc: unsafe links, sources and embeds are removed. */
function sanitizeShared(node: JSONContent): JSONContent {
  const n: JSONContent = { ...node }
  if (n.marks)
    n.marks = n.marks.filter(
      (m) => (m.type !== 'link' || SAFE_HREF.test(String(m.attrs?.href ?? '').trim())) && (m.attrs?.color == null || /^[a-z]{1,16}$/.test(String(m.attrs.color))),
    )
  if (n.attrs) {
    const a = { ...n.attrs }
    if ('src' in a && a.src) a.src = safeSrc(a.src)
    if (n.type === 'image' && !a.src) return para(text(`▢ ${t('features.share.imageNotIncluded')}`, [{ type: 'italic' }]))
    if (n.type === 'bookmark' && a.image) a.image = safeSrc(a.image) || null
    if (n.type === 'bookmark' || n.type === 'embed') {
      const url = String(a.url ?? '').trim()
      // nothing safe to point at: an empty "paste a link" card is noise in a read-only page
      if (!/^https?:\/\/[^\s]+$/i.test(url)) return { type: 'paragraph' }
      a.url = url
      if (n.type === 'embed') {
        const provider = embedProvider(url)
        if (!provider) return { type: 'bookmark', attrs: { url, title: null, description: null, image: null } }
        a.provider = provider
      }
    }
    // attribute values that end up as visible labels must look like what they claim to be
    if (n.type === 'callout') {
      a.icon = sanitizeCalloutIcon(a.icon)
      a.color = typeof a.color === 'string' && /^[a-z]{1,16}$/.test(a.color) ? a.color : 'gray'
    }
    if (n.type === 'codeBlock' && a.language != null && !/^[\w#+.-]{1,32}$/.test(String(a.language))) a.language = null
    if ('color' in a && n.type !== 'callout' && a.color != null && !/^[a-z]{1,16}$/.test(String(a.color))) a.color = null
    n.attrs = a
  }
  if (n.content) n.content = n.content.map(sanitizeShared)
  return n
}

/* ---------------- schema validation ---------------- */

let schema: Schema | null = null
const shareSchema = () => (schema ??= getSchema(getExtensions()))

function plainOf(n: JSONContent): string {
  if (typeof n.text === 'string') return n.text
  return (n.content ?? []).map(plainOf).join(n.type === 'paragraph' || n.type === 'heading' ? '' : ' ')
}

/**
 * Make a received doc schema-valid: valid top-level blocks are kept as they are, invalid
 * ones are salvaged as plain text paragraphs, so nothing that cannot be edited gets stored.
 */
export function validateDoc(doc: JSONContent): JSONContent {
  const sc = shareSchema()
  const fallback: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }
  try {
    sc.nodeFromJSON(doc).check()
    return doc
  } catch {
    /* repair below */
  }
  const blocks: JSONContent[] = []
  for (const b of doc.content ?? []) {
    if (!b || typeof b !== 'object') continue
    try {
      const node = sc.nodeFromJSON(b)
      node.check()
      sc.topNodeType.createChecked(null, node)
      blocks.push(b)
    } catch {
      const text = plainOf(b).replace(/\s+/g, ' ').trim()
      if (text) blocks.push({ type: 'paragraph', content: [{ type: 'text', text: text.slice(0, 20_000) }] })
    }
  }
  const out: JSONContent = { type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] }
  try {
    sc.nodeFromJSON(out).check()
    return out
  } catch {
    return fallback
  }
}

/* ------------------------------------------------------------------ */
/* Preparing a page for sharing / export                               */
/* ------------------------------------------------------------------ */

const text = (s: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text: s, ...(marks ? { marks } : {}) })
const para = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content: content.filter((c) => c.text !== '') })

function iconPrefix(p: Page | undefined): string {
  return p?.icon?.type === 'emoji' ? `${p.icon.value} ` : ''
}

/** A static table of a database (first view's visible columns, up to 50 rows). */
export function databaseTable(dbId: ID, pages: Record<ID, Page> = useWorkspace.getState().pages, opts: { caption?: boolean } = {}): JSONContent[] {
  const st = useWorkspace.getState()
  const db = st.databases[dbId]
  const dbPage = pages[dbId]
  const title = `${iconPrefix(dbPage)}${dbPage?.title?.trim() || t('common.untitled')}`
  if (!db) return opts.caption === false ? [] : [para(text(title, [{ type: 'bold' }]))]
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
  const out: JSONContent[] = opts.caption === false ? [] : [para(text(title, [{ type: 'bold' }]))]
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

/** Property values of a database row as a compact two-column table (empty values skipped). */
function rowProperties(row: Page): JSONContent[] {
  const st = useWorkspace.getState()
  const db = row.databaseId ? st.databases[row.databaseId] : undefined
  if (!db) return []
  const cell = (type: 'tableHeader' | 'tableCell', s: string): JSONContent => ({ type, content: [s ? para(text(s)) : { type: 'paragraph' }] })
  const rows: JSONContent[] = []
  for (const prop of db.properties) {
    if (prop.type === 'title') continue
    let v = ''
    try {
      v = propertyValueToText(db, prop, row).trim()
    } catch {
      v = ''
    }
    if (!v) continue
    rows.push({ type: 'tableRow', content: [{ ...cell('tableHeader', prop.name), attrs: { colwidth: [190] } }, cell('tableCell', v.slice(0, 300))] })
  }
  return rows.length ? [{ type: 'table', content: rows }, { type: 'paragraph' }] : []
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

/** Decode any image blob (raster or SVG) to a drawable source. */
async function decodeImage(blob: Blob): Promise<{ src: CanvasImageSource; w: number; h: number; close: () => void } | null> {
  if (blob.type !== 'image/svg+xml') {
    try {
      const bmp = await createImageBitmap(blob)
      return { src: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close?.() }
    } catch {
      return null
    }
  }
  // SVG: rasterised through an <img> (scripts never run there), so links only ever carry pixels
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    const w = img.naturalWidth || 1200
    const h = img.naturalHeight || 800
    return { src: img, w, h, close: () => URL.revokeObjectURL(url) }
  } catch {
    URL.revokeObjectURL(url)
    return null
  }
}

/** Re-encode an image as WebP within a max edge length; resolves null if not possible. */
async function shrinkImage(blob: Blob, maxEdge: number, quality: number): Promise<Blob | null> {
  if (blob.type === 'image/gif') return null // keep animations
  const img = await decodeImage(blob)
  if (!img) return null
  try {
    const scale = Math.min(1, maxEdge / Math.max(img.w, img.h))
    const w = Math.max(1, Math.round(img.w * scale))
    const h = Math.max(1, Math.round(img.h * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img.src, 0, 0, w, h)
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/webp', quality))
  } catch {
    return null
  } finally {
    img.close()
  }
}

/** Raster blobs pass; SVGs are rasterised; anything else is refused. */
async function rasterOnly(blob: Blob): Promise<Blob | null> {
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer())
  const type = sniffRaster(head)
  if (type) return blob.type === type ? blob : new Blob([blob], { type })
  if (blob.type === 'image/svg+xml') return (await shrinkImage(blob, 1600, 0.85)) ?? null
  return null
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
  // Databases have no content of their own: share their table. Rows carry their property values.
  const lead: JSONContent[] = page.kind === 'database' ? databaseTable(page.id, st.pages, { caption: false }) : page.databaseId ? rowProperties(page) : []
  // button actions (webhook URLs, database ids) stay in the workspace
  const body = flatten(page.content ? stripButtonActions(page.content).content : undefined, st.pages, images)
  const blocks = [...lead, ...body]
  const content: JSONContent | null = blocks.length ? { ...(page.content ?? {}), type: 'doc', content: blocks } : null
  const stats: PrepareStats = { images: images.size, inlined: 0, dropped: 0, imageBytes: 0 }

  const map = new Map<string, string | null>()
  if (images.size && budget <= 0) {
    for (const ref of images) map.set(ref, null)
    stats.dropped = images.size
  } else if (images.size) {
    const files = await Promise.all([...images].map(async (ref) => ({ ref, file: await getFile(ref).catch(() => undefined) })))
    let blobs = await Promise.all(files.map(async ({ ref, file }) => ({ ref, blob: file?.blob ? await rasterOnly(file.blob).catch(() => null) : null })))
    const limited = Number.isFinite(budget) && budget > 0
    // an image that can never fit (a GIF is not re-encoded) must not make the others shrink further
    const hopeless = (b: Blob) => limited && b.type === 'image/gif' && b.size > budget
    const total = () => blobs.reduce((s, b) => s + (b.blob && !hopeless(b.blob) ? b.blob.size : 0), 0)
    if (limited) {
      // Links should stay short: always try a screen-sized WebP first, then smaller ones until the
      // images fit the budget (a hard cap). A re-encode is only used when it is actually smaller.
      for (const [edge, q] of [
        [1000, 0.7],
        [800, 0.62],
        [640, 0.55],
        [480, 0.5],
      ] as const) {
        const next = await Promise.all(blobs.map(async (b) => ({ ref: b.ref, blob: b.blob ? ((await shrinkImage(b.blob, edge, q)) ?? b.blob) : null })))
        blobs = next.map((b, i) => (b.blob && blobs[i].blob && b.blob.size < blobs[i].blob!.size ? b : blobs[i]))
        if (total() <= budget) break
      }
    }
    // Still over budget (e.g. one big GIF, which is never re-encoded): keep as many images as
    // fit, smallest first, instead of dropping them all.
    const keep = new Set<string>()
    let used = 0
    for (const b of [...blobs].sort((x, y) => (x.blob?.size ?? Infinity) - (y.blob?.size ?? Infinity))) {
      if (!b.blob) continue
      if (limited && used + b.blob.size > budget) continue
      keep.add(b.ref)
      used += b.blob.size
    }
    for (const b of blobs) {
      if (b.blob && keep.has(b.ref)) {
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
