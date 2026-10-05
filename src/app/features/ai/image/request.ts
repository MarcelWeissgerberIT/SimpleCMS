/**
 * Claude looks at an image block: the request (the image as a base64 image block + the task as text, one
 * user message) and the prompts of the four actions.
 *
 *  - describe: alt text + caption (structured output: { alt, caption })
 *  - read: the text in the image as Markdown (streamed)
 *  - table: every table in the image (structured output: { tables: [{ title, header, rows }] })
 *  - ask: a free question about the image (streamed)
 *
 * The image goes to Anthropic only with these explicit actions. No MCP server joins (the image is the
 * material); the page goes along as its context marks allow (the caller passes `context`).
 */
import type AnthropicSDK from '@anthropic-ai/sdk'
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { AIError, claudeClient, toAIError, usesDemo } from '../client'
import type { LoadedImage } from './load'

export type ImageAction = 'describe' | 'read' | 'table' | 'ask'
export const IMAGE_ACTIONS: readonly ImageAction[] = ['describe', 'read', 'table', 'ask']

/** Answers that are JSON (the panel shows fields / a preview instead of the raw text). */
export const isStructured = (a: ImageAction): boolean => a === 'describe' || a === 'table'

const SYSTEM = `You look at an image from a page in One, a local-first workspace for notes, docs and databases, and do the task you are given.

Rules:
- Work only from what the image shows; the page, when it is given, is context. Never invent text, numbers, names or details that are not visible.
- Something you cannot read stays out or is marked [unreadable] — do not guess.
- Reply with the result only: no preamble ("Here is…"), no closing remarks. Never wrap the whole answer in a code fence.`

const DESCRIBE = `Write the alt text and the caption for this image.
- alt: one short sentence (at most about 125 characters) saying what the image shows, for someone who cannot see it. Concrete: the kind of image (photo, diagram, table, screenshot, protocol …) and its key content. Do not start with "Image of" or "Picture of".
- caption: one line (at most about 100 characters) that could sit under the image in the page — what it is about or why it is there. Not a repeat of the alt text.`

const READ = `Read out all the text in the image, in reading order, as Markdown.
- Keep the structure: headings as headings, lists as lists, tables as Markdown tables (with a header row), paragraphs as paragraphs.
- Copy the text exactly as written, in its own language — do not translate, correct, complete or summarise it. Keep numbers, units and symbols as they are.
- Labels in diagrams or figures: list them in a sensible order.
- If the image has no readable text, reply with one short sentence saying so.`

const TABLE = `Find every table in the image (a grid of rows and columns: data tables, schedules, plate or deck layouts, forms with rows) and copy each one.
- title: the table's own caption or heading as written, else a short name for it from the image.
- header: the column names as written. Without a header row: short names for the columns. A row-label column gets a header too (e.g. the plate's row letters → "Row").
- rows: every row in order, one cell per column, the text exactly as written including units ("50 µl", "1:10"). An empty cell is "". A merged cell repeats its text in every cell it spans.
- Numbers stay as written (keep the decimal separator of the image).
- No table in the image: tables = [].`

const DESCRIBE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: { alt: { type: 'string' }, caption: { type: 'string' } },
  required: ['alt', 'caption'],
  additionalProperties: false,
}

const TABLE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    tables: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          header: { type: 'array', items: { type: 'string' } },
          rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
        },
        required: ['title', 'header', 'rows'],
        additionalProperties: false,
      },
    },
  },
  required: ['tables'],
  additionalProperties: false,
}

const MAX_CONTEXT = 24000
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}\n[…]` : s)

export interface ImagePromptInput {
  action: ImageAction
  /** 'ask': the question */
  question?: string
  /** a revision ("Revise" after a result): what to do differently */
  instruction?: string
  /** the page as its context marks allow ('' = nothing) */
  context?: string
  /** alt text / caption the block has now */
  alt?: string
  caption?: string
  /** the UI language — for answers when the page gives none */
  lang: 'en' | 'de'
}

/** The text that goes along with the image. Exported for tests / debugging. */
export function buildImagePrompt({ action, question, instruction, context, alt, caption, lang }: ImagePromptInput): string {
  const parts: string[] = []
  if (context?.trim()) parts.push(`<page>\n${clip(context.trim(), MAX_CONTEXT)}\n</page>`)
  const now = [alt?.trim() ? `alt text: ${alt.trim()}` : '', caption?.trim() ? `caption: ${caption.trim()}` : ''].filter(Boolean)
  if (now.length) parts.push(`The image block has now — ${now.join(' · ')}`)
  const language = lang === 'de' ? 'German' : 'English'
  switch (action) {
    case 'describe':
      parts.push(`Task: ${DESCRIBE}\nWrite both in the language of the page${context?.trim() ? '' : ` (there is no page text: write in ${language})`}.`)
      break
    case 'read':
      parts.push(`Task: ${READ}`)
      break
    case 'table':
      parts.push(`Task: ${TABLE}\nTitles and invented column names in the language of the image.`)
      break
    case 'ask':
      parts.push(`Task: Answer the question about the image. Use Markdown where it helps the reader. Answer in the language of the question.\nQuestion: ${question?.trim() || 'What does this image show?'}`)
      break
  }
  if (instruction?.trim()) parts.push(`Also, from the user: ${instruction.trim()}`)
  return parts.join('\n\n')
}

export interface ImageRequest extends ImagePromptInput {
  image: LoadedImage
  onToken?: (delta: string) => void
  signal?: AbortSignal
}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

/** One request: the image + the task, streamed. Resolves with the answer text (JSON for describe / table). */
export async function requestImage(req: ImageRequest): Promise<string> {
  // the canned demo answers cannot look at a picture: an image needs a real key
  if (usesDemo()) throw new AIError('no_key')
  const { image, onToken, signal, action } = req
  if (signal?.aborted) throw new AIError('aborted')
  let sdk: Awaited<ReturnType<typeof claudeClient>>['sdk'] | null = null
  try {
    const got = await claudeClient()
    sdk = got.sdk
    const { client, model } = got
    if (signal?.aborted) throw new AIError('aborted')
    const prompt = buildImagePrompt(req)
    const schema = action === 'describe' ? DESCRIBE_SCHEMA : action === 'table' ? TABLE_SCHEMA : null
    const format = schema ? { type: 'json_schema' as const, schema } : null
    const source = { type: 'base64' as const, media_type: image.mediaType, data: image.data }
    let text = ''
    const onText = (delta: string) => {
      text += delta
      onToken?.(delta)
    }
    let stopReason: string | null
    if (model === 'claude-haiku-4-5') {
      const messages: AnthropicSDK.MessageParam[] = [{ role: 'user', content: [{ type: 'image', source }, { type: 'text', text: prompt }] }]
      const stream = client.messages.stream({ model, max_tokens: 8000, system: SYSTEM, messages, ...(format ? { output_config: { format } } : {}) })
      const abort = () => stream.abort()
      signal?.addEventListener('abort', abort, { once: true })
      stream.on('text', onText)
      try {
        stopReason = (await stream.finalMessage()).stop_reason
      } finally {
        signal?.removeEventListener('abort', abort)
      }
    } else {
      // Opus / Sonnet 5.5: thinking is always on (adaptive) — never send `thinking`; reading a dense
      // picture gets medium effort, a caption or a question low. Refusal fallbacks as in client.ts.
      const messages: BetaMessageParam[] = [{ role: 'user', content: [{ type: 'image', source }, { type: 'text', text: prompt }] }]
      const effort = action === 'read' || action === 'table' ? ('medium' as const) : ('low' as const)
      const stream = client.beta.messages.stream({
        model,
        max_tokens: 16000,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        output_config: format ? { effort, format } : { effort },
        system: SYSTEM,
        messages,
      })
      const abort = () => stream.abort()
      signal?.addEventListener('abort', abort, { once: true })
      stream.on('text', onText)
      try {
        stopReason = (await stream.finalMessage()).stop_reason
      } finally {
        signal?.removeEventListener('abort', abort)
      }
    }
    if (stopReason === 'refusal') throw new AIError('refusal')
    if (!text.trim()) throw new AIError('empty')
    return text
  } catch (e) {
    if (signal?.aborted) throw new AIError('aborted')
    throw toAIError(e, sdk)
  }
}
