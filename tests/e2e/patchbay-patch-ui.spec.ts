/**
 * The Patchbay's patching UI — B16, P4 (plan §1.13, §2.9, §3.9; §6 U16 / A22 / A23):
 *  - Node: what a jack may be patched to (patchPick.ts) — targets, sources (the rack's, § 01 flags, a database's
 *    commands, a new row), the OUT lock per profile, every cable's unplug; the drop's direction; what a drag lights;
 *  - the switch off: no drag source, "Connect to …" inert, J still finds jacks; the switch is this device's (a reload);
 *  - the switch on: drag the clock → a second agent (trigger set; Mod+Z takes it back), the drag lights the jacks it
 *    may plug into in ink and dims the rest;
 *  - drag WRITE? → Tessera-Spiegel (the mirror): the popover at the target jack asks once — the recipe's tool list and
 *    "+F2"; Esc gives the keyboard back to the source jack; Plug anyway → F2 on the rack; the toast's Undo → F2 gone;
 *  - a click on a jack opens the picker (single pointer); touch: a tap opens it, a touch drag pulls nothing; the hit
 *    area is ≥ 24 px × the text size at XL;
 *  - the keyboard: J on a jack → "Connect to …" → ↵;
 *  - Delete on An Team-Chat's way out → F1 gone; the toast's Undo puts the action back with its headers untouched; the
 *    writers (`you~patchbay`, the Undo `you~undo`);
 *  - a drop onto a way out → refused: "Ways out are made in their editor." with "Open the editor" (↵);
 *  - the refused choices of the picker stay listed with their reason; the phone (strands view) has no switch.
 * Every name is fictional (tests/fixtures/patchbay.ts); every host `*.example` (and routed — nothing leaves).
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, wsEval, MOD } from './fixtures'
import { mock1, inputOf, modelOf, seedPatchbay, TRACKER_READS, type PbWorld } from '../fixtures/patchbay'
import { acceptOf, choicesOf, dropPatch, jackOf } from '../../src/app/features/patchbay/patchPick'
import { moduleKey, scheduleKey } from '../../src/app/features/patchbay/ref'
import { expectLane, markRec, startRecorder } from './helpers/recorder'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const CLOCK = moduleKey({ kind: 'clock', schedule: scheduleKey({ type: 'schedule', every: 'weekday', at: '07:30', tz: 'Europe/Berlin' }), agents: [] })
const TRACKER = 'server:srvTracker'
const INBOX = 'agent:agInbox'
const MIRROR = 'agent:agTessera'
const TO_CHAT = 'automation:dbMails:autToChat'
const HOOK = 'outbound:webhook:chat.example:POST'

/**
 * Mock 1 at rest: Tessera-Spiegel's weekday 07:30 slot would run it on open (no key here — its "! FAILED" window and a
 * toast would cover what these cases look at).
 */
const atRest = (): PbWorld => {
  const w = mock1()
  w.ws.agents = { ...w.ws.agents, agTessera: { ...w.ws.agents!.agTessera, updatedAt: Date.parse('2031-01-01T00:00:00Z') } }
  return w
}

async function openRack(page: Page, opts: { patching?: boolean; w?: PbWorld; scale?: number; rack?: boolean } = {}) {
  await openApp(page)
  await page.route(/\.example\//, (r) => r.fulfill({ status: 200, body: 'ok' }))
  await page.evaluate(
    ({ on, scale }) => {
      if (on) localStorage.setItem('one.patchbay.patch', '1')
      else localStorage.removeItem('one.patchbay.patch')
      if (scale) localStorage.setItem('one.textScale', String(scale))
    },
    { on: !!opts.patching, scale: opts.scale ?? 0 },
  )
  if (opts.scale) await reloadApp(page)
  await seedPatchbay(page, opts.w ?? atRest())
  await page.evaluate(() => (window.location.hash = '#/patchbay'))
  await expect(page.getByTestId('patchbay-page')).toBeVisible()
  if (opts.rack !== false) await expect(page.getByTestId('pb-wires')).toBeVisible()
}

const jack = (page: Page, key: string) => page.locator(`.pb-jk[data-jack="${key}"]`)
const socket = (page: Page, key: string) => jack(page, key).locator('.pb-jack')
const sw = (page: Page) => page.getByTestId('pb-patching').getByRole('switch', { name: 'Patching' })
const live = (page: Page) => page.getByTestId('pb-live')
const toast = (page: Page, text: string | RegExp) => page.locator('.toast').filter({ hasText: text }).last()
const fuseVal = (page: Page) => page.getByTestId('pb-ro-fuse-val')
const agentOf = (page: Page, id: string) => wsEval(page, (s, a) => s.agents[a] as AnyState, id)
const automationsOf = (page: Page, db: string) => wsEval(page, (s, d) => s.databases[d].automations as AnyState[], db)

async function centre(page: Page, key: string) {
  const b = (await socket(page, key).boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

/** Press on a jack, pull the cable over `to` (a jack key, or a locator's centre) and hold — the caller drops. */
async function pull(page: Page, from: string, to: string | { x: number; y: number }) {
  const a = await centre(page, from)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(a.x + 30, a.y + 12, { steps: 3 })
  const z = typeof to === 'string' ? await centre(page, to) : to
  await page.mouse.move(z.x, z.y, { steps: 8 })
}

/* ------------------------------------------------------------------ Node: patchPick */

test.describe('B16 · Node — what a jack may be patched to', () => {
  test('targets and sources by the matrix, the OUT lock per profile, every cable’s unplug, the drop’s direction, what a drag lights', () => {
    const w = mock1()
    const model = modelOf(w)
    const input = inputOf(w)
    const j = (key: string) => jackOf(model, key)!

    // tracker WRITE? → the agents' tools (Inbox-Helfer has no tools jack yet); "Lock this tool (OUT)" per write tool for IN-01
    const write = choicesOf(j(`${TRACKER}.write`), model, input)
    expect(write.filter((c) => c.group === 'to').map((c) => `${c.other.module}.${c.other.role}`).sort()).toEqual([`${INBOX}.tools`, `${MIRROR}.tools`].sort())
    expect(write.filter((c) => c.group === 'lock').map((c) => c.tool)).toEqual(['create_issue', 'update_issue', 'add_comment', 'post_status'])
    expect(write.find((c) => c.group === 'lock')!.patch).toEqual({ op: 'plug', from: { module: TRACKER, role: 'write', tool: 'create_issue' }, to: { module: 'outbox:in-01:-', role: 'send' } })
    // its cable to the mirror's tools is its unplug
    expect(write.filter((c) => c.group === 'unplug')).toEqual([])
    const read = choicesOf(j(`${TRACKER}.read`), model, input)
    expect(read.filter((c) => c.group === 'unplug').map((c) => c.patch)).toEqual([{ op: 'unplug', from: { module: TRACKER, role: 'read' }, to: { module: MIRROR, role: 'tools' }, edge: `${TRACKER}.read>${MIRROR}.tools` }])

    // Inbox-Helfer's start (an in jack): the clock, the rack's row trigger and § 01 flags, a database's commands and a
    // new row of any database (the rack does not draw them) — never a repeating template's clock
    const start = choicesOf(j(`${INBOX}.start`), model, input)
    const from = start.filter((c) => c.group === 'from')
    expect(from.some((c) => c.other.module === CLOCK && !c.virtual)).toBe(true)
    expect(from.some((c) => c.other.module === 'net:dbMails:pMailFwd')).toBe(true)
    expect(from.filter((c) => c.other.role === 'rows').map((c) => c.other.module).sort()).toEqual(['database:dbCoding', 'database:dbHandoff', 'database:dbKontakte', 'database:dbMails'])
    expect(from.find((c) => c.other.module === 'database:dbMails' && c.other.role === 'rows')?.virtual).toBe(true)
    // one row event, one choice: the § 01 flag „Weiterleiten“ is that field's change (no second, undrawn twin)
    expect(from.filter((c) => c.other.module === 'net:dbMails:pMailFwd' || c.other.module === 'rowTrigger:dbMails:changed:pMailFwd')).toHaveLength(1)
    expect(from.some((c) => c.other.module === 'rowTrigger:dbKontakte:created:-' && c.virtual)).toBe(true)
    expect(from.every((c) => c.patch.to.module === INBOX && c.patch.to.role === 'start')).toBe(true)
    expect(start.filter((c) => c.group === 'unplug').map((c) => c.other.module)).toEqual(['rowTrigger:dbMails:created:-'])

    // An Team-Chat's way out: a script to run (its database's), its webhook's unplug; an EVERYTHING jack offers no plug at all
    expect(choicesOf(j(`${TO_CHAT}.out`), model, input).map((c) => [c.group, c.other.module])).toEqual([['to', 'script:scWeekly'], ['unplug', HOOK]])
    expect(choicesOf(j(`${INBOX}.everything`), model, input).filter((c) => c.group !== 'unplug')).toEqual([])

    // a drop: from an out jack as dragged, from an in jack reversed; onto a module's body the role it accepts
    expect(dropPatch(j(`${CLOCK}.start`), { jack: j(`${INBOX}.start`) }, model, input)).toEqual({ op: 'plug', from: { module: CLOCK, role: 'start' }, to: { module: INBOX, role: 'start' } })
    expect(dropPatch(j(`${INBOX}.start`), { jack: j(`${CLOCK}.start`) }, model, input)).toEqual({ op: 'plug', from: { module: CLOCK, role: 'start' }, to: { module: INBOX, role: 'start' } })
    expect(dropPatch(j(`${TRACKER}.write`), { module: INBOX }, model, input)).toEqual({ op: 'plug', from: { module: TRACKER, role: 'write' }, to: { module: INBOX, role: 'tools' } })
    expect(dropPatch(j(`${INBOX}.writes`), { module: HOOK }, model, input)).toEqual({ op: 'plug', from: { module: INBOX, role: 'writes' }, to: { module: HOOK, role: 'out' } })
    expect(dropPatch(j(`${INBOX}.start`), { jack: j(`${INBOX}.writes`) }, model, input)).toBeNull()

    // a drag from WRITE? lights the mirror's tools jack; Inbox-Helfer's module takes the drop (no tools jack drawn)
    const lit = acceptOf(j(`${TRACKER}.write`), model, input)
    expect([...lit.jacks].sort()).toEqual([`${INBOX}.tools`, `${MIRROR}.tools`].sort())
    expect([...lit.modules]).toEqual([INBOX])
  })
})

/* ------------------------------------------------------------------ the switch */

test.describe('B16 · the Patching switch', () => {
  test('off: no drag source, "Connect to …" inert, J still finds jacks, Delete unplugs nothing; on survives a reload', async ({ page }) => {
    await openRack(page)
    await expect(sw(page)).toHaveAttribute('aria-checked', 'false')
    // no drag: the cable is never pulled, nothing written
    await pull(page, `${TRACKER}.write`, `${MIRROR}.tools`)
    await expect(page.getByTestId('pb-drag')).toHaveCount(0)
    await page.mouse.up()
    expect((await agentOf(page, 'agTessera')).mcpTools).toEqual({ tracker: TRACKER_READS })
    await expect(page.getByTestId('pb-patch-ask')).toHaveCount(0)
    // a click on a jack opens no picker (the module is selected, as ever)
    await jack(page, `${CLOCK}.start`).click()
    await expect(page.getByTestId('pb-connect')).toHaveCount(0)
    await expect(page.locator(`.pb-mod[data-key="${CLOCK}"]`)).toHaveAttribute('data-selected')
    await page.keyboard.press('Escape')
    // J finds a jack; J on that jack finds again (never "Connect to …"); Delete leaves its cable
    await page.locator('.pb-title').focus()
    await page.keyboard.press('j')
    await expect(page.getByTestId('pb-jack-picker')).toBeVisible()
    await page.keyboard.type('Every weekday')
    await page.keyboard.press('Enter')
    await expect(jack(page, `${CLOCK}.start`)).toBeFocused()
    await page.keyboard.press('Delete')
    await page.keyboard.press('j')
    await expect(page.getByTestId('pb-jack-picker')).toBeVisible()
    await expect(page.getByTestId('pb-connect')).toHaveCount(0)
    await page.keyboard.press('Escape')
    expect((await agentOf(page, 'agTessera')).trigger.type).toBe('schedule')
    await expect(page.getByTestId('pb-legend-patch')).toHaveCount(0)

    // on: this device's, said, kept over a reload; the legend names Delete
    await sw(page).click()
    await expect(sw(page)).toHaveAttribute('aria-checked', 'true')
    await expect(live(page)).toContainText('Patching on — drag from a jack, or press J on a jack')
    expect(await page.evaluate(() => localStorage.getItem('one.patchbay.patch'))).toBe('1')
    await expect(page.getByTestId('pb-legend-patch')).toContainText('Unplug')
    await reloadApp(page)
    await page.evaluate(() => (window.location.hash = '#/patchbay'))
    await expect(sw(page)).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('pb-bench')).toHaveAttribute('data-patching', '')
    // off again: the key goes
    await sw(page).click()
    expect(await page.evaluate(() => localStorage.getItem('one.patchbay.patch'))).toBeNull()
    await expect(page.getByTestId('pb-bench')).not.toHaveAttribute('data-patching', '')
  })
})

/* ------------------------------------------------------------------ drag */

test.describe('B16 · drag a cable', () => {
  test('the clock → Inbox-Helfer: the jacks it may plug into lit in ink, the rest dimmed; the trigger set; Mod+Z takes it back', async ({ page }) => {
    await openRack(page, { patching: true })
    await pull(page, `${CLOCK}.start`, `${INBOX}.start`)
    await expect(page.getByTestId('pb-drag')).toBeVisible()
    await expect(jack(page, `${CLOCK}.start`)).toHaveAttribute('data-pdrag', 'source')
    await expect(jack(page, `${INBOX}.start`)).toHaveAttribute('data-pdrag', 'accept')
    await expect(jack(page, `${INBOX}.start`)).toHaveAttribute('data-pover')
    await expect(jack(page, `${MIRROR}.start`)).toHaveAttribute('data-pdrag', 'accept')
    await expect(jack(page, `${TRACKER}.read`)).toHaveAttribute('data-pdrag', 'no')
    // lit in ink, never orange; the rest dimmed
    const ring = await socket(page, `${INBOX}.start`).evaluate((el) => getComputedStyle(el).boxShadow)
    const ink = await page.evaluate(() => {
      const el = document.createElement('i')
      el.style.color = 'var(--ink)'
      document.body.append(el)
      const c = getComputedStyle(el).color
      el.remove()
      return c
    })
    expect(ring).toContain(ink)
    expect(Number(await jack(page, `${TRACKER}.read`).evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(0.5)
    await page.mouse.up()
    await expect(page.getByTestId('pb-drag')).toHaveCount(0)

    await expect.poll(async () => (await agentOf(page, 'agInbox')).trigger).toEqual({ type: 'schedule', every: 'weekday', at: '07:30', tz: 'Europe/Berlin' })
    await expect(toast(page, 'Plugged: Every weekday at 07:30 → Inbox-Helfer')).toBeVisible()
    await expect(live(page)).toContainText('Plugged: Every weekday at 07:30 → Inbox-Helfer')
    await expect(jack(page, `${CLOCK}.start`)).toBeFocused()

    await page.keyboard.press(`${MOD}+z`)
    await expect.poll(async () => (await agentOf(page, 'agInbox')).trigger).toEqual({ type: 'row_created', databaseId: 'dbMails' })
    await expect(toast(page, 'Taken back — Every weekday at 07:30 → Inbox-Helfer')).toBeVisible()
    const stack = await page.evaluate(() => (window as unknown as { __onePatchbayPatches: { stack: () => AnyState[] } }).__onePatchbayPatches.stack())
    expect(stack).toEqual([{ id: expect.any(String), op: 'plug', from: CLOCK, to: INBOX, undone: true }])
  })

  test('WRITE? → Tessera-Spiegel: the popover at the target jack asks once (the recipe’s tool list, "+F2"); Esc → the source jack; Plug anyway → F2; the toast’s Undo → F2 gone', async ({ page }) => {
    await openRack(page, { patching: true })
    await expect(fuseVal(page)).toHaveText('1')
    await pull(page, `${TRACKER}.write`, `${MIRROR}.tools`)
    // the preview cable says what the drop would open
    await expect(page.getByTestId('pb-drag')).toHaveAttribute('data-opens', '+F2')
    await page.mouse.up()
    const ask = page.getByTestId('pb-patch-ask')
    await expect(ask).toBeVisible()
    await expect(ask.getByTestId('pb-patch-opens')).toHaveText('+F2')
    await expect(ask).toContainText('tracker → Tessera-Spiegel')
    await expect(ask.locator('li[data-ask="mirrorWiden"]')).toHaveText('This changes the recipe’s tool list. Plug it anyway?')
    await expect(ask.locator('li[data-ask="opensFuse"]')).toHaveText('This opens a way out — fuse F2. Plug it anyway?')
    await expect(ask.getByTestId('pb-patch-go')).toBeFocused()
    // anchored at the target jack: under it, across it
    const at = await centre(page, `${MIRROR}.tools`)
    await expect
      .poll(async () => {
        const pop = (await ask.boundingBox())!
        return pop.y > at.y && pop.y - at.y < 40 && at.x > pop.x && at.x < pop.x + pop.width
      })
      .toBe(true)
    // Esc: nothing written, the keyboard back on the source jack
    await page.keyboard.press('Escape')
    await expect(ask).toHaveCount(0)
    await expect(jack(page, `${TRACKER}.write`)).toBeFocused()
    expect((await agentOf(page, 'agTessera')).mcpTools).toEqual({ tracker: TRACKER_READS })

    // again — Plug anyway: every tool of tracker, fuse F2 on the rack
    await pull(page, `${TRACKER}.write`, `${MIRROR}.tools`)
    await page.mouse.up()
    await ask.getByTestId('pb-patch-go').click()
    await expect.poll(async () => (await agentOf(page, 'agTessera')).mcpTools ?? null).toBeNull()
    await expect(fuseVal(page)).toHaveText('2')
    await expect(page.locator('[data-pb-fuse-tab]').filter({ hasText: 'F2' }).first()).toBeVisible()
    const done = toast(page, 'Plugged: tracker → Tessera-Spiegel')
    await expect(done).toContainText('Fuse F2 is open now.')
    await done.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await agentOf(page, 'agTessera')).mcpTools).toEqual({ tracker: TRACKER_READS })
    await expect(fuseVal(page)).toHaveText('1')
  })

  test('a drop onto a way out is refused — "Ways out are made in their editor." — with "Open the editor" (↵)', async ({ page }) => {
    await openRack(page, { patching: true })
    await pull(page, `${INBOX}.writes`, `${HOOK}.out`)
    // never lit: a way out takes no patch
    await expect(jack(page, `${HOOK}.out`)).toHaveAttribute('data-pdrag', 'no')
    await page.mouse.up()
    const no = page.getByTestId('pb-patch-no')
    await expect(no).toContainText('Not connected')
    await expect(no).toContainText('Ways out are made in their editor.')
    await expect(live(page)).toContainText('Not connected: Ways out are made in their editor.')
    await expect(no.getByTestId('pb-patch-open')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog').filter({ hasText: 'An Team-Chat' })).toBeVisible()
    expect((await automationsOf(page, 'dbMails')).find((a) => a.id === 'autToChat')!.actions).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ pointer & touch */

test.describe('B16 · a click opens "Connect to …"', () => {
  test('a click on a jack: the picker lists what connects — a refused choice stays, with its reason; Esc gives the jack the keyboard', async ({ page }) => {
    await openRack(page, { patching: true })
    await jack(page, `${TO_CHAT}.start`).click()
    const picker = page.getByTestId('pb-connect')
    await expect(picker).toBeVisible()
    await expect(picker).toContainText('An Team-Chat · start')
    await expect(picker.locator('[cmdk-group-heading]')).toHaveText(['Connect from', 'Unplug'])
    // its own database's field changes are sources; another database's never — a deleted row is
    await expect(picker.locator('[data-choice="from:rowTrigger:dbMails:deleted:-.start"]')).toContainText('Mails · deleted row')
    await expect(picker.locator('[data-choice^="from:rowTrigger:dbKontakte"]')).toHaveCount(0)
    // the module is not selected by the click
    await expect(page.locator(`.pb-mod[data-key="${TO_CHAT}"]`)).not.toHaveAttribute('data-selected')
    await page.keyboard.press('Escape')
    await expect(picker).toHaveCount(0)
    await expect(jack(page, `${TO_CHAT}.start`)).toBeFocused()

    // a refused choice: listed, aria-disabled, with why (a locked database: no re-wiring of its automations)
    await jack(page, `${TRACKER}.write`).click()
    await expect(picker).toBeVisible()
    const lock = picker.locator('[data-choice="lock:in-01:create_issue"]')
    await expect(lock).toContainText('create_issue → Outbox · IN-01')
    await expect(lock).toHaveAttribute('data-state', 'ok')
    await expect(picker.locator(`[data-choice="to:${MIRROR}.tools"]`)).toContainText('+F2')
    await page.keyboard.press('Escape')
    const w = atRest()
    w.ws.databases.dbMails = { ...w.ws.databases.dbMails, locked: true }
    await seedPatchbay(page, w)
    await jack(page, `${TO_CHAT}.start`).click()
    const refused = picker.locator('[data-choice="from:rowTrigger:dbMails:deleted:-.start"]')
    await expect(refused).toHaveAttribute('data-state', 'refused')
    await expect(refused).toHaveAttribute('aria-disabled', 'true')
    await expect(refused.getByTestId('pb-connect-why')).toHaveText('The database is locked.')
  })

  test('the hit area of a jack is ≥ 24 px × the text size (XL)', async ({ page }) => {
    await page.setViewportSize({ width: 2400, height: 1200 })
    await openRack(page, { patching: true, scale: 4 })
    await expect(page.getByTestId('patchbay-page')).toHaveAttribute('data-view', 'rack')
    const scale = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--text-scale')))
    expect(scale).toBeGreaterThan(1.2)
    for (const key of [`${CLOCK}.start`, `${INBOX}.start`, `${TRACKER}.write`]) {
      const size = await socket(page, key).evaluate((el) => {
        const s = getComputedStyle(el, '::after')
        return [parseFloat(s.width), parseFloat(s.height)]
      })
      expect(size[0]).toBeGreaterThanOrEqual(24 * scale - 0.5)
      expect(size[1]).toBeGreaterThanOrEqual(24 * scale - 0.5)
      // a press 11 px × scale left or right of the socket's centre is still the jack's
      const c = await centre(page, key)
      for (const dx of [-11 * scale, 11 * scale]) {
        const hit = await page.evaluate(({ x, y }) => (document.elementFromPoint(x, y)?.closest('.pb-jk') as HTMLElement | null)?.dataset.jack ?? null, { x: c.x + dx, y: c.y })
        expect(hit).toBe(key)
      }
    }
  })
})

test.describe('B16 · touch', () => {
  test.use({ hasTouch: true })
  test('a tap opens the picker; a touch drag pulls no cable', async ({ page }) => {
    await openRack(page, { patching: true })
    await jack(page, `${CLOCK}.start`).tap()
    await expect(page.getByTestId('pb-connect')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('pb-connect')).toHaveCount(0)
    // a touch drag (coarse: never a drag)
    const a = await centre(page, `${CLOCK}.start`)
    const z = await centre(page, `${INBOX}.start`)
    await page.evaluate(
      ({ a, z }) => {
        const at = (x: number, y: number) => document.elementFromPoint(x, y)!
        const ev = (type: string, x: number, y: number) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1 })
        at(a.x, a.y).dispatchEvent(ev('pointerdown', a.x, a.y))
        for (let i = 1; i <= 10; i++) window.dispatchEvent(ev('pointermove', a.x + ((z.x - a.x) * i) / 10, a.y + ((z.y - a.y) * i) / 10))
        ;(window as unknown as { __pbDragSeen?: boolean }).__pbDragSeen = !!document.querySelector('[data-testid="pb-drag"]')
        at(z.x, z.y).dispatchEvent(ev('pointerup', z.x, z.y))
      },
      { a, z },
    )
    expect(await page.evaluate(() => (window as unknown as { __pbDragSeen?: boolean }).__pbDragSeen)).toBe(false)
    await expect(page.getByTestId('pb-patch-ask')).toHaveCount(0)
    expect((await agentOf(page, 'agInbox')).trigger.type).toBe('row_created')
  })
})

/* ------------------------------------------------------------------ keyboard */

test.describe('B16 · the keyboard', () => {
  test('J on a jack → "Connect to …" → ↵ plugs it; Delete on An Team-Chat’s way out → F1 gone; the toast’s Undo puts the webhook back with its headers', async ({ page }) => {
    await openRack(page, { patching: true })
    await page.locator('.pb-title').focus()
    await page.keyboard.press('j')
    await page.keyboard.type('Every weekday')
    await page.keyboard.press('Enter')
    await expect(jack(page, `${CLOCK}.start`)).toBeFocused()
    await page.keyboard.press('j')
    const picker = page.getByTestId('pb-connect')
    await expect(picker).toBeVisible()
    await expect(picker.getByRole('combobox')).toBeFocused()
    await page.keyboard.type('Inbox-Helfer')
    await expect(picker.locator('[cmdk-item][data-selected="true"]')).toContainText('Inbox-Helfer')
    await page.keyboard.press('Enter')
    await expect(picker).toHaveCount(0)
    await expect.poll(async () => (await agentOf(page, 'agInbox')).trigger.type).toBe('schedule')
    await expect(jack(page, `${CLOCK}.start`)).toBeFocused()
    await page.keyboard.press(`${MOD}+z`)
    await expect.poll(async () => (await agentOf(page, 'agInbox')).trigger.type).toBe('row_created')

    // Delete on the way out: one cable — unplugged at once, written as you~patchbay
    const before = (await automationsOf(page, 'dbMails')).find((a) => a.id === 'autToChat')!
    expect(before.actions).toEqual([{ type: 'webhook', url: 'https://chat.example/hook', method: 'POST', headers: { 'X-Room': 'team' } }])
    await startRecorder(page)
    let m = await markRec(page)
    await jack(page, `${TO_CHAT}.out`).focus()
    await page.keyboard.press('Delete')
    await expect.poll(async () => (await automationsOf(page, 'dbMails')).find((a) => a.id === 'autToChat')!.actions).toEqual([])
    await expect(fuseVal(page)).toHaveText('none open')
    const done = toast(page, 'Unplugged: An Team-Chat → Webhook · chat.example')
    await expect(done).toBeVisible()
    // the keyboard: the jack went with its cable — its module has it
    await expect(page.locator(`.pb-mod[data-key="${TO_CHAT}"]`)).toBeFocused()
    await expectLane(page, m, 'you', undefined, 'you~patchbay')
    m = await markRec(page)
    await done.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await automationsOf(page, 'dbMails')).find((a) => a.id === 'autToChat')!.actions).toEqual(before.actions)
    await expect(fuseVal(page)).toHaveText('1')
    await expectLane(page, m, 'undo', undefined, 'you~undo')
  })
})

/* ------------------------------------------------------------------ the phone */

test.describe('B16 · the phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test('the strands view has no Patching switch and nothing to patch', async ({ page }) => {
    await openRack(page, { patching: true, rack: false })
    await expect(page.getByTestId('patchbay-page')).toHaveAttribute('data-view', 'strands')
    await expect(page.getByTestId('pb-patching')).toHaveCount(0)
    await expect(page.locator('.pb-jk')).toHaveCount(0)
  })
})
