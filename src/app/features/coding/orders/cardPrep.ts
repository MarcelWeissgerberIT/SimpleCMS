/**
 * Work orders in Preflight — what a card shows, read when it becomes the current card (B9; its keys are inert until
 * then). A card that lets the chain start something shows what goes along BEFORE its ↵ (spec §2.10 "shown before it
 * starts"), and its ↵ passes exactly what it showed:
 *  - 'ready': the plan's hash as it resolves now (confirm.ts planHashNow — what ↵ Kette starten confirms); the stations
 *    themselves render live from this device's draft, and ↵ waits until every one was seen in full (seen.tsx — the
 *    plate's book: what was seen on the plate counts here, and the other way round);
 *  - 'next': the engine's card — the step as it will run (its version view: for a Confirm wait exactly the version ↵
 *    confirms), the Grundlage it takes, every page that changed, each with the fingerprint ↵ passes;
 *  - 'halted': the halt, what ↵ Fortsetzen starts (that step in full, its Grundlage), the spend against the budget, the
 *    step S may skip;
 *  - 'chainConfirm': every step the request's tasks hold, its version in full and where it stops under this device's
 *    Approvals — ↵ confirms exactly those versions (their hashes), all or nothing;
 *  - 'interrupted': which steps were made; 'request': the request's text as the planner would read it.
 * Never stored: per tab, per card id; a card whose subject moved on is prepared again ("read again").
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../../store/store'
import { t } from '../../../i18n'
import type { ID } from '../../../store/types'
import { canSkip, chainSpent, mayResume, type ChainMove, type ChainPassable } from '../chain'
import { codingProps, readPipeline } from '../schema'
import { defaultApprovals } from '../state'
import { taskVersionView, type TaskVersionView } from '../terminal'
import { basisText } from './basis'
import { basisPreview, chainWorld, useChainMoves } from './chainRun'
import { pageShown, requestNow, shownFp, textFp } from './fingerprint'
import { chainCarriers, heldIds, parseOrderCard, type ChainCarrier, type OrderCardKind } from './lamp'
import { orderPreNow } from './press'
import { loadOrderRecord, orderRecordNow } from './records'
import { stopsOf } from './stops'
import { keyOf, seenHas, seenWhole } from './seen'
import { preWhyText } from './text'
import { stepNo } from './words'
import type { OrderPreResult } from './pre'
import type { OrderChain, OrderChainStep, OrderRecord } from './types'

const ws = () => useWorkspace.getState()
const asRecord = (r: OrderRecord | null | 'unreadable' | undefined): OrderRecord | null => (r && r !== 'unreadable' ? r : null)

/** A step as a card shows it before it starts: its version view, its Grundlage. */
export interface StepShown {
  step: OrderChainStep
  view: TaskVersionView | null
  basis: JSONContent | null
  basisText: string
}

/** A page that changed since confirm, as the card rendered it (and the fingerprint its ↵ passes). */
export interface RefShown {
  id: ID
  title: string
  text: string
  fp: string
}

export type OrderPrep =
  | { kind: 'ready'; row: ID; hash: string | null; draftHash: string; run: string; server: boolean }
  | {
      kind: 'next'
      row: ID
      chain: OrderChain
      move: Extract<ChainMove, { kind: 'card' }>
      next: StepShown
      refs: RefShown[]
      basisFp?: string
      passes: ChainPassable[]
      confirm: boolean
    }
  | { kind: 'halted'; row: ID; chain: OrderChain; resumes: StepShown | null; resume: 'ok' | 'notHalted' | 'budget'; spent: number; skippable: number[] }
  | { kind: 'chainConfirm'; row: ID; steps: Array<{ carrier: ChainCarrier; view: TaskVersionView | null; stops: string[] }>; problem: 'numbers' | 'many' | null }
  | { kind: 'interrupted'; row: ID; chain: OrderChain; made: ID[]; pre: OrderPreResult }
  | { kind: 'request'; row: ID; text: string; pre: OrderPreResult }
  /** what the card was about is gone or moved on: prepared again, or it leaves */
  | { kind: 'stale'; row: ID; was: OrderCardKind }

const preps = new Map<string, OrderPrep>()

/** The prepared data of an orders card (null: not prepared yet). */
export const orderPrep = (id: string): OrderPrep | null => preps.get(id) ?? null
/** Forget a card's data (its key found the subject changed: the card prepares again). */
export const dropOrderPrep = (id: string): void => void preps.delete(id)

/** The step `n` of a chain as a card shows it before it starts. */
async function stepShown(chain: OrderChain, step: OrderChainStep): Promise<StepShown> {
  const view = await taskVersionView(step.id)
  const basis = basisPreview(chain, step.n)
  return { step, view, basis, basisText: basis ? basisText(basis) : '' }
}

/** The step ↵ Fortsetzen starts: the step the halt is about, else the first one the chain has not started. */
function resumesStep(chain: OrderChain): OrderChainStep | null {
  const sorted = [...chain.steps].sort((a, b) => a.n - b.n)
  const skipped = new Set(chain.skipped ?? [])
  if (chain.halted?.step !== undefined) {
    const s = sorted.find((x) => x.n === chain.halted!.step)
    if (s && !skipped.has(s.n)) return s
  }
  return sorted.find((s) => chain.advanced?.[s.n] === undefined && !skipped.has(s.n)) ?? null
}

/** Read what an orders card shows (see the head of this file). */
export async function prepareOrderCard(id: string): Promise<void> {
  const p = parseOrderCard(id)
  if (!p) return
  const { row, kind } = p
  const rec = asRecord(await loadOrderRecord(row, { fresh: true }))
  const stale = (): void => void preps.set(id, { kind: 'stale', row, was: kind })
  switch (kind) {
    case 'ready': {
      const draft = rec?.state === 'draft' ? rec.draft : undefined
      if (!draft?.plan.steps.length) return stale()
      const { planHashNow } = await import('./confirm')
      preps.set(id, { kind: 'ready', row, hash: await planHashNow(row, draft), draftHash: draft.hash, run: draft.run, server: !!draft.source.server })
      return
    }
    case 'next': {
      const move = useChainMoves.getState().moves[row]?.move
      const chain = rec?.state === 'running' ? rec.chain : undefined
      const step = move?.kind === 'card' ? chain?.steps.find((s) => s.n === move.step) : undefined
      if (!chain || !step || move?.kind !== 'card') return stale()
      const next = await stepShown(chain, step)
      const refs: RefShown[] = []
      for (const ref of move.refs ?? []) {
        const shown = pageShown(ws().pages[ref])
        refs.push({ id: ref, ...shown, fp: await shownFp(shown) })
      }
      const wantsBasis = move.all.includes('basis')
      preps.set(id, {
        kind: 'next',
        row,
        chain,
        move,
        next,
        refs,
        ...(wantsBasis ? { basisFp: await textFp(next.basisText) } : {}),
        passes: move.all.filter((w): w is ChainPassable => w !== 'confirm'),
        confirm: move.all.includes('confirm'),
      })
      return
    }
    case 'halted': {
      const chain = rec?.state === 'halted' ? rec.chain : undefined
      if (!rec || !chain?.halted) return stale()
      const world = await chainWorld(row, rec)
      const step = resumesStep(chain)
      preps.set(id, {
        kind: 'halted',
        row,
        chain,
        resumes: step ? await stepShown(chain, step) : null,
        resume: mayResume(world),
        spent: chainSpent(world),
        skippable: chain.steps.filter((s) => canSkip(world, s.n)).map((s) => s.n),
      })
      return
    }
    case 'chainConfirm': {
      const carriers = chainCarriers(row, heldIds(rec))
      if (!carriers.length) return stale()
      const approvals = defaultApprovals()
      const steps: Array<{ carrier: ChainCarrier; view: TaskVersionView | null; stops: string[] }> = []
      for (const c of carriers) {
        const page = ws().pages[c.id]
        const db = ws().databases[c.project]
        const props = db ? codingProps(db) : null
        const repo = page && props?.repo ? page.properties[props.repo] : null
        steps.push({ carrier: c, view: await taskVersionView(c.id), stops: db ? stopsOf(readPipeline(db), !!repo, approvals) : [] })
      }
      const ns = carriers.map((c) => c.n)
      const problem = carriers.length > 24 ? 'many' : ns.some((n) => n === null) || new Set(ns).size !== ns.length ? 'numbers' : null
      preps.set(id, { kind: 'chainConfirm', row, steps, problem })
      return
    }
    case 'interrupted': {
      const chain = rec?.state === 'interrupted' ? rec.chain : undefined
      if (!chain) return stale()
      preps.set(id, { kind: 'interrupted', row, chain, made: chain.steps.filter((s) => !!ws().pages[s.id]).map((s) => s.id), pre: orderPreNow(row) })
      return
    }
    case 'request': {
      preps.set(id, { kind: 'request', row, text: requestNow(row).text, pre: orderPreNow(row) })
      return
    }
  }
}

const O = 'features.coding.order'

/** A page's title as a reason names it (a private page: never its title). */
function titleOf(id: ID): string {
  const p = ws().pages[id]
  return !p ? t('common.untitled') : p.private ? t(`${O}.plan.privatePage`) : p.title.trim() || t('common.untitled')
}

/**
 * Why ↵ Kette starten on a 'ready' card cannot act now (null: it may) — the plate's own order: the card read again
 * first, the preconditions, a coding step without a repo, the server's context, every station seen in full, every page
 * that goes along opened (the plate's book: `<row>:<plan run>`), the hash read.
 */
export function readyBlock(id: string): { key: string; vars?: Record<string, string | number> } | null {
  const prep = preps.get(id)
  if (!prep) return { key: 'features.preflight.why.loading' }
  if (prep.kind !== 'ready') return { key: 'features.preflight.err.changed' }
  const rec = asRecord(orderRecordNow(prep.row))
  const draft = rec?.state === 'draft' ? rec.draft : undefined
  if (!draft || draft.hash !== prep.draftHash) return { key: 'features.preflight.err.changed' }
  const pre = orderPreNow(prep.row)
  if (!pre.ok) return { key: preWhyText(pre.why, pre.left) }
  const base = rec?.chain ? Math.max(...rec.chain.steps.map((s) => s.n)) : 0
  const scope = `${prep.row}:${draft.run}`
  const steps = draft.plan.steps
  const noRepo = steps.findIndex((st) => st.kind === 'coding' && !st.repo)
  if (noRepo >= 0) return { key: `${O}.plan.openRepo`, vars: { n: stepNo(base + noRepo + 1) } }
  if (draft.source.server && draft.plan.context && !seenWhole(scope, `ctx:${keyOf(JSON.stringify(draft.plan.context))}`)) return { key: `${O}.start.why.context` }
  const unseen = steps.flatMap((st, i) => (seenWhole(scope, keyOf(JSON.stringify(st))) ? [] : [stepNo(base + i + 1)]))
  if (unseen.length) return { key: `${O}.start.why.unseen`, vars: { list: unseen.join(', ') } }
  const unfolded = steps.flatMap((st, i) => st.refs.filter((r) => !seenHas(scope, `fold:${keyOf(JSON.stringify(st))}:${r}`)).map((r) => `${stepNo(base + i + 1)}: ${titleOf(r)}`))
  if (unfolded.length) return { key: `${O}.start.why.folds`, vars: { list: unfolded.join(' · ') } }
  if (!prep.hash) return { key: `${O}.key.readying` }
  return null
}
