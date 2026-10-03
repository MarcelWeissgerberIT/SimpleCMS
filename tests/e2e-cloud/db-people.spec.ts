/**
 * Created by / Last edited by, "Me" filters and locked databases in a team workspace: two people,
 * the real server. (Local behaviour: tests/e2e/db-people.spec.ts.)
 */
import type { Cookie, Page } from '@playwright/test'
import { test, expect, api, email, signIn, newPerson, openApp, wsEval, cloudEval, waitOnline, createWorkspace, join } from './fixtures'

const errors: string[] = []
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
  expect.soft(errors, 'browser errors').toEqual([])
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

const db = (p: Page) => p.locator('#main section.db').first()
const toolbar = (p: Page) => db(p).getByRole('toolbar', { name: 'Database toolbar' })
const userId = (p: Page) => cloudEval(p, (c) => c.user.id as string)

async function openDb(p: Page, id: string) {
  await p.evaluate((id) => (window.location.hash = `#/p/${id}`), id)
  await expect(db(p)).toBeVisible()
}

async function titles(p: Page): Promise<string[]> {
  return db(p)
    .locator('.dbt-body .dbt-row[role="row"]')
    .evaluateAll((rows) => rows.map((r) => (r.querySelector('.dbt-cell--title')?.textContent ?? '').replace(/OPEN|ÖFFNEN/g, '').trim()))
}

/** Names in a row's created_by / last_edited_by cell. */
function actorCell(p: Page, title: string, type: 'created_by' | 'last_edited_by') {
  const row = db(p).locator('.dbt-row[role="row"]', { has: p.locator('.dbt-cell--title', { hasText: new RegExp(`^${title}`) }) })
  return row.locator(`[role="gridcell"][data-type="${type}"] .db-person__name`)
}

test.describe('team cloud — database people', () => {
  test('Created by / Last edited by from the meta document; "Me" shows each member their own rows; the lock syncs', async ({ page: a, context }) => {
    await person(a, 'ada')
    const wsId = await createWorkspace(a, 'People')
    await openApp(a, wsId)
    await waitOnline(a)
    const b = await newPerson(context)
    await person(b, 'bob')
    await join(a, b, wsId)
    await openApp(b, wsId)
    await waitOnline(b)
    const ada = await userId(a)
    const bob = await userId(b)
    // members are mirrored as people (person id = account id)
    await expect.poll(() => wsEval(a, (s, id) => s.people.some((p: { id: string }) => p.id === id), bob), { timeout: 20_000 }).toBe(true)

    // Ada: a database with Assignee, Created by, Last edited by — and two rows
    const ids = await wsEval(
      a,
      (s, x) => {
        const dbId = s.createDatabase({
          title: 'Tasks',
          properties: [
            { id: 'pName', name: 'Name', type: 'title' },
            { id: 'pWho', name: 'Assignee', type: 'person' },
            { id: 'pBy', name: 'Created by', type: 'created_by' },
            { id: 'pEd', name: 'Last edited by', type: 'last_edited_by' },
          ],
        })
        const adaRow = s.createRow(dbId, { title: 'Ada task', properties: { pWho: [x.ada] } })
        const bobRow = s.createRow(dbId, { title: 'Bob task', properties: { pWho: [x.bob] } })
        return { dbId, adaRow, bobRow }
      },
      { ada, bob },
    )
    // this client's own writes are stamped in its store at once
    await expect.poll(() => wsEval(a, (s, id) => [s.pages[id]?.createdBy, s.pages[id]?.updatedBy], ids.adaRow)).toEqual([ada, ada])
    await expect.poll(() => wsEval(b, (s, id) => s.pages[id]?.createdBy ?? null, ids.bobRow), { timeout: 20_000 }).toBe(ada)

    await openDb(a, ids.dbId)
    await openDb(b, ids.dbId)
    for (const p of [a, b]) {
      await expect(actorCell(p, 'Ada task', 'created_by')).toHaveText('Ada')
      await expect(actorCell(p, 'Ada task', 'last_edited_by')).toHaveText('Ada')
    }

    // Bob edits Ada's row → Created by Ada, Last edited by Bob — on both sides
    await wsEval(b, (s, id) => s.updatePage(id, { title: 'Ada task (checked)' }), ids.adaRow)
    await expect.poll(() => wsEval(b, (s, id) => [s.pages[id].createdBy, s.pages[id].updatedBy], ids.adaRow)).toEqual([ada, bob])
    await expect.poll(() => wsEval(a, (s, id) => [s.pages[id].createdBy, s.pages[id].updatedBy], ids.adaRow), { timeout: 20_000 }).toEqual([ada, bob])
    for (const p of [a, b]) {
      await expect(actorCell(p, 'Ada task', 'created_by')).toHaveText('Ada')
      await expect(actorCell(p, 'Ada task', 'last_edited_by')).toHaveText('Bob')
      await expect(actorCell(p, 'Bob task', 'last_edited_by')).toHaveText('Ada')
    }

    // a saved view "Assignee contains Me": each member sees their own row
    await wsEval(a, (s, id) => s.updateView(id, s.databases[id].views[0].id, { filter: { id: 'f', op: 'and', items: [{ id: 'r', propertyId: 'pWho', operator: 'contains', value: '@me' }] } }), ids.dbId)
    await expect.poll(() => titles(a)).toEqual(['Ada task (checked)'])
    await expect.poll(() => titles(b), { timeout: 20_000 }).toEqual(['Bob task'])
    // … and "Last edited by is Me" the other way round
    await wsEval(a, (s, id) => s.updateView(id, s.databases[id].views[0].id, { filter: { id: 'f', op: 'and', items: [{ id: 'r', propertyId: 'pEd', operator: 'is', value: '@me' }] } }), ids.dbId)
    await expect.poll(() => titles(a), { timeout: 20_000 }).toEqual(['Bob task'])
    await expect.poll(() => titles(b), { timeout: 20_000 }).toEqual(['Ada task (checked)'])

    // a viewer joins (reads only)
    const v = await newPerson(context)
    await person(v, 'vic')
    await join(a, v, wsId, 'viewer')
    await openApp(v, wsId)
    await waitOnline(v)
    await openDb(v, ids.dbId)

    // Ada locks the database → Bob and the viewer see the plate; Bob unlocks it with one click
    await toolbar(a).getByRole('button', { name: 'More' }).click()
    await a.getByRole('menuitem', { name: 'Lock database' }).click()
    await expect(toolbar(a).getByTestId('db-locked')).toBeVisible()
    await expect(toolbar(b).getByTestId('db-locked')).toBeVisible({ timeout: 20_000 })
    await expect(db(b).locator('.dbt-hcell--add button')).toHaveCount(0)
    const plate = toolbar(v).getByTestId('db-locked')
    await expect(plate).toBeVisible({ timeout: 20_000 })
    await expect(plate).toHaveJSProperty('tagName', 'SPAN')
    await expect(toolbar(v).getByTestId('db-view-only')).toBeVisible()
    await toolbar(b).getByTestId('db-locked').click()
    await expect(toolbar(b).getByTestId('db-locked')).toHaveCount(0)
    await expect(toolbar(a).getByTestId('db-locked')).toHaveCount(0, { timeout: 20_000 })
    await expect(toolbar(v).getByTestId('db-locked')).toHaveCount(0, { timeout: 20_000 })
    expect(await wsEval(a, (s, id) => s.databases[id].locked, ids.dbId)).toBe(false)
  })
})
