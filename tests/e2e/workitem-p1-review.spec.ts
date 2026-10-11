/**
 * Task block P1 — the review round's regressions (one test per finding, fictional data; no real host):
 *  - Turn into ▸ Task / "[!] " / slash on a line holding tasks (the demo's "Launch plan" F and G): the tasks inside
 *    leave whole (ids, fields, links) and follow the new task — never flattened; the same for a block selection;
 *  - pickers: a value that arrives while one is open is never removed by an untouched Done; "Add" makes no person
 *    until the picker writes;
 *  - a task pasted INTO a synced reference is judged like any paste (a copy gets a new id — no duplicate);
 *  - Redo with instructions skips a block holding a task (and never rewrites one at Apply);
 *  - "@" field rows are their own undo step; "[!] " on an empty line then Backspace gives "[!] " back;
 *  - the agenda moves only the dragged entry of a duplicate (writeItems' `pageId`);
 *  - hover moves nothing (⌄ and ghost keys only with the caret); compact DUPLICATE / TEMPLATE keep their label;
 *  - a blocker card stays while the pointer is on its edge; ⋯ opens the menu at ⋯; a read-only waiting label;
 *    ghost keys say they open a dialog; a status change is announced; touch: focus never ends on the body;
 *  - coding: a plan / doc pages re-run keeps a person's tasks, a follow-up's copied tasks are new tasks.
 */
import type { Locator, Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, gotoPage, editorOf, createPage, wsEval, flush, pageIdByTitle, doc, para, MOD } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const A = 'wi_7f3a9c2d01'
const B = 'wi_1b2c3d4e5f'
const C = 'wi_9d8e7f6a5b'
const X = 'wi_4c1a2b3c4d'
const FAR = '2031-10-17'

const p = (text: string): JSONContent => para(text)
const item = (attrs: Record<string, unknown>, title: string, ...notes: JSONContent[]): JSONContent => ({ type: 'workItem', attrs: { status: 'todo', ...attrs }, content: [p(title), ...notes] })
const tasks = (page: Page, id: string): Locator => editorOf(page, id).locator('.workitem')
const titleOf = (task: Locator): Locator => task.locator('.workitem__body p').first()
const undo = (page: Page) => page.keyboard.press(`${MOD}+z`)

interface LiveTask {
  attrs: AnyState
  title: string
  /** the node types around it, outermost first (doc excluded) */
  path: string[]
}

/** The tasks of a page's live editor, document order, with where each sits. */
async function liveTasks(page: Page, id: string): Promise<LiveTask[]> {
  return page.evaluate((id) => {
    const el = document.querySelector(`.ProseMirror[data-page-id="${id}"]`) as unknown as { editor: { getJSON: () => any } } // eslint-disable-line @typescript-eslint/no-explicit-any
    const out: Array<{ attrs: Record<string, unknown>; title: string; path: string[] }> = []
    const text = (n: any): string => (n.text ?? '') + (n.content ?? []).map(text).join('') // eslint-disable-line @typescript-eslint/no-explicit-any
    const walk = (n: any, path: string[]) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (n.type === 'workItem') out.push({ attrs: n.attrs ?? {}, title: text(n.content?.[0] ?? {}), path })
      for (const c of n.content ?? []) walk(c, n.type === 'doc' ? [] : [...path, n.type])
    }
    walk(el.editor.getJSON(), [])
    return out
  }, id)
}

async function people(page: Page): Promise<{ alex: string; sam: string; mira: string }> {
  return wsEval(page, (s) => {
    const find = (n: string) => (s.people as AnyState[]).find((x) => x.name === n)?.id ?? s.addPerson(n)
    return { alex: find('Alex'), sam: find('Sam'), mira: find('Mira') }
  })
}

async function taskPage(page: Page, title: string, ...content: JSONContent[]): Promise<string> {
  const id = await createPage(page, { title, content: doc(...content) })
  await gotoPage(page, id)
  await expect(editorOf(page, id)).toBeVisible()
  return id
}

async function caretInTitle(page: Page, task: Locator): Promise<void> {
  await titleOf(task).click()
  await page.keyboard.press('End')
}

/** The caret in the textblock whose text is `text` (`at`: its start or end). */
async function caretAt(page: Page, id: string, text: string, at: 'start' | 'end'): Promise<void> {
  await page.evaluate(
    ({ id, text, at }) => {
      const el = document.querySelector(`.ProseMirror[data-page-id="${id}"]`) as any // eslint-disable-line @typescript-eslint/no-explicit-any
      let pos = -1
      el.editor.state.doc.descendants((n: any, p: number) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (pos < 0 && n.isTextblock && n.textContent === text) pos = at === 'start' ? p + 1 : p + n.nodeSize - 1
        return pos < 0
      })
      el.editor.commands.focus(pos)
    },
    { id, text, at },
  )
}

const turnMenu = async (page: Page) => {
  await page.keyboard.press('Alt+Enter')
  await page.locator('[data-popover][role="menu"]').first().getByRole('menuitem', { name: 'Turn into', exact: true }).click()
  await page.getByRole('menuitem', { name: /^Task/ }).click()
}

/* ------------------------------------------------------------------ */
/* Turning a line that holds tasks into a task                         */
/* ------------------------------------------------------------------ */

test.describe('turning a line that holds tasks into a task (the demo "Launch plan")', () => {
  const LINE = 'Prepare images and subject line:'
  const F = 'Screenshots of the new prices'
  const G = 'A/B test the subject line'

  async function launch(page: Page): Promise<{ id: string; f: LiveTask; g: LiveTask; count: number }> {
    await openApp(page)
    const id = await pageIdByTitle(page, 'Launch plan: new pricing page')
    await gotoPage(page, id)
    await expect(tasks(page, id)).toHaveCount(7)
    const list = await liveTasks(page, id)
    const f = list.find((x) => x.title === F)!
    const g = list.find((x) => x.title === G)!
    // the demo's shape: F and G are compact tasks in the list item "Prepare images …"
    expect(f.path).toEqual(['bulletList', 'listItem'])
    expect(g.attrs.blockedBy.length).toBe(1)
    return { id, f, g, count: list.length }
  }

  /** F and G kept whole (same id, due, people, links), right after the new task, outside it; the toast says so. */
  async function expectKept(page: Page, id: string, f: LiveTask, g: LiveTask, total = 8) {
    const list = await liveTasks(page, id)
    expect(list).toHaveLength(total)
    const i = list.findIndex((x) => x.title === LINE)
    expect(i).toBeGreaterThanOrEqual(0)
    expect(list[i].attrs.itemId).toMatch(/^wi_/)
    expect([list[i + 1].title, list[i + 2].title]).toEqual([F, G])
    for (const [now, was] of [
      [list[i + 1], f],
      [list[i + 2], g],
    ] as const) {
      expect(now.attrs.itemId).toBe(was.attrs.itemId)
      expect(now.attrs.due ?? null).toBe(was.attrs.due ?? null)
      expect(now.attrs.people).toEqual(was.attrs.people)
      expect(now.attrs.blockedBy).toEqual(was.attrs.blockedBy)
      expect(now.path).not.toContain('workItem')
    }
    await expect(page.locator('.toast').filter({ hasText: '2 tasks moved below' })).toBeVisible()
  }

  test('"[!] " at the start of the line, then one undo gives the line back', async ({ page, errors }) => {
    const { id, f, g, count } = await launch(page)
    await caretAt(page, id, LINE, 'start')
    await page.keyboard.type('[!] ')
    await expectKept(page, id, f, g)
    await undo(page)
    await expect.poll(async () => (await liveTasks(page, id)).length).toBe(count)
    expect((await liveTasks(page, id)).find((x) => x.title === F)!.path).toEqual(['bulletList', 'listItem'])
    expect(errors.list).toEqual([])
  })

  test('Alt+Enter → Turn into ▸ Task', async ({ page }) => {
    const { id, f, g } = await launch(page)
    await caretAt(page, id, LINE, 'end')
    await turnMenu(page)
    await expectKept(page, id, f, g)
  })

  test('slash /task at the start of the line', async ({ page }) => {
    const { id, f, g } = await launch(page)
    await caretAt(page, id, LINE, 'start')
    await page.keyboard.type('/task')
    await expect(page.locator('.slash .slash__name').first()).toHaveText('Task')
    await page.keyboard.press('Enter')
    await expectKept(page, id, f, g)
  })

  test('a block selection (the heading + the list) → Turn into ▸ Task: one task each, F and G kept after theirs (one undo)', async ({ page }) => {
    const { id, f, g } = await launch(page)
    await caretAt(page, id, 'For the newsletter', 'end')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Shift+ArrowDown')
    await expect(editorOf(page, id).locator('.is-block-selected')).toHaveCount(2)
    await turnMenu(page)
    await expectKept(page, id, f, g, 9)
    expect((await liveTasks(page, id)).map((x) => x.title)).toContain('For the newsletter')
    await undo(page)
    await expect.poll(async () => (await liveTasks(page, id)).length).toBe(7)
  })
})

/* ------------------------------------------------------------------ */
/* Pickers: what arrives meanwhile stays; Add makes nobody until Done  */
/* ------------------------------------------------------------------ */

test.describe('pickers', () => {
  test('a blocker / a person that arrives while the picker is open shows ticked and survives an untouched Done', async ({ page }) => {
    await openApp(page)
    const { alex, sam, mira } = await people(page)
    const id = await taskPage(page, 'Picker page', item({ id: 'blk-a', itemId: A, people: [alex, sam] }, 'Run the checkout'), item({ itemId: B }, 'Approve the copy'), item({ itemId: X }, 'Order the samples'))
    const task = tasks(page, id).first()
    const target = { pos: 0, itemId: A, blockId: 'blk-a' }
    const commit = (patch: AnyState) => page.evaluate(({ id, target, patch }) => (window as any).__oneItemsEditor.commit(id, target, patch), { id, target, patch }) // eslint-disable-line @typescript-eslint/no-explicit-any

    // Blocked by…: open, a member adds X meanwhile, Done untouched → X stays
    await caretInTitle(page, task)
    await page.keyboard.press('Alt+Enter')
    await page.locator('[data-popover][role="menu"]').first().getByRole('menuitem', { name: 'Blocked by…' }).click()
    const links = page.getByRole('dialog', { name: 'Waits for' })
    await expect(links).toBeVisible()
    expect(await commit({ blockedBy: { add: [X] } })).toBe(true)
    await expect(links.getByRole('option', { name: /Order the samples/ })).toHaveAttribute('aria-selected', 'true')
    await links.getByRole('button', { name: 'Done' }).click()
    await expect(links).toBeHidden()
    await expect.poll(async () => (await liveTasks(page, id))[0].attrs.blockedBy).toEqual([X])
    // a tick of the person's own is written, the arrival kept
    await caretInTitle(page, task)
    await page.keyboard.press('Alt+Enter')
    await page.locator('[data-popover][role="menu"]').first().getByRole('menuitem', { name: 'Blocked by…' }).click()
    await expect(links).toBeVisible()
    await links.getByRole('option', { name: /Approve the copy/ }).click()
    await links.getByRole('button', { name: 'Done' }).click()
    await expect.poll(async () => (await liveTasks(page, id))[0].attrs.blockedBy).toEqual([X, B])

    // Assign…: Mira arrives meanwhile, Done untouched → three people
    await caretInTitle(page, task)
    await page.keyboard.press('Alt+Enter')
    await page.locator('[data-popover][role="menu"]').first().getByRole('menuitem', { name: 'Assign…' }).click()
    const assign = page.getByRole('dialog', { name: 'Assign' })
    await expect(assign).toBeVisible()
    expect(await commit({ people: { add: [mira] } })).toBe(true)
    await expect(assign.getByRole('option', { name: 'Mira' })).toHaveAttribute('aria-selected', 'true')
    await assign.getByRole('button', { name: 'Done' }).click()
    await expect(assign).toBeHidden()
    await expect.poll(async () => (await liveTasks(page, id))[0].attrs.people).toEqual([alex, sam, mira])
  })

  test('people: "Add" ticks a new person — Esc makes nobody, Done makes and assigns them', async ({ page }) => {
    await openApp(page)
    const id = await taskPage(page, 'Add page', item({ itemId: A }, 'Run the checkout'))
    const task = tasks(page, id).first()
    const names = () => wsEval(page, (s) => (s.people as AnyState[]).map((x) => x.name as string))
    const before = await names()
    await caretInTitle(page, task)
    await task.getByRole('button', { name: 'Person' }).click()
    const assign = page.getByRole('dialog', { name: 'Assign' })
    await expect(assign).toBeVisible()
    await page.keyboard.type('Zed Typo')
    await page.keyboard.press('Enter')
    await expect(assign.getByRole('option', { name: 'Zed Typo' })).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Escape')
    await expect(assign).toBeHidden()
    expect(await names()).toEqual(before)
    expect((await liveTasks(page, id))[0].attrs.people ?? []).toEqual([])
    // Done: made now, assigned
    await caretInTitle(page, task)
    await task.getByRole('button', { name: 'Person' }).click()
    await expect(assign).toBeVisible()
    await page.keyboard.type('Noor')
    await page.keyboard.press('Enter')
    await assign.getByRole('button', { name: 'Done' }).click()
    await expect.poll(names).toEqual([...before, 'Noor'])
    const noor = await wsEval(page, (s) => (s.people as AnyState[]).find((x) => x.name === 'Noor')!.id as string)
    await expect.poll(async () => (await liveTasks(page, id))[0].attrs.people).toEqual([noor])
  })
})

/* ------------------------------------------------------------------ */
/* A paste into a synced reference                                     */
/* ------------------------------------------------------------------ */

const clip = (page: Page, id: string, type: 'copy' | 'paste', html = '') =>
  page.evaluate(
    ({ id, type, html }) => {
      const dom = document.querySelector(`.ProseMirror[data-page-id="${id}"]`)!
      const dt = new DataTransfer()
      if (html) {
        dt.setData('text/html', html)
        dt.setData('text/plain', 'task')
      }
      dom.dispatchEvent(new ClipboardEvent(type, { clipboardData: dt, bubbles: true, cancelable: true }))
      return dt.getData('text/html')
    },
    { id, type, html },
  )

test('a task copied INTO a synced reference gets a new id (no duplicate on two pages); the original keeps its own', async ({ page }) => {
  await openApp(page)
  const synced = (sourcePageId: string | null, ...content: JSONContent[]): JSONContent => ({ type: 'syncedBlock', attrs: { syncId: 'grp-review-01', sourcePageId }, content })
  const plan = await createPage(page, { title: 'Plan with a task', content: doc(item({ itemId: A, due: FAR }, 'Run the checkout'), p('Below')) })
  const policy = await createPage(page, { title: 'Policy', content: doc(p('Head'), synced(null, p('Shared line'))) })
  const copy = await createPage(page, { title: 'Synced copy', content: doc(p('Welcome'), synced(policy, p('Shared line'))) })
  await gotoPage(page, plan)
  await page.evaluate((id) => {
    const el = document.querySelector(`.ProseMirror[data-page-id="${id}"]`) as any // eslint-disable-line @typescript-eslint/no-explicit-any
    el.editor.commands.focus()
    el.editor.commands.setNodeSelection(0)
  }, plan)
  const html = await clip(page, plan, 'copy')
  await gotoPage(page, copy)
  await expect(editorOf(page, copy).locator('[data-type="synced-block"]')).toHaveAttribute('data-role', 'reference')
  await caretAt(page, copy, 'Shared line', 'end')
  await clip(page, copy, 'paste', html)
  const pasted = (await liveTasks(page, copy)).filter((x) => x.path.includes('syncedBlock'))
  expect(pasted).toHaveLength(1)
  expect(pasted[0].attrs.itemId).toMatch(/^wi_/)
  expect(pasted[0].attrs.itemId).not.toBe(A)
  await flush(page)
  // the original's page gets the new task through the service; nowhere a second task with A
  await expect.poll(() => page.evaluate((A) => (window as any).__oneItems.index().dups[A] ?? null, A), { timeout: 5000 }).toBeNull() // eslint-disable-line @typescript-eslint/no-explicit-any
  await expect.poll(() => page.evaluate((A) => (window as any).__oneItems.index().byId[A]?.pageId ?? null, A)).toBe(plan) // eslint-disable-line @typescript-eslint/no-explicit-any
})

/* ------------------------------------------------------------------ */
/* Redo with instructions                                              */
/* ------------------------------------------------------------------ */

test('Redo with instructions skips a list holding a task (the reason in words); the task survives Apply', async ({ page, context }) => {
  const prompts: string[] = []
  await context.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const body = JSON.parse(req.postData() ?? '{}')
    const prompt = String(body.messages?.[0]?.content ?? '')
    prompts.push(prompt)
    const items = [...prompt.matchAll(/<passage n="(\d+)">\n([\s\S]*?)\n<\/passage>/g)].map((m) => ({ n: Number(m[1]), markdown: `${m[2]} (redone)` }))
    await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ id: 'msg_e2e', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify({ items }) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }) })
  })
  await openApp(page)
  await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
  const list: JSONContent = { type: 'bulletList', content: [{ type: 'listItem', content: [p('Prepare the images:'), item({ itemId: A, due: FAR }, 'Screenshots of the prices')] }] }
  const id = await taskPage(page, 'Redo page', p('Alpha draft about the launch.'), list, p(''))
  const ed = editorOf(page, id)
  await ed.locator('p', { hasText: 'Alpha draft' }).hover()
  await page.getByRole('button', { name: 'Block menu' }).click()
  await page.getByRole('menuitem', { name: /Redo with instructions/ }).click()
  await expect(page.getByTestId('ctx-layer')).toBeVisible()
  await page.keyboard.press('j')
  await page.keyboard.press(' ')
  await page.keyboard.press('Enter')
  const card = page.getByTestId('redo-setup')
  await expect(card).toContainText(/1 passage · \d+ words · 1 skipped/i)
  await card.getByRole('textbox', { name: 'Instructions' }).fill('Shorter.')
  await card.getByTestId('redo-run').click()
  const review = page.getByTestId('redo-review')
  await expect(review).toBeVisible({ timeout: 15_000 })
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).not.toContain('[!TODO]')
  expect(prompts[0]).not.toContain(A)
  await page.keyboard.press('j')
  await expect(page.getByTestId('redo-state')).toHaveText('Skipped')
  await expect(review).toContainText('holds a task')
  await page.keyboard.press('k')
  await page.keyboard.press('y')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await liveTasks(page, id)).map((x) => x.attrs.itemId)).toEqual([A])
  expect((await liveTasks(page, id))[0].attrs.due).toBe(FAR)
})

/* ------------------------------------------------------------------ */
/* Undo steps: "@" rows, "[!] " on an empty line                       */
/* ------------------------------------------------------------------ */

test('"@" Assign row: one undo gives "@mi" back (the field gone), the next the title as it was', async ({ page }) => {
  await openApp(page)
  const { alex, mira } = await people(page)
  const id = await taskPage(page, 'At undo page', item({ itemId: A, people: [alex] }, 'Move the invoice template'))
  const task = tasks(page, id).first()
  await caretInTitle(page, task)
  await page.keyboard.type(' @mi', { delay: 10 })
  const menu = page.getByRole('listbox')
  await expect(menu.getByRole('option').first()).toHaveText(/Assign: Mira/)
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await liveTasks(page, id))[0].attrs.people).toEqual([alex, mira])
  expect((await liveTasks(page, id))[0].title).toBe('Move the invoice template')
  await undo(page)
  await expect.poll(async () => (await liveTasks(page, id))[0].attrs.people).toEqual([alex])
  expect((await liveTasks(page, id))[0].title).toBe('Move the invoice template @mi')
  await page.keyboard.press('Escape')
  await undo(page)
  await expect.poll(async () => (await liveTasks(page, id))[0].title).toBe('Move the invoice template')
})

test('"[!] " on an empty line, then Backspace: the rule is undone — the line reads "[!] "', async ({ page }) => {
  await openApp(page)
  const id = await taskPage(page, 'Rule page', p('Above'), p(''))
  const ed = editorOf(page, id)
  await ed.locator(':scope > p').last().click()
  await page.keyboard.type('[!] ')
  await expect(tasks(page, id)).toHaveCount(1)
  await page.keyboard.press('Backspace')
  await expect(tasks(page, id)).toHaveCount(0)
  // the typed line is back, the caret after it (an empty last line the editor added at the end may stay)
  const line = ed.locator(':scope > p').filter({ hasText: '[!]' })
  await expect(line).toHaveText('[!] ')
  await page.keyboard.type('Order')
  await expect(line).toHaveText('[!] Order')
})

/* ------------------------------------------------------------------ */
/* The agenda and a duplicate                                          */
/* ------------------------------------------------------------------ */

test('agenda: moving the entry of a duplicate on another page moves that occurrence only (Undo too)', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-14T10:00:00'))
  await openApp(page)
  const first = await createPage(page, { title: 'Pricing launch', content: doc(item({ id: 'b1', itemId: A, due: '2026-10-16' }, 'Print the flyers')) })
  const second = await createPage(page, { title: 'Pricing copy', content: doc(item({ id: 'b2', itemId: A, due: '2026-10-16' }, 'Print the flyers again')) })
  const dueOn = (id: string) => wsEval(page, (s, id) => (s.pages[id].content.content[0].attrs.due as string) ?? null, id)
  await flush(page)
  await expect.poll(() => page.evaluate((A) => (window as any).__oneItems.index().dups[A]?.length ?? 0, A)).toBe(2) // eslint-disable-line @typescript-eslint/no-explicit-any
  await page.evaluate(() => (window.location.hash = '#/agenda'))
  await expect(page.locator('.ag')).toBeVisible()
  // room on the 16th: the demo's other sources off
  for (const name of [/Projects/, /Content calendar/, /Meetings/, /Mentions/]) {
    const key = page.locator('.ag-sources').getByRole('button', { name })
    if (await key.count()) {
      await key.click()
      await expect(key).toHaveAttribute('aria-pressed', 'false')
    }
  }
  const bar = page.locator('.ag-month .ag-bar', { hasText: 'Print the flyers again' })
  await expect(bar).toHaveAttribute('data-start', '2026-10-16')
  const from = (await bar.boundingBox())!
  const to = (await page.locator('.ag-day[data-iso="2026-10-20"]').boundingBox())!
  await page.mouse.move(from.x + 12, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + 40, from.y + from.height / 2 + 10, { steps: 4 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height - 12, { steps: 12 })
  await page.mouse.up()
  await expect.poll(() => dueOn(second)).toBe('2026-10-20')
  expect(await dueOn(first)).toBe('2026-10-16')
  await page.locator('.toast', { hasText: 'moved to' }).getByRole('button', { name: 'Undo' }).click()
  await expect.poll(() => dueOn(second)).toBe('2026-10-16')
  expect(await dueOn(first)).toBe('2026-10-16')
})

/* ------------------------------------------------------------------ */
/* The placard at 1440                                                 */
/* ------------------------------------------------------------------ */

test.describe('the placard (1440)', () => {
  test('hover moves nothing: no ⌄, no ghost keys, the title and chips stay put; with the caret both show', async ({ page }) => {
    await openApp(page)
    const { alex } = await people(page)
    const id = await taskPage(page, 'Hover page', p('Above'), item({ itemId: A, due: FAR, people: [alex] }, 'Switch the pricing page live', p('A note')), p('Below'))
    const task = tasks(page, id).first()
    await editorOf(page, id).getByText('Below').click()
    const boxes = async () => ({ title: (await titleOf(task).boundingBox())!, chip: (await task.locator('.workitem__chip--due').boundingBox())!, plate: (await task.boundingBox())! })
    const before = await boxes()
    await titleOf(task).hover()
    await page.waitForTimeout(200)
    await expect(task.locator('.workitem__caret')).toBeHidden()
    await expect(task.locator('.workitem__chip--ghost').first()).toBeHidden()
    const during = await boxes()
    expect(during.title.x).toBe(before.title.x)
    expect(during.chip.x).toBe(before.chip.x)
    expect(during.plate.height).toBe(before.plate.height)
    // the caret in the task: ⌄ and the ghosts (the person is working in it)
    await caretInTitle(page, task)
    await expect(task.locator('.workitem__caret')).toBeVisible()
    await expect(task.locator('.workitem__chip--ghost').first()).toBeVisible()
  })

  test('compact duplicate: DUPLICATE + NEW ID stay reachable; a compact template task says TEMPLATE', async ({ page }) => {
    await openApp(page)
    const list: JSONContent = { type: 'bulletList', content: [{ type: 'listItem', content: [p('List:'), item({ id: 'blk-1', itemId: B }, 'Compact original'), item({ id: 'blk-2', itemId: B }, 'Compact duplicate')] }] }
    const id = await taskPage(page, 'Compact dup page', list)
    const dup = tasks(page, id).nth(1)
    await expect(dup).toHaveAttribute('data-compact', '')
    await expect(dup).toHaveAttribute('data-state', 'duplicate', { timeout: 5000 })
    await expect(dup.locator('.workitem__label')).toBeVisible()
    await expect(dup.locator('.workitem__state')).toHaveText('Duplicate')
    const newId = dup.getByRole('button', { name: 'New id' })
    await expect(newId).toBeVisible()
    await newId.click()
    await expect.poll(async () => (await liveTasks(page, id))[1].attrs.itemId).not.toBe(B)
    expect((await liveTasks(page, id))[0].attrs.itemId).toBe(B)
    // a template's compact task
    const tpl = await wsEval(page, (s) => {
      const root = s.createPage({ title: 'Template root' })
      s.updatePage(root, { template: { name: 'Template root' } })
      return root as string
    })
    await wsEval(page, (s, tpl) => s.setContent(tpl, { type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Steps:' }] }, { type: 'workItem', attrs: { itemId: 'wi_tplA000001', status: 'todo' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Template step' }] }] }] }] }] }, 'e2e'), tpl)
    await gotoPage(page, tpl)
    const t = tasks(page, tpl).first()
    await expect(t).toHaveAttribute('data-compact', '')
    await expect(t).toHaveAttribute('data-state', 'template')
    await expect(t.locator('.workitem__label')).toBeVisible()
    await expect(t.locator('.workitem__state')).toHaveText('Template · created when used')
  })

  test('a card the resting pointer opened stays while the pointer is on its edge; ⋯ opens the menu next to ⋯', async ({ page }) => {
    await openApp(page)
    const id = await taskPage(page, 'Card edge page', item({ itemId: A, blockedBy: [B] }, 'Switch the pricing page live'), item({ itemId: B }, 'Run the checkout with test cards'))
    const task = tasks(page, id).first()
    await task.locator('.workitem__chip--dep').first().hover()
    const card = page.locator('.wi-card')
    await expect(card).toBeVisible()
    await page.waitForTimeout(400) // the pop-in animation: measure the card where it rests
    const box = (await card.boundingBox())!
    // 5 px inside the card's left edge (its padding), then a rest longer than the 250 ms grace
    await page.mouse.move(box.x + 5, box.y + box.height / 2, { steps: 4 })
    await page.waitForTimeout(600)
    await expect(card).toBeVisible()
    await page.mouse.move(box.x + box.width + 120, box.y + box.height + 120, { steps: 4 })
    await expect(card).toBeHidden()
    // ⋯: the menu opens below ⋯, not at the gutter far left
    const more = task.locator('.workitem__more')
    const mb = (await more.boundingBox())!
    await more.click()
    const menu = page.locator('[data-popover][role="menu"]').first()
    await expect(menu.getByRole('menuitem', { name: 'Due date…' })).toBeVisible()
    await page.waitForTimeout(400) // the pop-in animation
    const nb = (await menu.boundingBox())!
    expect(Math.abs(nb.x + nb.width - (mb.x + mb.width))).toBeLessThanOrEqual(24)
    expect(nb.y).toBeGreaterThanOrEqual(mb.y + mb.height - 2)
    await page.keyboard.press('Escape')
  })

  test('words for screen readers: a status change is announced; a locked page\'s waiting label offers no change; ghosts say they open a dialog', async ({ page }) => {
    await openApp(page)
    const id = await taskPage(page, 'Words page', item({ itemId: A, blockedBy: [B] }, 'Switch the pricing page live'), item({ itemId: B }, 'Run the checkout with test cards'))
    const blocker = tasks(page, id).nth(1)
    await caretInTitle(page, blocker)
    await expect(blocker.getByRole('button', { name: 'Date' })).toHaveAttribute('aria-haspopup', 'dialog')
    await page.keyboard.press(`${MOD}+Enter`)
    await expect(blocker).toHaveAttribute('data-status', 'done')
    await expect(page.getByTestId('wi-announce')).toHaveText('Done: Run the checkout with test cards')
    await page.keyboard.press(`${MOD}+Alt+Enter`)
    await expect(page.getByTestId('wi-announce')).toHaveText('In progress: Run the checkout with test cards')
    // the page locked: the waiting label is a label, not an offer
    await wsEval(page, (s, id) => s.updatePage(id, { settings: { ...s.pages[id].settings, locked: true } }), id)
    const lbl = tasks(page, id).first().locator('.workitem__lbl')
    await expect(lbl).toHaveAttribute('aria-label', 'Waiting for')
  })
})

/* ------------------------------------------------------------------ */
/* Touch: focus after a picker                                         */
/* ------------------------------------------------------------------ */

test.describe('390 touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('a picker closed by Done: back in the title when the person was typing there, else the main region — never the body', async ({ page }) => {
    await openApp(page)
    const id = await taskPage(page, 'Touch focus page', item({ itemId: A }, 'Order the samples'))
    const task = tasks(page, id).first()
    const focused = () => page.evaluate(() => {
      const a = document.activeElement
      return a === document.body ? 'body' : a?.classList.contains('ProseMirror') ? 'editor' : (a?.matches('#main, .stage-col[tabindex], main[tabindex]') ? 'main' : a?.tagName ?? 'none')
    })
    // typing in the title → + DATE → Tomorrow → Done: the caret is back
    await titleOf(task).tap()
    expect(await focused()).toBe('editor')
    await task.getByRole('button', { name: 'Date' }).tap()
    const dialog = page.getByRole('dialog', { name: 'Due date' })
    await expect(dialog).toBeVisible()
    await page.waitForTimeout(500)
    await dialog.getByRole('button', { name: 'Done' }).tap()
    await expect(dialog).toBeHidden()
    await expect.poll(focused).toBe('editor')
    // not typing (nothing focused) → the chip → Done: the main region keeps the focus (no keyboard pulled up)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await task.locator('.workitem__chip--due').tap()
    await expect(dialog).toBeVisible()
    await page.waitForTimeout(500)
    await dialog.getByRole('button', { name: 'Done' }).tap()
    await expect(dialog).toBeHidden()
    await expect.poll(focused).toBe('main')
  })

  test('compact duplicate at 390: DUPLICATE + NEW ID shown and tappable', async ({ page }) => {
    await openApp(page)
    const list: JSONContent = { type: 'bulletList', content: [{ type: 'listItem', content: [p('List:'), item({ id: 'blk-1', itemId: C }, 'Compact original'), item({ id: 'blk-2', itemId: C }, 'Compact duplicate')] }] }
    const id = await taskPage(page, 'Compact dup phone', list)
    const dup = tasks(page, id).nth(1)
    await expect(dup).toHaveAttribute('data-state', 'duplicate', { timeout: 5000 })
    const newId = dup.getByRole('button', { name: 'New id' })
    await expect(newId).toBeVisible()
    expect((await newId.boundingBox())!.height).toBeGreaterThanOrEqual(24)
    await page.waitForTimeout(500)
    await newId.tap()
    await expect.poll(async () => (await liveTasks(page, id))[1].attrs.itemId).not.toBe(C)
  })
})

/* ------------------------------------------------------------------ */
/* Coding pipeline writes                                              */
/* ------------------------------------------------------------------ */

test('coding: a plan re-run and a doc pages re-run keep the tasks a person added; a follow-up\'s copied tasks are new tasks', async ({ page }) => {
  await openApp(page)
  // the seam (features/coding/tasks.ts, ?e2e): the page writes of a stage's output and a follow-up, no worker run
  const W = '__oneCodingWrites'
  const create = (title: string, kind: string) => page.evaluate(({ W, title, kind }) => (window as any)[W].create(title, kind) as Promise<string>, { W, title, kind }) // eslint-disable-line @typescript-eslint/no-explicit-any
  const writePlan = (id: string, md: string) => page.evaluate(({ W, id, md }) => void (window as any)[W].writePlan(id, md), { W, id, md }) // eslint-disable-line @typescript-eslint/no-explicit-any
  const docPages = (id: string, intro: string, body: string, known: string | null) =>
    page.evaluate(({ W, id, intro, body, known }) => (window as any)[W].docPages(id, 'Docs', intro, [{ title: 'Usage', body }], known) as { rootId: string; children: Array<{ id: string; title: string }> }, { W, id, intro, body, known }) // eslint-disable-line @typescript-eslint/no-explicit-any
  const followUp = (id: string, kind: string) => page.evaluate(({ W, id, kind }) => (window as any)[W].followUp(id, kind) as Promise<string | null>, { W, id, kind }) // eslint-disable-line @typescript-eslint/no-explicit-any
  const taskIds = (id: string) => wsEval(page, (s, id) => {
    const out: string[] = []
    const walk = (n: AnyState) => {
      if (n.type === 'workItem') out.push(n.attrs.itemId)
      ;(n.content ?? []).forEach(walk)
    }
    walk(s.pages[id]?.content ?? {})
    return out
  }, id)
  const append = (id: string, block: JSONContent) => wsEval(page, (s, { id, block }) => s.setContent(id, { type: 'doc', content: [...(s.pages[id].content?.content ?? []), block] }, 'e2e'), { id, block })

  // a plan; a person adds a task at the bottom (inside the Plan section); the plan is written again
  const id = await create('Rate limits', 'spec')
  await writePlan(id, '### Steps\n\nCheck the limits.')
  await append(id, item({ itemId: A, due: FAR }, 'Confirm the rate limit with Sam'))
  await append(id, item({ itemId: B, blockedBy: [A] }, 'Write the limits down'))
  await writePlan(id, '### Steps\n\nCheck the limits again.')
  expect(await taskIds(id)).toEqual([A, B])
  const plain = await wsEval(page, (s, id) => s.pages[id].plain as string, id)
  expect(plain).toContain('Check the limits again.')
  expect(plain).not.toMatch(/Check the limits\.(\n|$)/)

  // doc pages: a task added on a section page survives the re-run
  const made = await docPages(id, 'Intro', 'How to use it.', null)
  const usage = made.children[0].id
  await append(usage, item({ itemId: C }, 'Review the usage page'))
  await append(made.rootId, item({ itemId: X }, 'Read the docs once'))
  const again = await docPages(id, 'Intro again', 'How to use it, again.', made.rootId)
  expect(again.children[0].id).toBe(usage)
  expect(await taskIds(usage)).toEqual([C])
  expect(await taskIds(made.rootId)).toEqual([X])
  expect(await wsEval(page, (s, id) => s.pages[id].plain as string, usage)).toContain('How to use it, again.')

  // a follow-up (QA): the source's tasks are copies there — new ids, the link among them follows
  const qa = await followUp(id, 'qa')
  expect(qa).toBeTruthy()
  await flush(page)
  const copies = await wsEval(page, (s, qa) => {
    const out: Array<{ itemId: string; blockedBy: string[] }> = []
    const walk = (n: AnyState) => {
      if (n.type === 'workItem') out.push({ itemId: n.attrs.itemId, blockedBy: n.attrs.blockedBy ?? [] })
      ;(n.content ?? []).forEach(walk)
    }
    walk(s.pages[qa!]?.content ?? {})
    return out
  }, qa)
  expect(copies).toHaveLength(2)
  expect(copies.map((x) => x.itemId)).not.toContain(A)
  expect(copies.map((x) => x.itemId)).not.toContain(B)
  expect(copies[1].blockedBy).toEqual([copies[0].itemId])
  expect(await taskIds(id)).toEqual([A, B])
  await expect.poll(() => page.evaluate(() => Object.keys((window as any).__oneItems.index().dups).length)).toBe(0) // eslint-disable-line @typescript-eslint/no-explicit-any
})
