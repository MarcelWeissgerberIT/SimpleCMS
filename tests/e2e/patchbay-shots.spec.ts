/**
 * The Patchbay's screenshots for the P0 review (plan §4 B8): mock 1 at 1440 × 900 (the rack, then scrolled to the fuse
 * plate) and the phone's strands at 390 (a tall page, so the whole list is in the picture), light and dark, written to
 * `.shots/` (gitignored) — compared by eye with the mock's shot-1440-*.png / full-390-*.png. The blink is off (noBlink)
 * so the lamps are steady. The asserts only make sure each picture shows what it is about.
 * Every name is fictional (tests/fixtures/patchbay.ts).
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect, openApp } from './fixtures'
import { mock1, seedPatchbay } from '../fixtures/patchbay'

const OUT = join(process.cwd(), '.shots')

async function open(page: Page, scheme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'no-preference' })
  await page.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
  await openApp(page)
  await seedPatchbay(page, mock1())
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
