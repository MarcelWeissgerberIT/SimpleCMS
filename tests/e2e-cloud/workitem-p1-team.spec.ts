/**
 * Task block P1 in a team workspace, against the real server:
 *  - the creation gate: GET /api/config answers `schema_min` (the schema gate's minimum); the app creates tasks in a
 *    team workspace only when it is ≥ 1 and the tab may write — a server without the gate (no `schema_min`) or a
 *    viewer's tab shuts it; the last answer is kept per device (localStorage `one.cloud.schemaMin`) for an offline
 *    boot; never heard → shut.
 * (B21 adds: assignments and reminders per member, concurrent field edits on both write paths, private links,
 *  viewer / outdated tabs, Y undo.)
 */
import { test, expect, api, email, signIn, openApp, waitOnline, cloudEval, createWorkspace, newPerson, join } from './fixtures'

const canCreate = (page: import('@playwright/test').Page) => page.evaluate(() => (window as unknown as { __oneItems: { canCreate: () => boolean } }).__oneItems.canCreate())

test.describe('tasks in a team workspace: the creation gate', () => {
  test('schema_min 1 → tasks can be made; a config without it (an older server) or a viewer shuts the gate; the answer is kept per device', async ({ page, context }) => {
    await signIn(page, email('gatemin'))
    const wsId = await createWorkspace(page, 'Gate minimum')
    const cfg = await api<{ schema_min?: number }>(page, 'GET', '/api/config')
    expect(cfg.json.schema_min).toBe(1)

    await openApp(page, wsId)
    await waitOnline(page)
    expect(await cloudEval(page, (c) => c.schemaMin)).toBe(1)
    expect(await canCreate(page)).toBe(true)
    expect(await page.evaluate(() => localStorage.getItem('one.cloud.schemaMin'))).toBe('1')

    // a server without the gate: its config has no schema_min → 0 → no creation (and remembered so)
    await page.route('**/api/config', async (route) => {
      const res = await route.fetch()
      const json = (await res.json()) as Record<string, unknown>
      delete json.schema_min
      await route.fulfill({ response: res, json })
    })
    await openApp(page, wsId)
    await waitOnline(page)
    expect(await cloudEval(page, (c) => c.schemaMin)).toBe(0)
    expect(await canCreate(page)).toBe(false)
    expect(await page.evaluate(() => localStorage.getItem('one.cloud.schemaMin'))).toBe('0')
    await page.unroute('**/api/config')

    // never heard on this device, and the config does not answer (offline boot): shut
    await page.evaluate(() => localStorage.removeItem('one.cloud.schemaMin'))
    await page.route('**/api/config', (route) => route.abort())
    await openApp(page, wsId)
    expect(await cloudEval(page, (c) => c.schemaMin)).toBeNull()
    expect(await canCreate(page)).toBe(false)
    await page.unroute('**/api/config')

    // a viewer's tab never creates one
    const guest = await newPerson(context)
    await signIn(guest, email('viewer'))
    await join(page, guest, wsId, 'viewer')
    await openApp(guest, wsId)
    await waitOnline(guest)
    expect(await cloudEval(guest, (c) => c.schemaMin)).toBe(1)
    expect(await canCreate(guest)).toBe(false)
    await guest.context().close()
  })
})
