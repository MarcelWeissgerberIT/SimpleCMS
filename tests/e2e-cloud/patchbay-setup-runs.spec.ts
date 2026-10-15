/**
 * The Patchbay's setup lamp 06 against the real team server (fix rest): the runs of a server agent are read once — a
 * read that ended without a list (a refused request, an older server) leaves 06 "could not be read" (next, never busy
 * for good; its key opens the agent page, which reads and polls), and a later change that counts reads them again.
 * Every server, host and name is fictional (tracker, tracker.example.com, Nordlicht).
 */
import type { Page } from '@playwright/test'
import { test, expect, email, signIn, openApp, waitOnline, wsEval, createWorkspace, api } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const TRACKER = { id: 'm-tracker', name: 'tracker', url: 'https://tracker.example.com/mcp', token: '', enabled: true, prompt: '', tools: ['list_items', 'get_item', 'search_items', 'whoami', 'create_item', 'update_item', 'add_comment'], checkedAt: Date.now() }
const PROFILE = { schema: 'one.integration/1', id: 'tracker', name: 'Tracker', match: { name: 'tracker' }, unlocks: ['keys', 'onlyByHand', 'upsert', 'toolAllowList', 'agentState', 'notify'], recipes: [{ kind: 'mirror' }] }

/** Lamp 06's sentence (its message key) for the profile's first set. */
const say6 = (p: Page) => p.evaluate(async () => (await (window as unknown as { __onePatchbaySetup: AnyState }).__onePatchbaySetup.lamps('tracker')).sets[0].lamps[6].say.key as string)
const isRuns = (u: URL) => /\/agent-runs$/.test(u.pathname)

test('lamp 06: a server agent’s runs that could not be read say so — and a later change reads them again', async ({ page }) => {
  await signIn(page, email('mara'))
  const me = (await api<{ user: { id: string } }>(page, 'GET', '/api/me')).json.user.id
  const wsId = await createWorkspace(page, 'Nordlicht Spiegel')
  await page.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
  await openApp(page, wsId)
  await waitOnline(page)
  await wsEval(page, (s, l) => s.updateSettings({ mcpServers: l }), [TRACKER])
  expect(await wsEval(page, (s, p) => s.upsertIntegration(p), PROFILE)).toBe(true)
  const dbId = await wsEval(page, (s) => s.createDatabase({ title: 'Tracker' }) as string)

  let asked = 0
  await page.route(isRuns, (r) => {
    asked++
    return r.abort()
  })
  await wsEval(page, (s, a) => s.upsertAgent(a), {
    id: 'agMirror', name: 'Tracker mirror', instructions: 'x', trigger: { type: 'manual' }, scope: { everything: false, pages: [], databases: [dbId] }, write: 'stage', output: null,
    mcpServers: ['tracker'], runner: 'server', model: null, effort: null, maxRunUsd: 0.5, enabled: false, createdBy: me, updatedBy: me, createdAt: 1, updatedAt: 1, mirrorOf: dbId,
  })
  // the read failed: 06 says so instead of "reading …" for good
  await expect.poll(() => say6(page)).toBe('features.patchbay.lamp.firstRun.unreadable')
  expect(asked).toBeGreaterThanOrEqual(1)

  // the server answers again; a change that counts (a setting) reads once more: no runs yet — start by hand
  await page.unroute(isRuns)
  await page.waitForTimeout(1100)
  await wsEval(page, (s, l) => s.updateSettings({ mcpServers: l }), [{ ...TRACKER, checkedAt: Date.now() }])
  await expect.poll(() => say6(page)).toBe('features.patchbay.lamp.firstRun.start')
})
