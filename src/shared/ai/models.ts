/**
 * The direct models One knows (Claude and OpenAI) with their capabilities, the model-id validators per provider and
 * the slugs One refuses on OpenRouter. Capabilities replace every "is it Haiku?" string check: a branch asks what the
 * model can do. No OpenRouter model, maker or slug is named here — those come from the person's catalogue (the Jev
 * Router's id lives in jev.ts, the decision to offer it in owner.ts).
 */
import type { Caps, CloudProviderId, Effort, ModelInfo, ProviderId, Route } from './types.ts'
import { priceRow } from './prices.ts'
import { isJevRouter } from './jev.ts'
import { OWNER } from './owner.ts'
import { providerInfo } from './providers.ts'
import { LOCAL_MODEL_RE } from './local.ts'

/** Every provider a stored route may name — 'local' only in this device's rules and the ledger (local.ts). */
export const STORED_PROVIDERS: readonly ProviderId[] = ['anthropic', 'openai', 'openrouter', 'local']
/** The providers a workspace's rules (policy, limits, restricted pages) may name: never 'local'. */
export const WORKSPACE_PROVIDERS: readonly CloudProviderId[] = ['anthropic', 'openai', 'openrouter']
export const isProviderId = (v: unknown): v is ProviderId => typeof v === 'string' && (STORED_PROVIDERS as readonly string[]).includes(v)
export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high']

const MB = 1024 * 1024

/** Claude Opus / Sonnet 5.5: adaptive thinking (progress notes), effort, Anthropic's refusal fallback, 1M context. */
const CLAUDE_55: Caps = {
  structured: true,
  tools: true,
  vision: { maxEdge: 1568, maxBytes: 5 * MB },
  pdf: { maxBytes: 23 * MB, maxPages: 600 },
  mcp: 'connector',
  mcpListing: true,
  cache: 'auto+block',
  effort: ['low', 'medium', 'high'],
  reasoning: { mandatory: true },
  web: false,
  notes: true,
  refusalFallback: true,
  context: 1_000_000,
  maxOutput: 128_000,
}

/** Claude Haiku 4.5: no effort, no thinking notes, no refusal fallback; 200K context, so PDFs ≤ 100 pages. */
const CLAUDE_HAIKU_45: Caps = {
  ...CLAUDE_55,
  pdf: { maxBytes: 23 * MB, maxPages: 100 },
  effort: false,
  reasoning: false,
  notes: false,
  refusalFallback: false,
  context: 200_000,
  maxOutput: 64_000,
}

/** Claude Haiku 5.5 (not selectable until its direct id is confirmed): no refusal fallback. */
const CLAUDE_HAIKU_55: Caps = { ...CLAUDE_HAIKU_45, context: 1_000_000 }

const OPENAI_6: Caps = {
  structured: true,
  tools: true,
  vision: { maxEdge: 2048, maxBytes: 10 * MB },
  pdf: { maxBytes: 23 * MB, maxPages: 600 },
  mcp: 'allow-only',
  mcpListing: true,
  cache: 'auto',
  effort: ['low', 'medium', 'high'],
  reasoning: { mandatory: true, minEffort: 'low' },
  web: false,
  notes: true,
  refusalFallback: false,
  context: 1_050_000,
  maxOutput: 128_000,
}

export interface ModelRow extends ModelInfo {
  /** offered in pickers (false: known for prices and readers, not chosen yet) */
  selectable: boolean
}

const model = (p: ProviderId, m: string, label: string, short: string, vendor: string, caps: Caps, selectable: boolean, role?: ModelInfo['role']): ModelRow => ({
  route: { p, m },
  label,
  short,
  vendor,
  ...(role ? { role } : {}),
  caps,
  price: priceRow({ p, m }),
  selectable,
})

/** Dated with PRICES_DATE. Claude first, in today's picker order (Opus = the default). */
export const MODELS: readonly ModelRow[] = [
  model('anthropic', 'claude-opus-5-5', 'Claude Opus 5.5', 'OPUS 5.5', 'anthropic', CLAUDE_55, true, 'deep'),
  model('anthropic', 'claude-sonnet-5-5', 'Claude Sonnet 5.5', 'SONNET 5.5', 'anthropic', CLAUDE_55, true, 'standard'),
  model('anthropic', 'claude-haiku-4-5', 'Claude Haiku 4.5', 'HAIKU 4.5', 'anthropic', CLAUDE_HAIKU_45, true, 'fast'),
  model('anthropic', 'claude-haiku-5-5', 'Claude Haiku 5.5', 'HAIKU 5.5', 'anthropic', CLAUDE_HAIKU_55, false),
  model('openai', 'gpt-6-luna', 'GPT-6 Luna', 'LUNA', 'openai', { ...OPENAI_6, reasoning: { mandatory: false } }, false, 'fast'),
  model('openai', 'gpt-6.1-sol', 'GPT-6.1 Sol', 'SOL 6.1', 'openai', OPENAI_6, false, 'standard'),
  model('openai', 'gpt-6-astra', 'GPT-6 Astra', 'ASTRA', 'openai', OPENAI_6, false, 'deep'),
]

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5'

/** A model id without its snapshot date: a response may name 'claude-x-5-5-20261001' for the requested 'claude-x-5-5'. */
export const modelBase = (id: string): string => id.replace(/-\d{8}$/, '')

/** Did the requested model answer (its own id or a dated snapshot of it)? */
export const sameModel = (requested: string, served: string): boolean => served === requested || modelBase(served) === modelBase(requested)

/** The registry row of a route (null: not a known direct model). A dated snapshot id reads as its model. */
export function modelRow(route: Pick<Route, 'p' | 'm'>): ModelRow | null {
  const m = modelBase(route.m)
  return MODELS.find((x) => x.route.p === route.p && (x.route.m === route.m || x.route.m === m)) ?? null
}

/** What a model can do (null: unknown here — an OpenRouter model's caps come from the catalogue). */
export function capsOf(route: Pick<Route, 'p' | 'm'>): Caps | null {
  return modelRow(route)?.caps ?? null
}

const ID_RE: Record<ProviderId, RegExp> = {
  anthropic: /^claude-[a-z0-9][a-z0-9.-]{0,62}$/,
  // a fine-tune's id ends in a mixed-case suffix ('ft:gpt-6-luna:nordlicht:tessera:9ABel2dg')
  openai: /^(ft:[a-z0-9][A-Za-z0-9._:-]{0,119}|[a-z0-9][a-z0-9._:-]{0,95})$/,
  // vendor/model[:variant] — no '~' aliases, no '@' presets
  openrouter: /^[a-z0-9][a-z0-9._-]{0,47}\/[a-z0-9][a-z0-9._:-]{0,95}$/,
  // a model name as the local server lists it (local.ts LOCAL_MODEL_RE)
  local: LOCAL_MODEL_RE,
}

/** What One knows of a catalogue row when it judges a slug (all optional). */
export interface CatalogueHint {
  /** the prompt price ($ per million; -1 = priced per request) — never a reason to refuse by itself */
  promptPrice?: number
  web?: Caps['web']
  description?: string
  /** the catalogue marks the row a router (`architecture.tokenizer: 'Router'`): it forwards to other models */
  router?: boolean
  /** 'dynamic' = priced per request — never a reason to refuse by itself (a stated bound prices it) */
  pricing?: 'fixed' | 'dynamic'
}

export type SlugRefusal = 'router' | 'alias' | 'online' | 'batch' | 'web'

/** Models that search the web by themselves (a reviewed pattern list) — refused. */
const WEB_SLUG = [/^perplexity\/sonar/, /^[^/]+\/[^/:]*-search(?::|$)/, /deep-research/]
const WEB_TEXT = /\b(searches the web|web search(es)? (by itself|built in|on every)|real-time web (search|access)|browses the web)\b/i

/**
 * Why One refuses an OpenRouter slug (null: not refused). Routers forward to models One cannot pin (OpenRouter's own
 * with web search) and stay refused — except the Jev Router while the owner offers it (owner.ts), which One pins to the
 * person's own models (wire: its include and exclude lists). A price per request is never a reason by itself.
 */
export function refusedSlug(id: string, row?: CatalogueHint | null): SlugRefusal | null {
  if (id.startsWith('~') || id.includes('@')) return 'alias'
  const jev = isJevRouter(id)
  if (jev && !OWNER.jevRouter) return 'router'
  if (!jev && (id.startsWith('openrouter/') || row?.router === true)) return 'router'
  if (/:online$/.test(id)) return 'online'
  if (/:batch$/.test(id)) return 'batch'
  if (row?.web === 'always' || WEB_SLUG.some((re) => re.test(id)) || (row?.description && WEB_TEXT.test(row.description))) return 'web'
  return null
}

/** Why a model id is not valid for a provider (null: valid). */
export function modelIdProblem(p: unknown, id: unknown, row?: CatalogueHint | null): 'provider' | 'format' | SlugRefusal | null {
  if (!isProviderId(p)) return 'provider'
  if (typeof id !== 'string') return 'format'
  if (p === 'openrouter') {
    const refused = refusedSlug(id, row)
    if (refused) return refused
  }
  return ID_RE[p].test(id) ? null : 'format'
}

/** The maker of a route's model: Claude direct and anthropic/* on OpenRouter are both Anthropic. The Jev Router's
 *  answer may come from any maker: '*' (never counted as an independent second opinion). */
export function vendorOf(route: Pick<Route, 'p' | 'm'>): string {
  if (route.p !== 'openrouter') return route.p
  if (isJevRouter(route.m)) return '*'
  return route.m.split('/')[0] ?? route.m
}

/** The provider's name (providers.ts — the one list of names). */
export const providerLabel = (p: ProviderId): string => providerInfo(p).name

/** A route as people read it: the registry's label, else "<provider> · <model id>". */
export function labelOf(route: Pick<Route, 'p' | 'm'>): string {
  if (route.p === 'openrouter' && isJevRouter(route.m)) return 'OpenRouter · Jev Router'
  return modelRow(route)?.label ?? `${providerLabel(route.p)} · ${route.m}`
}

/** A label → its short form: upper case, ≤ 16 (leading words dropped first, then cut). */
export function shortOfLabel(label: string): string {
  let words = label.toUpperCase().split(' ').filter(Boolean)
  while (words.join(' ').length > 16 && words.length > 1) words = words.slice(1)
  const s = words.join(' ')
  return s.length > 16 ? `${s.slice(0, 15)}…` : s
}
