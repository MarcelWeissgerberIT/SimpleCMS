/**
 * "one:" — a reference picker in page text and in the AI terminal: pages and entries on the same level as the open
 * page first, then those inside it, then a title search; "<codeword>:" at the start of a terminal prompt lists that
 * MCP server's tools (from its connection test). No request is sent.
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval, createPage, doc, para, MOD } from './fixtures'

/** Parent › (Review notes, Sample view review, Draft › Inner sketch) — "Draft" is open. */
async function tree(page: Page) {
  const parent = await createPage(page, { title: 'Release 4.2' })
  const sibling = await createPage(page, { title: 'Sample view review', parentId: parent, content: doc(para('Finding 1: no paging.')) })
  await createPage(page, { title: 'Review notes', parentId: parent })
  const here = await createPage(page, { title: 'Draft', parentId: parent, content: doc(para('')) })
  const inner = await createPage(page, { title: 'Inner sketch', parentId: here })
  await page.evaluate((id) => (window.location.hash = `#/p/${id}`), here)
  return { parent, sibling, here, inner }
}

test('page text: "one:" offers the same level and the page\'s own sub-pages, a title narrows it, Enter inserts a mention', async ({ page }) => {
  await openApp(page)
  const { sibling, here, inner } = await tree(page)
  const editor = page.locator('#main .ProseMirror').first()
  await editor.click()
  await page.keyboard.type('See one:')
  const menu = page.getByTestId('ref-menu')
  await expect(menu).toBeVisible()
  await expect(menu).toContainText('Same level')
  await expect(menu).toContainText('Sample view review')
  await expect(menu).toContainText('Review notes')
  await expect(menu).toContainText('Inside this page')
  await expect(menu).toContainText('Inner sketch')
  await page.keyboard.type('sample')
  await expect(menu.locator('.menu-item')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect(menu).toBeHidden()
  // the editor writes to the store after a short pause
  await expect.poll(() => wsEval(page, (s, id) => JSON.stringify(s.pages[id].content), here)).toContain(`"id":"${sibling}"`)
  expect(await wsEval(page, (s, id) => JSON.stringify(s.pages[id].content), here)).not.toContain('one:')
  expect(inner).toBeTruthy()
  // "someone:" is no trigger
  await page.keyboard.type('someone: hi')
  await expect(menu).toBeHidden()
})

test('AI terminal: "one:" lists the same level first; "<codeword>:" lists that server\'s tools, Tab completes', async ({ page }) => {
  await openApp(page)
  await wsEval(page, (s) => s.updateSettings({ mcpServers: [{ id: 'm1', name: 'kb', url: 'https://kb.example.com/mcp', token: '', enabled: true, prompt: 'Search the knowledge base.', codeword: 'kb', tools: ['search_records', 'get_record', 'create_record'] }] }))
  await tree(page)
  if (!(await page.locator('.term').isVisible())) await page.keyboard.press(`${MOD}+j`)
  const input = page.locator('.term-prompt__input')
  await expect(input).toBeVisible()
  await input.fill('analyse one:')
  const list = page.locator('.term-complete')
  await expect(list).toBeVisible()
  await expect(list.locator('.term-complete__item').first()).toContainText('same level')
  await expect(list).toContainText('Sample view review')
  await input.pressSequentially('sam')
  await input.press('Tab')
  await expect(input).toHaveValue('analyse @Sample view review ')
  // the tools of the server addressed by its codeword
  await input.fill('kb:')
  await expect(list).toContainText('search_records')
  await expect(list).toContainText('tool of kb')
  await input.pressSequentially('get')
  await expect(list.locator('.term-complete__item')).toHaveCount(1)
  await input.press('Tab')
  await expect(input).toHaveValue('kb: get_record ')
})
