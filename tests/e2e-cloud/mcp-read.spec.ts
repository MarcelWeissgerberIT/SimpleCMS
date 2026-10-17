/**
 * MCP B2 on a team workspace: comments over the team server's MCP are a token flag an admin sets when making the token
 * (Workspace settings → Automation → API): off by default, read, or read + write (a read token never writes). The
 * flag's row tag, the API's listing, and what an MCP client with each token gets: comment threads with their block
 * ref, or comments_off. Screenshots of the token form (German, 1440 × 900 and 390 × 844, light and dark) when
 * MCP_SHOTS names a folder. Fictional data (Nordlicht, Tessera, Mara Lind).
 */
import type { Page } from '@playwright/test'
import { Client as McpClient } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StreamableHTTPClientTransport } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js'
import { test, expect, api, email, signIn, openApp, waitOnline, wsEval, createWorkspace } from './fixtures'

type ToolResult = { content?: Array<{ type: string; text?: string }>; isError?: boolean }

async function openAutomation(page: Page) {
  await page.evaluate(() => (location.hash = '#/'))
  await page.locator('aside.sb .sb-head__ws').click()
  await page.getByRole('menuitem', { name: /Workspace settings|Workspace-Einstellungen/ }).click()
  const ws = page.getByTestId('workspace-page')
  await ws.getByRole('link', { name: /Automation|Automatisierung/ }).click()
  await expect(ws).toHaveAttribute('data-section', 'automation')
  return ws
}

async function mcp(origin: string, token: string): Promise<McpClient> {
  const client = new McpClient({ name: 'one-e2e', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
  return client
}

test('comments over the team MCP: a token flag set at creation — off by default, read shows threads with their ref', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await signIn(page, email('mara'))
  const wsId = await createWorkspace(page, 'Nordlicht')
  await openApp(page, wsId)
  await waitOnline(page)
  const pageId = await wsEval(page, (s) => {
    const id = s.createPage({ title: 'Tessera review' })
    s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'rev-0001-tessera' }, content: [{ type: 'text', text: 'Shared plan ' }, { type: 'text', text: 'budget', marks: [{ type: 'comment', attrs: { id: 'th-1' } }] }] }] }, 'e2e')
    const at = Date.now()
    s.updatePage(id, { comments: [{ id: 'th-1', quote: 'budget', body: 'Is 40k enough?', author: 'Mara Lind', createdAt: at, updatedAt: at, resolved: false, replies: [] }] })
    return id as string
  })

  const team = await openAutomation(page)
  const comments = team.getByTestId('api-token-comments')
  await expect(comments).toHaveValue('off')
  // a read token never writes comments: that choice is not offered for it
  await team.getByLabel('Access').selectOption('read')
  await expect(comments.locator('option[value="write"]')).toBeDisabled()
  await team.getByLabel('Access').selectOption('write')
  await expect(comments.locator('option[value="write"]')).toBeEnabled()

  // an admin makes one token without comments and one that may read them
  await team.getByLabel('Token name').fill('Claude — plain')
  await team.getByRole('button', { name: 'Create token' }).click()
  const plainToken = await team.getByTestId('api-token-secret').locator('input').inputValue()
  await team.getByRole('button', { name: 'Done' }).click()
  await team.getByLabel('Token name').fill('Claude — comments')
  await comments.selectOption('read')
  await team.getByRole('button', { name: 'Create token' }).click()
  const readToken = await team.getByTestId('api-token-secret').locator('input').inputValue()
  await team.getByRole('button', { name: 'Done' }).click()
  const rows = team.getByTestId('api-token')
  await expect(rows).toHaveCount(2)
  await expect(rows.filter({ hasText: 'Claude — comments' })).toContainText('Comments: read')
  await expect(rows.filter({ hasText: 'Claude — plain' })).not.toContainText('Comments')
  const listed = await api<Array<{ name: string; comments: string }>>(page, 'GET', `/api/workspaces/${wsId}/tokens`)
  expect(listed.json.map((t) => [t.name, t.comments]).sort()).toEqual([
    ['Claude — comments', 'read'],
    ['Claude — plain', 'off'],
  ])

  // what an MCP client gets with each
  const origin = new URL(page.url()).origin
  await expect.poll(async () => (await page.request.get(`/api/v1/pages/${pageId}`, { headers: { authorization: `Bearer ${plainToken}` } })).status()).toBe(200)
  const plain = await mcp(origin, plainToken)
  const reader = await mcp(origin, readToken)
  try {
    const refused = (await plain.callTool({ name: 'one_get_page', arguments: { id: pageId, comments: true } })) as ToolResult
    expect(refused.isError).toBe(true)
    expect(refused.content?.[0]?.text).toMatch(/^comments_off: comments:/)
    const without = (await plain.callTool({ name: 'one_get_page', arguments: { id: pageId } })) as ToolResult
    expect(without.content?.[0]?.text).not.toContain('40k')
    let read: Record<string, any> = {} // eslint-disable-line @typescript-eslint/no-explicit-any
    await expect
      .poll(async () => {
        const r = (await reader.callTool({ name: 'one_get_page', arguments: { id: pageId, format: 'blocks', comments: true } })) as ToolResult
        read = JSON.parse(r.content?.[0]?.text ?? '{}')
        return read.comments?.length ?? 0
      })
      .toBe(1)
    expect(read.comments[0]).toMatchObject({ id: 'th-1', body: 'Is 40k enough?', author: 'Mara Lind', resolved: false, ref: read.blocks[0].ref })
    expect(read.blocks[0].ref).toMatch(/^#rev-00~[0-9a-f]{6}$/)
  } finally {
    await plain.close()
    await reader.close()
  }

  // screenshots of the form (German), when asked for
  const out = process.env.MCP_SHOTS
  if (out) {
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    for (const [w, h, tag] of [
      [1440, 900, 'desktop'],
      [390, 844, 'phone'],
    ] as const) {
      await page.setViewportSize({ width: w, height: h })
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme })
        // by its address: at phone width the sidebar (and its workspace menu) is folded away
        await page.evaluate(() => (location.hash = '#/workspace/automation'))
        const ws = page.getByTestId('workspace-page')
        await expect(ws).toHaveAttribute('data-section', 'automation')
        await ws.getByLabel('Name des Tokens').fill('Tessera MCP')
        await ws.getByTestId('api-token-comments').selectOption('read')
        // the form, its hint and the two tokens below it in one view
        await ws.getByTestId('api-token-comments').evaluate((el) => el.scrollIntoView({ block: 'center' }))
        await page.waitForTimeout(300)
        await page.screenshot({ path: `${out}/token-comments-${tag}-${scheme}.png` })
        await ws.getByLabel('Name des Tokens').fill('')
      }
    }
  }
  expect(errors).toEqual([])
})
