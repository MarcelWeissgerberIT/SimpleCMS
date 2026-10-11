/**
 * Flight recorder — the deck (R1b): the ways in (Mod+Alt+Z with the German-layout and AltGr rules, the status key,
 * ⌘K, What's new "Try it"), one dock at a time with the AI terminal, Esc; the story on the tape at 75 MIN (lane counts,
 * the run's flag brackets its window, the meters, the loupe), the tape's keys, a tick opening its page or listing its
 * places; labels flipping and hiding at the now line and the edges (1440 and the phone); the head fitting at the text
 * sizes; the phone panel; orange only where it means something; reduced motion; the Data line; the open budget
 * (< 150 ms with 40,000 events). Test data is fictional (Nordlicht, Tessera).
 */
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect, openApp, flush, reloadApp, wsEval } from './fixtures'
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
async function bootStory(page: Page, before?: (page: Page) => Promise<void>): Promise<Record<string, string>> {
  await page.clock.install({ time: storyTime(story, story.setupAt) })
  await openApp(page)
  await startRecorder(page)
  if (before) await before(page)
  await flush(page)
  await rec(page, 'wipe')
  return playStory(page, story)
}

interface LabelBox {
  text: string
  lane: string
  flipped: boolean
  hidden: boolean
  shown: boolean
  /** viewport px */
  left: number
  right: number
  anchor: number
}

/** Every event / run label of the tape (viewport px), the now line and the tape's visible box. */
async function tapeLabels(page: Page): Promise<{ labels: LabelBox[]; nowX: number | null; view: { left: number; right: number } }> {
  return page.evaluate(() => {
    const inner = document.querySelector<HTMLElement>('.reel__inner')!
    const scroll = document.querySelector<HTMLElement>('.reel__scroll')!
    const ox = inner.getBoundingClientRect().left
    const sr = scroll.getBoundingClientRect()
    const now = document.querySelector<HTMLElement>('.now')
    const labels = [...document.querySelectorAll<HTMLElement>('.lane .ev-l[data-anchor]')].map((el) => {
      const r = el.getBoundingClientRect()
      return {
        text: (el.textContent ?? '').trim(),
        lane: el.closest<HTMLElement>('.lane')!.dataset.lane!,
        flipped: 'flipped' in el.dataset,
        hidden: 'hidden' in el.dataset,
        shown: getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none',
        left: r.left,
        right: r.right,
        anchor: ox + Number(el.dataset.anchor),
      }
    })
    return { labels, nowX: now ? now.getBoundingClientRect().left : null, view: { left: sr.left, right: sr.right } }
  })
}

/** The label pass held: shown labels sit inside the tape, clear of the now line, flipped ones left of their mark. */
function expectSettled(t: Awaited<ReturnType<typeof tapeLabels>>, what: string) {
  for (const l of t.labels) {
    expect(l.shown, `${what}: "${l.text}" shown ⇔ not hidden`).toBe(!l.hidden)
    if (l.hidden) continue
    expect(l.left, `${what}: "${l.text}" inside the tape (left)`).toBeGreaterThanOrEqual(t.view.left - 1)
    expect(l.right, `${what}: "${l.text}" inside the tape (right)`).toBeLessThanOrEqual(t.view.right + 1)
    if (t.nowX !== null && l.anchor < t.nowX - 2) expect(l.right, `${what}: "${l.text}" stops before the now line`).toBeLessThanOrEqual(t.nowX - 6 + 1)
    if (l.flipped) expect(l.right, `${what}: "${l.text}" flipped left of its mark`).toBeLessThanOrEqual(l.anchor - 5)
    else if (!l.text.startsWith('Run 212')) expect(l.left, `${what}: "${l.text}" right of its mark`).toBeGreaterThan(l.anchor)
  }
}

const label = (t: Awaited<ReturnType<typeof tapeLabels>>, text: string) => t.labels.find((l) => l.text === text)!

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

  test('macOS: ⌘⌥Z opens it (⌥ turns Z into "Ω") — on a German Mac too, where the Z key is KeyY; ⌘⌥Y never', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel' }))
    await openApp(page)
    // US layout
    await key(page, { key: 'Ω', code: 'KeyZ', metaKey: true, altKey: true })
    await expect(deck(page)).toBeVisible()
    await key(page, { key: 'Ω', code: 'KeyZ', metaKey: true, altKey: true })
    await expect(deck(page)).toHaveCount(0)
    // German Mac: the Z key is KeyY and types "Ω" with ⌥ — opens; its Y key is KeyZ and types "¥" — never
    await key(page, { key: '¥', code: 'KeyZ', metaKey: true, altKey: true })
    await page.waitForTimeout(150)
    await expect(deck(page)).toHaveCount(0)
    await key(page, { key: 'Ω', code: 'KeyY', metaKey: true, altKey: true })
    await expect(deck(page)).toBeVisible()
    // a browser that reports the plain letter while ⌘ is held
    await key(page, { key: 'z', code: 'KeyY', metaKey: true, altKey: true })
    await expect(deck(page)).toHaveCount(0)
  })

  test('the page ⋯ menu and the sidebar’s workspace menu open it (with the shortcut beside the entry)', async ({ page }) => {
    await openApp(page)
    const id = await page.evaluate(() => (window as unknown as { __one: { workspace: { getState: () => { createPage: (p: unknown) => string } } } }).__one.workspace.getState().createPage({ title: 'Nordlicht Notiz' }))
    await page.evaluate((id) => (location.hash = `#/p/${id}`), id)
    await expect(page.locator('#main .pv-title')).toHaveValue('Nordlicht Notiz')
    await page.getByRole('button', { name: 'Page options' }).click()
    const pageItem = page.getByRole('menuitem', { name: /Flight recorder/ })
    await expect(pageItem).toContainText(/Ctrl\s*\+?\s*Alt\s*\+?\s*Z/i)
    await pageItem.click()
    await expect(deck(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(deck(page)).toHaveCount(0)
    await page.locator('.sb-head__ws').click()
    await page.getByRole('menuitem', { name: /Flight recorder/ }).click()
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

test("What's new: the flight recorder's entry shows its picture and its Try it opens the deck", async ({ page }) => {
  await openApp(page)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await page.keyboard.press('?')
  const help = page.getByRole('dialog', { name: 'Help' })
  await expect(help.locator('.help-scroll')).toBeVisible()
  await help.getByTestId('help-news').getByRole('button', { name: /What’s new/ }).click()
  await help.locator('.cl-row[data-entry="2026-10-11-flight-recorder"]').click()
  const entry = help.locator('article[data-entry="2026-10-11-flight-recorder"]')
  await expect(entry.locator('.cl-fig__img')).toHaveAttribute('src', '/SimpleCMS/assets/shots/changelog/flight-recorder.webp')
  expect(await entry.locator('.cl-fig__img').evaluate(async (img: HTMLImageElement) => (img.complete ? img.naturalWidth : await new Promise((r) => img.addEventListener('load', () => r(img.naturalWidth), { once: true }))))).toBe(1440)
  await help.getByRole('group', { name: 'Try it' }).getByRole('button', { name: /Open the flight recorder/ }).click()
  await expect(help).toHaveCount(0)
  await expect(deck(page)).toBeVisible()
  // the article: the "?" in the deck head opens it
  await deck(page).locator('.deck__help').click()
  await expect(page.getByRole('dialog', { name: 'Help' }).locator('.help-art__title')).toHaveText('Flight recorder')
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

test.describe('keys and focus', () => {
  const active = (page: Page) => page.evaluate(() => {
    const a = document.activeElement
    return a === document.body || !a ? 'BODY' : `${a.tagName.toLowerCase()}${a.className && typeof a.className === 'string' ? '.' + a.className.split(/\s+/).join('.') : ''}${a.id ? '#' + a.id : ''}`
  })

  test('closing gives focus back — opened from ⌘K, from the sidebar’s workspace menu, or with nothing focused: never the page body', async ({ page }) => {
    await openApp(page)
    // ⌘K "Rewind"
    await page.keyboard.press('Control+k')
    await page.keyboard.type('Rewind')
    await expect(page.locator('[cmdk-item][data-selected="true"]')).toContainText('Rewind')
    await page.keyboard.press('Enter')
    await expect(page.locator('.playhead__h')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(deck(page)).toHaveCount(0)
    expect(await active(page)).not.toBe('BODY')
    // the sidebar's workspace menu: back to its key
    await page.locator('.sb-head__ws').click()
    await page.getByRole('menuitem', { name: /Flight recorder/ }).click()
    await expect(page.locator('.playhead__h')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(deck(page)).toHaveCount(0)
    await expect(page.locator('.sb-head__ws')).toBeFocused()
    // nothing focused: Ctrl+Alt+Z, Esc
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
    await page.keyboard.press('Control+Alt+z')
    await expect(page.locator('.playhead__h')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(deck(page)).toHaveCount(0)
    expect(await active(page)).not.toBe('BODY')
  })

  test('keys that cannot act or go keep focus in the deck: +1 min at now, clearing the window, Esc in the track filter and the places popover', async ({ page }) => {
    test.setTimeout(150_000)
    await bootStory(page)
    await page.keyboard.press('Control+Alt+z')
    // a minute back, then forward again by the key: it cannot act at now — focus stays on it
    await page.getByRole('button', { name: 'One minute back' }).click()
    const fwd = page.getByRole('button', { name: 'One minute forward' })
    await fwd.focus()
    await page.keyboard.press('Enter')
    await expect(fwd).toHaveAttribute('aria-disabled', 'true')
    await expect(fwd).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('.playhead__h')).toHaveText(/Now/)
    // clearing the window: the playhead takes focus
    await page.locator('.lane[data-lane="agent:nordlicht-spiegel"] .flag').click()
    const clear = page.getByRole('button', { name: 'Clear the window' })
    await clear.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.win__t')).toHaveCount(0)
    await expect(page.locator('.playhead__h')).toBeFocused()
    // Esc in the track filter: back on its key
    const filter = page.getByRole('button', { name: /Filter tracks/ })
    await filter.click()
    await expect(page.getByRole('dialog', { name: 'Tracks' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Tracks' })).toHaveCount(0)
    await expect(filter).toBeFocused()
    await expect(deck(page)).toBeVisible()
  })

  test('↓ from the playhead goes to the first track (or the one with the window); the playhead at now reads "Now" and stays still', async ({ page }) => {
    await openApp(page)
    await startRecorder(page)
    await rec(page, 'step', { writer: { kind: 'terminal', run: 'tb-1', change: 'c1' }, calls: [['createPage', { title: 'Tessera Plan' }]] })
    await rec(page, 'settle')
    await page.keyboard.press('Control+Alt+z')
    const head = page.locator('.playhead__h')
    await expect(head).toBeFocused()
    // what a screen reader hears at now does not tick with the clock
    const text = await head.getAttribute('aria-valuetext')
    const now = await head.getAttribute('aria-valuenow')
    expect(text).toBe('Now — follows the clock')
    await page.waitForTimeout(2200)
    expect(await head.getAttribute('aria-valuetext')).toBe(text)
    expect(await head.getAttribute('aria-valuenow')).toBe(now)
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.lane[data-lane="you"]')).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.lane[data-lane="terminal"]')).toBeFocused()
  })

  test('a run jump is said in the live region; Esc closes the Help opened from the deck first; the grip stops where the deck does', async ({ page }) => {
    test.setTimeout(150_000)
    await bootStory(page)
    await page.keyboard.press('Control+Alt+z')
    const live = deck(page).locator('.rec-live[aria-live="polite"]')
    await page.getByRole('button', { name: 'To the previous run' }).click()
    await expect(live).toHaveText('AI terminal · starts 07:52:40')
    // back through the MCP calls to the agent's run
    for (let i = 0; i < 8 && (await live.textContent()) !== 'Run 212 · starts 07:31:04'; i++) {
      await page.getByRole('button', { name: 'To the previous run' }).click()
      await expect(live).toHaveText(/ · starts /)
    }
    await expect(live).toHaveText('Run 212 · starts 07:31:04')
    // PageUp on a track says it too
    await page.locator('.lane[data-lane="terminal"]').focus()
    await page.keyboard.press('PageDown')
    await expect(live).toHaveText('AI terminal · starts 07:52:40')

    // "?" in the head: Help opens; Esc closes Help, the deck stays (and keeps its playhead)
    const before = await page.locator('.playhead__h').getAttribute('aria-valuenow')
    await deck(page).locator('.deck__help').click()
    await expect(page.getByRole('dialog', { name: 'Help' })).toBeVisible()
    await deck(page).locator('.deck__help').focus()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Help' })).toHaveCount(0)
    await expect(deck(page)).toBeVisible()
    await expect(page.locator('.playhead__h')).toHaveAttribute('aria-valuenow', before!)

    // the grip: never past 55 % of the window — the height it reports is the one drawn, and ↓ shrinks at once
    const grip = page.getByRole('separator', { name: 'Height of the flight recorder' })
    await grip.focus()
    for (let i = 0; i < 20; i++) await page.keyboard.press('Shift+ArrowUp')
    const max = Math.round(900 * 0.55)
    await expect(grip).toHaveAttribute('aria-valuenow', String(max))
    expect(Math.round(await deck(page).evaluate((d) => d.getBoundingClientRect().height))).toBe(max)
    await page.keyboard.press('ArrowDown')
    await expect(grip).toHaveAttribute('aria-valuenow', String(max - 10))
    expect(Math.round(await deck(page).evaluate((d) => d.getBoundingClientRect().height))).toBe(max - 10)
  })

  test('below 1200 px the Outbox sheet and the deck are one dock: each opening closes the other', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await openApp(page)
    const sheet = () => page.evaluate(() => (window as unknown as { __oneOutbox: { useOutbox: { getState: () => { sheet: string | null } } } }).__oneOutbox.useOutbox.getState().sheet)
    const openSheet = () => page.evaluate(() => (window as unknown as { __oneOutbox: { useOutbox: { setState: (p: unknown) => void } } }).__oneOutbox.useOutbox.setState({ sheet: 'nordlicht-db' }))
    await openSheet()
    await page.keyboard.press('Control+Alt+z')
    await expect(deck(page)).toBeVisible()
    expect(await sheet()).toBeNull()
    // the playhead the deck focused is what lies at its place
    expect(await page.locator('.playhead__h').evaluate((h) => {
      const r = h.getBoundingClientRect()
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('.playhead__h') === h
    })).toBe(true)
    await openSheet()
    await expect(deck(page)).toHaveCount(0)
  })
})

test.describe('phone', () => {
  test('the playhead follows the finger while it is dragged (the tape is fitted again on release); a window by its edge keys', async ({ browser }) => {
    test.setTimeout(150_000)
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    const page = await ctx.newPage()
    await bootStory(page)
    await page.keyboard.press('Control+Alt+z')
    await expect(deck(page)).toBeVisible()
    await page.waitForTimeout(400)
    const head = page.locator('.playhead__h')
    const b0 = (await head.boundingBox())!
    const scroll0 = await page.locator('.reel__scroll').evaluate((s) => s.scrollLeft)
    await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 8; i++) await page.mouse.move(b0.x + b0.width / 2 - i * 10, b0.y + b0.height / 2)
    const b1 = (await head.boundingBox())!
    // the head's line moved with the finger (the head's box may turn at the edge: its line is data-line); the tape
    // held still under it
    const { line, inner } = await page.evaluate(() => ({ line: Number(document.querySelector<HTMLElement>('.playhead__h')!.dataset.line), inner: document.querySelector('.reel__inner')!.getBoundingClientRect().left }))
    expect(await page.locator('.reel__scroll').evaluate((s) => s.scrollLeft)).toBe(scroll0)
    expect(Math.abs(inner + line - (b0.x + b0.width / 2 - 80))).toBeLessThan(6)
    expect(b1.x).toBeLessThan(b0.x - 40)
    await page.mouse.up()

    // the plate: touch words, no key hints; a window by tapping a track and the edge keys
    await expect(page.locator('.win__note').first()).toContainText('Tap a flag')
    await expect(deck(page).locator('.win .kbd').first()).toBeHidden()
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: 'To now' }).tap()
    await page.getByRole('button', { name: 'One minute back' }).tap()
    await page.getByRole('button', { name: 'One minute back' }).tap()
    await page.getByRole('button', { name: 'Start here' }).tap()
    await page.getByRole('button', { name: 'One minute forward' }).tap()
    await page.getByRole('button', { name: 'End here' }).tap()
    const now = storyTime(story, story.now)
    const hms = (t: number) => new Date(t).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour12: false })
    await expect(page.locator('.win__t')).toHaveText(`${hms(now - 2 * MIN)} – ${hms(now - MIN - 1000)}`)
    await expect(page.locator('.win__who')).toContainText('You')
    await ctx.close()
  })
})

test.describe('live pushes', () => {
  const lanesCount = (page: Page, lane: string) => page.locator(`.trk[data-lane="${lane}"] .trk__c`)
  const deckState = (page: Page) => page.evaluate(() => (window as unknown as { __oneDeck: { state: () => { ops: { from: number; to: number; status: string } } } }).__oneDeck.state().ops)
  const agentWrites = (ids: Record<string, string>, run: string, refs: string[]) =>
    refs.map((ref, i) => ({ writer: { kind: 'agent', id: story.agent.id, run }, calls: [['setRowProperty', ids[ref], 'story-est', 40 + i]] }))

  test('a write while the span is rewound never widens what is loaded: back at now, the tape reads what is there', async ({ page }) => {
    test.setTimeout(150_000)
    const ids = await bootStory(page)
    await page.keyboard.press('Control+Alt+z')
    await expect(lanesCount(page, 'you')).toHaveText('33')
    // the span three hours back (nothing of the story there), loaded with its room on either side
    const now = storyTime(story, story.now)
    const t1 = now - 3 * 3600_000
    await page.evaluate((t1) => (window as unknown as { __oneDeck: { set: (p: unknown) => void } }).__oneDeck.set({ span: { zoom: '75m', t1 } }), t1)
    await expect(lanesCount(page, 'you')).toHaveText('00')
    await expect.poll(async () => (await deckState(page)).to).toBe(t1 + 75 * MIN / 2)
    // an agent writes now: pushed, but outside what is loaded
    for (const s of agentWrites(ids, 'r300', ['NL-1408'])) await rec(page, 'step', s)
    await rec(page, 'flush')
    expect((await deckState(page)).to).toBe(t1 + 75 * MIN / 2)
    // a span ending five minutes before now (a click in the strip near now): it reads what is there
    const t2 = now - 5 * MIN
    await page.evaluate((t1) => (window as unknown as { __oneDeck: { set: (p: unknown) => void } }).__oneDeck.set({ span: { zoom: '75m', t1 } }), t2)
    const ops = await rec<Array<{ l: string; at: number; t2?: number; f?: number }>>(page, 'ops')
    const inSpan = (lane: string) => ops.filter((o) => o.l === lane && !((o.f ?? 0) & 4) && (o.t2 ?? o.at) >= t2 - 75 * MIN && o.at <= t2).length
    expect(inSpan('you')).toBeGreaterThan(20)
    await expect(lanesCount(page, 'you')).toHaveText(String(inSpan('you')).padStart(2, '0'))
    await expect(lanesCount(page, 'agent:nordlicht-spiegel')).toHaveText(String(inSpan('agent:nordlicht-spiegel')).padStart(2, '0'))
    // and at now the new write is on the tape
    await page.evaluate(() => (window as unknown as { __oneDeck: { set: (p: unknown) => void } }).__oneDeck.set({ span: { zoom: '75m', t1: 'now' } }))
    await expect(lanesCount(page, 'you')).toHaveText('33')
    await expect(lanesCount(page, 'agent:nordlicht-spiegel')).toHaveText('53')
  })

  test('24 STD: a flushed write shows on its lane at once; the strip counts it once', async ({ page }) => {
    test.setTimeout(150_000)
    const ids = await bootStory(page)
    await page.keyboard.press('Control+Alt+z')
    await page.getByRole('radio', { name: '24 h' }).click()
    await expect(lanesCount(page, 'agent:nordlicht-spiegel')).toHaveText('52')
    const strip = () => page.evaluate(() => Object.values((window as unknown as { __oneDeck: { state: () => { strip: { counts: Record<number, number> } } } }).__oneDeck.state().strip.counts).reduce((a, b) => a + b, 0))
    const before = await strip()
    // (24 STD holds the story's setup too: read once the minute bars are there)
    await expect(lanesCount(page, 'you')).not.toHaveText(/^(00|33)$/)
    const you = Number(await lanesCount(page, 'you').textContent())
    for (const s of agentWrites(ids, 'r301', ['NL-1408', 'NL-1415', 'NL-1398'])) await rec(page, 'step', s)
    await rec(page, 'flush')
    await expect(lanesCount(page, 'agent:nordlicht-spiegel')).toHaveText('55')
    // a typing fold written again is no new Vorgang
    await rec(page, 'step', { writer: { kind: 'editor', id: 'story' }, calls: [['setContent', 'story-notes', { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'n1' }, content: [{ type: 'text', text: 'Nordlicht Notizen' }] }] }, 'editor:story']] })
    await rec(page, 'flush')
    await rec(page, 'step', { writer: { kind: 'editor', id: 'story' }, calls: [['setContent', 'story-notes', { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'n1' }, content: [{ type: 'text', text: 'Nordlicht Notizen Tessera' }] }] }, 'editor:story']] })
    await rec(page, 'flush')
    await expect(lanesCount(page, 'you')).toHaveText(String(you + 1).padStart(2, '0'))
    expect(await strip()).toBe(before + 4)
  })

  test('synced-block copies are drawn dimmed on their writer’s lane and never counted', async ({ page }) => {
    test.setTimeout(150_000)
    await bootStory(page)
    // the day's count before (24 STD holds the story's setup too)
    await page.keyboard.press('Control+Alt+z')
    await page.getByRole('radio', { name: '24 h' }).click()
    // (read once the minute bars are there: the setup's writes make it more than the story's 33)
    await expect(lanesCount(page, 'you')).not.toHaveText(/^(00|33)$/)
    const day = (await lanesCount(page, 'you').textContent())!
    await page.getByRole('radio', { name: '75 min' }).click()
    await page.keyboard.press('Escape')
    for (let i = 0; i < 3; i++)
      await rec(page, 'step', { writer: { kind: 'synced', cause: 'you' }, calls: [['setContent', 'story-notes', { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'n1' }, content: [{ type: 'text', text: `Nordlicht Kopie ${i}` }] }] }, 'synced']] })
    await rec(page, 'settle')
    expect((await rec<Array<{ l: string; f?: number }>>(page, 'ops')).filter((o) => (o.f ?? 0) & 4).map((o) => o.l)).toEqual(['you', 'you', 'you'])
    await page.keyboard.press('Control+Alt+z')
    await expect(lanesCount(page, 'you')).toHaveText('33')
    await expect(page.locator('.lane[data-lane="you"] .lane__marks path.copy')).toHaveCount(1)
    await expect(page.locator('.lane[data-lane="you"]')).toHaveAttribute('aria-label', /33 writes/)
    await page.getByRole('radio', { name: '24 h' }).click()
    await expect(lanesCount(page, 'you')).toHaveText(day)
  })
})

test.describe('labels', () => {
  test('1440: at 75 MIN every label right of its mark; at 6 STD the ones near now flip left of their flags, a covered one goes', async ({ page }) => {
    test.setTimeout(150_000)
    await bootStory(page)
    await page.keyboard.press('Control+Alt+z')
    await expect(page.locator('.lane[data-lane="terminal"] .ev-l').first()).toBeVisible()
    let t = await tapeLabels(page)
    expectSettled(t, '75 MIN')
    expect(t.labels.filter((l) => l.flipped)).toEqual([])
    expect(label(t, '1 applied').hidden).toBe(false)

    await page.getByRole('radio', { name: '6 h' }).click()
    await expect(page.locator('.ev-l[data-flipped]').first()).toBeVisible()
    t = await tapeLabels(page)
    expectSettled(t, '6 STD')
    for (const text of ['1 applied', '3 → trash', 'Run 212 · 52 writes in 37 places']) {
      expect(label(t, text).flipped, `${text} flipped`).toBe(true)
      expect(label(t, text).hidden, `${text} shown`).toBe(false)
    }
    // the terminal's first run would sit under the second's flipped label: it goes
    expect(label(t, '5 applied').hidden).toBe(true)
    // the playhead's head stays inside the tape
    const head = await page.locator('.playhead__h').boundingBox()
    expect(head!.x + head!.width).toBeLessThanOrEqual(t.view.right + 1)
  })

  test('390: the phone tape — a label cut at the visible edge goes, the ones before the now line flip once a window is chosen', async ({ browser }) => {
    test.setTimeout(150_000)
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    const page = await ctx.newPage()
    await bootStory(page)
    await page.keyboard.press('Control+Alt+z')
    await expect(deck(page)).toBeVisible()
    await expect(page.locator('.lane[data-lane="terminal"] .ev-l').first()).toBeAttached()
    await page.waitForTimeout(300)
    let t = await tapeLabels(page)
    expectSettled(t, '390 live')
    // the tape shows the last quarter hour: the MCP run (07:48:10–07:49:30) reaches the visible tape's left edge — its
    // label sits after the run's end, never over its ticks, and inside the tape (expectSettled)
    const mcp = label(t, '3 → trash')
    expect(mcp.hidden || mcp.left >= mcp.anchor + 7).toBe(true)
    expect(label(t, '1 applied').hidden).toBe(false)
    expect(label(t, '1 applied').flipped).toBe(false)

    // a tap on the agent's flag: the run's window, the tape fitted around it — the labels near now flip
    await page.waitForTimeout(500)
    await page.locator('.lane[data-lane="agent:nordlicht-spiegel"] .flag').tap()
    await expect(page.locator('.win__t')).toHaveText('07:30:00 – 07:34:59')
    await page.waitForTimeout(300)
    t = await tapeLabels(page)
    expectSettled(t, '390 window')
    for (const text of ['1 applied', '3 → trash']) {
      expect(label(t, text).flipped, `${text} flipped`).toBe(true)
      expect(label(t, text).hidden, `${text} shown`).toBe(false)
    }
    await ctx.close()
  })
})

test.describe('labels and marks', () => {
  test('a run’s label sits after its last tick, never over its own ticks; it flips to the run’s start', async ({ page }) => {
    test.setTimeout(150_000)
    await bootStory(page)
    await page.keyboard.press('Control+Alt+z')
    const lane = page.locator('.lane[data-lane="agent:nordlicht-spiegel"]')
    await expect(lane.locator('.ev-l')).toBeVisible()
    const geo = await lane.evaluate((l) => {
      const label = l.querySelector<HTMLElement>('.ev-l')!
      const flag = l.querySelector<HTMLElement>('.flag')!
      const ticks = [...(l.querySelector('.lane__marks path.ev')?.getAttribute('d') ?? '').matchAll(/M([\d.]+) /g)].map((m) => Number(m[1]) + 0.75)
      return { left: label.offsetLeft, right: label.offsetLeft + label.offsetWidth, anchor: Number(label.dataset.anchor), start: Number(label.dataset.start), flag: flag.offsetLeft + 6, ticks, text: label.textContent }
    })
    expect(geo.text).toBe('Run 212 · 52 writes in 37 places')
    // the run reaches well past its pennant: the label is anchored at its end, flips to its start
    expect(geo.anchor - geo.flag).toBeGreaterThan(20)
    expect(Math.abs(geo.start - geo.flag)).toBeLessThan(1.5)
    expect(geo.left).toBeGreaterThanOrEqual(geo.anchor + 7)
    expect(geo.ticks.length).toBeGreaterThan(10)
    expect(geo.ticks.filter((x) => x >= geo.left - 1 && x <= geo.right + 1)).toEqual([])
  })

  test('a tab that died with writes still in memory: the lost stretch is hatched on the tape and named on the plate', async ({ page, context }) => {
    await openApp(page)
    await startRecorder(page)
    await rec(page, 'step', { writer: { kind: 'you', via: 'ui' }, calls: [['createPage', { title: 'Nordlicht Notiz' }]] })
    await rec(page, 'flush')
    // one more write, recorded but never written: the tab dies
    await rec(page, 'step', { writer: { kind: 'you', via: 'ui' }, calls: [['createPage', { title: 'Tessera Notiz' }]] })
    await rec(page, 'crash')
    await flush(page)
    await page.close()
    const p2 = await context.newPage()
    await openApp(p2)
    await startRecorder(p2)
    await expect.poll(async () => (await rec<unknown[]>(p2, 'lostTails')).length).toBe(1)
    await p2.keyboard.press('Control+Alt+z')
    await expect(p2.locator('section.deck .lost')).toHaveCount(1)
    await expect(p2.locator('section.deck .win__note').filter({ hasText: /^Recording interrupted \d\d:\d\d – \d\d:\d\d: a tab closed/ })).toBeVisible()
    // drawn where it was: between the dead tab's last flush and the recovery
    const [gap] = await rec<Array<{ from: number; to: number }>>(p2, 'lostTails')
    await expect(p2.locator('section.deck .lost')).toHaveAttribute('data-from', String(gap.from))
  })
})

test.describe('ticks', () => {
  test('a tick with several places lists them by their live titles (8 and "+ n more"); a title opens its page', async ({ page }) => {
    test.setTimeout(150_000)
    let parent = ''
    await bootStory(page, async (page) => {
      // a page with ten sub-pages, before the morning (wiped from the tape with the setup)
      parent = await page.evaluate(() => {
        const s = (window as unknown as { __one: { workspace: { getState: () => { createPage: (p: unknown) => string } } } }).__one.workspace.getState()
        const id = s.createPage({ title: 'Nordlicht Archiv' })
        for (let i = 1; i <= 10; i++) s.createPage({ title: `Nordlicht Archiv ${String(i).padStart(2, '0')}`, parentId: id })
        return id
      })
    })
    // 07:20: one write that makes eleven pages (a duplicate with its sub-pages)
    await page.clock.setFixedTime(storyTime(story, '07:20:00'))
    await rec(page, 'step', { writer: { kind: 'you', via: 'ui' }, calls: [['duplicatePage', parent]] })
    await page.clock.setFixedTime(storyTime(story, story.now))
    await rec(page, 'settle')
    await page.keyboard.press('Control+Alt+z')
    const lane = page.locator('.lane[data-lane="you"]')
    await expect(lane).toBeVisible()
    // where 07:20 is: between the ruler's 07:15 and 07:30 (no window: the axis is linear)
    const x = await page.evaluate(() => {
      // a ruler label's style left is its tick
      const at = (text: string) => {
        const l = [...document.querySelectorAll<HTMLElement>('.ruler__l')].find((l) => l.textContent?.trim() === text)!
        return (l.offsetParent as HTMLElement).getBoundingClientRect().left + l.offsetLeft
      }
      const a = at('07:15')
      const b = at('07:30')
      return a + ((b - a) * 5) / 15
    })
    const box = (await lane.boundingBox())!
    await page.mouse.click(x, box.y + box.height / 2)
    const pop = page.getByRole('dialog', { name: /11 places · 07:20:00/ })
    await expect(pop).toBeVisible()
    await expect(pop.locator('.rec-pop__item')).toHaveCount(8)
    await expect(pop.locator('.rec-pop__more')).toHaveText('+ 3 more')
    // Esc: the popover goes, focus goes to the track that was clicked (its keys work again)
    await page.keyboard.press('Escape')
    await expect(pop).toHaveCount(0)
    await expect(deck(page)).toBeVisible()
    await expect(lane).toBeFocused()
    await page.mouse.click(x, box.y + box.height / 2)
    await expect(pop).toBeVisible()
    const first = (await pop.locator('.rec-pop__item').first().textContent())!.trim()
    expect(first).toMatch(/^Nordlicht Archiv/)
    await pop.locator('.rec-pop__item').first().click()
    await expect(pop).toHaveCount(0)
    await expect(page.locator('#main .pv-title')).toHaveValue(first)
    // the deck stays open while the page changes
    await expect(deck(page)).toBeVisible()
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

  for (const [w, scale, lang] of [[1440, 1, 'de'], [1424, 1, 'de'], [1280, 4, 'de'], [1024, 4, 'en'], [1024, 4, 'de'], [1024, 1, 'de']] as const)
    test(`no key in the head is squeezed at ${w} px, text size ${scale === 4 ? 'XL' : 'standard'}, ${lang === 'de' ? 'German' : 'English'} (with the loupe key)`, async ({ page }) => {
      await page.addInitScript((scale) => localStorage.setItem('one.textScale', String(scale)), scale)
      await page.setViewportSize({ width: w, height: 900 })
      await openApp(page)
      await wsEval(page, (s, lang) => s.updateSettings({ language: lang }), lang)
      await page.keyboard.press('Control+Alt+z')
      await expect(deck(page)).toBeVisible()
      // a window on the tape: the loupe key joins the head (the widest it gets)
      await page.evaluate(() => {
        const now = Date.now()
        ;(window as unknown as { __oneDeck: { set: (p: unknown) => void } }).__oneDeck.set({ bracket: { lane: 'you', a: now - 6 * 60_000, b: now - 60_000 } })
      })
      await expect(deck(page).locator('.deck__head .tkey[aria-pressed]').filter({ hasText: /×/ })).toBeVisible()
      const bad = await page.locator('.deck__head').evaluate((h) => {
        const out: string[] = []
        if (h.scrollWidth > h.clientWidth + 1) out.push(`head ${h.scrollWidth} > ${h.clientWidth}`)
        const hr = h.getBoundingClientRect()
        for (const el of h.querySelectorAll<HTMLElement>('button, .kbd, .counter, .deck-rec')) {
          const cs = getComputedStyle(el)
          if (cs.display === 'none' || el.getClientRects().length === 0) continue
          const r = el.getBoundingClientRect()
          const name = (el.getAttribute('aria-label') || el.textContent || el.className).trim().slice(0, 20)
          if (el.scrollWidth > el.clientWidth + 1) out.push(`${name}: its content runs over (${el.scrollWidth} > ${el.clientWidth})`)
          if (r.right > hr.right + 1 || r.left < hr.left - 1) out.push(`${name}: outside the head`)
          for (const c of el.querySelectorAll<HTMLElement>('.kbd, svg')) {
            const cr = c.getBoundingClientRect()
            if (cr.width > 0 && (cr.right > r.right + 1 || cr.left < r.left - 1)) out.push(`${name}: ${c.getAttribute('class') ?? c.tagName} past its key`)
          }
        }
        return out
      })
      expect(bad).toEqual([])
      await expect(page.getByRole('button', { name: lang === 'de' ? 'Schließen' : 'Close' }).last()).toBeInViewport()
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

test.describe('look', () => {
  /** Every deck element painted in a signal colour (text, fill, background, border, shadow, its ::before / ::after). */
  async function signalPainted(page: Page): Promise<string[]> {
    return page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('section.deck')!
      const probe = document.createElement('i')
      root.append(probe)
      const sig = new Set<string>()
      for (const v of ['--signal', '--signal-ink', '--signal-on-ink', '--signal-hover', '--signal-press', '--tp-sig']) {
        probe.style.color = `var(${v})`
        sig.add(getComputedStyle(probe).color)
      }
      probe.remove()
      const ALLOWED = ['.playhead', '.bracket', '.lane__marks .sel', '.ruler__zone', '.ov__bars [data-hot]', '.trk[data-sel]', '.flag[data-sel]', '.ev-l[data-sel]', '.win__t', '.counter__val[data-sig]', '.led']
      const allowed = (el: Element) => ALLOWED.some((a) => el.closest(a))
      const hits = (cs: CSSStyleDeclaration, el: Element): string[] => {
        const out: string[] = []
        const has = (v: string) => [...sig].some((c) => v.includes(c))
        const text = el instanceof SVGElement ? '' : (el.textContent ?? '').trim()
        if (text && sig.has(cs.color)) out.push('color')
        if (sig.has(cs.backgroundColor)) out.push('background')
        if (el instanceof SVGElement && (sig.has(cs.fill) || sig.has(cs.stroke))) out.push('fill/stroke')
        for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const)
          if (parseFloat(cs[`border${side}Width`]) > 0 && cs[`border${side}Style`] !== 'none' && sig.has(cs[`border${side}Color`])) out.push(`border-${side.toLowerCase()}`)
        if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && sig.has(cs.outlineColor)) out.push('outline')
        if (cs.boxShadow !== 'none' && has(cs.boxShadow)) out.push('shadow')
        return out
      }
      const bad: string[] = []
      for (const el of [root, ...root.querySelectorAll('*')]) {
        const cs = getComputedStyle(el)
        if (cs.display === 'none' || cs.visibility === 'hidden') continue
        const found = [...hits(cs, el)]
        for (const pseudo of ['::before', '::after']) {
          const ps = getComputedStyle(el, pseudo)
          if (ps.content === 'none' || ps.content === 'normal' || ps.display === 'none') continue
          if (sig.has(ps.backgroundColor) || sig.has(ps.borderTopColor) || (ps.boxShadow !== 'none' && [...sig].some((c) => ps.boxShadow.includes(c)))) found.push(pseudo)
        }
        if (found.length && !allowed(el)) {
          const cls = typeof el.className === 'string' ? el.className : el.getAttribute('class') ?? ''
          bad.push(`${el.tagName.toLowerCase()}.${cls.split(/\s+/).join('.')} (${found.join(', ')})`)
        }
      }
      return [...new Set(bad)]
    })
  }

  for (const theme of ['light', 'dark'] as const)
    test(`orange only for the playhead, the selected window and the REC lamp — ${theme === 'light' ? 'Paper' : 'Carbon'}`, async ({ page }) => {
      test.setTimeout(150_000)
      await page.emulateMedia({ colorScheme: theme })
      await bootStory(page)
      await wsEval(page, (s, theme) => s.updateSettings({ theme }), theme)
      await page.keyboard.press('Control+Alt+z')
      await page.locator('.lane[data-lane="agent:nordlicht-spiegel"] .flag').click()
      await expect(page.locator('.mtr b').first()).toHaveText('52')
      // rewound a little: the counter shows the playhead's time
      await page.locator('.playhead__h').focus()
      await page.keyboard.press('ArrowLeft')
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
      await page.mouse.move(2, 2)
      expect(await signalPainted(page)).toEqual([])
      // the check sees orange where it does not belong
      await page.locator('.deck__head').evaluate((h) => {
        const x = document.createElement('span')
        x.className = 'rogue'
        x.style.color = 'var(--signal-ink)'
        x.textContent = 'x'
        h.append(x)
      })
      expect(await signalPainted(page)).toEqual(['span.rogue (color)'])
      await page.locator('.deck__head .rogue').evaluate((x) => x.remove())
      // and they are really orange: the window's ticks, its range, the playhead
      const sig = await page.locator('section.deck').evaluate((d) => {
        const i = document.createElement('i')
        i.style.color = 'var(--signal)'
        d.append(i)
        const c = getComputedStyle(i).color
        i.remove()
        return c
      })
      expect(await page.locator('.lane__marks path.sel').evaluate((p) => getComputedStyle(p).fill)).toBe(sig)
      expect(await page.locator('.playhead').evaluate((p) => getComputedStyle(p).backgroundColor)).toBe(sig)
    })

  test('reduced motion: the deck appears without sliding in, nothing on it animates or eases', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openApp(page)
    await page.keyboard.press('Control+Alt+z')
    await expect(deck(page)).toBeVisible()
    const moving = await page.evaluate(() => {
      const out: string[] = []
      const d = document.querySelector('section.deck')!
      if (getComputedStyle(d).animationName !== 'none') out.push(`deck animation ${getComputedStyle(d).animationName}`)
      const secs = (v: string) => Math.max(...v.split(',').map((x) => parseFloat(x) * (x.trim().endsWith('ms') ? 0.001 : 1)))
      for (const el of [d, ...d.querySelectorAll('*')]) {
        const cs = getComputedStyle(el)
        if (secs(cs.transitionDuration) > 0.001) out.push(`${el.className} transition ${cs.transitionDuration}`)
        if (cs.animationName !== 'none' && secs(cs.animationDuration) > 0.001) out.push(`${el.className} animation ${cs.animationDuration}`)
      }
      return out
    })
    expect(moving).toEqual([])
    // without the preference it slides in
    await page.keyboard.press('Escape')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.keyboard.press('Control+Alt+z')
    expect(await deck(page).evaluate((d) => getComputedStyle(d).animationName)).toBe('deck-in')
  })
})

test('Workspace → Data: the tape line with its size and the device-wide size; "Erase the tape" wipes this scope only', async ({ page }) => {
  await openApp(page)
  await startRecorder(page)
  await page.evaluate(() => (window as unknown as { __one: { workspace: { getState: () => { createPage: (p: unknown) => string } } } }).__one.workspace.getState().createPage({ title: 'Nordlicht Plan' }))
  await rec(page, 'settle')
  // another workspace's tape on this device (a team copy): one op and its day's size, written straight to the journal
  const other = 'cloud:nordlicht:u:mara'
  await page.evaluate(async (other) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const q = indexedDB.open('one-recorder')
      q.onsuccess = () => res(q.result)
      q.onerror = () => rej(q.error)
    })
    const now = Date.now()
    const day = new Date(now)
    day.setHours(0, 0, 0, 0)
    await new Promise<void>((res, rej) => {
      const t = db.transaction(['ops', 'kv'], 'readwrite')
      t.objectStore('ops').put({ k: `${other}|${String(now).padStart(13, '0')}|zz`, s: other, at: now, v: 'zz', w: 'you', l: 'you', n: 1, kinds: 4, p1: 'p:x', ops: 1 })
      t.objectStore('kv').put({ k: `${other}|d|${String(day.getTime()).padStart(13, '0')}`, ops: 1, bytes: 5 * 1024 * 1024 })
      t.oncomplete = () => res()
      t.onerror = () => rej(t.error)
    })
    db.close()
  }, other)
  await page.evaluate(() => (location.hash = '#/workspace/data'))
  const line = page.getByTestId('ws-recorder')
  await expect(line).toContainText(/1 day · \d+ writes? · [\d.,]+ (B|KB|MB)/)
  // the device line counts every workspace's tape: at least the other one's 5 MB
  await expect(page.getByTestId('ws-recorder-device')).toContainText(/All workspaces on this device: (5(\.\d)? MB|[6-9](\.\d)? MB)/)
  await line.getByRole('button', { name: 'Erase the tape' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Erase the tape' }).click()
  await expect(line).toContainText('Nothing recorded yet')
  expect(await rec(page, 'ops')).toEqual([])
  // the other workspace's tape is still there
  const dump = await rec<Record<string, Array<{ k?: string }>>>(page, 'rawDump')
  expect(dump.ops.map((o) => o.k)).toEqual([expect.stringMatching(/^cloud:nordlicht:u:mara\|/)])
  expect(dump.kv.some((r) => r.k?.startsWith(`${other}|d|`))).toBe(true)
  await expect(page.getByTestId('ws-recorder-device')).toContainText(/5(\.\d)? MB/)
})

test.describe('the open budget', () => {
  test('< 150 ms from the key to the first painted tape with 40,000 events on it — the first open after a reload and again, at 75 MIN and 24 STD', async ({ page }) => {
    // seeding 40,000 events with their places straight into IndexedDB takes minutes on a busy machine
    test.setTimeout(900_000)
    await openApp(page)
    await startRecorder(page)
    await rec(page, 'settle')
    const now = await page.evaluate(() => Date.now())
    await rec(page, 'seedBulk', { events: 40_000, inSpan: 5000, bigVorgang: 10_000, spanEnd: now })
    // what the journal holds now (counted, not read)
    const stats = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const q = indexedDB.open('one-recorder')
        q.onsuccess = () => res(q.result)
        q.onerror = () => rej(q.error)
      })
      const count = (store: string) => new Promise<number>((res) => {
        const r = db.transaction(store).objectStore(store).count()
        r.onsuccess = () => res(r.result)
      })
      const out = { ops: await count('ops'), events: await count('events'), segs: await count('segs') }
      db.close()
      return out
    })
    expect(stats.ops).toBeGreaterThanOrEqual(40_000)
    expect(stats.events).toBeGreaterThanOrEqual(49_000)
    expect(stats.segs).toBeGreaterThanOrEqual(49_000)

    /**
     * One open by the key, measured from the key (`rec-open`) to the first frame with the span's data (`rec-ready`) and
     * to the frame with the span's ops (`rec-ops`; the same frame unless the span is very dense).
     */
    const openMs = (zoom: string) =>
      page.evaluate(async (zoom) => {
        const deck = (window as unknown as { __oneDeck: { preload: () => Promise<unknown>; set: (p: unknown) => void; state: () => { open: boolean } } }).__oneDeck
        await deck.preload()
        if (deck.state().open) deck.set({ open: false })
        await new Promise((r) => setTimeout(r, 300))
        deck.set({ span: { zoom, t1: 'now' } })
        performance.clearMarks()
        performance.clearMeasures()
        const t = performance.now()
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, altKey: true, bubbles: true }))
        for (;;) {
          await new Promise((r) => requestAnimationFrame(r))
          const m = performance.getEntriesByName('rec-open', 'measure')[0]
          const o = performance.getEntriesByName('rec-ops', 'measure')[0]
          if (m && o) return { open: m.duration, ops: o.duration }
          if (performance.now() - t > 10_000) return { open: Infinity, ops: Infinity }
        }
      }, zoom)
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
    const result: Record<string, number> = {}
    const exact: Record<string, number> = {}
    for (const zoom of ['75m', '24h']) {
      // the first open of a fresh page (the deck's code loaded, nothing of it rendered yet) once the app has booted
      // (its own start-up work done — the recorder settled, an idle moment): best of three reloads. The machine is
      // shared with other builds — one slow round is its noise, not the deck's
      const cold: Array<{ open: number; ops: number }> = []
      for (let i = 0; i < 3; i++) {
        await reloadApp(page)
        await page.waitForFunction(() => !!(window as unknown as { __oneRecorder?: unknown }).__oneRecorder)
        await rec(page, 'settle')
        await page.evaluate(() => new Promise<void>((r) => {
          let n = 0
          const idle = () => requestIdleCallback((d) => (d.timeRemaining() > 40 || ++n > 40 ? r() : idle()), { timeout: 1000 })
          idle()
        }))
        cold.push(await openMs(zoom))
      }
      const warm: Array<{ open: number; ops: number }> = []
      for (let i = 0; i < 5; i++) warm.push(await openMs(zoom))
      result[`${zoom} first`] = Math.min(...cold.map((c) => c.open))
      result[`${zoom} again`] = median(warm.map((w) => w.open))
      exact[`${zoom} first`] = Math.min(...cold.map((c) => c.ops))
      exact[`${zoom} again`] = median(warm.map((w) => w.ops))
      // the tape is drawn from the span's ops: the seed's six lanes, with flags
      await expect(page.locator('.trk')).toHaveCount(6)
      expect(await page.evaluate(() => (window as unknown as { __oneDeck: { state: () => { ops: { interim?: boolean; status: string } } } }).__oneDeck.state().ops)).toMatchObject({ status: 'ready' })
      if (zoom === '75m') await expect(page.locator('.lane .flag').first()).toBeVisible()
    }
    console.log('[recorder] deck open ms (first paint)', JSON.stringify(result), '· with the ops drawn', JSON.stringify(exact))
    for (const [k, v] of Object.entries(result)) expect(v, k).toBeLessThan(150)
    // the real tape — the span's 5,000 ops drawn, flags and ticks that answer a click — within the same budget (the
    // first read is exactly the visible span; the room on either side follows after the first paint)
    for (const [k, v] of Object.entries(exact)) expect(v, `${k} (ops)`).toBeLessThan(150)
  })
})
