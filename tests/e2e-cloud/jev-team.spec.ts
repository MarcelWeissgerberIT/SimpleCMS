/**
 * Jev as Vorprüfer in a team workspace (slice SJ, J11): an agent's review v2 travels through the meta map `agents` byte
 * for byte (the server keeps it, every reader keeps it); a member's edit of section 06 makes the browser agent wait for
 * its creator (as any change by another member does); the checks run in the creator's browser with the creator's
 * OpenRouter key — the member's browser sends nothing. Mocked hosts only; people and rows are fictional.
 */
import type { Page } from '@playwright/test'
import { test, expect, email, signIn, newPerson, openApp, wsEval, cloudEval, waitOnline, createWorkspace, join as joinWorkspace } from './fixtures'
import { mockClaudeScript, mockOpenRouter, seedEndpoints, text } from '../e2e/helpers/providers'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const OR_KEY = 'sk-or-v1-e2e-openrouter-team-ada-000000000000000000000000000000000000'
const JEV = 'typesafe/jev-1.13'
const ON = `openrouter:${JEV}-20260917`

const errors: string[] = []
function watch(p: Page, who: string) {
  p.on('pageerror', (e) => errors.push(`${who} pageerror: ${e.message}`))
  p.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${who} console.error: ${m.text()}`)
  })
}
test.beforeEach(() => {
  errors.length = 0
})
test.afterEach(() => {
  expect.soft(errors, 'browser errors').toEqual([])
})

test('a Vorprüfer agent in a team: review v2 syncs as written; a member’s change waits for the creator; the creator’s browser checks with the creator’s key', async ({ page: a, context }) => {
  watch(a, 'ada')
  const adaOr = await mockOpenRouter(a, {})
  let rowId = ''
  let staged = false
  await mockClaudeScript(a, [], {
    fallback: () => {
      if (staged) return text('Checked the Nordlicht rows.')
      staged = true
      return { blocks: [{ type: 'tool_use' as const, id: 'toolu_team_1', name: 'update_row', input: { id: rowId, properties: { Note: 'Checked' } } }] }
    },
  })
  await signIn(a, email('ada'))
  const wsId = await createWorkspace(a, 'Nordlicht Team')
  const b = await newPerson(context)
  watch(b, 'bob')
  const bobOr = await mockOpenRouter(b, {})
  await signIn(b, email('bob'))
  await joinWorkspace(a, b, wsId, 'member')
  for (const p of [a, b]) {
    await openApp(p, wsId)
    await waitOnline(p)
  }
  const adaId = await cloudEval(a, (c) => c.user.id as string)
  await wsEval(a, (s, k) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', aiKeys: { openrouter: k }, ai: { allow: { openrouter: ['private', 'mail', 'memory', 'mcp'] } } }), OR_KEY)
  await wsEval(a, (s) => s.setWorkspaceAI({ policy: { providers: { openrouter: { allow: ['public', 'structure', 'selection', 'page', 'rows', 'files', 'workspace', 'people', 'transcript'] } }, restricted: [] } }))
  await seedEndpoints(a, { [JEV]: [{ tag: 'typesafe', name: 'TypeSafe' }] })
  const made = await wsEval(a, (s) => {
    const db = s.createDatabase({ title: 'Projects' }) as string
    const note = s.addProperty(db, { type: 'text', name: 'Note' }) as string
    return { db, note, row: s.createRow(db, { title: 'Launch plan' }) as string }
  })
  rowId = made.row
  const review = { v: 2, decider: { p: 'openrouter', m: JEV }, on: ON, pre: { markBelow: 0.7, hold: true } }
  const now = Date.now()
  await wsEval(
    a,
    (s, x) => s.upsertAgent(x),
    { id: 'ag-jev', name: 'Nordlicht Pflege', instructions: 'Keep the Note of every Projects row up to date.', trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: 'stage', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: true, createdAt: now, updatedAt: now, createdBy: adaId, review },
  )
  // the review travels as written (the server and every reader keep it)
  await expect.poll(() => wsEval(b, (s) => JSON.stringify(s.agents?.['ag-jev']?.review ?? null)), { timeout: 20_000 }).toBe(JSON.stringify(review))

  // Bob opens section 06: he sees it on (Jev 1.13, 0.70); he lowers the mark threshold and saves
  await b.evaluate(() => (window.location.hash = '#/agents/ag-jev'))
  await b.getByRole('button', { name: 'Edit', exact: true }).click()
  const sec = b.locator('.agx-editor').getByTestId('jev-ed')
  await expect(sec.getByRole('switch', { name: 'Pre-check' })).toHaveAttribute('aria-checked', 'true')
  await expect(sec.getByTestId('jev-chip')).toContainText('Jev 1.13')
  await sec.getByTestId('jev-mark').getByRole('button', { name: /lower/ }).click()
  await b.locator('.agx-editor').getByRole('button', { name: 'Save', exact: true }).click()
  await expect(b.locator('.agx-editor')).toHaveCount(0)
  await expect.poll(() => wsEval(a, (s) => s.agents?.['ag-jev']?.review?.pre?.markBelow ?? null), { timeout: 20_000 }).toBe(0.65)
  // Ada's browser: the agent waits for her (a member changed it)
  await a.evaluate(() => (window.location.hash = '#/agents'))
  await expect(a.locator('.agx-card', { hasText: 'Nordlicht Pflege' })).toHaveAttribute('data-state', 'waiting')
  // no decision went out from either browser (Bob's editor read the public decisions list only — no key)
  expect(adaOr.decisions()).toHaveLength(0)
  expect(bobOr.decisions()).toHaveLength(0)
  expect(bobOr.requests.filter((r) => r.bearer)).toHaveLength(0)

  // Ada confirms; her run is checked in her browser with her key — Bob's browser never sends a decision
  await a.evaluate(() => (window.location.hash = '#/agents/ag-jev'))
  await a.getByTestId('agx-wait').getByRole('button', { name: 'Confirm' }).click()
  await expect(a.getByTestId('agx-wait')).toHaveCount(0)
  const runId = await a.evaluate(() => (window as unknown as { __oneAgents: AnyState }).__oneAgents.run('ag-jev', {}))
  expect(runId).toBeTruthy()
  await expect.poll(() => adaOr.decisions().length, { timeout: 20_000 }).toBe(1)
  expect(adaOr.decisions()[0]!.bearer).toBe(OR_KEY)
  expect(JSON.stringify(adaOr.decisions()[0]!.body)).not.toContain(rowId)
  expect(bobOr.decisions()).toHaveLength(0)
  await b.context().close()
})
