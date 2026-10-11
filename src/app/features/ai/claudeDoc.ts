/**
 * Claude's Markdown → a document for the page, safe to show: no web image, video, audio, file or frame
 * loads by itself (they become links; addresses in `keep` — what the page shows already — stay), no
 * workspace block is smuggled in through raw HTML. Every path that writes or shows Claude's Markdown in a
 * page goes through here (agents/images.ts has the rules).
 *
 * The steps, in this order:
 *  1. web images → links (the Markdown string);
 *  2. markdownToDoc — the global task reader is off: `> [!TODO]` stays a quote, `one:` links stay link marks;
 *  3. withoutWebLoads — what raw HTML made: media, frames, task blocks and person / date mention nodes (text);
 *  4. with a settle context only: the task gate (features/workitems settleDoc — tasks from `> [!TODO]` quotes, known
 *     tasks back by id; it reads the field lines' `one:` links, so it runs before step 5). No context → no new task;
 *  5. `one:` links → mentions (features/io/import/mentions.ts `mentionsFromLinks`): with a context a person link to an
 *     existing person becomes a mention (counted: hold 'names'); without one it is "@Name" text (no ping); a date link
 *     a date mention, its reminder only when the replaced content had that date with that code;
 *  6. sanitize (schema repair, tasks out of tasks / tables).
 * A strict context's refusal (features/workitems SettleRefusal) is thrown to the caller (a tool loop at staging).
 */
import type { JSONContent } from '@tiptap/core'
import { markdownToDoc, sanitize } from '../../editor'
import { withoutWebImages, withoutWebLoads } from '../agents/images'
import { mentionsFromLinks, type MentionRules } from '../io/import/mentions'
import { settleDoc, type SettleContext, type SettleReport, type SettleWorld } from '../workitems/settle'
import { settleWorld } from '../workitems/world'

/** The date / person mentions a document holds (what a write replaces). Iterative. */
function mentionsOf(doc: JSONContent | null | undefined): { dates: Set<string>; people: Set<string> } {
  const dates = new Set<string>()
  const people = new Set<string>()
  const stack: JSONContent[] = doc ? [doc] : []
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === 'mention') {
      const a = n.attrs ?? {}
      if (a.kind === 'date' && typeof a.id === 'string' && typeof a.reminder === 'string' && a.reminder) dates.add(`${a.id}|${a.reminder}`)
      if (a.kind === 'person' && typeof a.id === 'string') people.add(a.id)
    }
    if (Array.isArray(n.content)) for (const c of n.content) if (c && typeof c === 'object') stack.push(c)
  }
  return { dates, people }
}

/** The `one:` link rules of a settle context: existing people by id (the store's name), reminders only when known. */
function rulesOf(ctx: SettleContext, world: SettleWorld): MentionRules {
  const known = mentionsOf(ctx.known)
  let names: Map<string, string> | null = null
  return {
    person: (id) => (names ??= new Map(world.people().map((p) => [p.id, p.name]))).get(id) ?? null,
    knownDate: (iso, code) => known.dates.has(`${iso}|${code}`),
    knownPerson: (id) => known.people.has(id),
  }
}

/** Claude's Markdown as a document — and what settling it did (null: no settle context). */
export function claudeSettled(markdown: string, keep?: ReadonlySet<string>, ctx?: undefined): { doc: JSONContent; report: null }
export function claudeSettled(markdown: string, keep: ReadonlySet<string> | undefined, ctx: SettleContext): { doc: JSONContent; report: SettleReport }
export function claudeSettled(markdown: string, keep?: ReadonlySet<string>, ctx?: SettleContext): { doc: JSONContent; report: SettleReport | null }
export function claudeSettled(markdown: string, keep?: ReadonlySet<string>, ctx?: SettleContext): { doc: JSONContent; report: SettleReport | null } {
  let doc = withoutWebLoads(markdownToDoc(withoutWebImages(markdown, keep)), keep)
  if (!ctx) return { doc: sanitize(mentionsFromLinks(doc, null).doc), report: null }
  // ONE world per call: its memos (titles, readable tasks per page) live for this call only
  const world = settleWorld()
  const settled = settleDoc(doc, ctx, world)
  const linked = mentionsFromLinks(settled.doc, rulesOf(ctx, world))
  const report = settled.report
  report.mentionsAdded += linked.mentionsAdded
  if (linked.datesDropped) report.warnings.push({ code: 'dateReminder', task: '' })
  doc = sanitize(linked.doc)
  return { doc, report }
}

export function claudeDoc(markdown: string, keep?: ReadonlySet<string>, ctx?: SettleContext): JSONContent {
  return claudeSettled(markdown, keep, ctx).doc
}

/** The blocks of `claudeDoc` (empty ones left out). */
export const claudeBlocks = (markdown: string, keep?: ReadonlySet<string>, ctx?: SettleContext): JSONContent[] => (claudeDoc(markdown, keep, ctx).content ?? []).filter(Boolean)
