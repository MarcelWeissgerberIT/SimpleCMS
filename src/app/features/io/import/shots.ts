/**
 * Claude looks at a screenshot of a Claude Design import — only when the person ticked "Describe the
 * screenshots with Claude" and confirmed: the image AI's describe (alt text + caption) and read (the text
 * in the picture as Markdown) on the dropped file, before anything is written. The picture goes to
 * Anthropic as a base64 image block (≤ 1568 px, ≤ 5 MB — features/ai/image/load.ts); web images in the
 * read-out text become links.
 */
import type { JSONContent } from '@tiptap/core'
import { loadImageForClaude } from '../../ai/image/load'
import { requestImage } from '../../ai/image/request'
import { parseDescription } from '../../ai/image/answers'
import { stripFence } from '../../ai/client'
import { withoutWebImages } from '../../agents/images'

export interface ShotDescription {
  alt: string
  caption: string
  text: JSONContent[]
}

export async function describeShot(file: Blob, lang: 'en' | 'de', signal?: AbortSignal): Promise<ShotDescription> {
  const url = URL.createObjectURL(file)
  try {
    const image = await loadImageForClaude(url, signal)
    const d = parseDescription(await requestImage({ action: 'describe', image, lang, signal }))
    const md = withoutWebImages(stripFence(await requestImage({ action: 'read', image, lang, signal }))).trim()
    const { markdownToDoc } = await import('../../../editor')
    const text = md ? (markdownToDoc(md).content ?? []).filter((b) => !(b.type === 'paragraph' && !b.content?.length)) : []
    return { alt: d?.alt ?? '', caption: d?.caption ?? '', text }
  } finally {
    URL.revokeObjectURL(url)
  }
}
