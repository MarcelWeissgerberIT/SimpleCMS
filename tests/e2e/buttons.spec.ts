/** Button block: slash insert, configuration, actions (blocks, webhook, database rows, row properties), read-only. */
import type { BrowserContext, Locator, Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, gotoPage, editorOf, createPage, doc, para, wsEval, uiEval, flush, pageIdByTitle } from './fixtures'

interface Hit {
  method: string
  body: string
  contentType: string
}

/** Mock the webhook endpoint (CORS preflight included). Never lets a request through. */
async function mockHooks(ctx: BrowserContext): Promise<Hit[]> {
  const hits: Hit[] = []
  await ctx.route('https://hooks.e2e.test/**', (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, PUT, OPTIONS' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    hits.push({ method: req.method(), body: req.postData() ?? '', contentType: req.headers()['content-type'] ?? '' })
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: '{"ok":true}' })
  })
  return hits
}

/** New line at the end of the page, "/button", Enter → the fresh button opens its configuration. */
async function insertButton(page: Page, ed: Locator): Promise<Locator> {
  await ed.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/button')
  const menu = page.locator('.slash')
  await expect(menu.locator('.slash__item[aria-selected="true"] .slash__name')).toHaveText('Button')
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Configure button' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function addAction(page: Page, dialog: Locator, name: RegExp) {
  await dialog.getByRole('button', { name: 'Add action' }).click()
  await page.getByRole('menuitem', { name }).click()
}

/** Top-level blocks of a page (stored content). */
async function blocksOf(page: Page, id: string): Promise<JSONContent[]> {
  return wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.pages[id]?.content?.content ?? [])), id)
}

const textOf = (n: JSONContent): string => (n.text ?? '') + (n.content ?? []).map(textOf).join('')

test.describe('button block', () => {
  test('slash → insert blocks + webhook: a click inserts the blocks below and sends the payload', async ({ page, context }) => {
    const hits = await mockHooks(context)
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ userName: 'Ada' }))
    const id = await createPage(page, { title: 'Button lab', content: doc(para('Intro line')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)

    const dialog = await insertButton(page, ed)
    // the label field is focused with its text selected: typing replaces "New button"
    await expect(dialog.getByRole('textbox', { name: 'Label' })).toBeFocused()
    await page.keyboard.type('Log entry')
    await dialog.getByRole('radio', { name: 'Ink' }).click()

    // 1 — insert blocks, authored in the nested editor (markdown shortcuts + variables)
    await addAction(page, dialog, /Insert blocks/)
    const template = dialog.getByRole('textbox', { name: 'Blocks' })
    await template.click()
    await page.keyboard.type('Logged by {{user}}')
    await page.keyboard.press('Enter')
    await page.keyboard.type('[] follow up')
    // 2 — webhook
    await addAction(page, dialog, /Send webhook/)
    await dialog.getByRole('textbox', { name: 'Webhook URL' }).fill('https://hooks.e2e.test/button')
    await expect(dialog.getByRole('listitem', { name: /^Action 2: Send webhook/ })).toBeVisible()
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toBeHidden()

    // stored on the node
    await flush(page)
    const stored = (await blocksOf(page, id)).find((n) => n.type === 'button')
    expect(stored?.attrs).toMatchObject({ label: 'Log entry', variant: 'ink' })
    expect((stored?.attrs?.actions as Array<{ type: string }>).map((a) => a.type)).toEqual(['insert_blocks', 'webhook'])

    // click → blocks right below the button, webhook received the payload, summary toast
    const key = ed.getByRole('button', { name: 'Log entry', exact: true })
    await key.click()
    await expect(page.getByRole('status').filter({ hasText: 'Log entry' })).toContainText(/2 blocks inserted.*Webhook POST → 200/)
    await expect.poll(() => hits.length).toBe(1)

    await expect
      .poll(async () => {
        const blocks = await blocksOf(page, id)
        const at = blocks.findIndex((n) => n.type === 'button')
        return blocks.slice(at + 1, at + 3).map((n) => `${n.type}:${textOf(n)}`)
      })
      .toEqual(['paragraph:Logged by Ada', 'taskList:follow up'])

    const hit = hits[0]
    expect(hit.method).toBe('POST')
    expect(hit.contentType).toContain('application/json')
    const payload = JSON.parse(hit.body)
    expect(payload).toMatchObject({ event: 'button_clicked', button: { label: 'Log entry' }, page: { id, title: 'Button lab', properties: {} }, source: 'simplecms-one' })
    expect(payload.page.url).toMatch(new RegExp(`#/p/${id}$`))
    expect(new Date(payload.timestamp).toString()).not.toBe('Invalid Date')
    // the page as Markdown: the button renders as [Label], the inserted blocks are part of it
    expect(payload.page.markdown).toContain('[Log entry]')
    expect(payload.page.markdown).toContain('Logged by Ada')
    expect(payload.page.markdown).toMatch(/- \[ \] follow up/)

    // a second click inserts again (newest right below the button)
    await key.click()
    await expect.poll(() => hits.length).toBe(2)
    await expect.poll(async () => (await blocksOf(page, id)).filter((n) => textOf(n) === 'Logged by Ada').length).toBe(2)
  })

  test('"Add a page to a database" creates a row in the seeded Projects database and opens it', async ({ page }) => {
    await openApp(page)
    const projects = await pageIdByTitle(page, 'Projects')
    const before = await wsEval(page, (s, db) => Object.values(s.pages).filter((p: any) => p.databaseId === db && !p.trashed).length, projects) // eslint-disable-line @typescript-eslint/no-explicit-any
    const id = await createPage(page, { title: 'Intake desk', content: doc(para('New leads go here.')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)

    const dialog = await insertButton(page, ed)
    await dialog.getByRole('textbox', { name: 'Label' }).fill('New project')
    await addAction(page, dialog, /Add a page to a database/)
    await dialog.getByRole('button', { name: 'Database' }).click()
    await page.keyboard.type('Proj')
    await page.getByRole('menuitem', { name: 'Projects', exact: true }).click()
    await dialog.getByRole('textbox', { name: 'Page title' }).fill('Lead {{date}}')
    await dialog.getByRole('button', { name: 'Add value' }).click()
    await page.getByRole('menuitem', { name: 'Status', exact: true }).click()
    await dialog.getByRole('button', { name: 'Value of Status' }).click()
    await page.getByRole('menuitem', { name: 'Review', exact: true }).click()
    await dialog.getByRole('switch', { name: 'Open it after creating' }).click()
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toBeHidden()

    await ed.getByRole('button', { name: 'New project', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'New project' })).toContainText(/added to Projects/)

    const row = await wsEval(
      page,
      (s, db) => {
        const rows = Object.values(s.pages).filter((p: any) => p.databaseId === db && !p.trashed) // eslint-disable-line @typescript-eslint/no-explicit-any
        const last = rows.sort((a: any, b: any) => b.createdAt - a.createdAt)[0] as any // eslint-disable-line @typescript-eslint/no-explicit-any
        const status = s.databases[db].properties.find((p: any) => p.name === 'Status') // eslint-disable-line @typescript-eslint/no-explicit-any
        return { count: rows.length, id: last.id, title: last.title, status: status.options.find((o: any) => o.id === last.properties[status.id])?.name ?? null } // eslint-disable-line @typescript-eslint/no-explicit-any
      },
      projects,
    )
    expect(row.count).toBe(before + 1)
    expect(row.title).toMatch(/^Lead [A-Z][a-z]{2} \d{1,2}, \d{4}$/)
    expect(row.status).toBe('Review')
    // "open it after creating" → the new row is in the side peek
    await expect.poll(() => uiEval(page, (s) => s.peekPageId)).toBe(row.id)
  })

  test('on a database row: "Edit properties of this page" sets the status; keyboard runs and configures', async ({ page }) => {
    await openApp(page)
    const projects = await pageIdByTitle(page, 'Projects')
    const rowId = await wsEval(
      page,
      (s, db) => {
        const status = s.databases[db].properties.find((p: any) => p.name === 'Status') // eslint-disable-line @typescript-eslint/no-explicit-any
        const id = s.createRow(db, { title: 'Button row', properties: { [status.id]: status.options[0].id } })
        s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Row notes' }] }] }, 'e2e')
        return id
      },
      projects,
    )
    await flush(page)
    await gotoPage(page, rowId)
    const ed = editorOf(page, rowId)
    await expect(ed).toContainText('Row notes')

    const dialog = await insertButton(page, ed)
    await dialog.getByRole('textbox', { name: 'Label' }).fill('Send to review')
    await addAction(page, dialog, /Edit properties of this page/)
    await dialog.getByRole('button', { name: 'Add value' }).click()
    await page.getByRole('menuitem', { name: 'Status', exact: true }).click()
    await dialog.getByRole('button', { name: 'Value of Status' }).click()
    await page.getByRole('menuitem', { name: 'Review', exact: true }).click()
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toBeHidden()

    const statusName = () =>
      wsEval(
        page,
        (s, { db, row }) => {
          const status = s.databases[db].properties.find((p: any) => p.name === 'Status') // eslint-disable-line @typescript-eslint/no-explicit-any
          return status.options.find((o: any) => o.id === s.pages[row].properties[status.id])?.name ?? null // eslint-disable-line @typescript-eslint/no-explicit-any
        },
        { db: projects, row: rowId },
      )
    expect(await statusName()).toBe('Backlog')

    // keyboard: ↑ from the line below selects the button, ↵ runs it
    await ed.locator('p').last().click()
    await page.keyboard.press('ArrowUp')
    await expect(ed.locator('.ob.is-selected')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('status').filter({ hasText: 'Send to review' })).toContainText('1 property updated')
    await expect.poll(statusName).toBe('Review')
    // the row's property panel shows it too
    await expect(page.locator('#main .pv-props')).toContainText('Review')

    // ⇧↵ on the selected button opens its configuration
    await ed.locator('p').last().click()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Shift+Enter')
    await expect(page.getByRole('dialog', { name: 'Configure button' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Configure button' })).toBeHidden()
  })

  test('read-only share view renders a disabled button that never runs', async ({ page, context }) => {
    const hits = await mockHooks(context)
    await openApp(page)
    const id = await createPage(page, {
      title: 'Shared buttons',
      content: doc(para('Read me'), {
        type: 'button',
        attrs: {
          label: 'Ping the bot',
          variant: 'signal',
          actions: [
            { id: 'w', type: 'webhook', url: 'https://hooks.e2e.test/never', method: 'POST' },
            { id: 'm', type: 'message', text: 'Bot pinged' },
          ],
        },
      }),
    })
    await gotoPage(page, id)
    // live editor: the same button runs (sanity check for the mock)
    await editorOf(page, id).getByRole('button', { name: 'Ping the bot', exact: true }).click()
    await expect.poll(() => hits.length).toBe(1)
    await expect(page.getByRole('status').filter({ hasText: 'Bot pinged' })).toBeVisible()

    await page.locator('.tb').getByRole('button', { name: 'Share', exact: true }).click()
    const link = await page.getByRole('dialog').getByRole('textbox', { name: 'Share link' }).inputValue()
    expect(link).toMatch(/#\/s\//)
    await page.goto(link)
    await expect(page.locator('.shv__title')).toHaveText('Shared buttons')
    const key = page.locator('.shv__doc').getByRole('button', { name: 'Ping the bot' })
    await expect(key).toBeVisible()
    await expect(key).toBeDisabled()
    await expect(page.locator('.shv__doc .ob-edit')).toHaveCount(0)
    await key.click({ force: true })
    await page.keyboard.press('Enter')
    await page.waitForTimeout(600)
    expect(hits).toHaveLength(1)
    await expect(page.getByRole('status').filter({ hasText: 'Bot pinged' })).toHaveCount(0)
  })
})
