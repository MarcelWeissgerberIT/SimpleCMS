/**
 * Charts: /chart → builder (data → type → options), manual data → bar in three clicks, type switch,
 * database / workspace / spreadsheet sources (live), keyboard readouts, downloads, share view +
 * Markdown, 390 px, dark theme, German, and unit-level checks of ticks and table detection.
 */
import type { Locator, Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, gotoPage, editorOf, createPage, doc, para, wsEval, flush, pageById } from './fixtures'

type Spec = Record<string, unknown>
const chart = (spec: Spec | null): JSONContent => ({ type: 'chart', attrs: { spec } })
const manual = (kind: string, rows: (string | number | null)[][], extra: Spec = {}): Spec => ({ kind, source: { kind: 'manual', rows }, ...extra })
const SALES = [
  ['Month', 'Revenue'],
  ['Jan', 12],
  ['Feb', 18],
  ['Mar', 15],
  ['Apr', 24],
]

/** Stored chart specs of a page. */
async function storedCharts(page: Page, id: string): Promise<Spec[]> {
  const p = await pageById(page, id)
  const out: Spec[] = []
  const walk = (n: JSONContent) => {
    if (n.type === 'chart') out.push((n.attrs?.spec ?? null) as Spec)
    ;(n.content ?? []).forEach(walk)
  }
  if (p.content) walk(p.content)
  return out
}

/** "/chart" + Enter on a fresh line below the paragraph `after`. */
async function slashChart(page: Page, ed: Locator, after: string, query = '/chart') {
  await ed.locator('p', { hasText: after }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type(query)
  await page.keyboard.press('Enter')
}

/** Values of the chart's data table (opens it), row label → cells. */
async function tableOf(block: Locator): Promise<Record<string, string[]>> {
  const toggle = block.locator('.ch-tabletoggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  const rows = block.locator('.ch-table tbody tr')
  await expect(rows.first()).toBeVisible()
  const out: Record<string, string[]> = {}
  for (const r of await rows.all()) {
    const label = ((await r.locator('th').textContent()) ?? '').trim()
    out[label] = (await r.locator('td').allTextContents()).map((s) => s.trim())
  }
  return out
}

/** Projects database: id + property ids (seeded demo workspace). */
async function projects(page: Page) {
  return wsEval(page, (s) => {
    const p = (Object.values(s.pages) as Spec[]).find((x) => x.kind === 'database' && /Projects|Projekte/.test(String(x.title))) as { id: string }
    const db = s.databases[p.id]
    const by = (fn: (q: Spec) => boolean) => (db.properties as Spec[]).find(fn)?.id as string
    return { id: p.id, status: by((q) => q.type === 'status'), budget: by((q) => q.name === 'Budget'), prio: by((q) => q.type === 'select') }
  })
}

test.describe('charts', () => {
  test('/chart opens the builder; manual data becomes a bar chart in three clicks; type switch; reload keeps it', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Chart lab', content: doc(para('Intro line')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p', { hasText: 'Intro line' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/chart')
    await expect(page.locator('.slash .slash__item[aria-selected="true"] .slash__name')).toHaveText('Chart')
    await page.keyboard.press('Enter')

    const dialog = page.getByRole('dialog', { name: 'New chart' })
    await expect(dialog).toBeVisible()
    // click 1: the source (a sample table is ready) · click 2: next · click 3: insert (bar is suggested)
    await dialog.getByRole('radio', { name: /Enter data/ }).click()
    await expect(dialog.locator('.chb__preview .ch-svg')).toBeVisible()
    await dialog.getByRole('button', { name: 'Next' }).click()
    const bar = dialog.getByRole('radio', { name: /^Bar/ })
    await expect(bar).toHaveAttribute('aria-checked', 'true')
    await expect(bar).toContainText('Suggested')
    await dialog.getByRole('button', { name: 'Insert chart' }).click()
    await expect(dialog).toBeHidden()

    const block = ed.locator('.chart-block')
    await expect(block.locator('.ch-svg--bar')).toBeVisible()
    await expect(block.locator('.ch-svg--bar .ch-xlabel')).toHaveCount(5)
    await expect(block.locator('.chart-block__plate')).toContainText('Bar')
    await expect.poll(async () => (await storedCharts(page, id))[0]?.kind).toBe('bar')
    const stored = (await storedCharts(page, id))[0] as { source: { kind: string; rows: unknown[][] } }
    expect(stored.source.kind).toBe('manual')
    expect(stored.source.rows[1]).toEqual(['Design', 12, 9])

    // change the type from the chart menu: line, donut, KPI
    for (const [name, cls] of [
      ['Line', '.ch-svg--line'],
      ['Donut', '.ch-svg--donut'],
      ['KPI', '.ch-svg--kpi'],
    ] as const) {
      await block.hover()
      await block.getByRole('button', { name: 'Chart menu' }).click()
      await page.getByRole('menuitem', { name: 'Chart type' }).click()
      await page.getByRole('menuitem', { name, exact: true }).click()
      await expect(block.locator(cls)).toBeVisible()
    }
    // KPI of categories: the total of the first series
    await expect(block.locator('.ch-kpi-value')).toHaveText('90')
    await expect(block.locator('.ch-kpi-label')).toHaveText('PLANNED · TOTAL')
    await expect.poll(async () => (await storedCharts(page, id))[0]?.kind).toBe('kpi')

    await flush(page)
    await page.reload()
    await expect(editorOf(page, id).locator('.chart-block .ch-svg--kpi')).toBeVisible()
  })

  test('cancelling the builder of a fresh chart removes the empty block; "Set up chart" on an empty one', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Cancel lab', content: doc(para('Top'), chart(null)) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    // an empty chart (e.g. pasted) offers its set-up
    await expect(ed.locator('.chart-block.is-empty')).toContainText('No data source yet')
    await slashChart(page, ed, 'Top')
    const dialog = page.getByRole('dialog', { name: 'New chart' })
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(ed.locator('.chart-block')).toHaveCount(1)
    await ed.locator('.chart-block.is-empty').getByRole('button', { name: 'Set up chart' }).click()
    await expect(page.getByRole('dialog', { name: 'Edit chart' }).or(page.getByRole('dialog', { name: 'New chart' }))).toBeVisible()
  })

  test('keyboard readouts: arrows step through the points, Home / End, Escape', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Readouts', content: doc(para('A'), chart(manual('bar', SALES, { title: 'Sales' }))) })
    await gotoPage(page, id)
    const block = editorOf(page, id).locator('.chart-block')
    const plot = block.locator('.ch__plot')
    await expect(plot).toHaveAttribute('aria-roledescription', 'chart')
    await plot.focus()
    const tip = block.locator('.ch-tip')
    await expect(tip).toContainText('Jan')
    await expect(tip).toContainText('12')
    await page.keyboard.press('ArrowRight')
    await expect(tip).toContainText('Feb')
    await expect(block.locator('[aria-live="polite"]')).toHaveText('Feb: 18')
    await page.keyboard.press('End')
    await expect(tip).toContainText('Apr')
    await page.keyboard.press('Home')
    await expect(tip).toContainText('Jan')
    // the other bars dim while one is read
    await expect(block.locator('.ch-bar[data-dim="true"]')).toHaveCount(3)
    await page.keyboard.press('Escape')
    await expect(tip).toHaveCount(0)
    // the data table is the accessible twin of the picture
    expect(await tableOf(block)).toEqual({ Jan: ['12'], Feb: ['18'], Mar: ['15'], Apr: ['24'] })
  })

  test('database source: grouped by status, sum of budget — the chart follows row edits live', async ({ page }) => {
    await openApp(page)
    const P = await projects(page)
    const id = await createPage(page, { title: 'Budget chart', content: doc(para('Overview')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await slashChart(page, ed, 'Overview')
    const dialog = page.getByRole('dialog', { name: 'New chart' })
    await dialog.getByRole('radio', { name: /Database/ }).click()
    await dialog.getByLabel('Database', { exact: true }).selectOption({ label: 'Projects' })
    await expect(dialog.getByLabel('Group by')).toHaveValue(P.status)
    await dialog.getByRole('radio', { name: 'Sum', exact: true }).click()
    await dialog.getByLabel('Number', { exact: true }).selectOption({ label: 'Budget' })
    await dialog.getByRole('button', { name: 'Next' }).click()
    await dialog.getByRole('button', { name: 'Insert chart' }).click()

    const block = ed.locator('.chart-block')
    await expect(block.locator('.chart-block__title')).toHaveText('Projects')
    await expect(block.locator('.chart-block__plate')).toContainText('Database')
    const expected = await wsEval(
      page,
      (s, P) => {
        const db = s.databases[P.id]
        const status = db.properties.find((p: Spec) => p.id === P.status)
        const out: Record<string, number> = {}
        for (const o of status.options) out[o.name] = 0
        for (const r of Object.values(s.pages) as Spec[]) {
          if (r.databaseId !== P.id || r.trashed) continue
          const props = r.properties as Record<string, unknown>
          const opt = status.options.find((o: Spec) => o.id === props[P.status])
          if (opt) out[opt.name as string] += Number(props[P.budget] ?? 0)
        }
        return out
      },
      P,
    )
    const fmt = (n: number) => `€${n.toLocaleString('en-US')}`
    const before = await tableOf(block)
    for (const [k, v] of Object.entries(expected)) expect(before[k]).toEqual([fmt(v)])

    // a row's budget changes → the chart follows
    const row = await wsEval(
      page,
      (s, P) => {
        const r = (Object.values(s.pages) as Spec[]).find((x) => x.databaseId === P.id && !x.trashed && (x.properties as Record<string, unknown>)[P.status]) as Spec
        const props = r.properties as Record<string, unknown>
        const status = s.databases[P.id].properties.find((p: Spec) => p.id === P.status).options.find((o: Spec) => o.id === props[P.status]).name
        s.setRowProperty(r.id, P.budget, Number(props[P.budget] ?? 0) + 1000)
        return { status }
      },
      P,
    )
    await expect.poll(async () => (await tableOf(block))[row.status]?.[0]).toBe(fmt(expected[row.status] + 1000))
  })

  test('workspace data: "Pages created" counts the seeded pages; open vs. done to-dos', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Workspace chart', content: doc(para('Stats'), { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [para('Shipped')] }] }) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await slashChart(page, ed, 'Stats')
    const dialog = page.getByRole('dialog', { name: 'New chart' })
    await dialog.getByRole('radio', { name: /Workspace data/ }).click()
    await expect(dialog.getByRole('radio', { name: /Pages created/ })).toHaveAttribute('aria-checked', 'true')
    await dialog.getByRole('button', { name: 'Next' }).click()
    await dialog.getByRole('button', { name: 'Insert chart' }).click()
    const block = ed.locator('.chart-block').first()
    await expect(block.locator('.chart-block__title')).toHaveText('Pages created')
    const pages = await wsEval(page, (s) => (Object.values(s.pages) as Spec[]).filter((p) => !p.databaseId && !p.trashed && !p.template && Date.now() - Number(p.createdAt) < 30 * 864e5).length)
    expect(pages).toBeGreaterThan(5)
    const table = await tableOf(block)
    expect(Object.keys(table)).toHaveLength(30)
    const total = Object.values(table).reduce((a, [v]) => a + Number(v), 0)
    // template pages (hidden "Templates" area) are not counted
    expect(total).toBeGreaterThan(5)
    expect(total).toBeLessThanOrEqual(pages)

    // to-dos: the checked one on this page is among the done ones
    const todos = await wsEval(page, (s) => {
      let open = 0
      let done = 0
      const walk = (n: Spec) => {
        if (n.type === 'taskItem') (n.attrs as Spec)?.checked ? done++ : open++
        ;((n.content ?? []) as Spec[]).forEach(walk)
      }
      for (const p of Object.values(s.pages) as Spec[]) if (!p.trashed && !p.template && p.content) walk(p.content as Spec)
      return { open, done }
    })
    await wsEval(
      page,
      (s, id) => {
        const p = s.pages[id]
        s.setContent(id, { ...p.content, content: [...p.content.content, { type: 'chart', attrs: { spec: { kind: 'donut', source: { kind: 'system', metric: 'todos', range: 'all' } } } }] }, 'e2e')
      },
      id,
    )
    const donut = ed.locator('.chart-block').nth(1)
    await expect(donut.locator('.ch-svg--donut')).toBeVisible()
    const t2 = await tableOf(donut)
    expect(Number(t2.Done[0])).toBeGreaterThanOrEqual(1)
    expect(Number(t2.Open[0]) + Number(t2.Done[0])).toBeLessThanOrEqual(todos.open + todos.done)
  })

  test('spreadsheet source: a range and DS(…) — the chart follows cell edits', async ({ page }) => {
    await openApp(page)
    const sheet = (b6: string) => ({
      type: 'spreadsheet',
      attrs: {
        id: 'sheetblock1',
        title: 'Regions',
        active: 's1',
        datasets: [],
        charts: [],
        sheets: [
          {
            id: 's1',
            name: 'Sheet 1',
            rows: 20,
            cols: 6,
            colWidths: {},
            cells: { A1: { v: 'Region' }, B1: { v: 'Sales' }, A2: { v: 'North' }, B2: { v: '10' }, A3: { v: 'South' }, B3: { v: '20' }, A5: { v: 'East' }, B5: { v: '30' }, A6: { v: 'West' }, B6: { v: b6 } },
          },
        ],
      },
    })
    const id = await createPage(page, { title: 'Sheet chart', content: doc(para('Data'), sheet('=B5+5')) })
    const spec = (ref: string): Spec => ({ kind: 'bar', title: ref, source: { kind: 'sheet', pageId: id, sheetBlockId: 'sheetblock1', ref } })
    await wsEval(
      page,
      (s, { id, a, b }) => {
        const p = s.pages[id]
        s.setContent(id, { ...p.content, content: [...p.content.content, { type: 'chart', attrs: { spec: a } }, { type: 'chart', attrs: { spec: b } }] }, 'e2e')
      },
      { id, a: spec('A1:B3'), b: spec('DS(A1:B3; A5:B6)') },
    )
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    const range = ed.locator('.chart-block').nth(0)
    const ds = ed.locator('.chart-block').nth(1)
    expect(await tableOf(range)).toEqual({ North: ['10'], South: ['20'] })
    expect(await tableOf(ds)).toEqual({ North: ['10'], South: ['20'], East: ['30'], West: ['35'] })
    await expect(range.locator('.chart-block__plate')).toContainText('Spreadsheet')

    // a cell changes (any writer) → both charts follow
    await wsEval(
      page,
      (s, id) => {
        const p = s.pages[id]
        const content = JSON.parse(JSON.stringify(p.content))
        const node = content.content.find((n: Spec) => n.type === 'spreadsheet')
        node.attrs.sheets[0].cells.B2 = { v: '12' }
        node.attrs.sheets[0].cells.B5 = { v: '40' }
        s.setContent(id, content, 'e2e')
      },
      id,
    )
    await expect.poll(async () => (await tableOf(range)).North?.[0]).toBe('12')
    await expect.poll(async () => (await tableOf(ds)).West?.[0]).toBe('45')
  })

  test('downloads (PNG / SVG), copy as TSV, share view renders the frozen chart, Markdown has the data table', async ({ page, context, browser, errors }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openApp(page)
    const P = await projects(page)
    const id = await createPage(page, {
      title: 'Share chart',
      content: doc(para('Numbers'), chart(manual('line', SALES, { title: 'Monthly sales', unit: '€' })), chart({ kind: 'bar', title: 'Projects by status', source: { kind: 'database', databaseId: P.id, x: P.status, aggregate: 'count' } })),
    })
    await gotoPage(page, id)
    const block = editorOf(page, id).locator('.chart-block').first()
    await expect(block.locator('.ch-svg--line')).toBeVisible()

    for (const [item, ext] of [
      ['Download PNG', 'png'],
      ['Download SVG', 'svg'],
    ] as const) {
      await block.hover()
      await block.getByRole('button', { name: 'Chart menu' }).click()
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: item }).click()])
      expect(download.suggestedFilename()).toBe(`monthly-sales.${ext}`)
      const path = await download.path()
      const { readFileSync } = await import('node:fs')
      const bytes = readFileSync(path!)
      if (ext === 'png') expect(bytes.subarray(1, 4).toString()).toBe('PNG')
      else {
        const svg = bytes.toString()
        expect(svg).toMatch(/^<svg[^>]+xmlns="http:\/\/www.w3.org\/2000\/svg"/)
        expect(svg).toContain('Monthly sales')
        // one theme written in: no design-token references left in a standalone file
        expect(svg).not.toContain('var(--')
      }
    }

    await block.hover()
    await block.getByRole('button', { name: 'Chart menu' }).click()
    await page.getByRole('menuitem', { name: 'Copy data as TSV' }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('\tRevenue\nJan\t12\nFeb\t18\nMar\t15\nApr\t24')

    // share: Markdown with the data tables, then the link in another browser
    await page.locator('.tb').getByRole('button', { name: 'Share', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const url = dialog.getByRole('textbox', { name: 'Share link' })
    await expect(url).toHaveValue(/#\/s\//)
    const link = await url.inputValue()
    await dialog.getByRole('button', { name: /Copy as Markdown/ }).click()
    await expect(dialog.getByText('Copied')).toBeVisible()
    const md = await page.evaluate(() => navigator.clipboard.readText())
    expect(md).toContain('**Monthly sales**')
    expect(md).toContain('| Label | Revenue |')
    expect(md).toContain('| Feb | €18 |')
    expect(md).toContain('**Projects by status**')
    await page.keyboard.press('Escape')

    const other = await browser.newContext({ serviceWorkers: 'block', locale: 'en-US' })
    const p2 = await other.newPage()
    errors.watch(p2)
    await p2.goto(link)
    const shared = p2.locator('.shv__doc .chart-block')
    await expect(shared).toHaveCount(2)
    await expect(shared.first().locator('.ch-svg--line')).toBeVisible()
    // the database chart travelled as numbers (the reader's workspace has other ids)
    await expect(shared.nth(1).locator('.ch-svg--bar .ch-bar').first()).toBeVisible()
    // read-only: no edit tools
    await expect(shared.getByRole('button', { name: 'Edit' })).toHaveCount(0)
    await other.close()

  })

  test('390 px, dark theme and German', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openApp(page)
    const id = await createPage(page, { title: 'Narrow', content: doc(para('Small'), chart(manual('bar', SALES, { title: 'Sales' })), chart(manual('donut', SALES, { title: 'Share' }))) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    const blocks = ed.locator('.chart-block')
    await expect(blocks.nth(1).locator('.ch-svg--donut')).toBeVisible()
    for (const b of await blocks.all()) {
      const { scroll, client } = await b.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }))
      expect(scroll).toBeLessThanOrEqual(client + 1)
      const svgW = await b.locator('.ch-svg').evaluate((el) => el.getBoundingClientRect().width)
      expect(svgW).toBeLessThanOrEqual(390)
    }

    // dark: marks use the Carbon signal
    await wsEval(page, (s) => s.updateSettings({ theme: 'dark' }))
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await expect.poll(() => blocks.first().locator('.ch-bar').first().evaluate((el) => getComputedStyle(el).fill)).toBe('rgb(255, 92, 26)')

    // German: slash item, builder, labels
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await expect(blocks.first().locator('.chart-block__plate')).toContainText('Säulen')
    await ed.locator('p', { hasText: 'Small' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/diagramm')
    await expect(page.locator('.slash .slash__item[aria-selected="true"] .slash__name')).toHaveText('Diagramm')
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Neues Diagramm' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('radio', { name: /Daten eingeben/ })).toBeVisible()
    await dialog.getByRole('radio', { name: /Daten eingeben/ }).click()
    await dialog.getByRole('button', { name: 'Weiter' }).click()
    await expect(dialog.getByRole('radio', { name: /Säulen/ })).toContainText('Vorschlag')
    await dialog.getByRole('button', { name: 'Diagramm einfügen' }).click()
    await expect(blocks).toHaveCount(3)
    await expect(blocks.nth(1).locator('.ch-tabletoggle')).toHaveText('Datentabelle')
  })

  test('unit: nice ticks, number parsing, header / label detection, suggestions, frozen specs', async ({ page }) => {
    await openApp(page)
    const r = await page.evaluate(() => {
      const C = (window as unknown as { __oneCharts: Record<string, (...a: unknown[]) => unknown> }).__oneCharts
      const ticks = (a: number, b: number, n = 5, o = {}) => (C.niceTicks(a, b, n, o) as { ticks: number[] }).ticks
      const data = (rows: unknown[][], spec = {}) => C.tableToChartData(rows, spec, { lang: 'en' }) as { labels: string[]; series: { name: string; values: (number | null)[] }[]; unit?: string }
      return {
        t1: ticks(0, 97),
        t2: ticks(0, 0.7),
        t3: ticks(0, 3, 5, { integer: true }),
        t4: ticks(-12, 30),
        t5: ticks(5, 5),
        n1: (C.parseNumber('1,200.50') as { value: number }).value,
        n2: (C.parseNumber('1.200,50', 'de') as { value: number }).value,
        n3: C.parseNumber('12 %') as { value: number; unit: string },
        n4: (C.parseNumber('(3)') as { value: number }).value,
        n5: C.parseNumber('abc'),
        // header row + label column
        d1: data([
          ['Month', 'Revenue', 'Costs'],
          ['Jan', 10, 7],
          ['Feb', '12', '8'],
        ]),
        // no header, numbers only → one series, labels 1…n
        d2: data([[4], [5], [6]]),
        // years as labels
        d3: data([
          ['Year', 'Users'],
          [2024, 100],
          [2025, 180],
        ]),
        // one row across columns → one series
        d4: data([
          ['Q1', 'Q2', 'Q3'],
          [3, 5, 8],
        ]),
        // series in rows
        d5: data(
          [
            ['', 'Jan', 'Feb'],
            ['North', 1, 2],
            ['South', 3, 4],
          ],
          { seriesIn: 'rows' },
        ),
        // percentages carry their unit
        d6: data([
          ['Team', 'Share'],
          ['A', '40%'],
          ['B', '60%'],
        ]),
        s1: C.suggestKind({ labels: ['Total'], series: [{ name: 'x', values: [5] }] }),
        s2: C.suggestKind({ labels: ['2026-01', '2026-02', '2026-03'], series: [{ name: 'x', values: [1, 2, 3] }] }),
        s3: C.suggestKind({ labels: ['A', 'B', 'C'], series: [{ name: 'x', values: [1, 2, 3] }] }),
        kpi: C.chartToSvg({ kind: 'kpi', source: { kind: 'manual', rows: [] } }, C.tableToChartData([['Month', 'Sales'], ['Jan', 12], ['Feb', 18], ['Mar', 15], ['Apr', 24]], {}, { lang: 'en' }), { width: 600, theme: 'light' }) as string,
        bad: C.normalizeSpec({ kind: 'evil', source: { kind: 'manual', rows: [['<script>', 1]] }, height: 9999, colors: ['red', 'nope'] }),
        none: C.normalizeSpec({ kind: 'bar', source: { kind: 'wat' } }),
      }
    })
    expect(r.t1).toEqual([0, 20, 40, 60, 80, 100])
    expect(r.t2).toEqual([0, 0.2, 0.4, 0.6, 0.8])
    expect(r.t3).toEqual([0, 1, 2, 3])
    expect(r.t4).toEqual([-20, -10, 0, 10, 20, 30])
    expect(r.t5[0]).toBe(0)
    expect(r.n1).toBe(1200.5)
    expect(r.n2).toBe(1200.5)
    expect(r.n3).toEqual({ value: 12, unit: '%' })
    expect(r.n4).toBe(-3)
    expect(r.n5).toBeNull()
    expect(r.d1.labels).toEqual(['Jan', 'Feb'])
    expect(r.d1.series).toEqual([
      { name: 'Revenue', values: [10, 12] },
      { name: 'Costs', values: [7, 8] },
    ])
    expect(r.d2.labels).toEqual(['1', '2', '3'])
    expect(r.d2.series[0].values).toEqual([4, 5, 6])
    expect(r.d3.labels).toEqual(['2024', '2025'])
    expect(r.d3.series).toEqual([{ name: 'Users', values: [100, 180] }])
    expect(r.d4.labels).toEqual(['Q1', 'Q2', 'Q3'])
    expect(r.d4.series[0].values).toEqual([3, 5, 8])
    expect(r.d5.labels).toEqual(['Jan', 'Feb'])
    expect(r.d5.series.map((s) => s.name)).toEqual(['North', 'South'])
    expect(r.d5.series[1].values).toEqual([3, 4])
    expect(r.d6.unit).toBe('%')
    expect(r.d6.series[0].values).toEqual([40, 60])
    expect(r.s1).toBe('kpi')
    expect(r.s2).toBe('line')
    expect(r.s3).toBe('bar')
    expect(r.bad).toMatchObject({ kind: 'bar', height: 640, colors: ['red'] })
    expect(r.none).toBeNull()
    // KPI of a time series: the latest value and its change vs. the bucket before
    expect(r.kpi).toContain('>24<')
    expect(r.kpi).toContain('+60.0%')
    expect(r.kpi).toContain('VS. MAR')
    expect(r.kpi).not.toContain('var(--')
  })
})
