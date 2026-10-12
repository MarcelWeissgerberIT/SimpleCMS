/**
 * What the setup assistant and Settings › AI show about providers on this device (pure readers of the store and the
 * registry — nothing is fetched or written here): key markers, a provider's plate state, its price range, its roles,
 * the per-answer example, the result of the last free check (this tab's memory: useChecks).
 */
import { create } from 'zustand'
import type { Lang } from '@/shared/i18n'
import type { KeyCredit, PriceRow, ProviderId, Route, ShortlistRow } from '@/shared/ai/types'
import type { AIErrorCode } from '@/shared/ai/errors'
import { MODELS } from '@/shared/ai/models'
import { PROVIDER_ORDER, providerInfo } from '@/shared/ai/providers'
import { isJevRouter, JEV_TIERS } from '@/shared/ai/jev'
import { boundOf } from '@/shared/ai/prices'
import type { Settings } from '../../../store/types'
import { useWorkspace } from '../../../store/store'
import { markerHint } from '../../../lib/vault'
import { estimate } from '../../governor'

export type RoleKey = 'fast' | 'standard' | 'deep'
export const ROLE_KEYS: readonly RoleKey[] = ['fast', 'standard', 'deep']

/** A provider's key marker in settings ('' = none). */
export const markerOf = (s: Pick<Settings, 'aiApiKey' | 'aiKeys'>, p: ProviderId): string => ((p === 'anthropic' ? s.aiApiKey : s.aiKeys?.[p]) ?? '').trim()

/** The last 4 characters of a provider's key ('' = none or too short to show). */
export const keyHint = (s: Pick<Settings, 'aiApiKey' | 'aiKeys'>, p: ProviderId): string => markerHint(markerOf(s, p))

/** One empty list for store selectors (a new [] per read would re-render without end). */
export const NO_ROWS: readonly ShortlistRow[] = []

/** Is a key set for this provider (its marker)? */
export const hasKeyIn = (s: Pick<Settings, 'aiApiKey' | 'aiKeys'>, p: ProviderId): boolean => !!markerOf(s, p)

/** The providers this build sends to, in registry order. */
export const SHIPPED: readonly ProviderId[] = PROVIDER_ORDER.filter((p) => providerInfo(p).shipped)

/** Plates in the assistant and in Settings: the providers this build sends to first, the coming ones after. */
export const PLATE_ORDER: readonly ProviderId[] = [...SHIPPED, ...PROVIDER_ORDER.filter((p) => !providerInfo(p).shipped)]

/* ------------------------------------------------------------------ */
/* The last free check of each provider (this tab only)                 */
/* ------------------------------------------------------------------ */

export interface CheckState {
  state: 'checking' | 'valid' | 'error'
  code?: AIErrorCode
  credit?: KeyCredit
  /** which limit (OpenRouter's limit_source) */
  which?: 'credit' | 'key' | 'budget'
  at: number
}

/** The last check per provider — memory of this tab, never stored (a reload checks again). */
export const useChecks = create<Partial<Record<ProviderId, CheckState>>>(() => ({}))
export const setCheck = (p: ProviderId, c: CheckState | null) =>
  useChecks.setState((s) => {
    const next = { ...s }
    if (c) next[p] = c
    else delete next[p]
    return next
  }, true)

/** Another workspace (a team's, after a reset) or a key removed: its last check says nothing any more. */
let seenEpoch = useWorkspace.getState().epoch
const seenKeys = new Map<ProviderId, boolean>(SHIPPED.map((p) => [p, hasKeyIn(useWorkspace.getState().settings, p)]))
useWorkspace.subscribe((s) => {
  if (s.epoch !== seenEpoch) {
    seenEpoch = s.epoch
    for (const p of SHIPPED) seenKeys.set(p, hasKeyIn(s.settings, p))
    if (Object.keys(useChecks.getState()).length) useChecks.setState({}, true)
    return
  }
  for (const p of SHIPPED) {
    const has = hasKeyIn(s.settings, p)
    if (seenKeys.get(p) && !has && useChecks.getState()[p]?.state !== 'checking') setCheck(p, null)
    seenKeys.set(p, has)
  }
})

/* ------------------------------------------------------------------ */
/* Plate state                                                          */
/* ------------------------------------------------------------------ */

export type PlateState = 'none' | 'picked' | 'ready' | 'refused' | 'no_credit' | 'soon'

export function plateState(p: ProviderId, o: { hasKey: boolean; picked: boolean; check?: CheckState }): PlateState {
  if (!providerInfo(p).shipped) return 'soon'
  if (o.hasKey) {
    if (o.check?.state === 'error' && (o.check.code === 'invalid_key' || o.check.code === 'permission')) return 'refused'
    if (o.check?.state === 'error' && o.check.code === 'no_credit') return 'no_credit'
    return 'ready'
  }
  return o.picked ? 'picked' : 'none'
}

/* ------------------------------------------------------------------ */
/* Prices                                                               */
/* ------------------------------------------------------------------ */

/** "0,10 $" — a price per million in the UI's language (three decimals below 0.1). */
export function perM(n: number, lang: Lang, sign = true): string {
  const loc = lang === 'de' ? 'de-DE' : 'en-US'
  const digits = n > 0 && n < 0.1 ? 3 : 2
  const v = new Intl.NumberFormat(loc, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n)
  return sign ? `${v} $` : v
}

/** A provider's price range per million (registry rows; OpenRouter: the cheapest input of its shortlist). */
export function priceRange(p: ProviderId, list: readonly ShortlistRow[]): { min: number; max: number } | null {
  const rows: Array<PriceRow | null> = p === 'openrouter' ? list.map((r) => r.price) : MODELS.filter((m) => m.route.p === p && (m.selectable || p === 'openai')).map((m) => m.price)
  const priced = rows.filter((r): r is PriceRow => !!r && r.input > 0)
  if (!priced.length) return null
  return { min: Math.min(...priced.map((r) => r.input)), max: Math.max(...priced.map((r) => r.output)) }
}

/** The models line of a registry provider ("Haiku · Sonnet · Opus"). */
export function modelsLine(p: ProviderId): string {
  const rows = MODELS.filter((m) => m.route.p === p && (m.selectable || p === 'openai') && m.role)
  const order: Record<string, number> = { fast: 0, standard: 1, deep: 2, checker: 3 }
  return rows
    .sort((a, b) => (order[a.role!] ?? 9) - (order[b.role!] ?? 9))
    .map((m) => (p === 'anthropic' ? m.label.replace(/^Claude\s+/, '').replace(/\s+[\d.]+$/, '') : m.label))
    .join(' · ')
}

/** ≈ what a short answer costs on a model (1,500 tokens in, 400 out + the least reasoning — UX § 4.4). */
export function shortAnswerUsd(route: Pick<Route, 'p' | 'm'>, price: PriceRow | null): number | null {
  if (!price) return null
  const band = estimate(route, { promptTokens: 1500, maxTokens: 400, outTokens: 400 }, Date.now(), price, null)
  return band ? band.low : null
}

/** The Jev Router's stated bound over a list (the most expensive row per column). */
export const routerBound = (list: readonly ShortlistRow[]): PriceRow => boundOf(list)

/* ------------------------------------------------------------------ */
/* Roles                                                                */
/* ------------------------------------------------------------------ */

/** Claude's roles (the registry's own: fast · standard · deep). */
export function claudeRoles(): Record<RoleKey, string> {
  const pick = (r: RoleKey) => MODELS.find((m) => m.route.p === 'anthropic' && m.selectable && m.role === r)?.route.m ?? ''
  return { fast: pick('fast'), standard: pick('standard'), deep: pick('deep') }
}

/** A provider's roles on this device (Claude: the registry's unless chosen). */
export function rolesOf(p: ProviderId): Partial<Record<RoleKey, string>> {
  const own = useWorkspace.getState().settings.ai?.roles?.[p] ?? {}
  return p === 'anthropic' ? { ...claudeRoles(), ...own } : own
}

/** The route a role makes (the Jev Router: its tier from the role). */
export function roleRoute(p: ProviderId, role: RoleKey, m: string): Route {
  if (p === 'openrouter' && isJevRouter(m)) return { p, m, effort: JEV_TIERS[ROLE_KEYS.indexOf(role)] ?? 'medium' }
  return { p, m }
}
