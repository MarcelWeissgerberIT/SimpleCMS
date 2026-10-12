/**
 * Multi-provider S2, stage C: the way into AI setup and the assistant "Set up AI" (features/ai/setup).
 *
 *  - every "can this run?" surface without a key shows <AINeedsSetup> and its key opens the assistant at step 01;
 *    a refused request's fix opens the step it names (a data rule → step 04 at that class); ⌘K "Set up AI"
 *  - Settings › AI (this device): plates and their free check (no text sent), member data written on the device only,
 *    the Jev Router line with one and with two models, no sideways scroll at 390 px
 *  - the assistant: a Claude-only device asks openrouter.ai nothing until OpenRouter is picked; the whole walk by keyboard
 *    (1440) and by touch (390); "Connect account" (PKCE) happy / denied / state mismatch; a refused key's help and "Paste
 *    again" (N); a key without credit is kept; models + the catalogue picker (Jev selectable, other routers dimmed, the
 *    checker not pickable, ≤ 8 endpoint reads); data rules (Claude untouched writes nothing; OpenRouter starts empty)
 *
 * Every AI host is mocked (helpers/providers.ts — the documented formats); the aiNet guard aborts anything else.
 * Test data is fictional.
 */
import type { Locator, Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, openApp, wsEval, uiEval, createPage, gotoPage, editorOf, selectText, doc, para, MOD } from './fixtures'
import { hostCounts, mockClaudeScript, mockOpenRouter, orCallback, text } from './helpers/providers'
import { openTerminal, terminal } from './helpers/terminal'
import { capsOfRow, readCatalogRow } from '../../src/shared/ai/catalog'
import type { ShortlistRow } from '../../src/shared/ai/types'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const CATALOGUE = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/openrouter-models.json', import.meta.url)), 'utf8')) as { data: unknown[] }
/** a shortlist row as the catalogue gives it (the trimmed fixture) */
const row = (id: string): ShortlistRow => {
  const r = readCatalogRow(CATALOGUE.data.find((x) => (x as { id: string }).id === id), '2026-10-12')!
  return { m: r.id, label: r.label, price: r.price, caps: capsOfRow(r), at: '2026-10-12' }
}

const CLAUDE_KEY = 'sk-ant-e2e-setup-key-0000000000000000Cl4u'
const OR_KEY = 'sk-or-v1-e2e-setup-key-00000000000000000000000000000000000000000000000Or9k'
const WORK = ['public', 'structure', 'selection', 'page', 'rows', 'files', 'workspace']

const setup = (page: Page) => page.getByTestId('ai-setup')
const next = (page: Page) => setup(page).getByTestId('ai-setup-next')
const openSetup = (page: Page, o: AnyState = { reason: 'add' }) => uiEval(page, (s, m) => s.openModal({ type: 'aiSetup', ...m }), o)
const openSettingsAI = (page: Page) => uiEval(page, (s) => s.openModal({ type: 'settings', tab: 'ai' }))
const settingsAI = (s: AnyState) => JSON.parse(JSON.stringify(s.settings.ai ?? null))
const wsAI = (s: AnyState) => JSON.parse(JSON.stringify(s.ai ?? null))

/** Press Tab until `target` has the focus (keyboard only). */
async function tabTo(page: Page, target: Locator, max = 60) {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  throw new Error('focus never reached the target')
}

async function withKeys(page: Page, keys: { claude?: boolean; or?: boolean }) {
  await wsEval(page, (s, k) => s.updateSettings({ ...(k.claude ? { aiApiKey: k.ck } : {}), ...(k.or ? { aiKeys: { openrouter: k.ok } } : {}) }), { ...keys, ck: CLAUDE_KEY, ok: OR_KEY })
}

/* ------------------------------------------------------------------ */
/* The way in (C2)                                                      */
/* ------------------------------------------------------------------ */

test.describe('the way into setup', () => {
  test('without a key: the terminal, ⌘K "?" and the help\'s Ask show the card; its key opens step 01; ⌘K lists "Set up AI"', async ({ page, aiNet }) => {
    await openApp(page)
    // the AI terminal
    await openTerminal(page)
    const card = terminal(page).getByTestId('term-needs')
    await expect(card).toHaveAttribute('data-reason', 'no_key')
    // it names only the providers this build can set up (OpenAI's plate reads "comes soon")
    await expect(card).toContainText('Pick Claude or OpenRouter — or both.')
    await expect(card).not.toContainText('OpenAI')
    await card.getByRole('button', { name: 'Set up AI' }).click()
    await expect(setup(page)).toHaveAttribute('data-step', 'provider')
    await expect(page.getByTestId('ai-setup-title')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(setup(page)).toHaveCount(0)

    // ⌘K "?"
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('?When do we launch?')
    const pal = page.getByRole('dialog', { name: 'Command palette' })
    await expect(pal.getByTestId('ask-needs')).toBeVisible()
    await pal.getByTestId('ask-needs').getByRole('button', { name: 'Set up AI' }).click()
    await expect(pal).toHaveCount(0)
    await expect(setup(page)).toHaveAttribute('data-step', 'provider')
    await page.keyboard.press('Escape')

    // ⌘K "Set up AI" (a command while no key is set)
    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('Set up AI')
    await expect(pal.getByRole('option', { name: /Set up AI/ }).first()).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(setup(page)).toHaveAttribute('data-step', 'provider')
    await page.keyboard.press('Escape')

    // the help's Ask
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
    await page.keyboard.press('?')
    const help = page.getByRole('dialog', { name: /^(Help|Hilfe)$/ })
    await help.getByRole('tab', { name: /Ask/ }).click()
    const field = help.getByRole('textbox', { name: 'Your question' })
    await field.fill('How do I protect a share link with a password?')
    await field.press('Enter')
    await expect(help.getByTestId('help-ask-needs')).toBeVisible()
    await help.getByTestId('help-ask-needs').getByRole('button', { name: 'Set up AI' }).click()
    await expect(setup(page)).toHaveAttribute('data-step', 'provider')
    expect(aiNet.count('anthropic') + aiNet.count('openrouter')).toBe(0)
  })

  test('an OpenRouter-only device: the terminal (Claude only in this version) says so and offers "Set up Claude"', async ({ page }) => {
    await mockOpenRouter(page.context())
    await openApp(page)
    await withKeys(page, { or: true })
    await openTerminal(page)
    const card = terminal(page).getByTestId('term-needs')
    await expect(card).toHaveAttribute('data-reason', 'route')
    await expect(card).toContainText(': only with Claude for now')
    await card.getByRole('button', { name: 'Set up Claude' }).click()
    await expect(setup(page)).toBeVisible()
    await expect(setup(page).getByTestId('plate-anthropic')).toBeVisible()
  })

  test('a data rule refuses the AI menu: "Change rule" opens step 04 with that class\'s switch focused; nothing sent', async ({ page, aiNet }) => {
    const { requests } = await mockClaudeScript(page.context(), [text('never')])
    await openApp(page)
    await withKeys(page, { claude: true })
    // the workspace keeps selected text away from Claude (a rule of this build's generation)
    await wsEval(page, (s) => s.setWorkspaceAI({ policy: { providers: { anthropic: { allow: ['public', 'structure'] } }, restricted: [] } }))
    const id = await createPage(page, { title: 'Rule check', content: doc(para('a sentence the rule keeps home')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p').first().click()
    await selectText(page, ed, 'a sentence the rule keeps home')
    await page.locator('[aria-label="Formatting"]').first().getByRole('button', { name: /^Ask AI$/ }).click()
    const ai = page.getByRole('dialog', { name: 'Ask AI' })
    await ai.getByRole('option', { name: /Improve writing/ }).click()
    const fix = ai.getByTestId('ai-fix')
    await expect(fix).toHaveAttribute('data-fix', 'data')
    await expect(fix).toContainText('Change rule')
    await fix.click()
    await expect(setup(page)).toHaveAttribute('data-step', 'data')
    await expect(setup(page).locator('[data-cell="anthropic:selection"]')).toBeFocused()
    expect(requests).toHaveLength(0)
    expect(aiNet.count('anthropic')).toBe(0)
  })

  test('the changelog\'s Settings try opens Settings › AI at its MCP servers', async ({ page }) => {
    await openApp(page)
    await uiEval(page, (s) => s.openModal({ type: 'settings', tab: 'ai', section: 'mcp' }))
    await expect(page.locator('.aip__section[data-section="mcp"]')).toBeFocused()
    await expect(page.getByTestId('mcp-servers')).toBeInViewport()
  })
})

/* ------------------------------------------------------------------ */
/* Settings › AI (C3)                                                   */
/* ------------------------------------------------------------------ */

test.describe('Settings › AI on this device', () => {
  test('plates: none → "Set up"; with keys the free check asks the model list and /key — no text, no chat request', async ({ page, aiNet }) => {
    const { requests } = await mockClaudeScript(page.context(), [])
    const or = await mockOpenRouter(page.context())
    await openApp(page)
    await openSettingsAI(page)
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByTestId('settings-setup-anthropic')).toBeVisible()
    await expect(dialog.getByTestId('settings-setup-openrouter')).toBeVisible()
    await expect(dialog.getByTestId('settings-plate-openai')).toHaveAttribute('data-state', 'soon')
    await page.keyboard.press('Escape')

    await withKeys(page, { claude: true, or: true })
    await openSettingsAI(page)
    // OpenRouter has a key but may receive nothing yet (no preset chosen): not READY for routing (review #21)
    await expect(dialog.getByTestId('settings-plate-openrouter')).toContainText('Ready · receives nothing yet')
    for (const p of ['anthropic', 'openrouter']) {
      await expect(dialog.getByTestId(`settings-plate-${p}`)).toHaveAttribute('data-state', p === 'anthropic' ? 'ready' : 'empty')
      await dialog.getByTestId(`settings-check-${p}`).click()
      await expect(dialog.getByTestId(`settings-checked-${p}`)).toContainText('no text sent')
    }
    // OpenRouter's /key answers the key's limit: shown live
    await expect(dialog.getByTestId('settings-or-limit')).toBeVisible()
    expect(or.to('/api/v1/key', 'GET')).toHaveLength(1)
    expect(or.to('/api/v1/key', 'GET')[0]!.bearer).toBe(OR_KEY)
    expect(or.posts()).toHaveLength(0)
    expect(requests).toHaveLength(0)
    expect(aiNet.count('anthropic')).toBe(1)
  })

  test('the Jev Router line: one model in the list → it needs two; two → it picks among them', async ({ page }) => {
    await mockOpenRouter(page.context())
    await openApp(page)
    await withKeys(page, { or: true })
    await wsEval(page, (s, r) => s.updateSettings({ ai: { ...(s.settings.ai ?? {}), models: r } }), [row('openai/gpt-6-luna')])
    await openSettingsAI(page)
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByTestId('settings-jev')).toContainText('needs at least 2 models')
    await page.keyboard.press('Escape')
    await wsEval(page, (s, r) => s.updateSettings({ ai: { ...(s.settings.ai ?? {}), models: r } }), [row('openai/gpt-6-luna'), row('z-ai/glm-5.3')])
    await openSettingsAI(page)
    await expect(dialog.getByTestId('settings-jev')).toContainText('2 models')
  })

  test('your own data is this device\'s: "All on" writes settings.ai.allow, never the workspace', async ({ page }) => {
    await mockOpenRouter(page.context())
    await openApp(page)
    await withKeys(page, { or: true })
    const before = await wsEval(page, wsAI)
    await openSettingsAI(page)
    const own = page.getByTestId('own-all-openrouter')
    await own.scrollIntoViewIfNeeded()
    await own.click()
    await expect.poll(async () => (await wsEval(page, settingsAI))?.allow?.openrouter).toEqual(['private', 'mail', 'memory', 'mcp'])
    expect(await wsEval(page, wsAI)).toEqual(before)
  })

  test('at 390 px nothing scrolls sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await mockOpenRouter(page.context())
    await openApp(page)
    await withKeys(page, { claude: true, or: true })
    await openSettingsAI(page)
    await expect(page.getByTestId('ai-settings')).toBeVisible()
    const over = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="ai-settings"]') as HTMLElement
      return { doc: document.documentElement.scrollWidth, tab: el.scrollWidth - el.clientWidth }
    })
    expect(over.doc).toBeLessThanOrEqual(390)
    expect(over.tab).toBeLessThanOrEqual(1)
  })
})

/* ------------------------------------------------------------------ */
/* The assistant (C4–C8)                                                */
/* ------------------------------------------------------------------ */

test.describe('the assistant "Set up AI"', () => {
  test('a Claude-only device: step 01 asks openrouter.ai nothing; picking OpenRouter reads the catalogue once; the notes name the combine + Jev', async ({ page, aiNet }) => {
    await mockClaudeScript(page.context(), [])
    const or = await mockOpenRouter(page.context())
    await openApp(page)
    await withKeys(page, { claude: true })
    // nothing opens by itself on a Claude-only device (acceptance 1)
    await page.waitForTimeout(500)
    await expect(setup(page)).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await openSetup(page)
    await expect(setup(page).getByTestId('plate-anthropic')).toHaveAttribute('data-state', 'ready')
    await expect(setup(page).getByTestId('note-combine')).toBeVisible()
    await expect(setup(page).getByTestId('note-jev')).toContainText('Jev Router')
    await page.waitForTimeout(500)
    expect(aiNet.count('openrouter')).toBe(0)
    // positive control: picking OpenRouter warms the catalogue (one read)
    await setup(page).getByTestId('plate-openrouter').getByRole('switch').click()
    await expect.poll(() => or.to('/api/v1/models', 'GET').length).toBe(1)
    await expect(setup(page).getByTestId('plate-openrouter')).toHaveAttribute('data-state', 'picked')
  })

  test('the whole walk by keyboard: pick OpenRouter, paste + check, models, a preset, one provider for everything, done', async ({ page }) => {
    await mockClaudeScript(page.context(), [])
    const or = await mockOpenRouter(page.context())
    await openApp(page)
    await withKeys(page, { claude: true })
    await openSetup(page)
    const sw = setup(page).getByTestId('plate-openrouter').getByRole('switch')
    await tabTo(page, sw)
    await page.keyboard.press('Space')
    await expect(setup(page).getByTestId('plate-openrouter')).toHaveAttribute('data-state', 'picked')
    await tabTo(page, next(page))
    await page.keyboard.press('Enter')
    // 02: OpenRouter's tab, paste the key, ↵ checks it
    await expect(setup(page)).toHaveAttribute('data-step', 'key')
    const field = setup(page).getByTestId('key-field-openrouter')
    await tabTo(page, field)
    await page.keyboard.type(OR_KEY)
    await page.keyboard.press('Enter')
    await expect(setup(page).getByTestId('bench-openrouter')).toHaveAttribute('data-state', 'valid')
    expect(or.to('/api/v1/key', 'GET').at(-1)!.bearer).toBe(OR_KEY)
    expect(await wsEval(page, (s) => s.settings.aiKeys?.openrouter)).toMatch(/^vault:[0-9a-z]+:Or9k$/)
    await tabTo(page, next(page))
    await page.keyboard.press('Enter')
    // 03: suggestions for the three roles
    await expect(setup(page)).toHaveAttribute('data-step', 'models')
    for (const r of ['fast', 'standard', 'deep']) await expect(setup(page).getByTestId(`role-${r}`)).not.toHaveAttribute('data-none', '', { timeout: 15_000 })
    await tabTo(page, next(page))
    await page.keyboard.press('Enter')
    // 04: OpenRouter starts with nothing; the "Work data" preset
    await expect(setup(page)).toHaveAttribute('data-step', 'data')
    await expect(setup(page).locator('[data-cell="openrouter:page"]')).toHaveAttribute('aria-checked', 'false')
    const preset = setup(page).getByTestId('preset-openrouter')
    await tabTo(page, preset)
    await preset.selectOption('work')
    await tabTo(page, next(page))
    await page.keyboard.press('Enter')
    // 05: one provider for everything
    await expect(setup(page)).toHaveAttribute('data-step', 'routing')
    // a radio group: Tab reaches the chosen option ("Leave it as it is"), the arrows move the choice
    await tabTo(page, setup(page).getByTestId('together-keep'))
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await expect(setup(page).getByTestId('together-openrouter')).toHaveAttribute('aria-checked', 'true')
    await expect(setup(page).getByTestId('together-openrouter')).toBeFocused()
    await expect(setup(page).getByTestId('together-writes')).toBeVisible()
    await tabTo(page, next(page))
    await page.keyboard.press('Enter')
    // 06
    await expect(setup(page)).toHaveAttribute('data-step', 'done')
    await expect(setup(page).getByTestId('done-summary')).toContainText('OpenRouter')
    const dev = await wsEval(page, settingsAI)
    expect(dev.models.length).toBeGreaterThanOrEqual(2)
    expect(Object.keys(dev.roles.openrouter).sort()).toEqual(['deep', 'fast', 'standard'])
    expect(dev.default[0]).toMatchObject({ p: 'openrouter', m: dev.roles.openrouter.standard })
    for (const c of ['bulk', 'help', 'memory']) expect(dev.routes[c][0]).toMatchObject({ p: 'openrouter', m: dev.roles.openrouter.fast })
    const ws = await wsEval(page, wsAI)
    // a rule about OpenRouter alone needs no generation stamp (an older tab never sends to OpenRouter)
    expect(ws.gen ?? 1).toBe(1)
    expect([...ws.policy.providers.openrouter.allow].sort()).toEqual([...WORK].sort())
    // Claude's column was not touched: no rule written for it
    expect(ws.policy.providers.anthropic).toBeUndefined()
    await tabTo(page, next(page))
    await page.keyboard.press('Enter')
    await expect(setup(page)).toHaveCount(0)
  })

  const CONNECT: Array<{ mode: 'approve' | 'deny' | 'foreign'; issue: string | null }> = [
    { mode: 'approve', issue: null },
    { mode: 'deny', issue: 'oauth_denied' },
    { mode: 'foreign', issue: 'oauth_state' },
  ]
  for (const f of CONNECT)
    test(`step 02 "Connect account" — ${f.mode}: ${f.issue ? `the issue (${f.issue}), nothing kept` : 'connected, sealed and checked'}`, async ({ page, errors }) => {
      errors.allow(/Failed to load resource|access_denied/)
      const foreign = (u: URL) => {
        const cb = new URL(u.searchParams.get('callback_url')!)
        cb.searchParams.set('code', 'code-e2e-0003')
        cb.searchParams.set('state', 'Z'.repeat(32))
        return cb.href
      }
      const or = await mockOpenRouter(page.context(), {
        consent: (u) => (f.mode === 'approve' ? orCallback(u.href, 'approve') : f.mode === 'deny' ? orCallback(u.href, 'deny-state') : foreign(u)),
        exchange: 'sk-or-v1-e2e-minted-key-0a9c00000000000000000000000000000000000000000000000M4Tx',
      })
      await openApp(page)
      await openSetup(page, { reason: 'add', step: 'key', provider: 'openrouter' })
      const popup = page.context().waitForEvent('page')
      await setup(page).getByTestId('or-connect-key').click()
      const win = await popup
      errors.watch(win)
      if (!f.issue) {
        await win.waitForEvent('close', { timeout: 20_000 })
        await expect(setup(page).getByTestId('or-disconnect')).toBeVisible({ timeout: 15_000 })
        await expect(setup(page).getByTestId('bench-openrouter')).toHaveAttribute('data-state', 'valid')
        expect(await wsEval(page, (s) => s.settings.aiKeys?.openrouter)).toMatch(/:M4Tx$/)
        expect(or.to('/api/v1/auth/keys', 'POST')).toHaveLength(1)
      } else {
        await expect(setup(page).getByTestId('or-issue')).toHaveAttribute('data-issue', f.issue, { timeout: 20_000 })
        if (!win.isClosed()) await win.close()
        expect(await wsEval(page, (s) => s.settings.aiKeys?.openrouter ?? '')).toBe('')
        expect(or.to('/api/v1/auth/keys', 'POST')).toHaveLength(0)
      }
      expect(or.posts()).toHaveLength(0)
    })

  test('step 02 errors: a refused key shows its help, N pastes again; a key without credit is kept', async ({ page, errors }) => {
    errors.allow(/Failed to load resource|40[12]/)
    let answer: number | 'ok' = 401
    await mockOpenRouter(page.context(), { key: (req) => (answer === 'ok' ? { status: 200, json: { data: { label: 'One', limit: null, usage: 0, limit_remaining: null, is_free_tier: false } } } : { status: answer, json: { error: { code: answer, message: answer === 401 ? 'User not found' : 'Insufficient credits' } } }) })
    await openApp(page)
    await openSetup(page, { reason: 'add', step: 'key', provider: 'openrouter' })
    const field = setup(page).getByTestId('key-field-openrouter')
    await field.fill(OR_KEY)
    await field.press('Enter')
    const bench = setup(page).getByTestId('bench-openrouter')
    await expect(bench).toHaveAttribute('data-state', 'error')
    await expect(setup(page).getByTestId('help-invalid_key')).toBeVisible()
    // a refused key is never sealed
    expect(await wsEval(page, (s) => s.settings.aiKeys?.openrouter ?? '')).toBe('')
    await setup(page).getByTestId('help-new-paste').focus()
    await page.keyboard.press('n')
    await expect(field).toBeFocused()
    // 402: the key is valid, only out of credit — kept (sealed), the bench says so
    answer = 402
    await field.fill(OR_KEY)
    await field.press('Enter')
    await expect.poll(() => wsEval(page, (s) => s.settings.aiKeys?.openrouter ?? '')).toMatch(/:Or9k$/)
    await expect(setup(page).getByTestId('help-no_credit')).toBeVisible()
  })

  test('step 02 (review #6): a Claude key pasted into the OpenRouter tab is refused before anything is sent; the check never sends another provider\'s key; positive control', async ({ page }) => {
    await mockOpenRouter(page.context(), { key: () => ({ status: 200, json: { data: { label: 'One', limit: null, usage: 0, limit_remaining: null, is_free_tier: false } } }) })
    await mockClaudeScript(page.context(), [])
    await openApp(page)
    await openSetup(page, { reason: 'add', step: 'key', provider: 'openrouter' })
    const field = setup(page).getByTestId('key-field-openrouter')
    await expect(field).toBeVisible()
    const counts = hostCounts(page)
    await field.fill(CLAUDE_KEY)
    const note = setup(page).getByTestId('key-other-openrouter')
    await expect(note).toContainText('This key is from Anthropic (it starts with sk-ant-) — paste it in the Claude tab.')
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await expect(setup(page).getByTestId('key-check-openrouter')).toBeDisabled()
    await field.press('Enter')
    await page.waitForTimeout(400)
    expect(counts).toEqual({ anthropic: 0, openai: 0, openrouter: 0 })
    expect(await wsEval(page, (s) => s.settings.aiKeys?.openrouter ?? '')).toBe('')
    // the check itself refuses another provider's key (the reverse: an OpenRouter key never reaches api.anthropic.com)
    const said = await page.evaluate((k) => (window as unknown as { __oneAI: { verifyProvider(p: string, k: string): Promise<unknown> } }).__oneAI.verifyProvider('anthropic', k), OR_KEY)
    expect(said).toEqual({ ok: false, code: 'invalid_key' })
    expect(counts.anthropic).toBe(0)
    // positive control: the right key is checked (one GET /key) and sealed
    await field.fill(OR_KEY)
    await expect(note).toHaveCount(0)
    await field.press('Enter')
    await expect.poll(() => wsEval(page, (s) => s.settings.aiKeys?.openrouter ?? '')).toMatch(/:Or9k$/)
    expect(counts.openrouter).toBeGreaterThan(0)
  })

  test('step 03: the catalogue picker — Jev Router selectable with two models, other routers dimmed, ≤ 8 endpoint reads; the checker is not pickable', async ({ page }) => {
    const or = await mockOpenRouter(page.context())
    await openApp(page)
    await withKeys(page, { or: true })
    await openSetup(page, { reason: 'models', step: 'models', provider: 'openrouter' })
    for (const r of ['fast', 'standard', 'deep']) await expect(setup(page).getByTestId(`role-${r}`)).not.toHaveAttribute('data-none', '', { timeout: 15_000 })
    await expect(setup(page).getByTestId('jev-line')).toHaveAttribute('data-ok', 'true')
    await expect(setup(page).getByTestId('role-checker')).toHaveAttribute('aria-disabled', 'true')
    await expect(setup(page).getByTestId('role-checker').getByRole('button')).toHaveCount(0)
    const before = or.to(/\/endpoints$/, 'GET').length
    await setup(page).getByTestId('role-standard-change').click()
    const picker = page.getByTestId('catalog-picker')
    await expect(picker).toBeVisible()
    await expect(picker.locator('.cat-row[data-row="openrouter/auto"]')).toHaveAttribute('data-off')
    await expect(picker.locator('.cat-row[data-row="typesafe/jev-router"]')).not.toHaveAttribute('data-off')
    await page.waitForTimeout(800)
    expect(or.to(/\/endpoints$/, 'GET').length - before).toBeLessThanOrEqual(8)
    await picker.locator('.cat-row[data-row="typesafe/jev-router"]').click()
    await expect(picker).toHaveCount(0)
    await expect(setup(page).getByTestId('role-standard')).toContainText('Jev Router')
    await next(page).click()
    await expect(setup(page)).toHaveAttribute('data-step', 'data')
    expect((await wsEval(page, settingsAI)).roles.openrouter.standard).toBe('typesafe/jev-router')
  })

  test('step 04: Claude untouched writes no rule (no generation stamp); a changed Claude switch writes generation 2', async ({ page }) => {
    await mockClaudeScript(page.context(), [])
    await openApp(page)
    await withKeys(page, { claude: true })
    await openSetup(page, { reason: 'policy', step: 'data', provider: 'anthropic' })
    await expect(setup(page)).toHaveAttribute('data-step', 'data')
    await next(page).click()
    await expect(setup(page)).toHaveAttribute('data-step', 'done')
    const untouched = await wsEval(page, wsAI)
    expect(untouched?.gen).toBeUndefined()
    expect(untouched?.policy?.providers?.anthropic).toBeUndefined()
    await page.keyboard.press('Escape')
    // positive control: switching one class off for Claude writes the rule, stamped with this build's generation
    await openSetup(page, { reason: 'policy', step: 'data', provider: 'anthropic' })
    await setup(page).locator('[data-cell="anthropic:people"]').click()
    await expect(setup(page).locator('[data-cell="anthropic:people"]')).toHaveAttribute('aria-checked', 'false')
    await next(page).click()
    const ws = await wsEval(page, wsAI)
    expect(ws.gen).toBe(2)
    expect(ws.policy.providers.anthropic.allow).not.toContain('people')
    expect(ws.policy.providers.anthropic.allow).toContain('page')
  })
})

test.describe('the assistant at 390 px by touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the whole walk by taps; nothing scrolls sideways on any step', async ({ page }) => {
    await mockClaudeScript(page.context(), [])
    await mockOpenRouter(page.context())
    await openApp(page)
    await withKeys(page, { claude: true })
    await openSetup(page)
    const sideways = () => page.evaluate(() => document.documentElement.scrollWidth)
    await expect(setup(page)).toHaveAttribute('data-step', 'provider')
    expect(await sideways()).toBeLessThanOrEqual(390)
    await setup(page).getByTestId('plate-openrouter').getByRole('switch').tap()
    await next(page).tap()
    await expect(setup(page)).toHaveAttribute('data-step', 'key')
    await setup(page).getByTestId('key-field-openrouter').fill(OR_KEY)
    await setup(page).getByTestId('key-check-openrouter').tap()
    await expect(setup(page).getByTestId('bench-openrouter')).toHaveAttribute('data-state', 'valid')
    expect(await sideways()).toBeLessThanOrEqual(390)
    await next(page).tap()
    await expect(setup(page)).toHaveAttribute('data-step', 'models')
    for (const r of ['fast', 'standard', 'deep']) await expect(setup(page).getByTestId(`role-${r}`)).not.toHaveAttribute('data-none', '', { timeout: 15_000 })
    expect(await sideways()).toBeLessThanOrEqual(390)
    await next(page).tap()
    await expect(setup(page)).toHaveAttribute('data-step', 'data')
    await setup(page).getByTestId('preset-openrouter').selectOption('marked')
    expect(await sideways()).toBeLessThanOrEqual(390)
    await next(page).tap()
    await expect(setup(page)).toHaveAttribute('data-step', 'routing')
    await setup(page).getByTestId('together-keep').tap()
    expect(await sideways()).toBeLessThanOrEqual(390)
    await next(page).tap()
    await expect(setup(page)).toHaveAttribute('data-step', 'done')
    expect(await sideways()).toBeLessThanOrEqual(390)
    expect([...(await wsEval(page, wsAI)).policy.providers.openrouter.allow].sort()).toEqual(['public', 'selection', 'structure'])
    // "Leave it as it is": no device default written
    expect((await wsEval(page, settingsAI)).default).toBeUndefined()
    await next(page).tap()
    await expect(setup(page)).toHaveCount(0)
  })
})

/* ------------------------------------------------------------------ */
/* S2 review (UX findings 14–26)                                        */
/* ------------------------------------------------------------------ */

test.describe('S2 review: the assistant and Settings › AI say what they do', () => {
  const LUNA = 'openai/gpt-6-luna'
  const precheck = (page: Page, input: AnyState) => page.evaluate((i) => (window as unknown as { __oneAI: { precheck(i: unknown): AnyState } }).__oneAI.precheck(i), input)

  test('step 03 (#14): Claude\'s Standard is this device\'s Claude model — changed there, Claude requests go to it; step 06 names only it', async ({ page }) => {
    await mockClaudeScript(page.context(), [])
    await openApp(page)
    await withKeys(page, { claude: true })
    await openSetup(page, { reason: 'add', step: 'models', provider: 'anthropic' })
    await expect(setup(page).getByTestId('claude-roles-note')).toContainText('Standard is the model this device sends every Claude request to')
    await setup(page).getByTestId('role-standard-change').click()
    await setup(page).getByTestId('role-standard').getByRole('radio', { name: 'Claude Haiku 4.5' }).click()
    await next(page).click()
    await expect(setup(page)).toHaveAttribute('data-step', 'data')
    await next(page).click()
    await expect(setup(page)).toHaveAttribute('data-step', 'done')
    expect(await wsEval(page, (s) => s.settings.aiModel)).toBe('claude-haiku-4-5')
    const claude = setup(page).getByTestId('done-summary').locator('[data-provider="anthropic"]')
    await expect(claude).toContainText('Standard: Claude Haiku 4.5')
    await expect(claude).not.toContainText('Fast:')
    await next(page).click()
    const id = await createPage(page, { title: 'Model check', content: doc(para('A line.')) })
    expect(await precheck(page, { purpose: 'menu.action', sources: [{ page: id, as: 'selection' }] })).toMatchObject({ ok: true, route: 'anthropic:claude-haiku-4-5' })
  })

  test('step 02 / 03 tabs by keyboard (#16, #18): Alt+← / → from the heading and the footer, ← / → on step 03\'s tabs', async ({ page }) => {
    await mockClaudeScript(page.context(), [])
    await mockOpenRouter(page.context())
    await openApp(page)
    await withKeys(page, { claude: true, or: true })
    await openSetup(page, { reason: 'add', step: 'key' })
    const keyTab = (p: string) => setup(page).getByTestId(`key-tab-${p}`)
    await expect(setup(page).getByTestId('ai-setup-title')).toBeFocused()
    const first = (await keyTab('anthropic').getAttribute('aria-selected')) === 'true' ? 'anthropic' : 'openrouter'
    const other = first === 'anthropic' ? 'openrouter' : 'anthropic'
    // from the heading
    await page.keyboard.press('Alt+ArrowRight')
    await expect(keyTab(other)).toHaveAttribute('aria-selected', 'true')
    // from the footer's Next key
    await next(page).focus()
    await page.keyboard.press('Alt+ArrowLeft')
    await expect(keyTab(first)).toHaveAttribute('aria-selected', 'true')
    // step 03: the tab list's own arrows, and Alt+← / → from anywhere
    await page.keyboard.press('Escape')
    await expect(setup(page)).toHaveCount(0)
    await openSetup(page, { reason: 'add', step: 'models' })
    const modelsTab = (p: string) => setup(page).getByTestId(`models-tab-${p}`)
    await expect(setup(page)).toHaveAttribute('data-step', 'models')
    const active = (await modelsTab('anthropic').getAttribute('aria-selected')) === 'true' ? 'anthropic' : 'openrouter'
    const inactive = active === 'anthropic' ? 'openrouter' : 'anthropic'
    await tabTo(page, modelsTab(active))
    await page.keyboard.press('ArrowLeft')
    await expect(modelsTab(inactive)).toHaveAttribute('aria-selected', 'true')
    await expect(modelsTab(inactive)).toBeFocused()
    await setup(page).getByTestId('ai-setup-title').focus()
    await page.keyboard.press('Alt+ArrowRight')
    await expect(modelsTab(active)).toHaveAttribute('aria-selected', 'true')
    await expect(setup(page).locator('.aiw__hint')).toContainText('switch provider')
  })

  test('an OpenRouter-only device (#15, #22): the MCP line names its kind of work; the cards read for plural kinds (EN + DE)', async ({ page }) => {
    await mockOpenRouter(page.context())
    await openApp(page)
    await withKeys(page, { or: true })
    await wsEval(page, (s) => s.updateSettings({ mcpServers: [{ id: 'm-archive', name: 'archive', url: 'https://archive.example.com/mcp', token: '', enabled: true, prompt: '', scope: 'free' }] }))
    await openSettingsAI(page)
    const card = page.locator('.mcps-card[data-server="archive"]')
    await card.locator('.mcps-card__toggle').click()
    const line = card.getByTestId('mcp-needs')
    await expect(line).toContainText('MCP tests & media: only with Claude for now')
    await expect(line).not.toContainText('features.ai')
    await page.keyboard.press('Escape')
    // an agent's page (a browser agent needs Claude in this version): the card reads for a plural kind of work
    await wsEval(page, (s) => s.upsertAgent({ id: 'ag-review', name: 'Project digest', icon: null, instructions: 'Summarise the status of all projects.', trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: 'none', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: true, createdAt: 1760252400000, updatedAt: 1760252400000 }))
    await page.evaluate(() => (window.location.hash = '#/agents/ag-review'))
    const needs = page.getByTestId('agx-needs')
    await expect(needs).toContainText('Agents: only with Claude for now')
    await expect(needs).toContainText('Claude only, in this version: Agents.')
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await expect(needs).toContainText('Agenten: vorerst nur mit Claude')
  })

  test('step 02 (#19): "Send a test sentence" before OpenRouter has models says so for its row — nothing sent', async ({ page }) => {
    const or = await mockOpenRouter(page.context())
    await openApp(page)
    await withKeys(page, { or: true })
    await openSetup(page, { reason: 'add', step: 'key', provider: 'openrouter' })
    await expect(setup(page).getByTestId('bench-openrouter')).toHaveAttribute('data-state', 'valid')
    await setup(page).getByTestId('test-sentence').click()
    await expect(setup(page).getByTestId('sentence-note-openrouter')).toContainText('choose its models in step 03 first — nothing was sent')
    expect(or.posts()).toHaveLength(0)
  })

  test('step 01 Remove (#20): focus on Cancel; "Also clear the rules" has an Undo that brings them back', async ({ page }) => {
    await mockOpenRouter(page.context())
    await openApp(page)
    await withKeys(page, { claude: true, or: true })
    await wsEval(page, (s, r) => s.updateSettings({ ai: { models: [r], default: [{ p: 'openrouter', m: r.m }] } }), row(LUNA))
    await openSetup(page)
    await setup(page).getByTestId('plate-openrouter-remove').click()
    await expect(setup(page).getByTestId('remove-cancel')).toBeFocused()
    await setup(page).getByTestId('remove-all').click()
    expect(await wsEval(page, (s) => s.settings.ai?.default ?? null)).toBeNull()
    const toast = page.locator('.toast', { hasText: 'OpenRouter removed from this device.' })
    await toast.getByRole('button', { name: 'Undo (rules)' }).click()
    await expect.poll(() => wsEval(page, (s) => JSON.parse(JSON.stringify(s.settings.ai?.default ?? null)))).toEqual([{ p: 'openrouter', m: LUNA }])
  })

  test('a provider that may receive nothing (#21): plates say "Ready · receives nothing yet"; step 05 warns and does not preselect it', async ({ page }) => {
    await mockOpenRouter(page.context())
    await openApp(page)
    await withKeys(page, { or: true })
    await wsEval(page, (s, r) => s.updateSettings({ ai: { models: [r], roles: { openrouter: { standard: r.m, fast: r.m } } } }), row(LUNA))
    await openSetup(page)
    await expect(setup(page).getByTestId('plate-openrouter')).toHaveAttribute('data-state', 'empty')
    await expect(setup(page).getByTestId('plate-openrouter')).toContainText('Ready · receives nothing yet')
    await page.keyboard.press('Escape')
    await expect(setup(page)).toHaveCount(0)
    await openSetup(page, { reason: 'add', step: 'routing' })
    await expect(setup(page).getByTestId('together-keep')).toHaveAttribute('aria-checked', 'true')
    await setup(page).getByTestId('together-openrouter').click()
    await expect(setup(page).getByTestId('together-writes')).toContainText('OpenRouter receives nothing yet')
    await page.keyboard.press('Escape')
    // positive control: with a preset the plate is ready
    await wsEval(page, (s, w) => s.setWorkspaceAI({ policy: { providers: { openrouter: { allow: w } }, restricted: [] } }), WORK)
    await openSettingsAI(page)
    await expect(page.getByTestId('settings-plate-openrouter')).toHaveAttribute('data-state', 'ready')
  })

  test('Settings › AI check (#23): a refused key reads the help sentence, never the bare code; a key without credit is kept', async ({ page, errors }) => {
    errors.allow(/Failed to load resource|40[12]/)
    let status: 401 | 402 = 401
    await mockOpenRouter(page.context(), { key: () => ({ status, json: { error: { code: status, message: status === 401 ? 'User not found' : 'Insufficient credits' } } }) })
    await openApp(page)
    await withKeys(page, { or: true })
    await openSettingsAI(page)
    await page.getByTestId('settings-check-openrouter').click()
    const err = page.getByTestId('settings-err-openrouter')
    await expect(err).toHaveAttribute('data-code', 'invalid_key')
    await expect(err).not.toContainText('(invalid_key)')
    await expect(err.getByTestId('settings-err-fix-openrouter')).toBeVisible()
    status = 402
    await page.getByTestId('settings-check-openrouter').click()
    await expect(err).toHaveAttribute('data-code', 'no_credit')
    await expect(err).toContainText('Connected — no credit. The key is kept')
  })

  test('step 06 (#24): MCP tests & media is one row; step 04 (#26): TypeSafe blocked has its own sentence', async ({ page }) => {
    await mockOpenRouter(page.context())
    await openApp(page)
    await withKeys(page, { claude: true, or: true })
    await wsEval(page, (s) => s.updateSettings({ ai: { routes: { 'mcp-setup': [{ p: 'anthropic', m: 'claude-haiku-4-5' }], generate: [{ p: 'anthropic', m: 'claude-haiku-4-5' }] } } }))
    await openSetup(page, { reason: 'add', step: 'done' })
    await expect(setup(page).getByTestId('done-summary').locator('li', { hasText: 'MCP tests & media' })).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(setup(page)).toHaveCount(0)
    await wsEval(page, (s, w) => s.setWorkspaceAI({ policy: { providers: { openrouter: { allow: w, upstream: { deny: ['TypeSafe'], noCollect: true, zdr: false } } }, restricted: [] } }), WORK)
    await openSetup(page, { reason: 'add', step: 'data', provider: 'openrouter' })
    await expect(setup(page).getByTestId('jev-deny-note')).toHaveText('TypeSafe blocked — the Jev Router is off with it.')
  })
})
