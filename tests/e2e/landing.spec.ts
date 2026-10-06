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

    // still standing well before the 15 s idle mark (no input from the test); counted from the page's
    // own start, so a slow load on a busy machine does not eat into the margin
    const since = await page.evaluate(() => performance.now())
    await page.waitForTimeout(Math.max(0, 10_000 - since))
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
    for (const h of hrefs) expect(h).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/SimpleCMS\/app\/(\?import|#\/agents)?$/)
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
      const features = page.locator('#features')
      await expect(features.getByRole('heading', { level: 2 })).toHaveText(/Dreißig Funktionen\./)
      await expect(features.locator('.plac')).toHaveCount(30)
      const delegate = features.getByRole('group', { name: 'Delegieren' })
      for (const item of ['KI-Terminal', 'One-Gedächtnis', 'Eigene Agenten', 'Deine MCP-Server', 'Mails als Datenbank']) {
        await expect(delegate.getByRole('heading', { name: item, exact: true })).toBeVisible()
      }
      await expect(features.getByRole('heading', { name: 'Datenbanken, 9 Ansichten', exact: true })).toBeVisible()
      await expect(page.locator('.tb-nav').getByRole('link', { name: 'Hilfe', exact: true })).toHaveAttribute('href', '/SimpleCMS/help/de/')
      await expect(page.locator('footer').getByRole('link', { name: 'Hilfe', exact: true })).toHaveAttribute('href', '/SimpleCMS/help/de/')
    })
  })
})

test.describe('landing sections', () => {
  test('features: thirty placards in six groups of five, the rest as one line of tags', async ({ page }) => {
    await page.goto('./?skip')
    const features = page.locator('#features')
    await expect(features.getByRole('heading', { level: 2 })).toHaveText(/Thirty things it does\./)
    await expect(features.locator('.plac')).toHaveCount(30)
    for (const [group, range, items] of [
      ['Write', 'F-01 — F-05', ['Block editor', 'Transform into …', 'Meeting notes', 'Version history']],
      ['Organise', 'F-06 — F-10', ['Databases, 9 views', 'Sub-items & dependencies', 'Agenda & inbox', 'Graph & backlinks']],
      ['Calculate', 'F-11 — F-15', ['Spreadsheets in pages', 'Your own functions', 'Charts in three clicks', 'Formulas & rollups', 'One Script']],
      ['Automate', 'F-16 — F-20', ['Webhook automations', 'Forms', 'Buttons', 'Database commands', 'AI autofill']],
      ['Publish & move', 'F-21 — F-25', ['Publish as a website', 'Links with a password', 'Import from anywhere', 'Files into structure', 'Web clipper']],
      ['Delegate', 'F-26 — F-30', ['AI terminal', 'One memory', 'Custom agents', 'Your MCP servers', 'Mail as a database']],
    ] as const) {
      const g = features.getByRole('group', { name: group })
      await expect(g.locator('.plac')).toHaveCount(5)
      await expect(g.locator('.pgroup-range')).toHaveText(range)
      for (const item of items) await expect(g.getByRole('heading', { name: item, exact: true })).toBeVisible()
    }
    await expect(features.locator('.plac', { hasText: 'Databases, 9 views' })).toContainText('feed')
    await expect(features.locator('.plac', { hasText: 'Forms' })).toContainText('/form')
    await expect(features.locator('.plac', { hasText: 'AI terminal' })).toContainText('word by word')
    await expect(features.locator('.extras-list li')).toContainText(['Built-in help · 57 articles', 'Breadcrumbs', 'Turn blocks into a page', 'Mark what Claude may read', 'Presentation mode', 'Stacked panes'])
    // the art comes from the generated icons; each placard gets a picture of its own
    const icon = (key: string) => features.locator(`.plac[data-feature="${key}"] img.plac-icon`)
    for (const [key, file] of [
      ['customAgents', 'clock'], ['agent', 'focus'], ['mcpTools', 'sync'], ['mail', 'import'],
      ['transform', 'split'], ['meeting', 'microphone'], ['script', 'notepad'], ['commands', 'command'], ['buttons', 'counter'], ['files', 'book'], ['memory', 'rolodex'],
    ] as const) {
      // no scrolling: the source is set as soon as the manifest is in (the placards' reveal can keep an icon moving)
      await expect(icon(key)).toHaveAttribute('src', new RegExp(`assets/icons/${file}\\.webp$`))
    }
    const srcs = await features.locator('img.plac-icon').evaluateAll((imgs) => (imgs as HTMLImageElement[]).map((i) => i.getAttribute('src')))
    expect(new Set(srcs).size).toBe(srcs.length)
  })

  test('the top bar links the help; at 390 px it sits in the § sheet', async ({ page }) => {
    await page.goto('./?skip')
    await expect(page.locator('.tb-nav').getByRole('link', { name: 'Help', exact: true })).toHaveAttribute('href', '/SimpleCMS/help/')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('.tb-nav')).toBeHidden()
    await page.locator('[data-menu]').click()
    const sheet = page.locator('#tb-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('link', { name: 'Help' })).toHaveAttribute('href', '/SimpleCMS/help/')
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
    const heading = sec.getByRole('heading', { name: /One speaks MCP\.\s*Both ways\./ })

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

  test('plate 4.1: both directions — Claude Desktop uses One, Claude in One uses your MCP servers', async ({ page }) => {
    await page.goto('./?skip#mcp')
    const sec = page.locator('#mcp')
    const plate = sec.locator('figure.mcp-ports')
    await expect(plate.locator('figcaption')).toContainText('Plate 4.1 — Two ports')

    const portIn = plate.locator('.mcp-port.is-in')
    await expect(portIn.getByRole('heading', { name: 'Claude Desktop uses One' })).toBeVisible()
    await expect(portIn.getByRole('img', { name: 'Claude Desktop connects to One over MCP.' })).toBeVisible()
    await expect(portIn).toContainText('14 tools to search, read and write your workspace')

    const portOut = plate.locator('.mcp-port.is-out')
    await expect(portOut.getByRole('heading', { name: 'Claude in One uses your MCP servers' })).toBeVisible()
    await expect(portOut.getByRole('img', { name: /your own MCP server, through Anthropic/ })).toContainText('Your knowledge base')
    await expect(portOut).toContainText('Settings → Claude AI → MCP servers')
    await expect(portOut.getByRole('link', { name: /How to add a server/ })).toHaveAttribute('href', '/SimpleCMS/help/mcp-servers/')
    // a packet runs along each wire
    await expect(plate.locator('.mcp-wire-pkt')).toHaveCount(2)
    await expect(plate.locator('.mcp-wire-pkt').first()).toBeVisible()

    // the schematic below wires up the way in; its caption counts the tools
    const cap = sec.locator('.mcp-schematic figcaption')
    await expect(cap).toContainText('Schematic 4.2 — Port in, wired')
    await expect(cap).toContainText('Tools: 14')
    await portIn.getByRole('link', { name: /Set it up/ }).click()
    await expect(page).toHaveURL(/#mcp-setup$/)
    await expect(sec.getByRole('link', { name: /Add to Claude Desktop/ })).toBeInViewport()
  })

  test('4.3 custom agents: a nameplate of an example agent, a real run, links into the app and the help', async ({ page }) => {
    await page.goto('./?skip#mcp')
    const block = page.locator('#mcp').getByRole('group', { name: 'Agents that work on their own.' })
    await block.scrollIntoViewIfNeeded()
    await expect(block.getByRole('heading', { name: 'Agents that work on their own.' })).toBeVisible()
    await expect(block).toContainText('around the clock on your team server')

    const plate = block.getByRole('article', { name: 'Example agent: Daily mail triage' })
    await expect(plate).toBeVisible()
    for (const [k, v] of [
      ['Trigger', 'Weekdays · 07:30'],
      ['May use', 'Mails database'],
      ['MCP servers', 'Your knowledge base'],
      ['Changes', 'Proposals for review'],
      ['Budget', '$0.50 per run'],
    ] as const) {
      await expect(plate.locator('.agent-row', { has: page.getByText(k, { exact: true }) }).locator('dd')).toHaveText(v)
    }

    // a real screenshot of the app, not a mock-up of customer data
    const shot = block.locator('img.frame-img')
    await shot.scrollIntoViewIfNeeded()
    await expect(shot).toHaveAttribute('src', /shots\/agents\.webp$/)
    await expect.poll(() => shot.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1600)
    await expect(block.locator('figcaption')).toContainText('A real run: two proposals wait for review')

    await expect(block.getByRole('link', { name: 'How agents work' })).toHaveAttribute('href', '/SimpleCMS/help/custom-agents/')
    const open = block.getByRole('link', { name: /Open Agents/ })
    await expect(open).toHaveAttribute('href', '/SimpleCMS/app/#/agents')
    await open.click()
    await expect(page).toHaveURL(/\/SimpleCMS\/app\/#\/agents$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Agents' })).toBeVisible({ timeout: 30_000 })
  })

  test('390 px: the ports, the nameplate and the run fit the screen, in both languages', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('./?skip#mcp')
    for (const lang of ['en', 'de']) {
      if (lang === 'de') await page.locator('#site [data-lang="de"]').first().click()
      await expect(page.locator('html')).toHaveAttribute('lang', lang)
      for (const sel of ['.mcp-port.is-in', '.mcp-port.is-out', '.agent-plate', '.mcp-agents-fig', '.mcp-agents-ctas']) {
        const el = page.locator(`#mcp ${sel}`)
        await el.scrollIntoViewIfNeeded()
        const box = (await el.boundingBox())!
        expect(box.x, `${lang} ${sel}`).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width, `${lang} ${sel}`).toBeLessThanOrEqual(390)
      }
      // the wiring stays on one line: node → wire → node
      const wiring = await page.locator('#mcp .mcp-port.is-out .mcp-port-wiring > *').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2)))
      expect(Math.max(...wiring) - Math.min(...wiring), lang).toBeLessThanOrEqual(2)
      expect(await page.evaluate(() => document.documentElement.scrollWidth), lang).toBeLessThanOrEqual(390)
    }
  })

  test.describe('reduced motion', () => {
    test('no packets on the wires; the new blocks are there without scrolling them in', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto('./?skip#mcp')
      await expect(page.locator('#site')).not.toHaveClass(/has-reveals/)
      const pkts = page.locator('#mcp .mcp-wire-pkt')
      await expect(pkts).toHaveCount(2)
      for (const p of await pkts.all()) await expect(p).toBeHidden()
      for (const sel of ['.mcp-ports', '.agent-plate', '.mcp-agents-fig', '.mcp-agents-head']) {
        const el = page.locator(`#mcp ${sel}`)
        await expect(el).toBeVisible()
        expect(await el.evaluate((e) => getComputedStyle(e).opacity), sel).toBe('1')
      }
      await expect(page.locator('#features .plac[data-feature="customAgents"]')).toHaveCSS('opacity', '1')
    })
  })

  test.describe('German visitor', () => {
    test.use({ locale: 'de-DE' })
    test('the MCP section is in German', async ({ page }) => {
      await page.goto('./?skip#mcp')
      const sec = page.locator('#mcp')
      await expect(sec.getByRole('heading', { name: /One spricht MCP\.\s*In beide Richtungen\./ })).toBeVisible()
      await expect(sec.getByRole('radio', { name: 'Erst fragen' })).toBeChecked()
      await expect(sec.getByRole('link', { name: /Zu Claude Desktop hinzufügen/ })).toBeVisible()
      await expect(page.locator('.hero-mcp')).toContainText('Lass Claude deinen Workspace bedienen')

      const ports = sec.locator('figure.mcp-ports')
      await expect(ports.getByRole('heading', { name: 'Claude Desktop nutzt One' })).toBeVisible()
      await expect(ports.getByRole('heading', { name: 'Claude in One nutzt deine MCP-Server' })).toBeVisible()
      await expect(ports).toContainText('Deine Wissensdatenbank')
      await expect(ports.getByRole('link', { name: /Server hinzufügen/ })).toHaveAttribute('href', '/SimpleCMS/help/de/mcp-servers/')

      const block = sec.getByRole('group', { name: 'Agenten, die von selbst arbeiten.' })
      const plate = block.getByRole('article', { name: 'Beispiel-Agent: Tägliche Mail-Sortierung' })
      await expect(plate).toContainText('Werktags · 07:30')
      await expect(plate).toContainText('Vorschläge zur Prüfung')
      await expect(plate).toContainText('0,50 $ pro Lauf')
      await expect(block.getByRole('link', { name: /Agenten öffnen/ })).toHaveAttribute('href', '/SimpleCMS/app/#/agents')
      await expect(block.getByRole('link', { name: 'So arbeiten Agenten' })).toHaveAttribute('href', '/SimpleCMS/help/de/custom-agents/')
      await expect(block.locator('figcaption')).toContainText('Ein echter Lauf')
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
