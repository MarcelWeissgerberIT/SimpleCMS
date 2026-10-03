/**
 * Seams between features in a team workspace (adversarial review): each test here failed before its fix.
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

type Item = { id: string; kind: string; pageId: string }
const items = (p: Page) => p.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __oneInbox: { data: () => { items: Item[] } } }).__oneInbox.data().items)) as Item[])

test('an @mention inside a synced block is one inbox item, not one per page that shows the block', async ({ page: a, context }) => {
  await person(a, 'Ada')
  const wsId = await createWorkspace(a, 'Synced mentions')
  const b = await newPerson(context)
  const bobId = await person(b, 'Bob')
  await join(a, b, wsId)
  await openApp(a, wsId)
  await waitOnline(a)
  await openApp(b, wsId)
  await waitOnline(b)
  await expect.poll(() => wsEval(a, (s) => s.people.map((p: { name: string }) => p.name).sort())).toEqual(['Ada', 'Bob'])
  await expect.poll(() => b.evaluate(() => (window as unknown as { __oneInbox: { isBooted: () => boolean } }).__oneInbox.isBooted())).toBe(true)

  // Ada: an original with "@Bob" on one page, references to it on two more
  const ids = await wsEval(
    a,
    (s, bobId) => {
      const block = (source: string | null) => ({
        type: 'syncedBlock',
        attrs: { syncId: 'review-mention', sourcePageId: source },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Owner of the launch: ' }, { type: 'mention', attrs: { id: bobId, label: 'Bob', kind: 'person' } }] }],
      })
      const page = (title: string, source: string | null) => {
        const id = s.createPage({ title })
        s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: title }] }, block(source)] }, 'e2e')
        return id
      }
      const origin = page('Launch brief', null)
      return [origin, page('Team home', origin), page('Weekly sync', origin)]
    },
    bobId,
  )
  // Bob has all three pages with their content …
  await expect.poll(() => wsEval(b, (s, ids) => ids.every((id: string) => (s.pages[id]?.plain ?? '').includes('@Bob')), ids), { timeout: 20_000 }).toBe(true)
  // … and one mention: at the original
  await expect.poll(async () => (await items(b)).filter((i) => i.kind === 'mention').length, { timeout: 20_000 }).toBe(1)
  await b.waitForTimeout(2500)
  expect((await items(b)).filter((i) => i.kind === 'mention').map((i) => i.pageId)).toEqual([ids[0]])
})
