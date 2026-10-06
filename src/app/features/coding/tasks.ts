/**
 * Coding pipeline — the task operations on the workspace (store actions only):
 *  - for the worker: pickNext (choose + claim: Worker + Claimed at), heartbeat, finishStage (cost, branch,
 *    git state, PR link, the plan / summary into the page with origin 'coding', the stage move: ok → next;
 *    a failing test → back to implement once with the output, then the next gate)
 *  - for the person: createTask, approve, rework, answer, run now / retry, confirm (team trust), move
 *
 * Writes into the page go through setContent(…, 'coding'); row writes through setRowProperty. A stage's outcome
 * is written inside aiWrite (one "AI" version per page and call, like other machine writes); the claim and its
 * heartbeat are bookkeeping and keep no version.
 */
import { format } from 'date-fns'
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../store/store'
import { selectRows } from '../../store/selectors'
import { useUI } from '../../store/ui'
import type { Database, DateValue, ID, Page, PropertyValue } from '../../store/types'
import { markdownToDoc, readableContent } from '../../editor'
import { navigate, parseHash } from '../../lib/router'
import { aiWrite } from '../history/snapshots'
import { t } from '../../i18n'
import { CLAIM_STALE_MS, type GitInfo, type StageOutcome, type TaskPayload } from './protocol'
import { codingDbId, codingProps, ensureCodingDb, addRepoOptions, nextStage, optionByName, optionName, priorityRank, readPipeline, stageNear, stageOfRow, type CodingProps, type ResolvedStage } from './schema'
import { loadTask, patchTask, taskLocal, type TaskLocal } from './local'
import { isTrusted, keepTrust, trustTask } from './trust'
import { useCoding } from './state'

const ws = () => useWorkspace.getState()

export interface TaskContext {
  db: Database
  props: CodingProps
  pipeline: ResolvedStage[]
  row: Page
  stage: ResolvedStage | null
}

/** A task (a row of the Coding database) with its database, roles and pipeline. */
export function taskContext(taskId: ID): TaskContext | null {
  const s = ws()
  const row = s.pages[taskId]
  const dbId = codingDbId()
  if (!row || !dbId || row.databaseId !== dbId || row.trashed) return null
  const db = s.databases[dbId]
  if (!db) return null
  const props = codingProps(db)
  const pipeline = readPipeline(db)
  return { db, props, pipeline, row, stage: stageOfRow(pipeline, props, row) }
}

const nowValue = (): DateValue => ({ start: format(new Date(), "yyyy-MM-dd'T'HH:mm") })
const claimedAt = (v: PropertyValue | undefined): number => {
  const start = v && typeof v === 'object' && !Array.isArray(v) ? (v as DateValue).start : null
  const ms = start ? new Date(start.length <= 10 ? `${start}T00:00` : start).getTime() : NaN
  return Number.isFinite(ms) ? ms : 0
}
const text = (v: PropertyValue | undefined) => (typeof v === 'string' ? v : '')

function set(row: ID, prop: ID | undefined, value: PropertyValue) {
  if (prop) ws().setRowProperty(row, prop, value)
}

/** "one/fix-login-ab12cd · ↑2 ↓0 · 3 files · 1 conflict" — the Git field. */
export function gitSummary(g: GitInfo): string {
  const parts = [g.branch, `↑${g.ahead} ↓${g.behind}`]
  const changed = g.files.length
  parts.push(t(changed === 1 ? 'features.coding.git.files.one' : 'features.coding.git.files.other', { n: changed }))
  if (g.conflicts.length) parts.push(t(g.conflicts.length === 1 ? 'features.coding.git.conflicts.one' : 'features.coding.git.conflicts.other', { n: g.conflicts.length }))
  if (g.pushed) parts.push(g.unpushed ? t('features.coding.git.unpushed', { n: g.unpushed }) : t('features.coding.git.pushed'))
  return parts.join(' · ')
}

/* ------------------------------------------------------------------ page content (origin 'coding') */

const para = (s: string): JSONContent => (s ? { type: 'paragraph', content: [{ type: 'text', text: s }] } : { type: 'paragraph' })
const blocksOf = (md: string): JSONContent[] => (markdownToDoc(md).content ?? []).filter((b) => b.type !== 'paragraph' || (b.content?.length ?? 0) > 0)
const docOf = (p: Page): JSONContent[] => [...((p.content?.content as JSONContent[] | undefined) ?? [])]
const headingText = (b: JSONContent) => (b.content ?? []).map((c) => c.text ?? '').join('').trim().toLowerCase()
const PLAN_NAMES = () => [t('features.coding.page.plan')].map((s) => s.toLowerCase())

/** Replace the page's "Plan" section (its H2 up to the next H1 / H2 or note) — or add it at the end. */
function writePlan(pageId: ID, md: string) {
  const p = ws().pages[pageId]
  if (!p) return
  const blocks = docOf(p)
  const names = PLAN_NAMES()
  const at = blocks.findIndex((b) => b.type === 'heading' && (b.attrs?.level ?? 1) <= 2 && names.includes(headingText(b)))
  // the plan's own headings sit below "Plan" (H3), so the section ends at the next H1 / H2 or note (callout)
  const body = blocksOf(md).map((b) => (b.type === 'heading' && (b.attrs?.level ?? 1) < 3 ? { ...b, attrs: { ...b.attrs, level: 3 } } : b))
  const section: JSONContent[] = [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: t('features.coding.page.plan') }] }, ...body]
  if (at < 0) blocks.push(...section)
  else {
    let end = at + 1
    while (end < blocks.length && blocks[end]!.type !== 'callout' && !(blocks[end]!.type === 'heading' && (blocks[end]!.attrs?.level ?? 1) <= 2)) end++
    blocks.splice(at, end - at, ...section)
  }
  ws().setContent(pageId, { type: 'doc', content: blocks }, 'coding')
}

/** Add a note at the end of the page: a callout with a label line and Markdown. */
function appendNote(pageId: ID, icon: string, color: string, label: string, md: string) {
  const p = ws().pages[pageId]
  if (!p) return
  const blocks = docOf(p)
  const body = blocksOf(md)
  blocks.push({ type: 'callout', attrs: { icon, color }, content: [{ type: 'paragraph', content: [{ type: 'text', text: label, marks: [{ type: 'bold' }] }] }, ...(body.length ? body : [para('')])] })
  ws().setContent(pageId, { type: 'doc', content: blocks }, 'coding')
}

const stamp = () => format(new Date(), 'HH:mm')

/* ------------------------------------------------------------------ the worker's side */

/** Rows of the Coding database, oldest first (cached per page map). */
let rowsCache: { pages: Record<ID, Page>; dbId: ID; rows: Page[] } | null = null
function codingRows(dbId: ID): Page[] {
  const pages = ws().pages
  if (rowsCache?.pages === pages && rowsCache.dbId === dbId) return rowsCache.rows
  const rows = selectRows(pages, dbId)
  rowsCache = { pages, dbId, rows }
  return rows
}

/** Move a task to a stage (the Stage field). */
function moveRow(taskId: ID, props: CodingProps, stageId: ID) {
  set(taskId, props.stage, stageId)
}

/**
 * The next task for the worker (`next`): a task of one of `repos` whose stage the worker takes (auto, or
 * "Run now" on this device), not claimed by another worker in the last 10 minutes, not waiting / failed,
 * confirmed on this device (team) — highest priority first, then the oldest. It is claimed (Worker +
 * Claimed at) before it is handed out. Queue stages the worker takes are passed on to the next stage.
 */
export async function pickNext(repos: string[], workerName: string): Promise<TaskPayload | null> {
  const dbId = codingDbId()
  if (!dbId || useCoding.getState().refused) return null
  const s = ws()
  const db = s.databases[dbId]
  if (!db) return null
  const props = codingProps(db)
  const pipeline = readPipeline(db)
  if (!props.repo || !props.stage || !pipeline.length) return null
  const wanted = new Set(repos)
  const busy = new Set(useCoding.getState().busy.map((b) => b.taskId))
  const candidates = codingRows(dbId)
    .filter((r) => wanted.has(optionName(db, props.repo, r.properties[props.repo!]) ?? ''))
    .sort((a, b) => priorityRank(db, props, a) - priorityRank(db, props, b) || a.createdAt - b.createdAt)
  for (const row of candidates) {
    if (busy.has(row.id)) continue
    const owner = text(row.properties[props.worker ?? ''])
    if (owner && owner !== workerName && Date.now() - claimedAt(row.properties[props.claimed ?? '']) < CLAIM_STALE_MS) continue
    await loadTask(row.id)
    const local = taskLocal(row.id)
    let stage = stageOfRow(pipeline, props, row)
    if (!stage) continue
    const go = (st: ResolvedStage) => st.auto || !!local.runNow
    if ((local.state === 'failed' || local.state === 'stopped' || local.state === 'question') && !local.runNow) continue
    // queue stages the worker takes: on to the next stage
    for (let hops = 0; stage.kind === 'queue' && go(stage) && hops < pipeline.length; hops++) {
      const n = nextStage(pipeline, stage)
      if (!n) break
      moveRow(row.id, props, n.id)
      stage = n
    }
    if (stage.kind === 'queue' || stage.kind === 'gate' || stage.kind === 'done' || !go(stage)) continue
    if (!(await isTrusted(row.id))) continue
    // claim it
    const fresh = ws().pages[row.id]
    if (!fresh || fresh.trashed) continue
    // bookkeeping, not content: no "AI" version for a claim
    set(row.id, props.worker, workerName)
    set(row.id, props.claimed, nowValue())
    const repo = optionName(db, props.repo, fresh.properties[props.repo])!
    await patchTask(row.id, { state: 'running', stageId: stage.id, error: null, runNow: false })
    return {
      id: row.id,
      title: fresh.title.trim() || t('common.untitled'),
      repo,
      stage: { id: stage.id, name: stage.name, kind: stage.kind, instructions: stage.instructions ?? '', permissionMode: stage.kind === 'plan' ? 'plan' : (stage.permissionMode ?? 'acceptEdits'), maxTurns: stage.maxTurns ?? (stage.kind === 'plan' ? 20 : 40), gitAction: stage.gitAction ?? null },
      text: readableContent(row.id).markdown,
      rework: local.rework?.stageId === stage.id ? local.rework.text : null,
      answers: (local.answers ?? []).filter((a) => a.stageId === stage.id).map(({ q, a }) => ({ q, a })),
      branch: text(fresh.properties[props.branch ?? '']).trim() || null,
      spent: typeof fresh.properties[props.cost ?? ''] === 'number' ? (fresh.properties[props.cost!] as number) : 0,
      summary: local.summary ?? null,
      trusted: true,
    }
  }
  return null
}

/** The worker still works on these tasks: Claimed at = now. */
export function heartbeat(taskIds: ID[], workerName: string): void {
  for (const id of taskIds) {
    const ctx = taskContext(id)
    if (!ctx || text(ctx.row.properties[ctx.props.worker ?? '']) !== workerName) continue
    // only when the minute changed (Claimed at has minute precision): no write every heartbeat
    const now = nowValue()
    const cur = ctx.row.properties[ctx.props.claimed ?? '']
    if (!(cur && typeof cur === 'object' && !Array.isArray(cur) && (cur as DateValue).start === now.start)) set(id, ctx.props.claimed, now)
  }
}

const KIND_ICON: Record<string, string> = { implement: 'asset:code', git: 'asset:publish', test: 'asset:counter', plan: 'asset:notepad' }

/** The worker's outcome of a stage: into the row, the page, this device's log — and on to the next stage. */
export async function finishStage(taskId: ID, stageId: ID, outcome: StageOutcome): Promise<void> {
  const ctx = taskContext(taskId)
  if (!ctx) return
  await loadTask(taskId)
  const { props, pipeline, row } = ctx
  const stage = pipeline.find((s) => s.id === stageId) ?? null
  const local = taskLocal(taskId)
  const stillThere = !!stage && ctx.stage?.id === stage.id
  const patch: Partial<TaskLocal> = { state: 'idle', error: null, question: null, stageId }
  let moveTo: ResolvedStage | null = null
  let toast: { key: string; kind: 'info' | 'success' | 'error' } | null = null

  if (outcome.git) patch.git = outcome.git
  if (outcome.url) patch.url = outcome.url
  if (outcome.test) patch.test = outcome.test
  if (outcome.plan) patch.plan = outcome.plan
  if (outcome.summary && stage?.kind === 'implement') patch.summary = outcome.summary

  switch (outcome.status) {
    case 'ok':
      if (stage?.kind === 'test') patch.testFailures = 0
      if (stillThere) moveTo = nextStage(pipeline, stage!)
      // answers and rework notes belong to the stage they were given in
      patch.answers = (local.answers ?? []).filter((a) => a.stageId !== stageId)
      if (local.rework?.stageId === stageId) patch.rework = null
      if (moveTo?.kind === 'gate') toast = { key: 'features.coding.toast.gate', kind: 'info' }
      if (moveTo?.kind === 'done') toast = { key: 'features.coding.toast.done', kind: 'success' }
      break
    case 'question':
      patch.state = 'question'
      patch.question = outcome.question ?? ''
      toast = { key: 'features.coding.toast.question', kind: 'info' }
      break
    case 'stopped':
      patch.state = 'stopped'
      patch.error = outcome.error ?? null
      break
    case 'failed':
    case 'limit':
    case 'refused':
      if (stage?.kind === 'test' && outcome.status === 'failed' && outcome.test && !outcome.test.ok && stillThere) {
        const failures = (local.testFailures ?? 0) + 1
        patch.testFailures = failures
        const impl = stageNear(pipeline, stage, ['implement'], -1)
        const gate = stageNear(pipeline, stage, ['gate'], 1)
        const tail = outcome.test.output.slice(-6000)
        if (failures === 1 && impl) {
          moveTo = impl
          patch.rework = { stageId: impl.id, text: t('features.coding.rework.tests', { output: tail }) }
          break
        }
        if (gate) {
          moveTo = gate
          toast = { key: 'features.coding.toast.testsGate', kind: 'error' }
          break
        }
      }
      patch.state = 'failed'
      patch.error = outcome.error ?? t('features.coding.err.failed')
      toast = { key: 'features.coding.toast.failed', kind: 'error' }
      break
  }

  await keepTrust([taskId], () =>
    aiWrite(() => {
      if (outcome.cost && outcome.cost > 0) {
        const prev = typeof row.properties[props.cost ?? ''] === 'number' ? (row.properties[props.cost!] as number) : 0
        set(taskId, props.cost, Math.round((prev + outcome.cost) * 100) / 100)
      }
      if (outcome.branch && text(row.properties[props.branch ?? '']) !== outcome.branch) set(taskId, props.branch, outcome.branch)
      if (outcome.git) set(taskId, props.git, gitSummary(outcome.git))
      if (outcome.url) set(taskId, props.pr, outcome.url)
      set(taskId, props.worker, null)
      set(taskId, props.claimed, null)
      if (outcome.plan) writePlan(taskId, outcome.plan)
      if (outcome.status === 'ok' && outcome.summary && stage && (stage.kind === 'implement' || stage.kind === 'git'))
        appendNote(taskId, KIND_ICON[stage.kind] ?? 'asset:code', 'gray', `${stage.name} · ${stamp()}`, outcome.summary)
      if (moveTo) moveRow(taskId, props, moveTo.id)
    }),
  )
  await patchTask(taskId, patch)
  // no toast for the task the person is looking at: its panel shows it
  const here = parseHash(window.location.hash)
  if (toast && !(here.name === 'page' && here.id === taskId)) {
    const title = ws().pages[taskId]?.title.trim() || t('common.untitled')
    useUI.getState().toast({ message: t(toast.key, { title, stage: moveTo?.name ?? stage?.name ?? '' }), kind: toast.kind, action: { label: t('features.coding.open'), run: () => navigate({ name: 'page', id: taskId }) } })
  }
}

/* ------------------------------------------------------------------ the person's side */

let nudge: () => void = () => {}
/** service.ts: ask the worker for work now. */
export function setNudge(fn: () => void) {
  nudge = fn
}

/** Approve at a gate: on to the next stage. */
export async function approveTask(taskId: ID): Promise<void> {
  const ctx = taskContext(taskId)
  if (!ctx?.stage || ctx.stage.kind !== 'gate') return
  const n = nextStage(ctx.pipeline, ctx.stage)
  if (!n) return
  await trustTask(taskId)
  await keepTrust([taskId], () => moveRow(taskId, ctx.props, n.id))
  await patchTask(taskId, { state: 'idle', error: null, runNow: false })
  nudge()
}

/** Rework with instructions: back to the stage that made it (plan / implement), the note into the page. */
export async function reworkTask(taskId: ID, note: string): Promise<void> {
  const ctx = taskContext(taskId)
  const text = note.trim()
  if (!ctx?.stage || !text) return
  const back = stageNear(ctx.pipeline, ctx.stage, ['implement', 'plan'], -1)
  if (!back) return
  await trustTask(taskId)
  await keepTrust([taskId], () =>
    aiWrite(() => {
      appendNote(taskId, 'asset:history', 'orange', `${t('features.coding.page.rework')} · ${ctx.stage!.name} · ${stamp()}`, text)
      moveRow(taskId, ctx.props, back.id)
    }),
  )
  await patchTask(taskId, { state: 'idle', error: null, rework: { stageId: back.id, text }, runNow: !back.auto })
  nudge()
}

/** Answer Claude's question: the Q + A into the page, the stage runs again. */
export async function answerTask(taskId: ID, answer: string): Promise<void> {
  const ctx = taskContext(taskId)
  await loadTask(taskId)
  const local = taskLocal(taskId)
  const a = answer.trim()
  if (!ctx?.stage || !a || !local.question) return
  const q = local.question
  await trustTask(taskId)
  await keepTrust([taskId], () => aiWrite(() => appendNote(taskId, 'asset:microphone', 'blue', `${t('features.coding.page.answer')} · ${stamp()}`, `**${t('features.coding.page.q')}** ${q}\n\n**${t('features.coding.page.a')}** ${a}`)))
  await patchTask(taskId, { state: 'idle', question: null, answers: [...(local.answers ?? []), { q, a, stageId: ctx.stage.id }], runNow: true })
  nudge()
}

/** Run now / Retry: the worker takes the task in its stage once, also when the stage is not automatic. */
export async function runTaskNow(taskId: ID): Promise<void> {
  await trustTask(taskId)
  await patchTask(taskId, { state: 'idle', error: null, runNow: true })
  nudge()
}

/** Team workspaces: the person saw the task here — the worker may take it. */
export async function confirmTask(taskId: ID): Promise<void> {
  await trustTask(taskId)
  nudge()
}

export function moveTask(taskId: ID, stageId: ID): void {
  const ctx = taskContext(taskId)
  if (ctx) moveRow(taskId, ctx.props, stageId)
  nudge()
}

export interface NewTask {
  title: string
  repo: string | null
  goal: string
  criteria: string[]
  priority: 'high' | 'medium' | 'low'
  branch: string
  /** straight into the first stage the worker takes (else: the first stage, the backlog) */
  start: boolean
}

/** A new task (the Coding database is created on first use). Trusted on this device. */
export async function createTask(input: NewTask): Promise<ID> {
  const dbId = ensureCodingDb()
  if (input.repo) addRepoOptions(dbId, [input.repo])
  const db = ws().databases[dbId]!
  const props = codingProps(db)
  const pipeline = readPipeline(db)
  const first = pipeline[0]
  const start = input.start ? (pipeline.find((s) => s.kind === 'queue' && s.auto) ?? first) : first
  const properties: Record<ID, PropertyValue> = {}
  const repoOpt = input.repo ? optionByName(db, props.repo, input.repo) : null
  if (props.repo && repoOpt) properties[props.repo] = repoOpt
  if (props.stage && start) properties[props.stage] = start.id
  const prio = optionByName(db, props.priority, t(`features.coding.priority.${input.priority}`))
  if (props.priority && prio) properties[props.priority] = prio
  if (props.branch && input.branch.trim()) properties[props.branch] = input.branch.trim()
  const content: JSONContent[] = []
  for (const line of input.goal.split(/\n{2,}/)) if (line.trim()) content.push(para(line.trim()))
  const criteria = input.criteria.map((c) => c.trim()).filter(Boolean)
  if (criteria.length) {
    content.push({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: t('features.coding.page.criteria') }] })
    content.push({ type: 'taskList', content: criteria.map((c) => ({ type: 'taskItem', attrs: { checked: false }, content: [para(c)] })) })
  }
  const id = ws().createRow(dbId, { title: input.title.trim(), properties, content: { type: 'doc', content: content.length ? content : [para('')] } })
  await trustTask(id)
  nudge()
  return id
}

/** Every task, newest first, with its stage — for #/coding. */
export function allTasks(): Array<{ row: Page; stage: ResolvedStage | null; repo: string | null }> {
  const dbId = codingDbId()
  const db = dbId ? ws().databases[dbId] : undefined
  if (!dbId || !db) return []
  const props = codingProps(db)
  const pipeline = readPipeline(db)
  return codingRows(dbId).map((row) => ({ row, stage: stageOfRow(pipeline, props, row), repo: optionName(db, props.repo, row.properties[props.repo ?? '']) }))
}
