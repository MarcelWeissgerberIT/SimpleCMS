/**
 * Second-level workflows: the things a real user does right after the happy path.
 */
import { test, expect, openApp, gotoPage, createPage, doc, para, wsEval, pageById, pageIdByTitle, editorOf, selectText, mockClaude, flush, MOD } from './fixtures'

test.describe('AI', () => {
  test('first use without a key: connect the key inline, then run an action', async ({ page, context }) => {
    await mockClaude(context, () => 'Tightened version.')
    await openApp(page)
    const id = await createPage(page, { title: 'No key yet', content: doc(para('loose wordy sentence here')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p').first().click()
    await selectText(page, ed, 'loose wordy sentence here')
    await page.locator('[aria-label="Formatting"]').getByRole('button', { name: 'Ask AI' }).click()
    const ai = page.getByRole('dialog', { name: 'Ask Claude' })
    await expect(ai.getByText('Connect your Claude key')).toBeVisible()
    await ai.getByRole('textbox', { name: 'Anthropic API key' }).fill('sk-ant-e2e-0123456789')
    await ai.getByRole('button', { name: 'Connect' }).click()
    await expect(ai.getByRole('option', { name: /Improve writing/ })).toBeVisible()
    // the store keeps a vault marker ("vault:<id>:<last 4>"), the key itself is sealed (lib/vault.ts)
    expect(await wsEval(page, (s) => s.settings.aiApiKey)).toMatch(/^vault:[0-9a-z]+:6789$/)
    await ai.getByRole('option', { name: /Make shorter/ }).click()
    await expect(ai).toContainText('Tightened version.')
    await ai.getByRole('option', { name: /Replace selection/ }).click()
    await expect(ed).toContainText('Tightened version.')
  })

  test('palette "?" asks Claude about the page and appends the answer', async ({ page, context }) => {
    const bodies = await mockClaude(context, () => '**Answer:** the launch is in two weeks.')
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    const id = await createPage(page, { title: 'Launch plan', content: doc(para('We launch in two weeks.')) })
    await gotoPage(page, id)
    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('?When do we launch?')
    const pal = page.getByRole('dialog', { name: 'Command palette' })
    await expect(pal.locator('.pal-mode')).toHaveText('ASK')
    await page.keyboard.press('Enter')
    await expect(pal).toContainText('the launch is in two weeks.')
    await pal.getByRole('button', { name: /Append to page/ }).click()
    await expect(pal).toBeHidden()
    await expect(editorOf(page, id)).toContainText('the launch is in two weeks.')
    await expect(editorOf(page, id).locator('strong')).toHaveText('Answer:')
    expect(JSON.stringify(JSON.parse(bodies.find((b) => /stream/.test(b))!))).toContain('We launch in two weeks.')
  })
})

test.describe('page operations', () => {
  test('a tab left open across an update: the Claude SDK file is gone — "reload", not "offline"', async ({ page, context, errors }) => {
    errors.allow(/404 \(Not Found\)|Failed to fetch dynamically imported module|\/sdk-/)
    const bodies = await mockClaude(context, () => 'Never asked.')
    await openApp(page)
    await page.route(/\/assets\/sdk-[^/]+\.js$/, (r) => r.fulfill({ status: 404, body: 'gone' }))
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    const id = await createPage(page, { title: 'Stale tab' })
    await gotoPage(page, id)
    await editorOf(page, id).click()
    await page.keyboard.press('Space')
    const ask = page.getByPlaceholder('Ask Claude to write anything…')
    await expect(ask).toBeFocused()
    await ask.fill('Write a haiku')
    await page.keyboard.press('Enter')
    const err = page.locator('.ai-error')
    await expect(err.locator('.ai-error__code')).toHaveText('ERR · OUTDATED')
    await expect(err).toContainText('One was updated while this tab was open. Reload to use Claude.')
    await expect(err.getByRole('button', { name: 'Reload' })).toBeVisible()
    await expect(page.locator('.toast', { hasText: 'A new version of One is ready.' })).toHaveCount(1)
    expect(bodies.filter((b) => /stream/.test(b))).toHaveLength(0)
  })

  test('lock a page: title and body become read-only; the "Locked" tag unlocks it', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Lockable', content: doc(para('frozen text')) })
    await gotoPage(page, id)
    await page.locator('.tb').getByRole('button', { name: 'Page options' }).click()
    await page.getByRole('menuitemcheckbox', { name: /Lock page/ }).click()
    await page.keyboard.press('Escape')
    const ed = editorOf(page, id)
    await expect(ed).toHaveAttribute('contenteditable', 'false')
    await expect(page.locator('#main .pv-title')).toHaveAttribute('readonly', '')
    await ed.click()
    await page.keyboard.type('should not appear')
    await expect(ed).not.toContainText('should not appear')
    await page.locator('.tb').getByRole('button', { name: /Locked/ }).click()
    await expect(ed).toHaveAttribute('contenteditable', 'true')
    expect((await pageById(page, id)).settings.locked).toBe(false)
  })

  test('duplicate a database page: rows are copied and independent', async ({ page }) => {
    await openApp(page)
    const projects = await pageIdByTitle(page, 'Projects')
    await gotoPage(page, projects)
    await page.locator('.tb').getByRole('button', { name: 'Page options' }).click()
    await page.getByRole('menuitem', { name: 'Duplicate' }).click()
    await expect(page.locator('#main .pv-title')).toHaveValue('Projects (copy)')
    const copy = await page.evaluate(() => window.location.hash.split('/')[2])
    expect(copy).not.toBe(projects)
    const counts = await wsEval(
      page,
      (s, ids) => ids.map((id: string) => (Object.values(s.pages) as Array<Record<string, any>>).filter((p) => p.databaseId === id && !p.trashed).length),
      [projects, copy],
    )
    expect(counts).toEqual([8, 8])
    // renaming a row in the copy leaves the original alone
    await wsEval(page, (s, copy) => {
      const row = (Object.values(s.pages) as Array<Record<string, any>>).find((p) => p.databaseId === copy && /Website relaunch/.test(p.title))
      s.updatePage(row!.id, { title: 'Renamed in copy' })
    }, copy)
    const original = await wsEval(page, (s, id) => (Object.values(s.pages) as Array<Record<string, any>>).filter((p) => p.databaseId === id).map((p) => p.title), projects)
    expect(original).toContain('Website relaunch')
    expect(original).not.toContain('Renamed in copy')
  })

  test('duplicate a page with an inline database: the copy gets its own database', async ({ page }) => {
    await openApp(page)
    const pageId = await createPage(page, { title: 'Report', content: doc(para('Intro')) })
    await gotoPage(page, pageId)
    const ed = editorOf(page, pageId)
    await ed.locator('p').last().click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/Table view')
    await expect(page.locator('.slash__item[aria-selected="true"] .slash__name')).toHaveText('Table view')
    await page.keyboard.press('Enter')
    await expect(ed.locator('section.db.db--inline')).toBeVisible()
    await flush(page)

    await page.locator('.tb').getByRole('button', { name: 'Page options' }).click()
    await page.getByRole('menuitem', { name: 'Duplicate' }).click()
    await expect(page.locator('#main .pv-title')).toHaveValue('Report (copy)')
    const copyId = await page.evaluate(() => window.location.hash.split('/')[2])
    const refs = await wsEval(
      page,
      (s, ids) =>
        ids.map((id: string) => {
          const out: string[] = []
          const walk = (n: Record<string, any>) => {
            if (n.type === 'databaseBlock') out.push(n.attrs.databaseId)
            ;(n.content ?? []).forEach(walk)
          }
          if (s.pages[id].content) walk(s.pages[id].content)
          return out
        }),
      [pageId, copyId],
    )
    expect(refs[0]).toHaveLength(1)
    expect(refs[1]).toHaveLength(1)
    expect(refs[1][0], 'the copy embeds its own database, not the original one').not.toBe(refs[0][0])
    const childDb = await wsEval(page, (s, copyId) => (Object.values(s.pages) as Array<Record<string, any>>).find((p) => p.kind === 'database' && p.parentId === copyId)?.id ?? null, copyId)
    expect(childDb).toBe(refs[1][0])
  })

  test('trash: delete forever and empty trash', async ({ page }) => {
    await openApp(page)
    const a = await createPage(page, { title: 'Doomed A' })
    const b = await createPage(page, { title: 'Doomed B' })
    await wsEval(page, (s, ids) => ids.forEach((id: string) => s.trashPage(id)), [a, b])
    await page.locator('.sb-trash').click()
    const trash = page.getByRole('dialog', { name: 'Trash' })
    const itemA = trash.locator('.trash-item', { hasText: 'Doomed A' })
    await itemA.getByRole('button', { name: 'Delete forever' }).click()
    await itemA.locator('.trash-item__confirm').click()
    await expect(itemA).toHaveCount(0)
    expect(await wsEval(page, (s, id) => !!s.pages[id], a)).toBe(false)
    await trash.getByRole('button', { name: 'Empty trash' }).click()
    const confirm = page.getByRole('dialog').filter({ hasText: 'Empty the trash?' })
    await confirm.getByRole('button', { name: 'Empty trash' }).click()
    await expect(page.locator('.sb-trash .sb-sect__count')).toHaveText('00')
    expect(await wsEval(page, (s, id) => !!s.pages[id], b)).toBe(false)
    if (!(await trash.isVisible())) await page.locator('.sb-trash').click()
    await expect(trash.getByText('Trash is empty')).toBeVisible()
  })

  test('history: "Undo" in the restore toast brings the newer text back', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Undo restore', content: doc(para('old words')) })
    await gotoPage(page, id)
    await page.locator('.tb').getByRole('button', { name: 'Version history' }).click()
    await page.getByRole('dialog').getByRole('button', { name: /Save version/ }).first().click()
    await page.keyboard.press('Escape')
    await wsEval(page, (s, id) => s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'new words' }] }] }, 'e2e'), id)
    await expect(editorOf(page, id)).toHaveText('new words')
    await flush(page)
    await page.locator('.tb').getByRole('button', { name: 'Version history' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('.hist__row', { has: page.locator('.hist__tag--manual') }).first().click()
    await dialog.getByRole('button', { name: 'Restore this version' }).click()
    await expect(editorOf(page, id)).toHaveText('old words')
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(editorOf(page, id)).toHaveText('new words')
  })
})

test.describe('panes and peek', () => {
  test('Alt-click a page mention opens it in a side pane', async ({ page }) => {
    await openApp(page)
    const ed = page.locator('#main .ProseMirror')
    const mention = ed.locator('[data-type="mention"], .mention').filter({ hasText: 'Team wiki' }).first()
    await mention.scrollIntoViewIfNeeded()
    await mention.click({ modifiers: ['Alt'] })
    const pane = page.locator('[data-pane-index="0"]')
    await expect(pane).toBeVisible()
    await expect(pane.locator('.pv-title')).toHaveValue('Team wiki')
    // main column stays on the welcome page
    await expect(page.locator('#main .pv-title')).toHaveValue('Welcome to One')
    await pane.getByRole('button', { name: 'Close pane' }).click()
    await expect(pane).toHaveCount(0)
  })

  test('peek → "Open as full page"', async ({ page }) => {
    await openApp(page)
    const projects = await pageIdByTitle(page, 'Projects')
    await gotoPage(page, projects)
    await page.locator('#main section.db').getByRole('tab').filter({ hasText: 'All projects' }).click()
    const row = page.locator('#main .dbt-row[role="row"]', { has: page.locator('.dbt-cell--title', { hasText: 'Brand refresh' }) })
    await row.hover()
    await row.locator('.db-open').click()
    const peek = page.locator('.peek')
    await expect(peek.locator('.pv-title')).toHaveValue('Brand refresh')
    await peek.getByRole('button', { name: 'Open as full page' }).click()
    await expect(page.locator('.peek')).toHaveCount(0)
    await expect(page.locator('#main .pv-title')).toHaveValue('Brand refresh')
    // a row page shows its properties above the body
    await expect(page.locator('#main .db-props')).toContainText('Status')
  })
})

test.describe('automations', () => {
  test('the seeded "Notify when Status → Done" automation shows a toast when a row is finished', async ({ page }) => {
    await openApp(page)
    const projects = await pageIdByTitle(page, 'Projects')
    await gotoPage(page, projects)
    await page.locator('#main').getByRole('toolbar', { name: 'Database toolbar' }).getByRole('button', { name: 'Automations' }).click()
    const dialog = page.getByRole('dialog')
    // the demo workspace ships one armed automation
    await dialog.getByRole('option', { name: /Notify when Status → Done/ }).click()
    await expect(dialog.getByRole('switch', { name: 'Enabled' })).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
    // finish a row on the board (drag would work too — set it through the row's peek property)
    await page.locator('#main section.db').getByRole('tab').filter({ hasText: 'All projects' }).click()
    const row = page.locator('#main .dbt-row[role="row"]', { has: page.locator('.dbt-cell--title', { hasText: 'Pricing page experiment' }) })
    await row.locator('[role="gridcell"][data-type="status"]').click()
    await page.locator('.db-picker .db-opt', { hasText: 'Done' }).click()
    await expect(page.getByText(/Pricing page experiment → Done/)).toBeVisible({ timeout: 10_000 })
  })

  test('recipe "Notify when Status → Done" arms a toast on a new database', async ({ page }) => {
    await openApp(page)
    const dbId = await wsEval(page, (s) => s.createDatabase({ title: 'Chores', parentId: null }))
    await gotoPage(page, dbId)
    await page.locator('#main').getByRole('toolbar', { name: 'Database toolbar' }).getByRole('button', { name: 'Automations' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: /Notify when Status → Done/ }).click()
    await expect(dialog.getByRole('switch', { name: 'Enabled' })).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
    await wsEval(page, (s, id) => {
      const status = s.databases[id].properties.find((p: { type: string }) => p.type === 'status')
      const done = status.options.find((o: { group: string }) => o.group === 'done')
      const row = s.createRow(id, { title: 'Water the plants' })
      s.setRowProperty(row, status.id, done.id)
    }, dbId)
    await expect(page.getByText(/Water the plants → Done/)).toBeVisible({ timeout: 10_000 })
  })
})

test.describe('landing deep links', () => {
  test('/app/?import opens the importer', async ({ page }) => {
    await page.goto('app/?import')
    await expect(page.locator('.app')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('dialog')).toContainText('Drop files here')
    // the query is cleaned up so a reload does not reopen it
    await expect(page).toHaveURL(/\/SimpleCMS\/app\/(#.*)?$/)
  })
})

test.describe('drag & drop and block moves', () => {
  test('sidebar: drag a page onto another to nest it', async ({ page }) => {
    await openApp(page)
    const child = await createPage(page, { title: 'Drag child' })
    const wiki = await pageIdByTitle(page, 'Team wiki')
    const src = page.locator('.sb section[aria-label="Pages"] .sb-row', { has: page.locator('.sb-row__title', { hasText: /^Drag child$/ }) })
    const dst = page.locator('.sb section[aria-label="Pages"] .sb-row', { has: page.locator('.sb-row__title', { hasText: /^Team wiki$/ }) })
    const a = (await src.boundingBox())!
    const b = (await dst.boundingBox())!
    await page.mouse.move(a.x + 60, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(a.x + 60, a.y + a.height / 2 - 8, { steps: 3 })
    await page.mouse.move(b.x + 60, b.y + b.height / 2, { steps: 15 })
    await expect(dst).toHaveAttribute('data-drop', 'inside')
    await page.mouse.up()
    await expect.poll(async () => (await pageById(page, child)).parentId).toBe(wiki)
  })

  test('editor: drag a block by its handle to reorder', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Reorder', content: doc(para('First block'), para('Second block'), para('Third block')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    const third = ed.locator('p', { hasText: 'Third block' })
    await third.hover()
    const grip = page.getByRole('button', { name: 'Block menu' })
    await expect(grip).toBeVisible()
    const g = (await grip.boundingBox())!
    const first = (await ed.locator('p', { hasText: 'First block' }).boundingBox())!
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
    await page.mouse.down()
    await page.mouse.move(g.x + g.width / 2, g.y - 10, { steps: 4 })
    await page.mouse.move(first.x + 40, first.y + 2, { steps: 15 })
    await page.mouse.up()
    await expect
      .poll(() => wsEval(page, (s, id) => (s.pages[id].content.content as Array<Record<string, any>>).map((n) => n.content?.[0]?.text).filter(Boolean), id))
      .toEqual(['Third block', 'First block', 'Second block'])
  })

  test('block menu "Move to" sends a block to another page', async ({ page }) => {
    await openApp(page)
    const target = await createPage(page, { title: 'Destination page', content: doc(para('already here')) })
    const id = await createPage(page, { title: 'Source page', content: doc(para('stays'), para('travels')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p', { hasText: 'travels' }).hover()
    await page.getByRole('button', { name: 'Block menu' }).click()
    await page.getByRole('menuitem', { name: /^Move to/ }).click()
    await page.getByPlaceholder('Move block to page…').fill('Destination')
    await page.getByRole('menuitem', { name: 'Destination page' }).click()
    await expect(ed.locator('p', { hasText: 'travels' })).toHaveCount(0)
    await expect(page.getByText('Moved to “Destination page”')).toBeVisible()
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain, target)).toContain('travels')
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain, id)).not.toContain('travels')
    // after a reload both pages agree
    await flush(page)
    await page.reload()
    await page.waitForFunction(() => !!(window as unknown as { __one?: unknown }).__one)
    expect(await wsEval(page, (s, id) => s.pages[id].plain, id)).toBe('stays')
    expect(await wsEval(page, (s, id) => s.pages[id].plain, target)).toContain('travels')
  })

  test('editor undo / redo', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Undo', content: doc(para('keep')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p').first().click()
    await page.keyboard.press('End')
    await page.keyboard.type(' typed')
    await expect(ed).toHaveText('keep typed')
    await page.keyboard.press(`${MOD}+z`)
    await expect(ed).toHaveText('keep')
    await page.keyboard.press(`${MOD}+Shift+z`)
    await expect(ed).toHaveText('keep typed')
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain, id)).toBe('keep typed')
  })
})

test.describe('German workflows', () => {
  test.use({ locale: 'de-DE' })

  test('Heute opens a German journal entry', async ({ page }) => {
    await openApp(page)
    await page.locator('.sb').getByRole('button', { name: /^Heute/ }).click()
    const expected = await page.evaluate(() => new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()))
    await expect(page.locator('#main .pv-title')).toHaveValue(expected.replace(', ', ', '))
    await expect(page.locator('#main .ProseMirror')).toContainText('Notizen')
    expect(await wsEval(page, (s) => (Object.values(s.pages) as Array<Record<string, any>>).some((p) => p.kind === 'database' && p.title === 'Journal'))).toBe(true)
  })

  test('templates are offered and created in German', async ({ page }) => {
    await openApp(page)
    await page.locator('.sb').getByRole('button', { name: /^Vorlagen/ }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('option', { name: /Bug-Tracker/ }).click()
    await dialog.locator('.tpl-preview').getByRole('button', { name: /Vorlage verwenden/ }).click()
    await expect(page.locator('#main .pv-title')).toHaveValue('Bug-Tracker')
  })
})

test.describe('duplicate keeps references inside the copy', () => {
  test('duplicating a page with sub-pages: its page links open the copied sub-pages', async ({ page }) => {
    await openApp(page)
    const wiki = await pageIdByTitle(page, 'Team wiki')
    await gotoPage(page, wiki)
    await page.locator('.tb').getByRole('button', { name: 'Page options' }).click()
    await page.getByRole('menuitem', { name: 'Duplicate' }).click()
    await expect(page.locator('#main .pv-title')).toHaveValue('Team wiki (copy)')
    const copy = await page.evaluate(() => window.location.hash.split('/')[2])
    const r = await wsEval(
      page,
      (s, copy) => {
        const children = (Object.values(s.pages) as Array<Record<string, any>>).filter((p) => p.parentId === copy).map((p) => p.id)
        const links: string[] = []
        const walk = (n: Record<string, any>) => {
          if (n.type === 'pageLink') links.push(n.attrs.pageId)
          ;(n.content ?? []).forEach(walk)
        }
        walk(s.pages[copy].content)
        return { children, links }
      },
      copy,
    )
    expect(r.children).toHaveLength(4)
    expect(r.links).toHaveLength(4)
    expect(r.links.filter((id) => r.children.includes(id)), 'page links in the copy point at the copied sub-pages').toHaveLength(4)
  })
})

test.describe('duplicate remaps references (store level)', () => {
  test('mentions, #/p links, inline databases and relations point at the copies; trashed subtrees stay behind', async ({ page }) => {
    await openApp(page)
    const r = await wsEval(page, (s) => {
      const root = s.createPage({ title: 'Dup root' })
      const child = s.createPage({ title: 'Dup child', parentId: root })
      const gone = s.createPage({ title: 'Dup trashed', parentId: root })
      s.createPage({ title: 'Dup under trashed', parentId: gone })
      s.trashPage(gone)
      const outside = s.createPage({ title: 'Dup outside' })
      const db = s.createDatabase({ parentId: root, inline: true, title: 'Dup tasks' })
      const rel = s.addProperty(db, { type: 'relation', name: 'Blocks', relationDatabaseId: db })
      const r1 = s.createRow(db, { title: 'Task one' })
      const r2 = s.createRow(db, { title: 'Task two' })
      s.setRowProperty(r2, rel, [r1])
      // `s` is the state at call time: read what the actions created from a fresh snapshot
      const view = window.__one.workspace.getState().databases[db].views[0].id
      s.setContent(root, {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'mention', attrs: { id: child, label: 'Dup child', kind: 'page' } }, { type: 'text', text: ' see ', marks: [{ type: 'link', attrs: { href: `#/p/${child}?b=blk1` } }] }, { type: 'mention', attrs: { id: outside, label: 'Dup outside', kind: 'page' } }] },
          { type: 'pageLink', attrs: { pageId: child } },
          { type: 'databaseBlock', attrs: { databaseId: db, viewId: view } },
        ],
      }, 'test')
      const copy = s.duplicatePage(root)!
      const st = window.__one.workspace.getState()
      const pages = Object.values(st.pages) as Array<Record<string, any>>
      const kids = pages.filter((p) => p.parentId === copy)
      const copyChild = kids.find((p) => p.title === 'Dup child')!.id
      const copyDb = kids.find((p) => p.kind === 'database')!.id
      const c = st.pages[copy].content.content
      const rows = pages.filter((p) => p.databaseId === copyDb)
      const copyR1 = rows.find((p) => p.title === 'Task one')!.id
      const copyR2 = rows.find((p) => p.title === 'Task two')!
      return {
        mention: c[0].content[0].attrs.id === copyChild,
        href: c[0].content[1].marks[0].attrs.href === `#/p/${copyChild}?b=blk1`,
        outside: c[0].content[2].attrs.id === outside,
        pageLink: c[1].attrs.pageId === copyChild,
        dbBlock: c[2].attrs.databaseId === copyDb,
        viewId: st.databases[copyDb].views.some((v: { id: string }) => v.id === c[2].attrs.viewId) && c[2].attrs.viewId !== view,
        relationDb: st.databases[copyDb].properties.find((p: { id: string }) => p.id === rel).relationDatabaseId === copyDb,
        relation: JSON.stringify(copyR2.properties[rel]) === JSON.stringify([copyR1]),
        noTrashed: pages.filter((p) => p.title === 'Dup trashed').length === 1 && pages.filter((p) => p.title === 'Dup under trashed').length === 1,
        originalUntouched: st.pages[root].content.content[1].attrs.pageId === child,
      }
    })
    expect(r).toEqual({ mention: true, href: true, outside: true, pageLink: true, dbBlock: true, viewId: true, relationDb: true, relation: true, noTrashed: true, originalUntouched: true })
  })
})

test.describe('automatic version history', () => {
  test('the first edit of a session keeps the state before it', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Auto history', content: doc(para('original sentence')) })
    // a new session
    await page.reload()
    await page.waitForFunction(() => !!(window as unknown as { __one?: unknown }).__one)
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p').first().click()
    await page.keyboard.press('End')
    await page.keyboard.type(' changed later')
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain, id)).toBe('original sentence changed later')
    await page.locator('.tb').getByRole('button', { name: 'Version history' }).click()
    const dialog = page.getByRole('dialog')
    const start = dialog.locator('.hist__row', { has: page.locator('.hist__tag--session') }).first()
    await expect(start).toBeVisible({ timeout: 10_000 })
    await start.click()
    // "Changes" shows the diff against now; "Version" shows the snapshot itself
    await expect(dialog.locator('.hist__preview')).toContainText('original sentence')
    await dialog.getByRole('tab', { name: 'Version' }).click()
    await expect(dialog.locator('.hist__preview')).toContainText('original sentence')
    await expect(dialog.locator('.hist__preview')).not.toContainText('changed later')
  })
})
