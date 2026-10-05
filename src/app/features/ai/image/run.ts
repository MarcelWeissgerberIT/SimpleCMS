/**
 * The image part of a background run (runs.ts, request kind 'image'): load the picture, send it with
 * the task, return the answer (Markdown for read / ask, JSON for describe / table).
 */
import { useWorkspace } from '../../../store/store'
import { stripFence } from '../client'
import { loadImageForClaude, type ImageMeta } from './load'
import { isStructured, requestImage, type ImageAction } from './request'

export { ImageLoadError, type ImageIssue, type ImageMeta } from './load'
export type { ImageAction } from './request'

/** An image request as a run keeps it (plain data: it survives a reload). */
export interface ImageRunRequest {
  kind: 'image'
  action: ImageAction
  label: string
  code: string
  /** the image block's source and block id when the request started */
  src: string
  blockId: string | null
  /** 'ask': the question */
  question?: string
  /** a revision of an earlier answer */
  instruction?: string
}

export async function runImageRequest(
  req: ImageRunRequest,
  context: string,
  opts: { onToken?: (delta: string) => void; signal: AbortSignal; onImage?: (meta: ImageMeta) => void },
): Promise<string> {
  const image = await loadImageForClaude(req.src, opts.signal)
  const { data: _data, ...meta } = image
  opts.onImage?.(meta)
  const lang = useWorkspace.getState().settings.language === 'de' ? 'de' : 'en'
  const text = await requestImage({
    action: req.action,
    question: req.question,
    instruction: req.instruction,
    context,
    lang,
    image,
    // structured answers are not shown while they stream (the panel waits for the whole JSON)
    onToken: isStructured(req.action) ? undefined : opts.onToken,
    signal: opts.signal,
  })
  return isStructured(req.action) ? text.trim() : stripFence(text)
}
