/**
 * String-level HTML / XML helpers for the planners (pure, no DOM — unit-testable in Node).
 * The real HTML → TipTap conversion (DOM, sanitizer, schema) lives in htmldoc.ts.
 */

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
}

/** Decode character references (numeric + the common named ones). */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (all, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all
    }
    return NAMED[ref] ?? all
  })
}

/** Escape text for use inside HTML (text nodes and double-quoted attributes). */
export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Text content of an HTML fragment (tags dropped, entities decoded, whitespace collapsed). */
export const textOf = (html: string) =>
  decodeEntities(html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()

/** Page title of an HTML document: <title>, else the first <h1>. */
export function htmlTitle(html: string): string | null {
  const t = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
  const title = t ? textOf(t[1]) : ''
  if (title) return title
  const h = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
  const h1 = h ? textOf(h[1]) : ''
  return h1 || null
}

/** Every href / src target in an HTML string, in document order. */
export function htmlTargets(html: string): string[] {
  const out: string[] = []
  for (const m of html.matchAll(/<(?:a|img|source|link)\b[^>]*?\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const v = decodeEntities(m[1] ?? m[2] ?? m[3] ?? '').trim()
    if (v) out.push(v)
  }
  return out
}

const DATA_IMG = /(<img\b[^>]*?\ssrc\s*=\s*)(["'])data:image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml);base64,([a-z0-9+/=\s]+)\2/gi

/** Base64 → bytes (whitespace tolerant). */
export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Inline base64 images (Google Docs, Dropbox Paper and mail exports carry them) → real files.
 * `place(ext, i)` returns the file's path relative to the document; the bytes are handed to `add`.
 */
export function extractDataImages(html: string, place: (ext: string, i: number) => string, add: (rel: string, bytes: Uint8Array) => void): string {
  if (!/src\s*=\s*["']data:image\//i.test(html)) return html
  let i = 0
  return html.replace(DATA_IMG, (all, head: string, q: string, type: string, b64: string) => {
    try {
      const ext = type === 'jpeg' ? 'jpg' : type === 'svg+xml' ? 'svg' : type
      const rel = place(ext, ++i)
      add(rel, fromBase64(b64))
      return `${head}${q}${rel.split('/').map(encodeURIComponent).join('/')}${q}`
    } catch {
      return all
    }
  })
}
