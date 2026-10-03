import { test, expect, openApp, wsEval, reloadApp } from './fixtures'

test.describe('first run seeds the demo workspace', () => {
  test('EN locale: English demo workspace opens on the welcome page', async ({ page }) => {
    await openApp(page)
    // boot redirect → start page (Welcome)
    await expect(page.locator('#main .pv-title')).toHaveValue('Welcome to One')
    await expect(page).toHaveTitle(/Welcome to One — One/)
    const sidebar = page.locator('.sb')
    for (const title of ['Welcome to One', 'Projects', 'Reading list', 'Content calendar', 'Team wiki', 'Weekly sync — notes'])
      await expect(sidebar.locator('section[aria-label="Pages"] .sb-row__title', { hasText: title }).first()).toBeVisible()
    // favourites section exists with the two seeded favourites
    await expect(sidebar.locator('section[aria-label="Favorites"] .sb-row')).toHaveCount(2)

    const stats = await wsEval(page, (s) => {
      const pages = Object.values(s.pages) as Array<Record<string, any>>
      return {
        language: s.settings.language,
        dbs: Object.keys(s.databases).length,
        projectRows: pages.filter((p) => p.databaseId && s.pages[p.databaseId]?.title === 'Projects').length,
        people: s.people.length,
      }
    })
    expect(stats).toEqual({ language: 'en', dbs: 3, projectRows: 8, people: 4 })
    // the welcome page content is rendered by the editor
    await expect(page.locator('#main .ProseMirror')).toContainText('No account, no server, no subscription.')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  })

  test('seed is persisted: a reload does not seed a second time', async ({ page }) => {
    await openApp(page)
    const before = await wsEval(page, (s) => Object.keys(s.pages).sort())
    await reloadApp(page)
    const after = await wsEval(page, (s) => Object.keys(s.pages).sort())
    expect(after).toEqual(before)
  })
})

test.describe('German locale', () => {
  test.use({ locale: 'de-DE' })

  test('DE locale: German demo workspace and German UI', async ({ page }) => {
    await openApp(page)
    await expect(page.locator('#main .pv-title')).toHaveValue('Willkommen bei One')
    const sidebar = page.locator('.sb')
    await expect(sidebar.getByRole('button', { name: /Suchen/ })).toBeVisible()
    await expect(sidebar.locator('section[aria-label="Seiten"]')).toBeVisible()
    for (const title of ['Projekte', 'Leseliste', 'Content-Kalender', 'Team-Wiki'])
      await expect(sidebar.locator('.sb-row__title', { hasText: title }).first()).toBeVisible()
    expect(await wsEval(page, (s) => s.settings.language)).toBe('de')
    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
    await expect(page.locator('#main .ProseMirror')).toContainText('Kein Konto, kein Server, kein Abo.')
  })
})

test.describe('every seeded page renders', () => {
  for (const locale of ['en-US', 'de-DE']) {
    test.describe(locale, () => {
      test.use({ locale })
      test(`all pages, databases and their views render without errors (${locale})`, async ({ page }) => {
        test.setTimeout(120_000)
        await openApp(page)
        const targets = await wsEval(page, (s) =>
          (Object.values(s.pages) as Array<Record<string, any>>)
            .filter((p) => !p.databaseId && !p.trashed)
            .map((p) => ({ id: p.id, title: p.title, kind: p.kind, views: p.kind === 'database' ? s.databases[p.id].views.map((v: { id: string; type: string }) => v.type) : [] })),
        )
        expect(targets.length).toBeGreaterThanOrEqual(10)
        for (const t of targets) {
          await page.evaluate((id) => (window.location.hash = `#/p/${id}`), t.id)
          await expect(page.locator('#main .pv-title')).toHaveValue(t.title)
          await expect(page.locator('#main .fault, #main [role="alert"]:has-text("fault")')).toHaveCount(0)
          if (t.kind === 'database') {
            const tabs = page.locator('#main section.db').first().getByRole('tab')
            await expect(tabs).toHaveCount(t.views.length)
            for (let i = 0; i < t.views.length; i++) {
              await tabs.nth(i).click()
              await expect(page.locator('#main section.db').first()).toHaveAttribute('data-view', t.views[i])
            }
          } else {
            await expect(page.locator('#main .ProseMirror')).toBeVisible()
          }
        }
        // the welcome page's rich blocks actually render
        await page.evaluate((id) => (window.location.hash = `#/p/${id}`), targets.find((t) => /Welcome|Willkommen/.test(t.title))!.id)
        const ed = page.locator('#main .ProseMirror')
        await ed.locator('.mermaid-view__svg svg').first().scrollIntoViewIfNeeded()
        await expect(ed.locator('.mermaid-view__svg svg').first()).toBeVisible({ timeout: 15_000 })
        await expect(ed.locator('.katex').first()).toBeAttached()
        await expect(ed.locator('.mermaid-view__error')).toHaveCount(0)
      })
    })
  }
})
