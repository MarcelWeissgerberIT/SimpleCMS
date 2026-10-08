/**
 * Recipes as configuration (RecipeConfig, kind 'mirror'): what the recipe "Mirror a list into a database" used to
 * hard-code is data now — the database (properties, options, flags, views), the agent (name, schedule, write mode,
 * budget, model, effort, tool allow-list, instructions) and the report page. Absent fields take the built-in values
 * (defaultMirror, in the UI language), so `{ "kind": "mirror" }` is today's recipe.
 *
 *  - defaultMirror(lang): the built-in recipe as a full config (also the "New integration" template's recipe)
 *  - resolveRecipe(profile, recipe, lang): the recipe with its defaults filled in and its texts in the UI language
 *  - buildMirror(resolved, report?): PropertyDef[] + View[] (fresh ids) — property / option references resolved;
 *    with `report`, every reference problem is reported with its JSON path (the editor's validation)
 *  - fillTokens(): `{db}`, `{server}`, `{report}` in names and instructions
 *
 * No service is named here: the source is whatever MCP server matched the profile.
 */
import { makeTranslator, type Lang } from '@/shared/i18n'
import { defaultView } from '../../../store/store'
import { localized, variants, type IssuePath, type Report } from '../../../store/integrations'
import type {
  ColorName,
  ColorRule,
  Filter,
  FilterGroup,
  FilterOperator,
  ID,
  IntegrationFeature,
  IntegrationProfile,
  PageIcon,
  PropertyDef,
  PropertyValue,
  RecipeAgentConfig,
  RecipeConfig,
  RecipeFilter,
  RecipePropType,
  RecipePropertyConfig,
  RecipeViewConfig,
  SelectOption,
  StatusGroup,
  View,
} from '../../../store/types'
import { newId } from '../../../lib/ids'
import { ALL_MESSAGES } from '../../../i18n'
import { NONE_KEY } from '../../../database'

/* ------------------------------------------------------------------ the built-in recipe */

/** The roles of the built-in mirror's properties, in order, with their types. */
export const MIRROR_ROLES: ReadonlyArray<[string, RecipePropType]> = [
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
/** The person's own fields ("Only by hand"). */
export const HAND_ROLES = ['myStatus', 'myPriority', 'nextStep', 'due']
const SOURCE_ROLES = ['link', 'srcStatus', 'srcPriority', 'owner', 'tags', 'changedAt', 'comments', 'lastComment', 'lastCommentAt', 'gone']
const AGENT_ROLES = ['newComment', 'waiting', 'clarity', 'why']
const CLARITY: ReadonlyArray<[string, ColorName]> = [
  ['clear', 'green'],
  ['open', 'yellow'],
  ['blocked', 'red'],
  ['elsewhere', 'blue'],
  ['done', 'gray'],
]
export const MIRROR_DEFAULTS = { icon: 'Layers', color: 'brown' as ColorName, at: '07:30', every: 'weekday' as const, budget: 1, write: 'stage' as const }

const translator = (lang: Lang) => makeTranslator(ALL_MESSAGES, lang)

/** The built-in recipe's instructions in a language, with these property names (by role) and tokens left for {db} / {server}. */
export function mirrorInstructionsText(lang: Lang, nameOf: (role: string) => string, db = '{db}', server = '{server}'): string {
  const tr = translator(lang)
  const c = (k: string) => tr(`features.agents.mirror.clarity.${k}`)
  return tr('features.agents.mirror.instructions', {
    db,
    server,
    phList: tr('features.agents.mirror.ph.list'),
    phRead: tr('features.agents.mirror.ph.read'),
    phMe: tr('features.agents.mirror.ph.me'),
    phClear: tr('features.agents.mirror.ph.clear'),
    key: nameOf('key'),
    link: nameOf('link'),
    status: nameOf('srcStatus'),
    prio: nameOf('srcPriority'),
    owner: nameOf('owner'),
    tags: nameOf('tags'),
    changed: nameOf('changedAt'),
    comments: nameOf('comments'),
    last: nameOf('lastComment'),
    lastAt: nameOf('lastCommentAt'),
    new: nameOf('newComment'),
    waiting: nameOf('waiting'),
    clarity: nameOf('clarity'),
    why: nameOf('why'),
    gone: nameOf('gone'),
    myStatus: nameOf('myStatus'),
    myPrio: nameOf('myPriority'),
    next: nameOf('nextStep'),
    due: nameOf('due'),
    clear: c('clear'),
    open: c('open'),
    blocked: c('blocked'),
    elsewhere: c('elsewhere'),
    done: c('done'),
  })
}

/** The built-in mirror's properties (names in `lang`). */
function defaultProperties(lang: Lang): RecipePropertyConfig[] {
  const tr = translator(lang)
  return MIRROR_ROLES.map(([role, type]) => {
    const p: RecipePropertyConfig = { role, name: tr(`features.agents.mirror.prop.${role}`), type }
    if (role === 'key') p.key = true
    if (HAND_ROLES.includes(role)) p.onlyByHand = true
    const desc =
      role === 'key'
        ? 'features.agents.mirror.desc.key'
        : HAND_ROLES.includes(role)
          ? 'features.agents.mirror.desc.hand'
          : SOURCE_ROLES.includes(role)
            ? 'features.agents.mirror.desc.source'
            : AGENT_ROLES.includes(role)
              ? 'features.agents.mirror.desc.agent'
              : ''
    if (desc) p.description = tr(desc)
    if (role === 'srcStatus' || role === 'srcPriority' || role === 'tags') p.options = []
    if (role === 'clarity') p.options = CLARITY.map(([k, color]) => ({ name: tr(`features.agents.mirror.clarity.${k}`), color }))
    if (role === 'myStatus')
      p.options = [
        { name: tr('database.status.notStarted'), color: 'gray', group: 'todo' },
        { name: tr('database.status.inProgress'), color: 'blue', group: 'in_progress' },
        { name: tr('database.status.done'), color: 'green', group: 'done' },
      ]
    if (role === 'myPriority')
      p.options = [
        { name: 'P1', color: 'red' },
        { name: 'P2', color: 'orange' },
        { name: 'P3', color: 'gray' },
      ]
    return p
  })
}

/** The built-in mirror's six views; `ref(role)` names a property (a role, or its name for the template). */
function defaultViews(lang: Lang, ref: (role: string) => string): RecipeViewConfig[] {
  const tr = translator(lang)
  const v = (k: string) => tr(`features.agents.mirror.view.${k}`)
  const clear = tr('features.agents.mirror.clarity.clear')
  const done = tr('database.status.done')
  const doing = tr('database.status.inProgress')
  const r = (...roles: string[]) => roles.map(ref)
  const rules = () => [
    { when: { property: ref('waiting'), op: 'is_checked' as const }, color: 'red' as ColorName },
    { when: { property: ref('newComment'), op: 'is_checked' as const }, color: 'orange' as ColorName },
  ]
  const notGone: RecipeFilter = { property: ref('gone'), op: 'is_not_checked' }
  const notDone: RecipeFilter = { property: ref('myStatus'), op: 'is_not', value: done }
  return [
    // every mirrored row gets a Clarity: the board starts with "Clear" (rows without one are counted under Hidden)
    { name: v('board'), type: 'board', properties: r('key', 'srcStatus', 'myPriority', 'owner', 'why'), groupBy: ref('clarity'), hideEmpty: true, sort: [{ property: ref('changedAt'), direction: 'desc' }], colorRules: rules() },
    {
      name: v('newComments'),
      type: 'table',
      properties: r('key', 'lastComment', 'lastCommentAt', 'comments', 'waiting', 'newComment', 'srcStatus', 'link'),
      filter: { or: [{ property: ref('newComment'), op: 'is_checked' }, { property: ref('waiting'), op: 'is_checked' }] },
      sort: [{ property: ref('lastCommentAt'), direction: 'desc' }],
      colorRules: rules(),
    },
    {
      name: v('ready'),
      type: 'board',
      properties: r('key', 'myStatus', 'nextStep', 'due', 'why'),
      groupBy: ref('myPriority'),
      filter: { and: [{ property: ref('clarity'), op: 'is', value: clear }, notDone, notGone] },
      sort: [{ property: ref('due'), direction: 'asc' }],
    },
    {
      name: v('week'),
      type: 'board',
      properties: r('key', 'myPriority', 'nextStep', 'due'),
      groupBy: ref('myStatus'),
      // due within the next seven days (or overdue) — or in progress; never what is done or gone
      filter: { and: [notDone, notGone, { or: [{ property: ref('due'), op: 'on_or_before', value: 'one_week_from_now' }, { property: ref('myStatus'), op: 'is', value: doing }] }] },
      hiddenGroups: [done],
      sort: [{ property: ref('due'), direction: 'asc' }],
    },
    { name: v('source'), type: 'board', properties: r('key', 'srcPriority', 'owner', 'clarity'), groupBy: ref('srcStatus'), sort: [{ property: ref('changedAt'), direction: 'desc' }] },
    { name: v('all'), type: 'table', properties: MIRROR_ROLES.filter(([role]) => role !== 'name').map(([role]) => ref(role)), sort: [{ property: ref('changedAt'), direction: 'desc' }] },
  ]
}

/**
 * The built-in recipe as a full config in `lang`. `forTemplate`: views name properties by their names (what a person
 * reads in the template), else by role (robust when only the names change).
 */
export function defaultMirror(lang: Lang, forTemplate = false): RecipeConfig & { database: { properties: RecipePropertyConfig[]; views: RecipeViewConfig[] }; agent: RecipeAgentConfig } {
  const tr = translator(lang)
  const properties = defaultProperties(lang)
  const nameOf = (role: string) => {
    const p = properties.find((x) => x.role === role)
    return p ? localized(p.name, lang) : role
  }
  return {
    kind: 'mirror',
    id: 'mirror',
    name: tr('features.agents.recipe.mirror.name'),
    description: tr('features.agents.recipe.mirror.desc'),
    icon: MIRROR_DEFAULTS.icon,
    color: MIRROR_DEFAULTS.color,
    database: { properties, views: defaultViews(lang, forTemplate ? nameOf : (role) => role) },
    agent: {
      name: tr('features.agents.mirror.agentName', { name: '{db}' }),
      schedule: { every: MIRROR_DEFAULTS.every, at: MIRROR_DEFAULTS.at },
      write: MIRROR_DEFAULTS.write,
      budget: MIRROR_DEFAULTS.budget,
      instructions: mirrorInstructionsText(lang, nameOf),
    },
    report: { name: tr('features.agents.mirror.reportTitle', { name: '{db}' }) },
  }
}

/* ------------------------------------------------------------------ resolving a recipe */

export interface ResolvedOption {
  name: string
  names: string[]
  color: ColorName
  group?: StatusGroup
}

export interface ResolvedProperty {
  role?: string
  name: string
  /** every language variant of its name (references match any) */
  names: string[]
  type: RecipePropType
  options?: ResolvedOption[]
  key: boolean
  onlyByHand: boolean
  description?: string
}

export interface ResolvedRecipe {
  /** the language its texts are in */
  lang: Lang
  profileId: string
  profileName: string
  recipeId: string
  name: string
  description: string
  icon: PageIcon
  /** the database's default name ('' = from the source server's name) */
  dbName: string
  properties: ResolvedProperty[]
  views: RecipeViewConfig[]
  /** given in the config (else the built-in ones): problems are reported there */
  given: { properties: boolean; views: boolean }
  agent: {
    name: string
    schedule: NonNullable<RecipeAgentConfig['schedule']>
    write: 'stage' | 'apply'
    budget: number
    model: string | null
    effort: 'low' | 'medium' | 'high' | null
    /** null = the matched server's read tools */
    tools: string[] | null
    instructions: string
  }
  reportName: string
}

const STATUS_DEFAULT = (lang: Lang): ResolvedOption[] => {
  const tr = translator(lang)
  return [
    { name: tr('database.status.notStarted'), names: [tr('database.status.notStarted')], color: 'gray', group: 'todo' },
    { name: tr('database.status.inProgress'), names: [tr('database.status.inProgress')], color: 'blue', group: 'in_progress' },
    { name: tr('database.status.done'), names: [tr('database.status.done')], color: 'green', group: 'done' },
  ]
}

function resolveProperty(p: RecipePropertyConfig, lang: Lang): ResolvedProperty {
  const out: ResolvedProperty = { name: localized(p.name, lang), names: variants(p.name), type: p.type, key: p.key === true, onlyByHand: p.onlyByHand === true }
  if (p.role) out.role = p.role
  if (p.description) out.description = localized(p.description, lang)
  if (p.type === 'select' || p.type === 'multi_select' || p.type === 'status') {
    const opts = p.options ?? []
    if (p.type === 'status' && !opts.length) out.options = STATUS_DEFAULT(lang)
    else
      out.options = opts.map((o, i) => {
        const r: ResolvedOption = { name: localized(o.name, lang), names: variants(o.name), color: o.color ?? p.color ?? 'gray' }
        if (p.type === 'status') r.group = o.group ?? (i === 0 ? 'todo' : i === opts.length - 1 ? 'done' : 'in_progress')
        return r
      })
  }
  return out
}

/** The recipe's icon (the built-in one when it names none). */
function iconOf(recipe: RecipeConfig): PageIcon {
  const color = recipe.color ?? (recipe.icon ? undefined : MIRROR_DEFAULTS.color)
  const value = recipe.icon ?? MIRROR_DEFAULTS.icon
  return color ? { type: 'lucide', value, color } : { type: 'lucide', value }
}

/** The recipe with every default filled in, its texts in `lang`. */
export function resolveRecipe(profile: Pick<IntegrationProfile, 'id' | 'name'>, recipe: RecipeConfig, lang: Lang): ResolvedRecipe {
  const def = defaultMirror(lang)
  const db = recipe.database ?? {}
  const properties = (db.properties ?? def.database.properties).map((p) => resolveProperty(p, lang))
  const nameByRole = (role: string) => properties.find((p) => p.role === role)?.name ?? localized(def.database.properties.find((p) => p.role === role)?.name, lang) ?? role
  const a = recipe.agent ?? {}
  return {
    lang,
    profileId: profile.id,
    profileName: profile.name,
    recipeId: recipe.id ?? 'mirror',
    // the built-in name unless the recipe names itself (the profile's name is shown next to it)
    name: localized(recipe.name, lang) || localized(def.name, lang),
    description: localized(recipe.description, lang),
    icon: iconOf(recipe),
    dbName: localized(db.name, lang),
    properties,
    views: db.views ?? def.database.views,
    given: { properties: !!db.properties, views: !!db.views },
    agent: {
      name: localized(a.name, lang) || localized(def.agent.name, lang),
      schedule: a.schedule ?? def.agent.schedule!,
      write: a.write ?? MIRROR_DEFAULTS.write,
      budget: a.budget ?? MIRROR_DEFAULTS.budget,
      model: a.model ?? null,
      effort: a.effort ?? null,
      tools: a.tools ?? null,
      // the built-in instructions name the properties this recipe has (by role)
      instructions: a.instructions !== undefined ? localized(a.instructions, lang) : mirrorInstructionsText(lang, nameByRole),
    },
    reportName: localized(recipe.report?.name, lang) || localized(def.report!.name, lang),
  }
}

/** `{db}`, `{server}`, `{report}` filled in (nothing else: JSON in instructions keeps its braces). */
export function fillTokens(text: string, vars: { db?: string; server?: string; report?: string }): string {
  return text.replace(/\{(db|server|report)\}/g, (all, k: 'db' | 'server' | 'report') => vars[k] ?? all)
}

/** The features a mirror's agent relies on (a profile that offers it should unlock them). */
export const MIRROR_NEEDS: IntegrationFeature[] = ['keys', 'onlyByHand', 'upsert', 'agentState', 'notify']

/* ------------------------------------------------------------------ building it */

const OPS: Record<string, FilterOperator[]> = {
  text: ['contains', 'not_contains', 'is', 'is_not', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty'],
  number: ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'is_empty', 'is_not_empty'],
  select: ['is', 'is_not', 'is_empty', 'is_not_empty'],
  multi: ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
  date: ['is', 'before', 'after', 'on_or_before', 'on_or_after', 'within_past_week', 'within_next_week', 'this_month', 'is_empty', 'is_not_empty'],
  checkbox: ['is_checked', 'is_not_checked'],
}
const VALUELESS: FilterOperator[] = ['is_empty', 'is_not_empty', 'is_checked', 'is_not_checked', 'within_past_week', 'within_next_week', 'this_month']
export const DATE_TOKENS = ['today', 'tomorrow', 'yesterday', 'one_week_ago', 'one_week_from_now', 'one_month_ago', 'one_month_from_now']
const GROUPABLE: RecipePropType[] = ['select', 'multi_select', 'status', 'person', 'checkbox']

const kindOf = (type: RecipePropType): keyof typeof OPS =>
  type === 'number' ? 'number' : type === 'select' || type === 'status' ? 'select' : type === 'multi_select' || type === 'person' ? 'multi' : type === 'date' ? 'date' : type === 'checkbox' ? 'checkbox' : 'text'

export interface BuiltMirror {
  properties: PropertyDef[]
  views: View[]
}

/** A reference to a property: its name (any language), else its role, else its name ignoring case. */
function findProperty(props: Array<ResolvedProperty & { id: ID }>, ref: string): { prop?: ResolvedProperty & { id: ID }; ambiguous?: boolean } {
  const byName = props.filter((p) => p.names.includes(ref))
  if (byName.length === 1) return { prop: byName[0] }
  if (byName.length > 1) return { ambiguous: true }
  const byRole = props.find((p) => p.role === ref)
  if (byRole) return { prop: byRole }
  const lower = ref.toLowerCase()
  const loose = props.filter((p) => p.names.some((n) => n.toLowerCase() === lower))
  if (loose.length === 1) return { prop: loose[0] }
  return loose.length > 1 ? { ambiguous: true } : {}
}

/** The closest name (for "did you mean …"), or ''. */
function closest(ref: string, names: string[]): string {
  const a = ref.toLowerCase()
  let best = ''
  let score = Infinity
  for (const n of names) {
    const d = distance(a, n.toLowerCase())
    if (d < score) {
      score = d
      best = n
    }
  }
  return score <= Math.max(2, Math.floor(a.length / 3)) ? best : ''
}

function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 8) return 99
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = cur
    }
  }
  return row[b.length]
}

/**
 * The database's properties and views (fresh ids, names in the UI language). Every property / option reference is
 * resolved; a problem is reported (path below the recipe: ['database', 'views', 2, 'groupBy'] …) and the part left
 * out. `at`: the recipe's own path (e.g. ['recipes', 0]).
 */
export function buildMirror(r: ResolvedRecipe, report: Report | null = null, at: IssuePath = []): BuiltMirror {
  const issue = (path: IssuePath, code: string, vars?: Record<string, string | number>, severity: 'error' | 'warning' = 'error') => report?.({ path: [...at, ...path], code, ...(vars ? { vars } : {}), severity })
  const propsPath = (i: number): IssuePath => (r.given.properties ? ['database', 'properties', i] : ['database'])
  const viewsPath = (i: number, ...rest: Array<string | number>): IssuePath => (r.given.views ? ['database', 'views', i, ...rest] : ['database'])

  // ---- properties
  const props = r.properties.map((p) => ({ ...p, id: newId() }))
  const titles = props.filter((p) => p.type === 'title')
  if (titles.length !== 1) issue(r.given.properties ? ['database', 'properties'] : ['database'], 'title', { count: titles.length })
  const keys = props.filter((p) => p.key)
  if (keys.length > 1) issue(propsPath(props.indexOf(keys[1])), 'keyCount')
  if (!keys.length) issue(r.given.properties ? ['database', 'properties'] : ['database'], 'keyMissing')
  props.forEach((p, i) => {
    const twin = props.findIndex((q) => q !== p && q.names.some((n) => p.names.includes(n)))
    if (twin >= 0 && twin < i) issue(propsPath(i), 'nameDup', { name: p.name })
    const optNames = (p.options ?? []).flatMap((o) => o.names)
    const dup = optNames.find((n, j) => optNames.indexOf(n) !== j)
    if (dup) issue(propsPath(i), 'optionDup', { name: dup, property: p.name })
  })
  // the title first (the database's first property)
  const ordered = [...titles.slice(0, 1), ...props.filter((p) => p.type !== 'title')]
  const optionIds = new Map<string, Map<string, ID>>()
  const properties: PropertyDef[] = ordered.map((p) => {
    const def: PropertyDef = { id: p.id, name: p.name, type: p.type }
    if (p.description) def.description = p.description
    if (p.options) {
      const ids = new Map<string, ID>()
      def.options = p.options.map((o) => {
        const id = newId()
        for (const n of o.names) ids.set(n, id)
        const opt: SelectOption = { id, name: o.name, color: o.color }
        if (o.group) opt.group = o.group
        return opt
      })
      optionIds.set(p.id, ids)
    }
    if (p.type === 'number') def.numberFormat = 'number'
    if (p.key && p === keys[0]) def.key = true
    if (p.onlyByHand && p.type !== 'title') def.agentReadOnly = true
    return def
  })

  // ---- references
  const names = props.flatMap((p) => p.names)
  const resolve = (path: IssuePath, ref: string): (ResolvedProperty & { id: ID }) | null => {
    const f = findProperty(props, ref)
    if (f.prop) return f.prop
    if (f.ambiguous) issue(path, 'refAmbiguous', { ref })
    else if (!r.given.views) issue(path, 'refDefault', { ref })
    else {
      const near = closest(ref, names)
      issue(path, near ? 'refNear' : 'ref', { ref, near })
    }
    return null
  }
  const optionId = (path: IssuePath, p: ResolvedProperty & { id: ID }, name: string): ID | null => {
    const id = optionIds.get(p.id)?.get(name) ?? [...(optionIds.get(p.id)?.entries() ?? [])].find(([n]) => n.toLowerCase() === name.toLowerCase())?.[1]
    if (id) return id
    const near = closest(name, [...(optionIds.get(p.id)?.keys() ?? [])])
    issue(path, !r.given.views ? 'optionDefault' : near ? 'optionNear' : 'option', { value: name, property: p.name, near })
    return null
  }

  const filterOf = (path: IssuePath, f: RecipeFilter, op: 'and' | 'or' = 'and'): FilterGroup | null => {
    const one = (p: IssuePath, x: RecipeFilter): Filter | FilterGroup | null => {
      if ('and' in x) return group([...p, 'and'], x.and, 'and')
      if ('or' in x) return group([...p, 'or'], x.or, 'or')
      return condition(p, x)
    }
    const group = (p: IssuePath, items: RecipeFilter[], o: 'and' | 'or'): FilterGroup => ({ id: newId(), op: o, items: items.map((x, i) => one([...p, i], x)).filter((x): x is Filter | FilterGroup => !!x) })
    if ('and' in f) return group([...path, 'and'], f.and, 'and')
    if ('or' in f) return group([...path, 'or'], f.or, 'or')
    const c = condition(path, f)
    return c ? { id: newId(), op, items: [c] } : null
  }
  const condition = (path: IssuePath, c: Extract<RecipeFilter, { property: string }>): Filter | null => {
    const p = resolve([...path, 'property'], c.property)
    if (!p) return null
    const kind = kindOf(p.type)
    if (!OPS[kind].includes(c.op)) {
      issue([...path, 'op'], 'opType', { op: c.op, property: p.name, type: p.type, allowed: OPS[kind].join(', ') })
      return null
    }
    const out: Filter = { id: newId(), propertyId: p.id, operator: c.op }
    if (VALUELESS.includes(c.op)) return out
    if (c.value === undefined || c.value === '') {
      issue(path, 'valueMissing', { op: c.op })
      return null
    }
    const vpath = [...path, 'value']
    let value: PropertyValue | null = null
    if (p.type === 'select' || p.type === 'status' || p.type === 'multi_select') value = typeof c.value === 'string' ? optionId(vpath, p, c.value) : (issue(vpath, 'valueType', { expected: 'option' }), null)
    else if (p.type === 'person') value = c.value === '@me' ? '@me' : (issue(vpath, 'valuePerson'), null)
    else if (p.type === 'date') {
      if (typeof c.value === 'string' && (DATE_TOKENS.includes(c.value) || /^\d{4}-\d{2}-\d{2}$/.test(c.value))) value = { start: c.value }
      else issue(vpath, 'valueDate', { allowed: DATE_TOKENS.join(', ') })
    } else if (p.type === 'number') value = typeof c.value === 'number' ? c.value : (issue(vpath, 'valueType', { expected: 'number' }), null)
    else value = String(c.value)
    if (value === null) return null
    out.value = value
    return out
  }

  // ---- views
  const views: View[] = []
  const db = { properties }
  r.views.forEach((cfg, i) => {
    const view: View = { ...defaultView(cfg.type, db, localized(cfg.name, r.lang)) }
    if (cfg.properties) view.visibleProperties = cfg.properties.map((ref, j) => resolve(viewsPath(i, 'properties', j), ref)).filter((p): p is ResolvedProperty & { id: ID } => !!p && p.type !== 'title').map((p) => p.id)
    if (cfg.groupBy) {
      const p = resolve(viewsPath(i, 'groupBy'), cfg.groupBy)
      if (p && !GROUPABLE.includes(p.type)) issue(viewsPath(i, 'groupBy'), 'groupType', { property: p.name, type: p.type })
      else if (p) view.groupBy = p.id
    } else if (cfg.type === 'board' && !view.groupBy) issue(viewsPath(i), 'boardGroup')
    if (cfg.date) {
      const p = resolve(viewsPath(i, 'date'), cfg.date)
      if (p && p.type !== 'date') issue(viewsPath(i, 'date'), 'dateType', { property: p.name, type: p.type })
      else if (p && cfg.type === 'feed') view.feed = { dateProperty: p.id }
      else if (p) view.dateProperty = p.id
    } else if ((cfg.type === 'calendar' || cfg.type === 'timeline') && !view.dateProperty) issue(viewsPath(i), 'viewDate')
    if (cfg.filter) view.filter = filterOf(viewsPath(i, 'filter'), cfg.filter)
    if (cfg.sort)
      view.sorts = cfg.sort
        .map((s, j) => {
          const p = resolve(viewsPath(i, 'sort', j, 'property'), s.property)
          return p ? { propertyId: p.id, direction: s.direction ?? 'asc' } : null
        })
        .filter((s): s is View['sorts'][number] => !!s)
    if (cfg.colorRules)
      view.colorRules = cfg.colorRules
        .map((rule, j) => {
          const filter = filterOf(viewsPath(i, 'colorRules', j, 'when'), rule.when)
          return filter ? ({ id: newId(), filter, color: rule.color, target: rule.target ?? 'accent' } satisfies ColorRule) : null
        })
        .filter((x): x is ColorRule => !!x)
    const hidden: string[] = []
    if (cfg.hiddenGroups?.length) {
      const g = view.groupBy ? props.find((p) => p.id === view.groupBy) : undefined
      if (!g) issue(viewsPath(i, 'hiddenGroups'), 'hiddenNoGroup')
      else cfg.hiddenGroups.forEach((name, j) => {
        const id = optionId(viewsPath(i, 'hiddenGroups', j), g, name)
        if (id) hidden.push(id)
      })
    }
    if (cfg.hideEmpty) hidden.unshift(NONE_KEY)
    if (hidden.length) view.hiddenGroups = hidden
    views.push(view)
  })
  if (!views.length) issue(['database'], 'noViews')
  return { properties, views }
}
