/**
 * What a file really is, by its first bytes (pure). Saving media from an MCP result checks the declared
 * type against this: a "PNG" that is HTML, or a "video" that is a script, is refused.
 */
import type { MediaKind } from './types'

export interface Sniffed {
  /** the type the bytes say */
  mime: string
  /** the kinds a container can hold (MP4 / WebM / Ogg: video or audio) */
  kinds: MediaKind[]
  svg?: boolean
}

const ascii = (b: Uint8Array, from: number, len: number) => String.fromCharCode(...b.subarray(from, from + len))

/** The type of `b` by its magic numbers (null: not an image, video or audio file One knows). */
export function sniff(b: Uint8Array): Sniffed | null {
  if (b.length < 4) return null
  if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return { mime: 'image/png', kinds: ['image'] }
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', kinds: ['image'] }
  if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return { mime: 'image/gif', kinds: ['image'] }
  if (ascii(b, 0, 4) === 'RIFF' && b.length >= 12) {
    const sub = ascii(b, 8, 4)
    if (sub === 'WEBP') return { mime: 'image/webp', kinds: ['image'] }
    if (sub === 'WAVE') return { mime: 'audio/wav', kinds: ['audio'] }
    if (sub === 'AVI ') return { mime: 'video/x-msvideo', kinds: ['video'] }
  }
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4).toLowerCase()
    if (brand === 'avif' || brand === 'avis') return { mime: 'image/avif', kinds: ['image'] }
    if (brand === 'heic' || brand === 'heix' || brand === 'mif1') return { mime: 'image/heic', kinds: ['image'] }
    if (brand.startsWith('m4a') || brand.startsWith('m4b')) return { mime: 'audio/mp4', kinds: ['audio'] }
    if (brand.startsWith('qt')) return { mime: 'video/quicktime', kinds: ['video'] }
    return { mime: 'video/mp4', kinds: ['video', 'audio'] }
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { mime: 'video/webm', kinds: ['video', 'audio'] }
  if (ascii(b, 0, 4) === 'OggS') return { mime: 'audio/ogg', kinds: ['audio', 'video'] }
  if (ascii(b, 0, 4) === 'fLaC') return { mime: 'audio/flac', kinds: ['audio'] }
  if (ascii(b, 0, 3) === 'ID3') return { mime: 'audio/mpeg', kinds: ['audio'] }
  // MPEG audio frame sync (MP3) / ADTS (AAC)
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return (b[1] & 0x06) === 0 ? { mime: 'audio/aac', kinds: ['audio'] } : { mime: 'audio/mpeg', kinds: ['audio'] }
  if (isSvg(b)) return { mime: 'image/svg+xml', kinds: ['image'], svg: true }
  return null
}

/** SVG markup: text that opens with "<svg" (after an XML declaration, comments, a doctype or whitespace). */
function isSvg(b: Uint8Array): boolean {
  let s: string
  try {
    s = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, 2048))
  } catch {
    return false
  }
  const head = s.replace(/^\uFEFF/, '').trimStart()
  if (!head.startsWith('<')) return false
  const rest = head.replace(/^(<\?xml[\s\S]*?\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE[\s\S]*?>\s*)*/i, '')
  return /^<svg[\s>]/i.test(rest)
}

/** The extension for a type ('' = none known). */
export function extOf(mime: string): string {
  const m: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/heic': 'heic',
    'image/svg+xml': 'svg',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'video/x-msvideo': 'avi',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/flac': 'flac',
  }
  return m[mime] ?? ''
}
