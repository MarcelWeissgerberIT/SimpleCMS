/**
 * Claude's Markdown → a document for the page, safe to show: no web image, video, audio, file or frame
 * loads by itself (they become links; addresses in `keep` — what the page shows already — stay), no
 * workspace block is smuggled in through raw HTML. Every path that writes or shows Claude's Markdown in a
 * page goes through here (agents/images.ts has the rules).
 */
import type { JSONContent } from '@tiptap/core'
import { markdownToDoc } from '../../editor'
import { withoutWebImages, withoutWebLoads } from '../agents/images'

export function claudeDoc(markdown: string, keep?: ReadonlySet<string>): JSONContent {
  return withoutWebLoads(markdownToDoc(withoutWebImages(markdown, keep)), keep)
}

/** The blocks of `claudeDoc` (empty ones left out). */
export const claudeBlocks = (markdown: string, keep?: ReadonlySet<string>): JSONContent[] => (claudeDoc(markdown, keep).content ?? []).filter(Boolean)
