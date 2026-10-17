/**
 * Work orders — this device's record of a request (types.ts OrderRecord; IndexedDB `one-coding` `<scope>|order|<rowId>`)
 * as every reader keeps it. Pure (a Node spec reads it). The chain engine acts only on what this reader returns: a
 * record it cannot read is no record (null) — nothing runs on a guess.
 *
 *  - `v` must be 1 (a later build's record is unreadable: null, never overwritten by this build — the sink checks).
 *  - The chain: a run id, its times, 1–24 steps with unique numbers (1–999) and task ids, each with its kind, project,
 *    confirmed pipeline line, Approvals, pinned refs (≤ 8), slot block and own blocks; who finished which step; the
 *    sticky halt; the checkpoint (on unless stored as false); the budget (clamped like the config's); the steps made
 *    while creating, skipped and started. Anything outside these bounds is dropped; a chain without readable steps is
 *    no chain.
 *  - The draft is kept only in its outline (plan, hash, run, time); plan.ts readPlan (B5) reads the plan itself.
 */
import type { ID } from '../../../store/types'
import { BUDGET_RANGE, ORDER_KINDS } from './config'
import { ORDER_HALT_WHYS, type OrderChain, type OrderChainStep, type OrderDoneBy, type OrderDraft, type OrderHaltWhy, type OrderKind, type OrderRecord, type OrderState } from './types'

const STATES: readonly OrderState[] = ['draft', 'creating', 'interrupted', 'running', 'halted', 'done', 'discarded']
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
/** a block id (UUIDs, nanoids, ids an import brought) */
const BLOCK_RE = /^[A-Za-z0-9_-]{1,128}$/
const MAX_STEPS = 24
const MAX_REFS = 8
const MAX_OWN = 8
const MAX_LINE = 4000

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const isId = (v: unknown): v is ID => typeof v === 'string' && ID_RE.test(v)
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const isStepN = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 999
const stepKey = (k: string): number | null => (/^[1-9][0-9]{0,2}$/.test(k) ? Number(k) : null)

function readStep(v: unknown): OrderChainStep | null {
  if (!isObj(v)) return null
  if (!isStepN(v.n) || !isId(v.id) || !(ORDER_KINDS as readonly unknown[]).includes(v.kind) || !isId(v.project)) return null
  if (typeof v.line !== 'string' || v.line.length > MAX_LINE) return null
  if (v.approvals !== 'all' && v.approvals !== 'review' && v.approvals !== 'none') return null
  const refs: Record<ID, number> = {}
  if (isObj(v.refs))
    for (const [id, rev] of Object.entries(v.refs).slice(0, MAX_REFS)) if (isId(id) && typeof rev === 'number' && Number.isInteger(rev) && rev >= 0) refs[id] = rev
  const basisBlock = typeof v.basisBlock === 'string' && BLOCK_RE.test(v.basisBlock) ? v.basisBlock : null
  const own = Array.isArray(v.own) ? [...new Set(v.own.filter((b): b is string => typeof b === 'string' && BLOCK_RE.test(b)))].slice(0, MAX_OWN) : []
  return { n: v.n, id: v.id, kind: v.kind as OrderKind, project: v.project, line: v.line, approvals: v.approvals, refs, basisBlock, ...(own.length ? { own } : {}) }
}

function readDoneBy(v: unknown): OrderDoneBy | null {
  if (!isObj(v) || typeof v.kind !== 'string' || !/^[a-z]{1,32}$/.test(v.kind) || !isTime(v.at)) return null
  return {
    kind: v.kind as OrderDoneBy['kind'],
    ...(typeof v.via === 'string' && /^[a-z]{1,32}$/.test(v.via) ? { via: v.via } : {}),
    at: v.at,
    ...(v.sawNext === true ? { sawNext: true } : {}),
  }
}

/** A chain as the engine acts on it (null: no readable chain). */
export function readOrderChain(v: unknown): OrderChain | null {
  if (!isObj(v) || !isId(v.run) || !isTime(v.confirmedAt) || !isTime(v.startAt) || !Array.isArray(v.steps)) return null
  const steps: OrderChainStep[] = []
  for (const raw of v.steps.slice(0, MAX_STEPS)) {
    const s = readStep(raw)
    // one step per number and per task — a record holding two of either is not this build's: no chain
    if (!s || steps.some((x) => x.n === s.n || x.id === s.id)) return null
    steps.push(s)
  }
  if (!steps.length || v.steps.length > MAX_STEPS) return null
  steps.sort((a, b) => a.n - b.n)
  const ns = new Set(steps.map((s) => s.n))
  const doneBy: Record<number, OrderDoneBy> = {}
  if (isObj(v.doneBy))
    for (const [k, d] of Object.entries(v.doneBy)) {
      const n = stepKey(k)
      const by = readDoneBy(d)
      if (n !== null && ns.has(n) && by) doneBy[n] = by
    }
  let halted: OrderChain['halted'] = null
  if (isObj(v.halted) && isTime(v.halted.at) && (ORDER_HALT_WHYS as readonly unknown[]).includes(v.halted.why))
    halted = { at: v.halted.at, why: v.halted.why as OrderHaltWhy, by: typeof v.halted.by === 'string' ? v.halted.by.slice(0, 200) : '', ...(isStepN(v.halted.step) ? { step: v.halted.step } : {}) }
  else if (v.halted !== null && v.halted !== undefined)
    // a halt this build cannot read stays a halt (the reason unknown): never a chain that runs on by accident
    halted = { at: isObj(v.halted) && isTime(v.halted.at) ? v.halted.at : 0, why: 'status', by: '' }
  const nums = (raw: unknown): Record<number, number> => {
    const out: Record<number, number> = {}
    if (isObj(raw))
      for (const [k, at] of Object.entries(raw)) {
        const n = stepKey(k)
        if (n !== null && ns.has(n) && isTime(at)) out[n] = at
      }
    return out
  }
  const made: Record<number, ID> = {}
  if (isObj(v.made))
    for (const [k, id] of Object.entries(v.made)) {
      const n = stepKey(k)
      if (n !== null && ns.has(n) && isId(id)) made[n] = id
    }
  const skipped = Array.isArray(v.skipped) ? [...new Set(v.skipped.filter((n): n is number => isStepN(n) && ns.has(n)))].sort((a, b) => a - b) : []
  const advanced = nums(v.advanced)
  let budgetUsd: number | undefined
  if (typeof v.budgetUsd === 'number' && Number.isFinite(v.budgetUsd)) budgetUsd = Math.min(BUDGET_RANGE[1], Math.max(BUDGET_RANGE[0], v.budgetUsd))
  return {
    run: v.run,
    confirmedAt: v.confirmedAt,
    startAt: v.startAt,
    steps,
    doneBy,
    halted,
    ...(isTime(v.resumedAt) ? { resumedAt: v.resumedAt } : {}),
    // "Stop after the analysis": on unless stored as false
    checkpoint: v.checkpoint !== false,
    ...(budgetUsd !== undefined ? { budgetUsd } : {}),
    ...(Object.keys(made).length ? { made } : {}),
    ...(skipped.length ? { skipped } : {}),
    ...(Object.keys(advanced).length ? { advanced } : {}),
  }
}

/** A record as this build keeps it (null: none, or not one this build can read). */
export function readOrderRecord(v: unknown): OrderRecord | null {
  if (!isObj(v) || v.v !== 1 || !(STATES as readonly unknown[]).includes(v.state)) return null
  const state = v.state as OrderState
  const out: OrderRecord = { v: 1, state }
  if (isObj(v.want) && isTime(v.want.at) && v.want.mode === 'trigger') out.want = { at: v.want.at, mode: 'trigger' }
  const d = v.draft
  if (isObj(d) && isObj(d.plan) && typeof d.hash === 'string' && d.hash.length <= 128 && isId(d.run) && isTime(d.at)) out.draft = d as unknown as OrderDraft
  if (v.chain !== undefined) {
    const chain = readOrderChain(v.chain)
    // a running, halted or creating request whose chain cannot be read: not this build's to act on
    if (!chain && (state === 'running' || state === 'halted' || state === 'creating' || state === 'interrupted')) return null
    if (chain) out.chain = chain
  } else if (state === 'running' || state === 'halted') return null
  return out
}
