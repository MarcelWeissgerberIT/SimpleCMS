/**
 * MD5 (RFC 1321) over bytes → lowercase hex. WebCrypto has no MD5, but Evernote addresses every
 * embedded resource by the MD5 of its bytes (<en-media hash="…">), so the importer needs one.
 * Pure, no DOM — unit-testable in Node.
 */

const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21]

const K = new Int32Array(64)
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) | 0

const hex = (n: number) => {
  let out = ''
  for (let i = 0; i < 4; i++) out += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, '0')
  return out
}

export function md5(bytes: Uint8Array): string {
  const len = bytes.length
  // message + 0x80 + zero padding + 64-bit little-endian bit length, in 64-byte blocks
  const total = (((len + 8) >>> 6) + 1) << 6
  const buf = new Uint8Array(total)
  buf.set(bytes)
  buf[len] = 0x80
  const bits = len * 8
  const view = new DataView(buf.buffer)
  view.setUint32(total - 8, bits >>> 0, true)
  view.setUint32(total - 4, Math.floor(bits / 0x100000000), true)

  let a0 = 0x67452301
  let b0 = 0xefcdab89 | 0
  let c0 = 0x98badcfe | 0
  let d0 = 0x10325476
  const M = new Int32Array(16)
  for (let off = 0; off < total; off += 64) {
    for (let j = 0; j < 16; j++) M[j] = view.getInt32(off + j * 4, true)
    let a = a0
    let b = b0
    let c = c0
    let d = d0
    for (let i = 0; i < 64; i++) {
      let f: number
      let g: number
      if (i < 16) {
        f = (b & c) | (~b & d)
        g = i
      } else if (i < 32) {
        f = (d & b) | (~d & c)
        g = (5 * i + 1) & 15
      } else if (i < 48) {
        f = b ^ c ^ d
        g = (3 * i + 5) & 15
      } else {
        f = c ^ (b | ~d)
        g = (7 * i) & 15
      }
      const tmp = d
      d = c
      c = b
      const x = (a + f + K[i] + M[g]) | 0
      b = (b + ((x << S[i]) | (x >>> (32 - S[i])))) | 0
      a = tmp
    }
    a0 = (a0 + a) | 0
    b0 = (b0 + b) | 0
    c0 = (c0 + c) | 0
    d0 = (d0 + d) | 0
  }
  return hex(a0) + hex(b0) + hex(c0) + hex(d0)
}
