/**
 * Workspace agent — session actions: run a task, stop it, review staged changes (apply /
 * discard), undo an applied batch, start over. The API conversation lives here (this tab only).
 */
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { format } from 'date-fns'
import { useWorkspace } from '../../../store/store'
import { useUI } from '../../../store/ui'
import { parseHash } from '../../../lib/router'
import type { ID } from '../../../store/types'
import { t } from '../../../i18n'
import { AIError, resolveModel } from '../client'
import { attachMcp, currentSetup, setupKey, type McpSetup } from '../mcp-servers/config'
import { applyChanges, type ApplyResult } from './apply'
import { runAgent, taskMessage, type RunHooks } from './run'
import { initialAgentState, setStopHandler, useAgent } from './state'
import type { StageApi } from './tools'
import type { AgentStatus, AgentStep, AgentTurn, StagedChange } from './types'

const set = useAgent.setState
const get = useAgent.getState

/** The API conversation of this session (append-only). */
let history: BetaMessageParam[] = []
/** staged row id → real id of rows created by applying */
let rowIds: Record<string, ID> = {}
/** change statuses Claude has been told about (to report what the user did in between) */
let reported: Record<string, StagedChange['status']> = {}
let controller: AbortController | null = null
let seq = 0
/**
 * The MCP setup of this conversation: pinned at its first task, so the system prompt and the tool
 * list stay the same for every later request (prompt cache, thinking). "New task" picks up changes.
 */
let mcpSetup: McpSetup | null = null

const nextId = (p: string) => `${p}${(++seq).toString(36)}`

/** Singular / plural message ("<key>.one" / "<key>.other"). */
export const tn = (key: string, count: number) => t(`${key}.${count === 1 ? 'one' : 'other'}`, { count })

export const stage: StageApi = {
  list: () => get().changes,
  add(change) {
    const changes = get().changes
    const c: StagedChange = { ...change, id: nextId('c'), n: changes.length + 1, status: 'pending' }
    set({ changes: [...changes, c] })
    return c
  },
  update(id, patch) {
    let out: StagedChange | undefined
    set({ changes: get().changes.map((c) => (c.id === id ? (out = { ...c, ...patch }) : c)) })
    if (!out) throw new Error(`no staged change ${id}`)
    return out
  },
  resolve: (id) => rowIds[id] ?? id,
}

/* ------------------------------------------------------------------ */
/* Running                                                             */
/* ------------------------------------------------------------------ */

function context(): string {
  const s = useWorkspace.getState()
  const now = new Date()
  const lines = [
    `Today: ${format(now, 'EEEE, yyyy-MM-dd')} (local time ${format(now, 'HH:mm')})`,
    `Workspace: ${JSON.stringify(s.settings.workspaceName || 'Workspace')} · the user's interface language: ${s.settings.language === 'de' ? 'German' : 'English'}`,
  ]
  const route = parseHash(window.location.hash)
  const open = route.name === 'page' ? s.pages[route.id] : undefined
  if (open && !open.trashed) lines.push(`Open page: ${JSON.stringify(open.title.trim() || 'Untitled')} (id: ${open.id})`)
  // what the user did with earlier proposals since Claude last heard about them
  const news: string[] = []
  for (const c of get().changes) {
    if (reported[c.id] === c.status) continue
    if (c.status === 'applied') news.push(`#${c.n} applied`)
    else if (c.status === 'discarded') news.push(`#${c.n} discarded`)
    else if (c.status === 'pending' && reported[c.id]) news.push(`#${c.n} back to pending (undone)`)
    reported[c.id] = c.status
  }
  if (news.length) lines.push(`Since the last task the user reviewed earlier changes: ${news.join(', ')}.`)
  const pending = get().changes.filter((c) => c.status === 'pending').length
  if (pending) lines.push(`${pending} staged change(s) from earlier tasks are still waiting for review.`)
  return lines.join('\n')
}

function patchStep(id: string, patch: Partial<AgentStep>) {
  set((s) => ({ steps: s.steps.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))
}

function patchTurn(n: number, patch: Partial<AgentTurn>) {
  set((s) => ({ turns: s.turns.map((x) => (x.n === n ? { ...x, ...patch } : x)) }))
}

/** Run the task in the field (or `raw`). One task at a time. */
export async function runTask(raw?: string): Promise<void> {
  const task = (raw ?? get().draft).trim()
  if (!task || get().status === 'running') return
  const n = get().turns.length + 1
  const ac = new AbortController()
  controller = ac
  setStopHandler(() => ac.abort())
  set((s) => ({ status: 'running', draft: '', autorun: false, live: '', calls: 0, turns: [...s.turns, { n, task, startedAt: Date.now(), status: 'running', answer: '' }] }))
  if (!history.length || !mcpSetup) {
    mcpSetup = currentSetup()
    set({ mcp: { key: setupKey(mcpSetup), names: mcpSetup.servers.map((x) => x.name) } })
  }
  const setup = mcpSetup

  let answer = ''
  // streamed text is batched per frame
  let buf = ''
  let raf = 0
  const flush = () => {
    cancelAnimationFrame(raf)
    raf = 0
    if (buf) {
      const add = buf
      buf = ''
      set((s) => ({ live: s.live + add }))
    }
  }
  const note = (text: string) => set((s) => ({ steps: [...s.steps, { id: nextId('s'), turn: n, kind: 'note', text, state: 'ok', startedAt: Date.now() }] }))

  const hooks: RunHooks = {
    toolStart(tool, arg) {
      const id = nextId('s')
      set((s) => ({ calls: s.calls + 1, steps: [...s.steps, { id, turn: n, kind: 'tool', tool, arg, state: 'run', startedAt: Date.now() }] }))
      return id
    },
    toolEnd(id, o) {
      patchStep(id, { state: o.state, result: o.summary || undefined, changeId: o.changeId, ms: o.ms })
    },
    note,
    text(delta) {
      buf += delta
      if (!raf) raf = requestAnimationFrame(flush)
    },
    textDone(kind) {
      flush()
      const text = get().live.trim()
      set({ live: '' })
      if (!text) return
      if (kind === 'note') note(text)
      else {
        answer = answer ? `${answer}\n\n${text}` : text
        patchTurn(n, { answer })
      }
    },
    usage(u) {
      const price = resolveModel(useWorkspace.getState().settings.aiModel).price
      const input = u.input_tokens ?? 0
      const output = u.output_tokens ?? 0
      const cacheRead = u.cache_read_input_tokens ?? 0
      const cacheWrite = u.cache_creation_input_tokens ?? 0
      const usd = (input * price.input + cacheWrite * price.input * 1.25 + cacheRead * price.cacheRead + output * price.output) / 1_000_000
      set((s) => ({
        usage: {
          requests: s.usage.requests + 1,
          input: s.usage.input + input,
          output: s.usage.output + output,
          cacheRead: s.usage.cacheRead + cacheRead,
          cacheWrite: s.usage.cacheWrite + cacheWrite,
          usd: s.usage.usd + usd,
        },
      }))
    },
    history(messages) {
      history = messages
    },
    limit() {
      note(t('features.agent.limitNote'))
    },
    mcp(call) {
      const step = get().steps.find((x) => x.mcp?.id === call.id)
      const mcp = { id: call.id, server: call.server, tool: call.tool, error: call.error }
      if (step) patchStep(step.id, { state: call.state, arg: call.arg || step.arg, mcp, ms: call.state === 'run' ? undefined : Date.now() - step.startedAt })
      else set((s) => ({ steps: [...s.steps, { id: nextId('s'), turn: n, kind: 'mcp', arg: call.arg, state: call.state, startedAt: Date.now(), mcp }] }))
    },
  }

  const finish = (status: AgentStatus, error?: AgentTurn['error']) => {
    flush()
    // text that was still streaming when the run stopped is kept as the (partial) answer
    const rest = get().live.trim()
    if (rest) answer = answer ? `${answer}\n\n${rest}` : rest
    set((s) => ({
      status,
      live: '',
      steps: s.steps.map((x) => (x.state === 'run' ? { ...x, state: 'err' } : x)),
    }))
    patchTurn(n, { status, endedAt: Date.now(), answer, ...(error ? { error } : {}) })
  }

  try {
    const mcp = setup.servers.length ? await attachMcp(setup) : null
    const end = await runAgent({ history, user: taskMessage(history, task, context()), stage, signal: ac.signal, hooks, mcp })
    if (end === 'max_tokens') finish('error', { code: 'max_tokens', message: t('features.agent.err.maxTokens') })
    else finish(end === 'limit' ? 'limit' : 'done')
  } catch (e) {
    const err = e instanceof AIError ? e : new AIError('unknown', e instanceof Error ? e.message : String(e))
    if (err.code === 'aborted') finish('stopped')
    else finish('error', { code: err.code, message: err.message })
  } finally {
    if (controller === ac) {
      controller = null
      setStopHandler(null)
    }
  }
}

export function stopTask() {
  controller?.abort()
}

/** Forget the session: conversation, steps and every proposal that was not applied. */
export function newTask() {
  controller?.abort()
  controller = null
  setStopHandler(null)
  history = []
  rowIds = {}
  reported = {}
  mcpSetup = null
  set({ ...initialAgentState(), draft: '', autorun: false })
}

/* ------------------------------------------------------------------ */
/* Review                                                              */
/* ------------------------------------------------------------------ */

/** Apply the given changes (default: every pending one). One Undo toast reverts the batch. */
export async function applyStaged(ids?: string[]): Promise<void> {
  const all = get().changes
  const targets = ids ? all.filter((c) => ids.includes(c.id)) : all.filter((c) => c.status === 'pending')
  if (!targets.length) return
  const res = await applyChanges(targets, all, stage.resolve)
  Object.assign(rowIds, res.rowIds)
  set((s) => ({
    changes: s.changes.map((c) => {
      if (res.applied.includes(c.id)) return { ...c, status: 'applied', error: undefined }
      const f = res.failed.find((x) => x.id === c.id)
      return f ? { ...c, status: 'failed', error: f.error } : c
    }),
  }))
  const ui = useUI.getState()
  if (res.applied.length)
    ui.toast({
      message: tn('features.agent.toast.applied', res.applied.length),
      kind: 'success',
      action: { label: t('common.undo'), run: () => undoBatch(res) },
      timeout: 10_000,
    })
  if (res.failed.length) ui.toast({ message: tn('features.agent.toast.failed', res.failed.length), kind: 'error' })
}

function undoBatch(res: ApplyResult) {
  const kept = res.undo()
  for (const staged of Object.keys(res.rowIds)) delete rowIds[staged]
  set((s) => ({ changes: s.changes.map((c) => (res.applied.includes(c.id) ? { ...c, status: 'pending' } : c)) }))
  useUI.getState().toast(kept ? tn('features.agent.toast.undoneKept', kept) : t('features.agent.toast.undone'))
}

/** Discard a proposal (and the proposals that build on it). */
export function discardStaged(id: string) {
  const drop = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const c of get().changes) {
      if (!c.dependsOn || !drop.has(c.dependsOn) || drop.has(c.id) || c.status === 'applied') continue
      drop.add(c.id)
      grew = true
    }
  }
  set((s) => ({ changes: s.changes.map((c) => (drop.has(c.id) && c.status !== 'applied' ? { ...c, status: 'discarded' } : c)) }))
}

export function discardAllStaged() {
  set((s) => ({ changes: s.changes.map((c) => (c.status === 'pending' || c.status === 'failed' ? { ...c, status: 'discarded' } : c)) }))
}

/** Bring a discarded proposal back (and the one it builds on). */
export function restoreStaged(id: string) {
  const back = new Set<string>()
  let cur = get().changes.find((c) => c.id === id)
  while (cur && cur.status === 'discarded' && !back.has(cur.id)) {
    back.add(cur.id)
    cur = cur.dependsOn ? get().changes.find((c) => c.id === cur!.dependsOn) : undefined
  }
  set((s) => ({ changes: s.changes.map((c) => (back.has(c.id) ? { ...c, status: 'pending' } : c)) }))
}

/** The page a change points at, once it exists (for "Open"). */
export function changeTarget(c: StagedChange): ID | null {
  const id = stage.resolve(c.pageId)
  const p = useWorkspace.getState().pages[id]
  return p && !p.trashed ? id : null
}
