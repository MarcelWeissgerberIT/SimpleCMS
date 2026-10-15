/**
 * The Patchbay's live signal on the page (B14 · plan §1.7, §3.10, §6 U6 / U28 / U29) — P3 done.
 *
 * Node (the pure parts — ui/liveWin.ts — on mock 1 of tests/fixtures/patchbay.ts):
 *  - the windows' words: "RUNNING 0:04" with the run's money under it ("$0.21" · "0,21 $", "≈" for an estimate, "price
 *    unknown" — never $0 — or "on the server"), the clock's "07:30:00 FIRED" for 60 s, a database's big "+3 FOR REVIEW",
 *    "! FAILED" (red lamp), "HELD" (a ring — never red, the Regler's own wording as its title), "! BUDGET" (amber);
 *  - the dot: one leg after the other, 600 ms each, a leg whose cable is not drawn skipped, a fade where it arrived;
 *  - the cable label "3 PROPOSALS" on the wire carrying Tessera-Spiegel's cable to Tessera Handoff (a bus adds up);
 *  - every live string EN + DE, German without "Trigger" / "AI".
 * Browser (the app, `?e2e`, mock 1):
 *  - the dot runs the legs in order (clock → agent, then agent → database, 600 ms ± a frame), the LED blinks at most
 *    5 s, the window ticks, the run is said once in the polite region;
 *  - reduced motion: no dot, no blink — the run's cables carry the static ink emphasis while it runs, never orange;
 *  - a failing webhook (the fixture answers 500) → „An Team-Chat“ red with "! FAILED"; an agent run held by the Regler →
 *    "HELD", not red; over its own budget → amber; failed → red;
 *  - "RUNS TODAY 2 · $0.03" / DE "0,03 $" after two stubbed runs;
 *  - the "07:30" state (mock 1's picture, noBlink, the page's Date set to 07:30:04 today) at 1440 × 900 light and dark and
 *    the phone's strands at 390 — written to `.shots/` (PB_SHOTS names another folder), compared by eye with the mock's
 *    shot-1440-* / shot-390-*.
 * Every name is fictional; every host is `*.example`.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval } from './fixtures'
import type { Page as WsPage } from '../../src/app/store/types'
import { moduleKey, scheduleKey } from '../../src/app/features/patchbay/ref'
import { layoutRack } from '../../src/app/features/patchbay/layout'
import { LEG_MS, type LiveEntry, type LiveLeg } from '../../src/app/features/patchbay/live/core'
import { cableLabels, dotAt, elapsed, FADE_MS, liveLed, liveWindow, runCostKey } from '../../src/app/features/patchbay/ui/liveWin'
import { messages as liveMessages } from '../../src/app/features/patchbay/messages-live'
import { messages as governorMessages } from '../../src/app/features/governor/messages'
import { mock1, modelOf, page as pbPage, seedPatchbay, type PbWorld } from '../fixtures/patchbay'

const OUT = process.env.PB_SHOTS || join(process.cwd(), '.shots')

/* ------------------------------------------------------------------ keys of mock 1 */

const M = {
  toChat: moduleKey({ kind: 'automation', db: 'dbMails', id: 'autToChat' }),
  inbox: moduleKey({ kind: 'agent', id: 'agInbox' }),
  mirror: moduleKey({ kind: 'agent', id: 'agTessera' }),
  handoff: moduleKey({ kind: 'database', id: 'dbHandoff' }),
  clock: moduleKey({ kind: 'clock', schedule: scheduleKey({ type: 'schedule', every: 'weekday', at: '07:30', tz: 'Europe/Berlin' }), agents: [] }),
}
const E = {
  clockToMirror: `${M.clock}.start>${M.mirror}.start`,
  mirrorToHandoff: `${M.mirror}.writes>${M.handoff}.writes`,
}

/** The words of the live strings in one language (Node: no translator module); other areas' keys from their packs. */
const tOf =
  (lang: 'en' | 'de') =>
  (key: string, vars: Record<string, string | number> = {}): string =>
    (liveMessages[lang][key] ?? governorMessages[lang][key] ?? key).replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
const tEn = tOf('en')
const tDe = tOf('de')

const running = (since: number, over: Partial<LiveEntry> = {}): LiveEntry => ({ state: 'running', since, cost: null, run: 'r1', ...over })

/* ================================================================== Node */

test.describe('B14 · the windows and lamps — liveWin.ts (§3.10, §6 U29)', () => {
  const T = new Date(2026, 9, 12, 7, 30, 0).getTime() // Mon 12 Oct 07:30:00, local time (the window shows local time)

  test('a run in flight: "RUNNING 0:04" with its money (≈ for an estimate, "price unknown" never $0) or "on the server"', () => {
    const w = liveWindow({ entry: running(T), runCost: { usd: 0.21, estimate: false, unpriced: 0 }, now: T + 4200, t: tEn, lang: 'en' })
    expect(w).toMatchObject({ kind: 'run', lcd: true, main: 'running 0:04', sub: '$0.21', ticks: true })
    expect(w!.title).toMatch(/^Running since \d\d:\d\d:\d\d on this device$/)
    const de = liveWindow({ entry: running(T), runCost: { usd: 0.21, estimate: false, unpriced: 0 }, now: T + 4200, t: tDe, lang: 'de' })
    expect(de).toMatchObject({ main: 'läuft 0:04', sub: '0,21\u00a0$' })
    expect(liveWindow({ entry: running(T), runCost: { usd: 0.21, estimate: true, unpriced: 0 }, now: T + 61_000, t: tEn, lang: 'en' })).toMatchObject({ main: 'running 1:01', sub: '≈ $0.21' })
    expect(liveWindow({ entry: running(T), runCost: { usd: 0, estimate: false, unpriced: 2 }, now: T, t: tEn, lang: 'en' })!.sub).toBe('price unknown')
    expect(liveWindow({ entry: running(T), runCost: null, now: T, t: tEn, lang: 'en' })!.sub).toBeUndefined()
    expect(liveWindow({ entry: running(T, { server: true }), runCost: null, now: T, t: tEn, lang: 'en' })).toMatchObject({ sub: 'on the server' })
    expect(liveWindow({ entry: running(T, { elsewhere: true }), now: T, t: tEn, lang: 'en' })!.title).toMatch(/in another tab/)
    expect([elapsed(0), elapsed(4999), elapsed(65_000), elapsed(3_725_000)]).toEqual(['0:00', '0:04', '1:05', '1:02:05'])
    // the run's money series per kind (live/costs.ts); a module without runs has none
    const model = modelOf(mock1())
    const mod = (k: string) => model.modules.find((m) => m.key === k)!
    expect(runCostKey(mod(M.mirror), 'r9')).toBe('agent:agTessera:r9')
    expect(runCostKey(mod(M.toChat), 'r9')).toBeNull()
    expect(runCostKey(mod(M.mirror), null)).toBeNull()
  })

  test('the clock: "07:30:00 FIRED" for 60 s; a database: the big "+3 FOR REVIEW"; the LED of each', () => {
    const fired = liveWindow({ fired: T, now: T + 4000, t: tEn, lang: 'en' })
    expect(fired).toMatchObject({ kind: 'fired', lcd: true, main: '07:30:00', sub: 'fired', title: 'Fired at 07:30:00' })
    expect(liveWindow({ fired: T, now: T + 4000, t: tDe, lang: 'de' })).toMatchObject({ main: '07:30:00', sub: 'ausgelöst' })
    expect(liveWindow({ fired: T, now: T + 60_000, t: tEn, lang: 'en' })).toBeNull()
    expect(liveLed(null, T, false, T + 59_000)).toBe('hot')
    expect(liveLed(null, T, false, T + 60_000)).toBeNull()
    const review = liveWindow({ entry: { state: 'idle', since: null, cost: null, review: 3 }, now: T, t: tEn, lang: 'en' })
    expect(review).toMatchObject({ kind: 'review', lcd: true, big: true, main: '+3', sub: 'for review', title: '3 proposals for this database wait for review' })
    expect(liveWindow({ entry: { state: 'idle', since: null, cost: null, review: 1 }, now: T, t: tDe, lang: 'de' })).toMatchObject({ main: '+1', sub: 'zur Prüfung', title: '1 Vorschlag für diese Datenbank wartet auf Prüfung' })
    // a database a run in flight writes: its LED lit (steady), its window unchanged
    expect(liveLed(null, null, true, T)).toBe('lit')
    expect(liveLed(running(T), null, true, T)).toBe('hot')
    expect(liveWindow({ entry: null, now: T, t: tEn, lang: 'en' })).toBeNull()
  })

  test('a run that ended: "! FAILED" red, "! BUDGET" amber, "HELD" a ring in the Regler\'s words — never red', () => {
    const failed = liveWindow({ entry: { state: 'error', since: null, cost: null }, now: T, t: tEn, lang: 'en' })
    expect(failed).toMatchObject({ kind: 'failed', lcd: false, main: '! failed' })
    expect(liveWindow({ entry: { state: 'error', since: null, cost: null }, now: T, t: tDe, lang: 'de' })!.main).toBe('! Fehler')
    expect(liveLed({ state: 'error', since: null, cost: null }, null, false, T)).toBe('error')
    const held = liveWindow({ entry: { state: 'held', since: null, cost: null }, now: T, t: tEn, lang: 'en' })
    expect(held).toMatchObject({ kind: 'held', main: 'held', title: 'held by the governor' })
    expect(held!.main).not.toContain('!')
    expect(liveWindow({ entry: { state: 'held', since: null, cost: null }, now: T, t: tDe, lang: 'de' })).toMatchObject({ main: 'angehalten', title: 'vom Regler angehalten' })
    expect(liveLed({ state: 'held', since: null, cost: null }, null, false, T)).toBe('held')
    expect(liveWindow({ entry: { state: 'budget', since: null, cost: null }, now: T, t: tEn, lang: 'en' })).toMatchObject({ kind: 'budget', main: '! budget' })
    expect(liveLed({ state: 'budget', since: null, cost: null }, null, false, T)).toBe('budget')
    // a run in flight wins over the last run's lamp
    expect(liveLed(running(T), null, false, T)).toBe('hot')
  })

  test('the dot: one leg after the other, 600 ms each; a leg whose cable is not drawn is skipped; a fade where it arrived', () => {
    const legs: LiveLeg[] = [
      { edgeId: 'a', at: 1000, run: 'r' },
      { edgeId: 'b', at: 1600, run: 'r' },
      { edgeId: 'c', at: 2200, run: 'r' },
    ]
    const all = () => true
    expect(dotAt(legs, 999, all)).toBeNull()
    expect(dotAt(legs, 1000, all)).toEqual({ edge: 'a', t: 0, opacity: 1 })
    expect(dotAt(legs, 1300, all)).toEqual({ edge: 'a', t: 0.5, opacity: 1 })
    expect(dotAt(legs, 1599, all)!.edge).toBe('a')
    expect(dotAt(legs, 1600, all)).toEqual({ edge: 'b', t: 0, opacity: 1 })
    expect(dotAt(legs, 2200 + LEG_MS - 1, all)!.edge).toBe('c')
    expect(dotAt(legs, 2200 + LEG_MS + FADE_MS / 2, all)).toEqual({ edge: 'c', t: 1, opacity: 0.5 })
    expect(dotAt(legs, 2200 + LEG_MS + FADE_MS, all)).toBeNull()
    // "b" folded away: its slot passes without a dot, "c" comes on time
    const noB = (e: string) => e !== 'b'
    expect(dotAt(legs, 1700, noB)).toMatchObject({ edge: 'a', t: 1 })
    expect(dotAt(legs, 2200, noB)).toMatchObject({ edge: 'c', t: 0 })
  })

  test('the cable label: "3 PROPOSALS" on the wire carrying Tessera-Spiegel → Tessera Handoff', () => {
    const model = modelOf(mock1())
    const layout = layoutRack(model)
    const labels = cableLabels(model, layout, { [`${M.mirror}|${M.handoff}`]: 3 }, tEn)
    expect(labels.size).toBe(1)
    const [[wire, text]] = [...labels]
    expect(text).toBe('3 proposals')
    expect(layout.wires.find((w) => w.id === wire)!.edges).toContain(E.mirrorToHandoff)
    expect([...cableLabels(model, layout, { [`${M.mirror}|${M.handoff}`]: 1 }, tDe).values()]).toEqual(['1 Vorschlag'])
    // nothing open: no label; a key no wire carries: none
    expect(cableLabels(model, layout, {}, tEn).size).toBe(0)
    expect(cableLabels(model, layout, { [`${M.inbox}|${M.handoff}`]: 2 }, tEn).size).toBe(0)
  })

  test('every live string in English and German, the same braces; German without "Trigger" / "AI"', () => {
    const en = Object.keys(liveMessages.en).sort()
    expect(Object.keys(liveMessages.de).sort()).toEqual(en)
    for (const k of en) {
      const braces = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort()
      expect(braces(liveMessages.de[k]), k).toEqual(braces(liveMessages.en[k]))
      expect(liveMessages.de[k], k).not.toMatch(/Trigger|\bAI\b|fremd/)
    }
  })
})

/* ================================================================== browser */

type LiveSeam = {
  start: () => void
  flush: () => Promise<void>
  snapshot: () => { open: boolean; runs: Record<string, number>; modules: Record<string, { state: string }>; legs: LiveLeg[]; hot: string[] } | null
  legLog: () => LiveLeg[]
}

const live = <R>(p: Page, fn: (s: LiveSeam) => R | Promise<R>): Promise<R> =>
  p.evaluate(
    ({ src }) => {
      const s = (window as unknown as { __onePatchbayLive: unknown }).__onePatchbayLive
      // eslint-disable-next-line no-new-func
      return new Function('s', `return (${src})(s)`)(s)
    },
    { src: fn.toString() },
  ) as Promise<R>

/** A colour token as the browser resolves it (rgb()). */
const css = (page: Page, token: string) =>
  page.evaluate((t) => {
    const el = document.createElement('i')
    el.style.color = `var(${t})`
    document.body.append(el)
    const c = getComputedStyle(el).color
    el.remove()
    return c
  }, token)

/** Mock 1 as the browser seeds it: a mail row and a Handoff row; nothing runs by itself (no schedule slot ever). */
function liveWorld(opts: { quiet?: boolean } = {}): PbWorld {
  const w = mock1()
  w.ws.agents = {
    ...w.ws.agents,
    // its schedule never comes due in the test (slots before the agent's last change do not count, runner.ts)
    agTessera: { ...w.ws.agents!.agTessera, updatedAt: Date.parse('2031-01-01T00:00:00Z') },
    ...(opts.quiet ? { agInbox: { ...w.ws.agents!.agInbox, enabled: false } } : {}),
  }
  if (opts.quiet) {
    const mails = w.ws.databases.dbMails
    w.ws.databases = { ...w.ws.databases, dbMails: { ...mails, automations: mails.automations!.map((a) => (a.id === 'autToContact' ? { ...a, enabled: false } : a)) } }
  }
  const row = (id: string, db: string, title: string, properties: WsPage['properties']) => pbPage(id, { parentId: db, databaseId: db, title, properties })
  w.ws.pages = {
    ...w.ws.pages,
    ...(opts.quiet ? { rowMail1: row('rowMail1', 'dbMails', 'Angebot Nordlicht', { pMailFwd: false, pMailFrom: 'Mara Lind' }) } : {}),
    rowHandoff1: row('rowHandoff1', 'dbHandoff', 'TESS-1', { pHandoffKey: 'TESS-1' }),
  }
  return w
}

async function openLive(page: Page, w: PbWorld, lang: 'en' | 'de' = 'en', rack = true) {
  await page.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
  await openApp(page)
  await seedPatchbay(page, w)
  if (lang === 'de') await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
  await page.evaluate(() => (window.location.hash = '#/patchbay'))
  await expect(page.getByTestId('patchbay-page')).toBeVisible()
  await expect.poll(() => live(page, (s) => s.snapshot()?.open ?? false)).toBe(true)
  if (rack) await expect(page.getByTestId('pb-wires')).toBeVisible()
  else await expect(page.getByTestId('pb-strand').first()).toBeVisible()
  // the fixture's agents have no key: a toast is not what these tests are about
  await page.evaluate(() => (window as unknown as { __one: { ui: { setState: (s: unknown) => void } } }).__one.ui.setState({ toasts: [], waitingToasts: [] }))
}

/** A recorder step (real store actions under a run's writer). */
const step = (page: Page, s: { writer: Record<string, unknown>; note?: unknown; calls?: unknown[][]; end?: boolean }) =>
  page.evaluate(async (s) => {
    const rec = (window as unknown as { __oneRecorder: { step: (s: unknown) => Promise<unknown> } }).__oneRecorder
    await rec.step({ calls: [], ...s })
  }, s)

/** An agent run record on this device (the review / the Regler say how a run ended). */
const putRun = (page: Page, run: Record<string, unknown>) =>
  page.evaluate(async (run) => {
    const a = (window as unknown as { __oneAgents: { putRun: (r: unknown) => Promise<void> } }).__oneAgents
    await a.putRun({ runner: 'browser', trigger: { type: 'schedule', detail: 'schedule 07:30' }, summary: '', steps: [], startedAt: Date.now(), ...run })
  }, run)

/** One ledger entry as the meter hears it here (fixture model, a fixed price). */
const meter = (page: Page, source: string, usd: number, id: string) =>
  page.evaluate(
    ({ source, usd, id }) => {
      const ledger = (window as unknown as { __oneLedger: { meter: (e: unknown) => void; scope: () => string | null } }).__oneLedger
      ledger.meter({
        id,
        at: Date.now(),
        scope: ledger.scope(),
        purpose: 'agents.run',
        cls: 'workspace',
        source,
        role: 'main',
        route: 'anthropic:fixture-model',
        served: { p: 'anthropic', model: 'fixture-model' },
        classes: ['page'],
        usage: { input: 1000, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, output: 200, reasoning: 0 },
        usd,
        costSource: 'table',
        priceAt: '2026-10-12',
        mcpCalls: 0,
        outcome: 'ok',
      })
    },
    { source, usd, id },
  )

const mod = (page: Page, key: string) => page.locator(`.pb-mod[data-key="${key}"]`)
const win = (page: Page, key: string) => page.locator(`[data-testid="pb-livewin"][data-module="${key}"]`)

/** Three proposals of a run for Tessera Handoff rows (pending, as a stage-mode run leaves them). */
const proposals = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, n: i + 1, kind: 'create_row', status: 'pending', pageId: `rowNew${i + 1}`, databaseId: 'dbHandoff', title: `TESS-${10 + i}`, props: [] }))

test.describe('B14 · the live signal on the rack', () => {
  test('the dot runs the legs in order (600 ms ± a frame); the LED blinks at most 5 s; the window ticks; the start is said once', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await openLive(page, liveWorld())
    // sample the dot every frame while a run of Tessera-Spiegel starts by its clock and writes Tessera Handoff
    const samples = await page.evaluate(async () => {
      const out: Array<{ now: number; edge: string; op: number; t: number }> = []
      let on = true
      const loop = () => {
        const g = document.querySelector<SVGGElement>('[data-testid="pb-comet"]')
        out.push({ now: Date.now(), edge: g?.dataset.edge ?? '', op: g ? Number(g.style.opacity || 0) : 0, t: Number(g?.dataset.t ?? -1) })
        if (on) requestAnimationFrame(loop)
      }
      requestAnimationFrame(loop)
      const rec = (window as unknown as { __oneRecorder: { step: (s: unknown) => Promise<unknown> } }).__oneRecorder
      await rec.step({ writer: { kind: 'agent', id: 'agTessera', run: 'rComet' }, note: { seq: 1 }, calls: [['setRowProperty', 'rowHandoff1', 'pHandoffStatus', 'offen']] })
      await new Promise((r) => setTimeout(r, 1700))
      on = false
      return out
    })
    const legs = (await live(page, (s) => s.legLog())).filter((l) => l.run === 'agent:agTessera#rComet')
    expect(legs.map((l) => l.edgeId)).toEqual([E.clockToMirror, E.mirrorToHandoff])
    expect(legs[1].at - legs[0].at).toBe(600)
    // the edges the dot ran, in order
    const seen = samples.filter((s) => s.edge && s.op > 0).map((s) => s.edge)
    expect(seen.filter((e, i) => e !== seen[i - 1])).toEqual([E.clockToMirror, E.mirrorToHandoff])
    // the hand-over: within a frame (the longest frame this machine took while sampling — slow under load, + the
    // sampler's own lag) of 600 ms after the first leg — never on the next cable before its time
    const FRAME = Math.max(...samples.slice(1).map((s, i) => s.now - samples[i].now)) + 20
    const first = (edge: string) => samples.find((s) => s.edge === edge && s.op > 0)!
    const last = (edge: string) => [...samples].reverse().find((s) => s.edge === edge && s.t < 1)!
    // the first dot comes with the render the run's start causes (the store write it made re-renders the app first —
    // ~ a frame alone, a few under load); it is placed by the time, so it enters where the leg is by then
    expect(first(E.clockToMirror).now - legs[0].at).toBeLessThan(150)
    expect(first(E.clockToMirror).t).toBeLessThan(0.3)
    expect(first(E.mirrorToHandoff).now - legs[1].at).toBeGreaterThanOrEqual(0)
    expect(first(E.mirrorToHandoff).now - legs[1].at).toBeLessThan(FRAME)
    expect(last(E.clockToMirror).now).toBeLessThan(legs[1].at + FRAME)
    // the dot moved along its cable (t rising), and was gone after its fade
    const along = samples.filter((s) => s.edge === E.mirrorToHandoff && s.t < 1).map((s) => s.t)
    expect(along.length).toBeGreaterThan(5)
    expect(along.every((t, i) => i === 0 || t >= along[i - 1])).toBe(true)
    await expect.poll(() => page.locator('[data-testid="pb-comet"]').evaluateAll((els) => els.filter((e) => (e as SVGGElement).style.opacity !== '0').length)).toBe(0)

    // the LED: hot, blinking while the run is under 5 s old (8 × 0.6 s), then steady while it runs
    const led = mod(page, M.mirror).getByTestId('pb-live-led')
    await expect(led).toHaveAttribute('data-live-led', 'hot')
    const blinking = () => led.evaluate((el) => el.getAnimations().filter((a) => a.playState === 'running').map((a) => (a as CSSAnimation).animationName))
    expect(await blinking()).toEqual(['pb-hot'])
    // the clock fired with it (its LED hot too), and the database the run writes is lit
    await expect(mod(page, M.clock).getByTestId('pb-live-led')).toHaveAttribute('data-live-led', 'hot')
    await expect(mod(page, M.handoff).getByTestId('pb-live-led')).toHaveAttribute('data-live-led', 'lit')
    await expect(win(page, M.clock)).toContainText('fired')
    // the window ticks once a second
    await expect(win(page, M.mirror)).toContainText(/running 0:0[0-2]/)
    await expect(win(page, M.mirror)).toContainText('running 0:03', { timeout: 5000 })
    // the start was said once, politely
    await expect(page.getByTestId('pb-live')).toContainText('Tessera-Spiegel running')
    // ≤ 5 s: the blink is over, the LED stays lit while the run goes on
    await expect.poll(blinking, { timeout: 6000 }).toEqual([])
    await expect(led).toHaveAttribute('data-live-led', 'hot')
    // the run ends: the LED goes back to the module's own, the window to its runs today
    await step(page, { writer: { kind: 'agent', id: 'agTessera', run: 'rComet' }, end: true })
    await expect(mod(page, M.mirror).getByTestId('pb-live-led')).toHaveCount(0)
    await expect(win(page, M.mirror)).toHaveCount(0)
    await expect(mod(page, M.mirror).locator('.pb-win')).toHaveText('1×')
  })

  test('reduced motion: no dot, no blink — the run\'s cables carry the static ink emphasis while it runs, never orange (forced colours too)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openLive(page, liveWorld())
    await step(page, { writer: { kind: 'agent', id: 'agTessera', run: 'rCalm' }, note: { seq: 1 }, calls: [['setRowProperty', 'rowHandoff1', 'pHandoffStatus', 'offen']] })
    await expect.poll(() => live(page, (s) => s.snapshot()?.hot.length ?? 0)).toBeGreaterThan(1)
    await page.waitForTimeout(400)
    expect(await page.locator('[data-testid="pb-comet"]').count()).toBe(0)
    const led = mod(page, M.mirror).getByTestId('pb-live-led')
    await expect(led).toHaveAttribute('data-live-led', 'hot')
    expect(await led.evaluate((el) => el.getAnimations().length)).toBe(0)
    // the run's cables: thicker, in ink — the others as they were
    const ink = await css(page, '--ink')
    const signal = await css(page, '--signal')
    const hot = page.locator('.pb-wires g[data-hot] > .pb-w')
    await expect(hot).toHaveCount(2)
    for (const s of await hot.evaluateAll((els) => els.map((e) => ({ w: getComputedStyle(e).strokeWidth, c: getComputedStyle(e).stroke })))) {
      expect(s.w).toBe('3.8px')
      expect(s.c).toBe(ink)
      expect(s.c).not.toBe(signal)
    }
    const calm = await page.locator('.pb-wires g:not([data-hot]) > .pb-w').first().evaluate((e) => getComputedStyle(e).strokeWidth)
    expect(calm).not.toBe('3.8px')
    // forced colours: the emphasis stays — thicker, in CanvasText (the cables' own system colour)
    await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' })
    const canvasText = await page.evaluate(() => {
      const el = document.createElement('i')
      el.style.color = 'CanvasText'
      document.body.append(el)
      const c = getComputedStyle(el).color
      el.remove()
      return c
    })
    for (const s of await hot.evaluateAll((els) => els.map((e) => ({ w: getComputedStyle(e).strokeWidth, c: getComputedStyle(e).stroke })))) expect(s).toEqual({ w: '4.2px', c: canvasText })
    await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'none' })
    // the emphasis lasts as long as the run
    await step(page, { writer: { kind: 'agent', id: 'agTessera', run: 'rCalm' }, end: true })
    await expect(page.locator('.pb-wires g[data-hot]')).toHaveCount(0)
  })

  test('a failing webhook → „An Team-Chat“ red with "! FAILED"; held → "HELD", never red; over budget → amber; failed → red', async ({ page, errors }) => {
    errors.allow(/chat\.example|status of 500|Failed to load resource/)
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, PUT, OPTIONS' }
    let calls = 0
    await page.context().route('https://chat.example/**', (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      calls++
      return route.fulfill({ status: 500, headers: { ...cors, 'content-type': 'application/json' }, body: '{"error":"down"}' })
    })
    await openLive(page, liveWorld({ quiet: true }))
    // the person flips „Weiterleiten“: the automation fires, its webhook answers 500
    await wsEval(page, (s) => s.setRowProperty('rowMail1', 'pMailFwd', true))
    await expect.poll(() => calls, { timeout: 10_000 }).toBeGreaterThan(0)
    await expect(win(page, M.toChat)).toHaveAttribute('data-live', 'failed', { timeout: 15_000 })
    await expect(win(page, M.toChat)).toHaveText('! failed')
    await expect(win(page, M.toChat)).toHaveCSS('text-transform', 'uppercase')
    const red = await css(page, '--pb-red')
    const chatLed = mod(page, M.toChat).getByTestId('pb-live-led')
    await expect(chatLed).toHaveAttribute('data-live-led', 'error')
    await expect(chatLed).toHaveCSS('background-color', red)

    // an agent run the Regler held: "HELD" in its words, a ring — never red
    const now = await page.evaluate(() => Date.now())
    await putRun(page, { id: 'rHeld', agentId: 'agTessera', seq: 1, startedAt: now - 2000, endedAt: now - 1000, status: 'held' })
    await expect(win(page, M.mirror)).toHaveAttribute('data-live', 'held')
    await expect(win(page, M.mirror)).toHaveText('held')
    await expect(win(page, M.mirror)).toHaveAttribute('title', 'held by the governor')
    const held = mod(page, M.mirror).getByTestId('pb-live-led')
    await expect(held).toHaveAttribute('data-live-led', 'held')
    expect(await held.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(red)
    expect(await held.evaluate((el) => getComputedStyle(el).boxShadow)).not.toContain(red)
    // over its own budget: amber with "! BUDGET"
    await putRun(page, { id: 'rBudget', agentId: 'agTessera', seq: 2, startedAt: now - 500, endedAt: now - 100, status: 'budget' })
    await expect(win(page, M.mirror)).toHaveAttribute('data-live', 'budget')
    await expect(win(page, M.mirror)).toHaveText('! budget')
    await expect(mod(page, M.mirror).getByTestId('pb-live-led')).toHaveCSS('background-color', await css(page, '--lamp-amber'))
    // failed: red
    await putRun(page, { id: 'rFailed', agentId: 'agTessera', seq: 3, startedAt: now, endedAt: now + 10, status: 'error', error: 'fixture' })
    await expect(win(page, M.mirror)).toHaveAttribute('data-live', 'failed')
    await expect(mod(page, M.mirror).getByTestId('pb-live-led')).toHaveCSS('background-color', red)
  })

  test('"RUNS TODAY 2 · $0.03" after two stubbed runs — German "0,03 $"', async ({ page }) => {
    await openLive(page, liveWorld())
    await step(page, { writer: { kind: 'agent', id: 'agTessera', run: 'rA' }, note: { seq: 1 }, end: true })
    await step(page, { writer: { kind: 'agent', id: 'agInbox', run: 'rB' }, note: { seq: 1 }, end: true })
    await meter(page, 'agent:agTessera:rA', 0.03, 'lgRuns1')
    await expect(page.getByTestId('pb-ro-runs')).toHaveText('2 · $0.03')
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await expect(page.getByTestId('pb-ro-runs')).toHaveText(/^2 · 0,03\s\$$/)
    await expect(page.locator('[data-cell="runs"] .label')).toHaveText('Läufe heute')
  })
})

/* ------------------------------------------------------------------ the 07:30 picture */

/**
 * Mock 1 at 07:30:04: Tessera-Spiegel started by its clock at 07:30:00 (FIRED), 4 s in, $0.21 so far, 3 proposals for
 * Tessera Handoff, its dot on the cable to it (85 % along); earlier this morning Inbox-Helfer ran twice ($0.06), „Neue
 * Mail → Kontakt“ twice, „An Team-Chat“ once — RUNS TODAY 6 · $0.27. The page's clock is set (Date only — its timers
 * run as they do) to 07:30:00, 07:30:03.490 and 07:30:04 of today as the picture needs it, and stands there for the
 * picture: the window reads 0:04, the dot stays where 07:30:04 puts it.
 */
async function at0730(page: Page, lang: 'en' | 'de', rack = true) {
  await openLive(page, liveWorld(), lang, rack)
  await page.evaluate(() => (window as unknown as { __onePatchbay: { noBlink: () => void } }).__onePatchbay.noBlink())
  // the morning so far (their dots play out first)
  for (const run of ['rIn1', 'rIn2']) await step(page, { writer: { kind: 'agent', id: 'agInbox', run }, note: { seq: run === 'rIn1' ? 1 : 2 }, end: true })
  for (const run of ['rKo1', 'rKo2']) await step(page, { writer: { kind: 'automation', db: 'dbMails', id: 'autToContact', run }, note: true, end: true })
  await step(page, { writer: { kind: 'automation', db: 'dbMails', id: 'autToChat', run: 'rTc1' }, note: true, end: true })
  await meter(page, 'agent:agInbox:rIn1', 0.03, 'lgIn1')
  await meter(page, 'agent:agInbox:rIn2', 0.03, 'lgIn2')
  await expect(page.getByTestId('pb-ro-runs')).toContainText('5')
  await expect.poll(() => live(page, (s) => s.snapshot()?.legs.length ?? -1), { timeout: 8000 }).toBe(0)
  // 07:30:00 today — the clock strikes: Tessera-Spiegel's run (its record: running, 3 proposals so far)
  const strike = await page.evaluate(() => new Date().setHours(7, 30, 0, 0))
  await page.clock.setFixedTime(strike)
  await step(page, { writer: { kind: 'agent', id: 'agTessera', run: 'rTess0730' }, note: { seq: 1 } })
  await putRun(page, { id: 'rTess0730', agentId: 'agTessera', seq: 1, status: 'running', staged: proposals(3) })
  // 07:30:03.490 — it writes Tessera Handoff (the dot sets off along that cable), $0.21 metered so far
  await page.clock.setFixedTime(strike + 3490)
  await step(page, { writer: { kind: 'agent', id: 'agTessera', run: 'rTess0730' }, calls: [['setRowProperty', 'rowHandoff1', 'pHandoffStatus', 'offen']] })
  await meter(page, 'agent:agTessera:rTess0730', 0.21, 'lgTess1')
  // 07:30:04 — the picture
  await page.clock.setFixedTime(strike + 4000)
  await page.evaluate(() => (window as unknown as { __one: { ui: { setState: (s: unknown) => void } } }).__one.ui.setState({ toasts: [], waitingToasts: [] }))
  await page.mouse.move(2, 890)
  // a second of the page's own ticker reads the set time
  await page.waitForTimeout(1200)
}

test.describe('B14 · the 07:30 picture', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`1440 × 900 (${scheme}, German): Tessera-Spiegel running, the clock FIRED, +3 for review, the dot on its way`, async ({ page }) => {
      mkdirSync(OUT, { recursive: true })
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'no-preference' })
      await at0730(page, 'de')
      await expect(win(page, M.mirror)).toHaveText(/^läuft 0:040,21\s\$$/)
      await expect(win(page, M.clock)).toHaveText('07:30:00ausgelöst')
      await expect(win(page, M.handoff)).toHaveText('+3zur Prüfung')
      await expect(page.locator('.pb-wlabel-t')).toHaveText(['3 Vorschläge'])
      await expect(page.getByTestId('pb-ro-runs')).toHaveText(/^6 · 0,27\s\$$/)
      await expect(page.locator('[data-cell="live"] .pb-ro__val')).toHaveText('07:30:04')
      const dot = page.locator('[data-testid="pb-comet"][data-edge]:not([data-edge=""])')
      await expect(dot).toHaveCount(1)
      await expect(dot).toHaveAttribute('data-edge', E.mirrorToHandoff)
      expect(Math.abs(Number(await dot.getAttribute('data-t')) - 0.85)).toBeLessThan(0.04)
      // noBlink: steady LEDs for the picture
      expect(await mod(page, M.mirror).getByTestId('pb-live-led').evaluate((el) => el.getAnimations().length)).toBe(0)
      await page.screenshot({ path: join(OUT, `live-0730-1440-${scheme}.png`) })
    })
  }

  test('1440 × 900 (light, English): the same state in English words', async ({ page }) => {
    mkdirSync(OUT, { recursive: true })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' })
    await at0730(page, 'en')
    await expect(win(page, M.mirror)).toHaveText('running 0:04$0.21')
    await expect(win(page, M.clock)).toHaveText('07:30:00fired')
    await expect(win(page, M.handoff)).toHaveText('+3for review')
    await expect(page.locator('.pb-wlabel-t')).toHaveText(['3 proposals'])
    await expect(page.getByTestId('pb-ro-runs')).toHaveText('6 · $0.27')
    await page.screenshot({ path: join(OUT, 'live-0730-1440-light-en.png') })
  })
})

test.describe('B14 · the 07:30 picture · 390', () => {
  // a tall page: the app scrolls inside its main region, so the picture holds the whole list only at this height
  test.use({ viewport: { width: 390, height: 3000 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  for (const scheme of ['light', 'dark'] as const) {
    test(`390 (${scheme}, German): the running strand's window, its write line with the dot and "+3"`, async ({ page }) => {
      mkdirSync(OUT, { recursive: true })
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'no-preference' })
      await at0730(page, 'de', false)
      await expect(page.getByTestId('patchbay-page')).toHaveAttribute('data-view', 'strands')
      const strand = page.locator(`[data-testid="pb-strand"][data-key="${M.mirror}"]`)
      await expect(strand.getByTestId('pb-livewin')).toHaveText(/^läuft 0:040,21\s\$$/)
      const write = strand.getByTestId('pb-line').filter({ hasText: 'Tessera Handoff' })
      await expect(write.getByTestId('pb-line-run')).toHaveCount(1)
      await expect(write.getByTestId('pb-line-review')).toHaveText('+3')
      // the line the run came in by keeps its arrow
      await expect(strand.getByTestId('pb-line-run')).toHaveCount(1)
      await expect(page.getByTestId('pb-jump')).toHaveText('läuft · Tessera-Spiegel ↓')
      await page.screenshot({ path: join(OUT, `live-0730-390-${scheme}.png`) })
      await strand.screenshot({ path: join(OUT, `live-0730-390-${scheme}-strand.png`) })
    })
  }
})
