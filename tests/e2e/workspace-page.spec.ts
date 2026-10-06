/**
 * Workspace settings (#/workspace, shell/workspace): the entry points (sidebar workspace menu, ⌘K, the link in
 * Settings), the overview's numbers, the people tools (add, rename, remove someone unused, a used person needs a
 * merge, merge rewrites person values and @mentions with one Undo), the automation overview, the data section's
 * backup, phone width in German, and the dark theme.
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval, createPage, doc, para, MOD } from './fixtures'

const wsPage = (page: Page) => page.getByTestId('workspace-page')

async function openSection(page: Page, section: string) {
  await page.evaluate((s) => (window.location.hash = s ? `#/workspace/${s}` : '#/workspace'), section)
  await expect(wsPage(page)).toHaveAttribute('data-section', section || 'overview')
}

const personId = (page: Page, name: string) => wsEval(page, (s, name) => (s.people as Array<{ id: string; name: string }>).find((p) => p.name === name)?.id ?? null, name)

test.describe('workspace settings', () => {
  test('opens from the workspace menu, ⌘K and Settings; the overview counts the workspace', async ({ page }) => {
    await openApp(page)
    // the sidebar's workspace menu
    await page.locator('aside.sb .sb-head__ws').click()
    await page.getByRole('menuitem', { name: 'Workspace settings' }).click()
    await expect(wsPage(page)).toBeVisible()
    await expect(page).toHaveURL(/#\/workspace$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('One')
    await expect(page.getByTestId('ws-spec')).toContainText('LOCAL')

    // the numbers are the workspace's
    const counts = await wsEval(page, (s) => {
      const pages = Object.values(s.pages) as Array<{ kind: string; databaseId?: string | null; trashed?: boolean; hidden?: boolean; template?: unknown }>
      const live = pages.filter((p) => !p.trashed && !p.hidden && !p.template)
      return { pages: live.filter((p) => !p.databaseId && p.kind !== 'database').length, databases: live.filter((p) => !p.databaseId && p.kind === 'database').length, entries: live.filter((p) => !!p.databaseId).length, people: (s.people as unknown[]).length }
    })
    const grid = page.getByTestId('ws-counts')
    await expect(grid.locator('div').filter({ hasText: /^Pages/ }).locator('dd')).toHaveText(String(counts.pages))
    await expect(grid.locator('div').filter({ hasText: /^Databases/ }).locator('dd')).toHaveText(String(counts.databases))
    await expect(grid.locator('div').filter({ hasText: /^Entries/ }).locator('dd')).toHaveText(String(counts.entries))
    await expect(grid.locator('div').filter({ hasText: /^People/ }).locator('dd')).toHaveText(String(counts.people))
    await expect(page.getByTestId('ws-spec')).toContainText(`${counts.pages} PAGES`)
    await expect(page.getByTestId('ws-spec')).toContainText(`${counts.databases} DATABASES`)

    // the name lives here now (one source of truth: settings.workspaceName)
    const name = page.getByLabel('Workspace name')
    await name.fill('North Star')
    await name.press('Tab')
    expect(await wsEval(page, (s) => s.settings.workspaceName)).toBe('North Star')
    await expect(page.locator('aside.sb .sb-head__name')).toHaveText('North Star')

    // ⌘K
    await page.evaluate(() => (window.location.hash = '#/'))
    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('workspace settings')
    await page.getByRole('option', { name: /Workspace settings/ }).first().click()
    await expect(wsPage(page)).toBeVisible()
    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('people')
    await page.getByRole('option', { name: /^People/ }).first().click()
    await expect(wsPage(page)).toHaveAttribute('data-section', 'people')

    // Settings: this device — with a clear way to the workspace's own settings; no workspace name, no Team tab
    await page.evaluate(() => (window.location.hash = '#/'))
    await page.keyboard.press(`${MOD}+,`)
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await expect(settings.getByText('Settings · this device')).toBeVisible()
    await expect(settings.getByLabel('Workspace name')).toHaveCount(0)
    await expect(settings.getByRole('tab', { name: /Team/ })).toHaveCount(0)
    await settings.getByRole('tab', { name: /Data/ }).click()
    await expect(settings.getByRole('button', { name: 'Export workspace' })).toHaveCount(0)
    await settings.getByTestId('settings-workspace-link').click()
    await expect(settings).toHaveCount(0)
    await expect(wsPage(page)).toHaveAttribute('data-section', 'overview')
  })

  test('people: add, rename, remove someone unused; a used person needs a merge', async ({ page }) => {
    await openApp(page)
    await openSection(page, 'people')
    const rows = page.getByTestId('ws-person')
    await expect(rows).toHaveCount(4)
    // the local user is marked
    await expect(rows.filter({ hasText: 'You' }).locator('.tm-you')).toHaveText('You')

    const add = page.getByTestId('ws-add-person')
    await add.getByLabel('Add a person').fill('Grace Hopper')
    await add.getByRole('button', { name: 'Add' }).click()
    await expect(rows).toHaveCount(5)
    await add.getByLabel('Add a person').fill('grace hopper')
    await add.getByLabel('Add a person').press('Enter')
    await expect(add.getByRole('alert')).toContainText('already has this name')
    await expect(rows).toHaveCount(5)

    const grace = rows.filter({ hasText: 'Grace Hopper' })
    await expect(grace.getByTestId('ws-use')).toHaveText('Not used')
    await grace.getByRole('button', { name: 'Actions for Grace Hopper' }).click()
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    const field = page.getByLabel('New name for Grace Hopper')
    await field.fill('Grace')
    await field.press('Enter')
    await expect(rows.locator('.tm-row__name > span:first-child', { hasText: /^Grace$/ })).toHaveCount(1)
    expect(await personId(page, 'Grace')).not.toBeNull()

    // recolour
    await rows.filter({ hasText: 'Grace' }).getByRole('button', { name: 'Actions for Grace' }).click()
    await page.getByRole('menuitem', { name: 'Colour' }).click()
    await page.getByRole('menuitem', { name: 'Green' }).click()
    expect(await wsEval(page, (s) => (s.people as Array<{ name: string; color: string }>).find((p) => p.name === 'Grace')?.color)).toBe('green')

    // remove (nobody uses her) — and Undo brings her back
    await rows.filter({ hasText: 'Grace' }).getByRole('button', { name: 'Actions for Grace' }).click()
    await page.getByRole('menuitem', { name: 'Remove' }).click()
    await expect(rows).toHaveCount(4)
    await page.locator('.toasts').getByRole('button', { name: 'Undo' }).click()
    await expect(rows).toHaveCount(5)

    // Sam is used: no Remove, only a merge
    const sam = rows.filter({ hasText: 'Sam' })
    await expect(sam.getByTestId('ws-use')).toContainText(/\d+ rows/i)
    await sam.getByRole('button', { name: 'Actions for Sam' }).click()
    await expect(page.getByRole('menuitem', { name: /Remove/ })).toBeDisabled()
    await expect(page.getByRole('menuitem', { name: 'Merge into' })).toBeEnabled()
    await page.keyboard.press('Escape')

    // where Sam is used: the rows, each a link
    await sam.getByTestId('ws-use').click()
    const list = page.getByTestId('ws-used-in')
    await expect(list.getByRole('link')).toHaveCount(await wsEval(page, (s) => {
      const id = (s.people as Array<{ id: string; name: string }>).find((p) => p.name === 'Sam')!.id
      return (Object.values(s.pages) as Array<{ databaseId?: string; properties: Record<string, unknown> }>).filter((p) => p.databaseId && Object.values(p.properties).some((v) => Array.isArray(v) && v.includes(id))).length
    }))
  })

  test('merge: person values and @mentions follow, one Undo puts everything back', async ({ page }) => {
    await openApp(page)
    const samId = (await personId(page, 'Sam'))!
    const alexId = (await personId(page, 'Alex'))!
    const pageId = await createPage(page, {
      title: 'Standup',
      content: doc({ type: 'paragraph', content: [{ type: 'text', text: 'Ask ' }, { type: 'mention', attrs: { id: samId, label: 'Sam', kind: 'person' } }, { type: 'text', text: ' about the launch.' }] }, para('Done.')),
    })
    const samRows = await wsEval(
      page,
      (s, id) => (Object.values(s.pages) as Array<{ id: string; databaseId?: string; properties: Record<string, unknown> }>).filter((p) => p.databaseId && Object.values(p.properties).some((v) => Array.isArray(v) && v.includes(id))).map((p) => p.id),
      samId,
    )
    expect(samRows.length).toBeGreaterThan(0)
    const before = await wsEval(page, (s, ids) => Object.fromEntries((ids as string[]).map((id) => [id, s.pages[id].properties])), samRows)

    await openSection(page, 'people')
    const sam = page.getByTestId('ws-person').filter({ hasText: 'Sam' })
    await expect(sam.getByTestId('ws-use')).toContainText('1 mention')
    await sam.getByRole('button', { name: 'Actions for Sam' }).click()
    await page.getByRole('menuitem', { name: 'Merge into' }).click()
    await page.getByRole('menuitem', { name: 'Alex' }).click()
    await expect(sam.locator('.tm-confirm')).toContainText('Merge Sam into Alex?')
    await sam.getByRole('button', { name: 'Merge', exact: true }).click()
    await expect(page.locator('.toasts')).toContainText('Sam merged into Alex')
    await expect(page.getByTestId('ws-person').filter({ hasText: 'Sam' })).toHaveCount(0)

    // values: Sam → Alex (no duplicates); mentions: id + label; origin 'people'
    const after = await wsEval(
      page,
      (s, a) => {
        const rows = (a.rows as string[]).map((id) => Object.values(s.pages[id].properties).filter(Array.isArray) as string[][])
        const mention = JSON.stringify(s.pages[a.pageId].content)
        return { hasSam: rows.some((lists) => lists.some((l) => l.includes(a.sam))), allAlex: rows.every((lists) => lists.some((l) => l.includes(a.alex) && new Set(l).size === l.length)), mention, origin: s.pages[a.pageId].contentOrigin, people: (s.people as Array<{ id: string }>).map((p) => p.id) }
      },
      { rows: samRows, pageId, sam: samId, alex: alexId },
    )
    expect(after.hasSam).toBe(false)
    expect(after.allAlex).toBe(true)
    expect(after.mention).toContain(`"id":"${alexId}"`)
    expect(after.mention).toContain('"label":"Alex"')
    expect(after.mention).not.toContain(samId)
    expect(after.origin).toBe('people')
    expect(after.people).not.toContain(samId)

    // one Undo: the person, every value and the mention are back
    await page.locator('.toasts').getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByTestId('ws-person').filter({ hasText: 'Sam' })).toHaveCount(1)
    const undone = await wsEval(page, (s, a) => ({ props: Object.fromEntries((a.rows as string[]).map((id) => [id, s.pages[id].properties])), mention: JSON.stringify(s.pages[a.pageId].content), people: (s.people as Array<{ id: string }>).map((p) => p.id) }), { rows: samRows, pageId })
    expect(undone.props).toEqual(before)
    expect(undone.mention).toContain(`"id":"${samId}"`)
    expect(undone.people).toContain(samId)
  })

  test('automation: agents, scripts and database automations in one overview', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => {
      const now = Date.now()
      s.upsertAgent({ id: 'agentWeekly1', name: 'Weekly digest', instructions: 'Summarise the week.', trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: 'none', output: null, mcpServers: [], runner: 'browser', maxRunUsd: 0.5, enabled: true, createdBy: null, updatedBy: null, createdAt: now, updatedAt: now })
      s.upsertScript({ id: 'scriptOverdue1', name: 'Overdue report', code: 'let n = 1', kind: 'script', createdBy: null, updatedBy: null, createdAt: now, updatedAt: now })
    })
    await openSection(page, 'automation')
    await expect(page.getByTestId('ws-auto-agents')).toContainText('Weekly digest')
    await expect(page.getByTestId('ws-auto-agents')).toContainText('Manual')
    await expect(page.getByTestId('ws-auto-scripts')).toContainText('Overdue report')
    await expect(page.getByTestId('ws-auto-automations')).toContainText('Projects')
    await expect(page.getByTestId('ws-auto-functions')).toContainText('MARGIN')
    await expect(page.getByTestId('ws-coding')).toContainText('Coding worker')
    // each one opens where it is made
    await page.getByTestId('ws-auto-scripts').getByRole('button', { name: 'Open: Overdue report' }).click()
    await expect(page).toHaveURL(/#\/scripts\/scriptOverdue1/)
  })

  test('data: the full backup still downloads and the page remembers it; the trash opens', async ({ page }) => {
    await openApp(page)
    await openSection(page, 'data')
    await expect(page.getByTestId('ws-last-backup')).toContainText('None from this device yet')
    await page.getByRole('button', { name: 'Export workspace' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: /Whole workspace/ }).click()
    await dialog.getByRole('radio', { name: /Full backup/ }).click()
    const download = page.waitForEvent('download')
    await dialog.locator('[data-export-run]').click()
    expect((await download).suggestedFilename()).toMatch(/\.json$/)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('ws-last-backup')).not.toContainText('None from this device yet')
    await page.getByRole('button', { name: 'Open trash' }).click()
    await expect(page.getByRole('dialog', { name: 'Trash' })).toBeVisible()
  })

  test('phone width in German, and the dark theme', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await openSection(page, 'people')
    await expect(page.getByRole('heading', { name: /Personen/, level: 2 })).toBeVisible()
    await expect(page.getByRole('link', { name: /Überblick/ })).toBeVisible()
    await expect(page.getByTestId('ws-person').first()).toBeVisible()
    // nothing runs off the side
    const overflow = await page.evaluate(() => {
      const el = document.querySelector('.wsp') as HTMLElement
      return el.scrollWidth - el.clientWidth
    })
    expect(overflow).toBeLessThanOrEqual(1)
    await openSection(page, 'automation')
    await expect(page.getByRole('heading', { name: /Automatisierung/, level: 2 })).toBeVisible()

    await page.setViewportSize({ width: 1440, height: 900 })
    await wsEval(page, (s) => s.updateSettings({ theme: 'dark', language: 'en' }))
    await openSection(page, '')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.getByRole('heading', { name: /Overview/, level: 2 })).toBeVisible()
  })
})
