/**
 * Version history compares a version with the one before it (default) or with now, and its Version
 * view marks what was new in it. Three versions A → B → C of a page and the page now (D):
 *  - Changes · To the previous version: B shows only what B added to A (signal-marked), nothing of C or D;
 *  - Changes · To now: B → the page now, as before;
 *  - Version: B as it was, B's new words marked, nothing struck, nothing folded; the switch turns it off;
 *  - the oldest version counts as all added; "Now" shows the newest version → the page now;
 *  - the choices stay on this device (localStorage one.history.compare / one.history.markNew);
 *  - a database row: a property changed between two versions shows in the Properties block;
 *  - German at 390 px, nothing wider than the screen.
 * The pure helper (docDiff withoutRemovals / newWordRuns) is tested without a page.
 */
import type { Locator, Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, gotoPage, wsEval, uiEval, createPage, doc, para, flush } from './fixtures'
import { diffDocs, newWordRuns, textOf, withoutRemovals, type DiffNode } from '../../src/app/features/history/docDiff'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const A = doc(para('The launch plan starts on Monday.'), para('Budget is open for now.'))
const B = doc(para('The launch plan starts early on Monday.'), para('Budget is open for now.'), para('Owner: Mara Lind.'))
const C = doc(para('The launch plan starts early on Monday.'), para('Budget is approved for now.'), para('Owner: Mara Lind.'))
const D = doc(para('The launch plan starts early on Monday.'), para('Budget is approved for now.'), para('Owner: Mara Lind.'), para('Launch in May.'))

/** How many versions a page has (IndexedDB one-history). */
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

/** "Save version" in the dialog, then close it. */
async function saveVersion(page: Page, pageId: string, count: number) {
  const dialog = await openHistory(page)
  await dialog.locator('.hist__head').getByRole('button', { name: 'Save version' }).click()
  await expect.poll(() => versionCount(page, pageId)).toBe(count)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
}

/** A page with the versions A, B, C (saved by hand) and D as it is now. */
async function threeVersions(page: Page): Promise<string> {
  const id = await createPage(page, { title: 'Launch plan', content: A })
  await gotoPage(page, id)
  await saveVersion(page, id, 1)
  for (const [n, content] of [
    [2, B],
    [3, C],
  ] as const) {
    await wsEval(page, (s, { id, content }) => s.setContent(id, content, 'e2e'), { id, content })
    await saveVersion(page, id, n)
  }
  await wsEval(page, (s, { id, content }) => s.setContent(id, content, 'e2e'), { id, content: D })
  await expect(page.locator('#main .ProseMirror').first()).toContainText('Launch in May.')
  await flush(page)
  return id
}

/** The list rows, newest first: Now, C, B, A. */
const row = (dialog: Locator, n: number) => dialog.locator('.hist__row').nth(n)

test.describe('version history: what is new to the previous version', () => {
  test('A → B → C: Changes to the previous version shows only what B added; To now shows B → now; Version marks B’s new words; the choices stay', async ({ page }) => {
    await openApp(page)
    await threeVersions(page)
    let dialog = await openHistory(page)
    const preview = dialog.locator('.hist__preview')
    const compare = dialog.getByRole('radiogroup', { name: 'Compare' })
    const toPrev = compare.getByRole('radio', { name: 'To the previous version' })
    const toNow = compare.getByRole('radio', { name: 'To now' })

    await row(dialog, 2).click()
    await expect(row(dialog, 2)).toHaveAttribute('aria-current', 'true')
    // the default: compared with the version before (A)
    await expect(toPrev).toHaveAttribute('aria-checked', 'true')
    await expect(toNow).toHaveAttribute('aria-checked', 'false')
    const banner = dialog.getByTestId('hist-banner')
    await expect(banner).toContainText('Compared with the previous version (')
    await expect(banner).toContainText('~1 changed')
    await expect(banner).toContainText('+1 added')
    await expect(banner).toContainText('−0 removed')
    await expect(preview.locator('.ddiff-ins')).toHaveText(['early'])
    await expect(preview.locator('.ddiff__seg[data-state="added"]')).toHaveText(/Owner: Mara Lind\./)
    await expect(preview.locator('.ddiff-del')).toHaveCount(0)
    // nothing of what came later (C, D)
    await expect(preview).not.toContainText('approved')
    await expect(preview).not.toContainText('Launch in May')

    // the radio group by keyboard: → picks "To now" and leaves the playhead where it is
    const digits = await dialog.locator('.hist__digits').textContent()
    await toPrev.focus()
    await page.keyboard.press('ArrowRight')
    await expect(toNow).toHaveAttribute('aria-checked', 'true')
    await expect(toNow).toBeFocused()
    await expect(dialog.locator('.hist__digits')).toHaveText(digits!)
    // To now: B → the page now (as before)
    await expect(banner).toContainText('What changed from this version until now')
    await expect(preview.locator('.ddiff-del')).toHaveText(['open'])
    await expect(preview.locator('.ddiff-ins')).toHaveText(['approved'])
    await expect(preview.locator('.ddiff__seg[data-state="added"]')).toHaveText(/Launch in May\./)
    await page.keyboard.press('ArrowLeft')
    await expect(toPrev).toHaveAttribute('aria-checked', 'true')
    await expect(preview.locator('.ddiff-ins')).toHaveText(['early'])
    await toNow.click()

    // Version: B as it was — its new words marked, nothing struck, nothing folded
    await dialog.getByRole('tab', { name: 'Version', exact: true }).click()
    const mark = dialog.getByRole('switch', { name: 'Mark what’s new' })
    await expect(mark).toHaveAttribute('aria-checked', 'true')
    await expect(dialog.getByTestId('hist-new-note')).toContainText('New since the previous version (')
    const marked = dialog.getByTestId('hist-new')
    await expect(marked.locator('.ddiff-ins')).toHaveText(['early'])
    await expect(marked.locator('.ddiff__seg[data-state="added"]')).toHaveText(/Owner: Mara Lind\./)
    await expect(marked.locator('.ddiff-del:visible')).toHaveCount(0)
    await expect(marked.locator('.ddiff__fold')).toHaveCount(0)
    await expect(marked).toContainText('Budget is open for now.')
    await expect(marked).toContainText('The launch plan starts early on Monday.')
    await expect(preview).not.toContainText('Launch in May')
    // C in Version: "approved" new, the "open" it replaced not shown
    await row(dialog, 1).click()
    await expect(marked.locator('.ddiff-ins')).toHaveText(['approved'])
    await expect(preview).not.toContainText('open')
    await expect(preview).toContainText('Budget is approved for now.')
    // the switch turns marking off: the plain version
    await mark.click()
    await expect(mark).toHaveAttribute('aria-checked', 'false')
    await expect(preview.locator('.ddiff')).toHaveCount(0)
    await expect(preview.locator('.ddiff-ins')).toHaveCount(0)
    await expect(preview).toContainText('Budget is approved for now.')

    // both choices stay on this device
    expect(await page.evaluate(() => [localStorage.getItem('one.history.compare'), localStorage.getItem('one.history.markNew')])).toEqual(['now', '0'])
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    dialog = await openHistory(page)
    await expect(dialog.getByRole('radio', { name: 'To now' })).toHaveAttribute('aria-checked', 'true')
    await expect(dialog.getByTestId('hist-banner')).toContainText('What changed from this version until now')
    await dialog.getByRole('tab', { name: 'Version', exact: true }).click()
    await expect(dialog.getByRole('switch', { name: 'Mark what’s new' })).toHaveAttribute('aria-checked', 'false')
    await expect(dialog.locator('.hist__preview .ddiff')).toHaveCount(0)
  })

  test('the oldest version counts as all added; "Now" shows the newest version → the page now', async ({ page }) => {
    await openApp(page)
    await threeVersions(page)
    const dialog = await openHistory(page)
    const preview = dialog.locator('.hist__preview')
    const banner = dialog.getByTestId('hist-banner')

    // A: nothing before it
    await row(dialog, 3).click()
    await expect(banner).toContainText('The first version kept — all of it counts as added')
    await expect(banner).toContainText('+2 added')
    await expect(banner).not.toContainText('removed')
    await expect(preview.locator('.ddiff__seg[data-state="added"]')).toContainText(['The launch plan starts on Monday.'])
    await expect(preview.locator('.ddiff__seg[data-state="added"]')).toContainText(['Budget is open for now.'])
    await expect(preview.locator('.ddiff-del')).toHaveCount(0)
    await expect(preview.locator('.ddiff__seg[data-state="same"]')).toHaveCount(0)
    await dialog.getByRole('tab', { name: 'Version', exact: true }).click()
    // the Version tab of the oldest one: plain (nothing before it to mark against)
    await expect(dialog.getByTestId('hist-new-note')).toHaveText('The first version kept — nothing before it to compare with')
    await expect(preview.getByTestId('hist-new')).toHaveCount(0)
    await expect(preview).toContainText('The launch plan starts on Monday.')
    await dialog.getByRole('tab', { name: 'Changes' }).click()

    // Now: the newest version (C) → the page as it is
    await row(dialog, 0).click()
    await expect(dialog.getByRole('tab', { name: 'Changes' })).toHaveAttribute('aria-selected', 'true')
    await expect(banner).toContainText('Compared with the previous version (')
    await expect(banner).toContainText('+1 added')
    await expect(preview.locator('.ddiff__seg[data-state="added"]')).toHaveText(/Launch in May\./)
    await expect(preview.locator('.ddiff-ins')).toHaveCount(0)
    await expect(preview.locator('.ddiff-del')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Restore this version' })).toBeDisabled()
    // Version of "Now": the page itself, as before
    await dialog.getByRole('tab', { name: 'Version', exact: true }).click()
    await expect(preview.locator('.hist__banner--now')).toBeVisible()
    await expect(preview.locator('.ddiff')).toHaveCount(0)
    await expect(preview).toContainText('Launch in May.')
    // To now: "Now" is the page itself — no tabs, the choice stays at hand
    await dialog.getByRole('tab', { name: 'Changes' }).click()
    await dialog.getByRole('radio', { name: 'To now' }).click()
    await expect(dialog.getByRole('tablist')).toHaveCount(0)
    await expect(preview.locator('.hist__banner--now')).toBeVisible()
    await expect(dialog.getByRole('radio', { name: 'To now' })).toHaveAttribute('aria-checked', 'true')
    await dialog.getByRole('radio', { name: 'To the previous version' }).click()
    await expect(dialog.getByRole('tablist')).toBeVisible()
    await expect(preview.locator('.ddiff__seg[data-state="added"]')).toHaveText(/Launch in May\./)

    // restore still restores the selected version
    await row(dialog, 2).click()
    await dialog.getByRole('button', { name: 'Restore this version' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('#main .ProseMirror').first()).toContainText('Budget is open for now.')
    await expect(page.locator('#main .ProseMirror').first()).not.toContainText('Launch in May.')
  })

  test('a database row: a property changed between two versions shows in the Properties block', async ({ page }) => {
    await openApp(page)
    const row_ = await wsEval(page, (s) => {
      const dbId = s.createDatabase({
        title: 'Release tasks',
        parentId: null,
        properties: [
          { id: 'p-title', name: 'Name', type: 'title' },
          {
            id: 'p-status',
            name: 'Status',
            type: 'status',
            options: [
              { id: 'o-prog', name: 'In progress', color: 'blue' },
              { id: 'o-done', name: 'Done', color: 'green' },
            ],
          },
          { id: 'p-est', name: 'Estimate', type: 'number', numberFormat: 'number' },
          { id: 'p-note', name: 'Note', type: 'text' },
        ],
      })
      return s.createRow(dbId, {
        title: 'Release notes',
        properties: { 'p-status': 'o-prog', 'p-est': 3, 'p-note': 'first draft' },
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Collect the changes of the month.' }] }] },
      }) as string
    })
    await gotoPage(page, row_)
    await saveVersion(page, row_, 1)
    await wsEval(page, (s, id) => {
      s.setRowProperty(id, 'p-status', 'o-done')
      s.setRowProperty(id, 'p-est', 5)
    }, row_)
    await saveVersion(page, row_, 2)
    await wsEval(page, (s, id) => s.setRowProperty(id, 'p-note', 'final copy'), row_)
    await flush(page)

    const dialog = await openHistory(page)
    // opens on the newest version that differs from now: version 2, compared with version 1
    await expect(dialog.locator('.hist__row').nth(1)).toHaveAttribute('aria-current', 'true')
    const block = dialog.getByTestId('hist-props')
    const line = (name: string) => block.locator('.hprops__row', { has: page.locator('.hprops__name', { hasText: new RegExp(`^${name}$`) }) })
    await expect(block.locator('.hprops__name')).toHaveText(['Status', 'Estimate'])
    await expect(line('Status').locator('del')).toHaveText('In progress')
    await expect(line('Status').locator('ins')).toHaveText('Done')
    await expect(line('Estimate').locator('del')).toHaveText('3')
    await expect(line('Estimate').locator('ins')).toHaveText('5')
    await expect(dialog.getByTestId('hist-banner')).toContainText('Properties 2')
    await expect(dialog.getByTestId('hist-banner')).toContainText('Compared with the previous version (')
    // to now: only the note changed since version 2
    await dialog.getByRole('radio', { name: 'To now' }).click()
    await expect(block.locator('.hprops__name')).toHaveText(['Note'])
    await expect(line('Note').locator('del')).toHaveText('first draft')
    await expect(line('Note').locator('ins')).toHaveText('final copy')
    // the oldest version: nothing before it, no Properties block
    await dialog.getByRole('radio', { name: 'To the previous version' }).click()
    await dialog.locator('.hist__row').nth(2).click()
    await expect(dialog.getByTestId('hist-banner')).toContainText('The first version kept')
    await expect(dialog.getByTestId('hist-props')).toHaveCount(0)
  })

  test('German at 390 px: Zur Vorversion | Bis jetzt, Neues markieren — nothing wider than the screen', async ({ page }) => {
    await openApp(page)
    const id = await threeVersions(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await uiEval(page, (s, pageId) => s.openModal({ type: 'history', pageId }), id)
    const dialog = page.getByRole('dialog')
    await expect(dialog.locator('.hist__title')).toBeVisible()
    // opens on C; one step back to B
    await expect(dialog.locator('.hist__digits')).toHaveText('003')
    await dialog.locator('.tape').focus()
    await page.keyboard.press('ArrowLeft')
    await expect(dialog.locator('.hist__digits')).toHaveText('002')
    const compare = dialog.getByRole('radiogroup', { name: 'Vergleich' })
    await expect(compare.getByRole('radio', { name: 'Zur Vorversion' })).toHaveAttribute('aria-checked', 'true')
    await expect(compare.getByRole('radio', { name: 'Bis jetzt' })).toBeVisible()
    await expect(dialog.getByTestId('hist-banner')).toContainText('Verglichen mit der Vorversion (')
    await expect(dialog.getByTestId('hist-banner')).toContainText('~1 geändert')
    await expect(dialog.locator('.hist__preview .ddiff-ins')).toHaveText(['early'])
    const fits = async () =>
      page.evaluate(() => {
        const preview = document.querySelector('.hist__preview') as HTMLElement
        const right = Math.max(...Array.from(document.querySelectorAll('.hist__bar, .hist__banner, .hist__seg, .hist__transport')).map((el) => el.getBoundingClientRect().right))
        return { page: document.documentElement.scrollWidth <= window.innerWidth, preview: preview.scrollWidth <= preview.clientWidth + 1, right: right <= window.innerWidth }
      })
    expect(await fits()).toEqual({ page: true, preview: true, right: true })
    await compare.getByRole('radio', { name: 'Bis jetzt' }).click()
    await expect(dialog.getByTestId('hist-banner')).toContainText('Was sich von dieser Version bis jetzt geändert hat')
    expect(await fits()).toEqual({ page: true, preview: true, right: true })
    await dialog.getByRole('tab', { name: 'Version', exact: true }).click()
    await expect(dialog.getByRole('switch', { name: 'Neues markieren' })).toHaveAttribute('aria-checked', 'true')
    await expect(dialog.getByTestId('hist-new-note')).toContainText('Neu seit der Vorversion (')
    expect(await fits()).toEqual({ page: true, preview: true, right: true })
    await dialog.locator('.tape').focus()
    await page.keyboard.press('Home')
    await expect(dialog.getByTestId('hist-new-note')).toHaveText('Die erste gesicherte Version — davor gibt es nichts zum Vergleichen')
    await dialog.getByRole('tab', { name: 'Änderungen' }).click()
    await compare.getByRole('radio', { name: 'Zur Vorversion' }).click()
    await expect(dialog.getByTestId('hist-banner')).toContainText('Die erste gesicherte Version — alles darin zählt als hinzugefügt')
    expect(await fits()).toEqual({ page: true, preview: true, right: true })
  })
})

test.describe('what is new in a version (features/history/docDiff)', () => {
  const p = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] })
  const tasks = (checked: boolean, text: string): JSONContent => ({ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked }, content: [p(text)] }] })
  const adds = (n: DiffNode): string[] => (n.type === 'text' ? (n.diff === 'add' ? [n.text ?? ''] : []) : (n.content ?? []).flatMap(adds))
  const dels = (n: DiffNode): number => (n.diff === 'del' ? 1 : 0) + (n.content ?? []).reduce((s, c) => s + dels(c), 0)

  test('withoutRemovals: removed blocks and words left out, the text reads as the newer one, attrs changes stay', () => {
    const before = { type: 'doc', content: [p('Keep this line as it is.'), p('Drop me entirely please.'), p('The quick brown fox jumps.'), p('Alpha beta gamma delta'), p('Nothing new here at all'), tasks(false, 'Ship it')] }
    const after = { type: 'doc', content: [p('Keep this line as it is.'), p('The slow brown fox jumps high.'), p('Alpha gamma delta epsilon'), p('Nothing new here'), tasks(true, 'Ship it')] }
    const all = diffDocs(before, after)
    expect(all.map((i) => i.kind)).toEqual(['same', 'removed', 'changed', 'changed', 'changed', 'changed'])
    const items = withoutRemovals(all)
    expect(items.map((i) => i.kind)).toEqual(['same', 'changed', 'changed', 'same', 'changed'])
    const [, fox, alpha, nothing, task] = items
    // new words marked; the text is exactly the newer text — no removed word, no doubled space
    if (fox.kind !== 'changed' || alpha.kind !== 'changed' || task.kind !== 'changed' || nothing.kind !== 'same') throw new Error('kinds')
    expect(adds(fox.merged)).toEqual(['slow', 'jumps high.'])
    expect(textOf(fox.merged)).toBe('The slow brown fox jumps high.')
    expect(dels(fox.merged)).toBe(0)
    expect(adds(alpha.merged)).toEqual(['epsilon'])
    expect(textOf(alpha.merged)).toBe('Alpha gamma delta epsilon')
    // a block that only lost words reads as it is now, unmarked
    expect(nothing.block).toEqual(p('Nothing new here'))
    // a ticked to-do: its attrs changed — still a change
    expect(task.merged.content?.[0].was).toEqual({ checked: false })
    // the oldest version: everything is new
    expect(withoutRemovals(diffDocs(null, after)).every((i) => i.kind === 'added')).toBe(true)
  })

  test('newWordRuns: a title’s new words, removed ones left out', () => {
    expect(newWordRuns('Launch plan', 'Launch plan Q4')).toEqual([
      { op: 'same', text: 'Launch plan ' },
      { op: 'add', text: 'Q4' },
    ])
    const runs = newWordRuns('Old launch plan', 'Launch plan')
    expect(runs.map((r) => r.text).join('')).toBe('Launch plan')
    expect(runs.some((r) => r.op === 'del')).toBe(false)
    expect(newWordRuns('', 'Fresh title')).toEqual([{ op: 'add', text: 'Fresh title' }])
  })
})
