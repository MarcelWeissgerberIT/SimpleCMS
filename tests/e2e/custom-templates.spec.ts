/**
 * Own templates (features/templates): a template is a hidden page subtree whose root carries
 * Page.template. Save a page as a template, keep it out of normal use (sidebar, search, graph,
 * agenda), use it (a deep copy: every internal reference remapped, variables filled), edit it,
 * customise a built-in, duplicate / delete, EN + DE, keyboard, reload.
 * The clock is pinned to Wed 14 Oct 2026 so filled variables and the agenda month are deterministic.
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, gotoPage, wsEval, flush, editorOf, sidebarRow, waitForPlain, MOD } from './fixtures'

const NOW = new Date('2026-10-14T10:00:00')
const ISO = '2026-10-14'

interface Kit {
  root: string
  sub: string
  db: string
  view: string
  rows: { a: string; b: string }
  rel: string
  outside: string
  syncId: string
}

/**
 * "Launch kit": a page with a subpage ("Checklist {{date}}") and an inline database ("Milestones":
 * a date, a text with a variable, a unique id and a two-way self relation Blocks ↔ Blocked by).
 * Its content mentions the subpage and a page outside, links the subpage, embeds the database and
 * holds the original of a synced block whose reference lives on the subpage.
 */
async function seedKit(page: Page): Promise<Kit> {
  const kit = await wsEval(page, (s) => {
    const outside = (Object.values(s.pages) as Array<Record<string, any>>).find((p) => p.title === 'Projects' && !p.trashed)!.id
    const root = s.createPage({ title: 'Launch kit', parentId: null })
    const sub = s.createPage({ title: 'Checklist {{date}}', parentId: root })
    const db = s.createDatabase({
      parentId: root,
      title: 'Milestones',
      inline: true,
      properties: [
        { id: 'p_name', name: 'Name', type: 'title' },
        { id: 'p_due', name: 'Due', type: 'date' },
        { id: 'p_note', name: 'Note', type: 'text' },
      ],
    })
    s.addProperty(db, { type: 'unique_id', name: 'No.' })
    const rel = s.addProperty(db, { type: 'relation', name: 'Blocks', relationDatabaseId: db })
    s.addProperty(db, { id: `${rel}.2way`, type: 'relation', name: 'Blocked by', relationDatabaseId: db })
    const a = s.createRow(db, { title: 'Kit kickoff', properties: { p_due: { start: '2026-10-16' }, p_note: 'Prep on {{iso}}' } })
    const b = s.createRow(db, { title: 'Kit launch', properties: { p_due: { start: '2026-10-21' } } })
    s.setRowProperty(a, rel, [b])
    s.setRowProperty(b, `${rel}.2way`, [a])
    // `s` is the state when the call started: read the new database from the live store
    const view = (window as unknown as { __one: { workspace: { getState: () => Record<string, any> } } }).__one.workspace.getState().databases[db].views[0].id
    const syncId = 'synce2etpl0001'
    const rules = { type: 'paragraph', content: [{ type: 'text', text: 'Shared launch rules' }] }
    s.setContent(
      root,
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Kickoff on {{iso}} by {{user}} — see ' },
              { type: 'mention', attrs: { id: sub, label: 'Checklist', kind: 'page' } },
              { type: 'text', text: ' and ' },
              { type: 'mention', attrs: { id: outside, label: 'Projects', kind: 'page' } },
            ],
          },
          { type: 'syncedBlock', attrs: { syncId, sourcePageId: null }, content: [rules] },
          { type: 'pageLink', attrs: { pageId: sub } },
          { type: 'databaseBlock', attrs: { databaseId: db, viewId: view } },
        ],
      },
      'e2e',
    )
    s.setContent(sub, { type: 'doc', content: [{ type: 'syncedBlock', attrs: { syncId, sourcePageId: root }, content: [rules] }] }, 'e2e')
    s.updateSettings({ userName: 'Ada' })
    return { root, sub, db, view, rows: { a, b }, rel, outside, syncId }
  })
  await flush(page)
  return kit
}

/** What a copy (or the template itself) looks like: its references, ids and filled text. */
async function describeTree(page: Page, rootId: string) {
  return wsEval(
    page,
    (s, rootId) => {
      const pages = (Object.values(s.pages) as Array<Record<string, any>>).filter((p) => !p.trashed)
      const root = s.pages[rootId]
      const kids = pages.filter((p) => p.parentId === rootId)
      const sub = kids.find((p) => p.kind === 'page' && !p.databaseId)
      const db = kids.find((p) => p.kind === 'database')
      const def = db ? s.databases[db.id] : null
      const rows = pages.filter((p) => db && p.databaseId === db.id)
      const row = (title: string) => rows.find((r) => r.title === title)
      const prop = (name: string) => def?.properties.find((p: Record<string, any>) => p.name === name)
      const nodes = (content: Record<string, any> | null) => {
        const out: Array<Record<string, any>> = []
        const walk = (n: Record<string, any>) => {
          out.push(n)
          ;(n.content ?? []).forEach(walk)
        }
        if (content) walk(content)
        return out
      }
      const own = nodes(root.content)
      const rel = prop('Blocks')
      const back = prop('Blocked by')
      const uid = def?.properties.find((p: Record<string, any>) => p.type === 'unique_id')
      return {
        title: root.title as string,
        hidden: !!root.hidden,
        template: root.template ?? null,
        parentId: root.parentId as string | null,
        plain: root.plain as string,
        subId: sub?.id as string,
        subTitle: sub?.title as string,
        dbId: db?.id as string,
        dbInline: !!def?.inline,
        viewIds: (def?.views ?? []).map((v: Record<string, any>) => v.id) as string[],
        mentions: own.filter((n) => n.type === 'mention').map((n) => n.attrs.id) as string[],
        pageLinks: own.filter((n) => n.type === 'pageLink').map((n) => n.attrs.pageId) as string[],
        dbBlocks: own.filter((n) => n.type === 'databaseBlock').map((n) => [n.attrs.databaseId, n.attrs.viewId]) as string[][],
        sync: own.filter((n) => n.type === 'syncedBlock').map((n) => [n.attrs.syncId, n.attrs.sourcePageId]) as Array<[string, string | null]>,
        subSync: nodes(sub?.content ?? null)
          .filter((n) => n.type === 'syncedBlock')
          .map((n) => [n.attrs.syncId, n.attrs.sourcePageId]) as Array<[string, string | null]>,
        rowA: row('Kit kickoff')?.id as string,
        rowB: row('Kit launch')?.id as string,
        relId: rel?.id as string,
        relTarget: rel?.relationDatabaseId as string,
        backTarget: back?.relationDatabaseId as string,
        relA: (rel ? row('Kit kickoff')?.properties[rel.id] : null) as string[] | null,
        backB: (back ? row('Kit launch')?.properties[back.id] : null) as string[] | null,
        uids: rows.map((r) => r.properties[uid?.id]).sort() as number[],
        nextUid: def?.nextUniqueId as number,
        note: row('Kit kickoff')?.properties.p_note as string,
      }
    },
    rootId,
  )
}

/** Template roots (live), oldest first. */
async function templates(page: Page): Promise<Array<{ id: string; name: string; from: string | null; hidden: boolean; title: string }>> {
  return wsEval(page, (s) =>
    (Object.values(s.pages) as Array<Record<string, any>>)
      .filter((p) => p.template && !p.trashed)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((p) => ({ id: p.id, name: p.template.name, from: p.template.from ?? null, hidden: !!p.hidden, title: p.title })),
  )
}

/** Live, visible top-level copies called `title` (not templates). */
async function copiesTitled(page: Page, title: string, except: string[] = []): Promise<string[]> {
  return wsEval(
    page,
    (s, { title, except }) =>
      (Object.values(s.pages) as Array<Record<string, any>>)
        .filter((p) => p.title === title && !p.trashed && !p.template && !p.hidden && !p.parentId && !except.includes(p.id))
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((p) => p.id as string),
    { title, except },
  )
}

async function pageOptions(page: Page): Promise<void> {
  await page.locator('.tb').getByRole('button', { name: 'Page options' }).click()
}

/** "Save as template…" from the page menu of the open page. */
async function saveAsTemplate(page: Page, pageId: string, meta: { description?: string; category?: string } = {}): Promise<string> {
  await gotoPage(page, pageId)
  const before = (await templates(page)).map((x) => x.id)
  await pageOptions(page)
  await page.getByRole('menuitem', { name: 'Save as template…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Save as template' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Name')).toHaveValue('Launch kit')
  await expect(dialog.locator('.tpl-form__count')).toHaveText('2 pages, 1 database, 2 rows')
  if (meta.description) await dialog.getByLabel('Description').fill(meta.description)
  if (meta.category) await dialog.getByRole('radio', { name: meta.category }).click()
  await dialog.getByRole('button', { name: 'Save template' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Saved as template “Launch kit”')).toBeVisible()
  const after = await templates(page)
  const made = after.filter((x) => !before.includes(x.id))
  expect(made).toHaveLength(1)
  await flush(page)
  return made[0].id
}

async function openGallery(page: Page): Promise<Locator> {
  await page.locator('.sb').getByRole('button', { name: /^Templates/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Templates' })
  await expect(dialog).toBeVisible()
  return dialog
}

/** Gallery → Mine → the card → Use template; returns the id of the opened copy. */
async function useOwn(page: Page, name: string): Promise<string> {
  const dialog = await openGallery(page)
  await dialog.getByRole('tab', { name: /^Mine/ }).click()
  await dialog.getByRole('option', { name: new RegExp(name) }).click()
  await expect(dialog.locator('.tpl-preview__title')).toHaveText(name)
  await dialog.locator('.tpl-preview').getByRole('button', { name: /Use template/ }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText(`“${name}” added`).last()).toBeVisible()
  await expect(page.locator('#main .tplb')).toHaveCount(0)
  const id = await page.evaluate(() => window.location.hash.match(/^#\/p\/([\w-]+)/)?.[1] ?? '')
  expect(id).not.toBe('')
  await flush(page)
  return id
}

async function graphNodes(page: Page): Promise<number> {
  await page.evaluate(() => (window.location.hash = '#/graph'))
  const canvas = page.locator('canvas.graph__canvas')
  await expect(canvas).toBeVisible()
  const label = (await canvas.getAttribute('aria-label')) ?? ''
  const m = label.match(/Graph of (\d+) pages/)
  expect(m, label).not.toBeNull()
  return Number(m![1])
}

/** Agenda sources (one chip per dated database) called `name`. */
async function agendaSources(page: Page, name: string): Promise<number> {
  await page.evaluate(() => (window.location.hash = '#/agenda'))
  await expect(page.locator('.ag')).toBeVisible()
  await expect(page.locator('.ag-sources').getByRole('button', { name: /^Projects/ })).toBeVisible()
  return page.locator('.ag-sources').getByRole('button', { name: new RegExp(`^${name} \\d+$`) }).count()
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW)
})

test.describe('own templates', () => {
  test('save as template: a hidden copy that stays out of the sidebar, search, graph and agenda', async ({ page }) => {
    await openApp(page)
    const kit = await seedKit(page)
    const nodes = await graphNodes(page)
    expect(await agendaSources(page, 'Milestones')).toBe(1)

    const tplId = await saveAsTemplate(page, kit.root, { description: 'Brief, checklist and milestones.', category: 'Work' })
    const tpl = await describeTree(page, tplId)
    // the template is a real page subtree with fresh ids, kept hidden at the top level
    expect(tpl.hidden).toBe(true)
    expect(tpl.parentId).toBeNull()
    expect(tpl.template).toEqual({ name: 'Launch kit', description: 'Brief, checklist and milestones.', category: 'work' })
    expect(tpl.title).toBe('Launch kit')
    expect([tpl.subId, tpl.dbId, tpl.rowA, tpl.rowB]).not.toContain(kit.sub)
    expect(tpl.dbId).not.toBe(kit.db)
    // its references point inside the template; variables wait for "Use"
    expect(tpl.mentions).toEqual([tpl.subId, kit.outside])
    expect(tpl.dbBlocks).toEqual([[tpl.dbId, tpl.viewIds[0]]])
    expect(tpl.sync[0][0]).not.toBe(kit.syncId)
    expect(tpl.subSync).toEqual([[tpl.sync[0][0], tplId]])
    expect(tpl.relA).toEqual([tpl.rowB])
    expect(tpl.backB).toEqual([tpl.rowA])
    expect(tpl.plain).toContain('{{iso}}')
    expect(tpl.subTitle).toBe('Checklist {{date}}')
    expect(tpl.note).toBe('Prep on {{iso}}')
    // the page itself is untouched
    const orig = await describeTree(page, kit.root)
    expect(orig.mentions).toEqual([kit.sub, kit.outside])
    expect(orig.sync).toEqual([[kit.syncId, null]])

    // sidebar: only the original
    await expect(sidebarRow(page, 'Launch kit')).toHaveCount(1)
    await expect(page.locator('.sb .sb-row__title', { hasText: 'Checklist {{date}}' })).toHaveCount(0)
    // search: the template's pages are no page hits; the template has its own group
    await page.keyboard.press(`${MOD}+k`)
    const pal = page.getByRole('dialog', { name: 'Command palette' })
    await expect(pal).toBeVisible()
    await page.keyboard.type('Kit kickoff')
    await expect(pal.locator('[cmdk-item]', { has: page.locator('.pal-item__title', { hasText: /^Kit kickoff$/ }) })).toHaveCount(1)
    await pal.getByRole('combobox').fill('Launch kit')
    const tplHit = pal.locator(`[cmdk-item][data-value="tpl:${tplId}"]`)
    await expect(tplHit).toBeVisible()
    await expect(pal.locator('[cmdk-item]:not([data-value^="tpl:"])', { has: page.locator('.pal-item__title', { hasText: /^Launch kit$/ }) })).toHaveCount(1)
    // the template hit opens the gallery on it
    await tplHit.click()
    const gallery = page.getByRole('dialog', { name: 'Templates' })
    await expect(gallery.getByRole('tab', { name: /^Mine/ })).toHaveAttribute('aria-selected', 'true')
    await expect(gallery.locator('.tpl-preview__title')).toHaveText('Launch kit')
    await expect(gallery.locator('.tpl-outline')).toContainText('Milestones')
    await expect(gallery.locator('.tpl-outline')).toContainText('2 rows')
    await page.keyboard.press('Escape')
    await expect(gallery).toBeHidden()
    // graph and agenda: unchanged
    expect(await graphNodes(page)).toBe(nodes)
    expect(await agendaSources(page, 'Milestones')).toBe(1)
  })

  test('use twice: independent copies, every internal reference inside its own copy, variables filled', async ({ page }) => {
    await openApp(page)
    const kit = await seedKit(page)
    const tplId = await saveAsTemplate(page, kit.root)
    const nodes = await graphNodes(page)
    const tpl = await describeTree(page, tplId)

    const first = await useOwn(page, 'Launch kit')
    await expect(page.locator('#main .pv-title')).toHaveValue('Launch kit')
    await expect(editorOf(page)).toContainText(`Kickoff on ${ISO} by Ada`)
    const second = await useOwn(page, 'Launch kit')
    expect(second).not.toBe(first)
    expect(await copiesTitled(page, 'Launch kit', [kit.root])).toEqual([first, second])

    const a = await describeTree(page, first)
    const b = await describeTree(page, second)
    for (const [copy, id] of [
      [a, first],
      [b, second],
    ] as const) {
      expect(copy.hidden).toBe(false)
      expect(copy.template).toBeNull()
      expect(copy.parentId).toBeNull()
      expect(copy.dbInline).toBe(true)
      // mention + page link → its own subpage; the page outside stays
      expect(copy.mentions).toEqual([copy.subId, kit.outside])
      expect(copy.pageLinks).toEqual([copy.subId])
      // the inline database block → its own database and view
      expect(copy.dbBlocks).toEqual([[copy.dbId, copy.viewIds[0]]])
      // synced block: a new group; the subpage's reference follows it
      expect(copy.sync).toHaveLength(1)
      expect(copy.sync[0][1]).toBeNull()
      expect([kit.syncId, tpl.sync[0][0]]).not.toContain(copy.sync[0][0])
      expect(copy.subSync).toEqual([[copy.sync[0][0], id]])
      // two-way relation inside the copy (property ids are per database: kept)
      expect(copy.relId).toBe(kit.rel)
      expect(copy.relTarget).toBe(copy.dbId)
      expect(copy.backTarget).toBe(copy.dbId)
      expect(copy.relA).toEqual([copy.rowB])
      expect(copy.backB).toEqual([copy.rowA])
      // unique ids numbered from 1 again
      expect(copy.uids).toEqual([1, 2])
      expect(copy.nextUid).toBe(3)
      // variables: content, subpage title, text property
      expect(copy.plain).toContain(`Kickoff on ${ISO} by Ada`)
      expect(copy.plain).not.toContain('{{')
      expect(copy.subTitle).toBe('Checklist Wed 14 Oct')
      expect(copy.note).toBe(`Prep on ${ISO}`)
    }
    // two independent copies
    expect(new Set([a.subId, b.subId, tpl.subId, kit.sub]).size).toBe(4)
    expect(new Set([a.dbId, b.dbId, tpl.dbId, kit.db]).size).toBe(4)
    expect(a.sync[0][0]).not.toBe(b.sync[0][0])
    expect(a.rowA).not.toBe(b.rowA)
    // the template is unchanged
    expect(await describeTree(page, tplId)).toEqual(tpl)

    // the rendered copy: its subpage link and the database rows
    await gotoPage(page, second)
    await expect(page.locator('#main section.db .db-rowtitle__text', { hasText: 'Kit kickoff' })).toBeVisible()
    await editorOf(page).locator('[data-type="mention"]', { hasText: /Checklist/ }).first().click()
    await expect(page).toHaveURL(new RegExp(`#/p/${b.subId}`))
    await expect(page.locator('#main .pv-title')).toHaveValue('Checklist Wed 14 Oct')

    // copies are part of normal use: graph (3 pages each) and agenda (one more milestone each)
    expect(await graphNodes(page)).toBe(nodes + 6)
    expect(await agendaSources(page, 'Milestones')).toBe(3)
    await expect(sidebarRow(page, 'Launch kit')).toHaveCount(3)
  })

  test('edit a template: Done goes back, the next use reflects the edit, earlier copies stay; Undo removes a copy', async ({ page }) => {
    await openApp(page)
    const kit = await seedKit(page)
    const tplId = await saveAsTemplate(page, kit.root)
    const first = await useOwn(page, 'Launch kit')

    // Edit from the gallery: the template opens with its banner
    let dialog = await openGallery(page)
    await dialog.getByRole('tab', { name: /^Mine/ }).click()
    await dialog.locator('.tpl-preview').getByRole('button', { name: 'Edit' }).click()
    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL(new RegExp(`#/p/${tplId}`))
    const banner = page.locator('#main .tplb')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('Template')
    await expect(banner.locator('.tplb__name')).toHaveText('Launch kit')
    // a subpage of the template carries the banner too
    const tpl = await describeTree(page, tplId)
    await gotoPage(page, tpl.subId)
    await expect(banner.locator('.tplb__sub')).toHaveText('/ Checklist {{date}}')
    await gotoPage(page, tplId)

    // change the content and the gallery details
    // type at the start of the first line (its middle holds a mention link)
    const ed = editorOf(page, tplId)
    await ed.locator('p').first().click({ position: { x: 2, y: 8 } })
    await page.keyboard.press('Home')
    await page.keyboard.type('Edited in the template. ')
    await waitForPlain(page, tplId, /Edited in the template/)
    await banner.getByRole('button', { name: 'Details' }).click()
    await banner.getByLabel('Name').fill('Launch kit v2')
    await banner.getByLabel('Description').fill('Now with an edit.')
    await expect(banner.locator('.tplb__name')).toHaveText('Launch kit v2')
    await banner.getByRole('button', { name: 'Done' }).click()
    // back where editing started: the first copy
    await expect(page).toHaveURL(new RegExp(`#/p/${first}$`))
    await flush(page)
    expect((await templates(page)).map((x) => x.name)).toEqual(['Launch kit v2'])

    const second = await useOwn(page, 'Launch kit v2')
    await expect(page.locator('#main .pv-title')).toHaveValue('Launch kit')
    await expect(editorOf(page)).toContainText('Edited in the template')
    expect(await wsEval(page, (s, id) => s.pages[id].plain, first)).not.toContain('Edited in the template')

    // Undo in the toast: the fresh copy goes to the trash, back to the page before
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page).toHaveURL(new RegExp(`#/p/${first}$`))
    expect(await wsEval(page, (s, id) => s.pages[id].trashed, second)).toBe(true)
  })

  test('customise a built-in: edit it, use the edit, reset to the original', async ({ page }) => {
    await openApp(page)
    let dialog = await openGallery(page)
    const card = dialog.locator('[data-tpl="b:meetings"]')
    await card.click()
    await expect(card).not.toHaveAttribute('data-customised')
    await dialog.locator('.tpl-preview').getByRole('button', { name: 'Customise' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText('Your own “Meeting notes”')).toBeVisible()
    const [custom] = await templates(page)
    expect(custom).toMatchObject({ from: 'meetings', name: 'Meeting notes', hidden: true })
    await expect(page).toHaveURL(new RegExp(`#/p/${custom.id}`))
    const banner = page.locator('#main .tplb')
    await expect(banner.locator('.tplb__name')).toHaveText('Meeting notes')
    // the built-in database is a real one: rename it like any page
    await expect(page.locator('#main section.db').getByText('Weekly sync')).toBeVisible()
    await page.locator('#main .pv-title').fill('Team meetings')
    await page.locator('#main .pv-title').press('Enter')
    await banner.getByRole('button', { name: 'Done' }).click()
    await flush(page)
    await expect(sidebarRow(page, 'Team meetings')).toHaveCount(0)

    // the gallery marks it, "Mine" stays empty, "Use" takes the edit
    dialog = await openGallery(page)
    await expect(card).toHaveAttribute('data-customised', 'true')
    await expect(card).toContainText('Customised')
    await expect(dialog.getByRole('tab', { name: /^Mine/ })).toContainText('00')
    await card.click()
    await expect(dialog.locator('.tpl-outline')).toContainText('3 rows')
    await dialog.locator('.tpl-preview').getByRole('button', { name: /Use template/ }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('#main .pv-title')).toHaveValue('Team meetings')
    await expect(page.locator('#main .tplb')).toHaveCount(0)
    await expect(page.locator('#main section.db').getByText('Weekly sync')).toBeVisible()
    await expect(sidebarRow(page, 'Team meetings')).toHaveCount(1)

    // reset to original: the edit goes to the trash, "Use" builds the original again
    dialog = await openGallery(page)
    await card.click()
    await dialog.locator('.tpl-preview').getByRole('button', { name: 'Reset to original' }).click()
    await expect(page.getByText('“Meeting notes” is the original again')).toBeVisible()
    await expect(card).not.toHaveAttribute('data-customised')
    expect(await templates(page)).toEqual([])
    await dialog.locator('.tpl-preview').getByRole('button', { name: /Use template/ }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('#main .pv-title')).toHaveValue('Meeting notes')
  })

  test('duplicate, delete with undo, new template, reload persists, German', async ({ page }) => {
    await openApp(page)
    const kit = await seedKit(page)
    const tplId = await saveAsTemplate(page, kit.root, { category: 'Product' })

    let dialog = await openGallery(page)
    const mine = dialog.getByRole('tab', { name: /^Mine/ })
    await mine.click()
    await expect(mine).toContainText('01')
    await dialog.locator('.tpl-preview').getByRole('button', { name: 'Duplicate' }).click()
    await expect(page.getByText('Template duplicated')).toBeVisible()
    await expect(mine).toContainText('02')
    await expect(dialog.locator('.tpl-preview__title')).toHaveText('Launch kit (copy)')
    // the category filter counts both
    await expect(dialog.getByRole('radio', { name: /Product/ })).toContainText('02')
    // search narrows the cards
    await dialog.getByRole('searchbox', { name: 'Search templates' }).fill('copy')
    await expect(dialog.getByRole('option')).toHaveCount(1)
    await dialog.getByRole('searchbox', { name: 'Search templates' }).fill('')
    await expect(dialog.getByRole('option')).toHaveCount(2)
    await dialog.getByRole('option', { name: /Launch kit \(copy\)/ }).click()
    await dialog.locator('.tpl-preview').getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByText('Template “Launch kit (copy)” deleted')).toBeVisible()
    await expect(mine).toContainText('01')
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(mine).toContainText('02')
    await dialog.getByRole('option', { name: /Launch kit \(copy\)/ }).click()
    await dialog.locator('.tpl-preview').getByRole('button', { name: 'Delete' }).click()
    await expect(mine).toContainText('01')

    // a blank template opens with its details
    await dialog.getByRole('button', { name: 'New template' }).click()
    await expect(dialog).toBeHidden()
    const banner = page.locator('#main .tplb')
    await expect(banner.getByLabel('Name')).toHaveValue('Untitled template')
    await banner.getByLabel('Name').fill('Blank start')
    await banner.getByRole('button', { name: 'Done' }).click()
    await flush(page)
    expect((await templates(page)).map((x) => x.name)).toEqual(['Launch kit', 'Blank start'])

    // reload: both still there, still hidden
    await reloadApp(page)
    const after = await templates(page)
    expect(after.map((x) => [x.name, x.hidden])).toEqual([
      ['Launch kit', true],
      ['Blank start', true],
    ])
    expect(after[0].id).toBe(tplId)
    await expect(sidebarRow(page, 'Launch kit')).toHaveCount(1)
    dialog = await openGallery(page)
    await dialog.getByRole('tab', { name: /^Mine/ }).click()
    await expect(dialog.getByRole('option')).toHaveCount(2)
    await page.keyboard.press('Escape')

    // German
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await gotoPage(page, kit.root)
    await page.locator('.tb').getByRole('button', { name: 'Seitenoptionen' }).click()
    await expect(page.getByRole('menuitem', { name: 'Als Vorlage speichern…' })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.locator('.sb').getByRole('button', { name: /^Vorlagen/ }).click()
    dialog = page.getByRole('dialog', { name: 'Vorlagen' })
    await expect(dialog.getByRole('tab', { name: /^Mitgeliefert/ })).toBeVisible()
    await dialog.getByRole('tab', { name: /^Eigene/ }).click()
    await expect(dialog.getByRole('button', { name: 'Neue Vorlage' })).toBeVisible()
    await expect(dialog.locator('.tpl-preview').getByRole('button', { name: 'Bearbeiten' })).toBeVisible()
    await expect(dialog.locator('.tpl-preview').getByRole('button', { name: 'Duplizieren' })).toBeVisible()
    await dialog.locator('.tpl-preview').getByRole('button', { name: 'Bearbeiten' }).click()
    await expect(page.locator('#main .tplb')).toContainText('Vorlage')
    await expect(page.locator('#main .tplb').getByRole('button', { name: 'Fertig' })).toBeVisible()
    await expect(page.locator('#main .tplb').getByRole('button', { name: /Vorlage verwenden/ })).toBeVisible()
  })

  test('keyboard: tabs, cards, Enter uses, E edits', async ({ page }) => {
    await openApp(page)
    const kit = await seedKit(page)
    const tplId = await saveAsTemplate(page, kit.root)

    // ⌘K → "templates" opens the gallery with the first card focused
    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('>templates')
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Templates' })
    await expect(dialog).toBeVisible()
    const cards = dialog.getByRole('option')
    await expect(cards.first()).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(cards.nth(1)).toBeFocused()
    await expect(cards.nth(1)).toHaveAttribute('aria-selected', 'true')
    await expect(dialog.locator('.tpl-preview__title')).toHaveText('Project tracker')

    // back to the source tabs: category chips ← new ← search ← tabs
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+Tab')
    const builtin = dialog.getByRole('tab', { name: /^Built-in/ })
    await expect(builtin).toBeFocused()
    await page.keyboard.press('ArrowRight')
    const mine = dialog.getByRole('tab', { name: /^Mine/ })
    await expect(mine).toBeFocused()
    await expect(mine).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowDown')
    await expect(dialog.getByRole('option', { name: /Launch kit/ })).toBeFocused()
    // E edits
    await page.keyboard.press('e')
    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL(new RegExp(`#/p/${tplId}`))
    const done = page.locator('#main .tplb').getByRole('button', { name: 'Done' })
    await done.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#main .tplb')).toHaveCount(0)

    // Enter uses
    await openGallery(page)
    await dialog.getByRole('tab', { name: /^Mine/ }).click()
    await dialog.getByRole('option', { name: /Launch kit/ }).focus()
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()
    await expect(page.getByText('“Launch kit” added')).toBeVisible()
    await expect(page.locator('#main .pv-title')).toHaveValue('Launch kit')
    expect(await copiesTitled(page, 'Launch kit', [kit.root])).toHaveLength(1)
  })
})
