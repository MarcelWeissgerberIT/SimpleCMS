/**
 * One memory — proposals. Nothing here writes: a proposal is shown, the person confirms it (save.ts).
 *  - proposeAfterTask: one small structured request after an AI-terminal task — the task, Claude's answer
 *    and the changes it proposed (kinds + titles), never page text beyond what that task already sent.
 *    Claude returns 0–3 memories (none for a trivial task).
 *  - condense: "remember …" in the AI menu / "Remember this" on a selection → one proposal.
 *  - localProposal: /remember <text> — the person's own words, typed locally (no request).
 */
import { format } from 'date-fns'
import { useWorkspace } from '../../../store/store'
import { completeStructured, usesDemo } from '../client'
import { SENTENCE_TYPES, type MemoryProposal, type MemoryType } from './types'

const MAX_TEXT = 300
const MAX_BODY = 4000

const SCHEMA = {
  type: 'object',
  properties: {
    memories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: [...SENTENCE_TYPES] },
          text: { type: 'string' },
          topics: { type: 'array', items: { type: 'string' } },
          body: { type: 'string' },
        },
        required: ['type', 'text', 'topics', 'body'],
        additionalProperties: false,
      },
    },
  },
  required: ['memories'],
  additionalProperties: false,
}

const lang = () => (useWorkspace.getState().settings.language === 'de' ? 'German' : 'English')

const RULES = `A memory is one plain, self-contained sentence the person would want you to know in a FUTURE task:
- fact: a stable fact about their work (a project, a customer, a system, who does what).
- preference: how they like things done (language, tone, format, tools).
- decision: something they decided ("we use X for Y").
- procedure: a repeatable way of doing a task. Put the reusable template (steps, column lists, wording) into "body" as Markdown; "text" names the procedure in one sentence.
Topics: 0–3 short names of projects, customers or areas the memory belongs to (e.g. "CNSX", "Atlas"); none if unclear.
Never store secrets, passwords, tokens, personal data about third parties beyond names, or one-off details of this task.`

/** "AI terminal · 2026-10-05" */
export const terminalSource = () => `AI terminal · ${format(new Date(), 'yyyy-MM-dd')}`

function parse(raw: string, max: number, source: string): MemoryProposal[] {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  const list = data && typeof data === 'object' && Array.isArray((data as { memories?: unknown }).memories) ? ((data as { memories: unknown[] }).memories) : []
  const out: MemoryProposal[] = []
  for (const x of list) {
    if (!x || typeof x !== 'object') continue
    const r = x as Record<string, unknown>
    const text = typeof r.text === 'string' ? r.text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) : ''
    if (!text || out.some((p) => p.text.toLowerCase() === text.toLowerCase())) continue
    const type: MemoryType = (SENTENCE_TYPES as readonly string[]).includes(r.type as string) ? (r.type as MemoryType) : 'fact'
    const topics = Array.isArray(r.topics) ? [...new Set(r.topics.filter((t): t is string => typeof t === 'string').map((t) => t.trim().slice(0, 40)).filter(Boolean))].slice(0, 5) : []
    const body = typeof r.body === 'string' ? r.body.trim().slice(0, MAX_BODY) : ''
    out.push({ type, text, topics, body: type === 'procedure' ? body : '', source })
    if (out.length >= max) break
  }
  return out
}

/** Too little to learn from: a few words and nothing proposed. */
export function trivialTask(task: string, changes: number): boolean {
  return task.trim().split(/\s+/).length < 3 && !changes
}

/**
 * Proposals after an AI-terminal task: 0–3 memories. `changes`: what the task proposed or applied
 * ("New row · Final QA on staging · applied"). Throws AIError on failure (the caller shows it quietly).
 */
export async function proposeAfterTask(opts: { task: string; answer: string; changes: string[]; existing: string[]; signal?: AbortSignal }): Promise<MemoryProposal[]> {
  const system = `You decide what One — a notes and database workspace — should remember about the person after a task the AI agent did for them. ${RULES}
Propose 0 to 3 memories, only ones that will clearly help in later tasks. Propose none for a routine or trivial task, and none that repeat a memory they already have. Write them in ${lang()}.`
  const prompt = [
    `<task>\n${opts.task.trim().slice(0, 4000)}\n</task>`,
    `<agent_answer>\n${opts.answer.trim().slice(0, 4000) || '(no answer)'}\n</agent_answer>`,
    opts.changes.length ? `<changes>\n${opts.changes.slice(0, 30).join('\n')}\n</changes>` : '',
    opts.existing.length ? `<already_remembered>\n${opts.existing.slice(0, 40).map((x) => `- ${x}`).join('\n')}\n</already_remembered>` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  const raw = await completeStructured({ system, prompt, schema: SCHEMA, maxTokens: 1500, signal: opts.signal, maxRetries: 1, mcp: false })
  return parse(raw, 3, terminalSource())
}

/** "remember …" (AI menu) or a selection ("Remember this"): Claude condenses it into one proposal. */
export async function condense(opts: { text: string; from: 'request' | 'selection'; pageTitle: string; source: string; signal?: AbortSignal }): Promise<MemoryProposal[]> {
  if (usesDemo()) return [localProposal(opts.text, opts.source)]
  const system = `You turn what the person wants One — a notes and database workspace — to remember into exactly one memory. ${RULES}
Keep the person's meaning; do not add facts. Write it in ${lang()}.`
  const what = opts.from === 'selection' ? `They selected this passage on the page ${JSON.stringify(opts.pageTitle)} and chose "Remember this":` : 'They asked:'
  const prompt = `${what}\n<text>\n${opts.text.trim().slice(0, 8000)}\n</text>`
  const raw = await completeStructured({ system, prompt, schema: SCHEMA, maxTokens: 1500, signal: opts.signal, maxRetries: 1, mcp: false })
  const out = parse(raw, 1, opts.source)
  return out.length ? out : [localProposal(opts.text, opts.source)]
}

/** The type a sentence most likely has (for proposals typed by the person). */
export function guessType(text: string): MemoryType {
  const s = text.toLowerCase()
  if (/\b(always|never|prefer|rather|please use|immer|nie|niemals|lieber|bevorzug|bitte (?:immer|nur))/.test(s)) return 'preference'
  if (/\b(steps?|template|checklist|how to|procedure|schritte?|vorlage|ablauf|vorgehen|checkliste)\b/.test(s)) return 'procedure'
  if (/\b(we decided|decided|we use|we chose|beschlossen|entschieden|wir nutzen|wir verwenden|festgelegt)\b/.test(s)) return 'decision'
  return 'fact'
}

/** "remember that …" / "merk dir, dass …" → the text to remember ('' when there is none). */
export function stripRemember(text: string): string {
  return text
    .replace(/^\s*(?:\/?(?:remember|merken|merke?\s+dir|merk's\s+dir))\b[\s:,.–-]*/i, '')
    .replace(/^(?:that|dass)\b[\s,]*/i, '')
    .trim()
}

/** Does a free request ask One to remember something ("merk dir …", "remember …")? */
export const isRememberRequest = (text: string): boolean => /^\s*(?:remember|merke?\s+dir|merk's\s+dir)\b/i.test(text) && stripRemember(text).length > 2

/** The person's own words as a proposal (no request). */
export function localProposal(text: string, source: string): MemoryProposal {
  const clean = stripRemember(text).replace(/\s+/g, ' ').trim()
  const sentence = clean ? clean[0].toUpperCase() + clean.slice(1) : ''
  return { type: guessType(sentence), text: sentence.slice(0, MAX_TEXT), topics: [], body: '', source }
}
