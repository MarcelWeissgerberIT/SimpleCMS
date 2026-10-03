/**
 * A minimal ZIP writer and reader — enough for an MCP Bundle (.mcpb), without a dependency.
 *
 * The writer is deterministic: entries keep the given order, every timestamp is the DOS epoch
 * (1980-01-01 00:00) and file modes are fixed, so packing the same files again gives the same
 * bytes (no diff for a committed public/mcp/one.mcpb). Deflate (level 9) when it saves space,
 * stored otherwise. Unix modes go into the external attributes (made by "Unix"), like
 * `mcpb pack` does, so the server entry stays executable after unpacking.
 */
import { deflateRawSync, inflateRawSync } from 'node:zlib'

export interface ZipEntry {
  /** forward slashes, no leading slash */
  name: string
  data: Uint8Array
  /** Unix permission bits (default 0o644) */
  mode?: number
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** DOS date of 1980-01-01 (day 1, month 1, year 0); the time is 00:00:00. */
const DOS_DATE = (1 << 5) | 1
const UTF8_NAMES = 0x0800
const S_IFREG = 0o100000

export function zip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    if (!e.name || e.name.startsWith('/') || e.name.includes('\\') || e.name.split('/').includes('..')) throw new Error(`bad zip entry name ${JSON.stringify(e.name)}`)
    const name = Buffer.from(e.name, 'utf8')
    const raw = Buffer.from(e.data.buffer, e.data.byteOffset, e.data.byteLength)
    const deflated = deflateRawSync(raw, { level: 9 })
    const method = deflated.length < raw.length ? 8 : 0
    const body = method === 8 ? deflated : raw
    const crc = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed: 2.0
    local.writeUInt16LE(UTF8_NAMES, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0, 10) // time
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28) // extra
    locals.push(local, name, body)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE((3 << 8) | 20, 4) // made by Unix, 2.0
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(UTF8_NAMES, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    // extra, comment, disk number, internal attributes: 0
    central.writeUInt32LE(((S_IFREG | ((e.mode ?? 0o644) & 0o777)) << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + body.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

export interface UnzippedEntry {
  data: Buffer
  /** Unix permission bits from the external attributes (0 when the archive has none) */
  mode: number
}

/** Read a ZIP (no ZIP64, no encryption): name → contents, in archive order. CRCs are checked. */
export function unzip(buf: Buffer): Map<string, UnzippedEntry> {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('not a zip file (no end of central directory)')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const out = new Map<string, UnzippedEntry>()
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`bad central directory entry ${i}`)
    const method = buf.readUInt16LE(p + 10)
    const crc = buf.readUInt32LE(p + 16)
    const size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const attrs = buf.readUInt32LE(p + 38)
    const at = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + extraLen + commentLen
    if (buf.readUInt32LE(at) !== 0x04034b50) throw new Error(`bad local header for ${name}`)
    const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28)
    const body = buf.subarray(start, start + size)
    const data = method === 8 ? inflateRawSync(body) : method === 0 ? Buffer.from(body) : null
    if (!data) throw new Error(`unsupported compression ${method} for ${name}`)
    if (crc32(data) !== crc) throw new Error(`CRC mismatch for ${name}`)
    out.set(name, { data, mode: (attrs >>> 16) & 0o777 })
  }
  return out
}
