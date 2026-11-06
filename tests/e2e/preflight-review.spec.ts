/**
 * Preflight P2 — the review's regressions: ⇧A's sheet applies only what was seen (an arrival while it is open stays);
 * a change merged in place is unseen again; Z takes back per card (a card changed since stays done, said so); the
 * terminal's "goes to Claude Code" on a task it created; opened cards reach the other tabs at once; a card counts as
 * shown only once its body rendered; the confirm card shows every hashed stage field; an AI-menu memory card that would
 * update a memory saved meanwhile refuses; the last card of a lamp hands over (badge, ring, aside, focus — never the
 * body); ANGESTAUBT counts again when cards are opened, in words for one; one lamp cursor; E only where it opens
 * something; the source tag never repeats the kind; the hand on the primary key; the card's own key words; the swipe
 * hint by the card's keys; the blink in unison; the sources never broken at XL; a task state another tab wrote wins
 * over a boot snapshot. Every name is fictional (tests/e2e/helpers/preflightStory.mjs); no request leaves the machine.
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval, createPage } from './fixtures'
import { STORY, flushLamps, seedMirror, seedPipeline, seedRuns, seedTerminal, waitPreflight } from './helpers/preflightStory.mjs'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const seam = <R, A = null>(page: Page, name: string, fn: (s: AnyState, arg: A) => R | Promise<R>, arg?: A): Promise<R> =>
  page.evaluate(({ name, src, arg }) => new Function('s', 'arg', `return (${src})(s, arg)`)((window as unknown as Record<string, AnyState>)[name], arg), { name, src: fn.toString(), arg: (arg ?? null) as A }) as Promise<R>
const pf = <R, A = null>(page: Page, fn: (s: AnyState, arg: A) => R | Promise<R>, arg?: A) => seam(page, '__onePreflight', fn, arg)

const cap = (page: Page, id: string) => page.locator(`.pf-cap[data-lamp="${id}"]`)
const card = (page: Page) => page.locator('.pf-q article.pf-card[data-current]')
const queue = (page: Page) => page.getByTestId('pf-queue')
const tab = (page: Page, id: string) => queue(page).locator(`.pf-tab[data-lamp="${id}"]`)
const live = (page: Page) => page.getByTestId('pf-live')
const q = (page: Page) =>
  pf(page, (p) => {
    const s = p.stores.queue.getState()
    return { lamp: s.lamp, aside: s.aside, card: s.card, done: s.done.map((e: AnyState) => ({ id: e.id, undone: !!e.undone, undo: !!e.undo, final: e.final ?? null, batch: e.batch ?? null })), bulk: s.bulk, viewed: Object.keys(s.viewed) }
  })
const runStatus = (page: Page, agent: string, run: string, change: string) =>
  pf(page, async (p, a) => (await p.stores.agentRuns.getState().byAgent[a.agent])?.find((r: AnyState) => r.id === a.run)?.staged?.find((c: AnyState) => c.id === a.change)?.status ?? null, { agent, run, change })
const items = (page: Page) => pf(page, (p) => (p.stores.queue.getState().items.proposals ?? []).map((i: AnyState) => i.id))

async function start(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
  await page.context().route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort())
  await openApp(page)
  await waitPreflight(page)
}

async function openLamp(page: Page, id: string): Promise<void> {
  await cap(page, id).focus()
  await page.keyboard.press('Enter')
  await expect(tab(page, id)).toHaveAttribute('aria-selected', 'true')
  await expect(card(page)).toBeFocused()
}

async function ready(page: Page, id: string): Promise<void> {
  await expect(card(page)).toHaveAttribute('data-id', id)
  await expect(card(page)).not.toHaveAttribute('aria-busy', 'true')
}

/** The card is current and its body rendered: shown in full (⇧A may take it as it is). */
async function shown(page: Page, id: string): Promise<void> {
  await ready(page, id)
  await expect.poll(async () => (await q(page)).viewed).toContain(id)
}

/** The bulk sheet is up and every body in it rendered (its key usable). */
async function sheetReady(page: Page, n: number): Promise<void> {
  await expect(page.getByTestId('pf-bulk').locator('.pf-bulk__item')).toHaveCount(n)
  await expect(page.getByTestId('pf-bulk')).not.toHaveAttribute('aria-busy', 'true')
  await expect(page.getByTestId('pf-bulk-apply')).not.toHaveAttribute('aria-disabled', 'true')
}

/** Record every animation frame whether focus rests on the body (until stopped). */
const traceFocus = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __pfFocus: string[]; __pfFocusOn: boolean }
    w.__pfFocus = []
    w.__pfFocusOn = true
    const tick = () => {
      if (!w.__pfFocusOn) return
      const a = document.activeElement
      w.__pfFocus.push(!a || a === document.body ? 'BODY' : (a as HTMLElement).className || a.tagName)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
const stopTrace = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __pfFocus: string[]; __pfFocusOn: boolean }
    w.__pfFocusOn = false
    return w.__pfFocus
  })

/** One browser run of the mirror agent with clean update_row changes on the given rows. */
async function seedRun(page: Page, m: AnyState, id: string, keys: string[], at = Date.now() - 5 * 60_000, summary = ''): Promise<void> {
  const run = {
    id,
    agentId: m.mirrorId,
    runner: 'browser',
    trigger: { type: 'schedule', detail: 'schedule 07:30' },
    startedAt: at,
    endedAt: at + 60_000,
    status: 'staged',
    summary,
    steps: [],
    staged: keys.map((key, i) => ({ id: `c${i + 1}`, n: i + 1, kind: 'update_row', status: 'pending', pageId: m.rows[key], databaseId: m.dbId, title: key, props: [{ propId: m.props.comments, name: 'Kommentare', type: 'number', before: 0, after: 11 + i, intent: { kind: 'value', value: 11 + i } }] })),
  }
  await pf(page, (p, runs) => p.seedRuns(runs), [run])
}

test.describe('⇧A and what was seen (review S1, S2, S8)', () => {
  test('the sheet’s key applies what it showed and what was shown before — a card arriving while it is open stays, said so', async ({ page }) => {
    await start(page)
    const m = await seedMirror(page)
    await seedRuns(page, m)
    await page.evaluate(() => (window.location.hash = '#/'))
    await flushLamps(page)
    await openLamp(page, 'proposals')
    await shown(page, 'run:r-now#c1')
    await page.keyboard.press('j')
    await shown(page, 'run:r-now#c2')
    await page.keyboard.press('Shift+A')
    await sheetReady(page, 3)
    // a scheduled run stages a clean change while the sheet is open
    await seedRun(page, m, 'r-late', ['NL-208'])
    await flushLamps(page)
    await expect.poll(() => items(page)).toContain('run:r-late#c1')
    await expect(page.getByTestId('pf-bulk-apply')).toBeFocused()
    await page.keyboard.press('Enter')
    for (const c of ['c1', 'c2', 'c3', 'c4']) await expect.poll(() => runStatus(page, m.mirrorId, 'r-now', c)).toBe('applied')
    await expect.poll(() => runStatus(page, m.reportId, 'r-rep', 'c1')).toBe('applied')
    // never shown: not applied, and the live region says so
    await page.waitForTimeout(400)
    expect(await runStatus(page, m.mirrorId, 'r-late', 'c1')).toBe('pending')
    await expect(live(page)).toContainText('not applied')
    expect((await q(page)).done.some((d) => d.id === 'run:r-late#c1')).toBe(false)
  })

  test('a terminal change merged in place after it was shown is unseen again: ⇧A shows it first, applies nothing', async ({ page }) => {
    await start(page)
    const notes = await createPage(page, { title: 'Schichtnotizen' })
    const other = await createPage(page, { title: 'Messreihe Linie 2' })
    const changes = [
      { id: 'c1', n: 1, kind: 'append', status: 'pending', pageId: notes, title: 'Schichtnotizen', markdown: 'Linie 2 läuft im kurzen Takt.' },
      { id: 'c2', n: 2, kind: 'append', status: 'pending', pageId: other, title: 'Messreihe Linie 2', markdown: 'Wert 1: 0,2 mm' },
    ]
    await pf(page, (p, changes) => p.terminal({ changes }), changes)
    await page.evaluate(() => (window.location.hash = '#/'))
    await flushLamps(page)
    await openLamp(page, 'proposals')
    const first = (await card(page).getAttribute('data-id'))!
    await shown(page, first)
    await page.keyboard.press('j')
    const second = (await card(page).getAttribute('data-id'))!
    expect(second).not.toBe(first)
    await shown(page, second)
    // the terminal merges more into the first one (same id, new content)
    await pf(page, (p, a) => p.terminal({ changes: [{ ...a.changes[0], markdown: 'Linie 2 läuft im kurzen Takt. Linie 3 steht seit 06:10.' }, a.changes[1]] }), { changes })
    await page.keyboard.press('Shift+A')
    await sheetReady(page, 1)
    await expect(page.getByTestId('pf-bulk').locator('.pf-bulk__item')).toHaveAttribute('data-id', first)
    await expect(page.getByTestId('pf-bulk')).toContainText('Linie 3 steht seit 06:10.')
    expect(await pf(page, (p) => p.stores.agent.getState().changes.map((c: AnyState) => c.status))).toEqual(['pending', 'pending'])
  })

  test('a card whose body is still loading is not shown in full: ⇧A puts it on the sheet, whose key waits for every body', async ({ page }) => {
    await start(page)
    const m = await seedMirror(page)
    await seedRuns(page, m)
    // the agents' body code arrives late
    let release: () => void = () => {}
    const held = new Promise<void>((r) => (release = r))
    await page.route(/\/RunHistory-[^/]*\.js$/, async (route) => {
      await held
      await route.continue()
    })
    await page.evaluate(() => (window.location.hash = '#/'))
    await flushLamps(page)
    await openLamp(page, 'proposals')
    await expect(card(page)).toHaveAttribute('data-id', 'run:r-now#c1')
    await expect(card(page).locator('.pf-card__wait')).toBeVisible()
    await page.keyboard.press('j')
    await expect(card(page)).toHaveAttribute('data-id', 'run:r-now#c2')
    await page.waitForTimeout(300)
    expect((await q(page)).viewed).toEqual([])
    // the sheet opens with every clean card; its key says "still reading" until the bodies are there
    await page.keyboard.press('Shift+A')
    await expect(page.getByTestId('pf-bulk').locator('.pf-bulk__item')).toHaveCount(5)
    await expect(page.getByTestId('pf-bulk-apply')).toHaveAttribute('aria-disabled', 'true')
    await page.keyboard.press('Enter')
    await expect(live(page)).toContainText('still reading')
    expect(await runStatus(page, m.mirrorId, 'r-now', 'c1')).toBe('pending')
    release()
    await sheetReady(page, 5)
  })
})

test.describe('Z per card (review S3, S4)', () => {
  test('a batch: a card changed since stays done (kept, said so, no Bordbuch undo), the others come back; the next Z says why it stays', async ({ page }) => {
    await start(page)
    const m = await seedMirror(page)
    await seedRun(page, m, 'r-one', ['NL-201', 'NL-202', 'NL-203'])
    await page.evaluate(() => (window.location.hash = '#/'))
    await flushLamps(page)
    await openLamp(page, 'proposals')
    await shown(page, 'run:r-one#c1')
    await page.keyboard.press('Shift+A')
    await sheetReady(page, 2)
    await page.keyboard.press('Enter')
    for (const c of ['c1', 'c2', 'c3']) await expect.poll(() => runStatus(page, m.mirrorId, 'r-one', c)).toBe('applied')
    // the first row is edited by hand after the apply
    await wsEval(page, (s, a) => s.setRowProperty(a.row, a.prop, 99), { row: m.rows['NL-201'], prop: m.props.comments })
    // the keyboard is where the last card left it (MASTER CAUTION once the lamp went dark): Z works from there
    expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true)
    await page.keyboard.press('z')
    await expect.poll(() => runStatus(page, m.mirrorId, 'r-one', 'c2')).toBe('pending')
    await expect.poll(() => runStatus(page, m.mirrorId, 'r-one', 'c3')).toBe('pending')
    expect(await runStatus(page, m.mirrorId, 'r-one', 'c1')).toBe('applied')
    expect(await wsEval(page, (s, a) => s.pages[a.row].properties[a.prop], { row: m.rows['NL-201'], prop: m.props.comments })).toBe(99)
    await expect(live(page)).toContainText('Undone (2)')
    await expect(live(page)).toContainText('1 changed since, kept')
    const done = (await q(page)).done
    expect(done.find((d) => d.id === 'run:r-one#c1')).toMatchObject({ undone: false, undo: false, final: 'features.preflight.card.final.kept' })
    expect(done.filter((d) => d.undone).map((d) => d.id).sort()).toEqual(['run:r-one#c2', 'run:r-one#c3'])
    const log = (await pf(page, (p) => p.log())) as AnyState[]
    expect(log.filter((e) => e.k === 'undo').map((e) => e.item).sort()).toEqual(['run:r-one#c2', 'run:r-one#c3'])
    // the kept card is the newest entry still done: Z says why and does nothing
    await expect(card(page)).toBeFocused()
    await page.keyboard.press('z')
    await expect(live(page)).toContainText('changed since · it stays done')
    expect(await runStatus(page, m.mirrorId, 'r-one', 'c1')).toBe('applied')
  })
})

test.describe('the terminal, memory, coding (review S6, S9, S10, U9–U11)', () => {
  test('an append to a task the terminal created in the same batch goes to Claude Code: VON HAND once the task exists', async ({ page }) => {
    await start(page)
    const pipe = (await seedPipeline(page)) as AnyState
    await pf(page, (p, db) => p.terminal({ changes: [
      { id: 'c1', n: 1, kind: 'create_row', status: 'pending', pageId: 'staged-task-9', databaseId: db, title: 'Taktzeit Station 4', props: [] },
      { id: 'c2', n: 2, kind: 'append', status: 'pending', pageId: 'staged-task-9', title: 'Taktzeit Station 4', markdown: 'Bitte die Station 4 zuerst messen.', dependsOn: 'c1' },
    ] }), pipe.dbId)
    await page.evaluate(() => (window.location.hash = '#/'))
    await flushLamps(page)
    await openLamp(page, 'proposals')
    const termId = (cid: string) => pf(page, (p, cid) => p.stores.queue.getState().items.proposals?.find((i: AnyState) => i.refs.changeId === cid)?.id ?? null, cid)
    const c1 = (await termId('c1'))!
    await ready(page, c1)
    await page.keyboard.press('a')
    await expect.poll(() => pf(page, (p) => p.stores.agent.getState().changes[0].status)).toBe('applied')
    const c2 = (await termId('c2'))!
    // the only card left: it becomes the current one
    await ready(page, c2)
    await expect(card(page).locator('.pf-card__head .pf-hand')).toBeVisible()
    await card(page).focus()
    await page.keyboard.press('a')
    await expect(page.getByTestId('pf-confirm')).toContainText('goes to the coding agent')
    expect(await pf(page, (p) => p.stores.agent.getState().changes[1].status)).toBe('pending')
  })

  test('the terminal’s coding card names the card’s own keys; its head shows kind and source once each', async ({ page }) => {
    await start(page)
    await seedTerminal(page)
    await page.evaluate(() => (window.location.hash = '#/'))
    await flushLamps(page)
    await openLamp(page, 'proposals')
    const id = (await pf(page, (p) => p.stores.queue.getState().items.proposals?.find((i: AnyState) => i.kind === 'terminal')?.id ?? null))!
    if ((await card(page).getAttribute('data-id')) !== id) await queue(page).locator(`.pf-qr[data-id="${id}"]`).click()
    await ready(page, id)
    await expect(card(page).getByTestId('term-coding-starts')).toContainText('A, then Confirm')
    await expect(card(page).getByTestId('term-coding-starts')).not.toContainText('Apply, or ↵')
    // the memory card of the same terminal: "Memory" once, its source "Terminal"
    const mem = (await pf(page, (p) => p.stores.queue.getState().items.proposals?.find((i: AnyState) => i.kind === 'memory')?.id ?? null))!
    await queue(page).locator(`.pf-qr[data-id="${mem}"]`).click()
    await ready(page, mem)
    const tags = await card(page).locator('.pf-card__head .pf-tag').allTextContents()
    expect(tags.map((s) => s.trim())).toEqual(['Memory', 'Terminal'])
  })

  test('an AI-menu memory card refuses when a memory it would update was saved after it was read; read again it updates that one, VON HAND', async ({ page }) => {
    await start(page)
    const memoryRows = (text: string) => wsEval(page, (s, text) => (Object.values(s.pages) as AnyState[]).filter((p) => p.title === text && !p.trashed).length, text)
    const proposal = (text: string) => ({ type: 'fact', text, topics: ['werk'], body: '', source: 'AI menu · Schichtnotizen' })
    const run = (id: string, text: string, ago: number) => ({ id, scope: 'local:local', pageId: 'none', req: { kind: 'memory', label: 'Remember', code: 'MEM', text, from: 'selection' }, status: 'done', output: '', sources: [], mcpCalls: [], error: null, issue: null, table: null, target: { from: 0, to: 0, lost: true }, startedAt: Date.now() - ago, finishedAt: Date.now() - ago + 5000, seen: true, proposals: [proposal(text)] })
    const older = 'Linie 2 läuft im kurzen Takt bis zum Audit.'
    const newer = 'Linie 2 läuft im kurzen Takt bis zum Audit im November.'
    await pf(page, (p, r) => p.stores.aiRuns.setState((s: AnyState) => ({ runs: { ...s.runs, [r.id]: r } })), run('mr1', newer, 60_000))
    await page.evaluate(() => (window.location.hash = '#/'))
    await flushLamps(page)
    await openLamp(page, 'proposals')
    await ready(page, 'airun:mr1')
    // read: nothing to update yet — a plain save
    await expect(card(page).locator('.pf-card__head .pf-hand')).toHaveCount(0)
    // meanwhile a near-identical memory is saved (another AI-menu run, saved from its panel)
    await pf(page, (p, r) => p.stores.aiRuns.setState((s: AnyState) => ({ runs: { ...s.runs, [r.id]: r } })), run('mr0', older, 120_000))
    await page.evaluate(() => (window as AnyState).__oneMemory.saveRunMemory('mr0', { toast: false }))
    await expect.poll(() => memoryRows(older)).toBe(1)
    await card(page).focus()
    await page.keyboard.press('a')
    await expect(card(page).locator('.pf-card__error')).toContainText('Changed since')
    expect(await memoryRows(older)).toBe(1)
    expect(await memoryRows(newer)).toBe(0)
    // read again: it would update that memory — VON HAND
    await card(page).locator('.pf-card__error button').click()
    await ready(page, 'airun:mr1')
    await expect(card(page).locator('.pf-card__head .pf-hand')).toBeVisible()
    await card(page).focus()
    await page.keyboard.press('a')
    await expect(page.getByTestId('pf-confirm-key')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(() => memoryRows(newer)).toBe(1)
    expect(await memoryRows(older)).toBe(0)
  })

  test('the confirm card shows every stage field the version hashes and the title; a gate card names its project once; the hand on the primary key takes its ink', async ({ page }) => {
    await start(page)
    await page.waitForFunction(() => !!(window as AnyState).__oneCoding)
    const pipe = (await seedPipeline(page)) as AnyState
    const [task] = pipe.tasks
    await wsEval(page, (s, id) => s.updatePage(id, { updatedBy: 'agent:ag-fiktiv' }), task)
    await page.evaluate(() => (window.location.hash = '#/'))
    await pf(page, (p) => p.stores.coding.setState({ enabled: true }))
    const gateIds = async () => {
      await flushLamps(page)
      return pf(page, (p) => p.readings().gate?.ids ?? []) as Promise<string[]>
    }
    await expect.poll(async () => (await gateIds()).find((id) => id.startsWith(`task:${task}:confirm@`)) ?? null, { timeout: 15_000 }).not.toBeNull()
    const confirmId = (await gateIds()).find((id) => id.startsWith(`task:${task}:confirm@`))!
    await openLamp(page, 'gate')
    if ((await card(page).getAttribute('data-id')) !== confirmId) await queue(page).locator(`.pf-qr[data-id="${confirmId}"]`).click()
    await ready(page, confirmId)
    const version = card(page).getByTestId('pf-version')
    await expect(version).toContainText(STORY.tasks[0])
    const stages = card(page).getByTestId('pf-version-stages')
    await expect(stages).toBeVisible()
    await expect(stages).toContainText('Git action:')
    await expect(stages).toContainText('Claude Code mode:')
    // the head: the kind word once, then the project
    const tags = (await card(page).locator('.pf-card__head .pf-tag').allTextContents()).map((s) => s.trim())
    expect(tags).toEqual(['Confirm', STORY.pipeline])
    // the VON HAND hand on the primary key is drawn in the key's own ink
    const ink = await card(page).locator('.btn--primary.pf-key').first().evaluate((b) => {
      const hand = b.querySelector('.pf-key__hand')
      return hand ? { hand: getComputedStyle(hand).color, key: getComputedStyle(b).color } : null
    })
    expect(ink).not.toBeNull()
    expect(ink!.hand).toBe(ink!.key)
  })
})

test.describe('the last card of a lamp, ANGESTAUBT, the cursor, E (review U1–U5, U8)', () => {
  test('the last card gone: the next lamp takes the queue, the dark cap keeps no badge and no ring, the aside follows — focus never on the body', async ({ page }) => {
    await start(page)
    const m = await seedMirror(page)
    await seedRun(page, m, 'r-one', ['NL-201'])
    await seedPipeline(page)
    await page.evaluate(() => (window.location.hash = '#/'))
    await flushLamps(page)
    await openLamp(page, 'proposals')
    await ready(page, 'run:r-one#c1')
    await traceFocus(page)
    await page.keyboard.press('d')
    await expect.poll(() => runStatus(page, m.mirrorId, 'r-one', 'c1')).toBe('discarded')
    await expect.poll(async () => (await q(page)).lamp).not.toBe('proposals')
    const next = (await q(page)).lamp
    expect(next).toBeTruthy()
    await expect(tab(page, next!)).toHaveAttribute('aria-selected', 'true')
    await expect(card(page)).toBeFocused()
    await page.waitForTimeout(300)
    const trace = await stopTrace(page)
    expect(trace.filter((x) => x === 'BODY'), `focus per frame: ${trace.join(' ')}`).toEqual([])
    // the dark proposals cap: no open badge, no cursor ring; the aside shows the lamp the queue went on with
    await expect(cap(page, 'proposals').locator('.pf-cap__open')).toHaveCount(0)
    await expect(cap(page, 'proposals')).not.toHaveAttribute('data-cursor', '')
    expect((await q(page)).aside).toBe(next)
    await expect(page.getByTestId('pf-rule')).toHaveAttribute('data-lamp', next!)
  })

  test('nothing lit after the last card: the keyboard goes to MASTER CAUTION, never the body', async ({ page }) => {
    await start(page)
    const m = await seedMirror(page)
    await seedRun(page, m, 'r-one', ['NL-201'])
    await page.evaluate(() => (window.location.hash = '#/'))
    await flushLamps(page)
    const others = await pf(page, (p) => p.state().views.filter((v: AnyState) => v.id !== 'proposals' && (v.level === 'amber' || v.level === 'red')).map((v: AnyState) => v.id))
    expect(others).toEqual([])
    await openLamp(page, 'proposals')
    await ready(page, 'run:r-one#c1')
    await traceFocus(page)
    await page.keyboard.press('d')
    await expect.poll(() => runStatus(page, m.mirrorId, 'r-one', 'c1')).toBe('discarded')
    await expect(page.locator('[data-testid="pf-mkey-strip"], [data-testid="pf-cover-amber"]').first()).toBeFocused()
    await page.waitForTimeout(400)
    const trace = await stopTrace(page)
    expect(trace.filter((x) => x === 'BODY'), `focus per frame: ${trace.join(' ')}`).toEqual([])
    // Z from there brings it back
    await page.keyboard.press('z')
    await expect.poll(() => runStatus(page, m.mirrorId, 'r-one', 'c1')).toBe('pending')
  })

  test('ANGESTAUBT counts again when its cards are opened, in words for one; a single key "Discard"', async ({ page }) => {
    await start(page)
    const m = await seedMirror(page)
    await seedRuns(page, m)
    await page.evaluate(() => (window.location.hash = '#/'))
    await flushLamps(page)
    await openLamp(page, 'proposals')
    await ready(page, 'run:r-now#c1')
    await expect(page.getByTestId('pf-stale')).toContainText('3 proposals untouched for 8–11 days')
    // open the two oldest (they are the current card once each)
    for (const id of ['run:r-d11#c1', 'run:r-d10#c1']) {
      await queue(page).locator('.pf-stale__t').click()
      await expect.poll(async () => (await card(page).getAttribute('data-id')) ?? '').toMatch(/^run:r-d1[01]#c1$/)
      if ((await card(page).getAttribute('data-id')) !== id) await page.keyboard.press('j')
      await expect(card(page)).toHaveAttribute('data-id', id)
    }
    await queue(page).locator(`.pf-qr[data-id="run:r-now#c1"]`).click()
    await ready(page, 'run:r-now#c1')
    const stale = page.getByTestId('pf-stale')
    await expect(stale).toContainText('1 proposal untouched for 8 days, never opened')
    await expect(stale).not.toContainText('8–8')
    await expect(stale.getByRole('button', { name: /Discard/ })).toHaveText(/^X\s*Discard$/)
    // X discards exactly the one it names
    await stale.getByRole('button', { name: /Discard/ }).click()
    await expect.poll(() => runStatus(page, m.mirrorId, 'r-d8', 'c1')).toBe('discarded')
    expect(await runStatus(page, m.mirrorId, 'r-d10', 'c1')).toBe('pending')
    expect(await runStatus(page, m.mirrorId, 'r-d11', 'c1')).toBe('pending')
  })

  test('one lamp cursor: after Esc from a queue and arrows on the plate, only the cap with focus wears the ring', async ({ page }) => {
    await start(page)
    const m = await seedMirror(page)
    await seedRuns(page, m)
    await seedPipeline(page)
    await page.evaluate(() => (window.location.hash = '#/'))
    await flushLamps(page)
    await openLamp(page, 'proposals')
    await page.keyboard.press('Escape')
    await expect(cap(page, 'proposals')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-lamp'))
    expect(focused).not.toBe('proposals')
    await expect(page.locator('.pf-cap[data-cursor]')).toHaveCount(1)
    await expect(page.locator('.pf-cap[data-cursor]')).toHaveAttribute('data-lamp', focused!)
    // focus leaves the plate: the ring goes back to the lamp picked
    await card(page).focus()
    await expect(page.locator('.pf-cap[data-cursor]')).toHaveCount(1)
    await expect(page.locator('.pf-cap[data-cursor]')).toHaveAttribute('data-lamp', 'proposals')
  })

  test('E only where the open body shows more: a run without a report has no E key (E says so); one with a report opens it', async ({ page }) => {
    await start(page)
    const m = await seedMirror(page)
    await seedRun(page, m, 'r-one', ['NL-201'], Date.now() - 10 * 60_000)
    await seedRun(page, m, 'r-two', ['NL-202'], Date.now() - 5 * 60_000, 'Zwei Zeilen geändert: NL-202 hat neue Kommentare.')
    await page.evaluate(() => (window.location.hash = '#/'))
    await flushLamps(page)
    await openLamp(page, 'proposals')
    await ready(page, 'run:r-one#c1')
    await expect(card(page).locator('.pf-key[data-key="e"]')).toHaveCount(0)
    await page.keyboard.press('e')
    await expect(live(page)).toContainText('shows everything already')
    await page.keyboard.press('j')
    await ready(page, 'run:r-two#c1')
    const e = card(page).locator('.pf-key[data-key="e"]')
    await expect(e).toContainText('Report')
    await page.keyboard.press('e')
    await expect(e).toHaveAttribute('aria-expanded', 'true')
    await expect(card(page).getByTestId('pf-run-report')).toContainText('NL-202 hat neue Kommentare.')
  })
})

test.describe('other tabs (review S7, I1)', () => {
  test('a card opened in one tab is known in the other at once — also when that tab closes within the second', async ({ page }) => {
    await start(page)
    const other = await page.context().newPage()
    await openApp(other)
    await waitPreflight(other)
    await other.evaluate(() => (window as AnyState).__onePreflight.markOpened('run:r-x#c1'))
    await other.close()
    await expect.poll(() => pf(page, (p) => p.openedNow('run:r-x#c1')), { timeout: 3000 }).toBe(true)
  })

  test('a task state written by another tab wins over the boot snapshot: no mix of both, and the lamps follow', async ({ page }) => {
    await start(page)
    await page.waitForFunction(() => !!(window as AnyState).__oneCoding)
    const pipe = (await seedPipeline(page)) as AnyState
    const task = pipe.tasks[0] as string
    const put = (value: AnyState) =>
      page.evaluate(
        ({ key, value }) =>
          new Promise<void>((resolve, reject) => {
            const open = indexedDB.open('one-coding')
            open.onupgradeneeded = () => open.result.createObjectStore('kv')
            open.onsuccess = () => {
              const tx = open.result.transaction('kv', 'readwrite')
              tx.objectStore('kv').put(value, key)
              tx.oncomplete = () => (open.result.close(), resolve())
              tx.onerror = () => reject(tx.error)
            }
            open.onerror = () => reject(open.error)
          }),
        { key: `local:local|task|${task}`, value },
      )
    const mem = () => pf(page, (p, id) => p.stores.codingLocal.getState().tasks[`local:local|${id}`] ?? null, task)
    await put({ state: 'question', question: 'Welche Grundlinie?', at: 1000 })
    // a new boot on Start: Preflight's lamps read the run states once (a snapshot); nothing else read the task yet
    await page.evaluate(() => (window.location.hash = '#/'))
    await page.reload()
    await waitPreflight(page)
    await flushLamps(page)
    await expect.poll(async () => (await mem())?.state ?? null).toBe('question')
    // the tab connected to the worker writes a newer state
    await put({ state: 'failed', error: 'Die Tests sind rot.', at: 2000 })
    // this tab opens #/coding (it reads the task): the stored state wins, no mix with the snapshot's question
    await page.evaluate(() => (window.location.hash = '#/coding'))
    await expect.poll(async () => (await mem())?.state ?? null).toBe('failed')
    expect((await mem()).question ?? null).toBe(null)
    expect((await mem()).at).toBe(2000)
    // and a write announced by another tab is read again
    await put({ state: 'idle', at: 3000 })
    await page.evaluate((a) => new BroadcastChannel('one-coding-tasks').postMessage(a), { scope: 'local:local', taskId: task })
    await expect.poll(async () => (await mem())?.state ?? null).toBe('idle')
  })
})

test.describe('motion and size (review U6, U7)', () => {
  test('the day’s first render: new lamps blink in unison, starting after the lamp test', async ({ page }) => {
    // when each cap's blink was first drawn and with which delay, and when the lamp test began and ended
    await page.addInitScript(() => {
      const w = window as unknown as { __pfFlash: Record<string, { t: number; d: number }>; __pfTest: { on: number; off: number } }
      w.__pfFlash = {}
      w.__pfTest = { on: 0, off: 0 }
      const note = (el: Element) => {
        const id = el.getAttribute('data-lamp') ?? ''
        if (!(id in w.__pfFlash)) w.__pfFlash[id] = { t: performance.now(), d: parseFloat((el as HTMLElement).style.getPropertyValue('--pf-flash-delay')) }
      }
      new MutationObserver((list) => {
        for (const m of list) {
          const el = m.target as HTMLElement
          if (!(el instanceof HTMLElement)) continue
          if (el.matches('.pf__grid')) {
            if (el.hasAttribute('data-test') && !w.__pfTest.on) w.__pfTest.on = performance.now()
            if (!el.hasAttribute('data-test') && w.__pfTest.on && !w.__pfTest.off) w.__pfTest.off = performance.now()
          }
          if (el.matches('.pf-cap[data-flash]')) note(el)
          for (const c of el.querySelectorAll('.pf-cap[data-flash]')) note(c)
        }
      }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-flash', 'data-test', 'style'] })
    })
    await start(page)
    // away from Start: three lamps lit at once (never drawn yet in this tab), then a new Preflight day
    await page.evaluate(() => (window.location.hash = '#/agents'))
    await pf(page, (p) => p.fakeLamps([{ id: 'u-a', legend: 'Probe\nA', count: 2 }, { id: 'u-b', legend: 'Probe\nB', count: 1 }, { id: 'u-c', legend: 'Probe\nC', count: 3 }]))
    await flushLamps(page)
    await pf(page, (p) => p.resetDay())
    // Start: the day's first full render — the lamp test, and the new lamps' blink after it (recorded from here)
    await page.evaluate(() => {
      const w = window as unknown as { __pfFlash: Record<string, unknown>; __pfTest: { on: number; off: number } }
      w.__pfFlash = {}
      w.__pfTest = { on: 0, off: 0 }
      window.location.hash = '#/'
    })
    const state = () => page.evaluate(() => {
      const w = window as unknown as { __pfFlash: Record<string, { t: number; d: number }>; __pfTest: { on: number; off: number } }
      return { flash: w.__pfFlash, test: w.__pfTest }
    })
    await expect.poll(async () => (await state()).test.off, { timeout: 15_000 }).toBeGreaterThan(0)
    const { flash, test: lampTest } = await state()
    // the caps drawn blinking while the lamp test ran all start together, after its all-amber phase (≥ 120 ms) — the
    // planned end of the test (its timers may lag on a busy machine; the blink's start is what was planned)
    const during = Object.entries(flash).filter(([, f]) => f.t <= lampTest.off)
    expect(during.length, JSON.stringify({ flash, lampTest })).toBeGreaterThan(1)
    for (const [id, f] of during) expect(f.d, `${id} ${JSON.stringify({ f, lampTest })}`).toBeGreaterThanOrEqual(100)
    const starts = during.map(([, f]) => f.t + f.d)
    expect(Math.max(...starts) - Math.min(...starts), JSON.stringify({ flash, lampTest })).toBeLessThanOrEqual(40)
  })

  test('the rule card’s sources at text size XL (German): a name and its count never break', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('one.textScale', '4')
    })
    await start(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const m = await seedMirror(page)
    await seedRuns(page, m)
    await seedTerminal(page)
    await page.evaluate(() => (window.location.hash = '#/'))
    await flushLamps(page)
    await openLamp(page, 'proposals')
    const srcs = page.getByTestId('pf-rule').locator('.pf-srcs__i')
    await expect(srcs.first()).toBeVisible()
    const broken = await srcs.evaluateAll((els) =>
      els.filter((e) => {
        const lh = parseFloat(getComputedStyle(e).lineHeight) || 16
        return e.getBoundingClientRect().height > lh * 1.5
      }).map((e) => e.textContent),
    )
    expect(broken).toEqual([])
    await expect(srcs.filter({ hasText: 'Gedächtnis' })).toHaveCount(1)
  })
})

test.describe('touch (review U12)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('the swipe hint names only the directions the card has a key for', async ({ page }) => {
    await start(page)
    await seedPipeline(page)
    await page.evaluate(() => (window.location.hash = '#/'))
    await flushLamps(page)
    await openLamp(page, 'gate')
    await expect(card(page).locator('.pf-card__swipe')).toBeVisible()
    await expect(card(page).locator('.pf-card__swipe')).toContainText('apply')
    await expect(card(page).locator('.pf-card__swipe')).not.toContainText('discard')
  })

  test('the open lamp keeps "↵ i/n" at phone width (standard text), clear of its legend (review U13)', async ({ page }) => {
    await start(page)
    const m = await seedMirror(page)
    await seedRuns(page, m)
    await page.evaluate(() => (window.location.hash = '#/'))
    await flushLamps(page)
    await openLamp(page, 'proposals')
    const badge = cap(page, 'proposals').locator('.pf-cap__open')
    await expect(badge).toHaveText(/^↵\s*1\/\d+$/)
    await expect(badge.locator('.pf-cap__pos')).toBeVisible()
    const clear = await cap(page, 'proposals').evaluate((c) => {
      const b = c.querySelector('.pf-cap__open')!.getBoundingClientRect()
      const r = document.createRange()
      r.selectNodeContents(c.querySelector('.pf-cap__legend > span')!)
      return [...r.getClientRects()].every((x) => x.right <= b.left || x.top >= b.bottom)
    })
    expect(clear).toBe(true)
  })
})
