/**
 * The help centre (src/app/help): the Help panel ("?", the status bar, ⌘/), its search (EN + DE, across
 * languages), articles with related links and back / forward, the Keys tab, HelpLinks (MCP settings),
 * "Ask the help" (Claude answers from the articles only — mocked, never the real API), help articles in
 * ⌘K, the phone layout, and the public pages prerendered at /help/ (src/help-site) under the /SimpleCMS/ base.
 */
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval, uiEval, mockClaude, MOD } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const panel = (page: Page) => page.getByRole('dialog', { name: /^(Help|Hilfe)$/ })
const searchBox = (page: Page) => panel(page).getByRole('searchbox')
const articleTitle = (page: Page) => panel(page).locator('.help-art__title')

/** Focus nothing editable, then press "?" — the global key opens the panel. */
async function pressHelpKey(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await page.keyboard.press('?')
  await expect(panel(page)).toBeVisible()
  await expect(searchBox(page)).toBeFocused()
}

const setKey = (page: Page) => wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))

test.describe('help panel', () => {
  test('"?" opens the help: search, article, related link, back / forward, Keys tab, Escape', async ({ page }) => {
    await openApp(page)
    await pressHelpKey(page)
    // the index: numbered chapters and articles
    await expect(panel(page)).toContainText('§ 03')
    await expect(panel(page).locator('.help-chap')).toHaveCount(11)

    await searchBox(page).fill('formula')
    const hits = panel(page).locator('.help-hit')
    await expect(hits.first()).toContainText('Formulas')
    await expect(hits.first()).toContainText('§ 03.3')
    await searchBox(page).press('Enter')
    await expect(articleTitle(page)).toHaveText('Formulas')
    await expect(panel(page).locator('.help-doc')).toContainText('prop("Price")')
    // the breadcrumbs name the chapter
    await expect(panel(page).getByRole('navigation', { name: 'Breadcrumbs' })).toContainText('§ 03 Databases')

    // a related article, then back and forward
    await panel(page).locator('.help-related').getByRole('link', { name: /Custom functions/ }).click()
    await expect(articleTitle(page)).toHaveText('Custom functions')
    await panel(page).getByRole('button', { name: 'Back' }).click()
    await expect(articleTitle(page)).toHaveText('Formulas')
    await panel(page).getByRole('button', { name: 'Forward' }).click()
    await expect(articleTitle(page)).toHaveText('Custom functions')
    // links inside an article open the next one in the panel
    await panel(page).locator('.help-doc a[data-help-link]').first().click()
    await expect(articleTitle(page)).not.toHaveText('Custom functions')

    // the shortcut sheet is a tab of the help
    await panel(page).getByRole('tab', { name: /Keys/ }).click()
    await expect(panel(page)).toContainText('New page')
    await expect(panel(page)).toContainText('Keyboard shortcuts')

    // the public page of the article is one click away
    await panel(page).getByRole('tab', { name: /Manual/ }).click()
    await expect(panel(page).getByRole('link', { name: 'Open this page on the web' })).toHaveAttribute('href', /\/SimpleCMS\/help\/[a-z-]+\/$/)

    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)
  })

  test('⌘/ opens the Keys tab (the old shortcut sheet)', async ({ page }) => {
    await openApp(page)
    await page.keyboard.press(`${MOD}+/`)
    await expect(panel(page)).toBeVisible()
    await expect(panel(page).getByRole('tab', { name: /Keys/ })).toHaveAttribute('aria-selected', 'true')
    const text = (await panel(page).innerText()).replace(/\s+/g, ' ')
    expect(text).toMatch(/New page (Ctrl ?\+? ?Alt ?\+? ?N|⌘ ?⌥ ?N)/i)
  })

  test('German: the status bar "Hilfe" opens it, "Formel" finds "Formeln" — and English finds it across languages', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await page.locator('footer.status').getByRole('button', { name: /Hilfe/ }).click()
    await expect(panel(page)).toBeVisible()
    await expect(panel(page).getByRole('tab', { name: /Handbuch/ })).toHaveAttribute('aria-selected', 'true')
    await searchBox(page).fill('Formel')
    await expect(panel(page).locator('.help-hit').first()).toContainText('Formeln')
    await panel(page).locator('.help-hit').first().click()
    await expect(articleTitle(page)).toHaveText('Formeln')
    await expect(panel(page)).toContainText('§ 03.3')
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)

    // English UI, German word
    await wsEval(page, (s) => s.updateSettings({ language: 'en' }))
    await page.locator('footer.status').getByRole('button', { name: /Help/ }).click()
    await panel(page).getByRole('tab', { name: /Manual/ }).click()
    await searchBox(page).fill('')
    await searchBox(page).fill('Formel')
    await expect(panel(page).locator('.help-hit').first()).toContainText('Formulas')
  })

  test('a HelpLink in Settings → Claude AI opens the MCP article above the dialog; Escape closes only the help', async ({ page }) => {
    await openApp(page)
    await uiEval(page, (s) => s.openModal({ type: 'settings', tab: 'ai' }))
    const section = page.getByTestId('mcp-servers')
    await section.scrollIntoViewIfNeeded()
    await section.getByRole('button', { name: 'Open help' }).click()
    await expect(panel(page)).toBeVisible()
    await expect(articleTitle(page)).toHaveText('MCP servers (Atlas & co)')
    await expect(panel(page)).toHaveAttribute('data-layer', 'modal')
    // the sheet is usable on top of the dialog: Tab moves inside it, a link works
    await panel(page).locator('.help-related').getByRole('link').first().click()
    await expect(articleTitle(page)).not.toHaveText('MCP servers (Atlas & co)')
    await articleTitle(page).focus()
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: /^Settings$/ })).toBeVisible()
  })

  test('Ask the help: only help articles go to Claude (no MCP servers, no workspace pages); citations open articles', async ({ page, context }) => {
    const bodies = await mockClaude(context, () => 'Open **Share**, switch on **Protect with password** and send the password separately — see [Share links](help:share-links).')
    await openApp(page)
    await setKey(page)
    // an enabled MCP server for every AI call: Ask the help must still not attach it
    await wsEval(page, (s) =>
      s.updateSettings({ mcpServers: [{ id: 'srvhelp01', name: 'atlas', url: 'https://mcp.example.test/mcp', token: '', enabled: true, prompt: 'Atlas.', promptSource: 'auto', tools: ['search'], checkedAt: 1, scope: 'all' }] }),
    )
    await pressHelpKey(page)
    await panel(page).getByRole('tab', { name: /Ask/ }).click()
    const field = panel(page).getByRole('textbox', { name: 'Your question' })
    await field.fill('How do I protect a share link with a password?')
    await field.press('Enter')

    const answer = panel(page).locator('.help-ask__out')
    await expect(answer).toContainText('Protect with password')
    await expect(panel(page).locator('.help-related')).toContainText('Articles sent to Claude')
    await expect(panel(page).locator('.help-related')).toContainText('Share links')

    expect(bodies.length).toBe(1)
    const body = JSON.parse(bodies[0]) as AnyState
    expect(body.mcp_servers).toBeUndefined()
    expect(JSON.stringify(body.tools ?? [])).not.toContain('mcp_toolset')
    const system = typeof body.system === 'string' ? body.system : JSON.stringify(body.system)
    expect(system).toContain('help desk of One')
    expect(system).not.toContain('Atlas.')
    const prompt = JSON.stringify(body.messages)
    expect(prompt).toContain('<article id=\\"share-links\\"')
    expect(prompt).toContain('How do I protect a share link with a password?')
    // nothing of the workspace: the seeded welcome page's text is not in the request
    expect(prompt).not.toContain('Export or share whenever you want')
    expect(bodies[0]).not.toContain('sk-ant-e2e-test-key')

    // the citation is a link into the panel
    await answer.getByRole('link', { name: 'Share links' }).click()
    await expect(articleTitle(page)).toHaveText('Share links')
    // back to the answer: it is still there
    await panel(page).getByRole('button', { name: 'Back' }).click()
    await expect(panel(page).locator('.help-ask__out')).toContainText('Protect with password')
  })

  test('Ask the help without a key: a hint and the matching articles, nothing sent', async ({ page, context }) => {
    const bodies = await mockClaude(context, () => 'never')
    await openApp(page)
    await pressHelpKey(page)
    await searchBox(page).fill('gmail labels')
    // from the search results: "Ask the help" sends the query to the Ask tab
    await panel(page).getByRole('button', { name: /Ask the help: “gmail labels”/ }).click()
    await expect(panel(page).getByRole('tab', { name: /Ask/ })).toHaveAttribute('aria-selected', 'true')
    await expect(panel(page)).toContainText('Asking needs your Claude key')
    await expect(panel(page).locator('.help-related')).toContainText('Gmail sync')
    await panel(page).locator('.help-related').getByRole('link', { name: /Gmail sync/ }).click()
    await expect(articleTitle(page)).toHaveText('Gmail sync')
    expect(bodies.length).toBe(0)
  })

  test('⌘K finds help articles in a "Help" group', async ({ page }) => {
    await openApp(page)
    await page.keyboard.press(`${MOD}+k`)
    const pal = page.getByRole('dialog', { name: 'Command palette' })
    await expect(pal.getByRole('combobox')).toBeFocused()
    await page.keyboard.type('formulas')
    const item = pal.getByRole('option', { name: /Formulas.*Help · § 03\.3/ })
    await expect(item).toBeVisible()
    await item.click()
    await expect(pal).toBeHidden()
    await expect(articleTitle(page)).toHaveText('Formulas')
  })

  test('phone: Help in the workspace menu, and the help covers the screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openApp(page)
    // no status bar on a phone: the workspace menu in the sidebar drawer has "Help"
    await page.getByRole('button', { name: 'Open sidebar' }).click()
    await page.locator('.sb-head__ws').click()
    await page.getByRole('menuitem', { name: /^Help/ }).click()
    await expect(panel(page)).toBeVisible()
    // after the slide-in
    await expect.poll(async () => (await panel(page).boundingBox())?.x ?? 99).toBeLessThanOrEqual(0.5)
    const box = await panel(page).boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThanOrEqual(389)
    expect(box!.height).toBeGreaterThanOrEqual(843)
    await searchBox(page).fill('iphone')
    await searchBox(page).press('Enter')
    await expect(articleTitle(page)).toHaveText('iPhone & home screen')
    // no horizontal overflow inside the sheet
    const overflow = await panel(page).evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
})

test.describe('public help pages (/help/)', () => {
  const PORT = Number(process.env.E2E_PORT) || 4180
  const DIST = `node_modules/.cache/e2e-dist-${PORT}`

  test('index, articles EN + DE are prerendered under the base; every internal link resolves', async ({ page, request }) => {
    const en = readFileSync(`${DIST}/help/index.html`, 'utf8')
    expect(en).toContain('<html lang="en"')
    expect(en).toContain('hreflang="de" href="https://getonecms.com/SimpleCMS/help/de/"')
    expect(en).toContain('href="/SimpleCMS/help/formulas/"')
    const article = readFileSync(`${DIST}/help/formulas/index.html`, 'utf8')
    expect(article).toContain('<h1 id="art-h" class="art-title">Formulas</h1>')
    expect(article).toContain('<kbd data-keys="Mod+Enter">Ctrl+Enter</kbd>')
    const de = readFileSync(`${DIST}/help/de/formulas/index.html`, 'utf8')
    expect(de).toContain('<html lang="de"')
    expect(de).toContain('Formeln')
    expect(de).toContain('hreflang="en" href="https://getonecms.com/SimpleCMS/help/formulas/"')

    // served by the preview server, and every link of these pages resolves (pages, CSS, script, fonts)
    const seen = new Set<string>()
    for (const path of ['help/', 'help/formulas/', 'help/de/', 'help/de/formulas/']) {
      const res = await request.get(path)
      expect(res.status(), path).toBe(200)
      const html = await res.text()
      for (const m of html.matchAll(/(?:href|src)="(\/SimpleCMS\/[^"#]*)"/g)) seen.add(m[1])
    }
    expect(seen.size).toBeGreaterThan(60)
    for (const url of seen) {
      const res = await request.get(url)
      expect(res.status(), url).toBe(200)
      if (url.endsWith('.css')) {
        const css = await res.text()
        const fonts = [...css.matchAll(/url\((\.\.\/assets\/[^)]+\.woff2)\)/g)].map((m) => m[1])
        expect(fonts.length, 'fonts in the help CSS').toBeGreaterThanOrEqual(2)
        for (const f of new Set(fonts)) expect((await request.get(new URL(f, `http://x${url}`).pathname)).status(), f).toBe(200)
      }
    }
  })

  test('the index searches, the article page renders, the landing footer links the help', async ({ page }) => {
    await page.goto('help/')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Help.')
    await page.getByRole('searchbox', { name: 'Search the manual' }).fill('formula')
    const results = page.locator('#results')
    await expect(results).toBeVisible()
    await expect(results.locator('.row').first()).toContainText('Formulas')
    await results.locator('.row').first().click()
    await expect(page).toHaveURL(/\/SimpleCMS\/help\/formulas\/$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Formulas')
    // language switch to the German twin
    await page.getByRole('link', { name: 'DE', exact: true }).click()
    await expect(page).toHaveURL(/\/SimpleCMS\/help\/de\/formulas\/$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Formeln')

    await page.goto('./?skip')
    const help = page.locator('footer').getByRole('link', { name: 'Help', exact: true })
    await expect(help).toHaveAttribute('href', '/SimpleCMS/help/')
  })
})
