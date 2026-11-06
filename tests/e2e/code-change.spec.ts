import { test, expect, wsEval } from './fixtures'
import { setup } from './helpers/codeChangeSetup'
import { mockAgent } from './helpers/terminal'
import { sha256Hex } from '../../src/shared/mcp/sha256'
const saved = (page: any, id: string) =>
  wsEval(
    page,
    (s, id) => {
      const n = s.pages[id].content.content.find((n: any) => n.attrs?.language === 'code-change')
      return n ? JSON.parse(n.content[0].text) : null
    },
    id,
  )
async function start(page: any) {
  const x = await setup(page, true)
  await x.block.getByRole('tab', { name: 'Findings', exact: true }).click()
  await x.block.getByRole('button', { name: 'Create change', exact: true }).click()
  const change = page.getByRole('region', { name: 'Code change', exact: true })
  await expect(change).toBeVisible()
  return { ...x, change }
}
async function load(page: any) {
  const x = await start(page)
  await x.change.getByRole('checkbox').check()
  await x.change.getByRole('button', { name: 'Load and save selected source ranges' }).click()
  await expect(x.change.getByLabel('Requested change')).toBeVisible()
  return x
}
test('finding creates a scoped block without reads; manual diff and acceptance reverify source', async ({ page }) => {
  const { id, change, calls } = await start(page)
  expect(calls).toHaveLength(0)
  await change.getByRole('checkbox').check()
  await change.getByRole('button', { name: 'Load and save selected source ranges' }).click()
  await expect(change.getByLabel('Replacement range')).toBeVisible()
  expect((await saved(page, id)).files[0].before).toEqual(['Validate(request);', 'InvokeDevice(request);'])
  await change.getByLabel('Replacement range').fill('Validate(request);\nInvokeDeviceWithTimeout(request);')
  await expect(change.locator('[data-kind=add]')).toContainText('InvokeDeviceWithTimeout')
  await change.getByRole('button', { name: 'Save edited proposal' }).click()
  expect((await saved(page, id)).proposals).toHaveLength(1)
  expect((await saved(page, id)).accepted).toBeNull()
  const count = calls.length
  await change.getByRole('button', { name: 'Verify sources and accept proposal' }).click()
  await expect.poll(async () => (await saved(page, id)).accepted).not.toBeNull()
  expect(calls.length).toBeGreaterThan(count)
  await change.getByLabel('Replacement range').fill('Validate(request);\nInvokeAnother(request);')
  await expect(change.getByRole('button', { name: 'Save code proposal in Atlas' })).toBeDisabled()
  await change.getByRole('button', { name: 'Save edited proposal' }).click()
  expect((await saved(page, id)).proposals).toHaveLength(2)
  expect((await saved(page, id)).accepted).toBe((await saved(page, id)).proposals[0].id)
})
test('One model receives pinned code with no tools and returns a proposal, never approval', async ({
  page,
  context,
}) => {
  const { id, change } = await load(page),
    mock = await mockAgent(context, [], {
      inspect: () =>
        JSON.stringify({
          reason: 'Bound device wait',
          checks: ['Run the timeout test'],
          edits: [{ file: 'file-0', after: ['Validate(request);', 'InvokeDeviceWithTimeout(request);'] }],
        }),
    })
  await change.getByLabel('Requested change').fill('Bound device wait.')
  await change.getByRole('button', { name: 'Draft with One model' }).click()
  await expect.poll(async () => (await saved(page, id)).proposals.length).toBe(1)
  const body = mock.checks[0]
  expect(body.tools ?? []).toHaveLength(0)
  expect(body.mcp_servers ?? []).toHaveLength(0)
  expect(JSON.stringify(body)).toContain('InvokeDevice(request)')
  expect((await saved(page, id)).accepted).toBeNull()
})
test('revoked source blocks model and acceptance without losing edits', async ({ page, context }) => {
  const { id, change } = await load(page)
  await change.getByLabel('Replacement range').fill('Validate(request);\nInvokeDeviceWithTimeout(request);')
  await change.getByRole('button', { name: 'Save edited proposal' }).click()
  await page.route('**/api/workspaces/*/atlas-mcp', (r) =>
    r.fulfill({ json: { result: JSON.stringify({ valid: false }) } }),
  )
  const mock = await mockAgent(context, [])
  await change.getByRole('button', { name: 'Verify sources and accept proposal' }).click()
  await expect(change.getByRole('alert')).toBeVisible()
  expect((await saved(page, id)).accepted).toBeNull()
  expect((await saved(page, id)).proposals).toHaveLength(1)
  expect(mock.checks).toHaveLength(0)
})
test('native Atlas save is exact and publication uses the separate human route', async ({ page }) => {
  const { id, change } = await load(page)
  await change.getByLabel('Replacement range').fill('Validate(request);\nInvokeDeviceWithTimeout(request);')
  await change.getByRole('button', { name: 'Save edited proposal' }).click()
  await change.getByRole('button', { name: 'Verify sources and accept proposal' }).click()
  await expect.poll(async () => (await saved(page, id)).accepted).not.toBeNull()
  let digest = ''
  await page.route('**/api/workspaces/*/atlas-mcp', async (r) => {
    const b = r.request().postDataJSON()
    if (b.name !== 'atlas_code_change_save') return r.fallback()
    digest = sha256Hex(b.arguments.package)
    return r.fulfill({
      json: {
        result: JSON.stringify({
          ok: true,
          change: 'remote-change',
          hash: digest,
          state: 'draft',
          publishConfigured: true,
          target: { url: 'https://gitlab.example.test', project: '1', branch: 'main', hash: 'a'.repeat(64) },
        }),
      },
    })
  })
  let publishes = 0
  await page.route('**/api/workspaces/*/atlas-code-change-publish', (r) => {
    publishes++
    const b = r.request().postDataJSON()
    expect(b.name).toBe('atlas_code_change_publish')
    expect(b.arguments.hash).toBe(digest)
    expect(b.arguments.targetHash).toBe('a'.repeat(64))
    return r.fulfill({
      json: {
        result: JSON.stringify({
          ok: true,
          change: 'remote-change',
          hash: digest,
          state: 'published',
          receipt: { url: 'https://gitlab.example.test/r/merge_requests/1' },
        }),
      },
    })
  })
  await change.getByRole('button', { name: 'Save code proposal in Atlas', exact: true }).click()
  await expect(change.getByRole('button', { name: 'Create branch and draft merge request' })).toBeEnabled()
  expect(publishes).toBe(0)
  await change.getByRole('button', { name: 'Create branch and draft merge request' }).click()
  await expect(change.getByRole('link', { name: 'Merge Request', exact: true })).toBeVisible()
  expect(publishes).toBe(1)
  expect((await saved(page, id)).remote[0].hash).toBe(digest)
})
test('page changes during model work reject late output', async ({ page, context }) => {
  const { id, change } = await load(page)
  let release!: () => void
  const pending = new Promise<void>((r) => (release = r))
  const mock = await mockAgent(context, [], {
    inspect: () => JSON.stringify({ reason: 'Update', checks: [], edits: [{ file: 'file-0', after: ['new'] }] }),
  })
  await context.route('https://api.anthropic.com/v1/messages*', async (r) => {
    await pending
    return r.fallback()
  })
  await change.getByLabel('Requested change').fill('Update')
  await change.getByRole('button', { name: 'Draft with One model' }).click()
  await expect(change).toContainText('Drafting the scoped change')
  await wsEval(page, (s, id) => s.updatePage(id, { title: 'Changed question' }), id)
  release()
  await expect(change.getByRole('alert')).toContainText('changed')
  expect((await saved(page, id)).proposals).toHaveLength(0)
})
test('change review is responsive in paper and carbon', async ({ page }, info) => {
  const { change } = await load(page)
  await change.getByLabel('Replacement range').fill('Validate(request);\nInvokeDeviceWithTimeout(request);')
  await change.getByRole('button', { name: 'Save edited proposal' }).click()
  for (const theme of ['light', 'dark'])
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await wsEval(page, (s, t) => s.updateSettings({ theme: t }), theme)
      await change.scrollIntoViewIfNeeded()
      expect(await change.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`change-${theme}-${width}.png`), animations: 'disabled' })
    }
})

test('another editor changing the same block prevents late replacement', async ({ page, context }) => {
  const { id, change } = await load(page)
  let release!: () => void
  const pending = new Promise<void>((r) => (release = r))
  await mockAgent(context, [], {
    inspect: () => JSON.stringify({ reason: 'Update', checks: [], edits: [{ file: 'file-0', after: ['new'] }] }),
  })
  await context.route('https://api.anthropic.com/v1/messages*', async (r) => {
    await pending
    return r.fallback()
  })
  await change.getByLabel('Requested change').fill('Update')
  await change.getByRole('button', { name: 'Draft with One model' }).click()
  await expect(change).toContainText('Drafting the scoped change')
  await page.locator('#main .pv-content .ProseMirror').evaluate((el:any)=>{
    const editor=el.editor;editor.state.doc.descendants((node:any,pos:number)=>{
      if(node.attrs?.language!=='code-change')return
      const a=JSON.parse(node.textContent);a.origin.title='Changed by another editor'
      editor.view.dispatch(editor.state.tr.replaceWith(pos,pos+node.nodeSize,editor.schema.nodes.codeBlock.create(node.attrs,editor.schema.text(JSON.stringify(a)))))
      return false
    })
  })
  await expect(change).toContainText('Changed by another editor')
  release()
  await expect(change).toContainText('Changed by another editor')
  await expect(change.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
  await expect.poll(async()=>(await saved(page,id)).origin.title).toBe('Changed by another editor')
  expect((await saved(page, id)).proposals).toHaveLength(0)
})
