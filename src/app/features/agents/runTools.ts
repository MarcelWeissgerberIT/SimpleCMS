/**
 * Custom agents — the tools of a run that are about the agent itself, not the workspace (browser runner):
 *  - agent_state_get / agent_state_set: a small memory of its own between runs (cursors, last seen ids …), JSON
 *    ≤ STATE_BYTES, per device (IndexedDB "one-agents", runs.ts; never synced). Bookkeeping, not a change: never
 *    staged for review — saved when the run ends ok (or with proposals), a failed or budget run keeps the old state.
 *  - notify_me: a note for the person's inbox ("New comment on #8215"). Delivered when the run ends ok: each note
 *    becomes an inbox item of kind 'agent' (per device, IndexedDB "one-inbox"), at most NOTES_PER_RUN per run (the
 *    rest summed up in the last one); a browser notification only if the person switched them on for the inbox.
 * Server agents have the state tools (server/src/agents) but no notify_me: the inbox lives on each device.
 */
import { format } from 'date-fns'
import { useWorkspace } from '../../store/store'
import { isEffectivelyTrashed } from '../../store/selectors'
import type { CustomAgent, ID } from '../../store/types'
import { activeWorkspace } from '../../cloud'
import { t } from '../../i18n'
import { ToolInputError, type AgentTool, type StageApi } from '../ai/agent/tools'
import { addInboxItems, useInbox, wsKey, type InboxItem } from '../inbox/state'
import { showNotification } from '../inbox/notify'
import { openInbox, openInboxItem } from '../inbox/engine'
import { scopeFilter, scopeText } from './scope'
import { agentLabel } from './label'
import type { AgentState } from './runs'
import type { AgentRun } from './types'

/** agent_state_set: the JSON text at most (UTF-8 bytes). */
export const STATE_BYTES = 4096
/** notify_me: one note at most (characters). */
export const NOTE_CHARS = 300
/** Inbox items one run leaves at most (more notes are summed up in the last one). */
export const NOTES_PER_RUN = 10
/** Notes one run may leave at all. */
export const NOTES_MAX = 50

export interface AgentNote {
  text: string
  /** the page / row it is about — a staged row's id until the run's changes are applied */
  pageId: ID | null
}

/** What the run's own tools collect; read by exec.ts when the run ends. */
export interface RunExtras {
  /** the state as the run started (null: nothing saved) */
  saved: AgentState | null
  /** set in this run (JSON text), saved when it ends ok — undefined: not set */
  pending?: string
  notes: AgentNote[]
}

const bytes = (s: string) => new TextEncoder().encode(s).length
const q = (s: string) => JSON.stringify(s)
const isStagedCreate = (stage: StageApi, id: string) => stage.list().some((c) => (c.kind === 'create_page' || c.kind === 'create_row') && c.pageId === id && c.status !== 'discarded')

/** The JSON text agent_state_set was given (a JSON string, or a JSON value as is), compact; throws for Claude to fix. */
export function stateJson(raw: unknown): string {
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      throw new ToolInputError('"json" must be valid JSON (an object, an array, a string, a number …).')
    }
  }
  if (value === undefined) throw new ToolInputError('Missing required parameter "json".')
  const text = JSON.stringify(value)
  if (typeof text !== 'string') throw new ToolInputError('"json" must be a JSON value.')
  const n = bytes(text)
  if (n > STATE_BYTES) throw new ToolInputError(`The state is too large (${n} bytes, at most ${STATE_BYTES}): keep only cursors and ids, not content.`)
  return text
}

/** "Last successful run: …" for the run's context (null run = the first one). */
export function lastRunLine(last: Pick<AgentRun, 'startedAt'> | null): string {
  if (!last) return 'Last successful run: none — this is the first run.'
  return `Last successful run: ${new Date(last.startedAt).toISOString()} (${format(last.startedAt, 'EEEE, yyyy-MM-dd HH:mm')} local time). Look at what changed since then.`
}

/**
 * The tools of one run: agent_state_get / _set when `state`, notify_me when `notes` (browser agents) — each only while
 * an active integration profile unlocks it (exec.ts decides).
 */
export function runTools(agent: Pick<CustomAgent, 'scope'>, extras: RunExtras, opts: { notes?: boolean; state?: boolean } = {}): AgentTool[] {
  const stateGet: AgentTool = {
    name: 'agent_state_get',
    write: false,
    description:
      'Read your own saved state: the small JSON value an earlier run of yours saved with agent_state_set (cursors, the last ids or times you saw, counts). Use it at the start of a recurring job to find what is new since then. "Nothing saved" means a first run, or that no run saved anything yet.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run() {
      if (extras.pending !== undefined)
        return { content: `State set in this run (saved when the run ends without an error):\n${extras.pending}`, summary: t('features.agents.state.res.pending'), state: 'ok' }
      if (!extras.saved) return { content: 'Nothing saved yet: this is the first run that keeps a state.', summary: t('features.agents.state.res.none'), state: 'ok' }
      return {
        content: `Saved state (from the run of ${new Date(extras.saved.at).toISOString()}):\n${extras.saved.json}`,
        summary: t('features.agents.state.res.bytes', { n: bytes(extras.saved.json) }),
        state: 'ok',
      }
    },
  }
  const stateSet: AgentTool = {
    name: 'agent_state_set',
    write: false,
    description: `Save your state for the next run: one JSON value (at most ${STATE_BYTES} bytes) that replaces the saved one — e.g. {"cursor": "2026-10-08T06:00:00Z", "seen": ["#8215"]}. It is kept only if this run ends without an error or a budget stop (then the old state stays), so save it once the work it stands for is done; the last call of a run wins. Cursors and ids only — never secrets or page content.`,
    input_schema: {
      type: 'object',
      properties: { json: { type: 'string', description: 'The state as JSON text, e.g. {"cursor":"2026-10-08T06:00:00Z"}.' } },
      required: ['json'],
      additionalProperties: false,
    },
    run(input) {
      const text = stateJson(input.json)
      extras.pending = text
      return { content: `State set (${bytes(text)} bytes). It is saved when this run ends without an error; the next run reads it with agent_state_get.`, summary: t('features.agents.state.res.bytes', { n: bytes(text) }), state: 'ok' }
    },
  }
  const state = opts.state === false ? [] : [stateGet, stateSet]
  if (!opts.notes) return state
  const notify: AgentTool = {
    name: 'notify_me',
    write: false,
    description: `Leave the person a short note in their One inbox — news they should know or act on, e.g. "New comment on #8215" or "3 items became ready". One plain sentence (at most ${NOTE_CHARS} characters), optionally with page_id: the page or row it is about (it opens from the inbox). Notes are delivered when the run ends without an error; at most ${NOTES_PER_RUN} per run show up on their own (more are summed up in one). Only for real news — never to say that nothing changed: your report covers the run.`,
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The note: one plain sentence.' },
        page_id: { type: 'string', description: 'Optional: the id of the page or row the note is about.' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    run(input, stage) {
      const text = typeof input.text === 'string' ? input.text.replace(/\s+/g, ' ').trim() : ''
      if (!text) throw new ToolInputError('Missing required parameter "text".')
      if (text.length > NOTE_CHARS) throw new ToolInputError(`"text" is too long (${text.length} characters, at most ${NOTE_CHARS}): one plain sentence.`)
      if (extras.notes.length >= NOTES_MAX) throw new ToolInputError(`This run left ${NOTES_MAX} notes already — put the rest into your report.`)
      let pageId: ID | null = null
      const raw = typeof input.page_id === 'string' ? input.page_id.trim() : ''
      if (raw) {
        if (!isStagedCreate(stage, raw)) {
          const real = stage.resolve(raw)
          const pages = useWorkspace.getState().pages
          const page = pages[real]
          if (!page || page.trashed || isEffectivelyTrashed(pages, real)) throw new ToolInputError(`No page or row with the id ${q(raw)}. Use an id a tool returned, or leave page_id out.`)
          const visible = scopeFilter(agent)
          if (visible && !visible(real)) throw new ToolInputError(`${q(page.title.trim() || 'Untitled')} (id: ${raw}) is outside this agent's scope: refused. It may only use ${scopeText(agent)}.`)
        }
        pageId = raw
      }
      extras.notes.push({ text, pageId })
      return { content: `Noted (#${extras.notes.length}). It reaches the inbox when this run ends without an error.`, summary: t('features.agents.notes.res.noted'), state: 'ok' }
    },
  }
  return [...state, notify]
}

/**
 * Deliver a finished run's notes to this device's inbox (kind 'agent'): ≤ NOTES_PER_RUN items — with more notes the
 * last item sums up the rest. `resolve`: staged row id → the id it got when applied. Returns how many items.
 */
export async function deliverNotes(agent: Pick<CustomAgent, 'id' | 'name'>, run: Pick<AgentRun, 'id'>, notes: AgentNote[], resolve: (id: ID) => ID): Promise<number> {
  if (!notes.length) return 0
  const pages = useWorkspace.getState().pages
  const live = (id: ID | null): ID => {
    if (!id) return ''
    const real = resolve(id)
    return pages[real] && !pages[real].trashed && !isEffectivelyTrashed(pages, real) ? real : ''
  }
  const now = Date.now()
  const item = (n: number, text: string, pageId: ID): InboxItem => ({ id: `g:${run.id}:${n}`, kind: 'agent', pageId, at: now + n / 1000, excerpt: text, agentId: agent.id, runId: run.id })
  const own = notes.length > NOTES_PER_RUN ? notes.slice(0, NOTES_PER_RUN - 1) : notes
  const items = own.map((note, i) => item(i + 1, note.text, live(note.pageId)))
  if (notes.length > NOTES_PER_RUN) {
    const rest = notes.slice(NOTES_PER_RUN - 1)
    const joined = rest.map((n) => n.text).join(' · ')
    const text = `${t('features.agents.notes.more', { count: rest.length })} ${joined}`
    items.push(item(NOTES_PER_RUN, text.length > 600 ? `${text.slice(0, 599)}…` : text, ''))
  }
  const added = await addInboxItems(wsKey(activeWorkspace()), items)
  if (!added) return 0
  // a browser notification only when the person switched them on (inbox settings)
  if (useInbox.getState().data.notify) {
    const label = agentLabel(`agent:${agent.id}`) ?? agent.name
    const first = items[0]
    if (items.length === 1) showNotification(label, first.excerpt ?? '', first.id, () => openInboxItem(first))
    else showNotification(label, t('features.agents.notes.notify', { count: notes.length }), `one-agent-${run.id}`, openInbox)
  }
  return items.length
}
