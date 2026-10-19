/**
 * One MCP — block refs (spec § 2.1), pure: the forms, parsing, the id prefixes, the content digest a ref's hash comes
 * from and the labels a read with `refs: true` writes (stripped again by every writing tool). B2 builds the reads that
 * hand them out (src/shared/mcp/pageRead.ts), B4 the edits that take them.
 *
 * A ref names a block of a page AS LAST READ, stateless (an MCP client outlives reloads, the team server has no tab):
 *   `#<id>~<h>`    <id> = the shortest unique prefix (≥ 6 characters) of the block's id on that page
 *   `@<path>~<h>`  a block without an id: its child indexes from the document (`@3.0.1`)
 *   <h>            6 hex characters of the SHA-256 over the block's key (ids left out) at read time — a ref whose block
 *                  hashes differently now is refused (`stale_ref`). Optional only when the call passes `baseRev` equal
 *                  to the page's current `rev`.
 * Input is lenient: wrapped in ⟦…⟧ (as the AI terminal shows its labels), surrounding spaces, the hash in any case.
 * The digest is one pure SHA-256 (sha256.ts) for the tab and the team server alike: this module stays sync.
 */
import { canonicalJson } from './duplicates.ts'
import { sha256Hex } from './sha256.ts'

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
  // as Markdown escaped it (`\_`, `\~`) when copied out of a read's text
  s = s.replace(/\\(?=[_~])/g, '')
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

/** The shortest unique prefix (≥ min characters) of every id; ids that occur more than once are left out (ambiguous). */
export function prefixesFor(ids: Iterable<string>, min = REF_MIN_PREFIX): Map<string, string> {
  const count = new Map<string, number>()
  for (const id of ids) count.set(id, (count.get(id) ?? 0) + 1)
  const sorted = [...count.keys()].sort()
  const lcp = (a: string | undefined, b: string): number => {
    if (a === undefined) return 0
    let i = 0
    while (i < a.length && i < b.length && a[i] === b[i]) i++
    return i
  }
  const out = new Map<string, string>()
  sorted.forEach((id, i) => {
    if (count.get(id)! > 1) return
    // a prefix is unique once it is longer than the common part with both sorted neighbours
    const n = Math.max(lcp(sorted[i - 1], id), lcp(sorted[i + 1], id)) + 1
    out.set(id, id.slice(0, Math.min(id.length, Math.max(min, n))))
  })
  return out
}

/* ------------------------------------------------------------------ */
/* The content digest                                                  */
/* ------------------------------------------------------------------ */

/** A ProseMirror JSON node: TipTap JSON in the tab; the team server reads its Y XML into the same shape. */
export interface PMJson {
  type?: string
  attrs?: Record<string, unknown> | null
  content?: PMJson[]
  text?: string
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> | null }>
}

/** Inline nodes: part of their textblock's own key (never a digest of their own). */
const INLINE = new Set(['text', 'hardBreak', 'mention', 'inlineMath', 'icon', 'emoji'])

/** attrs without the block id (each editor fills in its own) and without empty values. */
function keptAttrs(attrs: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
  if (!attrs) return undefined
  let out: Record<string, unknown> | undefined
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'id' || v === null || v === undefined) continue
    ;(out ??= {})[k] = v
  }
  return out
}

function inlineKey(n: PMJson): unknown {
  return { t: n.type ?? '', a: keptAttrs(n.attrs), x: n.text, m: n.marks?.length ? n.marks.map((m) => ({ t: m.type ?? '', a: keptAttrs(m.attrs) })) : undefined }
}

/**
 * The SHA-256 (hex) of a block's content with its ids left out: a block reads the same however often an editor gave it a
 * fresh id, and changes digest with any change of text, marks, attrs or children. Block children enter by their own
 * digest (`memo` keeps them per node object), so a page is hashed once however deep it nests.
 */
export function blockDigest(node: PMJson, memo?: WeakMap<object, string>): string {
  const hit = memo?.get(node)
  if (hit) return hit
  const kids = (node.content ?? []).map((c) => (INLINE.has(c.type ?? '') ? inlineKey(c) : `#${blockDigest(c, memo)}`))
  const digest = sha256Hex(canonicalJson({ t: node.type ?? '', a: keptAttrs(node.attrs), x: node.text, c: kids.length ? kids : undefined }))
  memo?.set(node, digest)
  return digest
}

/** The content hash a ref carries for a block (REF_HASH_LEN hex characters of its digest). */
export const blockHash = (node: PMJson, memo?: WeakMap<object, string>): string => refHash(blockDigest(node, memo))

/* ------------------------------------------------------------------ */
/* Labels in Markdown                                                  */
/* ------------------------------------------------------------------ */

/** A ref as a read with `refs: true` writes it into Markdown: ⟦#3f9a1c~a1b2c3⟧. */
export const refLabel = (ref: string): string => `⟦${ref}⟧`

/**
 * Markdown without ref labels (a client may copy them from a read; they never reach content): a label on a line of its
 * own goes with its line, one in front of text (a list item, a task title) with the space after it.
 */
export function stripRefLabels(markdown: string): string {
  if (!markdown.includes('⟦')) return markdown
  // a label line (also inside a quote / callout: "> ⟦…⟧") goes whole; a label in front of text leaves the text
  return markdown.replace(/^[ \t>]*⟦[#@][^⟦⟧\n]{1,200}⟧[ \t]*(?:\n|$)/gm, '').replace(/⟦[#@][^⟦⟧\n]{1,200}⟧[ \t]?/g, '')
}
