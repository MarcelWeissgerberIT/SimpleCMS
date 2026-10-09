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
    await expect(run.locator('.agx-step').last()).toHaveText('Every proposal discarded: the state from before this run applies again.')
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

test.describe('Custom agents: discarding runs, the review, toasts on the agent’s page, money and numbers', () => {
  const rowsOf = (page: Page, db: string) => wsEval(page, (s, db) => (Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId === db && !p.trashed).length, db)
  /** Every toast message shown from now on (a toast that came and went counts too). Before openApp. */
  const recordToasts = (page: Page) =>
    page.addInitScript(() => {
      const w = window as unknown as { __toasts: string[] }
      w.__toasts = []
      const seen = new WeakSet<Element>()
      new MutationObserver(() => {
        for (const el of document.querySelectorAll('.toast__msg'))
          if (!seen.has(el)) {
            seen.add(el)
            w.__toasts.push(el.textContent ?? '')
          }
      }).observe(document, { childList: true, subtree: true, characterData: true })
    })
  const toastsSeen = (page: Page) => page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts)

  test('C10 on the agent’s own page none of its run toasts show (finished, failed); from the list they do, and another agent’s show on that page', async ({ page, context }) => {
    await recordToasts(page)
    await openApp(page)
    await setKey(page)
    const db = await itemsDb(page)
    const big = () => sseMessage([tool('t1', 'list_databases', {})], { input: 200_000, output: 50 })
    await mockClaude(context, [
      // 1: on its page, finished
      () => sseMessage([say('Nothing new.')]),
      // 2: on its page, over budget
      big,
      // 3: from the list, over budget
      big,
      // 4: another agent (a new row starts it) over budget while the first one's page is open
      big,
    ])
    const id = await addAgent(page, { id: 'ag-quiet', name: 'Watcher', write: 'none' })
    await addAgent(page, { id: 'ag-other', name: 'Row watcher', write: 'none', maxRunUsd: 0.01, trigger: { type: 'row_created', databaseId: db }, scope: { everything: false, pages: [], databases: [db] } })
    const toastOf = (text: string) => page.locator('.toast').filter({ hasText: text })
    await goAgent(page, id)
    await runNow(page, 'ok', 1)
    await wsEval(page, (s, id) => s.upsertAgent({ ...s.agents[id], maxRunUsd: 0.01 }), id)
    await flush(page)
    await runNow(page, 'budget', 2)
    // (the run is stored first, its toast comes after: wait, then look at every toast that was shown)
    await page.waitForTimeout(1500)
    expect((await toastsSeen(page)).filter((m) => m.startsWith('Watcher:'))).toEqual([])
    // from the list: the toast comes
    await page.evaluate(() => (window.location.hash = '#/agents'))
    await page.getByRole('button', { name: 'Run Watcher now' }).click()
    await expect(toastOf('Watcher: the run failed')).toBeVisible({ timeout: 20_000 })
    // another agent's toast while "Watcher" is open
    await goAgent(page, id)
    await wsEval(page, (s, db) => s.createRow(db, { title: 'Item new' }), db)
    await expect(toastOf('Row watcher: the run failed')).toBeVisible({ timeout: 30_000 })
  })

  /** Two runs waiting for review that each set a state, after a first run (read only) set #1:1. */
  async function twoWaiting(page: Page, context: BrowserContext, base: number) {
    const db = await itemsDb(page)
    await mockClaude(context, [
      () => sseMessage([setState('a1', 1)]),
      () => sseMessage([say('First look.')]),
      () => sseMessage([upsert('b1', db, ['1']), setState('b2', base)]),
      () => sseMessage([say('1 new item.')]),
      () => sseMessage([upsert('c1', db, ['2']), setState('c2', base + 1)]),
      () => sseMessage([say('1 new item.')]),
    ])
    return db
  }

  for (const order of ['older first', 'newer first'] as const) {
    test(`C11 two waiting runs discarded (${order}): the state from before both is back`, async ({ page, context }) => {
      await openApp(page)
      await setKey(page)
      await unlockAll(page)
      const db = await twoWaiting(page, context, 2)
      const id = await addAgent(page, { id: 'ag-two', name: 'Item mirror', write: 'none' })
      await goAgent(page, id)
      await runNow(page, 'ok', 1)
      await expect.poll(() => stateJson(page, id)).toBe('{"comments":{"#1":1}}')
      const first = await stateOf(page, id)
      await wsEval(page, (s, id) => s.upsertAgent({ ...s.agents[id], write: 'stage' }), id)
      await flush(page)
      await runNow(page, 'staged', 2)
      await expect.poll(() => stateJson(page, id)).toBe('{"comments":{"#1":2}}')
      await runNow(page, 'staged', 3)
      await expect.poll(() => stateJson(page, id)).toBe('{"comments":{"#1":3}}')
      // runs newest first: B (#1:3) on top, A (#1:2) below it
      const [b, a] = [page.locator('.agx-run').nth(0), page.locator('.agx-run').nth(1)]
      const steps = order === 'older first' ? [a, b] : [b, a]
      for (const run of steps) {
        await run.getByRole('button', { name: 'Discard all' }).click()
        await expect(run.locator('.agent-change[data-status="discarded"]')).toHaveCount(1)
      }
      await expect.poll(() => stateOf(page, id)).toEqual(first)
      expect(await rowsOf(page, db)).toBe(0)
    })
  }

  test('C11 an "apply" run undone and then discarded puts back the state it replaced, like a run of proposals', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    await unlockAll(page)
    const db = await itemsDb(page)
    await mockClaude(context, [
      () => sseMessage([setState('a1', 1)]),
      () => sseMessage([say('First look.')]),
      () => sseMessage([upsert('b1', db, ['1']), setState('b2', 2)]),
      () => sseMessage([say('1 new item.')]),
    ])
    const id = await addAgent(page, { id: 'ag-apply', name: 'Item mirror', write: 'none' })
    await goAgent(page, id)
    await runNow(page, 'ok', 1)
    await expect.poll(() => stateJson(page, id)).toBe('{"comments":{"#1":1}}')
    const first = await stateOf(page, id)
    await wsEval(page, (s, id) => s.upsertAgent({ ...s.agents[id], write: 'apply' }), id)
    await flush(page)
    await runNow(page, 'ok', 2)
    await expect.poll(() => rowsOf(page, db)).toBe(1)
    await expect.poll(() => stateJson(page, id)).toBe('{"comments":{"#1":2}}')
    const run = page.locator('.agx-run').first()
    await run.getByRole('button', { name: 'Undo changes' }).click()
    await expect.poll(() => rowsOf(page, db)).toBe(0)
    await run.getByRole('button', { name: 'Discard all' }).click()
    await expect.poll(() => stateOf(page, id)).toEqual(first)
    await expect(run.locator('.agx-step').last()).toHaveText('Every proposal discarded: the state from before this run applies again.')
  })

  test('C12 the review at 390 px in German: nothing runs off the edge; one proposal applied shows its result and Rückgängig in its row (no toast); focus moves on, never to the page; numbers and the restore note in German', async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openApp(page)
    await setKey(page)
    await unlockAll(page)
    const db = await itemsDb(page)
    await mockClaude(context, [
      () => sseMessage([upsert('a1', db, ['1', '2', '3']), setState('a2', 1)]),
      () => sseMessage([say('3 neue Einträge.')]),
      () => sseMessage([upsert('b1', db, ['4', '5'])]),
      () => sseMessage([say('2 neue Einträge.')]),
    ])
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const id = await addAgent(page, { id: 'ag-phone', name: 'Spiegel', write: 'stage' })
    await goAgent(page, id)
    await page.getByRole('button', { name: 'Jetzt ausführen' }).click()
    const run = page.locator('.agx-run').first()
    await expect(run).toHaveAttribute('data-status', 'staged', { timeout: 20_000 })
    await expect(run.locator('.agent-change')).toHaveCount(3)
    // nothing wider than the phone
    const wide = await page.evaluate(() => {
      const main = document.querySelector('#main') as HTMLElement
      const keys = [...document.querySelectorAll<HTMLElement>('.agx-review button, .agx-review .label')].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5).map((el) => el.textContent)
      return { main: main.scrollWidth - main.clientWidth, keys }
    })
    expect(wide).toEqual({ main: 0, keys: [] })
    // numbers in German
    await expect(run.getByTestId('agx-run-usage')).toContainText('IN 2.400')

    // one proposal: its result in its row, with Rückgängig there — no toast that could cover the next key
    await run.getByRole('button', { name: 'Übernehmen #1' }).click()
    await expect(run.locator('.agent-change').nth(0)).toHaveAttribute('data-status', 'applied')
    await expect.poll(() => rowsOf(page, db)).toBe(1)
    const undo1 = run.getByRole('button', { name: 'Rückgängig #1' })
    await expect(undo1).toBeVisible()
    await expect(undo1).toBeFocused()
    await page.waitForTimeout(300)
    await expect(page.locator('.toast')).toHaveCount(0)
    await undo1.click()
    await expect(run.locator('.agent-change').nth(0)).toHaveAttribute('data-status', 'pending')
    await expect.poll(() => rowsOf(page, db)).toBe(0)
    await expect(run.getByRole('button', { name: 'Verwerfen #1' })).toBeFocused()
    await expect(page.locator('.toast')).toHaveCount(0)

    // discarding one: focus on the next proposal's first key, the heading once none is left
    await run.getByRole('button', { name: 'Verwerfen #1' }).click()
    await expect(run.getByRole('button', { name: 'Verwerfen #2' })).toBeFocused()
    await run.getByRole('button', { name: 'Verwerfen #2' }).click()
    await expect(run.getByRole('button', { name: 'Verwerfen #3' })).toBeFocused()
    await run.getByRole('button', { name: 'Verwerfen #3' }).click()
    await expect(run.locator('.agx-review__title')).toBeFocused()
    // the note that the state is back: whole, wrapped — never cut
    const note = run.locator('.agx-step').last().locator('.agx-step__text')
    await expect(note).toHaveText('Alle Vorschläge verworfen: Der Zustand von vor diesem Lauf gilt wieder.')
    expect(await note.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)

    // "Alle verwerfen": focus on the review's heading
    await page.getByRole('button', { name: 'Jetzt ausführen' }).click()
    const second = page.locator('.agx-run').first()
    await expect(second).toHaveAttribute('data-status', 'staged', { timeout: 20_000 })
    await second.getByRole('button', { name: 'Alle verwerfen' }).click()
    await expect(second.locator('.agx-review__title')).toBeFocused()
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false)
  })

  test('C14 the budget field in the UI’s language: German “1,5” is 1,50 $ (a dot too), anything else is refused — never a silent ×10', async ({ page }) => {
    await openApp(page)
    const id = await addAgent(page, { id: 'ag-budget', name: 'Kasse', write: 'none', maxRunUsd: 0.5 })
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await goAgent(page, id)
    const editor = page.locator('.agx-editor')
    const input = editor.locator('.agx-money input')
    const edit = async () => {
      await page.getByRole('button', { name: 'Bearbeiten' }).click()
      await expect(editor).toBeVisible()
    }
    await edit()
    await expect(input).toHaveAttribute('type', 'text')
    await expect(input).toHaveAttribute('inputmode', 'decimal')
    await expect(input).toHaveValue('0,50')
    await input.fill('')
    await input.pressSequentially('1,5')
    await expect(input).toHaveValue('1,5')
    await editor.getByRole('button', { name: 'Speichern' }).click()
    await expect(editor).toHaveCount(0)
    expect(await wsEval(page, (s, id) => s.agents[id].maxRunUsd, id)).toBe(1.5)
    await expect(page.locator('.agx-spec--plate')).toContainText('1,50 $ pro Lauf')
    // shown in German; a dot is read too
    await edit()
    await expect(input).toHaveValue('1,50')
    await input.fill('0.75')
    await editor.getByRole('button', { name: 'Speichern' }).click()
    await expect(editor).toHaveCount(0)
    expect(await wsEval(page, (s, id) => s.agents[id].maxRunUsd, id)).toBe(0.75)
    // no number: refused, said so
    await edit()
    await input.fill('1,5 Euro')
    await editor.getByRole('button', { name: 'Speichern' }).click()
    await expect(editor.locator('.agx-field__error')).toHaveText('Gib den Betrag als Zahl an, etwa 1,50.')
    expect(await wsEval(page, (s, id) => s.agents[id].maxRunUsd, id)).toBe(0.75)
    // English: the comma is not its decimal mark — refused, never 15
    await wsEval(page, (s) => s.updateSettings({ language: 'en' }))
    await input.fill('1,5')
    await editor.getByRole('button', { name: 'Save' }).click()
    await expect(editor.locator('.agx-field__error')).toHaveText('Enter the amount as a number, such as 1.50.')
    expect(await wsEval(page, (s, id) => s.agents[id].maxRunUsd, id)).toBe(0.75)
  })

  test('C13 Settings → E-Mail: the cost per run in the UI’s language (“≈ 0,27 $”)', async ({ page }) => {
    await openApp(page)
    await setKey(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings' }))
    await page.getByRole('tab', { name: /E-Mail/ }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('switch', { name: /Neue Mails mit Claude ordnen/ }).first().click()
    const cost = dialog.getByTestId('mail-cost')
    await expect(cost).toBeVisible()
    await expect(cost).toContainText(/≈ \d+,\d\d\s\$|< 0,01\s\$/)
    await expect(cost).not.toContainText('$0.')
  })
})
