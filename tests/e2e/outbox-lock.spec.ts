/**
 * The OUT lock (slice 1a of the Outbox; features/ai/mcp-servers/lock.ts): an integration profile's send tools
 * (`sends[].tool`) are switched off in every Claude request One makes — the AI menu, ⌘K "?", a fixed request with
 * "All AI calls", a codeword with a picked tool, the AI terminal, browser agents, /generate and the connection test.
 * An allow-list loses them (only OUT tools: the server is left out), the system prompt names them, the agent editor
 * strikes them and a run says so. A re-test never drops an OUT tool from a server's list (a profile matched by tools
 * stays active); removing the profile gives the full toolset back. The terminal shows an OUT tool struck through and
 * never takes it; a staged send is never applied. Settings → MCP servers shows the OUT column.
 * A mocked Claude API only — never api.anthropic.com; "tracker" / "studio" are fictional addresses nobody calls.
 */
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect, openApp, wsEval, uiEval, createPage, gotoPage, editorOf, doc, para, MOD } from './fixtures'
import { sseMessage } from './helpers/terminal'
import { REPLY_ROUTE, TRACKER_SERVER_OUTBOX, WORK_ROUTE, addProfile, trackerProfile, trackerSendsProfile } from './helpers/integrations'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const SERVER = { ...TRACKER_SERVER_OUTBOX, codeword: 'tracker', prompt: 'Use get_item to read a ticket.', promptSource: 'auto' }
const LOCKED = { type: 'mcp_toolset', mcp_server_name: 'tracker', configs: { add_comment: { enabled: false } } }
const LOCK_LINE = 'These tools of it send data out and are switched off for you: add_comment.'

interface Sent {
  body: AnyState
  stream: boolean
}

/**
 * api.anthropic.com → streams get "Done.", other requests (a connection test) a message with the API's own tool listing
 * (`listing()`; null: none) and Claude's TOOLS line.
 */
async function mockApi(ctx: BrowserContext, listing: () => string[] | null = () => null): Promise<Sent[]> {
  const sent: Sent[] = []
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (req.method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [], has_more: false, first_id: null, last_id: null }) })
    const body = JSON.parse(req.postData() ?? '{}')
    const r: Sent = { body, stream: body.stream === true }
    sent.push(r)
    try {
      if (r.stream) return await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sseMessage([{ type: 'text', text: 'Done.' }]) })
      const names = listing()
      const content = [
        ...(names ? [{ type: 'mcp_tool_listing', id: 'mcplist_1', mcp_server_name: 'tracker', tools: names.map((name) => ({ name, description: `${name} (fictional)`, input_schema: { type: 'object' } })) }] : []),
        { type: 'text', text: `TOOLS: ${(names ?? ['get_item']).join(', ')}` },
      ]
      await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ id: 'msg_chk', type: 'message', role: 'assistant', model: 'e2e-mock', content, stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }) })
    } catch {
      /* aborted */
    }
  })
  return sent
}

const setKey = (page: Page) => wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
const setServers = (page: Page, servers: AnyState[]) => wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), servers)
const toolsets = (body: AnyState) => ((body.tools ?? []) as AnyState[]).filter((x) => x.type === 'mcp_toolset')
const system = (body: AnyState) => (typeof body.system === 'string' ? body.system : JSON.stringify(body.system))
const lastStream = (sent: Sent[]) => sent.filter((x) => x.stream).pop()!.body

/** A page with text, the editor's AI panel open at an empty line. */
async function openAIPanel(page: Page) {
  const id = await createPage(page, { title: 'Ticket notes', content: doc(para('Weber asked which baseline counts.'), para('')) })
  await gotoPage(page, id)
  const ed = editorOf(page, id)
  const ask = page.getByPlaceholder('Ask Claude to write anything…')
  await expect(async () => {
    await ed.locator('p').last().click()
    await page.keyboard.press('End')
    await page.keyboard.press('Space')
    try {
      await expect(ask).toBeFocused({ timeout: 2000 })
    } catch (e) {
      if (!(await ask.count())) await page.keyboard.press('Backspace')
      throw e
    }
  }).toPass({ timeout: 15_000 })
  return { id, ask, panel: page.getByRole('dialog', { name: 'Ask Claude' }) }
}

async function askPalette(page: Page, question: string) {
  await page.keyboard.press(`${MOD}+k`)
  const pal = page.getByRole('dialog', { name: 'Command palette' })
  const input = pal.locator('input').first()
  await expect(input).toBeFocused()
  await input.fill(`?${question}`)
  await input.press('Enter')
  await expect(pal).toContainText('Done.')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
}

const terminal = (page: Page) => page.getByRole('region', { name: 'AI terminal' })
const termPrompt = (page: Page) => terminal(page).getByRole('textbox', { name: 'Task for the agent' })

async function addAgent(page: Page, agent: AnyState): Promise<string> {
  return wsEval(
    page,
    (s, a) => {
      const now = Date.now()
      s.upsertAgent({ instructions: 'Keep Tickets in step with the tracker.', trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: 'stage', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: true, createdAt: now, updatedAt: now, ...a })
      return a.id as string
    },
    agent,
  )
}
async function runAgent(page: Page, id: string) {
  await page.evaluate((id) => (window.location.hash = `#/agents/${id}`), id)
  await expect(page.locator('.agx-dhead')).toBeVisible()
  const before = await page.locator('.agx-run').count()
  await page.getByRole('button', { name: 'Run now' }).click()
  await expect(page.locator('.agx-run')).toHaveCount(before + 1)
  await expect(page.locator('.agx-run').first()).toHaveAttribute('data-status', /staged|ok|error/, { timeout: 30_000 })
}

test.describe('Outbox lock: OUT tools are off in every Claude request', () => {
  test('free requests (AI menu, ⌘K "?", the AI terminal) and a fixed one ("All AI calls"): add_comment off, the prompt says so; without the profile the full toolset is back', async ({ page, context }) => {
    const sent = await mockApi(context)
    await openApp(page)
    await setKey(page)
    await setServers(page, [SERVER])
    await addProfile(page, trackerSendsProfile())

    // the AI menu: an own request
    const { ask, panel } = await openAIPanel(page)
    await ask.fill('Draft a reply to Weber about the baseline')
    await page.keyboard.press('Enter')
    await expect(panel.locator('.ai-out__body')).toContainText('Done.')
    let body = lastStream(sent)
    expect(body.mcp_servers.map((s: AnyState) => s.name)).toEqual(['tracker'])
    expect(toolsets(body)).toEqual([LOCKED])
    expect(system(body)).toContain(LOCK_LINE)
    await page.keyboard.press('Escape')

    // ⌘K "?"
    await askPalette(page, 'What is open on 10668?')
    body = lastStream(sent)
    expect(toolsets(body)).toEqual([LOCKED])
    expect(system(body)).toContain(LOCK_LINE)

    // the AI terminal
    await page.keyboard.press(`${MOD}+j`)
    await expect(termPrompt(page)).toBeFocused()
    await termPrompt(page).fill('What changed on 10668?')
    await termPrompt(page).press('Enter')
    await expect(terminal(page).locator('.term-answer')).toContainText('Done.')
    body = lastStream(sent)
    expect(toolsets(body)).toEqual([LOCKED])
    expect(system(body)).toContain(LOCK_LINE)
    await page.keyboard.press(`${MOD}+j`)

    // a fixed request (a one-click action) — only with "All AI calls"
    await setServers(page, [{ ...SERVER, scope: 'all' }])
    const ed = editorOf(page)
    await ed.locator('p').last().click()
    await page.keyboard.press('Space')
    const menu = page.getByRole('dialog', { name: 'Ask Claude' })
    await menu.getByRole('option', { name: /Summarize this page/ }).click()
    await expect(menu.locator('.ai-out__body')).toContainText('Done.')
    body = lastStream(sent)
    expect(toolsets(body)).toEqual([LOCKED])
    expect(system(body)).toContain(LOCK_LINE)
    await page.keyboard.press('Escape')

    // a second route adds its tool; the profile gone → the whole toolset again, no line
    await addProfile(page, trackerSendsProfile({}, [REPLY_ROUTE, WORK_ROUTE]))
    await askPalette(page, 'Anything else?')
    body = lastStream(sent)
    expect(toolsets(body)).toEqual([{ type: 'mcp_toolset', mcp_server_name: 'tracker', configs: { add_comment: { enabled: false }, log_work: { enabled: false } } }])
    expect(system(body)).toContain('switched off for you: add_comment, log_work.')
    await wsEval(page, (s) => s.deleteIntegration('tracker-out'))
    await askPalette(page, 'And now?')
    body = lastStream(sent)
    expect(toolsets(body)).toEqual([{ type: 'mcp_toolset', mcp_server_name: 'tracker' }])
    expect(system(body)).not.toContain('send data out')
  })

  test('codewords and a picked tool never lift it; the terminal shows add_comment struck through and never takes it', async ({ page, context }) => {
    const sent = await mockApi(context)
    await openApp(page)
    await setKey(page)
    await setServers(page, [SERVER])
    await addProfile(page, trackerSendsProfile())

    // "tracker: add_comment …": addressed, but the OUT tool is not picked — and stays off
    const { ask, panel } = await openAIPanel(page)
    await ask.fill('tracker: add_comment please post this link: teilen.example/rp')
    await page.keyboard.press('Enter')
    await expect(panel.locator('.ai-out__body')).toContainText('Done.')
    let body = lastStream(sent)
    expect(toolsets(body)).toEqual([LOCKED])
    expect(system(body)).toContain('The person addressed tracker by its codeword')
    expect(system(body)).not.toContain('picked the tool add_comment')
    expect(system(body)).toContain(LOCK_LINE)
    await page.keyboard.press('Escape')

    // a read tool is picked as before
    await editorOf(page).locator('p').last().click()
    await page.keyboard.press('Space')
    await expect(page.getByPlaceholder('Ask Claude to write anything…')).toBeFocused()
    await page.keyboard.type('tracker: get_item 10668')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Ask Claude' }).locator('.ai-out__body')).toContainText('Done.')
    body = lastStream(sent)
    expect(system(body)).toContain('The person picked the tool get_item of tracker')
    expect(toolsets(body)).toEqual([LOCKED])
    await page.keyboard.press('Escape')

    // the terminal: "tracker:add" lists add_comment struck through ("Outbox only"); Tab and a click take nothing
    await page.keyboard.press(`${MOD}+j`)
    await expect(termPrompt(page)).toBeFocused()
    await termPrompt(page).pressSequentially('tracker:')
    const list = terminal(page).locator('.term-complete')
    await expect(list.locator('.term-complete__item[data-out]')).toHaveText(/add_comment\s*Outbox only/)
    await expect(list.locator('.term-complete__item', { hasText: 'get_item' })).not.toHaveAttribute('data-out')
    await termPrompt(page).pressSequentially('add')
    const out = list.locator('.term-complete__item')
    await expect(out).toHaveCount(1)
    await expect(out).toHaveAttribute('aria-disabled', 'true')
    await termPrompt(page).press('Tab')
    await expect(termPrompt(page)).toHaveValue('tracker:add')
    // aria-disabled: a forced click (a person's click on the struck line) takes nothing either
    await out.click({ force: true })
    await expect(termPrompt(page)).toHaveValue('tracker:add')
    // a read tool is taken
    await termPrompt(page).fill('')
    await termPrompt(page).pressSequentially('tracker:get')
    await termPrompt(page).press('Tab')
    await expect(termPrompt(page)).toHaveValue('tracker: get_item ')
    // and the task goes out with the lock
    await termPrompt(page).pressSequentially('10668')
    await termPrompt(page).press('Enter')
    await expect(terminal(page).locator('.term-answer')).toContainText('Done.')
    body = lastStream(sent)
    expect(toolsets(body)).toEqual([LOCKED])
  })

  test('browser agents: no allow-list → off by name; [get_item, add_comment] → get_item only, a run note, the editor strikes add_comment; only add_comment → the server is left out', async ({ page, context }) => {
    const sent = await mockApi(context)
    await openApp(page)
    await setKey(page)
    await setServers(page, [SERVER])
    await addProfile(page, trackerSendsProfile())

    const all = await addAgent(page, { id: 'ag-all', name: 'All tools', mcpServers: ['tracker'] })
    await runAgent(page, all)
    let body = lastStream(sent)
    expect(toolsets(body)).toEqual([LOCKED])
    expect(system(body)).toContain(LOCK_LINE)

    const some = await addAgent(page, { id: 'ag-some', name: 'Reader', mcpServers: ['tracker'], mcpTools: { tracker: ['get_item', 'add_comment'] } })
    await runAgent(page, some)
    body = lastStream(sent)
    expect(toolsets(body)).toEqual([{ type: 'mcp_toolset', mcp_server_name: 'tracker', default_config: { enabled: false }, configs: { get_item: { enabled: true } } }])
    expect(system(body)).toContain('Only these of its tools are switched on for you: get_item.')
    expect(system(body)).toContain(LOCK_LINE)
    await expect(page.locator('.agx-run').first().locator('.agx-step[data-kind="note"]', { hasText: 'TRACKER: add_comment switched off — send tools only the Outbox uses.' })).toHaveCount(1)

    // the editor: add_comment struck through with OUT, the hint under the list
    await page.getByRole('button', { name: 'Edit' }).click()
    const editor = page.locator('.agx-editor')
    const tools = editor.getByRole('group', { name: 'Tools of TRACKER' })
    await expect(tools).toBeVisible()
    await expect(tools.locator('.agx-check--tool[data-out]')).toHaveCount(1)
    await expect(tools.locator('.agx-check--tool[data-out]')).toContainText('add_comment')
    await expect(tools.locator('.agx-check--tool[data-out] .agx-tools__tool')).toHaveCSS('text-decoration-line', 'line-through')
    await expect(editor.getByTestId('agx-tools-out')).toContainText('OUT: add_comment — these send data out')
    await page.keyboard.press('Escape')

    // only an OUT tool allowed: nothing left — the server is left out, the run says why
    const only = await addAgent(page, { id: 'ag-only', name: 'Poster', mcpServers: ['tracker'], mcpTools: { tracker: ['add_comment'] } })
    await runAgent(page, only)
    body = lastStream(sent)
    expect(body.mcp_servers).toBeUndefined()
    expect(toolsets(body)).toEqual([])
    const notes = page.locator('.agx-run').first().locator('.agx-step[data-kind="note"]')
    await expect(notes.filter({ hasText: 'TRACKER: add_comment switched off' })).toHaveCount(1)
    await expect(notes.filter({ hasText: 'TRACKER: no tool ticked for this agent — left out.' })).toHaveCount(1)
  })

  test('/generate: the forced request to one server keeps that server’s send tool off', async ({ page, context }) => {
    const sent = await mockApi(context)
    await openApp(page)
    await setKey(page)
    const studio = { id: 'srvstudio1', name: 'studio', url: 'https://mcp.example.test/studio/mcp', token: '', enabled: true, prompt: 'Use generate_image.', checkedAt: 1, tools: ['generate_image', 'get_job', 'publish_image'] }
    await setServers(page, [studio])
    await addProfile(page, trackerProfile({ id: 'studio-out', name: 'Studio out', match: { name: 'studio' }, recipes: undefined, sends: [{ id: 'publish', label: 'Publish', tool: 'publish_image', args: { job: '{key}' }, via: ['hand'] }] }))
    const id = await createPage(page, { title: 'Moodboard', content: doc(para('Lanterns.'), para('')) })
    await gotoPage(page, id)
    await editorOf(page, id).locator('p').last().click()
    await page.keyboard.type('/generate image')
    await expect(page.locator('.slash').first()).toContainText('Generate image')
    await page.keyboard.press('Enter')
    const setup = page.getByTestId('gen-setup')
    await expect(setup).toBeVisible()
    await setup.getByTestId('gen-prompt').fill('a red paper lantern')
    await setup.getByTestId('gen-run').click()
    await expect.poll(() => sent.filter((x) => x.stream).length).toBeGreaterThan(0)
    const body = lastStream(sent)
    expect(body.mcp_servers.map((s: AnyState) => s.name)).toEqual(['studio'])
    expect(toolsets(body)).toEqual([{ type: 'mcp_toolset', mcp_server_name: 'studio', configs: { publish_image: { enabled: false } } }])
    expect(system(body)).toContain('switched off for you: publish_image.')
  })

  test('the connection test runs locked; a re-test whose listing lacks add_comment keeps it (a profile matched by tools stays active); the overview shows OUT', async ({ page, context }) => {
    let listing: string[] | null = ['list_items', 'get_item', 'search_items', 'whoami', 'list_comments']
    const sent = await mockApi(context, () => listing)
    await openApp(page)
    await setKey(page)
    await setServers(page, [SERVER])
    await addProfile(page, trackerSendsProfile())
    // a profile that matches by tools only (no sends): active while the server lists add_comment
    await addProfile(page, trackerProfile({ id: 'by-tools', name: 'By tools', match: { tools: ['add_comment'] }, recipes: undefined, unlocks: ['upsert'] }))

    await uiEval(page, (s) => s.openModal({ type: 'settings', tab: 'ai' }))
    const card = page.locator('.mcps-card[data-server="tracker"]')
    await card.scrollIntoViewIfNeeded()
    await card.locator('.mcps-card__toggle').click()
    const checks = () => sent.filter((x) => !x.stream)
    await card.getByRole('button', { name: 'Test connection' }).click()
    await expect.poll(() => checks().length).toBe(1)
    const check = checks()[0]!.body
    expect(toolsets(check)).toEqual([LOCKED])
    expect(system(check)).toContain('Do not call any tool')
    // the listing left add_comment out (it was switched off): it stays on the server's list, log_work (never there) not
    await expect.poll(() => wsEval(page, (s) => s.settings.mcpServers[0].tools)).toEqual(['list_items', 'get_item', 'search_items', 'whoami', 'list_comments', 'add_comment'])

    // the overview: OUT 1, the names on hover
    const ov = page.getByTestId('mcp-overview')
    const outCell = ov.locator('tr[data-server="tracker"]').getByTestId('mcp-overview-out')
    await expect(outCell.locator('.mcpo__out')).toHaveAttribute('title', 'add_comment')
    await expect(outCell).toContainText('OUT 1')
    await expect(ov).toContainText('OUT = tools an integration profile names as send routes.')
    await page.keyboard.press('Escape')

    // the by-tools profile is still active
    await page.evaluate(() => (window.location.hash = '#/workspace/integrations'))
    const row = page.locator('[data-testid="int-row"][data-id="by-tools"]')
    await expect(row.getByTestId('int-status')).toHaveText('Active · matches TRACKER')

    // the sends profile gone: a re-test takes the list as it comes
    await wsEval(page, (s) => s.deleteIntegration('tracker-out'))
    listing = ['list_items', 'get_item']
    await uiEval(page, (s) => s.openModal({ type: 'settings', tab: 'ai' }))
    await card.scrollIntoViewIfNeeded()
    if ((await card.locator('.mcps-card__toggle').getAttribute('aria-expanded')) !== 'true') await card.locator('.mcps-card__toggle').click()
    await card.getByRole('button', { name: 'Test connection' }).click()
    await expect.poll(() => checks().length).toBe(2)
    expect(toolsets(checks()[1]!.body)).toEqual([{ type: 'mcp_toolset', mcp_server_name: 'tracker' }])
    await expect.poll(() => wsEval(page, (s) => s.settings.mcpServers[0].tools)).toEqual(['list_items', 'get_item'])
    await expect(page.getByTestId('mcp-overview').getByTestId('mcp-overview-out')).toHaveCount(0)
  })

  test('a staged send is never applied: /apply leaves it pending, Apply all skips it, applyChanges drops it', async ({ page, context }) => {
    await mockApi(context)
    await openApp(page)
    await setKey(page)
    const pageId = await createPage(page, { title: 'Reply drafts', content: doc(para('First line.')) })
    await page.keyboard.press(`${MOD}+j`)
    await expect(termPrompt(page)).toBeFocused()
    const stageSend = (extra: AnyState = {}) =>
      page.evaluate(
        ({ pageId, extra }) => {
          const term = (window as AnyState).__oneTerm
          term.state.setState((s: AnyState) => ({ changes: [...s.changes, { id: `chg-${s.changes.length + 1}`, n: s.changes.length + 1, kind: 'send', status: 'pending', pageId, title: 'Reply to J. Weber', send: { slipId: 'out_7Kq2MxAbCd' }, ...extra }] }))
        },
        { pageId, extra },
      )
    await stageSend()
    await termPrompt(page).fill('/apply')
    await termPrompt(page).press('Enter')
    await expect(terminal(page)).toContainText('Only sends are waiting — they go out from the Outbox after you check them, never from here.')
    expect(await page.evaluate(() => (window as AnyState).__oneTerm.state.getState().changes.map((c: AnyState) => c.status))).toEqual(['pending'])

    // next to an append: Apply all writes the append, the send stays pending
    await page.evaluate((pageId) => {
      const term = (window as AnyState).__oneTerm
      term.state.setState((s: AnyState) => ({ changes: [...s.changes, { id: 'chg-2', n: 2, kind: 'append', status: 'pending', pageId, markdown: 'Second line.' }] }))
    }, pageId)
    await termPrompt(page).fill('/apply')
    await termPrompt(page).press('Enter')
    await expect.poll(() => page.evaluate(() => (window as AnyState).__oneTerm.state.getState().changes.map((c: AnyState) => `${c.kind}:${c.status}`))).toEqual(['send:pending', 'append:applied'])
    expect(await wsEval(page, (s, id) => JSON.stringify(s.pages[id].content), pageId)).toContain('Second line.')

    // even when named (one card's Enter, or an agent in write mode "apply"): the apply step never writes a send
    const res = await page.evaluate(async () => {
      const term = (window as AnyState).__oneTerm
      const send = { id: 'x1', n: 1, kind: 'send', status: 'pending', pageId: 'p', send: { slipId: 'out_7Kq2MxAbCd' } }
      const r = await term.applyChanges([send], [send], (id: string) => id, { terminal: true })
      return { applied: r.applied, failed: r.failed }
    })
    expect(res).toEqual({ applied: [], failed: [] })
  })
})
