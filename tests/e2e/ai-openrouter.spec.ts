/**
 * OpenRouter beside Claude, stage A (multi-provider S2): the request paths reach OpenRouter only through the `?e2e` seam
 * `window.__oneAI.forceRoute(route, pool?)` (no UI path does yet). Every openrouter.ai exchange is mocked from the
 * documented formats (helpers/providers.ts mockOpenRouter) — nothing reaches a real host. The catalogue is the trimmed
 * public fixture; people and pages are fictional.
 */
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, openApp, reloadApp, wsEval } from './fixtures'
import { hostCounts, mockClaudeScript, mockOpenRouter, seedEndpoints, text, type ORMock, type ORStepFn } from './helpers/providers'
import { SUMMARY, TRANSFORM_STEPS, aiPanel, autofillPriority, imageAction, improve, ledger, noSpeech, summarisePdf, summarizeMeeting, transformAuto } from './helpers/aiFlows'
import { capsOfRow, readCatalogRow } from '../../src/shared/ai/catalog'
import type { Route, ShortlistRow } from '../../src/shared/ai/types'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const OR_KEY = 'sk-or-v1-e2e-openrouter-key-0000000000000000000000000000000000000000'
const CATALOGUE = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/openrouter-models.json', import.meta.url)), 'utf8')) as { data: unknown[] }
const row = (id: string): ShortlistRow => {
  const r = readCatalogRow(CATALOGUE.data.find((x) => (x as { id: string }).id === id), '2026-10-12')!
  return { m: r.id, label: r.label, price: r.price, caps: capsOfRow(r), at: '2026-10-12' }
}
const LUNA = 'openai/gpt-6-luna'
const POOL = [LUNA, 'deepseek/deepseek-v4-flash', 'z-ai/glm-5.3']
const SHORTLIST = POOL.map(row)
const JEV = 'typesafe/jev-router'
const MODEL: Route = { p: 'openrouter', m: LUNA }
const ROUTER: Route = { p: 'openrouter', m: JEV, effort: 'medium' }
const ENDPOINTS = { [LUNA]: [{ tag: 'nordwind', name: 'Nordwind' }, { tag: 'lindenhof/turbo', name: 'Lindenhof' }], 'deepseek/deepseek-v4-flash': [{ tag: 'nordwind', name: 'Nordwind' }], 'z-ai/glm-5.3': [{ tag: 'birkenau', name: 'Birkenau' }], [JEV]: [{ tag: 'typesafe', name: 'TypeSafe' }] }

const seam = (page: Page) => page.evaluate(() => (window as unknown as { __oneAI: AnyState }).__oneAI)
const force = (page: Page, route: Route | null, pool?: string[]) => page.evaluate(([r, p]) => (window as unknown as { __oneAI: { forceRoute(r: unknown, p?: unknown): unknown } }).__oneAI.forceRoute(r, p), [route, pool] as const)
const loadCatalog = (page: Page, forceIt = false) => page.evaluate((f) => (window as unknown as { __oneAI: { loadCatalog(f: boolean): Promise<AnyState | null> } }).__oneAI.loadCatalog(f), forceIt)

/** The app with a Claude key (the UI's AI menus need one in stage A), an OpenRouter key, the shortlist and the endpoints. */
async function setup(page: Page, chat: ORStepFn[], o: { route?: Route; pool?: string[]; seed?: boolean; fallback?: ORStepFn; endpoints?: Record<string, Array<{ tag: string; name?: string }>> } = {}): Promise<{ or: ORMock; claude: { requests: unknown[] }; counts: ReturnType<typeof hostCounts> }> {
  const or = await mockOpenRouter(page.context(), { chat, endpoints: o.endpoints, ...(o.fallback ? { fallback: o.fallback } : {}) })
  const claude = await mockClaudeScript(page.context(), [])
  const counts = hostCounts(page)
  await openApp(page)
  // stage B: OpenRouter may receive everything here (the workspace's shared classes, this device's member classes) — the
  // data rules themselves are proven in ai-policy.spec; these cases are about the wire
  await wsEval(page, (s, a) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', aiKeys: { openrouter: a.key }, ai: { models: a.rows, allow: { openrouter: ['private', 'mail', 'memory', 'mcp'] } } }), { key: OR_KEY, rows: SHORTLIST })
  await wsEval(page, (s) => s.setWorkspaceAI({ policy: { providers: { openrouter: { allow: ['public', 'structure', 'selection', 'page', 'rows', 'files', 'workspace', 'people', 'transcript'] } }, restricted: [] } }))
  if (o.seed !== false) await seedEndpoints(page, ENDPOINTS)
  await force(page, o.route ?? MODEL, o.pool)
  return { or, claude, counts }
}

const receipt = (page: Page) => aiPanel(page).getByTestId('ai-receipt')

test.describe('the catalogue on this device', () => {
  test('read on demand only: nothing at boot; once through the seam; kept across a reload; again when a day passed or forced', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-12T09:00:00+02:00') })
    const or = await mockOpenRouter(page.context())
    await openApp(page)
    expect(await seam(page)).toBeTruthy()
    // boot: no catalogue, no IndexedDB of it
    expect(or.to('/api/v1/models')).toHaveLength(0)
    expect(await page.evaluate(async () => (await indexedDB.databases()).some((d) => d.name === 'one-ai-catalog'))).toBe(false)
    // positive control: the seam reads it once
    const first = await loadCatalog(page)
    expect(first!.rows).toBe(31)
    expect(first!.ids).toContain(JEV)
    expect(or.to('/api/v1/models')).toHaveLength(1)
    expect((await loadCatalog(page))!.rows).toBe(31)
    expect(or.to('/api/v1/models')).toHaveLength(1)
    // a reload reads the device's copy
    await reloadApp(page)
    expect((await loadCatalog(page))!.rows).toBe(31)
    expect(or.to('/api/v1/models')).toHaveLength(1)
    // a day later: read again; forced: read again
    await page.clock.fastForward('25:00:00')
    await loadCatalog(page)
    expect(or.to('/api/v1/models')).toHaveLength(2)
    await loadCatalog(page, true)
    expect(or.to('/api/v1/models')).toHaveLength(3)
    // no key ever goes with it
    for (const r of or.to('/api/v1/models')) expect(r.bearer).toBe('')
  })

  test('endpoint lists are read only for the model a request goes to (seeded lists: none at all)', async ({ page }) => {
    const { or } = await setup(page, [{ text: 'A tighter launch sentence.' }, { text: 'A tighter launch sentence.' }], { seed: false })
    await improve(page)
    expect(or.to(/\/endpoints$/).map((r) => r.path)).toEqual([`/api/v1/models/${LUNA}/endpoints`])
    expect(or.to('/api/v1/models')).toHaveLength(0)
    await force(page, MODEL)
    await improve(page, 'A tighter launch sentence.')
    // kept for a day: not read again
    expect(or.to(/\/endpoints$/)).toHaveLength(1)
  })
})

test.describe('one-shots on an OpenRouter model', () => {
  test('Improve: one body with the pins, fallbacks off, no collection, required parameters, the switch-offs; one reported entry; the receipt names OpenRouter; Claude never asked', async ({ page }) => {
    const { or, claude, counts } = await setup(page, [{ text: 'A tighter launch sentence.', cost: 0.00042 }])
    await improve(page)
    expect(or.posts()).toHaveLength(1)
    const [post] = or.posts()
    expect(post.bearer).toBe(OR_KEY)
    expect(post.headers['x-openrouter-title']).toBe('One')
    expect(post.headers['x-openrouter-app-visibility']).toBe('hidden')
    expect(post.headers['http-referer']).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/SimpleCMS\/app\/$/)
    expect(post.headers['x-openrouter-metadata']).toBeUndefined()
    const b = post.body!
    expect(b.model).toBe(LUNA)
    expect(b.stream).toBe(true)
    expect(b.provider).toEqual({ only: ['nordwind', 'lindenhof/turbo'], allow_fallbacks: false, data_collection: 'deny', require_parameters: true })
    expect(b.plugins).toEqual([{ id: 'web', enabled: false }, { id: 'context-compression', enabled: false }, { id: 'response-healing', enabled: false }])
    for (const k of ['user', 'session_id', 'metadata', 'models', 'fallbacks', 'mcp_servers', 'web_search_options', 'transforms', 'tools']) expect(k in b, k).toBe(false)
    expect(JSON.stringify(b)).toContain('our launch sentence is kinda loose')
    // the ledger: one entry, reported, the upstream that served it
    await expect.poll(async () => (await ledger(page)).length).toBe(1)
    const [e] = await ledger(page)
    expect(e).toMatchObject({ route: `openrouter:${LUNA}`, served: { p: 'openrouter', model: LUNA, upstream: 'Nordwind' }, costSource: 'reported', usd: 0.00042, outcome: 'ok', purpose: 'menu.action' })
    // the receipt
    await expect(receipt(page).locator('.ai-receipt__model')).toHaveText('OpenRouter · GPT-6 Luna')
    await expect(receipt(page)).toHaveAttribute('data-src', 'reported')
    await expect(receipt(page)).toContainText('Reported')
    expect(await receipt(page).getAttribute('title')).toContain('Served by Nordwind')
    expect(claude.requests).toHaveLength(0)
    expect(counts.anthropic).toBe(0)
  })

  test('Transform (two structured requests): response_format with a strict schema, one reported entry each', async ({ page }) => {
    const answers = TRANSFORM_STEPS.map((s) => ({ text: s.blocks[0]!.text, cost: 0.0002 }))
    const { or } = await setup(page, answers)
    await transformAuto(page)
    await expect.poll(() => or.posts().length).toBe(2)
    for (const p of or.posts()) {
      expect(p.body!.response_format.type).toBe('json_schema')
      expect(p.body!.response_format.json_schema).toMatchObject({ name: 'answer', strict: true })
    }
    await expect.poll(async () => (await ledger(page)).length).toBe(2)
    expect((await ledger(page)).every((x) => x.costSource === 'reported' && x.purpose === 'structure.transform')).toBe(true)
  })

  test('a meeting summary, an image description and a native-PDF summary: one chat POST and one reported entry each', async ({ page }) => {
    await noSpeech(page)
    const { or } = await setup(page, [{ text: JSON.stringify(SUMMARY) }, { text: JSON.stringify({ alt: 'A striped test pattern.', caption: 'Test pattern P1' }) }, { text: 'Invoice **2025-117** from Acme GmbH.' }])
    await summarizeMeeting(page)
    await expect.poll(() => or.posts().length).toBe(1)
    await imageAction(page, /Describe the image/)
    await expect(aiPanel(page).getByRole('textbox', { name: 'Alt text' })).toHaveValue('A striped test pattern.')
    expect(or.posts()).toHaveLength(2)
    const img = or.posts()[1]!.body!
    expect(JSON.stringify(img.messages)).toMatch(/"type":"image_url","image_url":\{"url":"data:image\/png;base64,/)
    await page.keyboard.press('Escape')
    await summarisePdf(page)
    await expect(aiPanel(page)).toContainText('from Acme GmbH')
    expect(or.posts()).toHaveLength(3)
    const pdf = or.posts()[2]!.body!
    expect(JSON.stringify(pdf.messages)).toMatch(/"type":"file","file":\{"filename":"invoice-2025-117\.pdf","file_data":"data:application\/pdf;base64,/)
    expect(pdf.plugins.at(-1)).toEqual({ id: 'file-parser', pdf: { engine: 'native' } })
    await expect.poll(async () => (await ledger(page)).length).toBe(3)
    const entries = await ledger(page)
    expect(entries.map((x) => x.purpose)).toEqual(['meeting.summary', 'vision.image', 'documents.file'])
    expect(entries.every((x) => x.costSource === 'reported' && x.served.upstream === 'Nordwind')).toBe(true)
  })

  test('autofill: one POST per row, one reported entry each', async ({ page }) => {
    const { or } = await setup(page, [], { fallback: { text: JSON.stringify({ value: 'Low' }), cost: 0.0001 } })
    await autofillPriority(page)
    await expect.poll(async () => (await ledger(page)).length).toBeGreaterThan(0)
    await page.waitForTimeout(300)
    const entries = await ledger(page)
    expect(or.posts()).toHaveLength(entries.length)
    expect(entries.every((x) => x.purpose === 'bulk.autofill' && x.costSource === 'reported')).toBe(true)
  })

  test('a request stopped before its answer: one estimate entry (never $0)', async ({ page, errors }) => {
    errors.allow(/Failed to load resource/)
    const { or } = await setup(page, [{ delay: 4000, then: { text: 'Too late.' } }])
    await improve(page, null)
    await expect.poll(() => or.posts().length).toBe(1)
    await aiPanel(page).locator('.ai-stop').click()
    await expect.poll(async () => (await ledger(page)).length).toBe(1)
    const [e] = await ledger(page)
    expect(e).toMatchObject({ costSource: 'estimate', outcome: 'aborted' })
    expect(e.usd).toBeGreaterThan(0)
  })

  test('a model that cannot see pictures: refused before the picture is loaded (capability), nothing sent', async ({ page }) => {
    const { or } = await setup(page, [], { route: { p: 'openrouter', m: 'deepseek/deepseek-v4-flash' } })
    await imageAction(page, /Describe the image/)
    await expect(aiPanel(page)).toContainText(/can't|cannot|not able/i)
    expect(or.posts()).toHaveLength(0)
  })
})

test.describe('the Jev Router (a pool over the shortlist)', () => {
  test('Improve: the router body, "Jev Router → <model>" on the receipt, the router route in the ledger with the served model, routed, reported; the reservation is the bound', async ({ page }) => {
    const { or } = await setup(page, [{ delay: 800, then: { text: 'A tighter launch sentence.', model: LUNA, cost: 0.00021 } }], { route: ROUTER, pool: POOL })
    await improve(page, null)
    await expect.poll(() => or.posts().length).toBe(1)
    // while it runs: the reservation is the bound band (the most expensive pool row), never 0
    const reserved = await page.evaluate(() => (window as unknown as { __oneLedger: { reserved(): { usd: number; open: number } } }).__oneLedger.reserved())
    expect(reserved.open).toBe(1)
    expect(reserved.usd).toBeGreaterThan(0)
    await expect(aiPanel(page)).toContainText('A tighter launch sentence.')
    const b = or.posts()[0]!.body!
    expect(b.model).toBe(JEV)
    expect(b.plugins[0]).toMatchObject({ id: 'jev-router', cost_tier: 'medium', models: POOL })
    expect(b.plugins[0].excluded_models).toEqual(expect.arrayContaining(['anthropic/*', 'openai/gpt-6.1-sol', 'openrouter/*', '*:free']))
    expect(b.provider).toEqual({ only: expect.arrayContaining(['nordwind', 'lindenhof/turbo', 'birkenau', 'typesafe']), allow_fallbacks: false, data_collection: 'deny', require_parameters: true })
    expect('reasoning' in b).toBe(false)
    await expect.poll(async () => (await ledger(page)).length).toBe(1)
    const [e] = await ledger(page)
    expect(e).toMatchObject({ route: `openrouter:${JEV}`, served: { p: 'openrouter', model: LUNA, upstream: 'Nordwind' }, costSource: 'reported', usd: 0.00021 })
    expect(e.steps).toEqual([{ k: 'routed', from: JEV, to: LUNA }])
    await expect(receipt(page).locator('.ai-receipt__model')).toHaveText('OpenRouter · Jev Router → GPT-6 Luna')
    await expect(receipt(page)).toContainText('Reported')
  })

  test('no reported cost: priced at the served model (catalogue, never 0); stopped before it said who serves: the bound (estimate)', async ({ page, errors }) => {
    errors.allow(/Failed to load resource/)
    const { or } = await setup(page, [{ text: 'A tighter launch sentence.', model: 'z-ai/glm-5.3', cost: null, usage: { prompt: 1000, completion: 100 } }, { delay: 4000, then: { text: 'Too late.' } }], { route: ROUTER, pool: POOL })
    await improve(page)
    await expect.poll(async () => (await ledger(page)).length).toBe(1)
    const [cat] = await ledger(page)
    expect(cat.costSource).toBe('catalogue')
    // glm-5.3: $0.07 in, $4.80 out per million
    expect(cat.usd).toBeCloseTo((1000 * 0.07 + 100 * 4.8) / 1e6, 10)
    expect(await receipt(page).getAttribute('title')).toContain('Priced at GLM 5.3')
    await page.keyboard.press('Escape')
    await force(page, ROUTER, POOL)
    await improve(page, null)
    await expect.poll(() => or.posts().length).toBe(2)
    await aiPanel(page).locator('.ai-stop').click()
    await expect.poll(async () => (await ledger(page)).length).toBe(2)
    const cut = (await ledger(page))[1]
    expect(cut).toMatchObject({ costSource: 'estimate', outcome: 'aborted', route: `openrouter:${JEV}` })
    expect(cut.usd).toBeGreaterThan(0)
  })

  test('an answer from a model outside the pool: refused (policy), nothing to apply, one entry with the upstream step', async ({ page }) => {
    const { or } = await setup(page, [{ text: 'A tighter launch sentence.', model: 'openai/gpt-6-astra' }], { route: ROUTER, pool: POOL })
    await improve(page, null)
    await expect(aiPanel(page).locator('.ai-error, [role="alert"]').first()).toBeVisible()
    await expect(aiPanel(page)).not.toContainText('A tighter launch sentence.')
    expect(or.posts()).toHaveLength(1)
    await expect.poll(async () => (await ledger(page)).length).toBe(1)
    const [e] = await ledger(page)
    expect(e.outcome).toBe('policy')
    expect(e.steps).toEqual(expect.arrayContaining([{ k: 'upstream', code: 'model:openai/gpt-6-astra', to: 'openai/gpt-6-astra' }]))
  })

  test('a router 404: no endpoint (never a gone model), exactly one POST', async ({ page, errors }) => {
    errors.allow(/Failed to load resource/)
    const { or } = await setup(page, [{ status: 404, json: { error: { code: 404, message: 'No eligible model remains after applying model preferences.' } } }], { route: ROUTER, pool: POOL })
    await improve(page, null)
    await expect(aiPanel(page).locator('.ai-error, [role="alert"]').first()).toBeVisible()
    await page.waitForTimeout(500)
    expect(or.posts()).toHaveLength(1)
    await expect.poll(async () => (await ledger(page)).length).toBe(1)
    expect((await ledger(page))[0]).toMatchObject({ outcome: 'no_endpoint', usd: 0 })
  })

  test('a stale catalogue is read again once before a router request (fresh exclusions)', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-12T09:00:00+02:00') })
    const { or } = await setup(page, [{ text: 'A tighter launch sentence.' }], { route: ROUTER, pool: POOL })
    await loadCatalog(page)
    expect(or.to('/api/v1/models')).toHaveLength(1)
    await page.clock.fastForward('25:00:00')
    await improve(page)
    expect(or.to('/api/v1/models')).toHaveLength(2)
    expect(or.posts()).toHaveLength(1)
  })
})

test.describe('the flight recorder names the route (acceptance 2, recorder part)', () => {
  /** Improve → Replace selection, then the recorder's run of it (`ai:<run>`). */
  async function acceptAndRun(page: Page): Promise<AnyState> {
    await improve(page)
    await aiPanel(page).getByRole('option', { name: /Replace selection/ }).click()
    await expect(aiPanel(page)).toHaveCount(0)
    const rec = () => page.evaluate(async () => {
      const r = (window as unknown as { __oneRecorder: { flush(): Promise<void>; runs(): Promise<AnyState[]> } }).__oneRecorder
      await r.flush()
      return (await r.runs()).filter((x) => String(x.key).startsWith('ai:'))
    })
    await expect.poll(async () => (await rec()).find((x) => x.meta?.ai)?.meta ?? null).not.toBeNull()
    return (await rec()).find((x) => x.meta?.ai)!
  }
  async function viaOnDeck(page: Page): Promise<string> {
    await page.keyboard.press('Control+Alt+z')
    await page.locator('.lane[data-lane="ai"] .flag').first().click()
    return (await page.getByTestId('rec-via').textContent()) ?? ''
  }

  test('OpenRouter: the run meta holds the served route; the window plate says "via OpenRouter · GPT-6 Luna"', async ({ page }) => {
    await setup(page, [{ text: 'A tighter launch sentence.' }])
    const run = await acceptAndRun(page)
    expect(run.meta).toMatchObject({ ai: `openrouter:${LUNA}` })
    expect(run.meta.aiAlso).toBeUndefined()
    expect(await viaOnDeck(page)).toBe('via OpenRouter · GPT-6 Luna')
  })

  test('the Jev Router: ai = the model it chose, aiAlso = the router; "via OpenRouter · Jev Router → GPT-6 Luna"', async ({ page }) => {
    await setup(page, [{ text: 'A tighter launch sentence.' }], { route: ROUTER, pool: POOL })
    const run = await acceptAndRun(page)
    expect(run.meta).toMatchObject({ ai: `openrouter:${LUNA}`, aiAlso: [`openrouter:${JEV}`] })
    expect(await viaOnDeck(page)).toBe('via OpenRouter · Jev Router → GPT-6 Luna')
  })

  test('Claude: "via Claude Opus 5.5"', async ({ page }) => {
    await setup(page, [])
    await force(page, null)
    // the newer route answers Claude's request (Playwright takes the last registered handler first)
    await mockClaudeScript(page.context(), [text('A tighter launch sentence.')])
    const run = await acceptAndRun(page)
    expect(run.meta.ai).toMatch(/^anthropic:claude-opus-5-5/)
    expect(await viaOnDeck(page)).toBe('via Claude Opus 5.5')
  })
})
