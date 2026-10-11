/**
 * Flight recorder — the lane sweep (R1a A13, design §2.7): real paths through the app, each one asserting the
 * lane (and the run key) the journal wrote for it, and that nothing fell back to a guess (`unknowns()` empty, no
 * `unknown` lane). A row = mark the tape → do the thing → `expectLane`. Claude, Gmail and every other host are
 * mocked; the test data is fictional (Nordlicht, Tessera, Mara Lind).
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { BrowserContext, Locator, Page } from '@playwright/test'
import { Client } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StdioClientTransport } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js'
import { test, expect, openApp, wsEval, flush, gotoPage, editorOf, createPage, doc, para, sidebarRow, selectText, pageById, escapeRe, sse, MOD } from './fixtures'
import { docxBytes } from './helpers/files'
import { mockAgent, openTerminal, run as runTask, sseMessage, terminal } from './helpers/terminal'
import { addProfile, trackerProfile } from './helpers/integrations'
import { makeCodingRepo, startCodingWorker, type CodingRepo, type RunningWorker } from './helpers/coding'
import { expectLane, expectNoPerson, markRec, nordlichtDb, rec, startRecorder } from './helpers/recorder'
import { blockTracker, outbox, outboxLoaded, routeRef, rowValue, seedMirrorDb } from './helpers/outbox'
import { flushLamps, seedMirror, seedPipeline, seedRuns, waitPreflight } from './helpers/preflightStory.mjs'

type AnyRec = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Open the app with the recorder running; the setup's own writes are on the tape before the first mark. */
async function boot<T>(page: Page, setup?: () => Promise<T>): Promise<T> {
  await openApp(page)
  await startRecorder(page)
  const out = setup ? await setup() : (undefined as T)
  await flush(page)
  await rec(page, 'flush')
  return out
}

const dbSection = (page: Page) => page.locator('#main section.db').first()

/** A pointer drag (dnd-kit): press on `from`, move past the activation distance, drop on the middle of `to`. */
async function pointerDrag(page: Page, from: Locator, to: Locator, dy = 0): Promise<void> {
  await to.scrollIntoViewIfNeeded()
  await from.scrollIntoViewIfNeeded()
  const a = (await from.boundingBox())!
  const b = (await to.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 4, { steps: 4 })
  await page.mouse.move(b.x + b.width / 2, b.y + (dy || b.height / 2), { steps: 20 })
  await page.waitForTimeout(150)
  await page.mouse.up()
}

/** Select from the start of `from` to the end of `to` (a DOM range — ProseMirror picks it up). */
async function selectRange(page: Page, editor: Locator, from: string, to: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await editor.evaluate(
      (root, [a, b]) => {
        const find = (needle: string) => {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
          let node: Node | null
          while ((node = walker.nextNode())) {
            const i = (node as Text).data.indexOf(needle)
            if (i >= 0) return { node, i }
          }
          throw new Error(`text not found: ${needle}`)
        }
        const s = find(a)
        const e = find(b)
        const r = document.createRange()
        r.setStart(s.node, s.i)
        r.setEnd(e.node, e.i + b.length)
        const sel = window.getSelection()!
        sel.removeAllRanges()
        sel.addRange(r)
      },
      [from, to] as const,
    )
    await page.waitForTimeout(150)
    const got = await page.evaluate(() => window.getSelection()?.toString() ?? '')
    if (got.startsWith(from) && got.trimEnd().endsWith(to)) return
  }
  throw new Error('selection did not hold')
}

const setKey = (page: Page) => wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
const aiPanel = (page: Page) => page.locator('.ai-panel')

/** Open the AI menu on the current selection (bubble toolbar → Ask AI). */
async function askAI(page: Page): Promise<Locator> {
  const bubble = page.locator('[aria-label="Formatting"]').first()
  await expect(bubble).toBeVisible()
  await bubble.getByRole('button', { name: /^Ask AI$/ }).click()
  await expect(aiPanel(page)).toBeVisible()
  return aiPanel(page)
}

const IMPROVED = 'Nordlicht startet am Montag um neun.'

/**
 * api.anthropic.com for the AI family: streamed requests get IMPROVED (an image's "Find every table" a table),
 * structured ones the answer their system prompt asks for (todb, toggles, redo passages).
 */
async function mockAIFamily(ctx: BrowserContext): Promise<void> {
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (req.method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [], has_more: false }) })
    const body = JSON.parse(req.postData() ?? '{}')
    const system = typeof body.system === 'string' ? body.system : JSON.stringify(body.system ?? '')
    const content = body.messages?.[0]?.content
    const task = Array.isArray(content) ? content.map((b: AnyRec) => (b.type === 'text' ? b.text : '')).join('\n') : String(content ?? '')
    let text = IMPROVED
    if (/Find every table/.test(task)) text = JSON.stringify({ tables: [{ title: 'Volumen', header: ['Reagenz', 'µl'], rows: [['Puffer', '50'], ['Enzym', '2,5']] }] })
    else if (task.includes('<passage n=')) text = JSON.stringify({ items: [...task.matchAll(/<passage n="(\d+)">\n([\s\S]*?)\n<\/passage>/g)].map((m) => ({ n: Number(m[1]), markdown: `${m[2]} (neu)` })) })
    else if (system.includes('a list of toggles'))
      text = JSON.stringify({ sections: [{ title: 'Wann?', icon: null, items: [{ style: 'text', text: 'Am Montag.', done: false }] }, { title: 'Wer?', icon: null, items: [{ style: 'text', text: 'Mara Lind.', done: false }] }], keep: [], left: [] })
    else if (system.includes('You turn structured text'))
      text = JSON.stringify({
        title: 'Nordlicht Aufgaben',
        columns: [{ name: 'Status', type: 'select', options: ['Offen', 'Fertig'] }],
        entries: [
          { title: 'Kaffee bestellen', values: [{ column: 'Status', value: 'Offen' }], body: null },
          { title: 'Raum buchen', values: [{ column: 'Status', value: 'Fertig' }], body: null },
        ],
        groupBy: 'Status',
        keep: [],
      })
    try {
      if (body.stream) await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse(text) })
      else
        await route.fulfill({
          status: 200,
          headers: { ...cors, 'content-type': 'application/json' },
          body: JSON.stringify({ id: 'msg_e2e', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }),
        })
    } catch {
      /* the page went away */
    }
  })
}

/** The person's writes through the UI: editors name themselves, everything else is a user event (you~ui). */
const PERSON = /^(you~ui|editor:.+)$/

test.describe('flight recorder — every writer has a lane', () => {
  test('the person: typing, title, cells, board, views, properties, sidebar, slash database, comment', async ({ page }) => {
    const { id, n } = await boot(page, async () => {
      const id = await createPage(page, { title: 'Tessera Notizen', content: doc(para('Nordlicht startet am Montag.')) })
      const n = await nordlichtDb(page)
      await wsEval(page, (s, n) => s.addView(n.db, { type: 'board', name: 'Board', groupBy: n.stage }), n)
      return { id, n }
    })

    // typing: the editor's flush (editor:<id>)
    await gotoPage(page, id)
    let m = await markRec(page)
    await editorOf(page).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' Mara Lind bringt Kaffee.')
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain, id)).toContain('Mara Lind bringt Kaffee')
    await expectLane(page, m, 'you', undefined, /^editor:/)

    // the title field (a user event)
    m = await markRec(page)
    const title = page.locator('#main .pv-title')
    await title.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' 2026')
    await expect(title).toHaveValue('Tessera Notizen 2026')
    await expectLane(page, m, 'you', undefined, 'you~ui')

    // a cover: a random one (written when the cover list arrived), then an uploaded image (written after the file is
    // stored) — the person's both
    m = await markRec(page)
    await page.locator('#main .pv-head').hover()
    await page.locator('#main').getByRole('button', { name: 'Add cover' }).click()
    await expect(page.locator('#main article.pv')).toHaveAttribute('data-has-cover', 'true')
    await expectLane(page, m, 'you', undefined, 'you~ui')
    m = await markRec(page)
    await page.locator('#main .pv-cover').hover()
    await page.locator('#main .pv-cover').getByRole('button', { name: 'Change cover' }).click()
    const coverPicker = page.getByRole('dialog', { name: 'Change cover' })
    await coverPicker.getByRole('tab', { name: 'Upload' }).click()
    const coverFile = page.waitForEvent('filechooser')
    await coverPicker.getByRole('button', { name: 'Choose an image' }).click()
    await (await coverFile).setFiles({ name: 'tessera.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') })
    await expect.poll(async () => String((await pageById(page, id)).cover?.value ?? '')).toMatch(/^onefile:/)
    await expectLane(page, m, 'you', undefined, 'you~ui')
    await page.keyboard.press('Escape')

    // comment: select → Comment → write
    m = await markRec(page)
    await selectText(page, editorOf(page), 'Montag')
    await page.getByRole('toolbar').getByRole('button', { name: 'Comment' }).click()
    await expect(page.getByRole('textbox', { name: 'New comment' })).toBeFocused()
    await page.keyboard.type('Montag bestätigt?')
    await page.keyboard.press('Enter')
    await expect.poll(async () => ((await pageById(page, id)).comments ?? []).length).toBe(1)
    await expectLane(page, m, 'you', undefined, PERSON)

    // slash menu: an inline database
    m = await markRec(page)
    await editorOf(page).click()
    await page.keyboard.press(`Control+End`)
    await page.keyboard.press('Enter')
    await page.keyboard.type('/Table view')
    await expect(page.locator('.slash__item[aria-selected="true"] .slash__name')).toHaveText('Table view')
    await page.keyboard.press('Enter')
    await expect(editorOf(page).locator('section.db.db--inline')).toBeVisible()
    const ops = await expectLane(page, m, 'you', undefined, PERSON)
    expect(ops.some((o) => o.kinds & 32)).toBe(true)

    // a table cell
    await gotoPage(page, n.db)
    m = await markRec(page)
    const row = dbSection(page).locator('.dbt-row[role="row"]', { has: page.locator('.dbt-cell--title', { hasText: /^NL-1398/ }) })
    await row.locator('[role="gridcell"][data-type="number"]').click()
    await expect(page.locator('.db-textedit__area')).toBeFocused()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('13')
    await page.keyboard.press('Enter')
    await expect.poll(() => wsEval(page, (s, a) => s.pages[a.row].properties[a.est], { row: n.rows[0], est: n.est })).toBe(13)
    await expectLane(page, m, 'you', undefined, 'you~ui')

    // the property menu: rename a column
    m = await markRec(page)
    await dbSection(page).locator('.dbt-hcell__btn', { hasText: 'Notiz' }).click()
    const nameField = page.locator('.db-propmenu input').first()
    await nameField.fill('Notiz Tessera')
    await nameField.press('Enter')
    await expect.poll(() => wsEval(page, (s, a) => s.databases[a.db].properties.find((p: AnyRec) => p.id === a.note)?.name, { db: n.db, note: n.note })).toBe('Notiz Tessera')
    await page.keyboard.press('Escape')
    await expectLane(page, m, 'you', undefined, 'you~ui')

    // a view: sort by the estimate
    m = await markRec(page)
    await dbSection(page).getByRole('toolbar', { name: 'Database toolbar' }).getByRole('button', { name: 'Sort' }).click()
    await page.locator('.db-panel').getByRole('button', { name: 'Add sort' }).click()
    await page.getByRole('menuitem', { name: 'Schätzung' }).click()
    await expect.poll(() => wsEval(page, (s, db) => s.databases[db].views[0].sorts.length, n.db)).toBe(1)
    await page.keyboard.press('Escape')
    await expectLane(page, m, 'you', undefined, 'you~ui')

    // the board: drag a card to another lane
    await dbSection(page).getByRole('tab').filter({ hasText: 'Board' }).click()
    await expect(dbSection(page)).toHaveAttribute('data-view', 'board')
    m = await markRec(page)
    const backlog = dbSection(page).locator('section.dbb-col[aria-label="Backlog"]')
    const done = dbSection(page).locator('section.dbb-col[aria-label="Erledigt"]')
    await pointerDrag(page, backlog.locator('.dbc', { hasText: 'NL-1400' }), done.locator('.dbb-col__body'), 30)
    await expect.poll(() => wsEval(page, (s, a) => s.pages[a.row].properties[a.stage], { row: n.rows[2], stage: n.stage })).toBe(n.done)
    await expectLane(page, m, 'you', undefined, 'you~ui')

    // the sidebar: move a page by dragging, duplicate it, trash it, restore it
    const loose = await createPage(page, { title: 'Tessera Ablage' })
    m = await markRec(page)
    // a tall window keeps both rows clear of the tree's edges, where dragging scrolls the tree
    await page.setViewportSize({ width: 1440, height: 1400 })
    const src = sidebarRow(page, 'Tessera Ablage')
    await src.scrollIntoViewIfNeeded()
    const a = (await src.boundingBox())!
    await page.mouse.move(a.x + 60, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(a.x + 60, a.y + a.height / 2 - 8, { steps: 3 })
    const b = (await sidebarRow(page, 'Tessera Notizen 2026').boundingBox())!
    await page.mouse.move(b.x + 60, b.y + b.height / 2, { steps: 15 })
    await page.waitForTimeout(100)
    await page.mouse.up()
    await expect.poll(async () => (await pageById(page, loose)).parentId).toBe(id)
    await expectLane(page, m, 'you', undefined, 'you~ui')

    const rowMenu = async (titleText: string, item: string) => {
      const r = sidebarRow(page, titleText)
      await r.hover()
      await r.getByRole('button', { name: 'More' }).click()
      await page.getByRole('menuitem', { name: item }).click()
    }
    m = await markRec(page)
    await rowMenu('Tessera Notizen 2026', 'Duplicate')
    await expect.poll(() => wsEval(page, (s) => Object.values(s.pages).filter((p: AnyRec) => /^Tessera Notizen 2026/.test(p.title) && !p.trashed).length)).toBe(2)
    await expectLane(page, m, 'you', undefined, 'you~ui')

    m = await markRec(page)
    await gotoPage(page, n.db)
    const sub = sidebarRow(page, 'Tessera Notizen 2026').first()
    await expect(sub).toBeVisible()
    await rowMenu('Nordlicht Handoff', 'Delete')
    await expect.poll(async () => (await pageById(page, n.db)).trashed).toBe(true)
    await expectLane(page, m, 'you', undefined, 'you~ui')

    m = await markRec(page)
    await page.locator('.sb-trash').click()
    const trash = page.getByRole('dialog', { name: 'Trash' })
    await trash.locator('.trash-item', { hasText: 'Nordlicht Handoff' }).getByRole('button', { name: 'Restore' }).click()
    await expect.poll(async () => (await pageById(page, n.db)).trashed).toBe(false)
    await expectLane(page, m, 'you', undefined, 'you~ui')
    await page.keyboard.press('Escape')

    // a toast's Undo: the person's Undo — the undo lane (F6: a bracket of the person's lane never replays it)
    const binned = await createPage(page, { title: 'Tessera Papierkorb' })
    await rowMenu('Tessera Papierkorb', 'Delete')
    await expect.poll(async () => (await pageById(page, binned)).trashed).toBe(true)
    m = await markRec(page)
    await page.locator('.toast', { hasText: 'Tessera Papierkorb' }).getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await pageById(page, binned)).trashed).toBe(false)
    const undone = await expectLane(page, m, 'undo', undefined, /^you~undo/)
    expect(undone.filter((o) => o.l === 'you').map((o) => o.w), 'the Undo on the person\'s own lane').toEqual([])
    expect(undone.find((o) => o.l === 'undo')!.f & 512).toBe(512)

    // ⌘K, Enter on "Create page": cmdk runs the row inside its own select event, relayed from the person's key
    m = await markRec(page)
    await page.keyboard.press(`${MOD}+k`)
    const pal = page.locator('.pal')
    await pal.locator('input').fill('Tessera Neuanlage')
    await expect(pal.getByRole('option').last()).toContainText('Create page “Tessera Neuanlage”')
    await pal.getByRole('option').last().hover()
    await page.keyboard.press('Enter')
    await expect(page.locator('#main .pv-title')).toHaveValue('Tessera Neuanlage')
    await expectLane(page, m, 'you', undefined, 'you~ui')
  })

  test('the workspace: template, Markdown import, CSV intake, history restore, people merge, synced copy, kit value', async ({ page }) => {
    const { a, b, n, rows } = await boot(page, async () => {
      const a = await createPage(page, { title: 'Tessera Quelle', content: doc({ type: 'syncedBlock', attrs: { syncId: 'sy-tessera', sourcePageId: null }, content: [para('Gemeinsam Nordlicht')] }, para('Unten')) })
      const b = await createPage(page, { title: 'Tessera Ziel', content: doc(para('Oben'), { type: 'syncedBlock', attrs: { syncId: 'sy-tessera', sourcePageId: a }, content: [para('Gemeinsam Nordlicht')] }) })
      const n = await nordlichtDb(page)
      // an own type whose value script reads the estimate (kit recompute names its cause)
      const rows = await wsEval(page, (s, n) => {
        s.upsertPropType({ id: 'ampel', name: 'Ampel', base: 'select', scripts: { value: 'let x = row.Schätzung\nlet out = null\nif x != null {\n  out = "Grün"\n  if x > 10 { out = "Rot" }\n}\nout' }, createdAt: 1, updatedAt: 1 })
        return s.addProperty(n.db, { type: 'select', name: 'Ampel', custom: 'ampel', options: [] }) as string
      }, n)
      return { a, b, n, rows }
    })
    void rows

    // a built-in template from the gallery
    let m = await markRec(page)
    await page.locator('.sb').getByRole('button', { name: /^Templates/ }).click()
    const gallery = page.getByRole('dialog', { name: 'Templates' })
    await expect(gallery).toBeVisible()
    await gallery.getByRole('option').first().click()
    await gallery.locator('.tpl-preview').getByRole('button', { name: /Use template/ }).click()
    await expect(gallery).toBeHidden()
    await expectLane(page, m, 'template', /^template:/)

    // a Markdown file through the importer
    m = await markRec(page)
    await page.locator('.sb').getByRole('button', { name: /^Import/ }).click()
    let chooser = page.waitForEvent('filechooser')
    await page.getByRole('dialog').getByRole('button', { name: 'Choose files' }).click()
    await (await chooser).setFiles([{ name: 'nordlicht.md', mimeType: 'text/markdown', buffer: Buffer.from('# Nordlicht Protokoll\n\nMara Lind notiert **drei** Punkte.\n') }])
    await expect(page.getByRole('dialog').getByText(/Import complete/)).toBeVisible()
    await page.keyboard.press('Escape')
    await expectLane(page, m, 'import', /^import:/)

    // CSV into an existing database (the toolbar's intake)
    await gotoPage(page, n.db)
    m = await markRec(page)
    chooser = page.waitForEvent('filechooser')
    await dbSection(page).getByRole('toolbar', { name: 'Database toolbar' }).getByRole('button', { name: 'More' }).click()
    await page.getByRole('menuitem', { name: 'Import CSV into this database…' }).click()
    await (await chooser).setFiles([{ name: 'tessera.csv', mimeType: 'text/csv', buffer: Buffer.from('Name,Schätzung,Ort\nNL-1402,5,Tromsø\nNL-1403,8,Bodø\n') }])
    await page.getByRole('dialog').getByRole('button', { name: 'Import 2 rows' }).click()
    await expect.poll(() => wsEval(page, (s, db) => Object.values(s.pages).filter((p: AnyRec) => p.databaseId === db && /^NL-140[23]$/.test(p.title)).length, n.db)).toBe(2)
    await expectLane(page, m, 'import', /^import:/)

    // the kit: an estimate typed in a cell → the own type's value recomputed, caused by the person
    m = await markRec(page)
    const row = dbSection(page).locator('.dbt-row[role="row"]', { has: page.locator('.dbt-cell--title', { hasText: /^NL-1399/ }) })
    await row.locator('[role="gridcell"][data-type="number"]').click()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('21')
    await page.keyboard.press('Enter')
    await expectLane(page, m, 'kit', undefined, /^kit:ampel<you~ui$/)

    // the synced block: typing in the original, the reference on the other page is a copy on the person's lane
    await gotoPage(page, a)
    m = await markRec(page)
    await editorOf(page).locator('p', { hasText: 'Gemeinsam Nordlicht' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' heute')
    await expect.poll(() => wsEval(page, (s, a) => s.pages[a].plain, a)).toContain('Gemeinsam Nordlicht heute')
    await page.evaluate(() => (window as unknown as { __oneSynced: { flush: () => void } }).__oneSynced.flush())
    await expect.poll(() => wsEval(page, (s, b) => s.pages[b].plain, b)).toContain('Gemeinsam Nordlicht heute')
    const synced = await expectLane(page, m, 'you', undefined, /^synced<editor:/)
    expect(synced.find((o) => /^synced</.test(o.w))!.f & 4).toBe(4)

    // history: save a version, change the page, restore the version
    await page.locator('.tb').getByRole('button', { name: 'Version history' }).click()
    let hist = page.getByRole('dialog')
    await hist.locator('.hist__head').getByRole('button', { name: 'Save version' }).click()
    await page.waitForTimeout(300)
    await page.keyboard.press('Escape')
    await wsEval(page, (s, a) => s.setContent(a, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Alles neu' }] }] }, 'e2e'), a)
    await flush(page)
    m = await markRec(page)
    await page.locator('.tb').getByRole('button', { name: 'Version history' }).click()
    hist = page.getByRole('dialog')
    await hist.locator('.hist__row').nth(1).click()
    await hist.getByRole('button', { name: 'Restore this version' }).click()
    await expect(hist).toBeHidden()
    await expectLane(page, m, 'undo', undefined, /^history:/)

    // people: merge one person into another (values and mentions follow)
    const people = await wsEval(page, (s) => {
      const mara = s.addPerson('Mara Lind') as string
      const ml = s.addPerson('M. Lind') as string
      return { mara, ml }
    })
    await wsEval(page, (s, a) => s.setContent(a.b, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Frag ' }, { type: 'mention', attrs: { id: a.ml, label: 'M. Lind', kind: 'person' } }] }] }, 'e2e'), { b, ml: people.ml })
    await flush(page)
    m = await markRec(page)
    await page.evaluate(() => (window.location.hash = '#/workspace/people'))
    const ml = page.getByTestId('ws-person').filter({ hasText: 'M. Lind' })
    await ml.getByRole('button', { name: 'Actions for M. Lind' }).click()
    await page.getByRole('menuitem', { name: 'Merge into' }).click()
    await page.getByRole('menuitem', { name: 'Mara Lind' }).click()
    await ml.getByRole('button', { name: 'Merge', exact: true }).click()
    await expect(page.locator('.toasts')).toContainText('M. Lind merged into Mara Lind')
    await expectLane(page, m, 'you', undefined, 'you~people')
  })

  test('the person through features: button with a script, form, database command, quick capture', async ({ page }) => {
    const { n, scriptId, row } = await boot(page, async () => {
      const n = await nordlichtDb(page)
      const scriptId = await wsEval(page, (s) => {
        const now = Date.now()
        s.upsertScript({ id: 'sc-nordlicht', name: 'Fertig melden', code: 'page.current.set(Notiz: "fertig")\n', kind: 'script', createdAt: now, updatedAt: now })
        return 'sc-nordlicht'
      })
      const row = n.rows[1]
      await wsEval(page, (s, a) => s.setContent(a.row, { type: 'doc', content: [{ type: 'button', attrs: { label: 'Fertig melden', variant: 'ink', actions: [{ id: 'a1', type: 'run_script', scriptId: a.scriptId }] } }, { type: 'paragraph' }] }, 'e2e'), { row, scriptId })
      await wsEval(page, (s, n) => {
        s.updateDatabase(n.db, { commands: [{ id: 'c-nl', kind: 'actions', label: 'Nordlicht Eintrag', config: { actions: [{ id: 'a1', type: 'add_page', databaseId: n.db, title: 'NL-1410', values: [], open: false }] } }] })
        s.addView(n.db, { type: 'form', name: 'Formular' })
      }, n)
      return { n, scriptId, row }
    })

    // a button that runs a script: the script's run, started by the button
    await gotoPage(page, row)
    let m = await markRec(page)
    await editorOf(page).getByRole('button', { name: 'Fertig melden' }).click()
    await expect.poll(() => wsEval(page, (s, a) => s.pages[a.row].properties[a.note], { row, note: n.note })).toBe('fertig')
    await expectLane(page, m, `script:${scriptId}`, new RegExp(`^script:${scriptId}:`), /<you~button$/)

    // the database command (Actions): a new entry
    m = await markRec(page)
    const sb = sidebarRow(page, 'Nordlicht Handoff')
    await sb.hover()
    await sb.getByTestId('tree-commands').click()
    await page.locator('.popover.cmd-menu').getByRole('menuitem', { name: 'Nordlicht Eintrag' }).click()
    await expect.poll(() => wsEval(page, (s) => Object.values(s.pages).some((p: AnyRec) => p.title === 'NL-1410'))).toBe(true)
    await expectLane(page, m, 'you', undefined, 'you~command')

    // a default command from ⌘K (it runs after the palette closed, outside the key's event): New entry
    m = await markRec(page)
    const rowsBefore = await wsEval(page, (s, db) => Object.values(s.pages).filter((p: AnyRec) => p.databaseId === db).length, n.db)
    await page.keyboard.press(`${MOD}+k`)
    const pal = page.locator('.pal')
    await pal.locator('input').fill('Nordlicht Handoff: new entry')
    await expect(pal.getByRole('option', { name: 'Nordlicht Handoff: New entry', exact: true })).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Enter')
    await expect.poll(() => wsEval(page, (s, db) => Object.values(s.pages).filter((p: AnyRec) => p.databaseId === db).length, n.db)).toBe(rowsBefore + 1)
    await expectLane(page, m, 'you', undefined, 'you~command')
    await page.keyboard.press('Escape')

    // the form builder's text fields: what was typed is committed after a pause (a timer, not an event) — the person's
    await gotoPage(page, n.db)
    await dbSection(page).getByRole('tab').filter({ hasText: 'Formular' }).click()
    await dbSection(page).getByRole('radio', { name: 'Build' }).click()
    const heading = dbSection(page).locator('input.fb-title')
    await expect(heading).toBeVisible()
    m = await markRec(page)
    await heading.fill('Nordlicht Meldung')
    await expect.poll(() => wsEval(page, (s, db) => (s.databases[db].views as AnyRec[]).find((v) => v.type === 'form')?.form?.title ?? '', n.db)).toBe('Nordlicht Meldung')
    await expectLane(page, m, 'you', undefined, 'you~ui')

    // a form: fill mode, submit
    await gotoPage(page, n.db)
    await dbSection(page).getByRole('tab').filter({ hasText: 'Formular' }).click()
    await dbSection(page).getByRole('radio', { name: 'Fill' }).click()
    const form = dbSection(page).locator('form.fm')
    await expect(form).toBeVisible()
    m = await markRec(page)
    await form.locator('.fm-q').first().locator('input').fill('NL-1411')
    await form.getByRole('button', { name: 'Submit' }).click()
    await expect.poll(() => wsEval(page, (s) => Object.values(s.pages).some((p: AnyRec) => p.title === 'NL-1411'))).toBe(true)
    await expectLane(page, m, 'you', undefined, 'you~form')

    // quick capture: a note into Clippings
    m = await markRec(page)
    await page.keyboard.press(`${MOD}+Shift+K`)
    await expect(page.getByRole('textbox', { name: 'Note' })).toBeFocused()
    await page.keyboard.type('Tessera Rückruf')
    await page.keyboard.press('Enter')
    await expect(page.locator('.toast', { hasText: 'Saved to Clippings' })).toBeVisible()
    await expectLane(page, m, 'you', undefined, 'you~clip')
    void escapeRe
  })

  test('the AI family: accept, transform, redo, turn into database / page, pages per item, image → table, file → page', async ({ page, context }) => {
    await mockAIFamily(context)
    const ids = await boot(page, async () => {
      await setKey(page)
      const text = await createPage(page, { title: 'Tessera Entwurf', content: doc(para('Einleitung bleibt.'), para('nordlicht startet irgendwann montag'), para('Schluss.')) })
      const list = await createPage(page, { title: 'Tessera Liste', content: doc(para('Aufgaben:'), para('Kaffee bestellen — Offen'), para('Raum buchen — Fertig'), para('Ende.')) })
      const faq = await createPage(page, { title: 'Tessera FAQ', content: doc(para('Wann? Am Montag.'), para('Wer? Mara Lind.')) })
      const items = await createPage(page, {
        title: 'Tessera Tickets',
        content: doc(para('Diese Woche:'), { type: 'bulletList', content: ['TS-1 Login', 'TS-2 Export'].map((t) => ({ type: 'listItem', content: [para(t)] })) }, para('Danach.')),
      })
      const split = await createPage(page, { title: 'Tessera Teilen', content: doc(para('Bleibt hier.'), { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Abschnitt Nordlicht' }] }, para('Zieht um.')) })
      const file = await page.evaluate(async (data) => {
        const one = (window as unknown as { __one: AnyRec }).__one
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
        const src = await one.files.saveFile(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'Nordlicht.docx')
        const s = one.workspace.getState()
        const id = s.createPage({ title: 'Tessera Datei', parentId: null })
        s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Anhang:' }] }, { type: 'fileBlock', attrs: { src, name: 'Nordlicht.docx', size: bytes.length, display: 'file' } }, { type: 'paragraph' }] }, 'e2e')
        return id
      }, Buffer.from(docxBytes()).toString('base64'))
      return { text, list, faq, items, split, file }
    })

    // the AI menu: Improve writing → Replace selection (ai:<run>:accept)
    await gotoPage(page, ids.text)
    let ed = editorOf(page, ids.text)
    await ed.locator('p', { hasText: 'nordlicht startet' }).click()
    await selectText(page, ed, 'nordlicht startet irgendwann montag')
    let m = await markRec(page)
    let ai = await askAI(page)
    await ai.getByRole('option', { name: /Improve writing/ }).click()
    await ai.getByRole('option', { name: /Replace selection/ }).click()
    await expect(ed.locator('p').nth(1)).toHaveText(IMPROVED)
    await expectLane(page, m, 'ai', /^ai:/, /^ai:.+:accept$/)
    await expectNoPerson(page, m, [`p:${ids.text}`])

    // redo with instructions: one passage, review y, apply
    await selectText(page, ed, 'Einleitung bleibt.')
    m = await markRec(page)
    ai = await askAI(page)
    await ai.locator('#ai-row-more').click()
    await ai.getByRole('option', { name: /Redo with instructions/ }).click()
    await expect(page.getByTestId('ctx-layer')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('redo-setup').getByRole('textbox', { name: 'Instructions' })).toBeFocused()
    await page.keyboard.type('Kürzer.')
    await page.keyboard.press(`${MOD}+Enter`)
    await expect(page.getByTestId('redo-review')).toBeVisible()
    await page.keyboard.press('y')
    await page.keyboard.press('Enter')
    await expect(ed.locator('p').first()).toHaveText('Einleitung bleibt. (neu)')
    await expectLane(page, m, 'ai', /^ai:/, /^ai:.+:redo$/)
    await expectNoPerson(page, m, [`p:${ids.text}`])

    // Turn into database (AI menu → More → preview → Convert)
    await gotoPage(page, ids.list)
    ed = editorOf(page, ids.list)
    await ed.locator('p', { hasText: 'Aufgaben:' }).click()
    await selectRange(page, ed, 'Aufgaben:', 'Raum buchen — Fertig')
    m = await markRec(page)
    ai = await askAI(page)
    await ai.locator('#ai-row-more').click()
    await ai.getByRole('option', { name: /Turn into database/ }).click()
    await expect(page.getByTestId('todb-preview')).toBeVisible()
    await ai.getByRole('option', { name: /Convert/ }).click()
    await expect(ed.locator('section.db')).toBeVisible()
    await expectLane(page, m, 'ai', /^ai:/, /^ai:.+:todb$/)
    // the replaced blocks reach the store through the editor: the AI's write too (editAs), never the person's
    await expectNoPerson(page, m, [`p:${ids.list}`])

    // Transform into → Toggles
    await gotoPage(page, ids.faq)
    ed = editorOf(page, ids.faq)
    await ed.locator('p', { hasText: 'Wann?' }).click()
    await selectRange(page, ed, 'Wann?', 'Mara Lind.')
    m = await markRec(page)
    ai = await askAI(page)
    await ai.getByRole('option', { name: /^Transform into…/ }).click()
    await ai.getByRole('option', { name: /^Toggles/ }).click()
    await expect(page.getByTestId('transform-preview')).toBeVisible()
    await ai.getByRole('option', { name: /^Transform/ }).click()
    await expect(ed.locator('[data-type="details"], details').first()).toBeVisible()
    await expectLane(page, m, 'ai', /^ai:/, /^ai:.+:transform$/)
    await expectNoPerson(page, m, [`p:${ids.faq}`])

    // Turn into page (Mod+Alt+9): the person's split
    await gotoPage(page, ids.split)
    ed = editorOf(page, ids.split)
    await ed.getByText('Abschnitt Nordlicht').click()
    await selectRange(page, ed, 'Abschnitt Nordlicht', 'Zieht um.')
    m = await markRec(page)
    await page.keyboard.press(`${MOD}+Alt+9`)
    await expect(ed.locator('[data-type="page-link"], .page-link, .pagelink').first()).toBeVisible()
    await expectLane(page, m, 'you', undefined, 'you~ui')

    // Sub-page per item: grip → Turn into → Sub-page per item
    await gotoPage(page, ids.items)
    ed = editorOf(page, ids.items)
    await ed.locator('li p', { hasText: 'TS-1 Login' }).click()
    await selectRange(page, ed, 'TS-1 Login', 'TS-2 Export')
    await ed.locator('li p', { hasText: 'TS-2 Export' }).hover()
    m = await markRec(page)
    await page.getByRole('button', { name: /^Block menu$/ }).click()
    await page.locator('[data-popover][role="menu"]').first().getByRole('menuitem', { name: 'Turn into', exact: true }).click()
    await page.getByRole('menuitem', { name: /^Sub-page per item · 2 items/ }).click()
    await expect.poll(() => wsEval(page, (s, id) => Object.values(s.pages).filter((p: AnyRec) => p.parentId === id && !p.trashed).length, ids.items)).toBe(2)
    await expectLane(page, m, 'you', undefined, 'you~ui')

    // a Word file → Open as page (converted here: an import of the file run)
    await gotoPage(page, ids.file)
    const fileCard = editorOf(page, ids.file).locator('.file-view, .pdf-view', { hasText: 'Nordlicht.docx' }).first()
    m = await markRec(page)
    await fileCard.hover()
    await fileCard.getByTestId('file-ai-key').click()
    await page.getByRole('menuitem', { name: /Open as page/ }).click()
    await page.getByRole('dialog', { name: /Ask Claude/ }).getByRole('option', { name: /^Create the page/ }).click()
    await expect.poll(() => wsEval(page, (s, id) => Object.values(s.pages).some((p: AnyRec) => p.parentId === id && !p.trashed), ids.file)).toBe(true)
    await expectLane(page, m, 'import', /^import:/, /^import:.+:file$/)

    // an image → table (Claude reads the picture; the table lands below it)
    const img = await createPage(page, { title: 'Tessera Bild', content: doc(para('Protokoll:'), { type: 'image', attrs: { src: null } }, para('Unten.')) })
    await gotoPage(page, img)
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
    let chooser = page.waitForEvent('filechooser')
    await editorOf(page, img).locator('.media-empty').getByRole('button', { name: /Upload/ }).click()
    await (await chooser).setFiles({ name: 'protokoll.png', mimeType: 'image/png', buffer: png })
    const figure = editorOf(page, img).locator('.image-view').first()
    await expect(figure.locator('img')).toBeVisible()
    await flush(page)
    m = await markRec(page)
    await figure.hover()
    await figure.getByTestId('image-ai-key').click()
    await page.getByRole('menuitem', { name: /Image → table/ }).click()
    await page.getByRole('dialog', { name: /Ask Claude/ }).getByRole('option', { name: /^Insert as table/ }).click()
    await expect(editorOf(page, img).locator('table')).toBeVisible()
    await expectLane(page, m, 'ai', /^ai:/, /^ai:.+:image$/)
    await expectNoPerson(page, m, [`p:${img}`])
    void chooser
  })

  test('Claude at work: terminal apply + edit_page, memory, agent run / undo / review, ⌘K script, MCP media', async ({ page, context }) => {
    const MEDIA = 'https://media.e2e.test'
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    await context.route(`${MEDIA}/**`, (route) => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'image/png' }, body: PNG }))
    let n: Awaited<ReturnType<typeof nordlichtDb>> | null = null
    let target = ''
    const tool = (id: string, name: string, input: Record<string, unknown>) => ({ type: 'tool_use' as const, id, name, input })
    await mockAgent(context, [
      // the terminal: a row and a whole-page edit, staged
      () => sseMessage([tool('tu1', 'create_row', { database_id: n!.db, title: 'NL-1420', properties: {} }), tool('tu2', 'edit_page', { id: target, edits: [{ op: 'replace_all', markdown: 'Nordlicht: alles neu von Claude.' }] })]),
      () => sseMessage([{ type: 'text', text: 'Staged a row and the edit.' }]),
      // a custom agent that applies
      () => sseMessage([tool('ag1', 'update_row', { id: n!.rows[0], properties: { Notiz: 'vom Agenten' } })]),
      () => sseMessage([{ type: 'text', text: '1 row updated.' }]),
      // a custom agent whose changes wait for review
      () => sseMessage([tool('ag2', 'update_row', { id: n!.rows[1], properties: { Notiz: 'Vorschlag' } })]),
      () => sseMessage([{ type: 'text', text: '1 proposal.' }]),
      // the AI menu with an image service: a result with a picture
      () =>
        sseMessage([
          { type: 'mcp_tool_use', id: 'mcptoolu_1', server: 'studio', name: 'generate_image', input: { prompt: 'Nordlicht über Tromsø' } },
          { type: 'mcp_tool_result', id: 'mcptoolu_1', text: JSON.stringify({ status: 'completed', images: [{ url: `${MEDIA}/out/nordlicht.png`, width: 64, height: 64 }] }) },
          { type: 'text', text: 'Hier ist das Bild.' },
        ]),
    ])
    await boot(page, async () => {
      await setKey(page)
      n = await nordlichtDb(page)
      target = await createPage(page, { title: 'Tessera Bericht', content: doc(para('Alter Stand.')) })
      await wsEval(page, (s) => {
        const now = Date.now()
        s.upsertScript({ id: 'sc-tessera', name: 'Tessera markieren', code: 'page.current.set(Notiz: "markiert")\n', kind: 'script', createdAt: now, updatedAt: now })
        s.updateSettings({ mcpServers: [{ id: 'srvstudio1', name: 'studio', url: 'https://mcp.studio.test/mcp', token: 'studio-e2e-token-0001', enabled: true, prompt: 'Makes images.', promptSource: 'auto', tools: ['generate_image'], checkedAt: 1 }] })
      })
    })
    const db = n!

    // the AI terminal: two staged changes, Apply all → the terminal's batch — with the edited page open, so the edit
    // goes through its live editor (editAs)
    await gotoPage(page, target)
    await expect(editorOf(page, target)).toContainText('Alter Stand.')
    let m = await markRec(page)
    await openTerminal(page)
    await runTask(page, 'Neue Zeile und den Bericht neu schreiben')
    await expect(terminal(page).locator('.term-turn').last()).toHaveAttribute('data-status', 'done', { timeout: 20_000 })
    await terminal(page).locator('.term-bar').getByRole('button', { name: 'Apply all' }).click()
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain, target)).toContain('alles neu von Claude')
    await expect(editorOf(page, target)).toContainText('alles neu von Claude')
    const term = await expectLane(page, m, 'terminal', /^terminal:/)
    expect(term.filter((o) => o.l === 'terminal').map((o) => o.p1)).toEqual(expect.arrayContaining([`p:${target}`]))
    await expectNoPerson(page, m, [`p:${target}`])

    // /remember: the person's own words, saved on y
    m = await markRec(page)
    await runTask(page, '/remember Nordlicht-Berichte immer auf Deutsch')
    await expect(terminal(page).getByTestId('term-memory').last()).toContainText('REMEMBER?')
    await page.locator('.term-prompt__input').press('Tab')
    await page.keyboard.press('y')
    await expect(terminal(page).getByTestId('term-memory').last().locator('.term-change')).toHaveAttribute('data-status', 'saved')
    await expectLane(page, m, 'you', undefined, 'you~memory')
    await page.keyboard.press(`${MOD}+j`)

    // a custom agent that applies (agent:<id>:<run>), then its Undo (the undo lane)
    const addAgent = (a: AnyRec) =>
      wsEval(page, (s, a) => {
        const now = Date.now()
        s.upsertAgent({ instructions: 'Keep Nordlicht in step.', trigger: { type: 'manual' }, scope: { everything: false, pages: [], databases: [a.db] }, write: a.write, output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: true, createdAt: now, updatedAt: now, id: a.id, name: a.name })
      }, a)
    await addAgent({ id: 'ag-spiegel', name: 'Nordlicht-Spiegel', write: 'apply', db: db.db })
    await addAgent({ id: 'ag-vorschlag', name: 'Nordlicht-Vorschlag', write: 'stage', db: db.db })
    await flush(page)
    await page.evaluate(() => (window.location.hash = '#/agents/ag-spiegel'))
    await expect(page.locator('.agx-dhead')).toBeVisible()
    m = await markRec(page)
    await page.getByRole('button', { name: 'Run now' }).click()
    await expect(page.locator('.agx-run').first()).toHaveAttribute('data-status', 'ok', { timeout: 20_000 })
    await expectLane(page, m, 'agent:ag-spiegel', /^agent:ag-spiegel:/)
    m = await markRec(page)
    await page.locator('.agx-run').first().getByRole('button', { name: 'Undo changes' }).click()
    await expect.poll(() => wsEval(page, (s, a) => s.pages[a.row].properties[a.note], { row: db.rows[0], note: db.note })).toBe('Nordlicht 0')
    await expectLane(page, m, 'undo', undefined, /^you~undo/)

    await page.evaluate(() => (window.location.hash = '#/agents/ag-vorschlag'))
    await expect(page.locator('.agx-dhead')).toContainText('Nordlicht-Vorschlag')
    await page.getByRole('button', { name: 'Run now' }).click()
    await expect(page.locator('.agx-run').first()).toHaveAttribute('data-status', 'staged', { timeout: 20_000 })
    m = await markRec(page)
    await page.locator('.agx-run').first().getByRole('button', { name: 'Apply all' }).click()
    await expect.poll(() => wsEval(page, (s, a) => s.pages[a.row].properties[a.note], { row: db.rows[1], note: db.note })).toBe('Vorschlag')
    await expectLane(page, m, 'agent:ag-vorschlag', /^agent:ag-vorschlag:/)

    // ⌘K "Run script: <name>" for the open row
    await gotoPage(page, db.rows[2])
    m = await markRec(page)
    await page.keyboard.press(`${MOD}+k`)
    await page.locator('.pal-scrim input').first().fill('Run script: Tessera')
    await expect(page.locator('.pal-scrim [cmdk-item][aria-selected="true"]')).toContainText('Run script: Tessera markieren')
    await page.keyboard.press('Enter')
    await expect.poll(() => wsEval(page, (s, a) => s.pages[a.row].properties[a.note], { row: db.rows[2], note: db.note })).toBe('markiert')
    await expectLane(page, m, 'script:sc-tessera', /^script:sc-tessera:/, /<you(~ui)?$/)

    // an MCP result's picture saved from the AI menu (ai:<run>:media)
    await gotoPage(page, target)
    const ed = editorOf(page, target)
    const ask = page.getByPlaceholder('Ask Claude to write anything…')
    await expect(async () => {
      await ed.locator('p').last().click()
      await page.keyboard.press('End')
      await page.keyboard.press('Enter')
      await page.keyboard.press('Space')
      await expect(ask).toBeFocused({ timeout: 2000 })
    }).toPass({ timeout: 15_000 })
    await ask.fill('studio: Nordlicht über Tromsø')
    await ask.press('Enter')
    const aiDialog = page.getByRole('dialog', { name: 'Ask Claude' })
    await expect(aiDialog.locator('.ai-out__body')).toContainText('Hier ist das Bild')
    m = await markRec(page)
    await aiDialog.locator('[data-testid="media-card"][data-url$="nordlicht.png"]').getByTestId('media-save').click()
    await expect.poll(() => wsEval(page, (s, id) => (s.pages[id].content?.content ?? []).some((b: AnyRec) => b.type === 'image'), target)).toBe(true)
    await expectLane(page, m, 'ai', /^ai:/, /^ai:.+:media$/)
  })

  test('the machines: folder pick-up, automation, autofill, recurring template, mail sync, mirror setup, backup restore', async ({ page, context }, testInfo) => {
    // Claude for autofill (structured: one value, new each time), Google's sign-in and a one-mail Gmail
    let fills = 0
    await context.route('https://api.anthropic.com/**', async (route) => {
      const req = route.request()
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      const body = JSON.parse(req.postData() ?? '{}')
      await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ id: 'msg_e2e', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify({ value: `Kurzfassung ${++fills}` }) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }) })
    })
    await context.route('https://accounts.google.com/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `window.google = { accounts: { oauth2: { initTokenClient(cfg) { return { requestAccessToken() { setTimeout(() => cfg.callback({ access_token: 'ya29.e2e-tessera', expires_in: 3599, scope: cfg.scope, token_type: 'Bearer' }), 30) } } }, hasGrantedAllScopes(r, ...s) { return s.every((x) => String(r.scope || '').split(' ').includes(x)) }, revoke(t, done) { done && done() } } } }`,
      }),
    )
    const mailAt = Date.now() - 2 * 86_400_000
    await context.route('https://gmail.googleapis.com/**', (route) => {
      const req = route.request()
      const cors = { 'access-control-allow-origin': '*' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': 'authorization, accept', 'access-control-allow-methods': 'GET' } })
      const path = new URL(req.url()).pathname.replace('/gmail/v1/users/me/', '')
      const json = (body: unknown) => route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const text = 'Hallo Mara, das Nordlicht-Treffen ist am Montag.'
      if (path === 'profile') return json({ emailAddress: 'mara@example.com', messagesTotal: 1, historyId: '1000' })
      if (path === 'labels') return json({ labels: [{ id: 'INBOX', name: 'INBOX', type: 'system' }] })
      if (path === 'messages') return json({ messages: [{ id: 'm1', threadId: 't1' }], resultSizeEstimate: 1 })
      if (path === 'messages/m1')
        return json({
          id: 'm1', threadId: 't1', labelIds: ['INBOX'], snippet: text, historyId: '1000', internalDate: String(mailAt), sizeEstimate: 512,
          payload: { mimeType: 'text/plain', filename: '', headers: [{ name: 'Subject', value: 'Nordlicht Treffen' }, { name: 'From', value: 'Tessera Team <team@example.test>' }, { name: 'To', value: 'mara@example.com' }, { name: 'Date', value: new Date(mailAt).toUTCString() }, { name: 'Content-Type', value: 'text/plain; charset="UTF-8"' }], body: { size: text.length, data: Buffer.from(text).toString('base64url') } },
        })
      if (path === 'history') return json({ history: [], historyId: '1000' })
      return route.fulfill({ status: 400, headers: cors, body: '{}' })
    })

    const { n, projects, meetings } = await boot(page, async () => {
      await setKey(page)
      const n = await nordlichtDb(page)
      await wsEval(page, (s, n) => s.updateDatabase(n.db, { automations: [{ id: 'au-nl', name: 'Fertig notieren', enabled: true, trigger: { type: 'property_changed', propertyId: n.stage, toValue: n.done }, actions: [{ type: 'set_property', propertyId: n.note, value: 'automatisch' }] }] }), n)
      const projects = await wsEval(page, (s) => {
        const db = s.createDatabase({ title: 'Tessera Projekte' }) as string
        const pts = s.addProperty(db, { type: 'number', name: 'Punkte' }) as string
        s.addProperty(db, { type: 'text', name: 'Kurzfassung', autofill: { preset: 'summary', auto: true, skipReview: true } })
        s.createRow(db, { title: 'Polarlicht Karte', properties: { [pts]: 1 } })
        return db
      })
      // the scheduler waits until the row below starts it (main.tsx starts it at boot)
      await page.evaluate(() => (window as unknown as { __oneRecurring: { stop: () => void } }).__oneRecurring.stop())
      const meetings = await wsEval(page, (s) => {
        const db = s.createDatabase({ title: 'Tessera Termine', properties: [{ id: 'tName', name: 'Name', type: 'title' }, { id: 'tDate', name: 'Datum', type: 'date' }] }) as string
        // missed runs since three days ago: the next pass catches up
        const start = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10)
        s.updateDatabase(db, { templates: [{ id: 'tpl-standup', name: 'Standup', icon: null, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Agenda' }] }] }, properties: {}, repeat: { freq: 'daily', time: '08:00', start, title: 'Standup {{date}}', dateProperty: 'tDate', lastRunAt: Date.now() - 3 * 86_400_000 } }] })
        return db
      })
      await wsEval(page, (s) => s.updateSettings({ mail: { ...(s.settings.mail ?? {}), clientId: '123456789012-e2etestclientid0001.apps.googleusercontent.com', from: new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10) } }))
      await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory()
        const dir = await root.getDirectoryHandle('one-sync-recorder', { create: true })
        await (window as unknown as { __oneSync: { connect: (d: unknown) => Promise<void> } }).__oneSync.connect(dir)
      })
      return { n, projects, meetings }
    })

    // the folder: a new Markdown file picked up (sync:folder:<run>)
    let m = await markRec(page)
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle('one-sync-recorder', { create: true })
      const w = await (await dir.getFileHandle('Nordlicht aus dem Ordner.md', { create: true })).createWritable()
      await w.write('# Nordlicht aus dem Ordner\n\nGeschrieben von Hand.\n')
      await w.close()
      await (window as unknown as { __oneSync: { pickup: () => Promise<void> } }).__oneSync.pickup()
    })
    await expect.poll(() => wsEval(page, (s) => Object.values(s.pages).some((p: AnyRec) => p.title === 'Nordlicht aus dem Ordner'))).toBe(true)
    await expectLane(page, m, 'sync:folder', /^sync:folder:/)

    // an automation: the person sets the stage, the automation writes the note (caused by the person)
    await gotoPage(page, n.db)
    m = await markRec(page)
    const row = dbSection(page).locator('.dbt-row[role="row"]', { has: page.locator('.dbt-cell--title', { hasText: /^NL-1401/ }) })
    await row.locator('[role="gridcell"][data-type="select"]').click()
    await page.locator('.db-picker .db-opt', { hasText: 'Erledigt' }).click()
    await page.keyboard.press('Escape')
    await expect.poll(() => wsEval(page, (s, a) => s.pages[a.row].properties[a.note], { row: n.rows[3], note: n.note })).toBe('automatisch')
    await expectLane(page, m, `automation:${n.db}/au-nl`, new RegExp(`^automation:${escapeRe(n.db)}/au-nl:`), /<you~ui$/)

    // autofill: an input edited by the person → the summary filled automatically (autofill<you~ui)
    await gotoPage(page, projects)
    const summary = () => wsEval(page, (s, db) => {
      const d = s.databases[db]
      const prop = d.properties.find((p: AnyRec) => p.name === 'Kurzfassung').id
      return (Object.values(s.pages).find((p: AnyRec) => p.databaseId === db) as AnyRec).properties[prop] ?? null
    }, projects)
    // the fill of the new property (setup) first
    await expect.poll(summary, { timeout: 20_000 }).not.toBeNull()
    const before = await summary()
    m = await markRec(page)
    const prow = dbSection(page).locator('.dbt-row[role="row"]', { has: page.locator('.dbt-cell--title', { hasText: /^Polarlicht Karte/ }) })
    await prow.locator('[role="gridcell"][data-type="number"]').click()
    await expect(page.locator('.db-textedit__area')).toBeFocused()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('7')
    await page.keyboard.press('Enter')
    await expect.poll(summary, { timeout: 20_000 }).not.toBe(before)
    // the watch's fill has no run of its own (autofill:<db>/<prop><cause>, no flag on the tape)
    await expectLane(page, m, 'autofill', undefined, new RegExp(`^autofill:${escapeRe(projects)}/[^:<]+<you~ui$`))

    // a recurring template: the scheduler's pass creates the missed occurrences (template:<id>:<run>)
    m = await markRec(page)
    await page.evaluate(() => {
      const r = (window as unknown as { __oneRecurring: { start: () => void; run: () => unknown } }).__oneRecurring
      r.start()
      r.run()
    })
    await expect.poll(() => wsEval(page, (s, db) => Object.values(s.pages).filter((p: AnyRec) => p.databaseId === db).length, meetings)).toBeGreaterThan(0)
    await expectLane(page, m, 'template', /^template:tpl-standup:/)

    // mail: connect (mocked Google), sync → the Mails database (mail:<run>)
    m = await markRec(page)
    await page.evaluate(() => (window as unknown as { __one: AnyRec }).__one.ui.getState().openModal({ type: 'settings' }))
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('tab', { name: /Mail$/ }).click()
    await settings.getByRole('button', { name: 'Connect Gmail' }).click()
    await expect(settings.getByTestId('mail-account')).toHaveText('mara@example.com')
    await page.evaluate(() => (window as unknown as { __oneMail: { sync: () => Promise<void> } }).__oneMail.sync())
    await expect.poll(() => page.evaluate(() => (window as unknown as { __oneMail: { state: () => { phase: string } } }).__oneMail.state().phase)).toBe('idle')
    await expect.poll(() => wsEval(page, (s) => Object.values(s.pages).some((p: AnyRec) => p.title === 'Nordlicht Treffen'))).toBe(true)
    await expectLane(page, m, 'mail', /^mail:/)
    await page.keyboard.press('Escape')

    // the mirror setup: database, report page and agent made by the person's setup (you~setup)
    await wsEval(page, (s) => s.updateSettings({ mcpServers: [{ id: 'm-tracker', name: 'tracker', url: 'https://tracker.example.com/mcp', token: '', enabled: true, prompt: '', tools: ['list_items', 'get_item', 'search_items', 'whoami', 'create_item', 'update_item', 'add_comment'], checkedAt: Date.now() }] }))
    await addProfile(page, trackerProfile({ match: { host: '*.example.com' } }))
    await page.evaluate(() => (window.location.hash = '#/agents'))
    await page.locator('.agx').first().waitFor()
    const inline = page.locator('.agx-start [data-recipe="tracker:mirror"]')
    if (await inline.count()) await inline.click()
    else {
      await page.locator('.agx-head .btn--primary').click()
      await page.locator('.agx-recipe-modal [data-recipe="tracker:mirror"]').click()
    }
    const setup = page.locator('.agx-mir')
    await expect(setup).toBeVisible()
    m = await markRec(page)
    await setup.getByRole('button', { name: 'Create database and agent' }).click()
    await expect.poll(() => wsEval(page, (s) => Object.values(s.pages).some((p: AnyRec) => p.title === 'Tracker' && !!s.databases[p.id]))).toBe(true)
    await expectLane(page, m, 'you', undefined, 'you~setup')
    await page.keyboard.press('Escape')

    // backup restore: export the workspace, replace it with the backup (import:<run>:backup)
    await page.keyboard.press('Escape')
    await page.evaluate(() => (window.location.hash = '#/workspace/data'))
    const ws = page.getByTestId('workspace-page')
    await expect(ws).toHaveAttribute('data-section', 'data')
    await ws.getByRole('button', { name: 'Export workspace' }).click()
    let dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: /Whole workspace/ }).click()
    await dialog.getByRole('radio', { name: /Full backup/ }).click()
    const download = page.waitForEvent('download')
    await dialog.locator('[data-export-run]').click()
    const file = testInfo.outputPath('tessera-backup.json')
    await (await download).saveAs(file)
    await page.keyboard.press('Escape')
    // something the backup does not hold: the restore takes it away
    const later = await createPage(page, { title: 'Nach dem Export' })
    m = await markRec(page)
    await page.locator('.sb').getByRole('button', { name: /^Import/ }).click()
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('dialog').getByRole('button', { name: 'Choose files' }).click()
    await (await chooser).setFiles(file)
    dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: /Replace workspace/ }).click()
    await dialog.getByRole('button', { name: 'Replace workspace' }).click()
    await dialog.getByRole('button', { name: 'Yes, replace everything' }).click()
    await expect(dialog.getByText(/Workspace restored/)).toBeVisible()
    await expect.poll(() => wsEval(page, (s, id) => !s.pages[id] || !!s.pages[id].trashed, later)).toBe(true)
    await expectLane(page, m, 'import', /^import:/, /^import:.+:backup$/)
  })
})

/* ------------------------------------------------------------------ */
/* Tasks: writes from outside a task's editor (features/workitems)     */
/* ------------------------------------------------------------------ */

test.describe('flight recorder — tasks', () => {
  const PRINT = 'wi_7a1b2c3d4e'
  const POSTER = 'wi_5f6e7d8c9b'
  const LIVE = 'wi_0a9b8c7d6e'
  const task = (attrs: AnyRec, title: string): AnyRec => ({ type: 'workItem', attrs: { status: 'todo', ...attrs }, content: [para(title)] })
  const attrsOf = (page: Page, id: string, itemId: string) =>
    wsEval(page, (s, a) => (s.pages[a.id].content.content as AnyRec[]).find((n) => n.attrs?.itemId === a.itemId)?.attrs ?? null, { id, itemId })
  /** The op of the row on the other page (its first place). */
  const opOn = (ops: AnyRec[], id: string) => ops.find((o) => o.p1 === `p:${id}`)

  test('a picker write, the card\'s Mark done (it frees a task) and an agenda move: the person\'s (you~ui · you~agenda) on the other page; their Undo on lane undo', async ({ page }) => {
    // Wed 14 Oct 2026: the agenda's days are fixed
    await page.clock.setFixedTime(new Date('2026-10-14T10:00:00'))
    const { other, start } = await boot(page, async () => {
      const other = await createPage(page, { title: 'Nordlicht Druck', content: doc(task({ itemId: PRINT, due: '2026-10-21' }, 'Flyer drucken'), task({ itemId: POSTER }, 'Plakate kleben')) })
      const start = await createPage(page, { title: 'Nordlicht Start', content: doc(task({ itemId: LIVE, blockedBy: [POSTER] }, 'Preisseite live schalten')) })
      return { other, start }
    })
    await gotoPage(page, start)
    const live = editorOf(page, start).locator('.workitem').first()

    // the Blocks picker: the other page's task now waits for this one — written there by writeItems (no editor open)
    await live.locator('.workitem__body p').first().click()
    await page.keyboard.press('End')
    let m = await markRec(page)
    await page.keyboard.press('Alt+Enter')
    await page.locator('[data-popover][role="menu"]').first().getByRole('menuitem', { name: 'Blocks…' }).click()
    const picker = page.getByRole('dialog', { name: 'Blocks' })
    await picker.getByRole('option', { name: /Flyer drucken/ }).click()
    await picker.getByRole('button', { name: 'Done' }).click()
    await expect.poll(async () => (await attrsOf(page, other, PRINT))?.blockedBy).toEqual([LIVE])
    let ops = await expectLane(page, m, 'you', undefined, 'you~ui')
    expect(opOn(ops, other)?.w, 'the picker\'s write on the other page').toBe('you~ui')

    // the blocker's card: Mark done — the person's; it frees "Preisseite live schalten" (the unblock toast, Undo)
    m = await markRec(page)
    await live.locator('.workitem__dep').first().locator('.workitem__chip--dep').click()
    const card = page.getByRole('dialog', { name: 'Plakate kleben' })
    await card.getByRole('button', { name: 'Mark done' }).click()
    const freed = page.locator('.toast').filter({ hasText: /Unblocked: Preisseite live schalten/ })
    await expect(freed).toBeVisible()
    await expect.poll(async () => (await attrsOf(page, other, POSTER))?.status).toBe('done')
    ops = await expectLane(page, m, 'you', undefined, 'you~ui')
    expect(opOn(ops, other)?.w, 'Mark done on the other page').toBe('you~ui')
    m = await markRec(page)
    await freed.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await attrsOf(page, other, POSTER))?.status).toBe('todo')
    ops = await expectLane(page, m, 'undo', undefined, 'you~undo')
    expect(ops.filter((o) => o.l === 'you' && o.p1 === `p:${other}`).map((o) => o.w), 'the Undo on the person\'s own lane').toEqual([])

    // the agenda: Alt+→ moves the task a day (writeItems, the agenda's writer); its toast's Undo is an Undo
    await page.evaluate(() => (window.location.hash = '#/agenda'))
    await expect(page.locator('.ag')).toBeVisible()
    // room on its day: the demo's other sources off (a view setting, no store write)
    for (const name of [/Projects/, /Content calendar/, /Meetings/, /Mentions/]) {
      const key = page.locator('.ag-sources').getByRole('button', { name })
      if (await key.count()) {
        await key.click()
        await expect(key).toHaveAttribute('aria-pressed', 'false')
      }
    }
    const bar = page.locator('.ag-month .ag-bar', { hasText: 'Flyer drucken' })
    await expect(bar).toHaveAttribute('data-start', '2026-10-21')
    m = await markRec(page)
    await bar.focus()
    await page.keyboard.press('Alt+ArrowRight')
    await expect.poll(async () => (await attrsOf(page, other, PRINT))?.due).toBe('2026-10-22')
    ops = await expectLane(page, m, 'you', undefined, 'you~agenda')
    expect(opOn(ops, other)?.w, 'the move on the task\'s page').toBe('you~agenda')
    m = await markRec(page)
    await page.locator('.toast', { hasText: 'moved to' }).getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await attrsOf(page, other, PRINT))?.due).toBe('2026-10-21')
    await expectLane(page, m, 'undo', undefined, 'you~undo')
  })
})

/* ------------------------------------------------------------------ */
/* The Outbox: the person's send by hand and its Undo                  */
/* ------------------------------------------------------------------ */

test.describe('flight recorder — the Outbox', () => {
  test('"Mark as sent": the row patch is the person\'s (you~outbox, after the slip\'s await); "Reset row" is its Undo (lane undo)', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await blockTracker(context)
    context.on('page', (p) => void p.close().catch(() => undefined))
    const m = await boot(page, async () => {
      await outboxLoaded(page)
      return seedMirrorDb(page)
    })
    const row = m.rows['10642']
    const staged = await outbox(page, (o, i) => o.stageSlip(i), { route: routeRef('reply'), rowId: row, draft: 'Nordlicht ships Friday.', origin: { kind: 'api' }, sources: [] })
    const id = staged.slip.id as string
    await page.evaluate((db) => (location.hash = `#/p/${db}`), m.dbId)
    await outbox(page, (o, a) => o.useOutbox.setState({ focus: a.id }), { id })
    const slip = page.getByTestId('outbox-dock').getByTestId('outbox-slip')
    await expect(slip).toHaveAttribute('data-slip', id)
    await expect(slip.getByTestId('outbox-copy')).not.toHaveAttribute('aria-disabled', 'true')
    await slip.getByTestId('outbox-copy').click()
    await expect(slip.getByTestId('outbox-ask')).toBeVisible()

    // "Mark as sent": the slip turns 'sent' (an await), then the route's row patch — the person's press
    let mk = await markRec(page)
    await slip.getByTestId('outbox-mark-sent').click()
    await expect.poll(() => rowValue(page, row, m.props.waiting)).toBe(false)
    await expectLane(page, mk, 'you', undefined, `you~outbox:${id}`)

    // "Reset row" on the receipt: the patch's Undo — on lane undo, never the person's own lane
    const receipt = page.getByTestId('outbox-dock').getByTestId('outbox-receipt')
    mk = await markRec(page)
    await receipt.getByTestId('outbox-reset').click()
    await expect(receipt.getByTestId('outbox-reset-note')).toHaveText('Row reset — only in One; what went out stays out.')
    expect(await rowValue(page, row, m.props.waiting)).toBe(true)
    const undone = await expectLane(page, mk, 'undo', undefined, `you~undo:${id}`)
    expect(undone.filter((o) => o.l === 'you').map((o) => o.w), 'the Reset on the person\'s own lane').toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* Preflight: the queue's keys write as their sources                  */
/* ------------------------------------------------------------------ */

test.describe('flight recorder — Preflight', () => {
  /** Preflight's seam: (seam, arg) → value. */
  const pf = <R, A = null>(page: Page, fn: (p: AnyRec, arg: A) => R | Promise<R>, arg?: A): Promise<R> =>
    page.evaluate(({ src, arg }) => new Function('p', 'arg', `return (${src})(p, arg)`)((window as unknown as { __onePreflight: AnyRec }).__onePreflight, arg), { src: fn.toString(), arg: (arg ?? null) as A }) as Promise<R>
  const card = (page: Page) => page.locator('.pf-q article.pf-card[data-current]')
  /** A lit cap: ↵ opens its queue, the current card takes the keyboard. */
  async function openLamp(page: Page, id: string): Promise<void> {
    await flushLamps(page)
    await page.locator(`.pf-cap[data-lamp="${id}"]`).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('pf-queue').locator(`.pf-tab[data-lamp="${id}"]`)).toHaveAttribute('aria-selected', 'true')
    await expect(card(page)).toBeFocused()
  }
  /** The card is the current one, prepared (its keys usable) and focused. */
  async function ready(page: Page, id: string): Promise<void> {
    await expect(card(page)).toHaveAttribute('data-id', id)
    await expect(card(page)).not.toHaveAttribute('aria-busy', 'true')
    await card(page).focus()
  }
  const done = (page: Page, id: string) => pf(page, (p, id) => p.stores.queue.getState().done.find((d: AnyRec) => d.id === id)?.outcome ?? null, id)

  test.beforeEach(async ({ page, context }) => {
    await page.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
    // nothing leaves the machine (the relay's links)
    await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort())
  })

  test('A on an agent proposal writes as the agent run (agent:<id>:<run>#<change>), its Z on lane undo; A on a terminal change is the terminal\'s batch', async ({ page }) => {
    const m = await boot(page, async () => {
      await waitPreflight(page)
      const m = await seedMirror(page)
      await seedRuns(page, m)
      return m
    })
    await page.evaluate(() => (window.location.hash = '#/'))

    // A: the agents' own review applies it — the run's writer, never the person's
    await openLamp(page, 'proposals')
    await ready(page, 'run:r-now#c1')
    let mk = await markRec(page)
    await page.keyboard.press('a')
    await expect.poll(() => wsEval(page, (s, a) => s.pages[a.row]?.properties[a.prop], { row: m.rows['NL-201'], prop: m.props.comments })).toBe(4)
    await expect.poll(() => done(page, 'run:r-now#c1')).toBe('applied')
    let ops = await expectLane(page, mk, 'agent:ag-spiegel', /^agent:ag-spiegel:r-now$/, /^agent:ag-spiegel:r-now#c1$/)
    expect(ops.filter((o) => o.l === 'you').map((o) => o.w), 'the apply on the person\'s own lane').toEqual([])

    // Z: the person's Undo of that batch (you~undo:<run>)
    mk = await markRec(page)
    await card(page).focus()
    await page.keyboard.press('z')
    await expect.poll(() => wsEval(page, (s, a) => s.pages[a.row]?.properties[a.prop], { row: m.rows['NL-201'], prop: m.props.comments })).not.toBe(4)
    ops = await expectLane(page, mk, 'undo', undefined, 'you~undo:r-now')
    expect(ops.filter((o) => o.l === 'agent:ag-spiegel').map((o) => o.w), 'the Undo on the agent\'s lane').toEqual([])

    // a terminal change staged in this tab: A applies it quietly — the terminal's batch (terminal:<batch>#<change>)
    const notes = await createPage(page, { title: 'Schichtnotizen', content: doc(para('Linie 2.')) })
    await pf(page, (p, a) => p.terminal({ changes: [{ id: 'tc1', n: 1, kind: 'append', status: 'pending', pageId: a.notes, title: 'Schichtnotizen', markdown: 'Linie 2 läuft im kurzen Takt.' }] }), { notes })
    await flushLamps(page)
    const term = await pf(page, (p) => p.stores.queue.getState().items.proposals?.find((i: AnyRec) => i.refs.changeId === 'tc1')?.id ?? null)
    expect(term).not.toBeNull()
    const row = page.getByTestId('pf-queue').locator(`.pf-qr[data-id="${term}"]`)
    await expect(async () => {
      if ((await card(page).getAttribute('data-id')) !== term) await row.click({ timeout: 1000 })
      await expect(card(page)).toHaveAttribute('data-id', term!, { timeout: 1000 })
    }).toPass({ timeout: 15_000 })
    await ready(page, term!)
    mk = await markRec(page)
    await page.keyboard.press('a')
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain, notes)).toContain('kurzen Takt')
    ops = await expectLane(page, mk, 'terminal', /^terminal:/, /^terminal:[^#]+#tc1$/)
    await expectNoPerson(page, mk, [`p:${notes}`])
  })

  test('A on a gate approves through the terminal\'s planner as the person in Preflight (you~preflight:<task>)', async ({ page }) => {
    const pipe = await boot(page, async () => {
      await waitPreflight(page)
      return seedPipeline(page)
    })
    await page.evaluate(() => (window.location.hash = '#/'))
    const task = pipe.tasks[0]
    let gate: string | null = null
    await expect.poll(async () => {
      await flushLamps(page)
      gate = await pf(page, (p, task) => (p.readings().gate?.ids ?? []).find((id: string) => id.startsWith(`task:${task}:`) && id.includes(':gate@')) ?? null, task)
      return gate
    }, { timeout: 15_000 }).not.toBeNull()
    await openLamp(page, 'gate')
    const row = page.getByTestId('pf-queue').locator(`.pf-qr[data-id="${gate}"]`)
    await expect(async () => {
      if ((await card(page).getAttribute('data-id')) !== gate) await row.click({ timeout: 1000 })
      await expect(card(page)).toHaveAttribute('data-id', gate!, { timeout: 1000 })
    }).toPass({ timeout: 15_000 })
    await ready(page, gate!)
    const stageOf = () => wsEval(page, (s, a) => s.pages[a.task]?.properties[Object.values(s.databases[a.db].properties as AnyRec[]).find((p) => p.type === 'select' && (p.options ?? []).some((o: AnyRec) => o.id === a.gate))!.id], { task, db: pipe.dbId, gate: pipe.gateId })
    expect(await stageOf()).toBe(pipe.gateId)
    // VON HAND: A opens the confirm row, ↵ on its key approves
    await page.keyboard.press('a')
    await expect(page.getByTestId('pf-confirm-key')).toBeFocused()
    const mk = await markRec(page)
    await page.keyboard.press('Enter')
    await expect.poll(stageOf).not.toBe(pipe.gateId)
    await expect.poll(() => done(page, gate!)).toBe('hand')
    const ops = await expectLane(page, mk, 'you', undefined, `you~preflight:${task}`)
    expect(ops.filter((o) => o.p1 === `p:${task}` && o.l === 'you').length).toBeGreaterThan(0)
  })
})

/* ------------------------------------------------------------------ */
/* MCP: the built local bridge, driven like Claude Code would          */
/* ------------------------------------------------------------------ */

test.describe('flight recorder — MCP writes', () => {
  test.describe.configure({ mode: 'serial' })
  const BRIDGE = fileURLToPath(new URL('../../public/mcp/one-mcp.mjs', import.meta.url))
  /** RECORDER_MCP_PORT: a port of its own (mcp.spec uses 47399) */
  const PORT = Number(process.env.RECORDER_MCP_PORT) || 47388
  let client: Client
  let stderr = ''

  test.beforeAll(async () => {
    expect(existsSync(BRIDGE), 'public/mcp/one-mcp.mjs (npm run build:mcp)').toBe(true)
    const transport = new StdioClientTransport({ command: process.execPath, args: [BRIDGE], env: { PATH: process.env.PATH ?? '', ONE_MCP_PORT: String(PORT), ONE_MCP_WAIT_MS: '8000' }, stderr: 'pipe' })
    transport.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    client = new Client({ name: 'claude-code', version: '2.0.0' })
    await client.connect(transport)
    await expect.poll(() => stderr).toContain(`waiting for One on ws://127.0.0.1:${PORT}`)
  })
  test.afterAll(async () => {
    await client?.close()
  })

  type ToolResult = { content?: Array<{ type: string; text?: string }>; isError?: boolean }
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as ToolResult
    const text = (r.content ?? []).map((c) => c.text ?? '').join('')
    expect(r.isError, text).toBeFalsy()
    return JSON.parse(text)
  }

  test('an MCP client: create (mcp:<session>:<call>:<tool>), trash and restore (tidy)', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => (window as unknown as { __one: AnyRec }).__one.ui.getState().openModal({ type: 'settings' }))
    await page.getByRole('tab', { name: /Agents · MCP/ }).click()
    const port = page.getByLabel('Port', { exact: true })
    await port.fill(String(PORT))
    await port.press('Enter')
    await page.getByRole('switch', { name: 'Allow AI agents on this computer' }).click()
    await expect(page.getByTestId('mcp-state')).toContainText('Connected · Claude Code')
    await page.getByRole('radio', { name: 'Apply directly' }).click()
    await expect.poll(async () => (await call('one_list_workspaces')).workspaces.length).toBe(1)

    let m = await markRec(page)
    const created = await call('one_create_page', { title: 'Tessera vom Agenten', markdown: '# Nordlicht\n\nVon Claude Code.' })
    await expect.poll(() => wsEval(page, (s, id) => !!s.pages[id], created.id)).toBe(true)
    await expectLane(page, m, /^mcp:/, /^mcp:/, /:one_create_page$/)

    m = await markRec(page)
    await call('one_trash_page', { id: created.id })
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].trashed, created.id)).toBe(true)
    await expectLane(page, m, /^mcp:/, /^mcp:/, /:one_trash_page$/)

    m = await markRec(page)
    await call('one_restore_page', { id: created.id })
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].trashed, created.id)).toBe(false)
    await expectLane(page, m, /^mcp:/, /^mcp:/, /:one_restore_page$/)
  })
})

/* ------------------------------------------------------------------ */
/* Coding: the built worker with the fake Claude Code CLI              */
/* ------------------------------------------------------------------ */

test.describe('flight recorder — coding worker', () => {
  test.describe.configure({ mode: 'serial' })
  /** RECORDER_CODING_PORT: a port of its own (coding.spec uses 47383 / 47384) */
  const PORT = Number(process.env.RECORDER_CODING_PORT) || 47387
  let repo: CodingRepo
  let worker: RunningWorker | null = null
  test.beforeAll(() => {
    repo = makeCodingRepo()
  })
  test.afterAll(async () => {
    await worker?.stop()
    repo?.cleanup()
  })

  test('a stage the worker finishes: its outcome in the task page (coding:<task>:<stage>)', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => (window as unknown as { __one: AnyRec }).__one.ui.getState().openModal({ type: 'settings' }))
    await page.getByRole('tab', { name: /Coding worker/ }).click()
    await expect(page.getByTestId('coding-settings')).toBeVisible()
    const init = await page.locator('.cw-code pre').filter({ hasText: 'init --workspace' }).first().textContent()
    const ws = /--workspace (\S+)/.exec(init ?? '')![1]
    worker = await startCodingWorker(repo, ws, PORT)
    const port = page.getByLabel('Port', { exact: true })
    await port.fill(String(PORT))
    await port.press('Enter')
    await page.getByRole('switch', { name: 'Connect to a coding worker on this computer' }).click()
    await expect(page.getByTestId('coding-conn')).toContainText('Connected · e2e-box · 1 repo')
    await page.keyboard.press('Escape')

    await page.evaluate(() => (window.location.hash = '#/coding'))
    await page.getByTestId('coding-new').click()
    await page.getByTestId('coding-new-title').fill('Nordlicht Datei anlegen')
    await page.getByTestId('coding-new-repo').fill('website')
    await page.getByTestId('coding-new-goal').fill('Write feature.txt with the title.')
    await page.getByTestId('coding-new-criteria').fill('feature.txt exists')
    const m = await markRec(page)
    await page.getByTestId('coding-create').click()
    await expect(page.getByTestId('coding-panel')).toBeVisible()
    // Ready → Plan: the worker's plan lands in the task page, the task waits at "Approve plan"
    await expect(page.getByTestId('coding-approve')).toBeVisible({ timeout: 30_000 })
    await expectLane(page, m, 'coding', /^coding:/)
  })
})

