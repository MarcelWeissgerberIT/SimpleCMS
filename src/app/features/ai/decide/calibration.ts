/**
 * The calibration of the Vorprüfer (slice SJ, § 7.2 — SP-J3), pure: the owner's one command (scripts/jev-calibrate.mjs)
 * sends ≥ 120 labelled, fictional proposals (tests/fixtures/ai/jev/calibration/{en,de}.json) to Jev, each built with the
 * SAME state builder (proposalState) and question set (QSET) a real run uses, 4 times each, and reads back: per threshold
 * 0,60 … 0,95 how often a good proposal would be marked, how often a bad one would pass the write gate, and how much each
 * question moves between identical calls. It never suggests a threshold by itself — the owner sets JEV_DEFAULTS and
 * JEV_CALIBRATED from the summary in one follow-up commit. Nothing here sends anything: the script hands in `send`.
 */
import type { JSONContent } from '@tiptap/core'
import type { DecideQuestion, DecideTurn } from '@/shared/ai/types'
import { JEV_CHECK_KEYS, readChecks, weakest, type JevCheckKey } from '@/shared/ai/decide'
import { createRedactor } from '@/shared/ai/redact'
import type { Database, Page, PropertyDef } from '../../../store/types'
import type { PropChange, StagedChange } from '../agent/types'
import { precheckQuestions } from './questions'
import { proposalState, type ProposalInput, type StateWorld } from './state'

/** One labelled, fictional proposal. */
export interface CalibItem {
  id: string
  category: string
  /** the right answer to each of the four questions */
  expect: Record<JevCheckKey, boolean>
  instructions: string
  kind: 'update_row' | 'append' | 'create_row'
  database?: string
  /** the target row (update_row) — its other values are the state's `row` */
  row?: { title: string; values: Record<string, string> }
  /** update_row: the fields it sets */
  set?: Record<string, string>
  /** append / create_row: the text */
  markdown?: string
  /** create_row: the new row's title */
  title?: string
  /** append: the page and its text before */
  page?: { title: string; text: string }
  trigger?: { type: string; row?: boolean }
}

export interface CalibFile {
  source: string
  lang: 'en' | 'de'
  items: CalibItem[]
}

/** Good = every question's right answer is yes (the gate should let it write); bad = any is no. */
export const isGood = (i: CalibItem): boolean => JEV_CHECK_KEYS.every((k) => i.expect[k])

const DB = 'cdb000000001'
const ROW = 'crow00000001'
const PAGE = 'cpage0000001'
const NEW = 'cnew00000001'

const prop = (name: string, i: number): PropertyDef => ({ id: `cprop${String(i).padStart(7, '0')}`, name, type: name === 'Status' ? 'select' : name === 'Budget' ? 'number' : 'text' }) as PropertyDef

/** A proposal and the world it reads — the calibration's workspace: one database, its row, a page (everything visible). */
export function calibInput(item: CalibItem): { input: ProposalInput; world: StateWorld } {
  const names = [...new Set([...Object.keys(item.row?.values ?? {}), ...Object.keys(item.set ?? {})])]
  const props = names.map(prop)
  const pid = (name: string) => props.find((p) => p.name === name)!.id
  const db = { id: DB, title: item.database ?? 'Projects', properties: [{ id: 'title', name: 'Name', type: 'title' } as PropertyDef, ...props], views: [] } as unknown as Database
  const pages: Record<string, Page> = {
    [DB]: { id: DB, kind: 'database', title: item.database ?? 'Projects', parentId: null } as unknown as Page,
  }
  if (item.row) pages[ROW] = { id: ROW, title: item.row.title, parentId: DB, databaseId: DB, properties: Object.fromEntries(Object.entries(item.row.values).map(([k, v]) => [pid(k), v])) } as unknown as Page
  if (item.page) pages[PAGE] = { id: PAGE, title: item.page.title, parentId: null, content: { type: 'doc', content: item.page.text.split('\n\n').map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) } } as unknown as Page
  let change: StagedChange
  if (item.kind === 'update_row') {
    const props2: PropChange[] = Object.entries(item.set ?? {}).map(([name, after]) => ({ propId: pid(name), name, type: name === 'Status' ? 'select' : name === 'Budget' ? 'number' : 'text', before: item.row?.values[name] ?? '', after }) as unknown as PropChange)
    change = { id: 'c1', n: 1, status: 'pending', kind: 'update_row', pageId: ROW, databaseId: DB, props: props2, ...(item.markdown ? { markdown: item.markdown } : {}) } as unknown as StagedChange
  } else if (item.kind === 'create_row') {
    change = { id: 'c1', n: 1, status: 'pending', kind: 'create_row', pageId: NEW, databaseId: DB, title: item.title ?? 'Untitled', props: [], markdown: item.markdown ?? '' } as unknown as StagedChange
  } else change = { id: 'c1', n: 1, status: 'pending', kind: 'append', pageId: PAGE, markdown: item.markdown ?? '' } as unknown as StagedChange
  const r = createRedactor()
  const serialise = (n: JSONContent): string => (n.type === 'text' ? (n.text ?? '') : (n.content ?? []).map(serialise).join(n.type === 'doc' ? '\n\n' : ''))
  const world: StateWorld = {
    pages,
    databases: { [DB]: db },
    isId: (tok) => tok === DB || tok === ROW || tok === PAGE || tok === NEW || props.some((p) => p.id === tok),
    visible: () => true,
    people: true,
    redactor: r,
    hidden: '[Seite]',
    rowFacts: (d, row) => d.properties.filter((p) => p.type !== 'title').map((p) => ({ name: p.name, value: String(row.properties?.[p.id] ?? '') })).filter((x) => x.value),
    markdown: serialise,
    inScope: null,
  }
  const input: ProposalInput = { agent: { instructions: item.instructions, write: 'stage' }, trigger: { type: item.trigger?.type ?? 'manual', ...(item.trigger?.row && item.row ? { rows: [ROW] } : {}) }, change, changes: [change] }
  return { input, world }
}

/** The state a real run would send for this item (null: not built — a fixture error). */
export function calibState(item: CalibItem, questions: Record<string, DecideQuestion> = precheckQuestions()): Record<string, unknown> | null {
  const { input, world } = calibInput(item)
  const ps = proposalState(input, world, questions)
  return ps && !('refused' in ps) ? ps.state : null
}

/** One item's answers over its repeats (null: that repeat failed). */
export interface CalibResult {
  item: CalibItem
  runs: Array<Record<JevCheckKey, number> | null>
}

/** Jev's turn → the four numbers (null: unusable). */
export function checksOf(turn: Pick<DecideTurn, 'answers'>): Record<JevCheckKey, number> | null {
  const raw: Partial<Record<JevCheckKey, number>> = {}
  for (const k of JEV_CHECK_KEYS) {
    const a = turn.answers[k]
    if (!a || a.type !== 'noul') return null
    raw[k] = a.p
  }
  return readChecks(raw)
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

export const THRESHOLDS = [0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]

export interface CalibSummary {
  items: number
  good: number
  bad: number
  /** items with no usable answer at all */
  failed: number
  /** per threshold: good items whose (median) weakest check is below it — marked though fine */
  falseMark: Record<string, number>
  /** per threshold: bad items whose (median) weakest check is at or above it — not marked though wrong */
  missedMark: Record<string, number>
  /** per threshold: bad items every check of which is at or above it — the write gate would let them through */
  falsePass: Record<string, number>
  /** per question: the mean spread (max − min) between identical calls */
  noise: Record<JevCheckKey, number>
  /** per question: how often its median answer (≥ 0,5) matched the label */
  agreement: Record<JevCheckKey, number>
}

const share = (n: number, d: number): number => (d ? Math.round((n / d) * 1000) / 1000 : 0)

/** The summary of a calibration run (pure — never a suggested threshold). */
export function summarize(results: readonly CalibResult[]): CalibSummary {
  const usable = results.filter((r) => r.runs.some(Boolean))
  const med = (r: CalibResult) => {
    const runs = r.runs.filter((x): x is Record<JevCheckKey, number> => !!x)
    return Object.fromEntries(JEV_CHECK_KEYS.map((k) => [k, median(runs.map((x) => x[k]))])) as Record<JevCheckKey, number>
  }
  const good = usable.filter((r) => isGood(r.item))
  const bad = usable.filter((r) => !isGood(r.item))
  const falseMark: Record<string, number> = {}
  const missedMark: Record<string, number> = {}
  const falsePass: Record<string, number> = {}
  for (const t of THRESHOLDS) {
    const key = t.toFixed(2)
    falseMark[key] = share(good.filter((r) => weakest(med(r)).p < t).length, good.length)
    missedMark[key] = share(bad.filter((r) => weakest(med(r)).p >= t).length, bad.length)
    falsePass[key] = share(bad.filter((r) => JEV_CHECK_KEYS.every((k) => med(r)[k] >= t)).length, bad.length)
  }
  const noise = {} as Record<JevCheckKey, number>
  const agreement = {} as Record<JevCheckKey, number>
  for (const k of JEV_CHECK_KEYS) {
    const spreads = usable.map((r) => {
      const xs = r.runs.filter((x): x is Record<JevCheckKey, number> => !!x).map((x) => x[k])
      return xs.length ? Math.max(...xs) - Math.min(...xs) : 0
    })
    noise[k] = spreads.length ? Math.round((spreads.reduce((a, b) => a + b, 0) / spreads.length) * 1000) / 1000 : 0
    agreement[k] = share(usable.filter((r) => med(r)[k] >= 0.5 === r.item.expect[k]).length, usable.length)
  }
  return { items: results.length, good: good.length, bad: bad.length, failed: results.length - usable.length, falseMark, missedMark, falsePass, noise, agreement }
}

/** One decision for the calibration: the state and the questions in, Jev's turn out (the script's real send). */
export type CalibSend = (state: Record<string, unknown>, questions: Record<string, DecideQuestion>) => Promise<Pick<DecideTurn, 'answers'>>

/** Run every item `repeats` times, ≤ `inFlight` at once (a failed call is a null run, never a retry). */
export async function runCalibration(items: readonly CalibItem[], send: CalibSend, o: { repeats?: number; inFlight?: number; onDone?: (n: number) => void } = {}): Promise<CalibResult[]> {
  const repeats = o.repeats ?? 4
  const questions = precheckQuestions()
  const results: CalibResult[] = items.map((item) => ({ item, runs: [] }))
  const jobs: Array<{ r: CalibResult; state: Record<string, unknown> }> = []
  for (const r of results) {
    const state = calibState(r.item, questions)
    if (!state) continue
    for (let i = 0; i < repeats; i++) jobs.push({ r, state })
  }
  let next = 0
  let done = 0
  const worker = async () => {
    while (next < jobs.length) {
      const j = jobs[next++]!
      try {
        j.r.runs.push(checksOf(await send(j.state, questions)))
      } catch {
        j.r.runs.push(null)
      }
      o.onDone?.(++done)
    }
  }
  await Promise.all(Array.from({ length: Math.min(o.inFlight ?? 3, jobs.length) }, worker))
  return results
}

/** The endpoint tags of a model's `/endpoints` answer (the pins of the calibration's requests). */
export function endpointTags(json: unknown): string[] {
  const eps = (json as { data?: { endpoints?: Array<{ tag?: unknown }> } } | null)?.data?.endpoints
  return Array.isArray(eps) ? eps.map((e) => e.tag).filter((t): t is string => typeof t === 'string' && !!t) : []
}
