/**
 * Flight recorder — what the eject settles in other areas (R3, brief §5): the Outbox. An agent run on a fictional
 * mirror (the Outbox fixture of tests/e2e/helpers/outbox.ts) wrote two rows and left a pending `send`
 * proposal whose slip waits in the Outbox; another slip sits on a row that goes back. The dialog's facts count both;
 * the eject withdraws the proposal's slip (through the Outbox's own withdrawSlip, 'origin') and leaves the other one
 * alone; its Undo brings the proposal back to pending, never the slip. A row the person marked as sent (`you~outbox`)
 * is held: a send is never undone. The real path: a custom agent's run (Claude mocked) applies five row updates, one
 * new row and a report append; the person edits one row afterwards; the eject takes back four rows whole, trashes the
 * new row, reverts the report block by block, holds the edited row — in ONE store update, with versions first — and
 * the run's review shows ejected / held; its Undo brings everything back in ONE update. Claude is never called for
 * real; tracker.example.com is never reached.
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, flush, wsEval } from './fixtures'
import { rec, startRecorder } from './helpers/recorder'
import { outbox, outboxLoaded, routeRef, seedMirrorDb, type AnyState } from './helpers/outbox'
import { sseMessage } from './helpers/terminal'

const T0 = Date.UTC(2026, 9, 9, 6, 0, 0)

async function step(page: Page, at: number, writer: Record<string, unknown>, calls: unknown[][], extra: Record<string, unknown> = {}) {
  await page.clock.setFixedTime(at)
  return rec<unknown[]>(page, 'step', { writer, calls, ...extra })
}

const slipState = (page: Page, id: string) => outbox(page, (o, a) => o.getSlips().find((s: AnyState) => s.id === a.id)?.state ?? null, { id })

test.describe('flight recorder — the eject and its sources (§5)', () => {
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

  test('the real path: a custom agent run (5 updates, 1 new row, 1 report append), the person edits a row, eject → 4 back, 1 held, new row trashed, report block by block, ONE update; RunHistory shows it; the Undo in ONE update', async ({ page, context }) => {
    test.setTimeout(180_000)
    await page.clock.install({ time: T0 })
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    let calls = 0
    let script: string[] = []
    await context.route('https://api.anthropic.com/**', async (route) => {
      const req = route.request()
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      if (req.method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [], has_more: false }) })
      const body = script[calls++] ?? sseMessage([{ type: 'text', text: 'Fertig.' }])
      await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body }).catch(() => undefined)
    })
    await openApp(page)
    await startRecorder(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    const f = await wsEval(page, (s) => {
      const db = s.createDatabase({ title: 'Tessera Aufgaben' }) as string
      const stage = s.addProperty(db, { type: 'select', name: 'Stufe', options: [{ id: 'o-offen', name: 'Offen', color: 'gray' }, { id: 'o-fertig', name: 'Fertig', color: 'green' }] }) as string
      const pts = s.addProperty(db, { type: 'number', name: 'Punkte' }) as string
      const rows = ['Tessera Karte', 'Tessera Abgleich', 'Tessera Abnahme', 'Tessera Export', 'Tessera Termine'].map((title) => s.createRow(db, { title, properties: { [stage]: 'o-offen', [pts]: 1 } }) as string)
      const report = s.createPage({ title: 'Tessera Bericht', content: { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'rb1' }, content: [{ type: 'text', text: 'Bericht' }] }] } }) as string
      const now = Date.now()
      s.upsertAgent({ id: 'ag-tessera-apply', name: 'Tessera Abschluss', instructions: 'Setze offene Aufgaben auf Fertig und berichte.', trigger: { type: 'manual' }, scope: { everything: false, pages: [report], databases: [db] }, write: 'apply', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: true, createdAt: now, updatedAt: now })
      return { db, stage, pts, rows, report }
    })
    await flush(page)
    script = [
      sseMessage([
        ...f.rows.map((id, i) => ({ type: 'tool_use' as const, id: `tu${i + 1}`, name: 'update_row', input: { id, properties: { Stufe: 'Fertig', Punkte: 5 } } })),
        { type: 'tool_use', id: 'tu6', name: 'create_row', input: { database_id: f.db, title: 'Tessera Nachlauf', properties: { Stufe: 'Offen' } } },
        { type: 'tool_use', id: 'tu7', name: 'append_to_page', input: { id: f.report, markdown: 'Fünf Aufgaben abgeschlossen. Mara Lind prüft den Nachlauf.' } },
      ]),
      sseMessage([{ type: 'text', text: 'Fünf Aufgaben auf Fertig, ein Nachlauf angelegt, Bericht ergänzt.' }]),
    ]
    await page.clock.setFixedTime(T0 + 60_000)
    await page.evaluate(() => (window.location.hash = '#/agents/ag-tessera-apply'))
    await page.getByRole('button', { name: 'Run now' }).click()
    await expect(page.locator('.agx-run').first()).toHaveAttribute('data-status', 'ok', { timeout: 30_000 })
    const value = (row: string, prop: string) => wsEval(page, (s, a) => s.pages[a.row].properties[a.prop], { row, prop })
    for (const row of f.rows) expect(await value(row, f.stage)).toBe('o-fertig')
    const newRow = await wsEval(page, (s) => (Object.values(s.pages) as AnyState[]).find((p) => p.title === 'Tessera Nachlauf')?.id as string)
    expect(newRow).toBeTruthy()
    expect(await wsEval(page, (s, id) => s.pages[id].content.content.length, f.report)).toBeGreaterThan(1)
    // the person edits the third row afterwards
    await step(page, T0 + 300_000, { kind: 'you', via: 'ui' }, [['setRowProperty', f.rows[2], f.pts, 9]])
    await page.clock.setFixedTime(T0 + 400_000)
    await rec(page, 'settle')
    const run = (await rec<Array<{ key: string; from: number; to: number }>>(page, 'runs')).find((r) => r.key.startsWith('agent:ag-tessera-apply:'))!
    expect(run).toBeTruthy()
    const sel = { lane: 'agent:ag-tessera-apply', run: run.key, a: run.from - 1000, b: run.to + 1000 }

    await rec(page, 'spy', true)
    const r = await rec<{ id: string; state: string; counts: { back: number; held: number } }>(page, 'eject', sel)
    const updates = await rec<Array<{ w: string | null; kind: string | null }>>(page, 'spy', false)
    expect(r).toMatchObject({ state: 'done', counts: { back: 6, held: 1 } })
    expect(updates.filter((u) => u.kind === 'eject')).toHaveLength(1)
    for (const i of [0, 1, 3, 4]) {
      expect(await value(f.rows[i], f.stage), `row ${i}`).toBe('o-offen')
      expect(await value(f.rows[i], f.pts), `row ${i}`).toBe(1)
    }
    // held whole: the agent's Stufe stays with the person's Punkte
    expect(await value(f.rows[2], f.stage)).toBe('o-fertig')
    expect(await value(f.rows[2], f.pts)).toBe(9)
    expect(await wsEval(page, (s, id) => !!s.pages[id]?.trashed, newRow)).toBe(true)
    expect(await wsEval(page, (s, id) => s.pages[id].content.content.map((b: AnyState) => b.attrs?.id ?? null), f.report)).toEqual(['rb1'])
    // a version "Vor dem Auswurf" of every page it wrote
    const versions = (id: string) => page.evaluate(async (id) => {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const q = indexedDB.open('one-history')
        q.onsuccess = () => res(q.result)
        q.onerror = () => rej(q.error)
      })
      const idx = await new Promise<Array<{ reason?: string }> | undefined>((res) => {
        const t = db.transaction('snapshots').objectStore('snapshots').get(`idx:${id}`)
        t.onsuccess = () => res(t.result as never)
        t.onerror = () => res(undefined)
      })
      db.close()
      return (idx ?? []).filter((m) => m.reason === 'eject').length
    }, id)
    for (const id of [f.rows[0], f.rows[1], f.rows[3], f.rows[4], f.report]) expect(await versions(id), id).toBe(1)
    // the run's review: 6 ejected, the third row's update held (still applied)
    const runOf = () => page.evaluate(async () => ((await (window as unknown as { __oneAgents: { loadRuns: (id: string) => Promise<Array<{ staged: AnyState[] }>> } }).__oneAgents.loadRuns('ag-tessera-apply')) ?? [])[0])
    const staged = (await runOf()).staged
    expect(staged.filter((c) => c.status === 'discarded' && c.ejected).length).toBe(6)
    expect(staged.filter((c) => c.status === 'applied' && c.held).map((c) => c.pageId)).toEqual([f.rows[2]])
    const head = page.locator('.agx-run__head').first()
    await expect(async () => {
      if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click()
      await expect(head).toHaveAttribute('aria-expanded', 'true', { timeout: 1000 })
    }).toPass({ timeout: 10_000 })
    await expect(page.getByTestId('agx-ejected')).toHaveCount(6)
    await expect(page.getByTestId('agx-held')).toHaveCount(1)

    // the Undo: ONE update, everything as the run left it, the statuses back
    await rec(page, 'spy', true)
    expect(await rec(page, 'undoEject', r.id)).toMatchObject({ ok: true, back: 6, kept: 0 })
    const undo = await rec<Array<{ w: string | null }>>(page, 'spy', false)
    expect(undo.filter((u) => u.w === `you~undo:${r.id}`)).toHaveLength(1)
    for (const i of [0, 1, 3, 4]) expect(await value(f.rows[i], f.stage)).toBe('o-fertig')
    expect(await wsEval(page, (s, id) => !!s.pages[id]?.trashed, newRow)).toBe(false)
    expect(await wsEval(page, (s, id) => s.pages[id].content.content.length, f.report)).toBeGreaterThan(1)
    const back = (await runOf()).staged
    expect(back.filter((c) => c.status === 'applied').length).toBe(7)
    expect(back.some((c) => c.ejected || c.held)).toBe(false)
    expect(await rec(page, 'unknowns')).toEqual([])
  })
})
