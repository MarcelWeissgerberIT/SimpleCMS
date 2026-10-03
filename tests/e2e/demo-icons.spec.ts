import { test, expect, openApp, reloadApp, wsEval, pageIdByTitle, flush } from './fixtures'

/**
 * Workspaces seeded before the icon change (emoji icons) get the generated icons on the next boot —
 * only for demo pages that still carry their seeded title and emoji.
 */
test('demo pages seeded with emoji get the new icons; changed pages keep theirs', async ({ page }) => {
  await openApp(page)
  const welcome = await pageIdByTitle(page, 'Welcome to One')
  const wiki = await pageIdByTitle(page, 'Team wiki')
  const reading = await pageIdByTitle(page, 'Reading list')
  // an "old" workspace: the seeded emoji, one page the person gave another emoji, one renamed page
  await wsEval(
    page,
    (s, ids) => {
      s.updatePage(ids.welcome, { icon: { type: 'emoji', value: '👋' } })
      s.updatePage(ids.wiki, { icon: { type: 'emoji', value: '🦄' } })
      s.updatePage(ids.reading, { icon: { type: 'emoji', value: '📚' }, title: 'Books' })
    },
    { welcome, wiki, reading },
  )
  await flush(page)
  await reloadApp(page)

  const icons = await wsEval(page, (s, ids) => [s.pages[ids.welcome].icon, s.pages[ids.wiki].icon, s.pages[ids.reading].icon], { welcome, wiki, reading })
  expect(icons).toEqual([{ type: 'asset', value: 'app-icon' }, { type: 'emoji', value: '🦄' }, { type: 'emoji', value: '📚' }])
  await expect(page.locator('.sb section[aria-label="Pages"] .sb-row', { hasText: 'Welcome to One' }).locator('img[src*="assets/icons/app-icon.webp"]')).toBeVisible()

  // kept after another reload (it was saved like an edit)
  await reloadApp(page)
  expect(await wsEval(page, (s, id) => s.pages[id].icon, welcome)).toEqual({ type: 'asset', value: 'app-icon' })
})
