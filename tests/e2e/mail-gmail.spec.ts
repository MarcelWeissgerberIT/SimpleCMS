/**
 * Gmail → a "Mails" database (features/mail). Everything external is mocked — Google's sign-in script
 * (accounts.google.com/gsi/client), the Gmail REST API (an in-memory mailbox on gmail.googleapis.com),
 * remote images and Claude (api.anthropic.com) — nothing real is ever called.
 *
 * Covered: the settings flow (EN + DE, a client secret is refused), connecting with the mocked token client
 * (script loaded only on connect), the first sync from a date (database, properties, sanitized body, remote
 * images blocked, tracking pixels gone, attachments listed), labels, incremental sync through the history
 * (only new mails fetched, Gmail's fields follow, the user's edits stay, an expired history lists again),
 * "Load images", organising with Claude (mail content goes out only when on), 429 backoff and the token
 * never being stored. The team workspace (private database) runs against the real server: tests/e2e-cloud.
 */
import type { Page, Route } from '@playwright/test'
import { test, expect, openApp, wsEval, uiEval, gotoPage, editorOf, flush, createPage, reloadApp } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

declare global {
  interface Window {
    // the mail service's test hook (features/mail/service.ts, dev or ?e2e)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __oneMail: any
    __gis: { calls: AnyState[]; mode: 'ok' | 'popup' | 'deny' | 'closed'; revoked: string[] }
    __gisMode?: 'ok' | 'popup' | 'deny' | 'closed'
  }
}

const CLIENT_ID = '123456789012-e2etestclientid0001.apps.googleusercontent.com'
const SECRET = 'GOCSPX-e2e-THIS-IS-A-CLIENT-SECRET'
const ACCOUNT = 'ada@example.com'
const DAY = 86_400_000

/* ------------------------------------------------------------------ */
/* Google Identity Services (token model) mock                          */
/* ------------------------------------------------------------------ */

const GIS_JS = `
(() => {
  let n = 0
  window.__gis = { calls: [], mode: window.__gisMode || 'ok', revoked: [] }
  window.google = { accounts: { oauth2: {
    initTokenClient(cfg) {
      return {
        requestAccessToken(o) {
          window.__gis.calls.push({ client_id: cfg.client_id, scope: cfg.scope, prompt: (o && o.prompt) ?? cfg.prompt, hint: (o && o.login_hint) || cfg.login_hint || null })
          setTimeout(() => {
            if (window.__gis.mode === 'popup') return cfg.error_callback && cfg.error_callback({ type: 'popup_failed_to_open' })
            if (window.__gis.mode === 'deny') return cfg.callback({ error: 'access_denied' })
            if (window.__gis.mode === 'closed') return cfg.error_callback && cfg.error_callback({ type: 'popup_closed' })
            cfg.callback({ access_token: 'ya29.e2e-SECRET-TOKEN-' + (++n), expires_in: 3599, scope: cfg.scope, token_type: 'Bearer' })
          }, 40)
        },
      }
    },
    hasGrantedAllScopes(r, ...scopes) { return scopes.every((s) => String(r.scope || '').split(' ').includes(s)) },
    revoke(token, done) { window.__gis.revoked.push(token); done && done() },
  } } }
})()`

async function mockGis(page: Page): Promise<{ loads: () => number }> {
  let loads = 0
  await page.route('https://accounts.google.com/**', (route) => {
    loads++
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: GIS_JS })
  })
  return { loads: () => loads }
}

/* ------------------------------------------------------------------ */
/* Gmail REST mock: an in-memory mailbox                                */
/* ------------------------------------------------------------------ */

interface MockMail {
  id: string
  labelIds: string[]
  /** ms */
  date: number
  subject: string
  from: string
  to: string
  html?: string
  text?: string
  attachments?: Array<{ name: string; mime: string; size: number; data?: Buffer }>
  /** Gmail thread id (default: one thread per mail) */
  thread?: string
}

const threadOf = (m: MockMail) => m.thread ?? `t-${m.id}`

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function payloadOf(m: MockMail): AnyState {
  const headers = [
    { name: 'Subject', value: m.subject },
    { name: 'From', value: m.from },
    { name: 'To', value: m.to },
    { name: 'Date', value: new Date(m.date).toUTCString() },
  ]
  const alt: AnyState[] = []
  if (m.text) alt.push({ mimeType: 'text/plain', filename: '', headers: [{ name: 'Content-Type', value: 'text/plain; charset="UTF-8"' }], body: { size: m.text.length, data: b64url(m.text) } })
  if (m.html) alt.push({ mimeType: 'text/html', filename: '', headers: [{ name: 'Content-Type', value: 'text/html; charset="UTF-8"' }], body: { size: m.html.length, data: b64url(m.html) } })
  const body = alt.length > 1 ? { mimeType: 'multipart/alternative', filename: '', headers: [], body: { size: 0 }, parts: alt } : alt[0]
  if (!m.attachments?.length) return { ...body, headers: [...headers, ...(body.headers ?? [])] }
  return {
    mimeType: 'multipart/mixed',
    filename: '',
    headers,
    body: { size: 0 },
    parts: [body, ...m.attachments.map((a) => ({ mimeType: a.mime, filename: a.name, headers: [{ name: 'Content-Disposition', value: `attachment; filename="${a.name}"` }], body: { size: a.size, attachmentId: `att-${a.name}` } }))],
  }
}

type HistoryRecord = { id: number; messagesAdded?: AnyState[]; labelsAdded?: AnyState[]; labelsRemoved?: AnyState[] }

class Mailbox {
  mails: MockMail[] = []
  historyId = 1000
  history: HistoryRecord[] = []
  /** history before this id is gone (404) */
  historyFloor = 0
  /** the next N message fetches answer 429 */
  fail429 = 0
  /** after N more message fetches the token in use expires (401 from then on) */
  authFailAfter: number | null = null
  rejected = new Set<string>()
  calls: string[] = []
  tokens = new Set<string>()
  labels = [
    { id: 'INBOX', name: 'INBOX', type: 'system' },
    { id: 'UNREAD', name: 'UNREAD', type: 'system' },
    { id: 'STARRED', name: 'STARRED', type: 'system' },
    { id: 'SPAM', name: 'SPAM', type: 'system' },
    { id: 'TRASH', name: 'TRASH', type: 'system' },
    { id: 'CATEGORY_PROMOTIONS', name: 'CATEGORY_PROMOTIONS', type: 'system' },
    { id: 'Label_work', name: 'Work', type: 'user' },
  ]

  constructor(mails: MockMail[]) {
    this.mails = mails
  }

  add(m: MockMail) {
    this.mails.push(m)
    this.history.push({ id: ++this.historyId, messagesAdded: [{ message: { id: m.id, threadId: threadOf(m), labelIds: m.labelIds } }] })
  }

  relabel(id: string, add: string[], remove: string[]) {
    const m = this.mails.find((x) => x.id === id)!
    m.labelIds = [...m.labelIds.filter((l) => !remove.includes(l)), ...add.filter((l) => !m.labelIds.includes(l))]
    const rec: HistoryRecord = { id: ++this.historyId }
    if (add.length) rec.labelsAdded = [{ message: { id, threadId: threadOf(m), labelIds: m.labelIds }, labelIds: add }]
    if (remove.length) rec.labelsRemoved = [{ message: { id, threadId: threadOf(m), labelIds: m.labelIds }, labelIds: remove }]
    this.history.push(rec)
  }

  /** "messages?…" calls, "messages/<id>" fetches … since the last reset */
  take(): string[] {
    const c = this.calls
    this.calls = []
    return c
  }

  message(m: MockMail, format: string): AnyState {
    const base = { id: m.id, threadId: threadOf(m), labelIds: m.labelIds, snippet: (m.text ?? m.subject).slice(0, 80), historyId: String(this.historyId), internalDate: String(m.date), sizeEstimate: 2048 }
    return format === 'minimal' ? base : { ...base, payload: payloadOf(m) }
  }

  async handle(route: Route) {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'retry-after' }
    if (req.method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': 'authorization, accept', 'access-control-allow-methods': 'GET' } })
    const url = new URL(req.url())
    const path = url.pathname.replace('/gmail/v1/users/me/', '')
    const json = (status: number, body: unknown, extra: Record<string, string> = {}) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) })
    const auth = (await req.allHeaders()).authorization ?? ''
    const token = auth.replace(/^Bearer /, '')
    if (!token.startsWith('ya29.') || this.rejected.has(token)) return json(401, { error: { code: 401, status: 'UNAUTHENTICATED' } })
    this.tokens.add(token)
    this.calls.push(`${path}${url.search}`)
    if (path === 'profile') return json(200, { emailAddress: ACCOUNT, messagesTotal: this.mails.length, historyId: String(this.historyId) })
    if (path === 'labels') return json(200, { labels: this.labels })
    if (path === 'messages') {
      const q = url.searchParams.get('q') ?? ''
      const after = Number(q.match(/after:(\d+)/)?.[1] ?? 0) * 1000
      const labelIds = url.searchParams.getAll('labelIds')
      const spam = url.searchParams.get('includeSpamTrash') === 'true'
      const max = Number(url.searchParams.get('maxResults') ?? 100)
      const offset = Number(url.searchParams.get('pageToken') ?? 0)
      const hits = this.mails
        .filter((m) => m.date >= after && labelIds.every((l) => m.labelIds.includes(l)) && (spam || !m.labelIds.some((l) => l === 'SPAM' || l === 'TRASH')))
        .sort((a, b) => b.date - a.date)
      const page = hits.slice(offset, offset + max)
      return json(200, { messages: page.map((m) => ({ id: m.id, threadId: threadOf(m) })), resultSizeEstimate: hits.length, ...(offset + max < hits.length ? { nextPageToken: String(offset + max) } : {}) })
    }
    const att = path.match(/^messages\/([^/]+)\/attachments\/([^/]+)$/)
    if (att) {
      const a = this.mails.find((x) => x.id === att[1])?.attachments?.find((x) => `att-${x.name}` === decodeURIComponent(att[2]))
      if (!a) return json(404, { error: { code: 404 } })
      const data = a.data ?? Buffer.alloc(0)
      return json(200, { size: data.length || a.size, data: data.toString('base64url') })
    }
    const one = path.match(/^messages\/([^/]+)$/)
    if (one) {
      if (this.authFailAfter !== null && this.authFailAfter-- <= 0) {
        this.authFailAfter = null
        this.rejected.add(token)
        return json(401, { error: { code: 401, status: 'UNAUTHENTICATED' } })
      }
      if (this.fail429 > 0) {
        this.fail429--
        return json(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }, { 'retry-after': '1' })
      }
      const m = this.mails.find((x) => x.id === one[1])
      return m ? json(200, this.message(m, url.searchParams.get('format') ?? 'full')) : json(404, { error: { code: 404 } })
    }
    if (path === 'history') {
      const start = Number(url.searchParams.get('startHistoryId'))
      if (start < this.historyFloor) return json(404, { error: { code: 404, status: 'NOT_FOUND' } })
      return json(200, { history: this.history.filter((h) => h.id > start), historyId: String(this.historyId) })
    }
    return json(400, { error: { code: 400 } })
  }
}

const NEWSLETTER = `<!doctype html><html><head><style>.x{color:red}</style><title>Sale</title></head><body>
<div style="display:none;max-height:0;overflow:hidden">Hidden preheader text&zwnj;&nbsp;&zwnj;&nbsp;</div>
<table role="presentation" width="100%"><tr><td align="center">
  <table role="presentation" width="600"><tr><td>
    <h1>Autumn sale</h1>
    <img src="https://img.example.test/hero.png" alt="Autumn sale banner" width="600" height="300">
    <p>Everything <b>30 % off</b> until Sunday.</p>
    <p><a href="https://shop.example.test/sale" onclick="steal()">Shop now</a> · <a href="javascript:alert(1)">Bad link</a></p>
    <div data-type="databaseBlock" data-database-id="smuggled">Smuggled block</div>
    <script>alert('x')</script>
  </td></tr></table>
</td></tr></table>
<table><tr><th>Item</th><th>Price</th></tr><tr><td>Boots</td><td>89 EUR</td></tr></table>
<img src="https://track.example.test/open.gif?u=ada" width="1" height="1" alt="">
</body></html>`

function fixtureMails(now: number): MockMail[] {
  return [
    {
      id: 'm1',
      labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'],
      date: now - 2 * DAY,
      subject: 'Autumn sale — 30 % off',
      from: '"Shop Team" <news@shop.example.test>',
      to: 'Ada Lovelace <ada@example.com>',
      html: NEWSLETTER,
      text: 'Autumn sale. Everything 30 % off.',
      attachments: [{ name: 'invoice.pdf', mime: 'application/pdf', size: 122_880 }],
    },
    {
      id: 'm2',
      labelIds: ['INBOX', 'UNREAD'],
      date: now - 5 * DAY,
      subject: 'Draft review',
      from: 'Bob Builder <bob@example.test>',
      to: 'ada@example.com',
      text: 'Hi Ada,\n\nCan you review the draft by Friday?\nhttps://docs.example.test/draft\n\nThanks,\nBob',
    },
    { id: 'm3', labelIds: ['INBOX'], date: now - 40 * DAY, subject: 'Too old', from: 'old@example.test', to: ACCOUNT, text: 'Before the sync date.' },
    { id: 'm4', labelIds: ['INBOX', 'SPAM'], date: now - 1 * DAY, subject: 'You won', from: 'spam@example.test', to: ACCOUNT, text: 'Spam.' },
    { id: 'm5', labelIds: ['Label_work'], date: now - 3 * DAY, subject: 'Quarterly numbers', from: 'cfo@example.test', to: ACCOUNT, text: 'Numbers attached.' },
  ]
}

const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

interface Env {
  box: Mailbox
  gis: { loads: () => number }
  images: string[]
  claude: string[]
}

async function setup(page: Page, mails?: (now: number) => MockMail[]): Promise<Env> {
  const now = Date.now()
  const box = new Mailbox((mails ?? fixtureMails)(now))
  const images: string[] = []
  const claude: string[] = []
  await page.route('https://gmail.googleapis.com/**', (r) => box.handle(r))
  await page.route(/^https:\/\/(img|track)\.example\.test\//, (r) => {
    images.push(r.request().url())
    return r.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG })
  })
  // Claude is never called unless a test answers it (organise) — any request is recorded and refused
  await page.route('https://api.anthropic.com/**', (r) => {
    if (r.request().method() !== 'OPTIONS') claude.push(r.request().postData() ?? '')
    return r.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*' }, body: '{}' })
  })
  const gis = await mockGis(page)
  return { box, gis, images, claude }
}

/** Claude (structured output) answering for the mails in the prompt; returns the request bodies. */
async function routeClaude(page: Page): Promise<AnyState[]> {
  const sent: AnyState[] = []
  await page.unroute('https://api.anthropic.com/**')
  await page.route('https://api.anthropic.com/**', (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' } })
    const body = JSON.parse(req.postData() ?? '{}')
    sent.push(body)
    const prompt = String(body.messages?.[0]?.content ?? '')
    const ids = [...prompt.matchAll(/<mail id="([^"]+)">/g)].map((m) => m[1])
    const answer = { mails: ids.map((id) => ({ id, category: id === 'm2' ? 'Todo' : 'Newsletter', priority: id === 'm2' ? 'high' : 'low', needsReply: id === 'm2', summary: `Summary of ${id}` })) }
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      body: JSON.stringify({ id: 'msg_mail', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify(answer) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 900, output_tokens: 120 } }),
    })
  })
  return sent
}

/* ------------------------------------------------------------------ */
/* App helpers                                                         */
/* ------------------------------------------------------------------ */

async function openMailTab(page: Page, name: RegExp = /Mail$/) {
  await uiEval(page, (s) => s.openModal({ type: 'settings' }))
  const dialog = page.getByRole('dialog', { name: /^(Settings|Einstellungen)$/ })
  await dialog.getByRole('tab', { name }).click()
  return dialog
}

async function closeSettings(page: Page) {
  await page.getByRole('dialog', { name: /^(Settings|Einstellungen)$/ }).getByRole('button', { name: /^(Close|Schließen)$/ }).first().click()
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Client ID + a from date, straight into the settings (the UI flow has its own test). */
async function configure(page: Page, patch: AnyState = {}) {
  await wsEval(page, (s, p) => s.updateSettings({ mail: { ...(s.settings.mail ?? {}), ...p } }), { clientId: CLIENT_ID, from: day(Date.now() - 10 * DAY), ...patch })
}

async function connect(page: Page) {
  const dialog = await openMailTab(page)
  await dialog.getByRole('button', { name: 'Connect Gmail' }).click()
  await expect(dialog.getByTestId('mail-account')).toHaveText(ACCOUNT)
  return dialog
}

async function syncAndWait(page: Page) {
  await page.evaluate(() => window.__oneMail.sync())
  await expect.poll(() => page.evaluate(() => window.__oneMail.state().phase)).toBe('idle')
}

const mailCfg = (page: Page) => wsEval(page, (s) => JSON.parse(JSON.stringify(s.settings.mail ?? null)))

/** Rows of the Mails database: title + property values by property NAME (options as names). */
async function mailRows(page: Page): Promise<AnyState[]> {
  return wsEval(page, (s) => {
    const dbId = s.settings.mail?.databaseId
    const db = s.databases[dbId]
    if (!db) return []
    return (Object.values(s.pages) as AnyState[])
      .filter((p) => p.databaseId === dbId && !p.trashed)
      .map((p) => {
        const props: AnyState = {}
        for (const d of db.properties) {
          if (d.type === 'title') continue
          const v = p.properties[d.id]
          if (d.type === 'select') props[d.name] = d.options.find((o: AnyState) => o.id === v)?.name ?? null
          else if (d.type === 'multi_select') props[d.name] = (v ?? []).map((id: string) => d.options.find((o: AnyState) => o.id === id)?.name)
          else props[d.name] = v ?? null
        }
        return { id: p.id, title: p.title, props, content: p.content, plain: p.plain }
      })
      .sort((a, b) => a.title.localeCompare(b.title))
  })
}

const rowBy = (rows: AnyState[], title: string) => rows.find((r) => r.title === title)!

function nodes(doc: AnyState | null, type: string): AnyState[] {
  const out: AnyState[] = []
  const walk = (n: AnyState) => {
    if (n.type === type) out.push(n)
    ;(n.content ?? []).forEach(walk)
  }
  if (doc) walk(doc)
  return out
}

const links = (doc: AnyState | null) => {
  const out: string[] = []
  const walk = (n: AnyState) => {
    for (const m of n.marks ?? []) if (m.type === 'link') out.push(m.attrs.href)
    ;(n.content ?? []).forEach(walk)
  }
  if (doc) walk(doc)
  return out
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

test.describe('Mail (Gmail)', () => {
  test('settings: setup steps with both origins, a client secret is refused, the client ID is kept; EN and DE', async ({ page }) => {
    const env = await setup(page)
    await openApp(page)
    const dialog = await openMailTab(page)
    await expect(dialog.getByRole('heading', { name: 'Mail' })).toBeVisible()
    // the steps, open while no client ID is set: Gmail API, consent screen, web client with the origins
    await expect(dialog.getByText('Set up your Google client')).toBeVisible()
    await expect(dialog.getByText('Enable the Gmail API for that project.')).toBeVisible()
    await expect(dialog.getByText(/add your own Google address as a test user/)).toBeVisible()
    const origins = dialog.getByRole('list', { name: 'Authorized JavaScript origins' })
    await expect(origins.getByText('https://getonecms.com', { exact: true })).toBeVisible()
    const here = await page.evaluate(() => window.location.origin)
    await expect(origins.getByText(here, { exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: `Copy ${here}` })).toBeVisible()
    // no built-in client at this origin: nothing of the one-click path
    await expect(dialog.getByTestId('mail-one-access')).toHaveCount(0)
    await expect(dialog.getByTestId('mail-own-client')).toHaveCount(0)
    await expect(dialog.getByText('Not set up')).toBeVisible()

    const connectBtn = dialog.getByRole('button', { name: 'Connect Gmail' })
    await expect(connectBtn).toBeDisabled()
    const field = dialog.getByLabel('OAuth client ID')
    // a client SECRET is refused on the spot and never stored
    await field.fill(SECRET)
    await expect(dialog.getByRole('alert')).toContainText('client SECRET')
    await expect(field).toHaveValue('')
    expect(JSON.stringify(await mailCfg(page))).not.toContain('GOCSPX')
    // not an ID
    await field.fill('my-client')
    await field.press('Enter')
    await expect(dialog.getByRole('alert')).toContainText('doesn’t look like a client ID')
    expect((await mailCfg(page))?.clientId ?? '').toBe('')
    // the ID
    await field.fill(CLIENT_ID)
    await field.press('Enter')
    await expect.poll(async () => (await mailCfg(page))?.clientId).toBe(CLIENT_ID)
    await expect(connectBtn).toBeEnabled()
    // Google's script is not loaded before anyone connects
    expect(env.gis.loads()).toBe(0)
    // sync options: defaults
    const cfg = await mailCfg(page)
    expect(cfg).toMatchObject({ labels: ['INBOX'], excludeSpamTrash: true, maxPerRun: 50, auto: 'manual', organise: { enabled: false } })
    // 30 days ago, in the browser's time zone
    const monthAgo = await page.evaluate(() => {
      const d = new Date(Date.now() - 30 * 86_400_000)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })
    expect(cfg.from).toBe(monthAgo)
    await expect(dialog.getByLabel('Sync mails from')).toHaveValue(cfg.from)
    // the schedule
    await dialog.getByRole('radio', { name: 'Every …' }).click()
    await dialog.getByRole('combobox', { name: 'Interval' }).selectOption('30')
    await expect.poll(async () => (await mailCfg(page)).auto).toBe('interval')
    expect((await mailCfg(page)).everyMin).toBe(30)
    // Claude organising needs a key
    await expect(dialog.getByRole('switch', { name: 'Organise new mails with Claude' })).toBeDisabled()
    await expect(dialog.getByText(/Needs your Claude key/)).toBeVisible()

    // German
    await closeSettings(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const de = await openMailTab(page, /E-Mail$/)
    await expect(de.getByRole('heading', { name: 'E-Mail' })).toBeVisible()
    await expect(de.getByRole('button', { name: 'Gmail verbinden' })).toBeEnabled()
    await expect(de.getByText('Google-Client einrichten')).toBeVisible()
    await expect(de.getByRole('radio', { name: 'Alle …' })).toHaveAttribute('aria-checked', 'true')
    await expect(de.getByText('Wohin deine Mails gehen')).toBeVisible()
    await expect(de.getByRole('switch', { name: 'Neue Mails mit Claude ordnen' })).toBeDisabled()
  })

  test('connect (mocked Google) and the first sync from a date: database, properties, sanitized body, blocked images, attachments — Claude never asked', async ({ page }) => {
    const env = await setup(page)
    await openApp(page)
    const parent = await createPage(page, { title: 'Correspondence' })
    await configure(page, { parentId: parent })
    const dialog = await connect(page)
    expect(env.gis.loads()).toBe(1)
    const calls = await page.evaluate(() => window.__gis.calls)
    expect(calls).toEqual([{ client_id: CLIENT_ID, scope: 'https://www.googleapis.com/auth/gmail.readonly', prompt: '', hint: null }])
    // labels come from the API
    await expect(dialog.getByRole('button', { name: 'Work', exact: true })).toBeVisible()

    await dialog.getByRole('button', { name: 'Sync now' }).click()
    await expect.poll(() => page.evaluate(() => window.__oneMail.state().phase)).toBe('idle')
    await expect(page.getByText('2 new mails')).toBeVisible()

    // listed after the date, per label, without spam / trash
    const listed = env.box.calls.filter((c) => c.startsWith('messages?'))
    expect(listed).toHaveLength(1)
    const after = await page.evaluate((d) => Math.floor(new Date(`${d}T00:00:00`).getTime() / 1000), day(Date.now() - 10 * DAY))
    expect(decodeURIComponent(listed[0])).toContain(`q=after:${after}`)
    expect(listed[0]).toContain('labelIds=INBOX')
    expect(listed[0]).toContain('includeSpamTrash=false')

    const cfg = await mailCfg(page)
    const db = await wsEval(page, (s, id) => ({ title: s.pages[id].title, parentId: s.pages[id].parentId, private: !!s.pages[id].private, props: s.databases[id].properties.map((p: AnyState) => `${p.name}:${p.type}`), views: s.databases[id].views.map((v: AnyState) => v.name) }), cfg.databaseId)
    expect(db).toEqual({
      title: 'Mails',
      parentId: parent,
      private: false,
      props: ['Subject:title', 'From:text', 'To:text', 'Date:date', 'Labels:multi_select', 'Unread:checkbox', 'Has attachments:checkbox', 'Gmail link:url', 'Thread:text', 'Message ID:text', 'Show images:checkbox', 'Load attachment:text', 'Contact:relation', 'Company:relation', 'Conversation:relation'],
      views: ['Inbox'],
    })

    const rows = await mailRows(page)
    expect(rows.map((r) => r.title)).toEqual(['Autumn sale — 30 % off', 'Draft review'])
    const sale = rowBy(rows, 'Autumn sale — 30 % off')
    const localDate = await page.evaluate((ms) => {
      const d = new Date(ms)
      const p = (n: number) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
    }, env.box.mails[0].date)
    expect(sale.props).toEqual({
      From: 'Shop Team <news@shop.example.test>',
      To: 'Ada Lovelace <ada@example.com>',
      Date: { start: localDate, includeTime: true },
      Labels: ['Inbox', 'Promotions'],
      Unread: false,
      'Has attachments': true,
      'Gmail link': 'https://mail.google.com/mail/u/0/#all/m1',
      Thread: 't-m1',
      'Message ID': 'm1',
      'Show images': false,
      'Load attachment': '',
      Contact: [expect.any(String)],
      Company: [expect.any(String)],
      Conversation: [expect.any(String)],
    })
    const review = rowBy(rows, 'Draft review')
    expect(review.props).toMatchObject({ From: 'Bob Builder <bob@example.test>', Unread: true, 'Has attachments': false, Labels: ['Inbox'] })

    // the HTML body: sanitized, layout tables gone, data table kept, no remote image, no pixel, notice + button
    expect(nodes(sale.content, 'image')).toHaveLength(0)
    expect(sale.plain).not.toMatch(/Hidden preheader|alert|Smuggled block.*databaseBlock/)
    expect(nodes(sale.content, 'databaseBlock')).toHaveLength(0)
    expect(nodes(sale.content, 'table')).toHaveLength(1)
    expect(sale.plain).toContain('[Autumn sale banner]')
    expect(sale.plain).toContain('Everything 30 % off until Sunday.')
    expect(links(sale.content)).toEqual(['https://shop.example.test/sale'])
    const notice = nodes(sale.content, 'callout')[0]
    expect(JSON.stringify(notice)).toContain('1 image from the web is blocked')
    const button = nodes(sale.content, 'button')[0]
    expect(button.attrs.label).toBe('Load images')
    expect(button.attrs.actions[0]).toMatchObject({ type: 'edit_properties', values: [{ value: true }] })
    expect(sale.plain).toMatch(/1 attachment\s+invoice\.pdf · 120 KB/)
    // the text/plain body: paragraphs, line breaks, links
    expect(links(review.content)).toEqual(['https://docs.example.test/draft'])
    expect(nodes(review.content, 'paragraph').length).toBeGreaterThanOrEqual(3)

    // the row page: nothing is loaded from the web (remote images, pixels); the LED read-out in Settings
    await closeSettings(page)
    await gotoPage(page, sale.id)
    await expect(editorOf(page).getByRole('button', { name: 'Load images' })).toBeVisible()
    await expect(editorOf(page)).toContainText('[Autumn sale banner]')
    await page.waitForTimeout(400)
    expect(env.images).toEqual([])
    // organising is off: Claude never saw a thing
    expect(env.claude).toEqual([])
    // the sync state is per device and names no token
    const stored = await page.evaluate(() => window.__oneMail.stored())
    expect(stored).toMatchObject({ account: ACCOUNT, databaseId: cfg.databaseId, historyId: '1000', backlog: [] })
    expect(Object.keys(stored.known).sort()).toEqual(['m1', 'm2'])
  })

  test('connect failures are explained (blocked window, access denied); disconnect revokes the token', async ({ page }) => {
    await setup(page)
    await openApp(page)
    await configure(page)
    await page.evaluate(() => (window.__gisMode = 'popup'))
    const dialog = await openMailTab(page)
    await dialog.getByRole('button', { name: 'Connect Gmail' }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Google’s window was blocked — allow pop-ups for this site and try again.')
    await page.evaluate(() => (window.__gis.mode = 'deny'))
    await dialog.getByRole('button', { name: 'Connect Gmail' }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Access was not granted.')
    await page.evaluate(() => (window.__gis.mode = 'ok'))
    await dialog.getByRole('button', { name: 'Connect Gmail' }).click()
    await expect(dialog.getByTestId('mail-account')).toHaveText(ACCOUNT)
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Disconnect' }).click()
    await expect(dialog.getByRole('button', { name: 'Reconnect' })).toBeVisible()
    expect(await page.evaluate(() => window.__gis.revoked)).toEqual(['ya29.e2e-SECRET-TOKEN-1'])
    expect(await page.evaluate(() => window.__oneMail.state().connected)).toBe(false)
  })

  test('labels: a label added to the selection lists again; per-run limit keeps a backlog', async ({ page }) => {
    const env = await setup(page)
    await openApp(page)
    await configure(page, { maxPerRun: 25 })
    const dialog = await connect(page)
    await dialog.getByRole('button', { name: 'Sync now' }).click()
    await expect.poll(async () => (await mailRows(page)).length).toBe(2)
    await expect.poll(() => page.evaluate(() => window.__oneMail.state().phase)).toBe('idle')
    expect((await mailRows(page)).map((r) => r.title)).not.toContain('Quarterly numbers')
    env.box.take()

    // + Work → the date listing runs again for both labels; known mails are not fetched again
    await dialog.getByRole('button', { name: 'Work', exact: true }).click()
    await expect.poll(async () => (await mailCfg(page)).labels).toEqual(['INBOX', 'Label_work'])
    await dialog.getByRole('button', { name: 'Sync now' }).click()
    await expect.poll(async () => (await mailRows(page)).map((r) => r.title)).toContain('Quarterly numbers')
    await expect.poll(() => page.evaluate(() => window.__oneMail.state().phase)).toBe('idle')
    const calls = env.box.take()
    expect(calls.filter((c) => c.startsWith('messages?'))).toHaveLength(2)
    expect(calls.filter((c) => /^messages\/m\d\?format=full/.test(c))).toEqual(['messages/m5?format=full'])
    const work = rowBy(await mailRows(page), 'Quarterly numbers')
    expect(work.props.Labels).toEqual(['Work'])

    // a backlog: 3 more new mails with a limit of … the smallest is 25 — use the hook to lower it
    await wsEval(page, (s) => s.updateSettings({ mail: { ...s.settings.mail, maxPerRun: 25 } }))
    for (let i = 0; i < 27; i++) env.box.add({ id: `n${i}`, labelIds: ['INBOX'], date: Date.now() - i * 60_000, subject: `Bulk ${i}`, from: 'bulk@example.test', to: ACCOUNT, text: `Bulk mail ${i}` })
    await syncAndWait(page)
    expect((await mailRows(page)).filter((r) => r.title.startsWith('Bulk')).length).toBe(25)
    expect(await page.evaluate(() => window.__oneMail.state().backlog)).toBe(2)
    await syncAndWait(page)
    expect((await mailRows(page)).filter((r) => r.title.startsWith('Bulk')).length).toBe(27)
    expect(await page.evaluate(() => window.__oneMail.state().backlog)).toBe(0)
  })

  test('incremental sync via the history: only new mails are fetched, Gmail’s fields follow, the user’s edits stay; an expired history lists again', async ({ page, errors }) => {
    errors.allow(/status of 404/)
    const env = await setup(page)
    await openApp(page)
    await configure(page)
    await connect(page)
    await syncAndWait(page)
    const before = await mailRows(page)
    const sale = rowBy(before, 'Autumn sale — 30 % off')
    // the user edits the row: title, From, a note in the body
    await wsEval(
      page,
      (s, { id }) => {
        const db = s.databases[s.settings.mail.databaseId]
        const from = db.properties.find((p: AnyState) => p.name === 'From').id
        s.updatePage(id, { title: 'Sale (my title)' })
        s.setRowProperty(id, from, 'edited by me')
      },
      { id: sale.id },
    )
    env.box.take()

    // Gmail: a new mail, m2 read, m1 starred
    env.box.add({ id: 'm6', labelIds: ['INBOX', 'UNREAD'], date: Date.now() - 60_000, subject: 'Lunch?', from: 'carol@example.test', to: ACCOUNT, text: 'Lunch on Thursday?' })
    env.box.relabel('m2', [], ['UNREAD'])
    env.box.relabel('m1', ['STARRED'], [])
    await syncAndWait(page)
    const calls = env.box.take()
    expect(calls.some((c) => c.startsWith('history?startHistoryId=1000'))).toBe(true)
    expect(calls.filter((c) => c.startsWith('messages?'))).toEqual([])
    expect(calls.filter((c) => c.includes('format=full'))).toEqual(['messages/m6?format=full'])

    const rows = await mailRows(page)
    expect(rows.map((r) => r.title)).toEqual(['Draft review', 'Lunch?', 'Sale (my title)'])
    expect(rowBy(rows, 'Draft review').props.Unread).toBe(false)
    const edited = rowBy(rows, 'Sale (my title)')
    expect(edited.props.From).toBe('edited by me')
    expect(edited.props.Labels).toEqual(['Inbox', 'Promotions', 'Starred'])
    expect(rowBy(rows, 'Lunch?').props.Unread).toBe(true)
    expect((await page.evaluate(() => window.__oneMail.stored())).historyId).toBe(String(env.box.historyId))

    // a row deleted in One stays deleted (Gmail is never touched: read-only)
    await wsEval(page, (s, id) => s.deletePagePermanently(id), rowBy(rows, 'Lunch?').id)
    // the history is gone (Gmail keeps about a week): list from the date again — no duplicates, nothing back
    env.box.historyFloor = env.box.historyId + 1
    env.box.add({ id: 'm7', labelIds: ['INBOX'], date: Date.now() - 30_000, subject: 'After the gap', from: 'dan@example.test', to: ACCOUNT, text: 'Hello again.' })
    await syncAndWait(page)
    const again = env.box.take()
    expect(again.some((c) => c.startsWith('history?'))).toBe(true)
    expect(again.filter((c) => c.startsWith('messages?'))).toHaveLength(1)
    expect(again.filter((c) => c.includes('format=full'))).toEqual(['messages/m7?format=full'])
    expect((await mailRows(page)).map((r) => r.title)).toEqual(['After the gap', 'Draft review', 'Sale (my title)'])
  })

  test('load images: the notice button shows the remote images (tracking pixels stay out) and blocks them again', async ({ page }) => {
    const env = await setup(page)
    await openApp(page)
    await configure(page)
    await connect(page)
    await syncAndWait(page)
    await closeSettings(page)
    const sale = rowBy(await mailRows(page), 'Autumn sale — 30 % off')
    await gotoPage(page, sale.id)
    const editor = editorOf(page)
    await editor.getByRole('button', { name: 'Load images' }).click()
    await expect(editor.locator('img[src="https://img.example.test/hero.png"]')).toBeVisible()
    await expect(editor.getByRole('button', { name: 'Block images' })).toBeVisible()
    const row = rowBy(await mailRows(page), 'Autumn sale — 30 % off')
    expect(row.props['Show images']).toBe(true)
    expect(nodes(row.content, 'image').map((n) => n.attrs.src)).toEqual(['https://img.example.test/hero.png'])
    expect(env.images.every((u) => u.startsWith('https://img.example.test/'))).toBe(true)
    expect(env.images.length).toBeGreaterThan(0)
    // the cached copy was used: Gmail was not asked again
    expect(env.box.calls.filter((c) => c.startsWith('messages/m1'))).toEqual(['messages/m1?format=full'])

    await editor.getByRole('button', { name: 'Block images' }).click()
    await expect(editor.getByRole('button', { name: 'Load images' })).toBeVisible()
    await expect(editor.locator('img[src^="https://img.example.test/"]')).toHaveCount(0)
    expect(nodes(rowBy(await mailRows(page), 'Autumn sale — 30 % off').content, 'image')).toHaveLength(0)
  })

  test('organise with Claude: category, priority, needs reply, summary and project filled; the request carries mail content only when on', async ({ page }) => {
    const env = await setup(page)
    const sent: AnyState[] = []
    await page.unroute('https://api.anthropic.com/**')
    await page.route('https://api.anthropic.com/**', (route) => {
      const req = route.request()
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' } })
      const body = JSON.parse(req.postData() ?? '{}')
      sent.push(body)
      const prompt = String(body.messages?.[0]?.content ?? '')
      const ids = [...prompt.matchAll(/<mail id="([^"]+)">/g)].map((m) => m[1])
      const projects = JSON.parse(`[${prompt.match(/^Projects: (.*)$/m)?.[1] ?? ''}]`) as string[]
      const answer = {
        mails: ids.map((id) => ({
          id,
          category: id === 'm2' ? 'Todo' : 'Newsletter',
          priority: id === 'm2' ? 'high' : 'low',
          needsReply: id === 'm2',
          summary: id === 'm2' ? 'Bob asks for a draft review by Friday.' : 'Autumn sale, 30 % off.',
          ...(projects.length ? { project: id === 'm2' ? projects[0] : null } : {}),
        })),
      }
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
        body: JSON.stringify({ id: 'msg_mail', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify(answer) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 900, output_tokens: 120 } }),
      })
    })
    await openApp(page)
    await configure(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    const dialog = await connect(page)
    await dialog.getByRole('switch', { name: 'Organise new mails with Claude' }).click()
    await expect(dialog.getByText(/the subject, sender, date and text of each new mail go to Anthropic/)).toBeVisible()
    // each mail may belong to a row of the seeded "Projects" database
    const projectsDb = await wsEval(page, (s) => (Object.values(s.pages) as AnyState[]).find((p) => p.kind === 'database' && p.title === 'Projects' && !p.trashed)!.id as string)
    await dialog.getByLabel('Link each mail to').selectOption(projectsDb)
    const firstProject = await wsEval(
      page,
      (s, db) =>
        (Object.values(s.pages) as AnyState[])
          .filter((p) => p.databaseId === db && !p.trashed && p.title.trim())
          .map((p) => p.title.trim())[0],
      projectsDb,
    )
    await expect(dialog.getByTestId('mail-cost')).toContainText('up to 50 mails · OPUS 5.5')
    await expect(dialog.getByText('Invoice', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Sync now' }).click()
    await expect.poll(() => sent.length).toBeGreaterThan(0)
    await expect.poll(() => page.evaluate(() => window.__oneMail.state().phase)).toBe('idle')

    // one request for both mails; the mail content is in it (and nothing in the old mock route)
    expect(env.claude).toEqual([])
    expect(sent).toHaveLength(1)
    const prompt = String(sent[0].messages[0].content)
    expect(prompt).toContain('Can you review the draft by Friday?')
    expect(prompt).toContain('Subject: Autumn sale — 30 % off')
    expect(prompt).toContain('"Customer", "Invoice", "Newsletter", "Personal", "Notification", "Todo"')
    expect(sent[0].output_config.format.type).toBe('json_schema')
    expect(sent[0].mcp_servers).toBeUndefined()

    const rows = await mailRows(page)
    expect(rowBy(rows, 'Draft review').props).toMatchObject({ Category: 'Todo', Priority: 'High', 'Needs reply': true, Summary: 'Bob asks for a draft review by Friday.' })
    expect(prompt).toContain(`Projects: ${JSON.stringify(firstProject)}`)
    const projectRow = await wsEval(page, (s, { db, title }) => (Object.values(s.pages) as AnyState[]).find((p) => p.databaseId === db && p.title.trim() === title)!.id, { db: projectsDb, title: firstProject })
    expect(rowBy(rows, 'Draft review').props.Project).toEqual([projectRow])
    expect(rowBy(rows, 'Autumn sale — 30 % off').props.Project ?? []).toEqual([])
    expect(rowBy(rows, 'Autumn sale — 30 % off').props).toMatchObject({ Category: 'Newsletter', Priority: 'Low', Summary: 'Autumn sale, 30 % off.' })
    const views = await wsEval(page, (s) => s.databases[s.settings.mail.databaseId].views.map((v: AnyState) => `${v.name}:${v.type}`))
    expect(views).toEqual(['Inbox:table', 'By category:board'])

    // re-sync: already organised mails are never sent again; a field the user set stays
    const draft = rowBy(rows, 'Draft review')
    await wsEval(
      page,
      (s, id) => {
        const db = s.databases[s.settings.mail.databaseId]
        const sum = db.properties.find((p: AnyState) => p.name === 'Summary').id
        s.setRowProperty(id, sum, 'My own summary')
      },
      draft.id,
    )
    env.box.add({ id: 'm8', labelIds: ['INBOX'], date: Date.now() - 1000, subject: 'Invoice 2026-114', from: 'billing@example.test', to: ACCOUNT, text: 'Please find the invoice attached.' })
    await syncAndWait(page)
    expect(sent).toHaveLength(2)
    const second = String(sent[1].messages[0].content)
    expect(second).toContain('<mail id="m8">')
    expect(second).not.toContain('<mail id="m2">')
    expect(rowBy(await mailRows(page), 'Draft review').props.Summary).toBe('My own summary')

    // off again: the next mail goes nowhere but the database
    await dialog.getByRole('switch', { name: 'Organise new mails with Claude' }).click()
    env.box.add({ id: 'm9', labelIds: ['INBOX'], date: Date.now() - 500, subject: 'Private note', from: 'eve@example.test', to: ACCOUNT, text: 'Nothing for Claude.' })
    await syncAndWait(page)
    expect(sent).toHaveLength(2)
    expect((await mailRows(page)).map((r) => r.title)).toContain('Private note')
  })

  test('organise earlier mails: synced while off, organised on request in one request', async ({ page }) => {
    const env = await setup(page)
    const sent = await routeClaude(page)
    await openApp(page)
    await configure(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    const dialog = await connect(page)
    await dialog.getByRole('button', { name: 'Sync now' }).click()
    await expect.poll(async () => (await mailRows(page)).length).toBe(2)
    await expect.poll(() => page.evaluate(() => window.__oneMail.state().phase)).toBe('idle')
    expect(sent).toHaveLength(0)
    expect(env.claude).toEqual([])
    await dialog.getByRole('switch', { name: 'Organise new mails with Claude' }).click()
    await dialog.getByRole('button', { name: 'Organise 2 earlier mails' }).click()
    await expect.poll(() => page.evaluate(() => window.__oneMail.state().unorganised)).toBe(0)
    expect(sent).toHaveLength(1)
    const rows = await mailRows(page)
    expect(rowBy(rows, 'Draft review').props).toMatchObject({ Category: 'Todo', Priority: 'High', 'Needs reply': true })
    expect(rowBy(rows, 'Autumn sale — 30 % off').props).toMatchObject({ Category: 'Newsletter', Priority: 'Low' })
    await expect(dialog.getByRole('button', { name: /earlier mail/ })).toHaveCount(0)
  })

  test('the token expires mid-run: the run stops, asks for a new sign-in, and the next run fetches what was left', async ({ page, errors }) => {
    errors.allow(/status of 401/)
    const env = await setup(page)
    await openApp(page)
    await configure(page)
    const dialog = await connect(page)
    env.box.authFailAfter = 1
    await dialog.getByRole('button', { name: 'Sync now' }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Google’s sign-in expired — reconnect to continue.')
    await expect(dialog.getByRole('button', { name: 'Reconnect' })).toBeVisible()
    expect(await page.evaluate(() => window.__oneMail.state().connected)).toBe(false)
    expect((await page.evaluate(() => window.__oneMail.stored())).backlog.sort()).toEqual(['m1', 'm2'])
    expect(await mailRows(page)).toHaveLength(0)
    // "Sync now" signs in again (the known account as hint) and finishes the job
    await dialog.getByRole('button', { name: 'Sync now' }).click()
    await expect.poll(async () => (await mailRows(page)).length).toBe(2)
    await expect.poll(() => page.evaluate(() => window.__oneMail.state().phase)).toBe('idle')
    expect(await page.evaluate(() => window.__gis.calls.map((c) => c.hint))).toEqual([null, ACCOUNT])
    await expect(dialog.getByRole('alert')).toHaveCount(0)
  })

  test('when One opens: after a reload one click signs in again (no token survives) and syncs', async ({ page }) => {
    const env = await setup(page)
    await openApp(page)
    await configure(page, { auto: 'open' })
    await connect(page)
    await syncAndWait(page)
    await closeSettings(page)
    env.box.add({ id: 'm6', labelIds: ['INBOX', 'UNREAD'], date: Date.now() - 60_000, subject: 'Lunch?', from: 'carol@example.test', to: ACCOUNT, text: 'Lunch on Thursday?' })
    await reloadApp(page)
    // the token did not survive the reload: nothing was synced on its own, one click does it
    expect(await page.evaluate(() => window.__oneMail.state().connected)).toBe(false)
    await expect(page.getByText(`Gmail: sign in again to sync ${ACCOUNT}`)).toBeVisible()
    expect((await mailRows(page)).map((r) => r.title)).not.toContain('Lunch?')
    await page.getByRole('button', { name: 'Sync', exact: true }).click()
    await expect.poll(async () => (await mailRows(page)).map((r) => r.title)).toContain('Lunch?')
    // Google was asked again for the known account
    expect(await page.evaluate(() => window.__gis.calls.map((c) => c.hint))).toEqual([ACCOUNT])
    expect(env.box.calls.some((c) => c.startsWith('history?'))).toBe(true)
  })

  test('429: Gmail’s rate limit is waited out with backoff and the run completes', async ({ page, errors }) => {
    errors.allow(/status of 429/)
    const env = await setup(page)
    await openApp(page)
    await configure(page)
    await connect(page)
    env.box.fail429 = 3
    const started = Date.now()
    await syncAndWait(page)
    // two waits of Retry-After: 1 s (both first fetches, then one of the retries)
    expect(Date.now() - started).toBeGreaterThanOrEqual(1900)
    expect((await mailRows(page)).map((r) => r.title)).toEqual(['Autumn sale — 30 % off', 'Draft review'])
    expect(env.box.fail429).toBe(0)
    expect(await page.evaluate(() => window.__oneMail.state().error)).toBeNull()
  })

  test('the access token is never stored: not in settings, local / session storage, IndexedDB, caches or cookies', async ({ page, context }) => {
    const env = await setup(page)
    await openApp(page)
    await configure(page)
    await connect(page)
    await syncAndWait(page)
    await flush(page)
    expect([...env.box.tokens].every((x) => x.startsWith('ya29.e2e-SECRET-TOKEN-'))).toBe(true)
    const dump = await page.evaluate(async () => {
      const out: string[] = []
      for (let i = 0; i < localStorage.length; i++) out.push(`${localStorage.key(i)}=${localStorage.getItem(localStorage.key(i)!)}`)
      for (let i = 0; i < sessionStorage.length; i++) out.push(`${sessionStorage.key(i)}=${sessionStorage.getItem(sessionStorage.key(i)!)}`)
      const dbs = (await indexedDB.databases()) ?? []
      for (const info of dbs) {
        if (!info.name) continue
        const db = await new Promise<IDBDatabase>((res, rej) => {
          const r = indexedDB.open(info.name!)
          r.onsuccess = () => res(r.result)
          r.onerror = () => rej(r.error)
        })
        for (const store of [...db.objectStoreNames]) {
          const values = await new Promise<unknown[]>((res, rej) => {
            const r = db.transaction(store, 'readonly').objectStore(store).getAll()
            r.onsuccess = () => res(r.result)
            r.onerror = () => rej(r.error)
          })
          const keys = await new Promise<unknown[]>((res, rej) => {
            const r = db.transaction(store, 'readonly').objectStore(store).getAllKeys()
            r.onsuccess = () => res(r.result)
            r.onerror = () => rej(r.error)
          })
          out.push(`${info.name}/${store}: ${JSON.stringify(keys)} ${JSON.stringify(values, (_k, v) => (v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? '[bytes]' : v))}`)
        }
        db.close()
      }
      for (const name of await caches.keys()) {
        const c = await caches.open(name)
        for (const req of await c.keys()) out.push(`cache ${req.url} ${await (await c.match(req))!.text()}`)
      }
      out.push(document.cookie)
      return out.join('\n')
    })
    expect(dump).toContain('one-mail/kv')
    expect(dump).toContain(ACCOUNT)
    expect(dump).not.toContain('ya29.')
    expect(dump).not.toContain('SECRET-TOKEN')
    expect(JSON.stringify(await context.cookies())).not.toContain('ya29.')
    expect(JSON.stringify(await mailCfg(page))).not.toContain('ya29.')
  })
})

/* ------------------------------------------------------------------ */
/* One's built-in Google client (turned on through the ?e2e test seam)  */
/* ------------------------------------------------------------------ */

const BUILTIN_ID = '987654321098-onebuiltinclient01.apps.googleusercontent.com'

/** One's built-in client at this origin (features/mail/builtin.ts — ?e2e only, kept across reloads). */
async function builtinOn(page: Page) {
  await page.evaluate((id) => window.__oneMail.builtin(id), BUILTIN_ID)
}

test.describe('Mail — One’s built-in Google client', () => {
  test('one click: READY · ONE ACCESS, Connect signs in with the built-in client, the first sync creates Mails; the own client waits behind “advanced”', async ({ page }) => {
    const env = await setup(page)
    await openApp(page)
    await builtinOn(page)
    await configure(page, { clientId: '' })
    const dialog = await openMailTab(page)
    const access = dialog.locator('.ml-panel').first()
    await expect(access.getByRole('status')).toHaveText('Ready · One access')
    await expect(access.getByTestId('mail-one-access')).toContainText('One connects to Gmail with its own Google access')
    await expect(access.getByTestId('mail-one-access')).toContainText('click Continue')
    // the 5 steps and the client-ID field stay folded away
    await expect(dialog.getByText('Set up your Google client')).toHaveCount(0)
    const own = dialog.getByTestId('mail-own-client')
    await expect(own).not.toHaveAttribute('open', '')
    await expect(dialog.getByLabel('OAuth client ID')).toBeHidden()
    await expect(dialog.getByText('Enable the Gmail API for that project.')).toBeHidden()
    expect(env.gis.loads()).toBe(0)

    await dialog.getByRole('button', { name: 'Connect Gmail' }).click()
    await expect(dialog.getByTestId('mail-account')).toHaveText(ACCOUNT)
    await expect(access.getByRole('status')).toHaveText('Connected · One access')
    expect(await page.evaluate(() => window.__gis.calls)).toEqual([{ client_id: BUILTIN_ID, scope: 'https://www.googleapis.com/auth/gmail.readonly', prompt: '', hint: null }])

    await dialog.getByRole('button', { name: 'Sync now' }).click()
    await expect.poll(() => page.evaluate(() => window.__oneMail.state().phase)).toBe('idle')
    await expect(page.getByText('2 new mails')).toBeVisible()
    expect((await mailRows(page)).map((r) => r.title)).toEqual(['Autumn sale — 30 % off', 'Draft review'])
    const cfg = await mailCfg(page)
    expect(cfg.clientId).toBe('')
    expect(cfg.databaseId).toBeTruthy()

    // "advanced" opens the steps and the field
    await own.getByText('Use your own Google client (advanced)').click()
    await expect(dialog.getByLabel('OAuth client ID')).toBeVisible()
    await expect(own.getByText('Enable the Gmail API for that project.')).toBeVisible()

    // the seam survives a reload (?e2e) — the next connect asks Google for the known account
    await closeSettings(page)
    await reloadApp(page)
    const again = await openMailTab(page)
    await expect(again.locator('.ml-panel').first().getByRole('status')).toHaveText('Ready · One access')
    await expect(again.getByRole('button', { name: 'Reconnect' })).toBeEnabled()
  })

  test('an own client ID overrides the built-in one; “Back to One’s access” returns and keeps the database and the sync settings', async ({ page }) => {
    await setup(page)
    await openApp(page)
    await builtinOn(page)
    await configure(page, { clientId: '', maxPerRun: 100 })
    const dialog = await openMailTab(page)
    const access = dialog.locator('.ml-panel').first()
    await dialog.getByTestId('mail-own-client').getByText('Use your own Google client (advanced)').click()
    const field = dialog.getByLabel('OAuth client ID')
    await field.fill(CLIENT_ID)
    await field.press('Enter')
    await expect.poll(async () => (await mailCfg(page)).clientId).toBe(CLIENT_ID)
    // the own layout: plain READY, the field (focus kept), the way back
    await expect(access.getByRole('status')).toHaveText('Ready')
    await expect(dialog.getByTestId('mail-one-access')).toHaveCount(0)
    await expect(dialog.getByLabel('OAuth client ID')).toBeFocused()
    const back = dialog.getByRole('button', { name: 'Back to One’s access' })
    await expect(back).toBeVisible()

    await dialog.getByRole('button', { name: 'Connect Gmail' }).click()
    await expect(dialog.getByTestId('mail-account')).toHaveText(ACCOUNT)
    await expect(access.getByRole('status')).toHaveText('Connected')
    await syncAndWait(page)
    const before = await mailCfg(page)
    expect(before.databaseId).toBeTruthy()

    await back.click()
    await expect.poll(async () => (await mailCfg(page)).clientId).toBe('')
    const after = await mailCfg(page)
    expect(after).toMatchObject({ databaseId: before.databaseId, labels: before.labels, from: before.from, maxPerRun: 100 })
    // the own client's token is revoked; One's access is back, Connect has the focus
    expect(await page.evaluate(() => window.__gis.revoked)).toEqual(['ya29.e2e-SECRET-TOKEN-1'])
    await expect(access.getByRole('status')).toHaveText('Ready · One access')
    const reconnect = dialog.getByRole('button', { name: 'Reconnect' })
    await expect(reconnect).toBeFocused()
    await reconnect.click()
    await expect(dialog.getByTestId('mail-account')).toHaveText(ACCOUNT)
    expect(await page.evaluate(() => window.__gis.calls.map((c) => c.client_id))).toEqual([CLIENT_ID, BUILTIN_ID])
    expect((await mailRows(page)).length).toBe(2)
  })

  test('Google refuses the built-in client (access denied, the window closed): the review message, and its button opens the advanced part', async ({ page }) => {
    await setup(page)
    await openApp(page)
    await builtinOn(page)
    await configure(page, { clientId: '' })
    await page.evaluate(() => (window.__gisMode = 'deny'))
    const dialog = await openMailTab(page)
    const connect = dialog.getByRole('button', { name: 'Connect Gmail' })
    await connect.click()
    const alert = dialog.getByRole('alert')
    await expect(alert).toHaveText(/^Google did not allow this account yet: One’s Google access is still in Google’s review, and only approved accounts can use it\. Ask the operator to add your address, or use your own Google client \(advanced\)\.$/)
    const useOwn = dialog.getByRole('button', { name: 'Use your own Google client', exact: true })
    await expect(useOwn).toBeVisible()
    // the window closed (after Google's refusal page — GIS can't tell): one message that covers both
    await page.evaluate(() => (window.__gis.mode = 'closed'))
    await connect.click()
    await expect(alert).toContainText('Google’s window closed before access was granted. If Google said the app is blocked or not verified')
    await useOwn.click()
    const own = dialog.getByTestId('mail-own-client')
    await expect(own).toHaveAttribute('open', '')
    await expect(own.locator('summary')).toBeFocused()
    await expect(dialog.getByLabel('OAuth client ID')).toBeVisible()
    // a blocked pop-up is no refusal: today's message, no detour
    await page.evaluate(() => (window.__gis.mode = 'popup'))
    await connect.click()
    await expect(alert).toHaveText('Google’s window was blocked — allow pop-ups for this site and try again.')
    await expect(useOwn).toHaveCount(0)
    // an own client after a refusal: the old message goes
    await page.evaluate(() => (window.__gis.mode = 'deny'))
    await connect.click()
    await expect(useOwn).toBeVisible()
    await dialog.getByLabel('OAuth client ID').fill(CLIENT_ID)
    await dialog.getByLabel('OAuth client ID').press('Enter')
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    // with the own client, a refusal reads as before
    await connect.click()
    await expect(dialog.getByRole('alert')).toHaveText('Access was not granted.')
    await expect(useOwn).toHaveCount(0)
  })

  test('German: BEREIT · ONE-ZUGANG, Gmail verbinden, the advanced part', async ({ page }) => {
    await setup(page)
    await openApp(page)
    await builtinOn(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const dialog = await openMailTab(page, /E-Mail$/)
    const access = dialog.locator('.ml-panel').first()
    await expect(access.getByRole('status')).toHaveText('Bereit · One-Zugang')
    await expect(access.getByTestId('mail-one-access')).toContainText('One verbindet sich mit seinem eigenen Google-Zugang mit Gmail')
    await expect(access.getByTestId('mail-one-access')).toContainText('„Weiter“')
    await expect(dialog.getByRole('button', { name: 'Gmail verbinden' })).toBeEnabled()
    await dialog.getByText('Eigenen Google-Client verwenden (erweitert)').click()
    await expect(dialog.getByLabel('OAuth-Client-ID')).toBeVisible()
    await page.evaluate(() => (window.__gisMode = 'deny'))
    await dialog.getByRole('button', { name: 'Gmail verbinden' }).click()
    await expect(dialog.getByRole('alert')).toContainText('Google hat dieses Konto noch nicht zugelassen')
    await expect(dialog.getByRole('button', { name: 'Eigenen Google-Client verwenden', exact: true })).toBeVisible()
  })

  test('without ?e2e the test seam is unreachable: the tab is the own-client setup', async ({ page }) => {
    await setup(page)
    await page.goto('app/')
    await expect(page.locator('#boot')).toHaveCount(0)
    await expect(page.locator('.app')).toBeVisible()
    await page.evaluate((id) => localStorage.setItem('one.mail.builtin-e2e', id), BUILTIN_ID)
    await page.reload()
    await expect(page.locator('.app')).toBeVisible()
    expect(await page.evaluate(() => typeof (window as unknown as { __oneMail?: unknown }).__oneMail)).toBe('undefined')
    await page.keyboard.press('Control+,')
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('tab', { name: /Mail$/ }).click()
    await expect(dialog.getByText('Set up your Google client')).toBeVisible()
    await expect(dialog.getByTestId('mail-one-access')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Connect Gmail' })).toBeDisabled()
  })

  test.describe('390 px', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    test('the one-click block fits the phone: Connect reachable, no sideways scroll, the advanced part opens', async ({ page }) => {
      await setup(page)
      await openApp(page)
      await builtinOn(page)
      const dialog = await openMailTab(page)
      const access = dialog.locator('.ml-panel').first()
      await expect(access.getByRole('status')).toHaveText('Ready · One access')
      const connect = dialog.getByRole('button', { name: 'Connect Gmail' })
      await connect.scrollIntoViewIfNeeded()
      await expect(connect).toBeInViewport()
      const box = await access.boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(390)
      expect(await access.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      await dialog.getByTestId('mail-own-client').locator('summary').click()
      await expect(dialog.getByLabel('OAuth client ID')).toBeVisible()
      expect(await access.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      await connect.click()
      await expect(dialog.getByTestId('mail-account')).toHaveText(ACCOUNT)
      expect(await page.evaluate(() => window.__gis.calls.map((c) => c.client_id))).toEqual([BUILTIN_ID])
    })
  })
})

/* ------------------------------------------------------------------ */
/* Contacts, companies, conversations (features/mail/people.ts)         */
/* ------------------------------------------------------------------ */

/** 6 mails: Felix (firma.de) and Paul (mueller-gmbh.de) in two threads with replies, Mia from gmail.com, one sent by Ada. */
function peopleMails(now: number): MockMail[] {
  return [
    { id: 'c1', labelIds: ['INBOX'], date: now - 6 * DAY, subject: 'Angebot P2', from: 'Felix Merz <felix@firma.de>', to: ACCOUNT, text: 'Hier das Angebot.', thread: 'T1' },
    { id: 'c2', labelIds: ['SENT'], date: now - 5 * DAY, subject: 'Re: Angebot P2', from: `Ada Lovelace <${ACCOUNT}>`, to: 'Felix Merz <felix@firma.de>', text: 'Danke!', thread: 'T1' },
    { id: 'c3', labelIds: ['INBOX'], date: now - 4 * DAY, subject: 'AW: Angebot P2', from: '"Merz, Felix" <Felix@Firma.de>', to: ACCOUNT, text: 'Gern.', thread: 'T1' },
    { id: 'c4', labelIds: ['INBOX'], date: now - 3 * DAY, subject: 'Termin Dienstag', from: 'Paul König <paul@mail.mueller-gmbh.de>', to: ACCOUNT, text: 'Passt Dienstag?', thread: 'T2' },
    { id: 'c5', labelIds: ['INBOX'], date: now - 2 * DAY, subject: 'Re: Termin Dienstag', from: 'Felix Merz <felix@firma.de>', to: `${ACCOUNT}, paul@mueller-gmbh.de`, text: 'Ich komme auch.', thread: 'T2' },
    { id: 'c6', labelIds: ['INBOX'], date: now - 1 * DAY, subject: 'Fotos vom Wochenende', from: 'mia.schulz@gmail.com', to: ACCOUNT, text: 'Anbei die Fotos.' },
  ]
}

const SYSTEM = { contacts: 'mail-contacts', companies: 'mail-companies', conversations: 'mail-conversations' } as const

/** A directory (found by its marker): rows by title, values by property NAME, relations as sorted titles. */
async function directory(page: Page, kind: keyof typeof SYSTEM): Promise<AnyState[]> {
  return wsEval(
    page,
    (s, sys) => {
      const db = (Object.values(s.databases) as AnyState[]).find((d) => d.system === sys && !s.pages[d.id]?.trashed)
      if (!db) return []
      const title = (id: string) => s.pages[id]?.title
      return (Object.values(s.pages) as AnyState[])
        .filter((p) => p.databaseId === db.id && !p.trashed)
        .map((p) => {
          const props: AnyState = {}
          for (const d of db.properties) {
            if (d.type === 'title' || d.type === 'rollup') continue
            const v = p.properties[d.id]
            props[d.name] = d.type === 'relation' ? (v ?? []).map(title).sort() : (v ?? null)
          }
          return { id: p.id, title: p.title, props }
        })
        .sort((a, b) => a.title.localeCompare(b.title))
    },
    SYSTEM[kind],
  )
}

/** Mail title → [contact, company, conversation] names (null = not linked). */
async function mailLinks(page: Page): Promise<Record<string, Array<string | null>>> {
  return wsEval(page, (s) => {
    const cfg = s.settings.mail
    const out: Record<string, Array<string | null>> = {}
    for (const p of Object.values(s.pages) as AnyState[]) {
      if (p.databaseId !== cfg.databaseId || p.trashed) continue
      out[p.title] = ['contact', 'company', 'conversation'].map((role) => {
        const id = cfg.props?.[role] ? (p.properties[cfg.props[role]] ?? [])[0] : null
        return id ? s.pages[id]?.title ?? null : null
      })
    }
    return out
  })
}

const counts = async (page: Page) => [(await directory(page, 'contacts')).length, (await directory(page, 'companies')).length, (await directory(page, 'conversations')).length]

test.describe('Mail — contacts, companies, conversations', () => {
  test('the sync fills Contacts (names from headers), Companies (by domain, not gmail.com), Conversations (subject without Re:) and links each mail; a re-sync adds no duplicates', async ({ page }) => {
    const env = await setup(page, peopleMails)
    await openApp(page)
    await configure(page, { labels: ['INBOX', 'SENT'] })
    await connect(page)
    await syncAndWait(page)
    await expect(page.getByText('6 new mails')).toBeVisible()

    const contacts = await directory(page, 'contacts')
    expect(contacts.map((c) => [c.title, c.props['E-mail'], c.props.Company])).toEqual([
      ['Felix Merz', 'felix@firma.de', ['Firma']],
      ['Mia Schulz', 'mia.schulz@gmail.com', []],
      ['Paul König', 'paul@mail.mueller-gmbh.de', ['Mueller GmbH']],
    ])
    expect(contacts[0].props.Mails).toEqual(['AW: Angebot P2', 'Angebot P2', 'Re: Angebot P2', 'Re: Termin Dienstag'])
    const companies = await directory(page, 'companies')
    expect(companies.map((c) => [c.title, c.props.Domains, c.props.Contacts, c.props.Mails.length])).toEqual([
      ['Firma', 'firma.de', ['Felix Merz'], 4],
      ['Mueller GmbH', 'mueller-gmbh.de', ['Paul König'], 1],
    ])
    const conversations = await directory(page, 'conversations')
    expect(conversations.map((c) => [c.title, c.props.People, c.props.Mails.length])).toEqual([
      ['Angebot P2', ['Felix Merz'], 3],
      ['Fotos vom Wochenende', ['Mia Schulz'], 1],
      ['Termin Dienstag', ['Felix Merz', 'Paul König'], 2],
    ])
    expect(conversations.map((c) => c.props['Thread id']).sort()).toEqual(['T1', 'T2', 't-c6'])
    // every mail names its contact, company, conversation — Ada's own reply names whom it went to
    expect(await mailLinks(page)).toEqual({
      'Angebot P2': ['Felix Merz', 'Firma', 'Angebot P2'],
      'Re: Angebot P2': ['Felix Merz', 'Firma', 'Angebot P2'],
      'AW: Angebot P2': ['Felix Merz', 'Firma', 'Angebot P2'],
      'Termin Dienstag': ['Paul König', 'Mueller GmbH', 'Termin Dienstag'],
      'Re: Termin Dienstag': ['Felix Merz', 'Firma', 'Termin Dienstag'],
      'Fotos vom Wochenende': ['Mia Schulz', null, 'Fotos vom Wochenende'],
    })
    // "Last mail" is computed (a rollup over the mails' Date)
    const rollups = await wsEval(page, (s) => (Object.values(s.databases) as AnyState[]).filter((d) => String(d.system).startsWith('mail-')).map((d) => d.properties.filter((p: AnyState) => p.type === 'rollup').map((p: AnyState) => `${p.name}:${p.rollup.fn}`)))
    expect(rollups).toEqual([['Last mail:latest_date'], ['Last mail:latest_date'], ['Last mail:latest_date']])
    // the Mails table shows names, the Settings tab lists the three databases
    const dialog = await openMailTab(page)
    await expect(dialog.getByTestId('mail-dir-contacts')).toContainText('3 entries')
    await expect(dialog.getByTestId('mail-dir-companies')).toContainText('2 entries')
    await expect(dialog.getByTestId('mail-dir-conversations')).toContainText('3 entries')
    await closeSettings(page)
    const cfg = await mailCfg(page)
    await gotoPage(page, cfg.databaseId)
    await expect(page.locator('#main .db').first()).toContainText('Mueller GmbH')
    await expect(page.locator('#main .db').first()).toContainText('Termin Dienstag')

    // a new reply in thread T1, then a reset (everything listed again): no duplicates
    env.box.add({ id: 'c7', labelIds: ['INBOX'], date: Date.now() - 60_000, subject: 'Re: Angebot P2', from: 'Felix Merz <felix@firma.de>', to: ACCOUNT, text: 'Noch eine Frage.', thread: 'T1' })
    await syncAndWait(page)
    expect(await counts(page)).toEqual([3, 2, 3])
    expect((await directory(page, 'conversations'))[0].props.Mails).toHaveLength(4)
    await page.evaluate(() => window.__oneMail.reset())
    await syncAndWait(page)
    expect(await counts(page)).toEqual([3, 2, 3])
    expect((await directory(page, 'contacts'))[0].props.Mails).toHaveLength(5)
    expect((await mailRows(page)).length).toBe(7)
  })

  test('rename a company: every mail shows the new name; merge two contacts: addresses and links move, Undo restores', async ({ page }) => {
    await setup(page, peopleMails)
    await openApp(page)
    await configure(page, { labels: ['INBOX', 'SENT'] })
    await connect(page)
    await syncAndWait(page)
    const firma = (await directory(page, 'companies')).find((c) => c.title === 'Firma')!
    await wsEval(page, (s, id) => s.updatePage(id, { title: 'Firma Merz & Co' }), firma.id)
    const links = await mailLinks(page)
    expect(['Angebot P2', 'Re: Angebot P2', 'AW: Angebot P2', 'Re: Termin Dienstag'].map((m) => links[m][1])).toEqual(Array(4).fill('Firma Merz & Co'))
    await closeSettings(page)
    await gotoPage(page, (await mailCfg(page)).databaseId)
    await expect(page.locator('#main .db').first()).toContainText('Firma Merz & Co')

    // Settings → Mail → Contacts → Merge… Mia into Felix
    const dialog = await openMailTab(page)
    await dialog.getByTestId('mail-dir-contacts').getByRole('button', { name: /^Merge…/ }).click()
    const merge = page.getByRole('dialog', { name: 'Merge two entries' })
    await expect(merge.getByRole('button', { name: 'Merge', exact: true })).toBeDisabled()
    await merge.getByLabel('Merge', { exact: true }).selectOption({ label: 'Mia Schulz — mia.schulz@gmail.com' })
    await merge.getByLabel('into', { exact: true }).selectOption({ label: 'Felix Merz — felix@firma.de' })
    await merge.getByRole('button', { name: 'Merge', exact: true }).click()
    await expect(merge).toHaveCount(0)
    await expect(page.getByText('Merged “Mia Schulz” into “Felix Merz”')).toBeVisible()
    let contacts = await directory(page, 'contacts')
    expect(contacts.map((c) => c.title)).toEqual(['Felix Merz', 'Paul König'])
    expect(contacts[0].props['E-mail']).toBe('felix@firma.de, mia.schulz@gmail.com')
    expect(contacts[0].props.Mails).toContain('Fotos vom Wochenende')
    expect((await mailLinks(page))['Fotos vom Wochenende'][0]).toBe('Felix Merz')
    expect((await directory(page, 'conversations')).find((c) => c.title === 'Fotos vom Wochenende')!.props.People).toEqual(['Felix Merz'])
    await expect(dialog.getByTestId('mail-dir-contacts')).toContainText('2 entries')

    // Undo
    await page.locator('.toast').getByRole('button', { name: 'Undo' }).click()
    contacts = await directory(page, 'contacts')
    expect(contacts.map((c) => c.title)).toEqual(['Felix Merz', 'Mia Schulz', 'Paul König'])
    expect(contacts[0].props['E-mail']).toBe('felix@firma.de')
    expect(contacts[0].props.Mails).not.toContain('Fotos vom Wochenende')
    expect((await mailLinks(page))['Fotos vom Wochenende'][0]).toBe('Mia Schulz')
    expect((await directory(page, 'conversations')).find((c) => c.title === 'Fotos vom Wochenende')!.props.People).toEqual(['Mia Schulz'])
  })

  test('switched off: no directories, no links; switched on: earlier mails are linked (backfill); freemail domains are editable; off again: new mails stay unlinked', async ({ page }) => {
    const env = await setup(page, peopleMails)
    await openApp(page)
    await configure(page, { labels: ['INBOX', 'SENT'], people: { enabled: false } })
    const dialog = await connect(page)
    await syncAndWait(page)
    expect(await counts(page)).toEqual([0, 0, 0])
    expect(Object.values(await mailLinks(page)).flat().every((x) => x === null)).toBe(true)

    // firma.de is no company here (edited list), a typo is refused
    const panel = dialog.locator('.ml-panel').nth(2)
    await expect(panel.getByRole('status')).toHaveText('Off')
    const sw = panel.getByRole('switch', { name: 'Link mails to contacts, companies and conversations' })
    await sw.click()
    await expect(panel.getByRole('status')).toHaveText('On')
    await expect.poll(() => counts(page)).toEqual([3, 2, 3])
    await expect.poll(() => page.evaluate(() => window.__oneMail.state().phase)).toBe('idle')
    expect((await mailLinks(page))['Angebot P2']).toEqual(['Felix Merz', 'Firma', 'Angebot P2'])
    const free = panel.getByTestId('mail-freemail')
    await free.locator('summary').click()
    const add = free.getByLabel('Add domain')
    await add.fill('not a domain')
    await add.press('Enter')
    await expect(free.getByRole('alert')).toHaveText('Not a domain — e.g. “gmx.de” or “yahoo.*”.')
    await add.fill('@Neu-Mail.de')
    await add.press('Enter')
    await expect(free.getByText('neu-mail.de', { exact: true })).toBeVisible()
    expect((await mailCfg(page)).people.freemail).toContain('neu-mail.de')

    // off: a new mail stays unlinked
    await sw.click()
    await expect(panel.getByRole('status')).toHaveText('Off')
    env.box.add({ id: 'c8', labelIds: ['INBOX'], date: Date.now() - 60_000, subject: 'Hallo', from: 'Nora Neu <nora@neu-mail.de>', to: ACCOUNT, text: 'Hallo!' })
    await syncAndWait(page)
    expect((await mailLinks(page)).Hallo).toEqual([null, null, null])
    // on again: linked — a contact without a company (neu-mail.de is freemail now)
    await sw.click()
    await expect.poll(async () => (await mailLinks(page)).Hallo).toEqual(['Nora Neu', null, 'Hallo'])
    expect(await counts(page)).toEqual([4, 2, 4])
  })

  test('German: Kontakte, Firmen, Konversationen; the Mails database’s Kontakt / Firma / Konversation', async ({ page }) => {
    await setup(page, peopleMails)
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await configure(page, { labels: ['INBOX', 'SENT'] })
    const dialog = await openMailTab(page, /E-Mail$/)
    await dialog.getByRole('button', { name: 'Gmail verbinden' }).click()
    await expect(dialog.getByTestId('mail-account')).toHaveText(ACCOUNT)
    await syncAndWait(page)
    const titles = await wsEval(page, (s) => (Object.values(s.databases) as AnyState[]).filter((d) => String(d.system).startsWith('mail-')).map((d) => [s.pages[d.id].title, d.properties.map((p: AnyState) => p.name)]))
    expect(titles).toEqual([
      ['Kontakte', ['Name', 'E-Mail', 'Notizen', 'Firma', 'Mails', 'Letzte Mail']],
      ['Firmen', ['Name', 'Domains', 'Kontakte', 'Mails', 'Letzte Mail']],
      ['Konversationen', ['Name', 'Thread-ID', 'Personen', 'Mails', 'Letzte Mail']],
    ])
    const mailProps = await wsEval(page, (s) => s.databases[s.settings.mail.databaseId].properties.map((p: AnyState) => p.name))
    expect(mailProps).toEqual(expect.arrayContaining(['Kontakt', 'Firma', 'Konversation', 'Thread-ID']))
    const panel = dialog.locator('.ml-panel').nth(2)
    await expect(panel).toContainText('Kontakte & Firmen')
    await expect(panel.getByRole('switch', { name: 'Mails mit Kontakten, Firmen und Konversationen verknüpfen' })).toBeChecked()
    await expect(dialog.getByTestId('mail-dir-companies')).toContainText('2 Einträge')
    await dialog.getByTestId('mail-dir-contacts').getByRole('button', { name: /^Zusammenführen…/ }).click()
    await expect(page.getByRole('dialog', { name: 'Zwei Einträge zusammenführen' })).toBeVisible()
  })

  test.describe('390 px', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    test('§ C fits the phone; the merge dialog works there', async ({ page }) => {
      await setup(page, peopleMails)
      await openApp(page)
      await configure(page, { labels: ['INBOX', 'SENT'] })
      const dialog = await connect(page)
      await syncAndWait(page)
      const panel = dialog.locator('.ml-panel').nth(2)
      await panel.scrollIntoViewIfNeeded()
      await expect(dialog.getByTestId('mail-dir-contacts')).toContainText('3 entries')
      expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      const box = await panel.boundingBox()
      expect(box!.x + box!.width).toBeLessThanOrEqual(390)
      await dialog.getByTestId('mail-dir-companies').getByRole('button', { name: /^Merge…/ }).click()
      const merge = page.getByRole('dialog', { name: 'Merge two entries' })
      await merge.getByLabel('Merge', { exact: true }).selectOption({ label: 'Mueller GmbH — mueller-gmbh.de' })
      await merge.getByLabel('into', { exact: true }).selectOption({ label: 'Firma — firma.de' })
      const mbox = await merge.boundingBox()
      expect(mbox!.x).toBeGreaterThanOrEqual(0)
      expect(mbox!.x + mbox!.width).toBeLessThanOrEqual(390)
      await merge.getByRole('button', { name: 'Merge', exact: true }).click()
      await expect.poll(async () => (await directory(page, 'companies')).map((c) => [c.title, c.props.Domains, c.props.Contacts])).toEqual([['Firma', 'firma.de, mueller-gmbh.de', ['Felix Merz', 'Paul König']]])
      expect((await mailLinks(page))['Termin Dienstag'][1]).toBe('Firma')
    })
  })
})

/* ------------------------------------------------------------------ */
/* Attachments on demand (features/mail/attachments.ts)                 */
/* ------------------------------------------------------------------ */

const TINY_PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n')
const CSV = Buffer.from('name,amount\nBoots,89\n')
const HTML_ATT = Buffer.from('<!doctype html><script>alert("x")</script><p>Click me</p>')

/** One mail with a PDF, a PNG, a CSV, an HTML page and a 26 MB archive (never fetched). */
function attachmentMails(now: number): MockMail[] {
  return [
    {
      id: 'a1',
      labelIds: ['INBOX'],
      date: now - DAY,
      subject: 'Unterlagen zum Angebot',
      from: 'Felix Merz <felix@firma.de>',
      to: ACCOUNT,
      html: '<p>Anbei die Unterlagen.</p><img src="https://img.example.test/hero.png" alt="Logo" width="200" height="80">',
      text: 'Anbei die Unterlagen.',
      attachments: [
        { name: 'report.pdf', mime: 'application/pdf', size: TINY_PDF.length, data: TINY_PDF },
        { name: 'photo.png', mime: 'image/png', size: TINY_PNG.length, data: TINY_PNG },
        { name: 'data.csv', mime: 'text/csv', size: CSV.length, data: CSV },
        { name: 'page.html', mime: 'text/html', size: HTML_ATT.length, data: HTML_ATT },
        { name: 'huge.zip', mime: 'application/zip', size: 26 * 1024 * 1024 },
      ],
    },
  ]
}

/** The row page's blocks of interest: loaded files and the names still waiting in the list. */
async function attachmentState(page: Page, title = 'Unterlagen zum Angebot') {
  const row = rowBy(await mailRows(page), title)
  const files = ['image', 'fileBlock', 'audio', 'video'].flatMap((type) => nodes(row.content, type).filter((n) => String(n.attrs.src).startsWith('onefile:')).map((n) => ({ type, name: n.attrs.name ?? n.attrs.alt, display: n.attrs.display ?? null, src: n.attrs.src })))
  const waiting = nodes(row.content, 'listItem').map((li) => ({ text: JSON.stringify(li).match(/"text":"([^"·]+) · /)?.[1] ?? '', load: nodes(li, 'button').length > 0 }))
  const loadAll = nodes(row.content, 'button').some((b) => b.attrs.label === 'Load all' || b.attrs.label === 'Alle laden')
  return { row, files, waiting, loadAll }
}

/** The stored type of a local file ("onefile:<id>"). */
const storedType = (page: Page, src: string) =>
  page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('one-files')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    const rec = await new Promise<{ type: string; size: number } | undefined>((res, rej) => {
      const r = db.transaction('files', 'readonly').objectStore('files').get(id)
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    db.close()
    return rec ? { type: rec.type, size: rec.size } : null
  }, src.replace('onefile:', ''))

test.describe('Mail — attachments on demand', () => {
  test('Load keys: a PDF becomes a file block in the viewer, a PNG an image, CSV and HTML downloads (never rendered); over 25 MB only the Gmail link; re-sync and “Load images” keep them', async ({ page }) => {
    page.on('dialog', (d) => {
      throw new Error(`a dialog opened: ${d.message()}`)
    })
    const env = await setup(page, attachmentMails)
    await openApp(page)
    await configure(page)
    await connect(page)
    await syncAndWait(page)
    let st = await attachmentState(page)
    expect(st.files).toEqual([])
    expect(st.waiting).toEqual([
      { text: 'report.pdf', load: true },
      { text: 'photo.png', load: true },
      { text: 'data.csv', load: true },
      { text: 'page.html', load: true },
      { text: 'huge.zip', load: false },
    ])
    expect(st.loadAll).toBe(true)
    expect(links(st.row.content)).toContain('https://mail.google.com/mail/u/0/#all/a1')
    expect(env.box.calls.some((c) => c.includes('/attachments/'))).toBe(false)

    await closeSettings(page)
    await gotoPage(page, st.row.id)
    const ed = editorOf(page)
    await expect(ed.locator('li', { hasText: 'huge.zip' })).toContainText('over 25 MB — open in Gmail')
    await expect(ed.locator('li', { hasText: 'huge.zip' }).getByRole('button', { name: 'Load', exact: true })).toHaveCount(0)
    // the PDF
    await ed.locator('li', { hasText: 'report.pdf' }).getByRole('button', { name: 'Load', exact: true }).click()
    await expect(page.locator('.toast', { hasText: 'Loaded report.pdf' })).toBeVisible()
    await expect(page.locator('.toast', { hasText: 'property updated' })).toHaveCount(0)
    await expect.poll(async () => (await attachmentState(page)).files.map((f) => [f.type, f.name, f.display])).toEqual([['fileBlock', 'report.pdf', 'viewer']])
    await expect(ed.locator('.pdf-view iframe')).toHaveCount(1)
    st = await attachmentState(page)
    expect(st.waiting.map((w) => w.text)).toEqual(['photo.png', 'data.csv', 'page.html', 'huge.zip'])
    expect(await storedType(page, st.files[0].src)).toEqual({ type: 'application/pdf', size: TINY_PDF.length })
    // the property the key wrote is cleared again
    expect(await wsEval(page, (s, id) => s.pages[id].properties[s.settings.mail.props.load], st.row.id)).toBe('')

    // Load all: the image, the CSV, the HTML page (a download, stored so no browser renders it)
    await ed.getByRole('button', { name: 'Load all', exact: true }).click()
    await expect(page.locator('.toast', { hasText: '3 attachments loaded' })).toBeVisible()
    st = await attachmentState(page)
    expect(st.files.map((f) => [f.type, f.name, f.display])).toEqual([
      ['image', 'photo.png', null],
      ['fileBlock', 'report.pdf', 'viewer'],
      ['fileBlock', 'data.csv', 'file'],
      ['fileBlock', 'page.html', 'file'],
    ])
    expect(st.waiting).toEqual([{ text: 'huge.zip', load: false }])
    expect(st.loadAll).toBe(false)
    const html = st.files.find((f) => f.name === 'page.html')!
    expect(await storedType(page, html.src)).toEqual({ type: 'application/octet-stream', size: HTML_ATT.length })
    expect((await storedType(page, st.files.find((f) => f.name === 'data.csv')!.src))!.type).toBe('text/csv')
    await expect(ed.locator('img[alt="photo.png"]')).toBeVisible()
    await expect(ed.locator('.pdf-view iframe')).toHaveCount(1)
    expect(env.box.calls.filter((c) => c.includes('/attachments/')).sort()).toEqual(['messages/a1/attachments/att-data.csv', 'messages/a1/attachments/att-page.html', 'messages/a1/attachments/att-photo.png', 'messages/a1/attachments/att-report.pdf'])

    // a re-sync, a reset: nothing removed, nothing twice
    await syncAndWait(page)
    await page.evaluate(() => window.__oneMail.reset())
    await syncAndWait(page)
    expect((await attachmentState(page)).files).toHaveLength(4)
    expect((await mailRows(page)).length).toBe(1)
    // "Load images" renders the body again: the loaded files stay where they are
    await ed.getByRole('button', { name: 'Load images' }).click()
    await expect(ed.locator('img[src="https://img.example.test/hero.png"]')).toBeVisible()
    st = await attachmentState(page)
    expect(st.files.map((f) => f.name)).toEqual(['photo.png', 'report.pdf', 'data.csv', 'page.html'])
    expect(st.waiting).toEqual([{ text: 'huge.zip', load: false }])
    expect(env.box.calls.filter((c) => c.includes('/attachments/'))).toHaveLength(4)
  })

  test('“PDFs + images” loads them on sync (others keep their key); after a reload a Load key signs in first, then loads', async ({ page }) => {
    const env = await setup(page, attachmentMails)
    await openApp(page)
    await configure(page)
    const dialog = await connect(page)
    await dialog.getByRole('radio', { name: 'PDFs + images' }).click()
    await expect.poll(async () => (await mailCfg(page)).attachments).toBe('media')
    await expect(dialog.getByText('New mails bring their PDFs and images up to 10 MB right away')).toBeVisible()
    await syncAndWait(page)
    let st = await attachmentState(page)
    expect(st.files.map((f) => [f.type, f.name])).toEqual([
      ['image', 'photo.png'],
      ['fileBlock', 'report.pdf'],
    ])
    expect(st.waiting.map((w) => w.text)).toEqual(['data.csv', 'page.html', 'huge.zip'])
    expect(env.box.calls.filter((c) => c.includes('/attachments/')).sort()).toEqual(['messages/a1/attachments/att-photo.png', 'messages/a1/attachments/att-report.pdf'])

    // no token after a reload: the key asks for a sign-in, then loads
    await closeSettings(page)
    await reloadApp(page)
    await gotoPage(page, st.row.id)
    await editorOf(page).locator('li', { hasText: 'data.csv' }).getByRole('button', { name: 'Load', exact: true }).click()
    const ask = page.locator('.toast', { hasText: 'Sign in to Gmail to load the attachment.' })
    await expect(ask).toBeVisible()
    await ask.getByRole('button', { name: 'Connect Gmail' }).click()
    await expect(page.locator('.toast', { hasText: 'Loaded data.csv' })).toBeVisible()
    st = await attachmentState(page)
    expect(st.files.map((f) => f.name)).toEqual(['photo.png', 'report.pdf', 'data.csv'])
    expect(await page.evaluate(() => window.__gis.calls.map((c) => c.hint))).toEqual([ACCOUNT])
  })

  test('German: Laden, Alle laden, the toast', async ({ page }) => {
    await setup(page, attachmentMails)
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await configure(page)
    const dialog = await openMailTab(page, /E-Mail$/)
    await expect(dialog.getByRole('radiogroup', { name: 'Anhänge automatisch laden' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Gmail verbinden' }).click()
    await expect(dialog.getByTestId('mail-account')).toHaveText(ACCOUNT)
    await syncAndWait(page)
    await closeSettings(page)
    const st = await attachmentState(page)
    await gotoPage(page, st.row.id)
    const ed = editorOf(page)
    await expect(ed).toContainText('5 Anhänge')
    await expect(ed.locator('li', { hasText: 'huge.zip' })).toContainText('über 25 MB — in Gmail öffnen')
    await expect(ed.getByRole('button', { name: 'Alle laden', exact: true })).toBeVisible()
    await ed.locator('li', { hasText: 'report.pdf' }).getByRole('button', { name: 'Laden', exact: true }).click()
    await expect(page.locator('.toast', { hasText: 'report.pdf geladen' })).toBeVisible()
  })

  test.describe('390 px', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    test('the keys are reachable on a phone; a loaded image fits the page', async ({ page }) => {
      await setup(page, attachmentMails)
      await openApp(page)
      await configure(page)
      await connect(page)
      await syncAndWait(page)
      await closeSettings(page)
      const st = await attachmentState(page)
      await gotoPage(page, st.row.id)
      const ed = editorOf(page)
      const key = ed.locator('li', { hasText: 'photo.png' }).getByRole('button', { name: 'Load', exact: true })
      const kb = await key.boundingBox()
      expect(kb!.height).toBeGreaterThanOrEqual(24)
      expect(kb!.x + kb!.width).toBeLessThanOrEqual(390)
      await key.click()
      await expect(page.locator('.toast', { hasText: 'Loaded photo.png' })).toBeVisible()
      const img = ed.locator('img[alt="photo.png"]')
      await expect(img).toBeAttached()
      const box = await img.boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(390)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= 390)).toBe(true)
    })
  })
})

/* ------------------------------------------------------------------ */
/* Screenshots (MAIL_SHOTS=1): Settings → Mail, the database, a row     */
/* ------------------------------------------------------------------ */

test.describe('Mail screenshots', () => {
  test.skip(!process.env.MAIL_SHOTS, 'screenshots only on request (MAIL_SHOTS=1)')
  for (const [name, w, h, dark] of [
    ['1440-light', 1440, 900, false],
    ['1440-dark', 1440, 900, true],
    ['390-light', 390, 844, false],
    ['390-dark', 390, 844, true],
  ] as const) {
    test.describe(name, () => {
      const mobile = w < 500
      test.use({ viewport: { width: w, height: h }, colorScheme: dark ? 'dark' : 'light', isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 })
      test(`shots ${name}`, async ({ page }) => {
        const env = await setup(page)
        await page.unroute('https://api.anthropic.com/**')
        await page.route('https://api.anthropic.com/**', (route) => {
          if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
          const prompt = String(JSON.parse(route.request().postData() ?? '{}').messages?.[0]?.content ?? '')
          const ids = [...prompt.matchAll(/<mail id="([^"]+)">/g)].map((m) => m[1])
          const answer = { mails: ids.map((id) => ({ id, category: id === 'm2' ? 'Todo' : 'Newsletter', priority: id === 'm2' ? 'high' : 'low', needsReply: id === 'm2', summary: id === 'm2' ? 'Bob asks for a draft review by Friday.' : 'Autumn sale, 30 % off.' })) }
          return route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify({ id: 'x', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify(answer) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }) })
        })
        await openApp(page)
        await wsEval(page, (s) => s.updateSettings({ theme: 'system' }))
        const out = (n: string) => `.shots/mail-${n}-${name}.png`
        // not set up
        let dialog = await openMailTab(page)
        await page.waitForTimeout(300)
        await page.screenshot({ path: out('setup') })
        await closeSettings(page)
        await configure(page)
        await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
        dialog = await connect(page)
        await dialog.getByRole('switch', { name: 'Organise new mails with Claude' }).click()
        await dialog.getByRole('button', { name: 'Sync now' }).click()
        await expect.poll(() => page.evaluate(() => window.__oneMail.state().phase)).toBe('idle')
        await page.waitForTimeout(300)
        for (const [i, shot] of (['connected', 'sync', 'organise'] as const).entries()) {
          await dialog.locator('.ml-panel').nth(i).evaluate((el) => el.scrollIntoView({ block: 'start' }))
          await page.waitForTimeout(200)
          await page.screenshot({ path: out(shot) })
        }
        await dialog.locator('.st__body').evaluate((el) => (el.scrollTop = el.scrollHeight))
        await page.waitForTimeout(200)
        await page.screenshot({ path: out('privacy') })
        await closeSettings(page)
        const cfg = await mailCfg(page)
        await gotoPage(page, cfg.databaseId)
        await page.waitForTimeout(600)
        await page.screenshot({ path: out('database') })
        const sale = rowBy(await mailRows(page), 'Autumn sale — 30 % off')
        await gotoPage(page, sale.id)
        await page.waitForTimeout(600)
        await page.screenshot({ path: out('row') })
        await page.mouse.move(w / 2, h / 2)
        await page.mouse.wheel(0, mobile ? 1500 : 600)
        await page.waitForTimeout(400)
        await page.screenshot({ path: out('body') })
        await editorOf(page).getByRole('button', { name: 'Load images' }).click()
        await expect(editorOf(page).locator('img[src="https://img.example.test/hero.png"]')).toBeVisible()
        await page.waitForTimeout(300)
        await page.waitForTimeout(300)
        await page.screenshot({ path: out('row-images') })
        await page.mouse.wheel(0, 900)
        await page.waitForTimeout(400)
        await page.screenshot({ path: out('body-end') })
        const review = rowBy(await mailRows(page), 'Draft review')
        await gotoPage(page, review.id)
        await page.waitForTimeout(300)
        await page.mouse.wheel(0, mobile ? 1500 : 600)
        await page.waitForTimeout(400)
        await page.screenshot({ path: out('text-mail') })
        expect(env.box.calls.length).toBeGreaterThan(0)
      })
    })
  }
})
