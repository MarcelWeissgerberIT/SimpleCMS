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
 *  - loops and starts (B6): case 5 (the halt card — zero requests and reservations while it waits; E, H across thinking,
 *    Mod+., a pause_turn, the first request), case 6 (agents held: the coalesced start record, a mid-run stop, the manual
 *    start dialog from the agent page and a database command).
 *  - background work (B7): case 7 (the autofill watch pauses, keeps its rows over a reload and fills them on a raise or
 *    E; a person's autofill run waits at a row boundary), a script's claude() crossing mid-run, an automation's script at
 *    the line. The mail pause lives in mail-gmail.spec.ts.
 *  - the brake note (B8): case 1 across the surfaces — the AI menu (E: one request with the allowance), help Ask (B: the
 *    cheaper model), ⌘K "?" (Esc: nothing sent, the palette stays), the Outbox draft (the dock's note, E), the kit
 *    fill, the setup test; its keys act only with focus inside it, never on a held key or in its first moment.
 *  - the status cell, VERBRAUCH, receipts (B9): the cell's states (none without a budget, "—" until the day is read, the
 *    amount, amber at 75 %, ROTLINIE · PAUSE), the lamp amber (no MASTER CAUTION) / red (MASTER CAUTION), the receipt's
 *    steps EN / DE, /cost's rest line; case 8 (two tabs: B refused while A's reservation is open, allowed after it settles).
 * No AI host is reached (the aiNet guard); values are fictional (Nordlicht, Tessera, Launch plan).
 */
import type { Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, openApp, reloadApp, wsEval, uiEval, flush, createPage, gotoPage, pageIdByTitle, sse, doc, para, editorOf, MOD } from './fixtures'
import { exportBackup, importBackup } from './helpers/backup'
import { ARCHIVE, TRANSFORM_STEPS, aiPanel, autofillPriority, improve, ledger, ownRequest, transformAuto } from './helpers/aiFlows'
import { mockClaudeScript, mockOpenRouter, seedEndpoints, text } from './helpers/providers'
import { openTerminal, prompt as termPrompt, run as runTask, terminal } from './helpers/terminal'
import { budget, pausedRowsOf, spend } from './helpers/governor'
import { expectLane, markRec, startRecorder } from './helpers/recorder'
import { mockDrafts, outboxLoaded, seedMirrorDb } from './helpers/outbox'
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

const KEY = (page: Page, extra: object = {}) => wsEval(page, (s, x) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', ...x }), extra)
const reservedNow = (page: Page) => page.evaluate(() => (window as unknown as Seam).__oneLedger.reserved() as { usd: number; open: number })
const ask = (page: Page, o: AnyState) => page.evaluate((o) => (window as unknown as Seam).__oneAI.ask(o) as Promise<AnyState>, o)
/** The AI menu's error area at the line: the brake note (B8) — nothing was sent. */
const errorOf = (page: Page) => aiPanel(page).getByTestId('gv-brake-note')
/**
 * A day budget with only `rest` left: the sanitizer's smallest day is 0,10 $, so the rest of the line is held by an open
 * reservation (the book counts it as spent). Returns its id (release() settles it).
 */
async function dayWithRest(page: Page, rest: number, day = 0.1): Promise<string> {
  await budget(page, { v: 1, day })
  return page.evaluate(([u]) => (window as unknown as Seam).__oneGovernor.reserve(u, 'spec:hold') as string, [Math.round((day - rest) * 1e6) / 1e6] as const)
}
const release = (page: Page, id: string) => page.evaluate((id) => (window as unknown as Seam).__oneGovernor.settle(id), id)
/** Esc until the AI menu is closed (the first Esc in the brake note cancels the note, the next closes the menu). */
async function closeMenu(page: Page) {
  await expect(async () => {
    await page.keyboard.press('Escape')
    await expect(aiPanel(page)).toBeHidden({ timeout: 500 })
  }).toPass({ timeout: 5000 })
}

test.describe('the brake at the gate (B5)', () => {
  test('case 1 — 0,005 $ left of the day: Improve is refused before sending (zero requests, no entry, nothing more reserved); 10 $ → exactly one request with the golden budget', async ({ page }) => {
    const { requests } = await mockClaudeScript(page.context(), [text('A tighter launch sentence.')])
    await openApp(page)
    await KEY(page)
    const hold = await dayWithRest(page, 0.005)
    await improve(page, null)
    await expect(errorOf(page)).toHaveAttribute('data-detail', 'day')
    await expect(errorOf(page)).toContainText('Over the red line')
    await page.waitForTimeout(400)
    expect(requests).toHaveLength(0)
    expect(await ledger(page)).toEqual([])
    expect(await reservedNow(page)).toEqual({ usd: 0.095, open: 1 })
    // positive control: a day that holds the band → the one request, its answer budget as without a budget
    await closeMenu(page)
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
    await expect(errorOf(page)).toBeVisible()
    await closeMenu(page)
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
    const { requests } = await mockClaudeScript(page.context(), [text('A tighter launch sentence.'), text('According to Archive, the launch is in two weeks.'), text('A tighter launch sentence.')])
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
    await expect(errorOf(page)).toHaveAttribute('data-detail', 'day')
    await expect(errorOf(page)).toContainText('MCP calls multiply the cost — band for up to 5 rounds')
    await page.waitForTimeout(400)
    expect(requests).toHaveLength(1)
    await closeMenu(page)
    // positive control below the line: a day that holds the five rounds — the MCP request goes, uncapped
    await release(page, hold)
    await budget(page, { v: 1, day: 10 })
    await ownRequest(page, 'What does Archive say about the launch?')
    await expect(aiPanel(page)).toContainText('According to Archive')
    expect(requests).toHaveLength(2)
    expect(requests[1].body.mcp_servers?.[0]?.name).toBe('archive')
    expect(requests[1].body.max_tokens).toBe(8000)
    await expect.poll(async () => (await ledger(page)).length).toBe(2)
    expect((await ledger(page))[1]).not.toHaveProperty('cap')
    await closeMenu(page)
    // positive control: no budget → the golden answer budget, no cap and no band on the entry
    await wsEval(page, (s) => s.updateSettings({ mcpServers: [] }))
    await budget(page, null)
    await improve(page)
    expect(requests).toHaveLength(3)
    expect(requests[2].body.max_tokens).toBe(8000)
    await expect.poll(async () => (await ledger(page)).length).toBe(3)
    const third = (await ledger(page))[2]
    expect(third).not.toHaveProperty('cap')
    expect(third).not.toHaveProperty('band')
  })

  test('structured requests carry the "All AI calls" servers: the band counts every request the call may send — refused where the band without them fits (nothing sent); positive control without the server', async ({ page }) => {
    const answer = text(JSON.stringify({ answer: 'In two weeks.' }))
    const { requests } = await mockClaudeScript(page.context(), [answer])
    await openApp(page)
    await KEY(page, { aiModel: 'claude-haiku-4-5' })
    await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), [{ ...ARCHIVE, scope: 'all' }])
    // Haiku 4.5: one structured answer (4 096 tokens) ≈ 0,02 $ — 0,05 $ left holds it, and one MCP request with five more
    // reads (≈ 0,033 $), but not the four requests a paused turn may take (≈ 0,09 $)
    const hold = await dayWithRest(page, 0.05)
    const Q = { purpose: 'help.ask', prompt: 'When does the Nordlicht launch happen?', structured: true }
    const refused = await ask(page, { ...Q, mcp: 'fixed' })
    expect(refused).toMatchObject({ ok: false, code: 'budget', detail: 'day' })
    expect(refused.fixes[0]).toMatchObject({ kind: 'brake', mcpRounds: 5 })
    expect(refused.fixes[0].band.high).toBeGreaterThan(0.05)
    expect(requests).toHaveLength(0)
    // positive control: the same request without the server fits the rest and is sent
    expect(await ask(page, Q)).toMatchObject({ ok: true })
    expect(requests).toHaveLength(1)
    expect(requests[0].body.mcp_servers).toBeUndefined()
    await release(page, hold)
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

/* ------------------------------------------------------------------ */
/* B6 — loops, halts, held runs, start checks                           */
/* ------------------------------------------------------------------ */

const reservedAll = (page: Page) => page.evaluate(() => (window as unknown as Seam).__oneGovernor.reserved() as number)
const halt = (page: Page) => page.getByTestId('gv-halt')

/**
 * The terminal's three rounds (Opus 5.5: input 4 · output 20 · cache read 0,2 · cache write 5 $ / M): round 1 stages a
 * page (0,010 $), round 2 searches with a long answer (0,128 $). A day of 1 $ with 0,79 $ spent leaves 0,21 $: the first
 * request (prompt + 4 096) and round 2 (≈ 0,105 $) fit; round 3 on Opus (≈ 0,17 $) does not — Haiku 4.5 with the cold
 * cache (≈ 0,046 $) does, Sonnet 5.5 (≈ 0,091 $) does not.
 */
const R1 = { blocks: [{ type: 'text' as const, text: 'Drafting the brief.' }, { type: 'tool_use' as const, id: 'toolu_b6a', name: 'create_page', input: { title: 'Nordlicht brief', markdown: 'Launch plan for Nordlicht.' } }], usage: { input: 2000, output: 100 } }
const R2 = { blocks: [{ type: 'tool_use' as const, id: 'toolu_b6b', name: 'search_pages', input: { query: 'Tessera' } }], usage: { input: 2000, output: 6000 } }
const R3 = text('Staged the Nordlicht brief.')

test.describe('loops: the halt card, H, Mod+. (B6 · case 5)', () => {
  test('the next step crosses the line: zero requests and zero reservations while the card waits; E sends round 3 with the allowance; no H from Opus by default', async ({ page }) => {
    const { requests } = await mockClaudeScript(page.context(), [R1, R2, R3])
    await openApp(page)
    await KEY(page)
    await budget(page, { v: 1, day: 1 })
    await spend(page, 0.79)
    await openTerminal(page)
    await runTask(page, 'Draft the Nordlicht brief.')
    await expect(halt(page)).toBeVisible()
    await page.waitForTimeout(500)
    expect(requests).toHaveLength(2)
    expect(await reservedAll(page)).toBe(0)
    // the card: E (+1 $ makes the step fit), no H (Sonnet does not fit; Haiku thinks differently), the stop key
    await expect(halt(page).getByRole('button', { name: /\+\$1 once/ })).toBeVisible()
    await expect(halt(page).getByRole('button', { name: /Finish with/ })).toHaveCount(0)
    await expect(halt(page)).toContainText('crosses the day budget')
    // the prompt is read-only and names the keys; the head says the task is paused
    await expect(termPrompt(page)).toHaveAttribute('readonly', '')
    await expect(termPrompt(page)).toHaveAttribute('placeholder', 'Paused — E, H or Ctrl+.')
    await expect(terminal(page).getByTestId('term-regler')).toBeVisible()
    // the status bar's REGLER cell: a task waits at the line → ROTLINIE · PAUSE (below the line itself)
    await expect(page.locator('.status .gv-cell')).toHaveAttribute('data-level', 'red')
    await expect(page.locator('.status .gv-cell')).toContainText('Red line · pause')
    // the card holds the keyboard: E sends round 3 (+1 $ for this task, today)
    await expect(halt(page)).toBeFocused()
    await page.keyboard.press('e')
    // the card goes — the keyboard goes back to the prompt, never to the body
    await expect(halt(page)).toHaveCount(0)
    await expect(termPrompt(page)).toBeFocused()
    await expect(terminal(page).locator('.term-answer')).toContainText('Staged the Nordlicht brief.')
    expect(requests).toHaveLength(3)
    await expect(halt(page)).toHaveCount(0)
    await expect(termPrompt(page)).not.toHaveAttribute('readonly', '')
    await expect.poll(async () => (await ledger(page)).filter((e) => e.source.startsWith('terminal:')).length).toBe(3)
    const entries = (await ledger(page)).filter((e) => e.source.startsWith('terminal:'))
    // one task, one source; the allowance on the entry after the key
    expect(new Set(entries.map((e) => e.source)).size).toBe(1)
    expect(entries[0].source).toMatch(/^terminal:[a-z0-9]+:1$/)
    expect(entries[2].steps).toEqual(expect.arrayContaining([{ k: 'allowance', code: '1' }]))
    expect(await reservedAll(page)).toBe(0)
  })

  test('H (across thinking, the seam) finishes on Haiku 4.5: no thinking / output_config, the history intact, its step on the receipt', async ({ page }) => {
    const { requests } = await mockClaudeScript(page.context(), [R1, R2, R3])
    await openApp(page)
    await KEY(page)
    await page.evaluate(() => ((window as unknown as Seam).__oneGovernor as unknown as { acrossThinking(on: boolean): void }).acrossThinking(true))
    await budget(page, { v: 1, day: 1 })
    await spend(page, 0.79)
    await openTerminal(page)
    await runTask(page, 'Draft the Nordlicht brief.')
    await expect(halt(page)).toBeVisible()
    const h = halt(page).getByRole('button', { name: /Finish with .*Haiku 4\.5/ })
    await expect(h).toBeVisible()
    await expect(halt(page)).toContainText('cold cache')
    await page.waitForTimeout(500)
    expect(requests).toHaveLength(2)
    await page.keyboard.press('h')
    await expect(halt(page)).toHaveCount(0)
    await expect(termPrompt(page)).toBeFocused()
    await expect(terminal(page).locator('.term-answer')).toContainText('Staged the Nordlicht brief.')
    expect(requests).toHaveLength(3)
    const [r2, r3] = [requests[1].body, requests[2].body]
    expect(r2.model).toBe('claude-opus-5-5')
    expect(r2.thinking).toBeTruthy()
    expect(r3.model).toBe('claude-haiku-4-5')
    expect(r3).not.toHaveProperty('thinking')
    expect(r3).not.toHaveProperty('output_config')
    expect(r3).not.toHaveProperty('fallbacks')
    // the history the runner kept: round 2's assistant turn (its tool call) and the tool result
    const msgs = r3.messages as AnyState[]
    expect(msgs.length).toBe(r2.messages.length + 2)
    expect(JSON.stringify(msgs[msgs.length - 2])).toContain('toolu_b6b')
    expect(msgs[msgs.length - 1].content.some((c: AnyState) => c.type === 'tool_result' && c.tool_use_id === 'toolu_b6b')).toBe(true)
    await expect.poll(async () => (await ledger(page)).filter((e) => e.source.startsWith('terminal:')).length).toBe(3)
    const last = (await ledger(page)).filter((e) => e.source.startsWith('terminal:'))[2]
    expect(last.served.model).toBe('claude-haiku-4-5')
    expect(last.steps).toEqual(expect.arrayContaining([{ k: 'brake', code: 'H', from: 'claude-opus-5-5', to: 'claude-haiku-4-5' }]))
  })

  test('H refused at the gate (the rest moved while the card waited): the card again, the task stays where it is — E goes on with round 3, never the task again from its start', async ({ page }) => {
    const { requests } = await mockClaudeScript(page.context(), [R1, R2, R3, R3])
    await openApp(page)
    await KEY(page)
    await page.evaluate(() => ((window as unknown as Seam).__oneGovernor as unknown as { acrossThinking(on: boolean): void }).acrossThinking(true))
    await budget(page, { v: 1, day: 1 })
    await spend(page, 0.79)
    await openTerminal(page)
    await runTask(page, 'Draft the Nordlicht brief.')
    await expect(halt(page)).toBeVisible()
    await expect(halt(page).getByRole('button', { name: /Finish with .*Haiku 4\.5/ })).toBeVisible()
    // spent elsewhere meanwhile: the rest no longer holds Haiku's band — H is refused at the gate, nothing is sent
    await spend(page, 0.06)
    await expect(halt(page)).toBeFocused()
    await page.keyboard.press('h')
    await expect(halt(page)).toBeVisible()
    await expect(halt(page).getByRole('button', { name: /Finish with/ })).toHaveCount(0)
    await page.waitForTimeout(400)
    expect(requests).toHaveLength(2)
    // E: +1 $ for the task — round 3 on Opus, the conversation as it was (the task in it once)
    await expect(halt(page)).toBeFocused()
    await page.keyboard.press('e')
    await expect(terminal(page).locator('.term-answer')).toContainText('Staged the Nordlicht brief.')
    expect(requests).toHaveLength(3)
    expect(requests[2].body.model).toBe('claude-opus-5-5')
    expect(JSON.stringify(requests[2].body.messages).split('Draft the Nordlicht brief.').length - 1).toBe(1)
    expect(requests[2].body.messages.length).toBe(requests[1].body.messages.length + 2)
  })

  test('Mod+. at the card ends the task: the staged change stays listed, nothing more is sent; a pause_turn crossing the line halts before its resumed request', async ({ page }) => {
    const paused = { blocks: [{ type: 'text' as const, text: 'Still looking.' }], stop: 'pause_turn' as const, usage: { input: 2000, output: 9000 } }
    const { requests } = await mockClaudeScript(page.context(), [R1, paused, R3])
    await openApp(page)
    await KEY(page)
    await budget(page, { v: 1, day: 1 })
    await spend(page, 0.79)
    await openTerminal(page)
    await runTask(page, 'Draft the Nordlicht brief.')
    // round 2 paused (0,188 $): the resumed request would cross — the card, zero further requests
    await expect(halt(page)).toBeVisible()
    await page.waitForTimeout(500)
    expect(requests).toHaveLength(2)
    expect(await reservedAll(page)).toBe(0)
    await expect(page.locator('.status .gv-cell')).toContainText('Red line · pause')
    await page.keyboard.press('Control+.')
    await expect(halt(page)).toHaveCount(0)
    await expect(terminal(page).locator('.term-turn').last()).toHaveAttribute('data-status', 'stopped')
    await expect(terminal(page).locator('.term-bar')).toContainText(/1 .*change/i)
    // the task is gone: no task waits at the line any more — the cell leaves "Red line · pause" (below the line itself)
    await expect(page.locator('.status .gv-cell')).not.toContainText('Red line · pause')
    await expect(page.locator('.status .gv-cell')).not.toHaveAttribute('data-level', 'red')
    await page.waitForTimeout(400)
    expect(requests).toHaveLength(2)
    expect(await reservedAll(page)).toBe(0)
  })

  test('a task ended at its card another way — the head\'s Stop, a new task — leaves no mark: the cell forgets "Red line · pause"', async ({ page }) => {
    const { requests } = await mockClaudeScript(page.context(), [])
    await openApp(page)
    await KEY(page)
    await budget(page, { v: 1, day: 1 })
    await spend(page, 0.98)
    await openTerminal(page)
    for (const end of ['stop', 'new'] as const) {
      await runTask(page, 'Summarise the Tessera notes.')
      await expect(halt(page)).toBeVisible()
      await expect(page.locator('.status .gv-cell')).toContainText('Red line · pause')
      if (end === 'stop') await terminal(page).locator('.term-run--stop').click()
      else await terminal(page).getByRole('button', { name: 'New task' }).first().click()
      await expect(halt(page)).toHaveCount(0)
      // the line itself is 0,98 / 1 $ (amber): no task waits — no "pause" (the mark is gone, not only the card)
      await expect(page.locator('.status .gv-cell')).not.toContainText('Red line · pause')
    }
    expect(requests).toHaveLength(0)
  })

  test('a pause_turn below the line is resumed as before (positive control): the resumed request goes, no card', async ({ page }) => {
    const paused = { blocks: [{ type: 'text' as const, text: 'Still looking.' }], stop: 'pause_turn' as const, usage: { input: 2000, output: 300 } }
    const { requests } = await mockClaudeScript(page.context(), [R1, paused, R3])
    await openApp(page)
    await KEY(page)
    await budget(page, { v: 1, day: 1 })
    await spend(page, 0.5)
    await openTerminal(page)
    await runTask(page, 'Draft the Nordlicht brief.')
    await expect(terminal(page).locator('.term-answer')).toContainText('Staged the Nordlicht brief.')
    expect(requests).toHaveLength(3)
    await expect(halt(page)).toHaveCount(0)
    expect(await reservedAll(page)).toBe(0)
  })

  /**
   * MCP iterations (§ 5.6): the next step reads the context once per server-side MCP iteration of the last response. Round
   * 1 read a 501k context from the cache (0,106 $) and ran k Archive calls before its own tool call; 0,42 $ were left, so
   * 0,314 $ after it. The next step with k = 1 (≈ 0,21 $) fits and is sent; with k = 3 two more reads (≈ +0,20 $) do not —
   * the card, zero further requests.
   */
  for (const k of [3, 1]) {
    test(`MCP iterations: a step after ${k} server-side Archive call${k > 1 ? 's' : ''} counts ${k} context read${k > 1 ? 's' : ''} — ${k > 1 ? 'over the rest it halts before the next request' : 'within the rest it goes on (positive control)'}`, async ({ page }) => {
      const calls = Array.from({ length: k }, (_, i) => [
        { type: 'mcp_tool_use' as const, id: `mcptoolu_k${i}`, server: 'archive', name: 'archive_search', input: { query: `Nordlicht ${i}` } },
        { type: 'mcp_tool_result' as const, id: `mcptoolu_k${i}`, text: `REC-${i} Nordlicht launch notes` },
      ]).flat()
      const first = { blocks: [...calls, { type: 'tool_use' as const, id: 'toolu_mcpk', name: 'search_pages', input: { query: 'Tessera' } }], usage: { input: 1000, cacheRead: 500_000, output: 100 } }
      const { requests } = await mockClaudeScript(page.context(), [first, R3])
      await openApp(page)
      await KEY(page, { mcpServers: [ARCHIVE] })
      await budget(page, { v: 1, day: 1 })
      await spend(page, 0.58)
      await openTerminal(page)
      await runTask(page, 'Draft the Nordlicht brief from the Archive records.')
      if (k > 1) {
        await expect(halt(page)).toBeVisible()
        await page.waitForTimeout(500)
        expect(requests).toHaveLength(1)
        expect(requests[0].body.mcp_servers?.[0]?.name).toBe('archive')
        expect(await reservedAll(page)).toBe(0)
        await expect(halt(page)).toContainText('crosses the day budget')
      } else {
        await expect(terminal(page).locator('.term-answer')).toContainText('Staged the Nordlicht brief.')
        expect(requests).toHaveLength(2)
        await expect(halt(page)).toHaveCount(0)
      }
    })
  }

  test('a picture in the task counts as its pixels, never its base64: a task with a large image reference under a budget that holds its real cost is sent', async ({ page }) => {
    const { requests } = await mockClaudeScript(page.context(), [R3])
    await openApp(page)
    await KEY(page)
    // a noisy board photo (1568 px a side): megabytes of base64, about 3 300 tokens as a picture
    const png = Buffer.from(
      await page.evaluate(() => {
        const c = document.createElement('canvas')
        c.width = 1568
        c.height = 1568
        const g = c.getContext('2d')!
        const img = g.createImageData(1568, 1568)
        for (let i = 0; i < img.data.length; i++) img.data[i] = i % 4 === 3 ? 255 : (Math.random() * 256) | 0
        g.putImageData(img, 0, 0)
        return c.toDataURL('image/png').split(',')[1]
      }),
      'base64',
    )
    const id = await createPage(page, { title: 'Launch plan', content: doc(para('The Nordlicht board photo.'), { type: 'image', attrs: { src: null } }, para('')) })
    await gotoPage(page, id)
    const chooser = page.waitForEvent('filechooser')
    await editorOf(page, id).locator('.media-empty').getByRole('button', { name: /Upload|Hochladen/ }).click()
    await (await chooser).setFiles({ name: 'board.png', mimeType: 'image/png', buffer: png })
    const fig = editorOf(page, id).locator('.image-view').first()
    await expect(fig.locator('img')).toBeVisible()
    // 0,50 $ left: the first step with the picture (≈ 0,13 $ on Opus) fits — its base64 counted as text (≈ 2 $) would not
    await budget(page, { v: 1, day: 1 })
    await spend(page, 0.5)
    await fig.locator('img').click()
    await page.keyboard.press(`${MOD}+Shift+j`)
    await expect(terminal(page).getByTestId('term-image-chip')).toBeVisible()
    await runTask(page, 'What is on the board photo?')
    await expect(terminal(page).locator('.term-answer')).toContainText('Staged the Nordlicht brief.')
    await expect(halt(page)).toHaveCount(0)
    expect(requests).toHaveLength(1)
    const content = (requests[0].body.messages as AnyState[]).at(-1)!.content as AnyState[]
    // the picture really went as megabytes of base64
    expect(String(content.find((b) => b.type === 'image')?.source.data ?? '').length).toBeGreaterThan(1_000_000)
  })

  test('the first request at the line: the card with E (nothing sent); E sends it; without a budget the same task runs as before', async ({ page }) => {
    const { requests } = await mockClaudeScript(page.context(), [R3, R3])
    await openApp(page)
    await KEY(page)
    await budget(page, { v: 1, day: 1 })
    await spend(page, 0.98)
    await openTerminal(page)
    await runTask(page, 'Summarise the Tessera notes.')
    await expect(halt(page)).toBeVisible()
    await page.waitForTimeout(500)
    expect(requests).toHaveLength(0)
    await page.keyboard.press('e')
    await expect(terminal(page).locator('.term-answer')).toContainText('Staged the Nordlicht brief.')
    expect(requests).toHaveLength(1)
    // positive control: no budget — the next task goes straight out, no card
    await budget(page, null)
    await runTask(page, 'Summarise the Tessera notes again.')
    await expect.poll(() => requests.length).toBe(2)
    await expect(halt(page)).toHaveCount(0)
  })
})

/** A browser agent (Opus, budget per run 0,50 $): never started by the clock in a spec (updatedAt = now). */
async function putAgent(page: Page, a: AnyState) {
  await wsEval(
    page,
    (s, a) => {
      const now = Date.now()
      s.upsertAgent({ instructions: 'Summarise the status of the Nordlicht projects.', trigger: { type: 'schedule', every: 'day', at: '07:30', tz: 'Europe/Berlin' }, scope: { everything: true, pages: [], databases: [] }, write: 'stage', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: true, createdAt: now, updatedAt: now, ...a })
    },
    a,
  )
  await flush(page)
}
type RunSeam = { __oneAgentRun: { run(id: string, type?: string): Promise<AnyState | string | null>; inbox(): AnyState[]; startCheck(id: string, manual?: boolean): Promise<AnyState | null> } }
/** The agents' code (exec.ts) loads with the agents page. */
async function agentsLoaded(page: Page, hash = '#/agents') {
  await page.evaluate((h) => (window.location.hash = h), hash)
  await page.waitForFunction(() => !!(window as unknown as Partial<RunSeam>).__oneAgentRun)
}
const scheduled = (page: Page, id: string) => page.evaluate((id) => (window as unknown as RunSeam).__oneAgentRun.run(id, 'schedule'), id)
const inboxOf = (page: Page) => page.evaluate(() => (window as unknown as RunSeam).__oneAgentRun.inbox())
const heldToasts = (page: Page) => page.locator('.toast', { hasText: 'stopped by the governor' })

test.describe('agents at the line: held, never waiting (B6 · case 6)', () => {
  test('a scheduled start at the line is not started: one held record of the day (3 starts), zero requests, one info toast, one inbox note, no fault; none on its own page', async ({ page }) => {
    const { requests } = await mockClaudeScript(page.context(), [])
    await openApp(page)
    await KEY(page)
    await putAgent(page, { id: 'ag-nordlicht', name: 'Nordlicht digest' })
    await putAgent(page, { id: 'ag-tessera', name: 'Tessera digest' })
    await budget(page, { v: 1, day: 1 })
    await spend(page, 1)
    await agentsLoaded(page)
    let rec: AnyState | string | null = null
    for (let i = 0; i < 3; i++) rec = await scheduled(page, 'ag-nordlicht')
    expect(rec).toMatchObject({ status: 'held', held: { kind: 'notStarted', binding: 'day', count: 3 } })
    expect((rec as AnyState).id).toMatch(/^held-\d{4}-\d{2}-\d{2}$/)
    expect((rec as AnyState).held.times).toHaveLength(3)
    expect(requests).toHaveLength(0)
    // told once a day: one info toast (never an error), one inbox note
    await expect(heldToasts(page)).toHaveCount(1)
    await expect(heldToasts(page)).toContainText('Nordlicht digest')
    await expect(page.locator('.toast[data-kind="error"]')).toHaveCount(0)
    expect((await inboxOf(page)).filter((i) => i.id.startsWith('rg:ag-nordlicht:'))).toHaveLength(1)
    // the card: Held (amber), no fault
    const card = page.locator('.agx-card', { hasText: 'Nordlicht digest' })
    await expect(card).toHaveAttribute('data-state', 'held')
    await expect(card.getByTestId('agx-state')).toHaveText('Held')
    // the run list: ONE record, "3 × not started"
    await page.evaluate(() => (window.location.hash = '#/agents/ag-nordlicht'))
    await expect(page.locator('.agx-run')).toHaveCount(1)
    await expect(page.getByTestId('agx-run-held')).toHaveAttribute('data-held', 'notStarted')
    await expect(page.getByTestId('agx-run-held')).toContainText('3 × not started')
    // on its own page: the note, but no toast (positive control above)
    await page.evaluate(() => (window.location.hash = '#/agents/ag-tessera'))
    await expect(page.locator('.agx-dhead')).toBeVisible()
    await scheduled(page, 'ag-tessera')
    expect((await inboxOf(page)).filter((i) => i.id.startsWith('rg:ag-tessera:'))).toHaveLength(1)
    await page.waitForTimeout(300)
    await expect(heldToasts(page).filter({ hasText: 'Tessera digest' })).toHaveCount(0)
    expect(requests).toHaveLength(0)
    // positive control: a day that holds the first step — the same scheduled start runs and sends
    await budget(page, { v: 1, day: 10 })
    const ran = (await scheduled(page, 'ag-tessera')) as AnyState
    expect(requests.length).toBeGreaterThanOrEqual(1)
    expect(ran.status).not.toBe('held')
    // B10: the run keeps where the line stood at its end — its row says it with the mini bar
    expect(ran.regler).toMatchObject({ binding: 'day', limit: 10 })
    await expect(page.getByTestId('agx-run-regler').first()).toContainText('Governor today')
    await expect(page.getByTestId('agx-run-regler').first()).toContainText('of $10.00 · rest today')
    await expect(page.getByTestId('agx-run-regler').first().locator('.gv-minibar')).toBeVisible()
  })

  test('the start check counts what the first request carries (its MCP servers\' rounds): held at the start, nothing sent; a first request refused anyway joins the same held record — never a run of its own', async ({ page }) => {
    const { requests } = await mockClaudeScript(page.context(), [R3, R3])
    await openApp(page)
    await KEY(page)
    await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), [ARCHIVE])
    await putAgent(page, { id: 'ag-nordlicht', name: 'Nordlicht digest', mcpServers: ['archive'] })
    // 0,20 $ left: the first step alone (prompt + 4 096 on Opus ≈ 0,11 $) fits — with the server's rounds (≈ 0,27 $) it does not
    await budget(page, { v: 1, day: 1 })
    await spend(page, 0.8)
    await agentsLoaded(page)
    const rec = (await scheduled(page, 'ag-nordlicht')) as AnyState
    expect(rec).toMatchObject({ status: 'held', held: { kind: 'notStarted', binding: 'day', count: 1 } })
    expect(requests).toHaveLength(0)
    // an estimate that let the start through (the seam): the first request is refused at the gate — nothing sent, the day's
    // ONE held record counts it, no run of its own (no 'running' left behind)
    await page.evaluate(() => (window as unknown as { __oneGovernor: { passStarts(on: boolean): void } }).__oneGovernor.passStarts(true))
    const again = (await scheduled(page, 'ag-nordlicht')) as AnyState
    expect(again).toMatchObject({ id: rec.id, status: 'held', held: { kind: 'notStarted', count: 2 } })
    expect(requests).toHaveLength(0)
    await page.evaluate(() => (window.location.hash = '#/agents/ag-nordlicht'))
    await expect(page.locator('.agx-run')).toHaveCount(1)
    await expect(page.getByTestId('agx-run-held')).toContainText('2 × not started')
    await expect(heldToasts(page)).toHaveCount(1)
    // positive control: without the server the same start fits and runs
    await page.evaluate(() => (window as unknown as { __oneGovernor: { passStarts(on: boolean): void } }).__oneGovernor.passStarts(false))
    await wsEval(page, (s) => s.updateSettings({ mcpServers: [] }))
    const ran = (await scheduled(page, 'ag-nordlicht')) as AnyState
    expect(ran.status).not.toBe('held')
    expect(requests).toHaveLength(1)
  })

  test('mid-run at the line the run stops after its step: held, its proposal kept, the old state kept ("State not saved"); positive control: a day that holds it runs to the end', async ({ page }) => {
    const big = { blocks: [{ type: 'tool_use' as const, id: 'toolu_b6c', name: 'search_pages', input: { query: 'Tessera' } }], usage: { input: 2000, output: 9000 } }
    const { requests } = await mockClaudeScript(page.context(), [R1, big, R1, big, R3])
    await openApp(page)
    await KEY(page)
    await putAgent(page, { id: 'ag-nordlicht', name: 'Nordlicht digest' })
    await budget(page, { v: 1, day: 1 })
    await spend(page, 0.79)
    await agentsLoaded(page, '#/agents/ag-nordlicht')
    const run = (await scheduled(page, 'ag-nordlicht')) as AnyState
    expect(requests).toHaveLength(2)
    expect(run).toMatchObject({ status: 'held', held: { kind: 'stopped', binding: 'day' } })
    expect(run.staged).toHaveLength(1)
    expect(run.staged[0]).toMatchObject({ kind: 'create_page', status: 'pending', title: 'Nordlicht brief' })
    expect(run.brake.binding).toBe('day')
    const row = page.locator('.agx-run').first()
    await expect(row).toHaveAttribute('data-status', 'held')
    await expect(page.getByTestId('agx-run-held')).toContainText('Stopped at the red line (day budget $1.00)')
    await expect(page.getByTestId('agx-run-held')).toContainText('State not saved')
    // on its page: no toast
    await expect(heldToasts(page)).toHaveCount(0)
    expect(await reservedAll(page)).toBe(0)
    // positive control: a day that holds it — the same run goes to its end (3 requests), staged for review
    await budget(page, { v: 1, day: 10 })
    const ok = (await scheduled(page, 'ag-nordlicht')) as AnyState
    expect(ok.status).toBe('staged')
    expect(requests).toHaveLength(5)
  })

  test('the start check names the route it priced as people read it (a refusal\'s toast never says a raw id or the agent\'s name)', async ({ page }) => {
    await mockClaudeScript(page.context(), [])
    await openApp(page)
    await KEY(page)
    await putAgent(page, { id: 'ag-nordlicht', name: 'Nordlicht digest' })
    await budget(page, { v: 1, day: 1 })
    await spend(page, 0.98)
    await agentsLoaded(page)
    const v = (await page.evaluate(() => (window as unknown as RunSeam).__oneAgentRun.startCheck('ag-nordlicht'))) as AnyState
    expect(v).toMatchObject({ start: false, ask: { binding: 'day' } })
    expect(v.label).toMatch(/Opus 5\.5/)
    expect(v.label).not.toContain('Nordlicht digest')
    expect(v.label).not.toMatch(/claude-opus/)
    // positive control below the line: it starts — and still names its route
    await budget(page, { v: 1, day: 10 })
    expect(await page.evaluate(() => (window as unknown as RunSeam).__oneAgentRun.startCheck('ag-nordlicht'))).toMatchObject({ start: true })
  })

  test('a manual run at the line asks where it was pressed: Esc starts nothing (agent page); from a database command ↵ starts it with +1 $ for that run', async ({ page }) => {
    const { requests } = await mockClaudeScript(page.context(), [R3, R3])
    await openApp(page)
    await KEY(page)
    const db = await pageIdByTitle(page, 'Projects')
    await putAgent(page, { id: 'ag-nordlicht', name: 'Nordlicht digest', trigger: { type: 'manual' }, scope: { everything: false, pages: [], databases: [db] }, write: 'none' })
    await budget(page, { v: 1, day: 1 })
    await spend(page, 0.95)
    await agentsLoaded(page, '#/agents/ag-nordlicht')
    await page.getByRole('button', { name: 'Run now' }).click()
    const dlg = page.getByRole('dialog')
    await expect(dlg).toContainText('Red line · Nordlicht digest')
    await expect(dlg).toContainText('Rest today $0.05')
    await expect(dlg.getByRole('button', { name: /\+\$1 once and start/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
    await page.waitForTimeout(400)
    expect(requests).toHaveLength(0)
    await expect(page.locator('.agx-run')).toHaveCount(0)
    // the database command: the same question there; ↵ allows +1 $ for this run and starts it
    const r = page.locator('.sb section[aria-label="Pages"] .sb-row', { has: page.locator('.sb-row__title', { hasText: /^Projects$/ }) })
    await r.hover()
    await r.getByTestId('tree-commands').click()
    await page.locator('.popover.cmd-menu').getByRole('menuitem', { name: 'Run “Nordlicht digest” now' }).click()
    await expect(page.getByRole('dialog')).toContainText('Red line · Nordlicht digest')
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')
    await expect.poll(() => requests.length).toBe(1)
    await expect.poll(async () => (await ledger(page)).filter((e) => e.source.startsWith('agent:ag-nordlicht:')).length).toBe(1)
    const [e] = (await ledger(page)).filter((e) => e.source.startsWith('agent:ag-nordlicht:'))
    expect(e.allowance).toBe(1)
    expect(e.steps).toEqual(expect.arrayContaining([{ k: 'allowance', code: '1' }]))
  })
})

/* ------------------------------------------------------------------ */
/* B7 — background work at the line                                    */
/* ------------------------------------------------------------------ */

const SUMMARY = text(JSON.stringify({ value: 'Nordlicht launch — summary.' }))
const valueOf = (page: Page, row: string, prop: string) => wsEval(page, (s, a) => s.pages[a.row].properties[a.prop] ?? null, { row, prop })

/** Projects with an auto-updating AI "Summary" (the watch runs while a database view is open). */
async function autoSummary(page: Page): Promise<{ db: string; prop: string }> {
  const db = await pageIdByTitle(page, 'Projects')
  await gotoPage(page, db)
  const prop = (await wsEval(page, (s, db) => s.addProperty(db, { type: 'text', name: 'Summary', autofill: { preset: 'summary', auto: true, skipReview: false } }), db)) as string
  return { db, prop }
}

/** The table view → header → property menu → "AI autofill…" → the panel. */
async function openAutofillPanel(page: Page, propName: string) {
  await page.locator('#main section.db').first().getByRole('tab').filter({ hasText: 'All projects' }).click()
  await expect(page.locator('#main section.db').first()).toHaveAttribute('data-view', 'table')
  await page.locator('#main section.db').first().locator('.dbt-hcell__btn', { hasText: propName }).click()
  await page.getByRole('menuitem', { name: /AI autofill/ }).click()
  const dlg = page.getByRole('dialog', { name: `AI autofill · ${propName}` })
  await expect(dlg).toBeVisible()
  return dlg
}

/** A small task database "Nordlicht Aufgaben": Status (Offen / Erledigt) · Priorität (Hoch / Niedrig); ids back. */
async function nordlichtTasks(page: Page): Promise<{ db: string; rows: string[] }> {
  return wsEval(page, (s) => {
    const db = s.createDatabase({
      title: 'Nordlicht Aufgaben',
      parentId: null,
      properties: [
        { id: 'p_name', name: 'Name', type: 'title' },
        { id: 'p_status', name: 'Status', type: 'select', options: [{ id: 'o_open', name: 'Offen', color: 'blue' }, { id: 'o_done', name: 'Erledigt', color: 'green' }] },
        { id: 'p_prio', name: 'Priorität', type: 'select', options: [{ id: 'o_high', name: 'Hoch', color: 'red' }, { id: 'o_low', name: 'Niedrig', color: 'gray' }] },
      ],
    }) as string
    const rows = (['Launch plan', 'Tessera Angebot', 'Mara Lind anrufen'] as const).map((title, i) => s.createRow(db, { title, properties: { p_status: i === 2 ? 'o_done' : 'o_open', p_prio: 'o_low' } }) as string)
    return { db, rows }
  })
}
const prioOf = (page: Page, ids: string[]) => wsEval(page, (s, ids) => ids.map((id: string) => s.pages[id].properties.p_prio), ids)
async function addScript(page: Page, name: string, code: string): Promise<string> {
  return wsEval(
    page,
    (s, a) => {
      const id = `sc${Math.random().toString(36).slice(2, 10)}`
      s.upsertScript({ id, name: a.name, code: a.code, kind: 'script', createdAt: Date.now(), updatedAt: Date.now() })
      return id
    },
    { name, code },
  )
}

/** Claude answering the scripts' claude() (SSE); `before(n)` runs before the n-th answer (0-based) goes back. */
async function mockScriptClaude(page: Page, before?: (n: number) => Promise<void>): Promise<string[]> {
  const bodies: string[] = []
  await page.context().route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (req.method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [], has_more: false }) })
    bodies.push(req.postData() ?? '')
    await before?.(bodies.length - 1)
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse('Nordlicht läuft.') })
  })
  return bodies
}

test.describe('background work at the line (B7 · case 7)', () => {
  test('the autofill watch: below the line a change is filled; at the line zero requests — the row paused with its cause, kept over a reload; a raised budget fills it as the autofill', async ({ page }) => {
    const { requests } = await mockClaudeScript(page.context(), [], { fallback: SUMMARY })
    await openApp(page)
    await KEY(page)
    await startRecorder(page)
    const { db, prop } = await autoSummary(page)
    await budget(page, { v: 1, day: 1 })
    // positive control: below the line the watch fills a changed row
    const launch = await pageIdByTitle(page, 'Website relaunch')
    await wsEval(page, (s, id) => s.updatePage(id, { title: 'Website relaunch Nordlicht' }), launch)
    await expect.poll(() => requests.length, { timeout: 15_000 }).toBe(1)
    await expect.poll(() => valueOf(page, launch, prop)).toBe('Nordlicht launch — summary.')
    // at the line: the next change sends nothing — the row waits, persisted with the change that caused it
    await spend(page, 1)
    const brand = await pageIdByTitle(page, 'Brand refresh')
    await wsEval(page, (s, id) => s.updatePage(id, { title: 'Brand refresh Tessera' }), brand)
    await expect.poll(async () => (await pausedRowsOf(page)).rows, { timeout: 15_000 }).toEqual([expect.objectContaining({ db, prop, row: brand, cause: 'you~ui:e2e' })])
    await page.waitForTimeout(500)
    expect(requests).toHaveLength(1)
    expect(await valueOf(page, brand, prop)).toBeNull()
    expect((await ledger(page)).filter((e) => e.source.startsWith('autofill:'))).toHaveLength(1)

    // a reload keeps it; the watch never resumes at start
    await flush(page)
    await reloadApp(page)
    await startRecorder(page)
    expect((await pausedRowsOf(page)).rows).toHaveLength(1)
    await gotoPage(page, db)
    await page.waitForTimeout(800)
    expect(requests).toHaveLength(1)
    // a raised budget: the paused row is filled — written as the autofill, caused by the person's change
    const m = await markRec(page)
    await budget(page, { v: 1, day: 10 })
    await expect.poll(() => requests.length, { timeout: 15_000 }).toBe(2)
    await expect.poll(() => valueOf(page, brand, prop)).toBe('Nordlicht launch — summary.')
    await expectLane(page, m, 'autofill', undefined, new RegExp(`^autofill:${db}/${prop}<you~ui:e2e$`))
    expect((await pausedRowsOf(page)).rows).toEqual([])
    const [, e] = (await ledger(page)).filter((e) => e.source.startsWith('autofill:'))
    expect(e.source).toMatch(new RegExp(`^autofill:${db}:${prop}:w\\d{8}$`))
  })

  test('E in the panel fills the paused rows now (+1 $ for the watch today, on its entry); a person\'s run at the line waits at a row boundary — Stop ends it, E goes on', async ({ page }) => {
    const { requests } = await mockClaudeScript(page.context(), [], { fallback: SUMMARY })
    await openApp(page)
    await KEY(page)
    const { db, prop } = await autoSummary(page)
    await budget(page, { v: 1, day: 1 })
    await spend(page, 1)
    const brand = await pageIdByTitle(page, 'Brand refresh')
    await wsEval(page, (s, id) => s.updatePage(id, { title: 'Brand refresh Tessera' }), brand)
    await expect.poll(async () => (await pausedRowsOf(page)).rows.length, { timeout: 15_000 }).toBe(1)

    const dlg = await openAutofillPanel(page, 'Summary')
    const rowsStrip = dlg.getByTestId('af-paused-rows')
    await expect(rowsStrip).toContainText('1 row waits at the red line')
    // before a person's run starts (§ 5.7, acceptance 6): its band against the rest — over it here
    const band = dlg.getByTestId('af-regler')
    await expect(band).toContainText(/Governor: this run ≈ \$[\d.]+–\u2060?[\d.]+ · rest \$0/)
    await expect(band).toHaveAttribute('data-over', 'true')
    await expect(band).toContainText('Over the red line')
    // E only with focus in the strip
    await page.keyboard.press('e')
    await page.waitForTimeout(300)
    expect(requests).toHaveLength(0)
    await rowsStrip.getByRole('button', { name: /\+\$1 once and fill them/ }).focus()
    await page.keyboard.press('e')
    await expect.poll(() => requests.length, { timeout: 15_000 }).toBe(1)
    await expect.poll(() => valueOf(page, brand, prop)).toBe('Nordlicht launch — summary.')
    await expect(rowsStrip).toHaveCount(0)
    const [w] = (await ledger(page)).filter((e) => e.source.startsWith('autofill:'))
    expect(w.source).toMatch(new RegExp(`^autofill:${db}:${prop}:w\\d{8}$`))
    expect(w.allowance).toBe(1)

    // the person's run: every row waits at the line (nothing sent); Stop ends it
    await dlg.getByRole('button', { name: /Fill all rows/ }).click()
    const runStrip = dlg.getByTestId('af-paused-run')
    await expect(runStrip).toContainText('Paused at the red line')
    await page.waitForTimeout(400)
    expect(requests).toHaveLength(1)
    await runStrip.getByRole('button', { name: 'Stop' }).click()
    await expect(runStrip).toHaveCount(0)
    await expect(dlg.getByText('Run complete')).toBeVisible()
    expect(requests).toHaveLength(1)
    await dlg.getByRole('button', { name: 'Done' }).click()
    await expect(dlg).toBeHidden()

    // again: E with focus in the strip goes on (+1 $ for this run) — every row is filled, then the review
    const dlg2 = await openAutofillPanel(page, 'Summary')
    await dlg2.getByRole('button', { name: /Fill all rows/ }).click()
    const strip2 = dlg2.getByTestId('af-paused-run')
    await expect(strip2).toBeVisible()
    await strip2.getByRole('button', { name: /\+\$1 once and go on/ }).focus()
    await page.keyboard.press('e')
    await expect(dlg2.getByRole('table', { name: 'Proposed values' })).toBeVisible({ timeout: 20_000 })
    expect(requests).toHaveLength(9)
    const run = (await ledger(page)).filter((e) => e.source.startsWith('autofill:') && !/:w\d{8}$/.test(e.source))
    expect(run).toHaveLength(8)
    expect(new Set(run.map((e) => e.source)).size).toBe(1)
    expect(run.every((e) => e.allowance === 1)).toBe(true)
  })

  test('a script\'s claude() crossing the line mid-run stops the run there ("Undo run" takes its writes back); positive control: a day that holds it runs to the end', async ({ page }) => {
    let pageRef: Page | null = null
    const bodies = await mockScriptClaude(page, async (n) => {
      // the first answer of the first run: the rest of the day is spent while it streams
      if (n === 0 && pageRef) await spend(pageRef, 1)
    })
    await openApp(page)
    pageRef = page
    await KEY(page)
    const { db, rows } = await nordlichtTasks(page)
    const code = `for t in db(@[Nordlicht Aufgaben](p:${db})).where(Status = "Offen") {\n  t.set(Priorität: "Hoch")\n}\nlet a = claude("Fasse Nordlicht zusammen")\nprint(a)\nlet b = claude("Und Tessera")\nprint(b)\n`
    const id = await addScript(page, 'Nordlicht Bericht', code)
    await budget(page, { v: 1, day: 1 })
    await page.evaluate((id) => (window.location.hash = `#/scripts/${id}`), id)
    await expect(page.locator('.sc-code__input')).toBeVisible()
    await page.getByTestId('sc-run').click()
    await expect(page.getByTestId('sc-dialog-plan')).toContainText('Ask Claude: Und Tessera')
    await page.getByRole('button', { name: 'Run (2 of 2)' }).click()
    const out = page.getByTestId('sc-console')
    await expect(out).toHaveAttribute('data-status', 'error')
    await expect(out).toContainText('Red line: claude was not sent — the run stopped here')
    expect(bodies).toHaveLength(1)
    expect(await prioOf(page, rows)).toEqual(['o_high', 'o_high', 'o_low'])
    // Undo run
    await page.getByRole('tab', { name: 'Run log' }).click()
    const last = page.getByTestId('sc-runs').locator('.sc-run').first()
    await expect(last).toHaveAttribute('data-status', 'error')
    await last.locator('.sc-run__head').click()
    await last.getByRole('button', { name: 'Undo run' }).click()
    await expect.poll(() => prioOf(page, rows)).toEqual(['o_low', 'o_low', 'o_low'])

    // positive control: a day that holds it — both requests, to the end
    await budget(page, { v: 1, day: 10 })
    await page.getByRole('tab', { name: 'Console' }).click()
    await page.getByTestId('sc-run').click()
    await page.getByRole('button', { name: 'Run (2 of 2)' }).click()
    await expect(page.getByTestId('sc-console')).toHaveAttribute('data-status', 'ok')
    expect(bodies).toHaveLength(3)
    expect(await prioOf(page, rows)).toEqual(['o_high', 'o_high', 'o_low'])
  })

  test('an automation\'s script at the line: claude() is refused at the effect (nothing sent), the automation says "Red line"; its other actions run; positive control below the line', async ({ page }) => {
    const bodies = await mockScriptClaude(page)
    await openApp(page)
    await KEY(page)
    const { db, rows } = await nordlichtTasks(page)
    const scriptId = await addScript(page, 'Nordlicht Notiz', 'let a = claude("Fasse Nordlicht zusammen")\nprint(a)\n')
    await wsEval(
      page,
      (s, a) =>
        s.updateDatabase(a.db, {
          automations: [{ id: 'au-nl', name: 'Nordlicht', enabled: true, trigger: { type: 'property_changed', propertyId: 'p_status' }, actions: [{ type: 'run_script', scriptId: a.scriptId }, { type: 'set_property', propertyId: 'p_prio', value: 'o_high' }], lastRunAt: null, lastStatus: null, lastMessage: null }],
        }),
      { db, scriptId },
    )
    await budget(page, { v: 1, day: 1 })
    await spend(page, 1)
    await wsEval(page, (s, id) => s.setRowProperty(id, 'p_status', 'o_done'), rows[0])
    const plan = page.getByTestId('sc-dialog-plan')
    // the person's consent to the effect (scripts ask once per run, automations too)
    await expect(plan).toContainText('Ask Claude: Fasse Nordlicht zusammen')
    await page.getByRole('button', { name: 'Run (1 of 1)' }).click()
    const status = () => wsEval(page, (s, db) => JSON.parse(JSON.stringify(s.databases[db].automations[0])), db)
    await expect.poll(async () => (await status()).lastStatus, { timeout: 15_000 }).toBe('error')
    expect((await status()).lastMessage).toContain('Red line — Nordlicht Notiz: its AI step was not sent')
    expect(bodies).toHaveLength(0)
    await expect.poll(() => prioOf(page, rows)).toEqual(['o_high', 'o_low', 'o_low'])

    // positive control: the line raised — the next change sends the script's request
    await budget(page, { v: 1, day: 10 })
    await wsEval(page, (s, id) => s.setRowProperty(id, 'p_status', 'o_done'), rows[1])
    // the person's consent to the effect (scripts ask once per run, automations too)
    await expect(plan).toContainText('Ask Claude: Fasse Nordlicht zusammen')
    await page.getByRole('button', { name: 'Run (1 of 1)' }).click()
    await expect.poll(() => bodies.length, { timeout: 15_000 }).toBe(1)
    await expect.poll(async () => (await status()).lastStatus, { timeout: 15_000 }).toBe('ok')
  })

  /**
   * A follow-up never asks after the answer (§ 5.7): the task's answer (0,228 $ reported) leaves 0,022 $ of the 0,25 $ that
   * were left — the memory proposal (structured, never capped: ≈ 0,03 $ and more) is skipped with a note, nothing sent.
   * Positive control: a day that holds it sends the proposal request after the same task.
   */
  for (const atLine of [true, false]) {
    test(`a memory proposal after a terminal task ${atLine ? 'at the line is skipped with a note (nothing sent, no card)' : 'below the line is asked for (positive control)'}`, async ({ page }) => {
      const answer = text('The Nordlicht launch moves to the Tessera release.', { usage: { input: 2000, output: 11_000 } })
      const { requests } = await mockClaudeScript(page.context(), [answer, text(JSON.stringify({ memories: [] }))])
      await openApp(page)
      await KEY(page, { memory: { proposals: true } })
      await budget(page, { v: 1, day: 1 })
      await spend(page, atLine ? 0.75 : 0.05)
      await openTerminal(page)
      await runTask(page, 'When does the Nordlicht launch happen now?')
      await expect(terminal(page).locator('.term-answer')).toContainText('The Nordlicht launch moves to the Tessera release.')
      if (atLine) {
        await expect(terminal(page)).toContainText('Memory proposal skipped — red line')
        await page.waitForTimeout(500)
        expect(requests).toHaveLength(1)
        await expect(terminal(page).getByTestId('term-memory')).toHaveCount(0)
      } else {
        await expect.poll(() => requests.length).toBe(2)
        expect(JSON.stringify(requests[1].body.system)).toContain('should remember')
        await expect(terminal(page)).not.toContainText('Memory proposal skipped')
      }
      expect(await reservedAll(page)).toBe(0)
    })
  }
})

/* ------------------------------------------------------------------ */
/* B8 — the brake note everywhere a person's request fails              */
/* ------------------------------------------------------------------ */

const note = (page: Page) => page.getByTestId('gv-brake-note')
/** The note took focus (its keys act only there); past its first moment (plate.ts KEY_ARM_MS). */
async function noteReady(page: Page) {
  await expect(note(page)).toBeVisible()
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-testid="gv-brake-note"]'))).toBe(true)
  await page.waitForTimeout(450)
}

test.describe('the brake note (B8 · case 1 across the surfaces)', () => {
  test('the AI menu: Improve at the line shows the note (nothing sent); E sends exactly this request with +1 $ on its entry; a key typed in a field never acts', async ({ page }) => {
    const { requests } = await mockClaudeScript(page.context(), [text('A tighter launch sentence.')])
    await openApp(page)
    await KEY(page)
    await dayWithRest(page, 0.005)
    await improve(page, null)
    await noteReady(page)
    await expect(note(page)).toHaveAttribute('data-detail', 'day')
    await expect(note(page)).toContainText('rest today < $0.01')
    await expect(note(page).getByRole('button', { name: /\+\$1 once/ })).toBeVisible()
    await page.waitForTimeout(300)
    expect(requests).toHaveLength(0)
    // a letter typed in the panel's own field is the person's text, never the note's key
    const field = aiPanel(page).getByRole('textbox').first()
    await field.focus()
    await page.keyboard.type('e')
    await page.waitForTimeout(300)
    expect(requests).toHaveLength(0)
    // E with focus in the note: this request once, with the allowance
    await note(page).focus()
    await page.waitForTimeout(450)
    await page.keyboard.press('e')
    await expect(aiPanel(page)).toContainText('A tighter launch sentence.')
    expect(requests).toHaveLength(1)
    expect(requests[0].body.max_tokens).toBe(16000)
    await expect.poll(async () => (await ledger(page)).length).toBe(1)
    const [e] = await ledger(page)
    expect(e.allowance).toBe(1)
    expect(e.purpose).toBe('menu.action')
  })

  test('refused by this browser\'s own line (E would not do): the note says where that line is changed — Settings › AI, focused on it; a workspace budget\'s refusal points to § 06', async ({ page }) => {
    const { requests } = await mockClaudeScript(page.context(), [])
    await openApp(page)
    await KEY(page)
    // the person's own line: 1 $ a day, 2,50 $ spent — +1 $ would not do
    await page.evaluate(() => localStorage.setItem('one.governor.device', JSON.stringify({ v: 1, day: 1, at: Date.now() })))
    await wsEval(page, (s) => s.stampDeviceGen())
    await spend(page, 2.5)
    await improve(page, null)
    await expect(errorOf(page)).toHaveAttribute('data-detail', 'device-day')
    await expect(errorOf(page).getByRole('button', { name: 'Adjust the budget ↗' })).toHaveCount(0)
    await errorOf(page).getByRole('button', { name: 'Adjust my limit ↗' }).click()
    // Settings › AI, at the person's own line (never the workspace's § 06, which cannot raise it)
    await expect(page.getByTestId('gv-device')).toBeVisible()
    await expect(page.locator('[data-section="limit"]')).toBeFocused()
    expect(await page.evaluate(() => location.hash)).not.toContain('workspace')
    expect(requests).toHaveLength(0)
    await uiEval(page, (s) => s.closeModal())
    await expect(page.getByTestId('gv-device')).toHaveCount(0)
    // positive control: the workspace's budget refuses — the link goes to § 06
    await page.evaluate(() => localStorage.removeItem('one.governor.device'))
    await wsEval(page, (s) => s.stampDeviceGen())
    await budget(page, { v: 1, day: 1 })
    await improve(page, null)
    await expect(errorOf(page)).toHaveAttribute('data-detail', 'day')
    await errorOf(page).getByRole('button', { name: 'Adjust the budget ↗' }).click()
    await expect(page.getByTestId('gv-budget')).toBeVisible()
    expect(requests).toHaveLength(0)
  })

  test('help Ask at the line: the note in the help panel; E asks the question again with +1 $ — once', async ({ page }) => {
    const { requests } = await mockClaudeScript(page.context(), [text('Open **Share** and switch on **Protect with password**.'), text('Open **Share** and switch off **Protect with password**.')])
    await openApp(page)
    await KEY(page)
    const hold = await dayWithRest(page, 0.005)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
    await page.keyboard.press('?')
    const help = page.getByRole('dialog', { name: /^(Help|Hilfe)$/ })
    await help.getByRole('tab', { name: /Ask/ }).click()
    const field = help.getByRole('textbox', { name: 'Your question' })
    await field.fill('How do I protect a share link with a password?')
    await field.press('Enter')
    await noteReady(page)
    await expect(help.getByTestId('gv-brake-note')).toBeVisible()
    expect(requests).toHaveLength(0)
    await page.keyboard.press('e')
    await expect(help.locator('.help-ask__out')).toContainText('Protect with password')
    expect(requests).toHaveLength(1)
    const [e] = await ledger(page)
    expect(e.purpose).toBe('help.ask')
    expect(e.allowance).toBe(1)
    // the token was for that question only: the next one is refused again
    await field.fill('And how do I remove the password?')
    await field.press('Enter')
    await expect(note(page)).toBeVisible()
    await page.waitForTimeout(300)
    expect(requests).toHaveLength(1)
    // positive control: a day that holds it — the question goes, no note, no allowance
    await release(page, hold)
    await budget(page, { v: 1, day: 10 })
    await field.press('Enter')
    await expect(help.locator('.help-ask__out')).toContainText('switch off')
    expect(requests).toHaveLength(2)
    await expect(note(page)).toHaveCount(0)
    expect((await ledger(page))[1]).not.toHaveProperty('allowance')
  })

  test('⌘K "?" at the line: the note in the palette; Esc closes the note only — nothing sent, the question stays', async ({ page }) => {
    const { requests } = await mockClaudeScript(page.context(), [text('The launch is in two weeks.')])
    await openApp(page)
    await KEY(page)
    const hold = await dayWithRest(page, 0.005)
    const id = await createPage(page, { title: 'Launch plan', content: doc(para('We launch in two weeks.')) })
    await gotoPage(page, id)
    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('?When do we launch?')
    const pal = page.getByRole('dialog', { name: 'Command palette' })
    await page.keyboard.press('Enter')
    await noteReady(page)
    await expect(pal.getByTestId('gv-brake-note')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(note(page)).toHaveCount(0)
    await expect(pal).toBeVisible()
    // Esc closed the note only: the question is still there and the keyboard back in it (never the body)
    const input = pal.getByRole('combobox').or(pal.locator('input')).first()
    await expect(input).toBeFocused()
    await expect(input).toHaveValue(/When do we launch\?/)
    await page.waitForTimeout(300)
    expect(requests).toHaveLength(0)
    expect(await ledger(page)).toEqual([])
    // positive control: a day that holds it — the same question goes from the palette as it stands, no note
    await release(page, hold)
    await budget(page, { v: 1, day: 10 })
    await input.press('Enter')
    await expect(pal).toContainText('The launch is in two weeks.')
    expect(requests).toHaveLength(1)
    await expect(note(page)).toHaveCount(0)
  })

  test('the Outbox draft: refused at the line in the background — the dock\'s note (no error toast); E drafts it with +1 $', async ({ page }) => {
    const calls = await mockDrafts(page.context(), () => 'Thanks — the Nordlicht fix ships in the Tessera release.')
    await openApp(page)
    await outboxLoaded(page)
    const m = await seedMirrorDb(page)
    await dayWithRest(page, 0.005)
    await page.evaluate((id) => (location.hash = `#/p/${id}`), m.dbId)
    await expect(page.locator('#main .pv-title')).toBeVisible()
    const rows = page.locator('#main .dbt-row[role="row"]:not(.dbt-row--head)')
    await rows.nth(0).hover()
    await rows.nth(0).getByRole('checkbox', { name: 'Select row' }).click()
    await page.getByTestId('db-commands').click()
    await page.locator('.popover.cmd-menu').getByRole('menuitem', { name: 'Reply in the ticket tool' }).click()
    const draft = page.getByRole('dialog', { name: 'Draft a slip' })
    await draft.getByTestId('outbox-draft-claude').click()
    const dock = page.getByTestId('outbox-dock')
    await expect(dock.getByTestId('gv-brake-note')).toBeVisible()
    await expect(page.locator('.toast[data-kind="error"], .toast--error')).toHaveCount(0)
    expect(calls).toHaveLength(0)
    await note(page).focus()
    await page.waitForTimeout(450)
    await page.keyboard.press('e')
    await expect(dock.getByTestId('outbox-slip')).toBeVisible()
    expect(calls).toHaveLength(1)
    await expect(note(page)).toHaveCount(0)
    const [e] = (await ledger(page)).filter((x) => x.purpose === 'outbox.draft')
    expect(e.allowance).toBe(1)
  })

  test('the Outbox draft below the line (positive control): drafted at once — no note, no allowance; its entry carries the band it was judged on', async ({ page }) => {
    const calls = await mockDrafts(page.context(), () => 'Thanks — the Nordlicht fix ships in the Tessera release.')
    await openApp(page)
    await outboxLoaded(page)
    const m = await seedMirrorDb(page)
    await budget(page, { v: 1, day: 10 })
    await page.evaluate((id) => (location.hash = `#/p/${id}`), m.dbId)
    await expect(page.locator('#main .pv-title')).toBeVisible()
    const rows = page.locator('#main .dbt-row[role="row"]:not(.dbt-row--head)')
    await rows.nth(0).hover()
    await rows.nth(0).getByRole('checkbox', { name: 'Select row' }).click()
    await page.getByTestId('db-commands').click()
    await page.locator('.popover.cmd-menu').getByRole('menuitem', { name: 'Reply in the ticket tool' }).click()
    await page.getByRole('dialog', { name: 'Draft a slip' }).getByTestId('outbox-draft-claude').click()
    const dock = page.getByTestId('outbox-dock')
    await expect(dock.getByTestId('outbox-slip')).toBeVisible()
    expect(calls).toHaveLength(1)
    await expect(note(page)).toHaveCount(0)
    await expect.poll(async () => (await ledger(page)).filter((x) => x.purpose === 'outbox.draft').length).toBe(1)
    const [e] = (await ledger(page)).filter((x) => x.purpose === 'outbox.draft')
    expect(e).not.toHaveProperty('allowance')
    expect(e.band.high).toBeGreaterThan(0)
    expect(e.source).toMatch(/^outbox:/)
  })

  test('the kit fill (structured, never capped): B sends it with the cheaper model as the person\'s pick; the setup test at the line shows the note; positive control below the line', async ({ page }) => {
    const items = text(JSON.stringify({ items: [{ name: 'Nordlicht', color: 'blue' }, { name: 'Tessera', color: 'green' }] }))
    const { requests } = await mockClaudeScript(page.context(), [items, items])
    await openApp(page)
    await KEY(page)
    // Opus 5.5 (6 000 answer tokens ≈ 0,12 $) is over the 0,06 $ left; Haiku 4.5 (≈ 0,03 $) fits
    let hold = await dayWithRest(page, 0.06)
    const listId = 'ls-launch'
    await wsEval(page, (s, id) => s.upsertList({ id, name: 'Launch phases', items: [], createdAt: 0, updatedAt: 0 }), listId)
    await page.evaluate((id) => (location.hash = `#/kit/lists/${id}`), listId)
    const prompt = page.getByTestId('kt-fill-prompt')
    await prompt.fill('Phases of the Nordlicht launch')
    await prompt.press('Enter')
    await noteReady(page)
    await expect(note(page).getByRole('button', { name: /With (Claude )?Haiku 4\.5/ })).toBeVisible()
    expect(requests).toHaveLength(0)
    await page.keyboard.press('b')
    await expect(page.getByTestId('kt-proposals')).toContainText('Tessera')
    expect(requests).toHaveLength(1)
    expect(requests[0].body.model).toBe('claude-haiku-4-5')
    const [e] = await ledger(page)
    expect(e.route).toBe('anthropic:claude-haiku-4-5')
    expect(e).not.toHaveProperty('allowance')
    // nothing stays armed: the next fill asks again (Opus over the line)
    await page.evaluate((id) => (location.hash = `#/kit/lists/${id}`), listId)
    await release(page, hold)
    hold = await dayWithRest(page, 0.0001)
    // the setup's test sentence: the note under the rows, Esc closes it
    await uiEval(page, (s) => s.openModal({ type: 'aiSetup', reason: 'rotate', step: 'key', provider: 'anthropic' }))
    await page.getByTestId('test-sentence').click()
    await expect(page.getByTestId('check-bench').getByTestId('gv-brake-note')).toBeVisible()
    await page.waitForTimeout(300)
    expect(requests).toHaveLength(1)
    await page.keyboard.press('Escape')
    await expect(note(page)).toHaveCount(0)
    // the note went: the keyboard back on the test key (never the body)
    await expect(page.getByTestId('test-sentence')).toBeFocused()
    // below the line: the test sentence sends
    await release(page, hold)
    await budget(page, { v: 1, day: 10 })
    await page.getByTestId('test-sentence').click()
    await expect.poll(() => requests.length).toBe(2)
  })

  test('a script\'s consent card: the band of its AI calls against the rest; over the line E allows +1 $ for the run and both calls go; without a budget the card is as before', async ({ page }) => {
    const bodies = await mockScriptClaude(page)
    await openApp(page)
    await KEY(page)
    const id = await addScript(page, 'Nordlicht Bericht', 'let a = claude("Fasse Nordlicht zusammen")\nprint(a)\nlet b = claude("Und Tessera")\nprint(b)\n')
    await page.evaluate((id) => (window.location.hash = `#/scripts/${id}`), id)
    await expect(page.locator('.sc-code__input')).toBeVisible()
    // no budget: the card as before
    await page.getByTestId('sc-run').click()
    await expect(page.getByTestId('sc-dialog-plan')).toContainText('Ask Claude: Und Tessera')
    await expect(page.getByTestId('sc-plan-band')).toHaveCount(0)
    await page.getByRole('button', { name: 'Cancel' }).click()
    // at the line: the band, over the red line, E for the run
    await budget(page, { v: 1, day: 1 })
    await spend(page, 1)
    await page.getByTestId('sc-run').click()
    const band = page.getByTestId('sc-plan-band')
    await expect(band).toContainText('AI calls 2 ×')
    await expect(band).toContainText('Over the red line')
    await band.getByRole('button', { name: /\+\$1 once for this run/ }).focus()
    await page.keyboard.press('e')
    await expect(band).toContainText('+$1 allowed for this run, today.')
    // the E key went: the keyboard on the dialog's run key (never the body) — ↵ runs it
    await expect(page.getByRole('button', { name: 'Run (2 of 2)' })).toBeFocused()
    expect(bodies).toHaveLength(0)
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('sc-console')).toHaveAttribute('data-status', 'ok')
    expect(bodies).toHaveLength(2)
    const runs = (await ledger(page)).filter((e) => e.source.startsWith(`script:${id}:`))
    expect(runs).toHaveLength(2)
    expect(new Set(runs.map((e) => e.source)).size).toBe(1)
  })
})

/* ------------------------------------------------------------------ */
/* B9 — the status cell, VERBRAUCH, receipts; case 8                    */
/* ------------------------------------------------------------------ */

const cell = (page: Page) => page.locator('.status .gv-cell')
const lampOf = async (page: Page): Promise<AnyState | null> => {
  await page.evaluate(() => (window as unknown as { __onePreflight: AnyState }).__onePreflight.flush())
  const r = await page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __onePreflight: AnyState }).__onePreflight.readings())))
  return (r.governor as AnyState | undefined) ?? null
}

test.describe('the status cell, VERBRAUCH, receipts (B9)', () => {
  test('the REGLER cell: none without a budget; the amount once the day is read; amber at 75 %; ROTLINIE · PAUSE at the line; it fits a narrow bar', async ({ page }) => {
    await openApp(page)
    await KEY(page)
    await page.waitForTimeout(500)
    await expect(cell(page)).toHaveCount(0)
    await budget(page, { v: 1, day: 6 })
    await expect(cell(page)).toBeVisible()
    await expect(cell(page)).toContainText('Governor')
    await expect(cell(page).locator('.gv-cell__val--wide')).toHaveText('$0.00 / $6', { timeout: 15_000 })
    await expect(cell(page)).toHaveAttribute('data-level', 'ok')
    await spend(page, 4.6)
    await expect(cell(page)).toHaveAttribute('data-level', 'amber')
    await expect(cell(page).locator('.gv-cell__val--wide')).toHaveText('$4.60 / $6')
    await expect(cell(page).locator('.gv-cell__bar')).toBeVisible()
    // a narrower bar sheds the mini bar at level 7 (after the six older levels); the amount and the LED stay, nothing
    // scrolls sideways
    const bar = page.locator('.status')
    let shed7 = 0
    for (const width of [1200, 1100, 1000, 940, 880, 820]) {
      await page.setViewportSize({ width, height: 800 })
      await page.waitForTimeout(150)
      expect(await bar.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `no overflow at ${width}`).toBe(true)
      await expect(cell(page).locator('.gv-cell__led')).toBeVisible()
      await expect(cell(page).locator('.gv-cell__val--wide, .gv-cell__val--short').filter({ visible: true })).toHaveCount(1)
      if ((await bar.getAttribute('data-shed-7')) !== null) {
        shed7++
        await expect(cell(page).locator('.gv-cell__bar')).toBeHidden()
      } else await expect(cell(page).locator('.gv-cell__bar')).toBeVisible()
    }
    expect(shed7, 'level 7 reached at a narrow width').toBeGreaterThan(0)
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(cell(page).locator('.gv-cell__bar')).toBeVisible()
    await spend(page, 1.5)
    await expect(cell(page)).toHaveAttribute('data-level', 'red')
    await expect(cell(page)).toContainText('Red line · pause')
    // the budget removed: the cell goes
    await budget(page, null)
    await expect(cell(page)).toHaveCount(0)
  })

  test('the REGLER cell says "—" until the day is read (never a guess before the ledger answered); then the amount', async ({ page }) => {
    // idle never comes in this tab: the day's read (whenIdle after the first paint) waits until the spec calls it
    await page.addInitScript(() => {
      ;(window as unknown as { requestIdleCallback: () => number }).requestIdleCallback = () => 0
    })
    await openApp(page)
    await KEY(page)
    await spend(page, 1.2)
    await budget(page, { v: 1, day: 6 })
    await expect(cell(page)).toBeVisible()
    await page.waitForTimeout(800)
    await expect(cell(page).locator('.gv-cell__val--wide')).toHaveText('—')
    await expect(cell(page)).not.toHaveAttribute('data-known', /.*/)
    await expect(cell(page).locator('.gv-cell__bar')).toHaveCount(0)
    // the day read: the amount (this tab's own spend counted), the bar
    await page.evaluate(() => (window as unknown as Seam).__oneGovernor.load())
    await expect(cell(page).locator('.gv-cell__val--wide')).toHaveText('$1.20 / $6')
    await expect(cell(page).locator('.gv-cell__bar')).toBeVisible()
  })

  test('VERBRAUCH: not fitted without a budget; amber at 75 % without MASTER CAUTION; red at the line with it — one ack id per band and day', async ({ page }) => {
    await openApp(page)
    await KEY(page)
    expect(await lampOf(page)).toBeNull()
    await budget(page, { v: 1, day: 1 })
    await expect.poll(async () => (await lampOf(page))?.count ?? -1, { timeout: 15_000 }).toBe(0)
    await spend(page, 0.8)
    await expect.poll(async () => (await lampOf(page))?.level ?? null).toBe('amber')
    const amber = (await lampOf(page))!
    expect(amber).toMatchObject({ count: 1, master: false, second: '$0.80/1' })
    expect(amber.ids).toEqual([expect.stringMatching(/^use:\d{4}-\d{2}-\d{2}:amber$/)])
    await spend(page, 0.25)
    await expect.poll(async () => (await lampOf(page))?.level ?? null).toBe('red')
    const red = (await lampOf(page))!
    expect(red).toMatchObject({ count: 1, master: true })
    expect(red.ids).toEqual([expect.stringMatching(/^use:\d{4}-\d{2}-\d{2}:red$/)])
  })

  test('receipts: the capped answer budget and the band — EN, then DE; /cost says the rest of the day', async ({ page }) => {
    const { requests } = await mockClaudeScript(page.context(), [text('A tighter launch sentence.'), text('We launch in two weeks.')])
    await openApp(page)
    await KEY(page)
    // a little left: Improve's answer budget is capped
    const hold = await dayWithRest(page, 0.06)
    await improve(page)
    expect(requests).toHaveLength(1)
    const receipt = aiPanel(page).getByTestId('ai-receipt')
    await expect(receipt).toBeVisible()
    await expect(receipt).toHaveAttribute('title', /Answer budget capped to [\d,]+ tokens/)
    await expect(receipt).toHaveAttribute('title', /Estimate \$[\d.]+/)
    // the same receipt in German
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await expect(receipt).toHaveAttribute('title', /Antwortbudget auf [\d.]+ Token gekappt/)
    await expect(receipt).toHaveAttribute('title', /Schätzung [\d,]+/)
    await page.keyboard.press('Escape')
    await wsEval(page, (s) => s.updateSettings({ language: 'en' }))
    // /cost in the terminal: the line that binds today and its rest
    await release(page, hold)
    await budget(page, { v: 1, day: 6 })
    await openTerminal(page)
    await runTask(page, 'When do we launch?')
    await expect(terminal(page).locator('.term-answer').last()).toContainText('We launch in two weeks.')
    await runTask(page, '/cost')
    await expect(terminal(page).getByTestId('term-cost-regler').last()).toHaveText(/^Governor: today \$0\.\d\d of \$6 · rest \$5\.\d\d$/)
  })

  test('the coding worker\'s Claude Code cost: as before without a budget; with one the line says it is not counted (EN, DE)', async ({ page }) => {
    await openApp(page)
    await page.waitForFunction(() => !!(window as unknown as { __oneCoding?: unknown }).__oneCoding)
    const line = () => page.evaluate(() => (window as unknown as { __oneCoding: AnyState }).__oneCoding.lineText({ t: Date.now(), k: 'info', s: 'Claude Code finished', c: 'claudeDone', v: { turns: 7, cost: '3.9' } }) as string)
    expect(await line()).toBe('Claude Code finished · 7 turns · $3.90')
    await budget(page, { v: 1, day: 6 })
    expect(await line()).toBe('Claude Code finished · 7 turns · $3.90 · not counted in the day budget')
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    expect(await line()).toBe('Claude Code fertig · 7 Schritte · 3,90\u00a0$ · zählt nicht zum Tagesbudget')
    await budget(page, null)
    expect(await line()).toBe('Claude Code fertig · 7 Schritte · 3,90\u00a0$')
  })

  test('case 8 — two tabs: B waits for A\'s reservation (reservedOthers > 0) and is refused while it is open; allowed once it settles', async ({ page }) => {
    const answer = text(JSON.stringify({ answer: 'In two weeks.' }))
    await mockClaudeScript(page.context(), [answer, answer, answer])
    let holding = true
    let release1: () => void = () => {}
    const gate = new Promise<void>((r) => (release1 = r))
    let held = 0
    await page.context().route('https://api.anthropic.com/**', async (route) => {
      if (!holding || route.request().method() === 'OPTIONS') return route.fallback()
      holding = false
      held++
      await gate
      return route.fallback()
    })
    await openApp(page)
    await KEY(page)
    await budget(page, { v: 1, day: 0.1 })
    await flush(page)
    const b = await page.context().newPage()
    await openApp(b)
    await budget(b, { v: 1, day: 0.1 })
    const Q = { purpose: 'help.ask', prompt: 'When does the Nordlicht launch happen?', structured: true }
    // A: a request whose answer is held — its reservation stays open
    const aDone = ask(page, Q)
    await expect.poll(() => held).toBe(1)
    await expect.poll(() => b.evaluate(() => (window as unknown as Seam).__oneGovernor.reservedOthers() as number), { timeout: 15_000 }).toBeGreaterThan(0)
    // B: the rest minus A's reservation does not hold the band
    expect(await ask(b, Q)).toMatchObject({ ok: false, code: 'budget' })
    // A's answer comes; its reservation settles (B hears it); B is allowed
    release1()
    expect(await aDone).toMatchObject({ ok: true })
    await expect.poll(() => b.evaluate(() => (window as unknown as Seam).__oneGovernor.reservedOthers() as number), { timeout: 15_000 }).toBe(0)
    expect(await ask(b, Q)).toMatchObject({ ok: true })
    await b.close()
  })
})
