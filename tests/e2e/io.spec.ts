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
    await expect(editorOf(page, canary).locator('h3')).toHaveText('Canary heading')
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

test.describe('Notion import', () => {
  test('a Notion "Markdown & CSV" export ZIP becomes pages, a database and working links', async ({ page }) => {
    const { zipSync, strToU8 } = await import('fflate')
    const root = 'Export-7f3a'
    const notes = 'My Notes 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d'
    const sub = 'Sub page 0f1e2d3c4b5a69788796a5b4c3d2e1f0'
    const tasks = 'Tasks 9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d'
    const enc = (s: string) => encodeURIComponent(s)
    const zip = zipSync({
      [`${root}/${notes}.md`]: strToU8(`# My Notes\n\nSee [Sub page](${enc(notes)}/${enc(sub)}.md) and the [Tasks](${enc(notes)}/${enc(tasks)}.csv) database.\n\n- [ ] follow up\n`),
      [`${root}/${notes}/${sub}.md`]: strToU8('# Sub page\n\nHello from the sub page.\n'),
      [`${root}/${notes}/${tasks}.csv`]: strToU8('﻿Name,Status,Due\nWrite spec,Done,"October 1, 2026"\nShip it,In progress,"October 9, 2026"\n'),
      [`${root}/${notes}/${tasks}/Write spec 11112222333344445555666677778888.md`]: strToU8('# Write spec\n\nStatus: Done\nDue: October 1, 2026\n\nSpec body text.\n'),
    })
    await openApp(page)
    await page.locator('.sb').getByRole('button', { name: /^Import/ }).click()
    await pickFiles(page, [{ name: 'Export-7f3a.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) }])
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(/Import complete/)).toBeVisible({ timeout: 20_000 })
    await dialog.getByRole('button', { name: 'View import' }).click()

    const r = await wsEval(page, (s) => {
      const pages = Object.values(s.pages) as Array<Record<string, any>>
      const find = (title: string, kind = 'page') => pages.find((p) => p.title === title && p.kind === kind && !p.trashed)
      const notes = find('My Notes')
      const sub = find('Sub page')
      const tasks = find('Tasks', 'database')
      const rows = tasks ? pages.filter((p) => p.databaseId === tasks.id) : []
      const props = tasks ? s.databases[tasks.id].properties.map((p: { name: string; type: string }) => `${p.name}:${p.type}`) : []
      return {
        notes: notes?.id ?? null,
        sub: sub?.id ?? null,
        subParent: sub?.parentId ?? null,
        notesJson: notes ? JSON.stringify(notes.content) : '',
        tasks: tasks?.id ?? null,
        rows: rows.map((x) => x.title).sort(),
        writeSpecPlain: rows.find((x) => x.title === 'Write spec')?.plain ?? '',
        props,
      }
    })
    expect(r.notes, 'page "My Notes"').not.toBeNull()
    expect(r.sub, 'page "Sub page"').not.toBeNull()
    expect(r.subParent).toBe(r.notes)
    expect(r.tasks, 'database "Tasks"').not.toBeNull()
    expect(r.rows).toEqual(['Ship it', 'Write spec'])
    expect(r.props).toEqual(expect.arrayContaining(['Name:title', 'Due:date']))
    expect(r.props.some((p: string) => /^Status:(select|status)$/.test(p))).toBe(true)
    expect(r.writeSpecPlain).toContain('Spec body text.')
    // the relative link to the sub page now points inside the workspace
    expect(r.notesJson).toContain(r.sub!)
    expect(r.notesJson).not.toMatch(/Sub%20page%20[0-9a-f]{32}\.md/)

    await gotoPage(page, r.notes!)
    const link = editorOf(page, r.notes!).getByText('Sub page').first()
    await link.click()
    await expect(page.locator('#main .pv-title')).toHaveValue('Sub page')
  })
})

test.describe('HTML export', () => {
  test('the whole workspace as one standalone web page', async ({ page, browser }, testInfo) => {
    await openApp(page)
    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('>export')
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: /Whole workspace/ }).click()
    await dialog.getByRole('radio', { name: /Web page/ }).click()
    const download = page.waitForEvent('download')
    await dialog.locator('[data-export-run]').click()
    const d = await download
    expect(d.suggestedFilename()).toMatch(/\.html$/)
    const file = testInfo.outputPath(d.suggestedFilename())
    await d.saveAs(file)
    const html = readFileSync(file, 'utf8')
    for (const s of ['Welcome to One', 'Team wiki', 'Website relaunch', 'Brand voice']) expect(html).toContain(s)

    // opens on its own, offline, without errors
    const ctx = await browser.newContext({ offline: true })
    const p = await ctx.newPage()
    const errs: string[] = []
    p.on('pageerror', (e) => errs.push(e.message))
    await p.goto(`file://${file}`)
    await expect(p.locator('body')).toContainText('Welcome to One')
    await expect(p.locator('h1, h2').filter({ hasText: 'Team wiki' }).first()).toBeAttached()
    expect(errs).toEqual([])
    await ctx.close()
  })
})
