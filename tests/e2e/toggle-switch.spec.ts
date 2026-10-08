/**
 * The industrial toggle switch ("Kippschalter", ui/controls.tsx Switch): a screwed plate with a lever that
 * leans toward the O (off) or the lamp (on). The control contract stays a plain switch — role, name,
 * aria-checked, disabled, click / Space / Enter — while the art is one hidden SVG; the hardware colours
 * come from the theme (Paper / Carbon), the screws are fastened from a stable seed.
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, wsEval, gotoPage, pageIdByTitle } from './fixtures'
import { screwAngles } from '../../src/app/ui/screws'

const openSettings = (page: Page, tab: string) => page.evaluate((tab) => (window as any).__one.ui.getState().openModal({ type: 'settings', tab }), tab) // eslint-disable-line @typescript-eslint/no-explicit-any

/** A CSS colour (any syntax, incl. color-mix results) → [r, g, b] via a 1×1 canvas. */
async function rgbOf(page: Page, css: string): Promise<number[]> {
  return page.evaluate((css) => {
    const c = document.createElement('canvas')
    c.width = c.height = 1
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#000'
    ctx.fillStyle = css
    ctx.fillRect(0, 0, 1, 1)
    return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3))
  }, css)
}
/** A token resolved on <html> (e.g. '--plate') → its computed colour string. */
async function token(page: Page, name: string): Promise<string> {
  return page.evaluate((name) => {
    const el = document.createElement('span')
    el.style.color = `var(${name})`
    document.body.append(el)
    const v = getComputedStyle(el).color
    el.remove()
    return v
  }, name)
}
const lum = ([r, g, b]: number[]) => {
  const f = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const contrast = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
const centreX = async (loc: Locator) => {
  const b = (await loc.boundingBox())!
  return b.x + b.width / 2
}

test('screwAngles: deterministic, steps of 15°, in range, different per seed', () => {
  expect(screwAngles('spellcheck', 2)).toEqual(screwAngles('spellcheck', 2))
  expect(screwAngles('', 2)).toEqual([45, 15])
  expect(screwAngles('spellcheck', 2)).toEqual([-30, -45])
  expect(screwAngles('enabled', 4)).toEqual([15, 30, 75, -90])
  expect(screwAngles('spellcheck', 2)).not.toEqual(screwAngles('enabled', 2))
  for (const seed of ['a', 'Spell check', 'Rechtschreibprüfung', 'x'.repeat(200)]) {
    const a = screwAngles(seed, 4)
    expect(a).toHaveLength(4)
    for (const v of a) {
      expect(Number.isInteger(v)).toBe(true)
      expect(Math.abs(v % 15)).toBe(0)
      expect(v).toBeGreaterThanOrEqual(-90)
      expect(v).toBeLessThanOrEqual(75)
    }
  }
})

test('Spell check keeps role, name, description and state; click, Space and Enter flip it; one hidden SVG inside', async ({ page }) => {
  await openApp(page)
  await openSettings(page, 'general')
  const dialog = page.getByRole('dialog')
  const sw = dialog.getByRole('switch', { name: 'Spell check' })
  await expect(sw).toHaveAccessibleName('Spell check')
  await expect(sw).toHaveAccessibleDescription(/misspelled/i)
  await expect(sw).toHaveAttribute('aria-checked', 'true')
  await expect(sw).toHaveClass(/\bswitch\b/)
  await expect(sw).not.toHaveClass(/switch--sm/)
  const box = (await sw.boundingBox())!
  expect(Math.round(box.width)).toBe(52)
  expect(Math.round(box.height)).toBe(26)
  const art = sw.locator('svg.switch__art')
  await expect(art).toHaveCount(1)
  await expect(art).toHaveAttribute('aria-hidden', 'true')
  expect(await art.evaluate((el) => el.textContent)).toBe('')

  await sw.click()
  await expect(sw).toHaveAttribute('aria-checked', 'false')
  expect(await wsEval(page, (s) => s.settings.spellcheck)).toBe(false)
  await sw.focus()
  await page.keyboard.press('Space')
  await expect(sw).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Enter')
  await expect(sw).toHaveAttribute('aria-checked', 'false')
  expect(await wsEval(page, (s) => s.settings.spellcheck)).toBe(false)

  // screws are seeded with a stable key, not the translated label
  const slots = () => sw.locator('svg.switch__art > g[transform*="rotate"]').evaluateAll((els) => els.map((e) => e.getAttribute('transform')))
  const en = await slots()
  expect(en.join(' ')).toContain('rotate(-30)')
  await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
  const de = page.getByRole('dialog').getByRole('switch', { name: 'Rechtschreibprüfung' })
  await expect(de).toBeVisible()
  expect(await de.locator('svg.switch__art > g[transform*="rotate"]').evaluateAll((els) => els.map((e) => e.getAttribute('transform')))).toEqual(en)
})

test('the lever leans toward the lamp when on and toward the O when off; the lamp lights in the signal colour after the throw', async ({ page }) => {
  await openApp(page)
  await openSettings(page, 'general')
  const sw = page.getByRole('dialog').getByRole('switch', { name: 'Spell check' })
  const ball = sw.locator('.switch__ball')
  const nut = sw.locator('.switch__nut')
  const lens = sw.locator('.switch__lens')
  const signal = await rgbOf(page, await token(page, '--signal'))
  const dark = await rgbOf(page, await token(page, '--toggle-window'))
  const fill = async () => rgbOf(page, await lens.evaluate((el) => getComputedStyle(el).fill))

  expect(await centreX(ball)).toBeGreaterThan((await centreX(nut)) + 3)
  await expect.poll(fill).toEqual(signal)
  // the ball sits above the nut (a leaning lever, not a slider)
  expect((await ball.boundingBox())!.y).toBeLessThan((await nut.boundingBox())!.y)

  await sw.click()
  await expect.poll(async () => (await centreX(ball)) < (await centreX(nut)) - 3).toBe(true)
  await expect.poll(fill).toEqual(dark)
  await sw.click()
  await expect.poll(async () => (await centreX(ball)) > (await centreX(nut)) + 3).toBe(true)
  await expect.poll(fill).toEqual(signal)
})

test('label text flips it; dense places use sm (40 × 20)', async ({ page }) => {
  await openApp(page, '#/graph')
  const sw = page.getByRole('switch', { name: 'Hierarchy' })
  const before = await sw.getAttribute('aria-checked')
  await page.locator('.graph-toggle', { hasText: 'Hierarchy' }).locator('span').click()
  await expect(sw).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true')
  await expect(sw).toHaveClass(/switch--sm/)
  const box = (await sw.boundingBox())!
  expect(Math.round(box.width)).toBe(40)
  expect(Math.round(box.height)).toBe(20)
})

test('screws: fastened the same way after a reload, differently per switch', async ({ page }) => {
  await openApp(page)
  await openSettings(page, 'ai')
  const mem = page.getByTestId('memory-settings')
  const slots = (name: string) =>
    mem
      .getByRole('switch', { name })
      .locator('svg.switch__art > g[transform*="rotate"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('transform')))
  const use = await slots('Use the memory')
  const log = await slots('Keep a usage log')
  expect(use).toHaveLength(2)
  expect(use).not.toEqual(log)
  expect(use.join(' ')).toContain(`rotate(${screwAngles('enabled', 1)[0]})`)
  await reloadApp(page)
  await openSettings(page, 'ai')
  expect(await slots('Use the memory')).toEqual(use)
  expect(await slots('Keep a usage log')).toEqual(log)
})

test('disabled: half opacity, not-allowed cursor, no flip', async ({ page }) => {
  await openApp(page)
  await openSettings(page, 'ai')
  const mem = page.getByTestId('memory-settings')
  const use = mem.getByRole('switch', { name: 'Use the memory' })
  if ((await use.getAttribute('aria-checked')) === 'true') await use.click()
  await expect(use).toHaveAttribute('aria-checked', 'false')
  const prop = mem.getByRole('switch', { name: 'Propose memories after AI-terminal tasks' })
  await expect(prop).toBeDisabled()
  await expect(prop).toHaveAttribute('aria-checked', 'false')
  expect(await prop.evaluate((el) => getComputedStyle(el).opacity)).toBe('0.5')
  expect(await prop.evaluate((el) => getComputedStyle(el).cursor)).toBe('not-allowed')
  await prop.click({ force: true })
  await expect(prop).toHaveAttribute('aria-checked', 'false')
})

test('page menu rows stay menuitemcheckbox; the face inside is a hidden sm switch', async ({ page }) => {
  await openApp(page)
  const id = await pageIdByTitle(page, 'Welcome to One')
  await gotoPage(page, id)
  await page.locator('header.tb button[aria-haspopup="menu"]').last().click()
  const row = page.getByRole('menuitemcheckbox', { name: 'Full width' })
  await expect(row).toBeVisible()
  const face = row.locator('.switch.switch--sm[aria-hidden="true"][data-checked]')
  await expect(face).toHaveCount(1)
  await expect(page.getByRole('switch')).toHaveCount(0)
  const was = await row.getAttribute('aria-checked')
  await row.focus()
  await page.keyboard.press('Enter')
  const now = was === 'true' ? 'false' : 'true'
  await expect(row).toHaveAttribute('aria-checked', now)
  await expect(face).toHaveAttribute('data-checked', now)
  expect(await wsEval(page, (s, id) => s.pages[id].settings.fullWidth, id)).toBe(now === 'true')
})

test('reduced motion: state only — no throw, no give, no delayed lamp (on and off)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openApp(page)
  await openSettings(page, 'ai')
  const mem = page.getByTestId('memory-settings')
  const on = mem.getByRole('switch', { name: 'Keep a usage log' })
  if ((await on.getAttribute('aria-checked')) !== 'true') await on.click()
  const off = mem.getByRole('switch', { name: 'Use the memory' })
  if ((await off.getAttribute('aria-checked')) !== 'false') await off.click()
  for (const sw of [on, off]) {
    for (const part of ['.switch__lever', '.switch__give', '.switch__lens', '.switch__lamp']) {
      expect(await sw.locator(part).evaluate((el) => getComputedStyle(el).transitionProperty), part).toBe('none')
    }
    await sw.hover()
    expect(await sw.evaluate((el) => getComputedStyle(el).getPropertyValue('--sw-give').trim())).toBe('0deg')
  }
  const ball = off.locator('.switch__ball')
  const nut = off.locator('.switch__nut')
  expect(await centreX(ball)).toBeLessThan(await centreX(nut))
  await off.click()
  await expect(off).toHaveAttribute('aria-checked', 'true')
  expect(await centreX(ball)).toBeGreaterThan(await centreX(nut))
})

test.describe('touch 390 × 844', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('a taller hit area around the plate', async ({ page }) => {
    await openApp(page)
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
    await openSettings(page, 'general')
    const sw = page.getByRole('dialog').getByRole('switch', { name: 'Spell check' })
    await sw.scrollIntoViewIfNeeded()
    const hit = await sw.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const at = (dy: number) => document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2 + dy)?.closest('[role=switch]') === el
      return [at(-16), at(16)]
    })
    expect(hit).toEqual([true, true])
  })
})

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`hardware colours (${scheme})`, () => {
    test.use({ colorScheme: scheme })
    test('plate, screws, lever and lamp glass stand out', async ({ page }) => {
      await openApp(page)
      await openSettings(page, 'general')
      const sw = page.getByRole('dialog').getByRole('switch', { name: 'Spell check' })
      await expect(sw).toBeVisible()
      const plate = await rgbOf(page, await sw.evaluate((el) => getComputedStyle(el).backgroundColor))
      const edge = await rgbOf(page, await sw.evaluate((el) => getComputedStyle(el).borderTopColor))
      const style = (sel: string, prop: 'fill' | 'stroke') => sw.locator(sel).first().evaluate((el, prop) => getComputedStyle(el)[prop], prop)
      const screw = await rgbOf(page, await style('.switch__screw', 'fill'))
      const slot = await rgbOf(page, await style('.switch__slot', 'stroke'))
      const ball = await rgbOf(page, await style('.switch__ball', 'fill'))
      const lever = await rgbOf(page, await style('.switch__shaft', 'stroke'))
      const lensEdge = await rgbOf(page, await style('.switch__lens', 'stroke'))
      for (const surface of ['--surface', '--bg', '--surface-2', '--surface-3']) {
        expect(contrast(edge, await rgbOf(page, await token(page, surface))), `edge on ${surface}`).toBeGreaterThanOrEqual(3)
      }
      expect(contrast(ball, plate), 'ball').toBeGreaterThanOrEqual(4.5)
      expect(contrast(lever, plate), 'lever').toBeGreaterThanOrEqual(3)
      expect(contrast(slot, screw), 'slot on the head').toBeGreaterThanOrEqual(3)
      expect(contrast(lensEdge, plate), 'lamp glass edge').toBeGreaterThanOrEqual(1.8)
      if (scheme === 'dark') {
        expect(lum(plate)).toBeLessThan(0.1)
        expect(lum(ball)).toBeGreaterThan(0.5)
        expect(contrast(screw, plate), 'screw head on the plate').toBeGreaterThanOrEqual(2.5)
      } else {
        expect(lum(plate)).toBeGreaterThan(0.55)
        expect(lum(plate)).toBeLessThan(0.8)
      }
    })
  })
}
