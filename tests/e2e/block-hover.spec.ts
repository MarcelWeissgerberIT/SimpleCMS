/**
 * Hover handle × block selection, and the gutter column:
 *  - one grip at a time: while blocks are selected their pinned grip is the only handle (hovering other
 *    blocks adds none; Shift held shows it on unselected ones for Shift+click), a click into the text
 *    brings the hover handle back; the selection a hover-grip menu / drag leaves behind is soft (no pinned
 *    grip, the next block's handle works);
 *  - the grips (hover and pinned) of every block stand in ONE column left of the page content, at any
 *    depth — never on a bullet / number / checkbox or text; inside a callout, quote or column at that
 *    container's edge;
 *  - the target is the deepest block on the pointer's line: over a nested item's marker, the indent left
 *    of it and in the gutter it is that item, never its parent — also on the way to the handle.
 */
import type { Locator, Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, gotoPage, createPage, wsEval, editorOf, doc, para } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
interface Box {
  left: number
  right: number
  top: number
  bottom: number
}

const item = (text: string, ...kids: JSONContent[]): JSONContent => ({ type: 'listItem', content: [para(text), ...kids] })
const todo = (text: string, ...kids: JSONContent[]): JSONContent => ({ type: 'taskItem', attrs: { checked: false }, content: [para(text), ...kids] })
const list = (type: string, ...items: JSONContent[]): JSONContent => ({ type, content: items })

const NESTED = doc(
  para('Intro paragraph.'),
  list('bulletList', item('Parent item', list('bulletList', item('Child one'), item('Child two'))), item('Second parent')),
  list('orderedList', item('First number', list('orderedList', item('Sub a'), item('Sub b'))), item('Second number')),
  list('taskList', todo('Task parent', list('taskList', todo('Task child'))), todo('Task two')),
  para('Closing paragraph.'),
)
/** Every list item of NESTED with its counter (ordered lists). */
const ITEMS: [string, string?][] = [
  ['Parent item'],
  ['Child one'],
  ['Child two'],
  ['Second parent'],
  ['First number', '1'],
  ['Sub a', 'a'],
  ['Sub b', 'b'],
  ['Second number', '2'],
  ['Task parent'],
  ['Task child'],
  ['Task two'],
]

async function nestedPage(page: Page, title: string): Promise<{ id: string; ed: Locator }> {
  await openApp(page)
  const id = await createPage(page, { title, content: NESTED })
  await gotoPage(page, id)
  const ed = editorOf(page, id)
  await expect(ed.locator('p', { hasText: 'Closing paragraph.' })).toBeVisible()
  return { id, ed }
}

const line = (ed: Locator, text: string) => ed.locator('p').filter({ hasText: new RegExp(`^${text}$`) })

/**
 * The marker in front of the item whose first line is `text`: the bullet square, the checkbox, or —
 * `::marker` has no box — the counter text ("b. ") measured in the marker's font, ending at the item.
 */
function markerOf(ed: Locator, text: string, counter?: string): Promise<Box> {
  return ed.evaluate(
    (root, [text, counter]) => {
      const p = [...root.querySelectorAll('p')].find((e) => e.textContent === text)!
      const li = p.closest('li')!
      const box = (r: DOMRect) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })
      const input = li.querySelector(':scope > label input')
      if (input) return box(input.getBoundingClientRect())
      const t = p.getBoundingClientRect()
      if (counter) {
        const m = getComputedStyle(li, '::marker')
        const ctx = document.createElement('canvas').getContext('2d')!
        ctx.font = `${m.fontStyle} ${m.fontWeight} ${m.fontSize} ${m.fontFamily}`
        return { left: t.left - ctx.measureText(`${counter}. `).width, right: t.left, top: t.top, bottom: t.bottom }
      }
      const b = getComputedStyle(li, '::before')
      const left = li.getBoundingClientRect().left + parseFloat(b.left)
      const top = li.getBoundingClientRect().top + parseFloat(b.top)
      return { left, right: left + parseFloat(b.width), top, bottom: top + parseFloat(b.height) }
    },
    [text, counter ?? ''] as const,
  )
}

/** Grips on screen: the hover handle's and the pinned one of a selection. */
const visibleGrips = (page: Page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll('.block-handle-wrap .block-handle__grip, .sel-grip .sel-grip__grip')].filter((e) => {
        const r = e.getBoundingClientRect()
        return r.width > 0 && getComputedStyle(e).visibility !== 'hidden'
      }).length,
  )
const hoverWrap = (page: Page) => page.locator('.block-handle-wrap')
const pinned = (page: Page) => page.getByTestId('selection-grip')
const menu = (page: Page) => page.locator('[data-popover][role="menu"]').first()

/** Top of the row the hover handle stands at (its inner box), or null while it is hidden. */
const handleTop = (page: Page) =>
  page.evaluate(() => {
    const w = document.querySelector('.block-handle-wrap')
    const h = w?.querySelector('.block-handle')
    return w && h && getComputedStyle(w).visibility !== 'hidden' ? h.getBoundingClientRect().top : null
  })

/** The hover handle stands at the row of `text` (its first line). */
async function expectHandleAt(page: Page, ed: Locator, text: string) {
  const row = (await line(ed, text).boundingBox())!
  await expect.poll(async () => {
    const top = await handleTop(page)
    return top !== null && Math.abs(top - row.y) < 10
  }, { message: `hover handle at "${text}"` }).toBe(true)
}

/** Point the mouse somewhere else first, so the next position is resolved afresh. */
async function moveAway(page: Page, ed: Locator) {
  const b = (await line(ed, 'Intro paragraph.').boundingBox())!
  await page.mouse.move(b.x + 60, b.y + b.height / 2)
  await expectHandleAt(page, ed, 'Intro paragraph.')
}

/** Right edge of the hover handle while it stands at `text` (the gutter column there). */
async function handleRightAt(page: Page, ed: Locator, text: string): Promise<number> {
  const row = (await line(ed, text).boundingBox())!
  await page.mouse.move(row.x + 30, row.y + Math.min(12, row.height / 2))
  await expectHandleAt(page, ed, text)
  await page.waitForTimeout(80)
  const w = (await hoverWrap(page).boundingBox())!
  return w.x + w.width
}

const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
const boxOf = (r: { x: number; y: number; width: number; height: number }): Box => ({ left: r.x, right: r.x + r.width, top: r.y, bottom: r.y + r.height })

test.describe('the gutter column', () => {
  test('every item of nested bullets, numbers and to-dos gets its handle in the same column as a paragraph — never on a marker or text; the checkbox stays clickable', async ({ page }) => {
    const { id, ed } = await nestedPage(page, 'Marker grips')
    const column = await handleRightAt(page, ed, 'Intro paragraph.')
    // a paragraph's handle ends at the page content (the text's left edge)
    expect(Math.abs(column - (await line(ed, 'Intro paragraph.').boundingBox())!.x)).toBeLessThan(1.5)
    for (const [text, counter] of ITEMS) {
      const right = await handleRightAt(page, ed, text)
      expect(await visibleGrips(page), `one grip at "${text}"`).toBe(1)
      expect(Math.abs(right - column), `the handle of "${text}" in the paragraphs' column`).toBeLessThan(0.75)
      const wrap = boxOf((await hoverWrap(page).boundingBox())!)
      const marker = await markerOf(ed, text, counter)
      const textBox = boxOf((await line(ed, text).boundingBox())!)
      expect(overlaps(wrap, marker), `handle clear of the marker of "${text}"`).toBe(false)
      expect(overlaps(wrap, textBox), `handle clear of the text of "${text}"`).toBe(false)
      expect(wrap.right).toBeLessThanOrEqual(marker.left + 0.5)
    }

    // the checkbox of a hovered nested to-do is not covered: a click toggles it
    const child = (await line(ed, 'Task child').boundingBox())!
    await page.mouse.move(child.x + 30, child.y + child.height / 2)
    await expectHandleAt(page, ed, 'Task child')
    const box = await markerOf(ed, 'Task child')
    const cx = (box.left + box.right) / 2
    const cy = (box.top + box.bottom) / 2
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [cx, cy] as const)).toBe('INPUT')
    await page.mouse.click(cx, cy)
    await expect
      .poll(() => wsEval(page, (s, id) => JSON.stringify(s.pages[id].content).includes('"checked":true'), id))
      .toBe(true)
  })

  test('on a nested item\'s row its marker, the indent left of it and the gutter target that item, not its parent', async ({ page }) => {
    const { ed } = await nestedPage(page, 'Nested targets')
    const column = await handleRightAt(page, ed, 'Intro paragraph.')
    const content = (await line(ed, 'Intro paragraph.').boundingBox())!.x
    for (const [text, counter] of [['Child two'], ['Sub b', 'b'], ['Task child']] as [string, string?][]) {
      const marker = await markerOf(ed, text, counter)
      const y = (marker.top + marker.bottom) / 2
      // the marker, just left of it, the parent's indent, the content's edge, the gutter (left of the handle's place too)
      for (const x of [(marker.left + marker.right) / 2, marker.left - 4, marker.left - 14, content + 2, column - 3, column - 30, column - 56]) {
        await moveAway(page, ed)
        await page.mouse.move(x, y)
        await expectHandleAt(page, ed, text)
      }
      // and its first line's start, where the drag-handle library used to hand over to the parent
      const row = (await line(ed, text).boundingBox())!
      await moveAway(page, ed)
      await page.mouse.move(row.x + 3, row.y + 4)
      await expectHandleAt(page, ed, text)
    }
  })

  test('down the gutter the handle follows the pointer row by row — each row\'s own (deepest) item; beyond the gutter it goes', async ({ page }) => {
    const { ed } = await nestedPage(page, 'Gutter walk')
    const column = await handleRightAt(page, ed, 'Intro paragraph.')
    const rows = ['Intro paragraph.', 'Parent item', 'Child one', 'Child two', 'Second parent', 'First number', 'Sub a', 'Sub b', 'Second number', 'Task parent', 'Task child', 'Task two', 'Closing paragraph.']
    let y = (await line(ed, rows[0]).boundingBox())!.y
    for (const text of rows) {
      const row = (await line(ed, text).boundingBox())!
      const to = row.y + row.height / 2
      await page.mouse.move(column - 58, y)
      await page.mouse.move(column - 58, to, { steps: 4 })
      y = to
      await expectHandleAt(page, ed, text)
      expect(await visibleGrips(page)).toBe(1)
    }
    // further left than the gutter: the handle goes
    await page.mouse.move(column - 140, y, { steps: 4 })
    await expect(hoverWrap(page)).toBeHidden()
  })

  test('containers: a callout\'s, a quote\'s and a column\'s blocks have their grips at the container\'s edge (the gutter there is the container\'s); a toggle\'s content uses the page column', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, {
      title: 'Containers',
      content: doc(
        para('Before the boxes.'),
        { type: 'callout', attrs: { icon: '💡', color: 'gray' }, content: [para('Inside the callout.')] },
        { type: 'blockquote', content: [para('A quoted line.')] },
        { type: 'details', attrs: { open: true }, content: [{ type: 'detailsSummary', content: [{ type: 'text', text: 'Toggle title' }] }, { type: 'detailsContent', content: [para('Toggle body.')] }] },
        { type: 'columns', content: [{ type: 'column', content: [para('Left column.')] }, { type: 'column', content: [para('Right column.')] }] },
        para('After the boxes.'),
      ),
    })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await expect(ed.locator('p', { hasText: 'After the boxes.' })).toBeVisible()
    const kind = () => page.locator('.block-handle-wrap .block-handle').getAttribute('data-kind')
    const column = await handleRightAt(page, ed, 'Before the boxes.')
    for (const text of ['Inside the callout.', 'A quoted line.', 'Right column.']) {
      const right = await handleRightAt(page, ed, text)
      expect(Math.abs(right - (await line(ed, text).boundingBox())!.x), `the handle of "${text}" at its container's edge`).toBeLessThan(1.5)
      expect(await kind()).toBe('paragraph')
    }
    // the page gutter on the callout's line: the callout itself
    const callout = (await line(ed, 'Inside the callout.').boundingBox())!
    await page.mouse.move(column - 30, callout.y + callout.height / 2)
    await expect.poll(kind).toBe('callout')
    const wrap = (await hoverWrap(page).boundingBox())!
    expect(Math.abs(wrap.x + wrap.width - column)).toBeLessThan(0.75)
    // a toggle's content: the page column
    const body = await handleRightAt(page, ed, 'Toggle body.')
    expect(Math.abs(body - column)).toBeLessThan(0.75)
    expect(await kind()).toBe('paragraph')
  })
})

test.describe('one grip at a time', () => {
  test('a selected nested item: its pinned grip in the gutter column is the only grip; other blocks show none (Shift shows one to extend); a click into the text brings hover back', async ({ page }) => {
    const { ed } = await nestedPage(page, 'One grip')
    await line(ed, 'Child one').click()
    await page.keyboard.press('Escape')
    await expect(ed.locator('.is-block-selected')).toHaveText(['Child one'])
    await expect(pinned(page)).toBeVisible()
    // the pinned grip stands in the gutter column — where a paragraph's handle is — on the item's line
    const intro = (await line(ed, 'Intro paragraph.').boundingBox())!
    const sel = (await pinned(page).boundingBox())!
    expect(Math.abs(sel.x + sel.width - intro.x)).toBeLessThan(0.75)
    expect(Math.abs(sel.y - (await line(ed, 'Child one').boundingBox())!.y)).toBeLessThan(10)
    const bullet = await markerOf(ed, 'Child one')
    expect(overlaps(boxOf(sel), bullet)).toBe(false)
    // the gutter rule runs between the grip and the content
    const rule = (await page.locator('.sel-rule').boundingBox())!
    expect(rule.x + rule.width).toBeLessThanOrEqual(intro.x)

    // hovering another block, the selected one, a nested sibling: still just the pinned grip
    for (const text of ['Intro paragraph.', 'Child one', 'Child two', 'Second parent', 'Task child']) {
      const row = (await line(ed, text).boundingBox())!
      await page.mouse.move(row.x + 30, row.y + row.height / 2)
      await page.waitForTimeout(120)
      await expect(hoverWrap(page)).toBeHidden()
      expect(await visibleGrips(page), `one grip while hovering "${text}"`).toBe(1)
    }

    // Shift held: an unselected block shows its grip (Shift+click extends), not the selected one
    const second = (await line(ed, 'Second parent').boundingBox())!
    await page.keyboard.down('Shift')
    await page.mouse.move(second.x + 30, second.y + second.height / 2 + 1)
    await expectHandleAt(page, ed, 'Second parent')
    const one = (await line(ed, 'Child one').boundingBox())!
    await page.mouse.move(one.x + 30, one.y + one.height / 2)
    await expect(hoverWrap(page)).toBeHidden()
    await page.keyboard.up('Shift')

    // a click into the text ends the selection: the hover handle is back
    const closing = line(ed, 'Closing paragraph.')
    await closing.click()
    await expect(pinned(page)).toHaveCount(0)
    await expectHandleAt(page, ed, 'Closing paragraph.')
    const child = (await line(ed, 'Child two').boundingBox())!
    await page.mouse.move(child.x + 30, child.y + child.height / 2)
    await expectHandleAt(page, ed, 'Child two')
    expect(await visibleGrips(page)).toBe(1)
  })

  test('selected numbered and to-do items: the pinned grip sits in the gutter column, clear of the number / checkbox; Esc leaves, hover works again', async ({ page }) => {
    const { id, ed } = await nestedPage(page, 'Pinned markers')
    const column = (await line(ed, 'Intro paragraph.').boundingBox())!.x
    for (const [text, counter] of [['Sub a', 'a'], ['Second number', '2'], ['Task child'], ['Task parent']] as [string, string?][]) {
      await line(ed, text).click()
      await page.keyboard.press('Escape')
      await expect(ed.locator('.is-block-selected').first()).toContainText(text)
      await page.mouse.move(5, 450)
      const marker = await markerOf(ed, text, counter)
      const grip = (await pinned(page).boundingBox())!
      expect(Math.abs(grip.x + grip.width - column), `pinned grip of "${text}" in the gutter column`).toBeLessThan(0.75)
      expect(grip.x + grip.width).toBeLessThanOrEqual(marker.left + 0.5)
      expect(Math.abs(grip.y - (await line(ed, text).boundingBox())!.y)).toBeLessThan(10)
      await page.keyboard.press('Escape')
      await expect(pinned(page)).toHaveCount(0)
    }
    // the checkbox of a selected to-do still toggles
    await line(ed, 'Task child').click()
    await page.keyboard.press('Escape')
    const box = await markerOf(ed, 'Task child')
    await page.mouse.click((box.left + box.right) / 2, (box.top + box.bottom) / 2)
    await expect
      .poll(() => wsEval(page, (s, id) => JSON.stringify(s.pages[id].content).includes('"checked":true'), id))
      .toBe(true)
  })

  test('the hover grip\'s own menu leaves a soft selection: no pinned grip, the next block\'s grip opens its menu; Shift+click on a hidden-by-default grip still extends', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Soft menu', content: doc(para('Alpha block'), para('Beta block'), para('Gamma block'), para('Delta block')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    const texts = () => wsEval(page, (s, id) => (s.pages[id].content.content as AnyState[]).map((n) => n.content?.[0]?.text ?? '').filter(Boolean), id)

    // the menu of Beta's grip, closed with Esc: Beta stays selected (washed) but gets no pinned grip —
    // the hover handle stays the handle
    await ed.locator('p', { hasText: 'Beta block' }).hover()
    await page.locator('.block-handle-wrap .block-handle__grip').click()
    await expect(menu(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu(page)).toHaveCount(0)
    await expect(ed.locator('.is-block-selected')).toHaveText(['Beta block'])
    await expect(pinned(page)).toHaveCount(0)
    await ed.locator('p', { hasText: 'Gamma block' }).hover()
    await expectHandleAt(page, ed, 'Gamma block')
    expect(await visibleGrips(page)).toBe(1)
    await page.locator('.block-handle-wrap .block-handle__grip').click()
    await menu(page).getByRole('menuitem', { name: /^Delete/ }).click()
    await expect.poll(texts).toEqual(['Alpha block', 'Beta block', 'Delta block'])

    // a deliberate selection (Esc) is hard: the pinned grip, no hover handle elsewhere …
    await ed.locator('p', { hasText: 'Alpha block' }).click()
    await page.keyboard.press('Escape')
    await expect(pinned(page)).toBeVisible()
    const delta = (await ed.locator('p', { hasText: 'Delta block' }).boundingBox())!
    await page.mouse.move(delta.x + 30, delta.y + delta.height / 2)
    await page.waitForTimeout(120)
    await expect(hoverWrap(page)).toBeHidden()
    // … until Shift is held: Shift+click on that grip grows the selection to it
    await page.keyboard.down('Shift')
    await page.mouse.move(delta.x + 31, delta.y + delta.height / 2)
    await expectHandleAt(page, ed, 'Delta block')
    const g = (await page.locator('.block-handle-wrap .block-handle__grip').boundingBox())!
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2, { steps: 3 })
    await page.mouse.down()
    await page.mouse.up()
    await page.keyboard.up('Shift')
    await expect(ed.locator('.is-block-selected')).toHaveCount(3)
    await expect(page.getByTestId('selection-count')).toHaveText('3 blocks · Esc')
    await expect(menu(page)).toHaveCount(0)
  })

  test('drag a nested item by its hover grip: it moves; the hover handle keeps working afterwards', async ({ page }) => {
    const { id, ed } = await nestedPage(page, 'Nested drag')
    const row = (await line(ed, 'Child two').boundingBox())!
    await page.mouse.move(row.x + 30, row.y + row.height / 2)
    await expectHandleAt(page, ed, 'Child two')
    const g = (await page.locator('.block-handle-wrap .block-handle__grip').boundingBox())!
    const target = (await line(ed, 'Child one').boundingBox())!
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
    await page.mouse.down()
    await page.mouse.move(g.x + g.width / 2, g.y - 6, { steps: 4 })
    await page.mouse.move(target.x + 30, target.y + 2, { steps: 12 })
    await page.mouse.up()
    const children = () =>
      wsEval(page, (s, id) => {
        const t = (n: AnyState): string => (n.text ?? '') + (n.content ?? []).map(t).join('')
        const parent = (s.pages[id].content.content as AnyState[])[1].content[0]
        return (parent.content[1].content as AnyState[]).map(t)
      }, id)
    await expect.poll(children).toEqual(['Child two', 'Child one'])
    await expect(pinned(page)).toHaveCount(0)
    const intro = (await line(ed, 'Intro paragraph.').boundingBox())!
    await page.mouse.move(intro.x + 40, intro.y + intro.height / 2)
    await expectHandleAt(page, ed, 'Intro paragraph.')
    expect(await visibleGrips(page)).toBe(1)
  })
})

/* ------------------------------------------------------------------ */
/* Reported: nested bullets under "12." could not be grabbed / selected */
/* ------------------------------------------------------------------ */

const PROTOCOL = doc(
  para('Protokoll'),
  {
    type: 'orderedList',
    attrs: { start: 11 },
    content: [
      item('Platten vorbereiten.'),
      item(
        'Loop über die DWP 1–4, je Platte 7 Blöcke:',
        list(
          'bulletList',
          item('750 µl aspirieren reverse.'),
          item('Multi-Dispense 3 × 250 µl, Spitze bleibt im Kanal.', list('bulletList', item('Spitzen nach Block 4 wechseln.'))),
          item('Rest mit Blowout verwerfen.'),
        ),
      ),
      item('Abschluss prüfen:', list('taskList', todo('Deckel drauf'), todo('Etikett geschrieben'))),
    ],
  },
  para('Ende.'),
)

/** Two animation frames: the drag-handle plugin resolves the pointer on the next one. */
const frames = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))

/**
 * Move from the item's text straight left (4px steps) at `dy` into its first line until the pointer is
 * on the hover handle: on every step the handle stays at this item's row — never its parent's.
 */
async function sweepToGrip(page: Page, ed: Locator, text: string, dy: number) {
  const row = (await line(ed, text).boundingBox())!
  const y = row.y + dy
  await page.mouse.move(row.x + 40, y)
  await expectHandleAt(page, ed, text)
  for (let x = row.x + 40; ; x -= 4) {
    expect(x, `the grip of "${text}" is reachable (dy ${dy})`).toBeGreaterThan(row.x - 120)
    await page.mouse.move(x, y)
    await frames(page)
    const top = await handleTop(page)
    expect(top !== null && Math.abs(top - row.y) < 10, `handle at "${text}" with the pointer at x ${Math.round(x - row.x)} (dy ${dy})`).toBe(true)
    if (await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.block-handle-wrap'), [x, y] as const)) return
  }
}

/** From the handle the pointer is on, onto its grip (same handle, nothing re-targets). */
async function ontoGrip(page: Page) {
  const g = (await page.locator('.block-handle-wrap .block-handle__grip').boundingBox())!
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2, { steps: 3 })
  return g
}

test.describe('nested bullets inside a numbered item', () => {
  async function protocol(page: Page) {
    await openApp(page)
    const id = await createPage(page, { title: 'Pipettierprotokoll', content: PROTOCOL })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await expect(ed.locator('p', { hasText: 'Ende.' })).toBeVisible()
    /** The items of the bullet list under "12." (each with its nested text). */
    const bullets = () =>
      wsEval(page, (s, id) => {
        const t = (n: AnyState): string => (n.text ?? '') + (n.content ?? []).map(t).join('')
        const loop = (s.pages[id].content.content as AnyState[])[1].content[1]
        return (loop.content[1].content as AnyState[]).map(t)
      }, id)
    return { id, ed, bullets }
  }

  test('from the text of a nested bullet (and one level deeper) straight left to its grip in the gutter: the handle never jumps to "12."; its menu acts on that bullet', async ({ page }) => {
    const { ed, bullets } = await protocol(page)
    // the gutter column: where the first paragraph's handle ends, left of the wide "12."
    const column = await handleRightAt(page, ed, 'Protokoll')
    const twelve = await markerOf(ed, 'Loop über die DWP 1–4, je Platte 7 Blöcke:', '12')
    expect(column).toBeLessThanOrEqual(twelve.left + 0.5)
    for (const text of ['Multi-Dispense 3 × 250 µl, Spitze bleibt im Kanal.', 'Spitzen nach Block 4 wechseln.', '750 µl aspirieren reverse.', 'Loop über die DWP 1–4, je Platte 7 Blöcke:']) {
      const h = (await line(ed, text).boundingBox())!.height
      for (const dy of [5, h / 2, h - 3]) await sweepToGrip(page, ed, text, dy)
      // its handle stands in the gutter column, clear of its marker and text
      const counter = text.startsWith('Loop') ? '12' : undefined
      const marker = await markerOf(ed, text, counter)
      const wrap = boxOf((await hoverWrap(page).boundingBox())!)
      expect(Math.abs(wrap.right - column)).toBeLessThan(0.75)
      expect(overlaps(wrap, marker)).toBe(false)
      expect(overlaps(wrap, boxOf((await line(ed, text).boundingBox())!))).toBe(false)
    }
    // the grip reached from the text opens the menu of THAT bullet: Duplicate copies it, not "12."
    await sweepToGrip(page, ed, 'Multi-Dispense 3 × 250 µl, Spitze bleibt im Kanal.', 12)
    await ontoGrip(page)
    await expectHandleAt(page, ed, 'Multi-Dispense 3 × 250 µl, Spitze bleibt im Kanal.')
    await page.mouse.down()
    await page.mouse.up()
    await menu(page).getByRole('menuitem', { name: /^Duplicate/ }).click()
    await expect
      .poll(bullets)
      .toEqual([
        '750 µl aspirieren reverse.',
        'Multi-Dispense 3 × 250 µl, Spitze bleibt im Kanal.Spitzen nach Block 4 wechseln.',
        'Multi-Dispense 3 × 250 µl, Spitze bleibt im Kanal.Spitzen nach Block 4 wechseln.',
        'Rest mit Blowout verwerfen.',
      ])
  })

  test('Esc in a nested bullet selects that bullet (not "12."), the pinned grip stands in the gutter column, Shift+click extends among its siblings', async ({ page }) => {
    const { ed } = await protocol(page)
    const column = await handleRightAt(page, ed, 'Protokoll')
    await line(ed, 'Multi-Dispense 3 × 250 µl, Spitze bleibt im Kanal.').click()
    await page.keyboard.press('Escape')
    const selected = ed.locator('.is-block-selected')
    await expect(selected).toHaveCount(1)
    await expect(selected).toHaveText(/^Multi-Dispense/)
    await expect(pinned(page)).toBeVisible()
    const grip = (await pinned(page).boundingBox())!
    expect(Math.abs(grip.x + grip.width - column)).toBeLessThan(0.75)
    expect(Math.abs(grip.y - (await line(ed, 'Multi-Dispense 3 × 250 µl, Spitze bleibt im Kanal.').boundingBox())!.y)).toBeLessThan(10)
    expect(await visibleGrips(page)).toBe(1)

    await line(ed, 'Rest mit Blowout verwerfen.').click({ modifiers: ['Shift'] })
    await expect(selected).toHaveCount(2)
    await expect(selected.nth(0)).toHaveText(/^Multi-Dispense/)
    await expect(selected.nth(1)).toHaveText('Rest mit Blowout verwerfen.')
    await expect(page.getByTestId('selection-count')).toHaveText('2 blocks · Esc')
    // the pinned grip stays at the first, in the column
    const again = (await pinned(page).boundingBox())!
    expect(Math.abs(again.x + again.width - column)).toBeLessThan(0.75)
    expect(Math.abs(again.y - grip.y)).toBeLessThan(1)

    // one level deeper: Esc there selects the deeper bullet only
    await page.keyboard.press('Escape')
    await line(ed, 'Spitzen nach Block 4 wechseln.').click()
    await page.keyboard.press('Escape')
    await expect(selected).toHaveText(['Spitzen nach Block 4 wechseln.'])
    const deep = (await pinned(page).boundingBox())!
    expect(Math.abs(deep.x + deep.width - column)).toBeLessThan(0.75)
    expect(Math.abs(deep.y - (await line(ed, 'Spitzen nach Block 4 wechseln.').boundingBox())!.y)).toBeLessThan(10)
  })

  test('drag a nested bullet by its grip within the list under "12."', async ({ page }) => {
    const { ed, bullets } = await protocol(page)
    await sweepToGrip(page, ed, 'Rest mit Blowout verwerfen.', 12)
    const g = await ontoGrip(page)
    await expectHandleAt(page, ed, 'Rest mit Blowout verwerfen.')
    const target = (await line(ed, '750 µl aspirieren reverse.').boundingBox())!
    await page.mouse.down()
    await page.mouse.move(g.x + g.width / 2, g.y - 6, { steps: 4 })
    await page.mouse.move(target.x + 30, target.y + 2, { steps: 12 })
    await page.mouse.up()
    await expect
      .poll(bullets)
      .toEqual(['Rest mit Blowout verwerfen.', '750 µl aspirieren reverse.', 'Multi-Dispense 3 × 250 µl, Spitze bleibt im Kanal.Spitzen nach Block 4 wechseln.'])
  })

  test('to-dos inside a numbered item: grip in the gutter column and reachable, Esc selects the to-do, Shift+click extends', async ({ page }) => {
    const { ed } = await protocol(page)
    const column = await handleRightAt(page, ed, 'Protokoll')
    for (const text of ['Deckel drauf', 'Etikett geschrieben']) {
      const h = (await line(ed, text).boundingBox())!.height
      for (const dy of [5, h / 2]) await sweepToGrip(page, ed, text, dy)
      const wrap = boxOf((await hoverWrap(page).boundingBox())!)
      expect(Math.abs(wrap.right - column)).toBeLessThan(0.75)
      expect(overlaps(wrap, await markerOf(ed, text))).toBe(false)
    }
    await line(ed, 'Deckel drauf').click()
    await page.keyboard.press('Escape')
    // (a to-do's text carries its checkbox label: "To-do: …")
    const selected = ed.locator('.is-block-selected')
    await expect(selected).toHaveText([/Deckel drauf$/])
    const grip = (await pinned(page).boundingBox())!
    expect(Math.abs(grip.x + grip.width - column)).toBeLessThan(0.75)
    await line(ed, 'Etikett geschrieben').click({ modifiers: ['Shift'] })
    await expect(selected).toHaveText([/Deckel drauf$/, /Etikett geschrieben$/])
    await expect(page.getByTestId('selection-count')).toHaveText('2 blocks · Esc')
  })
})

test.describe('the gutter column on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('long-press selects a nested item: the pinned grip stands in the phone\'s left padding, clear of the bullet, on screen', async ({ page, context }) => {
    const { ed } = await nestedPage(page, 'Phone markers')
    await line(ed, 'Child one').tap()
    const touchGrip = page.locator('.touch-grip')
    await expect(touchGrip).toBeVisible()
    const box = (await touchGrip.boundingBox())!
    const cdp = await context.newCDPSession(page)
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
    await page.waitForTimeout(650)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(ed.locator('.is-block-selected')).toHaveText(['Child one'])
    await expect(touchGrip).toBeHidden()
    const grip = (await pinned(page).boundingBox())!
    const bullet = await markerOf(ed, 'Child one')
    expect(grip.x).toBeGreaterThanOrEqual(0)
    expect(overlaps(boxOf(grip), bullet)).toBe(false)
    expect(grip.x + grip.width).toBeLessThanOrEqual((await line(ed, 'Intro paragraph.').boundingBox())!.x + 0.5)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  })
})
