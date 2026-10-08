/**
 * Integration profiles (Workspace → Integrations, features/agents/integrations, store/integrations.ts): a profile is
 * active on this device while one ENABLED MCP server meets every condition of its match (tools from the last
 * connection test, a name glob, a host glob); only then are the property menu's Key / Only by hand switches,
 * upsert_rows, the agent state, notify_me, the agent editor's tool list and the profile's recipes offered. Flags and
 * allow-lists already set stay in force without one. Recipes are configuration (database, views, agent). The JSON
 * editor validates with line / column and JSON paths; profiles round-trip through export and import.
 * A mocked Claude API only — never api.anthropic.com; every MCP server is a fictional address nobody calls.
 */
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect, openApp, gotoPage, wsEval } from './fixtures'
import { mockAgent, say, call, setKey, openTerminal, run as runTask, type AnyState } from './helpers/terminal'
import { ALL_FEATURES, TRACKER_SERVER, addProfile, trackerProfile } from './helpers/integrations'

const WIKI = { id: 'm-wiki', name: 'wiki', url: 'https://wiki.example.com/mcp', token: '', enabled: true, prompt: '' }
const DOCS = { id: 'm-docs', name: 'docs', url: 'https://docs.example.org/mcp', token: '', enabled: false, prompt: '', tools: ['list_documents', 'get_document'], checkedAt: Date.now() }
const setServers = (page: Page, servers: AnyState[]) => wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), servers)
const profileOf = (id: string, match: AnyState, unlocks: string[] = [...ALL_FEATURES], extra: AnyState = {}) => ({ schema: 'one.integration/1', id, name: `Profile ${id}`, match, unlocks, ...extra })

async function openSection(page: Page) {
  await page.evaluate(() => (window.location.hash = '#/workspace/integrations'))
  await expect(page.getByTestId('ws-integrations')).toBeVisible()
}
const row = (page: Page, id: string) => page.locator(`[data-testid="int-row"][data-id="${id}"]`)

/** A "Tickets" database: Ticket (text) · Notes (text) — flags as given — and two rows. */
async function tickets(page: Page, flags: { key?: boolean; hand?: boolean } = {}): Promise<{ db: string; a: string; b: string }> {
  return wsEval(
    page,
    (s, f) => {
      const db = s.createDatabase({
        title: 'Tickets',
        parentId: null,
        properties: [
          { id: 'tk-title', name: 'Name', type: 'title' },
          { id: 'tk-ticket', name: 'Ticket', type: 'text', ...(f.key ? { key: true } : {}) },
          { id: 'tk-notes', name: 'Notes', type: 'text', ...(f.hand ? { agentReadOnly: true } : {}) },
        ],
      })
      const view = (window as AnyState).__one.workspace.getState().databases[db].views[0]
      s.updateView(db, view.id, { type: 'table', visibleProperties: ['tk-title', 'tk-ticket', 'tk-notes'] })
      const a = s.createRow(db, { title: 'Login fails', properties: { 'tk-ticket': '8215', 'tk-notes': 'Call back first' } })
      const b = s.createRow(db, { title: 'Export broken', properties: { 'tk-ticket': '8216' } })
      return { db, a, b }
    },
    flags,
  )
}
const header = (page: Page, name: string) => page.locator('#main section.db').getByRole('columnheader', { name: new RegExp(`^${name}`) })
const propMenu = (page: Page) => page.locator('.db-propmenu')

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
  await page.getByRole('button', { name: 'Run now' }).click()
  await expect(page.locator('.agx-run').first()).toHaveAttribute('data-status', /staged|ok|error/, { timeout: 30_000 })
}
const toolNames = (body: AnyState) => (body.tools as AnyState[]).filter((t) => t.name).map((t) => t.name as string)

test.describe('Integration profiles', () => {
  test('matching on this device: tools, name, host; a switched-off or untested server; the LED and why', async ({ page }) => {
    await openApp(page)
    await setServers(page, [TRACKER_SERVER, WIKI, DOCS])
    for (const p of [
      profileOf('by-tools', { tools: ['list_items', 'get_item'] }),
      profileOf('missing-tool', { tools: ['list_items', 'delete_all'] }),
      profileOf('by-name', { name: 'wik?' }),
      profileOf('untested', { name: 'wiki', tools: ['list_pages'] }),
      profileOf('switched-off', { host: '*.example.org' }),
      profileOf('by-host', { host: 'TRACKER.example.com', name: 'track*' }),
      profileOf('draft', {}),
    ])
      expect(await addProfile(page, p)).toBe(true)
    await openSection(page)
    const status = (id: string) => row(page, id).getByTestId('int-status')
    await expect(status('by-tools')).toHaveText('Active · matches TRACKER')
    await expect(status('missing-tool')).toHaveText('Inactive · no enabled MCP server offers delete_all')
    await expect(status('by-name')).toHaveText('Active · matches WIKI')
    await expect(status('untested')).toHaveText('Inactive · WIKI was never tested (no tool list yet)')
    await expect(status('switched-off')).toHaveText('Inactive · DOCS is switched off')
    await expect(status('by-host')).toHaveText('Active · matches TRACKER')
    await expect(status('draft')).toHaveText('Inactive · no match conditions')
    await expect(row(page, 'by-tools')).toHaveAttribute('data-active', 'true')
    await expect(row(page, 'draft')).not.toHaveAttribute('data-active')
    await expect(page.getByTestId('int-unlocked').locator('[data-on]')).toHaveCount(6)

    // the tracker switched off: its profiles go inactive; switched on again, they are back
    await setServers(page, [{ ...TRACKER_SERVER, enabled: false }, WIKI])
    await expect(status('by-tools')).toHaveText('Inactive · TRACKER is switched off')
    await setServers(page, [TRACKER_SERVER])
    await expect(status('by-tools')).toHaveText('Active · matches TRACKER')
  })

  test('without an active profile nothing is offered — flags and tool lists already set still hold', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    await setServers(page, [TRACKER_SERVER])
    const t = await tickets(page, { key: true, hand: true })

    // property menu: no switches, only the marks of what is set
    await gotoPage(page, t.db)
    await header(page, 'Ticket').click()
    await expect(propMenu(page).getByRole('switch')).toHaveCount(0)
    await expect(propMenu(page).getByTestId('db-flag-key-mark')).toBeVisible()
    await expect(propMenu(page)).toContainText('Set earlier and still in force. An active integration unlocks the switch.')
    await page.keyboard.press('Escape')
    await header(page, 'Notes').click()
    await expect(propMenu(page).getByRole('switch')).toHaveCount(0)
    await expect(propMenu(page).getByTestId('db-flag-hand-mark')).toBeVisible()
    await page.keyboard.press('Escape')

    // a custom agent: no upsert_rows, no state, no notes — and the prompt does not name them; its tool list still applies
    const m = await mockAgent(context, [
      call('a1', 'update_row', { id: t.a, properties: { Notes: 'from the agent' } }),
      call('a2', 'create_row', { database_id: t.db, title: 'Twin', properties: { Ticket: '8216' } }),
      say('Done.'),
    ])
    const id = await addAgent(page, { id: 'ag-plain', name: 'Plain agent', mcpServers: ['tracker'], mcpTools: { tracker: ['list_items'] } })
    await runAgent(page, id)
    const names = toolNames(m.bodies[0])
    for (const gated of ['upsert_rows', 'agent_state_get', 'agent_state_set', 'notify_me']) expect(names).not.toContain(gated)
    expect(m.bodies[0].system).not.toContain('upsert_rows')
    expect(m.bodies[0].system).not.toContain('notify_me')
    expect(m.bodies[0].tools.filter((x: AnyState) => x.type === 'mcp_toolset')).toEqual([{ type: 'mcp_toolset', mcp_server_name: 'tracker', default_config: { enabled: false }, configs: { list_items: { enabled: true } } }])
    // enforcement: the protected field and the taken key are refused
    const results = JSON.stringify(m.bodies[2].messages)
    expect(results).toMatch(/Notes.{0,8} is filled in only by hand/)
    expect(results).toContain('unique per row')
    expect(await wsEval(page, (s, a) => s.pages[a].properties['tk-notes'], t.a)).toBe('Call back first')

    // the editor: no tool list, the kept one read-only
    await page.getByRole('button', { name: 'Edit' }).click()
    const editor = page.locator('.agx-editor')
    await expect(editor.getByRole('group', { name: 'Tools of TRACKER' })).toHaveCount(0)
    await expect(editor.getByTestId('agx-tools-kept')).toContainText('1 allowed tools')
    await page.keyboard.press('Escape')

    // the gallery: no mirror recipe
    await wsEval(page, (s) => s.deleteAgent('ag-plain'))
    await page.evaluate(() => (window.location.hash = '#/agents'))
    await expect(page.locator('.agx-start [data-recipe]')).not.toHaveCount(0)
    await expect(page.locator('[data-recipe*="mirror"]')).toHaveCount(0)

    // the AI terminal: no upsert_rows either
    const term = await mockAgent(context, [say('Nothing to do.')])
    await openTerminal(page)
    await runTask(page, 'Mirror the tracker into Tickets')
    await expect.poll(() => term.bodies.length).toBeGreaterThan(0)
    expect(toolNames(term.bodies[0])).not.toContain('upsert_rows')
    expect(term.bodies[0].system).not.toContain('upsert_rows')
  })

  test('each feature is unlocked on its own; a profile whose server goes off locks it again', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    await setServers(page, [TRACKER_SERVER])
    const t = await tickets(page)
    await addProfile(page, profileOf('keys-only', { name: 'tracker' }, ['keys']))
    await gotoPage(page, t.db)
    await header(page, 'Ticket').click()
    await expect(propMenu(page).getByRole('switch', { name: 'Key' })).toBeVisible()
    await expect(propMenu(page).getByRole('switch', { name: 'Only by hand' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await addProfile(page, profileOf('keys-only', { name: 'tracker' }, ['keys', 'onlyByHand']))
    await header(page, 'Ticket').click()
    await expect(propMenu(page).getByRole('switch', { name: 'Only by hand' })).toBeVisible()
    await page.keyboard.press('Escape')

    // tools per feature: upsert alone, then the state and notes
    const m = await mockAgent(context, [say('ok'), say('ok'), say('ok')])
    const id = await addAgent(page, { id: 'ag-feat', name: 'Feature agent' })
    await addProfile(page, profileOf('keys-only', { name: 'tracker' }, ['upsert']))
    await runAgent(page, id)
    expect(toolNames(m.bodies[0])).toContain('upsert_rows')
    expect(toolNames(m.bodies[0])).not.toContain('agent_state_get')
    expect(m.bodies[0].system).toContain('use upsert_rows')
    await addProfile(page, profileOf('keys-only', { name: 'tracker' }, ['agentState', 'notify']))
    await page.getByRole('button', { name: 'Run now' }).click()
    await expect.poll(() => m.bodies.length).toBe(2)
    expect(toolNames(m.bodies[1]).slice(-3)).toEqual(['agent_state_get', 'agent_state_set', 'notify_me'])
    expect(toolNames(m.bodies[1])).not.toContain('upsert_rows')
    expect(m.bodies[1].system).toContain('notify_me leaves the person a short note')

    // the editor's tool list follows 'toolAllowList'
    await page.getByRole('button', { name: 'Edit' }).click()
    const editor = page.locator('.agx-editor')
    await editor.getByRole('checkbox', { name: 'TRACKER' }).check()
    await expect(editor.getByRole('group', { name: 'Tools of TRACKER' })).toHaveCount(0)
    await addProfile(page, profileOf('keys-only', { name: 'tracker' }, ['toolAllowList']))
    await expect(editor.getByRole('group', { name: 'Tools of TRACKER' })).toBeVisible()
    // the server switched off: locked again
    await setServers(page, [{ ...TRACKER_SERVER, enabled: false }])
    await expect(editor.getByRole('group', { name: 'Tools of TRACKER' })).toHaveCount(0)
  })

  test('a profile’s recipe builds the database, its views and the agent from configuration', async ({ page }) => {
    await openApp(page)
    await setServers(page, [TRACKER_SERVER])
    const recipe = {
      kind: 'mirror',
      id: 'orders',
      name: { en: 'Mirror open orders', de: 'Offene Bestellungen spiegeln' },
      description: 'Orders of the shop, every Monday.',
      icon: 'Package',
      color: 'green',
      database: {
        name: 'Orders',
        properties: [
          { role: 'name', name: 'Order', type: 'title' },
          { role: 'key', name: 'Order no.', type: 'number', key: true, description: 'The shop’s order number.' },
          { name: 'Stage', type: 'status', options: [{ name: 'New' }, { name: 'Packing' }, { name: 'Shipped' }] },
          { name: 'Carrier', type: 'select', color: 'blue', options: ['Post', { name: 'Courier', color: 'orange' }] },
          { name: 'Ship by', type: 'date' },
          { name: 'Rush', type: 'checkbox' },
          { name: 'My note', type: 'text', onlyByHand: true },
        ],
        views: [
          { name: 'By stage', type: 'board', groupBy: 'Stage', properties: ['Order no.', 'Carrier', 'Ship by'], hiddenGroups: ['Shipped'], hideEmpty: true, colorRules: [{ when: { property: 'Rush', op: 'is_checked' }, color: 'red' }] },
          { name: 'Due soon', type: 'table', filter: { and: [{ property: 'Ship by', op: 'on_or_before', value: 'one_week_from_now' }, { or: [{ property: 'Carrier', op: 'is', value: 'Courier' }, { property: 'Rush', op: 'is_checked' }] }] }, sort: [{ property: 'Ship by' }] },
          { name: 'Calendar', type: 'calendar', date: 'Ship by' },
        ],
      },
      agent: {
        name: 'Orders · {db}',
        schedule: { every: 'week', at: '06:15', weekday: 1 },
        write: 'apply',
        budget: 2.5,
        effort: 'low',
        tools: ['list_items'],
        instructions: 'Read the open orders of {server} into “{db}” by “Order no.”; the report goes to {report}. Shop region: [WHICH SHOP REGION].',
      },
      report: { name: '{db} — weekly log' },
    }
    await addProfile(page, profileOf('shop', { tools: ['list_items'] }, [...ALL_FEATURES], { name: 'Shop', recipes: [recipe] }))
    await page.evaluate(() => (window.location.hash = '#/agents'))
    const card = page.locator('.agx-start [data-recipe="shop:orders"]')
    await expect(card).toContainText('Mirror open orders')
    await expect(card).toContainText('Shop')
    await card.click()
    const setup = page.locator('.agx-mir')
    await expect(setup.getByRole('heading', { name: 'Mirror open orders' })).toBeVisible()
    await expect(setup.getByRole('radio', { name: /TRACKER/ })).toBeChecked()
    await expect(setup.getByRole('textbox', { name: /Name/ })).toHaveValue('Orders')
    const spec = setup.getByTestId('agx-mir-spec')
    await expect(spec).toContainText('7 properties · 3 views · key: Order no.')
    await expect(spec).toContainText('My note')
    await expect(spec).toContainText('Mondays · 06:15 · applies directly · $2.50 per run')
    await expect(spec).toContainText('Orders — weekly log')
    await setup.getByRole('button', { name: 'Create database and agent' }).click()

    const made = await wsEval(page, (s) => {
      const p = (Object.values(s.pages) as AnyState[]).find((x) => x.kind === 'database' && x.title === 'Orders')!
      return { page: JSON.parse(JSON.stringify(p)), db: JSON.parse(JSON.stringify(s.databases[p.id])) }
    })
    const db = made.db
    const prop = (name: string) => db.properties.find((p: AnyState) => p.name === name)
    const opt = (p: string, name: string) => prop(p).options.find((o: AnyState) => o.name === name).id
    expect(made.page.icon).toEqual({ type: 'lucide', value: 'Package', color: 'green' })
    expect(db.properties.map((p: AnyState) => [p.name, p.type])).toEqual([
      ['Order', 'title'],
      ['Order no.', 'number'],
      ['Stage', 'status'],
      ['Carrier', 'select'],
      ['Ship by', 'date'],
      ['Rush', 'checkbox'],
      ['My note', 'text'],
    ])
    expect(prop('Order no.')).toMatchObject({ key: true, description: 'The shop’s order number.' })
    expect(prop('My note').agentReadOnly).toBe(true)
    expect(prop('Stage').options.map((o: AnyState) => [o.name, o.group])).toEqual([
      ['New', 'todo'],
      ['Packing', 'in_progress'],
      ['Shipped', 'done'],
    ])
    expect(prop('Carrier').options.map((o: AnyState) => [o.name, o.color])).toEqual([
      ['Post', 'blue'],
      ['Courier', 'orange'],
    ])
    const [board, due, cal] = db.views
    expect(db.views.map((v: AnyState) => [v.name, v.type])).toEqual([
      ['By stage', 'board'],
      ['Due soon', 'table'],
      ['Calendar', 'calendar'],
    ])
    expect(board.groupBy).toBe(prop('Stage').id)
    expect(board.visibleProperties).toEqual([prop('Order no.').id, prop('Carrier').id, prop('Ship by').id])
    expect(board.hiddenGroups).toEqual(['__none__', opt('Stage', 'Shipped')])
    expect(board.colorRules.map((r: AnyState) => [r.filter.items[0].propertyId, r.filter.items[0].operator, r.color])).toEqual([[prop('Rush').id, 'is_checked', 'red']])
    expect(due.filter.op).toBe('and')
    expect(due.filter.items[0]).toMatchObject({ propertyId: prop('Ship by').id, operator: 'on_or_before', value: { start: 'one_week_from_now' } })
    expect(due.filter.items[1].op).toBe('or')
    expect(due.filter.items[1].items[0]).toMatchObject({ propertyId: prop('Carrier').id, operator: 'is', value: opt('Carrier', 'Courier') })
    expect(due.sorts).toEqual([{ propertyId: prop('Ship by').id, direction: 'asc' }])
    expect(cal.dateProperty).toBe(prop('Ship by').id)

    // the agent draft
    const editor = page.locator('.agx-editor')
    await expect(editor.getByTestId('agx-editor-intro')).toContainText('Replace the part in [SQUARE BRACKETS]')
    await expect(editor.getByRole('textbox', { name: 'Name' })).toHaveValue('Orders · Orders')
    const instructions = await editor.getByRole('textbox', { name: 'Instructions' }).inputValue()
    expect(instructions).toBe('Read the open orders of tracker into “Orders” by “Order no.”; the report goes to Orders — weekly log. Shop region: [WHICH SHOP REGION].')
    const strip = editor.getByTestId('agx-placeholders')
    await expect(strip.locator('.agx-ph__btn')).toHaveText(['[WHICH SHOP REGION]'])
    await expect(strip).toContainText('A part the recipe leaves to you')
    await strip.locator('.agx-ph__btn').click()
    await page.keyboard.insertText('EU')
    await editor.getByRole('button', { name: 'Create agent', exact: true }).click()
    await expect(page.locator('.agx-dhead')).toBeVisible()
    const agent = await wsEval(page, (s) => JSON.parse(JSON.stringify(Object.values(s.agents)[0])))
    expect(agent).toMatchObject({
      name: 'Orders · Orders',
      icon: { type: 'lucide', value: 'Package', color: 'green' },
      trigger: { type: 'schedule', every: 'week', weekday: 1, at: '06:15', tz: 'Europe/Berlin' },
      scope: { everything: false, databases: [made.page.id] },
      write: 'apply',
      effort: 'low',
      maxRunUsd: 2.5,
      mcpServers: ['tracker'],
      mcpTools: { tracker: ['list_items'] },
      enabled: true,
    })
    const report = await wsEval(page, (s) => (Object.values(s.pages) as AnyState[]).find((p) => p.title === 'Orders — weekly log')?.id ?? null)
    expect(agent.output).toEqual({ pageId: report, mode: 'append' })
  })

  test('a recipe with problems is offered but cannot build — the setup says so', async ({ page }) => {
    await openApp(page)
    await setServers(page, [TRACKER_SERVER])
    await addProfile(page, profileOf('broken', { name: 'tracker' }, [...ALL_FEATURES], { recipes: [{ kind: 'mirror', database: { properties: [{ name: 'Name', type: 'title' }, { name: 'Item', type: 'text', key: true }] } }] }))
    await page.evaluate(() => (window.location.hash = '#/agents'))
    await page.locator('.agx-start [data-recipe="broken:mirror"]').click()
    const setup = page.locator('.agx-mir')
    await expect(setup.getByTestId('agx-mir-broken')).toContainText('cannot build its database')
    await expect(setup.getByRole('button', { name: 'Create database and agent' })).toBeDisabled()
    await setup.getByRole('button', { name: 'Workspace → Integrations' }).click()
    await expect(page.getByTestId('ws-integrations')).toBeVisible()
  })

  test('New from a server · live validation with line:col and JSON paths · save, edit, delete with Undo', async ({ page }) => {
    await openApp(page)
    await setServers(page, [TRACKER_SERVER])
    await openSection(page)
    await expect(page.getByTestId('int-empty')).toBeVisible()
    await page.getByTestId('int-new').click()
    await page.getByRole('menuitem', { name: /TRACKER/ }).click()
    const dialog = page.locator('.int-editor')
    const area = dialog.getByTestId('jca-input')
    const status = dialog.getByTestId('int-editor-status')
    await expect(status).toHaveText(/^Valid · active here \(matches TRACKER\) · unlocks Key · Only by hand · Upsert rows · MCP tool list · Agent state · Inbox notes · 1 recipe$/)
    const draft = JSON.parse(await area.inputValue())
    expect(draft.match).toEqual({ tools: ['list_items', 'get_item', 'search_items', 'whoami'], name: 'tracker' })
    expect(draft.recipes[0].database.properties).toHaveLength(20)

    // a syntax error: line and column
    const text = await area.inputValue()
    const lines = text.split('\n')
    const at = lines.findIndex((l) => l.includes('"name": "Integration for tracker"'))
    await area.fill(text.replace('"name": "Integration for tracker",', '"name": "Integration for tracker"'))
    await expect(status).toContainText('1 error')
    const problem = dialog.getByTestId('int-problems').locator('li').first()
    await expect(problem).toContainText(`${at + 2}:3`)
    await expect(problem).toContainText('Expected “,” or a closing bracket, found “"”.')
    await expect(dialog.getByTestId('int-save')).toBeDisabled()

    // schema problems: the path and the line of the value
    const groupLine = lines.findIndex((l) => l.includes('"groupBy": "Clarity"'))
    await area.fill(text.replace('"groupBy": "Clarity"', '"groupBy": "Clarty"').replace('"unlocks": [', '"unlock": ['))
    await expect(status).toContainText('errors')
    const list = dialog.getByTestId('int-problems')
    await expect(list).toContainText('$.recipes[0].database.views[0].groupBy')
    await expect(list).toContainText('No property “Clarty”. Did you mean “Clarity”?')
    await expect(list.locator('li', { hasText: '$.recipes[0].database.views[0].groupBy' })).toContainText(`${groupLine + 1}:`)
    await expect(list).toContainText('Unknown key “unlock”.')
    await expect(list).toContainText('“unlocks” is missing.')
    // a click puts the caret on the problem's line
    await list.locator('li', { hasText: 'groupBy' }).getByRole('button').click()
    await expect(area).toBeFocused()
    expect(await area.evaluate((el: HTMLTextAreaElement) => el.value.slice(0, el.selectionStart).split('\n').length)).toBe(groupLine + 1)
    await expect(dialog.locator(`.jca__ln[data-mark="error"]`).first()).toBeVisible()

    // fixed: saved, active
    await area.fill(text)
    await dialog.getByTestId('int-save').click()
    await expect(row(page, 'tracker')).toContainText('Integration for tracker')
    await expect(row(page, 'tracker').getByTestId('int-status')).toHaveText('Active · matches TRACKER')
    const saved = await wsEval(page, (s) => JSON.parse(JSON.stringify(s.integrations)))
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ schema: 'one.integration/1', id: 'tracker', unlocks: [...ALL_FEATURES] })

    // edit: a new name
    await row(page, 'tracker').getByRole('button', { name: /^Edit/ }).click()
    const again = page.locator('.int-editor').getByTestId('jca-input')
    await again.fill((await again.inputValue()).replace('"name": "Integration for tracker"', '"name": "Item tracker"'))
    await page.locator('.int-editor').getByTestId('int-save').click()
    await expect(row(page, 'tracker')).toContainText('Item tracker')

    // delete, then Undo
    await row(page, 'tracker').getByRole('button', { name: 'Delete: Item tracker' }).click()
    await expect(row(page, 'tracker')).toHaveCount(0)
    await page.locator('.toast').filter({ hasText: '“Item tracker” deleted.' }).getByRole('button', { name: 'Undo' }).click()
    await expect(row(page, 'tracker')).toContainText('Item tracker')
  })

  test('the template starts inactive (no match); export and import round-trip a profile', async ({ page }) => {
    await openApp(page)
    await setServers(page, [TRACKER_SERVER])
    await openSection(page)
    await page.getByTestId('int-new').click()
    await page.getByRole('menuitem', { name: 'From the template' }).click()
    const dialog = page.locator('.int-editor')
    await expect(dialog.getByTestId('int-editor-status')).toContainText('not active on this device')
    await expect(dialog.getByTestId('int-problems')).toContainText('No match conditions')
    const tpl = JSON.parse(await dialog.getByTestId('jca-input').inputValue())
    expect(tpl.match).toEqual({})
    expect(tpl.recipes[0].agent.instructions).toContain('[HOW TO LIST THE ITEMS]')
    expect(tpl.recipes[0].agent.instructions).toContain('{db}')
    await page.keyboard.press('Escape')

    const original = profileOf('round-trip', { host: '*.example.com', tools: ['list_items'] }, ['keys', 'upsert'], {
      name: 'Round trip',
      description: 'Exported and imported again.',
      recipes: [{ kind: 'mirror', name: { en: 'Copy', de: 'Kopie' }, agent: { budget: 0.75 } }],
    })
    await addProfile(page, original)
    const exported = await wsEval(page, (s) => JSON.parse(JSON.stringify(s.integrations[0])))
    const [download] = await Promise.all([page.waitForEvent('download'), row(page, 'round-trip').getByRole('button', { name: 'Export: Round trip' }).click()])
    expect(download.suggestedFilename()).toBe('round-trip.integration.json')
    const file = await download.path()
    const json = JSON.parse(readFileSync(file!, 'utf8'))
    // the export is the sanitized profile: the recipe got its default id (its kind)
    expect(json).toEqual({ ...original, recipes: [{ id: 'mirror', ...original.recipes[0] }] })
    expect(json.updatedAt).toBeUndefined()

    // gone, then imported from the file
    await row(page, 'round-trip').getByRole('button', { name: 'Delete: Round trip' }).click()
    await page.getByTestId('int-import').click()
    const imp = page.locator('.int-editor')
    await expect(imp).toContainText('Paste the JSON of an integration profile here')
    await imp.getByTestId('int-file').setInputFiles(file!)
    await expect(imp.getByTestId('int-editor-status')).toContainText('Valid')
    await imp.getByRole('button', { name: 'Add integration' }).click()
    await expect(row(page, 'round-trip')).toBeVisible()
    const back = await wsEval(page, (s) => JSON.parse(JSON.stringify(s.integrations[0])))
    const { updatedAt: _a, updatedBy: _b, ...strip } = back
    const { updatedAt: _c, updatedBy: _d, ...before } = exported
    expect(strip).toEqual(before)

    // importing a profile with a known id replaces it (the status line says so)
    await page.getByTestId('int-import').click()
    await page.locator('.int-editor').getByTestId('jca-input').fill(JSON.stringify({ ...original, name: 'Round trip 2' }))
    await expect(page.locator('.int-editor').getByTestId('int-editor-status')).toContainText('replaces “Round trip” (same id)')
    await page.locator('.int-editor').getByRole('button', { name: 'Add integration' }).click()
    await expect(row(page, 'round-trip')).toContainText('Round trip 2')
    expect(await wsEval(page, (s) => s.integrations.length)).toBe(1)
  })

  test('full backups carry the profiles, a reload keeps them; German UI', async ({ page }) => {
    await openApp(page)
    await addProfile(page, trackerProfile())
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await page.evaluate(() => (window as AnyState).__one.flushSave())
    await page.reload()
    await page.waitForFunction(() => !!(window as AnyState).__one)
    expect(await wsEval(page, (s) => s.integrations.map((p: AnyState) => p.id))).toEqual(['tracker'])
    await openSection(page)
    await expect(page.locator('.wsp-head__title')).toContainText('Integrationen')
    await expect(row(page, 'tracker').getByTestId('int-status')).toHaveText('Inaktiv · kein eingeschalteter MCP-Server passt')
  })

  test('390 px: the section and the editor fit the phone width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openApp(page)
    await setServers(page, [TRACKER_SERVER])
    await addProfile(page, trackerProfile())
    await openSection(page)
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && [...document.querySelectorAll('.modal__body')].every((el) => el.scrollWidth <= el.clientWidth + 1))
    expect(await fits()).toBe(true)
    await row(page, 'tracker').getByRole('button', { name: /^Edit/ }).click()
    await expect(page.locator('.int-editor').getByTestId('jca-input')).toBeVisible()
    expect(await fits()).toBe(true)
  })
  test('hostile values are reported, never thrown: an own "toString", objects where text belongs', async ({ page }) => {
    await openApp(page)
    await openSection(page)
    await page.getByTestId('int-import').click()
    const dialog = page.locator('.int-editor')
    const area = dialog.getByTestId('jca-input')
    const status = dialog.getByTestId('int-editor-status')
    const list = dialog.getByTestId('int-problems')
    const evil = { toString: 1 }
    await area.fill(JSON.stringify({ schema: 'one.integration/1', id: evil, name: 'X', match: { tools: ['a'] }, unlocks: [] }))
    await expect(status).toContainText('1 error')
    await expect(list).toContainText('“{"toString":1}” is not a valid id')
    // every checked value of the kind: schema, tools, a recipe's colour, icon, role, time, model, agent tools
    await area.fill(
      JSON.stringify({
        schema: evil,
        id: 'x',
        name: 'X',
        match: { tools: [evil] },
        unlocks: [],
        recipes: [
          {
            kind: 'mirror',
            color: evil,
            icon: evil,
            database: { properties: [{ name: 'N', type: 'title', role: evil }, { name: 'K', type: 'text', key: true, color: evil }], views: [{ name: 'All', type: 'table' }] },
            agent: { schedule: { every: 'day', at: evil }, model: evil, tools: [evil] },
          },
        ],
      }),
    )
    await expect(status).toContainText('errors')
    for (const path of ['$.schema', '$.match.tools[0]', '$.recipes[0].color', '$.recipes[0].icon', '$.recipes[0].database.properties[0].role', '$.recipes[0].database.properties[1].color', '$.recipes[0].agent.schedule.at', '$.recipes[0].agent.model', '$.recipes[0].agent.tools[0]'])
      await expect(list.locator('li', { hasText: path }).first()).toContainText('{"toString":1}')
    await expect(page.getByTestId('ws-integrations')).toBeVisible()
    await expect(dialog.getByTestId('int-save')).toBeDisabled()
    // the store's sanitizer refuses it the same way
    expect(await addProfile(page, { schema: 'one.integration/1', id: evil, name: 'X', match: { name: 'x' }, unlocks: [] })).toBe(false)
  })

  test('a recipe with its own properties and no instructions: the agent hears only of them (the help example)', async ({ page }) => {
    await openApp(page)
    await setServers(page, [TRACKER_SERVER])
    // the example of the help article, verbatim
    const md = readFileSync(new URL('../../src/app/help/articles/en/integrations.md', import.meta.url), 'utf8')
    const example = JSON.parse(/```json\n([\s\S]+?)\n```/.exec(md)![1])
    expect(example.recipes[0].agent.instructions).toBeUndefined()
    expect(await addProfile(page, example)).toBe(true)
    await openSection(page)
    await row(page, 'item-tracker').getByRole('button', { name: /^Edit/ }).click()
    await expect(page.locator('.int-editor').getByTestId('int-editor-status')).toHaveText(/^Valid · active here \(matches TRACKER\)/)
    await page.keyboard.press('Escape')
    await page.evaluate(() => (window.location.hash = '#/agents'))
    await page.locator('.agx-start [data-recipe="item-tracker:mirror"]').click()
    await page.locator('.agx-mir').getByRole('button', { name: 'Create database and agent' }).click()
    const editor = page.locator('.agx-editor')
    const instructions = await editor.getByRole('textbox', { name: 'Instructions' }).inputValue()
    const props = await wsEval(page, (s) => {
      const p = (Object.values(s.pages) as AnyState[]).find((x) => x.kind === 'database' && x.title === 'Items')!
      return s.databases[p.id].properties.map((x: AnyState) => x.name)
    })
    expect(props).toEqual(['Name', 'Item', 'State', 'My note'])
    expect(instructions).toContain('key_property "Item"')
    expect(instructions).toContain('Per item: title = its title, key = its id, plus State.')
    expect(instructions).toContain('Never write My note: it is mine (only by hand).')
    expect(instructions).toContain('- Read one item: [HOW TO READ ONE ITEM]')
    expect(instructions).toContain('leave it as it is — never delete the row')
    // nothing of the built-in recipe it does not have
    for (const absent of ['Link', 'Source status', 'Owner', 'Clarity', 'Waiting on me', 'Gone from source', 'My status', 'Next step', 'notify_me', '[WHO I AM IN THE SOURCE]', 'comments'])
      expect(instructions).not.toContain(absent)
    const strip = editor.getByTestId('agx-placeholders')
    await expect(strip.locator('.agx-ph__btn')).toHaveText(['[HOW TO LIST THE ITEMS]', '[HOW TO READ ONE ITEM]'])
    await expect(strip).toContainText('Which tool reads one item — e.g. “get_item with the id”.')
  })

  test('at most 50 profiles: the store refuses the 51st, the editor says so, a backup merge leaves the rest out and tells', async ({ page }) => {
    await openApp(page)
    const added = await wsEval(page, (s) => {
      const p = (i: number) => ({ schema: 'one.integration/1', id: `p${String(i).padStart(2, '0')}`, name: `P ${i}`, match: { name: 'tracker' }, unlocks: ['keys'] })
      const ok: boolean[] = []
      for (let i = 0; i < 51; i++) ok.push(s.upsertIntegration(p(i)))
      // a known id is replaced; an edit that renames one replaces it in the same step
      ok.push(s.upsertIntegration({ ...p(3), name: 'P 3 again' }))
      ok.push(s.upsertIntegration({ ...p(4), id: 'p04-renamed' }, 'p04'))
      const now = (window as AnyState).__one.workspace.getState().integrations as AnyState[]
      return { ok, n: now.length, ids: now.map((x) => x.id) }
    })
    expect(added.ok.slice(0, 50).every(Boolean)).toBe(true)
    expect(added.ok[50]).toBe(false)
    expect(added.ok.slice(51)).toEqual([true, true])
    expect(added.n).toBe(50)
    expect(added.ids).toContain('p04-renamed')
    expect(added.ids).not.toContain('p04')
    await page.evaluate(() => (window as AnyState).__one.flushSave())
    await page.reload()
    await page.waitForFunction(() => !!(window as AnyState).__one)
    expect(await wsEval(page, (s) => s.integrations.length)).toBe(50)

    // the editor: a new one is refused before saving; an existing one still saves
    await openSection(page)
    await page.getByTestId('int-import').click()
    const dialog = page.locator('.int-editor')
    await dialog.getByTestId('jca-input').fill(JSON.stringify(profileOf('one-more', { name: 'tracker' }, ['keys'])))
    await expect(dialog.getByTestId('int-problems')).toContainText('A workspace holds at most 50 integrations: delete one first.')
    await expect(dialog.getByTestId('int-save')).toBeDisabled()
    await dialog.getByTestId('jca-input').fill(JSON.stringify(profileOf('p05', { name: 'tracker' }, ['keys'], { name: 'P 5 imported' })))
    await expect(dialog.getByTestId('int-editor-status')).toContainText('replaces “P 5”')
    await dialog.getByTestId('int-save').click()
    await expect(row(page, 'p05')).toContainText('P 5 imported')

    // a backup with three new ones, merged while two places are free
    await wsEval(page, (s) => ['p10', 'p11'].forEach((id) => s.deleteIntegration(id)))
    const backup = { pages: {}, databases: {}, integrations: ['x1', 'x2', 'x3'].map((id) => profileOf(id, { name: 'tracker' }, ['keys'])) }
    await page.locator('.sb').getByRole('button', { name: /^Import/ }).click()
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('dialog').getByRole('button', { name: 'Choose files' }).click()
    await (await chooser).setFiles([{ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) }])
    const io = page.getByRole('dialog')
    await io.getByRole('radio', { name: /Merge into this workspace/ }).click()
    await io.getByRole('button', { name: 'Merge backup' }).click()
    await expect(io.getByTestId('io-integrations-left')).toHaveText('One integration of the backup was left out: a workspace holds at most 50.')
    const ids = await wsEval(page, () => ((window as AnyState).__one.workspace.getState().integrations as AnyState[]).map((x) => x.id))
    expect(ids).toHaveLength(50)
    expect(ids).toEqual(expect.arrayContaining(['x1', 'x2']))
    expect(ids).not.toContain('x3')
  })

  test('long texts stay responsive: "did you mean" is bounded, a text past the limit is plain, a huge paste is not taken', async ({ page }) => {
    await openApp(page)
    await openSection(page)
    await page.getByTestId('int-import').click()
    const dialog = page.locator('.int-editor')
    const area = dialog.getByTestId('jca-input')
    const status = dialog.getByTestId('int-editor-status')
    const setValue = (v: string) =>
      area.evaluate((el: HTMLTextAreaElement, text) => {
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
        set.call(el, text)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }, v)

    // 40 properties with 190-character names, 12 views × 40 references that miss them by a little (~110,000 characters)
    const nm = (i: number, c: string) => (c + String(i).padStart(3, '0')).padEnd(190, c)
    const properties = [{ name: 'T', type: 'title' }, { name: 'K', type: 'text', key: true }, ...Array.from({ length: 38 }, (_, i) => ({ name: { en: nm(i, 'a'), de: nm(i, 'b') }, type: 'text' }))]
    const views = Array.from({ length: 12 }, (_, v) => ({ name: `v${v}`, type: 'table', properties: Array.from({ length: 40 }, (_, i) => nm(v * 40 + i, 'c')) }))
    const slow = JSON.stringify(profileOf('slow', { name: 'x' }, [], { recipes: [{ kind: 'mirror', database: { properties, views } }] }))
    expect(slow.length).toBeLessThan(200_000)
    const t0 = Date.now()
    await setValue(slow)
    await expect(status).toContainText('errors', { timeout: 30_000 })
    expect(Date.now() - t0).toBeLessThan(5_000)
    await expect(dialog.getByTestId('int-problems')).toContainText('No property “c000')

    // 8,000 lines (past the profile limit): a plain field, the problem says why, only the lines in view are numbered
    const lines = '{\n' + Array.from({ length: 8_000 }, (_, i) => `  "k${i}": "${'x'.repeat(20)}",`).join('\n') + '\n  "z": 1\n}'
    expect(lines.length).toBeGreaterThan(200_000)
    await setValue(lines)
    await expect(status).toContainText('1 error')
    await expect(dialog.getByTestId('int-problems')).toContainText('Too long for a profile (at most 200,000 characters).')
    await expect(dialog.locator('.jca')).toHaveAttribute('data-plain', 'true')
    await expect(dialog.locator('.jca__layer')).toHaveCount(0)
    expect(await dialog.locator('.jca__ln').count()).toBeLessThan(200)
    // scrolled to the end: the last line numbers are there
    await area.evaluate((el) => (el.scrollTop = el.scrollHeight))
    await expect(dialog.locator('.jca__ln').last()).toHaveText('8003')

    // a profile again: colours and marks are back, still only the lines in view
    await setValue(JSON.stringify(trackerProfile(), null, 2))
    await expect(status).toContainText('Valid')
    await expect(dialog.locator('.jca')).not.toHaveAttribute('data-plain')
    await expect(dialog.locator('.jca-tok--key').first()).toBeVisible()

    // more than 400,000 characters at once: not taken, the field keeps its text
    const before = await area.inputValue()
    await setValue('{"x": "' + 'y'.repeat(410_000) + '"}')
    await expect(dialog.getByRole('alert')).toContainText('Not taken: too much text for a profile (at most 400,000 characters).')
    expect(await area.inputValue()).toBe(before)
  })
})
