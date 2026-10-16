/**
 * FAVORITES in the sidebar's fixed block (shell/sidebar/Favorites.tsx, shell/lib/favorites.ts): always there and numbered
 * 01 (empty, a slot teaches how), the row ☆ (hover, one name + aria-pressed, no Tab stop), drops onto the head, the slot
 * and between favourites, reordering by drag, Alt + ↑ / ↓ (focus stays, a live region says the place) and the row menu,
 * this device's order (localStorage one.shell.favorder:<kind>:<id>) across a reload, the removal toast's Undo back into
 * the old slot, a favourite under a trashed parent (numbers nothing, back in its slot after a Restore), the cap with the
 * list scrolling inside, exactly one orange bar, German strings.
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, gotoPage, createPage, wsEval, pageIdByTitle, sidebarRow, escapeRe } from './fixtures'

const ORDER_KEY = 'one.shell.favorder:local:local'
const favs = (page: Page) => page.locator('.sb section[aria-label="Favorites"]')
/** a favourite's own row (the list's roots, not their subtrees) */
const favRow = (page: Page, title: string) =>
  favs(page).locator('.sb-favs__list > .sb-node > .sb-row', { has: page.locator('.sb-row__title', { hasText: new RegExp(`^${escapeRe(title)}$`) }) })
const favTitles = (page: Page) => favs(page).locator('.sb-favs__list > .sb-node > .sb-row .sb-row__title')
const stored = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '[]') as string[], ORDER_KEY)

/** No favourites (the demo stars two). */
const clearFavs = (page: Page) => wsEval(page, (s) => Object.values(s.pages).forEach((p: { id: string; favorite: boolean }) => p.favorite && s.toggleFavorite(p.id)))
const star = (page: Page, ids: string[]) => wsEval(page, (s, ids) => ids.forEach((id) => !s.pages[id].favorite && s.toggleFavorite(id)), ids)

/** Drag a row by the mouse to (x, y) of `target` (its height × `at`); `check` runs before the drop. */
async function drag(page: Page, from: Locator, target: Locator, at = 0.5, check?: () => Promise<void>) {
  await from.scrollIntoViewIfNeeded()
  const a = (await from.boundingBox())!
  await page.mouse.move(a.x + 60, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + 60, a.y + a.height / 2 - 8, { steps: 3 })
  const b = (await target.boundingBox())!
  await page.mouse.move(b.x + 60, b.y + b.height * at, { steps: 15 })
  await page.mouse.move(b.x + 62, b.y + b.height * at, { steps: 2 })
  if (check) await check()
  await page.mouse.up()
}

test.describe('FAVORITES', () => {
  test('empty, it is 01 with a slot that teaches — in view with a deep page open; the tree reveals the page under it', async ({ page }) => {
    await openApp(page)
    await clearFavs(page)
    // a long tree, then a chain five levels deep at its end
    await wsEval(page, (s) => {
      for (let i = 0; i < 30; i++) s.createPage({ title: `Nordlicht note ${String(i).padStart(2, '0')}`, parentId: null })
    })
    let parent: string | null = null
    for (const title of ['Launch plan', 'Phase one', 'Step one', 'Checklist', 'Material list']) parent = await createPage(page, { title, parentId: parent })
    await gotoPage(page, parent!)
    const f = favs(page)
    await expect(f.locator('.sb-sect__n')).toHaveText('01')
    await expect(f.locator('.sb-sect__count')).toHaveText('00')
    const slot = f.locator('.sb-favs__slot')
    await expect(slot).toBeInViewport()
    await expect(slot.locator('.sb-favs__what')).toHaveText('Drag a page here')
    await expect(slot.locator('.sb-favs__how')).toHaveText('or ☆ on any page')
    // the open row shows in the tree, whole, below the stuck head
    const open = page.locator('.sb section[aria-label="Pages"] .sb-row[data-active]')
    await expect(open).toBeInViewport({ ratio: 1 })
    await expect(slot).toBeInViewport()
  })

  test('the row ☆: on hover, one name with aria-pressed, no Tab stop; a new star joins at the end without a toast', async ({ page }) => {
    await openApp(page)
    await createPage(page, { title: 'Tessera brief' })
    const row = sidebarRow(page, 'Tessera brief')
    const key = row.locator('.sb-row__star')
    await expect(key).toBeHidden()
    await row.hover()
    await expect(key).toBeVisible()
    await expect(key).toHaveAccessibleName('Favorite')
    await expect(key).toHaveAttribute('aria-pressed', 'false')
    await expect(key).toHaveAttribute('tabindex', '-1')
    await expect(key).toHaveAttribute('title', 'Add to favorites')
    await key.click()
    await expect(key).toHaveAttribute('aria-pressed', 'true')
    await expect(key).toHaveAccessibleName('Favorite')
    await expect(key).toHaveAttribute('title', 'Remove from favorites')
    // the two seeded favourites (never placed: by title) first, the new star at the end
    await expect(favTitles(page)).toHaveText(['Projects', 'Welcome to One', 'Tessera brief'])
    await expect(favs(page).locator('.sb-sect__count')).toHaveText('03')
    await expect(page.getByText(/is no longer a favorite/)).toHaveCount(0)
    const id = await pageIdByTitle(page, 'Tessera brief')
    expect((await stored(page)).at(-1)).toBe(id)
    // the page menu has the star by name too
    await gotoPage(page, id)
    await page.locator('.tb').getByRole('button', { name: 'Page options' }).click()
    await expect(page.getByRole('menuitem', { name: 'Remove from favorites' })).toBeVisible()
    await page.keyboard.press('Escape')
    // the topbar star: one name, its state pressed
    await expect(page.locator('.tb-star')).toHaveAccessibleName('Favorite')
    await expect(page.locator('.tb-star')).toHaveAttribute('aria-pressed', 'true')
  })

  test('drag a tree row onto the slot, onto the head and between two favourites — the page stays where it is', async ({ page }) => {
    await openApp(page)
    await clearFavs(page)
    const tessera = await createPage(page, { title: 'Tessera notes' })
    const mara = await createPage(page, { title: 'Mara Lind' })
    const launch = await createPage(page, { title: 'Launch plan' })
    const slot = favs(page).locator('.sb-favs__slot')
    await drag(page, sidebarRow(page, 'Tessera notes'), slot, 0.5, async () => {
      await expect(slot).toHaveAttribute('data-drop', 'true')
      await expect(slot.locator('.sb-favs__drop')).toHaveText('Release: becomes a favorite')
    })
    await expect(favTitles(page)).toHaveText(['Tessera notes'])
    await drag(page, sidebarRow(page, 'Mara Lind'), favs(page).locator('.sb-sect'), 0.5, async () => {
      await expect(favs(page)).toHaveAttribute('data-drop', 'true')
    })
    await expect(favTitles(page)).toHaveText(['Tessera notes', 'Mara Lind'])
    await drag(page, sidebarRow(page, 'Launch plan'), favRow(page, 'Mara Lind'), 0.25, async () => {
      await expect(favRow(page, 'Mara Lind')).toHaveAttribute('data-drop', 'before')
    })
    await expect(favTitles(page)).toHaveText(['Tessera notes', 'Launch plan', 'Mara Lind'])
    expect(await stored(page)).toEqual([tessera, launch, mara])
    // nothing moved in the tree
    for (const id of [tessera, mara, launch]) expect(await wsEval(page, (s, id) => s.pages[id].parentId, id)).toBeNull()
    await expect(sidebarRow(page, 'Launch plan')).toHaveCount(1)
  })

  test('reorder by drag, by Alt + ↑ / ↓ (the key stays, the place is said) and by the row menu; a favourite never moves its page', async ({ page }) => {
    await openApp(page)
    await clearFavs(page)
    const a = await createPage(page, { title: 'Fav Alpha' })
    const b = await createPage(page, { title: 'Fav Bravo' })
    const c = await createPage(page, { title: 'Fav Charlie' })
    await star(page, [a, b, c])
    await expect(favTitles(page)).toHaveText(['Fav Alpha', 'Fav Bravo', 'Fav Charlie'])
    // drag: Charlie onto Alpha's top half
    await drag(page, favRow(page, 'Fav Charlie'), favRow(page, 'Fav Alpha'), 0.25, async () => {
      await expect(favRow(page, 'Fav Alpha')).toHaveAttribute('data-drop', 'before')
    })
    await expect(favTitles(page)).toHaveText(['Fav Charlie', 'Fav Alpha', 'Fav Bravo'])
    // Alt + ↓ / ↑ on a focused favourite
    const link = favRow(page, 'Fav Alpha').locator('.sb-row__link')
    await link.focus()
    await expect(link).toHaveAttribute('aria-describedby', /sb-fav-keys/)
    await expect(page.locator('#sb-fav-keys')).toHaveText('Alt+↑ / ↓ moves it')
    await page.keyboard.press('Alt+ArrowDown')
    await expect(favTitles(page)).toHaveText(['Fav Charlie', 'Fav Bravo', 'Fav Alpha'])
    await expect(favRow(page, 'Fav Alpha').locator('.sb-row__link')).toBeFocused()
    await expect(page.locator('#sb-fav-live')).toHaveText('Favorite 3 of 3')
    await page.keyboard.press('Alt+ArrowDown')
    await expect(favTitles(page)).toHaveText(['Fav Charlie', 'Fav Bravo', 'Fav Alpha'])
    await page.keyboard.press('Alt+ArrowUp')
    await expect(favTitles(page)).toHaveText(['Fav Charlie', 'Fav Alpha', 'Fav Bravo'])
    await expect(favRow(page, 'Fav Alpha').locator('.sb-row__link')).toBeFocused()
    await expect(page.locator('#sb-fav-live')).toHaveText('Favorite 2 of 3')
    // the menu: Move up / Move down (the last one cannot go down)
    const bravo = favRow(page, 'Fav Bravo')
    await bravo.hover()
    await bravo.getByRole('button', { name: 'More' }).click()
    await expect(page.getByRole('menuitem', { name: 'Move down' })).toBeDisabled()
    await page.getByRole('menuitem', { name: 'Move up' }).click()
    await expect(favTitles(page)).toHaveText(['Fav Charlie', 'Fav Bravo', 'Fav Alpha'])
    // Shift+F10 opens a row's menu from the keyboard
    await favRow(page, 'Fav Bravo').locator('.sb-row__link').focus()
    await page.keyboard.press('Shift+F10')
    await expect(page.getByRole('menuitem', { name: 'Remove from favorites' })).toBeVisible()
    await page.keyboard.press('Escape')
    // a favourite dropped on the tree does nothing
    const team = sidebarRow(page, 'Team wiki')
    await drag(page, favRow(page, 'Fav Charlie'), team, 0.5, async () => {
      await expect(team).not.toHaveAttribute('data-drop', /.*/)
    })
    expect(await wsEval(page, (s, id) => s.pages[id].parentId, c)).toBeNull()
    expect(await stored(page)).toEqual([c, b, a])
  })

  test('the order is this device’s and this workspace’s: it survives a reload, another workspace’s list never mixes in', async ({ page }) => {
    await openApp(page)
    await clearFavs(page)
    const ids = [await createPage(page, { title: 'Order one' }), await createPage(page, { title: 'Order two' }), await createPage(page, { title: 'Order three' })]
    for (const t of ['Order three', 'Order one', 'Order two']) {
      const row = sidebarRow(page, t)
      await row.hover()
      await row.locator('.sb-row__star').click()
    }
    await expect(favTitles(page)).toHaveText(['Order three', 'Order one', 'Order two'])
    // another workspace's order on this device: never read here
    await page.evaluate((ids) => localStorage.setItem('one.shell.favorder:cloud:other', JSON.stringify([...ids].reverse())), ids)
    await reloadApp(page)
    await expect(favTitles(page)).toHaveText(['Order three', 'Order one', 'Order two'])
    expect(await stored(page)).toEqual([ids[2], ids[0], ids[1]])
    // not in the workspace itself
    expect(await wsEval(page, (s) => JSON.stringify(s).includes('favorder'))).toBe(false)
  })

  test('removing a favourite says so; Undo puts it back into its slot (row ☆ and topbar ☆)', async ({ page }) => {
    await openApp(page)
    await clearFavs(page)
    const ids = [await createPage(page, { title: 'Slot A' }), await createPage(page, { title: 'Slot B' }), await createPage(page, { title: 'Slot C' })]
    for (const t of ['Slot A', 'Slot B', 'Slot C']) {
      const row = sidebarRow(page, t)
      await row.hover()
      await row.locator('.sb-row__star').click()
    }
    const b = favRow(page, 'Slot B')
    await b.hover()
    await b.locator('.sb-row__star').click()
    await expect(favTitles(page)).toHaveText(['Slot A', 'Slot C'])
    await expect(page.getByText('“Slot B” is no longer a favorite')).toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(favTitles(page)).toHaveText(['Slot A', 'Slot B', 'Slot C'])
    expect(await wsEval(page, (s, id) => s.pages[id].favorite, ids[1])).toBe(true)
    // the topbar star: the same toast
    await gotoPage(page, ids[0])
    await page.locator('.tb-star').click()
    await expect(favTitles(page)).toHaveText(['Slot B', 'Slot C'])
    await expect(page.getByText('“Slot A” is no longer a favorite')).toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(favTitles(page)).toHaveText(['Slot A', 'Slot B', 'Slot C'])
    await expect(page.locator('.tb-star')).toHaveAttribute('aria-pressed', 'true')
  })

  test('a favourite under a trashed parent numbers nothing and is back in its slot after a Restore', async ({ page }) => {
    await openApp(page)
    await clearFavs(page)
    const old = await createPage(page, { title: 'Old notes' })
    const draft = await createPage(page, { title: 'Draft Q3', parentId: old })
    await createPage(page, { title: 'Before draft' })
    await createPage(page, { title: 'After draft' })
    await createPage(page, { title: 'Later star' })
    await star(page, [draft])
    await expect(favTitles(page)).toHaveText(['Draft Q3'])
    // only the parent goes to the trash: the child keeps its star, FAVORITES has nothing to show — still 01, 00, and
    // the numbers run on without a gap (the owner's "04 PAPIERKORB" with no FAVORITEN)
    const restoreOld = async () => {
      await page.locator('.sb-trash').click()
      const trash = page.getByRole('dialog', { name: 'Trash' })
      await trash.locator('.trash-item', { hasText: 'Old notes' }).getByRole('button', { name: 'Restore' }).click()
      await page.keyboard.press('Escape')
    }
    await wsEval(page, (s, id) => s.trashPage(id), old)
    await expect(favs(page).locator('.sb-sect__n')).toHaveText('01')
    await expect(favs(page).locator('.sb-sect__count')).toHaveText('00')
    await expect(favs(page).locator('.sb-favs__slot')).toBeVisible()
    const numbers = await page.locator('.sb .sb-sect__n').allInnerTexts()
    expect(numbers).toEqual(numbers.map((_, i) => String(i + 1).padStart(2, '0')))
    expect(await wsEval(page, (s, id) => s.pages[id].favorite, draft)).toBe(true)
    await restoreOld()
    await expect(favTitles(page)).toHaveText(['Draft Q3'])
    // its slot: Before · Draft · After, written by stars and a drag
    for (const t of ['Before draft', 'After draft']) {
      const row = sidebarRow(page, t)
      await row.hover()
      await row.locator('.sb-row__star').click()
    }
    await expect(favTitles(page)).toHaveText(['Draft Q3', 'Before draft', 'After draft'])
    await drag(page, favRow(page, 'Draft Q3'), favRow(page, 'After draft'), 0.25)
    await expect(favTitles(page)).toHaveText(['Before draft', 'Draft Q3', 'After draft'])
    // trashed again; a new star writes the list — the hidden favourite keeps its place in it
    await wsEval(page, (s, id) => s.trashPage(id), old)
    await expect(favTitles(page)).toHaveText(['Before draft', 'After draft'])
    const later = sidebarRow(page, 'Later star')
    await later.hover()
    await later.locator('.sb-row__star').click()
    await expect(favTitles(page)).toHaveText(['Before draft', 'After draft', 'Later star'])
    expect(await stored(page)).toContain(draft)
    await restoreOld()
    await expect(favTitles(page)).toHaveText(['Before draft', 'Draft Q3', 'After draft', 'Later star'])
  })

  test('the cap: 4 rows at 1440 × 760 (5 at 900), the list scrolls inside on whole rows; FAVORITES folds', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 760 })
    await openApp(page)
    await clearFavs(page)
    const ids: string[] = []
    for (let i = 1; i <= 7; i++) ids.push(await createPage(page, { title: `Capped ${i}` }))
    await star(page, ids)
    const list = favs(page).locator('.sb-favs__list')
    await expect(list.locator(':scope > .sb-node')).toHaveCount(7)
    const size = () => list.evaluate((el) => ({ h: el.clientHeight, sh: el.scrollHeight, snap: getComputedStyle(el).scrollSnapType }))
    // proximity is the default (serialised as "y")
    expect(await size()).toMatchObject({ h: 4 * 28, snap: 'y' })
    expect((await size()).sh).toBeGreaterThan(4 * 28)
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect.poll(async () => (await size()).h).toBe(5 * 28)
    // fold: the list goes, the head stays (count) — kept on this device
    const fold = favs(page).getByRole('button', { name: 'Collapse favorites' })
    await expect(fold).toHaveAttribute('aria-expanded', 'true')
    await fold.click()
    await expect(list).toHaveCount(0)
    await expect(favs(page).locator('.sb-sect__count')).toHaveText('07')
    await reloadApp(page)
    await expect(favs(page).getByRole('button', { name: 'Expand favorites' })).toHaveAttribute('aria-expanded', 'false')
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('one.shell.sections') ?? '{}'))).toEqual({ fav: false })
  })

  test('exactly one orange bar: on the favourite’s row when the open page is one, else on the tree’s', async ({ page }) => {
    await openApp(page)
    const bars = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.sb .sb-row[data-active]')]
          .filter((r) => getComputedStyle(r, '::before').content !== 'none')
          .map((r) => (r as HTMLElement).dataset.section),
      )
    // Welcome to One is a seeded favourite and the start page (its tree row is active too)
    await expect(page.locator('.sb section[aria-label="Pages"] .sb-row[data-active]')).toHaveCount(1)
    await expect.poll(bars).toEqual(['fav'])
    // a page that is no favourite (and also in RECENT): the tree's row
    const wiki = await pageIdByTitle(page, 'Team wiki')
    await gotoPage(page, wiki)
    await gotoPage(page, await pageIdByTitle(page, 'Projects'))
    await gotoPage(page, wiki)
    await expect.poll(bars).toEqual(['pages'])
    // folded FAVORITES: the tree's row again
    await gotoPage(page, await pageIdByTitle(page, 'Welcome to One'))
    await expect.poll(bars).toEqual(['fav'])
    await favs(page).getByRole('button', { name: 'Collapse favorites' }).click()
    await expect.poll(bars).toEqual(['pages'])
  })

  test('German: Favoriten, the slot, the star, the toast, the menu', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await clearFavs(page)
    const f = page.locator('.sb section[aria-label="Favoriten"]')
    await expect(f.locator('.sb-sect__label')).toHaveText('Favoriten')
    await expect(f.locator('.sb-favs__what')).toHaveText('Seite hierher ziehen')
    await expect(f.locator('.sb-favs__how')).toHaveText('oder ☆ an jeder Seite')
    await expect(f.getByRole('button', { name: 'Favoriten einklappen' })).toBeVisible()
    await createPage(page, { title: 'Nordlicht Plan' })
    const row = page.locator('.sb section[aria-label="Seiten"] .sb-row', { has: page.locator('.sb-row__title', { hasText: /^Nordlicht Plan$/ }) })
    await row.hover()
    const key = row.locator('.sb-row__star')
    await expect(key).toHaveAccessibleName('Favorit')
    await expect(key).toHaveAttribute('title', 'Zu Favoriten hinzufügen')
    await key.click()
    await expect(f.locator('.sb-row__title')).toHaveText(['Nordlicht Plan'])
    await row.hover()
    await key.click()
    await expect(page.getByText('„Nordlicht Plan“ ist kein Favorit mehr')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Rückgängig' })).toBeVisible()
    await expect(page.locator('.sb nav[aria-label="Orte"]')).toBeVisible()
  })
})
