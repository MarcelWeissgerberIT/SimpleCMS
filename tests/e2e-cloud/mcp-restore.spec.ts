/**
 * MCP B3 on the team server (MCP plan § 3.6): a team server has no approval card, so it keeps a pre-image of every
 * MCP write. Workspace settings → Automation → "Recent MCP writes" lists the calls (owners / admins) and puts one back
 * — all or nothing (Weg 4 D3):
 *  - a row batch with one field someone changed since: nothing is put back, the row names it; "Restore anyway" puts
 *    back both fields the call wrote;
 *  - pages a call made go to the trash while nobody touched them; one renamed since: nothing goes, and there is no
 *    "Restore anyway" (it never trashes) — the row says to undo it in One;
 *  - a page text replaced and changed since: refused, then "Restore anyway" puts the text back.
 * The MCP client talks to the test server's /mcp with a write token (Node side). Fictional data.
 * `B3_SHOTS=<dir>`: screenshots of the list with a refused call (EN + DE, 1440×900 and 390×844, light and dark).
 */
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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

test('Recent MCP writes: all or nothing — a field changed since refuses the call (then "Restore anyway"), untouched pages go, a renamed page leaves only "undo it in One"', async ({ page }) => {
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
  const statusOf = () => wsEval(page, (s, x) => x.rows.slice(0, 2).map((id: string) => s.pages[id]?.properties[x.status]), ids)
  try {
    await expect.poll(async () => !(await call('one_get_page', { id: ids.rows[2] })).isError).toBe(true)

    // MCP calls: a row batch, two sub-pages, a page text replaced, one more page
    json(await call('one_update_row', { rows: ids.rows.slice(0, 2).map((id: string) => ({ id, properties: { Status: 'Done' } })) }))
    const made = json(await call('one_create_page', { parentId: ids.host, pages: [{ title: 'Glossar' }, { title: 'FAQ', markdown: 'Fragen von Tessera.' }] }))
    const notes = json(await call('one_create_page', { title: 'Protokoll', parentId: ids.host, markdown: 'First version.' }))
    json(await call('one_update_page', { id: notes.id, markdown: 'Second version.', mode: 'replace' }))
    const wiki = json(await call('one_create_page', { title: 'Wissensbasis', parentId: ids.host }))
    await expect.poll(statusOf).toEqual([ids.done, ids.done])
    // someone changes Card 2 by hand afterwards, and renames the Wissensbasis page
    await wsEval(page, (s, x) => s.setRowProperty(x.rows[1], x.status, x.doing), ids)
    await wsEval(page, (s, id) => s.updatePage(id, { title: 'Wissensbasis (Mara)' }), wiki.id)

    const ws = await openAutomation(page)
    const list = ws.getByRole('list', { name: 'Recent MCP writes' })
    await expect(list.getByTestId('mcp-call')).toHaveCount(5)
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
    await expect(rowsCall).toContainText('If anything of it was changed since, nothing is put back.')
    await expect(rowsCall.getByRole('group').getByRole('button', { name: 'Cancel' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(rowsCall.getByRole('group')).toHaveCount(0)
    await expect(restoreKey).toBeFocused()
    // the rows (by keyboard): Card 2 changed since → NOTHING is put back, Card 2 is named with its field
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await expect(rowsCall.getByRole('group').getByRole('button', { name: 'Restore', exact: true })).toBeFocused()
    await page.keyboard.press('Enter')
    const changed = rowsCall.getByTestId('mcp-call-changed')
    await expect(changed).toContainText('Nothing was put back — changed since this call: “Card 2” (Status).')
    await expect(changed).toContainText('version history, the trash')
    await page.waitForTimeout(300)
    expect(await statusOf()).toEqual([ids.done, ids.doing])
    // the bar went: focus on the row's "Restore anyway" key (it can put the fields back)
    await expect(rowsCall.getByRole('button', { name: 'Restore anyway' })).toBeFocused()
    // "Restore anyway": both fields the call wrote go back, the later change too
    await page.keyboard.press('Enter')
    await expect(rowsCall).toContainText('Put back the texts and fields this call changed anyway? What was changed there since goes.')
    await page.keyboard.press('Tab')
    await expect(rowsCall.getByRole('group').getByRole('button', { name: 'Restore anyway' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(rowsCall).toContainText('Put back')
    await expect(rowsCall.getByRole('button', { name: /^Restore/ })).toHaveCount(0)
    // its keys are gone: focus on the row itself, never on the page body
    await expect(rowsCall).toBeFocused()
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false)
    await expect.poll(statusOf).toEqual([ids.todo, ids.todo])

    // the untouched pages: both to the trash
    await pagesCall.getByRole('button', { name: /^Restore: / }).click()
    await pagesCall.getByRole('group').getByRole('button', { name: 'Restore', exact: true }).click()
    await expect(pagesCall).toContainText('Put back')
    await expect.poll(() => wsEval(page, (s, ids: string[]) => ids.map((id) => s.pages[id]?.trashed === true), made.pages.map((p: AnyState) => p.id))).toEqual([true, true])

    // the renamed page: refused, and "Restore anyway" is not offered (it never trashes) — undo it in One
    const wikiCall = list.getByTestId('mcp-call').filter({ hasText: 'Wissensbasis (Mara)' })
    await wikiCall.getByRole('button', { name: /^Restore: / }).click()
    await wikiCall.getByRole('group').getByRole('button', { name: 'Restore', exact: true }).click()
    await expect(wikiCall.getByTestId('mcp-call-changed')).toContainText('“Wissensbasis (Mara)” (title). Undo it in One instead: version history or the trash.')
    await expect(wikiCall.getByRole('button', { name: 'Restore anyway' })).toHaveCount(0)
    await expect(wikiCall.getByRole('button', { name: /^Restore: / })).toBeFocused()
    expect(await wsEval(page, (s, id) => s.pages[id]?.trashed === true, wiki.id)).toBe(false)

    // the replaced text: changed since → refused, then "Restore anyway" puts it back
    await wsEval(page, (s, id) => s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second version.' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'A line typed later.' }] }] }, 'e2e'), notes.id)
    const textCall = list.getByTestId('mcp-call').filter({ hasText: 'Page text replaced' })
    await expect.poll(async () => JSON.stringify((await call('one_get_page', { id: notes.id })).content)).toContain('typed later')
    await textCall.getByRole('button', { name: /^Restore: / }).click()
    await textCall.getByRole('group').getByRole('button', { name: 'Restore', exact: true }).click()
    await expect(textCall.getByTestId('mcp-call-changed')).toContainText('“Protokoll” (text)')
    await textCall.getByRole('button', { name: 'Restore anyway' }).click()
    await textCall.getByRole('group').getByRole('button', { name: 'Restore anyway' }).click()
    await expect(textCall).toContainText('Put back')
    await expect.poll(async () => json(await call('one_get_page', { id: notes.id })).markdown).toBe('First version.')

    const dir = process.env.B3_SHOTS
    if (dir) {
      // the list with the refused call open, in both languages
      for (const lang of ['en', 'de'] as const) {
        await wsEval(page, (s, l) => s.updateSettings({ language: l }), lang)
        for (const [w, h, tag] of [
          [1440, 900, 'desktop'],
          [390, 844, 'phone'],
        ] as const) {
          for (const theme of ['light', 'dark'] as const) {
            await page.setViewportSize({ width: w, height: h })
            await page.emulateMedia({ colorScheme: theme })
            await page.evaluate((th) => document.documentElement.setAttribute('data-theme', th), theme)
            // a fresh section each time (no answer left open)
            await page.evaluate(() => (location.hash = '#/'))
            await openAutomation(page)
            const named = page.getByRole('list', { name: lang === 'de' ? 'Letzte MCP-Schreibvorgänge' : 'Recent MCP writes' })
            const refused = named.getByTestId('mcp-call').filter({ hasText: 'Wissensbasis (Mara)' })
            await refused.getByRole('button', { name: lang === 'de' ? /^Zurückholen: / : /^Restore: / }).click()
            await refused.getByRole('group').getByRole('button', { name: lang === 'de' ? 'Zurückholen' : 'Restore', exact: true }).click()
            await expect(refused.getByTestId('mcp-call-changed')).toContainText(lang === 'de' ? 'Nichts zurückgeholt' : 'Nothing was put back')
            await refused.scrollIntoViewIfNeeded()
            // the toasts of the restores above have gone
            await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 })
            await page.screenshot({ path: `${dir}/recent-mcp-writes-refused-${lang}-${tag}-${theme}.png` })
          }
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
    expect(r1.json.left).toEqual([])
    const r2 = await api<AnyState>(page, 'POST', `/api/workspaces/${wsId}/mcp-calls/${dbCall.callId}/restore`, {})
    expect(r2.status, JSON.stringify(r2.json)).toBe(200)
    expect(r2.json.left).toEqual([])
    await expect.poll(() => wsEval(page, (s, a: { made: string; inline: string }) => [!!s.pages[a.made]?.trashed, !!s.pages[a.inline]?.trashed], { made: made.id, inline: inline.id })).toEqual([true, true])
    // the host's text as the server has it now (this tab left the page: its copy is not live any more)
    await expect.poll(async () => JSON.stringify(json(await call('one_get_page', { id: ids.host, format: 'blocks' })).blocks)).not.toContain('databaseBlock')
  } finally {
    await client.close()
  }
})

test('the help and the docs say it in English and German: Restore is all or nothing, "Restore anyway" never trashes', async () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8')
  const en = read('src/app/help/articles/en/public-api.md')
  expect(en).toMatch(/Restore\*\* puts one call back as a whole/)
  expect(en).toMatch(/nothing is put back/)
  expect(en).toMatch(/never trashes anything/)
  const de = read('src/app/help/articles/de/public-api.md')
  expect(de).toMatch(/Zurückholen\*\* macht einen Aufruf als Ganzes rückgängig/)
  expect(de).toMatch(/wird nichts zurückgeholt/)
  expect(de).toMatch(/legt nichts in den Papierkorb/)
  expect(read('docs/API.md')).toMatch(/\*\*all or nothing\*\*/)
  expect(read('docs/MCP.md')).toMatch(/Restore is\s+\*\*all or nothing\*\*/)
})
