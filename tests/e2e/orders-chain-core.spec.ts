/**
 * Work orders (Prüfaufträge) B3 — the chain core. Node cases (no page): the engine's `nextMove` over a ChainWorld —
 * strict order, nothing early, every halt (Status Angehalten, the request trashed, Status options missing, a member
 * ejected / trashed / gone, out of order, a project that starts new tasks at once, the budget before the next step, no
 * start stage), every card (no evidence — an agent's, the bridge's, an automation's done move —, the analysis
 * checkpoint and `sawNext`, drift, a page changed by someone else, the Confirm wait: never a write), advance, done,
 * wait; the sticky halt; skip; the record transitions and reader; the parked-start guard; the Grundlage (a copy in one
 * callout replacing the slot, idempotent, tasks unwrapped, foreign references as text, ≤ 20 000 characters); keys in a
 * plan; a new task's checks shared with the terminal (word for word). Then the app cases: the chain roles on a project
 * (ensureChainProps: added once, display only, board cards untouched, refused on a locked project) and the
 * parked-start guard in the worker's pick (a fake worker on CODING_E2E_PORT never gets a parked step).
 */
import { test as node, expect as nodeExpect } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, wsEval } from './fixtures'
import { startFakeWorker, type FakeWorker } from './helpers/fakeWorker'
import { WORKER_CAN } from '../../src/app/features/coding/protocol'
import { CARD_ORDER, canSkip, chainProjectProblem, doneEvidence, givesEvidence, mayResume, nextMove, parksNewTasks, strayRows, withAdvance, withDone, withHalt, withLine, withRefs, withResume, withSkip, type ChainTaskFacts, type ChainWorld } from '../../src/app/features/coding/chain'
import { basisBlock, basisText, placeBasis, skippedBlock, slotBlock } from '../../src/app/features/coding/orders/basis'
import { readOrderChain, readOrderRecord } from '../../src/app/features/coding/orders/record'
import { planKeyHits, scrubPlanKeys } from '../../src/app/features/coding/orders/keys'
import { chainWords, stepNo } from '../../src/app/features/coding/orders/words'
import { checkTaskDraft, type DraftWorld } from '../../src/app/features/coding/draft'
import { pipelineLine, startStageOf, type ResolvedStage } from '../../src/app/features/coding/stages'
import type { OrderChain, OrderChainStep, OrderKind, OrderPlanV1, OrderRecord } from '../../src/app/features/coding/orders/types'
import type { Writer } from '../../src/app/store/writer'
import { messages as codingMessages } from '../../src/app/features/coding/messages'
import type { Translate } from '../../src/shared/i18n'

/* ------------------------------------------------------------------ fixtures */

const stage = (id: string, kind: ResolvedStage['kind'], auto: boolean, index: number, extra: Partial<ResolvedStage> = {}): ResolvedStage => ({ id, kind, auto, name: id, color: 'gray', index, ...extra })
/** the standard coding pipeline: backlog (parks) · ready (auto: starts) · plan · approve · implement · test · review · ship · done */
const STANDARD: ResolvedStage[] = [
  stage('backlog', 'queue', false, 0),
  stage('ready', 'queue', true, 1),
  stage('plan', 'plan', true, 2),
  stage('approve', 'gate', false, 3),
  stage('implement', 'implement', true, 4),
  stage('test', 'test', true, 5),
  stage('review', 'gate', false, 6),
  stage('ship', 'git', true, 7, { gitAction: 'pr' }),
  stage('done', 'done', false, 8),
]
const LINE = pipelineLine(STANDARD, true, true, 'review')

const step = (n: number, kind: OrderKind, over: Partial<OrderChainStep> = {}): OrderChainStep => ({ n, id: `task${n}`, kind, project: `proj-${kind}`, line: LINE, approvals: 'review', refs: {}, basisBlock: n > 1 ? `slot${n}` : null, ...over })

/** a parked step's facts: in the backlog, waiting, trusted */
const parked = (over: Partial<ChainTaskFacts> = {}): ChainTaskFacts => ({
  exists: true,
  trashed: false,
  stage: 'backlog',
  stageKind: 'queue',
  parkStage: 'backlog',
  startStage: 'ready',
  startsAtOnce: false,
  state: 'idle',
  line: LINE,
  approvals: 'review',
  endsConfirm: false,
  trusted: true,
  changedBy: null,
  repo: 'website',
  branch: null,
  spentUsd: 0,
  ...over,
})
const running = (over: Partial<ChainTaskFacts> = {}) => parked({ stage: 'implement', stageKind: 'implement', state: 'running', ...over })
const atGate = (over: Partial<ChainTaskFacts> = {}) => parked({ stage: 'review', stageKind: 'gate', ...over })
const finished = (over: Partial<ChainTaskFacts> = {}) => parked({ stage: 'done', stageKind: 'done', ...over })

const T0 = 1_760_000_000_000
const chainOf = (steps: OrderChainStep[], over: Partial<OrderChain> = {}): OrderChain => ({ run: 'run1', confirmedAt: T0, startAt: T0 + 10_000, steps, doneBy: {}, halted: null, checkpoint: true, ...over })
const recordOf = (chain: OrderChain, state: OrderRecord['state'] = 'running'): OrderRecord => ({ v: 1, state, chain })

function world(chain: OrderChain, tasks: Record<string, ChainTaskFacts>, over: Partial<Omit<ChainWorld, 'record' | 'tasks'>> & { state?: OrderRecord['state'] } = {}): ChainWorld {
  return { now: T0 + 60_000, record: recordOf(chain, over.state), request: { live: true, status: 'running', usable: true, ...over.request }, tasks, refs: over.refs ?? {}, ...(over.now !== undefined ? { now: over.now } : {}) }
}

const by = (w: Writer, sawNext = false) => doneEvidence(w, T0 + 30_000, sawNext)
const YOU: Writer = { kind: 'you', via: 'ui' }
const WORKER: Writer = { kind: 'coding', task: 'task1', run: 'r1' }

/** BA → Coding → QA, step 01 started and done by the worker */
const threeSteps = () => [step(1, 'spec'), step(2, 'coding'), step(3, 'qa')]

/* ------------------------------------------------------------------ the engine */

node.describe('nextMove — strict order, step 01, done', () => {
  node('only a running record acts; a draft, a create, an interrupted or finished one waits; a halted one stays halted', () => {
    const chain = chainOf(threeSteps())
    const tasks = { task1: parked(), task2: parked(), task3: parked() }
    for (const state of ['draft', 'creating', 'interrupted', 'done', 'discarded'] as const) nodeExpect(nextMove(world(chain, tasks, { state })), state).toEqual({ kind: 'wait', why: 'inactive' })
    nodeExpect(nextMove(world(chain, tasks, { state: 'halted' }))).toEqual({ kind: 'wait', why: 'halted' })
  })

  node('step 01 waits for its countdown (the Undo window), then starts — into its start stage, nothing copied', () => {
    const chain = chainOf(threeSteps())
    const tasks = { task1: parked(), task2: parked(), task3: parked() }
    nodeExpect(nextMove(world(chain, tasks, { now: T0 + 9_000 }))).toEqual({ kind: 'wait', why: 'startAt', step: 1, at: T0 + 10_000 })
    nodeExpect(nextMove(world(chain, tasks, { now: T0 + 10_000 }))).toEqual({ kind: 'advance', step: 1, to: 'ready', from: null, basis: 'none', branch: null, again: false })
  })

  node('strict order: nothing starts early — while step 01 runs, waits at a gate, asks or failed, steps 02 and 03 stay parked', () => {
    const chain = withAdvance(chainOf(threeSteps()), 1, T0 + 10_000)
    const later = { task2: parked(), task3: parked() }
    nodeExpect(nextMove(world(chain, { task1: running(), ...later }))).toEqual({ kind: 'wait', why: 'running', step: 1 })
    nodeExpect(nextMove(world(chain, { task1: atGate(), ...later }))).toEqual({ kind: 'wait', why: 'gate', step: 1 })
    nodeExpect(nextMove(world(chain, { task1: parked({ stage: 'plan', stageKind: 'plan', state: 'question' }), ...later }))).toEqual({ kind: 'wait', why: 'question', step: 1 })
    nodeExpect(nextMove(world(chain, { task1: parked({ stage: 'implement', stageKind: 'implement', state: 'failed' }), ...later }))).toEqual({ kind: 'wait', why: 'failed', step: 1 })
    // started: in its automatic queue, waiting for the worker
    nodeExpect(nextMove(world(chain, { task1: parked({ stage: 'ready' }), ...later }))).toEqual({ kind: 'wait', why: 'queued', step: 1 })
  })

  node('step n done with evidence → exactly step n+1 starts with step n\'s result; then the next — never two at once', () => {
    let chain = chainOf([step(1, 'coding'), step(2, 'coding'), step(3, 'qa')])
    chain = withDone(withAdvance(chain, 1, T0 + 10_000), 1, by(WORKER))
    nodeExpect(nextMove(world(chain, { task1: finished(), task2: parked(), task3: parked() }))).toEqual({ kind: 'advance', step: 2, to: 'ready', from: 1, basis: 'copy', branch: null, again: false })
    chain = withAdvance(chain, 2, T0 + 40_000)
    nodeExpect(nextMove(world(chain, { task1: finished(), task2: running(), task3: parked() }))).toEqual({ kind: 'wait', why: 'running', step: 2 })
    chain = withDone(chain, 2, by(YOU))
    nodeExpect(nextMove(world(chain, { task1: finished(), task2: finished(), task3: parked() }))).toMatchObject({ kind: 'advance', step: 3, from: 2, basis: 'copy' })
    chain = withDone(withAdvance(chain, 3, T0 + 50_000), 3, by(WORKER))
    nodeExpect(nextMove(world(chain, { task1: finished(), task2: finished(), task3: finished() }))).toEqual({ kind: 'done' })
  })

  node('done: the last step done — whoever moved it (nothing more starts); every step skipped is done too', () => {
    let chain = chainOf([step(1, 'coding'), step(2, 'qa')])
    chain = withDone(withAdvance(withDone(withAdvance(chain, 1, T0), 1, by(WORKER)), 2, T0), 2, by({ kind: 'agent', id: 'ag1', run: 'r' }))
    nodeExpect(nextMove(world(chain, { task1: finished(), task2: finished() }))).toEqual({ kind: 'done' })
    nodeExpect(nextMove(world(withSkip(withSkip(chainOf([step(1, 'coding'), step(2, 'qa')]), 1), 2), {}))).toEqual({ kind: 'done' })
  })

  node('a started step still parked (the move did not land) is moved again — no evidence card, but never past a Confirm wait', () => {
    let chain = withDone(withAdvance(chainOf([step(1, 'coding'), step(2, 'coding')]), 1, T0), 1, by({ kind: 'automation', db: 'd', id: 'a', run: 'r' }))
    chain = withAdvance(chain, 2, T0 + 20_000)
    nodeExpect(nextMove(world(chain, { task1: finished(), task2: parked() }))).toEqual({ kind: 'advance', step: 2, to: 'ready', from: 1, basis: 'copy', branch: null, again: true })
    nodeExpect(nextMove(world(chain, { task1: finished(), task2: parked({ trusted: false }) }))).toMatchObject({ kind: 'card', why: 'confirm', all: ['confirm'], step: 2 })
  })

  node('record-authoritative: a task carrying the relation but not in the chain is never started and changes nothing', () => {
    const chain = withDone(withAdvance(chainOf([step(1, 'coding'), step(2, 'qa')]), 1, T0), 1, by(WORKER))
    const base = { task1: finished(), task2: parked() }
    const move = nextMove(world(chain, base))
    // a duplicated row (Schritt 2 too, in an automatic queue) and an import: never part of the decision
    nodeExpect(nextMove(world(chain, { ...base, copy: parked({ stage: 'ready' }), imported: running() }))).toEqual(move)
    nodeExpect(strayRows(chain, ['task1', 'copy', 'task2', 'imported'])).toEqual(['copy', 'imported'])
    nodeExpect(strayRows(undefined, ['x'])).toEqual(['x'])
  })
})

node.describe('nextMove — cards (VON HAND; the chain waits, never writes)', () => {
  const doneOne = (w: Writer | null, kind: OrderKind = 'coding', sawNext = false) => {
    const c = withAdvance(chainOf([step(1, kind), step(2, 'coding')]), 1, T0)
    return w ? withDone(c, 1, by(w, sawNext)) : c
  }
  const tasks = { task1: finished(), task2: parked() }

  node('no evidence: nobody recorded the done move here, or it was not this device\'s worker, the person on the panel / Preflight or the terminal', () => {
    nodeExpect(nextMove(world(doneOne(null), tasks))).toEqual({ kind: 'card', why: 'evidence', all: ['evidence'], step: 2, from: 1, by: null })
    const others: Writer[] = [
      { kind: 'agent', id: 'ag1', run: 'r1' },
      { kind: 'mcp', session: 's', call: 'c', tool: 'one_update_row' },
      { kind: 'automation', db: 'd', id: 'a', run: 'r' },
      { kind: 'script', id: 's1', run: 'r' },
      { kind: 'sync', source: 'folder', run: 'r' },
      { kind: 'import', run: 'r', source: 'csv' },
      { kind: 'template', id: 't', run: 'r' },
      { kind: 'history', snap: 's' },
      { kind: 'member', account: 'acc2' },
      { kind: 'remote', per: {}, fallback: 'x' },
      { kind: 'you', via: 'undo' },
      { kind: 'you', via: 'button' },
      { kind: 'you', via: 'command' },
      { kind: 'editor', id: 'ed1' },
      { kind: 'system', why: 'tab' },
      { kind: 'unknown' },
    ]
    for (const w of others) {
      nodeExpect(givesEvidence(doneEvidence(w, T0)), w.kind).toBe(false)
      const move = nextMove(world(doneOne(w), tasks))
      nodeExpect(move, JSON.stringify(w)).toMatchObject({ kind: 'card', why: 'evidence', step: 2, from: 1, by: { kind: w.kind } })
    }
    for (const w of [WORKER, { kind: 'terminal', run: 't1', change: 'c1' }, YOU, { kind: 'you', via: 'preflight' }, { kind: 'you' }] as Writer[]) {
      nodeExpect(givesEvidence(doneEvidence(w, T0)), JSON.stringify(w)).toBe(true)
      nodeExpect(nextMove(world(doneOne(w), tasks)).kind, JSON.stringify(w)).toBe('advance')
    }
    nodeExpect(doneEvidence(null, T0)).toEqual({ kind: 'unknown', at: T0 })
    nodeExpect(doneEvidence(YOU, T0, true)).toEqual({ kind: 'you', via: 'ui', at: T0, sawNext: true })
  })

  node('the analysis checkpoint: after a BA step the chain goes on only with a press that showed the next step — or the approval that did (sawNext)', () => {
    nodeExpect(nextMove(world(doneOne(YOU, 'spec'), tasks))).toEqual({ kind: 'card', why: 'checkpoint', all: ['checkpoint'], step: 2, from: 1 })
    nodeExpect(nextMove(world(doneOne(YOU, 'spec', true), tasks)).kind).toBe('advance')
    // "Stop after the analysis" off at confirm: no card
    nodeExpect(nextMove(world({ ...doneOne(YOU, 'spec'), checkpoint: false }, tasks)).kind).toBe('advance')
    // an agent finished the analysis: both reasons on one card — the press passes what the card showed
    const agent = doneOne({ kind: 'agent', id: 'ag1', run: 'r' }, 'spec')
    const card = nextMove(world(agent, tasks))
    nodeExpect(card).toMatchObject({ kind: 'card', why: 'evidence', all: ['evidence', 'checkpoint'] })
    nodeExpect(nextMove(world(agent, tasks), { step: 2, passes: ['evidence'] })).toMatchObject({ kind: 'card', why: 'checkpoint', all: ['checkpoint'] })
    nodeExpect(nextMove(world(agent, tasks), { step: 2, passes: ['evidence', 'checkpoint'] }).kind).toBe('advance')
    // a press for another step passes nothing here
    nodeExpect(nextMove(world(agent, tasks), { step: 3, passes: ['evidence', 'checkpoint'] })).toMatchObject({ kind: 'card', why: 'evidence' })
    // sawNext from a writer that gives no evidence still asks for the evidence
    nodeExpect(nextMove(world(doneOne({ kind: 'agent', id: 'ag1', run: 'r' }, 'spec', true), tasks))).toMatchObject({ kind: 'card', all: ['evidence'] })
  })

  node('the Confirm wait: a step whose write would end its wait, or that is not trusted here, is a card naming the agent — never an advance, and no press passes it', () => {
    const c = doneOne(WORKER)
    nodeExpect(nextMove(world(c, { task1: finished(), task2: parked({ endsConfirm: true, trusted: false, changedBy: 'Agent · Nordlicht-Helfer' }) }))).toEqual({ kind: 'card', why: 'confirm', all: ['confirm'], step: 2, from: 1, agent: 'Agent · Nordlicht-Helfer' })
    nodeExpect(nextMove(world(c, { task1: finished(), task2: parked({ endsConfirm: true }) }))).toMatchObject({ kind: 'card', why: 'confirm' })
    nodeExpect(nextMove(world(c, { task1: finished(), task2: parked({ trusted: false }) }))).toMatchObject({ kind: 'card', why: 'confirm', agent: null })
    // every passable reason pressed: still the card (the version must be confirmed — then the facts say trusted)
    const pressAll = { step: 2, passes: ['evidence', 'checkpoint', 'drift', 'ref'] as const }
    nodeExpect(nextMove(world(c, { task1: finished(), task2: parked({ trusted: false }) }), pressAll)).toMatchObject({ kind: 'card', why: 'confirm' })
    nodeExpect(nextMove(world(c, { task1: finished(), task2: parked() }), pressAll).kind).toBe('advance')
    // a caller handing in 'confirm' anyway passes nothing
    nodeExpect(nextMove(world(c, { task1: finished(), task2: parked({ trusted: false }) }), { step: 2, passes: ['confirm'] as unknown as ['drift'] })).toMatchObject({ kind: 'card', why: 'confirm' })
    // step 01 too, at its start
    nodeExpect(nextMove(world(chainOf([step(1, 'coding')]), { task1: parked({ trusted: false }) }))).toMatchObject({ kind: 'card', why: 'confirm', step: 1, from: null })
    nodeExpect(CARD_ORDER).toEqual(['evidence', 'checkpoint', 'basis', 'drift', 'ref', 'confirm'])
  })

  node('drift: the next step\'s pipeline line or its Approvals changed since confirm → a card saying what; the person\'s ↵ passes it (withLine keeps the new line)', () => {
    const c = doneOne(WORKER)
    const other = pipelineLine(STANDARD.map((s) => (s.id === 'ship' ? { ...s, gitAction: 'merge' as const } : s)), true, true, 'review')
    nodeExpect(other).not.toBe(LINE)
    nodeExpect(nextMove(world(c, { task1: finished(), task2: parked({ line: other }) }))).toEqual({ kind: 'card', why: 'drift', all: ['drift'], step: 2, from: 1, drift: ['line'] })
    nodeExpect(nextMove(world(c, { task1: finished(), task2: parked({ approvals: 'none' }) }))).toMatchObject({ kind: 'card', drift: ['approvals'] })
    nodeExpect(nextMove(world(c, { task1: finished(), task2: parked({ line: other, approvals: 'all' }) }))).toMatchObject({ kind: 'card', drift: ['line', 'approvals'] })
    nodeExpect(nextMove(world(c, { task1: finished(), task2: parked({ line: other }) }), { step: 2, passes: ['drift'] }).kind).toBe('advance')
    const kept = withLine(c, 2, other, 'review')
    nodeExpect(nextMove(world(kept, { task1: finished(), task2: parked({ line: other }) })).kind).toBe('advance')
    // the line itself: start stage, whether that starts the worker, where it stops (with these Approvals), git
    nodeExpect(JSON.parse(LINE)).toEqual(['ready', 'queue', true, 'review', [['ship', 'pr']]])
    nodeExpect(JSON.parse(pipelineLine(STANDARD, true, true, 'all'))[3]).toBe('approve')
    nodeExpect(JSON.parse(pipelineLine(STANDARD, true, false, 'review')).slice(0, 3)).toEqual(['backlog', 'queue', false])
  })

  node('a page the next step takes along changed since confirm by someone else → a card naming it; the person\'s own edit goes on', () => {
    const [A3, A4, B7, B9] = ['a3', 'a4', 'b7', 'b9'].map((x) => x.repeat(32))
    const c = withDone(withAdvance(chainOf([step(1, 'coding'), step(2, 'coding', { refs: { pageA: A3!, pageB: B7! } })]), 1, T0), 1, by(WORKER))
    const tasks = { task1: finished(), task2: parked() }
    nodeExpect(nextMove(world(c, tasks, { refs: { pageA: { fp: A3!, foreign: true }, pageB: { fp: B7!, foreign: false } } })).kind).toBe('advance')
    nodeExpect(nextMove(world(c, tasks, { refs: { pageA: { fp: A4!, foreign: false }, pageB: { fp: B7!, foreign: false } } })).kind).toBe('advance')
    nodeExpect(nextMove(world(c, tasks, { refs: { pageA: { fp: A4!, foreign: true }, pageB: { fp: B9!, foreign: true } } }))).toEqual({ kind: 'card', why: 'ref', all: ['ref'], step: 2, from: 1, refs: ['pageA', 'pageB'] })
    // a press alone never passes a changed page: only its pin moved to what the card rendered does (the sink, withRefs)
    nodeExpect(nextMove(world(c, tasks, { refs: { pageA: { fp: A4!, foreign: true } } }), { step: 2, passes: ['ref'] })).toMatchObject({ kind: 'card', why: 'ref' })
    nodeExpect(nextMove(world(withRefs(c, 2, { pageA: A4! }), tasks, { refs: { pageA: { fp: A4!, foreign: true } } }), { step: 2, passes: ['ref'] }).kind).toBe('advance')
  })
})

node.describe('nextMove — halts (sticky)', () => {
  const twoSteps = () => withDone(withAdvance(chainOf([step(1, 'coding'), step(2, 'qa'), step(3, 'qa')]), 1, T0), 1, by(WORKER))
  const tasks = () => ({ task1: finished(), task2: parked(), task3: parked() })

  node('the request: Status Angehalten (by any writer), trashed or gone, its Status options missing', () => {
    nodeExpect(nextMove(world(twoSteps(), tasks(), { request: { live: true, status: 'halted', usable: true } }))).toEqual({ kind: 'halt', why: 'status' })
    nodeExpect(nextMove(world(twoSteps(), tasks(), { request: { live: false, status: 'running', usable: true } }))).toEqual({ kind: 'halt', why: 'trashed' })
    nodeExpect(nextMove(world(twoSteps(), tasks(), { request: { live: true, status: null, usable: false } }))).toEqual({ kind: 'halt', why: 'statusOption' })
    // Fertig by anyone but the chain's own end: the chain ended ('finished') — while this device asks, it waits
    nodeExpect(nextMove(world(twoSteps(), tasks(), { request: { live: true, status: 'done', usable: true } }))).toEqual({ kind: 'halt', why: 'finished' })
    // any other Status (someone dragged it) is not the engine's business
    for (const status of ['draft', 'plan', 'ready', null] as const) nodeExpect(nextMove(world(twoSteps(), tasks(), { request: { live: true, status, usable: true } })).kind, String(status)).toBe('advance')
  })

  node('a member: ejected, trashed or gone while the chain still needs it — a done step whose successor started is no longer needed', () => {
    nodeExpect(nextMove(world(twoSteps(), { ...tasks(), task3: parked({ trashed: true }) }))).toEqual({ kind: 'halt', why: 'member', step: 3 })
    nodeExpect(nextMove(world(twoSteps(), { task1: finished(), task2: parked() }))).toEqual({ kind: 'halt', why: 'member', step: 3 })
    nodeExpect(nextMove(world(twoSteps(), { ...tasks(), task3: parked({ exists: false, gone: true }) }))).toEqual({ kind: 'halt', why: 'member', step: 3 })
    // absent, never seen here, the chain young: on its way from the tab that made it — it waits
    nodeExpect(nextMove(world(twoSteps(), { ...tasks(), task3: parked({ exists: false }) }))).toEqual({ kind: 'wait', why: 'arriving', step: 3 })
    nodeExpect(nextMove(world(twoSteps(), { ...tasks(), task2: parked({ ejected: true, trashed: true }) }))).toEqual({ kind: 'halt', why: 'ejected', step: 2 })
    // step 01 done but its result not copied yet: still needed
    nodeExpect(nextMove(world(twoSteps(), { ...tasks(), task1: finished({ trashed: true }) }))).toEqual({ kind: 'halt', why: 'member', step: 1 })
    // once step 02 started, step 01 in the trash halts nothing
    const on = withAdvance(twoSteps(), 2, T0 + 1)
    nodeExpect(nextMove(world(on, { task1: finished({ trashed: true }), task2: running(), task3: parked() }))).toEqual({ kind: 'wait', why: 'running', step: 2 })
    // a running step in the trash does
    nodeExpect(nextMove(world(on, { task1: finished(), task2: running({ trashed: true }), task3: parked() }))).toEqual({ kind: 'halt', why: 'member', step: 2 })
  })

  node('out of order: a parked step out of its park stage, or running, without the engine having started it — by any writer', () => {
    nodeExpect(nextMove(world(twoSteps(), { ...tasks(), task3: parked({ stage: 'ready' }) }))).toEqual({ kind: 'halt', why: 'outOfOrder', step: 3 })
    nodeExpect(nextMove(world(twoSteps(), { ...tasks(), task3: finished() }))).toEqual({ kind: 'halt', why: 'outOfOrder', step: 3 })
    nodeExpect(nextMove(world(twoSteps(), { ...tasks(), task2: parked({ state: 'running' }) }))).toEqual({ kind: 'halt', why: 'outOfOrder', step: 2 })
    // the same stage after the engine started it: fine
    nodeExpect(nextMove(world(withAdvance(twoSteps(), 2, T0), { ...tasks(), task2: parked({ stage: 'ready' }) }))).toEqual({ kind: 'wait', why: 'queued', step: 2 })
  })

  node('the parked-start guard: a parked step\'s project that now hands new tasks to the worker at once halts; a project with no stage to start a step in too', () => {
    nodeExpect(nextMove(world(twoSteps(), { ...tasks(), task3: parked({ startsAtOnce: true }) }))).toEqual({ kind: 'halt', why: 'startsAtOnce', step: 3 })
    nodeExpect(nextMove(world(twoSteps(), { ...tasks(), task2: parked({ startStage: 'backlog' }) }))).toEqual({ kind: 'halt', why: 'noStart', step: 2 })
    nodeExpect(nextMove(world(twoSteps(), { ...tasks(), task2: parked({ startStage: null }) }))).toEqual({ kind: 'halt', why: 'noStart', step: 2 })
  })

  node('the budget: this device\'s worker reports summed — before the next step, never mid-step', () => {
    const c = { ...twoSteps(), budgetUsd: 2 }
    nodeExpect(nextMove(world(c, { ...tasks(), task1: finished({ spentUsd: 2.4 }) }))).toEqual({ kind: 'halt', why: 'budget', step: 2 })
    nodeExpect(nextMove(world(c, { ...tasks(), task1: finished({ spentUsd: 1.99 }) })).kind).toBe('advance')
    // over the budget while step 02 runs: it runs on (the halt comes before step 03)
    const on = withAdvance(c, 2, T0)
    nodeExpect(nextMove(world(on, { task1: finished({ spentUsd: 1.5 }), task2: running({ spentUsd: 1 }), task3: parked() }))).toEqual({ kind: 'wait', why: 'running', step: 2 })
    nodeExpect(nextMove(world(withDone(on, 2, by(WORKER)), { task1: finished({ spentUsd: 1.5 }), task2: finished({ spentUsd: 1 }), task3: parked() }))).toEqual({ kind: 'halt', why: 'budget', step: 3 })
    nodeExpect(mayResume({ record: recordOf(withHalt(c, { why: 'budget', by: 'order' }, T0)), tasks: { task1: finished({ spentUsd: 2.4 }) } })).toBe('budget')
    nodeExpect(mayResume({ record: recordOf(withHalt({ ...c, budgetUsd: 5 }, { why: 'budget', by: 'order' }, T0)), tasks: { task1: finished({ spentUsd: 2.4 }) } })).toBe('ok')
    nodeExpect(mayResume({ record: recordOf(c), tasks: {} })).toBe('notHalted')
  })

  node('sticky: a halted chain waits whatever the Status says (another writer setting Läuft changes nothing); only a resume leaves it — and halts again for the same reason', () => {
    const halted = withHalt(twoSteps(), { why: 'status', by: 'you~ui' }, T0)
    nodeExpect(halted.halted).toEqual({ at: T0, why: 'status', by: 'you~ui' })
    for (const status of ['running', 'halted', 'done', null] as const) nodeExpect(nextMove(world(halted, tasks(), { request: { live: true, status, usable: true } }))).toEqual({ kind: 'wait', why: 'halted' })
    // a second halt keeps the first
    nodeExpect(withHalt(halted, { why: 'budget', by: 'order' }, T0 + 5).halted).toEqual(halted.halted)
    const resumed = withResume(halted, T0 + 100)
    nodeExpect(resumed).toMatchObject({ halted: null, resumedAt: T0 + 100 })
    nodeExpect(nextMove(world(resumed, tasks(), { request: { live: true, status: 'halted', usable: true } }))).toEqual({ kind: 'halt', why: 'status' })
    nodeExpect(nextMove(world(resumed, tasks())).kind).toBe('advance')
  })

  node('skip (S): a failed, stopped, trashed, gone or ejected step leaves the chain; the next one starts without a Grundlage from it; a halt about it is lifted', () => {
    const on = withAdvance(twoSteps(), 2, T0)
    const failed = { task1: finished(), task2: parked({ stage: 'implement', stageKind: 'implement', state: 'failed' }), task3: parked() }
    nodeExpect(nextMove(world(on, failed))).toEqual({ kind: 'wait', why: 'failed', step: 2 })
    nodeExpect(canSkip(world(on, failed), 2)).toBe(true)
    nodeExpect(canSkip(world(on, failed), 3)).toBe(false)
    nodeExpect(canSkip(world(on, failed), 1)).toBe(false)
    nodeExpect(canSkip(world(on, failed), 9)).toBe(false)
    const skipped = withSkip(on, 2)
    nodeExpect(skipped.skipped).toEqual([2])
    nodeExpect(canSkip(world(skipped, failed), 2)).toBe(false)
    nodeExpect(nextMove(world(skipped, failed))).toEqual({ kind: 'advance', step: 3, to: 'ready', from: 2, basis: 'skipped', branch: null, again: false })
    // a trashed parked step: halted, S lifts that halt
    const trashed = { ...tasks(), task3: parked({ trashed: true }) }
    const halted = withHalt(twoSteps(), { why: 'member', by: 'order', step: 3 }, T0)
    nodeExpect(canSkip(world(halted, trashed), 3)).toBe(true)
    const lifted = withSkip(halted, 3)
    nodeExpect(lifted.halted).toBeNull()
    nodeExpect(nextMove(world(lifted, trashed)).kind).toBe('advance')
    // a halt about another step stays
    nodeExpect(withSkip(halted, 2).halted).toEqual(halted.halted)
    nodeExpect(canSkip(world(on, { ...failed, task2: parked({ stage: 'implement', stageKind: 'implement', state: 'stopped' }) }), 2)).toBe(true)
    nodeExpect(canSkip(world(on, { ...failed, task2: running() }), 2)).toBe(false)
  })
})

node('the QA step takes the coding step\'s branch — same repo, no branch of its own', () => {
  let c = withDone(withAdvance(chainOf([step(1, 'coding'), step(2, 'qa')]), 1, T0), 1, by(WORKER))
  const coded = finished({ branch: 'one/login-timeout-4711' })
  nodeExpect(nextMove(world(c, { task1: coded, task2: parked() }))).toMatchObject({ kind: 'advance', step: 2, branch: 'one/login-timeout-4711' })
  nodeExpect(nextMove(world(c, { task1: coded, task2: parked({ repo: 'shop' }) }))).toMatchObject({ kind: 'advance', branch: null })
  nodeExpect(nextMove(world(c, { task1: coded, task2: parked({ branch: 'qa/own' }) }))).toMatchObject({ kind: 'advance', branch: null })
  nodeExpect(nextMove(world(c, { task1: finished(), task2: parked() }))).toMatchObject({ kind: 'advance', branch: null })
  // a coding step after a coding step keeps its own branch rule (none taken)
  c = withDone(withAdvance(chainOf([step(1, 'coding'), step(2, 'coding')]), 1, T0), 1, by(WORKER))
  nodeExpect(nextMove(world(c, { task1: coded, task2: parked() }))).toMatchObject({ kind: 'advance', branch: null })
})

/* ------------------------------------------------------------------ the parked-start guard (projects) */

node('the parked-start guard: which projects can take chain steps', () => {
  const base = { kind: 'coding' as OrderKind, pipeline: STANDARD, locked: false, hasRoles: false, repo: true, caps: null }
  nodeExpect(parksNewTasks(STANDARD)).toBe(true)
  nodeExpect(startStageOf(STANDARD, true, false)?.id).toBe('backlog')
  nodeExpect(chainProjectProblem(base)).toBeNull()
  // its first stage hands new tasks to the worker at once
  const eager = STANDARD.map((s) => (s.id === 'backlog' ? { ...s, auto: true } : s))
  nodeExpect(parksNewTasks(eager)).toBe(false)
  nodeExpect(chainProjectProblem({ ...base, pipeline: eager })).toBe('startsAtOnce')
  // no automatic queue: nowhere to start a step
  const manual = STANDARD.map((s) => (s.id === 'ready' ? { ...s, auto: false } : s))
  nodeExpect(chainProjectProblem({ ...base, pipeline: manual })).toBe('noStart')
  // an Import stage: a step without a repo starts there (as today)
  const intake = [stage('backlog', 'queue', false, 0), stage('import', 'import', false, 1), stage('ready', 'queue', true, 2), stage('plan', 'plan', true, 3), stage('done', 'done', false, 4)]
  nodeExpect(chainProjectProblem({ ...base, pipeline: intake, repo: false })).toBeNull()
  nodeExpect(chainProjectProblem({ ...base, pipeline: [] })).toBe('empty')
  nodeExpect(chainProjectProblem({ ...base, locked: true })).toBe('locked')
  nodeExpect(chainProjectProblem({ ...base, locked: true, hasRoles: true })).toBeNull()
  const stories = [stage('backlog', 'queue', false, 0), stage('ready', 'queue', true, 1), stage('stories', 'doc', true, 2, { output: 'stories' }), stage('done', 'done', false, 3)]
  nodeExpect(chainProjectProblem({ ...base, kind: 'spec', pipeline: stories })).toBe('stories')
  // stages the connected worker cannot run
  const doc = [stage('backlog', 'queue', false, 0), stage('ready', 'queue', true, 1), stage('analyse', 'doc', true, 2), stage('done', 'done', false, 3)]
  nodeExpect(chainProjectProblem({ ...base, kind: 'spec', pipeline: doc, caps: new Set(['analyze']) })).toBe('needs')
  nodeExpect(chainProjectProblem({ ...base, kind: 'spec', pipeline: doc, caps: new Set(['doc']) })).toBeNull()
})

/* ------------------------------------------------------------------ the record */

node.describe('this device\'s record (readOrderRecord)', () => {
  const full = (): OrderRecord => {
    let c = chainOf([step(1, 'spec', { own: ['quote1'] }), step(2, 'coding', { refs: { pageA: 'a3'.repeat(32) }, own: ['quote2', 'slot2'] }), step(3, 'qa')], { budgetUsd: 4, made: { 1: 'task1', 2: 'task2', 3: 'task3' } })
    c = withHalt(withSkip(withDone(withAdvance(c, 1, T0), 1, by(YOU, true)), 3), { why: 'budget', by: 'order', step: 2 }, T0 + 9)
    return { v: 1, state: 'halted', chain: c }
  }

  node('a full record reads back as it was', () => {
    const r = full()
    nodeExpect(readOrderRecord(JSON.parse(JSON.stringify(r)))).toEqual(r)
    nodeExpect(readOrderRecord({ v: 1, state: 'draft' })).toEqual({ v: 1, state: 'draft' })
    nodeExpect(readOrderRecord({ v: 1, state: 'draft', want: { at: T0, mode: 'trigger' } })).toEqual({ v: 1, state: 'draft', want: { at: T0, mode: 'trigger' } })
  })

  node('a record this build cannot read is no record — nothing runs on a guess', () => {
    nodeExpect(readOrderRecord({ ...full(), v: 2 })).toBeNull()
    nodeExpect(readOrderRecord({ ...full(), state: 'paused' })).toBeNull()
    nodeExpect(readOrderRecord(null)).toBeNull()
    nodeExpect(readOrderRecord('x')).toBeNull()
    // running without a readable chain
    nodeExpect(readOrderRecord({ v: 1, state: 'running' })).toBeNull()
    nodeExpect(readOrderRecord({ v: 1, state: 'running', chain: { ...full().chain, steps: [] } })).toBeNull()
    // two steps with one number or one task: not this build's
    const c = full().chain!
    nodeExpect(readOrderChain({ ...c, steps: [c.steps[0], { ...c.steps[1], n: 1 }] })).toBeNull()
    nodeExpect(readOrderChain({ ...c, steps: [c.steps[0], { ...c.steps[1], id: 'task1' }] })).toBeNull()
    nodeExpect(readOrderChain({ ...c, steps: [{ ...c.steps[0], kind: 'deploy' }] })).toBeNull()
    nodeExpect(readOrderChain({ ...c, steps: [{ ...c.steps[0], approvals: 'some' }] })).toBeNull()
    nodeExpect(readOrderChain({ ...c, run: '../x' })).toBeNull()
  })

  node('bounds: junk around a readable chain is dropped; an unknown halt stays a halt; the checkpoint stays on unless false; the budget is clamped', () => {
    const c = full().chain!
    const read = readOrderChain({
      ...c,
      checkpoint: 'no',
      budgetUsd: 1e9,
      halted: { at: T0, why: 'meteor', by: 'x' },
      doneBy: { 1: { kind: 'you', via: 'ui', at: T0 }, 7: { kind: 'coding', at: T0 }, 2: { kind: 'Bad Kind', at: T0 }, x: { kind: 'coding', at: T0 } },
      advanced: { 1: T0, 9: T0, 2: 'soon' },
      skipped: [3, 3, 12, 'x'],
      made: { 1: 'task1', 2: '../x' },
      steps: [{ ...c.steps[0], refs: { pageA: 'f0'.repeat(32), '../b': 'f0'.repeat(32), pageC: 'nope', pageD: 1.5, pageE: 2 }, basisBlock: 'bad block', own: ['ok-1', 'no way', 5] }, c.steps[1], c.steps[2]],
    })!
    nodeExpect(read.checkpoint).toBe(true)
    nodeExpect(read.budgetUsd).toBe(10_000)
    nodeExpect(read.halted).toEqual({ at: T0, why: 'status', by: '' })
    nodeExpect(read.doneBy).toEqual({ 1: { kind: 'you', via: 'ui', at: T0 } })
    nodeExpect(read.advanced).toEqual({ 1: T0 })
    nodeExpect(read.skipped).toEqual([3])
    nodeExpect(read.made).toEqual({ 1: 'task1' })
    // a fingerprint kept; an older record's revision number: unknown ('' — it asks); anything else dropped
    nodeExpect(read.steps[0]).toEqual({ ...c.steps[0], refs: { pageA: 'f0'.repeat(32), pageE: '' }, basisBlock: null, own: ['ok-1'] })
    nodeExpect(readOrderChain({ ...c, checkpoint: false })!.checkpoint).toBe(false)
  })

  node('the record transitions never touch what they are not about', () => {
    const c = chainOf(threeSteps())
    nodeExpect(withDone(c, 1, by(WORKER)).doneBy).toEqual({ 1: { kind: 'coding', at: T0 + 30_000 } })
    nodeExpect(withDone(withDone(c, 1, by(WORKER)), 1, by({ kind: 'agent', id: 'a', run: 'r' })).doneBy[1]!.kind).toBe('agent')
    nodeExpect(withAdvance(withAdvance(c, 1, 5), 2, 6).advanced).toEqual({ 1: 5, 2: 6 })
    nodeExpect(withLine(c, 2, '["x"]', 'none').steps.map((s) => [s.n, s.line === LINE, s.approvals])).toEqual([[1, true, 'review'], [2, false, 'none'], [3, true, 'review']])
    nodeExpect(c.doneBy).toEqual({})
    nodeExpect(c.advanced).toBeUndefined()
  })
})

/* ------------------------------------------------------------------ the Grundlage */

/** the coding strings as the app's translator reads them ({name} filled in; shared/i18n itself needs Vite's env) */
const tr = (lang: 'en' | 'de'): Translate => ((key: string, vars?: Record<string, string | number>) => {
  const str = (codingMessages[lang] as Record<string, string>)[key] ?? key
  return vars ? str.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : str
}) as Translate
const en = chainWords(tr('en'), 'en')
const de = chainWords(tr('de'), 'de')

const p = (text: string, id?: string, extra: Partial<JSONContent> = {}): JSONContent => ({ type: 'paragraph', ...(id ? { attrs: { id } } : {}), content: [{ type: 'text', text }], ...extra })
const ids = (blocks: JSONContent[]) => blocks.map((b) => b.attrs?.id ?? null)

node.describe('the Grundlage (orders/basis.ts)', () => {
  const stepOne: JSONContent[] = [
    // step 01's own chain blocks: never copied on
    { type: 'blockquote', attrs: { id: 'quote1' }, content: [p('Auftrag (PA-12): prüfe den Login-Timeout')] },
    { type: 'callout', attrs: { id: 'ctx1', icon: 'asset:history', color: 'gray' }, content: [p('Kontext vom MCP-Server Wissensbasis (fremd)')] },
    { type: 'heading', attrs: { id: 'h1', level: 2 }, content: [{ type: 'text', text: 'Analyse' }] },
    p('Der Login bricht nach 30 s ab, siehe Supportfall.', 'p1'),
    {
      type: 'paragraph',
      attrs: { id: 'p2' },
      content: [
        { type: 'text', text: 'Belege: ' },
        { type: 'mention', attrs: { id: 'pageKeep', label: 'Supportfall 4711', kind: 'page' } },
        { type: 'text', text: ' und ' },
        { type: 'mention', attrs: { id: 'pageOther', label: '', kind: 'page' } },
        { type: 'text', text: ' · ' },
        { type: 'text', text: 'Notiz', marks: [{ type: 'link', attrs: { href: '#/p/pageNote1' } }, { type: 'bold' }] },
        { type: 'text', text: ' · Quelle https://one.example.test/SimpleCMS/app/#/p/pagePasted ', marks: [{ type: 'comment', attrs: { id: 'th1' } }] },
        { type: 'mention', attrs: { id: '2026-10-17', label: '17. Okt.', kind: 'date' } },
      ],
    },
    { type: 'workItem', attrs: { id: 'w1', itemId: 'wi_abcdefghij', status: 'todo' }, content: [p('Timeout im Gateway prüfen', 'w1t')] },
    { type: 'pageLink', attrs: { id: 'pl1', pageId: 'pageLinked' } },
    { type: 'syncedBlock', attrs: { id: 'sy1', syncId: 'sync1', sourcePageId: null }, content: [p('Gemeinsamer Absatz', 'syp')] },
    { type: 'toc', attrs: { id: 'toc1' } },
    { type: 'button', attrs: { id: 'b1', label: 'Los', actions: '[]' } },
    { type: 'databaseBlock', attrs: { id: 'db1', databaseId: 'dbCases', viewId: 'v1' } },
    { type: 'callout', attrs: { id: 'co1', icon: 'asset:code', color: 'blue' }, content: [{ type: 'toc', attrs: { id: 'toc2' } }] },
  ]
  const titles: Record<string, string> = { pageOther: 'Wissensbasis-Eintrag', pageNote1: 'Notizen', pagePasted: 'Release-Plan', pageLinked: 'Launch plan', dbCases: 'Testfälle' }
  const input = (over: Partial<Parameters<typeof basisBlock>[0]> = {}) => ({
    id: 'slot2',
    heading: de.basisHeading(1, 'spec', 'Login-Timeout analysieren'),
    content: stepOne,
    drop: new Set(['quote1', 'ctx1']),
    keep: new Set(['pageKeep']),
    titleOf: (id: string) => titles[id] ?? 'Ohne Titel',
    cutNote: de.cutNote(1),
    ...over,
  })

  node('a copy in ONE callout with the slot\'s id: heading first, own blocks out, tasks unwrapped, foreign references as text, dangerous blocks out', () => {
    const { block, cut } = basisBlock(input())
    nodeExpect(cut).toBe(false)
    nodeExpect(block.type).toBe('callout')
    nodeExpect(block.attrs).toEqual({ id: 'slot2', icon: 'asset:history', color: 'gray' })
    const kids = block.content!
    nodeExpect(kids[0]).toEqual({ type: 'heading', attrs: { id: 'slot2-h', level: 2 }, content: [{ type: 'text', text: 'Aus Schritt 01 (Analyse): Login-Timeout analysieren' }] })
    const json = JSON.stringify(kids)
    // never copied on: the Auftrag, the Kontext, a toc, a button, the synced original, the task block, comments
    for (const gone of ['quote1', 'ctx1', 'toc1', 'toc2', 'b1', 'sy1', 'sync1', 'w1"', 'wi_abcdefghij', 'workItem', 'syncedBlock', 'comment', 'th1', 'databaseBlock', 'pageLink"']) nodeExpect(json, gone).not.toContain(gone)
    // the page's headings one level down (the copy sits under its own heading)
    nodeExpect(kids[1]).toEqual({ type: 'heading', attrs: { id: 'h1', level: 3 }, content: [{ type: 'text', text: 'Analyse' }] })
    const p2 = kids.find((k) => k.attrs?.id === 'p2')!
    nodeExpect(p2.content).toEqual([
      { type: 'text', text: 'Belege: ' },
      // a page the next step was confirmed with stays a reference
      { type: 'mention', attrs: { id: 'pageKeep', label: 'Supportfall 4711', kind: 'page' } },
      { type: 'text', text: ' und ' },
      // any other: its title as text (a private page without a label: the title the app passes)
      { type: 'text', text: '@Wissensbasis-Eintrag' },
      { type: 'text', text: ' · ' },
      { type: 'text', text: 'Notiz', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' · Quelle @Release-Plan ' },
      { type: 'mention', attrs: { id: '2026-10-17', label: '17. Okt.', kind: 'date' } },
    ])
    // the task's text, the synced block's content, the page link and the inline database as text
    nodeExpect(ids(kids)).toEqual(['slot2-h', 'h1', 'p1', 'p2', 'w1t', 'slot2-c1', 'syp', 'slot2-c2', 'co1'])
    nodeExpect(basisText(kids[5]!)).toBe('@Launch plan')
    nodeExpect(basisText(kids[7]!)).toBe('@Testfälle')
    // a container left empty keeps a paragraph (its schema needs a block)
    nodeExpect(kids[8]).toEqual({ type: 'callout', attrs: { id: 'co1', icon: 'asset:code', color: 'blue' }, content: [{ type: 'paragraph' }] })
    // nothing step n+1 was not confirmed with is referenced any more: no page id but the kept one
    nodeExpect(json.match(/page[A-Z][A-Za-z0-9]*/g)?.filter((x) => x !== 'pageKeep') ?? []).toEqual([])
    nodeExpect(json).not.toContain('#/p/')
  })

  node('placed idempotently: it replaces the slot wherever it stands, a second advance replaces the first copy, a deleted slot comes back on top', () => {
    const page: JSONContent = { type: 'doc', content: [slotBlock('slot2', de.waits(1)), p('Auftrag', 'quote2'), p('Ziel', 'goal2')] }
    nodeExpect(page.content![0]).toEqual({ type: 'paragraph', attrs: { id: 'slot2' }, content: [{ type: 'text', text: 'Wartet auf Schritt 01' }] })
    const once = placeBasis(page, 'slot2', basisBlock(input()).block)
    nodeExpect(ids(once.content!)).toEqual(['slot2', 'quote2', 'goal2'])
    nodeExpect(once.content![0]!.type).toBe('callout')
    const twice = placeBasis(once, 'slot2', basisBlock(input()).block)
    nodeExpect(twice).toEqual(once)
    const changed = placeBasis(once, 'slot2', basisBlock(input({ content: [p('Neue Analyse', 'n1')] })).block)
    nodeExpect(changed.content!.filter((b) => b.type === 'callout')).toHaveLength(1)
    nodeExpect(basisText(changed.content![0]!)).toBe('Aus Schritt 01 (Analyse): Login-Timeout analysieren\nNeue Analyse')
    // the person moved the slot into a toggle: replaced there
    const nested: JSONContent = { type: 'doc', content: [p('Ziel', 'goal2'), { type: 'details', attrs: { id: 'd1' }, content: [{ type: 'detailsSummary', content: [{ type: 'text', text: 'Mehr' }] }, { type: 'detailsContent', content: [slotBlock('slot2', 'x')] }] }] }
    const inToggle = placeBasis(nested, 'slot2', skippedBlock('slot2', de.skipped(1)))
    nodeExpect(JSON.stringify(inToggle)).toContain('Schritt 01 übersprungen — keine Grundlage')
    nodeExpect(ids(inToggle.content!)).toEqual(['goal2', 'd1'])
    // the person deleted the slot: the copy comes back at the top (once)
    const noSlot: JSONContent = { type: 'doc', content: [p('Ziel', 'goal2')] }
    const back = placeBasis(noSlot, 'slot2', basisBlock(input()).block)
    nodeExpect(ids(back.content!)).toEqual(['slot2', 'goal2'])
    nodeExpect(placeBasis(back, 'slot2', basisBlock(input()).block)).toEqual(back)
  })

  node('step n\'s own Grundlage never travels on (no copies of copies); its tasks never become a second task', () => {
    const stepTwo: JSONContent[] = [basisBlock(input()).block, p('Auftrag', 'quote2'), p('Umgesetzt: Timeout auf 60 s', 'r2')]
    const { block } = basisBlock(input({ id: 'slot3', heading: de.basisHeading(2, 'coding', 'Timeout erhöhen'), content: stepTwo, drop: new Set(['slot2', 'quote2']) }))
    nodeExpect(basisText(block)).toBe('Aus Schritt 02 (Coding): Timeout erhöhen\nUmgesetzt: Timeout auf 60 s')
  })

  node('≤ 20 000 characters: whole blocks while they fit, the one crossing cut, a note naming the counts', () => {
    const long = Array.from({ length: 30 }, (_, i) => p('x'.repeat(1000), `l${i}`))
    const b = basisBlock(input({ content: long }))
    nodeExpect(b).toMatchObject({ chars: 20_000, total: 30_000, cut: true })
    const kids = b.block.content!
    nodeExpect(kids.length).toBe(1 + 20 + 1)
    nodeExpect(kids.at(-1)).toEqual({ type: 'paragraph', attrs: { id: 'slot2-cut' }, content: [{ type: 'text', text: 'Gekürzt: 20.000 von 30.000 Zeichen aus Schritt 01', marks: [{ type: 'italic' }] }] })
    // a block crossing the limit: as much of its text as fits
    const mid = basisBlock(input({ content: [p('a'.repeat(15_000), 'a'), p('b'.repeat(15_000), 'b')] }))
    nodeExpect(mid).toMatchObject({ chars: 20_000, cut: true })
    nodeExpect(basisText(mid.block.content![2]!)).toBe('b'.repeat(5_000))
    nodeExpect(basisBlock(input({ content: [p('kurz', 'k')], max: 4 }))).toMatchObject({ chars: 4, total: 4, cut: false })
    nodeExpect(en.cutNote(2)(20_000, 31_204)).toBe('Cut: 20,000 of 31,204 characters of step 02')
  })

  node('the words: two-digit steps, both languages', () => {
    nodeExpect(stepNo(1)).toBe('01')
    nodeExpect(stepNo(12)).toBe('12')
    nodeExpect(en.basisHeading(1, 'spec', '  Login   timeout ')).toBe('From step 01 (analysis): Login timeout')
    nodeExpect(en.skipped(2)).toBe('Step 02 skipped — no basis')
    nodeExpect(en.waits(1)).toBe('Waits for step 01')
    nodeExpect(de.basisHeading(2, 'qa', 'Testfälle')).toBe('Aus Schritt 02 (QA): Testfälle')
    for (const lang of ['en', 'de'] as const)
      for (const key of ['kind.spec', 'kind.coding', 'kind.qa', 'chain.waitsStep', 'chain.basis', 'chain.skipped', 'chain.basisCut']) nodeExpect(codingMessages[lang][`features.coding.order.${key}`], `${lang} ${key}`).toBeTruthy()
  })
})

/* ------------------------------------------------------------------ keys in a plan */

node('keys in a plan: every field holding one is named (the repair round); what is left is scrubbed and counted per step', () => {
  const KEY = 'sk-ant-api03-' + 'A'.repeat(24)
  const OTHER = 'sk-' + 'b'.repeat(30)
  const plan: OrderPlanV1 = {
    v: 1,
    summary: 'Der Login bricht ab.',
    context: { server: 'wissensbasis', note: `Eintrag nennt ${OTHER}`, links: ['https://kb.example.test/a'] },
    steps: [
      { kind: 'spec', title: 'Analyse', goal: 'Ursache finden', criteria: ['Ursache benannt'], repo: null, branch: null, priority: 'high', refs: [], why: 'unklar' },
      { kind: 'coding', title: 'Timeout erhöhen', goal: `Setze den Key ${KEY} nicht ein`, criteria: ['keine Keys', `auch nicht ${KEY}`], repo: 'website', branch: null, priority: 'medium', refs: [], why: 'Fix' },
    ],
    questions: [],
    refused: null,
  }
  nodeExpect(planKeyHits(plan)).toEqual([
    { step: null, field: 'context' },
    { step: 2, field: 'goal' },
    { step: 2, field: 'criteria' },
  ])
  const { plan: clean, scrubbed } = scrubPlanKeys(plan)
  nodeExpect(scrubbed).toEqual([
    { step: null, count: 1 },
    { step: 2, count: 2 },
  ])
  nodeExpect(clean.steps[1]!.goal).toBe('Setze den Key •••• nicht ein')
  nodeExpect(clean.steps[1]!.criteria).toEqual(['keine Keys', 'auch nicht ••••'])
  nodeExpect(clean.context!.note).toBe('Eintrag nennt ••••')
  nodeExpect(planKeyHits(clean)).toEqual([])
  // a plan without keys: the same object, nothing counted ("task-1234" is no key)
  const fine = { ...plan, context: null, steps: [{ ...plan.steps[0]!, goal: 'task-1234 und desk-' + 'x'.repeat(30) }] }
  nodeExpect(scrubPlanKeys(fine)).toEqual({ plan: fine, scrubbed: [] })
  nodeExpect(scrubPlanKeys(fine).plan).toBe(fine)
})

/* ------------------------------------------------------------------ a new task's checks (shared with the terminal) */

node.describe('checkTaskDraft — the terminal\'s checks, word for word, for a chain\'s steps too', () => {
  const projects: Record<string, string[]> = { coding: ['dbCode'], spec: [], qa: ['dbQa'] }
  const w = (over: Partial<DraftWorld> = {}): DraftWorld => ({
    readOnly: false,
    projects: (kind) => projects[kind] ?? [],
    title: (id) => ({ dbCode: 'Coding', dbQa: 'QA', dbLocked: 'Altprojekt' })[id] ?? 'Untitled',
    current: (kind) => projects[kind]?.[0] ?? null,
    pipeline: () => STANDARD,
    connected: true,
    announced: ['website', 'shop'],
    known: ['website', 'shop'],
    branches: (repo) => (repo === 'website' ? { base: 'main', list: ['one/login-fix', 'feature/x'] } : { base: null, list: [] }),
    lockedRepos: (id) => (id === 'dbLocked' ? ['website'] : null),
    ...over,
  })
  const msg = (input: Parameters<typeof checkTaskDraft>[0], world = w()) => checkTaskDraft(input, world).issues.map((i) => i.message)

  node('a good draft: its values, where it starts', () => {
    const r = checkTaskDraft({ title: '  Login   timeout ', goal: ' Fix it ', criteria: [' a ', '', 'b'], repo: 'website', branch: 'one/login-fix', start: false }, w())
    nodeExpect(r.issues).toEqual([])
    nodeExpect(r.draft).toMatchObject({ kind: 'coding', projectId: 'dbCode', title: 'Login timeout', goal: 'Fix it', criteria: ['a', 'b'], repo: 'website', branch: 'one/login-fix', priority: 'medium', then: [], start: false })
    nodeExpect(r.draft!.first?.id).toBe('backlog')
    nodeExpect(checkTaskDraft({ title: 'x', goal: '', repo: 'website', start: true }, w()).draft!.first?.id).toBe('ready')
    // BA / QA: no branch (null), no repo needed
    nodeExpect(checkTaskDraft({ kind: 'qa', title: 'x', goal: '', branch: 'feature/x' }, w()).draft).toMatchObject({ branch: null, repo: null, projectId: 'dbQa' })
    nodeExpect(checkTaskDraft({ kind: 'spec', title: 'x', goal: '' }, w()).draft).toMatchObject({ projectId: null })
  })

  node('every problem in the terminal\'s words and order — the first is what Claude gets', () => {
    nodeExpect(msg({ title: 'x', goal: '' }, w({ readOnly: true }))).toEqual(['This workspace is read-only for the person: pipeline tasks cannot be created or changed.'])
    nodeExpect(msg({ kind: 'deploy' as OrderKind, title: 'x', goal: '' })).toEqual(['"kind" must be coding, spec or qa.'])
    nodeExpect(msg({ title: 'x', goal: '', projectId: 'dbNope' })).toEqual(['No coding project with id "dbNope". Projects: "Coding" (id: dbCode).'])
    nodeExpect(msg({ kind: 'spec', title: 'x', goal: '', projectId: 'dbNope' })).toEqual(['No spec project with id "dbNope". There is none yet: omit project_id and one is created when the task is applied.'])
    nodeExpect(msg({ title: ' ', goal: '', repo: 'website' })).toEqual(['"title" must not be empty.'])
    nodeExpect(msg({ title: 'x'.repeat(201), goal: 'g'.repeat(8001), criteria: Array(31).fill('c'), repo: 'website' })).toEqual([
      '"title" is too long (201 characters, at most 200).',
      '"goal" is too long (8001 characters, at most 8000). Keep it to what Claude Code needs; link pages for the rest.',
      'Too many criteria (31, at most 30).',
    ])
    nodeExpect(msg({ title: 'x', goal: '', criteria: ['c'.repeat(501)], repo: 'website' })).toEqual(['A criterion is too long (501 characters, at most 500).'])
    nodeExpect(msg({ title: 'x', goal: '', repo: 'web site' })).toEqual(['"web site" is not a repo name (letters, digits, . _ -; as the worker announces it).'])
    nodeExpect(msg({ title: 'x', goal: '' })).toEqual(['A coding task needs "repo" (list_pipelines lists the repos: website, shop).'])
    nodeExpect(msg({ title: 'x', goal: '' }, w({ known: [] }))).toEqual(['A coding task needs "repo" (list_pipelines lists the repos).'])
    nodeExpect(msg({ title: 'x', goal: '', repo: 'intranet' })).toEqual(['The worker does not serve a repo "intranet". Repos: website, shop.'])
    // without a worker, any repo name goes (it is checked when the worker takes the task)
    nodeExpect(msg({ title: 'x', goal: '', repo: 'intranet' }, w({ connected: false, announced: [] }))).toEqual([])
    nodeExpect(msg({ title: 'x', goal: '', repo: 'shop', projectId: 'dbLocked' }, w({ projects: () => ['dbCode', 'dbLocked'] }))).toEqual(['The project "Altprojekt" is locked: only its existing repos can be used (website).'])
    nodeExpect(msg({ title: 'x', goal: '', repo: 'Website', projectId: 'dbLocked' }, w({ projects: () => ['dbCode', 'dbLocked'], announced: [], connected: false }))).toEqual([])
    nodeExpect(msg({ title: 'x', goal: '', repo: 'website', branch: 'bad branch!' })).toEqual(['"bad branch!" is not a branch name.'])
    nodeExpect(msg({ title: 'x', goal: '', repo: 'website', branch: 'main' })).toEqual(['"main" is the repo\'s base branch — the worker never works on it. Omit "branch": the worker makes its own.'])
    nodeExpect(msg({ title: 'x', goal: '', repo: 'website', branch: 'two/unknown' })).toEqual(['The worker has no branch "two/unknown" in website. Its branches: one/login-fix, feature/x. Omit "branch" and the worker makes its own.'])
    nodeExpect(msg({ title: 'x', goal: '', repo: 'website', priority: 'urgent' as 'high' })).toEqual(['"priority" must be high, medium or low.'])
    nodeExpect(msg({ title: 'x', goal: '', repo: 'website', then: ['qa'] })).toEqual(['"qa" cannot be used in "then" here — allowed: none (this pipeline hands on to nothing).'])
    nodeExpect(msg({ kind: 'spec', title: 'x', goal: '', then: ['coding', 'deploy' as OrderKind] })).toEqual(['"deploy" cannot be used in "then" here — allowed: coding, qa.'])
    nodeExpect(msg({ kind: 'spec', title: 'x', goal: '', then: 'qa' as unknown as OrderKind[] })).toEqual(['"then" must be a list of pipeline kinds.'])
    nodeExpect(checkTaskDraft({ kind: 'spec', title: 'x', goal: '', then: ['qa', 'coding', 'qa'] }, w()).draft!.then).toEqual(['qa', 'coding'])
    // the codes the plate words them by
    nodeExpect(checkTaskDraft({ title: '', goal: '', repo: 'website', branch: 'main' }, w()).issues.map((i) => [i.code, i.field])).toEqual([
      ['titleEmpty', 'title'],
      ['branchBase', 'branch'],
    ])
  })
})

/* ------------------------------------------------------------------ in the app */

const CODING_PORT = Number(process.env.CODING_E2E_PORT) || 47397

type Writes = { create: (title: string, kind?: string, repo?: string | null) => Promise<string>; parked: (ids: string[] | null) => void; chainProps: (projectId: string, ordersDb: string, row: string) => string }
type Seamed = { __oneCodingWrites: Writes }
/** A task (parked in its project's backlog) through the coding seam (?e2e). */
const createTask = (page: Page, title: string, kind: string, repo: string | null) => page.evaluate(([title, kind, repo]) => (window as unknown as Seamed).__oneCodingWrites.create(title, kind, repo), [title, kind, repo] as const)
/** The parked-start guard over these task ids (null: none). */
const parkedGuard = (page: Page, ids: string[] | null) => page.evaluate((ids) => (window as unknown as Seamed).__oneCodingWrites.parked(ids), ids)
const chainProps = (page: Page, project: string, orders: string, row: string) => page.evaluate(([project, orders, row]) => (window as unknown as Seamed).__oneCodingWrites.chainProps(project, orders, row), [project, orders, row] as const)

/** A work-orders database (its config is B4's — here only its system mark) and its id. */
const ordersDb = (page: Page) =>
  wsEval(page, (s) => {
    const id = s.createDatabase({ title: 'Prüfaufträge', parentId: null })
    s.updateDatabase(id, { system: 'workorders' })
    return id as string
  })

test('the chain roles on a project: added once (Prüfauftrag → the work orders, Schritt), not on the board cards, never part of a task\'s version; a locked project without them refuses', async ({ page }) => {
  await openApp(page)
  await page.evaluate(() => (window.location.hash = '#/coding'))
  const task = await createTask(page, 'Footer prüfen', 'coding', 'website')
  const db = await wsEval(page, (s, id) => s.pages[id].databaseId as string, task)
  const orders = await ordersDb(page)
  const version = () => page.evaluate((id) => (window as unknown as { __oneTrust: { version: (id: string) => Promise<string> } }).__oneTrust.version(id), task)
  const before = await version()
  const row = await wsEval(page, (s, db) => s.createRow(db, { title: 'Login-Timeout prüfen' }) as string, orders)

  expect(await chainProps(page, db, orders, row)).toBe('added')
  const props = () =>
    wsEval(page, (s, a) => {
      const d = s.databases[a.db]
      const relation = d.properties.filter((p: { type: string; relationDatabaseId?: string }) => p.type === 'relation' && p.relationDatabaseId === a.orders)
      const step = d.properties.filter((p: { type: string; name: string }) => p.type === 'number' && p.name === 'Step')
      const ids = [...relation, ...step].map((p: { id: string }) => p.id)
      return {
        relation: relation.map((p: { name: string }) => p.name),
        step: step.length,
        board: d.views.filter((v: { type: string }) => v.type === 'board').some((v: { visibleProperties: string[] }) => ids.some((id) => v.visibleProperties.includes(id))),
        table: d.views.filter((v: { type: string }) => v.type === 'table').every((v: { visibleProperties: string[] }) => ids.every((id) => v.visibleProperties.includes(id))),
      }
    }, { db, orders })
  expect(await props()).toEqual({ relation: ['Work order'], step: 1, board: false, table: true })
  // a second time: nothing new
  expect(await chainProps(page, db, orders, row)).toBe('ok')
  expect(await props()).toEqual({ relation: ['Work order'], step: 1, board: false, table: true })
  // display only: the task's version is the same
  expect(await version()).toBe(before)

  // a locked project without them: refused, nothing added; another database is no work-orders one: gone
  const qaTask = await createTask(page, 'Footer testen', 'qa', 'website')
  const qaDb = await wsEval(page, (s, id) => {
    const d = s.pages[id].databaseId as string
    s.updateDatabase(d, { locked: true })
    return d
  }, qaTask)
  expect(await chainProps(page, qaDb, orders, row)).toBe('locked')
  expect(await wsEval(page, (s, d) => s.databases[d].properties.some((p: { type: string }) => p.type === 'relation'), qaDb)).toBe(false)
  expect(await chainProps(page, db, qaDb, row)).toBe('gone')
})

/** Settings → Coding worker: the test port, switch on, connected. */
async function connect(page: Page) {
  await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings' }))
  await page.getByRole('tab', { name: /Coding worker|Coding-Worker/ }).click()
  const port = page.getByLabel('Port', { exact: true })
  await port.fill(String(CODING_PORT))
  await port.press('Enter')
  await page.getByRole('switch', { name: 'Connect to a coding worker on this computer' }).click()
  await expect(page.getByTestId('coding-conn')).toContainText('chain-box')
  await page.keyboard.press('Escape')
}

let fake: FakeWorker | null = null
test.afterEach(async () => {
  await fake?.close()
  fake = null
})

test('the parked-start guard in the worker\'s pick: a parked chain step is never handed out — not from an automatic stage, not with Run now; released, it is', async ({ page, errors }) => {
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  fake = await startFakeWorker(CODING_PORT, { worker: '1.11.0', name: 'chain-box', repos: [{ name: 'website', baseBranch: 'main' }], parallel: 1, busy: [], spentToday: 0, dayLimit: null, claude: { found: true, version: '2.0.0' }, setup: true, mcp: [] })
  fake.can = [...WORKER_CAN]
  await openApp(page)
  await connect(page)
  const id = await createTask(page, 'Login-Timeout beheben', 'coding', 'website')
  await parkedGuard(page, [id])
  const claimed = () =>
    wsEval(page, (s, id) => {
      const db = s.databases[s.pages[id].databaseId]
      const worker = db.properties.find((p: { name: string }) => p.name === 'Worker')
      const stage = db.properties.find((p: { name: string }) => p.name === 'Stage')
      return { worker: (s.pages[id].properties[worker.id] as string | undefined) ?? null, stage: stage.options.find((o: { id: string }) => o.id === s.pages[id].properties[stage.id])?.name }
    }, id)
  const rounds = async () => {
    const asked = fake!.asked.filter((a) => a.answer).length
    await expect.poll(() => fake!.asked.filter((a) => a.answer).length - asked, { timeout: 15_000 }).toBeGreaterThan(2)
  }
  // "Run now" on the parked step (its backlog would be hopped to the worker's first stage): not handed out
  await page.evaluate((id) => (window.location.hash = `#/p/${id}`), id)
  await page.getByTestId('coding-run').click()
  await rounds()
  expect(fake.handed()).toEqual([])
  expect(await claimed()).toEqual({ worker: null, stage: 'Backlog' })
  // moved by hand into the automatic queue: still not — nothing written for it, no claim, no queue hop
  await wsEval(page, (s, id) => {
    const db = s.databases[s.pages[id].databaseId]
    const stage = db.properties.find((p: { name: string }) => p.name === 'Stage')
    s.setRowProperty(id, stage.id, stage.options.find((o: { name: string }) => o.name === 'Ready').id)
  }, id)
  await rounds()
  expect(fake.handed()).toEqual([])
  expect(await claimed()).toEqual({ worker: null, stage: 'Ready' })
  // released (the chain started it): the worker gets it at its next ask
  await parkedGuard(page, null)
  await expect.poll(() => fake!.handed().map((t) => t.id), { timeout: 15_000 }).toEqual([id])
  expect((await claimed()).worker).toBe('chain-box')
})
