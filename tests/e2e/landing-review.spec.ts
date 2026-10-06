/**
 * Landing § 01 "Claude asks before it changes" (src/landing/site/sections/review.ts): four checks as
 * vertical mode keys that switch the real screenshot beside them (click and ↑ / ↓), their manual links,
 * German, 390 px — and the hero's tour key: the 60-second video (public/media/simplecms-one.mp4, made by
 * scripts/promo) in a dialog, loaded only when opened, with its poster; the file is checked for its
 * length and frame size (read from the MP4 boxes, no codec needed).
 */
import { readFileSync, statSync } from 'node:fs'
import { test, expect } from './fixtures'

const CHECKS = [
  ['Edits, word by word', 'review-edit', 'Three edits staged'],
  ['Memory, only with your yes', 'review-memory', 'Remember? · 2'],
  ['Scripts, dry run first', 'review-dryrun', 'Dry run: two entries and one mail'],
  ['A version before every write', 'review-history', 'An entry’s history'],
] as const

/** Duration (s) and track size of an MP4, from its mvhd / tkhd boxes. */
function mp4Info(file: string): { duration: number; width: number; height: number } {
  const buf = readFileSync(file)
  const mvhd = buf.indexOf('mvhd')
  const v = buf[mvhd + 4]
  const timescale = v === 1 ? buf.readUInt32BE(mvhd + 24) : buf.readUInt32BE(mvhd + 16)
  const units = v === 1 ? Number(buf.readBigUInt64BE(mvhd + 28)) : buf.readUInt32BE(mvhd + 20)
  // the video track: the tkhd whose size is not zero (16.16 fixed point at its end)
  let width = 0
  let height = 0
  for (let at = buf.indexOf('tkhd'); at >= 0 && !width; at = buf.indexOf('tkhd', at + 4)) {
    const size = buf.readUInt32BE(at - 4)
    width = buf.readUInt32BE(at - 4 + size - 8) / 65536
    height = buf.readUInt32BE(at - 4 + size - 4) / 65536
  }
  return { duration: units / timescale, width, height }
}

test.describe('landing § 01 — Claude asks before it changes', () => {
  test('four checks switch the screenshot (click, ↑ / ↓), each a real 1600×1000 picture; manual links; nav link', async ({ page }) => {
    await page.goto('./?skip')
    const sec = page.locator('#review')
    await expect(sec.getByRole('heading', { level: 2 })).toHaveText(/Claude asks\s*before it changes\./)
    await expect(sec.locator('.sec-label')).toContainText('§ 01 — Claude · Review')
    await expect(page.locator('.tb-nav').getByRole('link', { name: 'Claude', exact: true })).toHaveAttribute('href', '#review')

    const keys = sec.getByRole('tablist', { name: /Review gate/ })
    await expect(keys).toHaveAttribute('aria-orientation', 'vertical')
    await expect(keys.getByRole('tab')).toHaveCount(CHECKS.length)
    for (const [i, [name]] of CHECKS.entries()) await expect(keys.getByRole('tab').nth(i)).toHaveAccessibleName(name)
    const shown = sec.locator('img.frame-img.is-on')
    const cap = sec.locator('figcaption [data-cap]')
    for (const [i, [name, file, caption]] of CHECKS.entries()) {
      const tab = keys.getByRole('tab', { name })
      await tab.click()
      await expect(tab).toHaveAttribute('aria-selected', 'true')
      await expect(shown).toHaveAttribute('src', new RegExp(`shots/${file}\\.webp$`))
      await expect(cap).toContainText(caption)
      await expect(sec.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', `rv-t${i}`)
      await expect.poll(() => shown.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([1600, 1000])
    }
    // the selected check's text is its description; the others stay folded
    await expect(keys.getByRole('tab', { name: CHECKS[3][0] })).toHaveAccessibleDescription(/One keeps it as it was/)
    // arrows: ↓ wraps to the first, ↑ goes back
    await keys.getByRole('tab', { name: CHECKS[3][0] }).focus()
    await page.keyboard.press('ArrowDown')
    await expect(keys.getByRole('tab', { name: CHECKS[0][0] })).toBeFocused()
    await expect(shown).toHaveAttribute('src', /shots\/review-edit\.webp$/)
    await page.keyboard.press('ArrowUp')
    await expect(keys.getByRole('tab', { name: CHECKS[3][0] })).toHaveAttribute('aria-selected', 'true')

    // the chain of a change, and the manual behind each check
    await expect(sec.locator('.rv-chain li')).toHaveText(['Proposed', 'Reviewed', 'Applied', 'Versioned'])
    const help = sec.locator('.rv-help a')
    await expect(help).toHaveText(['AI terminal', 'One memory', 'One Script', 'Version history'])
    for (const [i, id] of ['agent', 'memory', 'one-script', 'history'].entries()) await expect(help.nth(i)).toHaveAttribute('href', `/SimpleCMS/help/${id}/`)

    // the lightbox shows the selected check full size
    await sec.locator('.frame-media').hover()
    await sec.getByRole('button', { name: 'Enlarge figure' }).click()
    await expect(page.locator('dialog[data-lightbox] img')).toHaveAttribute('src', /shots\/review-history\.webp$/)
    await page.keyboard.press('Escape')
  })

  test.describe('German visitor', () => {
    test.use({ locale: 'de-DE' })
    test('the review gate in German', async ({ page }) => {
      await page.goto('./?skip')
      const sec = page.locator('#review')
      await expect(sec.getByRole('heading', { level: 2 })).toHaveText(/Claude fragt,\s*bevor es ändert\./)
      const tabs = sec.getByRole('tablist', { name: /Prüfstelle/ }).getByRole('tab')
      const names = ['Änderungen, Wort für Wort', 'Gedächtnis nur mit deinem Ja', 'Skripte, erst der Probelauf', 'Eine Version vor jedem Schreiben']
      await expect(tabs).toHaveCount(names.length)
      for (const [i, name] of names.entries()) await expect(tabs.nth(i)).toHaveAccessibleName(name)
      await expect(sec.locator('.rv-help a').first()).toHaveAttribute('href', '/SimpleCMS/help/de/agent/')
      await expect(page.locator('.hero-tour')).toContainText('Die Tour ansehen')
    })
  })

  test('390 px: screenshot first, the keys below, no sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('./?skip#review')
    const fig = page.locator('#review .rv-fig')
    const gate = page.locator('#review .rv-gate')
    await fig.scrollIntoViewIfNeeded()
    const f = (await fig.boundingBox())!
    const g = (await gate.boundingBox())!
    expect(f.y).toBeLessThan(g.y)
    for (const box of [f, g]) {
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(390)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  })
})

test.describe('landing — the tour video', () => {
  test('the file: about 60 s of 1920×1080, under 25 MB, with a 1280×720 poster', async () => {
    const info = mp4Info('public/media/simplecms-one.mp4')
    expect(info.duration).toBeGreaterThan(55)
    expect(info.duration).toBeLessThan(65)
    expect([info.width, info.height]).toEqual([1920, 1080])
    expect(statSync('public/media/simplecms-one.mp4').size).toBeLessThan(25 * 1024 * 1024)
    const jpg = readFileSync('public/media/simplecms-one.jpg')
    expect(jpg.subarray(0, 2).toString('hex')).toBe('ffd8')
    expect(jpg.length).toBeLessThan(200 * 1024)
  })

  test('"Watch the tour" opens the video in a dialog — nothing loads before; Esc closes it, stops it, gives focus back', async ({ page }) => {
    const media: string[] = []
    page.on('request', (r) => r.url().includes('/media/') && media.push(r.url()))
    await page.goto('./?skip')
    const key = page.locator('.hero-tour')
    await expect(key).toContainText('Watch the tour')
    await expect(key).toContainText('60 s')
    const video = page.locator('dialog[data-tour-dialog] video')
    await expect(video).not.toHaveAttribute('src', /./)
    expect(media).toEqual([])

    await key.click()
    const dlg = page.getByRole('dialog', { name: /60-second tour/ })
    await expect(dlg).toBeVisible()
    await expect(video).toHaveAttribute('src', /\/SimpleCMS\/media\/simplecms-one\.mp4$/)
    await expect(video).toHaveAttribute('poster', /\/SimpleCMS\/media\/simplecms-one\.jpg$/)
    // both files are served by the site
    for (const file of ['media/simplecms-one.mp4', 'media/simplecms-one.jpg']) {
      const res = await page.request.get(file, { headers: { range: 'bytes=0-1023' } })
      expect(res.status(), file).toBeLessThan(300)
    }
    await expect(dlg).toContainText('Claude’s answers are scripted for the recording')

    await page.keyboard.press('Escape')
    await expect(dlg).toBeHidden()
    expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
    await expect(key).toBeFocused()
  })
})
