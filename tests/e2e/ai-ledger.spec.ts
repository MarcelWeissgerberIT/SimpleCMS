/**
 * Multi-provider S1 in the browser: the no-real-host guard (aiNet), the contracts every reader keeps, the gate in
 * front of every AI request (policy generation, keys in typed text), the agent route block and the small safety fixes.
 * Every AI host is mocked or aborted — nothing reaches a real one. Test data is fictional.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import type { Page, TestInfo } from '@playwright/test'
import { test, expect, openApp, reloadApp, wsEval, flush, createPage, gotoPage, editorOf, doc, para, selectText, pageIdByTitle, MOD } from './fixtures'
import { mockClaudeScript, hostCounts, text, type ClaudeStep } from './helpers/providers'
import { openTerminal, run, terminal } from './helpers/terminal'

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

const aiPanel = (page: Page) => page.getByRole('dialog', { name: /Ask Claude|Claude fragen/ })

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
      if (refused) await expect(aiPanel(page).locator('.ai-error')).toContainText(RELOAD)
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
      if (refused) await expect(terminal(page).locator('.term-error')).toContainText(RELOAD)
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
