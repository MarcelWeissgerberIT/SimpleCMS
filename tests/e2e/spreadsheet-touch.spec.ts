/**
 * Spreadsheet block by touch (phone 390 px and tablet 768 px, touch driven through the Chrome
 * DevTools protocol): selection handles, long press + drag, swipe still scrolls, header taps and
 * drags, the touch action bar (copy / paste, fill, clear, chart, "+ Area" for DS(…) areas — also
 * while pointing in a formula), read-only, the fill tab, and that a finger's long press never opens
 * the cell menu. Phone keyboards (IME compositions, inserted text, keyCode 229 keydowns, input
 * events instead of keys): AutoComplete, the suggestion strip (values, functions, datasets, "Pick
 * range"), the long-press sheet (pick a value, + Area, fill, edit) and long presses in formulas.
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect, openApp, gotoPage, createPage, wsEval, flush } from './fixtures'

type Cells = Record<string, string>

/** A page with one spreadsheet block: 12 rows × 8 columns of 64 px (A–E fit a phone). */
async function touchSheet(page: Page, cells: Cells, opts: { rows?: number; frozenRows?: number; datasets?: unknown[] } = {}): Promise<string> {
  const widths = Object.fromEntries('ABCDEFGH'.split('').map((c) => [c, 64]))
  const id = await createPage(page, {
    title: 'Touch sheet',
    content: {
      type: 'doc',
      content: [
        {
          type: 'spreadsheet',
          attrs: {
            title: 'Budget',
            sheets: [{ id: 's1', name: 'Sheet 1', rows: opts.rows ?? 12, cols: 8, frozenRows: opts.frozenRows ?? 0, cells: Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, { v }])), colWidths: widths }],
            active: 's1',
            datasets: opts.datasets ?? [],
          },
        },
        { type: 'paragraph' },
      ],
    },
  })
  await gotoPage(page, id)
  await expect(page.locator('.sheet .sg-cell').first()).toBeVisible()
  await page.locator('.sheet').scrollIntoViewIfNeeded()
  return id
}

function pos(addr: string): [number, number] {
  const m = /^([A-Z])(\d+)$/.exec(addr)!
  return [Number(m[2]) - 1, m[1].charCodeAt(0) - 65]
}
const cell = (page: Page, addr: string) => page.locator(`.sheet [data-cell="${pos(addr).join(':')}"]`)
const nameBox = (page: Page) => page.locator('.sheet .sh-bar__ref')
const bar = (page: Page) => page.locator('.sh-touchbar')
const key = (page: Page, name: string) => bar(page).getByRole('button', { name, exact: true })

async function mid(loc: Locator): Promise<{ x: number; y: number }> {
  const b = (await loc.boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

/** Raw touch input (Input.dispatchTouchEvent): the browser's own gesture handling runs (taps, scrolling). */
async function finger(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  const send = (type: string, p?: { x: number; y: number }) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [p] : [] })
  return {
    /** press at `from`, optionally hold, move to `to` in steps, lift */
    async drag(from: { x: number; y: number }, to: { x: number; y: number }, opts: { hold?: number; steps?: number; rest?: number } = {}) {
      await send('touchStart', from)
      if (opts.hold) await page.waitForTimeout(opts.hold)
      const steps = opts.steps ?? 8
      for (let i = 1; i <= steps; i++) await send('touchMove', { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps })
      if (opts.rest) await page.waitForTimeout(opts.rest)
      await send('touchEnd')
      // Chrome turns a tap that follows a touch gesture this closely into no click at all
      await page.waitForTimeout(450)
    },
    async tap(p: { x: number; y: number }) {
      await send('touchStart', p)
      await send('touchEnd')
      await page.waitForTimeout(350)
    },
  }
}

/** An on-screen keyboard (CDP): compositions, committed text, keyCode 229 keydowns, its action key. */
async function phoneKeys(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  const k229 = async (type: 'rawKeyDown' | 'keyUp') => cdp.send('Input.dispatchKeyEvent', { type, key: 'Unidentified', code: '', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 })
  return {
    /** a word being composed (Android keyboards): every key a 229 keydown, the text an IME composition */
    async compose(text: string) {
      await k229('rawKeyDown')
      await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length })
      await k229('keyUp')
    },
    /** text committed by the keyboard (ends a composition; iOS-like typing): input events, no key */
    async insert(text: string) {
      await cdp.send('Input.insertText', { text })
    },
    /** the keyboard's action key ("done") */
    async enter() {
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
    },
  }
}

const strip = (page: Page) => page.locator('.sh-strip')
const chip = (page: Page, name: string | RegExp) => strip(page).getByRole('button', { name })
const holdSheet = (page: Page) => page.locator('.sh-hold')

/** The block's attrs as stored (after the editor's write debounce). */
async function stored(page: Page, id: string): Promise<{ sheets: Array<{ cells: Record<string, { v?: string }> }>; charts: Array<{ spec: { source: { kind: string; ref: string } } }> }> {
  await page.waitForTimeout(450)
  await flush(page)
  return wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.pages[id].content.content.find((n: { type: string }) => n.type === 'spreadsheet').attrs)), id)
}

const NUMBERS: Cells = { A1: 'Item', B1: 'Q1', C1: 'Q2', D1: 'Q3', B2: '1', C2: '2', D2: '3', B3: '4', C3: '5', D3: '6', B4: '7', C4: '8', D4: '9', B5: '10', C5: '11', D5: '12' }

test.describe('spreadsheet block by touch — phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('handles: drag the bottom-right, then the top-left corner; the status line follows; the fill tab sits apart', async ({ page }) => {
    await openApp(page)
    await touchSheet(page, NUMBERS)
    const f = await finger(page)
    await cell(page, 'B2').tap()
    await expect(nameBox(page)).toHaveText('B2')
    await expect(page.locator('.sheet .sg-handle')).toHaveCount(2)
    await expect(bar(page)).toBeVisible()
    // the fill tab is not the corner handle: it hangs outside it
    const br = (await page.locator('.sheet .sg-handle.is-br').boundingBox())!
    const tab = (await page.locator('.sheet .sg-fill.is-tab').boundingBox())!
    expect(tab.x).toBeGreaterThan(br.x + br.width)
    expect(tab.y).toBeGreaterThan(br.y + br.height)

    await f.drag(await mid(page.locator('.sheet .sg-handle.is-br')), await mid(cell(page, 'D5')))
    await expect(nameBox(page)).toHaveText('B2:D5')
    await expect(page.locator('.sheet .sh-status')).toContainText('SUM 78')
    await expect(page.locator('.sheet .sh-status')).toContainText('COUNT 12')
    await expect(page.locator('.sheet .sg-ov--sel')).toHaveCount(1)

    // the top-left handle: the bottom-right corner stays
    await f.drag(await mid(page.locator('.sheet .sg-handle.is-tl')), await mid(cell(page, 'C3')))
    await expect(nameBox(page)).toHaveText('C3:D5')
    await expect(page.locator('.sheet .sh-status')).toContainText('SUM 51')

    // a tap that lands on a handle belongs to the cell under it
    const h = await mid(page.locator('.sheet .sg-handle.is-br'))
    await f.tap({ x: h.x + 10, y: h.y + 10 })
    await expect(nameBox(page)).toHaveText('E6')
  })

  test('long press + drag selects a range; a swipe scrolls and selects nothing; a tap selects one cell', async ({ page }) => {
    await openApp(page)
    await touchSheet(page, NUMBERS)
    const f = await finger(page)
    await cell(page, 'A1').tap()
    await f.drag(await mid(cell(page, 'B3')), await mid(cell(page, 'C5')), { hold: 550 })
    await expect(nameBox(page)).toHaveText('B3:C5')
    await expect(page.locator('.sheet .sh-status')).toContainText('SUM 45')

    // a swipe: the grid scrolls, the selection stays
    const grid = page.locator('.sheet .sg')
    const from = await mid(cell(page, 'D8'))
    await f.drag(from, { x: from.x - 200, y: from.y }, { steps: 10 })
    await expect.poll(() => grid.evaluate((el) => el.scrollLeft)).toBeGreaterThan(40)
    await expect(nameBox(page)).toHaveText('B3:C5')

    await grid.evaluate((el) => (el.scrollLeft = 0))
    await page.waitForTimeout(300)
    await cell(page, 'B9').tap()
    await expect(nameBox(page)).toHaveText('B9')
    // a finger's long press is no right-click: the cell menu stays closed (it is ⋯ on the bar)
    await cell(page, 'B9').evaluate((el) => el.dispatchEvent(new PointerEvent('contextmenu', { pointerType: 'touch', bubbles: true, cancelable: true })))
    await expect(page.getByRole('menu')).toHaveCount(0)
  })

  test('headers: a tap selects the column / row, a drag along the strip several, the corner everything', async ({ page }) => {
    await openApp(page)
    await touchSheet(page, NUMBERS)
    const f = await finger(page)
    const col = (i: number) => page.locator(`.sheet [data-colhead="${i}"]`)
    const row = (i: number) => page.locator(`.sheet [data-rowhead="${i}"]`)
    await col(1).tap()
    await expect(nameBox(page)).toHaveText('B1:B12')
    await f.drag(await mid(col(1)), await mid(col(3)))
    await expect(nameBox(page)).toHaveText('B1:D12')
    await expect(page.locator('.sheet .sh-status')).toContainText('COUNT 12')
    await f.drag(await mid(row(5)), await mid(row(7)))
    await expect(nameBox(page)).toHaveText('A6:H8')
    await row(1).tap()
    await expect(nameBox(page)).toHaveText('A2:H2')
    await page.locator('.sheet .sg-corner').tap()
    await expect(nameBox(page)).toHaveText('A1:H12')
  })

  test('action bar: copy → paste into another range, fill down, clear; ⋯ opens the cell menu', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openApp(page)
    const id = await touchSheet(page, { A5: 'x', B5: '=A6*2', A6: '21', C8: '7' })
    const f = await finger(page)
    await cell(page, 'A5').tap()
    await f.drag(await mid(page.locator('.sheet .sg-handle.is-br')), await mid(cell(page, 'B6')))
    await expect(nameBox(page)).toHaveText('A5:B6')
    await key(page, 'Copy').tap()
    await expect(page.getByText('Copied A5:B6.')).toBeVisible()
    await cell(page, 'D9').tap()
    await key(page, 'Paste').tap()
    await expect(cell(page, 'D9')).toHaveText('x')
    await expect(cell(page, 'E9')).toHaveText('42')
    await expect(cell(page, 'D10')).toHaveText('21')
    await expect(nameBox(page)).toHaveText('D9:E10')
    // an internal paste moves the references like ⌘V does
    expect((await stored(page, id)).sheets[0].cells.E9.v).toBe('=D10*2')

    // Fill ↓ from the bar: the top cell of the selection down
    await cell(page, 'C8').tap()
    await f.drag(await mid(page.locator('.sheet .sg-handle.is-br')), await mid(cell(page, 'C11')))
    await expect(nameBox(page)).toHaveText('C8:C11')
    await key(page, 'Fill down').tap()
    await expect(cell(page, 'C11')).toHaveText('7')
    await expect(page.locator('.sheet .sh-status')).toContainText('SUM 28')

    // Clear
    await key(page, 'Clear contents').tap()
    await expect(cell(page, 'C8')).toHaveText('')
    await expect(cell(page, 'C11')).toHaveText('')

    // ⋯: the existing cell menu (with Fill series)
    await key(page, 'More cell actions').tap()
    await expect(page.getByRole('menuitem', { name: 'Fill series' })).toBeVisible()
    await page.keyboard.press('Escape')
    const a = await stored(page, id)
    expect(a.sheets[0].cells.C9).toBeUndefined()
  })

  test('"+ Area" builds a second area: the chart takes DS(…) of both; pointing in a formula adds an area too', async ({ page }) => {
    await openApp(page)
    const id = await touchSheet(page, { A1: '1', A2: '2', A3: '3', C1: '10', C2: '20', A6: '4', A7: '5', A8: '6', C6: '7', C7: '8' })
    const f = await finger(page)
    await cell(page, 'A1').tap()
    await f.drag(await mid(page.locator('.sheet .sg-handle.is-br')), await mid(cell(page, 'A3')))
    await expect(nameBox(page)).toHaveText('A1:A3')
    await key(page, 'Add another area (like ⌘/Ctrl-click): tap or hold where it starts').tap()
    await expect(key(page, 'Add another area (like ⌘/Ctrl-click): tap or hold where it starts')).toHaveAttribute('aria-pressed', 'true')
    await cell(page, 'C1').tap()
    await f.drag(await mid(page.locator('.sheet .sg-handle.is-br')), await mid(cell(page, 'C2')))
    await expect(nameBox(page)).toHaveText('C1:C2 +1')
    await expect(page.locator('.sheet .sg-ov--sel')).toHaveCount(2)
    await expect(page.locator('.sheet .sh-status')).toContainText('SUM 36')
    await key(page, 'Chart from the selection').tap()
    await page.locator('[data-testid="chart-builder-save"]').tap()
    await expect(page.locator('.sheet .sh-chart')).toHaveCount(1)
    expect((await stored(page, id)).charts[0].spec.source.ref).toBe('DS(A1:A3; C1:C2)')

    // a typed =SUM(DS( and two areas pointed by touch (below the formula's signature hint)
    await cell(page, 'D1').tap()
    await page.getByRole('textbox', { name: 'Formula' }).tap()
    await page.keyboard.type('=SUM(DS(')
    await expect(bar(page).getByRole('button')).toHaveCount(1)
    await f.drag(await mid(cell(page, 'A6')), await mid(cell(page, 'A8')), { hold: 550 })
    const input = page.locator('.sh-bar .fx-input__field')
    await expect(input).toHaveValue('=SUM(DS(A6:A8')
    await key(page, 'Add another area (like ⌘/Ctrl-click): tap or hold where it starts').tap()
    await f.drag(await mid(cell(page, 'C6')), await mid(cell(page, 'C7')), { hold: 550 })
    await expect(input).toHaveValue('=SUM(DS(A6:A8; C6:C7')
    await page.keyboard.type('))')
    await page.keyboard.press('Enter')
    await expect(cell(page, 'D1')).toHaveText('30')
    expect((await stored(page, id)).sheets[0].cells.D1.v).toBe('=SUM(DS(A6:A8; C6:C7))')
  })

  test('read-only: handles still select, the bar only copies, no fill tab', async ({ page }) => {
    await openApp(page)
    const id = await touchSheet(page, NUMBERS)
    await wsEval(page, (s, id) => s.updatePageSettings(id, { locked: true }), id)
    await expect(page.locator('.sheet.is-readonly')).toBeVisible()
    const f = await finger(page)
    await cell(page, 'B2').tap()
    await expect(page.locator('.sheet .sg-handle')).toHaveCount(2)
    await expect(page.locator('.sheet .sg-fill')).toHaveCount(0)
    await f.drag(await mid(page.locator('.sheet .sg-handle.is-br')), await mid(cell(page, 'C3')))
    await expect(nameBox(page)).toHaveText('B2:C3')
    await expect(page.locator('.sheet .sh-status')).toContainText('SUM 12')
    await expect(bar(page).getByRole('button')).toHaveCount(1)
    await expect(key(page, 'Copy')).toBeVisible()
  })

  test('German: the bar speaks German and fits the phone (its groups stack)', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await touchSheet(page, NUMBERS)
    await cell(page, 'B6').tap()
    await expect(key(page, 'Kopieren')).toBeVisible()
    await expect(key(page, 'Nach unten ausfüllen')).toContainText('Füllen ↓')
    const box = (await bar(page).boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    // every key is on screen, none scrolled away
    for (const k of await bar(page).getByRole('button').all()) {
      const b = (await k.boundingBox())!
      expect(b.x + b.width).toBeLessThanOrEqual(390)
      expect(b.width).toBeGreaterThanOrEqual(38)
      expect(b.height).toBeGreaterThanOrEqual(40)
    }
  })
})

const TASKS: Cells = { A1: 'Task', A2: 'Website relaunch', A3: 'Design review', A4: 'Webinar', B1: 'Owner', B2: 'Ada', B3: 'Grace', B4: 'Ada', C1: '1', C2: '2', C3: '3', C4: '4' }
const AREA = 'Add another area (like ⌘/Ctrl-click): tap or hold where it starts'

test.describe('spreadsheet block by touch — phone keyboards and long presses', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('AutoComplete with an on-screen keyboard: compositions and 229 keys propose, a chip takes the value, Backspace as an input event drops the proposal', async ({ page }) => {
    await openApp(page)
    const id = await touchSheet(page, TASKS)
    const kb = await phoneKeys(page)
    const f = await finger(page)
    const cellInput = page.locator('.fx-input--cell input')
    const ghost = page.locator('.fx-input--cell .fx-ghost')

    // A5: the long-press sheet's Edit opens the in-cell editor (the keyboard comes up)
    await f.drag(await mid(cell(page, 'A5')), await mid(cell(page, 'A5')), { hold: 550 })
    await holdSheet(page).getByRole('button', { name: 'Edit the cell' }).tap()
    await expect(cellInput).toBeFocused()
    // "We" composed like Android keyboards do: no usable keydown, an IME composition
    await kb.compose('W')
    await kb.compose('We')
    await expect(cellInput).toHaveValue('We')
    // the nearest entry is the ghost and the first chip (↵ takes it); every match is a chip
    await expect(ghost).toHaveText('binar')
    await expect(strip(page)).toBeVisible()
    await expect(strip(page).getByRole('button')).toHaveText(['Webinar↵', 'Website relaunch'])
    await expect(strip(page)).toContainText('COL A')
    // the strip sits above the editor, inside the screen
    const sb = (await strip(page).boundingBox())!
    const eb = (await page.locator('.sheet .sg-editor').boundingBox())!
    expect(sb.y + sb.height).toBeLessThanOrEqual(eb.y)
    expect(sb.x).toBeGreaterThanOrEqual(0)
    expect(sb.x + sb.width).toBeLessThanOrEqual(390)
    for (const b of await strip(page).getByRole('button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    // a tap on a chip — still composing — takes it; the input kept the focus up to then (no keyboard flicker)
    await chip(page, 'Website relaunch').tap()
    await expect(cell(page, 'A5')).toHaveText('Website relaunch')
    await expect(cellInput).toHaveCount(0)
    await expect(strip(page)).toHaveCount(0)

    // the formula bar, text committed word by word (iOS): the proposal follows, the keyboard's ↵ takes it
    await cell(page, 'A6').tap()
    await page.getByRole('textbox', { name: 'Formula' }).tap()
    await kb.insert('D')
    await kb.insert('e')
    await expect(page.locator('.fx-input--bar .fx-ghost')).toHaveText('sign review')
    await expect(chip(page, /Design review/)).toBeVisible()
    // a Backspace the keyboard reports only as an input event: drops the proposal, keeps the text
    const bar = page.locator('.sh-bar .fx-input__field')
    const prevented = await bar.evaluate((el) => !el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true })))
    expect(prevented).toBe(true)
    await expect(page.locator('.fx-input--bar .fx-ghost')).toHaveCount(0)
    await expect(bar).toHaveValue('De')
    // the strip still offers the column's matches
    await expect(chip(page, /Design review/)).toBeVisible()
    await kb.insert('s')
    await expect(page.locator('.fx-input--bar .fx-ghost')).toHaveText('ign review')
    await kb.enter()
    await expect(cell(page, 'A6')).toHaveText('Design review')
    await expect(nameBox(page)).toHaveText('A7')

    // a composition that shrinks (Backspace while composing) proposes nothing; numbers never
    await page.getByRole('textbox', { name: 'Formula' }).tap()
    await kb.compose('Webs')
    await expect(page.locator('.fx-input--bar .fx-ghost')).toHaveText('ite relaunch')
    await kb.compose('Web')
    await expect(page.locator('.fx-input--bar .fx-ghost')).toHaveCount(0)
    await kb.insert('Web')
    await kb.enter()
    await expect(cell(page, 'A7')).toHaveText('Web')
    await cell(page, 'C5').tap()
    await page.getByRole('textbox', { name: 'Formula' }).tap()
    await kb.insert('1')
    await expect(strip(page)).toHaveCount(0)
    await kb.enter()

    const a = await stored(page, id)
    expect(a.sheets[0].cells.A5.v).toBe('Website relaunch')
    expect(a.sheets[0].cells.A6.v).toBe('Design review')
    expect(a.sheets[0].cells.A7.v).toBe('Web')
    expect(a.sheets[0].cells.C5.v).toBe('1')
  })

  test('formulas on a phone: "=SU" offers SUM / SUMIF with their arguments, a tap inserts SUM( and keeps the keyboard; Pick range points; datasets as DS(…)', async ({ page }) => {
    await openApp(page)
    const id = await touchSheet(page, NUMBERS, { datasets: [{ id: 'd1', name: 'Plan', color: 'green', ranges: [{ sheet: 's1', ref: 'B2:B5' }] }] })
    const kb = await phoneKeys(page)
    const f = await finger(page)
    const bar = page.locator('.sh-bar .fx-input__field')
    await cell(page, 'E2').tap()
    await page.getByRole('textbox', { name: 'Formula' }).tap()
    await kb.insert('=')
    // where a reference can go: "Pick range" and the datasets
    await expect(strip(page).getByRole('button')).toHaveText(['Pick range', 'DS · PLAN'])
    await expect(strip(page)).toContainText('FX')
    await kb.compose('SU')
    await expect(chip(page, /^SUM\(/)).toBeVisible()
    await expect(chip(page, /^SUMIF\(/)).toBeVisible()
    await expect(chip(page, /^SUM\(/)).toContainText('(number1; [number2]; …)')
    // no list under the input on touch: the strip is the list
    await expect(page.locator('.fx-suggest')).toHaveCount(0)
    await chip(page, /^SUM\(/).tap()
    await expect(bar).toHaveValue('=SUM(')
    await expect(bar).toBeFocused()
    // a dataset chip: DS(NAME) at the caret
    await chip(page, 'Dataset Plan').tap()
    await expect(bar).toHaveValue('=SUM(DS(Plan)')
    await kb.insert(')')
    await kb.enter()
    await expect(cell(page, 'E2')).toHaveText('22')

    // Pick range: the keyboard steps aside (the grid has the focus), a long-press drag points, Keep typing returns
    await cell(page, 'E3').tap()
    await page.getByRole('textbox', { name: 'Formula' }).tap()
    await kb.insert('=MAX(')
    await chip(page, 'Pick range').tap()
    await expect(bar).not.toBeFocused()
    // the strip steps aside too; the corner bar has + Area, Type, Done
    await expect(strip(page)).toHaveCount(0)
    await expect(page.locator('.sh-touchbar').getByRole('button')).toHaveCount(3)
    await f.drag(await mid(cell(page, 'C4')), await mid(cell(page, 'D5')), { hold: 550 })
    await expect(bar).toHaveValue('=MAX(C4:D5')
    // a tap replaces the pointed reference
    await page.waitForTimeout(200)
    await f.tap(await mid(cell(page, 'C5')))
    await expect(bar).toHaveValue('=MAX(C5')
    await expect(bar).not.toBeFocused()
    await key(page, 'Keep typing').tap()
    await expect(bar).toBeFocused()
    await kb.insert(')')
    await kb.enter()
    await expect(cell(page, 'E3')).toHaveText('11')
    // "Done" ends it from the strip as well
    await cell(page, 'E4').tap()
    await page.getByRole('textbox', { name: 'Formula' }).tap()
    await kb.insert('=')
    await chip(page, 'Pick range').tap()
    await f.tap(await mid(cell(page, 'B4')))
    await key(page, 'Done — take the formula').tap()
    await expect(cell(page, 'E4')).toHaveText('7')
    const a = await stored(page, id)
    expect(a.sheets[0].cells.E2.v).toBe('=SUM(DS(Plan))')
    expect(a.sheets[0].cells.E3.v).toBe('=MAX(C5)')
    expect(a.sheets[0].cells.E4.v).toBe('=B4')
  })

  test('long press lifted in place: the sheet picks a value, fills down, edits; dragged it stays a range selection', async ({ page }) => {
    await openApp(page)
    const id = await touchSheet(page, TASKS)
    const f = await finger(page)
    const at = async (addr: string) => f.drag(await mid(cell(page, addr)), await mid(cell(page, addr)), { hold: 550 })

    await at('B5')
    const sheet = page.getByRole('dialog', { name: 'Cell B5' })
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText('Pick a value')
    await expect(sheet.getByRole('option')).toHaveText(['Ada', 'Grace', 'Owner'])
    // finger-sized, inside the screen
    for (const o of await sheet.getByRole('option').all()) expect((await o.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    for (const k of await sheet.getByRole('toolbar').getByRole('button').all()) expect((await k.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    const box = (await sheet.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    // no keyboard yet: the search field waits for a tap
    await expect(sheet.getByRole('combobox')).not.toBeFocused()
    await sheet.getByRole('combobox').tap()
    await page.keyboard.type('gr')
    await expect(sheet.getByRole('option')).toHaveText(['Grace'])
    await sheet.getByRole('option', { name: 'Grace' }).tap()
    await expect(sheet).toHaveCount(0)
    await expect(cell(page, 'B5')).toHaveText('Grace')

    // Fill ↓ from the cell above
    await at('B6')
    await page.getByRole('dialog', { name: 'Cell B6' }).getByRole('button', { name: 'Fill down from the cell above' }).tap()
    await expect(cell(page, 'B6')).toHaveText('Grace')
    // Edit: the in-cell editor with the keyboard
    await at('C6')
    await page.getByRole('dialog', { name: 'Cell C6' }).getByRole('button', { name: 'Edit the cell' }).tap()
    await expect(page.locator('.fx-input--cell input')).toBeFocused()
    await page.keyboard.type('5')
    await page.keyboard.press('Enter')
    await expect(cell(page, 'C6')).toHaveText('5')
    // Esc / a tap outside closes it without writing
    await at('B8')
    await expect(page.getByRole('dialog', { name: 'Cell B8' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(holdSheet(page)).toHaveCount(0)
    await expect(cell(page, 'B8')).toHaveText('')

    // dragged: a range, no sheet; "+ Area" is highlighted for the next long press
    await f.drag(await mid(cell(page, 'C2')), await mid(cell(page, 'C4')), { hold: 550 })
    await expect(nameBox(page)).toHaveText('C2:C4')
    await expect(holdSheet(page)).toHaveCount(0)
    await expect(key(page, AREA)).toHaveAttribute('aria-pressed', 'true')
    await expect(key(page, AREA)).toHaveClass(/is-hint/)
    // a tap starts over (once the long press's leftover mouse events are through)
    await page.waitForTimeout(200)
    await cell(page, 'D8').tap()
    await expect(nameBox(page)).toHaveText('D8')
    await expect(key(page, AREA)).toHaveAttribute('aria-pressed', 'false')
    const a = await stored(page, id)
    expect(a.sheets[0].cells.B5.v).toBe('Grace')
    expect(a.sheets[0].cells.B6.v).toBe('Grace')
    expect(a.sheets[0].cells.C6.v).toBe('5')
  })

  test('"+ Area" from the long-press sheet and a second long-press drag: two areas for a chart; long presses in a formula add areas inside DS(…)', async ({ page }) => {
    await openApp(page)
    const id = await touchSheet(page, { A1: '1', A2: '2', A3: '3', C1: '10', C2: '20', A6: '4', A7: '5', A8: '6', C6: '7', C7: '8' })
    const f = await finger(page)
    await cell(page, 'A1').tap()
    await f.drag(await mid(page.locator('.sheet .sg-handle.is-br')), await mid(cell(page, 'A3')))
    await expect(nameBox(page)).toHaveText('A1:A3')
    // hold C1, lift: the sheet — "+ Area" starts another area here, A1:A3 stays
    await f.drag(await mid(cell(page, 'C1')), await mid(cell(page, 'C1')), { hold: 550 })
    const sheet = page.getByRole('dialog', { name: 'Cell C1' })
    await expect(sheet.getByRole('button', { name: 'Start another area here' })).toHaveAttribute('aria-pressed', 'false')
    await sheet.getByRole('button', { name: 'Start another area here' }).tap()
    await expect(sheet).toHaveCount(0)
    await expect(nameBox(page)).toHaveText('C1 +1')
    await expect(key(page, AREA)).toHaveClass(/is-hint/)
    // a long-press drag from there stretches the new area (no duplicate)
    await f.drag(await mid(cell(page, 'C1')), await mid(cell(page, 'C2')), { hold: 550 })
    await expect(nameBox(page)).toHaveText('C1:C2 +1')
    await expect(page.locator('.sheet .sg-ov--sel')).toHaveCount(2)
    await expect(page.locator('.sheet .sh-status')).toContainText('SUM 36')
    await key(page, 'Chart from the selection').tap()
    await page.locator('[data-testid="chart-builder-save"]').tap()
    await expect(page.locator('.sheet .sh-chart')).toHaveCount(1)
    expect((await stored(page, id)).charts[0].spec.source.ref).toBe('DS(A1:A3; C1:C2)')

    // still latched after the drag: another long-press drag adds a third area
    await f.drag(await mid(cell(page, 'A6')), await mid(cell(page, 'A7')), { hold: 550 })
    await expect(nameBox(page)).toHaveText('A6:A7 +2')

    // a formula: long presses point, the second one adds another area of the DS (no "+ Area" needed)
    await page.waitForTimeout(200)
    await cell(page, 'D1').tap()
    await page.getByRole('textbox', { name: 'Formula' }).tap()
    await page.keyboard.type('=SUM(DS(')
    await f.drag(await mid(cell(page, 'A6')), await mid(cell(page, 'A8')), { hold: 550 })
    const input = page.locator('.sh-bar .fx-input__field')
    await expect(input).toHaveValue('=SUM(DS(A6:A8')
    await f.drag(await mid(cell(page, 'C6')), await mid(cell(page, 'C7')), { hold: 550 })
    await expect(input).toHaveValue('=SUM(DS(A6:A8; C6:C7')
    // lifted in place: one more cell, no sheet while editing
    await f.drag(await mid(cell(page, 'A3')), await mid(cell(page, 'A3')), { hold: 550 })
    await expect(input).toHaveValue('=SUM(DS(A6:A8; C6:C7; A3')
    await expect(holdSheet(page)).toHaveCount(0)
    // on touch the signature heads the strip (the input's own popups stay closed)
    await expect(strip(page).locator('.fx-sig__name').first()).toHaveText('DS(')
    await expect(page.locator('.fx-pop')).toHaveCount(0)
    await page.keyboard.type('))')
    await page.keyboard.press('Enter')
    await expect(cell(page, 'D1')).toHaveText('33')
    // outside DS(…) a long press after an argument adds one more argument
    await page.waitForTimeout(200)
    await cell(page, 'D2').tap()
    await page.getByRole('textbox', { name: 'Formula' }).tap()
    await page.keyboard.type('=SUM(A1')
    await f.drag(await mid(cell(page, 'C7')), await mid(cell(page, 'C7')), { hold: 550 })
    await expect(input).toHaveValue('=SUM(A1; C7')
    await page.keyboard.type(')')
    await page.keyboard.press('Enter')
    await expect(cell(page, 'D2')).toHaveText('9')
    const a = await stored(page, id)
    expect(a.sheets[0].cells.D1.v).toBe('=SUM(DS(A6:A8; C6:C7; A3))')
    expect(a.sheets[0].cells.D2.v).toBe('=SUM(A1; C7)')
  })

  test('German: the strip and the long-press sheet speak German', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await touchSheet(page, TASKS)
    const f = await finger(page)
    const kb = await phoneKeys(page)
    await f.drag(await mid(cell(page, 'A5')), await mid(cell(page, 'A5')), { hold: 550 })
    const sheet = page.getByRole('dialog', { name: 'Zelle A5' })
    await expect(sheet).toContainText('Wert wählen')
    await expect(sheet.getByRole('button', { name: 'Hier einen weiteren Bereich beginnen' })).toContainText('+ Bereich')
    await expect(sheet.getByRole('button', { name: 'Von der Zelle darüber ausfüllen' })).toContainText('Ausfüllen ↓')
    await sheet.getByRole('button', { name: 'Zelle bearbeiten' }).tap()
    await kb.compose('We')
    await expect(strip(page)).toContainText('SPALTE A')
    await expect(page.getByRole('toolbar', { name: 'Vorschläge' })).toBeVisible()
    await kb.insert('We')
    await kb.enter()
    await expect(cell(page, 'A5')).toHaveText('Webinar')
    await cell(page, 'D2').tap()
    await page.getByRole('textbox', { name: 'Formel' }).tap()
    await kb.insert('=')
    await expect(chip(page, 'Bereich wählen')).toBeVisible()
  })
})

test.describe('spreadsheet block by touch — tablet', () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true })

  test('handles across a frozen row, long press, header drag; the bar sits in one row above the selection', async ({ page }) => {
    await openApp(page)
    await touchSheet(page, NUMBERS, { frozenRows: 1, rows: 40 })
    const f = await finger(page)
    await cell(page, 'C4').tap()
    await expect(bar(page)).toBeVisible()
    await expect(bar(page)).not.toHaveClass(/is-stacked/)
    const b = (await bar(page).boundingBox())!
    const sel = (await cell(page, 'C4').boundingBox())!
    expect(b.y + b.height).toBeLessThanOrEqual(sel.y)

    // the top-left handle up into the frozen row
    await f.drag(await mid(page.locator('.sheet .sg-handle.is-tl')), await mid(cell(page, 'B1')))
    await expect(nameBox(page)).toHaveText('B1:C4')
    await expect(page.locator('.sheet .sg-frozen .sg-handle.is-tl')).toHaveCount(1)

    // the bottom-right handle down past the grid's edge: the grid scrolls by itself
    const grid = page.locator('.sheet .sg')
    const gb = (await grid.boundingBox())!
    await f.drag(await mid(page.locator('.sheet .sg-handle.is-br')), { x: gb.x + 200, y: Math.min(gb.y + gb.height, 1024) - 6 }, { steps: 6, rest: 900 })
    expect(await grid.evaluate((el) => el.scrollTop)).toBeGreaterThan(100)
    const r = await nameBox(page).textContent()
    expect(Number(/^B1:C(\d+)$/.exec(r ?? '')?.[1] ?? 0)).toBeGreaterThan(24)

    await grid.evaluate((el) => (el.scrollTop = 0))
    await page.waitForTimeout(300)
    await f.drag(await mid(cell(page, 'B3')), await mid(cell(page, 'D5')), { hold: 550 })
    await expect(nameBox(page)).toHaveText('B3:D5')
    await expect(page.locator('.sheet .sh-status')).toContainText('SUM 72')
    await f.drag(await mid(page.locator('.sheet [data-colhead="0"]')), await mid(page.locator('.sheet [data-colhead="2"]')))
    await expect(nameBox(page)).toHaveText('A1:C40')
  })

  test('the long-press sheet and the suggestion strip fit the tablet; the strip stays above the cell editor', async ({ page }) => {
    await openApp(page)
    await touchSheet(page, TASKS)
    const f = await finger(page)
    const kb = await phoneKeys(page)
    await f.drag(await mid(cell(page, 'A5')), await mid(cell(page, 'A5')), { hold: 550 })
    const sheet = page.getByRole('dialog', { name: 'Cell A5' })
    const box = (await sheet.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(768)
    expect(box.y + box.height).toBeLessThanOrEqual(1024)
    await sheet.getByRole('button', { name: 'Edit the cell' }).tap()
    await kb.compose('Des')
    await expect(chip(page, /Design review/)).toBeVisible()
    const sb = (await strip(page).boundingBox())!
    const eb = (await page.locator('.sheet .sg-editor').boundingBox())!
    expect(sb.y + sb.height).toBeLessThanOrEqual(eb.y)
    await chip(page, /Design review/).tap()
    await expect(cell(page, 'A5')).toHaveText('Design review')
  })
})
