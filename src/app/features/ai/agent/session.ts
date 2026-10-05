/**
 * AI terminal (workspace agent) — session actions: run a task or a /command, stop it, review
 * staged changes (apply / discard), undo an applied batch, start over. The API conversation lives
 * here (this tab only) and goes on while the terminal is hidden.
 */
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { format } from 'date-fns'
import { useWorkspace } from '../../../store/store'
import { useUI } from '../../../store/ui'
import { parseHash } from '../../../lib/router'
import type { ID } from '../../../store/types'
import { t } from '../../../i18n'
import { AIError, resolveModel } from '../client'
import { useCloud } from '../../../cloud'
import { attachMcp, currentSetup, setupKey, type McpSetup } from '../mcp-servers/config'
import { applyChanges, type ApplyResult } from './apply'
import { runAgent, taskMessage, type RunHooks } from './run'
import { initialAgentState, openAgent, setStopHandler, useAgent, type EchoEntry } from './state'
import { loadHistory, pushHistory } from './history'
import { parseCommand } from './commands'
import type { StageApi } from './tools'
import { depsOf, type AgentStatus, type AgentStep, type AgentTurn, type StagedChange, type TermMention, type TermRef, type TurnContext } from './types'

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

/** The page the context chip shows: the open page, unless its chip was removed. */
export function contextPageId(): string | null {
  const route = parseHash(window.location.hash)
  const page = route.name === 'page' ? useWorkspace.getState().pages[route.id] : undefined
  if (!page || page.trashed || useAgent.getState().pageOff === page.id) return null
  return page.id
}

const q = (s: string) => JSON.stringify(s)

function context(refs: TermRef[], mentions: TermMention[]): string {
  const s = useWorkspace.getState()
  const now = new Date()
  const lines = [
    `Today: ${format(now, 'EEEE, yyyy-MM-dd')} (local time ${format(now, 'HH:mm')})`,
    `Workspace: ${q(s.settings.workspaceName || 'Workspace')} · the user's interface language: ${s.settings.language === 'de' ? 'German' : 'English'}`,
  ]
  const openId = contextPageId()
  const open = openId ? s.pages[openId] : undefined
  if (open) lines.push(`Open page: ${q(open.title.trim() || 'Untitled')} (id: ${open.id})`)
  if (mentions.length) lines.push(`The user pointed at: ${mentions.map((m) => `${q(m.title)} (id: ${m.id}, ${m.kind})`).join('; ')}`)
  if (refs.length) {
    lines.push(`References — passages the user selected and sent along with this task (${refs.length}):`)
    for (const r of refs) {
      const body = r.markdown.replace(/<\/reference>/gi, '<\\/reference>')
      lines.push(`<reference page=${q(r.title)} page_id=${q(r.pageId)} lines="${r.lines}">\n${body}${r.clipped ? '\n[Cut: the selection is longer. Read the page with read_page for the rest.]' : ''}\n</reference>`)
    }
  }
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

/**
 * What a task runs with: the MCP setup and the task text Claude gets. The one place where the
 * user's task text meets the MCP choice (client.ts / mcp-servers decide centrally) — today the
 * setup is pinned per conversation (system prompt and tool list stay the same for every later
 * request: prompt cache, thinking) and the text goes as typed.
 */
function prepareTask(task: string): { setup: McpSetup; prompt: string } {
  if (!history.length || !mcpSetup) {
    mcpSetup = currentSetup()
    set({ mcp: { key: setupKey(mcpSetup), names: mcpSetup.servers.map((x) => x.name) } })
  }
  return { setup: mcpSetup, prompt: task }
}

/** Run the task in the prompt (or `raw`). One task at a time. */
export async function runTask(raw?: string): Promise<void> {
  const task = (raw ?? get().draft).trim()
  if (!task || get().status === 'running') return
  const n = get().turns.length + 1
  const ac = new AbortController()
  controller = ac
  setStopHandler(() => ac.abort())
  pushHistory(task)
  // the chips go along with this task: references, the mentions still in the text, the open page
  const refs = get().refs
  const mentions = get().mentions.filter((m) => task.includes(`@${m.title}`))
  const pageId = contextPageId()
  const ctx: TurnContext = { refs: refs.length, mentions: mentions.map((m) => m.title), ...(pageId ? { page: useWorkspace.getState().pages[pageId]?.title.trim() || t('common.untitled') } : {}) }
  const text = context(refs, mentions)
  const { setup, prompt } = prepareTask(task)
  set((s) => ({
    status: 'running',
    draft: '',
    autorun: false,
    live: '',
    calls: 0,
    unseen: null,
    refs: [],
    mentions: [],
    turns: [...s.turns, { n, task, startedAt: Date.now(), status: 'running', answer: '', context: ctx }],
  }))

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
    if (!get().open && status !== 'stopped') notifyHidden(status)
  }

  try {
    const mcp = setup.servers.length ? await attachMcp(setup) : null
    const end = await runAgent({ history, user: taskMessage(history, prompt, text), stage, signal: ac.signal, hooks, mcp })
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

/** A task ended while the terminal was hidden: the status bar keeps it lit, a toast tells. */
function notifyHidden(status: AgentStatus) {
  const failed = status === 'error'
  set({ unseen: failed ? 'error' : 'done' })
  const pending = get().changes.filter((c) => c.status === 'pending').length
  const message = failed ? t('features.agent.toast.hiddenError') : pending ? tn('features.agent.toast.hiddenReview', pending) : t('features.agent.toast.hiddenDone')
  useUI.getState().toast({ message, kind: failed ? 'error' : 'success', action: { label: t('features.agent.toast.show'), run: () => openAgent() }, timeout: 10_000 })
}

export function stopTask() {
  controller?.abort()
}

/* ------------------------------------------------------------------ */
/* Prompt input: a task or a /command                                  */
/* ------------------------------------------------------------------ */

function echo(input: string, kind: EchoEntry['kind'], data?: EchoEntry['data']) {
  set((s) => ({ echo: [...s.echo, { id: nextId('e'), after: s.turns.length, input, kind, ...(data ? { data } : {}) }].slice(-40) }))
}

const info = (input: string, key: string, vars?: Record<string, string | number>) => echo(input, 'info', { key, ...(vars ? { vars } : {}) })

/** Run what is in the prompt: a /command right here, anything else as a task for Claude. */
export async function submitPrompt(raw?: string): Promise<void> {
  const input = (raw ?? get().draft).trim()
  if (!input) return
  const cmd = parseCommand(input)
  if (!cmd) return runTask(input)
  pushHistory(input)
  set({ draft: '' })
  const running = get().status === 'running'
  const pending = get().changes.filter((c) => c.status === 'pending' || c.status === 'failed').length
  switch (cmd) {
    case 'new':
      newTask()
      return
    case 'stop':
      if (running) stopTask()
      else info(input, 'features.agent.echo.notRunning')
      return
    case 'apply':
      if (running) return info(input, 'features.agent.echo.wait')
      if (!pending) return info(input, 'features.agent.echo.nothingPending')
      if (useCloud.getState().readOnly) return info(input, 'features.agent.review.readOnly')
      await applyStaged()
      return
    case 'discard':
      if (running) return info(input, 'features.agent.echo.wait')
      if (!pending) return info(input, 'features.agent.echo.nothingPending')
      discardAllStaged()
      info(input, `features.agent.echo.discarded.${pending === 1 ? 'one' : 'other'}`, { count: pending })
      return
    case 'history': {
      // the prompts before this one
      const list = loadHistory()
      if (list[list.length - 1] === input) list.pop()
      echo(input, 'history', { list: list.slice(-20) })
      return
    }
    case 'help':
      echo(input, 'help')
      return
    case 'mcp': {
      const names = get().mcp?.names ?? currentSetup().servers.map((x) => x.name)
      echo(input, 'mcp', { list: names, key: get().mcp ? 'pinned' : 'next' })
      return
    }
    case 'cost':
      echo(input, 'cost', { usage: { ...get().usage } })
      return
    default:
      info(input, 'features.agent.echo.unknown', { cmd: input.split(/\s/)[0] })
  }
}

/** Forget the session: conversation, steps and every proposal that was not applied. */
export function newTask() {
  controller?.abort()
  controller = null
  setStopHandler(null)
  history = []
  rowIds = {}
  reported = {}
  lastBatch = null
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
  if (res.applied.length) lastBatch = res
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

/** The batch the last apply wrote (for `u` in the review list). */
let lastBatch: ApplyResult | null = null

/** Undo the last applied batch (`u` in the review list); false when there is nothing to undo. */
export function undoLastBatch(): boolean {
  const res = lastBatch
  if (!res || !get().changes.some((c) => res.applied.includes(c.id) && c.status === 'applied')) return false
  undoBatch(res)
  return true
}

function undoBatch(res: ApplyResult) {
  if (lastBatch === res) lastBatch = null
  const kept = res.undo()
  for (const staged of Object.keys(res.rowIds)) delete rowIds[staged]
  set((s) => ({ changes: s.changes.map((c) => (res.applied.includes(c.id) && c.status === 'applied' ? { ...c, status: 'pending' } : c)) }))
  useUI.getState().toast(kept ? tn('features.agent.toast.undoneKept', kept) : t('features.agent.toast.undone'))
}

/** Discard proposals (and the proposals that build on them). */
export function discardStaged(id: string | string[]) {
  const drop = new Set(Array.isArray(id) ? id : [id])
  let grew = true
  while (grew) {
    grew = false
    for (const c of get().changes) {
      if (drop.has(c.id) || c.status === 'applied' || !depsOf(c).some((d) => drop.has(d))) continue
      drop.add(c.id)
      grew = true
    }
  }
  set((s) => ({ changes: s.changes.map((c) => (drop.has(c.id) && c.status !== 'applied' ? { ...c, status: 'discarded' } : c)) }))
}

export function discardAllStaged() {
  set((s) => ({ changes: s.changes.map((c) => (c.status === 'pending' || c.status === 'failed' ? { ...c, status: 'discarded' } : c)) }))
}

/** Bring a discarded proposal back (and the ones it builds on). */
export function restoreStaged(id: string) {
  const back = new Set<string>()
  const todo = [id]
  while (todo.length) {
    const id = todo.pop()
    const cur = get().changes.find((c) => c.id === id)
    if (!cur || cur.status !== 'discarded' || back.has(cur.id)) continue
    back.add(cur.id)
    todo.push(...depsOf(cur))
  }
  set((s) => ({ changes: s.changes.map((c) => (back.has(c.id) ? { ...c, status: 'pending' } : c)) }))
}

/** The page a change points at, once it exists (for "Open"). */
export function changeTarget(c: StagedChange): ID | null {
  const id = stage.resolve(c.pageId)
  const p = useWorkspace.getState().pages[id]
  return p && !p.trashed ? id : null
}
