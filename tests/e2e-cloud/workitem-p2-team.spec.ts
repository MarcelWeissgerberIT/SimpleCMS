/**
 * Task block P2 in a team workspace, against the real server — Claude writes tasks from the AI terminal:
 *  - the member list is warmed at the start of a task (M5): with the cache cold, the FIRST task of the session names
 *    member B by email and resolves to B's account id; B's tab shows the task with B as its owner; nobody is added to
 *    the people; an unknown name is refused with the names — never an email;
 *  - privacy both ways (M7): a task on a shared page "Blocked by" a private task → the link is left out (`scope`); a new
 *    task on a private page "Blocks:" a shared task → left out, no task change staged;
 *  - an older server (no `schema_min`): no task rules in the request, Claude's `[!TODO]` stays a quote (`gate`);
 *  - a viewer: update_work_item is refused (the person may only read).
 * Claude is mocked (tests/e2e/helpers/terminal.ts) — nothing reaches api.anthropic.com. Fictional people and titles.
 */
import type { Page } from '@playwright/test'
import { test, expect, email, signIn, openApp, waitOnline, wsEval, cloudEval, createWorkspace, newPerson, join, gotoPage, editorOf } from './fixtures'
import { call, mockAgent, openTerminal, resultText, run, say, setKey, terminal, type AnyState } from '../e2e/helpers/terminal'

const X = 'wi_p2teamx001'
const P1 = 'wi_p2priv0001'

const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const item = (attrs: Record<string, unknown>, title: string) => ({ type: 'workItem', attrs, content: [p(title)] })
const doc = (...content: unknown[]) => ({ type: 'doc', content })

const meId = (page: Page) => cloudEval(page, (c) => c.user.id as string)
const done = (page: Page) => expect(terminal(page).locator('.term-turn').last()).toHaveAttribute('data-status', /done|limit/, { timeout: 30_000 })
const changes = (page: Page) => page.evaluate(() => (window as unknown as { __oneTerm: { state: { getState(): { changes: AnyState[] } } } }).__oneTerm.state.getState().changes)

/** Every task of a doc (document order, any depth): attrs + title. */
function tasksIn(d: AnyState | null | undefined): Array<AnyState & { title: string }> {
  const out: Array<AnyState & { title: string }> = []
  const text = (n: AnyState): string => n.text ?? (n.content ?? []).map(text).join('')
  const walk = (n: AnyState) => {
    if (n.type === 'workItem') out.push({ ...(n.attrs ?? {}), title: text(n.content?.[0] ?? {}) })
    for (const c of n.content ?? []) walk(c)
  }
  if (d) walk(d)
  return out
}
const contentOf = (page: Page, id: string) => wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.pages[id]?.content ?? null)), id)

/** A page with these blocks, written through the store (as the bridge writes any non-editor change). */
async function taskPage(page: Page, title: string, ...blocks: unknown[]): Promise<string> {
  const id = await wsEval(page, (s, title) => s.createPage({ title, parentId: null }) as string, title)
  await wsEval(page, (s, { id, d }) => s.setContent(id, d, 'e2e'), { id, d: doc(...blocks) })
  return id
}

test.describe('Claude writes tasks in a team workspace', () => {
  test('a cold member list is warmed at task start: Owner by a member\'s email → that member; B sees it; nobody added; an unknown name is refused with names, never an email', async ({ page: a }) => {
    const bEmail = email('bo')
    await signIn(a, email('ada'))
    const wsId = await createWorkspace(a, 'Nordlicht crew')
    const b = await newPerson(a.context())
    await signIn(b, bEmail)
    await join(a, b, wsId)
    await openApp(a, wsId)
    await waitOnline(a)
    const bId = await (async () => {
      await openApp(b, wsId)
      await waitOnline(b)
      return meId(b)
    })()
    await expect.poll(() => wsEval(a, (s) => (s.people as Array<{ id: string }>).map((p) => p.id))).toContain(bId)
    const before = await wsEval(a, (s) => s.people.length as number)
    const id = await taskPage(a, 'Nordlicht team plan', p('Kick-off notes.'))
    // the member cache cold: the first task of the session must warm it before Claude's call is staged
    await a.evaluate(() => (window as unknown as { __oneItems: { forgetMembers(): void } }).__oneItems.forgetMembers())
    await setKey(a)
    const m = await mockAgent(a.context(), [
      call('t1', 'append_to_page', { id, markdown: `> [!TODO] Book the venue\n> Owner: ${bEmail}` }),
      call('t2', 'append_to_page', { id, markdown: '> [!TODO] Print the badges\n> Owner: Bob' }),
      say('Staged.'),
    ])
    await gotoPage(a, id)
    await openTerminal(a)
    await run(a, 'Plan the venue with Bo')
    await done(a)
    expect(resultText(m.bodies[1], 't1')).toMatch(/New tasks: "Book the venue" → wi_/)
    const refusal = resultText(m.bodies[2], 't2')
    expect(refusal).toContain('Unknown person "Bob"')
    expect(refusal).toContain('People in this workspace')
    expect(refusal).not.toContain('@example.test')
    const staged = await changes(a)
    expect(staged).toHaveLength(1)
    const card = terminal(a).locator('.term-change').first()
    await card.getByRole('button', { name: /^Apply #1/ }).click()
    await expect(card).toHaveAttribute('data-status', 'applied')
    const tasks = tasksIn(await contentOf(a, id))
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ title: 'Book the venue', people: [bId] })
    expect(await wsEval(a, (s) => s.people.length as number)).toBe(before)
    // B's tab: the task with B as its owner
    await gotoPage(b, id)
    await expect.poll(async () => tasksIn(await contentOf(b, id))[0]?.people ?? null, { timeout: 20_000 }).toEqual([bId])
    await expect(editorOf(b, id).locator('[data-type="work-item"]')).toContainText('Book the venue')
    await b.context().close()
  })

  test('privacy both ways: a shared task never waits for a private one, a private task never blocks a shared one', async ({ page }) => {
    await signIn(page, email('pia'))
    const wsId = await createWorkspace(page, 'Tessera corner')
    await openApp(page, wsId)
    await waitOnline(page)
    const priv = await page.evaluate(() => (window as any).__one.cloud.createPrivatePage({ title: 'My prep' }) as string) // eslint-disable-line @typescript-eslint/no-explicit-any
    await wsEval(page, (s, { id, d }) => s.setContent(id, d, 'e2e'), { id: priv, d: doc(item({ id: 'p1', itemId: P1, status: 'todo' }, 'Private prep')) })
    const shared = await taskPage(page, 'Tessera team plan', item({ id: 'x1', itemId: X, status: 'todo' }, 'Shared launch'), p('Bottom line'))
    await expect.poll(() => page.evaluate((id) => (window as any).__oneItems.index().byId[id]?.private, P1)).toBe(true) // eslint-disable-line @typescript-eslint/no-explicit-any
    await setKey(page)
    const m = await mockAgent(page.context(), [
      call('t1', 'append_to_page', { id: shared, markdown: `> [!TODO] Ship the shared part\n> Blocked by: ${P1}` }),
      call('t2', 'append_to_page', { id: priv, markdown: `> [!TODO] Private follow-up\n> Blocks: ${X}` }),
      say('Staged.'),
    ])
    await gotoPage(page, shared)
    await openTerminal(page)
    await run(page, 'Link the plans')
    await done(page)
    expect(resultText(m.bodies[1], 't1')).toContain('A shared task can\'t wait for a private one')
    expect(resultText(m.bodies[2], 't2')).toContain('A shared task can\'t wait for a private one')
    const staged = await changes(page)
    // two appends, no task change for "Blocks:" onto the shared task
    expect(staged.map((c) => c.kind)).toEqual(['append', 'append'])
    expect(staged[0].items.facts[0].blockedBy).toEqual([])
    expect(staged[0].items.warnings.map((w: AnyState) => w.code)).toContain('scope')
    // the review shows the left-out link
    await expect(terminal(page).locator('.term-change').first().locator('.item-facts__warn')).toContainText('A shared task can’t wait for a private one')
  })

  test('an older server (no schema_min): no task rules go to Claude and its [!TODO] stays a quote; a viewer\'s update_work_item is refused', async ({ page, context }) => {
    await signIn(page, email('olga'))
    const wsId = await createWorkspace(page, 'Older crew')
    await openApp(page, wsId)
    await waitOnline(page)
    const id = await taskPage(page, 'Older plan', item({ id: 'x1', itemId: X, status: 'todo' }, 'Shared launch'), p('Bottom line'))
    // the server answers like one without the schema gate
    await page.route('**/api/config', async (route) => {
      const res = await route.fetch()
      const json = (await res.json()) as Record<string, unknown>
      delete json.schema_min
      await route.fulfill({ response: res, json })
    })
    await openApp(page, wsId)
    await waitOnline(page)
    expect(await page.evaluate(() => (window as unknown as { __oneItems: { canCreate(): boolean } }).__oneItems.canCreate())).toBe(false)
    await setKey(page)
    const m = await mockAgent(context, [call('t1', 'append_to_page', { id, markdown: '> [!TODO] Book the venue' }), say('Staged.')])
    await gotoPage(page, id)
    await openTerminal(page)
    await run(page, 'Book the venue')
    await done(page)
    expect(JSON.stringify(m.bodies[0].system)).not.toContain('A tracked task')
    const res = resultText(m.bodies[1], 't1')
    expect(res).toContain('Tasks can\'t be made here right now')
    const card = terminal(page).locator('.term-change').first()
    await card.getByRole('button', { name: /^Apply #1/ }).click()
    await expect(card).toHaveAttribute('data-status', 'applied')
    const c = await contentOf(page, id)
    expect(tasksIn(c).map((t) => t.itemId)).toEqual([X])
    expect((c.content as AnyState[]).some((n) => n.type === 'blockquote')).toBe(true)
    await page.unroute('**/api/config')
    await context.unrouteAll({ behavior: 'ignoreErrors' })

    // a viewer: the task change is refused — the person may only read
    const guest = await newPerson(context)
    await signIn(guest, email('vic'))
    await join(page, guest, wsId, 'viewer')
    await openApp(guest, wsId)
    await waitOnline(guest)
    await setKey(guest)
    const g = await mockAgent(guest.context(), [call('u1', 'update_work_item', { updates: [{ item: X, status: 'done' }] }), say('Tried.')])
    await gotoPage(guest, id)
    await openTerminal(guest)
    await run(guest, 'Mark the launch done')
    await done(guest)
    expect(resultText(g.bodies[1], 'u1')).toContain('may only read')
    expect((await changes(guest)).filter((c) => c.kind === 'workItem')).toEqual([])
    expect(tasksIn(await contentOf(guest, id))[0]).toMatchObject({ itemId: X, status: 'todo' })
    await guest.context().close()
  })
})
