/**
 * Work orders × the flight recorder's eject (spec §3.9, Orders B13). The chain's writes are eject units of the order
 * writer (`order:<row>:<run>` — store/writer.ts): `#c<n>` the creation of step n, `#a<n>` its advance (the Grundlage, a
 * QA step's branch and the Stage in ONE write), `#s` a Status the chain wrote. The setup writes of a press (projects,
 * the chain's properties, an older chain's parked steps to the trash — no change part) are no unit: their places go
 * back or stay by the eject's own rules, nothing to settle.
 *
 * What the eject does with them is the recorder's plan (model/hold.ts): a step it made goes to the trash while nobody
 * touched it since (a step the worker took carries the worker's writes — held, as every busy task); a step made before
 * the window keeps every field that moves it (`pipeline` — the eject never writes Stage, Repo, Branch …); the
 * request's Status goes back like any value. This module is the chain's side of the settle (eject/sources.ts):
 *  - `settleEjectedOrder(runKey, changeIds, ejectId)`: the steps whose `#c<n>` / `#a<n>` went back are marked in this
 *    device's record (`OrderChain.ejected`), and a running chain halts at once — 'ejected' about its first such step,
 *    or 'ejectedStatus' when only a Status the chain wrote went back (the Status → Angehalten `#s`, the notification).
 *    S decides (chainKeys.ts skipStep lifts a halt about that step); ↵ Fortsetzen halts again while a step is still
 *    ejected. Under the chain's Web Lock, so no pass of another tab moves meanwhile.
 *  - `unsettleEjectedOrder(…)`: the eject's Undo brought them back — the marks THAT eject set go; the halt stays (an
 *    eject and its Undo never advance a chain: ↵ Fortsetzen goes on).
 *  - `orderEjectBusy(runKeys)`: a chain of the window is being created right now (record 'creating') — the eject waits.
 *  - `orderEjectFacts(units)`: what the eject dialog says (steps that go, chains that halt).
 * The eject's own writes (and its Undo's) never run a chain pass (chainRun.ts onStore + recorder/settled.ts
 * isEjectWriter); no Claude request, no ledger entry.
 */
import { withEjected, withoutEjected } from '../chain'
import { haltNow, kick, withChainLock } from './chainRun'
import { loadOrderRecord, patchOrderRecord } from './records'
import type { OrderRecord } from './types'
import { orderUnitsByRun, orderUnitsOf } from './ejectUnits'

export { orderUnitsByRun, orderUnitsOf, type OrderUnits } from './ejectUnits'

const asRecord = (r: OrderRecord | null | 'unreadable' | undefined): OrderRecord | null => (r && r !== 'unreadable' ? r : null)

/** An eject took back units of an order run (see the head of this file). */
export async function settleEjectedOrder(runKey: string, ids: readonly string[], ejectId: string): Promise<void> {
  const u = orderUnitsOf(runKey, ids)
  if (!u || (!u.steps.length && !u.status)) return
  let halted = false
  await withChainLock(u.row, async () => {
    if (u.steps.length)
      await patchOrderRecord(u.row, (r) => {
        if (!r?.chain || r.chain.run !== u.run) return r
        const chain = withEjected(r.chain, u.steps, ejectId)
        return chain === r.chain ? r : { ...r, chain }
      })
    const rec = asRecord(await loadOrderRecord(u.row, { fresh: true }))
    const chain = rec?.chain
    if (!rec || !chain || chain.run !== u.run || rec.state !== 'running' || chain.halted) return
    const skipped = new Set(chain.skipped ?? [])
    const step = u.steps.find((n) => !skipped.has(n) && chain.steps.some((s) => s.n === n))
    if (step === undefined && !u.status) return
    await haltNow(u.row, chain, step !== undefined ? { kind: 'halt', why: 'ejected', step } : { kind: 'halt', why: 'ejectedStatus' }, `eject:${ejectId}`)
    halted = true
  })
  // the plate and Preflight read the halt — only then: a pass after a halt only publishes it (an eject never runs a chain on)
  if (halted) kick(u.row, 0)
}

/** The eject's Undo brought units of an order run back: the marks that eject set go — the halt stays. */
export async function unsettleEjectedOrder(runKey: string, ids: readonly string[], ejectId: string): Promise<void> {
  const u = orderUnitsOf(runKey, ids)
  if (!u || !u.steps.length) return
  await withChainLock(u.row, () =>
    patchOrderRecord(u.row, (r) => {
      if (!r?.chain || r.chain.run !== u.run) return r
      const chain = withoutEjected(r.chain, u.steps, ejectId)
      return chain === r.chain ? r : { ...r, chain }
    }),
  )
}

/** Is a chain of these order runs being created right now (its steps still coming)? The eject waits then. */
export async function orderEjectBusy(runKeys: readonly string[]): Promise<boolean> {
  for (const key of runKeys) {
    const u = orderUnitsOf(key, [])
    if (!u) continue
    const rec = asRecord(await loadOrderRecord(u.row, { fresh: true }))
    if (rec?.state === 'creating' && rec.chain?.run === u.run) return true
  }
  return false
}

/** What the eject dialog says about work orders: steps of a live chain that go, chains that halt by it. */
export async function orderEjectFacts(units: readonly string[]): Promise<{ steps: number; chains: number }> {
  let steps = 0
  let chains = 0
  for (const u of orderUnitsByRun(units)) {
    const rec = asRecord(await loadOrderRecord(u.row, { fresh: true }))
    const chain = rec?.chain
    if (!rec || !chain || chain.run !== u.run || (rec.state !== 'running' && rec.state !== 'halted' && rec.state !== 'interrupted')) continue
    const mine = u.steps.filter((n) => chain.steps.some((s) => s.n === n) && chain.ejected?.[n] === undefined)
    steps += mine.length
    if (rec.state === 'running' && !chain.halted && (mine.length || u.status)) chains++
  }
  return { steps, chains }
}
