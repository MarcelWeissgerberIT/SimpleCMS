/**
 * The Patchbay ("Schaltplan") in the app — B6, the page frame and the rack (plan §3.3, §3.9, §1.8):
 *  - #/patchbay is a lazy chunk: nothing of the page loads before the route opens;
 *  - mock 1 on the rack: the column heads (§ 01 4 · 3 idle, § 02 6, § 03 7), 17 modules, the idle fold (kanal · bildwerk
 *    · wiki) that opens, the net-flag pair, the F1 tags, 15 cables · 3 chosen by the AI, two hatched (from outside);
 *  - the readout's FUSE cell: "1", zero ("none open", nothing to press), allowed ("0 open · 1 allowed"), unknown
 *    ("· 1 unknown" + "?");
 *  - the empty rack: one sentence, the idle parts by name, "New agent" / "New automation" as the primaries;
 *  - links both ways: Workspace › Automation "As patchbay" / "Show in the patchbay" (`m=` selects and focuses the module,
 *    unfolds its fold, a folded script is its automation) and "As list" back; ⌘K "Patchbay" and "next fuse";
 *  - the sidebar row: NEW until the first visit, the LED "1" (the readout's number), neutral ink for a viewer, a grey "?"
 *    when nothing is open but parts are unknown here;
 *  - the pointer grammar: hover lights a module's cables in ink (nothing dims), a click selects (the rest dims, "Open ↵"
 *    appears), a double-click / "Open ↵" / ↵ opens its editor; a dialog gives the keyboard back to the module.
 * B7, the cables and the keys (plan §3.4, §3.9):
 *  - the SVG holds the readout's cables, dashed / hatched on the model's edges, F1's glyph halfway along „An Team-Chat“ →
 *    Webhook; the leader only for the selected fuse while glyph and plate are both in view, else "↓ F1"; F and a glyph
 *    click move it; net flags jump to their twin; a "+n" chip lists its cables;
 *  - J finds a jack (Esc back), the arrows rove over one tab stop, ↵ opens agent / automations / script, Space lights the
 *    Klartext sentence without scrolling, the accessibility tree (lists, groups, descriptions, hint);
 *  - "Picture · zoom" → Schematic + Download SVG without var( / color-mix( / oklch(; forced colours; relayout ≤ 16 ms.
 * B8, the fuse plate, the Preflight lamp and the phone (plan §3.5, §3.8, §1.8) — P0 done:
 *  - F1's plate in English and German (lamps, path chips, sentence, facts; its tab under the glyph); the fuse list is a
 *    tablist in F-order (↑ / ↓ / Home / End, F); the grey rows (almost open, unknown here) — never counted; a module on
 *    a gated path shows its row; the blink 3× then steady, once per fuse and signature, none with reduced motion / noBlink;
 *  - LED = Preflight lamp = readout before a visit, after it and after a reload (the lazy cache); amber, never MASTER
 *    CAUTION, "n unknown" as the second line, open() → ?f=, no lamp for a viewer; the status cell sheds first;
 *  - 390 px: the fuse card first, every counted strand, "Not processed", no sideways scroll, a run lights in place with
 *    the jump chip, taps open — light and dark.
 * Every name is fictional (tests/fixtures/patchbay.ts).
 */
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, wsEval, MOD } from './fixtures'
import { bigPatchbay, database, dbPage, exits, mock1, seedPatchbay, server, wideScope, world, type PbWorld } from '../fixtures/patchbay'
import type { CustomAgent, Database } from '../../src/app/store/types'

const module = (page: Page, key: string) => page.locator(`[data-testid="pb-module"][data-key="${key}"]`)

async function openRack(page: Page, w: PbWorld = mock1(), hash = '#/patchbay') {
  await openApp(page)
  await seedPatchbay(page, w)
  await page.evaluate((h) => (window.location.hash = h), hash)
  await expect(page.getByTestId('patchbay-page')).toBeVisible()
}

/** The model the page built (the `?e2e` seam of state.ts). */
const pbModel = (page: Page) => page.evaluate(() => (window as unknown as { __onePatchbay: { model: () => { fuses: Array<{ key: string; sig?: string; parts?: Record<string, string> }> } | null } }).__onePatchbay.model())

/** mock 1 with Tessera-Spiegel's route unreadable here — an unknown part (it is on no fuse path). */
function withUnknown(): PbWorld {
  const w = mock1()
  const a = w.ws.agents!.agTessera
  w.ws.agents = { ...w.ws.agents, agTessera: { ...a, route: [{ p: 'futurecorp', m: 'x' }] as unknown as CustomAgent['route'] } }
  return w
}

const css = (page: Page, token: string) =>
  page.evaluate((t) => {
    const el = document.createElement('i')
    el.style.color = `var(${t})`
    document.body.append(el)
    const c = getComputedStyle(el).color
    el.remove()
    return c
  }, token)

test.describe('B6 · the page frame', () => {
  test('#/patchbay is a lazy chunk: nothing of it loads before the route opens', async ({ page }) => {
    const chunks: string[] = []
    page.on('request', (r) => {
      if (/\/Patchbay-[\w-]+\.(js|css)$/.test(r.url())) chunks.push(r.url())
    })
    await openApp(page)
    await page.waitForLoadState('networkidle')
    expect(chunks).toEqual([])
    await page.evaluate(() => (window.location.hash = '#/patchbay'))
    await expect(page.getByTestId('patchbay-page')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Patchbay')
    expect(chunks.some((u) => u.endsWith('.js'))).toBe(true)
    // nobody had the keyboard: the title takes it
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
  })

  test('mock 1: column heads, 17 modules, the idle fold, the net-flag pair, F1, 15 cables · 3 dashed, the readout', async ({ page }) => {
    await openRack(page)
    await expect(page.getByTestId('patchbay-page')).toHaveAttribute('data-view', 'rack')
    await expect(page.getByTestId('pb-colh-1')).toContainText(/Sources\s*4 · 3 idle/i)
    await expect(page.getByTestId('pb-colh-2')).toContainText(/Processing\s*6/i)
    await expect(page.getByTestId('pb-colh-3')).toContainText(/Targets\s*7/i)
    await expect(page.getByTestId('pb-module')).toHaveCount(17)
    // the readout: the model's own numbers
    await expect(page.getByTestId('pb-ro-modules')).toHaveText('17 · 3 idle')
    await expect(page.getByTestId('pb-ro-cables')).toHaveText('15 · 3 chosen by the AI')
    await expect(page.getByTestId('pb-ro-fuse-val')).toHaveText('1')
    await expect(page.getByTestId('pb-ro-runs')).toContainText('0')
    // the net-flag pair (same name = the same connection), both on F1's path
    const flags = page.getByTestId('pb-flag')
    await expect(flags).toHaveCount(2)
    for (const f of await flags.all()) await expect(f).toContainText(/Mails · “Weiterleiten”/)
    // F1's path: the row trigger, Inbox-Helfer, „An Team-Chat“, the webhook — the dashed signal frame
    for (const key of ['rowTrigger:dbMails:created:-', 'agent:agInbox', 'automation:dbMails:autToChat', 'outbound:webhook:chat.example:POST']) {
      await expect(module(page, key)).toHaveAttribute('data-path', '')
      await expect(module(page, key).locator('.pb-tag--f')).toHaveText('F1')
    }
    await expect(page.locator('.pb-mod[data-path]')).toHaveCount(4)
    // cables: three dashed (chosen by the AI), two hatched (content from outside: the row trigger's)
    await expect(page.getByTestId('pb-wires')).toBeVisible()
    await expect(page.locator('[data-wire] .pb-w--can')).toHaveCount(3)
    await expect(page.locator('[data-wire][data-outside]')).toHaveCount(2)
    // the idle fold: three servers by name; it opens in place
    const fold = page.getByTestId('pb-fold')
    await expect(fold).toHaveCount(1)
    await expect(fold).toContainText('3 idle')
    await expect(fold).toContainText('kanal · bildwerk · wiki')
    await expect(fold).toHaveAttribute('aria-expanded', 'false')
    await fold.click()
    await expect(fold).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByTestId('pb-module')).toHaveCount(20)
    await expect(module(page, 'server:srvKanal')).toBeVisible()
    // the legend names the AI, never a provider
    await expect(page.getByTestId('pb-legend')).toContainText(/the AI decides/i)
  })

  test('the readout: zero (none open, nothing to press), allowed (0 open · 1 allowed), unknown (· 1 unknown + ?)', async ({ page }) => {
    // the seeded workspace has no fuse
    await openApp(page, '#/patchbay')
    await expect(page.getByTestId('patchbay-page')).toBeVisible()
    await expect(page.getByTestId('pb-ro-fuse-val')).toHaveText('none open')
    await expect(page.getByTestId('pb-ro-fuse')).toHaveAttribute('aria-disabled', 'true')
    await expect(page.getByTestId('pb-ro-unknown')).toHaveCount(0)
    await expect(page.getByTestId('patchbay-nav-led')).toHaveCount(0)
    await expect(page.getByTestId('patchbay-nav-unknown')).toHaveCount(0)

    // mock 1 with a part this build cannot read: 1 open · 1 unknown
    await seedPatchbay(page, withUnknown())
    await expect(page.getByTestId('pb-ro-fuse-val')).toHaveText('1')
    await expect(page.getByTestId('pb-ro-unknown')).toContainText('1 unknown')
    await expect(page.getByTestId('pb-ro-unknown').locator('.pb-tag--q')).toHaveText('?')
    await expect(module(page, 'agent:agTessera')).toHaveAttribute('data-unknown', /.*/)
    // the sidebar: the open fuse wins (signal), the unknown part is the Preflight lamp's second line (B8)
    await expect(page.getByTestId('patchbay-nav-led')).toContainText('1')

    // the person allows F1's path (key 3 is B8's — written here as the plate would): 0 open · 1 allowed
    await expect.poll(async () => (await pbModel(page))?.fuses.length ?? 0).toBe(1)
    const f = (await pbModel(page))!.fuses[0]
    expect(await wsEval(page, (s, a) => s.signOffFuse(a.key, a.sig, a.parts), { key: f.key, sig: f.sig!, parts: f.parts! })).toEqual({ ok: true })
    await expect(page.getByTestId('pb-ro-fuse-val')).toHaveText('0 open · 1 allowed')
    await expect(page.getByTestId('pb-ro-fuse')).toHaveAttribute('aria-disabled', 'true')
    // nothing open, a part unknown: the sidebar shows a grey "?" — unknown never reads as safe
    await expect(page.getByTestId('patchbay-nav-led')).toHaveCount(0)
    const q = page.getByTestId('patchbay-nav-unknown')
    await expect(q).toBeVisible()
    await expect(q).toContainText('1 part unknown here')
    expect(await q.evaluate((el) => getComputedStyle(el).color)).toBe(await css(page, '--ink-3'))
  })

  test('the empty rack: one sentence, the idle parts by name, "New agent" and "New automation" as the primaries', async ({ page }) => {
    const w = world({ pages: [dbPage('dbNotiz', 'Notizen')], databases: [database('dbNotiz', [])], servers: [server('srvKanal', 'kanal')] })
    await openRack(page, w)
    const empty = page.getByTestId('pb-empty')
    await expect(empty).toContainText('nothing is wired yet')
    await expect(empty).toContainText('kanal')
    await expect(page.getByTestId('pb-legend')).toHaveCount(0)
    await expect(page.getByTestId('pb-empty-agent')).toHaveClass(/btn--primary/)
    await expect(page.getByTestId('pb-empty-automation')).toHaveClass(/btn--primary/)
    await expect(page.getByTestId('pb-empty-drop')).not.toHaveClass(/btn--primary/)
    // "New automation" asks which database, then opens its automations
    await page.getByTestId('pb-empty-automation').click()
    await page.getByRole('menuitem', { name: 'Notizen' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByTestId('pb-empty-agent').click()
    await expect(page).toHaveURL(/#\/agents$/)
  })
})

test.describe('B6 · links both ways, the sidebar, ⌘K', () => {
  test('Workspace › Automation ⇄ the rack: "As patchbay", "Show in the patchbay" (m= selects + focuses, unfolds, a folded script is its automation), "As list"', async ({ page }) => {
    await openApp(page)
    await seedPatchbay(page, mock1())
    await page.evaluate(() => (window.location.hash = '#/workspace/automation'))
    await page.getByTestId('ws-auto-as-patchbay').click()
    await expect(page).toHaveURL(/#\/patchbay$/)
    await expect(page.getByTestId('pb-module')).toHaveCount(17)
    await page.getByTestId('patchbay-as-list').click()
    await expect(page).toHaveURL(/#\/workspace\/automation$/)

    // an agent's row → its module, selected, with the keyboard, announced
    await page.getByTestId('ws-auto-agents').getByRole('button', { name: 'Show in the patchbay: Inbox-Helfer' }).click()
    await expect.poll(() => decodeURIComponent(page.url())).toContain('#/patchbay?m=agent:agInbox')
    const helper = module(page, 'agent:agInbox')
    await expect(helper).toHaveAttribute('data-selected', 'true')
    await expect(helper).toBeFocused()
    await expect(page.getByTestId('pb-live')).toHaveText('Inbox-Helfer selected — its connections are lit')
    await expect(helper.getByTestId('pb-open')).toBeVisible()

    // a script folded into its automation: the automation is selected
    await page.evaluate(() => (window.location.hash = '#/workspace/automation'))
    await page.getByTestId('ws-auto-scripts').getByRole('button', { name: 'Show in the patchbay: Kontakt anlegen' }).click()
    await expect(module(page, 'automation:dbMails:autToContact')).toHaveAttribute('data-selected', 'true')
    await expect(module(page, 'automation:dbMails:autToContact')).toBeFocused()

    // an idle server: its fold opens first
    await page.evaluate(() => (window.location.hash = '#/patchbay?m=server%3AsrvKanal'))
    await expect(module(page, 'server:srvKanal')).toHaveAttribute('data-selected', 'true')
    await expect(page.getByTestId('pb-fold')).toHaveAttribute('aria-expanded', 'true')

    // ⌘K: "Patchbay" and, while a fuse is open, "Patchbay: next fuse" (its path key in f=)
    await page.evaluate(() => (window.location.hash = '#/workspace/automation'))
    await page.keyboard.press(`${MOD}+k`)
    const input = page.getByRole('combobox').or(page.locator('.pal-scrim input')).first()
    await input.fill('next fuse')
    await expect(page.getByRole('option', { name: /Patchbay: next fuse/ })).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#\/patchbay\?f=[0-9a-f]{64}$/)
    await page.keyboard.press(`${MOD}+k`)
    await input.fill('Patchbay')
    await expect(page.getByRole('option', { name: 'Patchbay', exact: true })).toBeVisible()
  })

  test('the sidebar row: NEW until the first visit, the LED "1" from the readout, neutral ink for a viewer', async ({ page }) => {
    await openApp(page)
    await seedPatchbay(page, mock1())
    const row = page.getByTestId('patchbay-nav')
    await expect(row).toContainText('Patchbay')
    await expect(page.getByTestId('patchbay-nav-new')).toHaveText(/new/i)
    await row.click()
    await expect(page).toHaveURL(/#\/patchbay$/)
    await expect(row).toHaveAttribute('data-active', 'true')
    await expect(page.getByTestId('patchbay-nav-new')).toHaveCount(0)
    const led = page.getByTestId('patchbay-nav-led')
    await expect(led).toContainText('1')
    await expect(led).toContainText('1 open fuse')
    await expect(led.locator('.led')).toHaveClass(/led--on/)
    expect(await led.evaluate((el) => getComputedStyle(el).color)).toBe(await css(page, '--signal-ink'))
    // the readout and the LED say the same
    await expect(page.getByTestId('pb-ro-fuse-val')).toHaveText('1')
    // NEW stays gone on this device
    await page.evaluate(() => (window.location.hash = '#/'))
    await expect(page.getByTestId('patchbay-nav-new')).toHaveCount(0)
    await expect(led).toContainText('1')
    expect(await page.evaluate(() => localStorage.getItem('one.patchbay.seen'))).toBe('1')

    // a viewer cannot act on it: the LED is neutral ink, never signal; no drop chip on the page
    await page.evaluate(() => (window as unknown as { __one: { cloud: { useCloud: { setState: (s: unknown) => void } } } }).__one.cloud.useCloud.setState({ readOnly: true }))
    await expect(led).toHaveAttribute('data-viewer', 'true')
    await expect(led.locator('.led')).not.toHaveClass(/led--on/)
    expect(await led.evaluate((el) => getComputedStyle(el).color)).toBe(await css(page, '--ink-2'))
    await row.click()
    await expect(page.getByTestId('patchbay-page')).toBeVisible()
    await expect(page.getByTestId('pb-drop')).toHaveCount(0)
  })
})

test.describe('B6 · the pointer grammar', () => {
  test('hover lights the cables in ink; a click selects (the rest dims, "Open ↵"); "Open ↵", a double-click and ↵ open the editor', async ({ page }) => {
    await openRack(page)
    const ink = await css(page, '--ink')
    const contact = module(page, 'automation:dbMails:autToContact')
    // hover: its cables in ink, nothing dims
    await contact.hover()
    await expect(contact).toHaveAttribute('data-lit', 'true')
    const lit = page.locator('.pb-w--lit')
    await expect.poll(() => lit.count()).toBeGreaterThanOrEqual(2)
    await expect.poll(() => lit.first().evaluate((el) => getComputedStyle(el).stroke)).toBe(ink)
    await expect(page.locator('.pb-w--dim')).toHaveCount(0)
    await expect(page.locator('.pb-mod[data-dim]')).toHaveCount(0)
    await page.mouse.move(5, 5)
    await expect(page.locator('.pb-w--lit')).toHaveCount(0)

    // a click selects: its chains lit, the rest dims, "Open ↵" on it
    await contact.locator('.pb-mod__n').click()
    await expect(contact).toHaveAttribute('data-selected', 'true')
    await expect(contact.getByTestId('pb-open')).toBeVisible()
    await expect(module(page, 'agent:agTessera')).toHaveAttribute('data-dim', 'true')
    await expect(module(page, 'database:dbKontakte')).not.toHaveAttribute('data-dim', /.*/)
    await expect.poll(() => page.locator('.pb-w--dim').count()).toBeGreaterThan(0)
    // "Open ↵": the automation's dialog; closing it gives the keyboard back to the module (its "Open ↵" key)
    await contact.getByTestId('pb-open').click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect.poll(() => contact.evaluate((el) => el.contains(document.activeElement))).toBe(true)
    // ↵ on the module itself opens it too, and the keyboard comes back to the module
    await contact.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(contact).toBeFocused()
    // a click on the empty bench clears the selection; so does Esc
    await page.locator('.pb-rack').click({ position: { x: 6, y: 6 } })
    await expect(contact).not.toHaveAttribute('data-selected', /.*/)
    await expect(page.locator('.pb-mod[data-dim]')).toHaveCount(0)

    // ↵ on a module opens its editor
    const helper = module(page, 'agent:agInbox')
    await helper.focus()
    await page.keyboard.press('Space')
    await expect(helper).toHaveAttribute('data-selected', 'true')
    await page.keyboard.press('Escape')
    await expect(helper).not.toHaveAttribute('data-selected', /.*/)
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#\/agents\/agInbox$/)

    // a double-click opens too
    await page.goBack()
    await expect(page.getByTestId('patchbay-page')).toBeVisible()
    await module(page, 'agent:agTessera').locator('.pb-mod__n').dblclick()
    await expect(page).toHaveURL(/#\/agents\/agTessera$/)
  })
})

/* ------------------------------------------------------------------ B7 */

/** The element that scrolls the page (the main region). */
const scroller = (page: Page) =>
  page.evaluateHandle(() => {
    let el: HTMLElement | null = document.querySelector('[data-testid="patchbay-page"]')
    while (el && !(el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement
    return el ?? document.scrollingElement
  })
const scrollTop = async (page: Page) => (await scroller(page)).evaluate((el) => (el as HTMLElement).scrollTop)
const glyph = (page: Page, label = 'F1') => page.locator(`[data-testid="pb-glyph"][data-label="${label}"]`)
const glyphAt = (page: Page, label = 'F1') =>
  glyph(page, label).evaluate((g) => {
    const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute('transform') ?? '')
    return { x: Number(m?.[1]), y: Number(m?.[2]) }
  })
const focusedAttr = (page: Page, attr: string) => page.evaluate((a) => document.activeElement?.getAttribute(a) ?? null, attr)

/** Room below the page (the fuse plate stays where it is) so the rack can be scrolled out of view. */
const tallPage = (page: Page) =>
  page.evaluate(() => {
    const p = document.createElement('div')
    p.style.cssText = 'height: 1600px'
    p.setAttribute('aria-hidden', 'true')
    document.querySelector('[data-testid="patchbay-page"]')!.append(p)
  })

test.describe('B7 · cables, net flags, the fuse glyph', () => {
  test('the SVG holds the readout\'s cables; dashed and hatched on the right edges; F1\'s glyph halfway along „An Team-Chat“ → Webhook', async ({ page }) => {
    await openRack(page)
    await expect(page.getByTestId('pb-ro-cables')).toHaveText('15 · 3 chosen by the AI')
    const cables = 15
    await expect(page.locator('[data-wire]')).toHaveCount(cables)
    const model = (await page.evaluate(() => (window as unknown as { __onePatchbay: { model: () => unknown } }).__onePatchbay.model())) as {
      edges: Array<{ id: string; can?: boolean; outside?: boolean }>
      fuses: Array<{ key: string; label: string; at: string }>
    }
    const ids = (sel: string) => page.locator(sel).evaluateAll((els) => els.map((e) => e.getAttribute('data-wire')!).sort())
    // dashed = the AI decides (Inbox-Helfer's two cables, the pipeline's git push); hatched = content from outside (the row trigger's)
    const can = model.edges.filter((e) => e.can).map((e) => e.id).sort()
    expect(await ids('[data-wire]:has(.pb-w--can)')).toEqual(can)
    expect(can.filter((id) => id.startsWith('agent:agInbox.'))).toHaveLength(2)
    expect(can.filter((id) => id.startsWith('pipeline:'))).toHaveLength(1)
    const outside = model.edges.filter((e) => e.outside).map((e) => e.id).sort()
    expect(await ids('[data-wire][data-outside]')).toEqual(outside)
    expect(outside.every((id) => id.startsWith('rowTrigger:dbMails:created:-.'))).toBe(true)
    expect(await page.locator('[data-wire][data-outside] .pb-w-ticks').count()).toBe(outside.length)

    // the glyph: one, "F1", on the exit edge of F1, at half the cable's length
    const f1 = model.fuses[0]
    expect(f1.at).toBe('automation:dbMails:autToChat.out>outbound:webhook:chat.example:POST.out')
    await expect(page.getByTestId('pb-glyph')).toHaveCount(1)
    await expect(glyph(page)).toHaveAttribute('data-fuse', f1.key)
    const mid = await page.locator(`[data-wire="${f1.at}"] .pb-w`).evaluate((p) => {
      const path = p as SVGPathElement
      const pt = path.getPointAtLength(path.getTotalLength() / 2)
      return { x: pt.x, y: pt.y }
    })
    const at = await glyphAt(page)
    expect(Math.abs(at.x - mid.x)).toBeLessThan(2)
    expect(Math.abs(at.y - mid.y)).toBeLessThan(2)
    await expect(glyph(page).locator('.pb-fuse-lbl-t')).toHaveText('F1')
    // the plate under the rack (B8) in view: the active fuse's dashed leader runs to its tab, no "↓ F1" stub
    await expect(glyph(page)).toHaveAttribute('data-active', 'true')
    await expect(page.getByTestId('pb-leader')).toHaveCount(1)
    await expect(glyph(page).locator('.pb-fuse-stub')).toHaveCount(0)

    // a click on the glyph selects F1 and brings its plate into view
    await glyph(page).click()
    await expect(page.getByTestId('pb-ro-fuse-val')).toHaveText('1')
    await expect(page.locator('[data-pb-fuse-tab][aria-selected="true"]')).toHaveAttribute('data-pb-fuse-tab', f1.key)
  })

  test('the leader: only for the selected fuse, only while glyph and plate are both in view — else "↓ F1"', async ({ page }) => {
    await openRack(page)
    await expect(glyph(page)).toBeVisible()
    await tallPage(page)
    // both in view: the dashed leader runs from under the glyph to the plate's tab, the stub goes
    const leader = page.getByTestId('pb-leader')
    await expect(leader).toHaveCount(1)
    await expect(glyph(page).locator('.pb-fuse-stub')).toHaveCount(0)
    const at = await glyphAt(page)
    const d = (await leader.getAttribute('d')) ?? ''
    const m = /^M([-\d.]+),([-\d.]+) V([-\d.]+)$/.exec(d)
    expect(m).not.toBeNull()
    expect(Math.abs(Number(m![1]) - at.x)).toBeLessThan(1)
    const geo = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="pb-bench"]')!.getBoundingClientRect()
      const t = document.querySelector('[data-pb-plate-tab]')!.getBoundingClientRect()
      return { tab: t.top - b.top }
    })
    expect(Math.abs(Number(m![3]) - geo.tab)).toBeLessThan(1.5)
    // the glyph scrolled out of view (the plate still in it): no leader, the stub again — scrolled by the wheel (the
    // shell holds a programmatic scroll of the main region until the person scrolls)
    const el = await scroller(page)
    const ring = await glyph(page).locator('.pb-fuse-ring').evaluate((g) => g.getBoundingClientRect().bottom)
    const start = await el.evaluate((s) => (s as HTMLElement).getBoundingClientRect().top)
    await page.mouse.move(700, 600)
    await page.mouse.wheel(0, ring - start + 24)
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(ring - start)
    await expect(leader).toHaveCount(0)
    await expect(glyph(page).locator('.pb-fuse-stubl-t')).toHaveText('↓ F1')
    await page.mouse.wheel(0, -(ring - start + 24))
    await expect.poll(() => scrollTop(page)).toBe(0)
    await expect(leader).toHaveCount(1)
  })

  test('several fuses: the leader / stub only on the selected one; a glyph click and F move it; F cycles in F-order', async ({ page }) => {
    await openRack(page, exits())
    const glyphs = page.getByTestId('pb-glyph')
    await expect.poll(() => glyphs.count()).toBeGreaterThan(2)
    // nothing selected: F1 is the active fuse (the plate's first tab) — only its glyph carries the stub (or the leader
    // while the plate is in view)
    await expect(page.locator('[data-testid="pb-glyph"][data-active]')).toHaveCount(1)
    await expect.poll(async () => (await page.locator('[data-testid="pb-glyph"] .pb-fuse-stub').count()) + (await page.getByTestId('pb-leader').count())).toBe(1)
    const first = page.locator('[data-testid="pb-glyph"][data-active]')
    await expect(first).toHaveAttribute('data-label', /^F1\b/)
    // a click on another glyph selects its fuse: the stub moves there
    const other = page.locator('[data-testid="pb-glyph"]:not([data-active])').first()
    const otherFuse = (await other.getAttribute('data-fuse'))!
    await other.click()
    await expect(page.locator('[data-testid="pb-glyph"][data-active]')).toHaveAttribute('data-fuses', new RegExp(otherFuse))
    await expect.poll(async () => (await page.locator('[data-testid="pb-glyph"] .pb-fuse-stub').count()) + (await page.getByTestId('pb-leader').count())).toBe(1)
    // F (focus in the rack): the next open fuse in F-order, announced
    const model = (await page.evaluate(() => (window as unknown as { __onePatchbay: { model: () => unknown } }).__onePatchbay.model())) as { fuses: Array<{ key: string; label: string }> }
    const order = [...model.fuses].sort((a, b) => Number(a.label.slice(1)) - Number(b.label.slice(1)))
    await page.locator('[data-testid="pb-module"]').first().focus()
    const now = order.findIndex((f) => f.key === otherFuse)
    await page.keyboard.press('f')
    const next = order[(now + 1) % order.length]
    await expect(page.locator('[data-testid="pb-glyph"][data-active]')).toHaveAttribute('data-fuses', new RegExp(next.key))
    await expect(page.getByTestId('pb-live')).toContainText(`Fuse ${next.label} selected`)
  })

  test('net flags: a click / ↵ lights both twins and jumps to the other end; the keyboard follows, announced', async ({ page }) => {
    await openRack(page)
    const src = page.locator('[data-testid="pb-flag"][data-side="in"]')
    const dst = page.locator('[data-testid="pb-flag"][data-side="out"]')
    await expect(src).toHaveAttribute('title', /same name = the same connection/)
    await src.click()
    await expect(dst).toBeFocused()
    await expect(dst).toHaveAttribute('data-arrived', 'true')
    await expect(src).toHaveAttribute('aria-pressed', 'true')
    await expect(dst).toHaveAttribute('data-lit', 'true')
    await expect(page.getByTestId('pb-live')).toHaveText('The other end: Mails · “Weiterleiten”')
    // the twin's cables light in ink, the rest dims
    await expect.poll(() => page.locator('.pb-w--lit').count()).toBeGreaterThanOrEqual(2)
    await expect.poll(() => page.locator('.pb-w--dim').count()).toBeGreaterThan(0)
    // ↵ on the twin jumps back
    await page.keyboard.press('Enter')
    await expect(src).toBeFocused()
    // Esc clears the lit pair, the keyboard stays
    await page.keyboard.press('Escape')
    await expect(src).toHaveAttribute('aria-pressed', 'false')
    await expect(src).toBeFocused()
  })

  test('a "+n" bus chip: ↵ / click lists the bundled cables; Esc gives the keyboard back; a folded target opens', async ({ page }) => {
    // the fixture's views are the model's minimum — complete them, so a database page can open
    const w = wideScope(40, { named: 9 })
    const full = (d: Database) => ({ ...d, views: d.views.map((v) => ({ ...v, filter: null, sorts: [], visibleProperties: [] })) })
    w.ws.databases = Object.fromEntries(Object.entries(w.ws.databases).map(([k, d]) => [k, full(d)]))
    await openRack(page, w)
    const bus = page.getByTestId('pb-bus')
    await expect(bus).toHaveText('+3')
    await expect(bus).toHaveAccessibleName(/3 more cables: Nordlicht/)
    await bus.click()
    const menu = page.locator('[data-popover][role="menu"]')
    await expect(menu).toContainText('Bundled cables · 3')
    await expect(menu.getByRole('menuitem')).toHaveCount(3)
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(bus).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(menu).toBeVisible()
    const name = ((await menu.getByRole('menuitem').first().textContent()) ?? '').replace('folded into the chip', '').trim()
    await menu.getByRole('menuitem').first().click()
    await expect(page).toHaveURL(/#\/p\//)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(name)
  })
})

test.describe('B7 · keyboard, picker, screen readers', () => {
  test('J finds „Inbox-Helfer“ and puts the keyboard on its jack (its cables lit); Esc there → the module; Esc in the picker → back where J was pressed', async ({ page }) => {
    await openRack(page)
    const picker = page.getByTestId('pb-jack-picker')
    await module(page, 'agent:agTessera').focus()
    await page.keyboard.press('j')
    await expect(picker).toBeVisible()
    await expect(picker.getByRole('listbox')).toBeVisible()
    await expect(picker.getByRole('combobox').or(picker.locator('input'))).toBeFocused()
    // every row: Module · jack → what it is cabled to
    await expect(picker.getByRole('option').filter({ hasText: 'Tessera-Spiegel' }).first()).toContainText('→')
    await page.keyboard.type('Inbox-Helfer')
    await expect(picker.getByRole('option').first()).toContainText('Inbox-Helfer')
    await page.keyboard.press('Enter')
    await expect(picker).toHaveCount(0)
    await expect.poll(() => focusedAttr(page, 'data-jack')).toMatch(/^agent:agInbox\./)
    await expect(page.getByTestId('pb-live')).toContainText('the keyboard is on the jack')
    expect(await focusedAttr(page, 'aria-roledescription')).toBe('jack')
    await expect.poll(() => page.locator('.pb-w--lit').count()).toBeGreaterThan(0)
    // Esc on the jack: back to its module
    await page.keyboard.press('Escape')
    await expect(module(page, 'agent:agInbox')).toBeFocused()
    // J, then Esc: the picker closes, the keyboard is where J was pressed
    await page.keyboard.press('j')
    await expect(picker).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(picker).toHaveCount(0)
    await expect(module(page, 'agent:agInbox')).toBeFocused()
    // a jack of a folded module: its fold opens first
    await page.keyboard.press('j')
    await page.keyboard.type('kanal')
    await expect(picker.getByRole('option').first()).toContainText('folded')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('pb-fold')).toHaveAttribute('aria-expanded', 'true')
    await expect.poll(() => focusedAttr(page, 'data-jack')).toMatch(/^server:srvKanal\./)
  })

  test('arrow keys move between modules, flags and folds (one tab stop); Tab leaves the rack; ↵ opens the agent / the automations / the script', async ({ page }) => {
    await openRack(page)
    const rack = page.getByTestId('pb-rack')
    const stops = rack.locator('[data-stop][tabindex="0"]')
    await expect(stops).toHaveCount(1)
    await module(page, 'agent:agTessera').focus()
    // ↓: the next stop in § 02 (the 2U module spans two rows)
    await page.keyboard.press('ArrowDown')
    await expect(module(page, 'script:scWeekly')).toBeFocused()
    await expect(stops).toHaveCount(1)
    await expect(stops).toHaveAttribute('data-stop', 'script:scWeekly')
    // →: § 03 at the same row; ←: back; ← again: § 01 at that row
    await page.keyboard.press('ArrowRight')
    const right = await focusedAttr(page, 'data-stop')
    expect(await page.evaluate(() => document.activeElement?.closest('[data-col]')?.getAttribute('data-col'))).toBe('3')
    await page.keyboard.press('ArrowLeft')
    await expect(module(page, 'script:scWeekly')).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    expect(await page.evaluate(() => document.activeElement?.closest('[data-col]')?.getAttribute('data-col'))).toBe('1')
    expect(right).not.toBeNull()
    // the idle fold and the flags are stops too
    await page.keyboard.press('End')
    expect(await focusedAttr(page, 'data-testid')).toMatch(/pb-fold|pb-flag/)
    // Tab leaves the rack; Shift+Tab comes back to the same stop
    const last = await focusedAttr(page, 'data-stop')
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="pb-rack"]'))).toBe(false)
    await page.keyboard.press('Shift+Tab')
    expect(await focusedAttr(page, 'data-stop')).toBe(last)

    // ↵ opens: the agent editor, the automations dialog (focus comes back), the script
    await module(page, 'automation:dbMails:autToChat').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(module(page, 'automation:dbMails:autToChat')).toBeFocused()
    await module(page, 'script:scWeekly').focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#\/scripts\/scWeekly$/)
    await page.goBack()
    await expect(page.getByTestId('patchbay-page')).toBeVisible()
    await module(page, 'agent:agInbox').focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#\/agents\/agInbox$/)
  })

  test('Space selects and lights the module\'s Klartext sentence in place, without scrolling', async ({ page }) => {
    await openRack(page)
    const plain = page.getByTestId('pb-plain')
    await expect(page.getByRole('heading', { level: 2, name: '§ In plain words' })).toBeVisible()
    await expect(plain.locator('[data-strand]').first()).toBeVisible()
    const contact = module(page, 'automation:dbMails:autToContact')
    await contact.focus()
    const before = await scrollTop(page)
    await page.keyboard.press('Space')
    await expect(contact).toHaveAttribute('data-selected', 'true')
    await expect(plain.locator('[data-strand="automation:dbMails:autToContact"]')).toHaveAttribute('data-on', 'true')
    await expect(plain.locator('[data-on]')).toHaveCount(1)
    expect(await scrollTop(page)).toBe(before)
    await expect(contact).toBeFocused()
    await expect(page.getByTestId('pb-live')).toHaveText('Neue Mail → Kontakt selected — its connections are lit')
    await page.keyboard.press('Space')
    await expect(plain.locator('[data-on]')).toHaveCount(0)
  })

  test('the accessibility tree: three column lists, module groups with their descriptions, the rack\'s hint', async ({ page }) => {
    await openRack(page)
    const rack = page.getByRole('region', { name: 'Patchbay: 17 modules, 15 cables' })
    await expect(rack).toHaveAccessibleDescription('Arrow keys: modules · Enter: open · Space: show connections · J: find a jack · F: next fuse')
    for (const name of ['§ 01 Sources', '§ 02 Processing', '§ 03 Targets']) await expect(rack.getByRole('list', { name, exact: true })).toBeVisible()
    const helper = rack.getByRole('list', { name: '§ 02 Processing' }).getByRole('group', { name: 'Agent Inbox-Helfer' })
    await expect(helper).toHaveAttribute('aria-roledescription', 'module')
    await expect(helper).toHaveAttribute('aria-keyshortcuts', 'Enter Space J')
    await expect(helper).toHaveAccessibleDescription(/Inbox-Helfer.*F1/)
    await expect(rack.getByRole('list', { name: '§ 01 Sources' }).getByRole('listitem')).toHaveCount(await page.locator('[data-col="1"] > [role="listitem"]').count())
  })

  test('"Picture · zoom": the viewer opens as a Schematic; Download SVG gives a file without var( / color-mix( / oklch(', async ({ page }) => {
    await openRack(page)
    // the whole rack: the button index (idle slices) has read the pages — „Wochenbericht“'s button and its cable
    await expect.poll(() => page.evaluate(() => (window as unknown as { __onePatchbay: { buttons: () => { ready: boolean } } }).__onePatchbay.buttons().ready)).toBe(true)
    const key = page.getByTestId('pb-picture')
    await expect(key).toHaveAttribute('title', 'Static picture with minimap and SVG download')
    await key.click()
    await expect(page.getByTestId('diagram-viewer')).toBeVisible()
    await expect(page.locator('.dv__content svg')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('viewer-plate')).toContainText('Schematic')
    await expect(page.getByTestId('viewer-plate')).toContainText('Whole rack')
    const [file] = await Promise.all([page.waitForEvent('download'), page.getByTestId('diagram-viewer').getByRole('button', { name: 'Download SVG' }).click()])
    expect(file.suggestedFilename()).toBe('patchbay.svg')
    const svg = readFileSync((await file.path())!, 'utf8')
    expect(svg).toMatch(/^<\?xml[^>]*>\s*<svg/)
    for (const bad of ['var(', 'color-mix(', 'oklch(']) expect(svg).not.toContain(bad)
    expect(svg).toContain('Inbox-Helfer')
    expect(svg.match(/class="pb-fuse"/g)).toHaveLength(1)
    expect(svg.match(/class="pb-wire( pb-wire--path)?"/g)?.length).toBe(15)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('diagram-viewer')).toHaveCount(0)
    await expect(key).toBeFocused()
  })

  test('forced colours: cables in CanvasText, the fuse path and its glyph in Highlight', async ({ page }) => {
    await openRack(page)
    await page.emulateMedia({ forcedColors: 'active' })
    const sys = (name: string) =>
      page.evaluate((n) => {
        const el = document.createElement('i')
        el.style.color = n
        document.body.append(el)
        const c = getComputedStyle(el).color
        el.remove()
        return c
      }, name)
    const highlight = await sys('Highlight')
    const text = await sys('CanvasText')
    expect(highlight).not.toBe(text)
    await expect.poll(() => page.locator('[data-wire][data-path] .pb-w').first().evaluate((el) => getComputedStyle(el).stroke)).toBe(highlight)
    await expect.poll(() => page.locator('[data-wire]:not([data-path]) .pb-w').first().evaluate((el) => getComputedStyle(el).stroke)).toBe(text)
    await expect.poll(() => glyph(page).locator('.pb-fuse-wire').evaluate((el) => getComputedStyle(el).stroke)).toBe(highlight)
    await expect.poll(() => glyph(page).locator('.pb-fuse-lbl-t').evaluate((el) => getComputedStyle(el).fill)).toBe(highlight)
  })

  test('relayout ≤ 16 ms on bigPatchbay(60) (measure + render + commit, median of the resizes)', async ({ page }) => {
    await openRack(page, bigPatchbay(60))
    // the whole rack (it opens on "Fuse paths only" past 30 modules)
    await page.getByTestId('pb-filter').click()
    await page.getByTestId('pb-filter-preset').filter({ hasText: 'Everything' }).click()
    await page.keyboard.press('Escape')
    await expect.poll(() => page.locator('[data-wire]').count()).toBeGreaterThan(100)
    await page.evaluate(() => performance.clearMeasures('pb-relayout'))
    for (const w of [1400, 1440, 1380, 1440, 1420, 1440, 1390, 1440]) {
      await page.setViewportSize({ width: w, height: 900 })
      await page.waitForTimeout(120)
    }
    const times = await page.evaluate(() => performance.getEntriesByName('pb-relayout', 'measure').map((e) => e.duration))
    expect(times.length).toBeGreaterThanOrEqual(6)
    const sorted = [...times].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    console.log(`[perf] pb-relayout on bigPatchbay(60): median ${median.toFixed(1)} ms over ${times.length} (${sorted.map((x) => x.toFixed(1)).join(', ')})`)
    expect(median).toBeLessThanOrEqual(16)
  })
})

/* ------------------------------------------------------------------ B8 */

const fpanel = (page: Page) => page.getByTestId('pb-fpanel')
const ftabs = (page: Page) => page.getByTestId('pb-flist').getByRole('tab')
/** The Preflight lamp's reading and view, read now. */
const fuseLamp = (page: Page) =>
  page.evaluate(async () => {
    const pf = (window as unknown as { __onePreflight: { flush: (id?: string) => Promise<void>; readings: () => Record<string, { count: number; ids: string[]; second?: string; state: string } | null>; state: () => { views: Array<{ id: string; level: string; count: number; second: string; master: boolean }>; mc: number } } }).__onePreflight
    await pf.flush('fuses')
    return { reading: pf.readings().fuses ?? null, view: pf.state().views.find((v) => v.id === 'fuses') ?? null }
  })
const pbCounts = (page: Page) => page.evaluate(() => ((window as unknown as { __onePatchbay: { model: () => { unknown: unknown[] } | null } }).__onePatchbay?.model()?.unknown.length ?? null))

test.describe('B8 · the fuse plate and its list', () => {
  test("F1's plate in English and German: the lamps, the path, the sentence, the facts — its tab under the glyph", async ({ page }) => {
    await openRack(page)
    const p = fpanel(page)
    await expect(p).toHaveAttribute('role', 'tabpanel')
    await expect(p.getByRole('heading', { level: 2 })).toHaveText('Fuse F1 · open path')
    await expect(p).toContainText('read from the settings · no guard while it runs')
    const lamps = p.getByTestId('pb-lamps')
    await expect(lamps).toContainText('All 3 conditions met')
    await expect(p.locator('[data-lamp][data-on]')).toHaveCount(3)
    await expect(p.locator('[data-lamp="outside"]')).toContainText('Content from outside')
    await expect(p.locator('[data-lamp="outside"]')).toContainText('Rows of “Mails” from outside, unchecked')
    await expect(p.locator('[data-lamp="private"]')).toContainText('Access: whole workspace')
    await expect(p.locator('[data-lamp="out"]')).toContainText('Webhook · chat.example (POST)')
    // the path: the outside source (hatched) → the decider → the net chip → the automation → the way out ("can send")
    const chips = p.getByTestId('pb-path').locator('.pb-pn')
    await expect(chips).toHaveText([/^Mails · new row\s*from outside$/, 'Inbox-Helfer', '“Weiterleiten”', 'An Team-Chat', /^Webhook · chat\.example\s*can send$/])
    await expect(chips.first()).toHaveClass(/pb-pn--outside/)
    await expect(chips.last()).toHaveClass(/pb-pn--hot/)
    await expect(p.getByTestId('pb-say')).toHaveText('If the agent “Inbox-Helfer” sets “Weiterleiten” without review, the automation “An Team-Chat” sends the row out by webhook. A mail with a hidden instruction can get what the agent read sent.')
    const facts = p.getByTestId('pb-facts').locator('.pb-fact')
    await expect(facts.filter({ hasText: 'Changes' })).toHaveText('Changes Apply directly')
    await expect(facts.filter({ hasText: 'Access' })).toHaveText('Access Everything')
    await expect(facts.filter({ hasText: 'Trigger' })).toHaveText('Trigger Field “Weiterleiten” → POST')
    await expect(facts.filter({ hasText: 'Chain' })).toHaveText('Chain 3 steps')
    await expect(p.getByTestId('pb-mitigations')).toContainText('web images become links')
    // the only orange plate: its frame in the signal colour
    expect(await p.locator('.pb-fplate').evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(await css(page, '--signal'))
    // its tab "F1" sits on the plate's edge right under the glyph; the leader ends there
    const geo = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="pb-bench"]')!.getBoundingClientRect()
      const t = document.querySelector('[data-pb-plate-tab]')!.getBoundingClientRect()
      const g = document.querySelector('[data-testid="pb-glyph"]')!.getAttribute('transform') ?? ''
      return { tab: t.left + t.width / 2 - b.left, glyph: Number(/translate\(([-\d.]+)/.exec(g)?.[1]) }
    })
    expect(Math.abs(geo.tab - geo.glyph)).toBeLessThan(2)
    await expect(page.getByTestId('pb-leader')).toHaveCount(1)
    // the Klartext follows the plate, under its own heading
    const order = await page.evaluate(() => {
      const plate = document.getElementById('pb-fuse-plate')!
      const plain = document.querySelector('[data-testid="pb-plain"]')!
      return !!(plate.compareDocumentPosition(plain) & Node.DOCUMENT_POSITION_FOLLOWING)
    })
    expect(order).toBe(true)

    // German: no pronouns, the words of §1.1
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await expect(p.getByRole('heading', { level: 2 })).toHaveText('Sicherung F1 · offener Weg')
    await expect(p).toContainText('aus den Einstellungen gelesen · schützt nicht während eines Laufs')
    await expect(lamps).toContainText('Alle 3 Bedingungen erfüllt')
    await expect(p.locator('[data-lamp="outside"]')).toContainText('Inhalt von außen')
    await expect(p.locator('[data-lamp="out"]')).toContainText('Weg nach außen')
    await expect(p.getByTestId('pb-say')).toHaveText('Setzt der Agent „Inbox-Helfer“ ohne Prüfung „Weiterleiten“, dann schickt die Automation „An Team-Chat“ die Zeile per Webhook hinaus. Eine Mail mit versteckter Anweisung kann so erreichen, dass gesendet wird, was der Agent gelesen hat.')
    await expect(facts.filter({ hasText: 'Änderungen' })).toHaveText('Änderungen Direkt anwenden')
    await expect(facts.filter({ hasText: 'Kette' })).toHaveText('Kette 3 Schritte')
    await expect(chips.last()).toContainText('kann senden')
    const de = (await page.getByTestId('pb-fuses').textContent()) ?? ''
    for (const banned of ['Vertrauen', 'vertrauen', 'Prüfschritt', 'fremd', 'Fremd', 'Trigger', 'Ausgang']) expect(de).not.toContain(banned)
    await expect(ftabs(page).first()).toContainText('offen')
  })

  test('the fuse list is a tablist in F-order; ↑ / ↓ / Home / End select; F gives a fuse tab the keyboard; the grey rows come last', async ({ page }) => {
    await openRack(page, exits())
    const list = page.getByTestId('pb-flist')
    await expect(list).toHaveAttribute('role', 'tablist')
    await expect(list).toHaveAttribute('aria-orientation', 'vertical')
    const kinds = await ftabs(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')))
    const fuseRows = kinds.filter((k) => k === 'fuse').length
    expect(fuseRows).toBeGreaterThan(2)
    // every fuse first (open ones in F-order), then the grey rows
    expect(kinds.slice(0, fuseRows).every((k) => k === 'fuse')).toBe(true)
    expect(kinds.slice(fuseRows).every((k) => k === 'near' || k === 'unknown')).toBe(true)
    const labels = await list.locator('[data-kind="fuse"] .pb-tag').allTextContents()
    expect(labels).toEqual(labels.map((_, i) => `F${i + 1}`))
    // one selected tab, one tab stop; the panel follows the keys
    await expect(list.locator('[aria-selected="true"]')).toHaveCount(1)
    await expect(list.locator('[tabindex="0"]')).toHaveCount(1)
    await ftabs(page).first().focus()
    await expect(fpanel(page).getByRole('heading', { level: 2 })).toHaveText('Fuse F1 · open path')
    await page.keyboard.press('ArrowDown')
    await expect(ftabs(page).nth(1)).toBeFocused()
    await expect(ftabs(page).nth(1)).toHaveAttribute('aria-selected', 'true')
    await expect(fpanel(page).getByRole('heading', { level: 2 })).toHaveText('Fuse F2 · open path')
    await expect(fpanel(page)).toHaveAttribute('aria-labelledby', (await ftabs(page).nth(1).getAttribute('id'))!)
    await page.keyboard.press('End')
    await expect(ftabs(page).last()).toBeFocused()
    await expect(fpanel(page).getByRole('heading', { level: 2 })).toHaveText(/not counted/)
    await page.keyboard.press('Home')
    await expect(ftabs(page).first()).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(ftabs(page).last()).toBeFocused()
    // F on the rack: the next open fuse's tab takes the keyboard
    await page.getByTestId('pb-module').first().focus()
    await page.keyboard.press('f')
    await expect.poll(() => focusedAttr(page, 'data-pb-fuse-tab')).not.toBeNull()
    await expect(page.locator('[data-pb-fuse-tab][aria-selected="true"]')).toBeFocused()
  })

  test('a module on a gated path shows its "almost open" row; an unknown part is a grey row too — never counted', async ({ page }) => {
    await openRack(page, withUnknown())
    const near = ftabs(page).and(page.locator('[data-kind="near"]'))
    await expect(near).toHaveCount(1)
    await expect(near).toContainText('A person checks first')
    await expect(page.getByTestId('pb-flist').getByText('Not counted')).toBeVisible()
    // the pipeline sits on Inbox-Helfer → Coding → Git, closed by the Confirm gate: selecting it shows that path
    await module(page, 'pipeline:dbCoding').locator('.pb-mod__n').click()
    await expect(near).toHaveAttribute('aria-selected', 'true')
    const p = fpanel(page)
    await expect(p.getByRole('heading', { level: 2 })).toHaveText('Almost open · not counted')
    await expect(p.getByTestId('pb-near-why')).toHaveText('What closes it: A person checks first')
    await expect(p.getByTestId('pb-lamps')).toContainText('2 of 3 conditions met')
    await expect(p.locator('[data-lamp][data-on]')).toHaveCount(2)
    await expect(p.locator('.pb-fplate')).toHaveAttribute('data-state', 'near')
    // no leader while a grey row is shown; no glyph lost either
    await expect(page.getByTestId('pb-leader')).toHaveCount(0)
    await expect(page.getByTestId('pb-glyph')).toHaveCount(1)
    // a module on F1 takes the plate back to F1
    await module(page, 'agent:agInbox').locator('.pb-mod__n').click()
    await expect(p.getByRole('heading', { level: 2 })).toHaveText('Fuse F1 · open path')
    // the part this build cannot read: its own grey row, its words, never counted
    const unknown = ftabs(page).and(page.locator('[data-kind="unknown"]'))
    await expect(unknown).toHaveCount(1)
    await unknown.click()
    await expect(p.getByRole('heading', { level: 2 })).toHaveText('Unknown here · not counted')
    await expect(p).toContainText('Newer settings — unknown here')
    await expect(p).toContainText('Tessera-Spiegel')
    await expect(page.getByTestId('pb-ro-fuse-val')).toHaveText('1')
  })

  test('the fuse blinks 3× on its first appearance, then stays lit; once per fuse and signature in this tab; never with reduced motion or noBlink', async ({ page }) => {
    await openRack(page)
    const led = fpanel(page).locator('.pb-fuse-led')
    await expect(led).toHaveAttribute('data-blink', 'true')
    expect(await led.evaluate((el) => { const c = getComputedStyle(el); return [c.animationName, c.animationIterationCount, c.animationDuration] })).toEqual(['pb-blink', '3', '0.9s'])
    // the glyph's ring and the tab's LED blink in step with it
    await expect(glyph(page).locator('.pb-fuse-ring')).toHaveAttribute('data-blink', 'true')
    await expect(ftabs(page).first().locator('.pb-fuse-led')).toHaveAttribute('data-blink', 'true')
    // a later visit in this tab: steady
    await page.waitForTimeout(2900)
    await page.evaluate(() => (window.location.hash = '#/'))
    await page.evaluate(() => (window.location.hash = '#/patchbay'))
    await expect(fpanel(page).locator('.pb-fuse-led')).toBeVisible()
    await expect(fpanel(page).locator('.pb-fuse-led')).not.toHaveAttribute('data-blink', /.*/)
  })

  test('no blink with reduced motion, nor after noBlink (screenshots)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openRack(page)
    const led = fpanel(page).locator('.pb-fuse-led')
    await expect(led).toHaveAttribute('data-blink', 'true')
    expect(await led.evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    expect(await led.evaluate((el) => getComputedStyle(el).animationName)).toBe('pb-blink')
    await page.evaluate(() => (window as unknown as { __onePatchbay: { noBlink: () => void } }).__onePatchbay.noBlink())
    expect(await led.evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
  })
})

test.describe('B8 · the Preflight lamp, the sidebar, the status bar — LED = lamp = readout', () => {
  test('before any visit, after opening and after a reload: the sidebar LED, the Preflight lamp and the readout count the same; amber, never MASTER CAUTION; open() → ?f=; absent for a viewer', async ({ page }) => {
    await openApp(page)
    await seedPatchbay(page, mock1())
    // before the first visit: the background count after the first paint (eager inputs + the lazy cache)
    await expect(page.getByTestId('patchbay-nav-led')).toContainText('1')
    await page.evaluate(() => (window.location.hash = '#/'))
    await expect.poll(async () => (await fuseLamp(page)).reading?.count).toBe(1)
    let lamp = await fuseLamp(page)
    expect(lamp.view).toMatchObject({ level: 'amber', count: 1, master: false })
    expect(lamp.reading!.ids).toHaveLength(1)
    expect(lamp.reading!.ids[0]).toMatch(/^[0-9a-f]{64}$/)
    // the scripts were never read on this device: unknown parts — the lamp's second line says so (never "safe")
    const unknownBefore = (await pbCounts(page)) ?? 0
    expect(unknownBefore).toBeGreaterThan(0)
    expect(lamp.view!.second).toBe(`${unknownBefore} unknown`)
    await expect(page.locator('.pf-cap[data-lamp="fuses"]')).toHaveAttribute('data-lit', 'amber')
    // the cap opens the Patchbay at that fuse
    await page.locator('.pf-cap[data-lamp="fuses"]').click()
    await expect.poll(() => decodeURIComponent(page.url())).toContain(`#/patchbay?f=${lamp.reading!.ids[0]}`)
    await expect(page.getByTestId('pb-ro-fuse-val')).toHaveText('1')
    await expect(page.locator('[data-pb-fuse-tab][aria-selected="true"]')).toHaveAttribute('data-pb-fuse-tab', lamp.reading!.ids[0])
    // opening read the scripts: the unknown parts are gone everywhere at once
    await expect.poll(() => pbCounts(page)).toBe(0)
    await expect(page.getByTestId('pb-ro-unknown')).toHaveCount(0)
    await expect.poll(async () => (await fuseLamp(page)).view?.second).toBe('')
    await expect(page.getByTestId('patchbay-nav-led')).toContainText('1')

    // after a reload, before the next visit: the lazy cache keeps the readings — still 1 open, nothing unknown
    await reloadApp(page)
    await page.evaluate(() => (window.location.hash = '#/'))
    await expect(page.getByTestId('patchbay-nav-led')).toContainText('1')
    await expect.poll(async () => (await fuseLamp(page)).reading?.count).toBe(1)
    await expect.poll(async () => (await fuseLamp(page)).view?.second).toBe('')
    expect(await pbCounts(page)).toBe(0)
    await page.getByTestId('patchbay-nav').click()
    await expect(page.getByTestId('pb-ro-fuse-val')).toHaveText('1')

    // a viewer: no lamp (nothing to act on), the LED in neutral ink
    await page.evaluate(() => (window.location.hash = '#/'))
    await page.evaluate(() => (window as unknown as { __one: { cloud: { useCloud: { setState: (s: unknown) => void } } } }).__one.cloud.useCloud.setState({ readOnly: true }))
    await expect.poll(async () => (await fuseLamp(page)).view).toBeNull()
    await expect(page.locator('.pf-cap[data-lamp="fuses"]')).toHaveCount(0)
    await expect(page.getByTestId('patchbay-nav-led')).toHaveAttribute('data-viewer', 'true')
  })

  test('the status bar cell "Patchbay · 1 fuse" opens the fuse and sheds first', async ({ page }) => {
    await openApp(page)
    await seedPatchbay(page, mock1())
    const cell = page.getByTestId('patchbay-status')
    await expect(cell).toHaveText('Patchbay · 1 fuse')
    expect(await cell.locator('.pb-status__n').evaluate((el) => getComputedStyle(el).color)).toBe(await css(page, '--signal-ink'))
    // a bar too short for its cells: the cell is the first thing to go (level 1), nothing else of level 2+ yet
    const bar = page.locator('footer.status')
    let width = 1440
    while (width > 800 && (await bar.getAttribute('data-shed-1')) === null) {
      width -= 10
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(60)
    }
    await expect(bar).toHaveAttribute('data-shed-1', '')
    await expect(bar).not.toHaveAttribute('data-shed-2', /.*/)
    await expect(cell).toBeHidden()
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(cell).toBeVisible()
    await cell.click()
    await expect(page).toHaveURL(/#\/patchbay\?f=[0-9a-f]{64}$/)
    // German
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await expect(cell).toHaveText('Schaltplan · 1 Sicherung')
  })
})

test.describe('B8 · 390 px: the strands', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  for (const scheme of ['light', 'dark'] as const) {
    test(`the strands (${scheme}): the fuse card first, every counted strand, "Not processed" names the rest, no sideways scroll; a run lights in place (order kept) with the jump chip; taps open`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await openRack(page)
      await expect(page.getByTestId('patchbay-page')).toHaveAttribute('data-view', 'strands')
      // the readout: runs today and the fuse only
      await expect(page.getByTestId('pb-ro-fuse-val')).toHaveText('1')
      await expect(page.getByTestId('pb-ro-modules')).toHaveCount(0)
      // the fuse card: lamps in a row, the path downwards with the first write in words, the sentence
      const card = page.getByTestId('pb-fcard')
      await expect(card).toHaveCount(1)
      await expect(card.getByRole('heading', { level: 2 })).toHaveText('Fuse F1 · open path')
      await expect(card.getByTestId('pb-lamps')).toHaveText(/From outside.*Private.*Way out/)
      await expect(card.locator('.pb-path__via')).toHaveText('sets “Weiterleiten”')
      await expect(card.getByTestId('pb-say')).toContainText('A mail with a hidden instruction')
      expect(await card.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(await css(page, '--signal'))
      // the order: the fuse card, then the strands, then "Not processed"
      const firstStrandBelowCard = await page.evaluate(() => {
        const c = document.querySelector('[data-testid="pb-fcard"]')!.getBoundingClientRect()
        const s = document.querySelector('[data-testid="pb-strand"]')!.getBoundingClientRect()
        return s.top > c.bottom
      })
      expect(firstStrandBelowCard).toBe(true)
      // every strand the rack counts (its processors) is here; the rest are named
      const strands = page.getByTestId('pb-strand')
      await expect(strands).toHaveCount(6)
      await expect(page.locator('.pb-sh').first()).toContainText('Strands · 6')
      await expect(page.getByTestId('pb-strands-rest')).toContainText('kanal')
      await expect(page.getByTestId('pb-strands-rest')).toContainText('wiki')
      // no sideways scroll, hit targets ≥ 40 px
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
      expect(await page.evaluate(() => { const el = document.querySelector('[data-testid="patchbay-page"]')!; return el.scrollWidth <= el.clientWidth + 1 })).toBe(true)
      for (const h of await page.getByTestId('pb-line').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(40)

      // a run starts: the strand lights in place, nothing moves, the floating chip jumps there
      const order = await strands.evaluateAll((els) => els.map((e) => e.getAttribute('data-key')))
      const tops = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="pb-fcard"], [data-testid="pb-strand"]')].map((e) => Math.round(e.getBoundingClientRect().top + (document.scrollingElement?.scrollTop ?? 0))))
      const before = await tops()
      await page.evaluate(async () => {
        const rec = (window as unknown as { __oneRecorder: { step: (s: unknown) => Promise<unknown> } }).__oneRecorder
        await rec.step({ writer: { kind: 'agent', id: 'agTessera', run: 'rPhone1' }, note: { seq: 1 }, calls: [] })
      })
      const live = page.locator('[data-testid="pb-strand"][data-key="agent:agTessera"]')
      await expect(live).toHaveAttribute('data-live', 'true')
      expect(await strands.evaluateAll((els) => els.map((e) => e.getAttribute('data-key')))).toEqual(order)
      const jump = page.getByTestId('pb-jump')
      await expect(jump).toHaveText('running · Tessera-Spiegel ↓')
      // fix (patch): the chip takes no room in the list — no card moved when it came (§6 U13)
      expect(await tops()).toEqual(before)
      await expect(jump).toBeInViewport()
      await jump.tap()
      await expect(live.getByTestId('pb-strand-open')).toBeFocused()

      // a tap on a line opens that line's module (the webhook → its automation's dialog); on the card, its editor
      const chat = page.locator('[data-testid="pb-strand"][data-key="automation:dbMails:autToChat"]')
      await chat.getByTestId('pb-line').filter({ hasText: 'Webhook' }).tap()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await page.waitForTimeout(500)
      await page.locator('[data-testid="pb-strand"][data-key="agent:agInbox"]').locator('.pb-strand__h').tap()
      await expect(page).toHaveURL(/#\/agents\/agInbox$/)
    })
  }
})
