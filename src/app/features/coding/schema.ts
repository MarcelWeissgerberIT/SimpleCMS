/**
 * Coding pipeline — the "Coding" database (found by `Database.system: 'coding'`, created on first use) and
 * its pipeline (`Database.pipeline`, one entry per option of the Stage select). Store actions only.
 *
 *  - Rows = tasks: Name, Repo (the names the worker announced), Stage (the pipeline), Priority, Branch,
 *    Git (status text), PR / commit (url), Cost ($), Worker, Claimed at. The page body = goal + acceptance
 *    criteria (plus what the pipeline writes: the plan, summaries, rework notes, answers — origin 'coding').
 *  - Local workspace: top level. Team workspace: in the member's PRIVATE section (createPrivateDatabase), and
 *    only private ones count. Several marked databases: the oldest live one counts.
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

export type CodingRole = 'repo' | 'stage' | 'priority' | 'branch' | 'git' | 'pr' | 'cost' | 'worker' | 'claimed'

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
}
export const CODING_ROLES = Object.keys(ROLE_TYPE) as CodingRole[]

export type CodingProps = Partial<Record<CodingRole, ID>> & { title?: ID }

const ws = () => useWorkspace.getState()
export const inTeam = () => useCloud.getState().active.kind === 'cloud'

const both = (key: string) => [ALL_MESSAGES.en[key], ALL_MESSAGES.de[key]].filter(Boolean).map((n) => n.trim().toLowerCase())
const named = (p: PropertyDef, key: string) => both(key).includes(p.name.trim().toLowerCase())

/* ------------------------------------------------------------------ finding */

/** The Coding database: the oldest live marked one (team: a private one only). */
export function codingDbId(): ID | null {
  const { pages, databases } = ws()
  const team = inTeam()
  let best: { id: ID; at: number } | null = null
  for (const db of Object.values(databases)) {
    if (db.system !== 'coding') continue
    const p = pages[db.id]
    if (!p || p.kind !== 'database' || p.trashed || isEffectivelyTrashed(pages, db.id) || inTemplate(pages, db.id)) continue
    if (team && !p.private) continue
    if (!best || p.createdAt < best.at || (p.createdAt === best.at && db.id < best.id)) best = { id: db.id, at: p.createdAt }
  }
  return best?.id ?? null
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

const STAGE_COLOR: Record<StageKind, ColorName> = { queue: 'gray', plan: 'blue', gate: 'orange', implement: 'purple', test: 'yellow', git: 'brown', done: 'green' }

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

function baseProps(): { properties: PropertyDef[]; pipeline: PipelineStage[] } {
  const { options, pipeline } = defaultPipeline()
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
  return { properties, pipeline }
}

function views(properties: PropertyDef[]): View[] {
  const db = { properties } as Database
  const r = codingProps(db)
  const board = defaultView('board', db, t('features.coding.view.board'))
  board.groupBy = r.stage ?? null
  // every task has a stage: no "No value" column
  board.hiddenGroups = [NONE_KEY]
  board.visibleProperties = [r.repo, r.priority, r.branch, r.cost].filter((x): x is ID => !!x)
  const table = defaultView('table', db, t('features.coding.view.table'))
  table.visibleProperties = [r.repo, r.stage, r.priority, r.branch, r.git, r.pr, r.cost, r.worker, r.claimed].filter((x): x is ID => !!x)
  return [board, table]
}

/** Is this workspace read-only for the person (a viewer)? */
export const codingReadOnly = () => useCloud.getState().readOnly

/** The Coding database — created when there is none (top level; private in a team). Throws for a viewer. */
export function ensureCodingDb(): ID {
  const found = codingDbId()
  if (found) return found
  if (codingReadOnly()) throw new Error('read-only')
  const { properties, pipeline } = baseProps()
  const data = { id: newId(), parentId: null, title: t('features.coding.dbTitle'), icon: { type: 'asset' as const, value: 'code' }, properties, views: views(properties) }
  const id = inTeam() ? createPrivateDatabase(data) : ws().createDatabase(data)
  ws().updateDatabase(id, { system: 'coding', pipeline })
  // a worker that connected before the database existed: its repos are the Repo options
  addRepoOptions(id, (useCoding.getState().worker?.repos ?? []).map((r) => r.name))
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
