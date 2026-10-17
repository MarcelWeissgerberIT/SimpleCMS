/**
 * One MCP — block refs (spec § 2.1), pure; a skeleton in B1: the forms, parsing and the id prefix. B2 builds the reads
 * that hand them out (with the content hash), B4 the edits that take them.
 *
 * A ref names a block of a page AS LAST READ, stateless (an MCP client outlives reloads, the team server has no tab):
 *   `#<id>~<h>`    <id> = the shortest unique prefix (≥ 6 characters) of the block's id on that page
 *   `@<path>~<h>`  a block without an id: its child indexes from the document (`@3.0.1`)
 *   <h>            6 hex characters of the SHA-256 over the block's key (ids left out) at read time — a ref whose block
 *                  hashes differently now is refused (`stale_ref`). Optional only when the call passes `baseRev` equal
 *                  to the page's current `rev`.
 * Input is lenient: wrapped in ⟦…⟧ (as the AI terminal shows its labels), surrounding spaces, the hash in any case.
 * The digest itself comes from the caller (WebCrypto in the tab, node:crypto on the server): this module stays sync.
 */

/** Shortest id prefix a ref uses. */
export const REF_MIN_PREFIX = 6
/** Hex characters of the content hash. */
export const REF_HASH_LEN = 6

export type McpRef = { kind: 'id'; prefix: string; hash: string | null } | { kind: 'path'; path: number[]; hash: string | null }

/** What a page read knows about one block: its id (null: none yet), its place and its key (for the hash). */
export interface RefEntry {
  id: string | null
  path: number[]
  key: string
}

const ID_PART = /^[A-Za-z0-9_-]{1,64}$/
const PATH_PART = /^\d{1,4}(\.\d{1,4}){0,15}$/
const HASH_PART = /^[0-9a-f]{6}$/

/** A ref as a client wrote it → its parts; null when it is no ref. */
export function parseRef(input: unknown): McpRef | null {
  if (typeof input !== 'string') return null
  let s = input.trim()
  if (s.startsWith('⟦') && s.endsWith('⟧')) s = s.slice(1, -1).trim()
  if (s.length < 2 || s.length > 200) return null
  const sigil = s[0]
  if (sigil !== '#' && sigil !== '@') return null
  const [body = '', hashRaw, ...rest] = s.slice(1).split('~')
  if (rest.length) return null
  const hash = hashRaw === undefined ? null : hashRaw.toLowerCase()
  if (hash !== null && !HASH_PART.test(hash)) return null
  if (sigil === '#') return ID_PART.test(body) ? { kind: 'id', prefix: body, hash } : null
  return PATH_PART.test(body) ? { kind: 'path', path: body.split('.').map(Number), hash } : null
}

/** The ref's text, as reads hand it out. */
export function formatRef(ref: McpRef): string {
  const head = ref.kind === 'id' ? `#${ref.prefix}` : `@${ref.path.join('.')}`
  return ref.hash ? `${head}~${ref.hash}` : head
}

/** The content hash of a ref from a SHA-256 hex digest of the block's key. */
export const refHash = (sha256Hex: string): string => sha256Hex.slice(0, REF_HASH_LEN).toLowerCase()

/** The shortest prefix of `id` (≥ REF_MIN_PREFIX characters) no other id of the page starts with. */
export function shortestPrefix(id: string, ids: Iterable<string>, min = REF_MIN_PREFIX): string {
  const others = [...ids].filter((x) => x !== id)
  for (let n = Math.min(min, id.length); n < id.length; n++) {
    const p = id.slice(0, n)
    if (!others.some((x) => x.startsWith(p))) return p
  }
  return id
}

/** The ids a prefix may mean (one: the block; none: gone; several: ambiguous — `stale_ref` lists them). */
export const idsFor = (prefix: string, ids: Iterable<string>): string[] => [...ids].filter((x) => x.startsWith(prefix))
