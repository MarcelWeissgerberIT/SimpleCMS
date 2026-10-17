/**
 * Work orders — the Grundlage ("basis"): what a chain step takes along from the step before it (spec §2.10, the move),
 * pure (TipTap JSON in, TipTap JSON out; the sink writes it with setContent under the order writer `#a<n>`).
 *
 *  - A COPY of step n's page as it is now, never a mention: step n+1's version never follows step n's later writes.
 *  - ONE callout whose block id is step n+1's slot (`OrderChainStep.basisBlock`): it REPLACES the slot ("Waits for step
 *    01") — and on a second advance its own earlier copy — wherever it stands; never appended (idempotent). A slot the
 *    person deleted comes back at the top. Inside: a heading "From step 01 (analysis): ‹title›", then the copy.
 *  - Never copied on: step n's own chain blocks (its slot / Grundlage, its "Auftrag" quote, its "Kontext" callout — the
 *    record's ids), tasks (unwrapped to their text, `unwrapItemsIn` — never a second task with the same id), synced
 *    blocks and meeting notes (their content only — never a second original), a table of contents, a breadcrumb, a
 *    button, an inline database (its title as text), comment marks.
 *  - Pages: only the pages step n+1 was confirmed with (`keep`) stay references; every other page reference (a mention,
 *    a page link, a `#/p/<id>` link or a pasted One address) becomes its title as text — so the copy never sends Claude
 *    Code a page nobody confirmed.
 *  - ≤ 20 000 characters of text (ORDER_LIMITS.basisChars); a cut is noted below the copy.
 *  - A skipped step n gives the line "Step 02 skipped — no basis" instead; the slot a step page starts with is
 *    `slotBlock` (both with the slot's id).
 */
import type { JSONContent } from '@tiptap/core'
import { unwrapItemsIn } from '../../../editor/workitem/turn'
import { ORDER_LIMITS } from './types'

/** a One address in a link: `#/p/<id>` */
const LINK = /#\/p\/([A-Za-z0-9_-]{4,64})/
/** a One address in plain text, with the site in front of it when there is one */
const ADDRESS = /(?:https?:\/\/[^\s#]*)?#\/p\/([A-Za-z0-9_-]{4,64})/g
const INLINE = new Set(['text', 'hardBreak', 'mention', 'inlineMath', 'icon'])
/** blocks a copy never takes (they would act on the page they sit in, or show it) */
const DROPPED = new Set(['toc', 'breadcrumb', 'button'])
/** containers whose content is taken without them (never a second original) */
const UNWRAPPED = new Set(['syncedBlock', 'meetingNotes'])
/** the Grundlage callout's look */
const ICON = 'asset:history'

export interface BasisInput {
  /** the slot's block id (step n+1's `basisBlock`) — the callout's id */
  id: string
  /** "From step 01 (analysis): ‹title›" — in the person's language */
  heading: string
  /** step n's page content (its top-level blocks) */
  content: readonly JSONContent[]
  /** step n's own chain blocks, never copied (its basisBlock + `own`) */
  drop: ReadonlySet<string>
  /** the pages step n+1 was confirmed with: references to them stay references */
  keep: ReadonlySet<string>
  /** a page's title for a reference that becomes text (a mention without a label, a page link, an address) */
  titleOf: (pageId: string) => string
  /** the note under a cut copy ("… cut: 20,000 of 31,204 characters") */
  cutNote: (shown: number, total: number) => string
  /** the limit (default ORDER_LIMITS.basisChars) */
  max?: number
}

export interface Basis {
  /** the callout that replaces the slot */
  block: JSONContent
  /** characters of text copied, and of step n's page in all */
  chars: number
  total: number
  cut: boolean
}

const isNode = (n: unknown): n is JSONContent => !!n && typeof n === 'object' && !Array.isArray(n)
const idOf = (n: JSONContent): string | null => (typeof n.attrs?.id === 'string' ? n.attrs.id : null)
const text = (t: string): JSONContent => ({ type: 'text', text: t })

/** The plain text of a node (blocks on their own lines). */
export function basisText(n: JSONContent): string {
  if (n.type === 'text') return n.text ?? ''
  if (n.type === 'hardBreak') return '\n'
  if (n.type === 'mention') return typeof n.attrs?.label === 'string' ? `@${n.attrs.label}` : ''
  const kids = (n.content ?? []).filter(isNode)
  const inline = kids.length > 0 && kids.every((k) => INLINE.has(k.type ?? ''))
  return kids.map(basisText).join(inline ? '' : '\n')
}

/** Copies step n's blocks for step n+1 (see the head of this file). */
function copier(input: BasisInput) {
  let made = 0
  const mint = () => `${input.id}-c${++made}`
  const label = (id: string, own?: unknown) => `@${(typeof own === 'string' && own.trim()) || input.titleOf(id)}`
  const para = (t: string): JSONContent => ({ type: 'paragraph', attrs: { id: mint() }, ...(t ? { content: [text(t)] } : {}) })

  /** a text node: One addresses to pages not kept become their titles; their links, `one:` links and comments go */
  const inlineText = (n: JSONContent): JSONContent[] => {
    const marks = (n.marks ?? []).filter((m) => {
      if (m.type === 'comment') return false
      if (m.type !== 'link') return true
      const href = typeof m.attrs?.href === 'string' ? m.attrs.href : ''
      if (href.startsWith('one:')) return false
      const id = LINK.exec(href)?.[1]
      return !id || input.keep.has(id)
    })
    const raw = n.text ?? ''
    const t = raw.includes('#/p/') ? raw.replace(ADDRESS, (all, id: string) => (input.keep.has(id) ? all : label(id))) : raw
    if (!t) return []
    const { marks: _marks, ...rest } = n
    return [{ ...rest, text: t, ...(marks.length ? { marks } : {}) }]
  }

  const inline = (n: JSONContent): JSONContent[] => {
    if (n.type === 'text') return inlineText(n)
    if (n.type === 'mention' && n.attrs?.kind === 'page') {
      const id = String(n.attrs?.id ?? '')
      return input.keep.has(id) ? [n] : [text(label(id, n.attrs?.label))]
    }
    return [n]
  }

  const block = (n: JSONContent): JSONContent[] => {
    const id = idOf(n)
    if (id && input.drop.has(id)) return []
    const type = n.type ?? ''
    if (DROPPED.has(type)) return []
    if (UNWRAPPED.has(type)) return blocks((n.content ?? []).filter(isNode))
    if (type === 'pageLink') {
      const page = String(n.attrs?.pageId ?? '')
      return input.keep.has(page) ? [n] : [para(label(page))]
    }
    if (type === 'databaseBlock') return [para(label(String(n.attrs?.databaseId ?? '')))]
    // the copy sits under its own heading: the page's top headings one level down
    const lifted = type === 'heading' && Number(n.attrs?.level ?? 1) < 3 ? { ...n, attrs: { ...n.attrs, level: 3 } } : n
    if (!Array.isArray(lifted.content)) return [lifted]
    const kids = lifted.content.filter(isNode)
    const isInline = kids.length > 0 && kids.every((k) => INLINE.has(k.type ?? ''))
    if (isInline || type === 'paragraph' || type === 'heading' || type === 'codeBlock' || type === 'detailsSummary') return [{ ...lifted, content: kids.flatMap(inline) }]
    const out = blocks(kids)
    // a container never ends up empty (its schema needs a block)
    return [{ ...lifted, content: out.length ? out : [{ type: 'paragraph' }] }]
  }

  const blocks = (list: readonly JSONContent[]): JSONContent[] => list.flatMap(block)
  return { blocks, para }
}

/** The Grundlage for step n+1 from step n's page (see the head of this file). */
export function basisBlock(input: BasisInput): Basis {
  const max = input.max ?? ORDER_LIMITS.basisChars
  const { blocks, para } = copier(input)
  const copied = blocks(unwrapItemsIn(input.content.filter(isNode)))
  const lengths = copied.map((b) => basisText(b).length)
  const total = lengths.reduce((a, b) => a + b, 0)
  const kept: JSONContent[] = []
  let left = max
  let cut = false
  for (let i = 0; i < copied.length; i++) {
    const len = lengths[i]!
    if (len <= left) {
      kept.push(copied[i]!)
      left -= len
      continue
    }
    // the block that crosses the limit: as much of its text as fits, as a paragraph; nothing after it
    if (left > 0) kept.push(para(basisText(copied[i]!).slice(0, left)))
    left = 0
    cut = true
    break
  }
  const chars = max - left
  const content: JSONContent[] = [{ type: 'heading', attrs: { id: `${input.id}-h`, level: 2 }, content: [text(input.heading)] }, ...kept]
  if (cut) content.push({ type: 'paragraph', attrs: { id: `${input.id}-cut` }, content: [{ type: 'text', text: input.cutNote(chars, total), marks: [{ type: 'italic' }] }] })
  return { block: { type: 'callout', attrs: { id: input.id, icon: ICON, color: 'gray' }, content }, chars, total, cut }
}

/** The line a step gets when the step before it was skipped ("Step 02 skipped — no basis"), in the slot's place. */
export function skippedBlock(id: string, line: string): JSONContent {
  return { type: 'callout', attrs: { id, icon: ICON, color: 'gray' }, content: [{ type: 'paragraph', attrs: { id: `${id}-h` }, content: [text(line)] }] }
}

/** The slot a step page (step ≥ 2) starts with: a plain line ("Waits for step 01") — no mention. */
export function slotBlock(id: string, line: string): JSONContent {
  return { type: 'paragraph', attrs: { id }, content: [text(line)] }
}

/**
 * The page with the block `id` (the slot, or an earlier Grundlage) replaced by `block` wherever it stands; a page
 * without it gets `block` at the top. Pure: a new doc, the rest as it was.
 */
export function placeBasis(doc: JSONContent, id: string, block: JSONContent): JSONContent {
  let found = false
  const walk = (list: readonly JSONContent[]): JSONContent[] => {
    let changed = false
    const out: JSONContent[] = []
    for (const n of list) {
      if (!isNode(n)) {
        out.push(n)
        continue
      }
      if (!found && idOf(n) === id && !INLINE.has(n.type ?? '')) {
        found = true
        changed = true
        out.push(block)
        continue
      }
      if (Array.isArray(n.content) && !found) {
        const kids = walk(n.content)
        if (kids !== n.content) {
          changed = true
          out.push({ ...n, content: kids })
          continue
        }
      }
      out.push(n)
    }
    return changed ? out : (list as JSONContent[])
  }
  const content = walk((doc.content ?? []).filter(isNode))
  return { ...doc, type: doc.type ?? 'doc', content: found ? content : [block, ...(doc.content ?? [])] }
}
