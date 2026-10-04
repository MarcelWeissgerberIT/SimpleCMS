/**
 * Databases in the sidebar tree: a database expands to its entries (ordered like its first view, at
 * most 20 + a "show all" key), entries expand to their sub-items and sub-pages, "+" on a database makes
 * a new entry, and drag & drop crosses the database edge (a page becomes an entry, an entry a page).
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect, openApp, gotoPage, createPage, wsEval, pageById, pageIdByTitle, escapeRe, flush } from './fixtures'

const tree = (page: Page) => page.locator('.sb section[aria-label="Pages"], .sb section[aria-label="Seiten"]')
const row = (page: Page, title: string) => tree(page).locator('.sb-row', { has: page.locator('.sb-row__title', { hasText: new RegExp(`^${escapeRe(title)}$`) }) })
/** Titles of the rows directly inside a node (its entries, sub-items, sub-pages), in tree order. */
const childTitles = (r: Locator) => r.locator('xpath=..').locator(':scope > .sb-children > .sb-node > .sb-row .sb-row__title').allInnerTexts()

async function expand(page: Page, title: string) {
  const r = row(page, title)
  const toggle = r.locator('.sb-row__toggle')
  await r.hover()
  if ((await toggle.getAttribute('aria-label')) === 'Expand' || (await toggle.getAttribute('aria-label')) === 'Aufklappen') await toggle.click()
  await expect(r.locator('.sb-row__link')).toHaveAttribute('aria-expanded', 'true')
}

/**
 * Start dragging `src` and hover `dst` at `frac` of its height (0 = top edge, 0.5 = middle). A tall
 * window keeps both rows clear of the tree's edges, where dragging scrolls the tree.
 */
async function dragOver(page: Page, src: Locator, dst: Locator, frac = 0.5) {
  if ((page.viewportSize()?.height ?? 0) < 1400) await page.setViewportSize({ width: 1440, height: 1400 })
  await src.scrollIntoViewIfNeeded()
  const a = (await src.boundingBox())!
  await page.mouse.move(a.x + 60, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + 60, a.y + a.height / 2 - 8, { steps: 3 })
  const b = (await dst.boundingBox())!
  await page.mouse.move(b.x + 60, b.y + b.height * frac, { steps: 15 })
}

const SEEDED = ['Website relaunch', 'Import our Notion workspace', 'n8n lead-routing automation', 'Q4 content calendar', 'AI support assistant', 'Brand refresh']

async function projects(page: Page) {
  const id = await pageIdByTitle(page, 'Projects')
  const db = await wsEval(page, (s, id) => ({ view: s.databases[id].views[0].id as string, props: s.databases[id].properties as Array<{ id: string; name: string; type: string; options?: Array<{ id: string; name: string }> }> }), id)
  return { id, ...db }
}

test.describe('databases in the sidebar', () => {
  test('a database expands to its entries in the order of its first view, unfiltered', async ({ page }) => {
    await openApp(page)
    const p = await projects(page)
    await expand(page, 'Projects')
    // the first view (a board) has no sorts: manual order; sub-items sit under their parent row
    expect(await childTitles(row(page, 'Projects'))).toEqual(SEEDED)
    await expect(row(page, 'Website relaunch').locator('.sb-row__link')).toHaveAttribute('aria-level', '2')
    // its sorts decide — and its filters don't hide anything
    const title = p.props.find((x) => x.type === 'title')!.id
    const status = p.props.find((x) => x.name === 'Status')!
    await wsEval(
      page,
      (s, a) =>
        s.updateView(a.id, a.view, {
          sorts: [{ propertyId: a.title, direction: 'desc' }],
          filter: { id: 'f', op: 'and', items: [{ id: 'f1', propertyId: a.status, operator: 'is', value: a.done }] },
        }),
      { id: p.id, view: p.view, title, status: status.id, done: status.options!.find((o) => o.name === 'Done')!.id },
    )
    await expect.poll(() => childTitles(row(page, 'Projects'))).toEqual(['Website relaunch', 'Q4 content calendar', 'n8n lead-routing automation', 'Import our Notion workspace', 'Brand refresh', 'AI support assistant'])
    // a renamed entry moves to its sorted place
    const brand = await pageIdByTitle(page, 'Brand refresh')
    await wsEval(page, (s, id) => s.updatePage(id, { title: 'Zebra rebrand' }), brand)
    await expect.poll(async () => (await childTitles(row(page, 'Projects')))[0]).toBe('Zebra rebrand')
  })

  test('an entry opens from the sidebar; opening one elsewhere reveals it', async ({ page }) => {
    await openApp(page)
    await expand(page, 'Projects')
    await row(page, 'Brand refresh').locator('.sb-row__link').click()
    const id = await pageIdByTitle(page, 'Brand refresh')
    await expect(page.locator('#main .pv-title')).toHaveValue('Brand refresh')
    await expect(page).toHaveURL(new RegExp(`#/p/${id}`))
    await expect(row(page, 'Brand refresh')).toHaveAttribute('data-active', 'true')
    // collapsed again, then a sub-item opened from elsewhere: the database and the parent entry open up
    await row(page, 'Projects').hover()
    await row(page, 'Projects').locator('.sb-row__toggle').click()
    await expect(row(page, 'Brand refresh')).toHaveCount(0)
    await gotoPage(page, await pageIdByTitle(page, 'Pricing page experiment'))
    await expect(row(page, 'Pricing page experiment')).toHaveAttribute('data-active', 'true')
    await expect(row(page, 'Pricing page experiment').locator('.sb-row__link')).toHaveAttribute('aria-level', '3')
  })

  test('sub-items nest under their parent entry, sub-pages of an entry under it', async ({ page }) => {
    await openApp(page)
    const relaunch = await pageIdByTitle(page, 'Website relaunch')
    await createPage(page, { title: 'Launch checklist', parentId: relaunch })
    await expand(page, 'Projects')
    await expect(row(page, 'Pricing page experiment')).toHaveCount(0)
    await expand(page, 'Website relaunch')
    // sub-items first, then the pages inside the entry
    expect(await childTitles(row(page, 'Website relaunch'))).toEqual(['Pricing page experiment', 'Launch checklist'])
    await expect(row(page, 'Launch checklist').locator('.sb-row__link')).toHaveAttribute('aria-level', '3')
    await expand(page, 'Q4 content calendar')
    expect(await childTitles(row(page, 'Q4 content calendar'))).toEqual(['Customer onboarding video'])
    // an entry without anything inside says so
    await expand(page, 'Brand refresh')
    await expect(row(page, 'Brand refresh').locator('xpath=..').locator('.sb-empty')).toHaveText('No pages inside')
  })

  test('"+" on a database creates an entry with the first view\'s presets and opens it (EN + DE)', async ({ page }) => {
    await openApp(page)
    const p = await projects(page)
    const status = p.props.find((x) => x.name === 'Status')!
    const review = status.options!.find((o) => o.name === 'Review')!.id
    await wsEval(page, (s, a) => s.updateView(a.id, a.view, { filter: { id: 'f', op: 'and', items: [{ id: 'f1', propertyId: a.status, operator: 'is', value: a.review }] } }), {
      id: p.id,
      view: p.view,
      status: status.id,
      review,
    })
    const before = await wsEval(page, (s, id) => Object.values(s.pages).filter((x) => (x as { databaseId: string }).databaseId === id).length, p.id)
    await row(page, 'Projects').hover()
    await row(page, 'Projects').getByRole('button', { name: 'New entry' }).click()
    await expect(page.locator('#main .pv-title')).toBeFocused()
    await page.keyboard.type('Sidebar entry')
    await expect.poll(() => wsEval(page, (s) => (Object.values(s.pages) as Array<{ title: string }>).some((x) => x.title === 'Sidebar entry'))).toBe(true)
    const id = await pageIdByTitle(page, 'Sidebar entry')
    const entry = await pageById(page, id)
    expect(entry.databaseId).toBe(p.id)
    expect(entry.properties[status.id]).toBe(review)
    await expect(page).toHaveURL(new RegExp(`#/p/${id}`))
    // the database opened and shows its new entry
    await expect(row(page, 'Sidebar entry')).toHaveAttribute('data-active', 'true')

    // German: the button and the "…" menu entry
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await row(page, 'Projects').hover()
    await expect(row(page, 'Projects').getByRole('button', { name: 'Neuer Eintrag' })).toBeVisible()
    await row(page, 'Projects').getByRole('button', { name: 'Mehr' }).click()
    await page.getByRole('menuitem', { name: 'Neuer Eintrag' }).click()
    await expect(page.locator('#main .pv-title')).toBeFocused()
    await expect.poll(() => wsEval(page, (s, id) => Object.values(s.pages).filter((x) => (x as { databaseId: string }).databaseId === id).length, p.id)).toBe(before + 2)
  })

  test('a long database lists 20 entries, then "show all" opens it', async ({ page }) => {
    await openApp(page)
    const dbId = await wsEval(page, (s) => {
      const id = s.createDatabase({ title: 'Long list' })
      for (let i = 1; i <= 25; i++) s.createRow(id, { title: `Item ${String(i).padStart(2, '0')}` })
      return id
    })
    await flush(page)
    await expand(page, 'Long list')
    const r = row(page, 'Long list')
    expect(await childTitles(r)).toHaveLength(20)
    const more = tree(page).getByTestId('tree-show-all')
    await expect(more).toHaveText('Show all · 25')
    await expect(more).toHaveAttribute('aria-label', 'Show all 25 entries of Long list')
    // the open entry shows even past the first 20
    await gotoPage(page, await pageIdByTitle(page, 'Item 24'))
    await expect(row(page, 'Item 24')).toHaveAttribute('data-active', 'true')
    expect(await childTitles(r)).toHaveLength(21)
    await more.click()
    await expect(page).toHaveURL(new RegExp(`#/p/${dbId}$`))
    await expect(page.locator('#main section.db')).toBeVisible()
  })

  test('templates, hidden and trashed rows stay out of the tree', async ({ page }) => {
    await openApp(page)
    const p = await projects(page)
    await wsEval(
      page,
      (s, id) => {
        const tpl = s.createRow(id, { title: 'Template row' })
        s.updatePage(tpl, { hidden: true, template: { name: 'Template row', description: '', category: 'other' } })
        const gone = s.createRow(id, { title: 'Trashed row' })
        s.trashPage(gone)
        s.createRow(id, { title: 'Visible row' })
      },
      p.id,
    )
    await expand(page, 'Projects')
    await expect(row(page, 'Visible row')).toHaveCount(1)
    await expect(row(page, 'Template row')).toHaveCount(0)
    await expect(row(page, 'Trashed row')).toHaveCount(0)
  })

  test('drop a page onto a database: it becomes an entry (asks when sub-pages come along)', async ({ page }) => {
    await openApp(page)
    const p = await projects(page)
    const loose = await createPage(page, { title: 'Loose note' })
    await dragOver(page, row(page, 'Loose note'), row(page, 'Projects'))
    await expect(row(page, 'Projects')).toHaveAttribute('data-drop', 'inside')
    await page.mouse.up()
    await expect.poll(async () => (await pageById(page, loose)).databaseId).toBe(p.id)
    expect((await pageById(page, loose)).parentId).toBe(p.id)
    await expect(page.locator('.toast', { hasText: '“Loose note” is now an entry of Projects' })).toBeVisible()
    await expect(row(page, 'Loose note').locator('.sb-row__link')).toHaveAttribute('aria-level', '2')

    // no reorder marks between entries: a page over an entry's edge goes inside it (or nowhere)
    const other = await createPage(page, { title: 'Second note' })
    await dragOver(page, row(page, 'Second note'), row(page, 'Brand refresh'), 0.1)
    await expect(row(page, 'Brand refresh')).toHaveAttribute('data-drop', 'inside')
    await page.mouse.move(10, 10, { steps: 4 })
    await page.mouse.up()
    expect((await pageById(page, other)).parentId).toBeNull()
    // … and an entry over another entry: no target at all
    await dragOver(page, row(page, 'Loose note'), row(page, 'Brand refresh'))
    await expect(row(page, 'Loose note')).toHaveAttribute('data-dragging', 'true')
    await expect(row(page, 'Brand refresh')).not.toHaveAttribute('data-drop', /.*/)
    await page.mouse.move(10, 10, { steps: 4 })
    await page.mouse.up()
    await row(page, 'Projects').hover()
    await row(page, 'Projects').locator('.sb-row__toggle').click()

    // a page with sub-pages: asks first, the sub-pages come along
    const folder = await createPage(page, { title: 'Folder note' })
    const inner = await createPage(page, { title: 'Inner note', parentId: folder })
    await dragOver(page, row(page, 'Folder note'), row(page, 'Reading list'))
    await expect(row(page, 'Reading list')).toHaveAttribute('data-drop', 'inside')
    await page.mouse.up()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Make “Folder note” an entry of Reading list?')
    await expect(dialog).toContainText('Its sub-page comes along')
    await dialog.getByRole('button', { name: 'Make entry' }).click()
    const reading = await pageIdByTitle(page, 'Reading list')
    await expect.poll(async () => (await pageById(page, folder)).databaseId).toBe(reading)
    expect((await pageById(page, inner)).parentId).toBe(folder)
  })

  test('drop an entry onto a page: confirm, then it is a normal page (links to it go)', async ({ page }) => {
    await openApp(page)
    const p = await projects(page)
    const wiki = await pageIdByTitle(page, 'Team wiki')
    const notion = await pageIdByTitle(page, 'Import our Notion workspace')
    const relaunch = await pageIdByTitle(page, 'Website relaunch')
    const blockedBy = p.props.find((x) => x.name === 'Blocked by')!.id
    expect((await pageById(page, relaunch)).properties[blockedBy]).toContain(notion)
    await expand(page, 'Projects')
    await dragOver(page, row(page, 'Import our Notion workspace'), row(page, 'Team wiki'))
    await expect(row(page, 'Team wiki')).toHaveAttribute('data-drop', 'inside')
    await page.mouse.up()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Remove from database and move here?')
    // cancel keeps it an entry
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect((await pageById(page, notion)).databaseId).toBe(p.id)

    await dragOver(page, row(page, 'Import our Notion workspace'), row(page, 'Team wiki'))
    await page.mouse.up()
    await page.getByRole('dialog').getByRole('button', { name: 'Remove and move' }).click()
    await expect.poll(async () => (await pageById(page, notion)).databaseId).toBeNull()
    const moved = await pageById(page, notion)
    expect(moved.parentId).toBe(wiki)
    expect(moved.properties).toEqual({})
    expect((await pageById(page, relaunch)).properties[blockedBy]).not.toContain(notion)
    await expect(row(page, 'Import our Notion workspace').locator('.sb-row__link')).toHaveAttribute('aria-level', '2')
    expect(await childTitles(row(page, 'Projects'))).not.toContain('Import our Notion workspace')
    // undo puts it back, links included
    await page.locator('.toast', { hasText: 'moved out of Projects' }).getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await pageById(page, notion)).databaseId).toBe(p.id)
    expect((await pageById(page, relaunch)).properties[blockedBy]).toContain(notion)
  })

  test('viewers read the entries but get no "+" and no dragging', async ({ page }) => {
    await openApp(page)
    await expand(page, 'Projects')
    await page.evaluate(() => (window as unknown as { __oneCloud: { set: (s: object) => void } }).__oneCloud.set({ readOnly: true }))
    await row(page, 'Projects').hover()
    await expect(row(page, 'Projects').getByRole('button', { name: 'New entry' })).toHaveCount(0)
    await row(page, 'Projects').getByRole('button', { name: 'More' }).click()
    await expect(page.getByRole('menuitem', { name: 'Copy link' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'New entry' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(row(page, 'Brand refresh')).toBeVisible()
    await row(page, 'Brand refresh').hover()
    await expect(row(page, 'Brand refresh').getByRole('button', { name: 'Add a page inside' })).toHaveCount(0)
    await dragOver(page, row(page, 'Brand refresh'), row(page, 'Team wiki'))
    await expect(row(page, 'Team wiki')).not.toHaveAttribute('data-drop', /.*/)
    await expect(row(page, 'Brand refresh')).not.toHaveAttribute('data-dragging', /.*/)
    await page.mouse.up()
    await page.evaluate(() => (window as unknown as { __oneCloud: { set: (s: object) => void } }).__oneCloud.set({ readOnly: false }))
  })

  test('arrow keys walk into a database, its entries and their sub-items', async ({ page }) => {
    await openApp(page)
    const link = (title: string) => row(page, title).locator('.sb-row__link')
    await link('Projects').focus()
    await page.keyboard.press('ArrowRight')
    await expect(link('Projects')).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('ArrowDown')
    await expect(link('Website relaunch')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(link('Website relaunch')).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('ArrowRight')
    await expect(link('Pricing page experiment')).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(link('Website relaunch')).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(link('Website relaunch')).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('ArrowDown')
    await expect(link('Import our Notion workspace')).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(link('Projects')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('#main section.db')).toBeVisible()
  })

  test('5,000 entries: expanding renders fast and shows 20 + "show all"', async ({ page }) => {
    test.setTimeout(120_000)
    await openApp(page)
    await wsEval(page, (s) => {
      const id = s.createDatabase({ title: 'Huge log' })
      const first = s.createRow(id, { title: 'Row 0000' })
      const tpl = (window as unknown as { __one: { workspace: { getState: () => typeof s } } }).__one.workspace.getState().pages[first]
      const pages: Record<string, unknown> = {}
      for (let i = 1; i < 5000; i++) {
        const rid = `huge${i}`
        pages[rid] = { ...tpl, id: rid, title: `Row ${String(i).padStart(4, '0')}`, order: tpl.order + i, createdAt: tpl.createdAt + i }
      }
      s.cloudPatch({ pages })
    })
    const dbId = await pageIdByTitle(page, 'Huge log')
    const timeExpand = () =>
      page.evaluate(async (id) => {
        const link = document.querySelector<HTMLElement>(`.sb section[aria-label="Pages"] .sb-row__link[href="#/p/${id}"]`)!
        const toggle = link.parentElement!.querySelector<HTMLButtonElement>('.sb-row__toggle')!
        const t = performance.now()
        toggle.click()
        await new Promise<void>((resolve) => {
          const check = () => (document.querySelector('[data-testid="tree-show-all"]') ? requestAnimationFrame(() => resolve()) : requestAnimationFrame(check))
          check()
        })
        const ms = performance.now() - t
        toggle.click()
        return ms
      }, dbId)
    // first expand builds the index; later ones reuse it
    const first = await timeExpand()
    const again = await timeExpand()
    test.info().annotations.push({ type: 'expand 5,000 entries (ms)', description: JSON.stringify({ first, again }) })
    expect(first, 'expanding a 5,000-row database').toBeLessThan(200)
    expect(again).toBeLessThan(200)
    // sorted by title (descending): still fast, and in that order
    const view = await wsEval(page, (s, id) => s.databases[id].views[0]?.id ?? null, dbId)
    const titleProp = await wsEval(page, (s, id) => s.databases[id].properties.find((x: { type: string }) => x.type === 'title').id, dbId)
    if (view) {
      await wsEval(page, (s, a) => s.updateView(a.dbId, a.view, { sorts: [{ propertyId: a.titleProp, direction: 'desc' }] }), { dbId, view, titleProp })
      const sorted = await timeExpand()
      expect(sorted, 'expanding a sorted 5,000-row database').toBeLessThan(200)
    }
    await expand(page, 'Huge log')
    const titles = await childTitles(row(page, 'Huge log'))
    expect(titles).toHaveLength(20)
    if (view) expect(titles[0]).toBe('Row 4999')
    await expect(tree(page).getByTestId('tree-show-all')).toHaveText('Show all · 5,000')
  })
})

test.describe('databases in the sidebar at 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })

  test('the drawer expands a database, "+" adds an entry, an entry opens and the drawer closes', async ({ page }) => {
    await openApp(page)
    const sb = page.locator('aside.sb')
    await page.getByRole('button', { name: 'Open sidebar' }).tap()
    await expect(sb).toHaveAttribute('data-state', 'drawer-open')
    await row(page, 'Projects').getByRole('button', { name: 'Expand' }).tap()
    await expect(row(page, 'Brand refresh')).toBeVisible()
    await row(page, 'Brand refresh').locator('.sb-row__link').tap()
    await expect(sb).toHaveAttribute('data-state', 'drawer')
    await expect(page.locator('#main .pv-title')).toHaveValue('Brand refresh')
    await page.getByRole('button', { name: 'Open sidebar' }).tap()
    await row(page, 'Projects').getByRole('button', { name: 'New entry' }).tap()
    await expect(sb).toHaveAttribute('data-state', 'drawer')
    await expect(page.locator('#main .pv-title')).toHaveValue('')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
