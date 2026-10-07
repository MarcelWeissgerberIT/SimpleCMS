/**
 * Media from MCP servers (features/ai/media) and the MCP sign-in (features/ai/mcp-servers/oauth.ts) —
 * everything mocked: api.anthropic.com streams answers with mcp_tool_use / mcp_tool_result blocks, a made-up
 * media host serves the files (https://media.e2e.test), a made-up MCP server + authorization server do OAuth.
 * Covered: media cards appear and nothing is fetched before the click; Save stores "onefile:" and inserts the
 * block; SVG becomes a download, a wrong type / bytes that disagree are refused; CORS refusal → Upload a copy;
 * the AI terminal stages "Insert media"; /generate image → variants → pick two → two image blocks; ⌘K "?";
 * OAuth (metadata, dynamic registration, PKCE, token, refresh, sign out — no token in storage or the backup); the
 * first usable of several listed sign-in services (the host's own refused to browsers); a sign-in with a code.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { BrowserContext, Page, Route } from '@playwright/test'
import { test, expect, openApp, wsEval, uiEval, createPage, gotoPage, editorOf, doc, para, MOD, flush, openExportDialog } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** a real 1×1 PNG */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const SVG = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><script>alert(1)</script></svg>')
const HTML = Buffer.from('<!doctype html><title>x</title><p>not a picture</p>')
const HOST = 'https://media.e2e.test'

/* ------------------------------------------------------------------ */
/* Claude API mock (Messages API SSE with MCP blocks)                  */
/* ------------------------------------------------------------------ */

type Block =
  | { type: 'text'; text: string }
  | { type: 'mcp_tool_use'; id: string; server: string; name: string; input: Record<string, unknown> }
  | { type: 'mcp_tool_result'; id: string; text: string }

let seq = 0
function sseMessage(blocks: Block[]): string {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  let body = ev('message_start', {
    message: { id: `msg_media_${++seq}`, type: 'message', role: 'assistant', model: 'e2e-mock', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 1 } },
  })
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      body += ev('content_block_start', { index, content_block: { type: 'text', text: '' } })
      for (const chunk of b.text.match(/.{1,18}/gs) ?? []) body += ev('content_block_delta', { index, delta: { type: 'text_delta', text: chunk } })
    } else if (b.type === 'mcp_tool_use') {
      body += ev('content_block_start', { index, content_block: { type: 'mcp_tool_use', id: b.id, name: b.name, server_name: b.server, input: {} } })
      body += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } })
    } else {
      body += ev('content_block_start', { index, content_block: { type: 'mcp_tool_result', tool_use_id: b.id, is_error: false, content: [{ type: 'text', text: b.text }] } })
    }
    body += ev('content_block_stop', { index })
  })
  body += ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 80 } })
  body += ev('message_stop', {})
  return body
}

const jsonMessage = (text: string) => ({ id: `msg_media_${++seq}`, type: 'message', role: 'assistant', model: 'e2e-mock', content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } })

interface Sent {
  body: AnyState
  stream: boolean
}

/** api.anthropic.com → streams get `stream(body)`, other requests a tool listing (the background check). */
async function mockApi(ctx: BrowserContext, stream: (body: AnyState, n: number) => string, inspect = 'TOOLS: generate_image, get_job\n---\nMakes images.'): Promise<Sent[]> {
  const sent: Sent[] = []
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (req.method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [], has_more: false, first_id: null, last_id: null }) })
    const body = JSON.parse(req.postData() ?? '{}')
    const r = { body, stream: body.stream === true }
    sent.push(r)
    try {
      if (r.stream) await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: stream(body, sent.filter((x) => x.stream).length - 1) })
      else await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(jsonMessage(inspect)) })
    } catch {
      /* aborted */
    }
  })
  return sent
}

/* ------------------------------------------------------------------ */
/* The media host                                                      */
/* ------------------------------------------------------------------ */

/** https://media.e2e.test/<path> — every request is counted; `/nocors/…` fails like a CORS refusal. */
async function mockMediaHost(ctx: BrowserContext): Promise<string[]> {
  const hits: string[] = []
  await ctx.route(`${HOST}/**`, (route: Route) => {
    const url = new URL(route.request().url())
    hits.push(url.pathname)
    // a host that does not let a browser read its files: the fetch fails like a CORS refusal
    if (url.pathname.startsWith('/nocors/')) return route.abort('failed')
    const cors = { 'access-control-allow-origin': '*' }
    const send = (type: string, body: Buffer) => route.fulfill({ status: 200, headers: { ...cors, 'content-type': type }, body })
    if (url.pathname.endsWith('.png') && url.pathname.includes('fake')) return send('image/png', HTML)
    if (url.pathname.endsWith('.png')) return send('image/png', PNG)
    if (url.pathname.endsWith('.jpg')) return send('image/png', PNG)
    if (url.pathname.endsWith('.svg')) return send('image/svg+xml', SVG)
    if (url.pathname.endsWith('.html')) return send('text/html', HTML)
    return route.fulfill({ status: 404, headers: cors, body: 'no' })
  })
  return hits
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const setKey = (page: Page) => wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))

const studio = (extra: AnyState = {}) => ({ id: 'srvstudio1', name: 'studio', url: 'https://mcp.studio.test/mcp', token: 'studio-e2e-token-0001', enabled: true, prompt: 'Makes images.', promptSource: 'auto', tools: ['generate_image', 'get_job'], checkedAt: 1, ...extra })
const atlas = { id: 'srvatlas01', name: 'atlas', url: 'https://mcp.atlas.test/mcp', token: 'atlas-e2e-token-0001', enabled: true, prompt: 'Knowledge base.', promptSource: 'auto', tools: ['atlas_search'], checkedAt: 1 }

const setServers = (page: Page, list: AnyState[]) => wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), list)

/** An answer with an image service's result: a lantern (PNG), a mark (SVG), a fake (HTML sent as PNG), a page (HTML). */
const RESULT = JSON.stringify({
  status: 'completed',
  images: [{ url: `${HOST}/out/lantern.png`, width: 1024, height: 1024 }],
  extras: { vector: `${HOST}/out/mark.svg`, fake_image: `${HOST}/out/fake.png` },
  thumbnail_url: `${HOST}/out/lantern-thumb.png`,
})
const answerWithMedia = () =>
  sseMessage([
    { type: 'mcp_tool_use', id: 'mcptoolu_1', server: 'studio', name: 'generate_image', input: { prompt: 'a paper lantern on a desk' } },
    { type: 'mcp_tool_result', id: 'mcptoolu_1', text: RESULT },
    { type: 'text', text: `Here is the lantern: ${HOST}/out/lantern.png — and the page: ${HOST}/out/info.html` },
  ])

/** The page's blocks of a type. */
const blocksOf = (page: Page, id: string, type: string) =>
  wsEval(page, (s, a) => (s.pages[a.id]?.content?.content ?? []).filter((b: AnyState) => b.type === a.type).map((b: AnyState) => b.attrs), { id, type })

/** The stored file behind "onefile:<id>". */
const storedFile = (page: Page, src: string) =>
  page.evaluate(async (src) => {
    const f = await (window as unknown as { __one: { files: { getFile: (s: string) => Promise<{ blob: Blob; name: string; type: string; size: number } | undefined> } } }).__one.files.getFile(src)
    return f ? { name: f.name, type: f.blob.type, size: f.size } : null
  }, src)

/** A page with text, the AI panel open at an empty line. */
async function openAIPanel(page: Page, title = 'Lantern notes') {
  const id = await createPage(page, { title, content: doc(para('A page about lanterns.'), para('')) })
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
  return { id, ask, panel: page.getByRole('dialog', { name: 'Ask Claude' }) }
}

const card = (scope: Page | ReturnType<Page['locator']>, file: string) => scope.locator(`[data-testid="media-card"][data-url$="${file}"]`)

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

test.describe('media from MCP servers (mocked Claude API, made-up hosts)', () => {
  test('AI menu: cards for what the result returned, nothing fetched before the click; Save stores onefile: and inserts below; SVG → download; wrong type refused', async ({ page, context }) => {
    await mockApi(context, () => answerWithMedia())
    const hits = await mockMediaHost(context)
    await openApp(page)
    await setKey(page)
    await setServers(page, [studio()])
    const { id, ask, panel } = await openAIPanel(page)
    await ask.fill('studio: a paper lantern on a desk')
    await ask.press('Enter')
    await expect(panel.locator('.ai-out__body')).toContainText('Here is the lantern')
    const cards = panel.getByTestId('media-cards')
    await expect(cards.getByTestId('media-card')).toHaveCount(3)
    // the thumbnail is left out, the HTML link in the answer too; the spec line names type, host and the tool
    await expect(card(panel, 'lantern.png')).toContainText('PNG · media.e2e.test')
    await expect(card(panel, 'lantern.png')).toContainText('a paper lantern on a desk')
    await expect(card(panel, 'lantern.png')).toContainText('STUDIO · generate_image')
    await expect(cards).toContainText('Not loaded')
    // never loaded by itself: no request to the media host yet, no <img> pointing there
    expect(hits).toEqual([])
    expect(await page.locator(`img[src^="${HOST}"]`).count()).toBe(0)

    // Save to One: fetched now, stored here, an image block below the target with caption + alt
    await card(panel, 'lantern.png').getByTestId('media-save').click()
    await expect(card(panel, 'lantern.png').getByTestId('media-saved')).toBeVisible()
    expect(hits).toEqual(['/out/lantern.png'])
    await expect.poll(() => blocksOf(page, id, 'image').then((x) => x.length)).toBe(1)
    const [img] = await blocksOf(page, id, 'image')
    expect(img.src).toMatch(/^onefile:/)
    expect(img.alt).toBe('a paper lantern on a desk')
    expect(img.caption).toBe('a paper lantern on a desk — STUDIO')
    expect(await storedFile(page, img.src)).toEqual({ name: 'lantern.png', type: 'image/png', size: PNG.length })
    await expect(editorOf(page, id).locator('img')).toHaveCount(1)

    // SVG: kept for download only (application/octet-stream), a file block
    await card(panel, 'mark.svg').getByTestId('media-save').click()
    await expect(card(panel, 'mark.svg').getByTestId('media-saved')).toBeVisible()
    await expect.poll(() => blocksOf(page, id, 'fileBlock').then((x) => x.length)).toBe(1)
    const [file] = await blocksOf(page, id, 'fileBlock')
    expect(file.name).toBe('mark.svg')
    expect(file.display).toBe('file')
    expect((await storedFile(page, file.src))?.type).toBe('application/octet-stream')

    // bytes that are not what the type says: refused, nothing stored or inserted, no Upload offered
    await card(panel, 'fake.png').getByTestId('media-save').click()
    await expect(card(panel, 'fake.png').locator('[data-issue="mismatch"]')).toContainText('not what its type says')
    await expect(card(panel, 'fake.png').getByTestId('media-upload')).toHaveCount(0)
    expect(await blocksOf(page, id, 'image')).toHaveLength(1)
  })

  test('a wrong type is refused; a host without CORS: Open + Upload a copy → saved and inserted', async ({ page, context, errors }) => {
    errors.allow(/CORS policy|ERR_FAILED|Failed to load resource/)
    await mockApi(context, () =>
      sseMessage([
        { type: 'mcp_tool_use', id: 'mcptoolu_2', server: 'studio', name: 'render', input: { prompt: 'harbour at dusk' } },
        { type: 'mcp_tool_result', id: 'mcptoolu_2', text: JSON.stringify({ result: { image_url: `${HOST}/nocors/harbour.jpg` }, page: { image_url: `${HOST}/out/info.html` } }) },
        { type: 'text', text: 'Done.' },
      ]),
    )
    await mockMediaHost(context)
    await openApp(page)
    await setKey(page)
    await setServers(page, [studio()])
    const { id, ask, panel } = await openAIPanel(page, 'Harbour')
    await ask.fill('render the harbour at dusk')
    await ask.press('Enter')
    await expect(panel.getByTestId('media-card')).toHaveCount(2)

    // text/html under an image key: refused plainly
    await card(panel, 'info.html').getByTestId('media-save').click()
    await expect(card(panel, 'info.html').locator('[data-issue="type"]')).toContainText('not an image, video or audio file')

    // the host refuses this browser (no CORS header): Open + Upload a copy, no team server in a local workspace
    const harbour = card(panel, 'harbour.jpg')
    await harbour.getByTestId('media-save').click()
    await expect(harbour.locator('[data-issue="cors"]')).toBeVisible()
    await expect(harbour.getByTestId('media-open')).toHaveAttribute('href', `${HOST}/nocors/harbour.jpg`)
    await expect(harbour.getByTestId('media-open')).toHaveAttribute('rel', 'noopener noreferrer')
    await expect(harbour.getByTestId('media-team')).toHaveCount(0)
    const chooser = page.waitForEvent('filechooser')
    await harbour.getByTestId('media-upload').click()
    await (await chooser).setFiles({ name: 'harbour-copy.png', mimeType: 'image/png', buffer: PNG })
    await expect(harbour.getByTestId('media-saved')).toBeVisible()
    await expect.poll(() => blocksOf(page, id, 'image').then((x) => x.length)).toBe(1)
    const [img] = await blocksOf(page, id, 'image')
    expect(img.src).toMatch(/^onefile:/)
    expect((await storedFile(page, img.src))?.name).toBe('harbour-copy.png')
  })

  test('AI terminal: cards under the task; Save stages "Insert media", Apply puts it at the end of the page', async ({ page, context }) => {
    await mockApi(context, () => answerWithMedia())
    const hits = await mockMediaHost(context)
    await openApp(page)
    await setKey(page)
    await setServers(page, [studio()])
    const id = await createPage(page, { title: 'Shot list', content: doc(para('Scenes for the launch film.')) })
    await gotoPage(page, id)
    await page.keyboard.press(`${MOD}+j`)
    const term = page.getByRole('region', { name: 'AI terminal' })
    await expect(term).toBeVisible()
    const field = term.getByRole('textbox', { name: 'Task for the agent' })
    await field.fill('studio: make a lantern picture for this page')
    await field.press('Enter')
    await expect(term.locator('.term-answer')).toContainText('Here is the lantern')
    await expect(term.getByTestId('media-card')).toHaveCount(3)
    await expect(term.getByTestId('media-cards')).toContainText('“Insert media” on “Shot list”')
    expect(hits).toEqual([])

    await card(term, 'lantern.png').getByTestId('media-save').click()
    await expect(card(term, 'lantern.png').getByTestId('media-saved')).toBeVisible()
    const change = term.locator('.term-change[data-kind="media"]')
    await expect(change).toContainText('Insert media')
    await expect(change).toContainText('Shot list')
    await expect(change).toContainText('lantern.png')
    // staged, not written yet
    expect(await blocksOf(page, id, 'image')).toHaveLength(0)
    await change.getByRole('button', { name: /^Apply #/ }).click()
    await expect(change).toHaveAttribute('data-status', 'applied')
    await expect.poll(() => blocksOf(page, id, 'image').then((x) => x.length)).toBe(1)
    const [img] = await blocksOf(page, id, 'image')
    expect(img.src).toMatch(/^onefile:/)
    // the text stays first, the image comes at the end
    expect(await wsEval(page, (s, id) => s.pages[id].content.content.map((b: AnyState) => b.type), id)).toEqual(['paragraph', 'image'])
  })

  test('/generate image: the server with image tools, a forced request to it alone; results as cards → pick two → two image blocks', async ({ page, context }) => {
    const sent = await mockApi(context, () =>
      sseMessage([
        { type: 'mcp_tool_use', id: 'mcptoolu_g1', server: 'studio', name: 'generate_image', input: { prompt: 'a red paper lantern', aspect_ratio: '16:9', num_images: 3 } },
        { type: 'mcp_tool_result', id: 'mcptoolu_g1', text: JSON.stringify({ job_id: 'job-42', status: 'queued' }) },
        { type: 'mcp_tool_use', id: 'mcptoolu_g2', server: 'studio', name: 'get_job', input: { job_id: 'job-42' } },
        { type: 'mcp_tool_result', id: 'mcptoolu_g2', text: JSON.stringify({ status: 'done', output: { images: [{ url: `${HOST}/gen/v1.png` }, { url: `${HOST}/gen/v2.png` }, { url: `${HOST}/gen/v3.png` }] } }) },
        { type: 'text', text: '3 results.' },
      ]),
    )
    const hits = await mockMediaHost(context)
    await openApp(page)
    await setKey(page)
    await setServers(page, [atlas, studio()])
    const id = await createPage(page, { title: 'Moodboard', content: doc(para('Lanterns for the window.'), para('')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p').last().click()
    await page.keyboard.type('/generate image')
    await expect(page.locator('.slash').first()).toContainText('Generate image')
    await page.keyboard.press('Enter')
    const setup = page.getByTestId('gen-setup')
    await expect(setup).toBeVisible()
    // only the server with image tools; the credits note
    await expect(setup.getByTestId('gen-server').locator('option')).toHaveCount(1)
    await expect(setup.getByTestId('gen-server')).toContainText('STUDIO')
    await expect(setup).toContainText('may use credits on STUDIO')
    await expect(setup.getByTestId('gen-prompt')).toBeFocused()
    await setup.getByTestId('gen-prompt').fill('a red paper lantern')
    await setup.getByRole('radio', { name: '16:9' }).click()
    await setup.getByRole('radio', { name: '3', exact: true }).click()
    await setup.getByTestId('gen-run').click()

    const panel = page.getByRole('dialog', { name: 'Ask Claude' })
    await expect(panel.getByTestId('media-card')).toHaveCount(3)
    // the request: that server alone, addressed, no memory, the page not sent (not ticked)
    const req = sent.filter((x) => x.stream).pop()!.body
    expect(req.mcp_servers.map((s: AnyState) => s.name)).toEqual(['studio'])
    expect(req.tools).toEqual([{ type: 'mcp_toolset', mcp_server_name: 'studio' }])
    expect(JSON.stringify(req.system)).toContain('You make images for One')
    const user = JSON.stringify(req.messages)
    expect(user).toContain('Create 3 images.')
    expect(user).toContain('Aspect ratio: 16:9')
    expect(user).not.toContain('Lanterns for the window')
    expect(user).not.toContain('one_memory')
    expect(hits).toEqual([])
    // the choice is remembered on this device
    expect(await page.evaluate(() => localStorage.getItem('one.generate.server'))).toContain('srvstudio1')

    // "Preview" (a click) fetches that one picture and shows it from memory — nothing stored
    await expect(card(panel, 'v1.png')).toContainText('Result 1')
    await card(panel, 'v1.png').getByTestId('media-preview').click()
    await expect(card(panel, 'v1.png')).toHaveAttribute('data-preview', '')
    await expect(card(panel, 'v1.png').locator('img')).toHaveAttribute('src', /^blob:/)
    expect(hits).toEqual(['/gen/v1.png'])
    expect(await blocksOf(page, id, 'image')).toEqual([])

    // pick two → Insert selected (2): saved (the previewed one is not fetched again) and inserted where the
    // slash command was; the panel closes
    await card(panel, 'v1.png').getByRole('checkbox').check()
    await card(panel, 'v3.png').getByRole('checkbox').check()
    await panel.getByRole('option', { name: /Insert selected \(2\)/ }).click()
    await expect.poll(() => blocksOf(page, id, 'image').then((x) => x.length)).toBe(2)
    expect(hits.sort()).toEqual(['/gen/v1.png', '/gen/v3.png'])
    await expect(panel).toBeHidden()
    const imgs = await blocksOf(page, id, 'image')
    for (const im of imgs) expect(im.src).toMatch(/^onefile:/)
    expect(imgs[0].caption).toBe('a red paper lantern — STUDIO')
    // in place of the empty line: text first, then the two pictures (the editor keeps a free line after them)
    expect(await wsEval(page, (s, id) => s.pages[id].content.content.map((b: AnyState) => b.type).slice(0, 3), id)).toEqual(['paragraph', 'image', 'image'])
  })

  test('an empty image block offers Generate…; without an image service the card says how to connect one', async ({ page }) => {
    await openApp(page)
    await setKey(page)
    await setServers(page, [atlas])
    const id = await createPage(page, { title: 'Blank picture', content: doc(para('Above.'), { type: 'image', attrs: { src: null } }) })
    await gotoPage(page, id)
    await editorOf(page, id).getByTestId('image-generate').click()
    const setup = page.getByTestId('gen-setup')
    await expect(setup).toBeVisible()
    await expect(setup.getByTestId('gen-noserver')).toContainText('No connected service makes images yet')
    await page.keyboard.press('Escape')
  })

  test('⌘K "?": cards under the answer; Save puts the image at the end of the current page', async ({ page, context }) => {
    await mockApi(context, () => answerWithMedia())
    await mockMediaHost(context)
    await openApp(page)
    await setKey(page)
    await setServers(page, [studio()])
    const id = await createPage(page, { title: 'Palette page', content: doc(para('Text first.')) })
    await gotoPage(page, id)
    await page.keyboard.press(`${MOD}+k`)
    const pal = page.getByRole('dialog', { name: 'Command palette' })
    const input = pal.getByRole('combobox').or(pal.locator('input')).first()
    await input.fill('?studio: a lantern please')
    await input.press('Enter')
    await expect(pal.getByTestId('media-card')).toHaveCount(3)
    await expect(pal.getByTestId('media-cards')).toContainText('Saved to “Palette page”')
    await card(pal, 'lantern.png').getByTestId('media-save').click()
    await expect(card(pal, 'lantern.png').getByTestId('media-saved')).toBeVisible()
    await expect.poll(() => blocksOf(page, id, 'image').then((x) => x.length)).toBe(1)
    await expect(page.locator('.toast', { hasText: 'Saved to “Palette page”' })).toBeVisible()
  })
})

/* ------------------------------------------------------------------ */
/* OAuth sign-in                                                       */
/* ------------------------------------------------------------------ */

const MCP_URL = 'https://mcp.oauth.test/mcp'
const AUTH = 'https://auth.oauth.test'
const ACCESS1 = 'oauth-e2e-ACCESS-token-one-7H2q'
const ACCESS2 = 'oauth-e2e-ACCESS-token-two-9K4z'
const REFRESH1 = 'oauth-e2e-REFRESH-token-one-3M8x'
const REFRESH2 = 'oauth-e2e-REFRESH-token-two-5P1w'

interface AuthLog {
  registered: AnyState[]
  authorize: URLSearchParams[]
  token: URLSearchParams[]
}

/** The MCP server (401 + resource metadata) and its authorization server (metadata, DCR, authorize, token). */
async function mockOAuth(ctx: BrowserContext): Promise<AuthLog> {
  const log: AuthLog = { registered: [], authorize: [], token: [] }
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST', 'access-control-expose-headers': 'WWW-Authenticate' }
  const json = (route: Route, status: number, body: unknown, extra: Record<string, string> = {}) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) })
  let challenge = ''
  await ctx.route('https://mcp.oauth.test/**', (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const path = new URL(req.url()).pathname
    if (path === '/mcp') return json(route, 401, { error: 'unauthorized' }, { 'www-authenticate': `Bearer resource_metadata="https://mcp.oauth.test/.well-known/oauth-protected-resource/mcp", scope="images:write"` })
    if (path === '/.well-known/oauth-protected-resource/mcp') return json(route, 200, { resource: MCP_URL, authorization_servers: [AUTH], scopes_supported: ['images:write'] })
    return json(route, 404, {})
  })
  await ctx.route(`${AUTH}/**`, async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const url = new URL(req.url())
    if (url.pathname === '/.well-known/oauth-authorization-server')
      return json(route, 200, { issuer: AUTH, authorization_endpoint: `${AUTH}/authorize`, token_endpoint: `${AUTH}/token`, registration_endpoint: `${AUTH}/register`, code_challenge_methods_supported: ['S256'], response_types_supported: ['code'] })
    if (url.pathname === '/register') {
      log.registered.push(JSON.parse(req.postData() ?? '{}'))
      return json(route, 201, { client_id: 'one-e2e-client', token_endpoint_auth_method: 'none' })
    }
    if (url.pathname === '/authorize') {
      log.authorize.push(url.searchParams)
      challenge = url.searchParams.get('code_challenge') ?? ''
      const back = new URL(url.searchParams.get('redirect_uri')!)
      back.searchParams.set('code', 'CODE-e2e-1')
      back.searchParams.set('state', url.searchParams.get('state')!)
      return route.fulfill({ status: 302, headers: { location: back.href } })
    }
    if (url.pathname === '/token') {
      const p = new URLSearchParams(req.postData() ?? '')
      log.token.push(p)
      if (p.get('grant_type') === 'authorization_code') {
        // PKCE: the verifier must hash to the challenge the authorization request carried
        const ok = p.get('code') === 'CODE-e2e-1' && createHash('sha256').update(p.get('code_verifier') ?? '').digest('base64url') === challenge && p.get('client_id') === 'one-e2e-client'
        return ok ? json(route, 200, { access_token: ACCESS1, refresh_token: REFRESH1, token_type: 'Bearer', expires_in: 3600 }) : json(route, 400, { error: 'invalid_grant' })
      }
      if (p.get('grant_type') === 'refresh_token' && p.get('refresh_token') === REFRESH1) return json(route, 200, { access_token: ACCESS2, refresh_token: REFRESH2, token_type: 'Bearer', expires_in: 3600 })
      return json(route, 400, { error: 'invalid_grant' })
    }
    return json(route, 404, {})
  })
  return log
}

/** Every IndexedDB record and local/session storage of the origin, as text. */
function storageDump(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const parts: string[] = []
    for (const { name } of await indexedDB.databases()) {
      if (!name) continue
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open(name)
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
      })
      for (const store of Array.from(db.objectStoreNames)) {
        const [keys, values] = await new Promise<[IDBValidKey[], unknown[]]>((resolve, reject) => {
          const tx = db.transaction(store, 'readonly')
          const k = tx.objectStore(store).getAllKeys()
          const v = tx.objectStore(store).getAll()
          tx.oncomplete = () => resolve([k.result, v.result])
          tx.onerror = () => reject(tx.error)
        })
        parts.push(`${name}/${store} ${JSON.stringify(keys)} ${JSON.stringify(values, (_k, v) => (v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? '[bytes]' : v))}`)
      }
      db.close()
    }
    parts.push(`localStorage ${JSON.stringify({ ...localStorage })}`, `sessionStorage ${JSON.stringify({ ...sessionStorage })}`)
    return parts.join('\n')
  })
}

const CODES_HOST = 'https://mcp.codes.test'
const CODES_AUTH = 'https://auth.codes.test'

interface CodeLog {
  reg: AnyState[]
  devices: URLSearchParams[]
  polls: URLSearchParams[]
  /** device-code polls answered "authorization_pending" before the tokens */
  pending: number
}

/**
 * An MCP server whose sign-in offers a code (RFC 8628). `wayBack` false: registering this page as the way back is
 * refused (a client for the device grant alone is not); true: it is accepted, but the sign-in page never returns.
 */
async function mockCodeAuth(ctx: BrowserContext, { wayBack }: { wayBack: boolean }): Promise<CodeLog> {
  const log: CodeLog = { reg: [], devices: [], polls: [], pending: 1 }
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST', 'access-control-expose-headers': 'WWW-Authenticate' }
  const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const html = (route: Route, title: string) => route.fulfill({ status: 200, headers: { 'content-type': 'text/html' }, body: `<!doctype html><title>${title}</title><p>${title}</p>` })
  await ctx.route(`${CODES_HOST}/**`, (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const path = new URL(req.url()).pathname
    if (path === '/mcp') return route.fulfill({ status: 401, headers: { ...cors, 'www-authenticate': `Bearer resource_metadata="${CODES_HOST}/.well-known/oauth-protected-resource/mcp"` }, body: '' })
    if (path === '/.well-known/oauth-protected-resource/mcp') return json(route, 200, { resource: `${CODES_HOST}/mcp`, authorization_servers: [CODES_AUTH] })
    return json(route, 404, {})
  })
  let polled = 0
  await ctx.route(`${CODES_AUTH}/**`, (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const url = new URL(req.url())
    if (url.pathname === '/.well-known/oauth-authorization-server')
      return json(route, 200, { issuer: CODES_AUTH, authorization_endpoint: `${CODES_AUTH}/authorize`, token_endpoint: `${CODES_AUTH}/token`, registration_endpoint: `${CODES_AUTH}/register`, device_authorization_endpoint: `${CODES_AUTH}/device`, code_challenge_methods_supported: ['S256'] })
    if (url.pathname === '/register') {
      const body = JSON.parse(req.postData() ?? '{}')
      log.reg.push(body)
      if (body.redirect_uris && !wayBack) return json(route, 400, { error: 'invalid_redirect_uri', error_description: 'redirect not allowed' })
      return json(route, 201, { client_id: 'codes-e2e-client', grant_types: body.grant_types })
    }
    if (url.pathname === '/authorize') return html(route, 'Sign in')
    if (url.pathname === '/device') {
      log.devices.push(new URLSearchParams(req.postData() ?? ''))
      polled = 0
      return json(route, 200, { device_code: 'DEVICE-e2e-1', user_code: 'WDJB-MJHT', verification_uri: `${CODES_AUTH}/activate`, verification_uri_complete: `${CODES_AUTH}/activate?user_code=WDJB-MJHT`, expires_in: 600, interval: 1 })
    }
    if (url.pathname === '/activate') return html(route, 'Enter the code')
    if (url.pathname === '/token') {
      const p = new URLSearchParams(req.postData() ?? '')
      log.polls.push(p)
      if (p.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:device_code' || p.get('device_code') !== 'DEVICE-e2e-1' || p.get('client_id') !== 'codes-e2e-client') return json(route, 400, { error: 'invalid_grant' })
      // the person has not allowed it yet
      if (++polled <= log.pending) return json(route, 400, { error: 'authorization_pending' })
      return json(route, 200, { access_token: 'codes-e2e-ACCESS-Rt55', refresh_token: 'codes-e2e-REFRESH-Yu66', token_type: 'Bearer', expires_in: 3600 })
    }
    return json(route, 404, {})
  })
  return log
}

/** Settings → Claude AI with the "codes" server turned down (401): its row. */
async function openCodesRow(page: Page) {
  await openApp(page)
  await setKey(page)
  await setServers(page, [{ id: 'srvcodes01', name: 'codes', url: `${CODES_HOST}/mcp`, token: '', enabled: true, prompt: 'Makes images.', promptSource: 'auto', checkError: 'The server rejected the token.', checkAuth: true }])
  await uiEval(page, (s) => s.openModal({ type: 'settings', tab: 'ai' }))
  const row = page.locator('.mcps-card[data-server="codes"]')
  await row.scrollIntoViewIfNeeded()
  return row
}

test.describe('MCP sign-in (OAuth, mocked authorization server)', () => {
  test('Sign in: metadata → registration → PKCE in a window → token; refreshed before expiry; Sign out; tokens never stored in the clear or backed up', async ({ page, context, errors }, testInfo) => {
    test.setTimeout(90_000)
    // the probe of the MCP server answers 401 (that is how it says it wants a sign-in)
    errors.allow(/401|Failed to load resource/)
    const sent = await mockApi(context, () => sseMessage([{ type: 'text', text: 'Signed-in answer.' }]), 'TOOLS: generate_image\n---\nMakes images.')
    const log = await mockOAuth(context)
    const logs: string[] = []
    page.on('console', (m) => logs.push(m.text()))
    await openApp(page)
    await setKey(page)
    // a server whose check was turned down (401): the row offers Sign in
    await setServers(page, [{ id: 'srvoauth01', name: 'oauthy', url: MCP_URL, token: '', enabled: true, prompt: 'Makes images.', promptSource: 'auto', checkError: 'The server rejected the token.', checkAuth: true }])
    await uiEval(page, (s) => s.openModal({ type: 'settings', tab: 'ai' }))
    const row = page.locator('.mcps-card[data-server="oauthy"]')
    await row.scrollIntoViewIfNeeded()
    await expect(row.getByTestId('mcp-signin-row')).toContainText('wants a sign-in')

    const popupP = context.waitForEvent('page')
    await row.getByTestId('mcp-signin').click()
    const popup = await popupP
    errors.watch(popup)
    await popup.waitForEvent('close', { timeout: 20_000 })

    // signed in: the registration, the authorization request (PKCE S256, state, resource), the exchange
    await expect(row.getByTestId('mcp-status')).toContainText('Signed in', { timeout: 15_000 })
    expect(log.registered).toHaveLength(1)
    expect(log.registered[0].redirect_uris).toEqual([new URL('app/?oauth=mcp', testInfo.project.use.baseURL!).href])
    expect(log.registered[0].token_endpoint_auth_method).toBe('none')
    const auth = log.authorize[0]
    expect(auth.get('response_type')).toBe('code')
    expect(auth.get('code_challenge_method')).toBe('S256')
    expect(auth.get('client_id')).toBe('one-e2e-client')
    expect(auth.get('resource')).toBe(MCP_URL)
    expect(auth.get('scope')).toBe('images:write')
    expect(auth.get('state')!.length).toBeGreaterThanOrEqual(16)
    expect(log.token[0].get('grant_type')).toBe('authorization_code')
    const server = await wsEval(page, (s) => s.settings.mcpServers[0])
    expect(server.token).toMatch(/^vault:[0-9a-z]+:7H2q$/)
    expect(server.oauth.clientId).toBe('one-e2e-client')
    expect(server.oauth.refresh).toBe(true)
    expect(server.checkAuth).toBeUndefined()
    // the connection is tested again with the new token, sent only to api.anthropic.com in mcp_servers
    await expect.poll(() => sent.find((x) => !x.stream)?.body.mcp_servers?.[0]?.authorization_token).toBe(ACCESS1)

    // stored: sealed in the vault, never in the clear; the sign-in attempt is gone from sessionStorage
    await flush(page)
    await expect.poll(() => storageDump(page)).toContain('mcp-refresh:srvoauth01')
    const dump = await storageDump(page)
    expect(dump).toContain('mcp-token:srvoauth01')
    for (const secret of [ACCESS1, REFRESH1, 'CODE-e2e-1']) expect(dump).not.toContain(secret)
    expect(dump).not.toContain('one.oauth.mcp:')

    // the full backup carries neither token (nor the marker)
    await page.keyboard.press('Escape')
    await openExportDialog(page)
    const exp = page.getByRole('dialog')
    await exp.getByRole('radio', { name: /Whole workspace/ }).click()
    await exp.getByRole('radio', { name: /Full backup/ }).click()
    const download = page.waitForEvent('download')
    await exp.locator('[data-export-run]').click()
    const file = testInfo.outputPath('backup.json')
    await (await download).saveAs(file)
    const backup = readFileSync(file, 'utf8')
    for (const secret of [ACCESS1, REFRESH1, server.token]) expect(backup).not.toContain(secret)
    await page.keyboard.press('Escape')

    // about to expire: the next request refreshes first and carries the new token
    await wsEval(page, (s) => s.updateSettings({ mcpServers: s.settings.mcpServers.map((x: AnyState) => ({ ...x, oauth: { ...x.oauth, expiresAt: Date.now() + 5000 } })) }))
    await page.keyboard.press(`${MOD}+k`)
    const pal = page.getByRole('dialog', { name: 'Command palette' })
    const input = pal.getByRole('combobox').or(pal.locator('input')).first()
    await input.fill('?anything new?')
    await input.press('Enter')
    await expect(pal.locator('.ask__answer')).toContainText('Signed-in answer.')
    expect(log.token.map((p) => p.get('grant_type'))).toEqual(['authorization_code', 'refresh_token'])
    expect(sent.filter((x) => x.stream).pop()!.body.mcp_servers[0].authorization_token).toBe(ACCESS2)
    expect(await wsEval(page, (s) => s.settings.mcpServers[0].token)).toMatch(/:9K4z$/)
    await page.keyboard.press('Escape')

    // Sign out: both tokens leave the vault
    await uiEval(page, (s) => s.openModal({ type: 'settings', tab: 'ai' }))
    await row.scrollIntoViewIfNeeded()
    await row.getByRole('button', { name: /OAUTHY/ }).click()
    await expect(row.getByTestId('mcp-oauth-state')).toContainText('Signed in at auth.oauth.test')
    await row.getByTestId('mcp-signout').click()
    await expect(row.getByTestId('mcp-oauth-signin')).toBeVisible()
    expect(await wsEval(page, (s) => s.settings.mcpServers[0].token)).toBe('')
    await expect.poll(() => storageDump(page)).not.toContain('mcp-refresh:srvoauth01')
    expect(await storageDump(page)).not.toContain('mcp-token:srvoauth01')
    // nothing of a token in any console message
    for (const secret of [ACCESS1, ACCESS2, REFRESH1, REFRESH2]) expect(logs.join('\n')).not.toContain(secret)
  })

  test('two sign-in services listed: the MCP host’s own (no CORS) is never asked, the first a browser can read wins — registration, PKCE and token there', async ({ page, context, errors }) => {
    test.setTimeout(60_000)
    errors.allow(/401|CORS|Failed to load resource|ERR_FAILED/)
    await mockApi(context, () => sseMessage([{ type: 'text', text: 'ok' }]), 'TOOLS: generate_image\n---\nMakes images.')
    const host = 'https://mcp.images.test'
    const first = 'https://sso.images.test'
    const second = 'https://login.images.test'
    const hits: string[] = []
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST' }
    const json = (route: Route, status: number, body: unknown, headers: Record<string, string>) => route.fulfill({ status, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
    // the MCP host: a 401, resource metadata readable, its own authorization server metadata refused to browsers
    await context.route(`${host}/**`, (route) => {
      const req = route.request()
      const path = new URL(req.url()).pathname
      hits.push(`${req.method()} ${host}${path}`)
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      if (path === '/mcp') return json(route, 401, { error: 'unauthorized' }, { ...cors, 'www-authenticate': `Bearer resource_metadata="${host}/.well-known/oauth-protected-resource/mcp", scope="openid email offline_access"` })
      if (path === '/.well-known/oauth-protected-resource/mcp') return json(route, 200, { resource: `${host}/mcp`, authorization_servers: [first, second], scopes_supported: ['openid', 'email', 'offline_access'] }, cors)
      // (a routed answer skips the browser's CORS check, so a refusal is played as a failed request)
      if (path === '/.well-known/oauth-authorization-server') return route.abort('failed')
      return json(route, 404, {}, cors)
    })
    // the first listed sign-in service does not answer a browser (CORS)
    await context.route(`${first}/**`, (route) => {
      hits.push(`${route.request().method()} ${route.request().url()}`)
      return route.abort('failed')
    })
    // the second: readable with CORS, dynamic registration, PKCE, a device endpoint too
    const reg: AnyState[] = []
    const tokens: URLSearchParams[] = []
    const authorized: URLSearchParams[] = []
    let challenge = ''
    await context.route(`${second}/**`, (route) => {
      const req = route.request()
      const url = new URL(req.url())
      hits.push(`${req.method()} ${second}${url.pathname}`)
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      if (url.pathname === '/.well-known/oauth-authorization-server')
        return json(route, 200, { issuer: second, authorization_endpoint: `${second}/oauth/authorize`, token_endpoint: `${second}/oauth/token`, registration_endpoint: `${second}/oauth/register`, device_authorization_endpoint: `${second}/oauth/device_authorization`, code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] }, cors)
      if (url.pathname === '/oauth/register') {
        reg.push(JSON.parse(req.postData() ?? '{}'))
        return json(route, 201, { client_id: 'images-e2e-client', token_endpoint_auth_method: 'none', grant_types: reg.at(-1)!.grant_types }, cors)
      }
      if (url.pathname === '/oauth/authorize') {
        challenge = url.searchParams.get('code_challenge') ?? ''
        authorized.push(url.searchParams)
        const back = new URL(url.searchParams.get('redirect_uri')!)
        back.searchParams.set('code', 'CODE-images-1')
        back.searchParams.set('state', url.searchParams.get('state')!)
        return route.fulfill({ status: 302, headers: { location: back.href } })
      }
      if (url.pathname === '/oauth/token') {
        const p = new URLSearchParams(req.postData() ?? '')
        tokens.push(p)
        const ok = p.get('code') === 'CODE-images-1' && createHash('sha256').update(p.get('code_verifier') ?? '').digest('base64url') === challenge
        return ok ? json(route, 200, { access_token: 'images-e2e-ACCESS-Zq81', refresh_token: 'images-e2e-REFRESH-Wv02', token_type: 'bearer', expires_in: 3600 }, cors) : json(route, 400, { error: 'invalid_grant' }, cors)
      }
      return json(route, 404, {}, cors)
    })
    await openApp(page)
    await setKey(page)
    await setServers(page, [{ id: 'srvimages1', name: 'images', url: `${host}/mcp`, token: '', enabled: true, prompt: 'Makes images.', promptSource: 'auto', checkError: 'The server rejected the token.', checkAuth: true }])
    await uiEval(page, (s) => s.openModal({ type: 'settings', tab: 'ai' }))
    const row = page.locator('.mcps-card[data-server="images"]')
    await row.scrollIntoViewIfNeeded()
    const popupP = context.waitForEvent('page')
    await row.getByTestId('mcp-signin').click()
    const popup = await popupP
    errors.watch(popup)
    await popup.waitForEvent('close', { timeout: 20_000 })
    await expect(row.getByTestId('mcp-status')).toContainText('Signed in', { timeout: 15_000 })

    // the first listed service was tried and skipped; the host's own sign-in was never asked
    expect(hits).toContain(`GET ${first}/.well-known/oauth-authorization-server`)
    expect(hits.filter((h) => h.startsWith(`POST ${first}`))).toEqual([])
    expect(hits.filter((h) => h.includes(`${host}/.well-known/oauth-authorization-server`) || h.includes(`${host}/authorize`) || h.includes(`${host}/token`))).toEqual([])
    // registered there as a public client for this page (no fragment), with the device grant along
    expect(reg).toHaveLength(1)
    expect(reg[0].token_endpoint_auth_method).toBe('none')
    expect(reg[0].redirect_uris[0]).toMatch(/\/app\/\?oauth=mcp$/)
    expect(reg[0].grant_types).toContain('urn:ietf:params:oauth:grant-type:device_code')
    expect(reg[0].scope).toBe('openid email offline_access')
    expect(authorized).toHaveLength(1)
    expect(authorized[0].get('scope')).toBe('openid email offline_access')
    expect(authorized[0].get('code_challenge_method')).toBe('S256')
    expect(authorized[0].get('redirect_uri')).not.toContain('#')
    expect(tokens.map((p) => p.get('grant_type'))).toEqual(['authorization_code'])
    const server = await wsEval(page, (s) => s.settings.mcpServers[0])
    expect(server.oauth.issuer).toBe(second)
    expect(server.oauth.deviceEndpoint).toBe(`${second}/oauth/device_authorization`)
    expect(server.token).toMatch(/:Zq81$/)
    await row.getByRole('button', { name: /IMAGES/ }).click()
    await expect(row.getByTestId('mcp-oauth-state')).toContainText('Signed in at login.images.test')
  })

  test('the sign-in refuses this page as the way back: a sign-in with a code (device flow), polled until allowed', async ({ page, context, errors }) => {
    test.setTimeout(60_000)
    errors.allow(/401|Failed to load resource/)
    await mockApi(context, () => sseMessage([{ type: 'text', text: 'ok' }]), 'TOOLS: generate_image\n---\nMakes images.')
    const log = await mockCodeAuth(context, { wayBack: false })
    const row = await openCodesRow(page)
    const popupP = context.waitForEvent('page')
    await row.getByTestId('mcp-signin').click()
    const popup = await popupP
    // the window goes to the server's page for the code; Settings shows the code and waits
    await expect.poll(() => popup.url()).toContain('/activate?user_code=WDJB-MJHT')
    await expect(row.getByTestId('mcp-user-code')).toHaveText('WDJB-MJHT')
    await expect(row.getByTestId('mcp-code-open')).toHaveAttribute('href', `${CODES_AUTH}/activate?user_code=WDJB-MJHT`)
    await popup.waitForEvent('close', { timeout: 20_000 })
    await expect(row.getByTestId('mcp-status')).toContainText('Signed in', { timeout: 15_000 })
    await expect(row.getByTestId('mcp-device-code')).toHaveCount(0)
    // asked with this page first (with the device grant, then without), then for the device grant alone (no redirect URI)
    expect(log.reg.map((r) => !!r.redirect_uris)).toEqual([true, true, false])
    expect(log.reg[2].grant_types).toEqual(['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token'])
    expect(log.devices.map((p) => p.get('client_id'))).toEqual(['codes-e2e-client'])
    expect(log.polls.length).toBe(2)
    const server = await wsEval(page, (s) => s.settings.mcpServers[0])
    expect(server.token).toMatch(/:Rt55$/)
    expect(server.oauth.deviceOnly).toBe(true)
    expect(server.oauth.refresh).toBe(true)
    await flush(page)
    const dump = await storageDump(page)
    for (const secret of ['codes-e2e-ACCESS-Rt55', 'codes-e2e-REFRESH-Yu66', 'DEVICE-e2e-1']) expect(dump).not.toContain(secret)
  })

  test('the sign-in window never comes back: "Use a code instead" switches to a code on the same registration; Cancel ends a code', async ({ page, context, errors }) => {
    test.setTimeout(60_000)
    errors.allow(/401|Failed to load resource/)
    await mockApi(context, () => sseMessage([{ type: 'text', text: 'ok' }]), 'TOOLS: generate_image\n---\nMakes images.')
    const log = await mockCodeAuth(context, { wayBack: true })
    const row = await openCodesRow(page)
    const popupP = context.waitForEvent('page')
    await row.getByTestId('mcp-signin').click()
    const popup = await popupP
    // the sign-in page never sends the window back
    await expect.poll(() => popup.url()).toContain('/authorize')
    await expect(row.getByTestId('mcp-signin')).toHaveText(/Waiting for the sign-in window/)
    log.pending = 99
    await row.getByTestId('mcp-use-code').click()
    await expect(row.getByTestId('mcp-user-code')).toHaveText('WDJB-MJHT')
    await expect.poll(() => popup.url()).toContain('/activate?user_code=WDJB-MJHT')
    // Cancel: the code goes away, nothing is stored
    await row.getByTestId('mcp-code-cancel').click()
    await expect(row.getByTestId('mcp-device-code')).toHaveCount(0)
    await expect(row.getByTestId('mcp-signin')).toHaveText(/Sign in/)
    await expect.poll(() => popup.isClosed()).toBe(true)
    expect(await wsEval(page, (s) => s.settings.mcpServers[0].token)).toBe('')
    // "Sign in with a code" is offered now that the server is known to have it; this time it is allowed
    log.pending = 1
    const popup2P = context.waitForEvent('page')
    await row.getByTestId('mcp-signin-code').click()
    const popup2 = await popup2P
    await expect(row.getByTestId('mcp-user-code')).toHaveText('WDJB-MJHT')
    await expect(row.getByTestId('mcp-status')).toContainText('Signed in', { timeout: 15_000 })
    await expect.poll(() => popup2.isClosed()).toBe(true)
    // one registration for this page with the device grant along, reused for the codes
    expect(log.reg).toHaveLength(1)
    expect(log.reg[0].redirect_uris).toHaveLength(1)
    expect(log.reg[0].grant_types).toContain('urn:ietf:params:oauth:grant-type:device_code')
    expect(log.devices).toHaveLength(2)
    expect(await wsEval(page, (s) => s.settings.mcpServers[0].token)).toMatch(/:Rt55$/)
  })

  test('a server without a sign-in says so; the redirect page finishes a sign-in this tab started', async ({ page, context, errors }) => {
    errors.allow(/401|404|Failed to load resource/)
    await mockApi(context, () => sseMessage([{ type: 'text', text: 'ok' }]))
    // no metadata anywhere: 404 everywhere
    await context.route('https://plain.mcp.test/**', (route) =>
      route.request().method() === 'OPTIONS'
        ? route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
        : route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{}' }),
    )
    await openApp(page)
    await setKey(page)
    await setServers(page, [{ id: 'srvplain01', name: 'plain', url: 'https://plain.mcp.test/mcp', token: '', enabled: true, prompt: 'x', promptSource: 'auto', checkError: 'The server rejected the token.', checkAuth: true }])
    await uiEval(page, (s) => s.openModal({ type: 'settings', tab: 'ai' }))
    const row = page.locator('.mcps-card[data-server="plain"]')
    await row.scrollIntoViewIfNeeded()
    const popupP = context.waitForEvent('page')
    await row.getByTestId('mcp-signin').click()
    const popup = await popupP
    await expect(row.getByTestId('mcp-signin-row')).toContainText('offers no sign-in')
    expect(popup.isClosed()).toBe(true)

    // the way back to this tab without a window (#/oauth/mcp): an unknown state is refused plainly
    await page.goto('app/?oauth=mcp&code=whatever&state=AAAAAAAAAAAAAAAAAAAAAAAA')
    const screen = page.getByTestId('mcp-oauth-screen')
    await expect(screen).toHaveAttribute('data-phase', 'error')
    await expect(screen).toContainText('started in another tab or too long ago')
    // the code never stays in the address
    expect(page.url()).not.toContain('whatever')
    expect(new URL(page.url()).hash).toBe('#/oauth/mcp')
    expect(new URL(page.url()).search).toBe('')
  })
})
