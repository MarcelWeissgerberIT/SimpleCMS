/**
 * Preflight (Vorflug-Check) P1 — the lamps on Start (T-P1-2 … T-P1-5): each built-in lamp lit from its seeded source
 * (the count asserted first) and absent where nothing is set up; grey with its fix; MASTER CAUTION and acknowledging;
 * keys only with focus in the plate; the plate modes, the lamp test and the bounded blink; the morning hold, off, ⌘K
 * and the Agents badge. The data is the fictional morning of tests/e2e/helpers/preflightStory.mjs.
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, waitForApp, wsEval, pageIdByTitle, preflightOff, MOD } from './fixtures'
import { STORY, flushLamps, seedMirror, seedMorning, seedPipeline, seedRelay, seedRuns, waitPreflight } from './helpers/preflightStory.mjs'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Run a function against window.__onePreflight. */
const pf = <R, A = null>(page: Page, fn: (p: AnyState, arg: A) => R | Promise<R>, arg?: A): Promise<R> =>
  page.evaluate(({ src, arg }) => new Function('p', 'arg', `return (${src})(p, arg)`)((window as unknown as { __onePreflight: AnyState }).__onePreflight, arg), { src: fn.toString(), arg: (arg ?? null) as A }) as Promise<R>

/** The readings after a flush (no idle wait). */
const readings = async (page: Page): Promise<Record<string, AnyState | null>> => {
  await flushLamps(page)
  return pf(page, (p) => p.readings())
}
const count = async (page: Page, id: string) => ((await readings(page))[id]?.count ?? null) as number | null

const cap = (page: Page, id: string) => page.locator(`.pf-cap[data-lamp="${id}"]`)
const plate = (page: Page) => page.getByTestId('pf-plate')
const strip = (page: Page) => page.getByTestId('pf-strip')
const home = (page: Page) => page.evaluate(() => (window.location.hash = '#/'))

async function start(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
  await openApp(page)
  await waitPreflight(page)
}

test.describe('Preflight — the lamps (T-P1-2)', () => {
  test('the morning lights its lamps (level, count, second line, chip); lamps without a source here are not fitted', async ({ page }) => {
    await start(page)
    // nothing set up yet: the always-fitted lamps only, all dark
    await home(page)
    const first = await readings(page)
    expect(first.proposals).toMatchObject({ count: 0 })
    expect(first.inbox).toMatchObject({ count: 0 })
    for (const id of ['gate', 'question', 'failed', 'token', 'worker', 'mirror', 'missed', 'sync', 'mail', 'cloud', 'outbox']) expect(first[id] ?? null, id).toBeNull()
    await expect(strip(page)).toBeVisible()

    await seedMorning(page)
    const r = await readings(page)
    expect(r.proposals).toMatchObject({ count: 10, parts: { mirror: 7, agent: 1, terminal: 1, memory: 1 } })
    expect(r.gate).toMatchObject({ count: 2 })
    expect(r.token).toMatchObject({ count: 1, level: 'red' })
    expect(r.outbox).toMatchObject({ count: 1 })
    expect(r.sync).toMatchObject({ state: 'off', why: 'features.preflight.lamp.sync.why.noAccess' })
    for (const id of ['worker', 'mail', 'cloud']) expect(r[id] ?? null, id).toBeNull()

    await expect(plate(page)).toBeVisible()
    await expect(cap(page, 'proposals')).toHaveAttribute('data-lit', 'amber')
    await expect(cap(page, 'proposals').locator('.pf-cap__n')).toHaveText('10')
    await expect(cap(page, 'proposals').locator('.pf-cap__src')).toHaveText('4 sources')
    await expect(cap(page, 'proposals').locator('.pf-cap__new')).toHaveText('new')
    await expect(cap(page, 'gate')).toHaveAttribute('data-lit', 'amber')
    await expect(cap(page, 'gate').locator('.pf-cap__n')).toHaveText('02')
    await expect(cap(page, 'token')).toHaveAttribute('data-lit', 'red')
    await expect(cap(page, 'token').locator('.pf-cap__warn')).toHaveCount(1)
    await expect(cap(page, 'token').locator('.pf-cap__src')).toHaveText('MCP · relay')
    await expect(cap(page, 'token')).toHaveAttribute('aria-label', 'Warning: Token refused, 1, new')
    await expect(cap(page, 'outbox')).toHaveAttribute('data-lit', 'amber')
    await expect(cap(page, 'sync')).toHaveAttribute('data-grey', 'true')
    await expect(cap(page, 'sync').locator('.pf-cap__n')).toHaveText('?')
    await expect(cap(page, 'sync')).toHaveAttribute('aria-label', 'Sync folder: grey, Folder access not granted in this tab')
    await expect(cap(page, 'inbox')).not.toHaveAttribute('data-lit', /.*/)
    await expect(cap(page, 'inbox')).toHaveAttribute('aria-label', 'Inbox: dark, all right')
    for (const id of ['worker', 'mail', 'cloud']) await expect(cap(page, id)).toHaveCount(0)
    // the head: lamps, cost 0 tokens
    await expect(plate(page).locator('.pf__head')).toContainText('0 tokens')
    // the grey lamp's rule card offers its fix
    await cap(page, 'sync').click()
    await expect(page.getByTestId('pf-rule')).toHaveAttribute('data-lamp', 'sync')
    await expect(page.getByTestId('pf-rule').getByRole('button', { name: 'Grant access' })).toBeVisible()
  })

  test('token: red from the last check and from a refusal in this tab; amber from another failed check', async ({ page }) => {
    await start(page)
    await seedRelay(page, { refused: false })
    await home(page)
    expect(await count(page, 'token')).toBe(0)
    await pf(page, (p) => p.refuse('relay'))
    await expect.poll(() => count(page, 'token')).toBe(1)
    expect((await readings(page)).token).toMatchObject({ level: 'red', ids: ['mcp:m-relay@'] })
    await expect(cap(page, 'token')).toHaveAttribute('data-lit', 'red')
    // another server whose check failed for another reason: amber while nothing is refused
    await wsEval(page, (s) => s.updateSettings({ mcpServers: [{ id: 'm-two', name: 'archiv', url: 'https://archiv.tessera.example/mcp', token: '', enabled: true, prompt: '', checkedAt: Date.now(), checkError: 'Zeitüberschreitung' }] }))
    await expect.poll(async () => (await readings(page)).token).toMatchObject({ count: 1, level: 'amber' })
    await expect(cap(page, 'token').locator('.pf-cap__src')).toHaveText('MCP · archiv')
  })

  test('mirror stale and agent missed (a failed last run is red) — counted again by the minute tick on a fake clock', async ({ page }) => {
    // Wednesday 14 Oct 2026, 09:00: the mirror's last good run ended Tuesday 10:00 (23 working hours ago)
    await page.clock.install({ time: new Date('2026-10-14T09:00:00+02:00') })
    await start(page)
    const m = await seedMirror(page)
    const tue = new Date('2026-10-13T10:00:00+02:00').getTime()
    await pf(page, (p, a) => p.seedRuns([
      { id: 'r-ok', agentId: a.mirror, runner: 'browser', trigger: { type: 'manual' }, startedAt: a.tue - 60_000, endedAt: a.tue, status: 'ok', summary: '', steps: [] },
      { id: 'r-err', agentId: a.report, runner: 'browser', trigger: { type: 'manual' }, startedAt: a.tue, endedAt: a.tue + 60_000, status: 'error', summary: '', steps: [], error: 'Zeitlimit' },
    ]), { mirror: m.mirrorId, report: m.reportId, tue })
    await home(page)
    const r = await readings(page)
    expect(r.mirror).toMatchObject({ count: 0 })
    expect(r.missed).toMatchObject({ count: 1, level: 'red', ids: [`fail:${m.reportId}@r-err`] })
    await expect(cap(page, 'missed')).toHaveAttribute('data-lit', 'red')
    // two hours on: past a working day without a good run — the minute tick reads the lamp again by itself
    await page.clock.runFor('02:00:00')
    await expect.poll(async () => (await pf(page, (p) => p.readings())).mirror?.count ?? null).toBe(1)
    expect((await readings(page)).mirror).toMatchObject({ ids: [`stale:${m.mirrorId}@r-ok`] })
  })

  test('mail red / amber, the worker’s states', async ({ page }) => {
    await start(page)
    await home(page)
    expect((await readings(page)).mail ?? null).toBeNull()
    await pf(page, (p) => p.stores.mail.setState({ account: 'mara@nordlicht.example', reconnect: true, errorAt: null }))
    await expect.poll(async () => (await readings(page)).mail).toMatchObject({ count: 1, level: 'amber', second: 'Sign in' })
    await pf(page, (p) => p.stores.mail.setState({ errorAt: 'sync' }))
    await expect.poll(async () => (await readings(page)).mail).toMatchObject({ count: 1, level: 'red', ids: ['mail:error:sync'] })

    expect((await readings(page)).worker ?? null).toBeNull()
    await pf(page, (p) => p.stores.coding.setState({ enabled: true, conn: 'refused' }))
    await expect.poll(async () => (await readings(page)).worker).toMatchObject({ count: 1, level: 'red', ids: ['worker:refused'] })
    const worker = (version: string) => ({ worker: version, name: 'Werkbank', repos: [], parallel: 1, busy: [], spentToday: 0, dayLimit: null, claude: { found: true, version: '2.0.0' } })
    const every = ['analyze', 'git:comment', 'git:merge', 'doc', 'model', 'mcp-list']
    await pf(page, (p, w) => p.stores.coding.setState({ conn: 'connected', worker: w, can: [] }), worker('1.8.1'))
    await expect.poll(async () => (await readings(page)).worker).toMatchObject({ count: 1, level: 'amber', ids: ['worker:outdated@1.8.1'], second: 'outdated' })
    await pf(page, (p, can) => p.stores.coding.setState({ can }), every)
    await expect.poll(async () => (await readings(page)).worker).toMatchObject({ count: 0, second: 'v1.8.1 · ok' })
    // 1.8.0 names every capability but has the ZIP-import gap: amber with the security line (it wins over "outdated")
    await pf(page, (p, w) => p.stores.coding.setState({ worker: w }), worker('1.8.0'))
    await expect.poll(async () => (await readings(page)).worker).toMatchObject({ count: 1, level: 'amber', ids: ['worker:unsafe@1.8.0'], second: 'security gap' })
    await expect(cap(page, 'worker')).toHaveAttribute('data-lit', 'amber')
    expect((await pf(page, (p) => p.contract())).worker).toMatchObject({ count: 1, same: true, ending: true, n: 1 })
    await pf(page, (p) => p.stores.coding.setState({ can: [] }))
    await expect.poll(async () => (await readings(page)).worker).toMatchObject({ count: 1, ids: ['worker:unsafe@1.8.0'] })
    // before the ZIP import (1.1.0) there is no gap: only the capability text
    await pf(page, (p, w) => p.stores.coding.setState({ worker: w }), worker('1.1.0'))
    await expect.poll(async () => (await readings(page)).worker).toMatchObject({ count: 1, ids: ['worker:outdated@1.1.0'] })
    await pf(page, (p) => p.stores.coding.setState({ enabled: false, conn: 'off' }))
  })

  test('a version to confirm counts only where coding is switched on (M7)', async ({ page }) => {
    await start(page)
    const pipe = await seedPipeline(page)
    // an agent wrote the first gate task: locally it waits for "Confirm" — on the worker's device only
    await wsEval(page, (s, id) => s.updatePage(id, { updatedBy: 'agent:ag-bericht' }), pipe.tasks[0])
    await home(page)
    const off = (await readings(page)).gate!
    expect(off.count).toBe(2)
    expect(off.ids.filter((id: string) => id.includes(':confirm@'))).toEqual([])
    await pf(page, (p) => p.stores.coding.setState({ enabled: true }))
    await expect.poll(async () => ((await readings(page)).gate!.ids as string[]).filter((id) => id.includes(':confirm@')).length).toBe(1)
    const on = (await readings(page)).gate!
    expect(on.count).toBe(2)
    expect(on.ids).toContain(`task:${pipe.tasks[1]}:${pipe.gateId}:gate@0`)
    expect(on.ids.find((id: string) => id.startsWith(`task:${pipe.tasks[0]}:confirm@`))).toMatch(/^task:[^:]+:confirm@[0-9a-f]{8}$/)
    await pf(page, (p) => p.stores.coding.setState({ enabled: false }))
  })

  test('question and failed come from this device’s task states', async ({ page }) => {
    await start(page)
    const pipe = await seedPipeline(page)
    await pf(page, (p, a) => p.stores.codingLocal.setState((s: AnyState) => ({ tasks: { ...s.tasks, [`local:local|${a.q}`]: { state: 'question', question: 'Welche Kodierung?', at: 36 }, [`local:local|${a.f}`]: { state: 'failed', error: 'Tests rot', at: 72 } } })), { q: pipe.tasks[0], f: pipe.tasks[2] })
    await home(page)
    await expect.poll(async () => (await readings(page)).question?.count).toBe(1)
    const r = await readings(page)
    expect(r.question!.ids[0]).toMatch(new RegExp(`^task:${pipe.tasks[0]}:[^:]+:question@10$`))
    expect(r.failed).toMatchObject({ count: 1 })
    expect(r.failed!.ids[0]).toMatch(new RegExp(`^task:${pipe.tasks[2]}:[^:]+:failed@20$`))
    await expect(cap(page, 'failed')).toHaveAttribute('data-lit', 'red')
  })

  test('without requestIdleCallback (Safari) every lamp still reads', async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback
      delete (window as unknown as { cancelIdleCallback?: unknown }).cancelIdleCallback
    })
    await start(page)
    expect(await page.evaluate(() => typeof (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback)).toBe('undefined')
    await seedMorning(page, { parts: ['mirror', 'runs', 'relay'] })
    // the shim reads by itself (no flush): proposals and token light
    await expect(cap(page, 'proposals')).toHaveAttribute('data-lit', 'amber')
    await expect(cap(page, 'token')).toHaveAttribute('data-lit', 'red')
    expect(await pf(page, (p) => p.state().ready)).toBe(true)
  })
})

test.describe('Preflight — MASTER CAUTION and keys (T-P1-3)', () => {
  test('MASTER CAUTION counts the new lamps; a click acknowledges them; with nothing new it opens the panel', async ({ page }) => {
    await start(page)
    await seedMorning(page)
    const mc = page.getByTestId('pf-mc')
    await expect(mc).toHaveAttribute('data-state', 'lit')
    await expect(mc.locator('.pf-mc__n')).toHaveText('4')
    await expect(mc).toHaveAttribute('aria-label', 'Master Caution: 4 lamps flashing. Click to acknowledge them.')
    await expect(page.getByTestId('pf-mkey')).toHaveAttribute('aria-label', 'Master Caution: 4 lamps flashing — acknowledge')
    await mc.click()
    await expect(mc).toHaveAttribute('data-state', 'acked')
    await expect(mc.locator('.pf-mc__n')).toHaveText('4')
    await expect(mc).toHaveAttribute('aria-label', 'Master Caution: off · 4 lamps lit — open the panel')
    await expect(page.locator('.pf-cap__new')).toHaveCount(0)
    const acks = await pf(page, (p) => p.acks())
    expect(Object.keys(acks.lamps).sort()).toEqual(['gate', 'outbox', 'proposals', 'token'])
    // acknowledged on this device: kept over a reload
    await reloadApp(page)
    await waitPreflight(page)
    await home(page)
    await flushLamps(page)
    await expect(page.getByTestId('pf-mc')).toHaveAttribute('data-state', 'acked')
    // with nothing new, the key opens the panel (from another route) and focus lands on a lamp
    const wiki = await pageIdByTitle(page, 'Team wiki')
    await page.evaluate((id) => (window.location.hash = `#/p/${id}`), wiki)
    await expect(page.locator('#main .pv-title')).toBeVisible()
    await page.getByTestId('pf-mc').click()
    await expect(plate(page)).toBeVisible()
    await expect(page.locator('.pf-cap:focus')).toHaveCount(1)
  })

  test('↵ on a lit cap acknowledges it and opens its queue; a new id makes it new again', async ({ page }) => {
    await start(page)
    const seeded = await seedMorning(page)
    await expect(cap(page, 'gate').locator('.pf-cap__new')).toBeVisible()
    await cap(page, 'gate').focus()
    await page.keyboard.press('Enter')
    // P2: the lamp's queue opens below the plate, its first card takes the keyboard (P1 opened the source's screen)
    await expect(page.getByTestId('pf-queue').locator('.pf-tab[data-lamp="gate"]')).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.pf-q article.pf-card[data-current]')).toBeFocused()
    expect(new URL(page.url()).hash).toBe('#/')
    await expect(cap(page, 'gate').locator('.pf-cap__new')).toHaveCount(0)
    await expect(cap(page, 'gate')).toHaveAttribute('aria-label', /^Gate · Plan: 2 open, acknowledged\./)
    // the same count with another id: new again ("new"), the chip back — while another lamp's queue is open (an open
    // queue acknowledges what arrives in it: the person sees it)
    await cap(page, 'token').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('pf-queue').locator('.pf-tab[data-lamp="token"]')).toHaveAttribute('aria-selected', 'true')
    await wsEval(page, (s, a) => {
      const db = s.databases[a.db]
      const stage = db.properties.find((p: AnyState) => (p.options ?? []).some((o: AnyState) => o.id === a.gate))
      s.setRowProperty(a.t1, stage.id, db.pipeline[0].id)
      s.setRowProperty(a.t3, stage.id, a.gate)
    }, { db: seeded.pipeline!.dbId, gate: seeded.pipeline!.gateId, t1: seeded.pipeline!.tasks[0], t3: seeded.pipeline!.tasks[2] })
    await expect.poll(async () => { await flushLamps(page); return cap(page, 'gate').locator('.pf-cap__new').textContent() }).toBe('new')
    await expect(cap(page, 'gate').locator('.pf-cap__n')).toHaveText('02')
  })

  test('Space jumps to the next new lamp, arrows move in 2-D — only with focus in the plate (positive controls)', async ({ page }) => {
    await start(page)
    await seedMorning(page)
    const order = await page.locator('.pf-cap').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.lamp))
    expect(order.slice(0, 4)).toEqual(['proposals', 'gate', 'token', 'question'])
    // one tab stop: the first new lamp
    await expect(page.locator('.pf-cap[tabindex="0"]')).toHaveCount(1)
    await cap(page, 'proposals').focus()
    const y0 = await page.evaluate(() => document.querySelector('.stage-col--main')?.scrollTop ?? 0)
    await page.keyboard.press(' ')
    await expect(cap(page, 'gate')).toBeFocused()
    await page.keyboard.press(' ')
    await expect(cap(page, 'token')).toBeFocused()
    await page.keyboard.press(' ')
    await expect(cap(page, 'outbox')).toBeFocused()
    await page.keyboard.press(' ')
    await expect(cap(page, 'proposals')).toBeFocused()
    // Space never scrolled the page and never clicked a cap (still on Start)
    expect(await page.evaluate(() => document.querySelector('.stage-col--main')?.scrollTop ?? 0)).toBe(y0)
    await expect(page).toHaveURL(/#\/$/)
    // arrows: 4 columns
    await page.keyboard.press('ArrowRight')
    await expect(cap(page, 'gate')).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.pf-cap').nth(5)).toBeFocused()
    await page.keyboard.press('End')
    await expect(page.locator('.pf-cap').last()).toBeFocused()
    await page.keyboard.press('Home')
    await expect(cap(page, 'proposals')).toBeFocused()
    // inert in a text field (the palette's input): Space types
    await page.keyboard.press(`${MOD}+k`)
    const input = page.getByRole('dialog', { name: 'Command palette' }).getByRole('combobox')
    await expect(input).toBeFocused()
    await page.keyboard.type('a b')
    await expect(input).toHaveValue('a b')
    await page.keyboard.press('Escape')
    // inert in a menu: the plate's ⋯ menu takes its own keys
    await plate(page).getByRole('button', { name: 'Preflight menu' }).click()
    const menu = page.getByRole('menu').first()
    await expect(menu).toBeVisible()
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.pf-cap:focus')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    // inert on another route: no plate, Space does what the page does
    const wiki = await pageIdByTitle(page, 'Team wiki')
    await page.evaluate((id) => (window.location.hash = `#/p/${id}`), wiki)
    await expect(page.locator('#main .pv-title')).toBeVisible()
    await expect(page.locator('.pf')).toHaveCount(0)
  })

  test('at phone width the housing has 2 columns: ↓ moves by two', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await start(page)
    await seedMorning(page)
    await cap(page, 'proposals').focus()
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.pf-cap').nth(2)).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.pf-cap').nth(3)).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(page.locator('.pf-cap').nth(1)).toBeFocused()
    // the topbar key: triangle and count, the name in its label
    await expect(page.getByTestId('pf-mc').locator('.pf-mc__name')).toBeHidden()
    await expect(page.getByTestId('pf-mc').locator('.pf-mc__icon')).toBeVisible()
  })
})

test.describe('Preflight — modes, lamp test, blink (T-P1-4)', () => {
  test('the day’s first render is the full plate; fold → strip; acknowledging never unfolds; a lamp turning new does', async ({ page }) => {
    await start(page)
    await seedMorning(page)
    await expect(plate(page)).toBeVisible()
    // Home's own sections are not built under the full plate; the greeting stays for screen readers
    await expect(page.locator('.home-sections')).toHaveCount(0)
    await expect(page.locator('.home__meta')).toHaveCount(0)
    await expect(page.locator('h1.visually-hidden')).toHaveCount(1)
    await plate(page).getByRole('button', { name: 'Preflight menu' }).click()
    await page.getByRole('menuitem', { name: 'Fold the panel' }).click()
    await expect(strip(page)).toBeVisible()
    await expect(page.locator('.home-sections')).toBeVisible()
    // lit pips with their colours, the red one with its notch
    await expect(strip(page).locator('.pf-pip--red')).toHaveCount(1)
    await expect(strip(page).locator('.pf-pip--amber')).toHaveCount(3)
    await expect(strip(page).locator('.pf-pip--grey')).toHaveCount(1)
    // acknowledging only shrinks "new": the strip stays
    await page.getByTestId('pf-mkey-strip').click()
    await flushLamps(page)
    await expect(strip(page)).toBeVisible()
    // a lamp turns new that was not new at the fold: the plate unfolds by itself
    await pf(page, (p) => p.stores.inbox.setState((s: AnyState) => ({ data: { ...s.data, items: [...s.data.items, { id: 'g:e2e:1', kind: 'agent', pageId: '', at: Date.now(), excerpt: 'Neue Rückmeldung von Ivo Brandt' }] } })))
    await flushLamps(page)
    await expect(plate(page)).toBeVisible()
    await expect(cap(page, 'inbox')).toHaveAttribute('data-lit', 'amber')
    // the strip's chevron unfolds; the fold goes back to the strip
    await plate(page).getByRole('button', { name: 'Preflight menu' }).click()
    await page.getByRole('menuitem', { name: 'Fold the panel' }).click()
    await expect(strip(page)).toBeVisible()
    await page.getByTestId('pf-unfold').click()
    await expect(plate(page)).toBeVisible()
  })

  test('the lamp test runs once, within 260 ms; never under reduced motion; the blink has 3 cycles and none after a remount', async ({ page, browser }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __pfTest: Array<{ t: number; what: string }> }
      w.__pfTest = []
      new MutationObserver((list) => {
        for (const m of list) {
          const el = m.target as HTMLElement
          if (m.attributeName === 'data-test' || m.attributeName === 'data-relit') w.__pfTest.push({ t: performance.now(), what: `${m.attributeName}=${el.getAttribute(m.attributeName!) ?? '-'}` })
        }
      }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-test', 'data-relit'] })
    })
    await start(page)
    // the morning without the full plate yet: build it, then a new day shows it with the test
    await page.evaluate(() => (window.location.hash = '#/inbox'))
    await seedMorning(page, { parts: ['mirror', 'runs', 'relay'] })
    await expect(plate(page)).toBeVisible()
    await expect.poll(() => pf(page, (p) => p.state().testing)).toBe('off')
    const log = await page.evaluate(() => (window as unknown as { __pfTest: Array<{ t: number; what: string }> }).__pfTest)
    const on = log.filter((e) => e.what === 'data-test=1')
    expect(on.length, JSON.stringify(log)).toBe(1)
    const t0 = on[0].t
    const end = log.filter((e) => e.what === 'data-test=-').at(-1)!.t
    expect(end - t0).toBeLessThanOrEqual(260 + 40)
    expect(log.filter((e) => e.what === 'data-relit=').length).toBe(2)
    expect(await pf(page, (p) => p.state().today.test)).toBe('ran')
    await expect(plate(page).locator('.pf__head')).toContainText('lamp test ok')
    // the blink: 3 cycles on a new lamp
    const iterations = await cap(page, 'token').evaluate((el) => el.getAnimations().map((a) => (a.effect as KeyframeEffect).getComputedTiming().iterations))
    expect(iterations).toEqual([3])
    // once per id set in this tab: after the blink, a remount does not blink again
    await page.waitForTimeout(3200)
    await page.evaluate(() => (window.location.hash = '#/inbox'))
    await home(page)
    await expect(cap(page, 'token')).toBeVisible()
    expect(await cap(page, 'token').evaluate((el) => el.getAnimations().length)).toBe(0)
    expect(await cap(page, 'token').getAttribute('data-flash')).toBeNull()
    // and never a second test the same day
    expect((await page.evaluate(() => (window as unknown as { __pfTest: Array<{ what: string }> }).__pfTest)).filter((e) => e.what === 'data-test=1').length).toBe(1)

    // reduced motion: lit caps, no test, no relight, no animation; the head says "lamp test off"
    const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, locale: 'en-US', timezoneId: 'Europe/Berlin', serviceWorkers: 'block' })
    const p2 = await ctx.newPage()
    await p2.addInitScript(() => {
      const w = window as unknown as { __pfMut: number }
      w.__pfMut = 0
      new MutationObserver((list) => (w.__pfMut += list.length)).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-test', 'data-relit'] })
    })
    await start(p2)
    await seedMorning(p2, { parts: ['mirror', 'runs', 'relay'] })
    await expect(cap(p2, 'token')).toHaveAttribute('data-lit', 'red')
    await expect.poll(() => pf(p2, (p) => p.state().today.test)).toBe('skipped')
    expect(await p2.evaluate(() => (window as unknown as { __pfMut: number }).__pfMut)).toBe(0)
    for (const el of await p2.locator('.pf-cap').all()) expect(await el.evaluate((e) => e.getAnimations().length)).toBe(0)
    await expect(plate(p2).locator('.pf__head')).toContainText('lamp test off')
    await ctx.close()
  })
})

test.describe('Preflight — the morning hold, off, ⌘K, the Agents badge (T-P1-5)', () => {
  const lastLit = (scope = 'local:local') => ({ key: `one.preflight.last:${scope}`, value: JSON.stringify({ at: Date.now() - 86_400_000, lamps: [['gate', 'amber'], ['inbox', 'dark']] }) })

  test('the first boot of a Preflight day stays on the plate when lamps were lit; the second goes to the start page; deep links are never held', async ({ page }) => {
    await start(page)
    const startPage = await pageIdByTitle(page, 'Team wiki')
    await wsEval(page, (s, id) => s.updateSettings({ startPageId: id }), startPage)
    // the count that write starts settles first: a pass after the plant would write the last count over it
    await page.evaluate(() => (window as unknown as { __onePreflight: { flush: () => Promise<void> } }).__onePreflight.flush())
    await page.waitForTimeout(400)
    await page.evaluate(() => (window as unknown as { __onePreflight: { flush: () => Promise<void> } }).__onePreflight.flush())
    await page.evaluate((l) => {
      localStorage.setItem(l.key, l.value)
      localStorage.removeItem('one.preflight.today:local:local')
      // the first boot went to a page: reload at "#/" (a deep link is never held)
      window.location.hash = ''
    }, lastLit())
    await reloadApp(page)
    // the boot (bootRedirect) stayed on "#/": the plate from the last count, no start page
    await expect(page).toHaveURL(/app\/\?e2e(#\/?)?$/)
    await expect(page.locator('#main .pv-title')).toHaveCount(0)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('one.preflight.today:local:local') ?? '{}').held)).toBe(true)
    // the second boot the same day: the start page as always
    await page.evaluate(() => (window.location.hash = ''))
    await reloadApp(page)
    await expect(page.locator('#main .pv-title')).toHaveValue('Team wiki')
    // a deep link is never held (and leaves the day alone)
    await page.evaluate(() => localStorage.removeItem('one.preflight.today:local:local'))
    const other = await pageIdByTitle(page, 'Reading list')
    await page.goto(`app/?e2e#/p/${other}`)
    await waitForApp(page)
    await expect(page.locator('#main .pv-title')).toHaveValue('Reading list')
    // hold switched off: the start page
    await page.evaluate(() => localStorage.setItem('one.preflight.prefs', JSON.stringify({ hold: false })))
    await page.goto('app/?e2e')
    await waitForApp(page)
    await expect(page.locator('#main .pv-title')).toHaveValue('Team wiki')
  })

  test('off: no plate, no MASTER CAUTION, the Agents badge back; ⌘K "Preflight" opens the panel; the badge is hidden while on', async ({ page }) => {
    await start(page)
    const m = await seedMirror(page)
    await seedRuns(page, m)
    await home(page)
    await flushLamps(page)
    // on: the plate counts the proposals, the Agents badge is gone
    await expect(cap(page, 'proposals').locator('.pf-cap__n')).toHaveText('08')
    await expect(page.getByTestId('agents-review')).toHaveCount(0)
    await expect(page.getByTestId('pf-mc')).toBeVisible()
    // ⌘K "Preflight" from another route: Start, the plate, focus on a lamp
    const wiki = await pageIdByTitle(page, 'Team wiki')
    await page.evaluate((id) => (window.location.hash = `#/p/${id}`), wiki)
    await expect(page.locator('#main .pv-title')).toBeVisible()
    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('Preflight')
    await expect(page.getByRole('option', { name: /Preflight/ }).first()).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(plate(page)).toBeVisible()
    await expect(page.locator('.pf-cap:focus')).toHaveCount(1)
    // off (Settings → Appearance): Home as before, no key, the badge back
    await page.evaluate(() => (window as unknown as { __one: AnyState }).__one.ui.getState().openModal({ type: 'settings', tab: 'appearance' }))
    const settings = page.getByTestId('pf-settings')
    await settings.getByRole('switch', { name: 'Preflight on Start' }).click()
    await expect(settings.getByRole('switch', { name: 'Preflight on Start' })).toHaveAttribute('aria-checked', 'false')
    await page.keyboard.press('Escape')
    await expect(page.locator('.pf')).toHaveCount(0)
    await expect(page.getByTestId('pf-mc')).toHaveCount(0)
    await expect(page.locator('.home__meta')).toBeVisible()
    await expect(page.getByTestId('agents-review')).toContainText('08')
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem('one.preflight.prefs'))) ?? '{}')).toMatchObject({ on: false })
  })

  test('preflightOff (fixture) starts with Preflight off', async ({ page }) => {
    await preflightOff(page)
    await start(page)
    await home(page)
    await expect(page.locator('.home__meta')).toBeVisible()
    await expect(page.locator('.pf')).toHaveCount(0)
    expect(await pf(page, (p) => p.state().on)).toBe(false)
    void STORY
  })
})
