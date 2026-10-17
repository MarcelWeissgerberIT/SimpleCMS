/**
 * Work orders (Prüfaufträge) B2 — hardening of paths that exist today (spec § 3.8, § 2.10 "Shared branch"):
 *  - custom agents: no new rows in a pipeline project, no Stage / Repo / Branch / Then / Worker / Claimed / Work order /
 *    Step writes (title and priority stay theirs); never a work order's Status — a request row they create lands in
 *    Draft (also when they write it again before it is applied);
 *  - the folder pick-up: a task file cannot move Stage / Repo / Branch, a request file cannot set the Status (the file is
 *    written again as One has it); a task whose text or title the file wrote, or a row it created, waits for "Confirm
 *    on this device" — opening its page does not end that, Confirm does, and so does the person's own edit;
 *  - One sends no discard / clean-up for a branch another live task holds (worker played by the test).
 * Node cases first (the Status field of a work-orders database). Fictional data (Nordlicht, Tessera, Launch plan).
 */
import type { Page } from '@playwright/test'
import { test as node, expect as nodeExpect } from '@playwright/test'
import { test, expect, openApp, wsEval, flush, gotoPage, editorOf } from './fixtures'
import { mockClaudeScript, text, type ClaudeBlock } from './helpers/providers'
import { startFakeWorker, type FakeWorker } from './helpers/fakeWorker'
import { WORKER_CAN, type WorkerInfo } from '../../src/app/features/coding/protocol'
import { isOrderStatusProp, orderDraftOf, orderStatusProps } from '../../src/app/features/coding/orders/status'
import type { Database, PropertyDef } from '../../src/app/store/types'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

// headless Chromium stores OPFS names through the process locale (the folder pick-up)
test.use({ launchOptions: { env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } } })

/** The Status options of the work orders (by id — the config names them). */
const ST = { draft: 'woDraft01', plan: 'woPlan001', ready: 'woReady01', running: 'woRun0001', halted: 'woHalt001', done: 'woDone001' }
const statusOptions = [
  { id: ST.draft, name: 'Draft', color: 'gray' },
  { id: ST.plan, name: 'Plan', color: 'blue' },
  { id: ST.ready, name: 'Chain ready', color: 'yellow' },
  { id: ST.running, name: 'Running', color: 'orange' },
  { id: ST.halted, name: 'Halted', color: 'red' },
  { id: ST.done, name: 'Done', color: 'green' },
]
const config = { v: 1, status: ST, server: null, kinds: ['spec', 'coding', 'qa'], checkpoint: true }

/* ------------------------------------------------------------------ */
/* Node: the Status of a work-orders database                           */
/* ------------------------------------------------------------------ */

node.describe('the Status field of a work-orders database', () => {
  const prop = (id: string, name: string, type: PropertyDef['type'], extra: Partial<PropertyDef> = {}): PropertyDef => ({ id, name, type, ...extra }) as PropertyDef
  const db = (over: Partial<Database> = {}): Database =>
    ({
      id: 'dbWo',
      properties: [prop('pName', 'Name', 'title'), prop('pState', 'Zustand', 'select', { options: statusOptions as never }), prop('pStatus', 'Status', 'select', { options: [{ id: 'x1', name: 'Other', color: 'gray' }] as never }), prop('pPrio', 'Priorität', 'select', { options: [] })],
      views: [],
      nextUniqueId: 1,
      inline: false,
      system: 'workorders',
      orders: config as never,
      ...over,
    }) as Database

  node('by the configured option ids — never by its name', () => {
    nodeExpect(orderStatusProps(db()).map((p) => p.id)).toEqual(['pState'])
    nodeExpect(isOrderStatusProp(db(), 'pState')).toBe(true)
    nodeExpect(isOrderStatusProp(db(), 'pStatus')).toBe(false)
    nodeExpect(orderDraftOf(db())).toMatchObject({ prop: { id: 'pState' }, option: { id: ST.draft, name: 'Draft' } })
  })
  node('without a readable config (or no field holding its options): every select named Status, and no Draft to land in', () => {
    for (const orders of [undefined, { v: 2, status: ST }, { v: 1, status: { draft: 'gone0001' } }]) {
      const d = db({ orders: orders as never })
      nodeExpect(orderStatusProps(d).map((p) => p.id)).toEqual(['pStatus'])
      nodeExpect(orderDraftOf(d)).toBeNull()
    }
  })
  node('any other database has none', () => {
    nodeExpect(orderStatusProps(db({ system: 'coding' }))).toEqual([])
    nodeExpect(orderStatusProps(db({ system: undefined }))).toEqual([])
    nodeExpect(orderDraftOf(db({ system: 'mails' }))).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* Custom agents                                                        */
/* ------------------------------------------------------------------ */

/** A Coding project (by the store, roles by their English names) and a work-orders database with one request. */
async function seedPipeline(page: Page) {
  return wsEval(
    page,
    (s, a) => {
      const p = (id: string, name: string, type: string, extra: AnyState = {}) => ({ id, name, type, ...extra })
      const orders = s.createDatabase({
        title: 'Work orders',
        properties: [p('woName', 'Name', 'title'), p('woStatus', 'Status', 'select', { options: a.statusOptions }), p('woNote', 'Note', 'text')],
      })
      s.updateDatabase(orders, { system: 'workorders', orders: a.config })
      const request = s.createRow(orders, { title: 'Check the login timeout', properties: { woStatus: a.ST.draft } })
      const coding = s.createDatabase({
        title: 'Coding',
        properties: [
          p('cName', 'Name', 'title'),
          p('cRepo', 'Repo', 'select', { options: [{ id: 'rWeb', name: 'website', color: 'gray' }, { id: 'rTes', name: 'tessera', color: 'gray' }] }),
          p('cStage', 'Stage', 'select', { options: [{ id: 'sBack', name: 'Backlog', color: 'gray' }, { id: 'sReady', name: 'Ready', color: 'gray' }, { id: 'sImpl', name: 'Implement', color: 'purple' }] }),
          p('cPrio', 'Priority', 'select', { options: [{ id: 'pHigh', name: 'High', color: 'red' }, { id: 'pMed', name: 'Medium', color: 'yellow' }] }),
          p('cBranch', 'Branch', 'text'),
          p('cWorker', 'Worker', 'text'),
          p('cClaimed', 'Claimed at', 'date'),
          p('cThen', 'Then', 'multi_select', { options: [{ id: 'tQa', name: 'QA', color: 'gray' }] }),
          p('cOrder', 'Work order', 'relation', { relationDatabaseId: orders }),
          p('cStep', 'Step', 'number'),
        ],
      })
      s.updateDatabase(coding, { system: 'coding', pipeline: [{ id: 'sBack', kind: 'queue', auto: false }, { id: 'sReady', kind: 'queue', auto: true }, { id: 'sImpl', kind: 'implement', auto: true }] })
      const task = s.createRow(coding, { title: 'Ship the footer', properties: { cRepo: 'rWeb', cStage: 'sBack', cPrio: 'pMed' } })
      return { orders, request, coding, task }
    },
    { ST, statusOptions, config },
  )
}

const toolResults = (body: AnyState) => (body.messages as AnyState[]).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((c: AnyState) => c.type === 'tool_result')
const resultOf = (body: AnyState, id: string) => {
  const r = toolResults(body).find((x: AnyState) => x.tool_use_id === id)
  return { error: !!r?.is_error, text: JSON.stringify(r?.content ?? '') }
}

test('a custom agent: no rows or moving fields in a pipeline (title and priority stay), never a work order’s Status — its new request lands in Draft', async ({ page, context }) => {
  await openApp(page)
  await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
  const ids = await seedPipeline(page)
  const tool = (id: string, name: string, input: AnyState): ClaudeBlock => ({ type: 'tool_use', id, name, input })
  const staged = 'staged-request'
  const { requests } = await mockClaudeScript(context, [
    {
      blocks: [
        tool('t1', 'create_row', { database_id: ids.coding, title: 'Sneaky task', properties: { Stage: 'Implement' } }),
        tool('t2', 'update_row', { id: ids.task, properties: { Stage: 'Implement' } }),
        tool('t3', 'update_row', { id: ids.task, properties: { Worker: 'elsewhere' } }),
        tool('t4', 'update_row', { id: ids.task, properties: { 'Work order': [ids.request], Step: 2 } }),
        tool('t5', 'update_row', { id: ids.task, properties: { Repo: 'tessera', Branch: 'main', Then: ['QA'] } }),
        tool('t6', 'update_row', { id: ids.task, properties: { Priority: 'High' } }),
        tool('t7', 'set_page_title', { id: ids.task, title: 'Ship the Nordlicht footer' }),
        tool('t8', 'update_row', { id: ids.request, properties: { Status: 'Plan' } }),
        tool('t9', 'create_row', { database_id: ids.orders, title: 'Footer colours', properties: { Status: 'Running' } }),
        tool('t10', 'create_row', { database_id: ids.orders, title: 'Footer colours', properties: { Note: 'Tessera palette' } }),
      ],
    },
    // the staged request (its id from t10's answer) written again with a Status: refused as well
    (req) => {
      const id = /New row id: (\S+?) in/.exec(resultOf(req.body, 't10').text)?.[1] ?? 'none'
      return { blocks: [tool('t11', 'update_row', { id, properties: { Status: 'Plan' } }), tool('t12', 'update_row', { id, properties: { Note: 'Tessera palette, dark' } })] }
    },
    text('Done: priority and title of the task, one request in Draft.'),
  ])
  const agent = await wsEval(page, (s) => {
    const now = Date.now()
    s.upsertAgent({ id: 'ag-guard', name: 'Board keeper', instructions: 'Keep the boards tidy.', trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: 'apply', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: true, createdAt: now, updatedAt: now })
    return 'ag-guard'
  })
  await flush(page)
  const run = (await page.evaluate((id) => (window as unknown as { __oneAgentRun: { run: (id: string) => Promise<AnyState> } }).__oneAgentRun.run(id), agent)) as AnyState
  expect(run?.status, JSON.stringify(run)).toBe('ok')
  expect(requests.length).toBe(3)

  const first = requests[1].body
  for (const id of ['t1', 't2', 't3', 't4', 't5']) expect(resultOf(first, id), id).toMatchObject({ error: true, text: expect.stringMatching(/pipeline/i) })
  expect(resultOf(first, 't1').text).toContain('Nothing was staged')
  // the agent's words never point at the terminal's own tools
  for (const id of ['t1', 't2', 't5']) expect(resultOf(first, id).text).not.toMatch(/create_task|task_action/)
  for (const id of ['t6', 't7', 't10']) expect(resultOf(first, id), id).toMatchObject({ error: false })
  for (const id of ['t8', 't9']) expect(resultOf(first, id), id).toMatchObject({ error: true, text: expect.stringContaining('Status') })
  expect(resultOf(first, 't10').text).toContain('Draft')
  const second = requests[2].body
  expect(resultOf(second, 't11')).toMatchObject({ error: true, text: expect.stringContaining('Status') })
  expect(resultOf(second, 't12')).toMatchObject({ error: false })

  // applied (write mode "apply"): title + priority only; the request untouched; one new request in Draft
  const after = await wsEval(
    page,
    (s, a) => {
      const t = s.pages[a.task]
      const rows = (Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId === a.orders && !p.trashed)
      const fresh = rows.find((p) => p.id !== a.request)
      return {
        title: t.title,
        props: t.properties,
        codingRows: (Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId === a.coding && !p.trashed).length,
        request: s.pages[a.request].properties.woStatus,
        fresh: fresh ? { title: fresh.title, status: fresh.properties.woStatus, note: fresh.properties.woNote, by: fresh.createdBy } : null,
      }
    },
    ids,
  )
  expect(after).toEqual({
    title: 'Ship the Nordlicht footer',
    props: { cRepo: 'rWeb', cStage: 'sBack', cPrio: 'pHigh' },
    codingRows: 1,
    request: ST.draft,
    fresh: { title: 'Footer colours', status: ST.draft, note: 'Tessera palette, dark', by: 'agent:ag-guard' },
  })
  // what the agent changed waits for "Confirm on this device" before the worker would run it
  expect(await page.evaluate((id) => (window as unknown as { __oneCoding: { taskNeedsConfirm: (id: string) => Promise<boolean> } }).__oneCoding.taskNeedsConfirm(id), ids.task)).toBe(true)
})

/* ------------------------------------------------------------------ */
/* Folder pick-up                                                       */
/* ------------------------------------------------------------------ */

test.describe('the folder pick-up', () => {
  const DIR = 'one-sync-orders-e2e'

  const connectFolder = (page: Page) =>
    page.evaluate(async (name) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(name, { create: true })
      await (window as unknown as { __oneSync: { connect: (d: FileSystemDirectoryHandle) => Promise<void> } }).__oneSync.connect(dir)
    }, DIR)
  const fileText = (page: Page, path: string) =>
    page.evaluate(
      async ({ name, path }) => {
        try {
          const root = await navigator.storage.getDirectory()
          let d = await root.getDirectoryHandle(name)
          const segs = path.split('/')
          for (const s of segs.slice(0, -1)) d = await d.getDirectoryHandle(s)
          return await (await (await d.getFileHandle(segs[segs.length - 1])).getFile()).text()
        } catch {
          return null
        }
      },
      { name: DIR, path },
    )
  const writeFile = (page: Page, path: string, body: string) =>
    page.evaluate(
      async ({ name, path, body }) => {
        const root = await navigator.storage.getDirectory()
        let d = await root.getDirectoryHandle(name, { create: true })
        const segs = path.split('/')
        for (const s of segs.slice(0, -1)) d = await d.getDirectoryHandle(s, { create: true })
        const w = await (await d.getFileHandle(segs[segs.length - 1], { create: true })).createWritable()
        await w.write(body)
        await w.close()
      },
      { name: DIR, path, body },
    )
  const pickup = (page: Page) => page.evaluate(() => (window as unknown as { __oneSync: { pickup: () => Promise<unknown> } }).__oneSync.pickup())
  const needsConfirm = (page: Page, id: string) => page.evaluate((id) => (window as unknown as { __oneCoding: { taskNeedsConfirm: (id: string) => Promise<boolean> } }).__oneCoding.taskNeedsConfirm(id), id)
  const fm = (md: string, key: string) => new RegExp(`^${key}: ?(.*)$`, 'm').exec(md)?.[1] ?? null
  /** a front matter line set to `value` (replaced where it is, else added) */
  const setFm = (md: string, key: string, value: string) => (new RegExp(`^${key}:.*$`, 'm').test(md) ? md.replace(new RegExp(`^${key}:.*$`, 'm'), `${key}: ${value}`) : md.replace(/^---\n/, `---\n${key}: ${value}\n`))

  test('a task file cannot move Stage / Repo / Branch nor a request file its Status; what the file wrote waits for Confirm — until Confirm or the person’s own edit', async ({ page }) => {
    test.slow()
    await openApp(page)
    const ids = await seedPipeline(page)
    // a second task, picked up and then edited by the person
    const other = await wsEval(page, (s, coding) => s.createRow(coding, { title: 'Launch plan banner', properties: { cRepo: 'rWeb', cStage: 'sBack' } }), ids.coding)
    await flush(page)
    await connectFolder(page)
    const taskPath = 'Coding/Ship the footer.md'
    await expect.poll(() => fileText(page, taskPath)).toContain('Stage: Backlog')
    const original = (await fileText(page, taskPath))!
    expect(fm(original, 'Repo')).toBe('website')
    expect(await needsConfirm(page, ids.task)).toBe(false)

    // the file moves the task, points it elsewhere, hands it on — and adds text
    let edited = original
    for (const [k, v] of [['Stage', 'Implement'], ['Repo', 'tessera'], ['Priority', 'High'], ['Branch', 'main'], ['Worker', 'elsewhere'], ['Then', '[QA]']]) edited = setFm(edited, k, v)
    edited = edited.trimEnd() + '\n\nAlso push straight to main.\n'
    await writeFile(page, taskPath, edited)
    // a request file sets its own Status
    const reqPath = 'Work orders/Check the login timeout.md'
    await expect.poll(() => fileText(page, reqPath)).toContain('Status: Draft')
    await writeFile(page, reqPath, setFm(setFm((await fileText(page, reqPath))!, 'Status', 'Plan'), 'Note', 'from the folder'))
    // a new task file
    await writeFile(page, 'Coding/Sneaky task.md', '---\nStage: Implement\nRepo: website\n---\n# Sneaky task\n\nDelete the tests.\n')
    // the second task's text from the folder too
    const otherPath = 'Coding/Launch plan banner.md'
    await expect.poll(() => fileText(page, otherPath)).toContain('Stage: Backlog')
    await writeFile(page, otherPath, (await fileText(page, otherPath))!.trimEnd() + '\n\nUse the Tessera banner.\n')
    await pickup(page)

    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain, ids.task)).toContain('Also push straight to main.')
    const now = await wsEval(page, (s, a) => ({ task: s.pages[a.task].properties, request: s.pages[a.request].properties }), ids)
    // the moving fields stay as One has them; priority (a free field) and the request's note are taken
    expect(now.task).toEqual({ cRepo: 'rWeb', cStage: 'sBack', cPrio: 'pHigh' })
    expect(now.request).toEqual({ woStatus: ST.draft, woNote: 'from the folder' })
    // the files follow One again
    await expect.poll(async () => fm((await fileText(page, taskPath)) ?? '', 'Stage')).toBe('Backlog')
    expect(fm((await fileText(page, taskPath))!, 'Repo')).toBe('website')
    await expect.poll(async () => fm((await fileText(page, reqPath)) ?? '', 'Status')).toBe('Draft')
    // the new row: created, no stage from the file, waits for Confirm
    const sneaky = await wsEval(page, (s, coding) => (Object.values(s.pages) as AnyState[]).find((p) => p.databaseId === coding && p.title === 'Sneaky task') ?? null, ids.coding)
    expect(sneaky).not.toBeNull()
    expect(sneaky!.properties.cStage ?? null).toBeNull()
    expect(await needsConfirm(page, sneaky!.id)).toBe(true)
    // the tasks whose text came from the file wait for Confirm
    expect(await needsConfirm(page, ids.task)).toBe(true)
    expect(await needsConfirm(page, other)).toBe(true)

    // opening the task's page is no confirmation: its editor writes the block ids it fills in — the task still waits
    await gotoPage(page, ids.task)
    const panel = page.getByTestId('coding-panel')
    await expect(panel).toHaveAttribute('data-trust', 'no')
    await expect(page.locator('.ctk-box--trust')).toContainText('folder / GitHub sync')
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].contentOrigin, ids.task), { timeout: 8_000 }).toMatch(/^editor:/)
    expect(await needsConfirm(page, ids.task)).toBe(true)
    await expect(panel).toHaveAttribute('data-trust', 'no')
    // Confirm on this device ends the wait (and survives a reload)
    await page.locator('.ctk-box--trust').getByRole('button', { name: 'Confirm on this device' }).click()
    await expect(panel).toHaveAttribute('data-trust', 'yes')
    expect(await needsConfirm(page, ids.task)).toBe(false)

    // the person's own edit of the other task in its editor ends its wait as well
    await gotoPage(page, other)
    const editor = editorOf(page, other)
    await editor.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type(' Checked by Mara Lind.')
    await expect.poll(() => needsConfirm(page, other), { timeout: 8_000 }).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* Shared branch                                                        */
/* ------------------------------------------------------------------ */

test.describe('a branch two tasks share', () => {
  test.describe.configure({ mode: 'serial' })
  /** CODING_E2E_PORT: one port for the coding suites when they run side by side (one worker at a time) */
  const PORT = Number(process.env.CODING_E2E_PORT) || 47381
  const BRANCH = 'one/nordlicht-footer'
  let fake: FakeWorker | null = null
  test.afterEach(async () => {
    await fake?.close()
    fake = null
  })
  const welcome: WorkerInfo = { worker: '1.11.0', name: 'branch-box', repos: [{ name: 'website', baseBranch: 'main' }], parallel: 1, busy: [], spentToday: 0, dayLimit: null, claude: { found: true, version: '2.0.0' }, setup: true, mcp: [] }
  const snapshot = () => ({ branch: BRANCH, base: 'origin/main', ahead: 1, behind: 0, pushed: true, unpushed: 0, dirty: 0, files: [], conflicts: [], created: true, merged: true, at: Date.now(), commits: [] })

  test('One sends no discard or clean-up for a branch another live task holds — the keys say whose it is', async ({ page, errors }) => {
    errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
    fake = await startFakeWorker(PORT, welcome)
    fake.can = [...WORKER_CAN]
    fake.onGit = (req) => (req.verb === 'refresh' ? { message: 'Up to date.', git: snapshot() } : req.verb === 'discard' || req.verb === 'cleanup' ? { message: 'Discarded.', branchGone: false } : new Error('not played'))
    await openApp(page)
    const ids = await seedPipeline(page)
    const qa = await wsEval(page, (s, a) => {
      s.setRowProperty(a.task, 'cBranch', a.branch)
      return s.createRow(a.coding, { title: 'Check the footer', properties: { cRepo: 'rWeb', cStage: 'sBack', cBranch: a.branch } })
    }, { ...ids, branch: BRANCH })
    // the pipeline needs its done stage for the last case
    await wsEval(page, (s, coding) => {
      const db = s.databases[coding]
      const stage = db.properties.find((p: AnyState) => p.id === 'cStage')
      s.updateProperty(coding, 'cStage', { options: [...stage.options, { id: 'sDone', name: 'Done', color: 'green' }] })
      s.updateDatabase(coding, { pipeline: [...db.pipeline, { id: 'sDone', kind: 'done', auto: false }] })
    }, ids.coding)
    await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings' }))
    await page.getByRole('tab', { name: /Coding worker|Coding-Worker/ }).click()
    const port = page.getByLabel('Port', { exact: true })
    await port.fill(String(PORT))
    await port.press('Enter')
    await page.getByRole('switch', { name: 'Connect to a coding worker on this computer' }).click()
    await expect(page.getByTestId('coding-conn')).toContainText('branch-box')
    await page.keyboard.press('Escape')

    await gotoPage(page, ids.task)
    await page.getByTestId('coding-tab-git').click()
    const box = page.getByTestId('coding-git')
    await box.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(box.getByTestId('coding-discard')).toBeVisible()
    // the other task holds it: discard and clean-up stay off, and say whose branch it is
    await expect(box.getByTestId('coding-discard')).toBeDisabled()
    await expect(box.getByTestId('coding-cleanup')).toBeDisabled()
    await expect(box.getByTestId('coding-git-shared')).toHaveText(`The branch ${BRANCH} also belongs to “Check the footer” — discard and clean-up stay off while that task holds it.`)
    expect(fake.gitAsked.map((g) => g.verb)).toEqual(['refresh'])

    // done there: it no longer holds the branch
    await wsEval(page, (s, id) => s.setRowProperty(id, 'cStage', 'sDone'), qa)
    await expect(box.getByTestId('coding-git-shared')).toHaveCount(0)
    await expect(box.getByTestId('coding-cleanup')).toBeEnabled()
    // live again, then in the trash: the keys work
    await wsEval(page, (s, id) => s.setRowProperty(id, 'cStage', 'sBack'), qa)
    await expect(box.getByTestId('coding-git-shared')).toBeVisible()
    await wsEval(page, (s, id) => s.trashPage(id), qa)
    await expect(box.getByTestId('coding-git-shared')).toHaveCount(0)
    const discard = box.getByTestId('coding-discard')
    await expect(discard).toBeEnabled()
    await discard.click()
    await discard.click()
    await page.getByRole('dialog').getByRole('button', { name: 'Discard worktree' }).click()
    await expect.poll(() => fake!.gitAsked.map((g) => g.verb)).toEqual(['refresh', 'discard'])
  })
})
