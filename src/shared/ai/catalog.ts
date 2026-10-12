/**
 * OpenRouter's model catalogue (`GET /api/v1/models`, public), pure: a raw row → One's catalogue row (label, caps,
 * price per million tokens, whether One refuses it and why), the compact form the device keeps (a parameter index
 * table, non-zero prices only, descriptions ≤ 600 characters), the Jev Router's include / exclude lists and its stated
 * price bound, and role suggestions computed from the catalogue's own data. No model, maker or slug is named here (the
 * Jev Router's id lives in jev.ts).
 */
import type { Caps, Effort, PriceCols, PriceOverride, PriceRow, UpstreamRule, WireHints } from './types.ts'
import { EFFORTS, refusedSlug, type SlugRefusal } from './models.ts'
import { DYNAMIC_BOUND, PRICES_DATE, blendedPerM, boundRow } from './prices.ts'
import { REFUSED_GLOBS, ROUTER_LIST_CHARS_MAX, ROUTER_LIST_MAX, ROUTER_LIST_PATTERN_MAX, isJevRouter } from './jev.ts'

const MB = 1024 * 1024
/** Caps for OpenRouter models until spikes confirm the upstreams' own limits (D-S2-18). */
export const OR_VISION = { maxEdge: 1568, maxBytes: 5 * MB } as const
export const OR_PDF = { maxBytes: 23 * MB, maxPages: 100 } as const
/** The answer cap when the catalogue names none. */
export const OR_MAX_OUTPUT = 16_000
export const DESCRIPTION_MAX = 600

export interface CatalogReasoning {
  mandatory: boolean
  /** the efforts it takes (null = every effort; [] = no effort selection) */
  efforts: string[] | null
  default?: string
  supportsMax: boolean
}

/** One catalogue row as One reads it. */
export interface CatalogRow {
  id: string
  /** the model's name without its "Maker: " prefix (≤ 60) */
  label: string
  /** upper case, ≤ 16 */
  short: string
  description: string
  context: number
  /** top_provider.max_completion_tokens (null: not given) */
  maxOutput: number | null
  inputs: { image: boolean; file: boolean }
  /** supported_parameters */
  params: string[]
  reasoning: CatalogReasoning | null
  /** the catalogue marks it a router (tokenizer 'Router') */
  router: boolean
  /** 'dynamic' = priced per request (-1): no price row */
  pricing: 'fixed' | 'dynamic'
  price: PriceRow | null
  /** the date the model leaves (yyyy-MM-dd; null: none announced) */
  expires: string | null
  /** why One refuses it (null: it may be picked) — refused rows are kept so a picker can dim them */
  refused: SlugRefusal | null
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.slice(0, max) : '')
const pos = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null)

/** A per-token price string → $ per million (null: absent / not a number), without float noise (0.0000001 → 0.1). */
const perM = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? Number((n * 1_000_000).toPrecision(12)) : null
}
/** A per-unit price string → $ (null: absent). */
const unit = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

const DAYS: Record<string, string> = { monday: 'mon', tuesday: 'tue', wednesday: 'wed', thursday: 'thu', friday: 'fri', saturday: 'sat', sunday: 'sun' }
/** HHMM (1600 = 16:00) → the hour; minutes round the window outwards (a start down, an end up). */
const hourOf = (v: unknown, end: boolean): number | undefined => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 2400) return undefined
  const h = Math.floor(v / 100)
  const m = v % 100
  return Math.min(24, end && m > 0 ? h + 1 : h)
}

const TOKEN_COLS: Array<[string, keyof PriceCols]> = [
  ['prompt', 'input'],
  ['completion', 'output'],
  ['input_cache_read', 'cacheRead'],
  ['input_cache_write', 'cacheWrite'],
  ['input_cache_write_1h', 'cacheWrite1h'],
  ['internal_reasoning', 'reasoning'],
]
const UNIT_COLS: Array<[string, keyof PriceCols]> = [
  ['image', 'image'],
  ['web_search', 'webSearch'],
  ['request', 'request'],
]

/** A catalogue `pricing` object → a price row (null: dynamic, or no usable price). */
export function priceOfPricing(p: unknown, at: string = PRICES_DATE): { pricing: 'fixed' | 'dynamic'; price: PriceRow | null } {
  if (!isObj(p)) return { pricing: 'fixed', price: null }
  const input = perM(p.prompt)
  const output = perM(p.completion)
  if ((input !== null && input < 0) || (output !== null && output < 0)) return { pricing: 'dynamic', price: null }
  if (input === null || output === null) return { pricing: 'fixed', price: null }
  const cols: Partial<PriceCols> = {}
  for (const [k, c] of TOKEN_COLS) {
    const v = perM(p[k])
    if (v !== null && v >= 0) cols[c] = v
  }
  for (const [k, c] of UNIT_COLS) {
    const v = unit(p[k])
    if (v !== null && v > 0) cols[c] = v
  }
  const overrides: PriceOverride[] = []
  if (Array.isArray(p.overrides))
    for (const o of p.overrides.slice(0, 12)) {
      if (!isObj(o)) continue
      const x: PriceOverride = {}
      for (const [k, c] of TOKEN_COLS) {
        const v = perM(o[k])
        if (v !== null && v >= 0) (x as Record<string, number>)[c] = v
      }
      const mp = pos(o.min_prompt_tokens)
      if (mp !== null) x.minPrompt = mp
      if (Array.isArray(o.utc_days)) {
        const days = o.utc_days.map((d) => (typeof d === 'string' ? DAYS[d.toLowerCase()] : undefined)).filter((d): d is string => !!d)
        if (days.length) x.utcDays = days
      }
      const s = hourOf(o.utc_start, false)
      const e = hourOf(o.utc_end, true)
      if (s !== undefined) x.utcStart = Math.min(23, s)
      if (e !== undefined) x.utcEnd = e === 0 ? 24 : e
      overrides.push(x)
    }
  const price: PriceRow = {
    input,
    output,
    cacheRead: cols.cacheRead ?? input,
    cacheWrite: cols.cacheWrite ?? input,
    ...(cols.cacheWrite1h !== undefined ? { cacheWrite1h: cols.cacheWrite1h } : {}),
    ...(cols.reasoning !== undefined ? { reasoning: cols.reasoning } : {}),
    ...(cols.image !== undefined ? { image: cols.image } : {}),
    ...(cols.webSearch !== undefined ? { webSearch: cols.webSearch } : {}),
    ...(cols.request !== undefined ? { request: cols.request } : {}),
    ...(overrides.length ? { overrides } : {}),
    source: 'catalogue',
    at,
  }
  return { pricing: 'fixed', price }
}

/** "Maker: Model Name" → "Model Name" (≤ 60). */
export function labelOfName(name: string, id: string): string {
  const n = name.replace(/\s+/g, ' ').trim()
  const cut = n.includes(': ') ? n.slice(n.indexOf(': ') + 2) : n
  return (cut || id.split('/')[1] || id).slice(0, 60)
}

/** A label → its short form: upper case, ≤ 16 (leading words dropped first, then cut). */
export function shortOfLabel(label: string): string {
  let words = label.toUpperCase().split(' ').filter(Boolean)
  while (words.join(' ').length > 16 && words.length > 1) words = words.slice(1)
  const s = words.join(' ')
  return s.length > 16 ? `${s.slice(0, 15)}…` : s
}

/** A raw catalogue row → One's row (null: not a model row One can read). */
export function readCatalogRow(raw: unknown, at: string = PRICES_DATE): CatalogRow | null {
  if (!isObj(raw)) return null
  const id = str(raw.id, 160)
  if (!id || !/^[~a-z0-9][a-z0-9._~-]{0,47}\/[a-z0-9][a-z0-9._:@-]{0,111}$/.test(id)) return null
  const arch = isObj(raw.architecture) ? raw.architecture : {}
  const inputs = Array.isArray(arch.input_modalities) ? arch.input_modalities.filter((x): x is string => typeof x === 'string') : []
  const params = Array.isArray(raw.supported_parameters) ? [...new Set(raw.supported_parameters.filter((x): x is string => typeof x === 'string' && x.length <= 64))].slice(0, 64) : []
  const top = isObj(raw.top_provider) ? raw.top_provider : {}
  const r = isObj(raw.reasoning) ? raw.reasoning : null
  const reasoning: CatalogReasoning | null =
    r || params.includes('reasoning')
      ? {
          mandatory: r?.mandatory === true,
          efforts: !r || r.supported_efforts === null ? null : Array.isArray(r.supported_efforts) ? r.supported_efforts.filter((x): x is string => typeof x === 'string').slice(0, 12) : [],
          ...(r && typeof r.default_effort === 'string' ? { default: r.default_effort.slice(0, 16) } : {}),
          supportsMax: r?.supports_max_tokens === true,
        }
      : null
  const router = arch.tokenizer === 'Router'
  const { pricing, price } = priceOfPricing(raw.pricing, at)
  const description = str(raw.description, DESCRIPTION_MAX)
  const label = labelOfName(str(raw.name, 200), id)
  const expires = typeof raw.expiration_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw.expiration_date) ? raw.expiration_date.slice(0, 10) : null
  return {
    id,
    label,
    short: shortOfLabel(label),
    description,
    context: pos(raw.context_length) ?? pos(top.context_length) ?? 0,
    maxOutput: pos(top.max_completion_tokens),
    inputs: { image: inputs.includes('image'), file: inputs.includes('file') },
    params,
    reasoning,
    router,
    pricing,
    price,
    expires,
    refused: refusedSlug(id, { router, pricing, description }),
  }
}

/** What a catalogue row's model can do (D-S2-18 until spikes). */
export function capsOfRow(row: CatalogRow): Caps {
  const efforts = row.reasoning ? (row.reasoning.efforts === null ? [...EFFORTS] : EFFORTS.filter((e) => row.reasoning!.efforts!.includes(e))) : []
  const reasons = !!row.reasoning && row.params.includes('reasoning')
  return {
    structured: row.params.includes('structured_outputs'),
    tools: row.params.includes('tools'),
    vision: row.inputs.image ? { ...OR_VISION } : false,
    pdf: row.inputs.file ? { ...OR_PDF } : false,
    mcp: false,
    mcpListing: false,
    cache: row.id.startsWith('anthropic/') ? 'passthrough' : 'auto',
    effort: efforts.length ? (efforts as Effort[]) : false,
    reasoning: reasons ? { mandatory: row.reasoning!.mandatory } : false,
    web: row.refused === 'web' ? 'always' : false,
    notes: reasons,
    refusalFallback: false,
    context: row.context || OR_MAX_OUTPUT,
    maxOutput: Math.min(row.maxOutput ?? OR_MAX_OUTPUT, row.context || Number.MAX_SAFE_INTEGER),
  }
}

/** The wire facts of a row (build() reads them beside caps). */
export function hintsOfRow(row: CatalogRow): WireHints {
  return { params: [...row.params], ...(row.reasoning ? { reasoning: { ...row.reasoning } } : {}), pricing: row.pricing }
}

/* ------------------------------------------------------------------ */
/* The compact form kept on the device                                  */
/* ------------------------------------------------------------------ */

/** The catalogue as the device keeps it (IndexedDB `one-ai-catalog`): one parameter table, short keys. */
export interface StoredCatalog {
  v: 1
  /** when it was read (ms) */
  at: number
  /** every parameter name, once */
  params: string[]
  rows: StoredRow[]
}

/** One row, short keys: i id · n label · d description · c context · o maxOutput · m inputs ('i' image, 'f' file) · p
 *  parameter indexes · r reasoning [mandatory 0|1, efforts | null, default, supportsMax 0|1] · R router · y 'd' dynamic ·
 *  $ price columns ($/M, non-zero) · v overrides · x expires · f refused */
export interface StoredRow {
  i: string
  n: string
  d?: string
  c: number
  o?: number
  m?: string
  p: number[]
  r?: [0 | 1, string[] | null, string, 0 | 1]
  R?: 1
  y?: 'd'
  $?: Partial<PriceCols>
  v?: PriceOverride[]
  x?: string
  f?: SlugRefusal
}

const PRICE_KEYS_ALL: Array<keyof PriceCols> = ['input', 'output', 'cacheRead', 'cacheWrite', 'cacheWrite1h', 'reasoning', 'image', 'webSearch', 'request']

/** The raw `/models` answer → the compact form (refused rows kept with their reason). */
export function trimCatalog(json: unknown, now: number = Date.now()): StoredCatalog {
  const data = isObj(json) && Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : []
  const at = new Date(now).toISOString().slice(0, 10)
  const params: string[] = []
  const index = new Map<string, number>()
  const rows: StoredRow[] = []
  const seen = new Set<string>()
  for (const raw of data) {
    const row = readCatalogRow(raw, at)
    if (!row || seen.has(row.id)) continue
    seen.add(row.id)
    const p = row.params.map((x) => {
      let i = index.get(x)
      if (i === undefined) {
        i = params.length
        params.push(x)
        index.set(x, i)
      }
      return i
    })
    const $: Partial<PriceCols> = {}
    if (row.price) for (const k of PRICE_KEYS_ALL) if (typeof row.price[k] === 'number' && row.price[k] !== 0) $[k] = row.price[k] as number
    const m = `${row.inputs.image ? 'i' : ''}${row.inputs.file ? 'f' : ''}`
    rows.push({
      i: row.id,
      n: row.label,
      ...(row.description ? { d: row.description } : {}),
      c: row.context,
      ...(row.maxOutput ? { o: row.maxOutput } : {}),
      ...(m ? { m } : {}),
      p,
      ...(row.reasoning ? { r: [row.reasoning.mandatory ? 1 : 0, row.reasoning.efforts, row.reasoning.default ?? '', row.reasoning.supportsMax ? 1 : 0] as StoredRow['r'] } : {}),
      ...(row.router ? { R: 1 as const } : {}),
      ...(row.pricing === 'dynamic' ? { y: 'd' as const } : {}),
      ...(row.price ? { $ } : {}),
      ...(row.price?.overrides?.length ? { v: row.price.overrides } : {}),
      ...(row.expires ? { x: row.expires } : {}),
      ...(row.refused ? { f: row.refused } : {}),
    })
  }
  return { v: 1, at: now, params, rows }
}

/** The compact form → catalogue rows (anything that does not read is left out). */
export function expandCatalog(stored: unknown): CatalogRow[] {
  if (!isObj(stored) || stored.v !== 1 || !Array.isArray(stored.params) || !Array.isArray(stored.rows)) return []
  const params = stored.params.filter((x): x is string => typeof x === 'string')
  const at = typeof stored.at === 'number' ? new Date(stored.at).toISOString().slice(0, 10) : PRICES_DATE
  const out: CatalogRow[] = []
  for (const s of stored.rows as unknown[]) {
    if (!isObj(s) || typeof s.i !== 'string' || typeof s.n !== 'string' || !Array.isArray(s.p)) continue
    const rp = Array.isArray(s.r) ? s.r : null
    const reasoning: CatalogReasoning | null = rp ? { mandatory: rp[0] === 1, efforts: Array.isArray(rp[1]) ? rp[1].filter((x): x is string => typeof x === 'string') : null, ...(typeof rp[2] === 'string' && rp[2] ? { default: rp[2] } : {}), supportsMax: rp[3] === 1 } : null
    const $ = isObj(s.$) ? s.$ : null
    const num = (k: string) => ($ && typeof $[k] === 'number' ? ($[k] as number) : 0)
    const price: PriceRow | null = $
      ? {
          input: num('input'),
          output: num('output'),
          cacheRead: num('cacheRead'),
          cacheWrite: num('cacheWrite'),
          ...Object.fromEntries((['cacheWrite1h', 'reasoning', 'image', 'webSearch', 'request'] as const).filter((k) => num(k) > 0).map((k) => [k, num(k)])),
          ...(Array.isArray(s.v) && s.v.length ? { overrides: s.v as PriceOverride[] } : {}),
          source: 'catalogue',
          at,
        }
      : null
    const label = s.n.slice(0, 60)
    const router = s.R === 1
    const pricing = s.y === 'd' ? 'dynamic' : 'fixed'
    const description = typeof s.d === 'string' ? s.d.slice(0, DESCRIPTION_MAX) : ''
    out.push({
      id: s.i,
      label,
      short: shortOfLabel(label),
      description,
      context: typeof s.c === 'number' ? s.c : 0,
      maxOutput: typeof s.o === 'number' ? s.o : null,
      inputs: { image: typeof s.m === 'string' && s.m.includes('i'), file: typeof s.m === 'string' && s.m.includes('f') },
      params: (s.p as unknown[]).map((i) => (typeof i === 'number' ? params[i] : undefined)).filter((x): x is string => !!x),
      reasoning,
      router,
      pricing,
      price,
      expires: typeof s.x === 'string' ? s.x : null,
      // judged again by this build (a newer rule wins over the stored reason)
      refused: refusedSlug(s.i, { router, pricing, description }),
    })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* The Jev Router: include / exclude lists, the stated bound           */
/* ------------------------------------------------------------------ */

const makerOf = (id: string) => id.split('/')[0] ?? id

/**
 * The router's lists for a pool (D-S2-23): the pool (minus `:free` models while the upstream rule says "no data
 * collection"), and the exclusions — every catalogue maker without a pool model (`<maker>/*`), every other catalogue
 * slug of a pool maker, the refused patterns, every slug the catalogue refuses for web search, and `*:free` while "no
 * data collection". The exclusions make the pool binding: a pool the router cannot serve ends as a 404, never as an
 * unlisted model. null: over the documented list limits (or no pool left).
 */
export function routerLists(pool: readonly string[], rows: readonly CatalogRow[], upstream: Pick<UpstreamRule, 'noCollect'>): { pool: string[]; exclude: string[] } | null {
  const inPool = [...new Set(pool.filter((id) => !isJevRouter(id) && !(upstream.noCollect && id.endsWith(':free'))))]
  if (!inPool.length) return null
  const makers = new Set(inPool.map(makerOf))
  const others = new Set<string>()
  const wildcards = new Set<string>()
  const web = new Set<string>()
  for (const r of rows) {
    if (r.id.startsWith('~')) continue
    const maker = makerOf(r.id)
    if (!makers.has(maker)) wildcards.add(`${maker}/*`)
    else if (!inPool.includes(r.id)) others.add(r.id)
    if (r.refused === 'web') web.add(r.id)
  }
  const exclude = [...new Set([...[...wildcards].sort(), ...[...others].sort(), ...REFUSED_GLOBS, ...[...web].sort(), ...(upstream.noCollect ? ['*:free'] : [])])]
  const fits = (list: string[]) => list.length <= ROUTER_LIST_MAX && list.every((x) => x.length <= ROUTER_LIST_PATTERN_MAX) && list.join('').length <= ROUTER_LIST_CHARS_MAX
  if (!fits(inPool) || !fits(exclude)) return null
  return { pool: inPool, exclude }
}

/**
 * The stated bound of a pool (D-S2-24): per column the most expensive pool row, long-context and time-of-day tiers
 * included (a pool row priced per request counts at DYNAMIC_BOUND). Source 'bound': never stored, its costs are
 * estimates.
 */
export function boundOf(pool: ReadonlyArray<{ price: PriceRow | null }>): PriceRow {
  const cols: PriceCols = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  const take = (c: Partial<PriceCols>) => {
    for (const k of PRICE_KEYS_ALL) {
      const v = c[k]
      if (typeof v === 'number' && Number.isFinite(v) && v > (cols[k] ?? 0)) cols[k] = v
    }
  }
  for (const m of pool) {
    if (!m.price) {
      take({ input: DYNAMIC_BOUND.input, output: DYNAMIC_BOUND.output, cacheRead: DYNAMIC_BOUND.input, cacheWrite: DYNAMIC_BOUND.input })
      continue
    }
    take(m.price)
    for (const o of m.price.overrides ?? []) take(o)
  }
  if (!pool.length) take({ input: DYNAMIC_BOUND.input, output: DYNAMIC_BOUND.output, cacheRead: DYNAMIC_BOUND.input, cacheWrite: DYNAMIC_BOUND.input })
  return boundRow(cols)
}

/* ------------------------------------------------------------------ */
/* Role suggestions                                                     */
/* ------------------------------------------------------------------ */

export interface RoleSuggestion {
  fast: string | null
  standard: string | null
  deep: string | null
}

/**
 * Suggested models per role from catalogue data only (D-S2-34 then checks their endpoints against the deny list and
 * calls again without a pick that fails): among rows One does not refuse, that are not routers, priced, with tools and
 * structured outputs, a context ≥ 64 000 and no leaving date within 30 days — fast = the cheapest (blended 3 in : 1 out,
 * > 0), deep = the one at the 90th price percentile, standard = the one at the median. `allow` narrows the candidates
 * (e.g. picks already refused).
 */
export function suggestRoles(rows: readonly CatalogRow[], allow: (row: CatalogRow) => boolean = () => true, now: number = Date.now()): RoleSuggestion {
  const soon = new Date(now + 30 * 86_400_000).toISOString().slice(0, 10)
  const c = rows
    .filter((r) => !r.refused && !r.router && r.pricing === 'fixed' && r.price && !r.id.endsWith(':free') && !r.id.startsWith('~'))
    .filter((r) => r.params.includes('tools') && r.params.includes('structured_outputs') && r.context >= 64_000)
    .filter((r) => !r.expires || r.expires > soon)
    .filter(allow)
    .map((r) => ({ r, b: blendedPerM(r.price) ?? 0 }))
    .filter((x) => x.b > 0)
    .sort((a, b) => a.b - b.b || a.r.id.localeCompare(b.r.id))
  if (!c.length) return { fast: null, standard: null, deep: null }
  const at = (q: number) => c[Math.min(c.length - 1, Math.max(0, Math.round(q * (c.length - 1))))]!.r.id
  return { fast: at(0), standard: at(0.5), deep: at(0.9) }
}
