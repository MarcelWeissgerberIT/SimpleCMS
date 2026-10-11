/**
 * Flight recorder — what the eject settles in other areas (R3, brief §5): the Outbox. An agent run on a fictional
 * mirror ("CNSX Handoff", the Outbox fixture of tests/e2e/helpers/outbox.ts) wrote two rows and left a pending `send`
 * proposal whose slip waits in the Outbox; another slip sits on a row that goes back. The dialog's facts count both;
 * the eject withdraws the proposal's slip (through the Outbox's own withdrawSlip, 'origin') and leaves the other one
 * alone; its Undo brings the proposal back to pending, never the slip. A row the person marked as sent (`you~outbox`)
 * is held: a send is never undone. Claude is never called; tracker.example.com is never reached.
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, flush, wsEval } from './fixtures'
import { rec, startRecorder } from './helpers/recorder'
import { outbox, outboxLoaded, routeRef, seedMirrorDb, type AnyState } from './helpers/outbox'

const T0 = Date.UTC(2026, 9, 9, 6, 0, 0)

async function step(page: Page, at: number, writer: Record<string, unknown>, calls: unknown[][], extra: Record<string, unknown> = {}) {
  await page.clock.setFixedTime(at)
  return rec<unknown[]>(page, 'step', { writer, calls, ...extra })
}

const slipState = (page: Page, id: string) => outbox(page, (o, a) => o.getSlips().find((s: AnyState) => s.id === a.id)?.state ?? null, { id })

test.describe('flight recorder — the eject and the Outbox (§5.3)', () => {
  test('a discarded send proposal\'s slip is withdrawn and stays withdrawn after the Undo; another slip on a reverted row is left alone; a row marked as sent is held', async ({ page }) => {
    test.setTimeout(180_000)
    await page.clock.install({ time: T0 })
    await openApp(page)
    await outboxLoaded(page)
    await startRecorder(page)
    const m = await seedMirrorDb(page)
    const a = m.rows['10642']
    const b = m.rows['10655']
    // two slips on rows the run will write: one its pending `send` proposal stands for, one of the person's own
    const own = await outbox(page, (o, x) => o.stageSlip({ route: x.route, rowId: x.row, params: { minutes: 30 }, origin: { kind: 'agent', ref: 'mirror1' }, sources: [] }), { route: routeRef('work'), row: a })
    const other = await outbox(page, (o, x) => o.stageSlip({ route: x.route, rowId: x.row, params: { minutes: 15 }, origin: { kind: 'api' }, sources: [] }), { route: routeRef('work'), row: b })
    const slip1 = (own as AnyState).slip.id as string
    const slip2 = (other as AnyState).slip.id as string
    expect(await slipState(page, slip1)).not.toBeNull()
    await flush(page)

    // the run: two rows written by the mirror agent, then its review as the runner keeps it
    const agent = (change: string) => ({ kind: 'agent', id: 'mirror1', run: 'r5', change })
    await step(page, T0 + 60_000, agent('c1'), [['setRowProperty', a, m.props.comments, 5]], { note: { seq: 5 } })
    await step(page, T0 + 70_000, agent('c2'), [['setRowProperty', b, m.props.comments, 3]], { end: true })
    await page.clock.setFixedTime(T0 + 120_000)
    await rec(page, 'settle')
    await page.evaluate(
      (x) =>
        (window as unknown as { __oneAgents: { putRun: (r: unknown) => Promise<unknown> } }).__oneAgents.putRun({
          id: 'r5',
          agentId: 'mirror1',
          runner: 'browser',
          seq: 5,
          trigger: { type: 'manual' },
          startedAt: x.t0 + 55_000,
          endedAt: x.t0 + 75_000,
          status: 'ok',
          summary: '',
          steps: [],
          applied: 2,
          staged: [
            { id: 'c1', n: 1, kind: 'update_row', status: 'applied', pageId: x.a, databaseId: x.db },
            { id: 'c2', n: 2, kind: 'update_row', status: 'applied', pageId: x.b, databaseId: x.db },
            { id: 'c3', n: 3, kind: 'send', status: 'pending', pageId: x.a, databaseId: x.db, send: { slipId: x.slip } },
          ],
        }),
      { t0: T0, a, b, db: m.dbId, slip: slip1 },
    )
    const sel = { lane: 'agent:mirror1', run: 'agent:mirror1:r5', a: T0 + 30_000, b: T0 + 90_000 }
    // the dialog's facts: one slip withdrawn with the open proposal, one other slip on a row that goes back
    const facts = await rec<{ pending: number; slips: { always: number; pending: number }; slipsChanged: number }>(page, 'ejectFacts', sel)
    expect(facts).toMatchObject({ pending: 1, slips: { always: 0, pending: 1 }, slipsChanged: 1 })

    const r = await rec<{ id: string; state: string; counts: { back: number } }>(page, 'eject', sel)
    expect(r).toMatchObject({ state: 'done', counts: { back: 2 } })
    expect(await wsEval(page, (s, x) => s.pages[x.a].properties[x.p], { a, p: m.props.comments })).toBe(4)
    expect(await slipState(page, slip1)).toBe('withdrawn')
    expect(await slipState(page, slip2)).not.toBe('withdrawn')
    const runOf = () => page.evaluate(async () => ((await (window as unknown as { __oneAgents: { loadRuns: (id: string) => Promise<Array<{ id: string; staged: AnyState[] }>> } }).__oneAgents.loadRuns('mirror1')) ?? []).find((x) => x.id === 'r5')!)
    expect((await runOf()).staged.find((c) => c.id === 'c3')).toMatchObject({ status: 'discarded' })

    // the Undo: the rows forward, the proposal pending again — its slip stays withdrawn
    expect(await rec(page, 'undoEject', r.id)).toMatchObject({ ok: true, back: 2 })
    expect(await wsEval(page, (s, x) => s.pages[x.a].properties[x.p], { a, p: m.props.comments })).toBe(5)
    expect((await runOf()).staged.find((c) => c.id === 'c3')).toMatchObject({ status: 'pending' })
    expect(await slipState(page, slip1)).toBe('withdrawn')
    expect(await slipState(page, slip2)).not.toBe('withdrawn')

    // a send is never undone: the person's row patch from "Mark as sent" (you~outbox:<slip>) is held on a lane-you eject
    await step(page, T0 + 200_000, { kind: 'you', via: 'outbox', ref: slip2 }, [['setRowProperty', b, m.props.waiting, false]])
    await step(page, T0 + 210_000, { kind: 'you', via: 'ui' }, [['updatePage', a, { title: 'Export filter drops umlauts (checked)' }]])
    await page.clock.setFixedTime(T0 + 300_000)
    await rec(page, 'settle')
    const plan = await rec<{ places: Array<{ p: string; outcome: string; reason: string | null }> }>(page, 'planEject', { lane: 'you', a: T0 + 190_000, b: T0 + 240_000 })
    expect(plan.places.find((x) => x.p === `p:${b}`)).toMatchObject({ outcome: 'held', reason: 'sent' })
    expect(plan.places.find((x) => x.p === `p:${a}`)).toMatchObject({ outcome: 'back' })
    expect(await rec(page, 'unknowns')).toEqual([])
  })
})
