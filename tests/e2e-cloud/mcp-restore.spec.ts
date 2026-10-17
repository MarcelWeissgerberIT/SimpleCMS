/**
 * MCP B3 on the team server (MCP plan § 3.6): a team server has no approval card, so it keeps a pre-image of every
 * MCP write. Workspace settings → Automation → "Recent MCP writes" lists the calls (owners / admins) and puts one back:
 *  - a row batch: each field back to what it held — a field someone changed since is kept and named; "Restore anyway"
 *    puts that one back too;
 *  - pages a call made go to the trash;
 *  - a page text replaced and changed since: the server answers changed_since, the row asks again (the later changes
 *    go) and puts it back on the second press.
 * The MCP client talks to the test server's /mcp with a write token (Node side). Fictional data.
 * `B3_SHOTS=<dir>`: German screenshots of the list (1440×900 and 390×844, light and dark).
 */
import type { Page } from '@playwright/test'
import { Client } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StreamableHTTPClientTransport } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js'
import { test, expect, api, email, signIn, openApp, waitOnline, wsEval, createWorkspace } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type ToolResult = { content?: Array<{ type: string; text?: string }>; isError?: boolean }

const text = (r: ToolResult) => (r.content ?? []).map((c) => c.text ?? '').join('')
const json = (r: ToolResult) => {
  expect(r.isError, text(r)).toBeFalsy()
  return JSON.parse(text(r))
}

/** Workspace settings → Automation (API tokens, webhooks, recent MCP writes). */
async function openAutomation(page: Page) {
  await page.evaluate(() => (location.hash = '#/workspace/automation'))
  const ws = page.getByTestId('workspace-page')
  await expect(ws).toHaveAttribute('data-section', 'automation')
  return ws
}

test('Recent MCP writes: rows field by field (a field changed since is kept, then forced), made pages to the trash, a replaced text only with "Restore anyway"', async ({ page }) => {
  await signIn(page, email('mara'))
  const wsId = await createWorkspace(page, 'Nordlicht')
  await openApp(page, wsId)
  await waitOnline(page)

  const ids = await wsEval(page, (s) => {
    const host = s.createPage({ title: 'Launch plan' })
    const db = s.createDatabase({ title: 'Cards', parentId: host })
    // (s is the state before these writes: read the new database from the store now)
    const now = (window as unknown as { __one: { workspace: { getState: () => AnyState } } }).__one.workspace.getState()
    const status = now.databases[db].properties.find((p: AnyState) => p.type === 'status')
    const todo = status.options[0].id
    const rows = [1, 2, 3].map((i) => s.createRow(db, { title: `Card ${i}`, properties: { [status.id]: todo } }))
    return { host, db, rows, status: status.id as string, todo: todo as string, doing: status.options[1].id as string, done: status.options[2].id as string }
  })
  // the server has them before the MCP call reads them
  await expect.poll(async () => (await api<AnyState>(page, 'GET', `/api/workspaces/${wsId}/mcp-calls`)).status).toBe(200)
  const token = (await api<{ token: string }>(page, 'POST', `/api/workspaces/${wsId}/tokens`, { name: 'Claude', scope: 'write' })).json.token
  const client = new Client({ name: 'claude-code', version: '2.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', new URL(page.url()).origin), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<ToolResult>
  try {
    await expect.poll(async () => !(await call('one_get_page', { id: ids.rows[2] })).isError).toBe(true)

    // three MCP calls: a row batch, two sub-pages, a page text replaced
    json(await call('one_update_row', { rows: ids.rows.slice(0, 2).map((id: string) => ({ id, properties: { Status: 'Done' } })) }))
    const made = json(await call('one_create_page', { parentId: ids.host, pages: [{ title: 'Glossar' }, { title: 'FAQ', markdown: 'Fragen von Tessera.' }] }))
    const notes = json(await call('one_create_page', { title: 'Protokoll', parentId: ids.host, markdown: 'First version.' }))
    json(await call('one_update_page', { id: notes.id, markdown: 'Second version.', mode: 'replace' }))
    await expect.poll(() => wsEval(page, (s, x) => x.rows.slice(0, 2).map((id: string) => s.pages[id]?.properties[x.status] === x.done), ids)).toEqual([true, true])
    // someone changes Card 2 by hand afterwards
    await wsEval(page, (s, x) => s.setRowProperty(x.rows[1], x.status, x.doing), ids)

    const ws = await openAutomation(page)
    const list = ws.getByRole('list', { name: 'Recent MCP writes' })
    await expect(list.getByTestId('mcp-call')).toHaveCount(4)
    const rowsCall = list.getByTestId('mcp-call').filter({ hasText: 'Rows changed' })
    await expect(rowsCall).toContainText('Card 1, Card 2')
    await expect(rowsCall).toContainText('token “Claude” · 2 changed')
    const pagesCall = list.getByTestId('mcp-call').filter({ hasText: 'Glossar, FAQ' })
    await expect(pagesCall).toContainText('Pages created')
    await expect(pagesCall).toContainText('2 new')

    // keyboard: the confirm bar's Cancel gives focus back to the row's Restore key — never to the page body
    const restoreKey = rowsCall.getByRole('button', { name: /^Restore: / })
    await restoreKey.focus()
    await page.keyboard.press('Enter')
    await expect(rowsCall).toContainText('Put this call back?')
    await expect(rowsCall.getByRole('group').getByRole('button', { name: 'Cancel' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(rowsCall.getByRole('group')).toHaveCount(0)
    await expect(restoreKey).toBeFocused()
    // the rows (by keyboard): Card 1 goes back, Card 2 (changed since) is kept and named
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await expect(rowsCall.getByRole('group').getByRole('button', { name: 'Restore', exact: true })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(rowsCall.getByRole('status')).toContainText('Left as they are — changed since this call: “Card 2 (Status)”')
    await expect.poll(() => wsEval(page, (s, x) => x.rows.slice(0, 2).map((id: string) => s.pages[id]?.properties[x.status]), ids)).toEqual([ids.todo, ids.doing])
    // the bar went: focus on the row's "Restore anyway" key (fields were kept)
    await expect(rowsCall.getByRole('button', { name: 'Restore anyway' })).toBeFocused()
    // "Restore anyway": the later change goes too
    await page.keyboard.press('Enter')
    await expect(rowsCall).toContainText('What was changed since this call in “Card 2” goes.')
    await page.keyboard.press('Tab')
    await expect(rowsCall.getByRole('group').getByRole('button', { name: 'Restore anyway' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(rowsCall).toContainText('Put back')
    await expect(rowsCall.getByRole('button', { name: /^Restore/ })).toHaveCount(0)
    // its keys are gone: focus on the row itself, never on the page body
    await expect(rowsCall).toBeFocused()
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false)
    await expect.poll(() => wsEval(page, (s, x) => s.pages[x.rows[1]]?.properties[x.status], ids)).toBe(ids.todo)

    // the pages: both to the trash
    await pagesCall.getByRole('button', { name: /^Restore: / }).click()
    await pagesCall.getByRole('group').getByRole('button', { name: 'Restore', exact: true }).click()
    await expect(pagesCall).toContainText('Put back')
    await expect.poll(() => wsEval(page, (s, ids: string[]) => ids.map((id) => s.pages[id]?.trashed === true), made.pages.map((p: AnyState) => p.id))).toEqual([true, true])

    // the replaced text: changed since → asked again, then put back
    await wsEval(page, (s, id) => s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second version.' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'A line typed later.' }] }] }, 'e2e'), notes.id)
    const textCall = list.getByTestId('mcp-call').filter({ hasText: 'Page text replaced' })
    await expect.poll(async () => JSON.stringify((await call('one_get_page', { id: notes.id })).content)).toContain('typed later')
    await textCall.getByRole('button', { name: /^Restore: / }).click()
    await textCall.getByRole('group').getByRole('button', { name: 'Restore', exact: true }).click()
    await expect(textCall).toContainText('“Protokoll” changed since this call.')
    await textCall.getByRole('group').getByRole('button', { name: 'Restore anyway' }).click()
    await expect(textCall).toContainText('Put back')
    await expect.poll(async () => json(await call('one_get_page', { id: notes.id })).markdown).toBe('First version.')

    const dir = process.env.B3_SHOTS
    if (dir) {
      // German screenshots of the list (one more call so it holds an open row too)
      json(await call('one_create_row', { databaseId: ids.db, rows: [{ title: 'Neu 1' }, { title: 'Neu 2' }] }))
      await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
      for (const [w, h, tag] of [
        [1440, 900, 'desktop'],
        [390, 844, 'phone'],
      ] as const) {
        for (const theme of ['light', 'dark'] as const) {
          await page.setViewportSize({ width: w, height: h })
          await page.emulateMedia({ colorScheme: theme })
          await page.evaluate((th) => document.documentElement.setAttribute('data-theme', th), theme)
          // a fresh section each time (no confirm left open)
          await page.evaluate(() => (location.hash = '#/'))
          await openAutomation(page)
          const de = page.getByRole('list', { name: 'Letzte MCP-Schreibvorgänge' })
          await expect(de.getByTestId('mcp-call')).toHaveCount(5)
          const open = de.getByTestId('mcp-call').first()
          await open.getByRole('button', { name: /^Zurückholen: / }).click()
          await expect(open).toContainText('Diesen Aufruf rückgängig machen?')
          await de.scrollIntoViewIfNeeded()
          // the English toasts of the restores above have gone
          await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 })
          await page.screenshot({ path: `${dir}/recent-mcp-writes-${tag}-${theme}.png` })
        }
      }
    }
  } finally {
    await client.close()
  }
})

test('a member who only opens a made page and the host of an inline database changed nothing: Restore puts both back', async ({ page }) => {
  await signIn(page, email('tessera'))
  const wsId = await createWorkspace(page, 'Polaris')
  await openApp(page, wsId)
  await waitOnline(page)
  const ids = await wsEval(page, (s) => {
    const wiki = s.createPage({ title: 'Wissensbasis' })
    const host = s.createPage({ title: 'Besprechung', parentId: wiki })
    return { wiki, host }
  })
  await expect.poll(async () => (await api<AnyState>(page, 'GET', `/api/workspaces/${wsId}/mcp-calls`)).status).toBe(200)
  const token = (await api<{ token: string }>(page, 'POST', `/api/workspaces/${wsId}/tokens`, { name: 'Claude', scope: 'write' })).json.token
  const client = new Client({ name: 'claude-code', version: '2.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', new URL(page.url()).origin), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<ToolResult>
  try {
    await expect.poll(async () => !(await call('one_get_page', { id: ids.host })).isError).toBe(true)
    // text ending in a list, and a database block as the host's last block: the editor keeps a paragraph after each
    const made = json(await call('one_create_page', { title: 'Notizen', parentId: ids.wiki, markdown: 'Text from Claude.\n\n- one\n- two' }))
    const inline = json(await call('one_create_database', { title: 'Inline', inline: { pageId: ids.host }, rows: [{ title: 'I1' }] }))
    const last = (id: string) => wsEval(page, (s, id) => ((s.pages[id]?.content?.content ?? []) as AnyState[]).map((b) => b.type).join(','), id)
    // the member opens both and changes nothing; their editor writes its closing paragraph into each
    for (const [id, closing] of [
      [made.id as string, 'bulletList'],
      [ids.host, 'databaseBlock'],
    ] as const) {
      await page.evaluate((id) => (location.hash = `#/p/${id}`), id)
      await expect(page.locator('.ProseMirror').first()).toBeVisible()
      await expect.poll(() => last(id), { timeout: 15_000 }).toMatch(new RegExp(`${closing},paragraph$`))
      await page.waitForTimeout(800)
    }
    await page.evaluate(() => (location.hash = '#/'))
    await page.waitForTimeout(800)
    const calls = (await api<AnyState[]>(page, 'GET', `/api/workspaces/${wsId}/mcp-calls`)).json
    const pageCall = calls.find((c: AnyState) => c.tool === 'one_create_page')!
    const dbCall = calls.find((c: AnyState) => c.tool === 'one_create_database')!
    const r1 = await api<AnyState>(page, 'POST', `/api/workspaces/${wsId}/mcp-calls/${pageCall.callId}/restore`, {})
    expect(r1.status, JSON.stringify(r1.json)).toBe(200)
    expect(r1.json.kept).toEqual([])
    const r2 = await api<AnyState>(page, 'POST', `/api/workspaces/${wsId}/mcp-calls/${dbCall.callId}/restore`, {})
    expect(r2.status, JSON.stringify(r2.json)).toBe(200)
    expect(r2.json.kept).toEqual([])
    await expect.poll(() => wsEval(page, (s, a: { made: string; inline: string }) => [!!s.pages[a.made]?.trashed, !!s.pages[a.inline]?.trashed], { made: made.id, inline: inline.id })).toEqual([true, true])
    // the host's text as the server has it now (this tab left the page: its copy is not live any more)
    await expect.poll(async () => JSON.stringify(json(await call('one_get_page', { id: ids.host, format: 'blocks' })).blocks)).not.toContain('databaseBlock')
  } finally {
    await client.close()
  }
})
