import type { Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, gotoPage, createPage, doc, para, wsEval, pageById, pageIdByTitle, sidebarRow, MOD } from './fixtures'

async function openPalette(page: Page) {
  await page.keyboard.press(`${MOD}+k`)
  const pal = page.getByRole('dialog', { name: 'Command palette' })
  await expect(pal).toBeVisible()
  await expect(pal.getByRole('combobox')).toBeFocused()
  return pal
}

test.describe('command palette', () => {
  test('search by title, open the result', async ({ page }) => {
    await openApp(page)
    const pal = await openPalette(page)
    await page.keyboard.type('reading')
    const hit = pal.getByRole('option').filter({ hasText: 'Reading list' }).first()
    await expect(hit).toBeVisible()
    // the best hit is preselected
    await expect(pal.locator('[role="option"][aria-selected="true"]')).toContainText('Reading list')
    await page.keyboard.press('Enter')
    await expect(pal).toBeHidden()
    await expect(page.locator('#main .pv-title')).toHaveValue('Reading list')
    // database page renders its gallery view
    await expect(page.locator('#main [role="tablist"][aria-label="Views"]')).toBeVisible()
  })

  test('search by page content shows a snippet and opens the page', async ({ page }) => {
    await openApp(page)
    const pal = await openPalette(page)
    await page.keyboard.type('Respect the reader')
    // the meeting notes carry the same principles as a synced block — pick the Brand voice page itself
    const hit = pal.getByRole('option').filter({ has: page.locator('.pal-item__title', { hasText: /^Brand voice$/ }) })
    await expect(hit).toBeVisible()
    await expect(hit.locator('.pal-item__snippet mark').first()).toBeVisible()
    await hit.click()
    await expect(page.locator('#main .pv-title')).toHaveValue('Brand voice')
    await expect(page.locator('#main .ProseMirror')).toContainText('Respect the reader')
  })

  test('run a command: toggle dark mode', async ({ page }) => {
    await openApp(page)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    const pal = await openPalette(page)
    await page.keyboard.type('>dark')
    await expect(pal.locator('.pal-mode')).toHaveText('RUN')
    await expect(pal.locator('[role="option"][aria-selected="true"]')).toContainText('Toggle dark mode')
    await page.keyboard.press('Enter')
    await expect(pal).toBeHidden()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    expect(await wsEval(page, (s) => s.settings.theme)).toBe('dark')
    // theme survives a reload
    await reloadApp(page)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })

  test('Escape closes the palette', async ({ page }) => {
    await openApp(page)
    const pal = await openPalette(page)
    await page.keyboard.press('Escape')
    await expect(pal).toBeHidden()
  })
})

test.describe('sidebar', () => {
  test('rename a page from the row menu', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Rename me' })
    const row = sidebarRow(page, 'Rename me')
    await row.hover()
    await row.getByRole('button', { name: 'More' }).click()
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    // while renaming, the row shows an input instead of its title
    const input = page.locator('.sb input.sb-row__rename')
    await expect(input).toBeFocused()
    await input.fill('Renamed page')
    await input.press('Enter')
    await expect(sidebarRow(page, 'Renamed page')).toBeVisible()
    expect((await pageById(page, id)).title).toBe('Renamed page')
  })

  test('nest a page under another via "Move to…"', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Movable page' })
    const wiki = await pageIdByTitle(page, 'Team wiki')
    const row = sidebarRow(page, 'Movable page')
    await row.hover()
    await row.getByRole('button', { name: 'More' }).click()
    await page.getByRole('menuitem', { name: 'Move to…' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByPlaceholder('Find a destination page…').fill('Team wiki')
    await dialog.getByRole('option').filter({ hasText: 'Team wiki' }).first().click()
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await pageById(page, id)).parentId).toBe(wiki)
    // the tree shows it inside the wiki (expand the wiki to see it)
    const wikiRow = sidebarRow(page, 'Team wiki')
    const toggle = wikiRow.locator('.sb-row__toggle')
    if ((await toggle.getAttribute('aria-label')) === 'Expand') await toggle.click()
    const child = page.locator('.sb section[aria-label="Pages"] .sb-children .sb-row__title', { hasText: 'Movable page' })
    await expect(child).toBeVisible()
    await expect(child.locator('xpath=ancestor::a[1]')).toHaveAttribute('aria-level', '2')
  })

  test('favourite a page, then unfavourite it', async ({ page }) => {
    await openApp(page)
    await createPage(page, { title: 'Star me' })
    const favs = page.locator('.sb section[aria-label="Favorites"]')
    await expect(favs.locator('.sb-row')).toHaveCount(2)
    const row = sidebarRow(page, 'Star me')
    await row.hover()
    await row.getByRole('button', { name: 'More' }).click()
    await page.getByRole('menuitem', { name: 'Add to favorites' }).click()
    await expect(favs.locator('.sb-row__title', { hasText: 'Star me' })).toBeVisible()
    await expect(favs.locator('.sb-row')).toHaveCount(3)
    // the topbar star reflects it on the open page
    await row.locator('.sb-row__link').click()
    await expect(page.locator('.tb-star')).toHaveAttribute('aria-pressed', 'true')
    await page.locator('.tb-star').click()
    await expect(favs.locator('.sb-row__title', { hasText: 'Star me' })).toHaveCount(0)
  })

  test('delete → trash → restore', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Trash me', content: doc(para('precious words')) })
    await gotoPage(page, id)
    const row = sidebarRow(page, 'Trash me')
    await row.hover()
    await row.getByRole('button', { name: 'More' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await expect(sidebarRow(page, 'Trash me')).toHaveCount(0)
    await expect(page.getByText('Moved “Trash me” to trash')).toBeVisible()
    // leaving a deleted page: back to home
    await expect(page).not.toHaveURL(new RegExp(`#/p/${id}`))
    expect((await pageById(page, id)).trashed).toBe(true)

    await page.locator('.sb-trash').click()
    const trash = page.getByRole('dialog', { name: 'Trash' })
    await expect(trash).toBeVisible()
    const item = trash.locator('.trash-item', { hasText: 'Trash me' })
    await expect(item).toBeVisible()
    await item.getByRole('button', { name: 'Restore' }).click()
    await expect(sidebarRow(page, 'Trash me')).toBeVisible()
    const p = await pageById(page, id)
    expect(p.trashed).toBe(false)
    expect(p.plain).toContain('precious words')
  })
})

test.describe('workflows', () => {
  test('palette: "Create page" from a query that matches nothing', async ({ page }) => {
    await openApp(page)
    const pal = await openPalette(page)
    await page.keyboard.type('Quarterly zebra plan')
    const create = pal.getByRole('option', { name: /Create page “Quarterly zebra plan”/ })
    await expect(create).toBeVisible()
    await create.click()
    await expect(page.locator('#main .pv-title')).toHaveValue('Quarterly zebra plan')
    await expect(sidebarRow(page, 'Quarterly zebra plan')).toBeVisible()
  })

  test('Undo in the "moved to trash" toast restores the page and its star', async ({ page }) => {
    await openApp(page)
    const projects = await pageIdByTitle(page, 'Projects')
    await gotoPage(page, projects)
    await page.locator('.tb').getByRole('button', { name: 'Page options' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    const toast = page.getByText('Moved “Projects” to trash')
    await expect(toast).toBeVisible()
    await expect(page.locator('.sb section[aria-label="Favorites"] .sb-row__title', { hasText: 'Projects' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.locator('.sb section[aria-label="Favorites"] .sb-row__title', { hasText: 'Projects' })).toBeVisible()
    await expect(page.locator('#main .pv-title')).toHaveValue('Projects')
    const p = await pageById(page, projects)
    expect(p.trashed).toBe(false)
    expect(p.favorite).toBe(true)
    // its rows are reachable again
    await expect(page.locator('#main section.db').getByText('Website relaunch').first()).toBeVisible()
  })

  test('keyboard shortcuts: new page, sidebar, focus mode, shortcuts sheet', async ({ page }) => {
    await openApp(page)
    const before = await wsEval(page, (s) => Object.keys(s.pages).length)
    await page.locator('#main .pv-title').click()
    await page.keyboard.press('Control+Alt+n')
    await expect(page.locator('#main .pv-title')).toHaveValue('')
    await expect(page.locator('#main .pv-title')).toBeFocused()
    expect(await wsEval(page, (s) => Object.keys(s.pages).length)).toBe(before + 1)

    await page.keyboard.press(`${MOD}+\\`)
    await expect(page.locator('aside.sb')).toHaveAttribute('data-state', 'collapsed')
    await page.keyboard.press(`${MOD}+\\`)
    await expect(page.locator('aside.sb')).toHaveAttribute('data-state', 'docked')

    await page.keyboard.press(`${MOD}+Shift+f`)
    await expect(page.locator('.app')).toHaveAttribute('data-focus', 'true')
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Escape')
    await expect(page.locator('.app')).not.toHaveAttribute('data-focus', 'true')

    await page.keyboard.press(`${MOD}+/`)
    const sheet = page.getByRole('dialog')
    await expect(sheet).toContainText('New page')
    await page.keyboard.press('Escape')
  })

  test('the welcome page documents the same shortcuts the app binds', async ({ page }) => {
    await openApp(page)
    // the real binding, as shown by the shortcuts sheet: New page = Ctrl+Alt+N (Ctrl+N belongs to the browser)
    await page.keyboard.press(`${MOD}+/`)
    const sheet = page.getByRole('dialog')
    await expect(sheet).toContainText('New page')
    const sheetText = (await sheet.innerText()).replace(/\s+/g, ' ')
    expect(sheetText).toMatch(/New page (Ctrl ?\+? ?Alt ?\+? ?N|⌘ ?⌥ ?N)/i)
    await page.keyboard.press('Escape')

    // the welcome page's "Keyboard shortcuts" toggle
    const toggle = page.locator('#main .ProseMirror [data-type="details"]', { hasText: 'Keyboard shortcuts' })
    await toggle.getByRole('button', { name: 'Expand toggle' }).click()
    const newPageRow = toggle.locator('tr', { hasText: 'New page' })
    await expect(newPageRow).toBeVisible()
    await expect(newPageRow, 'welcome page teaches the New page shortcut').toContainText(/Ctrl\+Alt\+N|⌘⌥N/)
  })

  test('two tabs: edits sync both ways without a reload', async ({ page, context, errors }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Synced page', content: doc(para('base')) })
    await gotoPage(page, id)
    const tabB = await context.newPage()
    errors.watch(tabB)
    await tabB.goto(`app/?e2e#/p/${id}`)
    await tabB.waitForFunction(() => !!(window as unknown as { __one?: unknown }).__one)
    const edA = page.locator(`.ProseMirror[data-page-id="${id}"]`)
    const edB = tabB.locator(`.ProseMirror[data-page-id="${id}"]`)
    await expect(edB).toContainText('base')
    // both tabs settled (mount writes saved and broadcast)
    await page.waitForTimeout(1500)

    // A types → B follows
    await edA.locator('p').first().click()
    await page.keyboard.press('End')
    await page.keyboard.type(' +A')
    await expect(edB).toHaveText('base +A', { timeout: 10_000 })
    await page.waitForTimeout(1000)

    // B types → A follows
    await edB.locator('p').first().click()
    await tabB.keyboard.press('End')
    await tabB.keyboard.type(' +B')
    await expect(edA).toHaveText('base +A +B', { timeout: 10_000 })

    // rename in B → the sidebar in A follows
    await tabB.locator('#main .pv-title').fill('Synced page (renamed in B)')
    await expect(page.locator('.sb .sb-row__title', { hasText: 'Synced page (renamed in B)' }).first()).toBeVisible({ timeout: 10_000 })
    await tabB.close()
  })

  test('two tabs: near-simultaneous edits of one page keep both tabs\' words', async ({ page, context, errors }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Race page', content: doc(para('base')) })
    await gotoPage(page, id)
    const tabB = await context.newPage()
    errors.watch(tabB)
    await tabB.goto(`app/?e2e#/p/${id}`)
    await tabB.waitForFunction(() => !!(window as unknown as { __one?: unknown }).__one)
    const edA = page.locator(`.ProseMirror[data-page-id="${id}"]`)
    const edB = tabB.locator(`.ProseMirror[data-page-id="${id}"]`)
    await expect(edB).toContainText('base')
    await page.waitForTimeout(1500)
    const plainB = () => tabB.evaluate((id) => (window as unknown as { __one: { workspace: { getState: () => { pages: Record<string, { plain: string }> } } } }).__one.workspace.getState().pages[id].plain, id)

    // both people type into the same page, from "at once" to a quarter second apart
    for (const gap of [0, 120, 250]) {
      await edA.locator('p').first().click()
      await page.keyboard.press('End')
      await page.keyboard.type(` A${gap}`)
      await page.waitForTimeout(gap)
      await edB.locator('p').first().click()
      await tabB.keyboard.press('End')
      await tabB.keyboard.type(` B${gap}`)
      await page.waitForTimeout(3000)

      const shownA = (await edA.innerText()).trim()
      const shownB = (await edB.innerText()).trim()
      const storedA = await wsEval(page, (s, id) => s.pages[id].plain, id)
      const storedB = await plainB()
      // each tab shows what it stores, both converge, and nobody's words are gone
      expect(shownA, `gap ${gap}: tab A editor vs tab A store`).toBe(storedA)
      expect(shownB, `gap ${gap}: tab B editor vs tab B store`).toBe(storedB)
      expect(storedA, `gap ${gap}: tabs converge`).toBe(storedB)
      expect(storedA, `gap ${gap}: tab A's words kept`).toContain(`A${gap}`)
      expect(storedA, `gap ${gap}: tab B's words kept`).toContain(`B${gap}`)
    }
    // … and that is also what IndexedDB holds
    const idb = await page.evaluate(
      (id) =>
        new Promise<string>((resolve, reject) => {
          const r = indexedDB.open('keyval-store')
          r.onerror = () => reject(r.error)
          r.onsuccess = () => {
            // one record per page (store/persistence.ts, layout v2)
            const q = r.result.transaction('keyval', 'readonly').objectStore('keyval').get(`one.page.v2:${id}`)
            q.onsuccess = () => resolve(JSON.stringify(q.result.content))
            q.onerror = () => reject(q.error)
          }
        }),
      id,
    )
    for (const w of ['A0', 'B0', 'A120', 'B120', 'A250', 'B250']) expect(idb, `stored content keeps ${w}`).toContain(w)
    await tabB.close()
  })

  test('two tabs: different fields of one database row set at once are both kept', async ({ page, context, errors }) => {
    await openApp(page)
    const tabB = await context.newPage()
    errors.watch(tabB)
    await tabB.goto('app/?e2e')
    await tabB.waitForFunction(() => !!(window as unknown as { __one?: unknown }).__one && !document.getElementById('boot'))
    // a seeded database row with two plain-valued fields (number / text) to set
    const target = await wsEval(page, (s) => {
      const simple = (t: string) => t === 'number' || t === 'text' || t === 'url'
      const db = Object.values(s.databases as Record<string, { id: string; properties: Array<{ id: string; type: string }> }>).find((d) => d.properties.filter((p) => simple(p.type)).length >= 2)
      if (!db) return null
      const row = Object.values(s.pages as Record<string, { id: string; databaseId: string | null; trashed: boolean }>).find((p) => p.databaseId === db.id && !p.trashed)
      const [f1, f2] = db.properties.filter((p) => simple(p.type))
      const value = (t: string, n: number) => (t === 'number' ? 4240 + n : t === 'url' ? `https://example.com/${n}` : `set in tab ${n}`)
      return row ? { row: row.id, f1: f1.id, f2: f2.id, v1: value(f1.type, 1), v2: value(f2.type, 2) } : null
    })
    test.skip(!target, 'no database with two plain fields in the seed')
    const { row, f1, f2, v1, v2 } = target!
    await page.waitForTimeout(1500)
    type Hook = { __one: { workspace: { getState: () => { setRowProperty: (r: string, p: string, v: unknown) => void } } } }
    await Promise.all([
      page.evaluate(([row, f, v]) => (window as unknown as Hook).__one.workspace.getState().setRowProperty(row, f, v), [row, f1, v1] as const),
      tabB.evaluate(([row, f, v]) => (window as unknown as Hook).__one.workspace.getState().setRowProperty(row, f, v), [row, f2, v2] as const),
    ])
    await page.waitForTimeout(2500)
    const read = (p: Page) =>
      p.evaluate(([row, f1, f2]) => {
        const s = (window as unknown as { __one: { workspace: { getState: () => { pages: Record<string, { properties: Record<string, unknown> }> } } } }).__one.workspace.getState()
        return [s.pages[row].properties[f1], s.pages[row].properties[f2]]
      }, [row, f1, f2] as const)
    expect(await read(page)).toEqual([v1, v2])
    expect(await read(tabB)).toEqual([v1, v2])
    await tabB.close()
  })
})
