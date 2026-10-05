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
import { attachMcp, codewordTask, currentSetup, setupKey, type McpSetup } from '../mcp-servers/config'
import { applyChanges, type ApplyResult } from './apply'
import { AGENT_SYSTEM, runAgent, taskMessage, type RunHooks } from './run'
import { initialAgentState, openAgent, setStopHandler, useAgent, type EchoAsk, type EchoEntry, type MemCard, type MemItem } from './state'
import { clearHistory, loadHistory, pushHistory } from './history'
import { parseCommand, parseCommandText } from './commands'
import { TERMINAL_TOOLS, type ReadLimit, type StageApi } from './tools'
import { memoryFor, noteUse } from '../memory/use'
import { memoryInUse, proposalsOn } from '../memory/settings'
import { localProposal, proposeAfterTask, terminalSource, trivialTask } from '../memory/propose'
import { confirmProposal, duplicateOf } from '../memory/open'
import { recallTool, rememberTool } from '../memory/tools'
import type { MemoryProposal } from '../memory/types'
import { isContextLimited, openContextPicker, pageContextMarks, readableBlocks, readableContent, startRedo } from '../../../editor'
import { withRefImages } from '../image/terminal'
import { withRefFiles } from '../file/terminal'
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
/** One memory: its tools (recall, remember) and rules join this conversation — pinned at its first task like the MCP setup */
let memTools: boolean | null = null
/** the running proposal request (after a task) */
let proposing: AbortController | null = null
/** undo of a saved / updated proposal, by item id */
const memUndo = new Map<string, () => void>()

/** The agent's rules for the One memory (added to the system prompt while its tools are offered). */
const MEMORY_RULES = `One memory
- The person keeps standing knowledge for you in their One memory: facts, preferences, decisions and procedures (templates). The matching ones come with each task in <one_memory>; search for more with recall.
- When they ask you to remember something, or state a lasting preference, decision or way of working, stage it with remember (one plain sentence; a procedure with its template in body). Never one-off details of a task.`

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

/**
 * What Claude may read of a page in this tab (the page's context marks, editor area): only the marked
 * blocks, or nothing — null = the whole page. Applies to every page with marks set, not only the open one.
 */
export function terminalReadLimit(id: ID): ReadLimit | null {
  if (!isContextLimited(id)) return null
  const r = readableContent(id)
  // the marked blocks by id (read_page with refs / edit_page see only these)
  const ids = () => readableBlocks(id).flatMap((b) => (typeof b.attrs?.id === 'string' && b.attrs.id ? [b.attrs.id] : []))
  if (r.mode === 'marked' && r.blocks) return { mode: 'marked', markdown: r.markdown, plain: r.plain, blocks: r.blocks, ids: ids() }
  return { mode: 'none', markdown: '', plain: '', blocks: 0, ids: [] }
}

/** "· 3 blocks" / "· nothing" after a page title (chip, log line) — '' for the whole page. */
export function contextSuffix(pageId: ID): string {
  const m = pageContextMarks(pageId)
  if (m.mode === 'page') return ''
  if (m.mode === 'marked' && m.blocks) return tn('features.agent.ctx.mode.marked', m.blocks)
  return t('features.agent.ctx.mode.none')
}

/** The open page (also when its chip was removed), for /context and /redo. */
function openPageId(): ID | null {
  const route = parseHash(window.location.hash)
  const page = route.name === 'page' ? useWorkspace.getState().pages[route.id] : undefined
  return page && !page.trashed ? page.id : null
}

function context(refs: TermRef[], mentions: TermMention[]): string {
  const s = useWorkspace.getState()
  const now = new Date()
  const lines = [
    `Today: ${format(now, 'EEEE, yyyy-MM-dd')} (local time ${format(now, 'HH:mm')})`,
    `Workspace: ${q(s.settings.workspaceName || 'Workspace')} · the user's interface language: ${s.settings.language === 'de' ? 'German' : 'English'}`,
  ]
  const openId = contextPageId()
  const open = openId ? s.pages[openId] : undefined
  if (open) {
    lines.push(`Open page: ${q(open.title.trim() || 'Untitled')} (id: ${open.id})`)
    const lim = terminalReadLimit(open.id)
    if (lim?.mode === 'marked') lines.push(`The person limited what you may read on the open page: only the ${lim.blocks} block${lim.blocks === 1 ? '' : 's'} they marked (read_page returns just those). Writing to it works as usual.`)
    else if (lim) lines.push(`The person excluded the open page's content: you may not read it (read_page withholds it). Writing to it works as usual.`)
  }
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
function prepareTask(task: string): { setup: McpSetup; prompt: string; memTools: boolean } {
  if (!history.length || !mcpSetup) {
    mcpSetup = currentSetup()
    set({ mcp: { key: setupKey(mcpSetup), names: mcpSetup.servers.map((x) => x.name) } })
  }
  if (!history.length || memTools === null) memTools = memoryInUse()
  return { setup: mcpSetup, prompt: codewordTask(task), memTools }
}

/**
 * Run the task in the prompt (or `raw`). One task at a time. `noMemory`: without the One memory
 * (/no-memory <task>); `history: false` when the prompt went into the history already.
 */
export async function runTask(raw?: string, opts: { noMemory?: boolean; history?: boolean } = {}): Promise<void> {
  const task = (raw ?? get().draft).trim()
  if (!task || get().status === 'running') return
  const n = get().turns.length + 1
  const ac = new AbortController()
  controller = ac
  setStopHandler(() => ac.abort())
  if (opts.history !== false) pushHistory(task)
  // the chips go along with this task: references, the mentions still in the text, the open page
  const refs = get().refs
  const mentions = get().mentions.filter((m) => task.includes(`@${m.title}`))
  const pageId = contextPageId()
  const suffix = pageId ? contextSuffix(pageId) : ''
  const ctx: TurnContext = {
    refs: refs.length,
    mentions: mentions.map((m) => m.title),
    ...(pageId ? { page: `${useWorkspace.getState().pages[pageId]?.title.trim() || t('common.untitled')}${suffix ? ` · ${suffix}` : ''}` } : {}),
  }
  // the One memory: the memories that fit this task go along (/no-memory: none)
  const mem = memoryFor(task, { off: opts.noMemory || get().memOffNext })
  const text = mem.block ? `${context(refs, mentions)}\n\n${mem.block}` : context(refs, mentions)
  const { setup, prompt, memTools: withMemTools } = prepareTask(task)
  set((s) => ({
    status: 'running',
    draft: '',
    autorun: false,
    live: '',
    calls: 0,
    unseen: null,
    refs: [],
    mentions: [],
    memOffNext: false,
    turns: [...s.turns, { n, task, startedAt: Date.now(), status: 'running', answer: '', context: ctx, ...(mem.use ? { memory: mem.use } : {}) }],
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
  // "#xyz" that is no example in the memory: said, the task runs anyway
  for (const tag of mem.use?.unknownTags ?? []) note(t('features.memory.example.unknown', { tag }))

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
    // the One memory: the request goes into the memory log; proposals for what is worth keeping
    const staged = turnChanges(n)
    const result = status === 'done' || status === 'limit' ? (staged.length ? tn('features.memory.result.changes', staged.length) : t('features.memory.result.answer')) : t(status === 'stopped' ? 'features.memory.result.stopped' : 'features.memory.result.failed')
    noteUse(answer, mem.use, { task, where: { kind: 'terminal' }, pageId, result })
    if (status === 'done' && proposalsOn() && !trivialTask(task, staged.length)) void proposeFor(n, task, answer, mem.use?.items.map((x) => x.text) ?? [])
  }

  try {
    const mcp = setup.servers.length ? await attachMcp(setup) : null
    // referenced image blocks go along as images (Claude for images); one that cannot be loaded is noted
    const withImages = await withRefImages(taskMessage(history, prompt, text), refs, ac.signal, (title) => note(t('features.ai.image.refFailed', { title })))
    // referenced file blocks go along as documents (Claude for files); one that cannot be read is noted
    const user = await withRefFiles(withImages, refs, ac.signal, (title) => note(t('features.ai.file.refFailed', { title })))
    const end = await runAgent({
      history,
      user,
      stage,
      signal: ac.signal,
      hooks,
      mcp,
      readLimit: terminalReadLimit,
      // the One memory's tools and rules (pinned per conversation: the prompt prefix stays the same)
      ...(withMemTools ? { tools: [...TERMINAL_TOOLS, recallTool, rememberTool], system: `${AGENT_SYSTEM}\n\n${MEMORY_RULES}` } : {}),
    })
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

/* ---------- y / n questions in the log (/clear-history) ---------- */

const YES = new Set(['y', 'yes', 'j', 'ja'])
const NO = new Set(['n', 'no', 'nein'])

/** The question in the log that waits for its y / n (null: none). */
export const openAsk = (): EchoEntry | null => get().echo.findLast((e) => e.kind === 'ask' && e.data?.ask?.state === 'open') ?? null

/** Answer a question in the log: y does what it asks, n leaves everything as it is. */
export function answerAsk(id: string, yes: boolean) {
  const entry = get().echo.find((e) => e.id === id)
  const ask = entry?.data?.ask
  if (!entry || !ask || ask.state !== 'open') return
  let result: EchoAsk['result']
  if (ask.what === 'clearhistory') {
    const count = Number(entry.data?.vars?.count) || 0
    if (yes) clearHistory()
    result = yes ? { key: `features.agent.echo.clearHistory.cleared.${count === 1 ? 'one' : 'other'}`, vars: { count } } : { key: 'features.agent.echo.clearHistory.kept' }
  }
  const next: EchoAsk = { ...ask, state: yes ? 'yes' : 'no', ...(result ? { result } : {}) }
  set((s) => ({ echo: s.echo.map((e) => (e.id === id ? { ...e, data: { ...e.data, ask: next } } : e)) }))
}

/** Run what is in the prompt: a /command right here, anything else as a task for Claude. */
export async function submitPrompt(raw?: string): Promise<void> {
  const input = (raw ?? get().draft).trim()
  if (!input) return
  // a question waits for y / n: the answer goes there (never into the prompt history); anything else drops it
  const asking = openAsk()
  if (asking) {
    const word = input.toLowerCase()
    if (YES.has(word) || NO.has(word)) {
      set({ draft: '' })
      return answerAsk(asking.id, YES.has(word))
    }
    answerAsk(asking.id, false)
  }
  // /remember <sentence> · /no-memory <task>
  const withText = parseCommandText(input)
  if (withText) {
    pushHistory(input)
    set({ draft: '' })
    if (withText.id === 'remember') return rememberText(input, withText.text)
    if (withText.id === 'example') return exampleDialog(input, withText.text)
    if (get().status === 'running') return info(input, 'features.agent.echo.wait')
    return runTask(withText.text, { noMemory: true, history: false })
  }
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
    case 'clearhistory': {
      // this command is the newest entry already: the prompts before it
      const list = loadHistory()
      const count = list.length - (list[list.length - 1] === input ? 1 : 0)
      if (!count) return info(input, 'features.agent.echo.clearHistory.empty')
      echo(input, 'ask', { key: `features.agent.echo.clearHistory.ask.${count === 1 ? 'one' : 'other'}`, vars: { count }, ask: { what: 'clearhistory', state: 'open' } })
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
    case 'context':
      pickContext(input)
      return
    case 'redo':
      pickRedo(input)
      return
    case 'remember': {
      // alone: proposals for the last task that finished
      const last = [...get().turns].reverse().find((x) => x.status === 'done')
      if (!last || running) return info(input, 'features.memory.echo.nothingToPropose')
      void proposeFor(last.n, last.task, last.answer, last.memory?.items.map((x) => x.text) ?? [], input)
      return
    }
    case 'example':
      return exampleDialog(input, '')
    case 'nomemory':
      if (!memoryInUse()) return info(input, 'features.memory.echo.notInUse')
      set({ memOffNext: true })
      return info(input, 'features.memory.echo.offNext')
    default:
      info(input, 'features.agent.echo.unknown', { cmd: input.split(/\s/)[0] })
  }
}

/**
 * /context (and "Mark blocks…" on the page chip, input null: nothing logged): the picker on the open page
 * (what Claude may read). Phones: the terminal sheet covers the page, so it steps aside and comes back
 * on Done / Esc; the result goes into the log.
 */
export function pickContext(input: string | null) {
  const pageId = openPageId()
  const say = (key: string, vars?: Record<string, string | number>) => input !== null && info(input, key, vars)
  if (!pageId) return say('features.agent.echo.noPage')
  const phone = window.matchMedia?.('(max-width: 640px)').matches ?? false
  const ok = openContextPicker(pageId, {
    onEnd: (done) => {
      openAgent()
      const title = useWorkspace.getState().pages[pageId]?.title.trim() || t('common.untitled')
      if (!done) return say('features.agent.echo.contextKept')
      const m = pageContextMarks(pageId)
      const what = m.mode === 'marked' && m.blocks ? tn('features.agent.ctx.mode.marked', m.blocks) : t('features.agent.ctx.mode.none')
      say('features.agent.echo.context', { title, what })
    },
  })
  if (!ok) return say('features.agent.echo.noBlocks')
  if (phone) useAgent.setState({ open: false })
}

/**
 * /redo (/neu-machen): the redo picker on the open page (the caret's block pre-marked); on Done the
 * page's AI panel takes over — instructions, the run, the review. Phones: the terminal steps aside
 * (and comes back when the picker is cancelled).
 */
export function pickRedo(input: string) {
  const pageId = openPageId()
  if (!pageId) return info(input, 'features.agent.echo.redoLocked')
  const phone = window.matchMedia?.('(max-width: 640px)').matches ?? false
  const ok = startRedo(pageId, {
    onEnd: (done, ids) => {
      if (!done || !ids.length) {
        if (phone) openAgent()
        return info(input, 'features.agent.echo.redoKept')
      }
      const title = useWorkspace.getState().pages[pageId]?.title.trim() || t('common.untitled')
      info(input, 'features.agent.echo.redo', { title, what: tn('features.ai.redo.passages', ids.length) })
    },
  })
  if (!ok) return info(input, 'features.agent.echo.redoLocked')
  if (phone) useAgent.setState({ open: false })
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
  memTools = null
  proposing?.abort()
  proposing = null
  memUndo.clear()
  set({ ...initialAgentState(), draft: '', autorun: false })
}

/* ------------------------------------------------------------------ */
/* One memory: proposals ("REMEMBER? · 2"), saved only on the OK       */
/* ------------------------------------------------------------------ */

/** The changes a task proposed: "New row · Final QA" (kinds + titles, never content). */
function turnChanges(n: number): string[] {
  const ids = new Set(get().steps.filter((x) => x.turn === n && x.changeId).map((x) => x.changeId!))
  return get()
    .changes.filter((c) => ids.has(c.id))
    .map((c) => `${c.kind}${c.title ? ` · ${c.title}` : ''} · ${c.status}`)
}

const patchCard = (id: string, fn: (c: MemCard) => MemCard) => set((s) => ({ memCards: s.memCards.map((c) => (c.id === id ? fn(c) : c)) }))
const patchItem = (cardId: string, itemId: string, patch: Partial<MemItem>) => patchCard(cardId, (c) => ({ ...c, items: c.items.map((x) => (x.id === itemId ? { ...x, ...patch } : x)) }))
const itemOf = (p: MemoryProposal): MemItem => ({ id: nextId('m'), p, status: 'pending', dup: duplicateOf(p) })

/** Ask Claude what is worth remembering from task `n` (one small structured request). */
async function proposeFor(n: number, task: string, answer: string, existing: string[], input?: string): Promise<void> {
  proposing?.abort()
  const ac = new AbortController()
  proposing = ac
  const card: MemCard = { id: nextId('k'), after: n, origin: 'task', state: 'loading', items: [], ...(input ? { input } : {}) }
  set((s) => ({ memCards: [...s.memCards, card] }))
  try {
    const list = await proposeAfterTask({ task, answer, changes: turnChanges(n), existing, signal: ac.signal })
    if (ac.signal.aborted) return
    if (!list.length) set((s) => ({ memCards: s.memCards.filter((c) => c.id !== card.id) }))
    else patchCard(card.id, (c) => ({ ...c, state: 'ready', items: list.map(itemOf) }))
  } catch (e) {
    // quiet: proposals are a convenience — the task itself is done
    if (!ac.signal.aborted) console.warn('[one] memory: no proposals', e)
    set((s) => ({ memCards: s.memCards.filter((c) => c.id !== card.id) }))
  } finally {
    if (proposing === ac) proposing = null
  }
}

/** /example [tag]: the open page as an example in the memory — the dialog (tag prefilled). */
function exampleDialog(input: string, tag: string) {
  const pageId = openPageId()
  const page = pageId ? useWorkspace.getState().pages[pageId] : undefined
  if (!page || page.kind === 'database') return info(input, 'features.agent.echo.noPage')
  useUI.getState().openModal({ type: 'memoryExample', pageId: page.id, ...(tag.trim() ? { tag: tag.trim() } : {}) })
}

/** /remember <sentence>: the person's own words as a proposal (no request). */
function rememberText(input: string, text: string) {
  const p = localProposal(text, terminalSource())
  if (!p.text) return info(input, 'features.memory.echo.nothingToPropose')
  const card: MemCard = { id: nextId('k'), after: get().turns.length, origin: 'command', state: 'ready', items: [itemOf(p)], input }
  set((s) => ({ memCards: [...s.memCards, card] }))
}

/** y / Enter: save (or update the near-identical memory); asNew: a new memory even then. */
export function saveProposal(cardId: string, itemId: string, asNew = false): boolean {
  const item = get().memCards.find((c) => c.id === cardId)?.items.find((x) => x.id === itemId)
  if (!item || item.status !== 'pending') return false
  const done = confirmProposal(item.p, asNew ? null : item.dup, { toast: false })
  if (!done) return false
  memUndo.set(itemId, done.undo)
  patchItem(cardId, itemId, { status: done.how === 'updated' ? 'updated' : 'saved', rowId: done.id })
  return true
}

/** a: every pending proposal of the card. */
export function saveAllProposals(cardId: string) {
  for (const x of get().memCards.find((c) => c.id === cardId)?.items ?? []) if (x.status === 'pending') saveProposal(cardId, x.id)
}

export function dismissProposal(cardId: string, itemId: string) {
  patchItem(cardId, itemId, { status: 'dismissed' })
}

/** e: the edited proposal (its near-identical memory found again). */
export function editProposal(cardId: string, itemId: string, p: MemoryProposal) {
  patchItem(cardId, itemId, { p, dup: duplicateOf(p) })
}

/** Undo a saved / updated proposal (or bring a dismissed one back): pending again. */
export function undoProposal(cardId: string, itemId: string) {
  const undo = memUndo.get(itemId)
  memUndo.delete(itemId)
  undo?.()
  const item = get().memCards.find((c) => c.id === cardId)?.items.find((x) => x.id === itemId)
  patchItem(cardId, itemId, { status: 'pending', rowId: undefined, dup: item ? duplicateOf(item.p) : null })
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
