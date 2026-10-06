/**
 * Public API + incoming webhooks against the real server: an admin creates a token in Workspace
 * settings → Automation, a script writes rows with it and the open table shows them live; the row's content (built by
 * the server from markdown) opens in the editor and stays editable; an incoming webhook made in the UI
 * creates exactly one row per delivery; members can't manage tokens; read tokens can't write.
 */
import type { Page } from '@playwright/test'
import { test, expect, api, email, signIn, newPerson, openApp, waitOnline, wsEval, createWorkspace, join, editorOf } from './fixtures'

/** Workspace settings → Automation (API tokens and webhooks) through the workspace menu, from Home. */
async function openTeam(page: Page) {
  await page.evaluate(() => (location.hash = '#/'))
  await page.locator('aside.sb .sb-head__ws').click()
  await page.getByRole('menuitem', { name: 'Workspace settings' }).click()
  const ws = page.getByTestId('workspace-page')
  await ws.getByRole('link', { name: /Automation/ }).click()
  await expect(ws).toHaveAttribute('data-section', 'automation')
  return ws
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

/** Uncaught errors and console.error of a page (the suite's "no console errors" bar). */
function watchErrors(page: Page): string[] {
  const list: string[] = []
  page.on('pageerror', (e) => list.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') list.push(`console.error: ${m.text()}`)
  })
  return list
}

test.describe('public API & incoming webhooks', () => {
  test('token from the UI → rows appear live, content opens and edits, PATCH updates a cell, webhook dedupes', async ({ page }) => {
    const errors = watchErrors(page)
    await signIn(page, email('ada'))
    const wsId = await createWorkspace(page, 'Automation HQ')
    await openApp(page, wsId)
    await waitOnline(page)

    // a database with the default schema (Name, Status, Tags, Date)
    const db = await page.evaluate(() => {
      const ws = (window as any).__one.workspace // eslint-disable-line @typescript-eslint/no-explicit-any
      const dbId = ws.getState().createDatabase({ title: 'Leads' })
      const tags = ws.getState().databases[dbId].properties.find((p: { type: string }) => p.type === 'multi_select')
      ws.getState().updateProperty(dbId, tags.id, { options: [{ id: 'hot', name: 'Hot', color: 'red' }] })
      return { dbId, statusId: ws.getState().databases[dbId].properties.find((p: { type: string }) => p.type === 'status').id as string, tagsId: tags.id as string }
    })
    await page.evaluate((id) => (window.location.hash = `#/p/${id}`), db.dbId)
    const table = page.locator('#main section.db')
    await expect(table).toBeVisible()

    // the admin creates a write token in the team settings — the secret is shown once
    let team = await openTeam(page)
    await team.getByLabel('Token name').fill('Zapier — CRM sync')
    await team.getByLabel('Access').selectOption('write')
    await team.getByRole('button', { name: 'Create token' }).click()
    const secretBox = team.getByTestId('api-token-secret')
    await expect(secretBox).toBeVisible()
    const token = await secretBox.locator('input').inputValue()
    expect(token).toMatch(/^one_[A-Za-z0-9_-]{43}$/)
    await expect(secretBox.locator('pre')).toContainText(`Bearer ${token}`)
    await expect(team.getByTestId('api-token')).toHaveCount(1)
    await expect(team.getByTestId('api-token')).toContainText('Zapier — CRM sync')
    await expect(team.getByTestId('api-token')).toContainText('Write')
    // back to the open table (the workspace page is a page, not a dialog)
    await page.evaluate((id) => (window.location.hash = `#/p/${id}`), db.dbId)
    await expect(team).toBeHidden()
    await expect(table).toBeVisible()

    // a script writes a row: it appears in the open table without a reload
    await expect.poll(async () => (await page.request.get(`/api/v1/databases/${db.dbId}`, { headers: bearer(token) })).status()).toBe(200)
    const created = await page.request.post(`/api/v1/databases/${db.dbId}/rows`, {
      headers: bearer(token),
      data: { title: 'Ada Lovelace', properties: { Status: 'in progress', Tags: ['hot'] }, content: '## Call notes\n\nWants the **team plan**.\n\n- [ ] send quote\n- [x] intro call' },
    })
    expect(created.status()).toBe(201)
    const row = (await created.json()) as { id: string; url: string }
    expect(row.url).toContain(`/app/?w=${wsId}#/p/${row.id}`)
    await expect(table).toContainText('Ada Lovelace')
    await expect(table).toContainText('In progress')
    await expect(table).toContainText('Hot')
    expect(await wsEval(page, (s, x) => s.pages[x.row].properties[x.status], { row: row.id, status: db.statusId })).toBeTruthy()

    // the row's content (written by the server) renders in the editor, and it can be edited
    await page.evaluate((id) => (window.location.hash = `#/p/${id}`), row.id)
    const editor = editorOf(page, row.id)
    await expect(editor).toBeVisible()
    await expect(editor.locator('h2, h3').filter({ hasText: 'Call notes' })).toBeVisible()
    await expect(editor.locator('strong')).toHaveText('team plan')
    await expect(editor.locator('ul[data-type="taskList"] li')).toHaveCount(2)
    await expect(editor.locator('ul[data-type="taskList"] li').nth(1)).toHaveAttribute('data-checked', 'true')
    await editor.locator('p').filter({ hasText: 'Wants the' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' Budget approved.')
    await expect(editor).toContainText('Wants the team plan. Budget approved.')
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain as string, row.id), { timeout: 15_000 }).toContain('Budget approved.')
    // … and the server reads the edit back
    await expect
      .poll(async () => ((await (await page.request.get(`/api/v1/pages/${row.id}`, { headers: bearer(token) })).json()) as { text: string }).text, { timeout: 15_000 })
      .toContain('Budget approved.')

    // PATCH changes a cell live
    await page.evaluate((id) => (window.location.hash = `#/p/${id}`), db.dbId)
    await expect(table).toContainText('In progress')
    const patched = await page.request.patch(`/api/v1/rows/${row.id}`, { headers: bearer(token), data: { properties: { Status: 'Done' } } })
    expect(patched.status()).toBe(200)
    await expect(table).toContainText('Done')
    await expect(table).not.toContainText('In progress')

    // an incoming webhook from the UI; the same delivery twice → one row
    team = await openTeam(page)
    await team.getByLabel('Database', { exact: true }).selectOption({ label: 'Leads' })
    await team.getByRole('button', { name: 'Create webhook' }).click()
    const hookBox = team.getByTestId('api-hook-url')
    await expect(hookBox).toBeVisible()
    const url = await hookBox.locator('input').inputValue()
    expect(url).toMatch(/\/api\/v1\/hooks\/[A-Za-z0-9_-]{43}$/)
    await expect(team.getByTestId('api-hook')).toContainText('Leads')
    await page.evaluate((id) => (window.location.hash = `#/p/${id}`), db.dbId)
    await expect(table).toBeVisible()
    const payload = { name: 'Grace Hopper', status: 'Not started', company: 'Navy', deliveryId: 'dlv-42' }
    const first = await page.request.post(url, { data: payload })
    const second = await page.request.post(url, { data: payload })
    expect(first.status()).toBe(201)
    expect(second.status()).toBe(200)
    expect((await second.json()).id).toBe((await first.json()).id)
    await expect(table).toContainText('Grace Hopper')
    await page.waitForTimeout(1500)
    expect(await wsEval(page, (s, id) => Object.values(s.pages).filter((p: any) => p.databaseId === id && p.title === 'Grace Hopper').length, db.dbId)).toBe(1) // eslint-disable-line @typescript-eslint/no-explicit-any
    // the unmapped field is kept in the row's content
    await expect.poll(() => wsEval(page, (s, id) => Object.values(s.pages).find((p: any) => p.databaseId === id && p.title === 'Grace Hopper')?.plain ?? '', db.dbId), { timeout: 15_000 }).toContain('company: Navy') // eslint-disable-line @typescript-eslint/no-explicit-any

    // the list counts the delivery
    team = await openTeam(page)
    await expect(team.getByTestId('api-hook')).toContainText('deliveries 1')
    await expect(team.getByTestId('api-token')).toContainText(/used/)
    expect(errors).toEqual([])
  })

  test('members see a note instead of token management; a read token cannot write', async ({ page, context }) => {
    await signIn(page, email('owner'))
    const wsId = await createWorkspace(page, 'Read Only Ops')
    const mia = await newPerson(context)
    await signIn(mia, email('mia'))
    await join(page, mia, wsId, 'member')
    const errors = watchErrors(mia)

    await openApp(mia, wsId)
    await waitOnline(mia)
    const team = await openTeam(mia)
    await expect(team.getByTestId('api-admin-only')).toContainText('Only owners and admins')
    await expect(team.getByRole('button', { name: 'Create token' })).toHaveCount(0)
    expect((await api(mia, 'POST', `/api/workspaces/${wsId}/tokens`, { name: 'sneaky', scope: 'write' })).status).toBe(403)
    expect((await api(mia, 'GET', `/api/workspaces/${wsId}/hooks`)).status).toBe(403)
    expect(errors.filter((e) => !/403/.test(e))).toEqual([])

    // the owner makes a read token: reads work, writes are 403
    await page.goto('/app/')
    const read = await api<{ token: string }>(page, 'POST', `/api/workspaces/${wsId}/tokens`, { name: 'Dashboard', scope: 'read' })
    expect(read.status).toBe(201)
    expect((await page.request.get('/api/v1/databases', { headers: bearer(read.json.token) })).status()).toBe(200)
    const denied = await page.request.post('/api/v1/pages', { headers: bearer(read.json.token), data: { title: 'nope' } })
    expect(denied.status()).toBe(403)
    expect(((await denied.json()) as { error: { code: string } }).error.code).toBe('insufficient_scope')
  })
})
