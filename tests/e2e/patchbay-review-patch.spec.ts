/**
 * The Patchbay after the review's "Fix (patch)" findings — what the rack, the plate, the fuse list and the phone's
 * strands promise against the mocks (killer/8-patchbay) and the lens rules:
 *  - the § numbers of the column heads and the strand sections are ink-2 like their names (orange stays a fuse's);
 *  - an allowed fuse's leader is ink like its glyph, never orange;
 *  - net chips are solid in both themes; the outside tag's letters sit on a solid backing, never on the hatch;
 *  - a mode tag is never cut while a jack label could give way; a net chip shows a whole word or goes;
 *  - § 02 / § 03 bodies line up whether a module has an in-jack or not;
 *  - the plate's path is one row or the column — never a wrapped row with a dangling arrow;
 *  - the fuse list's selected tab shows the focus ring with the keyboard (WCAG 2.4.7);
 *  - forced colours: the legend matches the drawing, every keyboard stop shows an outline.
 * The phone's floating "running" chip (no card moves) is in patchbay.spec.ts' strands case.
 * Every name is fictional (tests/fixtures/patchbay.ts).
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval } from './fixtures'
import { mock1, seedPatchbay, type PbWorld } from '../fixtures/patchbay'

const module = (page: Page, key: string) => page.locator(`.pb-mod[data-key="${key}"]`)

async function openRack(page: Page, w: PbWorld = mock1(), lang: 'en' | 'de' = 'en') {
  await openApp(page)
  await seedPatchbay(page, w)
  if (lang === 'de') await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
  await page.evaluate(() => (window.location.hash = '#/patchbay'))
  await expect(page.getByTestId('patchbay-page')).toBeVisible()
}

/** A colour as the browser computes it (a token or a system colour). */
const colorOf = (page: Page, value: string) =>
  page.evaluate((v) => {
    const el = document.createElement('i')
    el.style.color = v
    document.body.append(el)
    const c = getComputedStyle(el).color
    el.remove()
    return c
  }, value)

type Fuse = { key: string; label: string; sig?: string; parts?: Record<string, string> }
const fuses = (page: Page) => page.evaluate(() => (window as unknown as { __onePatchbay: { model: () => { fuses: Fuse[] } | null } }).__onePatchbay.model()?.fuses ?? [])

test.describe('review (patch) · the rack and the plate', () => {
  test('the § numbers are ink-2 like their names — also on a rack with no fuse at all', async ({ page }) => {
    await openRack(page)
    const ink2 = await colorOf(page, 'var(--ink-2)')
    const signal = await colorOf(page, 'var(--signal-ink)')
    for (const col of [1, 2, 3]) {
      const n = page.getByTestId(`pb-colh-${col}`).locator('.pb-colh__n')
      await expect(n).toHaveText(`§ 0${col}`)
      expect(await n.evaluate((el) => getComputedStyle(el).color)).toBe(ink2)
      expect(await n.evaluate((el) => getComputedStyle(el).color)).not.toBe(signal)
    }
  })

  test('an allowed fuse: its leader to the plate is ink like its glyph, never orange', async ({ page }) => {
    await openRack(page)
    await expect.poll(async () => (await fuses(page)).length).toBe(1)
    const leader = page.getByTestId('pb-leader')
    await expect(leader).toHaveCount(1)
    // the leader is drawn again as the layout settles: read it until it holds
    const stroke = () => leader.evaluate((el) => (el.isConnected ? getComputedStyle(el).stroke : ''))
    await expect.poll(stroke).toBe(await colorOf(page, 'var(--signal)'))
    const f = (await fuses(page))[0]
    expect(await wsEval(page, (s, a) => s.signOffFuse(a.key, a.sig, a.parts), { key: f.key, sig: f.sig!, parts: f.parts! })).toEqual({ ok: true })
    await expect(page.getByTestId('pb-ro-fuse-val')).toHaveText('0 open · 1 allowed')
    await expect(leader).toHaveAttribute('data-allowed', 'true')
    await expect.poll(stroke).toBe(await colorOf(page, 'var(--ink-3)'))
  })

  for (const scheme of ['light', 'dark'] as const) {
    test(`net chips are solid (${scheme}); the outside tag's letters sit on a solid backing`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await openRack(page)
      const chips = page.locator('.pb-mod .pb-net')
      await expect(chips.first()).toBeVisible()
      for (const img of await chips.evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundImage))) expect(img).toBe('none')
      const tag = page.locator('.pb-tag[data-tag="outside"]').first()
      await expect(tag).toBeVisible()
      const bg = await tag.evaluate((el) => {
        const s = getComputedStyle(el)
        return { clip: s.backgroundClip, image: s.backgroundImage }
      })
      // the first layer is the solid content box, the hatch only around it
      expect(bg.clip.split(',')[0].trim()).toBe('content-box')
      expect(bg.image).toContain('repeating-linear-gradient')
    })
  }

  test('English at 1440: Inbox-Helfer\'s mode tag is whole — its EVERYTHING label gives way first; no net chip shows a stub of a word', async ({ page }) => {
    await openRack(page)
    const inbox = module(page, 'agent:agInbox')
    const tag = inbox.locator('.pb-mod__k .pb-tag[data-tag="direct"]')
    await expect(tag).toBeVisible()
    await expect.poll(() => tag.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    // every net chip on the rack: hidden, or its first word shows whole
    const stubs = await page.locator('.pb-mod .pb-net').evaluateAll((els) =>
      els.filter((e) => {
        const t = e.querySelector<HTMLElement>('.pb-net__t')
        const w = e.querySelector<HTMLElement>('.pb-net__w')
        return !!t && !!w && t.offsetWidth > 0 && t.scrollWidth > t.clientWidth + 1 && t.clientWidth + 1 < w.offsetWidth
      }).length,
    )
    expect(stubs).toBe(0)
    // the hidden measure never reaches the module's words
    await expect(inbox).not.toContainText('…')
  })

  test('§ 02: a module without an in-jack lines its name up with its neighbours', async ({ page }) => {
    await openRack(page)
    const x = (key: string) => module(page, key).locator('.pb-mod__body').evaluate((el) => Math.round(el.getBoundingClientRect().left))
    await expect(module(page, 'pipeline:dbCoding')).toBeVisible()
    const pipe = await x('pipeline:dbCoding')
    expect(Math.abs(pipe - (await x('automation:dbMails:autToChat')))).toBeLessThanOrEqual(1)
    expect(Math.abs(pipe - (await x('automation:dbMails:autToContact')))).toBeLessThanOrEqual(1)
  })

  for (const lang of ['en', 'de'] as const) {
    test(`the plate's path (${lang}): one row, or the column — never a wrapped row`, async ({ page }) => {
      await openRack(page, mock1(), lang)
      const path = page.getByTestId('pb-fplate').getByTestId('pb-path')
      await expect(path).toBeVisible()
      const rows = await path.evaluate((ol) => {
        const tops = [...ol.children].map((li) => Math.round((li as HTMLElement).getBoundingClientRect().top + (li as HTMLElement).getBoundingClientRect().height / 2))
        return { stacked: ol.hasAttribute('data-stacked'), rows: new Set(tops).size, overflow: ol.scrollWidth > ol.clientWidth + 1 }
      })
      expect(rows.overflow).toBe(false)
      if (!rows.stacked) expect(rows.rows).toBe(1)
      // a narrower page (still the rack): the column, never a wrap
      await page.setViewportSize({ width: 1280, height: 900 })
      await expect(page.getByTestId('patchbay-page')).not.toHaveAttribute('data-view', 'strands')
      await expect.poll(() => path.evaluate((ol) => ol.scrollWidth <= ol.clientWidth + 1)).toBe(true)
      const narrow = await path.evaluate((ol) => ({ stacked: ol.hasAttribute('data-stacked'), rows: new Set([...ol.children].map((li) => Math.round((li as HTMLElement).getBoundingClientRect().top))).size }))
      if (!narrow.stacked) expect(narrow.rows).toBe(1)
    })
  }

  test('the fuse list: the selected tab shows the focus ring with the keyboard — and only then', async ({ page }) => {
    await openRack(page)
    const tab = page.getByTestId('pb-flist').getByRole('tab').first()
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    const shadow = () => tab.evaluate((el) => getComputedStyle(el).boxShadow)
    const plain = await shadow()
    await tab.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expect(tab).toBeFocused()
    expect(await tab.evaluate((el) => el.matches(':focus-visible'))).toBe(true)
    const focused = await shadow()
    expect(focused).not.toBe(plain)
    // the selection bar stays (inset) beside the ring
    expect(focused).toContain('inset')
    expect(focused.split('px').length).toBeGreaterThan(plain.split('px').length)
  })
})

test.describe('review (patch) · forced colours', () => {
  test('the legend matches the drawing: the fuse path swatch and the run\'s dot in Highlight', async ({ page }) => {
    await openRack(page)
    await page.emulateMedia({ forcedColors: 'active' })
    const highlight = await colorOf(page, 'Highlight')
    await expect.poll(() => page.locator('.pb-lg-path').evaluate((el) => getComputedStyle(el).stroke)).toBe(highlight)
    await expect.poll(() => page.locator('.pb-lg-comet').evaluate((el) => getComputedStyle(el).fill)).toBe(highlight)
  })

  test('every keyboard stop shows an outline: a module, a fuse tab, the FUSE cell', async ({ page }) => {
    await openRack(page)
    await page.emulateMedia({ forcedColors: 'active' })
    // the keyboard walks the page from the title
    await page.getByRole('heading', { level: 1 }).first().click()
    const seen = new Map<string, { style: string; width: number }>()
    for (let i = 0; i < 40 && seen.size < 3; i++) {
      await page.keyboard.press('Tab')
      const at = await page.evaluate(() => {
        const e = document.activeElement as HTMLElement | null
        if (!e || !e.matches(':focus-visible')) return null
        const kind = e.matches('.pb-mod') ? 'module' : e.matches('.pb-ftab') ? 'tab' : e.matches('[data-testid="pb-ro-fuse"]') ? 'fuse' : null
        if (!kind) return null
        const s = getComputedStyle(e)
        return { kind, style: s.outlineStyle, width: parseFloat(s.outlineWidth) }
      })
      if (at) seen.set(at.kind, at)
    }
    expect([...seen.keys()].sort()).toEqual(['fuse', 'module', 'tab'])
    for (const [kind, o] of seen) {
      expect(o.style, kind).toBe('solid')
      expect(o.width, kind).toBeGreaterThanOrEqual(2)
    }
  })
})
