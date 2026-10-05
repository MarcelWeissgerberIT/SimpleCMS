/**
 * "What's new" (src/app/help/changelog): the strip on the Help panel's home, the list (newest first, mono
 * dates), an entry (its screenshot, the lightbox by keyboard, "Try it", related articles), the LED on
 * "? Help" for an entry this device has not opened (localStorage one.help.seen-changelog), German, the
 * phone layout, ⌘K — and the public pages /help/changelog/, /help/de/changelog/ and the Atom feed in the
 * build under the /SimpleCMS/ base.
 */
import { readdirSync, readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, wsEval, MOD } from './fixtures'

const SEEN = 'one.help.seen-changelog'

/** The entries as the files say (English front matter): newest first, by date then order. */
function entriesOnDisk(): Array<{ id: string; date: string; order: number; title: string; image: string; try: string }> {
  const dir = 'src/app/help/changelog/en'
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const raw = readFileSync(`${dir}/${f}`, 'utf8')
      const meta = (key: string) => new RegExp(`^${key}: (.*)$`, 'm').exec(raw)?.[1]?.trim() ?? ''
      return { id: f.slice(0, -3), date: meta('date'), order: Number(meta('order')) || 99, title: meta('title'), image: meta('image'), try: meta('try') }
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.order - b.order || a.id.localeCompare(b.id))
}

const ENTRIES = entriesOnDisk()
const NEWEST = ENTRIES[0]
const TERMINAL = ENTRIES.find((e) => e.id.endsWith('-ai-terminal'))!

const panel = (page: Page) => page.getByRole('dialog', { name: /^(Help|Hilfe)$/ })
const title = (page: Page) => panel(page).locator('.help-art__title')
const statusHelp = (page: Page) => page.locator('footer.status').getByRole('button', { name: /Help|Hilfe/ })
const led = (page: Page) => statusHelp(page).getByTestId('help-news-led')

async function pressHelpKey(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await page.keyboard.press('?')
  await expect(panel(page)).toBeVisible()
  // the panel itself, not its loading frame
  await expect(panel(page).locator('.help-scroll')).toBeVisible()
}

/** Help → the "What's new" strip's head → the list. */
async function openList(page: Page) {
  await pressHelpKey(page)
  // the help opens where it was left: back to its home first
  if (!(await panel(page).getByTestId('help-news').count())) await panel(page).getByRole('navigation', { name: /Breadcrumbs|Pfad/ }).getByRole('button').first().click()
  await panel(page).getByTestId('help-news').getByRole('button', { name: /What’s new|Neu in One/ }).click()
  await expect(panel(page).getByTestId('help-changelog')).toBeVisible()
}

async function openEntry(page: Page, id: string) {
  await openList(page)
  await panel(page).locator(`.cl-row[data-entry="${id}"]`).click()
  await expect(panel(page).locator(`article[data-entry="${id}"]`)).toBeVisible()
}

const naturalWidth = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate(async (img: HTMLImageElement) => {
    if (!img.complete) await new Promise((r) => img.addEventListener('load', r, { once: true }))
    return img.naturalWidth
  })

test.describe('What’s new in the Help panel', () => {
  test('the home strip, then the list: newest first, mono dates, thumbnails', async ({ page }) => {
    expect(ENTRIES.length).toBeGreaterThanOrEqual(10)
    await openApp(page)
    await pressHelpKey(page)
    const strip = panel(page).getByTestId('help-news')
    // the strip sits above the chapters and leads with the newest entry
    await expect(strip.locator('.cl-feature')).toHaveAttribute('data-entry', NEWEST.id)
    await expect(strip.locator('.cl-feature')).toContainText(NEWEST.title)
    await expect(strip).toContainText(String(ENTRIES.length).padStart(2, '0'))
    const stripBox = await strip.boundingBox()
    const chapterBox = await panel(page).locator('.help-chap').first().boundingBox()
    expect(stripBox!.y).toBeLessThan(chapterBox!.y)

    await strip.getByRole('link', { name: /All updates/ }).click()
    const list = panel(page).getByTestId('help-changelog')
    await expect(list).toBeVisible()
    await expect(title(page)).toHaveText('What’s new')
    await expect(list).toContainText(`${ENTRIES.length} entries · newest first`)
    const rows = list.locator('.cl-row')
    await expect(rows).toHaveCount(ENTRIES.length)
    expect(await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-entry')))).toEqual(ENTRIES.map((e) => e.id))
    // dates as mono labels, never increasing
    const dates = await list.locator('.cl-row time').evaluateAll((els) => els.map((e) => e.getAttribute('datetime')))
    expect(dates).toEqual(ENTRIES.map((e) => e.date))
    await expect(rows.first().locator('time')).toHaveText(/^\d{2} (JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC) \d{4}$/)
    await expect(list.locator(`.cl-row[data-entry="2026-10-05-ai-terminal"] time`)).toHaveText('05 OCT 2026')
    await expect(list.locator(`.cl-row[data-entry="2026-10-04-gmail"] time`)).toHaveText('04 OCT 2026')
    // every thumbnail loads (under the /SimpleCMS/ base)
    for (const src of await rows.locator('img').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).getAttribute('src')))) expect(src).toMatch(/^\/SimpleCMS\/assets\/shots\/changelog\/[a-z0-9-]+\.webp$/)
    await rows.first().scrollIntoViewIfNeeded()
    expect(await naturalWidth(page, '.cl-row img')).toBeGreaterThan(0)
  })

  test('an entry: the picture loads, the lightbox opens and closes by keyboard, related articles open, Try it opens the terminal', async ({ page }) => {
    await openApp(page)
    await openEntry(page, TERMINAL.id)
    const entry = panel(page).locator(`article[data-entry="${TERMINAL.id}"]`)
    await expect(title(page)).toHaveText(TERMINAL.title)
    await expect(entry.locator('.help-art__code')).toContainText('05 OCT 2026')
    await expect(entry.locator('.cl-fig__img')).toHaveAttribute('src', `/SimpleCMS/${TERMINAL.image}`)
    expect(await naturalWidth(page, '.cl-fig__img')).toBe(1440)
    // the body: keys as keycaps
    await expect(entry.locator('.help-doc kbd').first()).toBeVisible()

    // the lightbox: Enter on the picture, Tab stays inside, Esc closes it — the help stays, focus returns
    const fig = entry.getByRole('button', { name: /Enlarge the picture/ })
    await fig.focus()
    await page.keyboard.press('Enter')
    const box = page.getByTestId('help-lightbox')
    await expect(box).toBeVisible()
    await expect(box).toHaveAttribute('role', 'dialog')
    await expect(box.getByRole('button', { name: 'Close the picture' })).toBeFocused()
    expect(await naturalWidth(page, '.cl-lightbox__img')).toBe(1440)
    await expect(box).toContainText('1440 × 900')
    const img = await box.locator('.cl-lightbox__img').boundingBox()
    const vp = page.viewportSize()!
    expect(img!.y + img!.height).toBeLessThanOrEqual(vp.height)
    expect(img!.x + img!.width).toBeLessThanOrEqual(vp.width)
    await page.keyboard.press('Tab')
    await expect(box.getByRole('button', { name: 'Close the picture' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(box).toHaveCount(0)
    await expect(panel(page)).toBeVisible()
    await expect(fig).toBeFocused()
    // a click on the picture works too, and a click anywhere closes it
    await fig.click()
    await expect(box).toBeVisible()
    await box.click({ position: { x: 20, y: 300 } })
    await expect(box).toHaveCount(0)

    // related articles open in the panel
    await entry.locator('.help-related').getByRole('link', { name: /The AI terminal/ }).click()
    await expect(title(page)).toHaveText('The AI terminal')
    await panel(page).getByRole('button', { name: 'Back' }).click()
    await expect(title(page)).toHaveText(TERMINAL.title)

    // Try it: the help steps aside, the AI terminal opens
    await panel(page).getByRole('group', { name: 'Try it' }).getByRole('button', { name: /Open the AI terminal/ }).click()
    await expect(panel(page)).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'AI terminal' })).toBeVisible()
  })

  test('Try it: Settings → Claude AI for codewords, Ask for the help centre', async ({ page }) => {
    await openApp(page)
    const codewords = ENTRIES.find((e) => e.try === 'settings-ai')!
    await openEntry(page, codewords.id)
    await panel(page).locator('.cl-try__btn').click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await expect(settings).toBeVisible()
    await expect(settings.getByRole('tab', { name: /Claude AI/ })).toHaveAttribute('aria-selected', 'true')
    await expect(panel(page)).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(settings).toHaveCount(0)

    const help = ENTRIES.find((e) => e.try === 'ask')!
    await openEntry(page, help.id)
    await panel(page).locator('.cl-try__btn').click()
    await expect(panel(page).getByRole('tab', { name: /Ask/ })).toHaveAttribute('aria-selected', 'true')
  })

  test('the LED on "? Help": lit for an unseen entry, cleared by opening the list, per device; an older seen entry lights it again', async ({ page }) => {
    await openApp(page)
    await expect(led(page)).toBeVisible()
    await expect(statusHelp(page)).toHaveAccessibleName(/New updates/)
    // the home of the help shows it too, but only the list clears it
    await pressHelpKey(page)
    await expect(panel(page).getByTestId('help-news').locator('.cl-new')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(led(page)).toBeVisible()

    await openList(page)
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)
    await expect(led(page)).toHaveCount(0)
    expect(await page.evaluate((k) => localStorage.getItem(k), SEEN)).toBe(NEWEST.id)
    // stays off after a reload (this device)
    await reloadApp(page)
    await expect(led(page)).toHaveCount(0)

    // a device that saw an older entry: the LED, and the newer entries carry "New" in the list
    const older = ENTRIES[3]
    await page.evaluate(({ k, v }) => localStorage.setItem(k, v), { k: SEEN, v: older.id })
    await reloadApp(page)
    await expect(led(page)).toBeVisible()
    await openList(page)
    const list = panel(page).getByTestId('help-changelog')
    await expect(list.locator('.cl-row .cl-new')).toHaveCount(3)
    await expect(list.locator(`.cl-row[data-entry="${NEWEST.id}"] .cl-new`)).toBeVisible()
    await expect(list.locator(`.cl-row[data-entry="${older.id}"] .cl-new`)).toHaveCount(0)
    await expect(led(page)).toHaveCount(0)
  })

  test('German: Neu in One, OKT dates, German entries and keys', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await pressHelpKey(page)
    await panel(page).getByTestId('help-news').getByRole('button', { name: /Neu in One/ }).click()
    await expect(title(page)).toHaveText('Neu in One')
    const list = panel(page).getByTestId('help-changelog')
    await expect(list).toContainText(`${ENTRIES.length} Einträge · das Neueste zuerst`)
    await expect(list.locator('.cl-row[data-entry="2026-10-05-ai-terminal"] time')).toHaveText('05 OKT 2026')
    await expect(list.locator('.cl-row[data-entry="2026-10-05-ai-terminal"]')).toContainText('Das KI-Terminal')
    await list.locator('.cl-row[data-entry="2026-10-05-ai-terminal"]').click()
    await expect(title(page)).toHaveText('Das KI-Terminal')
    await expect(panel(page).locator('.cl-fig__cap')).toContainText('Abb.')
    await expect(panel(page).getByRole('group', { name: 'Ausprobieren' }).getByRole('button', { name: /KI-Terminal öffnen/ })).toBeVisible()
    await expect(panel(page).locator('.help-related__label')).toHaveText('Im Handbuch')
  })

  test('⌘K "What’s new" opens the list (and "Neuigkeiten" in German)', async ({ page }) => {
    await openApp(page)
    await page.keyboard.press(`${MOD}+k`)
    const pal = page.getByRole('dialog', { name: 'Command palette' })
    await expect(pal.getByRole('combobox')).toBeFocused()
    await page.keyboard.type('changelog')
    const item = pal.getByRole('option', { name: /What’s new/ })
    await expect(item).toBeVisible()
    await item.click()
    await expect(pal).toBeHidden()
    await expect(panel(page).getByTestId('help-changelog')).toBeVisible()
    await page.keyboard.press('Escape')

    await expect(panel(page)).toHaveCount(0)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await page.keyboard.press(`${MOD}+k`)
    await expect(page.getByRole('dialog', { name: 'Befehlspalette' }).getByRole('combobox')).toBeFocused()
    await page.keyboard.type('Neuigkeiten')
    await page.getByRole('dialog', { name: 'Befehlspalette' }).getByRole('option', { name: 'Neuigkeiten', exact: true }).click()
    await expect(title(page)).toHaveText('Neu in One')
  })

  test('phone: Help in the workspace menu carries the LED; list, entry and picture stay inside 390 px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openApp(page)
    await page.getByRole('button', { name: 'Open sidebar' }).click()
    await page.locator('.sb-head__ws').click()
    const item = page.getByRole('menuitem', { name: /^Help/ })
    await expect(item.getByTestId('help-news-led')).toBeVisible()
    await item.click()
    await expect(panel(page).locator('.help-scroll')).toBeVisible()
    await expect.poll(async () => (await panel(page).boundingBox())?.x ?? 99).toBeLessThanOrEqual(0.5)
    const overflow = () => panel(page).evaluate((el) => Math.max(el.scrollWidth - el.clientWidth, el.querySelector('.help-scroll')!.scrollWidth - el.querySelector('.help-scroll')!.clientWidth))
    expect(await overflow()).toBeLessThanOrEqual(0)
    await panel(page).getByTestId('help-news').getByRole('button', { name: /What’s new/ }).click()
    await expect(panel(page).getByTestId('help-changelog')).toBeVisible()
    expect(await overflow()).toBeLessThanOrEqual(0)
    await panel(page).locator(`.cl-row[data-entry="${TERMINAL.id}"]`).click()
    await expect(title(page)).toHaveText(TERMINAL.title)
    expect(await overflow()).toBeLessThanOrEqual(0)
    const fig = await panel(page).locator('.cl-fig__btn').boundingBox()
    expect(fig!.x + fig!.width).toBeLessThanOrEqual(390)
    await panel(page).locator('.cl-fig__btn').click()
    const img = await page.getByTestId('help-lightbox').locator('.cl-lightbox__img').boundingBox()
    expect(img!.x).toBeGreaterThanOrEqual(0)
    expect(img!.x + img!.width).toBeLessThanOrEqual(390)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  })
})

test.describe('public "What’s new" (/help/changelog/)', () => {
  const PORT = Number(process.env.E2E_PORT) || 4180
  const DIST = `node_modules/.cache/e2e-dist-${PORT}`

  test('EN + DE pages and the Atom feed are prerendered under the base: hreflang, anchors, lazy images with their size', async ({ request }) => {
    const en = readFileSync(`${DIST}/help/changelog/index.html`, 'utf8')
    expect(en).toContain('<html lang="en"')
    expect(en).toContain('<link rel="canonical" href="https://getonecms.com/SimpleCMS/help/changelog/" />')
    expect(en).toContain('hreflang="de" href="https://getonecms.com/SimpleCMS/help/de/changelog/"')
    expect(en).toContain('hreflang="x-default" href="https://getonecms.com/SimpleCMS/help/changelog/"')
    expect(en).toContain('type="application/atom+xml"')
    for (const e of ENTRIES) {
      expect(en, e.id).toContain(`<article class="news" id="${e.id}"`)
      expect(en, e.id).toContain(`href="#${e.id}"`)
    }
    const order = [...en.matchAll(/<article class="news" id="([^"]+)"/g)].map((m) => m[1])
    expect(order).toEqual(ENTRIES.map((e) => e.id))
    expect(en).toContain(`<img src="/SimpleCMS/${TERMINAL.image}" width="1440" height="900" alt=`)
    const imgs = [...en.matchAll(/<img src="([^"]+)"([^>]*)>/g)]
    expect(imgs).toHaveLength(ENTRIES.length)
    for (const [, , attrs] of imgs) {
      expect(attrs).toContain('loading="lazy"')
      expect(attrs).toMatch(/width="\d+" height="\d+"/)
    }

    const de = readFileSync(`${DIST}/help/de/changelog/index.html`, 'utf8')
    expect(de).toContain('<html lang="de"')
    expect(de).toContain('Neu in One.')
    expect(de).toContain('05 OKT 2026')
    expect(de).toContain('hreflang="en" href="https://getonecms.com/SimpleCMS/help/changelog/"')

    // the help index links it
    const index = readFileSync(`${DIST}/help/index.html`, 'utf8')
    expect(index).toContain('href="/SimpleCMS/help/changelog/"')
    expect(readFileSync(`${DIST}/help/de/index.html`, 'utf8')).toContain('href="/SimpleCMS/help/de/changelog/"')

    // the feed: one entry per English entry, absolute links and pictures
    const feed = readFileSync(`${DIST}/help/changelog.xml`, 'utf8')
    expect(feed).toMatch(/^<\?xml version="1.0" encoding="utf-8"\?>\n<feed xmlns="http:\/\/www.w3.org\/2005\/Atom"/)
    expect([...feed.matchAll(/<entry>/g)]).toHaveLength(ENTRIES.length)
    expect(feed).toContain(`<id>https://getonecms.com/SimpleCMS/help/changelog/#${NEWEST.id}</id>`)
    expect(feed).toContain(`https://getonecms.com/SimpleCMS/${TERMINAL.image}`)

    // served: the pages, every picture and every internal link
    const seen = new Set<string>()
    for (const path of ['help/changelog/', 'help/de/changelog/', 'help/changelog.xml']) {
      const res = await request.get(path)
      expect(res.status(), path).toBe(200)
      if (path.endsWith('/')) for (const m of (await res.text()).matchAll(/(?:href|src)="(\/SimpleCMS\/[^"#]*)"/g)) seen.add(m[1])
    }
    for (const url of seen) expect((await request.get(url)).status(), url).toBe(200)
    expect([...seen].filter((u) => u.includes('/assets/shots/changelog/'))).toHaveLength(ENTRIES.length)
  })

  test('the page renders: anchors, the language switch, and the landing footer links it', async ({ page }) => {
    await page.goto(`help/changelog/#${TERMINAL.id}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('What’s new.')
    await expect(page.locator(`[id="${TERMINAL.id}"]`)).toBeInViewport()
    const pic = page.locator(`[id="${TERMINAL.id}"] img`)
    await expect(pic).toHaveAttribute('width', '1440')
    expect(await pic.evaluate(async (img: HTMLImageElement) => {
      if (!img.complete) await new Promise((r) => img.addEventListener('load', r, { once: true }))
      return img.naturalWidth
    })).toBe(1440)
    await page.getByRole('link', { name: 'DE', exact: true }).click()
    await expect(page).toHaveURL(/\/SimpleCMS\/help\/de\/changelog\/$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Neu in One.')

    await page.goto('./?skip')
    await expect(page.locator('footer').getByRole('link', { name: 'What’s new', exact: true })).toHaveAttribute('href', '/SimpleCMS/help/changelog/')
  })
})
