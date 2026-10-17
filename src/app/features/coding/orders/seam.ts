/**
 * Work orders — the planner's e2e seam (DEV / `?e2e` only; coding/index.ts imports this module for its side effect):
 * `window.__oneOrders` = { plan(row, opts), answer(row, answers), record(row), run(row), stop(row) } and B6's confirming
 * (start, hashNow, undo, undoable, startNow, runChain, finishCreates, finishRest, discardMade, fault, world, parked, countFor). The planner
 * and confirm.ts load on the first call (lazy chunks); results are plain JSON (an AIError as { code, detail, fixes }).
 */
import type { ID } from '../../../store/types'

type AnyErr = { code?: unknown; detail?: unknown; fixes?: unknown }
const plain = (v: unknown): unknown => JSON.parse(JSON.stringify(v ?? null, (_k, x) => (x instanceof Error ? { code: (x as AnyErr).code ?? 'error', detail: (x as AnyErr).detail ?? null, fixes: (x as AnyErr).fixes ?? [] } : x))) as unknown

if (typeof window !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e'))) {
  ;(window as unknown as { __oneOrders?: unknown }).__oneOrders = {
    plan: (rowId: ID, o: { mode: 'manual' | 'trigger'; replace?: boolean }) => import('./planner').then((m) => m.planOrder(rowId, o)).then(plain),
    answer: (rowId: ID, answers: Array<{ q: string; a: string }>) => import('./planner').then((m) => m.answerQuestions(rowId, answers)).then(plain),
    record: (rowId: ID) => import('./records').then((m) => m.loadOrderRecord(rowId, { fresh: true })).then(plain),
    run: (rowId: ID) => import('./runs').then((m) => plain(m.plannerRun(rowId) ?? null)),
    stop: (rowId: ID) => import('./runs').then((m) => m.stopPlanning(rowId)),
    // B6 — confirming: ↵ Kette starten (the shown hash), Z, ↵ jetzt, a creation left half done, the e2e fault
    start: (rowId: ID, hash?: string) =>
      Promise.all([import('./confirm'), import('./records')]).then(async ([m, r]) => {
        const rec = await r.loadOrderRecord(rowId, { fresh: true })
        const draft = rec && rec !== 'unreadable' ? rec.draft : undefined
        const shown = hash ?? (draft ? await m.planHashNow(rowId, draft) : null) ?? ''
        return plain(await m.startChain(rowId, shown))
      }),
    hashNow: (rowId: ID) =>
      Promise.all([import('./confirm'), import('./records')]).then(async ([m, r]) => {
        const rec = await r.loadOrderRecord(rowId, { fresh: true })
        return rec && rec !== 'unreadable' && rec.draft ? m.planHashNow(rowId, rec.draft) : null
      }),
    undo: (rowId: ID) => import('./confirm').then((m) => m.undoChain(rowId)).then(plain),
    undoable: (rowId: ID) => import('./confirm').then((m) => m.undoable(rowId)),
    startNow: (rowId: ID) => import('./chainRun').then((m) => m.startNow(rowId)).then(plain),
    runChain: (rowId: ID) => import('./chainRun').then((m) => m.runChain(rowId)).then(plain),
    finishCreates: (rows: ID[]) => import('./confirm').then((m) => m.finishCreates(rows)),
    finishRest: (rowId: ID) => import('./confirm').then((m) => m.finishRest(rowId)).then(plain),
    discardMade: (rowId: ID) => import('./confirm').then((m) => m.discardMade(rowId)).then(plain),
    fault: (f: { at: number; mode: 'throw' | 'hold' } | null) => import('./confirm').then((m) => m.setCreateFault(f)),
    world: (rowId: ID) =>
      Promise.all([import('./chainRun'), import('./records'), import('../chain')]).then(async ([c, r, core]) => {
        const rec = await r.loadOrderRecord(rowId, { fresh: true })
        if (!rec || rec === 'unreadable') return null
        const world = await c.chainWorld(rowId, rec)
        return plain({ world, move: core.nextMove(world) })
      }),
    parked: (taskId: ID) => import('../tasks').then((m) => m.isParkedStep(taskId)),
    // the count before step 01 set to `ms` from now (screenshots of the Laufleiste while it counts)
    countFor: (rowId: ID, ms: number) =>
      Promise.all([import('./records'), import('./chainRun')]).then(async ([r, c]) => {
        const out = await r.patchOrderRecord(rowId, (rec) => (rec?.state === 'running' && rec.chain ? { ...rec, chain: { ...rec.chain, startAt: Date.now() + ms } } : rec))
        c.followRecord(rowId, out.rec)
        return out.ok
      }),
    // what the brake note's E does on the plate (governor BrakeFor): an allowance for exactly this retry, then plan again
    retryWith: (rowId: ID, allowance: string) =>
      Promise.all([import('../../ai/core/gate'), import('./planner')]).then(([g, m]) => {
        g.armRetry('coding.plan', { allowance })
        return m.planOrder(rowId, { mode: 'manual' }).then(plain)
      }),
  }
}
