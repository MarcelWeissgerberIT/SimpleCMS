/**
 * Routing in use (multi-provider S2, stage B): the rules' levels decide the route of each request (no forced route),
 * the route chip picks one for a single request, the picker's rows say why a model does not fit, "make default" writes
 * this device's layer only, the Jev Router's three tiers. Every openrouter.ai and api.anthropic.com exchange is mocked
 * (helpers/providers.ts) — nothing reaches a real host. People and pages are fictional.
 */
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, openApp, wsEval, createPage, gotoPage, editorOf, selectText, doc, para, pageIdByTitle, MOD } from './fixtures'
import { hostCounts, mockClaudeScript, mockOpenRouter, seedEndpoints, text, type ClaudeStep, type ORStepFn } from './helpers/providers'
import { aiPanel, autofillPriority, improve } from './helpers/aiFlows'
import { capsOfRow, readCatalogRow } from '../../src/shared/ai/catalog'
import type { Route, ShortlistRow } from '../../src/shared/ai/types'

const OR_KEY = 'sk-or-v1-e2e-openrouter-key-0000000000000000000000000000000000000000'
const CATALOGUE = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/openrouter-models.json', import.meta.url)), 'utf8')) as { data: unknown[] }
const row = (id: string): ShortlistRow => {
  const r = readCatalogRow(CATALOGUE.data.find((x) => (x as { id: string }).id === id), '2026-10-12')!
  return { m: r.id, label: r.label, price: r.price, caps: capsOfRow(r), at: '2026-10-12' }
}
const LUNA = 'openai/gpt-6-luna'
const JEV = 'typesafe/jev-router'
const POOL = [LUNA, 'deepseek/deepseek-v4-flash', 'z-ai/glm-5.3']
const ENDPOINTS = { [LUNA]: [{ tag: 'nordwind', name: 'Nordwind' }], 'deepseek/deepseek-v4-flash': [{ tag: 'nordwind', name: 'Nordwind' }], 'z-ai/glm-5.3': [{ tag: 'birkenau', name: 'Birkenau' }], [JEV]: [{ tag: 'typesafe', name: 'TypeSafe' }] }
const ALL = ['public', 'structure', 'selection', 'page', 'rows', 'files', 'workspace', 'people', 'transcript']

const rules = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    async ([fn, args]) => {
      const m = (await (window as unknown as { __oneAI: { rules(): Promise<Record<string, (...a: unknown[]) => unknown>> } }).__oneAI.rules()) as Record<string, (...a: unknown[]) => unknown>
      return m[fn as string](...(args as unknown[]))
    },
    [fn, args] as const,
  )

/** Claude's key, and (unless `claudeOnly`) OpenRouter's key, its shortlist and an allow list — no rule picks a route. */
async function setup(page: Page, o: { claudeOnly?: boolean; shortlist?: string[]; chat?: ORStepFn[]; claude?: ClaudeStep[]; deny?: string[] } = {}) {
  const or = await mockOpenRouter(page.context(), { chat: o.chat ?? [], fallback: { text: 'A tighter launch sentence.', cost: 0.0002 }, endpoints: ENDPOINTS })
  const claude = await mockClaudeScript(page.context(), o.claude ?? [], { fallback: text('A tighter launch sentence.') })
  const counts = hostCounts(page)
  await openApp(page)
  if (o.claudeOnly) await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
  else {
    await wsEval(page, (s, a) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', aiKeys: { openrouter: a.key }, ai: { models: a.rows } }), { key: OR_KEY, rows: (o.shortlist ?? POOL).map(row) })
    await wsEval(page, (s, a) => s.setWorkspaceAI({ policy: { providers: { openrouter: { allow: a.allow, ...(a.deny ? { upstream: { deny: a.deny, noCollect: true, zdr: false } } : {}) } }, restricted: [] } }), { allow: ALL, deny: o.deny ?? null })
    await seedEndpoints(page, ENDPOINTS)
  }
  return { or, claude, counts }
}

/** Select a line of a fresh page and open the AI menu (nothing picked yet). */
async function openMenu(page: Page, line = 'our launch sentence is kinda loose') {
  const id = await createPage(page, { title: 'Launch notes', content: doc(para('Intro line stays.'), para(line), para('Closing line.')) })
  await gotoPage(page, id)
  const ed = editorOf(page, id)
  await ed.locator('p', { hasText: line }).click()
  await selectText(page, ed, line)
  await page.locator('[aria-label="Formatting"]').first().getByRole('button', { name: /^Ask AI$/ }).click()
  await expect(aiPanel(page)).toBeVisible()
  return id
}

const chipOf = (page: Page) => aiPanel(page).getByTestId('route-chip')
const providerDialog = (page: Page) => page.getByRole('dialog', { name: 'Provider for this request', exact: true })
async function chooseProvider(page: Page, provider: string, id = 'route-chip-provider') {
  await page.getByTestId(id).click()
  await providerDialog(page).locator(`button[data-provider="${provider}"]`).click()
}
const picker = (page: Page) => page.getByRole('dialog', { name: 'Model for this request only' })
const rowOf = (page: Page, key: string) => picker(page).locator(`[data-route="${key}"]`)

test.describe('the rules decide the route of each request', () => {
  test('a device rule "Bulk work → OpenRouter", the default Claude: autofill goes only to OpenRouter, Improve only to Claude (acceptance 3); the estimate names the OpenRouter route', async ({ page }) => {
    const { or, claude, counts } = await setup(page, { chat: [{ text: JSON.stringify({ value: 'High' }) }] })
    expect(await rules(page, 'setDeviceRule', 'bulk', [{ p: 'openrouter', m: LUNA }])).toBe(true)
    // the autofill: one chat POST, no Claude request
    await autofillPriority(page)
    expect(or.posts()).toHaveLength(1)
    expect(or.posts()[0].body!.model).toBe(LUNA)
    expect(claude.requests).toHaveLength(0)
    // the estimate before a run: the route's label and its price (not Claude's)
    const dbId = await pageIdByTitle(page, 'Projects')
    await gotoPage(page, dbId)
    await page.locator('#main section.db').first().getByRole('tab').filter({ hasText: 'All projects' }).click()
    await page.locator('#main section.db').first().locator('.dbt-hcell__btn', { hasText: 'Priority' }).click()
    await page.getByRole('menuitem', { name: /AI autofill/ }).click()
    const dlg = page.getByRole('dialog', { name: 'AI autofill · Priority' })
    await expect(dlg.locator('.af-runbox .af-note')).toContainText('OpenRouter · GPT-6 Luna')
    await expect(dlg.locator('.af-readout__cost dd')).toHaveText(/≈ (\$|<)/)
    await page.keyboard.press('Escape')
    // Improve (Writing, no rule): Claude, nothing to OpenRouter
    await improve(page)
    expect(claude.requests).toHaveLength(1)
    expect(or.posts()).toHaveLength(1)
    expect(counts.anthropic).toBe(1)
  })

  test('positive control: without the rule the autofill goes to Claude', async ({ page }) => {
    const { or, claude } = await setup(page, { claude: [text(JSON.stringify({ value: 'High' }))] })
    await autofillPriority(page)
    expect(claude.requests).toHaveLength(1)
    expect(or.posts()).toHaveLength(0)
  })
})

test.describe('the route chip and its picker', () => {
  test('provider before model switches OpenRouter to Claude for one request, with provider-scoped models and no default write', async ({ page }, info) => {
    const { or, claude } = await setup(page)
    await rules(page, 'setDeviceRule', 'write', [{ p: 'openrouter', m: LUNA }])
    await openMenu(page)
    const provider = aiPanel(page).getByTestId('route-chip-provider')
    await expect(provider).toHaveAttribute('data-provider', 'openrouter')
    await chooseProvider(page, 'anthropic')
    await expect(picker(page)).toBeVisible()
    await expect(picker(page).getByLabel('Models from provider')).toHaveValue('anthropic')
    await expect(picker(page).locator('[data-route^="openrouter:"]')).toHaveCount(0)
    expect(claude.requests).toHaveLength(0)
    expect(or.posts()).toHaveLength(0)
    await rowOf(page, 'anthropic:claude-sonnet-5-5').click()
    await expect(provider).toHaveAttribute('data-provider', 'anthropic')
    await expect(chipOf(page)).toContainText('SONNET')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await wsEval(page, (s, theme) => s.updateSettings({ theme }), theme)
      await page.screenshot({ path: info.outputPath(`provider-model-${width}-${theme}.png`), animations: 'disabled' })
      expect(await aiPanel(page).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      await expect(provider).toBeVisible()
      await expect(chipOf(page)).toBeVisible()
    }
    await aiPanel(page).getByRole('option', { name: /Improve writing/ }).click()
    await expect(aiPanel(page)).toContainText('A tighter launch sentence.')
    expect(claude.requests).toHaveLength(1)
    expect(claude.requests[0].body.model).toBe('claude-sonnet-5-5')
    expect(or.posts()).toHaveLength(0)
    expect(await wsEval(page, s => s.settings.ai.routes.write)).toEqual([{ p: 'openrouter', m: LUNA }])
  })

  test('provider switch to OpenRouter executes its chosen model; missing key and data policy disable the provider', async ({ page }) => {
    const { or, claude } = await setup(page)
    await openMenu(page)
    const provider = aiPanel(page).getByTestId('route-chip-provider')
    await chooseProvider(page, 'openrouter')
    await expect(picker(page).locator('[data-route^="anthropic:"]')).toHaveCount(0)
    await rowOf(page, `openrouter:${LUNA}`).click()
    await aiPanel(page).getByRole('option', { name: /Improve writing/ }).click()
    await expect(aiPanel(page)).toContainText('A tighter launch sentence.')
    expect(or.posts()).toHaveLength(1)
    expect(or.posts()[0].body!.model).toBe(LUNA)
    expect(claude.requests).toHaveLength(0)
    await page.keyboard.press('Escape')
    await wsEval(page, s => s.setWorkspaceAI({ policy: { providers: { openrouter: { allow: [] } }, restricted: [] } }))
    await openMenu(page)
    await provider.click()
    await expect(providerDialog(page).locator('button[data-provider="openrouter"]')).toHaveAttribute('aria-disabled', 'true')
    await page.keyboard.press('Escape')
    await wsEval(page, s => s.updateSettings({ aiKeys: { openrouter: '' } }))
    await openMenu(page)
    await provider.click()
    await expect(providerDialog(page).locator('button[data-provider="openrouter"]')).toHaveAttribute('aria-disabled', 'true')
    await expect(providerDialog(page).locator('button[data-provider="openrouter"]')).toContainText('no key on this device')
  })

  test('provider selector is shared by palette questions and Help Ask, preserves questions and makes no requests on selection', async ({ page }) => {
    const { or, claude } = await setup(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.keyboard.press(`${MOD}+k`)
    await page.locator('.pal-input__field').fill('? Explain this page')
    await chooseProvider(page, 'openrouter', 'ask-route-chip-provider')
    await rowOf(page, `openrouter:${LUNA}`).click()
    await expect(page.getByTestId('ask-route-chip-provider')).toHaveAttribute('data-provider', 'openrouter')
    await expect(page.locator('.pal-input__field')).toHaveValue('Explain this page')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Command palette', exact: true })).toHaveCount(0)
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur())
    await page.keyboard.press('?')
    const help = page.getByRole('dialog', { name: 'Help', exact: true })
    await help.getByRole('tab', { name: /Ask/ }).click()
    await help.getByRole('textbox', { name: 'Your question', exact: true }).fill('How do I create a page?')
    await chooseProvider(page, 'openrouter', 'help-route-chip-provider')
    await rowOf(page, `openrouter:${LUNA}`).click()
    await expect(help.getByTestId('help-route-chip-provider')).toHaveAttribute('data-provider', 'openrouter')
    await expect(help.getByRole('textbox', { name: 'Your question', exact: true })).toHaveValue('How do I create a page?')
    expect(or.posts()).toHaveLength(0)
    expect(claude.requests).toHaveLength(0)
    await wsEval(page, s => s.updateSettings({ language: 'de' }))
    await expect(page.getByRole('dialog', { name: 'Hilfe', exact: true }).getByRole('button', { name: 'Anbieter für diese Anfrage', exact: true })).toBeVisible()
  })

  test('a Claude-only profile: the chip shows the same model as before, no ROUTER group; a pick goes with this request only (acceptance 1, chip part)', async ({ page }) => {
    const { claude, or } = await setup(page, { claudeOnly: true })
    await openMenu(page)
    await expect(chipOf(page)).toContainText('OPUS 5.5')
    await expect(aiPanel(page).getByTestId('route-chip-provider')).toHaveAttribute('data-provider', 'anthropic')
    await chipOf(page).click()
    await expect(picker(page)).toBeVisible()
    await expect(picker(page).getByTestId('route-lead')).toHaveText('Reads: the selection · goes to Anthropic')
    await expect(picker(page).getByText('Router', { exact: true })).toHaveCount(0)
    await expect(rowOf(page, 'anthropic:claude-opus-5-5')).toContainText('Default on this device')
    // ↵ on Sonnet: this request only
    await rowOf(page, 'anthropic:claude-sonnet-5-5').click()
    await expect(picker(page)).toHaveCount(0)
    await expect(chipOf(page)).toContainText('SONNET 5.5')
    await expect(chipOf(page)).toHaveAttribute('data-picked', '')
    await aiPanel(page).getByRole('option', { name: /Improve writing/ }).click()
    await expect(aiPanel(page)).toContainText('A tighter launch sentence.')
    expect(claude.requests).toHaveLength(1)
    expect(claude.requests[0].body.model).toBe('claude-sonnet-5-5')
    // the device's model is untouched
    expect(await wsEval(page, (s) => s.settings.aiModel ?? null)).not.toBe('claude-sonnet-5-5')
    expect(await wsEval(page, (s) => JSON.parse(JSON.stringify(s.settings.ai ?? null)))).toBeNull()
    expect(or.requests).toHaveLength(0)
  })

  test('keyboard: Alt+M opens the picker from the field (the text stays), type + ↵ picks, Esc closes the picker only; the Mac key (µ) too', async ({ page }) => {
    await setup(page)
    await openMenu(page)
    const field = aiPanel(page).locator('.ai-cmd__input')
    await field.fill('make it shorter')
    await page.keyboard.press('Alt+m')
    await expect(picker(page)).toBeVisible()
    await expect(field).toHaveValue('make it shorter')
    await page.keyboard.type('luna')
    await page.keyboard.press('Enter')
    await expect(picker(page)).toHaveCount(0)
    await expect(chipOf(page)).toContainText('LUNA')
    await expect(aiPanel(page).getByTestId('route-chip-provider')).toHaveAttribute('data-provider', 'openrouter')
    await expect(field).toBeFocused()
    // Esc in the picker closes it, the AI menu stays
    await page.keyboard.press('Alt+m')
    await expect(picker(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(picker(page)).toHaveCount(0)
    await expect(aiPanel(page)).toBeVisible()
    await expect(field).toHaveValue('make it shorter')
  })

  test('Mac: Option+M types "µ" — it opens the picker and types nothing', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel' }))
    await setup(page)
    await openMenu(page)
    const field = aiPanel(page).locator('.ai-cmd__input')
    await field.fill('tighter')
    await field.evaluate((el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'µ', code: 'KeyM', altKey: true, bubbles: true, cancelable: true })))
    await expect(picker(page)).toBeVisible()
    await expect(field).toHaveValue('tighter')
  })

  test('make default for "Writing" writes this device\'s layer only; "for everything" writes the device default', async ({ page }) => {
    await setup(page)
    await openMenu(page)
    await chipOf(page).click()
    await page.keyboard.type('luna')
    await expect(rowOf(page, `openrouter:${LUNA}`)).toHaveAttribute('data-selected', 'true')
    await picker(page).getByTestId('route-make-default').click()
    await expect(picker(page)).toHaveCount(0)
    expect(await wsEval(page, (s) => JSON.parse(JSON.stringify(s.settings.ai.routes)))).toEqual({ write: [{ p: 'openrouter', m: LUNA }] })
    expect(await wsEval(page, (s) => JSON.parse(JSON.stringify(s.ai?.routes ?? null)))).toBeNull()
    // the rule now decides: the chip shows it without a pick
    await expect(chipOf(page)).toContainText('LUNA')
    await expect(chipOf(page)).not.toHaveAttribute('data-picked', '')
    // for everything: the device default (a Claude model keeps settings.aiModel in step)
    await chipOf(page).click()
    await page.keyboard.type('sonnet')
    await picker(page).getByTestId('route-make-all').click()
    expect(await wsEval(page, (s) => JSON.parse(JSON.stringify(s.settings.ai.default)))).toEqual([{ p: 'anthropic', m: 'claude-sonnet-5-5' }])
    expect(await wsEval(page, (s) => s.settings.aiModel)).toBe('claude-sonnet-5-5')
  })

  test('rows that do not fit are dimmed with one reason: no key, a codeword request (MCP)', async ({ page }) => {
    await setup(page)
    await wsEval(page, (s) => s.updateSettings({ mcpServers: [{ id: 'srvroute01', name: 'archive', codeword: 'kb', url: 'https://mcp.example.test/api/archive/mcp', token: 'archive-e2e-PLAINTEXT-token-7Hq0004', enabled: true, prompt: 'Archive.', promptSource: 'auto', tools: ['archive_search'], checkedAt: 1 }] }))
    await openMenu(page)
    await aiPanel(page).locator('.ai-cmd__input').fill('kb: when is the launch?')
    await chipOf(page).click()
    const luna = rowOf(page, `openrouter:${LUNA}`)
    await expect(luna).toHaveAttribute('data-disabled', 'true')
    await expect(luna).toContainText('doesn’t connect MCP servers')
    await expect(rowOf(page, 'anthropic:claude-sonnet-5-5')).not.toHaveAttribute('data-disabled', 'true')
    await expect(picker(page).locator('[data-group="router"]')).toHaveCount(1)
    await expect(picker(page).locator('[data-group="router"]')).toContainText('doesn’t connect MCP servers')
    await page.keyboard.press('Escape')
    // no OpenRouter key on this device: its rows say so
    await wsEval(page, (s) => s.updateSettings({ aiKeys: { openrouter: '' } }))
    await aiPanel(page).locator('.ai-cmd__input').fill('')
    await chipOf(page).click()
    await expect(rowOf(page, `openrouter:${LUNA}`)).toHaveCount(0)
  })
})

test.describe('the Jev Router in the picker', () => {
  test('three tiers over a pool of 3; "strong" sends cost_tier high; the receipt names the model it chose', async ({ page }) => {
    const { or } = await setup(page, { chat: [{ text: 'A tighter launch sentence.', cost: 0.0004 }] })
    await openMenu(page)
    await chipOf(page).click()
    const tiers = picker(page).locator('[data-group="router"]')
    await expect(tiers).toHaveCount(3)
    await expect(tiers.nth(0)).toContainText('Jev Router · thrifty')
    await expect(tiers.nth(1)).toContainText('Jev Router · balanced')
    await expect(tiers.nth(2)).toContainText('Jev Router · strong')
    await expect(tiers.nth(2)).toContainText('one of 3 models in your list')
    await expect(tiers.nth(2)).toContainText(/up to [\d.,]+ \/ [\d.,]+ \$ per M/)
    await tiers.nth(2).click()
    await expect(chipOf(page)).toContainText('JEV ROUTER')
    await chipOf(page).click()
    await expect(picker(page).getByTestId('route-lead')).toHaveText(/Reads: the selection · goes to OpenRouter · Jev \(TypeSafe\) picks/)
    await picker(page).getByRole('button', { name: 'Why?' }).click()
    await expect(picker(page)).toContainText('Both receive the request.')
    await page.keyboard.press('Escape')
    await aiPanel(page).getByRole('option', { name: /Improve writing/ }).click()
    await expect(aiPanel(page)).toContainText('A tighter launch sentence.')
    expect(or.posts()).toHaveLength(1)
    const b = or.posts()[0].body!
    expect(b.model).toBe(JEV)
    expect(b.plugins[0]).toMatchObject({ id: 'jev-router', cost_tier: 'high' })
    await expect(aiPanel(page).getByTestId('ai-receipt').locator('.ai-receipt__model')).toContainText('Jev Router')
  })

  test('one shortlist model: one dimmed row "needs at least 2 models"; a deny list naming TypeSafe dims it too', async ({ page }) => {
    await setup(page, { shortlist: [LUNA] })
    await openMenu(page)
    await chipOf(page).click()
    const one = picker(page).locator('[data-group="router"]')
    await expect(one).toHaveCount(1)
    await expect(one).toHaveAttribute('data-disabled', 'true')
    await expect(one).toContainText('needs at least 2 models in your list')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    // a pool of 3, but the operator rule excludes TypeSafe
    await wsEval(page, (s, rows) => s.updateSettings({ ai: { ...s.settings.ai, models: rows } }), POOL.map(row))
    await wsEval(page, (s, allow) => s.setWorkspaceAI({ policy: { providers: { openrouter: { allow, upstream: { deny: ['typesafe'], noCollect: true, zdr: false } } }, restricted: [] } }), ALL)
    await openMenu(page)
    await chipOf(page).click()
    await expect(picker(page).locator('[data-group="router"]')).toHaveCount(1)
    await expect(picker(page).locator('[data-group="router"]')).toContainText('your operator rule excludes TypeSafe')
  })
})

test.describe('phone width', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('390 px: the chip opens a sheet; a tap picks; the sheet closes', async ({ page }) => {
    await setup(page)
    await openMenu(page)
    await chipOf(page).tap()
    const sheet = page.locator('.route-sheet')
    await expect(sheet).toBeVisible()
    await page.waitForTimeout(500)
    await sheet.locator(`[data-route="openrouter:${LUNA}"]`).tap()
    await expect(sheet).toHaveCount(0)
    await expect(chipOf(page)).toContainText('LUNA')
    const box = await sheet.boundingBox().catch(() => null)
    expect(box).toBeNull()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})
