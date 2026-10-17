/**
 * Work orders — the planner's e2e seam (DEV / `?e2e` only; coding/index.ts imports this module for its side effect):
 * `window.__oneOrders` = { plan(row, opts), answer(row, answers), record(row), run(row), stop(row) }. The planner itself
 * loads on the first call (lazy chunk); results are plain JSON (an AIError as { code, detail, fixes }).
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
    // what the brake note's E does on the plate (governor BrakeFor): an allowance for exactly this retry, then plan again
    retryWith: (rowId: ID, allowance: string) =>
      Promise.all([import('../../ai/core/gate'), import('./planner')]).then(([g, m]) => {
        g.armRetry('coding.plan', { allowance })
        return m.planOrder(rowId, { mode: 'manual' }).then(plain)
      }),
  }
}
