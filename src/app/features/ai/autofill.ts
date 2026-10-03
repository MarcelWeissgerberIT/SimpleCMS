/**
 * AI autofill — the Claude side. The database area describes a field, a task and one row; this
 * module turns that into a prompt plus a JSON schema (structured outputs), sends it with the
 * user's own key and hands back the raw `value`. Validating / coercing it into a property value
 * (option ids, numbers, URLs) is the database's job, so a bad answer becomes a per-row error
 * and never touches stored data.
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../store/store'
import { toMarkdown } from '../share/markdown'
import { completeStructured, resolveModel } from './client'

export type AutofillPreset = 'summary' | 'extract' | 'translate' | 'categorize' | 'custom'
export type AutofillFieldType = 'text' | 'number' | 'select' | 'multi_select' | 'checkbox' | 'url'

export interface AutofillField {
  name: string
  type: AutofillFieldType
  /** select / multi_select: names of the existing options */
  options?: string[]
  /** select / multi_select: Claude may answer names that are not options yet */
  allowNew?: boolean
  /** number: display format ('percent' → answer fractions) */
  numberFormat?: string
  /** the property's description, if any */
  description?: string
}

export interface AutofillTask {
  preset: AutofillPreset
  /** extract: what to pull out · custom: the instruction */
  instruction?: string
  /** translate: target language (English name) */
  language?: string
  /** translate: what to translate. Content is taken from the row when `content` is set. */
  source?: { name: string; text?: string; content?: JSONContent | null }
}

export interface AutofillRow {
  title: string
  /** The other properties as display text (empty values may be left out). */
  properties: Array<{ name: string; value: string }>
  content: JSONContent | null
}

export interface AutofillRequest {
  field: AutofillField
  task: AutofillTask
  row: AutofillRow
}

/** ok: the answer's `value` (unvalidated) · not ok: the answer was not the JSON we asked for. */
export type AutofillAnswer = { ok: true; value: unknown } | { ok: false; raw: string }

/** Page content sent per row (Markdown characters). */
export const AUTOFILL_CONTENT_MAX = 8000

/** Markdown of a page, cut at a line break near `max` characters. */
export function contentMarkdown(content: JSONContent | null | undefined, max = AUTOFILL_CONTENT_MAX): string {
  const md = toMarkdown(content ?? null).trim()
  if (md.length <= max) return md
  const cut = md.lastIndexOf('\n', max)
  return `${md.slice(0, cut > max * 0.6 ? cut : max).trimEnd()}\n[…]`
}

const SYSTEM = `You fill in one field of a database row in One, a local-first workspace for notes and databases.
You get the row inside <row> tags (its title, the other fields and the page content as Markdown), a task and the field to fill.

Rules:
- Base the value only on the row. Never invent facts, names, numbers, dates or links.
- Put the value in "value" and nothing else: no label, no surrounding quotes, no explanation, no Markdown.
- Write text in the language of the row, unless the task asks for a translation.
- If the row does not contain what the task asks for, set "value" to null.`

const quote = (s: string) => JSON.stringify(s)

function taskText(task: AutofillTask): string {
  switch (task.preset) {
    case 'summary':
      return 'Summarize the row in one or two short sentences (at most 40 words). Lead with what matters most.'
    case 'extract':
      return `Extract this from the row: ${task.instruction?.trim() || 'the most important fact'}. Keep it as short as possible.`
    case 'translate':
      return `Translate the text in <source> into ${task.language?.trim() || 'English'}. Keep meaning and tone. Answer with the translation only.`
    case 'categorize':
      return 'Categorize the row: choose what fits it best.'
    case 'custom':
      return task.instruction?.trim() || 'Fill in the field from the row.'
  }
}

function fieldText(f: AutofillField): string {
  const name = quote(f.name)
  const options = (f.options ?? []).map(quote).join(', ')
  const lines: string[] = []
  switch (f.type) {
    case 'text':
      lines.push(`Field ${name} (text): plain text on a single line.`)
      break
    case 'number':
      lines.push(`Field ${name} (number): a plain JSON number, no units or thousands separators.`)
      if (f.numberFormat === 'percent') lines.push('The field shows percentages: answer a fraction, e.g. 0.25 for 25 %.')
      break
    case 'select':
      lines.push(options ? `Field ${name} (select): exactly one of these options: ${options}.` : `Field ${name} (select): one short option name.`)
      if (f.allowNew && options) lines.push('If none of them fits, answer a new short option name (one to three words) instead.')
      break
    case 'multi_select':
      lines.push(options ? `Field ${name} (multi-select): a list of every option that applies, from: ${options}. An empty list if none applies.` : `Field ${name} (multi-select): a list of short option names.`)
      if (f.allowNew && options) lines.push('You may add new short option names (one to three words) when nothing fits.')
      break
    case 'checkbox':
      lines.push(`Field ${name} (checkbox): true or false.`)
      break
    case 'url':
      lines.push(`Field ${name} (URL): one absolute URL starting with https:// or http:// that appears in the row, or null.`)
      break
  }
  if (f.description?.trim()) lines.push(`Field description: ${f.description.trim()}`)
  return lines.join('\n')
}

function valueSchema(f: AutofillField): Record<string, unknown> {
  const nullable = (s: Record<string, unknown>) => ({ anyOf: [s, { type: 'null' }] })
  const options = f.options ?? []
  const strict = !f.allowNew && options.length > 0
  switch (f.type) {
    case 'number':
      return nullable({ type: 'number' })
    case 'checkbox':
      return { type: 'boolean' }
    case 'select':
      return nullable(strict ? { type: 'string', enum: options } : { type: 'string' })
    case 'multi_select':
      return { type: 'array', items: strict ? { type: 'string', enum: options } : { type: 'string' } }
    default:
      return nullable({ type: 'string' })
  }
}

/** System prompt, user prompt and answer schema for one row. Exported for tests/debugging. */
export function buildAutofillPrompt(req: AutofillRequest): { system: string; prompt: string; schema: Record<string, unknown> } {
  const { field, task, row } = req
  const parts: string[] = []
  if (task.preset === 'translate') {
    const src = task.source
    const text = src?.content !== undefined ? contentMarkdown(src.content) : (src?.text ?? row.title)
    parts.push(`<source name=${quote(src?.name ?? 'Title')}>\n${text.trim()}\n</source>`)
  } else {
    const lines = [`# ${row.title.replace(/\s+/g, ' ').trim() || '(untitled)'}`]
    const props = row.properties.filter((p) => p.value.trim())
    if (props.length) lines.push('', 'Fields:', ...props.map((p) => `- ${p.name}: ${p.value.replace(/\s+/g, ' ').trim()}`))
    const md = contentMarkdown(row.content)
    if (md) lines.push('', 'Content:', md)
    parts.push(`<row>\n${lines.join('\n')}\n</row>`)
  }
  parts.push(`Task: ${taskText(task)}`)
  parts.push(fieldText(field))
  return {
    system: SYSTEM,
    prompt: parts.join('\n\n'),
    schema: { type: 'object', properties: { value: valueSchema(field) }, required: ['value'], additionalProperties: false },
  }
}

/**
 * Ask Claude for one field value. Throws AIError for API failures (no key, rate limit after
 * retries, offline, aborted …); a reply that is not `{ "value": … }` resolves as `{ ok: false }`.
 */
export async function requestAutofill(req: AutofillRequest, signal?: AbortSignal): Promise<AutofillAnswer> {
  const { system, prompt, schema } = buildAutofillPrompt(req)
  const long = req.task.preset === 'translate' || req.field.type === 'text'
  const raw = await completeStructured({ system, prompt, schema, maxTokens: long ? 8000 : 4096, signal })
  try {
    const parsed: unknown = JSON.parse(raw.trim())
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'value' in parsed) return { ok: true, value: (parsed as { value: unknown }).value }
  } catch {
    /* not JSON */
  }
  return { ok: false, raw }
}

/* ------------------------------------------------------------------ */
/* Cost estimate                                                       */
/* ------------------------------------------------------------------ */

/** Conservative characters per token (newer tokenizers use a bit more tokens per character). */
const CHARS_PER_TOKEN = 3.2
/** System prompt + structured-output instructions + task + field, per request. */
const OVERHEAD_TOKENS = Math.round(SYSTEM.length / CHARS_PER_TOKEN) + 260
/** Typical answer (incl. a little thinking at low effort) per request. */
const OUTPUT_TOKENS: Record<AutofillPreset, number> = { summary: 220, extract: 120, translate: 120, categorize: 100, custom: 180 }

export interface AutofillEstimate {
  rows: number
  inputTokens: number
  outputTokens: number
  usd: number
  /** short model label, e.g. "OPUS 5.5" */
  model: string
}

/**
 * Rough cost of filling `rows` rows whose context adds up to `contextChars` characters.
 * Anthropic bills the real usage to the user's key; this is only an order of magnitude.
 */
export function estimateAutofill({ rows, contextChars, preset }: { rows: number; contextChars: number; preset: AutofillPreset }): AutofillEstimate {
  const model = resolveModel(useWorkspace.getState().settings.aiModel)
  const contextTokens = contextChars / CHARS_PER_TOKEN
  const inputTokens = Math.round(rows * OVERHEAD_TOKENS + contextTokens)
  const outputTokens = Math.round(rows * OUTPUT_TOKENS[preset] + (preset === 'translate' ? contextTokens * 1.1 : 0))
  const usd = (inputTokens * model.price.input + outputTokens * model.price.output) / 1_000_000
  return { rows, inputTokens, outputTokens, usd, model: model.short }
}
