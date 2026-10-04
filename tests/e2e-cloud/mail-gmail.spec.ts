/**
 * Gmail → Mails database in a TEAM workspace (features/mail), against the real server: the database is
 * created in the member's Private section (rows too) and never reaches a teammate; moved to the
 * workspace, the next sync pauses instead of writing mails into the shared space.
 *
 * Gmail is mocked (gmail.googleapis.com, an in-memory mailbox). The team server's CSP keeps Google's
 * sign-in script out of this build (script-src 'self'), so the token comes through the app's test hook.
 */
import type { Page, Route } from '@playwright/test'
import { test, expect, email, signIn, newPerson, openApp, wsEval, waitOnline, createWorkspace, join } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const ACCOUNT = 'ada@example.com'
const DAY = 86_400_000
const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** A tiny read-only Gmail: profile, labels, list, get, history. */
function gmail(mails: Array<{ id: string; subject: string; text: string; date: number }>) {
  let historyId = 5000
  const calls: string[] = []
  const handle = async (route: Route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': 'authorization, accept', 'access-control-allow-methods': 'GET' } })
    const url = new URL(req.url())
    const path = url.pathname.replace('/gmail/v1/users/me/', '')
    calls.push(path)
    const json = (status: number, body: unknown) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (!((await req.allHeaders()).authorization ?? '').startsWith('Bearer ya29.')) return json(401, { error: { code: 401 } })
    if (path === 'profile') return json(200, { emailAddress: ACCOUNT, historyId: String(historyId) })
    if (path === 'labels') return json(200, { labels: [{ id: 'INBOX', name: 'INBOX', type: 'system' }] })
    if (path === 'messages') return json(200, { messages: mails.map((m) => ({ id: m.id, threadId: m.id })) })
    if (path === 'history') return json(200, { history: [], historyId: String(historyId) })
    const m = mails.find((x) => path === `messages/${x.id}`)
    if (!m) return json(404, { error: { code: 404 } })
    return json(200, {
      id: m.id,
      threadId: m.id,
      labelIds: ['INBOX'],
      internalDate: String(m.date),
      payload: {
        mimeType: 'text/plain',
        filename: '',
        headers: [
          { name: 'Subject', value: m.subject },
          { name: 'From', value: 'Partner <partner@example.test>' },
          { name: 'To', value: ACCOUNT },
          { name: 'Content-Type', value: 'text/plain; charset=UTF-8' },
        ],
        body: { size: m.text.length, data: b64url(m.text) },
      },
    })
  }
  return { handle, calls, bump: () => historyId++ }
}

const errors: string[] = []
function watch(p: Page, who: string) {
  p.on('pageerror', (e) => errors.push(`${who} pageerror: ${e.message}`))
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${who} console.error: ${m.text()}`)
  })
}
test.beforeEach(() => {
  errors.length = 0
})
test.afterEach(() => {
  expect.soft(errors, 'browser errors').toEqual([])
})

const syncNow = async (p: Page) => {
  await p.evaluate(() => (window as unknown as { __oneMail: { sync: () => Promise<void> } }).__oneMail.sync())
}
const mailState = (p: Page) => p.evaluate(() => (window as unknown as { __oneMail: { state: () => AnyState } }).__oneMail.state())

test('team workspace: the Mails database and its rows are PRIVATE; moved into the workspace, the sync pauses', async ({ page: a, context }) => {
  watch(a, 'ada')
  const box = gmail([
    { id: 'g1', subject: 'Contract draft', text: 'Confidential terms for Ada only.', date: Date.now() - DAY },
    { id: 'g2', subject: 'Dinner Friday?', text: 'Personal note.', date: Date.now() - 2 * DAY },
  ])
  await a.route('https://gmail.googleapis.com/**', box.handle)

  await signIn(a, email('ada'))
  const wsId = await createWorkspace(a, 'Mail team')
  const b = await newPerson(context)
  watch(b, 'bob')
  await signIn(b, email('bob'))
  await join(a, b, wsId, 'member')
  await openApp(a, wsId)
  await waitOnline(a)
  await openApp(b, wsId)
  await waitOnline(b)

  // a shared page as parent is never used: the database goes to Ada's Private section
  const shared = await wsEval(a, (s) => s.createPage({ title: 'Team inbox' }))
  await wsEval(
    a,
    (s, parentId) =>
      s.updateSettings({ mail: { clientId: '123456789012-cloude2eclient0001.apps.googleusercontent.com', from: new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10), parentId } }),
    shared,
  )
  await a.evaluate((acc) => (window as unknown as { __oneMail: { setToken: (v: string, a: string) => void } }).__oneMail.setToken('ya29.cloud-e2e-token', acc), ACCOUNT)
  await syncNow(a)
  await expect.poll(async () => (await mailState(a)).phase).toBe('idle')
  expect((await mailState(a)).error).toBeNull()

  const dbId = await wsEval(a, (s) => s.settings.mail.databaseId as string)
  const info = await wsEval(
    a,
    (s, dbId) => ({
      private: !!s.pages[dbId]?.private,
      parentId: s.pages[dbId]?.parentId ?? null,
      rows: (Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId === dbId).map((p) => ({ title: p.title, private: !!p.private })),
    }),
    dbId,
  )
  expect(info.private).toBe(true)
  expect(info.parentId).toBeNull()
  expect(info.rows.sort((x, y) => x.title.localeCompare(y.title))).toEqual([
    { title: 'Contract draft', private: true },
    { title: 'Dinner Friday?', private: true },
  ])
  await expect(a.getByTestId('private-section').locator('.sb-row__title', { hasText: 'Mails' })).toBeVisible()

  // Bob: a later shared page arrives (sync barrier) — the mails never do
  const barrier = await wsEval(a, (s) => s.createPage({ title: 'Barrier after mail' }))
  await expect.poll(() => wsEval(b, (s, id) => s.pages[id]?.title ?? null, barrier), { timeout: 15_000 }).toBe('Barrier after mail')
  expect(await wsEval(b, (s, id) => !!s.pages[id] || !!s.databases[id], dbId)).toBe(false)
  expect(await wsEval(b, (s) => JSON.stringify(Object.values(s.pages).map((p: AnyState) => [p.title, p.plain])).includes('Confidential terms'))).toBe(false)
  expect(await b.content()).not.toContain('Contract draft')

  // Ada moves the database into the workspace: the next sync refuses to write there
  await a.evaluate((id) => (window as unknown as { __one: { cloud: { movePagePrivacy: (id: string, p: boolean) => Promise<void> } } }).__one.cloud.movePagePrivacy(id, false), dbId)
  await expect.poll(() => wsEval(a, (s, id) => !!s.pages[id]?.private, dbId)).toBe(false)
  box.bump()
  const rowsBefore = await wsEval(a, (s, id) => Object.values(s.pages).filter((p: AnyState) => p.databaseId === id).length, dbId)
  await syncNow(a)
  await expect.poll(async () => (await mailState(a)).target).toBe('shared')
  expect((await mailState(a)).error).toContain('shared with the workspace')
  expect(await wsEval(a, (s, id) => Object.values(s.pages).filter((p: AnyState) => p.databaseId === id).length, dbId)).toBe(rowsBefore)
})
