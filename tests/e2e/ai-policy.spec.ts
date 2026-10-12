/**
 * The AI data rules in use (multi-provider S2, stage B): what a provider may receive decides what is built and sent.
 * The route comes from this device's rules (no forced route): a device default on an OpenRouter model, the workspace's
 * allow list for OpenRouter (a preset), this device's member classes. Every openrouter.ai and api.anthropic.com exchange
 * is mocked (helpers/providers.ts) — nothing reaches a real host. People, pages and rows are fictional.
 *
 *  - the rules' generation stamps (acceptance 9, stamp part)
 *  - a class the route may not receive: refused before anything is sent (acceptance 4, the mail part of 5)
 *  - names and transcripts left out for a route without them (acceptance 6) — and in, for a route with them
 *  - the One memory withheld (D-S2-29)
 *  - a codeword on a route that cannot connect MCP servers: refused before sending, "Ask Claude" (acceptance 7)
 */
import type { Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, openApp, wsEval, uiEval, createPage, gotoPage, editorOf, selectText, doc, para, flush } from './fixtures'
import { hostCounts, mockClaudeScript, mockOpenRouter, seedEndpoints, text, type ClaudeStep, type ORStepFn } from './helpers/providers'
import { aiPanel, autofillPriority, noSpeech } from './helpers/aiFlows'
import { exportBackup } from './helpers/backup'
import { writeFileSync } from 'node:fs'
import { capsOfRow, readCatalogRow } from '../../src/shared/ai/catalog'
import type { Route, ShortlistRow } from '../../src/shared/ai/types'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const OR_KEY = 'sk-or-v1-e2e-openrouter-key-0000000000000000000000000000000000000000'
const CATALOGUE = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/openrouter-models.json', import.meta.url)), 'utf8')) as { data: unknown[] }
const row = (id: string): ShortlistRow => {
  const r = readCatalogRow(CATALOGUE.data.find((x) => (x as { id: string }).id === id), '2026-10-12')!
  return { m: r.id, label: r.label, price: r.price, caps: capsOfRow(r), at: '2026-10-12' }
}
const LUNA = 'openai/gpt-6-luna'
const POOL = [LUNA, 'deepseek/deepseek-v4-flash', 'z-ai/glm-5.3']
const SHORTLIST = POOL.map(row)
const MODEL: Route = { p: 'openrouter', m: LUNA }
const ENDPOINTS = { [LUNA]: [{ tag: 'nordwind', name: 'Nordwind' }], 'deepseek/deepseek-v4-flash': [{ tag: 'nordwind', name: 'Nordwind' }], 'z-ai/glm-5.3': [{ tag: 'birkenau', name: 'Birkenau' }], 'typesafe/jev-router': [{ tag: 'typesafe', name: 'TypeSafe' }] }

const ALL = ['public', 'structure', 'selection', 'page', 'rows', 'files', 'workspace', 'people', 'transcript']
const WORK = ['public', 'structure', 'selection', 'page', 'rows', 'files', 'workspace']
const MARKED = ['public', 'structure', 'selection']

/** The rules' setters (store/aiRules.ts through the ?e2e seam — each runs as the spec's own write). */
const rules = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    async ([fn, args]) => {
      const m = (await (window as unknown as { __oneAI: { rules(): Promise<Record<string, (...a: unknown[]) => unknown>> } }).__oneAI.rules()) as Record<string, (...a: unknown[]) => unknown>
      return m[fn as string](...(args as unknown[]))
    },
    [fn, args] as const,
  )

/** What the gate decides for a request (the ?e2e seam: nothing sent). */
const gateSays = (page: Page, input: AnyState) => page.evaluate((i) => (window as unknown as { __oneAI: { precheck(i: unknown): AnyState } }).__oneAI.precheck(i), input)

interface Setup {
  /** the workspace's allow list for OpenRouter (a preset) */
  allow: string[]
  /** this device's member classes for OpenRouter */
  member?: string[]
  chat?: ORStepFn[]
  claude?: ClaudeStep[]
  /** the device default (default: an OpenRouter model) */
  route?: Route | null
}

/** Claude + OpenRouter keys, the shortlist, the rules — the device default on OpenRouter. */
async function setup(page: Page, o: Setup) {
  const or = await mockOpenRouter(page.context(), { chat: o.chat ?? [], fallback: { text: 'A tighter launch sentence.', cost: 0.0002 }, endpoints: ENDPOINTS })
  const claude = await mockClaudeScript(page.context(), o.claude ?? [], { fallback: text('Claude answered.') })
  const counts = hostCounts(page)
  await openApp(page)
  await wsEval(page, (s, a) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', aiKeys: { openrouter: a.key }, ai: { models: a.rows, ...(a.member ? { allow: { openrouter: a.member } } : {}) } }), { key: OR_KEY, rows: SHORTLIST, member: o.member ?? null })
  await wsEval(page, (s, allow) => s.setWorkspaceAI({ policy: { providers: { openrouter: { allow } }, restricted: [] } }), o.allow)
  await seedEndpoints(page, ENDPOINTS)
  if (o.route !== null) await rules(page, 'setDeviceDefault', [o.route ?? MODEL])
  return { or, claude, counts }
}

/** The names and the transcript the fixture page holds — and must never reach a route without people / transcripts. */
const MIRA = 'Mira Kowalski'
const BRUNO = 'Bruno Ferreira'
const SPOKEN = 'the budget is forty thousand'

/** A page with every local name source: a person mention, an assigned task, a meeting transcript. */
async function namesPage(page: Page, title = 'Launch notes'): Promise<{ id: string; mira: string; bruno: string }> {
  const { mira, bruno } = await wsEval(page, (s, n) => ({ mira: s.addPerson(n.mira) as string, bruno: s.addPerson(n.bruno) as string }), { mira: MIRA, bruno: BRUNO })
  const mention = (id: string, label: string): JSONContent => ({ type: 'mention', attrs: { id, label, kind: 'person' } })
  const content = doc(
    para('Intro line stays.'),
    { type: 'paragraph', content: [mention(mira, MIRA), { type: 'text', text: ' owns the launch.' }] },
    para('our launch sentence is kinda loose'),
    { type: 'workItem', attrs: { itemId: 'wi_policy0001', status: 'todo', people: [bruno] }, content: [para('Book the venue')] },
    { type: 'meetingNotes', attrs: { id: 'mtg-policy-1', title: 'Weekly', status: 'done', language: 'en-US', startedAt: 1760252400000, endedAt: 1760256000000, duration: 3_600_000, transcript: [{ t: 0, text: `Quentin says ${SPOKEN}` }] }, content: [para('Notes stay')] },
    para('Closing line.'),
  )
  const id = await createPage(page, { title, content })
  return { id, mira, bruno }
}

/** Select a line on a page and run "Improve writing" (`answer`: wait for it; null: do not). */
async function improveOn(page: Page, id: string, line: string, answer: string | null = 'A tighter launch sentence.') {
  await gotoPage(page, id)
  const ed = editorOf(page, id)
  await ed.locator('p', { hasText: line }).first().click()
  await selectText(page, ed, line)
  await page.locator('[aria-label="Formatting"]').first().getByRole('button', { name: /^Ask AI$/ }).click()
  await expect(aiPanel(page)).toBeVisible()
  await aiPanel(page).getByRole('option', { name: /Improve writing/ }).click()
  if (answer) await expect(aiPanel(page)).toContainText(answer)
}

const bodyOf = (b: AnyState | null | undefined): string => JSON.stringify(b ?? null)

/** Close ⌘K (in ask mode the first Esc goes back to search). */
async function closePalette(page: Page) {
  const pal = page.getByRole('dialog', { name: 'Command palette' })
  await expect(async () => {
    if (await pal.count()) await page.keyboard.press('Escape')
    await expect(pal).toHaveCount(0, { timeout: 500 })
  }).toPass({ timeout: 5000 })
}

test.describe('the rules: generation stamps', () => {
  test('a Claude narrow stamps generation 2; an OpenRouter-only rule and a Jev Router rule leave it absent (acceptance 9, stamp part)', async ({ page }) => {
    await openApp(page)
    const ws = () => wsEval(page, (s) => JSON.parse(JSON.stringify(s.ai ?? null)))
    const dev = () => wsEval(page, (s) => JSON.parse(JSON.stringify(s.settings.ai ?? null)))
    // an OpenRouter allow list limits nothing Claude may receive: no generation
    expect(await rules(page, 'setWorkspaceAI', { policy: { providers: { openrouter: { allow: WORK } }, restricted: [] } })).toEqual({ ok: true })
    expect((await ws()).gen).toBeUndefined()
    expect((await ws()).policy.providers.openrouter.allow).toEqual(WORK)
    // Claude's own allow list without people: generation 2 (an older tab must refuse)
    await rules(page, 'setWorkspaceAI', { policy: { providers: { openrouter: { allow: WORK }, anthropic: { allow: WORK } }, restricted: [] } })
    expect((await ws()).gen).toBe(2)
    expect(await page.evaluate(() => (window as unknown as { __oneAI: { policyKnownAt(g: number): boolean } }).__oneAI.policyKnownAt(1))).toBe(false)
    expect(await page.evaluate(() => (window as unknown as { __oneAI: { policyKnownAt(g: number): boolean } }).__oneAI.policyKnownAt(2))).toBe(true)
    // Claude's entry back to everything: the stamp goes
    await rules(page, 'setWorkspaceAI', { policy: { providers: { openrouter: { allow: WORK } }, restricted: [] } })
    expect((await ws()).gen).toBeUndefined()
    // the device: a rule pinning the Jev Router changes nothing; a Claude narrow stamps 2
    await wsEval(page, (s, rows) => s.updateSettings({ aiKeys: { openrouter: 'sk-or-v1-x' }, ai: { models: rows } }), SHORTLIST)
    expect(await rules(page, 'setDeviceRule', 'bulk', [{ p: 'openrouter', m: 'typesafe/jev-router', effort: 'low' }])).toBe(true)
    expect((await dev()).routes.bulk).toEqual([{ p: 'openrouter', m: 'typesafe/jev-router', effort: 'low' }])
    expect((await dev()).gen).toBeUndefined()
    await rules(page, 'setDeviceAI', { narrow: { anthropic: ['people'] } })
    expect((await dev()).gen).toBe(2)
    expect(await page.evaluate(() => (window as unknown as { __oneAI: { policyKnownAt(g: number): boolean } }).__oneAI.policyKnownAt(1))).toBe(false)
    await rules(page, 'setDeviceAI', { narrow: undefined })
    expect((await dev()).gen).toBeUndefined()
    // a workspace allow list never holds a member class (they are the member's own, on the device)
    await rules(page, 'setWorkspaceAI', { policy: { providers: { openrouter: { allow: [...WORK, 'mail', 'private'] } }, restricted: [] } })
    expect((await ws()).policy.providers.openrouter.allow).toEqual(WORK)
  })
})

test.describe('a class the route may not receive: nothing is sent', () => {
  /** A Mails database (this device's) with one row whose body holds the line. */
  async function mailRow(page: Page): Promise<string> {
    return wsEval(page, (s) => {
      const db = s.createDatabase({ title: 'Mails' })
      s.updateSettings({ mail: { ...(s.settings.mail ?? {}), databaseId: db } })
      return s.createRow(db, { title: 'Quarterly numbers', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Row text stays home.' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'our launch sentence is kinda loose' }] }] } }) as string
    })
  }

  test('a selection in a Mails row, on "Selection only": POLICY, zero chat POSTs; with mail allowed on this device: one POST with the selection only (the note says so) (acceptance 4)', async ({ page, errors }) => {
    errors.allow(/policy/i)
    const { or, counts } = await setup(page, { allow: MARKED })
    const rowId = await mailRow(page)
    await improveOn(page, rowId, 'our launch sentence is kinda loose', null)
    await expect(aiPanel(page).locator('.ai-error')).toContainText('ERR · POLICY')
    await page.waitForTimeout(300)
    expect(or.posts()).toHaveLength(0)
    expect(counts.anthropic).toBe(0)
    // the gate's decision, with its fix (step 04, the class)
    const said = await gateSays(page, { purpose: 'menu.action', sources: [{ page: rowId, as: 'selection' }] })
    expect(said).toMatchObject({ ok: false, code: 'policy', detail: 'mail', fix: { kind: 'step', step: 'data', provider: 'openrouter', data: 'mail' } })
    // this device allows mail for OpenRouter: the selection goes — and nothing of the row's page text
    await wsEval(page, (s) => s.updateSettings({ ai: { ...s.settings.ai, allow: { openrouter: ['mail'] } } }))
    await page.keyboard.press('Escape')
    await improveOn(page, rowId, 'our launch sentence is kinda loose')
    expect(or.posts()).toHaveLength(1)
    const sent = bodyOf(or.posts()[0].body)
    expect(sent).toContain('our launch sentence is kinda loose')
    expect(sent).not.toContain('Row text stays home.')
    await expect(aiPanel(page).getByTestId('ai-run-notes')).toContainText('Selection only — page text not allowed for this model.')
  })

  test('positive control: on "Work data" the row page text goes along; a workspace allow alone never opens mail', async ({ page }) => {
    const { or } = await setup(page, { allow: WORK, member: ['mail'] })
    const rowId = await mailRow(page)
    await improveOn(page, rowId, 'our launch sentence is kinda loose')
    expect(or.posts()).toHaveLength(1)
    expect(bodyOf(or.posts()[0].body)).toContain('Row text stays home.')
    // the workspace's list cannot hold mail: without this device's opt-in the row is refused again
    await wsEval(page, (s) => s.updateSettings({ ai: { ...s.settings.ai, allow: undefined } }))
    await rules(page, 'setWorkspaceAI', { policy: { providers: { openrouter: { allow: [...WORK, 'mail'] } }, restricted: [] } })
    expect(await gateSays(page, { purpose: 'menu.action', sources: [{ page: rowId, as: 'selection' }] })).toMatchObject({ ok: false, code: 'policy', detail: 'mail' })
  })

  test('a memory row and the mail organiser: refused before any request, the fix names the class (acceptance 4, 5 first part)', async ({ page }) => {
    const { or, counts } = await setup(page, { allow: ALL })
    const memRow = await wsEval(page, (s) => {
      const db = s.createDatabase({ title: 'One memory' })
      ;(window as unknown as { __one: { workspace: { setState(fn: (s: AnyState) => void): void } } }).__one.workspace.setState((st: AnyState) => {
        st.databases[db].system = 'memory'
      })
      return s.createRow(db, { title: 'Reports are written in German.' }) as string
    })
    expect(await gateSays(page, { purpose: 'menu.action', sources: [{ page: memRow, as: 'selection' }] })).toMatchObject({ ok: false, code: 'policy', detail: 'memory', fix: { kind: 'step', step: 'data', data: 'memory' } })
    // the mail organiser's request: the Mails database as its source — refused with the step-04 fix
    const db = await wsEval(page, (s) => {
      const id = s.createDatabase({ title: 'Mails' })
      s.updateSettings({ mail: { ...(s.settings.mail ?? {}), databaseId: id } })
      return id as string
    })
    expect(await gateSays(page, { purpose: 'bulk.mail', sources: [{ db }] })).toMatchObject({ ok: false, code: 'policy', detail: 'mail', fix: { kind: 'step', step: 'data', provider: 'openrouter', data: 'mail' } })
    // positive control: allowed on this device → the same request may go to OpenRouter
    await wsEval(page, (s) => s.updateSettings({ ai: { ...s.settings.ai, allow: { openrouter: ['mail', 'memory'] } } }))
    expect(await gateSays(page, { purpose: 'bulk.mail', sources: [{ db }] })).toMatchObject({ ok: true, route: `openrouter:${LUNA}` })
    expect(await gateSays(page, { purpose: 'menu.action', sources: [{ page: memRow, as: 'selection' }] })).toMatchObject({ ok: true, route: `openrouter:${LUNA}` })
    expect(or.posts()).toHaveLength(0)
    expect(counts.anthropic).toBe(0)
  })
})

test.describe('names and transcripts (acceptance 6)', () => {
  test('a route without people / transcripts: Improve and ⌘K "?" send the page with "@Person n", no transcript; Make tasks and the meeting summary are refused', async ({ page, errors }) => {
    errors.allow(/policy/i)
    await noSpeech(page)
    const { or } = await setup(page, { allow: WORK, chat: [{ text: 'A tighter launch sentence.' }, { text: 'The plan is to launch in two steps.' }] })
    const { id } = await namesPage(page)
    // Improve (whole page as context)
    await improveOn(page, id, 'our launch sentence is kinda loose')
    expect(or.posts()).toHaveLength(1)
    const improve = bodyOf(or.posts()[0].body)
    expect(improve).toContain('Intro line stays.')
    expect(improve).toContain('@Person 1')
    for (const secret of [MIRA, BRUNO, SPOKEN, 'Quentin']) expect(improve, secret).not.toContain(secret)
    await page.keyboard.press('Escape')
    // ⌘K "?" (opened from the sidebar: ⌘K in the editor with text selected adds a link)
    await page.getByRole('button', { name: /^Search/ }).click()
    await page.keyboard.type('?what is the plan')
    const pal = page.getByRole('dialog', { name: 'Command palette' })
    await expect(pal.locator('.pal-mode')).toHaveText('ASK')
    await page.keyboard.press('Enter')
    await expect(pal).toContainText('The plan is to launch in two steps.')
    expect(or.posts()).toHaveLength(2)
    const asked = bodyOf(or.posts()[1].body)
    expect(asked).toContain('Intro line stays.')
    for (const secret of [MIRA, BRUNO, SPOKEN]) expect(asked, secret).not.toContain(secret)
    await closePalette(page)
    // Make tasks needs people: refused, nothing sent
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p', { hasText: 'Closing line.' }).click()
    await selectText(page, ed, 'Closing line.')
    await page.locator('[aria-label="Formatting"]').first().getByRole('button', { name: /^Ask AI$/ }).click()
    await aiPanel(page).locator('.ai-cmd__input').fill('Make tasks')
    await aiPanel(page).getByRole('option', { name: /^Make tasks/ }).first().click()
    await expect(aiPanel(page)).toContainText(/POLICY/)
    await page.waitForTimeout(300)
    expect(or.posts()).toHaveLength(2)
    await page.keyboard.press('Escape')
    // the meeting summary needs the transcript: refused, nothing sent
    expect(await gateSays(page, { purpose: 'meeting.summary', sources: [{ page: id }] })).toMatchObject({ ok: false, code: 'policy', detail: 'transcript' })
    expect(await gateSays(page, { purpose: 'menu.tasks', sources: [{ page: id, as: 'selection' }] })).toMatchObject({ ok: false, code: 'policy', detail: 'people' })
    expect(or.posts()).toHaveLength(2)
  })

  test('autofill on a row whose Owner is a person: the request names "@Person 1", never the name', async ({ page }) => {
    const { or } = await setup(page, { allow: WORK, chat: [{ text: JSON.stringify({ value: 'High' }) }] })
    const mira = await wsEval(page, (s, name) => s.addPerson(name) as string, MIRA)
    await wsEval(
      page,
      (s, mira) => {
        const db = (Object.values(s.databases) as AnyState[]).find((d) => s.pages[d.id]?.title === 'Projects')!
        const owner = db.properties.find((p: AnyState) => p.type === 'person')
        for (const r of Object.values(s.pages) as AnyState[]) if (r.databaseId === db.id && !r.trashed) s.setRowProperty(r.id, owner.id, [mira])
      },
      mira,
    )
    await autofillPriority(page)
    expect(or.posts()).toHaveLength(1)
    const sent = bodyOf(or.posts()[0].body)
    expect(sent).toContain('@Person 1')
    expect(sent).not.toContain(MIRA)
  })

  test('positive control: a route allowed people and transcripts receives the names and the spoken words', async ({ page }) => {
    const { or } = await setup(page, { allow: ALL })
    const { id } = await namesPage(page)
    await improveOn(page, id, 'our launch sentence is kinda loose')
    const sent = bodyOf(or.posts()[0].body)
    expect(sent).toContain(MIRA)
    expect(sent).toContain(SPOKEN)
    expect(sent).not.toContain('@Person 1')
  })
})

test.describe('the One memory (D-S2-29)', () => {
  async function withMemory(page: Page) {
    await uiEval(page, (u) => u.openModal({ type: 'settings', tab: 'ai' }))
    const section = page.getByTestId('memory-settings')
    await section.scrollIntoViewIfNeeded()
    await section.getByRole('button', { name: 'Set up memory' }).click()
    await expect(section).toContainText('0 memories · 0 log entries')
    await page.keyboard.press('Escape')
    await wsEval(page, (s) => {
      const db = (Object.values(s.databases) as AnyState[]).find((d) => d.system === 'memory')!
      const prop = (name: string) => db.properties.find((p: AnyState) => p.name === name)
      const type = prop('Type').options.find((o: AnyState) => o.name.toLowerCase() === 'preference').id
      s.createRow(db.id, { title: 'Launch answers stay under eighty words.', properties: { [prop('Type').id]: type, [prop('Active').id]: true } })
    })
    await flush(page)
  }
  const logCount = (page: Page) => wsEval(page, (s) => {
    const db = (Object.values(s.databases) as AnyState[]).find((d) => d.system === 'memory-log')
    return db ? (Object.values(s.pages) as AnyState[]).filter((r) => r.databaseId === db.id && !r.trashed).length : 0
  })

  async function ask(page: Page, id: string, answer: string) {
    await gotoPage(page, id)
    await page.getByRole('button', { name: /^Search/ }).click()
    await page.keyboard.type('?how long are launch answers')
    const pal = page.getByRole('dialog', { name: 'Command palette' })
    await page.keyboard.press('Enter')
    await expect(pal).toContainText(answer)
    return pal
  }

  test('not allowed for the route: one request without <one_memory>, the note, no log row; allowed: the block goes and one row is logged', async ({ page }) => {
    const { or } = await setup(page, { allow: WORK, chat: [{ text: 'Short answers.' }, { text: 'Short answers again.' }] })
    await withMemory(page)
    const id = await createPage(page, { title: 'Plan', content: doc(para('We launch soon.')) })
    const pal = await ask(page, id, 'Short answers.')
    expect(or.posts()).toHaveLength(1)
    expect(bodyOf(or.posts()[0].body)).not.toContain('<one_memory>')
    await expect(pal.getByTestId('ask-notes')).toContainText('Memory not sent (data rule).')
    expect(await logCount(page)).toBe(0)
    await closePalette(page)
    // this device lets OpenRouter receive the memory
    await wsEval(page, (s) => s.updateSettings({ ai: { ...s.settings.ai, allow: { openrouter: ['memory'] } } }))
    await ask(page, id, 'Short answers again.')
    expect(or.posts()).toHaveLength(2)
    expect(bodyOf(or.posts()[1].body)).toContain('<one_memory>')
    await expect.poll(() => logCount(page)).toBe(1)
  })
})

test.describe('MCP servers on a route that cannot connect them (acceptance 7)', () => {
  const ARCHIVE = { id: 'srvpolicy01', name: 'archive', codeword: 'kb', url: 'https://mcp.example.test/api/archive/mcp', token: 'archive-e2e-PLAINTEXT-token-7Hq0003', enabled: true, prompt: '**Archive** is the team knowledge base.', promptSource: 'auto', tools: ['archive_search'], checkedAt: 1 }

  async function ownRequestOn(page: Page, request: string) {
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
    await ask.fill(request)
    await page.keyboard.press('Enter')
  }

  test('a codeword on OpenRouter: refused before sending; "Ask Claude" sends exactly one Claude request with the server', async ({ page, errors }) => {
    errors.allow(/capability|server/i)
    const { or, claude } = await setup(page, { allow: ALL, member: ['mcp'], claude: [text('Archive says the launch is on the 18th.')] })
    await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), [ARCHIVE])
    await ownRequestOn(page, 'kb: when is the launch?')
    await expect(aiPanel(page).locator('.ai-error')).toContainText('kb: OpenRouter connects no MCP servers. Nothing was sent.')
    await page.waitForTimeout(300)
    expect(or.posts()).toHaveLength(0)
    expect(claude.requests).toHaveLength(0)
    await aiPanel(page).getByTestId('ai-ask-claude').click()
    await expect(aiPanel(page)).toContainText('Archive says the launch is on the 18th.')
    expect(claude.requests).toHaveLength(1)
    expect(claude.requests[0].body.mcp_servers?.[0]?.name).toBe('archive')
    expect(or.posts()).toHaveLength(0)
  })

  test('a free-form request on OpenRouter: each free server skipped (provider), the body holds no MCP, tools, routing or user fields; on Claude it carries mcp_servers', async ({ page }) => {
    const { or, claude } = await setup(page, { allow: ALL, member: ['mcp'], chat: [{ text: 'Plan drafted.' }], claude: [text('Plan drafted by Claude.')] })
    await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), [ARCHIVE])
    await ownRequestOn(page, 'Draft the launch plan')
    await expect(aiPanel(page)).toContainText('Plan drafted.')
    expect(or.posts()).toHaveLength(1)
    const b = or.posts()[0].body!
    for (const k of ['mcp_servers', 'models', 'fallbacks', 'web_search_options', 'user', 'session_id', 'tools']) expect(k in b, k).toBe(false)
    expect(bodyOf(b)).not.toContain(ARCHIVE.token)
    await expect(aiPanel(page)).toContainText(/archive/i)
    await page.keyboard.press('Escape')
    // positive control: the same request on Claude carries the server
    await rules(page, 'setDeviceDefault', null)
    await ownRequestOn(page, 'Draft the launch plan')
    await expect(aiPanel(page)).toContainText('Plan drafted by Claude.')
    expect(claude.requests).toHaveLength(1)
    expect(claude.requests[0].body.mcp_servers?.[0]?.name).toBe('archive')
  })
})

test.describe('a backup that would loosen the AI rules (acceptance 10)', () => {
  /** The sidebar's Import → a backup file → Merge: stops at the loosening panel when there is one. */
  async function mergeFile(page: Page, file: string) {
    await page.locator('.sb').getByRole('button', { name: /^Import/ }).click()
    const dialog = page.getByRole('dialog')
    const chooser = page.waitForEvent('filechooser')
    await dialog.getByRole('button', { name: 'Choose files' }).click()
    await (await chooser).setFiles([{ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(readFileSync(file)) }])
    await dialog.getByRole('radio', { name: /Merge into this workspace/ }).click()
    await dialog.getByRole('button', { name: 'Merge backup' }).click()
    return dialog
  }
  const rulesNow = (page: Page) => wsEval(page, (s) => JSON.parse(JSON.stringify(s.ai?.policy?.providers?.openrouter ?? null)))

  test('the diff is listed; Keep mine changes nothing; Take applies the backup\'s; a tighter backup is taken without asking', async ({ page }, testInfo) => {
    await openApp(page)
    await rules(page, 'setWorkspaceAI', { policy: { providers: { openrouter: { allow: MARKED, forbid: ['mail'] } }, restricted: [] } })
    const { json } = await exportBackup(page, testInfo, 'mine.json')
    // a backup whose rules open more: page text for OpenRouter, mail no longer forbidden
    const loose = JSON.parse(JSON.stringify(json))
    loose.workspace.ai = { policy: { providers: { openrouter: { allow: [...MARKED, 'page'] } }, restricted: [] } }
    const looseFile = testInfo.outputPath('loose.json')
    writeFileSync(looseFile, JSON.stringify(loose))
    let dialog = await mergeFile(page, looseFile)
    const panel = dialog.getByTestId('backup-ai-loosen')
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('The backup would loosen the AI rules')
    await expect(panel).toContainText('OpenRouter may receive Page text')
    await expect(panel).toContainText('OpenRouter: “Mail” no longer forbidden')
    await panel.getByRole('button', { name: 'Keep mine' }).click()
    await expect(dialog.getByText(/Backup merged/).first()).toBeVisible()
    await page.keyboard.press('Escape')
    expect(await rulesNow(page)).toEqual({ allow: MARKED, forbid: ['mail'] })
    // again: Take the backup's
    dialog = await mergeFile(page, looseFile)
    await dialog.getByTestId('backup-ai-loosen').getByRole('button', { name: 'Take the backup’s' }).click()
    await expect(dialog.getByText(/Backup merged/).first()).toBeVisible()
    await page.keyboard.press('Escape')
    expect(await rulesNow(page)).toEqual({ allow: [...MARKED, 'page'] })
    // a backup that only tightens: taken without a question
    const tight = JSON.parse(JSON.stringify(json))
    tight.workspace.ai = { policy: { providers: { openrouter: { allow: ['public'], forbid: ['mail', 'memory'] } }, restricted: [] } }
    const tightFile = testInfo.outputPath('tight.json')
    writeFileSync(tightFile, JSON.stringify(tight))
    dialog = await mergeFile(page, tightFile)
    await expect(dialog.getByText(/Backup merged/).first()).toBeVisible()
    await expect(dialog.getByTestId('backup-ai-loosen')).toHaveCount(0)
    await page.keyboard.press('Escape')
    expect(await rulesNow(page)).toEqual({ allow: ['public'], forbid: ['mail', 'memory'] })
  })
})
