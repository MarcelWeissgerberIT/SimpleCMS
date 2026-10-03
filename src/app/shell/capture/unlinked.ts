/**
 * Unlinked mentions (Obsidian has them, Notion does not): pages whose text names a page
 * without linking it, and the "Link" action that turns that text into a page mention.
 *
 * Two passes, both cached per (immutable) page object:
 *  1. cheap: a whole-word, case-insensitive test against the page.plain cache;
 *  2. precise, only for hits: the first occurrence in the TipTap JSON that "Link" can
 *     actually convert (paragraph / heading text, not inside links or inline code).
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../store/store'
import { isEffectivelyTrashed, mayChangeAnswer } from '../../store/selectors'
import type { ID, Page } from '../../store/types'

export const UNLINKED_CAP = 50
/** setContent origin of a "Link" write (editors apply it as an external update). */
export const LINK_ORIGIN = 'link'

const MIN_TITLE = 3
/** Placeholder titles in both languages never count as a mention. */
const UNTITLED = new Set(['untitled', 'ohne titel', 'unbenannt'])
/** Text blocks whose inline content may hold a mention node (code blocks / toggle summaries are text-only). */
const TEXTBLOCKS = new Set(['paragraph', 'heading'])
/** Text under these marks is not prose to link (already a link, or code). */
const BLOCKING_MARKS = new Set(['link', 'code'])
/** Stands in for anything "Link" must not touch; never part of a title, so a match never spans it. */
const BLOCK = '￼'
const SNIPPET = 72

export interface TitleMatcher {
  /** cache key */
  key: string
  test: RegExp
  scan: RegExp
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whole-word, case-insensitive matcher for a page title, or null if the title is too short or a placeholder. */
export function titleMatcher(title: string): TitleMatcher | null {
  const norm = title.trim().replace(/\s+/g, ' ')
  if (norm.length < MIN_TITLE || UNTITLED.has(norm.toLowerCase())) return null
  // not inside a word on either side; "@Title" is how plain text renders a mention, not prose
  const src = `(?<![\\p{L}\\p{N}_@])${norm.split(' ').map(escapeRe).join('\\s+')}(?![\\p{L}\\p{N}_])`
  return { key: src, test: new RegExp(src, 'iu'), scan: new RegExp(src, 'giu') }
}

export interface Occurrence {
  /** child indexes from the doc root to the text block */
  path: number[]
  /** match range in the block's flattened text */
  start: number
  end: number
  before: string
  match: string
  after: string
  /** nearest block id (for #/p/<id>?b=<block>) */
  blockId: string | null
}

interface Seg {
  index: number
  start: number
  end: number
  /** what a reader sees for this child (snippet) */
  show: string
}

/** Flatten a text block: linkable text stays, everything else becomes BLOCK characters. */
function flatten(block: JSONContent): { text: string; segs: Seg[] } {
  let text = ''
  const segs: Seg[] = []
  block.content?.forEach((n, index) => {
    const start = text.length
    if (n.type === 'text') {
      const s = n.text ?? ''
      text += n.marks?.some((m) => BLOCKING_MARKS.has(m.type)) ? BLOCK.repeat(s.length) : s
      segs.push({ index, start, end: text.length, show: s })
    } else {
      text += BLOCK
      const show = n.type === 'mention' ? `@${n.attrs?.label ?? ''}` : n.type === 'hardBreak' ? ' ' : ''
      segs.push({ index, start, end: text.length, show })
    }
  })
  return { text, segs }
}

function snippetParts(segs: Seg[], start: number, end: number): { before: string; after: string } {
  let before = ''
  let after = ''
  for (const g of segs) {
    if (g.end <= start) before += g.show
    else if (g.start < start) before += g.show.slice(0, start - g.start)
    if (g.start >= end) after += g.show
    else if (g.end > end) after += g.show.slice(end - g.start)
  }
  before = before.replace(/\s+/g, ' ')
  after = after.replace(/\s+/g, ' ')
  if (before.length > SNIPPET) before = `…${before.slice(-SNIPPET).replace(/^\S*\s/, '')}`
  if (after.length > SNIPPET) after = `${after.slice(0, SNIPPET).replace(/\s\S*$/, '')}…`
  return { before, after }
}

/** First linkable occurrence of the matcher in a doc (document order), or null. */
export function findOccurrence(doc: JSONContent | null | undefined, m: TitleMatcher): Occurrence | null {
  if (!doc) return null
  const re = m.scan
  let found: Occurrence | null = null
  const walk = (n: JSONContent, path: number[], blockId: string | null) => {
    if (found) return
    const id = typeof n.attrs?.id === 'string' && n.attrs.id ? n.attrs.id : blockId
    if (n.type && TEXTBLOCKS.has(n.type)) {
      const { text, segs } = flatten(n)
      re.lastIndex = 0
      const hit = re.exec(text)
      if (hit) {
        const start = hit.index
        const end = start + hit[0].length
        found = { path, start, end, match: text.slice(start, end), blockId: id, ...snippetParts(segs, start, end) }
      }
      return
    }
    n.content?.forEach((c, i) => walk(c, [...path, i], id))
  }
  walk(doc, [], null)
  return found
}

type Mark = NonNullable<JSONContent['marks']>[number]
const markKey = (m: Mark) => JSON.stringify([m.type, m.attrs ?? null])

/** Marks every covered text node has (bold, italic, colour …) — never link or code. */
function sharedMarks(nodes: JSONContent[]): Mark[] {
  const [first, ...rest] = nodes
  const keep = (first?.marks ?? []).filter((m) => !BLOCKING_MARKS.has(m.type))
  return keep.filter((m) => rest.every((n) => (n.marks ?? []).some((x) => markKey(x) === markKey(m))))
}

/**
 * A copy of `doc` with the occurrence replaced by `node` (other content untouched). The node
 * takes the marks the replaced text had in common (bold stays bold), minus link and code.
 */
export function replaceOccurrence(doc: JSONContent, occ: Occurrence, node: JSONContent): JSONContent | null {
  const next = structuredClone(doc)
  let at: JSONContent | undefined = next
  for (const i of occ.path) at = at?.content?.[i]
  const block = at
  const kids = block?.content
  if (!block || !kids) return null
  const { segs } = flatten(block)
  const covered = segs.filter((g) => g.end > occ.start && g.start < occ.end)
  const first = covered[0]
  const last = covered[covered.length - 1]
  if (!first || covered.some((g) => kids[g.index].type !== 'text')) return null
  const marks = sharedMarks(covered.map((g) => kids[g.index]))
  const placed: JSONContent = marks.length ? { ...node, marks } : node
  const out: JSONContent[] = []
  kids.forEach((n, i) => {
    if (i < first.index || i > last.index) {
      out.push(n)
      return
    }
    if (i === first.index) {
      const head = (n.text ?? '').slice(0, occ.start - first.start)
      if (head) out.push({ ...n, text: head })
      out.push(placed)
    }
    if (i === last.index) {
      const tail = (n.text ?? '').slice(occ.end - last.start)
      if (tail) out.push({ ...n, text: tail })
    }
  })
  block.content = out
  return next
}

export function pageMention(page: Page): JSONContent {
  return { type: 'mention', attrs: { id: page.id, label: page.title.trim(), kind: 'page' } }
}

/* ------------------------------------------------------------------ */
/* Selection                                                           */
/* ------------------------------------------------------------------ */

/** page object → matcher key → occurrence (page objects are immutable: a new object = new content) */
const cache = new WeakMap<Page, Map<string, Occurrence | null>>()

function occurrenceIn(p: Page, m: TitleMatcher): Occurrence | null {
  let byKey = cache.get(p)
  if (!byKey) {
    byKey = new Map()
    cache.set(p, byKey)
  }
  const hit = byKey.get(m.key)
  if (hit !== undefined) return hit
  const occ = p.plain && m.test.test(p.plain) ? findOccurrence(p.content, m) : null
  if (byKey.size > 12) byKey.clear()
  byKey.set(m.key, occ)
  return occ
}

export interface UnlinkedHit {
  page: Page
  occ: Occurrence
}

/**
 * Pages (database rows included) that mention `targetId`'s title in their text without linking it:
 * never the page itself, trashed pages or pages that already link to it. Most recently edited first.
 */
export function selectUnlinked(pages: Record<ID, Page>, targetId: ID, linked: ReadonlySet<ID>): UnlinkedHit[] {
  const target = pages[targetId]
  const m = target && titleMatcher(target.title)
  if (!m) return []
  // the last answer stands while no change can touch it (typing in the page itself, edits elsewhere)
  const hit = memo.get(targetId)
  if (hit && hit.key === m.key && hit.linked === linked && (hit.pages === pages || !mayChangeAnswer(pages, hit.pages, targetId, (p) => !!p.plain && !!occurrenceIn(p, m)))) {
    hit.pages = pages
    return hit.hits
  }
  const hits: UnlinkedHit[] = []
  // Object.keys: for…of Object.values() over thousands of pages costs several times more
  for (const id of Object.keys(pages)) {
    const p = pages[id]
    if (p.id === targetId || p.trashed || !p.plain || linked.has(p.id)) continue
    const occ = occurrenceIn(p, m)
    if (occ && !isEffectivelyTrashed(pages, p.id)) hits.push({ page: p, occ })
  }
  hits.sort((a, b) => b.page.updatedAt - a.page.updatedAt)
  memo.delete(targetId)
  memo.set(targetId, { pages, key: m.key, linked, hits })
  if (memo.size > 4) memo.delete(memo.keys().next().value!)
  return hits
}

/** The last few answers per target page (with the page map, title matcher and linked set they hold for). */
const memo = new Map<ID, { pages: Record<ID, Page>; key: string; linked: ReadonlySet<ID>; hits: UnlinkedHit[] }>()

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

export interface LinkResult {
  id: ID
  /** content before the write and the revision the write produced (for Undo) */
  prev: JSONContent | null
  rev: number
  /** the text the mention replaced, exactly as it was written ("zephyr protocol") — Undo writes it back */
  text?: string
}

/**
 * Turn the first unlinked occurrence of the target's title in each source page into a page
 * mention. Locked pages are skipped. Returns what was written.
 */
export function linkMentions(targetId: ID, sourceIds: ID[]): LinkResult[] {
  const ws = useWorkspace.getState()
  const target = ws.pages[targetId]
  const m = target && titleMatcher(target.title)
  if (!m) return []
  const done: LinkResult[] = []
  for (const id of sourceIds) {
    const p = useWorkspace.getState().pages[id]
    if (!p || p.trashed || p.settings.locked || !p.content) continue
    const occ = findOccurrence(p.content, m)
    const next = occ && replaceOccurrence(p.content, occ, pageMention(target))
    if (!next) continue
    ws.setContent(id, next, LINK_ORIGIN)
    done.push({ id, prev: p.content, rev: useWorkspace.getState().pages[id]?.contentRev ?? 0, text: occ.match })
  }
  return done
}

/**
 * Undo "Link": restore the previous content where nothing changed since; otherwise turn
 * the inserted mention back into plain text, leaving later edits alone.
 */
export function unlinkMentions(targetId: ID, results: LinkResult[]): void {
  const ws = useWorkspace.getState()
  for (const r of results) {
    const p = useWorkspace.getState().pages[r.id]
    if (!p) continue
    if (p.contentRev === r.rev) {
      ws.setContent(r.id, r.prev, LINK_ORIGIN)
      continue
    }
    const next = p.content && mentionToText(p.content, targetId, r.text)
    if (next) ws.setContent(r.id, next, LINK_ORIGIN)
  }
}

/** First page mention of `targetId` → the original text (else its label), with the mention's marks. */
function mentionToText(doc: JSONContent, targetId: ID, original?: string): JSONContent | null {
  const next = structuredClone(doc)
  let done = false
  const walk = (n: JSONContent) => {
    if (done || !n.content) return
    const i = n.content.findIndex((c) => c.type === 'mention' && c.attrs?.kind === 'page' && c.attrs?.id === targetId)
    if (i >= 0) {
      const mention = n.content[i]
      const text = original || String(mention.attrs?.label ?? '')
      const node: JSONContent = mention.marks?.length ? { type: 'text', text, marks: mention.marks } : { type: 'text', text }
      n.content.splice(i, 1, ...(text ? [node] : []))
      n.content = mergeText(n.content)
      done = true
      return
    }
    n.content.forEach(walk)
  }
  walk(next)
  return done ? next : null
}

/** Join adjacent text nodes with identical marks. */
function mergeText(nodes: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = []
  for (const n of nodes) {
    const prev = out[out.length - 1]
    if (prev?.type === 'text' && n.type === 'text' && JSON.stringify(prev.marks ?? []) === JSON.stringify(n.marks ?? [])) {
      out[out.length - 1] = { ...prev, text: `${prev.text ?? ''}${n.text ?? ''}` }
    } else out.push(n)
  }
  return out
}
