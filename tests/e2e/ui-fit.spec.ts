/**
 * Nothing overflows: popovers and dialogs keep their content inside (rows wrap, keys shrink, the panel
 * stays on screen) at 1024 × 768 and 390 × 844, in English and German; form popovers have a resize grip
 * (drag, arrow keys, remembered per device, double-click resets); the app-wide text size (Settings →
 * Appearance, Workspace → Overview → Display) scales the whole app and never the landing page.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, wsEval, mockClaude, createPage, gotoPage, editorOf, doc, para, pageIdByTitle, MOD } from './fixtures'

/* ------------------------------------------------------------------ the audit */

/**
 * Everything inside an open popover / dialog stays inside its box and on screen. A strip that scrolls
 * sideways on purpose (overflow-x: auto inside the panel) is fine; ellipsis is fine.
 */
function audit(extra: string): string[] {
  const vw = document.documentElement.clientWidth
  const vh = document.documentElement.clientHeight
  const out: string[] = []
  const shown = (el: Element) => {
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') return false
    const r = el.getBoundingClientRect()
    return r.width > 1 && r.height > 1
  }
  const name = (el: Element) => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''
    const txt = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24)
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${txt ? ` "${txt}"` : ''}`
  }
  const clipOf = (el: Element, root: Element) => {
    let a = el.parentElement
    while (a && a !== root) {
      const cs = getComputedStyle(a)
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') return a
      a = a.parentElement
    }
    return root
  }
  const roots = [...document.querySelectorAll(`[data-popover=""], .modal${extra ? `, ${extra}` : ''}`)].filter(shown)
  if (!roots.length) return ['nothing open']
  for (const root of roots) {
    const rr = root.getBoundingClientRect()
    const rn = name(root)
    if (root.matches('[data-popover], .modal') && (rr.left < -0.5 || rr.top < -0.5 || rr.right > vw + 0.5 || rr.bottom > vh + 0.5))
      out.push(`${rn}: off screen (${Math.round(rr.left)},${Math.round(rr.top)} → ${Math.round(rr.right)},${Math.round(rr.bottom)})`)
    if (root.scrollWidth > root.clientWidth + 1 && getComputedStyle(root).overflowX !== 'visible') out.push(`${rn}: scrolls sideways (${root.scrollWidth} > ${root.clientWidth})`)
    for (const el of root.querySelectorAll('*')) {
      if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue
      if (!shown(el) || getComputedStyle(el).position === 'fixed') continue
      const clip = clipOf(el, root)
      const ccs = getComputedStyle(clip)
      if (clip !== root && (ccs.overflowX === 'auto' || ccs.overflowX === 'scroll')) continue
      const cr = clip.getBoundingClientRect()
      const left = cr.left + clip.clientLeft
      const right = left + clip.clientWidth
      const er = el.getBoundingClientRect()
      if (er.right > right + 1.5 || er.left < left - 1.5) out.push(`${rn}: ${name(el)} runs past ${name(clip).slice(0, 30)} (${Math.round(er.left)}–${Math.round(er.right)} vs ${Math.round(left)}–${Math.round(right)})`)
      else if (er.right > vw + 1 || er.left < -1) out.push(`${rn}: ${name(el)} outside the viewport`)
    }
  }
  return [...new Set(out)]
}

/** Audit what is open now in English, then switch the open UI to German and audit again. */
async function fits(page: Page, what: string, extra = '') {
  await page.waitForTimeout(220)
  expect(await page.evaluate(audit, extra), `${what} (EN)`).toEqual([])
  await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
  await page.waitForTimeout(220)
  expect(await page.evaluate(audit, extra), `${what} (DE)`).toEqual([])
  await wsEval(page, (s) => s.updateSettings({ language: 'en' }))
  for (let i = 0; i < 3; i++) await page.keyboard.press('Escape')
  await page.waitForTimeout(120)
}

const db = (page: Page) => page.locator('#main section.db').first()
const toolbar = (page: Page) => db(page).getByRole('toolbar', { name: 'Database toolbar' })

async function projects(page: Page) {
  await gotoPage(page, await pageIdByTitle(page, 'Projects'))
  await db(page).getByRole('tab', { name: /All projects/ }).click()
  await expect(db(page)).toHaveAttribute('data-view', 'table')
}

async function more(page: Page, item: RegExp) {
  await toolbar(page).getByRole('button', { name: 'More' }).click()
  await page.getByRole('menuitem', { name: item }).click()
}

/** Two colour rules, the second with two conditions (the case from the report: the rows ran off the panel). */
async function colourRules(page: Page): Promise<Locator> {
  await more(page, /^Colour rules/)
  const panel = page.locator('.db-rcpanel')
  for (const props of [['Status'], ['Status', 'Owner']]) {
    await panel.getByRole('button', { name: 'Add colour rule' }).click()
    const rule = panel.locator('.db-rcrule').last()
    for (const p of props) {
      await rule.getByRole('button', { name: 'Add condition' }).click()
      await page.getByRole('menuitem', { name: p }).first().click()
    }
  }
  return panel
}

async function filters(page: Page): Promise<Locator> {
  await toolbar(page).getByRole('button', { name: 'Filter' }).click()
  const pop = page.locator('.db-filterpop')
  for (const p of ['Priority', 'Timeline', 'Tags']) {
    await pop.getByRole('button', { name: 'Add filter rule' }).last().click()
    await page.getByRole('menuitem', { name: p }).first().click()
  }
  await pop.getByRole('button', { name: 'Add filter group' }).click()
  return pop
}

function cellOf(page: Page, title: string, index: number): Locator {
  const row = db(page).locator('.dbt-body .dbt-row[role="row"]', { has: page.locator('.db-rowtitle__text', { hasText: new RegExp(`^${title}$`) }) })
  return row.locator('[role="gridcell"]').nth(index)
}

async function columnIndex(page: Page, name: string): Promise<number> {
  const heads = await db(page).getByRole('columnheader').allInnerTexts()
  const i = heads.findIndex((h) => h.trim().toLowerCase().startsWith(name.toLowerCase()))
  expect(i, `column ${name}`).toBeGreaterThanOrEqual(0)
  return i
}

async function databasePopovers(page: Page) {
  await openApp(page)
  await projects(page)
  await filters(page)
  await fits(page, 'filter')
  await toolbar(page).getByRole('button', { name: 'Sort' }).click()
  await fits(page, 'sort')
  await toolbar(page).getByRole('button', { name: 'Group' }).click()
  await fits(page, 'group')
  await toolbar(page).getByRole('button', { name: 'Properties' }).click()
  await fits(page, 'properties')
  await toolbar(page).getByRole('button', { name: 'More' }).click()
  await fits(page, 'more menu')
  await more(page, /^Layout/)
  await fits(page, 'layout')
  await colourRules(page)
  await fits(page, 'colour rules')
  await more(page, /^Record types/)
  await fits(page, 'record types')
}

async function cellsAndMenus(page: Page, phone: boolean) {
  await openApp(page)
  await projects(page)
  await db(page).getByRole('columnheader', { name: /Status/ }).first().click()
  await fits(page, 'property menu')
  for (const col of ['Status', 'Priority', 'Owner', 'Timeline', 'Tags']) {
    await cellOf(page, 'Website relaunch', await columnIndex(page, col)).click()
    await fits(page, `${col} cell editor`)
  }
  const id = await createPage(page, { title: 'Fit check', content: doc(para('Alpha line of text for the check.'), para('')) })
  await gotoPage(page, id)
  const ed = editorOf(page, id)
  await ed.locator('p').last().click()
  await page.keyboard.type('/')
  await expect(page.locator('[data-popover]').first()).toBeVisible()
  await fits(page, 'slash menu')
  await page.keyboard.press('Backspace')
  if (!phone) {
    await ed.locator('p', { hasText: 'Alpha' }).hover()
    await page.locator('.block-handle-wrap .block-handle__grip').click()
    await fits(page, 'block menu')
  }
  await ed.locator('p', { hasText: 'Alpha' }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Shift+Home')
  await page.locator('[aria-label="Formatting"]').first().getByRole('button', { name: /^Ask AI$/ }).click()
  await expect(page.locator('.ai-panel')).toBeVisible()
  await fits(page, 'AI menu')
}

async function settingsAndWorkspace(page: Page) {
  await openApp(page)
  for (const tab of ['general', 'appearance', 'ai', 'data', 'mcp']) {
    await page.evaluate((tab) => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings', tab }), tab)
    await expect(page.locator('.modal').first()).toBeVisible()
    await fits(page, `settings → ${tab}`)
  }
  for (const sec of ['', '/look', '/people', '/blocks', '/data']) {
    await page.evaluate((h) => (window.location.hash = h), `#/workspace${sec}`)
    await expect(page.getByTestId('workspace-page')).toBeVisible()
    await fits(page, `workspace${sec || '/overview'}`, '.wsp__main')
  }
  await page.evaluate(() => (window.location.hash = '#/kit/records'))
  await page.getByRole('button', { name: /^New record type/ }).first().click()
  await fits(page, 'kit: record type editor', '.kt')
}

test.describe('nothing overflows · 1024 × 768', () => {
  test.use({ viewport: { width: 1024, height: 768 } })

  test('database toolbar popovers', async ({ page }) => {
    await databasePopovers(page)
  })

  test('cell editors, property menu, slash / block / AI menus', async ({ page }) => {
    await mockClaude(page, () => 'ok')
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-api03-e2e-fit-000000000000000000' }))
    await cellsAndMenus(page, false)
  })

  test('settings, workspace and building blocks', async ({ page }) => {
    await settingsAndWorkspace(page)
  })
})

test.describe('nothing overflows · 390 × 844', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('database toolbar popovers', async ({ page }) => {
    await databasePopovers(page)
  })

  test('cell editors, property menu, slash and AI menus', async ({ page }) => {
    await mockClaude(page, () => 'ok')
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-api03-e2e-fit-000000000000000000' }))
    await cellsAndMenus(page, true)
  })

  test('settings, workspace and building blocks; no resize grip on a phone', async ({ page }) => {
    await settingsAndWorkspace(page)
    await projects(page)
    await toolbar(page).getByRole('button', { name: 'Filter' }).click()
    await expect(page.locator('.db-filterpop')).toBeVisible()
    await expect(page.locator('.pop-grip')).toHaveCount(0)
  })
})

test.describe('the biggest text size still fits', () => {
  test('1280 × 720 and 390 × 844 at XL', async ({ page }) => {
    // every sweep at two sizes: about a minute on its own, so it gets the slow-test budget
    test.slow()
    await page.addInitScript(() => localStorage.setItem('one.textScale', '4'))
    await page.setViewportSize({ width: 1280, height: 720 })
    await databasePopovers(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await databasePopovers(page)
    // the workspace look with its Carbon colours shown (the widest form there is)
    await page.evaluate(() => (window.location.hash = '#/workspace/look'))
    await page.getByRole('switch', { name: 'Set Carbon colours separately' }).click()
    await fits(page, 'workspace/look (XL, phone)', '.wsp__main')
  })

  test('code areas at XL: the agent job, a code block bar, the One Script editor (1280 × 720 and 390 × 844)', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('one.textScale', '4'))
    await openApp(page)
    const id = await createPage(page, { title: 'Code at XL', content: doc({ type: 'codeBlock', attrs: { language: 'json' }, content: [{ type: 'text', text: '{\n  "a": [1, 2],\n  "b": true,\n}' }] }) })
    await wsEval(page, (s) => {
      const now = Date.now()
      s.upsertScript({ id: 'scXl', name: 'XL', code: 'let n = 1\nfor t in [1, 2] {\n  t.set(Priority: "High"\n  notify("x")\n}\n', kind: 'script', createdAt: now, updatedAt: now })
    })
    for (const size of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size)
      const at = `${size.width}`
      await page.evaluate(() => (window.location.hash = '#/agents'))
      await page.getByRole('button', { name: /Blank/ }).first().click()
      await page.getByTestId('agx-job').locator('textarea').fill('## Job\n1. Use create_row for [EVERY ITEM] and keep [THE LIST] short.')
      await fits(page, `agent job (XL, ${at})`)
      await gotoPage(page, id)
      await page.locator('#main .code-block code').click()
      await fits(page, `code block (XL, ${at})`, '#main .code-block')
      await page.evaluate(() => (window.location.hash = '#/scripts/scXl'))
      await expect(page.locator('.sc-code__input')).toBeVisible()
      await fits(page, `One Script editor (XL, ${at})`, '.sc-code')
    }
  })
})

/* ------------------------------------------------------------------ resize grip */

/** Size of the open filter popover (rounded). */
const sizeOf = async (pop: Locator) => {
  const b = (await pop.boundingBox())!
  return { w: Math.round(b.width), h: Math.round(b.height) }
}

/** The same size, give or take a pixel of rounding. */
const near = (a: { w: number; h: number }, b: { w: number; h: number }) => Math.abs(a.w - b.w) <= 1 && Math.abs(a.h - b.h) <= 1

test.describe('resize grip', () => {
  test('drag and keys make a form popover bigger (never smaller than it is); the size is remembered; double-click resets', async ({ page }) => {
    await openApp(page)
    await projects(page)
    await toolbar(page).getByRole('button', { name: 'Filter' }).click()
    const pop = page.locator('.db-filterpop')
    await expect(pop).toBeVisible()
    await pop.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
    const natural = await sizeOf(pop)
    const grip = page.getByRole('button', { name: 'Resize' })
    await expect(grip).toBeVisible()
    // the grip sits on the panel's bottom-right corner
    const pb = (await pop.boundingBox())!
    const gb = (await grip.boundingBox())!
    expect(Math.abs(gb.x + gb.width - (pb.x + pb.width))).toBeLessThanOrEqual(1)
    expect(Math.abs(gb.y + gb.height - (pb.y + pb.height))).toBeLessThanOrEqual(1)

    // drag: the top-left corner stays, the panel grows with the pointer
    await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2)
    await page.mouse.down()
    await page.mouse.move(gb.x + gb.width / 2 + 120, gb.y + gb.height / 2 + 80, { steps: 6 })
    await page.mouse.up()
    const dragged = await sizeOf(pop)
    expect(dragged.w).toBeGreaterThanOrEqual(natural.w + 118)
    expect(dragged.h).toBeGreaterThanOrEqual(natural.h + 78)
    const moved = (await pop.boundingBox())!
    expect(Math.round(moved.x)).toBe(Math.round(pb.x))
    expect(Math.round(moved.y)).toBe(Math.round(pb.y))
    // the filter still works inside the bigger panel
    await expect(pop.getByRole('button', { name: 'Add filter rule' })).toBeVisible()

    // never smaller than its natural size
    const g2 = (await grip.boundingBox())!
    await page.mouse.move(g2.x + 7, g2.y + 7)
    await page.mouse.down()
    await page.mouse.move(g2.x - 600, g2.y - 400, { steps: 6 })
    await page.mouse.up()
    const smallest = await sizeOf(pop)
    expect(near(smallest, natural), `${JSON.stringify(smallest)} ≈ ${JSON.stringify(natural)}`).toBe(true)

    // keys: → 16 px wider, Shift + ↓ 64 px taller
    await grip.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Shift+ArrowDown')
    const keyed = await sizeOf(pop)
    expect(near(keyed, { w: smallest.w + 16, h: smallest.h + 64 }), JSON.stringify(keyed)).toBe(true)
    expect(near(JSON.parse((await page.evaluate(() => localStorage.getItem('one.popover.size:db-filter')))!), keyed)).toBe(true)

    // remembered on this device: after a reload the panel opens at that size
    await page.keyboard.press('Escape')
    await expect(pop).toHaveCount(0)
    await reloadApp(page)
    await projects(page)
    await toolbar(page).getByRole('button', { name: 'Filter' }).click()
    await expect(pop).toBeVisible()
    await expect.poll(async () => near(await sizeOf(pop), keyed)).toBe(true)

    // double-click: back to its natural size, nothing remembered
    await grip.dblclick()
    await expect.poll(async () => near(await sizeOf(pop), natural)).toBe(true)
    expect(await page.evaluate(() => localStorage.getItem('one.popover.size:db-filter'))).toBeNull()
    // a click on the grip does not close the panel; Escape still does
    await grip.click()
    await expect(pop).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(pop).toHaveCount(0)
  })

  test('a resized panel stays on screen', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('one.popover.size:db-colors', JSON.stringify({ w: 3000, h: 3000 })))
    await openApp(page)
    await projects(page)
    await colourRules(page)
    const panel = page.locator('.db-rcpanel')
    await expect(panel).toBeVisible()
    const vp = page.viewportSize()!
    const b = (await panel.boundingBox())!
    expect(b.x).toBeGreaterThanOrEqual(0)
    expect(b.y).toBeGreaterThanOrEqual(0)
    expect(b.x + b.width).toBeLessThanOrEqual(vp.width)
    expect(b.y + b.height).toBeLessThanOrEqual(vp.height)
    expect(await page.evaluate(audit, '')).toEqual([])
  })
})

/* ------------------------------------------------------------------ text size */

/** Font size (px) a token resolves to on this page. */
const tokenPx = (page: Page, token: string) =>
  page.evaluate((token) => {
    const el = document.createElement('span')
    el.style.fontSize = `var(${token})`
    document.body.append(el)
    const px = parseFloat(getComputedStyle(el).fontSize)
    el.remove()
    return px
  }, token)

test.describe('text size', () => {
  test('a stepped fader with four stops scales the whole app, live, in both places; kept on this device', async ({ page }) => {
    await openApp(page)
    expect(await tokenPx(page, '--text-md')).toBeCloseTo(14, 2)
    const body = () => page.evaluate(() => Math.round(parseFloat(getComputedStyle(document.body).fontSize) * 100) / 100)
    const sidebar = () => page.locator('.sb').getByRole('button', { name: /^Search/ }).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    const sidebar1 = await sidebar()

    await page.keyboard.press(`${MOD}+,`)
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('tab', { name: /Appearance/ }).click()
    const fader = dialog.getByRole('slider', { name: 'Text size' })
    await expect(fader).toHaveAttribute('min', '1')
    await expect(fader).toHaveAttribute('max', '4')
    await expect(fader).toHaveValue('1')
    await expect(dialog.getByTestId('text-size')).toContainText('STANDARD · 100 % · 14 PX')
    for (const stop of ['Standard', 'M', 'L', 'XL']) await expect(dialog.locator('.tsize__name', { hasText: new RegExp(`^${stop}$`) })).toHaveCount(1)

    // keys step through the stops; the app re-sizes at once
    await fader.focus()
    await page.keyboard.press('ArrowRight')
    await expect(fader).toHaveValue('2')
    expect(await body()).toBe(15)
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(fader).toHaveValue('4')
    await expect(dialog.getByTestId('text-size-readout')).toHaveText('XL · 121 % · 17 PX')
    expect(await body()).toBe(17)
    expect(await tokenPx(page, '--text-md')).toBeCloseTo(17, 2)
    await expect(page.locator('html')).toHaveAttribute('data-text-size', '4')
    // raw sizes in the app's CSS follow too (not only the tokens)
    expect(await sidebar()).toBeGreaterThan(sidebar1)
    expect(await page.evaluate(() => localStorage.getItem('one.textScale'))).toBe('4')
    // the setting is this device's, not the workspace's
    expect(await wsEval(page, (s) => JSON.stringify(s.settings))).not.toMatch(/textScale|textSize/)

    // the workspace page shows the same control with the same value; a stop's name sets it
    await page.keyboard.press('Escape')
    await page.evaluate(() => (window.location.hash = '#/workspace'))
    const ws = page.getByTestId('ws-display')
    await expect(ws.getByRole('slider', { name: 'Text size' })).toHaveValue('4')
    await ws.locator('.tsize__name', { hasText: /^L$/ }).click()
    await expect(ws.getByRole('slider', { name: 'Text size' })).toHaveValue('3')
    expect(await body()).toBe(16)

    // kept after a reload — applied before the first paint
    await reloadApp(page)
    expect(await body()).toBe(16)
    await page.evaluate(() => (window.location.hash = '#/workspace'))
    await expect(page.getByTestId('ws-display').getByRole('slider', { name: 'Text size' })).toHaveValue('3')

    // German labels
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await expect(page.getByTestId('ws-display').getByRole('slider', { name: 'Schriftgröße' })).toBeVisible()

    // back to Standard: today's sizes
    await page.getByTestId('ws-display').locator('.tsize__name', { hasText: /^Standard$/ }).click()
    expect(await body()).toBe(14)
    expect(await page.evaluate(() => localStorage.getItem('one.textScale'))).toBeNull()
  })

  test('every font size in the app CSS follows the text size (tokens or calc(… * var(--text-scale)))', () => {
    // features/coding converts with its next change (owned elsewhere while this landed); a presentation's
    // slides are sized to the screen (container units), not to the text size
    const PENDING = ['src/app/features/present/present.css']
    const files: string[] = []
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n)
        if (statSync(p).isDirectory()) walk(p)
        else if (p.endsWith('.css')) files.push(p)
      }
    }
    walk('src/app')
    expect(files.length).toBeGreaterThan(50)
    const raw: string[] = []
    for (const f of files) {
      if (PENDING.some((p) => f.replace(/\\/g, '/').endsWith(p))) continue
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const value = line.match(/(?:^|[\s;{])font(?:-size)?:([^;]*)/)?.[1]
          if (!value || value.includes('var(--text-scale)')) return
          // a px fallback inside var(--x, 13px) is the variable's business
          if (/\d(\.\d+)?px/.test(value.replace(/var\([^()]*\)/g, ''))) raw.push(`${f}:${i + 1}: ${line.trim()}`)
        })
    }
    expect(raw, 'raw px font sizes (write calc(<n>px * var(--text-scale)) or a --text-* token)').toEqual([])
  })

  test('the landing page is never scaled', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('one.textScale', '4'))
    await openApp(page)
    expect(await tokenPx(page, '--text-md')).toBeCloseTo(17, 2)
    await page.goto('./?skip')
    await expect(page.locator('#site')).toBeVisible()
    expect(await tokenPx(page, '--text-md')).toBe(14)
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--text-scale').trim())).toBe('1')
  })
})
