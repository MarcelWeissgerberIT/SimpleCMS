/**
 * Task block P1 — ItemIds: a copy gets a new itemId, a move keeps it. Paste / drop (the `workItemIds` plugin),
 * duplicate (Mod+D, grip, multi-select), page duplicate, templates (own, recurring, row / record type),
 * synced unsync, button templates, relink after a cut whose source store copy was stale, duplicates shown
 * (DUPLICATE · NEW ID) and never auto-fixed. Tasks are injected through the store (fictional data).
 */
import type { Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, gotoPage, editorOf, createPage, wsEval, uiEval, flush, pageById, pageIdByTitle, doc, para, MOD } from './fixtures'
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

/* ------------------------------------------------------------------ */
/* Paste / drop / duplicate in the editor (B5)                         */
/* ------------------------------------------------------------------ */

type Counters = { remints: number; relinks: number }
const counters = (page: Page): Promise<Counters> => page.evaluate(() => ({ remints: (window as any).__oneItems.remints, relinks: (window as any).__oneItems.relinks }))

/** The tasks of a page's LIVE editor (document order). */
const editorTasks = (page: Page, id: string): Promise<Task[]> =>
  page.evaluate((id) => {
    const el = document.querySelector(`.ProseMirror[data-page-id="${id}"]`) as any
    const out: any[] = []
    el.editor.state.doc.descendants((n: any, pos: number, parent: any) => {
      if (n.type.name === 'workItem') out.push({ itemId: n.attrs.itemId, title: n.firstChild?.textContent ?? '', status: n.attrs.status, blockedBy: n.attrs.blockedBy, related: n.attrs.related, people: n.attrs.people, due: n.attrs.due, reminder: n.attrs.reminder, doneAt: n.attrs.doneAt, ref: false, pos, parent: parent.type.name })
      return !n.isTextblock
    })
    return out
  }, id)

/** NodeSelection on the first task with this title. */
async function selectTaskNode(page: Page, id: string, title: string): Promise<void> {
  await page.evaluate(
    ({ id, title }) => {
      const el = document.querySelector(`.ProseMirror[data-page-id="${id}"]`) as any
      let at = -1
      el.editor.state.doc.descendants((n: any, pos: number) => {
        if (at < 0 && n.type.name === 'workItem' && n.firstChild?.textContent === title) at = pos
        return at < 0
      })
      el.editor.commands.focus()
      el.editor.commands.setNodeSelection(at)
    },
    { id, title },
  )
}

/** The caret at the end of the first paragraph whose text is `text`. */
async function caretAtEndOf(page: Page, id: string, text: string): Promise<void> {
  await page.evaluate(
    ({ id, text }) => {
      const el = document.querySelector(`.ProseMirror[data-page-id="${id}"]`) as any
      let at = -1
      el.editor.state.doc.descendants((n: any, pos: number) => {
        if (at < 0 && n.isTextblock && n.textContent === text) at = pos + n.nodeSize - 1
        return at < 0
      })
      el.editor.commands.focus(at)
    },
    { id, text },
  )
}

/** A synthetic clipboard event on a page's editor (copy / cut write the editor's HTML, paste reads `html`). */
const clip = (page: Page, id: string, type: 'copy' | 'cut' | 'paste', html = '') =>
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

test.describe('paste, drop, duplicate: copy = new id, move = same id', () => {
  test('copy + paste on the same page: new ids, links among the pasted pair follow, links out stay', async ({ page, errors }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Launch plan', content: doc(item({ itemId: A, blockedBy: [B, OUT] }, 'Draft copy'), item({ itemId: B, related: [A] }, 'Ship pricing'), p('Paste here')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await expect(ed.locator('[data-type="work-item"]')).toHaveCount(2)
    const c0 = await counters(page)
    // the two tasks as a block selection: Esc on the title selects the task (not its title line), Shift+↓ the next
    await ed.locator('[data-type="work-item"] p', { hasText: 'Draft copy' }).click()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Shift+ArrowDown')
    await expect(ed.locator('.is-block-selected')).toHaveCount(2)
    const html = await clip(page, id, 'copy')
    expect(html).toContain('data-one-clip')
    await caretAtEndOf(page, id, 'Paste here')
    await page.keyboard.press('Enter')
    await clip(page, id, 'paste', html)
    await expect(ed.locator('[data-type="work-item"]')).toHaveCount(4)
    const tasks = await editorTasks(page, id)
    const [a, b, a2, b2] = tasks
    expect([a.itemId, b.itemId]).toEqual([A, B])
    expect([a2.itemId, b2.itemId]).not.toContain(A)
    expect(b2.itemId).not.toBe(B)
    expect(a2.itemId).toMatch(ITEM_ID)
    expect(a2.blockedBy).toEqual([b2.itemId, OUT])
    expect(b2.related).toEqual([a2.itemId])
    expect((await counters(page)).remints - c0.remints).toBe(2)
    // one undo takes the paste (and its new ids) back
    await page.keyboard.press(`${MOD}+z`)
    await expect(ed.locator('[data-type="work-item"]')).toHaveCount(2)
    expect(errors.list).toEqual([])
  })

  test('cut + paste on the same page, and to another page after the store caught up: the same id; a dependent still resolves', async ({ page }) => {
    await openApp(page)
    const one = await createPage(page, { title: 'Launch plan', content: doc(item({ itemId: A }, 'Draft copy'), p('Bottom line')) })
    const two = await createPage(page, { title: 'Pricing page', content: doc(p('Top of pricing')) })
    await createPage(page, { title: 'Support', content: doc(item({ itemId: C, blockedBy: [A] }, 'Brief support')) })
    await gotoPage(page, one)
    const c0 = await counters(page)
    await selectTaskNode(page, one, 'Draft copy')
    const html = await clip(page, one, 'cut')
    await caretAtEndOf(page, one, 'Bottom line')
    await page.keyboard.press('Enter')
    await clip(page, one, 'paste', html)
    expect((await editorTasks(page, one)).map((t) => t.itemId)).toEqual([A])
    // to another page once this page's store copy no longer holds it
    await selectTaskNode(page, one, 'Draft copy')
    const html2 = await clip(page, one, 'cut')
    await flush(page)
    await gotoPage(page, two)
    await caretAtEndOf(page, two, 'Top of pricing')
    await page.keyboard.press('Enter')
    await clip(page, two, 'paste', html2)
    expect((await editorTasks(page, two)).map((t) => t.itemId)).toEqual([A])
    expect((await counters(page)).remints).toBe(c0.remints)
    await flush(page)
    await expect.poll(() => page.evaluate((A) => (window as any).__oneItems.index().byId[A]?.pageId ?? null, A)).toBe(two)
  })

  test('copy to another page: a new id; a cut pasted while the source page\'s store copy is stale is re-minted, then linked back', async ({ page }) => {
    await openApp(page)
    const one = await createPage(page, { title: 'Launch plan', content: doc(item({ itemId: A }, 'Draft copy'), item({ itemId: B, blockedBy: [A] }, 'Ship pricing'), p('Bottom line')) })
    const two = await createPage(page, { title: 'Pricing page', content: doc(p('Top of pricing')) })
    await gotoPage(page, one)
    await uiEval(page, (s, id) => s.openPane(id), two)
    await expect(editorOf(page, two)).toBeVisible()
    // copy (the source keeps it): a new id there
    await selectTaskNode(page, one, 'Draft copy')
    const copied = await clip(page, one, 'copy')
    await caretAtEndOf(page, two, 'Top of pricing')
    await clip(page, two, 'paste', copied)
    const pasted = await editorTasks(page, two)
    expect(pasted).toHaveLength(1)
    expect(pasted[0].itemId).not.toBe(A)
    // a cut, pasted at once into the pane (the source keeps focus: its store copy still holds the task — no blur
    // flush): re-minted first, linked back within seconds once the source's store copy no longer holds it
    await flush(page)
    const c0 = await counters(page)
    await selectTaskNode(page, one, 'Ship pricing')
    await page.evaluate(
      ({ one, two }) => {
        const src = document.querySelector(`.ProseMirror[data-page-id="${one}"]`) as any
        const dst = document.querySelector(`.ProseMirror[data-page-id="${two}"]`) as any
        const dt = new DataTransfer()
        src.dispatchEvent(new ClipboardEvent('cut', { clipboardData: dt, bubbles: true, cancelable: true }))
        let at = -1
        dst.editor.state.doc.descendants((n: any, pos: number) => {
          if (at < 0 && n.isTextblock && n.textContent === 'Top of pricing') at = pos + n.nodeSize - 1
          return at < 0
        })
        dst.editor.commands.setTextSelection(at)
        const paste = new DataTransfer()
        paste.setData('text/html', dt.getData('text/html'))
        paste.setData('text/plain', 'task')
        dst.dispatchEvent(new ClipboardEvent('paste', { clipboardData: paste, bubbles: true, cancelable: true }))
      },
      { one, two },
    )
    expect((await counters(page)).remints).toBe(c0.remints + 1)
    expect((await editorTasks(page, two)).map((t) => t.itemId)).not.toContain(B)
    await expect.poll(async () => (await counters(page)).relinks, { timeout: 6000 }).toBe(c0.relinks + 1)
    expect((await editorTasks(page, two)).map((t) => t.itemId)).toContain(B)
    expect((await editorTasks(page, two)).find((t) => t.itemId === B)!.blockedBy).toEqual([A])
  })

  test('drop: a copy (Ctrl) gets a new id and the original stays; a drag by the grip moves the task with its id', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Launch plan', content: doc(item({ itemId: A }, 'Draft copy'), p('Middle line'), p('Bottom line')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await selectTaskNode(page, id, 'Draft copy')
    const html = await clip(page, id, 'copy')
    const box = (await ed.locator('p', { hasText: 'Bottom line' }).boundingBox())!
    await page.evaluate(
      ({ id, html, x, y }) => {
        const dom = document.querySelector(`.ProseMirror[data-page-id="${id}"]`)!
        const dt = new DataTransfer()
        dt.setData('text/html', html)
        dt.setData('text/plain', 'task')
        dom.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: x, clientY: y, ctrlKey: true, bubbles: true, cancelable: true }))
      },
      { id, html, x: box.x + box.width - 4, y: box.y + box.height / 2 },
    )
    await expect(ed.locator('[data-type="work-item"]')).toHaveCount(2)
    const ids = (await editorTasks(page, id)).map((t) => t.itemId)
    expect(ids[0]).toBe(A)
    expect(ids[1]).not.toBe(A)
    // drag the first task by its grip below the bottom line: a move
    const title = ed.locator('[data-type="work-item"] p', { hasText: 'Draft copy' }).first()
    await title.hover()
    const grip = page.locator('.block-handle__grip')
    await expect(grip).toBeVisible()
    const g = (await grip.boundingBox())!
    const target = (await ed.locator('p', { hasText: 'Bottom line' }).boundingBox())!
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
    await page.mouse.down()
    await page.mouse.move(g.x + g.width / 2, g.y + 14, { steps: 4 })
    await page.mouse.move(target.x + 40, target.y + target.height - 2, { steps: 15 })
    await page.mouse.up()
    // moved: no longer the first block, still the one task with its id (and the copy keeps its own)
    await expect(ed.locator(':scope > *').first()).toHaveText('Middle line')
    const after = await editorTasks(page, id)
    expect(after.map((t) => t.itemId).sort()).toEqual([A, ids[1]].sort())
  })

  test('Mod+D, the grip\'s Duplicate and a block selection\'s Duplicate re-mint (links among the copies follow); with the gate shut the copy is plain text', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Launch plan', content: doc(item({ itemId: A, blockedBy: [B] }, 'Draft copy'), item({ itemId: B }, 'Ship pricing'), p('Bottom line')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    // Mod+D with the caret in a title: the task (not its title line) is duplicated
    await ed.locator('[data-type="work-item"] p', { hasText: 'Ship pricing' }).click()
    await page.keyboard.press(`${MOD}+d`)
    await expect(ed.locator('[data-type="work-item"]')).toHaveCount(3)
    let tasks = await editorTasks(page, id)
    expect(tasks.map((t) => t.title)).toEqual(['Draft copy', 'Ship pricing', 'Ship pricing'])
    expect(tasks[2].itemId).not.toBe(B)
    expect(tasks[2].itemId).toMatch(ITEM_ID)
    // a block selection of both originals → Duplicate: one map — the copy of A waits for the copy of B
    await ed.locator('[data-type="work-item"] p', { hasText: 'Draft copy' }).click()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Shift+ArrowDown')
    await expect(ed.locator('.is-block-selected')).toHaveCount(2)
    await page.keyboard.press(`${MOD}+d`)
    await expect(ed.locator('[data-type="work-item"]')).toHaveCount(5)
    tasks = await editorTasks(page, id)
    const copyA = tasks[2]
    const copyB = tasks[3]
    expect(copyA.title).toBe('Draft copy')
    expect(copyA.itemId).not.toBe(A)
    expect(copyA.blockedBy).toEqual([copyB.itemId])
    // the gate shut: Mod+D copies the task's title + notes as plain blocks (toast)
    await page.evaluate(() => (window as any).__oneItems.forceCanCreate(false))
    await ed.locator('[data-type="work-item"] p', { hasText: 'Draft copy' }).first().click()
    await page.keyboard.press(`${MOD}+d`)
    await expect(page.getByText('This server is older — the copied task was kept as text.')).toBeVisible()
    await expect(ed.locator('[data-type="work-item"]')).toHaveCount(5)
    await expect(ed.locator(':scope > p', { hasText: 'Draft copy' })).toHaveCount(1)
    await page.evaluate(() => (window as any).__oneItems.forceCanCreate(null))
  })

  test('a pasted copy is unwrapped while the gate is shut; a cut + paste still moves the task', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Launch plan', content: doc(item({ itemId: A, status: 'in_progress' }, 'Draft copy', p('A note')), p('Bottom line')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await page.evaluate(() => (window as any).__oneItems.forceCanCreate(false))
    await selectTaskNode(page, id, 'Draft copy')
    const html = await clip(page, id, 'copy')
    await caretAtEndOf(page, id, 'Bottom line')
    await page.keyboard.press('Enter')
    await clip(page, id, 'paste', html)
    await expect(page.getByText('This server is older — the copied task was kept as text.')).toBeVisible()
    expect((await editorTasks(page, id)).map((t) => t.itemId)).toEqual([A])
    await expect(ed.locator(':scope > p', { hasText: 'Draft copy' })).toHaveCount(1)
    await expect(ed.locator(':scope > p', { hasText: 'A note' })).toHaveCount(1)
    // a move is never refused
    await selectTaskNode(page, id, 'Draft copy')
    const cut = await clip(page, id, 'cut')
    await caretAtEndOf(page, id, 'A note')
    await clip(page, id, 'paste', cut)
    expect((await editorTasks(page, id)).map((t) => [t.itemId, t.status])).toEqual([[A, 'in_progress']])
    await page.evaluate(() => (window as any).__oneItems.forceCanCreate(null))
  })

  test('two blocks with one itemId on a page: a write targets the block acted on (pos → block id → nothing), never the first by id; external content is never re-minted', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Launch plan', content: doc(p('Intro'), item({ id: 'blk-1', itemId: A }, 'First copy'), item({ id: 'blk-2', itemId: A }, 'Second copy')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await expect(ed.locator('[data-type="work-item"]')).toHaveCount(2)
    const c0 = await counters(page)
    const second = (await editorTasks(page, id))[1]
    const commit = (target: unknown, patch: unknown) => page.evaluate(({ id, target, patch }) => (window as any).__oneItemsEditor.commit(id, target, patch), { id, target, patch })
    expect(await commit({ pos: second.pos, itemId: A, blockId: 'blk-2' }, { status: 'done' })).toBe(true)
    let tasks = await editorTasks(page, id)
    expect(tasks.map((t) => t.status)).toEqual(['todo', 'done'])
    // the pos went stale (a line typed above): the block id finds it
    await caretAtEndOf(page, id, 'Intro')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Another line')
    expect(await commit({ pos: second.pos, itemId: A, blockId: 'blk-2' }, { status: 'in_progress' })).toBe(true)
    tasks = await editorTasks(page, id)
    expect(tasks.map((t) => t.status)).toEqual(['todo', 'in_progress'])
    // neither the pos nor the block id: nothing written (never "the first block with this id")
    expect(await commit({ pos: 1, itemId: A, blockId: 'blk-gone' }, { status: 'done' })).toBe(false)
    await expect(page.getByText('That task is no longer here.')).toBeVisible()
    expect((await editorTasks(page, id)).map((t) => t.status)).toEqual(['todo', 'in_progress'])
    // external content (the store written while the editor is open) with two blocks of one id: shown as is
    await wsEval(page, (s, { id, doc }) => s.setContent(id, doc, 'e2e'), { id, doc: doc(item({ itemId: B }, 'One'), item({ itemId: B }, 'Two')) })
    await expect.poll(async () => (await editorTasks(page, id)).map((t) => t.itemId)).toEqual([B, B])
    expect((await counters(page)).remints).toBe(c0.remints)
  })

  test('grip over a title: the task is the target (Delete removes it whole); compact tasks: Alt+Enter and Mod+D act on the task, not the list item', async ({ page }) => {
    await openApp(page)
    const list = { type: 'bulletList', content: [{ type: 'listItem', content: [p('Prepare images:'), item({ itemId: C }, 'Screenshots of the new prices')] }] }
    const id = await createPage(page, { title: 'Launch plan', content: doc(item({ itemId: A }, 'Draft copy', p('A note line')), list, p('Bottom line')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    // grip over the title text → the block menu acts on the whole task
    await ed.locator('[data-type="work-item"] p', { hasText: 'Draft copy' }).hover()
    const grip = page.getByRole('button', { name: /^Block menu$/ })
    await expect(grip).toBeVisible()
    await grip.click()
    const menu = page.locator('[data-popover][role="menu"]').first()
    await menu.getByRole('menuitem', { name: 'Delete' }).click()
    await expect.poll(async () => (await editorTasks(page, id)).map((t) => t.itemId)).toEqual([C])
    await expect(ed.locator('p', { hasText: 'A note line' })).toHaveCount(0)
    await page.keyboard.press(`${MOD}+z`)
    await expect.poll(async () => (await editorTasks(page, id)).map((t) => t.itemId)).toEqual([A, C])
    // (a plain caret again: the menu of a selected block acts on the selection)
    await ed.locator('p', { hasText: 'Bottom line' }).click()
    // a grip over a note line: that note
    await ed.locator('p', { hasText: 'A note line' }).hover()
    await expect(grip).toBeVisible()
    await grip.click()
    await menu.getByRole('menuitem', { name: 'Delete' }).click()
    await expect(ed.locator('p', { hasText: 'A note line' })).toHaveCount(0)
    expect((await editorTasks(page, id)).map((t) => t.itemId)).toEqual([A, C])

    // compact task (in a list item): Mod+D duplicates the task inside the list item
    await ed.locator('li [data-type="work-item"] p', { hasText: 'Screenshots' }).click()
    await page.keyboard.press(`${MOD}+d`)
    await expect(ed.locator('li')).toHaveCount(1)
    await expect(ed.locator('li [data-type="work-item"]')).toHaveCount(2)
    const compact = (await editorTasks(page, id)).filter((t) => (t as any).parent === 'listItem')
    expect(compact).toHaveLength(2)
    expect(compact[1].itemId).not.toBe(C)
    // Alt+Enter → the TASK's menu: Delete removes that task, the list item stays
    await ed.locator('li [data-type="work-item"] p', { hasText: 'Screenshots' }).last().click()
    await page.keyboard.press('Alt+Enter')
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Delete' }).click()
    await expect(ed.locator('li [data-type="work-item"]')).toHaveCount(1)
    await expect(ed.locator('li')).toHaveCount(1)
    await expect(ed.locator('li p', { hasText: 'Prepare images:' })).toHaveCount(1)
  })
})

test.describe('moves keep the id', () => {
  /** NodeSelection on the first top-level node of a type. */
  const selectFirst = (page: Page, id: string, type: string) =>
    page.evaluate(
      ({ id, type }) => {
        const el = document.querySelector(`.ProseMirror[data-page-id="${id}"]`) as any
        let at = -1
        el.editor.state.doc.forEach((n: any, pos: number) => {
          if (at < 0 && n.type.name === type) at = pos
        })
        el.editor.commands.setNodeSelection(at)
        el.editor.view.focus()
      },
      { id, type },
    )

  test('Move to page, Turn into page and Sub-page per item move tasks with their ids', async ({ page }) => {
    await openApp(page)
    const c0 = await counters(page)
    const home = await createPage(page, { title: 'New home', content: doc(p('Arrivals')) })
    const list = {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [p('Pricing tickets'), item({ itemId: C }, 'Fix the coupon field')] },
        { type: 'listItem', content: [p('Checkout tickets'), item({ itemId: D }, 'Retry failed cards')] },
      ],
    }
    const id = await createPage(page, { title: 'Launch plan', content: doc(item({ itemId: A }, 'Draft copy'), item({ itemId: B }, 'Ship pricing'), list, p('Bottom line')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await expect(ed.locator('[data-type="work-item"]')).toHaveCount(4)

    // Move to (block menu): A goes to "New home" with its id
    await selectTaskNode(page, id, 'Draft copy')
    await page.keyboard.press('Alt+Enter')
    await page.getByRole('menuitem', { name: 'Move to' }).click()
    await page.keyboard.type('New home')
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await tasksOf(page, home)).map((t) => t.itemId), { timeout: 5000 }).toEqual([A])

    // Turn into page (Mod+Alt+9): B moves into a new sub-page with its id
    await selectTaskNode(page, id, 'Ship pricing')
    await page.keyboard.press(`${MOD}+Alt+9`)
    await expect(ed.locator('[data-type="work-item"]', { hasText: 'Ship pricing' })).toHaveCount(0)
    await flush(page)
    const sub = await wsEval(page, (s, id) => (Object.values(s.pages) as AnyState[]).filter((x) => x.parentId === id && !x.trashed).map((x) => x.id as string), id)
    const subTasks = (await Promise.all(sub.map((x) => tasksOf(page, x)))).flat()
    expect(subTasks.map((t) => t.itemId)).toContain(B)

    // Sub-page per item: each list item becomes a sub-page, its compact task inside it, ids kept
    await selectFirst(page, id, 'bulletList')
    await page.keyboard.press('Alt+Enter')
    const menu = page.locator('[data-popover][role="menu"]').first()
    await menu.getByRole('menuitem', { name: 'Turn into', exact: true }).click()
    await page.getByRole('menuitem', { name: /^Sub-page per item · 2 items/ }).click()
    await expect.poll(async () => (await wsEval(page, (s, id) => (Object.values(s.pages) as AnyState[]).filter((x) => x.parentId === id && !x.trashed).length, id))).toBe(3)
    await flush(page)
    const kids = await wsEval(page, (s, id) => (Object.values(s.pages) as AnyState[]).filter((x) => x.parentId === id && !x.trashed).map((x) => x.id as string), id)
    const all = (await Promise.all(kids.map((x) => tasksOf(page, x)))).flat().map((t) => t.itemId)
    expect(all.sort()).toEqual([B, C, D].sort())
    expect((await counters(page)).remints).toBe(c0.remints)
  })
})
