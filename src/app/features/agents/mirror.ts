/**
 * Custom agents — the recipe "Mirror a list into a database": items of another tool (reached through one of the
 * person's MCP servers) are kept in step with a One database by a scheduled agent.
 *
 *  - createMirror(): ONE action, one Undo — the database (its properties, the key, the person's own fields marked
 *    "Only by hand", six views) and its report page, below the page the person picked (team workspace: in the
 *    member's Private section, createPrivateDatabase / createPrivatePage). Store actions only, like the mail and
 *    coding databases. The toast's Undo removes both again — and the agent, when it was saved from the draft.
 *  - mirrorDraft(): the agent the editor opens with — weekdays 07:30 in this browser's time zone, browser runner,
 *    proposals first, the source server with its reading tools ticked (when its last connection test listed them),
 *    scope = the database, the report page, $1.00 per run, instructions in the UI language with PLACEHOLDERS the
 *    person replaces (MIRROR_PLACEHOLDERS; the editor refuses to save a switched-on agent that still holds one).
 *
 * Generic on purpose: no service is named or preset; the source is whatever MCP server the person added.
 */
import { defaultView, useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { inTemplate, isEffectivelyTrashed } from '../../store/selectors'
import { localTimeZone } from '../../store/agents'
import type { ColorName, ColorRule, CustomAgent, Database, Filter, FilterGroup, ID, Page, PageIcon, PropertyDef, PropertyType, SelectOption, View } from '../../store/types'
import { newId } from '../../lib/ids'
import { createPrivateDatabase, createPrivatePage, useCloud } from '../../cloud'
import { ALL_MESSAGES, t } from '../../i18n'
import { readServers } from '../ai/mcp-servers/config'
import { isReadTool, testedTools } from './mcpTools'
import { blankAgent } from './recipes'

export const MIRROR_ICON: PageIcon = { type: 'lucide', value: 'Layers', color: 'brown' }
const REPORT_ICON: PageIcon = { type: 'lucide', value: 'ClipboardList' }
/** The schedule: every weekday at this time (the person's time zone). */
export const MIRROR_AT = '07:30'
export const MIRROR_BUDGET_USD = 1

export type MirrorRole =
  | 'name'
  | 'key'
  | 'link'
  | 'srcStatus'
  | 'srcPriority'
  | 'owner'
  | 'tags'
  | 'changedAt'
  | 'comments'
  | 'lastComment'
  | 'lastCommentAt'
  | 'newComment'
  | 'waiting'
  | 'clarity'
  | 'why'
  | 'gone'
  | 'myStatus'
  | 'myPriority'
  | 'nextStep'
  | 'due'

/** Every property of the database, in order, with its type. */
export const MIRROR_PROPS: ReadonlyArray<[MirrorRole, PropertyType]> = [
  ['name', 'title'],
  ['key', 'text'],
  ['link', 'url'],
  ['srcStatus', 'select'],
  ['srcPriority', 'select'],
  ['owner', 'text'],
  ['tags', 'multi_select'],
  ['changedAt', 'date'],
  ['comments', 'number'],
  ['lastComment', 'text'],
  ['lastCommentAt', 'date'],
  ['newComment', 'checkbox'],
  ['waiting', 'checkbox'],
  ['clarity', 'select'],
  ['why', 'text'],
  ['gone', 'checkbox'],
  ['myStatus', 'status'],
  ['myPriority', 'select'],
  ['nextStep', 'text'],
  ['due', 'date'],
]

/** The person's own fields: "Only by hand" (PropertyDef.agentReadOnly) — no agent ever writes them. */
export const HAND_ROLES: readonly MirrorRole[] = ['myStatus', 'myPriority', 'nextStep', 'due']
/** Written by the agent as the source has them. */
const SOURCE_ROLES: readonly MirrorRole[] = ['link', 'srcStatus', 'srcPriority', 'owner', 'tags', 'changedAt', 'comments', 'lastComment', 'lastCommentAt', 'gone']
/** The agent's own reading of an item. */
const AGENT_ROLES: readonly MirrorRole[] = ['newComment', 'waiting', 'clarity', 'why']

export const CLARITY = ['clear', 'open', 'blocked', 'elsewhere', 'done'] as const
export type Clarity = (typeof CLARITY)[number]
const CLARITY_COLOR: Record<Clarity, ColorName> = { clear: 'green', open: 'yellow', blocked: 'red', elsewhere: 'blue', done: 'gray' }
const PRIORITIES: ReadonlyArray<[string, ColorName]> = [
  ['P1', 'red'],
  ['P2', 'orange'],
  ['P3', 'gray'],
]

export const propName = (role: MirrorRole) => t(`features.agents.mirror.prop.${role}`)

/* ------------------------------------------------------------------ the database */

export interface MirrorSchema {
  properties: PropertyDef[]
  views: View[]
  /** property id by role */
  ids: Record<MirrorRole, ID>
  /** option ids: Clarity by key, My status by group */
  clarity: Record<Clarity, ID>
  status: { todo: ID; doing: ID; done: ID }
}

function description(role: MirrorRole): string | undefined {
  if (role === 'key') return t('features.agents.mirror.desc.key')
  if (HAND_ROLES.includes(role)) return t('features.agents.mirror.desc.hand')
  if (SOURCE_ROLES.includes(role)) return t('features.agents.mirror.desc.source')
  if (AGENT_ROLES.includes(role)) return t('features.agents.mirror.desc.agent')
  return undefined
}

/** The properties and the six views of a new mirror database (fresh ids; names in the UI language). */
export function mirrorSchema(): MirrorSchema {
  const ids = Object.fromEntries(MIRROR_PROPS.map(([role]) => [role, newId()])) as Record<MirrorRole, ID>
  const clarity = Object.fromEntries(CLARITY.map((k) => [k, newId()])) as Record<Clarity, ID>
  const status = { todo: newId(), doing: newId(), done: newId() }
  const opts: Partial<Record<MirrorRole, SelectOption[]>> = {
    srcStatus: [],
    srcPriority: [],
    tags: [],
    clarity: CLARITY.map((k) => ({ id: clarity[k], name: t(`features.agents.mirror.clarity.${k}`), color: CLARITY_COLOR[k] })),
    myStatus: [
      { id: status.todo, name: t('database.status.notStarted'), color: 'gray', group: 'todo' },
      { id: status.doing, name: t('database.status.inProgress'), color: 'blue', group: 'in_progress' },
      { id: status.done, name: t('database.status.done'), color: 'green', group: 'done' },
    ],
    myPriority: PRIORITIES.map(([name, color]) => ({ id: newId(), name, color })),
  }
  const properties: PropertyDef[] = MIRROR_PROPS.map(([role, type]) => {
    const p: PropertyDef = { id: ids[role], name: propName(role), type }
    const desc = description(role)
    if (desc) p.description = desc
    if (opts[role]) p.options = opts[role]
    if (type === 'number') p.numberFormat = 'number'
    if (role === 'key') p.key = true
    if (HAND_ROLES.includes(role)) p.agentReadOnly = true
    return p
  })

  const db = { properties } as Pick<Database, 'properties'>
  const f = (role: MirrorRole, operator: Filter['operator'], value?: Filter['value']): Filter => ({ id: newId(), propertyId: ids[role], operator, ...(value !== undefined ? { value } : {}) })
  const group = (op: FilterGroup['op'], ...items: Array<Filter | FilterGroup>): FilterGroup => ({ id: newId(), op, items })
  const rule = (role: MirrorRole, color: ColorName): ColorRule => ({ id: newId(), filter: group('and', f(role, 'is_checked')), color, target: 'accent' })
  const rules = () => [rule('waiting', 'red'), rule('newComment', 'orange')]
  const view = (type: View['type'], name: string, visible: MirrorRole[], extra: Partial<View> = {}): View => ({
    ...defaultView(type, db, t(`features.agents.mirror.view.${name}`)),
    visibleProperties: visible.map((r) => ids[r]),
    ...extra,
  })
  const notGone = f('gone', 'is_not_checked')
  const notDone = f('myStatus', 'is_not', status.done)

  const views: View[] = [
    view('board', 'board', ['key', 'srcStatus', 'myPriority', 'owner', 'why'], { groupBy: ids.clarity, sorts: [{ propertyId: ids.changedAt, direction: 'desc' }], colorRules: rules() }),
    view('table', 'newComments', ['key', 'lastComment', 'lastCommentAt', 'comments', 'waiting', 'newComment', 'srcStatus', 'link'], {
      filter: group('or', f('newComment', 'is_checked'), f('waiting', 'is_checked')),
      sorts: [{ propertyId: ids.lastCommentAt, direction: 'desc' }],
      colorRules: rules(),
    }),
    view('board', 'ready', ['key', 'myStatus', 'nextStep', 'due', 'why'], {
      groupBy: ids.myPriority,
      filter: group('and', f('clarity', 'is', clarity.clear), notDone, notGone),
      sorts: [{ propertyId: ids.due, direction: 'asc' }],
    }),
    view('board', 'week', ['key', 'myPriority', 'nextStep', 'due'], {
      groupBy: ids.myStatus,
      // due within the next seven days (or overdue) — or in progress; never what is done or gone
      filter: group('and', notDone, notGone, group('or', f('due', 'on_or_before', { start: 'one_week_from_now' }), f('myStatus', 'is', status.doing))),
      hiddenGroups: [status.done],
      sorts: [{ propertyId: ids.due, direction: 'asc' }],
    }),
    view('board', 'source', ['key', 'srcPriority', 'owner', 'clarity'], { groupBy: ids.srcStatus, sorts: [{ propertyId: ids.changedAt, direction: 'desc' }] }),
    view(
      'table',
      'all',
      MIRROR_PROPS.filter(([r]) => r !== 'name').map(([r]) => r),
      { sorts: [{ propertyId: ids.changedAt, direction: 'desc' }] },
    ),
  ]
  return { properties, views, ids, clarity, status }
}

/* ------------------------------------------------------------------ the agent */

export const PLACEHOLDER_KEYS = ['list', 'read', 'me', 'clear'] as const

/** The recipe's placeholders in both languages (the editor looks for them in any agent's instructions). */
export const MIRROR_PLACEHOLDERS: readonly string[] = [
  ...new Set(PLACEHOLDER_KEYS.flatMap((k) => [ALL_MESSAGES.en[`features.agents.mirror.ph.${k}`], ALL_MESSAGES.de[`features.agents.mirror.ph.${k}`]]).filter((s): s is string => !!s)),
]

/** The recipe's placeholders still in `text`, in the order they appear (with their key for the hint). */
export function placeholdersIn(text: string): Array<{ text: string; key: (typeof PLACEHOLDER_KEYS)[number]; at: number }> {
  const out: Array<{ text: string; key: (typeof PLACEHOLDER_KEYS)[number]; at: number }> = []
  for (const key of PLACEHOLDER_KEYS) {
    for (const lang of ['en', 'de'] as const) {
      const ph = ALL_MESSAGES[lang][`features.agents.mirror.ph.${key}`]
      const at = ph ? text.indexOf(ph) : -1
      if (at >= 0 && !out.some((o) => o.text === ph)) out.push({ text: ph, key, at })
    }
  }
  return out.sort((a, b) => a.at - b.at)
}

/** The instructions in the UI language: the person's part (placeholders) and the fixed part. */
export function mirrorInstructions(db: string, server: string): string {
  const p = propName
  const c = (k: Clarity) => t(`features.agents.mirror.clarity.${k}`)
  return t('features.agents.mirror.instructions', {
    db,
    server,
    phList: t('features.agents.mirror.ph.list'),
    phRead: t('features.agents.mirror.ph.read'),
    phMe: t('features.agents.mirror.ph.me'),
    phClear: t('features.agents.mirror.ph.clear'),
    key: p('key'),
    link: p('link'),
    status: p('srcStatus'),
    prio: p('srcPriority'),
    owner: p('owner'),
    tags: p('tags'),
    changed: p('changedAt'),
    comments: p('comments'),
    last: p('lastComment'),
    lastAt: p('lastCommentAt'),
    new: p('newComment'),
    waiting: p('waiting'),
    clarity: p('clarity'),
    why: p('why'),
    gone: p('gone'),
    myStatus: p('myStatus'),
    myPrio: p('myPriority'),
    next: p('nextStep'),
    due: p('due'),
    clear: c('clear'),
    open: c('open'),
    blocked: c('blocked'),
    elsewhere: c('elsewhere'),
    done: c('done'),
  })
}

/**
 * The agent a mirror starts with (not saved: the editor opens with it). `tools`: the source server's tools from its
 * last connection test — its reading tools are ticked; null (never tested) leaves the list to the editor.
 */
export function mirrorDraft(input: { server: string; name: string; dbId: ID | null; reportId: ID | null; tools: string[] | null }): CustomAgent {
  const base = blankAgent()
  const draft: CustomAgent = {
    ...base,
    name: t('features.agents.mirror.agentName', { name: input.name }).slice(0, 80),
    icon: MIRROR_ICON,
    instructions: mirrorInstructions(input.name, input.server),
    trigger: { type: 'schedule', every: 'weekday', at: MIRROR_AT, tz: localTimeZone() },
    scope: input.dbId ? { everything: false, pages: [], databases: [input.dbId] } : base.scope,
    write: 'stage',
    output: input.reportId ? { pageId: input.reportId, mode: 'append' } : null,
    mcpServers: input.server ? [input.server] : [],
    runner: 'browser',
    maxRunUsd: MIRROR_BUDGET_USD,
  }
  if (input.server && input.tools?.length) draft.mcpTools = { [input.server]: input.tools.filter(isReadTool) }
  return draft
}

/* ------------------------------------------------------------------ creating it */

export const inTeam = () => useCloud.getState().active.kind === 'cloud'
const ws = () => useWorkspace.getState()

/** A page the database may go below: a live, ordinary page (not a row, not a template) — private in a team. */
export function canHoldMirror(pages: Record<ID, Page>, id: ID | null | undefined, team = inTeam()): boolean {
  const p = id ? pages[id] : undefined
  return !!p && p.kind === 'page' && !p.databaseId && !p.trashed && !isEffectivelyTrashed(pages, p.id) && !inTemplate(pages, p.id) && (!team || !!p.private)
}

/** "Tracker" for the server "tracker", "Item list" for "item_list". */
export const nameFromServer = (server: string) => {
  const s = server.replace(/[-_]+/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}

export interface MirrorInput {
  /** the MCP server's name (settings.mcpServers) */
  server: string
  /** the database's name */
  name: string
  /** the page it goes below (null = the top level / the Private section's top) */
  parentId: ID | null
}

export interface MirrorMade {
  dbId: ID
  reportId: ID
  name: string
  reportTitle: string
  views: number
  draft: CustomAgent
}

/** Remove what createMirror made — and the agent, when it was saved from the draft. */
export function undoMirror(made: Pick<MirrorMade, 'dbId' | 'reportId' | 'draft'>): void {
  if (ws().agents?.[made.draft.id]) ws().deleteAgent(made.draft.id)
  for (const id of [made.dbId, made.reportId]) if (ws().pages[id]) ws().deletePagePermanently(id)
}

/**
 * Create the mirror database and its report page (private in a team workspace), toast with Undo. Returns them with
 * the agent draft for the editor. Throws when nothing can be created here (a viewer, no name).
 */
export function createMirror(input: MirrorInput, opts: { onUndo?: () => void } = {}): MirrorMade {
  const name = input.name.replace(/\s+/g, ' ').trim().slice(0, 120)
  if (!name) throw new Error('name')
  const team = inTeam()
  if (team && useCloud.getState().readOnly) throw new Error('read-only')
  const parentId = canHoldMirror(ws().pages, input.parentId, team) ? input.parentId : null
  const schema = mirrorSchema()
  const dbInput = { parentId, title: name, icon: MIRROR_ICON, properties: schema.properties, views: schema.views }
  const dbId = team ? createPrivateDatabase(dbInput) : ws().createDatabase(dbInput)
  const reportTitle = t('features.agents.mirror.reportTitle', { name })
  const reportInput = { parentId, title: reportTitle, icon: REPORT_ICON }
  let reportId: ID
  try {
    reportId = team ? createPrivatePage(reportInput) : ws().createPage(reportInput)
  } catch (e) {
    ws().deletePagePermanently(dbId)
    throw e
  }
  const server = input.server
  const draft = mirrorDraft({ server, name, dbId, reportId, tools: testedTools(server, readServers()) })
  const made: MirrorMade = { dbId, reportId, name, reportTitle, views: schema.views.length, draft }
  useUI.getState().toast({
    message: t('features.agents.mirror.created', { name, views: made.views }),
    kind: 'success',
    action: {
      label: t('common.undo'),
      run: () => {
        undoMirror(made)
        opts.onUndo?.()
      },
    },
  })
  return made
}
