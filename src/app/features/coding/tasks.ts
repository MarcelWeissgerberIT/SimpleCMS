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
import { docToMarkdown, readableContent } from '../../editor'
import { claudeDoc } from '../ai/claudeDoc'
import { navigate, parseHash } from '../../lib/router'
import { aiWrite } from '../history/snapshots'
import { t } from '../../i18n'
import { CLAIM_STALE_MS, MCP_SERVER_NAME, claudeRuns, cleanModel, stageNeeds, workerCan, type GitInfo, type StageOutcome, type TaskPayload, type WorkerInfo } from './protocol'
import { CASE_TYPES, FOLLOW_UPS, PIPELINE_KINDS, caseProps, codingProps, createProject, currentProjectId, ensureCaseDb, ensurePipelineDb, addRepoOptions, inTeam, kindOfDb, nextStage, optionByName, optionName, pipelineDbIds, priorityRank, readPipeline, stageNear, stageOfRow, type CodingProps, type PipelineKind, type ResolvedStage } from './schema'
import { parseStories, splitSections, type DocSection, type Story } from './outputs'
import { createPrivatePage } from '../../cloud'
import { appendLog, loadTask, patchTask, taskLocal, type TaskLocal } from './local'
import { isTrusted, keepTrust, trustTask } from './trust'
import { taskText } from './refs'
import { useCoding } from './state'
import { notifyAway } from './notify'

const ws = () => useWorkspace.getState()

export interface TaskContext {
  kind: PipelineKind
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
  const kind = kindOfDb(row?.databaseId)
  if (!row || !kind || row.trashed) return null
  const db = s.databases[row.databaseId!]
  if (!db) return null
  const props = codingProps(db)
  const pipeline = readPipeline(db)
  return { kind, db, props, pipeline, row, stage: stageOfRow(pipeline, props, row) }
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
// what Claude Code wrote (it read the repo — anyone's text): nothing in it loads by itself, web images become links
const blocksOf = (md: string): JSONContent[] => (claudeDoc(md).content ?? []).filter((b) => b.type !== 'paragraph' || (b.content?.length ?? 0) > 0)
const docOf = (p: Page): JSONContent[] => [...((p.content?.content as JSONContent[] | undefined) ?? [])]
const headingText = (b: JSONContent) => (b.content ?? []).map((c) => c.text ?? '').join('').trim().toLowerCase()
const PLAN_NAMES = () => [t('features.coding.page.plan')].map((s) => s.toLowerCase())

/**
 * The heading of a stage's output section on the task page (writePlan's `title`): the stage's name for a document /
 * analysis stage and when the pipeline has several plan stages — else undefined ("Plan").
 */
export function sectionTitleOf(pipeline: ResolvedStage[], stage: ResolvedStage | null | undefined): string | undefined {
  return stage && (stage.kind === 'doc' || stage.kind === 'analyze' || pipeline.filter((x) => x.kind === 'plan').length > 1) ? stage.name : undefined
}

/**
 * Where a section sits among a page's blocks: its H1 / H2 named `title` (default "Plan") up to the next H1 / H2 or note
 * (callout) — the plan's own headings sit below it (H3). null: the page has none.
 */
function sectionRange(blocks: JSONContent[], title?: string): { at: number; end: number } | null {
  const names = title ? [title.toLowerCase()] : PLAN_NAMES()
  const at = blocks.findIndex((b) => b.type === 'heading' && (b.attrs?.level ?? 1) <= 2 && names.includes(headingText(b)))
  if (at < 0) return null
  let end = at + 1
  while (end < blocks.length && blocks[end]!.type !== 'callout' && !(blocks[end]!.type === 'heading' && (blocks[end]!.attrs?.level ?? 1) <= 2)) end++
  return { at, end }
}

/**
 * Replace the page's "Plan" section (its H2 up to the next H1 / H2 or note) — or add it at the end. With more
 * than one plan stage (e.g. Analysis · Design · Test design) each writes its own section, named like the stage.
 */
export function writePlan(pageId: ID, md: string, title?: string, extra: JSONContent[] = []) {
  const p = ws().pages[pageId]
  if (!p) return
  const blocks = docOf(p)
  const range = sectionRange(blocks, title)
  // the plan's own headings sit below "Plan" (H3), so the section ends at the next H1 / H2 or note (callout)
  const body = [...blocksOf(md).map((b) => (b.type === 'heading' && (b.attrs?.level ?? 1) < 3 ? { ...b, attrs: { ...b.attrs, level: 3 } } : b)), ...extra]
  const section: JSONContent[] = [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: title ?? t('features.coding.page.plan') }] }, ...body]
  if (!range) blocks.push(...section)
  else blocks.splice(range.at, range.end - range.at, ...section)
  ws().setContent(pageId, { type: 'doc', content: blocks }, 'coding')
}

/** A stage's output section as it stands on the task page (Markdown, without its heading) — null: the page has none. */
export function planSection(pageId: ID, title?: string): string | null {
  const p = ws().pages[pageId]
  if (!p) return null
  const blocks = docOf(p)
  const range = sectionRange(blocks, title)
  return range ? docToMarkdown({ type: 'doc', content: blocks.slice(range.at + 1, range.end) }).trim() : null
}

/** A short hash of a text (fingerprints keep no text). */
export function textHash(text: string): string {
  let a = 0x811c9dc5
  let b = 0x01234567
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193)
    b = Math.imul(b ^ text.charCodeAt(i), 0x5bd1e995)
  }
  return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}${text.length.toString(16)}`
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

/** Rows of a pipeline database, oldest first (cached per page map). */
let rowsCache: { pages: Record<ID, Page>; byDb: Map<ID, Page[]> } | null = null
function codingRows(dbId: ID): Page[] {
  const pages = ws().pages
  if (rowsCache?.pages !== pages) rowsCache = { pages, byDb: new Map() }
  let rows = rowsCache.byDb.get(dbId)
  if (!rows) {
    rows = selectRows(pages, dbId)
    rowsCache.byDb.set(dbId, rows)
  }
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
export async function pickNext(repos: string[], workerName: string, docs = false, can: string[] = []): Promise<TaskPayload | null> {
  if (useCoding.getState().refused) return null
  const s = ws()
  const wanted = new Set(repos)
  const busy = new Set(useCoding.getState().busy.map((b) => b.taskId))
  const caps = workerCan(can, docs)
  // every pipeline database's tasks (Coding · Business analysis · QA), highest priority first, then the oldest
  const pool: Array<{ dbId: ID; db: Database; props: CodingProps; pipeline: ResolvedStage[]; row: Page }> = []
  for (const dbId of pipelineDbIds()) {
    const db = s.databases[dbId]
    if (!db) continue
    const props = codingProps(db)
    const pipeline = readPipeline(db)
    if (!props.repo || !props.stage || !pipeline.length) continue
    for (const row of codingRows(dbId)) {
      const repoName = optionName(db, props.repo, row.properties[props.repo])
      // a task without a repository: only its document stages run (the worker's scratch folder)
      if (repoName ? wanted.has(repoName) : docs) pool.push({ dbId, db, props, pipeline, row })
    }
  }
  pool.sort((a, b) => priorityRank(a.db, a.props, a.row) - priorityRank(b.db, b.props, b.row) || a.row.createdAt - b.row.createdAt)
  for (const { dbId, db, props, pipeline, row } of pool) {
    if (busy.has(row.id)) continue
    const owner = text(row.properties[props.worker ?? ''])
    if (owner && owner !== workerName && Date.now() - claimedAt(row.properties[props.claimed ?? '']) < CLAIM_STALE_MS) continue
    await loadTask(row.id)
    const local = taskLocal(row.id)
    let stage = stageOfRow(pipeline, props, row)
    if (!stage) continue
    const go = (st: ResolvedStage) => st.auto || !!local.runNow
    if ((local.state === 'failed' || local.state === 'stopped' || local.state === 'question') && !local.runNow) continue
    // nothing is written for a task this device may not run (not even the queue hop below)
    if (!(await isTrusted(row.id))) continue
    // queue stages the worker takes: on to the next stage (a move of this device: the trust stays)
    let target = stage
    for (let hops = 0; target.kind === 'queue' && go(target) && hops < pipeline.length; hops++) {
      const n = nextStage(pipeline, target)
      if (!n) break
      target = n
    }
    if (target !== stage) {
      const to = target.id
      await keepTrust([row.id], () => moveRow(row.id, props, to))
      stage = target
    }
    if (stage.kind === 'queue' || stage.kind === 'gate' || stage.kind === 'done' || stage.kind === 'import' || !go(stage)) continue
    // a stage an older worker would misread (it ran unknown kinds as git stages, it would ignore the model): not for
    // this worker — the task says why
    const model = modelFor(stage, local)
    if (stageNeeds({ ...stage, model }).some((need) => !caps.has(need))) {
      if (local.error !== OLD_WORKER()) await patchTask(row.id, { state: 'failed', error: OLD_WORKER(), runNow: false })
      continue
    }
    if (!optionName(db, props.repo, row.properties[props.repo!]) && stage.kind !== 'doc') continue
    // the worker gets exactly the version that was checked (row and pipeline): anything that changed
    // meanwhile waits a round
    const fresh = ws().pages[row.id]
    if (!fresh || fresh.trashed || ws().databases[dbId] !== db || !(await isTrusted(row.id)) || ws().pages[row.id] !== fresh || ws().databases[dbId] !== db) continue
    // claim it
    // bookkeeping, not content: no "AI" version for a claim
    set(row.id, props.worker, workerName)
    set(row.id, props.claimed, nowValue())
    const repo = optionName(db, props.repo, fresh.properties[props.repo!]) ?? ''
    await patchTask(row.id, { state: 'running', stageId: stage.id, error: null, runNow: false })
    return {
      id: row.id,
      title: fresh.title.trim() || t('common.untitled'),
      repo,
      stage: { id: stage.id, name: stage.name, kind: stage.kind, instructions: stage.instructions ?? '', permissionMode: stage.kind === 'plan' ? 'plan' : stage.kind === 'doc' ? 'default' : (stage.permissionMode ?? 'acceptEdits'), maxTurns: stage.maxTurns ?? (stage.kind === 'plan' ? 20 : 40), gitAction: stage.gitAction ?? null, model },
      // the task, then the pages it refers to (@ mentions, links — also in answers and rework notes) as read-only text
      text: taskText(row.id, [...(local.answers ?? []).map((a) => a.a), local.rework?.text ?? '']),
      rework: local.rework?.stageId === stage.id ? local.rework.text : null,
      answers: (local.answers ?? []).filter((a) => a.stageId === stage.id).map(({ q, a }) => ({ q, a })),
      branch: text(fresh.properties[props.branch ?? '']).trim() || null,
      spent: typeof fresh.properties[props.cost ?? ''] === 'number' ? (fresh.properties[props.cost!] as number) : 0,
      summary: local.summary ?? null,
      review: local.review?.text ?? null,
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
  // QA: the test cases of a document stage become rows of the Test cases database (the JSON leaves the page)
  let doc = outcome.plan ?? null
  let cases: TestCase[] = []
  const output = stage?.kind === 'doc' ? stage.output : undefined
  if (doc && output === 'testcases') {
    const parsed = parseCases(doc)
    cases = parsed.cases
    doc = parsed.rest
  }
  // Business analysis → stories: a NEW coding project with a task per story (backlog — the person starts them)
  const extra: JSONContent[] = []
  if (doc && output === 'stories' && stillThere) {
    const parsed = parseStories(doc)
    // the json leaves the page only once its stories are tasks (a viewer / a failure keeps it there)
    const made = parsed.stories.length ? await createStories(taskId, parsed.stories, parsed.project, local.storiesDb ?? null).catch(() => null) : null
    if (made) {
      doc = parsed.rest
      patch.storiesDb = made.dbId
      extra.push(storiesNote(made.dbId, made.created, parsed.stories.length))
    }
  }
  const tree = doc && output === 'pages' ? splitSections(doc) : null
  if (outcome.plan) patch.plan = doc ?? outcome.plan
  if (doc && output === 'review') patch.review = { text: doc.slice(0, 60_000), at: Date.now() }
  if (outcome.summary && stage?.kind === 'implement') patch.summary = outcome.summary

  const passed: string[] = []
  switch (outcome.status) {
    case 'ok':
      if (stage?.kind === 'test') patch.testFailures = 0
      if (stillThere) moveTo = nextStage(pipeline, stage!)
      // gates this task does not stop at (Approvals): straight on, noted in the log
      for (let hops = 0; moveTo?.kind === 'gate' && skipsGate(approvalsOf(local), pipeline, moveTo) && hops < pipeline.length; hops++) {
        passed.push(moveTo.name)
        moveTo = nextStage(pipeline, moveTo)
      }
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

  let wrote = false
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
      if (cases.length) {
        const caseDb = createCases(taskId, row.title.trim() || t('common.untitled'), cases)
        doc = `${doc ?? ''}\n\n${t('features.coding.case.made', { n: cases.length, db: ws().pages[caseDb]?.title ?? t('features.coding.case.db') })}`
      }
      // output 'pages': the sections become a page tree; the task's section keeps the intro and links to the pages
      if (doc && tree?.sections.length && stage) {
        const pages = writeDocPages(taskId, stage, row.title.trim() || t('common.untitled'), tree, local.docPages?.[stage.id] ?? null)
        patch.docPages = { ...(local.docPages ?? {}), [stage.id]: pages.rootId }
        doc = tree.intro
        extra.push(...pagesNote(pages.rootId, pages.children))
      }
      // a document / analysis stage writes its own section (headed like the stage); plan stages too when there are several
      if (doc !== null && (doc || extra.length)) {
        writePlan(taskId, doc, sectionTitleOf(pipeline, stage), extra)
        wrote = true
      }
      if (outcome.status === 'ok' && outcome.summary && stage && (stage.kind === 'implement' || stage.kind === 'git'))
        appendNote(taskId, KIND_ICON[stage.kind] ?? 'asset:code', 'gray', `${stage.name} · ${stamp()}`, outcome.summary)
      if (moveTo) moveRow(taskId, props, moveTo.id)
    }),
  )
  // the section as the worker wrote it (an approval shows Claude Code's text only while the page still says the same)
  if (wrote) patch.planSig = textHash(planSection(taskId, sectionTitleOf(pipeline, stage)) ?? '')
  await patchTask(taskId, patch)
  if (passed.length) {
    appendLog(taskId, passed.map((name) => ({ t: Date.now(), k: 'info' as const, s: t('features.coding.approvals.passed', { stage: name }) })))
    if (moveTo?.auto) nudge()
  }
  dropProgress(taskId)
  if (moveTo?.kind === 'done') await spawnFollowUps(taskId)
  if (!toast) return
  const message = t(toast.key, { title: ws().pages[taskId]?.title.trim() || t('common.untitled'), stage: moveTo?.name ?? stage?.name ?? '' })
  // One in the background: the browser says it (when switched on here, notify.ts)
  notifyAway(taskId, message)
  // no toast for the task the person is looking at: its panel shows it
  const here = parseHash(window.location.hash)
  if (!(here.name === 'page' && here.id === taskId)) useUI.getState().toast({ message, kind: toast.kind, action: { label: t('features.coding.open'), run: () => navigate({ name: 'page', id: taskId }) } })
}

/** The stage ended: its running counters go. */
function dropProgress(taskId: ID) {
  const { progress } = useCoding.getState()
  if (!progress[taskId]) return
  const rest = { ...progress }
  delete rest[taskId]
  useCoding.setState({ progress: rest })
}

/* ------------------------------------------------------------------ QA: test cases */

export interface TestCase {
  id: string
  title: string
  area: string
  type: (typeof CASE_TYPES)[number]
  priority: 'high' | 'medium' | 'low'
  preconditions: string
  steps: string[]
  expected: string
}

/** A stage needs a newer worker than the connected one. */
const OLD_WORKER = () => t('features.coding.err.oldWorker')

const clipStr = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : typeof v === 'number' ? String(v) : '')

/**
 * The test cases a QA document hands in: its last fenced json block (an array, or { cases: [...] }), each case
 * sanitized; `rest` = the document without that block. No block (or no cases in it): no cases, the text as is.
 */
export function parseCases(md: string): { cases: TestCase[]; rest: string } {
  const fences = [...md.matchAll(/```json\s*\n([\s\S]*?)\n```/g)]
  const last = fences[fences.length - 1]
  if (!last) return { cases: [], rest: md }
  let raw: unknown
  try {
    raw = JSON.parse(last[1]!)
  } catch {
    return { cases: [], rest: md }
  }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { cases?: unknown }).cases) ? (raw as { cases: unknown[] }).cases : []
  const cases: TestCase[] = []
  for (const item of list.slice(0, 300)) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const title = clipStr(o.title ?? o.name, 200)
    if (!title) continue
    const type = String(o.type ?? '').toLowerCase().replace(/[^a-z]/g, '')
    const prio = String(o.priority ?? '').toLowerCase()
    const steps = Array.isArray(o.steps) ? o.steps.map((x) => clipStr(x, 500)).filter(Boolean).slice(0, 40) : clipStr(o.steps, 4000).split(/\n+/).map((x) => x.trim()).filter(Boolean)
    cases.push({
      id: clipStr(o.id, 40) || `TC-${String(cases.length + 1).padStart(2, '0')}`,
      title,
      area: clipStr(o.area, 120),
      type: (CASE_TYPES as readonly string[]).includes(type) ? (type as TestCase['type']) : type.startsWith('non') ? 'nonfunctional' : type.startsWith('neg') ? 'negative' : type.startsWith('reg') ? 'regression' : type.startsWith('edge') || type.startsWith('bound') ? 'edge' : 'functional',
      priority: prio.startsWith('h') || prio === 'p1' ? 'high' : prio.startsWith('l') || prio === 'p3' ? 'low' : 'medium',
      preconditions: clipStr(o.preconditions, 2000),
      steps,
      expected: clipStr(o.expected ?? o.expectedResult, 2000),
    })
  }
  const rest = cases.length ? (md.slice(0, last.index) + md.slice(last.index! + last[0].length)).trim() : md
  return { cases, rest }
}

/** The cases as rows of the Test cases database (created on first use); each row mentions its QA task. */
function createCases(taskId: ID, taskTitle: string, cases: TestCase[]): ID {
  const dbId = ensureCaseDb()
  const db = ws().databases[dbId]!
  const r = caseProps(db)
  for (const c of cases) {
    const properties: Record<ID, PropertyValue> = {}
    const put = (prop: ID | undefined, v: PropertyValue) => {
      if (prop && v !== '' && v !== null) properties[prop] = v
    }
    put(r.caseId, c.id)
    put(r.status, optionByName(db, r.status, t('features.coding.case.st.notRun')))
    put(r.priority, optionByName(db, r.priority, t(`features.coding.priority.${c.priority}`)))
    put(r.type, optionByName(db, r.type, t(`features.coding.case.ty.${c.type}`)))
    put(r.area, c.area)
    put(r.task, taskTitle)
    put(r.preconditions, c.preconditions)
    put(r.steps, c.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'))
    put(r.expected, c.expected)
    const content: JSONContent[] = [
      { type: 'paragraph', content: [{ type: 'text', text: `${t('features.coding.case.from')} ` }, { type: 'mention', attrs: { id: taskId, label: taskTitle, kind: 'page' } }] },
    ]
    if (c.steps.length) content.push({ type: 'orderedList', content: c.steps.map((s) => ({ type: 'listItem', content: [para(s)] })) })
    if (c.expected) content.push({ type: 'paragraph', content: [{ type: 'text', text: `${t('features.coding.case.expected')}: `, marks: [{ type: 'bold' }] }, { type: 'text', text: c.expected }] })
    ws().createRow(dbId, { title: c.title, properties, content: { type: 'doc', content } })
  }
  return dbId
}

/* ------------------------------------------------------------------ document outputs: pages, stories */

const mentionOf = (id: ID, label: string): JSONContent => ({ type: 'mention', attrs: { id, label, kind: 'page' } })

/** A heading level less inside a page of its own (the section's ### become ##). */
const lifted = (blocks: JSONContent[]): JSONContent[] => blocks.map((b) => (b.type === 'heading' && (b.attrs?.level ?? 1) === 3 ? { ...b, attrs: { ...b.attrs, level: 2 } } : b))

/**
 * Output 'pages': one documentation page ("<task> · <stage>", top level; private in a team) holding the intro and a
 * link per page, a page per section under it. A re-run (same device) updates the pages of the same titles, adds new
 * ones and leaves the others (someone may have written in them). Inside aiWrite: a changed page keeps a version first.
 */
function writeDocPages(taskId: ID, stage: ResolvedStage, taskTitle: string, tree: { intro: string; sections: DocSection[] }, known: ID | null): { rootId: ID; children: Array<{ id: ID; title: string }> } {
  const s = ws()
  const live = (id: ID | null | undefined) => !!id && !!s.pages[id] && !s.pages[id]!.trashed
  const rootTitle = `${taskTitle} · ${stage.name}`
  const rootInput = { parentId: null, title: rootTitle, icon: { type: 'asset' as const, value: 'notepad' }, content: { type: 'doc', content: [para('')] } }
  // a team: the root in my Private section; pages below a private page go there with it (the binding)
  const rootId = live(known) ? known! : inTeam() ? createPrivatePage(rootInput) : ws().createPage(rootInput)
  const make = (input: Parameters<typeof s.createPage>[0]) => ws().createPage(input)
  const children: Array<{ id: ID; title: string }> = []
  const existing = Object.values(ws().pages).filter((p) => p.parentId === rootId && !p.trashed && !p.databaseId)
  for (const sec of tree.sections) {
    const content = { type: 'doc', content: (() => {
      const b = lifted(blocksOf(sec.body))
      return b.length ? b : [para('')]
    })() }
    const same = existing.find((p) => p.title.trim().toLowerCase() === sec.title.toLowerCase())
    if (same) {
      ws().setContent(same.id, content, 'coding')
      children.push({ id: same.id, title: same.title })
    } else children.push({ id: make({ parentId: rootId, title: sec.title, content }), title: sec.title })
  }
  const intro = blocksOf(tree.intro)
  ws().setContent(
    rootId,
    {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: `${t('features.coding.out.pagesFrom')} ` }, mentionOf(taskId, taskTitle)] },
        ...intro,
        ...children.map((c) => ({ type: 'pageLink', attrs: { pageId: c.id } })),
      ],
    },
    'coding',
  )
  return { rootId, children }
}

/** In the task's section: the documentation page and a list of its pages (mentions — later stages read them along). */
function pagesNote(rootId: ID, children: Array<{ id: ID; title: string }>): JSONContent[] {
  const root = ws().pages[rootId]?.title ?? ''
  return [
    { type: 'paragraph', content: [{ type: 'text', text: `${t('features.coding.out.pagesMade', { n: children.length })} `, marks: [{ type: 'bold' }] }, mentionOf(rootId, root)] },
    { type: 'bulletList', content: children.map((c) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [mentionOf(c.id, c.title)] }] })) },
  ]
}

/**
 * Output 'stories': a new coding project ("<project or task> — Stories", its pipeline copied from the coding project
 * shown here) and a task per story — same repo and priority rules, a mention of the source, in the backlog. A re-run
 * adds only stories whose title is not there yet.
 */
async function createStories(taskId: ID, stories: Story[], project: string, known: ID | null): Promise<{ dbId: ID; created: number }> {
  const ctx = taskContext(taskId)
  if (!ctx) throw new Error('gone')
  const title = ctx.row.title.trim() || t('common.untitled')
  const dbId = known && kindOfDb(known) === 'coding' ? known : createProject('coding', t('features.coding.out.storiesDb', { name: project || title }), undefined, { show: false })
  const have = new Set(Object.values(ws().pages).filter((p) => p.databaseId === dbId && !p.trashed).map((p) => p.title.trim().toLowerCase()))
  const repo = optionName(ctx.db, ctx.props.repo, ctx.row.properties[ctx.props.repo ?? ''])
  let created = 0
  for (const st of stories) {
    if (have.has(st.title.toLowerCase())) continue
    have.add(st.title.toLowerCase())
    await createTask({
      kind: 'coding',
      dbId,
      title: st.title,
      repo,
      goal: st.text,
      criteria: st.criteria,
      priority: st.priority,
      branch: '',
      start: false,
      extra: [{ type: 'paragraph', content: [{ type: 'text', text: `${t('features.coding.out.storyFrom')} ` }, mentionOf(taskId, title)] }],
    })
    created++
  }
  return { dbId, created }
}

function storiesNote(dbId: ID, created: number, total: number): JSONContent {
  return {
    type: 'callout',
    attrs: { icon: 'asset:publish', color: 'green' },
    content: [{ type: 'paragraph', content: [{ type: 'text', text: `${t('features.coding.out.storiesMade', { n: created, total })} `, marks: [{ type: 'bold' }] }, mentionOf(dbId, ws().pages[dbId]?.title ?? '')] }],
  }
}

/* ------------------------------------------------------------------ follow-ups (one chain hands on to another) */

/** The kinds a task hands on to ("Then"). */
export function followUpsOf(taskId: ID): PipelineKind[] {
  const ctx = taskContext(taskId)
  if (!ctx?.props.followUps) return []
  const v = ctx.row.properties[ctx.props.followUps]
  const names = (Array.isArray(v) ? v : []).map((id) => optionName(ctx.db, ctx.props.followUps, id)?.toLowerCase())
  return FOLLOW_UPS[ctx.kind].filter((k) => names.includes(t(`features.coding.pipe.${k}`).toLowerCase()))
}

/** Set the "Then" field (the kinds this task hands on to when it is done). */
export function setFollowUps(taskId: ID, kinds: PipelineKind[]): void {
  const ctx = taskContext(taskId)
  if (!ctx?.props.followUps) return
  const ids = kinds.filter((k) => FOLLOW_UPS[ctx.kind].includes(k)).map((k) => optionByName(ctx.db, ctx.props.followUps, t(`features.coding.pipe.${k}`))).filter((x): x is ID => !!x)
  set(taskId, ctx.props.followUps, ids)
}

/**
 * A follow-up task of another kind from a done task: same repo and priority, the source's page as its text (with a
 * mention of the source), straight into its first automatic stage. The source gets a note with a mention of it.
 */
export async function spawnFollowUp(taskId: ID, kind: PipelineKind): Promise<ID | null> {
  const ctx = taskContext(taskId)
  if (!ctx || !FOLLOW_UPS[ctx.kind].includes(kind)) return null
  await loadTask(taskId)
  const done = taskLocal(taskId).spawned?.[kind as 'coding' | 'qa']
  if (done && ws().pages[done] && !ws().pages[done]!.trashed) return done
  const title = ctx.row.title.trim() || t('common.untitled')
  const prioName = optionName(ctx.db, ctx.props.priority, ctx.row.properties[ctx.props.priority ?? ''])
  const priority = (['high', 'medium', 'low'] as const).find((p) => t(`features.coding.priority.${p}`) === prioName) ?? 'medium'
  const source = docOf(ctx.row)
  const extra: JSONContent[] = [
    { type: 'paragraph', content: [{ type: 'text', text: `${t(`features.coding.follow.from.${ctx.kind}`)} ` }, { type: 'mention', attrs: { id: taskId, label: title, kind: 'page' } }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: title }] },
    ...source.map((b) => (b.type === 'heading' && (b.attrs?.level ?? 1) < 3 ? { ...b, attrs: { ...b.attrs, level: 3 } } : b)),
  ]
  const id = await createTask({ kind, title: kind === 'qa' ? t('features.coding.follow.qaTitle', { title }) : title, repo: optionName(ctx.db, ctx.props.repo, ctx.row.properties[ctx.props.repo ?? '']), goal: t(`features.coding.follow.goal.${kind}`), criteria: [], priority, branch: '', start: true, extra })
  await patchTask(taskId, { spawned: { ...(taskLocal(taskId).spawned ?? {}), [kind]: id } })
  await keepTrust([taskId], () => aiWrite(() => {
    const p = ws().pages[taskId]
    if (!p) return
    const blocks = docOf(p)
    blocks.push({ type: 'callout', attrs: { icon: 'asset:publish', color: 'green' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: `${t(`features.coding.follow.to.${kind}`)} `, marks: [{ type: 'bold' }] }, { type: 'mention', attrs: { id, label: ws().pages[id]?.title ?? title, kind: 'page' } }] }] })
    ws().setContent(taskId, { type: 'doc', content: blocks }, 'coding')
  }))
  return id
}

/** When a task is done: the follow-ups its "Then" field names. */
async function spawnFollowUps(taskId: ID): Promise<void> {
  for (const kind of followUpsOf(taskId)) await spawnFollowUp(taskId, kind)
}

/* ------------------------------------------------------------------ the person's side */

let nudge: () => void = () => {}
/** service.ts: ask the worker for work now. */
export function setNudge(fn: () => void) {
  nudge = fn
}

/**
 * How a task action treats trust: `confirm` (default true) — the person pressed it on the task (the panel): this
 * version counts as seen here. The AI terminal passes false: its actions never confirm a version (coding/terminal.ts
 * refuses them for a task that is not trusted); keepTrust still carries a trusted version across the action's writes.
 */
export interface ActOpts {
  confirm?: boolean
}

/** Approve at a gate: on to the next stage. */
export async function approveTask(taskId: ID, opts: ActOpts = {}): Promise<void> {
  const ctx = taskContext(taskId)
  if (!ctx?.stage || ctx.stage.kind !== 'gate') return
  const n = nextStage(ctx.pipeline, ctx.stage)
  if (!n) return
  if (opts.confirm !== false) await trustTask(taskId)
  await keepTrust([taskId], () => moveRow(taskId, ctx.props, n.id))
  await patchTask(taskId, { state: 'idle', error: null, runNow: false })
  if (n.kind === 'done') await spawnFollowUps(taskId)
  nudge()
}

/** Rework with instructions: back to the stage that made it (plan / implement), the note into the page. */
export async function reworkTask(taskId: ID, note: string, opts: ActOpts = {}): Promise<void> {
  const ctx = taskContext(taskId)
  const text = note.trim()
  if (!ctx?.stage || !text) return
  const back = stageNear(ctx.pipeline, ctx.stage, ['implement', 'plan', 'doc'], -1)
  if (!back) return
  if (opts.confirm !== false) await trustTask(taskId)
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
export async function answerTask(taskId: ID, answer: string, opts: ActOpts = {}): Promise<void> {
  const ctx = taskContext(taskId)
  await loadTask(taskId)
  const local = taskLocal(taskId)
  const a = answer.trim()
  if (!ctx?.stage || !a || !local.question) return
  const q = local.question
  if (opts.confirm !== false) await trustTask(taskId)
  await keepTrust([taskId], () => aiWrite(() => appendNote(taskId, 'asset:microphone', 'blue', `${t('features.coding.page.answer')} · ${stamp()}`, `**${t('features.coding.page.q')}** ${q}\n\n**${t('features.coding.page.a')}** ${a}`)))
  await patchTask(taskId, { state: 'idle', question: null, answers: [...(local.answers ?? []), { q, a, stageId: ctx.stage.id }], runNow: true })
  nudge()
}

/** Run now / Retry: the worker takes the task in its stage once, also when the stage is not automatic. */
export async function runTaskNow(taskId: ID, opts: ActOpts = {}): Promise<void> {
  if (opts.confirm !== false) await trustTask(taskId)
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
  /** which pipeline (default: Coding) */
  kind?: PipelineKind
  /** blocks after the goal (a follow-up: the source task's page) */
  extra?: JSONContent[]
  /** the goal as blocks (the AI terminal: Claude's Markdown, made once when staged and shown in full) — instead of `goal` */
  goalDoc?: JSONContent[]
  /** "Then": the kinds this task hands on to when it is done */
  followUps?: PipelineKind[]
  /** the project (pipeline database) — default: the one #/coding shows for the kind on this device */
  dbId?: ID
}

/**
 * Where a new task starts: `start` — the first stage the worker takes (an Import stage when the code has yet to
 * arrive, else the first automatic queue, else the first stage); otherwise the first stage (the backlog).
 */
export function startStageOf(pipeline: ResolvedStage[], hasRepo: boolean, start: boolean): ResolvedStage | undefined {
  const first = pipeline[0]
  // a pipeline that starts with the code (an Import stage): a task without a repo waits there for it
  const intake = !hasRepo ? pipeline.find((s) => s.kind === 'import') : undefined
  return start ? (intake ?? pipeline.find((s) => s.kind === 'queue' && s.auto) ?? first) : first
}

/** A new task's page: the goal (its blocks, or its paragraphs), the acceptance criteria as a to-do list, then `extra`. */
export function taskBody(input: Pick<NewTask, 'goal' | 'goalDoc' | 'criteria' | 'extra'>): JSONContent[] {
  const content: JSONContent[] = []
  if (input.goalDoc) content.push(...input.goalDoc)
  else for (const line of input.goal.split(/\n{2,}/)) if (line.trim()) content.push(para(line.trim()))
  const criteria = input.criteria.map((c) => c.trim()).filter(Boolean)
  if (criteria.length) {
    content.push({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: t('features.coding.page.criteria') }] })
    content.push({ type: 'taskList', content: criteria.map((c) => ({ type: 'taskItem', attrs: { checked: false }, content: [para(c)] })) })
  }
  if (input.extra?.length) content.push(...input.extra)
  return content.length ? content : [para('')]
}

/** A new task (the Coding database is created on first use). Trusted on this device. */
export async function createTask(input: NewTask): Promise<ID> {
  const kind = input.kind ?? 'coding'
  const dbId = input.dbId && kindOfDb(input.dbId) === kind ? input.dbId : (currentProjectId(kind) ?? ensurePipelineDb(kind))
  if (input.repo) addRepoOptions(dbId, [input.repo])
  const db = ws().databases[dbId]!
  const props = codingProps(db)
  const pipeline = readPipeline(db)
  const start = startStageOf(pipeline, !!input.repo, input.start)
  const properties: Record<ID, PropertyValue> = {}
  const repoOpt = input.repo ? optionByName(db, props.repo, input.repo) : null
  if (props.repo && repoOpt) properties[props.repo] = repoOpt
  if (props.stage && start) properties[props.stage] = start.id
  const prio = optionByName(db, props.priority, t(`features.coding.priority.${input.priority}`))
  if (props.priority && prio) properties[props.priority] = prio
  if (props.branch && input.branch.trim()) properties[props.branch] = input.branch.trim()
  if (props.followUps && input.followUps?.length) {
    const ids = input.followUps.map((k) => optionByName(db, props.followUps, t(`features.coding.pipe.${k}`))).filter((x): x is ID => !!x)
    if (ids.length) properties[props.followUps] = ids
  }
  const content = taskBody(input)
  const id = ws().createRow(dbId, { title: input.title.trim(), properties, content: { type: 'doc', content } })
  await trustTask(id)
  nudge()
  return id
}

/** Every task of every pipeline database (or of one kind), with its stage — for #/coding. */
export function allTasks(only?: PipelineKind): Array<{ row: Page; stage: ResolvedStage | null; repo: string | null; kind: PipelineKind }> {
  const out: Array<{ row: Page; stage: ResolvedStage | null; repo: string | null; kind: PipelineKind }> = []
  for (const dbId of pipelineDbIds()) {
    const db = ws().databases[dbId]
    const kind = kindOfDb(dbId)
    if (!db || !kind || (only && kind !== only)) continue
    const props = codingProps(db)
    const pipeline = readPipeline(db)
    for (const row of codingRows(dbId)) out.push({ row, stage: stageOfRow(pipeline, props, row), repo: optionName(db, props.repo, row.properties[props.repo ?? '']), kind })
  }
  return out
}

/* ------------------------------------------------------------------ setup in the task panel */

/** A branch name the Branch field takes (the worker checks it again with git's own rules). */
export const BRANCH_NAME = /^[A-Za-z0-9._/-]{1,200}$/

/** Repo names to offer: the connected worker's and those already in the Repo select. */
export function knownRepos(): string[] {
  const names = new Set((useCoding.getState().worker?.repos ?? []).map((r) => r.name))
  for (const dbId of pipelineDbIds()) {
    const db = ws().databases[dbId]
    if (db) for (const o of db.properties.find((p) => p.id === codingProps(db).repo)?.options ?? []) names.add(o.name)
  }
  return [...names]
}

/** The connected worker's local branches of a repo — names only, never its base branch (the worker refuses it). */
/**
 * The own Claude Code MCP servers a task's stages may use, as the connected worker names them: the repo's, or —
 * without a repo — the worker's servers for tasks without a repository. null: the worker names none (older).
 */
export function taskMcpServers(worker: WorkerInfo, repo: string | null): string[] | null {
  const raw = repo ? worker.repos.find((r) => r.name === repo)?.mcp : worker.mcp
  if (!Array.isArray(raw)) return null
  return [...new Set(raw.filter((n): n is string => typeof n === 'string' && MCP_SERVER_NAME.test(n)))].slice(0, 20)
}

const foldName = (s: string) => s.trim().toLowerCase()
const wordIn = (text: string, word: string) => new RegExp(`(^|[^\\p{L}\\p{N}_-])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}_-])`, 'iu').test(text)

/**
 * The MCP servers a task's text mentions that Claude Code may not use for it: One's own servers by name or codeword
 * (One's servers never reach Claude Code — the worker's setup page decides), and MCP as such while it has none.
 */
export function mentionedMcp(text: string, servers: Array<{ name: string; codeword?: string | null }>, allowed: string[]): string[] {
  const have = new Set(allowed.map(foldName))
  const out: string[] = []
  for (const s of servers) {
    const words = [s.codeword ?? '', s.name].map((w) => w.trim()).filter((w) => w.length >= 2)
    const hit = words.find((w) => wordIn(text, w))
    if (hit && !words.some((w) => have.has(foldName(w)))) out.push(hit)
  }
  if (!out.length && !allowed.length && wordIn(text, 'mcp')) out.push('MCP')
  return [...new Set(out)]
}

export function workerBranches(repo: string | null): { base: string | null; list: string[] } {
  const r = repo ? useCoding.getState().worker?.repos.find((x) => x.name === repo) : undefined
  if (!r) return { base: null, list: [] }
  const list = (Array.isArray(r.branches) ? r.branches : []).filter((b): b is string => typeof b === 'string' && BRANCH_NAME.test(b) && b !== r.baseBranch).slice(0, 100)
  return { base: typeof r.baseBranch === 'string' ? r.baseBranch : null, list }
}

/** A task's repo by name (a new name becomes an option first); null clears it. */
export function setTaskRepo(taskId: ID, name: string | null): void {
  const ctx = taskContext(taskId)
  if (!ctx?.props.repo) return
  if (!name) return set(taskId, ctx.props.repo, null)
  addRepoOptions(ctx.db.id, [name])
  const id = optionByName(ws().databases[ctx.db.id]!, ctx.props.repo, name)
  if (id) set(taskId, ctx.props.repo, id)
}

/**
 * Import stage: the code is there (the worker's new repo, or one the person took) — the task takes it as its Repo
 * and moves on to the next stage. Only while it stands in an Import stage (a late event changes nothing).
 */
export async function intakeDone(taskId: ID, repo: string, label?: string): Promise<void> {
  const ctx = taskContext(taskId)
  if (!ctx?.stage || ctx.stage.kind !== 'import' || !ctx.props.repo) return
  const n = nextStage(ctx.pipeline, ctx.stage)
  await keepTrust([taskId], () => {
    setTaskRepo(taskId, repo)
    if (n) moveRow(taskId, ctx.props, n.id)
  })
  appendLog(taskId, [{ t: Date.now(), k: 'info', s: label ? t('features.coding.intake.logged', { label, repo }) : t('features.coding.intake.taken', { repo }) }])
  useUI.getState().toast({ message: t('features.coding.intake.done', { repo }), kind: 'success' })
  nudge()
}

/** A task's branch: an existing one to reuse, or null — the worker makes its own (one/…). */
export function setTaskBranch(taskId: ID, branch: string | null): void {
  const ctx = taskContext(taskId)
  const b = branch?.trim() ?? ''
  if (!ctx?.props.branch || (b && !BRANCH_NAME.test(b))) return
  set(taskId, ctx.props.branch, b || null)
}

const hasText = (n: JSONContent | undefined): boolean => !!n && ((typeof n.text === 'string' && n.text.trim() !== '') || (n.type !== undefined && n.type !== 'paragraph' && n.type !== 'doc' && n.type !== 'text' && n.type !== 'hardBreak') || (n.content ?? []).some(hasText))

/** Does the task's page say anything yet (what goes to Claude Code as the goal)? */
export function taskHasText(page: Page): boolean {
  return hasText(page.content as JSONContent | undefined)
}

/** An empty task page gets the outline to fill in: Goal, Acceptance criteria (a to-do list), Notes. */
export function insertTaskOutline(taskId: ID): void {
  const page = ws().pages[taskId]
  if (!page || taskHasText(page)) return
  const h = (key: string): JSONContent => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: t(key) }] })
  ws().setContent(
    taskId,
    {
      type: 'doc',
      content: [
        h('features.coding.new.goal'),
        para(''),
        h('features.coding.page.criteria'),
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [para('')] }] },
        h('features.coding.task.notes'),
        para(''),
      ],
    },
    'template',
  )
}

/* ------------------------------------------------------------------ approvals */

/** Which gates a task stops at: 'all' (plan + review) · 'review' (the plan runs on) · 'none' (no stop — "just do it"). */
export type Approvals = NonNullable<TaskLocal['approvals']>
export const APPROVALS: Approvals[] = ['all', 'review', 'none']
const APPROVALS_KEY = 'one.coding.approvals'

/** This device's choice for tasks that have none of their own (the last one picked). */
export function defaultApprovals(): Approvals {
  try {
    const v = localStorage.getItem(APPROVALS_KEY)
    return v === 'review' || v === 'none' ? v : 'all'
  } catch {
    return 'all'
  }
}

export function approvalsOf(local: TaskLocal): Approvals {
  return local.approvals && APPROVALS.includes(local.approvals) ? local.approvals : defaultApprovals()
}

/** A gate right after a plan stage approves the plan; every other gate is a review. */
export function skipsGate(level: Approvals, pipeline: ResolvedStage[], gate: ResolvedStage): boolean {
  if (level === 'none') return true
  return level === 'review' && pipeline[gate.index - 1]?.kind === 'plan'
}

/** A task's approvals (and this device's default from now on); a task waiting at a gate it now skips goes on. */
export async function setTaskApprovals(taskId: ID, level: Approvals): Promise<void> {
  await loadTask(taskId)
  await patchTask(taskId, { approvals: level })
  try {
    localStorage.setItem(APPROVALS_KEY, level)
  } catch {
    /* private mode: only this task */
  }
  const ctx = taskContext(taskId)
  const local = taskLocal(taskId)
  if (ctx?.stage?.kind === 'gate' && local.state === 'idle' && skipsGate(level, ctx.pipeline, ctx.stage)) {
    appendLog(taskId, [{ t: Date.now(), k: 'info', s: t('features.coding.approvals.passed', { stage: ctx.stage.name }) }])
    await approveTask(taskId)
  }
}

/* ------------------------------------------------------------------ models */

/** The models the pickers offer by name (Claude Code's aliases, and a full id); any other passing MODEL_NAME is "own". */
export const MODEL_CHOICES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'opus', label: 'Opus' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' },
  { id: 'claude-fable-5-1', label: 'Fable' },
]

/** How a model shows in One: a known choice by its name, an own one as written. */
export const modelLabel = (model: string): string => MODEL_CHOICES.find((c) => c.id === model)?.label ?? model

/**
 * The model a stage runs with for this task on this device: the task's own pick (TaskLocal.model), else the stage's,
 * else none (the worker's default). Stages that do not run Claude Code have none.
 */
export function modelFor(stage: { kind: string; model?: string | null }, local: Pick<TaskLocal, 'model'>): string | null {
  if (!claudeRuns(stage.kind)) return null
  return cleanModel(local.model) ?? cleanModel(stage.model) ?? null
}

/** Own model names (not one of MODEL_CHOICES) the pipeline's stages use — the task's picker offers them too. */
export function pipelineModels(pipeline: ResolvedStage[]): string[] {
  const own = pipeline.map((s) => (claudeRuns(s.kind) ? cleanModel(s.model) : null)).filter((m): m is string => !!m && !MODEL_CHOICES.some((c) => c.id === m))
  return [...new Set(own)]
}

/**
 * A task's own model on this device (null: as the pipeline). This device's choice only — kept in its local state,
 * never synced — so it needs no confirmation (trust.ts).
 */
export async function setTaskModel(taskId: ID, model: string | null): Promise<void> {
  await loadTask(taskId)
  await patchTask(taskId, { model: cleanModel(model) ?? undefined })
}
