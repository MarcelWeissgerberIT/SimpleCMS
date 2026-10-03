import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect, openApp, waitForApp, createPage, doc, para, heading, wsEval, gotoPage, editorOf, MOD } from './fixtures'

async function openSettingsData(page: Page) {
  await page.keyboard.press(`${MOD}+,`)
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('tab', { name: /Data$/ }).click()
  return dialog
}

async function pickFiles(page: Page, files: Array<{ name: string; mimeType: string; buffer: Buffer }>) {
  const dialog = page.getByRole('dialog')
  const chooser = page.waitForEvent('filechooser')
  await dialog.getByRole('button', { name: 'Choose files' }).click()
  await (await chooser).setFiles(files)
}

test.describe('import / export', () => {
  test('export a JSON backup → reset the workspace → import the backup → data is back', async ({ page }, testInfo) => {
    await openApp(page)
    const canary = await createPage(page, { title: 'Backup canary', content: doc(heading(2, 'Canary heading'), para('canary content 4711')) })

    // export (Settings → Data → Export workspace → Full backup)
    let dialog = await openSettingsData(page)
    await dialog.getByRole('button', { name: 'Export workspace' }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: /Whole workspace/ }).click()
    await dialog.getByRole('radio', { name: /Full backup/ }).click()
    const download = page.waitForEvent('download')
    await dialog.locator('[data-export-run]').click()
    const file = testInfo.outputPath('backup.json')
    await (await download).saveAs(file)
    const backup = JSON.parse(readFileSync(file, 'utf8'))
    expect(JSON.stringify(backup)).toContain('canary content 4711')
    await page.keyboard.press('Escape')

    // reset (Settings → Data → Reset workspace → confirm)
    dialog = await openSettingsData(page)
    await dialog.getByRole('button', { name: 'Reset workspace' }).click()
    const confirm = page.getByRole('dialog').filter({ hasText: 'Reset the entire workspace?' })
    await expect(confirm).toBeVisible()
    await Promise.all([page.waitForEvent('load'), confirm.getByRole('button', { name: 'Erase & restart' }).click()])
    await waitForApp(page)
    // a fresh demo workspace: the canary is gone
    await expect(page.locator('#main .pv-title')).toHaveValue('Welcome to One')
    expect(await wsEval(page, (s, id) => !!s.pages[id], canary)).toBe(false)
    expect(await wsEval(page, (s) => (Object.values(s.pages) as Array<{ title: string }>).some((p) => p.title === 'Backup canary'))).toBe(false)

    // import the backup (replace)
    await page.locator('.sb').getByRole('button', { name: /^Import/ }).click()
    await pickFiles(page, [{ name: 'backup.json', mimeType: 'application/json', buffer: readFileSync(file) }])
    dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: /Replace workspace/ }).click()
    await dialog.getByRole('button', { name: 'Replace workspace' }).click()
    await dialog.getByRole('button', { name: 'Yes, replace everything' }).click()
    await expect(dialog.getByText(/Workspace restored/)).toBeVisible()
    await page.keyboard.press('Escape')

    expect(await wsEval(page, (s, id) => s.pages[id]?.title ?? null, canary)).toBe('Backup canary')
    await gotoPage(page, canary)
    await expect(editorOf(page, canary)).toContainText('canary content 4711')
    await expect(editorOf(page, canary).locator('h2')).toHaveText('Canary heading')
    // and it was persisted, not only held in memory
    await page.reload()
    await waitForApp(page)
    expect(await wsEval(page, (s, id) => s.pages[id]?.title ?? null, canary)).toBe('Backup canary')
  })

  test('import a small Markdown file', async ({ page }) => {
    await openApp(page)
    await page.locator('.sb').getByRole('button', { name: /^Import/ }).click()
    const md = ['# Field notes', '', 'Some **bold** words and a [link](https://example.com).', '', '- item one', '- item two', '', '- [ ] open task', '- [x] done task', '', '```js', 'const a = 1', '```', ''].join('\n')
    await pickFiles(page, [{ name: 'field-notes.md', mimeType: 'text/markdown', buffer: Buffer.from(md) }])
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(/Import complete/)).toBeVisible()
    await dialog.getByRole('button', { name: 'View import' }).click()

    const imported = await wsEval(page, (s) => {
      const p = (Object.values(s.pages) as Array<Record<string, any>>).find((x) => !x.trashed && /Some bold words/.test(x.plain ?? ''))
      return p ? { id: p.id, title: p.title, json: JSON.stringify(p.content) } : null
    })
    expect(imported, 'a page with the Markdown body').not.toBeNull()
    expect(imported!.title).toMatch(/Field notes|field-notes/i)
    expect(imported!.json).toContain('"bold"')
    expect(imported!.json).toContain('"bulletList"')
    expect(imported!.json).toContain('"taskList"')
    expect(imported!.json).toContain('"codeBlock"')
    expect(imported!.json).toContain('https://example.com')
    await gotoPage(page, imported!.id)
    await expect(editorOf(page, imported!.id).locator('strong')).toHaveText('bold')
    await expect(editorOf(page, imported!.id).locator('pre')).toContainText('const a = 1')
  })

  test('export the current page as Markdown', async ({ page }, testInfo) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Exported page', content: doc(heading(1, 'Export me'), para('markdown body')) })
    await gotoPage(page, id)
    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('>export')
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: /Markdown folder/ }).click()
    const download = page.waitForEvent('download')
    await dialog.locator('[data-export-run]').click()
    const d = await download
    expect(d.suggestedFilename()).toMatch(/^exported-page-.*\.zip$/)
    await d.saveAs(testInfo.outputPath(d.suggestedFilename()))
  })
})
