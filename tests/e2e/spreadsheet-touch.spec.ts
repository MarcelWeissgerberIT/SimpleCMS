/**
 * Spreadsheet block by touch (phone 390 px and tablet 768 px, touch driven through the Chrome
 * DevTools protocol): selection handles, long press + drag, swipe still scrolls, header taps and
 * drags, read-only, the fill tab. The "⋯" key and the fill tab sit on the selection's own edge (a
 * cell, a 64 px column, a range, a row wider than the screen, the last column): they cover no other
 * cell, the neighbours' centres stay theirs, the knob keeps its 40 px. The cell menu (no floating
 * bar): a tap selects with no overlay, a second tap on the selection, the "⋯" key or a long press
 * (at the threshold, the finger still down — with pointer events, touch events or both) opens it;
 * every entry (copy / cut / paste, fill, clear, chart, pick a value, + Area with its chip, edit,
 * more); it never covers the selection. Phone keyboards (IME compositions, inserted text, keyCode 229 keydowns, input events
 * instead of keys): AutoComplete, the suggestion strip (values, functions, datasets, "Pick range",
 * + Area / Type / Done while pointing) and long presses in formulas. iOS sequences (cancelled
 * fingers, compatibility mouse events, pointer events that stop).
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
/** the cell menu (any) and one of its entries */
const menu = (page: Page) => page.locator('.sh-cmenu')
const entry = (page: Page, name: string) => menu(page).getByRole('menuitem', { name, exact: true })
/** the "⋯" key on the selection */
const menuKey = (page: Page) => page.locator('.sheet .sg-menukey')
/** "+ Area" waiting for its area: the chip on the grid's top edge */
const areaChip = (page: Page) => page.locator('.sheet .sh-areachip')
const AREA = 'Add another area (like ⌘/Ctrl-click): tap or drag where it goes'

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
    /** a tap on what a tap just selected — apart enough not to be a double tap (that edits) */
    async again(p: { x: number; y: number }) {
      await page.waitForTimeout(300)
      await send('touchStart', p)
      await send('touchEnd')
      await page.waitForTimeout(350)
    },
    /** the finger comes down (and stays) */
    down: (p: { x: number; y: number }) => send('touchStart', p),
    move: (p: { x: number; y: number }) => send('touchMove', p),
    up: () => send('touchEnd'),
    /** the system takes the finger (iOS: its own long press, a callout): touchcancel / pointercancel, no touchend */
    cancel: () => send('touchCancel'),
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

/** Neither rectangle overlaps the other. */
function apart(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y
}

/** The cell menu lies inside the screen and off the selected cells (`from`…`to`). */
async function menuClear(page: Page, from: string, to: string, width: number, height: number) {
  const m = (await menu(page).boundingBox())!
  expect(m.x).toBeGreaterThanOrEqual(0)
  expect(m.y).toBeGreaterThanOrEqual(0)
  expect(m.x + m.width).toBeLessThanOrEqual(width)
  expect(m.y + m.height).toBeLessThanOrEqual(height)
  const a = (await cell(page, from).boundingBox())!
  const b = (await cell(page, to).boundingBox())!
  const sel = { x: a.x, y: a.y, width: b.x + b.width - a.x, height: b.y + b.height - a.y }
  expect(apart(m, sel), `menu ${JSON.stringify(m)} over the selection ${JSON.stringify(sel)}`).toBe(true)
}

const fillTab = (page: Page) => page.locator('.sheet .sg-fill.is-tab')
const brKnob = (page: Page) => page.locator('.sheet .sg-handle.is-br')

/**
 * The "⋯" key and the fill tab sit on the edge of the selection `from`…`to`: inside its box but for
 * a few px over the border, inside the grid's visible part, apart from each other and from the
 * bottom-right knob; a finger on either's face gets it. Nothing takes the centre of a cell around
 * the selection (a tap there selects that cell) nor of a selected one (a double tap there edits),
 * and the knob keeps a 40 px hit area of its own.
 */
async function onEdge(page: Page, from: string, to: string) {
  const a = (await cell(page, from).boundingBox())!
  const b = (await cell(page, to).boundingBox())!
  const sel = { left: a.x, top: a.y, right: b.x + b.width, bottom: b.y + b.height }
  const grid = await page.locator('.sheet .sg').evaluate((el) => {
    const r = el.getBoundingClientRect()
    // under no header: right of the row numbers, below the column letters
    return { left: r.left + el.clientLeft + 46, top: r.top + el.clientTop + 26, right: r.left + el.clientLeft + el.clientWidth, bottom: r.top + el.clientTop + el.clientHeight }
  })
  const knob = (await brKnob(page).count()) ? await brKnob(page).boundingBox() : null
  const boxes = []
  for (const loc of [menuKey(page), fillTab(page)]) {
    if (!(await loc.count())) continue
    const k = (await loc.boundingBox())!
    boxes.push(k)
    const what = `${await loc.getAttribute('class')} ${JSON.stringify(k)} on ${JSON.stringify(sel)}`
    expect(k.x, what).toBeGreaterThanOrEqual(Math.max(sel.left - 1, grid.left))
    expect(k.y, what).toBeGreaterThanOrEqual(Math.max(sel.top - 3, grid.top))
    expect(k.x + k.width, what).toBeLessThanOrEqual(Math.min(sel.right + 6, grid.right))
    expect(k.y + k.height, what).toBeLessThanOrEqual(Math.min(sel.bottom + 6, grid.bottom))
    if (knob) expect(apart(k, knob), `${what} clear of the knob ${JSON.stringify(knob)}`).toBe(true)
    expect(await loc.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
    }), what).toBe(true)
  }
  if (boxes.length === 2) expect(apart(boxes[0], boxes[1]), 'the key apart from the tab').toBe(true)
  // the cells around the selection and in it (those in view) keep their centres
  const [r0, c0] = pos(from)
  const [r1, c1] = pos(to)
  const taken = await page.evaluate(({ r0, c0, r1, c1, grid }) => {
    const out: string[] = []
    for (let r = r0 - 1; r <= r1 + 1; r++)
      for (let c = c0 - 1; c <= c1 + 1; c++) {
        const el = document.querySelector(`.sheet [data-cell="${r}:${c}"]`)
        if (!el) continue
        const b = el.getBoundingClientRect()
        const x = b.x + b.width / 2
        const y = b.y + b.height / 2
        if (x < grid.left || x > grid.right || y < grid.top || y > grid.bottom || y > innerHeight) continue
        const hit = document.elementFromPoint(x, y)
        if (hit?.closest('[data-cell]') !== el) out.push(`${r}:${c} → ${hit?.className}`)
      }
    return out
  }, { r0, c0, r1, c1, grid })
  expect(taken, 'cells whose centre something covers').toEqual([])
  // (where the grid shows it: next to the grid's edge the rest is cut off)
  const kx = knob ? knob.x + knob.width / 2 : -1
  const ky = knob ? knob.y + knob.height / 2 : -1
  for (const [dx, dy] of [[0, 0], [-12, -12], [24, -12], [-12, 24], [24, 24]]) {
    const p = { x: kx + dx, y: ky + dy }
    if (p.x < grid.left || p.x > grid.right - 1 || p.y < grid.top || p.y > grid.bottom - 1) continue
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className ?? '', p), `the knob at ${dx}, ${dy}`).toBe('sg-handle is-br')
  }
}

/** A gesture just ended: its leftover compatibility mouse events are ignored for a moment — let them pass. */
const settle = (page: Page) => page.waitForTimeout(450)

/** The block's attrs as stored (after the editor's write debounce). */
async function stored(page: Page, id: string): Promise<{ sheets: Array<{ cells: Record<string, { v?: string }> }>; charts: Array<{ spec: { source: { kind: string; ref: string } } }> }> {
  await page.waitForTimeout(450)
  await flush(page)
  return wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.pages[id].content.content.find((n: { type: string }) => n.type === 'spreadsheet').attrs)), id)
}

const NUMBERS: Cells = { A1: 'Item', B1: 'Q1', C1: 'Q2', D1: 'Q3', B2: '1', C2: '2', D2: '3', B3: '4', C3: '5', D3: '6', B4: '7', C4: '8', D4: '9', B5: '10', C5: '11', D5: '12' }

test.describe('spreadsheet block by touch — phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('handles: drag the bottom-right, then the top-left corner; the status line follows; the "⋯" key and the fill tab sit on the edge', async ({ page }) => {
    await openApp(page)
    await touchSheet(page, NUMBERS)
    const f = await finger(page)
    await cell(page, 'B2').tap()
    await expect(nameBox(page)).toHaveText('B2')
    await expect(page.locator('.sheet .sg-handle')).toHaveCount(2)
    // no floating bar, no menu: the selection, its handles and its "⋯" key
    await expect(page.locator('.sh-touchbar')).toHaveCount(0)
    await expect(menu(page)).toHaveCount(0)
    await expect(menuKey(page)).toBeVisible()
    // the fill tab is not the corner handle; neither it nor the key covers another cell
    await expect(fillTab(page)).toBeVisible()
    await onEdge(page, 'B2', 'B2')

    await f.drag(await mid(page.locator('.sheet .sg-handle.is-br')), await mid(cell(page, 'D5')))
    await expect(nameBox(page)).toHaveText('B2:D5')
    await onEdge(page, 'B2', 'D5')
    await expect(page.locator('.sheet .sh-status')).toContainText('SUM 78')
    await expect(page.locator('.sheet .sh-status')).toContainText('COUNT 12')
    await expect(page.locator('.sheet .sg-ov--sel')).toHaveCount(1)

    // the top-left handle: the bottom-right corner stays
    await f.drag(await mid(page.locator('.sheet .sg-handle.is-tl')), await mid(cell(page, 'C3')))
    await expect(nameBox(page)).toHaveText('C3:D5')
    await expect(page.locator('.sheet .sh-status')).toContainText('SUM 51')

    // a tap that lands on a handle belongs to the cell under it
    await settle(page)
    const h = await mid(page.locator('.sheet .sg-handle.is-br'))
    await f.tap({ x: h.x + 10, y: h.y + 10 })
    await expect(nameBox(page)).toHaveText('E6')
    await expect(menu(page)).toHaveCount(0)

    // row 1: the top-left knob sits whole below the column letters, nothing covers it, it still drags
    await settle(page)
    await f.tap(await mid(cell(page, 'A1')))
    await expect(nameBox(page)).toHaveText('A1')
    await f.drag(await mid(page.locator('.sheet .sg-handle.is-br')), await mid(cell(page, 'B3')))
    await expect(nameBox(page)).toHaveText('A1:B3')
    const tl = page.locator('.sheet .sg-handle.is-tl')
    const knob = (await tl.boundingBox())!
    const letters = (await page.locator('.sheet .sg-head').boundingBox())!
    expect(knob.y).toBeGreaterThanOrEqual(letters.y + letters.height)
    const c = await mid(tl)
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.matches('.sg-handle.is-tl') ?? false, c)).toBe(true)
    await f.drag(c, await mid(cell(page, 'B2')))
    await expect(nameBox(page)).toHaveText('B2:B3')
  })

  test('the cell menu: a tap selects (nothing pops up), a second tap on the selection opens it, so does the "⋯" key; Esc and a tap outside close it', async ({ page }) => {
    await openApp(page)
    await touchSheet(page, NUMBERS)
    const f = await finger(page)
    await f.tap(await mid(cell(page, 'B2')))
    await expect(nameBox(page)).toHaveText('B2')
    await expect(menu(page)).toHaveCount(0)
    // the same cell again (no double tap — that edits): its menu
    await f.again(await mid(cell(page, 'B2')))
    await expect(page.getByRole('dialog', { name: 'Cell menu B2' })).toBeVisible()
    await expect(menu(page)).toContainText('1 cell')
    await menuClear(page, 'B2', 'B2', 390, 844)
    // a tap outside closes it and selects there (it doesn't reopen on the tapped selection either)
    await f.tap(await mid(cell(page, 'C7')))
    await expect(menu(page)).toHaveCount(0)
    await expect(nameBox(page)).toHaveText('C7')

    // a range: a tap anywhere inside it
    await f.drag(await mid(page.locator('.sheet .sg-handle.is-br')), await mid(cell(page, 'D9')))
    await expect(nameBox(page)).toHaveText('C7:D9')
    await settle(page)
    await f.tap(await mid(cell(page, 'D8')))
    await expect(page.getByRole('dialog', { name: 'Cell menu C7:D9' })).toBeVisible()
    await expect(menu(page)).toContainText('6 cells')
    await expect(nameBox(page)).toHaveText('C7:D9')
    await menuClear(page, 'C7', 'D9', 390, 844)
    await page.keyboard.press('Escape')
    await expect(menu(page)).toHaveCount(0)
    // the keyboard is back on the grid
    await expect(page.locator('.sheet .sg')).toBeFocused()

    // the "⋯" key: 32 px to see, a finger-sized hit area, centred on the selection's bottom edge (the fill tab
    // at its right end); the cells below and beside the selection stay free at their centres
    const k = (await menuKey(page).boundingBox())!
    const c9 = (await cell(page, 'C9').boundingBox())!
    const d9 = (await cell(page, 'D9').boundingBox())!
    expect(k.width).toBe(32)
    expect(Math.abs(k.x + k.width / 2 - (c9.x + d9.x + d9.width) / 2)).toBeLessThanOrEqual(1)
    expect(k.y).toBeLessThan(c9.y + c9.height)
    expect(k.y + k.height).toBeGreaterThan(c9.y + c9.height)
    expect(k.y + k.height).toBeLessThanOrEqual(c9.y + c9.height + 6)
    await onEdge(page, 'C7', 'D9')
    expect(await menuKey(page).evaluate((el) => getComputedStyle(el, '::before').inset)).toBe('-3px -7px -5px')
    await menuKey(page).tap()
    await expect(page.getByRole('dialog', { name: 'Cell menu C7:D9' })).toBeVisible()
    // the handles and the key step aside while it is open
    await expect(page.locator('.sheet .sg-handle')).toHaveCount(0)
    await expect(menuKey(page)).toHaveCount(0)
    // a hardware keyboard (iPad): the arrows walk the entries
    await page.keyboard.press('ArrowDown')
    await expect(entry(page, 'Pick a value for C7')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(entry(page, AREA)).toBeFocused()
    await page.keyboard.press('End')
    await expect(entry(page, 'More cell actions')).toBeFocused()
    // a scroll closes it
    await page.locator('.sheet .sg').evaluate((el) => (el.scrollLeft = 40))
    await expect(menu(page)).toHaveCount(0)
  })

  test('long press + drag selects a range (the menu that opened at the threshold closes); a swipe scrolls and selects nothing; a tap selects one cell', async ({ page }) => {
    await openApp(page)
    await touchSheet(page, NUMBERS)
    const f = await finger(page)
    await cell(page, 'A1').tap()
    await f.drag(await mid(cell(page, 'B3')), await mid(cell(page, 'C5')), { hold: 550 })
    await expect(nameBox(page)).toHaveText('B3:C5')
    await expect(page.locator('.sheet .sh-status')).toContainText('SUM 45')
    await expect(menu(page)).toHaveCount(0)

    // a swipe: the grid scrolls, the selection stays
    const grid = page.locator('.sheet .sg')
    const from = await mid(cell(page, 'D8'))
    await f.drag(from, { x: from.x - 200, y: from.y }, { steps: 10 })
    await expect.poll(() => grid.evaluate((el) => el.scrollLeft)).toBeGreaterThan(40)
    await expect(nameBox(page)).toHaveText('B3:C5')
    await expect(menu(page)).toHaveCount(0)

    await grid.evaluate((el) => (el.scrollLeft = 0))
    await page.waitForTimeout(300)
    await cell(page, 'B9').tap()
    await expect(nameBox(page)).toHaveText('B9')
    // a finger's long press is no right-click: the desktop menu stays closed (the cell menu opened at the threshold)
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

  test('menu entries: copy → paste into another range, cut → paste, fill down / right, clear; More… holds the rest of the cell menu', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openApp(page)
    const id = await touchSheet(page, { A5: 'x', B5: '=A6*2', A6: '21', C8: '7', C2: 'k' })
    const f = await finger(page)
    await cell(page, 'A5').tap()
    await f.drag(await mid(page.locator('.sheet .sg-handle.is-br')), await mid(cell(page, 'B6')))
    await expect(nameBox(page)).toHaveText('A5:B6')
    await menuKey(page).tap()
    await entry(page, 'Copy').tap()
    await expect(menu(page)).toHaveCount(0)
    await expect(page.getByText('Copied A5:B6.')).toBeVisible()
    await f.tap(await mid(cell(page, 'D9')))
    await f.again(await mid(cell(page, 'D9')))
    await entry(page, 'Paste').tap()
    await expect(cell(page, 'D9')).toHaveText('x')
    await expect(cell(page, 'E9')).toHaveText('42')
    await expect(cell(page, 'D10')).toHaveText('21')
    await expect(nameBox(page)).toHaveText('D9:E10')
    // an internal paste moves the references like ⌘V does
    expect((await stored(page, id)).sheets[0].cells.E9.v).toBe('=D10*2')

    // Cut: the source empties once pasted (the key a moment after the tap that brought it: right away
    // the two taps are a double tap — that edits the cell)
    await f.tap(await mid(cell(page, 'C2')))
    await settle(page)
    await menuKey(page).tap()
    await entry(page, 'Cut').tap()
    await expect(page.getByText('Cut C2 — paste it where it should go.')).toBeVisible()
    await f.tap(await mid(cell(page, 'C4')))
    await settle(page)
    await menuKey(page).tap()
    await entry(page, 'Paste').tap()
    await expect(cell(page, 'C4')).toHaveText('k')
    await expect(cell(page, 'C2')).toHaveText('')

    // Fill ↓ from the menu: the top cell of the selection down
    await f.tap(await mid(cell(page, 'C8')))
    await f.drag(await mid(page.locator('.sheet .sg-handle.is-br')), await mid(cell(page, 'C11')))
    await expect(nameBox(page)).toHaveText('C8:C11')
    await settle(page)
    await f.tap(await mid(cell(page, 'C9')))
    await entry(page, 'Fill down').tap()
    await expect(cell(page, 'C11')).toHaveText('7')
    await expect(page.locator('.sheet .sh-status')).toContainText('SUM 28')
    // Fill → on a single column takes the column to its left; column A has none: greyed
    await f.tap(await mid(cell(page, 'D8')))
    await settle(page)
    await menuKey(page).tap()
    await entry(page, 'Fill right').tap()
    await expect(cell(page, 'D8')).toHaveText('7')
    await f.tap(await mid(cell(page, 'A9')))
    await settle(page)
    await menuKey(page).tap()
    await expect(entry(page, 'Fill right')).toBeDisabled()
    await expect(entry(page, 'Fill down')).toBeEnabled()
    await page.keyboard.press('Escape')

    // Clear
    await f.tap(await mid(cell(page, 'C8')))
    await f.drag(await mid(page.locator('.sheet .sg-handle.is-br')), await mid(cell(page, 'C11')))
    await menuKey(page).tap()
    await entry(page, 'Clear contents').tap()
    await expect(cell(page, 'C8')).toHaveText('')
    await expect(cell(page, 'C11')).toHaveText('')

    // More…: the cell menu's other entries in place (with Fill series), back returns
    await menuKey(page).tap()
    await entry(page, 'More cell actions').tap()
    await expect(menu(page).getByRole('menuitem', { name: 'Fill series' })).toBeVisible()
    await menu(page).getByRole('button', { name: /^Back/ }).tap()
    await expect(entry(page, 'Copy')).toBeVisible()
    await entry(page, 'More cell actions').tap()
    await menu(page).getByRole('menuitem', { name: 'Insert row below' }).tap()
    await expect(menu(page)).toHaveCount(0)
    const a = await stored(page, id)
    expect(a.sheets[0].cells.C9).toBeUndefined()
    expect(a.sheets[0].cells.C4.v).toBe('k')
    expect(a.sheets[0].cells.C2).toBeUndefined()
    expect(a.sheets[0].cells.D8.v).toBe('7')
    // four rows went in under C8:C11
    expect((a.sheets[0] as unknown as { rows: number }).rows).toBe(16)
  })

  test('"+ Area": the chip waits on the grid\'s top edge, a tap starts the next area, the chart takes DS(…) of both; × cancels; pointing in a formula adds an area from the strip', async ({ page }) => {
    await openApp(page)
    const id = await touchSheet(page, { A1: '1', A2: '2', A3: '3', C1: '10', C2: '20', A6: '4', A7: '5', A8: '6', C6: '7', C7: '8' })
    const f = await finger(page)
    await cell(page, 'A1').tap()
    await f.drag(await mid(page.locator('.sheet .sg-handle.is-br')), await mid(cell(page, 'A3')))
    await expect(nameBox(page)).toHaveText('A1:A3')
    await menuKey(page).tap()
    await expect(entry(page, AREA)).toHaveAttribute('aria-pressed', 'false')
    await entry(page, AREA).tap()
    await expect(menu(page)).toHaveCount(0)
    // the chip sits on the column letters, over no cell
    await expect(areaChip(page)).toBeVisible()
    await expect(areaChip(page)).toContainText('+ Area')
    await expect(areaChip(page)).toContainText('tap or drag the next one')
    const c = (await areaChip(page).boundingBox())!
    // on the formula bar: the column letters and the cells stay in sight
    const letters = (await page.locator('.sheet .sg-head').boundingBox())!
    expect(c.y + c.height).toBeLessThanOrEqual(letters.y)
    const bar = (await page.locator('.sheet .sh-bar').boundingBox())!
    expect(c.y).toBeGreaterThanOrEqual(bar.y)
    expect(c.x + c.width).toBeLessThanOrEqual(390)
    // latched: the menu shows it on
    await menuKey(page).tap()
    await expect(entry(page, AREA)).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Escape')
    await f.tap(await mid(cell(page, 'C1')))
    await expect(nameBox(page)).toHaveText('C1 +1')
    await expect(areaChip(page)).toHaveCount(0)
    await f.drag(await mid(page.locator('.sheet .sg-handle.is-br')), await mid(cell(page, 'C2')))
    await expect(nameBox(page)).toHaveText('C1:C2 +1')
    await expect(page.locator('.sheet .sg-ov--sel')).toHaveCount(2)
    await expect(page.locator('.sheet .sh-status')).toContainText('SUM 36')
    await menuKey(page).tap()
    await expect(menu(page)).toContainText('5 cells')
    await entry(page, 'Chart from the selection').tap()
    await page.locator('[data-testid="chart-builder-save"]').tap()
    await expect(page.locator('.sheet .sh-chart')).toHaveCount(1)
    expect((await stored(page, id)).charts[0].spec.source.ref).toBe('DS(A1:A3; C1:C2)')

    // × on the chip: nothing waits any more, the next tap selects
    await f.tap(await mid(cell(page, 'B5')))
    await settle(page)
    await menuKey(page).tap()
    await entry(page, AREA).tap()
    await areaChip(page).getByRole('button', { name: 'Cancel “+ Area”' }).tap()
    await expect(areaChip(page)).toHaveCount(0)
    await f.tap(await mid(cell(page, 'B8')))
    await expect(nameBox(page)).toHaveText('B8')

    // a typed =SUM(DS(, one area pointed by a long press, "+ Area" in the strip, the next by a tap
    await cell(page, 'D1').tap()
    await page.getByRole('textbox', { name: 'Formula' }).tap()
    await page.keyboard.type('=SUM(DS(')
    await expect(chip(page, AREA)).toHaveCount(0)
    await f.drag(await mid(cell(page, 'A6')), await mid(cell(page, 'A8')), { hold: 550 })
    const input = page.locator('.sh-bar .fx-input__field')
    await expect(input).toHaveValue('=SUM(DS(A6:A8')
    await expect(menu(page)).toHaveCount(0)
    await expect(chip(page, AREA)).toHaveAttribute('aria-pressed', 'false')
    await chip(page, AREA).tap()
    await expect(chip(page, AREA)).toHaveAttribute('aria-pressed', 'true')
    await settle(page)
    await f.tap(await mid(cell(page, 'C6')))
    await expect(input).toHaveValue('=SUM(DS(A6:A8; C6')
    // the selection's chip never shows while a formula is edited
    await expect(areaChip(page)).toHaveCount(0)
    await page.keyboard.type('))')
    await page.keyboard.press('Enter')
    await expect(cell(page, 'D1')).toHaveText('22')
    expect((await stored(page, id)).sheets[0].cells.D1.v).toBe('=SUM(DS(A6:A8; C6))')
  })

  test('read-only: handles still select, the "⋯" key stays, the menu only copies, no fill tab', async ({ page }) => {
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
    await expect(menuKey(page)).toBeVisible()
    await onEdge(page, 'B2', 'C3')
    await menuKey(page).tap()
    await expect(menu(page).getByRole('menuitem')).toHaveCount(1)
    await entry(page, 'Copy').tap()
    await expect(page.getByText('Copied B2:C3.')).toBeVisible()
    // a long press: the same menu, Copy alone
    await f.down(await mid(cell(page, 'B7')))
    await expect(menu(page).getByRole('menuitem')).toHaveCount(1)
    await f.up()
  })

  test('German: the menu speaks German and fits the phone — rows and keys finger-sized; the chip too', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await touchSheet(page, NUMBERS)
    const f = await finger(page)
    await f.tap(await mid(cell(page, 'A6')))
    await f.again(await mid(cell(page, 'A6')))
    const m = page.getByRole('dialog', { name: 'Zellmenü A6' })
    await expect(m).toBeVisible()
    await expect(m).toContainText('1 Zelle')
    await expect(m.getByRole('menuitem', { name: 'Kopieren', exact: true })).toContainText('Kopieren')
    await expect(m.getByRole('menuitem', { name: 'Nach unten ausfüllen' })).toContainText('Füllen ↓')
    await expect(m.getByRole('menuitem', { name: 'Wert für A6 wählen' })).toContainText('Wert wählen')
    await expect(m.getByRole('menuitem', { name: 'A6 bearbeiten' })).toContainText('Bearbeiten')
    await expect(m.getByRole('menuitem', { name: 'Weitere Zellaktionen' })).toContainText('Mehr…')
    // a single column A: nothing to its left to fill from
    await expect(m.getByRole('menuitem', { name: 'Nach rechts ausfüllen' })).toBeDisabled()
    const box = (await m.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    for (const k of await m.getByRole('menuitem').all()) {
      const b = (await k.boundingBox())!
      expect(b.x + b.width).toBeLessThanOrEqual(390)
      expect(b.width).toBeGreaterThanOrEqual(44)
      expect(b.height).toBeGreaterThanOrEqual(44)
    }
    await m.getByRole('menuitem', { name: /^Weiteren Bereich hinzufügen/ }).tap()
    await expect(areaChip(page)).toContainText('+ Bereich')
    await expect(areaChip(page)).toContainText('tippen oder ziehen')
    const c = (await areaChip(page).boundingBox())!
    expect(c.x).toBeGreaterThanOrEqual(0)
    expect(c.x + c.width).toBeLessThanOrEqual(390)
    // the whole hint fits (no ellipsis)
    expect(await areaChip(page).locator('.sh-areachip__hint').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  })
})

const TASKS: Cells = { A1: 'Task', A2: 'Website relaunch', A3: 'Design review', A4: 'Webinar', B1: 'Owner', B2: 'Ada', B3: 'Grace', B4: 'Ada', C1: '1', C2: '2', C3: '3', C4: '4' }

test.describe('spreadsheet block by touch — phone keyboards and long presses', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('AutoComplete with an on-screen keyboard: compositions and 229 keys propose, a chip takes the value, Backspace as an input event drops the proposal', async ({ page }) => {
    await openApp(page)
    const id = await touchSheet(page, TASKS)
    const kb = await phoneKeys(page)
    const f = await finger(page)
    const cellInput = page.locator('.fx-input--cell input')
    const ghost = page.locator('.fx-input--cell .fx-ghost')

    // A5: the cell menu's Edit opens the in-cell editor (the keyboard comes up)
    await f.drag(await mid(cell(page, 'A5')), await mid(cell(page, 'A5')), { hold: 550 })
    await entry(page, 'Edit A5').tap()
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
    // the strip turns into the picking keys: Type, Done (+ Area once a reference is pointed) — no floating bar
    await expect(strip(page)).toContainText('RANGE')
    await expect(strip(page).getByRole('button')).toHaveText(['Type', 'Done'])
    await expect(page.locator('.sh-touchbar')).toHaveCount(0)
    await f.drag(await mid(cell(page, 'C4')), await mid(cell(page, 'D5')), { hold: 550 })
    await expect(bar).toHaveValue('=MAX(C4:D5')
    await expect(menu(page)).toHaveCount(0)
    await expect(strip(page).getByRole('button')).toHaveText(['+ Area', 'Type', 'Done'])
    // a tap replaces the pointed reference
    await settle(page)
    await f.tap(await mid(cell(page, 'C5')))
    await expect(bar).toHaveValue('=MAX(C5')
    await expect(bar).not.toBeFocused()
    await chip(page, 'Keep typing').tap()
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
    await chip(page, 'Done — take the formula').tap()
    await expect(cell(page, 'E4')).toHaveText('7')
    const a = await stored(page, id)
    expect(a.sheets[0].cells.E2.v).toBe('=SUM(DS(Plan))')
    expect(a.sheets[0].cells.E3.v).toBe('=MAX(C5)')
    expect(a.sheets[0].cells.E4.v).toBe('=B4')
  })

  test('long press: the menu opens at the threshold, the finger still down; pick a value, fill down, edit; a finger that travels on closes it for a range', async ({ page }) => {
    await openApp(page)
    const id = await touchSheet(page, TASKS)
    const f = await finger(page)
    const at = async (addr: string) => f.drag(await mid(cell(page, addr)), await mid(cell(page, addr)), { hold: 550 })

    await f.down(await mid(cell(page, 'B5')))
    const m = page.getByRole('dialog', { name: 'Cell menu B5' })
    // open while the finger is still down, the cell selected, the menu off it
    await expect(m).toBeVisible()
    await expect(nameBox(page)).toHaveText('B5')
    await menuClear(page, 'B5', 'B5', 390, 844)
    await f.up()
    await expect(m).toBeVisible()
    await expect(entry(page, 'Pick a value for B5')).toContainText('3')
    await entry(page, 'Pick a value for B5').tap()
    await expect(m.getByRole('option')).toHaveText(['Ada', 'Grace', 'Owner'])
    // finger-sized, inside the screen
    for (const o of await m.getByRole('option').all()) expect((await o.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    const box = (await m.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    // no keyboard yet: the search field waits for a tap
    await expect(m.getByRole('combobox')).not.toBeFocused()
    await m.getByRole('combobox').tap()
    await page.keyboard.type('gr')
    await expect(m.getByRole('option')).toHaveText(['Grace'])
    await m.getByRole('option', { name: 'Grace' }).tap()
    await expect(m).toHaveCount(0)
    await expect(cell(page, 'B5')).toHaveText('Grace')

    // Fill ↓ (a single cell takes the one above)
    await at('B6')
    await entry(page, 'Fill down').tap()
    await expect(cell(page, 'B6')).toHaveText('Grace')
    // Edit: the in-cell editor with the keyboard
    await at('C6')
    await entry(page, 'Edit C6').tap()
    await expect(page.locator('.fx-input--cell input')).toBeFocused()
    await page.keyboard.type('5')
    await page.keyboard.press('Enter')
    await expect(cell(page, 'C6')).toHaveText('5')
    // Esc closes it without writing
    await at('B8')
    await expect(page.getByRole('dialog', { name: 'Cell menu B8' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu(page)).toHaveCount(0)
    await expect(cell(page, 'B8')).toHaveText('')

    // the finger travels on after the menu opened: it closes, the drag selects a range
    const from = await mid(cell(page, 'C2'))
    const to = await mid(cell(page, 'C4'))
    await f.down(from)
    await expect(page.getByRole('dialog', { name: 'Cell menu C2' })).toBeVisible()
    for (let i = 1; i <= 6; i++) await f.move({ x: from.x + ((to.x - from.x) * i) / 6, y: from.y + ((to.y - from.y) * i) / 6 })
    await expect(menu(page)).toHaveCount(0)
    await expect(nameBox(page)).toHaveText('C2:C4')
    await f.up()
    await expect(nameBox(page)).toHaveText('C2:C4')
    await expect(menu(page)).toHaveCount(0)
    // the keyboard (and so the handles) are back on the grid
    await expect(page.locator('.sheet .sg')).toBeFocused()
    await expect(page.locator('.sheet .sg-handle')).toHaveCount(2)
    // a long press inside the selection: the menu for all of it, the selection stays
    await settle(page)
    await f.down(await mid(cell(page, 'C3')))
    await expect(page.getByRole('dialog', { name: 'Cell menu C2:C4' })).toBeVisible()
    await f.up()
    await expect(nameBox(page)).toHaveText('C2:C4')
    await page.keyboard.press('Escape')
    const a = await stored(page, id)
    expect(a.sheets[0].cells.B5.v).toBe('Grace')
    expect(a.sheets[0].cells.B6.v).toBe('Grace')
    expect(a.sheets[0].cells.C6.v).toBe('5')
  })

  test('"+ Area" from a long-press menu and a long-press drag: two areas for a chart; a drag inside the current area keeps the others; long presses in a formula add areas inside DS(…)', async ({ page }) => {
    await openApp(page)
    const id = await touchSheet(page, { A1: '1', A2: '2', A3: '3', C1: '10', C2: '20', A6: '4', A7: '5', A8: '6', C6: '7', C7: '8' })
    const f = await finger(page)
    await cell(page, 'A1').tap()
    await f.drag(await mid(page.locator('.sheet .sg-handle.is-br')), await mid(cell(page, 'A3')))
    await expect(nameBox(page)).toHaveText('A1:A3')
    // hold A2 (inside): the menu for A1:A3 — "+ Area" there, then a long-press drag from C1 is the next area
    await settle(page)
    await f.down(await mid(cell(page, 'A2')))
    await expect(page.getByRole('dialog', { name: 'Cell menu A1:A3' })).toBeVisible()
    await f.up()
    await entry(page, AREA).tap()
    await expect(areaChip(page)).toBeVisible()
    await f.drag(await mid(cell(page, 'C1')), await mid(cell(page, 'C2')), { hold: 550 })
    await expect(nameBox(page)).toHaveText('C1:C2 +1')
    await expect(areaChip(page)).toHaveCount(0)
    await expect(menu(page)).toHaveCount(0)
    await expect(page.locator('.sheet .sg-ov--sel')).toHaveCount(2)
    await expect(page.locator('.sheet .sh-status')).toContainText('SUM 36')
    await settle(page)
    await f.tap(await mid(cell(page, 'C1')))
    await entry(page, 'Chart from the selection').tap()
    await page.locator('[data-testid="chart-builder-save"]').tap()
    await expect(page.locator('.sheet .sh-chart')).toHaveCount(1)
    expect((await stored(page, id)).charts[0].spec.source.ref).toBe('DS(A1:A3; C1:C2)')

    // a third area by a long press (latched from the ⋯ key's menu; the chart builder took the keyboard)
    await page.locator('.sheet .sg').focus()
    await menuKey(page).tap()
    await entry(page, AREA).tap()
    await f.drag(await mid(cell(page, 'A6')), await mid(cell(page, 'A7')), { hold: 550 })
    await expect(nameBox(page)).toHaveText('A6:A7 +2')
    // a long-press drag from inside the current area restarts it, the other areas stay
    await f.drag(await mid(cell(page, 'A6')), await mid(cell(page, 'A8')), { hold: 550 })
    await expect(nameBox(page)).toHaveText('A6:A8 +2')
    // from inside an older area: a new selection
    await f.drag(await mid(cell(page, 'A2')), await mid(cell(page, 'B2')), { hold: 550 })
    await expect(nameBox(page)).toHaveText('A2:B2')

    // a formula: long presses point, the second one adds another area of the DS (no "+ Area" needed)
    await settle(page)
    await cell(page, 'D1').tap()
    await page.getByRole('textbox', { name: 'Formula' }).tap()
    await page.keyboard.type('=SUM(DS(')
    await f.drag(await mid(cell(page, 'A6')), await mid(cell(page, 'A8')), { hold: 550 })
    const input = page.locator('.sh-bar .fx-input__field')
    await expect(input).toHaveValue('=SUM(DS(A6:A8')
    await f.drag(await mid(cell(page, 'C6')), await mid(cell(page, 'C7')), { hold: 550 })
    await expect(input).toHaveValue('=SUM(DS(A6:A8; C6:C7')
    // lifted in place: one more cell, no menu while editing
    await f.drag(await mid(cell(page, 'A3')), await mid(cell(page, 'A3')), { hold: 550 })
    await expect(input).toHaveValue('=SUM(DS(A6:A8; C6:C7; A3')
    await expect(menu(page)).toHaveCount(0)
    // on touch the signature heads the strip (the input's own popups stay closed)
    await expect(strip(page).locator('.fx-sig__name').first()).toHaveText('DS(')
    await expect(page.locator('.fx-pop')).toHaveCount(0)
    await page.keyboard.type('))')
    await page.keyboard.press('Enter')
    await expect(cell(page, 'D1')).toHaveText('33')
    // outside DS(…) a long press after an argument adds one more argument
    await settle(page)
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

  test('German: the strip and the long-press menu speak German', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await touchSheet(page, TASKS)
    const f = await finger(page)
    const kb = await phoneKeys(page)
    await f.drag(await mid(cell(page, 'A5')), await mid(cell(page, 'A5')), { hold: 550 })
    const m = page.getByRole('dialog', { name: 'Zellmenü A5' })
    await expect(m).toContainText('Wert wählen')
    await expect(m.getByRole('menuitem', { name: /^Weiteren Bereich hinzufügen/ })).toContainText('+ Bereich')
    await expect(m.getByRole('menuitem', { name: 'Nach unten ausfüllen' })).toContainText('Füllen ↓')
    await m.getByRole('menuitem', { name: 'Wert für A5 wählen' }).tap()
    await expect(m.getByRole('button', { name: 'Zurück: Wert für A5' })).toBeVisible()
    await m.getByRole('button', { name: 'Zurück: Wert für A5' }).tap()
    await m.getByRole('menuitem', { name: 'A5 bearbeiten' }).tap()
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
    await chip(page, 'Bereich wählen').tap()
    await expect(strip(page)).toContainText('BEREICH')
    await expect(chip(page, 'Weiter tippen')).toContainText('Tippen')
    await expect(chip(page, 'Fertig — Formel übernehmen')).toContainText('Fertig')
  })
})

test.describe('spreadsheet block by touch — tablet', () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true })

  test('handles across a frozen row, long press, header drag; the menu sits off the selection, inside the tablet', async ({ page }) => {
    await openApp(page)
    await touchSheet(page, NUMBERS, { frozenRows: 1, rows: 40 })
    const f = await finger(page)
    await f.tap(await mid(cell(page, 'C4')))
    await expect(menu(page)).toHaveCount(0)
    await f.again(await mid(cell(page, 'C4')))
    await expect(menu(page)).toBeVisible()
    await menuClear(page, 'C4', 'C4', 768, 1024)
    await page.keyboard.press('Escape')

    // the top-left handle up into the frozen row
    await onEdge(page, 'C4', 'C4')
    await f.drag(await mid(page.locator('.sheet .sg-handle.is-tl')), await mid(cell(page, 'B1')))
    await expect(nameBox(page)).toHaveText('B1:C4')
    await expect(page.locator('.sheet .sg-frozen .sg-handle.is-tl')).toHaveCount(1)
    // from the frozen row into the body: the key and the tab on the body's bottom edge
    await expect(page.locator('.sheet .sg-body .sg-menukey')).toHaveCount(1)
    await onEdge(page, 'B1', 'C4')

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

  test('the long-press menu and the suggestion strip fit the tablet; the strip stays above the cell editor', async ({ page }) => {
    await openApp(page)
    await touchSheet(page, TASKS)
    const f = await finger(page)
    const kb = await phoneKeys(page)
    await f.drag(await mid(cell(page, 'A5')), await mid(cell(page, 'A5')), { hold: 550 })
    await expect(page.getByRole('dialog', { name: 'Cell menu A5' })).toBeVisible()
    await menuClear(page, 'A5', 'A5', 768, 1024)
    await entry(page, 'Edit A5').tap()
    await kb.compose('Des')
    await expect(chip(page, /Design review/)).toBeVisible()
    const sb = (await strip(page).boundingBox())!
    const eb = (await page.locator('.sheet .sg-editor').boundingBox())!
    expect(sb.y + sb.height).toBeLessThanOrEqual(eb.y)
    await chip(page, /Design review/).tap()
    await expect(cell(page, 'A5')).toHaveText('Design review')
  })
})

/**
 * Synthetic iOS input dispatched straight on the pressed cell (no browser gesture handling) — what
 * CDP can't produce: touch events that go on after the pointer events stopped (iOS sends both to the
 * pressed element, also once it left the DOM) and a second finger. `at`: the cell the finger is over.
 */
function iosFinger(page: Page, pressed: string) {
  /** `second`: a second finger comes down · `scrolling`: the browser scrolls already (the touchmove can't be cancelled) */
  return (type: string, at: string, { second = false, scrolling = false } = {}) =>
    page.evaluate(
      ([type, pressed, at, second, scrolling]) => {
        const q = (rc: string) => document.querySelector(`.sheet [data-cell="${rc}"]`) as HTMLElement
        const el = q(pressed)
        const b = q(at).getBoundingClientRect()
        const x = b.x + b.width / 2
        const y = b.y + b.height / 2
        if (type.startsWith('pointer')) {
          el.dispatchEvent(new PointerEvent(type, { pointerId: 41, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: type !== 'pointercancel', composed: true }))
          return
        }
        const one = new Touch({ identifier: 41, target: el, clientX: x, clientY: y })
        const two = new Touch({ identifier: 42, target: el, clientX: x + 30, clientY: y })
        const down = type === 'touchend' || type === 'touchcancel' ? [] : second ? [one, two] : [one]
        el.dispatchEvent(new TouchEvent(type, { touches: down, targetTouches: down, changedTouches: [second ? two : one], bubbles: true, cancelable: !scrolling, composed: true }))
      },
      [type, pos(pressed).join(':'), pos(at).join(':'), second, scrolling] as const,
    )
}

/** iOS's compatibility mouse events at a point (no pointer events with them). */
async function mouseAt(page: Page, addr: string, types: string[]) {
  const p = await mid(cell(page, addr))
  await cell(page, addr).evaluate(
    (el, [types, x, y]) => {
      for (const type of types as string[]) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x as number, clientY: y as number, button: 0, view: window }))
    },
    [types, p.x, p.y] as const,
  )
}

/** All the stylesheets the app loaded, as shipped (Chromium drops -webkit-touch-callout from the CSSOM). */
async function shippedCss(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].filter((l) => l.href.startsWith(location.origin))
    const texts = await Promise.all(links.map(async (l) => (await fetch(l.href)).text()))
    return texts.join('\n') + [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n')
  })
}

test.describe('spreadsheet block by touch — iOS Safari sequences', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const armed = (page: Page) => page.locator('.sheet .sg-armed')

  test('the system takes a held finger (touchcancel, no touchend): before the threshold nothing happens; at it — the cell locks on — the menu is open already and stays', async ({ page }) => {
    await openApp(page)
    await touchSheet(page, TASKS)
    const f = await finger(page)
    const before = await nameBox(page).textContent()
    await f.down(await mid(cell(page, 'B5')))
    await page.waitForTimeout(150)
    await expect(armed(page)).toHaveCount(0)
    await f.cancel()
    await page.waitForTimeout(600)
    await expect(armed(page)).toHaveCount(0)
    await expect(menu(page)).toHaveCount(0)
    await expect(nameBox(page)).toHaveText(before ?? '')

    await f.down(await mid(cell(page, 'B5')))
    // at the threshold: the signal frame sits on the held cell, the menu is open — the finger still down
    await expect(armed(page)).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Cell menu B5' })).toBeVisible()
    const a = (await armed(page).boundingBox())!
    const c = (await cell(page, 'B5').boundingBox())!
    expect(Math.abs(a.x - c.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(a.y - c.y)).toBeLessThanOrEqual(1)
    expect(Math.abs(a.width - c.width)).toBeLessThanOrEqual(2)
    await page.waitForTimeout(250)
    await f.cancel()
    await expect(armed(page)).toHaveCount(0)
    await page.waitForTimeout(300)
    await expect(page.getByRole('dialog', { name: 'Cell menu B5' })).toBeVisible()
    await expect(nameBox(page)).toHaveText('B5')
  })

  test('a long-press drag the system cancels keeps its range (no menu, nothing latched)', async ({ page }) => {
    await openApp(page)
    await touchSheet(page, NUMBERS)
    const f = await finger(page)
    const from = await mid(cell(page, 'B2'))
    const to = await mid(cell(page, 'C4'))
    await f.down(from)
    await page.waitForTimeout(550)
    await expect(armed(page)).toBeVisible()
    for (let i = 1; i <= 8; i++) await f.move({ x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8 })
    // dragging: the range is the feedback now
    await expect(armed(page)).toHaveCount(0)
    await f.cancel()
    await expect(nameBox(page)).toHaveText('B2:C4')
    await expect(page.locator('.sheet .sh-status')).toContainText('SUM 27')
    await expect(menu(page)).toHaveCount(0)
    await expect(areaChip(page)).toHaveCount(0)
  })

  test("iOS's compatibility mouse events at the finger's point — mid-press and after the lift — neither cancel the long press nor close its menu", async ({ page }) => {
    await openApp(page)
    await touchSheet(page, TASKS)
    const f = await finger(page)
    await f.down(await mid(cell(page, 'B6')))
    await mouseAt(page, 'B6', ['mouseover', 'mousemove', 'mousedown', 'mouseup'])
    await expect(armed(page)).toBeVisible()
    await mouseAt(page, 'B6', ['mousemove', 'mousedown', 'mouseup', 'click'])
    await page.waitForTimeout(100)
    await expect(armed(page)).toBeVisible()
    const m = page.getByRole('dialog', { name: 'Cell menu B6' })
    await expect(m).toBeVisible()
    await f.up()
    await expect(m).toBeVisible()
    // the click iOS sends where a long press was
    await mouseAt(page, 'B6', ['mousemove', 'mousedown', 'mouseup', 'click'])
    await page.waitForTimeout(150)
    await expect(m).toBeVisible()
    await entry(page, 'Pick a value for B6').tap()
    await m.getByRole('option', { name: 'Grace' }).tap()
    await expect(cell(page, 'B6')).toHaveText('Grace')
    // a real tap later still selects (the leftovers are only ignored for a moment)
    await page.waitForTimeout(900)
    await cell(page, 'C3').tap()
    await expect(nameBox(page)).toHaveText('C3')
  })

  test('the grid is neither selectable nor has a callout; the cell editor stays a selectable text field', async ({ page }) => {
    await openApp(page)
    await touchSheet(page, TASKS)
    for (const sel of ['.sg-cell', '.sg-colhead', '.sg-rowhead']) expect(await page.locator(`.sheet ${sel}`).first().evaluate((el) => getComputedStyle(el).userSelect)).toBe('none')
    const css = await shippedCss(page)
    expect(css).toMatch(/\.sg\{[^}]*-webkit-touch-callout:none/)
    expect(css).toMatch(/\.sg\{[^}]*touch-action:manipulation/)
    expect(css).toMatch(/\.sg-editor\{[^}]*user-select:text/)
    expect(css).toMatch(/\.sg-editor\{[^}]*-webkit-touch-callout:default/)

    const f = await finger(page)
    await f.drag(await mid(cell(page, 'A5')), await mid(cell(page, 'A5')), { hold: 550 })
    await entry(page, 'Edit A5').tap()
    const input = page.locator('.fx-input--cell input')
    await expect(input).toBeFocused()
    expect(await page.locator('.sheet .sg-editor').evaluate((el) => getComputedStyle(el).userSelect)).toBe('text')
    expect(await input.evaluate((el) => getComputedStyle(el).userSelect)).not.toBe('none')
    await page.keyboard.type('Webinar')
    const range = await input.evaluate((el: HTMLInputElement) => {
      el.select()
      return [el.selectionStart, el.selectionEnd]
    })
    expect(range).toEqual([0, 7])
  })

  test('a swipe scrolls the grid with no touchmove prevented; only a long-press drag holds the page still', async ({ page }) => {
    await openApp(page)
    await touchSheet(page, NUMBERS)
    await page.evaluate(() => {
      const w = window as unknown as { __tm: { n: number; prevented: number } }
      w.__tm = { n: 0, prevented: 0 }
      window.addEventListener('touchmove', (e) => {
        w.__tm.n++
        if (e.defaultPrevented) w.__tm.prevented++
      })
    })
    const counts = () => page.evaluate(() => (window as unknown as { __tm: { n: number; prevented: number } }).__tm)
    const reset = () => page.evaluate(() => ((window as unknown as { __tm: { n: number; prevented: number } }).__tm = { n: 0, prevented: 0 }))
    const f = await finger(page)
    const grid = page.locator('.sheet .sg')
    const from = await mid(cell(page, 'D8'))
    await f.drag(from, { x: from.x - 200, y: from.y }, { steps: 10 })
    await expect.poll(() => grid.evaluate((el) => el.scrollLeft)).toBeGreaterThan(40)
    let c = await counts()
    expect(c.n).toBeGreaterThan(0)
    expect(c.prevented).toBe(0)
    await grid.evaluate((el) => (el.scrollLeft = 0))
    await page.waitForTimeout(300)
    await reset()
    await f.drag(await mid(cell(page, 'B3')), await mid(cell(page, 'C5')), { hold: 550 })
    await expect(nameBox(page)).toHaveText('B3:C5')
    c = await counts()
    expect(c.prevented).toBeGreaterThan(0)
    expect(await grid.evaluate((el) => el.scrollLeft)).toBe(0)
    // and right after, a swipe scrolls again
    await reset()
    const again = await mid(cell(page, 'D9'))
    await f.drag(again, { x: again.x - 200, y: again.y }, { steps: 10 })
    await expect.poll(() => grid.evaluate((el) => el.scrollLeft)).toBeGreaterThan(40)
    expect((await counts()).prevented).toBe(0)
  })

  test("pointer events stop mid-drag (iOS: the pressed row scrolled out of the DOM) — the finger's touch events carry it on; an early pointercancel doesn't end a still finger; a second finger does", async ({ page }) => {
    await openApp(page)
    await touchSheet(page, TASKS)
    const one = iosFinger(page, 'B2')
    await one('pointerdown', 'B2')
    await one('touchstart', 'B2')
    await expect(armed(page)).toBeVisible()
    await one('touchmove', 'B3')
    await one('touchmove', 'C4')
    await one('touchend', 'C4')
    await expect(nameBox(page)).toHaveText('B2:C4')
    await expect(menu(page)).toHaveCount(0)

    // the pointer cancelled before the threshold, the finger still down and still: the menu opens at the threshold
    await page.waitForTimeout(900)
    const two = iosFinger(page, 'B6')
    await two('pointerdown', 'B6')
    await two('touchstart', 'B6')
    await two('pointercancel', 'B6')
    await expect(armed(page)).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Cell menu B6' })).toBeVisible()
    await two('touchend', 'B6')
    await expect(page.getByRole('dialog', { name: 'Cell menu B6' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu(page)).toHaveCount(0)

    // a second finger before it armed: a pinch, no long press
    await page.waitForTimeout(900)
    const kept = (await nameBox(page).textContent()) ?? ''
    const three = iosFinger(page, 'B7')
    await three('pointerdown', 'B7')
    await three('touchstart', 'B7')
    await three('touchstart', 'B7', { second: true })
    await page.waitForTimeout(600)
    await expect(armed(page)).toHaveCount(0)
    await three('touchend', 'B7')
    await expect(menu(page)).toHaveCount(0)

    // the pointer cancelled early and the touch moves on while the browser scrolls: a swipe, no long press
    const four = iosFinger(page, 'B8')
    await four('pointerdown', 'B8')
    await four('touchstart', 'B8')
    await four('pointercancel', 'B8')
    await four('touchmove', 'B8', { scrolling: true })
    await page.waitForTimeout(600)
    await expect(armed(page)).toHaveCount(0)
    await four('touchend', 'B8')
    await expect(menu(page)).toHaveCount(0)
    await expect(nameBox(page)).toHaveText(kept)
  })

  test('touch events alone (no pointer events): the menu opens at ~450 ms, the finger still down; a touchcancel afterwards keeps it', async ({ page }) => {
    await openApp(page)
    await touchSheet(page, TASKS)
    const one = iosFinger(page, 'B3')
    const t0 = await page.evaluate(() => performance.now())
    await one('touchstart', 'B3')
    await page.waitForTimeout(250)
    await expect(menu(page)).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: 'Cell menu B3' })).toBeVisible()
    const t1 = await page.evaluate(() => performance.now())
    expect(t1 - t0).toBeGreaterThanOrEqual(440)
    await expect(armed(page)).toBeVisible()
    await expect(nameBox(page)).toHaveText('B3')
    await one('touchcancel', 'B3')
    await expect(armed(page)).toHaveCount(0)
    await page.waitForTimeout(300)
    await expect(page.getByRole('dialog', { name: 'Cell menu B3' })).toBeVisible()
    await page.keyboard.press('Escape')

    // moved past the slop before the threshold: a swipe, no menu
    await page.waitForTimeout(900)
    const two = iosFinger(page, 'B5')
    await two('touchstart', 'B5')
    await two('touchmove', 'C5')
    await page.waitForTimeout(700)
    await expect(menu(page)).toHaveCount(0)
    await two('touchend', 'C5')
    // held, then travelling on: the menu closes, a range follows the touch
    await page.waitForTimeout(900)
    const three = iosFinger(page, 'A2')
    await three('touchstart', 'A2')
    await expect(page.getByRole('dialog', { name: 'Cell menu A2' })).toBeVisible()
    await three('touchmove', 'B3')
    await three('touchmove', 'B4')
    await expect(menu(page)).toHaveCount(0)
    await three('touchend', 'B4')
    await expect(nameBox(page)).toHaveText('A2:B4')
  })

  test('pointer events alone (no touch events) open it at the threshold too; pointer + touch in either order are one press — one menu, one tick', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __buzz: number }
      w.__buzz = 0
      Object.defineProperty(navigator, 'userActivation', { configurable: true, get: () => ({ hasBeenActive: true, isActive: true }) })
      navigator.vibrate = () => {
        w.__buzz++
        return true
      }
    })
    await openApp(page)
    await touchSheet(page, TASKS)
    const buzzes = () => page.evaluate(() => (window as unknown as { __buzz: number }).__buzz)
    const one = iosFinger(page, 'B4')
    await one('pointerdown', 'B4')
    await page.waitForTimeout(250)
    await expect(menu(page)).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: 'Cell menu B4' })).toBeVisible()
    await one('pointerup', 'B4')
    await expect(page.getByRole('dialog', { name: 'Cell menu B4' })).toBeVisible()
    expect(await buzzes()).toBe(1)
    await page.keyboard.press('Escape')

    // the touchstart first, its pointerdown after: joined
    await page.waitForTimeout(900)
    const two = iosFinger(page, 'C3')
    await two('touchstart', 'C3')
    await two('pointerdown', 'C3')
    await expect(page.getByRole('dialog', { name: 'Cell menu C3' })).toBeVisible()
    await page.waitForTimeout(300)
    expect(await buzzes()).toBe(2)
    await expect(menu(page)).toHaveCount(1)
    await two('pointerup', 'C3')
    await two('touchend', 'C3')
    await page.keyboard.press('Escape')

    // the pointerdown first, its touchstart after: joined as well
    await page.waitForTimeout(900)
    const three = iosFinger(page, 'A4')
    await three('pointerdown', 'A4')
    await three('touchstart', 'A4')
    await expect(page.getByRole('dialog', { name: 'Cell menu A4' })).toBeVisible()
    await page.waitForTimeout(300)
    expect(await buzzes()).toBe(3)
    await three('touchend', 'A4')
    await three('pointerup', 'A4')
    await expect(menu(page)).toHaveCount(1)
  })

  test('on iOS the page is unselectable while a finger is down on the grid, selectable again just after', async ({ page }) => {
    // WebKit on a touch screen, as the grid detects it
    await page.addInitScript(() => {
      const supports = CSS.supports.bind(CSS) as (a: string, b?: string) => boolean
      CSS.supports = ((a: string, b?: string) => (a.includes('touch-callout') ? true : b === undefined ? supports(a) : supports(a, b))) as typeof CSS.supports
    })
    await openApp(page)
    await touchSheet(page, TASKS)
    const f = await finger(page)
    const pageSelect = () => page.evaluate(() => getComputedStyle(document.documentElement).userSelect)
    const initial = await pageSelect()
    expect(initial).not.toBe('none')
    await f.down(await mid(cell(page, 'B5')))
    await expect.poll(pageSelect).toBe('none')
    await expect(armed(page)).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Cell menu B5' })).toBeVisible()
    await f.up()
    await expect(page.getByRole('dialog', { name: 'Cell menu B5' })).toBeVisible()
    await expect.poll(pageSelect).toBe(initial)
    expect(await page.evaluate(() => document.documentElement.getAttribute('style') ?? '')).not.toMatch(/user-select/)
  })
})

/** Text in every cell — left-aligned, where a key or a tab over a neighbour would hide it ("2b" in B2). */
function lettered(extra: Cells = {}): Cells {
  const out: Cells = {}
  for (let r = 1; r <= 12; r++) for (const c of 'ABCDEFGH') out[`${c}${r}`] = `${r}${c.toLowerCase()}`
  return { ...out, ...extra }
}

test.describe('spreadsheet block by touch — the "⋯" key and the fill tab on the selection\'s edge', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('a cell, one 64 px column, a range, a row wider than the screen, the last column: nothing covers another cell; the knob drags, the tab fills, the key opens the menu, a tap beside selects', async ({ page }) => {
    await openApp(page)
    await touchSheet(page, lettered({ D1: 'Mon' }))
    const f = await finger(page)
    // A1 (64 px): the key on the bottom edge, the tab on the right edge — no room for both below; the
    // top-left knob on row 1 stays whole and its own
    await f.tap(await mid(cell(page, 'A1')))
    await expect(nameBox(page)).toHaveText('A1')
    await onEdge(page, 'A1', 'A1')
    await expect(fillTab(page)).toHaveClass(/is-right/)
    const tl = await mid(page.locator('.sheet .sg-handle.is-tl'))
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.matches('.sg-handle.is-tl') ?? false, tl)).toBe(true)
    // a tap beside the selection selects there — B2, where the key and the tab used to hang
    await f.tap(await mid(cell(page, 'B2')))
    await expect(nameBox(page)).toHaveText('B2')
    await expect(menu(page)).toHaveCount(0)
    await onEdge(page, 'B2', 'B2')
    await settle(page)
    await f.tap(await mid(cell(page, 'A1')))
    await expect(nameBox(page)).toHaveText('A1')

    // one 64 px column (the knob drags): the key below, the tab on the right edge above the knob
    await f.drag(await mid(brKnob(page)), await mid(cell(page, 'A10')))
    await expect(nameBox(page)).toHaveText('A1:A10')
    await onEdge(page, 'A1', 'A10')
    await expect(fillTab(page)).toHaveClass(/is-right/)
    await f.tap(await mid(cell(page, 'A11')))
    await expect(nameBox(page)).toHaveText('A11')
    await f.tap(await mid(cell(page, 'B11')))
    await expect(nameBox(page)).toHaveText('B11')

    // a double tap edits the cell — also when its second tap lands on the key its first one brought
    await settle(page)
    const c9 = await mid(cell(page, 'C9'))
    await f.down(c9)
    await f.up()
    await page.waitForTimeout(100)
    await f.down({ x: c9.x, y: c9.y + 8 })
    await f.up()
    await expect(page.locator('.sheet .sg-editor')).toBeVisible()
    await expect(menu(page)).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.locator('.sheet .sg-editor')).toHaveCount(0)
    await expect(cell(page, 'C9')).toHaveText('9c')

    // a range: both on the bottom edge — the key centred, the tab at the right end; the key opens the menu
    await settle(page)
    await f.tap(await mid(cell(page, 'B2')))
    await f.drag(await mid(brKnob(page)), await mid(cell(page, 'D5')))
    await expect(nameBox(page)).toHaveText('B2:D5')
    await onEdge(page, 'B2', 'D5')
    await expect(fillTab(page)).toHaveClass(/is-bottom/)
    await menuKey(page).tap()
    await expect(page.getByRole('dialog', { name: 'Cell menu B2:D5' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu(page)).toHaveCount(0)
    // a tap on the tab (no drag) is a tap on the selection under it: the menu, the range stays
    await settle(page)
    await f.tap(await mid(fillTab(page)))
    await expect(page.getByRole('dialog', { name: 'Cell menu B2:D5' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu(page)).toHaveCount(0)
    await expect(nameBox(page)).toHaveText('B2:D5')

    // the tab fills — here from one cell, the tab on its right edge
    await f.tap(await mid(cell(page, 'D1')))
    await expect(nameBox(page)).toHaveText('D1')
    await f.drag(await mid(fillTab(page)), await mid(cell(page, 'D4')))
    await expect(cell(page, 'D4')).toHaveText('Thu')
    await expect(cell(page, 'D2')).toHaveText('Tue')
    await expect(nameBox(page)).toHaveText('D1:D4')
    await onEdge(page, 'D1', 'D4')

    // a row wider than the screen: both on the bottom edge's part in view
    await settle(page)
    await page.locator('.sheet [data-rowhead="5"]').tap()
    await expect(nameBox(page)).toHaveText('A6:H6')
    await onEdge(page, 'A6', 'H6')
    await expect(fillTab(page)).toHaveClass(/is-bottom/)

    // scrolled to the last column: the cell at the corner of the sheet
    await page.locator('.sheet .sg').evaluate((el) => (el.scrollLeft = el.scrollWidth))
    await page.waitForTimeout(300)
    await f.tap(await mid(cell(page, 'H12')))
    await expect(nameBox(page)).toHaveText('H12')
    await onEdge(page, 'H12', 'H12')
    await f.tap(await mid(cell(page, 'G11')))
    await expect(nameBox(page)).toHaveText('G11')
  })
})

test.describe('spreadsheet block by touch — where the menu goes', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the menu never covers the selected cells and stays on the screen: a range at the top, a cell at the bottom, the whole sheet', async ({ page }) => {
    await openApp(page)
    await touchSheet(page, NUMBERS)
    const f = await finger(page)
    await f.tap(await mid(cell(page, 'A1')))
    await f.drag(await mid(page.locator('.sheet .sg-handle.is-br')), await mid(cell(page, 'A5')))
    await settle(page)
    await f.tap(await mid(cell(page, 'A3')))
    await expect(menu(page)).toBeVisible()
    await menuClear(page, 'A1', 'A5', 390, 844)
    await page.keyboard.press('Escape')

    // the block's last row at the screen's bottom edge
    await cell(page, 'B12').evaluate((el) => el.scrollIntoView({ block: 'end' }))
    await page.waitForTimeout(300)
    const last = (await cell(page, 'B12').boundingBox())!
    expect(last.y + last.height).toBeLessThanOrEqual(844)
    expect(last.y).toBeGreaterThan(600)
    await f.tap(await mid(cell(page, 'B12')))
    await f.again(await mid(cell(page, 'B12')))
    await expect(menu(page)).toBeVisible()
    await menuClear(page, 'B12', 'B12', 390, 844)
    await page.keyboard.press('Escape')

    // the whole sheet selected (taller than half the screen)
    await page.locator('.sheet .sg-corner').tap()
    await expect(nameBox(page)).toHaveText('A1:H12')
    await f.tap(await mid(cell(page, 'B6')))
    await expect(menu(page)).toBeVisible()
    await expect(menu(page)).toContainText('96 cells')
    await menuClear(page, 'A1', 'A12', 390, 844)
  })
})

test.describe('spreadsheet block with a mouse — unchanged', () => {
  test('a second click on the selection opens nothing, no "⋯" key, no handles; the right-click menu as before', async ({ page }) => {
    await openApp(page)
    await touchSheet(page, NUMBERS)
    await cell(page, 'B2').click()
    await cell(page, 'B2').click()
    await expect(nameBox(page)).toHaveText('B2')
    await expect(menu(page)).toHaveCount(0)
    await expect(menuKey(page)).toHaveCount(0)
    await expect(page.locator('.sheet .sg-handle')).toHaveCount(0)
    await expect(page.locator('.sheet .sg-fill:not(.is-tab)')).toHaveCount(1)
    await cell(page, 'C3').click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Fill series' })).toBeVisible()
    await page.keyboard.press('Escape')
    // a held mouse button is a drag selection, never a long-press menu
    const from = await mid(cell(page, 'B3'))
    const to = await mid(cell(page, 'C4'))
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.waitForTimeout(700)
    await expect(menu(page)).toHaveCount(0)
    await page.mouse.move(to.x, to.y, { steps: 4 })
    await page.mouse.up()
    await expect(nameBox(page)).toHaveText('B3:C4')
    await expect(menu(page)).toHaveCount(0)
  })
})
