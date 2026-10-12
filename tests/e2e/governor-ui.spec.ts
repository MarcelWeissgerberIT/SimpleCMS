/**
 * Regler (governor) — the UI pieces in the browser, mounted in the seam's test frame (window.__oneGovernor.ui; nothing is
 * wired to the gate in G1 Phase A): the brake note's keys inside a dialog, the halt card never taking the keyboard from
 * someone typing elsewhere (and its keys never acting on a repeat or a key typed just before), its announcement, the
 * card without a price, the plate before the first read, the month bar's spoken sentence, the providers' code plates,
 * bands that never break after the dash, the dial at the largest text size and the keycap on the primary key.
 * Every value is fictional; no AI host is reached.
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval } from './fixtures'

type UiSeam = {
  open: (o?: Record<string, unknown>) => Promise<void>
  show: (kind: string, props: Record<string, unknown>) => Promise<void>
  log: () => Promise<string[]>
  close: () => Promise<void>
}
const ui = <T>(p: Page, fn: (u: UiSeam) => T | Promise<T>): Promise<T> => p.evaluate(`(${fn.toString()})(window.__oneGovernor.ui)`) as Promise<T>
const open = (p: Page, o: Record<string, unknown> = {}) => p.evaluate((x) => (window as unknown as { __oneGovernor: { ui: UiSeam } }).__oneGovernor.ui.open(x), o)
const show = (p: Page, kind: string, props: Record<string, unknown>) => p.evaluate(([k, x]) => (window as unknown as { __oneGovernor: { ui: UiSeam } }).__oneGovernor.ui.show(k as string, x as Record<string, unknown>), [kind, props] as const)
const log = (p: Page) => ui(p, (u) => u.log())

/** Show a piece and press a letter on it one frame after it appeared — its first moment (a key typed just before). */
const showAndPressAtOnce = (p: Page, kind: string, props: Record<string, unknown>, testid: string, key: string) =>
  p.evaluate(
    async ([k, x, id, letter]) => {
      const seen = new Promise<void>((res) => {
        const mo = new MutationObserver(() => {
          const el = document.querySelector(`[data-testid="${id}"]`)
          if (!el) return
          mo.disconnect()
          requestAnimationFrame(() => {
            el.dispatchEvent(new KeyboardEvent('keydown', { key: letter as string, bubbles: true }))
            res()
          })
        })
        mo.observe(document.body, { childList: true, subtree: true })
      })
      await (window as unknown as { __oneGovernor: { ui: UiSeam } }).__oneGovernor.ui.show(k as string, x as Record<string, unknown>)
      await seen
    },
    [kind, props, testid, key] as const,
  )

const NOTE = { detail: 'day', model: 'Opus 5.5', band: { low: 0.3, high: 0.52 }, rest: 0.29, line: { spent: 5.71, limit: 6 }, allow: 1, need: 0.23, cheaper: { label: 'Sonnet 5.5', band: { low: 0.1, high: 0.2 } } }
const HALT = {
  binding: 'day',
  spent: 5.71,
  limit: 6,
  rest: 0.29,
  next: { low: 0.3, high: 0.52 },
  to: 6.23,
  model: 'Opus 5.5',
  allow: 1,
  cheaper: { label: 'Haiku 4.5', band: { low: 0.16, high: 0.195 }, cold: 0.085, tokens: 68_000 },
  staged: 2,
  taskUsd: 1.4,
  at: new Date(2026, 9, 12, 16, 42).getTime(),
  hard: 'Spend limit in the provider console (Nordlicht test)',
}
const NOPRICE = { ...HALT, next: null, to: 5.71, allow: null, cheaper: null }
const PLATE = {
  when: 'Mon 12.10. · 14:06',
  spent: 4.12,
  known: true,
  budget: 6,
  peak: 5.2,
  month: { month: 'October', spent: 33.4, today: 4.12, limit: 120, day: 9, days: 31 },
  hard: [
    { code: 'CL', name: 'Claude', text: 'Spend limit in the Claude Console' },
    { code: 'OR', name: 'OpenRouter', text: 'Key limit at OpenRouter' },
  ],
}

test.describe('the brake note and the halt card: keys and focus', () => {
  test('the brake note inside a dialog (the AI menu, ⌘K, a modal): E, B and Esc work — never a repeat, never a key from just before', async ({ page }) => {
    await openApp(page)
    await open(page, { dialog: true })
    // its first moment: a key typed just before it appeared does nothing
    await showAndPressAtOnce(page, 'note', NOTE, 'gv-brake-note', 'e')
    const note = page.getByTestId('gv-brake-note')
    await expect(note).toBeFocused()
    expect(await log(page)).toEqual([])
    await page.waitForTimeout(450)
    // a held key's repeats never act
    await note.dispatchEvent('keydown', { key: 'e', repeat: true, bubbles: true })
    expect(await log(page)).toEqual([])
    await page.keyboard.press('e')
    await page.keyboard.press('b')
    await page.keyboard.press('Escape')
    expect(await log(page)).toEqual(['note-allow', 'note-cheaper', 'note-cancel'])
    // the sentence describes the group (read on focus)
    const described = await note.getAttribute('aria-describedby')
    await expect(page.locator(`[id="${described}"]`)).toContainText('Over the red line')
    // a field keeps its letters
    await page.getByTestId('gv-h-field').click()
    await page.keyboard.type('be')
    await expect(page.getByTestId('gv-h-field')).toHaveValue('be')
    expect(await log(page)).toEqual(['note-allow', 'note-cheaper', 'note-cancel'])
  })

  test('the halt card never takes the keyboard from someone typing elsewhere; it takes it from nobody or from its own dock', async ({ page }) => {
    await openApp(page)
    await open(page, { region: true })
    const field = page.getByTestId('gv-h-field')
    await field.click()
    await page.keyboard.type('Launch pl')
    // the card appears mid-sentence (a background task reached the line)
    await show(page, 'halt', HALT)
    const card = page.getByTestId('gv-halt')
    await expect(card).toBeVisible()
    await page.keyboard.type('an e')
    await expect(field).toHaveValue('Launch plan e')
    await expect(field).toBeFocused()
    expect(await log(page)).toEqual([])
    // not focused: the live region speaks — empty when mounted, the keys a moment later
    await expect(page.getByTestId('gv-halt-live')).toHaveText('Governor: the next step crosses the line — E, H or Control period')

    // focus in the dock's own prompt: the card takes it, its description says the keys, the live region stays silent
    await open(page, { region: true })
    await page.getByTestId('gv-h-prompt').click()
    await showAndPressAtOnce(page, 'halt', HALT, 'gv-halt', 'e')
    await expect(card).toBeFocused()
    expect(await log(page)).toEqual([])
    const hint = await card.getAttribute('aria-describedby')
    await expect(page.locator(`[id="${hint}"]`)).toHaveText('Governor: the next step crosses the line — E, H or Control period')
    await page.waitForTimeout(450)
    await expect(page.getByTestId('gv-halt-live')).toHaveText('')
    await card.dispatchEvent('keydown', { key: 'h', repeat: true, bubbles: true })
    expect(await log(page)).toEqual([])
    await page.keyboard.press('e')
    await page.keyboard.press('h')
    await page.keyboard.press('Escape')
    expect(await log(page)).toEqual(['halt-allow', 'halt-cheaper', 'halt-escape'])

    // nobody has the keyboard: the card takes it
    await open(page, {})
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await show(page, 'halt', HALT)
    await expect(card).toBeFocused()
  })
})

test.describe('the pieces say what is true', () => {
  test('a halt card without a price: no "needs +0,00", no next step drawn — the dial says the price is missing (EN + DE)', async ({ page }) => {
    await openApp(page)
    await open(page)
    await show(page, 'halt', NOPRICE)
    const card = page.getByTestId('gv-halt')
    await expect(card).toContainText('Opus 5.5 has no price — the budget cannot be kept.')
    await expect(card).not.toContainText('Needs')
    await expect(card).not.toContainText('$0.00')
    await expect(card.locator('.gv-g-of')).toHaveText('next step: no price')
    await expect(card.locator('svg.gv-dial')).toHaveAttribute('aria-label', 'Today $5.71 of $6.00; the next step has no price')
    await expect(card.locator('.gv-g-next')).toHaveCount(0)
    // positive control: with a price and no allowance the need is said
    await show(page, 'halt', { ...HALT, allow: null, next: { low: 1, high: 1.5 }, to: 7.21 })
    await expect(card).toContainText('Needs ≈ +$1.21 — more than one allowance')
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await show(page, 'halt', NOPRICE)
    await expect(card).not.toContainText('Braucht')
    await expect(card.locator('.gv-g-of')).toHaveText('nächster Schritt: kein Preis')
  })

  test('the plate before the first read: "—" and the budget, never "rest = the whole budget"; the month bar says "≈" once; code plates are named', async ({ page }) => {
    await openApp(page)
    await open(page)
    await show(page, 'plate', { ...PLATE, spent: null, known: false })
    const dial = page.locator('.gv-plate svg.gv-dial')
    await expect(dial.locator('.gv-g-big')).toHaveText('—')
    await expect(dial.locator('.gv-g-of')).toHaveText('of $6.00')
    await expect(dial).toHaveAttribute('aria-label', 'Usage today is being read — day budget $6.00')
    // positive control: read
    await show(page, 'plate', PLATE)
    await expect(dial.locator('.gv-g-of')).toHaveText('of $6.00 · rest $1.88')
    await expect(dial).toHaveAttribute('aria-label', 'Usage today $4.12 of $6.00, rest $1.88')
    // the month bar: the forecast's "≈" once in the sentence, and on the plate
    const bar = page.locator('.gv-month__bar')
    const aria = (await bar.getAttribute('aria-label')) ?? ''
    expect(aria.match(/≈/g)?.length).toBe(1)
    expect(aria).toMatch(/forecast ≈\u00a0\$115$/)
    await expect(page.locator('.gv-month__foot b')).toHaveText(/^≈\s\$115$/)
    // the providers' code plates: drawn for the eye, named for screen readers
    const snap = await page.locator('.gv-hard__list').ariaSnapshot()
    expect(snap).toContain('Claude')
    expect(snap).toContain('OpenRouter')
    expect(snap).not.toMatch(/\bCL\b|\bOR\b/)
    await expect(page.locator('.gv-code').first()).toHaveAttribute('aria-hidden', 'true')
  })

  test('a band never breaks after its dash on a narrow card (DE, 390 px, the largest text size)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript(() => localStorage.setItem('one.textScale', '4'))
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await open(page)
    await show(page, 'halt', HALT)
    const lines = await page.locator('.gv-halt__msg').evaluate((el) => {
      const text = el.firstChild as Text
      const rows = (band: string) => {
        const at = (text.textContent ?? '').indexOf(band)
        if (at < 0) return -1
        const r = document.createRange()
        r.setStart(text, at)
        r.setEnd(text, at + band.length)
        return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size
      }
      const kept = rows('0,30–\u20600,52\u00a0$')
      // the control: without the word joiner the same sentence breaks after the dash here
      text.textContent = (text.textContent ?? '').replace('–\u2060', '–')
      return { kept, plain: rows('0,30–0,52\u00a0$') }
    })
    expect(lines).toEqual({ kept: 1, plain: 2 })
  })
})

test.describe('the dial and the keys look right', () => {
  test('the largest text size grows the dial as a whole: its readout stays between the arc’s ends, nothing overlaps (DE)', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('one.textScale', '4'))
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await open(page)
    const check = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<SVGSVGElement>('[data-testid="gv-harness"] svg.gv-dial')].map((svg) => {
          const boxes = [...svg.querySelectorAll<SVGTextElement>(':scope > text')].map((t) => ({ cls: t.getAttribute('class') ?? '', text: t.textContent ?? '', b: t.getBBox() }))
          const hit = (a: DOMRect, b: DOMRect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
          // the numerals against every other engraving (the readout, its line, the unit, the lamp's label)
          const overlaps: string[] = []
          for (const n of boxes.filter((x) => x.cls.startsWith('gv-g-num')))
            for (const o of boxes.filter((x) => !x.cls.startsWith('gv-g-num'))) if (hit(n.b, o.b)) overlaps.push(`${n.text} × ${o.text}`)
          const of = boxes.find((x) => x.cls === 'gv-g-of')?.b
          return { width: svg.getBoundingClientRect().width, overlaps, of: of ? [of.x, of.x + of.width] : null }
        }),
      )
    // over the budget on § 00 (the longest German "of" line) and the halt card's mini dial
    await show(page, 'plate', { ...PLATE, spent: 6.5, month: { ...PLATE.month, spent: 35.78, today: 6.5 } })
    const [plate] = await check()
    await show(page, 'halt', HALT)
    const [halt] = await check()
    for (const d of [plate, halt]) {
      expect(d.overlaps).toEqual([])
      // the track's ends sit at x 46 and 254 of the 300-unit dial
      expect(d.of?.[0]).toBeGreaterThanOrEqual(46)
      expect(d.of?.[1]).toBeLessThanOrEqual(254)
    }
    // the dial is drawn larger than at the standard size (210 px on the card → × 17 / 14)
    expect(halt.width).toBeGreaterThan(250)
    await page.screenshot({ path: test.info().outputPath('dial-xl.png') })
  })

  test('the E keycap on the primary key is cut out of the signal: transparent, on-signal text', async ({ page }) => {
    await openApp(page)
    await open(page)
    await show(page, 'note', NOTE)
    const cap = page.locator('.gv-key.btn--primary .kbd')
    const style = await cap.evaluate((el) => {
      const c = getComputedStyle(el)
      const key = getComputedStyle(el.closest('.btn') as Element)
      return { bg: c.backgroundColor, color: c.color, keyColor: key.color }
    })
    expect(style.bg).toBe('rgba(0, 0, 0, 0)')
    expect(style.color).toBe(style.keyColor)
  })
})
