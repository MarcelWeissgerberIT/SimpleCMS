import { test, expect } from './fixtures'

const seen = (page: import('@playwright/test').Page) => page.evaluate(() => localStorage.getItem('one.introSeen'))

test.describe('landing page', () => {
  test('first visit shows the 1997 spreadsheet; 15 s idle → hammer smash → site, only once', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('./')
    const sheet = page.locator('.x97')
    await expect(sheet).toBeVisible()
    await expect(page.locator('html')).toHaveClass(/intro-active/)
    expect(await seen(page)).toBeNull()

    // still standing well before the 15 s idle mark (no input from the test)
    await page.waitForTimeout(10_000)
    await expect(sheet).toBeVisible()
    expect(await seen(page)).toBeNull()

    // smash starts at 15 s; the overlay is removed once the pieces have fallen
    await expect.poll(() => seen(page), { timeout: 20_000 }).toBe('1')
    await expect(page.locator('#intro')).toHaveCount(0, { timeout: 45_000 })
    await expect(page.locator('html')).not.toHaveClass(/intro-active/)
    await expect(page.locator('#site').getByRole('link', { name: /Open the workspace/ }).first()).toBeVisible()

    // remembered: the next visit goes straight to the site
    await page.reload()
    await expect(page.locator('#site').getByRole('link', { name: /Open the workspace/ }).first()).toBeVisible()
    await expect(page.locator('.x97')).toHaveCount(0)
  })

  test('?skip shows the site; "Open the workspace" goes to /SimpleCMS/app/', async ({ page }) => {
    await page.goto('./?skip')
    await expect(page.locator('.x97')).toHaveCount(0)
    await expect(page.locator('#intro')).toHaveCount(0)
    const cta = page.locator('#site').getByRole('link', { name: /Open the workspace/ }).first()
    await expect(cta).toBeVisible()
    expect(await cta.getAttribute('href')).toBe('/SimpleCMS/app/')
    // every workspace link on the page points at the deployed app path
    const hrefs = await page.locator('#site a[href*="app/"]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href))
    expect(hrefs.length).toBeGreaterThan(1)
    for (const h of hrefs) expect(h).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/SimpleCMS\/app\/(\?import)?$/)
    // no broken images on the site
    const broken = await page.locator('#site img').evaluateAll((imgs) =>
      (imgs as HTMLImageElement[]).filter((i) => i.complete && i.naturalWidth === 0 && i.loading !== 'lazy').map((i) => i.currentSrc || i.src),
    )
    expect(broken).toEqual([])

    await cta.click()
    await expect(page).toHaveURL(/\/SimpleCMS\/app\/(#.*)?$/)
    // (no ?e2e here, so no test hook — wait for the shell itself)
    await expect(page.locator('#boot')).toHaveCount(0, { timeout: 30_000 })
    await expect(page.locator('.app')).toBeVisible()
    await expect(page.locator('#main .pv-title')).toHaveValue('Welcome to One')
  })

  test('"Replay the intro" brings the spreadsheet back via ?intro', async ({ page }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('e2e-init')) {
        sessionStorage.setItem('e2e-init', '1')
        localStorage.setItem('one.introSeen', '1')
      }
    })
    await page.goto('./')
    await expect(page.locator('.x97')).toHaveCount(0)
    const replay = page.locator('#site [data-replay]')
    await replay.scrollIntoViewIfNeeded()
    await expect(replay).toContainText('Replay the intro')
    await replay.click()
    await expect(page).toHaveURL(/\/SimpleCMS\/\?intro$/)
    await expect(page.locator('.x97')).toBeVisible()
    expect(await seen(page)).toBeNull()
  })

  test.describe('German visitor', () => {
    test.use({ locale: 'de-DE' })
    test('the site is in German', async ({ page }) => {
      await page.goto('./?skip')
      await expect(page.locator('html')).toHaveAttribute('lang', 'de')
      await expect(page.locator('#site').getByRole('link', { name: /Workspace öffnen/ }).first()).toBeVisible()
      await expect(page.getByRole('tablist', { name: /Datenbanken/ }).getByRole('tab', { name: /Zeitleiste/ })).toBeAttached()
      await expect(page.locator('#own-it .plate-cloud')).toContainText('In Entwicklung')
    })
  })
})

test.describe('landing sections', () => {
  test('features: twenty placards in five groups, the rest as one line of tags', async ({ page }) => {
    await page.goto('./?skip')
    const features = page.locator('#features')
    await expect(features.locator('.plac')).toHaveCount(20)
    for (const [group, items] of [
      ['Write', ['Block editor', 'Version history']],
      ['Organise', ['Databases, 8 views', 'Sub-items & dependencies', 'Agenda & inbox']],
      ['Calculate', ['Spreadsheets in pages', 'Your own functions', 'Charts in three clicks', 'Formulas & rollups']],
      ['Automate', ['Webhook automations', 'Forms', 'Buttons', 'AI autofill']],
      ['Publish & move', ['Publish as a website', 'Links with a password', 'Import from anywhere', 'Web clipper']],
    ] as const) {
      const g = features.getByRole('group', { name: group })
      await expect(g.locator('.plac')).toHaveCount(4)
      for (const item of items) await expect(g.getByRole('heading', { name: item, exact: true })).toBeVisible()
    }
    await expect(features.locator('.extras-list li')).toContainText(['Presentation mode', 'Stacked panes'])
  })

  test('up close: mode keys switch the screenshot (click and arrows), the lightbox shows it full size', async ({ page }) => {
    await page.goto('./?skip')
    const tabs = page.getByRole('tablist', { name: /Databases/ })
    await tabs.scrollIntoViewIfNeeded()
    const fig = page.locator('[data-frame-tabs]', { has: tabs })
    const shown = fig.locator('img.frame-img.is-on')
    await expect(tabs.getByRole('tab', { name: /Board/ })).toHaveAttribute('aria-selected', 'true')
    await expect(shown).toHaveAttribute('src', /shots\/database\.webp$/)

    await tabs.getByRole('tab', { name: /Timeline/ }).click()
    await expect(tabs.getByRole('tab', { name: /Timeline/ })).toHaveAttribute('aria-selected', 'true')
    await expect(tabs.getByRole('tab', { name: /Board/ })).toHaveAttribute('aria-selected', 'false')
    await expect(shown).toHaveAttribute('src', /shots\/timeline\.webp$/)
    await expect(fig.locator('figcaption')).toContainText('Timeline with dependency arrows')
    await expect(fig.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', /-t1$/)

    await page.keyboard.press('ArrowRight')
    const agenda = tabs.getByRole('tab', { name: /Agenda/ })
    await expect(agenda).toBeFocused()
    await expect(agenda).toHaveAttribute('aria-selected', 'true')
    await expect(shown).toHaveAttribute('src', /shots\/agenda\.webp$/)
    await expect.poll(() => shown.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1600)

    const enlarge = fig.getByRole('button', { name: 'Enlarge figure' })
    await enlarge.click()
    const box = page.locator('dialog[data-lightbox]')
    await expect(box).toBeVisible()
    await expect(box.locator('img')).toHaveAttribute('src', /shots\/agenda\.webp$/)
    await expect(box).toContainText('Agenda, month view')
    await page.keyboard.press('Escape')
    await expect(box).toBeHidden()
    await expect(enlarge).toBeFocused()
  })

  test('cloud: local is available, the team cloud is in development with a self-hosting guide and no prices', async ({ page }) => {
    await page.goto('./?skip')
    await expect(page.locator('.tb-nav').getByRole('link', { name: 'Cloud' })).toHaveAttribute('href', '#own-it')
    const own = page.locator('#own-it')
    await expect(own.getByRole('heading', { name: 'One Local' })).toBeVisible()
    await expect(own.getByRole('heading', { name: 'One Team Cloud' })).toBeVisible()
    await expect(own.locator('.plate-cloud')).toContainText('In development')
    await expect(own.getByRole('link', { name: /Self-hosting guide/ })).toHaveAttribute('href', /^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/main\/docs\/SELF_HOSTING\.md$/)
    // pricing for a hosted cloud is not decided: the section names no amounts
    expect(await own.innerText()).not.toMatch(/[$€]\s?\d|\d\s?(€|\$|EUR|USD)/)
  })

  test('compare: nineteen rows, and our gaps stay marked', async ({ page }) => {
    await page.goto('./?skip')
    const rows = page.locator('#compare tbody tr')
    await expect(rows).toHaveCount(19)
    await expect(rows.filter({ hasText: 'AI agents over MCP' }).locator('td').nth(1)).toContainText('/mcp on a team server')
    const multiplayer = rows.filter({ hasText: 'Real-time multiplayer' })
    await expect(multiplayer.locator('td').nth(1)).toContainText('Coming with the team cloud')
    await expect(multiplayer.locator('td').nth(1).getByRole('img')).toHaveAttribute('aria-label', 'No')
    await expect(rows.filter({ hasText: 'Publish as a website' }).locator('td').nth(1)).toContainText('llms.txt')
  })
})

test.describe('landing: agents · MCP', () => {
  test('the MCP section: nav link and hero badge lead there, tool table, modes, download and copy keys', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('./?skip')
    const sec = page.locator('#mcp')
    const heading = sec.getByRole('heading', { name: 'One speaks MCP.' })

    // the top bar's MCP link scrolls to the section
    const nav = page.locator('.tb-nav').getByRole('link', { name: 'MCP', exact: true })
    await expect(nav).toHaveAttribute('href', '#mcp')
    await expect(heading).not.toBeInViewport()
    await nav.click()
    await expect(page).toHaveURL(/#mcp$/)
    await expect(heading).toBeInViewport()
    await expect(page.locator('.hero-mcp')).toHaveAttribute('href', '#mcp')
    await expect(page.locator('.hero-mcp')).toContainText('Let Claude run your workspace')

    // the drawing names both ways in; the tool table lists every tool, write tools marked
    await expect(sec.getByRole('img', { name: /one-mcp bridge over stdio/ }).first()).toBeAttached()
    const tools = sec.locator('.mcp-tool')
    await expect(tools).toHaveCount(14)
    await expect(sec.locator('.mcp-tool.is-w')).toHaveCount(7)
    await expect(tools.first()).toContainText('one_overview')
    await expect(sec.locator('.mcp-tool.is-w').last()).toContainText('one_trash_page')

    // Agent changes: keyboard-operable keys; read only re-labels the gate and darkens the write tools
    const ask = sec.getByRole('radio', { name: 'Ask first' })
    await expect(ask).toBeChecked()
    await expect(sec).toHaveAttribute('data-mode', 'ask')
    await ask.focus()
    await page.keyboard.press('ArrowRight')
    await expect(sec.getByRole('radio', { name: 'Apply directly' })).toBeChecked()
    await expect(sec.locator('[data-mcp-note]')).toContainText('Changes land at once')
    await sec.getByRole('radio', { name: 'Read only' }).check()
    await expect(sec).toHaveAttribute('data-mode', 'read')
    await expect(sec.locator('[data-mcp-note]')).toContainText('Every write is refused')
    await expect(sec.locator('.pv-wide .mcp-gate-read')).toBeVisible()
    await expect(sec.locator('.pv-wide .mcp-gate-ask')).toBeHidden()
    await expect.poll(async () => Number(await sec.locator('.mcp-tool.is-w').first().evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(0.6)

    // first the one-click Claude Desktop extension (tests/e2e/mcpb.spec.ts); the bridge file and the
    // snippets for other clients are folded below it — files of this site, under its base path
    await expect(sec.getByRole('link', { name: /Add to Claude Desktop/ })).toHaveAttribute('href', '/SimpleCMS/mcp/one.mcpb')
    await sec.getByText('Other clients · manual setup').click()
    await expect(sec.getByRole('link', { name: /Download one-mcp\.mjs/ })).toHaveAttribute('href', '/SimpleCMS/mcp/one-mcp.mjs')

    // copy keys: keyboard, real clipboard, a confirmation that screen readers hear too
    const copy = sec.getByRole('button', { name: /Copy: Claude Desktop/ })
    await copy.focus()
    await page.keyboard.press('Enter')
    await expect(copy).toHaveText('Copied')
    await expect(sec.locator('[data-mcp-live]')).toHaveText(/Claude Desktop .* copied/)
    const json = await page.evaluate(() => navigator.clipboard.readText())
    expect(JSON.parse(json)).toEqual({ mcpServers: { one: { command: 'node', args: ['/ABSOLUTE/PATH/one-mcp.mjs'] } } })
    await expect(copy).toHaveText('Copy', { timeout: 5000 })

    await sec.getByRole('button', { name: /Copy: Claude Code/ }).click()
    const shell = await page.evaluate(() => navigator.clipboard.readText())
    expect(shell.split('\n')).toEqual([
      expect.stringMatching(/^curl -fsSL http:\/\/127\.0\.0\.1:\d+\/SimpleCMS\/mcp\/one-mcp\.mjs -o ~\/one-mcp\.mjs$/),
      'claude mcp add one -- node ~/one-mcp.mjs',
    ])
    await sec.getByRole('button', { name: /Copy: Team server/ }).click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('claude mcp add --transport http one https://team.example.com/mcp --header "Authorization: Bearer one_…"')
  })

  test.describe('German visitor', () => {
    test.use({ locale: 'de-DE' })
    test('the MCP section is in German', async ({ page }) => {
      await page.goto('./?skip#mcp')
      const sec = page.locator('#mcp')
      await expect(sec.getByRole('heading', { name: 'One spricht MCP.' })).toBeVisible()
      await expect(sec.getByRole('radio', { name: 'Erst fragen' })).toBeChecked()
      await expect(sec.getByRole('link', { name: /Zu Claude Desktop hinzufügen/ })).toBeVisible()
      await expect(page.locator('.hero-mcp')).toContainText('Lass Claude deinen Workspace bedienen')
    })
  })
})

test.describe('landing → app handoff', () => {
  test('choosing DE on the site carries over into a fresh workspace', async ({ page }) => {
    await page.goto('./?skip')
    await page.locator('#site [data-lang="de"]').first().click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
    await expect(page.locator('#site').getByRole('link', { name: /Workspace öffnen/ }).first()).toBeVisible()
    await page.locator('#site').getByRole('link', { name: /Workspace öffnen/ }).first().click()
    await expect(page.locator('.app')).toBeVisible({ timeout: 30_000 })
    // first run seeds the German demo workspace
    await expect(page.locator('#main .pv-title')).toHaveValue('Willkommen bei One')
    await expect(page.locator('.sb').getByRole('button', { name: /^Suchen/ })).toBeVisible()
  })
})

test.describe('share link robustness', () => {
  test('a cut-off share link shows an explanation instead of a blank page', async ({ page }) => {
    await page.goto('app/?e2e')
    await page.waitForFunction(() => !!(window as unknown as { __one?: unknown }).__one)
    await page.locator('.tb').getByRole('button', { name: 'Share', exact: true }).click()
    const url = page.getByRole('dialog').getByRole('textbox', { name: 'Share link' })
    await expect(url).toHaveValue(/#\/s\//)
    const link = await url.inputValue()
    const cut = link.slice(0, link.indexOf('#/s/') + 4 + Math.floor((link.length - link.indexOf('#/s/') - 4) / 2))
    await page.goto('about:blank')
    await page.goto(cut)
    await expect(page.getByRole('alert')).toContainText('This link can’t be opened')
    await page.getByRole('button', { name: 'Go to my workspace' }).click()
    await expect(page.locator('#main .pv-title')).toHaveValue('Welcome to One')
  })
})
