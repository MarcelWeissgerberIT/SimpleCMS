/**
 * WERKZEUGE / TOOLS — the sidebar's tool strip (shell/sidebar/Tools.tsx): one Tab stop and ← / → / Home / End along the
 * keycaps (WAI-ARIA toolbar), the readout at rest (Patchbay NEW, open fuses, proposals) and under the pointer / the focus,
 * the keys' accessible names, NAMES (today's labelled rows) kept on this device, viewers (no Templates / Import, the
 * Patchbay LED in neutral ink), Preflight taking the Agents count, the labelled grid on a coarse pointer, and the phone
 * drawer's folded TOOLS row (the LED sum of what waits, a tap unfolds the grid, kept on this device). Review fixes: one row
 * of keys from 220 px up, the readout's short words (never cut: two lines where they do not fit), the singular, the corner
 * marks clear of the glyph, the coarse grid's short key names whole at every text size.
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, preflightOff, wsEval } from './fixtures'
import { mock1, seedPatchbay } from '../fixtures/patchbay'
import { seedMirror, seedRuns, waitPreflight } from './helpers/preflightStory.mjs'

const strip = (page: Page) => page.locator('.sb .sb-tools__keys[role="toolbar"]')
const readout = (page: Page) => page.locator('.sb .sb-tools__readout')
const focusedName = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '')

test.describe('the tool strip', () => {
  test('one Tab stop, the arrows move along; the open tool is the stop; NAMES comes next', async ({ page }) => {
    await openApp(page)
    const keys = strip(page).getByRole('button')
    await expect(keys).toHaveCount(8)
    await expect(strip(page)).toHaveAttribute('aria-label', 'Tools')
    // the daily rows, then the strip as ONE stop
    await page.locator('.sb-nav').getByRole('button', { name: /^Today/ }).focus()
    await page.keyboard.press('Tab')
    expect(await focusedName(page)).toBe('Agenda')
    expect(await strip(page).locator('[tabindex="0"]').count()).toBe(1)
    await page.keyboard.press('ArrowRight')
    expect(await focusedName(page)).toBe('Graph')
    await page.keyboard.press('End')
    expect(await focusedName(page)).toBe('Import')
    await page.keyboard.press('ArrowRight')
    expect(await focusedName(page)).toBe('Agenda')
    await page.keyboard.press('ArrowLeft')
    expect(await focusedName(page)).toBe('Import')
    await page.keyboard.press('Home')
    expect(await focusedName(page)).toBe('Agenda')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Show tools with names' })).toBeFocused()
    // Enter opens the key's tool; it is the strip's stop now (and the open page)
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#\/graph/)
    const graph = strip(page).getByRole('button', { name: 'Graph' })
    await expect(graph).toHaveAttribute('aria-current', 'page')
    await expect(graph).toHaveAttribute('tabindex', '0')
    await expect(strip(page).getByRole('button', { name: 'Agenda' })).toHaveAttribute('tabindex', '-1')
    // the keys keep their names inside the sidebar (the tests' and the tour's way in)
    for (const name of [/^Agenda/, /^Graph/, /^Agents/, /^Scripts/, /^Patchbay/, /^Building blocks/, /^Templates/, /^Import/]) await expect(page.locator('.sb').getByRole('button', { name })).toHaveCount(1)
  })

  test('the readout: NEW at rest until the Patchbay was opened, then TOOLS; the key under the pointer or the focus speaks', async ({ page }) => {
    await openApp(page)
    await expect(readout(page)).toHaveText('Patchbay · NEW')
    await expect(page.getByTestId('patchbay-nav')).toHaveAccessibleName('Patchbay, New')
    await page.evaluate(() => (window.location.hash = '#/patchbay'))
    await expect(page.getByTestId('patchbay-page')).toBeVisible()
    await page.evaluate(() => (window.location.hash = '#/'))
    await expect(readout(page)).toHaveText('Tools')
    await strip(page).getByRole('button', { name: 'Scripts' }).hover()
    await expect(readout(page)).toHaveText('Scripts')
    await page.mouse.move(900, 500)
    await expect(readout(page)).toHaveText('Tools')
    await strip(page).getByRole('button', { name: 'Graph' }).focus()
    await expect(readout(page)).toHaveText('Graph')
  })

  test('open fuses lead the readout; the key carries the LED, its name says it; a viewer gets no Templates / Import and a neutral LED', async ({ page }) => {
    await openApp(page)
    await seedPatchbay(page, mock1())
    await expect(page.getByTestId('patchbay-nav-led')).toContainText('1')
    // the readout's own short words (a count, NEW only while nothing is counted); the key's name says it in full
    await expect(readout(page)).toHaveText('Patchbay · 1 open')
    await expect(page.getByTestId('patchbay-nav')).toHaveAccessibleName('Patchbay, 1 open fuse, New')
    await page.evaluate(() => (window as unknown as { __one: { cloud: { useCloud: { setState: (s: unknown) => void } } } }).__one.cloud.useCloud.setState({ readOnly: true }))
    await expect(strip(page).getByRole('button')).toHaveCount(6)
    await expect(page.locator('.sb').getByRole('button', { name: /^Import/ })).toHaveCount(0)
    await expect(page.locator('.sb').getByRole('button', { name: /^Templates/ })).toHaveCount(0)
    await expect(page.getByTestId('patchbay-nav-led')).toHaveAttribute('data-viewer', 'true')
  })

  test('NAMES: the labelled rows, kept on this device', async ({ page }) => {
    await openApp(page)
    const names = page.getByRole('button', { name: 'Show tools with names' })
    await expect(names).toHaveAttribute('aria-pressed', 'false')
    await expect(names).toHaveText('Names')
    await names.click()
    await expect(names).toHaveAttribute('aria-pressed', 'true')
    await expect(strip(page)).toHaveCount(0)
    const list = page.locator('.sb .sb-tools__list')
    await expect(list.locator('.sb-navrow__label')).toHaveText(['Agenda', 'Graph', 'Agents', 'Scripts', 'Patchbay', 'Building blocks', 'Templates', 'Import'])
    await expect(page.getByTestId('patchbay-nav')).toHaveClass(/sb-navrow/)
    await reloadApp(page)
    await expect(page.getByRole('button', { name: 'Show tools with names' })).toHaveAttribute('aria-pressed', 'true')
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('one.shell.tools') ?? '{}'))).toMatchObject({ mode: 'list' })
  })

  test('the Agents count sits in its key while Preflight is off — Preflight takes it while on', async ({ page }) => {
    await preflightOff(page)
    await page.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
    await openApp(page)
    await waitPreflight(page)
    await seedRuns(page, await seedMirror(page))
    const agents = strip(page).getByRole('button', { name: /^Agents/ })
    await expect(agents.getByTestId('agents-review')).toContainText('08')
    await expect(agents).toHaveAccessibleName('Agents, 8 proposals waiting for review')
    // proposals lead the readout while no fuse is open (its short words)
    await expect(readout(page)).toHaveText('Agents · 8 to review')
  })

  test('one proposal: the key, its badge and the readout say it in the singular', async ({ page }) => {
    await preflightOff(page)
    await page.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
    await openApp(page)
    await waitPreflight(page)
    const m = await seedMirror(page)
    await page.evaluate((m) => {
      const now = Date.now()
      const pageId = Object.values(m.rows)[0]
      const change = { id: 'c1', n: 1, kind: 'update_row', status: 'pending', pageId, databaseId: m.dbId, title: 'NL-201', props: [{ propId: m.props.comments, name: 'Kommentare', type: 'number', before: 0, after: 4, intent: { kind: 'value', value: 4 } }] }
      const run = { id: 'r-one', agentId: m.mirrorId, runner: 'browser', trigger: { type: 'schedule', detail: 'schedule 07:30' }, startedAt: now - 60_000, endedAt: now - 30_000, status: 'staged', summary: '', steps: [], staged: [change] }
      ;(window as unknown as { __onePreflight: { seedRuns: (r: unknown[]) => void } }).__onePreflight.seedRuns([run])
    }, m)
    const agents = strip(page).getByRole('button', { name: /^Agents/ })
    await expect(agents).toHaveAccessibleName('Agents, 1 proposal waiting for review')
    await expect(agents.getByTestId('agents-review')).toHaveAttribute('title', '1 proposal waiting for review')
    await expect(readout(page)).toHaveText('Agents · 1 to review')
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await expect(strip(page).getByRole('button', { name: /^Agenten/ })).toHaveAccessibleName('Agenten, 1 Vorschlag wartet auf Prüfung')
    await expect(readout(page)).toHaveText('Agenten · 1 prüfen')
  })

  test('ONE row of keys at every sidebar width from 220 px, also at the biggest text; the readout is never cut — where its widest text does not fit, the head keeps two lines and pointing moves nothing', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('one.textScale', '4'))
    await openApp(page)
    await seedPatchbay(page, mock1())
    await expect(page.getByTestId('patchbay-nav-led')).toContainText('1')
    const head = page.locator('.sb .sb-tools__head')
    const rows = () => strip(page).locator('.sb-tools__cell').evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size)
    const whole = () => readout(page).evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1)
    for (const lang of ['en', 'de']) {
      for (const w of [264, 240, 220]) {
        await wsEval(page, (s, a) => s.updateSettings({ sidebarWidth: a.w, language: a.lang }), { w, lang })
        await expect.poll(rows, `${lang} ${w}`).toBe(1)
        const keys = await strip(page).getByRole('button').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width))
        for (const k of keys) expect(k).toBeGreaterThanOrEqual(23)
        expect(await whole(), `${lang} ${w} at rest`).toBe(true)
      }
    }
    // German at 220 px: "SCHALTPLAN · 1 OFFEN" needs two lines — kept while the pointer reads the other keys
    await expect(head).toHaveAttribute('data-lines', '2')
    await expect(readout(page)).toHaveText('Schaltplan · 1 offen')
    const h = (await head.boundingBox())!.height
    const keyTop = (await strip(page).boundingBox())!.y
    for (const name of [/^Agenda/, /^Bausteine/, /^Importieren/, /^Schaltplan/]) {
      await strip(page).getByRole('button', { name }).hover()
      expect(await whole()).toBe(true)
      expect((await head.boundingBox())!.height).toBe(h)
      expect((await strip(page).boundingBox())!.y).toBe(keyTop)
    }
    // at 264 px it fits one line again
    await page.mouse.move(900, 500)
    await wsEval(page, (s) => s.updateSettings({ sidebarWidth: 264 }))
    await expect(head).not.toHaveAttribute('data-lines', /.*/)
    await wsEval(page, (s) => s.updateSettings({ language: 'en' }))
  })

  test('the marks in a key’s corners keep clear of its glyph: the LED rides the key’s top edge, NEW sits bottom left', async ({ page }) => {
    await openApp(page)
    await seedPatchbay(page, mock1())
    const key = page.getByTestId('patchbay-nav')
    const icon = (await key.locator('.sb-tool__icon svg').boundingBox())!
    const meet = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5
    const led = (await page.getByTestId('patchbay-nav-led').boundingBox())!
    const dot = (await page.getByTestId('patchbay-nav-new').boundingBox())!
    expect(meet(icon, led)).toBe(false)
    expect(meet(icon, dot)).toBe(false)
    expect(meet(led, dot)).toBe(false)
    // the readout above the keys is not covered by the LED's tab
    const text = (await readout(page).boundingBox())!
    expect(meet(text, led)).toBe(false)
  })
})

test.describe('the tool strip on a coarse pointer', () => {
  test.use({ viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true })

  test('a labelled 4 × 2 grid of ≥ 44 px keys (no hover to read)', async ({ page }) => {
    await openApp(page)
    const sb = page.locator('aside.sb')
    if ((await sb.getAttribute('data-state')) !== 'docked') await page.getByRole('button', { name: 'Open sidebar' }).tap()
    const keys = strip(page).getByRole('button')
    await expect(keys).toHaveCount(8)
    const boxes = await keys.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ top: Math.round(r.top), h: r.height })))
    for (const b of boxes) expect(b.h).toBeGreaterThanOrEqual(44)
    expect(new Set(boxes.map((b) => b.top)).size).toBe(2)
    await expect(strip(page).locator('.sb-tool__label').first()).toBeVisible()
    await expect(strip(page).locator('.sb-tool__label').first()).toHaveText('Agenda')
  })

  test('every key’s name whole at every text size in both languages — never "…"; a name on two lines grows both rows alike', async ({ page }) => {
    await openApp(page)
    if ((await page.locator('aside.sb').getAttribute('data-state')) !== 'docked') await page.getByRole('button', { name: 'Open sidebar' }).tap()
    const check = () =>
      strip(page).evaluate((el) => {
        const labels = [...el.querySelectorAll<HTMLElement>('.sb-tool__label')]
        const cut = labels.filter((l) => l.scrollWidth > l.clientWidth + 1 || l.scrollHeight > l.clientHeight + 1).map((l) => l.textContent)
        const rows = new Map<number, Set<number>>()
        for (const k of el.querySelectorAll<HTMLElement>('.sb-tool')) {
          const r = k.getBoundingClientRect()
          const set = rows.get(Math.round(r.top)) ?? new Set<number>()
          set.add(Math.round(r.height))
          rows.set(Math.round(r.top), set)
        }
        const heights = [...rows.values()].flatMap((x) => [...x])
        return { cut, heights: [...new Set(heights)] }
      })
    for (const step of ['1', '4']) {
      await page.evaluate((v) => localStorage.setItem('one.textScale', v), step)
      await reloadApp(page)
      for (const lang of ['en', 'de']) {
        await wsEval(page, (s, a) => s.updateSettings({ language: a }), lang)
        await expect(strip(page).locator('.sb-tool__label').first()).toBeVisible()
        const r = await check()
        expect(r.cut, `${lang} step ${step}`).toEqual([])
        expect(r.heights, `${lang} step ${step}`).toHaveLength(1)
      }
    }
    // the short names on the keys, the full ones in their accessible names
    await expect(strip(page).getByRole('button', { name: 'Bausteine' })).toHaveCount(1)
    await wsEval(page, (s) => s.updateSettings({ language: 'en' }))
    await expect(strip(page).locator('.sb-tool__label').nth(5)).toHaveText('Blocks')
    await expect(strip(page).getByRole('button', { name: 'Building blocks' })).toHaveCount(1)
  })
})

test.describe('the tool strip in the phone drawer', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })

  test('TOOLS is one folded 36 px row with the LED sum of what waits — never a count of the tools; a tap unfolds the labelled grid, kept on this device', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: 'Open sidebar' }).tap()
    const fold = page.locator('.sb .sb-tools__fold')
    await expect(fold).toHaveAttribute('aria-expanded', 'false')
    expect(Math.round((await fold.boundingBox())!.height)).toBe(36)
    // nothing waits, the Patchbay is new: NEW
    await expect(fold).toHaveAccessibleName('Tools, New')
    await expect(fold.locator('.sb-tools__newtag')).toHaveText('New')
    await expect(strip(page)).toHaveCount(0)
    await expect(page.getByTestId('patchbay-nav')).toHaveCount(0)
    // an open fuse: the LED and its sum
    await seedPatchbay(page, mock1())
    if ((await page.locator('aside.sb').getAttribute('data-state')) !== 'drawer-open') await page.getByRole('button', { name: 'Open sidebar' }).tap()
    await expect(fold).toHaveAccessibleName('Tools, 1 waiting')
    await expect(fold.locator('.sb-tools__sum')).toHaveText('01')
    await expect(fold.locator('.sb-tools__sum .led')).toHaveClass(/led--on/)
    // a viewer cannot act on a fuse: neutral ink
    await page.evaluate(() => (window as unknown as { __one: { cloud: { useCloud: { setState: (s: unknown) => void } } } }).__one.cloud.useCloud.setState({ readOnly: true }))
    await expect(fold.locator('.sb-tools__sum')).toHaveAttribute('data-viewer', '')
    await expect(fold.locator('.sb-tools__sum .led')).not.toHaveClass(/led--on/)
    await page.evaluate(() => (window as unknown as { __one: { cloud: { useCloud: { setState: (s: unknown) => void } } } }).__one.cloud.useCloud.setState({ readOnly: false }))
    // a tap: the labelled grid, the Patchbay key with its LED
    await fold.tap()
    await expect(fold).toHaveAttribute('aria-expanded', 'true')
    await expect(fold).toHaveAttribute('aria-controls', 'sb-tools-body')
    await expect(strip(page).getByRole('button')).toHaveCount(8)
    await expect(strip(page).locator('.sb-tool__label').first()).toBeVisible()
    await expect(page.getByTestId('patchbay-nav-led')).toContainText('1')
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('one.shell.tools') ?? '{}'))).toMatchObject({ mode: 'keys', phoneOpen: true })
    await reloadApp(page)
    await page.getByRole('button', { name: 'Open sidebar' }).tap()
    await expect(strip(page).getByRole('button')).toHaveCount(8)
    await page.locator('.sb .sb-tools__fold').tap()
    await expect(strip(page)).toHaveCount(0)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('one.shell.tools') ?? '{}'))).toMatchObject({ phoneOpen: false })
  })
})
