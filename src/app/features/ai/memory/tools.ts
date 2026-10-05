/**
 * One memory — the agent tools (AI terminal; custom agents get `recall` only). Offered while the memory
 * is in use (switched on, a memory database exists).
 *  - recall(query): search the memory — a Procedure comes with its template.
 *  - remember(type, text, topics?, body?): stages a memory (change kind 'memory'), reviewed and applied
 *    like any other change; a near-identical one is staged as an update of it.
 */
import { newId } from '../../../lib/ids'
import { t } from '../../../i18n'
import { ToolInputError, type AgentTool } from '../agent/tools'
import { memoryBody, searchMemories } from './read'
import { findDuplicate } from './save'
import { terminalSource } from './propose'
import { MEMORY_TYPES, type MemoryType } from './types'

const q = (s: string) => JSON.stringify(s)

export const recallTool: AgentTool = {
  name: 'recall',
  write: false,
  description:
    "Search the person's One memory — standing facts, preferences, decisions and procedures (templates) they asked you to keep. The most relevant ones already come with each task in <one_memory>; call this for more, e.g. a procedure for the kind of task at hand. Returns each memory's id, type, sentence, topics and, for procedures, the template.",
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Keywords, e.g. "weekly report CNSX" or a topic.' },
      limit: { type: 'integer', description: 'Maximum number of memories (1–20, default 8).' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  run(input) {
    const query = typeof input.query === 'string' ? input.query.trim().slice(0, 300) : ''
    if (!query) throw new ToolInputError('Missing required parameter "query".')
    const n = typeof input.limit === 'number' ? Math.max(1, Math.min(20, Math.floor(input.limit))) : 8
    const hits = searchMemories(query, n)
    if (!hits.length) return { content: `No memory matches ${q(query)}.`, summary: t('features.agent.res.results', { count: 0 }), state: 'ok' }
    const lines = hits.map((m) => {
      const head = `- id: ${m.id} · ${m.type}${m.active ? '' : ' (inactive: do not follow)'} · ${q(m.text)}${m.topics.length ? ` · topics: ${m.topics.join(', ')}` : ''}${m.source ? ` · source: ${m.source}` : ''}`
      const body = m.type === 'procedure' ? memoryBody(m.id) : ''
      return body ? `${head}\n  Template:\n${body.replace(/^/gm, '  ')}` : head
    })
    return { content: `${hits.length} memories for ${q(query)}:\n${lines.join('\n')}`, summary: t('features.agent.res.results', { count: hits.length }), state: 'ok' }
  },
}

export const rememberTool: AgentTool = {
  name: 'remember',
  write: true,
  description:
    "Propose a memory for the person's One memory: one plain sentence they would want you to know in future tasks. Use it when they ask you to remember something, or state a lasting preference, decision or way of doing things. Like every change it is staged — the person confirms it. Types: fact, preference, decision, procedure (put a procedure's reusable template — steps, columns, wording — into body as Markdown). Never store secrets or one-off details.",
  input_schema: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: [...MEMORY_TYPES] },
      text: { type: 'string', description: 'The memory as one plain sentence.' },
      topics: { type: 'array', items: { type: 'string' }, description: 'Up to 3 short project / customer / area names, e.g. ["CNSX"].' },
      body: { type: 'string', description: 'Procedures only: the template in Markdown.' },
    },
    required: ['type', 'text'],
    additionalProperties: false,
  },
  run(input, stage) {
    const text = typeof input.text === 'string' ? input.text.replace(/\s+/g, ' ').trim() : ''
    if (!text) throw new ToolInputError('Missing required parameter "text".')
    if (text.length > 300) throw new ToolInputError(`"text" is too long (${text.length} characters, at most 300): one plain sentence.`)
    const type = (MEMORY_TYPES as readonly string[]).includes(String(input.type)) ? (input.type as MemoryType) : null
    if (!type) throw new ToolInputError(`"type" must be one of ${MEMORY_TYPES.join(', ')}.`)
    const topics = Array.isArray(input.topics) ? [...new Set(input.topics.filter((x): x is string => typeof x === 'string').map((x) => x.trim().slice(0, 40)).filter(Boolean))].slice(0, 5) : []
    const body = type === 'procedure' && typeof input.body === 'string' ? input.body.trim().slice(0, 4000) : ''
    const dup = findDuplicate(text)
    const c = stage.add({ kind: 'memory', pageId: dup?.id ?? newId(), title: text, ...(body ? { markdown: body } : {}), memory: { type, text, topics, body, source: terminalSource(), updates: dup?.id ?? null } })
    return {
      content: `Staged as change #${c.n}: ${dup ? `an update of the near-identical memory ${q(dup.text)} (id: ${dup.id})` : 'a new memory'}. Nothing is saved until the person confirms it.`,
      summary: t('features.agent.res.staged', { n: c.n }),
      state: 'staged',
      changeId: c.id,
    }
  },
}
