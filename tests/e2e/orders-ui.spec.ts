/**
 * Work orders (Prüfaufträge) B8 — the plate proper (spec §1.3–§1.8, §6 B8): a fake worker on CODING_E2E_PORT,
 * api.anthropic.com scripted (the planner's answers; the server "Wissensbasis" is fictional and never contacted — the
 * script plays its blocks). Fictional data only (Nordlicht, Tessera, Mara Lind, Login-Timeout, Wissensbasis).
 *  - Kette bereit: one station per step (sticky head, project · repo · where it stops, goal, criteria, the pages that go
 *    along in folds with their tags), FREMD where the server took part, the Kontext box with its call list, the cost line
 *    and "Budget je Kette" (the chain takes it); ↵ Kette starten acts only once every station, every page fold and the
 *    Kontext box were seen in full — its reason says what is missing;
 *  - the keys act only with focus in the plate, never while typing; Esc never discards (focus to the heading); E edits a
 *    step (Esc cancels, Mod+↵ saves), Alt+↑/↓ moves, Entf removes (Z puts it back), R asks after edits, D discards and Z
 *    takes it back — focus after each key; the edited plan is the one that starts;
 *  - questions only: the plate asks, the answers go to the planner; planning: the lines while it plans, ⌘. stops it and
 *    writes nothing; reduced motion: nothing blinks;
 *  - the run: the Laufleiste's "wartet auf 01", the chips on the #/coding boards, the task panel's chain line, the end's
 *    results + W (one callout, W again replaces it); Approvals all: the gate card's "Freigeben startet den nächsten
 *    Schritt" with the fold — seen whole, the approval passes the analysis checkpoint;
 *  - 390 px: the lamps 2 × 2, the keys a bar at the bottom, the floating keys out of the way, no sideways scroll; the
 *    plate and its settings at XL text size, English and German.
 * Node cases: the plate's strings (EN = DE, placeholders, the names).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval, gotoPage } from './fixtures'
import { mockClaudeScript, type ClaudeTurn } from './helpers/providers'
import { startFakeWorker, type FakeWorker } from './helpers/fakeWorker'
import { readPlan } from './helpers/orders'
import { test as node, expect as nodeExpect } from '@playwright/test'
import { WORKER_CAN, type WorkerInfo } from '../../src/app/features/coding/protocol'
import { messages as plate } from '../../src/app/features/coding/orders/plateMessages'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** CODING_E2E_PORT: one port for the coding suites when they run side by side (one worker at a time) */
const PORT = Number(process.env.CODING_E2E_PORT) || 47384

const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/ai/anthropic/orders-plan-kb.json', import.meta.url)), 'utf8')) as AnyState
const CASE = 'pgcase000001'
const OTHER = 'pgother00001'
const ST = { draft: 'woDraft01', plan: 'woPlan001', ready: 'woReady01', running: 'woRun0001', halted: 'woHalt001', done: 'woDone001' }
const statusOptions = [
  { id: ST.draft, name: 'Draft', color: 'gray' },
  { id: ST.plan, name: 'Plan', color: 'blue' },
  { id: ST.ready, name: 'Chain ready', color: 'yellow' },
  { id: ST.running, name: 'Running', color: 'orange' },
  { id: ST.halted, name: 'Halted', color: 'red' },
  { id: ST.done, name: 'Done', color: 'green' },
]
const KB = { id: 'srvkb000001', name: 'wissensbasis', url: 'https://kb.example.test/mcp', token: 'kb-e2e-PLAINTEXT-token-0001', enabled: true, prompt: '**Wissensbasis** holds the support records.', promptSource: 'auto', tools: ['kb_search', 'kb_get'], checkedAt: 1 }
const WELCOME: WorkerInfo = { worker: '1.11.0', name: 'website-box', repos: [{ name: 'website', baseBranch: 'main', branches: ['main', 'one/nordlicht-footer'], mcp: [] }], parallel: 1, busy: [], spentToday: 0, dayLimit: null, claude: { found: true, version: '2.0.0' }, setup: true, mcp: [] }
const REQUEST = 'Prüfe, warum der Login von Nordlicht nach 30 Sekunden abbricht. Siehe '
const BRANCH = 'one/login-timeout'
const EDITED = 'Session-Timeout im Gateway beheben'

type Seam = { __oneOrders: Record<string, (...a: any[]) => Promise<any>>; __onePreflight: { stores: { coding: { getState: () => AnyState } } }; __oneCodingWrites: Record<string, (...a: any[]) => any> } // eslint-disable-line @typescript-eslint/no-explicit-any
const call = (page: Page, name: string, ...args: unknown[]) => page.evaluate(([n, a]) => (window as unknown as Seam).__oneOrders[n as string]!(...(a as unknown[])), [name, args] as const)
const orders = (page: Page) => ({
  plan: (row: string) => call(page, 'plan', row, { mode: 'manual', replace: true }) as Promise<AnyState>,
  record: (row: string) => call(page, 'record', row) as Promise<AnyState | null>,
  start: (row: string) => call(page, 'start', row) as Promise<AnyState>,
  startNow: (row: string) => call(page, 'startNow', row) as Promise<AnyState>,
  move: (row: string) => call(page, 'move', row) as Promise<AnyState | null>,
  advance: (row: string, step: number, passes: string[]) => call(page, 'advance', row, step, passes) as Promise<AnyState>,
})

const fill = (plan: AnyState) => JSON.parse(JSON.stringify(plan).split('{{case}}').join(CASE).split('{{other}}').join(OTHER)) as AnyState
const noContext = (): AnyState => ({ ...fill(FIXTURE.plan), context: null })
/** The planner's answer: the fixture's plan (or `plan`), with the server's blocks before it when `calls`. */
function answer(o: { calls?: boolean; plan?: AnyState } = {}): ClaudeTurn {
  const plan = o.plan ?? fill(FIXTURE.plan)
  const blocks: ClaudeTurn['blocks'] = []
  if (o.calls) for (const c of FIXTURE.calls) blocks.push({ type: 'mcp_tool_use', id: c.id, server: c.server, name: c.name, input: c.input }, { type: 'mcp_tool_result', id: c.id, text: c.result })
  blocks.push({ type: 'text', text: JSON.stringify(plan) })
  return { blocks, usage: { input: 3200, output: 900 } }
}

/**
 * Coding on (this device), the fake worker, the AI key, a work-orders database with one request, the three pipeline
 * projects made up front (their seed task removed); `server`: Wissensbasis picked; `approvals`: this device's default.
 */
async function setup(page: Page, o: { server?: boolean; approvals?: 'all' | 'review' | 'none'; lang?: 'en' | 'de' } = {}) {
  await page.addInitScript(
    ([port, approvals]) => {
      localStorage.setItem('one.coding', JSON.stringify({ enabled: true, port }))
      localStorage.setItem('one.tour', '{"off":true}')
      if (approvals) localStorage.setItem('one.coding.approvals', approvals)
    },
    [PORT, o.approvals ?? null] as const,
  )
  await openApp(page)
  await wsEval(page, (s, a) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', mcpServers: a.server ? [a.kb] : [], ...(a.lang ? { language: a.lang } : {}) }), { server: !!o.server, kb: KB, lang: o.lang ?? null })
  const ids = await wsEval(
    page,
    (s, a) => {
      const p = (id: string, name: string, type: string, extra: AnyState = {}) => ({ id, name, type, ...extra })
      s.createPage({ id: a.CASE, title: 'Supportfall 4711', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Kunde Tessera meldet: der Login bricht nach 30 Sekunden ab, die Eingaben sind weg. Gemeldet von Mara Lind.' }] }] } })
      s.createPage({ id: a.OTHER, title: 'Tessera intern', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Interne Notizen.' }] }] } })
      const db = s.createDatabase({
        title: 'Work orders',
        properties: [p('woName', 'Name', 'title'), p('woStatus', 'Status', 'select', { options: a.statusOptions }), p('woRepo', 'Repo', 'select', { options: [{ id: 'rWeb', name: 'website', color: 'gray' }] }), p('woId', 'ID', 'unique_id', { idPrefix: 'PA' })],
      })
      s.updateDatabase(db, { system: 'workorders', orders: { v: 1, status: a.ST, server: a.server ? { name: 'wissensbasis' } : null, kinds: ['spec', 'coding', 'qa'], checkpoint: true } })
      const body = [{ type: 'paragraph', content: [{ type: 'text', text: a.REQUEST }, { type: 'mention', attrs: { id: a.CASE, label: 'Supportfall 4711', kind: 'page' } }, { type: 'text', text: '. Repo website.' }] }]
      const row = s.createRow(db, { title: 'Login-Timeout prüfen', properties: { woStatus: a.ST.plan, woRepo: 'rWeb' }, content: { type: 'doc', content: body } })
      return { db, row }
    },
    { CASE, OTHER, ST, statusOptions, server: !!o.server, REQUEST },
  )
  for (const kind of ['spec', 'coding', 'qa']) {
    const seed = await page.evaluate((k) => (window as unknown as Seam).__oneCodingWrites.create('seed', k), kind)
    await wsEval(page, (s, id) => s.deletePagePermanently(id), seed as string)
  }
  await expect.poll(() => page.evaluate(() => (window as unknown as Seam).__onePreflight.stores.coding.getState().conn), { timeout: 30_000 }).toBe('connected')
  return ids
}

const statusOf = (page: Page, row: string) => wsEval(page, (s, id) => s.pages[id].properties.woStatus as string, row)
const stageOf = (page: Page, id: string) =>
  wsEval(
    page,
    (s, id) => {
      const row = s.pages[id]
      const db = s.databases[row.databaseId]
      const stage = db.properties.find((p: AnyState) => p.name === 'Stage')
      return (stage.options.find((o: AnyState) => o.id === row.properties[stage.id])?.name ?? null) as string | null
    },
    id,
  )
const pageOf = (page: Page, id: string) => wsEval(page, (s, x) => s.pages[x] as AnyState, id)
const blocksWithId = (doc: AnyState, id: string): AnyState[] => {
  const out: AnyState[] = []
  const walk = (n: AnyState) => {
    if (n.attrs?.id === id) out.push(n)
    for (const c of n.content ?? []) walk(c)
  }
  walk(doc)
  return out
}
const textOf = (node: AnyState): string => (node.type === 'text' ? node.text : (node.content ?? []).map(textOf).join(node.type === 'doc' || node.type === 'callout' || node.type === 'bulletList' ? '\n' : ''))

/** What the fake worker answers per stage kind. */
function plays(fake: FakeWorker) {
  fake.auto = (task) => {
    const kind = task.stage.kind as string
    if (kind === 'doc' || kind === 'analyze') return { status: 'ok', plan: `## ${task.stage.name}\n\nErgebnis von ${task.stage.name}: der Gateway beendet die Sitzung nach 30 s (Nordlicht).`, cost: 0.4 }
    if (kind === 'plan') return { status: 'ok', plan: 'Plan: Session-Timeout im Gateway auf 5 Minuten setzen.', cost: 0.3 }
    if (kind === 'implement') return { status: 'ok', summary: 'Timeout geändert.', branch: BRANCH, cost: 1.1 }
    if (kind === 'test') return { status: 'ok', test: { ok: true, output: 'ok', ms: 12, code: 0 } }
    if (kind === 'git') return { status: 'ok', branch: BRANCH, url: 'https://git.example.test/nordlicht/website/-/merge_requests/7' }
    return { status: 'ok' }
  }
}

/* ------------------------------------------------------------------ the audit (ui-fit's, for the plate) */

/** Everything inside the roots stays inside its box and on screen (a strip that scrolls sideways on purpose is fine). */
function audit(selector: string): string[] {
  const vw = document.documentElement.clientWidth
  const out: string[] = []
  const shown = (el: Element) => {
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') return false
    const r = el.getBoundingClientRect()
    return r.width > 1 && r.height > 1
  }
  const name = (el: Element) => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''
    const txt = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24)
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${txt ? ` "${txt}"` : ''}`
  }
  const clipOf = (el: Element, root: Element) => {
    let a = el.parentElement
    while (a && a !== root) {
      const cs = getComputedStyle(a)
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') return a
      a = a.parentElement
    }
    return root
  }
  const roots = [...document.querySelectorAll(selector)].filter(shown)
  if (!roots.length) return ['nothing open']
  for (const root of roots) {
    const rn = name(root)
    if (root.scrollWidth > root.clientWidth + 1 && getComputedStyle(root).overflowX !== 'visible') out.push(`${rn}: scrolls sideways (${root.scrollWidth} > ${root.clientWidth})`)
    for (const el of root.querySelectorAll('*')) {
      if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue
      if (!shown(el) || getComputedStyle(el).position === 'fixed') continue
      const clip = clipOf(el, root)
      const ccs = getComputedStyle(clip)
      if (clip !== root && (ccs.overflowX === 'auto' || ccs.overflowX === 'scroll')) continue
      const cr = clip.getBoundingClientRect()
      const left = cr.left + clip.clientLeft
      const right = left + clip.clientWidth
      const er = el.getBoundingClientRect()
      if (er.right > right + 1.5 || er.left < left - 1.5) out.push(`${rn}: ${name(el)} runs past ${name(clip).slice(0, 30)} (${Math.round(er.left)}–${Math.round(er.right)} vs ${Math.round(left)}–${Math.round(right)})`)
      else if (er.right > vw + 1 || er.left < -1) out.push(`${rn}: ${name(el)} outside the viewport`)
    }
  }
  return [...new Set(out)]
}
const sideways = (page: Page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth - innerWidth, ...[...document.querySelectorAll('#main, .page-col, main')].map((el) => el.scrollWidth - el.clientWidth)))

test.describe('the work order plate (B8)', () => {
  test.describe.configure({ mode: 'serial' })
  let fake: FakeWorker | null = null
  test.beforeEach(async ({ errors }) => {
    errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
    fake = await startFakeWorker(PORT, WELCOME)
    fake.can = [...WORKER_CAN]
  })
  test.afterEach(async () => {
    await fake?.close()
    fake = null
  })

  test('Kette bereit: stations, FREMD, the Kontext box with its calls; ↵ waits until each station, page and the context was seen in full; the budget goes with the chain', async ({ page }) => {
    await mockClaudeScript(page.context(), [answer({ calls: true })])
    const { row } = await setup(page, { server: true })
    expect(await orders(page).plan(row)).toMatchObject({ kind: 'ready' })
    await gotoPage(page, row)
    const plate = page.getByTestId('order-plate')
    const stations = plate.getByTestId('order-plan-step')
    await expect(stations).toHaveCount(3)
    await expect(plate.getByTestId('order-counter')).toContainText('3 steps')
    await expect(plate.getByTestId('order-understood')).toContainText('Session-Timeout im Gateway')
    // each station: number, kind, title in a head that stays on top while it scrolls; project · repo · where it stops
    const heads = plate.getByTestId('order-station-head')
    await expect(heads.nth(0)).toContainText('01')
    await expect(heads.nth(0)).toContainText('Login-Timeout klären')
    expect(await heads.nth(0).evaluate((el) => getComputedStyle(el).position)).toBe('sticky')
    await expect(stations.nth(1)).toContainText('Repo website')
    await expect(stations.nth(1)).toContainText('Login bleibt 5 Minuten offen')
    await expect(stations.nth(0)).toContainText('Unklar, ob das Gateway oder die App den Login beendet.')
    // the server took part: FREMD on every station and the request; the Kontext box names its call and what goes along
    for (let i = 0; i < 3; i++) await expect(heads.nth(i).getByTestId('order-tag-foreign')).toBeVisible()
    const ctx = plate.getByTestId('order-context')
    await expect(ctx).toContainText('Supportfall 4711 (Nordlicht)')
    await expect(ctx).toContainText('goes along in step 01')
    await expect(ctx.getByTestId('order-call')).toHaveCount(1)
    await expect(ctx.getByTestId('order-call')).toContainText('kb_search')
    await expect(plate.getByTestId('order-lamp-context')).toContainText(/wissensbasis · read only · \d tools?/)
    await expect(plate.getByTestId('order-plan-noserver')).toBeVisible()
    await expect(plate.getByTestId('order-cost')).toBeVisible()
    // ↵ is not ready: nothing was seen in full yet — a click does nothing
    const start = plate.getByTestId('order-start')
    await expect(start).toHaveAttribute('aria-disabled', 'true')
    await expect(start).toHaveAttribute('aria-describedby', /orc-why-/)
    await expect(plate.getByTestId('order-start-why')).toHaveText(/^(See the server’s context in full first|See every step in full first — still: .+|Open the pages that go along first — .+)$/)
    await start.dispatchEvent('click')
    expect((await orders(page).record(row))!.state).toBe('draft')
    // scrolled through: only the page that goes along in step 01 is missing — opened, ↵ is ready
    await page.keyboard.press('Shift')
    const edges = plate.locator('[data-testid="order-ready"] .orc-edge')
    for (let i = 0; i < (await edges.count()); i++) await edges.nth(i).scrollIntoViewIfNeeded()
    await expect(plate.getByTestId('order-start-why')).toHaveText(/^Open the pages that go along first — 01: Supportfall 4711/)
    const ref = stations.nth(0).getByTestId('order-plan-ref').first()
    await ref.locator('summary').click()
    await expect(ref).toContainText('Kunde Tessera meldet')
    await readPlan(page)
    for (let i = 0; i < 3; i++) await expect(stations.nth(i)).toHaveAttribute('data-seen', '')
    await expect(plate.getByTestId('order-start-why')).toHaveCount(0)
    await expect(start).toHaveAttribute('data-ready', '')
    await expect(start).toHaveText('↵Start chain · with server content')
    // "Budget je Kette": a quick key sets it for this chain; ↵ starts it with that budget
    await plate.getByTestId('order-budget-10').click()
    await expect(plate.getByTestId('order-budget-input')).toHaveValue('10.00')
    await expect.poll(async () => (await orders(page).record(row))!.draft.budget).toBe(10)
    await expect(start).toHaveAttribute('data-ready', '')
    await start.click()
    await expect(plate.getByTestId('order-countdown')).toBeVisible()
    const rec = (await orders(page).record(row))!
    expect(rec.state).toBe('running')
    expect(rec.chain.budgetUsd).toBe(10)
  })

  test('keys only with focus in the plate, never while typing; Esc never discards; E · Alt+↑/↓ · Entf + Z · R asks · D + Z — focus after each; the edited plan starts', async ({ page }) => {
    await mockClaudeScript(page.context(), [], { fallback: answer({ plan: noContext() }) })
    const { row } = await setup(page)
    expect(await orders(page).plan(row)).toMatchObject({ kind: 'ready' })
    await gotoPage(page, row)
    const plate = page.getByTestId('order-plate')
    const heads = plate.getByTestId('order-station-head')
    await expect(heads).toHaveCount(3)
    // no server picked: no Kontext box, no line about one
    await expect(plate.getByTestId('order-context')).toHaveCount(0)
    await expect(plate.getByTestId('order-skip')).toHaveCount(0)

    // focus outside the plate: its keys do nothing
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    for (const key of ['d', 'r', 'e', 'Delete']) await page.keyboard.press(key)
    await page.waitForTimeout(300)
    expect(await statusOf(page, row)).toBe(ST.ready)
    await expect(heads).toHaveCount(3)
    await expect(plate.getByTestId('order-step-edit')).toHaveCount(0)

    // typing in the plate's own field: letters are text
    const budget = plate.getByTestId('order-budget-input')
    await budget.click()
    await page.keyboard.type('dre')
    await expect(budget).toHaveValue('dre')
    await page.keyboard.press('Delete')
    expect(await statusOf(page, row)).toBe(ST.ready)
    await expect(plate.getByTestId('order-step-edit')).toHaveCount(0)
    await budget.fill('')
    await budget.press('Enter')

    // Esc never discards: focus goes to the plate's heading, the plan stays
    await heads.nth(0).focus()
    await page.keyboard.press('Escape')
    await expect(plate.locator('.orp-code')).toBeFocused()
    expect(await statusOf(page, row)).toBe(ST.ready)
    expect((await orders(page).record(row))!.state).toBe('draft')

    // E edits the focused station; the form takes the keys (d, r are text); ↵ waits meanwhile; Esc cancels
    await heads.nth(1).focus()
    await page.keyboard.press('e')
    const form = plate.getByTestId('order-step-edit')
    const title = plate.getByTestId('order-edit-title')
    await expect(form).toBeVisible()
    await expect(title).toBeFocused()
    await page.keyboard.press('End')
    await page.keyboard.type(' dr')
    await expect(title).toHaveValue('Session-Timeout beheben dr')
    await expect(plate.getByTestId('order-start-why')).toHaveText('Finish the edit first')
    await page.keyboard.press('Escape')
    await expect(form).toHaveCount(0)
    await expect(heads.nth(1)).toBeFocused()
    expect((await orders(page).record(row))!.draft.edited).toBeFalsy()
    // again, saved with Mod+↵: the station shows it, focus back on its head, the draft is "edited" with a new hash
    const hashBefore = (await orders(page).record(row))!.draft.hash
    await page.keyboard.press('e')
    await title.fill(EDITED)
    await page.keyboard.press('ControlOrMeta+Enter')
    await expect(form).toHaveCount(0)
    await expect(heads.nth(1)).toContainText(EDITED)
    await expect(heads.nth(1)).toBeFocused()
    let rec = (await orders(page).record(row))!
    expect(rec.draft.edited).toBe(true)
    expect(rec.draft.plan.steps[1].title).toBe(EDITED)
    expect(rec.draft.hash).not.toBe(hashBefore)
    // an empty title is refused with its reason, nothing written
    await page.keyboard.press('e')
    await title.fill('   ')
    await plate.getByTestId('order-edit-save').click()
    await expect(plate.getByTestId('order-edit-error')).toBeVisible()
    await title.press('Escape')
    await expect(heads.nth(1)).toBeFocused()
    expect((await orders(page).record(row))!.draft.plan.steps[1].title).toBe(EDITED)

    // Alt+↑ / Alt+↓ move the focused station; focus moves with it
    await page.keyboard.press('Alt+ArrowUp')
    await expect(heads.nth(0)).toContainText(EDITED)
    await expect(heads.nth(0)).toBeFocused()
    expect((await orders(page).record(row))!.draft.plan.steps.map((s: AnyState) => s.kind)).toEqual(['coding', 'spec', 'qa'])
    await page.keyboard.press('Alt+ArrowDown')
    await expect(heads.nth(1)).toContainText(EDITED)
    await expect(heads.nth(1)).toBeFocused()

    // Entf removes it (toast with Undo); focus to the station now in its place; Z puts it back
    await heads.nth(2).focus()
    await page.keyboard.press('Delete')
    await expect(heads).toHaveCount(2)
    await expect(page.getByText('Step 03 removed')).toBeVisible()
    await expect(heads.nth(1)).toBeFocused()
    await page.keyboard.press('z')
    await expect(heads).toHaveCount(3)
    await expect(heads.nth(2)).toContainText('Login-Timeout testen')
    expect((await orders(page).record(row))!.draft.plan.steps).toHaveLength(3)

    // R after an edit asks first; Esc keeps the plan
    await heads.nth(0).focus()
    await page.keyboard.press('r')
    const ask = page.getByRole('dialog')
    await expect(ask).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(ask).toHaveCount(0)
    rec = (await orders(page).record(row))!
    expect(rec.draft.plan.steps[1].title).toBe(EDITED)
    expect(await statusOf(page, row)).toBe(ST.ready)

    // D discards (Status Entwurf, a toast with Undo); focus on the heading; Z with focus in the plate takes it back
    await heads.nth(0).focus()
    await page.keyboard.press('d')
    await expect.poll(() => statusOf(page, row)).toBe(ST.draft)
    await expect(plate.getByTestId('order-ready')).toHaveCount(0)
    await expect(plate.locator('.orp-code')).toBeFocused()
    await expect.poll(async () => (await orders(page).record(row))!.state).toBe('discarded')
    await page.keyboard.press('z')
    await expect.poll(() => statusOf(page, row)).toBe(ST.ready)
    await expect(heads).toHaveCount(3)
    await expect(heads.nth(1)).toContainText(EDITED)

    // the edited plan is the one that starts
    await readPlan(page)
    const start = plate.getByTestId('order-start')
    await expect(start).toHaveAttribute('data-ready', '')
    await start.click()
    await expect(plate.getByTestId('order-countdown')).toBeVisible()
    rec = (await orders(page).record(row))!
    const step2 = rec.chain.steps.find((s: AnyState) => s.n === 2)
    expect((await pageOf(page, step2.id)).title).toBe(EDITED)
  })

  test('questions only: the plate asks, typing there is text; the answers go into the request and it plans again', async ({ page }) => {
    const ask = { v: 1, summary: 'Unklar, welcher Login gemeint ist.', context: null, steps: [], questions: ['Welcher Login ist gemeint — Web oder App?'], refused: null }
    await mockClaudeScript(page.context(), [answer({ plan: ask })], { fallback: answer({ plan: noContext() }) })
    const { row } = await setup(page)
    expect(await orders(page).plan(row)).toMatchObject({ kind: 'questions' })
    await gotoPage(page, row)
    const plate = page.getByTestId('order-plate')
    const asked = plate.getByTestId('order-ask')
    await expect(asked).toContainText('Welcher Login ist gemeint — Web oder App?')
    const field = asked.getByTestId('order-answer').first()
    await field.click()
    await page.keyboard.type('Der Web-Login von Nordlicht. dr')
    expect(await statusOf(page, row)).toBe(ST.plan)
    await asked.getByTestId('order-answer-send').click()
    await expect(plate.getByTestId('order-plan-step')).toHaveCount(3, { timeout: 20_000 })
    expect(textOf((await pageOf(page, row)).content)).toContain('Der Web-Login von Nordlicht. dr')
    expect(await statusOf(page, row)).toBe(ST.ready)
  })

  test('planning: the lines while it plans; ⌘. with focus in the plate stops it and writes nothing; reduced motion: nothing blinks', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await mockClaudeScript(page.context(), [], { fallback: answer({ plan: noContext() }) })
    // the planner's request hangs until it is stopped (registered last: it goes first)
    await page.context().route('https://api.anthropic.com/v1/messages**', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      await new Promise((r) => setTimeout(r, 20_000))
      await route.fallback().catch(() => undefined)
    })
    const { row } = await setup(page)
    await gotoPage(page, row)
    const plate = page.getByTestId('order-plate')
    await plate.getByTestId('order-plan').click()
    const planning = plate.getByTestId('order-planning')
    await expect(planning).toHaveAttribute('data-phase', 'asking', { timeout: 15_000 })
    await expect(plate.getByTestId('order-planning-phase')).toHaveText('The planner plans …')
    await expect(plate.getByTestId('order-planning-read')).toHaveText(/^Request read · [\d,]+ characters · 1 linked page$/)
    expect(await plate.getByTestId('order-planning-phase').evaluate((el) => getComputedStyle(el, '::before').animationName)).toBe('none')
    expect(await plate.locator('.orp-status .led').first().evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
    // the plan keys stay away while it plans; ⌘. stops it
    await expect(plate.getByTestId('order-keys')).toHaveCount(0)
    await plate.getByTestId('order-plan-stop').focus()
    await page.keyboard.press('ControlOrMeta+.')
    await expect(planning).toHaveCount(0)
    await expect(plate.getByTestId('order-outcome')).toHaveAttribute('data-outcome', 'stopped')
    const rec = await orders(page).record(row)
    expect(rec?.draft?.plan?.steps ?? []).toEqual([])
    expect(await statusOf(page, row)).toBe(ST.plan)
  })

  test('the run: "waits for 01" on the Laufleiste, the chips on #/coding, the task panel line; at the end the results and W (one callout, W again replaces it)', async ({ page }) => {
    test.slow()
    await mockClaudeScript(page.context(), [], { fallback: answer({ plan: noContext() }) })
    const { row } = await setup(page, { approvals: 'none' })
    plays(fake!)
    expect(await orders(page).plan(row)).toMatchObject({ kind: 'ready' })
    const out = await orders(page).start(row)
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true })
    const ids = out.steps as string[]
    await gotoPage(page, row)
    const plate = page.getByTestId('order-plate')
    const rows = plate.getByTestId('order-chain-row')
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(1)).toContainText('waits for 01')
    await expect(rows.nth(2)).toContainText('waits for 02')

    // the coding board: step 02's card says whose step it is and what it waits for (no fields read)
    await page.evaluate(() => (window.location.hash = '#/coding'))
    const chip = page.getByTestId('order-card-chip').filter({ hasText: 'PA-1' })
    await expect(chip.first()).toHaveText('PA-1 · waits for 01')
    await expect(chip.first()).toHaveAttribute('data-parked', '')
    // the task panel of step 02: its chain line, its key opens the request
    await gotoPage(page, ids[1]!)
    const line = page.getByTestId('coding-chain-line')
    await expect(line).toContainText(/^Part of work order PA-1 · step 2 of 3 · next step: 03 /)
    await page.getByTestId('coding-chain-open').click()
    await expect(page.getByTestId('order-plate')).toBeVisible()

    // the chain runs through (the analysis card passed by the seam), the end lists each step's result
    await orders(page).startNow(row)
    await expect.poll(async () => (await orders(page).move(row))?.why ?? null, { timeout: 40_000 }).toBe('checkpoint')
    await orders(page).advance(row, 2, ['checkpoint'])
    await expect.poll(async () => (await orders(page).record(row))!.state, { timeout: 60_000 }).toBe('done')
    expect(await stageOf(page, ids[2]!)).toBe('Done')
    const results = plate.getByTestId('order-result')
    await expect(results).toHaveCount(3)
    await expect(results.nth(1)).toContainText('02')
    // W with focus in the plate: ONE callout in the request; W again replaces it
    await plate.locator('.orp-code').focus()
    await page.keyboard.press('w')
    const run = (await orders(page).record(row))!.chain.run as string
    const id = `${row}-sum-${run}`.slice(0, 120)
    await expect.poll(async () => blocksWithId((await pageOf(page, row)).content, id).length).toBe(1)
    const block = blocksWithId((await pageOf(page, row)).content, id)[0]!
    expect(block.type).toBe('callout')
    expect(textOf(block)).toContain('Work order PA-1 — result')
    await plate.locator('.orp-code').focus()
    await page.keyboard.press('w')
    await page.waitForTimeout(400)
    expect(blocksWithId((await pageOf(page, row)).content, id)).toHaveLength(1)
  })

  test('Approvals all: the gate card says which step its approval starts; its fold seen whole passes the analysis checkpoint (no second press)', async ({ page }) => {
    test.slow()
    await mockClaudeScript(page.context(), [], { fallback: answer({ plan: noContext() }) })
    const { row } = await setup(page, { approvals: 'all' })
    plays(fake!)
    expect(await orders(page).plan(row)).toMatchObject({ kind: 'ready' })
    const out = await orders(page).start(row)
    const ids = out.steps as string[]
    await orders(page).startNow(row)
    await expect.poll(() => stageOf(page, ids[0]!), { timeout: 40_000 }).toBe('Approve spec')
    await gotoPage(page, ids[0]!)
    const next = page.getByTestId('order-gate-next')
    await expect(next).toContainText('Approving starts the next step: 02 · ')
    await expect(next).toContainText('‹Session-Timeout beheben›')
    await expect(next).not.toHaveAttribute('data-seen', '')
    await page.keyboard.press('Shift')
    await page.getByTestId('order-gate-next-fold').locator('summary').click()
    await expect(page.getByTestId('order-gate-next-fold')).toContainText('Session-Timeout so ändern')
    await page.getByTestId('order-gate-next-fold').locator('.orc-edge').scrollIntoViewIfNeeded()
    await expect(next).toHaveAttribute('data-seen', '')
    const approve = page.getByTestId('coding-approve')
    await expect(approve).toHaveAttribute('data-ready', '')
    await approve.click()
    // step 02 starts without the analysis card
    await expect.poll(async () => (await orders(page).record(row))!.chain.advanced?.['2'] ?? null, { timeout: 30_000 }).not.toBeNull()
    expect((await orders(page).move(row))?.why ?? null).not.toBe('checkpoint')
  })

  test('390 px: the lamps 2 × 2, the keys a bar at the bottom, the floating keys out of the way, no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await mockClaudeScript(page.context(), [answer({ calls: true })])
    const { row } = await setup(page, { server: true })
    expect(await orders(page).plan(row)).toMatchObject({ kind: 'ready' })
    await gotoPage(page, row)
    const plate = page.getByTestId('order-plate')
    await expect(plate.getByTestId('order-plan-step')).toHaveCount(3)
    const boxes = await Promise.all(['coding', 'worker', 'context', 'planner'].map((k) => plate.getByTestId(`order-lamp-${k}`).boundingBox()))
    expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThan(2)
    expect(boxes[2]!.y).toBeGreaterThan(boxes[0]!.y + 4)
    expect(Math.abs(boxes[2]!.x - boxes[0]!.x)).toBeLessThan(2)
    await expect(page.locator('html')).toHaveAttribute('data-bottom-bar', '')
    // the keys row sticks to the bottom while the plate's top is on screen
    await page.keyboard.press('Shift')
    await plate.locator('.orp-code').scrollIntoViewIfNeeded()
    const keys = plate.getByTestId('order-keys')
    expect(await keys.evaluate((el) => getComputedStyle(el).position)).toBe('sticky')
    const kb = (await keys.boundingBox())!
    expect(kb.y + kb.height).toBeLessThanOrEqual(844 + 1)
    expect(kb.y).toBeGreaterThan(844 - 200)
    await expect(plate.getByTestId('order-start')).toBeInViewport()
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    expect(await page.evaluate(audit, '[data-testid="order-plate"]')).toEqual([])
    // the floating capture key steps aside while the plate is here
    const fab = page.locator('.qcap-fab')
    if (await fab.count()) expect(await fab.first().evaluate((el) => getComputedStyle(el).visibility)).toBe('hidden')
    // leaving the plate gives the floating keys back
    await page.evaluate(() => (window.location.hash = '#/'))
    await expect(page.locator('html')).not.toHaveAttribute('data-bottom-bar', '')
  })

  test('XL text size: the plate (Kette bereit, the Kontext box, an edit) and its settings fit at 1440 and 390, English and German', async ({ page }) => {
    test.slow()
    await page.addInitScript(() => localStorage.setItem('one.textScale', '4'))
    await mockClaudeScript(page.context(), [answer({ calls: true })])
    const { row } = await setup(page, { server: true })
    expect(await orders(page).plan(row)).toMatchObject({ kind: 'ready' })
    await gotoPage(page, row)
    const plate = page.getByTestId('order-plate')
    await expect(plate.getByTestId('order-plan-step')).toHaveCount(3)
    await readPlan(page)
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width > 600 ? 900 : 844 })
      for (const lang of ['en', 'de'] as const) {
        await wsEval(page, (s, l) => s.updateSettings({ language: l }), lang)
        await page.waitForTimeout(250)
        expect(await page.evaluate(audit, '[data-testid="order-plate"]'), `the plate (XL, ${width}, ${lang})`).toEqual([])
        expect(await sideways(page), `no sideways scroll (XL, ${width}, ${lang})`).toBeLessThanOrEqual(0)
        // an edit open in the station
        await plate.getByTestId('order-station-head').nth(1).focus()
        await page.keyboard.press('e')
        await expect(plate.getByTestId('order-step-edit')).toBeVisible()
        expect(await page.evaluate(audit, '[data-testid="order-plate"]'), `the plate with an edit (XL, ${width}, ${lang})`).toEqual([])
        await page.keyboard.press('Escape')
        await expect(plate.getByTestId('order-step-edit')).toHaveCount(0)
        // the settings popover
        await plate.getByTestId('order-settings-key').first().click()
        await expect(page.getByTestId('order-settings')).toBeVisible()
        await page.waitForTimeout(200)
        expect(await page.evaluate(audit, '[data-popover=""]'), `the settings (XL, ${width}, ${lang})`).toEqual([])
        await page.keyboard.press('Escape')
        await expect(page.getByTestId('order-settings')).toHaveCount(0)
        await expect(plate.getByTestId('order-settings-key').first()).toBeFocused()
      }
      await wsEval(page, (s) => s.updateSettings({ language: 'en' }))
    }
  })

  test('the settings popover: the server picked (tested, its read tools), "without server" — the lamp follows; the database keeps it', async ({ page }) => {
    await mockClaudeScript(page.context(), [], { fallback: answer({ plan: noContext() }) })
    const { row, db } = await setup(page, { server: true })
    await gotoPage(page, row)
    const plate = page.getByTestId('order-plate')
    await expect(plate.getByTestId('order-lamp-context')).toContainText('wissensbasis')
    await plate.getByTestId('order-settings-key').first().click()
    const pop = page.getByTestId('order-settings')
    await expect(pop).toBeVisible()
    await expect(pop.getByTestId('order-server-row')).toHaveCount(1)
    await expect(pop.getByTestId('order-server-wissensbasis')).toBeChecked()
    await pop.getByTestId('order-server-none').check()
    await expect.poll(() => wsEval(page, (s, id) => s.databases[id].orders?.server ?? null, db)).toBeNull()
    await page.keyboard.press('Escape')
    await expect(plate.getByTestId('order-lamp-context')).not.toContainText('wissensbasis')
  })
})

/* ------------------------------------------------------------------ Node cases */

node('the plate\'s strings: EN = DE (keys and placeholders), the names, never "danach" / "Plan bereit" / "Prüfung"', () => {
  const en = plate.en as Record<string, string>
  const de = plate.de as Record<string, string>
  nodeExpect(Object.keys(de).sort()).toEqual(Object.keys(en).sort())
  const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
  for (const k of Object.keys(en)) nodeExpect(holes(de[k]!), k).toEqual(holes(en[k]!))
  for (const [k, v] of Object.entries(de)) {
    nodeExpect(v, k).not.toMatch(/\bdanach\b|Plan bereit|Prüfung\b/i)
    nodeExpect(v, k).not.toMatch(/\bWork order\b|\bChain\b|\bPlanner\b/)
  }
  for (const [k, v] of Object.entries(en)) nodeExpect(v, k).not.toMatch(/Prüfauftrag|\bKette\b|\bPlaner\b/)
  nodeExpect(de['features.coding.order.settings.key']).toContain('Prüfauftrag')
  nodeExpect(en['features.coding.order.settings.key']).toContain('Work order')
})
