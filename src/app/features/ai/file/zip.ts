/**
 * Decompression with a budget on what the data really gives — never on what a header claims.
 *
 * A zip entry's "original size" and a PDF stream's length are written by whoever made the file. A
 * crafted Word / Excel file (a mail attachment) can claim a few kilobytes and inflate to gigabytes:
 * inflating it at once would freeze the tab or run it out of memory. Here the compressed bytes go in
 * small slices and the output is counted as it comes; past the budget the work stops.
 */
import { Unzip, UnzipInflate, Unzlib } from 'fflate'

/** Compressed bytes per step (worst case DEFLATE turns 16 KB into ~16 MB). */
const SLICE = 16 * 1024

export class InflateBudgetError extends Error {
  constructor(readonly bytes: number) {
    super(`more than the budget (${bytes} bytes so far)`)
    this.name = 'InflateBudgetError'
  }
}

const joined = (parts: Uint8Array[], size: number): Uint8Array => {
  if (parts.length === 1) return parts[0]
  const out = new Uint8Array(size)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/**
 * The entries of a zip whose name `want` accepts, inflated. Throws InflateBudgetError when together
 * they give more than `max` bytes, and fflate's error for anything that is not a zip.
 */
export function unzipBounded(bytes: Uint8Array, want: (name: string) => boolean, max: number): Record<string, Uint8Array> {
  const parts = new Map<string, { chunks: Uint8Array[]; size: number }>()
  let total = 0
  const uz = new Unzip()
  uz.register(UnzipInflate)
  uz.onfile = (file) => {
    if (!want(file.name)) return
    const entry = { chunks: [] as Uint8Array[], size: 0 }
    parts.set(file.name, entry)
    file.ondata = (err, chunk) => {
      if (err) throw err
      total += chunk.length
      if (total > max) throw new InflateBudgetError(total)
      entry.chunks.push(chunk)
      entry.size += chunk.length
    }
    file.start()
  }
  for (let i = 0; i < bytes.length; i += SLICE) uz.push(bytes.subarray(i, Math.min(bytes.length, i + SLICE)), i + SLICE >= bytes.length)
  if (!bytes.length) uz.push(bytes, true)
  const out: Record<string, Uint8Array> = {}
  for (const [name, e] of parts) out[name] = joined(e.chunks, e.size)
  return out
}

/** A zlib stream inflated up to `max` bytes (what came before the budget ran out; never more). */
export function unzlibUpTo(bytes: Uint8Array, max: number): Uint8Array {
  const chunks: Uint8Array[] = []
  let size = 0
  let full = false
  const z = new Unzlib((chunk) => {
    if (full) return
    const room = max - size
    const take = chunk.length > room ? chunk.subarray(0, room) : chunk
    chunks.push(take)
    size += take.length
    if (size >= max) full = true
  })
  for (let i = 0; i < bytes.length && !full; i += SLICE) z.push(bytes.subarray(i, Math.min(bytes.length, i + SLICE)), i + SLICE >= bytes.length)
  return joined(chunks, size)
}
