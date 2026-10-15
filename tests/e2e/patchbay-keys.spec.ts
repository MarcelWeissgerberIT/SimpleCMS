/**
 * The Patchbay's fuse keys — B10, P1 (plan §1.9, §3.5, §3.9; §6 U8 / U9 / U21 / U22 / A19 / A20 / A21):
 *  - key 1: Inbox-Helfer → proposals; the closed plate in ink with the keyboard on its heading, the detail "applying it
 *    still fires “An Team-Chat”", the near-miss row "A person checks first"; Mod+Z → back, F1 back; the toast's Undo
 *    from another route; an automation's bookkeeping write after the key does not block the Undo;
 *  - key 2: “Weiterleiten” by hand only → F1 gone; the property menu shows its switch without a profile and switching it
 *    off works; a locked database → refused with the reason;
 *  - key 2b: an MCP fuse → the agent's tools narrowed to its reads; none left → "Server removed from the agent"; the
 *    read tools that stay and may carry data are named; the editor shows the kept list with "Change in the Patchbay";
 *  - autofill / organise / bridge: autofill off (refused on a locked database); "no longer for autofill" says "this
 *    device only" and lists as "closed on this device"; the bridge asks first; mail is sorted by hand;
 *  - key 3: "Allowed by you" in ink with the check stamp; the webhook's path changed → "No longer allowed: An Team-Chat
 *    changed"; withdraw;
 *  - scope: 1 / 2 / 3 only with the keyboard in the fuse list or plate; the digits hidden otherwise; typing in the filter
 *    presses nothing; an Undo after an outside edit → "Changed since — open the editor";
 *  - writers: `you~patchbay`, the Undo `you~undo` (the flight recorder's lanes); no write without a writer;
 *  - gating: keys 2 / 2b need no profile's unlock — the Patchbay is the only ungated way in (§6 A19);
 *  - the hint line where the setting lives ("On fuse F1 — show in the Patchbay") opens `?f=` and goes after key 1.
 * Every name is fictional (tests/fixtures/patchbay.ts); every host `*.example` (and routed — nothing leaves).
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, wsEval, MOD } from './fixtures'
import { agent, mock1, seedPatchbay, server, type PbWorld } from '../fixtures/patchbay'
import { ALPHA, autofillWorld, inboxHelper, mailWorld, organiseWorld } from '../fixtures/patchbay-fuses'
import { expectLane, markRec, startRecorder } from './helpers/recorder'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function openRack(page: Page, w: PbWorld = mock1(), hash = '#/patchbay') {
  await openApp(page)
  await page.route(/\.example\//, (r) => r.fulfill({ status: 200, body: 'ok' }))
  await seedPatchbay(page, w)
  await page.evaluate((h) => (window.location.hash = h), hash)
  await expect(page.getByTestId('patchbay-page')).toBeVisible()
}

const panel = (page: Page) => page.getByTestId('pb-fpanel')
const keyBtn = (page: Page, n: 1 | 2 | 3) => page.locator(`#pb-fuse-panel [data-pb-key="${n}"]`)
const keyRow = (page: Page, n: 1 | 2 | 3) => page.locator(`#pb-fuse-panel .pb-fkey[data-n="${n}"]`)
const head = (page: Page) => panel(page).getByRole('heading', { level: 2 })
const fuseVal = (page: Page) => page.getByTestId('pb-ro-fuse-val')
const live = (page: Page) => page.getByTestId('pb-live')
const toast = (page: Page, text: string | RegExp) => page.locator('.toast').filter({ hasText: text }).last()
const agentOf = (page: Page, id: string) => wsEval(page, (s, a) => s.agents[a] as AnyState, id)
const propOf = (page: Page, db: string, prop: string) => wsEval(page, (s, a) => (s.databases[a.db].properties as AnyState[]).find((p) => p.id === a.prop) ?? null, { db, prop })
const pbModel = (page: Page) => page.evaluate(() => (window as unknown as { __onePatchbay: { model: () => { fuses: AnyState[] } | null } }).__onePatchbay.model())
const css = (page: Page, token: string) =>
  page.evaluate((t) => {
    const el = document.createElement('i')
    el.style.color = `var(${t})`
    document.body.append(el)
    const c = getComputedStyle(el).color
    el.remove()
    return c
  }, token)

/** An automation's bookkeeping (the engine's `last*` write after a run) — never a config change. */
const bookkeeping = (page: Page, db: string) =>
  wsEval(page, (s, d) => s.updateDatabase(d, { automations: (s.databases[d].automations as AnyState[]).map((a) => ({ ...a, lastRunAt: Date.now(), lastStatus: 'ok', lastMessage: 'sent' })) }), db)

/** Select the fuse whose key `n` targets `match` (the model seam), via its tab. */
async function selectFuseWith(page: Page, n: number, match: (target: AnyState) => boolean): Promise<string> {
  let key = ''
  await expect
    .poll(async () => {
      const m = await pbModel(page)
      key = (m?.fuses ?? []).find((f) => (f.keys as AnyState[]).some((k) => k.n === n && match(k.target)))?.key ?? ''
      return key
    })
    .not.toBe('')
  await page.locator(`[data-pb-fuse-tab="${key}"]`).click()
  await expect(panel(page).locator(`[data-pb-plate="${key}"]`)).toBeVisible()
  return key
}

test.describe('B10 · key 1 — the decider off "direct", the closed plate, Undo', () => {
  test('Inbox-Helfer → proposals: the closed plate in ink, what still fires, "A person checks first"; Mod+Z and the toast’s Undo from another route; bookkeeping never blocks it', async ({ page }) => {
    await openRack(page)
    await expect(head(page)).toHaveText('Fuse F1 · open path')
    const keys = panel(page).getByTestId('pb-fkeys')
    await expect(keys).toContainText('Resolve — changes the real setting')
    await expect(keyBtn(page, 1)).toContainText('Switch to proposals')
    await expect(keyBtn(page, 1)).toHaveClass(/btn--primary/)
    await expect(keyRow(page, 1)).toContainText('Inbox-Helfer: Apply directly → Proposals for review')
    await expect(keyRow(page, 1)).toContainText('Each proposal waits for you — applying it still fires “An Team-Chat”')
    await expect(keyBtn(page, 2)).toContainText('“Weiterleiten” by hand only')
    await expect(keyRow(page, 2)).toContainText('Mails: agents never write the field')
    await expect(keyBtn(page, 3)).toContainText('Allow this path')
    await expect(keyRow(page, 3)).toContainText('name + date · ends when anything on the path changes')
    await expect(keys.getByTestId('pb-fkey-copy')).toHaveText('Copy link')
    await expect(panel(page).getByTestId('pb-undo-all')).toContainText('in the Patchbay undoes every key')

    await keyBtn(page, 1).click()
    expect((await agentOf(page, 'agInbox')).write).toBe('stage')
    const closed = panel(page).getByTestId('pb-closed-head')
    await expect(closed).toHaveText('Fuse F1 · closed — Inbox-Helfer: Apply directly → Proposals for review')
    await expect(closed).toBeFocused()
    const plate = panel(page).getByTestId('pb-fplate')
    await expect(plate).toHaveAttribute('data-state', 'closed')
    // ink, never orange
    expect(await plate.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(await css(page, '--ink-3'))
    await expect(panel(page).getByTestId('pb-closed-note')).toHaveText('Each proposal waits for you — applying it still fires “An Team-Chat”')
    // the list: the closed plate after the fuses, then the path almost open — a person checks first; nothing counted
    await expect(page.locator('.pb-ftab[data-kind="closed"]')).toContainText(/F1\s*closed/)
    await expect(page.locator('.pb-ftab[data-kind="near"]').filter({ hasText: 'An Team-Chat' })).toContainText('A person checks first')
    await expect(fuseVal(page)).toHaveText('none open')
    await expect(toast(page, 'Fuse F1 closed — Inbox-Helfer: Apply directly → Proposals for review')).toBeVisible()
    await expect(live(page)).toContainText('Fuse F1 closed')

    // an automation's bookkeeping meanwhile changes no config: Mod+Z takes the key back, F1 is open again
    await bookkeeping(page, 'dbMails')
    await closed.focus()
    await page.keyboard.press(`${MOD}+z`)
    await expect.poll(async () => (await agentOf(page, 'agInbox')).write).toBe('apply')
    await expect(fuseVal(page)).toHaveText('1')
    await expect(head(page)).toHaveText('Fuse F1 · open path')
    await expect(head(page)).toBeFocused()
    await expect(page.locator('.pb-ftab[data-kind="closed"]')).toHaveCount(0)
    await expect(toast(page, 'Taken back — fuse F1 is open again')).toBeVisible()

    // the toast's Undo works from another route
    await keyBtn(page, 1).click()
    expect((await agentOf(page, 'agInbox')).write).toBe('stage')
    await page.evaluate(() => (window.location.hash = '#/'))
    await expect(page.getByTestId('patchbay-page')).toHaveCount(0)
    await toast(page, 'Fuse F1 closed').getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await agentOf(page, 'agInbox')).write).toBe('apply')
    await expect(page.getByTestId('patchbay-nav-led')).toContainText('1')
  })

  test('an Undo after an outside edit says "Changed since — open the editor" and changes nothing', async ({ page }) => {
    await openRack(page)
    await keyBtn(page, 1).click()
    await expect(panel(page).getByTestId('pb-closed-head')).toBeFocused()
    // someone edits the agent meanwhile (another tab, the editor): its config is no longer what the key wrote
    await wsEval(page, (s) => s.upsertAgent({ ...s.agents.agInbox, instructions: 'Lies jede neue Mail genau.' }))
    await page.keyboard.press(`${MOD}+z`)
    await expect(panel(page).getByTestId('pb-closed-head')).toBeVisible()
    await expect(live(page)).toContainText('Not taken back: Changed since — open the editor')
    expect((await agentOf(page, 'agInbox')).write).toBe('stage')
    // the closed plate's own Undo says it there, with the way to the editor
    await panel(page).getByTestId('pb-closed-undo').click()
    await expect(panel(page).getByTestId('pb-closed-refused')).toContainText('Not taken back: Changed since — open the editor')
    await panel(page).getByTestId('pb-closed-refused').getByRole('button', { name: 'Open the editor' }).click()
    await expect(page).toHaveURL(/#\/agents\/agInbox$/)
  })
})

test.describe('B10 · key 2 — the field by hand only', () => {
  test('“Weiterleiten” by hand only → F1 gone; bookkeeping never blocks the Undo; the property menu shows the switch without a profile and switching it off works', async ({ page }) => {
    await openRack(page)
    // with the keyboard on the fuse's tab, 2 presses key 2
    await page.locator('[data-pb-fuse-tab]').first().focus()
    await page.keyboard.press('2')
    await expect.poll(async () => (await propOf(page, 'dbMails', 'pMailFwd'))?.agentReadOnly).toBe(true)
    await expect(panel(page).getByTestId('pb-closed-head')).toHaveText('Fuse F1 · closed — Mails: agents never write the field')
    await expect(panel(page).getByTestId('pb-closed-head')).toBeFocused()
    await expect(fuseVal(page)).toHaveText('none open')
    await bookkeeping(page, 'dbMails')
    await panel(page).getByTestId('pb-closed-undo').click()
    await expect.poll(async () => (await propOf(page, 'dbMails', 'pMailFwd'))?.agentReadOnly ?? false).toBe(false)
    await expect(fuseVal(page)).toHaveText('1')

    // set again; the property menu (no profile unlocks "Only by hand") shows the switch while the flag is set
    await keyBtn(page, 2).click()
    await expect.poll(async () => (await propOf(page, 'dbMails', 'pMailFwd'))?.agentReadOnly).toBe(true)
    // (the fixture's database carries a bare view: give it a full one before the table draws)
    await wsEval(page, (s) => {
      s.addView('dbMails', { type: 'table', name: 'Tabelle' })
      s.deleteView('dbMails', 'dbMailsView')
    })
    await page.evaluate(() => (window.location.hash = '#/p/dbMails'))
    const header = (name: string) => page.locator('#main section.db').getByRole('columnheader', { name: new RegExp(`^${name}`) })
    const menu = page.locator('.db-propmenu')
    await header('Weiterleiten').click()
    const sw = menu.getByRole('switch', { name: 'Only by hand' })
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    await expect(menu.getByTestId('db-flag-hand-mark')).toHaveCount(0)
    await sw.click()
    await expect.poll(async () => (await propOf(page, 'dbMails', 'pMailFwd'))?.agentReadOnly ?? false).toBe(false)
    // switching it ON stays gated: the switch stays, off and disabled, with the reason
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    await expect(sw).toBeDisabled()
    await expect(menu).toContainText('Off now. Switching it on needs an active integration.')
    await page.keyboard.press('Escape')
    // the only ungated way in is the Patchbay: another field shows no switch at all
    await header('Von').click()
    await expect(menu.getByRole('switch', { name: 'Only by hand' })).toHaveCount(0)
    await page.keyboard.press('Escape')
  })

  test('a locked database: key 2 refused with the reason — said, never written', async ({ page }) => {
    const w = mock1()
    w.ws.databases.dbMails = { ...w.ws.databases.dbMails, locked: true }
    await openRack(page, w)
    await expect(keyBtn(page, 2)).toHaveAttribute('aria-disabled', 'true')
    await expect(keyRow(page, 2).getByTestId('pb-fkey-why')).toHaveText('The database is locked.')
    // a refused key is aria-disabled, never disabled: it still takes the keyboard and says why
    await keyBtn(page, 2).focus()
    await page.keyboard.press('Enter')
    await expect(live(page)).toContainText('“Weiterleiten” by hand only — not possible here: The database is locked.')
    await page.keyboard.press('2')
    await page.waitForTimeout(200)
    expect((await propOf(page, 'dbMails', 'pMailFwd'))?.agentReadOnly ?? false).toBe(false)
    await expect(fuseVal(page)).toHaveText('1')
  })
})

test.describe('B10 · key 2b — an MCP fuse: the write tools disconnected', () => {
  /** Two stage agents on new mails: Inbox-Helfer with alpha (reads + writes), Mail-Sortierer with gamma (writes only). */
  function mcpWorld(): PbWorld {
    const sorter = agent('agSorter', 'Mail-Sortierer', { write: 'stage', scope: { everything: true, pages: [], databases: [] }, trigger: { type: 'row_created', databaseId: 'dbMails' }, mcpServers: ['gamma'] })
    return mailWorld([inboxHelper({ write: 'stage', mcpServers: ['alpha'] }), sorter], { servers: [ALPHA(), server('srvGamma', 'gamma', { tools: ['create_row', 'update_row'], checkedAt: 1 })] })
  }

  test('reads kept, the leaky one named; none left → "Server removed from the agent"; the editor keeps the list read-only with "Change in the Patchbay" — no profile needed', async ({ page }) => {
    await openRack(page, mcpWorld())
    await selectFuseWith(page, 2, (t) => t.agent === 'agInbox' && t.server === 'alpha')
    // proposals do not stop MCP tools: key 1 refused with why
    await expect(keyBtn(page, 1)).toHaveAttribute('aria-disabled', 'true')
    await expect(keyRow(page, 1)).toContainText('Proposals do not stop MCP tools — they run inside the AI’s tool loop.')
    await expect(keyBtn(page, 2)).toContainText('Disconnect write tools')
    await expect(keyRow(page, 2)).toContainText('Inbox-Helfer · alpha: only the 2 read tools stay')
    await expect(panel(page).getByTestId('pb-residual')).toContainText('Still connected: search_web — may carry data in their arguments')
    await keyBtn(page, 2).click()
    await expect.poll(async () => (await agentOf(page, 'agInbox')).mcpTools).toEqual({ alpha: ['list_items', 'search_web'] })
    await expect(panel(page).getByTestId('pb-closed-head')).toHaveText(/^Fuse F\d · closed — Inbox-Helfer · alpha: only the 2 read tools stay$/)

    // the server with write tools only: it goes from the agent
    await selectFuseWith(page, 2, (t) => t.agent === 'agSorter' && t.server === 'gamma')
    await expect(keyRow(page, 2)).toContainText('Server removed from the agent')
    await keyBtn(page, 2).click()
    await expect.poll(async () => (await agentOf(page, 'agSorter')).mcpTools).toEqual({ gamma: [] })
    await expect(fuseVal(page)).toHaveText('none open')

    // the editor (no profile unlocks the tool list there): the kept list, read-only, and the way to the Patchbay
    await page.evaluate(() => (window.location.hash = '#/agents/agInbox'))
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    const editor = page.locator('.agx-editor')
    await expect(editor.getByRole('group', { name: 'Tools of ALPHA' })).toHaveCount(0)
    const kept = editor.getByTestId('agx-tools-kept')
    await expect(kept).toContainText('ALPHA')
    await expect(kept).toContainText('2 allowed tools')
    await kept.getByTestId('pb-hint-kept').click()
    await expect(page.locator('.agx-editor')).toHaveCount(0)
    await expect.poll(() => decodeURIComponent(page.url())).toContain('#/patchbay?m=agent:agInbox')
    await expect(page.locator('.pb-mod[data-key="agent:agInbox"]')).toBeFocused()
  })

  test('the hint lines where the settings live: the write-mode row and the server, "On fuse F1 — show in the Patchbay" → ?f=; gone after the key', async ({ page }) => {
    await openApp(page)
    await seedPatchbay(page, mock1())
    // the background count (the Patchbay never opened) feeds the hints
    await expect(page.getByTestId('patchbay-nav-led')).toContainText('1')
    await page.evaluate(() => (window.location.hash = '#/agents/agInbox'))
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    const editor = page.locator('.agx-editor')
    const hint = editor.locator('.pb-hint')
    await expect(hint).toHaveCount(1)
    await expect(hint).toHaveText('On fuse F1 — show in the Patchbay')
    const f = await hint.getAttribute('data-pb-hint')
    await hint.getByRole('link').click()
    await expect(page.locator('.agx-editor')).toHaveCount(0)
    await expect.poll(() => page.url()).toContain(`#/patchbay?f=${f}`)
    await expect(head(page)).toHaveText('Fuse F1 · open path')
    await keyBtn(page, 1).click()
    await expect(fuseVal(page)).toHaveText('none open')
    await page.evaluate(() => (window.location.hash = '#/agents/agInbox'))
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(page.locator('.agx-editor')).toBeVisible()
    await expect(page.locator('.agx-editor .pb-hint')).toHaveCount(0)
  })
})

test.describe('B10 · autofill, mail, the bridge — this device', () => {
  test('autofill: "no longer for autofill" says "this device only" and lists as closed on this device; Undo; "Autofill by hand only" keeps the fills', async ({ page }) => {
    await openRack(page, autofillWorld())
    await expect(keyBtn(page, 1)).toContainText('Autofill by hand only')
    await expect(keyBtn(page, 2)).toContainText('beta: no longer for autofill')
    await expect(keyRow(page, 2)).toContainText('beta: Every AI call → Agent, own requests, ⌘K')
    await expect(keyRow(page, 2)).toContainText('this device only — other devices keep the path')
    await keyBtn(page, 2).click()
    await expect.poll(() => wsEval(page, (s) => (s.settings.mcpServers as AnyState[]).find((x) => x.id === 'srvBeta')?.scope)).toBe('free')
    await expect(page.locator('.pb-ftab[data-kind="closed"]')).toContainText('closed on this device')
    await expect(toast(page, 'Fuse F1 closed')).toContainText('this device only — other devices keep the path')
    await page.keyboard.press(`${MOD}+z`)
    await expect.poll(() => wsEval(page, (s) => (s.settings.mcpServers as AnyState[]).find((x) => x.id === 'srvBeta')?.scope)).toBe('all')
    await expect(fuseVal(page)).toHaveText('1')
    // key 1: the property re-fills by hand only — its fill records stay
    await keyBtn(page, 1).click()
    await expect.poll(async () => (await propOf(page, 'dbMails', 'pMailSum'))?.autofill?.auto ?? false).toBe(false)
    expect((await propOf(page, 'dbMails', 'pMailSum'))?.autofill?.fills).toEqual({ r1: { at: 1, hash: 'x' } })
    await page.keyboard.press(`${MOD}+z`)
    await expect.poll(async () => (await propOf(page, 'dbMails', 'pMailSum'))?.autofill?.auto).toBe(true)
  })

  test('autofill on a locked database: key 1 refused with the reason (§6 A20)', async ({ page }) => {
    await openRack(page, autofillWorld({ locked: true }))
    await expect(keyBtn(page, 1)).toHaveAttribute('aria-disabled', 'true')
    await expect(keyRow(page, 1).getByTestId('pb-fkey-why')).toHaveText('The database is locked.')
    await keyBtn(page, 1).focus()
    await page.keyboard.press('1')
    await expect(live(page)).toContainText('Autofill by hand only — not possible here: The database is locked.')
    expect((await propOf(page, 'dbMails', 'pMailSum'))?.autofill?.auto).toBe(true)
  })

  test('mail: "Sort mail by hand only" switches organising off on this device; Undo switches it on', async ({ page }) => {
    await openRack(page, organiseWorld())
    await expect(keyBtn(page, 1)).toContainText('Sort mail by hand only')
    await expect(keyRow(page, 1)).toContainText('this device only — other devices keep the path')
    await keyBtn(page, 1).click()
    await expect.poll(() => wsEval(page, (s) => s.settings.mail.organise.enabled)).toBe(false)
    await expect(page.locator('.pb-ftab[data-kind="closed"]')).toContainText('closed on this device')
    await page.keyboard.press(`${MOD}+z`)
    await expect.poll(() => wsEval(page, (s) => s.settings.mail.organise.enabled)).toBe(true)
  })

  test('the bridge in "apply": "Bridge: ask before each write" (this browser); Undo puts "apply" back', async ({ page, errors }) => {
    // the bridge looks for its local helper on this machine — none here
    errors.allow(/WebSocket|ERR_CONNECTION_REFUSED|51740/)
    await openRack(page, mailWorld([], { device: { bridge: { enabled: true, mode: 'apply' } } }))
    await reloadApp(page)
    await page.evaluate(() => (window.location.hash = '#/patchbay'))
    await expect(keyBtn(page, 1)).toContainText('Bridge: ask before each write')
    await keyBtn(page, 1).click()
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('one.mcp') ?? '{}').mode)).toBe('ask')
    await expect(fuseVal(page)).toHaveText('none open')
    await page.keyboard.press(`${MOD}+z`)
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('one.mcp') ?? '{}').mode)).toBe('apply')
    await expect(fuseVal(page)).toHaveText('1')
  })
})

test.describe('B10 · key 3 — allow the path', () => {
  test('"Allowed by you" in ink with the check stamp; the webhook’s path changed → lapsed, naming An Team-Chat; allowed again; withdrawn', async ({ page }) => {
    await openRack(page)
    await keyBtn(page, 3).click()
    await expect(fuseVal(page)).toHaveText('0 open · 1 allowed')
    const plate = panel(page).getByTestId('pb-fplate')
    await expect(plate).toHaveAttribute('data-state', 'allowed')
    await expect(head(page)).toHaveText('Fuse F1 · allowed')
    await expect(panel(page).getByTestId('pb-allowed-stamp')).toHaveText('Allowed')
    await expect(panel(page).getByTestId('pb-allowed')).toContainText(/Allowed by you · \d{1,2} \w{3}/)
    expect(await plate.evaluate((el) => getComputedStyle(el).borderTopColor)).not.toBe(await css(page, '--signal'))
    // the keyboard stayed on key 3, which now withdraws
    await expect(keyBtn(page, 3)).toContainText('Withdraw')
    await expect(keyBtn(page, 3)).toBeFocused()
    await expect(toast(page, 'Path F1 allowed')).toBeVisible()

    // the webhook's address changes (another room on the same host): the allowance lapses, naming what changed
    await wsEval(page, (s) => s.updateDatabase('dbMails', { automations: (s.databases.dbMails.automations as AnyState[]).map((a) => (a.id === 'autToChat' ? { ...a, actions: [{ ...a.actions[0], url: 'https://chat.example/hook-board' }] } : a)) }))
    await expect(fuseVal(page)).toHaveText('1')
    await expect(plate).toHaveAttribute('data-state', 'lapsed')
    // the automation and the way out its action names (the webhook's address is part of both)
    await expect(panel(page).getByTestId('pb-lapsed')).toHaveText('No longer allowed: An Team-Chat, Webhook · chat.example changed')
    expect(await plate.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(await css(page, '--signal'))
    await expect(keyBtn(page, 3)).toContainText('Allow this path')
    await keyBtn(page, 3).click()
    await expect(fuseVal(page)).toHaveText('0 open · 1 allowed')
    await keyBtn(page, 3).click()
    await expect(fuseVal(page)).toHaveText('1')
    await expect(toast(page, 'Allowance of F1 withdrawn — the fuse is open again')).toBeVisible()
    // Mod+Z takes the withdrawal back: allowed again
    await page.keyboard.press(`${MOD}+z`)
    await expect(fuseVal(page)).toHaveText('0 open · 1 allowed')
  })
})

test.describe('B10 · scope, writers, gating', () => {
  test('1 / 2 / 3 only with the keyboard in the fuse list or plate; the digits hidden otherwise; typing in the filter presses nothing', async ({ page }) => {
    await openRack(page)
    const kbd = keyBtn(page, 1).locator('.pb-fkey__kbd')
    await page.getByRole('heading', { level: 1 }).focus()
    await expect.poll(() => kbd.evaluate((el) => getComputedStyle(el).visibility)).toBe('hidden')
    // the keyboard on the rack: 1 does nothing
    await page.locator('.pb-mod[data-key="agent:agInbox"]').focus()
    await page.keyboard.press('1')
    await page.waitForTimeout(200)
    expect((await agentOf(page, 'agInbox')).write).toBe('apply')
    // typing in the filter's search: nothing pressed
    await page.getByTestId('pb-filter').click()
    const q = page.locator('.pb-filter__q')
    await q.focus()
    await page.keyboard.type('123')
    await expect(q).toHaveValue('123')
    expect((await agentOf(page, 'agInbox')).write).toBe('apply')
    expect((await propOf(page, 'dbMails', 'pMailFwd'))?.agentReadOnly ?? false).toBe(false)
    await page.keyboard.press('Escape')
    // with the keyboard in the plate the digits show, and 1 presses key 1
    await keyBtn(page, 3).focus()
    await expect.poll(() => kbd.evaluate((el) => getComputedStyle(el).visibility)).toBe('visible')
    await page.keyboard.press('1')
    await expect.poll(async () => (await agentOf(page, 'agInbox')).write).toBe('stage')
  })

  test('writers: a key writes as you~patchbay, its Undo as you~undo — nothing without a writer', async ({ page }) => {
    await openRack(page)
    await startRecorder(page)
    let m = await markRec(page)
    await keyBtn(page, 2).click()
    await expect.poll(async () => (await propOf(page, 'dbMails', 'pMailFwd'))?.agentReadOnly).toBe(true)
    await expectLane(page, m, 'you', undefined, 'you~patchbay')
    m = await markRec(page)
    await panel(page).getByTestId('pb-closed-head').focus()
    await page.keyboard.press(`${MOD}+z`)
    await expect.poll(async () => (await propOf(page, 'dbMails', 'pMailFwd'))?.agentReadOnly ?? false).toBe(false)
    await expectLane(page, m, 'undo', undefined, 'you~undo')
  })

  test('German: the keys, the closed plate and the toast in German ("KI", no banned words)', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await page.route(/\.example\//, (r) => r.fulfill({ status: 200, body: 'ok' }))
    await seedPatchbay(page, mock1())
    await page.evaluate(() => (window.location.hash = '#/patchbay'))
    await expect(keyBtn(page, 1)).toContainText('Auf Vorschläge stellen')
    await expect(keyRow(page, 1)).toContainText('Inbox-Helfer: Direkt anwenden → Vorschläge zur Prüfung')
    await expect(keyRow(page, 1)).toContainText('Jeder Vorschlag wartet auf dich — Anwenden löst „An Team-Chat“ trotzdem aus')
    await expect(keyBtn(page, 2)).toContainText('„Weiterleiten“ nur von Hand')
    await expect(keyBtn(page, 3)).toContainText('Weg zulassen')
    await expect(panel(page).getByTestId('pb-fkeys')).toContainText('Auflösen — ändert die echte Einstellung')
    await expect(panel(page).getByTestId('pb-fkey-copy')).toHaveText('Link kopieren')
    await expect(panel(page).getByTestId('pb-undo-all')).toContainText('im Schaltplan nimmt jede Taste zurück')
    await keyBtn(page, 1).click()
    await expect(panel(page).getByTestId('pb-closed-head')).toHaveText('Sicherung F1 · geschlossen — Inbox-Helfer: Direkt anwenden → Vorschläge zur Prüfung')
    await expect(toast(page, 'Sicherung F1 geschlossen')).toBeVisible()
    const text = (await panel(page).innerText()) + (await page.locator('.pb-flist').innerText())
    for (const banned of ['Vertrauen', 'vertrauen', 'Prüfschritt', 'abnehmen', 'Abnahme', 'fremd', 'Fremd', 'Trigger']) expect(text).not.toContain(banned)
    await page.keyboard.press(`${MOD}+z`)
    await expect(toast(page, 'Zurückgenommen — Sicherung F1 ist wieder offen')).toBeVisible()
  })
})
