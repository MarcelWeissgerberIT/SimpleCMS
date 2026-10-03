/**
 * Seams between features (adversarial review): each test here failed before its fix.
 */
import type { BrowserContext, Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, wsEval, createPage, doc, pageIdByTitle, gotoPage, editorOf, flush, MOD } from './fixtures'

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __oneSync: any
    __pagesSwaps?: number
  }
}

// headless Chromium stores OPFS names through the process locale (see sync.spec.ts)
test.use({ launchOptions: { env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } } })

async function connectFolder(page: Page, name: string) {
  await page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(name, { create: true })
    await window.__oneSync.connect(dir)
  }, name)
}

async function readExternal(page: Page, name: string, path: string): Promise<string | null> {
  return page.evaluate(
    async ({ name, path }) => {
      try {
        let d = await (await navigator.storage.getDirectory()).getDirectoryHandle(name)
        const segs = path.split('/')
        for (const s of segs.slice(0, -1)) d = await d.getDirectoryHandle(s)
        return await (await (await d.getFileHandle(segs[segs.length - 1])).getFile()).text()
      } catch {
        return null
      }
    },
    { name, path },
  )
}

async function writeExternal(page: Page, name: string, path: string, text: string) {
  await page.evaluate(
    async ({ name, path, text }) => {
      let d = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true })
      const segs = path.split('/')
      for (const s of segs.slice(0, -1)) d = await d.getDirectoryHandle(s, { create: true })
      const w = await (await d.getFileHandle(segs[segs.length - 1], { create: true })).createWritable()
      await w.write(text)
      await w.close()
    },
    { name, path, text },
  )
}

test.describe('folder sync × cross-tab persistence', () => {
  test('a connected folder stays idle: its status broadcast is not taken for a workspace save', async ({ page }) => {
    await openApp(page)
    await connectFolder(page, 'one-review-idle')
    await expect.poll(() => page.evaluate(() => window.__oneSync.state().folder.state)).toBe('ready')
    // let the first run and its follow-ups settle
    await page.waitForTimeout(3000)
    await page.evaluate(() => {
      window.__pagesSwaps = 0
      const ws = (window as unknown as { __one: { workspace: { subscribe: (fn: (s: { pages: unknown }, p: { pages: unknown }) => void) => void } } }).__one.workspace
      ws.subscribe((s, p) => {
        if (s.pages !== p.pages) window.__pagesSwaps = (window.__pagesSwaps ?? 0) + 1
      })
    })
    const lastAt = await page.evaluate(() => window.__oneSync.state().folder.lastAt)
    // nothing changes: no re-read of the workspace, no further sync run
    await page.waitForTimeout(6000)
    expect(await page.evaluate(() => window.__pagesSwaps)).toBe(0)
    expect(await page.evaluate(() => window.__oneSync.state().folder.lastAt)).toBe(lastAt)
    expect(await wsEval(page, (s) => Object.keys(s.pages).length)).toBeGreaterThan(0)
  })
})

/* ------------------------------------------------------------------ inbox × synced blocks */

type InboxHook = {
  data: () => { items: Array<{ id: string; kind: string; pageId: string }>; rem: Record<string, unknown> }
  reminders: () => Array<{ key: string; pageId: string }>
}
const inboxData = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __oneInbox: InboxHook }).__oneInbox.data())) as ReturnType<InboxHook['data']>)
const dateLine = (text: string, iso: string, reminder: string): JSONContent => ({
  type: 'paragraph',
  content: [{ type: 'text', text }, { type: 'mention', attrs: { id: iso, label: iso, kind: 'date', reminder } }],
})

test.describe('reminders × synced blocks', () => {
  test('a reminder inside a synced block fires once, not once per page that shows the block', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-05T09:00:00+02:00') })
    await openApp(page)
    const syncId = 'review-sync-1'
    const block = (source: string | null): JSONContent => ({ type: 'syncedBlock', attrs: { syncId, sourcePageId: source }, content: [dateLine('Ship review on ', '2026-10-05T10:30', '-15m')] })
    const a = await createPage(page, { title: 'Release plan', content: doc(block(null)) })
    await createPage(page, { title: 'Team page', content: doc({ type: 'paragraph', content: [{ type: 'text', text: 'Shared:' }] }, block(a)) })
    await createPage(page, { title: 'Another page', content: doc(block(a)) })
    // the scheduler knows it — as one reminder, at the original
    await expect.poll(async () => (await page.evaluate(() => (window as unknown as { __oneInbox: InboxHook }).__oneInbox.reminders())).filter((r) => r.key.includes('2026-10-05T10:30')).length).toBe(1)

    await page.clock.fastForward('01:15:20')
    await expect(page.locator('.toast', { hasText: 'Reminder · Release plan — Mon 5 Oct, 10:30' })).toBeVisible()
    await page.waitForTimeout(500)
    const items = (await inboxData(page)).items.filter((i) => i.kind === 'reminder')
    expect(items).toHaveLength(1)
    expect(items[0].pageId).toBe(a)
    await expect(page.locator('.toast', { hasText: /reminder/i })).toHaveCount(1)
  })
})

/* ------------------------------------------------------------------ agent × locked databases */

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type ToolUse = { id: string; name: string; input: Record<string, unknown> }

/** A streamed assistant message: tool calls, or a final text (see agent.spec.ts). */
function agentMessage(tools: ToolUse[], text = 'Done.'): string {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  let body = ev('message_start', { message: { id: `msg_review_${Math.random().toString(36).slice(2)}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } })
  if (!tools.length) {
    body += ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
    body += ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } })
    body += ev('content_block_stop', { index: 0 })
  }
  tools.forEach((b, index) => {
    body += ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } })
    body += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } })
    body += ev('content_block_stop', { index })
  })
  body += ev('message_delta', { delta: { stop_reason: tools.length ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } })
  body += ev('message_stop', {})
  return body
}

/** api.anthropic.com → the next scripted message per request (never the real API). */
async function scriptAgent(ctx: BrowserContext, script: Array<() => string>): Promise<AnyState[]> {
  const bodies: AnyState[] = []
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    bodies.push(JSON.parse(route.request().postData() ?? '{}'))
    const step = script[bodies.length - 1] ?? (() => agentMessage([]))
    await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: step() })
  })
  return bodies
}

const toolResult = (body: AnyState, id: string) => (body.messages as AnyState[]).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((c: AnyState) => c.type === 'tool_result' && c.tool_use_id === id)
const tagNames = (page: Page, db: string) => wsEval(page, (s, db) => (s.databases[db].properties.find((p: AnyState) => p.name === 'Tags').options as AnyState[]).map((o) => o.name), db)

test.describe('agent × locked database', () => {
  test('the agent creates no options in a locked database — not when staging, not when applying', async ({ page, context }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    const projects = await pageIdByTitle(page, 'Projects')
    const before = await tagNames(page, projects)
    expect(before).toContain('Ops')
    expect(before).not.toContain('Automation')
    const bodies = await scriptAgent(context, [
      // run 1 (locked): a new option is refused, an existing one is fine
      () => agentMessage([{ id: 'toolu_a', name: 'create_row', input: { database_id: projects, title: 'Wire up n8n', properties: { Tags: ['Ops', 'Automation'] } } }]),
      () => agentMessage([{ id: 'toolu_b', name: 'create_row', input: { database_id: projects, title: 'Wire up n8n', properties: { Tags: ['Ops'] } } }]),
      () => agentMessage([], 'Staged.'),
      // run 2 (unlocked while staging, locked before "Apply all")
      () => agentMessage([{ id: 'toolu_c', name: 'create_row', input: { database_id: projects, title: 'Hook up Zapier', properties: { Tags: ['Automation'] } } }]),
      () => agentMessage([], 'Staged.'),
    ])
    await wsEval(page, (s, db) => s.updateDatabase(db, { locked: true }), projects)

    await page.keyboard.press(`${MOD}+j`)
    const panel = page.getByRole('dialog', { name: 'Agent' })
    const field = panel.getByRole('textbox', { name: 'Task for the agent' })
    await field.fill('Add an n8n task')
    await field.press('Enter')
    await expect(panel.getByRole('listitem', { name: '#1 New row' })).toBeVisible({ timeout: 20_000 })
    await expect(panel.locator('.agent-head__status')).toContainText('Done')
    const refused = toolResult(bodies[1], 'toolu_a')
    expect(refused?.is_error).toBe(true)
    expect(String(refused?.content)).toMatch(/locked/i)
    await panel.locator('.agent-bar').getByRole('button', { name: 'Apply all' }).click()
    await expect(panel.getByRole('listitem', { name: '#1 New row' })).toContainText('Applied')
    expect(await tagNames(page, projects)).toEqual(before)

    // run 2: staged while unlocked, applied after locking → that change fails, nothing is created
    await panel.getByRole('button', { name: 'New task' }).click()
    await wsEval(page, (s, db) => s.updateDatabase(db, { locked: false }), projects)
    await field.fill('Add a Zapier task')
    await field.press('Enter')
    const staged = panel.getByRole('listitem', { name: '#1 New row' })
    await expect(staged).toContainText('+ new option', { timeout: 20_000 })
    await expect(panel.locator('.agent-head__status')).toContainText('Done')
    await wsEval(page, (s, db) => s.updateDatabase(db, { locked: true }), projects)
    await panel.locator('.agent-bar').getByRole('button', { name: 'Apply all' }).click()
    await expect(staged.locator('.agent-change__error')).toContainText(/locked/i)
    expect(await tagNames(page, projects)).toEqual(before)
    expect(await wsEval(page, () => (Object.values((window as unknown as { __one: { workspace: { getState: () => AnyState } } }).__one.workspace.getState().pages) as AnyState[]).some((p) => p.title === 'Hook up Zapier'))).toBe(false)
  })
})

test.describe('folder sync × locked database', () => {
  test('a front matter edit picks existing options of a locked database, never creates one', async ({ page }) => {
    await openApp(page)
    const dir = 'one-review-locked'
    const projects = await pageIdByTitle(page, 'Projects')
    await wsEval(page, (s, db) => s.updateDatabase(db, { locked: true }), projects)
    await connectFolder(page, dir)
    const path = 'Projects/Website relaunch.md'
    await expect.poll(() => readExternal(page, dir, path)).toContain('Status: In progress')
    const statusNames = () => wsEval(page, (s, db) => (s.databases[db].properties.find((p: AnyState) => p.name === 'Status').options as AnyState[]).map((o) => o.name), projects)
    const before = await statusNames()
    const row = (await readExternal(page, dir, path))!
    await writeExternal(page, dir, path, row.replace('Status: In progress', 'Status: Shipped').replace('Budget: 18000', 'Budget: 20000'))
    await page.evaluate(() => window.__oneSync.pickup())
    const relaunch = await pageIdByTitle(page, 'Website relaunch')
    const read = () =>
      wsEval(
        page,
        (s, id) => {
          const db = s.databases[s.pages[id].databaseId]
          const prop = (name: string) => db.properties.find((p: AnyState) => p.name === name)
          const status = prop('Status')
          return { status: status.options.find((o: AnyState) => o.id === s.pages[id].properties[status.id])?.name, budget: s.pages[id].properties[prop('Budget').id] }
        },
        relaunch,
      )
    // the rest of the file is taken over; the unknown option is not created
    await expect.poll(read).toEqual({ status: 'In progress', budget: 20000 })
    expect(await statusNames()).toEqual(before)
    // and the file follows One again
    await expect.poll(() => readExternal(page, dir, path)).toContain('Status: In progress')
  })
})

test.describe('folder sync × synced blocks', () => {
  test('an edit inside a synced block in its file keeps the block synced and reaches every copy', async ({ page }) => {
    await openApp(page)
    const dir = 'one-review-synced'
    const para = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] })
    const block = (source: string | null): JSONContent => ({ type: 'syncedBlock', attrs: { syncId: 'review-sync-file', sourcePageId: source }, content: [para('Principle one: be clear.'), para('Principle two: be kind.')] })
    const a = await createPage(page, { title: 'Principles', content: doc(para('Intro line.'), block(null), para('Outro line.')) })
    const b = await createPage(page, { title: 'Onboarding', content: doc(para('Read these:'), block(a)) })
    await connectFolder(page, dir)
    await expect.poll(() => readExternal(page, dir, 'Principles.md')).toContain('Principle two: be kind.')
    const file = (await readExternal(page, dir, 'Principles.md'))!
    await writeExternal(page, dir, 'Principles.md', file.replace('Principle two: be kind.', 'Principle two: be kind, always.'))
    await page.evaluate(() => window.__oneSync.pickup())
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain, a)).toContain('be kind, always.')
    // still one synced block (the original) on the page, around both principles
    expect(await wsEval(page, (s, id) => (s.pages[id].content.content as AnyState[]).map((n) => n.type), a)).toEqual(['paragraph', 'syncedBlock', 'paragraph'])
    // the copy on the other page follows
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain, b)).toContain('be kind, always.')
    expect(await wsEval(page, (s, id) => (s.pages[id].content.content as AnyState[]).map((n) => n.type), b)).toEqual(['paragraph', 'syncedBlock'])

    // the copy's file: an edit there reaches the original; a line after the block stays outside it
    await expect.poll(() => readExternal(page, dir, 'Onboarding.md')).toContain('be kind, always.')
    const copy = (await readExternal(page, dir, 'Onboarding.md'))!
    await writeExternal(page, dir, 'Onboarding.md', copy.replace('Principle one: be clear.', 'Principle one: be crystal clear.').trimEnd() + '\n\nQuestions? Ask Mira.\n')
    await page.evaluate(() => window.__oneSync.pickup())
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain, a)).toContain('be crystal clear.')
    const onboarding = await wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.pages[id].content.content)) as AnyState[], b)
    expect(onboarding.map((n) => n.type)).toEqual(['paragraph', 'syncedBlock', 'paragraph'])
    expect(onboarding[1].attrs).toMatchObject({ syncId: 'review-sync-file', sourcePageId: a })
    expect(onboarding[1].content).toHaveLength(2)
  })
})

test.describe('reminders × writers that move dates', () => {
  test('the agent moving a date keeps the reminder set on it (like the date editor, calendar and file sync)', async ({ page, context }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    const { dbId, rowId } = await wsEval(page, (s) => {
      const dbId = s.createDatabase({ title: 'Launch tasks', properties: [{ id: 'pName', name: 'Name', type: 'title' }, { id: 'pDue', name: 'Due', type: 'date' }] })
      const rowId = s.createRow(dbId, { title: 'Ship release', properties: { pDue: { start: '2026-10-07', reminder: '-1d' } } })
      return { dbId, rowId }
    })
    await scriptAgent(context, [
      () => agentMessage([{ id: 'toolu_d', name: 'update_row', input: { id: rowId, properties: { Due: '2026-10-09' } } }]),
      () => agentMessage([], 'Moved.'),
    ])
    await page.keyboard.press(`${MOD}+j`)
    const panel = page.getByRole('dialog', { name: 'Agent' })
    const field = panel.getByRole('textbox', { name: 'Task for the agent' })
    await field.fill('Move the release to Friday')
    await field.press('Enter')
    await expect(panel.locator('.agent-head__status')).toContainText('Done', { timeout: 20_000 })
    await panel.locator('.agent-bar').getByRole('button', { name: 'Apply all' }).click()
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].properties.pDue, rowId)).toMatchObject({ start: '2026-10-09', reminder: '-1d' })
    expect(dbId).toBeTruthy()
  })
})

test.describe('AI autofill × locked database', () => {
  test('"Fill this cell" proposes no new option while the database is locked', async ({ page, context }) => {
    const prompts: string[] = []
    await context.route('https://api.anthropic.com/**', async (route) => {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      const body = JSON.parse(route.request().postData() ?? '{}')
      prompts.push(String(body.messages?.[0]?.content ?? ''))
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'msg_e2e', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify({ value: 'Urgent' }) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 3 } }),
      })
    })
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    const dbId = await pageIdByTitle(page, 'Projects')
    const priority = () => wsEval(page, (s, dbId) => JSON.parse(JSON.stringify(s.databases[dbId].properties.find((x: AnyState) => x.name === 'Priority'))), dbId)
    const before = (await priority()).options.map((o: AnyState) => o.name)
    // set up while unlocked: Claude may propose new options, written without review
    await wsEval(
      page,
      (s, dbId) => {
        const p = s.databases[dbId].properties.find((x: AnyState) => x.name === 'Priority')
        s.updateProperty(dbId, p.id, { autofill: { preset: 'categorize', allowNewOptions: true, skipReview: true } })
        s.updateDatabase(dbId, { locked: true })
      },
      dbId,
    )
    await gotoPage(page, dbId)
    await page.locator('#main section.db').first().getByRole('tab').filter({ hasText: 'All projects' }).click()
    const grid = page.locator('#main .dbt')
    await grid.focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(grid.locator('[data-cell="0:2"]')).toHaveAttribute('data-active', 'true')
    await page.keyboard.press('Alt+Enter')
    await expect.poll(() => prompts.length).toBe(1)
    // the request offers the existing options only, and the answer creates none (the cell reports it)
    expect(prompts[0]).not.toMatch(/new short option/i)
    await expect(page.locator('.toast').filter({ hasText: /Urgent/ })).toBeVisible()
    await page.waitForTimeout(300)
    expect((await priority()).options.map((o: AnyState) => o.name)).toEqual(before)
  })

  test('proposals with a new option made before the database was locked are not applied after', async ({ page, context }) => {
    await context.route('https://api.anthropic.com/**', async (route) => {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      const body = JSON.parse(route.request().postData() ?? '{}')
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'msg_e2e', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify({ value: 'Urgent' }) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 3 } }),
      })
    })
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    const dbId = await pageIdByTitle(page, 'Projects')
    const names = () => wsEval(page, (s, dbId) => (s.databases[dbId].properties.find((x: AnyState) => x.name === 'Priority').options as AnyState[]).map((o) => o.name), dbId)
    const values = () => wsEval(page, (s, dbId) => {
      const prop = s.databases[dbId].properties.find((x: AnyState) => x.name === 'Priority')
      return (Object.values(s.pages) as AnyState[]).filter((r) => r.databaseId === dbId && !r.trashed).map((r) => r.properties[prop.id] ?? null).sort()
    }, dbId)
    const before = { names: await names(), values: await values() }
    await wsEval(
      page,
      (s, dbId) => {
        const p = s.databases[dbId].properties.find((x: AnyState) => x.name === 'Priority')
        s.updateProperty(dbId, p.id, { autofill: { preset: 'categorize', allowNewOptions: true } })
      },
      dbId,
    )
    await gotoPage(page, dbId)
    const db = page.locator('#main section.db').first()
    await db.getByRole('tab').filter({ hasText: 'All projects' }).click()
    await db.locator('.dbt-hcell__btn', { hasText: 'Priority' }).click()
    await page.getByRole('menuitem', { name: /AI autofill/ }).click()
    const dlg = page.getByRole('dialog', { name: 'AI autofill · Priority' })
    await dlg.getByRole('button', { name: /Fill all rows/ }).click()
    await expect(dlg.getByRole('table', { name: 'Proposed values' })).toBeVisible({ timeout: 20_000 })
    await wsEval(page, (s, dbId) => s.updateDatabase(dbId, { locked: true }), dbId)
    await dlg.getByRole('button', { name: 'Accept all' }).click()
    await page.waitForTimeout(300)
    expect(await names()).toEqual(before.names)
    expect(await values()).toEqual(before.values)
  })
})

test.describe('"Me" filter × language', () => {
  test('"Me" still finds the demo workspace\'s own person after switching the language', async ({ page }) => {
    await openApp(page)
    const dbId = await wsEval(page, (s) => {
      const you = s.people.find((p: AnyState) => p.name === 'You').id as string
      const alex = s.people.find((p: AnyState) => p.name === 'Alex').id as string
      const dbId = s.createDatabase({ title: 'Owners', properties: [{ id: 'pName', name: 'Name', type: 'title' }, { id: 'pOwner', name: 'Owner', type: 'person' }] })
      s.createRow(dbId, { title: 'Mine', properties: { pOwner: [you] } })
      s.createRow(dbId, { title: 'Theirs', properties: { pOwner: [alex] } })
      const fresh = (window as unknown as { __one: { workspace: { getState: () => AnyState } } }).__one.workspace.getState()
      s.updateView(dbId, fresh.databases[dbId].views[0].id, { filter: { id: 'g', op: 'and', items: [{ id: 'f', propertyId: 'pOwner', operator: 'contains', value: '@me' }] } })
      return dbId
    })
    await gotoPage(page, dbId)
    const titles = () =>
      page
        .locator('#main section.db .dbt-body .dbt-row[role="row"]')
        .evaluateAll((rows) => rows.map((r) => (r.querySelector('.dbt-cell--title')?.textContent ?? '').replace(/OPEN|ÖFFNEN/g, '').trim()))
    await expect.poll(titles).toEqual(['Mine'])
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await expect(page.locator('#main section.db .dbt-hcell', { hasText: 'Owner' })).toBeVisible()
    await page.waitForTimeout(300)
    await expect.poll(titles).toEqual(['Mine'])
  })
})

test.describe('automation recipes × locked database', () => {
  test('"Stamp a date when Done" adds no property to a locked database', async ({ page }) => {
    await openApp(page)
    const dbId = await pageIdByTitle(page, 'Projects')
    const propNames = () => wsEval(page, (s, dbId) => (s.databases[dbId].properties as AnyState[]).map((p) => p.name), dbId)
    const before = await propNames()
    const autos = () => wsEval(page, (s, dbId) => (s.databases[dbId].automations ?? []).length, dbId)
    const autosBefore = await autos()
    expect(before).not.toContain('Completed')
    await wsEval(page, (s, dbId) => s.updateDatabase(dbId, { locked: true }), dbId)
    await gotoPage(page, dbId)
    await page.locator('#main section.db').first().getByRole('button', { name: 'Automations' }).click()
    const dialog = page.getByRole('dialog')
    const recipe = dialog.locator('.auto-recipe', { hasText: 'Stamp a date when Done' })
    await expect(recipe).toBeVisible()
    // it would add a "Completed" property: not on a locked database
    await expect(recipe).toBeDisabled()
    await expect(recipe).toContainText(/locked/i)
    await recipe.click({ force: true })
    await page.waitForTimeout(300)
    expect(await propNames()).toEqual(before)
    expect(await autos()).toBe(autosBefore)
    // the other recipes stay available (automations are allowed on a locked database)
    await expect(dialog.locator('.auto-recipe', { hasText: 'Notify when Status' })).toBeEnabled()
  })
})

test.describe('synced blocks × controls inside a read-only copy', () => {
  test('a copy whose original is gone: its to-do boxes and date chips do not pretend to change', async ({ page }) => {
    await openApp(page)
    const content = (source: string | null): JSONContent => ({
      type: 'syncedBlock',
      attrs: { syncId: 'review-orphan', sourcePageId: source },
      content: [
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Sign the contract' }] }] }] },
        dateLine('Due ', '2026-10-20', 'at'),
      ],
    })
    const a = await createPage(page, { title: 'Contract', content: doc(content(null)) })
    const b = await createPage(page, { title: 'Legal hub', content: doc({ type: 'paragraph', content: [{ type: 'text', text: 'Hub' }] }, content(a)) })
    await wsEval(page, (s, id) => s.trashPage(id), a)
    await gotoPage(page, b)
    const ref = editorOf(page, b).locator('[data-type="synced-block"]')
    await expect(ref).toHaveAttribute('data-role', 'orphan')

    const box = ref.locator('ul[data-type="taskList"] li input[type="checkbox"]')
    await box.click({ force: true })
    await flush(page)
    const stored = await wsEval(page, (s, id) => JSON.stringify(s.pages[id].content), b)
    expect(stored).toContain('"checked":false')
    // what the page shows is what it holds
    await expect(box).not.toBeChecked()

    await ref.locator('.mention__date').click({ force: true })
    await page.waitForTimeout(300)
    await expect(page.getByRole('dialog', { name: 'Change date or reminder' })).toHaveCount(0)
  })
})
