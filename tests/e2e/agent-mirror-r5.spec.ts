/**
 * Custom agents — round 5 of the mirror setup and the agent page (features/agents): long database names keep the
 * suffix and the counter whole (distinctTitle), the source field says what became of the picked server (switched off ·
 * no longer matching · deleted · renamed), the budget field reads grouped thousands, focus after the Restore keys, the
 * spec plate while only "Open …" is offered, a database in the trash because its parent page is, and the editor's hint
 * for a ticked MCP server that is switched off or missing here (a run leaves it out).
 * A mocked Claude API only — never api.anthropic.com; the MCP servers are fictional addresses nothing calls.
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, pageIdByTitle, wsEval, flush, mockClaude } from './fixtures'
import { addProfile, trackerProfile } from './helpers/integrations'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const TRACKER_TOOLS = ['list_items', 'get_item', 'search_items', 'whoami', 'create_item', 'update_item', 'add_comment']
const SERVERS = [
  { id: 'm-tracker', name: 'tracker', url: 'https://tracker.example.com/mcp', token: '', enabled: true, prompt: '', tools: TRACKER_TOOLS, checkedAt: Date.now() },
  { id: 'm-wiki', name: 'wiki', url: 'https://wiki.example.com/mcp', token: '', enabled: true, prompt: '' },
]

const setKey = (page: Page) => wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
const editorOf = (page: Page) => page.locator('.agx-editor')
const agentsOf = (page: Page) => wsEval(page, (s) => JSON.parse(JSON.stringify(Object.values(s.agents ?? {}))) as AnyState[])
const saveAgent = (page: Page, over: AnyState) =>
  wsEval(
    page,
    (s, a) => {
      const now = Date.now()
      s.upsertAgent({ instructions: 'Report on it.', trigger: { type: 'manual' }, scope: { everything: false, pages: [], databases: [] }, write: 'none', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: false, createdAt: now, updatedAt: now, ...a })
    },
    over,
  )
/** Patch one server of this device's MCP list (null: delete it). */
const patchServer = (page: Page, id: string, patch: AnyState | null) =>
  wsEval(page, (s, x) => s.updateSettings({ mcpServers: s.settings.mcpServers.flatMap((m: AnyState) => (m.id !== x.id ? [m] : x.patch ? [{ ...m, ...x.patch }] : [])) }), { id, patch })
const activeLabel = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null
  return el ? `${el.tagName}|${el.getAttribute('aria-label') ?? ''}|${(el.textContent ?? '').trim().slice(0, 80)}|${el.className}` : 'none'
})

/** #/agents → New agent → the profile's recipe `id`: its setup dialog. */
async function openRecipe(page: Page, id = 'mirror') {
  await page.evaluate(() => (window.location.hash = '#/agents'))
  await page.locator('.agx-head').waitFor()
  const inline = page.locator(`.agx-start [data-recipe="tracker:${id}"]`)
  if (await inline.count()) await inline.click()
  else {
    await page.locator('.agx-head .btn--primary').click()
    await page.locator(`.agx-recipe-modal [data-recipe="tracker:${id}"]`).click()
  }
  const dialog = page.locator('.agx-mir')
  await expect(dialog).toBeVisible()
  return dialog
}

/** Setup (`recipe`) → `name` → Create → the agent switched off → saved. Returns the plate's names and the editor's. */
async function setUp(page: Page, name: string, opts: { recipe?: string; de?: boolean; where?: string } = {}) {
  const dialog = await openRecipe(page, opts.recipe)
  await dialog.getByRole('textbox', { name: /Name/ }).fill(name)
  if (opts.where) {
    await dialog.locator('.agx-pick').click()
    await page.getByRole('menuitem', { name: opts.where }).click()
  }
  const plate = { agent: await dialog.getByTestId('agx-mir-agent').innerText(), report: await dialog.getByTestId('agx-mir-report').innerText() }
  await dialog.getByRole('button', { name: opts.de ? 'Datenbank und Agent anlegen' : 'Create database and agent' }).click()
  const editor = editorOf(page)
  await expect(editor).toBeVisible()
  const agent = await editor.getByRole('textbox', { name: 'Name' }).inputValue()
  await editor.getByRole('switch', { name: opts.de ? 'Aktiv' : 'Active' }).click()
  await editor.getByRole('button', { name: opts.de ? 'Agent anlegen' : 'Create agent', exact: true }).click()
  await expect(page.locator('.agx-dhead')).toBeVisible()
  return { plate, agent }
}

/** The report page titles of the saved agents, by agent name. */
const reportsOf = (page: Page) =>
  wsEval(page, (s) => (Object.values(s.agents ?? {}) as AnyState[]).map((a) => ({ agent: a.name as string, report: (a.output ? s.pages[a.output.pageId]?.title : null) as string | null })))

/** Parentheses open and close in order (a cut suffix leaves one open). */
const balanced = (s: string) => {
  let depth = 0
  for (const c of s) {
    if (c === '(') depth++
    if (c === ')' && --depth < 0) return false
  }
  return depth === 0
}

// 75 characters
const LONG = 'Customer escalations from the northern region field service teams — Q3 2026'

test.describe('Custom agents: mirror setup round 5', () => {
  test('E1 a 75-character database name set up twice: the agents and the report pages get distinct names — the suffix and the counter whole, never a taken name', async ({ page }) => {
    expect(LONG).toHaveLength(75)
    await openApp(page)
    await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), SERVERS)
    await addProfile(page, trackerProfile({ match: { host: '*.example.com' }, recipes: [{ kind: 'mirror', id: 'fixed', agent: { name: 'Weekly mirror' }, report: { name: 'Weekly report' } }] }))
    const first = await setUp(page, 'Features', { recipe: 'fixed' })
    expect(first.agent).toBe('Weekly mirror')
    const a = await setUp(page, LONG, { recipe: 'fixed' })
    // the first database of that name renamed: the same name can be set up again
    const dbA = (await agentsOf(page)).find((x) => x.name === a.agent)!.scope.databases[0]
    await wsEval(page, (s, id) => s.updatePage(id, { title: 'Escalations (archived)' }), dbA)
    const b = await setUp(page, LONG, { recipe: 'fixed' })
    // longer than the limit with the suffix alone (the probe's names): still distinct
    const stem = 'Customer escalations from the northern region field service teams and partners'
    const c = await setUp(page, `${stem} — alpha`, { recipe: 'fixed' })
    const d = await setUp(page, `${stem} — beta`, { recipe: 'fixed' })
    // never a name that is taken (the probe's "beta" fell back to "Weekly mirror")
    const names = (await agentsOf(page)).map((x) => x.name)
    expect(names).toHaveLength(5)
    expect(new Set(names).size, names.join(' | ')).toBe(names.length)
    for (const x of [a, b, c, d]) {
      // the plate named what Create made
      expect(x.plate.agent).toBe(x.agent)
      expect(x.agent.length).toBeLessThanOrEqual(80)
      expect(x.agent.startsWith('Weekly mirror ('), x.agent).toBe(true)
      expect(balanced(x.agent), x.agent).toBe(true)
    }
    expect(a.agent).toBe('Weekly mirror (Customer escalations from the northern region field service tea…)')
    expect(b.agent).toMatch(/…\) \(2\)$/)
    const reports = (await reportsOf(page)).map((r) => r.report)
    expect(new Set(reports).size).toBe(reports.length)
    expect(reports).toContain(`Weekly report (${LONG})`)
    expect(reports).toContain(`Weekly report (${LONG}) (2)`)
  })

  test('E1 the built-in names with a 75-character database set up twice: “Mirror · …” stays whole up to its cut, the second gets “(2)”, the reports too', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), SERVERS)
    await addProfile(page, trackerProfile({ match: { host: '*.example.com' } }))
    const a = await setUp(page, LONG)
    const dbA = (await agentsOf(page))[0].scope.databases[0]
    await wsEval(page, (s, id) => s.updatePage(id, { title: 'Escalations (archived)' }), dbA)
    const b = await setUp(page, LONG)
    // the second keeps the configured name up to its cut and gets the counter (never a stub like "Mi (…)")
    expect(b.agent.startsWith('Mirror · Customer escalations'), b.agent).toBe(true)
    expect(b.agent).toMatch(/ \(2\)$/)
    expect(a.agent).toBe('Mirror · Customer escalations from the northern region field service teams — Q3…')
    expect(b.agent).toBe('Mirror · Customer escalations from the northern region field service teams… (2)')
    for (const x of [a, b]) {
      expect(x.plate.agent).toBe(x.agent)
      expect(x.agent.length).toBeLessThanOrEqual(80)
    }
    const reports = (await reportsOf(page)).map((r) => r.report).sort()
    expect(reports).toEqual([`${LONG} · Report`, `${LONG} · Report (2)`])
  })

  test('E2 the source field says what became of the picked server: no longer matching (address), deleted, deleted with none left — Create waits each time; a rename is followed', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), SERVERS)
    await addProfile(page, trackerProfile({ match: { host: '*.example.com' } }))
    const dialog = await openRecipe(page)
    const servers = dialog.locator('.agx-mir__server')
    const err = dialog.getByTestId('agx-mir-server-err')
    const create = dialog.getByRole('button', { name: 'Create database and agent' })
    await expect(dialog.getByRole('radio', { name: /TRACKER/ })).toBeChecked()

    // its address changed: still switched on, but no longer matching — said so (never "switched off")
    await patchServer(page, 'm-tracker', { url: 'https://tracker.elsewhere.test/mcp' })
    await expect(err).toHaveText('TRACKER no longer matches “Tracker”: its address was changed in Settings. Pick another source, or change the address back.')
    await expect(servers.filter({ hasText: 'TRACKER' })).toContainText('No longer matches')
    await expect(create).toBeDisabled()

    // deleted: it keeps its place, marked, and Create waits (it never looks like nothing was picked)
    await patchServer(page, 'm-tracker', null)
    await expect(err).toHaveText('TRACKER was deleted in Settings. Pick another source.')
    await expect(servers.filter({ hasText: 'TRACKER' })).toContainText('Deleted')
    // in its place (first), never moved to the end
    await expect(servers.first()).toContainText('TRACKER')
    await expect(create).toBeDisabled()

    // another source: fine again — and a rename in Settings is followed
    await dialog.getByRole('radio', { name: /WIKI/ }).check()
    await expect(err).toHaveCount(0)
    await expect(create).toBeEnabled()
    await expect(servers.filter({ hasText: 'TRACKER' })).toHaveCount(0)
    await patchServer(page, 'm-wiki', { name: 'wiki2' })
    await expect(dialog.getByRole('radio', { name: /WIKI2/ })).toBeChecked()
    await expect(err).toHaveCount(0)
    await expect(create).toBeEnabled()

    // the last one deleted too: the list would be empty — the field says so
    await patchServer(page, 'm-wiki', null)
    await expect(err).toHaveText('WIKI2 was deleted in Settings, and no other MCP server of this device matches “Tracker”. Add one in Settings.')
    await expect(create).toBeDisabled()
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await expect(err).toHaveText('WIKI2 wurde in den Einstellungen gelöscht, und kein anderer MCP-Server dieses Geräts passt zu „Tracker“. Leg in den Einstellungen einen an.')
    await expect(servers.filter({ hasText: 'WIKI2' })).toContainText('Gelöscht')
    await expect(dialog.getByRole('button', { name: 'Datenbank und Agent anlegen' })).toBeDisabled()
    expect(await agentsOf(page)).toHaveLength(0)
  })

  test('E2 the profile names tools: a connection test without them, then none — said so; deleting every server while the setup is open is said too (German)', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), SERVERS)
    await addProfile(page, trackerProfile({ match: { host: '*.example.com', tools: ['list_items'] } }))
    let dialog = await openRecipe(page)
    const err = dialog.getByTestId('agx-mir-server-err')
    await patchServer(page, 'm-tracker', { tools: ['get_item'] })
    await expect(err).toHaveText('TRACKER no longer matches “Tracker”: its last connection test lacks the tools list_items. Pick another source, or test it again in Settings.')
    await expect(dialog.getByRole('button', { name: 'Create database and agent' })).toBeDisabled()
    await patchServer(page, 'm-tracker', { tools: [] })
    await expect(err).toHaveText('TRACKER no longer matches “Tracker”: its tools are not known — test the connection in Settings, or pick another source.')
    await dialog.getByRole('button', { name: 'Cancel' }).click()

    // German: every server deleted while the setup is open
    await patchServer(page, 'm-tracker', { tools: TRACKER_TOOLS })
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    dialog = await openRecipe(page)
    await wsEval(page, (s) => s.updateSettings({ mcpServers: [] }))
    await expect(dialog.getByTestId('agx-mir-server-err')).toHaveText('TRACKER wurde in den Einstellungen gelöscht, und kein anderer MCP-Server dieses Geräts passt zu „Tracker“. Leg in den Einstellungen einen an.')
    await expect(dialog.getByRole('button', { name: 'Datenbank und Agent anlegen' })).toBeDisabled()
  })

  test('E3 the budget field reads grouped thousands: German “1.000” and “1.000,5”, English “1,000” are refused with the range — never saved as 1; “1.5” and “0.75” stay decimals', async ({ page }) => {
    await openApp(page)
    await saveAgent(page, { id: 'ag-budget', name: 'Kasse', scope: { everything: true, pages: [], databases: [] }, maxRunUsd: 0.5 })
    await flush(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await page.evaluate(() => (window.location.hash = '#/agents/ag-budget'))
    await expect(page.locator('.agx-dhead')).toBeVisible()
    const editor = editorOf(page)
    const input = editor.locator('.agx-money input')
    const budget = () => wsEval(page, (s) => s.agents['ag-budget'].maxRunUsd as number)
    // the budget field's own error
    const budgetErr = editor.locator('[id$="-budget-err"]')
    await page.getByRole('button', { name: 'Bearbeiten' }).click()
    for (const typed of ['1.000', '1.000,5', '12.345']) {
      await input.fill(typed)
      await editor.getByRole('button', { name: 'Speichern' }).click()
      await expect(budgetErr).toHaveText('Gib einen Betrag zwischen 0,01 $ und 50,00 $ an.')
      await expect(editor).toBeVisible()
      expect(await budget(), typed).toBe(0.5)
    }
    for (const [typed, saved] of [
      ['1.5', 1.5],
      ['0.75', 0.75],
      ['0.750', 0.75],
    ] as const) {
      await input.fill(typed)
      await editor.getByRole('button', { name: 'Speichern' }).click()
      await expect(editor).toHaveCount(0)
      expect(await budget(), typed).toBe(saved)
      await page.getByRole('button', { name: 'Bearbeiten' }).click()
    }
    // English: a comma groups thousands there
    await wsEval(page, (s) => s.updateSettings({ language: 'en' }))
    await input.fill('1,000')
    await editor.getByRole('button', { name: 'Save' }).click()
    await expect(budgetErr).toHaveText('Enter an amount between $0.01 and $50.00.')
    expect(await budget()).toBe(0.75)
    await input.fill('1,5')
    await editor.getByRole('button', { name: 'Save' }).click()
    await expect(budgetErr).toHaveText('Enter the amount as a number, such as 1.50.')
    expect(await budget()).toBe(0.75)
  })

  test('E4 the setup (German): after “Wiederherstellen” focus goes to the key that shows then („…“ öffnen) — never the page body; the dialog stays open', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), SERVERS)
    await addProfile(page, trackerProfile({ match: { host: '*.example.com' } }))
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await setUp(page, 'Tracker', { de: true })
    const [agent] = await agentsOf(page)
    const db = agent.scope.databases[0]
    await wsEval(page, (s, id) => s.trashPage(id), db)
    const dialog = await openRecipe(page)
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Tracker')
    const exists = dialog.getByTestId('agx-mir-exists')
    const restore = exists.getByRole('button', { name: 'Wiederherstellen', exact: true })
    // by keyboard
    await restore.focus()
    await page.keyboard.press('Enter')
    await expect(restore).toHaveCount(0)
    expect(await wsEval(page, (s, id) => !!s.pages[id].trashed, db)).toBe(false)
    const open = exists.getByRole('button', { name: `„${agent.name}“ öffnen` })
    await expect(open).toBeFocused()
    await expect(dialog).toBeVisible()
    // by mouse, a second time
    await wsEval(page, (s, id) => s.trashPage(id), db)
    await exists.getByRole('button', { name: 'Wiederherstellen', exact: true }).click()
    await expect(open).toBeFocused()
    expect(await activeLabel(page)).not.toMatch(/^BODY/)
  })

  test('E6 (German) the database in the trash only because its parent page is: named like the agent page, its key „P“ wiederherstellen brings it back; focus to the Open key; the plate names that agent', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), SERVERS)
    await addProfile(page, trackerProfile({ match: { host: '*.example.com' } }))
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const wiki = await pageIdByTitle(page, 'Team wiki')
    await setUp(page, 'Tracker', { de: true, where: 'Team wiki' })
    const [agent] = await agentsOf(page)
    const db = agent.scope.databases[0]
    expect(await wsEval(page, (s, id) => s.pages[id].parentId, db)).toBe(wiki)

    await wsEval(page, (s, id) => s.trashPage(id), wiki)
    const dialog = await openRecipe(page)
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Tracker')
    const exists = dialog.getByTestId('agx-mir-exists')
    await expect(exists).toContainText(
      `„Tracker“ liegt in „Team wiki“, und „Team wiki“ liegt im Papierkorb. Der Agent „${agent.name}“ hält sie im Gleichstand. Stell „Team wiki“ wieder her (mit den Seiten darin) oder gib der neuen einen anderen Namen.`,
    )
    await expect(dialog.getByRole('button', { name: 'Datenbank und Agent anlegen' })).toBeDisabled()
    const restore = exists.getByRole('button', { name: '„Team wiki“ wiederherstellen' })
    await restore.focus()
    await page.keyboard.press('Enter')
    expect(await wsEval(page, (s, ids) => ids.map((id: string) => !!s.pages[id].trashed), [wiki, db])).toEqual([false, false])
    const open = exists.getByRole('button', { name: `„${agent.name}“ öffnen` })
    await expect(open).toBeFocused()
    await expect(exists.getByRole('button', { name: /wiederherstellen/i })).toHaveCount(0)
    // the plate: the agent and its report page that are there
    await expect(dialog.getByTestId('agx-mir-agent')).toHaveText(agent.name)
    await expect(dialog.getByTestId('agx-mir-report')).toHaveText('Tracker · Bericht')
    // the database itself in the trash: its own wording (never "spiegelt hinein")
    await wsEval(page, (s, id) => s.trashPage(id), db)
    await expect(exists).toContainText(`„Tracker“ liegt im Papierkorb, und der Agent „${agent.name}“ hält sie im Gleichstand. Stell sie wieder her oder gib der neuen einen anderen Namen.`)
    await expect(exists.getByRole('button', { name: 'Wiederherstellen', exact: true })).toBeVisible()
  })

  test('E5 while only “Open …” is offered the plate shows that agent: its name, schedule, mode, budget and report page — never a name no action makes', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), SERVERS)
    await addProfile(page, trackerProfile({ match: { host: '*.example.com' } }))
    await setUp(page, 'Tracker')
    const [agent] = await agentsOf(page)
    await wsEval(page, (s, id) => s.upsertAgent({ ...s.agents[id], write: 'apply', maxRunUsd: 2, trigger: { type: 'manual' } }), agent.id)
    const dialog = await openRecipe(page)
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Tracker')
    await expect(dialog.getByTestId('agx-mir-exists').getByRole('button', { name: `Open “${agent.name}”` })).toBeVisible()
    const spec = dialog.getByTestId('agx-mir-spec')
    await expect(dialog.getByTestId('agx-mir-agent')).toHaveText('Mirror · Tracker')
    await expect(dialog.getByTestId('agx-mir-report')).toHaveText('Tracker · Report')
    await expect(spec).toContainText('applies directly')
    await expect(spec).toContainText('$2.00 per run')
    await expect(spec).not.toContainText('(2)')
    // no report page, and the database in the trash ("Restore" · "Open"): still that agent, the report "—"
    await wsEval(page, (s, id) => s.upsertAgent({ ...s.agents[id], output: null }), agent.id)
    await wsEval(page, (s, id) => s.trashPage(id), agent.scope.databases[0])
    await expect(dialog.getByTestId('agx-mir-exists').getByRole('button', { name: 'Restore', exact: true })).toBeVisible()
    await expect(dialog.getByTestId('agx-mir-agent')).toHaveText('Mirror · Tracker')
    await expect(dialog.getByTestId('agx-mir-report')).toHaveText('—')
    // another name: Create's names again
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Bugs')
    await expect(dialog.getByTestId('agx-mir-agent')).toHaveText('Mirror · Bugs')
    await expect(dialog.getByTestId('agx-mir-report')).toHaveText('Bugs · Report')
  })

  test('E4 the agent page: Restore moves focus to the next Restore key, then the notice’s heading, and — the notice gone — the page’s heading; never the page body', async ({ page }) => {
    await openApp(page)
    const ids = await wsEval(page, (s) => {
      const alpha = s.createDatabase({ title: 'Alpha' }) as string
      const beta = s.createDatabase({ title: 'Beta' }) as string
      const notes = s.createPage({ title: 'Gamma notes' }) as string
      const delta = s.createPage({ title: 'Delta' }) as string
      const eps = s.createDatabase({ title: 'Epsilon' }) as string
      return { alpha, beta, notes, delta, eps }
    })
    await saveAgent(page, { id: 'ag-many', name: 'Many pages', scope: { everything: false, pages: [ids.delta], databases: [ids.alpha, ids.beta] }, output: { pageId: ids.notes, mode: 'append' } })
    await saveAgent(page, { id: 'ag-one', name: 'One page', scope: { everything: false, pages: [], databases: [ids.eps] } })
    await wsEval(page, (s, x) => {
      s.trashPage(x.delta)
      s.deletePagePermanently(x.delta)
      for (const id of [x.alpha, x.beta, x.notes, x.eps]) s.trashPage(id)
    }, ids)
    await flush(page)
    await page.evaluate(() => (window.location.hash = '#/agents/ag-many'))
    const lost = page.getByTestId('agx-lost')
    await expect(lost.getByRole('button', { name: /^Restore/ })).toHaveCount(3)
    const press = async (name: string) => {
      const key = lost.getByRole('button', { name })
      await key.focus()
      await page.keyboard.press('Enter')
      await expect(key).toHaveCount(0)
    }
    await press('Restore “Alpha”')
    await expect(lost.getByRole('button', { name: 'Restore “Beta”' })).toBeFocused()
    await press('Restore “Beta”')
    await expect(lost.getByRole('button', { name: 'Restore “Gamma notes”' })).toBeFocused()
    // the last key: the notice stays (a page deleted for good) — its heading takes focus
    await press('Restore “Gamma notes”')
    await expect(lost).toContainText('A page that was deleted for good.')
    await expect(lost.locator('.agx-lost__title')).toBeFocused()

    // a click on the only key: the notice goes — the page's heading takes focus
    await page.evaluate(() => (window.location.hash = '#/agents/ag-one'))
    await lost.getByRole('button', { name: 'Restore “Epsilon”' }).click()
    await expect(lost).toHaveCount(0)
    await expect(page.locator('.agx-dhead h1')).toBeFocused()
    expect(await activeLabel(page)).toMatch(/^H1/)
  })

  test('E7 the editor says when a ticked MCP server is switched off here or missing — saving still works; the mirror editor too (German)', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), SERVERS)
    await addProfile(page, trackerProfile({ match: { host: '*.example.com' } }))

    // a saved agent with "tracker" and a server this device does not have
    await saveAgent(page, { id: 'ag-mcp', name: 'Knowledge check', scope: { everything: true, pages: [], databases: [] }, mcpServers: ['tracker', 'ghost'], enabled: true })
    await flush(page)
    await page.evaluate(() => (window.location.hash = '#/agents/ag-mcp'))
    await expect(page.locator('.agx-dhead')).toBeVisible()
    await page.getByRole('button', { name: 'Edit' }).click()
    const editor = editorOf(page)
    const notes = editor.getByTestId('agx-mcp-note')
    await expect(notes).toHaveCount(1)
    await expect(notes).toContainText('There is no “ghost” on this device — the agent uses it only once you set it up here.')
    // switched off while the editor is open: said too
    await patchServer(page, 'm-tracker', { enabled: false })
    await expect(notes).toHaveCount(2)
    await expect(notes.filter({ hasText: 'tracker' })).toContainText('“tracker” is switched off on this device — the agent uses it only once you switch it on.')
    await expect(editor.locator('.agx-check').filter({ hasText: 'TRACKER' })).toContainText('switched off here')
    // a hint, never a block: it saves
    await editor.getByRole('button', { name: 'Save' }).click()
    await expect(editor).toHaveCount(0)
    expect((await agentsOf(page)).find((a) => a.id === 'ag-mcp')!.mcpServers).toEqual(['tracker', 'ghost'])

    // the mirror editor (German): the source switched off after Create
    await patchServer(page, 'm-tracker', { enabled: true })
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const dialog = await openRecipe(page)
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Tickets')
    await dialog.getByRole('button', { name: 'Datenbank und Agent anlegen' }).click()
    await expect(editor).toBeVisible()
    await expect(notes).toHaveCount(0)
    await patchServer(page, 'm-tracker', { enabled: false })
    await expect(notes).toHaveCount(1)
    await expect(notes).toContainText('„tracker“ ist auf diesem Gerät ausgeschaltet — der Agent nutzt ihn erst, wenn du ihn einschaltest.')
    await expect(notes.getByRole('button', { name: 'MCP-Server in den Einstellungen' })).toBeVisible()
    await editor.getByRole('switch', { name: 'Aktiv' }).click()
    await editor.getByRole('button', { name: 'Agent anlegen', exact: true }).click()
    await expect(page.locator('.agx-dhead')).toBeVisible()
  })

  test('E7 a run leaves a ticked MCP server that is switched off on this device out, and its steps say so', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), SERVERS)
    const bodies = await mockClaude(context, () => 'Nothing to do.')
    await saveAgent(page, { id: 'ag-run', name: 'Knowledge run', scope: { everything: true, pages: [], databases: [] }, mcpServers: ['tracker', 'wiki'], enabled: true })
    await patchServer(page, 'm-tracker', { enabled: false })
    await flush(page)
    await page.evaluate(() => (window.location.hash = '#/agents/ag-run'))
    await expect(page.locator('.agx-dhead')).toBeVisible()
    await page.getByRole('button', { name: 'Run now' }).click()
    const run = page.locator('.agx-run').first()
    await expect(run).toHaveAttribute('data-status', 'ok', { timeout: 20_000 })
    const sent = bodies.map((b) => JSON.parse(b)).filter((b) => Array.isArray(b.messages))
    expect(sent.length).toBeGreaterThan(0)
    // the switched-on server goes along, the switched-off one never
    expect(sent[0].mcp_servers).toEqual([{ type: 'url', url: 'https://wiki.example.com/mcp', name: 'wiki' }])
    await expect(run.locator('.agx-step[data-kind="note"]')).toContainText('TRACKER is switched off in this browser — left out.')
  })
})
