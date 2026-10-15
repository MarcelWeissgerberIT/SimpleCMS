/**
 * The Patchbay's performance budget (plan §4 B17, §1.2, §1.17, §6 A21 / A32) on a large workspace — the perf-budget
 * fixture (tests/e2e/helpers/bigWorkspace.ts: ≈ 13,000 pages, 500 rich, 25 databases × 400 rows) with bigPatchbay(60)
 * wired into it (≈ 64 modules / 126 cables; its agents switched off so nothing calls Claude by itself, a repeating
 * template on „Tessera 2“, a Claude key against a mocked API for autofill):
 *
 *  - boot: `one-patchbay` is opened, the compute chunk requested and the first model built only after the app's first
 *    paint; the ledger (`one-ledger`) is never opened for the LED; the sidebar LED lights from that idle build;
 *  - typing 200 characters in a page — before the Patchbay was ever opened, and again after a visit (the route closed):
 *    0 model builds, 0 input builds, 0 referenced-page rechecks, no button-index read; the longest task the same as
 *    with the Patchbay never opened (and typing in a page the model references — a report page with buttons — rechecks
 *    nothing either: §6 A32, refined in B17);
 *  - #/patchbay: the first rack paint ≤ 250 ms after the chunk (User Timing `pb-first-rack`, ui/paintMark.ts); the model
 *    build (graph + reach + chains + fuses, a fresh input each time) median ≤ 10 ms; relayout (measure + render + commit)
 *    median ≤ 16 ms; the button index's cold build in idle slices, the longest ≤ 50 ms;
 *  - an automation run, an autofill fill and a repeating occurrence: 0 model builds, 0 input builds (their bookkeeping —
 *    `lastRunAt`, `fills`, a template's `lastRunAt` — is no wiring), with the route closed and open.
 * Plus a Node guard: the Patchbay's eager modules (what the boot chunk loads through its index, the hint line and the
 * strings) never import the model, the layout, the inputs or the page statically.
 * Budgets that time something are medians or maxima of several runs; the sharp ones count work. Every name is fictional.
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect, openApp, flush, waitForApp, wsEval } from './fixtures'
import { BIG_DEFAULTS, generateBigWorkspace, type BigInfo } from './helpers/bigWorkspace'
import { bigPatchbay, type PbWorld } from '../fixtures/patchbay'

// no trace: its DOM snapshots of the big workspace are main-thread work the budgets would count
test.use({ trace: 'off' })

const BUDGET = { buildMs: 10, firstRackMs: 250, relayoutMs: 16, buttonSliceMs: 50, typingExtraMs: 30 }
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0
const note = (what: string, value: unknown) => test.info().annotations.push({ type: what, description: JSON.stringify(value) })
const DAY = 86_400_000

/** bigPatchbay(60) for the browser: agents off (still deciders — their fuses stay), a repeating template on „Tessera 2“. */
function perfWorld(): PbWorld {
  const w = bigPatchbay(60)
  for (const [id, a] of Object.entries(w.ws.agents ?? {})) w.ws.agents![id] = { ...a, enabled: false }
  const db = w.ws.databases.dbBig1
  // nothing due at boot (its last run in the future); the test moves it back a day, then the service ticks
  w.ws.databases.dbBig1 = { ...db, templates: [{ id: 'tplBigDaily', name: 'Tagesnotiz', content: null, properties: {}, repeat: { freq: 'daily', time: '06:00', start: '2026-01-01', lastRunAt: Date.now() + 3 * DAY } }] }
  return w
}

interface PbPerf {
  idb: Array<{ name: string; t: number }>
  appPaint: number | null
  long: Array<{ t: number; d: number }>
}

/** Before the app runs (every navigation): IndexedDB opens, the app's first painted frame, long tasks. */
function installCounters() {
  const w = window as unknown as { __pbPerf: PbPerf }
  const pb: PbPerf = (w.__pbPerf = { idb: [], appPaint: null, long: [] })
  const open = IDBFactory.prototype.open
  IDBFactory.prototype.open = function (this: IDBFactory, name: string, version?: number) {
    pb.idb.push({ name: String(name), t: performance.now() })
    return version === undefined ? open.call(this, name) : open.call(this, name, version)
  } as typeof open
  // the app's first paint: the frame in which `.app` is first there (its rAF callbacks run right before that paint)
  const mo = new MutationObserver(() => {
    if (pb.appPaint !== null || !document.querySelector('.app')) return
    pb.appPaint = -1
    mo.disconnect()
    requestAnimationFrame(() => (pb.appPaint = performance.now()))
  })
  mo.observe(document, { childList: true, subtree: true })
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) pb.long.push({ t: e.startTime, d: e.duration })
    }).observe({ type: 'longtask', buffered: true })
  } catch {
    /* no long-task timing */
  }
}

interface Seam {
  builds(): number
  inputBuilds(): number
  pageChecks(): number
  firstBuildAt(): number | null
  buildMs(n?: number): number[]
  buttons(): { ready: boolean; holders: number; dirty: number; build: { slices: number; maxMs: number; pages: number }; catchUps: { runs: number; pages: number; maxMs: number } }
}
interface Work {
  builds: number
  inputBuilds: number
  pageChecks: number
  catchUps: number
}
const work = (page: Page): Promise<Work> =>
  page.evaluate(() => {
    const s = (window as unknown as { __onePatchbay: Seam }).__onePatchbay
    return { builds: s.builds(), inputBuilds: s.inputBuilds(), pageChecks: s.pageChecks(), catchUps: s.buttons().catchUps.runs }
  })
const delta = (a: Work, b: Work): Work => ({ builds: b.builds - a.builds, inputBuilds: b.inputBuilds - a.inputBuilds, pageChecks: b.pageChecks - a.pageChecks, catchUps: b.catchUps - a.catchUps })
const now = (page: Page) => page.evaluate(() => performance.now())
const longest = (page: Page, from: number, to = Infinity) => page.evaluate(({ from, to }) => Math.max(0, ...(window as unknown as { __pbPerf: PbPerf }).__pbPerf.long.filter((x) => x.t >= from && x.t <= to).map((x) => x.d)), { from, to })

/** The big workspace with the Patchbay's world wired into it — ONE replaceAll, saved; the caller reloads (cold boot). */
async function loadBigPatchbay(page: Page, w: PbWorld): Promise<BigInfo> {
  await openApp(page)
  const info = await page.evaluate(
    ({ src, o, w }) => {
      // eslint-disable-next-line no-new-func
      const gen = new Function(`return (${src})`)() as (o: unknown) => { pages: Record<string, unknown>; databases: Record<string, unknown>; people: unknown[]; info: BigInfo }
      const out = gen(o)
      const hook = (window as unknown as { __one: { workspace: { getState: () => Record<string, unknown> & { replaceAll: (ws: unknown) => void; updateSettings: (p: unknown) => void } } } }).__one
      const s = hook.workspace.getState()
      s.replaceAll({
        version: s.version,
        epoch: s.epoch,
        pages: { ...(s.pages as object), ...out.pages, ...w.ws.pages },
        databases: { ...(s.databases as object), ...out.databases, ...w.ws.databases },
        people: [...(s.people as unknown[]), ...out.people],
        settings: { ...(s.settings as object), mcpServers: w.ws.settings.mcpServers ?? [] },
        recent: s.recent,
        functions: s.functions ?? {},
        agents: w.ws.agents ?? {},
        scripts: w.ws.scripts ?? {},
        kit: s.kit,
        integrations: w.ws.integrations ?? [],
        look: s.look,
        ai: s.ai,
        governor: s.governor,
      })
      // a Claude key (sealed by the store) for autofill — answered by the spec's mock, never a real host
      hook.workspace.getState().updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' })
      return out.info
    },
    { src: generateBigWorkspace.toString(), o: BIG_DEFAULTS, w },
  )
  await flush(page)
  return info
}

/** Claude for autofill: every Messages request is answered `{"value": "Kurzfassung n"}` (structured, not streamed). */
async function mockClaudeValues(page: Page): Promise<() => number> {
  let n = 0
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
  await page.context().route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const body = JSON.parse(req.postData() ?? '{}') as { model?: string }
    n++
    return route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify({ id: `msg_pb${n}`, type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify({ value: `Kurzfassung ${n}` }) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 120, output_tokens: 8 } }),
    })
  })
  return () => n
}

/** Type ~200 characters into the open editor in words, with typing pauses (the editor hands its text to the store). */
async function type200(page: Page): Promise<void> {
  const text = ' Nordlicht prüft den Launch plan mit Mara Lind und Tessera, Woche für Woche, ohne Eile und ohne Lärm.'
  for (let round = 0; round < 2; round++)
    for (const word of text.split(/(?= )/)) {
      await page.keyboard.type(word, { delay: 25 })
      await page.waitForTimeout(120)
    }
  await page.waitForTimeout(1500)
}

/** Open a page and put the caret at the end of one of its paragraphs (after a scroll: the column holds still until read). */
async function caretIn(page: Page, id: string, nth: number): Promise<void> {
  await page.evaluate((h) => (window.location.hash = h), `#/p/${id}`)
  const ed = page.locator(`#main .ProseMirror[data-page-id="${id}"]`)
  await expect(ed).toBeVisible({ timeout: 30_000 })
  await page.locator('#main').hover()
  await page.mouse.wheel(0, 200)
  await ed.locator(':scope > p').nth(nth).click()
  await page.keyboard.press('End')
  await page.waitForTimeout(800)
}


const OUT = process.env.PB_SHOTS!
for (const scheme of ['light', 'dark'] as const) {
  test(`big rack shots ${scheme}`, async ({ page }) => {
    test.setTimeout(600_000)
    await page.emulateMedia({ colorScheme: scheme })
    await mockClaudeValues(page)
    await loadBigPatchbay(page, perfWorld())
    await page.addInitScript(() => {
      localStorage.setItem('one.patchbay.seen', '1')
      localStorage.setItem('one.tour', JSON.stringify({ off: true }))
      localStorage.setItem('one.preflight.prefs', JSON.stringify({ hold: false }))
    })
    await page.reload()
    await waitForApp(page)
    await expect.poll(() => page.evaluate(() => (window as unknown as { __onePatchbay?: Seam }).__onePatchbay?.builds() ?? 0), { timeout: 60_000 }).toBeGreaterThan(0)
    await page.evaluate(() => (window.location.hash = '#/patchbay'))
    await expect(page.getByTestId('patchbay-page')).toBeVisible()
    await page.evaluate(() => (window as unknown as { __onePatchbay: { noBlink: () => void } }).__onePatchbay.noBlink())
    await expect.poll(() => page.evaluate(() => (window as unknown as { __onePatchbay: Seam }).__onePatchbay.buttons().ready), { timeout: 60_000 }).toBe(true)
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${OUT}/big-1440-${scheme}.png` })
    await page.screenshot({ path: `${OUT}/big-1440-${scheme}-full.png`, fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${OUT}/big-390-${scheme}.png` })
  })
}
