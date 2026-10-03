/**
 * Meeting notes — the Claude side. One structured-output request with the user's own key:
 * transcript (+ the notes taken during the meeting) in, { title, summary, decisions, actionItems }
 * out, written in the transcript's language. Only text leaves the device; never audio.
 */
import { formatOffset, type TranscriptSegment } from '../../../editor'
import { AIError, completeStructured } from '../client'

export interface MeetingActionItem {
  text: string
  /** the person's name as said in the meeting */
  owner: string | null
  /** ISO date "2026-10-09" */
  due: string | null
}

export interface MeetingSummary {
  title: string | null
  summary: string[]
  decisions: string[]
  actionItems: MeetingActionItem[]
}

export interface MeetingInput {
  transcript: TranscriptSegment[]
  /** BCP-47 language of the recording ("de-DE") */
  language: string
  title: string
  startedAt: number | null
  /** names of the people in the workspace (owner matching) */
  people: string[]
  /** the notes typed into the block during the meeting (Markdown), if any */
  notes?: string
}

/** Transcript characters sent at most (≈ 150k tokens — many hours of talk). */
const MAX_TRANSCRIPT = 600_000

const SYSTEM = `You turn meeting transcripts into meeting notes for One, a local-first workspace.
The transcript comes from live speech recognition or an export (Zoom, Meet, Teams): expect misheard words and missing punctuation.

Rules:
- Use only what was said. Never invent decisions, owners, dates, numbers or names.
- Write everything in the language of the transcript (the language tag is a hint), even if these instructions are in English.
- summary: 3 to 7 short bullet points, the most important first. Complete thoughts, no filler, no "In this meeting…".
- decisions: what was decided, agreed or rejected — one line each. An empty list when nothing was decided.
- actionItems: concrete follow-ups, each starting with a verb. owner: the responsible person's name as said (use the spelling from "Known people" when it is clearly them), else null. due: a date as YYYY-MM-DD when a deadline is stated or clearly implied (resolve "Friday", "next week" against the meeting date), else null.
- title: a short, specific title for the meeting (at most 8 words).
- Fix obvious recognition errors silently; do not guess names you cannot hear.`

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] })

export const MEETING_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    title: nullable({ type: 'string' }),
    summary: { type: 'array', items: { type: 'string' } },
    decisions: { type: 'array', items: { type: 'string' } },
    actionItems: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          owner: nullable({ type: 'string' }),
          due: nullable({ type: 'string', format: 'date' }),
        },
        required: ['text', 'owner', 'due'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'summary', 'decisions', 'actionItems'],
  additionalProperties: false,
}

function transcriptBlock(segments: TranscriptSegment[]): string {
  const lines = segments.map((s) => `[${formatOffset(s.t)}] ${s.text}`)
  let text = lines.join('\n')
  if (text.length > MAX_TRANSCRIPT) {
    // keep the beginning and the end (decisions and next steps tend to come last)
    const head = text.slice(0, MAX_TRANSCRIPT * 0.4)
    const tail = text.slice(-MAX_TRANSCRIPT * 0.6)
    text = `${head.slice(0, head.lastIndexOf('\n'))}\n[… middle of the transcript omitted …]\n${tail.slice(tail.indexOf('\n') + 1)}`
  }
  return text
}

function isoDay(d: Date): string {
  const two = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

/** System prompt, user prompt and schema. Exported for tests / debugging. */
export function buildMeetingPrompt(input: MeetingInput): { system: string; prompt: string; schema: Record<string, unknown> } {
  const when = new Date(input.startedAt ?? Date.now())
  const weekday = when.toLocaleDateString('en-US', { weekday: 'long' })
  const parts = [
    `Meeting date: ${isoDay(when)} (${weekday})`,
    `Language: ${input.language || 'unknown'}`,
    input.title.trim() ? `Title so far: ${input.title.trim()}` : '',
    input.people.length ? `Known people: ${input.people.join(', ')}` : '',
  ].filter(Boolean)
  const blocks = [parts.join('\n')]
  if (input.notes?.trim()) blocks.push(`<notes_taken_during_the_meeting>\n${input.notes.trim().slice(0, 40_000)}\n</notes_taken_during_the_meeting>`)
  blocks.push(`<transcript>\n${transcriptBlock(input.transcript)}\n</transcript>`)
  blocks.push('Write the meeting notes.')
  return { system: SYSTEM, prompt: blocks.join('\n\n'), schema: MEETING_SCHEMA }
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const line = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')
const lines = (v: unknown) => (Array.isArray(v) ? v.map(line).filter(Boolean) : [])

/** The answer, validated and trimmed; null when it is not the JSON we asked for. */
export function parseMeetingSummary(raw: string): MeetingSummary | null {
  let data: unknown
  try {
    data = JSON.parse(raw.trim())
  } catch {
    return null
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const d = data as Record<string, unknown>
  const items = Array.isArray(d.actionItems) ? d.actionItems : []
  const actionItems: MeetingActionItem[] = []
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    const a = it as Record<string, unknown>
    const text = line(a.text)
    if (!text) continue
    const due = line(a.due)
    actionItems.push({ text, owner: line(a.owner) || null, due: ISO_DAY.test(due) && !Number.isNaN(Date.parse(due)) ? due : null })
  }
  return { title: line(d.title) || null, summary: lines(d.summary), decisions: lines(d.decisions), actionItems }
}

/** Ask Claude for the notes. Throws AIError (no key, rate limit after retries, offline, aborted, empty …). */
export async function requestMeetingSummary(input: MeetingInput, signal?: AbortSignal): Promise<MeetingSummary> {
  const { system, prompt, schema } = buildMeetingPrompt(input)
  const raw = await completeStructured({ system, prompt, schema, maxTokens: 8000, signal })
  const parsed = parseMeetingSummary(raw)
  if (!parsed || (!parsed.summary.length && !parsed.decisions.length && !parsed.actionItems.length)) throw new AIError('empty')
  return parsed
}
