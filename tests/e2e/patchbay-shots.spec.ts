/**
 * The Patchbay's screenshots for the P0 review (plan §4 B8): mock 1 at 1440 × 900 (the rack, then scrolled to the fuse
 * plate) and the phone's strands at 390 (a tall page, so the whole list is in the picture), light and dark, written to
 * `.shots/` (gitignored; `PB_SHOTS` names another folder) — compared by eye with the mock's shot-1440-*.png /
 * full-390-*.png. B12: mock 2 — the setup band right after a profile drop at 1440 (then scrolled to the lamps), the
 * strip after a reload, the phone's setup card (tall) — compared with shot2-* / full2-*. The blink is off (noBlink) so
 * the lamps are steady. The asserts only make sure each picture shows what it is about.
 * Every name is fictional (tests/fixtures/patchbay.ts).
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval } from './fixtures'
import { mock1, mock2, profileFile, seedPatchbay } from '../fixtures/patchbay'

const OUT = process.env.PB_SHOTS || join(process.cwd(), '.shots')

async function open(page: Page, scheme: 'light' | 'dark', mock = mock1(), key = false) {
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'no-preference' })
  await page.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
  await openApp(page)
  await seedPatchbay(page, mock)
  // mock 2's lamp 00 is green: a key on this device
  if (key) await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
  await page.evaluate(() => (window.location.hash = '#/patchbay'))
  await expect(page.getByTestId('patchbay-page')).toBeVisible()
  await page.evaluate(() => (window as unknown as { __onePatchbay: { noBlink: () => void } }).__onePatchbay.noBlink())
  // the fixture's scheduled agent has no key: its toast is not what the picture is about
  await page.evaluate(() => (window as unknown as { __one: { ui: { setState: (s: unknown) => void } } }).__one.ui.setState({ toasts: [], waitingToasts: [] }))
}

test.describe('Patchbay shots · 1440', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`mock 1 at 1440 × 900 (${scheme}): the rack, then the fuse plate`, async ({ page }) => {
      mkdirSync(OUT, { recursive: true })
      await page.setViewportSize({ width: 1440, height: 900 })
      await open(page, scheme)
      await expect(page.getByTestId('pb-glyph')).toBeVisible()
      await expect(page.getByTestId('pb-leader')).toHaveCount(1)
      await page.screenshot({ path: join(OUT, `patchbay-1440-${scheme}.png`) })
      // the plate (the shell holds programmatic scrolls of the main region: scrolled by the wheel)
      await page.mouse.move(800, 500)
      await page.mouse.wheel(0, 700)
      await expect(page.getByTestId('pb-fpanel')).toBeInViewport()
      await page.waitForTimeout(300)
      await page.screenshot({ path: join(OUT, `patchbay-1440-${scheme}-plate.png`) })
    })
  }
})

test.describe('Patchbay shots · 390', () => {
  test.use({ viewport: { width: 390, height: 2600 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  for (const scheme of ['light', 'dark'] as const) {
    test(`mock 1 at 390 (${scheme}): the fuse card and every strand`, async ({ page }) => {
      mkdirSync(OUT, { recursive: true })
      await open(page, scheme)
      await expect(page.getByTestId('patchbay-page')).toHaveAttribute('data-view', 'strands')
      await expect(page.getByTestId('pb-fcard')).toBeVisible()
      await expect(page.getByTestId('pb-strands-rest')).toBeVisible()
      await page.screenshot({ path: join(OUT, `patchbay-390-${scheme}.png`) })
    })
  }
})

/** A file dropped on the page (the events a drag from the desktop fires). */
const dropFile = (page: Page, name: string, text: string) =>
  page.evaluate(
    ({ name, text }) => {
      const dt = new DataTransfer()
      dt.items.add(new File([text], name, { type: 'application/json' }))
      const target = document.querySelector('[data-testid="pb-bench"]') ?? document.querySelector('[data-testid="patchbay-page"]')!
      for (const ev of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(ev, { bubbles: true, cancelable: true, dataTransfer: dt }))
    },
    { name, text },
  )

/** Mock 2: tracker-cnsx.integration.json dropped on the page. */
async function dropProfile(page: Page) {
  await dropFile(page, 'tracker-cnsx.integration.json', profileFile())
  await expect(page.locator('[data-pb-lamp="4"]').first()).toBeVisible()
  await page.evaluate(() => (window as unknown as { __one: { ui: { setState: (s: unknown) => void } } }).__one.ui.setState({ toasts: [], waitingToasts: [] }))
  // the keyboard on 04 (its focus ring is part of the picture) — the mouse off the rack
  await page.mouse.move(2, 890)
  await page.waitForTimeout(300)
}

test.describe('Patchbay shots · setup 1440', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`mock 2 at 1440 × 900 (${scheme}): the band after the drop, the lamps, then the strip after a reload`, async ({ page }) => {
      mkdirSync(OUT, { recursive: true })
      await page.setViewportSize({ width: 1440, height: 900 })
      await open(page, scheme, mock2(), true)
      // a profile that is no profile: the plate under the head, then Paste (the shared code area)
      await dropFile(page, 'tracker-cnsx.integration.json', '{\n  "schema": "one.integration/1",\n  "id": "in-01",\n  "name": \n}')
      await expect(page.getByTestId('pb-dropplate')).toHaveAttribute('data-why', 'invalid')
      await page.mouse.move(2, 890)
      await page.screenshot({ path: join(OUT, `setup-1440-${scheme}-plate.png`) })
      await page.getByTestId('pb-dropplate').getByRole('button', { name: 'Close the message' }).click()
      await page.getByTestId('pb-drop').click()
      await page.getByRole('menuitem', { name: 'Paste the profile …' }).click()
      await page.getByTestId('pb-paste-area').locator('textarea').fill(profileFile().slice(0, 240))
      await page.getByTestId('pb-paste-check').click()
      await expect(page.getByTestId('pb-paste-said')).toBeVisible()
      await page.waitForTimeout(250)
      await page.screenshot({ path: join(OUT, `setup-1440-${scheme}-paste.png`) })
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('pb-paste-area')).toHaveCount(0)
      await dropProfile(page)
      await expect(page.getByTestId('pb-band')).toBeVisible()
      await page.screenshot({ path: join(OUT, `setup-1440-${scheme}.png`) })
      await page.mouse.move(800, 500)
      await page.mouse.wheel(0, 300)
      await expect(page.getByTestId('pb-setup-lamps')).toBeInViewport({ ratio: 1 })
      await page.mouse.move(2, 890)
      await page.waitForTimeout(300)
      await page.screenshot({ path: join(OUT, `setup-1440-${scheme}-lamps.png`) })
      // "What does 04 create?"
      await page.getByTestId('pb-what-key').click()
      await expect(page.getByTestId('pb-what')).toBeVisible()
      await page.waitForTimeout(200)
      await page.screenshot({ path: join(OUT, `setup-1440-${scheme}-what.png`) })
      await page.keyboard.press('Escape')
      // a later visit: the strip
      await page.reload()
      await page.waitForFunction(() => !!(window as unknown as { __one?: unknown }).__one)
      await page.evaluate(() => (window.location.hash = '#/patchbay'))
      await expect(page.getByTestId('pb-setup-strip')).toBeVisible()
      await page.evaluate(() => (window as unknown as { __onePatchbay: { noBlink: () => void } }).__onePatchbay.noBlink())
      await page.mouse.move(2, 890)
      await page.waitForTimeout(300)
      await page.screenshot({ path: join(OUT, `setup-1440-${scheme}-strip.png`) })
    })
  }
})

test.describe('Patchbay shots · setup 390', () => {
  test.use({ viewport: { width: 390, height: 2400 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  for (const scheme of ['light', 'dark'] as const) {
    test(`mock 2 at 390 (${scheme}): the setup card, the lamps one under the other, the strands`, async ({ page }) => {
      mkdirSync(OUT, { recursive: true })
      await open(page, scheme, mock2(), true)
      await expect(page.getByTestId('patchbay-page')).toHaveAttribute('data-view', 'strands')
      await dropProfile(page)
      await expect(page.getByTestId('pb-setup-card')).toBeVisible()
      await page.screenshot({ path: join(OUT, `setup-390-${scheme}.png`) })
    })
  }
})
