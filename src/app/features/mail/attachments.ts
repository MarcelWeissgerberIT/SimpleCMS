/**
 * Mail attachments on demand (loaded on first use by service.ts and sync.ts).
 *
 * A mail's page lists its attachments with a "Load" key each (body.ts). Loading asks Gmail for the
 * message again (attachment ids change between fetches), then for the attachment (attachments.get —
 * covered by gmail.readonly), stores it as a file of this workspace (saveFile → "onefile:<id>"; in a
 * team workspace the cloud file rules apply) and turns the list item into a real block, written with
 * origin 'mail': images → `image`, PDFs → `fileBlock` in the browser's own viewer, audio / video →
 * `audio` / `video`, everything else → `fileBlock` (download). The mail's own body is never touched.
 *
 *  - Never active content: HTML / SVG / XML / scripts are stored typed application/octet-stream and only
 *    offered as a download — no browser renders them, not even when the file is opened on its own.
 *  - At most 25 MB per file (ATTACHMENT_MAX): larger ones keep the "open in Gmail" link.
 *  - No duplicates: only an attachment that is still a list item with its Load key is loaded; a loaded
 *    one is a block and keeps its place when the body is rendered again ("Load images").
 *  - Content goes to Anthropic only through an explicit Claude action on the file block (not here).
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../store/store'
import { saveFile } from '../../lib/files'
import type { ID } from '../../store/types'
import * as gmail from './gmail'
import { GmailError, type GmailCtx } from './gmail'
import { base64UrlBytes, parseMessage, type MailAttachment, type ParsedMail } from './parse'
import { LOAD_ALL, MAIL_ORIGIN, attKey, textHash } from './body'
import { ATTACHMENT_MAX, AUTO_MEDIA_MAX, readMail } from './settings'
import { loadState, saveState } from './storage'

export type AttachmentKind = 'image' | 'pdf' | 'audio' | 'video' | 'file'

const extOf = (name: string) => name.toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1] ?? ''
/** Never rendered: markup that could run or load things. */
const ACTIVE_EXT = new Set(['html', 'htm', 'xhtml', 'shtml', 'svg', 'svgz', 'xml', 'xsl', 'xslt', 'mht', 'mhtml', 'js', 'mjs', 'hta'])
const ACTIVE_MIME = /html|svg|xml|javascript|ecmascript/
const IMAGE: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp' }
const AUDIO: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac' }
const VIDEO: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg' }
const SAFE = 'application/octet-stream'

/** What an attachment becomes, and the type its file is stored with (by name first, then Gmail's type). */
export function classify(name: string, mime: string): { kind: AttachmentKind; type: string } {
  const ext = extOf(name)
  const m = mime.toLowerCase().split(';')[0].trim()
  if (ACTIVE_EXT.has(ext) || ACTIVE_MIME.test(m)) return { kind: 'file', type: SAFE }
  if (ext === 'pdf' || (!ext && m === 'application/pdf')) return { kind: 'pdf', type: 'application/pdf' }
  if (IMAGE[ext] || (!ext && /^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(m))) return { kind: 'image', type: IMAGE[ext] ?? m }
  if (AUDIO[ext] || (!ext && m.startsWith('audio/'))) return { kind: 'audio', type: AUDIO[ext] ?? m }
  if (VIDEO[ext] || (!ext && m.startsWith('video/'))) return { kind: 'video', type: VIDEO[ext] ?? m }
  return { kind: 'file', type: m && /^[\w.+-]+\/[\w.+-]+$/.test(m) ? m : SAFE }
}

/** The block a loaded attachment becomes. */
export function attachmentBlock(a: { name: string; size: number }, kind: AttachmentKind, src: string): JSONContent {
  switch (kind) {
    case 'image':
      return { type: 'image', attrs: { src, alt: a.name, caption: a.name } }
    case 'pdf':
      return { type: 'fileBlock', attrs: { src, name: a.name, size: a.size, display: 'viewer' } }
    case 'audio':
      return { type: 'audio', attrs: { src, name: a.name, caption: '' } }
    case 'video':
      return { type: 'video', attrs: { src, name: a.name, caption: '' } }
    default:
      return { type: 'fileBlock', attrs: { src, name: a.name, size: a.size, display: 'file' } }
  }
}

/* ------------------------------------------------------------------ the page */

const MEDIA = new Set(['image', 'fileBlock', 'audio', 'video'])

/** The value a Load key writes (its attachment's key, or LOAD_ALL), when it writes into `prop`. */
function keyOfButton(n: JSONContent | undefined, prop: ID): string | null {
  if (n?.type !== 'button') return null
  const a = (n.attrs?.actions as Array<{ type?: string; values?: Array<{ propertyId?: string; value?: unknown }> }> | undefined)?.[0]
  const v = a?.type === 'edit_properties' ? a.values?.[0] : undefined
  return v && v.propertyId === prop && typeof v.value === 'string' ? v.value : null
}

const itemKey = (li: JSONContent, prop: ID) => keyOfButton(li.content?.find((n) => n.type === 'button'), prop)

/** The attachments still waiting in the page (their Load keys). */
export function waitingKeys(doc: JSONContent | null | undefined, prop: ID): string[] {
  const out: string[] = []
  for (const n of doc?.content ?? []) {
    if (n.type !== 'bulletList') continue
    for (const li of n.content ?? []) {
      const k = itemKey(li, prop)
      if (k && k !== LOAD_ALL) out.push(k)
    }
  }
  return out
}

/** The doc with the list item of `key` replaced by `block` (placed where the list is); null: not waiting. */
export function placeLoaded(doc: JSONContent, key: string, block: JSONContent, prop: ID): JSONContent | null {
  const content = [...(doc.content ?? [])]
  const at = content.findIndex((n) => n.type === 'bulletList' && (n.content ?? []).some((li) => itemKey(li, prop) === key))
  if (at < 0) return null
  const list = content[at]
  const items = (list.content ?? []).filter((li) => itemKey(li, prop) !== key)
  const all = at > 0 && keyOfButton(content[at - 1], prop) === LOAD_ALL ? at - 1 : -1
  const from = all >= 0 ? all : at
  const left = items.filter((li) => itemKey(li, prop)).length
  return {
    ...doc,
    content: [...content.slice(0, from), block, ...(all >= 0 && left >= 2 ? [content[all]] : []), ...(items.length ? [{ ...list, content: items }] : []), ...content.slice(at + 1)],
  }
}

/** Blocks of this page that are loaded attachments (a local file named like one of them), by attKey. */
export function loadedBlocks(doc: JSONContent | null | undefined, list: MailAttachment[]): Map<string, JSONContent> {
  const out = new Map<string, JSONContent>()
  const walk = (n: JSONContent) => {
    if (MEDIA.has(n.type ?? '') && typeof n.attrs?.src === 'string' && n.attrs.src.startsWith('onefile:')) {
      const name = String(n.attrs.name ?? n.attrs.alt ?? '')
      const size = typeof n.attrs.size === 'number' ? n.attrs.size : null
      const a = list.find((x) => x.name === name && (size === null || x.size === size) && !out.has(attKey(x)))
      if (a) out.set(attKey(a), n)
    }
    ;(n.content ?? []).forEach(walk)
  }
  if (doc) walk(doc)
  return out
}

/* ------------------------------------------------------------------ loading */

export class AttachmentError extends Error {
  code: 'missing' | 'too_big'
  constructor(code: 'missing' | 'too_big') {
    super(code)
    this.name = 'AttachmentError'
    this.code = code
  }
}

export interface LoadResult {
  /** names of the attachments now in the page */
  loaded: string[]
  /** over the 25 MB limit (they keep the Gmail link) */
  tooBig: string[]
  /** no longer in Gmail */
  missing: string[]
}

/** On sync ('media' / 'all'): which attachments of a new mail load right away. */
export function autoFilter(mode: 'off' | 'media' | 'all'): ((a: MailAttachment) => boolean) | null {
  if (mode === 'all') return (a) => a.size <= ATTACHMENT_MAX
  if (mode === 'media') return (a) => a.size <= AUTO_MEDIA_MAX && ['pdf', 'image'].includes(classify(a.name, a.mime).kind)
  return null
}

/**
 * Load attachments of the mail row `rowId` into its page: the ones with these keys (attKey), or every
 * one still waiting (`keys` null), optionally only those `filter` accepts. `msg`: the message as just
 * fetched (the sync), else it is fetched now. `keepHash`: the sync writes the body's fingerprint itself.
 * Throws GmailError (auth → sign in again).
 */
export async function loadAttachments(rowId: ID, keys: string[] | null, g: GmailCtx, opts: { msg?: ParsedMail; filter?: (a: MailAttachment) => boolean; keepHash?: boolean } = {}): Promise<LoadResult> {
  const res: LoadResult = { loaded: [], tooBig: [], missing: [] }
  const cfg = readMail()
  const prop = cfg.props?.load
  const msgProp = cfg.props?.messageId
  const row = useWorkspace.getState().pages[rowId]
  const msgId = row && msgProp ? row.properties[msgProp] : null
  if (!row || !prop || typeof msgId !== 'string' || !msgId) return res
  const waiting = new Set(waitingKeys(row.content, prop))
  const wanted = (keys ?? [...waiting]).filter((k) => waiting.has(k))
  if (!wanted.length) return res
  const msg = opts.msg ?? parseMessage(await gmail.message(g, msgId, 'full'))
  const made: Array<{ key: string; block: JSONContent; name: string }> = []
  for (const key of wanted) {
    const a = msg.attachments.find((x) => attKey(x) === key)
    if (a && opts.filter && !opts.filter(a)) continue
    if (!a?.aid) {
      res.missing.push(a?.name ?? key.replace(/^\d+:/, ''))
      continue
    }
    if (a.size > ATTACHMENT_MAX) {
      res.tooBig.push(a.name)
      continue
    }
    let data: string | undefined
    try {
      data = (await gmail.attachment(g, msgId, a.aid)).data
    } catch (e) {
      if (e instanceof GmailError && e.code === 'not_found') {
        res.missing.push(a.name)
        continue
      }
      throw e
    }
    const bytes = data ? base64UrlBytes(data) : null
    if (!bytes) {
      res.missing.push(a.name)
      continue
    }
    if (bytes.length > ATTACHMENT_MAX) {
      res.tooBig.push(a.name)
      continue
    }
    const { kind, type } = classify(a.name, a.mime)
    const src = await saveFile(new Blob([bytes as BlobPart], { type }), a.name)
    made.push({ key, name: a.name, block: attachmentBlock({ name: a.name, size: bytes.length || a.size }, kind, src) })
  }
  if (!made.length) return res
  // the page as it is now (time passed): every block goes where its list item still waits
  const now = useWorkspace.getState().pages[rowId]
  if (!now?.content) return res
  let doc: JSONContent = now.content
  for (const m of made) {
    const next = placeLoaded(doc, m.key, m.block, prop)
    if (!next) continue
    doc = next
    res.loaded.push(m.name)
  }
  if (!res.loaded.length) return res
  const before = textHash(now.plain ?? '')
  useWorkspace.getState().setContent(rowId, doc, MAIL_ORIGIN)
  if (!opts.keepHash) {
    // an unedited body stays "unedited" for "Load images"
    const state = await loadState()
    const k = state.known[msgId]
    if (k && k.h === before) {
      k.h = textHash(useWorkspace.getState().pages[rowId]?.plain ?? '')
      await saveState(state)
    }
  }
  return res
}
