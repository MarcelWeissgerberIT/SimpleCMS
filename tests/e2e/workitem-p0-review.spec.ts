/**
 * Task block (`workItem`), schema release (P0) — the review round. Each finding of the review has a test here
 * that failed before its fix:
 *  - an older build of One in another tab (same browser) never takes a task: its save, its stash and what it
 *    stored while no current tab was open are merged back (the stamp + shadow copy, store/generations.ts) — text
 *    typed there inside a task stays in it, a stamp its own merge carried over counts for nothing, a page without
 *    block ids never doubles, a task deleted there or a page replaced there stays so (the version in the history),
 *    a page it deleted for good takes its shadow copy along;
 *  - a folder sync pickup keeps a task a task when its Markdown changed (a person renamed, its title or field
 *    line edited in the file) — keepItems;
 *  - nothing outside the editor's own copy and paste makes a task: raw HTML in Markdown (paste, import), an
 *    HTML paste without the clip key;
 *  - a task cut and pasted into another task's notes or a table cell moves out whole, with its fields;
 *  - the record type editor keeps a task in its content (renaming the type);
 *  - the AI terminal's edit_page replacing a task with the Markdown it read keeps the task;
 *  - the Markdown form is lossless (a hard break in the title, the time a task was done);
 *  - the placard: the state in words, the overdue day count, "Depends on" (no computed "blocked"), chips that
 *    say what they are to a screen reader, a done task's icons dimmed, chips scaled on slides, consecutive
 *    tasks one plate in an HTML export too;
 *  - history "Changes": the 'at' reminder in words (no emoji), a rewritten title stays in the title cell;
 *  - with no older build around, the stamp and the shadow copies cost no extra reads: a save of a page without tasks
 *    touches no shadow copy, a start reads only their keys (a copy's content only where a stamp does not fit), a
 *    page read from another tab of this version is read without its copy — and a copy still goes with its tasks.
 * Pure parts (keepItems, liftMisplacedItems, restoreNewer) run without a page.
 */
import { strFromU8, unzipSync } from 'fflate'
import { readFileSync } from 'node:fs'
import type { BrowserContext, Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, gotoPage, wsEval, uiEval, createPage, doc, para, flush, reloadApp, waitForApp, editorOf, MOD } from './fixtures'
import { itemAttrs } from '../../src/app/editor/workitem/attrs'
import { keepItems, workItemFromQuote } from '../../src/app/editor/workitem/markdown'
import { liftMisplacedItems } from '../../src/app/editor/workitem/place'
import { asGeneration, contentFingerprint, lostNewer, newerBlockPrints, restoreNewer, rewrapNewer } from '../../src/app/store/generations'
import { mergeContent } from '../../src/app/store/merge'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const DUE = '2031-10-17'
const A = 'wi_7f3a9c2d01'
const B = 'wi_1b2c3d4e5f'
const C = 'wi_9d8e7f6a5b'
const RAW = (itemId = 'wi_injected01') =>
  `<div data-type="work-item" data-item-id="${itemId}" data-status="done" data-people="u_x" data-blocked-by="wi_bbbbbbbbbb"><div class="workitem__body"><p>Injected task</p></div></div>`

const p = (text: string): JSONContent => para(text)
const item = (attrs: Record<string, unknown>, title: string, ...notes: JSONContent[]): JSONContent => ({ type: 'workItem', attrs, content: [p(title), ...notes] })
const FIELDS = ['itemId', 'status', 'due', 'reminder', 'people', 'blockedBy', 'related', 'doneAt'] as const
const fields = (a: AnyState) => {
  const s = itemAttrs(a)
  return Object.fromEntries(FIELDS.map((k) => [k, s[k]]))
}

async function addPeople(page: Page): Promise<{ alex: string; mara: string }> {
  return wsEval(page, (s) => ({ alex: s.addPerson('Alex Kern') as string, mara: s.addPerson('Mara Sommer') as string }))
}

/** A page with two tasks (every field set on the first). */
function plan(alex: string, mara: string): JSONContent {
  return doc(
    p('Before the tasks.'),
    item({ itemId: A, status: 'in_progress', due: DUE, reminder: '-1d', people: [alex, mara], blockedBy: [C], related: [B] }, 'Ship pricing', p('notes of the task')),
    item({ itemId: B, status: 'done', doneAt: 1_760_000_000_000, people: [mara] }, 'Legal review'),
    p('After the tasks.'),
  )
}

/** Every task of a page in the store: itemId → fields + title + notes text. */
async function tasksOf(page: Page, id: string): Promise<Record<string, AnyState>> {
  return wsEval(
    page,
    (s, id) => {
      const out: Record<string, AnyState> = {}
      const text = (n: AnyState): string => (n.text ?? '') + (n.content ?? []).map(text).join('')
      const walk = (n: AnyState) => {
        if (!n) return
        if (n.type === 'workItem') out[String(n.attrs?.itemId)] = { attrs: n.attrs, title: text(n.content?.[0] ?? {}), notes: (n.content ?? []).slice(1).map(text) }
        ;(n.content ?? []).forEach(walk)
      }
      walk(s.pages[id]?.content)
      return out
    },
    id,
  )
}

const topTypes = (page: Page, id: string) => wsEval(page, (s, id) => ((s.pages[id]?.content?.content ?? []) as AnyState[]).map((n) => n.type as string), id)

/* ------------------------------------------------------------------ */
/* An older build of One in the same browser (local workspace)         */
/* ------------------------------------------------------------------ */

/** A record of the local workspace (idb-keyval's keyval-store). */
function idbGet(page: Page, key: string): Promise<AnyState | undefined> {
  return page.evaluate(async (key) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('keyval-store')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    try {
      return await new Promise<AnyState | undefined>((res, rej) => {
        const q = db.transaction('keyval').objectStore('keyval').get(key)
        q.onsuccess = () => res(q.result)
        q.onerror = () => rej(q.error)
      })
    } finally {
      db.close()
    }
  }, key)
}

function idbPut(page: Page, key: string, value: unknown): Promise<void> {
  return page.evaluate(
    async ({ key, value }) => {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open('keyval-store')
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
      })
      try {
        await new Promise<void>((res, rej) => {
          const tx = db.transaction('keyval', 'readwrite')
          tx.objectStore('keyval').put(value, key)
          tx.oncomplete = () => res()
          tx.onerror = () => rej(tx.error)
        })
      } finally {
        db.close()
      }
    },
    { key, value },
  )
}

/**
 * What a tab of an OLDER One stores for this page after it showed it: its editor's sanitize unwraps every task
 * (a node it does not know) into its blocks, plus what the person typed there. The stamp it read along stays
 * as it was (an older build copies unknown fields) — it no longer fits the copy.
 */
function asOlderBuild(record: AnyState, typed: string): AnyState {
  const unwrap = (n: AnyState): AnyState[] => (n.type === 'workItem' ? (n.content ?? []).flatMap(unwrap) : [n.content ? { ...n, content: n.content.flatMap(unwrap) } : n])
  const content = { ...record.content, content: [...record.content.content.flatMap(unwrap), { type: 'paragraph', content: [{ type: 'text', text: typed }] }] }
  return { ...record, content, contentRev: record.contentRev + 1, updatedAt: Date.now(), plain: `${record.plain ?? ''}\n${typed}` }
}

/** An older tab stores this record and tells the others (its BroadcastChannel message). */
async function saveOlder(page: Page, id: string, record: AnyState): Promise<void> {
  await idbPut(page, `one.page.v2:${id}`, record)
  await page.evaluate((id) => new BroadcastChannel('one-sync').postMessage({ type: 'changed', from: 'older-tab', full: false, pages: [id], dbs: [], meta: false }), id)
}

function idbDelete(page: Page, key: string): Promise<void> {
  return page.evaluate(async (key) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('keyval-store')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    try {
      await new Promise<void>((res, rej) => {
        const tx = db.transaction('keyval', 'readwrite')
        tx.objectStore('keyval').delete(key)
        tx.oncomplete = () => res()
        tx.onerror = () => rej(tx.error)
      })
    } finally {
      db.close()
    }
  }, key)
}

const plainOf = (n: AnyState): string => (n.text ?? '') + (n.content ?? []).map(plainOf).join('')

/** The older tab typed at the end of the lines that start so (plain blocks to it: a task's title and notes too). */
function typedInside(record: AnyState, typed: Record<string, string>): AnyState {
  const walk = (n: AnyState): AnyState => {
    if (n.type === 'paragraph') {
      const line = Object.keys(typed).find((k) => plainOf(n).startsWith(k))
      return line ? { ...n, content: [{ type: 'text', text: plainOf(n) + typed[line] }] } : n
    }
    return n.content ? { ...n, content: n.content.map(walk) } : n
  }
  return { ...record, content: walk(record.content) }
}

/** The older editor gives every block without an id a fresh one, at every load. */
let madeUp = 0
function withMadeUpIds(record: AnyState): AnyState {
  const walk = (n: AnyState): AnyState => {
    if (n.type === 'text') return n
    const out: AnyState = n.type === 'doc' || n.attrs?.id ? { ...n } : { ...n, attrs: { ...(n.attrs ?? {}), id: `older-${++madeUp}` } }
    if (n.content) out.content = n.content.map(walk)
    return out
  }
  return { ...record, content: walk(record.content) }
}

/** The page history holds the version an older tab let go of (it had `text`), labelled in English and in German. */
async function expectOlderVersion(page: Page, id: string, text: string): Promise<void> {
  await gotoPage(page, id)
  await page.locator('.tb').getByRole('button', { name: 'Version history' }).click()
  const dialog = page.getByRole('dialog')
  const row = dialog.locator('.hist__row').filter({ hasText: 'Old tab' })
  await expect(row).toHaveCount(1)
  await row.click()
  await expect(dialog).toContainText('Before an older One tab changed it')
  await expect(dialog.locator('.hist__preview')).toContainText(text)
  await page.keyboard.press('Escape')
  await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
  await page.locator('.tb').getByRole('button', { name: 'Versionsverlauf' }).click()
  await expect(page.getByRole('dialog').locator('.hist__row').filter({ hasText: 'Alter Tab' })).toHaveCount(1)
  await page.getByRole('dialog').locator('.hist__row').filter({ hasText: 'Alter Tab' }).click()
  await expect(page.getByRole('dialog')).toContainText('Bevor ein älterer One-Tab sie änderte')
}

test.describe('task block (P0 review): an older build of One in the same browser', () => {
  test('its save reaches this tab without the tasks: merged back — its own text kept, every task and field too', async ({ page }) => {
    await openApp(page)
    const { alex, mara } = await addPeople(page)
    const id = await createPage(page, { title: 'Older tab', content: plan(alex, mara) })
    const before = await tasksOf(page, id)
    await gotoPage(page, id)
    await expect(editorOf(page, id).locator('.workitem')).toHaveCount(2)
    await flush(page)
    const record = (await idbGet(page, `one.page.v2:${id}`))!
    expect(record._schema).toEqual({ g: 1, f: expect.any(Number) })
    expect(JSON.stringify(await idbGet(page, `one.page.g1:${id}`))).toContain('workItem')

    // the older tab saves and tells the others (its BroadcastChannel message)
    await idbPut(page, `one.page.v2:${id}`, asOlderBuild(record, 'Typed in the older tab 9911.'))
    await page.evaluate((id) => new BroadcastChannel('one-sync').postMessage({ type: 'changed', from: 'older-tab', full: false, pages: [id], dbs: [], meta: false }), id)

    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain as string, id)).toContain('9911')
    const after = await tasksOf(page, id)
    expect(Object.keys(after)).toEqual([A, B])
    for (const k of [A, B]) {
      expect(fields(after[k]!.attrs), k).toEqual(fields(before[k]!.attrs))
      expect(after[k]!.title).toBe(before[k]!.title)
    }
    await expect(editorOf(page, id).locator('.workitem')).toHaveCount(2)
    // this tab stores the merged copy again (stamped), so a reload — or the older tab — reads it
    await expect.poll(async () => JSON.stringify((await idbGet(page, `one.page.v2:${id}`))?.content)).toContain('workItem')
    const stored = (await idbGet(page, `one.page.v2:${id}`))!
    expect(stored._schema).toEqual({ g: 1, f: expect.any(Number) })
    expect(stored._schema.f).not.toBe(record._schema.f)
    await reloadApp(page)
    expect(Object.keys(await tasksOf(page, id))).toEqual([A, B])
    expect(await wsEval(page, (s, id) => s.pages[id].plain as string, id)).toContain('9911')
  })

  test('what it stored while no tab of this version was open comes back at the next start', async ({ page }) => {
    await openApp(page)
    const { alex, mara } = await addPeople(page)
    const id = await createPage(page, { title: 'Older tab at boot', content: plan(alex, mara) })
    const before = await tasksOf(page, id)
    await flush(page)
    const record = (await idbGet(page, `one.page.v2:${id}`))!
    await idbPut(page, `one.page.v2:${id}`, asOlderBuild(record, 'Typed while this version was closed 9912.'))
    await page.reload()
    await page.waitForFunction(() => !!(window as unknown as { __one?: unknown }).__one)
    const after = await tasksOf(page, id)
    expect(Object.keys(after)).toEqual([A, B])
    expect(fields(after[A]!.attrs)).toEqual(fields(before[A]!.attrs))
    expect(await wsEval(page, (s, id) => s.pages[id].plain as string, id)).toContain('9912')
    await gotoPage(page, id)
    await expect(editorOf(page, id).locator('.workitem')).toHaveCount(2)
    await expect(editorOf(page, id)).toContainText('9912')
  })

  test('its stash (it went away with unsaved edits) never takes a task either', async ({ page }) => {
    await openApp(page)
    const { alex, mara } = await addPeople(page)
    const id = await createPage(page, { title: 'Older stash', content: plan(alex, mara) })
    await flush(page)
    const record = (await idbGet(page, `one.page.v2:${id}`))!
    const epoch = await wsEval(page, (s) => (s.epoch as string | undefined) ?? 'legacy')
    const older = asOlderBuild(record, 'Stashed by the older tab 9913.')
    delete older._schema
    const raw = JSON.stringify({ at: Date.now(), epoch, pages: { [id]: older }, databases: {} })
    await page.evaluate((raw) => {
      localStorage.setItem('one.unsaved', raw)
      window.dispatchEvent(new StorageEvent('storage', { key: 'one.unsaved', newValue: raw }))
    }, raw)
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain as string, id)).toContain('9913')
    expect(Object.keys(await tasksOf(page, id))).toEqual([A, B])
  })
  test('text typed there inside a task (its title and notes: plain blocks to it) stays in that task', async ({ page }) => {
    await openApp(page)
    const { alex, mara } = await addPeople(page)
    const id = await createPage(page, { title: 'Older tab in a task', content: plan(alex, mara) })
    const before = await tasksOf(page, id)
    await gotoPage(page, id)
    await expect(editorOf(page, id).locator('.workitem')).toHaveCount(2)
    await flush(page)
    const record = (await idbGet(page, `one.page.v2:${id}`))!
    await saveOlder(page, id, typedInside(asOlderBuild(record, 'Typed below 9921.'), { 'Ship pricing': ' 9922', 'notes of the task': ' 9923', 'Legal review': ' 9924' }))
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain as string, id)).toContain('9922')
    const after = await tasksOf(page, id)
    expect(Object.keys(after)).toEqual([A, B])
    expect(after[A]!.title).toBe('Ship pricing 9922')
    expect(after[A]!.notes).toEqual(['notes of the task 9923'])
    expect(after[B]!.title).toBe('Legal review 9924')
    for (const k of [A, B]) expect(fields(after[k]!.attrs), k).toEqual(fields(before[k]!.attrs))
    // nothing doubled, the line typed below the tasks stays outside them
    const plain = await wsEval(page, (s, id) => s.pages[id].plain as string, id)
    for (const line of ['Before the tasks.', 'Ship pricing', 'notes of the task', 'Legal review', 'After the tasks.', '9921']) expect(plain.split(line).length - 1, line).toBe(1)
    expect(await topTypes(page, id)).toEqual(['paragraph', 'workItem', 'workItem', 'paragraph', 'paragraph'])
    await expect(editorOf(page, id).locator('.workitem').first()).toContainText('Ship pricing 9922')
  })

  test('a copy its own merge stamped with ours (same rev, same time) but without the tasks: the stamp no longer fits', async ({ page }) => {
    await openApp(page)
    const { alex, mara } = await addPeople(page)
    const id = await createPage(page, { title: 'Older stamp', content: plan(alex, mara) })
    await flush(page)
    const record = (await idbGet(page, `one.page.v2:${id}`))!
    // what the older build's merge stores: our stamp (and rev / time) on its own copy, which lost the tasks
    const older = { ...asOlderBuild(record, 'Merged in the older tab 9931.'), _schema: record._schema, contentRev: record.contentRev, updatedAt: record.updatedAt }
    await saveOlder(page, id, older)
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain as string, id)).toContain('9931')
    expect(Object.keys(await tasksOf(page, id))).toEqual([A, B])
    await expect.poll(async () => JSON.stringify((await idbGet(page, `one.page.v2:${id}`))?.content)).toContain('workItem')
    await reloadApp(page)
    expect(Object.keys(await tasksOf(page, id))).toEqual([A, B])
  })

  test('a page without block ids: the older editor makes new ones at every load — the page never doubles', async ({ page }) => {
    await openApp(page)
    const { alex, mara } = await addPeople(page)
    // never shown in this tab's editor: its blocks keep no ids
    const id = await createPage(page, { title: 'Older without ids', content: plan(alex, mara) })
    for (let round = 0; round < 4; round++) {
      const record = (await idbGet(page, `one.page.v2:${id}`))!
      await saveOlder(page, id, withMadeUpIds(typedInside(asOlderBuild(record, `Round ${round} 994${round}.`), { 'Ship pricing': ` r${round}` })))
      await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain as string, id)).toContain(`994${round}`)
      await expect.poll(async () => JSON.stringify((await idbGet(page, `one.page.v2:${id}`))?.content)).toContain('workItem')
    }
    const after = await tasksOf(page, id)
    expect(Object.keys(after)).toEqual([A, B])
    expect(after[A]!.title).toBe('Ship pricing r0 r1 r2 r3')
    const plain = await wsEval(page, (s, id) => s.pages[id].plain as string, id)
    for (const line of ['Before the tasks.', 'notes of the task', 'Legal review', 'After the tasks.', '9940', '9943']) expect(plain.split(line).length - 1, line).toBe(1)
  })

  test('a task deleted there stays deleted — the version that had it is in the page history (EN + DE)', async ({ page }) => {
    await openApp(page)
    const { alex, mara } = await addPeople(page)
    const id = await createPage(page, { title: 'Older deleted a task', content: plan(alex, mara) })
    await gotoPage(page, id)
    await expect(editorOf(page, id).locator('.workitem')).toHaveCount(2)
    await flush(page)
    const record = (await idbGet(page, `one.page.v2:${id}`))!
    const older = asOlderBuild(record, 'Deleted a task there 9951.')
    older.content.content = older.content.content.filter((n: AnyState) => plainOf(n) !== 'Legal review')
    await saveOlder(page, id, older)
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain as string, id)).toContain('9951')
    expect(Object.keys(await tasksOf(page, id))).toEqual([A])
    await expectOlderVersion(page, id, 'Legal review')
  })

  test('the page replaced there as a whole (a backup or version restored): nothing of ours mixed in, ours in the history', async ({ page }) => {
    await openApp(page)
    const { alex, mara } = await addPeople(page)
    const id = await createPage(page, { title: 'Older restored', content: plan(alex, mara) })
    await flush(page)
    const record = (await idbGet(page, `one.page.v2:${id}`))!
    // the restored version has a line as it is in the task now: still nothing of the task comes back
    const restored = doc(p('Version one of the page.'), p('Ship pricing'))
    await saveOlder(page, id, { ...record, _schema: undefined, content: restored, plain: 'Version one of the page.\nShip pricing', contentOrigin: 'import', contentRev: record.contentRev + 1, updatedAt: Date.now() })
    await expect.poll(() => wsEval(page, (s, id) => JSON.stringify(s.pages[id].content), id)).toContain('Version one of the page.')
    expect(await tasksOf(page, id)).toEqual({})
    expect(await wsEval(page, (s, id) => s.pages[id].content, id)).toEqual(restored)
    // stored again, stamped; no shadow copy left
    await expect.poll(async () => (await idbGet(page, `one.page.v2:${id}`))?._schema?.g).toBe(1)
    await expect.poll(() => idbGet(page, `one.page.g1:${id}`)).toBeUndefined()
    await expectOlderVersion(page, id, 'Ship pricing')
  })

  test('a page it deleted for good takes its shadow copy along', async ({ page }) => {
    await openApp(page)
    const { alex, mara } = await addPeople(page)
    const id = await createPage(page, { title: 'Older deleted the page', content: plan(alex, mara) })
    await flush(page)
    expect(await idbGet(page, `one.page.g1:${id}`)).toBeDefined()
    await idbDelete(page, `one.page.v2:${id}`)
    await page.evaluate((id) => new BroadcastChannel('one-sync').postMessage({ type: 'changed', from: 'older-tab', full: false, pages: [id], dbs: [], meta: false }), id)
    await expect.poll(() => wsEval(page, (s, id) => !!s.pages[id], id)).toBe(false)
    await expect.poll(() => idbGet(page, `one.page.g1:${id}`)).toBeUndefined()
  })
})

/* ------------------------------------------------------------------ */
/* What the stamp and the shadow copies cost with no older build       */
/* ------------------------------------------------------------------ */

/**
 * IndexedDB requests on this generation's shadow copies (`one.page.g1:`), counted per method in the page: an init
 * script wraps the object store's methods before the app runs (every page of the context, after a reload too).
 */
function countShadowRequests(context: BrowserContext): Promise<void> {
  return context.addInitScript(() => {
    const counts: Record<string, number> = {}
    ;(window as unknown as { __shadowRequests: Record<string, number> }).__shadowRequests = counts
    const proto = IDBObjectStore.prototype as unknown as Record<string, (...args: unknown[]) => unknown>
    for (const name of ['get', 'getAll', 'getKey', 'getAllKeys', 'put', 'delete']) {
      const orig = proto[name]!
      proto[name] = function (this: IDBObjectStore, ...args: unknown[]) {
        const key = name === 'put' ? args[1] : args[0]
        const text = key instanceof IDBKeyRange ? String(key.lower) : String(key)
        if (text.startsWith('one.page.g1:')) counts[name] = (counts[name] ?? 0) + 1
        return orig.apply(this, args)
      }
    }
  })
}

const shadowRequests = (page: Page) => page.evaluate(() => ({ ...(window as unknown as { __shadowRequests: Record<string, number> }).__shadowRequests }))
const resetShadowRequests = (page: Page) =>
  page.evaluate(() => {
    const counts = (window as unknown as { __shadowRequests: Record<string, number> }).__shadowRequests
    for (const k of Object.keys(counts)) delete counts[k]
  })

const setDoc = (page: Page, id: string, content: JSONContent) => wsEval(page, (s, { id, content }) => s.setContent(id, content, 'e2e'), { id, content })

test.describe('task block (P0 review): what the stamp and the shadow copies cost', () => {
  test('saving a page without tasks never touches a shadow copy; a page that loses its tasks loses its copy — wherever the copy came from', async ({ page, context }) => {
    await countShadowRequests(context)
    await openApp(page)
    const plainPage = await createPage(page, { title: 'No tasks here', content: doc(p('Just text.')) })
    await resetShadowRequests(page)
    for (let i = 0; i < 3; i++) {
      await setDoc(page, plainPage, doc(p(`Edit ${i}.`)))
      await flush(page)
    }
    expect(await shadowRequests(page)).toEqual({})
    expect((await idbGet(page, `one.page.v2:${plainPage}`))?._schema).toEqual({ g: 1, f: expect.any(Number) })

    // this tab gives a page a task and takes it away again
    const own = await createPage(page, { title: 'Own task', content: doc(p('a'), item({ itemId: A }, 'Task one')) })
    expect(await idbGet(page, `one.page.g1:${own}`)).toBeDefined()
    await setDoc(page, own, doc(p('a'), p('Task one')))
    await flush(page)
    expect(await idbGet(page, `one.page.g1:${own}`)).toBeUndefined()

    // another tab gives a page this tab holds without a copy a task: read without its shadow copy (its stamp fits) …
    const other = await context.newPage()
    await openApp(other)
    await resetShadowRequests(page)
    await setDoc(other, plainPage, doc(p('With a task now.'), item({ itemId: B }, 'Task from the other tab')))
    await flush(other)
    await expect.poll(() => wsEval(page, (s, id) => JSON.stringify(s.pages[id].content), plainPage)).toContain('Task from the other tab')
    const read = await shadowRequests(page)
    expect(read.getKey).toBeGreaterThan(0)
    expect(read.get ?? 0).toBe(0)
    expect(await idbGet(page, `one.page.g1:${plainPage}`)).toBeDefined()
    // … and when this tab takes the task away, the copy goes
    await setDoc(page, plainPage, doc(p('With a task now.')))
    await flush(page)
    expect(await idbGet(page, `one.page.g1:${plainPage}`)).toBeUndefined()
    await other.close()

    // after a start: the keys read then tell where a copy is
    await setDoc(page, own, doc(p('a'), item({ itemId: C }, 'Task two')))
    await flush(page)
    expect(await idbGet(page, `one.page.g1:${own}`)).toBeDefined()
    await page.reload()
    await waitForApp(page)
    await setDoc(page, own, doc(p('a'), p('Task two')))
    await flush(page)
    expect(await idbGet(page, `one.page.g1:${own}`)).toBeUndefined()
    expect(await tasksOf(page, own)).toEqual({})
  })

  test('a start reads only the shadow copies\' keys while every stamp fits — the copy of a page an older build stored is read and its tasks come back', async ({ page, context }) => {
    await countShadowRequests(context)
    await openApp(page)
    const kept = await createPage(page, { title: 'Stamped', content: doc(p('Kept as it is.'), item({ itemId: A }, 'Task kept')) })
    const older = await createPage(page, { title: 'Older wrote it', content: doc(p('Before.'), item({ itemId: B }, 'Task back'), p('After.')) })
    await flush(page)

    await page.reload()
    await waitForApp(page)
    let boot = await shadowRequests(page)
    expect(boot.getAllKeys).toBeGreaterThan(0)
    expect([boot.getAll ?? 0, boot.get ?? 0]).toEqual([0, 0])
    expect(Object.keys(await tasksOf(page, kept))).toEqual([A])

    // an older build stored one of them meanwhile (without its task): only that page's copy is read
    const record = (await idbGet(page, `one.page.v2:${older}`))!
    await idbPut(page, `one.page.v2:${older}`, asOlderBuild(record, 'Typed by the older build 9971.'))
    await page.reload()
    await waitForApp(page)
    boot = await shadowRequests(page)
    expect([boot.getAll ?? 0, boot.get ?? 0]).toEqual([0, 1])
    expect(Object.keys(await tasksOf(page, older))).toEqual([B])
    expect(await wsEval(page, (s, id) => s.pages[id].plain as string, older)).toContain('9971')
    expect(Object.keys(await tasksOf(page, kept))).toEqual([A])
  })
})

/* ------------------------------------------------------------------ */
/* Folder sync pickup                                                  */
/* ------------------------------------------------------------------ */

const DIR = 'one-sync-workitems'

async function readFolder(page: Page): Promise<Record<string, string>> {
  for (let i = 0; ; i++) {
    try {
      return await page.evaluate(async (name) => {
        const root = await navigator.storage.getDirectory()
        const dir = await root.getDirectoryHandle(name, { create: true })
        const out: Record<string, string> = {}
        const walk = async (d: FileSystemDirectoryHandle, prefix: string) => {
          for await (const h of (d as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
            if (h.kind === 'directory') await walk(h as FileSystemDirectoryHandle, `${prefix}${h.name}/`)
            else if (/\.md$/.test(h.name)) out[`${prefix}${h.name}`] = await (await (h as FileSystemFileHandle).getFile()).text()
          }
        }
        await walk(dir, '')
        return out
      }, DIR)
    } catch (e) {
      if (i > 5) throw e
      await page.waitForTimeout(150)
    }
  }
}

async function writeExternal(page: Page, path: string, text: string) {
  await page.evaluate(
    async ({ name, path, text }) => {
      const root = await navigator.storage.getDirectory()
      let d = await root.getDirectoryHandle(name, { create: true })
      const segs = path.split('/')
      for (const s of segs.slice(0, -1)) d = await d.getDirectoryHandle(s, { create: true })
      const w = await (await d.getFileHandle(segs[segs.length - 1]!, { create: true })).createWritable()
      await w.write(text)
      await w.close()
    },
    { name: DIR, path, text },
  )
}

const pickup = (page: Page) => page.evaluate(() => (window as unknown as { __oneSync: { pickup: () => Promise<unknown> } }).__oneSync.pickup())

test.describe('task block (P0 review): folder sync', () => {
  test('a task whose Markdown changed (a person renamed, its title or field line edited in the file) stays that task', async ({ page }) => {
    await openApp(page)
    const { alex, mara } = await addPeople(page)
    const id = await createPage(page, { title: 'Sync tasks', content: plan(alex, mara) })
    const before = await tasksOf(page, id)
    await page.evaluate(async (name) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(name, { create: true })
      await (window as unknown as { __oneSync: { connect: (h: FileSystemDirectoryHandle) => Promise<unknown> } }).__oneSync.connect(dir)
    }, DIR)
    await expect.poll(async () => Object.keys(await readFolder(page)).find((k) => k.endsWith('Sync tasks.md')) ?? null, { timeout: 15_000 }).not.toBeNull()
    const path = Object.keys(await readFolder(page)).find((k) => k.endsWith('Sync tasks.md'))!
    const same = async (title = before[A]!.title) => {
      const after = await tasksOf(page, id)
      expect(Object.keys(after)).toEqual([A, B])
      for (const k of [A, B]) expect(fields(after[k]!.attrs), k).toEqual(fields(before[k]!.attrs))
      expect(after[A]!.title).toBe(title)
      expect(after[A]!.notes).toEqual(['notes of the task'])
      expect(await topTypes(page, id)).not.toContain('blockquote')
    }

    // (a) a person renamed in One, then an unrelated edit in the file
    await wsEval(page, (s, alex) => s.updatePerson(alex, { name: 'Alexander Kern' }), alex)
    await flush(page)
    let file = (await readFolder(page))[path]!
    await writeExternal(page, path, `${file.trimEnd()}\n\nAdded after the rename 4712.\n`)
    await pickup(page)
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain as string, id)).toContain('4712')
    await same()

    // (b) its title edited in the file: the new title, every field as it was
    file = (await readFolder(page))[path]!
    expect(file).toContain(`[!TODO] Ship pricing {#${A}}`)
    await writeExternal(page, path, file.replace('[!TODO] Ship pricing', '[!TODO] Ship the pricing page'))
    await pickup(page)
    await expect.poll(async () => (await tasksOf(page, id))[A]?.title).toBe('Ship the pricing page')
    await same('Ship the pricing page')

    // (c) its field line edited in the file: fields change in One only — the task stays, as it is
    file = (await readFolder(page))[path]!
    expect(file).toContain('Status: done · ')
    await writeExternal(page, path, file.replace('Status: done · ', '').replace('Added after the rename 4712.', 'Edited again 4713.'))
    await pickup(page)
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain as string, id)).toContain('4713')
    await same('Ship the pricing page')
  })
})

/* ------------------------------------------------------------------ */
/* Nothing outside the editor's own copy makes a task                  */
/* ------------------------------------------------------------------ */

async function pasteInto(page: Page, id: string, data: Record<string, string>) {
  await editorOf(page, id).evaluate((el, data) => {
    const dt = new DataTransfer()
    for (const [k, v] of Object.entries(data)) dt.setData(k, v)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, data)
}

const holdsTask = (page: Page, id: string) => wsEval(page, (s, id) => JSON.stringify(s.pages[id]?.content ?? {}).includes('"workItem"'), id)

test.describe('task block (P0 review): no task from raw HTML', () => {
  test('raw HTML in pasted Markdown, an HTML paste without the clip key, a Markdown import: plain blocks only', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Paste here', content: doc(p('Start.'), p('')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p').nth(1).click()
    // (a) Markdown (text/plain) holding a task's raw HTML
    await pasteInto(page, id, { 'text/plain': `# Heading from md\n\n${RAW()}\n\n- a list item` })
    await expect(ed).toContainText('Heading from md')
    await expect(ed).toContainText('Injected task')
    // (b) the same HTML pasted twice as text/html (another site, an email …): no clip key
    await pasteInto(page, id, { 'text/html': RAW(), 'text/plain': 'Injected task' })
    await pasteInto(page, id, { 'text/html': RAW(), 'text/plain': 'Injected task' })
    await flush(page)
    expect(await holdsTask(page, id)).toBe(false)
    await expect(ed.locator('.workitem')).toHaveCount(0)

    // (c) a Markdown file with it
    await page.locator('.sb').getByRole('button', { name: /^Import/ }).click()
    const dialog = page.getByRole('dialog')
    const chooser = page.waitForEvent('filechooser')
    await dialog.getByRole('button', { name: 'Choose files' }).click()
    await (await chooser).setFiles([{ name: 'raw.md', mimeType: 'text/markdown', buffer: Buffer.from(`# Imported md\n\nBefore.\n\n${RAW('wi_injected02')}\n\nAfter.\n`) }])
    await expect(dialog.getByText(/Import complete/)).toBeVisible()
    await page.keyboard.press('Escape')
    const imported = await wsEval(page, (s) => (Object.values(s.pages) as AnyState[]).find((x) => !x.trashed && /Before\./.test(x.plain ?? '') && /After\./.test(x.plain ?? ''))?.id ?? null)
    expect(imported).not.toBeNull()
    expect(await holdsTask(page, imported!)).toBe(false)
    expect(await wsEval(page, (s, id) => s.pages[id].plain as string, imported!)).toContain('Injected task')
  })
})

/* ------------------------------------------------------------------ */
/* Cut + paste: a task moves, whole                                    */
/* ------------------------------------------------------------------ */

async function selectTask(page: Page, id: string, itemId: string) {
  await page.evaluate(
    ({ id, itemId }) => {
      const el = document.querySelector(`.ProseMirror[data-page-id="${id}"]`) as HTMLElement & { editor: AnyState }
      let at = -1
      el.editor.state.doc.descendants((n: AnyState, pos: number) => {
        if (at < 0 && n.type.name === 'workItem' && n.attrs.itemId === itemId) at = pos
      })
      el.editor.commands.focus()
      el.editor.commands.setNodeSelection(at)
    },
    { id, itemId },
  )
}

test.describe('task block (P0 review): cut and paste', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

  test('a task cut and pasted into another task or a table cell moves out whole — after it, with every field', async ({ page }) => {
    await openApp(page)
    const { alex, mara } = await addPeople(page)
    const table = { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('cell one')] }, { type: 'tableCell', content: [p('cell two')] }] }] }
    const id = await createPage(page, { title: 'Move tasks', content: doc(...plan(alex, mara).content!, table, p('Last line.')) })
    const before = await tasksOf(page, id)
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await expect(ed.locator('.workitem')).toHaveCount(2)

    // into the notes of the first task: B lands right after it, fields and all
    await selectTask(page, id, B)
    await page.keyboard.press(`${MOD}+x`)
    await expect(ed.locator('.workitem')).toHaveCount(1)
    await ed.locator('p', { hasText: 'notes of the task' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.press(`${MOD}+v`)
    await expect(page.getByText('The task moved below — a task never sits inside another task or a table.')).toBeVisible()
    await flush(page)
    let after = await tasksOf(page, id)
    expect(Object.keys(after)).toEqual([A, B])
    expect(fields(after[B]!.attrs)).toEqual(fields(before[B]!.attrs))
    expect(after[B]!.title).toBe('Legal review')
    expect(after[A]!.notes.filter(Boolean)).toEqual(['notes of the task'])
    expect((await topTypes(page, id)).slice(0, 3)).toEqual(['paragraph', 'workItem', 'workItem'])

    // into a table cell: after the table
    await selectTask(page, id, B)
    await page.keyboard.press(`${MOD}+x`)
    await ed.locator('td p', { hasText: 'cell two' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press(`${MOD}+v`)
    await flush(page)
    after = await tasksOf(page, id)
    expect(fields(after[B]!.attrs)).toEqual(fields(before[B]!.attrs))
    const types = await topTypes(page, id)
    expect(types[types.indexOf('table') + 1]).toBe('workItem')
    await expect(ed.locator('td .workitem')).toHaveCount(0)
    await expect(ed.locator('table')).not.toContainText('Legal review')
  })
})

/* ------------------------------------------------------------------ */
/* Record type editor                                                  */
/* ------------------------------------------------------------------ */

test.describe('task block (P0 review): record types', () => {
  test('renaming a record type keeps a task in its content (the text was not touched)', async ({ page }) => {
    await openApp(page)
    const { alex } = await addPeople(page)
    const t = item({ itemId: A, status: 'in_progress', due: DUE, people: [alex] }, 'Triage the report', p('Steps to reproduce'))
    await wsEval(page, (s, t) => s.upsertRecordType({ id: 'bug', name: 'Bug', properties: [], content: { type: 'doc', content: [t] }, createdAt: 1, updatedAt: 1 }), t)
    await page.evaluate(() => (window.location.hash = '#/kit/records/bug'))
    const editor = page.getByTestId('kt-record-editor')
    await expect(editor).toBeVisible()
    const inputs = editor.locator('input')
    const n = await inputs.count()
    let named = false
    for (let i = 0; i < n && !named; i++) {
      if ((await inputs.nth(i).inputValue()) !== 'Bug') continue
      await inputs.nth(i).fill('Bug report')
      await inputs.nth(i).press('Tab')
      named = true
    }
    expect(named).toBe(true)
    await page.getByTestId('kt-save').click()
    const after = async () =>
      wsEval(page, (s) => {
        const list = s.kit.recordTypes as AnyState[] | Record<string, AnyState>
        const rt = Array.isArray(list) ? list.find((r) => r.id === 'bug') : list.bug
        return { name: rt?.name as string, content: rt?.content as AnyState }
      })
    await expect.poll(async () => (await after()).name).toBe('Bug report')
    const content = (await after()).content
    expect(content.content[0].type).toBe('workItem')
    expect(fields(content.content[0].attrs)).toEqual(fields(t.attrs!))

    // the text edited (a sentence added): the task is still that task
    const area = page.getByTestId('kt-record-content')
    await area.fill(`${await area.inputValue()}\n\nOne more line.`)
    await page.getByTestId('kt-save').click()
    await expect.poll(async () => JSON.stringify((await after()).content)).toContain('One more line.')
    const edited = (await after()).content
    expect(edited.content[0].type).toBe('workItem')
    expect(fields(edited.content[0].attrs)).toEqual(fields(t.attrs!))
  })
})

/* ------------------------------------------------------------------ */
/* AI terminal: edit_page writes a task back                           */
/* ------------------------------------------------------------------ */

type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
let msgSeq = 0
function sseMessage(blocks: Block[]): string {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  const stop = blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'
  let body = ev('message_start', {
    message: { id: `msg_wi_${++msgSeq}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  })
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      body += ev('content_block_start', { index, content_block: { type: 'text', text: '' } })
      body += ev('content_block_delta', { index, delta: { type: 'text_delta', text: b.text } })
    } else {
      body += ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } })
      body += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } })
    }
    body += ev('content_block_stop', { index })
  })
  body += ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 70 } })
  body += ev('message_stop', {})
  return body
}

async function mockAgent(ctx: BrowserContext, script: Array<(body: AnyState) => string>): Promise<AnyState[]> {
  const bodies: AnyState[] = []
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (req.method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [], has_more: false }) })
    const body = JSON.parse(req.postData() ?? '{}')
    bodies.push(body)
    const step = script[bodies.length - 1] ?? (() => sseMessage([{ type: 'text', text: 'Done.' }]))
    await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: step(body) }).catch(() => {})
  })
  return bodies
}

function toolText(body: AnyState, id: string): string {
  const r = (body.messages as AnyState[]).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((c: AnyState) => c.type === 'tool_result' && c.tool_use_id === id)
  if (!r) return ''
  return typeof r.content === 'string' ? r.content : (r.content as AnyState[]).map((c) => c.text ?? '').join('')
}

test.describe('task block (P0 review): AI terminal', () => {
  test('edit_page replacing a task with the Markdown it read (title changed) keeps the task and its fields', async ({ page, context }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    const { alex, mara } = await addPeople(page)
    const id = await createPage(page, { title: 'AI tasks', content: plan(alex, mara) })
    const before = await tasksOf(page, id)
    await gotoPage(page, id)
    await mockAgent(context, [
      () => sseMessage([{ type: 'tool_use', id: 'tu1', name: 'read_page', input: { id, refs: true } }]),
      (body) => {
        const read = toolText(body, 'tu1')
        const at = read.indexOf('[!TODO] Ship pricing')
        const ref = [...read.slice(0, at).matchAll(/⟦(b\d+)⟧/g)].pop()![1]
        const md = read.split(`⟦${ref}⟧\n`)[1]!.split('\n\n⟦')[0]!.replace('Ship pricing', 'Ship the pricing page')
        return sseMessage([{ type: 'tool_use', id: 'tu2', name: 'edit_page', input: { id, edits: [{ op: 'replace', from: ref, markdown: md }] } }])
      },
      () => sseMessage([{ type: 'text', text: 'Renamed.' }]),
    ])
    const terminal = page.getByRole('region', { name: 'AI terminal' })
    await page.keyboard.press(`${MOD}+j`)
    const prompt = terminal.getByRole('textbox', { name: 'Task for the agent' })
    await prompt.fill('Rename the first task')
    await prompt.press('Enter')
    await expect(terminal.locator('.term-turn').last()).toHaveAttribute('data-status', 'done', { timeout: 20_000 })
    await terminal.locator('.term-bar').getByRole('button', { name: 'Apply all' }).click()
    await expect.poll(async () => (await tasksOf(page, id))[A]?.title).toBe('Ship the pricing page')
    const after = await tasksOf(page, id)
    expect(Object.keys(after)).toEqual([A, B])
    for (const k of [A, B]) expect(fields(after[k]!.attrs), k).toEqual(fields(before[k]!.attrs))
    expect(await topTypes(page, id)).not.toContain('blockquote')
  })
})

/* ------------------------------------------------------------------ */
/* The Markdown form round trip                                         */
/* ------------------------------------------------------------------ */

async function exportMarkdown(page: Page, out: string): Promise<string> {
  await page.keyboard.press(`${MOD}+k`)
  await page.keyboard.type('>export')
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('radio', { name: /Markdown folder/ }).click()
  const download = page.waitForEvent('download')
  await dialog.locator('[data-export-run]').click()
  await (await download).saveAs(out)
  await page.keyboard.press('Escape')
  const zip = unzipSync(new Uint8Array(readFileSync(out)))
  return strFromU8(zip[Object.keys(zip).find((n) => n.endsWith('.md'))!]!)
}

test.describe('task block (P0 review): the Markdown form', () => {
  test('lossless: a hard break in the title and the time a task was done come back from the exported file', async ({ page }, testInfo) => {
    await openApp(page)
    const title: JSONContent = { type: 'paragraph', content: [{ type: 'text', text: 'Line one' }, { type: 'hardBreak' }, { type: 'text', text: 'line two' }] }
    const id = await createPage(page, { title: 'Lossless', content: doc({ type: 'workItem', attrs: { itemId: A, status: 'done', doneAt: 1_760_000_000_000 }, content: [title, p('a note')] }) })
    await gotoPage(page, id)
    const md = await exportMarkdown(page, testInfo.outputPath('lossless.zip'))
    expect(md).toContain(`> [!TODO] Line one\\\n> line two {#${A} done=2025-10-09T08:53:20.000Z}\n> Status: done\n>\n> a note`)
    // the file read back (the reader is off: a quote) — exactly what the reader takes
    await page.locator('.sb').getByRole('button', { name: /^Import/ }).click()
    const dialog = page.getByRole('dialog')
    const chooser = page.waitForEvent('filechooser')
    await dialog.getByRole('button', { name: 'Choose files' }).click()
    await (await chooser).setFiles([{ name: 'lossless.md', mimeType: 'text/markdown', buffer: Buffer.from(md) }])
    await expect(dialog.getByText(/Import complete/)).toBeVisible()
    await page.keyboard.press('Escape')
    const quote = await wsEval(page, (s, id) => {
      const pg = (Object.values(s.pages) as AnyState[]).find((x) => x.id !== id && !x.trashed && /a note/.test(x.plain ?? '') && /Line one/.test(x.plain ?? ''))
      return (pg?.content?.content as AnyState[] | undefined)?.find((n) => n.type === 'blockquote') ?? null
    }, id)
    expect(quote).not.toBeNull()
    const back = workItemFromQuote(quote as JSONContent)!
    expect(itemAttrs(back)).toMatchObject({ itemId: A, status: 'done', doneAt: 1_760_000_000_000 })
    expect(back.content![0]).toEqual(title)
    expect(back.content!.slice(1).map((n) => n.content?.map((c) => c.text).join(''))).toEqual(['a note'])
  })
})

/* ------------------------------------------------------------------ */
/* The placard                                                         */
/* ------------------------------------------------------------------ */

test.describe('task block (P0 review): the placard', () => {
  test('chips say what they are to a screen reader; a done task dims its icons; German words', async ({ page }) => {
    await openApp(page)
    const { alex, mara } = await addPeople(page)
    const id = await createPage(page, {
      title: 'Readable chips',
      content: doc(
        item({ itemId: A, status: 'todo', due: DUE, reminder: '-1d', people: [alex, mara] }, 'With a reminder'),
        item({ itemId: B, status: 'todo', due: DUE, reminder: 'at' }, 'Reminder at the time'),
        item({ itemId: C, status: 'done', doneAt: 1_760_000_000_000, due: DUE, people: [mara], blockedBy: [A] }, 'Done with a due date'),
      ),
    })
    await gotoPage(page, id)
    const all = editorOf(page, id).locator('.workitem')
    await expect(all).toHaveCount(3)
    const snap = await all.nth(0).locator('.workitem__chips').ariaSnapshot()
    expect(snap).toContain('group "Task fields"')
    expect(snap).toMatch(/Due: Fri 17 Oct\s*, reminder −1 d/)
    expect(snap).toMatch(/Assigned to:\s*Alex Kern\s*Mara Sommer/)
    expect(snap).not.toContain('AK')
    await expect(all.nth(1).locator('.workitem__chips')).toContainText('Reminder at the time')
    await expect(all.nth(0).locator('.workitem__label')).toContainText('Task:')
    // a done task: its due chip's icon is dimmed like everything else on it (never the signal colour)
    const color = (sel: string) => all.nth(2).locator(sel).first().evaluate((el) => getComputedStyle(el).color)
    const signal = await page.evaluate(() => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--signal)'
      document.body.append(probe)
      const c = getComputedStyle(probe).color
      probe.remove()
      return c
    })
    expect(await color('.workitem__chip--due svg')).not.toBe(signal)
    expect(await color('.workitem__chip--due svg')).toBe(await color('.workitem__chip--person'))
    await expect(all.nth(2).locator('.workitem__state')).toHaveText('Done Thu 09 Oct')
    await expect(all.nth(2).locator('.workitem__chip--blocked')).toHaveText('Depends on 1')

    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await expect(all.nth(0).locator('.workitem__state')).toHaveText('Offen')
    await expect(all.nth(2).locator('.workitem__state')).toHaveText('Erledigt Do 09 Okt')
    await expect(all.nth(2).locator('.workitem__chip--blocked')).toHaveText('Abhängig von 1')
    await expect(all.nth(0).locator('.workitem__chips')).toContainText('Fällig:')
    await expect(all.nth(0).locator('.workitem__chips')).toContainText('Zugewiesen an:')
  })

  test('on a slide the chips grow with the slide text', async ({ page }) => {
    await openApp(page)
    const { alex } = await addPeople(page)
    const id = await createPage(page, { title: 'Slides with tasks', content: doc({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'This week' }] }, item({ itemId: A, status: 'in_progress', due: DUE, people: [alex] }, 'Ship pricing')) })
    await gotoPage(page, id)
    await uiEval(page, (s, id) => s.present(id), id)
    const pres = page.locator('.pres')
    await expect(pres).toBeVisible()
    await page.keyboard.press('ArrowRight')
    const task = pres.locator('.workitem').first()
    await expect(task).toBeVisible()
    const size = (sel: string) => task.locator(sel).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    const title = await size('.workitem__body p')
    const chip = await size('.workitem__chip--due')
    const label = await size('.workitem__label')
    expect(title).toBeGreaterThan(20)
    expect(chip / title).toBeGreaterThanOrEqual(0.45)
    expect(label / title).toBeGreaterThanOrEqual(0.4)
  })

  test('an HTML export stacks consecutive tasks into one plate (2 px apart)', async ({ page, browser }, testInfo) => {
    await openApp(page)
    const { alex, mara } = await addPeople(page)
    const id = await createPage(page, { title: 'Stacked export', content: plan(alex, mara) })
    await gotoPage(page, id)
    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('>export')
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: /Web page/ }).click()
    const download = page.waitForEvent('download')
    await dialog.locator('[data-export-run]').click()
    const out = testInfo.outputPath('stacked.html')
    await (await download).saveAs(out)
    const html = readFileSync(out, 'utf8')
    const ctx = await browser.newContext({ javaScriptEnabled: false })
    const view = await ctx.newPage()
    await view.setContent(html)
    const boxes = await view.locator('.workitem').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as { y: number; height: number }))
    expect(boxes).toHaveLength(2)
    expect(Math.round(boxes[1]!.y - (boxes[0]!.y + boxes[0]!.height))).toBe(2)
    await ctx.close()
  })
})

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

async function versionCount(page: Page, pageId: string): Promise<number> {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('one-history')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    try {
      if (!db.objectStoreNames.contains('snapshots')) return 0
      const list = await new Promise<unknown[] | undefined>((res, rej) => {
        const q = db.transaction('snapshots').objectStore('snapshots').get(`idx:${id}`)
        q.onsuccess = () => res(q.result)
        q.onerror = () => rej(q.error)
      })
      return list?.length ?? 0
    } finally {
      db.close()
    }
  }, pageId)
}

async function saveVersion(page: Page, pageId: string, count: number) {
  await page.locator('.tb').getByRole('button', { name: 'Version history' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('.hist__head').getByRole('button', { name: 'Save version' }).click()
  await expect.poll(() => versionCount(page, pageId)).toBe(count)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
}

test.describe('task block (P0 review): history', () => {
  test('the reminder "at the time" in words (no emoji); a rewritten title stays in the title cell', async ({ page }) => {
    await openApp(page)
    const v1 = doc(item({ itemId: A, status: 'todo', due: DUE, reminder: '-1d' }, 'Alpha beta gamma', p('The same note.')))
    const v2 = doc(item({ itemId: A, status: 'todo', due: DUE, reminder: 'at' }, 'Completely different words here', p('The same note.')))
    const id = await createPage(page, { title: 'Task history', content: v1 })
    await gotoPage(page, id)
    await saveVersion(page, id, 1)
    await wsEval(page, (s, { id, content }) => s.setContent(id, content, 'e2e'), { id, content: v2 })
    await expect(editorOf(page, id).locator('.workitem p').first()).toHaveText('Completely different words here')
    await saveVersion(page, id, 2)
    await page.locator('.tb').getByRole('button', { name: 'Version history' }).click()
    const preview = page.getByRole('dialog').locator('.hist__preview')
    const changes = preview.getByTestId('workitem-changes')
    await expect(changes.locator('[data-field="reminder"] dd')).toHaveText('−1 d → Reminder at the time')
    await expect(changes).not.toContainText('🔔')
    // old and new title share the title cell; the note is the note
    const titleCell = preview.locator('.workitem .ddiff-item__title')
    await expect(titleCell).toContainText('Alpha beta gamma')
    await expect(titleCell).toContainText('Completely different words here')
    const titleBox = (await titleCell.boundingBox())!
    const note = (await preview.locator('.workitem').getByText('The same note.').boundingBox())!
    expect(note.y).toBeGreaterThan(titleBox.y + titleBox.height - 1)
    expect(await titleCell.evaluate((el) => getComputedStyle(el).fontWeight)).toBe('600')
  })
})

/* ------------------------------------------------------------------ */
/* Pure                                                                */
/* ------------------------------------------------------------------ */

test.describe('task block (P0 review): pure parts', () => {
  const quote = (first: JSONContent[], ...rest: JSONContent[]): JSONContent => ({ type: 'blockquote', content: [{ type: 'paragraph', content: first }, ...rest] })

  test('keepItems: a known task written back is that task (fields kept); nothing else ever becomes one', () => {
    const known = doc(item({ id: 'blk1', itemId: A, status: 'in_progress', people: ['u1'], blockedBy: [B] }, 'Old title', p('old note')), item({ itemId: B, status: 'done' }, 'Second'))
    const back = doc(
      quote([{ type: 'text', text: `[!TODO] New title {#${A}}\nStatus: done · Owner: ` }, { type: 'mention', attrs: { id: 'u1', label: 'Alex', kind: 'person' } }], p('new note')),
      quote([{ type: 'text', text: `[!TODO] Unknown {#${C}}` }]),
      quote([{ type: 'text', text: `[!TODO] Twice {#${A}}` }]),
      quote([{ type: 'text', text: '[!TODO] No id at all' }]),
    )
    const out = keepItems(back, known)
    const [first, ...rest] = out.content!
    expect(first!.type).toBe('workItem')
    // every field as One has it (the written field line is not read), the title + notes from the Markdown
    expect(itemAttrs(first!)).toMatchObject({ id: 'blk1', itemId: A, status: 'in_progress', people: ['u1'], blockedBy: [B] })
    expect(first!.content!.map((n) => n.content?.map((c) => c.text).join(''))).toEqual(['New title', 'new note'])
    // an id One does not hold, a second copy, no id: quotes
    expect(rest.map((n) => n.type)).toEqual(['blockquote', 'blockquote', 'blockquote'])
    // the task already in the document: its quote stays a quote
    expect(keepItems(doc(known.content![0]!, quote([{ type: 'text', text: `[!TODO] Again {#${A}}` }])), known).content!.map((n) => n.type)).toEqual(['workItem', 'blockquote'])
    // blocks that read the same stay One's own (with what Markdown cannot carry)
    const same = (a: JSONContent, b: JSONContent) => JSON.stringify(a.content) === JSON.stringify(b.content)
    const kept = keepItems(doc(quote([{ type: 'text', text: `[!TODO] Old title {#${A}}` }], p('old note'))), known, same).content![0]!
    expect(kept.content).toEqual(known.content![0]!.content)
    // nothing to keep: the same object
    const plain = doc(p('x'))
    expect(keepItems(plain, null)).toBe(plain)
    expect(keepItems(plain, doc(p('no tasks')))).toBe(plain)
  })

  test('liftMisplacedItems: a task in a task / a table moves out whole, after the outermost one', () => {
    const inner = item({ itemId: B, status: 'done' }, 'Inner', p('inner note'))
    const cellTask = item({ itemId: C }, 'In a cell')
    const src = doc(
      item({ itemId: A }, 'Outer', p('outer note'), inner),
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [cellTask] }] }] },
      p('end'),
    )
    const out = liftMisplacedItems(src)
    expect(out.content!.map((n) => n.type)).toEqual(['workItem', 'workItem', 'table', 'workItem', 'paragraph'])
    expect(out.content![1]).toEqual(inner)
    expect(out.content![3]).toEqual(cellTask)
    expect(out.content![0]!.content!.map((n) => n.type)).toEqual(['paragraph', 'paragraph'])
    const fine = doc(item({ itemId: A }, 'Alone'), p('x'))
    expect(liftMisplacedItems(fine)).toBe(fine)
  })

  test('restoreNewer: an older copy keeps its own edits, every node it could not read comes back', () => {
    const before = doc(p('Intro'), item({ itemId: A, status: 'in_progress' }, 'Task title', p('task note')), p('Outro'))
    // the editor of an older build: the task unwrapped, then a line typed
    const unwrapped = asGeneration(before, 0, 'unwrap')
    expect(unwrapped.content!.map((n) => n.type)).toEqual(['paragraph', 'paragraph', 'paragraph', 'paragraph'])
    const olderEdit = doc(...unwrapped.content!, p('Typed there'))
    expect(lostNewer(before, olderEdit, 0)).toBe(true)
    const merged = restoreNewer(before, olderEdit, 0, 'unwrap')!
    expect(merged.content!.map((n) => n.type)).toEqual(['paragraph', 'workItem', 'paragraph', 'paragraph'])
    expect(JSON.stringify(merged)).toContain('Typed there')
    expect(itemAttrs(merged.content![1]!).status).toBe('in_progress')
    // y-prosemirror: the node deleted outright
    const dropped = doc(p('Intro'), p('Outro changed'))
    const back = restoreNewer(before, dropped, 0, 'drop')!
    expect(back.content!.map((n) => n.type)).toEqual(['paragraph', 'workItem', 'paragraph'])
    expect(JSON.stringify(back)).toContain('Outro changed')
    // a copy of this generation (or one that lost nothing) is taken as it is
    expect(restoreNewer(before, olderEdit, 1, 'unwrap')).toBe(olderEdit)
    const kept = doc(p('Intro'), before.content![1]!, p('more'))
    expect(restoreNewer(before, kept, 0, 'unwrap')).toBe(kept)
  })

  test('rewrapNewer: edits inside a task stay in it; added between its blocks joins it, at its edge stays out; nothing doubled', () => {
    const P = (text: string, id?: string): JSONContent => ({ type: 'paragraph', ...(id ? { attrs: { id } } : {}), content: [{ type: 'text', text }] })
    const textOf = (n: JSONContent): string => (n.text ?? '') + (n.content ?? []).map(textOf).join('')
    const tasks = (d: JSONContent | null) => (d?.content ?? []).filter((n) => n.type === 'workItem').map((n) => n.content!.map(textOf))
    const unwrap = (d: JSONContent): JSONContent => asGeneration(d, 0, 'unwrap')
    for (const ids of [true, false]) {
      const I = (id: string) => (ids ? id : undefined)
      const before = doc(P('Intro', I('i')), item({ itemId: A, ...(ids ? { id: 'w' } : {}) }, 'Title', P('note one', I('n1')), P('note two', I('n2'))), P('Outro', I('o')))
      // the older editor: ids made up for blocks without one, then typing
      let seq = 0
      const made = (d: JSONContent): JSONContent => ({ ...d, ...(d.type !== 'doc' && d.type !== 'text' && !d.attrs?.id ? { attrs: { ...d.attrs, id: `x${++seq}` } } : {}), ...(d.content ? { content: d.content.map(made) } : {}) })
      const older = made(unwrap(before))
      const edit = (d: JSONContent, f: (list: JSONContent[]) => JSONContent[]) => ({ ...d, content: f(d.content!) })
      const typed = edit(older, (l) => l.map((n) => (textOf(n) === 'Title' ? { ...n, content: [{ type: 'text', text: 'Title typed' }] } : textOf(n) === 'note two' ? { ...n, content: [{ type: 'text', text: 'note two typed' }] } : n)))
      const added = edit(typed, (l) => [l[0]!, l[1]!, P('between'), l[2]!, l[3]!, P('at the edge'), l[4]!])
      const r = rewrapNewer(before, added, 0)
      expect(tasks(r.doc), `ids ${ids}`).toEqual([['Title typed', 'between', 'note one', 'note two typed']])
      expect(textOf(r.doc!)).toBe('IntroTitle typedbetweennote onenote two typedat the edgeOutro')
      expect(r.dropped).toEqual([])
      // again (nothing lost now): the same object; a reload loop of the older editor never grows the page
      expect(rewrapNewer(before, r.doc, 0).doc).toBe(r.doc)
      let cur = r.doc!
      for (let i = 0; i < 4; i++) cur = rewrapNewer(cur, made(unwrap(cur)), 0).doc!
      expect(textOf(cur)).toBe(textOf(r.doc!))
      expect(tasks(cur)).toEqual(tasks(r.doc))
      // all its blocks deleted there: it stays deleted, listed as dropped (the caller keeps that version)
      const gone = rewrapNewer(before, edit(older, (l) => [l[0]!, l[4]!]), 0)
      expect(tasks(gone.doc)).toEqual([])
      expect(gone.dropped.map((n) => n.attrs?.itemId)).toEqual([A])
      // the page replaced as a whole: exactly that copy, every task dropped
      const restored = doc(P('Version one'), P('Title'))
      const whole = rewrapNewer(before, restored, 0, { whole: true })
      expect(whole.doc).toBe(restored)
      expect(whole.dropped).toHaveLength(1)
    }
  })

  test('rewrapNewer: the older build\'s own merge kept our task beside its edited copy — no doubling, both edits kept', () => {
    const P = (text: string, id?: string): JSONContent => ({ type: 'paragraph', ...(id ? { attrs: { id } } : {}), content: [{ type: 'text', text }] })
    const textOf = (n: JSONContent): string => (n.text ?? '') + (n.content ?? []).map(textOf).join('')
    const count = (d: JSONContent, s: string) => textOf(d).split(s).length - 1
    for (const ids of [true, false]) {
      const I = (id: string) => (ids ? id : undefined)
      const Rj = doc(P('Top', I('t')), item({ itemId: A, ...(ids ? { id: 'w1' } : {}) }, 'One'), P('Mid', I('m')), { type: 'workItem', attrs: { itemId: B, ...(ids ? { id: 'w2' } : {}) }, content: [P('Two', I('t2')), P('two note', I('n2'))] }, P('End', I('e')))
      // we typed into task B; the older tab (its base: Rj, its editor: Rj unwrapped with ids made up) typed at the end
      const Rk = { ...Rj, content: Rj.content!.map((n) => (n.attrs?.itemId === B ? { ...n, content: [P('Two ours', I('t2')), n.content![1]!] } : n)) }
      let seq = 0
      const made = (d: JSONContent): JSONContent => ({ ...d, ...(d.type !== 'doc' && d.type !== 'text' && !d.attrs?.id ? { attrs: { ...d.attrs, id: `x${++seq}` } } : {}), ...(d.content ? { content: d.content.map(made) } : {}) })
      const ours = made(asGeneration(Rj, 0, 'unwrap'))
      ours.content = ours.content!.map((n) => (textOf(n) === 'End' ? { ...n, content: [{ type: 'text', text: 'End typed' }] } : n))
      const merged = mergeContent(Rj, Rk, ours)!
      const wrote = new Set([...newerBlockPrints(Rj), ...newerBlockPrints(Rk)])
      const r = rewrapNewer(Rk, merged, 0, { wrote: (print) => wrote.has(print) })
      expect(count(r.doc!, 'Two'), `ids ${ids}`).toBe(1)
      expect(count(r.doc!, 'two note')).toBe(1)
      expect(textOf(r.doc!)).toContain('Two ours')
      expect(textOf(r.doc!)).toContain('End typed')
      expect(r.doc!.content!.filter((n) => n.type === 'workItem').map((n) => n.attrs?.itemId)).toEqual([A, B])
    }
  })

  test('contentFingerprint: the stamp fits exactly the content written (a structured clone, JSON) — with or without tasks', () => {
    const withTask = doc(p('a'), item({ itemId: A }, 'Task'))
    expect(contentFingerprint(structuredClone(withTask))).toBe(contentFingerprint(withTask))
    expect(contentFingerprint(JSON.parse(JSON.stringify(withTask)))).toBe(contentFingerprint(withTask))
    expect(contentFingerprint(asGeneration(withTask, 0, 'unwrap'))).not.toBe(contentFingerprint(withTask))
    expect(contentFingerprint(doc(p('a')))).not.toBe(contentFingerprint(doc(p('b'))))
    expect(contentFingerprint(null)).toBe(contentFingerprint(undefined))
  })
})
