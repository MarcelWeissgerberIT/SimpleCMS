import { test, expect, openApp, wsEval, gotoPage } from './fixtures'
import {readFile} from 'node:fs/promises'
import { test as unit } from '@playwright/test'
import { mockClaudeScript } from './helpers/providers'
import { startFakeWorker } from './helpers/fakeWorker'
import { WORKER_CAN } from '../../src/app/features/coding/protocol'
import { acceptanceIssues, guidePhase, type GuidedEvidence } from '../../src/app/features/coding/orders/guidance'
import { readPlan, readStoredPlan, orderPlanHash } from '../../src/app/features/coding/orders/plan'
import { planKeyHits } from '../../src/app/features/coding/orders/keys'
import { readOrderRecord } from '../../src/app/features/coding/orders/record'

const delivery = { requirements: [{ id: 'R1', text: 'The simulator preserves a valid timeout.' }], acceptance: ['The regression check passes.'] }
const step = (kind: 'coding' | 'qa', needs: number[]) => ({ kind, title: kind === 'coding' ? 'Fix simulated timeout' : 'Verify combined change', goal: 'Demonstrate the timeout requirement.', criteria: ['Regression check passes'], repo: 'demo', branch: null, refs: [], priority: 'medium', why: 'Bounded work', needs, covers: ['R1'] })
const proposal = () => ({ v: 1, summary: 'A bounded simulator repair and final QA.', assumptions: ['Use a new branch and follow the existing test convention.'], delivery, context: null, steps: [step('coding', []), step('qa', [1])], questions: [], refused: null })
const ctx = { kinds: ['coding', 'qa'] as const, repos: [{ name: 'demo', base: 'main', branches: [] }], refs: [], titleOf: () => null, server: null }

unit('assumptions round-trip, affect exact confirmation and cannot carry secrets', async () => {
  const p = proposal(), parsed = readPlan(p, ctx)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) return
  expect(readStoredPlan(parsed.plan)?.assumptions).toEqual(p.assumptions)
  const resolved = p.steps.map(() => ({ project: 'project', park: 'park', start: 'ready' }))
  const before = await orderPlanHash(parsed.plan, resolved, 'none')
  expect(await orderPlanHash({ ...parsed.plan, assumptions: [] }, resolved, 'none')).not.toBe(before)
  expect(readPlan({ ...p, assumptions: Array(6).fill('Too many defaults') }, ctx).ok).toBe(false)
  p.assumptions = ['Never copy sk-ant-api03-' + 'a'.repeat(90)]
  expect(planKeyHits(p as never).some(h => h.field === 'assumptions')).toBe(true)
  expect(readPlan(p, ctx).ok).toBe(false)
  const scrubbed = readPlan(p, ctx, { scrub: true })
  expect(scrubbed.ok && JSON.stringify(scrubbed.plan)).not.toContain('a'.repeat(90))
})

unit('narrative success, skipped tests, changed sources and post-QA work never satisfy acceptance', () => {
  const good: GuidedEvidence = { state: 'done', contract: true, sourceChanged: false, steps: [
    { id: 'c', kind: 'coding', done: true, failed: false, skipped: false, test: null, qa: null, changedAt: 10 },
    { id: 'q', kind: 'qa', done: true, failed: false, skipped: false, test: { ok: true, code: 0 }, qa: { at: 20, branch: 'one/demo' }, changedAt: 20 },
  ] }
  expect(acceptanceIssues(good)).toEqual([])
  for (const [change, issue] of [
    [(x: GuidedEvidence) => { x.steps[1]!.qa = null }, 'qa'],
    [(x: GuidedEvidence) => { x.steps[1]!.test!.skipped = true }, 'checks'],
    [(x: GuidedEvidence) => { x.steps[1]!.test!.code = null }, 'checks'],
    [(x: GuidedEvidence) => { x.sourceChanged = true }, 'sources'],
    [(x: GuidedEvidence) => { x.steps[0]!.changedAt = 21 }, 'afterQa'],
    [(x: GuidedEvidence) => { x.steps[0]!.skipped = true }, 'skipped'],
  ] as const) { const x = structuredClone(good); change(x); expect(acceptanceIssues(x)).toContain(issue) }
  expect(guidePhase('running', false, 'qa')).toBe('verify')
  expect(readOrderRecord({ v: 1, state: 'draft', accepted: { run: 'x', at: 1, evidence: 'bad' } })?.accepted).toBeUndefined()
})

// Fictional provider and worker. The real browser planner, chain, claims, QA receipt and acceptance run end to end.
test('a guided goal runs through final QA and one human acceptance; Atlas is a draft and view can stay compact', async ({ page, errors }) => {
  test.setTimeout(120_000)
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  const port = 47866
  const fake = await startFakeWorker(port, { worker: '1.26.0', name: 'guide-fixture', repos: [{ name: 'demo', baseBranch: 'main', branches: ['main'], mcp: [] }], parallel: 1, busy: [], spentToday: 0, dayLimit: null, claude: { found: true, version: 'fixture' }, setup: true, mcp: [] })
  fake.can = [...WORKER_CAN]
  fake.auto = task => task.stage.kind === 'implement'
    ? { status: 'ok', summary: 'Fixed the simulated timeout.', branch: 'one/demo' }
    : { status: 'ok', plan: '{"status":"completed","summary":"Checked the combined branch.","next":""}', branch: 'one/demo', test: { ok: true, output: '1 regression passed', ms: 12, code: 0 } }
  const call = (name: string, ...args: unknown[]) => page.evaluate(([name, args]) => (window as any).__oneOrders[name](...args), [name, args] as const)
  try {
    await page.addInitScript(port => {
      localStorage.setItem('one.coding', JSON.stringify({ enabled: true, port }))
      localStorage.setItem('one.coding.approvals', 'none')
      localStorage.setItem('one.tour', '{"off":true}')
    }, port)
    const p = { ...proposal(), context: { server: 'atlas-fixture', note: 'Approved simulator requirement.', links: ['https://aj-atlas.com/r/123'] } }
    const mock = await mockClaudeScript(page.context(), [{ blocks: [{ type: 'mcp_tool_use', id: 'get1', server: 'atlas-fixture', name: 'atlas_get', input: { ref: 123 } }, { type: 'mcp_tool_result', id: 'get1', text: 'R1: preserve a valid timeout.' }, { type: 'text', text: JSON.stringify(p) }] }])
    await openApp(page)
    await wsEval(page, s => s.updateSettings({ language: 'en', aiApiKey: 'sk-ant-e2e-test-key', mcpServers: [{ id: 'atlasfixture', name: 'atlas-fixture', url: 'https://aj-atlas.com/mcp', token: 'fixture-token', enabled: true, prompt: 'Simulator requirements', tools: ['atlas_get'], checkedAt: 1 }] }))
    await expect.poll(() => page.evaluate(() => (window as any).__onePreflight.stores.coding.getState().conn)).toBe('connected')
    for (const kind of ['coding', 'qa']) {
      const seed = await page.evaluate(k => (window as any).__oneCodingWrites.create('seed', k, 'demo'), kind)
      await wsEval(page, (s, a) => {
        const dbId = s.pages[a.seed].databaseId
        const db = s.databases[dbId]
        const prop = db.properties.find((p: any) => p.name === 'Stage')
        const prefix = a.kind
        s.updateDatabase(dbId, { pipeline: [
          { id: `${prefix}Back`, kind: 'queue', auto: false },
          { id: `${prefix}Ready`, kind: 'queue', auto: true },
          { id: `${prefix}Run`, kind: a.kind === 'coding' ? 'implement' : 'doc', auto: true },
          { id: `${prefix}Done`, kind: 'done', auto: false },
        ], properties: db.properties.map((p: any) => p.id !== prop.id ? p : { ...p, options: [{ id: `${prefix}Back`, name: 'Backlog', color: 'gray' }, { id: `${prefix}Ready`, name: 'Ready', color: 'blue' }, { id: `${prefix}Run`, name: 'Work', color: 'orange' }, { id: `${prefix}Done`, name: 'Done', color: 'green' }] }) })
        s.deletePagePermanently(a.seed)
      }, { seed, kind })
    }
    const db = await page.evaluate(() => (window as any).__oneOrderEntries.ensure())
    await wsEval(page, (s, db) => s.updateDatabase(db, { orders: { ...s.databases[db].orders, server: { name: 'atlas-fixture' } } }), db)
    const row = await wsEval(page, (s, db) => s.createRow(db, {}), db)
    await gotoPage(page, row)
    await page.getByTestId('guided-goal').fill('Fix the simulated timeout in the demo repository and prove it with a regression test.')
    await page.getByTestId('guided-plan').click()
    await expect.poll(async () => { const r = await call('record', row); const run = await call('run', row); if (run?.phase === 'done' && run.outcome?.kind !== 'ready') throw new Error(JSON.stringify({run, requests: mock.requests.length})); return r?.draft?.plan?.steps?.length }).toBe(2)
    await expect(page.getByTestId('order-assumptions')).toContainText('Use a new branch')
    expect((await call('start', row)).ok).toBe(true)
    await call('startNow', row)
    await expect.poll(async () => (await call('record', row))?.state, { timeout: 40_000 }).toBe('done')
    const accept = page.getByTestId('guided-accept')
    await expect(accept).toBeEnabled()
    await accept.click()
    await expect(page.getByTestId('guided-next')).toContainText('Accepted by the person')
    await page.getByTestId('guided-order').screenshot({ path: test.info().outputPath('guided-acceptance.png') })
    const accepted = await call('record', row)
    expect(accepted.accepted.evidence).toMatch(/^[a-f0-9]{64}$/)
    const count = await wsEval(page, (s, row) => s.pages[row].content.content.filter((b: any) => b.attrs?.id?.includes('-accept-')).length, row)
    expect(count).toBe(1)
    await page.getByTestId('guided-atlas').click()
    await expect(page.locator('.term-prompt__input')).toHaveValue(/atlas-fixture: .*Prepare the handoff/s)
    await expect(page.locator('.term-prompt__input')).toHaveValue(/https:\/\/aj-atlas.com\/r\/123/)
    const parent=await wsEval(page,s=>s.createPage({title:'Shared workshop evidence'}))
    await page.getByTestId('packet-target').selectOption(parent)
    await page.getByTestId('packet-publish').click()
    const packetHref=await page.getByTestId('packet-link').getAttribute('href')
    const packetId=packetHref!.split('/').at(-1)!
    await page.getByTestId('packet-publish').click()
    expect(await wsEval(page,(s,parent)=>Object.values(s.pages).filter((p:any)=>p.parentId===parent).length,parent)).toBe(1)
    const packet=await wsEval(page,(s,id)=>s.pages[id],packetId)
    const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download evidence packet'}).click();const downloaded=await downloading
    const json=JSON.parse(await readFile((await downloaded.path())!,'utf8'));expect(json.kind).toBe('one-evidence-packet');expect(json.snapshot).toBe(accepted.accepted.evidence);expect(JSON.stringify(json)).not.toContain('fixture-token')
    const other=await page.context().browser()!.newContext({serviceWorkers:'block'});try{const second=await other.newPage();await openApp(second);await wsEval(second,(s,p)=>s.createPage({id:p.id,title:p.title,content:p.content}),packet);await gotoPage(second,packet.id);await expect(second.locator('.ProseMirror')).toContainText(accepted.accepted.evidence);expect(await second.locator('[data-testid=guided-order]').count()).toBe(0)}finally{await other.close()}

    expect(JSON.stringify(packet.content)).toContain('one-evidence-packet')
    expect(JSON.stringify(packet.content)).toContain(accepted.accepted.evidence)
    expect(JSON.stringify(packet.content)).not.toContain('fixture-token')
    await page.getByTestId('handoff-project').fill('wrong-project')
    await page.getByTestId('handoff-record').fill('123')
    fake.onModelMcp=()=>({result:JSON.stringify({item:{ref:123,project:'one-webserver',body:'ONE-EVIDENCE '+accepted.accepted.evidence}})})
    await page.getByTestId('handoff-verify').click()
    await expect(page.getByTestId('handoff-status')).toContainText('prepared')
    await page.getByTestId('handoff-project').fill('one-webserver')
    await page.getByTestId('handoff-verify').click()
    await expect(page.getByTestId('handoff-status')).toContainText('confirmed by readback')
    expect(fake.mcpAsked.every(r=>r.action==='call'&&r.name==='atlas_get')).toBe(true)
    expect(await wsEval(page,(s,id)=>JSON.stringify(s.pages[id].content),packetId)).toContain('https://aj-atlas.com/r/123')
    // The public packet remains readable without this device's private run or ability to execute it.
    await gotoPage(page,packetId)
    await expect(page.locator('.ProseMirror')).toContainText('confirmed')
    await gotoPage(page,row)
    expect(mock.requests).toHaveLength(1)
    await page.locator('.term-prompt__input').fill('Keep my existing draft')
    await page.getByTestId('guided-atlas').click()
    await expect(page.locator('.term-prompt__input')).toHaveValue('Keep my existing draft')
    // Evidence changes invalidate approval, and modified coding inputs require new QA.
    await wsEval(page, (s, id) => s.updatePage(id, { title: 'Changed work package after QA' }), accepted.chain.steps[0].id)
    await expect(accept).toBeDisabled()
    await expect(page.getByTestId('guided-acceptance')).toContainText('Run QA again')
    await page.getByTestId('guided-toggle').click()
    await page.reload()
    await expect(page.getByTestId('guided-toggle')).toHaveAttribute('aria-expanded', 'false')
    await page.getByTestId('guided-toggle').click()
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.getByTestId('guided-order').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  } finally { await fake.close() }
})
