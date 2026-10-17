/**
 * Work orders — THE SEAM to the planner (spec §2.1). B4 STUB: B5 (built in parallel) owns this file — its plan.ts holds
 * the strict plan reader and this same `planOrder` export, lazily loading the runner (planner.ts); it replaces this file
 * as it is.
 *
 * The contract B4's entry points call (orders/press.ts is the only caller):
 *   planOrder(rowId, { mode, prov }) → Promise<{ kind: … }>
 *    - `mode` 'manual': pressed in this tab with the worker online · 'trigger': a kept press (want) fired after an 'ok'
 *      worker came back (§3.1, Regler mode 'trigger')
 *    - `prov`: the provenance captured synchronously at the press (press.ts pressProv — from the write before the
 *      attribution keeper could clear an agent's stamp)
 *    - B4 has checked §2.2 items 1–6 right before (orders/pre.ts), moved the Status to Planen (order writer `#s`) when it
 *      was not there, and spent the want when a kept press fires; the planner re-checks and drops the want on a draft
 *    - never throws to the caller; `{ kind: 'busy' }` = this request plans already ("plant schon")
 *
 * The stub sends nothing and writes nothing.
 */
import type { ID } from '../../../store/types'
import type { OrderProv } from './types'

export const planOrder = (_rowId: ID, _opts: { mode: 'manual' | 'trigger'; prov?: Record<ID, OrderProv>; replace?: boolean }): Promise<{ kind: string }> => Promise.resolve({ kind: 'stub' })
