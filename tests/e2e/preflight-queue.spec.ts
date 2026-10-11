/**
 * Preflight P2 — the queue (T-P2-1 … T-P2-8, T-P2-15): the fictional morning at card 3 of 10; agent proposals applied
 * and discarded with the agents' own review (the row written, no toast, the cap clicking down in the same frame, Z);
 * the AI terminal's changes (quiet, VON HAND only from the confirm key, the same body parts as the terminal's list,
 * a discard's cascade back with Z); memory; coding through the terminal's planner (a version confirmed exactly as
 * shown); the inbox; the Outbox (opened, never sent from here); ⇧A only over cards shown in full; X; Z never skipping;
 * focus never on the body; keys only with focus in the queue; touch swipes; the contract (cards = the reading's ids).
 * Every name is fictional (tests/e2e/helpers/preflightStory.mjs); no request leaves the machine.
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval, createPage, doc, para, MOD } from './fixtures'
import { flushLamps, seedMirror, seedMorning, seedPipeline, seedRuns, seedTerminal, waitPreflight } from './helpers/preflightStory.mjs'
import { AUTH, MCP_URL, mockOAuth } from './helpers/oauth'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Run a function against a window seam: (seam, arg) → value. */
const seam = <R, A = null>(page: Page, name: string, fn: (s: AnyState, arg: A) => R | Promise<R>, arg?: A): Promise<R> =>
  page.evaluate(({ name, src, arg }) => new Function('s', 'arg', `return (${src})(s, arg)`)((window as unknown as Record<string, AnyState>)[name], arg), { name, src: fn.toString(), arg: (arg ?? null) as A }) as Promise<R>
const pf = <R, A = null>(page: Page, fn: (s: AnyState, arg: A) => R | Promise<R>, arg?: A) => seam(page, '__onePreflight', fn, arg)

const cap = (page: Page, id: string) => page.locator(`.pf-cap[data-lamp="${id}"]`)
const card = (page: Page) => page.locator('.pf-q article.pf-card[data-current]')
const queue = (page: Page) => page.getByTestId('pf-queue')
const tab = (page: Page, id: string) => queue(page).locator(`.pf-tab[data-lamp="${id}"]`)
const toasts = (page: Page) => page.locator('.toast')
const live = (page: Page) => page.getByTestId('pf-live')
const q = (page: Page) => pf(page, (p) => {
  const s = p.stores.queue.getState()
  return { lamp: s.lamp, card: s.card, done: s.done.map((e: AnyState) => ({ id: e.id, outcome: e.outcome, undone: !!e.undone, batch: e.batch ?? null })), inWork: Object.keys(s.inWork), confirm: s.confirm, bulk: s.bulk, viewed: Object.keys(s.viewed) }
})
const count = async (page: Page, id: string) => {
  await flushLamps(page)
  return pf(page, (p, id) => p.readings()[id]?.count ?? null, id)
}
const activeId = (page: Page) => page.evaluate(() => {
  const a = document.activeElement as HTMLElement | null
  return a === document.body || !a ? 'BODY' : a.matches('article.pf-card') ? `card:${a.getAttribute('data-id')}` : `${a.tagName.toLowerCase()}.${a.className}`
})

async function start(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
  // nothing leaves the machine (the relay's links, a sign-in window)
  await page.context().route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort())
  await openApp(page)
  await waitPreflight(page)
}

/** ↵ on a lit cap: acknowledged, its queue tab open, the current card takes the keyboard. */
async function openLamp(page: Page, id: string): Promise<void> {
  await cap(page, id).focus()
  await page.keyboard.press('Enter')
  await expect(tab(page, id)).toHaveAttribute('aria-selected', 'true')
  await expect(card(page)).toBeFocused()
}

/** Make a card current by its id (a compact row click). */
async function pick(page: Page, id: string): Promise<void> {
  const row = queue(page).locator(`.pf-qr[data-id="${id}"]`)
  await expect.poll(async () => (await card(page).getAttribute('data-id')) === id || (await row.count()) > 0).toBe(true)
  if ((await card(page).getAttribute('data-id')) !== id) await row.click()
  await expect(card(page)).toHaveAttribute('data-id', id)
  await card(page).focus()
}

/** Wait until the card is the current one and prepared (its keys usable). */
async function ready(page: Page, id: string): Promise<void> {
  await expect(card(page)).toHaveAttribute('data-id', id)
  await expect(card(page)).not.toHaveAttribute('aria-busy', 'true')
}

const rowValue = (page: Page, row: string, prop: string) => wsEval(page, (s, a) => s.pages[a.row]?.properties[a.prop] ?? null, { row, prop })
const runStatus = (page: Page, agent: string, run: string, change: string) =>
  pf(page, async (p, a) => (await p.stores.agentRuns.getState().byAgent[a.agent])?.find((r: AnyState) => r.id === a.run)?.staged?.find((c: AnyState) => c.id === a.change)?.status ?? null, { agent, run, change })

test.describe('the queue — the morning at card 3 (T-P2-1)', () => {
  test('two cards done (one applied, one discarded): the place, the gauge, the done list, the tabs, the read-out, MASTER CAUTION', async ({ page }) => {
    await start(page)
    await seedMorning(page)
    // the Outbox's lamp was acknowledged earlier this morning; Proposals now, by ↵
    await pf(page, (p) => p.ack('outbox'))
    await openLamp(page, 'proposals')
    const first = await card(page).getAttribute('data-id')
    await ready(page, first!)
    await page.keyboard.press('a')
    await expect.poll(async () => (await q(page)).done.length).toBe(1)
    await expect(card(page)).not.toHaveAttribute('data-id', first!)
    const second = await card(page).getAttribute('data-id')
    await ready(page, second!)
    await page.keyboard.press('d')
    await expect.poll(async () => (await q(page)).done.length).toBe(2)
    await expect(queue(page).locator('.pf-qbar__pos')).toHaveText('3 / 10')
    const cells = await queue(page).locator('.pf-gauge i').evaluateAll((els) => els.map((e) => e.className))
    expect(cells.slice(0, 3)).toEqual(['d', 'd', 'c'])
    expect(cells.filter((c) => c === 's')).toHaveLength(3)
    await expect(queue(page).locator('.pf-qbar__done')).toContainText('applied')
    await expect(queue(page).locator('.pf-qbar__done s')).toHaveCount(1)
    // the tabs: Proposals 08 · Gate 02 · Token 01 · Outbox 01 · All 12
    await expect.poll(() => queue(page).locator('.pf-tab').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-lamp')} ${e.querySelector('b')?.textContent}`))).toEqual(['proposals 08', 'gate 02', 'token 01', 'outbox 01', 'all 12'])
    await expect(page.locator('.pf__read dd').first()).toContainText('12')
    await expect(page.locator('.pf__read dd').nth(1)).toContainText('2 since')
    // MASTER CAUTION: Gate and Token are new; Proposals and Outbox acknowledged
    await expect(page.getByTestId('pf-mc')).toHaveAttribute('data-state', 'lit')
    await expect(page.getByTestId('pf-mc').locator('.pf-mc__n')).toHaveText('2')
    // the rule card follows the open tab, with the sources' note
    await expect(page.getByTestId('pf-rule')).toHaveAttribute('data-lamp', 'proposals')
    await expect(page.getByTestId('pf-rule')).toContainText('8 cards')
    await expect(page.getByTestId('pf-rule')).toContainText('3 of them stale')
    // the cap of the open lamp shows the card's place
    await expect(cap(page, 'proposals').locator('.pf-cap__open')).toHaveText(/^↵\s*3\/10$/)
  })
})

test.describe('agent proposals (T-P2-2)', () => {
  test('A writes the row through the agents’ review (no toast; the cap clicks down in the same frame), D discards, Z takes both back', async ({ page }) => {
    await start(page)
    const m = await seedMirror(page)
    await seedRuns(page, m)
    await page.evaluate(() => (window.location.hash = '#/'))
    await flushLamps(page)
    await openLamp(page, 'proposals')
    await ready(page, 'run:r-now#c1')
    await expect(card(page)).toContainText('#NL-201')
    await expect(card(page).locator('[data-part="props"]')).toBeVisible()
    // A: the cap shows 09 in the same frame as the key (the overlay), before the reading comes back
    const sameFrame = await page.evaluate(() => {
      const el = document.querySelector('.pf-q article.pf-card[data-current]') as HTMLElement
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
      return new Promise<string>((resolve) => requestAnimationFrame(() => resolve(document.querySelector('.pf-cap[data-lamp="proposals"] .pf-cap__n')!.textContent ?? '')))
    })
    expect(sameFrame).toBe('07')
    await expect.poll(() => rowValue(page, m.rows['NL-201'], m.props.comments)).toBe(4)
    await expect.poll(() => runStatus(page, m.mirrorId, 'r-now', 'c1')).toBe('applied')
    await expect(card(page)).toHaveAttribute('data-id', 'run:r-now#c2')
    await expect(card(page)).toBeFocused()
    await page.waitForTimeout(500)
    await expect(toasts(page)).toHaveCount(0)
    expect(await count(page, 'proposals')).toBe(7)
    await expect(live(page)).toContainText('#NL-201 applied')
    // D on the next one
    await ready(page, 'run:r-now#c2')
    await page.keyboard.press('d')
    await expect.poll(() => runStatus(page, m.mirrorId, 'r-now', 'c2')).toBe('discarded')
    expect(await count(page, 'proposals')).toBe(6)
    // Z: the discard back (pending), then the apply (the value back), each card back and focused
    await page.keyboard.press('z')
    await expect.poll(() => runStatus(page, m.mirrorId, 'r-now', 'c2')).toBe('pending')
    await expect(card(page)).toHaveAttribute('data-id', 'run:r-now#c2')
    await expect(card(page)).toBeFocused()
    await page.keyboard.press('z')
    await expect.poll(() => runStatus(page, m.mirrorId, 'r-now', 'c1')).toBe('pending')
    await expect.poll(() => rowValue(page, m.rows['NL-201'], m.props.comments)).not.toBe(4)
    await expect(card(page)).toHaveAttribute('data-id', 'run:r-now#c1')
    expect(await count(page, 'proposals')).toBe(8)
    // nothing left to undo: says so, does nothing
    await page.keyboard.press('z')
    await expect(live(page)).toContainText('Nothing to undo')
    await page.waitForTimeout(300)
    await expect(toasts(page)).toHaveCount(0)
  })

  test('a rename shows the old title struck; a send proposal is VON HAND and opens its slip, never applied here', async ({ page }) => {
    await start(page)
    const m = await seedMirror(page)
    const now = Date.now()
    await pf(
      page,
      (p, a) =>
        p.seedRuns([
          {
            id: 'r-ren',
            agentId: a.agent,
            runner: 'browser',
            trigger: { type: 'manual' },
            startedAt: a.now - 60_000,
            endedAt: a.now - 30_000,
            status: 'staged',
            summary: 'Ein Titel war veraltet.',
            steps: [],
            staged: [{ id: 'c1', n: 1, kind: 'rename', status: 'pending', pageId: a.row, title: 'Zertifikat Halle Nord erneuern', beforeTitle: 'Zertifikat Halle Nord läuft ab' }],
          },
        ]),
      { agent: m.reportId, row: m.rows['NL-202'], now },
    )
    await page.evaluate(() => (window.location.hash = '#/'))
    await flushLamps(page)
    await openLamp(page, 'proposals')
    await ready(page, 'run:r-ren#c1')
    await expect(card(page).locator('.agent-diff__before')).toHaveText('Zertifikat Halle Nord läuft ab')
    // E: the run's own report
    await page.keyboard.press('e')
    await expect(card(page).getByTestId('pf-run-report')).toContainText('Ein Titel war veraltet.')
  })
})

test.describe('the AI terminal’s changes (T-P2-3)', () => {
  const stage = (page: Page, changes: AnyState[]) => pf(page, (p, changes) => p.terminal({ changes }), changes)
  const statuses = (page: Page) => pf(page, (p) => Object.fromEntries(p.stores.agent.getState().changes.map((c: AnyState) => [c.id, c.status])))
  const termId = (page: Page, cid: string) => pf(page, (p, cid) => p.stores.queue.getState().items.proposals?.find((i: AnyState) => i.refs.changeId === cid)?.id ?? null, cid)

  test('A applies quietly (Z = its batch); VON HAND: A opens the confirm row, a second A does nothing, ↵ on its key applies', async ({ page }) => {
    await start(page)
    const notes = await createPage(page, { title: 'Schichtnotizen' })
    const pipe = await seedPipeline(page)
    await stage(page, [
      { id: 'c1', n: 1, kind: 'append', status: 'pending', pageId: notes, title: 'Schichtnotizen', markdown: 'Linie 2 läuft im kurzen Takt.' },
      { id: 'c2', n: 2, kind: 'append', status: 'pending', pageId: pipe.tasks[0], title: 'Exportfilter: Sonderzeichen', markdown: 'Bitte auch Umlaute prüfen.' },
    ])
    await page.evaluate(() => (window.location.hash = '#/'))
    await flushLamps(page)
    await openLamp(page, 'proposals')
    const c1 = (await termId(page, 'c1'))!
    const c2 = (await termId(page, 'c2'))!
    await ready(page, c1)
    // the body is the terminal's own (its head too: title, where)
    await expect(card(page).getByTestId('pf-term-body').locator('[data-part="title"]')).toContainText('Schichtnotizen')
    await page.keyboard.press('a')
    await expect.poll(() => statuses(page)).toMatchObject({ c1: 'applied', c2: 'pending' })
    await page.waitForTimeout(400)
    await expect(toasts(page)).toHaveCount(0)
    await page.keyboard.press('z')
    await expect.poll(() => statuses(page)).toMatchObject({ c1: 'pending' })

    // the VON HAND card: its text goes to Claude Code with the task
    await pick(page, c2)
    await ready(page, c2)
    await expect(card(page).locator('.pf-card__head .pf-hand')).toBeVisible()
    await page.keyboard.press('a')
    const row = page.getByTestId('pf-confirm')
    await expect(row).toContainText('goes to Claude Code')
    await expect(page.getByTestId('pf-confirm-key')).toBeFocused()
    // a second A never confirms (L1)
    await page.keyboard.press('a')
    await page.waitForTimeout(300)
    expect((await statuses(page)).c2).toBe('pending')
    await expect(row).toBeVisible()
    // Esc closes the row first (the card keeps the keyboard)
    await page.keyboard.press('Escape')
    await expect(row).toHaveCount(0)
    await expect(card(page)).toBeFocused()
    await page.keyboard.press('a')
    await expect(page.getByTestId('pf-confirm-key')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(() => statuses(page)).toMatchObject({ c2: 'applied' })
    await page.waitForTimeout(300)
    await expect(toasts(page)).toHaveCount(0)
  })

  test('the card shows the same parts as the terminal’s review list (data-part); D on a parent takes its children, Z brings back exactly them', async ({ page }) => {
    await start(page)
    const notes = await createPage(page, { title: 'Schichtnotizen' })
    await stage(page, [
      { id: 'c1', n: 1, kind: 'create_page', status: 'pending', pageId: 'staged-p1', parentId: notes, title: 'Messreihe Linie 2', markdown: 'Messwerte folgen.' },
      { id: 'c2', n: 2, kind: 'append', status: 'pending', pageId: 'staged-p1', title: 'Messreihe Linie 2', markdown: 'Wert 1: 0,2 mm', dependsOn: 'c1' },
      { id: 'c3', n: 3, kind: 'append', status: 'pending', pageId: notes, title: 'Schichtnotizen', markdown: 'Unabhängig.' },
    ])
    await page.evaluate(() => (window.location.hash = '#/'))
    await flushLamps(page)
    await openLamp(page, 'proposals')
    const c1 = (await termId(page, 'c1'))!
    await ready(page, c1)
    await expect(card(page).locator('[data-part="preview"]')).toBeVisible()
    const cardParts = await card(page).locator('[data-part]').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-part')))].sort())
    // the terminal's own list
    await page.keyboard.press(`${MOD}+j`)
    const li = page.locator('li.term-change').filter({ hasText: 'Messreihe Linie 2' }).first()
    await expect(li).toBeVisible()
    const listParts = await li.locator('[data-part]').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-part')))].sort())
    expect(cardParts).toEqual(listParts)
    expect(cardParts).toContain('preview')
    await page.keyboard.press('Escape')
    await page.evaluate(() => (window.location.hash = '#/'))
    await expect(queue(page)).toBeVisible()
    await card(page).focus()
    await ready(page, c1)
    await page.keyboard.press('d')
    await expect.poll(() => statuses(page)).toEqual({ c1: 'discarded', c2: 'discarded', c3: 'pending' })
    await page.keyboard.press('z')
    await expect.poll(() => statuses(page)).toEqual({ c1: 'pending', c2: 'pending', c3: 'pending' })
  })
})

test.describe('⇧A, X, Z, focus and the keys (T-P2-7)', () => {
  test('⇧A applies only cards shown in full; unseen ones go to the bulk sheet first; never on "All"; one Z takes the batch back', async ({ page }) => {
    await start(page)
    const m = await seedMirror(page)
    await seedRuns(page, m)
    await page.evaluate(() => (window.location.hash = '#/'))
    await flushLamps(page)
    await openLamp(page, 'proposals')
    await ready(page, 'run:r-now#c1')
    // shown in full: c1, then c2 (J)
    await page.keyboard.press('j')
    await ready(page, 'run:r-now#c2')
    await page.keyboard.press('Shift+A')
    // c3, c4 (the run's other clean cards) and the report were not shown: the sheet shows them first
    const sheet = page.getByTestId('pf-bulk')
    await expect(sheet).toBeVisible()
    await expect(sheet.locator('.pf-bulk__item')).toHaveCount(3)
    await expect(page.getByTestId('pf-bulk-apply')).toBeFocused()
    expect(await runStatus(page, m.mirrorId, 'r-now', 'c1')).toBe('pending')
    // Esc closes it: nothing applied
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    expect(await runStatus(page, m.mirrorId, 'r-now', 'c3')).toBe('pending')
    // again: ↵ on its key applies all clean ones — the stale ones stay
    await card(page).focus()
    await page.keyboard.press('Shift+A')
    await expect(page.getByTestId('pf-bulk-apply')).toBeFocused()
    await page.keyboard.press('Enter')
    for (const c of ['c1', 'c2', 'c3', 'c4']) await expect.poll(() => runStatus(page, m.mirrorId, 'r-now', c)).toBe('applied')
    expect(await runStatus(page, m.mirrorId, 'r-d8', 'c1')).toBe('pending')
    await expect.poll(async () => (await q(page)).done.length).toBe(5)
    const done = (await q(page)).done
    expect(new Set(done.map((d) => d.batch)).size).toBe(1)
    expect(done).toHaveLength(5)
    await page.waitForTimeout(300)
    await expect(toasts(page)).toHaveCount(0)
    // one Z: the whole batch back
    await page.keyboard.press('z')
    for (const c of ['c1', 'c2', 'c3', 'c4']) await expect.poll(() => runStatus(page, m.mirrorId, 'r-now', c)).toBe('pending')
    // ⇧A on "All" does nothing but say so
    await tab(page, 'all').click()
    await card(page).focus()
    await page.keyboard.press('Shift+A')
    await expect(live(page)).toContainText('only in a lamp')
    await expect(page.getByTestId('pf-bulk')).toHaveCount(0)
  })

  test('X discards the stale cards (with Undo); Z on an entry without Undo says why and does nothing else; focus never falls to the body', async ({ page }) => {
    await start(page)
    const m = await seedMirror(page)
    await seedRuns(page, m)
    await seedMorning(page, { parts: ['pipeline'] })
    await openLamp(page, 'proposals')
    await ready(page, 'run:r-now#c1')
    await page.keyboard.press('x')
    for (const r of ['r-d8', 'r-d10', 'r-d11']) await expect.poll(() => runStatus(page, m.mirrorId, r, 'c1')).toBe('discarded')
    expect(await activeId(page)).toMatch(/^card:/)
    await page.keyboard.press('z')
    for (const r of ['r-d8', 'r-d10', 'r-d11']) await expect.poll(() => runStatus(page, m.mirrorId, r, 'c1')).toBe('pending')
    // a gate approved: no Undo (the worker takes over) — Z says why, and leaves the older entry alone
    await openLamp(page, 'gate')
    const gateCard = await card(page).getAttribute('data-id')
    await ready(page, gateCard!)
    await page.keyboard.press('a')
    await expect(page.getByTestId('pf-confirm-key')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await q(page)).done.some((d) => d.id === gateCard)).toBe(true)
    expect(await activeId(page)).not.toBe('BODY')
    await page.keyboard.press('z')
    await expect(live(page)).toContainText('cannot be undone')
    // the X batch before it stays undone, nothing else moved
    expect((await q(page)).done.filter((d) => d.undone)).toHaveLength(3)
  })

  test('keys act only with focus in the queue: inert in a text field and on another route; Enter on a key fires once; Esc never closes the peek; the tabs take ← → only', async ({ page }) => {
    await start(page)
    const m = await seedMirror(page)
    await seedRuns(page, m)
    await page.evaluate(() => (window.location.hash = '#/'))
    await flushLamps(page)
    await openLamp(page, 'proposals')
    await ready(page, 'run:r-now#c1')
    // positive control: J moves
    await page.keyboard.press('j')
    await expect(card(page)).toHaveAttribute('data-id', 'run:r-now#c2')
    // focus in the plate: J is not the queue's
    await cap(page, 'proposals').focus()
    await page.keyboard.press('j')
    await expect(card(page)).toHaveAttribute('data-id', 'run:r-now#c2')
    // Enter on the focused Discard key: its click, once (one card discarded, not two)
    await card(page).focus()
    await card(page).locator('.pf-key[data-key="d"]').focus()
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await q(page)).done.length).toBe(1)
    await page.waitForTimeout(400)
    expect((await q(page)).done.length).toBe(1)
    // the tab strip: ← → move between tabs; ↓ is the queue's (next card), never the tabs'
    await tab(page, 'proposals').focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.pf-tab[aria-selected="true"]')).not.toHaveAttribute('data-lamp', 'proposals')
    // a peek open: Esc in the queue goes back to the plate and leaves the peek open
    await page.evaluate((id) => (window as AnyState).__one.ui.getState().openPeek(id), m.rows['NL-205'])
    await expect(page.locator('.peek')).toBeVisible()
    await card(page).focus()
    await page.keyboard.press('Escape')
    await expect(cap(page, 'proposals')).toBeFocused()
    await expect(page.locator('.peek')).toBeVisible()
  })
})

test.describe('the contract (T-P2-15)', () => {
  test('for every lamp with cards: the cards are exactly the reading’s ids, and every card can end', async ({ page }) => {
    await start(page)
    await seedMorning(page)
    await page.evaluate(() => (window as AnyState).__oneOutbox.addAgentNote(Object.keys((window as AnyState).__one.workspace.getState().pages)[0], 'ag-spiegel', 'Mara Lind fragt nach dem Prüfplan.'))
    await flushLamps(page)
    const c = await pf(page, (p) => p.contract())
    for (const id of ['proposals', 'gate', 'token', 'outbox', 'inbox']) {
      expect(c[id], id).toBeTruthy()
      expect(c[id].count, id).toBeGreaterThan(0)
      expect(c[id], id).toMatchObject({ same: true, ending: true })
    }
  })
})

test.describe('memory (T-P2-4)', () => {
  const memoryRows = (page: Page, text: string) => wsEval(page, (s, text) => (Object.values(s.pages) as AnyState[]).filter((p) => p.title === text && !p.trashed).length, text)
  const memItem = (page: Page, c: string, i: string) => pf(page, (p, a) => p.stores.agent.getState().memCards.find((x: AnyState) => x.id === a.c)?.items.find((x: AnyState) => x.id === a.i) ?? null, { c, i })
  const proposal = (text: string) => ({ type: 'fact', text, topics: ['werk'], body: '', source: 'AI terminal · Schichtnotizen' })
  const itemId = (page: Page, end: string) => pf(page, (p, end) => p.stores.queue.getState().items.proposals?.find((i: AnyState) => i.id.endsWith(end))?.id ?? null, end)

  test('A saves the terminal’s proposal quietly, Z takes it back; one that would update a memory is VON HAND; an AI-menu memory run is saved and Z brings the run back', async ({ page }) => {
    await start(page)
    const text = 'Prüfplan P3 gilt bis zur Abnahme am 14.10.'
    await pf(page, (p, a) => p.terminal({ memCards: [{ id: 'mc1', after: 0, origin: 'task', state: 'ready', items: [{ id: 'mi1', status: 'pending', dup: null, p: a }] }] }), proposal(text))
    await page.evaluate(() => (window.location.hash = '#/'))
    await flushLamps(page)
    await openLamp(page, 'proposals')
    const first = (await card(page).getAttribute('data-id'))!
    expect(first).toMatch(/:mc1:mi1$/)
    await ready(page, first)
    await expect(card(page)).toContainText(text)
    await page.keyboard.press('a')
    await expect.poll(() => memoryRows(page, text)).toBe(1)
    expect((await memItem(page, 'mc1', 'mi1')).status).toBe('saved')
    await page.waitForTimeout(400)
    await expect(toasts(page)).toHaveCount(0)
    await page.keyboard.press('z')
    await expect.poll(() => memoryRows(page, text)).toBe(0)
    await expect.poll(async () => (await memItem(page, 'mc1', 'mi1')).status).toBe('pending')
    await expect(card(page)).toHaveAttribute('data-id', first)

    // saved again; a later proposal would UPDATE that memory: VON HAND (never in a bulk apply), ↵ on the confirm key
    await ready(page, first)
    await page.keyboard.press('a')
    await expect.poll(() => memoryRows(page, text)).toBe(1)
    const row = (await memItem(page, 'mc1', 'mi1')).rowId
    const newer = `${text} Danach gilt P4.`
    await pf(page, (p, a) => p.stores.agent.setState((s: AnyState) => ({ memCards: [...s.memCards, { id: 'mc2', after: 0, origin: 'task', state: 'ready', items: [{ id: 'mi2', status: 'pending', dup: a.row, p: a.p }] }] })), { row, p: proposal(newer) })
    await expect.poll(() => itemId(page, ':mc2:mi2')).not.toBeNull()
    const dup = (await itemId(page, ':mc2:mi2'))!
    await pick(page, dup)
    await ready(page, dup)
    await expect(card(page).locator('.pf-card__head .pf-hand')).toBeVisible()
    await expect(card(page)).toContainText(text)
    await page.keyboard.press('a')
    await expect(page.getByTestId('pf-confirm')).toContainText('never in a bulk apply')
    await expect(page.getByTestId('pf-confirm-key')).toBeFocused()
    expect(await memoryRows(page, newer)).toBe(0)
    await page.keyboard.press('Enter')
    await expect.poll(() => memoryRows(page, newer)).toBe(1)
    expect(await memoryRows(page, text)).toBe(0)
    expect((await memItem(page, 'mc2', 'mi2')).status).toBe('updated')

    // an AI-menu memory run ("Remember this"): A saves it and takes the run away; Z takes the memory back, the run returns
    const runText = 'Linie 2 läuft im kurzen Takt bis zum Audit.'
    await pf(
      page,
      (p, a) => {
        const now = Date.now()
        p.stores.aiRuns.setState((s: AnyState) => ({
          runs: { ...s.runs, mr1: { id: 'mr1', scope: 'local:local', pageId: 'none', req: { kind: 'memory', label: 'Remember', code: 'MEM', text: a.text, from: 'selection' }, status: 'done', output: '', sources: [], mcpCalls: [], error: null, issue: null, table: null, target: { from: 0, to: 0, lost: true }, startedAt: now - 60_000, finishedAt: now - 50_000, seen: true, proposals: [a.p] } },
        }))
      },
      { text: runText, p: proposal(runText) },
    )
    await expect.poll(() => itemId(page, 'airun:mr1')).toBe('airun:mr1')
    await pick(page, 'airun:mr1')
    await ready(page, 'airun:mr1')
    await expect(card(page)).toContainText(runText)
    await page.keyboard.press('a')
    await expect.poll(() => memoryRows(page, runText)).toBe(1)
    await expect.poll(() => pf(page, (p) => !!p.stores.aiRuns.getState().runs.mr1)).toBe(false)
    await page.waitForTimeout(300)
    await expect(toasts(page)).toHaveCount(0)
    await page.keyboard.press('z')
    await expect.poll(() => memoryRows(page, runText)).toBe(0)
    await expect.poll(() => pf(page, (p) => !!p.stores.aiRuns.getState().runs.mr1)).toBe(true)
    await expect(card(page)).toHaveAttribute('data-id', 'airun:mr1')
  })
})

test.describe('coding (T-P2-5)', () => {
  const coding = <R, A = null>(page: Page, fn: (s: AnyState, arg: A) => R | Promise<R>, arg?: A) => seam(page, '__oneCoding', fn, arg)
  const gateIds = async (page: Page): Promise<string[]> => {
    await flushLamps(page)
    return pf(page, (p) => p.readings().gate?.ids ?? [])
  }
  const needsConfirm = (page: Page, id: string) => coding(page, (c, id) => c.taskNeedsConfirm(id), id)
  const local = (page: Page, id: string) => pf(page, (p, id) => p.stores.codingLocal.getState().tasks[`local:local|${id}`] ?? null, id)

  test('an agent-touched task: the confirm card (page, fields, linked page, stages); a linked page changed before A → "changed", nothing trusted; confirmed → the gate card; A approves (no Z); a task moved since its card → nothing done, the card stays', async ({ page }) => {
    await start(page)
    await page.waitForFunction(() => !!(window as AnyState).__oneCoding)
    const pipe = await seedPipeline(page)
    const ref = await createPage(page, { title: 'Prüfblatt', content: doc(para('Toleranz 0,2 mm.')) })
    const [task, other] = pipe.tasks
    await wsEval(
      page,
      (s, a) => {
        s.setContent(a.task, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Den Exportfilter behalten. Siehe #/p/${a.ref}` }] }] }, 'e2e')
        s.updatePage(a.task, { updatedBy: 'agent:ag-fiktiv' })
      },
      { task, ref },
    )
    await page.evaluate(() => (window.location.hash = '#/'))
    // the worker is off on this device: the Confirm does not count (M7) — the task is a plain gate card
    expect((await gateIds(page)).some((id) => id.includes(':confirm@'))).toBe(false)
    expect((await gateIds(page)).some((id) => id.startsWith(`task:${task}:`) && id.includes(':gate@'))).toBe(true)
    await pf(page, (p) => p.stores.coding.setState({ enabled: true }))
    await expect.poll(async () => (await gateIds(page)).find((id) => id.startsWith(`task:${task}:confirm@`)) ?? null, { timeout: 15_000 }).not.toBeNull()
    const confirmId = (await gateIds(page)).find((id) => id.startsWith(`task:${task}:confirm@`))!

    await openLamp(page, 'gate')
    await pick(page, confirmId)
    await ready(page, confirmId)
    await expect(card(page).getByTestId('pf-version')).toBeVisible()
    await expect(card(page).getByTestId('pf-version-page')).toContainText('Den Exportfilter behalten.')
    await expect(card(page).getByTestId('pf-version-ref')).toContainText('Toleranz 0,2 mm.')
    expect(await card(page).locator('.pf-stages li').count()).toBeGreaterThan(3)
    // the linked page changes after the card was shown: what it showed is not the task any more
    await wsEval(page, (s, id) => s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Toleranz 0,5 mm.' }] }] }, 'e2e'), ref)
    await card(page).focus()
    await page.keyboard.press('a')
    await expect(page.getByTestId('pf-confirm-key')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(card(page).locator('.pf-card__error, .pf-card__tomb')).toBeVisible()
    expect(await needsConfirm(page, task)).toBe(true)

    // read again: the new version, confirmed exactly as shown
    await expect.poll(async () => (await gateIds(page)).find((id) => id.startsWith(`task:${task}:confirm@`) && id !== confirmId) ?? null, { timeout: 15_000 }).not.toBeNull()
    const again = (await gateIds(page)).find((id) => id.startsWith(`task:${task}:confirm@`))!
    await pick(page, again)
    await ready(page, again)
    await expect(card(page).getByTestId('pf-version-ref')).toContainText('Toleranz 0,5 mm.')
    await page.keyboard.press('a')
    await expect(page.getByTestId('pf-confirm-key')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(() => needsConfirm(page, task)).toBe(false)
    await expect.poll(async () => (await gateIds(page)).find((id) => id.startsWith(`task:${task}:`) && id.includes(':gate@')) ?? null, { timeout: 15_000 }).not.toBeNull()
    await expect.poll(async () => (await q(page)).done.find((d) => d.id === again)?.outcome ?? null).toBe('hand')

    // the gate: A approves through the terminal's planner and apply — no Undo
    const gate = (await gateIds(page)).find((id) => id.startsWith(`task:${task}:`) && id.includes(':gate@'))!
    await pick(page, gate)
    await ready(page, gate)
    await page.keyboard.press('a')
    await expect(page.getByTestId('pf-confirm-key')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await gateIds(page)).some((id) => id.startsWith(`task:${task}:`))).toBe(false)
    await expect.poll(async () => (await q(page)).done.find((d) => d.id === gate)?.outcome ?? null).toBe('hand')
    expect(await activeId(page)).not.toBe('BODY')
    await card(page).focus()
    await page.keyboard.press('z')
    await expect(live(page)).toContainText('cannot be undone')

    // M4: the other task's page changed after its card was read — the action moves nothing, the card stays
    const second = (await gateIds(page)).find((id) => id.startsWith(`task:${other}:`))!
    await pick(page, second)
    await ready(page, second)
    await wsEval(page, (s, id) => s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Zertifikat-Warnung — neu formuliert.' }] }] }, 'e2e'), other)
    await card(page).focus()
    await page.keyboard.press('a')
    await expect(page.getByTestId('pf-confirm-key')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(card(page).locator('.pf-card__error')).toBeVisible()
    await expect(card(page)).toHaveAttribute('data-id', second)
    expect((await q(page)).done.some((d) => d.id === second)).toBe(false)
    expect((await gateIds(page)).includes(second)).toBe(true)
  })

  test('a question: A opens the answer field (Esc leaves it), ↵ sends it through the confirm row; a failed task: A runs it again', async ({ page }) => {
    await start(page)
    await page.waitForFunction(() => !!(window as AnyState).__oneCoding)
    const pipe = await seedPipeline(page)
    const [, asking, failing] = pipe.tasks
    await pf(
      page,
      (p, a) => {
        const now = Date.now()
        p.stores.codingLocal.setState((s: AnyState) => ({
          tasks: {
            ...s.tasks,
            [`local:local|${a.q}`]: { state: 'question', question: 'Welche Farbe soll der Knopf haben?', at: now - 60_000 },
            [`local:local|${a.f}`]: { state: 'failed', error: 'Die Tests sind rot: 3 von 41.', at: now - 120_000 },
          },
        }))
      },
      { q: asking, f: failing },
    )
    await page.evaluate(() => (window.location.hash = '#/'))
    await flushLamps(page)
    await openLamp(page, 'question')
    const qid = (await card(page).getAttribute('data-id'))!
    expect(qid).toContain(`task:${asking}:`)
    await ready(page, qid)
    await expect(card(page)).toContainText('Welche Farbe soll der Knopf haben?')
    await page.keyboard.press('a')
    const field = card(page).locator('.pf-input textarea, .pf-input input').first()
    await expect(field).toBeFocused()
    // inert in the field: J types, it does not move
    await page.keyboard.press('j')
    await expect(field).toHaveValue('j')
    await page.keyboard.press('Escape')
    await expect(field).toHaveCount(0)
    await expect(card(page)).toBeFocused()
    await page.keyboard.press('a')
    await expect(field).toBeFocused()
    await field.fill('Orange, wie die Signalfarbe.')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('pf-confirm')).toContainText('goes to Claude Code')
    await expect(page.getByTestId('pf-confirm-key')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await local(page, asking))?.state).toBe('idle')
    expect((await local(page, asking)).answers).toMatchObject([{ q: 'Welche Farbe soll der Knopf haben?', a: 'Orange, wie die Signalfarbe.' }])

    await openLamp(page, 'failed')
    const fid = (await card(page).getAttribute('data-id'))!
    expect(fid).toContain(`task:${failing}:`)
    await ready(page, fid)
    await expect(card(page)).toContainText('Die Tests sind rot: 3 von 41.')
    await page.keyboard.press('a')
    await expect(page.getByTestId('pf-confirm-key')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await local(page, failing))?.state).toBe('idle')
    expect((await local(page, failing)).runNow).toBe(true)
  })
})

test.describe('the inbox, the Outbox, a sign-in (T-P2-6)', () => {
  const inbox = (page: Page) => pf(page, (p) => Object.fromEntries(p.stores.inbox.getState().data.items.map((i: AnyState) => [i.id, { read: !!i.read, archived: !!i.archived }])))

  test('inbox: A marks read, D archives, Z brings each back (an archived item unread again); O opens it', async ({ page }) => {
    await start(page)
    const notes = await createPage(page, { title: 'Schichtnotizen' })
    for (const text of ['Mara Lind fragt nach dem Prüfplan.', 'Ivo Brandt hat geantwortet.', 'Oda Wendt braucht die Messreihe.']) {
      await page.evaluate((a) => (window as AnyState).__oneOutbox.addAgentNote(a.page, 'ag-spiegel', a.text), { page: notes, text })
      await page.waitForTimeout(20)
    }
    await page.evaluate(() => (window.location.hash = '#/'))
    await expect.poll(() => count(page, 'inbox')).toBe(3)
    await openLamp(page, 'inbox')
    const a = (await card(page).getAttribute('data-id'))!
    await ready(page, a)
    await expect(card(page).locator('.pf-quote')).toHaveText(/^(Mara Lind|Ivo Brandt|Oda Wendt) /)
    await page.keyboard.press('a')
    await expect.poll(async () => (await inbox(page))[a]).toEqual({ read: true, archived: false })
    expect(await count(page, 'inbox')).toBe(2)
    await page.keyboard.press('z')
    await expect.poll(async () => (await inbox(page))[a]).toEqual({ read: false, archived: false })
    await expect(card(page)).toHaveAttribute('data-id', a)
    await ready(page, a)
    await page.keyboard.press('d')
    await expect.poll(async () => (await inbox(page))[a].archived).toBe(true)
    await page.keyboard.press('z')
    await expect.poll(async () => (await inbox(page))[a]).toEqual({ read: false, archived: false })
    await expect(card(page)).toHaveAttribute('data-id', a)
    // O opens its page; the card ends once the reading says so (read)
    await ready(page, a)
    await page.keyboard.press('o')
    await expect(page).toHaveURL(new RegExp(`#/p/${notes}`))
    await expect.poll(async () => (await inbox(page))[a].read).toBe(true)
    await page.evaluate(() => (window.location.hash = '#/'))
    await expect.poll(async () => (await q(page)).done.filter((d) => d.id === a && !d.undone).map((d) => d.outcome)).toEqual(['read'])
  })

  test('the Outbox: A opens the slip in the dock (in work, nothing sent here); marked sent there → the card leaves as by hand; D withdraws', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await start(page)
    const out = await seedMorning(page, { parts: ['relay', 'mirror', 'slip'] })
    const second = await page.evaluate(async (row) => (await (window as AnyState).__oneOutbox.stageSlip({ route: { profileId: 'tessera', routeId: 'reply' }, rowId: row, draft: 'Der Prüfplan P3 gilt.', origin: { kind: 'api' }, sources: [] })).slip.id, out.mirror.rows['NL-202'])
    const slipState = (id: string) => page.evaluate((id) => (window as AnyState).__oneOutbox.getSlips().find((s: AnyState) => s.id === id)?.state ?? null, id)
    await expect.poll(() => count(page, 'outbox')).toBe(2)
    await openLamp(page, 'outbox')
    const first = `slip:${out.slip}`
    await pick(page, first)
    await ready(page, first)
    await page.keyboard.press('a')
    // it sends something out: VON HAND — the confirm key opens the slip, never sends it
    await expect(page.getByTestId('pf-confirm')).toContainText('sends something out')
    await page.keyboard.press('Enter')
    // the slip's database page with the dock focused on it
    const slip = page.getByTestId('outbox-dock').getByTestId('outbox-slip')
    await expect(slip).toHaveAttribute('data-slip', out.slip)
    expect(await slipState(out.slip)).toBe('ready')
    expect((await q(page)).inWork).toContain(first)
    // back on Start the card says "in work" until the Outbox says what became of it
    await page.goBack()
    await expect(card(page)).toHaveAttribute('data-id', first)
    await expect(card(page).locator('.pf-card__work')).toBeVisible()
    await page.goForward()
    // sent by hand in the Outbox: the card leaves, by hand
    await expect(slip).toHaveAttribute('data-slip', out.slip)
    await expect(slip.getByTestId('outbox-copy')).not.toHaveAttribute('aria-disabled', 'true')
    const popup = context.waitForEvent('page')
    await slip.getByTestId('outbox-copy').click()
    await (await popup).close().catch(() => undefined)
    await slip.getByTestId('outbox-mark-sent').click()
    await expect.poll(() => slipState(out.slip)).toBe('sent')
    await page.evaluate(() => (window.location.hash = '#/'))
    await expect.poll(async () => (await q(page)).done.find((d) => d.id === first)?.outcome ?? null).toBe('hand')
    expect((await q(page)).inWork).not.toContain(first)
    // D withdraws the other one
    await pick(page, `slip:${second}`)
    await ready(page, `slip:${second}`)
    await page.keyboard.press('d')
    await expect.poll(() => slipState(second)).toBe('withdrawn')
    await expect.poll(async () => (await q(page)).done.find((d) => d.id === `slip:${second}`)?.outcome ?? null).toBe('discarded')
  })

  test('a refused sign-in: ↵ on the confirm key opens exactly one window', async ({ page, context, errors }) => {
    // the mocked MCP server answers 401 until a token exists (its sign-in reads the metadata from there)
    errors.allow(/401/)
    await start(page)
    await mockOAuth(context)
    await wsEval(
      page,
      (s, a) =>
        s.updateSettings({
          mcpServers: [{ id: 'srvoauth01', name: 'oauthy', url: a.url, token: '', enabled: true, prompt: '', checkedAt: Date.now(), checkAuth: true, checkError: 'The server rejected the token.', oauth: { issuer: a.auth, authorizationEndpoint: `${a.auth}/authorize`, tokenEndpoint: `${a.auth}/token`, clientId: 'one-e2e-client', redirectUri: `${location.origin}${location.pathname}?oauth=mcp`, resource: a.url } }],
        }),
      { url: MCP_URL, auth: AUTH },
    )
    await page.evaluate(() => (window.location.hash = '#/'))
    await expect.poll(() => count(page, 'token')).toBe(1)
    let popups = 0
    context.on('page', () => popups++)
    await openLamp(page, 'token')
    const id = (await card(page).getAttribute('data-id'))!
    await ready(page, id)
    await page.keyboard.press('a')
    await expect(page.getByTestId('pf-confirm')).toContainText('a sign-in')
    expect(popups).toBe(0)
    const popup = context.waitForEvent('page')
    await page.keyboard.press('Enter')
    await popup
    await page.waitForTimeout(1500)
    expect(popups).toBe(1)
  })
})

test.describe('touch (T-P2-8)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  type Cdp = Awaited<ReturnType<ReturnType<Page['context']>['newCDPSession']>>
  const touch = (cdp: Cdp, type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number, y?: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: x!, y: y! }] })
  async function drag(page: Page, cdp: Cdp, from: { x: number; y: number }, to: { x: number; y: number }, ms = 240): Promise<void> {
    const steps = 10
    await touch(cdp, 'touchStart', from.x, from.y)
    for (let i = 1; i <= steps; i++) {
      await touch(cdp, 'touchMove', from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps)
      await page.waitForTimeout(ms / steps)
    }
    await touch(cdp, 'touchEnd')
  }
  /** Bring a box to `y` (a wheel turn: the shell's scroll hold takes only the person's input). */
  async function bringTo(page: Page, sel: ReturnType<typeof card>, y: number): Promise<{ x: number; y: number; width: number; height: number }> {
    for (let i = 0; i < 6; i++) {
      const b = (await sel.boundingBox())!
      const d = b.y - y
      if (Math.abs(d) < 12) return b
      await page.mouse.move(195, 420)
      await page.mouse.wheel(0, d)
      await page.waitForTimeout(150)
    }
    return (await sel.boundingBox())!
  }

  test('→ applies a clean card; a vertical drag scrolls; a swipe on the title opens nothing; → on VON HAND opens the confirm row; a swipe right after a toast’s key closed it is ignored; tabs scroll with the fade; keys ≥ 40 px', async ({ page }) => {
    await start(page)
    const m = await seedMirror(page)
    await seedRuns(page, m)
    await seedTerminal(page)
    await seedMorning(page, { parts: ['relay'] })
    await page.evaluate(() => (window.location.hash = '#/'))
    await flushLamps(page)
    await openLamp(page, 'proposals')
    await ready(page, 'run:r-now#c1')
    const cdp = await page.context().newCDPSession(page)

    // → on a clean card: applied
    let b = await bringTo(page, card(page), 160)
    await drag(page, cdp, { x: b.x + 40, y: b.y + b.height / 2 }, { x: b.x + 240, y: b.y + b.height / 2 })
    await expect.poll(() => runStatus(page, m.mirrorId, 'r-now', 'c1')).toBe('applied')
    await ready(page, 'run:r-now#c2')

    // a vertical drag scrolls the page and applies nothing
    b = await bringTo(page, card(page), 300)
    await drag(page, cdp, { x: b.x + 60, y: b.y + 80 }, { x: b.x + 70, y: b.y - 120 }, 300)
    await page.waitForTimeout(300)
    const after = (await card(page).boundingBox())!
    expect(Math.abs(after.y - b.y)).toBeGreaterThan(40)
    expect(await runStatus(page, m.mirrorId, 'r-now', 'c2')).toBe('pending')

    // a swipe that starts on the title: applied, and the tap under it opens nothing
    const title = card(page).locator('.pf-card__title')
    const tb = await bringTo(page, title as unknown as ReturnType<typeof card>, 200)
    await drag(page, cdp, { x: tb.x + 10, y: tb.y + tb.height / 2 }, { x: tb.x + 220, y: tb.y + tb.height / 2 })
    await expect.poll(() => runStatus(page, m.mirrorId, 'r-now', 'c2')).toBe('applied')
    await expect(page.locator('.peek')).toHaveCount(0)
    expect(new URL(page.url()).hash).toBe('#/')

    // → on a VON HAND card opens its confirm row, applies nothing
    const hand = (await pf(page, (p) => p.stores.queue.getState().items.proposals?.find((i: AnyState) => i.kind === 'terminal')?.id ?? null))!
    await pick(page, hand)
    await ready(page, hand)
    b = await bringTo(page, card(page), 160)
    await drag(page, cdp, { x: b.x + 40, y: b.y + 30 }, { x: b.x + 240, y: b.y + 30 })
    await expect(page.getByTestId('pf-confirm')).toBeVisible()
    expect(await pf(page, (p) => p.stores.agent.getState().changes[0].status)).toBe('pending')
    await page.getByTestId('pf-confirm').getByRole('button').last().click()

    // a swipe right after a toast's key closed it (the same finger, on that key's spot) is the rest of that tap
    await pick(page, 'run:r-now#c3')
    await ready(page, 'run:r-now#c3')
    await page.evaluate(() => (window as AnyState).__one.ui.getState().toast({ message: 'Notiz', timeout: 20_000, action: { label: 'OK', run: () => undefined } }))
    const key = page.locator('.toast').getByRole('button', { name: 'OK' })
    const kb = (await key.boundingBox())!
    b = await bringTo(page, card(page), kb.y - 40)
    const spot = { x: kb.x + kb.width / 2, y: kb.y + kb.height / 2 }
    expect(spot.y > b.y && spot.y < b.y + b.height).toBe(true)
    await touch(cdp, 'touchStart', spot.x, spot.y)
    await touch(cdp, 'touchEnd')
    await expect(page.locator('.toast')).toHaveCount(0)
    await drag(page, cdp, spot, { x: Math.min(spot.x + 200, 380), y: spot.y }, 120)
    await page.waitForTimeout(400)
    expect(await runStatus(page, m.mirrorId, 'r-now', 'c3')).toBe('pending')
    // the same swipe a moment later is the person's own
    await page.waitForTimeout(300)
    b = await bringTo(page, card(page), 160)
    await drag(page, cdp, { x: b.x + 30, y: b.y + 30 }, { x: b.x + 260, y: b.y + 30 })
    await expect.poll(() => runStatus(page, m.mirrorId, 'r-now', 'c3')).toBe('applied')

    // the tab strip scrolls under a fading edge; every key is a finger's size
    const strip = await queue(page).locator('.pf-tabs').evaluate((el) => {
      const cs = getComputedStyle(el)
      return { overflow: cs.overflowX, mask: cs.maskImage || (cs as unknown as Record<string, string>).webkitMaskImage || '', more: el.scrollWidth > el.clientWidth }
    })
    expect(strip.overflow).toMatch(/auto|scroll/)
    expect(strip.mask).toContain('linear-gradient')
    const small = await page.locator('.pf-q .pf-key, .pf-q .pf-tab, .pf-q .pf-qr').evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent && e.getBoundingClientRect().height < 40).map((e) => e.className))
    expect(small).toEqual([])
  })
})
