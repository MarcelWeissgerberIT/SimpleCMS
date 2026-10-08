/**
 * Own templates in a team workspace (features/templates, Page.template): a template is a hidden
 * page subtree that syncs like any page — one Ada saves is in Bob's gallery and usable by him; one
 * she keeps "Only me" lives in her Private section and never reaches him.
 */
import type { Page } from '@playwright/test'
import { test, expect, email, signIn, newPerson, openApp, wsEval, waitOnline, gotoPage, createWorkspace, join as joinWorkspace } from './fixtures'

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

/** "Save as template…" from the page menu; `only` = keep it in my Private section. */
async function saveAsTemplate(p: Page, pageId: string, name: string, only = false): Promise<string> {
  await gotoPage(p, pageId)
  await p.locator('.tb').getByRole('button', { name: 'Page options' }).click()
  await p.getByRole('menuitem', { name: 'Save as template…' }).click()
  const dialog = p.getByRole('dialog', { name: 'Save as template' })
  await dialog.getByLabel('Name').fill(name)
  const sw = dialog.getByRole('switch', { name: 'Only me' })
  await expect(sw).toBeVisible()
  if (only) await sw.click()
  await dialog.getByRole('button', { name: 'Save template' }).click()
  await expect(dialog).toBeHidden()
  let id = ''
  await expect
    .poll(async () => {
      id = await wsEval(p, (s, name) => (Object.values(s.pages) as Array<Record<string, any>>).find((x) => x.template?.name === name && !x.trashed)?.id ?? '', name)
      return id
    })
    .not.toBe('')
  return id
}

test.describe('team cloud — templates', () => {
  test('a template Ada saves is usable by Bob; an "Only me" template stays hers', async ({ page: a, context }) => {
    watch(a, 'ada')
    await signIn(a, email('ada'))
    const wsId = await createWorkspace(a, 'Acme Sprint')
    const b = await newPerson(context)
    watch(b, 'bob')
    await signIn(b, email('bob'))
    await joinWorkspace(a, b, wsId, 'member')
    await openApp(a, wsId)
    await waitOnline(a)
    await openApp(b, wsId)
    await waitOnline(b)

    const source = await wsEval(a, (s) => {
      const root = s.createPage({ title: 'Sprint kit' })
      s.createPage({ title: 'Retro board', parentId: root })
      const db = s.createDatabase({ parentId: root, title: 'Sprint tasks', inline: true })
      s.createRow(db, { title: 'Plan the sprint' })
      s.setContent(root, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Sprint starts {{iso}}' }] }] }, 'e2e')
      return root
    })
    const shared = await saveAsTemplate(a, source, 'Team sprint')
    const mine = await saveAsTemplate(a, source, 'Ada only', true)
    expect(await wsEval(a, (s, id) => !!s.pages[id].private, mine)).toBe(true)

    // Bob: the shared template arrives (hidden, out of his sidebar), the private one does not
    await expect.poll(() => wsEval(b, (s, id) => s.pages[id]?.template?.name ?? null, shared), { timeout: 20_000 }).toBe('Team sprint')
    expect(await wsEval(b, (s, id) => !!s.pages[id], mine)).toBe(false)
    expect(await wsEval(b, (s, id) => !!s.pages[id].hidden, shared)).toBe(true)
    await expect(b.locator('.sb .sb-row:not([data-section="recent"]):not([data-section="frequent"]) .sb-row__title', { hasText: 'Sprint kit' })).toHaveCount(1)

    // Bob uses it from his gallery
    await b.locator('.sb').getByRole('button', { name: 'Templates', exact: true }).click()
    const dialog = b.getByRole('dialog', { name: 'Templates' })
    await dialog.getByRole('tab', { name: /^Mine/ }).click()
    await expect(dialog.getByRole('option')).toHaveCount(1)
    await expect(dialog.getByRole('option', { name: /Team sprint/ })).toBeVisible()
    await dialog.locator('.tpl-preview').getByRole('button', { name: /Use template/ }).click()
    await expect(dialog).toBeHidden()
    await expect(b.locator('#main .pv-title')).toHaveValue('Sprint kit')
    const copy = await b.evaluate(() => window.location.hash.match(/^#\/p\/([\w-]+)/)?.[1] ?? '')
    expect(copy).not.toBe(shared)
    await expect(b.locator('#main .ProseMirror').first()).not.toContainText('{{iso}}')
    // the copy's database carries its own copy of the row
    expect(
      await wsEval(b, (s, id) => {
        const pages = Object.values(s.pages) as Array<Record<string, any>>
        const db = pages.find((p) => p.parentId === id && p.kind === 'database')
        return pages.filter((p) => db && p.databaseId === db.id).map((p) => p.title)
      }, copy),
    ).toEqual(['Plan the sprint'])

    // Ada sees Bob's copy as a normal page with its subpage and database
    await expect
      .poll(
        () =>
          wsEval(a, (s, id) => {
            const kids = (Object.values(s.pages) as Array<Record<string, any>>).filter((p) => p.parentId === id && !p.trashed)
            return [s.pages[id]?.title ?? null, !!s.pages[id]?.hidden, kids.map((k) => k.title).sort()]
          }, copy),
        { timeout: 20_000 },
      )
      .toEqual(['Sprint kit', false, ['Retro board', 'Sprint tasks']])
  })
})
