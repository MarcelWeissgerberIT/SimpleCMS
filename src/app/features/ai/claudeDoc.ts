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

/**
 * The date / person mentions a document holds (what a write replaces): dates with their reminder; people per block
 * (`<block id>|<person id>` → how many — the inbox keys @mentions by the nearest block id, '' for none: only a mention
 * under the same key pings nobody new). Iterative.
 */
function mentionsOf(doc: JSONContent | null | undefined): { dates: Set<string>; people: Map<string, number> } {
  const dates = new Set<string>()
  const people = new Map<string, number>()
  const stack: Array<[JSONContent, string | null]> = doc ? [[doc, null]] : []
  while (stack.length) {
    const [n, outer] = stack.pop()!
    const block = typeof n.attrs?.id === 'string' && n.attrs.id && n.type !== 'mention' ? n.attrs.id : outer
    if (n.type === 'mention') {
      const a = n.attrs ?? {}
      if (a.kind === 'date' && typeof a.id === 'string' && typeof a.reminder === 'string' && a.reminder) dates.add(`${a.id}|${a.reminder}`)
      if (a.kind === 'person' && typeof a.id === 'string') people.set(`${block ?? ''}|${a.id}`, (people.get(`${block ?? ''}|${a.id}`) ?? 0) + 1)
    }
    if (Array.isArray(n.content)) for (const c of n.content) if (c && typeof c === 'object') stack.push([c, block])
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
    // a mention under a key the replaced content held (the same block id — or none on both sides, as the inbox keys it)
    // with that person: no new ping — once per known one
    knownPerson: (id, block) => {
      const key = `${block ?? ''}|${id}`
      const left = known.people.get(key) ?? 0
      if (left > 0) known.people.set(key, left - 1)
      return left > 0
    },
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
