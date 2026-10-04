/**
 * A Gmail API message (format=full) → what the Mails database needs: headers, labels, the body
 * (HTML preferred, text/plain fallback) and the attachments' names and sizes (never their content).
 */

export interface GmailPart {
  partId?: string
  mimeType?: string
  filename?: string
  headers?: Array<{ name: string; value: string }>
  body?: { size?: number; data?: string; attachmentId?: string }
  parts?: GmailPart[]
}

export interface GmailMessage {
  id: string
  threadId?: string
  labelIds?: string[]
  snippet?: string
  historyId?: string
  /** ms since epoch (string) — when Gmail received it */
  internalDate?: string
  payload?: GmailPart
  sizeEstimate?: number
}

export interface MailAttachment {
  name: string
  size: number
  mime: string
}

/** A body part Gmail delivered by reference (attachmentId) instead of inline data. */
export interface PendingBody {
  kind: 'html' | 'text'
  attachmentId: string
  charset: string
}

export interface ParsedMail {
  id: string
  threadId: string
  subject: string
  from: string
  to: string
  /** ms since epoch */
  date: number
  labelIds: string[]
  unread: boolean
  snippet: string
  html: string | null
  text: string | null
  attachments: MailAttachment[]
  pending: PendingBody[]
}

/** Bodies above this are cut (a page is not a mail archive). */
export const BODY_MAX = 400_000

function header(part: GmailPart | undefined, name: string): string {
  const h = part?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase())
  return h?.value ?? ''
}

function charsetOf(part: GmailPart): string {
  const ct = header(part, 'Content-Type')
  return ct.match(/charset\s*=\s*"?([\w.:-]+)"?/i)?.[1]?.toLowerCase() ?? 'utf-8'
}

/** base64url → bytes */
export function base64UrlBytes(data: string): Uint8Array {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '')
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Bytes in a declared charset (unknown charsets read as UTF-8). */
export function decodeBytes(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset || 'utf-8').decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

export function decodeBody(data: string, charset: string): string {
  try {
    return decodeBytes(base64UrlBytes(data), charset).slice(0, BODY_MAX)
  } catch {
    return ''
  }
}

/** RFC 2047 encoded words ("=?UTF-8?B?…?=") that reached us undecoded. */
export function decodeWords(s: string): string {
  if (!s.includes('=?')) return s
  return s
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g, (m, charset: string, enc: string, text: string) => {
      try {
        let bytes: Uint8Array
        if (enc.toUpperCase() === 'B') bytes = base64UrlBytes(text.replace(/\+/g, '-').replace(/\//g, '_'))
        else {
          const raw = text.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (_h, hex: string) => String.fromCharCode(parseInt(hex, 16)))
          bytes = Uint8Array.from(raw, (ch) => ch.charCodeAt(0))
        }
        return decodeBytes(bytes, charset.split('*')[0])
      } catch {
        return m
      }
    })
}

/** One line, no control characters, at most `max` characters. */
export function oneLine(s: string, max = 500): string {
  return s
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/** '"Doe, Jane" <jane@x.com>, bob@y.com' → 'Doe, Jane <jane@x.com>, bob@y.com' */
export function cleanAddresses(raw: string, max = 500): string {
  return oneLine(decodeWords(raw).replace(/"([^"]*)"/g, '$1'), max)
}

/** The display name of the first address ("Jane Doe <jane@x>" → "Jane Doe"), else the address. */
export function senderName(from: string): string {
  const m = from.match(/^\s*([^<]+?)\s*<([^>]+)>/)
  return m ? m[1] : from
}

export function parseMessage(m: GmailMessage): ParsedMail {
  const top = m.payload
  const out: ParsedMail = {
    id: m.id,
    threadId: m.threadId ?? m.id,
    subject: oneLine(decodeWords(header(top, 'Subject')), 300),
    from: cleanAddresses(header(top, 'From')),
    to: cleanAddresses([header(top, 'To'), header(top, 'Cc')].filter(Boolean).join(', ')),
    date: Number(m.internalDate) || Date.parse(header(top, 'Date')) || Date.now(),
    labelIds: m.labelIds ?? [],
    unread: (m.labelIds ?? []).includes('UNREAD'),
    snippet: oneLine(decodeEntities(m.snippet ?? ''), 300),
    html: null,
    text: null,
    attachments: [],
    pending: [],
  }
  const walk = (part: GmailPart | undefined, depth: number) => {
    if (!part || depth > 12) return
    const mime = (part.mimeType ?? '').toLowerCase()
    const name = oneLine(decodeWords(part.filename ?? ''), 200)
    const disposition = header(part, 'Content-Disposition').toLowerCase()
    if (mime === 'message/rfc822') {
      out.attachments.push({ name: name || 'message.eml', size: part.body?.size ?? 0, mime })
      return
    }
    if (mime.startsWith('multipart/')) {
      for (const p of part.parts ?? []) walk(p, depth + 1)
      return
    }
    if (name) {
      // inline images of the HTML (signatures, logos: Content-ID, no "attachment") are not listed
      const inline = !disposition.startsWith('attachment') && !!header(part, 'Content-ID') && mime.startsWith('image/')
      if (!inline) out.attachments.push({ name, size: part.body?.size ?? 0, mime: mime || 'application/octet-stream' })
      return
    }
    if (disposition.startsWith('attachment')) return
    const kind = mime === 'text/html' ? 'html' : mime === 'text/plain' ? 'text' : null
    if (!kind || out[kind] !== null || out.pending.some((p) => p.kind === kind)) return
    if (part.body?.data) out[kind] = decodeBody(part.body.data, charsetOf(part))
    else if (part.body?.attachmentId) out.pending.push({ kind, attachmentId: part.body.attachmentId, charset: charsetOf(part) })
  }
  walk(top, 0)
  return out
}

/** Gmail snippets come HTML-escaped. */
function decodeEntities(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e: string) => {
    const k = e.toLowerCase()
    if (k === 'amp') return '&'
    if (k === 'lt') return '<'
    if (k === 'gt') return '>'
    if (k === 'quot') return '"'
    if (k === 'apos') return "'"
    if (k === 'nbsp') return ' '
    const n = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10)
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m
  })
}

/** "120 KB" */
export function fmtSize(bytes: number, lang: string): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let v = Math.max(0, bytes)
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  const n = i === 0 ? String(Math.round(v)) : v.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', { maximumFractionDigits: v < 10 ? 1 : 0 })
  return `${n} ${units[i]}`
}
