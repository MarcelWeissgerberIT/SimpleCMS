/**
 * Coding pipeline — checking a new task before it is made, pure: ONE set of rules for the AI terminal's create_task
 * (terminal.ts planNewTask throws the first problem as Claude's tool error, word for word as it always did) and a work
 * order's chain (each planned step is checked the same way before anything is created — the plate names every problem
 * of a step by its code). The world is read by the caller (terminal.ts draftWorld: the projects, the connected worker,
 * its repos and branches); nothing here reads the store.
 *
 * The checks, in order: read-only · kind · project · title · goal · criteria · repo (name, needed for coding unless the
 * pipeline imports the code, announced by the connected worker, an existing option of a locked project) · branch
 * (coding only: a name, never the base branch, one of the worker's when it announces them) · priority · Then. A problem
 * that makes the later checks meaningless (read-only, kind, project, a repo that is no name) ends the list.
 */
import type { ID } from '../../store/types'
import { REPO_NAME } from './protocol'
import { FOLLOW_UPS, isPipelineKind, startStageOf, type PipelineKind, type ResolvedStage } from './stages'

/** A branch name the Branch field takes (the worker checks it again with git's own rules). */
export const BRANCH_NAME = /^[A-Za-z0-9._/-]{1,200}$/

/** The terminal's bounds of a task (a work order's plan has tighter ones — orders/types.ts PLAN_LIMITS). */
export const DRAFT_LIMITS = { title: 200, goal: 8000, criteria: 30, criterion: 500 } as const

const PRIORITIES = ['high', 'medium', 'low'] as const

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

/** What the checks read of the workspace and the connected worker (terminal.ts draftWorld builds it from the store). */
export interface DraftWorld {
  /** a team viewer: nothing can be created */
  readOnly: boolean
  /** the live projects of a kind, oldest first */
  projects: (kind: PipelineKind) => ID[]
  /** a project's title as #/coding shows it */
  title: (projectId: ID) => string
  /** the project #/coding shows for a kind on this device (null: none yet) */
  current: (kind: PipelineKind) => ID | null
  /** a project's pipeline — null: the kind's default template (a project is made when the task is applied) */
  pipeline: (kind: PipelineKind, projectId: ID | null) => ResolvedStage[]
  /** a worker is connected */
  connected: boolean
  /** the repos the connected worker announced ([] when none is connected) */
  announced: string[]
  /** repo names to offer: the connected worker's and those already in the Repo selects */
  known: string[]
  /** the connected worker's branches of a repo (never its base branch) */
  branches: (repo: string | null) => { base: string | null; list: string[] }
  /** a locked project: the repo names its Repo select holds; null: not locked */
  lockedRepos: (projectId: ID) => string[] | null
}

export type DraftIssueCode =
  | 'readOnly'
  | 'kind'
  | 'project'
  | 'titleEmpty'
  | 'titleLong'
  | 'goalLong'
  | 'criteriaMany'
  | 'criterionLong'
  | 'repoName'
  | 'repoMissing'
  | 'repoUnknown'
  | 'repoLocked'
  | 'branchName'
  | 'branchBase'
  | 'branchUnknown'
  | 'priority'
  | 'then'

/** One problem of a draft: its code (the plate words it), the field, and the English sentence Claude gets. */
export interface DraftIssue {
  code: DraftIssueCode
  field: 'readOnly' | 'kind' | 'project' | 'title' | 'goal' | 'criteria' | 'repo' | 'branch' | 'priority' | 'then'
  /** model-facing (the AI terminal's tool error) — English */
  message: string
  /** values the sentence names (counts, names) */
  vars?: Record<string, string | number>
}

/** A draft that passed: the values a task is made from (terminal.ts planNewTask builds its review from them). */
export interface TaskDraft {
  kind: PipelineKind
  projectId: ID | null
  pipeline: ResolvedStage[]
  title: string
  goal: string
  criteria: string[]
  repo: string | null
  branch: string | null
  priority: 'high' | 'medium' | 'low'
  then: PipelineKind[]
  start: boolean
  /** where it starts */
  first: ResolvedStage | undefined
}

const q = (s: string) => JSON.stringify(s)

/** The problems of a new task (in the order the terminal always checked them) and, without any, the draft. */
export function checkTaskDraft(input: NewTaskInput, world: DraftWorld): { draft: TaskDraft | null; issues: DraftIssue[] } {
  const issues: DraftIssue[] = []
  const fail = (code: DraftIssueCode, field: DraftIssue['field'], message: string, vars?: DraftIssue['vars']) => issues.push({ code, field, message, ...(vars ? { vars } : {}) })
  const done = () => ({ draft: null, issues })
  if (world.readOnly) {
    fail('readOnly', 'readOnly', 'This workspace is read-only for the person: pipeline tasks cannot be created or changed.')
    return done()
  }
  const kind = input.kind ?? 'coding'
  if (!isPipelineKind(kind)) {
    fail('kind', 'kind', '"kind" must be coding, spec or qa.')
    return done()
  }
  const projects = world.projects(kind)
  let projectId: ID | null = input.projectId ?? null
  if (projectId && !projects.includes(projectId)) {
    fail('project', 'project', `No ${kind} project with id ${q(projectId)}. ${projects.length ? `Projects: ${projects.map((id) => `${q(world.title(id))} (id: ${id})`).join(', ')}.` : 'There is none yet: omit project_id and one is created when the task is applied.'}`, { id: projectId })
    return done()
  }
  projectId ??= world.current(kind)
  const pipeline = world.pipeline(kind, projectId)

  const title = input.title.replace(/\s+/g, ' ').trim()
  if (!title) fail('titleEmpty', 'title', '"title" must not be empty.')
  else if (title.length > DRAFT_LIMITS.title) fail('titleLong', 'title', `"title" is too long (${title.length} characters, at most ${DRAFT_LIMITS.title}).`, { n: title.length, max: DRAFT_LIMITS.title })
  const goal = input.goal.trim()
  if (goal.length > DRAFT_LIMITS.goal) fail('goalLong', 'goal', `"goal" is too long (${goal.length} characters, at most ${DRAFT_LIMITS.goal}). Keep it to what Claude Code needs; link pages for the rest.`, { n: goal.length, max: DRAFT_LIMITS.goal })
  const criteria = (input.criteria ?? []).map((c) => (typeof c === 'string' ? c.replace(/\s+/g, ' ').trim() : '')).filter(Boolean)
  if (criteria.length > DRAFT_LIMITS.criteria) fail('criteriaMany', 'criteria', `Too many criteria (${criteria.length}, at most ${DRAFT_LIMITS.criteria}).`, { n: criteria.length, max: DRAFT_LIMITS.criteria })
  else {
    const long = criteria.find((c) => c.length > DRAFT_LIMITS.criterion)
    if (long) fail('criterionLong', 'criteria', `A criterion is too long (${long.length} characters, at most ${DRAFT_LIMITS.criterion}).`, { n: long.length, max: DRAFT_LIMITS.criterion })
  }

  // the repo
  const intake = pipeline.some((s) => s.kind === 'import')
  const repo = input.repo?.trim() || null
  if (repo && !REPO_NAME.test(repo)) {
    fail('repoName', 'repo', `${q(repo)} is not a repo name (letters, digits, . _ -; as the worker announces it).`, { repo })
    return done()
  }
  if (!repo && kind === 'coding' && !intake) fail('repoMissing', 'repo', `A coding task needs "repo" (list_pipelines lists the repos${world.known.length ? `: ${world.known.join(', ')}` : ''}).`)
  if (repo && world.announced.length && !world.known.includes(repo)) fail('repoUnknown', 'repo', `The worker does not serve a repo ${q(repo)}. Repos: ${world.known.join(', ')}.`, { repo })
  const locked = projectId ? world.lockedRepos(projectId) : null
  if (repo && locked && !locked.some((n) => n.trim().toLowerCase() === repo.toLowerCase()))
    fail('repoLocked', 'repo', `The project ${q(world.title(projectId!))} is locked: only its existing repos can be used (${locked.join(', ') || 'none'}).`, { repo })

  // the branch: coding only, never the base branch, one of the worker's when it announces them
  let branch = input.branch?.trim() || null
  if (kind !== 'coding') branch = null
  if (branch) {
    const wb = world.branches(repo)
    if (!BRANCH_NAME.test(branch)) fail('branchName', 'branch', `${q(branch)} is not a branch name.`, { branch })
    else if (wb.base && branch === wb.base) fail('branchBase', 'branch', `${q(branch)} is the repo's base branch — the worker never works on it. Omit "branch": the worker makes its own.`, { branch })
    else if (world.connected && repo && wb.base !== null && !wb.list.includes(branch))
      fail('branchUnknown', 'branch', `The worker has no branch ${q(branch)} in ${repo}. Its branches: ${wb.list.slice(0, 30).join(', ') || 'none'}. Omit "branch" and the worker makes its own.`, { branch, repo })
  }
  const priority = input.priority ?? 'medium'
  if (!PRIORITIES.includes(priority)) fail('priority', 'priority', '"priority" must be high, medium or low.')

  // Then: what the task hands on to when it is done
  const then: PipelineKind[] = []
  const allowed = FOLLOW_UPS[kind]
  if (input.then !== undefined && input.then !== null) {
    if (!Array.isArray(input.then)) fail('then', 'then', '"then" must be a list of pipeline kinds.')
    else
      for (const k of input.then as unknown[]) {
        if (!isPipelineKind(k) || !allowed.includes(k)) {
          fail('then', 'then', `${q(String(k))} cannot be used in "then" here — allowed: ${allowed.length ? allowed.join(', ') : 'none (this pipeline hands on to nothing)'}.`, { kind: String(k) })
          break
        }
        if (!then.includes(k)) then.push(k)
      }
  }
  if (issues.length) return done()
  const start = input.start === true
  return { draft: { kind, projectId, pipeline, title, goal, criteria, repo, branch, priority, then, start, first: startStageOf(pipeline, !!repo, start) }, issues }
}
