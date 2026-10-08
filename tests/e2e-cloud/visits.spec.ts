/**
 * RECENT | FREQUENT and ⌘K filters in a team workspace, against the real server (shell/lib/visits.ts,
 * shell/palette): noteVisit counts into this device's `one.shell.visits:cloud:<ws>` — never the local
 * workspace's key —, FREQUENT lists the shared and the private page (with its lock) and follows the
 * workspace when the app switches between the local and the team workspace; ⌘K `is:private`, `@me`,
 * `by:me` / `by:<member>` mean the signed-in member's account; another member's `is:private` never lists
 * Ada's private page.
 */
import type { Cookie, Page } from '@playwright/test'
import { test, expect, api, email, signIn, newPerson, openApp, waitForApp, wsEval, cloudEval, waitOnline, gotoPage, createWorkspace, join } from './fixtures'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const LOCAL_KEY = 'one.shell.visits:local:local'
const cloudKey = (ws: string) => `one.shell.visits:cloud:${ws}`

/* Browser errors fail the test (a socket that reconnects after the clock jumped is expected). */
const errors: string[] = []
const EXPECTED = [/WebSocket connection to .* failed/, /WebSocket is closed before the connection is established/]
const watched = new WeakSet<Page>()
function watch(p: Page, who: string) {
  if (watched.has(p)) return
  watched.add(p)
  p.on('pageerror', (e) => errors.push(`${who} pageerror: ${e.message}`))
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${who} console.error: ${m.text()}`)
  })
  p.on('response', (r) => {
    if (r.status() >= 400) errors.push(`${who} ${r.request().method()} ${new URL(r.url()).pathname} → ${r.status()}`)
  })
}
test.beforeEach(() => {
  errors.length = 0
})
test.afterEach(() => {
  expect.soft(errors.filter((e) => !EXPECTED.some((re) => re.test(e))), 'browser errors').toEqual([])
})

const accounts = new Map<string, Cookie[]>()
async function person(page: Page, name: string): Promise<void> {
  watch(page, name)
  const known = accounts.get(name)
  if (known) {
    await page.context().addCookies(known)
    await page.goto('/app/')
  } else {
    await signIn(page, email(name))
    await api(page, 'PATCH', '/api/me', { name: name[0].toUpperCase() + name.slice(1) })
    accounts.set(name, (await page.context().cookies()).filter((c) => c.name === 'one_session'))
  }
}

const userId = (p: Page) => cloudEval(p, (c) => c.user.id as string)
const visitsOf = (p: Page, key: string) =>
  p.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as { e: Record<string, [number, number, number]> }).e : null
  }, key)
const section = (p: Page) => p.getByTestId('visited-section')
const rows = (p: Page) => section(p).locator('[role="tabpanel"] .sb-row')
const rowTitles = async (p: Page) => (await rows(p).locator('.sb-row__title').allInnerTexts()).sort()

/** Reload into another workspace with the app's own switch (cloud/index.ts switchWorkspace). */
async function switchTo(p: Page, ref: { kind: 'local' | 'cloud'; id: string }) {
  await Promise.all([p.waitForEvent('load'), p.evaluate((ref) => (window as any).__one.cloud.switchWorkspace(ref), ref)]) // eslint-disable-line @typescript-eslint/no-explicit-any
  await waitForApp(p)
  await expect.poll(() => cloudEval(p, (c) => `${c.active.kind}:${c.active.id}`)).toBe(`${ref.kind}:${ref.id}`)
}

async function find(p: Page, query: string): Promise<string[]> {
  await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await p.keyboard.press(`${mod}+k`)
  const pal = p.getByRole('dialog', { name: 'Command palette' })
  await expect(pal.getByRole('combobox')).toBeFocused()
  await p.keyboard.type(query)
  // every filter became a chip
  await expect(pal.locator('.pal-chips .pal-chip')).toHaveCount(query.trim().split(/\s+/).length)
  await expect(pal.locator('.pal-item--page').or(pal.locator('.pal-empty')).first()).toBeVisible()
  const out = (await pal.locator('.pal-item--page .pal-item__title').allInnerTexts()).sort()
  await p.keyboard.press('Escape')
  await expect(pal).toBeHidden()
  return out
}

test.describe('team cloud — recent / frequent and ⌘K filters', () => {
  test('visits stay per workspace on this device; ⌘K is:private, @me and by:me mean the member', async ({ page: a, context }) => {
    await person(a, 'ada')
    const wsId = await createWorkspace(a, 'Visits')
    const b = await newPerson(context)
    await person(b, 'bob')
    await join(a, b, wsId, 'member')

    // the local workspace has its own FREQUENT (a seeded page this device opened often)
    await openApp(a)
    expect(await cloudEval(a, (c) => c.active.kind)).toBe('local')
    const reading = await wsEval(a, (s) => (Object.values(s.pages) as Array<{ id: string; title: string }>).find((p) => p.title === 'Reading list')!.id)
    await a.evaluate(({ key, id }) => localStorage.setItem(key, JSON.stringify({ v: 1, e: { [id]: [3, Date.now(), 3] } })), { key: LOCAL_KEY, id: reading })
    const localBefore = await a.evaluate((key) => localStorage.getItem(key), LOCAL_KEY)

    // into the team workspace with a clock the test moves (a visit counts after 1.5 s; a return after 2 min)
    await a.clock.install()
    await switchTo(a, { kind: 'cloud', id: wsId })
    await waitOnline(a)
    await openApp(b, wsId)
    await waitOnline(b)
    const ada = await userId(a)
    const bob = await userId(b)
    await expect.poll(() => wsEval(a, (s, id) => s.people.some((p: { id: string }) => p.id === id), bob), { timeout: 20_000 }).toBe(true)
    // the local workspace's visit list never shows here
    await expect(section(a)).toHaveCount(0)

    const shared = await wsEval(a, (s) => s.createPage({ title: 'Team handbook' }))
    const secret = await a.evaluate(() => (window as any).__one.cloud.createPrivatePage({ title: 'Ada private notes' })) // eslint-disable-line @typescript-eslint/no-explicit-any
    const ids = await wsEval(
      a,
      (s, x) => {
        const dbId = s.createDatabase({
          title: 'Tasks',
          properties: [
            { id: 'pName', name: 'Name', type: 'title' },
            { id: 'pWho', name: 'Assignee', type: 'person' },
          ],
        })
        const adaRow = s.createRow(dbId, { title: 'Ada task', properties: { pWho: [x.ada] } })
        const bobRow = s.createRow(dbId, { title: 'Bob task', properties: { pWho: [x.bob] } })
        return { dbId, adaRow, bobRow }
      },
      { ada, bob },
    )
    await expect.poll(() => wsEval(b, (s, id) => !!s.pages[id], ids.bobRow), { timeout: 20_000 }).toBe(true)
    // Bob writes a page of his own
    const bobNotes = await wsEval(b, (s) => s.createPage({ title: 'Bob notes' }))
    await expect.poll(() => wsEval(a, (s, id) => s.pages[id]?.createdBy ?? null, bobNotes), { timeout: 20_000 }).toBe(bob)

    // two occasions on each page (another page counted in between, more than RETURN_MS later)
    const stay = async (id: string) => {
      await gotoPage(a, id)
      await a.clock.runFor(1700)
    }
    await stay(shared)
    await stay(secret)
    await a.clock.fastForward('03:00')
    await stay(shared)
    await stay(secret)
    await gotoPage(a, ids.adaRow)
    await waitOnline(a)

    const visits = await visitsOf(a, cloudKey(wsId))
    expect(visits?.[shared]?.[2]).toBeGreaterThanOrEqual(2)
    expect(visits?.[secret]?.[2]).toBeGreaterThanOrEqual(2)
    // the local workspace's key: untouched
    expect(await a.evaluate((key) => localStorage.getItem(key), LOCAL_KEY)).toBe(localBefore)

    // FREQUENT: both pages, the private one with its lock
    await section(a).getByRole('tab', { name: 'Frequent' }).click()
    await expect.poll(() => rowTitles(a)).toEqual(['Ada private notes', 'Team handbook'])
    await expect(rows(a).filter({ hasText: 'Ada private notes' }).locator('.sb-row__lock')).toHaveCount(1)
    await expect(rows(a).filter({ hasText: 'Team handbook' }).locator('.sb-row__lock')).toHaveCount(0)

    // ⌘K in the team workspace
    expect(await find(a, 'is:private ')).toEqual(['Ada private notes'])
    expect(await find(a, '@me ')).toEqual(['Ada task'])
    expect(await find(a, '@bob ')).toEqual(['Bob task'])
    const mine = await find(a, 'by:me ')
    expect(mine).toEqual(expect.arrayContaining(['Ada task', 'Bob task', 'Team handbook']))
    expect(mine).not.toContain('Bob notes')
    const bobs = await find(a, 'by:bob ')
    expect(bobs).toContain('Bob notes')
    expect(bobs).not.toContain('Team handbook')

    // Bob: his is:private never lists Ada's private page; his @me is his own row
    expect(await find(b, 'is:private ')).toEqual([])
    expect(await find(b, '@me ')).toEqual(['Bob task'])

    // switching to the local workspace swaps the list (and back)
    await switchTo(a, { kind: 'local', id: 'local' })
    await section(a).getByRole('tab', { name: 'Frequent' }).click()
    await expect.poll(() => rowTitles(a)).toEqual(['Reading list'])
    await switchTo(a, { kind: 'cloud', id: wsId })
    await waitOnline(a)
    await section(a).getByRole('tab', { name: 'Frequent' }).click()
    await expect.poll(() => rowTitles(a)).toEqual(['Ada private notes', 'Team handbook'])
  })
})
