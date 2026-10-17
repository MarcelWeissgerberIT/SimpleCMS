/**
 * Work orders — a chain step's own blocks (spec §2.9 "The step page"), pure (TipTap JSON; a Node spec reads it). What
 * startChain writes into every step it creates, around the goal and criteria the plan holds (coding/tasks.ts taskBody:
 * `lead` · goal · criteria · `extra`):
 *
 *  1. steps ≥ 2 of a chain: the SLOT — a plain line "Waits for step 01" (no mention). Its id is the step's `basisBlock`:
 *     the chain engine replaces it with the Grundlage when the step before is done (orders/basis.ts placeBasis).
 *  2. every step: "Request (PA-12)" — a quote holding the request's text verbatim as PLAIN text: a page mention, a link
 *     to a page or a pasted One address becomes "@Title" text, never a node or a link — so the request's own pages never
 *     go along to Claude Code with the step (coding/refs.ts reads none of it), and the row's later writes (its Status …)
 *     never change a step's version. ≤ 4 000 characters, a cut is noted.
 *  3. the chain's first step, when a server took part in the plan: a callout "Context from the MCP server ‹name›
 *     (outside)" with the planner's summary of what the server returned and its links (absolute http(s) only — the plan
 *     reader kept no others).
 *  4. after the criteria: the step's refs as page mentions (≤ 8) — the ONLY pages that go along (coding/refs.ts).
 *
 * The step's own blocks (slot, quote, callout) carry ids derived from the task's id — never copied on into the next
 * step's Grundlage (the record's `own`). The caller gives every other block an id too (editor/convert.ts withBlockIds),
 * so opening a step page writes nothing (an editor fills in missing block ids and writes them once).
 */
import type { JSONContent } from '@tiptap/core'
import type { ID } from '../../../store/types'
import { ORDER_LIMITS } from './types'

/** The words a step page holds — in the person's language (the app: i18n; a Node spec: makeTranslator). */
export interface StepPageWords {
  /** "Waits for step 01" */
  waits: (n: number) => string
  /** "Request (PA-12)" */
  request: (code: string) => string
  /** "Cut: 4,000 of 5,210 characters of the request" */
  requestCut: (shown: number, total: number) => string
  /** "Context from the MCP server ‹kb› (outside)" */
  context: (server: string) => string
  /** "Pages that go along:" */
  refs: string
}

export interface StepPageInput {
  /** the step's task id (minted before it is created) — the own blocks' ids derive from it */
  taskId: ID
  /** the chain's step before this one (null: the first step of this chain — no slot) */
  after: number | null
  /** the request's id as people read it ("PA-12") */
  code: string
  /** the request's blocks — what Claude may read of the row (context marks) */
  request: readonly JSONContent[]
  /** the planner's summary of the server's part (first step only; null: none) */
  context: { server: string; note: string; links: readonly string[] } | null
  /** the pages the step takes along (its plan's refs, live, ≤ 8) — `label` '' for a page whose title stays out */
  refs: ReadonlyArray<{ id: ID; label: string }>
  /** a page's title for a reference that becomes text */
  titleOf: (id: ID) => string
  words: StepPageWords
  /** the request quote's limit (default ORDER_LIMITS.quoteChars) */
  max?: number
}

export interface StepPage {
  /** before the goal: the slot (steps ≥ 2), the request quote, the context callout (first step + server) */
  lead: JSONContent[]
  /** after the criteria: the pages that go along */
  extra: JSONContent[]
  /** the ids of the step's own blocks (never copied into the next step's Grundlage) */
  own: string[]
  /** the slot's id (null: the chain's first step) */
  basisBlock: string | null
  /** characters of the request quoted, of the request in all */
  quoted: number
  total: number
}

/** The ids of a step's own blocks. */
export const stepBlockIds = (taskId: ID) => ({ slot: `${taskId}-wait`, request: `${taskId}-req`, context: `${taskId}-ctx`, refs: `${taskId}-refs` })

/** a One address in text, with the site in front of it when there is one */
const ADDRESS = /(?:https?:\/\/[^\s#<>()[\]"']*)?#\/p\/([A-Za-z0-9_-]{4,64})/g
const INLINE = new Set(['text', 'hardBreak', 'mention', 'inlineMath', 'icon'])
const ABSOLUTE = /^https?:\/\/\S+$/i

const isNode = (n: unknown): n is JSONContent => !!n && typeof n === 'object' && !Array.isArray(n)
const text = (t: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text: t, ...(marks?.length ? { marks } : {}) })

/**
 * A node's text as the request quote holds it: page mentions and One addresses as "@Title", a person "@Name", a date its
 * label, math its source; blocks on their own lines.
 */
export function requestPlain(n: JSONContent, titleOf: (id: ID) => string): string {
  if (n.type === 'text') {
    const raw = n.text ?? ''
    return raw.includes('#/p/') ? raw.replace(ADDRESS, (_all, id: string) => `@${titleOf(id)}`) : raw
  }
  if (n.type === 'hardBreak') return '\n'
  if (n.type === 'mention') {
    const label = typeof n.attrs?.label === 'string' ? n.attrs.label.trim() : ''
    if (n.attrs?.kind === 'page') return `@${label || titleOf(String(n.attrs?.id ?? ''))}`
    if (n.attrs?.kind === 'person') return label ? `@${label}` : ''
    return label
  }
  if (n.type === 'inlineMath') return typeof n.attrs?.latex === 'string' ? n.attrs.latex : ''
  const kids = (n.content ?? []).filter(isNode)
  const inline = kids.length > 0 && kids.every((k) => INLINE.has(k.type ?? ''))
  return kids.map((k) => requestPlain(k, titleOf)).join(inline ? '' : '\n')
}

/** The quote's paragraphs: one per line, runs of empty lines kept as one. */
function paragraphs(body: string): JSONContent[] {
  const out: JSONContent[] = []
  let empty = false
  for (const line of body.split('\n')) {
    const t = line.replace(/\s+$/, '')
    if (!t.trim()) {
      if (!empty && out.length) out.push({ type: 'paragraph' })
      empty = true
      continue
    }
    empty = false
    out.push({ type: 'paragraph', content: [text(t)] })
  }
  while (out.length && !out[out.length - 1]!.content) out.pop()
  return out
}

/** A step's own blocks (see the head of this file). */
export function stepPage(input: StepPageInput): StepPage {
  const ids = stepBlockIds(input.taskId)
  const max = input.max ?? ORDER_LIMITS.quoteChars
  const lead: JSONContent[] = []
  const own: string[] = []

  // 1. the slot the Grundlage replaces
  if (input.after !== null) {
    lead.push({ type: 'paragraph', attrs: { id: ids.slot }, content: [text(input.words.waits(input.after))] })
    own.push(ids.slot)
  }

  // 2. the request, verbatim, as plain text
  const full = input.request.filter(isNode).map((b) => requestPlain(b, input.titleOf)).join('\n').replace(/\n{3,}/g, '\n\n').trim()
  const cut = full.length > max
  const body = cut ? full.slice(0, max) : full
  const quote: JSONContent[] = [{ type: 'paragraph', content: [text(input.words.request(input.code), [{ type: 'bold' }])] }, ...paragraphs(body)]
  if (cut) quote.push({ type: 'paragraph', content: [text(input.words.requestCut(body.length, full.length), [{ type: 'italic' }])] })
  lead.push({ type: 'blockquote', attrs: { id: ids.request }, content: quote })
  own.push(ids.request)

  // 3. the server's part (the chain's first step only)
  if (input.context && input.after === null) {
    const note = input.context.note.replace(ADDRESS, (_all, id: string) => `@${input.titleOf(id)}`)
    const links = input.context.links.filter((l) => ABSOLUTE.test(l) && !l.includes('#/p/'))
    const content: JSONContent[] = [{ type: 'paragraph', content: [text(input.words.context(input.context.server), [{ type: 'bold' }])] }, ...paragraphs(note)]
    if (links.length) content.push({ type: 'bulletList', content: links.map((href) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [text(href, [{ type: 'link', attrs: { href } }])] }] })) })
    lead.push({ type: 'callout', attrs: { id: ids.context, icon: 'asset:search', color: 'orange' }, content })
    own.push(ids.context)
  }

  // 4. the pages that go along
  const extra: JSONContent[] = []
  const refs = input.refs.slice(0, 8)
  if (refs.length) {
    const inline: JSONContent[] = [text(`${input.words.refs} `)]
    refs.forEach((r, i) => {
      if (i) inline.push(text(' · '))
      inline.push({ type: 'mention', attrs: { id: r.id, label: r.label, kind: 'page' } })
    })
    extra.push({ type: 'paragraph', attrs: { id: ids.refs }, content: inline })
  }
  return { lead, extra, own, basisBlock: input.after !== null ? ids.slot : null, quoted: body.length, total: full.length }
}
