/**
 * Task block P1 — ItemIds: a copy gets a new itemId, a move keeps it. Paste / drop (the `workItemIds` plugin),
 * duplicate (Mod+D, grip, multi-select), page duplicate, templates (own, recurring, row / record type),
 * synced unsync, button templates, relink after a cut whose source store copy was stale, duplicates shown
 * (DUPLICATE · NEW ID) and never auto-fixed. Tasks are injected through the store (fictional data).
 */
import type { Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, gotoPage, editorOf, createPage, wsEval, flush, pageById, pageIdByTitle, doc, para } from './fixtures'
import { ITEM_ALPHABET, ITEM_ID, newItemId } from '../../src/app/lib/itemIds'

test.describe('newItemId (pure)', () => {
  test('100,000 ids: all distinct, all valid, the alphabet spelled out (≥ 60 distinct characters)', () => {
    expect(ITEM_ALPHABET).toHaveLength(64)
    expect(new Set(ITEM_ALPHABET).size).toBe(64)
    const ids = new Set<string>()
    const chars = new Set<string>()
    for (let i = 0; i < 100_000; i++) {
      const id = newItemId()
      ids.add(id)
      for (const ch of id.slice(3)) chars.add(ch)
    }
    expect(ids.size).toBe(100_000)
    expect(chars.size).toBeGreaterThanOrEqual(60)
    for (const id of ids) if (!ITEM_ID.test(id)) throw new Error(`invalid id ${id}`)
  })
})

/* ------------------------------------------------------------------ */
/* Store + feature copy paths (B4)                                     */
/* ------------------------------------------------------------------ */

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const A = 'wi_7f3a9c2d01'
const B = 'wi_1b2c3d4e5f'
const C = 'wi_9d8e7f6a5b'
const D = 'wi_4c1a2b3c4d'
const OUT = 'wi_0utside000'
const DUE = '2031-10-17'
const DONE_AT = 1_790_000_000_000

const p = (text: string): JSONContent => para(text)
const item = (attrs: Record<string, unknown>, title: string, ...notes: JSONContent[]): JSONContent => ({ type: 'workItem', attrs, content: [p(title), ...notes] })
const synced = (syncId: string, sourcePageId: string | null, ...content: JSONContent[]): JSONContent => ({ type: 'syncedBlock', attrs: { syncId, sourcePageId }, content })

interface Task {
  itemId: string
  title: string
  status: string
  due: string | null
  reminder: string | null
  doneAt: number | null
  people: string[]
  blockedBy: string[]
  related: string[]
  ref: boolean
}

/** The tasks of a JSON doc, document order (`ref`: inside a synced reference). */
function tasksOfDoc(d: JSONContent | null | undefined): Task[] {
  const out: Task[] = []
  const walk = (n: JSONContent, ref: boolean) => {
    if (n.type === 'workItem') {
      const a = (n.attrs ?? {}) as AnyState
      const title = (n.content?.[0]?.content ?? []).map((c: JSONContent) => c.text ?? '').join('')
      out.push({ itemId: a.itemId, title, status: a.status ?? 'todo', due: a.due ?? null, reminder: a.reminder ?? null, doneAt: a.doneAt ?? null, people: a.people ?? [], blockedBy: a.blockedBy ?? [], related: a.related ?? [], ref })
    }
    for (const c of n.content ?? []) walk(c, ref || (n.type === 'syncedBlock' && !!n.attrs?.sourcePageId))
  }
  if (d) walk(d, false)
  return out
}

const tasksOf = async (page: Page, id: string): Promise<Task[]> => tasksOfDoc((await pageById(page, id)).content)
const byTitle = (list: Task[], title: string) => {
  const t = list.find((x) => x.title === title)
  if (!t) throw new Error(`no task "${title}" in ${JSON.stringify(list.map((x) => x.title))}`)
  return t
}

async function people(page: Page): Promise<{ alex: string; sam: string }> {
  return wsEval(page, (s) => ({ alex: s.addPerson('Alex') as string, sam: s.addPerson('Sam') as string }))
}

async function templateIds(page: Page): Promise<string[]> {
  return wsEval(page, (s) => (Object.values(s.pages) as AnyState[]).filter((x) => x.template && !x.trashed).map((x) => x.id as string))
}

/** "Save as template…" from the page menu; returns the new template root. */
async function saveAsTemplate(page: Page, pageId: string): Promise<string> {
  await gotoPage(page, pageId)
  const before = await templateIds(page)
  await page.locator('.tb').getByRole('button', { name: 'Page options' }).click()
  await page.getByRole('menuitem', { name: 'Save as template…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Save as template' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Save template' }).click()
  await expect(dialog).toBeHidden()
  await expect.poll(async () => (await templateIds(page)).filter((x) => !before.includes(x)).length).toBe(1)
  await flush(page)
  return (await templateIds(page)).find((x) => !before.includes(x))!
}

/** Gallery → Mine → the card → Use template; the opened copy's id. */
async function useTemplate(page: Page, name: string): Promise<string> {
  await page.locator('.sb').getByRole('button', { name: /^Templates/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Templates' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('tab', { name: /^Mine/ }).click()
  await dialog.getByRole('option', { name: new RegExp(name) }).click()
  await dialog.locator('.tpl-preview').getByRole('button', { name: /Use template/ }).click()
  await expect(dialog).toBeHidden()
  await flush(page)
  const id = await page.evaluate(() => window.location.hash.match(/^#\/p\/([\w-]+)/)?.[1] ?? '')
  expect(id).not.toBe('')
  return id
}

/** The rows of a database (ids), newest first. */
const rowsNewestFirst = (page: Page, dbId: string) =>
  wsEval(page, (s, id) => (Object.values(s.pages) as AnyState[]).filter((x) => x.databaseId === id && !x.trashed).sort((a, b) => b.createdAt - a.createdAt).map((x) => x.id as string), dbId)

test.describe('copies re-mint task ids (store + features)', () => {
  test('page duplicate: new ids, links among the copy follow, links outside stay, fields kept', async ({ page }) => {
    await openApp(page)
    const { alex } = await people(page)
    const root = await createPage(page, {
      title: 'Launch plan',
      content: doc(
        item({ itemId: A, status: 'done', doneAt: DONE_AT, due: DUE, reminder: '-1d', people: [alex], blockedBy: [B, OUT] }, 'Draft copy'),
        item({ itemId: B, status: 'in_progress', related: [A] }, 'Ship pricing'),
      ),
    })
    const child = await createPage(page, { title: 'Launch notes', parentId: root, content: doc(item({ itemId: C, blockedBy: [A] }, 'Brief support')) })
    void child
    const copy = await wsEval(page, (s, id) => s.duplicatePage(id) as string, root)
    await flush(page)
    const tasks = await tasksOf(page, copy)
    const a = byTitle(tasks, 'Draft copy')
    const b = byTitle(tasks, 'Ship pricing')
    expect(a.itemId).toMatch(ITEM_ID)
    expect([a.itemId, b.itemId]).not.toContain(A)
    expect(b.itemId).not.toBe(B)
    expect(a.blockedBy).toEqual([b.itemId, OUT])
    expect(b.related).toEqual([a.itemId])
    expect(a).toMatchObject({ status: 'done', doneAt: DONE_AT, due: DUE, reminder: '-1d', people: [alex] })
    // the copied sub-page waits for the COPY of its parent's task
    const childCopy = await wsEval(page, (s, id) => (Object.values(s.pages) as AnyState[]).find((x) => x.parentId === id && !x.trashed)!.id as string, copy)
    const c = byTitle(await tasksOf(page, childCopy), 'Brief support')
    expect(c.itemId).not.toBe(C)
    expect(c.blockedBy).toEqual([a.itemId])
    // the original is untouched
    expect((await tasksOf(page, root)).map((x) => x.itemId)).toEqual([A, B])
  })

  test('save as template keeps the fields; Use template starts fresh; a synced group inside becomes a new group with new tasks', async ({ page }) => {
    await openApp(page)
    const { alex } = await people(page)
    const kit = await createPage(page, {
      title: 'Launch kit',
      content: doc(
        item({ itemId: A, status: 'done', doneAt: DONE_AT, due: DUE, reminder: '-1d', people: [alex], blockedBy: [B] }, 'Draft copy'),
        item({ itemId: B, status: 'in_progress', related: [OUT] }, 'Ship pricing'),
        synced('grp-kit-0001', null, item({ itemId: C, blockedBy: [A] }, 'Shared step')),
      ),
    })
    await createPage(page, { title: 'Kit notes', parentId: kit, content: doc(synced('grp-kit-0001', kit, item({ itemId: C, blockedBy: [A] }, 'Shared step')), item({ itemId: D, blockedBy: [A] }, 'Brief support')) })

    // Save as template: a copy — new ids, fields kept, links follow
    const tpl = await saveAsTemplate(page, kit)
    const tTasks = await tasksOf(page, tpl)
    const tA = byTitle(tTasks, 'Draft copy')
    const tB = byTitle(tTasks, 'Ship pricing')
    expect([tA.itemId, tB.itemId]).not.toContain(A)
    expect(tA).toMatchObject({ status: 'done', doneAt: DONE_AT, due: DUE, reminder: '-1d', blockedBy: [tB.itemId] })
    expect(tB.related).toEqual([OUT])

    // Use template: new ids again, started fresh — open, no done time, no due, no reminder; people + links stay
    const used = await useTemplate(page, 'Launch kit')
    const uTasks = await tasksOf(page, used)
    const uA = byTitle(uTasks, 'Draft copy')
    const uB = byTitle(uTasks, 'Ship pricing')
    const uC = byTitle(uTasks, 'Shared step')
    expect([uA.itemId, uB.itemId, uC.itemId]).not.toContain(tA.itemId)
    expect(uA).toMatchObject({ status: 'todo', doneAt: null, due: null, reminder: null, people: [alex], blockedBy: [uB.itemId] })
    expect(uB.status).toBe('todo')
    expect(uC.blockedBy).toEqual([uA.itemId])
    // the synced original inside → a new group; the reference inside follows the copied original's tasks
    const usedNotes = await wsEval(page, (s, id) => (Object.values(s.pages) as AnyState[]).find((x) => x.parentId === id && !x.trashed)!.id as string, used)
    const notes = await tasksOf(page, usedNotes)
    const ref = notes.find((x) => x.ref)!
    expect(ref.itemId).toBe(uC.itemId)
    expect(byTitle(notes, 'Brief support').blockedBy).toEqual([uA.itemId])
    const groups = await wsEval(page, (s, ids) => ids.map((id: string) => JSON.stringify(s.pages[id].content)).join(''), [used, usedNotes])
    expect(groups).not.toContain('grp-kit-0001')
    // the source page and the template are untouched
    expect((await tasksOf(page, kit)).map((x) => x.itemId)).toEqual([A, B, C])
  })

  test('row templates: From template (createEntry) and New ▾ re-mint once and start fresh; the template keeps its ids', async ({ page }) => {
    await openApp(page)
    const dbId = await pageIdByTitle(page, 'Meetings')
    await wsEval(
      page,
      (s, { dbId, task }) => {
        const tpl = s.databases[dbId].templates[0]
        s.updateDatabase(dbId, { templates: [{ ...tpl, content: { type: 'doc', content: [task] } }, ...s.databases[dbId].templates.slice(1)] })
      },
      { dbId, task: item({ itemId: A, status: 'done', doneAt: DONE_AT, due: DUE, reminder: 'at', blockedBy: [OUT] }, 'Send the notes') },
    )
    const tplName = await wsEval(page, (s, id) => s.databases[id].templates[0].name as string, dbId)
    // the sidebar's command key → From template ▸ (createEntry)
    const tree = page.locator('.sb section[aria-label="Pages"]')
    const row = tree.locator('.sb-row', { has: page.locator('.sb-row__title', { hasText: /^Meetings$/ }) })
    await row.hover()
    await row.getByTestId('tree-commands').click()
    await page.locator('.popover.cmd-menu').getByRole('menuitem', { name: 'From template' }).click()
    await page.locator('.popover').getByRole('menuitem', { name: tplName }).click()
    await flush(page)
    const [first] = await rowsNewestFirst(page, dbId)
    const one = await tasksOf(page, first)
    expect(one).toHaveLength(1)
    expect(one[0].itemId).toMatch(ITEM_ID)
    expect(one[0].itemId).not.toBe(A)
    expect(one[0]).toMatchObject({ status: 'todo', doneAt: null, due: null, reminder: null, blockedBy: [OUT] })
    // the view's New ▾ → the template
    await gotoPage(page, dbId)
    await page.locator('#main .db-newbtn__more').first().click()
    await page.locator('.db-tplmenu').getByRole('button', { name: tplName }).first().click()
    await flush(page)
    const [second] = await rowsNewestFirst(page, dbId)
    expect(second).not.toBe(first)
    const two = await tasksOf(page, second)
    expect(two).toHaveLength(1)
    expect([A, one[0].itemId]).not.toContain(two[0].itemId)
    expect(two[0].status).toBe('todo')
    // the template itself keeps its task as it was
    expect(tasksOfDoc(await wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.databases[id].templates[0].content)), dbId))[0]).toMatchObject({ itemId: A, status: 'done' })
  })

  test('record type row: the type body becomes the row\'s own new tasks; recurring rows too', async ({ page }) => {
    await openApp(page)
    const dbId = await pageIdByTitle(page, 'Meetings')
    await wsEval(
      page,
      (s, { dbId, task }) => {
        s.upsertRecordType({ id: 'brief', name: 'Brief', properties: [], content: { type: 'doc', content: [task] }, createdAt: 1, updatedAt: 1 })
        s.attachRecordType(dbId, 'brief')
      },
      { dbId, task: item({ itemId: B, status: 'in_progress', due: DUE, reminder: '-1d' }, 'Collect the agenda') },
    )
    await gotoPage(page, dbId)
    await page.locator('#main .db-newbtn__more').first().click()
    await page.getByTestId('new-of-type-brief').click()
    await flush(page)
    const [row] = await rowsNewestFirst(page, dbId)
    const tasks = await tasksOf(page, row)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].itemId).not.toBe(B)
    expect(tasks[0]).toMatchObject({ title: 'Collect the agenda', status: 'todo', due: null, reminder: null })

    // a recurring row template: every occurrence's tasks are new ones
    const now = Date.now()
    const day = new Date(now - 86_400_000)
    const start = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    await wsEval(
      page,
      (s, { dbId, task, start, last }) => {
        for (const d of Object.values(s.databases) as AnyState[]) if (d.templates?.some((t: AnyState) => t.repeat)) s.updateDatabase(d.id, { templates: d.templates.map(({ repeat: _r, ...t }: AnyState) => t) })
        s.updateDatabase(dbId, { templates: [{ id: 'tDaily', name: 'Daily check', icon: null, content: { type: 'doc', content: [task] }, properties: {}, repeat: { freq: 'daily', time: '00:01', start, lastRunAt: last } }] })
      },
      { dbId, task: item({ itemId: C, status: 'done', doneAt: DONE_AT }, 'Check the inbox'), start, last: now - 2 * 86_400_000 },
    )
    const made = await page.evaluate(() => (window as any).__oneRecurring.run().flatMap((n: AnyState) => n.rows.map((r: AnyState) => r.id)))
    expect(made.length).toBeGreaterThan(0)
    const ids = new Set<string>()
    for (const id of made) for (const t of await tasksOf(page, id)) {
      expect(t.itemId).not.toBe(C)
      expect(t.status).toBe('todo')
      ids.add(t.itemId)
    }
    expect(ids.size).toBe(made.length)
  })

  test('button templates hold no task: inserting one gives plain blocks; saving the configuration unwraps it', async ({ page }) => {
    await openApp(page)
    const template = [item({ itemId: A, status: 'done', doneAt: DONE_AT }, 'Review the copy', p('A note line'))]
    const id = await createPage(page, { title: 'Button lab', content: doc(p('Start'), { type: 'button', attrs: { label: 'Add review', variant: 'ink', actions: [{ id: 'i1', type: 'insert_blocks', content: template }] } }) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.getByRole('button', { name: 'Add review', exact: true }).click()
    await expect(ed.locator('p', { hasText: 'Review the copy' })).toHaveCount(1)
    await flush(page)
    expect(await tasksOf(page, id)).toEqual([])
    expect(await wsEval(page, (s, id) => s.pages[id].plain as string, id)).toContain('A note line')
    // the configuration saved (Done): the stored template is plain blocks
    await ed.locator(':is(.node-button, :has(> .ob)) + p').first().click()
    await page.keyboard.press('ArrowUp')
    await expect(ed.locator('.ob.is-selected')).toHaveCount(1)
    await page.keyboard.press('Shift+Enter')
    const dialog = page.getByRole('dialog', { name: 'Configure button' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toBeHidden()
    await flush(page)
    const stored = await wsEval(page, (s, id) => JSON.stringify((s.pages[id].content.content as AnyState[]).find((n) => n.type === 'button').attrs.actions), id)
    expect(stored).not.toContain('workItem')
    expect(stored).toContain('Review the copy')
  })

  test('synced: Unsync on a reference re-mints its tasks (the original keeps them); Unsync all does the same on other pages', async ({ page }) => {
    await openApp(page)
    const group = () => [item({ itemId: A, blockedBy: [B] }, 'Shared draft'), item({ itemId: B }, 'Shared review')]
    const src = await createPage(page, { title: 'Policy', content: doc(p('Head'), synced('grp-unsync-01', null, ...group())) })
    const b = await createPage(page, { title: 'Handbook', content: doc(p('Welcome'), synced('grp-unsync-01', src, ...group())) })
    const c = await createPage(page, { title: 'Onboarding', content: doc(p('Hello'), synced('grp-unsync-01', src, ...group())) })
    await gotoPage(page, b)
    const ref = editorOf(page, b).locator('[data-type="synced-block"]')
    await expect(ref).toHaveAttribute('data-role', 'reference')
    await ref.locator('.synced__tag').click()
    await page.getByRole('menuitem', { name: 'Unsync' }).click()
    await expect(editorOf(page, b).locator('[data-type="synced-block"]')).toHaveCount(0)
    await flush(page)
    const bt = await tasksOf(page, b)
    expect(bt).toHaveLength(2)
    expect(bt.map((t) => t.itemId)).not.toContain(A)
    expect(bt.map((t) => t.itemId)).not.toContain(B)
    expect(byTitle(bt, 'Shared draft').blockedBy).toEqual([byTitle(bt, 'Shared review').itemId])
    expect((await tasksOf(page, src)).map((t) => t.itemId)).toEqual([A, B])

    // Unsync all on the original: page C's copy becomes plain blocks with new tasks, the original keeps its ids
    await gotoPage(page, src)
    const orig = editorOf(page, src).locator('[data-type="synced-block"]')
    await orig.locator('.synced__tag').click()
    await page.getByRole('menuitem', { name: 'Unsync all' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Unsync all' }).click()
    await expect(orig).toHaveCount(0)
    await flush(page)
    expect((await tasksOf(page, src)).map((t) => t.itemId)).toEqual([A, B])
    const ct = await tasksOf(page, c)
    expect(ct).toHaveLength(2)
    expect(ct.map((t) => t.itemId)).not.toContain(A)
    expect(ct.some((t) => t.ref)).toBe(false)
    expect(byTitle(ct, 'Shared draft').blockedBy).toEqual([byTitle(ct, 'Shared review').itemId])
    expect(new Set([...bt, ...ct].map((t) => t.itemId)).size).toBe(4)
  })
})
