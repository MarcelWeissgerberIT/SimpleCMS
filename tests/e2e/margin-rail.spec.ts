/**
 * Margin rail: outline (scroll-spy + jump) and upcoming reminders right of the text on wide page
 * columns — navigation only; the page's readings (spec plate) and "Linked from" stay in the footer.
 */
import type { Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, gotoPage, createPage, doc, para, heading, pageIdByTitle, uiEval, wsEval, flush, reloadApp, editorOf, MOD } from './fixtures'

const WIDE = { width: 1920, height: 1080 }

const rail = (page: Page) => page.locator('#main .mrail')
const outline = (page: Page) => rail(page).getByRole('navigation', { name: 'Outline' })
const article = (page: Page) => page.locator('#main article.pv')
const plate = (page: Page) => page.locator('#main .pv-foot .spec')
const linkedFrom = (page: Page) => page.locator('#main .pv-foot').getByRole('region', { name: 'Linked from' })

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

/** How far the text column's centre sits left of the page column's centre (0 = centred). */
async function columnShift(page: Page): Promise<number> {
  return page.evaluate(() => {
    const main = document.querySelector('#main')!.getBoundingClientRect()
    const col = document.querySelector('#main .pv-content')!.getBoundingClientRect()
    return Math.round(main.left + main.width / 2 - (col.left + col.width / 2))
  })
}

/**
 * From the next load on, record every data-rail value the page views take (mutation records keep
 * the values between two commits too): a page that flashes the wrong layout first shows both.
 */
async function watchRail(page: Page): Promise<() => Promise<string[][]>> {
  await page.addInitScript(() => {
    const seen = new Map<Element, string[]>()
    new MutationObserver((records) => {
      for (const r of records) {
        const el = r.target as Element
        if (!el.matches('article.pv')) continue
        const list = seen.get(el) ?? []
        seen.set(el, list)
        if (r.oldValue && list.at(-1) !== r.oldValue) list.push(r.oldValue)
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-rail'], attributeOldValue: true })
    ;(window as unknown as { __railSeen: () => string[][] }).__railSeen = () =>
      [...seen].map(([el, list]) => {
        const now = el.getAttribute('data-rail')
        return now && list.at(-1) !== now ? [...list, now] : list
      })
  })
  return () => page.evaluate(() => (window as unknown as { __railSeen: () => string[][] }).__railSeen())
}

test.describe('margin rail', () => {
  test('wide columns: the rail is navigation; the spec plate and "Linked from" stay in the footer', async ({ page }) => {
    await page.setViewportSize(WIDE)
    await openApp(page)
    await gotoPage(page, await pageIdByTitle(page, 'Welcome to One'))
    await expect(rail(page)).toBeVisible()
    await expect(article(page)).toHaveAttribute('data-rail', 'open')
    await expect(outline(page).getByRole('button')).toHaveCount(9)
    await expect(outline(page).getByRole('button').first()).toHaveText('Quick tour — tick them off')
    // the text and the rail never overlap
    const text = await page.locator('#main .pv-content .ProseMirror').first().boundingBox()
    const box = await rail(page).boundingBox()
    expect(box!.x).toBeGreaterThan(text!.x + text!.width + 24)
    expect(box!.x + box!.width).toBeLessThanOrEqual(1920)
    expect(await columnShift(page)).toBeGreaterThan(60)

    // a page with headings that others link to: outline in the rail, readings + backlinks at the end
    const guide = await createPage(page, { title: 'Field guide', content: doc(heading(1, 'Before you start'), para('Pack light.'), heading(1, 'On the trail'), para('Walk on.')) })
    await createPage(page, { title: 'Trip index', content: doc({ type: 'pageLink', attrs: { pageId: guide } }) })
    await gotoPage(page, guide)
    await expect(article(page)).toHaveAttribute('data-rail', 'open')
    await expect(rail(page).locator('.mrail__label')).toHaveText(['Outline'])
    await expect(rail(page)).not.toContainText('Words')
    await expect(rail(page).getByRole('region', { name: 'Linked from' })).toHaveCount(0)
    await expect(plate(page)).toBeVisible()
    await expect(plate(page)).toContainText('Spec · Page')
    await expect(plate(page)).toContainText('Words')
    await expect(linkedFrom(page).getByRole('link', { name: 'Trip index' })).toBeVisible()
    // the footer moves with the text column
    const col = (await page.locator('#main .pv-content').boundingBox())!
    const foot = (await page.locator('#main .pv-foot .pv-col').boundingBox())!
    expect(Math.abs(foot.x - col.x)).toBeLessThan(2)

    // no outline and no reminders: nothing to show — the text stays centred, only the key remains
    await gotoPage(page, await pageIdByTitle(page, 'Team wiki'))
    await expect(article(page)).toHaveAttribute('data-rail', 'closed')
    await expect(rail(page)).toHaveAttribute('data-empty', 'true')
    await expect(rail(page).locator('.mrail__body')).toHaveCount(0)
    await expect(rail(page).getByRole('button', { name: 'Hide margin rail' })).toBeVisible()
    expect(Math.abs(await columnShift(page))).toBeLessThan(2)
    await expect(plate(page)).toBeVisible()
    await expect(linkedFrom(page).getByRole('link', { name: 'Welcome to One' })).toBeVisible()

    // a narrower column (1440 with the sidebar): no rail, the same footer
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(rail(page)).toHaveCount(0)
    await expect(plate(page)).toBeVisible()
    await expect(linkedFrom(page)).toBeVisible()
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
    await expect(plate(page)).toContainText('Spec · Database')
  })

  test('an empty rail lays out as closed: no flash on load, the column moves once the second heading appears', async ({ page }) => {
    await page.setViewportSize(WIDE)
    await openApp(page)
    const plain = await createPage(page, { title: 'Scratch', content: doc(heading(1, 'Only heading'), para('Some text.')) })
    const outlined = await createPage(page, { title: 'Outlined', content: longDoc(3) })
    const seen = await watchRail(page)
    // boot straight into a page with an outline, then on to one without and back
    await gotoPage(page, outlined)
    await reloadApp(page)
    await expect(outline(page).getByRole('button')).toHaveCount(3)
    await gotoPage(page, plain)
    await expect(rail(page)).toHaveAttribute('data-empty', 'true')
    await gotoPage(page, outlined)
    await expect(outline(page).getByRole('button')).toHaveCount(3)
    // each page view took its layout once — never the other one first
    expect(await seen()).toEqual([['open'], ['closed'], ['open']])

    // the second heading turns the rail on (live, from the editor); removing it turns it off again
    await gotoPage(page, plain)
    await expect(article(page)).toHaveAttribute('data-rail', 'closed')
    // the caret at the end (TipTap focuses on the next frame)
    await editorOf(page).evaluate((el) => (el as HTMLElement & { editor: { commands: { focus: (at: string) => void } } }).editor.commands.focus('end'))
    await expect(editorOf(page)).toBeFocused()
    await page.keyboard.press('Enter')
    await page.keyboard.type('## Second heading')
    await expect(article(page)).toHaveAttribute('data-rail', 'open')
    await expect(outline(page).getByRole('button')).toHaveText(['Only heading', 'Second heading'])
    await expect.poll(() => columnShift(page)).toBeGreaterThan(60)
    await page.keyboard.press(`${MOD}+z`)
    await expect(article(page)).toHaveAttribute('data-rail', 'closed')
    await expect.poll(() => columnShift(page)).toBeLessThan(2)
    await expect(rail(page).locator('.mrail__body')).toHaveCount(0)

    // print: neither the rail nor its column shift, the footer as on screen
    await gotoPage(page, outlined)
    await expect(article(page)).toHaveAttribute('data-rail', 'open')
    await page.emulateMedia({ media: 'print' })
    await expect(rail(page)).toBeHidden()
    await expect.poll(async () => (await page.locator('#main .pv-content').evaluate((el) => getComputedStyle(el).left))).toBe('0px')
    await expect(plate(page)).toBeVisible()
    await page.emulateMedia({ media: 'screen' })
    await expect(rail(page)).toBeVisible()
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
    // the rail orders its sections: outline, reminders — nothing else
    await expect(rail(page).locator('.mrail__label')).toHaveText(['Outline', 'Reminders'])

    await items.first().click()
    await expect(page.locator('#main > .mrail-mark')).toHaveCount(1)
    const line = page.locator('#main .ProseMirror p', { hasText: 'Go-live on' })
    await expect(line).toBeInViewport()

    // no reminders, no section
    await gotoPage(page, await pageIdByTitle(page, 'Team wiki'))
    await expect(rail(page).getByRole('region', { name: 'Reminders' })).toHaveCount(0)

    // reminders alone fill the rail, no outline needed
    const solo = await createPage(page, { title: 'Dentist', content: doc(remind(day(5), 'at', 'Appointment on ')) })
    await gotoPage(page, solo)
    await expect(article(page)).toHaveAttribute('data-rail', 'open')
    await expect(rail(page).locator('.mrail__label')).toHaveText(['Reminders'])
    await expect(plate(page)).toBeVisible()
  })

  test('a database entry: the outline starts beside its property list; its readings are on the plate', async ({ page }) => {
    await page.setViewportSize(WIDE)
    await openApp(page)
    const id = await pageIdByTitle(page, 'Website relaunch')
    const content = doc(heading(1, 'Scope'), para('Pages, copy, images.'), heading(1, 'Risks'), para('The launch date.'))
    await wsEval(page, (s, a) => s.setContent(a.id, a.content, 'e2e'), { id, content })
    await flush(page)
    await gotoPage(page, id)
    await expect(rail(page)).toBeVisible()
    await expect(article(page)).toHaveAttribute('data-rail', 'open')
    await expect(rail(page).locator('.mrail__label')).toHaveText(['Outline'])
    await expect(plate(page)).toContainText('Spec · Entry')
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
    // closed: the key stays to bring it back; the footer is the same either way
    await expect(plate(page)).toBeVisible()
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

    // a page with nothing for the rail: key and Mod+. still switch it, the text stays centred
    await gotoPage(page, await pageIdByTitle(page, 'Team wiki'))
    await expect(article(page)).toHaveAttribute('data-rail', 'closed')
    await expect(rail(page).getByRole('button', { name: 'Hide margin rail' })).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press(`${MOD}+.`)
    await expect(rail(page).getByRole('button', { name: 'Show margin rail' })).toHaveAttribute('aria-expanded', 'false')
    expect(await page.evaluate(() => localStorage.getItem('one.marginRail'))).toBe('0')
    await expect(article(page)).toHaveAttribute('data-rail', 'closed')
    await page.keyboard.press(`${MOD}+.`)
    await expect(rail(page).getByRole('button', { name: 'Hide margin rail' })).toHaveAttribute('aria-expanded', 'true')
    await expect(article(page)).toHaveAttribute('data-rail', 'closed')
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

  test('symbols: a searchable set of line glyphs (English and German words) as page icons', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Quarterly plan' })
    await gotoPage(page, id)
    await page.locator('#main').getByRole('button', { name: 'Add icon' }).click()
    const picker = page.locator('[data-popover] .icon-picker')
    await picker.getByRole('button', { name: 'Symbols' }).click()
    const search = picker.getByRole('textbox', { name: 'Search' })
    await search.fill('flagge')
    await expect(picker.locator('.icon-picker__symbol')).toHaveCount(1)
    await search.fill('calendar')
    await expect(picker.getByRole('button', { name: 'calendar days' })).toBeVisible()
    await picker.getByRole('button', { name: 'calendar days' }).click()
    await expect(picker).toHaveCount(0)
    expect(await wsEval(page, (s, id) => s.pages[id].icon, id)).toEqual({ type: 'lucide', value: 'CalendarDays' })
    // title size: an ink glyph on a paper placard; sidebar size: the bare glyph
    await expect(page.locator('#main .pv-icon .picon-tile svg')).toBeVisible()
    const row = page.locator('.sb section[aria-label="Pages"] .sb-row', { hasText: 'Quarterly plan' }).first()
    await expect(row.locator('svg.lucide-calendar-days')).toBeVisible()
    // the tab is remembered on this device
    await page.locator('#main .pv-icon').click()
    await expect(picker.getByRole('button', { name: 'Symbols' })).toHaveAttribute('aria-pressed', 'true')
  })
})
