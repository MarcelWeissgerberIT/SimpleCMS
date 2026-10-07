/**
 * Coding pipeline — the "Coding" database (found by `Database.system: 'coding'`, created on first use) and
 * its pipeline (`Database.pipeline`, one entry per option of the Stage select). Store actions only.
 *
 *  - Rows = tasks: Name, Repo (the names the worker announced), Stage (the pipeline), Priority, Branch,
 *    Git (status text), PR / commit (url), Cost ($), Worker, Claimed at. The page body = goal + acceptance
 *    criteria (plus what the pipeline writes: the plan, summaries, rework notes, answers — origin 'coding').
 *  - Local workspace: top level. Team workspace: in the member's PRIVATE section (createPrivateDatabase), and
 *    only private ones count. Several marked databases of a kind are its projects (oldest first; #/coding shows the
 *    one this device picked — currentProjectId); the worker takes tasks from all of them.
 *  - Properties are found by name (EN / DE) and type, then by type — renamed columns keep working; a locked
 *    database gets no new options or pipeline changes (rows stay editable).
 */
import { defaultView, useWorkspace } from '../../store/store'
import { inTemplate, isEffectivelyTrashed } from '../../store/selectors'
import type { ColorName, Database, ID, Page, PipelineStage, PropertyDef, SelectOption, View } from '../../store/types'
import { newId } from '../../lib/ids'
import { createPrivateDatabase, useCloud } from '../../cloud'
import { NONE_KEY } from '../../database'
import { ALL_MESSAGES, t } from '../../i18n'
import { GIT_ACTIONS, PERMISSION_MODES, STAGE_KINDS, type StageKind } from './protocol'
import { useCoding } from './state'

export type CodingRole = 'repo' | 'stage' | 'priority' | 'branch' | 'git' | 'pr' | 'cost' | 'worker' | 'claimed' | 'followUps'

const ROLE_TYPE: Record<CodingRole, PropertyDef['type']> = {
  repo: 'select',
  stage: 'select',
  priority: 'select',
  branch: 'text',
  git: 'text',
  pr: 'url',
  cost: 'number',
  worker: 'text',
  claimed: 'date',
  followUps: 'multi_select',
}

/**
 * The pipeline databases: Coding (code changes), Business analysis (spec-driven documents) and QA (test cases) —
 * each found by its `Database.system`, each usable on its own; a task may hand on to another kind when it is done
 * (its "Then" field). Test cases from QA land in the Test cases database (`system: 'testcases'`).
 */
export const PIPELINE_KINDS = ['coding', 'spec', 'qa'] as const
export type PipelineKind = (typeof PIPELINE_KINDS)[number]
export const isPipelineKind = (v: unknown): v is PipelineKind => (PIPELINE_KINDS as readonly unknown[]).includes(v)
/** what a kind may hand on to when a task is done */
export const FOLLOW_UPS: Record<PipelineKind, PipelineKind[]> = { coding: [], spec: ['coding', 'qa'], qa: ['coding'] }
export const CODING_ROLES = Object.keys(ROLE_TYPE) as CodingRole[]

export type CodingProps = Partial<Record<CodingRole, ID>> & { title?: ID }

const ws = () => useWorkspace.getState()
export const inTeam = () => useCloud.getState().active.kind === 'cloud'

const both = (key: string) => [ALL_MESSAGES.en[key], ALL_MESSAGES.de[key]].filter(Boolean).map((n) => n.trim().toLowerCase())
const named = (p: PropertyDef, key: string) => both(key).includes(p.name.trim().toLowerCase())

/* ------------------------------------------------------------------ finding */

/** Every live pipeline database of a kind ("projects"), oldest first (team: private ones only). */
export function pipelineDbIdsOf(kind: PipelineKind | 'testcases'): ID[] {
  const { pages, databases } = ws()
  const team = inTeam()
  const found: Array<{ id: ID; at: number }> = []
  for (const db of Object.values(databases)) {
    if (db.system !== kind) continue
    const p = pages[db.id]
    if (!p || p.kind !== 'database' || p.trashed || isEffectivelyTrashed(pages, db.id) || inTemplate(pages, db.id)) continue
    if (team && !p.private) continue
    found.push({ id: db.id, at: p.createdAt })
  }
  return found.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1)).map((x) => x.id)
}

/** A pipeline database of a kind: the oldest live marked one (team: a private one only). */
export const pipelineDbId = (kind: PipelineKind | 'testcases'): ID | null => pipelineDbIdsOf(kind)[0] ?? null

/** The Coding database (the coding pipeline's first project). */
export const codingDbId = (): ID | null => pipelineDbId('coding')
/** Every pipeline database there is — every project of every kind (the worker takes tasks from all of them). */
export const pipelineDbIds = (): ID[] => PIPELINE_KINDS.flatMap((k) => pipelineDbIdsOf(k))
/** The kind of a pipeline database (null: not a live one). */
export function kindOfDb(dbId: ID | null | undefined): PipelineKind | null {
  if (!dbId) return null
  const k = ws().databases[dbId]?.system
  return isPipelineKind(k) && pipelineDbIdsOf(k).includes(dbId) ? k : null
}

/* ------------------------------------------------------------------ projects */

const PROJECT_KEY = (kind: PipelineKind) => `one.coding.project.${kind}`

/** The project #/coding shows for a kind on this device (localStorage), else the first one. */
export function currentProjectId(kind: PipelineKind): ID | null {
  const all = pipelineDbIdsOf(kind)
  let stored: string | null = null
  try {
    stored = localStorage.getItem(PROJECT_KEY(kind))
  } catch {
    stored = null
  }
  return stored && all.includes(stored) ? stored : (all[0] ?? null)
}

/** Show this project of its kind on #/coding (per device). */
export function chooseProject(dbId: ID): void {
  const kind = kindOfDb(dbId)
  if (!kind) return
  try {
    localStorage.setItem(PROJECT_KEY(kind), dbId)
  } catch {
    /* private window: the first project shows */
  }
  useCoding.setState((s) => ({ projectRev: s.projectRev + 1 }))
}

/** The property ids of the Coding database by role (by name in either language + type, then by type). */
export function codingProps(db: Database): CodingProps {
  const out: CodingProps = { title: db.properties.find((p) => p.type === 'title')?.id }
  const taken = new Set<ID>()
  for (const role of CODING_ROLES) {
    const prop = db.properties.find((p) => p.type === ROLE_TYPE[role] && !taken.has(p.id) && named(p, `features.coding.prop.${role}`))
    if (prop) {
      out[role] = prop.id
      taken.add(prop.id)
    }
  }
  // renamed columns: by type, in the order they were made
  for (const role of CODING_ROLES) {
    if (out[role]) continue
    const prop = db.properties.find((p) => p.type === ROLE_TYPE[role] && !taken.has(p.id) && !p.custom)
    if (prop) {
      out[role] = prop.id
      taken.add(prop.id)
    }
  }
  return out
}

/* ------------------------------------------------------------------ pipeline */

export interface ResolvedStage extends PipelineStage {
  name: string
  color: ColorName
  /** position in the pipeline */
  index: number
}

const STAGE_COLOR: Record<StageKind, ColorName> = { queue: 'gray', import: 'red', analyze: 'yellow', plan: 'blue', doc: 'pink', gate: 'orange', implement: 'purple', test: 'yellow', git: 'brown', done: 'green' }

/** The default pipeline: [stage key, kind, auto, extra]. */
const DEFAULTS: Array<[string, StageKind, boolean, Partial<PipelineStage>]> = [
  ['backlog', 'queue', false, {}],
  ['ready', 'queue', true, {}],
  ['plan', 'plan', true, { permissionMode: 'plan', maxTurns: 20 }],
  ['approve', 'gate', false, {}],
  ['implement', 'implement', true, { permissionMode: 'acceptEdits', maxTurns: 40 }],
  ['test', 'test', true, {}],
  ['review', 'gate', false, {}],
  ['ship', 'git', true, { gitAction: 'pr' }],
  ['done', 'done', false, {}],
]

export function defaultPipeline(): { options: SelectOption[]; pipeline: PipelineStage[] } {
  const options: SelectOption[] = []
  const pipeline: PipelineStage[] = []
  for (const [key, kind, auto, extra] of DEFAULTS) {
    const id = newId()
    options.push({ id, name: t(`features.coding.stage.${key}`), color: STAGE_COLOR[kind] })
    pipeline.push({ id, kind, auto, ...extra })
  }
  return { options, pipeline }
}

/**
 * The template "Modernise legacy code": understand the old code, design the new one, pin today's behaviour
 * down with tests, rebuild — every finding lands in the task page (plan stages write their own section).
 */
const MODERNISE: Array<[string, StageKind, boolean, Partial<PipelineStage>, string?]> = [
  ['backlog', 'queue', false, {}],
  // the old code arrives here: a ZIP or a clone address in the task panel → a new repo for the task
  ['import', 'import', false, {}],
  ['ready', 'queue', true, {}],
  // the repo's linter / compiler first: the analysis reads its findings
  ['staticAnalysis', 'analyze', true, {}],
  ['analyse', 'plan', true, { permissionMode: 'plan', maxTurns: 40 }, 'analyse'],
  ['design', 'plan', true, { permissionMode: 'plan', maxTurns: 30 }, 'design'],
  ['testplan', 'plan', true, { permissionMode: 'plan', maxTurns: 30 }, 'testplan'],
  ['approveConcept', 'gate', false, {}],
  ['writeTests', 'implement', true, { permissionMode: 'acceptEdits', maxTurns: 60 }, 'writeTests'],
  ['testOld', 'test', true, {}],
  ['rebuild', 'implement', true, { permissionMode: 'acceptEdits', maxTurns: 120 }, 'rebuild'],
  ['test', 'test', true, {}],
  ['review', 'gate', false, {}],
  ['ship', 'git', true, { gitAction: 'pr' }],
  ['done', 'done', false, {}],
]

/** Business analysis (spec-driven): analysis, specification, approval, the knowledge base — documents only. */
const SPEC: Array<[string, StageKind, boolean, Partial<PipelineStage>, string?]> = [
  ['backlog', 'queue', false, {}],
  ['ready', 'queue', true, {}],
  ['analyse', 'doc', true, { maxTurns: 40 }, 'specAnalyse'],
  ['specWrite', 'doc', true, { maxTurns: 40 }, 'specWrite'],
  ['approveSpec', 'gate', false, {}],
  ['record', 'doc', true, { maxTurns: 20 }, 'record'],
  ['done', 'done', false, {}],
]

/** QA: test cases from the task (and the code, if it has a repo) — rows of the Test cases database. */
const QA: Array<[string, StageKind, boolean, Partial<PipelineStage>, string?]> = [
  ['backlog', 'queue', false, {}],
  ['ready', 'queue', true, {}],
  ['testcases', 'doc', true, { maxTurns: 40, output: 'testcases' }, 'qaDesign'],
  ['approveCases', 'gate', false, {}],
  ['record', 'doc', true, { maxTurns: 20 }, 'record'],
  ['done', 'done', false, {}],
]

/**
 * "Explain the code": legacy code becomes One documents — an overview, the static analysis, a page per component (a
 * page tree), a documentation check. Nothing in the repository changes.
 */
const EXPLAIN: Array<[string, StageKind, boolean, Partial<PipelineStage>, string?]> = [
  ['backlog', 'queue', false, {}],
  ['import', 'import', false, {}],
  ['ready', 'queue', true, {}],
  ['overview', 'doc', true, { maxTurns: 40 }, 'explainOverview'],
  ['staticAnalysis', 'analyze', true, {}],
  ['components', 'doc', true, { maxTurns: 80, output: 'pages' }, 'explainComponents'],
  ['docCheck', 'doc', true, { maxTurns: 40 }, 'docCheck'],
  ['approveDocs', 'gate', false, {}],
  ['done', 'done', false, {}],
]

/**
 * "Review & merge": the standard pipeline, then Claude reviews the merge request's diff; at the gate the person reads
 * the review (Rework → Claude reviews again) — then the review is posted to the request and the worker merges it (the
 * person's glab / gh).
 */
const REVIEW_MERGE: Array<[string, StageKind, boolean, Partial<PipelineStage>, string?]> = [
  ['backlog', 'queue', false, {}],
  ['ready', 'queue', true, {}],
  ['plan', 'plan', true, { permissionMode: 'plan', maxTurns: 20 }],
  ['approve', 'gate', false, {}],
  ['implement', 'implement', true, { permissionMode: 'acceptEdits', maxTurns: 40 }],
  ['test', 'test', true, {}],
  ['ship', 'git', true, { gitAction: 'pr' }],
  ['aiReview', 'doc', true, { maxTurns: 40, output: 'review' }, 'aiReview'],
  // the person reads the review first: nothing is posted or merged before this gate
  ['approveMerge', 'gate', false, {}],
  ['postReview', 'git', true, { gitAction: 'comment' }],
  ['merge', 'git', true, { gitAction: 'merge' }],
  ['done', 'done', false, {}],
]

/** Business analysis → stories: the specification, approved, split into stories — a new coding project with a task each. */
const STORIES: Array<[string, StageKind, boolean, Partial<PipelineStage>, string?]> = [
  ['backlog', 'queue', false, {}],
  ['ready', 'queue', true, {}],
  ['analyse', 'doc', true, { maxTurns: 40 }, 'specAnalyse'],
  ['specWrite', 'doc', true, { maxTurns: 40 }, 'specWrite'],
  ['approveSpec', 'gate', false, {}],
  ['stories', 'doc', true, { maxTurns: 40, output: 'stories' }, 'stories'],
  ['done', 'done', false, {}],
]

export const PIPELINE_TEMPLATES = ['standard', 'modernise', 'explain', 'reviewmerge', 'spec', 'stories', 'qa'] as const
/** the templates a kind offers in the pipeline editor (the first is its default) */
export const KIND_TEMPLATES: Record<PipelineKind, PipelineTemplate[]> = { coding: ['standard', 'modernise', 'explain', 'reviewmerge'], spec: ['spec', 'stories'], qa: ['qa'] }
const TEMPLATE_ROWS: Partial<Record<PipelineTemplate, Array<[string, StageKind, boolean, Partial<PipelineStage>, string?]>>> = { modernise: MODERNISE, explain: EXPLAIN, reviewmerge: REVIEW_MERGE, spec: SPEC, stories: STORIES, qa: QA }
export type PipelineTemplate = (typeof PIPELINE_TEMPLATES)[number]

/**
 * A template's stages; `keep` = the stages there are now — a stage of the same kind (in order) keeps its id, so
 * tasks standing there stay in a stage.
 */
export function templatePipeline(which: PipelineTemplate, keep: Array<{ id: ID; kind: StageKind }> = []): Array<{ option: SelectOption; stage: PipelineStage }> {
  const rows = TEMPLATE_ROWS[which] ?? DEFAULTS.map(([k, kind, auto, extra]) => [k, kind, auto, extra] as [string, StageKind, boolean, Partial<PipelineStage>, string?])
  const used = new Set<ID>()
  return rows.map(([key, kind, auto, extra, how]) => {
    const id = keep.find((s) => s.kind === kind && !used.has(s.id))?.id ?? newId()
    used.add(id)
    const instructions = how ? t(`features.coding.template.how.${how}`) : undefined
    return { option: { id, name: t(`features.coding.stage.${key}`), color: STAGE_COLOR[kind] }, stage: { id, kind, auto, ...extra, ...(instructions ? { instructions } : {}) } }
  })
}

/** What a document stage's text becomes besides its section (types.ts PipelineStage.output). */
export const DOC_OUTPUTS = ['testcases', 'pages', 'review', 'stories'] as const

const clampTurns = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(1, Math.min(200, Math.floor(n))) : undefined)

/** One stored stage, sanitized (unknown kinds become a queue). */
export function sanitizeStage(raw: unknown, id: ID): PipelineStage {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const kind = (STAGE_KINDS as readonly string[]).includes(String(r.kind)) ? (r.kind as StageKind) : 'queue'
  const out: PipelineStage = { id, kind, auto: r.auto === true && kind !== 'gate' && kind !== 'done' }
  if (typeof r.instructions === 'string' && r.instructions.trim()) out.instructions = r.instructions.slice(0, 20_000)
  if (typeof r.next === 'string' && r.next) out.next = r.next
  if ((PERMISSION_MODES as readonly string[]).includes(String(r.permissionMode))) out.permissionMode = r.permissionMode as PipelineStage['permissionMode']
  const turns = clampTurns(r.maxTurns)
  if (turns) out.maxTurns = turns
  if (kind === 'git') out.gitAction = (GIT_ACTIONS as readonly string[]).includes(String(r.gitAction)) ? (r.gitAction as PipelineStage['gitAction']) : 'pr'
  if (kind === 'doc' && (DOC_OUTPUTS as readonly unknown[]).includes(r.output)) out.output = r.output as PipelineStage['output']
  return out
}

/** The pipeline in Stage-option order: every option has a stage (a missing entry = a manual queue). */
export function readPipeline(db: Database | undefined): ResolvedStage[] {
  if (!db) return []
  const props = codingProps(db)
  const stageProp = db.properties.find((p) => p.id === props.stage)
  const options = stageProp?.options ?? []
  const stored = new Map<ID, unknown>()
  for (const s of Array.isArray(db.pipeline) ? db.pipeline : []) if (s && typeof s === 'object' && typeof (s as PipelineStage).id === 'string') stored.set((s as PipelineStage).id, s)
  const ids = new Set(options.map((o) => o.id))
  return options.map((o, index) => {
    const st = sanitizeStage(stored.get(o.id), o.id)
    if (st.next && !ids.has(st.next)) delete st.next
    return { ...st, name: o.name, color: o.color, index }
  })
}

/** The stage after `stage` (its `next`, else the following option); null at the end. */
export function nextStage(pipeline: ResolvedStage[], stage: ResolvedStage): ResolvedStage | null {
  if (stage.next) return pipeline.find((s) => s.id === stage.next) ?? null
  return pipeline[stage.index + 1] ?? null
}

/** The nearest stage of one of `kinds` before / after `stage`. */
export function stageNear(pipeline: ResolvedStage[], stage: ResolvedStage, kinds: StageKind[], dir: -1 | 1): ResolvedStage | null {
  for (let i = stage.index + dir; i >= 0 && i < pipeline.length; i += dir) if (kinds.includes(pipeline[i]!.kind)) return pipeline[i]!
  return null
}

/** Where a task stands: its Stage option's stage (no stage yet = the first one). */
export function stageOfRow(pipeline: ResolvedStage[], props: CodingProps, row: Page): ResolvedStage | null {
  const v = props.stage ? row.properties[props.stage] : null
  return pipeline.find((s) => s.id === v) ?? pipeline[0] ?? null
}

/**
 * Save the pipeline: the Stage options (names, colours, order) and Database.pipeline together. Refuses a
 * locked database. Rows of a removed stage keep the option id (they show without a stage until moved).
 */
export function savePipeline(dbId: ID, stages: Array<{ option: SelectOption; stage: PipelineStage }>): boolean {
  const db = ws().databases[dbId]
  if (!db || db.locked) return false
  const props = codingProps(db)
  if (!props.stage) return false
  const options = stages.map(({ option }) => option)
  const ids = new Set(options.map((o) => o.id))
  const pipeline = stages.map(({ option, stage }) => {
    const clean = sanitizeStage({ ...stage }, option.id)
    if (clean.next && !ids.has(clean.next)) delete clean.next
    return clean
  })
  ws().updateProperty(dbId, props.stage, { options })
  ws().updateDatabase(dbId, { pipeline })
  return true
}

/* ------------------------------------------------------------------ creating */

const PRIORITIES: Array<[string, ColorName]> = [
  ['high', 'red'],
  ['medium', 'yellow'],
  ['low', 'gray'],
]

function baseProps(kind: PipelineKind = 'coding', template?: PipelineTemplate): { properties: PropertyDef[]; pipeline: PipelineStage[] } {
  const which = template && KIND_TEMPLATES[kind].includes(template) ? template : kind === 'coding' ? null : kind
  const made = which && which !== 'standard' ? templatePipeline(which) : null
  const { options, pipeline } = made ? { options: made.map((m) => m.option), pipeline: made.map((m) => m.stage) } : defaultPipeline()
  const p = (role: CodingRole, extra: Partial<PropertyDef> = {}): PropertyDef => ({ id: newId(), name: t(`features.coding.prop.${role}`), type: ROLE_TYPE[role], ...extra })
  const properties: PropertyDef[] = [
    { id: newId(), name: t('features.coding.prop.name'), type: 'title' },
    p('repo', { options: [] }),
    p('stage', { options }),
    p('priority', { options: PRIORITIES.map(([key, color]) => ({ id: newId(), name: t(`features.coding.priority.${key}`), color })) }),
    p('branch'),
    p('git'),
    p('pr'),
    p('cost', { numberFormat: 'dollar' }),
    p('worker'),
    p('claimed'),
  ]
  // "Then": what this task hands on to when it is done (Business analysis → Coding / QA, QA → Coding)
  if (FOLLOW_UPS[kind].length) properties.push(p('followUps', { options: FOLLOW_UPS[kind].map((k, i) => ({ id: newId(), name: t(`features.coding.pipe.${k}`), color: (['purple', 'green'] as ColorName[])[i]! })) }))
  return { properties, pipeline }
}

function views(properties: PropertyDef[], kind: PipelineKind = 'coding'): View[] {
  const db = { properties } as Database
  const r = codingProps(db)
  const code = kind === 'coding'
  const board = defaultView('board', db, t('features.coding.view.board'))
  board.groupBy = r.stage ?? null
  // every task has a stage: no "No value" column
  board.hiddenGroups = [NONE_KEY]
  board.visibleProperties = (code ? [r.repo, r.priority, r.branch, r.cost] : [r.repo, r.priority, r.followUps, r.cost]).filter((x): x is ID => !!x)
  const table = defaultView('table', db, t('features.coding.view.table'))
  table.visibleProperties = (code ? [r.repo, r.stage, r.priority, r.branch, r.git, r.pr, r.cost, r.worker, r.claimed] : [r.repo, r.stage, r.priority, r.followUps, r.cost, r.worker, r.claimed]).filter((x): x is ID => !!x)
  return [board, table]
}

/** Is this workspace read-only for the person (a viewer)? */
export const codingReadOnly = () => useCloud.getState().readOnly

const KIND_ICON: Record<PipelineKind, string> = { coding: 'code', spec: 'notepad', qa: 'counter' }

/**
 * A pipeline database — created when there is none (top level; private in a team), its stages from `template` (one
 * of the kind's, e.g. Coding: standard | modernise — the latter starts with an Import stage). Throws for a viewer.
 */
export function ensurePipelineDb(kind: PipelineKind, template?: PipelineTemplate, project?: { title: string }): ID {
  const found = project ? null : pipelineDbId(kind)
  if (found) return found
  if (codingReadOnly()) throw new Error('read-only')
  const { properties, pipeline } = baseProps(kind, template)
  const title = project?.title.trim().slice(0, 200) || (kind === 'coding' ? t('features.coding.dbTitle') : t(`features.coding.pipe.${kind}.db`))
  const data = { id: newId(), parentId: null, title, icon: { type: 'asset' as const, value: KIND_ICON[kind] }, properties, views: views(properties, kind) }
  const id = inTeam() ? createPrivateDatabase(data) : ws().createDatabase(data)
  ws().updateDatabase(id, { system: kind, pipeline })
  // a worker that connected before the database existed: its repos are the Repo options
  addRepoOptions(id, (useCoding.getState().worker?.repos ?? []).map((r) => r.name))
  return id
}

/** The Coding database — created when there is none. */
export const ensureCodingDb = (): ID => ensurePipelineDb('coding')

/**
 * A new project of a kind: its own pipeline database (e.g. the stories of one epic), shown on #/coding at once. Its
 * pipeline is a copy of the current project's (or the template's when given / there is none).
 */
export function createProject(kind: PipelineKind, title: string, template?: PipelineTemplate, opts: { show?: boolean } = {}): ID {
  const from = template ? null : currentProjectId(kind)
  const id = ensurePipelineDb(kind, template ?? KIND_TEMPLATES[kind][0], { title })
  const src = from ? ws().databases[from] : undefined
  const stages = src && !template ? readPipeline(src) : []
  if (stages.length) {
    // the same stages under new option ids (each database's Stage select has its own)
    const ids = new Map(stages.map((st) => [st.id, newId()]))
    savePipeline(
      id,
      stages.map(({ name, color, index: _i, ...st }) => {
        const nid = ids.get(st.id)!
        return { option: { id: nid, name, color }, stage: { ...st, id: nid, ...(st.next ? { next: ids.get(st.next) ?? null } : {}) } }
      }),
    )
  }
  if (opts.show !== false) chooseProject(id)
  return id
}

/** Move a project (database + its tasks) to the trash; Undo / the trash bring it back. Refuses a locked one. */
export function trashProject(dbId: ID): boolean {
  const db = ws().databases[dbId]
  if (!db || db.locked || !kindOfDb(dbId) || codingReadOnly()) return false
  ws().trashPage(dbId)
  useCoding.setState((s) => ({ projectRev: s.projectRev + 1 }))
  return true
}

/* ------------------------------------------------------------------ test cases (QA) */

export type CaseRole = 'caseId' | 'task' | 'area' | 'type' | 'priority' | 'preconditions' | 'steps' | 'expected' | 'status'
const CASE_TYPE: Record<CaseRole, PropertyDef['type']> = { caseId: 'text', task: 'text', area: 'text', type: 'select', priority: 'select', preconditions: 'text', steps: 'text', expected: 'text', status: 'select' }
export const CASE_TYPES = ['functional', 'edge', 'negative', 'regression', 'nonfunctional'] as const
export const CASE_STATUS = ['notRun', 'passed', 'failed', 'blocked'] as const

/** The Test cases database's property ids by role (by name in either language + type). */
export function caseProps(db: Database): Partial<Record<CaseRole, ID>> & { title?: ID } {
  const out: Partial<Record<CaseRole, ID>> & { title?: ID } = { title: db.properties.find((p) => p.type === 'title')?.id }
  for (const role of Object.keys(CASE_TYPE) as CaseRole[]) {
    const prop = db.properties.find((p) => p.type === CASE_TYPE[role] && named(p, `features.coding.case.${role}`))
    if (prop) out[role] = prop.id
  }
  return out
}

/** The Test cases database — created when QA first hands in test cases. */
export function ensureCaseDb(): ID {
  const found = pipelineDbId('testcases')
  if (found) return found
  if (codingReadOnly()) throw new Error('read-only')
  const p = (role: CaseRole, extra: Partial<PropertyDef> = {}): PropertyDef => ({ id: newId(), name: t(`features.coding.case.${role}`), type: CASE_TYPE[role], ...extra })
  const opts = (keys: readonly string[], prefix: string, colors: ColorName[]) => keys.map((k, i) => ({ id: newId(), name: t(`${prefix}.${k}`), color: colors[i % colors.length]! }))
  const properties: PropertyDef[] = [
    { id: newId(), name: t('features.coding.case.title'), type: 'title' },
    p('caseId'),
    p('status', { options: opts(CASE_STATUS, 'features.coding.case.st', ['gray', 'green', 'red', 'orange']) }),
    p('priority', { options: PRIORITIES.map(([key, color]) => ({ id: newId(), name: t(`features.coding.priority.${key}`), color })) }),
    p('type', { options: opts(CASE_TYPES, 'features.coding.case.ty', ['blue', 'purple', 'red', 'yellow', 'brown']) }),
    p('area'),
    p('task'),
    p('preconditions'),
    p('steps'),
    p('expected'),
  ]
  const db = { properties } as Database
  const r = caseProps(db)
  const table = defaultView('table', db, t('features.coding.view.table'))
  table.visibleProperties = [r.caseId, r.status, r.priority, r.type, r.area, r.task, r.steps, r.expected].filter((x): x is ID => !!x)
  const board = defaultView('board', db, t('features.coding.case.byStatus'))
  board.groupBy = r.status ?? null
  board.visibleProperties = [r.caseId, r.priority, r.type, r.task].filter((x): x is ID => !!x)
  const data = { id: newId(), parentId: null, title: t('features.coding.case.db'), icon: { type: 'asset' as const, value: 'counter' }, properties, views: [table, board] }
  const id = inTeam() ? createPrivateDatabase(data) : ws().createDatabase(data)
  ws().updateDatabase(id, { system: 'testcases' })
  return id
}

/** Add the repo names a worker announced to the Repo select (never in a locked database). */
export function addRepoOptions(dbId: ID, names: string[]): void {
  const db = ws().databases[dbId]
  if (!db || db.locked) return
  const props = codingProps(db)
  const prop = db.properties.find((p) => p.id === props.repo)
  if (!prop) return
  const options = [...(prop.options ?? [])]
  const palette: ColorName[] = ['blue', 'green', 'purple', 'pink', 'brown', 'yellow', 'orange', 'red', 'gray']
  let added = false
  for (const name of names) {
    if (options.some((o) => o.name === name)) continue
    options.push({ id: newId(), name, color: palette[options.length % palette.length]! })
    added = true
  }
  if (added) ws().updateProperty(dbId, prop.id, { options })
}

/** The option id of a select by name (case-insensitive). */
export function optionByName(db: Database, propId: ID | undefined, name: string): ID | null {
  const prop = db.properties.find((p) => p.id === propId)
  const n = name.trim().toLowerCase()
  return prop?.options?.find((o) => o.name.trim().toLowerCase() === n)?.id ?? null
}

/** The option name of a select value. */
export function optionName(db: Database, propId: ID | undefined, value: unknown): string | null {
  const prop = db.properties.find((p) => p.id === propId)
  return prop?.options?.find((o) => o.id === value)?.name ?? null
}

/** Priority rank of a row: high 0 · medium / none 1 · low 2 (by the option's position). */
export function priorityRank(db: Database, props: CodingProps, row: Page): number {
  const prop = db.properties.find((p) => p.id === props.priority)
  const v = props.priority ? row.properties[props.priority] : null
  const i = prop?.options?.findIndex((o) => o.id === v) ?? -1
  return i < 0 ? 1 : Math.min(i, 2)
}
