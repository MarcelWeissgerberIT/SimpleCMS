/**
 * AI-menu runs in the background — per tab, per page. A run (an action, a workspace question, "Turn into
 * database") belongs to this store, not to the panel: it streams with its own AbortController, and only an
 * explicit Stop or Discard aborts it. Closing the panel, clicking in the sidebar or opening another page
 * leaves it running; the panel only subscribes.
 *
 *  - startRun({ editor, pageId, req, target, replaces }) → id · stopRun(id) · removeRun(id) (accept / discard)
 *  - the run's target is mapped through every change of the editor it is bound to; a re-created editor of
 *    the page adopts it (adoptRuns: the text is checked again, see runsTarget.ts)
 *  - finished (and interrupted) runs survive a reload on this device: IndexedDB `one-ai-runs`, keyed by
 *    workspace + run, never synced or exported; the last 20, dropped after 7 days or once accepted /
 *    discarded. A run a reload cut off comes back as 'interrupted'.
 *  - a run that finishes while its page is not open says so in a toast ("AI result ready · <page>" → Open).
 *  - what a request reads of its page follows the page's context marks (reads.ts: whole page / only the
 *    marked blocks / nothing); the run keeps that record (`reads`) for its spec line.
 */
import { create } from 'zustand'
import { createStore, del, entries, set as idbSet, type UseStore } from 'idb-keyval'
import type { Editor } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import type { ID } from '../../store/types'
import { activeWorkspace } from '../../cloud'
import { openPage } from '../../lib/router'
import { newId } from '../../lib/ids'
import { t } from '../../i18n'
import { AIError, runAI, stripFence, type AIAction, type AIErrorCode } from './client'
import { askWorkspace, type WorkspaceSource } from './workspace'
import type { McpCall } from './mcp-servers/activity'
import { mapTarget, reanchor, type RunTarget } from './runsTarget'
import { requestTable, TodbError, type TableAnswer, type TodbIssue } from './todb/run'
import type { TableDraft } from './todb/plan'
import { countWords, pageRead, type RunReads } from './reads'
import { readableContent } from '../../editor'
import { requestRedo } from './redo/request'
import type { RedoPassage } from './redo/passages'
import { ImageLoadError, runImageRequest, type ImageIssue, type ImageMeta, type ImageRunRequest } from './image/run'
import { memoryFor, noteUse } from './memory/use'
import { condense } from './memory/propose'
import { pageSource } from './memory/save'
import type { MemoryProposal, MemoryUse } from './memory/types'
import { runTransform, type TransformRunRequest } from './transform/run'
import { FileLoadError, runFileRequest, type FileMeta, type FileProblem, type FileRunRequest } from './file/run'
import { isLocalAction, isStructuredAction } from './file/kinds'
import { shownResult, TransformError, type TransformIssue, type TransformState } from './transform/types'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type RunRequest =
  /** memoryOff: an own request ('custom') without the One memory (the panel's toggle) */
  | { kind: 'action'; action: AIAction; label: string; code: string; instruction?: string; input?: string; refine?: boolean; memoryOff?: boolean }
  /** One memory: "remember …" (a free request) or "Remember this" (the selection) → Claude condenses it into a proposal */
  | { kind: 'memory'; label: string; code: string; text: string; from: 'request' | 'selection' }
  | { kind: 'workspace'; question: string; label: string; code: string }
  /** "Turn into database": Claude reads the selected blocks, the panel previews the table */
  | { kind: 'todb'; label: string; code: string; instruction?: string }
  /** "Redo with instructions": marked passages rewritten by the instructions (+ a rules page), reviewed one by one */
  | { kind: 'redo'; label: string; code: string; instructions: string; rulesPageId: ID | null; passages: RedoPassage[] }
  /** Claude looks at an image block: describe / read out the text / tables / a question (image/run.ts) */
  | ImageRunRequest
  /** "Transform into …": the selected blocks as a diagram, chart, board, columns … (transform/run.ts), previewed first */
  | TransformRunRequest
  /** Claude for files: a file block → summarise / extract / tables / ask, or a local conversion (file/run.ts) */
  | FileRunRequest

export type RunStatus = 'running' | 'done' | 'error' | 'interrupted'

/** A redo passage's result: Claude's Markdown (null: skipped / missing), the review decision, what applying did. */
export interface RedoItem {
  n: number
  after: string | null
  decision: 'accept' | 'reject' | null
  outcome?: 'applied' | 'changed'
}

/** "Turn into database": Claude's table, the blocks it read (JSON) and what the preview changed. */
export type TodbResult = TableAnswer

export interface AIRun {
  id: string
  /** workspace key: runs of another workspace are never shown */
  scope: string
  pageId: ID
  req: RunRequest
  status: RunStatus
  output: string
  sources: WorkspaceSource[]
  mcpCalls: McpCall[]
  error: { code: AIErrorCode; detail?: string; server?: string } | null
  issue: TodbIssue | null
  table: TodbResult | null
  target: RunTarget
  startedAt: number
  finishedAt: number | null
  /** the finished result was shown (the sidebar LED is for unseen ones) */
  seen: boolean
  /** what the request read of its page (null: from before this was recorded) */
  reads?: RunReads | null
  /** "Redo with instructions": one result per passage */
  redo?: { items: RedoItem[] } | null
  /** an image request: what was sent of the picture (size, type — never the pixels) */
  image?: ImageMeta | null
  /** an image request whose picture could not be loaded (a web image without CORS, a missing file …) */
  imageIssue?: ImageIssue | null
  /** an own request: the One memory that went along (absent: memory not in use) */
  memory?: MemoryUse | null
  /** a memory request: the proposal (saved only on the person's OK) and what saving did */
  proposals?: MemoryProposal[] | null
  memSaved?: { id: ID; how: 'new' | 'updated' } | null
  /** "Transform into": the forms asked so far (a switch back needs no request), the one shown, the options */
  transform?: TransformState | null
  /** "Transform into": why the form could not be made (no dates, a diagram Mermaid would not parse …) */
  transformIssue?: TransformIssue | null
  /** a file request: what was sent or converted of the file (kind, size, pages — never its content) */
  file?: FileMeta | null
  /** a file request whose file could not be used (too large, too many pages, a web file without CORS …) */
  fileIssue?: FileProblem | null
}

interface RunsState {
  runs: Record<string, AIRun>
  loaded: boolean
  /** a run whose panel should open once its page's editor is there (the toast's "Open") */
  openRequest: string | null
  /** runs an open panel shows right now (the page's plate leaves them out) */
  viewing: string[]
}

export const useAIRuns = create<RunsState>()(() => ({ runs: {}, loaded: false, openRequest: null, viewing: [] }))

const MAX_RUNS = 20
const MAX_AGE = 7 * 24 * 60 * 60 * 1000

const S = () => useAIRuns.getState()

/** This workspace's key ("local:local" / "cloud:<id>"): runs of another workspace are never shown. */
export function currentScope(): string {
  const ref = activeWorkspace()
  return `${ref.kind}:${ref.id}`
}
const scopeKey = currentScope

function patch(id: string, p: Partial<AIRun>, save = true) {
  const cur = S().runs[id]
  if (!cur) return
  useAIRuns.setState((s) => ({ runs: { ...s.runs, [id]: { ...cur, ...p } } }))
  if (save) persist(id)
}

/** This page's runs in this workspace, oldest first. */
export function runsOf(runs: Record<string, AIRun>, pageId: ID, scope = scopeKey()): AIRun[] {
  return Object.values(runs)
    .filter((r) => r.pageId === pageId && r.scope === scope)
    .sort((a, b) => a.startedAt - b.startedAt)
}

/* ------------------------------------------------------------------ */
/* Editors: a run is bound to the live editor of its page              */
/* ------------------------------------------------------------------ */

const bound = new Map<string, Editor>()
const listening = new WeakSet<Editor>()
const lastRecheck = new WeakMap<Editor, number>()

const live = (e: Editor | undefined): e is Editor => !!e && !e.isDestroyed

/** The editor a run is bound to (null: none alive — its page is not open). */
export function editorOf(id: string): Editor | null {
  const e = bound.get(id)
  return live(e) ? e : null
}

function bind(id: string, editor: Editor) {
  bound.set(id, editor)
  if (listening.has(editor)) return
  listening.add(editor)
  const onTx = ({ transaction }: { transaction: Transaction }) => onEditorChange(editor, transaction)
  editor.on('transaction', onTx)
  editor.on('destroy', () => {
    editor.off('transaction', onTx)
    for (const [id, e] of bound) if (e === editor) bound.delete(id)
  })
}

function onEditorChange(editor: Editor, tr: Transaction) {
  if (!tr.docChanged) return
  const runs = S().runs
  let next: Record<string, AIRun> | null = null
  let recheck = false
  for (const [id, e] of bound) {
    const run = runs[id]
    if (e !== editor || !run) continue
    if (run.target.lost) {
      recheck = true
      continue
    }
    next ??= { ...runs }
    next[id] = { ...run, target: mapTarget(run.target, tr.mapping) }
  }
  if (next) useAIRuns.setState({ runs: next })
  // a lost target can come back (a page document that arrived late, an undo): look again, at most twice a second
  if (recheck && performance.now() - (lastRecheck.get(editor) ?? 0) > 500) {
    lastRecheck.set(editor, performance.now())
    queueMicrotask(() => {
      for (const [id, e] of bound) {
        const run = S().runs[id]
        if (e !== editor || !run?.target.lost || editor.isDestroyed) continue
        const t2 = reanchor(editor.state.doc, run.target)
        if (!t2.lost) patch(id, { target: t2 })
      }
    })
  }
}

/** The runs of a page that no live editor holds: this (re-created) editor takes them, checking the text again. */
export function adoptRuns(editor: Editor, pageId: ID) {
  if (editor.isDestroyed) return
  for (const run of runsOf(S().runs, pageId)) {
    if (editorOf(run.id)) continue
    const target = reanchor(editor.state.doc, run.target)
    bind(run.id, editor)
    if (target.lost !== run.target.lost || target.from !== run.target.from || target.to !== run.target.to || target.after !== run.target.after) patch(run.id, { target })
  }
}

/* ------------------------------------------------------------------ */
/* Running                                                             */
/* ------------------------------------------------------------------ */

const controllers = new Map<string, AbortController>()
const buffers = new Map<string, string>()
let raf = 0

function flushTokens() {
  raf = 0
  if (!buffers.size) return
  const runs = { ...S().runs }
  for (const [id, text] of buffers) if (runs[id]?.status === 'running') runs[id] = { ...runs[id], output: text }
  useAIRuns.setState({ runs })
}

export interface StartRunOptions {
  editor: Editor
  pageId: ID
  req: RunRequest
  target: RunTarget
  /** a run this one takes the place of (Retry, Revise): stopped and removed */
  replaces?: string | null
}

/** Start a run in the background; resolves nothing — the panel and the page indicator subscribe. */
export function startRun({ editor, pageId, req, target, replaces }: StartRunOptions): string {
  // "Transform into": a run that replaces one (another form, Try again) keeps the forms asked so far
  const carried = replaces && req.kind === 'transform' ? (S().runs[replaces]?.transform ?? null) : null
  if (replaces) removeRun(replaces)
  const id = newId()
  const run: AIRun = {
    id,
    scope: scopeKey(),
    pageId,
    req,
    status: 'running',
    output: '',
    sources: [],
    mcpCalls: [],
    error: null,
    issue: null,
    table: null,
    target: { ...target, lost: false },
    startedAt: Date.now(),
    finishedAt: null,
    seen: false,
    reads: null,
    ...(req.kind === 'transform' ? { transform: carried } : {}),
  }
  useAIRuns.setState((s) => ({ runs: { ...s.runs, [id]: run } }))
  bind(id, editor)
  persist(id)
  void execute(id, editor)
  // the newest MAX_RUNS stay
  const all = Object.values(S().runs).sort((a, b) => b.startedAt - a.startedAt)
  for (const r of all.slice(MAX_RUNS)) if (r.status !== 'running') removeRun(r.id)
  return id
}

/**
 * What an action request sends of its page — by the page's context marks (reads.ts): the whole page,
 * only the marked blocks, or nothing. "Continue" reads the text before the caret (whole page), the
 * marked blocks (marked) or nothing; a selection always goes along as the text to work on.
 */
function actionRead(run: AIRun, req: Extract<RunRequest, { kind: 'action' }>): { input: string; context: string; reads: RunReads } {
  const { target } = run
  const selection = target.mode === 'selection' ? target.selected : null
  const pr = pageRead(run.pageId, selection)
  if (req.action !== 'continue') return { input: req.input ?? target.selected, context: pr.context, reads: pr.reads }
  const p = useWorkspace.getState().pages[run.pageId]
  const title = p?.title.trim() ? `# ${p.title.trim()}` : ''
  if (pr.reads.mode === 'none') return { input: '', context: '', reads: pr.reads }
  if (pr.reads.mode === 'marked') return { input: pr.marked, context: title, reads: pr.reads }
  const input = req.input ?? target.before
  return { input, context: title, reads: { ...pr.reads, words: countWords(input) } }
}

/** The rules page of a redo request: its title + what may be read of it (its own context marks apply). */
function rulesOf(pageId: ID | null): { title: string; markdown: string } | null {
  const p = pageId ? useWorkspace.getState().pages[pageId] : undefined
  if (!p || p.trashed) return null
  return { title: p.title.trim() || t('common.untitled'), markdown: readableContent(p.id).markdown }
}

/** "Ask your workspace": this page as its context marks allow (null: no limit). */
function workspaceLimit(pageId: ID): { limit: { id: ID; text: string | null } | null; reads: RunReads } {
  const r = readableContent(pageId)
  const mode = r.mode === 'marked' && !r.blocks ? 'none' : r.mode
  const reads: RunReads = { mode, selection: false, blocks: mode === 'marked' ? r.blocks : 0, words: 0, workspace: true }
  if (mode === 'page') return { limit: null, reads }
  return { limit: { id: pageId, text: mode === 'none' ? null : r.plain }, reads }
}

async function execute(id: string, editor: Editor) {
  const run = S().runs[id]
  if (!run) return
  const ac = new AbortController()
  controllers.set(id, ac)
  buffers.set(id, '')
  const onToken = (delta: string) => {
    buffers.set(id, (buffers.get(id) ?? '') + delta)
    raf ||= requestAnimationFrame(flushTokens)
  }
  const { req, target } = run
  /** an own request that took the One memory along: logged once it ends (answered, stopped or failed) */
  let memLog: { use: MemoryUse; task: string } | null = null
  let outcome = ''
  try {
    if (req.kind === 'todb') {
      // reads the selected blocks only (and the page title)
      patch(id, { reads: { mode: 'none', selection: true, blocks: 0, words: countWords(target.selected) } })
      if (!target.todb || editor.isDestroyed) throw new TodbError('changed')
      const title = useWorkspace.getState().pages[run.pageId]?.title ?? ''
      const res = await requestTable(editor.state.doc, target.todb, { pageTitle: title, instruction: req.instruction, signal: ac.signal })
      if (ac.signal.aborted) return
      patch(id, { status: 'done', table: res, finishedAt: Date.now() })
    } else if (req.kind === 'transform') {
      // like "Turn into database": the selected blocks only (and the page title) — never the One memory
      patch(id, { reads: { mode: 'none', selection: true, blocks: 0, words: countWords(target.selected) } })
      if (!target.range || editor.isDestroyed) throw new TodbError('changed')
      const title = useWorkspace.getState().pages[run.pageId]?.title ?? ''
      const state = await runTransform(editor.state.doc, target.range, req, run.transform, {
        pageTitle: title,
        signal: ac.signal,
        onState: (transform) => !ac.signal.aborted && patch(id, { transform }),
      })
      if (ac.signal.aborted) return
      patch(id, { status: 'done', transform: state, finishedAt: Date.now() })
    } else if (req.kind === 'redo') {
      const pr = pageRead(run.pageId, null)
      const sent = req.passages.filter((p) => !p.skip)
      const words = sent.reduce((n, p) => n + countWords(p.anchor), 0)
      patch(id, { reads: { ...pr.reads, passages: sent.length, words: pr.reads.words + (pr.reads.mode === 'page' ? 0 : words) } })
      const answer = sent.length ? await requestRedo({ passages: req.passages, instructions: req.instructions, rules: rulesOf(req.rulesPageId), context: pr.context }, ac.signal) : new Map<number, string>()
      if (ac.signal.aborted) return
      const items: RedoItem[] = req.passages.map((p) => ({ n: p.n, after: p.skip ? null : (answer.get(p.n) ?? null), decision: null }))
      patch(id, { status: 'done', redo: { items }, finishedAt: Date.now() })
    } else if (req.kind === 'memory') {
      // reads what it is given (the selection / the request) — the page only for its title and link
      patch(id, { reads: { mode: 'none', selection: req.from === 'selection', blocks: 0, words: countWords(req.text) } })
      const title = useWorkspace.getState().pages[run.pageId]?.title.trim() ?? ''
      const proposals = await condense({ text: req.text, from: req.from, pageTitle: title, source: pageSource(run.pageId), signal: ac.signal })
      if (ac.signal.aborted) return
      patch(id, { status: 'done', proposals, finishedAt: Date.now() })
    } else if (req.kind === 'image') {
      // the picture + the page as its context marks allow
      const pr = pageRead(run.pageId, null)
      patch(id, { reads: pr.reads })
      const text = await runImageRequest(req, pr.context, { onToken, signal: ac.signal, onImage: (image) => !ac.signal.aborted && patch(id, { image }) })
      if (ac.signal.aborted) return
      buffers.delete(id)
      patch(id, { status: 'done', output: text, finishedAt: Date.now() })
    } else if (req.kind === 'file') {
      // the file + the page as its context marks allow — a local conversion reads (and sends) nothing
      const pr = isLocalAction(req.action) ? null : pageRead(run.pageId, null)
      if (pr) patch(id, { reads: pr.reads })
      const text = await runFileRequest(req, pr?.context ?? '', { onToken, signal: ac.signal, onFile: (file) => !ac.signal.aborted && patch(id, { file }) })
      if (ac.signal.aborted) return
      buffers.delete(id)
      patch(id, { status: 'done', output: text, finishedAt: Date.now() })
    } else {
      let text: string
      if (req.kind === 'workspace') {
        const ws = workspaceLimit(run.pageId)
        patch(id, { reads: ws.reads })
        const res = await askWorkspace({ question: req.question, onToken, signal: ac.signal, limit: ws.limit, onSources: (sources) => !ac.signal.aborted && patch(id, { sources }, false) })
        text = res.text
      } else {
        const read = actionRead(run, req)
        // an own request takes the One memory along (unless switched off for it)
        const mem = req.action === 'custom' ? memoryFor(req.instruction ?? '', { off: req.memoryOff }) : null
        if (mem?.use) memLog = { use: mem.use, task: req.instruction ?? '' }
        patch(id, { reads: read.reads, ...(mem?.use ? { memory: mem.use } : {}) })
        text = await runAI({
          action: req.action,
          input: read.input,
          instruction: req.instruction,
          context: read.context,
          onToken,
          signal: ac.signal,
          onMcp: (calls) => !ac.signal.aborted && patch(id, { mcpCalls: calls }, false),
          memory: mem?.block,
        })
        outcome = text
      }
      if (ac.signal.aborted) return
      buffers.delete(id)
      patch(id, { status: 'done', output: stripFence(text), finishedAt: Date.now() })
    }
    announce(id)
  } catch (e) {
    if (ac.signal.aborted) return
    const partial = buffers.get(id) ?? ''
    buffers.delete(id)
    if (e instanceof TodbError) return patch(id, { status: 'error', issue: e.issue, finishedAt: Date.now() })
    if (e instanceof TransformError) return patch(id, { status: 'error', transformIssue: e.issue, finishedAt: Date.now() })
    if (e instanceof ImageLoadError) return patch(id, { status: 'error', imageIssue: e.issue, finishedAt: Date.now() })
    if (e instanceof FileLoadError) return patch(id, { status: 'error', fileIssue: e.problem, finishedAt: Date.now() })
    const err = e instanceof AIError ? e : new AIError('unknown', String(e))
    if (err.code === 'aborted') return
    patch(id, { status: 'error', output: partial, error: { code: err.code, detail: err.detail, server: err.server }, finishedAt: Date.now() })
  } finally {
    if (controllers.get(id) === ac) controllers.delete(id)
    if (memLog) {
      const done = S().runs[id]?.status === 'done'
      const result = done ? t('features.memory.result.answer') : t(ac.signal.aborted ? 'features.memory.result.stopped' : 'features.memory.result.failed')
      noteUse(outcome || S().runs[id]?.output || '', memLog.use, { task: memLog.task, where: { kind: 'menu' }, pageId: run.pageId, result })
    }
  }
}

/** A result ready while its page is not open: a toast with "Open". */
function announce(id: string) {
  const run = S().runs[id]
  if (!run || editorOf(id)) return
  const title = useWorkspace.getState().pages[run.pageId]?.title.trim() || t('common.untitled')
  useUI.getState().toast({
    message: t('features.ai.bg.ready', { title }),
    kind: 'success',
    timeout: 8000,
    action: {
      label: t('features.ai.bg.open'),
      run: () => {
        if (!S().runs[id]) return
        useAIRuns.setState({ openRequest: id })
        openPage(run.pageId)
      },
    },
  })
}

/** Stop: the request is aborted; text that arrived stays as the result, else the run is gone. */
export function stopRun(id: string): boolean {
  const run = S().runs[id]
  if (!run) return false
  controllers.get(id)?.abort()
  controllers.delete(id)
  if (raf) {
    cancelAnimationFrame(raf)
    flushTokens()
  }
  const partial = stripFence(buffers.get(id) ?? S().runs[id]?.output ?? '')
  buffers.delete(id)
  if (run.status !== 'running') return true
  // half a JSON answer (image description / tables) is no result
  if (run.req.kind === 'image' && (run.req.action === 'describe' || run.req.action === 'table')) {
    removeRun(id)
    return false
  }
  // half of a file's tables or of a conversion is no result either
  if (run.req.kind === 'file' && isStructuredAction(run.req.action)) {
    removeRun(id)
    return false
  }
  if (!partial.trim()) {
    removeRun(id)
    return false
  }
  patch(id, { status: 'done', output: partial, finishedAt: Date.now(), seen: true })
  return true
}

/** Accepted or discarded: aborted when still running, gone from this device. */
export function removeRun(id: string) {
  controllers.get(id)?.abort()
  controllers.delete(id)
  buffers.delete(id)
  bound.delete(id)
  const run = S().runs[id]
  if (!run) return
  useAIRuns.setState((s) => {
    const runs = { ...s.runs }
    delete runs[id]
    return { runs, openRequest: s.openRequest === id ? null : s.openRequest }
  })
  void del(diskKey(run), kv()).catch(() => {})
}

export function markSeen(id: string) {
  const run = S().runs[id]
  if (run && !run.seen && run.status !== 'running') patch(id, { seen: true })
}

/** The review's decision on a redo passage (null: undecided again). */
export function setRedoDecision(id: string, n: number, decision: RedoItem['decision']) {
  const run = S().runs[id]
  if (!run?.redo) return
  patch(id, { redo: { items: run.redo.items.map((x) => (x.n === n ? { ...x, decision } : x)) } })
}

/** Decide every undecided passage that has a result. */
export function decideAllRedo(id: string, decision: 'accept' | 'reject') {
  const run = S().runs[id]
  if (!run?.redo) return
  patch(id, { redo: { items: run.redo.items.map((x) => (x.after !== null && !x.decision ? { ...x, decision } : x)) } })
}

/** What applying did, per passage. */
export function setRedoOutcome(id: string, outcome: Record<number, 'applied' | 'changed'>) {
  const run = S().runs[id]
  if (!run?.redo) return
  patch(id, { redo: { items: run.redo.items.map((x) => (outcome[x.n] ? { ...x, outcome: outcome[x.n] } : x)) } })
}

export function setTodbDraft(id: string, draft: TableDraft) {
  const run = S().runs[id]
  if (run?.table) patch(id, { table: { ...run.table, draft } })
}

/**
 * "Transform into": the preview changed the state (an option, a database draft, the form shown from the cache).
 * A failed run that now shows a form asked before (the strip after "no dates") is a finished one again.
 */
export function setTransform(id: string, next: (state: TransformState) => TransformState) {
  const run = S().runs[id]
  if (!run?.transform || run.status === 'running') return
  const transform = next(run.transform)
  const back = run.status !== 'done' && !!shownResult(transform)
  patch(id, back ? { transform, status: 'done', error: null, issue: null, transformIssue: null, finishedAt: run.finishedAt ?? Date.now() } : { transform })
}

/** A panel shows this run (returns the release). */
export function viewRun(id: string): () => void {
  useAIRuns.setState((s) => ({ viewing: [...s.viewing, id] }))
  return () =>
    useAIRuns.setState((s) => {
      const i = s.viewing.indexOf(id)
      return i < 0 ? s : { viewing: [...s.viewing.slice(0, i), ...s.viewing.slice(i + 1)] }
    })
}

export function takeOpenRequest(pageId: ID): string | null {
  const id = S().openRequest
  if (!id || S().runs[id]?.pageId !== pageId) return null
  useAIRuns.setState({ openRequest: null })
  return id
}

/* ------------------------------------------------------------------ */
/* This device: IndexedDB one-ai-runs                                  */
/* ------------------------------------------------------------------ */

let db: UseStore | null = null
const kv = () => (db ??= createStore('one-ai-runs', 'runs'))
const diskKey = (run: Pick<AIRun, 'scope' | 'id'>) => `${run.scope}|${run.id}`
const timers = new Map<string, number>()

function persist(id: string) {
  window.clearTimeout(timers.get(id))
  timers.set(
    id,
    window.setTimeout(() => {
      timers.delete(id)
      const run = S().runs[id]
      if (!run) return
      // a run in flight is saved without the text so far: after a reload it is 'interrupted' anyway
      const out = run.status === 'running' ? { ...run, output: '' } : run
      void idbSet(diskKey(run), JSON.parse(JSON.stringify(out)), kv()).catch(() => {})
    }, 250),
  )
}

let loading: Promise<void> | null = null

/** Load this workspace's saved runs once per tab (the page indicator and the sidebar LED call it). */
export function ensureRunsLoaded(): Promise<void> {
  loading ??= (async () => {
    const scope = scopeKey()
    let rows: Array<[IDBValidKey, unknown]> = []
    try {
      rows = await entries(kv())
    } catch {
      /* no IndexedDB: runs live in this tab only */
    }
    const now = Date.now()
    const mine: AIRun[] = []
    for (const [key, value] of rows) {
      const r = value as AIRun | null
      if (typeof key !== 'string' || !r || typeof r.id !== 'string' || typeof r.pageId !== 'string' || !r.target || !r.req) continue
      if (r.scope !== scope) continue
      if (now - (r.startedAt ?? 0) > MAX_AGE) {
        void del(key, kv()).catch(() => {})
        continue
      }
      mine.push(r.status === 'running' ? { ...r, status: 'interrupted', output: '' } : r)
    }
    mine.sort((a, b) => b.startedAt - a.startedAt)
    for (const r of mine.slice(MAX_RUNS)) void del(diskKey(r), kv()).catch(() => {})
    const keep = mine.slice(0, MAX_RUNS)
    useAIRuns.setState((s) => {
      const runs = { ...s.runs }
      for (const r of keep) if (!runs[r.id]) runs[r.id] = { ...r, sources: r.sources ?? [], mcpCalls: r.mcpCalls ?? [] }
      return { runs, loaded: true }
    })
    // only the newest MAX_RUNS stay in memory too
    const all = Object.values(S().runs).sort((a, b) => b.startedAt - a.startedAt)
    for (const r of all.slice(MAX_RUNS)) if (r.status !== 'running') removeRun(r.id)
  })()
  return loading
}
