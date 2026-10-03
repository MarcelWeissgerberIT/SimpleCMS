/**
 * Follow-ups of the last review in a team workspace: each test here failed before its fix.
 */
import type { Page } from '@playwright/test'
import { test, expect, api, email, signIn, newPerson, openApp, wsEval, waitOnline, createWorkspace, join } from './fixtures'

const errors: string[] = []
function watch(p: Page, who: string) {
  p.on('pageerror', (e) => errors.push(`${who} pageerror: ${e.message}`))
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${who} console.error: ${m.text()}`)
  })
}
test.afterEach(() => {
  expect.soft(errors, 'browser errors').toEqual([])
  errors.length = 0
})

async function person(page: Page, name: string): Promise<string> {
  watch(page, name)
  await signIn(page, email(name.toLowerCase()))
  await api(page, 'PATCH', '/api/me', { name })
  const me = await api<{ user: { id: string } }>(page, 'GET', '/api/me')
  return me.json.user.id
}

/** Ada (owner) and Bob (member), both online in a new workspace; Bob's inbox has its baseline. */
async function team(a: Page, context: Parameters<typeof newPerson>[0], name: string) {
  await person(a, 'Ada')
  const wsId = await createWorkspace(a, name)
  const b = await newPerson(context)
  const bobId = await person(b, 'Bob')
  await join(a, b, wsId)
  await openApp(a, wsId)
  await waitOnline(a)
  await openApp(b, wsId)
  await waitOnline(b)
  await expect.poll(() => wsEval(a, (s) => s.people.map((p: { name: string }) => p.name).sort())).toEqual(['Ada', 'Bob'])
  await expect.poll(() => b.evaluate(() => (window as unknown as { __oneInbox: { isBooted: () => boolean } }).__oneInbox.isBooted())).toBe(true)
  return { wsId, b, bobId }
}

/** Ada: an original with "@Bob" on "Launch brief", synced copies of it on "Team home" and "Weekly sync". */
function syncedPages(a: Page, bobId: string, syncId: string): Promise<string[]> {
  return wsEval(
    a,
    (s, x) => {
      const block = (source: string | null, tag: string) => ({
        type: 'syncedBlock',
        attrs: { id: `sb-${tag}`, syncId: x.syncId, sourcePageId: source },
        content: [{ type: 'paragraph', attrs: { id: `p-${tag}` }, content: [{ type: 'text', text: 'Owner of the launch: ' }, { type: 'mention', attrs: { id: x.bobId, label: 'Bob', kind: 'person' } }] }],
      })
      const page = (title: string, source: string | null, tag: string) => {
        const id = s.createPage({ title })
        s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', attrs: { id: `t-${tag}` }, content: [{ type: 'text', text: title }] }, block(source, tag)] }, 'e2e')
        return id
      }
      const origin = page('Launch brief', null, 'o')
      return [origin, page('Team home', origin, 'c1'), page('Weekly sync', origin, 'c2')]
    },
    { bobId, syncId },
  )
}

type Item = { id: string; kind: string; pageId: string }
const mentionItems = (p: Page) =>
  p.evaluate(() => (JSON.parse(JSON.stringify((window as unknown as { __oneInbox: { data: () => { items: Item[] } } }).__oneInbox.data().items)) as Item[]).filter((i) => i.kind === 'mention'))

test('moving a synced original to Private: the confirmation says how many copies on workspace pages keep showing it', async ({ page: a, context }) => {
  const { b, bobId } = await team(a, context, 'Synced privacy')
  const ids = await syncedPages(a, bobId, 'followup-private')
  // let the synced index see the original and both copies
  await a.waitForTimeout(1000)

  const row = a.locator('.sb-section').filter({ hasText: 'Pages' }).locator('.sb-row', { hasText: 'Launch brief' })
  await row.hover()
  await row.getByRole('button', { name: 'More' }).click()
  await a.getByRole('menuitem', { name: 'Move to Private' }).click()
  await expect(a.locator('.confirm__title')).toHaveText('Make “Launch brief” private?')
  await expect(a.locator('.confirm__text')).toContainText('Everyone else in Synced privacy loses access')
  await expect(a.locator('.confirm__text')).toContainText('Its synced block keeps showing in 2 copies on workspace pages.')
  await a.getByRole('button', { name: 'Make private' }).click()
  await expect(a.locator('.toast', { hasText: '“Launch brief” is private now.' })).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => wsEval(b, (s, id) => !!s.pages[id], ids[0]), { timeout: 15_000 }).toBe(false)
  // the copies keep the content for Bob
  expect(await wsEval(b, (s, ids) => ids.slice(1).map((id: string) => (s.pages[id]?.plain ?? '').includes('@Bob')), ids)).toEqual([true, true])
  await b.context().close()
})

/** Bob has the three pages with their content, and one mention item: at the original. */
async function oneMention(b: Page, ids: string[]) {
  await expect.poll(() => wsEval(b, (s, ids) => ids.every((id: string) => (s.pages[id]?.plain ?? '').includes('@Bob')), ids), { timeout: 20_000 }).toBe(true)
  await expect.poll(async () => (await mentionItems(b)).length, { timeout: 20_000 }).toBe(1)
  await b.waitForTimeout(1500)
  expect((await mentionItems(b)).map((i) => i.pageId)).toEqual([ids[0]])
}

test('a synced copy that is unsynced: the @mention in it is not news again', async ({ page: a, context }) => {
  const { b, bobId } = await team(a, context, 'Unsynced mentions')
  const ids = await syncedPages(a, bobId, 'followup-unsync')
  await oneMention(b, ids)

  // Ada unsyncs the copy on "Weekly sync": the same text, now normal blocks
  await wsEval(
    a,
    (s, id) => {
      const c = JSON.parse(JSON.stringify(s.pages[id].content))
      c.content = c.content.flatMap((n: { type: string; content: unknown[] }) => (n.type === 'syncedBlock' ? n.content : [n]))
      s.setContent(id, c, 'e2e')
    },
    ids[2],
  )
  await expect.poll(() => wsEval(b, (s, id) => JSON.stringify(s.pages[id].content).includes('syncedBlock'), ids[2]), { timeout: 15_000 }).toBe(false)
  await b.waitForTimeout(2000)
  expect(await mentionItems(b)).toHaveLength(1)
  await b.context().close()
})

test('a synced original leaving the workspace: the @mention in its copies is not news again', async ({ page: a, context }) => {
  const { b, bobId } = await team(a, context, 'Late mentions')
  const ids = await syncedPages(a, bobId, 'followup-late')
  await oneMention(b, ids)

  // Ada takes the original private: Bob no longer has it; the copy on "Team home" changes elsewhere
  await a.evaluate((id) => (window as unknown as { __one: { cloud: { movePagePrivacy: (id: string, p: boolean) => Promise<void> } } }).__one.cloud.movePagePrivacy(id, true), ids[0])
  await expect.poll(() => wsEval(b, (s, id) => !!s.pages[id], ids[0]), { timeout: 15_000 }).toBe(false)
  await wsEval(
    a,
    (s, id) => {
      const c = JSON.parse(JSON.stringify(s.pages[id].content))
      c.content.push({ type: 'paragraph', attrs: { id: 'p-late' }, content: [{ type: 'text', text: 'Agenda for Monday' }] })
      s.setContent(id, c, 'e2e')
    },
    ids[1],
  )
  await expect.poll(() => wsEval(b, (s, id) => s.pages[id]?.plain ?? '', ids[1]), { timeout: 15_000 }).toContain('Agenda for Monday')
  await b.waitForTimeout(2000)
  expect(await mentionItems(b)).toHaveLength(1)
  await b.context().close()
})
