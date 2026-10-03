import { test, expect, openApp, waitForApp, createPage, doc, para, gotoPage, editorOf, pageIdByTitle } from './fixtures'
import type { Page } from '@playwright/test'

/** Wait until the service worker controls the page. */
async function controlled(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((r) => navigator.serviceWorker.addEventListener('controllerchange', () => r(), { once: true }))
  })
}

test.describe('offline', () => {
  // the one test that runs with the service worker enabled
  test.use({ serviceWorkers: 'allow' })

  test('after the first visit the app reloads and works without a network', async ({ page, context }) => {
    await openApp(page)
    // wait for the worker to control the page and to have cached what the page loaded
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready
      if (!navigator.serviceWorker.controller)
        await new Promise<void>((r) => navigator.serviceWorker.addEventListener('controllerchange', () => r(), { once: true }))
    })
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const names = await caches.keys()
            let n = 0
            let html = false
            for (const name of names) {
              const keys = await (await caches.open(name)).keys()
              n += keys.length
              if (keys.some((k) => new URL(k.url).pathname.endsWith('/SimpleCMS/app/'))) html = true
            }
            return html && n > 3
          }),
        { timeout: 20_000 },
      )
      .toBe(true)
    const id = await createPage(page, { title: 'Offline page', content: doc(para('written before going offline')) })

    await context.setOffline(true)
    await page.reload()
    await waitForApp(page)
    await gotoPage(page, id)
    await expect(editorOf(page, id)).toContainText('written before going offline')
    // still editable offline
    await editorOf(page, id).locator('p').first().click()
    await page.keyboard.press('End')
    await page.keyboard.type(' and after')
    await expect(editorOf(page, id)).toContainText('written before going offline and after')
    await context.setOffline(false)
  })

  test('views never opened online load offline too (the build precaches every lazy chunk)', async ({ page, context }) => {
    // start on the graph: no database view and no mermaid diagram gets loaded while online
    await openApp(page, '/graph')
    await controlled(page)
    // the install step precached the whole app: one cache for this build, well over a hundred files
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const names = (await caches.keys()).filter((n) => n.startsWith('one-'))
            if (names.length !== 1 || names[0] === 'one-dev') return -1
            return (await (await caches.open(names[0])).keys()).length
          }),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(100)
    const lazy = await page.evaluate(() => performance.getEntriesByType('resource').some((e) => /\/(CalendarView|TimelineView|ChartView|mermaid\.core)-/.test(e.name)))
    expect(lazy, 'lazy views were not loaded before going offline').toBe(false)

    await context.setOffline(true)
    const projects = await pageIdByTitle(page, 'Projects')
    await gotoPage(page, projects)
    const db = page.locator('#main section.db').first()
    for (const [tab, view] of [['Calendar', 'calendar'], ['Timeline', 'timeline'], ['Chart', 'chart']]) {
      await db.getByRole('tab').filter({ hasText: tab }).click()
      await expect(db).toHaveAttribute('data-view', view)
    }
    await expect(db.locator('.dbch-bar')).toHaveCount(4)
    // the welcome page's mermaid diagram renders from the precache
    await gotoPage(page, await pageIdByTitle(page, 'Welcome to One'))
    await expect(page.locator('#main .mermaid-view__svg svg').first()).toBeVisible({ timeout: 20_000 })
    await context.setOffline(false)
  })
})
