import type { Page as ModelPage } from '../../src/app/store/types'
import { pageTexts, translationSignature } from '../../src/app/store/localization'
import { test, expect, openApp, createPage, gotoPage, editorOf, wsEval } from './fixtures'

const setup = { type: 'button', attrs: { label: 'Worker-Download', variant: 'signal', actions: [{ id: 'setup', type: 'worker_setup', token: 'MUST_NOT_BE_USED' }] } }
const code = { type: 'codeBlock', attrs: { language: 'bash' }, content: [{ type: 'text', text: 'node one-worker-cloud.mjs' }] }

test('setup opens personal worker settings without creating a token; code copies without execution', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  let registrations = 0
  await page.route('**/api/workspaces/**/coding/workers', async route => {
    if (route.request().method() === 'POST') registrations++
    await route.fulfill({ json: [] })
  })
  await openApp(page)
  const id = await createPage(page, { title: 'Worker setup', content: { type: 'doc', content: [setup, code] } })
  await gotoPage(page, id)
  await editorOf(page, id).getByRole('button', { name: 'Copy', exact: true }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('node one-worker-cloud.mjs')
  await editorOf(page, id).getByRole('button', { name: 'Worker-Download', exact: true }).click()
  await expect(page.getByTestId('coding-settings')).toBeVisible()
  expect(registrations).toBe(0)
})

test('translated live pages allow setup and navigation, but not write actions or guests', async ({ page }) => {
  await openApp(page)
  const id = await createPage(page, { title: 'Einrichtung', content: { type: 'doc', content: [setup, code, { type: 'button', attrs: { label: 'Do not write', variant: 'ink', actions: [{ id: 'write', type: 'insert_blocks', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'NEVER_INSERT' }] }] }] } }] } })
  await gotoPage(page, id)
  const p = await wsEval(page, (s, id) => s.pages[id], id) as ModelPage
  const texts = pageTexts(p).map(t => [t, t === 'Worker-Download' ? 'Open worker download' : t])
  await wsEval(page, (s, a) => s.updatePage(a.id, { localization: a.localization }), { id, localization: { source: 'de', variants: { en: { at: Date.now(), signature: translationSignature(p), texts } } } })
  const ed = editorOf(page)
  await expect(ed).toHaveAttribute('contenteditable', 'false')
  const before = await wsEval(page, (s, id) => s.pages[id].content, id)
  await expect(ed.getByRole('button', { name: 'Open worker download', exact: true })).toBeEnabled()
  await expect(ed.getByRole('button', { name: 'Do not write', exact: true })).toBeDisabled()
  await ed.getByRole('button', { name: 'Open worker download', exact: true }).click()
  await expect(page.getByTestId('coding-settings')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('coding-settings')).not.toBeVisible()
  await page.evaluate(() => (window as any).__one.cloud.useCloud.setState({ readOnly: true, role: 'viewer' }))
  await expect(ed.getByRole('button', { name: 'Open worker download', exact: true })).toBeDisabled()
  expect(await wsEval(page, (s, id) => s.pages[id].content, id)).toEqual(before)
})
