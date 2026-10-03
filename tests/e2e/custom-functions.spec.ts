/**
 * Custom functions built by clicking (features/sheets/functions): the builder (tree, picker, node
 * menu, parameters, test bench, checks), storage + reload, backup round-trip, database formulas,
 * the keyboard-only path, recursion guard, invalid names, delete with usage warning, German UI.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import type { Locator, Page } from '@playwright/test'
import { test, expect, openApp, gotoPage, wsEval, flush, reloadApp, MOD } from './fixtures'

/* ------------------------------------------------------------------ helpers */

const fx = (page: Page): Locator => page.getByRole('dialog', { name: /^(Functions|Funktionen)$/ })
const chip = (page: Page, path: string): Locator => fx(page).locator(`[data-path="${path}"]`)
const picker = (page: Page): Locator => page.locator('.fx-pick')
const preview = (page: Page): Locator => fx(page).getByTestId('fx-preview')
const result = (page: Page): Locator => fx(page).getByTestId('fx-result')

async function openBuilder(page: Page, label = 'Custom functions') {
  await page.keyboard.press(`${MOD}+k`)
  const pal = page.getByRole('dialog', { name: 'Command palette' })
  await expect(pal).toBeVisible()
  await page.keyboard.type(label)
  await pal.locator('[cmdk-item]', { hasText: label }).first().click()
  await expect(fx(page)).toBeVisible()
}

/** Click a slot, then pick an option by its id ('op:/', 'param:price', 'fn:ROUND') or by typing a query + Enter. */
async function fill(page: Page, path: string, pick: string | { query: string }) {
  await chip(page, path).click()
  await expect(picker(page)).toBeVisible()
  if (typeof pick === 'string') await picker(page).locator(`[data-option="${pick}"]`).click()
  else {
    await picker(page).getByRole('combobox').fill(pick.query)
    await page.keyboard.press('Enter')
  }
  await expect(picker(page)).toHaveCount(0)
}

async function newFunction(page: Page, name: string) {
  await fx(page).locator('[data-new-function]').click()
  const nameField = fx(page).getByRole('textbox', { name: 'Function name' })
  await expect(nameField).toBeFocused()
  await page.keyboard.type(name)
  await expect(nameField).toHaveValue(name)
}

async function addParam(page: Page, name: string, type?: string) {
  const n = await fx(page).locator('.fx-param').count()
  await fx(page).getByRole('button', { name: 'Add parameter' }).click()
  const field = fx(page).getByRole('textbox', { name: `Name of parameter ${n + 1}` })
  await field.fill(name)
  if (type) await fx(page).getByRole('combobox', { name: `Type of ${name}` }).selectOption(type)
}

async function save(page: Page) {
  const btn = fx(page).locator('[data-save]')
  await expect(btn).toBeEnabled()
  await btn.click()
  await expect(btn).toBeDisabled()
}

/** Build MARGIN(price, cost) = ROUND((price − cost) / price, 2) — clicks only. */
async function buildMargin(page: Page) {
  await newFunction(page, 'MARGIN')
  await addParam(page, 'price')
  await addParam(page, 'cost')
  await fill(page, 'root', { query: 'round' })
  await expect(preview(page)).toHaveText('=ROUND(□)')
  await fill(page, '0', 'op:/')
  await fill(page, '0.0', 'op:-')
  await fill(page, '0.0.0', 'param:price')
  await fill(page, '0.0.1', 'param:cost')
  await fill(page, '0.1', 'param:price')
  // the optional second argument of ROUND
  await fx(page).locator('.fx-add', { hasText: 'digits' }).click()
  await fill(page, '1', { query: '2' })
  await expect(preview(page)).toHaveText('=ROUND((price - cost) / price; 2)')
}

/** Text of a database table cell (row by title, column by property name). */
async function cellText(page: Page, rowTitle: string, propName: string): Promise<string> {
  const db = page.locator('#main section.db').first()
  const col = await db
    .locator('.dbt-row--head .dbt-hcell')
    .evaluateAll((cells, name) => cells.findIndex((c) => (c.querySelector('.dbt-hcell__name')?.textContent ?? '').trim() === name), propName)
  expect(col, `column ${propName}`).toBeGreaterThan(0)
  const row = db.locator('.dbt-body .dbt-row[role="row"]', { has: page.locator('.dbt-cell--title', { hasText: rowTitle }) })
  return (await row.locator('[role="gridcell"]').nth(col).innerText()).trim()
}

async function productsDb(page: Page, formula: string): Promise<string> {
  const id = await wsEval(
    page,
    (s, formula) => {
      const db = s.createDatabase({
        title: 'Products',
        properties: [
          { id: 'pName', name: 'Name', type: 'title' },
          { id: 'pPrice', name: 'Price', type: 'number' },
          { id: 'pCost', name: 'Cost', type: 'number' },
          { id: 'pMargin', name: 'Margin', type: 'formula', formula },
          { id: 'pTags', name: 'Tags', type: 'multi_select', options: [{ id: 'tA', name: 'red', color: 'red' }, { id: 'tB', name: 'blue', color: 'blue' }] },
        ],
      })
      s.createRow(db, { title: 'Widget', properties: { pPrice: 100, pCost: 75, pTags: ['tA', 'tB'] } })
      s.createRow(db, { title: 'Gadget', properties: { pPrice: 50, pCost: 10 } })
      return db
    },
    formula,
  )
  await flush(page)
  return id as string
}

/* ------------------------------------------------------------------ tests */

test.describe('custom functions', () => {
  test('build MARGIN by clicking → test bench → database formula → edit → reload', async ({ page }) => {
    await openApp(page)
    // a formula that calls MARGIN before it exists: unknown function, until the function is saved
    const db = await productsDb(page, 'MARGIN(prop("Price"), prop("Cost"))')
    await gotoPage(page, db)
    await expect.poll(() => cellText(page, 'Widget', 'Margin')).not.toBe('0.25')

    await openBuilder(page)
    await buildMargin(page)
    await expect(fx(page).locator('.fx-checks--ok')).toBeVisible()

    // test bench: 100 / 75 → 0.25, plain-language errors (0 / 0 → #DIV/0!)
    await fx(page).locator('[data-sample="price"]').fill('100')
    await fx(page).locator('[data-sample="cost"]').fill('75')
    await expect(result(page)).toHaveText('0.25')
    await fx(page).locator('[data-sample="price"]').fill('0')
    await expect(result(page)).toHaveText('#DIV/0!')
    await expect(fx(page).locator('.fx-bench__why')).toContainText('Divided by zero')
    await fx(page).locator('[data-sample="price"]').fill('100')
    await expect(result(page)).toHaveText('0.25')

    await save(page)
    const stored = await wsEval(page, (s) => Object.values(s.functions ?? {}).map((f: any) => ({ name: f.name, params: f.params.map((p: any) => p.name), body: f.body })))
    expect(stored).toEqual([
      {
        name: 'MARGIN',
        params: ['price', 'cost'],
        body: {
          k: 'call',
          fn: 'ROUND',
          args: [
            { k: 'call', fn: '/', args: [{ k: 'call', fn: '-', args: [{ k: 'param', name: 'price' }, { k: 'param', name: 'cost' }] }, { k: 'param', name: 'price' }] },
            { k: 'num', v: 2 },
          ],
        },
      },
    ])
    await page.keyboard.press('Escape')
    await expect(fx(page)).toHaveCount(0)

    // the database formula now finds it
    await expect.poll(() => cellText(page, 'Widget', 'Margin')).toBe('0.25')
    expect(await cellText(page, 'Gadget', 'Margin')).toBe('0.8')

    // edit: 2 places → 1 place (click the number, type the value)
    await openBuilder(page)
    await expect(fx(page).getByRole('textbox', { name: 'Function name' })).toHaveValue('MARGIN')
    await chip(page, '1').click()
    const value = page.locator('.fx-menu').getByRole('textbox', { name: 'Value' })
    await value.fill('1')
    await page.keyboard.press('Enter')
    await expect(preview(page)).toHaveText('=ROUND((price - cost) / price; 1)')
    await expect(result(page)).toHaveText('0.3')
    await save(page)
    await page.keyboard.press('Escape')
    await expect.poll(() => cellText(page, 'Widget', 'Margin')).toBe('0.3')

    // persisted
    await reloadApp(page)
    expect(await wsEval(page, (s) => Object.values(s.functions ?? {}).map((f: any) => f.name))).toEqual(['MARGIN'])
    await gotoPage(page, db)
    await expect.poll(() => cellText(page, 'Widget', 'Margin')).toBe('0.3')
  })

  test('the formula editor lists custom functions and opens the builder', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) =>
      s.upsertFunction({
        id: 'fn-double',
        name: 'DOUBLE',
        params: [{ name: 'x', type: 'number' }],
        body: { k: 'call', fn: '*', args: [{ k: 'param', name: 'x' }, { k: 'num', v: 2 }] },
        createdAt: 1,
        updatedAt: 1,
      }),
    )
    const db = await productsDb(page, 'DOUBLE(prop("Price"))')
    await gotoPage(page, db)
    await expect.poll(() => cellText(page, 'Widget', 'Margin')).toBe('200')
    // a list (→ a dataset) where a number is expected: the type check answers #VALUE!
    await wsEval(page, (s, db) => s.updateProperty(db, 'pMargin', { formula: 'DOUBLE(prop("Tags"))' }), db)
    await expect(page.locator('#main section.db .db-err').first()).toHaveAttribute('title', 'DOUBLE() returned #VALUE!.')
    await wsEval(page, (s, db) => s.updateProperty(db, 'pMargin', { formula: 'DOUBLE(prop("Cost"))' }), db)
    await expect.poll(() => cellText(page, 'Widget', 'Margin')).toBe('150')

    // the formula editor: a "Custom functions" group + "Build your own…"
    await page.locator('#main section.db .dbt-hcell', { hasText: 'Margin' }).first().click()
    await page.getByRole('menuitem', { name: 'Edit formula' }).click()
    const editor = page.getByRole('dialog', { name: 'Margin' })
    await expect(editor.locator('.db-fx__refitem--fn', { hasText: 'DOUBLE' })).toBeVisible()
    await editor.locator('[data-edit-functions]').click()
    await expect(fx(page)).toBeVisible()
    await expect(fx(page).locator('.fx-item[data-fn="DOUBLE"]')).toBeVisible()
    // the builder sits on top: Escape closes it first, the formula editor stays
    await page.keyboard.press('Escape')
    await expect(fx(page)).toHaveCount(0)
    await expect(editor).toBeVisible()
  })

  test('keyboard only: build DOUBLE(x) = x × 2 in the tree', async ({ page }) => {
    await openApp(page)
    await openBuilder(page)
    await newFunction(page, 'TWICE')
    await addParam(page, 'x')
    await chip(page, 'root').focus()
    // Enter opens the picker, a query + Enter picks
    await page.keyboard.press('Enter')
    await expect(picker(page)).toBeVisible()
    await page.keyboard.type('*')
    await page.keyboard.press('Enter')
    await expect(picker(page)).toHaveCount(0)
    await expect(preview(page)).toHaveText('=□ * □')
    // focus moved to the first empty slot
    await expect(chip(page, '0')).toBeFocused()
    await page.keyboard.press('Enter')
    await page.keyboard.type('x')
    await page.keyboard.press('Enter')
    await expect(chip(page, '1')).toBeFocused()
    // typing on a slot opens the picker with that text: "2" → the number 2
    await page.keyboard.type('2')
    await expect(picker(page)).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(preview(page)).toHaveText('=x * 2')
    // arrows: Home → root, → first argument, ↓ next; Delete empties
    await page.keyboard.press('Home')
    await expect(chip(page, 'root')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(chip(page, '0')).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(chip(page, '1')).toBeFocused()
    await page.keyboard.press('Delete')
    await expect(preview(page)).toHaveText('=x * □')
    await expect(fx(page).locator('.fx-check')).toContainText('1 empty slot')
    await expect(fx(page).locator('[data-save]')).toBeDisabled()
    await page.keyboard.type('3')
    await page.keyboard.press('Enter')
    await expect(preview(page)).toHaveText('=x * 3')
    // ⌘Z undoes in the tree (outside text fields)
    await chip(page, 'root').focus()
    await page.keyboard.press(`${MOD}+z`)
    await expect(preview(page)).toHaveText('=x * □')
    await page.keyboard.press(`${MOD}+Shift+z`)
    await expect(preview(page)).toHaveText('=x * 3')
    // Enter on a filled node: its menu → "Wrap in function…" → ABS
    await chip(page, '0').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.fx-menu')).toBeVisible()
    await page.locator('.fx-menu [data-action="wrap"]').focus()
    await page.keyboard.press('Enter')
    await page.keyboard.type('abs')
    await page.keyboard.press('Enter')
    await expect(preview(page)).toHaveText('=ABS(x) * 3')
    // bench + save with ⌘S
    await fx(page).locator('[data-sample="x"]').fill('-14')
    await expect(result(page)).toHaveText('42')
    await page.keyboard.press(`${MOD}+s`)
    await expect.poll(() => wsEval(page, (s) => Object.values(s.functions ?? {}).map((f: any) => f.name))).toEqual(['TWICE'])
  })

  test('datasets: SPREAD(values: Dataset) = MAX(values) − MIN(values)', async ({ page }) => {
    await openApp(page)
    await openBuilder(page)
    await newFunction(page, 'SPREAD')
    await addParam(page, 'values', 'range')
    await expect(fx(page).getByRole('combobox', { name: 'Type of values' }).locator('option:checked')).toHaveText('Dataset (DS)')
    await fill(page, 'root', 'op:-')
    await fill(page, '0', { query: 'max' })
    await fill(page, '0.0', 'param:values')
    await fill(page, '1', { query: 'min' })
    await fill(page, '1.0', 'param:values')
    await expect(preview(page)).toHaveText('=MAX(values) - MIN(values)')
    // DS itself is never offered inside a body (bodies have no cells)
    await chip(page, '0').click()
    await page.locator('.fx-menu [data-action="replace"]').click()
    await picker(page).getByRole('combobox').fill('ds')
    await expect(picker(page).locator('[data-option="fn:DS"]')).toHaveCount(0)
    await page.keyboard.press('Escape')
    // the bench takes a list for a dataset parameter
    await fx(page).locator('[data-sample="values"]').fill('4; 9; 1')
    await expect(result(page)).toHaveText('8')
    // a comma list, or a semicolon list with decimal commas
    await fx(page).locator('[data-sample="values"]').fill('2, 5, 7')
    await expect(result(page)).toHaveText('5')
    await fx(page).locator('[data-sample="values"]').fill('2,5; 7')
    await expect(result(page)).toHaveText('4.5')
    await save(page)
  })

  test('recursion is capped, invalid names are refused, delete warns about usage', async ({ page }) => {
    await openApp(page)
    await openBuilder(page)
    await newFunction(page, 'LOOP')
    const name = fx(page).getByRole('textbox', { name: 'Function name' })
    // invalid names: a built-in, a cell reference, a leading digit (tidied while typing: lower → UPPER, space → _)
    await name.fill('sum')
    await expect(name).toHaveValue('SUM')
    await expect(fx(page).locator('#fx-name-note')).toContainText('SUM is a built-in function')
    await name.fill('ab12')
    await expect(fx(page).locator('#fx-name-note')).toContainText('reads like a cell reference')
    await name.fill('1st try')
    await expect(name).toHaveValue('1ST_TRY')
    await expect(fx(page).locator('#fx-name-note')).toContainText('Start with a letter')
    await name.fill('loop')
    await expect(fx(page).locator('#fx-name-note')).not.toContainText('built-in')
    await addParam(page, 'n')
    // the function calls itself
    await fill(page, 'root', { query: 'loop' })
    await fill(page, '0', 'param:n')
    await expect(preview(page)).toHaveText('=LOOP(n)')
    await expect(fx(page).locator('.fx-check')).toContainText('LOOP calls itself')
    await save(page)
    // runs into the depth limit: #NUM!, no hang
    await fx(page).locator('[data-sample="n"]').fill('1')
    await expect(result(page)).toHaveText('#NUM!')
    await expect(fx(page).locator('.fx-bench__why')).toContainText('more than 32 levels')

    // used in a database formula → delete warns with the count
    await page.keyboard.press('Escape')
    const db = await productsDb(page, 'LOOP(prop("Price"))')
    await openBuilder(page)
    await fx(page).locator('.fx-item[data-fn="LOOP"]').click()
    await fx(page).getByRole('button', { name: 'Delete' }).click()
    await expect(fx(page).locator('.fx-foot__ask')).toContainText('LOOP is used in 1 place(s)')
    await fx(page).locator('[data-confirm-delete]').click()
    await expect(fx(page).locator('.fx-item[data-fn="LOOP"]')).toHaveCount(0)
    expect(await wsEval(page, (s) => Object.keys(s.functions ?? {}).length)).toBe(0)
    await page.keyboard.press('Escape')
    await gotoPage(page, db)
    await expect.poll(() => cellText(page, 'Widget', 'Margin')).not.toMatch(/^\d/)
  })

  test('unsaved changes ask before closing; renames follow into formulas', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) =>
      s.upsertFunction({ id: 'fn-inc', name: 'INC', params: [{ name: 'x', type: 'number' }], body: { k: 'call', fn: '+', args: [{ k: 'param', name: 'x' }, { k: 'num', v: 1 }] }, createdAt: 1, updatedAt: 1 }),
    )
    const db = await productsDb(page, 'INC(prop("Price"))')
    await gotoPage(page, db)
    await expect.poll(() => cellText(page, 'Widget', 'Margin')).toBe('101')
    await openBuilder(page)
    const name = fx(page).getByRole('textbox', { name: 'Function name' })
    await name.fill('PLUS_ONE')
    await expect(fx(page).locator('#fx-name-note')).toContainText('INC → PLUS_ONE in 1 place')
    // Escape with a draft → asks
    await chip(page, 'root').focus()
    await page.keyboard.press('Escape')
    await expect(fx(page).locator('.fx-foot__ask')).toContainText('Discard unsaved changes in 1 function?')
    await fx(page).getByRole('button', { name: 'Keep editing' }).click()
    await save(page)
    await page.keyboard.press('Escape')
    await expect(fx(page)).toHaveCount(0)
    expect(await wsEval(page, (s, db) => s.databases[db].properties.find((p: any) => p.id === 'pMargin').formula, db)).toBe('PLUS_ONE(prop("Price"))')
    await expect.poll(() => cellText(page, 'Widget', 'Margin')).toBe('101')
  })

  test('spreadsheet cells: =MARGIN(B1; B2), =SPREAD(DS(A1:A3; C1:C2)), type checks, edits and renames follow', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => {
      const now = 1
      s.upsertFunction({
        id: 'fn-margin',
        name: 'MARGIN',
        params: [{ name: 'price', type: 'number' }, { name: 'cost', type: 'number' }],
        body: { k: 'call', fn: 'ROUND', args: [{ k: 'call', fn: '/', args: [{ k: 'call', fn: '-', args: [{ k: 'param', name: 'price' }, { k: 'param', name: 'cost' }] }, { k: 'param', name: 'price' }] }, { k: 'num', v: 2 }] },
        createdAt: now,
        updatedAt: now,
      })
      s.upsertFunction({
        id: 'fn-spread',
        name: 'SPREAD',
        params: [{ name: 'values', type: 'range' }],
        body: { k: 'call', fn: '-', args: [{ k: 'call', fn: 'MAX', args: [{ k: 'param', name: 'values' }] }, { k: 'call', fn: 'MIN', args: [{ k: 'param', name: 'values' }] }] },
        createdAt: now,
        updatedAt: now,
      })
    })
    const cells: Record<string, { v: string }> = {}
    const put = (addr: string, v: string) => (cells[addr] = { v })
    put('A1', '4')
    put('A2', '9')
    put('A3', '1')
    put('B1', '100')
    put('B2', '75')
    put('C1', '12')
    put('C2', '-3')
    put('D1', '=MARGIN(B1; B2)')
    put('D2', '=SPREAD(DS(A1:A3; C1:C2))')
    put('D3', '=MARGIN(DS(A1:A2); 1)')
    put('D4', '=SPREAD(A1:A3)')
    const sheetPage = await wsEval(
      page,
      (s, cells) => {
        const id = s.createPage({ title: 'Price sheet' })
        const sheet = { id: 'sh1', name: 'Sheet1', rows: 20, cols: 8, cells, colWidths: {} }
        s.setContent(id, { type: 'doc', content: [{ type: 'spreadsheet', attrs: { id: 'blk1', title: 'Prices', sheets: [sheet], active: 'sh1', datasets: [], charts: [] } }, { type: 'paragraph' }] }, 'e2e')
        return id as string
      },
      cells,
    )
    await gotoPage(page, sheetPage)
    const cell = (r: number, c: number) => page.locator(`#main [data-cell="${r}:${c}"]`).first()
    await expect(cell(0, 3)).toHaveText('0.25')
    await expect(cell(1, 3)).toHaveText('15')
    // a number parameter given a dataset → #VALUE!
    await expect(cell(2, 3)).toHaveText('#VALUE!')
    // a plain range into a dataset parameter works too
    await expect(cell(3, 3)).toHaveText('8')

    // edit the function → the cell follows
    await openBuilder(page)
    await fx(page).locator('.fx-item[data-fn="MARGIN"]').click()
    await chip(page, '1').click()
    await page.locator('.fx-menu').getByRole('textbox', { name: 'Value' }).fill('1')
    await page.keyboard.press('Enter')
    await save(page)
    await page.keyboard.press('Escape')
    await expect(cell(0, 3)).toHaveText('0.3')

    // rename → the cell formulas are rewritten
    await openBuilder(page)
    await fx(page).locator('.fx-item[data-fn="MARGIN"]').click()
    await fx(page).getByRole('textbox', { name: 'Function name' }).fill('GAIN')
    await expect(fx(page).locator('#fx-name-note')).toContainText('MARGIN → GAIN in 2 place(s)')
    await save(page)
    await page.keyboard.press('Escape')
    const formulas = await wsEval(page, (s, id) => {
      const node = s.pages[id].content.content.find((n: any) => n.type === 'spreadsheet')
      return [node.attrs.sheets[0].cells.D1.v, node.attrs.sheets[0].cells.D3.v]
    }, sheetPage)
    expect(formulas).toEqual(['=GAIN(B1; B2)', '=GAIN(DS(A1:A2); 1)'])
    await expect(cell(0, 3)).toHaveText('0.3')
  })

  test('backup round-trip keeps functions; bad entries in a backup are dropped', async ({ page }, testInfo) => {
    await openApp(page)
    await wsEval(page, (s) =>
      s.upsertFunction({ id: 'fn-half', name: 'HALF', description: 'x / 2', params: [{ name: 'x', type: 'number' }], body: { k: 'call', fn: '/', args: [{ k: 'param', name: 'x' }, { k: 'num', v: 2 }] }, createdAt: 1, updatedAt: 1 }),
    )
    // export a full backup
    await page.keyboard.press(`${MOD}+,`)
    let dialog = page.getByRole('dialog')
    await dialog.getByRole('tab', { name: /Data$/ }).click()
    await dialog.getByRole('button', { name: 'Export workspace' }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: /Whole workspace/ }).click()
    await dialog.getByRole('radio', { name: /Full backup/ }).click()
    const download = page.waitForEvent('download')
    await dialog.locator('[data-export-run]').click()
    const file = testInfo.outputPath('backup.json')
    await (await download).saveAs(file)
    const backup = JSON.parse(readFileSync(file, 'utf8'))
    expect(backup.workspace.functions['fn-half'].name).toBe('HALF')
    await page.keyboard.press('Escape')

    // delete it here, then merge the backup (plus two bad entries) back in
    await wsEval(page, (s) => s.deleteFunction('fn-half'))
    backup.workspace.functions.bad1 = { id: 'bad1', name: 'EVIL', params: [], body: { k: 'js', v: 'alert(1)' }, createdAt: 1, updatedAt: 1 }
    backup.workspace.functions.__proto__x = { id: '__proto__x', name: 'lower', params: [], body: { k: 'num', v: 1 }, createdAt: 1, updatedAt: 1 }
    const tampered = testInfo.outputPath('tampered.json')
    writeFileSync(tampered, JSON.stringify(backup))
    await page.locator('.sb').getByRole('button', { name: /^Import/ }).click()
    dialog = page.getByRole('dialog')
    const chooser = page.waitForEvent('filechooser')
    await dialog.getByRole('button', { name: 'Choose files' }).click()
    await (await chooser).setFiles([{ name: 'tampered.json', mimeType: 'application/json', buffer: readFileSync(tampered) }])
    await dialog.getByRole('button', { name: 'Merge backup' }).click()
    await expect(dialog.getByText(/Backup merged/)).toBeVisible()
    await page.keyboard.press('Escape')
    expect(await wsEval(page, (s) => Object.values(s.functions ?? {}).map((f: any) => f.name))).toEqual(['HALF'])
    await reloadApp(page)
    expect(await wsEval(page, (s) => Object.values(s.functions ?? {}).map((f: any) => f.name))).toEqual(['HALF'])
  })

  test('German UI and phone layout', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await wsEval(page, (s) =>
      s.upsertFunction({ id: 'fn-half', name: 'HALF', params: [{ name: 'x', type: 'range' }], body: { k: 'call', fn: 'SUM', args: [{ k: 'param', name: 'x' }] }, createdAt: 1, updatedAt: 1 }),
    )
    await page.evaluate(() => (window as any).__one.ui.getState().openModal({ type: 'functions' }))
    await expect(fx(page)).toBeVisible()
    // phones: the list first, then the editor with a back key
    await expect(fx(page).getByRole('button', { name: 'Neue Funktion' })).toBeVisible()
    await fx(page).locator('.fx-item[data-fn="HALF"]').click()
    await expect(fx(page).getByRole('button', { name: 'Alle Funktionen' })).toBeVisible()
    await expect(fx(page).getByText('§ 03 Prüfstand')).toBeVisible()
    await expect(fx(page).getByRole('combobox', { name: 'Typ von x' }).locator('option:checked')).toHaveText('Datenbereich (DS)')
    await fx(page).locator('[data-sample="x"]').fill('1; 2; 3,5')
    await expect(result(page)).toHaveText('6.5')
    // nothing sticks out sideways
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
