/**
 * Preflight pre-work in the AI terminal and the One memory (design steps 26–27): the terminal's apply says what it did
 * and can stay quiet (no toast — Preflight's queue says it), a bulk apply leaves out what is applied alone at apply time,
 * a discard returns its cascade and its Undo brings back exactly that; the terminal's review list and TerminalChangeBody
 * show the same parts (data-part). An AI-menu memory run is saved and taken away by saveRunMemory; its Undo takes the
 * memory back and puts the run back. Fictional data; no Claude request is made.
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval, createPage, MOD } from './fixtures'
import { seedPipeline } from './helpers/preflightStory.mjs'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Run a function against a window seam: (seam, arg) → value. */
const seam = <R, A = null>(page: Page, name: string, fn: (s: AnyState, arg: A) => R | Promise<R>, arg?: A): Promise<R> =>
  page.evaluate(({ name, src, arg }) => new Function('s', 'arg', `return (${src})(s, arg)`)((window as unknown as Record<string, AnyState>)[name], arg), { name, src: fn.toString(), arg: (arg ?? null) as A }) as Promise<R>
const term = <R, A = null>(page: Page, fn: (s: AnyState, arg: A) => R | Promise<R>, arg?: A) => seam(page, '__oneTerm', fn, arg)

async function start(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
  await openApp(page)
}

/** Open the AI terminal (its code — and the memory's — loads with it). */
async function openTerminal(page: Page): Promise<void> {
  await page.keyboard.press(`${MOD}+j`)
  await page.waitForFunction(() => !!(window as AnyState).__oneTerm && !!(window as AnyState).__oneMemory)
}

/** Stage terminal changes (as the terminal's tools would). */
const stageChanges = (page: Page, changes: AnyState[]) => term(page, (s, changes) => s.state.setState({ changes }), changes)
const statuses = (page: Page) => term(page, (s) => Object.fromEntries(s.state.getState().changes.map((c: AnyState) => [c.id, c.status])))
const contentOf = (page: Page, id: string) => wsEval(page, (s, id) => JSON.stringify(s.pages[id]?.content ?? null), id)
const toasts = (page: Page) => page.locator('.toast')

test.describe('the AI terminal: applyStaged / discardStaged for Preflight (step 26)', () => {
  test('quiet: applies, raises no toast, says what it did; its Undo is quiet too', async ({ page }) => {
    await start(page)
    const p = await createPage(page, { title: 'Shift notes' })
    await openTerminal(page)
    await stageChanges(page, [
      { id: 'c1', n: 1, kind: 'append', status: 'pending', pageId: p, title: 'Shift notes', markdown: 'Line one from the terminal.' },
      { id: 'c2', n: 2, kind: 'append', status: 'pending', pageId: p, title: 'Shift notes', markdown: 'Line two.' },
    ])
    const out = await term(page, async (s) => {
      const r = await s.applyStaged(['c1'], { quiet: true })
      ;(window as AnyState).__res = r.res
      return { applied: r.res?.applied ?? null, busy: r.busy ?? false }
    })
    expect(out).toEqual({ applied: ['c1'], busy: false })
    expect(await statuses(page)).toEqual({ c1: 'applied', c2: 'pending' })
    expect(await contentOf(page, p)).toContain('Line one from the terminal.')
    await page.waitForTimeout(500)
    await expect(toasts(page)).toHaveCount(0)
    // Undo the batch, quietly: back to pending, the text gone
    expect(await term(page, (s) => s.undoStagedBatch((window as AnyState).__res, { quiet: true }))).toEqual({ kept: [], final: [] })
    expect(await statuses(page)).toEqual({ c1: 'pending', c2: 'pending' })
    expect(await contentOf(page, p)).not.toContain('Line one from the terminal.')
    await page.waitForTimeout(300)
    await expect(toasts(page)).toHaveCount(0)
    // not quiet: the terminal's own toast as before
    await term(page, (s) => s.applyStaged(['c2']))
    await expect(toasts(page).filter({ hasText: '1 change applied' })).toBeVisible()
  })

  test('busy while another apply runs; bulk leaves out what is applied alone, checked at apply time', async ({ page }) => {
    await start(page)
    const p = await createPage(page, { title: 'Reply drafts' })
    await openTerminal(page)
    await stageChanges(page, [
      { id: 'c1', n: 1, kind: 'append', status: 'pending', pageId: p, title: 'Reply drafts', markdown: 'Bulk line.' },
      { id: 'c2', n: 2, kind: 'send', status: 'pending', pageId: p, title: 'Reply', send: { slipId: 'out_fictional01' } },
    ])
    await term(page, (s) => s.state.setState({ applying: true }))
    expect(await term(page, async (s) => s.applyStaged(['c1'], { quiet: true }))).toEqual({ res: null, busy: true })
    await term(page, (s) => s.state.setState({ applying: false }))
    // a bulk apply over both: the send (applied alone, only the Outbox sends) stays pending
    const applied = await term(page, async (s) => (await s.applyStaged(['c1', 'c2'], { quiet: true, bulk: true })).res?.applied ?? null)
    expect(applied).toEqual(['c1'])
    expect(await statuses(page)).toEqual({ c1: 'applied', c2: 'pending' })
  })

  test('discard returns its cascade; Undo brings back exactly that set', async ({ page }) => {
    await start(page)
    const p = await createPage(page, { title: 'Weekly plan' })
    await openTerminal(page)
    await stageChanges(page, [
      { id: 'c1', n: 1, kind: 'create_page', status: 'pending', pageId: 'stg-1', parentId: null, title: 'Draft agenda', markdown: 'Agenda.' },
      { id: 'c2', n: 2, kind: 'append', status: 'failed', pageId: 'stg-1', title: 'Draft agenda', markdown: 'More.', dependsOn: 'c1', error: 'Not yet.' },
      { id: 'c3', n: 3, kind: 'append', status: 'pending', pageId: 'stg-1', title: 'Draft agenda', markdown: 'Even more.', needs: ['c2'] },
      { id: 'c4', n: 4, kind: 'append', status: 'discarded', pageId: 'stg-1', title: 'Draft agenda', markdown: 'Dropped before.', dependsOn: 'c1' },
      { id: 'c5', n: 5, kind: 'append', status: 'pending', pageId: p, title: 'Weekly plan', markdown: 'Unrelated.' },
    ])
    const dropped = await term(page, (s) => s.discardStaged('c1'))
    expect([...dropped].sort()).toEqual(['c1', 'c2', 'c3'])
    expect(await statuses(page)).toEqual({ c1: 'discarded', c2: 'discarded', c3: 'discarded', c4: 'discarded', c5: 'pending' })
    expect(await term(page, (s, ids) => s.undiscardStaged(ids), dropped)).toEqual(['c1', 'c2', 'c3'])
    // the one discarded before stays discarded
    expect(await statuses(page)).toEqual({ c1: 'pending', c2: 'pending', c3: 'pending', c4: 'discarded', c5: 'pending' })
    // discarding what is discarded already returns nothing
    expect(await term(page, (s) => s.discardStaged('c4'))).toEqual([])
  })

  test('the review list marks every part of a change (data-part) — the parts TerminalChangeBody renders', async ({ page }) => {
    await start(page)
    const p = await createPage(page, { title: 'Ops log' })
    await openTerminal(page)
    await stageChanges(page, [
      { id: 'c1', n: 1, kind: 'create_page', status: 'pending', pageId: 'stg-2', parentId: null, title: 'Night shift', markdown: 'First lines of the page.' },
      { id: 'c2', n: 2, kind: 'append', status: 'pending', pageId: 'stg-2', title: 'Night shift', markdown: 'Appended.', dependsOn: 'c1' },
      { id: 'c3', n: 3, kind: 'rename', status: 'failed', pageId: p, title: 'Ops log 2', beforeTitle: 'Ops log', error: 'The page changed.' },
    ])
    const parts = (id: string) => page.locator(`li.term-change >> nth=${id}`).locator('[data-part]').evaluateAll((els) => els.map((e) => e.getAttribute('data-part')))
    await expect(page.locator('li.term-change')).toHaveCount(3)
    expect(await parts('0')).toEqual(['title', 'where', 'preview'])
    expect(await parts('1')).toEqual(['title', 'preview', 'needs'])
    expect(await parts('2')).toEqual(['title', 'error'])
    // a part lays out as its children: the preview keeps its indent under the head
    const indent = await page.locator('li.term-change >> nth=0').locator('.agent-preview').evaluate((el) => getComputedStyle(el).marginLeft)
    expect(indent).toBe('26px')
  })
})

test.describe('the One memory: saveRunMemory for Preflight (step 27)', () => {
  /** An AI-menu memory run that finished with a proposal (as "Remember this" leaves it). */
  const seedRun = (page: Page, id: string, text: string) =>
    page.evaluate(
      ({ id, text }) => {
        const p = (window as AnyState).__onePreflight
        const now = Date.now()
        p.stores.aiRuns.setState((s: AnyState) => ({
          runs: {
            ...s.runs,
            [id]: { id, scope: 'local:local', pageId: 'none', req: { kind: 'memory', label: 'Remember', code: 'MEM', text, from: 'selection' }, status: 'done', output: '', sources: [], mcpCalls: [], error: null, issue: null, table: null, target: { from: 0, to: 0, lost: true }, startedAt: now - 60_000, finishedAt: now - 50_000, seen: true, proposals: [{ type: 'fact', text, topics: ['plant'], body: '', source: 'Shift notes' }] },
          },
        }))
      },
      { id, text },
    )
  const runIds = (page: Page) => page.evaluate(() => Object.keys((window as AnyState).__onePreflight.stores.aiRuns.getState().runs).sort())
  const memoryRows = (page: Page, text: string) => wsEval(page, (s, text) => (Object.values(s.pages) as AnyState[]).filter((p) => p.title === text && !p.trashed).length, text)

  test('saved quietly, the run taken away; Undo takes the memory back and puts the run back', async ({ page }) => {
    await start(page)
    await openTerminal(page)
    await page.keyboard.press('Escape')
    await seedRun(page, 'mr1', 'Line 2 runs the short cycle until the audit on 14.10.')
    const out = await seam(page, '__oneMemory', (m) => {
      const r = m.saveRunMemory('mr1', { toast: false })
      ;(window as AnyState).__memUndo = r?.undo
      return r ? r.how : null
    })
    expect(out).toBe('new')
    expect(await runIds(page)).toEqual([])
    expect(await memoryRows(page, 'Line 2 runs the short cycle until the audit on 14.10.')).toBe(1)
    await page.waitForTimeout(400)
    await expect(toasts(page)).toHaveCount(0)
    await page.evaluate(() => (window as AnyState).__memUndo())
    expect(await memoryRows(page, 'Line 2 runs the short cycle until the audit on 14.10.')).toBe(0)
    expect(await runIds(page)).toEqual(['mr1'])
    // a near-identical memory: saving updates it, "as new" makes a second one
    await seam(page, '__oneMemory', (m) => m.saveRunMemory('mr1', { toast: false }))
    await seedRun(page, 'mr2', 'Line 2 runs the short cycle until the audit on 14.10.')
    expect(await seam(page, '__oneMemory', (m) => m.saveRunMemory('mr2', { toast: false })?.how ?? null)).toBe('updated')
    await seedRun(page, 'mr3', 'Line 2 runs the short cycle until the audit on 14.10.')
    expect(await seam(page, '__oneMemory', (m) => m.saveRunMemory('mr3', { asNew: true, toast: false })?.how ?? null)).toBe('new')
    expect(await memoryRows(page, 'Line 2 runs the short cycle until the audit on 14.10.')).toBe(2)
    // no such run: nothing saved
    expect(await seam(page, '__oneMemory', (m) => m.saveRunMemory('gone', { toast: false }))).toBeNull()
  })
})

test.describe('coding: the version a card shows, confirmed exactly; did an action move the task (step 28)', () => {
  const coding = <R, A = null>(page: Page, fn: (s: AnyState, arg: A) => R | Promise<R>, arg?: A) => seam(page, '__oneCoding', fn, arg)

  test('taskVersionView shows what is hashed; confirmTaskVersion trusts only that version ("changed" after a linked page changed)', async ({ page }) => {
    await start(page)
    await page.waitForFunction(() => !!(window as AnyState).__oneCoding)
    const pipe = await seedPipeline(page)
    const ref = await createPage(page, { title: 'Spec sheet', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Tolerance 0.2 mm.' }] }] } })
    const [task, other] = pipe.tasks
    // an agent wrote the task (locally it waits for Confirm) and it links the spec sheet
    await wsEval(
      page,
      (s, a) => {
        s.setContent(a.task, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Keep the export filter. See #/p/${a.ref}` }] }] }, 'e2e')
        s.updatePage(a.task, { updatedBy: 'agent:ag-fictional' })
      },
      { task, ref },
    )
    const view = await coding(page, (c, id) => c.taskVersionView(id), task)
    expect(view.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(view.title).toBe('Exportfilter: Sonderzeichen')
    expect(view.markdown).toContain('Keep the export filter.')
    expect(view.fields).toMatchObject({ repo: null, branch: '' })
    expect(view.fields.stage).toBe(view.stages.find((x: AnyState) => x.kind === 'gate').name)
    expect(view.stages.length).toBeGreaterThan(3)
    expect(view.refs).toEqual([{ id: ref, title: 'Spec sheet', markdown: expect.stringContaining('Tolerance 0.2 mm.') }])
    expect(await coding(page, (c, id) => c.taskNeedsConfirm(id), task)).toBe(true)

    // the linked page changes after the card was rendered: the shown version is no longer the task's — nothing trusted
    await wsEval(page, (s, id) => s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Tolerance 0.5 mm.' }] }] }, 'e2e'), ref)
    expect(await coding(page, (c, a) => c.confirmTaskVersion(a.task, a.hash), { task, hash: view.hash })).toBe('changed')
    expect(await coding(page, (c, id) => c.taskNeedsConfirm(id), task)).toBe(true)
    // shown again: confirmed
    const again = await coding(page, (c, id) => c.taskVersionView(id), task)
    expect(again.hash).not.toBe(view.hash)
    expect(again.refs[0].markdown).toContain('Tolerance 0.5 mm.')
    expect(await coding(page, (c, a) => c.confirmTaskVersion(a.task, a.hash), { task, hash: again.hash })).toBe('ok')
    expect(await coding(page, (c, id) => c.taskNeedsConfirm(id), task)).toBe(false)
    // a task that is gone
    expect(await coding(page, (c) => c.confirmTaskVersion('no-such-task', 'f'.repeat(64)))).toBe('gone')
    await wsEval(page, (s, id) => s.trashPage(id), other)
    expect(await coding(page, (c, id) => c.confirmTaskVersion(id, 'f'.repeat(64)), other)).toBe('gone')
    expect(await coding(page, (c, id) => c.taskVersionView(id), other)).toBeNull()
  })

  test('actionTook: false before the action, true once it moved the task', async ({ page }) => {
    await start(page)
    await page.waitForFunction(() => !!(window as AnyState).__oneCoding)
    const pipe = await seedPipeline(page)
    const task = pipe.tasks[1]
    const out = await coding(
      page,
      async (c, id) => {
        const plan = await c.planTaskAction(id, 'approve')
        const before = c.actionTook(plan)
        // as Preflight's queue calls it (queue/calls.ts applyTask): the person's writer in Preflight
        await c.applyTaskAction(plan, { writer: { kind: 'you', via: 'preflight', ref: id } })
        return { before, after: c.actionTook(plan), stage: plan.stage, to: plan.to }
      },
      task,
    )
    expect(out).toMatchObject({ before: false, after: true })
    expect(out.to).not.toBe(out.stage)
  })
})

