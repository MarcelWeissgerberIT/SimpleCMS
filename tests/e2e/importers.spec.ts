/**
 * "Move in from anywhere": Obsidian vaults, Evernote .enex, Trello board JSON and HTML pages.
 * Every fixture is built inside the test (strings → files / ZIPs with fflate).
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval, gotoPage, editorOf } from './fixtures'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function openImport(page: Page) {
  await page.locator('.sb').getByRole('button', { name: /^Import/ }).click()
  return page.getByRole('dialog')
}

async function pickFiles(page: Page, files: Array<{ name: string; mimeType: string; buffer: Buffer }>) {
  const dialog = page.getByRole('dialog')
  const chooser = page.waitForEvent('filechooser')
  await dialog.getByRole('button', { name: 'Choose files' }).click()
  await (await chooser).setFiles(files)
  await expect(dialog.getByText(/Import complete/)).toBeVisible({ timeout: 30_000 })
}

/** Every node of a TipTap doc (depth first). */
function nodes(doc: Json | null): Json[] {
  const out: Json[] = []
  const walk = (n: Json) => {
    out.push(n)
    ;(n.content ?? []).forEach(walk)
  }
  if (doc) walk(doc)
  return out
}
const text = (n: Json): string => (n.type === 'text' ? n.text : (n.content ?? []).map(text).join(''))

/** Live pages (not trashed) as plain JSON. */
async function livePages(page: Page): Promise<Json[]> {
  return wsEval(page, (s) => JSON.parse(JSON.stringify((Object.values(s.pages) as Json[]).filter((p) => !p.trashed))))
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const VAULT: Record<string, string | Buffer> = {
  '.obsidian/app.json': '{"legacyEditor":false}',
  '.trash/Old note.md': '# Old note\n\nthrown away',
  'Home.md': [
    '---',
    'tags: [project, home]',
    'aliases: [Start]',
    'created: 2024-03-01',
    '---',
    '# Home',
    '',
    'Welcome. See [[Projects/Alpha]], [[Alpha|the alpha project]] and [[Beta#Plan]].',
    '',
    '> [!warning] Mind the gap',
    '> Callout body text.',
    '',
    'This is ==important== with $E=mc^2$ inline.',
    '',
    '$$',
    '\\int_0^1 x\\,dx',
    '$$',
    '',
    '```mermaid',
    'graph TD; A-->B',
    '```',
    '',
    '![[diagram.png]]',
    '',
    '- [ ] open task',
    '- [x] done task',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    'Missing: [[Nowhere]]',
    '',
    'Code stays: `[[NotALink]]`',
    '',
  ].join('\n'),
  'Projects/Alpha.md': 'Alpha body. Back to [[Home]] or [[Start]].\n',
  'Projects/Beta.md': '# Beta\n\nIntro.\n\n## Plan\n\nThe plan.\n',
  'attachments/diagram.png': PNG,
}

async function vaultZip(prefix = 'MyVault/'): Promise<Buffer> {
  const { zipSync, strToU8 } = await import('fflate')
  const files: Record<string, Uint8Array> = {}
  for (const [k, v] of Object.entries(VAULT)) files[prefix + k] = typeof v === 'string' ? strToU8(v) : new Uint8Array(v)
  return Buffer.from(zipSync(files))
}

function enex(): Buffer {
  const hash = createHash('md5').update(PNG).digest('hex')
  const note1 = [
    '<note><title>Groceries</title><created>20250105T093000Z</created><updated>20250106T100000Z</updated><tag>home</tag><tag>errands</tag>',
    '<note-attributes><source-url>https://example.com/list</source-url></note-attributes>',
    '<content><![CDATA[<?xml version="1.0" encoding="UTF-8" standalone="no"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">',
    '<en-note><div><b>Shopping</b> list</div><div><en-todo checked="true"/>Milk</div><div><en-todo/>Bread</div>',
    `<div><en-media type="image/png" hash="${hash}"/></div><div>See <a href="evernote:///view/1/s1/abc/abc/">Recipes</a> too.</div>`,
    '<script>window.__enexPwned = 1</script></en-note>]]></content>',
    `<resource><data encoding="base64">${PNG.toString('base64').replace(/(.{40})/g, '$1\n')}</data><mime>image/png</mime><resource-attributes><file-name>photo.png</file-name></resource-attributes></resource>`,
    '</note>',
  ].join('\n')
  const note2 =
    '<note><title>Recipes</title><created>20240210T120000Z</created><updated>20240211T120000Z</updated><content><![CDATA[<en-note><h1>Pancakes</h1><ul><li>Flour</li><li>Eggs</li></ul></en-note>]]></content></note>'
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export3.dtd">\n<en-export export-date="20260101T000000Z" application="Evernote" version="10.0">\n${note1}\n${note2}\n</en-export>\n`,
  )
}

const C = (n: number) => `5f00000000000000000000${String(n).padStart(2, '0')}`
const TRELLO = {
  name: 'Launch board',
  lists: [
    { id: 'l1', name: 'To Do', pos: 1 },
    { id: 'l2', name: 'Doing', pos: 2 },
    { id: 'l3', name: 'Done', pos: 3 },
    { id: 'l4', name: 'Old', pos: 4, closed: true },
  ],
  labels: [
    { id: 'lb1', name: 'Urgent', color: 'red' },
    { id: 'lb2', name: '', color: 'sky' },
  ],
  members: [{ id: 'm1', fullName: 'Ada Lovelace', username: 'ada' }],
  cards: [
    {
      id: C(1),
      name: 'Write copy',
      idList: 'l1',
      pos: 2,
      desc: 'Draft the **landing** copy.',
      idLabels: ['lb1'],
      idMembers: ['m1'],
      due: '2026-11-03T10:00:00.000Z',
      dueComplete: false,
      idChecklists: ['c1'],
      attachments: [{ name: 'Brief', url: 'https://example.com/brief.pdf' }],
      shortUrl: 'https://trello.com/c/abc123',
    },
    { id: C(2), name: 'Plan launch', idList: 'l1', pos: 1, idLabels: ['lb2'] },
    { id: C(3), name: 'Build page', idList: 'l2', pos: 1, due: '2026-10-20T08:30:00.000Z', dueComplete: true },
    { id: C(4), name: 'Kickoff', idList: 'l3', pos: 1 },
    { id: C(5), name: 'Archived card', idList: 'l1', pos: 3, closed: true },
    { id: C(6), name: 'In old list', idList: 'l4', pos: 1 },
  ],
  checklists: [
    {
      id: 'c1',
      name: 'Steps',
      idCard: C(1),
      pos: 1,
      checkItems: [
        { name: 'Outline', state: 'complete', pos: 1 },
        { name: 'Polish', state: 'incomplete', pos: 2 },
      ],
    },
  ],
  actions: [{ type: 'commentCard', date: '2026-10-01T09:00:00.000Z', data: { text: 'Looks good', card: { id: C(1) } }, memberCreator: { fullName: 'Ada Lovelace' } }],
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

test.describe('import from other apps', () => {
  test('Obsidian vault ZIP → page tree, resolved wiki links, callout, highlight, math, mermaid, image', async ({ page }) => {
    await openApp(page)
    const dialog = await openImport(page)
    // the tiles explain every source
    await expect(dialog.getByRole('button', { name: 'Obsidian vault' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Evernote' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Trello board' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Web pages' })).toBeVisible()
    await pickFiles(page, [{ name: 'MyVault.zip', mimeType: 'application/zip', buffer: await vaultZip() }])
    // the report names the unresolved link
    await expect(dialog.locator('[data-report]')).toContainText('One link has no matching page')
    await expect(dialog.locator('[data-report]')).toContainText('[[Nowhere]]')
    await dialog.getByRole('button', { name: 'View import' }).click()

    const pages = await livePages(page)
    // only pages inside the import (the demo workspace has a "Projects" database too)
    const top = pages.find((p) => p.title === 'Obsidian · MyVault')
    const inside = (p: Json): boolean => !!p && (p.id === top?.id || inside(pages.find((x) => x.id === p.parentId) as Json))
    const find = (title: string) => pages.find((p) => p.title === title && inside(p))
    const root = top
    const home = find('Home')
    const projects = find('Projects')
    const alpha = find('Alpha')
    const beta = find('Beta')
    expect(root, 'container named after the vault').toBeTruthy()
    expect(home && projects && alpha && beta).toBeTruthy()
    expect(home!.parentId).toBe(root!.id)
    expect(projects!.parentId).toBe(root!.id)
    expect(alpha!.parentId).toBe(projects!.id)
    expect(beta!.parentId).toBe(projects!.id)
    // hidden folders are ignored
    expect(pages.some((p) => /Old note|app\.json/.test(p.title))).toBe(false)
    // the folder page lists its children
    expect(nodes(projects!.content).filter((n) => n.type === 'pageLink').map((n) => n.attrs.pageId).sort()).toEqual([alpha!.id, beta!.id].sort())

    const all = nodes(home!.content)
    // front matter: created date, tags as #tags; the H1 repeating the title is dropped
    expect(new Date(home!.createdAt).toISOString().slice(0, 10)).toBe('2024-02-29') // 1 Mar 00:00 Berlin = 29 Feb 23:00 UTC
    expect(text(home!.content)).toContain('#project #home')
    expect(all.some((n) => n.type === 'heading' && text(n) === 'Home')).toBe(false)
    // [[Projects/Alpha]] → mention of Alpha
    const mention = all.find((n) => n.type === 'mention')
    expect(mention?.attrs).toMatchObject({ id: alpha!.id, kind: 'page' })
    // [[Alpha|the alpha project]] → inline link with the alias
    const aliasLink = all.find((n) => n.type === 'text' && n.text === 'the alpha project')
    expect(aliasLink?.marks?.find((m: Json) => m.type === 'link')?.attrs.href).toBe(`#/p/${alpha!.id}`)
    // [[Beta#Plan]] → link to the "Plan" heading block inside Beta
    const planLink = all.find((n) => n.type === 'text' && /Beta › Plan/.test(n.text))
    const planHref: string = planLink?.marks?.find((m: Json) => m.type === 'link')?.attrs.href ?? ''
    const planHeading = nodes(beta!.content).find((n) => n.type === 'heading' && text(n) === 'Plan')
    expect(planHeading?.attrs?.id).toBeTruthy()
    expect(planHref).toBe(`#/p/${beta!.id}?b=${planHeading!.attrs.id}`)
    // callout, highlight, math, mermaid, tasks, table, image
    const callout = all.find((n) => n.type === 'callout' && text(n).includes('Mind the gap'))
    expect(callout?.attrs).toMatchObject({ color: 'orange', icon: '⚠️' })
    expect(text(callout!)).toContain('Callout body text.')
    expect(all.find((n) => n.type === 'text' && n.text === 'important')?.marks?.some((m: Json) => m.type === 'highlight')).toBe(true)
    expect(all.find((n) => n.type === 'inlineMath')?.attrs.latex).toBe('E=mc^2')
    expect(all.some((n) => n.type === 'blockMath')).toBe(true)
    expect(all.find((n) => n.type === 'mermaid')?.attrs.code).toContain('A-->B')
    expect(all.filter((n) => n.type === 'taskItem').map((n) => n.attrs.checked)).toEqual([false, true])
    expect(all.some((n) => n.type === 'table')).toBe(true)
    const img = all.find((n) => n.type === 'image')
    expect(img?.attrs.src).toMatch(/^onefile:/)
    // unresolved link → plain text; wiki syntax inside code is left alone
    expect(text(home!.content)).toContain('Missing: Nowhere')
    expect(all.find((n) => n.type === 'text' && n.text?.includes('[[NotALink]]'))?.marks?.some((m: Json) => m.type === 'code')).toBe(true)
    // [[Home]] and the alias [[Start]] both resolve from Alpha
    expect(nodes(alpha!.content).filter((n) => n.type === 'mention').map((n) => n.attrs.id)).toEqual([home!.id, home!.id])

    // renders: the mention shows Alpha's title and leads there
    await gotoPage(page, home!.id)
    const ed = editorOf(page, home!.id)
    await expect(ed.locator('.callout')).toContainText('Mind the gap')
    await expect(ed.locator('mark').first()).toHaveText('important')
    await ed.locator('.mention', { hasText: 'Alpha' }).first().click()
    await expect(page.locator('#main .pv-title')).toHaveValue('Alpha')
  })

  test('Obsidian tile: picking the vault folder', async ({ page }, testInfo) => {
    const dir = testInfo.outputPath('Garden')
    for (const [k, v] of Object.entries(VAULT)) {
      const file = join(dir, k)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, v)
    }
    await openApp(page)
    const dialog = await openImport(page)
    const chooser = page.waitForEvent('filechooser')
    await dialog.getByRole('button', { name: 'Obsidian vault' }).click()
    const fc = await chooser
    expect(await fc.element().evaluate((el) => el.hasAttribute('webkitdirectory'))).toBe(true)
    await fc.setFiles(dir)
    await expect(dialog.getByText(/Import complete/)).toBeVisible({ timeout: 30_000 })
    const pages = await livePages(page)
    const root = pages.find((p) => p.title === 'Obsidian · Garden')
    expect(root, 'container named after the folder').toBeTruthy()
    const alpha = pages.find((p) => p.title === 'Alpha')
    const home = pages.find((p) => p.title === 'Home' && p.parentId === root!.id)
    expect(nodes(home!.content).find((n) => n.type === 'mention')?.attrs.id).toBe(alpha!.id)
  })

  test('Evernote .enex → notebook page, notes with to-dos, image resource and dates', async ({ page }) => {
    await openApp(page)
    const dialog = await openImport(page)
    await pickFiles(page, [{ name: 'Cooking.enex', mimeType: 'application/xml', buffer: enex() }])
    await dialog.getByRole('button', { name: 'View import' }).click()

    const pages = await livePages(page)
    const notebook = pages.find((p) => p.title === 'Cooking')
    const groceries = pages.find((p) => p.title === 'Groceries')
    const recipes = pages.find((p) => p.title === 'Recipes')
    expect(notebook && groceries && recipes).toBeTruthy()
    expect(groceries!.parentId).toBe(notebook!.id)
    expect(recipes!.parentId).toBe(notebook!.id)
    expect(groceries!.createdAt).toBe(Date.UTC(2025, 0, 5, 9, 30))
    expect(groceries!.updatedAt).toBe(Date.UTC(2025, 0, 6, 10, 0))

    const all = nodes(groceries!.content)
    const tasks = all.filter((n) => n.type === 'taskItem').map((n) => [text(n), n.attrs.checked])
    expect(tasks).toEqual([
      ['Milk', true],
      ['Bread', false],
    ])
    expect(all.find((n) => n.type === 'text' && n.text === 'Shopping')?.marks?.some((m: Json) => m.type === 'bold')).toBe(true)
    expect(all.find((n) => n.type === 'image')?.attrs.src).toMatch(/^onefile:/)
    // tags + source in a small properties line
    expect(text(groceries!.content)).toContain('home, errands')
    expect(text(groceries!.content)).toContain('https://example.com/list')
    // evernote:/// link → the "Recipes" page
    const link = all.find((n) => n.type === 'text' && n.text === 'Recipes')
    expect(link?.marks?.find((m: Json) => m.type === 'link')?.attrs.href).toBe(`#/p/${recipes!.id}`)
    // scripts never survive
    expect(JSON.stringify(groceries!.content)).not.toContain('__enexPwned')
    expect(await page.evaluate(() => (window as unknown as { __enexPwned?: number }).__enexPwned)).toBeUndefined()

    const rec = nodes(recipes!.content)
    expect(rec.some((n) => n.type === 'heading' && text(n) === 'Pancakes')).toBe(true)
    expect(rec.filter((n) => n.type === 'listItem').map(text)).toEqual(['Flour', 'Eggs'])

    await gotoPage(page, groceries!.id)
    await expect(editorOf(page, groceries!.id).locator('li[data-type="taskItem"]')).toHaveCount(2)
  })

  test('Trello board JSON → database with a Board view, statuses in list order, labels, members, due, checklist', async ({ page }) => {
    await openApp(page)
    const dialog = await openImport(page)
    await pickFiles(page, [{ name: 'launch-board.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(TRELLO)) }])
    await expect(dialog.locator('[data-report]')).toContainText('Archived Trello lists and cards')
    await dialog.getByRole('button', { name: 'View import' }).click()

    const r = await wsEval(page, (s) => {
      const pages = Object.values(s.pages) as Json[]
      const dbPage = pages.find((p) => p.kind === 'database' && p.title === 'Launch board' && !p.trashed)
      if (!dbPage) return null
      const db = s.databases[dbPage.id]
      const prop = (name: string) => db.properties.find((p: Json) => p.name === name)
      const rows = pages.filter((p) => p.databaseId === dbPage.id).sort((a, b) => a.order - b.order)
      return JSON.parse(
        JSON.stringify({
          id: dbPage.id,
          views: db.views.map((v: Json) => ({ type: v.type, groupBy: v.groupBy })),
          props: db.properties.map((p: Json) => `${p.name}:${p.type}`),
          status: prop('Status'),
          labels: prop('Labels'),
          ids: { members: prop('Members')?.id, due: prop('Due')?.id, done: prop('Done')?.id, link: prop('Trello link')?.id },
          rows: rows.map((x) => ({ title: x.title, props: x.properties, content: x.content, createdAt: x.createdAt })),
          people: s.people,
        }),
      )
    })
    expect(r, 'database "Launch board"').not.toBeNull()
    // Board view first, grouped by Status; options = open lists in list order
    expect(r!.views[0]).toEqual({ type: 'board', groupBy: r!.status.id })
    expect(r!.status.type).toBe('status')
    expect(r!.status.options.map((o: Json) => o.name)).toEqual(['To Do', 'Doing', 'Done'])
    expect(r!.status.options.map((o: Json) => o.group)).toEqual(['todo', 'in_progress', 'done'])
    expect(r!.props).toEqual(expect.arrayContaining(['Name:title', 'Status:status', 'Labels:multi_select', 'Members:person', 'Due:date', 'Done:checkbox', 'Trello link:url']))
    expect(r!.labels.options.map((o: Json) => [o.name, o.color])).toEqual([
      ['Urgent', 'red'],
      ['Blue', 'blue'],
    ])
    // card order (list, then position); archived cards and lists are skipped
    expect(r!.rows.map((x: Json) => x.title)).toEqual(['Plan launch', 'Write copy', 'Build page', 'Kickoff'])

    const write = r!.rows[1]
    const [todo, doing, done] = r!.status.options.map((o: Json) => o.id)
    expect(write.props[r!.status.id]).toBe(todo)
    expect(write.props[r!.labels.id]).toEqual([r!.labels.options[0].id])
    const ada = r!.people.find((p: Json) => p.name === 'Ada Lovelace')
    expect(ada, 'member became a person').toBeTruthy()
    expect(write.props[r!.ids.members]).toEqual([ada.id])
    expect(write.props[r!.ids.due]).toEqual({ start: '2026-11-03T11:00', includeTime: true })
    expect(write.props[r!.ids.done]).toBe(false)
    expect(write.props[r!.ids.link]).toBe('https://trello.com/c/abc123')
    expect(write.createdAt).toBe(parseInt(C(1).slice(0, 8), 16) * 1000)
    const build = r!.rows[2]
    expect(build.props[r!.status.id]).toBe(doing)
    expect(build.props[r!.ids.done]).toBe(true)
    expect(r!.rows[3].props[r!.status.id]).toBe(done)
    expect(r!.rows[0].props[r!.labels.id]).toEqual([r!.labels.options[1].id])

    // description (Markdown) + checklist (to-dos) + attachment link + comment
    const content = nodes(write.content)
    expect(content.find((n) => n.type === 'text' && n.text === 'landing')?.marks?.some((m: Json) => m.type === 'bold')).toBe(true)
    expect(content.filter((n) => n.type === 'taskItem').map((n) => [text(n), n.attrs.checked])).toEqual([
      ['Outline', true],
      ['Polish', false],
    ])
    expect(content.some((n) => n.type === 'heading' && text(n) === 'Steps')).toBe(true)
    expect(JSON.stringify(write.content)).toContain('https://example.com/brief.pdf')
    expect(text(write.content)).toContain('Looks good')

    // the board renders its columns in list order
    await gotoPage(page, r!.id)
    const cols = page.locator('section.dbb-col')
    await expect(cols.first()).toBeVisible()
    const labels = await cols.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
    const order = ['To Do', 'Doing', 'Done'].map((n) => labels.indexOf(n))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    await expect(cols.filter({ hasText: 'Write copy' })).toHaveAttribute('aria-label', 'To Do')
  })

  test('HTML page in a ZIP → page with headings, list, bold, image; scripts and iframes dropped', async ({ page }) => {
    const { zipSync, strToU8 } = await import('fflate')
    const html = [
      '<!doctype html><html><head><meta charset="utf-8"><title>Team handbook</title>',
      '<style>.c1{font-weight:700}.c2{font-style:italic}</style><script>window.__htmlPwned = 1</script></head>',
      '<body><h1>Team handbook</h1><h2>Onboarding</h2>',
      '<p>Read <span class="c1">this</span> <span class="c2">first</span>.</p>',
      '<ul><li>Laptop</li><li>Accounts</li></ul>',
      '<iframe src="https://evil.example/frame"></iframe>',
      '<p><img src="images/logo.png" alt="Logo"></p>',
      '<p onclick="window.__htmlPwned = 2">Bye <a href="javascript:alert(1)">now</a></p>',
      '</body></html>',
    ].join('')
    const zip = Buffer.from(zipSync({ 'handbook.html': strToU8(html), 'images/logo.png': new Uint8Array(PNG) }))
    await openApp(page)
    const dialog = await openImport(page)
    await pickFiles(page, [{ name: 'handbook.zip', mimeType: 'application/zip', buffer: zip }])
    await dialog.getByRole('button', { name: 'View import' }).click()

    const pages = await livePages(page)
    const hb = pages.find((p) => p.title === 'Team handbook')
    expect(hb, 'page titled from <title>').toBeTruthy()
    const all = nodes(hb!.content)
    // the H1 repeating the title is not duplicated in the body
    expect(all.filter((n) => n.type === 'heading').map((n) => [n.attrs.level, text(n)])).toEqual([[2, 'Onboarding']])
    expect(all.filter((n) => n.type === 'listItem').map(text)).toEqual(['Laptop', 'Accounts'])
    expect(all.find((n) => n.type === 'text' && n.text === 'this')?.marks?.some((m: Json) => m.type === 'bold')).toBe(true)
    expect(all.find((n) => n.type === 'text' && n.text === 'first')?.marks?.some((m: Json) => m.type === 'italic')).toBe(true)
    expect(all.find((n) => n.type === 'image')?.attrs.src).toMatch(/^onefile:/)
    const json = JSON.stringify(hb!.content)
    expect(json).not.toMatch(/evil\.example|__htmlPwned|javascript:|onclick/)
    expect(await page.evaluate(() => (window as unknown as { __htmlPwned?: number }).__htmlPwned)).toBeUndefined()

    await gotoPage(page, hb!.id)
    await expect(editorOf(page, hb!.id).locator('h3, h2').filter({ hasText: 'Onboarding' })).toBeVisible()
  })
})
