/**
 * Work orders × the eject (Orders B13) — the chain's eject units, parsed (pure; orders/eject.ts acts on them): a run key
 * `order:<row>:<run>` and the change ids of its units — `c<n>` the creation of step n, `a<n>` its advance, `s` a Status
 * the chain wrote.
 */
import type { ID } from '../../../store/types'

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/** The order units of one run, as the chain reads them (null: not an order run key). */
export interface OrderUnits {
  row: ID
  run: string
  /** steps whose creation or advance went back (`c<n>` / `a<n>`) */
  steps: number[]
  /** a Status the chain wrote went back (`s`) */
  status: boolean
}

/** Parse an order run key and the change ids of its units (pure). */
export function orderUnitsOf(runKey: string, ids: readonly string[]): OrderUnits | null {
  const [kind, row, run, ...rest] = runKey.split(':')
  if (kind !== 'order' || rest.length || !row || !run || !ID_RE.test(row) || !ID_RE.test(run)) return null
  const steps = new Set<number>()
  let status = false
  for (const id of ids) {
    if (id === 's') status = true
    const m = /^[ca]([1-9]\d{0,2})$/.exec(id)
    if (m) steps.add(Number(m[1]))
  }
  return { row, run, steps: [...steps].sort((a, b) => a - b), status }
}

/** The ejected units grouped per order run (pure). */
export function orderUnitsByRun(units: readonly string[]): OrderUnits[] {
  const byRun = new Map<string, string[]>()
  for (const u of units) {
    const i = u.indexOf('#')
    if (i < 0 || !u.startsWith('order:')) continue
    const key = u.slice(0, i)
    ;(byRun.get(key) ?? byRun.set(key, []).get(key)!).push(u.slice(i + 1))
  }
  return [...byRun].flatMap(([key, ids]) => {
    const parsed = orderUnitsOf(key, ids)
    return parsed && (parsed.steps.length || parsed.status) ? [parsed] : []
  })
}
