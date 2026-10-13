/**
 * The Regler's brake in the browser (design § 15, governor-brake): built up slice by slice.
 *  - case 14 (B1) — ONE generation stamp: a budget stamps Workspace.ai.gen = GEN.budget in the same update as the
 *    setter; a rule edit, a backup restore bringing gen-2 rules, a replaceAll and another tab's save keep it; this
 *    browser's own line stamps the device layer; removing the budget lowers the stamp. The DEV / ?e2e invariant never
 *    fires on these paths — and does fire on a raw write that skips the stamp (positive control).
 *  - run modes and sources (B4): a purpose that runs both ways sends nothing without run.mode; every request carries its
 *    own ledger source.
 *  - the brake at the gate (B5): case 1 (refused before sending · positive control), case 2 (precheck never refuses for
 *    money; prepare does), case 3 (a text answer capped to the rest; MCP refused instead), case 4 (E: one request with the
 *    allowance, the next refused again · B: the cheaper model), case 9 (OpenRouter: the router's bound, the wire's
 *    max_tokens reserved), case 10 (no ledger / governor database before the first paint; none at all without a budget).
 *    Case 12 (the golden bodies with a budget that fits) lives in ai-golden.spec.ts.
 * No AI host is reached (the aiNet guard); values are fictional (Nordlicht, Tessera, Launch plan).
 */
import type { Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, openApp, reloadApp, wsEval, flush, createPage, gotoPage, pageIdByTitle } from './fixtures'
import { exportBackup, importBackup } from './helpers/backup'
import { ARCHIVE, TRANSFORM_STEPS, aiPanel, autofillPriority, improve, ledger, ownRequest, transformAuto } from './helpers/aiFlows'
import { mockClaudeScript, mockOpenRouter, seedEndpoints, text } from './helpers/providers'
import { capsOfRow, readCatalogRow } from '../../src/shared/ai/catalog'
import { costOf } from '../../src/shared/ai/prices'
import type { Route, ShortlistRow } from '../../src/shared/ai/types'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Hook = { __one: { workspace: { setState: (x: object) => void } } }

const BUDGET = { v: 1, day: 6, month: 120 }
const CLAUDE_NARROW = { policy: { providers: { anthropic: { allow: ['public', 'structure', 'selection', 'page', 'rows', 'files', 'workspace'] } }, restricted: [] } }

const genOf = (p: Page) => wsEval(p, (s) => (s.ai?.gen ?? null) as number | null)
const devGenOf = (p: Page) => wsEval(p, (s) => (s.settings.ai?.gen ?? null) as number | null)
const setGovernor = (p: Page, v: object | null) => wsEval(p, (s, g) => s.setGovernor(g) as { ok: boolean; why?: string }, v)
/** The AI rules' setters (store/aiRules.ts through the ?e2e seam — each as the spec's own write). */
const rules = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    async ([fn, args]) => {
      const m = (await (window as unknown as { __oneAI: { rules(): Promise<Record<string, (...a: unknown[]) => unknown>> } }).__oneAI.rules()) as Record<string, (...a: unknown[]) => unknown>
      return m[fn as string](...(args as unknown[]))
    },
    [fn, args] as const,
  )

test.describe('case 14 — one generation stamp (B1)', () => {
  test('a budget stamps GEN.budget; rule edits, a restore with gen-2 rules, replaceAll and another tab keep it; removing it lowers it', async ({ page }, testInfo) => {
    await openApp(page)
    await createPage(page, { title: 'Launch plan' })
    expect(await genOf(page)).toBeNull()

    // the setter: the budget and the stamp in one update
    expect(await setGovernor(page, BUDGET)).toEqual({ ok: true })
    expect(await genOf(page)).toBe(3)
    expect(await wsEval(page, (s) => ({ day: s.governor.day, month: s.governor.month, by: s.governor.updatedBy ?? null, at: typeof s.governor.updatedAt }))).toEqual({ day: 6, month: 120, by: null, at: 'number' })
    // the same value again is no change (the stamps stay as they were)
    const at = await wsEval(page, (s) => s.governor.updatedAt as number)
    expect(await setGovernor(page, BUDGET)).toEqual({ ok: true })
    expect(await wsEval(page, (s) => s.governor.updatedAt as number)).toBe(at)

    // a Claude rule edit needs 2 by itself — the budget's 3 stays
    expect(await rules(page, 'setWorkspaceAI', CLAUDE_NARROW)).toEqual({ ok: true })
    expect(await genOf(page)).toBe(3)

    // replaceAll handing in gen-2 rules (what a restore / another tab's save does): restamped to 3 in the same update
    await wsEval(page, (s) => {
      const snap = JSON.parse(JSON.stringify({ version: s.version, pages: s.pages, databases: s.databases, people: s.people, settings: s.settings, recent: s.recent, functions: s.functions, agents: s.agents, scripts: s.scripts, kit: s.kit, integrations: s.integrations, governor: s.governor }))
      s.replaceAll({ ...snap, ai: { ...JSON.parse(JSON.stringify(s.ai)), gen: 2 } })
    })
    expect(await genOf(page)).toBe(3)

    // a full backup whose rules carry gen 2 and loosen ours (taken on the person's answer): the stamp stays 3
    await flush(page)
    const { json } = await exportBackup(page, testInfo, 'full.json')
    const file = JSON.parse(JSON.stringify(json))
    file.workspace.ai = { policy: { providers: { anthropic: { allow: ['public', 'structure', 'selection', 'page', 'rows', 'files', 'workspace', 'people'] } }, restricted: [] }, gen: 2 }
    const path = testInfo.outputPath('gen2.json')
    writeFileSync(path, JSON.stringify(file))
    await importBackup(page, path, 'merge', 'take')
    await expect.poll(() => wsEval(page, (s) => (s.ai?.policy?.providers?.anthropic?.allow ?? []).includes('people'))).toBe(true)
    expect(await genOf(page)).toBe(3)

    // another tab: loads it stamped; its own save keeps it here
    await flush(page)
    const b = await page.context().newPage()
    await openApp(b)
    expect(await genOf(b)).toBe(3)
    await createPage(b, { title: 'Tessera notes' })
    await flush(b)
    await expect.poll(() => wsEval(page, (s) => (Object.values(s.pages) as AnyState[]).some((p) => p.title === 'Tessera notes'))).toBe(true)
    expect(await genOf(page)).toBe(3)
    await b.close()

    // removed: the stamp follows what is stored now — the rules' own 2 (Claude still may not receive transcripts)
    expect(await setGovernor(page, null)).toEqual({ ok: true })
    expect(await genOf(page)).toBe(2)
    // and with Claude's rule gone, none at all
    expect(await rules(page, 'setWorkspaceAI', null)).toEqual({ ok: true })
    expect(await genOf(page)).toBeNull()
    await flush(page)
    await reloadApp(page)
    expect(await genOf(page)).toBeNull()
    expect(await wsEval(page, (s) => s.governor ?? null)).toBeNull()
  })

  test('this browser’s own line stamps the device layer; removing it lowers the stamp; a load stamps a line set elsewhere', async ({ page }) => {
    await openApp(page)
    expect(await devGenOf(page)).toBeNull()
    // the line (localStorage — Settings › KI writes it through writeDeviceLimit) + the store's device stamp
    await page.evaluate(() => localStorage.setItem('one.governor.device', JSON.stringify({ v: 1, day: 8, at: 1760000000000 })))
    await wsEval(page, (s) => s.stampDeviceGen())
    expect(await devGenOf(page)).toBe(3)
    // a device rule edit keeps it
    expect(await rules(page, 'setDeviceAI', { narrow: { anthropic: ['people'] } })).toBe(true)
    expect(await devGenOf(page)).toBe(3)
    expect(await rules(page, 'setDeviceAI', { narrow: undefined })).toBe(true)
    expect(await devGenOf(page)).toBe(3)
    // removed: none left (no device rule either) — and the key itself goes from the stored settings
    await page.evaluate(() => localStorage.removeItem('one.governor.device'))
    await wsEval(page, (s) => s.stampDeviceGen())
    expect(await devGenOf(page)).toBeNull()
    expect(await wsEval(page, (s) => 'ai' in s.settings)).toBe(false)
    await flush(page)
    await reloadApp(page)
    expect(await devGenOf(page)).toBeNull()
    // a line set while this workspace was closed (another workspace's tab): the next load stamps it
    await page.evaluate(() => localStorage.setItem('one.governor.device', JSON.stringify({ v: 1, month: 40, at: 1760000000000 })))
    await reloadApp(page)
    expect(await devGenOf(page)).toBe(3)
    await page.evaluate(() => localStorage.removeItem('one.governor.device'))
  })

  test('the invariant: a raw write that skips the stamp is a console error (positive control); the setter never trips it', async ({ page, errors }) => {
    await openApp(page)
    const seen: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error' && m.text().includes('[governor]')) seen.push(m.text())
    })
    expect(await setGovernor(page, BUDGET)).toEqual({ ok: true })
    expect(await setGovernor(page, { v: 1, day: 3 })).toEqual({ ok: true })
    expect(await setGovernor(page, null)).toEqual({ ok: true })
    await page.waitForTimeout(100)
    expect(seen).toEqual([])
    // positive control: the governor written around the setter, the stamp left as it was
    errors.allow(/\[governor\] ai\.gen below the governor's generation/)
    await page.evaluate((g) => (window as unknown as Hook).__one.workspace.setState({ governor: g }), BUDGET)
    await expect.poll(() => seen.length).toBe(1)
    expect(seen[0]).toContain("ai.gen below the governor's generation")
  })
})

test.describe('run modes and sources (B4)', () => {
  /** a whole prepare() through the ?e2e seam (nothing sent) */
  const gatePrepare = (page: Page, input: AnyState) => page.evaluate((i) => (window as unknown as { __oneAI: { prepare(i: unknown): AnyState } }).__oneAI.prepare(i), input)
  const SIZE = { promptChars: 400, maxTokens: 400 }

  test('a purpose that runs both ways sends nothing without run.mode (?e2e); with it the request carries its own source', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    for (const purpose of ['bulk.mail', 'bulk.autofill', 'agents.run', 'scripts.effect']) {
      const r = await gatePrepare(page, { purpose, sources: [{ all: true }], size: SIZE })
      expect(r, purpose).toMatchObject({ ok: false, code: 'contract' })
      expect(r.detail, purpose).toContain('runs both ways')
    }
    // positive control: with its mode it passes, and its source is its own — `<series>:<request id>`
    const mail = await gatePrepare(page, { purpose: 'bulk.mail', sources: [{ all: true }], size: SIZE, run: { mode: 'bulk' } })
    expect(mail).toMatchObject({ ok: true, run: { mode: 'bulk' } })
    expect(mail.run.source).toMatch(/^mail:[a-z0-9]{12}$/)
    // a call site's own source wins; an interactive purpose needs no mode
    expect(await gatePrepare(page, { purpose: 'agents.run', sources: [{ all: true }], size: SIZE, run: { mode: 'scheduled', source: 'agent:ag-nordlicht:r1' } })).toMatchObject({ ok: true, run: { mode: 'scheduled', source: 'agent:ag-nordlicht:r1' } })
    const help = await gatePrepare(page, { purpose: 'help.ask', sources: [], size: SIZE })
    expect(help).toMatchObject({ ok: true, run: { mode: 'interactive' } })
    expect(help.run.source).toMatch(/^help:[a-z0-9]{12}$/)
    // two requests of the same purpose never share a source
    const again = await gatePrepare(page, { purpose: 'help.ask', sources: [], size: SIZE })
    expect(again.run.source).not.toBe(help.run.source)
    // a source outside the ledger grammar is a contract error
    expect(await gatePrepare(page, { purpose: 'help.ask', sources: [], size: SIZE, run: { source: 'help.ask' } })).toMatchObject({ ok: false, code: 'contract' })
  })
})

/* ------------------------------------------------------------------ */
/* B5 — the brake at the gate                                           */
/* ------------------------------------------------------------------ */

type Seam = { __oneAI: Record<string, (...a: any[]) => any>; __oneGovernor: Record<string, (...a: any[]) => any>; __oneLedger: Record<string, (...a: any[]) => any> } // eslint-disable-line @typescript-eslint/no-explicit-any

/** A stored budget this tab enforces: the ?e2e seam raises the generation the gate holds to GEN.budget (G1 B12 raises it). */
async function budget(page: Page, value: object | null) {
  await page.evaluate(() => (window as unknown as Seam).__oneAI.enforceGen(3))
  expect(await setGovernor(page, value)).toEqual({ ok: true })
}
const KEY = (page: Page, extra: object = {}) => wsEval(page, (s, x) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', ...x }), extra)
const reservedNow = (page: Page) => page.evaluate(() => (window as unknown as Seam).__oneLedger.reserved() as { usd: number; open: number })
const ask = (page: Page, o: AnyState) => page.evaluate((o) => (window as unknown as Seam).__oneAI.ask(o) as Promise<AnyState>, o)
const errorOf = (page: Page) => aiPanel(page).locator('.ai-error')
/**
 * A day budget with only `rest` left: the sanitizer's smallest day is 0,10 $, so the rest of the line is held by an open
 * reservation (the book counts it as spent). Returns its id (release() settles it).
 */
async function dayWithRest(page: Page, rest: number, day = 0.1): Promise<string> {
  await budget(page, { v: 1, day })
  return page.evaluate(([u]) => (window as unknown as Seam).__oneGovernor.reserve(u, 'spec:hold') as string, [Math.round((day - rest) * 1e6) / 1e6] as const)
}
const release = (page: Page, id: string) => page.evaluate((id) => (window as unknown as Seam).__oneGovernor.settle(id), id)

test.describe('the brake at the gate (B5)', () => {
  test('case 1 — 0,005 $ left of the day: Improve is refused before sending (zero requests, no entry, nothing more reserved); 10 $ → exactly one request with the golden budget', async ({ page }) => {
    const { requests } = await mockClaudeScript(page.context(), [text('A tighter launch sentence.')])
    await openApp(page)
    await KEY(page)
    const hold = await dayWithRest(page, 0.005)
    await improve(page, null)
    await expect(errorOf(page)).toContainText('ERR · BUDGET')
    await expect(errorOf(page)).toContainText('Over the budget')
    await page.waitForTimeout(400)
    expect(requests).toHaveLength(0)
    expect(await ledger(page)).toEqual([])
    expect(await reservedNow(page)).toEqual({ usd: 0.095, open: 1 })
    // positive control: a day that holds the band → the one request, its answer budget as without a budget
    await page.keyboard.press('Escape')
    await release(page, hold)
    await budget(page, { v: 1, day: 10 })
    await improve(page)
    expect(requests).toHaveLength(1)
    expect(requests[0].body.max_tokens).toBe(16000)
    await expect.poll(async () => (await ledger(page)).length).toBe(1)
    const [e] = await ledger(page)
    // braked: the band it was judged on; no cap, no allowance
    expect(e.band.high).toBeGreaterThan(e.band.low)
    expect(e).not.toHaveProperty('cap')
    expect(e).not.toHaveProperty('allowance')
    expect(e.source).toMatch(/^ai:/)
  })

  test('case 2 — precheck never refuses for money: Transform and autofill send at 10 $; with 0,005 $ left prepare refuses them with zero requests', async ({ page }) => {
    const { requests } = await mockClaudeScript(page.context(), [...TRANSFORM_STEPS, text(JSON.stringify({ value: 'Low' }))])
    await openApp(page)
    await KEY(page)
    await budget(page, { v: 1, day: 10 })
    await transformAuto(page)
    expect(requests).toHaveLength(2)
    await page.keyboard.press('Escape')
    await autofillPriority(page)
    expect(requests).toHaveLength(3)
    // the same paths (a fresh tab) with 0,005 $ left of the day: refused in prepare — nothing sent
    await flush(page)
    await reloadApp(page)
    await dayWithRest(page, 0.005)
    await transformAuto(page, false)
    await expect(aiPanel(page).locator('.ai-error, [role="alert"]').first()).toBeVisible()
    await page.keyboard.press('Escape')
    // autofill on the same cell (the grid keeps its active cell on this device: walk to row 0, column 2 from there)
    await gotoPage(page, await pageIdByTitle(page, 'Projects'))
    const grid = page.locator('#main .dbt')
    await grid.focus()
    const at = (await grid.locator('[data-active="true"]').first().getAttribute('data-cell').catch(() => null)) ?? null
    const [r, c] = at ? at.split(':').map(Number) : [-1, 0]
    for (let i = r; i < 0; i++) await page.keyboard.press('ArrowDown')
    for (let i = r; i > 0; i--) await page.keyboard.press('ArrowUp')
    for (let i = c; i < 2; i++) await page.keyboard.press('ArrowRight')
    for (let i = c; i > 2; i--) await page.keyboard.press('ArrowLeft')
    await expect(grid.locator('[data-cell="0:2"]')).toHaveAttribute('data-active', 'true')
    await page.keyboard.press('Alt+Enter')
    await page.waitForTimeout(800)
    expect(requests).toHaveLength(3)
    expect(await ledger(page)).toHaveLength(3)
  })

  test('case 3 — a text answer is capped to the rest (body, ledger entry, step); with an MCP server it is refused instead; no budget → the golden budget', async ({ page }) => {
    const { requests } = await mockClaudeScript(page.context(), [text('A tighter launch sentence.'), text('A tighter launch sentence.')])
    await openApp(page)
    await KEY(page, { aiModel: 'claude-haiku-4-5' })
    // Haiku 4.5: 8 000 answer tokens ≈ 0,04 $ — 0,02 $ left holds about 3 900 of them, more than the 1 024 a text needs
    const hold = await dayWithRest(page, 0.02)
    await improve(page)
    expect(requests).toHaveLength(1)
    const cap = requests[0].body.max_tokens as number
    expect(cap).toBeGreaterThanOrEqual(1024)
    expect(cap).toBeLessThan(8000)
    await expect.poll(async () => (await ledger(page)).length).toBe(1)
    const [e] = await ledger(page)
    expect(e.cap).toBe(cap)
    expect(e.steps).toEqual(expect.arrayContaining([{ k: 'brake', code: 'cap', to: String(cap) }]))
    expect(e.band.high).toBeLessThanOrEqual(0.02)
    await page.keyboard.press('Escape')
    // an own request with an MCP server attached: its rounds are the band — never capped, refused before sending
    await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), [ARCHIVE])
    await ownRequest(page, 'What does Archive say about the launch?')
    await expect(errorOf(page)).toContainText('ERR · BUDGET')
    await page.waitForTimeout(400)
    expect(requests).toHaveLength(1)
    await page.keyboard.press('Escape')
    // positive control: no budget → the golden answer budget, no cap and no band on the entry
    await release(page, hold)
    await wsEval(page, (s) => s.updateSettings({ mcpServers: [] }))
    await budget(page, null)
    await improve(page)
    expect(requests).toHaveLength(2)
    expect(requests[1].body.max_tokens).toBe(8000)
    await expect.poll(async () => (await ledger(page)).length).toBe(2)
    const second = (await ledger(page))[1]
    expect(second).not.toHaveProperty('cap')
    expect(second).not.toHaveProperty('band')
  })

  test('case 4 — E lets one request through (allowance on its entry), the next is refused again; B sends the cheaper model', async ({ page }) => {
    const answer = text(JSON.stringify({ answer: 'In two weeks.' }))
    const { requests } = await mockClaudeScript(page.context(), [answer, answer])
    await openApp(page)
    await KEY(page)
    // a structured answer on Opus (4 096 tokens ≈ 0,08 $) is never capped: with 0,03 $ left it is refused
    await dayWithRest(page, 0.03)
    const Q = { purpose: 'help.ask', prompt: 'When does the Nordlicht launch happen?', structured: true }
    const refused = await ask(page, Q)
    expect(refused).toMatchObject({ ok: false, code: 'budget', detail: 'day' })
    const fix = refused.fixes[0]
    expect(fix).toMatchObject({ kind: 'brake', allow: 1, binding: 'day', cheaper: { p: 'anthropic', m: 'claude-haiku-4-5' } })
    expect(fix.rest).toBeCloseTo(0.03, 9)
    expect(fix.need).toBeCloseTo(fix.band.high - 0.03, 9)
    expect(requests).toHaveLength(0)
    // E: a token for this one request
    const token = await page.evaluate(() => (window as unknown as Seam).__oneGovernor.allowOnce(1) as string)
    expect(await ask(page, { ...Q, run: { allowance: token } })).toMatchObject({ ok: true })
    expect(requests).toHaveLength(1)
    expect(requests[0].body.model).toBe('claude-opus-5-5')
    await expect.poll(async () => (await ledger(page)).length).toBe(1)
    const [e] = await ledger(page)
    expect(e.allowance).toBe(1)
    expect(e.steps).toEqual(expect.arrayContaining([{ k: 'allowance', code: '1' }]))
    // the token is spent: the next request of the same purpose — even carrying it — is refused again
    expect(await ask(page, { ...Q, run: { allowance: token } })).toMatchObject({ ok: false, code: 'budget' })
    expect(await ask(page, Q)).toMatchObject({ ok: false, code: 'budget' })
    expect(requests).toHaveLength(1)
    // B: the same request with the cheaper model as the person's pick
    expect(await ask(page, { ...Q, route: fix.cheaper })).toMatchObject({ ok: true })
    expect(requests).toHaveLength(2)
    expect(requests[1].body.model).toBe('claude-haiku-4-5')
  })

  test('case 9 — OpenRouter: the Jev Router reserves its bound band and is refused over the rest; an optional reasoner with effort reserves the wire\'s max_tokens', async ({ page }) => {
    const CATALOGUE = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/openrouter-models.json', import.meta.url)), 'utf8')) as { data: unknown[] }
    const row = (id: string): ShortlistRow => {
      const r = readCatalogRow(CATALOGUE.data.find((x) => (x as { id: string }).id === id), '2026-10-12')!
      return { m: r.id, label: r.label, price: r.price, caps: capsOfRow(r), at: '2026-10-12' }
    }
    const LUNA = 'openai/gpt-6-luna'
    const POOL = [LUNA, 'deepseek/deepseek-v4-flash', 'z-ai/glm-5.3']
    const JEV = 'typesafe/jev-router'
    const ROUTER: Route = { p: 'openrouter', m: JEV, effort: 'medium' }
    const or = await mockOpenRouter(page.context(), { chat: [{ delay: 600, then: { text: 'In two weeks.', model: LUNA, cost: 0.0002 } }, { delay: 600, then: { text: 'In two weeks.', cost: 0.0002 } }] })
    await mockClaudeScript(page.context(), [])
    await openApp(page)
    await wsEval(page, (s, a) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', aiKeys: { openrouter: a.key }, ai: { models: a.rows, allow: { openrouter: ['private', 'mail', 'memory', 'mcp'] } } }), { key: 'sk-or-v1-e2e-openrouter-key-0000000000000000000000000000000000000000', rows: POOL.map(row) })
    await wsEval(page, (s) => s.setWorkspaceAI({ policy: { providers: { openrouter: { allow: ['public', 'structure', 'selection', 'page', 'rows', 'files', 'workspace', 'people', 'transcript'] } }, restricted: [] } }))
    await seedEndpoints(page, { [LUNA]: [{ tag: 'nordwind', name: 'Nordwind' }], 'deepseek/deepseek-v4-flash': [{ tag: 'nordwind', name: 'Nordwind' }], 'z-ai/glm-5.3': [{ tag: 'birkenau', name: 'Birkenau' }], [JEV]: [{ tag: 'typesafe', name: 'TypeSafe' }] })
    await page.evaluate(([r, p]) => (window as unknown as Seam).__oneAI.forceRoute(r, p), [ROUTER, POOL] as const)
    const Q = { purpose: 'help.ask', prompt: 'When does the Nordlicht launch happen?' }
    // 0,01 $ left: below the bound even for the smallest text answer — refused before sending (positive control below)
    const hold = await dayWithRest(page, 0.01)
    expect(await ask(page, Q)).toMatchObject({ ok: false, code: 'budget', detail: 'day' })
    expect(or.posts()).toHaveLength(0)
    // a day that holds it: one POST, the reservation is the bound band while it runs (never 0)
    await release(page, hold)
    await budget(page, { v: 1, day: 1000 })
    const sent = ask(page, Q)
    await expect.poll(() => or.posts().length).toBe(1)
    const open = await reservedNow(page)
    expect(open.open).toBe(1)
    expect(open.usd).toBeGreaterThan(0)
    expect(await sent).toMatchObject({ ok: true })
    await expect.poll(async () => (await ledger(page)).length).toBe(1)
    const [e] = await ledger(page)
    expect(e.band.high).toBeCloseTo(open.usd, 12)
    expect(e.costSource).toBe('reported')
    // an optional reasoner with an effort: the reservation's upper end prices exactly the max_tokens the wire sends
    const effort: Route = { p: 'openrouter', m: LUNA, effort: 'medium' }
    await page.evaluate(([r]) => (window as unknown as Seam).__oneAI.forceRoute(r), [effort] as const)
    const second = ask(page, Q)
    await expect.poll(() => or.posts().length).toBe(2)
    const held = await reservedNow(page)
    const body = or.posts()[1].body!
    expect(body.reasoning).toEqual({ effort: 'medium' })
    expect(body.max_tokens).toBeGreaterThan(8000)
    const input = Math.round(('Answer briefly.'.length + Q.prompt.length) / 4)
    const usage = { input, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, output: body.max_tokens as number, reasoning: 0 }
    expect(held.usd).toBeCloseTo(costOf(usage, row(LUNA).price, Date.now()).usd!, 12)
    expect(await second).toMatchObject({ ok: true })
  })

  test('case 10 — no ledger or governor database before the first paint; with a budget the day is read after it, without one nothing at boot', async ({ page }) => {
    await page.addInitScript(() => {
      const opens: Array<{ name: string; t: number }> = []
      ;(window as unknown as { __idbOpens: typeof opens }).__idbOpens = opens
      // when the app shell is first in the page (a stricter mark than the boot screen's paint)
      new MutationObserver((_, obs) => {
        if (!document.querySelector('.app')) return
        ;(window as unknown as { __appAt: number }).__appAt = performance.now()
        obs.disconnect()
      }).observe(document, { childList: true, subtree: true })
      const open = indexedDB.open.bind(indexedDB)
      indexedDB.open = ((...a: Parameters<IDBFactory['open']>) => {
        opens.push({ name: String(a[0]), t: performance.now() })
        return open(...a)
      }) as IDBFactory['open']
    })
    const opensOf = (names: string[]) =>
      page.evaluate((names) => {
        const paint = performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint')?.startTime ?? null
        const app = (window as unknown as { __appAt?: number }).__appAt ?? null
        const list = (window as unknown as { __idbOpens: Array<{ name: string; t: number }> }).__idbOpens.filter((o) => names.includes(o.name))
        const mark = Math.max(paint ?? Infinity, app ?? Infinity)
        return { paint, app, before: list.filter((o) => o.t <= mark).map((o) => o.name), all: list.map((o) => o.name) }
      }, names)
    const DBS = ['one-ledger', 'one-governor']
    await openApp(page)
    // no budget: nothing at boot (the ledger opens with its first entry — ai-ledger.spec)
    await page.waitForTimeout(1500)
    expect((await opensOf(DBS)).all).toEqual([])
    // a day and a month budget, then a fresh boot
    await budget(page, { v: 1, day: 6, month: 120 })
    await flush(page)
    await reloadApp(page)
    await expect.poll(async () => (await opensOf(DBS)).all).toEqual(expect.arrayContaining(['one-ledger', 'one-governor']))
    const seen = await opensOf(DBS)
    expect(seen.paint).not.toBeNull()
    expect(seen.app).not.toBeNull()
    expect(seen.before).toEqual([])
    expect(await page.evaluate(() => (window as unknown as Seam).__oneGovernor.opened())).toEqual({ ledger: expect.any(Number), governor: expect.any(Number) })
    expect((await page.evaluate(() => (window as unknown as Seam).__oneGovernor.opened())).ledger).toBeGreaterThanOrEqual(1)
  })
})
