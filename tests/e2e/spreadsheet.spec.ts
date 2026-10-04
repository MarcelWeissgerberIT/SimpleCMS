/**
 * Spreadsheet block: insertion, formulas, references while editing (colours, point mode),
 * structure edits with reference adjustment, sheets, clipboard, formats, function browser,
 * datasets DS(…), undo, persistence, exports, share links, phone width, German UI; AutoComplete of
 * cell values, Pick from list (Alt+↓), the fill handle (series, names, dates, formulas, double-click,
 * autoscroll, touch) and Fill series.
 */
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { test, expect, openApp, gotoPage, createPage, wsEval, flush, reloadApp, editorOf, MOD } from './fixtures'

type Cells = Record<string, string | { v: string; [k: string]: unknown }>

const toCells = (c: Cells) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, typeof v === 'string' ? { v } : v]))

/** A page with one spreadsheet block (sheets: [name, cells][]). */
async function sheetPage(page: Page, sheets: Array<[string, Cells]>, extra: Record<string, unknown> = {}): Promise<string> {
  const id = await createPage(page, {
    title: 'Sheet test',
    content: {
      type: 'doc',
      content: [
        {
          type: 'spreadsheet',
          attrs: {
            title: '',
            sheets: sheets.map(([name, cells], i) => ({ id: `s${i + 1}`, name, rows: 12, cols: 8, cells: toCells(cells), colWidths: {} })),
            active: 's1',
            datasets: [],
            ...extra,
          },
        },
        { type: 'paragraph' },
      ],
    },
  })
  await gotoPage(page, id)
  await expect(page.locator('.sheet .sg-cell').first()).toBeVisible()
  return id
}

function pos(addr: string): [number, number] {
  const m = /^([A-Z])(\d+)$/.exec(addr)!
  return [Number(m[2]) - 1, m[1].charCodeAt(0) - 65]
}
const cell = (page: Page, addr: string) => page.locator(`.sheet [data-cell="${pos(addr).join(':')}"]`)

/** Click a cell, type, Enter. */
async function enter(page: Page, addr: string, text: string) {
  await cell(page, addr).click()
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}

/** Drag the fill handle of the selection to the middle of a cell (optionally holding Ctrl). */
async function dragFill(page: Page, to: string, opts: { ctrl?: boolean; check?: (page: Page) => Promise<void> } = {}) {
  const h = (await page.locator('.sheet .sg-fill').boundingBox())!
  const t = (await cell(page, to).boundingBox())!
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
  await page.mouse.down()
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 6 })
  if (opts.ctrl) await page.keyboard.down('Control')
  await opts.check?.(page)
  await page.mouse.up()
  if (opts.ctrl) await page.keyboard.up('Control')
}

/** Select a range by click + shift-click. */
async function select(page: Page, from: string, to?: string) {
  await cell(page, from).click()
  if (to) await cell(page, to).click({ modifiers: ['Shift'] })
}

const ghost = (page: Page, where: 'cell' | 'bar' = 'cell') => page.locator(`.fx-input--${where} .fx-ghost`)

/** The block's attrs as stored (after the editor's write debounce). */
async function stored(page: Page, id: string): Promise<{ sheets: Array<{ id: string; name: string; cells: Record<string, { v?: string; fmt?: { type: string } }> }>; datasets: Array<{ name: string; ranges: Array<{ sheet: string; ref: string }> }>; active: string }> {
  await page.waitForTimeout(450)
  return wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.pages[id].content.content.find((n: { type: string }) => n.type === 'spreadsheet').attrs)), id)
}

test.describe('spreadsheet block', () => {
  test('insert from the slash menu, formulas, fill down, insert rows, cycles, undo, reload', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Budget sheet' })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.click()
    await page.keyboard.type('/spreadsheet')
    const item = page.locator('.slash [role="option"]').filter({ hasText: 'Spreadsheet' }).first()
    await expect(item).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.locator('.sheet .sg-cell').first()).toBeVisible()
    await expect(page.locator('.sheet-tab.is-active')).toHaveText('01 · Sheet 1')

    // typing starts editing; Enter commits and moves down
    await cell(page, 'A1').click()
    await page.keyboard.type('10')
    await page.keyboard.press('Enter')
    await page.keyboard.type('20')
    await page.keyboard.press('Enter')
    await page.keyboard.type('30')
    await page.keyboard.press('Enter')
    await page.keyboard.type('=SUM(A1:A3)')
    await page.keyboard.press('Enter')
    await expect(cell(page, 'A4')).toHaveText('60')
    await expect(cell(page, 'A4')).toHaveClass(/is-right/)

    // references are highlighted while the formula is edited, in the formula's colour
    await cell(page, 'A4').click()
    await page.keyboard.press('F2')
    await expect(page.locator('.sheet .sg-ov--edit')).toHaveCount(1)
    await expect(page.locator('.fx-input--cell .fx-m--ref')).toHaveText('A1:A3')
    await expect(page.locator('.sh-bar__ref')).toHaveText('A4')
    await page.keyboard.press('Escape')
    await expect(page.locator('.sheet .sg-ov--edit')).toHaveCount(0)

    // fill down (Ctrl+D) shifts relative references
    await enter(page, 'B1', '=A1*2')
    await cell(page, 'B1').click()
    await cell(page, 'B3').click({ modifiers: ['Shift'] })
    await page.keyboard.press(`${MOD}+d`)
    await expect(cell(page, 'B2')).toHaveText('40')
    await expect(cell(page, 'B3')).toHaveText('60')

    // the status line sums the selection
    await expect(page.locator('.sh-status')).toContainText('SUM 120')
    await expect(page.locator('.sh-status')).toContainText('COUNT 3')

    // insert a row above row 2: the SUM grows with it
    await cell(page, 'A2').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Insert row above' }).click()
    await expect(cell(page, 'A5')).toHaveText('60')
    await enter(page, 'A2', '5')
    await expect(cell(page, 'A5')).toHaveText('65')
    let a = await stored(page, id)
    expect(a.sheets[0].cells.A5.v).toBe('=SUM(A1:A4)')
    expect(a.sheets[0].cells.B3.v).toBe('=A3*2')

    // a cycle is an error value, not a hang
    await enter(page, 'D1', '=D2+1')
    await enter(page, 'D2', '=D1')
    await expect(cell(page, 'D1')).toHaveText('#CYCLE!')
    await expect(cell(page, 'D1')).toHaveAttribute('title', /Circular reference/)

    // undo (editor history) reverts the last edit
    await cell(page, 'D2').click()
    await page.keyboard.press(`${MOD}+z`)
    await expect(cell(page, 'D2')).toHaveText('')
    await expect(cell(page, 'D1')).toHaveText('1')

    // everything survives a reload
    await reloadApp(page)
    await expect(cell(page, 'A5')).toHaveText('65')
    await expect(cell(page, 'B4')).toHaveText('60')
    a = await stored(page, id)
    expect(a.sheets[0].cells.A2.v).toBe('5')
  })

  test('deleting a referenced row gives #REF!, ranges shrink', async ({ page }) => {
    await openApp(page)
    const id = await sheetPage(page, [['Sheet 1', { A1: '1', A2: '2', A3: '3', A5: '=SUM(A1:A3)', A6: '=A2*10', A7: '=A3' }]])
    await expect(cell(page, 'A5')).toHaveText('6')
    await cell(page, 'A2').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Delete row' }).click()
    await expect(cell(page, 'A4')).toHaveText('4')
    await expect(cell(page, 'A5')).toHaveText('#REF!')
    await expect(cell(page, 'A6')).toHaveText('3')
    const a = await stored(page, id)
    expect(a.sheets[0].cells.A4.v).toBe('=SUM(A1:A2)')
    expect(a.sheets[0].cells.A5.v).toBe('=#REF!*10')
    expect(a.sheets[0].cells.A6.v).toBe('=A2')
  })

  test('sheets: add, cross-sheet references, rename, reorder, delete', async ({ page }) => {
    await openApp(page)
    const id = await sheetPage(page, [['Sheet 1', { A1: '7' }]])
    await page.getByRole('button', { name: 'Add sheet' }).click()
    await expect(page.locator('.sheet-tab.is-active')).toHaveText('02 · Sheet 2')
    await enter(page, 'A1', '5')
    await page.locator('.sheet-tab', { hasText: 'Sheet 1' }).click()
    await enter(page, 'B1', "='Sheet 2'!A1*2")
    await expect(cell(page, 'B1')).toHaveText('10')

    // rename (double-click): the formula follows the new name
    await page.locator('.sheet-tab', { hasText: 'Sheet 2' }).dblclick()
    const input = page.getByRole('textbox', { name: 'Sheet name' })
    await input.fill('Q1 Budget')
    await input.press('Enter')
    await expect(page.locator('.sheet-tab', { hasText: 'Q1 Budget' })).toBeVisible()
    await page.locator('.sheet-tab', { hasText: 'Sheet 1' }).click()
    await expect(cell(page, 'B1')).toHaveText('10')
    let a = await stored(page, id)
    expect(a.sheets[0].cells.B1.v).toBe("='Q1 Budget'!A1*2")

    // a name that exists already is refused
    await page.locator('.sheet-tab', { hasText: 'Q1 Budget' }).dblclick()
    await page.getByRole('textbox', { name: 'Sheet name' }).fill('sheet 1')
    await page.getByRole('textbox', { name: 'Sheet name' }).press('Enter')
    await expect(page.locator('.sheet-tabs__problem')).toHaveText('A sheet with this name exists.')
    await page.getByRole('textbox', { name: 'Sheet name' }).press('Escape')

    // reorder with the keyboard (Alt+←) and with the menu
    await page.locator('.sheet-tab', { hasText: 'Q1 Budget' }).click()
    await page.locator('.sheet-tab', { hasText: 'Q1 Budget' }).press('Alt+ArrowLeft')
    await expect(page.locator('.sheet-tab').first()).toHaveText('01 · Q1 Budget')
    await page.locator('.sheet-tab', { hasText: 'Q1 Budget' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Move right' }).click()
    await expect(page.locator('.sheet-tab').first()).toHaveText('01 · Sheet 1')

    // delete (confirmed): references to it become #REF!
    await page.locator('.sheet-tab', { hasText: 'Q1 Budget' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Delete sheet' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(page.locator('.sheet-tab')).toHaveCount(1)
    await expect(cell(page, 'B1')).toHaveText('#REF!')
    a = await stored(page, id)
    expect(a.sheets).toHaveLength(1)
    expect(a.sheets[0].cells.B1.v).toBe('=#REF!*2')
  })

  test('clipboard: copy as TSV, paste TSV from other apps, internal paste moves references', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openApp(page)
    const id = await sheetPage(page, [['Sheet 1', { A1: '1', B1: '2', A2: '3', B2: '4', C1: '=A1+B1' }]])
    await cell(page, 'A1').click()
    await cell(page, 'B2').click({ modifiers: ['Shift'] })
    await page.keyboard.press(`${MOD}+c`)
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('1\t2\n3\t4')

    // TSV from Excel / Sheets / Numbers
    await page.evaluate(() => navigator.clipboard.writeText('Name\tAmount\r\nAda\t1,5\r\n"Grace\nHopper"\t2\r\n'))
    await cell(page, 'E1').click()
    await page.keyboard.press(`${MOD}+v`)
    await expect(cell(page, 'E1')).toHaveText('Name')
    await expect(cell(page, 'F2')).toHaveText('1,5')
    await expect(cell(page, 'E3')).toHaveText('Grace Hopper')

    // an internal copy keeps formulas and shifts their relative references
    await cell(page, 'C1').click()
    await page.keyboard.press(`${MOD}+c`)
    await cell(page, 'C2').click()
    await page.keyboard.press(`${MOD}+v`)
    await expect(cell(page, 'C2')).toHaveText('7')
    const a = await stored(page, id)
    expect(a.sheets[0].cells.C2.v).toBe('=A2+B2')
    expect(a.sheets[0].cells.E1.v).toBe('Name')
  })

  test('number formats: percent, currency, date, bold', async ({ page }) => {
    await openApp(page)
    const id = await sheetPage(page, [['Sheet 1', { A1: '0.256', A2: '1234.5', A3: '2026-10-03', A4: '=A3+30' }]])
    await expect(cell(page, 'A3')).toHaveText('Oct 3, 2026')
    await expect(cell(page, 'A4')).toHaveText('Nov 2, 2026')
    await cell(page, 'A1').click()
    await page.getByRole('button', { name: 'Number format' }).click()
    await page.getByRole('menuitem', { name: 'Percent' }).click()
    await expect(cell(page, 'A1')).toHaveText('26%')
    await page.getByRole('button', { name: 'More decimals' }).click()
    await expect(cell(page, 'A1')).toHaveText('25.6%')
    await cell(page, 'A2').click()
    await page.getByRole('button', { name: 'Number format' }).click()
    await page.getByRole('menuitem', { name: 'Currency €' }).click()
    await expect(cell(page, 'A2')).toHaveText('€1,234.50')
    await page.keyboard.press(`${MOD}+b`)
    await expect(cell(page, 'A2')).toHaveCSS('font-weight', '700')
    // typed currency sets the format
    await enter(page, 'B1', '$5')
    await expect(cell(page, 'B1')).toHaveText('$5.00')
    const a = await stored(page, id)
    expect(a.sheets[0].cells.A1.fmt?.type).toBe('percent')
    expect(a.sheets[0].cells.B1).toMatchObject({ v: '5', fmt: { type: 'currency', currency: 'USD' } })
  })

  test('function browser: search by German Excel name, insert at the caret, autocomplete + signature', async ({ page }) => {
    await openApp(page)
    await sheetPage(page, [['Sheet 1', { A1: 'Nord', B1: '41', A2: 'Süd', B2: '38' }]])
    await cell(page, 'C1').click()
    await page.getByRole('button', { name: 'Functions' }).click()
    const dialog = page.getByRole('dialog', { name: 'Functions' })
    await dialog.getByRole('textbox').fill('sverweis')
    await expect(dialog.getByRole('option')).toHaveCount(1)
    await expect(dialog.getByRole('option')).toContainText('VLOOKUP')
    await dialog.getByRole('textbox').fill('vlookup')
    await expect(dialog.getByRole('option').first()).toContainText('VLOOKUP')
    await dialog.getByRole('textbox').press('Enter')
    const bar = page.getByRole('textbox', { name: 'Formula' })
    await expect(bar).toBeFocused()
    await expect(bar).toHaveValue('=VLOOKUP(')
    // the signature hint marks the current argument
    await page.keyboard.type('"Süd"; ')
    await expect(page.locator('.fx-sig .fx-sig__arg.is-current')).toHaveText('table')
    await page.keyboard.type('A1:B2; 2; FALSE)')
    await page.keyboard.press('Enter')
    await expect(cell(page, 'C1')).toHaveText('38')

    // autocomplete in the cell: "=ave" + Tab → AVERAGE(
    await cell(page, 'C2').click()
    await page.keyboard.type('=ave')
    await expect(page.getByRole('listbox')).toContainText('AVERAGE')
    await page.keyboard.press('Tab')
    await page.keyboard.type('B1:B2)')
    await page.keyboard.press('Enter')
    await expect(cell(page, 'C2')).toHaveText('39.5')
  })

  test('point mode: clicking and dragging cells builds references and DS(…) areas', async ({ page }) => {
    await openApp(page)
    const id = await sheetPage(page, [['Sheet 1', { A1: '1', A2: '2', A3: '3', C1: '10', C2: '20' }]])
    await cell(page, 'E1').click()
    await page.keyboard.type('=SUM(DS(')
    // drag A1 → A3, then ⌘/Ctrl-drag C1 → C2 adds a second area
    await cell(page, 'A1').hover()
    await page.mouse.down()
    await cell(page, 'A3').hover()
    await page.mouse.up()
    await page.keyboard.down(MOD)
    await cell(page, 'C1').hover()
    await page.mouse.down()
    await cell(page, 'C2').hover()
    await page.mouse.up()
    await page.keyboard.up(MOD)
    await expect(page.locator('.fx-input--cell input')).toHaveValue('=SUM(DS(A1:A3; C1:C2')
    await page.keyboard.type('))')
    await page.keyboard.press('Enter')
    await expect(cell(page, 'E1')).toHaveText('36')
    const a = await stored(page, id)
    expect(a.sheets[0].cells.E1.v).toBe('=SUM(DS(A1:A3; C1:C2))')
  })

  test('exports, share link and read-only renders show computed values', async ({ page, browser }) => {
    await openApp(page)
    const id = await sheetPage(page, [
      ['Budget', { A1: 'Item', B1: 'Cost', A2: 'Rent', B2: '1200', A3: 'Tools', B3: '340', A4: 'Total', B4: '=SUM(B2:B3)' }],
      ['Notes', { A1: 'ok' }],
    ])
    await expect(cell(page, 'B4')).toHaveText('1540')
    await flush(page)

    // Markdown folder export
    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('>export')
    await page.keyboard.press('Enter')
    let dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: /Markdown folder/ }).click()
    let download = page.waitForEvent('download')
    await dialog.locator('[data-export-run]').click()
    let d = await download
    const files = unzipSync(new Uint8Array(readFileSync(await d.path())))
    const md = Object.entries(files).find(([p]) => p.endsWith('.md'))!
    const mdText = strFromU8(md[1])
    expect(mdText).toContain('*01 · Budget*')
    expect(mdText).toContain('| Item | Cost |')
    expect(mdText).toContain('| Total | 1540 |')
    expect(mdText).toContain('*02 · Notes*')
    expect(mdText).not.toContain('=SUM')
    await page.keyboard.press('Escape')

    // single-file HTML export
    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('>export')
    await page.keyboard.press('Enter')
    dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: /HTML/ }).first().click()
    download = page.waitForEvent('download')
    await dialog.locator('[data-export-run]').click()
    d = await download
    const html = readFileSync(await d.path(), 'utf8')
    expect(html).toContain('<td class="is-right">1540</td>')
    expect(html).toContain('01 · Budget')
    await page.keyboard.press('Escape')

    // share link → the static table of values
    await page.locator('.tb').getByRole('button', { name: 'Share', exact: true }).click()
    const link = await page.getByRole('dialog').getByRole('textbox', { name: 'Share link' }).inputValue()
    const other = await browser.newContext({ serviceWorkers: 'block', locale: 'en-US' })
    const p2 = await other.newPage()
    await p2.goto(link)
    await expect(p2.locator('.shv__doc .sheet-static__table').first()).toBeVisible()
    await expect(p2.locator('.shv__doc .sheet-static__table').first()).toContainText('1540')
    await expect(p2.locator('.shv__doc figcaption').first()).toHaveText('01 · Budget')
    await other.close()
    void id
  })

  test('datasets: DS(…) values, distinct colours per group, named datasets survive renames and inserts, deleting warns', async ({ page }) => {
    await openApp(page)
    const id = await sheetPage(page, [['Sheet 1', { A1: '1', A2: '2', A3: '3', B1: 'a', B2: 'b', C1: '10', C2: '20', D1: 'x', D2: 'y', E1: '=SUM(DS(A1:A3; C1:C2))' }]])
    await expect(cell(page, 'E1')).toHaveText('36')

    // two DS groups while editing: each group one colour on both of its areas, the groups differ
    await cell(page, 'E2').click()
    await page.keyboard.type('=SUM(DS(A1:A2; C1); DS(B1:B2; D1))')
    const ovs = page.locator('.sheet .sg-ov--edit')
    await expect(ovs).toHaveCount(4)
    const colors = await ovs.evaluateAll((els) => els.map((el) => (el as HTMLElement).style.getPropertyValue('--ov-text')))
    expect(colors[0]).toBe(colors[1])
    expect(colors[2]).toBe(colors[3])
    expect(colors[0]).not.toBe(colors[2])
    // the DS(…) text in the editor has the same colours
    const groupColors = await page.locator('.fx-input--cell .fx-m--group').evaluateAll((els) => [...new Set(els.map((el) => (el as HTMLElement).style.color))])
    expect(groupColors).toHaveLength(2)
    await page.keyboard.press('Enter')
    // text cells (B, D) don't count in SUM: 1 + 2 + 10
    await expect(cell(page, 'E2')).toHaveText('13')

    // one rectangle needed: VLOOKUP over a two-area DS is #VALUE!
    await enter(page, 'F1', '=VLOOKUP(1; DS(A1:B2; C1:D2); 2; FALSE)')
    await expect(cell(page, 'F1')).toHaveText('#VALUE!')
    await enter(page, 'F2', '=VLOOKUP(2; DS(A1:B2); 2; FALSE)')
    await expect(cell(page, 'F2')).toHaveText('b')

    // a named dataset from a multi-area selection (⌘/Ctrl-click adds an area)
    await cell(page, 'A1').click()
    await cell(page, 'A3').click({ modifiers: ['Shift'] })
    await cell(page, 'C1').click({ modifiers: [MOD === 'Meta' ? 'Meta' : 'Control'] })
    await cell(page, 'C2').click({ modifiers: ['Shift'] })
    await expect(page.locator('.sh-bar__ref')).toHaveText('C1:C2 +1')
    await page.getByRole('button', { name: 'Datasets', exact: true }).click()
    const panel = page.getByRole('dialog', { name: 'Datasets' })
    await expect(panel.getByText('Selection: A1:A3; C1:C2')).toBeVisible()
    await panel.getByRole('textbox', { name: 'Dataset name' }).fill('A12')
    await panel.getByRole('button', { name: 'Create' }).click()
    await expect(panel.getByText('That looks like a cell address')).toBeVisible()
    await panel.getByRole('textbox', { name: 'Dataset name' }).fill('Revenue')
    await panel.getByRole('button', { name: 'Create' }).click()
    await expect(panel.locator('[data-dataset="Revenue"]')).toContainText('A1:A3; C1:C2')
    await expect(panel.locator('[data-dataset="Revenue"]')).toContainText('5 cells')
    await page.keyboard.press('Escape')
    await expect(page.locator('.sheet .sg-ov__tag', { hasText: 'DS · REVENUE' })).toHaveCount(2)

    await enter(page, 'G1', '=SUM(DS(Revenue))')
    await expect(cell(page, 'G1')).toHaveText('36')

    // rename the sheet and insert a row above: the dataset follows its cells
    await page.locator('.sheet-tab').dblclick()
    await page.getByRole('textbox', { name: 'Sheet name' }).fill('Plan')
    await page.getByRole('textbox', { name: 'Sheet name' }).press('Enter')
    await cell(page, 'A1').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Insert row above' }).click()
    await expect(cell(page, 'G2')).toHaveText('36')
    await expect(cell(page, 'E2')).toHaveText('36')
    let a = await stored(page, id)
    expect(a.sheets[0].name).toBe('Plan')
    expect(a.datasets[0].ranges.map((r) => r.ref)).toEqual(['A2:A4', 'C2:C3'])
    expect(a.sheets[0].cells.G2.v).toBe('=SUM(DS(Revenue))')

    // delete it: the panel warns how many formulas use it, then they show #NAME?
    await page.getByRole('button', { name: 'Datasets', exact: true }).click()
    await page.getByRole('dialog', { name: 'Datasets' }).getByRole('button', { name: 'Delete: Revenue' }).click()
    const confirm = page.getByRole('dialog')
    await expect(confirm).toContainText('1 cell uses it')
    await confirm.getByRole('button', { name: 'Delete' }).click()
    await expect(cell(page, 'G2')).toHaveText('#NAME?')
    a = await stored(page, id)
    expect(a.datasets).toHaveLength(0)
  })

  test('custom functions run in cells (SPREAD over a dataset)', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) =>
      s.upsertFunction({
        id: 'fnspread',
        name: 'SPREAD',
        params: [{ name: 'values', type: 'range' }],
        body: { k: 'call', fn: '-', args: [{ k: 'call', fn: 'MAX', args: [{ k: 'param', name: 'values' }] }, { k: 'call', fn: 'MIN', args: [{ k: 'param', name: 'values' }] }] },
        createdAt: 0,
        updatedAt: 0,
      }),
    )
    await sheetPage(page, [['Sheet 1', { A1: '4', A2: '9', A3: '1', B2: '20', B3: '-3', C1: '=SPREAD(DS(A1:A3; B2:B3))' }]])
    await expect(cell(page, 'C1')).toHaveText('23')
  })

  test('charts: from the selection, live with the cells, refs follow inserted rows, placed as a block', async ({ page }) => {
    await openApp(page)
    const id = await sheetPage(page, [['Sheet 1', { A1: 'Month', B1: 'Sales', A2: 'Jan', B2: '10', A3: 'Feb', B3: '20', A4: 'Mar', B4: '30' }]])
    await cell(page, 'A1').click()
    await cell(page, 'B4').click({ modifiers: ['Shift'] })
    await page.getByRole('button', { name: 'Chart', exact: true }).click()
    await page.locator('[data-testid="chart-builder-save"]').click()
    const card = page.locator('.sheet .sh-chart')
    await expect(card).toHaveCount(1)
    await expect(card.locator('.sh-chart__ref')).toHaveText('A1:B4')
    await card.getByRole('button', { name: 'Data table' }).click()
    await expect(card.locator('.ch-table')).toContainText('30')

    // the chart follows the cells
    await enter(page, 'B4', '75')
    await expect(card.locator('.ch-table')).toContainText('75')
    const a = (await stored(page, id)) as unknown as { charts: Array<{ sheet: string; spec: { source: { kind: string; ref: string } } }> }
    expect(a.charts[0].sheet).toBe('s1')
    expect(a.charts[0].spec.source).toEqual({ kind: 'inline', ref: 'A1:B4' })

    // inserting a row above moves its reference
    await cell(page, 'A1').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Insert row above' }).click()
    await expect(card.locator('.sh-chart__ref')).toHaveText('A2:B5')
    await expect(card.locator('.ch-table')).toContainText('75')

    // place it as a chart block below: it reads this spreadsheet by block id
    await card.getByRole('button', { name: 'Chart options' }).click()
    await page.getByRole('menuitem', { name: 'Place as block below' }).click()
    await page.waitForTimeout(500)
    const placed = await wsEval(page, (s, id) => {
      const content = s.pages[id].content.content
      const sheetNode = content.find((n: { type: string }) => n.type === 'spreadsheet')
      const chart = content.find((n: { type: string }) => n.type === 'chart')
      return { blockId: sheetNode.attrs.id, source: chart?.attrs?.spec?.source }
    }, id)
    expect(placed.source).toEqual({ kind: 'sheet', pageId: id, sheetBlockId: placed.blockId, ref: "'Sheet 1'!A2:B5" })
    await expect(page.locator('.ProseMirror [data-type="chart"]').first()).toBeVisible()
  })

  test('phone width: the block scrolls inside itself, the page does not', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openApp(page)
    await sheetPage(page, [['Sheet 1', { A1: 'wide', H1: 'end' }]])
    const grid = page.locator('.sheet .sg')
    const sizes = await grid.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }))
    expect(sizes.scroll).toBeGreaterThan(sizes.client)
    const doc = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
    expect(doc.scroll).toBeLessThanOrEqual(doc.client)
    const box = await page.locator('.sheet').boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
    // tap a cell, edit through the formula bar
    await cell(page, 'B2').click()
    await page.getByRole('textbox', { name: 'Formula' }).click()
    await page.keyboard.type('=2*21')
    await page.keyboard.press('Enter')
    await expect(cell(page, 'B2')).toHaveText('42')
  })

  test('AutoComplete: the column proposes, Enter / Tab / → take it, Backspace drops it, numbers and formulas never', async ({ page }) => {
    await openApp(page)
    const id = await sheetPage(page, [['Sheet 1', { A1: 'Task', A2: 'Website relaunch', A3: 'Design review', C1: '12 apples', C2: '7' }]])
    const input = page.locator('.fx-input--cell input')

    // typing under the entries: the nearest match appears after the typed text (cell and formula bar)
    await cell(page, 'A4').click()
    await page.keyboard.type('web')
    await expect(input).toHaveValue('web')
    await expect(ghost(page)).toHaveText('site relaunch')
    await expect(ghost(page, 'bar')).toHaveText('site relaunch')
    // Enter takes it, with the entry's casing, and moves down
    await page.keyboard.press('Enter')
    await expect(cell(page, 'A4')).toHaveText('Website relaunch')
    await expect(page.locator('.sh-bar__ref')).toHaveText('A5')

    // typing narrows; Backspace drops the proposal and keeps the typed text; typing on proposes again
    await page.keyboard.type('D')
    await expect(ghost(page)).toHaveText('esign review')
    await page.keyboard.type('es')
    await expect(ghost(page)).toHaveText('ign review')
    await page.keyboard.press('Backspace')
    await expect(ghost(page)).toHaveCount(0)
    await expect(input).toHaveValue('Des')
    await page.keyboard.type('i')
    await expect(ghost(page)).toHaveText('gn review')
    // Esc cancels the edit as always
    await page.keyboard.press('Escape')
    await expect(cell(page, 'A5')).toHaveText('')

    // Tab takes it and moves right
    await page.keyboard.type('d')
    await page.keyboard.press('Tab')
    await expect(cell(page, 'A5')).toHaveText('Design review')
    await expect(page.locator('.sh-bar__ref')).toHaveText('B5')

    // → takes it and keeps editing
    await cell(page, 'A6').click()
    await page.keyboard.type('Webs')
    await page.keyboard.press('ArrowRight')
    await expect(input).toHaveValue('Website relaunch')
    await expect(ghost(page)).toHaveCount(0)
    await page.keyboard.type(' 2')
    await page.keyboard.press('Enter')
    await expect(cell(page, 'A6')).toHaveText('Website relaunch 2')

    // numbers are never completed (nor completing), formulas neither
    await cell(page, 'C3').click()
    await page.keyboard.type('12')
    await expect(ghost(page)).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect(cell(page, 'C3')).toHaveText('12')
    await cell(page, 'C4').click()
    await page.keyboard.type('=1')
    await expect(ghost(page)).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(cell(page, 'C4')).toHaveText('')

    // the formula bar completes as well
    await cell(page, 'A7').click()
    await page.getByRole('textbox', { name: 'Formula' }).click()
    await page.keyboard.type('Desi')
    await expect(ghost(page, 'bar')).toHaveText('gn review')
    await page.keyboard.press('Enter')
    await expect(cell(page, 'A7')).toHaveText('Design review')

    const a = await stored(page, id)
    expect(a.sheets[0].cells.A4.v).toBe('Website relaunch')
    expect(a.sheets[0].cells.A6.v).toBe('Website relaunch 2')
    expect(a.sheets[0].cells.C3.v).toBe('12')
  })

  test('AutoComplete can be switched off per device (⋯ menu), and stays off after a reload', async ({ page }) => {
    await openApp(page)
    await sheetPage(page, [['Sheet 1', { A1: 'Website relaunch' }]])
    const more = page.locator('.sheet .sh-tb').getByRole('button', { name: 'More', exact: true })
    await more.click()
    const item = page.getByRole('menuitem', { name: /AutoComplete cell values/ })
    await expect(item).toContainText('ON')
    await item.click()
    await cell(page, 'A2').click()
    await page.keyboard.type('Web')
    await expect(ghost(page)).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect(cell(page, 'A2')).toHaveText('Web')
    expect(await page.evaluate(() => localStorage.getItem('one.sheets.autocomplete'))).toBe('0')

    await reloadApp(page)
    await cell(page, 'A3').click()
    await page.keyboard.type('Webs')
    await expect(ghost(page)).toHaveCount(0)
    await page.keyboard.press('Escape')
    await more.click()
    await expect(page.getByRole('menuitem', { name: /AutoComplete cell values/ })).toContainText('OFF')
    await page.getByRole('menuitem', { name: /AutoComplete cell values/ }).click()
    await cell(page, 'A3').click()
    await page.keyboard.type('Webs')
    await expect(ghost(page)).toHaveText('ite relaunch')
  })

  test('Pick from list: Alt+↓ and the cell menu offer the column texts, type to narrow, ↵ takes', async ({ page }) => {
    await openApp(page)
    const id = await sheetPage(page, [['Sheet 1', { B1: 'Owner', B2: 'Grace', B3: 'Ada', B4: 'grace', B5: '42' }]])
    await cell(page, 'B6').click()
    await page.keyboard.press('Alt+ArrowDown')
    const list = page.getByRole('dialog', { name: 'Pick from list' })
    await expect(list.getByRole('option')).toHaveText(['Ada', 'grace', 'Owner'])
    await expect(list).toContainText('3 ENTRIES · COLUMN B')
    await page.keyboard.type('ow')
    await expect(list.getByRole('option')).toHaveText(['Owner'])
    await page.keyboard.press('Enter')
    await expect(list).toHaveCount(0)
    await expect(cell(page, 'B6')).toHaveText('Owner')
    // the grid has the keyboard again
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.sh-bar__ref')).toHaveText('B7')

    // from the cell menu, ↓ ↵; Esc closes without writing
    await cell(page, 'B7').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Pick from list…' }).click()
    await expect(list.getByRole('option').first()).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(cell(page, 'B7')).toHaveText('grace')
    await cell(page, 'B8').click()
    await page.keyboard.press('Alt+ArrowDown')
    await expect(list).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(list).toHaveCount(0)
    await expect(cell(page, 'B8')).toHaveText('')
    await expect(page.locator('.sheet .sg')).toBeFocused()

    // while typing in a cell, the list starts filtered by the typed text
    await page.keyboard.type('a')
    await page.keyboard.press('Alt+ArrowDown')
    await expect(list.getByRole('option')).toHaveText(['Ada', 'grace'])
    await page.keyboard.press('Enter')
    await expect(cell(page, 'B8')).toHaveText('Ada')
    const a = await stored(page, id)
    expect(a.sheets[0].cells.B6.v).toBe('Owner')
    expect(a.sheets[0].cells.B8.v).toBe('Ada')
  })

  test('fill handle: number series, dates, weekdays, months, numbered text, formulas, Ctrl copies / counts, undo in one step', async ({ page }) => {
    await openApp(page)
    const id = await sheetPage(page, [
      [
        'Sheet 1',
        {
          A1: '1',
          A2: '2',
          B1: '2026-01-31',
          B2: '2026-02-28',
          C1: 'Mon',
          D1: 'Januar',
          E1: 'Item 1',
          F1: '=A1*2+$A$1',
          C6: { v: '5', fmt: { type: 'currency', currency: 'EUR' } },
          C8: '5',
          A12: 'Q1',
        },
      ],
    ])

    // 1, 2 → 3 … 6, with a live preview and the last value in the tooltip
    await select(page, 'A1', 'A2')
    await dragFill(page, 'A6', {
      check: async (p) => {
        await expect(p.locator('.sheet .sg-fillprev')).toHaveCount(1)
        await expect(p.locator('.sheet .sg-fillprev__tip')).toHaveText('→ 6')
      },
    })
    await expect(page.locator('.sheet .sg-fillprev')).toHaveCount(0)
    for (const [addr, v] of [['A3', '3'], ['A4', '4'], ['A5', '5'], ['A6', '6']]) await expect(cell(page, addr)).toHaveText(v)
    // the filled range is selected
    await expect(page.locator('.sh-bar__ref')).toHaveText('A1:A6')

    // month ends stay month ends
    await select(page, 'B1', 'B2')
    await dragFill(page, 'B4')
    await expect(cell(page, 'B3')).toHaveText('Mar 31, 2026')
    await expect(cell(page, 'B4')).toHaveText('Apr 30, 2026')

    // weekday and month names, numbered text
    await select(page, 'C1')
    await dragFill(page, 'C4')
    await expect(cell(page, 'C2')).toHaveText('Tue')
    await expect(cell(page, 'C4')).toHaveText('Thu')
    await select(page, 'D1')
    await dragFill(page, 'D3')
    await expect(cell(page, 'D2')).toHaveText('Februar')
    await expect(cell(page, 'D3')).toHaveText('März')
    await select(page, 'E1')
    await dragFill(page, 'E3')
    await expect(cell(page, 'E2')).toHaveText('Item 2')
    await expect(cell(page, 'E3')).toHaveText('Item 3')

    // formulas shift their relative references, $A$1 stays
    await select(page, 'F1')
    await dragFill(page, 'F3')
    await expect(cell(page, 'F2')).toHaveText('5')
    await expect(cell(page, 'F3')).toHaveText('7')

    // one number is copied (format too); Ctrl-drag counts up
    await select(page, 'C6')
    await dragFill(page, 'C7')
    await expect(cell(page, 'C7')).toHaveText('€5.00')
    await select(page, 'C8')
    await dragFill(page, 'C10', { ctrl: true })
    await expect(cell(page, 'C9')).toHaveText('6')
    await expect(cell(page, 'C10')).toHaveText('7')

    // to the right: Q1 → Q2, Q3
    await select(page, 'A12')
    await dragFill(page, 'C12')
    await expect(cell(page, 'B12')).toHaveText('Q2')
    await expect(cell(page, 'C12')).toHaveText('Q3')

    let a = await stored(page, id)
    const c = a.sheets[0].cells
    expect(c.B3.v).toBe('2026-03-31')
    expect(c.F2.v).toBe('=A2*2+$A$1')
    expect(c.F3.v).toBe('=A3*2+$A$1')
    expect(c.C7).toEqual({ v: '5', fmt: { type: 'currency', currency: 'EUR' } })

    // one undo step takes the whole last fill back
    await page.keyboard.press(`${MOD}+z`)
    await expect(cell(page, 'B12')).toHaveText('')
    await expect(cell(page, 'C12')).toHaveText('')
    await expect(cell(page, 'A12')).toHaveText('Q1')
    await expect(cell(page, 'C10')).toHaveText('7')
    a = await stored(page, id)
    expect(a.sheets[0].cells.B12).toBeUndefined()
  })

  test('fill handle: double-click fills down to the end of the neighbour column; drag up continues backwards; Esc cancels', async ({ page }) => {
    await openApp(page)
    const id = await sheetPage(page, [['Sheet 1', { A1: '10', A2: '20', A3: '30', A4: '40', A5: '50', B1: '=A1*2', D5: '5', D6: '6' }]])
    await select(page, 'B1')
    const h = (await page.locator('.sheet .sg-fill').boundingBox())!
    await page.mouse.dblclick(h.x + h.width / 2, h.y + h.height / 2)
    await expect(cell(page, 'B5')).toHaveText('100')
    await expect(cell(page, 'B6')).toHaveText('')
    await expect(page.locator('.sh-bar__ref')).toHaveText('B1:B5')
    let a = await stored(page, id)
    expect(a.sheets[0].cells.B5.v).toBe('=A5*2')

    // dragging up continues a series backwards
    await select(page, 'D5', 'D6')
    await dragFill(page, 'D2')
    await expect(cell(page, 'D2')).toHaveText('2')
    await expect(cell(page, 'D4')).toHaveText('4')

    // Esc during the drag cancels it
    await select(page, 'A5')
    const box = (await page.locator('.sheet .sg-fill').boundingBox())!
    const to = (await cell(page, 'A8').boundingBox())!
    await page.mouse.move(box.x + 3, box.y + 3)
    await page.mouse.down()
    await page.mouse.move(to.x + 10, to.y + 10, { steps: 4 })
    await expect(page.locator('.sheet .sg-fillprev')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(page.locator('.sheet .sg-fillprev')).toHaveCount(0)
    await page.mouse.up()
    await expect(cell(page, 'A6')).toHaveText('')
    a = await stored(page, id)
    expect(a.sheets[0].cells.A6).toBeUndefined()
  })

  test('Fill series (cell menu, also from the keyboard) continues each column from its first cells', async ({ page }) => {
    await openApp(page)
    const id = await sheetPage(page, [['Sheet 1', { A1: '3', B1: 'Mo', C1: '2026-10-30' }]])
    await select(page, 'A1', 'C4')
    // Shift+F10 opens the cell menu under the active cell
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Fill series' }).click()
    await expect(page.locator('.sheet .sg')).toBeFocused()
    await expect(cell(page, 'A4')).toHaveText('6')
    await expect(cell(page, 'B4')).toHaveText('Do')
    await expect(cell(page, 'C4')).toHaveText('Nov 2, 2026')
    const a = await stored(page, id)
    expect(a.sheets[0].cells.A2.v).toBe('4')
    expect(a.sheets[0].cells.C3.v).toBe('2026-11-01')
  })

  test('fill handle: frozen row, virtualised rows and autoscroll at the edge; a chart follows live; read-only shows no handle', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, {
      title: 'Long sheet',
      content: {
        type: 'doc',
        content: [
          {
            type: 'spreadsheet',
            attrs: {
              title: '',
              sheets: [{ id: 's1', name: 'Sheet 1', rows: 120, cols: 4, frozenRows: 1, cells: { A1: { v: 'n' }, A2: { v: '1' }, A3: { v: '2' }, B1: { v: '=SUM(A2:A120)' } }, colWidths: {} }],
              active: 's1',
              datasets: [],
              charts: [{ id: 'c1', sheet: 's1', spec: { kind: 'bar', title: 'Run', source: { kind: 'inline', ref: 'A1:A6' } } }],
            },
          },
          { type: 'paragraph' },
        ],
      },
    })
    await gotoPage(page, id)
    await expect(page.locator('.sheet .sg-cell').first()).toBeVisible()
    await select(page, 'A2', 'A3')
    const vp = page.locator('.sheet .sg')
    await vp.scrollIntoViewIfNeeded()
    const box = (await vp.boundingBox())!
    const h = (await page.locator('.sheet .sg-fill').boundingBox())!
    const edge = Math.min(box.y + box.height, page.viewportSize()!.height) - 4
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 70, edge, { steps: 6 })
    // holding at the edge scrolls the grid on its own
    await expect.poll(() => vp.evaluate((el) => el.scrollTop), { timeout: 5000 }).toBeGreaterThan(300)
    await page.mouse.up()
    const a = await stored(page, id)
    const cells = a.sheets[0].cells
    const filled = Object.keys(cells).filter((k) => /^A\d+$/.test(k) && k !== 'A1').map((k) => Number(k.slice(1)))
    const last = Math.max(...filled)
    expect(last).toBeGreaterThan(25)
    for (let r = 2; r <= last; r++) expect(cells[`A${r}`]?.v).toBe(String(r - 1))
    // the frozen header row was not touched, the sum follows
    expect(cells.A1.v).toBe('n')
    await vp.evaluate((el) => (el.scrollTop = 0))
    await expect(cell(page, 'B1')).toHaveText(String(((last - 1) * last) / 2))
    // the chart reads the filled cells
    await page.locator('.sheet .sh-chart').getByRole('button', { name: 'Data table' }).click()
    await expect(page.locator('.sheet .sh-chart .ch-table')).toContainText('5')

    // locked page: no handle, no pick list
    await wsEval(page, (s, id) => s.updatePageSettings(id, { locked: true }), id)
    await expect(page.locator('.sheet.is-readonly')).toBeVisible()
    await cell(page, 'A4').click()
    await expect(page.locator('.sheet .sg-fill')).toHaveCount(0)
    await page.keyboard.press('Alt+ArrowDown')
    await expect(page.getByRole('dialog', { name: 'Pick from list' })).toHaveCount(0)
  })

  test('German UI', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const id = await createPage(page, { title: 'Kalkulation' })
    await gotoPage(page, id)
    await editorOf(page, id).click()
    await page.keyboard.type('/tabellenkalk')
    await expect(page.locator('[role="option"]').filter({ hasText: 'Tabellenkalkulation' }).first()).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.locator('.sheet-tab.is-active')).toHaveText('01 · Tabelle 1')
    await expect(page.getByRole('button', { name: 'Fett' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Datenbereiche', exact: true })).toBeVisible()
    await expect(page.locator('.sh-status')).toContainText('BLATT 01')
    await enter(page, 'A1', '1,5')
    await expect(cell(page, 'A1')).toHaveText('1,5')
    await enter(page, 'A2', '=A1*2')
    await expect(cell(page, 'A2')).toHaveText('3')
    await enter(page, 'A3', '=1/0')
    await expect(cell(page, 'A3')).toHaveAttribute('title', 'Division durch null')

    // AutoFill + AutoComplete in German: "Jan" continues with "Mär", the menus speak German
    await enter(page, 'B1', 'Jan')
    await select(page, 'B1')
    await dragFill(page, 'B3')
    await expect(cell(page, 'B3')).toHaveText('Mär')
    await page.locator('.sheet .sh-tb').getByRole('button', { name: 'Mehr', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: /AutoVervollständigen für Zellwerte/ })).toContainText('AN')
    await page.keyboard.press('Escape')
    await cell(page, 'B4').click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Reihe ausfüllen' })).toBeVisible()
    await page.getByRole('menuitem', { name: 'Aus Liste auswählen…' }).click()
    const list = page.getByRole('dialog', { name: 'Aus Liste auswählen' })
    await expect(list).toContainText('3 EINTRÄGE · SPALTE B')
    await page.keyboard.press('Escape')
    await cell(page, 'B4').click()
    await page.keyboard.type('f')
    await expect(ghost(page)).toHaveText('eb')
  })
})

test.describe('spreadsheet block on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('the fill handle follows a finger; AutoComplete proposes while typing', async ({ page }) => {
    await openApp(page)
    const id = await sheetPage(page, [['Sheet 1', { A1: 'Mon', B1: 'Website relaunch' }]])
    await page.locator('.sheet').scrollIntoViewIfNeeded()
    await cell(page, 'A1').tap()
    const handle = page.locator('.sheet .sg-fill')
    await expect(handle).toBeVisible()
    const h = (await handle.boundingBox())!
    const t = (await cell(page, 'A4').boundingBox())!
    const cdp = await page.context().newCDPSession(page)
    const touch = (type: string, x: number, y: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
    await touch('touchStart', h.x + h.width / 2, h.y + h.height / 2)
    const [x0, y0, x1, y1] = [h.x + h.width / 2, h.y + h.height / 2, t.x + t.width / 2, t.y + t.height / 2]
    for (let i = 1; i <= 6; i++) await touch('touchMove', x0 + ((x1 - x0) * i) / 6, y0 + ((y1 - y0) * i) / 6)
    await expect(page.locator('.sheet .sg-fillprev__tip')).toHaveText('→ Thu')
    await touch('touchEnd', 0, 0)
    await expect(cell(page, 'A4')).toHaveText('Thu')
    // Chrome turns a tap that follows a touch gesture this closely into no click at all
    await page.waitForTimeout(600)
    // the page itself never scrolled sideways
    const doc = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
    expect(doc.scroll).toBeLessThanOrEqual(doc.client)

    await cell(page, 'B2').tap()
    await page.keyboard.type('W')
    await expect(ghost(page)).toHaveText('ebsite relaunch')
    await page.keyboard.press('Enter')
    await expect(cell(page, 'B2')).toHaveText('Website relaunch')
    const a = await stored(page, id)
    expect(a.sheets[0].cells.A3.v).toBe('Wed')
  })
})
