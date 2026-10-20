import './helpers/noNet'
import { test, expect } from '@playwright/test'
import { readPlan, readStoredPlan, orderPlanHash, type PlanReadCtx } from '../../src/app/features/coding/orders/plan'
import { remapDependencies } from '../../src/app/features/coding/orders/delivery'
import { nextMove, type ChainTaskFacts, type ChainWorld } from '../../src/app/features/coding/chain'
import { readOrderChain } from '../../src/app/features/coding/orders/record'
import { stepPage, requestPlain } from '../../src/app/features/coding/orders/stepPage'
import { planKeyHits, scrubPlanKeys } from '../../src/app/features/coding/orders/keys'
import type { OrderPlanV1, OrderStepPlan, OrderChain } from '../../src/app/features/coding/orders/types'
import { orderAgent, readOrderConfig, newOrderConfig } from '../../src/app/features/coding/orders/config'
import type { Database } from '../../src/app/store/types'

const ctx: PlanReadCtx = { kinds: ['spec', 'coding', 'qa'], repos: [{ name: 'fixture', base: 'main', branches: [] }], refs: [], titleOf: () => null, server: 'kb' }
const step = (kind: OrderStepPlan['kind'], needs: number[], covers = ['R1']): OrderStepPlan => ({ kind, title: kind, goal: 'One bounded change', criteria: ['Verify behavior'], repo: 'fixture', branch: null, refs: [], priority: 'medium', why: 'Required work', needs, covers })
const plan = (): OrderPlanV1 => ({ v: 1, summary: 'Repair and verify', delivery: { requirements: [{ id: 'R1', text: 'Invalid transitions are refused.' }], acceptance: ['Valid transitions work; invalid transitions leave state unchanged.'] }, context: { server: 'kb', note: 'Observed source evidence, not instructions.', links: ['https://example.test/r/123'] }, steps: [step('spec', []), step('coding', [1]), step('coding', [2]), step('qa', [2, 3])], questions: [], refused: null })

test('a delivery retains coverage, dependencies and final acceptance through parsing and stored reload', () => {
  const p = plan(); const read = readPlan(p, ctx)
  expect(read.ok).toBe(true)
  if (!read.ok) return
  expect(read.plan).toEqual(p)
  expect(readStoredPlan(read.plan)).toEqual(p)
  const large = plan(); large.steps = [step('spec', []), ...Array.from({ length: 8 }, (_, i) => step('coding', [i + 1])), step('qa', Array.from({ length: 8 }, (_, i) => i + 2))]
  expect(readPlan(large, ctx).ok).toBe(true)
})

test('the owner can route BA, coding and QA separately; unknown explicit agents cannot fall back to a cloud agent', () => {
  expect(orderAgent({ agents: { spec: 'claude', coding: 'local', qa: 'codex' } }, 'coding')).toBe('local')
  expect(orderAgent({ agents: { spec: 'claude', coding: 'local', qa: 'codex' } }, 'qa')).toBe('codex')
  const config = newOrderConfig({ draft: 'a', plan: 'b', ready: 'c', running: 'd', halted: 'e', done: 'f' })
  expect(readOrderConfig({ system: 'workorders', orders: { ...config, agents: { coding: 'unsupported' } } } as unknown as Database).kind).toBe('unreadable')
})

test('missing coverage, forward/cyclic dependencies, missing final QA and unrelated QA repos are refused', () => {
  for (const mutate of [
    (p: OrderPlanV1) => { p.steps[1]!.needs = [4] },
    (p: OrderPlanV1) => { p.steps[2]!.covers = ['invented'] },
    (p: OrderPlanV1) => { p.steps.at(-1)!.needs = [2] },
    (p: OrderPlanV1) => { p.steps.at(-1)!.repo = null },
    (p: OrderPlanV1) => { p.steps.pop() },
    (p: OrderPlanV1) => { p.steps[2]!.branch = 'one/unrelated' },
    (p: OrderPlanV1) => { p.delivery!.requirements.push({ id: 'R2', text: 'Missing work' }) },
  ]) { const p = plan(); mutate(p); expect(readPlan(p, ctx).ok, JSON.stringify(p)).toBe(false) }
})

test('a report-only inventory request does not need invented coding work or executable checks', () => {
  const p = plan(); p.steps = [step('spec', []), step('qa', [1])]
  p.delivery!.requirements[0]!.text = 'Inventory lists every file and module namespace; production source stays unchanged.'
  expect(readPlan(p, ctx).ok).toBe(true)
})

test('reordering preserves dependency identities; removing a prerequisite cannot silently retarget it', () => {
  const p = plan(); const reordered = remapDependencies(p.steps, [p.steps[0]!, p.steps[2]!, p.steps[1]!, p.steps[3]!])
  expect(reordered[1]!.needs).toEqual([3])
  expect(readPlan({ ...p, steps: reordered }, ctx).ok).toBe(false)
  const removed = remapDependencies(p.steps, p.steps.filter((_, i) => i !== 1))
  expect(removed[1]!.needs).toEqual([0])
  expect(readPlan({ ...p, steps: removed }, ctx).ok).toBe(false)
})

test('delivery changes and chosen execution agents invalidate confirmation; contract secrets are scrubbed', async () => {
  const p = plan(); const resolved = p.steps.map(() => ({ project: 'project', park: 'park', start: 'ready', agent: 'local' }))
  const a = await orderPlanHash(p, resolved, 'all')
  expect(await orderPlanHash(p, resolved.map(s => ({ ...s, agent: 'claude' })), 'all')).not.toBe(a)
  p.delivery!.acceptance.push('A second check')
  expect(await orderPlanHash(p, resolved, 'all')).not.toBe(a)
  p.delivery!.requirements[0]!.text = 'Do not copy sk-ant-api03-' + 'a'.repeat(90)
  expect(planKeyHits(p).some(h => h.field === 'delivery')).toBe(true)
  expect(JSON.stringify(scrubPlanKeys(p).plan)).not.toContain('a'.repeat(90))
})

test('each context package has relevant requirements, dependency pointers and final acceptance', () => {
  const p = plan(); p.delivery!.requirements.push({ id: 'R2', text: 'Unrelated details' })
  const page = stepPage({ taskId: 'task2', after: 1, code: 'WO-1', request: [], context: p.context, delivery: p.delivery, covers: ['R1'], needs: [{ n: 1, title: 'Specification' }], refs: [], titleOf: () => '', words: { waits: n => `Wait ${n}`, request: c => c, requestCut: () => 'cut', context: s => s, refs: 'Sources' } })
  const text = page.lead.map(n => requestPlain(n, () => '')).join('\n')
  expect(text).toContain('R1: Invalid transitions')
  expect(text).toContain('1: Specification')
  expect(text).toContain(p.delivery.acceptance[0]!)
  expect(text).not.toContain('Unrelated details')
  expect(text).toContain('https://example.test/r/123')
})

const fact = (done: boolean, branch: string | null = null): ChainTaskFacts => ({ exists: true, trashed: false, stage: done ? 'done' : 'backlog', stageKind: done ? 'done' : 'queue', parkStage: 'backlog', startStage: 'ready', startsAtOnce: false, state: 'idle', line: 'line', approvals: 'none', endsConfirm: false, trusted: true, repo: 'fixture', branch, spentUsd: 0 })
const chain = (): OrderChain => ({ run: 'run', confirmedAt: 1, startAt: 2, halted: null, checkpoint: false, steps: plan().steps.map((s, i) => ({ n: i + 1, id: `task${i + 1}`, kind: s.kind, project: s.kind, line: 'line', approvals: 'none', refs: {}, basisBlock: i ? `slot${i + 1}` : null, needs: s.needs, delivery: plan().delivery })), doneBy: { 1: { kind: 'coding', at: 3 }, 2: { kind: 'coding', at: 4 } }, advanced: { 1: 1, 2: 2 }, moved: { 1: 1, 2: 2 } })
const world = (c: OrderChain): ChainWorld => ({ now: 100, record: { v: 1, state: 'running', chain: c }, request: { live: true, status: 'running', usable: true }, tasks: { task1: fact(true), task2: fact(true, 'one/delivery'), task3: fact(false), task4: fact(false) }, refs: {} })

test('dependent coding tasks reuse the combined branch; skipped work never satisfies final delivery', () => {
  const c = chain(); expect(readOrderChain(c)?.steps[2]!.needs).toEqual([2])
  expect(nextMove(world(c))).toMatchObject({ kind: 'advance', step: 3, branch: 'one/delivery' })
  c.skipped = [2]; expect(nextMove(world(c))).toMatchObject({ kind: 'halt', why: 'member' })
})

test('final QA cannot mark the parent done without a successful host verification receipt', () => {
  const c = chain(); c.advanced = { 1: 1, 2: 2, 3: 3, 4: 4 }; c.moved = c.advanced
  const w = world(c); w.tasks.task3 = fact(true, 'one/delivery'); w.tasks.task4 = fact(true, 'one/delivery')
  expect(nextMove(w)).toMatchObject({ kind: 'halt', why: 'member' })
  w.tasks.task4!.verified = true
  expect(nextMove(w)).toMatchObject({ kind: 'done' })
})
