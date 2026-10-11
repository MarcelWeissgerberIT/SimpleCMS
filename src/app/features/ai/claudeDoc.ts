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
 *  4. (the settle gate for `> [!TODO]` quotes — with a settle context only; none is passed yet)
 *  5. `one:` links → mentions (features/io/import/mentions.ts `mentionsFromLinks`): without a settle context a
 *     person link is "@Name" text (no ping) and a date link a date mention without reminder;
 *  6. sanitize (schema repair, tasks out of tasks / tables).
 */
import type { JSONContent } from '@tiptap/core'
import { markdownToDoc, sanitize } from '../../editor'
import { withoutWebImages, withoutWebLoads } from '../agents/images'
import { mentionsFromLinks } from '../io/import/mentions'

/** Claude's Markdown as a document — and what settling it did (null: no settle context). */
export function claudeSettled(markdown: string, keep?: ReadonlySet<string>, ctx?: undefined): { doc: JSONContent; report: null } {
  void ctx
  const doc = withoutWebLoads(markdownToDoc(withoutWebImages(markdown, keep)), keep)
  const linked = mentionsFromLinks(doc, null).doc
  return { doc: sanitize(linked), report: null }
}

export function claudeDoc(markdown: string, keep?: ReadonlySet<string>): JSONContent {
  return claudeSettled(markdown, keep).doc
}

/** The blocks of `claudeDoc` (empty ones left out). */
export const claudeBlocks = (markdown: string, keep?: ReadonlySet<string>): JSONContent[] => (claudeDoc(markdown, keep).content ?? []).filter(Boolean)
