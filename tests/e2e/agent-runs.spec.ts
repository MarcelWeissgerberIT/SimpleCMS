/**
 * Custom agents — what a run leaves besides its proposals, and how it reads (features/agents: exec.ts, review.ts,
 * format.ts / lib/money.ts):
 *  - a run whose proposals wait for review keeps the agent state it replaced: "Discard all" (none applied) puts that
 *    state back — only while the saved state is still that run's; a run applied (or partly applied) keeps its state
 *  - the toast "Agent · X has 1 proposal — Review" stays away while X's own page is open (it shows the run already);
 *    other agents' toasts still come
 *  - money in the UI's language: "$0.50" in English, "0,50 $" in German (agent page, list, runs, editor, budget errors,
 *    the mirror setup's spec plate)
 * A mocked Claude API only — never api.anthropic.com; the MCP server is a fictional address that nothing calls.
 */
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect, openApp, wsEval, flush } from './fixtures'
import { addProfile, trackerProfile, unlockAll } from './helpers/integrations'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }

let msgSeq = 0

/** One streamed assistant message in the Messages API SSE shape. */
function sseMessage(blocks: Block[], usage = { input: 1200, output: 80 }): string {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  const stop = blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'
  let body = ev('message_start', {
    message: { id: `msg_runs_${++msgSeq}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: usage.input, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  })
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      body += ev('content_block_start', { index, content_block: { type: 'text', text: '' } })
      body += ev('content_block_delta', { index, delta: { type: 'text_delta', text: b.text } })
    } else {
      body += ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } })
      body += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } })
    }
    body += ev('content_block_stop', { index })
  })
  body += ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: usage.output } })
  body += ev('message_stop', {})
  return body
}

type Step = (body: AnyState) => string
const tool = (id: string, name: string, input: Record<string, unknown>): Block => ({ type: 'tool_use', id, name, input })
const say = (text: string): Block => ({ type: 'text', text })

/** api.anthropic.com → request n gets script[n]; later requests a short report. Returns the request bodies. */
async function mockClaude(ctx: BrowserContext, script: Step[] = []): Promise<AnyState[]> {
  const bodies: AnyState[] = []
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (req.method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [], has_more: false }) })
    const body = JSON.parse(req.postData() ?? '{}')
    bodies.push(body)
    const step = script[bodies.length - 1] ?? (() => sseMessage([say('Done.')]))
    try {
      await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: step(body) })
    } catch {
      /* aborted (budget stop) */
    }
  })
  return bodies
}

const setKey = (page: Page) => wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))

/** An agent through the store (defaults: manual, browser, enabled). */
async function addAgent(page: Page, agent: AnyState): Promise<string> {
  await wsEval(
    page,
    (s, a) => {
      const now = Date.now()
      s.upsertAgent({ instructions: 'Keep the items in step.', trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: 'stage', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: true, createdAt: now, updatedAt: now, ...a })
    },
    agent,
  )
  await flush(page)
  return agent.id as string
}

const goAgent = async (page: Page, id: string) => {
  await page.evaluate((id) => (window.location.hash = `#/agents/${id}`), id)
  await expect(page.locator('.agx-dhead')).toBeVisible()
}

/** The agent's saved state on this device (IndexedDB "one-agents", key state:<ws>:<agentId>), or null. */
async function stateOf(page: Page, agentId: string): Promise<AnyState | null> {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('one-agents')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    try {
      if (!db.objectStoreNames.contains('runs')) return null
      const store = db.transaction('runs').objectStore('runs')
      const keys = await new Promise<IDBValidKey[]>((res, rej) => {
        const q = store.getAllKeys()
        q.onsuccess = () => res(q.result)
        q.onerror = () => rej(q.error)
      })
      const key = keys.find((k) => typeof k === 'string' && k.startsWith('state:') && k.endsWith(`:${id}`))
      if (!key) return null
      return await new Promise<AnyState | null>((res, rej) => {
        const q = db.transaction('runs').objectStore('runs').get(key)
        q.onsuccess = () => res(q.result ?? null)
        q.onerror = () => rej(q.error)
      })
    } finally {
      db.close()
    }
  }, agentId)
}
const stateJson = async (page: Page, id: string) => (await stateOf(page, id))?.json ?? null

/** A database "Items" with a text property "Key" (the upsert key). */
const itemsDb = (page: Page) =>
  wsEval(page, (s) => {
    const db = s.createDatabase({ title: 'Items' }) as string
    s.addProperty(db, { type: 'text', name: 'Key' })
    return db
  })

const upsert = (id: string, db: string, keys: string[]) => tool(id, 'upsert_rows', { database_id: db, key_property: 'Key', rows: keys.map((k) => ({ key: k, title: `Item ${k}`, properties: {} })) })
const setState = (id: string, comments: number) => tool(id, 'agent_state_set', { json: JSON.stringify({ comments: { '#1': comments } }) })
const runNow = async (page: Page, status: string, n: number) => {
  await page.getByRole('button', { name: 'Run now' }).click()
  await expect(page.locator('.agx-run')).toHaveCount(n, { timeout: 20_000 })
  await expect(page.locator('.agx-run').first()).toHaveAttribute('data-status', status, { timeout: 20_000 })
}

test.describe('Custom agents: a staged run’s agent state', () => {
  test('“Discard all” puts back the state the run replaced; an applied or partly applied run keeps its state; a later state is never overwritten', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    await unlockAll(page)
    const db = await itemsDb(page)
    await mockClaude(context, [
      // run 1 (read only): the first state
      () => sseMessage([setState('a1', 1)]),
      () => sseMessage([say('First look.')]),
      // run 2 (proposals): one row + a new state → Discard all
      () => sseMessage([upsert('b1', db, ['1']), setState('b2', 2)]),
      () => sseMessage([say('1 new item.')]),
      // run 3 (proposals): Apply all → its state stays
      () => sseMessage([upsert('c1', db, ['1']), setState('c2', 3)]),
      () => sseMessage([say('1 new item.')]),
      // run 4 (proposals): two rows, one applied, one discarded → its state stays
      () => sseMessage([upsert('d1', db, ['2', '3']), setState('d2', 4)]),
      () => sseMessage([say('2 new items.')]),
      // run 5 (proposals) then run 6 (read only) saves a newer state: discarding run 5 leaves run 6's state
      () => sseMessage([upsert('e1', db, ['4']), setState('e2', 5)]),
      () => sseMessage([say('1 new item.')]),
      () => sseMessage([setState('f1', 6)]),
      () => sseMessage([say('Looked again.')]),
    ])
    const id = await addAgent(page, { id: 'ag-mirror', name: 'Item mirror', write: 'none' })
    await goAgent(page, id)

    await runNow(page, 'ok', 1)
    await expect.poll(() => stateJson(page, id)).toBe('{"comments":{"#1":1}}')
    const first = await stateOf(page, id)

    // ---- proposals, then Discard all: the state is the one from before the run again
    await wsEval(page, (s, id) => s.upsertAgent({ ...s.agents[id], write: 'stage' }), id)
    await flush(page)
    await runNow(page, 'staged', 2)
    let run = page.locator('.agx-run').first()
    await expect.poll(() => stateJson(page, id)).toBe('{"comments":{"#1":2}}')
    await run.getByRole('button', { name: 'Discard all' }).click()
    await expect.poll(() => stateOf(page, id)).toEqual(first)
    await expect(run.locator('.agx-step').last()).toHaveText('Every proposal discarded: the state is back to the one from before this run')
    expect(await wsEval(page, (s, db) => (Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId === db && !p.trashed).length, db)).toBe(0)

    // ---- proposals, Apply all: the new state stays
    await runNow(page, 'staged', 3)
    run = page.locator('.agx-run').first()
    await run.getByRole('button', { name: 'Apply all' }).click()
    await expect.poll(() => wsEval(page, (s, db) => (Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId === db && !p.trashed).length, db)).toBe(1)
    expect(await stateJson(page, id)).toBe('{"comments":{"#1":3}}')

    // ---- two proposals: one applied, the other discarded — partly applied, the state stays
    await runNow(page, 'staged', 4)
    run = page.locator('.agx-run').first()
    await run.getByRole('button', { name: 'Apply #1' }).click()
    await expect.poll(() => wsEval(page, (s, db) => (Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId === db && !p.trashed).length, db)).toBe(2)
    await run.getByRole('button', { name: 'Discard #2' }).click()
    await expect(run.locator('.agent-change[data-status="discarded"]')).toHaveCount(1)
    await page.waitForTimeout(300)
    expect(await stateJson(page, id)).toBe('{"comments":{"#1":4}}')

    // ---- run 5 waits for review, run 6 saves a newer state: discarding run 5 never touches it
    await runNow(page, 'staged', 5)
    await expect.poll(() => stateJson(page, id)).toBe('{"comments":{"#1":5}}')
    await wsEval(page, (s, id) => s.upsertAgent({ ...s.agents[id], write: 'none' }), id)
    await flush(page)
    await runNow(page, 'ok', 6)
    await expect.poll(() => stateJson(page, id)).toBe('{"comments":{"#1":6}}')
    const older = page.locator('.agx-run').nth(1)
    await expect(older).toHaveAttribute('data-status', 'staged')
    await older.getByRole('button', { name: 'Discard all' }).click()
    await expect(older.locator('.agent-change[data-status="discarded"]')).toHaveCount(1)
    await page.waitForTimeout(300)
    expect(await stateJson(page, id)).toBe('{"comments":{"#1":6}}')
  })
})

test.describe('Custom agents: the “has proposals” toast', () => {
  test('stays away while the agent’s own page is open; from the list, and for another agent, it comes', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    await unlockAll(page)
    const db = await itemsDb(page)
    await mockClaude(context, [
      // run 1: on its own page
      () => sseMessage([upsert('a1', db, ['1'])]),
      () => sseMessage([say('1 new item.')]),
      // run 2: started from the list
      () => sseMessage([upsert('b1', db, ['2'])]),
      () => sseMessage([say('1 new item.')]),
      // run 3: another agent (a new row starts it) while the first agent's page is open
      () => sseMessage([upsert('c1', db, ['3'])]),
      () => sseMessage([say('1 new item.')]),
    ])
    const id = await addAgent(page, { id: 'ag-one', name: 'Mirror one' })
    await addAgent(page, { id: 'ag-two', name: 'Mirror two', trigger: { type: 'row_created', databaseId: db }, scope: { everything: false, pages: [], databases: [db] } })
    const toastOf = (name: string) => page.locator('.toast').filter({ hasText: `Agent · ${name} has 1 proposal` })

    await goAgent(page, id)
    await runNow(page, 'staged', 1)
    // (counted once, not waited for: a toast goes by itself after 10 s)
    await page.waitForTimeout(800)
    expect(await toastOf('Mirror one').count()).toBe(0)
    await expect(page.locator('.agx-run').first().getByRole('button', { name: 'Apply all' })).toBeVisible()

    // from the list: the toast with its Review key
    await page.evaluate(() => (window.location.hash = '#/agents'))
    await page.locator('.agx-card').filter({ hasText: 'Mirror one' }).getByRole('button', { name: 'Run Mirror one now' }).click()
    await expect(toastOf('Mirror one')).toBeVisible({ timeout: 20_000 })
    await expect(toastOf('Mirror one').getByRole('button', { name: 'Review' })).toBeVisible()

    // another agent's proposals while "Mirror one" is open: that toast comes
    await goAgent(page, id)
    await wsEval(page, (s, db) => s.createRow(db, { title: 'Item new' }), db)
    await expect(toastOf('Mirror two')).toBeVisible({ timeout: 30_000 })
  })
})

test.describe('Custom agents: money in the UI’s language', () => {
  test('German: “0,50 $” on the agent page, the list, the runs, the editor’s field and its error, a budget stop and the mirror setup; English keeps “$0.50”', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    await mockClaude(context, [
      () => sseMessage([say('Nothing new.')], { input: 2000, output: 100 }),
      // 200k input tokens on Opus ≈ $0.80 > $0.10
      () => sseMessage([tool('t1', 'list_databases', {})], { input: 200_000, output: 50 }),
      () => sseMessage([say('never reached')]),
    ])
    const id = await addAgent(page, { id: 'ag-money', name: 'Kassenwart', write: 'none' })
    await goAgent(page, id)
    const plate = page.locator('.agx-spec--plate')
    await expect(plate).toContainText('$0.50 per run')

    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await expect(plate).toContainText('0,50 $ pro Lauf')
    await page.getByRole('button', { name: 'Jetzt ausführen' }).click()
    const run = page.locator('.agx-run').first()
    await expect(run).toHaveAttribute('data-status', 'ok', { timeout: 20_000 })
    await expect(run.getByTestId('agx-run-usd')).toHaveText(/^(< )?0,\d\d\s\$$/)
    await expect(run.locator('.agx-run__usage')).toContainText(/≈ (< )?0,\d\d\s\$$/)

    // the list: the cost of the last runs
    await page.evaluate(() => (window.location.hash = '#/agents'))
    await expect(page.locator('.agx-card').filter({ hasText: 'Kassenwart' }).locator('.agx-spec')).toContainText(/(< )?0,\d\d\s\$ letzte 1/)

    // the editor: the sign after the amount, the error in German money
    await goAgent(page, id)
    await page.getByRole('button', { name: 'Bearbeiten' }).click()
    const editor = page.locator('.agx-editor')
    const money = editor.locator('.agx-money')
    await expect(money).toHaveAttribute('data-after', 'true')
    const [field, sign] = [await money.locator('input').boundingBox(), await money.locator('.agx-money__sign').boundingBox()]
    expect(sign!.x).toBeGreaterThan(field!.x)
    await money.locator('input').fill('80')
    await editor.getByRole('button', { name: 'Speichern' }).click()
    await expect(editor.locator('.agx-field__error')).toContainText('Gib einen Betrag zwischen 0,01 $ und 50,00 $ an.')
    await money.locator('input').fill('0.1')
    await editor.getByRole('button', { name: 'Speichern' }).click()
    await expect(editor).toHaveCount(0)

    // a budget stop says the budget in German money
    await page.getByRole('button', { name: 'Jetzt ausführen' }).click()
    await expect(page.locator('.agx-run').first()).toHaveAttribute('data-status', 'budget', { timeout: 20_000 })
    await expect(page.locator('.agx-run').first()).toContainText('Gestoppt: Das Budget von 0,10 $ für diesen Lauf ist aufgebraucht.')

    // the mirror setup's spec plate
    await wsEval(page, (s) => s.updateSettings({ mcpServers: [{ id: 'm-tracker', name: 'tracker', url: 'https://tracker.example.com/mcp', token: '', enabled: true, prompt: '', tools: ['list_items'], checkedAt: Date.now() }] }))
    await addProfile(page, trackerProfile({ match: { host: '*.example.com' } }))
    await page.evaluate(() => (window.location.hash = '#/agents'))
    await page.locator('.agx-head .btn--primary').click()
    await page.locator('.agx-recipe-modal [data-recipe="tracker:mirror"]').click()
    await expect(page.locator('.agx-mir').getByTestId('agx-mir-spec')).toContainText('1,00 $ pro Lauf')
  })
})
