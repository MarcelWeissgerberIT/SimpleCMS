/**
 * The direct models One knows (Claude and OpenAI) with their capabilities, the model-id validators per provider and
 * the slugs One refuses on OpenRouter. Capabilities replace every "is it Haiku?" string check: a branch asks what the
 * model can do. No OpenRouter model, maker or slug is named here — those come from the person's catalogue.
 */
import type { Caps, Effort, ModelInfo, ProviderId, Route } from './types.ts'
import { priceRow } from './prices.ts'

export const STORED_PROVIDERS: readonly ProviderId[] = ['anthropic', 'openai', 'openrouter']
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

/** The registry row of a route (null: not a known direct model). */
export function modelRow(route: Pick<Route, 'p' | 'm'>): ModelRow | null {
  return MODELS.find((x) => x.route.p === route.p && x.route.m === route.m) ?? null
}

/** What a model can do (null: unknown here — an OpenRouter model's caps come from the catalogue). */
export function capsOf(route: Pick<Route, 'p' | 'm'>): Caps | null {
  return modelRow(route)?.caps ?? null
}

const ID_RE: Record<ProviderId, RegExp> = {
  anthropic: /^claude-[a-z0-9][a-z0-9.-]{0,62}$/,
  openai: /^(ft:)?[a-z0-9][a-z0-9._:-]{0,95}$/,
  // vendor/model[:variant] — no '~' aliases, no '@' presets
  openrouter: /^[a-z0-9][a-z0-9._-]{0,47}\/[a-z0-9][a-z0-9._:-]{0,95}$/,
}

/** What One knows of a catalogue row when it judges a slug (all optional). */
export interface CatalogueHint {
  /** the prompt price ($ per million; routers list -1) */
  promptPrice?: number
  web?: Caps['web']
  description?: string
}

export type SlugRefusal = 'router' | 'alias' | 'online' | 'batch' | 'web'

/** Models that search the web by themselves (a reviewed pattern list) — refused. */
const WEB_SLUG = [/^perplexity\/sonar/, /^[^/]+\/[^/:]*-search(?::|$)/, /deep-research/]
const WEB_TEXT = /\b(searches the web|web search(es)? (by itself|built in|on every)|real-time web (search|access)|browses the web)\b/i

/** Why One refuses an OpenRouter slug (null: not refused). */
export function refusedSlug(id: string, row?: CatalogueHint | null): SlugRefusal | null {
  if (id.startsWith('~') || id.includes('@')) return 'alias'
  if (id.startsWith('openrouter/')) return 'router'
  if (row?.promptPrice !== undefined && row.promptPrice < 0) return 'router'
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

/** The maker of a route's model: Claude direct and anthropic/* on OpenRouter are both Anthropic. */
export function vendorOf(route: Pick<Route, 'p' | 'm'>): string {
  if (route.p !== 'openrouter') return route.p
  return route.m.split('/')[0] ?? route.m
}

const PROVIDER_LABEL: Record<ProviderId, string> = { anthropic: 'Claude', openai: 'OpenAI', openrouter: 'OpenRouter' }
export const providerLabel = (p: ProviderId): string => PROVIDER_LABEL[p]

/** A route as people read it: the registry's label, else "<provider> · <model id>". */
export function labelOf(route: Pick<Route, 'p' | 'm'>): string {
  return modelRow(route)?.label ?? `${PROVIDER_LABEL[route.p] ?? route.p} · ${route.m}`
}
