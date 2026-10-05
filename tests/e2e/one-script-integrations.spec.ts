/**
 * One Script — integrations end to end: the database command kind "Run script" (per selected row from the
 * toolbar, once for the database from the sidebar), the button action run_script and "/script", the
 * automation action "Run script" (its own writes start no automation again), ⌘K "Run script: <name>",
 * mail.send through Gmail (incremental consent for gmail.send, RFC 822 with a UTF-8 subject; a draft
 * without Gmail), the AI terminal's run_query / write_script (staged for review, never run), "Ask Claude"
 * in the query builder, and a custom agent's run_query inside its scope.
 *
 * Everything external is mocked: Google's sign-in script, the Gmail REST API and api.anthropic.com.
 */
import type { BrowserContext, Locator, Page, Route } from '@playwright/test'
import { test, expect, openApp, wsEval, flush, gotoPage, editorOf, pageIdByTitle, escapeRe, mockClaude as mockText, MOD } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/* ------------------------------------------------------------------ workspace helpers */

/** "Aufgaben": Name · Status (Offen / Erledigt) · Fällig · Priorität (Hoch / Niedrig) · Zähler (number). */
async function makeTasks(page: Page): Promise<{ dbId: string; ids: string[] }> {
  return wsEval(page, (s) => {
    const dbId = s.createDatabase({
      title: 'Aufgaben',
      parentId: null,
      properties: [
        { id: 'p_name', name: 'Name', type: 'title' },
        { id: 'p_status', name: 'Status', type: 'select', options: [{ id: 'o_open', name: 'Offen', color: 'blue' }, { id: 'o_done', name: 'Erledigt', color: 'green' }] },
        { id: 'p_due', name: 'Fällig', type: 'date' },
        { id: 'p_prio', name: 'Priorität', type: 'select', options: [{ id: 'o_high', name: 'Hoch', color: 'red' }, { id: 'o_low', name: 'Niedrig', color: 'gray' }] },
        { id: 'p_n', name: 'Zähler', type: 'number' },
      ],
    })
    const rows: Array<[string, string]> = [
      ['Angebot schreiben', 'o_open'],
      ['Rechnung prüfen', 'o_open'],
      ['Website live', 'o_done'],
      ['Kunde anrufen', 'o_open'],
    ]
    const ids = rows.map(([title, status], i) => s.createRow(dbId, { title, properties: { p_status: status, p_due: { start: `2026-10-${String(6 + i).padStart(2, '0')}` }, p_prio: 'o_low', p_n: 0 } }))
    return { dbId, ids }
  })
}

async function addScript(page: Page, input: { code: string; name: string; kind?: 'script' | 'query' }): Promise<string> {
  const id = await wsEval(
    page,
    (s, a) => {
      const id = `sc${Math.random().toString(36).slice(2, 10)}`
      const now = Date.now()
      s.upsertScript({ id, name: a.name, code: a.code, kind: a.kind ?? 'script', createdAt: now, updatedAt: now })
      return id
    },
    input,
  )
  return id
}

const prioOf = (page: Page, ids: string[]) => wsEval(page, (s, ids) => ids.map((id: string) => s.pages[id].properties.p_prio), ids)
const toast = (page: Page, text: string | RegExp) => page.locator('.toast', { hasText: text })

/** A script that raises the row it runs for; on a database page it only says so. */
const RAISE = 'let p = page.current\nif type(p) = "row" {\n  p.set(Priorität: "Hoch")\n} else {\n  notify("Datenbank {p.title}")\n}\n'

/* ------------------------------------------------------------------ Claude (tool-use turns) */

type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
let msgSeq = 0

function sseMessage(blocks: Block[]): string {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  const stop = blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'
  let body = ev('message_start', {
    message: { id: `msg_osi_${++msgSeq}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  })
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      body += ev('content_block_start', { index, content_block: { type: 'text', text: '' } })
      for (const chunk of b.text.match(/.{1,18}/gs) ?? []) body += ev('content_block_delta', { index, delta: { type: 'text_delta', text: chunk } })
    } else {
      body += ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } })
      for (const chunk of JSON.stringify(b.input).match(/.{1,24}/gs) ?? []) body += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: chunk } })
    }
    body += ev('content_block_stop', { index })
  })
  body += ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 80 } })
  body += ev('message_stop', {})
  return body
}

/** api.anthropic.com → request n gets script[n] (later ones a short answer). */
async function mockAgent(ctx: BrowserContext, script: Array<(body: AnyState) => string>): Promise<AnyState[]> {
  const bodies: AnyState[] = []
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (req.method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [], has_more: false }) })
    const body = JSON.parse(req.postData() ?? '{}')
    bodies.push(body)
    const step = script[bodies.length - 1] ?? (() => sseMessage([{ type: 'text', text: 'Done.' }]))
    try {
      await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: step(body) })
    } catch {
      /* aborted */
    }
  })
  return bodies
}

const toolResult = (body: AnyState, id: string): AnyState | undefined =>
  (body.messages as AnyState[]).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((c: AnyState) => c.type === 'tool_result' && c.tool_use_id === id)
const resultText = (r: AnyState | undefined) => (typeof r?.content === 'string' ? r.content : JSON.stringify(r?.content ?? ''))
const setKey = (page: Page) => wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))

/* ------------------------------------------------------------------ sidebar commands */

const tree = (page: Page) => page.locator('.sb section[aria-label="Pages"]')
const sbRow = (page: Page, title: string) => tree(page).locator('.sb-row', { has: page.locator('.sb-row__title', { hasText: new RegExp(`^${escapeRe(title)}$`) }) })
const cmdMenu = (page: Page) => page.locator('.popover.cmd-menu')

async function openCommands(page: Page, title: string): Promise<Locator> {
  const r = sbRow(page, title)
  await r.hover()
  await r.getByTestId('tree-commands').click()
  await expect(cmdMenu(page)).toBeVisible()
  return cmdMenu(page)
}

test.describe('One Script integrations', () => {
  test('database command "Run script": added in Edit commands…, once for the database from the sidebar, per selected row from the toolbar', async ({ page }) => {
    await openApp(page)
    const { dbId, ids } = await makeTasks(page)
    const scriptId = await addScript(page, { name: 'Hochstufen', code: RAISE })

    await (await openCommands(page, 'Aufgaben')).getByRole('menuitem', { name: 'Edit commands…' }).click()
    const dlg = page.getByRole('dialog', { name: /Commands · Aufgaben/ })
    await dlg.getByRole('button', { name: 'Add command' }).click()
    await page.locator('.popover').getByRole('menuitem', { name: 'Run script' }).click()
    await dlg.getByLabel('Label').fill('Hochstufen')
    await dlg.getByRole('button', { name: 'Script' }).click()
    await page.locator('.popover').getByRole('menuitem', { name: 'Hochstufen' }).click()
    await expect(dlg.locator('.dbc-pick__value')).toContainText('Hochstufen')
    await dlg.getByRole('button', { name: 'All commands' }).click()
    await dlg.getByRole('button', { name: 'Done' }).click()
    await expect(dlg).toHaveCount(0)
    const stored = await wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.databases[id].commands ?? [])), dbId)
    expect(stored.find((c: AnyState) => c.kind === 'script')).toMatchObject({ label: 'Hochstufen', config: { scriptId } })

    // the sidebar: no rows selected → once, for the database page itself
    await (await openCommands(page, 'Aufgaben')).getByRole('menuitem', { name: 'Hochstufen' }).click()
    await expect(toast(page, 'Datenbank Aufgaben')).toBeVisible()
    expect(await prioOf(page, ids)).toEqual(['o_low', 'o_low', 'o_low', 'o_low'])

    // the toolbar with two rows selected → once per row (page.current = the row)
    await gotoPage(page, dbId)
    const rows = page.locator('#main .dbt-row[role="row"]:not(.dbt-row--head)')
    for (const i of [0, 1]) {
      await rows.nth(i).hover()
      await rows.nth(i).getByRole('checkbox', { name: 'Select row' }).click()
    }
    await expect(page.locator('#main .dbt-row[aria-selected="true"]')).toHaveCount(2)
    await page.getByTestId('db-commands').click()
    await cmdMenu(page).getByRole('menuitem', { name: 'Hochstufen' }).click()
    await expect(toast(page, '“Hochstufen” ran for 2 rows · 2 changes')).toBeVisible()
    expect(await prioOf(page, ids)).toEqual(['o_high', 'o_high', 'o_low', 'o_low'])
  })

  test('button: run_script runs for the page it is on; /script inserts a button bound to a script', async ({ page }) => {
    await openApp(page)
    const { ids } = await makeTasks(page)
    const scriptId = await addScript(page, { name: 'Prio hoch', code: 'page.current.set(Priorität: "Hoch")\n' })
    await addScript(page, { name: 'Zählen', code: 'page.current.set(Zähler: page.current.Zähler + 1)\n' })
    await wsEval(
      page,
      (s, a) =>
        s.setContent(a.row, { type: 'doc', content: [{ type: 'button', attrs: { label: 'Prio hoch', variant: 'ink', actions: [{ id: 'a1', type: 'run_script', scriptId: a.scriptId }] } }, { type: 'paragraph' }] }, 'test'),
      { row: ids[1], scriptId },
    )
    await gotoPage(page, ids[1])
    const ed = editorOf(page)
    await ed.getByRole('button', { name: 'Prio hoch' }).click()
    await expect(toast(page, '“Prio hoch” ran · 1 change')).toBeVisible()
    expect(await prioOf(page, [ids[1]])).toEqual(['o_high'])

    // /script: a button with a run_script action; its settings open on the script picker
    await ed.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/script')
    await page.locator('.slash .slash__item', { hasText: 'Run script' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Configure button' })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.bcfg-card')).toContainText('Run a script')
    await dialog.getByRole('button', { name: 'Script' }).click()
    await page.locator('.popover').getByRole('menuitem', { name: 'Zählen' }).click()
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toHaveCount(0)
    await flush(page)
    const buttons = await wsEval(page, (s, id) => (s.pages[id].content.content as AnyState[]).filter((n) => n.type === 'button').map((n) => n.attrs.actions[0]), ids[1])
    expect(buttons[1]).toMatchObject({ type: 'run_script' })
    const zid = await wsEval(page, (s) => (Object.values(s.scripts) as AnyState[]).find((x) => x.name === 'Zählen').id)
    expect(buttons[1].scriptId).toBe(zid)
    await ed.getByRole('button', { name: 'Run script' }).click()
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].properties.p_n, ids[1])).toBe(1)
  })

  test('automation "Run script": added in the editor, runs for the changed row, its own writes start nothing again', async ({ page }) => {
    await openApp(page)
    const { dbId, ids } = await makeTasks(page)
    const scriptId = await addScript(page, { name: 'Zählen', code: 'page.current.set(Zähler: page.current.Zähler + 1)\n' })
    // any change of a row → the script; the script's own change would match again
    await wsEval(
      page,
      (s, db) => s.updateDatabase(db, { automations: [{ id: 'au1', name: 'Zählen', enabled: true, trigger: { type: 'property_changed', propertyId: null }, actions: [{ type: 'notify', message: 'x' }], lastRunAt: null, lastStatus: null, lastMessage: null }] }),
      dbId,
    )
    await page.evaluate((id) => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'automations', databaseId: id }), dbId)
    const modal = page.getByRole('dialog')
    await modal.getByRole('button', { name: 'Remove action' }).click()
    await modal.getByRole('button', { name: 'Add action' }).click()
    await page.locator('.popover').getByRole('menuitem', { name: /Run script/ }).click()
    // the only script is picked already
    await expect(modal.locator('.auto-pick', { hasText: 'Zählen' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect.poll(() => wsEval(page, (s, db) => JSON.parse(JSON.stringify(s.databases[db].automations[0].actions)), dbId)).toEqual([{ type: 'run_script', scriptId }])

    await wsEval(page, (s, id) => s.setRowProperty(id, 'p_status', 'o_done'), ids[0])
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].properties.p_n, ids[0]), { timeout: 10_000 }).toBe(1)
    await expect.poll(() => wsEval(page, (s, db) => s.databases[db].automations[0].lastMessage, dbId)).toContain('Zählen: 1 change')
    // no loop: the script's write started no automation
    await page.waitForTimeout(2500)
    expect(await wsEval(page, (s, id) => s.pages[id].properties.p_n, ids[0])).toBe(1)
  })

  test('⌘K "Run script: <name>" runs it for the open page', async ({ page }) => {
    await openApp(page)
    const { ids } = await makeTasks(page)
    await addScript(page, { name: 'Prio hoch', code: 'page.current.set(Priorität: "Hoch")\n' })
    await gotoPage(page, ids[3])
    await page.keyboard.press(`${MOD}+k`)
    await page.locator('.pal-scrim input').first().fill('Run script: Prio')
    await expect(page.locator('.pal-scrim [cmdk-item][aria-selected="true"]')).toContainText('Run script: Prio hoch')
    await page.keyboard.press('Enter')
    await expect(toast(page, '“Prio hoch” ran · 1 change')).toBeVisible()
    expect(await prioOf(page, [ids[3]])).toEqual(['o_high'])
  })
})

/* ------------------------------------------------------------------ Gmail */

const CLIENT_ID = '123456789012-e2etestclientid0001.apps.googleusercontent.com'
const ACCOUNT = 'ada@example.com'
const READ = 'https://www.googleapis.com/auth/gmail.readonly'
const SEND = 'https://www.googleapis.com/auth/gmail.send'

const GIS_JS = `
(() => {
  let n = 0
  window.__gis = { calls: [], mode: window.__gisMode || 'ok' }
  window.google = { accounts: { oauth2: {
    initTokenClient(cfg) {
      return {
        requestAccessToken(o) {
          window.__gis.calls.push({ scope: cfg.scope, include: !!cfg.include_granted_scopes, hint: (o && o.login_hint) || cfg.login_hint || null })
          setTimeout(() => {
            if (window.__gis.mode === 'deny') return cfg.callback({ error: 'access_denied' })
            cfg.callback({ access_token: 'ya29.e2e-SEND-' + (++n), expires_in: 3599, scope: cfg.scope, token_type: 'Bearer' })
          }, 40)
        },
      }
    },
    hasGrantedAllScopes(r, ...scopes) { return scopes.every((s) => String(r.scope || '').split(' ').includes(s)) },
    revoke(token, done) { done && done() },
  } } }
})()`

interface Sent {
  auth: string
  raw: string
}

async function mockGmail(page: Page): Promise<Sent[]> {
  const sent: Sent[] = []
  await page.route('https://accounts.google.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: GIS_JS }))
  await page.route('https://gmail.googleapis.com/**', async (route: Route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': 'authorization, content-type, accept', 'access-control-allow-methods': 'GET, POST' } })
    const url = new URL(req.url())
    if (req.method() === 'POST' && url.pathname.endsWith('/messages/send')) {
      sent.push({ auth: (await req.allHeaders()).authorization ?? '', raw: JSON.parse(req.postData() ?? '{}').raw ?? '' })
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ id: `m-sent-${sent.length}`, threadId: 't1', labelIds: ['SENT'] }) })
    }
    return route.fulfill({ status: 404, headers: { ...cors, 'content-type': 'application/json' }, body: '{"error":{"code":404}}' })
  })
  return sent
}

const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')

/** RFC 2047 encoded words → text. */
const decodeWords = (v: string) => v.replace(/\r\n /g, '').replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_m, b: string) => Buffer.from(b, 'base64').toString('utf8'))

async function openScript(page: Page, id: string) {
  await page.evaluate((id) => (window.location.hash = `#/scripts/${id}`), id)
  await expect(page.locator('.sc-code__input')).toBeVisible()
}

test.describe('mail.send through Gmail', () => {
  test('connected: asks for gmail.send once (incremental), sends RFC 822 with a UTF-8 subject; the token is never stored', async ({ page }) => {
    const sent = await mockGmail(page)
    await openApp(page)
    await wsEval(page, (s, id) => s.updateSettings({ mail: { ...(s.settings.mail ?? {}), clientId: id } }), CLIENT_ID)
    await page.evaluate((acc) => (window as unknown as { __oneMail: { setToken: (v: string, a: string) => void } }).__oneMail.setToken('ya29.e2e-READ-only', acc), ACCOUNT)
    const id = await addScript(page, {
      name: 'Grüße',
      code: 'let r = mail.send(to: "bob@example.com", cc: "carl@example.com", subject: "Grüße aus One — Übersicht ✓ mit einem recht langen Betreff, der umbricht", body: "Hallo Bob,\\nalles erledigt: Änderungen ✓")\nprint(r.status)\n',
    })
    await openScript(page, id)
    await page.getByTestId('sc-run').click()
    const plan = page.getByRole('dialog', { name: 'Before this run' })
    await expect(plan.locator('.sc-plan__via')).toHaveText(`via Gmail · ${ACCOUNT}`)
    await plan.getByRole('button', { name: /Run \(1 of 1\)/ }).click()
    await expect.poll(() => sent.length).toBe(1)
    await expect(page.getByTestId('sc-console')).toContainText('sent')

    const calls = await page.evaluate(() => (window as unknown as { __gis: { calls: AnyState[] } }).__gis.calls)
    expect(calls).toHaveLength(1)
    expect(calls[0].scope.split(' ').sort()).toEqual([READ, SEND].sort())
    expect(calls[0]).toMatchObject({ include: true, hint: ACCOUNT })
    expect(sent[0].auth).toMatch(/^Bearer ya29\.e2e-SEND-1$/)

    const msg = fromB64url(sent[0].raw)
    const [head, body] = msg.split('\r\n\r\n')
    expect(head).toContain(`From: ${ACCOUNT}`)
    expect(head).toContain('To: bob@example.com')
    expect(head).toContain('Cc: carl@example.com')
    expect(head).toContain('Content-Type: text/plain; charset="UTF-8"')
    expect(head).toContain('Content-Transfer-Encoding: base64')
    const subject = /Subject: ([\s\S]*?)\r\n(?! )/.exec(`${head}\r\n`)![1]
    expect(subject).toMatch(/^=\?UTF-8\?B\?/)
    for (const line of subject.split('\r\n')) expect(line.trim().length).toBeLessThanOrEqual(75)
    expect(decodeWords(subject)).toBe('Grüße aus One — Übersicht ✓ mit einem recht langen Betreff, der umbricht')
    expect(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8')).toBe('Hallo Bob,\r\nalles erledigt: Änderungen ✓')

    // a second mail: the send permission is there — no new Google window
    await page.getByTestId('sc-run').click()
    await page.getByRole('dialog', { name: 'Before this run' }).getByRole('button', { name: /Run \(1 of 1\)/ }).click()
    await expect.poll(() => sent.length).toBe(2)
    expect(await page.evaluate(() => (window as unknown as { __gis: { calls: AnyState[] } }).__gis.calls.length)).toBe(1)

    // the token never reaches storage
    await flush(page)
    const leaked = await page.evaluate(async () => {
      const local = JSON.stringify({ ...localStorage })
      const dump: string[] = [local]
      for (const info of (await indexedDB.databases?.()) ?? []) {
        if (!info.name) continue
        const db = await new Promise<IDBDatabase>((res, rej) => {
          const r = indexedDB.open(info.name!)
          r.onsuccess = () => res(r.result)
          r.onerror = () => rej(r.error)
        })
        for (const store of Array.from(db.objectStoreNames)) {
          const all = await new Promise<unknown[]>((res) => {
            const q = db.transaction(store).objectStore(store).getAll()
            q.onsuccess = () => res(q.result)
            q.onerror = () => res([])
          })
          dump.push(JSON.stringify(all))
        }
        db.close()
      }
      return dump.join('\n')
    })
    expect(leaked).not.toContain('ya29.e2e')
  })

  test('denied: the run stops with Google’s refusal, nothing sent; without Gmail a draft opens', async ({ page }) => {
    const sent = await mockGmail(page)
    await page.addInitScript(() => {
      ;(window as unknown as { __gisMode: string }).__gisMode = 'deny'
      const w = window as unknown as { __opened: string[] }
      w.__opened = []
      window.open = ((url?: string | URL) => {
        w.__opened.push(String(url))
        return null
      }) as typeof window.open
    })
    await openApp(page)
    const id = await addScript(page, { name: 'Gruß', code: 'mail.send(to: "bob@example.com", subject: "Hallo", body: "Text")\n' })
    // no Gmail: the core's draft (mailto:)
    await openScript(page, id)
    await page.getByTestId('sc-run').click()
    const plan = page.getByRole('dialog', { name: 'Before this run' })
    await expect(plan.locator('.sc-plan__via')).toHaveCount(0)
    await plan.getByRole('button', { name: /Run \(1 of 1\)/ }).click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual([expect.stringMatching(/^mailto:bob@example\.com\?subject=Hallo&body=Text$/)])

    // Gmail set up, but the person refuses the send permission
    await wsEval(page, (s, id) => s.updateSettings({ mail: { ...(s.settings.mail ?? {}), clientId: id } }), CLIENT_ID)
    await page.evaluate((acc) => (window as unknown as { __oneMail: { setToken: (v: string, a: string) => void } }).__oneMail.setToken('ya29.e2e-READ-only', acc), ACCOUNT)
    await page.getByTestId('sc-run').click()
    const plan2 = page.getByRole('dialog', { name: 'Before this run' })
    await expect(plan2.locator('.sc-plan__via')).toHaveText(`via Gmail · ${ACCOUNT}`)
    await plan2.getByRole('button', { name: /Run \(1 of 1\)/ }).click()
    await expect(page.getByTestId('sc-console')).toContainText('Google did not allow One to send mail', { timeout: 10_000 })
    expect(sent).toHaveLength(0)
    // still one draft: a refusal never falls back to sending something else
    expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened.length)).toBe(1)
  })
})

/* ------------------------------------------------------------------ Claude */

test.describe('One Script with Claude (mocked)', () => {
  test('AI terminal: run_query answers rows; write_script is parsed, staged for review and saved — never run', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const { ids } = await makeTasks(page)
    const good = 'for t in db("Aufgaben").where(Status = "Offen") {\n  t.set(Priorität: "Hoch")\n}\nnotify("hochgestuft")'
    const bodies = await mockAgent(context, [
      () => sseMessage([{ type: 'tool_use', id: 'tq', name: 'run_query', input: { code: 'db("Aufgaben").where(Status = "Offen").sort(Fällig).select(id, Name, Fällig)' } }]),
      () => sseMessage([{ type: 'tool_use', id: 'tb', name: 'write_script', input: { name: 'Kaputt', code: 'let x = (' } }]),
      () => sseMessage([{ type: 'tool_use', id: 'tw', name: 'write_script', input: { name: 'Offene hochstufen', code: good, description: 'Stuft alle offenen Aufgaben hoch.' } }]),
      () => sseMessage([{ type: 'text', text: 'Drei Aufgaben sind offen. Das Skript **Offene hochstufen** liegt zur Prüfung bereit.' }]),
    ])
    await page.keyboard.press(`${MOD}+j`)
    const term = page.getByRole('region', { name: 'AI terminal' })
    await term.getByRole('textbox', { name: 'Task for the agent' }).fill('Welche Aufgaben sind offen? Schreib mir ein Skript, das sie hochstuft.')
    await term.getByRole('textbox', { name: 'Task for the agent' }).press('Enter')
    await expect(term.locator('.term-answer')).toContainText('liegt zur Prüfung bereit', { timeout: 20_000 })

    // the tools and the language reference went along
    const tools = (bodies[0].tools as AnyState[]).filter((t) => t.name === 'run_query' || t.name === 'write_script')
    expect(tools.map((t) => t.name)).toEqual(['run_query', 'write_script'])
    expect(tools[0].description).toContain('One Script')
    expect(tools[1].description).toContain('db(@Tasks)')
    // run_query: rows as JSON
    const q = JSON.parse(resultText(toolResult(bodies[1], 'tq')))
    expect(q.count).toBe(3)
    expect(q.rows.map((r: AnyState) => r.Name)).toEqual(['Angebot schreiben', 'Rechnung prüfen', 'Kunde anrufen'])
    expect(q.rows[0].id).toBe(ids[0])
    // a script that does not parse comes back to Claude
    const bad = toolResult(bodies[2], 'tb')
    expect(bad?.is_error).toBe(true)
    expect(resultText(bad)).toContain('does not parse')
    expect(resultText(toolResult(bodies[3], 'tw'))).toContain('never runs on its own')

    // the review: the drafted script, its code; nothing ran
    const change = term.locator('.term-change[data-kind="script"]')
    await expect(change).toHaveCount(1)
    await expect(change).toContainText('Offene hochstufen')
    await expect(change.getByTestId('script-diff')).toContainText('t.set(Priorität: "Hoch")')
    await change.getByRole('button', { name: /^Apply #/ }).click()
    await expect(change).toHaveAttribute('data-status', 'applied')
    const saved = await wsEval(page, (s) => (Object.values(s.scripts ?? {}) as AnyState[]).find((x) => x.name === 'Offene hochstufen'))
    expect(saved).toMatchObject({ kind: 'script', description: 'Stuft alle offenen Aufgaben hoch.' })
    expect(saved.code.trim()).toBe(good)
    expect(await prioOf(page, ids)).toEqual(['o_low', 'o_low', 'o_low', 'o_low'])
    // Open → its workbench
    await change.getByRole('button', { name: /^Open #/ }).click()
    await expect(page).toHaveURL(new RegExp(`#/scripts/${saved.id}$`))
  })

  test('Ask Claude in the query builder: the draft is parsed, tried read-only and used on request', async ({ page }) => {
    await openApp(page)
    await setKey(page)
    const { dbId } = await makeTasks(page)
    const answer = `\`\`\`one\n# offen, die nächsten zuerst\ndb(@[Aufgaben](p:${dbId})).where(Status = "Offen").sort(Fällig)\n\`\`\``
    const bodies = await mockText(page, () => `Hier ist die Abfrage:\n\n${answer}`)
    const id = await addScript(page, { name: 'Offen', code: '', kind: 'query' })
    await openScript(page, id)
    const ask = page.getByTestId('sc-ask')
    await ask.getByRole('textbox', { name: 'Describe the query for Claude' }).fill('offene Aufgaben, die nächsten zuerst')
    await ask.getByTestId('sc-ask-go').click()
    const draft = ask.getByTestId('sc-ask-draft')
    await expect(draft).toContainText('db(@Aufgaben).where(Status = "Offen").sort(Fällig)')
    await expect(draft).toContainText('3 rows now')
    // what went to Claude: the request and the databases' names and properties
    const sent = bodies.filter((b) => /"stream"\s*:\s*true/.test(b)).at(-1) ?? ''
    expect(sent).toContain('offene Aufgaben')
    expect(sent).toContain(`@[Aufgaben](p:${dbId})`)
    expect(sent).toContain('Priorität (select: Hoch | Niedrig)')
    await draft.getByTestId('sc-ask-use').click()
    await expect(page.getByTestId('sc-live-count')).toHaveText('3 results')
    await expect.poll(() => wsEval(page, (s, id) => s.scripts[id].code, id)).toContain('.where(Status = "Offen").sort(Fällig)')
    await expect(page.getByTestId('sc-qb')).toBeVisible()
  })

  test('a custom agent gets run_query — inside its scope only', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    await makeTasks(page)
    const projects = await pageIdByTitle(page, 'Projects')
    const rows = await wsEval(page, (s, id) => (Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId === id && !p.trashed).length, projects)
    const bodies = await mockAgent(context, [
      () => sseMessage([{ type: 'tool_use', id: 'q1', name: 'run_query', input: { code: 'db("Aufgaben").count' } }]),
      () => sseMessage([{ type: 'tool_use', id: 'q2', name: 'run_query', input: { code: `db(@[Projects](p:${projects})).count` } }]),
      () => sseMessage([{ type: 'text', text: 'Counted the projects.' }]),
    ])
    await wsEval(page, (s, p) => {
      const now = Date.now()
      s.upsertAgent({ id: 'ag-q', name: 'Zähler', instructions: 'Count.', trigger: { type: 'manual' }, scope: { everything: false, pages: [], databases: [p] }, write: 'none', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: true, createdAt: now, updatedAt: now })
    }, projects)
    await flush(page)
    await page.evaluate(() => (window.location.hash = '#/agents/ag-q'))
    await page.getByRole('button', { name: 'Run now' }).click()
    await expect(page.locator('.agx-run').first()).toHaveAttribute('data-status', 'ok', { timeout: 20_000 })
    expect((bodies[0].tools as AnyState[]).map((t) => t.name)).toContain('run_query')
    expect((bodies[0].tools as AnyState[]).map((t) => t.name)).not.toContain('write_script')
    const r1 = toolResult(bodies[1], 'q1')
    expect(r1?.is_error).toBe(true)
    expect(resultText(r1)).toContain('No database')
    expect(JSON.parse(resultText(toolResult(bodies[2], 'q2'))).value).toBe(rows)
  })
})
