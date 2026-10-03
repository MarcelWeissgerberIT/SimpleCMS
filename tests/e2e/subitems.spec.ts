/**
 * Sub-items, dependencies (timeline) and conditional colours on the seeded Projects database.
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect, openApp, gotoPage, wsEval, pageIdByTitle, flush } from './fixtures'

const db = (page: Page) => page.locator('#main section.db').first()
const tab = (page: Page, name: string) => db(page).getByRole('tab', { name: new RegExp(name) })
const tableRow = (page: Page, title: string): Locator =>
  db(page).locator('.dbt-body .dbt-row[role="row"]', { has: page.locator('.db-rowtitle__text', { hasText: new RegExp(`^${title}$`) }) })

async function openMore(page: Page, item: RegExp) {
  await db(page).getByRole('toolbar', { name: 'Database toolbar' }).getByRole('button', { name: 'More' }).click()
  await page.getByRole('menuitem', { name: item }).click()
}

/** Config + property ids of a hierarchy feature on the Projects database. */
async function structure(page: Page, dbId: string) {
  return wsEval(
    page,
    (s, dbId) => {
      const d = s.databases[dbId]
      return JSON.parse(JSON.stringify({ sub: d.subItems ?? null, dep: d.dependencies ?? null, props: d.properties.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })) }))
    },
    dbId,
  )
}

const propOf = (page: Page, rowId: string, propId: string) => wsEval(page, (s, a) => JSON.parse(JSON.stringify(s.pages[a.rowId]?.properties[a.propId] ?? null)), { rowId, propId })

async function prop(page: Page, rowTitle: string, propName: string): Promise<Locator> {
  const row = page.locator('.db-props .db-prow', { has: page.locator('.db-prow__name', { hasText: new RegExp(`^${propName}$`) }) })
  await expect(row, `${propName} on ${rowTitle}`).toBeVisible()
  return row.locator('.db-prow__value')
}

test.describe('sub-items', () => {
  test('enable, add a sub-item, nest + collapse, display modes, no loops, board count', async ({ page }) => {
    await openApp(page)
    const dbId = await pageIdByTitle(page, 'Projects')
    // a parent the demo data leaves alone (the seed may nest other rows)
    const webId = await pageIdByTitle(page, 'Brand refresh')
    await gotoPage(page, dbId)
    await tab(page, 'All projects').click()
    await expect(db(page)).toHaveAttribute('data-view', 'table')

    // switch on from the view's "…" menu
    await openMore(page, /^Sub-items/)
    const subSwitch = page.getByRole('switch', { name: 'Rows can have sub-items' })
    if ((await subSwitch.getAttribute('aria-checked')) !== 'true') await subSwitch.click()
    await expect.poll(async () => (await structure(page, dbId)).sub?.enabled).toBe(true)
    const st = await structure(page, dbId)
    const parentProp = st.sub!.parentPropertyId as string
    const childProp = st.sub!.childPropertyId as string
    expect(st.props.map((p: { name: string }) => p.name)).toEqual(expect.arrayContaining(['Parent item', 'Sub-items']))
    await page.keyboard.press('Escape')

    // "+ Add sub-item" on hover of a parent row → new row nested under it, title in edit mode
    const web = tableRow(page, 'Brand refresh')
    await web.hover()
    await web.getByRole('button', { name: 'Add sub-item' }).click()
    await expect(page.locator('.db-textedit__area')).toBeFocused()
    await page.keyboard.type('Wireframes')
    await page.keyboard.press('Enter')
    const sub = tableRow(page, 'Wireframes')
    await expect(sub).toBeVisible()
    await expect(sub).toHaveAttribute('aria-level', '2')
    await expect(web).toHaveAttribute('aria-expanded', 'true')
    const subId = await pageIdByTitle(page, 'Wireframes')
    // both sides of the pair are written
    expect(await propOf(page, subId, parentProp)).toEqual([webId])
    expect(await propOf(page, webId, childProp)).toContain(subId)
    // sub-item sits right under its parent
    const titles = await db(page)
      .locator('.dbt-body .dbt-row[role="row"] .db-rowtitle__text')
      .allTextContents()
    expect(titles[titles.indexOf('Brand refresh') + 1]).toBe('Wireframes')

    // collapse and expand
    await web.getByRole('button', { name: /Hide sub-items of “Brand refresh”/ }).click()
    await expect(sub).toHaveCount(0)
    await expect(web.locator('.db-tree__n')).toHaveText('1')
    await web.getByRole('button', { name: /Show 1 sub-items of “Brand refresh”/ }).click()
    await expect(sub).toBeVisible()

    // display: flat → no nesting; parents only → the sub-item is gone; back to nested
    await openMore(page, /^Sub-items/)
    await page.getByRole('radio', { name: 'Flat' }).click()
    await expect(sub).toBeVisible()
    await expect(sub).not.toHaveAttribute('aria-level', /.*/)
    await expect(db(page).locator('.dbt[role="grid"]')).toBeVisible()
    await page.getByRole('radio', { name: 'Parents only' }).click()
    await expect(sub).toHaveCount(0)
    await expect(web).toBeVisible()
    await page.getByRole('radio', { name: 'Nested' }).click()
    await page.keyboard.press('Escape')
    await expect(sub).toHaveAttribute('aria-level', '2')

    // a loop is refused: the parent can't become a sub-item of its own sub-item
    await gotoPage(page, webId)
    await (await prop(page, 'Brand refresh', 'Parent item')).click()
    const option = page.locator('.db-picker .db-opt', { hasText: 'Wireframes' })
    await expect(option).toHaveAttribute('aria-disabled', 'true')
    // disabled: picking it does nothing (dispatched on the option itself — a forced click at
    // coordinates can land on a neighbour while the popover still settles)
    await option.dispatchEvent('click')
    await page.keyboard.press('Escape')
    expect((await propOf(page, webId, parentProp)) ?? []).toEqual([])
    // … and from the other side too
    await gotoPage(page, subId)
    await (await prop(page, 'Wireframes', 'Sub-items')).click()
    await expect(page.locator('.db-picker .db-opt', { hasText: 'Brand refresh' })).toHaveAttribute('aria-disabled', 'true')
    await page.keyboard.press('Escape')

    // board cards count their sub-items
    await gotoPage(page, dbId)
    await tab(page, 'Board').click()
    await expect(db(page).locator('.dbc', { hasText: 'Brand refresh' }).locator('.dbc-subs')).toHaveText(/1 sub-item$/)

    // nesting survives a reload (expand state per view)
    await flush(page)
    await page.reload()
    await page.waitForFunction(() => !!(window as unknown as { __one?: unknown }).__one)
    await tab(page, 'All projects').click()
    await expect(tableRow(page, 'Wireframes')).toHaveAttribute('aria-level', '2')
  })
})

test.describe('dependencies', () => {
  test('blocked by → arrow; moving the blocker shifts the dependent, or only warns', async ({ page }) => {
    await openApp(page)
    const dbId = await pageIdByTitle(page, 'Projects')
    const blocker = await pageIdByTitle(page, 'n8n lead-routing automation')
    const dependent = await pageIdByTitle(page, 'Pricing page experiment')
    await gotoPage(page, dbId)
    await tab(page, 'Timeline').click()
    await expect(db(page)).toHaveAttribute('data-view', 'timeline')

    await openMore(page, /^Dependencies/)
    const depSwitch = page.getByRole('switch', { name: 'Rows can block other rows' })
    if ((await depSwitch.getAttribute('aria-checked')) !== 'true') await depSwitch.click()
    await expect.poll(async () => (await structure(page, dbId)).dep?.enabled).toBe(true)
    const st = await structure(page, dbId)
    const blockedBy = st.dep!.blockedByPropertyId as string
    const blocking = st.dep!.blockingPropertyId as string
    const dateProp = st.props.find((p: { name: string }) => p.name === 'Timeline')!.id as string
    await page.keyboard.press('Escape')

    // keyboard path: the dependent's "Blocked by" relation editor
    await gotoPage(page, dependent)
    await (await prop(page, 'Pricing page experiment', 'Blocked by')).click()
    await page.keyboard.type('n8n')
    await page.locator('.db-picker .db-opt', { hasText: 'n8n lead-routing automation' }).click()
    await page.keyboard.press('Escape')
    expect(await propOf(page, dependent, blockedBy)).toEqual([blocker])
    expect(await propOf(page, blocker, blocking)).toEqual([dependent])

    // the timeline draws the arrow (no conflict yet: the blocker ends before the dependent starts)
    await gotoPage(page, dbId)
    await tab(page, 'Timeline').click()
    const arrow = db(page).locator(`.dbtl-dep[data-from="${blocker}"][data-to="${dependent}"]`)
    await expect(arrow).toHaveCount(1)
    await expect(arrow).toHaveAttribute('data-violated', 'false')

    const dates = async (id: string) => (await propOf(page, id, dateProp)) as { start: string; end: string }
    const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
    const dragBlocker = async (byDays: number) => {
      const bar = db(page).locator(`.dbtl-row[data-tl-row="${blocker}"] .dbtl-bar`)
      await bar.scrollIntoViewIfNeeded()
      const box = (await bar.boundingBox())!
      const dw = await db(page).locator('.dbtl').evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--dw')))
      const x = box.x + box.width / 2
      const y = box.y + box.height / 2
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x + (byDays * dw) / 2, y, { steps: 5 })
      await page.mouse.move(x + byDays * dw, y, { steps: 5 })
      await page.mouse.up()
    }

    // shift (default): the dependent moves to the day after the blocker's new end, same duration
    const before = await dates(dependent)
    const b0 = await dates(blocker)
    const by = days(b0.end, before.start) + 3 // overlap of 3 days
    await dragBlocker(by)
    await expect.poll(async () => (await dates(blocker)).end).not.toBe(b0.end)
    const b1 = await dates(blocker)
    expect(days(b0.end, b1.end)).toBe(by)
    await expect.poll(async () => days((await dates(blocker)).end, (await dates(dependent)).start)).toBe(1)
    const after = await dates(dependent)
    expect(days(after.start, after.end)).toBe(days(before.start, before.end))
    await expect(page.locator('.toast', { hasText: /1 dependent moved later/ })).toBeVisible()
    await expect(arrow).toHaveAttribute('data-violated', 'false')

    // only warn: dates stay, the arrow turns into a conflict marker
    await openMore(page, /^Dependencies/)
    await page.getByRole('radio', { name: 'Only warn' }).click()
    await expect.poll(async () => (await structure(page, dbId)).dep?.onConflict).toBe('warn')
    await page.keyboard.press('Escape')
    await dragBlocker(4)
    await expect.poll(async () => days(b1.end, (await dates(blocker)).end)).toBe(4)
    expect(await dates(dependent)).toEqual(after)
    await expect(arrow).toHaveAttribute('data-violated', 'true')

    // click the arrow, Delete removes the dependency (both sides)
    // a point on the arrow's first vertical run (clear of the bars and the connector dot)
    const pt = await arrow.locator('.dbtl-dep__hit').evaluate((el) => {
      const path = el as SVGPathElement
      const p = path.getPointAtLength(18)
      const m = path.getScreenCTM()!
      return { x: p.x * m.a + m.e, y: p.y * m.d + m.f }
    })
    await page.mouse.click(pt.x, pt.y)
    await expect(arrow).toHaveAttribute('data-selected', 'true')
    await page.keyboard.press('Delete')
    await expect(arrow).toHaveCount(0)
    expect(await propOf(page, dependent, blockedBy)).toEqual([])
    expect(await propOf(page, blocker, blocking)).toEqual([])
  })
})

test.describe('colour rules', () => {
  test('Status is Done → green rows in the table', async ({ page }) => {
    await openApp(page)
    const dbId = await pageIdByTitle(page, 'Projects')
    await gotoPage(page, dbId)
    await tab(page, 'All projects').click()

    await openMore(page, /^Colour rules/)
    const panel = page.locator('.db-rcpanel')
    await panel.getByRole('button', { name: 'Add colour rule' }).click()
    const rule = panel.locator('.db-rcrule').last()
    await rule.getByRole('button', { name: 'Add condition' }).click()
    await page.getByRole('menuitem', { name: 'Status' }).click()
    await rule.locator('.db-frule__value').click()
    await page.getByRole('menuitem', { name: 'Done' }).click()
    await rule.getByRole('button', { name: 'Colour' }).click()
    await page.getByRole('menuitem', { name: 'Green' }).click()
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()

    const view = await wsEval(page, (s, dbId) => JSON.parse(JSON.stringify(s.databases[dbId].views.find((v: { name: string }) => v.name === 'All projects'))), dbId)
    expect(view.colorRules.at(-1)).toMatchObject({ color: 'green', target: 'background' })

    for (const title of ['Import our Notion workspace', 'Brand refresh']) {
      await expect(tableRow(page, title)).toHaveClass(/\bdb-rc\b/)
      await expect(tableRow(page, title)).toHaveAttribute('data-rc-color', 'green')
    }
    for (const title of ['Website relaunch', 'Pricing page experiment', 'Q4 content calendar']) await expect(tableRow(page, title)).not.toHaveClass(/\bdb-rc\b/)

    // the tint is a real colour change on the row's cells
    const bg = await tableRow(page, 'Brand refresh').locator('.dbt-cell--title').evaluate((el) => getComputedStyle(el).backgroundColor)
    const plain = await tableRow(page, 'Website relaunch').locator('.dbt-cell--title').evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(bg).not.toBe(plain)
  })
})
