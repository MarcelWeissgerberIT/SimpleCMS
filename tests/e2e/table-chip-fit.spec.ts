/**
 * Chips in a table cell are never cut by the cell (database/cells/chipFit.ts + database.css `.db-chips`):
 * a lone chip wider than the cell shrinks — its name ends in "…" inside its own closed border and tells the
 * whole name on hover; chips that do not fit wait whole behind a "+n" count that names them; with "Wrap cells"
 * the name wraps and the chip grows. The same rows in the list view, and a relation chip there still opens the peek.
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect, openApp, gotoPage, wsEval, flush } from './fixtures'

const LONG = 'Nordlicht Development Hub Karlsruhe · Launch plan 2026'

const db = (page: Page) => page.locator('#main section.db').first()
const row = (page: Page, title: string): Locator =>
  db(page).locator('.dbt-body .dbt-row[role="row"]', { has: page.locator('.dbt-cell--title', { hasText: new RegExp(`^${title}`) }) })
const cell = (page: Page, title: string, type: string) => row(page, title).locator(`[role="gridcell"][data-type="${type}"]`)

interface Seed {
  dbId: string
  viewId: string
}

async function seed(page: Page): Promise<Seed> {
  const ids = await wsEval(page, (s, long) => {
    const mara = s.addPerson('Mara Lind')
    const tessa = s.addPerson('Tessa Nordlicht')
    const target = s.createDatabase({ title: 'Projekte', properties: [{ id: 'tName', name: 'Name', type: 'title' }] })
    const hub = s.createRow(target, { title: long })
    const tessera = s.createRow(target, { title: 'Tessera' })
    const plan = s.createRow(target, { title: 'Launch plan' })
    const dbId = s.createDatabase({
      title: 'Launch plan',
      properties: [
        { id: 'pName', name: 'Name', type: 'title' },
        { id: 'pPerson', name: 'Person', type: 'person' },
        { id: 'pRel', name: 'Relation', type: 'relation', relationDatabaseId: target },
      ],
    })
    s.createRow(dbId, { title: 'Kickoff', properties: { pPerson: [mara, tessa], pRel: [hub] } })
    s.createRow(dbId, { title: 'Review', properties: { pPerson: [tessa], pRel: [hub, tessera, plan] } })
    return dbId as string
  }, LONG)
  const viewId = await wsEval(page, (s, id) => {
    const viewId = s.databases[id].views[0].id as string
    s.updateView(id, viewId, { propertyWidths: { pName: 160, pPerson: 130, pRel: 150 } })
    return viewId
  }, ids)
  await flush(page)
  return { dbId: ids, viewId }
}

type Box = { left: number; right: number; top: number; bottom: number }
const box = (l: Locator): Promise<Box> => l.evaluate((el) => {
  const r = el.getBoundingClientRect()
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
})

/** Every chip of a cell lies wholly inside the cell's chip row or wholly below its clip — never cut. Returns the hidden ones' count. */
async function chipsWhole(c: Locator): Promise<{ shown: number; hidden: number }> {
  return c.evaluate((cellEl) => {
    const list = cellEl.querySelector('.db-chips')!
    const L = list.getBoundingClientRect()
    const C = cellEl.getBoundingClientRect()
    let shown = 0
    let hidden = 0
    for (const chip of list.children) {
      if (chip.classList.contains('db-more')) continue
      const r = chip.getBoundingClientRect()
      const inside = r.left >= L.left - 0.5 && r.right <= L.right + 0.5 && r.top >= L.top - 0.5 && r.bottom <= L.bottom + 0.5 && r.right <= C.right + 0.5
      const below = r.top >= L.bottom - 0.5
      if (inside) shown++
      else if (below) hidden++
      else throw new Error(`chip cut by the edge: ${chip.textContent} ${JSON.stringify(r)} in ${JSON.stringify(L)}`)
    }
    return { shown, hidden }
  })
}

const countOf = (c: Locator) => c.locator('.db-more')

test.describe('chips in table cells', () => {
  test('a long relation shrinks inside its border, persons that do not fit wait behind +n, wrap shows every name whole', async ({ page }) => {
    await openApp(page)
    const { dbId, viewId } = await seed(page)
    await gotoPage(page, dbId)

    // ---- one long relation in a narrow column: the chip ends inside the cell, its name in "…", the whole name on hover
    const rel = cell(page, 'Kickoff', 'relation')
    const chip = rel.locator('.db-rel')
    await expect(chip).toHaveCount(1)
    const cb = await box(rel)
    const kb = await box(chip)
    expect(kb.left).toBeGreaterThanOrEqual(cb.left)
    expect(kb.right, 'the chip (its right border) lies inside the cell').toBeLessThanOrEqual(cb.right - 1)
    const name = chip.locator('.db-rel__name')
    const nm = await name.evaluate((el) => ({ overflow: getComputedStyle(el).textOverflow, cut: el.scrollWidth > el.clientWidth, text: el.textContent }))
    expect(nm).toEqual({ overflow: 'ellipsis', cut: true, text: LONG })
    // the icon stays whole (the page glyph: 14 px × 0.85)
    const icon = await box(chip.locator('.db-rel__icon'))
    const glyph = await box(chip.locator('.db-rel__icon svg'))
    expect(icon.right - icon.left).toBeGreaterThan(11)
    expect(icon.right - icon.left).toBeCloseTo(glyph.right - glyph.left, 1)
    expect(icon.left).toBeGreaterThanOrEqual(kb.left)
    await chip.hover()
    await expect(chip).toHaveAttribute('title', LONG)
    // one chip: nothing to count
    await expect(countOf(rel)).toHaveCount(0)

    // ---- two people, room for one: Tessa waits whole behind "+1", which names her
    const per = cell(page, 'Kickoff', 'person')
    await expect(per.locator('.db-person')).toHaveCount(2)
    expect(await chipsWhole(per)).toEqual({ shown: 1, hidden: 1 })
    const more = countOf(per)
    await expect(more).toBeVisible()
    await expect(more).toHaveAttribute('data-count', '+1')
    await expect(more).toHaveAttribute('title', '1 more: Tessa Nordlicht')
    expect(await more.evaluate((el) => getComputedStyle(el, '::before').content)).toBe('"+1"')
    const mb = await box(more)
    expect(mb.right, 'the count lies inside the cell').toBeLessThanOrEqual((await box(per)).right - 1)
    // the hidden name is still there for screen readers and copy (the count itself is aria-hidden)
    await expect(per.locator('.db-person__name')).toHaveText(['Mara Lind', 'Tessa Nordlicht'])
    await expect(more).toHaveAttribute('aria-hidden', 'true')

    // ---- three relations, the first one long: it shrinks beside the count, the other two wait behind "+2"
    const rel2 = cell(page, 'Review', 'relation')
    expect(await chipsWhole(rel2)).toEqual({ shown: 1, hidden: 2 })
    await expect(countOf(rel2)).toHaveAttribute('data-count', '+2')
    await expect(countOf(rel2)).toHaveAttribute('title', '2 more: Tessera, Launch plan')
    const r2 = await box(rel2)
    expect((await box(countOf(rel2))).right).toBeLessThanOrEqual(r2.right - 1)
    expect((await box(rel2.locator('.db-rel').first())).right).toBeLessThanOrEqual(r2.right - 1)

    // ---- German: the count's title in the UI's language
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await expect(countOf(per)).toHaveAttribute('title', '1 weitere: Tessa Nordlicht')
    await wsEval(page, (s) => s.updateSettings({ language: 'en' }))
    await expect(countOf(per)).toHaveAttribute('title', '1 more: Tessa Nordlicht')

    // ---- a wider column: the count follows the size (both people fit, no count), the whole title shows
    await wsEval(page, (s, a) => s.updateView(a.dbId, a.viewId, { propertyWidths: { pName: 160, pPerson: 280, pRel: 520 } }), { dbId, viewId })
    await expect(countOf(per)).toBeHidden()
    await expect.poll(() => chipsWhole(per)).toEqual({ shown: 2, hidden: 0 })
    await expect.poll(() => name.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect(await chipsWhole(rel2)).toEqual({ shown: 2, hidden: 1 })
    await expect(countOf(rel2)).toHaveAttribute('data-count', '+1')

    // ---- back to narrow, then "Wrap cells": every chip shows, the long title wraps, the chip grows, its border closed
    await wsEval(page, (s, a) => s.updateView(a.dbId, a.viewId, { propertyWidths: { pName: 160, pPerson: 130, pRel: 150 }, wrapCells: true }), { dbId, viewId })
    await expect(db(page).locator('.dbt')).toHaveAttribute('data-wrap', 'true')
    await expect(countOf(per)).toBeHidden()
    await expect(countOf(rel2)).toBeHidden()
    await expect.poll(() => chipsWhole(per)).toEqual({ shown: 2, hidden: 0 })
    await expect.poll(() => chipsWhole(rel2)).toEqual({ shown: 3, hidden: 0 })
    const wrapped = await name.evaluate((el) => ({ fits: el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight + 1, text: (el as HTMLElement).innerText.replace(/\s+/g, ' ') }))
    expect(wrapped).toEqual({ fits: true, text: LONG })
    const tall = await box(chip)
    expect(tall.bottom - tall.top, 'the chip grows over several lines').toBeGreaterThan(30)
    const cw = await box(rel)
    expect(tall.right).toBeLessThanOrEqual(cw.right - 1)
    expect(tall.bottom).toBeLessThanOrEqual(cw.bottom)
    // the icon stays on the first line
    const ic = await box(chip.locator('.db-rel__icon'))
    expect(ic.top - tall.top).toBeLessThan(8)

    // ---- and off again: the count comes back
    await wsEval(page, (s, a) => s.updateView(a.dbId, a.viewId, { wrapCells: false }), { dbId, viewId })
    await expect(countOf(per)).toHaveAttribute('data-count', '+1')
    await expect(countOf(per)).toBeVisible()
    expect(await chipsWhole(per)).toEqual({ shown: 1, hidden: 1 })
  })

  test('clicking a chip keeps its meaning: the table cell opens its editor under the ring, the list row opens the peek', async ({ page }) => {
    await openApp(page)
    const { dbId } = await seed(page)
    await gotoPage(page, dbId)

    // table: a click on the relation chip is a click on the cell — active ring, the relation editor opens
    const rel = cell(page, 'Kickoff', 'relation')
    await rel.locator('.db-rel').click()
    await expect(rel).toHaveAttribute('data-active', 'true')
    await expect(page.locator('.db-pop')).toBeVisible()
    // the ring is drawn over the chips (the chip row makes no stacking layer above it)
    const layers = await rel.evaluate((el) => ({ ring: getComputedStyle(el, '::after').zIndex, list: getComputedStyle(el.querySelector('.db-chips')!).zIndex }))
    expect(layers).toEqual({ ring: '1', list: 'auto' })
    await page.keyboard.press('Escape')
    await expect(page.locator('.db-pop')).toHaveCount(0)

    // the person cell: a click on the count opens the person editor too
    const per = cell(page, 'Kickoff', 'person')
    await countOf(per).click()
    await expect(per).toHaveAttribute('data-active', 'true')
    await expect(page.locator('.db-pop')).toBeVisible()
    await page.keyboard.press('Escape')

    // list view: the same rows on one line with the count; a relation chip opens the peek
    const listId = await wsEval(page, (s, id) => s.addView(id, { type: 'list', name: 'List' }), dbId)
    await page.locator('#main [role="tab"]', { hasText: 'List' }).click()
    const line = db(page).locator('.dbl-row', { hasText: 'Review' })
    await expect(line).toBeVisible()
    const rels = line.locator('.dbl-row__prop[data-type="relation"]')
    const listChips = await rels.evaluate((propEl) => {
      const list = propEl.querySelector('.db-chips')!
      const L = list.getBoundingClientRect()
      return [...list.children].filter((c) => !c.classList.contains('db-more')).map((c) => {
        const r = c.getBoundingClientRect()
        return r.right <= L.right + 0.5 && r.bottom <= L.bottom + 0.5 ? 'shown' : r.top >= L.bottom - 0.5 ? 'hidden' : 'cut'
      })
    })
    expect(listChips).not.toContain('cut')
    expect(listChips.filter((x) => x === 'hidden').length).toBeGreaterThan(0)
    await expect(countOf(rels)).toHaveAttribute('data-count', `+${listChips.filter((x) => x === 'hidden').length}`)
    expect(listId).toBeTruthy()
    // a narrower window: the list rows fit again, no observer loop (the errors fixture would see one)
    await page.setViewportSize({ width: 900, height: 800 })
    await expect.poll(() => rels.evaluate((propEl) => [...propEl.querySelectorAll('.db-chips > :not(.db-more)')].every((c) => {
      const L = propEl.querySelector('.db-chips')!.getBoundingClientRect()
      const r = c.getBoundingClientRect()
      return (r.right <= L.right + 0.5 && r.bottom <= L.bottom + 0.5) || r.top >= L.bottom - 0.5
    }))).toBe(true)
    await page.setViewportSize({ width: 1440, height: 900 })
    await rels.locator('.db-rel').first().click()
    await expect(page.locator('.peek')).toBeVisible()
    await expect(page.locator('.peek .pv-title')).toHaveValue(LONG)
  })

  test('option tags count too, and a rename re-fits the row without a resize', async ({ page }) => {
    await openApp(page)
    const { dbId, viewId } = await seed(page)
    await wsEval(page, (s, a) => {
      s.addProperty(a.dbId, { id: 'pTags', name: 'Tags', type: 'multi_select', options: [
        { id: 'o1', name: 'Kickoff', color: 'orange' }, { id: 'o2', name: 'Review mit Tessera', color: 'blue' }, { id: 'o3', name: 'Intern', color: 'green' },
        { id: 'o4', name: 'Karlsruhe', color: 'red' }, { id: 'o5', name: 'Launch', color: 'purple' },
      ] })
    }, { dbId, viewId })
    await wsEval(page, (s, a) => {
      const id = (Object.values(s.pages) as Array<{ id: string; title: string; databaseId?: string }>).find((p) => p.databaseId === a.dbId && p.title === 'Kickoff')!.id
      s.setRowProperty(id, 'pTags', ['o1', 'o2', 'o3', 'o4', 'o5'])
      s.updateView(a.dbId, a.viewId, { propertyWidths: { pName: 160, pPerson: 130, pRel: 220, pTags: 150 } })
    }, { dbId, viewId })
    await gotoPage(page, dbId)
    const tags = cell(page, 'Kickoff', 'multi_select')
    await expect(tags.locator('.db-tag')).toHaveCount(5)
    const t1 = await chipsWhole(tags)
    expect(t1.shown + t1.hidden).toBe(5)
    expect(t1.hidden).toBeGreaterThan(0)
    await expect(countOf(tags)).toHaveAttribute('data-count', `+${t1.hidden}`)
    await expect(countOf(tags)).toHaveAttribute('title', new RegExp(`^${t1.hidden} more: `))

    // the long related page gets a short name: the row's size stays, the render fits it again — two chips show
    const rel2 = cell(page, 'Review', 'relation')
    expect(await chipsWhole(rel2)).toEqual({ shown: 1, hidden: 2 })
    await expect(rel2.locator('.db-chips')).toHaveAttribute('style', /--more-room/)
    await wsEval(page, (s, long) => {
      const p = (Object.values(s.pages) as Array<{ id: string; title: string }>).find((x) => x.title === long)!
      s.updatePage(p.id, { title: 'Hub' })
    }, LONG)
    await expect.poll(() => chipsWhole(rel2)).toEqual({ shown: 2, hidden: 1 })
    await expect(countOf(rel2)).toHaveAttribute('title', '1 more: Launch plan')
    await expect(rel2.locator('.db-chips')).not.toHaveAttribute('style', /--more-room/)
    expect(await rel2.locator('.db-rel__name').first().evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  })
})
