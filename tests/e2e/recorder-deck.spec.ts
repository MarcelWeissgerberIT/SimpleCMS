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

  test('macOS: ⌘⌥Z opens it (⌥ turns Z into "Ω")', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel' }))
    await openApp(page)
    await key(page, { key: 'Ω', code: 'KeyZ', metaKey: true, altKey: true })
    await expect(deck(page)).toBeVisible()
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
    // the tape shows the last quarter hour: the MCP label (07:48) would start left of the visible tape
    expect(label(t, '3 → trash').hidden).toBe(true)
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
     * One open by the key, measured from the key (`rec-open`) to the first frame with the span's data (`rec-ready`; a
     * dense span: its minute histogram) and to the frame with the span's ops (`rec-ops`).
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
      // the first open of a fresh page (the deck's code loaded, nothing of it rendered yet): best of two reloads
      const cold: Array<{ open: number; ops: number }> = []
      for (let i = 0; i < 2; i++) {
        await reloadApp(page)
        await page.waitForFunction(() => !!(window as unknown as { __oneRecorder?: unknown }).__oneRecorder)
        cold.push(await openMs(zoom))
      }
      const warm: Array<{ open: number; ops: number }> = []
      for (let i = 0; i < 3; i++) warm.push(await openMs(zoom))
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
    // the ops follow within a second even for the 5,000 of the span
    for (const [k, v] of Object.entries(exact)) expect(v, `${k} (ops)`).toBeLessThan(1000)
  })
})
