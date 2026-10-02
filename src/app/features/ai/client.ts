/**
 * Claude, bring-your-own-key. The official SDK is loaded lazily on first use and runs
 * in the browser: the key lives in settings.aiApiKey (IndexedDB, this device only) and
 * is sent to api.anthropic.com and nowhere else.
 */
import type AnthropicSDK from '@anthropic-ai/sdk'
import { useWorkspace } from '../../store/store'

export type AIAction = 'continue' | 'improve' | 'shorter' | 'longer' | 'fix' | 'summarize' | 'translate' | 'explain' | 'action_items' | 'custom' | 'autofill'

export interface RunAIOptions {
  action: AIAction
  /** Selected text or block text the action applies to */
  input: string
  /** Free-form instruction for 'custom' / target language for 'translate' */
  instruction?: string
  /** Surrounding page context (title + plain text) */
  context?: string
  /** Called with each streamed text delta (not the accumulated text). */
  onToken?: (text: string) => void
  signal?: AbortSignal
}

/* ------------------------------------------------------------------ */
/* Models                                                              */
/* ------------------------------------------------------------------ */

export const AI_MODELS = [
  { id: 'claude-opus-5-5', short: 'OPUS 5.5', name: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', short: 'SONNET 5.5', name: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-4-5', short: 'HAIKU 4.5', name: 'Claude Haiku 4.5' },
] as const

export type AIModelId = (typeof AI_MODELS)[number]['id']
export const DEFAULT_MODEL: AIModelId = 'claude-opus-5-5'

export function resolveModel(id: string | undefined | null): (typeof AI_MODELS)[number] {
  return AI_MODELS.find((m) => m.id === id) ?? AI_MODELS[0]
}

export function isAIConfigured(): boolean {
  return !!useWorkspace.getState().settings.aiApiKey
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export type AIErrorCode =
  | 'no_key'
  | 'invalid_key'
  | 'permission'
  | 'rate_limit'
  | 'overloaded'
  | 'offline'
  | 'bad_request'
  | 'refusal'
  | 'empty'
  | 'aborted'
  | 'unknown'

export class AIError extends Error {
  code: AIErrorCode
  constructor(code: AIErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'AIError'
    this.code = code
  }
}

type SDKModule = typeof import('@anthropic-ai/sdk')
let sdkPromise: Promise<SDKModule> | null = null
function loadSDK(): Promise<SDKModule> {
  sdkPromise ??= import('@anthropic-ai/sdk').catch((e) => {
    sdkPromise = null
    throw e
  })
  return sdkPromise
}

let cached: { key: string; client: AnthropicSDK } | null = null
async function getClient(apiKey: string): Promise<{ client: AnthropicSDK; sdk: SDKModule }> {
  let sdk: SDKModule
  try {
    sdk = await loadSDK()
  } catch {
    throw new AIError('offline', 'Could not load the Claude SDK')
  }
  if (!cached || cached.key !== apiKey) {
    const Anthropic = sdk.default
    cached = { key: apiKey, client: new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 }) }
  }
  return { client: cached.client, sdk }
}

/** Map anything thrown by the SDK to an AIError (most specific class first). */
function toAIError(e: unknown, sdk: SDKModule | null): AIError {
  if (e instanceof AIError) return e
  if (e instanceof DOMException && e.name === 'AbortError') return new AIError('aborted')
  if (sdk) {
    const A = sdk.default
    if (e instanceof A.APIUserAbortError) return new AIError('aborted')
    if (e instanceof A.AuthenticationError) return new AIError('invalid_key', e.message)
    if (e instanceof A.PermissionDeniedError) return new AIError('permission', e.message)
    if (e instanceof A.RateLimitError) return new AIError('rate_limit', e.message)
    if (e instanceof A.APIConnectionError) return new AIError('offline', e.message)
    if (e instanceof A.BadRequestError) return new AIError('bad_request', cleanMessage(e.message))
    if (e instanceof A.InternalServerError) return new AIError(e.status === 529 ? 'overloaded' : 'unknown', e.message)
    if (e instanceof A.APIError) return new AIError(e.status === 529 ? 'overloaded' : 'unknown', cleanMessage(e.message))
  }
  if (e instanceof TypeError) return new AIError('offline', e.message)
  return new AIError('unknown', e instanceof Error ? e.message : String(e))
}

function cleanMessage(msg: string): string {
  // SDK messages look like '400 {"type":"error","error":{"message":"…"}}'
  const m = msg.match(/"message"\s*:\s*"([^"]+)"/)
  return m ? m[1] : msg
}

/** Check a key without spending tokens (lists one model). */
export async function verifyKey(apiKey: string, signal?: AbortSignal): Promise<'ok' | AIErrorCode> {
  let sdk: SDKModule | null = null
  try {
    const got = await getClient(apiKey)
    sdk = got.sdk
    await got.client.models.list({ limit: 1 }, { signal })
    return 'ok'
  } catch (e) {
    return toAIError(e, sdk).code
  }
}

/* ------------------------------------------------------------------ */
/* Streaming core                                                      */
/* ------------------------------------------------------------------ */

export interface StreamOptions {
  system: string
  prompt: string
  onToken?: (delta: string) => void
  signal?: AbortSignal
}

/** Stream one completion with the configured model. Resolves with the full text. */
export async function streamCompletion({ system, prompt, onToken, signal }: StreamOptions): Promise<string> {
  const settings = useWorkspace.getState().settings
  const apiKey = settings.aiApiKey.trim()
  if (!apiKey) throw new AIError('no_key')
  if (signal?.aborted) throw new AIError('aborted')
  const model = resolveModel(settings.aiModel).id
  let sdk: SDKModule | null = null
  try {
    const got = await getClient(apiKey)
    sdk = got.sdk
    const { client } = got
    if (signal?.aborted) throw new AIError('aborted')
    const messages: AnthropicSDK.MessageParam[] = [{ role: 'user', content: prompt }]
    let text = ''
    const onText = (delta: string) => {
      text += delta
      onToken?.(delta)
    }

    let stopReason: string | null
    if (model === 'claude-haiku-4-5') {
      const stream = client.messages.stream({ model, max_tokens: 8000, system, messages })
      const abort = () => stream.abort()
      signal?.addEventListener('abort', abort, { once: true })
      stream.on('text', onText)
      try {
        stopReason = (await stream.finalMessage()).stop_reason
      } finally {
        signal?.removeEventListener('abort', abort)
      }
    } else {
      // Opus / Sonnet 5.5: thinking is always on (adaptive) — never send `thinking`.
      // Refusal fallbacks route a declined request to Anthropic's recommended model.
      const stream = client.beta.messages.stream({
        model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low' },
        system,
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

/* ------------------------------------------------------------------ */
/* Prompts                                                             */
/* ------------------------------------------------------------------ */

const SYSTEM = `You are the writing assistant built into One, a local-first workspace for notes, docs and databases.
Write like a skilled editor: clear, concrete, no filler.

Rules:
- Reply with the result only. No preamble ("Here is…", "Sure"), no closing remarks, no notes about what you changed.
- Use Markdown (headings, lists, **bold**, task lists "- [ ] …", tables) only where it helps the reader. Never wrap the whole answer in a code fence.
- Write in the language of the text you are working on (or of the request, if there is no text), unless you are asked to translate.
- Keep the author's voice, facts and meaning. Never invent facts, names, numbers or quotes.`

const TASKS: Record<Exclude<AIAction, 'custom' | 'translate' | 'autofill'>, string> = {
  continue:
    'Continue writing from exactly where the text ends. Match its tone, style and formatting. Write about one to three paragraphs (or a few list items, if the text ends in a list). Output only the new text — do not repeat what is already there.',
  improve:
    'Improve the writing of the text: clarity, flow, rhythm and word choice. Keep the meaning, the language, the Markdown structure and roughly the same length.',
  shorter: 'Make the text noticeably shorter — about half the length — while keeping every key point. Keep the language and the Markdown structure.',
  longer:
    'Make the text longer — about one and a half to two times — by adding useful explanation, transitions or examples consistent with the page. Do not invent specific facts such as numbers, names or dates.',
  fix: 'Fix spelling, grammar and punctuation only. Change nothing else — not the wording, not the structure. If there are no mistakes, return the text unchanged.',
  summarize:
    'Summarize the text. Use a few concise bullet points for longer text, or one or two sentences for short text. Lead with the most important point.',
  explain:
    'Explain the text in plain words for a smart reader who is new to the topic: one short paragraph, then a short bullet list of key terms or ideas if that helps.',
  action_items:
    'Extract every action item from the text as a Markdown task list ("- [ ] …"), one task per line, each starting with a verb. Keep owners and due dates when they are mentioned. If there are no action items, reply with one short sentence saying so.',
}

const MAX_CONTEXT = 24000
const MAX_INPUT = 60000

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n[…]` : s
}

/** Build the user prompt for an action. Exported for tests/debugging. */
export function buildPrompt({ action, input, instruction, context }: Pick<RunAIOptions, 'action' | 'input' | 'instruction' | 'context'>): string {
  const parts: string[] = []
  const text = input.trim()
  if (context?.trim()) parts.push(`<page>\n${clip(context.trim(), MAX_CONTEXT)}\n</page>`)
  if (text) parts.push(`<text>\n${clip(text, MAX_INPUT)}\n</text>`)

  let task: string
  switch (action) {
    case 'translate':
      task = `Translate the text into ${instruction?.trim() || 'English'}. Preserve meaning, tone and Markdown formatting. Output only the translation, written in ${instruction?.trim() || 'English'}.`
      break
    case 'custom':
      task = text
        ? `Apply this request to the text: ${instruction?.trim() || 'Improve it.'}\nIf the request asks a question about the text instead, answer it directly.`
        : `Request: ${instruction?.trim() || ''}\nWrite the content requested, ready to paste into the page.${context?.trim() ? ' Use the page for context where relevant.' : ''}`
      break
    case 'autofill':
      task = `Fill in a database field from the text above. Field: ${instruction?.trim() || 'value'}.\nReply with only the value — no quotes, no label, no explanation, no Markdown.`
      break
    case 'continue':
      task = text ? TASKS.continue : `${TASKS.continue}\nThe page is still empty apart from its title; start it.`
      break
    default:
      task = TASKS[action]
  }
  parts.push(`Task: ${task}`)
  return parts.join('\n\n')
}

/** Run an AI action (streams). Resolves with the complete Markdown result. */
export async function runAI(opts: RunAIOptions): Promise<string> {
  const text = await streamCompletion({
    system: SYSTEM,
    prompt: buildPrompt(opts),
    onToken: opts.onToken,
    signal: opts.signal,
  })
  return opts.action === 'autofill' ? text.trim().replace(/^["'`]|["'`]$/g, '') : stripFence(text)
}

/** Remove a code fence wrapped around the whole answer (models occasionally do it). */
export function stripFence(md: string): string {
  const m = md.trim().match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/)
  return m ? m[1] : md.trim()
}

/* ------------------------------------------------------------------ */
/* Ask your workspace                                                  */
/* ------------------------------------------------------------------ */

export const WORKSPACE_SYSTEM = `You answer questions about the user's own workspace in One, a local-first notes app.
You get excerpts of the most relevant pages. Each page starts with its exact title.

Rules:
- Answer only from the pages provided. If they do not contain the answer, say so in one sentence and suggest what the user could write down.
- Cite your sources inline as [[Exact Page Title]] directly after the statement they support. Use the titles exactly as given.
- Be brief and concrete. Use Markdown lists where helpful. No preamble.
- Answer in the language of the question.`
