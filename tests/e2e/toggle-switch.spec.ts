/**
 * The glass rocker switch ("Glas-Wippe", ui/controls.tsx Switch): a brushed-steel bezel held by four slotted
 * screws, a glass rocker engraved 0 (left, off) and I (right, on) that tilts toward the pressed side, an LED under
 * the glass that lights it when on. The control contract stays a plain switch — role, name, aria-checked,
 * disabled, click / Space / Enter, the focus ring — while the art is hidden spans; the sizes follow the text size;
 * the LED is the signal colour unless this device picked another (Settings → Appearance → Switch LED).
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, wsEval, gotoPage, pageIdByTitle } from './fixtures'
import { screwAngles } from '../../src/app/ui/screws'

const openSettings = (page: Page, tab: string) => page.evaluate((tab) => (window as any).__one.ui.getState().openModal({ type: 'settings', tab }), tab) // eslint-disable-line @typescript-eslint/no-explicit-any

/** A CSS colour (any syntax, incl. color-mix / oklch results) → [r, g, b] via a 1×1 canvas. */
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
/** A token resolved on <html> (e.g. '--toggle-window') → its computed colour as rgb. */
async function token(page: Page, name: string): Promise<number[]> {
  const css = await page.evaluate((name) => {
    const el = document.createElement('span')
    el.style.color = `var(${name})`
    document.body.append(el)
    const v = getComputedStyle(el).color
    el.remove()
    return v
  }, name)
  return rgbOf(page, css)
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
const near = (a: number[], b: number[], tol = 3) => a.every((v, i) => Math.abs(v - b[i]) <= tol)
/** The screws' slot angles, in corner order (tl, tr, bl, br). */
const slots = (sw: Locator) => sw.locator('.switch__screw').evaluateAll((els) => els.map((e) => (e as HTMLElement).style.getPropertyValue('--screw-rot')))
/** Heights of the two glass halves: the raised half is nearer, so it looks taller (the perspective). */
const halves = (sw: Locator) =>
  sw.evaluate((el) => {
    const h = (sel: string) => el.querySelector(sel)!.getBoundingClientRect().height
    return { o: h('.switch__half--o'), i: h('.switch__half--i') }
  })
const opacity = (loc: Locator, pseudo?: string) => loc.evaluate((el, pseudo) => Number(getComputedStyle(el, pseudo).opacity), pseudo ?? null)
const htmlVar = (page: Page, name: string) => page.evaluate((name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(), name)

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

test('Spell check keeps role, name, description and state; click, Space and Enter flip it; the art is hidden spans', async ({ page }) => {
  await openApp(page)
  await openSettings(page, 'general')
  const dialog = page.getByRole('dialog')
  const sw = dialog.getByRole('switch', { name: 'Spell check' })
  await expect(sw).toHaveAccessibleName('Spell check')
  await expect(sw).toHaveAccessibleDescription(/misspelled/i)
  await expect(sw).toHaveAttribute('aria-checked', 'true')
  expect(await sw.evaluate((el) => el.tagName)).toBe('BUTTON')
  await expect(sw).toHaveClass(/\bswitch\b/)
  await expect(sw).not.toHaveClass(/switch--sm/)
  // the rocker's 120 : 64 proportions at about the old switch's area
  const box = (await sw.boundingBox())!
  expect(Math.round(box.width)).toBe(52)
  expect(Math.round(box.height)).toBe(28)
  const art = sw.locator('.switch__art')
  await expect(art).toHaveCount(1)
  await expect(art).toHaveAttribute('aria-hidden', 'true')
  expect(await art.evaluate((el) => el.textContent)).toBe('')
  await expect(art.locator('.switch__half--o .switch__o')).toHaveCount(1)
  await expect(art.locator('.switch__half--i .switch__i')).toHaveCount(1)
  await expect(art.locator('.switch__screw')).toHaveCount(4)

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
  const en = await slots(sw)
  expect(en).toEqual(screwAngles('spellcheck', 4).map((a) => `${a}deg`))
  await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
  const de = page.getByRole('dialog').getByRole('switch', { name: 'Rechtschreibprüfung' })
  await expect(de).toBeVisible()
  expect(await slots(de)).toEqual(en)
})

test('keyboard: Tab reaches the switch with a visible focus ring; Space and Enter flip it', async ({ page }) => {
  await openApp(page)
  await openSettings(page, 'general')
  const sw = page.getByRole('dialog').getByRole('switch', { name: 'Spell check' })
  await expect(sw).toBeVisible()
  for (let i = 0; i < 30 && !(await sw.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab')
  await expect(sw).toBeFocused()
  expect(await sw.evaluate((el) => el.matches(':focus-visible'))).toBe(true)
  // the orange ring (--focus-ring: surface gap + 2 px of signal) around the bezel
  const signal = await token(page, '--signal')
  const shadow = await sw.evaluate((el) => getComputedStyle(el).boxShadow)
  const colours = await Promise.all((shadow.match(/rgba?\([^)]*\)/g) ?? []).map((c) => rgbOf(page, c)))
  expect(colours.some((c) => near(c, signal)), shadow).toBe(true)
  const before = await sw.getAttribute('aria-checked')
  await page.keyboard.press('Space')
  await expect(sw).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true')
  await page.keyboard.press('Enter')
  await expect(sw).toHaveAttribute('aria-checked', before!)
  await expect(sw).toBeFocused()
})

test('the rocker tilts toward the pressed side: 0 down when off, I down when on; the LED lights the glass after the throw', async ({ page }) => {
  await openApp(page)
  await openSettings(page, 'general')
  const sw = page.getByRole('dialog').getByRole('switch', { name: 'Spell check' })
  const glow = sw.locator('.switch__glow')
  const lit = sw.locator('.switch__half--o')
  await expect(sw).toHaveAttribute('aria-checked', 'true')
  // on: I pressed (further away, smaller), the floor glows, the glass is lit
  await expect.poll(async () => {
    const h = await halves(sw)
    return h.o > h.i + 0.3
  }).toBe(true)
  await expect.poll(() => opacity(glow)).toBe(1)
  await expect.poll(() => opacity(lit, '::before')).toBe(1)
  // the glow is the LED colour = the signal colour by default
  const signal = await token(page, '--signal')
  const glowCss = await glow.evaluate((el) => getComputedStyle(el).backgroundImage)
  expect(near(await rgbOf(page, glowCss.match(/rgba?\([^)]*\)/)![0]), signal), glowCss).toBe(true)

  await sw.click()
  await expect(sw).toHaveAttribute('aria-checked', 'false')
  await expect.poll(async () => {
    const h = await halves(sw)
    return h.i > h.o + 0.3
  }).toBe(true)
  await expect.poll(() => opacity(glow)).toBe(0)
  await expect.poll(() => opacity(lit, '::before')).toBe(0)
  // the engraved legends turn from the LED's dark tone to the unlit grey
  const legend = await token(page, '--toggle-legend')
  await expect.poll(async () => near(await rgbOf(page, await sw.locator('.switch__i').evaluate((el) => getComputedStyle(el).backgroundColor)), legend)).toBe(true)

  await sw.click()
  await expect.poll(async () => {
    const h = await halves(sw)
    return h.o > h.i + 0.3
  }).toBe(true)
  await expect.poll(() => opacity(glow)).toBe(1)
})

test('label text flips it; dense places use sm (40 × 22)', async ({ page }) => {
  await openApp(page, '#/graph')
  const sw = page.getByRole('switch', { name: 'Hierarchy' })
  const before = await sw.getAttribute('aria-checked')
  await page.locator('.graph-toggle', { hasText: 'Hierarchy' }).locator(':scope > span').click()
  await expect(sw).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true')
  await expect(sw).toHaveClass(/switch--sm/)
  const box = (await sw.boundingBox())!
  expect(Math.round(box.width)).toBe(40)
  expect(Math.round(box.height)).toBe(22)
})

test('the switches grow with the text size (Standard → XL), sm and md, and stay in their rows', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('ts-set')) {
      sessionStorage.setItem('ts-set', '1')
      localStorage.setItem('one.textScale', '4')
    }
  })
  await openApp(page)
  await openSettings(page, 'general')
  const sw = page.getByRole('dialog').getByRole('switch', { name: 'Spell check' })
  const scale = 17 / 14
  const box = (await sw.boundingBox())!
  expect(box.width).toBeCloseTo(52 * scale, 0)
  expect(box.height).toBeCloseTo(28 * scale, 0)
  // the inside follows too: the bezel frame and the screws
  const frame = await sw.locator('.switch__well').evaluate((el) => el.getBoundingClientRect().left - el.parentElement!.parentElement!.getBoundingClientRect().left)
  expect(frame).toBeCloseTo(1 + 4 * scale, 0)
  const screw = (await sw.locator('.switch__screw').first().boundingBox())!
  expect(screw.width).toBeCloseTo(3.5 * scale, 0)
  // the row: the switch sits inside the field, level with its label
  const row = sw.locator('xpath=ancestor::*[contains(@class, "st-field")][1]')
  const rb = (await row.boundingBox())!
  expect(box.x + box.width).toBeLessThanOrEqual(rb.x + rb.width + 0.5)
  expect(box.y).toBeGreaterThanOrEqual(rb.y - 0.5)

  await page.keyboard.press('Escape')
  await page.evaluate(() => (window.location.hash = '#/graph'))
  const sm = page.getByRole('switch', { name: 'Hierarchy' })
  const sb = (await sm.boundingBox())!
  expect(sb.width).toBeCloseTo(40 * scale, 0)
  expect(sb.height).toBeCloseTo(22 * scale, 0)

  // back to Standard: the old sizes at once
  await page.evaluate(() => {
    localStorage.removeItem('one.textScale')
    document.documentElement.style.removeProperty('--text-scale')
  })
  await expect.poll(async () => Math.round((await sm.boundingBox())!.width)).toBe(40)
})

test('Switch LED: the primary colour by default, a picked colour on <html>, kept after a reload, both settings places, EN + DE', async ({ page }) => {
  await openApp(page)
  // the default follows the signal colour
  expect(await page.evaluate(() => localStorage.getItem('one.switchLed'))).toBeNull()
  await expect(page.locator('html')).not.toHaveAttribute('data-switch-led', /.+/)
  expect(near(await token(page, '--switch-led'), await token(page, '--signal'))).toBe(true)

  await openSettings(page, 'appearance')
  const dialog = page.getByRole('dialog')
  const group = dialog.getByRole('radiogroup', { name: 'Switch LED' })
  await expect(group.getByRole('radio')).toHaveCount(6)
  await expect(group.getByRole('radio', { name: 'Primary colour (default)' })).toHaveAttribute('aria-checked', 'true')
  for (const name of ['Green', 'Blue', 'Yellow', 'Red', 'Purple']) await expect(group.getByRole('radio', { name })).toHaveAttribute('aria-checked', 'false')
  await expect(group).toHaveAccessibleDescription(/only on this device/i)
  const demoOn = dialog.getByTestId('switch-led').locator('.switch[data-checked="true"] .switch__glow')

  await group.getByRole('radio', { name: 'Green' }).click()
  await expect(group.getByRole('radio', { name: 'Green' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('html')).toHaveAttribute('data-switch-led', 'green')
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--switch-led-pick').trim())).toBe('var(--switch-led-green)')
  expect(await page.evaluate(() => localStorage.getItem('one.switchLed'))).toBe('green')
  const green = await token(page, '--switch-led')
  expect(near(green, await token(page, '--switch-led-green'))).toBe(true)
  expect(near(green, await token(page, '--signal'), 30)).toBe(false)
  expect(green[1]).toBeGreaterThan(green[0] + 40) // a green
  // every switch lights in it: the demo next to the label …
  const glowCss = await demoOn.evaluate((el) => getComputedStyle(el).backgroundImage)
  expect(near(await rgbOf(page, glowCss.match(/rgba?\([^)]*\)|oklch\([^)]*\)|color\([^)]*\)/)![0]), green), glowCss).toBe(true)
  // … the setting is this device's, not the workspace's
  expect(await wsEval(page, (s) => JSON.stringify(s.settings))).not.toMatch(/switchLed/)

  // arrow keys move along the LEDs (one radio group, roving focus)
  await group.getByRole('radio', { name: 'Green' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(group.getByRole('radio', { name: 'Blue' })).toHaveAttribute('aria-checked', 'true')
  await expect(group.getByRole('radio', { name: 'Blue' })).toBeFocused()
  await expect(page.locator('html')).toHaveAttribute('data-switch-led', 'blue')

  // kept after a reload — on <html> before anything renders
  await reloadApp(page)
  await expect(page.locator('html')).toHaveAttribute('data-switch-led', 'blue')
  expect(near(await token(page, '--switch-led'), await token(page, '--switch-led-blue'))).toBe(true)

  // the workspace page shows the same control with the same value
  await page.evaluate(() => (window.location.hash = '#/workspace'))
  const ws = page.getByTestId('ws-display').getByRole('radiogroup', { name: 'Switch LED' })
  await expect(ws.getByRole('radio', { name: 'Blue' })).toHaveAttribute('aria-checked', 'true')
  await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
  const de = page.getByTestId('ws-display').getByRole('radiogroup', { name: 'LED der Schalter' })
  await expect(de.getByRole('radio', { name: 'Blau' })).toHaveAttribute('aria-checked', 'true')
  await de.getByRole('radio', { name: 'Primärfarbe (Standard)' }).click()
  await expect(page.locator('html')).not.toHaveAttribute('data-switch-led', /.+/)
  expect(await page.evaluate(() => localStorage.getItem('one.switchLed'))).toBeNull()
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--switch-led-pick'))).toBe('')

  // the primary colour follows the workspace look's signal
  await wsEval(page, (s) => s.setLook({ preset: 'blueprint', colors: { paper: '#edf0f2', ink: '#0e1a2b', signal: '#2759db' }, fonts: { ui: 'archivo', text: 'ui', headings: 'condensed' }, corners: 'standard', updatedAt: 0, updatedBy: null }))
  await expect.poll(async () => near(await token(page, '--switch-led'), await rgbOf(page, '#2759db'), 12)).toBe(true)
  expect(near(await token(page, '--switch-led'), await token(page, '--signal'))).toBe(true)
  expect(await htmlVar(page, '--switch-led')).not.toBe('')
})

test('screws: fastened the same way after a reload, differently per switch', async ({ page }) => {
  await openApp(page)
  await openSettings(page, 'ai')
  const mem = page.getByTestId('memory-settings')
  const use = await slots(mem.getByRole('switch', { name: 'Use the memory' }))
  const log = await slots(mem.getByRole('switch', { name: 'Keep a usage log' }))
  expect(use).toHaveLength(4)
  expect(use).not.toEqual(log)
  expect(use).toEqual(screwAngles('enabled', 4).map((a) => `${a}deg`))
  await reloadApp(page)
  await openSettings(page, 'ai')
  expect(await slots(mem.getByRole('switch', { name: 'Use the memory' }))).toEqual(use)
  expect(await slots(mem.getByRole('switch', { name: 'Keep a usage log' }))).toEqual(log)
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

test('reduced motion: state only — no throw, no give, no delayed LED (on and off)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openApp(page)
  await openSettings(page, 'ai')
  const mem = page.getByTestId('memory-settings')
  const on = mem.getByRole('switch', { name: 'Keep a usage log' })
  if ((await on.getAttribute('aria-checked')) !== 'true') await on.click()
  const off = mem.getByRole('switch', { name: 'Use the memory' })
  if ((await off.getAttribute('aria-checked')) !== 'false') await off.click()
  for (const sw of [on, off]) {
    for (const part of ['.switch__rocker', '.switch__face', '.switch__glow', '.switch__o', '.switch__i']) {
      expect(await sw.locator(part).evaluate((el) => getComputedStyle(el).transitionProperty), part).toBe('none')
    }
    for (const [part, pseudo] of [['.switch__face', '::before'], ['.switch__half--o', '::before'], ['.switch__half--i', '::after']]) {
      expect(await sw.locator(part).evaluate((el, p) => getComputedStyle(el, p).transitionProperty, pseudo), `${part}${pseudo}`).toBe('none')
    }
    await sw.hover()
    expect(await sw.evaluate((el) => getComputedStyle(el).getPropertyValue('--sw-give').trim())).toBe('0deg')
  }
  // the new state is there at once (no poll): tilt and LED
  await off.click()
  await expect(off).toHaveAttribute('aria-checked', 'true')
  const h = await halves(off)
  expect(h.o).toBeGreaterThan(h.i)
  expect(await opacity(off.locator('.switch__glow'))).toBe(1)
})

test.describe('touch 390 × 844', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('a taller hit area around the bezel', async ({ page }) => {
    await openApp(page)
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
    await openSettings(page, 'general')
    const sw = page.getByRole('dialog').getByRole('switch', { name: 'Spell check' })
    await sw.scrollIntoViewIfNeeded()
    const hit = await sw.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const at = (dy: number) => document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2 + dy)?.closest('[role=switch]') === el
      return [at(-19), at(19)]
    })
    expect(hit).toEqual([true, true])
  })
})

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`hardware colours (${scheme})`, () => {
    test.use({ colorScheme: scheme })
    test('bezel edge, screws, the glass on its floor, the legends; off reads unlit, on reads lit', async ({ page }) => {
      await openApp(page)
      await openSettings(page, 'general')
      const sw = page.getByRole('dialog').getByRole('switch', { name: 'Spell check' })
      await expect(sw).toBeVisible()
      const edge = await rgbOf(page, await sw.evaluate((el) => getComputedStyle(el).borderTopColor))
      for (const surface of ['--surface', '--bg', '--surface-2', '--surface-3']) {
        expect(contrast(edge, await token(page, surface)), `bezel edge on ${surface}`).toBeGreaterThanOrEqual(3)
      }
      const t = async (n: string) => token(page, n)
      const [floor, glassHi, glassLo, legend, litMid, litLegend, slot, screwMid] = await Promise.all(
        ['--toggle-window', '--toggle-glass-hi', '--toggle-glass-lo', '--toggle-legend', '--toggle-lit-mid', '--toggle-lit-legend', '--toggle-screw-slot', '--toggle-screw-mid'].map(t),
      )
      const led = await t('--switch-led')
      // the rocker stands out from the dark gap around it; the engraved 0 / I are readable on both glasses
      expect(contrast(glassLo, floor), 'glass on its floor').toBeGreaterThanOrEqual(3)
      expect(contrast(legend, glassHi), 'unlit legend').toBeGreaterThanOrEqual(2)
      expect(contrast(litLegend, litMid), 'lit legend').toBeGreaterThanOrEqual(3)
      expect(contrast(slot, screwMid), 'slot on the screw').toBeGreaterThanOrEqual(1.8)
      // off is neutral glass, on is the LED's colour: clearly apart
      const chroma = ([r, g, b]: number[]) => Math.max(r, g, b) - Math.min(r, g, b)
      expect(chroma(glassHi), 'unlit glass is neutral').toBeLessThan(24)
      expect(chroma(litMid), 'lit glass carries the LED colour').toBeGreaterThan(120)
      expect(chroma(led)).toBeGreaterThan(150)
      if (scheme === 'dark') {
        // smoked glass, never the brightest thing on a dark screen: it must not read as lit
        expect(lum(glassHi)).toBeLessThan(0.4)
        expect(lum(floor)).toBeLessThan(0.02)
      } else {
        expect(lum(glassHi)).toBeGreaterThan(0.75)
        expect(lum(floor)).toBeLessThan(0.02)
      }
    })
  })
}
