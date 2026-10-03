/**
 * Synced blocks in a team workspace: an edit in a reference reaches the original page's Y document
 * (bridged setContent 'synced'), the other member sees it — exactly once (only the client where
 * the edit happened propagates it) — and an edit of the original flows back the other way.
 */
import type { Cookie, Page } from '@playwright/test'
import { test, expect, api, email, signIn, newPerson, openApp, wsEval, waitOnline, gotoPage, editorOf, createWorkspace, join } from './fixtures'

const errors: string[] = []
const watched = new WeakSet<Page>()
function watch(p: Page, who: string) {
  if (watched.has(p)) return
  watched.add(p)
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

const accounts = new Map<string, Cookie[]>()
async function person(page: Page, name: string): Promise<void> {
  watch(page, name)
  const known = accounts.get(name)
  if (known) {
    await page.context().addCookies(known)
    await page.goto('/app/')
    return
  }
  await signIn(page, email(name))
  await api(page, 'PATCH', '/api/me', { name: name[0].toUpperCase() + name.slice(1) })
  accounts.set(name, (await page.context().cookies()).filter((c) => c.name === 'one_session'))
}

/** Editor text without other people's caret tags and without the synced block's tag. */
const docText = (p: Page, id: string) =>
  editorOf(p, id).evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement
    copy.querySelectorAll('.collab-caret, .synced__bar').forEach((c) => c.remove())
    return copy.textContent ?? ''
  })

const count = (s: string, part: string) => s.split(part).length - 1
const P = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })

test('team workspace: a reference edit reaches the original once, for everyone; the original edits flow back', async ({ page: a, context }) => {
  await person(a, 'ada')
  const wsId = await createWorkspace(a, 'Synced Co')
  await openApp(a, wsId)
  await waitOnline(a)
  const b = await newPerson(context)
  await person(b, 'bob')
  await join(a, b, wsId)
  await openApp(b, wsId)
  await waitOnline(b)

  // Ada: the original on "Handbook", a reference on "Onboarding"
  const { src, ref } = await wsEval(
    a,
    (s, arg) => {
      const src = s.createPage({ title: 'Handbook' })
      s.setContent(src, { type: 'doc', content: [arg.intro, { type: 'syncedBlock', attrs: { syncId: 'cloud-grp', sourcePageId: null }, content: [arg.shared] }] }, 'e2e')
      const ref = s.createPage({ title: 'Onboarding' })
      s.setContent(ref, { type: 'doc', content: [arg.welcome, { type: 'syncedBlock', attrs: { syncId: 'cloud-grp', sourcePageId: src }, content: [arg.shared] }] }, 'e2e')
      return { src, ref }
    },
    { intro: P('Handbook intro'), welcome: P('Welcome aboard'), shared: P('Office hours 9 to 5') },
  )

  // Bob has both pages; he looks at the original
  await expect.poll(() => wsEval(b, (s, id) => s.pages[id]?.plain ?? '', src), { timeout: 20_000 }).toContain('Office hours 9 to 5')
  await gotoPage(b, src)
  await expect(editorOf(b, src).locator('[data-type="synced-block"]')).toHaveAttribute('data-role', 'original')

  // Ada types in the reference
  await gotoPage(a, ref)
  const reference = editorOf(a, ref).locator('[data-type="synced-block"]')
  await expect(reference).toHaveAttribute('data-role', 'reference')
  await reference.locator('p', { hasText: 'Office hours' }).click()
  await a.keyboard.press('End')
  await a.keyboard.type(', Fridays until 3')

  // the original changes — in Ada's store, and live in Bob's editor — exactly once
  await expect.poll(() => wsEval(a, (s, id) => s.pages[id].plain, src), { timeout: 15_000 }).toContain('Office hours 9 to 5, Fridays until 3')
  await expect.poll(() => docText(b, src), { timeout: 15_000 }).toContain('Office hours 9 to 5, Fridays until 3')
  await b.waitForTimeout(2500)
  expect(count(await docText(b, src), 'Fridays until 3')).toBe(1)
  expect(count(await wsEval(b, (s, id) => s.pages[id].plain, src), 'Fridays until 3')).toBe(1)

  // Bob edits the original → Ada's open reference follows, once
  await editorOf(b, src).locator('[data-type="synced-block"] p').click()
  await b.keyboard.press('End')
  await b.keyboard.type('. Closed on holidays')
  await expect.poll(() => docText(a, ref), { timeout: 15_000 }).toContain('Fridays until 3. Closed on holidays')
  await a.waitForTimeout(2500)
  expect(count(await docText(a, ref), 'Closed on holidays')).toBe(1)
  expect(count(await docText(b, src), 'Closed on holidays')).toBe(1)
  // the rest of each page is untouched
  expect(await docText(a, ref)).toContain('Welcome aboard')
  expect(await docText(b, src)).toContain('Handbook intro')
})
