/**
 * Inbox in a team workspace (features/inbox): Ada @mentions Bob, adds him to a person property and
 * replies to his comment — Bob's inbox shows each once; Bob's own changes never become items.
 */
import type { Page } from '@playwright/test'
import { test, expect, api, email, signIn, newPerson, openApp, waitForApp, wsEval, cloudEval, waitOnline, gotoPage, editorOf, createWorkspace, join } from './fixtures'

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

type Item = { id: string; kind: string; pageId: string; actor?: string; excerpt?: string; read?: boolean }
const items = (p: Page) => p.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __oneInbox: { data: () => { items: Item[] } } }).__oneInbox.data().items)) as Item[])

test('team inbox: mention, assignment and reply reach the person they concern — once, and never their own', async ({ page: a, context }) => {
  await person(a, 'Ada')
  const wsId = await createWorkspace(a, 'Inbox team')
  const b = await newPerson(context)
  const bobId = await person(b, 'Bob')
  await join(a, b, wsId)
  await openApp(a, wsId)
  await waitOnline(a)
  await openApp(b, wsId)
  await waitOnline(b)
  await expect.poll(() => wsEval(a, (s) => s.people.map((p: { name: string }) => p.name).sort())).toEqual(['Ada', 'Bob'])
  // Bob's first scan is the baseline
  await expect.poll(() => b.evaluate(() => (window as unknown as { __oneInbox: { isBooted: () => boolean } }).__oneInbox.isBooted())).toBe(true)
  expect(await items(b)).toEqual([])

  // --- Ada @mentions Bob in a new page (typed: "@Bo" + Enter)
  const pageId = await wsEval(a, (s) => s.createPage({ title: 'Launch plan' }))
  await gotoPage(a, pageId)
  await editorOf(a, pageId).click()
  await a.keyboard.type('Numbers by Friday, @Bo')
  await expect(a.locator('.suggest-menu [role="option"]', { hasText: 'Bob' })).toBeVisible()
  await a.keyboard.press('Enter')
  await a.keyboard.type('please check.')
  await expect(editorOf(a, pageId).locator('.mention--person')).toHaveText('@Bob')

  await expect.poll(() => items(b), { timeout: 20_000 }).toEqual([expect.objectContaining({ kind: 'mention', pageId, excerpt: expect.stringMatching(/^Numbers by Friday, @Bob/) })])
  await expect(b.getByTestId('inbox-unread')).toHaveText('01')

  // more typing in the same paragraph is not a new mention
  await a.keyboard.type(' Thanks!')
  await a.waitForTimeout(2500)
  expect((await items(b)).filter((i) => i.kind === 'mention')).toHaveLength(1)

  // --- Ada adds Bob to a person property of a row
  const { dbId, rowId } = await wsEval(
    a,
    (s, bobId) => {
      const dbId = s.createDatabase({ title: 'Tasks', properties: [{ id: 'pName', name: 'Name', type: 'title' }, { id: 'pOwner', name: 'Owner', type: 'person' }] })
      const rowId = s.createRow(dbId, { title: 'Write release notes' })
      return { dbId, rowId, bobId }
    },
    bobId,
  )
  await expect.poll(() => wsEval(b, (s, id) => !!s.pages[id], rowId), { timeout: 20_000 }).toBe(true)
  await b.waitForTimeout(800)
  await wsEval(a, (s, x) => s.setRowProperty(x.rowId, 'pOwner', [x.bobId]), { rowId, bobId })
  await expect.poll(async () => (await items(b)).filter((i) => i.kind === 'assigned').map((i) => [i.pageId, i.excerpt]), { timeout: 20_000 }).toEqual([[rowId, 'Owner']])

  // Bob adds himself to another row: his own change, no item
  const row2 = await wsEval(a, (s, dbId) => s.createRow(dbId, { title: 'Book the venue' }), dbId)
  await expect.poll(() => wsEval(b, (s, id) => !!s.pages[id], row2), { timeout: 20_000 }).toBe(true)
  await wsEval(b, (s, x) => s.setRowProperty(x.row2, 'pOwner', [x.bobId]), { row2, bobId })
  await b.waitForTimeout(1500)
  expect((await items(b)).filter((i) => i.kind === 'assigned')).toHaveLength(1)

  // --- Bob starts a thread; Ada replies → Bob gets the reply (his own reply is no news)
  const threadId = await wsEval(b, (s, id) => s.addComment(id, { quote: 'Numbers by Friday', body: 'Which numbers?' }), pageId)
  await expect.poll(() => wsEval(a, (s, x) => s.pages[x.pageId].comments?.some((c: { id: string }) => c.id === x.threadId) ?? false, { pageId, threadId }), { timeout: 20_000 }).toBe(true)
  await wsEval(a, (s, x) => s.addCommentReply(x.pageId, x.threadId, 'Q3 revenue and churn'), { pageId, threadId })
  await expect.poll(async () => (await items(b)).filter((i) => i.kind === 'comment').map((i) => [i.actor, i.excerpt]), { timeout: 20_000 }).toEqual([['Ada', 'Q3 revenue and churn']])
  await wsEval(b, (s, x) => s.addCommentReply(x.pageId, x.threadId, 'Thanks'), { pageId, threadId })
  await b.waitForTimeout(1500)
  expect((await items(b)).filter((i) => i.kind === 'comment')).toHaveLength(1)

  // Ada took part in the thread: Bob's "Thanks" is her news (and nothing else is)
  await expect.poll(async () => (await items(a)).map((i) => i.kind), { timeout: 20_000 }).toEqual(['comment'])

  // --- Bob's inbox view
  await b.evaluate(() => (window.location.hash = '#/inbox'))
  await expect(b.locator('#main .ibx-item')).toHaveCount(3)
  await expect(b.locator('#main .ibx-note')).toHaveCount(0)
  await expect(b.getByTestId('inbox-unread')).toHaveText('03')
  await b.getByRole('tab', { name: /Mentions/ }).click()
  await expect(b.locator('#main .ibx-item__line')).toHaveText([/^Numbers by Friday, @Bob/])
  await b.locator('#main .ibx-item__open').first().click()
  await expect(b).toHaveURL(new RegExp(`#/p/${pageId}`))
  await expect(b.getByTestId('inbox-unread')).toHaveText('02')

  // a reload keeps it: no new items from the snapshot, read state stays
  await b.reload()
  await waitForApp(b)
  await expect.poll(() => cloudEval(b, (c) => c.status as string), { timeout: 20_000 }).toBe('online')
  await b.waitForTimeout(2000)
  expect((await items(b)).map((i) => [i.kind, !!i.read]).sort()).toEqual([['assigned', false], ['comment', false], ['mention', true]])
})
