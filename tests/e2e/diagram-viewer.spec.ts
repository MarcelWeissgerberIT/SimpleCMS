/**
 * Diagram viewer (ui/viewer): a Mermaid or chart block opens large — the toolbar key, a double-click, the block
 * menu, the "SCALED … · OPEN" chip — as vector SVG. Zoom (buttons, keys, Ctrl + wheel), Fit / 100 %, drag pans,
 * the minimap (its rectangle follows the view, a click jumps, M toggles), Esc closes and hands focus back,
 * Download SVG, German, 390 px and the dark theme (re-drawn in Carbon colours). Read-only copies (a shared page)
 * open it too, a presentation does not (it owns the keys); a database's Chart view has the key as well.
 */
import { readFileSync } from 'node:fs'
import type { Locator, Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, gotoPage, createPage, doc, para, pageIdByTitle, wsEval } from './fixtures'

/** ~30 nodes, left to right: far wider than the page column and than the viewer at 100 %. */
const FLOW = `flowchart LR
  A[Request in] --> B{Triage}
  B -->|Bug| C[Reproduce]
  B -->|Feature| D[Scope]
  B -->|Question| E[Answer in thread]
  C --> F[Write failing test]
  F --> G[Fix]
  G --> H[Code review]
  D --> I[Design spec]
  I --> J[Estimate]
  J --> K{Fits the sprint?}
  K -->|Yes| L[Build]
  K -->|No| M[Backlog]
  L --> H
  H --> N{Approved?}
  N -->|Changes| G
  N -->|Yes| O[Merge]
  O --> P[CI pipeline]
  P --> Q{Green?}
  Q -->|No| R[Fix the build]
  R --> P
  Q -->|Yes| S[Staging deploy]
  S --> T[Smoke tests]
  T --> U[QA sign-off]
  U --> V[Release notes]
  V --> W[Production deploy]
  W --> X[Monitor 24 h]
  X --> Y{Incidents?}
  Y -->|Yes| Z[Rollback]
  Y -->|No| AA[Close ticket]
  Z --> C
  E --> AA`

const CHART: JSONContent = {
  type: 'chart',
  attrs: {
    spec: {
      kind: 'bar',
      title: 'Revenue by month',
      source: { kind: 'manual', rows: [['Month', 'Revenue'], ['Jan', 12], ['Feb', 18], ['Mar', 15], ['Apr', 24]] },
    },
  },
}

async function setup(page: Page): Promise<string> {
  await openApp(page)
  const id = await createPage(page, { title: 'Release process', content: doc(para('How a request becomes a release.'), { type: 'mermaid', attrs: { code: FLOW } }, CHART) })
  await gotoPage(page, id)
  await expect(page.locator('#main .mermaid-view__svg svg')).toBeVisible({ timeout: 20_000 })
  return id
}

const viewer = (page: Page) => page.getByTestId('diagram-viewer')
const stage = (page: Page) => page.getByTestId('viewer-stage')
const zoomPct = async (page: Page) => Number(((await page.getByTestId('viewer-zoom').textContent()) ?? '').replace(/\D/g, ''))

/** The drawing's position on the canvas (the host's translation). */
async function offset(page: Page): Promise<{ x: number; y: number }> {
  const tr = await page.locator('.dv__content').evaluate((el) => (el as HTMLElement).style.transform)
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(tr)
  if (!m) throw new Error(`no translation in "${tr}"`)
  return { x: Number(m[1]), y: Number(m[2]) }
}

/** The exact scale on screen: the SVG's laid-out width × a running transform, over its own width. */
const scaleNow = (page: Page) =>
  page.locator('.dv__content').evaluate((host) => {
    const svg = host.querySelector('svg') as SVGSVGElement
    const k = Number(/scale\(([\d.e-]+)\)/.exec((host as HTMLElement).style.transform)?.[1] ?? 1)
    return (Number(svg.getAttribute('width')) * k) / svg.viewBox.baseVal.width
  })

async function boxOf(loc: Locator) {
  const b = await loc.boundingBox()
  if (!b) throw new Error('no box')
  return b
}

/** Wait for the drawing, then for the first view (fit). */
async function opened(page: Page) {
  await expect(viewer(page)).toBeVisible()
  await expect(page.locator('.dv__content svg')).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => zoomPct(page)).toBeGreaterThan(0)
}

test.describe('diagram viewer', () => {
  test('the toolbar key opens a Mermaid diagram large: zoom by buttons, keys and Ctrl + wheel, Fit, 100 %, Esc hands focus back', async ({ page }) => {
    await setup(page)
    const key = page.getByTestId('mermaid-open')
    await key.click()
    await opened(page)
    const dialog = page.getByRole('dialog', { name: /Diagram · Flowchart/ })
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('viewer-plate')).toHaveText(/Diagram · Flowchart/)
    // vector: the drawing is an SVG, laid out at the shown size
    const fit = await zoomPct(page)
    expect(fit).toBeLessThan(100)
    // buttons
    await dialog.getByRole('button', { name: 'Zoom in' }).click()
    await expect.poll(() => zoomPct(page)).toBeGreaterThan(fit)
    await dialog.getByRole('button', { name: /Actual size/ }).click()
    await expect(page.getByTestId('viewer-zoom')).toHaveText('Zoom 100 %')
    await dialog.getByRole('button', { name: 'Zoom out' }).click()
    await expect(page.getByTestId('viewer-zoom')).toHaveText('Zoom 80 %')
    await dialog.getByRole('button', { name: /Fit to the window/ }).click()
    await expect.poll(() => zoomPct(page)).toBe(fit)
    // keys
    await stage(page).focus()
    await page.keyboard.press('1')
    await expect(page.getByTestId('viewer-zoom')).toHaveText('Zoom 100 %')
    await page.keyboard.press('+')
    await expect(page.getByTestId('viewer-zoom')).toHaveText('Zoom 125 %')
    await page.keyboard.press('=')
    await expect(page.getByTestId('viewer-zoom')).toHaveText('Zoom 150 %')
    await page.keyboard.press('-')
    await expect(page.getByTestId('viewer-zoom')).toHaveText('Zoom 125 %')
    await page.keyboard.press('0')
    await expect.poll(() => zoomPct(page)).toBe(fit)
    // the SVG is laid out again at the zoom it rests at (vector, no stretched picture)
    await page.keyboard.press('1')
    await expect.poll(() => page.locator('.dv__content > svg').evaluate((svg) => Math.round(Number(svg.getAttribute('width')) / (svg as SVGSVGElement).viewBox.baseVal.width * 100))).toBe(100)
    // Ctrl + wheel zooms in around the pointer: the point under it stays put
    const box = await boxOf(stage(page))
    const px = box.x + box.width * 0.3
    const py = box.y + box.height / 2
    await page.mouse.move(px, py)
    const before = await offset(page)
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -120)
    await page.keyboard.up('Control')
    await expect.poll(() => zoomPct(page)).toBeGreaterThan(100)
    const s = await scaleNow(page)
    const after = await offset(page)
    // the diagram point under the pointer: (p - offset) / scale — the same before and after (± rounding)
    expect(Math.abs((px - box.x - after.x) / s - (px - box.x - before.x) / 1)).toBeLessThan(3)
    // a plain wheel pans
    const panned = await offset(page)
    await page.mouse.wheel(150, 0)
    await expect.poll(async () => (await offset(page)).x).toBeLessThan(panned.x - 100)
    // Esc closes; focus is back on the key that opened it
    await page.keyboard.press('Escape')
    await expect(viewer(page)).toHaveCount(0)
    await expect(key).toBeFocused()
  })

  test('double-click opens it; drag pans; the minimap follows the view, jumps on a click, M toggles it', async ({ page }) => {
    await setup(page)
    await page.locator('#main .mermaid-view__svg').dblclick()
    await opened(page)
    const mini = page.getByTestId('viewer-minimap')
    // everything fits: no minimap
    await expect(mini).toBeHidden()
    await page.keyboard.press('1')
    await expect(page.getByTestId('viewer-zoom')).toHaveText('Zoom 100 %')
    await expect(mini).toBeVisible()
    const rect = page.getByTestId('viewer-minimap-view')
    await expect(rect).toBeVisible()
    const r0 = await boxOf(rect)
    const o0 = await offset(page)
    // drag the canvas to the left: the drawing follows the pointer, the rectangle moves right
    const box = await boxOf(stage(page))
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 - 320, box.y + box.height / 3, { steps: 8 })
    await page.mouse.up()
    await expect.poll(async () => (await offset(page)).x).toBeLessThan(o0.x - 200)
    await expect.poll(async () => (await boxOf(rect)).x).toBeGreaterThan(r0.x)
    // arrow keys pan too (Shift = bigger steps)
    const o1 = await offset(page)
    await page.keyboard.press('ArrowLeft')
    await expect.poll(async () => (await offset(page)).x).toBeGreaterThan(o1.x)
    // a click on the minimap's far right end centres the view there
    const m = await boxOf(page.locator('.dv-mini__map'))
    const o2 = await offset(page)
    await page.mouse.click(m.x + m.width - 3, m.y + m.height / 2)
    await expect.poll(async () => (await offset(page)).x).toBeLessThan(o2.x - 200)
    const r2 = await boxOf(rect)
    expect(r2.x + r2.width).toBeGreaterThan(m.x + m.width - 6)
    // dragging the rectangle back to the left end pans with it
    await page.mouse.move(r2.x + r2.width / 2, r2.y + r2.height / 2)
    await page.mouse.down()
    await page.mouse.move(m.x + 2, r2.y + r2.height / 2, { steps: 6 })
    await page.mouse.up()
    await expect.poll(async () => (await boxOf(rect)).x).toBeLessThan(m.x + 4)
    // M (and the key) hides and shows it
    await stage(page).focus()
    await page.keyboard.press('m')
    await expect(mini).toBeHidden()
    await expect(page.getByTestId('viewer-minimap-toggle')).toHaveAttribute('aria-pressed', 'false')
    await page.getByTestId('viewer-minimap-toggle').click()
    await expect(mini).toBeVisible()
    // double-click on the canvas zooms in around the point, Shift + double-click out
    const z = await zoomPct(page)
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
    await expect.poll(() => zoomPct(page)).toBe(z * 2)
    await page.keyboard.down('Shift')
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
    await page.keyboard.up('Shift')
    await expect.poll(() => zoomPct(page)).toBe(z)
    await page.keyboard.press('Escape')
    await expect(viewer(page)).toHaveCount(0)
  })

  test('the scaled chip and the block menu open it; Download SVG saves the diagram', async ({ page }) => {
    await setup(page)
    const chip = page.getByTestId('mermaid-scaled')
    await expect(chip).toBeVisible()
    await expect(chip).toHaveText(/^Scaled \d+ % · Open$/)
    await chip.click()
    await opened(page)
    const [file] = await Promise.all([page.waitForEvent('download'), viewer(page).getByRole('button', { name: 'Download SVG' }).click()])
    expect(file.suggestedFilename()).toBe('flowchart.svg')
    const svg = readFileSync((await file.path())!, 'utf8')
    expect(svg).toMatch(/^<\?xml[^>]*>\s*<svg/)
    expect(svg).toContain('Release notes')
    expect(svg).toMatch(/<svg[^>]*width="\d+"/)
    await page.keyboard.press('Escape')
    await expect(viewer(page)).toHaveCount(0)
    // the block menu (⋮⋮)
    await page.locator('#main .mermaid-view').hover()
    await page.locator('.block-handle__grip').click()
    await page.getByRole('menu').getByRole('menuitem', { name: 'Open large' }).click()
    await opened(page)
    await expect(page.getByTestId('viewer-plate')).toHaveText(/Flowchart/)
    await page.keyboard.press('Escape')
    await expect(viewer(page)).toHaveCount(0)
  })

  test('a chart block opens large: drawn again for the canvas, Download SVG with the theme written in', async ({ page }) => {
    await setup(page)
    const block = page.locator('#main .chart-block')
    await block.hover()
    await block.getByTestId('chart-open').click()
    await opened(page)
    await expect(page.getByRole('dialog', { name: /Chart · Bar — Revenue by month/ })).toBeVisible()
    await expect(page.getByTestId('viewer-plate')).toHaveText(/Chart · Bar/)
    // drawn for the canvas: wider than the block's own chart, and it fits at 100 %
    const inline = await block.locator('svg.ch-svg').first().evaluate((s) => (s as SVGSVGElement).viewBox.baseVal.width)
    const large = await page.locator('.dv__content > svg').evaluate((s) => (s as SVGSVGElement).viewBox.baseVal.width)
    expect(large).toBeGreaterThan(inline)
    // (its plot takes the canvas' height: it fits at about 100 %)
    await expect.poll(() => zoomPct(page)).toBeGreaterThanOrEqual(90)
    await expect(page.locator('.dv__content')).toContainText('Apr')
    const [file] = await Promise.all([page.waitForEvent('download'), viewer(page).getByRole('button', { name: 'Download SVG' }).click()])
    expect(file.suggestedFilename()).toBe('revenue-by-month.svg')
    const svg = readFileSync((await file.path())!, 'utf8')
    expect(svg).toContain('<svg')
    expect(svg).not.toContain('var(--')
    await page.keyboard.press('Escape')
    await expect(viewer(page)).toHaveCount(0)
    // double-click on the chart and the chart menu open it as well
    await block.locator('svg.ch-svg').first().dblclick()
    await opened(page)
    await page.keyboard.press('Escape')
    await expect(viewer(page)).toHaveCount(0)
    await block.hover()
    await block.getByRole('button', { name: 'Chart menu' }).click()
    await page.getByRole('menuitem', { name: 'Open large' }).click()
    await opened(page)
    await page.keyboard.press('Escape')
    await expect(viewer(page)).toHaveCount(0)
  })

  test('read-only copies: a shared page opens it too; a presentation slide has no key (the deck owns the keys)', async ({ page }) => {
    const id = await setup(page)
    await page.locator('.tb').getByRole('button', { name: 'Share', exact: true }).click()
    const link = await page.getByRole('dialog').getByRole('textbox', { name: 'Share link' }).inputValue()
    expect(link).toMatch(/#\/s\/[\w-]+$/)
    await page.keyboard.press('Escape')
    await page.goto(link)
    const shared = page.locator('.shv__doc')
    await expect(shared.locator('.mermaid-view__svg svg')).toBeVisible({ timeout: 20_000 })
    const key = shared.getByTestId('mermaid-open')
    await key.click()
    await opened(page)
    await expect(page.getByTestId('viewer-plate')).toHaveText(/Diagram · Flowchart/)
    await page.keyboard.press('Escape')
    await expect(viewer(page)).toHaveCount(0)
    await expect(key).toBeFocused()
    await shared.locator('.chart-block').hover()
    await shared.getByTestId('chart-open').click()
    await opened(page)
    await page.keyboard.press('Escape')
    await expect(viewer(page)).toHaveCount(0)
    // the presentation: no key, no chip, a double-click turns no viewer up
    await gotoPage(page, id)
    await page.locator('.tb').getByRole('button', { name: 'Present' }).click()
    const deck = page.locator('.pres[role="dialog"]')
    await expect(deck).toBeVisible()
    // past the title slide
    await page.keyboard.press('ArrowRight')
    await expect(deck.locator('.mermaid-view__svg svg')).toBeVisible({ timeout: 20_000 })
    await expect(deck.getByTestId('mermaid-open')).toBeHidden()
    await expect(deck.getByTestId('mermaid-scaled')).toBeHidden()
    await expect(deck.getByTestId('chart-open')).toBeHidden()
    await deck.locator('.mermaid-view__svg').dblclick()
    await expect(viewer(page)).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(deck).toHaveCount(0)
  })

  test("a database's Chart view opens large", async ({ page }) => {
    await openApp(page)
    await gotoPage(page, await pageIdByTitle(page, 'Projects'))
    const db = page.locator('#main section.db').first()
    await db.getByRole('tab').filter({ hasText: 'Chart' }).click()
    await expect(db).toHaveAttribute('data-view', 'chart')
    await db.getByTestId('dbchart-open').click()
    await opened(page)
    await expect(page.getByTestId('viewer-plate')).toHaveText(/Chart · /)
    await expect(page.getByRole('dialog', { name: /Projects/ })).toBeVisible()
    await expect(page.locator('.dv__content')).toContainText('In progress')
    await page.keyboard.press('Escape')
    await expect(viewer(page)).toHaveCount(0)
    await expect(db.getByTestId('dbchart-open')).toBeFocused()
  })

  test('German strings', async ({ page }) => {
    await setup(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await expect(page.getByTestId('mermaid-open')).toHaveAttribute('aria-label', 'Groß öffnen')
    await expect(page.getByTestId('mermaid-scaled')).toHaveText(/^Verkleinert \d+ % · Öffnen$/)
    await page.getByTestId('mermaid-open').click()
    await opened(page)
    await expect(page.getByTestId('viewer-plate')).toHaveText(/Schaubild · Flussdiagramm/)
    const dialog = viewer(page)
    await expect(dialog.getByRole('button', { name: 'Vergrößern' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Verkleinern' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /In das Fenster einpassen/ })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Als SVG herunterladen' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Schließen' })).toBeVisible()
    await expect(dialog.getByTestId('viewer-minimap-toggle')).toHaveAttribute('aria-label', 'Minikarte')
    await expect(page.locator('.dv__foot')).toContainText('Verschieben')
    await page.keyboard.press('Escape')
    await expect(viewer(page)).toHaveCount(0)
  })

  test('390 px: full screen, every key in reach, no horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await setup(page)
    await page.getByTestId('mermaid-open').click()
    await opened(page)
    const dialog = page.getByRole('dialog')
    const d = await boxOf(dialog)
    expect(Math.round(d.x)).toBe(0)
    expect(Math.round(d.width)).toBe(390)
    for (const name of [/Zoom in/, /Zoom out/, /Fit to the window/, /Actual size/, /Minimap/, /Download SVG/, /Close/]) {
      const b = await boxOf(dialog.getByRole('button', { name }))
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.x + b.width).toBeLessThanOrEqual(390)
      expect(b.height).toBeGreaterThanOrEqual(36)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await dialog.getByRole('button', { name: /Zoom in/ }).click()
    await expect.poll(() => zoomPct(page)).toBeGreaterThan(0)
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(viewer(page)).toHaveCount(0)
  })

  test('dark theme: Carbon colours, re-drawn when the theme changes while open', async ({ page }) => {
    await setup(page)
    await wsEval(page, (s) => s.updateSettings({ theme: 'dark' }))
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.getByTestId('mermaid-open').click()
    await opened(page)
    const fill = () => page.locator('.dv__content .node rect').first().evaluate((r) => getComputedStyle(r).fill)
    // Carbon surface #181816 behind the nodes, the stage on Carbon's #111110
    await expect.poll(fill).toBe('rgb(24, 24, 22)')
    await expect(stage(page)).toHaveCSS('background-color', 'rgb(17, 17, 16)')
    const id = await page.locator('.dv__content > svg').getAttribute('id')
    await wsEval(page, (s) => s.updateSettings({ theme: 'light' }))
    await expect.poll(fill).toBe('rgb(250, 249, 245)')
    expect(await page.locator('.dv__content > svg').getAttribute('id')).not.toBe(id)
    await page.keyboard.press('Escape')
    await expect(viewer(page)).toHaveCount(0)
  })
})
