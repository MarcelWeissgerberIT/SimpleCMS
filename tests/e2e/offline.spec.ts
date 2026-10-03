import { test, expect, openApp, waitForApp, createPage, doc, para, gotoPage, editorOf } from './fixtures'

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
})
