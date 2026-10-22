import { readFileSync } from 'node:fs'
import { unzipSync, strFromU8 } from 'fflate'
import { inflateRawSync } from 'node:zlib'
import { ledger } from './helpers/aiFlows'
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect, openApp, createPage, gotoPage, editorOf, wsEval, doc, para, flush, MOD, sse, openExportDialog } from './fixtures'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const FLOW = 'flowchart LR\n  A["Requirement"] --> B["Decision"]\n  B --> C["Evidence"]'
const blocks = (page: Page, id: string) => wsEval(page, (s, id) => s.pages[id].content.content, id)
async function setup(page: Page) {
  await openApp(page)
  const id = await createPage(page, { title: 'Workshop flow', content: doc(para('A requirement needs a decision and tested evidence. CONTEXT_SENTINEL'), para('')) })
  await gotoPage(page, id)
  return id
}
async function openDrawing(page: Page, id: string) {
  await editorOf(page, id).locator('p').last().click()
  await page.keyboard.type('/handdrawn')
  await page.getByRole('option', { name: /Hand-drawn/ }).click()
  await expect(page.getByTestId('drawing-panel')).toBeVisible()
}
async function mockDiagram(context: BrowserContext, answer: (n: number) => string) {
  const bodies: any[] = []
  await context.route('https://api.anthropic.com/**', async r => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors })
    const body = r.request().postDataJSON()
    bodies.push(body)
    await r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ id: 'msg_sketch', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify({ code: answer(bodies.length) }) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 30, output_tokens: 30 } }) })
  })
  return bodies
}

function imageStream() {
  const blocks = [
    { type: 'mcp_tool_use', id: 'mcptoolu_draw', name: 'generate_image', server_name: 'studio', input: { prompt: 'sketch' } },
    { type: 'mcp_tool_result', tool_use_id: 'mcptoolu_draw', is_error: false, content: [{ type: 'text', text: JSON.stringify({ images: [{ url: 'https://drawing.e2e.test/sketch.png' }] }) }] },
    { type: 'text', text: 'One image.' },
  ]
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  let s = ev('message_start', { message: { id: 'msg_drawing', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 50, output_tokens: 1 } } })
  blocks.forEach((block, index) => { s += ev('content_block_start', { index, content_block: block }); s += ev('content_block_stop', { index }) })
  return s + ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 30 } }) + ev('message_stop', {})
}

test('manual sketch survives reload, stays editable, opens large, and inserts as one undo step', async ({ page }) => {
  const id = await setup(page)
  await openDrawing(page, id)
  const panel = page.getByTestId('drawing-panel')
  await expect(panel.locator('.mermaid-view__svg svg')).toBeVisible()
  await expect(panel.locator('.rough-node').first()).toBeVisible()
  await panel.getByText('Edit diagram data', { exact: true }).click()
  await page.getByTestId('drawing-code').fill(FLOW)
  await page.getByTestId('drawing-apply').click()
  await expect(panel).toHaveCount(0)
  await expect(editorOf(page).locator('.mermaid-view__svg svg')).toBeVisible()
  const saved = (await blocks(page, id)).find((n: any) => n.type === 'mermaid')
  expect(saved.attrs.code).toContain('look: handDrawn')
  expect(saved.attrs.drawing.style).toBe('one-sketch')
  await editorOf(page).click()
  await page.keyboard.press(`${MOD}+z`)
  await expect(editorOf(page).locator('.mermaid-view')).toHaveCount(0)
  await page.keyboard.press(`${MOD}+Shift+z`)
  await expect(page.getByTestId('drawing-edit')).toBeVisible()
  await flush(page)
  await page.reload()
  await expect(page.getByTestId('drawing-edit')).toBeVisible()
  await page.getByTestId('drawing-edit').click()
  await expect(page.getByTestId('drawing-code')).toHaveValue(FLOW)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByTestId('mermaid-open').click()
  await expect(page.getByTestId('diagram-viewer').locator('svg').first()).toBeVisible()
})

test('cancel changes no content; diagram cover keeps the original text', async ({ page }) => {
  const id = await setup(page)
  await openDrawing(page, id)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await blocks(page, id)).filter((n: any) => n.type !== 'paragraph')).toHaveLength(0)
  await openDrawing(page, id)
  await page.getByTestId('drawing-cover').click()
  await expect(page.locator('.pv-cover img')).toBeVisible()
  await expect.poll(() => page.locator('.pv-cover img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  expect((await blocks(page, id)).filter((n: any) => n.type !== 'paragraph')).toHaveLength(0)
  expect(await wsEval(page, (s, id) => s.pages[id].plain, id)).toContain('CONTEXT_SENTINEL')
})

test('AI preview is metered, page context is opt-in, and only apply writes a diagram', async ({ page, context }) => {
  const sent = await mockDiagram(context, () => FLOW)
  const id = await setup(page)
  await wsEval(page, s => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
  await openDrawing(page, id)
  await page.getByTestId('drawing-prompt').fill('Draw our flow')
  await page.getByTestId('drawing-generate').click()
  await expect(page.getByTestId('drawing-generate')).toBeEnabled()
  expect(sent.length).toBe(1)
  expect(JSON.stringify(sent[0])).not.toContain('CONTEXT_SENTINEL')
  expect((await blocks(page, id)).some((n: any) => n.type === 'mermaid')).toBe(false)
  await page.getByLabel('Use this page as context', { exact: true }).check()
  await page.getByTestId('drawing-generate').click()
  await expect(page.getByTestId('drawing-generate')).toBeEnabled()
  expect(JSON.stringify(sent.at(-1)).replaceAll('\\', '')).toContain('CONTEXT_SENTINEL')
  await expect.poll(async () => (await ledger(page)).filter(x => x.purpose === 'drawing.diagram').length).toBe(2)
  await page.getByTestId('drawing-apply').click()
  expect((await blocks(page, id)).find((n: any) => n.type === 'mermaid').attrs.drawing.prompt).toBe('Draw our flow')
})

test('invalid generated code gets one repair, and leaves the page intact on failure', async ({ page, context }) => {
  const sent = await mockDiagram(context, () => 'flowchart LR\n A[')
  const id = await setup(page)
  await wsEval(page, s => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
  await openDrawing(page, id)
  await page.getByTestId('drawing-prompt').fill('Sketch a flow')
  await page.getByTestId('drawing-generate').click()
  await expect(page.getByRole('alert')).toContainText('could not be read')
  expect(sent).toHaveLength(2)
  expect((await blocks(page, id)).some((n: any) => n.type === 'mermaid')).toBe(false)
})

test('illustration uses only selected MCP, keeps the prompt, and can become a cover', async ({ page, context }) => {
  const sent: any[] = []
  let imageHits = 0
  await context.route('https://api.anthropic.com/**', async r => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors })
    const b = r.request().postDataJSON(); sent.push(b)
    await r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: imageStream() })
  })
  await context.route('https://drawing.e2e.test/**', r => { imageHits++; return r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PNG }) })
  const id = await setup(page)
  await wsEval(page, s => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', mcpServers: [
    { id: 'srvstudio1', name: 'studio', url: 'https://mcp.studio.test/mcp', token: 'studio-e2e-token-0001', enabled: true, tools: ['generate_image'], checkedAt: 1 },
    { id: 'srvatlas11', name: 'atlas', url: 'https://atlas.e2e.test/mcp', enabled: true, tools: ['atlas_get'], checkedAt: 1 },
  ] }))
  await openDrawing(page, id)
  await page.getByTestId('drawing-mode-image').click()
  await expect(page.getByTestId('drawing-server').locator('option')).toHaveCount(1)
  await page.getByTestId('drawing-prompt').fill('Marcel coaches the team')
  await page.getByTestId('drawing-generate').click()
  await expect(page.getByTestId('media-card')).toBeVisible()
  expect(imageHits).toBe(0)
  await page.getByTestId('media-save').click()
  await expect(page.locator('.drawing__preview')).toBeVisible()
  expect(JSON.stringify(sent)).toContain('orange #FF4F00')
  expect(JSON.stringify(sent)).not.toContain('CONTEXT_SENTINEL')
  expect(sent.at(-1).mcp_servers.map((s: any) => s.name)).toEqual(['studio'])
  expect((await blocks(page, id)).some((n: any) => n.type === 'image')).toBe(false)
  await page.getByTestId('drawing-apply').click()
  await expect(editorOf(page).locator('figure.image-view img')).toBeVisible()
  const image = (await blocks(page, id)).find((n: any) => n.type === 'image')
  expect(image.attrs.src).toMatch(/^onefile:/)
  expect(image.attrs.drawing.prompt).toBe('Marcel coaches the team')
  await page.getByTestId('drawing-edit').click()
  await expect(page.getByTestId('drawing-prompt')).toHaveValue('Marcel coaches the team')
  await page.getByTestId('drawing-cover').click()
  await expect(page.locator('.pv-cover img')).toBeVisible()
})

test('German mobile picker fits and missing image service is actionable', async ({ page }) => {
  const id = await setup(page)
  await wsEval(page, s => s.updateSettings({ language: 'de' }))
  await page.setViewportSize({ width: 390, height: 844 })
  await editorOf(page, id).locator('p').last().click()
  await page.keyboard.type('/handdrawn')
  await page.getByRole('option', { name: /Handgezeichnet/ }).click()
  await page.getByTestId('drawing-mode-image').click()
  await expect(page.getByRole('button', { name: 'Bilddienst verbinden', exact: true })).toBeVisible()
  await expect(page.getByTestId('drawing-generate')).toBeDisabled()
  expect(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
})


test('reference is described before generation; original pixels never enter the image tool prompt', async ({ page, context }) => {
  const sent: any[] = []
  await context.route('https://api.anthropic.com/**', async r => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors })
    const b = r.request().postDataJSON(); sent.push(b)
    const vision = JSON.stringify(b.messages).includes('"type":"image"')
    await r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: vision ? sse('Short hair, trimmed beard, dark blazer, open white shirt.') : imageStream() })
  })
  const id = await setup(page)
  await wsEval(page, s => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', mcpServers: [{ id: 'srvstudio1', name: 'studio', url: 'https://mcp.studio.test/mcp', token: 'studio-e2e-token-0001', enabled: true, tools: ['generate_image'], checkedAt: 1 }] }))
  await openDrawing(page, id)
  await page.getByTestId('drawing-mode-image').click()
  const file = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Add reference image', exact: true }).click()
  await (await file).setFiles({ name: 'reference.png', mimeType: 'image/png', buffer: PNG })
  await expect(page.locator('.drawing__reference img')).toBeVisible()
  await page.getByTestId('drawing-prompt').fill('Illustrate this coach')
  await page.getByTestId('drawing-generate').click()
  await expect(page.getByTestId('media-card')).toBeVisible()
  expect(sent).toHaveLength(2)
  expect(JSON.stringify(sent[0].messages)).toContain('"type":"image"')
  expect(JSON.stringify(sent[1].messages)).toContain('trimmed beard')
  expect(JSON.stringify(sent[1].messages)).not.toContain(PNG.toString('base64'))
  expect((await blocks(page, id)).some((n: any) => n.type === 'image')).toBe(false)
})

test('editing refuses to overwrite a block changed by another collaborator', async ({ page }) => {
  const id = await setup(page)
  await openDrawing(page, id)
  await page.getByTestId('drawing-apply').click()
  await page.getByTestId('drawing-edit').click()
  await wsEval(page, (s, id) => {
    const doc = JSON.parse(JSON.stringify(s.pages[id].content))
    const drawing = doc.content.find((n: any) => n.type === 'mermaid')
    drawing.attrs.code = 'flowchart LR\n X["Collaborator changed this"] --> Y["Keep it"]'
    s.setContent(id, doc, 'e2e')
  }, id)
  await page.getByTestId('drawing-apply').click()
  await expect(page.getByRole('alert')).toContainText('original block changed')
  expect((await blocks(page, id)).find((n: any) => n.type === 'mermaid').attrs.code).toContain('Collaborator changed this')
})


test('share links preserve the drawing while omitting its private brief and portrait reference', async ({ page }) => {
  const id = await setup(page)
  await openDrawing(page, id)
  await page.getByTestId('drawing-apply').click()
  await wsEval(page, (s, id) => {
    const content = JSON.parse(JSON.stringify(s.pages[id].content))
    const drawing = content.content.find((n: any) => n.type === 'mermaid')
    drawing.attrs.drawing.prompt = 'PRIVATE_DRAWING_BRIEF'
    drawing.attrs.drawing.reference = 'onefile:privateportrait1'
    s.setContent(id, content, 'e2e')
  }, id)
  await flush(page)
  await page.locator('.tb').getByRole('button', { name: 'Share', exact: true }).click()
  const field = page.getByRole('dialog').getByRole('textbox', { name: 'Share link' })
  await expect(field).not.toHaveValue('')
  const link = await field.inputValue()
  const payload = inflateRawSync(Buffer.from(link.split('#/s/')[1], 'base64url')).toString()
  expect(payload).toContain('look: handDrawn')
  expect(payload).not.toContain('PRIVATE_DRAWING_BRIEF')
  expect(payload).not.toContain('privateportrait1')
  expect(payload).not.toContain('"drawing"')
})


test('Markdown export omits the private reference file, while workspace backup retains it', async ({ page }, testInfo) => {
  const id = await setup(page)
  await openDrawing(page, id)
  await page.getByTestId('drawing-apply').click()
  const reference = await page.evaluate(async png => {
    const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0))
    return (window as any).__one.files.saveFile(new Blob([bytes], { type: 'image/png' }), 'private-portrait.png')
  }, PNG.toString('base64'))
  await wsEval(page, (s, input) => {
    const content = JSON.parse(JSON.stringify(s.pages[input.id].content))
    const drawing = content.content.find((n: any) => n.type === 'mermaid')
    drawing.attrs.drawing.prompt = 'PRIVATE_DRAWING_BRIEF'
    drawing.attrs.drawing.reference = input.reference
    s.setContent(input.id, content, 'e2e')
  }, { id, reference })
  await flush(page)
  let dialog = await openExportDialog(page)
  await dialog.getByRole('radio', { name: /Markdown folder/ }).click()
  let download = page.waitForEvent('download')
  await dialog.locator('[data-export-run]').click()
  let file = await download
  const markdownPath = testInfo.outputPath('drawing-markdown.zip')
  await file.saveAs(markdownPath)
  const archive = unzipSync(readFileSync(markdownPath))
  expect(Object.keys(archive).some(name => /private-portrait|\.png$/i.test(name))).toBe(false)
  expect(Object.values(archive).map(strFromU8).join('')).not.toContain('PRIVATE_DRAWING_BRIEF')
  await page.keyboard.press('Escape')
  dialog = await openExportDialog(page)
  await dialog.getByRole('radio', { name: /Full backup/ }).click()
  download = page.waitForEvent('download')
  await dialog.locator('[data-export-run]').click()
  file = await download
  const backupPath = testInfo.outputPath('drawing-backup.json')
  await file.saveAs(backupPath)
  const backup = readFileSync(backupPath, 'utf8')
  expect(backup).toContain('PRIVATE_DRAWING_BRIEF')
  expect(backup).toContain('private-portrait.png')
})
