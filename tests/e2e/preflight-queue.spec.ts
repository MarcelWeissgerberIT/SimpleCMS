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
import { test, expect, openApp, wsEval, createPage, MOD } from './fixtures'
import { flushLamps, seedMirror, seedMorning, seedPipeline, seedRuns, waitPreflight } from './helpers/preflightStory.mjs'

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
  await queue(page).locator(`.pf-qr[data-id="${id}"]`).click()
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
    const second = await card(page).getAttribute('data-id')
    expect(second).not.toBe(first)
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
    await expect(cap(page, 'proposals').locator('.pf-cap__open')).toHaveText('↵ 3/10')
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
