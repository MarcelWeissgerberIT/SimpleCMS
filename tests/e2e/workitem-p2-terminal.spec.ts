/**
 * Task block P2 — the AI terminal writes tasks: staging through the settle gate (ids minted at staging, reused 1:1 at
 * apply, never re-minted), handles and cross-change needs, list_work_items / update_work_item, edit_page refs for
 * tasks at any depth, the review facts (ItemFacts), Undo. Claude is mocked (helpers/terminal.ts) — nothing reaches
 * api.anthropic.com. Test data is fictional.
 */
import type { Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, wsEval, createPage, gotoPage, editorOf, flush, pageIdByTitle } from './fixtures'
import { call, mockAgent, openTerminal, prompt, resultText, run, say, setKey, terminal, type AnyState } from './helpers/terminal'
import { expectLane, markRec, startRecorder } from './helpers/recorder'
import { ledger } from './helpers/aiFlows'

const p = (text: string): JSONContent => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' })
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })
const item = (attrs: Record<string, unknown>, title: string, ...notes: JSONContent[]): JSONContent => ({ type: 'workItem', attrs, content: [p(title), ...notes] })

/** Every task of a doc (document order, at any depth): its attrs + title. */
function tasksIn(d: JSONContent | null | undefined): Array<Record<string, any> & { title: string }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: Array<Record<string, any> & { title: string }> = [] // eslint-disable-line @typescript-eslint/no-explicit-any
  const text = (n: JSONContent): string => n.text ?? (n.content ?? []).map(text).join('')
  const walk = (n: JSONContent) => {
    if (n.type === 'workItem') out.push({ ...(n.attrs ?? {}), title: text(n.content?.[0] ?? {}) })
    for (const c of n.content ?? []) walk(c)
  }
  if (d) walk(d)
  return out
}

const pageContent = (page: Page, id: string) => wsEval(page, (s, id) => s.pages[id]?.content ?? null, id)
const people = (page: Page) => wsEval(page, (s) => Object.fromEntries((s.people as Array<{ id: string; name: string }>).map((x) => [x.name, x.id])))
const peopleCount = (page: Page) => wsEval(page, (s) => s.people.length as number)
const changes = (page: Page) => page.evaluate(() => ((window as unknown as { __oneTerm: { state: { getState(): { changes: AnyState[] } } } }).__oneTerm.state.getState().changes))
const change = (page: Page, n: number) => terminal(page).locator('.term-change').nth(n - 1)
type TermSeam = { applyStaged(ids?: string[], opts?: { quiet?: boolean }): Promise<{ res: AnyState | null }> }
/** Apply staged changes through the terminal's apply step (quiet: no toasts) — what the review's keys do. */
const applyAlone = (page: Page, ...ids: string[]) =>
  page.evaluate(async (ids) => {
    const out = await (window as unknown as { __oneTerm: TermSeam }).__oneTerm.applyStaged(ids, { quiet: true })
    return { applied: (out.res?.applied ?? []) as string[], failed: (out.res?.failed ?? []) as Array<{ id: string; error: string }> }
  }, ids)
const day = (offset: number) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const done = (page: Page) => expect(terminal(page).locator('.term-turn').last()).toHaveAttribute('data-status', /done|limit/, { timeout: 30_000 })

async function setup(page: Page, content: JSONContent = doc(p('Kick-off for the Nordlicht launch.'))) {
  await openApp(page)
  await setKey(page)
  const id = await createPage(page, { title: 'Nordlicht plan', content })
  await gotoPage(page, id)
  await expect(editorOf(page, id)).toContainText(/./)
  return id
}

test.describe('1440 light', () => {
  test('append with two tasks: ids in the tool result, facts in the review, apply writes exactly the staged ids; Undo; an "ai" version', async ({ page, context }) => {
    const id = await setup(page)
    const ppl = await people(page)
    const before = await peopleCount(page)
    const due = day(3)
    const md = `> [!TODO] Draft copy {#copy}\n> Owner: Alex · Due: ${due}\n\n> [!TODO] Ship pricing\n> Blocked by: #copy`
    const m = await mockAgent(context, [call('t1', 'append_to_page', { id, markdown: md }), say('Staged two tasks.')])
    await openTerminal(page)
    await run(page, 'Plan the copy work')
    await done(page)
    const res = resultText(m.bodies[1], 't1')
    const ids = [...res.matchAll(/→ (wi_[A-Za-z0-9_-]{10})/g)].map((x) => x[1])
    expect(ids).toHaveLength(2)
    expect(res).toContain(`"Draft copy" → ${ids[0]} (#copy)`)
    // the review: TASK · NEW rows with the owner, the due date and the link to the new task
    const card = change(page, 1)
    await expect(card.getByTestId('item-facts')).toBeVisible()
    await expect(card.locator('.item-facts__row')).toHaveCount(2)
    await expect(card.locator('.item-facts__row').first()).toContainText('Draft copy')
    await expect(card.locator('.item-facts__row').first().locator('[data-chip="person"]')).toContainText('Alex')
    await expect(card.locator('.item-facts__row').nth(1).locator('[data-chip="blocked"]')).toContainText('Draft copy · new')
    // the staged change stores the ids and the holds (assigns a person)
    const staged = (await changes(page))[0]
    expect(staged.items.ids).toEqual(ids)
    expect(staged.items.holds).toEqual(['names'])
    await card.getByRole('button', { name: /^Apply #1/ }).click()
    await expect(card).toHaveAttribute('data-status', 'applied')
    await flush(page)
    const tasks = tasksIn(await pageContent(page, id))
    expect(tasks.map((t) => t.itemId)).toEqual(ids)
    expect(tasks[0]).toMatchObject({ title: 'Draft copy', people: [ppl.Alex], due })
    expect(tasks[1]).toMatchObject({ title: 'Ship pricing', blockedBy: [ids[0]] })
    expect(await peopleCount(page)).toBe(before)
    expect(await wsEval(page, (s, id) => s.pages[id].contentOrigin, id)).toBe('ai')
    // Undo (the review list's u): the page as it was
    await prompt(page).click()
    await prompt(page).press('Tab')
    await page.keyboard.press('u')
    await expect(card).toHaveAttribute('data-status', 'pending')
    expect(tasksIn(await pageContent(page, id))).toEqual([])
  })

  test('an unknown owner is refused with the names (never an email); the retry stages; nobody is created', async ({ page, context }) => {
    const id = await setup(page)
    const before = await peopleCount(page)
    await wsEval(page, (s) => s.addPerson('Ola Example <ola@example.test>'))
    const m = await mockAgent(context, [
      call('t1', 'append_to_page', { id, markdown: '> [!TODO] Book the venue\n> Owner: Bob' }),
      call('t2', 'append_to_page', { id, markdown: '> [!TODO] Book the venue\n> Owner: Alex' }),
      say('Done.'),
    ])
    await openTerminal(page)
    await run(page, 'Book the venue')
    await done(page)
    const refusal = resultText(m.bodies[1], 't1')
    expect(refusal).toContain('Unknown person "Bob"')
    expect(refusal).toContain('"Alex"')
    expect(refusal).toContain('"Mira"')
    expect(refusal).toContain('Nothing was staged.')
    expect(refusal).not.toContain('@example.test')
    expect(resultText(m.bodies[2], 't2')).toMatch(/New tasks: "Book the venue" → wi_/)
    expect((await changes(page)).length).toBe(1)
    expect(await peopleCount(page)).toBe(before + 1)
  })

  test('a handle from an earlier call is a need on its change; applying alone fails; discarding cascades; /new forgets handles', async ({ page, context }) => {
    const id = await setup(page)
    const m = await mockAgent(context, [
      call('t1', 'create_page', { title: 'Copy work', markdown: '> [!TODO] Draft copy {#copy}' }),
      say('Page staged.'),
      call('t2', 'append_to_page', { id, markdown: '> [!TODO] Review copy\n> Blocked by: #copy' }),
      say('Review staged.'),
      call('t3', 'append_to_page', { id, markdown: '> [!TODO] Late task\n> Blocked by: #copy' }),
      say('Tried.'),
    ])
    await openTerminal(page)
    await run(page, 'Stage the copy page')
    await done(page)
    await run(page, 'Add the review')
    await done(page)
    const all = await changes(page)
    expect(all).toHaveLength(2)
    expect(all[1].needs).toEqual([all[0].id])
    // the review says it needs #1 (its key is off); applied alone anyway (the apply step): "needs change #1 first"
    await expect(change(page, 2).locator('[data-part="needs"]')).toContainText('Needs #1 first')
    await expect(change(page, 2).getByRole('button', { name: /^Apply #2/ })).toBeDisabled()
    const alone = await applyAlone(page, all[1].id)
    expect(alone.failed).toEqual([{ id: all[1].id, error: 'needs change #1 first' }])
    expect(tasksIn(await pageContent(page, id))).toEqual([])
    // discarding #1 takes #2 along
    await change(page, 1).getByRole('button', { name: /^Discard #1/ }).click()
    await expect(change(page, 2)).toHaveAttribute('data-status', 'discarded')
    // a new conversation knows no handle
    await run(page, '/new')
    await run(page, 'Add the late task')
    await done(page)
    expect(resultText(m.bodies[5], 't3')).toContain('No task "#copy"')
  })

  test('list_work_items: filters, sorting, scope — context marks "none" hide a page\'s tasks, a blocker there is named by id only; "marked" lists only marked tasks', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const launch = await pageIdByTitle(page, 'Launch plan: new pricing page')
    const seeded = tasksIn(await pageContent(page, launch))
    const byTitle = (t: string) => seeded.find((x) => x.title === t)!.itemId as string
    const A = byTitle('Run the checkout with test cards')
    const B = byTitle('Approve the final pricing copy')
    const D = byTitle('Move the invoice template to the new plans')
    const X = 'wi_nordl1x2y3'
    const mine = await createPage(page, { title: 'Nordlicht plan', content: doc(item({ itemId: X, status: 'todo', blockedBy: [A] }, 'Nordlicht press kit')) })
    const m = await mockAgent(context, [
      call('l1', 'list_work_items', { person: 'Mira' }),
      call('l2', 'list_work_items', { blocked: true }),
      call('l3', 'list_work_items', { overdue: true }),
      call('l4', 'list_work_items', { query: 'pricing', page_id: launch }),
      say('Listed.'),
      call('l5', 'list_work_items', { status: 'any' }),
      say('Listed again.'),
      call('l6', 'list_work_items', { status: 'any' }),
      say('And again.'),
    ])
    await gotoPage(page, launch)
    await openTerminal(page)
    await run(page, 'What is open?')
    await done(page)
    const out = (id: string, i: number) => resultText(m.bodies[i], id)
    expect(out('l1', 1)).toMatch(/^2 open tasks \(person: Mira\)/)
    expect(out('l1', 1)).toContain(`${B} · "Approve the final pricing copy" · in progress`)
    expect(out('l2', 2)).toContain('Switch the pricing page live')
    expect(out('l2', 2)).toContain(`${X} · "Nordlicht press kit" · todo`)
    expect(out('l2', 2)).toContain(`BLOCKED by ${A} "Run the checkout with test cards" (open)`)
    expect(out('l3', 3)).toMatch(/^1 open task \(overdue: true\)/)
    expect(out('l3', 3)).toContain(D)
    expect(out('l4', 4)).toMatch(/^2 open tasks/)
    expect(out('l4', 4)).toContain(`#/p/${launch}?b=`)
    // context "nothing" on Launch plan: its tasks are gone from the list, the blocker of the press kit by id only
    await run(page, '/context')
    await expect(page.getByTestId('ctx-layer')).toBeVisible()
    await page.keyboard.press('n')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('ctx-layer')).toHaveCount(0)
    if (!(await terminal(page).isVisible())) await openTerminal(page)
    await prompt(page).click()
    await run(page, 'List everything')
    await done(page)
    const none = out('l5', 6)
    expect(none).toMatch(/^1 task/)
    expect(none).toContain(`BLOCKED by ${A} (outside your scope)`)
    expect(none).not.toContain('Run the checkout')
    expect(none).not.toContain('Launch plan')
    // "marked": only the marked block's task (the third top-level block is task A)
    await run(page, '/context')
    const rows = page.getByTestId('ctx-layer').getByRole('option')
    await expect(rows.first()).toBeVisible()
    await page.keyboard.press('n')
    await rows.nth(2).click()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('ctx-layer')).toHaveCount(0)
    if (!(await terminal(page).isVisible())) await openTerminal(page)
    await prompt(page).click()
    await run(page, 'List again')
    await done(page)
    const marked = out('l6', 8)
    expect(marked).toContain(A)
    expect(marked).not.toContain(B)
    expect(marked).toContain(`${X} · "Nordlicht press kit"`)
    void mine
  })

  test('update_work_item: before → after in the review; ONE write with origin "ai" as the terminal; Undo as you~undo; a field changed by hand since → skipped', async ({ page, context }) => {
    const T1 = 'wi_upd1aaaaaa'
    const T2 = 'wi_upd2bbbbbb'
    const id = await setup(page, doc(item({ itemId: T1, status: 'todo' }, 'Draft copy'), item({ itemId: T2, status: 'in_progress' }, 'Legal check')))
    await startRecorder(page)
    const ppl = await people(page)
    const m = await mockAgent(context, [
      call('u1', 'update_work_item', { updates: [{ item: T1, status: 'done', people: { add: ['Mira'] }, blocked_by: { add: [T2] } }] }),
      say('Staged.'),
      call('u2', 'update_work_item', { updates: [{ item: T2, due: day(4) }] }),
      say('Staged again.'),
    ])
    await openTerminal(page)
    await run(page, 'Close the copy task')
    await done(page)
    expect(resultText(m.bodies[1], 'u1')).toMatch(/Staged as change #1: wi_upd1aaaaaa "Draft copy" — status todo → done · owner nobody → Mira · blocked by nothing → wi_upd2bbbbbb "Legal check"/)
    const card = change(page, 1)
    await expect(card).toHaveAttribute('data-kind', 'workItem')
    await expect(card.locator('.item-facts__diff')).toContainText('Status')
    await expect(card.locator('.item-facts__diff')).toContainText('Done')
    await expect(card.locator('.item-facts__diff')).toContainText('Mira')
    await expect(card.getByTestId('item-facts-holds')).toContainText('Names a person')
    const mark = await markRec(page)
    await card.getByRole('button', { name: /^Apply #1/ }).click()
    await expect(card).toHaveAttribute('data-status', 'applied')
    await flush(page)
    const after = tasksIn(await pageContent(page, id))
    expect(after[0]).toMatchObject({ itemId: T1, status: 'done', people: [ppl.Mira], blockedBy: [T2] })
    expect(await wsEval(page, (s, id) => s.pages[id].contentOrigin, id)).toBe('ai')
    await expectLane(page, mark, /./, undefined, /^terminal:/)
    // Undo: the fields as they were, recorded as the person's Undo of that batch
    const undoMark = await markRec(page)
    await prompt(page).click()
    await prompt(page).press('Tab')
    await page.keyboard.press('u')
    await expect(card).toHaveAttribute('data-status', 'pending')
    await flush(page)
    expect(tasksIn(await pageContent(page, id))[0]).toMatchObject({ itemId: T1, status: 'todo', people: [], blockedBy: [] })
    await expectLane(page, undoMark, /./, undefined, /^you~undo:/)
    // a second change staged, then the field changed by hand: applying skips it, nothing is written
    await page.keyboard.press('Escape')
    await run(page, 'Set the due date')
    await done(page)
    await wsEval(
      page,
      (s, { id, T2 }) => {
        const c = JSON.parse(JSON.stringify(s.pages[id].content))
        for (const n of c.content) if (n.type === 'workItem' && n.attrs.itemId === T2) n.attrs.due = '2031-01-02'
        s.setContent(id, c, 'e2e')
      },
      { id, T2 },
    )
    const c2 = (await changes(page)).find((c) => c.n === 2)!
    const res = await applyAlone(page, c2.id)
    expect(res.failed).toEqual([{ id: c2.id, error: 'The task changed since — skipped.' }])
    expect(tasksIn(await pageContent(page, id))[1].due).toBe('2031-01-02')
  })

  test('update_work_item on a task staged in this conversation depends on its change: one batch applies both, alone it waits', async ({ page, context }) => {
    const id = await setup(page)
    await mockAgent(context, [
      call('a1', 'append_to_page', { id, markdown: '> [!TODO] Draft copy {#copy}' }),
      call('u1', 'update_work_item', { updates: [{ item: '#copy', status: 'in progress', people: { add: ['Sam'] } }] }),
      say('Staged.'),
    ])
    await openTerminal(page)
    await run(page, 'Plan and start the copy')
    await done(page)
    const [a, u] = await changes(page)
    expect(u.kind).toBe('workItem')
    expect(u.dependsOn).toBe(a.id)
    expect(u.workItem.before).toBeNull()
    expect(u.workItem.itemId).toBe(a.items.ids[0])
    const alone = await applyAlone(page, u.id)
    expect(alone.failed).toEqual([{ id: u.id, error: 'needs change #1 first' }])
    const both = await applyAlone(page, a.id, u.id)
    expect(both.applied.sort()).toEqual([a.id, u.id].sort())
    const ppl = await people(page)
    expect(tasksIn(await pageContent(page, id))[0]).toMatchObject({ itemId: a.items.ids[0], status: 'in_progress', people: [ppl.Sam] })
  })

  test('apply never re-mints: an id taken by now fails the change and what depends on it; the other page is untouched', async ({ page, context }) => {
    const id = await setup(page)
    await mockAgent(context, [
      call('a1', 'append_to_page', { id, markdown: '> [!TODO] Draft copy {#copy}' }),
      call('u1', 'update_work_item', { updates: [{ item: '#copy', status: 'done' }] }),
      say('Staged.'),
    ])
    await openTerminal(page)
    await run(page, 'Plan the copy')
    await done(page)
    const [a, u] = await changes(page)
    // applied, then the batch's Undo; then a task with the staged id appears on another page
    const first = await page.evaluate(async (ids) => {
      const term = (window as unknown as { __oneTerm: AnyState }).__oneTerm
      const out = await term.applyStaged(ids, { quiet: true })
      term.undoStagedBatch(out.res, { quiet: true })
      return out.res.applied.length as number
    }, [a.id, u.id])
    expect(first).toBe(2)
    await expect.poll(async () => (await changes(page)).map((c) => c.status)).toEqual(['pending', 'pending'])
    const other = await createPage(page, { title: 'Tessera notes', content: doc(item({ itemId: a.items.ids[0], status: 'todo' }, 'Pasted copy')) })
    const again = await applyAlone(page, a.id, u.id)
    expect(again.applied).toEqual([])
    expect(again.failed).toEqual([
      { id: a.id, error: 'A task id of this change is in use by now — ask Claude to stage it again.' },
      { id: u.id, error: 'needs change #1 first' },
    ])
    expect(tasksIn(await pageContent(page, other))).toMatchObject([{ itemId: a.items.ids[0], status: 'todo', title: 'Pasted copy' }])
    expect(tasksIn(await pageContent(page, id))).toEqual([])
  })

  test('edit_page: refs for tasks at any depth (not in a synced reference); a replace keeps the task by id or as the single task; removing one is a REMOVED fact; a changed field line changes nothing; no new task inside a task', async ({ page, context }) => {
    const ppl0 = await (async () => {
      await openApp(page)
      return people(page)
    })()
    const [K1, K2, K3, K4, K5, L1] = ['wi_edk1aaaaaa', 'wi_edk2bbbbbb', 'wi_edk3cccccc', 'wi_edk4dddddd', 'wi_edk5eeeeee', 'wi_edl1ffffff']
    const due = day(6)
    const content = doc(
      p('Intro'),
      { type: 'bulletList', content: [{ type: 'listItem', content: [p('Prep:'), item({ itemId: K1, people: [ppl0.Alex], due, blockedBy: [L1], related: [K2] }, 'Book the room')] }] },
      item({ itemId: K2 }, 'Order badges'),
      item({ itemId: K3 }, 'Old errand'),
      item({ itemId: K4, people: [ppl0.Mira] }, 'Print flyers'),
      item({ itemId: K5 }, 'Pack the booth', { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [p('Banner')] }] }),
      item({ itemId: L1 }, 'Sign the venue contract'),
      { type: 'syncedBlock', attrs: { syncId: 'sync-x', sourcePageId: 'page-elsewhere' }, content: [item({ itemId: 'wi_synced0001' }, 'Synced errand')] },
    )
    await setKey(page)
    const id = await createPage(page, { title: 'Nordlicht plan', content })
    await gotoPage(page, id)
    await expect(editorOf(page, id)).toContainText('Pack the booth')
    let read = ''
    const ref = (title: string) => {
      // inline (a list item, a nested task) or the block's own line above a top-level task
      const m = new RegExp(`⟦(b\\d+)⟧\\s+${title}`).exec(read) ?? new RegExp(`⟦(b\\d+)⟧\\n> \\[!TODO\\] ${title}`).exec(read)
      if (!m) throw new Error(`no ref for ${title} in\n${read}`)
      return m[1]
    }
    const m = await mockAgent(context, [
      call('r1', 'read_page', { id, refs: true }),
      (body) => {
        read = resultText(body, 'r1')
        return call('e1', 'edit_page', {
          id,
          edits: [
            { op: 'replace', from: ref('Book the room'), markdown: `> [!TODO] Book the big room {#${K1}}` },
            { op: 'replace', from: ref('Order badges'), markdown: '> [!TODO] Order badges, 40 pieces' },
            { op: 'replace', from: ref('Old errand'), markdown: 'Plain paragraph now.' },
            { op: 'replace', from: ref('Print flyers'), markdown: `> [!TODO] Print flyers {#${K4}}\n> Status: done · Owner: Sam` },
          ],
        })()
      },
      () => call('e2', 'edit_page', { id, edits: [{ op: 'insert_after', ref: ref('Banner'), markdown: '- > [!TODO] Sneaky task' }] })(),
      say('Staged.'),
    ])
    await openTerminal(page)
    await run(page, 'Tidy the plan')
    await done(page)
    // refs: a compact task in a list item and a task's to-do carry one; a task in a synced reference does not
    expect(read).toMatch(/⟦b\d+⟧ Book the room/)
    expect(read).toMatch(/⟦b\d+⟧ Banner/)
    expect(read).toContain('Synced errand')
    expect(read).not.toMatch(/⟦b\d+⟧ Synced errand/)
    const staged = resultText(m.bodies[2], 'e1')
    expect(staged).toContain('Fields of "Print flyers" did not change: use update_work_item.')
    expect(staged).toContain(`This removes 1 task: "Old errand" — keep its quote with {#${K3}} to keep it.`)
    const refused = resultText(m.bodies[3], 'e2')
    expect(refused).toContain("is inside a task (or a table): a task can't go there")
    const all = await changes(page)
    expect(all).toHaveLength(4)
    const removing = all.find((c) => c.items?.facts.some((f: AnyState) => f.tag === 'removed'))!
    expect(removing.items.holds).toContain('removes')
    await expect(terminal(page).locator('.item-facts__row[data-tag="removed"]')).toContainText('Old errand')
    // apply all four
    const res = await applyAlone(page, ...all.map((c) => c.id))
    expect(res.failed).toEqual([])
    const tasks = tasksIn(await pageContent(page, id))
    const by = (itemId: string) => tasks.find((t) => t.itemId === itemId)
    expect(by(K1)).toMatchObject({ title: 'Book the big room', people: [ppl0.Alex], due, blockedBy: [L1], related: [K2] })
    expect(by(K2)).toMatchObject({ title: 'Order badges, 40 pieces' })
    expect(by(K3)).toBeUndefined()
    expect(by(K4)).toMatchObject({ title: 'Print flyers', status: 'todo', people: [ppl0.Mira] })
    expect(tasks.filter((t) => t.title === 'Sneaky task')).toEqual([])
  })

  test('Blocks: onto an existing task is its own change that depends on the text change; both apply', async ({ page, context }) => {
    const LEGAL = 'wi_legal00001'
    const id = await setup(page, doc(item({ itemId: LEGAL, status: 'todo' }, 'Legal check')))
    const m = await mockAgent(context, [call('a1', 'append_to_page', { id, markdown: '> [!TODO] Draft copy {#copy}\n> Blocks: Legal check' }), say('Staged.')])
    await openTerminal(page)
    await run(page, 'Draft before legal')
    await done(page)
    expect(resultText(m.bodies[1], 'a1')).toMatch(/Also staged #2: "Legal check" now waits for "Draft copy" \(Blocks:\)\./)
    const [a, b] = await changes(page)
    expect(b).toMatchObject({ kind: 'workItem', dependsOn: a.id })
    expect(b.workItem.holds).toContain('blocker')
    await expect(change(page, 2).getByTestId('item-facts')).toContainText('Legal check')
    const res = await applyAlone(page, a.id, b.id)
    expect(res.failed).toEqual([])
    const tasks = tasksIn(await pageContent(page, id))
    expect(tasks.find((t) => t.itemId === LEGAL)!.blockedBy).toEqual([a.items.ids[0]])
  })

  test('mentions round trip: a person and a date mention with its reminder come back as mentions; a new date link gets no reminder', async ({ page, context }) => {
    await openApp(page)
    const ppl = await people(page)
    await setKey(page)
    const mention = (attrs: Record<string, unknown>) => ({ type: 'mention', attrs })
    const id = await createPage(page, {
      title: 'Nordlicht plan',
      content: doc({ type: 'paragraph', content: [{ type: 'text', text: 'Call ' }, mention({ id: ppl.Alex, label: 'Alex', kind: 'person' }), { type: 'text', text: ' on ' }, mention({ id: '2026-10-17', label: 'Fri 17 Oct', kind: 'date', reminder: '-1d' }), { type: 'text', text: '.' }] }),
    })
    await gotoPage(page, id)
    await expect(editorOf(page, id)).toContainText('Call')
    let read = ''
    const m = await mockAgent(context, [
      call('r1', 'read_page', { id, refs: true }),
      (body) => {
        read = resultText(body, 'r1')
        const ref = /⟦(b\d+)⟧/.exec(read)![1]
        const line = read.split('\n').find((l) => l.startsWith('Call '))!
        return call('e1', 'edit_page', { id, edits: [{ op: 'replace', from: ref, markdown: line.replace('Call ', 'Please call ') }] })()
      },
      call('a1', 'append_to_page', { id, markdown: 'Follow up on [@Fri 16 Oct](one:date/2026-10-16?r=at).' }),
      say('Done.'),
    ])
    await openTerminal(page)
    await run(page, 'Polish the line')
    await done(page)
    expect(read).toContain(`[@Alex](one:person/${ppl.Alex})`)
    expect(read).toContain('(one:date/2026-10-17?r=-1d)')
    expect(resultText(m.bodies[3], 'a1')).toContain("A date's reminder was left out")
    const all = await changes(page)
    const res = await applyAlone(page, ...all.map((c) => c.id))
    expect(res.failed).toEqual([])
    const content = await pageContent(page, id)
    const mentions: AnyState[] = []
    const walk = (n: AnyState) => {
      if (n.type === 'mention') mentions.push(n.attrs)
      for (const c of n.content ?? []) walk(c)
    }
    walk(content)
    expect(mentions).toEqual([
      expect.objectContaining({ id: ppl.Alex, kind: 'person' }),
      expect.objectContaining({ id: '2026-10-17', kind: 'date', reminder: '-1d' }),
      expect.objectContaining({ id: '2026-10-16', kind: 'date' }),
    ])
    expect(mentions[2].reminder ?? null).toBeNull()
  })
})

test.describe('review fixes', () => {
  test('an edit that links a task of a change that fails fails too ("needs change #1 first") — never a link onto another page\'s task', async ({ page, context }) => {
    const id = await setup(page)
    const other = await createPage(page, { title: 'Tessera plan', content: doc(p('Pricing notes')) })
    // the append goes to the other page; the edit to the open one (its blocks carry ids: refs)
    await mockAgent(context, [
      call('a1', 'append_to_page', { id: other, markdown: '> [!TODO] Draft copy {#copy}' }),
      call('r1', 'read_page', { id, refs: true }),
      (body) => {
        const ref = /⟦(b\d+)⟧/.exec(resultText(body, 'r1'))![1]
        return call('e1', 'edit_page', { id, edits: [{ op: 'insert_after', ref, markdown: '> [!TODO] Ship pricing\n> Blocked by: #copy' }] })()
      },
      say('Staged.'),
    ])
    await openTerminal(page)
    await run(page, 'Plan copy and pricing')
    await done(page)
    const [a, e] = await changes(page)
    expect(e.kind).toBe('edit')
    expect(e.needs).toEqual([a.id])
    // the staged id is taken by now (a paste of a copy on a third page): #1 fails, and so does the edit that needs it
    const third = await createPage(page, { title: 'Nordlicht archive', content: doc(item({ itemId: a.items.ids[0], status: 'todo' }, 'Pasted copy')) })
    const res = await applyAlone(page, a.id, e.id)
    expect(res.applied).toEqual([])
    expect(res.failed).toEqual([
      { id: a.id, error: 'A task id of this change is in use by now — ask Claude to stage it again.' },
      { id: e.id, error: 'needs change #1 first' },
    ])
    expect(tasksIn(await pageContent(page, id))).toEqual([])
    expect(tasksIn(await pageContent(page, other))).toEqual([])
    expect(tasksIn(await pageContent(page, third))).toMatchObject([{ itemId: a.items.ids[0], title: 'Pasted copy' }])
  })

  test('apply order follows what a change needs: a new page whose task waits for an append\'s task applies after it, in one batch', async ({ page, context }) => {
    const id = await setup(page)
    await mockAgent(context, [
      call('a1', 'append_to_page', { id, markdown: '> [!TODO] Call the vendor {#vendor}' }),
      call('c1', 'create_page', { title: 'Vendor contract', markdown: '> [!TODO] Sign the contract\n> Blocked by: #vendor' }),
      say('Staged.'),
    ])
    await openTerminal(page)
    await run(page, 'Plan the vendor work')
    await done(page)
    const [a, c] = await changes(page)
    expect(c.needs).toEqual([a.id])
    const res = await applyAlone(page, a.id, c.id)
    expect(res.failed).toEqual([])
    expect(res.applied).toEqual([a.id, c.id])
    expect(tasksIn(await pageContent(page, c.pageId))).toMatchObject([{ title: 'Sign the contract', blockedBy: [a.items.ids[0]] }])
  })

  test('a task change of a task whose new page fails says "needs change #1 first" (not "no longer here")', async ({ page, context }) => {
    await setup(page)
    await mockAgent(context, [
      call('c1', 'create_page', { title: 'Copy work', markdown: '> [!TODO] Draft copy {#copy}' }),
      call('u1', 'update_work_item', { updates: [{ item: '#copy', status: 'in progress' }] }),
      say('Staged.'),
    ])
    await openTerminal(page)
    await run(page, 'Plan the copy page')
    await done(page)
    const [c, u] = await changes(page)
    await createPage(page, { title: 'Tessera notes', content: doc(item({ itemId: c.items.ids[0], status: 'todo' }, 'Pasted copy')) })
    const res = await applyAlone(page, c.id, u.id)
    expect(res.failed).toEqual([
      { id: c.id, error: 'A task id of this change is in use by now — ask Claude to stage it again.' },
      { id: u.id, error: 'needs change #1 first' },
    ])
  })

  test('update_work_item takes every task id One mints — "_" and "-" included', async ({ page, context }) => {
    const [ODD, ODD2] = ['wi_ab_cd-EFGH', 'wi_x-y_z12345']
    const id = await setup(page, doc(item({ itemId: ODD, status: 'todo' }, 'Odd id task'), item({ itemId: ODD2, status: 'todo' }, 'Other odd task')))
    const m = await mockAgent(context, [call('u1', 'update_work_item', { updates: [{ item: ODD, status: 'done', blocked_by: { add: [ODD2] } }] }), say('Staged.')])
    await openTerminal(page)
    await run(page, 'Close the odd task')
    await done(page)
    expect(resultText(m.bodies[1], 'u1')).toContain(`Staged as change #1: ${ODD} "Odd id task"`)
    const [u] = await changes(page)
    expect(u.workItem).toMatchObject({ itemId: ODD, patch: { status: 'done', blockedBy: { add: [ODD2] } } })
    void id
  })

  test('a discarded change\'s handle is no link target: the text is refused, nothing is staged', async ({ page, context }) => {
    const id = await setup(page)
    const m = await mockAgent(context, [
      call('c1', 'create_page', { title: 'Copy work', markdown: '> [!TODO] Draft copy {#copy}' }),
      say('Staged.'),
      call('a1', 'append_to_page', { id, markdown: '> [!TODO] Review copy\n> Blocked by: #copy' }),
      say('Tried.'),
    ])
    await openTerminal(page)
    await run(page, 'Stage the copy page')
    await done(page)
    await change(page, 1).getByRole('button', { name: /^Discard #1/ }).click()
    await expect(change(page, 1)).toHaveAttribute('data-status', 'discarded')
    await run(page, 'Add the review')
    await done(page)
    const res = resultText(m.bodies[3], 'a1')
    expect(res).toContain('No task "#copy"')
    expect(res).toContain('Nothing was staged.')
    expect(await changes(page)).toHaveLength(1)
  })

  test('a page staged again with its tasks in another order keeps each id by handle / title; dropping one names the change that linked it', async ({ page, context }) => {
    const id = await setup(page)
    const m = await mockAgent(context, [
      call('p1', 'create_pages', { pages: [{ title: 'Copy work', markdown: '> [!TODO] Draft copy {#copy}\n\n> [!TODO] Ship pricing' }] }),
      call('a1', 'append_to_page', { id, markdown: '> [!TODO] Review\n> Blocked by: #copy' }),
      call('p2', 'create_pages', { pages: [{ title: 'Copy work', markdown: '> [!TODO] Ship pricing\n\n> [!TODO] Draft copy {#copy}' }] }),
      call('p3', 'create_pages', { pages: [{ title: 'Copy work', markdown: '> [!TODO] Ship pricing\n\n> [!TODO] Announce it' }] }),
      say('Staged.'),
    ])
    await openTerminal(page)
    await run(page, 'Plan the copy work')
    await done(page)
    // the ids the first text got (from its tool result: the change itself holds the newest text's by now)
    const firstRes = resultText(m.bodies[1], 'p1')
    const A = /"Draft copy" → (wi_[A-Za-z0-9_-]{10}) \(#copy\)/.exec(firstRes)![1]
    const B = /"Ship pricing" → (wi_[A-Za-z0-9_-]{10})/.exec(firstRes)![1]
    // the reordered text: Draft copy keeps A (its handle), Ship pricing keeps B (its title)
    const reordered = resultText(m.bodies[3], 'p2')
    expect(reordered).toContain(`"Ship pricing" → ${B}`)
    expect(reordered).toContain(`"Draft copy" → ${A} (#copy)`)
    // the copy task dropped: the review that links it is named; the new task gets a fresh id (never A)
    const dropped = resultText(m.bodies[4], 'p3')
    expect(dropped).toContain(`Change #2 points at ${A}, a task this text no longer makes`)
    const [c1, c2] = await changes(page)
    expect(c1.items.ids[0]).toBe(B)
    expect(c1.items.ids[1]).not.toBe(A)
    // applied together: the review's link to the task that is no more is left out (a note), never another task
    const res = await applyAlone(page, c1.id, c2.id)
    expect(res.failed).toEqual([])
    const review = tasksIn(await pageContent(page, id)).find((t) => t.title === 'Review')!
    expect(review.blockedBy).toEqual([])
  })

  test('a Blocks: link that would close a loop through a pending task change is left out at staging', async ({ page, context }) => {
    const [E1, E2] = ['wi_loopa00001', 'wi_loopb00002']
    const id = await setup(page, doc(item({ itemId: E1, status: 'todo' }, 'First'), item({ itemId: E2, status: 'todo' }, 'Second')))
    const m = await mockAgent(context, [
      call('u1', 'update_work_item', { updates: [{ item: E1, blocked_by: { add: [E2] } }] }),
      call('a1', 'append_to_page', { id, markdown: `> [!TODO] New one\n> Blocked by: ${E1} · Blocks: ${E2}` }),
      say('Staged.'),
    ])
    await openTerminal(page)
    await run(page, 'Chain the tasks')
    await done(page)
    expect(resultText(m.bodies[2], 'a1')).toContain('A link would make a loop')
    const all = await changes(page)
    expect(all).toHaveLength(2)
    const res = await applyAlone(page, ...all.map((c: AnyState) => c.id))
    expect(res.failed).toEqual([])
    const by = Object.fromEntries(tasksIn(await pageContent(page, id)).map((t) => [t.title, t.blockedBy]))
    expect(by.First).toEqual([E2])
    expect(by.Second).toEqual([])
  })
})

test.describe('390 dark', () => {
  test.use({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', hasTouch: true, isMobile: true })

  test('the review card with task facts wraps: no horizontal scroll, keys ≥ 32 px', async ({ page, context }) => {
    const id = await setup(page)
    const md = '> [!TODO] Draft the very long Nordlicht launch announcement for every regional newsletter {#copy}\n> Owner: Alex, Mira, Sam · Due: 2026-11-03T09:30 · Reminder: -1d\n\n> [!TODO] Ship pricing\n> Blocked by: #copy'
    await mockAgent(context, [call('t1', 'append_to_page', { id, markdown: md }), say('Staged.')])
    await openTerminal(page)
    await run(page, 'Plan the announcement')
    await done(page)
    const card = change(page, 1)
    await expect(card.getByTestId('item-facts')).toBeVisible()
    await expect(card.getByTestId('item-facts-holds')).toContainText('Sets a reminder')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    const facts = await card.getByTestId('item-facts').boundingBox()
    expect(facts!.x + facts!.width).toBeLessThanOrEqual(390)
    const key = await card.getByRole('button', { name: /^Apply #1/ }).boundingBox()
    expect(key!.height).toBeGreaterThanOrEqual(32)
  })
})

test.describe('the flight recorder (train 4)', () => {
  test('a task change applied alone is the recorder’s unit (terminal:<batch>#<change>): an eject takes it back like any change — ejected in the review, the batch’s Undo keeps it, the eject’s Undo brings it back', async ({ page, context, aiNet }) => {
    test.setTimeout(120_000)
    const T1 = 'wi_ejct1aaaaa'
    const id = await setup(page, doc(item({ itemId: T1, status: 'todo' }, 'Draft copy')))
    await startRecorder(page)
    await mockAgent(context, [call('u1', 'update_work_item', { updates: [{ item: T1, status: 'done' }] }), say('Staged.')])
    await openTerminal(page)
    await run(page, 'Close the copy task')
    await done(page)
    const card = change(page, 1)
    await expect(card).toHaveAttribute('data-kind', 'workItem')
    const chg = (await changes(page))[0].id as string
    const mark = await markRec(page)
    await card.getByRole('button', { name: /^Apply #1/ }).click()
    await expect(card).toHaveAttribute('data-status', 'applied')
    await flush(page)
    expect(tasksIn(await pageContent(page, id))[0]).toMatchObject({ itemId: T1, status: 'done' })
    // ONE write, named by its change: the unit an eject settles
    await expectLane(page, mark, 'terminal', undefined, new RegExp(`^terminal:[^#]+#${chg}$`))
    type Rec = Record<string, (...a: unknown[]) => Promise<any>> // eslint-disable-line @typescript-eslint/no-explicit-any
    const rec = <T>(fn: string, ...args: unknown[]): Promise<T> => page.evaluate(({ fn, args }) => (window as unknown as { __oneRecorder: Rec }).__oneRecorder[fn](...args), { fn, args })
    await rec('settle')
    const batch = (await rec<Array<{ key: string; from: number; to: number }>>('runs')).find((r) => r.key.startsWith('terminal:'))!
    expect(batch).toBeTruthy()
    // train 4 + AI S1: an eject and its Undo are no AI request — nothing goes out, no ledger entry, the meter stays
    const meter = async () => {
      await page.evaluate(() => (window as unknown as { __oneLedger: { flush(): Promise<void> } }).__oneLedger.flush())
      return {
        requests: aiNet.count('anthropic'),
        entries: (await ledger(page)).map((e) => e.id as string),
        usage: await page.evaluate(() => (window as unknown as { __oneTerm: { state: { getState(): { usage: unknown } } } }).__oneTerm.state.getState().usage),
      }
    }
    const before = await meter()
    expect(before.requests).toBeGreaterThan(0)
    expect(before.entries.length).toBeGreaterThan(0)
    expect((before.usage as { byModel?: unknown[] }).byModel?.length).toBeGreaterThan(0)
    const r = await rec<{ id: string; state: string }>('eject', { lane: 'terminal', run: batch.key, a: batch.from - 1000, b: batch.to + 1000 })
    expect(r.state).toBe('done')
    expect(tasksIn(await pageContent(page, id))[0]).toMatchObject({ itemId: T1, status: 'todo' })
    // settled like any change: discarded + ejected, never open again
    await expect.poll(async () => (await changes(page))[0]).toMatchObject({ status: 'discarded', ejected: { id: r.id } })
    await expect(card).toHaveAttribute('data-status', 'discarded')
    // right after the eject (not only after its Undo, which could put a changed meter back): nothing went out
    expect(await meter()).toEqual(before)
    // the batch's own Undo (a toast, Preflight's card) writes nothing: its task part is settled
    const rev = await wsEval(page, (s, id) => s.pages[id].contentRev, id)
    const undone = await page.evaluate((key) => {
      const t = (window as unknown as { __oneTerm: { batch(id: string): unknown; undoStagedBatch(res: unknown, o: { quiet: boolean }): unknown } }).__oneTerm
      return t.undoStagedBatch(t.batch(key.slice('terminal:'.length)), { quiet: true })
    }, batch.key)
    expect(undone).toEqual({ kept: [chg], final: [] })
    expect(await wsEval(page, (s, id) => s.pages[id].contentRev, id)).toBe(rev)
    // the eject's Undo: the task done again, the change applied again
    expect(await rec<{ ok?: boolean }>('undoEject', r.id)).toMatchObject({ ok: true })
    expect(tasksIn(await pageContent(page, id))[0]).toMatchObject({ itemId: T1, status: 'done' })
    await expect.poll(async () => (await changes(page))[0].status).toBe('applied')
    expect(await meter()).toEqual(before)
  })

  type Rec = Record<string, (...a: unknown[]) => Promise<any>> // eslint-disable-line @typescript-eslint/no-explicit-any
  const recOf = (page: Page) => <T>(fn: string, ...args: unknown[]): Promise<T> => page.evaluate(({ fn, args }) => (window as unknown as { __oneRecorder: Rec }).__oneRecorder[fn](...args), { fn, args })
  type Batch = { key: string; from: number; to: number }
  const batches = async (page: Page): Promise<Batch[]> => {
    await recOf(page)('settle')
    return (await recOf(page)<Batch[]>('runs')).filter((r) => r.key.startsWith('terminal:')).sort((a, b) => a.from - b.from)
  }
  const term = <T>(page: Page, fn: string, ...args: unknown[]): Promise<T> => page.evaluate(({ fn, args }) => (window as unknown as { __oneTerm: Record<string, (...a: unknown[]) => unknown> }).__oneTerm[fn](...args) as T, { fn, args })

  test('a page’s task changes applied together are ONE write naming both (terminal:<batch>#a+b): the eject settles both — discarded + ejected, the batch’s Undo writes nothing — and its Undo applies both again', async ({ page, context }) => {
    test.setTimeout(120_000)
    const T1 = 'wi_ejgrp1aaaa'
    const T2 = 'wi_ejgrp2aaaa'
    const id = await setup(page, doc(item({ itemId: T1, status: 'todo' }, 'Draft copy'), item({ itemId: T2, status: 'todo' }, 'Ship pricing')))
    await startRecorder(page)
    await mockAgent(context, [call('u1', 'update_work_item', { updates: [{ item: T1, status: 'done' }, { item: T2, status: 'done' }] }), say('Staged.')])
    await openTerminal(page)
    await run(page, 'Close both tasks')
    await done(page)
    const ids = (await changes(page)).map((c) => c.id as string)
    expect(ids).toHaveLength(2)
    const mark = await markRec(page)
    // Apply all: one batch, the page's two task changes in ONE writeItems
    expect((await applyAlone(page, ...ids)).applied.sort()).toEqual([...ids].sort())
    await flush(page)
    expect(tasksIn(await pageContent(page, id)).map((t) => t.status)).toEqual(['done', 'done'])
    await expectLane(page, mark, 'terminal', undefined, new RegExp(`^terminal:[^#]+#(${ids[0]}\\+${ids[1]}|${ids[1]}\\+${ids[0]})$`))
    const [batch] = await batches(page)
    const r = await recOf(page)<{ id: string; state: string; changes: Record<string, string[]> }>('eject', { lane: 'terminal', run: batch.key, a: batch.from - 1000, b: batch.to + 1000 })
    expect(r.state).toBe('done')
    expect(r.changes[`p:${id}`]).toEqual(ids.map((c) => `${batch.key}#${c}`).sort())
    expect(tasksIn(await pageContent(page, id)).map((t) => t.status)).toEqual(['todo', 'todo'])
    // both settled: discarded + ejected, never open again
    await expect.poll(async () => (await changes(page)).map((c) => [c.status, c.ejected?.id ?? null])).toEqual([['discarded', r.id], ['discarded', r.id]])
    // the batch's own Undo writes nothing and says nothing was "edited since" (quiet): every change of it is settled
    const rev = await wsEval(page, (s, id) => s.pages[id].contentRev, id)
    const undone = await page.evaluate((key) => {
      const t = (window as unknown as { __oneTerm: { batch(id: string): unknown; undoStagedBatch(res: unknown, o: { quiet: boolean }): { kept: string[]; final: string[] } } }).__oneTerm
      return t.undoStagedBatch(t.batch(key.slice('terminal:'.length)), { quiet: true })
    }, batch.key)
    expect(undone.kept.sort()).toEqual([...ids].sort())
    expect(await wsEval(page, (s, id) => s.pages[id].contentRev, id)).toBe(rev)
    // the eject's Undo: both done again, both applied again
    expect(await recOf(page)<{ ok?: boolean }>('undoEject', r.id)).toMatchObject({ ok: true })
    expect(tasksIn(await pageContent(page, id)).map((t) => t.status)).toEqual(['done', 'done'])
    await expect.poll(async () => (await changes(page)).map((c) => c.status)).toEqual(['applied', 'applied'])
  })

  /** Plan holds T1; Claude stages "Book venue" on Launch (#venue, a new task) and T1 waiting for it (needs the first). */
  async function venue(page: Page, context: Parameters<typeof mockAgent>[0]) {
    const T1 = 'wi_ejlnk1aaaa'
    const plan = await setup(page, doc(item({ itemId: T1, status: 'todo' }, 'Draft copy')))
    const launch = await createPage(page, { title: 'Launch', content: doc(p('Launch day in Tessera.')) })
    await startRecorder(page)
    await mockAgent(context, [
      call('a1', 'append_to_page', { id: launch, markdown: '> [!TODO] Book venue {#venue}' }),
      call('u1', 'update_work_item', { updates: [{ item: T1, blocked_by: { add: ['#venue'] } }] }),
      say('Staged.'),
    ])
    await openTerminal(page)
    await run(page, 'Book the venue first')
    await done(page)
    const [ca, cb] = (await changes(page)) as AnyState[]
    expect(cb.needs).toEqual([ca.id])
    return { T1, plan, launch, ca: ca.id as string, cb: cb.id as string }
  }

  test('ejecting the change that made a task holds its place while an applied change elsewhere still links it (Blocked by): never a link to a task that is gone', async ({ page, context }) => {
    test.setTimeout(120_000)
    const v = await venue(page, context)
    // two batches: the new task, then T1 waiting for it
    expect((await applyAlone(page, v.ca)).applied).toEqual([v.ca])
    expect((await applyAlone(page, v.cb)).applied).toEqual([v.cb])
    await flush(page)
    const made = tasksIn(await pageContent(page, v.launch))[0].itemId as string
    expect(tasksIn(await pageContent(page, v.plan))[0].blockedBy).toEqual([made])
    const [b1] = await batches(page)
    const sel = { lane: 'terminal', run: b1.key, a: b1.from - 1000, b: b1.to + 1 }
    const planned = await recOf(page)<{ places: Array<{ p: string; outcome: string; reason: string | null }> }>('planEject', sel)
    expect(planned.places.find((x) => x.p === `p:${v.launch}`)).toMatchObject({ outcome: 'held', reason: 'taskLinked' })
    // the eject leaves it: the task stays, the change stays applied, T1's link stays whole
    const r = await recOf(page)<{ state?: string; refused?: unknown }>('eject', sel)
    if (r.state) expect(r.state).toBe('done')
    expect(tasksIn(await pageContent(page, v.launch)).map((t) => t.itemId)).toEqual([made])
    expect((await changes(page)).map((c) => c.status)).toEqual(['applied', 'applied'])
  })

  test('a discarded change that builds on an ejected one never comes back with its own Undo or Restore (the eject’s Undo gives them back)', async ({ page, context }) => {
    test.setTimeout(120_000)
    const v = await venue(page, context)
    expect((await applyAlone(page, v.ca)).applied).toEqual([v.ca])
    expect(await term<string[]>(page, 'discardStaged', v.cb)).toEqual([v.cb])
    await flush(page)
    const [b1] = await batches(page)
    const r = await recOf(page)<{ id: string; state: string }>('eject', { lane: 'terminal', run: b1.key, a: b1.from - 1000, b: b1.to + 1000 })
    expect(r.state).toBe('done')
    expect(tasksIn(await pageContent(page, v.launch))).toEqual([])
    await expect.poll(async () => (await changes(page)).map((c) => [c.status, !!c.ejected])).toEqual([['discarded', true], ['discarded', false]])
    // Preflight's card Undo (undiscardStaged) and the row's Restore refuse it: it could never apply
    expect(await term<string[]>(page, 'undiscardStaged', [v.cb])).toEqual([])
    await term(page, 'restoreStaged', v.cb)
    expect((await changes(page)).map((c) => c.status)).toEqual(['discarded', 'discarded'])
    await expect(change(page, 2).getByRole('button', { name: /^Restore/ })).toHaveCount(0)
    // the eject's Undo: the task back, its change applied; the dependant can be restored again now
    expect(await recOf(page)<{ ok?: boolean }>('undoEject', r.id)).toMatchObject({ ok: true })
    await expect.poll(async () => (await changes(page)).map((c) => c.status)).toEqual(['applied', 'discarded'])
    await expect(change(page, 2).getByRole('button', { name: /^Restore/ })).toBeVisible()
    expect(await term<string[]>(page, 'undiscardStaged', [v.cb])).toEqual([v.cb])
  })
})
