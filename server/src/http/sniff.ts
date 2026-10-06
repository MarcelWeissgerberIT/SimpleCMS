/**
 * What a media file really is, by its first bytes — the server's twin of the app's
 * src/app/features/ai/media/sniff.ts (keep them in step). POST …/files/fetch stores a file only when the
 * declared type's family (image / video / audio) is one the bytes allow.
 */
export type MediaFamily = 'image' | 'video' | 'audio'

export interface Sniffed {
  mime: string
  kinds: MediaFamily[]
  svg?: boolean
}

const ascii = (b: Uint8Array, from: number, len: number) => Buffer.from(b.subarray(from, from + len)).toString('latin1')

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
  const b1 = b[1] ?? 0
  if (b[0] === 0xff && (b1 & 0xe0) === 0xe0) return (b1 & 0x06) === 0 ? { mime: 'audio/aac', kinds: ['audio'] } : { mime: 'audio/mpeg', kinds: ['audio'] }
  const head = Buffer.from(b.subarray(0, 2048)).toString('utf8').replace(/^\uFEFF/, '').trimStart()
  if (head.startsWith('<')) {
    const rest = head.replace(/^(<\?xml[\s\S]*?\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE[\s\S]*?>\s*)*/i, '')
    if (/^<svg[\s>]/i.test(rest)) return { mime: 'image/svg+xml', kinds: ['image'], svg: true }
  }
  return null
}

const EXT: Record<string, string> = {
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

export const extOf = (mime: string) => EXT[mime] ?? ''
