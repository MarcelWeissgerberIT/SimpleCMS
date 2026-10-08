/**
 * Integration profiles in a team workspace (against the real server): profiles are workspace data (meta map
 * `integrations`) — an owner's profile reaches every member at once; owners and admins edit, a member reads (no New /
 * Import, View instead of Edit, the store refuses, a list put into the member's store directly is put back and never
 * reaches the others); whether a profile is ACTIVE is decided by each person's own MCP servers; a role change reaches
 * the open tab. The server guard itself (raw Yjs writes from a member, stamping) is server/test/integrations.test.ts.
 * The MCP servers are fictional addresses nobody calls.
 */
import type { Page } from '@playwright/test'
import { test, expect, email, signIn, newPerson, openApp, waitOnline, wsEval, cloudEval, createWorkspace, join, api } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const TRACKER = { id: 'm-tracker', name: 'tracker', url: 'https://tracker.example.com/mcp', token: '', enabled: true, prompt: '', tools: ['list_items', 'get_item', 'whoami', 'update_item'], checkedAt: Date.now() }

async function openSection(page: Page) {
  await page.evaluate(() => (location.hash = '#/workspace/integrations'))
  await expect(page.getByTestId('ws-integrations')).toBeVisible()
}
const row = (page: Page, id: string) => page.locator(`[data-testid="int-row"][data-id="${id}"]`)
const ids = (page: Page) => wsEval(page, (s) => (s.integrations ?? []).map((p: AnyState) => `${p.id}:${p.name}`))

test('owners and admins edit integration profiles for everyone; a member reads them; activity depends on each device', async ({ page, context }) => {
  await signIn(page, email('ada'))
  const wsId = await createWorkspace(page, 'Integration Team')
  const member = await newPerson(context)
  await signIn(member, email('mo'))
  await join(page, member, wsId, 'member')
  const moId = (await api<{ user: { id: string } }>(member, 'GET', '/api/me')).json.user.id
  const adaId = (await api<{ user: { id: string } }>(page, 'GET', '/api/me')).json.user.id

  // the owner adds a profile from her tested server
  await openApp(page, wsId)
  await waitOnline(page)
  await wsEval(page, (s, server) => s.updateSettings({ mcpServers: [server] }), TRACKER)
  await openSection(page)
  await page.getByTestId('int-new').click()
  await page.getByRole('menuitem', { name: /TRACKER/ }).click()
  await expect(page.locator('.int-editor').getByTestId('int-editor-status')).toContainText('Valid · active here (matches TRACKER)')
  await page.locator('.int-editor').getByTestId('int-save').click()
  await expect(row(page, 'tracker').getByTestId('int-status')).toHaveText('Active · matches TRACKER')
  await expect.poll(() => wsEval(page, (s) => s.integrations[0]?.updatedBy ?? null)).toBe(adaId)

  // the member gets it — inactive on his device (no MCP server of his own), read only
  await openApp(member, wsId)
  await waitOnline(member)
  await expect.poll(() => ids(member), { timeout: 15_000 }).toEqual(['tracker:Integration for tracker'])
  await openSection(member)
  await expect(row(member, 'tracker').getByTestId('int-status')).toHaveText('Inactive · no enabled MCP server matches')
  await expect(member.getByTestId('int-readonly')).toBeVisible()
  await expect(member.getByTestId('int-new')).toHaveCount(0)
  await expect(member.getByTestId('int-import')).toHaveCount(0)
  await expect(row(member, 'tracker').getByRole('button', { name: /^Delete/ })).toHaveCount(0)
  await row(member, 'tracker').getByRole('button', { name: /^View/ }).click()
  await expect(member.locator('.int-editor').getByTestId('jca-input')).toHaveAttribute('readonly', '')
  await expect(member.locator('.int-editor').getByTestId('int-save')).toHaveCount(0)
  await member.keyboard.press('Escape')
  // the store refuses; a list written into his store directly is put back and never reaches the owner
  expect(await wsEval(member, (s) => s.upsertIntegration({ schema: 'one.integration/1', id: 'sneaky', name: 'Sneaky', match: { name: '*' }, unlocks: ['upsert'] }))).toBe(false)
  expect(await wsEval(member, (s) => s.deleteIntegration('tracker'))).toBe(false)
  await member.evaluate(() => (window as unknown as { __one: { workspace: { setState: (p: object) => void } } }).__one.workspace.setState({ integrations: [] }))
  await expect.poll(() => ids(member)).toEqual(['tracker:Integration for tracker'])
  await page.waitForTimeout(500)
  expect(await ids(page)).toEqual(['tracker:Integration for tracker'])

  // the same server on his device: active for him too — the recipe appears in his gallery
  await wsEval(member, (s, server) => s.updateSettings({ mcpServers: [server] }), TRACKER)
  await expect(row(member, 'tracker').getByTestId('int-status')).toHaveText('Active · matches TRACKER')
  await member.evaluate(() => (location.hash = '#/agents'))
  await expect(member.locator('[data-recipe="tracker:mirror"]')).toBeVisible()

  // promoted to admin: editable at once; his save reaches the owner, stamped with his id
  expect((await api(page, 'PATCH', `/api/workspaces/${wsId}/members/${moId}`, { role: 'admin' })).status).toBe(200)
  await expect.poll(() => cloudEval(member, (c) => ({ role: c.role, status: c.status }))).toEqual({ role: 'admin', status: 'online' })
  await openSection(member)
  await expect(member.getByTestId('int-new')).toBeVisible()
  await row(member, 'tracker').getByRole('button', { name: /^Edit/ }).click()
  const area = member.locator('.int-editor').getByTestId('jca-input')
  await area.fill((await area.inputValue()).replace('"name": "Integration for tracker"', '"name": "Team tracker"'))
  await member.locator('.int-editor').getByTestId('int-save').click()
  await expect.poll(() => ids(page)).toEqual(['tracker:Team tracker'])
  await expect.poll(() => wsEval(page, (s) => s.integrations[0]?.updatedBy ?? null)).toBe(moId)

  // the owner deletes it: gone for everyone
  await row(page, 'tracker').getByRole('button', { name: 'Delete: Team tracker' }).click()
  await expect.poll(() => ids(member)).toEqual([])
  await member.context().close()
})
