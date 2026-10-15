/**
 * The Patchbay's P0 UI after the review (merge P0, "Fix (ui)"): what the rack, the strands, the fuse list and the deep
 * links promise and the review found broken —
 *  - a pipeline whose worker is offline is grey with "Worker offline" in its window (rack and strand), never the ok LED;
 *  - a module on several fuses never clips its F tags (they fold into "F2 · F3 · F4 +2", then "F2 +4");
 *  - git actions in words ("Git · Merge requests"), English names in “…”, the plate's "F1" bold in signal ink;
 *  - the phone's strands say "can set …" / "can open merge requests" where the AI decides and "reads …" for every read;
 *  - `?m=` lands on its module also past 30 modules (the auto filter) and in the strands view; an unknown key says why
 *    in words, never as a key; `?f=` does what F does — once per link, its tab focused and in view — and a press of a
 *    link the page already shows acts again; ⌘K "next fuse" goes on from the fuse shown;
 *  - J, F and Esc work while the keyboard is nowhere (a click on plain text); the filter, "+n more" and a jack hand the
 *    keyboard on, never to the body; "Whole workspace" says there is nothing to open;
 *  - the phone's readout never cuts the unknown "?".
 * Every name is fictional (tests/fixtures/patchbay.ts).
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval, MOD } from './fixtures'
import { bigPatchbay, buttonNode, docOf, exits, mock1, seedPatchbay, type PbWorld } from '../fixtures/patchbay'
import type { CustomAgent, Page as OnePage } from '../../src/app/store/types'

const module = (page: Page, key: string) => page.locator(`.pb-mod[data-key="${key}"]`)
const live = (page: Page) => page.getByTestId('pb-live')
const focusedAttr = (page: Page, attr: string) => page.evaluate((a) => document.activeElement?.getAttribute(a) ?? null, attr)
const focusedTag = (page: Page) => page.evaluate(() => document.activeElement?.tagName ?? null)

async function openRack(page: Page, w: PbWorld = mock1(), hash = '#/patchbay', lang: 'en' | 'de' = 'en') {
  await openApp(page)
  await seedPatchbay(page, w)
  if (lang === 'de') await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
  await page.evaluate((h) => (window.location.hash = h), hash)
  await expect(page.getByTestId('patchbay-page')).toBeVisible()
}

type Fuse = { key: string; label: string }
const fuses = (page: Page) => page.evaluate(() => ((window as unknown as { __onePatchbay: { model: () => { fuses: Fuse[] } | null } }).__onePatchbay.model()?.fuses ?? []).map((f) => ({ key: f.key, label: f.label })))
async function fuseKey(page: Page, label: string): Promise<string> {
  await expect.poll(async () => (await fuses(page)).some((f) => f.label === label)).toBe(true)
  return (await fuses(page)).find((f) => f.label === label)!.key
}

/** Is the element inside the main column's visible part? */
const inView = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const el = document.querySelector(s)
    const main = document.querySelector('#main')
    if (!el || !main) return false
    const r = el.getBoundingClientRect()
    const m = main.getBoundingClientRect()
    return r.top >= m.top - 1 && r.top < Math.min(m.bottom, innerHeight) - 8
  }, sel)

/** exits() with 16 more webhook buttons on „Notizen“: past 30 modules, the page opens on "Fuse paths only". */
function exitsMany(): PbWorld {
  const w = exits()
  const notes = w.ws.pages[w.ids.notes] as OnePage
  const more = Array.from({ length: 16 }, (_, i) => buttonNode(`btnMany${i}`, `Ping ${i}`, [{ id: `m${i}`, type: 'webhook', url: `https://h${i}.example/ping`, method: 'POST' }]))
  const content = notes.content as { content: unknown[] }
  w.ws.pages[w.ids.notes] = { ...notes, content: docOf(...content.content.slice(1), ...more) as OnePage['content'] }
  return w
}

test.describe('review · the rack', () => {
  test('a pipeline whose worker is offline: grey LED, "Worker offline" in its window — never the ok LED', async ({ page }) => {
    await openRack(page)
    const pipe = module(page, 'pipeline:dbCoding')
    await expect(pipe.locator('.pb-mod__k .led')).not.toHaveClass(/pb-led--ok/)
    await expect(pipe.getByTestId('pb-worker')).toHaveText('Worker offline')
    await expect(pipe.getByTestId('pb-worker')).toHaveAttribute('data-worker', 'off')
    await expect(pipe.locator('.pb-mod__s')).toHaveCount(0)
    // German: the same in German
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await expect(pipe.getByTestId('pb-worker')).toHaveText('Worker offline')
  })

  test('git in words: "Git · Merge requests" / "Git · Merge-Requests"; English names in “…”; the plate heading bolds F1 in signal ink', async ({ page }) => {
    await openRack(page)
    await expect(module(page, 'outbound:git:-:pr').locator('.pb-mod__n')).toHaveText('Git · Merge requests')
    await expect(page.locator('.pb-flag').first()).toContainText('Mails · “Weiterleiten”')
    await expect(module(page, 'automation:dbMails:autToChat').locator('.pb-mod__s')).toHaveText('Trigger: field “Weiterleiten”')
    const h = page.getByTestId('pb-fplate').getByRole('heading', { level: 2 })
    await expect(h).toHaveText('Fuse F1 · open path')
    const colors = await h.evaluate((el) => {
      const probe = document.createElement('i')
      probe.style.color = 'var(--signal-ink)'
      document.body.append(probe)
      const sig = getComputedStyle(probe).color
      probe.style.color = 'var(--ink-2)'
      const ink2 = getComputedStyle(probe).color
      probe.remove()
      return { f: getComputedStyle(el.querySelector('.pb-fhead__f')!).color, words: getComputedStyle(el).color, sig, ink2, weight: getComputedStyle(el.querySelector('.pb-fhead__f')!).fontWeight }
    })
    expect(colors.f).toBe(colors.sig)
    expect(colors.words).toBe(colors.ink2)
    expect(Number(colors.weight)).toBeGreaterThanOrEqual(700)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await expect(module(page, 'outbound:git:-:pr').locator('.pb-mod__n')).toHaveText('Git · Merge-Requests')
    await expect(page.locator('.pb-flag').first()).toContainText('Mails · „Weiterleiten“')
  })

  test('the § 03 net flag sits on its writer’s row; the webhook on its automation’s (the glyph level)', async ({ page }) => {
    await openRack(page)
    const mid = (sel: string) => page.locator(sel).first().evaluate((el) => Math.round(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2))
    const apart = async (a: string, b: string) => Math.abs((await mid(a)) - (await mid(b)))
    await expect.poll(() => apart('.pb-mod[data-key="agent:agInbox"]', '.pb-flag[data-side="out"]')).toBeLessThanOrEqual(6)
    await expect.poll(() => apart('.pb-mod[data-key="automation:dbMails:autToChat"]', '.pb-mod[data-key="outbound:webhook:chat.example:POST"]')).toBeLessThanOrEqual(6)
    // "Whole workspace" took the next free row: the bottom of § 03
    await expect.poll(async () => (await mid('.pb-mod[data-key="everything:all"]')) - (await mid('.pb-mod[data-key="outbound:git:-:pr"]'))).toBeGreaterThan(20)
  })

  test('several fuses on one module: the F tags never clip — they fold into one group chip, every label in its title (exits, German)', async ({ page }) => {
    await openRack(page, exits(), '#/patchbay', 'de')
    await expect(page.getByTestId('pb-module').first()).toBeVisible()
    await page.waitForTimeout(400)
    const over = await page.$$eval('.pb-mod__k', (els) => els.filter((k) => k.scrollWidth > k.clientWidth + 1).map((k) => k.textContent))
    expect(over).toEqual([])
    // Mail-Sortierer is on F2 … F6: its labels are in the chip shown (or in the tags)
    const k = module(page, 'agent:agExApply').locator('.pb-mod__k')
    const shown = await k.evaluate((el) => [...el.querySelectorAll<HTMLElement>('.pb-tag--f, .pb-tag--fg')].filter((x) => getComputedStyle(x).display !== 'none').map((x) => [x.textContent, x.title]))
    expect(shown.length).toBeGreaterThan(0)
    expect(shown.map((x) => `${x[0]} ${x[1]}`).join(' ')).toContain('F2')
  })

  test('↵ on "Whole workspace" says there is nothing to open (and does not offer Enter)', async ({ page }) => {
    await openRack(page)
    const all = module(page, 'everything:all')
    await expect(all).toHaveAttribute('aria-keyshortcuts', 'Space J')
    await all.focus()
    await page.keyboard.press('Enter')
    await expect(live(page)).toHaveText('Nothing to open here')
    await expect(page).toHaveURL(/#\/patchbay$/)
    await expect(all).toBeFocused()
  })

  test('the rack mounted again with an unchanged layout (strands at 390 px, then 1440) draws its cables and glyph', async ({ page }) => {
    await openRack(page)
    await expect(page.getByTestId('pb-glyph')).toHaveCount(1)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByTestId('pb-rack')).toHaveCount(0)
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.getByTestId('pb-rack')).toHaveCount(1)
    await expect(page.getByTestId('pb-glyph')).toHaveCount(1)
  })
})

test.describe('review · the keyboard', () => {
  test('J, F and Esc work while the keyboard is nowhere (a click on plain text, the empty bench)', async ({ page }) => {
    await openRack(page)
    await module(page, 'agent:agInbox').click()
    await expect(module(page, 'agent:agInbox')).toHaveAttribute('data-selected', 'true')
    await page.locator('.pb-plain p, .pb-plain').first().click({ position: { x: 4, y: 4 } })
    expect(await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName)).toMatch(/^(main|BODY)$/)
    await page.keyboard.press('Escape')
    await expect(module(page, 'agent:agInbox')).not.toHaveAttribute('data-selected', /.*/)
    await page.keyboard.press('f')
    await expect(live(page)).toContainText('Fuse F1 selected')
    await expect.poll(() => focusedAttr(page, 'data-pb-fuse-tab')).not.toBeNull()
    // from nowhere again: J opens the picker; Esc gives the keyboard to the rack's stop
    await page.locator('.pb-plain').first().click({ position: { x: 4, y: 4 } })
    await page.keyboard.press('j')
    await expect(page.getByTestId('pb-jack-picker')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('pb-jack-picker')).toHaveCount(0)
    await expect.poll(() => focusedTag(page)).not.toBe('BODY')
  })

  test('the filter gives the keyboard back to its key (a pick, Esc) — then F works', async ({ page }) => {
    await openRack(page)
    const key = page.getByTestId('pb-filter')
    await key.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('pb-filter-preset').first()).toBeVisible()
    await page.getByTestId('pb-filter-preset').filter({ hasText: 'Fuse paths only' }).focus()
    await page.keyboard.press('Enter')
    await expect(key).toBeFocused()
    await expect(key).toContainText('Fuse paths only')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('pb-filter-preset').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(key).toBeFocused()
    await page.keyboard.press('f')
    await expect(live(page)).toContainText('Fuse F1 selected')
  })

  test('a jack the picker focused hands the rack’s tab stop to its module: Tab leaves the rack', async ({ page }) => {
    await openRack(page)
    await module(page, 'outbound:webhook:chat.example:POST').focus()
    await page.keyboard.press('j')
    await page.keyboard.type('tracker')
    await page.keyboard.press('Enter')
    await expect.poll(() => focusedAttr(page, 'data-jack')).toMatch(/^server:srvTracker\./)
    await expect(page.getByTestId('pb-rack').locator('[data-stop][tabindex="0"]')).toHaveAttribute('data-stop', 'server:srvTracker')
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="pb-rack"]'))).toBe(false)
  })

  test('"+n more" hands the keyboard to the first row it brought; a near miss past the 12 keeps the tablist one stop', async ({ page }) => {
    await openRack(page, exitsMany())
    await expect(page.getByTestId('pb-filter')).toContainText('Fuse paths only')
    const more = page.getByTestId('pb-flist-more')
    await expect(more).toBeVisible()
    const tabs = page.getByTestId('pb-flist').getByRole('tab')
    const before = await tabs.count()
    await more.focus()
    await page.keyboard.press('Enter')
    await expect(more).toHaveCount(0)
    await expect.poll(() => tabs.count()).toBeGreaterThan(before)
    expect(await page.evaluate(() => document.activeElement?.getAttribute('role'))).toBe('tab')
    await expect(page.locator('[data-testid="pb-ftab"]:focus')).toHaveAttribute('aria-selected', 'true')
  })

  test('a near miss past the 12 selected through the rack: exactly one tab stop, the panel labelled', async ({ page }) => {
    await openRack(page, exitsMany())
    await expect(page.getByTestId('pb-flist-more')).toBeVisible()
    // the near misses past the 12: select a module on one of them (rows are in list order)
    const hidden = await page.evaluate(() => {
      const m = (window as unknown as { __onePatchbay: { model: () => { nearMisses: Array<{ key: string; chain: { decider?: string; source?: string } }> } } }).__onePatchbay.model()
      const seen = new Set<string>()
      const rows = m.nearMisses.filter((n) => !seen.has(n.key) && seen.add(n.key))
      return rows.slice(12).map((n) => n.chain.decider ?? n.chain.source).filter(Boolean) as string[]
    })
    test.skip(!hidden.length, 'no near miss past the 12')
    await page.evaluate((k) => (window.location.hash = `#/patchbay?m=${encodeURIComponent(k)}`), hidden[hidden.length - 1])
    await expect.poll(() => page.locator('[data-testid="pb-ftab"][tabindex="0"]').count()).toBe(1)
    await expect(page.locator('[data-testid="pb-ftab"][aria-selected="true"]')).toHaveCount(1)
    await expect(page.getByTestId('pb-fpanel')).toHaveAttribute('aria-labelledby', /pb-ftab-\d+/)
  })
})

test.describe('review · deep links', () => {
  test('?m= past 30 modules (auto "Fuse paths only"): the module folded away is opened, selected, focused and said', async ({ page }) => {
    await openRack(page, exitsMany(), '#/patchbay?m=agent:agExHook')
    await expect(module(page, 'agent:agExHook')).toBeFocused()
    await expect(module(page, 'agent:agExHook')).toHaveAttribute('data-selected', 'true')
    await expect(live(page)).toContainText('Hook-Empfänger selected')
    await expect(page.getByTestId('pb-filter')).toContainText('Fuse paths only')
  })

  test('?m= on a low module of a big rack scrolls it into view', async ({ page }) => {
    await openRack(page, bigPatchbay(60), '#/patchbay?m=agent:agBig6')
    await expect(module(page, 'agent:agBig6')).toBeFocused()
    await expect.poll(() => inView(page, '.pb-mod[data-key="agent:agBig6"]')).toBe(true)
  })

  test('?m= of something that is not on the rack: the h1 takes the keyboard, the words say why — never the key', async ({ page }) => {
    await openRack(page, mock1(), '#/patchbay?m=command:dbMails:cmdView')
    await expect(page.locator('.pb-title')).toBeFocused()
    await expect(live(page)).toHaveText('Not on the rack — this does not run anything by itself')
  })

  test('?f= does what F does: the tab focused and in view, said — once per link (a rebuild never snaps back)', async ({ page }) => {
    await openRack(page, exits())
    const f5 = await fuseKey(page, 'F5')
    await page.evaluate((k) => (window.location.hash = `#/patchbay?f=${k}`), f5)
    await expect.poll(() => focusedAttr(page, 'data-pb-fuse-tab')).toBe(f5)
    await expect.poll(() => inView(page, `[data-pb-fuse-tab="${f5}"]`)).toBe(true)
    await expect(live(page)).toContainText('Fuse F5 selected')
    // ↓ to the next tab, then a wiring change rebuilds the model: the selection stays where the person moved it
    await page.keyboard.press('ArrowDown')
    const next = await focusedAttr(page, 'data-row')
    expect(next).not.toBe(f5)
    const builds = await page.evaluate(() => (window as unknown as { __onePatchbay: { builds: () => number } }).__onePatchbay.builds())
    await wsEval(page, (s) => s.upsertAgent({ ...(s.agents as Record<string, CustomAgent>).agExStage, name: 'Ticket-Leser 2' }))
    await expect.poll(() => page.evaluate(() => (window as unknown as { __onePatchbay: { builds: () => number } }).__onePatchbay.builds())).toBeGreaterThan(builds)
    await page.waitForTimeout(300)
    expect(await focusedAttr(page, 'data-row')).toBe(next)
    await expect(page.locator(`[data-testid="pb-ftab"][data-row="${next}"]`)).toHaveAttribute('aria-selected', 'true')
  })

  test('the status cell at 1280 × 720: the plate in view, its tab focused; a second press after moving acts again', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await openApp(page)
    await seedPatchbay(page, exits())
    const cell = page.getByTestId('patchbay-status')
    await expect(cell).toBeVisible()
    await cell.click()
    await expect(page.getByTestId('patchbay-page')).toBeVisible()
    const f1 = await fuseKey(page, 'F1')
    await expect.poll(() => focusedAttr(page, 'data-pb-fuse-tab')).toBe(f1)
    await expect.poll(() => inView(page, `[data-pb-fuse-tab="${f1}"]`)).toBe(true)
    // the person moves on to F3, then presses the cell again (the same link): F1 again
    const f3 = await fuseKey(page, 'F3')
    await page.locator(`[data-pb-fuse-tab="${f3}"]`).click()
    await expect(page.locator(`[data-pb-fuse-tab="${f3}"]`)).toHaveAttribute('aria-selected', 'true')
    await cell.click()
    await expect.poll(() => focusedAttr(page, 'data-pb-fuse-tab')).toBe(f1)
    await expect(page.locator(`[data-pb-fuse-tab="${f1}"]`)).toHaveAttribute('aria-selected', 'true')
  })

  test('⌘K "Patchbay: next fuse" goes on from the fuse shown', async ({ page }) => {
    await openRack(page, exits())
    const f1 = await fuseKey(page, 'F1')
    const f2 = await fuseKey(page, 'F2')
    await expect(page.locator(`[data-pb-fuse-tab="${f1}"]`)).toHaveAttribute('aria-selected', 'true')
    for (const want of [f2, await fuseKey(page, 'F3')]) {
      await page.keyboard.press(`${MOD}+k`)
      await page.getByRole('combobox').or(page.locator('.pal-scrim input')).first().fill('next fuse')
      await expect(page.getByRole('option', { name: /Patchbay: next fuse/ })).toBeVisible()
      await page.keyboard.press('Enter')
      await expect.poll(() => focusedAttr(page, 'data-pb-fuse-tab')).toBe(want)
    }
  })
})

test.describe('review · 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the strands say who decides: "can set …", "can open merge requests", "reads …"; the pipeline’s worker word', async ({ page }) => {
    await openRack(page)
    await expect(page.getByTestId('patchbay-page')).toHaveAttribute('data-view', 'strands')
    const strand = (k: string) => page.locator(`[data-testid="pb-strand"][data-key="${k}"]`)
    await expect(strand('agent:agInbox').getByTestId('pb-line').filter({ hasText: 'can set' })).toHaveText(/can set\s*“Weiterleiten”/)
    await expect(strand('pipeline:dbCoding').getByTestId('pb-line').filter({ hasText: 'merge requests' })).toContainText('can open merge requests')
    await expect(strand('pipeline:dbCoding').getByTestId('pb-line').filter({ hasText: 'reads' })).toContainText('reads Tasks')
    await expect(strand('script:scWeekly').getByTestId('pb-line').filter({ hasText: 'reads' })).toContainText('reads Tessera Handoff')
    await expect(strand('pipeline:dbCoding').getByTestId('pb-worker')).toHaveText('Worker offline')
    await expect(strand('pipeline:dbCoding').locator('.pb-strand__h .led')).not.toHaveClass(/pb-led--ok/)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await expect(strand('agent:agInbox').getByTestId('pb-line').filter({ hasText: 'setzen' })).toHaveText(/kann\s*„Weiterleiten“\s*setzen/)
    await expect(strand('pipeline:dbCoding').getByTestId('pb-line').filter({ hasText: 'Merge-Requests' })).toContainText('kann Merge-Requests anlegen')
    await expect(strand('script:scWeekly').getByTestId('pb-line').filter({ hasText: 'liest' })).toContainText('liest Tessera Handoff')
  })

  test('?m= in the strands: a processor’s name key (the card marked), a module without a strand on what names it', async ({ page }) => {
    await openRack(page, mock1(), '#/patchbay?m=agent:agInbox')
    const card = page.locator('[data-testid="pb-strand"][data-key="agent:agInbox"]')
    await expect(card.getByTestId('pb-strand-open')).toBeFocused()
    await expect(card).toHaveAttribute('data-selected', 'true')
    await expect(live(page)).toContainText('Inbox-Helfer selected')
    // an idle server: its name under "Not processed"
    await page.evaluate(() => (window.location.hash = '#/patchbay?m=server:srvKanal'))
    await expect(page.locator('.pb-strands__restn[data-key="server:srvKanal"]')).toBeFocused()
    // a way out: the line that names it
    await page.evaluate(() => (window.location.hash = '#/patchbay?m=outbound:webhook:chat.example:POST'))
    await expect(page.locator('.pb-line[data-key="outbound:webhook:chat.example:POST"]').first()).toBeFocused()
  })

  test('?f= on the phone: the fuse card focused and in view', async ({ page }) => {
    await openRack(page, exits())
    const f4 = await fuseKey(page, 'F4')
    await page.evaluate((k) => (window.location.hash = `#/patchbay?f=${k}`), f4)
    await expect.poll(() => focusedAttr(page, 'data-pb-fuse-tab')).toBe(f4)
    await expect.poll(() => inView(page, `.pb-fcard[data-pb-fuse-tab="${f4}"]`)).toBe(true)
  })

  test('the readout never cuts the unknown "?" (German, every fuse allowed, a part unknown)', async ({ page }) => {
    await openRack(page, exits(), '#/patchbay', 'de')
    await expect.poll(async () => (await fuses(page)).length).toBeGreaterThan(1)
    const all = await page.evaluate(() => (window as unknown as { __onePatchbay: { model: () => { fuses: Array<{ key: string; sig: string; parts: Record<string, string> }> } } }).__onePatchbay.model().fuses.map((f) => ({ key: f.key, sig: f.sig, parts: f.parts })))
    for (const f of all) await wsEval(page, (s, a) => s.signOffFuse(a.key, a.sig, a.parts), f)
    const ro = page.getByTestId('pb-readout')
    await expect(page.getByTestId('pb-ro-fuse-val')).toContainText('zugelassen')
    await expect(page.getByTestId('pb-ro-unknown')).toBeVisible()
    await page.waitForTimeout(200)
    const fit = await ro.evaluate((el) => {
      const q = el.querySelector('[data-testid="pb-ro-unknown"] .pb-tag--q')!.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      return { over: el.scrollWidth - el.clientWidth, qRight: q.right, right: r.right }
    })
    expect(fit.over).toBeLessThanOrEqual(1)
    expect(fit.qRight).toBeLessThanOrEqual(fit.right + 1)
  })
})
