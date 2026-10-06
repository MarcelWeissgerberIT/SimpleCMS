/**
 * Media in MCP results (pure): what an image / video service returned, as cards — never fetched here.
 *
 *  - `mcp_tool_result` content: image blocks with base64 data (bytes right away), MCP resource / resource
 *    links with a media type, and text — JSON or plain — with http(s) addresses that end in a media extension
 *    or sit under a key / beside a type that says image, video or audio. Common job shapes count:
 *    `{ url }`, `{ images: [{ url }] }`, `{ result: { url } }`, `{ output: ["…mp4"] }`.
 *  - Claude's answer: links on a host a result used (its own words around a result), never other hosts.
 *  - Thumbnails, previews, avatars and icons are left out (they are not the result).
 *
 * createMediaCollector() folds the blocks of a response as they arrive (the `mcp_tool_use` before its result
 * says which server, tool and prompt) and returns the list whenever it grew.
 */
import type { MediaItem, MediaKind } from './types'

/** At most this many cards per request. */
export const MAX_ITEMS = 24
/** Inline bytes kept per item (base64 characters, ≈ 12 MB of file). */
export const MAX_INLINE = 16 * 1024 * 1024

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)$/i
const VIDEO_EXT = /\.(mp4|m4v|webm|mov|ogv)$/i
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i
const SKIP_KEY = /thumb|preview|poster|avatar|icon|logo|favicon|placeholder|blur|reference|input|source_image|init_image|mask/i
const URL_RE = /https?:\/\/[^\s<>"'`()[\]{}]+/g

/** The kind a file name / path says (by its extension), or null. */
export function kindOfPath(path: string): MediaKind | null {
  const p = path.toLowerCase()
  if (IMAGE_EXT.test(p)) return 'image'
  if (VIDEO_EXT.test(p)) return 'video'
  if (AUDIO_EXT.test(p)) return 'audio'
  return null
}

/** The kind a MIME type says, or null. */
export function kindOfMime(mime: unknown): MediaKind | null {
  const m = typeof mime === 'string' ? mime.trim().toLowerCase() : ''
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  return null
}

/** The kind a JSON key hints at ("images", "video_url", "audio"), or null. */
export function kindOfKey(key: string): MediaKind | null {
  const k = key.toLowerCase()
  if (SKIP_KEY.test(k)) return null
  if (/image|img|picture|photo|render/.test(k)) return 'image'
  if (/video|movie|clip|animation/.test(k)) return 'video'
  if (/audio|sound|music|voice|speech|song/.test(k)) return 'audio'
  return null
}

/** An http(s) address as a URL (null: something else). */
export function webUrl(raw: string): URL | null {
  const v = raw.trim()
  if (!/^https?:\/\//i.test(v)) return null
  try {
    const u = new URL(v)
    if (u.username || u.password) return null
    return u
  } catch {
    return null
  }
}

/** A URL's path without query, decoded where it can be (for its extension). */
function pathOf(u: URL): string {
  try {
    return decodeURIComponent(u.pathname)
  } catch {
    return u.pathname
  }
}

/** FNV-1a, base 36: a short stable id. */
export function hashId(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** The prompt of a tool input (prompt, text, description …) for the caption, '' when there is none. */
export function promptOf(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const o = input as Record<string, unknown>
  for (const k of ['prompt', 'text_prompt', 'positive_prompt', 'description', 'text', 'caption', 'query', 'title']) {
    const v = o[k]
    if (typeof v === 'string' && v.trim()) return clip(v.trim().replace(/\s+/g, ' '), 300)
  }
  // one level down ({ input: { prompt } }, { params: { prompt } })
  for (const v of Object.values(o)) if (v && typeof v === 'object' && !Array.isArray(v)) {
    const inner = promptOf(v)
    if (inner) return inner
  }
  return ''
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : typeof v === 'string' && /^\d{1,12}$/.test(v) ? Number(v) : null)

interface Ctx {
  server: string
  tool: string
  prompt: string
}

interface Found {
  url?: string
  data?: string
  mime?: string
  kind: MediaKind
  size: number | null
}

/** Strip the punctuation a sentence leaves at the end of an address. */
const trimUrl = (s: string) => s.replace(/[.,;:!?'")\]}>*_]+$/, '')

/** Addresses in free text (Markdown / plain): media by extension, or every one when `hint` says what they are. */
function urlsInText(text: string, hint: MediaKind | null, out: Found[]) {
  // ![alt](url): an image, whatever the extension
  for (const m of text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g)) {
    const u = webUrl(trimUrl(m[1]))
    if (u) out.push({ url: u.href, kind: kindOfPath(pathOf(u)) ?? 'image', size: null })
  }
  for (const m of text.matchAll(URL_RE)) {
    const u = webUrl(trimUrl(m[0]))
    if (!u) continue
    const kind = kindOfPath(pathOf(u)) ?? hint
    if (kind) out.push({ url: u.href, kind, size: null })
  }
}

/** Walk a JSON value; `hint`: what the keys above said, `meta`: the type / size of the object around. */
function walk(v: unknown, hint: MediaKind | null, meta: { mime?: string; size: number | null }, out: Found[], depth: number) {
  if (depth > 8 || out.length > MAX_ITEMS * 2) return
  if (typeof v === 'string') {
    const u = webUrl(v)
    if (!u) {
      // a JSON string inside a string ("result": "{\"url\": …}") or text with addresses
      if (/^\s*[[{]/.test(v)) {
        try {
          return walk(JSON.parse(v), hint, meta, out, depth + 1)
        } catch {
          /* plain text */
        }
      }
      if (v.length < 20_000 && /https?:\/\//.test(v)) urlsInText(v, null, out)
      return
    }
    const kind = kindOfMime(meta.mime) ?? kindOfPath(pathOf(u)) ?? hint
    if (kind) out.push({ url: u.href, kind, size: meta.size, ...(kindOfMime(meta.mime) ? { mime: meta.mime } : {}) })
    return
  }
  if (Array.isArray(v)) {
    for (const x of v.slice(0, 200)) walk(x, hint, { size: null }, out, depth + 1)
    return
  }
  if (!v || typeof v !== 'object') return
  const o = v as Record<string, unknown>
  // MCP / Messages API content blocks with bytes or a typed resource
  const block = inlineBlock(o)
  if (block) {
    out.push(block)
    return
  }
  const mimeRaw = o.mime_type ?? o.mimeType ?? o.content_type ?? o.contentType ?? o.media_type ?? o.format
  const mime = typeof mimeRaw === 'string' && /^[a-z]+\/[\w.+-]+$/i.test(mimeRaw.trim()) ? mimeRaw.trim().toLowerCase() : undefined
  const typeHint = typeof o.type === 'string' ? (kindOfMime(o.type) ?? (/^(image|video|audio)$/i.test(o.type) ? (o.type.toLowerCase() as MediaKind) : null)) : null
  const here = kindOfMime(mime) ?? typeHint ?? hint
  const size = num(o.size ?? o.bytes ?? o.file_size ?? o.fileSize ?? o.content_length ?? o.contentLength)
  for (const [k, x] of Object.entries(o)) {
    if (SKIP_KEY.test(k)) continue
    const keyHint = kindOfKey(k)
    walk(x, keyHint ?? here, /^(url|uri|src|href|link|download_url|downloadUrl|file_url|fileUrl|signed_url|signedUrl)$/i.test(k) ? { mime, size } : { size: null }, out, depth + 1)
  }
}

/** A content block with the bytes (base64) or a typed resource, as found media (null: not one). */
function inlineBlock(o: Record<string, unknown>): Found | null {
  // Messages API: { type: 'image', source: { type: 'base64', media_type, data } } · { source: { type: 'url', url } }
  if (o.type === 'image' && o.source && typeof o.source === 'object') {
    const s = o.source as Record<string, unknown>
    if (s.type === 'base64' && typeof s.data === 'string' && kindOfMime(s.media_type) === 'image') return { data: s.data, mime: String(s.media_type).toLowerCase(), kind: 'image', size: Math.floor((s.data.length * 3) / 4) }
    if (s.type === 'url' && typeof s.url === 'string' && webUrl(s.url)) return { url: webUrl(s.url)!.href, kind: 'image', size: null }
  }
  // MCP: { type: 'image' | 'audio', data, mimeType }
  if ((o.type === 'image' || o.type === 'audio') && typeof o.data === 'string' && kindOfMime(o.mimeType)) {
    const kind = kindOfMime(o.mimeType)!
    return { data: o.data, mime: String(o.mimeType).toLowerCase(), kind, size: Math.floor((o.data.length * 3) / 4) }
  }
  // MCP: { type: 'resource_link', uri, mimeType } · { type: 'resource', resource: { uri, mimeType, blob? } }
  if (o.type === 'resource_link' && typeof o.uri === 'string') {
    const u = webUrl(o.uri)
    const kind = kindOfMime(o.mimeType) ?? (u ? kindOfPath(pathOf(u)) : null)
    return u && kind ? { url: u.href, kind, size: num(o.size), ...(kindOfMime(o.mimeType) ? { mime: String(o.mimeType).toLowerCase() } : {}) } : null
  }
  if (o.type === 'resource' && o.resource && typeof o.resource === 'object') {
    const r = o.resource as Record<string, unknown>
    const kind = kindOfMime(r.mimeType)
    if (kind && typeof r.blob === 'string') return { data: r.blob, mime: String(r.mimeType).toLowerCase(), kind, size: Math.floor((r.blob.length * 3) / 4) }
    const u = typeof r.uri === 'string' ? webUrl(r.uri) : null
    const k2 = kind ?? (u ? kindOfPath(pathOf(u)) : null)
    if (u && k2) return { url: u.href, kind: k2, size: null, ...(kind ? { mime: String(r.mimeType).toLowerCase() } : {}) }
  }
  return null
}

/** Media in one tool result's content (a string or a list of blocks). */
export function mediaInResult(content: unknown): Found[] {
  const out: Found[] = []
  const text = (s: string) => {
    const t = s.trim()
    if (/^[[{]/.test(t)) {
      try {
        return walk(JSON.parse(t), null, { size: null }, out, 0)
      } catch {
        /* not JSON */
      }
    }
    urlsInText(t, null, out)
  }
  if (typeof content === 'string') text(content)
  else if (Array.isArray(content))
    for (const b of content.slice(0, 100)) {
      if (b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' && typeof (b as { text?: unknown }).text === 'string') text((b as { text: string }).text)
      else walk(b, null, { size: null }, out, 0)
    }
  return out
}

function toItem(f: Found, ctx: Ctx, from: MediaItem['from'], key: string): MediaItem {
  const host = f.url ? new URL(f.url).hostname : ctx.server
  return {
    id: hashId(f.url ?? key),
    kind: f.kind,
    ...(f.url ? { url: f.url } : {}),
    ...(f.data ? { data: f.data } : {}),
    ...(f.mime ? { mime: f.mime } : {}),
    host,
    size: f.size,
    server: ctx.server,
    tool: ctx.tool,
    prompt: ctx.prompt,
    from,
  }
}

/** The hosts results used (links in Claude's answer only count on these). */
export function hostsOf(items: MediaItem[]): Set<string> {
  return new Set(items.flatMap((x) => (x.url ? [new URL(x.url).hostname] : [])))
}

/** Links in Claude's answer on a host a result used — media by extension or as an image. */
export function mediaInAnswer(text: string, items: MediaItem[]): MediaItem[] {
  const hosts = hostsOf(items)
  if (!hosts.size) return []
  const found: Found[] = []
  urlsInText(text, null, found)
  const last = items[items.length - 1]
  const ctx: Ctx = { server: last?.server ?? '', tool: last?.tool ?? '', prompt: last?.prompt ?? '' }
  return found.filter((f) => f.url && hosts.has(new URL(f.url).hostname)).map((f) => toItem(f, ctx, 'answer', f.url!))
}

/** Add `next` to `list` (same address or same id once), at most MAX_ITEMS. Returns the same list when nothing is new. */
export function mergeMedia(list: MediaItem[], next: MediaItem[]): MediaItem[] {
  let out = list
  for (const it of next) {
    if (out.length >= MAX_ITEMS) break
    if (out.some((x) => x.id === it.id || (!!x.url && x.url === it.url))) continue
    if (it.data && it.data.length > MAX_INLINE) continue
    out = out === list ? [...list, it] : [...out, it]
  }
  return out
}

/** A finished content block of a response (only the fields read here). */
interface AnyBlock {
  type: string
  id?: string
  name?: string
  server_name?: string
  input?: unknown
  tool_use_id?: string
  is_error?: boolean
  content?: unknown
}

export interface MediaCollector {
  /** fold a finished block; true when the list grew */
  block(b: AnyBlock): boolean
  /** Claude's answer (links on a result's host); true when the list grew */
  answer(text: string): boolean
  readonly items: MediaItem[]
}

/** A collector for one request (or one terminal task). */
export function createMediaCollector(): MediaCollector {
  const calls = new Map<string, Ctx>()
  let items: MediaItem[] = []
  return {
    block(b) {
      if (b.type === 'mcp_tool_use' && b.id) {
        calls.set(b.id, { server: b.server_name ?? '', tool: b.name ?? '', prompt: promptOf(b.input) })
        return false
      }
      if (b.type !== 'mcp_tool_result' || b.is_error) return false
      const ctx = calls.get(b.tool_use_id ?? '') ?? { server: '', tool: '', prompt: '' }
      const found = mediaInResult(b.content)
      const next = mergeMedia(
        items,
        found.map((f, i) => toItem(f, ctx, 'result', `${b.tool_use_id}:${i}`)),
      )
      if (next === items) return false
      items = next
      return true
    },
    answer(text) {
      const next = mergeMedia(items, mediaInAnswer(text, items))
      if (next === items) return false
      items = next
      return true
    },
    get items() {
      return items
    },
  }
}
