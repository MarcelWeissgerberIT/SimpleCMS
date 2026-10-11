/**
 * Task block P1 — "the block": tasks are made and edited in the editor.
 *  - the interactive placard: status key (click, Alt-click, ⌄ radiogroup), Mod+Enter / Mod+Alt+Enter, each one
 *    undo step; the blocked confirm; chips per blocker (LEDs, BLOCKED + lock line, AFTER n ✓); the unblock toast;
 *  - pickers: due (drafts: Esc / outside never set a date, Done does), people (Me, add, cap, unknown), blocked by
 *    (this page / other pages, loop disabled, cap), blocks (other page, Undo), the related list;
 *  - keyboard: Enter (end / start / middle / empty), Shift+Enter, Backspace, Enter on the empty last note; `@` rows;
 *  - creating: slash /task · /aufgabe, `[!] ` (not in a table cell; in notes → after the task), Turn into ⇄ task
 *    (to-do fields, three to-dos in one undo step, links-gone toast); the block menu's task section;
 *  - read-only: locked page, history preview, share link; stacking + compact; 390 dark: sizes, labels, ghosts;
 *  - the creation gate shut (`__oneItems.forceCanCreate(false)`).
 * Tasks are injected through the store (fictional people and titles); no real host is called.
 */
import type { Locator, Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, gotoPage, editorOf, createPage, wsEval, flush, doc, para, MOD } from './fixtures'
import { blocksFromItem, itemFromBlock, itemFromTodo, splitListAround } from '../../src/app/editor/workitem/turn'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const A = 'wi_7f3a9c2d01'
const B = 'wi_1b2c3d4e5f'
const C = 'wi_9d8e7f6a5b'
const D = 'wi_4c1a2b3c4d'
const E = 'wi_2e2e2e2e2e'
const FAR = '2031-10-17'

const p = (text: string): JSONContent => para(text)
const item = (attrs: Record<string, unknown>, title: string, ...notes: JSONContent[]): JSONContent => ({ type: 'workItem', attrs: { status: 'todo', ...attrs }, content: [p(title), ...notes] })
const todos = (...list: Array<[boolean, string]>): JSONContent => ({ type: 'taskList', content: list.map(([checked, text]) => ({ type: 'taskItem', attrs: { checked }, content: [p(text)] })) })

const tasks = (page: Page, id: string): Locator => editorOf(page, id).locator('.workitem')
const titleOf = (task: Locator): Locator => task.locator('.workitem__body p').first()

/** The tasks of a page as stored (attrs + title), document order. */
async function stored(page: Page, id: string): Promise<Array<{ attrs: AnyState; title: string; notes: string[] }>> {
  return wsEval(
    page,
    (s, id) => {
      const out: Array<{ attrs: AnyState; title: string; notes: string[] }> = []
      const text = (n: AnyState): string => (n.text ?? '') + (n.content ?? []).map(text).join('')
      const walk = (n: AnyState) => {
        if (n.type === 'workItem') out.push({ attrs: n.attrs, title: text(n.content?.[0] ?? {}), notes: (n.content ?? []).slice(1).map(text) })
        ;(n.content ?? []).forEach(walk)
      }
      walk(s.pages[id]?.content ?? {})
      return out
    },
    id,
  )
}

/** The page's live editor document (JSON) — what the editor holds right now. */
async function live(page: Page, id: string): Promise<JSONContent> {
  return page.evaluate((id) => {
    const el = document.querySelector(`.ProseMirror[data-page-id="${id}"]`) as unknown as { editor: { getJSON: () => unknown } }
    return el.editor.getJSON() as JSONContent
  }, id) as Promise<JSONContent>
}

/** The live tasks (attrs + title), document order. */
async function liveTasks(page: Page, id: string): Promise<Array<{ attrs: AnyState; title: string; notes: number }>> {
  const d = await live(page, id)
  const out: Array<{ attrs: AnyState; title: string; notes: number }> = []
  const text = (n: JSONContent): string => (n.text ?? '') + (n.content ?? []).map(text).join('')
  const walk = (n: JSONContent) => {
    if (n.type === 'workItem') out.push({ attrs: n.attrs ?? {}, title: text(n.content?.[0] ?? {}), notes: (n.content?.length ?? 1) - 1 })
    ;(n.content ?? []).forEach(walk)
  }
  walk(d)
  return out
}

async function people(page: Page): Promise<{ alex: string; sam: string; mira: string }> {
  return wsEval(page, (s) => {
    const find = (n: string) => (s.people as AnyState[]).find((p) => p.name === n)?.id ?? s.addPerson(n)
    return { alex: find('Alex'), sam: find('Sam'), mira: find('Mira') }
  })
}

async function taskPage(page: Page, title: string, ...content: JSONContent[]): Promise<string> {
  const id = await createPage(page, { title, content: doc(...content) })
  await gotoPage(page, id)
  await expect(editorOf(page, id)).toBeVisible()
  return id
}

/** Put the caret at the end of a task's title. */
async function caretInTitle(page: Page, task: Locator, where: 'end' | 'start' = 'end'): Promise<void> {
  await titleOf(task).click()
  await page.keyboard.press(where === 'end' ? 'End' : 'Home')
}

const undo = (page: Page) => page.keyboard.press(`${MOD}+z`)

/* ------------------------------------------------------------------ */
/* Turn into helpers (pure)                                            */
/* ------------------------------------------------------------------ */

test.describe('turn helpers (pure)', () => {
  test('itemFromTodo: tick → done, the first date → due + reminder, people → people, nested blocks → notes; the text tidied', () => {
    const todo: JSONContent = {
      type: 'taskItem',
      attrs: { checked: true },
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Call ' }, { type: 'mention', attrs: { id: '2031-10-17', label: 'Fri 17 Oct', kind: 'date', reminder: 'at' } }, { type: 'text', text: ' the bank ' }, { type: 'mention', attrs: { id: '2031-10-20', label: 'Mon', kind: 'date' } }, { type: 'text', text: ' with ' }, { type: 'mention', attrs: { id: 'p_alex', label: 'Alex', kind: 'person' } }] },
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [p('step')] }] },
      ],
    }
    const t = itemFromTodo(todo, 1234, 'wi_aaaaaaaaaa')
    expect(t.attrs).toMatchObject({ itemId: 'wi_aaaaaaaaaa', status: 'done', doneAt: 1234, due: '2031-10-17', reminder: 'at', people: ['p_alex'] })
    // the second date mention stays in the title
    expect(JSON.stringify(t.content![0])).toContain('2031-10-20')
    expect(t.content![0].content![0]).toEqual({ type: 'text', text: 'Call the bank ' })
    expect(t.content!.length).toBe(2)
    expect(itemFromTodo({ type: 'taskItem', attrs: { checked: false }, content: [p('x')] }, 1).attrs).toMatchObject({ status: 'todo', doneAt: null, due: null })
  })

  test('itemFromBlock: a heading keeps its marks as the title; a list item: first line title, rest notes; a task inside → its plain blocks', () => {
    const h = itemFromBlock({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Bold', marks: [{ type: 'bold' }] }] }, 'wi_bbbbbbbbbb')
    expect(h).toEqual({ type: 'workItem', attrs: { itemId: 'wi_bbbbbbbbbb', status: 'todo' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bold', marks: [{ type: 'bold' }] }] }] })
    const li = itemFromBlock({ type: 'listItem', content: [p('first'), { type: 'workItem', attrs: { itemId: 'wi_cccccccccc' }, content: [p('inner')] }] }, 'wi_dddddddddd')
    expect(li.content!.map((n) => n.type)).toEqual(['paragraph', 'paragraph'])
  })

  test('blocksFromItem: the fields as mentions after the title; to-do ticked when done, notes nested; toggle keeps notes', () => {
    const task: JSONContent = { type: 'workItem', attrs: { itemId: A, status: 'done', due: '2031-10-17', reminder: '-1d', people: ['p_alex', 'p_gone'] }, content: [p('Ship it'), p('a note')] }
    const labels = { date: () => 'Fri 17 Oct', person: (id: string) => (id === 'p_alex' ? 'Alex' : null) }
    const [para0, note] = blocksFromItem(task, labels, 'paragraph')
    expect(para0.content).toEqual([
      { type: 'text', text: 'Ship it' },
      { type: 'text', text: ' ' },
      { type: 'mention', attrs: { id: '2031-10-17', label: 'Fri 17 Oct', kind: 'date', reminder: '-1d' } },
      { type: 'text', text: ' ' },
      { type: 'mention', attrs: { id: 'p_alex', label: 'Alex', kind: 'person' } },
    ])
    expect(note).toEqual(p('a note'))
    const [list] = blocksFromItem(task, labels, 'taskList')
    expect(list.content![0]).toMatchObject({ type: 'taskItem', attrs: { checked: true } })
    expect(list.content![0].content!.length).toBe(2)
    const [toggle] = blocksFromItem(task, labels, 'toggle')
    expect(toggle.content!.map((n) => n.type)).toEqual(['detailsSummary', 'detailsContent'])
  })

  test('splitListAround: the items before stay, the replacement follows, the rest a second list (a numbered one keeps counting)', () => {
    const list: JSONContent = { type: 'orderedList', attrs: { id: 'L1', start: 1 }, content: [1, 2, 3, 4].map((n) => ({ type: 'listItem', content: [p(String(n))] })) }
    const out = splitListAround(list, 1, [p('X'), p('Y')], 2)
    expect(out.map((n) => n.type)).toEqual(['orderedList', 'paragraph', 'paragraph', 'orderedList'])
    expect(out[0].content!.length).toBe(1)
    expect(out[3].attrs).toMatchObject({ id: null, start: 4 })
    expect(splitListAround(list, 0, [p('X')], 4)).toEqual([p('X')])
  })
})

/* ------------------------------------------------------------------ */
/* The placard: key, ⌄, Mod+Enter                                      */
/* ------------------------------------------------------------------ */

test.describe('1440 light', () => {
  test('the key: click done ⇄ open, Alt-click in progress, each one undo step; two quick clicks = two steps', async ({ page }) => {
    await openApp(page)
    const id = await taskPage(page, 'Key page', p('Intro line.'), item({ itemId: A }, 'Run the checkout with test cards'))
    const task = tasks(page, id).first()
    const key = task.locator('button.workitem__key')
    await expect(key).toHaveAttribute('aria-label', 'Status: Open. Mark done')
    await caretInTitle(page, task)
    await key.click()
    await expect(task).toHaveAttribute('data-status', 'done')
    await expect(key).toHaveAttribute('aria-label', 'Status: Done. Reopen')
    // the caret stayed in the editor: Mod+Z undoes the key (one step)
    await undo(page)
    await expect(task).toHaveAttribute('data-status', 'todo')
    await key.click({ modifiers: ['Alt'] })
    await expect(task).toHaveAttribute('data-status', 'in_progress')
    await expect(task.locator('.workitem__state')).toHaveText('In progress')
    await undo(page)
    await expect(task).toHaveAttribute('data-status', 'todo')
    // two quick clicks: done, then open again — two undo steps
    await key.click()
    await key.click()
    await expect(task).toHaveAttribute('data-status', 'todo')
    await undo(page)
    await expect(task).toHaveAttribute('data-status', 'done')
    await undo(page)
    await expect(task).toHaveAttribute('data-status', 'todo')
    // the title text was never touched
    await expect(titleOf(task)).toHaveText('Run the checkout with test cards')
  })

  test('⌄: a radiogroup — arrows move the choice, Enter picks it, Esc leaves it; Mod+Enter / Mod+Alt+Enter', async ({ page }) => {
    await openApp(page)
    const id = await taskPage(page, 'Caret page', item({ itemId: A }, 'Approve the final pricing copy', p('A note'), todos([false, 'Name the plans'])))
    const task = tasks(page, id).first()
    await caretInTitle(page, task)
    await task.locator('.workitem__caret').click()
    const group = page.getByRole('radiogroup', { name: 'Change status' })
    await expect(group).toBeVisible()
    await expect(group.getByRole('radio', { name: 'Open' })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(group.getByRole('radio', { name: 'In progress' })).toBeFocused()
    await expect(group.getByRole('radio', { name: 'In progress' })).toHaveAttribute('aria-checked', 'true')
    // nothing written yet
    await expect(task).toHaveAttribute('data-status', 'todo')
    await page.keyboard.press('Escape')
    await expect(group).toBeHidden()
    await expect(task).toHaveAttribute('data-status', 'todo')
    await task.locator('.workitem__caret').click()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(group).toBeHidden()
    await expect(task).toHaveAttribute('data-status', 'done')
    // focus is back in the title
    await expect(editorOf(page, id)).toBeFocused()
    await undo(page)
    await expect(task).toHaveAttribute('data-status', 'todo')
    // Mod+Enter in the title: done; Mod+Alt+Enter: in progress
    await caretInTitle(page, task)
    await page.keyboard.press(`${MOD}+Enter`)
    await expect(task).toHaveAttribute('data-status', 'done')
    await page.keyboard.press(`${MOD}+Alt+Enter`)
    await expect(task).toHaveAttribute('data-status', 'in_progress')
    await undo(page)
    await expect(task).toHaveAttribute('data-status', 'done')
    await undo(page)
    await expect(task).toHaveAttribute('data-status', 'todo')
    // Mod+Enter in a to-do inside the notes toggles the to-do, not the task
    await task.getByText('Name the plans', { exact: true }).click()
    await page.keyboard.press(`${MOD}+Enter`)
    await expect(task.locator('li[data-checked="true"]')).toHaveCount(1)
    await expect(task).toHaveAttribute('data-status', 'todo')
  })

  test('blocked: BLOCKED + lock line + a chip per blocker; marking it done asks once (Enter confirms, Esc cancels)', async ({ page }) => {
    await openApp(page)
    const id = await taskPage(
      page,
      'Blocked page',
      item({ itemId: A }, 'Run the checkout with test cards'),
      item({ itemId: B, status: 'in_progress' }, 'Approve the final pricing copy'),
      item({ itemId: E, status: 'done', doneAt: 1_790_000_000_000 }, 'Legal review of the terms'),
      item({ itemId: C, blockedBy: [A, B, E] }, 'Switch the pricing page live'),
    )
    const blocked = tasks(page, id).nth(3)
    await expect(blocked).toHaveAttribute('data-state', 'blocked')
    await expect(blocked.locator('.workitem__state')).toHaveText('Blocked')
    await expect(blocked.locator('.workitem__lock')).toHaveText('Waiting for 2 of 3')
    const deps = blocked.locator('.workitem__dep')
    await expect(deps).toHaveCount(3)
    await expect(deps.nth(0)).toHaveAttribute('data-state', 'open')
    await expect(deps.nth(1)).toHaveAttribute('data-state', 'in_progress')
    await expect(deps.nth(2)).toHaveAttribute('data-state', 'done')
    await expect(deps.nth(0).locator('.led--on')).toHaveCount(1)
    await expect(deps.nth(2).locator('.led--ok')).toHaveCount(1)
    await expect(deps.nth(0).getByRole('button')).toHaveAttribute('aria-label', 'Waiting for: Run the checkout with test cards — open')
    // the key: a lock; marking done asks
    const key = blocked.locator('button.workitem__key')
    await expect(key).toHaveAttribute('aria-label', 'Waiting for 2 open tasks. Mark done anyway…')
    await caretInTitle(page, blocked)
    await key.click()
    const confirm = page.getByRole('dialog', { name: /Still waiting for 2 tasks — mark done anyway\?/ })
    await expect(confirm).toBeVisible()
    await expect(confirm.getByRole('button', { name: 'Mark done' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(confirm).toBeHidden()
    await expect(blocked).toHaveAttribute('data-status', 'todo')
    await expect(editorOf(page, id)).toBeFocused()
    // Mod+Enter asks too; Enter confirms
    await caretInTitle(page, blocked)
    await page.keyboard.press(`${MOD}+Enter`)
    await expect(confirm).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(confirm).toBeHidden()
    await expect(blocked).toHaveAttribute('data-status', 'done')
    await expect(blocked.locator('.workitem__lock')).toHaveCount(0)
    await expect(editorOf(page, id)).toBeFocused()
    await undo(page)
    await expect(blocked).toHaveAttribute('data-status', 'todo')
  })

  test('finishing the last blocker unblocks the task live + a toast with Open; reopening blocks it again; AFTER n ✓', async ({ page }) => {
    await openApp(page)
    const other = await createPage(page, { title: 'Other page', content: doc(item({ itemId: C, blockedBy: [A] }, 'Switch the pricing page live')) })
    const id = await taskPage(page, 'Blocker page', item({ itemId: A }, 'Run the checkout with test cards'), item({ itemId: D, blockedBy: [A] }, 'Move the invoice template'))
    const dep = tasks(page, id).nth(1)
    await expect(dep).toHaveAttribute('data-state', 'blocked')
    const blocker = tasks(page, id).first()
    await expect(blocker.locator('.workitem__chip--blocks')).toHaveText('Blocks 2')
    await caretInTitle(page, blocker)
    await blocker.locator('button.workitem__key').click()
    await expect(dep).not.toHaveAttribute('data-state', 'blocked')
    await expect(dep).toHaveAttribute('data-state', 'after')
    await expect(dep.locator('.workitem__state')).toHaveText('After 1 ✓')
    await expect(blocker.locator('.workitem__chip--blocks')).toHaveText('Freed 2')
    const toast = page.locator('.toast').filter({ hasText: /Unblocked 2 tasks/ })
    await expect(toast).toBeVisible()
    // reopen: blocked again, no toast
    await blocker.locator('button.workitem__key').click()
    await expect(dep).toHaveAttribute('data-state', 'blocked')
    // finish again; the toast's Open goes to the first freed task's page (the other page first: created earlier)
    await blocker.locator('button.workitem__key').click()
    const t2 = page.locator('.toast').filter({ hasText: /Unblocked 2 tasks/ }).last()
    await t2.getByRole('button', { name: 'Open' }).click()
    await expect.poll(() => page.evaluate(() => window.location.hash)).toContain(`#/p/${other}`)
  })

  test('due picker: + DATE then Esc / outside → no date; Done → today; a date + time + reminder; Clear; overdue in words', async ({ page }) => {
    await openApp(page)
    const id = await taskPage(page, 'Due page', p('Above.'), item({ itemId: A }, 'Run the checkout with test cards'), p('Below the task.'))
    const task = tasks(page, id).first()
    await caretInTitle(page, task)
    const ghost = task.getByRole('button', { name: 'Date' })
    const dialog = page.getByRole('dialog', { name: 'Due date' })
    // Esc: nothing
    await ghost.click()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    // outside press: nothing (untouched)
    await caretInTitle(page, task)
    await ghost.click()
    await expect(dialog).toBeVisible()
    await editorOf(page, id).getByText('Below the task.').click()
    await expect(dialog).toBeHidden()
    expect((await liveTasks(page, id))[0].attrs.due ?? null).toBeNull()
    // Done: today (what the picker showed)
    await caretInTitle(page, task)
    await ghost.click()
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toBeHidden()
    const today = await page.evaluate(() => {
      const d = new Date()
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })
    await expect.poll(async () => (await liveTasks(page, id))[0].attrs.due).toBe(today)
    await expect(editorOf(page, id)).toBeFocused()
    // the chip opens it again: a far date with a time and a reminder, Enter in the field = Done
    await task.locator('.workitem__chip--due').click()
    await expect(dialog).toBeVisible()
    await dialog.locator('input[type="date"]').fill(FAR)
    await dialog.getByRole('switch', { name: 'Include time' }).click()
    await dialog.locator('select').selectOption('-1d')
    await dialog.locator('input[type="date"]').press('Enter')
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await liveTasks(page, id))[0].attrs).toMatchObject({ due: `${FAR}T09:00`, reminder: '-1d' })
    await expect(task.locator('.workitem__chip--due')).toContainText('Fri 17 Oct · 9:00 AM')
    // one undo step for the whole pick
    await undo(page)
    await expect.poll(async () => (await liveTasks(page, id))[0].attrs.due).toBe(today)
    await page.keyboard.press(`${MOD}+Shift+z`)
    await expect.poll(async () => (await liveTasks(page, id))[0].attrs.due).toBe(`${FAR}T09:00`)
    // Clear: date and reminder go
    await task.locator('.workitem__chip--due').click()
    await dialog.getByRole('button', { name: 'Clear' }).click()
    await expect.poll(async () => (await liveTasks(page, id))[0].attrs).toMatchObject({ due: null, reminder: null })
    // a past date: OVERDUE in words, the label too
    await task.getByRole('button', { name: 'Date' }).click()
    await dialog.locator('input[type="date"]').fill('2020-01-06')
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(task.locator('.workitem__chip--due')).toContainText(/Overdue · \d+ d\s*·\s*Mon 06 Jan/)
    await expect(task.locator('.workitem__state')).toHaveText('Overdue')
  })

  test('people picker: Me first, add a person, Esc discards the ticks, Done writes them; cap 12; unknown ids → Remove', async ({ page }) => {
    await openApp(page)
    const { alex, sam } = await people(page)
    const id = await taskPage(page, 'People page', item({ itemId: A, people: ['p_gone_0001'] }, 'Run the checkout with test cards'))
    const task = tasks(page, id).first()
    await caretInTitle(page, task)
    // nobody known yet: the ghost key (the unknown id stays hidden)
    await task.getByRole('button', { name: 'Person' }).click()
    const dialog = page.getByRole('dialog', { name: 'Assign' })
    await expect(dialog).toBeVisible()
    const options = dialog.getByRole('option')
    // Me ("You", the demo's own person) first
    await expect(options.first()).toContainText(/Me · You/)
    await dialog.getByRole('option', { name: 'Alex' }).click()
    await dialog.getByRole('option', { name: 'Sam' }).click()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    expect((await liveTasks(page, id))[0].attrs.people).toEqual(['p_gone_0001'])
    // again: tick Alex, add "Noor", remove the unknown id, Done
    await caretInTitle(page, task)
    await task.getByRole('button', { name: 'Person' }).click()
    await dialog.getByRole('option', { name: 'Alex' }).click()
    await dialog.getByRole('combobox').fill('Noor')
    await dialog.getByRole('option', { name: 'Add “Noor”' }).click()
    await dialog.getByRole('button', { name: '1 person no longer here — Remove' }).click()
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toBeHidden()
    const noor = await wsEval(page, (s) => (s.people as AnyState[]).find((p) => p.name === 'Noor')?.id)
    await expect.poll(async () => (await liveTasks(page, id))[0].attrs.people).toEqual([alex, noor])
    await expect(task.locator('.workitem__chip--person')).toHaveText([/Alex/, /Noor/])
    // one undo step
    await undo(page)
    await expect.poll(async () => (await liveTasks(page, id))[0].attrs.people).toEqual(['p_gone_0001'])
    // the cap: 12 people
    const many = await wsEval(page, (s) => Array.from({ length: 13 }, (_, i) => s.addPerson(`Person ${String(i).padStart(2, '0')}`) as string))
    await caretInTitle(page, task)
    await task.getByRole('button', { name: 'Person' }).click()
    for (let i = 0; i < 13; i++) await dialog.getByRole('option', { name: `Person ${String(i).padStart(2, '0')}` }).click()
    await expect(dialog.getByRole('status')).toHaveText('Up to 12 people')
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect.poll(async () => (await liveTasks(page, id))[0].attrs.people.length).toBe(12)
    expect((await liveTasks(page, id))[0].attrs.people).not.toContain(many[12])
    expect(sam).toBeTruthy()
  })

  test('blocked-by picker: THIS PAGE / OTHER PAGES, a loop disabled with its reason, ticks written once', async ({ page }) => {
    await openApp(page)
    await createPage(page, { title: 'Elsewhere', content: doc(item({ itemId: D }, 'Draft the FAQ')) })
    const id = await taskPage(page, 'Picker page', item({ itemId: A, blockedBy: [B] }, 'Publish the price list'), item({ itemId: B }, 'Approve the final pricing copy'), item({ itemId: C }, 'Check the leaflet with legal'))
    // B waits for nothing; A waits for B. On B: A would be a loop (titles apart from the demo seed's "Launch plan")
    const b = tasks(page, id).nth(1)
    await caretInTitle(page, b)
    await b.getByRole('button', { name: 'Depends on' }).click()
    const dialog = page.getByRole('dialog', { name: 'Waits for' })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.wi-pop__section')).toHaveText(['This page', 'Other pages'])
    const loop = dialog.getByRole('option', { name: /Publish the price list/ })
    await expect(loop).toHaveAttribute('aria-disabled', 'true')
    await expect(loop).toContainText('Would make a loop')
    await loop.click({ force: true })
    await expect(loop).toHaveAttribute('aria-selected', 'false')
    // search (folded) + tick two
    await dialog.getByRole('combobox').fill('LEAFLET')
    await expect(dialog.getByRole('option')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await dialog.getByRole('combobox').fill('faq')
    await dialog.getByRole('option', { name: /Draft the FAQ/ }).click()
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await liveTasks(page, id))[1].attrs.blockedBy).toEqual([C, D])
    await expect(b).toHaveAttribute('data-state', 'blocked')
    await expect(b.locator('.workitem__dep')).toHaveCount(2)
    await undo(page)
    await expect.poll(async () => (await liveTasks(page, id))[1].attrs.blockedBy).toEqual([])
  })

  test('blocked-by picker on a long page: ≤ 50 rows per group, the rest counted; a linked task past them still shows; search reaches all', async ({ page }) => {
    await openApp(page)
    const capId = (i: number) => `wi_cap${String(i).padStart(7, '0')}`
    const list = Array.from({ length: 60 }, (_, i) => item(i === 0 ? { itemId: capId(0), blockedBy: [capId(55)] } : { itemId: capId(i) }, `Cap task ${i}`))
    const id = await taskPage(page, 'Long task page', ...list)
    await caretInTitle(page, tasks(page, id).first())
    await page.keyboard.press('Alt+Enter')
    await page.locator('[data-popover][role="menu"]').first().getByRole('menuitem', { name: 'Blocked by…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Waits for' })
    await expect(dialog).toBeVisible()
    // 59 others here: the first 50 + the linked one (task 55) shown, 8 counted
    const here = dialog.getByRole('option', { name: /^Cap task/ })
    await expect(here).toHaveCount(51)
    await expect(dialog.getByRole('option', { name: /Cap task 55/ })).toHaveAttribute('aria-selected', 'true')
    await expect(dialog.getByRole('option', { name: /Cap task 57/ })).toHaveCount(0)
    await expect(dialog.getByText('8 more — type to narrow the list')).toBeVisible()
    await dialog.getByRole('combobox').fill('task 57')
    await expect(dialog.getByRole('option')).toHaveCount(1)
    await expect(dialog.getByText(/more — type to narrow/)).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('Blocks…: the other task waits (writeItems), Undo; the BLOCKS list removes a link with Undo; related both sides', async ({ page }) => {
    await openApp(page)
    const other = await createPage(page, { title: 'Other page', content: doc(item({ itemId: D }, 'Draft the FAQ'), item({ itemId: E, related: [A] }, 'Update the help center')) })
    const id = await taskPage(page, 'Blocks page', item({ itemId: A }, 'Run the checkout with test cards'))
    const a = tasks(page, id).first()
    // related: the other task lists A → A shows "1 related"
    await expect(a.locator('.workitem__chip--related')).toHaveText('1 related')
    await caretInTitle(page, a)
    await page.keyboard.press('Alt+Enter')
    const menu = page.locator('[data-popover][role="menu"]').first()
    await menu.getByRole('menuitem', { name: 'Blocks…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Blocks' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('option', { name: /Draft the FAQ/ }).click()
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(page.locator('.toast').filter({ hasText: '1 task now waits for this' })).toBeVisible()
    await expect.poll(async () => (await stored(page, other))[0].attrs.blockedBy).toEqual([A])
    await expect(a.locator('.workitem__chip--blocks')).toHaveText('Blocks 1')
    // the list: Remove → written on the other page, with Undo
    await a.locator('.workitem__chip--blocks').click()
    const list = page.getByRole('dialog', { name: 'Waiting for this task' })
    await expect(list).toBeVisible()
    await list.getByRole('button', { name: 'Remove link: Draft the FAQ' }).click()
    const removed = page.locator('.toast').filter({ hasText: 'Link removed' })
    await expect(removed).toBeVisible()
    await expect.poll(async () => (await stored(page, other))[0].attrs.blockedBy).toEqual([])
    await removed.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await stored(page, other))[0].attrs.blockedBy).toEqual([A])
    // the related list: the other side's link
    await a.locator('.workitem__chip--related').click()
    const rel = page.getByRole('dialog', { name: 'Related' })
    await expect(rel.getByRole('listitem')).toHaveText([/Update the help center/])
    await page.keyboard.press('Escape')
  })

  test('a blocker chip: its card (hover / click) — Open, Mark done (one toast, Undo), Remove link', async ({ page }) => {
    await openApp(page)
    const other = await createPage(page, { title: 'Other page', content: doc(item({ itemId: D }, 'Draft the FAQ')) })
    const id = await taskPage(page, 'Card page', item({ itemId: A, blockedBy: [D, 'wi_gone000000'] }, 'Switch the pricing page live'))
    const a = tasks(page, id).first()
    const deps = a.locator('.workitem__dep')
    await expect(deps.nth(1)).toHaveAttribute('data-state', 'gone')
    await expect(deps.nth(1)).toContainText('Not available')
    // hover: the card, no focus taken
    await deps.nth(0).locator('.workitem__chip--dep').hover()
    const card = page.getByRole('dialog', { name: 'Draft the FAQ' })
    await expect(card).toBeVisible()
    await expect(card).toContainText('Other page')
    // click: the card takes the keyboard; Mark done
    await deps.nth(0).locator('.workitem__chip--dep').click()
    await card.getByRole('button', { name: 'Mark done' }).click()
    const done = page.locator('.toast').filter({ hasText: /Unblocked: Switch the pricing page live|“Draft the FAQ” is done/ })
    await expect(done).toBeVisible()
    await expect.poll(async () => (await stored(page, other))[0].attrs.status).toBe('done')
    await expect(deps.nth(0)).toHaveAttribute('data-state', 'done')
    // × on the unresolved one removes that link (this task: one undo step)
    await caretInTitle(page, a)
    await deps.nth(1).getByRole('button', { name: 'Remove link' }).click()
    await expect.poll(async () => (await liveTasks(page, id))[0].attrs.blockedBy).toEqual([D])
    await undo(page)
    await expect.poll(async () => (await liveTasks(page, id))[0].attrs.blockedBy).toEqual([D, 'wi_gone000000'])
  })

  test('keyboard: Enter at the end → next task, at the start → a task before, in the middle → split; Shift+Enter; Backspace; the empty last note', async ({ page }) => {
    await openApp(page)
    const { alex } = await people(page)
    const id = await taskPage(page, 'Keys page', item({ itemId: A, due: FAR, people: [alex] }, 'Run the checkout'), p('After.'))
    const first = tasks(page, id).first()
    // end of a non-empty title: the next task, caret in it, nothing inherited
    await caretInTitle(page, first)
    await page.keyboard.press('Enter')
    await page.keyboard.type('Approve the copy')
    let list = await liveTasks(page, id)
    expect(list.map((x) => x.title)).toEqual(['Run the checkout', 'Approve the copy'])
    expect(list[1].attrs.itemId).toMatch(/^wi_/)
    expect(list[1].attrs.itemId).not.toBe(A)
    expect(list[1].attrs.due ?? null).toBeNull()
    expect(list[1].attrs.people ?? []).toEqual([])
    // the start of a non-empty title: a new empty task BEFORE it, this one keeps text + fields, the caret stays
    await caretInTitle(page, first, 'start')
    await page.keyboard.press('Enter')
    list = await liveTasks(page, id)
    expect(list.map((x) => x.title)).toEqual(['', 'Run the checkout', 'Approve the copy'])
    expect(list[1].attrs).toMatchObject({ itemId: A, due: FAR, people: [alex] })
    await page.keyboard.type('Now ')
    expect((await liveTasks(page, id))[1].title).toBe('Now Run the checkout')
    // the middle: the text after the caret becomes the next task's title, the fields stay
    await page.keyboard.press('End')
    for (let i = 0; i < 'checkout'.length; i++) await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Enter')
    list = await liveTasks(page, id)
    expect(list.map((x) => x.title)).toEqual(['', 'Now Run the ', 'checkout', 'Approve the copy'])
    expect(list[1].attrs.due).toBe(FAR)
    expect(list[2].attrs.due ?? null).toBeNull()
    // Enter on an empty title without fields or notes: the task becomes an empty line
    await titleOf(tasks(page, id).first()).click()
    await page.keyboard.press('Enter')
    expect((await liveTasks(page, id)).length).toBe(3)
    expect((await live(page, id)).content?.[0]).toMatchObject({ type: 'paragraph' })
    // Shift+Enter: the first note line; Enter on it while empty (the last one): it leaves the task
    const t2 = tasks(page, id).nth(1)
    await caretInTitle(page, t2)
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('A note')
    expect((await liveTasks(page, id))[1].notes).toBe(1)
    expect((await liveTasks(page, id))[1].title).toBe('checkout')
    await page.keyboard.press('Enter')
    expect((await liveTasks(page, id))[1].notes).toBe(2)
    await page.keyboard.press('Enter')
    expect((await liveTasks(page, id))[1].notes).toBe(1)
    await page.keyboard.type('outside')
    expect((await liveTasks(page, id))[1].notes).toBe(1)
    await expect(editorOf(page, id).locator(':scope > p').filter({ hasText: 'outside' })).toHaveCount(1)
    // Backspace at the start of an EMPTY title: its title line + notes stay, the task goes (one undo step)
    const before = (await liveTasks(page, id)).length
    await caretInTitle(page, t2)
    await page.keyboard.press('Shift+Home')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    expect((await liveTasks(page, id)).length).toBe(before - 1)
    await expect(editorOf(page, id).locator(':scope > p').filter({ hasText: 'A note' })).toHaveCount(1)
    await undo(page)
    expect((await liveTasks(page, id)).length).toBe(before)
  })

  test('"@" in a title: Assign / Due rows on top write the field (one transaction); plain mentions below', async ({ page }) => {
    await openApp(page)
    const { alex } = await people(page)
    const id = await taskPage(page, 'At page', item({ itemId: A }, 'Run the checkout'))
    const task = tasks(page, id).first()
    await caretInTitle(page, task)
    await page.keyboard.type(' @ale')
    const menu = page.getByRole('listbox')
    await expect(menu.getByRole('option').first()).toHaveText(/Assign: Alex/)
    await expect(menu).toContainText('Task fields')
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await liveTasks(page, id))[0].attrs.people).toEqual([alex])
    expect((await liveTasks(page, id))[0].title).toBe('Run the checkout')
    await page.keyboard.type(' @tomorrow')
    await menu.getByRole('option', { name: /^Due:/ }).click()
    expect((await liveTasks(page, id))[0].title).toBe('Run the checkout')
    const tomorrow = await page.evaluate(() => {
      const d = new Date()
      d.setDate(d.getDate() + 1)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })
    await expect.poll(async () => (await liveTasks(page, id))[0].attrs.due).toBe(tomorrow)
    // one undo step takes the field and gives the "@query" back
    await undo(page)
    await expect.poll(async () => (await liveTasks(page, id))[0].attrs.due ?? null).toBeNull()
  })

  test('creating: /task and /aufgabe, "[!] " (Backspace undoes it; not in a table cell; in notes → after the task)', async ({ page }) => {
    await openApp(page)
    const table = { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('')] }] }] }
    const id = await taskPage(page, 'Create page', p('First line'), p(''), table, item({ itemId: A }, 'Outer task', p('note')))
    const ed = editorOf(page, id)
    // slash
    await ed.locator('p').nth(1).click()
    await page.keyboard.type('/task')
    await expect(page.locator('.slash .slash__name').first()).toHaveText('Task')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Made by slash')
    let list = await liveTasks(page, id)
    expect(list.map((x) => x.title)).toEqual(['Made by slash', 'Outer task'])
    expect(list[0].attrs.status).toBe('todo')
    // "[!] " turns the line into a task, its text the title; Backspace right after undoes it
    await ed.locator('p').first().click()
    await page.keyboard.press('Home')
    await page.keyboard.type('[!] ')
    list = await liveTasks(page, id)
    expect(list.map((x) => x.title)).toEqual(['First line', 'Made by slash', 'Outer task'])
    await page.keyboard.press('Backspace')
    await expect(ed.locator('p').first()).toHaveText('[!] First line')
    expect((await liveTasks(page, id)).length).toBe(2)
    // in a table cell: the text stays
    await ed.locator('td p').click()
    await page.keyboard.type('[!] in a cell')
    await expect(ed.locator('td')).toContainText('[!] in a cell')
    expect((await liveTasks(page, id)).length).toBe(2)
    // in a task's notes: the new task goes after the task, the line leaves the notes
    await ed.getByText('note', { exact: true }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('[!] Follow-up')
    list = await liveTasks(page, id)
    expect(list.map((x) => x.title)).toEqual(['Made by slash', 'Outer task', 'Follow-up'])
    expect(list[1].notes).toBe(1)
    // German: /aufgabe
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/aufgabe')
    await expect(page.locator('.slash .slash__name').first()).toHaveText('Aufgabe')
    await page.keyboard.press('Escape')
  })

  test('Turn into: a paragraph → task; a to-do → its tick, first date, people as fields; three to-dos → three tasks (one undo); task → to-do / text writes mentions; links gone toast', async ({ page }) => {
    await openApp(page)
    const { alex, sam } = await people(page)
    const mention = (attrs: Record<string, unknown>) => ({ type: 'mention', attrs })
    const todo = {
      type: 'taskList',
      content: [
        {
          type: 'taskItem',
          attrs: { checked: true },
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Call the bank ' }, mention({ id: FAR, label: 'Fri 17 Oct', kind: 'date', reminder: '-1d' }), { type: 'text', text: ' with ' }, mention({ id: alex, label: 'Alex', kind: 'person' }), { type: 'text', text: ' ' }, mention({ id: sam, label: 'Sam', kind: 'person' })] },
            todos([false, 'Nested step']),
          ],
        },
        { type: 'taskItem', attrs: { checked: false }, content: [p('Second')] },
        { type: 'taskItem', attrs: { checked: false }, content: [p('Third')] },
      ],
    }
    const id = await taskPage(page, 'Turn page', p('Plain line'), todo, item({ itemId: B, blockedBy: [A] }, 'Linked task'), item({ itemId: A }, 'Blocker'))
    const ed = editorOf(page, id)
    // paragraph → task (block menu, Alt+Enter)
    await ed.getByText('Plain line').click()
    await page.keyboard.press('Alt+Enter')
    const menu = page.locator('[data-popover][role="menu"]').first()
    await menu.getByRole('menuitem', { name: 'Turn into', exact: true }).click()
    await page.getByRole('menuitem', { name: /^Task/ }).click()
    let list = await liveTasks(page, id)
    expect(list[0].title).toBe('Plain line')
    // the first to-do → a task: done, due + reminder, people, nested to-dos as notes, the list split around it
    await ed.locator('li p').filter({ hasText: 'Call the bank' }).first().click()
    await page.keyboard.press('Alt+Enter')
    await page.locator('[data-popover][role="menu"]').first().getByRole('menuitem', { name: 'Turn into', exact: true }).click()
    await page.getByRole('menuitem', { name: /^Task/ }).click()
    list = await liveTasks(page, id)
    const bank = list.find((x) => x.title.startsWith('Call the bank'))!
    expect(bank.title).toBe('Call the bank with')
    expect(bank.attrs).toMatchObject({ status: 'done', due: FAR, reminder: '-1d', people: [alex, sam] })
    expect(typeof bank.attrs.doneAt).toBe('number')
    expect(bank.notes).toBe(1)
    // three selected to-dos at once (block selection): one undo step
    const before = (await liveTasks(page, id)).length
    await ed.getByText('Second', { exact: true }).click()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Alt+Enter')
    await page.locator('[data-popover][role="menu"]').first().getByRole('menuitem', { name: 'Turn into', exact: true }).click()
    await page.getByRole('menuitem', { name: /^Task/ }).click()
    expect((await liveTasks(page, id)).length).toBe(before + 2)
    await undo(page)
    expect((await liveTasks(page, id)).length).toBe(before)
    // a task → to-do: the fields written out as mentions, ticked
    const bankTask = tasks(page, id).filter({ hasText: 'Call the bank' })
    await caretInTitle(page, bankTask)
    await page.keyboard.press('Alt+Enter')
    await page.locator('[data-popover][role="menu"]').first().getByRole('menuitem', { name: 'Turn into', exact: true }).click()
    await page.getByRole('menuitem', { name: /^To-do list/ }).click()
    const docNow = JSON.stringify(await live(page, id))
    expect(docNow).toContain('"kind":"date"')
    expect(docNow).toContain(`"id":"${alex}"`)
    await expect(ed.locator('li[data-checked="true"]').filter({ hasText: 'Call the bank' })).toHaveCount(1)
    // a task with links → text: the links-gone toast with Undo
    await caretInTitle(page, tasks(page, id).filter({ hasText: 'Linked task' }))
    await page.keyboard.press('Alt+Enter')
    await page.locator('[data-popover][role="menu"]').first().getByRole('menuitem', { name: 'Turn into', exact: true }).click()
    await page.getByRole('menuitem', { name: /^Text/ }).click()
    const gone = page.locator('.toast').filter({ hasText: 'The task’s link is gone.' })
    await expect(gone).toBeVisible()
    await gone.getByRole('button', { name: 'Undo' }).click()
    await expect(tasks(page, id).filter({ hasText: 'Linked task' })).toHaveCount(1)
  })

  test('the block menu of a task: its section (Status ▸, Due date…, Assign…, Blocked by…, Related…, Blocks…); keyboard only: Alt+Enter → Due… → set → focus back at the caret', async ({ page }) => {
    await openApp(page)
    const id = await taskPage(page, 'Menu page', item({ itemId: A }, 'Run the checkout'))
    const task = tasks(page, id).first()
    await caretInTitle(page, task)
    await page.keyboard.press('Alt+Enter')
    const menu = page.locator('[data-popover][role="menu"]').first()
    for (const name of ['Status', 'Due date…', 'Assign…', 'Blocked by…', 'Related…', 'Blocks…', 'Turn into', 'Copy link to block']) await expect(menu.getByRole('menuitem', { name, exact: true })).toBeVisible()
    // the menu's own Copy link stays the only one (the label key copies the task's link)
    await expect(menu.getByRole('menuitem', { name: /Copy link/ })).toHaveCount(1)
    // keyboard: the search filters, Enter picks Due date…
    await page.keyboard.type('Due')
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Due date' })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('input[type="date"]')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()
    await expect(editorOf(page, id)).toBeFocused()
    await expect.poll(async () => (await liveTasks(page, id))[0].attrs.due).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // typing goes on in the title
    await page.keyboard.type('!')
    expect((await liveTasks(page, id))[0].title).toBe('Run the checkout!')
    // ⋯ opens the same menu
    await task.locator('.workitem__more').click()
    await expect(page.locator('[data-popover][role="menu"]').first().getByRole('menuitem', { name: 'Assign…' })).toBeVisible()
    await page.keyboard.press('Escape')
  })

  test('keyboard only: two tasks, status, due, people, a blocker — blocked; finishing the blocker unblocks with a toast; each step undoes', async ({ page }) => {
    await openApp(page)
    const { alex } = await people(page)
    const id = await taskPage(page, 'Keyboard page', p(''))
    // setup: the caret on the page's empty line
    await page.evaluate((id) => (document.querySelector(`.ProseMirror[data-page-id="${id}"]`) as unknown as { editor: { commands: { focus: (at: string) => void } } }).editor.commands.focus('start'), id)
    await page.keyboard.type('[!] Order the samples')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Print the flyers')
    await expect.poll(async () => (await liveTasks(page, id)).map((x) => x.title)).toEqual(['Order the samples', 'Print the flyers'])
    const [first, second] = [tasks(page, id).nth(0), tasks(page, id).nth(1)]
    const firstId = (await liveTasks(page, id))[0].attrs.itemId as string
    expect(firstId).toMatch(/^wi_/)
    const at = async () => (await liveTasks(page, id))[1].attrs
    const redo = () => page.keyboard.press(`${MOD}+Shift+z`)
    const menuPick = async (name: string) => {
      await page.keyboard.press('Alt+Enter')
      await expect(page.locator('[data-popover][role="menu"]').first().getByRole('menuitem', { name })).toBeVisible()
      await page.keyboard.type(name.replace('…', ''))
      await page.keyboard.press('Enter')
    }
    // status: in progress, undone
    await page.keyboard.press(`${MOD}+Alt+Enter`)
    await expect(second).toHaveAttribute('data-status', 'in_progress')
    await undo(page)
    await expect(second).toHaveAttribute('data-status', 'todo')
    // due: today
    await menuPick('Due date…')
    const due = page.getByRole('dialog', { name: 'Due date' })
    await expect(due.locator('input[type="date"]')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(due).toBeHidden()
    await expect(editorOf(page, id)).toBeFocused()
    await expect.poll(async () => (await at()).due).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    await undo(page)
    await expect.poll(async () => (await at()).due ?? null).toBeNull()
    await redo()
    await expect.poll(async () => (await at()).due).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // people: Alex (Enter ticks, Mod+Enter writes)
    await menuPick('Assign…')
    const assign = page.getByRole('dialog', { name: 'Assign' })
    await expect(assign.getByRole('combobox')).toBeFocused()
    await page.keyboard.type('Alex')
    await page.keyboard.press('Enter')
    await page.keyboard.press(`${MOD}+Enter`)
    await expect(assign).toBeHidden()
    await expect.poll(async () => (await at()).people).toEqual([alex])
    await undo(page)
    await expect.poll(async () => (await at()).people).toEqual([])
    await redo()
    await expect.poll(async () => (await at()).people).toEqual([alex])
    // a blocker: the first task
    await menuPick('Blocked by…')
    const waits = page.getByRole('dialog', { name: 'Waits for' })
    await expect(waits.getByRole('combobox')).toBeFocused()
    await page.keyboard.type('samples')
    await expect(waits.getByRole('option')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await page.keyboard.press(`${MOD}+Enter`)
    await expect(waits).toBeHidden()
    await expect(second).toHaveAttribute('data-state', 'blocked')
    await expect.poll(async () => (await at()).blockedBy).toEqual([firstId])
    await undo(page)
    await expect(second).not.toHaveAttribute('data-state', 'blocked')
    await redo()
    await expect(second).toHaveAttribute('data-state', 'blocked')
    // finish the blocker: up into its title (the first ↑ stops in the gap between the two plates), Mod+Enter →
    // unblocked + the toast; undo blocks again
    await expect(editorOf(page, id)).toBeFocused()
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press(`${MOD}+Enter`)
    await expect(first).toHaveAttribute('data-status', 'done')
    await expect(second).not.toHaveAttribute('data-state', 'blocked')
    await expect(page.locator('.toast').filter({ hasText: /Unblocked: Print the flyers/ })).toBeVisible()
    await undo(page)
    await expect(first).toHaveAttribute('data-status', 'todo')
    await expect(second).toHaveAttribute('data-state', 'blocked')
  })

  test('read-only: a locked page, a history preview and a share link show the placard without keys', async ({ page }) => {
    await openApp(page)
    const id = await taskPage(page, 'Locked page', item({ itemId: A, blockedBy: [B] }, 'Run the checkout'), item({ itemId: B }, 'Blocker'))
    await expect(tasks(page, id).first().locator('button.workitem__key')).toHaveCount(1)
    await wsEval(page, (s, id) => s.updatePage(id, { settings: { ...s.pages[id].settings, locked: true } }), id)
    const first = tasks(page, id).first()
    await expect(first.locator('button')).toHaveCount(0)
    await expect(first.locator('.workitem__key')).toHaveAttribute('aria-label', /This page is locked/)
    // titles still from the index
    await expect(first.locator('.workitem__chip--dep')).toContainText('Blocker')
    await expect(first.locator('.workitem__ghosts')).toHaveCount(0)
  })

  test('stacking: consecutive tasks one plate (2 px); a task in a list item is compact (one line, avatars only)', async ({ page }) => {
    await openApp(page)
    const { mira } = await people(page)
    const id = await taskPage(
      page,
      'Stack page',
      item({ itemId: A }, 'One'),
      item({ itemId: B }, 'Two'),
      item({ itemId: C }, 'Three'),
      { type: 'bulletList', content: [{ type: 'listItem', content: [p('Prepare:'), item({ itemId: D, due: FAR, people: [mira] }, 'Screenshots'), item({ itemId: E, blockedBy: [A] }, 'Subject line')] }] },
    )
    const all = tasks(page, id)
    for (let i = 0; i < 2; i++) {
      const a = (await all.nth(i).boundingBox())!
      const b = (await all.nth(i + 1).boundingBox())!
      expect(Math.round(b.y - (a.y + a.height))).toBe(2)
    }
    const compact = all.nth(3)
    await expect(compact).toHaveAttribute('data-compact', '')
    await expect(compact.locator('.workitem__label')).toBeHidden()
    await expect(compact.locator('.workitem__chip--person')).toHaveAttribute('title', 'Mira')
    const box = (await compact.boundingBox())!
    const chip = (await compact.locator('.workitem__chip--due').boundingBox())!
    const title = (await titleOf(compact).boundingBox())!
    // one line: the chips beside the title
    expect(Math.abs(chip.y + chip.height / 2 - (title.y + title.height / 2))).toBeLessThan(8)
    expect(box.height).toBeLessThan(48)
    await expect(all.nth(4).locator('.workitem__chip--wait')).toContainText('Waiting for 1')
    await expect(all.nth(4).locator('.workitem__lock')).toHaveCount(0)
    // one line: date · waiting · faces (the avatars last)
    const last = await compact.locator('.workitem__chips > *:not(.visually-hidden)').last().getAttribute('class')
    expect(last).toContain('workitem__chip--person')
    // ⋯ on a compact row: with the pointer (or the caret / focus) only
    await page.mouse.move(5, 5)
    await expect(compact.locator('.workitem__more')).toHaveCSS('opacity', '0')
    await compact.hover()
    await expect(compact.locator('.workitem__more')).toHaveCSS('opacity', '1')
    await expect(all.nth(0).locator('.workitem__more')).toHaveCSS('opacity', '1')
  })

  test('a card preview (gallery) shows a task line like a to-do: ■ done / □ not done + its title, then its notes', async ({ page }) => {
    await openApp(page)
    const dbId = await wsEval(
      page,
      (s, rows) => {
        const id = s.createDatabase({ title: 'Launch tasks' })
        s.createRow(id, { title: 'Venue', content: rows })
        s.addView(id, { type: 'gallery', name: 'Gallery' })
        return id
      },
      doc(item({ itemId: A, status: 'done' }, 'Book the venue'), item({ itemId: B }, 'Send invites', p('Ask Mira for the list'))),
    )
    await gotoPage(page, dbId)
    const db = page.locator('#main section.db').first()
    await db.getByRole('tab').filter({ hasText: 'Gallery' }).click()
    const lines = db.locator('.dbc', { hasText: 'Venue' }).locator('.dbc-cover--text p')
    await expect(lines).toHaveText(['■ Book the venue', '□ Send invites', 'Ask Mira for the list'])
  })

  test('the creation gate shut: the slash item disabled with its reason, "[!] " stays text, Enter makes a note line, Mod+D copies plain blocks', async ({ page }) => {
    await openApp(page)
    const id = await taskPage(page, 'Gate page', item({ itemId: A }, 'Existing task'), p(''))
    await page.evaluate(() => (window as unknown as { __oneItems: { forceCanCreate: (v: boolean | null) => void } }).__oneItems.forceCanCreate(false))
    const ed = editorOf(page, id)
    await ed.locator('p').last().click()
    await page.keyboard.type('/task')
    const row = page.locator('.slash .slash__item').filter({ hasText: 'Task' }).first()
    await expect(row).toHaveAttribute('aria-disabled', 'true')
    await expect(row).toContainText('This server is older — update it to create tasks.')
    await page.keyboard.press('Enter')
    await expect(page.locator('.slash')).toBeVisible()
    await page.keyboard.press('Escape')
    for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace')
    await page.keyboard.type('[!] still text')
    await expect(ed.locator('p').last()).toHaveText('[!] still text')
    // Enter at the end of a title: a note line, no new task
    await caretInTitle(page, tasks(page, id).first())
    await page.keyboard.press('Enter')
    await page.keyboard.type('a note line')
    let list = await liveTasks(page, id)
    expect(list.length).toBe(1)
    expect(list[0].notes).toBe(1)
    // Mod+D: plain blocks (title + notes), a toast
    await caretInTitle(page, tasks(page, id).first())
    await page.keyboard.press(`${MOD}+d`)
    await expect(page.locator('.toast').filter({ hasText: 'This server is older — the copied task was kept as text.' })).toBeVisible()
    list = await liveTasks(page, id)
    expect(list.length).toBe(1)
    await expect(ed.getByText('Existing task', { exact: true })).toHaveCount(2)
    // Turn into no longer offers Task
    await ed.locator('p').last().click()
    await page.keyboard.press('Alt+Enter')
    await page.locator('[data-popover][role="menu"]').first().getByRole('menuitem', { name: 'Turn into', exact: true }).click()
    expect((await page.getByRole('menuitem').allTextContents()).some((x) => /^\s*Task\b/.test(x))).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* Phone, dark                                                         */
/* ------------------------------------------------------------------ */

test.describe('390 dark', () => {
  test.use({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', hasTouch: true, isMobile: true })

  test('chips wrap, every key ≥ 32 px; the open label hidden but TEMPLATE / DUPLICATE (+ NEW ID) shown; ghosts only on the caret task; ⋯ opens the menu', async ({ page }) => {
    await openApp(page)
    const { alex, sam } = await people(page)
    const id = await taskPage(
      page,
      'Phone page',
      item({ itemId: A, due: FAR, reminder: '-1d', people: [alex, sam] }, 'Run the checkout with test cards'),
      item({ itemId: B, status: 'in_progress', blockedBy: [A] }, 'Approve the final pricing copy for the new plans'),
      item({ itemId: A }, 'A copy with the same id'),
    )
    const all = tasks(page, id)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    // the duplicate shows after 1.5 s: DUPLICATE + NEW ID stay at 390
    const dup = all.nth(2)
    await expect(dup).toHaveAttribute('data-state', 'duplicate', { timeout: 5000 })
    await expect(dup.locator('.workitem__label')).toBeVisible()
    await expect(dup.locator('.workitem__state')).toHaveText('Duplicate')
    const newId = dup.getByRole('button', { name: 'New id' })
    await expect(newId).toBeVisible()
    const nb = (await newId.boundingBox())!
    expect(nb.height).toBeGreaterThanOrEqual(24)
    // the open label is hidden (the id too)
    await expect(all.nth(0).locator('.workitem__label')).toBeHidden()
    // the title's box never runs under ⋯
    for (let i = 0; i < 3; i++) {
      const tb = (await titleOf(all.nth(i)).boundingBox())!
      const mb = (await all.nth(i).locator('.workitem__more').boundingBox())!
      expect(tb.x + tb.width, `title ${i} ends before ⋯`).toBeLessThanOrEqual(mb.x + 1)
    }
    // keys and chips ≥ 32 px tall
    for (const sel of ['button.workitem__key', '.workitem__more', '.workitem__chip--due', '.workitem__chip--person']) {
      const b = (await all.nth(0).locator(sel).first().boundingBox())!
      expect(b.height, sel).toBeGreaterThanOrEqual(32)
    }
    // ghosts only on the task with the caret
    await expect(all.nth(1).locator('.workitem__chip--ghost').first()).toBeHidden()
    await titleOf(all.nth(1)).tap()
    await expect(all.nth(1).locator('.workitem__chip--ghost').first()).toBeVisible()
    await expect(all.nth(0).locator('.workitem__chip--ghost').first()).toBeHidden()
    // ⋯ by tap opens the task's menu
    await all.nth(0).locator('.workitem__more').tap()
    await page.waitForTimeout(500)
    await expect(page.locator('[data-popover][role="menu"]').first().getByRole('menuitem', { name: 'Due date…' })).toBeVisible()
    // nothing wider than the screen
    for (let i = 0; i < 3; i++) {
      const b = (await all.nth(i).boundingBox())!
      expect(b.x + b.width).toBeLessThanOrEqual(390)
    }
  })

  test('touch only: two tasks, status, due, people, a blocker — blocked; finishing the blocker unblocks with a toast; the device\'s undo takes each step back', async ({ page }) => {
    await openApp(page)
    const { alex } = await people(page)
    const id = await taskPage(page, 'Touch page', p(''), p(''))
    const ed = editorOf(page, id)
    /** the device's own undo / redo (shake, three fingers, the keyboard's key): an input event, no key press */
    const device = (type: 'historyUndo' | 'historyRedo') => page.evaluate(([id, type]) => document.querySelector(`.ProseMirror[data-page-id="${id}"]`)!.dispatchEvent(new InputEvent('beforeinput', { inputType: type, bubbles: true, cancelable: true })), [id, type] as const)
    const settle = () => page.waitForTimeout(500)
    // create: "[!] " on the first line, the slash menu on the second (the on-screen keyboard types)
    await ed.locator(':scope > p').first().tap()
    await page.keyboard.type('[!] Order the samples')
    await ed.locator(':scope > p').last().tap()
    await page.keyboard.type('/task')
    await page.locator('.slash .slash__item').filter({ hasText: 'Task' }).first().tap()
    await page.keyboard.type('Print the flyers')
    await expect.poll(async () => (await liveTasks(page, id)).map((x) => x.title)).toEqual(['Order the samples', 'Print the flyers'])
    const [first, second] = [tasks(page, id).nth(0), tasks(page, id).nth(1)]
    const firstId = (await liveTasks(page, id))[0].attrs.itemId as string
    const at = async () => (await liveTasks(page, id))[1].attrs
    // status: the key
    await second.locator('button.workitem__key').tap()
    await expect(second).toHaveAttribute('data-status', 'done')
    await device('historyUndo')
    await expect(second).toHaveAttribute('data-status', 'todo')
    // due: + DATE → Done (today)
    await titleOf(second).tap()
    await second.getByRole('button', { name: 'Date' }).tap()
    const due = page.getByRole('dialog', { name: 'Due date' })
    await expect(due).toBeVisible()
    await settle()
    await due.getByRole('button', { name: 'Done' }).tap()
    await expect(due).toBeHidden()
    await expect.poll(async () => (await at()).due).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    await device('historyUndo')
    await expect.poll(async () => (await at()).due ?? null).toBeNull()
    await device('historyRedo')
    await expect.poll(async () => (await at()).due).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // people: + PERSON → Alex → Done
    await settle()
    await titleOf(second).tap()
    await second.getByRole('button', { name: 'Person' }).tap()
    const assign = page.getByRole('dialog', { name: 'Assign' })
    await expect(assign).toBeVisible()
    await settle()
    await assign.getByRole('option', { name: 'Alex' }).tap()
    await assign.getByRole('button', { name: 'Done' }).tap()
    await expect(assign).toBeHidden()
    await expect.poll(async () => (await at()).people).toEqual([alex])
    await device('historyUndo')
    await expect.poll(async () => (await at()).people).toEqual([])
    await device('historyRedo')
    await expect.poll(async () => (await at()).people).toEqual([alex])
    // a blocker: + DEPENDS ON → the first task → Done
    await settle()
    await titleOf(second).tap()
    await second.getByRole('button', { name: 'Depends on' }).tap()
    const waits = page.getByRole('dialog', { name: 'Waits for' })
    await expect(waits).toBeVisible()
    await settle()
    await waits.getByRole('option', { name: /Order the samples/ }).tap()
    await waits.getByRole('button', { name: 'Done' }).tap()
    await expect(waits).toBeHidden()
    await expect(second).toHaveAttribute('data-state', 'blocked')
    await expect.poll(async () => (await at()).blockedBy).toEqual([firstId])
    await device('historyUndo')
    await expect(second).not.toHaveAttribute('data-state', 'blocked')
    await device('historyRedo')
    await expect(second).toHaveAttribute('data-state', 'blocked')
    // finish the blocker by its key: unblocked + the toast; the device's undo blocks again
    await settle()
    await first.locator('button.workitem__key').tap()
    await expect(first).toHaveAttribute('data-status', 'done')
    await expect(second).not.toHaveAttribute('data-state', 'blocked')
    await expect(page.locator('.toast').filter({ hasText: /Unblocked: Print the flyers/ })).toBeVisible()
    await device('historyUndo')
    await expect(first).toHaveAttribute('data-status', 'todo')
    await expect(second).toHaveAttribute('data-state', 'blocked')
  })

  test('XL text: IN PROGRESS goes below the title (the title keeps the row); at the standard size it stays beside it', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        if (!sessionStorage.getItem('xl-set')) {
          localStorage.setItem('one.textScale', '4')
          sessionStorage.setItem('xl-set', '1')
        }
      } catch {
        /* storage refused */
      }
    })
    await openApp(page)
    const id = await taskPage(page, 'XL page', item({ itemId: A, status: 'in_progress' }, 'Approve the final pricing copy'))
    const task = tasks(page, id).first()
    const label = task.locator('.workitem__label')
    await expect(label).toBeVisible()
    const tb = (await titleOf(task).boundingBox())!
    const lb = (await label.boundingBox())!
    expect(lb.y).toBeGreaterThanOrEqual(tb.y + tb.height - 2)
    expect(lb.x).toBeLessThan(tb.x + 4)
    // the standard size: beside the title
    await page.evaluate(() => localStorage.setItem('one.textScale', '1'))
    await page.reload()
    await expect(editorOf(page, id)).toBeVisible()
    const tb2 = (await titleOf(tasks(page, id).first()).boundingBox())!
    const lb2 = (await tasks(page, id).first().locator('.workitem__label').boundingBox())!
    expect(lb2.x).toBeGreaterThan(tb2.x + 40)
  })

  test('NEW ID re-mints the duplicate block only; a template page shows TEMPLATE · CREATED WHEN USED', async ({ page }) => {
    await openApp(page)
    const id = await taskPage(page, 'Dup page', item({ itemId: A }, 'Original'), item({ itemId: A }, 'Second block, same id'))
    const dup = tasks(page, id).nth(1)
    await expect(dup).toHaveAttribute('data-state', 'duplicate', { timeout: 5000 })
    await page.waitForTimeout(500)
    await dup.getByRole('button', { name: 'New id' }).tap()
    await expect.poll(async () => (await liveTasks(page, id)).map((x) => x.attrs.itemId)).not.toEqual([A, A])
    const ids = (await liveTasks(page, id)).map((x) => x.attrs.itemId)
    expect(ids[0]).toBe(A)
    expect(ids[1]).not.toBe(A)
    await expect(dup).not.toHaveAttribute('data-state', 'duplicate')
    // a template's task
    const tpl = await wsEval(page, (s) => {
      const root = s.createPage({ title: 'Template root' })
      s.updatePage(root, { template: { name: 'Template root' } })
      return root as string
    })
    await wsEval(page, (s, tpl) => s.setContent(tpl, { type: 'doc', content: [{ type: 'workItem', attrs: { itemId: 'wi_tplA000001', status: 'todo' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Template task' }] }] }] }, 'e2e'), tpl)
    await gotoPage(page, tpl)
    const t = tasks(page, tpl).first()
    await expect(t).toHaveAttribute('data-state', 'template')
    await expect(t.locator('.workitem__state')).toHaveText('Template · created when used')
    await expect(t.locator('.workitem__label')).toBeVisible()
  })
})
