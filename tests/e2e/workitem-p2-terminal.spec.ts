/**
 * Task block P2 — the AI terminal writes tasks: staging through the settle gate (ids minted at staging, reused 1:1 at
 * apply, never re-minted), handles and cross-change needs, list_work_items / update_work_item, edit_page refs for
 * tasks at any depth, the review facts (ItemFacts), Undo. Claude is mocked (helpers/terminal.ts) — nothing reaches
 * api.anthropic.com. Test data is fictional.
 */
import type { Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, wsEval, createPage, gotoPage, editorOf, flush, MOD } from './fixtures'
import { call, mockAgent, openTerminal, prompt, resultText, run, say, setKey, terminal, type AnyState } from './helpers/terminal'
import { expectLane, markRec, startRecorder } from './helpers/recorder'

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
    const ids = [...res.matchAll(/→ (wi_[A-Za-z0-9]{10})/g)].map((x) => x[1])
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
})
