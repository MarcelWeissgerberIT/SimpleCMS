/**
 * MCP · Connections (#/mcp, features/mcp/connections): one page that lists every MCP connection One knows of.
 *  - entries: ⌘K "mcp" / "mcp server" (German "verbind", "mcp verbindungen", "mcp-server"), Settings → Agents · MCP and
 *    Settings → AI → MCP servers ("All connections →" on both), the keys into Settings (the add form, one server's card,
 *    the bridge, the coding worker); § 04 only in a team workspace
 *  - § 01 lights its rows by the Preflight Token lamp's rule (tokenTrouble): the red / amber rows ARE the lamp's ids
 *  - opening sends nothing, opens no sealed token (SubtleCrypto.decrypt counted), shows no token / last 4 / marker;
 *    hosts only (never a path)
 *  - Test runs the existing connection test only on a press (one request, only that server); a test that sends nothing
 *    (no copy of the token here) keeps the "refused" mark; Sign in on a red row; a URL moved in Settings drops the mark
 *  - keys whose action ends them (Retry now, Use this tab, Sign in) never leave the keyboard on the page body
 *  - § 02 the bridge's states (seeded through __oneMcp.seed), § 03 the worker's (the Preflight seam's coding store — no
 *    worker, no port): a worker that has not asked for a task yet (can null) is no "older worker"; a link down for the
 *    lamp's grace turns red as the lamp does (the page's clock fast-forwarded)
 *  - phone / German / dark: no sideways scroll (also at text sizes L and XL), 40 px keys; Tab walks the rows in order
 *    with a visible ring; reduced motion stops the testing LED
 *  - Node: the page's files never reach for a token or the network by themselves; the pure rules (incl. a team's agents:
 *    only the member's own run here)
 * Every server, agent and host here is made up (nordlicht, tessera, archiv, polar, kompass, tracker; *.example.test).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page, Route } from '@playwright/test'
import { test, expect, openApp, wsEval, uiEval, MOD } from './fixtures'
import { flushLamps, waitPreflight } from './helpers/preflightStory.mjs'
import { AUTH, MCP_URL, mockOAuth } from './helpers/oauth'
import { tokenTrouble } from '../../src/app/features/ai/mcp-servers/health'
import { agentsOfThisBrowser, ledOf, missingNamed, needsYou, serverState, teamEndpoint, workerLed, workerPlaces, hostOnly } from '../../src/app/features/mcp/connections/model'
import { workerNames } from '../../src/app/features/ai/mcp-servers/overview'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const TOKEN = 'nordlicht-e2e-PLAINTEXT-token-Qz7w'
const HOUR = 3_600_000

/** Run a function against a window seam: (seam, arg) → value. */
const seam = <R, A = null>(page: Page, name: string, fn: (s: AnyState, arg: A) => R | Promise<R>, arg?: A): Promise<R> =>
  page.evaluate(({ name, src, arg }) => new Function('s', 'arg', `return (${src})(s, arg)`)((window as unknown as Record<string, AnyState>)[name], arg), { name, src: fn.toString(), arg: (arg ?? null) as A }) as Promise<R>
const pf = <R, A = null>(page: Page, fn: (s: AnyState, arg: A) => R | Promise<R>, arg?: A) => seam(page, '__onePreflight', fn, arg)
const mcp = (page: Page, patch: AnyState) => seam(page, '__oneMcp', (m, p) => m.seed(p), patch)
const coding = (page: Page, patch: AnyState) => pf(page, (p, patch) => p.stores.coding.setState(patch), patch)

const view = (page: Page) => page.getByTestId('mcp-connections')
const row = (page: Page, name: string) => view(page).locator(`[data-row="one"][data-server="${name}"]`)
const bridgeRow = (page: Page) => page.getByTestId('mcpc-bridge-row')
const workerRow = (page: Page) => page.getByTestId('mcpc-worker-row')
const settingsDialog = (page: Page) => page.getByRole('dialog', { name: /^(Settings|Einstellungen)$/ })
const goto = (page: Page, hash: string) => page.evaluate((h) => (window.location.hash = h), hash)

async function start(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('one.tour', '{"off":true}')
    // every opened secret goes through SubtleCrypto.decrypt (lib/vault.ts): counted
    const w = window as unknown as { __decrypts: number }
    w.__decrypts = 0
    const orig = SubtleCrypto.prototype.decrypt
    SubtleCrypto.prototype.decrypt = function (this: SubtleCrypto, ...args: Parameters<SubtleCrypto['decrypt']>) {
      w.__decrypts++
      return orig.apply(this, args)
    } as SubtleCrypto['decrypt']
  })
  await openApp(page)
  await waitPreflight(page)
}

const oauthCfg = (extra: AnyState = {}) => ({ issuer: 'https://auth.example.test', authorizationEndpoint: 'https://auth.example.test/authorize', tokenEndpoint: 'https://auth.example.test/token', clientId: 'one-e2e', redirectUri: 'https://one.example.test/app/?oauth=mcp', resource: 'https://kompass.example.test/mcp', ...extra })

/** Five servers of this device: OK (a plaintext token, sealed by the store) · refused at the test · failed · off · sign-in ran out. */
async function seedServers(page: Page): Promise<void> {
  const now = Date.now()
  await wsEval(
    page,
    (s, a) => {
      s.updateSettings({
        mcpServers: [
          { id: 'srv-nord', name: 'nordlicht', codeword: 'nl', scope: 'all', url: 'https://mcp.example.com/team-7/private/mcp', token: a.token, enabled: true, prompt: 'Use list_items.', tools: ['list_items', 'get_item', 'add_comment'], checkedAt: a.now - 2 * 60_000 },
          { id: 'srv-tess', name: 'tessera', url: 'https://tessera.example.test/mcp', token: '', enabled: true, prompt: '', checkAuth: true, checkError: 'The server rejected the token.', checkedAt: a.now - 86_400_000 },
          { id: 'srv-arch', name: 'archiv', url: 'https://archiv.example.test/mcp', token: '', enabled: true, prompt: '', checkError: 'Timeout' },
          { id: 'srv-pol', name: 'polar', url: 'https://polar.example.test/mcp', token: '', enabled: false, prompt: '' },
          { id: 'srv-komp', name: 'kompass', url: 'https://kompass.example.test/mcp', token: '', enabled: true, prompt: '', checkedAt: a.now - 3 * a.hour, oauth: a.oauth },
        ],
      })
      const agent = { instructions: 'Sum up the open items.', trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: 'none', output: null, runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: true, createdAt: a.now, updatedAt: a.now }
      s.upsertAgent({ ...agent, id: 'ag-digest', name: 'Daily digest', mcpServers: ['nordlicht'], mcpTools: { nordlicht: ['list_items', 'get_item'] } })
      s.upsertAgent({ ...agent, id: 'ag-triage', name: 'Triage', mcpServers: ['nordlicht', 'tracker'] })
      s.upsertIntegration({ schema: 'one.integration/1', id: 'items', name: 'Item tracker', match: { tools: ['list_items', 'get_item'] }, unlocks: ['keys', 'upsert'] })
    },
    { token: TOKEN, now, hour: HOUR, oauth: oauthCfg({ at: now - 5 * HOUR, expiresAt: now - HOUR }) },
  )
  // the store seals the plaintext token: wait for the marker
  await expect.poll(() => wsEval(page, (s) => (s.settings.mcpServers as AnyState[]).find((x) => x.name === 'nordlicht')?.token ?? '')).toMatch(/^vault:/)
}

/** api.anthropic.com: the connection test's answer (TOOLS line), every request kept. `hold` keeps answers back until released. */
async function mockInspect(page: Page, opts: { hold?: boolean } = {}) {
  const sent: AnyState[] = []
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => (release = r))
  await page.route('https://api.anthropic.com/**', async (route: Route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (req.method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [], has_more: false, first_id: null, last_id: null }) })
    sent.push(JSON.parse(req.postData() ?? '{}'))
    if (opts.hold) await gate
    const msg = { id: 'msg_mcpc', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'TOOLS: archiv_search, archiv_get, archiv_list' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }
    try {
      await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(msg) })
    } catch {
      /* aborted */
    }
  })
  return { sent, release }
}

const tokenReading = async (page: Page): Promise<AnyState | null> => {
  await flushLamps(page)
  return pf(page, (p) => p.readings().token ?? null)
}

/* ------------------------------------------------------------------ */

test.describe('MCP · Connections (#/mcp)', () => {
  test('opens from ⌘K, Settings and its own keys; empty states; § 04 only in a team; German', async ({ page }) => {
    await start(page)
    // ⌘K "mcp": the first option, Enter → the page, its title takes the keyboard
    await page.keyboard.press(`${MOD}+k`)
    const pal = page.getByRole('dialog', { name: 'Command palette' })
    const input = pal.getByRole('combobox').or(pal.locator('input')).first()
    await expect(input).toBeFocused()
    await input.fill('mcp')
    await expect(pal.locator('[cmdk-item]').first()).toContainText('MCP · Connections — what is connected')
    await input.press('Enter')
    await expect(page).toHaveURL(/#\/mcp$/)
    const h1 = page.getByRole('heading', { level: 1, name: 'MCP · Connections' })
    await expect(h1).toBeFocused()
    await expect(page).toHaveTitle(/^MCP · Connections — /)
    // the scopes each section names
    await expect(page.getByTestId('mcpc-one-scope')).toHaveText('This device')
    await expect(page.getByTestId('mcpc-bridge-scope')).toHaveText('This tab')
    await expect(page.getByTestId('mcpc-worker-scope')).toHaveText('This browser')
    await expect(page.getByTestId('mcpc-team')).toHaveCount(0)
    await expect(view(page).locator('.mcpc__foot')).toHaveText('Opening this page sends nothing · states as One last saw them · tokens stay sealed')

    // § 01 empty: "Add a server" → Settings › AI with the add form, its URL field focused
    await expect(page.getByTestId('mcpc-one-empty')).toContainText('No MCP server for One’s Claude on this device yet.')
    await page.getByTestId('mcpc-add').click()
    const form = page.getByTestId('mcp-servers').getByRole('form', { name: 'Add server' })
    await expect(form).toBeVisible()
    await expect(form.getByLabel('Server URL')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(form).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(settingsDialog(page)).toHaveCount(0)

    // § 02 off → "Set up" opens Settings on Agents · MCP; its link plate leads back here
    await expect(bridgeRow(page)).toHaveAttribute('data-state', 'off')
    await page.getByTestId('mcpc-bridge-setup').click()
    await expect(settingsDialog(page).getByRole('tab', { name: /Agents · MCP/ })).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Escape')
    await expect(settingsDialog(page)).toHaveCount(0)
    await goto(page, '#/')
    await uiEval(page, (s) => s.openModal({ type: 'settings', tab: 'mcp' }))
    // the key reads as the help and What's new name it
    await expect(settingsDialog(page).getByTestId('mcp-tab-connections')).toHaveText('All connections')
    await settingsDialog(page).getByTestId('mcp-tab-connections').click()
    await expect(settingsDialog(page)).toHaveCount(0)
    await expect(page).toHaveURL(/#\/mcp$/)
    await expect(h1).toBeVisible()

    // § 03 off → "Coding worker" opens that tab
    await expect(workerRow(page)).toHaveAttribute('data-state', 'off')
    await page.getByTestId('mcpc-worker-settings').click()
    await expect(settingsDialog(page).getByRole('tab', { name: 'Coding worker' })).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Escape')
    await expect(settingsDialog(page)).toHaveCount(0)

    // Settings › AI › MCP servers: "All connections →"
    await goto(page, '#/')
    await uiEval(page, (s) => s.openModal({ type: 'settings', tab: 'ai' }))
    await page.getByTestId('mcp-servers-connections').click()
    await expect(settingsDialog(page)).toHaveCount(0)
    await expect(page).toHaveURL(/#\/mcp$/)

    // German: the title, and ⌘K "verbind" finds it
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await expect(page.getByRole('heading', { level: 1, name: 'MCP · Verbindungen' })).toBeVisible()
    await page.keyboard.press(`${MOD}+k`)
    const pal2 = page.getByRole('dialog', { name: /Befehlspalette|Command palette/ })
    const input2 = pal2.getByRole('combobox').or(pal2.locator('input')).first()
    await input2.fill('verbind')
    await expect(pal2.locator('[cmdk-item]', { hasText: 'MCP · Verbindungen — was verbunden ist' })).toHaveCount(1)
    // what people type: the page's own name without its "·", "mcp-server" — the page comes first among the commands
    const firstCommand = (dialog: typeof pal) => dialog.locator('[cmdk-item][data-value^="cmd:"]').first()
    for (const q of ['mcp verbindungen', 'mcp-server', 'mcp server', 'mcp übersicht', 'welche mcp']) {
      await input2.fill(q)
      await expect(pal2.locator('[cmdk-item]', { hasText: 'MCP · Verbindungen — was verbunden ist' }), q).toHaveCount(1)
      await expect(firstCommand(pal2), q).toContainText('MCP · Verbindungen')
    }
    await page.keyboard.press('Escape')
    await wsEval(page, (s) => s.updateSettings({ language: 'en' }))
    await expect(page.getByRole('heading', { level: 1, name: 'MCP · Connections' })).toBeVisible()
    await page.keyboard.press(`${MOD}+k`)
    for (const q of ['mcp server', 'mcp servers', 'mcp overview', 'connected mcp']) {
      await input.fill(q)
      await expect(pal.locator('[cmdk-item]', { hasText: 'MCP · Connections — what is connected' }), q).toHaveCount(1)
      await expect(firstCommand(pal), q).toContainText('MCP · Connections')
    }
  })

  test('§ 01 = the Token lamp: same rows, nothing sent, no token opened or shown, hosts only', async ({ page, aiNet }) => {
    await start(page)
    await seedServers(page)
    const before = { ai: aiNet.count('anthropic'), decrypts: await page.evaluate(() => (window as unknown as { __decrypts: number }).__decrypts) }
    const origin = new URL(page.url()).origin
    const foreign: string[] = []
    page.on('request', (r) => {
      const u = r.url()
      if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) foreign.push(u)
    })
    await goto(page, '#/mcp')
    await expect(row(page, 'kompass')).toBeVisible()
    await page.waitForTimeout(1000)
    expect(aiNet.count('anthropic')).toBe(before.ai)
    expect(foreign).toEqual([])
    expect(await page.evaluate(() => (window as unknown as { __decrypts: number }).__decrypts)).toBe(before.decrypts)
    const html = await page.content()
    expect(html).not.toContain(TOKEN)
    expect(html).not.toContain(TOKEN.slice(-4))
    expect(html).not.toContain('vault:')
    // hosts, never a path
    await expect(row(page, 'nordlicht').locator('.mcpc-row__host')).toHaveText('mcp.example.com')
    expect(html).not.toContain('team-7/private')

    // states and levels
    const states = { nordlicht: 'ok', tessera: 'refusedTest', archiv: 'failed', polar: 'off', kompass: 'expired' }
    for (const [name, st] of Object.entries(states)) await expect(row(page, name)).toHaveAttribute('data-state', st)
    await expect(row(page, 'tessera')).toHaveAttribute('data-level', 'red')
    await expect(row(page, 'kompass')).toHaveAttribute('data-level', 'red')
    await expect(row(page, 'archiv')).toHaveAttribute('data-level', 'amber')
    await expect(row(page, 'nordlicht')).not.toHaveAttribute('data-level', /.+/)
    await expect(row(page, 'tessera').getByTestId('mcpc-word')).toHaveText('Token refused')
    await expect(row(page, 'kompass').getByTestId('mcpc-word')).toHaveText('Sign-in ran out')
    await expect(row(page, 'archiv').getByTestId('mcpc-why')).toHaveText('Last test: Timeout')
    await expect(row(page, 'polar').getByTestId('mcpc-why')).toHaveText('Switched off: not used — not even through its codeword')
    // the words say the rule the requests follow (attachMcp leaves out only what this tab saw refused)
    await expect(row(page, 'tessera').getByTestId('mcpc-why')).toHaveText('The server turned its token down at the last test. Requests still try it: in each tab its first refusal leaves it out of requests that don’t name it by codeword. Sign in again or replace the token.')
    // the readout counts what works, not what is switched on
    await expect(page.getByTestId('mcpc-ro-one')).toHaveText('1 of 4 OK · 1 off')

    // the red / amber rows are exactly the lamp's ids; NEEDS YOU says its count
    const lit = async () => (await view(page).locator('[data-row="one"][data-level]').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')))).sort()
    const r1 = await tokenReading(page)
    expect(r1).toMatchObject({ count: 3, level: 'red' })
    expect((r1!.ids as string[]).map((id) => /^mcp:([^@]+)@/.exec(id)![1]).sort()).toEqual(await lit())
    await expect(page.getByTestId('mcpc-needs-count')).toHaveText('3')
    // refused in this tab: nordlicht turns red live, the lamp counts it too
    await pf(page, (p) => p.refuse('nordlicht'))
    await expect(row(page, 'nordlicht')).toHaveAttribute('data-state', 'refusedTab')
    await expect(row(page, 'nordlicht')).toHaveAttribute('data-level', 'red')
    await expect(row(page, 'nordlicht').getByTestId('mcpc-why')).toHaveText('The server turned its token down in this tab. This tab leaves it out of requests that don’t name it by codeword — until you sign in again, replace the token or a test passes.')
    const r2 = await tokenReading(page)
    expect(r2).toMatchObject({ count: 4 })
    expect((r2!.ids as string[]).map((id) => /^mcp:([^@]+)@/.exec(id)![1]).sort()).toEqual(await lit())
    await expect(page.getByTestId('mcpc-needs-count')).toHaveText('4')

    // facts: scope, codeword, access, agents (with their tool count), the integration; the agent's missing server
    const n = row(page, 'nordlicht')
    await expect(n.locator('[data-fact="one"]')).toContainText('Every AI call')
    await expect(n.locator('[data-fact="codeword"]')).toContainText('nl:')
    // a marker is all the page knows: no claim that this browser holds the copy
    await expect(n.getByTestId('mcpc-access')).toHaveText('AccessToken set')
    // a sign-in that ran out says so where ACCESS is too
    await expect(row(page, 'kompass').getByTestId('mcpc-access')).toHaveText(/^AccessSign-in ran out · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    await expect(n.locator('[data-fact="agents"]')).toContainText('Daily digest2 tools')
    await expect(n.locator('[data-fact="agents"]')).toContainText('Triage')
    await expect(n.locator('[data-fact="integrations"]')).toContainText('Item tracker')
    await expect(n.locator('[data-fact="code"]')).toContainText('Worker not connected')
    await expect(row(page, 'tessera').getByTestId('mcpc-access')).toContainText('No token')
    await expect(page.getByTestId('mcpc-missing')).toHaveText('Named by agents, not set up on this device: tracker (Triage) — their runs leave it out.')
    // two servers missing: "them"
    await wsEval(page, (s) => s.upsertAgent({ ...s.agents['ag-triage'], mcpServers: ['nordlicht', 'tracker', 'kurier'] }))
    await expect(page.getByTestId('mcpc-missing')).toHaveText('Named by agents, not set up on this device: kurier (Triage) · tracker (Triage) — their runs leave them out.')
    // no AI key here: no Test key, nothing to press
    await expect(view(page).getByTestId('mcpc-test')).toHaveCount(0)
    expect(aiNet.count('anthropic')).toBe(before.ai)
  })

  test('Test runs only on a press: one request with only that server, the row and the lamp follow, reduced motion stills the LED', async ({ page, aiNet }) => {
    await start(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    const api = await mockInspect(page, { hold: true })
    await seedServers(page)
    await goto(page, '#/mcp')
    await expect(row(page, 'archiv')).toHaveAttribute('data-state', 'failed')
    await page.waitForTimeout(800)
    expect(api.sent).toHaveLength(0)
    expect(aiNet.count('anthropic')).toBe(0)
    const before = (await tokenReading(page))!.count as number

    const key = row(page, 'archiv').getByTestId('mcpc-test')
    await expect(key).toHaveAccessibleName('Test the connection to archiv')
    await key.focus()
    await page.keyboard.press('Enter')
    await expect(row(page, 'archiv')).toHaveAttribute('data-testing', 'true')
    await expect(key).toHaveAttribute('aria-disabled', 'true')
    await expect(key).toBeFocused()
    await expect(row(page, 'archiv').getByTestId('mcpc-word')).toHaveText('Testing…')
    // the LED keeps its colour and blinks …
    const led = row(page, 'archiv').locator('.mcpc-led')
    await expect(led).toHaveClass(/mcpc-led--amber/)
    expect(await led.evaluate((el) => getComputedStyle(el).animationName)).toBe('mcpc-blink')
    // … not under reduced motion
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(await led.evaluate((el) => el.getAnimations().length)).toBe(0)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    // a second press while it runs sends nothing more (aria-disabled: still focusable, still pressable — and inert)
    await page.keyboard.press('Enter')
    await key.dispatchEvent('click')
    await expect.poll(() => api.sent.length).toBe(1)
    api.release()

    await expect(row(page, 'archiv')).toHaveAttribute('data-state', 'ok')
    await expect(row(page, 'archiv')).not.toHaveAttribute('data-level', /.+/)
    await expect(row(page, 'archiv').getByTestId('mcpc-why')).toContainText('· 3 tools')
    await expect(page.getByTestId('mcpc-live')).toHaveText('archiv: the connection works.')
    await expect(key).toBeFocused()
    await expect(key).toHaveText('Test')
    expect((await tokenReading(page))!.count).toBe(before - 1)
    expect(api.sent).toHaveLength(1)
    expect((api.sent[0]!.mcp_servers as AnyState[]).map((s) => s.name)).toEqual(['archiv'])

    // without a key: no Test key — the setup line instead
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: '' }))
    await expect(view(page).getByTestId('mcpc-test')).toHaveCount(0)
    await wsEval(page, (s) => s.updateSettings({ mcpServers: [{ id: 'srv-new', name: 'nordlicht', url: 'https://mcp.example.com/mcp', token: '', enabled: true, prompt: '' }] }))
    await expect(row(page, 'nordlicht')).toHaveAttribute('data-state', 'untested')
    await expect(row(page, 'nordlicht').getByTestId('mcpc-needs-row')).toBeVisible()
    expect(api.sent).toHaveLength(1)
  })

  test('a test that sends nothing keeps the refused mark; an address moved in Settings drops it (and this tab’s note)', async ({ page }) => {
    await start(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    const api = await mockInspect(page)
    // a marker whose copy this browser does not hold (site data partly cleared, another device's settings)
    await wsEval(page, (s) =>
      s.updateSettings({ mcpServers: [{ id: 'srv-tess', name: 'tessera', url: 'https://tessera.example.test/mcp', token: 'vault:0123456789ab:Zq9x', enabled: true, prompt: 'Use it.', checkAuth: true, checkError: 'The server rejected the token.', checkedAt: Date.now() - 86_400_000 }] }),
    )
    await goto(page, '#/mcp')
    const r = row(page, 'tessera')
    await expect(r).toHaveAttribute('data-state', 'refusedTest')
    await expect(r.getByTestId('mcpc-access')).toHaveText('AccessToken set')
    await r.getByTestId('mcpc-test').click()
    // the check ends before anything is sent: its reason is noted, the refused mark stays (and with it Sign in)
    await expect.poll(() => wsEval(page, (s) => (s.settings.mcpServers as AnyState[])[0]?.checkError ?? '')).toContain('not available in this browser')
    await expect(r).not.toHaveAttribute('data-testing', /.+/)
    expect(await wsEval(page, (s) => (s.settings.mcpServers as AnyState[])[0]?.checkAuth)).toBe(true)
    await expect(r).toHaveAttribute('data-state', 'refusedTest')
    await expect(r.getByTestId('mcpc-signin')).toBeVisible()
    expect(api.sent).toHaveLength(0)

    // no key: a new address in Settings — the old test, its refused mark and this tab's note go with the old address
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: '' }))
    await pf(page, (p) => p.refuse('tessera'))
    await r.getByTestId('mcpc-settings').click()
    const card = page.locator('.mcps-card[data-id="srv-tess"]')
    await expect(card).toHaveAttribute('data-open', 'true')
    const url = card.getByLabel('Server URL')
    await url.fill('https://tessera-neu.example.test/mcp')
    await url.press('Enter')
    await expect.poll(() => wsEval(page, (s) => (s.settings.mcpServers as AnyState[])[0]?.url)).toBe('https://tessera-neu.example.test/mcp')
    expect(await wsEval(page, (s) => (s.settings.mcpServers as AnyState[])[0]?.checkAuth ?? null)).toBeNull()
    // (Settings opens this browser's vault: no copy here, it says "Token missing" — the page never asks the vault)
    await expect(card.getByTestId('mcp-status')).toContainText('Token missing')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(settingsDialog(page)).toHaveCount(0)
    await expect(r).toHaveAttribute('data-state', 'untested')
    await expect(r.locator('.mcpc-row__host')).toHaveText('tessera-neu.example.test')
    expect((await tokenReading(page))?.count ?? 0).toBe(0)
  })

  test('Sign in on a red row: the sign-in runs from the page, the row turns OK and says so', async ({ page, context, errors }) => {
    // the mocked MCP server answers 401 until a token exists (its sign-in reads the metadata from there)
    errors.allow(/401/)
    await start(page)
    await mockOAuth(context)
    await wsEval(
      page,
      (s, a) =>
        s.updateSettings({
          mcpServers: [{ id: 'srv-tess', name: 'tessera', url: a.url, token: '', enabled: true, prompt: '', checkedAt: Date.now() - 86_400_000, checkAuth: true, checkError: 'The server rejected the token.', oauth: { issuer: a.auth, authorizationEndpoint: `${a.auth}/authorize`, tokenEndpoint: `${a.auth}/token`, clientId: 'one-e2e-client', redirectUri: `${location.origin}${location.pathname}?oauth=mcp`, resource: a.url } }],
        }),
      { url: MCP_URL, auth: AUTH },
    )
    await goto(page, '#/mcp')
    await expect(row(page, 'tessera')).toHaveAttribute('data-level', 'red')
    const popupP = context.waitForEvent('page')
    // by keyboard: the key keeps the keyboard while the sign-in runs (aria-disabled, never disabled)
    const key = row(page, 'tessera').getByTestId('mcpc-signin')
    await key.focus()
    await page.keyboard.press('Enter')
    const popup = await popupP
    // (a sign-in that already came back has no key left to look at)
    const busy = await key.evaluate((el) => ({ disabled: (el as HTMLButtonElement).disabled, focused: el === document.activeElement }), undefined, { timeout: 1000 }).catch(() => null)
    if (busy) expect(busy).toEqual({ disabled: false, focused: true })
    errors.watch(popup)
    await popup.waitForEvent('close', { timeout: 20_000 })
    await expect(row(page, 'tessera')).toHaveAttribute('data-state', 'ok', { timeout: 15_000 })
    await expect(row(page, 'tessera')).not.toHaveAttribute('data-level', /.+/)
    await expect(row(page, 'tessera').getByTestId('mcpc-access')).toContainText(/Signed in · Renews \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    await expect(page.getByTestId('mcpc-live')).toHaveText('tessera: signed in.')
    await expect(row(page, 'tessera').getByTestId('mcpc-signin')).toHaveCount(0)
    // the key went with the red: the keyboard is on the row's Settings ↗ key, never on the page body
    await expect.poll(() => row(page, 'tessera').getByTestId('mcpc-settings').evaluate((el) => el === document.activeElement)).toBe(true)
  })

  test('Settings ↗ lands on that server: its card open, its toggle focused', async ({ page }) => {
    await start(page)
    await seedServers(page)
    await goto(page, '#/mcp')
    const key = row(page, 'tessera').getByTestId('mcpc-settings')
    await expect(key).toHaveAccessibleName('Open tessera in Settings')
    await key.click()
    const card = page.locator('.mcps-card[data-id="srv-tess"]')
    await expect(card).toHaveAttribute('data-open', 'true')
    await expect(card.locator('.mcps-card__toggle')).toBeFocused()
    await expect(page.locator('.mcps-card[data-open]')).toHaveCount(1)
  })

  test('openMcpConnections({ server, focus: "test" }) lands on that row’s Test key, in view (the Patchbay’s lamp 02) — it runs no test', async ({ page, aiNet }) => {
    await start(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    const api = await mockInspect(page)
    await seedServers(page)
    // from another route, with the keyboard on something there (the lamp's key in the Patchbay)
    await goto(page, '#/agents')
    await page.locator('.agx').first().waitFor()
    // the opener is the patchbay's (window.__onePatchbaySetup.openMcp = openMcpConnections, DEV / ?e2e)
    await page.evaluate(() => (window as unknown as { __onePatchbaySetup: { openMcp: (o: unknown) => void } }).__onePatchbaySetup.openMcp({ server: 'srv-arch', focus: 'test' }))
    await expect(page).toHaveURL(/#\/mcp$/)
    const key = row(page, 'archiv').getByTestId('mcpc-test')
    await expect(key).toBeFocused()
    await expect(key).toBeInViewport()
    await page.waitForTimeout(500)
    expect(api.sent).toHaveLength(0)
    expect(aiNet.count('anthropic')).toBe(0)
    await expect(row(page, 'archiv')).not.toHaveAttribute('data-testing', /.+/)
    // without `focus`: the row's first key; an unknown server: the page's own title as before
    await goto(page, '#/agents')
    await page.locator('.agx').first().waitFor()
    await page.evaluate(() => (window as unknown as { __onePatchbaySetup: { openMcp: (o: unknown) => void } }).__onePatchbaySetup.openMcp({ server: 'srv-nord' }))
    await expect(row(page, 'nordlicht').getByTestId('mcpc-test')).toBeFocused()
    await goto(page, '#/agents')
    await page.locator('.agx').first().waitFor()
    await page.evaluate(() => (window as unknown as { __onePatchbaySetup: { openMcp: (o: unknown) => void } }).__onePatchbaySetup.openMcp({ server: 'srv-gone', focus: 'test' }))
    await expect(page.locator('.mcpc__title')).toBeFocused()
  })

  test('§ 02 the bridge: off · waiting · blocked · other tab · connected with peers and an older bridge', async ({ page }) => {
    await start(page)
    await goto(page, '#/mcp')
    const r = bridgeRow(page)
    await expect(r).toHaveAttribute('data-state', 'off')
    await expect(r.getByTestId('mcpc-word')).toHaveText('Off')
    await expect(r.locator('.mcpc-row__host')).toHaveText('127.0.0.1:47321')

    await mcp(page, { enabled: true, conn: 'waiting', prompt: false })
    await expect(r).toHaveAttribute('data-state', 'waiting')
    await expect(r.locator('[data-note="waiting"]')).toContainText('No bridge answers yet.')
    await expect(r.getByTestId('mcpc-bridge-retry')).toBeVisible()
    await expect(r.getByTestId('mcpc-bridge-settings')).toBeVisible()

    await mcp(page, { conn: 'blocked', blocked: 'permission' })
    await expect(r.getByTestId('mcpc-word')).toHaveText('Blocked')
    await expect(r.locator('[data-note="blocked"]')).toBeVisible()
    await expect(r.getByTestId('mcpc-bridge-retry')).toBeVisible()

    await mcp(page, { conn: 'replaced', blocked: null })
    await expect(r.getByTestId('mcpc-bridge-here')).toHaveText('Use this tab')
    await expect(r.getByTestId('mcpc-bridge-retry')).toHaveCount(0)

    await mcp(page, { conn: 'connected', client: { name: 'claude-code', version: '2' }, calls: 0, legacy: true, peers: [{ name: 'Notes', kind: 'team' }], bridge: '1.8.0', session: 's-e2e' })
    await expect(r.getByTestId('mcpc-why')).toHaveText('Connected · Claude Code · 0 calls')
    await expect(r.locator('.mcpc-led')).toHaveClass(/led--ok/)
    await expect(r.getByTestId('mcpc-bridge-client')).toContainText('Claude Code')
    await expect(r.getByTestId('mcpc-bridge-mode')).toContainText('Ask first')
    await expect(r.locator('[data-fact="codeword"]')).toContainText('one:')
    await expect(r.locator('[data-note="peers"]')).toContainText('“Notes” (team)')
    await expect(r.locator('[data-note="legacy"]')).toBeVisible()
    await expect(page.getByTestId('mcpc-readout').locator('[data-cell="bridge"]')).toContainText('Connected · Claude Code')
  })

  test('§ 02 keys whose action ends them keep the keyboard: Use this tab / Retry now → Connecting… → the row’s Settings ↗', async ({ page }) => {
    // the bridge's address answers here (no real bridge, nothing logged): a socket opens and waits — until closed
    const sockets: Array<{ close: () => Promise<void> }> = []
    await page.routeWebSocket(/^ws:\/\/127\.0\.0\.1:47321/, (ws) => {
      sockets.push(ws)
    })
    await start(page)
    await goto(page, '#/mcp')
    const r = bridgeRow(page)
    const focused = (testId: string) => expect.poll(() => r.getByTestId(testId).evaluate((el) => el === document.activeElement).catch(() => false)).toBe(true)
    await mcp(page, { enabled: true, conn: 'replaced' })
    await r.getByTestId('mcpc-bridge-here').focus()
    await page.keyboard.press('Enter')
    // connecting: the same key says so, aria-disabled, and keeps the keyboard
    await focused('mcpc-bridge-connecting')
    await expect(r.getByTestId('mcpc-bridge-connecting')).toHaveAttribute('aria-disabled', 'true')
    await expect.poll(() => sockets.length).toBeGreaterThan(0)
    // the bridge goes away: waiting — Retry now, still the same key
    await sockets.at(-1)!.close()
    await expect(r).toHaveAttribute('data-state', 'waiting')
    await focused('mcpc-bridge-retry')
    for (const ms of [50, 300]) {
      await page.waitForTimeout(ms)
      expect(await page.evaluate(() => document.activeElement?.closest('[data-testid="mcpc-bridge-row"]') !== null)).toBe(true)
    }
    await page.keyboard.press('Enter')
    await focused('mcpc-bridge-connecting')
    // connected: the key is gone — the keyboard goes to the row's Settings ↗, never to the page body
    await mcp(page, { conn: 'connected', client: { name: 'claude-code', version: '2' } })
    await focused('mcpc-bridge-settings')
    await mcp(page, { enabled: false, conn: 'off' })
  })

  test('§ 03 the worker: names per place with ALSO ONE’S · an older worker · refused · off', async ({ page }) => {
    await start(page)
    await wsEval(page, (s) => s.updateSettings({ mcpServers: [{ id: 'srv-nord', name: 'nordlicht', url: 'https://mcp.example.com/mcp', token: '', enabled: true, prompt: '', checkedAt: Date.now() }] }))
    await goto(page, '#/mcp')
    const r = workerRow(page)
    const info = { worker: '1.9.0', name: 'studio-mac', repos: [{ name: 'website', baseBranch: 'main', mcp: ['nordlicht', 'notizen'] }], mcp: ['notizen'], parallel: 1, busy: [], spentToday: 0, dayLimit: null, claude: { found: true, version: '2.1' } }
    await coding(page, { enabled: true, conn: 'connected', worker: info, can: ['analyze', 'git:comment', 'git:merge', 'doc', 'model', 'mcp-list', 'ship'] })
    await expect(r.locator('.mcpc-row__name')).toHaveText('STUDIO-MAC')
    await expect(r.locator('.mcpc-row__host')).toHaveText('worker 1.9.0')
    await expect(r.locator('.mcpc-led')).toHaveClass(/led--ok/)
    const places = r.getByTestId('mcpc-worker-places')
    await expect(places.locator('[data-repo="website"]')).toContainText('nordlichtalso One’s')
    await expect(places.locator('[data-repo="website"]')).toContainText('notizen')
    await expect(places.locator('[data-repo=""]')).toContainText('tasks without a repo')
    await expect(places.locator('[data-repo=""]')).not.toContainText('also One’s')
    await expect(r.getByTestId('mcpc-worker-tools')).toContainText('one_task_read · one_task_note · one_task_ask')
    // § 01 sees the same: nordlicht's Claude Code fact names the repo
    await expect(row(page, 'nordlicht').locator('[data-fact="code"]')).toContainText('website')
    await expect(page.getByTestId('mcpc-readout').locator('[data-cell="worker"]')).toContainText('Connected · 1 repo')

    // connected, not asked for a task yet (can null — every slot busy): no "older worker"; its info names the servers
    await coding(page, { worker: info, can: null })
    await expect(r.locator('.mcpc-led')).toHaveClass(/led--ok/)
    await expect(r.getByTestId('mcpc-worker-old')).toHaveCount(0)
    await expect(places.locator('[data-repo="website"]')).toContainText('nordlichtalso One’s')
    await expect(row(page, 'nordlicht').locator('[data-fact="code"]')).toContainText('website')
    // … and one whose info names none: not known yet, never "download it again"
    await coding(page, { worker: { ...info, repos: [{ name: 'website', baseBranch: 'main' }], mcp: undefined }, can: null })
    await expect(r.getByTestId('mcpc-worker-unknown')).toHaveText('Not named yet — the worker says when it next asks for a task')
    await expect(r.getByTestId('mcpc-worker-old')).toHaveCount(0)
    await expect(row(page, 'nordlicht').locator('[data-fact="code"] dd')).toHaveText('Not named yet — the worker says when it next asks for a task')
    await expect(r).not.toHaveAttribute('data-level', /.+/)

    // older than the ZIP import (no ZIP gap) and naming no capability: it names no servers. The test browser says it runs
    // on Windows (Playwright's Desktop Chrome), where a worker older than 1.9.0 is the Windows gap — the lamp's order:
    // that word wins over "outdated", with the Windows sentence
    await coding(page, { worker: { ...info, worker: '1.2.0' }, can: [] })
    await expect(r.getByTestId('mcpc-worker-old')).toHaveText('Worker too old to tell — download it again')
    await expect(r).toHaveAttribute('data-level', 'amber')
    await expect(r.getByTestId('mcpc-word')).toHaveText('security gap')
    await expect(r).toContainText('On Windows, this worker (1.2.0) can start a program named git.exe')

    await coding(page, { conn: 'refused', refused: 'pair', worker: null, can: null })
    await expect(r).toHaveAttribute('data-level', 'red')
    // red at once, with the time it went down — the lamp's own clock
    await expect(r.getByTestId('mcpc-word')).toHaveText('Refused')
    await expect(r).toContainText('an older download is running')
    await expect(r.getByTestId('mcpc-worker-since')).toHaveText(/^Not connected since \d{2}:\d{2}\.$/)
    await expect(r.getByTestId('mcpc-worker-tools')).toHaveCount(0)

    await coding(page, { enabled: false, conn: 'off', refused: null })
    await expect(r).toHaveAttribute('data-state', 'off')
    await expect(r).not.toHaveAttribute('data-level', /.+/)
  })

  test('§ 03 a link down for the Worker lamp’s grace turns red when the lamp does, and says since when', async ({ page }) => {
    await page.clock.install()
    await start(page)
    await goto(page, '#/mcp')
    const r = workerRow(page)
    const info = { worker: '1.9.0', name: 'studio-mac', repos: [], parallel: 1, busy: [], spentToday: 0, dayLimit: null, claude: { found: true, version: '2.1' } }
    await coding(page, { enabled: true, conn: 'connected', worker: info, can: ['analyze', 'git:comment', 'git:merge', 'doc', 'model', 'mcp-list', 'ship'] })
    await expect(r.locator('.mcpc-led')).toHaveClass(/led--ok/)
    await coding(page, { conn: 'waiting', worker: null, can: null })
    // inside the grace: on, no tone — the lamp counts nothing yet
    await expect(r).toHaveAttribute('data-state', 'waiting')
    await expect(r.locator('.mcpc-led')).toHaveClass(/led--on/)
    await expect(r).not.toHaveAttribute('data-level', /.+/)
    await expect(r.getByTestId('mcpc-worker-since')).toHaveCount(0)
    await page.clock.fastForward(61_000)
    await expect(r).toHaveAttribute('data-level', 'red')
    await expect(r.getByTestId('mcpc-word')).toHaveText('Waiting')
    // down: why, as the Preflight worker card says it
    await expect(r).toContainText('The worker does not answer — is it running in a terminal?')
    await expect(r.getByTestId('mcpc-worker-since')).toHaveText(/^Not connected since \d{2}:\d{2}\.$/)
    await expect(page.getByTestId('mcpc-readout').locator('[data-cell="worker"] .mcpc-led')).toHaveClass(/mcpc-led--red/)
    // the lamp says the same
    await flushLamps(page)
    const lamp = await pf(page, (p) => p.readings().worker ?? null)
    expect(lamp).toMatchObject({ count: 1, level: 'red', ids: ['worker:waiting'] })
    // back: ok again
    await coding(page, { conn: 'connected', worker: info, can: ['analyze', 'git:comment', 'git:merge', 'doc', 'model', 'mcp-list', 'ship'] })
    await expect(r).not.toHaveAttribute('data-level', /.+/)
  })

  test('phone, German, dark: no sideways scroll, 40 px keys; Tab walks the rows in order with a visible ring', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await start(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de', theme: 'dark', aiApiKey: 'sk-ant-e2e-test-key' }))
    await mockInspect(page)
    await seedServers(page)
    await mcp(page, { enabled: true, conn: 'waiting' })
    await goto(page, '#/mcp')
    await expect(page.getByRole('heading', { level: 1, name: 'MCP · Verbindungen' })).toBeVisible()
    await expect(row(page, 'tessera').getByTestId('mcpc-word')).toHaveText('Token abgelehnt')
    await expect(page.getByTestId('mcpc-one-scope')).toHaveText('Dieses Gerät')
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark')
    const over = await view(page).evaluate((el) => {
      const scrollers = [el, document.scrollingElement!, ...Array.from(document.querySelectorAll<HTMLElement>('#main, .app-main, .stage-col'))]
      return Math.max(...scrollers.map((s) => s.scrollWidth - s.clientWidth))
    })
    expect(over).toBeLessThanOrEqual(1)
    // the larger text sizes (L, XL): the title ("Verbindungen" is one word) still fits the column
    for (const step of [16 / 14, 17 / 14]) {
      await page.evaluate((v) => document.documentElement.style.setProperty('--text-scale', String(v)), step)
      const fit = await view(page).evaluate((el) => {
        const scrollers = [el, document.scrollingElement!, ...Array.from(document.querySelectorAll<HTMLElement>('#main, .app-main, .stage-col'))]
        const h1 = el.querySelector('h1')!.getBoundingClientRect()
        return { over: Math.max(...scrollers.map((s) => s.scrollWidth - s.clientWidth)), right: h1.right, width: window.innerWidth }
      })
      expect(fit.over, `text scale ${step}`).toBeLessThanOrEqual(1)
      expect(fit.right, `text scale ${step}`).toBeLessThanOrEqual(fit.width - 15)
    }
    await page.evaluate(() => document.documentElement.style.removeProperty('--text-scale'))
    const heights = await view(page).locator('.mcpc-row__keys .btn').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))
    expect(heights.length).toBeGreaterThan(4)
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(40)

    // keyboard: from the title, Tab walks the keys row by row (never back up), each with a visible ring
    await page.getByRole('heading', { level: 1 }).focus()
    const seen: number[] = []
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press('Tab')
      const at = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null
        const rowEl = a?.closest('.mcpc-row')
        if (!a || !rowEl) return null
        const rows = Array.from(document.querySelectorAll('.mcpc-row'))
        const cs = getComputedStyle(a)
        return { row: rows.indexOf(rowEl), ring: cs.boxShadow !== 'none' || (cs.outlineStyle !== 'none' && cs.outlineWidth !== '0px') }
      })
      if (!at) continue
      expect(at.ring).toBe(true)
      seen.push(at.row)
    }
    expect(seen.length).toBeGreaterThan(5)
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
  })
})

/* ------------------------------------------------------------------ */
/* Node: the source guard and the pure rules                           */
/* ------------------------------------------------------------------ */

test.describe('MCP · Connections — source guard and rules (Node)', () => {
  test('the page reaches for no token and no network by itself, and names no service', () => {
    const dir = fileURLToPath(new URL('../../src/app/features/mcp/connections', import.meta.url))
    const files = readdirSync(dir).filter((f) => /\.(ts|tsx|css)$/.test(f))
    expect(files.length).toBeGreaterThanOrEqual(10)
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8')
      for (const bad of ['getMcpToken', 'tokenState', 'tokenFor', 'attachMcp', 'openSecret', 'markerHint', 'fetch(', 'cloudRequest', 'listApiTokens']) expect(src, `${f}: ${bad}`).not.toContain(bad)
      // the one connection test is the Test key's (OneSection); the runtime is read only by its key (TeamSection)
      if (f !== 'OneSection.tsx') expect(src, `${f}: checkServer`).not.toContain('checkServer(')
      if (f !== 'TeamSection.tsx') expect(src, `${f}: loadRuntime`).not.toContain('loadRuntime(')
      expect(src, `${f}: a named service`).not.toMatch(/\batlas\b|linear\.app|notion\.so|github\.com|gitlab\.com|slack\.com/i)
    }
    // the connection test sits inside the key's handler, never in an effect
    const one = readFileSync(join(dir, 'OneSection.tsx'), 'utf8')
    expect(one.match(/checkServer\(/g)).toHaveLength(1)
    expect(one).toMatch(/const test = \(\) => \{[\s\S]*?checkServer\(s\.id, 'test'\)/)
    const team = readFileSync(join(dir, 'TeamSection.tsx'), 'utf8')
    expect(team).toMatch(/onClick=\{reading \? undefined : \(\) => void loadRuntime\(\)\}/)
  })

  test('tokenTrouble: each branch, in order', () => {
    const now = 1_000_000
    const s = (x: AnyState = {}) => ({ checkAuth: undefined, checkError: undefined, oauth: undefined, ...x }) as Parameters<typeof tokenTrouble>[0]
    expect(tokenTrouble(s(), now, false)).toBeNull()
    expect(tokenTrouble(s({ checkAuth: true, checkError: 'x' }), now, true)).toEqual({ level: 'red', why: 'refusedTest' })
    expect(tokenTrouble(s({ checkError: 'x' }), now, true)).toEqual({ level: 'red', why: 'refusedTab' })
    expect(tokenTrouble(s({ checkError: 'x', oauth: { expiresAt: now - 1 } }), now, false)).toEqual({ level: 'red', why: 'expired' })
    expect(tokenTrouble(s({ checkError: 'x', oauth: { expiresAt: now - 1, refresh: true } }), now, false)).toEqual({ level: 'amber', why: 'failed' })
    expect(tokenTrouble(s({ oauth: { expiresAt: now + 1 } }), now, false)).toBeNull()
  })

  test('serverState, ledOf, needsYou', () => {
    const now = 1_000_000
    const base = { enabled: true, checkAuth: undefined, checkError: undefined, checkedAt: undefined, oauth: undefined } as AnyState
    expect(serverState({ ...base, enabled: false, checkAuth: true } as never, now, true)).toBe('off')
    expect(serverState(base as never, now, false)).toBe('untested')
    expect(serverState({ ...base, checkedAt: 5 } as never, now, false)).toBe('ok')
    expect(serverState({ ...base, checkedAt: 5 } as never, now, true)).toBe('refusedTab')
    expect(serverState({ ...base, checkError: 'Timeout' } as never, now, false)).toBe('failed')
    expect(['off', 'untested', 'ok', 'refusedTest', 'refusedTab', 'expired', 'failed'].map((s) => ledOf(s as never))).toEqual(['off', 'off', 'ok', 'red', 'red', 'red', 'amber'])
    const list = [{ ...base, checkAuth: true }, { ...base, enabled: false, checkAuth: true }, { ...base, checkError: 'x' }, { ...base, checkedAt: 1 }] as never[]
    expect(needsYou(list, now, () => false)).toBe(2)
  })

  test('workerLed, workerPlaces, workerNames, agentsOfThisBrowser, missingNamed, teamEndpoint, hostOnly', () => {
    const all = ['analyze', 'git:comment', 'git:merge', 'doc', 'model', 'mcp-list', 'ship']
    const now = 10_000_000
    const led = (s: AnyState, since: number | null = now) => workerLed({ worker: null, can: null, ...s } as never, since, now)
    expect(led({ enabled: false, conn: 'connected', can: all })).toBe('off')
    expect(led({ enabled: true, conn: 'connected', worker: { worker: '1.9.0' }, can: all })).toBe('ok')
    expect(led({ enabled: true, conn: 'connected', worker: { worker: '1.8.0' }, can: all })).toBe('amber')
    expect(led({ enabled: true, conn: 'connected', worker: { worker: '1.9.0' }, can: ['doc'] })).toBe('amber')
    // older than 1.9.0 on this Windows computer (coding workerOldHere — the caller reads the browser): amber, as the lamp
    expect(led({ enabled: true, conn: 'connected', worker: { worker: '1.8.1' }, can: all, oldHere: true })).toBe('amber')
    // not asked for a task yet: no "older worker"
    expect(led({ enabled: true, conn: 'connected', worker: { worker: '1.9.0' }, can: null })).toBe('ok')
    for (const conn of ['refused', 'blocked', 'replaced']) expect(led({ enabled: true, conn })).toBe('red')
    // the lamp's grace: on / off inside it, red once it has passed (the same rule as preflight/sources/workerRule.ts)
    for (const conn of ['connecting', 'waiting']) {
      expect(led({ enabled: true, conn })).toBe('on')
      expect(led({ enabled: true, conn }, now - 59_999)).toBe('on')
      expect(led({ enabled: true, conn }, now - 60_000)).toBe('red')
    }
    expect(led({ enabled: true, conn: 'off' })).toBe('off')
    expect(led({ enabled: true, conn: 'off' }, now - 61_000)).toBe('red')
    expect(led({ enabled: false, conn: 'off' }, now - 61_000)).toBe('off')

    expect(workerPlaces(null, all)).toEqual({ kind: 'none' })
    const w = { repos: [{ name: 'website', baseBranch: 'main', mcp: ['nordlicht'] }, { name: 'shop', baseBranch: 'main' }], mcp: ['notizen'] }
    expect(workerPlaces(w, ['doc'])).toEqual({ kind: 'old' })
    expect(workerPlaces(w, all)).toEqual({ kind: 'named', places: [{ repo: 'website', names: ['nordlicht'] }, { repo: null, names: ['notizen'] }] })
    // can not known yet: the info says it (lists sent → named), else not known — never "old"
    expect(workerPlaces(w, null)).toEqual(workerPlaces(w, all))
    expect(workerPlaces({ repos: [{ name: 'website', baseBranch: 'main' }] }, null)).toEqual({ kind: 'unknown' })
    expect(workerNames({ repos: [] }, null)).toBeNull()
    expect(workerNames({ repos: [], mcp: [] }, null)).toBe(true)
    expect(workerNames({ repos: [], mcp: ['x'] }, ['doc'])).toBe(false)

    const agent = (name: string, servers: string[], extra: AnyState = {}) => ({ name, runner: 'browser', enabled: true, mcpServers: servers, ...extra }) as never
    expect(missingNamed([agent('Triage', ['nordlicht', 'tracker']), agent('Night', ['tracker'], { runner: 'server' }), agent('Old', ['polar'], { enabled: false }), agent('Audit', ['tracker'])], [{ name: 'nordlicht' }])).toEqual([{ name: 'tracker', agents: ['Audit', 'Triage'] }])
    // whose runs happen here: locally every browser agent; in a team the member's own, not one another member saved last
    const team = [agent('Mine', [], { createdBy: 'u-ada', updatedBy: 'u-ada' }), agent('Bo’s', [], { createdBy: 'u-bo', updatedBy: 'u-bo' }), agent('Edited by Bo', [], { createdBy: 'u-ada', updatedBy: 'u-bo' }), agent('Older', [], { createdBy: 'u-ada' }), agent('Night', [], { runner: 'server', createdBy: 'u-ada' })] as AnyState[]
    const names = (list: AnyState[]) => list.map((a) => a.name)
    expect(names(agentsOfThisBrowser(team as never[], null))).toEqual(['Mine', 'Bo’s', 'Edited by Bo', 'Older'])
    expect(names(agentsOfThisBrowser(team as never[], { me: 'u-ada', readOnly: false }))).toEqual(['Mine', 'Older'])
    expect(agentsOfThisBrowser(team as never[], { me: 'u-ada', readOnly: true })).toEqual([])
    expect(agentsOfThisBrowser(team as never[], { me: null, readOnly: false })).toEqual([])

    expect(teamEndpoint('https://team.example.test', '/')).toBe('https://team.example.test/mcp')
    expect(teamEndpoint('https://one.example.test', '/SimpleCMS/')).toBe('https://one.example.test/SimpleCMS/mcp')
    expect(hostOnly('https://mcp.example.com:8443/team/7/mcp?key=x')).toBe('mcp.example.com:8443')
  })
})
