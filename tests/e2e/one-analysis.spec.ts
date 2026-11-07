import { test, expect, openApp, wsEval } from './fixtures'
import { mockAgent, call, say, setKey } from './helpers/terminal'
import { startFakeWorker } from './helpers/fakeWorker'
import { WORKER_CAN } from '../../src/app/features/coding/protocol'
import type { Page } from '@playwright/test'

async function setup(page: Page) {
  await page.route('**/api/config', r => r.fulfill({ json: { schema_min: 6 } }))
  await page.route('**/api/session', r => r.fulfill({ json: {} }))
  await openApp(page)
  await setKey(page)
  await page.evaluate(() => { location.hash = '#/coding/spec' })
  await expect.poll(() => page.evaluate(() => !!(window as any).__oneCodingWrites)).toBe(true)
  const id = await page.evaluate(() => (window as any).__oneCodingWrites.create('Document analysis without worker', 'spec')) as string
  await page.evaluate(id => { location.hash = `#/p/${id}` }, id)
  await expect(page.getByTestId('one-analysis-controls')).toBeVisible()
  return id
}

test('One executes document stages, waits for approval and saves the final document without a worker', async ({ page, context }) => {
  const id = await setup(page)
  const mock = await mockAgent(context, [call('read1', 'read_page', { id }), say('## Analysis\nObserved requirements from the task.'), call('read2', 'read_page', { id }), say('## Specification\nThe application shall display the approved document.'), call('read3', 'read_page', { id }), say('## Recorded\nThe reviewed specification is recorded.')])
  await expect(page.getByTestId('coding-offline')).toHaveCount(0)
  await page.getByTestId('coding-run').click()
  await expect(page.getByTestId('coding-approve')).toBeVisible({ timeout: 40_000 })
  expect(mock.bodies).toHaveLength(4)
  await page.screenshot({ path: '.shots/one-model-analysis-gate.png', fullPage: false })
  expect(mock.bodies.flatMap(b => b.tools ?? []).some((t: any) => ['edit_page','create_page','run_query'].includes(t.name))).toBe(false)
  const before = await wsEval(page, (s, id) => s.pages[id].plain, id)
  expect(before).toContain('Observed requirements')
  expect(before).toContain('application shall')
  await page.getByTestId('coding-approve').click()
  await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain, id)).toContain('reviewed specification is recorded')
  expect(mock.bodies).toHaveLength(6)
  await expect(page.getByTestId('coding-stop')).toHaveCount(0)
})

test('a task edited during an answer is not advanced or overwritten', async ({ page, context }) => {
  const id = await setup(page)
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  const mock = await mockAgent(context, [call('read', 'read_page', { id }), async () => { await waiting; return say('STALE GENERATED DOCUMENT')() }])
  await page.getByTestId('coding-run').click()
  await expect.poll(() => mock.bodies.length).toBe(2)
  await wsEval(page, (s, id) => s.updatePage(id, { title: 'Edited while running' }), id)
  release()
  await expect(page.getByTestId('coding-stop')).toHaveCount(0)
  await expect(page.getByTestId('coding-approve')).toHaveCount(0)
  expect(await wsEval(page, (s, id) => s.pages[id].plain, id)).not.toContain('STALE GENERATED DOCUMENT')
  await expect(page.locator('.ctk')).toContainText('Task or sources changed')
})

test('stop aborts the model and keeps the stage open', async ({ page, context }) => {
  const id = await setup(page)
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  const mock = await mockAgent(context, [call('read', 'read_page', { id }), async () => { await waiting; return say('LATE RESULT')() }])
  await page.getByTestId('coding-run').click()
  await expect.poll(() => mock.bodies.length).toBe(2)
  await page.getByTestId('coding-stop').click()
  release()
  await expect(page.getByTestId('coding-stop')).toHaveCount(0)
  await expect(page.getByTestId('coding-approve')).toHaveCount(0)
  expect(await wsEval(page, (s, id) => s.pages[id].plain, id)).not.toContain('LATE RESULT')
})

test('an answer without reading the task remains a failed draft', async ({ page, context }) => {
  const id = await setup(page)
  await mockAgent(context, [say('UNSOURCED DOCUMENT')])
  await page.getByTestId('coding-run').click()
  await expect(page.locator('.ctk')).toContainText('Source check:')
  await expect(page.getByTestId('coding-approve')).toHaveCount(0)
  expect(await wsEval(page, (s, id) => s.pages[id].plain, id)).not.toContain('UNSOURCED DOCUMENT')
})

test('worker mode remains available and never sends a model request', async ({ page, aiNet }) => {
  await setup(page)
  await page.getByLabel('Execution', { exact: true }).selectOption('worker')
  await expect(page.getByTestId('coding-offline')).toBeVisible()
  await page.getByTestId('coding-run').click()
  expect(aiNet.count('anthropic')).toBe(0)
})

test('the pipeline step limit stops the model without completing a stage', async ({ page, context }) => {
  const id = await setup(page)
  await wsEval(page, (s, id) => {
    const db = s.databases[s.pages[id].databaseId]
    s.updateDatabase(db.id, { pipeline: db.pipeline.map((p: any) => ({ ...p, maxTurns: 1 })) })
  }, id)
  const mock = await mockAgent(context, [call('read', 'read_page', { id }), say('SHOULD NOT RUN')])
  await page.getByTestId('coding-run').click()
  await expect(page.locator('.ctk')).toContainText('Analysis incomplete')
  expect(mock.bodies).toHaveLength(1)
  await expect(page.getByTestId('coding-approve')).toHaveCount(0)
})

test('a changed pipeline keeps the execution selector available to return to the worker', async ({ page }) => {
  const id = await setup(page)
  await page.getByLabel('Execution', { exact: true }).selectOption('worker')
  await page.getByLabel('Execution', { exact: true }).selectOption('one')
  await wsEval(page, (s, id) => {
    const db = s.databases[s.pages[id].databaseId]
    s.updateDatabase(db.id, { pipeline: db.pipeline.map((p: any) => p.kind === 'doc' ? { ...p, kind: 'analyze' } : p) })
  }, id)
  await expect(page.getByLabel('Execution', { exact: true })).toHaveValue('one')
  await page.getByLabel('Execution', { exact: true }).selectOption('worker')
  await expect(page.getByTestId('coding-offline')).toBeVisible()
})


test('document stages can use read One sources while Atlas is connected but optional', async ({ page, context }) => {
  const fake = await startFakeWorker(47512, { worker: '1.35.3', name: 'mcp-read-fixture', repos: [], parallel: 1, busy: [], spentToday: 0, dayLimit: null, claude: { found: false, version: null }, setup: true })
  fake.can = [...WORKER_CAN]
  try {
    const id = await setup(page)
    await page.evaluate(() => (window as any).__one.ui.getState().openModal({ type: 'settings' }))
    await page.getByRole('tab', { name: /Coding worker/ }).click()
    await page.getByLabel('Port', { exact: true }).fill('47512')
    await page.getByLabel('Port', { exact: true }).press('Enter')
    await page.getByRole('switch', { name: 'Connect to a coding worker on this computer' }).click()
    await expect(page.getByTestId('coding-conn')).toContainText('mcp-read-fixture')
    await page.keyboard.press('Escape')
    await page.getByLabel('Execution', { exact: true }).selectOption('one')
    await wsEval(page, s => s.updateSettings({ mcpServers: [{ id: 'atlas-docs', name: 'atlas', url: 'https://atlas.example.com/mcp', token: '', enabled: true, prompt: '', tools: ['atlas_get'], checkedAt: Date.now() }] }))
    const mock = await mockAgent(context, [call('a', 'read_page', { id }), say('## Analysis\nObserved from the One task.'), call('b', 'read_page', { id }), say('## Specification\nRequirements derived from the saved analysis.')])
    await page.getByTestId('coding-run').click()
    await expect(page.getByTestId('coding-approve')).toBeVisible({ timeout: 20_000 })
    expect(mock.bodies).toHaveLength(4)
    expect(JSON.stringify(mock.bodies[0].tools)).toContain('one_mcp_search')
    expect(await wsEval(page, (s, id) => s.pages[id].plain, id)).toContain('Requirements derived from the saved analysis')
    expect(fake.mcpAsked).toHaveLength(0)
  } finally { await fake.close() }
})


test('retry resumes failed specification and retains the completed analysis', async ({ page, context }) => {
  const id = await setup(page)
  const mock = await mockAgent(context, [call('analysis', 'read_page', { id }), say('## Analysis\nPRESERVED ANALYSIS'), say('UNSOURCED SPECIFICATION'), call('retry-spec', 'read_page', { id }), say('## Specification\nREVIEWABLE SPECIFICATION')])
  await page.getByTestId('coding-run').click()
  await expect(page.locator('.ctk')).toContainText('Source check:')
  expect(mock.bodies).toHaveLength(3)
  const receipt = await page.evaluate(async id => {
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('one-coding');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})
    try{return await new Promise<any>((resolve,reject)=>{const r=db.transaction('kv').objectStore('kv').get('local:local|task|'+id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}finally{db.close()}
  },id)
  expect(receipt.stageRuns.map((r:any)=>r.status)).toEqual(['ok','failed'])
  expect(receipt.stageRuns[1].receipt.costUsd).toBeGreaterThan(0)
  expect(receipt.spentUsd).toBeCloseTo(receipt.stageRuns.reduce((n:number,r:any)=>n+r.receipt.costUsd,0),4)
  expect(receipt.analysisMissing).toContain(id)
  expect(await wsEval(page, (s, id) => s.pages[id].plain, id)).toContain('PRESERVED ANALYSIS')
  expect(await wsEval(page, (s, id) => s.pages[id].plain, id)).not.toContain('UNSOURCED SPECIFICATION')
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByTestId('coding-approve')).toBeVisible()
  expect(mock.bodies).toHaveLength(5)
  const document = await wsEval(page, (s, id) => s.pages[id].plain, id)
  expect(document.match(/PRESERVED ANALYSIS/g)).toHaveLength(1)
  expect(document).toContain('REVIEWABLE SPECIFICATION')
})


test('editor block IDs added during a model request do not invalidate unchanged sources', async ({ page, context }) => {
  const id = await setup(page)
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  const mock = await mockAgent(context, [async () => { await waiting; return call('after-ids', 'read_page', { id })() }, say('## Analysis\nUNCHANGED SOURCE'), call('spec', 'read_page', { id }), say('## Specification\nREVIEWABLE AFTER EDITOR NORMALIZATION')])
  await page.getByTestId('coding-run').click()
  await expect.poll(() => mock.bodies.length).toBe(1)
  await wsEval(page, (s, id) => {
    const content = structuredClone(s.pages[id].content)
    content.content[0].attrs = { ...content.content[0].attrs, id: 'editor-assigned-block-id' }
    s.setContent(id, content, 'editor:normalization')
  }, id)
  release()
  await expect(page.getByTestId('coding-approve')).toBeVisible()
  expect(await wsEval(page, (s, id) => s.pages[id].plain, id)).toContain('REVIEWABLE AFTER EDITOR NORMALIZATION')
})


test('a real text edit still invalidates the source snapshot', async ({ page, context }) => {
  const id = await setup(page)
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  const mock = await mockAgent(context, [call('read-before-edit', 'read_page', { id }), async () => { await waiting; return say('STALE SPECIFICATION')() }])
  await page.getByTestId('coding-run').click()
  await expect.poll(() => mock.bodies.length).toBe(2)
  await wsEval(page, (s, id) => {
    const content = structuredClone(s.pages[id].content)
    content.content.push({ type: 'paragraph', content: [{ type: 'text', text: 'NEW REQUIREMENT FROM USER' }] })
    s.setContent(id, content, 'editor:typing')
  }, id)
  release()
  await expect(page.locator('.ctk')).toContainText('Task or sources changed')
  const document = await wsEval(page, (s, id) => s.pages[id].plain, id)
  expect(document).toContain('NEW REQUIREMENT FROM USER')
  expect(document).not.toContain('STALE SPECIFICATION')
  await expect(page.getByTestId('coding-approve')).toHaveCount(0)
})

test('a saved interrupted stage settles its known cost once and resumes under the browser lock',async({page,context})=>{
 const id=await setup(page)
 // Simulate the durable receipt left by a closed tab before its completion handler.
 await page.evaluate(async id=>{
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('one-coding');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})
  const key='local:local|task|'+id
  try{
   const value=await new Promise<any>(resolve=>{const r=db.transaction('kv').objectStore('kv').get(key);r.onsuccess=()=>resolve(r.result)})
   const row=(window as any).__one.workspace.getState().pages[id],database=(window as any).__one.workspace.getState().databases[row.databaseId]
   const stage=database.properties.find((p:any)=>/stage/i.test(p.name)),stageId=row.properties[stage.id]
   await new Promise<void>((resolve,reject)=>{const tx=db.transaction('kv','readwrite');tx.objectStore('kv').put({...value,execution:'one',state:'running',run:'interrupted-run',stageId,analysisCheckpoint:{run:'interrupted-run',stageId,stage:'Interrupted stage',cost:.25,turns:2,at:Date.now()},at:Date.now()},key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})
  }finally{db.close()}
 },id)
 await page.reload();await expect(page.getByTestId('one-analysis-controls')).toBeVisible()
 await mockAgent(context,[call('read1','read_page',{id}),say('## Analysis\nResumed with fresh sources.'),call('read2','read_page',{id}),say('## Specification\nFresh specification.')])
 await page.getByTestId('coding-run').click();await expect(page.getByTestId('coding-approve')).toBeVisible()
 const receipt=await page.evaluate(async id=>{
  const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('one-coding');r.onsuccess=()=>resolve(r.result)})
  try{return await new Promise<any>(resolve=>{const r=db.transaction('kv').objectStore('kv').get('local:local|task|'+id);r.onsuccess=()=>resolve(r.result)})}finally{db.close()}
 },id)
 expect(receipt.stageRuns.filter((r:any)=>r.run==='interrupted-run')).toHaveLength(1)
 expect(receipt.spentUsd).toBeGreaterThan(.25)
 expect(receipt.analysisCheckpoint).toBeNull()
})
