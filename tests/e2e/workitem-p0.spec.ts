/**
 * Task block (`workItem`) — the schema release (P0): every client reads, shows, stores, exports and diffs a
 * task, nothing creates one. Content holding tasks is injected through the store (setContent), never a UI path.
 *  - the read-only placard: status rail + LED key, the state in words + the id ("OPEN · 7F3A", "IN PROGRESS"
 *    in the signal colour), chips (due, people by name, link counts), done struck, one plate — 1440 / 390,
 *    light / dark;
 *  - editing the title keeps every attr; a reload keeps it all;
 *  - Markdown export writes `> [!TODO] Title {#wi_…}` + the field line; importing that file gives a plain quote
 *    (the reader is switched off);
 *  - a share link and the HTML export carry no ids, only frozen names;
 *  - history "Changes" lists the fields before → after;
 *  - a task inside a task (or a table cell) is moved out whole, after it;
 *  - no slash item, no Turn into, no ⌘K entry creates one.
 * The pure parts (itemAttrs, the Markdown form and its reader, freezeWorkItems, itemChanges) run without a page.
 */
import { strFromU8, unzipSync } from 'fflate'
import { readFileSync } from 'node:fs'
import type { Locator, Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, gotoPage, wsEval, createPage, doc, para, flush, reloadApp, editorOf, MOD } from './fixtures'
import { itemAttrs, MAX_LINKS, MAX_PEOPLE, storedItemAttrs } from '../../src/app/editor/workitem/attrs'
import { WORK_ITEMS_FROM_MARKDOWN, workItemFromQuote, workItemMarkdown, fieldLine, dueLabelEn } from '../../src/app/editor/workitem/markdown'
import { freezeWorkItems } from '../../src/app/editor/workitem/freeze'
import { itemChanges } from '../../src/app/editor/workitem/diff'
import { diffDocs } from '../../src/app/features/history/docDiff'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/* ------------------------------------------------------------------ */
/* Fixtures (fictional people and dates)                               */
/* ------------------------------------------------------------------ */

const DUE = '2031-10-17' // a Friday
const DUE_TIMED = '2031-10-17T09:00'
const LATE = '2020-01-06'
const A = 'wi_7f3a9c2d01'
const B = 'wi_1b2c3d4e5f'
const C = 'wi_9d8e7f6a5b'
const D = 'wi_4c1a2b3c4d'
const E = 'wi_2e2e2e2e2e'

const p = (text: string): JSONContent => para(text)
const item = (attrs: Record<string, unknown>, title: string, ...notes: JSONContent[]): JSONContent => ({ type: 'workItem', attrs, content: [p(title), ...notes] })

/** Two people of this workspace (ids). */
async function addPeople(page: Page): Promise<{ alex: string; mara: string }> {
  return wsEval(page, (s) => ({ alex: s.addPerson('Alex Kern') as string, mara: s.addPerson('Mara Sommer') as string }))
}

function launchPlan(alex: string, mara: string): JSONContent {
  return doc(
    p('Everything that has to happen before the launch.'),
    item({ itemId: A, status: 'todo', due: DUE, reminder: '-1d', people: [alex, mara], blockedBy: [], related: [] }, 'Run the checkout with test cards'),
    item(
      { itemId: B, status: 'in_progress', due: DUE, people: [mara], related: [A] },
      'Approve the final pricing copy',
      p('The last draft is in the team wiki.'),
      {
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: true }, content: [p('Name the plans')] },
          { type: 'taskItem', attrs: { checked: false }, content: [p('Shorten the small print')] },
        ],
      },
    ),
    item({ itemId: C, status: 'todo', due: DUE_TIMED, people: [alex], blockedBy: [A, B] }, 'Switch the pricing page live'),
    item({ itemId: D, status: 'todo', due: LATE, people: [alex] }, 'Move the invoice template to the new plans'),
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Done' }] },
    item({ itemId: E, status: 'done', doneAt: 1_760_000_000_000, people: [mara] }, 'Legal review of the terms'),
    p('A plain paragraph after the tasks.'),
  )
}

async function launchPage(page: Page): Promise<{ id: string; alex: string; mara: string }> {
  const { alex, mara } = await addPeople(page)
  const id = await createPage(page, { title: 'Launch plan', content: launchPlan(alex, mara) })
  return { id, alex, mara }
}

/** The task blocks of a page in the store (attrs + title text), in document order. */
async function storedItems(page: Page, id: string): Promise<Array<{ attrs: AnyState; title: string; notes: string[] }>> {
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

const FIELDS = ['itemId', 'status', 'due', 'reminder', 'people', 'blockedBy', 'related', 'doneAt'] as const
/** A task's fields as every reader sees them (itemAttrs: an attr left out reads as its default, as the editor stores it). */
const fields = (a: AnyState) => {
  const s = itemAttrs(a)
  return Object.fromEntries(FIELDS.map((k) => [k, s[k]]))
}

const items = (page: Page, id: string) => editorOf(page, id).locator('.workitem')

/* ------------------------------------------------------------------ */
/* The placard                                                          */
/* ------------------------------------------------------------------ */

test.describe('task block (P0): the read-only placard', () => {
  test('label, status key, chips, done struck, one plate — at 1440 and 390, light and dark', async ({ page }) => {
    await openApp(page)
    const { id } = await launchPage(page)
    await gotoPage(page, id)
    const all = items(page, id)
    await expect(all).toHaveCount(5)
    await expect(all.nth(0)).toHaveAttribute('data-status', 'todo')
    await expect(all.nth(1)).toHaveAttribute('data-status', 'in_progress')
    await expect(all.nth(4)).toHaveAttribute('data-status', 'done')

    for (const [w, h, scheme] of [
      [1440, 900, 'light'],
      [1440, 900, 'dark'],
      [390, 844, 'dark'],
      [390, 844, 'light'],
    ] as const) {
      await page.setViewportSize({ width: w, height: h })
      await page.emulateMedia({ colorScheme: scheme })
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme)
      const first = all.nth(0)
      await first.scrollIntoViewIfNeeded()
      // the key: a keycap with the LED — not a control in this release
      const key = first.locator('.workitem__key')
      await expect(key).toHaveAttribute('aria-label', 'Status: Open')
      await expect(first.locator('button')).toHaveCount(0)
      await expect(all.nth(1).locator('.workitem__key .led--on')).toHaveCount(1)
      await expect(all.nth(4).locator('.workitem__key .led--ok')).toHaveCount(1)
      // the spec label: the state in words + the last four of the itemId ("OPEN · 2D01"); on a phone only the
      // states nothing else says (in progress) — the id goes
      const state = (i: number) => all.nth(i).locator('.workitem__state')
      if (w > 420) {
        await expect(state(0)).toHaveText('Open')
        await expect(first.locator('.workitem__id')).toHaveText(' · 2D01')
        await expect(state(3)).toHaveText('Overdue')
        await expect(state(3)).toHaveAttribute('data-signal', '')
        await expect(state(4)).toHaveText('Done Thu 09 Oct')
      } else {
        await expect(first.locator('.workitem__label')).toBeHidden()
        await expect(all.nth(1).locator('.workitem__id')).toBeHidden()
      }
      await expect(state(1)).toHaveText('In progress')
      await expect(state(1)).toBeVisible()
      await expect(state(1)).toHaveAttribute('data-signal', '')
      // chips: due (+ reminder), people by name, counts of linked tasks
      await expect(first.locator('.workitem__chip--due')).toContainText('Fri 17 Oct')
      await expect(first.locator('.workitem__rem')).toHaveAttribute('title', 'Reminder −1 d')
      await expect(first.locator('.workitem__chip--person')).toHaveText([/Alex Kern/, /Mara Sommer/])
      await expect(all.nth(1).locator('.workitem__chip--related')).toHaveText('1 related')
      await expect(all.nth(2).locator('.workitem__chip--due')).toContainText('Fri 17 Oct · 9:00 AM')
      await expect(all.nth(2).locator('.workitem__chip--blocked')).toHaveText('Depends on 2')
      await expect(all.nth(3).locator('.workitem__chip--due')).toHaveAttribute('data-late', '')
      await expect(all.nth(3).locator('.workitem__chip--due')).toContainText(/Overdue · \d+ d\s*·\s*Mon 06 Jan/)
      // done: dimmed, the title struck
      const doneTitle = all.nth(4).locator('p').first()
      expect(await doneTitle.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain('line-through')
      // consecutive tasks: one plate, 2 px apart
      const a = (await all.nth(0).boundingBox())!
      const b = (await all.nth(1).boundingBox())!
      expect(Math.round(b.y - (a.y + a.height))).toBe(2)
      // nothing wider than the screen
      for (let i = 0; i < 5; i++) {
        const box = (await all.nth(i).boundingBox())!
        expect(box.x + box.width, `task ${i} fits at ${w}px`).toBeLessThanOrEqual(w)
      }
    }
  })

  test('editing the title keeps every attr; a reload keeps the tasks', async ({ page }) => {
    await openApp(page)
    const { id } = await launchPage(page)
    const before = await storedItems(page, id)
    await gotoPage(page, id)
    const title = items(page, id).nth(0).locator('p').first()
    await title.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' today')
    await expect.poll(async () => (await storedItems(page, id))[0]?.title).toBe('Run the checkout with test cards today')
    const after = await storedItems(page, id)
    expect(after.map((x) => fields(x.attrs))).toEqual(before.map((x) => fields(x.attrs)))
    // the notes of the second task are untouched content
    expect(after[1]!.notes).toEqual(['The last draft is in the team wiki.', 'Name the plansShorten the small print'])

    await flush(page)
    await reloadApp(page)
    await gotoPage(page, id)
    await expect(items(page, id)).toHaveCount(5)
    await expect(items(page, id).nth(0).locator('p').first()).toHaveText('Run the checkout with test cards today')
    expect((await storedItems(page, id)).map((x) => fields(x.attrs))).toEqual(before.map((x) => fields(x.attrs)))
  })

  test('a task inside a task, or in a table cell, is moved out whole — after the task / the table, fields and all', async ({ page }) => {
    await openApp(page)
    const nested = doc(
      item({ itemId: A, status: 'todo' }, 'Outer task', p('Outer note'), item({ itemId: B, status: 'done' }, 'Inner task', p('Inner note'))),
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: [{ type: 'tableHeader', content: [p('Head')] }] },
          { type: 'tableRow', content: [{ type: 'tableCell', content: [item({ itemId: C }, 'Task in a cell')] }] },
        ],
      },
    )
    const id = await createPage(page, { title: 'Nested', content: nested })
    await gotoPage(page, id)
    await expect
      .poll(() =>
        wsEval(
          page,
          (s, id) => {
            let bad = 0
            const walk = (n: AnyState, banned: boolean) => {
              if (n.type === 'workItem' && banned) bad++
              ;(n.content ?? []).forEach((c: AnyState) => walk(c, banned || n.type === 'workItem' || n.type === 'tableCell' || n.type === 'tableHeader'))
            }
            walk(s.pages[id]?.content ?? {}, false)
            return bad
          },
          id,
        ),
      )
      .toBe(0)
    const left = await storedItems(page, id)
    // B right after A (out of its notes), C right after the table — every field kept
    expect(left.map((x) => x.attrs.itemId)).toEqual([A, B, C])
    expect(left[0]!.notes).toEqual(['Outer note'])
    expect(left[1]).toMatchObject({ title: 'Inner task', notes: ['Inner note'] })
    expect(itemAttrs(left[1]!.attrs).status).toBe('done')
    expect(await wsEval(page, (s, id) => (s.pages[id].content.content as AnyState[]).map((n) => n.type), id)).toEqual(['workItem', 'workItem', 'table', 'workItem', 'paragraph'])
    await expect(editorOf(page, id).locator('td')).not.toContainText('Task in a cell')
    await expect(items(page, id)).toHaveCount(3)
  })

  test('nothing creates a task: no slash item, no Turn into, no ⌘K entry', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'No creation', content: doc(p('A line of text.'), p('')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p').nth(1).click()
    for (const q of ['task', 'aufgabe', 'workitem', 'todo']) {
      await page.keyboard.type(`/${q}`)
      const names = await page.locator('.slash .slash__name').allTextContents()
      expect(names, `/${q}`).not.toContain('Task')
      expect(names, `/${q}`).not.toContain('Aufgabe')
      await page.keyboard.press('Escape')
      for (let i = 0; i <= q.length; i++) await page.keyboard.press('Backspace')
    }
    // Turn into (block menu, Alt+Enter)
    await ed.locator('p').first().click()
    await page.keyboard.press('Alt+Enter')
    const menu = page.locator('[data-popover][role="menu"]').first()
    await menu.getByRole('menuitem', { name: 'Turn into', exact: true }).click()
    const turn = await page.getByRole('menuitem').allTextContents()
    expect(turn.some((s) => /^\s*(Task|Aufgabe)\b/.test(s))).toBe(false)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    // ⌘K
    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('task')
    const options = await page.locator('[cmdk-item]').allTextContents()
    expect(options.some((s) => /\b(new|insert|add|create) task\b/i.test(s) || /^\s*Task\s*$/.test(s))).toBe(false)
    await page.keyboard.press('Escape')
    // pasting an exported / shared placard (frozen: no ids) gives its text as plain blocks, not a task
    await ed.locator('p').nth(1).click()
    await ed.evaluate((el) => {
      const html =
        '<div data-type="work-item" class="workitem" data-status="todo" data-frozen="{&quot;people&quot;:[&quot;Alex Kern&quot;],&quot;blockedBy&quot;:0,&quot;related&quot;:0}"><div class="workitem__head" contenteditable="false"><span class="workitem__label">Task</span></div><div class="workitem__body"><p>Pasted placard title</p></div></div>'
      const dt = new DataTransfer()
      dt.setData('text/html', html)
      dt.setData('text/plain', 'Pasted placard title')
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    })
    await expect(ed).toContainText('Pasted placard title')
    await expect(ed.locator('.workitem')).toHaveCount(0)
    // and German: the same
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await ed.locator('p').nth(1).click()
    await page.keyboard.type('/aufgabe')
    expect(await page.locator('.slash .slash__name').allTextContents()).not.toContain('Aufgabe')
    await page.keyboard.press('Escape')
    expect(await wsEval(page, (s, id) => JSON.stringify(s.pages[id]?.content ?? {}).includes('workItem'), id)).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* Leaving the workspace: Markdown, share link, HTML export            */
/* ------------------------------------------------------------------ */

async function exportAs(page: Page, kind: RegExp, out: string): Promise<string> {
  await page.keyboard.press(`${MOD}+k`)
  await page.keyboard.type('>export')
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('radio', { name: kind }).click()
  const download = page.waitForEvent('download')
  await dialog.locator('[data-export-run]').click()
  await (await download).saveAs(out)
  await page.keyboard.press('Escape')
  return out
}

async function pickFiles(page: Page, files: Array<{ name: string; mimeType: string; buffer: Buffer }>) {
  const dialog = page.getByRole('dialog')
  const chooser = page.waitForEvent('filechooser')
  await dialog.getByRole('button', { name: 'Choose files' }).click()
  await (await chooser).setFiles(files)
}

test.describe('task block (P0): Markdown, share link, HTML export', () => {
  test('Markdown export writes the [!TODO] form; importing that file gives a plain quote (the reader is off)', async ({ page }, testInfo) => {
    await openApp(page)
    const { id, alex, mara } = await launchPage(page)
    await gotoPage(page, id)
    const zip = unzipSync(new Uint8Array(readFileSync(await exportAs(page, /Markdown folder/, testInfo.outputPath('launch.zip')))))
    const name = Object.keys(zip).find((n) => n.endsWith('.md'))!
    const md = strFromU8(zip[name]!)
    expect(md).toContain(`> [!TODO] Run the checkout with test cards {#${A}}\n> Due: [@Fri 17 Oct](one:date/2031-10-17?r=-1d) · Owner: [@Alex Kern](one:person/${alex}), [@Mara Sommer](one:person/${mara})`)
    expect(md).toContain(
      `> [!TODO] Approve the final pricing copy {#${B}}\n> Status: in progress · Due: [@Fri 17 Oct](one:date/2031-10-17) · Owner: [@Mara Sommer](one:person/${mara}) · Related: [${A}](one:item/${A})\n>\n> The last draft is in the team wiki.`,
    )
    expect(md).toMatch(/> - \[x\] Name the plans\n> - \[ \] Shorten the small print/)
    expect(md).toContain(`> Due: [@Fri 17 Oct 09:00](one:date/2031-10-17T09:00) · Owner: [@Alex Kern](one:person/${alex}) · Blocked by: [${A}](one:item/${A}), [${B}](one:item/${B})`)
    // the time it was done rides in the id braces (lossless)
    expect(md).toContain(`> [!TODO] Legal review of the terms {#${E} done=2025-10-09T08:53:20.000Z}\n> Status: done · Owner: [@Mara Sommer](one:person/${mara})`)
    // a todo status and empty fields are left out
    expect(md).not.toContain('Status: todo')

    // reading it back: a plain quote (P0 never creates a task from Markdown)
    await page.locator('.sb').getByRole('button', { name: /^Import/ }).click()
    await pickFiles(page, [{ name: 'launch-plan.md', mimeType: 'text/markdown', buffer: Buffer.from(md) }])
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(/Import complete/)).toBeVisible()
    await dialog.getByRole('button', { name: 'View import' }).click()
    const imported = await wsEval(page, (s, id) => {
      const page = (Object.values(s.pages) as AnyState[]).find((x) => x.id !== id && !x.trashed && /Run the checkout with test cards/.test(x.plain ?? ''))
      return page ? { json: JSON.stringify(page.content), types: (page.content?.content ?? []).map((n: AnyState) => n.type) } : null
    }, id)
    expect(imported).not.toBeNull()
    expect(imported!.json).not.toContain('workItem')
    expect(imported!.types).toContain('blockquote')
    expect(imported!.json).toContain('[!TODO] Run the checkout with test cards')
    // the date / person links became mentions as always; a task link keeps its text, without the link
    expect(imported!.json).toContain('"kind":"date"')
    expect(imported!.json).not.toContain('one:item')
  })

  test('a share link and the HTML export carry no ids — the names are frozen in', async ({ page, browser, errors }, testInfo) => {
    await openApp(page)
    const { id, alex, mara } = await launchPage(page)
    await gotoPage(page, id)

    // HTML export: the static placard, styled, without ids
    const html = readFileSync(await exportAs(page, /Web page/, testInfo.outputPath('launch.html')), 'utf8')
    expect(html).toContain('data-type="work-item"')
    expect(html).toContain('class="workitem"')
    expect(html).toMatch(/data-status="in_progress"/)
    expect(html).toContain('Alex Kern')
    expect(html).toContain('Depends on 2')
    expect(html).toContain('.workitem{')
    for (const secret of ['wi_', alex, mara, 'data-item-id', 'data-people', 'data-blocked-by', 'data-reminder']) expect(html, secret).not.toContain(secret)

    // share link: rendered by the receiving side, names only
    await page.locator('.tb').getByRole('button', { name: 'Share', exact: true }).click()
    const link = await page.getByRole('dialog').getByRole('textbox', { name: 'Share link' }).inputValue()
    await page.keyboard.press('Escape')
    const other = await browser.newContext({ serviceWorkers: 'block', locale: 'en-US' })
    const p2 = await other.newPage()
    errors.watch(p2)
    await p2.goto(link)
    const shared = p2.locator('.shv__doc')
    await expect(shared.locator('.workitem')).toHaveCount(5)
    // frozen: the state in words, no id
    await expect(shared.locator('.workitem').nth(0).locator('.workitem__state')).toHaveText('Open')
    await expect(shared.locator('.workitem').nth(0).locator('.workitem__id')).toHaveCount(0)
    await expect(shared.locator('.workitem').nth(0).locator('.workitem__chip--person')).toHaveText([/Alex Kern/, /Mara Sommer/])
    await expect(shared.locator('.workitem').nth(2).locator('.workitem__chip--blocked')).toHaveText('Depends on 2')
    await expect(shared.locator('.workitem').nth(4)).toHaveAttribute('data-status', 'done')
    const inner = await shared.innerHTML()
    for (const secret of ['wi_', alex, mara]) expect(inner, secret).not.toContain(secret)
    await other.close()
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

async function openHistory(page: Page): Promise<Locator> {
  await page.locator('.tb').getByRole('button', { name: 'Version history' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('.hist__title')).toBeVisible()
  return dialog
}

async function saveVersion(page: Page, pageId: string, count: number) {
  const dialog = await openHistory(page)
  await dialog.locator('.hist__head').getByRole('button', { name: 'Save version' }).click()
  await expect.poll(() => versionCount(page, pageId)).toBe(count)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
}

test.describe('task block (P0): history', () => {
  test('Changes lists the fields of a task before → after (itemId and doneAt never count)', async ({ page }) => {
    await openApp(page)
    const { alex, mara } = await addPeople(page)
    const v1 = doc(item({ itemId: A, status: 'todo', due: DUE, people: [alex] }, 'Ship the pricing page'))
    const v2 = doc(item({ itemId: A, status: 'done', doneAt: 1_760_000_000_000, due: '2031-10-20', people: [alex, mara], blockedBy: [B] }, 'Ship the pricing page'))
    const id = await createPage(page, { title: 'History of a task', content: v1 })
    await gotoPage(page, id)
    await saveVersion(page, id, 1)
    await wsEval(page, (s, { id, content }) => s.setContent(id, content, 'e2e'), { id, content: v2 })
    await expect(items(page, id).nth(0)).toHaveAttribute('data-status', 'done')
    await saveVersion(page, id, 2)
    const dialog = await openHistory(page)
    const preview = dialog.locator('.hist__preview')
    const changes = preview.getByTestId('workitem-changes')
    await expect(changes).toBeVisible()
    await expect(changes.locator('dt')).toHaveText(['Status', 'Due', 'People', 'Blocked by'])
    const row = (field: string) => changes.locator(`[data-field="${field}"] dd`)
    await expect(row('status').locator('del')).toHaveText('Open')
    await expect(row('status').locator('ins')).toHaveText('Done')
    await expect(row('due').locator('del')).toHaveText('Fri 17 Oct')
    await expect(row('due').locator('ins')).toHaveText('Mon 20 Oct')
    await expect(row('people')).toHaveText('Alex Kern, Mara Sommer')
    await expect(row('people').locator('ins')).toHaveText('Mara Sommer')
    await expect(row('blockedBy').locator('del')).toHaveText('—')
    await expect(row('blockedBy').locator('ins')).toHaveText('1 task')
    // the placard as it is now, in the diff
    await expect(preview.locator('.workitem')).toHaveAttribute('data-status', 'done')
  })
})

/* ------------------------------------------------------------------ */
/* Pure                                                                */
/* ------------------------------------------------------------------ */

test.describe('task block (P0): pure parts', () => {
  test('itemAttrs: the one sanitizer — formats, limits, reminder only with a due date, doneAt only when done', () => {
    const people = Array.from({ length: 20 }, (_, i) => `p${i}`)
    const links = Array.from({ length: 30 }, (_, i) => `wi_${String(i).padStart(10, '0')}`)
    const a = itemAttrs({ itemId: A, status: 'in_progress', due: '2031-02-30', reminder: '-1d', people: [...people, 'p1', 'bad id', 42], blockedBy: [...links, A, 'junk'], related: 'wi_aaaaaaaaaa wi_bbbbbbbbbb', doneAt: 5 })
    expect(a.status).toBe('in_progress')
    expect(a.due).toBeNull()
    expect(a.reminder).toBeNull()
    expect(a.people).toHaveLength(MAX_PEOPLE)
    expect(a.blockedBy).toHaveLength(MAX_LINKS)
    expect(a.blockedBy).not.toContain(A)
    expect(a.related).toEqual(['wi_aaaaaaaaaa', 'wi_bbbbbbbbbb'])
    expect(a.doneAt).toBeNull()
    expect(itemAttrs({ itemId: 'wi_short', status: 'blocked', due: '2031-10-17T25:00', people: 'u1,u2' })).toMatchObject({ itemId: null, status: 'todo', due: null, people: ['u1', 'u2'] })
    expect(itemAttrs({ type: 'workItem', attrs: { status: 'done', doneAt: '1760000000000', due: DUE_TIMED, reminder: 'at' } })).toMatchObject({ status: 'done', doneAt: 1_760_000_000_000, due: DUE_TIMED, reminder: 'at' })
    expect(itemAttrs({ frozen: JSON.stringify({ people: ['Alex\u0000 Kern', '', 'x'.repeat(200)], blockedBy: 99, related: -3 }) }).frozen).toEqual({ people: ['Alex Kern', 'x'.repeat(80)], blockedBy: MAX_LINKS, related: 0 })
    expect(storedItemAttrs(itemAttrs({}))).toEqual({ id: null, itemId: null, status: 'todo', due: null, reminder: null, people: [], blockedBy: [], related: [], doneAt: null })
  })

  test('the Markdown form: field line in English, todo and empty fields left out, frozen people as names', () => {
    const names: Record<string, string> = { u1: 'Alex', u2: 'Mara [QA]' }
    const labels = { person: (id: string) => names[id] ?? null }
    expect(dueLabelEn('2026-10-17')).toBe('Sat 17 Oct')
    expect(dueLabelEn('2031-10-17T09:00')).toBe('Fri 17 Oct 09:00')
    expect(fieldLine(itemAttrs({}), labels)).toBe('')
    const a = itemAttrs({ itemId: A, status: 'in_progress', due: DUE, reminder: '-1d', people: ['u1', 'u2', 'gone'], blockedBy: [B], related: [C] })
    expect(workItemMarkdown(a, 'Ship **it**', '- [ ] step\n\nnotes', labels)).toBe(
      [
        `> [!TODO] Ship **it** {#${A}}`,
        `> Status: in progress · Due: [@Fri 17 Oct](one:date/${DUE}?r=-1d) · Owner: [@Alex](one:person/u1), [@Mara \\[QA\\]](one:person/u2), [@gone](one:person/gone) · Blocked by: [${B}](one:item/${B}) · Related: [${C}](one:item/${C})`,
        '>',
        '> - [ ] step',
        '>',
        '> notes',
      ].join('\n'),
    )
    expect(workItemMarkdown(itemAttrs({ frozen: { people: ['Alex'], blockedBy: 2 } }), 'Frozen', '', labels)).toBe('> [!TODO] Frozen\n> Owner: Alex')
  })

  test('the Markdown reader (built, switched off): EN + DE fields, an unknown key stays text, the id comes back', () => {
    expect(WORK_ITEMS_FROM_MARKDOWN).toBe(false)
    const link = (text: string, href: string): JSONContent => ({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] })
    const quote = (first: JSONContent[], ...rest: JSONContent[]): JSONContent => ({ type: 'blockquote', content: [{ type: 'paragraph', content: first }, ...rest] })
    const en = workItemFromQuote(
      quote(
        [
          { type: 'text', text: `[!TODO] Ship the pricing page {#${A}}\nStatus: in progress · Due: ` },
          link('@Fri 17 Oct', 'one:date/2031-10-17?r=-1d'),
          { type: 'text', text: ' · Owner: ' },
          link('@Alex', 'one:person/u_1'),
          { type: 'text', text: ' · Blocked by: ' },
          link('Draft copy', `one:item/${B}`),
          { type: 'text', text: ` · Related: ${C}` },
        ],
        p('notes'),
      ),
    )!
    expect(en.type).toBe('workItem')
    expect(itemAttrs(en)).toMatchObject({ itemId: A, status: 'in_progress', due: DUE, reminder: '-1d', people: ['u_1'], blockedBy: [B], related: [C] })
    expect(en.content!.map((n) => n.content?.map((c) => c.text).join(''))).toEqual(['Ship the pricing page', 'notes'])

    const de = workItemFromQuote(quote([{ type: 'text', text: '[!todo] Rechnung prüfen\nStatus: erledigt · Fällig: 2031-10-17T09:00 · Verknüpft: ' }, link('Entwurf', `one:item/${B}`)]))!
    expect(itemAttrs(de)).toMatchObject({ itemId: null, status: 'done', due: DUE_TIMED, related: [B] })

    // an unknown key (or a bare name for an owner): the line stays the first note
    const odd = workItemFromQuote(quote([{ type: 'text', text: '[!TODO] Call the printer\nOwner: Alex · Priority: high' }]))!
    expect(itemAttrs(odd)).toMatchObject({ status: 'todo', people: [] })
    expect(odd.content!.map((n) => n.content?.map((c) => c.text).join(''))).toEqual(['Call the printer', 'Owner: Alex · Priority: high'])
    // other quotes are none of its business
    expect(workItemFromQuote(quote([{ type: 'text', text: '[!NOTE] Just a note' }]))).toBeNull()
    expect(workItemFromQuote(quote([{ type: 'text', text: 'TODO: not the marker' }]))).toBeNull()
  })

  test('freezeWorkItems: names and status kept, every id and the reminder gone; idempotent', () => {
    const src = doc(item({ id: 'blk1', itemId: A, status: 'in_progress', due: DUE, reminder: 'at', people: ['u1', 'gone'], blockedBy: [B, C], related: [D] }, 'Frozen task'))
    const frozen = freezeWorkItems(src, (id) => (id === 'u1' ? 'Alex Kern' : null))
    const a = frozen.content![0]!.attrs!
    expect(a).toMatchObject({ id: null, itemId: null, status: 'in_progress', due: DUE, reminder: null, people: [], blockedBy: [], related: [], frozen: { people: ['Alex Kern'], blockedBy: 2, related: 1 } })
    expect(JSON.stringify(frozen)).not.toMatch(/wi_|u1|blk1/)
    expect(freezeWorkItems(frozen, () => 'someone else')).toEqual(frozen)
    const plain = doc(p('no tasks'))
    expect(freezeWorkItems(plain, () => null)).toBe(plain)
  })

  test('itemChanges + the history diff: fields before → after; an itemId / doneAt change alone is no change', () => {
    const before = { itemId: A, status: 'todo', due: DUE, people: ['u1'] }
    const after = { itemId: 'wi_zzzzzzzzzz', status: 'done', doneAt: 1, due: DUE, reminder: 'at', people: ['u1', 'u2'], related: [B] }
    expect(itemChanges(before, after).map((c) => [c.field, c.added, c.removed])).toEqual([
      ['status', [], []],
      ['reminder', [], []],
      ['people', ['u2'], []],
      ['related', [B], []],
    ])
    const v1 = doc(item({ itemId: A, status: 'todo' }, 'Same'))
    const v2 = doc(item({ itemId: 'wi_zzzzzzzzzz', status: 'todo', doneAt: 99 }, 'Same'))
    expect(diffDocs(v1, v2).every((x) => x.kind === 'same')).toBe(true)
    // the defaults the editor fills in when it first writes a task are no change either
    const filled = doc(item({ itemId: A, status: 'todo', due: null, reminder: null, people: [], blockedBy: [], related: [], doneAt: null, frozen: null }, 'Same'))
    expect(diffDocs(doc(item({ itemId: A }, 'Same')), filled).every((x) => x.kind === 'same')).toBe(true)
    const v3 = doc(item({ itemId: A, status: 'done' }, 'Same'))
    const changed = diffDocs(v1, v3).find((x) => x.kind === 'changed')
    expect(changed && changed.kind === 'changed' ? changed.merged.was : null).toMatchObject({ status: 'todo' })
  })
})
