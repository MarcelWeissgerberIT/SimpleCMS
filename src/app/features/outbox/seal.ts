/**
 * The foreign-text seal (pure; docs/OUTBOX.md § Seal). The Outbox computes trust itself and never takes it from a
 * caller: only typed values and text the person typed or owns count as clean. What a slip's free text carries:
 *  - hidden characters (bidi controls, zero-width and tag characters, runs of variation selectors) → `⟦U+202E⟧`
 *    markers and the HIDDEN CHARS lamp;
 *  - addresses (URLs, Markdown link targets, bare host/paths, e-mail addresses): each is looked up in the sources.
 *    Found in a trusted source (or typed by the person — the words they added in an edit, found by a word diff) it
 *    passes; found only in foreign text it is flagged with that source's label; found nowhere it is flagged too;
 *    one pointing into One (`#/p/…`, One's own origin) is flagged 'internal'. A flagged address needs a tick.
 *  - a host-only trusted match never clears an address with a path ("teilen.example" ≠ "teilen.example/rp").
 */
import { wordRuns } from '../history/docDiff'
import type { Seal, SealAddress, SourceRef } from './types'

/* ------------------------------------------------------------------ hidden characters */

/** Is this code point one that hides or reorders text? (variation selectors only in runs — see hiddenRuns) */
function hiddenPoint(cp: number): boolean {
  return (
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2060 && cp <= 0x2064) ||
    (cp >= 0x2066 && cp <= 0x2069) ||
    cp === 0x061c ||
    cp === 0xfeff ||
    (cp >= 0xe0000 && cp <= 0xe007f)
  )
}
const variationSelector = (cp: number) => (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef)

export const codeLabel = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`

export type TextPart = { text: string } | { hidden: string }

/** The text cut into plain parts and hidden code points (each its own part). Variation selectors count in runs of 2+. */
export function hiddenParts(text: string): TextPart[] {
  const cps = [...text]
  const out: TextPart[] = []
  let buf = ''
  const flush = () => {
    if (buf) out.push({ text: buf })
    buf = ''
  }
  for (let i = 0; i < cps.length; i++) {
    const ch = cps[i]
    const cp = ch.codePointAt(0)!
    const vsRun = variationSelector(cp) && ((i > 0 && variationSelector(cps[i - 1].codePointAt(0)!)) || (i + 1 < cps.length && variationSelector(cps[i + 1].codePointAt(0)!)))
    if (hiddenPoint(cp) || vsRun) {
      flush()
      out.push({ hidden: codeLabel(cp) })
    } else buf += ch
  }
  flush()
  return out
}

/** The hidden code points of a text, each once ("U+202E"). */
export function hiddenChars(text: string): string[] {
  const out: string[] = []
  for (const p of hiddenParts(text)) if ('hidden' in p && !out.includes(p.hidden)) out.push(p.hidden)
  return out
}

/** The text with every hidden code point drawn as `⟦U+202E⟧`. */
export const showHidden = (text: string): string => hiddenParts(text).map((p) => ('hidden' in p ? `⟦${p.hidden}⟧` : p.text)).join('')

/* ------------------------------------------------------------------ addresses */

export interface FoundAddress {
  text: string
  norm: string
  host: string
  /** where it sits in the text */
  at: number
  kind: 'url' | 'email' | 'host' | 'internal'
}

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`)\]]+/gi
const EMAIL_RE = /(?:mailto:)?[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}\b/g
const HOST_RE = /(?<![\w@./-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?::\d{2,5})?(?:\/[^\s<>"'`)\]]*)?/gi
const INTERNAL_RE = /(?<![\w/])#\/[A-Za-z0-9/_?=&.-]+/g
/** file names that read like hosts ("notes.md") — not addresses unless a path follows */
const FILE_EXT = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'tsv', 'txt', 'md', 'json', 'js', 'mjs', 'ts', 'tsx', 'jsx', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'zip', 'html', 'htm', 'xml', 'yml', 'yaml', 'log', 'py', 'java', 'sql', 'ppt', 'pptx', 'css', 'sh', 'go', 'rs', 'rb', 'php', 'kt', 'swift', 'vue'])

const trimEnd = (s: string) => s.replace(/[.,;:!?'"’”»)]+$/u, '')

/** host + path, lower-case host, no scheme, no "www.", no trailing slash. */
export function normAddress(raw: string): { norm: string; host: string } | null {
  let s = trimEnd(raw.trim())
  if (/^mailto:/i.test(s)) s = s.slice(7)
  if (/^[^@\s/]+@[^@\s/]+$/.test(s)) {
    const lower = s.toLowerCase()
    return { norm: lower, host: lower.split('@')[1] }
  }
  s = s.replace(/^https?:\/\//i, '')
  const slash = s.search(/[/?#]/)
  const hostPart = (slash < 0 ? s : s.slice(0, slash)).toLowerCase().replace(/^www\./, '').replace(/:(80|443)$/, '')
  if (!hostPart) return null
  let rest = slash < 0 ? '' : s.slice(slash)
  rest = rest.replace(/#.*$/, '').replace(/\/+$/, '')
  if (rest === '/') rest = ''
  return { norm: `${hostPart}${rest}`, host: hostPart }
}

/** Every address in a text (each place it is written), with One's own links marked internal. `origin`: One's origin. */
export function scanAddresses(text: string, origin = ''): FoundAddress[] {
  const out: FoundAddress[] = []
  const taken: Array<[number, number]> = []
  const free = (a: number, b: number) => !taken.some(([x, y]) => a < y && b > x)
  const ownHost = origin ? (normAddress(origin)?.host ?? '') : ''
  const push = (raw: string, at: number, kind: FoundAddress['kind']) => {
    const text = trimEnd(raw)
    if (!text || !free(at, at + text.length)) return
    if (kind === 'internal') {
      taken.push([at, at + text.length])
      out.push({ text, norm: text, host: '', at, kind })
      return
    }
    const n = normAddress(text)
    if (!n) return
    if (kind === 'host' && !n.norm.includes('/') && FILE_EXT.has(n.host.split('.').pop() ?? '')) return
    taken.push([at, at + text.length])
    out.push({ text, norm: n.norm, host: n.host, at, kind: ownHost && n.host === ownHost ? 'internal' : kind })
  }
  for (const m of text.matchAll(URL_RE)) push(m[0], m.index ?? 0, 'url')
  for (const m of text.matchAll(EMAIL_RE)) push(m[0], m.index ?? 0, 'email')
  for (const m of text.matchAll(INTERNAL_RE)) push(m[0], m.index ?? 0, 'internal')
  for (const m of text.matchAll(HOST_RE)) push(m[0], m.index ?? 0, 'host')
  return out.sort((a, b) => a.at - b.at)
}

/** The normalized address set of a source text (≤ 50, internal links included as written). */
export function addressSet(text: string, origin = ''): string[] {
  const out: string[] = []
  for (const a of scanAddresses(text, origin)) if (!out.includes(a.norm) && out.length < 50) out.push(a.norm)
  return out
}

/** Markdown link targets ("[x](https://…)") in order — shown in full under a slip's text. */
export function linkTargets(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\[[^\]\n]{0,300}\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g)) if (!out.includes(m[1])) out.push(m[1])
  return out
}

const hostOfNorm = (norm: string) => (norm.includes('@') ? norm.split('@')[1] : norm.split(/[/?]/)[0])

/** Does a source's address set clear the address? Exact match; a host-only address is cleared by its host. */
function covers(set: readonly string[], a: { norm: string; host: string }): boolean {
  const hostOnly = a.norm === a.host
  return set.some((s) => s === a.norm || (hostOnly && hostOfNorm(s) === a.host))
}

/** Is it at least about the same place (the foreign source to name)? */
const near = (set: readonly string[], a: { norm: string; host: string }) => set.some((s) => s === a.norm || hostOfNorm(s) === a.host)

/** The words the person added in an edit: the added runs of a word diff between Claude's text and theirs. */
export function personAdded(claudeText: string | undefined, text: string): string {
  if (claudeText === undefined) return ''
  return wordRuns(claudeText, text)
    .filter((r) => r.op === 'add')
    .map((r) => r.text)
    .join(' ')
}

export interface SealInput {
  /** the slip's free text ('' or null: a typed-only slip) */
  text: string | null
  sources: SourceRef[]
  /** the provenance is fully known (a caller without sources: false) */
  complete: boolean
  /** text the person typed (the instruction, the words added in an edit) — trusted */
  ownText?: string
  origin?: string
  /** the previous seal: ticks stay with their address */
  previous?: Seal | null
}

export function sealOf(i: SealInput): Seal {
  const text = i.text ?? ''
  const hidden = text ? hiddenChars(text) : []
  const shaping = text ? i.sources.filter((s) => !s.trusted && !s.typed) : []
  const trusted = [...i.sources.filter((s) => s.trusted).flatMap((s) => s.addresses), ...(i.ownText ? addressSet(i.ownText, i.origin) : [])]
  const ticked = new Set((i.previous?.addresses ?? []).filter((a) => a.ticked).map((a) => `${a.only}|${a.norm}`))
  const addresses: SealAddress[] = []
  const seen = new Set<string>()
  for (const a of text ? scanAddresses(text, i.origin) : []) {
    if (seen.has(a.norm)) continue
    seen.add(a.norm)
    let flag: SealAddress | null = null
    if (a.kind === 'internal') flag = { text: a.text, norm: a.norm, only: 'internal', ticked: false }
    else if (!covers(trusted, a)) {
      const from = i.sources.find((s) => !s.trusted && near(s.addresses, a))
      flag = from ? { text: a.text, norm: a.norm, only: 'foreign', source: from.label, ticked: false } : { text: a.text, norm: a.norm, only: 'nowhere', ticked: false }
    }
    if (!flag) continue
    flag.ticked = ticked.has(`${flag.only}|${flag.norm}`)
    addresses.push(flag)
  }
  const cross = false
  return {
    complete: i.complete,
    foreign: shaping.length,
    addresses,
    hidden,
    cross,
    clean: i.complete && !shaping.length && !addresses.length && !hidden.length && !cross,
  }
}

/** Every flagged address ticked? */
export const addressesTicked = (seal: Seal): boolean => seal.addresses.every((a) => a.ticked)
