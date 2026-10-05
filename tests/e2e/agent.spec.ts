/**
 * Workspace agent (Claude API mocked — never reaches api.anthropic.com).
 *
 * The agent streams (SDK tool runner, stream: true), so the mock answers every Messages request
 * with the next server-sent-event message of a script: tool_use blocks (input streamed as
 * input_json_delta), progress-update thinking blocks, or final text.
 */
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect, openApp, pageIdByTitle, wsEval, uiEval, MOD } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

type Block = { type: 'text'; text: string } | { type: 'thinking'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }

let msgSeq = 0

/** One streamed assistant message in the Messages API SSE shape. */
function sseMessage(blocks: Block[], usage = { input: 1800, output: 120, cacheRead: 0, cacheWrite: 0 }): string {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  const stop = blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'
  let body = ev('message_start', {
    message: {
      id: `msg_e2e_${++msgSeq}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: usage.input, output_tokens: 1, cache_read_input_tokens: usage.cacheRead, cache_creation_input_tokens: usage.cacheWrite },
    },
  })
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      body += ev('content_block_start', { index, content_block: { type: 'text', text: '' } })
      for (const chunk of b.text.match(/.{1,18}/gs) ?? []) body += ev('content_block_delta', { index, delta: { type: 'text_delta', text: chunk } })
    } else if (b.type === 'thinking') {
      body += ev('content_block_start', { index, content_block: { type: 'thinking', thinking: '', signature: '' } })
      body += ev('content_block_delta', { index, delta: { type: 'thinking_delta', thinking: b.text } })
      body += ev('content_block_delta', { index, delta: { type: 'signature_delta', signature: 'sig-e2e' } })
    } else {
      body += ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } })
      for (const chunk of JSON.stringify(b.input).match(/.{1,24}/gs) ?? []) body += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: chunk } })
    }
    body += ev('content_block_stop', { index })
  })
  body += ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: usage.output } })
  body += ev('message_stop', {})
  return body
}

type Step = (body: AnyState) => string | Promise<string>

/**
 * Route api.anthropic.com to a scripted conversation: request n gets script[n]. Requests past the
 * end get a short final answer. Returns the parsed request bodies.
 */
async function mockAgent(ctx: BrowserContext, script: Step[]): Promise<AnyState[]> {
  const bodies: AnyState[] = []
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const body = JSON.parse(req.postData() ?? '{}')
    bodies.push(body)
    const step = script[bodies.length - 1] ?? (() => sseMessage([{ type: 'text', text: 'Done.' }]))
    const sse = await step(body)
    try {
      await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse })
    } catch {
      /* the request was aborted (Stop) */
    }
  })
  return bodies
}

const setKey = (page: Page) => wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))

/** Open the agent (the AI terminal) through the command palette. */
async function openAgentFromPalette(page: Page) {
  await page.keyboard.press(`${MOD}+k`)
  const input = page.getByRole('combobox').or(page.locator('.pal-scrim input')).first()
  await expect(input).toBeVisible()
  await input.fill('AI terminal')
  await page.keyboard.press('Enter')
  const panel = page.getByRole('region', { name: 'AI terminal' })
  await expect(panel).toBeVisible()
  return panel
}

async function runTask(page: Page, task: string) {
  const panel = page.getByRole('region', { name: 'AI terminal' })
  const field = panel.getByRole('textbox', { name: 'Task for the agent' })
  await field.fill(task)
  await field.press('Enter')
}

const rowsTitled = (page: Page, titles: string[]) =>
  wsEval(page, (s, titles) => (Object.values(s.pages) as AnyState[]).filter((p) => titles.includes(p.title) && !p.trashed).map((p) => p.title).sort(), titles)

/** Name of the option a select / status property of a row points at. */
const optionName = (page: Page, rowTitle: string, propName: string) =>
  wsEval(
    page,
    (s, { rowTitle, propName }) => {
      const row = (Object.values(s.pages) as AnyState[]).find((p) => p.title === rowTitle && !p.trashed)
      if (!row) return null
      const prop = s.databases[row.databaseId].properties.find((p: AnyState) => p.name === propName)
      const v = row.properties[prop.id]
      return (Array.isArray(v) ? v : [v]).map((id: string) => prop.options.find((o: AnyState) => o.id === id)?.name ?? '?').join(', ')
    },
    { rowTitle, propName },
  )

const TASK = 'Turn this week’s meeting notes into action items in Projects'

/** search → read (with a progress note) → create_row ×2 (parallel) → final text */
function meetingScript(ids: { meeting: string; projects: string }): Step[] {
  return [
    () => sseMessage([{ type: 'tool_use', id: 'toolu_1', name: 'search_pages', input: { query: 'weekly sync notes' } }], { input: 2600, output: 60, cacheRead: 0, cacheWrite: 2400 }),
    () =>
      sseMessage(
        [
          { type: 'thinking', text: 'Found the weekly sync. Reading its action items next.' },
          { type: 'tool_use', id: 'toolu_2', name: 'read_page', input: { id: ids.meeting } },
        ],
        { input: 400, output: 70, cacheRead: 2400, cacheWrite: 300 },
      ),
    () =>
      sseMessage(
        [
          { type: 'tool_use', id: 'toolu_3', name: 'create_row', input: { database_id: ids.projects, title: 'Final QA on staging', properties: { Status: 'Backlog', Priority: 'High', Owner: ['Alex'] }, markdown: 'From the weekly sync: run the final QA pass on staging before launch.' } },
          { type: 'tool_use', id: 'toolu_4', name: 'create_row', input: { database_id: ids.projects, title: 'Connect webhook to n8n', properties: { Status: 'Backlog', Priority: 'Medium', Tags: ['Ops', 'Automation'] } } },
        ],
        { input: 900, output: 260, cacheRead: 2700, cacheWrite: 600 },
      ),
    () => sseMessage([{ type: 'text', text: 'Staged **2 new projects** from the weekly sync: Final QA on staging and Connect webhook to n8n.' }], { input: 300, output: 40, cacheRead: 3300, cacheWrite: 200 }),
  ]
}

test.describe('Workspace agent (mocked Claude API)', () => {
  test('scripted run: step log, 2 staged rows, nothing written until "Apply all", then Undo removes them', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const ids = { meeting: await pageIdByTitle(page, 'Weekly sync — notes'), projects: await pageIdByTitle(page, 'Projects') }
    const bodies = await mockAgent(context, meetingScript(ids))
    const rowsBefore = await wsEval(page, (s, db) => (Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId === db).length, ids.projects)

    const panel = await openAgentFromPalette(page)
    await expect(panel.getByRole('textbox', { name: 'Task for the agent' })).toBeFocused()
    await runTask(page, TASK)

    // the review list fills up while nothing reaches the store
    await expect(panel.getByRole('heading', { name: '2 proposed changes' })).toBeVisible({ timeout: 20_000 })
    await expect(panel.getByText('Staged 2 new projects', { exact: false })).toBeVisible()
    await expect(panel.locator('.term-head__status')).toContainText('Done')

    // step log: one line per tool call with its readout, plus the progress note
    const log = panel.getByRole('log', { name: 'Agent steps' })
    await expect(log.locator('.term-step[data-tool]')).toHaveCount(4)
    await expect(log.locator('.term-step[data-tool="search_pages"]')).toContainText('“weekly sync notes”')
    await expect(log.locator('.term-step[data-tool="search_pages"]')).toContainText(/Results [1-9]/)
    await expect(log.locator('.term-step[data-tool="read_page"]')).toContainText('Weekly sync — notes')
    await expect(log.locator('.term-step[data-tool="create_row"]').nth(0)).toContainText('Staged #1')
    await expect(log.locator('.term-step[data-tool="create_row"]').nth(1)).toContainText('Staged #2')
    await expect(log.locator('.term-step--note')).toContainText('Reading its action items next.')

    // review items: property diffs, the new option, the content preview
    const first = panel.getByRole('listitem', { name: '#1 New row' })
    await expect(first).toContainText('Final QA on staging')
    await expect(first).toContainText('in Projects')
    await expect(first.locator('.agent-diff__row', { hasText: 'Priority' })).toContainText('High')
    await expect(first.locator('.agent-diff__row', { hasText: 'Owner' })).toContainText('Alex')
    await expect(first.locator('.agent-preview')).toContainText('run the final QA pass')
    const second = panel.getByRole('listitem', { name: '#2 New row' })
    await expect(second.locator('.agent-diff__row', { hasText: 'Tags' })).toContainText('+ new option')

    // usage meter: summed tokens and a cost estimate, labelled as billed by Anthropic
    await expect(panel.getByTestId('agent-cost')).toHaveText(/≈ (< )?\$\d/)
    await expect(panel.locator('.term-meter')).toContainText('billed by Anthropic to your API key')
    await expect(panel.locator('.term-meter')).toContainText('4/25')

    // nothing written yet
    expect(await rowsTitled(page, ['Final QA on staging', 'Connect webhook to n8n'])).toEqual([])
    expect(await wsEval(page, (s, db) => (Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId === db).length, ids.projects)).toBe(rowsBefore)

    // the requests: tools, the user's task, streaming, the tool results going back
    expect(bodies).toHaveLength(4)
    const b0 = bodies[0]
    expect(b0.model).toBe('claude-opus-5-5')
    expect(b0.stream).toBe(true)
    expect(b0.tools.map((x: AnyState) => x.name)).toEqual(['search_pages', 'read_page', 'list_databases', 'query_database', 'get_current_page', 'create_page', 'append_to_page', 'create_row', 'update_row', 'set_page_title', 'create_database', 'add_property'])
    expect(b0.tools.every((x: AnyState) => x.eager_input_streaming === true && x.input_schema?.type === 'object')).toBe(true)
    expect(b0.tools.some((x: AnyState) => 'run' in x || 'parse' in x)).toBe(false)
    expect(b0.thinking).toMatchObject({ type: 'adaptive', display: 'updates' })
    expect(b0.system).toContain('stages one proposed change')
    expect(JSON.stringify(b0.messages[0].content)).toContain(TASK)
    expect(JSON.stringify(b0.messages[0].content)).toContain('Today:')
    // the read_page result carries the page as Markdown
    const toolResult = (body: AnyState, id: string) => (body.messages as AnyState[]).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((c: AnyState) => c.type === 'tool_result' && c.tool_use_id === id)
    expect(String(toolResult(bodies[2], 'toolu_2')?.content)).toContain('## Action items')
    // both parallel results go back in one user message
    const last = bodies[3].messages[bodies[3].messages.length - 1]
    expect(last.role).toBe('user')
    expect(last.content.map((c: AnyState) => c.tool_use_id)).toEqual(['toolu_3', 'toolu_4'])
    expect(String(last.content[0].content)).toContain('Staged as change #1')

    // apply all → both rows exist with coerced properties
    await panel.locator('.term-bar').getByRole('button', { name: 'Apply all' }).click()
    await expect.poll(() => rowsTitled(page, ['Final QA on staging', 'Connect webhook to n8n'])).toEqual(['Connect webhook to n8n', 'Final QA on staging'])
    expect(await optionName(page, 'Final QA on staging', 'Priority')).toBe('High')
    expect(await optionName(page, 'Final QA on staging', 'Status')).toBe('Backlog')
    expect(await optionName(page, 'Connect webhook to n8n', 'Tags')).toBe('Ops, Automation')
    const qa = await wsEval(page, (s) => {
      const row = (Object.values(s.pages) as AnyState[]).find((p) => p.title === 'Final QA on staging')!
      return { origin: row.contentOrigin, plain: row.plain }
    })
    expect(qa).toMatchObject({ origin: 'ai' })
    expect(qa.plain).toContain('final QA pass on staging')
    await expect(first).toContainText('Applied')
    await expect(panel.locator('.term-bar')).toHaveCount(0)

    // one Undo toast reverts the whole batch
    const toast = page.locator('.toast', { hasText: '2 changes applied' })
    await expect(toast).toBeVisible()
    await toast.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => rowsTitled(page, ['Final QA on staging', 'Connect webhook to n8n'])).toEqual([])
    // the option created for the batch is gone again, the proposals are back for review
    expect(await wsEval(page, (s, db) => s.databases[db].properties.find((p: AnyState) => p.name === 'Tags').options.some((o: AnyState) => o.name === 'Automation'), ids.projects)).toBe(false)
    await expect(panel.getByRole('heading', { name: '2 proposed changes' })).toBeVisible()
    await expect(panel.locator('.term-bar')).toContainText('2 proposed changes')
  })

  test('discard one proposal: "Apply all" writes only the other', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const ids = { meeting: await pageIdByTitle(page, 'Weekly sync — notes'), projects: await pageIdByTitle(page, 'Projects') }
    await mockAgent(context, meetingScript(ids))
    await page.keyboard.press(`${MOD}+j`)
    const panel = page.getByRole('region', { name: 'AI terminal' })
    await expect(panel).toBeVisible()
    await runTask(page, TASK)
    await expect(panel.getByRole('listitem', { name: '#2 New row' })).toBeVisible({ timeout: 20_000 })
    await expect(panel.locator('.term-head__status')).toContainText('Done')

    await panel.getByRole('button', { name: 'Discard #2' }).click()
    await expect(panel.getByRole('listitem', { name: '#2 New row' })).toContainText('Discarded')
    await expect(panel.locator('.term-bar')).toContainText('1 proposed change')
    await panel.locator('.term-bar').getByRole('button', { name: 'Apply all' }).click()
    await expect.poll(() => rowsTitled(page, ['Final QA on staging', 'Connect webhook to n8n'])).toEqual(['Final QA on staging'])
    await expect(panel.getByRole('listitem', { name: '#1 New row' })).toContainText('Applied')

    // "New task" clears the session
    await panel.getByRole('button', { name: 'New task' }).click()
    await expect(panel.locator('.term-turn')).toHaveCount(0)
    await expect(panel.locator('.term-review')).toHaveCount(0)
    // ⌘J closes the panel again
    await page.keyboard.press(`${MOD}+j`)
    await expect(panel).toBeHidden()
  })

  test('Stop halts the loop: no further requests, proposals so far stay, nothing applied', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const ids = { projects: await pageIdByTitle(page, 'Projects') }
    let release: () => void = () => {}
    const held = new Promise<void>((r) => (release = r))
    const bodies = await mockAgent(context, [
      () => sseMessage([{ type: 'tool_use', id: 'toolu_a', name: 'create_row', input: { database_id: ids.projects, title: 'Half-done idea', properties: { Priority: 'Low' } } }]),
      // the second request hangs until the test ends
      async () => {
        await held
        return sseMessage([{ type: 'text', text: 'too late' }])
      },
    ])
    const panel = await openAgentFromPalette(page)
    await runTask(page, 'Add a few project ideas')
    await expect(panel.getByRole('listitem', { name: '#1 New row' })).toBeVisible({ timeout: 20_000 })
    await expect.poll(() => bodies.length).toBe(2)
    await expect(panel.locator('.term-head__status')).toContainText('Running')

    await panel.getByRole('button', { name: 'Stop' }).click()
    await expect(panel.locator('.term-head__status')).toContainText('Stopped')
    await expect(panel.locator('.term-note')).toContainText('Nothing was applied')
    await expect(panel.getByRole('button', { name: 'Run' })).toBeVisible()
    release()
    await page.waitForTimeout(600)
    expect(bodies).toHaveLength(2)
    expect(await rowsTitled(page, ['Half-done idea'])).toEqual([])

    // a follow-up task continues the conversation (append-only)
    await runTask(page, 'Never mind, just summarise')
    await expect(panel.locator('.term-turn')).toHaveCount(2)
    await expect(panel.locator('.term-head__status')).toContainText('Done', { timeout: 20_000 })
    const follow = bodies[2]
    const userTurns = (follow.messages as AnyState[]).filter((m) => m.role === 'user')
    expect(JSON.stringify(userTurns[0].content)).toContain('Add a few project ideas')
    expect(JSON.stringify(userTurns[userTurns.length - 1].content)).toContain('Never mind, just summarise')
  })

  test('without an API key the panel explains it and points to Settings → Claude AI', async ({ page, context }) => {
    const bodies = await mockAgent(context, [])
    await openApp(page)
    const panel = await openAgentFromPalette(page)
    await expect(panel).toContainText('Claude is not connected')
    await expect(panel.getByRole('button', { name: /^Run/ })).toBeDisabled()
    await panel.getByRole('button', { name: 'Open Settings → Claude AI' }).click()
    expect(await uiEval(page, (s) => s.modal)).toMatchObject({ type: 'settings', tab: 'ai' })
    await expect(page.getByRole('dialog').getByRole('tab', { name: /Claude AI/ })).toHaveAttribute('aria-selected', 'true')
    expect(bodies).toHaveLength(0)
  })

  test('the AI menu hands a typed request to the agent', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const bodies = await mockAgent(context, [() => sseMessage([{ type: 'text', text: 'Nothing to change.' }])])
    const id = await pageIdByTitle(page, 'Weekly sync — notes')
    await page.evaluate((id) => (window.location.hash = `#/p/${id}`), id)
    const editor = page.locator('#main .pv-content .ProseMirror').first()
    await expect(editor).toBeVisible()
    // let boot-time writers settle first (block ids, the synced-block service): an external content
    // update between the clicks below would move the caret off the new empty line
    const rev = () => wsEval(page, (s, id) => s.pages[id].contentRev, id)
    let last = await rev()
    await expect
      .poll(async () => {
        const now = await rev()
        const stable = now === last
        last = now
        return stable
      }, { intervals: [600] })
      .toBe(true)
    // an empty line → space opens the AI menu. The caret goes to the end of the line through the
    // editor (a click + End raced with focus handling and sometimes scrolled the column instead)
    await editor.getByText('Before it goes out').click()
    await expect(editor).toBeFocused()
    await editor.evaluate((root) => {
      const ed = (root as unknown as { editor: AnyState }).editor
      let pos = -1
      ed.state.doc.descendants((n: AnyState, p: number) => {
        if (pos < 0 && n.isTextblock && n.textContent.startsWith('Before it goes out')) pos = p + n.nodeSize - 1
        return pos < 0
      })
      ed.chain().focus().setTextSelection(pos).run()
    })
    // a human-scale pause before typing on (ProseMirror re-syncs its selection shortly after focus)
    await page.waitForTimeout(150)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Space')
    const menu = page.locator('.ai-panel')
    await expect(menu).toBeVisible()
    await menu.locator('.ai-cmd__input').fill('tag the open tasks')
    await menu.getByRole('option', { name: /Hand to the agent/ }).click()
    const panel = page.getByRole('region', { name: 'AI terminal' })
    await expect(panel).toBeVisible()
    await expect(panel.locator('.term-turn__task')).toHaveText('tag the open tasks')
    await expect(panel.getByText('Nothing to change.')).toBeVisible({ timeout: 20_000 })
    expect(String(bodies[0].messages[0].content)).toContain(`Open page: "Weekly sync — notes" (id: ${id})`)
  })
})
