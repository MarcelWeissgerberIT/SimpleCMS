/**
 * Links Claude copied from an MCP server's results are often relative ("/r/11900"). Inside One they
 * must open at that server's address — never at One's own site (where they used to land on the
 * landing page). Settings → Claude AI → MCP servers → "Link address" overrides the server's origin.
 */
import { test, expect, openApp, createPage, gotoPage, editorOf, wsEval, doc, MOD } from './fixtures'
import type { Page } from '@playwright/test'

const linkPara = (text: string, href: string) => ({ type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }] })

async function setServers(page: Page, servers: object[]): Promise<void> {
  await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), servers)
}

const atlas = (extra: object = {}) => ({ id: 'srvatlas01', name: 'atlas', url: 'https://mcp.atlas.example.test/mcp', token: '', enabled: true, prompt: 'Use atlas_search.', checkedAt: 1, ...extra })

async function hoverCard(page: Page, id: string, text: string) {
  await editorOf(page, id).getByText(text).hover()
  const card = page.locator('.link-hover')
  await expect(card).toBeVisible()
  return card
}

test.describe('foreign links (MCP record links)', () => {
  test('a relative record link opens at the MCP server, not at One; the hover card shows where', async ({ page, context }) => {
    await openApp(page)
    await setServers(page, [atlas()])
    const id = await createPage(page, { title: 'Atlas topic', content: doc(linkPara('#11900', '/r/11900')) })
    await gotoPage(page, id)
    const card = await hoverCard(page, id, '#11900')
    const target = card.locator('.link-hover__target')
    await expect(target).toHaveAttribute('href', 'https://mcp.atlas.example.test/r/11900')
    await expect(target).toContainText('atlas.example.test')
    // the click opens a new tab at the server — never One's own /r/11900
    await context.route('https://mcp.atlas.example.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Atlas</title>' }))
    const [popup] = await Promise.all([page.waitForEvent('popup'), target.click()])
    expect(popup.url()).toBe('https://mcp.atlas.example.test/r/11900')
    await popup.close()
    // Mod+click on the link in the text does the same
    const [again] = await Promise.all([page.waitForEvent('popup'), editorOf(page, id).getByText('#11900').click({ modifiers: [MOD === 'Meta' ? 'Meta' : 'Control'] })])
    expect(again.url()).toBe('https://mcp.atlas.example.test/r/11900')
    await again.close()
    // a plain click while editing only places the caret: no tab
    let opened = false
    page.once('popup', () => (opened = true))
    await editorOf(page, id).getByText('#11900').click()
    await page.waitForTimeout(400)
    expect(opened).toBe(false)
    expect(page.url()).toContain('/app/')
  })

  test('the link address in Settings wins; it is checked; Claude is told to write absolute links', async ({ page, context }) => {
    await openApp(page)
    await setServers(page, [atlas()])
    await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: object) => void } } } }).__one.ui.getState().openModal({ type: 'settings', tab: 'ai' }))
    const field = page.getByTestId('mcp-link-base').first()
    if (!(await field.isVisible())) await page.getByRole('button', { name: /Details/ }).first().click()
    await field.fill('ftp://nope')
    await expect(page.getByText('An address starting with https:// (or http://)')).toBeVisible()
    await field.fill('https://atlas.example.test/app')
    await field.locator('xpath=ancestor::form[1]').getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => wsEval(page, (s) => s.settings.mcpServers?.[0]?.linkBase)).toBe('https://atlas.example.test/app/')
    await page.keyboard.press('Escape')
    const id = await createPage(page, { title: 'Atlas topic', content: doc(linkPara('Buttons improvements', 'r/12446')) })
    await gotoPage(page, id)
    const card = await hoverCard(page, id, 'Buttons improvements')
    await expect(card.locator('.link-hover__target')).toHaveAttribute('href', 'https://atlas.example.test/app/r/12446')
    await context.route('https://atlas.example.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Atlas</title>' }))
    const [popup] = await Promise.all([page.waitForEvent('popup'), card.locator('.link-hover__target').click()])
    expect(popup.url()).toBe('https://atlas.example.test/app/r/12446')
  })

  test('without a known address: the link stays in One and says what to set (EN + DE); One links are untouched', async ({ page }) => {
    await openApp(page)
    await setServers(page, [])
    const other = await createPage(page, { title: 'Other page' })
    const id = await createPage(page, { title: 'Loose links', content: doc(linkPara('#11900', '/r/11900'), linkPara('Other page', `#/p/${other}`)) })
    await gotoPage(page, id)
    const card = await hoverCard(page, id, '#11900')
    let opened = false
    page.once('popup', () => (opened = true))
    await card.locator('.link-hover__target').click()
    await expect(page.getByText(/is a link of another site/)).toBeVisible()
    expect(opened).toBe(false)
    expect(page.url()).toContain('/app/')
    // a One page link still navigates inside One
    await page.keyboard.press('Escape')
    const own = await hoverCard(page, id, 'Other page')
    await own.locator('.link-hover__target').click()
    await expect(page).toHaveURL(new RegExp(`#/p/${other}`))
    // German
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await gotoPage(page, id)
    const de = await hoverCard(page, id, '#11900')
    await de.locator('.link-hover__target').click()
    await expect(page.getByText(/ist ein Link einer anderen Seite/)).toBeVisible()
  })
})
