/**
 * Content hashes for sync bookkeeping: the git blob id (SHA-1 of "blob <size>\0" + bytes), so a
 * file written to a folder and the same file in a GitHub tree carry the very same id.
 */
const encoder = new TextEncoder()

export const utf8 = (s: string): Uint8Array => encoder.encode(s)

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')

export async function gitBlobSha(data: Uint8Array): Promise<string> {
  const head = utf8(`blob ${data.byteLength}\0`)
  const all = new Uint8Array(head.byteLength + data.byteLength)
  all.set(head, 0)
  all.set(data, head.byteLength)
  return hex(await crypto.subtle.digest('SHA-1', all))
}

export function toBase64(data: Uint8Array): string {
  let s = ''
  const CHUNK = 0x8000
  for (let i = 0; i < data.length; i += CHUNK) s += String.fromCharCode(...data.subarray(i, i + CHUNK))
  return btoa(s)
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64.replace(/\s+/g, ''))
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

/** UTF-8 text of a file (BOM dropped). */
export function textOf(data: Uint8Array): string {
  return new TextDecoder('utf-8').decode(data).replace(/^﻿/, '')
}
