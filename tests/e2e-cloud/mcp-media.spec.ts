/**
 * "Fetch through the team server" (features/ai/media → POST /api/workspaces/:id/files/fetch): media an MCP server
 * returned that the member's browser may not load (CORS). The browser's own fetch of the made-up media host is
 * refused here (routed to a network error, like a host without CORS headers); the server reaches the same name
 * through MEDIA_FETCH_HOSTS (DEV_MODE only, playwright.cloud.config.ts) — a local fixture this spec serves.
 * api.anthropic.com is never called (routed to a canned stream with mcp_tool_use / mcp_tool_result blocks).
 */
import { createServer, type Server } from 'node:http'
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect, email, signIn, openApp, wsEval, waitOnline, gotoPage, editorOf, createWorkspace, api, newPerson, join } from './fixtures'

/** a real 1×1 PNG */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const HOST = 'https://media.e2e.test'
/** where the fixture listens: the config maps media.e2e.test to PORT + 1000 */
const mediaPort = () => Number(new URL(String(test.info().project.use.baseURL)).port) + 1000

let fixture: Server | null = null
const hits: string[] = []

test.beforeAll(async () => {
  fixture = createServer((req, res) => {
    hits.push(req.url ?? '')
    if (req.url === '/out/lantern.png') {
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(PNG.length) })
      return res.end(PNG)
    }
    if (req.url === '/out/to-loopback.png') {
      res.writeHead(302, { location: 'https://127.0.0.1/out/lantern.png' })
      return res.end()
    }
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('no')
  })
  await new Promise<void>((resolve) => fixture!.listen(mediaPort(), '127.0.0.1', resolve))
})

test.afterAll(async () => {
  await new Promise<void>((resolve) => (fixture ? fixture.close(() => resolve()) : resolve()))
})

/* Claude API mock: one streamed answer with an image service's result */

function sse(blocks: Array<{ type: 'text'; text: string } | { type: 'mcp_tool_use'; id: string; server: string; name: string; input: object } | { type: 'mcp_tool_result'; id: string; text: string }>): string {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  let body = ev('message_start', { message: { id: 'msg_media_cloud', type: 'message', role: 'assistant', model: 'e2e-mock', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 1 } } })
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      body += ev('content_block_start', { index, content_block: { type: 'text', text: '' } })
      body += ev('content_block_delta', { index, delta: { type: 'text_delta', text: b.text } })
    } else if (b.type === 'mcp_tool_use') {
      body += ev('content_block_start', { index, content_block: { type: 'mcp_tool_use', id: b.id, name: b.name, server_name: b.server, input: {} } })
      body += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } })
    } else {
      body += ev('content_block_start', { index, content_block: { type: 'mcp_tool_result', tool_use_id: b.id, is_error: false, content: [{ type: 'text', text: b.text }] } })
    }
    body += ev('content_block_stop', { index })
  })
  body += ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } })
  return body + ev('message_stop', {})
}

const RESULT = JSON.stringify({ status: 'completed', images: [{ url: `${HOST}/out/lantern.png` }, { url: 'https://10.0.0.5/out/secret.png' }] })

async function mockClaude(ctx: BrowserContext) {
  await ctx.route('https://api.anthropic.com/**', (route) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (req.method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [], has_more: false }) })
    const body = JSON.parse(req.postData() ?? '{}')
    if (!body.stream) {
      const text = 'TOOLS: generate_image, get_job\n---\nMakes images.'
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ id: 'msg_x', type: 'message', role: 'assistant', model: 'e2e-mock', content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }) })
    }
    return route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'text/event-stream' },
      body: sse([
        { type: 'mcp_tool_use', id: 'mcptoolu_c1', server: 'studio', name: 'generate_image', input: { prompt: 'a paper lantern on a desk' } },
        { type: 'mcp_tool_result', id: 'mcptoolu_c1', text: RESULT },
        { type: 'text', text: 'Here is the lantern.' },
      ]),
    })
  })
  // this browser may not read either file (a host without CORS headers fails exactly like this)
  const browserHits: string[] = []
  for (const host of [`${HOST}/**`, 'https://10.0.0.5/**']) {
    await ctx.route(host, (route) => {
      browserHits.push(route.request().url())
      return route.abort('failed')
    })
  }
  return browserHits
}

const studio = { id: 'srvstudio1', name: 'studio', url: 'https://mcp.studio.test/mcp', token: '', enabled: true, prompt: 'Makes images.', promptSource: 'auto', tools: ['generate_image', 'get_job'], checkedAt: 1 }

const errors: string[] = []
test.beforeEach(() => {
  errors.length = 0
  hits.length = 0
})
test.afterEach(() => {
  expect.soft(errors, 'browser errors').toEqual([])
})

function watchErrors(page: Page) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const text = m.text()
    // the refused fetches (network error by design) and the server's 400 for the blocked address
    if (/ERR_FAILED|Failed to load resource/.test(text)) return
    errors.push(`console.error: ${text}`)
  })
}

test.describe('team cloud — media from MCP servers', () => {
  test('the browser is refused (CORS): "Fetch through the team server" stores the file in the workspace and inserts it; a private address is refused', async ({ page, context }) => {
    watchErrors(page)
    const browserHits = await mockClaude(context)
    await signIn(page, email('mira'))
    const wsId = await createWorkspace(page, 'Media team')
    await openApp(page, wsId)
    await waitOnline(page)
    await wsEval(page, (s, list) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', mcpServers: list }), [studio])
    const id = await wsEval(page, (s) => {
      const id = s.createPage({ title: 'Lantern board' })
      s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Pictures for the window.' }] }, { type: 'paragraph' }] }, 'import')
      return id as string
    })
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
    await ask.fill('studio: a paper lantern on a desk')
    await ask.press('Enter')
    const panel = page.getByRole('dialog', { name: 'Ask Claude' })
    await expect(panel.locator('.ai-out__body')).toContainText('Here is the lantern')
    const lantern = panel.locator('[data-testid="media-card"][data-url$="lantern.png"]')
    const secret = panel.locator('[data-testid="media-card"][data-url$="secret.png"]')
    await expect(lantern).toBeVisible()
    // nothing loaded by itself — not by the browser, not by the server
    expect(browserHits).toEqual([])
    expect(hits).toEqual([])

    // this browser is refused: said plainly, Open + Upload a copy + the team server
    await lantern.getByTestId('media-save').click()
    await expect(lantern.locator('[data-issue="cors"]')).toBeVisible()
    await expect(lantern.getByTestId('media-open')).toBeVisible()
    await expect(lantern.getByTestId('media-upload')).toBeVisible()
    expect(hits).toEqual([])

    const fetchReq = page.waitForRequest((r) => r.url().endsWith(`/api/workspaces/${wsId}/files/fetch`))
    await lantern.getByTestId('media-team').click()
    expect((await fetchReq).postDataJSON()).toEqual({ url: `${HOST}/out/lantern.png`, kind: 'image' })
    await expect(lantern.getByTestId('media-saved')).toBeVisible()
    expect(hits).toEqual(['/out/lantern.png'])

    // an image block with the workspace file; the file is served back byte for byte
    const attrs = async () => wsEval(page, (s, id) => (s.pages[id].content.content ?? []).filter((b: { type: string }) => b.type === 'image').map((b: { attrs: Record<string, unknown> }) => b.attrs), id)
    await expect.poll(async () => (await attrs()).length).toBe(1)
    const [img] = await attrs()
    expect(String(img.src)).toMatch(/^onefile:[\w-]+$/)
    expect(img.caption).toBe('a paper lantern on a desk — STUDIO')
    const fileId = String(img.src).slice('onefile:'.length)
    const bytes = await page.evaluate(async (path) => {
      const res = await fetch(path, { credentials: 'same-origin' })
      return { status: res.status, type: res.headers.get('content-type'), body: Array.from(new Uint8Array(await res.arrayBuffer())) }
    }, `/api/workspaces/${wsId}/files/${fileId}`)
    expect(bytes.status).toBe(200)
    expect(bytes.type).toBe('image/png')
    expect(Buffer.from(bytes.body).equals(PNG)).toBe(true)
    await expect(ed.locator('img')).toHaveCount(1)

    // a private address: the browser is refused, and the server does not fetch it either
    await secret.getByTestId('media-save').click()
    await expect(secret.getByTestId('media-team')).toBeVisible()
    await secret.getByTestId('media-team').click()
    await expect(secret.locator('[data-issue="blocked"]')).toContainText('does not fetch this address')
    expect(hits).toEqual(['/out/lantern.png'])
    await expect.poll(async () => (await attrs()).length).toBe(1)
  })

  test('the SSRF guard: loopback, 10.x, 169.254 and local names refused — also as a redirect target; members only', async ({ page, context }) => {
    watchErrors(page)
    await signIn(page, email('ines'))
    const wsId = await createWorkspace(page, 'Guarded team')
    const fetchUrl = (p: Page, url: string) => api<{ error?: { code: string } } & { id?: string }>(p, 'POST', `/api/workspaces/${wsId}/files/fetch`, { url, kind: 'image' })
    for (const url of ['https://127.0.0.1/a.png', 'https://10.0.0.5/a.png', 'https://169.254.169.254/latest/meta-data/', 'https://localhost/a.png', 'https://[::1]/a.png', 'http://example.com/a.png']) {
      const r = await fetchUrl(page, url)
      expect(r.status, url).toBe(400)
      expect(JSON.stringify(r.json), url).toContain('url_blocked')
    }
    // the made-up host redirects to loopback: refused at the redirect, nothing stored
    const redirect = await fetchUrl(page, `${HOST}/out/to-loopback.png`)
    expect(redirect.status).toBe(400)
    expect(JSON.stringify(redirect.json)).toContain('url_blocked')
    expect(hits).toEqual(['/out/to-loopback.png'])

    // a viewer may not make the server fetch anything
    const viewer = await newPerson(context)
    watchErrors(viewer)
    await signIn(viewer, email('vito'))
    await join(page, viewer, wsId, 'viewer')
    const refused = await fetchUrl(viewer, `${HOST}/out/lantern.png`)
    expect(refused.status).toBe(403)
    expect(hits).toEqual(['/out/to-loopback.png'])
    await viewer.context().close()
  })
})
