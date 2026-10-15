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
 * Every name is fictional (tests/fixtures/patchbay.ts).
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval, MOD } from './fixtures'
import { database, dbPage, mock1, seedPatchbay, server, world, type PbWorld } from '../fixtures/patchbay'
import type { CustomAgent } from '../../src/app/store/types'

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
    for (const f of await flags.all()) await expect(f).toContainText(/Mails · „Weiterleiten“/)
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
