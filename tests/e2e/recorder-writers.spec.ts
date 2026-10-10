/**
 * Flight recorder — the lane sweep (R1a A13, design §2.7): real paths through the app, each one asserting the
 * lane (and the run key) the journal wrote for it, and that nothing fell back to a guess (`unknowns()` empty, no
 * `unknown` lane). A row = mark the tape → do the thing → `expectLane`. Claude, Gmail and every other host are
 * mocked; the test data is fictional (Nordlicht, Tessera, Mara Lind).
 */
import type { BrowserContext, Locator, Page } from '@playwright/test'
import { test, expect, openApp, wsEval, flush, gotoPage, editorOf, createPage, doc, para, sidebarRow, selectText, pageById, escapeRe, sse, MOD } from './fixtures'
import { docxBytes } from './helpers/files'
import { mockAgent, openTerminal, run as runTask, sseMessage, terminal } from './helpers/terminal'
import { expectLane, markRec, nordlichtDb, rec, startRecorder } from './helpers/recorder'

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

    // the AI terminal: two staged changes, Apply all → the terminal's batch
    let m = await markRec(page)
    await openTerminal(page)
    await runTask(page, 'Neue Zeile und den Bericht neu schreiben')
    await expect(terminal(page).locator('.term-turn').last()).toHaveAttribute('data-status', 'done', { timeout: 20_000 })
    await terminal(page).locator('.term-bar').getByRole('button', { name: 'Apply all' }).click()
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain, target)).toContain('alles neu von Claude')
    const term = await expectLane(page, m, 'terminal', /^terminal:/)
    expect(term.filter((o) => o.l === 'terminal').map((o) => o.p1)).toEqual(expect.arrayContaining([`p:${target}`]))

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
})
