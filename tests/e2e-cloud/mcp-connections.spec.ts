/**
 * MCP · Connections (#/mcp) in a team workspace — § 04 TEAM SERVER: the workspace's /mcp address (the same for every
 * member; copied with a key), the server agents' MCP servers as the runtime says (names, hosts, "Set" — never a token
 * or its last 4), read from the team server only on "Read from the team server" (opening the page asks nothing),
 * "API tokens ↗" → Workspace › Automation. A member sees the same address and the note that owners / admins make tokens.
 * § 01 counts only the agents whose runs happen in this browser: another member's browser agent is theirs.
 * Made-up names only (nordlicht, tracker, mcp.example.com).
 */
import type { Page } from '@playwright/test'
import { test, expect, api, signIn, email, createWorkspace, join, newPerson, openApp, waitOnline, wsEval, cloudEval } from './fixtures'

const SRV_TOKEN = 'srv-e2e-token-nordlicht-000000Kp9t'

/** Requests to the agent runtime and the API tokens from now on. */
function watchReads(page: Page): string[] {
  const seen: string[] = []
  page.on('request', (r) => {
    if (/\/agent-runtime|\/tokens(\b|\?|$)/.test(r.url())) seen.push(`${r.method()} ${new URL(r.url()).pathname}`)
  })
  return seen
}

test.describe('MCP · Connections — the team server (§ 04)', () => {
  test('owner: the /mcp address, Copy, nothing read on open, the runtime on a press (Set, no last 4), API tokens ↗', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await signIn(page, email('ada'))
    const wsId = await createWorkspace(page, 'Nordlicht Studio')
    const put = await api(page, 'PUT', `/api/workspaces/${wsId}/agent-runtime`, { mcpServers: [{ name: 'nordlicht', url: 'https://mcp.example.com/mcp', token: SRV_TOKEN }] })
    expect(put.status).toBeLessThan(300)
    await openApp(page, wsId)
    await waitOnline(page)
    const me = await cloudEval(page, (c) => c.user.id as string)
    await wsEval(
      page,
      (s, a) =>
        s.upsertAgent({ id: 'ag-night', name: 'Night digest', instructions: 'Sum up the day.', trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: 'stage', output: null, mcpServers: ['nordlicht'], runner: 'server', model: null, effort: null, maxRunUsd: 0.5, enabled: true, createdBy: a.me, updatedBy: a.me, createdAt: 1, updatedAt: 1 }),
      { me },
    )

    const reads = watchReads(page)
    await page.evaluate(() => (window.location.hash = '#/mcp'))
    const team = page.getByTestId('mcpc-team')
    await expect(team).toBeVisible()
    await expect(page.getByTestId('mcpc-team-scope')).toHaveText('Team server')
    const origin = new URL(page.url()).origin
    await expect(page.getByTestId('mcpc-endpoint')).toHaveText(`${origin}/mcp`)
    await expect(page.getByTestId('mcpc-endpoint-row')).not.toContainText('Only owners and admins')
    await expect(page.getByTestId('mcpc-readout').locator('[data-cell="team"]')).toContainText('/mcp')
    await expect(page.getByTestId('mcpc-srv-row')).toContainText('Not read in this tab yet.')
    await page.waitForTimeout(1000)
    expect(reads).toEqual([])

    // Copy address
    await page.getByTestId('mcpc-endpoint-copy').click()
    await expect(page.locator('.toast', { hasText: 'Copied' })).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${origin}/mcp`)

    // Read from the team server (by keyboard): one GET, the server listed as "Set", never its token or last 4; the key
    // goes once read — the keyboard lands on the row's Settings ↗, never on the page body
    await page.getByTestId('mcpc-srv-read').focus()
    await page.keyboard.press('Enter')
    const item = page.getByTestId('mcpc-srv-list').locator('[data-server="nordlicht"]')
    await expect(item).toContainText('nordlicht')
    await expect(item).toContainText('mcp.example.com')
    await expect(item).toContainText('Set')
    await expect(item).toContainText('used by Night digest')
    expect(reads).toEqual([`GET /api/workspaces/${wsId}/agent-runtime`])
    const html = await page.content()
    expect(html).not.toContain(SRV_TOKEN)
    expect(html).not.toContain(SRV_TOKEN.slice(-4))
    await expect(page.getByTestId('mcpc-srv-read')).toHaveCount(0)
    await expect.poll(() => page.getByTestId('mcpc-srv-settings').evaluate((el) => el === document.activeElement)).toBe(true)

    // API tokens ↗ → Workspace › Automation
    await page.getByTestId('mcpc-endpoint-tokens').click()
    await expect(page).toHaveURL(/#\/workspace\/automation$/)
  })

  test('member: the same address, the owners-only note; the runtime read works for members too', async ({ page, context }) => {
    await signIn(page, email('ada'))
    const wsId = await createWorkspace(page, 'Nordlicht Studio')
    await api(page, 'PUT', `/api/workspaces/${wsId}/agent-runtime`, { mcpServers: [{ name: 'nordlicht', url: 'https://mcp.example.com/mcp', token: SRV_TOKEN }] })
    const bo = await newPerson(context)
    await signIn(bo, email('bo'))
    await join(page, bo, wsId, 'member')
    await openApp(bo, wsId, '#/mcp')
    await waitOnline(bo)
    const reads = watchReads(bo)
    await expect(bo.getByTestId('mcpc-team')).toBeVisible()
    const origin = new URL(bo.url()).origin
    await expect(bo.getByTestId('mcpc-endpoint')).toHaveText(`${origin}/mcp`)
    await expect(bo.getByTestId('mcpc-endpoint-row')).toContainText('Only owners and admins create API tokens')
    await bo.waitForTimeout(800)
    expect(reads).toEqual([])
    await bo.getByTestId('mcpc-srv-read').click()
    // whatever the server answers members: the list, or the forbidden note — never a token
    await expect(bo.getByTestId('mcpc-srv-row')).toHaveAttribute('data-state', /^(ready|forbidden)$/)
    expect(reads).toHaveLength(1)
    expect(await bo.content()).not.toContain(SRV_TOKEN)
    await bo.context().close()
  })

  test('another member’s browser agent runs in their browser: no chip under my server, no "not set up" line here', async ({ page: ada, context }) => {
    await signIn(ada, email('ada'))
    const wsId = await createWorkspace(ada, 'Nordlicht Studio')
    const bo = await newPerson(context)
    await signIn(bo, email('bo'))
    await join(ada, bo, wsId, 'member')
    for (const p of [ada, bo]) {
      await openApp(p, wsId)
      await waitOnline(p)
    }
    const boId = await cloudEval(bo, (c) => c.user.id as string)
    // Ada's device has nordlicht; Bo saves a browser agent naming nordlicht and tracker (it runs in Bo's browser only)
    await wsEval(ada, (s) => s.updateSettings({ mcpServers: [{ id: 'srv-nord', name: 'nordlicht', url: 'https://mcp.example.com/mcp', token: '', enabled: true, prompt: '', checkedAt: Date.now() }] }))
    await wsEval(
      bo,
      (s, me) =>
        s.upsertAgent({ id: 'ag-triage', name: 'Triage', instructions: 'Sort new items.', trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: 'none', output: null, mcpServers: ['nordlicht', 'tracker'], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: true, createdBy: me, updatedBy: me, createdAt: 1, updatedAt: 1 }),
      boId,
    )
    await expect.poll(() => wsEval(ada, (s) => s.agents?.['ag-triage']?.createdBy ?? null), { timeout: 20_000 }).toBe(boId)

    await ada.evaluate(() => (window.location.hash = '#/mcp'))
    const nord = ada.locator('[data-row="one"][data-server="nordlicht"]')
    await expect(nord).toBeVisible()
    await expect(nord.locator('[data-fact="agents"]')).toHaveCount(0)
    await expect(ada.getByTestId('mcpc-missing')).toHaveCount(0)

    // Bo's own page: his agent's servers this device lacks (both), "them"
    await bo.evaluate(() => (window.location.hash = '#/mcp'))
    await expect(bo.getByTestId('mcpc-missing')).toHaveText('Named by agents, not set up on this device: nordlicht (Triage) · tracker (Triage) — their runs leave them out.')
    await bo.context().close()
  })
})
