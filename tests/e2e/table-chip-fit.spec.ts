/**
 * Chips in a table cell are never cut by the cell (database/cells/chipFit.ts + database.css `.db-chips`):
 * a lone chip wider than the cell shrinks — its name ends in "…" inside its own closed border and tells the
 * whole name on hover; chips that do not fit wait whole behind a "+n" count that names them; with "Wrap cells"
 * the name wraps and the chip grows. The same rows in the list view, and a relation chip there still opens the peek.
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect, openApp, gotoPage, wsEval, uiEval, flush, reloadApp } from './fixtures'

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

interface Audit {
  rows: number
  /** Chips cut by an edge, icons / avatars cut inside a shown chip, counts that do not match what is hidden. */
  problems: string[]
}

/**
 * Every chip row under `root`: each chip is shown whole (its icon / avatar whole inside it) or hidden whole below the
 * clip, and the "+n" key shows exactly the number hidden (none when nothing is). Self-contained (runs in the page).
 */
function audit(root: Element): Audit {
  const within = (a: DOMRect, b: DOMRect) => a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5
  const problems: string[] = []
  const lists = [...root.querySelectorAll('.db-chips')]
  for (const list of lists) {
    const L = list.getBoundingClientRect()
    const C = list.parentElement!.getBoundingClientRect()
    let hidden = 0
    for (const chip of list.children) {
      if (chip.classList.contains('db-more')) continue
      const r = chip.getBoundingClientRect()
      const name = (chip.textContent ?? '').trim()
      if (r.top >= L.bottom - 0.5) {
        hidden++
        continue
      }
      if (!within(r, L) || r.right > C.right + 0.5) {
        problems.push(`cut: "${name}" [${Math.round(r.left)},${Math.round(r.right)}] in [${Math.round(L.left)},${Math.round(Math.min(L.right, C.right))}]`)
        continue
      }
      for (const part of chip.querySelectorAll('.db-avatar, .db-rel__icon, .db-file__icon, .db-status__led')) {
        const pr = part.getBoundingClientRect()
        if (!within(pr, r)) problems.push(`part cut: "${name}" ${part.className} [${Math.round(pr.left)},${Math.round(pr.right)}] in chip [${Math.round(r.left)},${Math.round(r.right)}]`)
      }
    }
    const key = list.querySelector<HTMLElement>(':scope > .db-more')
    const keyShown = !!key && getComputedStyle(key).visibility === 'visible' && getComputedStyle(key).display !== 'none'
    const count = keyShown ? Number((key!.dataset.count ?? '').replace('+', '')) : 0
    if (keyShown && !within(key!.getBoundingClientRect(), L)) problems.push(`key cut: ${key!.dataset.count}`)
    if (count !== hidden) problems.push(`count ${keyShown ? key!.dataset.count : 'none'} but ${hidden} hidden: ${(list.textContent ?? '').slice(0, 60)}`)
  }
  return { rows: lists.length, problems }
}

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

  test('wrap cells: a person row that fits on one line settles — no count, no flicker', async ({ page }) => {
    await openApp(page)
    const { dbId, viewId } = await seed(page)
    await wsEval(page, (s, a) => {
      const [jo, ben, eva, carla] = ['Jo', 'Ben', 'Eva Klein', 'Carla Dorn'].map((n) => s.addPerson(n))
      s.createRow(a.dbId, { title: 'Sync', properties: { pPerson: [jo, ben] } })
      s.createRow(a.dbId, { title: 'Retro', properties: { pPerson: [jo, ben, eva, carla] } })
      s.updateView(a.dbId, a.viewId, { propertyWidths: { pName: 160, pPerson: 260, pRel: 150 }, wrapCells: true })
    }, { dbId, viewId })
    await flush(page)
    await gotoPage(page, dbId)
    await expect(db(page).locator('.dbt')).toHaveAttribute('data-wrap', 'true')
    const changes = () => db(page).evaluate((el) => new Promise<number>((done) => {
      let n = 0
      const mo = new MutationObserver((list) => {
        n += list.length
      })
      mo.observe(el, { subtree: true, attributes: true, attributeFilter: ['data-more', 'data-off', 'data-count', 'style'] })
      let frames = 0
      const tick = () => {
        if (++frames < 20) requestAnimationFrame(tick)
        else {
          mo.disconnect()
          done(n)
        }
      }
      requestAnimationFrame(tick)
    }))
    for (const w of [260, 360]) {
      await wsEval(page, (s, a) => s.updateView(a.dbId, a.viewId, { propertyWidths: { pName: 160, pPerson: a.w, pRel: 150 } }), { dbId, viewId, w })
      for (const title of ['Kickoff', 'Sync', 'Retro']) {
        const per = cell(page, title, 'person')
        await expect.poll(() => chipsWhole(per)).toEqual({ shown: title === 'Sync' ? 2 : title === 'Kickoff' ? 2 : 4, hidden: 0 })
        await expect(countOf(per)).toBeHidden()
      }
      expect(await changes(), `nothing changes once settled (person column ${w} px)`).toBe(0)
      for (const title of ['Kickoff', 'Sync', 'Retro']) await expect(countOf(cell(page, title, 'person'))).toBeHidden()
    }
  })

  test('file names that arrive after the first fit are counted: the hidden file shows in "+1"', async ({ page }) => {
    await openApp(page)
    const { dbId, viewId } = await seed(page)
    const srcs = await page.evaluate(async () => {
      const one = (window as unknown as { __one: { files: { saveFile: (b: Blob, n: string) => Promise<string> } } }).__one
      return [
        await one.files.saveFile(new Blob(['%PDF-1.4 offer'], { type: 'application/pdf' }), 'Angebot Karlsruhe Hub final.pdf'),
        await one.files.saveFile(new Blob(['%PDF-1.4 minutes'], { type: 'application/pdf' }), 'Protokoll Kickoff Oktober.pdf'),
      ]
    })
    await wsEval(page, (s, a) => {
      s.addProperty(a.dbId, { id: 'pFiles', name: 'Files', type: 'files' })
      const id = (Object.values(s.pages) as Array<{ id: string; title: string; databaseId?: string }>).find((p) => p.databaseId === a.dbId && p.title === 'Kickoff')!.id
      s.setRowProperty(id, 'pFiles', a.srcs)
      s.updateView(a.dbId, a.viewId, { propertyWidths: { pName: 160, pPerson: 130, pRel: 150, pFiles: 170 } })
    }, { dbId, viewId, srcs })
    // a reload: the names are read from IndexedDB again, after the row's first fit
    await reloadApp(page)
    await gotoPage(page, dbId)
    const files = cell(page, 'Kickoff', 'files')
    await expect(files.locator('.db-file__name')).toHaveText(['Angebot Karlsruhe Hub final.pdf', 'Protokoll Kickoff Oktober.pdf'])
    await expect(countOf(files)).toBeVisible()
    await expect(countOf(files)).toHaveAttribute('title', '1 more: Protokoll Kickoff Oktober.pdf')
    expect(await chipsWhole(files)).toEqual({ shown: 1, hidden: 1 })
    expect((await db(page).evaluate(audit)).problems).toEqual([])
  })

  test('a text-size switch with the table open re-fits every row', async ({ page }) => {
    await openApp(page)
    const { dbId, viewId } = await seed(page)
    await wsEval(page, (s, a) => s.updateView(a.dbId, a.viewId, { propertyWidths: { pName: 160, pPerson: 400, pRel: 150 } }), { dbId, viewId })
    await gotoPage(page, dbId)
    // the Person column just wide enough for Mara Lind + Tessa Nordlicht at the standard size
    const per = cell(page, 'Kickoff', 'person')
    await expect.poll(() => chipsWhole(per)).toEqual({ shown: 2, hidden: 0 })
    const need = await per.evaluate((el) => {
      const chips = [...el.querySelectorAll('.db-chips > .db-person')].map((c) => c.getBoundingClientRect())
      return Math.ceil(chips[chips.length - 1].right - chips[0].left)
    })
    await wsEval(page, (s, a) => s.updateView(a.dbId, a.viewId, { propertyWidths: { pName: 160, pPerson: a.w, pRel: 150 } }), { dbId, viewId, w: need + 18 + 6 })
    await expect.poll(() => chipsWhole(per)).toEqual({ shown: 2, hidden: 0 })
    await expect(countOf(per)).toBeHidden()

    // Settings → Appearance → Text size → XL, then back to the table (nothing re-renders the rows)
    await uiEval(page, (u) => u.openModal({ type: 'settings', tab: 'appearance' }))
    await page.locator('[data-testid="text-size"] .tsize__name', { hasText: 'XL' }).click()
    await expect(page.locator('[data-testid="text-size"]')).toHaveAttribute('data-step', '4')
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-testid="text-size"]')).toHaveCount(0)
    await expect(countOf(per)).toHaveAttribute('data-count', '+1')
    await expect(countOf(per)).toBeVisible()
    await expect.poll(async () => (await db(page).evaluate(audit)).problems).toEqual([])
    expect(await chipsWhole(per)).toEqual({ shown: 1, hidden: 1 })

    // and back to the standard size: both fit again, the count goes
    await uiEval(page, (u) => u.openModal({ type: 'settings', tab: 'appearance' }))
    await page.locator('[data-testid="text-size"] .tsize__name', { hasText: 'Standard' }).click()
    await page.keyboard.press('Escape')
    await expect(countOf(per)).toBeHidden()
    await expect.poll(async () => (await db(page).evaluate(audit)).problems).toEqual([])
    expect(await chipsWhole(per)).toEqual({ shown: 2, hidden: 0 })
  })

  test('the web font arriving after the first fit re-fits every row', async ({ page }) => {
    let release!: () => void
    const held = new Promise<void>((r) => {
      release = r
    })
    await page.route(/\.woff2(\?|$)/, async (route) => {
      await held
      await route.continue()
    })
    await openApp(page)
    const { dbId, viewId } = await seed(page)
    await wsEval(page, (s, a) => {
      const target = (Object.values(s.pages) as Array<{ title: string; databaseId?: string }>).find((p) => p.title === 'Tessera')!.databaseId!
      const ten = Array.from({ length: 10 }, (_, i) => s.createRow(target, { title: `Projekt ${i + 1}` }))
      s.addProperty(a.dbId, { id: 'pRel2', name: 'Relation 2', type: 'relation', relationDatabaseId: target })
      s.createRow(a.dbId, { title: 'Ten', properties: { pRel: ten, pRel2: ten } })
      s.updateView(a.dbId, a.viewId, { propertyWidths: { pName: 160, pPerson: 150, pRel: 240, pRel2: 240 } })
    }, { dbId, viewId })
    await gotoPage(page, dbId)
    const ten = cell(page, 'Ten', 'relation')
    await expect(ten.first().locator('.db-rel')).toHaveCount(10)
    expect(await page.evaluate(() => document.fonts.check('12px "Archivo Variable"')), 'the web font is held back').toBe(false)
    // two columns on either side of the edge for four chips + the count (the fallback font's widths): one where four
    // just fit, one where a fifth just misses — wider or narrower glyphs move the edge of one of them
    const needs = (c: Locator) => c.evaluate((el) => {
      // the room k chips + the count need (chipFit.ts: gap 4, slack 1 + k / 2), from each chip's whole width
      const list = el.querySelector('.db-chips')!
      const key = list.querySelector<HTMLElement>('.db-more')!
      const chips = [...list.children].filter((c) => c !== key) as HTMLElement[]
      let used = 0
      const need = chips.map((c, i) => {
        const name = c.querySelector<HTMLElement>('.db-rel__name')!
        used += (i ? 4 : 0) + c.offsetWidth + Math.max(0, name.scrollWidth - name.clientWidth)
        return used + 4 + key.offsetWidth + 1 + (i + 1) * 0.5
      })
      const room = (list as HTMLElement).clientWidth
      const fit = need.findIndex((n) => n > room)
      return { need, hidden: chips.length - (fit < 0 ? chips.length : fit), count: list.hasAttribute('data-more') ? key.dataset.count : 'none' }
    })
    const before = (await needs(ten.first())).need
    const tight = Math.ceil(before[3]) + 18
    const miss = Math.ceil(before[4]) - 1 + 18
    await wsEval(page, (s, a) => s.updateView(a.dbId, a.viewId, { propertyWidths: { pName: 160, pPerson: 150, pRel: a.tight, pRel2: a.miss } }), { dbId, viewId, tight, miss })
    for (const c of [ten.first(), ten.nth(1)]) await expect(countOf(c)).toHaveAttribute('data-count', '+6')
    expect((await db(page).evaluate(audit)).problems).toEqual([])
    release()
    await page.waitForFunction(() => document.fonts.check('12px "Archivo Variable"'))
    await expect.poll(async () => (await db(page).evaluate(audit)).problems).toEqual([])
    // the count is the one the new widths call for (not the fallback font's)
    for (const c of [ten.first(), ten.nth(1)])
      await expect.poll(async () => {
        const n = await needs(c)
        return n.count === `+${n.hidden}`
      }).toBe(true)
    const after = await needs(ten.first())
    expect(after.need[4], 'the web font changed the chips\' widths').not.toBe(before[4])
  })

  test('free-board cards: chips stay whole, their icons whole, the rest behind "+n"', async ({ page }) => {
    await openApp(page)
    const { dbId } = await seed(page)
    await wsEval(page, (s, a) => {
      const names = ['Mara Lind', 'Tessa Nordlicht', 'Jo Berg', 'Ben Haas', 'Eva Klein', 'Carla Dorn', 'Ida Sommer', 'Lukas Brandt', 'Nele Voss', 'Timo Kranz']
      const people = (s.people as Array<{ id: string; name: string }>)
      const ids = names.map((n) => people.find((p) => p.name === n)?.id ?? s.addPerson(n))
      const target = (Object.values(s.pages) as Array<{ title: string; databaseId?: string }>).find((p) => p.title === 'Tessera')!.databaseId!
      const rels = Array.from({ length: 10 }, (_, i) => s.createRow(target, { title: `Projekt ${i + 1}` }))
      s.addProperty(a.dbId, { id: 'pTags', name: 'Tags', type: 'multi_select', options: Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, name: `Thema ${i + 1}`, color: 'orange' })) })
      s.addProperty(a.dbId, { id: 'pLane', name: 'Lane', type: 'select', options: [{ id: 'l1', name: 'Inbox', color: 'gray' }] })
      s.createRow(a.dbId, { title: 'Ten', properties: { pPerson: ids, pRel: rels, pTags: Array.from({ length: 10 }, (_, i) => `t${i}`), pLane: 'l1' } })
      s.addView(a.dbId, { type: 'board', name: 'Free', free: true, groupBy: 'pLane', hiddenGroups: [], visibleProperties: ['pPerson', 'pRel', 'pTags'], typeFields: { __plain__: ['pPerson', 'pRel', 'pTags'] } })
    }, { dbId })
    await flush(page)
    await gotoPage(page, dbId)
    await page.locator('#main [role="tab"]', { hasText: 'Free' }).click()
    const card = db(page).locator('.fb-card', { hasText: 'Ten' })
    await expect(card.locator('.fb-card__field')).toHaveCount(3)
    await expect.poll(async () => card.evaluate(audit)).toEqual({ rows: 3, problems: [] })
    for (const type of ['person', 'relation', 'multi_select']) {
      const field = card.locator(`.fb-card__field[data-type="${type}"]`)
      await expect(countOf(field)).toBeVisible()
      await expect(countOf(field)).toHaveAttribute('title', /^\d+ more: /)
    }
  })
})
