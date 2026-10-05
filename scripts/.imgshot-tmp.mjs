// Visual QA for Claude for images: node imgshot.mjs <scenario> <out.png> [--dark] [--mobile] [--de]
import { chromium } from 'playwright'

const [scenario, out] = process.argv.slice(2)
const has = (f) => process.argv.includes(`--${f}`)
const mobile = has('mobile')
const BASE = 'http://127.0.0.1:5335/'

const sse = (text) => {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  let body = ev('message_start', { message: { id: 'msg', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 4, output_tokens: 1 } } })
  body += ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
  for (const c of text.match(/.{1,16}/gs) ?? []) body += ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: c } })
  body += ev('content_block_stop', { index: 0 })
  body += ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 9 } })
  body += ev('message_stop', {})
  return body
}

const ANSWERS = {
  describe: JSON.stringify({ alt: 'Lab protocol P1: deck layout with six positions, a 96-well plate and a volume table.', caption: 'Protocol P1 — deck, plate and volumes at a glance' }),
  read: '## Protocol P1\n\n1. Load the deck as shown.\n2. Fill the plate A1–H12.\n\n| Reagent | Volume |\n| --- | --- |\n| Buffer | 50 µl |',
  table: JSON.stringify({ tables: [{ title: 'Volumes', header: ['Reagent', 'Volume (µl)', 'Wells'], rows: [['Buffer', '50', 'A1–A12'], ['Enzyme', '2,5', 'B1–B12'], ['Sample', '10', 'C1–C12'], ['Water', '37,5', 'D1–D12'], ['Stop', '5', 'E1–E12'], ['Dye', '1', 'F1–F12'], ['Control', '10', 'G1–G12']] }, { title: 'Deck', header: ['Slot', 'Labware'], rows: [['1', 'Tips 200 µl'], ['2', '96-well plate']] }] }),
  ask: 'The plate holds **96 wells** in 8 rows (A–H) and 12 columns.',
}

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  deviceScaleFactor: mobile ? 2 : 1,
  colorScheme: has('dark') ? 'dark' : 'light',
  isMobile: mobile,
  hasTouch: mobile,
})
await ctx.route('https://api.anthropic.com/**', async (route) => {
  const req = route.request()
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
  const body = req.postData() ?? ''
  if (has('one') && /Find every table/.test(body)) {
    const t = JSON.parse(ANSWERS.table)
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse(JSON.stringify({ tables: [t.tables[0]] })) })
  }
  const kind = /Write the alt text/.test(body) ? 'describe' : /Read out all the text/.test(body) ? 'read' : /Find every table/.test(body) ? 'table' : 'ask'
  await new Promise((r) => setTimeout(r, has('slow') ? 60_000 : 200))
  return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse(ANSWERS[kind]) })
})
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(`${BASE}app/?e2e`)
await page.waitForFunction(() => !!window.__one, null, { timeout: 30000 })
await page.waitForTimeout(800)

// a table image, drawn here
const dataUrl = await page.evaluate(() => {
  const c = document.createElement('canvas')
  c.width = 720
  c.height = 420
  const g = c.getContext('2d')
  g.fillStyle = '#fff'
  g.fillRect(0, 0, c.width, c.height)
  g.fillStyle = '#111'
  g.font = 'bold 26px sans-serif'
  g.fillText('Protocol P1 — volumes', 24, 44)
  g.font = '20px sans-serif'
  const rows = [['Reagent', 'Volume (µl)', 'Wells'], ['Buffer', '50', 'A1–A12'], ['Enzyme', '2,5', 'B1–B12'], ['Sample', '10', 'C1–C12'], ['Water', '37,5', 'D1–D12']]
  rows.forEach((r, i) => {
    r.forEach((t, j) => g.fillText(t, 36 + j * 220, 104 + i * 58))
    g.strokeStyle = '#999'
    g.beginPath()
    g.moveTo(24, 118 + i * 58)
    g.lineTo(696, 118 + i * 58)
    g.stroke()
  })
  return c.toDataURL('image/png')
})

const id = await page.evaluate(({ src, de }) => {
  const s = window.__one.workspace.getState()
  s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', ...(de ? { language: 'de' } : {}) })
  const id = s.createPage({ title: 'Protocol P1', parentId: null })
  s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Deck layout, plate and volumes for run P1.' }] }, { type: 'image', attrs: { src, alt: '', caption: '' } }, { type: 'paragraph', content: [{ type: 'text', text: 'Notes follow below.' }] }] }, 'e2e')
  return id
}, { src: dataUrl, de: has('de') })
await page.evaluate((id) => (window.location.hash = `#/p/${id}`), id)
await page.waitForSelector('.image-view img')
await page.waitForTimeout(400)
const fig = page.locator('.image-view').first()

async function toolbar(action) {
  await fig.hover()
  if (mobile) await fig.locator('img').click()
  await page.getByTestId('image-ai-key').click()
  if (action) await page.getByRole('menuitem', { name: action }).click()
}

if (scenario === 'toolbar') {
  await toolbar(null)
} else if (scenario === 'blockmenu') {
  await fig.hover()
  await page.locator('.block-handle__grip').click()
} else if (scenario === 'describe') {
  await toolbar(has('de') ? /Bild beschreiben/ : /Describe the image/)
  await page.waitForSelector('[data-testid="ai-image-describe"]')
} else if (scenario === 'tables') {
  await toolbar(has('de') ? /Bild → Tabelle/ : /Image → table/)
  await page.waitForSelector('[data-testid="ai-image-tables"]')
} else if (scenario === 'db') {
  await toolbar(/Image → table/)
  await page.waitForSelector('[data-testid="ai-image-tables"]')
  await page.getByRole('option', { name: /As database/ }).click()
} else if (scenario === 'read') {
  await toolbar(/Read out the text/)
  await page.getByRole('option', { name: /Insert below the image/ }).waitFor()
} else if (scenario === 'ask') {
  await toolbar(/Ask about the image/)
  await page.waitForTimeout(300)
} else if (scenario === 'cors') {
  await page.route('https://images.example.test/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(dataUrl.split(',')[1], 'base64') }))
  await page.evaluate((id) => {
    const s = window.__one.workspace.getState()
    s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A web image.' }] }, { type: 'image', attrs: { src: 'https://images.example.test/plate.png', alt: '', caption: '' } }] }, 'e2e')
  }, id)
  await page.waitForTimeout(600)
  await toolbar(/Describe the image/)
  await page.waitForTimeout(3000)
} else if (scenario === 'terminal') {
  await fig.locator('img').click()
  await page.keyboard.press('Control+Shift+J')
  await page.waitForSelector('[data-testid="term-image-chip"]')
}
await page.waitForTimeout(500)
await page.screenshot({ path: out })
if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'))
console.log('saved', out)
await browser.close()
