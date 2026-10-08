/**
 * Integration profiles (Workspace.integrations, JSON schema "one.integration/1"): the shape rules, the checker the
 * editor reports with (issue codes + JSON paths; features/agents/integrations translates them) and the sanitizer
 * every copy from outside this tab goes through — stored records, backups, the team meta document, imports, the
 * store's own writes. The sanitizer is the checker without a reporter: unknown keys are dropped, strings clamped,
 * enums checked, a value that is no profile at all is left out. Fresh objects only.
 *
 * Matching (pure): a profile is active when ONE enabled MCP server satisfies every given condition of its `match`
 * (tools from the server's last connection test, a glob on its name, a glob on its URL's host). The team server has
 * its own twin of the name / host part (server/src/agents/integrations.ts).
 *
 * References inside recipes (a view's `groupBy` names a property …) are checked by the features layer against the
 * recipe as it will be built (its defaults filled in): features/agents/integrations/recipe.ts.
 */
import {
  COLOR_NAMES,
  INTEGRATION_FEATURES,
  type ColorName,
  type FilterOperator,
  type IntegrationFeature,
  type IntegrationMatch,
  type IntegrationProfile,
  type LocalText,
  type McpServerConfig,
  type RecipeAgentConfig,
  type RecipeConfig,
  type RecipeFilter,
  type RecipeOptionConfig,
  type RecipePropType,
  type RecipePropertyConfig,
  type RecipeViewConfig,
  type RecipeViewType,
  type StatusGroup,
} from './types'

export const INTEGRATION_SCHEMA = 'one.integration/1' as const

export const INTEGRATION_LIMITS = {
  profiles: 50,
  name: 80,
  description: 500,
  tools: 50,
  glob: 100,
  recipes: 10,
  properties: 40,
  options: 60,
  views: 12,
  /** filter items per group and nesting depth */
  filterItems: 20,
  filterDepth: 4,
  sorts: 5,
  colorRules: 8,
  text: 200,
  instructions: 8000,
  minBudget: 0.01,
  maxBudget: 50,
} as const

export const RECIPE_KINDS = ['mirror'] as const
export const RECIPE_PROP_TYPES: RecipePropType[] = ['title', 'text', 'number', 'select', 'multi_select', 'status', 'date', 'checkbox', 'url', 'email', 'phone', 'person']
export const RECIPE_VIEW_TYPES: RecipeViewType[] = ['table', 'board', 'list', 'gallery', 'calendar', 'timeline', 'feed']
export const FILTER_OPERATORS: FilterOperator[] = [
  'is', 'is_not', 'contains', 'not_contains', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
  'before', 'after', 'on_or_before', 'on_or_after', 'within_past_week', 'within_next_week', 'this_month', 'is_checked', 'is_not_checked',
]
const STATUS_GROUPS: StatusGroup[] = ['todo', 'in_progress', 'done']
const SCHEDULE_EVERY = ['hour', 'day', 'weekday', 'week', 'month'] as const
const EFFORTS = ['low', 'medium', 'high'] as const

const PROFILE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
const RECIPE_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/
const ROLE = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/
/** an MCP tool name (as in CustomAgent.mcpTools) */
export const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/
/** a glob on a server name: its characters plus * and ? */
const NAME_GLOB = /^[A-Za-z0-9_*?-]{1,100}$/
/** a glob on a host name */
const HOST_GLOB = /^[A-Za-z0-9.*?-]{1,100}$/
const LUCIDE = /^[A-Z][A-Za-z0-9]{1,48}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const MODEL = /^[a-z0-9][a-z0-9.-]{0,63}$/

/* ------------------------------------------------------------------ issues */

export type IssueCode =
  | 'object'
  | 'array'
  | 'string'
  | 'number'
  | 'boolean'
  | 'required'
  | 'unknownKey'
  | 'schema'
  | 'id'
  | 'empty'
  | 'tooLong'
  | 'tooMany'
  | 'enum'
  | 'tool'
  | 'glob'
  | 'noConditions'
  | 'duplicate'
  | 'role'
  | 'color'
  | 'icon'
  | 'time'
  | 'range'
  | 'model'
  | 'depth'
  | 'filter'
  | 'localText'
  | 'unlocksNothing'
  | 'optionsType'
  | 'keyType'
  | 'handTitle'
  | 'filterValue'

export type IssuePath = Array<string | number>

export interface IntegrationIssue {
  path: IssuePath
  code: IssueCode | string
  vars?: Record<string, string | number>
  /** default 'error'; a warning does not block saving */
  severity?: 'error' | 'warning'
  /** the message names a key (unknownKey / required): the position is that key's */
  at?: 'key' | 'value'
}

export type Report = (issue: IntegrationIssue) => void

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const own = (o: Obj, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined)
const has = (o: Obj, k: string) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
const oneLine = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()

/** The checker's context: where it is, and who hears about problems. */
class Ctx {
  constructor(
    readonly report: Report | null,
    readonly path: IssuePath = [],
  ) {}
  at(...seg: Array<string | number>): Ctx {
    return new Ctx(this.report, [...this.path, ...seg])
  }
  issue(code: IssueCode | string, vars?: Record<string, string | number>, extra: Partial<IntegrationIssue> = {}): void {
    this.report?.({ path: this.path, code, ...(vars ? { vars } : {}), ...extra })
  }
  warn(code: IssueCode | string, vars?: Record<string, string | number>): void {
    this.issue(code, vars, { severity: 'warning' })
  }
  /** Keys that are not part of the schema (reported on the key itself). */
  unknownKeys(o: Obj, allowed: readonly string[], silent: readonly string[] = []): void {
    for (const k of Object.keys(o)) if (!allowed.includes(k) && !silent.includes(k)) this.at(k).issue('unknownKey', { key: k, allowed: allowed.join(', ') }, { at: 'key' })
  }
  required(o: Obj, key: string): boolean {
    if (has(o, key)) return true
    this.issue('required', { key })
    return false
  }
}

function obj(c: Ctx, v: unknown): Obj | null {
  if (isObj(v)) return v
  c.issue('object')
  return null
}

function str(c: Ctx, v: unknown, max: number, opts: { line?: boolean; empty?: boolean } = {}): string | undefined {
  if (typeof v !== 'string') {
    c.issue('string')
    return undefined
  }
  const s = opts.line === false ? clean(v).trim() : oneLine(v)
  if (!s && !opts.empty) {
    c.issue('empty')
    return undefined
  }
  if (s.length > max) {
    c.issue('tooLong', { max })
    return s.slice(0, max)
  }
  return s
}

function enumOf<T extends string>(c: Ctx, v: unknown, list: readonly T[]): T | undefined {
  if (typeof v === 'string' && (list as readonly string[]).includes(v)) return v as T
  c.issue('enum', { value: typeof v === 'string' ? v : JSON.stringify(v) ?? String(v), allowed: list.join(', ') })
  return undefined
}

function arr(c: Ctx, v: unknown, max: number): unknown[] | null {
  if (!Array.isArray(v)) {
    c.issue('array')
    return null
  }
  if (v.length > max) {
    c.issue('tooMany', { max })
    return v.slice(0, max)
  }
  return v
}

function bool(c: Ctx, v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v
  c.issue('boolean')
  return undefined
}

function color(c: Ctx, v: unknown): ColorName | undefined {
  if (typeof v === 'string' && COLOR_NAMES.includes(v as ColorName)) return v as ColorName
  c.issue('color', { value: typeof v === 'string' ? v : String(v), allowed: COLOR_NAMES.join(', ') })
  return undefined
}

/** A text in one language or per language ({ en, de }). */
function localText(c: Ctx, v: unknown, max: number, opts: { line?: boolean } = {}): LocalText | undefined {
  if (typeof v === 'string') return str(c, v, max, opts)
  if (!isObj(v)) {
    c.issue('localText')
    return undefined
  }
  c.unknownKeys(v, ['en', 'de'])
  const out: { en?: string; de?: string } = {}
  for (const lang of ['en', 'de'] as const) if (has(v, lang)) out[lang] = str(c.at(lang), v[lang], max, opts)
  if (!out.en && !out.de) {
    c.issue('localText')
    return undefined
  }
  return out
}

/* ------------------------------------------------------------------ the profile */

const PROFILE_KEYS = ['schema', 'id', 'name', 'description', 'match', 'unlocks', 'recipes'] as const
/** stored fields that may come along (never reported, never exported) */
const STORED_KEYS = ['updatedAt', 'updatedBy'] as const

function checkMatch(c: Ctx, v: unknown): IntegrationMatch | undefined {
  const o = obj(c, v)
  if (!o) return undefined
  c.unknownKeys(o, ['tools', 'name', 'host'])
  const out: IntegrationMatch = {}
  if (has(o, 'tools')) {
    const cc = c.at('tools')
    const list = arr(cc, o.tools, INTEGRATION_LIMITS.tools)
    if (list) {
      const tools: string[] = []
      list.forEach((x, i) => {
        if (typeof x !== 'string' || !TOOL_NAME.test(x)) return cc.at(i).issue('tool', { value: typeof x === 'string' ? x : String(x) })
        if (tools.includes(x)) return cc.at(i).warn('duplicate', { value: x })
        tools.push(x)
      })
      if (tools.length) out.tools = tools
      else if (!list.length) cc.issue('empty')
    }
  }
  for (const [key, re] of [
    ['name', NAME_GLOB],
    ['host', HOST_GLOB],
  ] as const) {
    if (!has(o, key)) continue
    const raw = o[key]
    if (typeof raw !== 'string') c.at(key).issue('string')
    else if (!re.test(raw.trim()) || !raw.replace(/[*?]/g, '').trim()) c.at(key).issue('glob', { value: raw })
    else out[key] = raw.trim().toLowerCase()
  }
  // a profile without a condition is kept (an inactive draft) — and never matches
  if (!out.tools && !out.name && !out.host) c.warn('noConditions')
  return out
}

function checkUnlocks(c: Ctx, v: unknown): IntegrationFeature[] {
  const list = arr(c, v, 20)
  if (!list) return []
  const out: IntegrationFeature[] = []
  list.forEach((x, i) => {
    const f = enumOf(c.at(i), x, INTEGRATION_FEATURES)
    if (f && !out.includes(f)) out.push(f)
  })
  return INTEGRATION_FEATURES.filter((f) => out.includes(f))
}

/**
 * Check a profile. With `report`, every problem is reported with its JSON path (the editor); without, it is the
 * sanitizer. Null: not a profile at all (no object, a wrong schema, no usable id / name / match).
 */
export function checkIntegration(raw: unknown, report: Report | null = null): IntegrationProfile | null {
  const c = new Ctx(report)
  const o = obj(c, raw)
  if (!o) return null
  c.unknownKeys(o, PROFILE_KEYS, STORED_KEYS)
  let ok = true
  if (!c.required(o, 'schema')) ok = false
  else if (o.schema !== INTEGRATION_SCHEMA) {
    c.at('schema').issue('schema', { value: typeof o.schema === 'string' ? o.schema : String(o.schema), expected: INTEGRATION_SCHEMA })
    ok = false
  }
  let id: string | undefined
  if (c.required(o, 'id')) {
    if (typeof o.id === 'string' && PROFILE_ID.test(o.id)) id = o.id
    else c.at('id').issue('id', { value: typeof o.id === 'string' ? o.id : String(o.id) })
  }
  const name = c.required(o, 'name') ? str(c.at('name'), o.name, INTEGRATION_LIMITS.name) : undefined
  const description = has(o, 'description') ? str(c.at('description'), o.description, INTEGRATION_LIMITS.description, { empty: true }) : undefined
  const match = c.required(o, 'match') ? checkMatch(c.at('match'), o.match) : undefined
  const unlocks = c.required(o, 'unlocks') ? checkUnlocks(c.at('unlocks'), o.unlocks) : []
  const recipes: RecipeConfig[] = []
  if (has(o, 'recipes')) {
    const rc = c.at('recipes')
    const list = arr(rc, o.recipes, INTEGRATION_LIMITS.recipes)
    const ids = new Set<string>()
    list?.forEach((x, i) => {
      const r = checkRecipe(rc.at(i), x)
      if (!r) return
      // every recipe has an id of its own in its profile
      let rid = r.id ?? 'mirror'
      if (ids.has(rid)) {
        if (r.id) rc.at(i, 'id').issue('duplicate', { value: rid })
        let n = 2
        while (ids.has(`${rid}-${n}`)) n++
        rid = `${rid}-${n}`
      }
      ids.add(rid)
      recipes.push({ ...r, id: rid })
    })
  }
  if (!unlocks.length && !recipes.length && has(o, 'unlocks') && Array.isArray(o.unlocks)) c.at('unlocks').warn('unlocksNothing')
  if (!ok || !id || !name || !match) return null
  const out: IntegrationProfile = { schema: INTEGRATION_SCHEMA, id, name, match, unlocks }
  if (description) out.description = description
  if (recipes.length) out.recipes = recipes
  const updatedAt = own(o, 'updatedAt')
  if (typeof updatedAt === 'number' && Number.isFinite(updatedAt)) out.updatedAt = updatedAt
  const updatedBy = own(o, 'updatedBy')
  if (typeof updatedBy === 'string' && updatedBy && updatedBy.length <= 128) out.updatedBy = updatedBy
  else if (updatedBy === null) out.updatedBy = null
  return out
}

/* ------------------------------------------------------------------ recipes */

const RECIPE_KEYS = ['kind', 'id', 'name', 'description', 'icon', 'color', 'database', 'agent', 'report'] as const

function checkRecipe(c: Ctx, v: unknown): RecipeConfig | null {
  const o = obj(c, v)
  if (!o) return null
  c.unknownKeys(o, RECIPE_KEYS)
  if (!c.required(o, 'kind')) return null
  const kind = enumOf(c.at('kind'), o.kind, RECIPE_KINDS)
  if (!kind) return null
  const out: RecipeConfig = { kind }
  if (has(o, 'id')) {
    if (typeof o.id === 'string' && RECIPE_ID.test(o.id)) out.id = o.id
    else c.at('id').issue('id', { value: typeof o.id === 'string' ? o.id : String(o.id) })
  }
  if (has(o, 'name')) out.name = localText(c.at('name'), o.name, INTEGRATION_LIMITS.name)
  if (has(o, 'description')) out.description = localText(c.at('description'), o.description, INTEGRATION_LIMITS.description)
  if (has(o, 'icon')) {
    if (typeof o.icon === 'string' && LUCIDE.test(o.icon)) out.icon = o.icon
    else c.at('icon').issue('icon', { value: typeof o.icon === 'string' ? o.icon : String(o.icon) })
  }
  if (has(o, 'color')) out.color = color(c.at('color'), o.color)
  if (has(o, 'database')) {
    const dc = c.at('database')
    const d = obj(dc, o.database)
    if (d) {
      dc.unknownKeys(d, ['name', 'properties', 'views'])
      const db: NonNullable<RecipeConfig['database']> = {}
      if (has(d, 'name')) db.name = localText(dc.at('name'), d.name, 120)
      if (has(d, 'properties')) db.properties = checkProperties(dc.at('properties'), d.properties)
      if (has(d, 'views')) {
        const vc = dc.at('views')
        const list = arr(vc, d.views, INTEGRATION_LIMITS.views)
        if (list) {
          db.views = list.map((x, i) => checkView(vc.at(i), x)).filter((x): x is RecipeViewConfig => !!x)
          if (!list.length) vc.issue('empty')
        }
      }
      out.database = db
    }
  }
  if (has(o, 'agent')) {
    const a = checkAgent(c.at('agent'), o.agent)
    if (a) out.agent = a
  }
  if (has(o, 'report')) {
    const rc = c.at('report')
    const r = obj(rc, o.report)
    if (r) {
      rc.unknownKeys(r, ['name'])
      out.report = has(r, 'name') ? { name: localText(rc.at('name'), r.name, 120) } : {}
    }
  }
  return dropUndefined(out)
}

/** One recipe on its own (the editor builds each recipe of the raw JSON by its own index). */
export const checkRecipeConfig = (raw: unknown): RecipeConfig | null => checkRecipe(new Ctx(null), raw)

function checkProperties(c: Ctx, v: unknown): RecipePropertyConfig[] | undefined {
  const list = arr(c, v, INTEGRATION_LIMITS.properties)
  if (!list) return undefined
  const out: RecipePropertyConfig[] = []
  const roles = new Set<string>()
  list.forEach((x, i) => {
    const pc = c.at(i)
    const o = obj(pc, x)
    if (!o) return
    pc.unknownKeys(o, ['role', 'name', 'type', 'options', 'key', 'onlyByHand', 'color', 'description'])
    const name = pc.required(o, 'name') ? localText(pc.at('name'), o.name, INTEGRATION_LIMITS.text) : undefined
    const type = pc.required(o, 'type') ? enumOf(pc.at('type'), o.type, RECIPE_PROP_TYPES) : undefined
    if (!name || !type) return
    const p: RecipePropertyConfig = { name, type }
    if (has(o, 'role')) {
      if (typeof o.role !== 'string' || !ROLE.test(o.role)) pc.at('role').issue('role', { value: typeof o.role === 'string' ? o.role : String(o.role) })
      else if (roles.has(o.role)) pc.at('role').issue('duplicate', { value: o.role })
      else {
        roles.add(o.role)
        p.role = o.role
      }
    }
    if (has(o, 'options')) {
      const oc = pc.at('options')
      if (type !== 'select' && type !== 'multi_select' && type !== 'status') oc.issue('optionsType', { type })
      const opts = arr(oc, o.options, INTEGRATION_LIMITS.options)
      if (opts && (type === 'select' || type === 'multi_select' || type === 'status')) {
        p.options = opts.map((y, j) => checkOption(oc.at(j), y, type === 'status')).filter((y): y is RecipeOptionConfig => !!y)
      }
    }
    if (has(o, 'key')) {
      const k = bool(pc.at('key'), o.key)
      if (k && type !== 'text' && type !== 'number' && type !== 'url') pc.at('key').issue('keyType', { type })
      else if (k) p.key = true
    }
    if (has(o, 'onlyByHand')) {
      const h = bool(pc.at('onlyByHand'), o.onlyByHand)
      if (h && type === 'title') pc.at('onlyByHand').issue('handTitle')
      else if (h) p.onlyByHand = true
    }
    if (has(o, 'color')) p.color = color(pc.at('color'), o.color)
    if (has(o, 'description')) p.description = localText(pc.at('description'), o.description, INTEGRATION_LIMITS.description)
    out.push(dropUndefined(p))
  })
  return out
}

function checkOption(c: Ctx, v: unknown, status: boolean): RecipeOptionConfig | null {
  // a plain string is an option with that name
  if (typeof v === 'string') {
    const name = str(c, v, INTEGRATION_LIMITS.text)
    return name ? { name } : null
  }
  const o = obj(c, v)
  if (!o) return null
  c.unknownKeys(o, status ? ['name', 'color', 'group'] : ['name', 'color'])
  const name = c.required(o, 'name') ? localText(c.at('name'), o.name, INTEGRATION_LIMITS.text) : undefined
  if (!name) return null
  const out: RecipeOptionConfig = { name }
  if (has(o, 'color')) out.color = color(c.at('color'), o.color)
  if (status && has(o, 'group')) out.group = enumOf(c.at('group'), o.group, STATUS_GROUPS)
  return dropUndefined(out)
}

/** A property reference: a non-empty name / role. */
function ref(c: Ctx, v: unknown): string | undefined {
  return str(c, v, INTEGRATION_LIMITS.text)
}

function checkFilter(c: Ctx, v: unknown, depth = 0): RecipeFilter | undefined {
  const o = obj(c, v)
  if (!o) return undefined
  if (has(o, 'and') || has(o, 'or')) {
    c.unknownKeys(o, has(o, 'and') ? ['and'] : ['or'])
    const op = has(o, 'and') ? 'and' : 'or'
    if (depth >= INTEGRATION_LIMITS.filterDepth) {
      c.issue('depth', { max: INTEGRATION_LIMITS.filterDepth })
      return undefined
    }
    const gc = c.at(op)
    const list = arr(gc, o[op], INTEGRATION_LIMITS.filterItems)
    if (!list) return undefined
    const items = list.map((x, i) => checkFilter(gc.at(i), x, depth + 1)).filter((x): x is RecipeFilter => !!x)
    if (!list.length) gc.issue('empty')
    return (op === 'and' ? { and: items } : { or: items }) as RecipeFilter
  }
  c.unknownKeys(o, ['property', 'op', 'value'])
  if (!has(o, 'property') && !has(o, 'op')) {
    c.issue('filter')
    return undefined
  }
  const property = c.required(o, 'property') ? ref(c.at('property'), o.property) : undefined
  const op = c.required(o, 'op') ? enumOf(c.at('op'), o.op, FILTER_OPERATORS) : undefined
  if (!property || !op) return undefined
  const out: RecipeFilter = { property, op }
  if (has(o, 'value')) {
    const val = o.value
    if (typeof val === 'string') out.value = val.slice(0, INTEGRATION_LIMITS.text)
    else if (typeof val === 'number' && Number.isFinite(val)) out.value = val
    else if (typeof val === 'boolean') out.value = val
    else c.at('value').issue('filterValue')
  }
  return out
}

function checkView(c: Ctx, v: unknown): RecipeViewConfig | null {
  const o = obj(c, v)
  if (!o) return null
  c.unknownKeys(o, ['name', 'type', 'properties', 'groupBy', 'date', 'filter', 'sort', 'colorRules', 'hiddenGroups', 'hideEmpty'])
  const name = c.required(o, 'name') ? localText(c.at('name'), o.name, INTEGRATION_LIMITS.text) : undefined
  const type = c.required(o, 'type') ? enumOf(c.at('type'), o.type, RECIPE_VIEW_TYPES) : undefined
  if (!name || !type) return null
  const out: RecipeViewConfig = { name, type }
  if (has(o, 'properties')) {
    const pc = c.at('properties')
    const list = arr(pc, o.properties, INTEGRATION_LIMITS.properties)
    if (list) out.properties = list.map((x, i) => ref(pc.at(i), x)).filter((x): x is string => !!x)
  }
  if (has(o, 'groupBy')) out.groupBy = ref(c.at('groupBy'), o.groupBy)
  if (has(o, 'date')) out.date = ref(c.at('date'), o.date)
  if (has(o, 'filter')) out.filter = checkFilter(c.at('filter'), o.filter)
  if (has(o, 'sort')) {
    const sc = c.at('sort')
    const list = arr(sc, o.sort, INTEGRATION_LIMITS.sorts)
    if (list) {
      out.sort = []
      list.forEach((x, i) => {
        const ic = sc.at(i)
        const s = obj(ic, x)
        if (!s) return
        ic.unknownKeys(s, ['property', 'direction'])
        const property = ic.required(s, 'property') ? ref(ic.at('property'), s.property) : undefined
        const direction = has(s, 'direction') ? enumOf(ic.at('direction'), s.direction, ['asc', 'desc'] as const) : 'asc'
        if (property && direction) out.sort!.push({ property, direction })
      })
    }
  }
  if (has(o, 'colorRules')) {
    const rc = c.at('colorRules')
    const list = arr(rc, o.colorRules, INTEGRATION_LIMITS.colorRules)
    if (list) {
      out.colorRules = []
      list.forEach((x, i) => {
        const ic = rc.at(i)
        const r = obj(ic, x)
        if (!r) return
        ic.unknownKeys(r, ['when', 'color', 'target'])
        const when = ic.required(r, 'when') ? checkFilter(ic.at('when'), r.when) : undefined
        const col = ic.required(r, 'color') ? color(ic.at('color'), r.color) : undefined
        const target = has(r, 'target') ? enumOf(ic.at('target'), r.target, ['accent', 'background', 'text'] as const) : undefined
        if (when && col) out.colorRules!.push({ when, color: col, ...(target ? { target } : {}) })
      })
    }
  }
  if (has(o, 'hiddenGroups')) {
    const hc = c.at('hiddenGroups')
    const list = arr(hc, o.hiddenGroups, INTEGRATION_LIMITS.options)
    if (list) out.hiddenGroups = list.map((x, i) => str(hc.at(i), x, INTEGRATION_LIMITS.text)).filter((x): x is string => !!x)
  }
  if (has(o, 'hideEmpty')) {
    const h = bool(c.at('hideEmpty'), o.hideEmpty)
    if (h) out.hideEmpty = true
  }
  return dropUndefined(out)
}

function checkAgent(c: Ctx, v: unknown): RecipeAgentConfig | null {
  const o = obj(c, v)
  if (!o) return null
  c.unknownKeys(o, ['name', 'schedule', 'write', 'budget', 'model', 'effort', 'tools', 'instructions'])
  const out: RecipeAgentConfig = {}
  if (has(o, 'name')) out.name = localText(c.at('name'), o.name, INTEGRATION_LIMITS.name)
  if (has(o, 'schedule')) {
    const sc = c.at('schedule')
    const s = obj(sc, o.schedule)
    if (s) {
      sc.unknownKeys(s, ['every', 'at', 'weekday', 'day'])
      const every = sc.required(s, 'every') ? enumOf(sc.at('every'), s.every, SCHEDULE_EVERY) : undefined
      let at: string | undefined
      if (sc.required(s, 'at')) {
        if (typeof s.at === 'string' && TIME.test(s.at)) at = s.at
        else sc.at('at').issue('time', { value: typeof s.at === 'string' ? s.at : String(s.at) })
      }
      const int = (key: 'weekday' | 'day', min: number, max: number) => {
        if (!has(s, key)) return undefined
        const n = s[key]
        if (typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max) return n
        sc.at(key).issue('range', { min, max })
        return undefined
      }
      const weekday = int('weekday', 0, 6)
      const day = int('day', 1, 31)
      if (every && at) out.schedule = { every, at, ...(every === 'week' && weekday !== undefined ? { weekday } : {}), ...(every === 'month' && day !== undefined ? { day } : {}) }
    }
  }
  if (has(o, 'write')) out.write = enumOf(c.at('write'), o.write, ['stage', 'apply'] as const)
  if (has(o, 'budget')) {
    const b = o.budget
    if (typeof b === 'number' && Number.isFinite(b) && b >= INTEGRATION_LIMITS.minBudget && b <= INTEGRATION_LIMITS.maxBudget) out.budget = Math.round(b * 100) / 100
    else c.at('budget').issue('range', { min: INTEGRATION_LIMITS.minBudget, max: INTEGRATION_LIMITS.maxBudget })
  }
  if (has(o, 'model')) {
    if (o.model === null) out.model = null
    else if (typeof o.model === 'string' && MODEL.test(o.model)) out.model = o.model
    else c.at('model').issue('model', { value: typeof o.model === 'string' ? o.model : String(o.model) })
  }
  if (has(o, 'effort')) out.effort = o.effort === null ? null : enumOf(c.at('effort'), o.effort, EFFORTS)
  if (has(o, 'tools')) {
    const tc = c.at('tools')
    const list = arr(tc, o.tools, 200)
    if (list) {
      const tools: string[] = []
      list.forEach((x, i) => {
        if (typeof x !== 'string' || !TOOL_NAME.test(x)) tc.at(i).issue('tool', { value: typeof x === 'string' ? x : String(x) })
        else if (!tools.includes(x)) tools.push(x)
      })
      out.tools = tools
    }
  }
  if (has(o, 'instructions')) out.instructions = localText(c.at('instructions'), o.instructions, INTEGRATION_LIMITS.instructions, { line: false })
  return dropUndefined(out)
}

function dropUndefined<T extends object>(o: T): T {
  for (const k of Object.keys(o) as Array<keyof T>) if (o[k] === undefined) delete o[k]
  return o
}

/* ------------------------------------------------------------------ store helpers */

/** A clean copy of a profile, or null when it is not one. */
export const sanitizeIntegration = (raw: unknown): IntegrationProfile | null => {
  try {
    return checkIntegration(raw, null)
  } catch {
    return null
  }
}

/** Every valid profile of a stored / imported list (unique ids, ≤ the limit; `dropped`: entries that were not valid). */
export function sanitizeIntegrations(raw: unknown): { integrations: IntegrationProfile[]; dropped: number } {
  const out: IntegrationProfile[] = []
  let dropped = 0
  if (raw === undefined || raw === null) return { integrations: out, dropped }
  const list = Array.isArray(raw) ? raw : isObj(raw) ? Object.values(raw) : null
  if (!list) return { integrations: out, dropped: 1 }
  for (const v of list) {
    const p = out.length < INTEGRATION_LIMITS.profiles ? sanitizeIntegration(v) : null
    if (p && !out.some((x) => x.id === p.id)) out.push(p)
    else dropped++
  }
  return { integrations: out, dropped }
}

/** Two profiles hold the same definition (ignoring updatedAt / updatedBy). */
export function sameIntegration(a: IntegrationProfile | undefined | null, b: IntegrationProfile | undefined | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return JSON.stringify(exportIntegration(a)) === JSON.stringify(exportIntegration(b))
}

/** The profile as the person exports it: the schema's keys only, in the schema's order. */
export function exportIntegration(p: IntegrationProfile): Omit<IntegrationProfile, 'updatedAt' | 'updatedBy'> {
  return {
    schema: INTEGRATION_SCHEMA,
    id: p.id,
    name: p.name,
    ...(p.description ? { description: p.description } : {}),
    match: p.match,
    unlocks: p.unlocks,
    ...(p.recipes?.length ? { recipes: p.recipes } : {}),
  }
}

let mayEdit: () => boolean = () => true
/** Who may change the profiles here (the team binding registers: owners and admins). The store refuses otherwise. */
export function setIntegrationGuard(fn: () => boolean): void {
  mayEdit = fn
}
export const integrationsAllowed = (): boolean => mayEdit()

/** A text in the UI language (the other language stands in; '' when there is none). */
export function localized(v: LocalText | undefined, lang: 'en' | 'de'): string {
  if (v === undefined) return ''
  if (typeof v === 'string') return v
  return v[lang] ?? v[lang === 'en' ? 'de' : 'en'] ?? ''
}

/** Every language variant of a text (references match any of them). */
export function variants(v: LocalText | undefined): string[] {
  if (v === undefined) return []
  if (typeof v === 'string') return [v]
  return [v.en, v.de].filter((x): x is string => !!x)
}

/* ------------------------------------------------------------------ matching */

/** `*` = any characters, `?` = one; case-insensitive, the whole text. */
export function globMatch(glob: string, text: string): boolean {
  const g = glob.toLowerCase()
  const s = text.toLowerCase()
  // iterative matcher with backtracking on the last `*` (no RegExp built from input)
  let gi = 0
  let si = 0
  let star = -1
  let mark = 0
  while (si < s.length) {
    if (gi < g.length && (g[gi] === '?' || g[gi] === s[si])) {
      gi++
      si++
    } else if (gi < g.length && g[gi] === '*') {
      star = gi++
      mark = si
    } else if (star >= 0) {
      gi = star + 1
      si = ++mark
    } else return false
  }
  while (gi < g.length && g[gi] === '*') gi++
  return gi === g.length
}

/** The host of a server URL (lower case; '' when it is no URL). */
export function hostOf(url: string): string {
  try {
    return new URL(url.trim()).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** A server as matching sees it. */
export type MatchServer = Pick<McpServerConfig, 'name' | 'url' | 'enabled'> & { tools?: string[] }

/** Why one server does not satisfy a profile's match (null: it does). */
export type MatchMiss = { kind: 'disabled' } | { kind: 'name' } | { kind: 'host' } | { kind: 'untested' } | { kind: 'tools'; missing: string[] }

export function matchMiss(m: IntegrationMatch, s: MatchServer): MatchMiss | null {
  if (!s.enabled) return { kind: 'disabled' }
  if (m.name && !globMatch(m.name, s.name)) return { kind: 'name' }
  if (m.host && !globMatch(m.host, hostOf(s.url))) return { kind: 'host' }
  if (m.tools?.length) {
    if (!s.tools?.length) return { kind: 'untested' }
    const missing = m.tools.filter((t) => !s.tools!.includes(t))
    if (missing.length) return { kind: 'tools', missing }
  }
  return null
}

/** Is this profile active with these servers — and why (not)? */
export type ProfileStatus =
  | { active: true; server: string }
  | { active: false; reason: 'noConditions' }
  | { active: false; reason: 'noServers' }
  | { active: false; reason: 'disabled'; server: string }
  | { active: false; reason: 'name' }
  | { active: false; reason: 'host' }
  | { active: false; reason: 'untested'; server: string }
  | { active: false; reason: 'tools'; server: string; missing: string[] }

export function profileStatus(p: Pick<IntegrationProfile, 'match'>, servers: MatchServer[]): ProfileStatus {
  const m = p.match
  if (!m || (!m.tools?.length && !m.name && !m.host)) return { active: false, reason: 'noConditions' }
  if (!servers.length) return { active: false, reason: 'noServers' }
  const misses: Array<[MatchServer, MatchMiss]> = []
  for (const s of servers) {
    const miss = matchMiss(m, s)
    if (!miss) return { active: true, server: s.name }
    misses.push([s, miss])
  }
  // the closest miss explains it best: a switched-off server that would match > missing tools of a server that matched
  // the rest > untested > host > name > a switched-off server that would not match either
  const rank = ([s, x]: [MatchServer, MatchMiss]) =>
    x.kind === 'disabled' ? (matchMiss(m, { ...s, enabled: true }) ? 5 : 0) : x.kind === 'tools' ? 1 : x.kind === 'untested' ? 2 : x.kind === 'host' ? 3 : 4
  const [s, miss] = misses.sort((a, b) => rank(a) - rank(b) || (a[1].kind === 'tools' && b[1].kind === 'tools' ? a[1].missing.length - b[1].missing.length : 0))[0]
  // a switched-off server that would otherwise match says so
  if (miss.kind === 'disabled') return matchMiss(m, { ...s, enabled: true }) ? { active: false, reason: 'noServers' } : { active: false, reason: 'disabled', server: s.name }
  if (miss.kind === 'tools') return { active: false, reason: 'tools', server: s.name, missing: miss.missing }
  if (miss.kind === 'untested') return { active: false, reason: 'untested', server: s.name }
  return { active: false, reason: miss.kind }
}

/** The servers that satisfy a profile (enabled ones only), in list order. */
export function matchingServers(p: Pick<IntegrationProfile, 'match'>, servers: MatchServer[]): string[] {
  const m = p.match
  if (!m || (!m.tools?.length && !m.name && !m.host)) return []
  return servers.filter((s) => !matchMiss(m, s)).map((s) => s.name)
}

/** The features the active profiles unlock. */
export function unlockedBy(profiles: IntegrationProfile[] | undefined, servers: MatchServer[]): Set<IntegrationFeature> {
  const out = new Set<IntegrationFeature>()
  for (const p of profiles ?? []) if (profileStatus(p, servers).active) for (const f of p.unlocks) out.add(f)
  return out
}

/**
 * The team server's view (server/src/agents/integrations.ts is its twin): the runtime's MCP servers have no tested tool
 * lists, so only `name` / `host` count there — a profile without either never matches on the server. Returns the
 * server that matched (null: none).
 */
export function serverMatch(p: Pick<IntegrationProfile, 'match'>, servers: Array<{ name: string; url: string }>): string | null {
  const m = p.match
  if (!m || (!m.name && !m.host)) return null
  for (const s of servers) {
    if (m.name && !globMatch(m.name, s.name)) continue
    if (m.host && !globMatch(m.host, hostOf(s.url))) continue
    return s.name
  }
  return null
}

/** The features the profiles unlock for the team server's agents. */
export function serverUnlockedBy(profiles: IntegrationProfile[] | undefined, servers: Array<{ name: string; url: string }>): Set<IntegrationFeature> {
  const out = new Set<IntegrationFeature>()
  for (const p of profiles ?? []) if (serverMatch(p, servers)) for (const f of p.unlocks) out.add(f)
  return out
}
