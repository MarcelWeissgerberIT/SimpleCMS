/**
 * Page permalinks — the address of a page anyone can type or paste: the app's own address with `#/p/<id>` (the hash
 * route, lib/router.ts). It works in the browser's address bar, as a link in a page, in a coding answer (coding/refs.ts
 * reads `#/p/<id>`), in the AI terminal and in ⌘K. No stored field: the id is the page's own.
 *
 * Shorter forms, read where a person types an address (⌘K, the address bar's `#/p/…`): the bare id, any case
 * ("K1YU3M4WEEA2"), and the spec plate's short form "ABCD·1234" — the first 8 of the id's 12 characters, which names one
 * page unless another page's id starts the same (then every match is offered, never a guess).
 */
import type { ID, Page } from '../store/types'

/** A page's permalink on this device's app: origin + path (no query) + `#/p/<id>`. */
export function permalink(id: ID): string {
  return `${window.location.origin}${window.location.pathname}#/p/${id}`
}

/** "ABCD·1234": the spec plate's short, readable form of a page id. */
export const shortPageId = (id: string): string => `${id.slice(0, 4).toUpperCase()}·${id.slice(4, 8).toUpperCase()}`

const HASH = /#\/p\/([A-Za-z0-9_-]{4,64})/
const PATH = /^\/?p\/([A-Za-z0-9_-]{4,64})(?:[?#].*)?$/
const BARE = /^[A-Za-z0-9_-]{8,64}$/
/** "ID ABCD·1234", "abcd1234", "ABCD-1234", "abcd 1234" */
const SHORT = /^(?:id\s*:?\s*)?([a-z0-9]{4})\s*[·.\-\s•]?\s*([a-z0-9]{4})$/i

function decoded(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** What a typed or pasted text names, by its form alone (no lookup): an address with `#/p/<id>`, a bare id, a short form. */
export type PageAddress = { kind: 'address'; id: string } | { kind: 'id'; id: string } | { kind: 'short'; prefix: string }

export function parsePageAddress(input: string): PageAddress | null {
  const text = decoded(input.trim())
  if (!text) return null
  const short = SHORT.exec(text)
  if (short) return { kind: 'short', prefix: `${short[1]}${short[2]}`.toLowerCase() }
  if (/\s/.test(text)) return null
  const hash = HASH.exec(text)
  if (hash) return { kind: 'address', id: hash[1]! }
  const path = PATH.exec(text)
  if (path) return { kind: 'address', id: path[1]! }
  if (BARE.test(text)) return { kind: 'id', id: text }
  return null
}

/**
 * The pages a text names (`parsePageAddress`): the exact id, else the id in any case, else (short form, or an id a
 * page's own starts with — ≥ 8 characters) every page whose id starts with it. [] when none does.
 */
export function pagesAt(input: string, pages: Record<ID, Page>): ID[] {
  const a = parsePageAddress(input)
  if (!a) return []
  if (a.kind !== 'short') {
    if (pages[a.id]) return [a.id]
    const lower = a.id.toLowerCase()
    if (pages[lower]) return [lower]
  }
  const prefix = a.kind === 'short' ? a.prefix : a.id.toLowerCase()
  if (prefix.length < 8) return []
  const out: ID[] = []
  for (const id of Object.keys(pages)) if (id.toLowerCase().startsWith(prefix)) out.push(id)
  return out.slice(0, 8)
}

/** The page id of a URL that is this app's own permalink (same origin and path, `#/p/<id>`); null for anything else. */
export function ownPermalinkId(url: string): string | null {
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return null
  }
  if (u.origin !== window.location.origin || u.pathname !== window.location.pathname) return null
  return HASH.exec(u.hash)?.[1] ?? null
}
