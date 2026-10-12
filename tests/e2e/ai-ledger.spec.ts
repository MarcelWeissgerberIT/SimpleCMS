/**
 * Multi-provider S1 in the browser: the no-real-host guard (aiNet), the contracts every reader keeps, the gate in
 * front of every AI request (policy generation, keys in typed text), the agent route block and the small safety fixes.
 * Every AI host is mocked or aborted — nothing reaches a real one. Test data is fictional.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import type { Locator, Page, TestInfo } from '@playwright/test'
import { test, expect, openApp, reloadApp, wsEval, uiEval, flush, createPage, gotoPage, editorOf, doc, para, selectText, pageIdByTitle, MOD } from './fixtures'
import { mockClaudeScript, hostCounts, text, type CapturedRequest, type ClaudeStep } from './helpers/providers'
import { openTerminal, run, terminal, prompt } from './helpers/terminal'
import { ARCHIVE, SUMMARY, TRANSFORM_STEPS, addArchiveServer, aiPanel as panelOf, autofillPriority, imageAction, improve, ledger, noSpeech, ownRequest, paletteAsk, runAgentNow, summarisePdf, summarizeMeeting, transformAuto } from './helpers/aiFlows'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Workspace settings → Data → Export workspace → whole workspace, full backup → the parsed file. */
async function exportBackup(page: Page, testInfo: TestInfo, name: string): Promise<{ file: string; json: AnyState }> {
  await page.keyboard.press('Escape')
  await page.evaluate(() => (window.location.hash = '#/workspace/data'))
  const ws = page.getByTestId('workspace-page')
  await expect(ws).toHaveAttribute('data-section', 'data')
  await ws.getByRole('button', { name: 'Export workspace' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('radio', { name: /Whole workspace/ }).click()
  await dialog.getByRole('radio', { name: /Full backup/ }).click()
  const download = page.waitForEvent('download')
  await dialog.locator('[data-export-run]').click()
  const file = testInfo.outputPath(name)
  await (await download).saveAs(file)
  await page.keyboard.press('Escape')
  return { file, json: JSON.parse(readFileSync(file, 'utf8')) }
}

/** The sidebar's Import → a backup file → merge or replace. */
async function importBackup(page: Page, file: string, mode: 'merge' | 'replace') {
  await page.locator('.sb').getByRole('button', { name: /^Import/ }).click()
  const dialog = page.getByRole('dialog')
  const chooser = page.waitForEvent('filechooser')
  await dialog.getByRole('button', { name: 'Choose files' }).click()
  await (await chooser).setFiles([{ name: 'backup.json', mimeType: 'application/json', buffer: readFileSync(file) }])
  if (mode === 'replace') {
    await dialog.getByRole('radio', { name: /Replace workspace/ }).click()
    await dialog.getByRole('button', { name: 'Replace workspace' }).click()
    await dialog.getByRole('button', { name: 'Yes, replace everything' }).click()
  } else {
    await dialog.getByRole('radio', { name: /Merge into this workspace/ }).click()
    await dialog.getByRole('button', { name: 'Merge backup' }).click()
  }
  await expect(dialog.getByText(mode === 'replace' ? /Workspace restored/ : /Backup merged/).first()).toBeVisible()
  await page.keyboard.press('Escape')
}

const NEW_AGENT = {
  id: 'ag-nordlicht',
  name: 'Nordlicht router',
  route: [{ p: 'openrouter', m: 'x/y' }, { p: 'anthropic', m: 'claude-sonnet-5-5' }],
  review: { route: [{ p: 'openai', m: 'gpt-6-luna' }], mode: 'hold' },
  saverRule: { overUsd: 0.25, to: { p: 'anthropic', m: 'claude-haiku-4-5' } },
  applyOn: 'anthropic:claude-opus-5-5',
  routeSig: 'sig-tessera-01',
}
const OLD_AGENT = { id: 'ag-tessera', name: 'Tessera digest' }

const addAgents = (page: Page) =>
  wsEval(
    page,
    (s, list) => {
      for (const a of list)
        s.upsertAgent({ instructions: 'Summarise the launch plan.', trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: 'none', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: true, createdAt: 1760252400000, updatedAt: 1760252400000, ...a })
    },
    [NEW_AGENT, OLD_AGENT],
  )
const agentJson = (page: Page, id: string) => wsEval(page, (s, id) => JSON.stringify(s.agents?.[id] ?? null), id)

test.describe('aiNet: no real AI host', () => {
  test('an unmocked request is aborted and recorded; it counts for its host', async ({ page, aiNet, errors }) => {
    errors.allow(/Failed to load resource/)
    await openApp(page)
    const result = await page.evaluate(() =>
      fetch('https://api.openai.com/v1/models').then(
        (r) => `status ${r.status}`,
        (e) => `failed: ${e instanceof TypeError}`,
      ),
    )
    expect(result).toBe('failed: true')
    expect(aiNet.unmocked).toEqual(['GET https://api.openai.com/v1/models'])
    expect(aiNet.count('openai')).toBe(1)
    expect(aiNet.count('anthropic')).toBe(0)
    // the self-test is done: let the fixture pass
    aiNet.allowUnmocked()
    expect(aiNet.unmocked).toEqual([])
  })

  test('with allowUnmocked() the request is still aborted, but not reported', async ({ page, aiNet, errors }) => {
    errors.allow(/Failed to load resource/)
    aiNet.allowUnmocked()
    await openApp(page)
    const result = await page.evaluate(() => fetch('https://openrouter.ai/api/v1/key').then(() => 'answered', () => 'failed'))
    expect(result).toBe('failed')
    expect(aiNet.unmocked).toEqual([])
    expect(aiNet.count('openrouter')).toBe(1)
  })

  test("a spec's own mock wins over the guard (positive control)", async ({ page, aiNet }) => {
    const { requests } = await mockClaudeScript(page.context(), [text('ok')])
    await openApp(page)
    const counts = hostCounts(page)
    const status = await page.evaluate(() =>
      fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-opus-5-5', max_tokens: 10, messages: [] }) }).then((r) => r.status),
    )
    expect(status).toBe(200)
    expect(requests).toHaveLength(1)
    expect(aiNet.unmocked).toEqual([])
    expect(aiNet.count('anthropic')).toBe(1)
    expect(counts).toEqual({ anthropic: 1, openai: 0, openrouter: 0 })
  })
})

test.describe('contracts kept by every reader (written by nobody yet)', () => {
  test('agent route fields survive save → reload → backup export → restore; an older-shape agent stays byte-equal', async ({ page }, testInfo) => {
    await openApp(page)
    await addAgents(page)
    const fresh = JSON.parse(await agentJson(page, NEW_AGENT.id))
    expect(fresh).toMatchObject({ route: NEW_AGENT.route, review: NEW_AGENT.review, saverRule: NEW_AGENT.saverRule, applyOn: NEW_AGENT.applyOn, routeSig: NEW_AGENT.routeSig })
    const old = await agentJson(page, OLD_AGENT.id)
    for (const k of ['route', 'review', 'saverRule', 'applyOn', 'routeSig']) expect(JSON.parse(old)).not.toHaveProperty(k)
    const newer = await agentJson(page, NEW_AGENT.id)

    await reloadApp(page)
    expect(await agentJson(page, NEW_AGENT.id)).toBe(newer)
    expect(await agentJson(page, OLD_AGENT.id)).toBe(old)

    const { file, json } = await exportBackup(page, testInfo, 'agents.json')
    expect(json.workspace.agents[NEW_AGENT.id]).toMatchObject({ route: NEW_AGENT.route, applyOn: NEW_AGENT.applyOn })
    await wsEval(page, (s, ids) => ids.forEach((id: string) => s.deleteAgent(id)), [NEW_AGENT.id, OLD_AGENT.id])
    expect(await agentJson(page, NEW_AGENT.id)).toBe('null')
    await importBackup(page, file, 'replace')
    expect(await agentJson(page, NEW_AGENT.id)).toBe(newer)
    expect(await agentJson(page, OLD_AGENT.id)).toBe(old)
  })

  test('Workspace.ai, settings.ai and the key markers are kept through reload; a backup carries the workspace rules, never keys or the device rules', async ({ page }, testInfo) => {
    await openApp(page)
    const rules = { gen: 1, routes: { '*': [{ p: 'anthropic', m: 'claude-sonnet-5-5' }] }, policy: { providers: { openrouter: { allow: ['public', 'structure'] } }, restricted: [] } }
    await wsEval(page, (s, rules) => s.updateSettings({ aiKeys: { openai: 'vault:abcdef123456:WXYZ', openrouter: 'sk-or-v1-plaintext-never-kept-0001' }, ai: { default: [{ p: 'anthropic', m: 'claude-opus-5-5' }], allow: { openrouter: ['memory'] } } }), rules)
    await page.evaluate((rules) => (window as unknown as { __one: { workspace: { setState: (x: object) => void } } }).__one.workspace.setState({ ai: rules }), rules)
    await flush(page)
    await reloadApp(page)
    expect(await wsEval(page, (s) => JSON.parse(JSON.stringify({ ai: s.ai, keys: s.settings.aiKeys ?? null, device: s.settings.ai ?? null })))).toEqual({
      ai: rules,
      // a plaintext "marker" never survives a reader
      keys: { openai: 'vault:abcdef123456:WXYZ' },
      device: { default: [{ p: 'anthropic', m: 'claude-opus-5-5' }], allow: { openrouter: ['memory'] } },
    })
    const { json } = await exportBackup(page, testInfo, 'rules.json')
    expect(json.workspace.ai).toEqual(rules)
    expect(json.workspace.settings.aiApiKey).toBe('')
    expect(json.workspace.settings.aiKeys).toEqual({})
    expect(json.workspace.settings).not.toHaveProperty('ai')
    expect(JSON.stringify(json)).not.toContain('vault:abcdef123456')
  })

  for (const withKey of [false, true])
    for (const mode of ['merge', 'replace'] as const)
      test(`a crafted backup never plants a key or AI rules (${mode}, device ${withKey ? 'with' : 'without'} a key)`, async ({ page }, testInfo) => {
        await openApp(page)
        if (withKey) await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-device-key-0001' }))
        const before = await wsEval(page, (s) => JSON.parse(JSON.stringify({ key: s.settings.aiApiKey, keys: s.settings.aiKeys ?? null, device: s.settings.ai ?? null, ai: s.ai ?? null })))
        const { file, json } = await exportBackup(page, testInfo, `crafted-${mode}.json`)
        json.workspace.settings.aiApiKey = 'sk-ant-api03-CRAFTED-planted-key-0123456789'
        json.workspace.settings.aiKeys = { openai: 'vault:planted00001:ABCD', openrouter: 'sk-or-v1-planted-0123456789' }
        json.workspace.settings.ai = { default: [{ p: 'openrouter', m: 'x/y' }], allow: { openrouter: ['private', 'mail', 'memory', 'mcp'] } }
        json.workspace.ai = { routes: { '*': [{ p: 'openrouter', m: 'x/y' }] }, policy: { providers: { openrouter: { allow: ['page', 'rows', 'people'] } }, restricted: [] } }
        writeFileSync(file, JSON.stringify(json))
        await importBackup(page, file, mode)
        const after = await wsEval(page, (s) => JSON.parse(JSON.stringify({ key: s.settings.aiApiKey, keys: s.settings.aiKeys ?? null, device: s.settings.ai ?? null, ai: s.ai ?? null })))
        expect(after).toEqual(before)
        expect(after.key).toEqual(withKey ? expect.stringMatching(/^vault:[0-9a-z]+:0001$/) : '')
        await reloadApp(page)
        expect(await wsEval(page, (s) => JSON.parse(JSON.stringify({ key: s.settings.aiApiKey, keys: s.settings.aiKeys ?? null, device: s.settings.ai ?? null, ai: s.ai ?? null })))).toEqual(before)
      })
})

/* ------------------------------------------------------------------ */
/* The gate (features/ai/core/gate.ts)                                  */
/* ------------------------------------------------------------------ */

const RELOAD = 'This workspace has AI rules this tab does not know yet'

/** A key, Claude scripted, the workspace's AI rules at generation `gen` (this build knows 1). */
async function gated(page: Page, gen: number, steps: ClaudeStep[]) {
  const { requests } = await mockClaudeScript(page.context(), steps)
  const counts = hostCounts(page)
  await openApp(page)
  await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
  await page.evaluate((gen) => (window as unknown as { __one: { workspace: { setState: (x: object) => void } } }).__one.workspace.setState({ ai: { gen } }), gen)
  return { requests, counts }
}

const aiPanel = panelOf

const GATE_FLOWS: Array<{ name: string; steps: ClaudeStep[]; go: (page: Page, refused: boolean) => Promise<void> }> = [
  {
    name: 'Improve writing',
    steps: [text('A tighter launch sentence.')],
    go: async (page, refused) => {
      const id = await createPage(page, { title: 'Launch notes', content: doc(para('our launch sentence is kinda loose')) })
      await gotoPage(page, id)
      const ed = editorOf(page, id)
      await ed.locator('p', { hasText: 'our launch sentence is kinda loose' }).click()
      await selectText(page, ed, 'our launch sentence is kinda loose')
      await page.locator('[aria-label="Formatting"]').first().getByRole('button', { name: /^Ask AI$/ }).click()
      await expect(aiPanel(page)).toBeVisible()
      await aiPanel(page).getByRole('option', { name: /Improve writing/ }).click()
      if (refused) {
        await expect(aiPanel(page).locator('.ai-error')).toContainText(RELOAD)
        await expect(aiPanel(page).locator('.ai-error').getByRole('button', { name: 'Reload' })).toBeVisible()
      }
      else await expect(aiPanel(page)).toContainText('A tighter launch sentence.')
    },
  },
  {
    name: '⌘K "?"',
    steps: [text('The launch is in two weeks.')],
    go: async (page, refused) => {
      const id = await createPage(page, { title: 'Launch plan', content: doc(para('We launch in two weeks.')) })
      await gotoPage(page, id)
      await page.keyboard.press(`${MOD}+k`)
      await page.keyboard.type('?When do we launch?')
      const pal = page.getByRole('dialog', { name: 'Command palette' })
      await expect(pal.locator('.pal-mode')).toHaveText('ASK')
      await page.keyboard.press('Enter')
      await expect(pal).toContainText(refused ? RELOAD : 'The launch is in two weeks.')
    },
  },
  {
    name: 'the AI terminal',
    steps: [text('We launch in two weeks.')],
    go: async (page, refused) => {
      const id = await createPage(page, { title: 'Launch notes', content: doc(para('We launch in two weeks.')) })
      await gotoPage(page, id)
      await openTerminal(page)
      await run(page, 'When do we launch?')
      if (refused) {
        await expect(terminal(page).locator('.term-error')).toContainText(RELOAD)
        await expect(terminal(page).locator('.term-error').getByRole('button', { name: 'Reload' })).toBeVisible()
      }
      else await expect(terminal(page).locator('.term-answer')).toContainText('We launch in two weeks.')
    },
  },
  {
    name: 'autofill',
    steps: [text(JSON.stringify({ value: 'Low' }))],
    go: async (page, refused) => {
      const dbId = await pageIdByTitle(page, 'Projects')
      await gotoPage(page, dbId)
      await page.locator('#main section.db').first().getByRole('tab').filter({ hasText: 'All projects' }).click()
      await wsEval(
        page,
        (s, dbId) => {
          const p = s.databases[dbId].properties.find((x: AnyState) => x.name === 'Priority')
          s.updateProperty(dbId, p.id, { autofill: { preset: 'categorize', skipReview: true } })
        },
        dbId,
      )
      const grid = page.locator('#main .dbt')
      await grid.focus()
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowRight')
      await expect(grid.locator('[data-cell="0:2"]')).toHaveAttribute('data-active', 'true')
      await page.keyboard.press('Alt+Enter')
      await expect(page.locator('.toast', { hasText: refused ? RELOAD : 'Priority filled for' })).toBeVisible()
      // the run stops at once; its toast offers Reload, not Settings
      if (refused) await expect(page.locator('.toast', { hasText: RELOAD }).getByRole('button', { name: 'Reload' })).toBeVisible()
    },
  },
  {
    name: 'a custom agent',
    steps: [text('**Status report:** nothing blocks the launch.')],
    go: async (page, refused) => {
      await wsEval(page, (s) =>
        s.upsertAgent({ id: 'ag-gate', name: 'Status reader', instructions: 'Summarise the status of all projects.', trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: 'none', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: true, createdAt: 1760252400000, updatedAt: 1760252400000 }),
      )
      await flush(page)
      await page.evaluate(() => (window.location.hash = '#/agents/ag-gate'))
      await expect(page.locator('.agx-dhead')).toBeVisible()
      await page.getByRole('button', { name: 'Run now' }).click()
      const row = page.locator('.agx-run').first()
      await expect(row).toHaveAttribute('data-status', refused ? 'error' : 'ok', { timeout: 20_000 })
      if (refused) await expect(row).toContainText(RELOAD)
    },
  },
]

test.describe('the gate in front of every AI request', () => {
  for (const flow of GATE_FLOWS)
    for (const gen of [2, 1])
      test(`${flow.name}: AI rules of generation ${gen} → ${gen > 1 ? "'reload', nothing sent" : 'exactly one request'}`, async ({ page, aiNet }) => {
        const { requests, counts } = await gated(page, gen, flow.steps)
        await flow.go(page, gen > 1)
        await page.waitForTimeout(400)
        expect(requests).toHaveLength(gen > 1 ? 0 : 1)
        expect(counts.anthropic).toBe(gen > 1 ? 0 : 1)
        expect(aiNet.count('anthropic')).toBe(gen > 1 ? 0 : 1)
      })
})

/* ------------------------------------------------------------------ */
/* The agent route block (features/agents/routeBlock.ts)                */
/* ------------------------------------------------------------------ */

test.describe('an agent whose route this version cannot run', () => {
  const ROUTED = { id: 'ag-route', name: 'Nordlicht digest', instructions: 'Summarise the launch plan.', trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: 'none', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: true, createdAt: 1760252400000, updatedAt: 1760252400000 }

  async function runNow(page: Page, route: AnyState[]) {
    await wsEval(page, (s, a) => s.upsertAgent(a), { ...ROUTED, route })
    await flush(page)
    await page.evaluate(() => (window.location.hash = '#/agents/ag-route'))
    await expect(page.locator('.agx-dhead')).toBeVisible()
    await page.getByRole('button', { name: 'Run now' }).click()
  }

  test('an OpenRouter route → an error run that says why, nothing sent; a Claude route → one request', async ({ page, aiNet }) => {
    const { requests } = await mockClaudeScript(page.context(), [text('**Digest:** the launch is on track.')])
    const counts = hostCounts(page)
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))

    await runNow(page, [{ p: 'openrouter', m: 'vendor-a/model-b' }])
    const row = page.locator('.agx-run').first()
    await expect(row).toHaveAttribute('data-status', 'error')
    await expect(row).toContainText('this agent needs a newer version of One')
    // a later pin this build cannot run blocks it too
    await runNow(page, [{ p: 'anthropic', m: 'claude-opus-5-5' }, { p: 'openai', m: 'gpt-6-luna' }])
    await expect(page.locator('.agx-run')).toHaveCount(2)
    await expect(page.locator('.agx-run').first()).toHaveAttribute('data-status', 'error')
    await page.waitForTimeout(300)
    expect(requests).toHaveLength(0)
    expect(aiNet.count('anthropic') + aiNet.count('openrouter') + aiNet.count('openai')).toBe(0)

    await runNow(page, [{ p: 'anthropic', m: 'claude-opus-5-5' }])
    await expect(page.locator('.agx-run')).toHaveCount(3)
    await expect(page.locator('.agx-run').first()).toHaveAttribute('data-status', 'ok', { timeout: 20_000 })
    await page.waitForTimeout(300)
    expect(requests).toHaveLength(1)
    expect(counts).toEqual({ anthropic: 1, openai: 0, openrouter: 0 })
  })
})

/* ------------------------------------------------------------------ */
/* Small safety fixes (task 9)                                          */
/* ------------------------------------------------------------------ */

test.describe('keys in typed text, retries after an MCP call', () => {
  const history = (page: Page) =>
    page.evaluate(() => {
      const out: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!
        if (k.startsWith('one.term.history:')) out.push(localStorage.getItem(k) ?? '')
      }
      return out.join('\n')
    })

  test('a terminal task holding an API key: the hint, nothing sent, never in the history; "task-1234 …" goes through', async ({ page, aiNet }) => {
    const { requests } = await mockClaudeScript(page.context(), [text('Mara owns the launch plan.')])
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    const id = await createPage(page, { title: 'Launch plan', content: doc(para('Mara owns the launch plan.')) })
    await gotoPage(page, id)
    await openTerminal(page)
    const KEY = 'sk-proj-Nordlicht0123456789abcdef'
    await run(page, `use my key ${KEY} for the launch plan`)
    const err = terminal(page).locator('.term-error')
    await expect(err).toContainText('That looks like an API key')
    await expect(err.getByRole('button', { name: /Open Settings/ })).toBeVisible()
    // the key is shown nowhere in the transcript; the text is back in the prompt to be fixed
    await expect(terminal(page).locator('.term-scroll')).toContainText('use my key •••• for the launch plan')
    await expect(terminal(page).locator('.term-scroll')).not.toContainText(KEY)
    await expect(prompt(page)).toHaveValue(`use my key ${KEY} for the launch plan`)
    await page.waitForTimeout(300)
    expect(requests).toHaveLength(0)
    expect(aiNet.count('anthropic')).toBe(0)
    expect(await history(page)).not.toContain('sk-proj-')

    await prompt(page).fill('')
    await run(page, 'task-1234 for Mara: who owns the launch plan?')
    await expect(terminal(page).locator('.term-answer')).toContainText('Mara owns the launch plan.')
    expect(requests).toHaveLength(1)
    expect(await history(page)).toContain('task-1234 for Mara')
  })

  const ARCHIVE = { id: 'srvtessera01', name: 'archive', url: 'https://mcp.example.test/api/archive/mcp', token: 'archive-e2e-PLAINTEXT-token-7Hq0002', enabled: true, prompt: '**Archive** is the team knowledge base.', promptSource: 'auto', tools: ['archive_search'], checkedAt: 1 }
  const AUTH = { status: 400, json: { type: 'error', error: { type: 'invalid_request_error', message: "MCP server 'archive' returned 401 Unauthorized: the token is expired" } } }
  const CALLED = {
    blocks: [
      { type: 'mcp_tool_use' as const, id: 'mcptoolu_9', server: 'archive', name: 'archive_search', input: { query: 'launch date' } },
      { type: 'mcp_tool_result' as const, id: 'mcptoolu_9', text: 'REC-12 Launch: 2026-10-18' },
    ],
    stop: 'pause_turn' as const,
  }

  async function freeRequest(page: Page, steps: ClaudeStep[]) {
    const { requests } = await mockClaudeScript(page.context(), steps)
    await openApp(page)
    await wsEval(page, (s, list) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', mcpServers: list }), [ARCHIVE])
    const id = await createPage(page, { title: 'Launch plan', content: doc(para('We launch in two weeks.'), para('')) })
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
    await ask.fill('What does Archive say about the launch?')
    await page.keyboard.press('Enter')
    return requests
  }

  test('an MCP call ran, then a server rejected its token: no retry without it (the call never runs twice)', async ({ page, errors }) => {
    errors.allow(/400|Bad Request|Failed to load resource/)
    const requests = await freeRequest(page, [CALLED, AUTH, text('Answer without Archive.')])
    await expect(aiPanel(page).locator('.ai-error')).toContainText('ERR · MCP_AUTH')
    await page.waitForTimeout(500)
    // the first response made the call; its resume was refused — nothing after that
    expect(requests).toHaveLength(2)
  })

  test('positive control: refused before any MCP call → once more without the server', async ({ page, errors }) => {
    errors.allow(/400|Bad Request|Failed to load resource/)
    const requests = await freeRequest(page, [AUTH, text('Answer without Archive.')])
    await expect(aiPanel(page)).toContainText('Answer without Archive.')
    expect(requests).toHaveLength(2)
    expect(requests[1].body.mcp_servers ?? []).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* The ledger: one entry per response (task 10)                         */
/* ------------------------------------------------------------------ */

/** Claude scripted, a key, the clock: the requests as they went out. */
async function keyed(page: Page, steps: ClaudeStep[], settings: AnyState = {}) {
  const { requests } = await mockClaudeScript(page.context(), steps)
  await openApp(page)
  await wsEval(page, (s, extra) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', ...extra }), settings)
  return requests
}

/** Every response of a flow is exactly one entry: its model, a table price, the purpose, the data classes it carried. */
async function expectMetered(page: Page, requests: CapturedRequest[], n: number, purpose: string, classes: string[]) {
  await expect.poll(() => requests.length, { timeout: 20_000 }).toBe(n)
  await page.waitForTimeout(300)
  expect(requests).toHaveLength(n)
  const entries = await ledger(page)
  expect(entries, 'one entry per response').toHaveLength(n)
  expect(new Set(entries.map((e) => e.id)).size).toBe(n)
  entries.forEach((e, i) => {
    expect(e.purpose).toBe(purpose)
    expect(e.served).toEqual({ p: 'anthropic', model: requests[i].body.model })
    expect(e.route).toBe(`anthropic:${requests[i].body.model}`)
    expect(e.costSource).toBe('table')
    expect(e.usd).toBeGreaterThan(0)
    expect(e.scope).toBe('local:local')
    expect(e.outcome).toBe('ok')
    for (const c of classes) expect(e.classes).toContain(c)
  })
  return entries
}

const PAUSED = {
  blocks: [
    { type: 'mcp_tool_use' as const, id: 'mcptoolu_1', server: 'archive', name: 'archive_search', input: { query: 'launch date' } },
    { type: 'mcp_tool_result' as const, id: 'mcptoolu_1', text: 'REC-12 Launch: 2026-10-18' },
  ],
  stop: 'pause_turn' as const,
}

test.describe('the ledger: one entry per response, every engine', () => {
  test('Improve (runAI → streamCompletion): one entry, priced by the table — the stored usage, its cost', async ({ page }) => {
    const requests = await keyed(page, [text('A tighter launch sentence.', { usage: { input: 1200, output: 300, cacheRead: 0, cacheWrite: 0 } })])
    await improve(page)
    const [e] = await expectMetered(page, requests, 1, 'menu.action', ['selection', 'page'])
    expect(e.usage).toEqual({ input: 1200, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, output: 300, reasoning: 0 })
    // Opus 5.5: $4 in, $20 out per million
    expect(e.usd).toBeCloseTo((1200 * 4 + 300 * 20) / 1e6, 10)
    expect(e.source).toMatch(/^ai:[^:]+:improve$/)
    expect(e.cls).toBe('write')
  })

  test('an own request with an MCP server: the paused turn and its resume are one entry each', async ({ page }) => {
    const requests = await keyed(page, [PAUSED, text('According to Archive, the launch is on 2026-10-18 (REC-12).')], { mcpServers: [ARCHIVE] })
    await ownRequest(page, 'What does Archive say about the launch?')
    await expect(aiPanel(page).locator('.ai-out__body')).toContainText('According to Archive')
    const entries = await expectMetered(page, requests, 2, 'menu.ask', ['page', 'mcp'])
    expect(entries.map((e) => e.mcpCalls)).toEqual([1, 0])
    expect(entries[0].source).toBe(entries[1].source)
  })

  test('⌘K "?" (palette.ask): one entry', async ({ page }) => {
    const requests = await keyed(page, [text('The launch is in two weeks.')])
    await paletteAsk(page, 'When do we launch?', 'The launch is in two weeks.')
    await expectMetered(page, requests, 1, 'palette.ask', ['page'])
  })

  test('Transform → Auto (completeStructured ×2): two entries', async ({ page }) => {
    const requests = await keyed(page, TRANSFORM_STEPS)
    await transformAuto(page)
    await expectMetered(page, requests, 2, 'structure.transform', ['selection'])
  })

  test('a meeting summary on Haiku 4.5: one entry at the Haiku price', async ({ page }) => {
    await noSpeech(page)
    const requests = await keyed(page, [text(JSON.stringify(SUMMARY))], { aiModel: 'claude-haiku-4-5' })
    await summarizeMeeting(page)
    const [e] = await expectMetered(page, requests, 1, 'meeting.summary', ['transcript'])
    expect(e.served.model).toBe('claude-haiku-4-5')
    // the JSON answer's usage: 400 in, 40 out at $1 / $5
    expect(e.usd).toBeCloseTo((400 * 1 + 40 * 5) / 1e6, 10)
  })

  test('the AI terminal (runAgent): one entry per round, the conversation as the source', async ({ page }) => {
    const requests = await keyed(page, [{ blocks: [{ type: 'tool_use', id: 'toolu_l1', name: 'search_pages', input: { query: 'launch' } }] }, text('We launch in two weeks.')])
    const id = await createPage(page, { title: 'Launch notes', content: doc(para('We launch in two weeks.')) })
    await gotoPage(page, id)
    await openTerminal(page)
    await run(page, 'When do we launch?')
    await expect(terminal(page).locator('.term-answer')).toContainText('We launch in two weeks.')
    const entries = await expectMetered(page, requests, 2, 'terminal.task', ['workspace'])
    expect(entries[0].source).toMatch(/^terminal:/)
    expect(entries[1].source).toBe(entries[0].source)
  })

  test('a custom agent with its own model: one entry per round at that model', async ({ page }) => {
    const requests = await keyed(page, [{ blocks: [{ type: 'tool_use', id: 'toolu_a1', name: 'search_pages', input: { query: 'launch' } }] }, text('**Status report:** nothing blocks the launch.')])
    await runAgentNow(page, { id: 'ag-ledger', name: 'Status reader', model: 'claude-sonnet-5-5', effort: 'high' })
    const entries = await expectMetered(page, requests, 2, 'agents.run', ['workspace'])
    expect(entries.map((e) => e.route)).toEqual(['anthropic:claude-sonnet-5-5', 'anthropic:claude-sonnet-5-5'])
    expect(entries[0].source).toMatch(/^agent:ag-ledger:/)
  })

  test('a PDF summary (requestFile): one entry', async ({ page }) => {
    const requests = await keyed(page, [text('Invoice **2025-117** from Acme GmbH.')])
    await summarisePdf(page)
    await expect(aiPanel(page)).toContainText('from Acme GmbH')
    await expectMetered(page, requests, 1, 'documents.file', ['files', 'page'])
  })

  test('an image description (requestImage): one entry', async ({ page }) => {
    const requests = await keyed(page, [text(JSON.stringify({ alt: 'A striped test pattern.', caption: 'Test pattern P1' }))])
    await imageAction(page, /Describe the image/)
    await expect(aiPanel(page).getByRole('textbox', { name: 'Alt text' })).toHaveValue('A striped test pattern.')
    await expectMetered(page, requests, 1, 'vision.image', ['files'])
  })

  test('an MCP server test (inspectServer): one entry', async ({ page }) => {
    const requests = await keyed(page, [text('TOOLS: archive_search, archive_get\n---\n**Archive** is the team knowledge base.')])
    await addArchiveServer(page)
    await expectMetered(page, requests, 1, 'mcp-setup.inspect', ['mcp'])
  })

  test('Ask the help (help.ask) and the key test (setup.test): one entry each, public text only', async ({ page }) => {
    const requests = await keyed(page, [text('Open **Share** and switch on **Protect with password**.'), text('OK')])
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
    await page.keyboard.press('?')
    const help = page.getByRole('dialog', { name: /^(Help|Hilfe)$/ })
    await help.getByRole('tab', { name: /Ask/ }).click()
    const field = help.getByRole('textbox', { name: 'Your question' })
    await field.fill('How do I protect a share link with a password?')
    await field.press('Enter')
    await expect(help.locator('.help-ask__out')).toContainText('Protect with password')
    await page.keyboard.press('Escape')
    await uiEval(page, (s) => s.openModal({ type: 'settings', tab: 'ai' }))
    await page.getByRole('dialog').getByRole('button', { name: 'Test key' }).click()
    await expect(page.getByRole('dialog').locator('.ai-status')).toContainText('Connected · key verified')
    await expect.poll(() => requests.length).toBe(2)
    await page.waitForTimeout(300)
    const entries = await ledger(page)
    expect(entries.map((e) => e.purpose)).toEqual(['help.ask', 'setup.test'])
    for (const e of entries) {
      expect(e.classes).toEqual(['public'])
      expect(e.costSource).toBe('table')
      expect(e.served.model).toBe('claude-opus-5-5')
    }
  })

  test('autofill: one entry, the database and field as the source', async ({ page }) => {
    const requests = await keyed(page, [text(JSON.stringify({ value: 'Low' }))])
    const { dbId, propId } = await autofillPriority(page)
    const [e] = await expectMetered(page, requests, 1, 'bulk.autofill', ['rows'])
    expect(e.source).toBe(`autofill:${dbId}:${propId}`)
  })
})

test.describe('the ledger: cut short, refused, other models, reload, reset', () => {
  test('a response another model answered (refusal fallback): the step, priced at the model that answered', async ({ page }) => {
    const requests = await keyed(page, [text('A tighter launch sentence.', { model: 'claude-sonnet-5-5', usage: { input: 1000, output: 100 } })])
    await improve(page)
    await expect.poll(() => requests.length).toBe(1)
    const [e] = await ledger(page)
    expect(e.route).toBe('anthropic:claude-opus-5-5')
    expect(e.served).toEqual({ p: 'anthropic', model: 'claude-sonnet-5-5' })
    expect(e.steps).toEqual([{ k: 'refusal-fallback', from: 'claude-opus-5-5', to: 'claude-sonnet-5-5' }])
    // Sonnet 5.5: $2 in, $10 out — not Opus
    expect(e.usd).toBeCloseTo((1000 * 2 + 100 * 10) / 1e6, 10)
  })

  test('a dated snapshot id is the requested model (no fallback step, the same price)', async ({ page }) => {
    await keyed(page, [text('A tighter launch sentence.', { model: 'claude-opus-5-5-20261001', usage: { input: 1000, output: 100 } })])
    await improve(page)
    await expect.poll(async () => (await ledger(page)).length).toBe(1)
    const [e] = await ledger(page)
    expect(e.steps).toBeUndefined()
    expect(e.served.model).toBe('claude-opus-5-5')
    expect(e.usd).toBeCloseTo((1000 * 4 + 100 * 20) / 1e6, 10)
  })

  test('Sonnet 5.5 cache reads are priced at $0.10 per million', async ({ page }) => {
    await keyed(page, [text('A tighter launch sentence.', { usage: { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 0 } })], { aiModel: 'claude-sonnet-5-5' })
    await improve(page)
    await expect.poll(async () => (await ledger(page)).length).toBe(1)
    const [e] = await ledger(page)
    expect(e.usage.cacheRead).toBe(1_000_000)
    expect(e.usd).toBeCloseTo(0.1, 10)
  })

  test('a stream stopped before its answer: one ESTIMATE entry (the prompt, never $0)', async ({ page, errors }) => {
    errors.allow(/Failed to load resource/)
    let held = 0
    await page.context().route('https://api.anthropic.com/**', async (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
      held += 1
      // never answered: the person stops it
    })
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    await improve(page, null)
    await expect.poll(() => held).toBe(1)
    await aiPanel(page).locator('.ai-stop').click()
    await expect.poll(async () => (await ledger(page)).length).toBe(1)
    await page.waitForTimeout(300)
    const entries = await ledger(page)
    expect(entries).toHaveLength(1)
    expect(entries[0].costSource).toBe('estimate')
    expect(entries[0].outcome).toBe('aborted')
    expect(entries[0].usage.input).toBeGreaterThan(50)
    expect(entries[0].usd).toBeGreaterThan(0)
  })

  test('a stream that fails mid-answer: one ESTIMATE entry from its message_start and the streamed text', async ({ page, errors }) => {
    errors.allow(/Failed to load resource|Overloaded|overloaded/)
    const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
    const body =
      ev('message_start', { message: { id: 'msg_cut_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 2400, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) +
      ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) +
      ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'A tighter launch sentence that goes on and on, and then' } }) +
      ev('error', { error: { type: 'overloaded_error', message: 'Overloaded' } })
    await page.context().route('https://api.anthropic.com/**', (route) =>
      route.request().method() === 'OPTIONS'
        ? route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
        : route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'text/event-stream' }, body }),
    )
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    await improve(page, null)
    await expect.poll(async () => (await ledger(page)).length).toBe(1)
    const [e] = await ledger(page)
    expect(e.costSource).toBe('estimate')
    expect(e.usage.input).toBe(2400)
    // the streamed characters ÷ 4
    expect(e.usage.output).toBe(Math.ceil('A tighter launch sentence that goes on and on, and then'.length / 4))
    expect(e.outcome).not.toBe('ok')
  })

  test('a request refused with an HTTP status: listed, nothing billed', async ({ page, errors }) => {
    errors.allow(/Failed to load resource|429|Too Many/)
    await keyed(page, [{ status: 429, json: { type: 'error', error: { type: 'rate_limit_error', message: 'Slow down' } } }, { status: 429, json: { type: 'error', error: { type: 'rate_limit_error', message: 'Slow down' } } }, { status: 429, json: { type: 'error', error: { type: 'rate_limit_error', message: 'Slow down' } } }])
    await improve(page, null)
    await expect(aiPanel(page).locator('.ai-error')).toBeVisible({ timeout: 30_000 })
    const entries = await ledger(page)
    // the SDK's own retries are inside one request: one entry
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ outcome: 'rate_limit', usd: 0, costSource: 'table' })
    expect(entries[0].usage).toEqual({ input: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, reasoning: 0 })
  })

  test('demo answers are never metered; entries survive a reload; the local reset wipes them', async ({ page, aiNet }) => {
    const { requests } = await mockClaudeScript(page.context(), [text('A tighter launch sentence.')])
    await openApp(page)
    // no key: the demo answer — nothing sent, nothing metered
    const id = await createPage(page, { title: 'Demo notes', content: doc(para('our launch sentence is kinda loose')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p', { hasText: 'our launch sentence is kinda loose' }).click()
    await selectText(page, ed, 'our launch sentence is kinda loose')
    await page.locator('[aria-label="Formatting"]').first().getByRole('button', { name: /^Ask AI$/ }).click()
    await aiPanel(page).getByRole('button', { name: /Try a demo answer/ }).click()
    await aiPanel(page).getByRole('option', { name: /Improve writing/ }).click()
    await expect(aiPanel(page).locator('.ai-out__body')).not.toBeEmpty()
    await expect(aiPanel(page).locator('.ai-stop')).toHaveCount(0, { timeout: 15_000 })
    await page.waitForTimeout(300)
    expect(await ledger(page)).toEqual([])
    expect(aiNet.count('anthropic')).toBe(0)
    await page.keyboard.press('Escape')
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    await improve(page)
    expect(requests).toHaveLength(1)
    await expect.poll(async () => (await ledger(page)).length).toBe(1)
    const [e] = await ledger(page)
    // nothing of the page in the stored entry: ids, numbers, classes
    expect(JSON.stringify(e)).not.toContain('launch')
    await page.evaluate(() => (window as unknown as { __oneLedger: { flush: () => Promise<void> } }).__oneLedger.flush())
    await reloadApp(page)
    expect((await ledger(page)).map((x) => x.id)).toEqual([e.id])
    await page.evaluate(() => localStorage.setItem('one.resetPending', '1'))
    await page.reload()
    await page.waitForFunction(() => !!(window as unknown as { __oneLedger?: unknown }).__oneLedger)
    await expect.poll(async () => (await ledger(page)).length).toBe(0)
  })

  test('no IndexedDB `one-ledger` on the boot path: it opens with the first entry', async ({ page }) => {
    await keyed(page, [text('A tighter launch sentence.')])
    await page.waitForTimeout(500)
    const before = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))
    expect(before).not.toContain('one-ledger')
    await improve(page)
    await expect.poll(async () => (await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))).includes('one-ledger')).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* Receipts on AI run cards (task 12)                                   */
/* ------------------------------------------------------------------ */

/** A receipt's line as read (spaces folded, as toHaveText does): label, model, cost, source — without its help key ("?"), checked apart. */
const lineOf = (receipt: Locator) =>
  receipt.locator('.ai-receipt__line').evaluate((el) => [...el.childNodes].filter((n) => !(n instanceof HTMLElement && n.classList.contains('help-link'))).map((n) => n.textContent).join('').replace(/\s+/g, ' '))

test.describe('the receipt on an AI run card', () => {
  test('after Improve: the model, the cost and TABLE — equal to the ledger entry; kept with the run', async ({ page }) => {
    await keyed(page, [text('A tighter launch sentence.', { usage: { input: 1200, output: 300 } })])
    const id = await improve(page)
    const receipt = aiPanel(page).getByTestId('ai-receipt')
    await expect(receipt).toBeVisible()
    const [e] = await ledger(page)
    // Opus 5.5: 1,200 × $4 + 300 × $20 per million = $0.0108
    expect(e.usd).toBeCloseTo(0.0108, 10)
    await expect.poll(() => lineOf(receipt)).toBe('ReceiptClaude Opus 5.5 · $0.0108Table')
    await expect(receipt.getByRole('button', { name: 'Help: what AI requests cost' })).toBeVisible()
    await expect(receipt).toHaveAttribute('title', /Tokens in 1,200 · cache write 0 · cache read 0 · out 300/)
    await expect(receipt.getByTestId('ai-receipt-step')).toHaveCount(0)
    // the run keeps it: after a reload the card says the same
    await page.keyboard.press('Escape')
    await reloadApp(page)
    await gotoPage(page, id)
    await page.getByTestId('ai-runs').getByRole('button').click()
    await expect.poll(() => lineOf(aiPanel(page).getByTestId('ai-receipt'))).toBe('ReceiptClaude Opus 5.5 · $0.0108Table')
  })

  test('another model answered: the step "Anthropic passed this to …", priced at the model that answered (German)', async ({ page }) => {
    await keyed(page, [text('Ein knapperer Satz.', { model: 'claude-sonnet-5-5', usage: { input: 1000, output: 100 } })], { language: 'de' })
    const id = await createPage(page, { title: 'Startnotizen', content: doc(para('unser Startsatz ist etwas lose')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p', { hasText: 'unser Startsatz ist etwas lose' }).click()
    await selectText(page, ed, 'unser Startsatz ist etwas lose')
    await page.locator('[aria-label="Formatierung"]').first().getByRole('button', { name: /^KI fragen$/ }).click()
    await aiPanel(page).getByRole('option', { name: /Text verbessern/ }).click()
    await expect(aiPanel(page)).toContainText('Ein knapperer Satz.')
    const receipt = aiPanel(page).getByTestId('ai-receipt')
    // Sonnet 5.5: 1,000 × $2 + 100 × $10 per million = $0.0030
    await expect.poll(() => lineOf(receipt)).toBe('BelegClaude Sonnet 5.5 · 0,0030 $Tabelle')
    await expect(receipt.getByRole('button', { name: 'Hilfe: was KI-Anfragen kosten' })).toBeVisible()
    await expect(receipt.getByTestId('ai-receipt-step')).toHaveText('Anthropic hat an Claude Sonnet 5.5 weitergegeben')
  })

  test('a run stopped before its answer keeps an ESTIMATE receipt; a failed one too', async ({ page, errors }) => {
    errors.allow(/Failed to load resource|Overloaded|overloaded/)
    const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
    const body =
      ev('message_start', { message: { id: 'msg_cut_2', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 2400, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) +
      ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) +
      ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'A tighter launch sentence that' } }) +
      ev('error', { error: { type: 'overloaded_error', message: 'Overloaded' } })
    await page.context().route('https://api.anthropic.com/**', (route) =>
      route.request().method() === 'OPTIONS'
        ? route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
        : route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'text/event-stream' }, body }),
    )
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    await improve(page, null)
    await expect(aiPanel(page).locator('.ai-error')).toBeVisible()
    const receipt = aiPanel(page).getByTestId('ai-receipt')
    await expect(receipt).toHaveAttribute('data-src', 'estimate')
    await expect(receipt.getByTestId('ai-receipt-usd')).toHaveText(/^ · ≈ \$0\.\d{4}$/)
    await expect(receipt.locator('.ai-receipt__src')).toHaveText('Estimate')
  })
})

/* ------------------------------------------------------------------ */
/* Receipts in the terminal and on agent runs (task 13)                 */
/* ------------------------------------------------------------------ */

test.describe('receipts in the terminal and on agent runs', () => {
  test('/cost after two tasks on two models lists both; the sums equal the ledger; Sonnet cache reads at $0.10', async ({ page }) => {
    await keyed(page, [text('We launch in two weeks.', { usage: { input: 2000, output: 100 } }), text('Mara owns the launch.', { usage: { input: 1000, output: 50, cacheRead: 1_000_000 } })])
    const id = await createPage(page, { title: 'Launch notes', content: doc(para('We launch in two weeks. Mara owns the launch.')) })
    await gotoPage(page, id)
    await openTerminal(page)
    await run(page, 'When do we launch?')
    await expect(terminal(page).locator('.term-answer').last()).toContainText('We launch in two weeks.')
    // the model changes mid-session
    await wsEval(page, (s) => s.updateSettings({ aiModel: 'claude-sonnet-5-5' }))
    await run(page, 'Who owns the launch?')
    await expect(terminal(page).locator('.term-answer').last()).toContainText('Mara owns the launch.')
    await run(page, '/cost')
    const table = terminal(page).getByTestId('term-cost').last()
    await expect(table.locator('tbody tr')).toHaveCount(2)
    const opus = table.locator('tr[data-model="anthropic:claude-opus-5-5"]')
    const sonnet = table.locator('tr[data-model="anthropic:claude-sonnet-5-5"]')
    await expect(opus.locator('th')).toHaveText('Claude Opus 5.5')
    // Opus: 2,000 × $4 + 100 × $20 = $0.0100
    await expect(opus.locator('.term-cost__usd')).toHaveText('$0.0100')
    await expect(opus.locator('.term-cost__src')).toHaveText('Table')
    // Sonnet: 1,000 × $2 + 1M cache reads × $0.10 + 50 × $10 = $0.1025
    await expect(sonnet.locator('.term-cost__usd')).toHaveText('$0.1025')
    await expect(sonnet.locator('td').nth(2)).toHaveText('0 / 1.00M')
    await expect(table.getByTestId('term-cost-total')).toHaveText('$0.1125')
    const entries = await ledger(page)
    expect(entries.map((e) => e.served.model)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5'])
    expect(entries.reduce((a, e) => a + e.usd, 0)).toBeCloseTo(0.1125, 10)
    // the footer meter shows the same sum
    await expect(terminal(page).getByTestId('agent-cost')).toHaveText('≈ $0.11')
  })

  test('a terminal answer another model gave: the step in the task, /cost prices it at that model', async ({ page }) => {
    await keyed(page, [text('We launch in two weeks.', { model: 'claude-sonnet-5-5', usage: { input: 1000, output: 100 } })], { language: 'de' })
    const id = await createPage(page, { title: 'Startnotizen', content: doc(para('Wir starten in zwei Wochen.')) })
    await gotoPage(page, id)
    const term = page.getByRole('region', { name: /AI terminal|KI-Terminal/ })
    const ask = term.getByRole('textbox', { name: /Task for the agent|Aufgabe für den Agenten/ })
    await page.keyboard.press(`${MOD}+j`)
    await expect(ask).toBeFocused()
    await ask.fill('Wann starten wir?')
    await ask.press('Enter')
    await expect(term.locator('.term-answer').last()).toContainText('We launch in two weeks.')
    await expect(term.locator('.term-scroll')).toContainText('Anthropic hat an Claude Sonnet 5.5 weitergegeben')
    await ask.fill('/kosten')
    await ask.press('Enter')
    const table = term.getByTestId('term-cost').last()
    await expect(table.locator('tbody tr')).toHaveCount(1)
    await expect(table.locator('tr[data-model="anthropic:claude-sonnet-5-5"] .term-cost__usd')).toHaveText('0,0030 $')
  })

  test('an agent run lists a line per model under its usage; the sum equals the ledger', async ({ page }) => {
    await keyed(page, [{ blocks: [{ type: 'tool_use', id: 'toolu_r1', name: 'search_pages', input: { query: 'launch' } }], usage: { input: 3000, output: 120 } }, text('**Status report:** nothing blocks the launch.', { usage: { input: 3400, output: 200 } })])
    await runAgentNow(page, { id: 'ag-receipt', name: 'Status reader', model: 'claude-sonnet-5-5' })
    const row = page.locator('.agx-run').first()
    const line = row.getByTestId('agx-run-model')
    await expect(line).toHaveCount(1)
    await expect(line).toHaveAttribute('data-model', 'anthropic:claude-sonnet-5-5')
    await expect(line.locator('.agx-run__model-name')).toHaveText('Claude Sonnet 5.5')
    await expect(line.locator('.agx-run__model-tok')).toHaveText('2 req · in 6,400 · cache w 0 / r 0 · out 320')
    // 6,400 × $2 + 320 × $10 per million = $0.0160
    await expect(line.locator('.agx-run__model-usd')).toHaveText('$0.0160')
    await expect(line.locator('.agx-run__model-src')).toHaveText('Table')
    const entries = (await ledger(page)).filter((e) => e.source.startsWith('agent:ag-receipt:'))
    expect(entries).toHaveLength(2)
    expect(entries.reduce((a, e) => a + e.usd, 0)).toBeCloseTo(0.016, 10)
  })

  test('an agent run whose second response another model gave: two lines and the step', async ({ page }) => {
    await keyed(page, [{ blocks: [{ type: 'tool_use', id: 'toolu_r2', name: 'search_pages', input: { query: 'launch' } }], usage: { input: 3000, output: 120 } }, text('**Status report:** on track.', { model: 'claude-sonnet-5-5', usage: { input: 3400, output: 200 } })])
    await runAgentNow(page, { id: 'ag-fallback', name: 'Status reader' })
    const row = page.locator('.agx-run').first()
    await expect(row.getByTestId('agx-run-model')).toHaveCount(2)
    await expect(row.locator('.agx-step', { hasText: 'Anthropic passed this to Claude Sonnet 5.5' })).toHaveCount(1)
    // Opus: 3,000 × $4 + 120 × $20 = $0.0144 · Sonnet: 3,400 × $2 + 200 × $10 = $0.0088
    await expect(row.locator('[data-model="anthropic:claude-opus-5-5"] .agx-run__model-usd')).toHaveText('$0.0144')
    await expect(row.locator('[data-model="anthropic:claude-sonnet-5-5"] .agx-run__model-usd')).toHaveText('$0.0088')
  })
})
