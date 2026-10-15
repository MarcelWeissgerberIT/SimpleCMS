/**
 * Costs on the rack (plan §1.6) — pure, the Patchbay's own grouping of this device's ledger entries for today (it never
 * changes the Regler's `consumerOf`). A ledger source names its series (`<series>:<ids…>`, governor/modes.ts):
 *
 *   agent:<id>:<run>              → the agent                 (the run: agent:<id>:<run>)
 *   autofill:<db>:<prop>[:<job>]  → the autofill property     (the run: the job)
 *   script:<id>:<run>             → the script (or the automation it is folded into)
 *   mail:<run>                    → mail organise             (this device's Mails database)
 *   outbox:<id>                   → the Outbox route the caller resolves (a draft's id is its own — none: not on the rack)
 *
 * Everything else (the terminal, the AI menu, help, the palette …) is no module. Money adds up only priced responses;
 * an unpriced one is counted apart ("price unknown" — never $0), "≈" only when an entry is an estimate. The header's
 * money is the sum over the DRAWN modules (sumCosts), so every number matches the rack.
 */
import type { LedgerEntry } from '@/shared/ai/types'
import type { ID } from '../../../store/types'
import type { ModuleCost, ModuleKey } from '../types'
import { moduleKey } from '../ref'

/** The fields costsByModule reads of an entry. */
export type CostEntry = Pick<LedgerEntry, 'source' | 'usd' | 'costSource'> & Partial<Pick<LedgerEntry, 'at' | 'id'>>

/** What the grouping cannot know from a source alone. */
export interface CostResolve {
  /** this device's Mails database (mail organise) */
  mailDb?: ID | null
  /** the Outbox route of an `outbox:<id>` source (null: not one on the rack) */
  outbox?: (id: string) => ModuleKey | null
  /** the automation a script is folded into */
  foldOf?: (script: ID) => ModuleKey | null
}

export interface CostBook {
  /** today per module */
  modules: Record<ModuleKey, ModuleCost>
  /** per run (`agent:<id>:<run>`, `script:<id>:<run>`, `autofill:<db>:<prop>:<job>`, `mail:<run>`) */
  runs: Record<string, ModuleCost>
  /** entries of no module (the terminal, the AI menu …) — never in a header sum */
  elsewhere: ModuleCost
}

const ZERO = (): ModuleCost => ({ usd: 0, estimate: false, unpriced: 0 })

function add(c: ModuleCost, e: CostEntry): void {
  if (e.usd === null || e.usd === undefined || !Number.isFinite(e.usd)) {
    c.unpriced += 1
    return
  }
  c.usd += Math.max(0, e.usd)
  if (e.costSource === 'estimate') c.estimate = true
}

/** The module and the run a source names (null: no module). */
export function moduleOfSource(source: string, r: CostResolve = {}): { module: ModuleKey; run: string | null } | null {
  const parts = source.split(':')
  const [series, a, b, c] = parts
  if (!a) return null
  switch (series) {
    case 'agent':
      return { module: moduleKey({ kind: 'agent', id: a }), run: b ? `agent:${a}:${b}` : null }
    case 'autofill':
      return b ? { module: moduleKey({ kind: 'autofill', db: a, prop: b }), run: c ? `autofill:${a}:${b}:${c}` : null } : null
    case 'script':
      return { module: r.foldOf?.(a) ?? moduleKey({ kind: 'script', id: a }), run: b ? `script:${a}:${b}` : null }
    case 'mail':
      return { module: moduleKey({ kind: 'organise', db: r.mailDb ?? null }), run: `mail:${a}` }
    case 'outbox': {
      const m = r.outbox?.(a) ?? null
      return m ? { module: m, run: null } : null
    }
    default:
      return null
  }
}

/** Today's entries grouped per module and per run (pure). */
export function costsByModule(entries: readonly CostEntry[], r: CostResolve = {}): CostBook {
  const book: CostBook = { modules: {}, runs: {}, elsewhere: ZERO() }
  for (const e of entries) {
    const hit = typeof e.source === 'string' ? moduleOfSource(e.source, r) : null
    if (!hit) {
      add(book.elsewhere, e)
      continue
    }
    add((book.modules[hit.module] ??= ZERO()), e)
    if (hit.run) add((book.runs[hit.run] ??= ZERO()), e)
  }
  return book
}

/** The sum over the drawn modules only (the header: "RUNS TODAY 6 · $0.27"). */
export function sumCosts(modules: Record<ModuleKey, ModuleCost>, drawn: Iterable<ModuleKey>): ModuleCost {
  const out = ZERO()
  for (const k of new Set(drawn)) {
    const c = modules[k]
    if (!c) continue
    out.usd += c.usd
    out.unpriced += c.unpriced
    if (c.estimate) out.estimate = true
  }
  return out
}

/** One more entry, as the meter hears it (a new book — the old one is never changed). */
export function withEntry(book: CostBook, e: CostEntry, r: CostResolve = {}): CostBook {
  const hit = typeof e.source === 'string' ? moduleOfSource(e.source, r) : null
  if (!hit) {
    const elsewhere = { ...book.elsewhere }
    add(elsewhere, e)
    return { ...book, elsewhere }
  }
  const m = { ...(book.modules[hit.module] ?? ZERO()) }
  add(m, e)
  const out: CostBook = { ...book, modules: { ...book.modules, [hit.module]: m } }
  if (hit.run) {
    const run = { ...(book.runs[hit.run] ?? ZERO()) }
    add(run, e)
    out.runs = { ...book.runs, [hit.run]: run }
  }
  return out
}
