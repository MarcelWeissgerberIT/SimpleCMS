/**
 * Flight recorder — the lane sweep (R1a A13, design §2.7): real paths through the app, each one asserting the
 * lane (and the run key) the journal wrote for it, and that nothing fell back to a guess (`unknowns()` empty, no
 * `unknown` lane). A row = mark the tape → do the thing → `expectLane`. Claude, Gmail and every other host are
 * mocked; the test data is fictional (Nordlicht, Tessera, Mara Lind).
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect, openApp, wsEval, flush, gotoPage, editorOf, createPage, doc, para, sidebarRow, selectText, pageById, escapeRe, MOD } from './fixtures'
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
})
