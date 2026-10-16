/**
 * A coding text field that points at pages (coding/RefField.tsx): the person's text with the pages they picked with
 * "@" / "one:". The field shows a pick as "@Title"; what is sent (the answer, the rework note, the new task's goal)
 * holds it as a One address the refs code reads — `[@Title](#/p/<id>)` (coding/refs.ts idsInText; a new task's page
 * turns it into a page mention, tasks.ts taskBody). Pure: no store, no DOM.
 */
import type { ID } from '../../store/types'

/** A page picked into the text: its label "@Title" sits at `at`. */
export interface Pick {
  id: ID
  at: number
  label: string
}

export interface RefDraft {
  text: string
  picks: Pick[]
}

export const EMPTY_DRAFT: RefDraft = { text: '', picks: [] }

export const draftOf = (text: string): RefDraft => ({ text, picks: [] })

/** The picks still standing as they were picked (their label unchanged where it sits), in order. */
export function livePicks(d: RefDraft): Pick[] {
  return d.picks.filter((p) => d.text.slice(p.at, p.at + p.label.length) === p.label).sort((a, b) => a.at - b.at)
}

/** Replace [from, to) with `insert`: picks before stay, picks after move, picks it touches become plain text. */
export function splice(d: RefDraft, from: number, to: number, insert: string): RefDraft {
  const shift = insert.length - (to - from)
  const picks = d.picks.flatMap((p) => (p.at + p.label.length <= from ? [p] : p.at >= to ? [{ ...p, at: p.at + shift }] : []))
  return { text: d.text.slice(0, from) + insert + d.text.slice(to), picks }
}

/**
 * The draft after the field's text changed by typing, pasting, cutting (the browser says only the new text): the
 * changed range is what lies between the common start and the common end — a pick it touches is plain text from then on.
 */
export function retext(d: RefDraft, next: string): RefDraft {
  const prev = d.text
  if (prev === next) return d
  let start = 0
  const max = Math.min(prev.length, next.length)
  while (start < max && prev[start] === next[start]) start++
  let endPrev = prev.length
  let endNext = next.length
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--
    endNext--
  }
  return splice(d, start, endPrev, next.slice(start, endNext))
}

/** Put a page in for [from, to) (the typed "@que" / "one:que", or the caret): "@Title" and a space after it. */
export function insertPick(d: RefDraft, from: number, to: number, page: { id: ID; title: string }): { draft: RefDraft; caret: number } {
  const label = `@${page.title}`
  const next = d.text.slice(to)
  const before = d.text.slice(0, from)
  // a pick glued to the word before it would read as one word: a space in front where there is none
  const lead = from > 0 && !/\s$/.test(before) ? ' ' : ''
  const trail = /^\s/.test(next) ? '' : ' '
  const out = splice(d, from, to, `${lead}${label}${trail}`)
  const at = from + lead.length
  return { draft: { ...out, picks: [...out.picks, { id: page.id, at, label }].sort((a, b) => a.at - b.at) }, caret: at + label.length + trail.length }
}

/** The pick whose label ends at `caret` (Backspace there takes the whole reference). */
export const pickEndingAt = (d: RefDraft, caret: number): Pick | null => livePicks(d).find((p) => p.at + p.label.length === caret) ?? null

/** Markdown link text: brackets and backslashes escaped. */
const esc = (s: string) => s.replace(/[\\[\]]/g, (c) => `\\${c}`)

/** What is sent: the text with every pick as `[@Title](#/p/<id>)`. */
export function draftText(d: RefDraft): string {
  let out = ''
  let at = 0
  for (const p of livePicks(d)) {
    out += `${d.text.slice(at, p.at)}[@${esc(p.label.slice(1))}](#/p/${p.id})`
    at = p.at + p.label.length
  }
  return out + d.text.slice(at)
}

/** What the field's "@" or "one:" at the caret is searching for (null: no menu). */
export interface Trigger {
  kind: '@' | 'one:'
  /** the token's range in the text ("@que" / "one:que") */
  from: number
  to: number
  query: string
}

export function triggerAt(d: RefDraft, caret: number): Trigger | null {
  const before = d.text.slice(0, caret)
  let t: Trigger | null = null
  const one = /(^|\s)one:([^\n]{0,40})$/i.exec(before)
  const at = one ? null : /(^|\s)@([^\n@]{0,40})$/.exec(before)
  if (one) {
    const query = one[2]!
    // a word and a space after it: the person typed on
    if (/\s$/.test(query) && query.trim()) return null
    t = { kind: 'one:', from: caret - query.length - 4, to: caret, query }
  } else if (at) {
    const query = at[2]!
    // a space after a completed word ends it ("@" then a space stays text)
    if (/\s$/.test(query)) return null
    t = { kind: '@', from: caret - query.length - 1, to: caret, query }
  }
  // never inside a page picked already
  if (t && d.picks.some((p) => t!.from >= p.at && t!.from < p.at + p.label.length)) return null
  return t
}
