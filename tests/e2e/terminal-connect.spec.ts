/**
 * /connect (/verbinden) in the AI terminal: an MCP server from the prompt — listed, added by its address, signed in
 * with the window opened from the Enter key itself (never by navigating this tab away), or only tested; "Sign in to
 * <server>" after its token was rejected, then "Run the task again". Claude API and the sign-in mocked
 * (helpers/terminal.ts, helpers/oauth.ts); no real host is contacted.
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval, flush } from './fixtures'
import { mcpError, mockAgent, openTerminal, prompt, run, say, setKey, sseMessage, terminal, userText, type AnyState, type Block } from './helpers/terminal'
import { ACCESS1, CODES_HOST, MCP_URL, REFRESH1, mockCodeAuth, mockOAuth, mockPlainMcp, storageDump } from './helpers/oauth'

const setServers = (page: Page, list: AnyState[]) => wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), list)
const connectLine = (page: Page) => terminal(page).getByTestId('term-connect').last()

/** a server that wants a sign-in (its check was turned down) */
const oauthy = (extra: AnyState = {}) => ({ id: 'srvoauth01', name: 'oauthy', url: MCP_URL, token: '', enabled: true, prompt: 'Looks things up.', promptSource: 'auto', checkError: 'The server rejected the token.', checkAuth: true, ...extra })
const archive = { id: 'srvarch001', name: 'archive', url: 'https://mcp.archive.test/mcp', token: 'archive-e2e-token-0001', enabled: true, prompt: 'Knowledge base.', promptSource: 'auto', tools: ['archive_search'], checkedAt: 1, codeword: 'kb' }

/** the mcp_servers entry of a request for a server */
const sent = (body: AnyState | undefined, name: string): AnyState | undefined => (body?.mcp_servers as AnyState[] | undefined)?.find((x) => x.name === name)

test.describe('AI terminal → /connect (mocked sign-in and API)', () => {
  test('/connect <address> adds the server; the Enter key opens the sign-in window (PKCE, registration, token); the line says Connected; only a vault marker is kept; this tab never navigated', async ({ page, context, errors }) => {
    errors.allow(/401|Failed to load resource/)
    const log = await mockOAuth(context)
    const m = await mockAgent(context, [], { inspect: () => 'TOOLS: search_records\n---\nLooks things up.' })
    await openApp(page)
    await setKey(page)
    const before = page.url()
    await openTerminal(page)
    const popupP = context.waitForEvent('page')
    await run(page, `/connect ${MCP_URL}`)
    const popup = await popupP
    errors.watch(popup)
    await popup.waitForEvent('close', { timeout: 20_000 })
    const line = connectLine(page)
    await expect(line).toHaveAttribute('data-phase', 'ok', { timeout: 15_000 })
    await expect(line).toContainText('OAUTH')
    await expect(line).toContainText('Added as oauth.')
    await expect(line).toContainText('Connected · 1 tool')
    expect(log.registered).toHaveLength(1)
    expect(log.authorize[0]!.get('code_challenge_method')).toBe('S256')
    expect(log.token[0]!.get('grant_type')).toBe('authorization_code')
    // tested with the new token, sent only to the API
    expect(sent(m.checks.at(-1), 'oauth')?.authorization_token).toBe(ACCESS1)
    const server = await wsEval(page, (s) => s.settings.mcpServers[0])
    expect(server.name).toBe('oauth')
    expect(server.token).toMatch(/^vault:[0-9a-z]+:7H2q$/)
    await flush(page)
    const dump = await storageDump(page)
    for (const secret of [ACCESS1, REFRESH1, 'CODE-e2e-1']) expect(dump).not.toContain(secret)
    expect(dump).not.toContain('one.oauth.mcp:')
    expect(page.url()).toBe(before)
  })

  test('/connect alone lists the servers; /verbinden in German; Tab completes a server; a server whose token works is only tested — no window', async ({ page, context }) => {
    const m = await mockAgent(context, [], { inspect: () => 'TOOLS: archive_search, archive_get\n---\nKnowledge base.' })
    await openApp(page)
    await setKey(page)
    await setServers(page, [archive, oauthy()])
    let popups = 0
    context.on('page', () => popups++)
    await openTerminal(page)
    await run(page, '/connect')
    const list = terminal(page).getByTestId('term-servers')
    await expect(list.locator('[data-server="archive"]')).toContainText('kb:')
    await expect(list.locator('[data-server="archive"]')).toContainText('TOKEN')
    await expect(list.locator('[data-server="oauthy"]')).toContainText('SIGN-IN NEEDED')
    // Tab completes the name; Enter on the typed-out name runs it
    await prompt(page).fill('/connect ar')
    await expect(terminal(page).locator('.term-complete')).toContainText('mcp.archive.test')
    await prompt(page).press('Tab')
    await expect(prompt(page)).toHaveValue('/connect archive')
    await prompt(page).press('Enter')
    const line = connectLine(page)
    await expect(line).toHaveAttribute('data-phase', 'ok')
    await expect(line).toContainText('Connected · 2 tools')
    expect(popups).toBe(0)
    expect(sent(m.checks.at(-1), 'archive')?.authorization_token).toBe('archive-e2e-token-0001')
    // the codeword works too
    await run(page, '/connect kb:')
    await expect(terminal(page).getByTestId('term-connect')).toHaveCount(2)
    await expect(connectLine(page)).toHaveAttribute('data-phase', 'ok')
    expect(popups).toBe(0)
    // German
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const term = terminal(page, 'KI-Terminal')
    await term.getByRole('textbox').fill('/verbinden')
    await term.getByRole('textbox').press('Enter')
    await expect(term.getByTestId('term-servers').last().locator('[data-server="oauthy"]')).toContainText('ANMELDUNG NÖTIG')
    await term.getByRole('textbox').fill('/verbinden nichts')
    await term.getByRole('textbox').press('Enter')
    await expect(term.locator('.term-echo').last()).toContainText('Kein MCP-Server „nichts“')
  })

  test('a server without a sign-in: its window closes at once, the line says it offers no sign-in; "Paste a token instead" opens Settings → Claude AI', async ({ page, context, errors }) => {
    errors.allow(/404|Failed to load resource/)
    await mockPlainMcp(context, 'https://plain.mcp.test')
    await mockAgent(context, [])
    await openApp(page)
    await setKey(page)
    await openTerminal(page)
    const popupP = context.waitForEvent('page')
    await run(page, '/connect https://plain.mcp.test/mcp')
    const popup = await popupP
    const line = connectLine(page)
    await expect(line).toHaveAttribute('data-phase', 'failed')
    await expect(line).toContainText('This server offers no sign-in')
    await expect.poll(() => popup.isClosed()).toBe(true)
    await line.getByTestId('term-connect-settings').click()
    await expect(page.getByTestId('mcp-servers')).toBeVisible()
  })

  test('an addressed server rejects its token: ERR · MCP_AUTH with "Sign in to oauthy"; ↵ on the empty prompt opens the window; then ↵ runs the task again — with the new token, the task sent once', async ({ page, context, errors }) => {
    errors.allow(/401|status of 400|Failed to load resource/)
    await mockOAuth(context)
    const m = await mockAgent(
      context,
      [
        () => mcpError(`MCP server 'oauthy' returned 401 Unauthorized: invalid token`),
        (body) => (sent(body, 'oauthy')?.authorization_token === ACCESS1 ? say('Found the record.')() : mcpError(`MCP server 'oauthy' returned 401 Unauthorized: invalid token`)),
      ],
      { inspect: () => 'TOOLS: search_records\n---\nLooks things up.' },
    )
    await openApp(page)
    await setKey(page)
    await setServers(page, [oauthy({ token: 'stale-token-0001', checkError: undefined, checkAuth: undefined, checkedAt: 1, tools: ['search_records'], codeword: 'ou' })])
    await openTerminal(page)
    await run(page, 'ou: find the record about invoices')
    const err = terminal(page).locator('.term-error')
    await expect(err).toContainText('ERR · MCP_AUTH')
    await expect(err.getByTestId('term-signin')).toHaveText('Sign in to oauthy')
    await expect(err.getByRole('button', { name: 'MCP settings' })).toBeVisible()
    await expect(prompt(page)).toHaveAttribute('placeholder', '↵ signs in to oauthy — or type a new task')
    // ↵ on the empty prompt: the window opens from that key press
    const popupP = context.waitForEvent('page')
    await prompt(page).press('Enter')
    const popup = await popupP
    errors.watch(popup)
    await popup.waitForEvent('close', { timeout: 20_000 })
    const line = connectLine(page)
    await expect(line).toHaveAttribute('data-phase', 'ok', { timeout: 15_000 })
    await expect(line.getByTestId('term-connect-rerun')).toBeVisible()
    await expect(prompt(page)).toHaveAttribute('placeholder', '↵ runs the task again — or type a new task')
    await prompt(page).press('Enter')
    await expect(terminal(page).locator('.term-answer').last()).toContainText('Found the record.')
    const last = m.bodies.at(-1)!
    expect(sent(last, 'oauthy')?.authorization_token).toBe(ACCESS1)
    // the failed attempt is not in the conversation twice
    const users = (last.messages as AnyState[]).filter((x) => x.role === 'user')
    expect(users.filter((u) => JSON.stringify(u.content).includes('find the record about invoices'))).toHaveLength(1)
    await expect(line).toContainText('Running it again.')
    void userText
  })

  test('an unaddressed server is left out in a pinned conversation: the note + Sign in offer; after the sign-in the next task (no /new) sends it with the new token; an address edited later never gets that token', async ({ page, context, errors }) => {
    errors.allow(/401|status of 400|Failed to load resource/)
    await mockOAuth(context)
    const m = await mockAgent(
      context,
      [
        () => mcpError(`MCP server 'oauthy' returned 401 Unauthorized: invalid token`),
        say('Answered without it.'),
        say('Answered with it.'),
        say('Third answer.'),
      ],
      { inspect: () => 'TOOLS: search_records\n---\nLooks things up.' },
    )
    await openApp(page)
    await setKey(page)
    await setServers(page, [oauthy({ token: 'stale-token-0001', checkError: undefined, checkAuth: undefined, checkedAt: 1, tools: ['search_records'] })])
    await openTerminal(page)
    await run(page, 'What is new?')
    await expect(terminal(page).locator('.term-answer').last()).toContainText('Answered without it.')
    await expect(terminal(page)).toContainText('oauthy rejected its token — Claude answers without it.')
    const offer = terminal(page).getByTestId('term-signin-offer')
    await expect(offer).toContainText('oauthy wants a sign-in.')
    const popupP = context.waitForEvent('page')
    await offer.getByTestId('term-signin').click()
    const popup = await popupP
    errors.watch(popup)
    await popup.waitForEvent('close', { timeout: 20_000 })
    await expect(connectLine(page)).toHaveAttribute('data-phase', 'ok', { timeout: 15_000 })
    // no rerun offered for a task that did not fail
    await expect(connectLine(page).getByTestId('term-connect-rerun')).toHaveCount(0)
    await run(page, 'And now?')
    await expect(terminal(page).locator('.term-answer').last()).toContainText('Answered with it.')
    expect(sent(m.bodies.at(-1), 'oauthy')?.authorization_token).toBe(ACCESS1)

    // the address is edited (same server id) and a new token pasted: the pinned conversation keeps the old address,
    // and the new token never goes there
    await wsEval(page, (s) => s.updateSettings({ mcpServers: s.settings.mcpServers.map((x: AnyState) => ({ ...x, url: 'https://mcp.elsewhere.test/mcp', token: 'elsewhere-token-0002', oauth: undefined })) }))
    await run(page, 'Once more')
    await expect(terminal(page).locator('.term-answer').last()).toContainText('Third answer.')
    for (const body of m.bodies) for (const x of (body.mcp_servers as AnyState[] | undefined) ?? []) if (x.url === MCP_URL) expect(x.authorization_token).not.toBe('elsewhere-token-0002')
  })

  test('pop-ups blocked: the line says the browser blocked the window and this tab stays where it is; "Sign in again" opens it', async ({ page, context, errors }) => {
    errors.allow(/401|Failed to load resource/)
    await page.addInitScript(() => {
      let n = 0
      const open = window.open.bind(window)
      window.open = ((...a: Parameters<typeof window.open>) => (n++ === 0 ? null : open(...a))) as typeof window.open
    })
    await mockOAuth(context)
    await mockAgent(context, [], { inspect: () => 'TOOLS: search_records\n---\nLooks things up.' })
    await openApp(page)
    await setKey(page)
    await setServers(page, [oauthy()])
    await openTerminal(page)
    const before = page.url()
    await run(page, '/connect oauthy')
    const line = connectLine(page)
    await expect(line).toHaveAttribute('data-phase', 'failed')
    await expect(line).toContainText('The browser blocked the sign-in window')
    expect(page.url()).toBe(before)
    const popupP = context.waitForEvent('page')
    await line.getByTestId('term-connect-again').click()
    const popup = await popupP
    errors.watch(popup)
    await popup.waitForEvent('close', { timeout: 20_000 })
    await expect(connectLine(page)).toHaveAttribute('data-phase', 'ok', { timeout: 15_000 })
    expect(page.url()).toBe(before)
  })

  test('a sign-in with a code from the terminal (phone, dark): "Use a code instead" shows the code and the sign-in page; polling finishes and the line turns Connected; nothing overflows', async ({ page, context, errors }) => {
    errors.allow(/401|Failed to load resource/)
    const log = await mockCodeAuth(context, { wayBack: true })
    await mockAgent(context, [], { inspect: () => 'TOOLS: make_image\n---\nMakes images.' })
    await page.setViewportSize({ width: 390, height: 844 })
    await openApp(page)
    await setKey(page)
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await setServers(page, [{ id: 'srvcodes01', name: 'codes', url: `${CODES_HOST}/mcp`, token: '', enabled: true, prompt: 'Makes images.', promptSource: 'auto', checkError: 'The server rejected the token.', checkAuth: true }])
    await openTerminal(page)
    const popupP = context.waitForEvent('page')
    await run(page, '/connect codes')
    await popupP
    const line = connectLine(page)
    await expect(line).toHaveAttribute('data-phase', 'waiting')
    log.pending = 2
    await line.getByTestId('term-connect-usecode').click()
    await expect(line.getByTestId('term-connect-code')).toHaveText('WDJB-MJHT')
    await expect(line.getByTestId('term-connect-open')).toHaveAttribute('href', 'https://auth.codes.test/activate?user_code=WDJB-MJHT')
    // a link that is a key: no underline, like the buttons beside it
    expect(await line.getByTestId('term-connect-open').evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('none')
    const overflow = await terminal(page).locator('.term-scroll').evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    await expect(line).toHaveAttribute('data-phase', 'ok', { timeout: 20_000 })
    await expect(line).toContainText('Connected · 1 tool')
  })

  test('a Continue that fails because the addressed server rejected its token: after the sign-in "Run the task again" goes on with the Continue (a fresh budget, what is staged)', async ({ page, context, errors }) => {
    errors.allow(/401|status of 400|Failed to load resource/)
    await mockOAuth(context)
    const many = Array.from({ length: 42 }, (_, i): Block => ({ type: 'tool_use', id: `toolu_p${i}`, name: 'create_page', input: { title: `Record ${i + 1}`, markdown: `Notes on record ${i + 1}.` } }))
    const m = await mockAgent(
      context,
      [
        () => sseMessage(many),
        say('Reached the limit: 40 of 42 staged.'),
        () => mcpError(`MCP server 'oauthy' returned 401 Unauthorized: invalid token`),
        (body) => (sent(body, 'oauthy')?.authorization_token === ACCESS1 ? say('Staged the last two.')() : mcpError(`MCP server 'oauthy' returned 401 Unauthorized: invalid token`)),
      ],
      { inspect: () => 'TOOLS: search_records\n---\nLooks things up.' },
    )
    await openApp(page)
    await setKey(page)
    await setServers(page, [oauthy({ token: 'stale-token-0001', checkError: undefined, checkAuth: undefined, checkedAt: 1, tools: ['search_records'], codeword: 'ou' })])
    await openTerminal(page)
    await run(page, 'ou: make a page for every record')
    await expect(terminal(page).getByTestId('term-continue')).toBeVisible({ timeout: 30_000 })
    await terminal(page).getByTestId('term-continue').click()
    const err = terminal(page).locator('.term-error').last()
    await expect(err).toContainText('ERR · MCP_AUTH')
    const popupP = context.waitForEvent('page')
    await err.getByTestId('term-signin').click()
    const popup = await popupP
    errors.watch(popup)
    await popup.waitForEvent('close', { timeout: 20_000 })
    const line = connectLine(page)
    await expect(line).toHaveAttribute('data-phase', 'ok', { timeout: 15_000 })
    await expect(line.getByTestId('term-connect-rerun')).toBeVisible()
    await line.getByTestId('term-connect-rerun').click()
    await expect(terminal(page).locator('.term-answer').last()).toContainText('Staged the last two.')
    await expect(line).toContainText('Running it again.')
    await expect(line.getByTestId('term-connect-rerun')).toHaveCount(0)
    const last = m.bodies.at(-1)!
    expect(sent(last, 'oauthy')?.authorization_token).toBe(ACCESS1)
    // the Continue again — not the first task from the start
    expect(userText(last, (last.messages as AnyState[]).filter((x) => x.role === 'user').length - 1)).toContain('Continue the task where you stopped at the tool-call limit')
    expect(m.bodies).toHaveLength(4)
  })

  test('without a Claude key: a server whose token works says "Not tested yet" (never "Signed in"); German keys log /verbinden', async ({ page, context, errors }) => {
    errors.allow(/401|Failed to load resource/)
    await mockOAuth(context)
    await mockAgent(context, [])
    await openApp(page)
    await setServers(page, [archive, oauthy()])
    await openTerminal(page)
    await run(page, '/connect archive')
    const line = connectLine(page)
    await expect(line).toHaveAttribute('data-phase', 'ok')
    await expect(line).toContainText('Not tested yet — the connection is tested once Claude is connected')
    await expect(line).not.toContainText('Signed in')
    // German: the list's sign-in key logs the German command
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const term = terminal(page, 'KI-Terminal')
    await term.getByRole('textbox').fill('/verbinden')
    await term.getByRole('textbox').press('Enter')
    const popupP = context.waitForEvent('page')
    await term.getByTestId('term-servers').last().locator('[data-server="oauthy"]').getByRole('button').click()
    const popup = await popupP
    errors.watch(popup)
    await expect(term.locator('.term-echo').last().locator('.term-echo__in')).toContainText('/verbinden oauthy')
    await popup.waitForEvent('close', { timeout: 20_000 })
    await expect(term.getByTestId('term-connect').last()).toHaveAttribute('data-phase', 'ok', { timeout: 15_000 })
    // signed in for real (no key yet): "Angemeldet"
    await expect(term.getByTestId('term-connect').last()).toContainText('Angemeldet.')
  })
})
