/**
 * Product screenshots (public/assets/shots/*.webp, made by scripts/capture-shots.mjs): every one the
 * landing page or the README points at exists, is a 1600×1000 WebP, and the deep-dive frames show
 * the new ones behind their mode keys.
 */
import { readFileSync, existsSync } from 'node:fs'
import { test, expect } from './fixtures'

const SHOT = /assets\/shots\/([a-z-]+)\.webp$/

/** Load an image in the page: its natural size (0 × 0 when it fails). */
const sizeOf = (page: import('@playwright/test').Page, src: string) =>
  page.evaluate(
    (src) =>
      new Promise<[number, number]>((resolve) => {
        const img = new Image()
        img.onload = () => resolve([img.naturalWidth, img.naturalHeight])
        img.onerror = () => resolve([0, 0])
        img.src = src
      }),
    src,
  )

test.describe('landing screenshots', () => {
  for (const locale of ['en-US', 'de-DE']) {
    test.describe(locale, () => {
      test.use({ locale })
      test('every frame screenshot loads as a 1600×1000 WebP', async ({ page }) => {
        await page.goto('./?skip')
        const srcs = await page.locator('#site img.frame-img').evaluateAll((imgs) => [...new Set((imgs as HTMLImageElement[]).map((i) => i.src))])
        expect(srcs.length).toBeGreaterThanOrEqual(12)
        for (const src of srcs) {
          expect(src, src).toMatch(SHOT)
          const res = await page.request.get(src)
          expect(res.status(), src).toBe(200)
          expect(res.headers()['content-type'], src).toContain('image/webp')
          expect(await sizeOf(page, src), src).toEqual([1600, 1000])
        }
      })
    })
  }

  test('AI deep dive: Transform first, then meetings, agent, autofill and writing; forms logic under automations', async ({ page }) => {
    await page.goto('./?skip')
    const ai = page.getByRole('tablist', { name: /Claude/ })
    await ai.scrollIntoViewIfNeeded()
    const fig = page.locator('[data-frame-tabs]', { has: ai })
    const shown = fig.locator('img.frame-img.is-on')
    await expect(ai.getByRole('tab')).toHaveText([/Transform/, /Meetings/, /Agent/, /Autofill/, /Write/])
    await expect(shown).toHaveAttribute('src', /shots\/transform\.webp$/)
    await expect(fig.locator('figcaption')).toContainText('A list → a diagram')
    await ai.getByRole('tab', { name: /Meetings/ }).click()
    await expect(shown).toHaveAttribute('src', /shots\/meeting\.webp$/)
    await expect(fig.locator('figcaption')).toContainText('Meeting notes from a live transcript')
    await ai.getByRole('tab', { name: /Agent/ }).click()
    await expect(shown).toHaveAttribute('src', /shots\/agent\.webp$/)
    await expect(fig.locator('figcaption')).toContainText('every change staged for review')
    await expect.poll(() => shown.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1600)

    const auto = page.getByRole('tablist', { name: /Automations/ })
    await auto.scrollIntoViewIfNeeded()
    const autoFig = page.locator('[data-frame-tabs]', { has: auto })
    await auto.getByRole('tab', { name: /Logic/ }).click()
    await expect(autoFig.locator('img.frame-img.is-on')).toHaveAttribute('src', /shots\/forms\.webp$/)
    await expect(autoFig.locator('figcaption')).toContainText('conditional questions')
  })

  test('new deep dives: One Script (query, Ask Claude) and mail (mails, contacts, PDF → table); the ⌘ commands under databases', async ({ page }) => {
    await page.goto('./?skip')
    for (const [list, tabs, files] of [
      [/One Script/, [/Query/, /Ask Claude/], ['script', 'script-ask']],
      [/Mail/, [/Mails/, /Contacts/, /PDF → table/], ['mail', 'contacts', 'file-table']],
      [/Databases/, [/Board/, /Timeline/, /Agenda/, /Commands/], ['database', 'timeline', 'agenda', 'db-commands']],
    ] as const) {
      const tl = page.getByRole('tablist', { name: list })
      await tl.scrollIntoViewIfNeeded()
      await expect(tl.getByRole('tab')).toHaveText([...tabs])
      const shown = page.locator('[data-frame-tabs]', { has: tl }).locator('img.frame-img.is-on')
      for (const [i, file] of files.entries()) {
        await tl.getByRole('tab').nth(i).click()
        await expect(shown).toHaveAttribute('src', new RegExp(`shots/${file}\\.webp$`))
        await expect.poll(() => shown.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1600)
      }
    }
  })

  test('README: every screenshot it shows exists', () => {
    const readme = readFileSync('README.md', 'utf8')
    const files = [...readme.matchAll(/src="(public\/assets\/shots\/[a-z-]+\.webp)"/g)].map((m) => m[1])
    expect(files.length).toBeGreaterThanOrEqual(8)
    for (const f of files) expect(existsSync(f), f).toBe(true)
  })
})
