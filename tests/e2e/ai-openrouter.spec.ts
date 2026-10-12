/**
 * OpenRouter beside Claude, stage A (multi-provider S2): the request paths reach OpenRouter only through the `?e2e` seam
 * `window.__oneAI.forceRoute(route, pool?)` (no UI path does yet). Every openrouter.ai exchange is mocked from the
 * documented formats (helpers/providers.ts mockOpenRouter) — nothing reaches a real host. The catalogue is the trimmed
 * public fixture; people and pages are fictional.
 */
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, openApp, reloadApp, wsEval, flush, gotoPage, editorOf } from './fixtures'
import { hostCounts, jevAnswer, mockClaudeScript, mockOpenRouter, seedEndpoints, text, type DecideStepFn, type ORMock, type ORStepFn } from './helpers/providers'
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

  test('Claude for files on an anthropic/* model: the text document is a cache breakpoint; on another model it is not (review #12)', async ({ page }) => {
    const SONNET = 'anthropic/claude-sonnet-5.5'
    const { or } = await setup(page, [{ text: 'The notes list three launch steps.', model: SONNET, provider: 'Anthropic' }, { text: 'The notes list three launch steps.' }], { route: { p: 'openrouter', m: SONNET } })
    await wsEval(page, (s, r) => s.updateSettings({ ai: { ...s.settings.ai, models: [...s.settings.ai.models, r] } }), row(SONNET))
    await seedEndpoints(page, { ...ENDPOINTS, [SONNET]: [{ tag: 'anthropic', name: 'Anthropic' }] })
    /** a page with a Markdown file → Summarise */
    const summarise = async (title: string) => {
      const id = await page.evaluate(async (t) => {
        const one = (window as unknown as { __one: AnyState }).__one
        const blob = new Blob(['# Launch notes\n\n1. Freeze\n2. Review\n3. Ship\n'], { type: 'text/markdown' })
        const src = await one.files.saveFile(blob, 'launch-notes.md')
        const s = one.workspace.getState()
        const id = s.createPage({ title: t, parentId: null })
        s.setContent(id, { type: 'doc', content: [{ type: 'fileBlock', attrs: { src, name: 'launch-notes.md', size: blob.size, display: 'file' } }] }, 'e2e')
        return id
      }, title)
      await flush(page)
      await gotoPage(page, id)
      const card = editorOf(page, id).locator('.file-view', { hasText: 'launch-notes.md' }).first()
      await card.hover()
      await card.getByTestId('file-ai-key').click()
      await page.getByRole('menuitem', { name: /^Summarise/ }).click()
      await expect(aiPanel(page)).toContainText('three launch steps')
    }
    await summarise('Launch file')
    expect(or.posts()).toHaveLength(1)
    const marked = JSON.stringify(or.posts()[0]!.body!.messages)
    expect(marked).toMatch(/<document title=\\"launch-notes\.md\\">[^"]*","cache_control":\{"type":"ephemeral"\}/)
    await page.keyboard.press('Escape')
    // positive control: the same request on a model that is not Anthropic's carries no breakpoint
    await force(page, MODEL)
    await summarise('Launch file 2')
    expect(or.posts()).toHaveLength(2)
    expect(JSON.stringify(or.posts()[1]!.body!.messages)).not.toContain('cache_control')
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

  test('a dated revision of a pool model without a reported cost: priced at that model\'s row (catalogue), labelled by it (review #13)', async ({ page }) => {
    const { or } = await setup(page, [{ text: 'A tighter launch sentence.', model: 'z-ai/glm-5.3-20260917', provider: 'Birkenau', cost: null, usage: { prompt: 1000, completion: 100 } }], { route: ROUTER, pool: POOL })
    await improve(page)
    expect(or.posts()).toHaveLength(1)
    await expect.poll(async () => (await ledger(page)).length).toBe(1)
    const [e] = await ledger(page)
    expect(e.costSource).toBe('catalogue')
    expect(e.usd).toBeCloseTo((1000 * 0.07 + 100 * 4.8) / 1e6, 10)
    await expect(receipt(page).locator('.ai-receipt__model')).toHaveText('OpenRouter · Jev Router → GLM 5.3')
    await expect(receipt(page)).not.toContainText('≈')
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
    // nothing was billed: an exact zero, never an estimate (review #10)
    expect((await ledger(page))[0]).toMatchObject({ outcome: 'no_endpoint', usd: 0, costSource: 'reported' })
  })

  test('a router attempt refused with 429, then answered: the zero is exact — the receipt is "reported", no "≈" (review #10)', async ({ page, errors }) => {
    errors.allow(/Failed to load resource|429/)
    const { or } = await setup(page, [{ status: 429, json: { error: { code: 429, message: 'Rate limited' } }, headers: { 'retry-after': '0' } }, { text: 'A tighter launch sentence.', model: LUNA, cost: 0.0004 }], { route: ROUTER, pool: POOL })
    await improve(page)
    expect(or.posts()).toHaveLength(2)
    await expect.poll(async () => (await ledger(page)).length).toBe(2)
    const [refused, ok] = await ledger(page)
    expect(refused).toMatchObject({ usd: 0, costSource: 'reported' })
    expect(ok).toMatchObject({ outcome: 'ok', usd: 0.0004, costSource: 'reported' })
    await expect(receipt(page).locator('.ai-receipt__model')).toHaveText('OpenRouter · Jev Router → GPT-6 Luna')
    await expect(receipt(page)).toContainText('Reported')
    await expect(receipt(page)).not.toContainText('≈')
  })

  test('a model 404 "No endpoints found": the pins are read again once, exactly two POSTs, then the fix keys — operator rules and another model (review #11)', async ({ page, errors }) => {
    errors.allow(/Failed to load resource|404/)
    const none = { status: 404, json: { error: { code: 404, message: 'No endpoints found that support the requested parameters.' } } }
    const { or } = await setup(page, [none, none])
    await improve(page, null)
    const err = aiPanel(page).locator('.ai-error')
    await expect(err).toContainText('ERR · NO_ENDPOINT')
    expect(or.posts()).toHaveLength(2)
    expect(or.to(/\/endpoints$/)).toHaveLength(1)
    const keys = err.getByTestId('ai-fix')
    await expect(keys).toHaveCount(2)
    await expect(keys.nth(0)).toHaveAttribute('data-fix', 'data')
    await expect(keys.nth(1)).toHaveAttribute('data-fix', 'models')
    await keys.nth(1).click()
    await expect(page.getByTestId('ai-setup')).toHaveAttribute('data-step', 'models')
  })

  test('a model OpenRouter no longer lists (404): MODEL_GONE with the models key (review #11)', async ({ page, errors }) => {
    errors.allow(/Failed to load resource|404/)
    const { or } = await setup(page, [{ status: 404, json: { error: { code: 404, message: 'Model openai/gpt-6-luna is not a valid model ID' } } }])
    await improve(page, null)
    const err = aiPanel(page).locator('.ai-error')
    await expect(err).toContainText('ERR · MODEL_GONE')
    expect(or.posts()).toHaveLength(1)
    await expect(err.getByTestId('ai-fix')).toHaveCount(1)
    await expect(err.getByTestId('ai-fix')).toHaveAttribute('data-fix', 'models')
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

/* ------------------------------------------------------------------ */
/* Decisions (slice SJ, J5): the core path through the `?e2e` seam      */
/* ------------------------------------------------------------------ */

const JEV13 = 'typesafe/jev-1.13'
const SNAP = 'typesafe/jev-1.13-20260917'
/** a fictional proposal's state and QSET-shaped questions (the real question set comes with J6) */
const STATE = { change: { kind: 'update_row', target: { kind: 'row', title: 'Launch plan', database: 'Projects' }, fields: [{ name: 'Status', before: 'Open', after: 'Done' }] }, agent: { instructions: 'Mark the Nordlicht launch done when its tasks are closed.', write_mode: 'staged' } }
const QS = Object.fromEntries(['asked', 'target', 'consistent', 'clean'].map((k) => [k, { type: 'noul', instructions: `Check ${k} of \`change\`.` }]))
const ALL_SHARED = ['public', 'structure', 'selection', 'page', 'rows', 'files', 'workspace', 'people', 'transcript']

async function decideSetup(page: Page, decisions: DecideStepFn[], o: { gate?: boolean; catalogue?: number; allow?: string[]; clock?: boolean } = {}): Promise<{ or: ORMock; claude: { requests: unknown[] } }> {
  if (o.clock) await page.clock.install({ time: new Date('2026-10-12T09:00:00+02:00') })
  const or = await mockOpenRouter(page.context(), { decisions, ...(o.catalogue ? { decisionsCatalogue: o.catalogue } : {}) })
  const claude = await mockClaudeScript(page.context(), [])
  await openApp(page)
  await wsEval(page, (s, a) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', aiKeys: { openrouter: a.key }, ai: { ...(a.gate ? { routes: { gate: [{ p: 'openrouter', m: a.jev }] } } : {}), allow: { openrouter: ['private', 'mail', 'memory', 'mcp'] } } }), { key: OR_KEY, gate: o.gate !== false, jev: JEV13 })
  await wsEval(page, (s, allow) => s.setWorkspaceAI({ policy: { providers: { openrouter: { allow } }, restricted: [] } }), o.allow ?? ALL_SHARED)
  await seedEndpoints(page, { [JEV13]: [{ tag: 'typesafe', name: 'TypeSafe' }] })
  return { or, claude }
}

const decideVia = (page: Page, input: AnyState = {}): Promise<AnyState> =>
  page.evaluate((i) => (window as unknown as { __oneAI: { decide(x: unknown): Promise<AnyState> } }).__oneAI.decide(i), { sources: [{ all: true }], carries: ['rows'], state: STATE, questions: QS, source: 'agent:ag_1:run_1', group: 'run_1', on: SNAP, ...input })
const decideEntries = async (page: Page) => (await ledger(page)).filter((e) => e.role === 'decide')
const resetCooldown = (page: Page) => page.evaluate(() => (window as unknown as { __oneAI: { resetDecideCooldown(): Promise<void> } }).__oneAI.resetDecideCooldown())

test.describe('decisions: the core path (Jev as Vorprüfer)', () => {
  test('one decision: the body, one decide entry (reported, the run as its group), the dated snapshot; the price read once and kept at any age', async ({ page }) => {
    const { or, claude } = await decideSetup(page, [jevAnswer({ consistent: 0.41 }, { cost: 0.000042 }), jevAnswer({}, { cost: 0.00004 }), jevAnswer({}, { cost: 0.00004 })], { clock: true })
    const r = await decideVia(page)
    expect(r).toMatchObject({ ok: true, served: { model: SNAP, upstream: 'TypeSafe' }, route: { p: 'openrouter', m: JEV13 }, level: 'device' })
    // the price was known before the request prepared: its reservation is the band, never 0
    expect(r.reserved).toBeGreaterThan(0)
    expect(r.answers.consistent).toEqual({ type: 'noul', p: 0.41 })
    expect(or.decisions()).toHaveLength(1)
    const [post] = or.decisions()
    expect(post.bearer).toBe(OR_KEY)
    expect(post.body).toEqual({ model: JEV13, state: STATE, questions: QS, provider: { only: ['typesafe'], allow_fallbacks: false, data_collection: 'deny' } })
    expect(post.headers['x-openrouter-title']).toBe('One')
    // no price known on this device: the decisions catalogue was read once (public, no key)
    expect(or.to('/api/v1/models', 'GET')).toHaveLength(1)
    expect(or.to('/api/v1/models', 'GET')[0]!.url).toContain('output_modalities=decisions')
    expect(or.to('/api/v1/models', 'GET')[0]!.bearer).toBe('')
    await expect.poll(async () => (await decideEntries(page)).length).toBe(1)
    const [e] = await decideEntries(page)
    expect(e).toMatchObject({ role: 'decide', cls: 'gate', purpose: 'gate.precheck', source: 'agent:ag_1:run_1', group: 'run_1', route: `openrouter:${JEV13}`, served: { p: 'openrouter', model: SNAP, upstream: 'TypeSafe' }, costSource: 'reported', usd: 0.000042, outcome: 'ok' })
    expect(e.usage.output).toBe(3)
    expect(e.classes).toEqual(expect.arrayContaining(['public', 'rows']))
    // three days later, after a reload: the kept row prices the next decision — no GET
    await page.clock.fastForward(72 * 3_600_000)
    await reloadApp(page)
    expect((await decideVia(page)).ok).toBe(true)
    expect(or.to('/api/v1/models', 'GET')).toHaveLength(1)
    // Claude is never asked for a decision
    expect(claude.requests).toHaveLength(0)
  })

  test('no reported cost: priced from the catalogue row — input only, the reported output tokens free', async ({ page }) => {
    await decideSetup(page, [jevAnswer({}, { cost: null, input: 1000, output: 70 })])
    expect((await decideVia(page)).ok).toBe(true)
    await expect.poll(async () => (await decideEntries(page)).length).toBe(1)
    const [e] = await decideEntries(page)
    expect(e).toMatchObject({ costSource: 'catalogue', usage: { input: 1000, output: 70 } })
    expect(Math.abs(e.usd - 1000 * 0.042e-6)).toBeLessThan(1e-12)
  })

  test('timed out after it went out: one estimate entry (never $0); refused with a status: zero; never sent: none', async ({ page, errors }) => {
    errors.allow(/Failed to load resource/)
    const { or } = await decideSetup(page, [{ hang: true }, { error: '503' }])
    const t = await decideVia(page, { timeoutMs: 600 })
    expect(t).toMatchObject({ ok: false, code: 'timeout', why: 'timeout' })
    const u = await decideVia(page)
    expect(u).toMatchObject({ ok: false, code: 'unavailable', why: 'unavailable' })
    expect(or.decisions()).toHaveLength(2)
    await expect.poll(async () => (await decideEntries(page)).length).toBe(2)
    const [a, b] = await decideEntries(page)
    expect(a).toMatchObject({ costSource: 'estimate', outcome: 'timeout' })
    expect(a.usd).toBeGreaterThan(0)
    expect(b).toMatchObject({ outcome: 'unavailable', usd: 0 })
    or.releaseDecisions()
    // never sent: no OpenRouter key → no request, no entry
    await wsEval(page, (s) => s.updateSettings({ aiKeys: { openrouter: '' } }))
    expect(await decideVia(page)).toMatchObject({ ok: false, why: 'nokey' })
    expect(or.decisions()).toHaveLength(2)
    expect(await decideEntries(page)).toHaveLength(2)
  })

  test("another snapshot served than the one confirmed → 'changed' (metered, not used); a confirmed other version → nothing sent", async ({ page }) => {
    const { or } = await decideSetup(page, [jevAnswer({}, { model: 'typesafe/jev-1.13-20261101' }), jevAnswer({})])
    expect(await decideVia(page)).toMatchObject({ ok: false, why: 'changed', code: 'policy' })
    await expect.poll(async () => (await decideEntries(page)).length).toBe(1)
    const [e] = await decideEntries(page)
    expect(e).toMatchObject({ outcome: 'policy', served: { model: 'typesafe/jev-1.13-20261101' }, steps: [{ k: 'substituted', from: SNAP, to: 'typesafe/jev-1.13-20261101' }] })
    // confirmed Jev 1.12: the rules resolve 1.13 → refused before sending
    expect(await decideVia(page, { on: 'typesafe/jev-1.12-20260801' })).toMatchObject({ ok: false, why: 'changed' })
    expect(or.decisions()).toHaveLength(1)
    // positive control: the confirmed snapshot answers
    expect(await decideVia(page)).toMatchObject({ ok: true })
  })

  test("an operator outside the pins → 'upstream' (metered, not used)", async ({ page }) => {
    await decideSetup(page, [jevAnswer({}, { provider: 'Nordwind' })])
    expect(await decideVia(page)).toMatchObject({ ok: false, why: 'upstream', code: 'policy' })
    await expect.poll(async () => (await decideEntries(page)).length).toBe(1)
    expect((await decideEntries(page))[0]).toMatchObject({ outcome: 'policy', served: { upstream: 'Nordwind' }, steps: [{ k: 'upstream', code: 'upstream:Nordwind' }] })
  })

  test('cooldown: three service failures in a row (incl. a malformed answer) → 10 minutes of refusals, nothing sent; a success resets the count', async ({ page, errors }) => {
    errors.allow(/Failed to load resource/)
    const { or } = await decideSetup(page, [{ malformed: 'noul' }, { malformed: 'missing' }, jevAnswer({}), { error: '529' }, { malformed: 'choice' }, { error: '524' }, jevAnswer({})])
    expect(await decideVia(page)).toMatchObject({ why: 'empty' })
    expect(await decideVia(page)).toMatchObject({ why: 'empty' })
    // a success between: the count starts again
    expect(await decideVia(page)).toMatchObject({ ok: true })
    expect(await decideVia(page)).toMatchObject({ why: 'unavailable', code: 'overloaded' })
    expect(await decideVia(page)).toMatchObject({ why: 'empty' })
    expect(await decideVia(page)).toMatchObject({ why: 'timeout', code: 'timeout' })
    expect(or.decisions()).toHaveLength(6)
    // the fourth asks nothing
    expect(await decideVia(page)).toMatchObject({ ok: false, why: 'cooldown' })
    expect(or.decisions()).toHaveLength(6)
    const cool = await page.evaluate(() => (window as unknown as { __oneAI: { decideCooldown(): Promise<AnyState> } }).__oneAI.decideCooldown())
    expect(cool.until).toBeGreaterThan(Date.now() + 9 * 60_000)
    // the malformed answers went out: metered from their reported usage
    const entries = await decideEntries(page)
    expect(entries.filter((x) => x.outcome === 'empty').every((x) => x.costSource === 'reported' && x.usd > 0)).toBe(true)
    await resetCooldown(page)
    expect(await decideVia(page)).toMatchObject({ ok: true })
  })

  test('busy or a rate limit: one more attempt after its Retry-After (≤ 3 s), then unchecked', async ({ page, errors }) => {
    errors.allow(/Failed to load resource/)
    const { or } = await decideSetup(page, [{ error: '402 in-flight budget' }, jevAnswer({}), { error: '429' }, { error: '429' }])
    expect(await decideVia(page)).toMatchObject({ ok: true })
    expect(or.decisions()).toHaveLength(2)
    expect(await decideVia(page)).toMatchObject({ ok: false, why: 'unavailable', code: 'rate_limit' })
    expect(or.decisions()).toHaveLength(4)
    await expect.poll(async () => (await decideEntries(page)).length).toBe(4)
    expect((await decideEntries(page)).map((e) => e.usd)).toEqual([0, expect.any(Number), 0, 0])
  })

  test('no Vorprüfer chosen: no_route — never the device default, never Claude, never the forced chat route', async ({ page }) => {
    const { or, claude } = await decideSetup(page, [], { gate: false })
    await wsEval(page, (s) => s.updateSettings({ ai: { ...(s.settings.ai ?? {}), default: [{ p: 'anthropic', m: 'claude-opus-5-5' }] } }))
    await force(page, { p: 'openrouter', m: LUNA })
    expect(await decideVia(page)).toMatchObject({ ok: false, code: 'no_route', why: 'noroute' })
    expect(or.decisions()).toHaveLength(0)
    expect(or.posts()).toHaveLength(0)
    expect(claude.requests).toHaveLength(0)
    // the agent's own Vorprüfer is a level of its own (positive control)
    expect(await decideVia(page, { decider: { p: 'openrouter', m: JEV13 } })).toMatchObject({ ok: true, level: 'agent' })
  })

  test('the data rule: a class OpenRouter may not receive → policy, zero requests (control: allowed → one)', async ({ page }) => {
    const { or } = await decideSetup(page, [jevAnswer({})], { allow: ['public', 'structure', 'selection'] })
    expect(await decideVia(page)).toMatchObject({ ok: false, code: 'policy', why: 'policy', detail: 'rows' })
    expect(or.decisions()).toHaveLength(0)
    await wsEval(page, (s, allow) => s.setWorkspaceAI({ policy: { providers: { openrouter: { allow } }, restricted: [] } }), ALL_SHARED)
    expect(await decideVia(page)).toMatchObject({ ok: true })
    expect(or.decisions()).toHaveLength(1)
  })

  test("the operator rule leaves no endpoint for Jev (TypeSafe denied): 'endpoint', nothing sent (control: allowed → one)", async ({ page }) => {
    const { or } = await decideSetup(page, [jevAnswer({})])
    await wsEval(page, (s, allow) => s.setWorkspaceAI({ policy: { providers: { openrouter: { allow, upstream: { deny: ['TypeSafe'], noCollect: true, zdr: false } } }, restricted: [] } }), ALL_SHARED)
    expect(await decideVia(page)).toMatchObject({ ok: false, code: 'no_endpoint', why: 'endpoint' })
    expect(or.decisions()).toHaveLength(0)
    await wsEval(page, (s, allow) => s.setWorkspaceAI({ policy: { providers: { openrouter: { allow, upstream: { deny: [], noCollect: true, zdr: true } } }, restricted: [] } }), ALL_SHARED)
    expect(await decideVia(page)).toMatchObject({ ok: true })
    // zero data retention follows the rule into the body
    expect(or.decisions()[0]!.body!.provider).toEqual({ only: ['typesafe'], allow_fallbacks: false, data_collection: 'deny', zdr: true })
  })

  test('no price anywhere (the catalogue cannot be read): unchecked "price", nothing sent', async ({ page, errors }) => {
    errors.allow(/Failed to load resource/)
    const { or } = await decideSetup(page, [jevAnswer({})], { catalogue: 503 })
    expect(await decideVia(page)).toMatchObject({ ok: false, why: 'price' })
    expect(or.decisions()).toHaveLength(0)
    expect(or.to('/api/v1/models', 'GET')).toHaveLength(1)
  })
})
