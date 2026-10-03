/** Margin rail: outline (scroll-spy + jump), page readings and backlinks right of the text on wide page columns. */
import type { Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, gotoPage, createPage, doc, para, heading, pageIdByTitle, uiEval, wsEval, flush, reloadApp, MOD } from './fixtures'

const WIDE = { width: 1920, height: 1080 }

const rail = (page: Page) => page.locator('#main .mrail')
const outline = (page: Page) => rail(page).getByRole('navigation', { name: 'Outline' })

/** A long page: an intro (the first heading starts below the top quarter), then sections "Section 1…n" with enough text to scroll past each. */
function longDoc(n: number, extra: JSONContent[] = []): JSONContent {
  const blocks: JSONContent[] = [para('Intro paragraph.'), para('Second intro paragraph.'), para('Third intro paragraph.'), para('Fourth intro paragraph.')]
  for (let i = 1; i <= n; i++) {
    blocks.push(heading(i % 3 === 0 ? 3 : i % 2 === 0 ? 2 : 1, `Section ${i}`))
    for (let k = 0; k < 8; k++) blocks.push(para(`Section ${i}, paragraph ${k + 1}: ${'lorem ipsum dolor sit amet '.repeat(6)}`))
  }
  return doc(...blocks, ...extra)
}

/** Distance of a heading's top from the top of the page column. */
async function headingOffset(page: Page, text: string): Promise<number> {
  return page.evaluate((text) => {
    const main = document.querySelector('#main')!
    const h = [...main.querySelectorAll<HTMLElement>('.ProseMirror [data-level]')].find((el) => el.textContent === text)!
    return h.getBoundingClientRect().top - main.getBoundingClientRect().top
  }, text)
}

test.describe('margin rail', () => {
  test('wide columns only: outline, readings and backlinks move from the footer into the rail', async ({ page }) => {
    await page.setViewportSize(WIDE)
    await openApp(page)
    await gotoPage(page, await pageIdByTitle(page, 'Welcome to One'))
    await expect(rail(page)).toBeVisible()
    await expect(page.locator('#main article.pv')).toHaveAttribute('data-rail', 'open')
    await expect(outline(page).getByRole('button')).toHaveCount(9)
    await expect(outline(page).getByRole('button').first()).toHaveText('Quick tour — tick them off')
    const readings = rail(page).locator('.mrail-spec')
    await expect(readings).toContainText('Words')
    await expect(readings).toContainText('REV')
    // the text and the rail never overlap
    const text = await page.locator('#main .pv-content .ProseMirror').first().boundingBox()
    const box = await rail(page).boundingBox()
    expect(box!.x).toBeGreaterThan(text!.x + text!.width + 24)
    expect(box!.x + box!.width).toBeLessThanOrEqual(1920)
    // no duplicate spec plate at the end of the page
    await expect(page.locator('#main .pv-foot .spec')).toBeHidden()

    // fewer than two headings: no outline; backlinks in the rail instead of the footer
    await gotoPage(page, await pageIdByTitle(page, 'Team wiki'))
    await expect(rail(page)).toBeVisible()
    await expect(outline(page)).toHaveCount(0)
    const linked = rail(page).getByRole('region', { name: 'Linked from' })
    await expect(linked.getByRole('link', { name: 'Welcome to One' })).toBeVisible()
    await expect(page.locator('#main .pv-foot section.pv-links:not(.pv-um)')).toBeHidden()

    // a narrower column (1440 with the sidebar) keeps the classic footer
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(rail(page)).toHaveCount(0)
    await expect(page.locator('#main .pv-foot .spec')).toBeVisible()
    await expect(page.locator('#main .pv-foot section.pv-links:not(.pv-um)')).toBeVisible()
    // … until the sidebar makes room
    await page.keyboard.press(`${MOD}+\\`)
    await expect(rail(page)).toBeVisible()
    await page.keyboard.press(`${MOD}+\\`)
    await expect(rail(page)).toHaveCount(0)

    // phones and database pages: never
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(rail(page)).toHaveCount(0)
    await page.setViewportSize(WIDE)
    await expect(rail(page)).toBeVisible()
    await gotoPage(page, await pageIdByTitle(page, 'Projects'))
    await expect(page.locator('#main article.pv[data-db]')).toBeVisible()
    await expect(rail(page)).toHaveCount(0)
  })

  test('outline: scroll-spy follows the reading position; click and Enter jump; closed toggles open', async ({ page }) => {
    await page.setViewportSize(WIDE)
    await openApp(page)
    const hidden: JSONContent = {
      type: 'details',
      attrs: { open: false },
      content: [
        { type: 'detailsSummary', content: [{ type: 'text', text: 'Folded notes' }] },
        { type: 'detailsContent', content: [heading(2, 'Hidden heading'), para('Inside the toggle.')] },
      ],
    }
    const id = await createPage(page, { title: 'Long read', content: longDoc(8, [hidden, para('The end.')]) })
    await gotoPage(page, id)
    const items = outline(page).getByRole('button')
    await expect(items).toHaveCount(9)
    await expect(outline(page).locator('[aria-current]')).toHaveCount(0)

    // click → the heading lands near the top of the column and its entry lights up
    await items.filter({ hasText: 'Section 5' }).click()
    // a signal tick marks the heading for a moment (outside the editor's DOM)
    await expect(page.locator('#main > .mrail-mark')).toHaveCount(1)
    await expect(items.filter({ hasText: 'Section 5' })).toHaveAttribute('aria-current', 'location')
    await expect.poll(() => headingOffset(page, 'Section 5')).toBeLessThan(80)
    expect(await headingOffset(page, 'Section 5')).toBeGreaterThanOrEqual(0)

    // reading on (the wheel releases the picked entry): the next section takes over once it
    // passes the top quarter of the column, a long scroll included
    await page.mouse.move(900, 600)
    await page.mouse.wheel(0, (await headingOffset(page, 'Section 7')) - 60)
    await expect(items.filter({ hasText: 'Section 7' })).toHaveAttribute('aria-current', 'location')
    await page.evaluate(() => document.querySelector('#main')!.scrollTo(0, 0))
    await expect(outline(page).locator('[aria-current]')).toHaveCount(0)

    // keyboard: Enter on an entry jumps
    await items.filter({ hasText: 'Section 3' }).focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => headingOffset(page, 'Section 3')).toBeLessThan(80)
    await expect(items.filter({ hasText: 'Section 3' })).toHaveAttribute('aria-current', 'location')

    // a heading inside a closed toggle: the toggle opens on the way
    const toggle = page.locator('#main .ProseMirror [data-type="details"]')
    await expect(toggle).not.toHaveClass(/is-open/)
    await items.filter({ hasText: 'Hidden heading' }).click()
    await expect(toggle).toHaveClass(/is-open/)
    await expect(page.locator('#main .ProseMirror [data-level]', { hasText: 'Hidden heading' })).toBeInViewport()
  })

  test('reminders: the upcoming ones of this page, soonest first; a click lands on their line', async ({ page }) => {
    await page.setViewportSize(WIDE)
    await openApp(page)
    const day = (n: number) => {
      const d = new Date(Date.now() + n * 864e5)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    const remind = (iso: string, code: string, text: string): JSONContent => ({
      type: 'paragraph',
      content: [{ type: 'text', text }, { type: 'mention', attrs: { id: iso, label: iso, kind: 'date', reminder: code } }],
    })
    const id = await createPage(page, {
      title: 'Launch plan',
      content: longDoc(6, [remind(day(-10), 'at', 'Kick-off was on '), remind(day(20), '-1w', 'Press day on '), remind(day(9), '-1d', 'Go-live on ')]),
    })
    await gotoPage(page, id)
    const due = rail(page).getByRole('region', { name: 'Reminders' })
    const items = due.getByRole('button')
    // the past one is gone; the next one to ring comes first (−1 day of +9 days before −1 week of +20 days)
    await expect(items).toHaveCount(2)
    await expect(items.first()).toContainText('Go-live on')
    await expect(items.first()).toContainText(/IN \d+ DAYS/)
    await expect(items.nth(1)).toContainText('Press day on')
    // the rail orders its sections: outline, reminders, page, linked from
    await expect(rail(page).locator('.mrail__label')).toHaveText(['Outline', 'Reminders', 'Page'])

    await items.first().click()
    await expect(page.locator('#main > .mrail-mark')).toHaveCount(1)
    const line = page.locator('#main .ProseMirror p', { hasText: 'Go-live on' })
    await expect(line).toBeInViewport()

    // no reminders, no section
    await gotoPage(page, await pageIdByTitle(page, 'Team wiki'))
    await expect(rail(page).getByRole('region', { name: 'Reminders' })).toHaveCount(0)
  })

  test('a database entry: the rail starts beside its property list', async ({ page }) => {
    await page.setViewportSize(WIDE)
    await openApp(page)
    const id = await pageIdByTitle(page, 'Website relaunch')
    await gotoPage(page, id)
    await expect(rail(page)).toBeVisible()
    await expect(rail(page).locator('.mrail__label').first()).toHaveText('Entry')
    const gap = async () => Math.abs((await rail(page).locator('.mrail__inner').boundingBox())!.y - (await page.locator('#main .pv-props').boundingBox())!.y)
    expect(await gap()).toBeLessThan(12)
    // … and moves with the list when the header above it grows (an icon, a longer title)
    const before = (await page.locator('#main .pv-props').boundingBox())!.y
    await wsEval(page, (s, id) => s.updatePage(id, { icon: { type: 'asset', value: 'compass' } }), id)
    await expect.poll(async () => (await page.locator('#main .pv-props').boundingBox())!.y).toBeGreaterThan(before + 40)
    await expect.poll(gap).toBeLessThan(12)
  })

  test('the toggle (key and Mod+.) is remembered on this device', async ({ page }) => {
    await page.setViewportSize(WIDE)
    await openApp(page)
    await gotoPage(page, await pageIdByTitle(page, 'Welcome to One'))
    const key = rail(page).getByRole('button', { name: 'Hide margin rail' })
    await expect(key).toHaveAttribute('aria-expanded', 'true')
    await key.click()
    await expect(page.locator('#main article.pv')).toHaveAttribute('data-rail', 'closed')
    await expect(rail(page).locator('.mrail__body')).toHaveCount(0)
    // closed: the footer has the spec plate again; the key stays to bring it back
    await expect(page.locator('#main .pv-foot .spec')).toBeAttached()
    await expect(rail(page).getByRole('button', { name: 'Show margin rail' })).toHaveAttribute('aria-expanded', 'false')

    await reloadApp(page)
    await expect(page.locator('#main article.pv')).toHaveAttribute('data-rail', 'closed')
    expect(await page.evaluate(() => localStorage.getItem('one.marginRail'))).toBe('0')

    // Mod+. from inside the editor
    await page.locator('#main .ProseMirror').first().click()
    await page.keyboard.press(`${MOD}+.`)
    await expect(page.locator('#main article.pv')).toHaveAttribute('data-rail', 'open')
    await expect(outline(page)).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('one.marginRail'))).toBe('1')
  })

  test('calm places stay calm: focus mode, panes, the peek — and open comments take the margin', async ({ page }) => {
    await page.setViewportSize(WIDE)
    await openApp(page)
    const welcome = await pageIdByTitle(page, 'Welcome to One')
    await gotoPage(page, welcome)
    await expect(rail(page)).toBeVisible()

    await uiEval(page, (s) => s.setFocusMode(true))
    await expect(rail(page)).toHaveCount(0)
    await uiEval(page, (s) => s.setFocusMode(false))
    await expect(rail(page)).toBeVisible()

    const wiki = await pageIdByTitle(page, 'Team wiki')
    await uiEval(page, (s, id) => s.openPane(id), wiki)
    await expect(page.locator('.pane .pv')).toBeVisible()
    await expect(page.locator('.pane .mrail')).toHaveCount(0)
    await uiEval(page, (s) => s.closePane(0))

    await uiEval(page, (s, id) => s.openPeek(id), wiki)
    await expect(page.locator('.peek .pv')).toBeVisible()
    await expect(page.locator('.peek .mrail')).toHaveCount(0)
    await uiEval(page, (s) => s.closePeek())

    // a page with an open comment thread: the comment rail owns the margin
    const id = await createPage(page, {
      title: 'Reviewed',
      content: doc(
        heading(1, 'First'),
        { type: 'paragraph', content: [{ type: 'text', text: 'We keep the ' }, { type: 'text', text: 'launch date', marks: [{ type: 'comment', attrs: { id: 'c1' } }] }, { type: 'text', text: ' quiet.' }] },
        heading(1, 'Second'),
        para('More.'),
      ),
    })
    await wsEval(page, (s, id) => s.addComment(id, { id: 'c1', quote: 'launch date', body: 'Check with legal' }), id)
    await flush(page)
    await gotoPage(page, id)
    await expect(page.locator('#main .crail')).toBeVisible()
    await expect(rail(page)).toBeHidden()
    await expect(page.locator('#main .pv-foot .spec')).toBeVisible()
    // resolved: the margin is free again
    await wsEval(page, (s, id) => s.updateComment(id, 'c1', { resolved: true }), id)
    await expect(page.locator('#main .crail')).toHaveCount(0)
    await expect(rail(page)).toBeVisible()
  })

  test('seeded page icons are generated icons; a missing file falls back to the page glyph', async ({ page, errors }) => {
    errors.allow(/Failed to load resource.*404/)
    await openApp(page)
    const welcome = await wsEval(page, (s) => (Object.values(s.pages) as Array<Record<string, any>>).find((p) => p.title === 'Welcome to One')?.icon) // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(welcome).toEqual({ type: 'asset', value: 'app-icon' })
    const row = page.locator('.sb section[aria-label="Pages"] .sb-row', { hasText: 'Team wiki' }).first()
    await expect(row.locator('.picon img')).toHaveAttribute('src', /assets\/icons\/binder\.webp$/)
    await expect.poll(() => row.locator('.picon img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0)

    const id = await createPage(page, { title: 'Odd icon' })
    await wsEval(page, (s, id) => s.updatePage(id, { icon: { type: 'asset', value: 'no-such-icon' } }), id)
    await gotoPage(page, id)
    await expect(page.locator('#main .pv-icon svg')).toBeVisible()
    await expect(page.locator('#main .pv-icon img')).toHaveCount(0)
  })
})
