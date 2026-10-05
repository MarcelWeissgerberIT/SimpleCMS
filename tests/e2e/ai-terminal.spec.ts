/**
 * The AI terminal (⌘J): the workspace agent as a keyboard-first dock that keeps working in the
 * background. Claude API mocked — every Messages request gets the next scripted SSE message (tool_use
 * turns, final text); nothing reaches api.anthropic.com.
 */
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect, openApp, gotoPage, createPage, pageIdByTitle, reloadApp, selectText, wsEval, editorOf, MOD } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }

let msgSeq = 0

/** One streamed assistant message in the Messages API SSE shape. */
function sseMessage(blocks: Block[]): string {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  const stop = blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'
  let body = ev('message_start', {
    message: { id: `msg_term_${++msgSeq}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  })
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      body += ev('content_block_start', { index, content_block: { type: 'text', text: '' } })
      for (const chunk of b.text.match(/.{1,18}/gs) ?? []) body += ev('content_block_delta', { index, delta: { type: 'text_delta', text: chunk } })
    } else {
      body += ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } })
      for (const chunk of JSON.stringify(b.input).match(/.{1,24}/gs) ?? []) body += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: chunk } })
    }
    body += ev('content_block_stop', { index })
  })
  body += ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 90 } })
  body += ev('message_stop', {})
  return body
}

type Step = (body: AnyState) => string | Promise<string>

/** Route api.anthropic.com to a script: request n gets script[n] (later ones a short answer). */
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
const terminal = (page: Page, name = 'AI terminal') => page.getByRole('region', { name })
const prompt = (page: Page) => terminal(page).getByRole('textbox', { name: 'Task for the agent' })

/** The text of the user turn of a request (context + task). */
const userText = (body: AnyState, i = 0) => JSON.stringify((body.messages as AnyState[]).filter((m) => m.role === 'user')[i]?.content ?? '')

/** A tool result Claude got back, by tool_use id. */
const toolResult = (body: AnyState, id: string): AnyState | undefined =>
  (body.messages as AnyState[]).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((c: AnyState) => c.type === 'tool_result' && c.tool_use_id === id)

async function openTerminal(page: Page) {
  await page.keyboard.press(`${MOD}+j`)
  await expect(terminal(page)).toBeVisible()
  await expect(prompt(page)).toBeFocused()
}

async function run(page: Page, task: string) {
  await prompt(page).fill(task)
  await prompt(page).press('Enter')
}

const titled = (page: Page, titles: string[]) =>
  wsEval(page, (s, titles) => (Object.values(s.pages) as AnyState[]).filter((p) => titles.includes(p.title) && !p.trashed).map((p) => p.title).sort(), titles)

test.describe('AI terminal (mocked Claude API)', () => {
  test('⌘J opens it; a task keeps running while it is hidden: status LED, toast, result on reopen', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    let release: () => void = () => {}
    const held = new Promise<void>((r) => (release = r))
    const bodies = await mockAgent(context, [
      () => sseMessage([{ type: 'tool_use', id: 'toolu_s', name: 'search_pages', input: { query: 'Delta' } }]),
      async () => {
        await held
        return sseMessage([{ type: 'text', text: 'Found **no page** about Delta yet — nothing to change.' }])
      },
    ])
    const cell = page.locator('.status .term-cell')
    await expect(cell).toContainText('AI')

    await openTerminal(page)
    await run(page, 'Summarise everything about Delta')
    await expect(terminal(page).locator('.term-step[data-tool="search_pages"]')).toContainText('“Delta”')
    await expect.poll(() => bodies.length).toBe(2)

    // Esc hides the dock — the request stays open, the status bar shows the task
    await page.keyboard.press('Escape')
    await expect(terminal(page)).toBeHidden()
    await expect(cell).toContainText('AI · working')
    release()
    const toast = page.locator('.toast', { hasText: 'AI terminal: task done' })
    await expect(toast).toBeVisible({ timeout: 15_000 })
    await expect(cell).toContainText('AI · done')
    expect(bodies).toHaveLength(2)

    // the status bar brings it back with the result
    await cell.click()
    await expect(terminal(page)).toBeVisible()
    await expect(terminal(page).locator('.term-answer')).toContainText('nothing to change')
    await expect(terminal(page).locator('.term-head__status')).toContainText('Done')
    await expect(cell).not.toContainText('done')
    // ⌘J hides it again, the palette entry "AI terminal" opens it
    await page.keyboard.press(`${MOD}+j`)
    await expect(terminal(page)).toBeHidden()
    await page.keyboard.press(`${MOD}+k`)
    await page.locator('.pal-scrim input').first().fill('AI terminal')
    await page.keyboard.press('Enter')
    await expect(terminal(page)).toBeVisible()
  })

  test('keyboard: ↑ history (per workspace, survives a reload), Tab completes /he → /help and an @ mention as context', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const bodies = await mockAgent(context, [() => sseMessage([{ type: 'text', text: 'First answer.' }])])
    const weekly = await pageIdByTitle(page, 'Weekly sync — notes')
    await openTerminal(page)
    await run(page, 'first task')
    await expect(terminal(page).locator('.term-answer')).toContainText('First answer.')

    // Tab completes a command; Enter runs it (local, no request)
    await prompt(page).fill('/he')
    const list = terminal(page).getByRole('listbox')
    await expect(list.getByRole('option', { name: /\/help/ })).toBeVisible()
    await prompt(page).press('Tab')
    await expect(prompt(page)).toHaveValue('/help')
    await prompt(page).press('Enter')
    const help = terminal(page).locator('.term-echo[data-kind="help"]')
    await expect(help).toContainText('/stop')
    await expect(help).toContainText('/cost')
    await expect(help).toContainText('/übernehmen')
    expect(bodies).toHaveLength(1)

    // ↑ / ↓ walk the prompt history, ↓ past the end restores what was typed
    await prompt(page).fill('')
    await prompt(page).press('ArrowUp')
    await expect(prompt(page)).toHaveValue('/help')
    await prompt(page).press('ArrowUp')
    await expect(prompt(page)).toHaveValue('first task')
    await prompt(page).press('ArrowDown')
    await expect(prompt(page)).toHaveValue('/help')
    await prompt(page).press('ArrowDown')
    await expect(prompt(page)).toHaveValue('')

    // @ + Tab: a page mention, sent along as context
    await prompt(page).pressSequentially('Summarise @Weekly sy')
    await expect(list.getByRole('option', { name: /Weekly sync — notes/ })).toHaveAttribute('aria-selected', 'true')
    await prompt(page).press('Tab')
    await expect(prompt(page)).toHaveValue('Summarise @Weekly sync — notes ')
    await expect(terminal(page).locator('.term-chip[data-kind="mention"]')).toContainText('Weekly sync — notes')
    await prompt(page).press('Enter')
    await expect.poll(() => bodies.length).toBe(2)
    expect(userText(bodies[1], 1)).toContain(`The user pointed at: \\"Weekly sync — notes\\" (id: ${weekly}, page)`)
    await expect(terminal(page).locator('.term-turn__ctx').last()).toContainText('@Weekly sync — notes')

    // the history is per device + workspace in localStorage: still there after a reload
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('one.term.history:local:local') ?? '[]'))
    expect(stored).toEqual(['first task', '/help', 'Summarise @Weekly sync — notes'])
    await reloadApp(page)
    await openTerminal(page)
    await prompt(page).press('ArrowUp')
    await expect(prompt(page)).toHaveValue('Summarise @Weekly sync — notes')
  })

  test('review by keyboard: j / k move, Space marks, Enter applies the marked, a applies the rest, u undoes', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const projects = await pageIdByTitle(page, 'Projects')
    const rows = ['Term row one', 'Term row two', 'Term row three']
    await mockAgent(context, [
      () => sseMessage(rows.map((title, i) => ({ type: 'tool_use' as const, id: `toolu_r${i}`, name: 'create_row', input: { database_id: projects, title, properties: { Priority: 'Low' } } }))),
      () => sseMessage([{ type: 'text', text: 'Staged 3 rows.' }]),
    ])
    await openTerminal(page)
    await run(page, 'Add three rows')
    await expect(terminal(page).locator('.term-head__status')).toContainText('Done', { timeout: 20_000 })
    await expect(terminal(page).locator('.term-step[data-tool="create_row"]').first()).toContainText('Staged #1')

    // Tab on the empty prompt → the review list (cursor on #1)
    await prompt(page).press('Tab')
    const item = (n: number) => terminal(page).getByRole('listitem', { name: new RegExp(`^#${n} New row`) })
    await expect(item(1)).toBeFocused()
    await page.keyboard.press('j')
    await expect(item(2)).toBeFocused()
    await page.keyboard.press('j')
    await expect(item(3)).toBeFocused()
    await page.keyboard.press('k')
    await expect(item(2)).toBeFocused()
    await page.keyboard.press(' ')
    await expect(item(2)).toHaveAttribute('aria-label', /marked/)
    await expect(item(2)).toHaveAttribute('data-marked', 'true')
    // Enter applies what is marked — only #2
    await page.keyboard.press('Enter')
    await expect.poll(() => titled(page, rows)).toEqual(['Term row two'])
    await expect(item(2)).toContainText('Applied')
    await expect(item(1)).toContainText('Discard')
    // a: all the rest
    await expect(item(2)).toBeFocused()
    await page.keyboard.press('a')
    await expect.poll(() => titled(page, rows)).toEqual(['Term row one', 'Term row three', 'Term row two'])
    // u: undo the last batch (#1 and #3), #2 stays
    await page.keyboard.press('u')
    await expect.poll(() => titled(page, rows)).toEqual(['Term row two'])
    await expect(item(1)).toContainText('Discard')
    // d discards the entry under the cursor, Esc goes back to the prompt
    await page.keyboard.press('k')
    await expect(item(1)).toBeFocused()
    await page.keyboard.press('d')
    await expect(item(1)).toContainText('Discarded')
    await page.keyboard.press('Escape')
    await expect(prompt(page)).toBeFocused()
    await expect(terminal(page)).toBeVisible()
    // back in (the cursor is kept), o opens the applied row in the side peek
    await prompt(page).press('Tab')
    await expect(item(1)).toBeFocused()
    await page.keyboard.press('j')
    await page.keyboard.press('o')
    await expect(page.locator('.peek')).toBeVisible()
    await expect(page.locator('.peek .pv-title')).toContainText('Term row two')
  })

  test('⌘. stops the running task — also while the terminal is hidden — and aborts the request', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    let release: () => void = () => {}
    const held = new Promise<void>((r) => (release = r))
    const bodies = await mockAgent(context, [
      async () => {
        await held
        return sseMessage([{ type: 'text', text: 'too late' }])
      },
    ])
    const aborted: string[] = []
    page.on('requestfailed', (r) => r.url().includes('api.anthropic.com') && aborted.push(r.failure()?.errorText ?? ''))
    await openTerminal(page)
    await run(page, 'Something slow')
    await expect.poll(() => bodies.length).toBe(1)
    await expect(terminal(page).locator('.term-head__status')).toContainText('Running')
    await page.keyboard.press('Escape')
    await expect(page.locator('.status .term-cell')).toContainText('AI · working')
    await page.keyboard.press(`${MOD}+.`)
    await expect.poll(() => aborted.length).toBe(1)
    await expect(page.locator('.status .term-cell')).not.toContainText('working')
    // no "task done" toast for a task the user stopped
    await expect(page.locator('.toast', { hasText: 'AI terminal' })).toHaveCount(0)
    release()
    await openTerminal(page)
    await expect(terminal(page).locator('.term-head__status')).toContainText('Stopped')
    await expect(terminal(page).locator('.term-note')).toContainText('Nothing was applied')
    expect(bodies).toHaveLength(1)
  })

  test('create_database + create_row into it → a board grouped by its column after /apply; add_property; locked databases refuse; undo', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const weekly = await pageIdByTitle(page, 'Weekly sync — notes')
    const projects = await pageIdByTitle(page, 'Projects')
    const reading = await pageIdByTitle(page, 'Reading list')
    await wsEval(page, (s, id) => s.updateDatabase(id, { locked: true }), reading)
    let dbId = ''
    const bodies = await mockAgent(context, [
      () =>
        sseMessage([
          {
            type: 'tool_use',
            id: 'toolu_db',
            name: 'create_database',
            input: { title: 'Open items', parent_id: weekly, columns: [{ name: 'Status', type: 'select', options: ['Todo', 'Doing', 'Done'] }, { name: 'Owner', type: 'text' }], view: 'board', group_by: 'Status' },
          },
          { type: 'tool_use', id: 'toolu_lock', name: 'add_property', input: { database_id: reading, name: 'Effort', type: 'number' } },
          { type: 'tool_use', id: 'toolu_prop', name: 'add_property', input: { database_id: projects, name: 'Effort', type: 'number' } },
        ]),
      (body) => {
        dbId = /New database id: ([\w-]+)/.exec(String(toolResult(body, 'toolu_db')?.content))?.[1] ?? ''
        return sseMessage([
          { type: 'tool_use', id: 'toolu_r1', name: 'create_row', input: { database_id: dbId, title: 'Final QA on staging', properties: { Status: 'Todo', Owner: 'Alex' } } },
          { type: 'tool_use', id: 'toolu_r2', name: 'create_row', input: { database_id: dbId, title: 'Connect webhook to n8n', properties: { Status: 'Doing' } } },
          { type: 'tool_use', id: 'toolu_r3', name: 'create_row', input: { database_id: projects, title: 'Estimate the relaunch', properties: { Effort: 3 } } },
        ])
      },
      () => sseMessage([{ type: 'text', text: 'Staged a board **Open items** with 2 rows.' }]),
    ])
    await openTerminal(page)
    await run(page, 'Make a board of the open items on this page')
    await expect(terminal(page).locator('.term-head__status')).toContainText('Done', { timeout: 20_000 })
    expect(dbId).not.toBe('')
    // the locked database refused the property; Claude was told why
    expect(toolResult(bodies[1], 'toolu_lock')).toMatchObject({ is_error: true })
    expect(String(toolResult(bodies[1], 'toolu_lock')?.content)).toContain('is locked')
    expect(bodies[0].tools.map((x: AnyState) => x.name)).toEqual(expect.arrayContaining(['create_database', 'add_property']))

    const db = terminal(page).getByRole('listitem', { name: /^#1 New database/ })
    await expect(db).toContainText('Open items')
    await expect(db).toContainText('Board')
    await expect(db.locator('.agent-diff__row', { hasText: 'Status' })).toContainText('Todo · Doing · Done')
    await expect(terminal(page).getByRole('listitem', { name: /^#2 New property/ })).toContainText('Effort')
    await expect(terminal(page).getByRole('listitem', { name: /^#3 New row/ })).toContainText('in Open items')
    await expect(terminal(page).getByRole('listitem', { name: /^#5 New row/ })).toContainText('Needs #2 first')
    // nothing written yet
    expect(await titled(page, ['Open items', 'Final QA on staging', 'Estimate the relaunch'])).toEqual([])

    await run(page, '/apply')
    await expect.poll(() => titled(page, ['Open items', 'Final QA on staging', 'Connect webhook to n8n', 'Estimate the relaunch'])).toEqual(['Connect webhook to n8n', 'Estimate the relaunch', 'Final QA on staging', 'Open items'])
    const made = await wsEval(
      page,
      (s, id) => {
        const d = s.databases[id]
        const status = d.properties.find((p: AnyState) => p.name === 'Status')
        const rows = (Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId === id && !p.trashed)
        return {
          parent: s.pages[id].parentId,
          view: d.views[0].type,
          groupBy: d.views[0].groupBy === status.id,
          options: status.options.map((o: AnyState) => o.name),
          rows: rows.map((r) => `${r.title}: ${status.options.find((o: AnyState) => o.id === r.properties[status.id])?.name}`).sort(),
        }
      },
      dbId,
    )
    expect(made).toEqual({ parent: weekly, view: 'board', groupBy: true, options: ['Todo', 'Doing', 'Done'], rows: ['Connect webhook to n8n: Doing', 'Final QA on staging: Todo'] })
    const effort = await wsEval(page, (s, id) => {
      const prop = s.databases[id].properties.find((p: AnyState) => p.name === 'Effort')
      const row = (Object.values(s.pages) as AnyState[]).find((p) => p.title === 'Estimate the relaunch')
      return { type: prop?.type, value: row?.properties[prop?.id] }
    }, projects)
    expect(effort).toEqual({ type: 'number', value: 3 })

    // one Undo: rows, the property and the database go again
    const toast = page.locator('.toast', { hasText: '5 changes applied' })
    await expect(toast).toBeVisible()
    await toast.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => titled(page, ['Open items', 'Final QA on staging', 'Connect webhook to n8n', 'Estimate the relaunch'])).toEqual([])
    expect(await wsEval(page, (s, id) => !!s.databases[id], dbId)).toBe(false)
    expect(await wsEval(page, (s, id) => s.databases[id].properties.some((p: AnyState) => p.name === 'Effort'), projects)).toBe(false)
  })

  test('DE: KI-Terminal, /hilfe, /kosten, /übernehmen and unknown commands answer in German', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const bodies = await mockAgent(context, [])
    await expect(page.locator('.status .term-cell')).toContainText('KI')
    await page.keyboard.press(`${MOD}+j`)
    const term = terminal(page, 'KI-Terminal')
    await expect(term).toBeVisible()
    const field = term.getByRole('textbox', { name: 'Aufgabe für den Agenten' })
    await expect(field).toHaveAttribute('placeholder', /Befehle/)
    await field.fill('/hi')
    await expect(term.getByRole('option', { name: /\/hilfe/ })).toBeVisible()
    await field.press('Tab')
    await expect(field).toHaveValue('/hilfe')
    await field.press('Enter')
    await expect(term.locator('.term-echo[data-kind="help"]')).toContainText('Befehle und Tasten')
    await expect(term.locator('.term-echo[data-kind="help"]')).toContainText('/verwerfen')
    await field.fill('/kosten')
    await field.press('Enter')
    await expect(term.locator('.term-echo[data-kind="cost"]')).toContainText('Anfragen')
    await field.fill('/übernehmen')
    await field.press('Enter')
    await expect(term.locator('.term-echo').last()).toContainText('Keine Vorschläge offen.')
    await field.fill('/stopp')
    await field.press('Enter')
    await expect(term.locator('.term-echo').last()).toContainText('Es läuft nichts.')
    await field.fill('/xyz')
    await field.press('Enter')
    await expect(term.locator('.term-echo').last()).toContainText('Unbekannter Befehl /xyz')
    // the English names work in German too
    await field.fill('/history')
    await field.press('Enter')
    await expect(term.locator('.term-echo[data-kind="history"]')).toContainText('/kosten')
    expect(bodies).toHaveLength(0)
  })

  test('references: Mod+Shift+J sends the selection along (page id + Markdown); the chip moves into the log', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const bodies = await mockAgent(context, [() => sseMessage([{ type: 'text', text: 'Noted.' }])])
    const id = await createPage(page, {
      title: 'Delta report',
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Project Delta: open items' }] },
          { type: 'bulletList', content: ['Budget review is late', 'Vendor contract unsigned'].map((text) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })) },
          { type: 'paragraph', content: [{ type: 'text', text: 'Next check-in on Friday.' }] },
        ],
      },
    })
    await gotoPage(page, id)
    const editor = editorOf(page)
    await editor.click()
    // select the heading and the list (three lines)
    await editor.evaluate((root) => {
      const ed = (root as unknown as { editor: AnyState }).editor
      let to = -1
      ed.state.doc.descendants((n: AnyState, p: number) => {
        if (n.isTextblock && n.textContent === 'Vendor contract unsigned') to = p + n.nodeSize - 1
        return to < 0
      })
      ed.chain().focus().setTextSelection({ from: 1, to }).run()
    })
    await page.keyboard.press(`${MOD}+Shift+j`)
    await expect(terminal(page)).toBeVisible()
    const chip = terminal(page).locator('.term-chip[data-kind="ref"]')
    await expect(chip).toHaveCount(1)
    await expect(chip).toContainText('Delta report · Project Delta: open')
    await expect(chip).toContainText('3 lines')
    await expect(prompt(page)).toBeFocused()

    await run(page, 'Turn these into tasks')
    await expect.poll(() => bodies.length).toBe(1)
    const sent = userText(bodies[0])
    expect(sent).toContain(`<reference page=\\"Delta report\\" page_id=\\"${id}\\" lines=\\"3\\">`)
    expect(sent).toContain('## Project Delta: open items')
    expect(sent).toContain('- Budget review is late')
    expect(sent).not.toContain('Next check-in on Friday')
    await expect(chip).toHaveCount(0)
    await expect(terminal(page).locator('.term-turn__ctx')).toContainText('1 reference')
    await expect(prompt(page)).toHaveValue('')
  })

  test('references: two at once (bubble button + shortcut), Backspace removes the last, read-only pages, DE', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const bodies = await mockAgent(context, [() => sseMessage([{ type: 'text', text: 'Noted.' }])])
    const id = await createPage(page, { title: 'Delta report', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Budget review is late. Vendor contract unsigned.' }] }] } })
    await gotoPage(page, id)
    const editor = editorOf(page)
    await editor.click()
    await selectText(page, editor, 'Budget review is late')
    // the bubble toolbar's button
    await page.locator('.bubble').getByRole('button', { name: 'Add to terminal' }).click()
    const chips = terminal(page).locator('.term-chip[data-kind="ref"]')
    await expect(chips).toHaveCount(1)
    await expect(chips.first()).toContainText('Budget review is late')
    await expect(chips.first()).toContainText('1 line')
    // a second passage with the shortcut while the terminal is open
    await editor.click()
    await selectText(page, editor, 'Vendor contract unsigned')
    await page.keyboard.press(`${MOD}+Shift+j`)
    await expect(chips).toHaveCount(2)
    await expect(prompt(page)).toBeFocused()
    // Backspace at the start of the prompt removes the last one
    await prompt(page).press('Backspace')
    await expect(chips).toHaveCount(1)
    await expect(chips.first()).toContainText('Budget review is late')
    // × removes one too
    await chips.first().getByRole('button').click()
    await expect(chips).toHaveCount(0)

    // a read-only (locked) page: the DOM selection still works with the shortcut
    await wsEval(page, (s, id) => s.updatePageSettings(id, { locked: true }), id)
    await expect(editor).toHaveAttribute('contenteditable', 'false')
    await selectText(page, editor, 'Vendor contract')
    await page.keyboard.press(`${MOD}+Shift+j`)
    await expect(chips).toHaveCount(1)
    await expect(chips.first()).toContainText('Vendor contract')
    await run(page, 'What is this about?')
    await expect.poll(() => bodies.length).toBe(1)
    expect(userText(bodies[0])).toContain(`page_id=\\"${id}\\"`)
    expect(userText(bodies[0])).toContain('Vendor contract')

    // German: the bubble button and the chip
    await wsEval(page, (s, id) => s.updatePageSettings(id, { locked: false }), id)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await expect(editor).toHaveAttribute('contenteditable', 'true')
    await editor.click()
    await selectText(page, editor, 'Budget review')
    await page.locator('.bubble').getByRole('button', { name: 'Zum Terminal' }).click()
    const term = terminal(page, 'KI-Terminal')
    await expect(term.locator('.term-chip[data-kind="ref"]')).toContainText('1 Zeile')
    await expect(term.locator('.term-turn__ctx')).toContainText('1 Referenz')
  })

  test('references from a database row page carry the row id; ⌘J with text selected opens with it', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const bodies = await mockAgent(context, [() => sseMessage([{ type: 'text', text: 'Noted.' }])])
    const row = await pageIdByTitle(page, 'Website relaunch')
    expect(await wsEval(page, (s, id) => !!s.pages[id].databaseId, row)).toBe(true)
    await gotoPage(page, row)
    const editor = editorOf(page)
    await editor.click()
    await selectText(page, editor, 'ship something people actually use')
    // ⌘J (not ⌘⇧J) while text is selected: the terminal opens with the selection as a reference
    await page.keyboard.press(`${MOD}+j`)
    await expect(terminal(page)).toBeVisible()
    const chip = terminal(page).locator('.term-chip[data-kind="ref"]')
    await expect(chip).toHaveCount(1)
    await expect(chip).toContainText('Website relaunch · ship something')
    await expect(prompt(page)).toBeFocused()
    await run(page, 'Rephrase the goal')
    await expect.poll(() => bodies.length).toBe(1)
    expect(userText(bodies[0])).toContain(`<reference page=\\"Website relaunch\\" page_id=\\"${row}\\" lines=\\"1\\">`)
    expect(userText(bodies[0])).toContain('ship something people actually use')
    // the open row is the default context as well
    expect(userText(bodies[0])).toContain(`Open page: \\"Website relaunch\\" (id: ${row})`)
  })
})

test.describe('AI terminal on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('390 px: a full-screen sheet without horizontal overflow, hiding keeps the task', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const projects = await pageIdByTitle(page, 'Projects')
    await mockAgent(context, [
      () => sseMessage([{ type: 'tool_use', id: 'toolu_m', name: 'create_row', input: { database_id: projects, title: 'A rather long row title that has to wrap on a phone screen', properties: { Priority: 'High', Tags: ['Ops'] } } }]),
      () => sseMessage([{ type: 'text', text: 'Staged one row in **Projects**; review it below before anything changes in your workspace.' }]),
    ])
    await page.keyboard.press(`${MOD}+j`)
    const term = terminal(page)
    await expect(term).toBeVisible()
    // the whole screen (once the slide-in has settled)
    await expect
      .poll(async () => {
        const b = await term.boundingBox()
        return b && [b.x, b.y, b.width, b.height].map(Math.round)
      })
      .toEqual([0, 0, 390, 844])
    await run(page, 'Add a row')
    await expect(term.getByRole('listitem', { name: /^#1 New row/ })).toBeVisible({ timeout: 20_000 })
    const overflow = await page.evaluate(() => {
      const el = document.querySelector('.term-scroll') as HTMLElement
      return { doc: document.documentElement.scrollWidth, scroll: el.scrollWidth - el.clientWidth }
    })
    expect(overflow.doc).toBeLessThanOrEqual(390)
    expect(overflow.scroll).toBeLessThanOrEqual(0)
    // the × hides it (the session stays)
    await term.getByRole('button', { name: 'Hide the terminal' }).click()
    await expect(term).toBeHidden()
    await page.keyboard.press(`${MOD}+j`)
    await expect(term.getByRole('listitem', { name: /^#1 New row/ })).toBeVisible()
  })
})


test.describe('AI terminal: /clear and /clear-history', () => {
  test('/clear (DE /leeren) is another name of /new: Tab completes it, /help lists it, it starts over', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const bodies = await mockAgent(context, [() => sseMessage([{ type: 'text', text: 'First answer.' }]), () => sseMessage([{ type: 'text', text: 'Zweite Antwort.' }])])
    await openTerminal(page)
    await run(page, 'first task')
    await expect(terminal(page).locator('.term-answer')).toContainText('First answer.')

    // "/cl": /clear (new) first, then /clear-history; Tab takes /clear
    await prompt(page).fill('/cl')
    const list = terminal(page).getByRole('listbox')
    await expect(list.getByRole('option')).toHaveText([/^\/clear\s*new conversation/, /^\/clear-history\s*clear your prompt history/])
    await prompt(page).press('Tab')
    await expect(prompt(page)).toHaveValue('/clear')
    await prompt(page).press('Enter')
    await expect(terminal(page).locator('.term-turn')).toHaveCount(0)
    await expect(terminal(page).locator('.term-standby')).toBeVisible()

    // /help: the names of a command side by side
    await run(page, '/help')
    const help = terminal(page).locator('.term-echo[data-kind="help"]')
    await expect(help.locator('dt', { hasText: '/new' })).toHaveText('/new  /clear  /neu')
    await expect(help.locator('dt', { hasText: '/clear-history' })).toHaveText('/clear-history  /verlauf-leeren')
    await expect(help.locator('dt', { hasText: '/apply' })).toHaveText('/apply  /übernehmen')

    // German: /leeren
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const term = terminal(page, 'KI-Terminal')
    const field = term.getByRole('textbox', { name: 'Aufgabe für den Agenten' })
    await field.fill('zweite Aufgabe')
    await field.press('Enter')
    await expect(term.locator('.term-answer')).toContainText('Zweite Antwort.')
    await field.fill('/lee')
    await expect(term.getByRole('option', { name: /^\/leeren/ })).toBeVisible()
    await field.press('Tab')
    await expect(field).toHaveValue('/leeren')
    await field.press('Enter')
    await expect(term.locator('.term-turn')).toHaveCount(0)
    await field.fill('/hilfe')
    await field.press('Enter')
    const hilfe = term.locator('.term-echo[data-kind="help"]')
    await expect(hilfe.locator('dt', { hasText: /^\/neu\s/ })).toHaveText('/neu  /leeren  /new')
    await expect(hilfe.locator('dt', { hasText: '/verlauf-leeren' })).toHaveText('/verlauf-leeren  /clear-history')
    expect(bodies).toHaveLength(2)
  })

  test('/clear-history asks y / n first: n keeps the prompts, y clears this workspace’s prompts on this device', async ({ page, context }) => {
    await openApp(page)
    // no key needed: commands and their answers work without one
    const bodies = await mockAgent(context, [])
    await page.evaluate(() => {
      localStorage.setItem('one.term.history:local:local', JSON.stringify(['first task', 'second task']))
      localStorage.setItem('one.term.history:cloud:other', JSON.stringify(['a prompt of another workspace']))
    })
    const stored = () => page.evaluate(() => [localStorage.getItem('one.term.history:local:local'), localStorage.getItem('one.term.history:cloud:other')])
    await openTerminal(page)

    await prompt(page).fill('/clear-h')
    await expect(terminal(page).getByRole('option')).toHaveText([/^\/clear-history/])
    await prompt(page).press('Tab')
    await expect(prompt(page)).toHaveValue('/clear-history')
    await prompt(page).press('Enter')
    const ask = terminal(page).locator('.term-echo[data-kind="ask"]').last()
    await expect(ask).toContainText('Clear the 2 prompts of this workspace stored on this device?')
    await expect(ask.getByRole('group', { name: 'Answer y or n' }).getByRole('button')).toHaveText(['y Clear', 'n Keep'])
    await expect(prompt(page)).toHaveAttribute('placeholder', 'y or n, then ↵')

    // n: nothing goes (the answer is not a prompt of its own)
    await run(page, 'n')
    await expect(ask.locator('.term-ask__answer')).toHaveText('n')
    await expect(ask).toContainText('Kept the prompt history — nothing was cleared.')
    await expect(ask.getByRole('button')).toHaveCount(0)
    expect(await stored()).toEqual([JSON.stringify(['first task', 'second task', '/clear-history']), JSON.stringify(['a prompt of another workspace'])])

    // again, y: this workspace's prompts on this device go — another workspace's stay
    await run(page, '/clear-history')
    const ask2 = terminal(page).locator('.term-echo[data-kind="ask"]').last()
    await expect(ask2).toContainText('Clear the 2 prompts')
    await run(page, 'y')
    await expect(ask2.locator('.term-ask__answer')).toHaveText('y')
    await expect(ask2).toContainText('Prompt history cleared: 2 prompts of this workspace removed from this device.')
    expect(await stored()).toEqual([null, JSON.stringify(['a prompt of another workspace'])])
    await prompt(page).press('ArrowUp')
    await expect(prompt(page)).toHaveValue('')
    await run(page, '/clear-history')
    await expect(terminal(page).locator('.term-echo').last()).toContainText('No prompts of this workspace are stored on this device — nothing to clear.')

    // another input while the question is open drops it (as n)
    await page.evaluate(() => localStorage.setItem('one.term.history:local:local', JSON.stringify(['keep me'])))
    await run(page, '/clear-history')
    const ask3 = terminal(page).locator('.term-echo[data-kind="ask"]').last()
    await expect(ask3).toContainText('Clear the 1 prompt of this workspace')
    await run(page, '/cost')
    await expect(ask3.locator('.term-ask__answer')).toHaveText('n')
    expect(JSON.parse((await stored())[0] ?? '[]')).toContain('keep me')

    // German, answered with its key: /verlauf-leeren → Löschen
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const term = terminal(page, 'KI-Terminal')
    const field = term.getByRole('textbox', { name: 'Aufgabe für den Agenten' })
    await field.fill('/verlauf-l')
    await field.press('Tab')
    await expect(field).toHaveValue('/verlauf-leeren')
    await field.press('Enter')
    const frage = term.locator('.term-echo[data-kind="ask"]').last()
    await expect(frage).toContainText('Eingaben dieses Workspace auf diesem Gerät löschen?')
    await frage.getByRole('button', { name: 'y Löschen' }).click()
    await expect(frage).toContainText('Eingabeverlauf gelöscht:')
    await expect(field).toBeFocused()
    expect((await stored())[0]).toBeNull()
    await field.fill('/hilfe')
    await field.press('Enter')
    await expect(term.locator('.term-echo[data-kind="help"]')).toContainText('deinen Eingabeverlauf auf diesem Gerät löschen')
    expect(bodies).toHaveLength(0)
  })
})
