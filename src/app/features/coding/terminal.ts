/**
 * Coding pipeline ⇄ the AI terminal (features/ai/agent/coding.ts): what Claude may read of the pipelines and the task
 * actions it may PROPOSE. Nothing here runs on Claude's word: the terminal stages every change (ChangeKind 'coding')
 * and calls applyNewTask / applyTaskAction only when the person applies it in the review.
 *
 *  - plan* (staging): checks a request against the live task and pins what the task looked like (stage, phase,
 *    title + page + repo / branch / stage, local state, the open question) — applying refuses when anything of that
 *    changed since, except through the terminal's own reviewed writes of the task applied meanwhile (a chain of
 *    fingerprints, `SigSteps`: an edit made elsewhere breaks it).
 *  - apply*: never confirms a version (the task actions run with `confirm: false`): every action but stop — Then too —
 *    is refused for a task this device has not trusted ("Confirm on this device" stays on the task page). In a local
 *    workspace a write from this tab would clear an agent's stamp (writeEndsConfirm): the terminal never writes such
 *    a task, nor undoes into it.
 *    A task created from the terminal is trusted (createTask) — its review showed all of it: title, project, repo,
 *    branch, the whole page as the worker reads it, the pages that go along.
 *  - "starts the worker": computed from where the task lands (mirrors pickNext: automatic queues are hopped), approving
 *    into a done stage with "Then" set, and a "Then" that adds a pipeline to a task not done yet — such changes are never
 *    part of a bulk apply. A done task's Then is refused (hand_on hands it on now).
 *  - pages that go along: listed on the review, staged pages too (marked); applying refuses when the live list has a
 *    page the review did not list.
 *  - Never offered: moving a task to any stage, Confirm, approvals, git verbs, an Import's code, pipeline edits, projects.
 *
 * Model-facing texts (CodingPlanError) are English; errors of apply* are in the person's language.
 */
import type { JSONContent } from '@tiptap/core'
import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspace } from '../../store/store'
import type { Database, ID, Page } from '../../store/types'
import { docToMarkdown } from '../../editor'
import { claudeDoc } from '../ai/claudeDoc'
import { isAgentWriting } from '../agents/attribution'
import { ALL_MESSAGES, t } from '../../i18n'
import { REPO_NAME, type GitAction, type LogLine, type StageKind } from './protocol'
import { FOLLOW_UPS, KIND_TEMPLATES, codingProps, codingReadOnly, currentProjectId, isPipelineKind, kindOfDb, nextStage, optionByName, optionName, pipelineDbIds, pipelineDbIdsOf, priorityRank, readPipeline, stageNear, templatePipeline, type CodingRole, type PipelineKind, type ResolvedStage } from './schema'
import { BRANCH_NAME, allTasks, answerTask, approvalsOf, approveTask, createTask, defaultApprovals, followUpsOf, knownRepos, planSection, reworkTask, runTaskNow, sectionTitleOf, setFollowUps, skipsGate, spawnFollowUp, startStageOf, taskBody, taskContext, textHash, workerBranches, type Approvals } from './tasks'
import { loadTask, scope, taskLocal, useCodingLocal, type TaskLocal } from './local'
import { isTrusted, needsConfirm, writeEndsConfirm } from './trust'
import { isRunning, stopTask } from './service'
import { useCoding, type CodingConn } from './state'
import { refPagesOf, type RefPage } from './refs'

export { REPO_NAME }

const ws = () => useWorkspace.getState()

/* ------------------------------------------------------------------ the task's phase (the task panel's state) */

export type TaskPhase = 'running' | 'question' | 'failed' | 'stopped' | 'gate' | 'intake' | 'done' | 'idle'

/** What a task waits for right now (the task panel shows the same). */
export function taskPhase(stage: ResolvedStage | null, local: TaskLocal, running: boolean): TaskPhase {
  if (running) return 'running'
  if (local.state === 'question') return 'question'
  if (local.state === 'failed') return 'failed'
  if (local.state === 'stopped') return 'stopped'
  if (stage?.kind === 'gate') return 'gate'
  if (stage?.kind === 'import') return 'intake'
  if (stage?.kind === 'done') return 'done'
  return 'idle'
}

/**
 * Where a task standing in `stage` ends up (mirrors the worker's pick, tasks.ts pickNext): automatic queues are passed
 * on; 'worker' = an automatic stage the worker runs (or any runnable stage with "Run now"), 'waits' = a manual queue, a
 * gate, an Import, done. Repos are not looked at: a doubt counts as "starts".
 */
export function landsOn(pipeline: ResolvedStage[], stage: ResolvedStage | null | undefined, runNow = false): 'worker' | 'waits' {
  if (!stage) return 'waits'
  const go = (st: ResolvedStage) => st.auto || runNow
  let target = stage
  for (let hops = 0; target.kind === 'queue' && go(target) && hops < pipeline.length; hops++) {
    const n = nextStage(pipeline, target)
    if (!n) break
    target = n
  }
  if (target.kind === 'queue' || target.kind === 'gate' || target.kind === 'done' || target.kind === 'import' || !go(target)) return 'waits'
  return 'worker'
}

/**
 * The stages that run on their own after a task enters `from` (gates this device's approvals skip included), and where
 * it stops: the next gate it waits at, a manual stage, or done.
 */
export function runsFrom(pipeline: ResolvedStage[], from: ResolvedStage | null, approvals: Approvals): { runs: ResolvedStage[]; stop: ResolvedStage | null } {
  const runs: ResolvedStage[] = []
  let st = from
  for (let hops = 0; st && hops <= pipeline.length; hops++) {
    if (st.kind === 'done') return { runs, stop: st }
    if (st.kind === 'gate') {
      if (!skipsGate(approvals, pipeline, st)) return { runs, stop: st }
    } else if (st.kind === 'queue' || st.kind === 'import') {
      if (!st.auto || st.kind === 'import') return { runs, stop: st }
    } else if (!st.auto) return { runs, stop: st }
    else runs.push(st)
    st = nextStage(pipeline, st)
  }
  return { runs, stop: null }
}

/* ------------------------------------------------------------------ reading */

/** What the person limits Claude to read of a page (the terminal's context marks): any limit withholds Claude Code's output too. */
export type ReadLimitFn = ((id: ID) => { mode: 'marked' | 'none' } | null) | null

export interface TaskBrief {
  id: ID
  title: string
  kind: PipelineKind
  projectId: ID
  project: string
  stageId: ID | null
  stage: string | null
  stageKind: StageKind | null
  auto: boolean
  phase: TaskPhase
  /** waits for "Confirm on this device" (a team task changed elsewhere, or one an agent wrote) — null: not checked */
  confirm: boolean | null
  repo: string | null
  branch: string | null
  priority: 'high' | 'medium' | 'low' | null
  then: PipelineKind[]
  /** the follow-up tasks this device made from it (live ones: a done task "handed on") */
  handedOn: PipelineKind[]
  cost: number
  pr: string | null
  /** Claude Code's open question (this device) — null when there is none or the page's reading is limited */
  question: string | null
  error: string | null
  updatedAt: number
  createdAt: number
}

export type TaskStatus = 'open' | 'waiting' | 'running' | 'queued' | 'failed' | 'done' | 'all'

export interface TaskFilter {
  kind?: PipelineKind
  projectId?: ID
  /** waiting = gate · question · intake · confirm · queued = idle · failed = failed · stopped · open = all but done */
  status?: TaskStatus
  repo?: string
  /** words in the title */
  query?: string
}

const PRIORITIES = ['high', 'medium', 'low'] as const

/** The Priority option's meaning (its name in either language). */
function priorityOf(db: Database, row: Page): TaskBrief['priority'] {
  const props = codingProps(db)
  const name = optionName(db, props.priority, row.properties[props.priority ?? ''])?.trim().toLowerCase()
  if (!name) return null
  return PRIORITIES.find((p) => [ALL_MESSAGES.en[`features.coding.priority.${p}`], ALL_MESSAGES.de[`features.coding.priority.${p}`]].some((n) => n?.toLowerCase() === name)) ?? null
}

const projectTitle = (dbId: ID) => ws().pages[dbId]?.title.trim() || t('common.untitled')

function briefOf(row: Page, stage: ResolvedStage | null, kind: PipelineKind, limit: ReadLimitFn): TaskBrief {
  const db = ws().databases[row.databaseId!]!
  const props = codingProps(db)
  const local = taskLocal(row.id)
  const phase = taskPhase(stage, local, isRunning(row.id))
  const branch = props.branch ? String(row.properties[props.branch] ?? '').trim() || null : null
  const cost = props.cost && typeof row.properties[props.cost] === 'number' ? (row.properties[props.cost] as number) : 0
  const pr = props.pr && typeof row.properties[props.pr] === 'string' ? (row.properties[props.pr] as string) || null : null
  const limited = !!limit?.(row.id)
  const then = FOLLOW_UPS[kind].length ? followUpsOf(row.id) : []
  const pages = ws().pages
  const handedOn = (Object.entries(local.spawned ?? {}) as Array<[PipelineKind, ID | undefined]>).filter(([, id]) => !!id && !!pages[id] && !pages[id]!.trashed).map(([k]) => k)
  return {
    id: row.id,
    title: row.title.trim() || t('common.untitled'),
    kind,
    projectId: db.id,
    project: projectTitle(db.id),
    stageId: stage?.id ?? null,
    stage: stage?.name ?? null,
    stageKind: stage?.kind ?? null,
    auto: !!stage?.auto,
    phase,
    confirm: needsConfirm(row) ? null : false,
    repo: optionName(db, props.repo, row.properties[props.repo ?? '']),
    branch,
    priority: priorityOf(db, row),
    then,
    handedOn,
    cost,
    pr,
    question: phase === 'question' && !limited ? (local.question ?? null) : null,
    error: (phase === 'failed' || phase === 'stopped') && !limited ? (local.error ?? null) : null,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
  }
}

const WAITING: TaskPhase[] = ['gate', 'question', 'intake']
const ORDER: Record<TaskPhase | 'confirm', number> = { question: 0, gate: 1, confirm: 2, failed: 3, stopped: 3, running: 4, intake: 5, idle: 6, done: 7 }

/** A task's place in "what needs you first" order. */
export const briefRank = (b: TaskBrief) => (b.confirm ? ORDER.confirm : ORDER[b.phase])

function matches(b: TaskBrief, status: TaskStatus): boolean {
  switch (status) {
    case 'all':
      return true
    case 'done':
      return b.phase === 'done'
    case 'running':
      return b.phase === 'running'
    case 'failed':
      return b.phase === 'failed' || b.phase === 'stopped'
    case 'queued':
      return b.phase === 'idle'
    case 'waiting':
      return WAITING.includes(b.phase) || b.confirm === true
    default:
      return b.phase !== 'done'
  }
}

/** Tasks looked at per call, at most (their local state is loaded from IndexedDB once). */
const MAX_SCAN = 500

/** The candidates of a filter (kind, project, repo, title words), newest projects' order kept. */
function candidates(filter: TaskFilter): Array<{ row: Page; stage: ResolvedStage | null; kind: PipelineKind; repo: string | null }> {
  const words = (filter.query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  return allTasks(filter.kind)
    .filter(({ row, repo }) => (!filter.projectId || row.databaseId === filter.projectId) && (!filter.repo || repo?.toLowerCase() === filter.repo.toLowerCase()) && words.every((w) => row.title.toLowerCase().includes(w)))
    .slice(0, MAX_SCAN)
}

/** Fill in `confirm` (a trust check per task: only for those that can need it). */
async function withConfirm(list: TaskBrief[]): Promise<void> {
  for (const b of list) if (b.confirm === null) b.confirm = !(await isTrusted(b.id))
}

const sortBriefs = (list: TaskBrief[]) => {
  const dbs = ws().databases
  const pages = ws().pages
  return list.sort((a, b) => briefRank(a) - briefRank(b) || priorityRank(dbs[a.projectId]!, codingProps(dbs[a.projectId]!), pages[a.id]!) - priorityRank(dbs[b.projectId]!, codingProps(dbs[b.projectId]!), pages[b.id]!) || a.createdAt - b.createdAt)
}

/**
 * Tasks of the pipelines, what needs the person first. `limit`: the terminal's read limit, taken along by the caller
 * before its first await (context marks hold for a tool call's synchronous part only). `page`: offset + count — the
 * trust check runs only for the tasks returned (and for all of them when the filter asks for waiting ones).
 */
export async function taskBriefs(filter: TaskFilter = {}, opts: { limit?: ReadLimitFn; offset?: number; count?: number } = {}): Promise<{ total: number; list: TaskBrief[] }> {
  const limit = opts.limit ?? null
  const rows = candidates(filter)
  await Promise.all(rows.map((r) => loadTask(r.row.id)))
  const status = filter.status ?? 'open'
  const all = rows.map((r) => briefOf(r.row, r.stage, r.kind, limit))
  // "waiting" includes tasks that wait for Confirm: those are checked first
  if (status === 'waiting' || status === 'all') await withConfirm(all)
  const hit = sortBriefs(all.filter((b) => matches(b, status)))
  const page = hit.slice(opts.offset ?? 0, (opts.offset ?? 0) + (opts.count ?? hit.length))
  await withConfirm(page)
  return { total: hit.length, list: page }
}

/** Pipeline rows (for the hook: re-renders only when one of them, or a pipeline database, changes). */
function pipelineRows(s: { pages: Record<ID, Page>; databases: Record<ID, Database> }): Array<Page | Database> {
  const ids = new Set(pipelineDbIds())
  const out: Array<Page | Database> = []
  for (const id of ids) if (s.databases[id]) out.push(s.databases[id]!)
  for (const p of Object.values(s.pages)) if (p.databaseId && ids.has(p.databaseId) && !p.trashed) out.push(p)
  return out
}

/** Shown rows at most (the /pipelines readout). */
export const SHOWN_MAX = 30

/**
 * The open tasks for a live list (the terminal's /pipelines): re-reads when a pipeline row, a task's local state or the
 * worker's busy list changes; trust is checked only for the rows shown that can need it, a moment after the last change
 * — again whenever a row changes or this device trusts another version (Confirm on a task page: `trustRev`).
 */
export function useTaskBriefs(filter: TaskFilter = {}, live = true): { total: number; list: TaskBrief[] } | null {
  const rows = useWorkspace(useShallow(pipelineRows))
  const locals = useCodingLocal((s) => s.tasks)
  const rev = useCodingLocal((s) => s.trustRev)
  const busy = useCoding((s) => s.busy)
  const [loaded, setLoaded] = useState(0)
  const [trust, setTrust] = useState<Record<ID, boolean>>({})
  const key = JSON.stringify(filter)
  // the local state of the candidates (IndexedDB, once per task)
  useEffect(() => {
    if (!live) return
    let alive = true
    void Promise.all(candidates(filter).map((r) => loadTask(r.row.id))).then(() => alive && setLoaded((n) => n + 1))
    return () => {
      alive = false
    }
  }, [rows, key, live]) // eslint-disable-line react-hooks/exhaustive-deps
  const out = useMemo(() => {
    if (!loaded) return null
    const status = filter.status ?? 'open'
    const all = candidates(filter).map((r) => briefOf(r.row, r.stage, r.kind, null))
    // the rows that can need Confirm (checked below); the last check's answer is shown meanwhile (no flicker)
    const needs = new Set(all.filter((b) => b.confirm === null).map((b) => b.id))
    for (const b of all) if (b.confirm === null && b.id in trust) b.confirm = !trust[b.id]
    const hit = sortBriefs(all.filter((b) => matches(b, status)))
    const list = hit.slice(0, SHOWN_MAX)
    return { total: hit.length, list, check: list.filter((b) => needs.has(b.id)).map((b) => b.id).join(',') }
  }, [rows, locals, busy, loaded, trust, key]) // eslint-disable-line react-hooks/exhaustive-deps
  // trust: every row shown that can need it, debounced — re-checked when a row changes (a version changed on another
  // device) or this device trusted a version (rev)
  const check = out?.check ?? ''
  useEffect(() => {
    if (!live || !check) return
    let alive = true
    const timer = window.setTimeout(() => {
      void (async () => {
        const next: Record<ID, boolean> = {}
        for (const id of check.split(',')) next[id] = await isTrusted(id)
        if (alive) setTrust((t0) => (Object.keys(next).every((id) => t0[id] === next[id]) ? t0 : { ...t0, ...next }))
      })()
    }, 250)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [check, rows, rev, live])
  return out
}

export interface ProjectInfo {
  id: ID
  kind: PipelineKind
  title: string
  /** the project #/coding shows for its kind on this device */
  current: boolean
  locked: boolean
  tasks: number
  repos: string[]
  stages: Array<{ id: ID; name: string; kind: StageKind; auto: boolean; count: number; gitAction?: GitAction }>
}

export interface PipelineOverview {
  projects: ProjectInfo[]
  worker: { enabled: boolean; conn: CodingConn; name: string | null; repos: string[]; busy: number; spentToday: number }
  /** which gates a new task stops at on this device */
  approvals: Approvals
  readOnly: boolean
}

/** The pipelines, their projects and stages, and the worker. */
export function pipelineOverview(): PipelineOverview {
  const s = ws()
  const projects: ProjectInfo[] = []
  for (const dbId of pipelineDbIds()) {
    const db = s.databases[dbId]
    const kind = kindOfDb(dbId)
    if (!db || !kind) continue
    const props = codingProps(db)
    const pipeline = readPipeline(db)
    const rows = allTasks(kind).filter((x) => x.row.databaseId === dbId)
    projects.push({
      id: dbId,
      kind,
      title: projectTitle(dbId),
      current: currentProjectId(kind) === dbId,
      locked: !!db.locked,
      tasks: rows.length,
      repos: (db.properties.find((p) => p.id === props.repo)?.options ?? []).map((o) => o.name),
      stages: pipeline.map((st) => ({ id: st.id, name: st.name, kind: st.kind, auto: !!st.auto, count: rows.filter((r) => r.stage?.id === st.id).length, ...(st.gitAction ? { gitAction: st.gitAction } : {}) })),
    })
  }
  const c = useCoding.getState()
  return {
    projects,
    worker: { enabled: c.enabled, conn: c.conn, name: c.worker?.name ?? null, repos: (c.worker?.repos ?? []).map((r) => r.name), busy: c.busy.length, spentToday: c.spentToday },
    approvals: defaultApprovals(),
    readOnly: codingReadOnly(),
  }
}

export interface TaskDetail extends TaskBrief {
  stages: Array<{ name: string; kind: StageKind; auto: boolean; at: 'done' | 'now' | 'next' }>
  /** what this device's worker reported (absent parts: withheld under a read limit, or none) */
  local: Pick<TaskLocal, 'rework' | 'answers' | 'plan' | 'summary' | 'test' | 'git' | 'url' | 'approvals' | 'spawned'>
  /** the newest log lines (none under a read limit) */
  log: LogLine[]
  /** any read limit on the task's page: Claude Code's output is withheld */
  limited: 'marked' | 'none' | null
  approvals: Approvals
  /** the plan / document section on the task page was changed since this device's worker wrote it (the next stage reads the page's) */
  planEdited: boolean
}

/** A task in full, for read_task. `limit` taken along by the caller before its first await. */
export async function taskDetail(id: ID, logLines = 25, limit: ReadLimitFn = null): Promise<TaskDetail | null> {
  const ctx = taskContext(id)
  if (!ctx) return null
  await loadTask(id)
  const live = taskContext(id)
  if (!live) return null
  const brief = briefOf(live.row, live.stage, live.kind, limit)
  await withConfirm([brief])
  const local = taskLocal(id)
  const lim = limit?.(id)?.mode ?? null
  const log = lim ? [] : (useCodingLocal.getState().logs[`${scope()}|${id}`] ?? []).slice(-Math.max(0, Math.min(80, logLines)))
  return {
    ...brief,
    stages: live.pipeline.map((st) => ({ name: st.name, kind: st.kind, auto: !!st.auto, at: !live.stage ? 'next' : st.index < live.stage.index ? 'done' : st.id === live.stage.id ? 'now' : 'next' })),
    // any limit withholds what Claude Code wrote: plan, summary, rework notes and answers live in the page too
    local: lim
      ? { test: local.test ?? null, git: local.git ?? null, url: local.url ?? null, approvals: local.approvals, spawned: local.spawned }
      : { rework: local.rework ?? null, answers: local.answers ?? [], plan: local.plan ?? null, summary: local.summary ?? null, test: local.test ?? null, git: local.git ?? null, url: local.url ?? null, approvals: local.approvals, spawned: local.spawned },
    log,
    limited: lim,
    approvals: approvalsOf(local),
    planEdited: !lim && !!local.plan?.trim() && !!local.planSig && !live.pipeline.some((st) => (st.kind === 'plan' || st.kind === 'doc' || st.kind === 'analyze') && textHash(planSection(id, sectionTitleOf(live.pipeline, st)) ?? '') === local.planSig),
  }
}

/* ------------------------------------------------------------------ proposing (planned when staged, applied on review) */

/** A refusal Claude can act on (English; the terminal sends it back as a tool error). */
export class CodingPlanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CodingPlanError'
  }
}

const q = (s: string) => JSON.stringify(s)

/** The read-only refusal (a team viewer). */
const readOnlyText = 'This workspace is read-only for the person: pipeline tasks cannot be created or changed.'

export interface NewTaskInput {
  kind?: PipelineKind
  projectId?: ID | null
  title: string
  /** Markdown — Claude's, already without refs and web images (the terminal) */
  goal: string
  criteria?: string[]
  repo?: string | null
  branch?: string | null
  priority?: 'high' | 'medium' | 'low'
  then?: PipelineKind[]
  start?: boolean
}

export interface NewTaskPlan {
  kind: PipelineKind
  projectId: ID | null
  project: string
  /** no project of the kind yet: applying creates one (its default pipeline) */
  newProject: boolean
  title: string
  /** the goal as blocks (made once, here — applied exactly so) */
  goalDoc: JSONContent[]
  criteria: string[]
  /** the whole page as the worker reads it (the review shows all of it) */
  text: string
  /** the pages that go along to the worker (mentioned / linked in the page; `staged`: proposed, created on apply) */
  refs: RefPage[]
  repo: string | null
  /** the connected worker announced the repo (false: no worker connected, or a new name in a pipeline that has no worker yet) */
  repoKnown: boolean
  branch: string | null
  /** an existing branch that is not one of the worker's own (one/…): implement and git stages work on it */
  existingBranch: boolean
  priority: 'high' | 'medium' | 'low'
  then: PipelineKind[]
  start: boolean
  startStage: string | null
  startKind: StageKind | null
  /** applying it starts the worker */
  starts: boolean
  /** the gates it stops at on this device and what runs before the first one */
  approvals: Approvals
  stopsAt: string | null
  /** git stages of the pipeline (name + action): what they do once reached */
  git: Array<{ name: string; action: GitAction }>
}

/** A pipeline of a kind for planning: the project's, or the kind's default template (a project made on apply). */
function planPipeline(kind: PipelineKind, projectId: ID | null): ResolvedStage[] {
  if (projectId) return readPipeline(ws().databases[projectId])
  return templatePipeline(KIND_TEMPLATES[kind][0]!).map(({ option, stage }, index) => ({ ...stage, name: option.name, color: option.color, index }))
}

const MAX_GOAL = 8000
const MAX_CRITERIA = 30

const kindsOf = (raw: unknown, allowed: PipelineKind[], what: string): PipelineKind[] => {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new CodingPlanError(`"${what}" must be a list of pipeline kinds.`)
  const out: PipelineKind[] = []
  for (const k of raw) {
    if (!isPipelineKind(k) || !allowed.includes(k)) throw new CodingPlanError(`${q(String(k))} cannot be used in "${what}" here — allowed: ${allowed.length ? allowed.join(', ') : 'none (this pipeline hands on to nothing)'}.`)
    if (!out.includes(k)) out.push(k)
  }
  return out
}

/** Pages the terminal proposed and did not create yet (id → title): links to them go along once they exist. */
export type StagedPages = ReadonlyMap<ID, string>

/** Check a new task (when it is staged). Throws CodingPlanError. `staged`: pages proposed in the same conversation. */
export function planNewTask(input: NewTaskInput, opts: { staged?: StagedPages } = {}): NewTaskPlan {
  if (codingReadOnly()) throw new CodingPlanError(readOnlyText)
  const kind = input.kind ?? 'coding'
  if (!isPipelineKind(kind)) throw new CodingPlanError('"kind" must be coding, spec or qa.')
  const projects = pipelineDbIdsOf(kind)
  let projectId: ID | null = input.projectId ?? null
  if (projectId && !projects.includes(projectId))
    throw new CodingPlanError(`No ${kind} project with id ${q(projectId)}. ${projects.length ? `Projects: ${projects.map((id) => `${q(projectTitle(id))} (id: ${id})`).join(', ')}.` : 'There is none yet: omit project_id and one is created when the task is applied.'}`)
  projectId ??= currentProjectId(kind)
  const db = projectId ? ws().databases[projectId] : undefined
  const pipeline = planPipeline(kind, projectId)
  const title = input.title.replace(/\s+/g, ' ').trim()
  if (!title) throw new CodingPlanError('"title" must not be empty.')
  if (title.length > 200) throw new CodingPlanError(`"title" is too long (${title.length} characters, at most 200).`)
  const goal = input.goal.trim()
  if (goal.length > MAX_GOAL) throw new CodingPlanError(`"goal" is too long (${goal.length} characters, at most ${MAX_GOAL}). Keep it to what Claude Code needs; link pages for the rest.`)
  const criteria = (input.criteria ?? []).map((c) => (typeof c === 'string' ? c.replace(/\s+/g, ' ').trim() : '')).filter(Boolean)
  if (criteria.length > MAX_CRITERIA) throw new CodingPlanError(`Too many criteria (${criteria.length}, at most ${MAX_CRITERIA}).`)
  const long = criteria.find((c) => c.length > 500)
  if (long) throw new CodingPlanError(`A criterion is too long (${long.length} characters, at most 500).`)
  // the repo
  const intake = pipeline.some((s) => s.kind === 'import')
  const repo = input.repo?.trim() || null
  if (repo && !REPO_NAME.test(repo)) throw new CodingPlanError(`${q(repo)} is not a repo name (letters, digits, . _ -; as the worker announces it).`)
  if (!repo && kind === 'coding' && !intake) throw new CodingPlanError(`A coding task needs "repo" (list_pipelines lists the repos${knownRepos().length ? `: ${knownRepos().join(', ')}` : ''}).`)
  const c = useCoding.getState()
  const announced = c.conn === 'connected' ? (c.worker?.repos ?? []).map((r) => r.name) : []
  if (repo && announced.length && !knownRepos().includes(repo)) throw new CodingPlanError(`The worker does not serve a repo ${q(repo)}. Repos: ${knownRepos().join(', ')}.`)
  const props = db ? codingProps(db) : {}
  if (repo && db?.locked && !optionByName(db, props.repo, repo)) throw new CodingPlanError(`The project ${q(projectTitle(db.id))} is locked: only its existing repos can be used (${(db.properties.find((p) => p.id === props.repo)?.options ?? []).map((o) => o.name).join(', ') || 'none'}).`)
  // the branch: coding only, never the base branch, one of the worker's when it announces them
  let branch = input.branch?.trim() || null
  if (kind !== 'coding') branch = null
  if (branch) {
    if (!BRANCH_NAME.test(branch)) throw new CodingPlanError(`${q(branch)} is not a branch name.`)
    const wb = workerBranches(repo)
    if (wb.base && branch === wb.base) throw new CodingPlanError(`${q(branch)} is the repo's base branch — the worker never works on it. Omit "branch": the worker makes its own.`)
    if (c.conn === 'connected' && repo && wb.base !== null && !wb.list.includes(branch)) throw new CodingPlanError(`The worker has no branch ${q(branch)} in ${repo}. Its branches: ${wb.list.slice(0, 30).join(', ') || 'none'}. Omit "branch" and the worker makes its own.`)
  }
  const priority = input.priority ?? 'medium'
  if (!PRIORITIES.includes(priority)) throw new CodingPlanError('"priority" must be high, medium or low.')
  const then = kindsOf(input.then, FOLLOW_UPS[kind], 'then')
  const start = input.start === true
  const first = startStageOf(pipeline, !!repo, start)
  const goalDoc = (goal ? (claudeDoc(goal).content ?? []) : []).filter(Boolean)
  const body = taskBody({ goal: '', goalDoc, criteria, extra: [] })
  const approvals = defaultApprovals()
  return {
    kind,
    projectId,
    project: projectId ? projectTitle(projectId) : t(`features.coding.pipe.${kind}`),
    newProject: !projectId,
    title,
    goalDoc,
    criteria,
    text: docToMarkdown({ type: 'doc', content: body }).trim(),
    refs: refPagesOf(body, [], '', opts.staged),
    repo,
    repoKnown: !!repo && announced.includes(repo),
    branch,
    existingBranch: !!branch && !branch.startsWith('one/'),
    priority,
    then,
    start,
    startStage: first?.name ?? null,
    startKind: first?.kind ?? null,
    starts: landsOn(pipeline, first) === 'worker',
    approvals,
    stopsAt: runsFrom(pipeline, first ?? null, approvals).stop?.name ?? null,
    git: pipeline.filter((s) => s.kind === 'git').map((s) => ({ name: s.name, action: s.gitAction ?? 'pr' })),
  }
}

/** Never from an agent's write (features/agents applies under asAgent): a task an agent proposes waits for the person. */
function notFromAgent() {
  if (isAgentWriting()) throw new Error('not allowed here')
}

/**
 * The project an applied create made for a kind that had none (per workspace, this tab): the other creates staged for
 * "a new project" — in the same batch, or applied again after an Undo — land in it (its pipeline is the template their
 * review showed; the live check below still compares it). A project made any other way (elsewhere, by hand) refuses them.
 */
const madeHere = new Map<string, ID>()
const madeKey = (kind: PipelineKind) => `${scope()}|${kind}`

/** The project a staged "new project" create lands in now (made by an earlier create of this tab), if any. */
export function newProjectNow(kind: PipelineKind): ID | null {
  const id = madeHere.get(madeKey(kind))
  return id && currentProjectId(kind) === id ? id : null
}

/** What a task's review says about its pipeline (where it starts, whether that starts the worker, where it stops, git). */
function pipelineLine(pipeline: ResolvedStage[], repo: boolean, start: boolean, approvals: Approvals) {
  const first = startStageOf(pipeline, repo, start)
  return JSON.stringify([
    first?.name ?? null,
    first?.kind ?? null,
    landsOn(pipeline, first) === 'worker',
    runsFrom(pipeline, first ?? null, approvals).stop?.name ?? null,
    pipeline.filter((s) => s.kind === 'git').map((s) => [s.name, s.gitAction ?? 'pr']),
  ])
}

/** Did the live list of pages that go along gain one the review did not list? */
const newRefs = (live: RefPage[], shown: RefPage[] | undefined) => live.some((r) => !(shown ?? []).some((x) => x.id === r.id))

/** Create a planned task (the person applied it). Throws an Error in the person's language. */
export async function applyNewTask(plan: NewTaskPlan): Promise<{ id: ID; undo: () => boolean }> {
  notFromAgent()
  if (codingReadOnly()) throw new Error(t('features.coding.setup.readOnly'))
  let dbId: ID | null = plan.projectId
  if (dbId && kindOfDb(dbId) !== plan.kind) throw new Error(t('features.coding.term.err.project'))
  // a project made meanwhile: only the one an earlier create of this tab made from the same template is taken
  if (!dbId && currentProjectId(plan.kind)) {
    const made = newProjectNow(plan.kind)
    if (!made) throw new Error(t('features.coding.term.err.pipelineChanged'))
    dbId = made
  }
  const db = dbId ? ws().databases[dbId] : undefined
  if (db?.locked && plan.repo && !optionByName(db, codingProps(db).repo, plan.repo)) throw new Error(t('features.coding.term.err.locked', { repo: plan.repo }))
  // where it lands, again on the live pipeline: the review's start, stop and git lines must still be true
  const pipeline = planPipeline(plan.kind, dbId)
  const shown = JSON.stringify([plan.startStage, plan.startKind, plan.starts, plan.stopsAt, plan.git.map((g) => [g.name, g.action])])
  if (pipelineLine(pipeline, !!plan.repo, plan.start, defaultApprovals()) !== shown) throw new Error(t('features.coding.term.err.pipelineChanged'))
  // the pages that go along: none the review did not list (a staged page it listed may exist by now)
  if (newRefs(refPagesOf(taskBody({ goal: '', goalDoc: plan.goalDoc, criteria: plan.criteria, extra: [] })), plan.refs)) throw new Error(t('features.coding.term.err.refs'))
  const id = await createTask({
    kind: plan.kind,
    ...(dbId ? { dbId } : {}),
    title: plan.title,
    repo: plan.repo,
    goal: '',
    goalDoc: plan.goalDoc,
    criteria: plan.criteria,
    priority: plan.priority,
    branch: plan.kind === 'coding' ? (plan.branch ?? '') : '',
    start: plan.start,
    followUps: plan.then,
  })
  if (!dbId) {
    dbId = ws().pages[id]?.databaseId ?? null
    if (dbId) madeHere.set(madeKey(plan.kind), dbId)
  }
  const made = ws().pages[id]
  const rev = made?.contentRev
  const title = made?.title
  return {
    id,
    // Undo: to the trash — unless the worker took it, or it was changed since (then it stays)
    undo: () => {
      const now = ws().pages[id]
      if (!now || now.trashed) return true
      const ctx = taskContext(id)
      const worker = ctx?.props.worker ? String(now.properties[ctx.props.worker] ?? '').trim() : ''
      if (isRunning(id) || taskLocal(id).state !== 'idle' || worker || now.contentRev !== rev || now.title !== title) return false
      ws().trashPage(id)
      return true
    },
  }
}

export const TASK_OPS = ['approve', 'rework', 'answer', 'run', 'stop', 'then', 'hand_on'] as const
export type TaskOp = (typeof TASK_OPS)[number]

export interface TaskActionPlan {
  op: TaskOp
  taskId: ID
  title: string
  kind: PipelineKind
  projectId: ID
  project: string
  /** what the task looked like when staged — applying refuses when any of it changed */
  stageId: ID | null
  stage: string | null
  phase: TaskPhase
  /** title + the page (a hash of its Markdown) + repo / branch / stage, and this device's local state (its last change) */
  sig: string
  at: number
  /** approve / rework: where it goes */
  to: string | null
  toId?: ID | null
  /** run: a retry after a failure or Stop */
  retry?: boolean
  note?: string
  /** answer: the question it answers (the live one must be the same) */
  question?: string
  answer?: string
  then?: { before: PipelineKind[]; after: PipelineKind[] }
  handOn?: PipelineKind
  /** approve: a gate after a plan / document stage ('plan': its text is approved) or a review gate */
  approves?: 'plan' | 'review'
  /** what the action approves (a plan / document) — shown in full in the review */
  output?: string | null
  /**
   * where `output` comes from: 'claude' — as Claude Code wrote it (the page's section still says the same) · 'page' —
   * the section as it stands on the task page (changed since, or written by another device's worker): what the next
   * stage reads. `edited`: this device has Claude Code's version, and the page's section differs from it.
   */
  outputFrom?: 'claude' | 'page'
  edited?: boolean
  /** a review gate: the test result and the changed files */
  test?: { ok: boolean; code: number | null; skipped?: boolean } | null
  files?: number
  /** the stages that run on their own after it (with their git actions) and where it stops */
  runs?: Array<{ name: string; kind: StageKind; gitAction?: GitAction }>
  stopsAt?: string | null
  /** approving into done hands on to these pipelines (they start) */
  spawns?: PipelineKind[]
  /** pages that go along to the worker with the note / the answer (`staged`: proposed, created on apply) */
  refs?: RefPage[]
  /** applying it starts the worker (as staged; re-checked live) */
  starts: boolean
  /** needed Confirm on this device when staged (the review checks it live again) */
  confirm: boolean
}

/**
 * The task's fingerprint: title, its page as the worker reads it (Markdown — an editor normalising the page when it
 * opens changes nothing), repo / branch / stage.
 */
function sigOf(ctx: NonNullable<ReturnType<typeof taskContext>>): string {
  const { row, db, props } = ctx
  return JSON.stringify([row.title, textHash(docToMarkdown(row.content)), optionName(db, props.repo, row.properties[props.repo ?? '']), String(row.properties[props.branch ?? ''] ?? '').trim(), ctx.stage?.id ?? null])
}

/** A task's fingerprint now (null: not a pipeline task) — the terminal chains it across its own writes (SigSteps). */
export function taskSig(id: ID): string | null {
  const ctx = taskContext(id)
  return ctx ? sigOf(ctx) : null
}

/**
 * The terminal's own reviewed writes of tasks since their actions were staged, per task: fingerprint before → after.
 * A staged action still applies when the live fingerprint is reached from its pinned one through these steps only.
 */
export type SigSteps = ReadonlyArray<readonly [string, string]>

/** Is `now` the pinned fingerprint, or reached from it through the terminal's own writes (in their order)? */
function sigReached(pinned: string, now: string, steps: SigSteps = []): boolean {
  let cur = pinned
  for (const [from, to] of steps) if (from === cur) cur = to
  return cur === now
}

/**
 * What an approval approves: the stage's section as Claude Code wrote it while the page still says the same, else the
 * section as it stands on the page (what the next stage reads). null: the page has no section.
 */
function approvedOutput(taskId: ID, pipeline: ResolvedStage[], made: ResolvedStage, local: TaskLocal): Pick<TaskActionPlan, 'output' | 'outputFrom' | 'edited'> {
  const onPage = planSection(taskId, sectionTitleOf(pipeline, made))
  if (onPage === null || !onPage.trim()) return { output: null }
  if (local.plan?.trim() && local.planSig && local.planSig === textHash(onPage)) return { output: local.plan, outputFrom: 'claude' }
  // edited: this device's worker wrote the section and the page says something else now
  return { output: onPage, outputFrom: 'page', ...(local.plan?.trim() && local.planSig ? { edited: true } : {}) }
}

/** The CodingPlanError for a task that waits for Confirm (no change of it is staged). */
const confirmText = (name: string) => `${name} waits for Confirm on this device: the person must confirm it on its page first — tell them. Nothing was staged.`

const TEXT_MAX = 4000

/** Check a task action (when it is staged). Throws CodingPlanError. `staged`: pages proposed in the same conversation. */
export async function planTaskAction(taskId: ID, op: TaskOp, input: { note?: string; answer?: string; then?: unknown; to?: unknown } = {}, opts: { staged?: StagedPages } = {}): Promise<TaskActionPlan> {
  if (codingReadOnly()) throw new CodingPlanError(readOnlyText)
  if (!TASK_OPS.includes(op)) throw new CodingPlanError(`"action" must be one of ${TASK_OPS.join(', ')}.`)
  if (!taskContext(taskId)) throw new CodingPlanError(`No pipeline task with id ${q(taskId)}. Use list_tasks to get task ids.`)
  await loadTask(taskId)
  const ctx = taskContext(taskId)
  if (!ctx) throw new CodingPlanError(`No pipeline task with id ${q(taskId)}. Use list_tasks to get task ids.`)
  const { row, pipeline, stage, kind } = ctx
  const local = taskLocal(taskId)
  const running = isRunning(taskId)
  const phase = taskPhase(stage, local, running)
  const confirm = needsConfirm(row) && !(await isTrusted(taskId))
  const name = q(row.title.trim() || 'Untitled')
  const where = `${name} is ${phase === 'gate' ? `waiting at the gate ${q(stage?.name ?? '')}` : phase === 'running' ? `running ${q(stage?.name ?? '')}` : `in ${q(stage?.name ?? '—')} (${phase})`}`
  const base = {
    op,
    taskId,
    title: row.title.trim() || t('common.untitled'),
    kind,
    projectId: ctx.db.id,
    project: projectTitle(ctx.db.id),
    stageId: stage?.id ?? null,
    stage: stage?.name ?? null,
    phase,
    sig: sigOf(ctx),
    at: local.at ?? 0,
    confirm,
  }
  const text = (raw: unknown, what: string): string => {
    const v = typeof raw === 'string' ? raw.trim() : ''
    if (!v) throw new CodingPlanError(`"${what}" is needed for ${op}.`)
    if (v.length > TEXT_MAX) throw new CodingPlanError(`"${what}" is too long (${v.length} characters, at most ${TEXT_MAX}).`)
    return v
  }
  const approvals = approvalsOf(local)
  switch (op) {
    case 'approve': {
      if (phase !== 'gate' || !stage) throw new CodingPlanError(`${where}: approve works only while a task waits at a gate.`)
      const next = nextStage(pipeline, stage)
      if (!next) throw new CodingPlanError(`${q(stage.name)} is the last stage: there is nothing to approve it into.`)
      const after = runsFrom(pipeline, next, approvals)
      const spawns = next.kind === 'done' || after.stop?.kind === 'done' ? followUpsOf(taskId) : []
      const made = stage.index > 0 ? pipeline[stage.index - 1] : undefined
      const plan = made?.kind === 'plan' || made?.kind === 'doc' || made?.kind === 'analyze'
      return {
        ...base,
        to: next.name,
        toId: next.id,
        approves: plan ? 'plan' : 'review',
        ...(plan && made ? approvedOutput(taskId, pipeline, made, local) : { output: null }),
        test: !plan && local.test ? { ok: local.test.ok, code: local.test.code, ...(local.test.skipped ? { skipped: true } : {}) } : null,
        files: !plan ? (local.git?.files.length ?? 0) : 0,
        runs: after.runs.map((s) => ({ name: s.name, kind: s.kind, ...(s.gitAction ? { gitAction: s.gitAction } : {}) })),
        stopsAt: after.stop?.name ?? null,
        spawns,
        starts: landsOn(pipeline, next) === 'worker' || spawns.length > 0,
      }
    }
    case 'rework': {
      if (running) throw new CodingPlanError(`${where}: stop it first (task_action stop), or wait until the stage ends.`)
      if (!['gate', 'failed', 'stopped', 'idle'].includes(phase) || !stage) throw new CodingPlanError(`${where}: rework works at a gate, after a failure or Stop, or on a queued task.`)
      const note = text(input.note, 'note')
      const back = stageNear(pipeline, stage, ['implement', 'plan', 'doc'], -1)
      if (!back) throw new CodingPlanError(`${where}: there is no plan, implement or document stage before it to send it back to.`)
      return { ...base, to: back.name, toId: back.id, note, refs: refPagesOf([], [note], taskId, opts.staged), starts: true }
    }
    case 'answer': {
      if (phase !== 'question' || !local.question) throw new CodingPlanError(`${where}: it has no open question on this device (questions live on the device whose worker asked).`)
      const answer = text(input.answer, 'answer')
      return { ...base, to: stage?.name ?? null, question: local.question, answer, refs: refPagesOf([], [answer], taskId, opts.staged), starts: true }
    }
    case 'run': {
      if (running) throw new CodingPlanError(`${where}: it is running already.`)
      if (!stage || stage.kind === 'gate' || stage.kind === 'done' || stage.kind === 'import') throw new CodingPlanError(`${where}: ${stage?.kind === 'gate' ? 'a gate is approved or reworked, not run' : stage?.kind === 'import' ? 'an Import stage waits for the person to hand over the code on the task page' : 'nothing to run'}.`)
      if (!['idle', 'failed', 'stopped'].includes(phase)) throw new CodingPlanError(`${where}: run works on a queued, failed or stopped task.`)
      return { ...base, to: stage.name, retry: phase === 'failed' || phase === 'stopped', starts: true }
    }
    case 'stop': {
      if (!running) throw new CodingPlanError(`${where}: it is not running on this device's worker.`)
      return { ...base, to: null, starts: false }
    }
    case 'then': {
      if (!FOLLOW_UPS[kind].length) throw new CodingPlanError(`${kind} tasks hand on to no other pipeline.`)
      // a field of the task like any other: never written while the task waits for Confirm
      if (confirm) throw new CodingPlanError(confirmText(name))
      // Then acts when a task reaches done: a done task is handed on with hand_on
      if (stage?.kind === 'done') throw new CodingPlanError(`${name} is done already — Then only acts when a task reaches done. Use hand_on to hand it on now${FOLLOW_UPS[kind].length ? ` (to: ${FOLLOW_UPS[kind].join(' or ')})` : ''}.`)
      const after = kindsOf(input.then ?? [], FOLLOW_UPS[kind], 'then')
      const before = followUpsOf(taskId)
      return { ...base, to: null, then: { before, after }, starts: after.some((k) => !before.includes(k)) }
    }
    case 'hand_on': {
      const to = typeof input.to === 'string' ? input.to : ''
      if (!stage || stage.kind !== 'done') throw new CodingPlanError(`${where}: only a done task hands on.`)
      if (!isPipelineKind(to) || !FOLLOW_UPS[kind].includes(to)) throw new CodingPlanError(`"to" must be one of: ${FOLLOW_UPS[kind].join(', ') || 'none'}.`)
      const made = local.spawned?.[to as 'coding' | 'qa']
      if (made && ws().pages[made] && !ws().pages[made]!.trashed) throw new CodingPlanError(`${name} has handed on to ${to} already (task id: ${made}).`)
      return { ...base, to: null, handOn: to, starts: true }
    }
  }
}

/** Whether a staged coding change starts the worker — now (the bulk apply leaves such changes out). */
export function startsNow(c: { op: 'create' | TaskOp; starts: boolean; task?: NewTaskPlan; action?: TaskActionPlan }): boolean {
  if (c.starts) return true
  if (c.op === 'create' && c.task) {
    const pipeline = planPipeline(c.task.kind, c.task.projectId ?? currentProjectId(c.task.kind))
    return landsOn(pipeline, startStageOf(pipeline, !!c.task.repo, c.task.start)) === 'worker'
  }
  const a = c.action
  if (!a) return true
  if (a.op === 'stop') return false
  // Then hands on when the task reaches done (it starts nothing on a task that is done already)
  if (a.op === 'then') return taskContext(a.taskId)?.stage?.kind !== 'done' && (a.then?.after ?? []).some((k) => !followUpsOf(a.taskId).includes(k))
  if (a.op !== 'approve') return true
  const ctx = taskContext(a.taskId)
  const next = ctx?.stage ? nextStage(ctx.pipeline, ctx.stage) : null
  if (!ctx || !next) return true
  return landsOn(ctx.pipeline, next) === 'worker' || ((next.kind === 'done' || runsFrom(ctx.pipeline, next, approvalsOf(taskLocal(a.taskId))).stop?.kind === 'done') && followUpsOf(a.taskId).length > 0)
}

/**
 * Apply a planned action (the person applied it). Throws an Error in the person's language. `undo` null: it stays.
 * `steps`: the terminal's own reviewed writes of this task since the action was staged (SigSteps).
 */
export async function applyTaskAction(plan: TaskActionPlan, opts: { steps?: SigSteps } = {}): Promise<{ undo: (() => boolean) | null }> {
  notFromAgent()
  if (codingReadOnly()) throw new Error(t('features.coding.setup.readOnly'))
  const id = plan.taskId
  if (!taskContext(id)) throw new Error(t('features.coding.term.err.gone'))
  await loadTask(id)
  const ctx = taskContext(id)
  if (!ctx || ctx.kind !== plan.kind) throw new Error(t('features.coding.term.err.gone'))
  const local = taskLocal(id)
  const running = isRunning(id)
  const phase = taskPhase(ctx.stage, local, running)
  const moved = () => new Error(t('features.coding.term.err.moved', { stage: ctx.stage?.name ?? '—', state: t(`features.coding.state.${phase}`) }))
  if (plan.op === 'stop') {
    if (!running) throw moved()
    await stopTask(id)
    return { undo: null }
  }
  // a version this device has not trusted: only the person confirms it, on the task page — for every action that writes
  // the task or lets the worker run it (Then too: in a local workspace the write would clear an agent's stamp)
  if (!(await isTrusted(id))) throw new Error(t('features.coding.term.err.confirm'))
  if (plan.op === 'then') {
    const now = followUpsOf(id)
    if (JSON.stringify(now) !== JSON.stringify(plan.then?.before ?? [])) throw moved()
    // done meanwhile: Then would start nothing (hand_on does)
    if (ctx.stage?.kind === 'done') throw moved()
    const after = plan.then?.after ?? []
    setFollowUps(id, after)
    return {
      undo: () => {
        if (JSON.stringify(followUpsOf(id)) !== JSON.stringify(after)) return false
        // an agent changed the task since: left alone (the write would end its wait for Confirm)
        if (taskWriteEndsConfirm(id)) return false
        setFollowUps(id, plan.then?.before ?? [])
        return true
      },
    }
  }
  // what the review showed must still be so: the same stage, state, content (or only the terminal's own reviewed
  // writes of it since) and local state
  if ((ctx.stage?.id ?? null) !== plan.stageId || phase !== plan.phase || !sigReached(plan.sig, sigOf(ctx), opts.steps) || (local.at ?? 0) !== plan.at) throw moved()
  if (plan.op === 'answer' && local.question !== plan.question) throw moved()
  if (plan.op === 'approve' && (ctx.stage ? nextStage(ctx.pipeline, ctx.stage)?.id : null) !== plan.toId) throw moved()
  // the pages that go along with a note / an answer: none the review did not list
  if (plan.op === 'rework' && newRefs(refPagesOf([], [plan.note ?? ''], id), plan.refs)) throw new Error(t('features.coding.term.err.refs'))
  if (plan.op === 'answer' && newRefs(refPagesOf([], [plan.answer ?? ''], id), plan.refs)) throw new Error(t('features.coding.term.err.refs'))
  switch (plan.op) {
    case 'approve':
      await approveTask(id, { confirm: false })
      return { undo: null }
    case 'rework':
      await reworkTask(id, plan.note ?? '', { confirm: false })
      return { undo: null }
    case 'answer':
      await answerTask(id, plan.answer ?? '', { confirm: false })
      return { undo: null }
    case 'run':
      await runTaskNow(id, { confirm: false })
      return { undo: null }
    case 'hand_on': {
      if (!plan.handOn) throw new Error(t('features.coding.term.err.handOn'))
      const made = await spawnFollowUp(id, plan.handOn)
      if (!made) throw new Error(t('features.coding.term.err.handOn'))
      return { undo: null }
    }
  }
  throw new Error(t('features.coding.term.err.handOn'))
}

/** Does the task wait for "Confirm on this device" (team: a version changed elsewhere; local: one an agent wrote)? */
export async function taskNeedsConfirm(taskId: ID): Promise<boolean> {
  const p = ws().pages[taskId]
  if (!p || !kindOfDb(p.databaseId)) return false
  return needsConfirm(p) && !(await isTrusted(taskId))
}

/** A row of a pipeline database that may need Confirm (the sync part of taskNeedsConfirm — no trust lookup). */
export function mayNeedConfirm(taskId: ID): boolean {
  const p = ws().pages[taskId]
  return !!p && !!kindOfDb(p.databaseId) && needsConfirm(p)
}

/** A task of a pipeline (a live row of a pipeline database)? */
export function isPipelineTask(id: ID): boolean {
  const p = ws().pages[id]
  return !!p && !p.trashed && !!kindOfDb(p.databaseId)
}

/**
 * Would a write from this tab end the task's wait for Confirm (trust.ts writeEndsConfirm: a local task an agent changed
 * last)? The terminal's Undo leaves such a task alone (sync — Undo cannot wait for a trust lookup).
 */
export function taskWriteEndsConfirm(taskId: ID): boolean {
  const p = ws().pages[taskId]
  return !!p && !!kindOfDb(p.databaseId) && writeEndsConfirm(p)
}

/** The coding role of a property of a pipeline database ('title' for its title; null: not a pipeline database / no role). */
export function codingRoleOf(dbId: ID, propId: ID): CodingRole | 'title' | null {
  if (!kindOfDb(dbId)) return null
  const db = ws().databases[dbId]
  if (!db) return null
  const props = codingProps(db)
  for (const [role, id] of Object.entries(props)) if (id === propId) return role as CodingRole | 'title'
  return null
}
