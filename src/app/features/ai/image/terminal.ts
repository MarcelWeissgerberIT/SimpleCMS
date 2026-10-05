/**
 * Claude for images in the AI terminal: ⌘⇧J on a selected image block adds an image reference chip
 * ("▣ Protokoll P1 · image 1.2 MB"); the next task sends the picture as an image block in its user
 * message (sized like the AI menu's: ≤ 1568 px, ≤ 5 MB). An image that cannot be loaded (a web image
 * without CORS …) is left out with a note — the task still runs.
 */
import type { Editor } from '@tiptap/core'
import type { BetaContentBlockParam, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { newId } from '../../../lib/ids'
import type { TermRef } from '../agent/types'
import { loadImageForClaude } from './load'
import { AIError } from '../client'
import type { ID } from '../../../store/types'

/** The image a range holds when it holds nothing else (a node-selected image block), else null. */
export function imageOnlyIn(editor: Editor, from: number, to: number): { src: string; alt: string; caption: string } | null {
  const { doc } = editor.state
  let hit: { src: string; alt: string; caption: string } | null = null
  let count = 0
  doc.nodesBetween(from, to, (node) => {
    if (node.type.name !== 'image') return true
    count++
    const src = typeof node.attrs.src === 'string' ? node.attrs.src.trim() : ''
    if (src) hit = { src, alt: String(node.attrs.alt ?? ''), caption: String(node.attrs.caption ?? '') }
    return false
  })
  if (count !== 1 || !hit || doc.textBetween(from, to, ' ', '').trim()) return null
  return hit
}

/** The reference of an image (its size is filled in once known: TermRef.image.bytes). */
export function imageRef(img: { src: string; alt: string; caption: string }, pageId: ID, title: string): TermRef {
  const words = [img.alt.trim(), img.caption.trim()].filter(Boolean).join(' — ')
  return {
    id: newId(),
    pageId,
    title,
    // what Claude reads in the <reference>; the picture itself goes along as an image block
    // (the source keeps two images with the same words apart — the chip list counts a passage once)
    markdown: `[Image block${words ? `: ${words}` : ''}] (the picture is attached to this task as an image · source ${img.src.slice(0, 160)})`,
    lines: 1,
    image: { src: img.src, bytes: null },
  }
}

/**
 * The task's user message with the referenced images in front of its text (after open tool results).
 * `failed(title)` hears about every image that could not be loaded.
 */
export async function withRefImages(user: BetaMessageParam, refs: TermRef[], signal: AbortSignal, failed: (title: string) => void): Promise<BetaMessageParam> {
  const imgs = refs.filter((r) => r.image)
  if (!imgs.length) return user
  const blocks: BetaContentBlockParam[] = []
  let n = 0
  for (const r of imgs) {
    try {
      const image = await loadImageForClaude(r.image!.src, signal)
      n++
      blocks.push({ type: 'text', text: `Image ${n} — the image block referenced from the page "${r.title}" (page_id ${r.pageId}):` })
      blocks.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } })
    } catch (e) {
      if (signal.aborted) throw new AIError('aborted')
      failed(r.title)
      blocks.push({ type: 'text', text: `[An image block referenced from the page "${r.title}" could not be loaded and is missing here.]` })
    }
  }
  const content: BetaContentBlockParam[] = typeof user.content === 'string' ? [{ type: 'text', text: user.content }] : [...user.content]
  // tool results must stay first in a user turn
  const firstOther = content.findIndex((b) => b.type !== 'tool_result')
  const at = firstOther < 0 ? content.length : firstOther
  content.splice(at, 0, ...blocks)
  return { ...user, content }
}
