/**
 * #/regler's tables from the ledger (Regler § 10.1) — pure (a Node spec reads it): who spent today ("01 Consumers"),
 * the receipt roll grouped by run ("02 Receipts") and the last 30 days by day. Only ids, sources, models and amounts
 * go in (the ledger holds nothing else); names are resolved live by the page. A source's grammar is the ledger's
 * (`<series>:<ids…>`, modes.ts): `ai:<run>:<what>` · `terminal:<conv>:<task>` · `agent:<id>:<run>` ·
 * `autofill:<db>:<prop>:<job>` · `mail:<run>` · `outbox:<id>` · `script:<id>:<run>` · `palette:<n>` · `help:<n>` …
 */
import type { LedgerEntry, ProviderId } from '@/shared/ai/types'

export type ConsumerKind =
  | 'terminal'
  | 'menu'
  | 'agent'
  | 'autofill'
  | 'mail'
  | 'outbox'
  | 'script'
  | 'palette'
  | 'workspace'
  | 'help'
  | 'memory'
  | 'meeting'
  | 'kit'
  | 'setup'
  | 'mcp'
  | 'design'
  | 'writing'
  | 'other'

/** The fields a table reads of an entry. */
export type Entry = Pick<LedgerEntry, 'id' | 'at' | 'source' | 'purpose' | 'cls' | 'served' | 'usd'> & Partial<Pick<LedgerEntry, 'mcpCalls'>>

const SERIES: Readonly<Record<string, ConsumerKind>> = {
  terminal: 'terminal',
  ai: 'menu',
  agent: 'agent',
  autofill: 'autofill',
  mail: 'mail',
  outbox: 'outbox',
  script: 'script',
  palette: 'palette',
  workspace: 'workspace',
  help: 'help',
  memory: 'memory',
  meeting: 'meeting',
  kit: 'kit',
  setup: 'setup',
  'mcp-setup': 'mcp',
  design: 'design',
  instructions: 'writing',
  'script-draft': 'writing',
}

/** Who a ledger entry counts for: the kind, and the agent / database it names (an agent's id, autofill's database). */
export function consumerOf(e: Pick<Entry, 'source'>): { kind: ConsumerKind; id?: string; key: string } {
  const parts = e.source.split(':')
  const kind = SERIES[parts[0] ?? ''] ?? 'other'
  if ((kind === 'agent' || kind === 'autofill') && parts[1]) return { kind, id: parts[1], key: `${kind}:${parts[1]}` }
  return { kind, key: kind }
}

/** A model that answered for a consumer. */
export interface ModelUse {
  p: ProviderId
  model: string
  usd: number
  requests: number
}

export interface Consumer {
  key: string
  kind: ConsumerKind
  /** the agent's / database's id */
  id?: string
  usd: number
  /** responses without a price (counted, never summed as 0 silently — the page says "price unknown") */
  unpriced: number
  /** runs = distinct sources (a terminal task, an agent run, an autofill job, one question …) */
  runs: number
  requests: number
  /** most spent first */
  models: ModelUse[]
  /** the newest response */
  last: number
}

const add = (a: number, b: number | null) => a + (b ?? 0)

/** Today's consumers, most spent first (ties: the newest first). */
export function consumersOf(entries: readonly Entry[]): Consumer[] {
  const by = new Map<string, Consumer & { sources: Set<string> }>()
  for (const e of entries) {
    const c = consumerOf(e)
    const cur = by.get(c.key) ?? { key: c.key, kind: c.kind, ...(c.id ? { id: c.id } : {}), usd: 0, unpriced: 0, runs: 0, requests: 0, models: [], last: 0, sources: new Set<string>() }
    cur.usd = add(cur.usd, e.usd)
    if (e.usd === null) cur.unpriced += 1
    cur.requests += 1
    cur.sources.add(e.source)
    cur.last = Math.max(cur.last, e.at)
    const m = cur.models.find((x) => x.p === e.served.p && x.model === e.served.model)
    if (m) {
      m.usd = add(m.usd, e.usd)
      m.requests += 1
    } else cur.models.push({ p: e.served.p, model: e.served.model, usd: e.usd ?? 0, requests: 1 })
    by.set(c.key, cur)
  }
  return [...by.values()]
    .map(({ sources, ...c }) => ({ ...c, runs: sources.size, models: [...c.models].sort((a, b) => b.usd - a.usd || b.requests - a.requests) }))
    .sort((a, b) => b.usd - a.usd || b.last - a.last)
}

/** One receipt of the roll: the responses of one run (one source). */
export interface RollItem {
  source: string
  kind: ConsumerKind
  id?: string
  /** the run's purpose and class (its first response's) */
  purpose: string
  cls: string
  first: number
  last: number
  /** null: a response had no price */
  usd: number | null
  /** oldest first (a receipt adds them up in order) */
  entries: Entry[]
}

/** The roll: one item per run, the newest run first. */
export function rollOf<E extends Entry>(entries: readonly E[]): Array<Omit<RollItem, 'entries'> & { entries: E[] }> {
  const by = new Map<string, Omit<RollItem, 'entries'> & { entries: E[] }>()
  for (const e of [...entries].sort((a, b) => a.at - b.at)) {
    const cur = by.get(e.source)
    if (cur) {
      cur.entries.push(e)
      cur.last = Math.max(cur.last, e.at)
      cur.usd = cur.usd === null || e.usd === null ? null : cur.usd + e.usd
      continue
    }
    const c = consumerOf(e)
    by.set(e.source, { source: e.source, kind: c.kind, ...(c.id ? { id: c.id } : {}), purpose: e.purpose, cls: e.cls, first: e.at, last: e.at, usd: e.usd, entries: [e] })
  }
  return [...by.values()].sort((a, b) => b.last - a.last)
}

/** The ledger's days (newest first): the day's total and how many runs. */
export function daysOf(entries: readonly Entry[], dayOf: (at: number) => string): Array<{ day: string; usd: number; unpriced: number; runs: number }> {
  const by = new Map<string, { day: string; usd: number; unpriced: number; sources: Set<string> }>()
  for (const e of entries) {
    const day = dayOf(e.at)
    const cur = by.get(day) ?? { day, usd: 0, unpriced: 0, sources: new Set<string>() }
    cur.usd = add(cur.usd, e.usd)
    if (e.usd === null) cur.unpriced += 1
    cur.sources.add(e.source)
    by.set(day, cur)
  }
  return [...by.values()].map(({ sources, ...d }) => ({ ...d, runs: sources.size })).sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
}

/** Runs today: every distinct source. */
export const runsOf = (entries: readonly Pick<Entry, 'source'>[]): number => new Set(entries.map((e) => e.source)).size

/** The providers today's entries reached (registry order is the caller's). */
export const providersOf = (entries: readonly Pick<Entry, 'served'>[]): ProviderId[] => [...new Set(entries.map((e) => e.served.p))]
