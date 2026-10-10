/**
 * The Outbox by hand (slice 1b; features/outbox, docs/OUTBOX.md). A fictional mirror "CNSX Handoff" of the fictional
 * MCP server "tracker" with send routes (reply · log work · set status):
 *  - the routes are database commands (sidebar ⌘ key, toolbar ⌘ — "Pick a row" without a selection —, ⌘K);
 *  - Claude drafts in a request with NO mcp_servers and NO tools; it reads the instruction, the row (free text in
 *    <untrusted>) and the pages the person @-mentions; the slip shows the exact inputs and the draft's cost;
 *  - the seal: an address only in foreign text is flagged with its source and needs a tick (the person's own typing
 *    is not flagged), hidden characters are drawn ⟦U+202E⟧ with their lamp, a long text must be seen first;
 *  - by hand: Copy & open (clipboard, the row's link in a popup that never loads), "Mark as sent" → the row patch
 *    (one version "Outbox · <route>"), the inbox note archived, the receipt; "Reset row" (and what it keeps);
 *  - CHANGED per mirror (lamp, band, quote), H holds, R drafts again; keys; persistence and tabs; the counts agree
 *    everywhere; blocked storage fails closed; the API's refusals.
 * Claude is mocked; tracker.example.com is never called.
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, wsEval, createPage, doc, para, MOD, flush } from './fixtures'
import { blockTracker, mirrorWrite, mockDrafts, outbox, outboxLoaded, routeRef, rowValue, seedMirrorDb, versionsOf, type AnyState, type Mirror } from './helpers/outbox'

const dock = (page: Page) => page.getByTestId('outbox-dock')
const slip = (page: Page) => dock(page).getByTestId('outbox-slip')
const copyKey = (page: Page) => slip(page).getByTestId('outbox-copy')
const tree = (page: Page) => page.locator('.sb section[aria-label="Pages"]')
const dbRow = (page: Page) => tree(page).locator('.sb-row', { has: page.locator('.sb-row__title', { hasText: /^CNSX Handoff$/ }) })
const menu = (page: Page) => page.locator('.popover.cmd-menu')
const draftDialog = (page: Page) => page.getByRole('dialog', { name: 'Draft a slip' })

async function setup(page: Page, opts: Parameters<typeof seedMirrorDb>[1] = {}): Promise<Mirror> {
  await openApp(page)
  await outboxLoaded(page)
  const m = await seedMirrorDb(page, opts)
  return m
}

async function openDb(page: Page, m: Mirror) {
  await page.evaluate((id) => (location.hash = `#/p/${id}`), m.dbId)
  await expect(page.locator('#main .pv-title')).toBeVisible()
}

/** Exactly these table rows selected (in seeded order). */
async function selectRows(page: Page, indexes: number[]) {
  const rows = page.locator('#main .dbt-row[role="row"]:not(.dbt-row--head)')
  const n = await rows.count()
  for (let i = 0; i < n; i++) {
    const on = (await rows.nth(i).getAttribute('aria-selected')) === 'true'
    if (on === indexes.includes(i)) continue
    await rows.nth(i).hover()
    await rows.nth(i).getByRole('checkbox', { name: 'Select row' }).click()
  }
  await expect(page.locator('#main .dbt-row[aria-selected="true"]')).toHaveCount(indexes.length)
}

/** The toolbar's ⌘ key → a route. */
async function routeFromToolbar(page: Page, label: string) {
  await page.getByTestId('db-commands').click()
  await menu(page).getByRole('menuitem', { name: label }).click()
  await expect(draftDialog(page)).toBeVisible()
}

/** Draft a reply for the n-th row from the toolbar, with an instruction; waits for the slip. */
async function draftReply(page: Page, m: Mirror, index: number, instruction = '') {
  await openDb(page, m)
  await selectRows(page, [index])
  await routeFromToolbar(page, 'Reply in the ticket tool')
  const field = draftDialog(page).getByRole('textbox', { name: 'What should it say? (optional)' })
  if (instruction) await field.fill(instruction)
  await draftDialog(page).getByTestId('outbox-draft-claude').click()
  await expect(slip(page)).toBeVisible()
}

test.describe('Outbox: routes, drafts and the seal', () => {
  test('a route is a database command: the sidebar ⌘ key, the toolbar (Pick a row without a selection), ⌘K', async ({ page }) => {
    const m = await setup(page)
    const r = dbRow(page)
    await r.hover()
    await r.getByTestId('tree-commands').click()
    await expect(menu(page).getByRole('menuitem', { name: 'Reply in the ticket tool' })).toBeVisible()
    await expect(menu(page).getByRole('menuitem', { name: 'Log work' })).toBeVisible()
    await page.keyboard.press('Escape')

    await openDb(page, m)
    await page.getByTestId('db-commands').click()
    const item = menu(page).getByRole('menuitem', { name: 'Reply in the ticket tool' })
    await expect(item).toHaveAttribute('aria-disabled', 'true')
    await expect(item.locator('.menu-item__hint')).toHaveText(/^pick a row$/i)
    await page.keyboard.press('Escape')
    await selectRows(page, [0])
    await routeFromToolbar(page, 'Reply in the ticket tool')
    await expect(draftDialog(page)).toContainText('#10668')
    await page.keyboard.press('Escape')
    await expect(draftDialog(page)).toHaveCount(0)

    await page.keyboard.press(`${MOD}+k`)
    const pal = page.getByRole('dialog', { name: 'Command palette' })
    await pal.locator('input').first().fill('reply in the ticket')
    await expect(pal.getByRole('option', { name: /CNSX Handoff: Reply in the ticket tool/ })).toBeVisible()
    await pal.locator('input').first().fill('open outbox')
    await expect(pal.getByRole('option', { name: /Open Outbox/ })).toBeVisible()
  })

  test('Claude drafts without tools: instruction, the row as <untrusted>, the @-mentioned page; exact inputs; the cost in the UI language', async ({ page, context }) => {
    const calls = await mockDrafts(context, () => 'Hi Jana, take B6 — B7 freezes after the review on 14.10. The differences are in Baselines overview. Regards, Marcel')
    const m = await setup(page)
    await createPage(page, { title: 'Baselines overview', content: doc(para('B6 is the release baseline; B7 freezes after the review.')) })
    await openDb(page, m)
    await selectRows(page, [0])
    await routeFromToolbar(page, 'Reply in the ticket tool')
    const field = draftDialog(page).getByRole('textbox', { name: 'What should it say? (optional)' })
    await field.pressSequentially('B6 is the one, see @Baselines')
    const list = draftDialog(page).getByRole('listbox', { name: 'Your pages' })
    await expect(list.getByRole('option', { name: 'Baselines overview' })).toBeVisible()
    await field.press('Enter')
    await expect(field).toHaveValue('B6 is the one, see @Baselines overview ')
    await expect(draftDialog(page).getByText('Pages Claude reads')).toBeVisible()
    // ⌘↵ in the field does nothing; ↵ drafts
    await field.press(`${MOD}+Enter`)
    await expect(draftDialog(page)).toBeVisible()
    expect(calls).toHaveLength(0)
    await field.press('Enter')
    await expect(slip(page)).toBeVisible()
    expect(calls).toHaveLength(1)
    const body = calls[0].body
    expect(body.mcp_servers).toBeUndefined()
    expect(body.tools).toBeUndefined()
    const prompt = JSON.stringify(body.messages)
    expect(prompt).toContain('B6 is the one, see @Baselines overview')
    expect(prompt).toContain('<untrusted source=\\"Comment J. Weber\\">')
    expect(prompt).toContain('For the comparison: B6 or B7?')
    expect(prompt).toContain('<page title=\\"Baselines overview\\"')
    expect(prompt).toContain('B6 is the release baseline')
    expect(JSON.stringify(body.system)).toContain('You have no tools')
    // the slip: exactly what goes out
    const inputs = slip(page).getByTestId('outbox-inputs')
    await expect(inputs.locator('dd[data-arg="ref"]')).toHaveText('10668')
    await expect(inputs.locator('dd[data-arg="visibility"]')).toHaveText('team')
    await expect(inputs.locator('dd[data-arg="body"]')).toHaveText(/↑ Text · \d+ chars/)
    await expect(slip(page).getByTestId('outbox-text')).toHaveText('Hi Jana, take B6 — B7 freezes after the review on 14.10. The differences are in Baselines overview. Regards, Marcel')
    // 2000 in + 400 out on the default model: $0.016
    await expect(slip(page).getByTestId('outbox-cost')).toHaveText(/^draft \$0\.02 · no tools$/i)
    const stored = await outbox(page, (o) => o.getSlips()[0])
    expect(stored.args).toEqual({ ref: '10668', visibility: 'team', body: 'Hi Jana, take B6 — B7 freezes after the review on 14.10. The differences are in Baselines overview. Regards, Marcel' })
    expect(stored.sources.find((s: AnyState) => s.kind === 'page')).toMatchObject({ label: 'Baselines overview', trusted: true })
    expect(stored.sources.find((s: AnyState) => s.kind === 'text')).toMatchObject({ trusted: true })
    // German: the same cost reads "0,02 $"
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await expect(slip(page).getByTestId('outbox-cost')).toHaveText(/^entwurf 0,02\s\$ · ohne werkzeuge$/i)
  })

  test('an address only in foreign text is flagged with its source and needs a tick; the person typing it is not flagged', async ({ page, context }) => {
    const calls = await mockDrafts(context, (_b, n) => (n === 1 ? 'Looks good. Please approve here: teilen.example/rp' : 'Looks good, approved from my side.'))
    const m = await setup(page)
    await draftReply(page, m, 3)
    const flag = slip(page).locator('.obx-addr[data-only="foreign"]')
    await expect(flag).toHaveText('teilen.example/rp')
    await expect(flag).toHaveAttribute('title', 'Address only from foreign text (Comment T. Brandt)')
    await expect(slip(page).getByTestId('outbox-lamp-foreign')).toHaveAttribute('data-lit', 'true')
    await expect(copyKey(page)).toHaveAttribute('aria-disabled', 'true')
    await expect(slip(page).getByTestId('outbox-why')).toHaveText('Tick the flagged addresses first')
    await flag.getByRole('checkbox').check()
    await expect(copyKey(page)).not.toHaveAttribute('aria-disabled', 'true')
    expect(calls).toHaveLength(1)

    // a second draft without the address; the person adds it in an edit → their own words, not flagged
    await outbox(page, (o) => o.withdrawSlip(o.getSlips()[0].id, 'person'))
    await draftReply(page, m, 3)
    await expect(slip(page).getByTestId('outbox-text')).toHaveText('Looks good, approved from my side.')
    await slip(page).getByRole('button', { name: /^Edit/ }).click()
    const ta = slip(page).getByRole('textbox', { name: 'The text' })
    await ta.fill('Looks good, approved from my side. Shared copy: teilen.example/rp')
    await slip(page).getByTestId('outbox-save-text').click()
    await expect(slip(page).getByTestId('outbox-text')).toContainText('teilen.example/rp')
    await expect(slip(page).locator('.obx-addr')).toHaveCount(0)
    await expect(copyKey(page)).not.toHaveAttribute('aria-disabled', 'true')
    // the word diff: Claude's draft → the person's text
    await expect(slip(page).locator('.obx-diff__add')).toContainText('teilen.example/rp')
  })

  test('hidden characters are drawn as ⟦U+202E⟧ and light their lamp; a long text must be seen first, an edit resets it', async ({ page, context }) => {
    const long = `${'The rollout waits for the review board. '.repeat(24)}End.`
    await mockDrafts(context, (_b, n) => (n === 1 ? 'Approved ‮txt.exe for today' : long))
    const m = await setup(page)
    await draftReply(page, m, 0)
    await expect(slip(page).getByTestId('outbox-text').locator('.obx-hidden')).toHaveText('⟦U+202E⟧')
    await expect(slip(page).getByTestId('outbox-lamp-hidden')).toHaveAttribute('data-lit', 'true')

    await outbox(page, (o) => o.withdrawSlip(o.getSlips()[0].id, 'person'))
    await draftReply(page, m, 0)
    expect(long.length).toBeGreaterThan(900)
    await expect(copyKey(page)).toHaveAttribute('aria-disabled', 'true')
    await expect(slip(page).getByTestId('outbox-why')).toHaveText('Read the whole text first')
    await slip(page).getByTestId('outbox-show-full').click()
    await expect(copyKey(page)).not.toHaveAttribute('aria-disabled', 'true')
    // an edit: a new revision, unseen again
    await slip(page).getByRole('button', { name: /^Edit/ }).click()
    const ta = slip(page).getByRole('textbox', { name: 'The text' })
    await ta.fill(`${long} Thanks.`)
    await slip(page).getByTestId('outbox-save-text').click()
    await expect(copyKey(page)).toHaveAttribute('aria-disabled', 'true')
    await expect(slip(page).getByTestId('outbox-show-full')).toBeVisible()
  })
})

test.describe('Outbox: by hand, CHANGED, keys', () => {
  test('Copy & open, then "Mark as sent": the row patch (one version), the inbox note archived, the receipt; Reset row — and what it keeps', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const asked = await blockTracker(context)
    const text = 'Hi Jana, take B6. Regards, Marcel'
    await mockDrafts(context, () => text)
    const m = await setup(page)
    await outbox(page, (o, a) => o.addAgentNote(a.row, 'mirror1', 'Weber asks which baseline counts.'), { row: m.rows['10668'] })
    await expect.poll(() => outbox(page, (o) => o.inbox().filter((i: AnyState) => i.kind === 'agent').length)).toBe(1)
    await draftReply(page, m, 0)
    await expect(slip(page).getByTestId('outbox-after')).toContainText('Archive inbox note')
    // a short text counts as seen once it is on screen in full
    await expect(copyKey(page)).not.toHaveAttribute('aria-disabled', 'true')
    const popup = context.waitForEvent('page')
    await copyKey(page).click()
    const opened = await popup
    await expect.poll(() => asked).toContain('https://tracker.example.com/item/10668')
    await opened.close()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text)
    const ask = slip(page).getByTestId('outbox-ask')
    await expect(ask).toContainText('Sent in tracker?')
    await expect(ask.getByTestId('outbox-mark-sent')).toBeFocused()
    await page.keyboard.press('Enter')

    const receipt = dock(page).getByTestId('outbox-receipt')
    await expect(receipt).toBeVisible()
    await expect(receipt.locator('.obx-stamp')).toContainText(/by hand · not checked/i)
    expect(await rowValue(page, m.rows['10668'], m.props.waiting)).toBe(false)
    await expect.poll(() => outbox(page, (o) => o.inbox().filter((i: AnyState) => i.kind === 'agent' && i.archived).length)).toBe(1)
    await expect.poll(() => versionsOf(page, m.rows['10668'])).toContainEqual({ reason: 'outbox', by: 'Reply in the ticket tool' })
    const stored = await outbox(page, (o) => o.getSlips()[0])
    expect(stored.state).toBe('sent')
    expect(stored.receipt).toMatchObject({ path: 'hand', tool: 'add_comment', readBack: { state: 'none' } })
    expect(await outbox(page, (o, a) => o.ownSends(a.row), { row: m.rows['10668'] })).toMatchObject([{ tool: 'add_comment', role: 'reply', values: { ref: '10668', body: text } }])
    // a sent slip cannot be withdrawn
    expect(await outbox(page, (o, a) => o.withdrawSlip(a.id, 'origin'), { id: stored.id })).toBe('too-late')

    await receipt.getByTestId('outbox-reset').click()
    await expect(receipt.getByTestId('outbox-reset-note')).toHaveText('Row reset — only in One; what went out stays out.')
    expect(await rowValue(page, m.rows['10668'], m.props.waiting)).toBe(true)

    // the person changes the field between the send and the reset: the reset keeps it and says so
    const next = await outbox(page, (o, a) => o.stageSlip({ route: a.route, rowId: a.row, draft: 'Done, logged.', origin: { kind: 'api' }, sources: [] }), { route: routeRef('reply'), row: m.rows['10642'] })
    await outbox(page, (o, a) => o.useOutbox.setState({ focus: a.id }), { id: next.slip.id })
    await expect(slip(page)).toHaveAttribute('data-slip', next.slip.id)
    await expect(copyKey(page)).not.toHaveAttribute('aria-disabled', 'true')
    const popup2 = context.waitForEvent('page')
    await copyKey(page).click()
    await (await popup2).close().catch(() => undefined)
    await slip(page).getByTestId('outbox-mark-sent').click()
    await expect.poll(() => rowValue(page, m.rows['10642'], m.props.waiting)).toBe(false)
    await wsEval(page, (s, a) => s.setRowProperty(a.row, a.p, null), { row: m.rows['10642'], p: m.props.waiting })
    const second = dock(page).getByTestId('outbox-receipt').first()
    await second.getByTestId('outbox-reset').click()
    await expect(second.getByTestId('outbox-reset-note')).toHaveText('Kept (changed since): Waiting on me')
    expect(await rowValue(page, m.rows['10642'], m.props.waiting)).toBeNull()
  })

  test('CHANGED per mirror: the lamp, the band with the quote; H holds; R drafts again and resets seen', async ({ page, context }) => {
    const calls = await mockDrafts(context, (_b, n) => (n === 1 ? 'Hi Jana, take B6.' : 'Good to hear B7 fits — nothing more from me.'))
    const m = await setup(page)
    await draftReply(page, m, 0)
    await expect(slip(page).getByTestId('outbox-lamp-changed')).not.toHaveAttribute('data-lit', 'true')
    await mirrorWrite(page, m, '10668', { comments: 8, last: 'It is settled, B7 fits. Thanks!', at: '2026-10-10T08:09' })
    const band = slip(page).getByTestId('outbox-changed')
    await expect(band).toBeVisible()
    await expect(band).toContainText(/comments 7 → 8/i)
    await expect(band).toContainText(/source status unchanged/i)
    await expect(band).toContainText('It is settled, B7 fits. Thanks!')
    // the comment's time from the stored stamp ("today 08:09" or "10 Oct 08:09")
    await expect(band.locator('.obx-band__when')).toContainText('08:09')
    await expect(slip(page).getByTestId('outbox-lamp-changed')).toHaveAttribute('data-lit', 'true')
    await expect(copyKey(page)).toHaveAttribute('aria-disabled', 'true')
    await expect(slip(page).getByTestId('outbox-why')).toHaveText('Changed since the draft — hold, redraft or send anyway')
    // H: hold (keys work with focus in the dock, not in a field)
    await slip(page).focus()
    await page.keyboard.press('h')
    await expect(slip(page)).toHaveAttribute('data-state', 'held')
    // R: Claude drafts again — the row as it is now; the band goes, the slip is ready, revision 2
    await page.keyboard.press('r')
    await expect.poll(() => calls.length).toBe(2)
    expect(JSON.stringify(calls[1].body.messages)).toContain('It is settled, B7 fits. Thanks!')
    await expect(slip(page).getByTestId('outbox-text')).toHaveText('Good to hear B7 fits — nothing more from me.')
    await expect(slip(page)).toHaveAttribute('data-state', 'ready')
    await expect(slip(page).getByTestId('outbox-changed')).toHaveCount(0)
    // revision 2, seen once it is on screen
    await expect.poll(() => outbox(page, (o) => o.getSlips()[0].draft)).toMatchObject({ rev: 2, by: 'claude', seenRev: 2 })
    // "Send anyway" after a new change: the person read it, the key works again
    await mirrorWrite(page, m, '10668', { comments: 9, last: 'One more thing: the freeze moves to 16.10.', at: '2026-10-10T09:00' })
    await expect(slip(page).getByTestId('outbox-changed')).toBeVisible()
    await slip(page).getByTestId('outbox-anyway').click()
    await expect(copyKey(page)).not.toHaveAttribute('aria-disabled', 'true')
  })

  test('keys: J / K move between slips, H holds, E edits, Esc closes the question; the dock closes with its ✕', async ({ page, context }) => {
    await mockDrafts(context, () => 'x')
    const m = await setup(page)
    for (const key of ['10642', '10655'])
      await outbox(page, (o, a) => o.stageSlip({ route: a.route, rowId: a.row, params: { minutes: 30 }, origin: { kind: 'command' }, sources: [{ kind: 'row', ref: `${a.row}:${a.p}`, label: 'Comments' }] }), { route: routeRef('work'), row: m.rows[key], p: m.props.comments })
    await openDb(page, m)
    await expect(dock(page).getByTestId('outbox-strip')).toHaveCount(1)
    const first = await slip(page).getAttribute('data-slip')
    await slip(page).focus()
    await page.keyboard.press('j')
    await expect(slip(page)).not.toHaveAttribute('data-slip', first!)
    await expect(slip(page)).toBeFocused()
    await page.keyboard.press('k')
    await expect(slip(page)).toHaveAttribute('data-slip', first!)
    await expect(slip(page)).toBeFocused()
    await page.keyboard.press('h')
    await expect(slip(page)).toHaveAttribute('data-state', 'held')
    await page.keyboard.press('h')
    await expect(slip(page)).toHaveAttribute('data-state', 'ready')
    // a typed slip has no text to edit; the title says what it books
    await expect(slip(page).locator('.obx-slip__title')).toHaveText('Log work · 30 min')
    await page.getByTestId('outbox-dock-close').click()
    await expect(dock(page)).toHaveCount(0)
    await page.getByTestId('outbox-readout').getByRole('button').click()
    await expect(dock(page)).toBeVisible()
  })
})

test.describe('Outbox: storage, tabs, counts, API', () => {
  test('slips survive a reload, stay in their workspace, and reach another tab within a second', async ({ page, context }) => {
    const m = await setup(page)
    const res = await outbox(page, (o, a) => o.stageSlip({ route: a.route, rowId: a.row, params: { minutes: 45 }, origin: { kind: 'api' }, sources: [] }), { route: routeRef('work'), row: m.rows['10642'] })
    expect(res.slip.state).toBe('ready')
    // a record of another workspace in the same store is never loaded here — nor a damaged (or other version's) one
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const r = indexedDB.open('one-outbox')
          r.onerror = () => reject(r.error)
          r.onsuccess = () => {
            const tx = r.result.transaction('kv', 'readwrite')
            tx.objectStore('kv').put({ v: 1, id: 'out_OTHERscope', scope: 'cloud:elsewhere', state: 'ready' }, 'cloud:elsewhere|slip|out_OTHERscope')
            tx.objectStore('kv').put({ v: 1, id: 'out_Damaged001', scope: 'local:local', state: 'ready' }, 'local:local|slip|out_Damaged001')
            tx.oncomplete = () => (r.result.close(), resolve())
            tx.onerror = () => reject(tx.error)
          }
        }),
    )
    const other = await context.newPage()
    await openApp(other)
    await outboxLoaded(other)
    expect(await outbox(other, (o) => o.getSlips().map((s: AnyState) => s.id))).toEqual([res.slip.id])
    const second = await outbox(page, (o, a) => o.stageSlip({ route: a.route, rowId: a.row, params: { minutes: 15 }, origin: { kind: 'api' }, sources: [] }), { route: routeRef('work'), row: m.rows['10655'] })
    await expect.poll(() => outbox(other, (o) => o.getSlips().length), { timeout: 1000 }).toBe(2)
    expect(await outbox(other, (o) => o.getSlips()[0].id)).toBe(second.slip.id)
    await other.close()
    await reloadApp(page)
    await outboxLoaded(page)
    expect((await outbox(page, (o) => o.getSlips().map((s: AnyState) => s.id))).sort()).toEqual([res.slip.id, second.slip.id].sort())
  })

  test('the counts agree everywhere: sidebar, tree, readout, dock, #/outbox, status bar (5 open: 2 clean, 2 foreign, 1 held · 3 sent today)', async ({ page, context }) => {
    await blockTracker(context)
    context.on('page', (p) => void p.close().catch(() => undefined))
    const m = await setup(page)
    const typed = (row: string, minutes: number) =>
      outbox(page, (o, a) => o.stageSlip({ route: a.route, rowId: a.row, params: { minutes: a.minutes }, origin: { kind: 'command' }, sources: [{ kind: 'row', ref: `${a.row}:${a.p}`, label: 'Comments' }] }), { route: routeRef('work'), row: m.rows[row], minutes, p: m.props.comments })
    const foreign = (row: string, draft: string) =>
      outbox(page, (o, a) => o.stageSlip({ route: a.route, rowId: a.row, draft: a.draft, origin: { kind: 'api' }, sources: [{ kind: 'row', ref: `${a.row}:${a.p}`, label: 'Comment', text: 'a comment' }] }), { route: routeRef('reply'), row: m.rows[row], draft, p: m.props.lastComment })
    // three typed slips go out by hand
    for (const row of ['10642', '10655', '10668']) await typed(row, 30)
    await openDb(page, m)
    for (let i = 0; i < 3; i++) {
      await copyKey(page).click()
      await slip(page).getByTestId('outbox-mark-sent').click()
      await expect(dock(page).getByTestId('outbox-receipt')).toHaveCount(i + 1)
    }
    // five open: two clean, two foreign, one held
    await typed('10642', 60)
    await typed('10655', 90)
    await foreign('10681', 'Approved.')
    await foreign('10679', 'Risk is low.')
    const held = await foreign('10668', 'Take B6.')
    await dock(page).getByTestId('outbox-foreign-fold').click()
    await dock(page).getByRole('button', { name: /Open slip: Reply to J\. Weber/ }).click()
    await expect(slip(page)).toHaveAttribute('data-slip', held.slip.id)
    await slip(page).getByTestId('outbox-hold-key').click()
    await expect(slip(page)).toHaveAttribute('data-state', 'held')

    expect(await outbox(page, (o) => o.counts())).toMatchObject({ open: 5, clean: 2, foreign: 2, held: 1, sentToday: 3 })
    await expect(page.getByTestId('outbox-nav-badge')).toHaveAttribute('data-n', '5')
    await expect(page.getByTestId('outbox-nav-badge')).toHaveText(/^5 open$/i)
    await expect(page.getByTestId('outbox-tree-count')).toHaveAttribute('data-n', '5')
    await expect(page.getByTestId('outbox-readout-open')).toHaveText('5')
    await expect(page.getByTestId('outbox-readout-sent')).toHaveText('3')
    await expect(page.getByTestId('outbox-dock-count')).toHaveAttribute('data-n', '5')
    await expect(page.getByTestId('outbox-status')).toHaveAttribute('data-n', '5')
    await page.evaluate(() => (location.hash = '#/outbox'))
    await expect(page.getByTestId('outbox-page-open')).toHaveText('05')
    await expect(page.getByTestId('outbox-page-sent')).toHaveText('3')
    await expect(page.getByTestId('outbox-tab-clean')).toContainText('2')
    await expect(page.getByTestId('outbox-tab-foreign')).toContainText('2')
    await expect(page.getByTestId('outbox-tab-held')).toContainText('1')
    await expect(page.getByTestId('outbox-tab-sent')).toContainText('3')
    await expect(page.getByTestId('outbox-receipts').locator('.obx-paper__entry')).toHaveCount(3)
    await expect(page.locator('#obx-bin-a ~ .obx-cards .obx-card')).toHaveCount(2)
    await expect(page.locator('#obx-bin-b ~ .obx-cards .obx-card')).toHaveCount(3)
  })

  test('blocked storage fails closed: nothing is staged, the dock says why', async ({ page }) => {
    await page.addInitScript(() => {
      const open = indexedDB.open.bind(indexedDB)
      indexedDB.open = ((name: string, v?: number) => {
        if (name === 'one-outbox') throw new DOMException('blocked for this test', 'SecurityError')
        return open(name, v)
      }) as typeof indexedDB.open
    })
    const m = await setup(page)
    expect(await outbox(page, (o) => o.useOutbox.getState().storage.ok)).toBe(false)
    const res = await outbox(page, (o, a) => o.stageSlip({ route: a.route, rowId: a.row, params: { minutes: 30 }, origin: { kind: 'api' }, sources: [] }), { route: routeRef('work'), row: m.rows['10642'] })
    expect(res).toEqual({ refused: 'storage' })
    await openDb(page, m)
    await page.getByTestId('outbox-routes').getByRole('button', { name: /Log work/ }).click()
    const dlg = draftDialog(page)
    await dlg.getByRole('textbox', { name: 'Pick a row' }).fill('10642')
    await dlg.getByRole('option', { name: /10642/ }).click()
    await dlg.getByRole('textbox', { name: 'Minutes' }).fill('30')
    await dlg.getByTestId('outbox-draft-stage').click()
    await expect(dlg.getByRole('alert')).toHaveText('This browser cannot keep slips (storage blocked) — nothing was staged.')
  })

  test('the API: refusals, a missing text (Edit only), withdraw, groups, typed params', async ({ page }) => {
    const m = await setup(page)
    const stage = (input: AnyState) => outbox(page, (o, i) => o.stageSlip(i), input)
    const base = { origin: { kind: 'api' }, sources: [] }
    expect(await stage({ ...base, route: { profileId: 'tracker-out', routeId: 'nope' }, rowId: m.rows['10642'], params: { minutes: 30 } })).toEqual({ refused: 'noRoute' })
    expect(await stage({ ...base, route: routeRef('reply'), rowId: m.rows['10642'], draft: 'x'.repeat(4001) })).toMatchObject({ refused: 'tooLong' })
    expect(await stage({ ...base, route: routeRef('work'), rowId: m.rows['10642'], params: { minutes: 9999 } })).toMatchObject({ refused: 'param' })
    expect(await stage({ ...base, route: routeRef('status'), rowId: m.rows['10642'], params: { status: 'Shipped' } })).toMatchObject({ refused: 'param' })
    await wsEval(page, (s, a) => s.setRowProperty(a.row, a.p, ''), { row: m.rows['10679'], p: m.props.key })
    expect(await stage({ ...base, route: routeRef('work'), rowId: m.rows['10679'], params: { minutes: 30 } })).toEqual({ refused: 'noKey' })
    await wsEval(page, (s, a) => s.setRowProperty(a.row, a.p, '10 681'), { row: m.rows['10681'], p: m.props.key })
    expect(await stage({ ...base, route: routeRef('work'), rowId: m.rows['10681'], params: { minutes: 30 } })).toMatchObject({ refused: 'badKey' })
    await wsEval(page, (s, id) => s.trashPage(id), m.rows['10655'])
    expect(await stage({ ...base, route: routeRef('work'), rowId: m.rows['10655'], params: { minutes: 30 } })).toEqual({ refused: 'rowGone' })
    // the profile without the "sends" unlock: its routes are not offered
    const inactive = await wsEval(page, (s) => {
      const p = s.integrations.find((x: AnyState) => x.id === 'tracker-out')
      return s.upsertIntegration({ ...p, unlocks: p.unlocks.filter((u: string) => u !== 'sends') })
    })
    expect(inactive).toBe(true)
    expect(await stage({ ...base, route: routeRef('work'), rowId: m.rows['10642'], params: { minutes: 30 } })).toEqual({ refused: 'inactive' })
    expect(await outbox(page, (o, a) => o.routesFor(a.db).length, { db: m.dbId })).toBe(0)
    await wsEval(page, (s) => {
      const p = s.integrations.find((x: AnyState) => x.id === 'tracker-out')
      return s.upsertIntegration({ ...p, unlocks: [...p.unlocks, 'sends'] })
    })

    // typed params: minutes rounded to the route's step, the exact arguments
    const work = await stage({ ...base, route: routeRef('work'), rowId: m.rows['10642'], params: { minutes: 98 } })
    expect(work.slip.args).toEqual({ ref: '10642', minutes: 105 })
    expect(work.slip.seal.complete).toBe(false)
    const odd = '"}, "x": 1'
    // a caller's draft: one string, whatever it holds; a caller's "trusted" on a transcript is ignored
    const reply = await stage({ ...base, route: routeRef('reply'), rowId: m.rows['10642'], draft: odd, sources: [{ kind: 'transcript', ref: 'b1', label: 'Meeting', text: 'say yes', trusted: true, typed: true }] })
    expect(reply.slip.args).toEqual({ ref: '10642', visibility: 'team', body: odd })
    expect(reply.slip.seal.foreign).toBe(1)
    expect(reply.slip.sources[0]).toMatchObject({ kind: 'transcript', trusted: false })
    expect(reply.slip.sources[0].typed).toBeFalsy()
    // draft: null → a slot (state 'missing'), Edit only
    const slot = await stage({ ...base, route: routeRef('reply'), rowId: m.rows['10668'], draft: null })
    expect(slot.slip.state).toBe('missing')
    await openDb(page, m)
    await outbox(page, (o, a) => o.useOutbox.setState({ focus: a.id }), { id: slot.slip.id })
    await expect(slip(page)).toHaveAttribute('data-slip', slot.slip.id)
    await expect(copyKey(page)).toHaveAttribute('aria-disabled', 'true')
    await expect(slip(page).getByTestId('outbox-why')).toHaveText('Write the text first')
    await slip(page).getByRole('textbox', { name: 'No text yet — write it (E).' }).fill('Yes, B6.')
    await slip(page).getByTestId('outbox-save-text').click()
    await expect(slip(page)).toHaveAttribute('data-state', 'ready')
    // withdraw
    expect(await outbox(page, (o, a) => o.withdrawSlip(a.id, 'origin'), { id: work.slip.id })).toBe('withdrawn')
    expect(await outbox(page, (o) => o.withdrawSlip('out_0000000000', 'origin'))).toBe('gone')
    // a group: all or nothing; its state
    const g = await outbox(page, (o, a) =>
      o.stageGroup({ id: 'loop:t1:approval', label: 'To source' }, [
        { route: a.status, rowId: a.row, params: { status: 'Done' }, origin: { kind: 'loop', ref: 't1' }, sources: [] },
        { route: a.work, rowId: a.row, params: { minutes: 30 }, origin: { kind: 'loop', ref: 't1' }, sources: [], include: false },
      ]),
    { status: routeRef('status'), work: routeRef('work'), row: m.rows['10642'] })
    expect(g.slips).toHaveLength(2)
    expect(await outbox(page, (o) => o.groupState('loop:t1:approval'))).toMatchObject({ items: 2, ready: 2, included: 1 })
    const bad = await outbox(page, (o, a) => o.stageGroup({ id: 'loop:t2', label: 'x' }, [{ route: a.work, rowId: a.row, params: { minutes: 30 }, origin: { kind: 'loop' }, sources: [] }, { route: a.work, rowId: a.row, params: { minutes: -5 }, origin: { kind: 'loop' }, sources: [] }]), { work: routeRef('work'), row: m.rows['10642'] })
    expect(bad).toEqual({ refused: 'param', index: 1 })
    expect(await outbox(page, (o) => o.groupState('loop:t2').items)).toBe(0)
    expect(await outbox(page, (o) => o.withdrawGroup('loop:t1:approval', 'origin'))).toMatchObject({ tooLate: [] })
    await flush(page)
  })

  test('the limit: 500 open slips per workspace', async ({ page }) => {
    test.slow()
    const m = await setup(page)
    const n = await outbox(
      page,
      async (o, a) => {
        let ok = 0
        for (let i = 0; i < 500; i++) {
          const r = await o.stageSlip({ route: a.route, rowId: a.row, params: { minutes: 15 }, origin: { kind: 'api' }, sources: [] })
          if (r.slip) ok++
        }
        return ok
      },
      { route: routeRef('work'), row: m.rows['10642'] },
    )
    expect(n).toBe(500)
    expect(await outbox(page, (o, a) => o.stageSlip({ route: a.route, rowId: a.row, params: { minutes: 15 }, origin: { kind: 'api' }, sources: [] }), { route: routeRef('work'), row: m.rows['10642'] })).toEqual({ refused: 'limit' })
  })
})
