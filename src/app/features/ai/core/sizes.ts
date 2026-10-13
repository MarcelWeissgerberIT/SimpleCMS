/**
 * What a request counts as in an estimate where its text is not all text (pure — the Node specs load it): a picture as its
 * pixels, a PDF as its pages, and a loop's conversation as its JSON with both of them counted so — never the base64 they
 * travel as (core/meter.ts re-exports these; agent/run.ts sizes a loop's requests with messagesChars).
 */

/** characters per token in every estimate (features/governor estimate.ts) */
const CHARS_PER_TOKEN = 4

/** Prompt characters a picture counts as in an estimate (Claude: about width × height ÷ 750 tokens). */
export const imageChars = (width: number, height: number): number => Math.ceil((Math.max(1, width) * Math.max(1, height)) / 750) * CHARS_PER_TOKEN

/** Prompt characters a PDF counts as in an estimate: the text and a picture of every page (about 3,000 tokens each). */
export const pdfChars = (pages: number): number => Math.max(1, Math.round(pages)) * 3000 * CHARS_PER_TOKEN

/** A picture in a conversation: at most 1568 px a side (image/load.ts) — its size when nothing else is known. */
const IMAGE_BOUND = imageChars(1568, 1568)

/** PDF page counts of the document blocks this tab built (file/terminal.ts) — read by messagesChars, never decoded. */
const pdfPages = new WeakMap<object, number>()

/** The page count of a PDF document block (a loop's size counts its pages, not its base64). */
export function notePdfPages(block: object, pages: number | null | undefined): void {
  if (typeof pages === 'number' && pages > 0) pdfPages.set(block, pages)
}

/**
 * Prompt characters a conversation counts as in an estimate (a loop's requests — agent/run.ts: the first, H's, a cut
 * one): its JSON, but a picture as its pixels (imageChars, at most 1568 px a side) and a PDF as its pages (pdfChars; pages
 * not known: about one per 60 KB) — never the base64 they travel as.
 */
export function messagesChars(messages: readonly unknown[]): number {
  let media = 0
  const json = JSON.stringify(messages, function (this: unknown, key: string, value: unknown) {
    if (key !== 'source' || !value || typeof value !== 'object' || (value as { type?: unknown }).type !== 'base64') return value
    const block = this as Record<string, unknown>
    const data = (value as { data?: unknown }).data
    const bytes = typeof data === 'string' ? (data.length * 3) / 4 : 0
    media += block.type === 'document' ? pdfChars(pdfPages.get(block) ?? Math.ceil(bytes / 60_000)) : IMAGE_BOUND
    return { type: 'base64' }
  })
  return json.length + media
}
