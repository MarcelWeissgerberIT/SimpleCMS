/**
 * Flight recorder — the deck (R1b): the ways in (Mod+Alt+Z with the German-layout and AltGr rules, the status key,
 * ⌘K), one dock at a time with the AI terminal, Esc; the story on the tape at 75 MIN (lane counts, the run's flag
 * brackets its window, the meters, the loupe), the tape's keys, a tick opening its page; the head fitting at the text
 * sizes; the phone panel; the Data line. Test data is fictional (Nordlicht, Tessera).
 */
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect, openApp, flush } from './fixtures'
import { playStory, rec, startRecorder, storyTime, type Story } from './helpers/recorder'

const story = JSON.parse(readFileSync(new URL('./fixtures/recorder-story.json', import.meta.url), 'utf8')) as Story
const MIN = 60_000

const deck = (page: Page) => page.locator('section.deck')
const rewindKey = (page: Page) => page.locator('.status__key')

/** A keydown on the window with exactly these fields (layouts and AltGr the real keyboard cannot be switched to). */
async function key(page: Page, init: KeyboardEventInit & { modifierAltGraph?: boolean }, target = 'window') {
  await page.evaluate(
    ({ init, target }) => {
      const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
      if (target === 'window') window.dispatchEvent(ev)
      else document.querySelector(target)!.dispatchEvent(ev)
    },
    { init, target },
  )
}

/** The app at the story's morning, the tape holding only the story (the setup's own writes wiped first). */
async function bootStory(page: Page): Promise<Record<string, string>> {
  await page.clock.install({ time: storyTime(story, story.setupAt) })
  await openApp(page)
  await startRecorder(page)
  await flush(page)
  await rec(page, 'wipe')
  return playStory(page, story)
}

test.describe('ways in and out', () => {
  test('Mod+Alt+Z (pc): from anywhere and from the page editor; never AltGr, "ż" or a text field; the German Z key works', async ({ page }) => {
    await openApp(page)
    await startRecorder(page)
    await page.keyboard.press('Control+Alt+z')
    await expect(deck(page)).toBeVisible()
    await expect(rewindKey(page)).toHaveAttribute('aria-pressed', 'true')
    // the playhead has focus; Esc closes
    await expect(page.locator('.playhead__h')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(deck(page)).toHaveCount(0)
    await expect(rewindKey(page)).toHaveAttribute('aria-pressed', 'false')

    // German QWERTZ: the Z key is KeyY, its character "z" — opens; the Y key (KeyZ, "y") does not
    await key(page, { key: 'z', code: 'KeyY', ctrlKey: true, altKey: true })
    await expect(deck(page)).toBeVisible()
    await key(page, { key: 'z', code: 'KeyY', ctrlKey: true, altKey: true })
    await expect(deck(page)).toHaveCount(0)
    await key(page, { key: 'y', code: 'KeyZ', ctrlKey: true, altKey: true })
    // AltGr (Windows sends it as Ctrl+Alt) and a typed "ż" never open it
    await key(page, { key: 'z', code: 'KeyZ', ctrlKey: true, altKey: true, modifierAltGraph: true })
    await key(page, { key: 'ż', code: 'KeyZ', ctrlKey: true, altKey: true })
    // Shift makes it another chord
    await key(page, { key: 'Z', code: 'KeyZ', ctrlKey: true, altKey: true, shiftKey: true })
    await page.waitForTimeout(150)
    await expect(deck(page)).toHaveCount(0)

    // not in a text field
    await page.evaluate(() => {
      const i = document.createElement('input')
      i.id = 'rec-probe'
      document.querySelector('#main')!.append(i)
      i.focus()
    })
    await page.keyboard.press('Control+Alt+z')
    await page.waitForTimeout(150)
    await expect(deck(page)).toHaveCount(0)
    await page.evaluate(() => document.querySelector('#rec-probe')?.remove())

    // in the page editor it opens (ProseMirror binds nothing there, no character is typed)
    const id = await page.evaluate(() => (window as unknown as { __one: { workspace: { getState: () => { createPage: (p: unknown) => string } } } }).__one.workspace.getState().createPage({ title: 'Nordlicht Notiz' }))
    await page.evaluate((id) => (location.hash = `#/p/${id}`), id)
    const editor = page.locator('#main .pv-content .ProseMirror').first()
    await editor.click()
    await page.keyboard.type('Tessera')
    await page.keyboard.press('Control+Alt+z')
    await expect(deck(page)).toBeVisible()
    await expect(editor).toHaveText('Tessera')
  })

  test('macOS: ⌘⌥Z opens it (⌥ turns Z into "Ω")', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel' }))
    await openApp(page)
    await key(page, { key: 'Ω', code: 'KeyZ', metaKey: true, altKey: true })
    await expect(deck(page)).toBeVisible()
  })

  test('the status key and ⌘K open it; the AI terminal and the deck are never open together', async ({ page }) => {
    await openApp(page)
    await rewindKey(page).click()
    await expect(deck(page)).toBeVisible()
    await rewindKey(page).click()
    await expect(deck(page)).toHaveCount(0)

    await page.keyboard.press('Control+k')
    await page.keyboard.type('Rewind')
    await expect(page.locator('[cmdk-item][data-selected="true"]')).toContainText('Rewind')
    await page.keyboard.press('Enter')
    await expect(deck(page)).toBeVisible()

    // the terminal takes the dock (its task would go on); the deck takes it back
    await page.keyboard.press('Control+j')
    await expect(page.locator('section.term')).toBeVisible()
    await expect(deck(page)).toHaveCount(0)
    await rewindKey(page).click()
    await expect(deck(page)).toBeVisible()
    await expect(page.locator('section.term')).toHaveCount(0)
  })
})

test.describe('the story on the tape', () => {
  test('75 MIN: lane counts, the flag brackets 07:30–07:35 with its meters, the loupe, the keys', async ({ page }) => {
    test.setTimeout(150_000)
    await bootStory(page)
    await page.keyboard.press('Control+Alt+z')
    await expect(deck(page)).toBeVisible()
    const count = (lane: string) => page.locator(`.trk[data-lane="${lane}"] .trk__c`)
    for (const [lane, n] of Object.entries(story.expect.lanes)) await expect(count(lane), lane).toHaveText(String(n).padStart(2, '0'))

    const flag = page.locator('.lane[data-lane="agent:nordlicht-spiegel"] .flag')
    await expect(flag).toHaveAttribute('aria-label', /Run 212 · 52 writes in 37 places/)
    await flag.click()
    await expect(page.locator('.win__t')).toHaveText('07:30:00 – 07:34:59')
    const meters = page.locator('.mtr b')
    await expect(meters).toHaveText(['52', '37', '+212 −40', /^35\s*3 new$/, '1', '1'])
    await expect(page.locator('.trk[data-lane="agent:nordlicht-spiegel"]')).toHaveAttribute('data-sel', '')
    // the window's ticks are the signal's; the lead label names the run
    await expect(page.locator('.lane[data-lane="agent:nordlicht-spiegel"] .lane__marks path.sel')).toHaveCount(1)
    await expect(page.locator('.ev-l[data-lead]')).toContainText('Run 212')

    // the loupe: on at 75 MIN (6×), gone at 15 MIN
    const loupe = page.getByRole('button', { name: 'Loupe 6×' })
    await expect(loupe).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('radio', { name: '15 min' }).click()
    await expect(page.getByRole('button', { name: /^Loupe/ })).toHaveCount(0)
    await page.getByRole('radio', { name: '75 min' }).click()

    // the playhead's keys: ← a minute, Shift+← ten seconds; [ and ] bracket at the playhead on the focused lane
    const head = page.locator('.playhead__h')
    await head.focus()
    const now = storyTime(story, story.now)
    await page.keyboard.press('ArrowLeft')
    await expect(head).toHaveAttribute('aria-valuenow', String(now - MIN))
    await page.keyboard.press('Shift+ArrowLeft')
    await expect(head).toHaveAttribute('aria-valuenow', String(now - MIN - 10_000))
    await expect(rewindKey(page)).toHaveAttribute('data-on', '')
    // a window of its own: [ and ] at the playhead (German Windows types "[" with AltGr+8: the modifiers do not matter)
    await page.getByRole('button', { name: 'Clear the window' }).click()
    await head.focus()
    await key(page, { key: '[', code: 'Digit8', ctrlKey: true, altKey: true }, '.playhead__h')
    await page.keyboard.press('ArrowLeft')
    await key(page, { key: ']', code: 'Digit9' }, '.playhead__h')
    await expect(page.locator('.win__t')).toHaveText('08:03:30 – 08:04:29')
    // a zoom key keeps its own arrows (the playhead stays)
    const before = await head.getAttribute('aria-valuenow')
    await page.getByRole('radio', { name: '75 min' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('radio', { name: '6 h' })).toHaveAttribute('aria-checked', 'true')
    await expect(head).toHaveAttribute('aria-valuenow', before!)
    // Esc: closed, back to now
    await page.keyboard.press('Escape')
    await expect(deck(page)).toHaveCount(0)
    await page.keyboard.press('Control+Alt+z')
    await expect(page.locator('.playhead__h')).toHaveText(/Now/)
  })

  test('a click on a tick opens its page', async ({ page }) => {
    test.setTimeout(150_000)
    await bootStory(page)
    await page.keyboard.press('Control+Alt+z')
    const lane = page.locator('.lane[data-lane="sync:folder"]')
    await expect(lane).toBeVisible()
    // the first point of the sync lane (its path starts at x − 1)
    const x = await lane.locator('.lane__marks path.ev').evaluate((p) => Number(/^M([\d.]+)/.exec(p.getAttribute('d') ?? '')?.[1]) + 1)
    const box = (await lane.boundingBox())!
    await page.mouse.click(box.x + x, box.y + box.height - 12)
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#\/p\//)
  })
})

test.describe('fit', () => {
  for (const w of [1024, 1280, 1440])
    test(`the head fits at ${w} px at text size XL`, async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('one.textScale', '4'))
      await page.setViewportSize({ width: w, height: 900 })
      await openApp(page)
      await page.keyboard.press('Control+Alt+z')
      await expect(deck(page)).toBeVisible()
      const fit = await page.locator('.deck__head').evaluate((h) => h.scrollWidth - h.clientWidth)
      expect(fit).toBeLessThanOrEqual(0)
      await expect(page.getByRole('button', { name: 'Close' }).last()).toBeInViewport()
    })

  test('phone: the page ⋯ menu opens it; an in-flow panel ≤ 60vh over the safe area, the capture key hidden, the head fits', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    const page = await ctx.newPage()
    await openApp(page)
    const id = await page.evaluate(() => (window as unknown as { __one: { workspace: { getState: () => { createPage: (p: unknown) => string } } } }).__one.workspace.getState().createPage({ title: 'Nordlicht Notiz' }))
    await page.evaluate((id) => (location.hash = `#/p/${id}`), id)
    const capture = page.locator('.qcap-fab')
    await expect(capture).toBeVisible()
    await page.getByRole('button', { name: 'Page options' }).tap()
    await page.waitForTimeout(500)
    await page.getByRole('menuitem', { name: /Flight recorder/ }).tap()
    await expect(deck(page)).toBeVisible()
    const h = await deck(page).evaluate((d) => d.getBoundingClientRect().height)
    expect(h).toBeLessThanOrEqual(844 * 0.6 + 1)
    expect(await deck(page).evaluate((d) => getComputedStyle(d).paddingBottom)).not.toBe('0px')
    await expect(capture).toHaveCount(0)
    const fit = await page.locator('.deck__head').evaluate((h) => h.scrollWidth - h.clientWidth)
    expect(fit).toBeLessThanOrEqual(0)
    await ctx.close()
  })
})

test('Workspace → Data: the tape line; "Erase the tape" wipes this scope only', async ({ page }) => {
  await openApp(page)
  await startRecorder(page)
  await page.evaluate(() => (window as unknown as { __one: { workspace: { getState: () => { createPage: (p: unknown) => string } } } }).__one.workspace.getState().createPage({ title: 'Nordlicht Plan' }))
  await rec(page, 'settle')
  await page.evaluate(() => (location.hash = '#/workspace/data'))
  const line = page.getByTestId('ws-recorder')
  await expect(line).toContainText(/\d+ writes?/)
  await line.getByRole('button', { name: 'Erase the tape' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Erase the tape' }).click()
  await expect(line).toContainText('Nothing recorded yet')
  expect(await rec(page, 'ops')).toEqual([])
})
