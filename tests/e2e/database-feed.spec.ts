/**
 * Feed view (Notion parity): rows as a stream of entries — title, spec labels, author / time stamp
 * and the page content (read-only, clamped, "Show more" in place). Newest first by default; the
 * order flips, follows a date property, or gives way to the view's sorts. Filters, search, New,
 * open / peek, inline blocks, view only, share links and 390 px.
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect, openApp, gotoPage, wsEval, flush, createPage } from './fixtures'

const HOUR = 36e5

/**
 * "Release notes": four rows created an hour apart (Alpha oldest … Delta newest) with content —
 * Delta is long (clamped), Gamma has none, Beta has an open comment thread with a reply.
 */
async function createFeedDb(page: Page): Promise<string> {
  const id = await wsEval(page, (s) => {
    const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
    const dbId = s.createDatabase({
      title: 'Release notes',
      properties: [
        { id: 'pName', name: 'Name', type: 'title' },
        {
          id: 'pStatus',
          name: 'Status',
          type: 'status',
          options: [
            { id: 'sDraft', name: 'Draft', color: 'gray', group: 'todo' },
            { id: 'sLive', name: 'Published', color: 'green', group: 'done' },
          ],
        },
        { id: 'pDate', name: 'Release date', type: 'date' },
        { id: 'pNotes', name: 'Notes', type: 'text' },
      ],
    })
    const now = Date.now()
    const rows: Array<{ title: string; props: Record<string, unknown>; content: unknown[]; ago: number; comments?: unknown[] }> = [
      { title: 'Alpha release', props: { pStatus: 'sLive', pDate: { start: '2026-03-01' } }, content: [p('Alpha body text')], ago: 4 },
      {
        title: 'Beta release',
        props: { pStatus: 'sLive', pDate: { start: '2026-01-15' } },
        content: [p('Beta body text')],
        ago: 3,
        comments: [{ id: 'c1', quote: 'Beta', body: 'Nice', author: 'Ada', createdAt: now, updatedAt: now, resolved: false, replies: [{ id: 'r1', author: 'Linus', body: '+1', createdAt: now, updatedAt: now }] }],
      },
      { title: 'Gamma release', props: { pStatus: 'sDraft' }, content: [], ago: 2 },
      {
        title: 'Delta release',
        props: { pStatus: 'sDraft', pDate: { start: '2026-02-10' }, pNotes: 'long one' },
        content: Array.from({ length: 24 }, (_, i) => p(i === 23 ? 'Delta final line' : `Delta line ${i + 1}`)),
        ago: 1,
      },
    ]
    for (const r of rows) {
      const id = s.createRow(dbId, { title: r.title, properties: r.props })
      if (r.content.length) s.setContent(id, { type: 'doc', content: r.content }, 'e2e')
      s.updatePage(id, { createdAt: now - r.ago * 36e5, ...(r.comments ? { comments: r.comments } : {}) })
    }
    return dbId
  })
  await flush(page)
  return id
}

/** Add a feed view through the "+" menu of the (first) database on screen. */
async function addFeedView(page: Page, db: Locator, label = 'Feed'): Promise<void> {
  await db.getByRole('button', { name: /^(Add view|Ansicht hinzufügen)$/ }).click()
  await page.getByRole('menuitem', { name: new RegExp(`^${label}`) }).click()
  await expect(db).toHaveAttribute('data-view', 'feed')
}

const mainDb = (page: Page) => page.locator('#main section.db').first()
const entries = (scope: Locator) => scope.locator('.dbf-entry')
const titles = (scope: Locator) => scope.locator('.dbf-entry .dbf-title__link > span:last-child').allTextContents()
const entry = (scope: Locator, title: string) => scope.locator('.dbf-entry', { has: scope.page().locator('.dbf-title', { hasText: title }) })
const feedView = (page: Page, dbId: string) => wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.databases[id].views.find((v: { type: string }) => v.type === 'feed') ?? null)), dbId)

test.describe('database: feed view', () => {
  test('add a feed view: entries newest first with icon, title, spec labels, stamp, content preview and comment count', async ({ page }) => {
    await openApp(page)
    const dbId = await createFeedDb(page)
    await wsEval(page, (s, id) => {
      const row = (Object.values(s.pages) as Array<Record<string, any>>).find((p) => p.databaseId === id && p.title === 'Delta release')
      s.updatePage(row!.id, { icon: { type: 'emoji', value: '🚀' } })
    }, dbId)
    await gotoPage(page, dbId)
    const db = mainDb(page)
    await addFeedView(page, db)
    await expect(db.getByRole('tab', { name: /Feed/ })).toHaveAttribute('aria-selected', 'true')
    const feed = db.getByRole('feed', { name: 'Entries' })
    await expect(entries(feed)).toHaveCount(4)
    // newest first (created time)
    await expect.poll(() => titles(feed)).toEqual(['Delta release', 'Gamma release', 'Beta release', 'Alpha release'])
    await expect(db.locator('.dbf-head')).toContainText('Newest first')
    await expect(db.locator('.dbf-head')).toContainText('Created time')

    const delta = entry(feed, 'Delta release')
    await expect(delta.locator('.dbf-title span[aria-hidden]').first()).toHaveText('🚀')
    // spec labels: name + value
    await expect(delta.locator('.dbf-spec', { hasText: 'Status' })).toContainText('Draft')
    await expect(delta.locator('.dbf-spec', { hasText: 'Release date' })).toContainText('Feb 10')
    // the author stamp (local workspace: you) and the date plate
    await expect(delta.locator('.dbf-stamp')).toContainText('You')
    await expect(delta.locator('.dbf-stamp')).toContainText(/hour ago/i)
    await expect(delta.locator('.dbf-date__day')).toBeVisible()
    // the page content, read-only
    await expect(delta.locator('.dbf-body')).toContainText('Delta line 1')
    await expect(delta.locator('.dbf-body .ProseMirror')).toHaveAttribute('contenteditable', 'false')
    // no content: no body; comments: a count in the foot
    await expect(entry(feed, 'Gamma release').locator('.dbf-body')).toHaveCount(0)
    await expect(entry(feed, 'Beta release').getByRole('button', { name: '2 comments' })).toHaveText('2')
    await expect(entry(feed, 'Alpha release').locator('.dbf-act--comments')).toHaveCount(0)

    const view = await feedView(page, dbId)
    expect(view).toMatchObject({ type: 'feed', name: 'Feed', sorts: [] })
  })

  test('German: Feed, Neueste zuerst, Mehr anzeigen / Weniger anzeigen, Öffnen', async ({ page }) => {
    await openApp(page)
    const dbId = await createFeedDb(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await gotoPage(page, dbId)
    const db = mainDb(page)
    await addFeedView(page, db, 'Feed')
    const feed = db.getByRole('feed', { name: 'Einträge' })
    await expect(entries(feed)).toHaveCount(4)
    await expect(db.locator('.dbf-head')).toContainText('Neueste zuerst')
    await expect(db.locator('.dbf-head')).toContainText('Erstellt am')
    await expect(db.getByRole('button', { name: 'Neuer Eintrag' })).toBeVisible()
    const delta = entry(feed, 'Delta release')
    await expect(delta.getByRole('button', { name: 'Öffnen' })).toBeVisible()
    await delta.getByRole('button', { name: 'Mehr anzeigen' }).click()
    await expect(delta.getByRole('button', { name: 'Weniger anzeigen' })).toHaveAttribute('aria-expanded', 'true')
    await expect(entry(feed, 'Beta release').getByRole('button', { name: '2 Kommentare' })).toBeVisible()
    expect((await feedView(page, dbId)).name).toBe('Feed')
  })

  test('show more expands in place; Open, the title and Enter open the page in the peek; Page Down moves between entries; the peek edits show live', async ({ page }) => {
    await openApp(page)
    const dbId = await createFeedDb(page)
    await gotoPage(page, dbId)
    const db = mainDb(page)
    await addFeedView(page, db)
    const feed = db.getByRole('feed')
    const delta = entry(feed, 'Delta release')
    const body = delta.locator('.dbf-body')
    await expect(body).toContainText('Delta line 1')
    // clamped: the last line is cut off
    const clamped = () => body.evaluate((el) => el.scrollHeight > el.clientHeight + 4)
    await expect.poll(clamped).toBe(true)
    await expect(body.getByText('Delta final line')).not.toBeInViewport()
    const more = delta.getByRole('button', { name: 'Show more' })
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    await more.click()
    await expect(delta.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true')
    await expect.poll(clamped).toBe(false)
    await body.getByText('Delta final line').scrollIntoViewIfNeeded()
    await expect(body.getByText('Delta final line')).toBeInViewport()
    await delta.getByRole('button', { name: 'Show less' }).click()
    await expect.poll(clamped).toBe(true)
    // short entries have nothing to expand
    await expect(entry(feed, 'Alpha release').getByRole('button', { name: 'Show more' })).toHaveCount(0)

    // Open → the side peek
    await entry(feed, 'Alpha release').getByRole('button', { name: 'Open' }).click()
    const peek = page.locator('.peek')
    await expect(peek.locator('.pv-title')).toHaveValue('Alpha release')
    // edit the body in the peek: the entry follows
    await peek.locator('.ProseMirror').click()
    await page.keyboard.press('End')
    await page.keyboard.type(' plus peek words')
    await expect(entry(feed, 'Alpha release').locator('.dbf-body')).toContainText('Alpha body text plus peek words')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(peek).toHaveCount(0)

    // the title is a link to the page that opens the peek
    const link = entry(feed, 'Beta release').getByRole('link', { name: 'Beta release' })
    await expect(link).toHaveAttribute('href', /#\/p\//)
    await link.click()
    await expect(peek.locator('.pv-title')).toHaveValue('Beta release')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(peek).toHaveCount(0)

    // keyboard (ARIA feed): Page Down / Up between entries, Enter opens
    await entries(feed).first().focus()
    await page.keyboard.press('PageDown')
    await expect(entry(feed, 'Gamma release')).toBeFocused()
    await page.keyboard.press('PageDown')
    await expect(entry(feed, 'Beta release')).toBeFocused()
    await page.keyboard.press('PageUp')
    await expect(entry(feed, 'Gamma release')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(peek.locator('.pv-title')).toHaveValue('Gamma release')
  })

  test('New entry and the toolbar New create a page and open it; it lands on top', async ({ page }) => {
    await openApp(page)
    const dbId = await createFeedDb(page)
    await gotoPage(page, dbId)
    const db = mainDb(page)
    await addFeedView(page, db)
    const feed = db.getByRole('feed')
    await db.getByRole('button', { name: 'New entry' }).click()
    const peek = page.locator('.peek')
    await expect(peek.locator('.pv-title')).toBeVisible()
    await expect(peek.locator('.pv-title')).toHaveValue('')
    await peek.locator('.pv-title').fill('Epsilon release')
    await expect.poll(() => titles(feed)).toEqual(['Epsilon release', 'Delta release', 'Gamma release', 'Beta release', 'Alpha release'])
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(peek).toHaveCount(0)

    await db.locator('.db-newbtn__main').click()
    await expect(peek.locator('.pv-title')).toBeVisible()
    await expect(entries(feed)).toHaveCount(6)
    const count = await wsEval(page, (s, id) => (Object.values(s.pages) as Array<Record<string, any>>).filter((p) => p.databaseId === id && !p.trashed).length, dbId)
    expect(count).toBe(6)
  })

  test('order: flip newest / oldest, order by a date property, the view’s sorts take over; filter, search, content off', async ({ page }) => {
    await openApp(page)
    const dbId = await createFeedDb(page)
    await gotoPage(page, dbId)
    const db = mainDb(page)
    await addFeedView(page, db)
    const feed = db.getByRole('feed')
    await expect.poll(() => titles(feed)).toEqual(['Delta release', 'Gamma release', 'Beta release', 'Alpha release'])

    // the order switch above the entries
    await db.getByRole('button', { name: 'Order: Newest first — reverse' }).click()
    await expect.poll(() => titles(feed)).toEqual(['Alpha release', 'Beta release', 'Gamma release', 'Delta release'])
    await expect(db.getByRole('button', { name: 'Order: Oldest first — reverse' })).toBeVisible()
    expect((await feedView(page, dbId)).feed).toMatchObject({ order: 'oldest' })

    // layout: order by the release date (no date last), newest first again, content off
    await db.getByRole('toolbar', { name: 'Database toolbar' }).getByRole('button', { name: 'More' }).click()
    await page.getByRole('menuitem', { name: /Layout/ }).click()
    const panel = page.locator('.db-layout')
    await expect(panel.getByRole('radio', { name: 'Feed' })).toHaveAttribute('aria-checked', 'true')
    await panel.getByRole('button', { name: 'Order by' }).click()
    await page.getByRole('menuitem', { name: 'Release date' }).click()
    await panel.getByRole('radio', { name: 'Newest first' }).click()
    await expect.poll(() => titles(feed)).toEqual(['Alpha release', 'Delta release', 'Beta release', 'Gamma release'])
    await expect(entry(feed, 'Gamma release').locator('.dbf-date')).toContainText('No date')
    await expect(entry(feed, 'Alpha release').locator('.dbf-date__day')).toHaveText('01')
    await expect(db.locator('.dbf-head')).toContainText('Release date')
    await panel.getByRole('switch', { name: 'Show page content' }).click()
    await expect(db.locator('.dbf-body')).toHaveCount(0)
    await panel.getByRole('switch', { name: 'Show page content' }).click()
    await expect(entry(feed, 'Alpha release').locator('.dbf-body')).toContainText('Alpha body text')
    await page.keyboard.press('Escape')
    expect((await feedView(page, dbId)).feed).toEqual({ order: 'newest', dateProperty: 'pDate', content: true })

    // a sort of the view takes over (the head says so)
    await db.getByRole('toolbar', { name: 'Database toolbar' }).getByRole('button', { name: 'Sort' }).click()
    const sortPanel = page.locator('.db-panel')
    await expect(sortPanel).toContainText('No sorts — newest entries first')
    await sortPanel.getByRole('button', { name: 'Add sort' }).click()
    await page.getByRole('menuitem', { name: 'Name' }).click()
    await expect.poll(() => titles(feed)).toEqual(['Alpha release', 'Beta release', 'Delta release', 'Gamma release'])
    await page.keyboard.press('Escape')
    await expect(db.locator('.dbf-head')).toContainText('Sorted · 1 rule')
    await expect(db.getByRole('button', { name: /^Order:/ })).toHaveCount(0)

    // filter (title contains "ta") and search
    await db.getByRole('toolbar', { name: 'Database toolbar' }).getByRole('button', { name: 'Filter' }).click()
    const fpop = page.locator('.db-filterpop')
    await fpop.getByRole('button', { name: 'Add filter rule' }).click()
    await page.getByRole('menuitem', { name: 'Name' }).click()
    await fpop.getByPlaceholder('Value').fill('ta')
    await expect.poll(() => titles(feed)).toEqual(['Beta release', 'Delta release'])
    await expect(db.locator('.db-counter__num')).toHaveText('2/4')
    await page.keyboard.press('Escape')
    await db.getByRole('button', { name: 'Search' }).click()
    await page.keyboard.type('Delta')
    await expect.poll(() => titles(feed)).toEqual(['Delta release'])
    // nothing matches: the empty state offers to clear
    await page.keyboard.type('zzz')
    await expect(entries(db)).toHaveCount(0)
    await expect(db.locator('.db-empty')).toBeVisible()
  })

  test('inline block: entries in a page, a row embedding its own database shows a link; view only; locked; share link', async ({ page, browser, errors }) => {
    await openApp(page)
    const dbId = await createFeedDb(page)
    const viewId = await wsEval(page, (s, id) => s.addView(id, { type: 'feed', name: 'Feed', visibleProperties: ['pStatus'] }), dbId)
    // Alpha embeds its own database (in the feed: a link, never the feed inside itself)
    await wsEval(
      page,
      (s, { id, viewId }) => {
        const row = (Object.values(s.pages) as Array<Record<string, any>>).find((p) => p.databaseId === id && p.title === 'Alpha release')
        s.setContent(row!.id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Alpha body text' }] }, { type: 'databaseBlock', attrs: { databaseId: id, viewId } }] }, 'e2e')
      },
      { id: dbId, viewId },
    )
    const pageId = await createPage(page, {
      title: 'Team updates',
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Read these:' }] }, { type: 'databaseBlock', attrs: { databaseId: dbId, viewId } }] },
    })
    await gotoPage(page, pageId)
    const inline = page.locator('#main .pv-content section.db.db--inline')
    await expect(inline).toHaveAttribute('data-view', 'feed')
    const feed = inline.getByRole('feed')
    await expect(entries(feed)).toHaveCount(4)
    const alpha = entry(feed, 'Alpha release')
    await alpha.scrollIntoViewIfNeeded()
    await expect(alpha.locator('.dbf-body')).toContainText('Alpha body text')
    await expect(alpha.locator('.dbf-body .page-link')).toContainText('Release notes')
    await expect(feed.locator('section.db')).toHaveCount(0)
    // expanding inside the page editor works and leaves the page alone
    const delta = entry(feed, 'Delta release')
    await delta.getByRole('button', { name: 'Show more' }).click()
    await expect(delta.getByRole('button', { name: 'Show less' })).toBeVisible()
    const content = await wsEval(page, (s, id) => JSON.stringify(s.pages[id].content), pageId)
    expect(content).not.toContain('Delta')

    // locked database: rows stay editable (New entry), the order is fixed
    await wsEval(page, (s, id) => s.updateDatabase(id, { locked: true }), dbId)
    await expect(inline.getByRole('button', { name: 'New entry' })).toBeVisible()
    await expect(inline.getByRole('button', { name: /^Order:/ })).toHaveCount(0)
    await expect(inline.locator('.dbf-head')).toContainText('Newest first')
    await wsEval(page, (s, id) => s.updateDatabase(id, { locked: false }), dbId)

    // view only (a viewer in a team workspace): no New entry, no order switch; entries still open
    await page.evaluate(() => (window as unknown as { __oneCloud: { set: (s: object) => void } }).__oneCloud.set({ readOnly: true }))
    await expect(inline.getByRole('button', { name: 'New entry' })).toHaveCount(0)
    await expect(inline.getByRole('button', { name: /^Order:/ })).toHaveCount(0)
    await entry(feed, 'Beta release').getByRole('button', { name: 'Open' }).click()
    await expect(page.locator('.peek .pv-title')).toHaveValue('Beta release')
    await expect(async () => {
      await page.keyboard.press('Escape')
      await expect(page.locator('.peek')).toHaveCount(0, { timeout: 500 })
    }).toPass()
    await page.evaluate(() => (window as unknown as { __oneCloud: { set: (s: object) => void } }).__oneCloud.set({ readOnly: false }))

    // share link: the database travels as a static table, read-only
    await page.locator('.tb').getByRole('button', { name: 'Share', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const url = dialog.getByRole('textbox', { name: 'Share link' })
    await expect(url).toHaveValue(/#\/s\//)
    const link = await url.inputValue()
    await page.keyboard.press('Escape')
    const other = await browser.newContext({ serviceWorkers: 'block', locale: 'en-US' })
    const p2 = await other.newPage()
    errors.watch(p2)
    await p2.goto(link)
    await expect(p2.locator('.shv__title')).toHaveText('Team updates')
    for (const t of ['Alpha release', 'Beta release', 'Gamma release', 'Delta release']) await expect(p2.locator('.shv__doc')).toContainText(t)
    await expect(p2.locator('[contenteditable="true"]')).toHaveCount(0)
    await other.close()
  })

  test('390 px: no rail, the date joins the stamp, nothing overflows sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openApp(page)
    const dbId = await createFeedDb(page)
    await wsEval(page, (s, id) => s.addView(id, { type: 'feed', name: 'Feed', visibleProperties: ['pStatus', 'pDate', 'pNotes'] }), dbId)
    await gotoPage(page, dbId)
    const db = mainDb(page)
    await db.getByRole('tab', { name: /Feed/ }).click()
    const feed = db.getByRole('feed')
    await expect(entries(feed)).toHaveCount(4)
    const delta = entry(feed, 'Delta release')
    await expect(delta.locator('.dbf-date')).toBeHidden()
    await expect(delta.locator('.dbf-stamp__date')).toBeVisible()
    // New entry keeps its name for assistive tech while it shows as "+"
    await expect(db.getByRole('button', { name: 'New entry' })).toBeVisible()
    const over = await db.evaluate((el) => {
      const feedEl = el.querySelector('.dbf') as HTMLElement
      const cards = Array.from(el.querySelectorAll<HTMLElement>('.dbf-card'))
      const right = feedEl.getBoundingClientRect().right
      return { scroll: feedEl.scrollWidth - feedEl.clientWidth, cards: cards.filter((c) => c.getBoundingClientRect().right > right + 1).length, page: document.documentElement.scrollWidth - window.innerWidth }
    })
    expect(over).toEqual({ scroll: 0, cards: 0, page: 0 })
    await delta.getByRole('button', { name: 'Show more' }).click()
    await expect(delta.getByRole('button', { name: 'Show less' })).toBeVisible()
    await delta.getByRole('button', { name: 'Open' }).click()
    await expect(page.locator('.peek .pv-title')).toHaveValue('Delta release')
  })
})
