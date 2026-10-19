/**
 * Work orders (Prüfaufträge) B15 — acceptance (spec §6 B15, the owner's story "So läuft es", owner.md): the story end to
 * end, in German, through the screens a person uses. Nothing real is reached:
 *  - the coding worker is played by helpers/fakeWorker.ts on CODING_E2E_PORT (Business analysis → Coding → QA: the doc
 *    stages write their result, the implement stage names its branch, the ship stage its merge request, the QA stage its
 *    test cases — Claude Code's costs as the worker reports them);
 *  - the person's own MCP server is the mock (tests/fixtures/mock-mcp.mjs, the real SDK over Streamable HTTP on
 *    127.0.0.1), named "wissensbasis" in One at a fictional https address;
 *  - api.anthropic.com is answered by a fake connector that does what the Messages API's MCP connector does: it lists /
 *    calls exactly the tools the request allowed on exactly the servers the request named — with the token the request
 *    carried — and puts the mcp_tool_use / mcp_tool_result blocks before the planner's answer (a request without a server
 *    reaches no server). The connection test ("Server testen") lists the mock's tools the same way.
 * Fictional data only (Nordlicht, Tessera, Mara Lind, Login-Timeout, Wissensbasis).
 *
 *  1. with the server, confirm (Freigaben "Review"): #/coding N → a request typed in its page (@Supportfall 4711) stays
 *     Entwurf, nothing is sent · the settings pick the server — untested first, "Server testen" lists its tools, it reads
 *     with the read tools only · ↵ Planen: the request goes out with exactly that server and its read tools, the mock
 *     sees only reads · Kette bereit: Verstanden, Kontext FREMD "geht in Schritt 01 mit", stations with "stoppt bei",
 *     cost line, ↵ waits until everything was seen, budget · ↵ Kette starten · mit Server-Inhalt → three tasks in #/coding,
 *     the 10 s count, ↵ jetzt · BA stops at its own approval, approved without opening the next step → the card "Analyse
 *     fertig → 02" with the Grundlage → ↵ Weiter · Coding stops at Review · H on the plate → Angehalten (the approval
 *     does not start QA) → ↵ Fortsetzen → QA on the coding branch with "Aus Schritt 02" → its approval → Fertig, the
 *     results (MR, test cases, Claude Code costs), W = one callout in the request;
 *  2. without a server (Freigaben "Alle"): "Prüfen lassen" on the page Supportfall 4711 (the database made on first use,
 *     toast + Z), the request plans at once — no server goes out although one is on for all AI calls · the count runs
 *     out by itself · BA's approval with the next step read in full passes the analysis checkpoint (one press, no card) ·
 *     the approval that releases QA is VON HAND in Preflight (⇧A leaves it) · Fertig;
 *  3. without confirming (auto, Freigaben "Alle" = Plan und Review): the switch needs a budget, then switches on (no
 *     fuse) · the worker is away when ↵ Planen is pressed: "Plant und startet ohne Bestätigung, sobald der Worker zurück
 *     ist" · the worker comes back: it plans with the server and starts by itself (toast, the 10 s count) · a second
 *     request whose plan asks a question falls back to Kette bereit and says why · "Alle Ketten anhalten" on #/coding.
 * With ORDERS_SHOTS=<dir> every station of the story is also photographed (1440 × 900 and 390 × 844, light and dark).
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserContext, Locator, Page, Route } from '@playwright/test'
import { test, expect, openApp, wsEval, gotoPage, editorOf } from './fixtures'
import { claudeJson, claudeSse, type ClaudeBlock, type ClaudeTurn } from './helpers/providers'
import { startFakeWorker, type FakeWorker, type Json } from './helpers/fakeWorker'
import { readCard, readPlan } from './helpers/orders'
import { flushLamps, waitPreflight } from './helpers/preflightStory.mjs'
import { WORKER_CAN, type WorkerInfo } from '../../src/app/features/coding/protocol'
import { messages as entryMsgs } from '../../src/app/features/coding/orders/entryMessages'
import { messages as plannerMsgs } from '../../src/app/features/coding/orders/plannerMessages'
import { messages as chainMsgs } from '../../src/app/features/coding/orders/chainMessages'
import { messages as plateMsgs } from '../../src/app/features/coding/orders/plateMessages'
import { messages as autoMsgs } from '../../src/app/features/coding/orders/autoMessages'
// @ts-expect-error — a plain .mjs fixture without types
import { startMockMcp } from '../fixtures/mock-mcp.mjs'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** CODING_E2E_PORT: one port for the coding suites when they run side by side (one worker at a time) */
const PORT = Number(process.env.CODING_E2E_PORT) || 47484 + 10 * Number(process.env.TEST_PARALLEL_INDEX ?? 0)
/** ORDERS_SHOTS=<dir>: photograph the story (German, 1440 × 900 + 390 × 844, light + dark) */
const SHOTS = process.env.ORDERS_SHOTS ?? ''

/* ------------------------------------------------------------------ the German words (the app's own packs) */

const DE: Record<string, string> = Object.assign({}, entryMsgs.de, plannerMsgs.de, chainMsgs.de, plateMsgs.de, autoMsgs.de) as Record<string, string>
/** A German string of the work orders with its placeholders filled. */
function de(key: string, vars: Record<string, string | number> = {}): string {
  const s = DE[`features.coding.order.${key}`]
  if (s === undefined) throw new Error(`no German string features.coding.order.${key}`)
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}
/** The part of a string before its first placeholder (for "contains" checks of sentences with live values). */
const lead = (key: string) => de(key).split('{')[0]!.trim()

/* ------------------------------------------------------------------ the world */

const KB_URL = 'https://kb.example.test/mcp'
const KB_TOKEN = 'kb-e2e-PLAINTEXT-token-0001'
/** The person's own server, connected but not tested yet (its tools unknown to One). */
const KB = { id: 'srvkb000001', name: 'wissensbasis', url: KB_URL, token: KB_TOKEN, enabled: true, prompt: '**Wissensbasis** hält die Supportfälle.', promptSource: 'edited' }
/** The same server once tested on this device (its five tools known). */
const KB_TESTED = { ...KB, tools: ['get_item', 'list_comments', 'add_comment', 'update_item', 'log_work'], checkedAt: 1 }
/** Another server, switched on for every AI call — never part of a plan nobody picked it for. */
const ALL = { id: 'srvall00001', name: 'tessera', url: 'https://tessera.example.test/mcp', token: 'tessera-e2e-PLAINTEXT-token-0001', enabled: true, scope: 'all', prompt: '**Tessera** ist das Team-Archiv.', promptSource: 'edited', tools: ['tessera_find'], checkedAt: 1 }
const WELCOME: WorkerInfo = { worker: '1.11.0', name: 'website-box', repos: [{ name: 'website', baseBranch: 'main', branches: ['main'], mcp: [] }], parallel: 1, busy: [], spentToday: 0, dayLimit: null, claude: { found: true, version: '2.0.0' }, setup: true, mcp: [] }
const BRANCH = 'one/login-timeout'
const MR = 'https://git.example.test/nordlicht/website/-/merge_requests/7'
const REQUEST_TITLE = 'Login-Timeout prüfen'

type Seam = { __oneOrders: Record<string, (...a: any[]) => Promise<any>>; __onePreflight: { stores: { coding: { getState: () => AnyState } } }; __oneCodingWrites: Record<string, (...a: any[]) => any> } // eslint-disable-line @typescript-eslint/no-explicit-any
/** This device's record of a request (read only — the story never drives the chain through a seam). */
const recordOf = (page: Page, row: string) => page.evaluate((r) => (window as unknown as Seam).__oneOrders.record!(r), row) as Promise<AnyState | null>
const connected = (page: Page) => expect.poll(() => page.evaluate(() => (window as unknown as Seam).__onePreflight.stores.coding.getState().conn), { timeout: 30_000 }).toBe('connected')

/* ------------------------------------------------------------------ the fake connector (api.anthropic.com) */

interface Mock {
  url: string
  port: number
  calls: () => Array<{ tool: string; args: AnyState; authSha256: string | null }>
  close: () => Promise<void>
}

interface Connector {
  /** the planner requests, in order (their bodies) */
  planner: AnyState[]
  /** the connection tests */
  inspect: AnyState[]
  /** any other request (none expected) */
  other: AnyState[]
  /** the planner's next answers (a function of the request; default: the three-step plan) */
  plans: Array<(body: AnyState, context: string | null) => AnyState>
  /** hold the planner's answer this long (to see the plate while One plans) */
  holdMs: number
}

/** An MCP client of the mock — what Anthropic's connector opens with the request's token. */
async function mcpClient(url: string, token: string) {
  const { Client } = (await import('../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js')) as typeof import('../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.d.ts')
  const { StreamableHTTPClientTransport } = (await import('../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js')) as typeof import('../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.d.ts')
  const client = new Client({ name: 'connector-e2e', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { authorization: `Bearer ${token}` } } }))
  return client
}

const systemText = (body: AnyState): string => (typeof body.system === 'string' ? body.system : Array.isArray(body.system) ? body.system.map((b: AnyState) => b.text ?? '').join('\n') : '')
const userText = (body: AnyState): string => (body.messages ?? []).map((m: AnyState) => (typeof m.content === 'string' ? m.content : (m.content ?? []).map((c: AnyState) => c.text ?? '').join('\n'))).join('\n')

/** The plan the planner answers for the owner's request (three steps; `context` only when a server took part). */
function ownerPlan(caseId: string, context: string | null): AnyState {
  return {
    v: 1,
    summary: 'Der Login von Nordlicht bricht nach 30 Sekunden ab; laut Supportfall 4711 liegt es vermutlich am Session-Timeout im Gateway.',
    context: context ? { server: 'wissensbasis', note: context, links: ['https://kb.example.test/r/4711'] } : null,
    steps: [
      {
        kind: 'spec',
        title: 'Login-Timeout klären',
        goal: `Klären, wo der Abbruch nach 30 s entsteht und welches Verhalten gewünscht ist. Grundlage: [Supportfall 4711](#/p/${caseId}).`,
        criteria: ['Ursache des Abbruchs benannt', 'Gewünschte Sitzungsdauer festgelegt'],
        repo: null,
        branch: null,
        priority: 'high',
        refs: [caseId],
        why: 'Unklar, ob das Gateway oder die App den Login beendet.',
      },
      {
        kind: 'coding',
        title: 'Session-Timeout beheben',
        goal: 'Das Session-Timeout so ändern, dass der Login nicht mehr nach 30 s abbricht.',
        criteria: ['Login bleibt 5 Minuten offen', 'Test für den Timeout vorhanden'],
        repo: 'website',
        branch: null,
        priority: 'high',
        refs: [],
        why: 'Nutzer verlieren beim Login ihre Eingaben.',
      },
      {
        kind: 'qa',
        title: 'Login-Timeout testen',
        goal: 'Testfälle für Login und Sitzungsdauer.',
        criteria: ['Testfall: Login nach 60 s noch aktiv', 'Testfall: Abmelden beendet die Sitzung'],
        repo: 'website',
        branch: null,
        priority: 'medium',
        refs: [],
        why: 'Der geänderte Timeout soll nicht wieder zurückfallen.',
      },
    ],
    questions: [],
    refused: null,
  }
}

/**
 * api.anthropic.com as the Messages API with its MCP connector: the planner's request (its servers called as the request
 * allows — `get_item` of the support case when it may), the connection test (the server's tools listed), nothing else.
 */
async function fakeConnector(ctx: BrowserContext, mock: Mock, caseId: () => string): Promise<Connector> {
  const conn: Connector = { planner: [], inspect: [], other: [], plans: [], holdMs: 0 }
  const target = (url: string) => {
    if (url !== KB_URL) throw new Error(`the connector knows no server at ${url}`)
    return mock.url
  }
  const turn = async (body: AnyState): Promise<ClaudeTurn> => {
    const system = systemText(body)
    // the connection test: list the server's tools
    if (/List the tools of this server|usage guide/.test(userText(body))) {
      conn.inspect.push(body)
      const s = (body.mcp_servers ?? [])[0] as AnyState
      const client = await mcpClient(target(s.url), s.authorization_token)
      try {
        const { tools } = await client.listTools()
        const names = tools.map((t) => t.name).join(', ')
        const guide = /usage guide/.test(userText(body)) ? '\n---\n**Wissensbasis** hält die Supportfälle: `get_item` liest einen Fall, `list_comments` seine Kommentare.' : ''
        return { blocks: [{ type: 'text', text: `TOOLS: ${names}${guide}` }], usage: { input: 900, output: 60 } }
      } finally {
        await client.close().catch(() => undefined)
      }
    }
    if (system.startsWith('You plan a chain of pipeline tasks')) {
      conn.planner.push(body)
      const blocks: ClaudeBlock[] = []
      let context: string | null = null
      for (const s of (body.mcp_servers ?? []) as AnyState[]) {
        const set = ((body.tools ?? []) as AnyState[]).find((t) => t.type === 'mcp_toolset' && t.mcp_server_name === s.name)
        const on = (name: string): boolean => set?.configs?.[name]?.enabled ?? set?.default_config?.enabled ?? true
        const client = await mcpClient(target(s.url), s.authorization_token)
        try {
          const { tools } = await client.listTools()
          const allowed = tools.map((t) => t.name).filter(on)
          if (allowed.includes('get_item')) {
            const out = await client.callTool({ name: 'get_item', arguments: { ref: '4711' } })
            const text = ((out.content ?? []) as AnyState[]).map((c) => c.text ?? '').join('')
            blocks.push({ type: 'mcp_tool_use', id: 'mcptoolu_kb_01', server: s.name, name: 'get_item', input: { ref: '4711' } }, { type: 'mcp_tool_result', id: 'mcptoolu_kb_01', text })
            const item = JSON.parse(text) as AnyState
            context = `${item.title}. ${item.comments?.[0]?.body ?? ''} Gemeldet von ${item.comments?.[0]?.by ?? '—'}.`
          }
        } finally {
          await client.close().catch(() => undefined)
        }
      }
      const make = conn.plans.shift() ?? ((_b: AnyState, c: string | null) => ownerPlan(caseId(), c))
      blocks.push({ type: 'text', text: JSON.stringify(make(body, context)) })
      if (conn.holdMs) await new Promise((r) => setTimeout(r, conn.holdMs))
      return { blocks, usage: { input: 3200, output: 900 } }
    }
    conn.other.push(body)
    return { blocks: [{ type: 'text', text: 'OK.' }] }
  }
  await ctx.route('https://api.anthropic.com/**', async (route: Route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    // GET (a key check): an empty list — the story's key is set up already, nothing here names a model
    if (req.method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [], has_more: false }) })
    const body = JSON.parse(req.postData() ?? '{}') as AnyState
    let out: ClaudeTurn
    try {
      out = await turn(body)
    } catch (e) {
      return route.fulfill({ status: 500, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'error', error: { type: 'api_error', message: String((e as Error).message) } }) }).catch(() => undefined)
    }
    try {
      if (body.stream === true) return await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: claudeSse(out, body.model) })
      await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(claudeJson(out, body.model)) })
    } catch {
      /* the request was aborted (⌘.) */
    }
  })
  return conn
}

/* ------------------------------------------------------------------ the worker */

/** What the fake worker answers per stage (Claude Code's costs as reported; the QA stage's test cases as a JSON fence). */
function plays(fake: FakeWorker, hold: (task: Json) => boolean = () => false) {
  fake.auto = (task) => {
    if (hold(task)) return null
    const st = task.stage as AnyState
    if (st.kind === 'doc' && /^(Testfälle|Test cases)$/.test(st.name)) {
      const cases = [
        { id: 'TC-01', title: 'Login nach 60 s noch aktiv', type: 'functional', priority: 'high', steps: ['Anmelden', '60 s warten', 'Seite neu laden'], expected: 'Weiter angemeldet' },
        { id: 'TC-02', title: 'Abmelden beendet die Sitzung', type: 'functional', priority: 'medium', steps: ['Anmelden', 'Abmelden'], expected: 'Sitzung beendet' },
      ]
      return { status: 'ok', plan: `## Testfälle\n\nZwei Fälle für Login und Sitzungsdauer (Nordlicht).\n\n\`\`\`json\n${JSON.stringify({ cases })}\n\`\`\``, cost: 0.2 }
    }
    if (st.kind === 'doc') return { status: 'ok', plan: `## ${st.name}\n\nErgebnis von ${st.name}: Das Gateway beendet die Sitzung nach 30 s (Nordlicht). Gewünscht sind 5 Minuten.`, cost: 0.3 }
    if (st.kind === 'plan') return { status: 'ok', plan: 'Plan: Session-Timeout im Gateway auf 5 Minuten setzen und einen Test dafür schreiben.', cost: 0.25 }
    if (st.kind === 'implement') return { status: 'ok', summary: 'Session-Timeout auf 5 Minuten gesetzt, Test ergänzt.', branch: BRANCH, cost: 1.1 }
    if (st.kind === 'test') return { status: 'ok', test: { ok: true, output: 'PASS all checks', ms: 12, code: 0 } }
    if (st.kind === 'git') return { status: 'ok', branch: BRANCH, url: MR }
    return { status: 'ok' }
  }
}

/* ------------------------------------------------------------------ the workspace */

/**
 * The owner's device: Coding on with the worker, the AI key, German, this device's Freigaben, the page "Supportfall 4711",
 * the Coding project #/coding made (its sample task removed). Business analysis and QA have no project yet — the chain
 * makes them.
 */
async function setup(page: Page, o: { approvals: 'all' | 'review' | 'none'; servers: AnyState[] }) {
  await page.addInitScript(
    ([port, approvals]) => {
      localStorage.setItem('one.coding', JSON.stringify({ enabled: true, port }))
      localStorage.setItem('one.tour', '{"off":true}')
      localStorage.setItem('one.coding.approvals', approvals)
    },
    [PORT, o.approvals] as const,
  )
  await openApp(page)
  await wsEval(page, (s, a) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', language: 'de', mcpServers: a }), o.servers)
  const caseId = await wsEval(page, (s) =>
    s.createPage({
      title: 'Supportfall 4711',
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Kunde Tessera meldet: der Login bricht nach 30 Sekunden ab, die Eingaben sind weg. Gemeldet von Mara Lind.' }] }] },
    }) as string,
  )
  const seed = await page.evaluate(() => (window as unknown as Seam).__oneCodingWrites.create!('seed', 'coding'))
  await wsEval(page, (s, id) => s.deletePagePermanently(id), seed as string)
  await connected(page)
  return { caseId }
}

const orderDb = (page: Page) => wsEval(page, (s) => ((Object.values(s.databases) as AnyState[]).find((d) => d.system === 'workorders' && !s.pages[d.id]?.trashed)?.id ?? null) as string | null)
const statusKey = (page: Page, row: string) =>
  wsEval(
    page,
    (s, id) => {
      const row = s.pages[id]
      const db = s.databases[row.databaseId]
      const ids = db.orders.status as Record<string, string>
      const prop = db.properties.find((p: AnyState) => p.type === 'select' && (p.options ?? []).some((o: AnyState) => o.id === ids.draft))
      const v = row.properties[prop.id]
      return (Object.entries(ids).find(([, id]) => id === v)?.[0] ?? null) as string | null
    },
    row,
  )
const stageOf = (page: Page, id: string) =>
  wsEval(
    page,
    (s, id) => {
      const row = s.pages[id]
      const db = s.databases[row.databaseId]
      const stage = db.properties.find((p: AnyState) => p.name === 'Stage' || p.name === 'Stufe')
      return (stage.options.find((o: AnyState) => o.id === row.properties[stage.id])?.name ?? null) as string | null
    },
    id,
  )
const propOf = (page: Page, id: string, names: string[]) =>
  wsEval(
    page,
    (s, [id, names]) => {
      const row = s.pages[id]
      const db = s.databases[row.databaseId]
      const prop = db.properties.find((p: AnyState) => names.includes(p.name))
      return (prop ? (row.properties[prop.id] ?? null) : null) as string | null
    },
    [id, names] as const,
  )
const pageOf = (page: Page, id: string) => wsEval(page, (s, x) => s.pages[x] as AnyState, id)
const textOf = (node: AnyState): string => (node.type === 'text' ? node.text : node.type === 'mention' ? `@${node.attrs?.label ?? ''}` : (node.content ?? []).map(textOf).join(node.type === 'doc' || node.type === 'blockquote' || node.type === 'callout' || node.type === 'bulletList' ? '\n' : ''))
const blocksWithId = (doc: AnyState, id: string): AnyState[] => {
  const out: AnyState[] = []
  const walk = (n: AnyState) => {
    if (n.attrs?.id === id) out.push(n)
    for (const c of n.content ?? []) walk(c)
  }
  walk(doc)
  return out
}
/** The tasks the worker got, in order (id · stage name). */
const handed = (fake: FakeWorker) => fake.handed().map((t) => `${t.id}:${t.stage.name}`)

/**
 * The owner writes a request: #/coding, N — a new row in Entwurf, opened on its own page (the database made on first
 * use); the title, then "prüfe, warum der Login nach 30 s abbricht, siehe @Supportfall 4711, Repo website" typed in its
 * page with the page picked from the @ menu. Returns the row.
 */
async function writeRequest(page: Page, caseId: string): Promise<string> {
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await expect(page.getByTestId('coding-orders')).toBeVisible()
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('n')
  await expect(page.locator('#main .pv-title')).toBeVisible()
  await page.waitForFunction(() => /#\/p\//.test(window.location.hash))
  const row = await page.evaluate(() => window.location.hash.match(/#\/p\/([^/?]+)/)?.[1] ?? '')
  expect(row).not.toBe('')
  await expect(page.getByTestId('order-plate')).toBeVisible()
  await page.locator('#main .pv-title').fill(REQUEST_TITLE)
  await editorOf(page).click()
  await page.keyboard.type('prüfe, warum der Login nach 30 s abbricht, siehe @Supportfall 47')
  await expect(page.getByRole('option', { name: /Supportfall 4711/ }).first()).toBeVisible()
  await page.keyboard.press('Enter')
  await page.keyboard.type(', Repo website')
  await expect.poll(async () => textOf((await pageOf(page, row)).content ?? {}), { timeout: 10_000 }).toContain('siehe @Supportfall 4711')
  expect(JSON.stringify((await pageOf(page, row)).content)).toContain(`"id":"${caseId}"`)
  return row
}

/* ------------------------------------------------------------------ Preflight */

const pfCard = (page: Page) => page.locator('.pf-q article.pf-card[data-current]')
/** Start (Preflight's plate), the lamps read now, a lamp's queue opened with ↵ on its cap; the card takes the keyboard. */
async function openLamp(page: Page, id: string): Promise<void> {
  await page.evaluate(() => (window.location.hash = '#/'))
  await waitPreflight(page)
  const cap = page.locator(`.pf-cap[data-lamp="${id}"]`)
  await expect
    .poll(
      async () => {
        await flushLamps(page)
        return cap.count()
      },
      { timeout: 20_000 },
    )
    .toBe(1)
  await cap.focus()
  await page.keyboard.press('Enter')
  await expect(pfCard(page)).toBeFocused()
}
/** A key on the current card (keys act only with focus in the queue). */
async function pfPress(page: Page, key: string): Promise<void> {
  await pfCard(page).focus()
  await page.keyboard.press(key)
}

/* ------------------------------------------------------------------ the photographs */

/**
 * ORDERS_SHOTS only: the station of the story in German at 1440 × 900 and 390 × 844, light and dark (the viewport with
 * `target` scrolled into view, and `target` alone). Back to 1440 × 900 light afterwards.
 */
async function shot(page: Page, name: string, target?: Locator) {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  for (const theme of ['light', 'dark'] as const) {
    await wsEval(page, (s, th) => s.updateSettings({ theme: th }), theme)
    for (const [w, h] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      await page.setViewportSize({ width: w, height: h })
      await page.waitForTimeout(350)
      if (target && (await target.count())) {
        await page.keyboard.press('Shift')
        await target.first().scrollIntoViewIfNeeded().catch(() => undefined)
        await page.waitForTimeout(150)
      }
      await page.screenshot({ path: join(SHOTS, `${name}-${theme}-${w}.png`) })
      if (target && (await target.count())) {
        // a tall plate sits in an inner scroller: a taller window shows it whole (the part shot only)
        const tall = await target.first().evaluate((el) => Math.ceil(Math.max(el.scrollHeight, el.getBoundingClientRect().height))).catch(() => 0)
        if (tall > h - 160) {
          await page.setViewportSize({ width: w, height: Math.min(tall + 320, 6000) })
          await page.waitForTimeout(300)
          await target.first().scrollIntoViewIfNeeded().catch(() => undefined)
        }
        await target.first().screenshot({ path: join(SHOTS, `${name}-${theme}-${w}-part.png`) }).catch(() => undefined)
        if (tall > h - 160) await page.setViewportSize({ width: w, height: h })
      }
    }
  }
  await wsEval(page, (s) => s.updateSettings({ theme: 'light' }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(250)
}

/* ------------------------------------------------------------------ the story */

test.describe('Prüfaufträge — the owner\'s story end to end (B15)', () => {
  test.describe.configure({ mode: 'serial' })
  let fake: FakeWorker | null = null
  let mock: Mock | null = null
  test.beforeEach(async ({ errors }) => {
    errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
    fake = await startFakeWorker(PORT, WELCOME)
    fake.can = [...WORKER_CAN]
    mock = (await startMockMcp()) as Mock
  })
  test.afterEach(async () => {
    await fake?.close()
    fake = null
    await mock?.close()
    mock = null
  })

  test('1 · mit Server, mit Bestätigung: schreiben → Planen → die Platte → ↵ Kette starten → BA → Analyse-Karte → Coding → H / ↵ Fortsetzen → QA auf dem Coding-Branch → Fertig → W', async ({ page }) => {
    test.setTimeout(360_000)
    let caseId = ''
    const conn = await fakeConnector(page.context(), mock!, () => caseId)
    ;({ caseId } = await setup(page, { approvals: 'review', servers: [KB] }))
    plays(fake!)

    // ── 1. writing the request: #/coding, N — a new request in its own page (the database made on first use)
    const row = await writeRequest(page, caseId)
    const db = await orderDb(page)
    expect(db).not.toBeNull()
    const plate = page.getByTestId('order-plate')
    await expect(plate.getByTestId('order-status')).toContainText(de('status.draft'))
    // writing never plans: the Status stays Entwurf, nothing goes out
    await page.waitForTimeout(1500)
    expect(await statusKey(page, row)).toBe('draft')
    expect(conn.planner).toHaveLength(0)
    await shot(page, 'b15-1-draft', plate)

    // ── the settings: the server is optional — "wissensbasis" untested first; "Server testen" lists its tools
    await plate.getByTestId('order-settings-key').first().click()
    const settings = page.getByTestId('order-settings')
    await expect(settings).toBeVisible()
    await expect(settings.getByTestId('order-server-none')).toBeChecked()
    const kbRow = settings.getByTestId('order-server-row').filter({ hasText: 'wissensbasis' })
    await expect(kbRow).toContainText(de('settings.untested'))
    await kbRow.getByRole('button', { name: de('plan.testServer') }).click()
    await expect(page.getByTestId('mcp-connections')).toBeVisible()
    await page.getByTestId('mcpc-test').first().click()
    await expect.poll(() => conn.inspect.length, { timeout: 20_000 }).toBeGreaterThan(0)
    await expect.poll(async () => ((await wsEval(page, (s) => s.settings.mcpServers[0]?.tools ?? [])) as string[]).sort().join(','), { timeout: 20_000 }).toBe('add_comment,get_item,list_comments,log_work,update_item')
    // the test sent no page text and named only that server
    expect(conn.inspect[0]!.mcp_servers.map((s: AnyState) => s.name)).toEqual(['wissensbasis'])
    await gotoPage(page, row)
    await plate.getByTestId('order-settings-key').first().click()
    await expect(kbRow).not.toContainText(de('settings.untested'))
    await expect(kbRow).toContainText('get_item, list_comments')
    await expect(kbRow).toContainText('add_comment')
    await settings.getByTestId('order-server-wissensbasis').check()
    await expect.poll(() => wsEval(page, (s, id) => s.databases[id].orders?.server?.name ?? null, db!)).toBe('wissensbasis')
    await shot(page, 'b15-1-settings', settings)
    await page.keyboard.press('Escape')
    await expect(settings).toHaveCount(0)
    await expect(plate.getByTestId('order-lamp-context')).toContainText('wissensbasis')

    // ── 2. pressing: ↵ Planen — One reads the request, the linked page and the server (read tools only)
    conn.holdMs = 2500
    await plate.getByTestId('order-plan').click()
    await expect(plate.getByTestId('order-planning')).toBeVisible({ timeout: 15_000 })
    await expect(plate.getByTestId('order-planning-read')).toContainText(/1 verlinkte Seite/)
    await shot(page, 'b15-1-planning', plate)
    await expect(plate.getByTestId('order-plan-step')).toHaveCount(3, { timeout: 30_000 })
    conn.holdMs = 0
    expect(await statusKey(page, row)).toBe('ready')
    // the request: exactly the picked server with its read tools — never the write tools, never another server
    expect(conn.planner).toHaveLength(1)
    const sent = conn.planner[0]!
    expect(sent.mcp_servers.map((s: AnyState) => s.name)).toEqual(['wissensbasis'])
    const set = (sent.tools as AnyState[]).find((t) => t.type === 'mcp_toolset')!
    expect(set.default_config?.enabled).toBe(false)
    const enabled = Object.entries(set.configs ?? {}).filter(([, c]) => (c as AnyState).enabled).map(([n]) => n).sort()
    expect(enabled).toEqual(['get_item', 'list_comments'])
    expect(userText(sent)).toContain('prüfe, warum der Login nach 30 s abbricht')
    expect(userText(sent)).toContain('Kunde Tessera meldet')
    // the server saw reads only
    expect(mock!.calls().map((c) => c.tool)).toEqual(['get_item'])

    // ── 3. the chain on the plate: Verstanden, the server's content FREMD and what goes along, every step in full
    await expect(plate.getByTestId('order-understood')).toContainText('Session-Timeout im Gateway')
    const ctx = plate.getByTestId('order-context')
    await expect(ctx).toContainText('Supportfall 4711 (Nordlicht)')
    await expect(ctx).toContainText(de('plan.goesWith', { n: '01' }))
    await expect(ctx.getByTestId('order-call')).toHaveCount(1)
    await expect(ctx.getByTestId('order-call')).toContainText('get_item')
    const stations = plate.getByTestId('order-plan-step')
    const heads = plate.getByTestId('order-station-head')
    for (let i = 0; i < 3; i++) await expect(heads.nth(i).getByTestId('order-tag-foreign')).toBeVisible()
    await expect(heads.nth(0)).toContainText('Login-Timeout klären')
    await expect(heads.nth(1)).toContainText('Session-Timeout beheben')
    await expect(heads.nth(2)).toContainText('Login-Timeout testen')
    // where each step stops for the person (this device's Freigaben "Review")
    await expect(stations.nth(0)).toContainText('Spezifikation freigeben')
    await expect(stations.nth(1)).toContainText('Review')
    await expect(stations.nth(2)).toContainText('Testfälle freigeben')
    await expect(plate.getByTestId('order-cost')).toBeVisible()
    await shot(page, 'b15-1-ready', plate)
    // ↵ waits until everything was seen in full
    const start = plate.getByTestId('order-start')
    await expect(start).toHaveAttribute('aria-disabled', 'true')
    await readPlan(page)
    await expect(start).toHaveAttribute('data-ready', '')
    await expect(start).toContainText(de('key.startForeign'))
    // the budget per chain: one tap
    await plate.getByTestId('order-budget-10').click()
    await expect.poll(async () => (await recordOf(page, row))?.draft?.budget ?? null).toBe(10)
    await shot(page, 'b15-1-ready-keys', plate.getByTestId('order-keys'))

    // ── 5. ↵ Kette starten: every task made at once (in #/coding), step 01 after a 10 s count — ↵ jetzt
    await start.click()
    const count = plate.getByTestId('order-countdown')
    await expect(count).toBeVisible()
    await expect(count).toContainText(lead('chain.countdown'))
    const rec = (await recordOf(page, row))!
    expect(rec.state).toBe('running')
    expect(rec.chain.budgetUsd).toBe(10)
    const ids = ([...rec.chain.steps] as AnyState[]).sort((a, b) => a.n - b.n).map((s) => s.id as string)
    expect(ids).toHaveLength(3)
    expect(await statusKey(page, row)).toBe('running')
    for (const id of ids) expect(await stageOf(page, id)).toBe('Backlog')
    await shot(page, 'b15-1-count', plate)
    await plate.getByTestId('order-start-now').click()
    await expect(count).toHaveCount(0)

    // ── 6. BA runs and stops at its own approval (this device's Freigaben); nothing of step 02 reaches the worker
    await expect.poll(() => stageOf(page, ids[0]!), { timeout: 60_000 }).toBe('Spezifikation freigeben')
    expect(handed(fake!).every((h) => h.startsWith(ids[0]!))).toBe(true)
    await gotoPage(page, ids[0]!)
    await expect(page.getByTestId('coding-chain-line')).toContainText('Schritt 1 von 3')
    const approve = page.getByTestId('coding-approve')
    await expect(approve).toBeVisible({ timeout: 20_000 })
    // the step's context callout names the server it was read from — no "the task mentions …" note for Claude Code
    await expect(page.getByTestId('coding-task-mcp')).toBeVisible()
    await expect(page.getByTestId('coding-task-mcp-missing')).toHaveCount(0)
    await shot(page, 'b15-1-ba-gate', page.getByTestId('coding-panel'))
    // approved without opening the next step: the analysis card follows (the person has not seen step 02 yet)
    await expect(approve).toHaveAttribute('data-ready', '', { timeout: 10_000 })
    await approve.click()
    await expect.poll(() => stageOf(page, ids[0]!), { timeout: 60_000 }).toBe('Fertig')
    // a done chain step hands on by its chain: no "Danach" keys that would make a task outside it
    await expect(page.getByTestId('coding-chain-line')).toBeVisible()
    await expect(page.getByTestId('coding-then')).toHaveCount(0)

    // ── 7. once after the analysis: the card shows step 02 as it will run, with the Grundlage — ↵ Weiter
    await gotoPage(page, row)
    const card = plate.getByTestId('order-chain-card')
    await expect(card).toHaveAttribute('data-why', 'checkpoint', { timeout: 30_000 })
    await expect(plate.getByTestId('order-card-why').first()).toContainText('Session-Timeout beheben')
    await expect(plate.getByTestId('order-card-basis')).toContainText('Aus Schritt 01')
    await expect(plate.getByTestId('order-card-basis')).toContainText('Das Gateway beendet die Sitzung nach 30 s')
    await shot(page, 'b15-1-checkpoint', card)
    expect(handed(fake!).some((h) => h.startsWith(ids[1]!))).toBe(false)
    const go = plate.getByTestId('order-card-go')
    await readCard(page)
    await expect(go).toHaveAttribute('data-ready', '', { timeout: 10_000 })
    await go.click()

    // ── Coding: its own stages; Freigaben "Review" stop it at Review — the Laufleiste says where each step stands
    await expect.poll(() => stageOf(page, ids[1]!), { timeout: 60_000 }).toBe('Review')
    const step2 = await pageOf(page, ids[1]!)
    expect(blocksWithId(step2.content, `${ids[1]}-wait`)).toHaveLength(1)
    expect(textOf(blocksWithId(step2.content, `${ids[1]}-wait`)[0]!)).toContain('Aus Schritt 01')
    expect(await propOf(page, ids[1]!, ['Branch'])).toBe(BRANCH)
    const lanes = plate.getByTestId('order-chain-row')
    await expect(lanes).toHaveCount(3)
    await expect(lanes.nth(2)).toContainText(/wartet auf 02/i)
    await shot(page, 'b15-1-running', plate)

    // ── halting: H on the plate — the running step finishes, nothing further starts
    await plate.locator('.orp-code').focus()
    await page.keyboard.press('h')
    await expect.poll(() => statusKey(page, row), { timeout: 10_000 }).toBe('halted')
    await expect(plate.getByTestId('order-chain-halted')).toBeVisible()
    // the review approved meanwhile: Coding goes to Fertig, QA stays parked (the halt holds)
    await gotoPage(page, ids[1]!)
    const approve2 = page.getByTestId('coding-approve')
    await expect(approve2).toBeVisible({ timeout: 20_000 })
    // halted: this approval starts nothing — no "starts the next step" line, a plain key (not VON HAND)
    await expect(page.getByTestId('order-gate-next')).toHaveCount(0)
    await expect(approve2).not.toHaveAttribute('aria-disabled', 'true')
    await approve2.click()
    await expect.poll(() => stageOf(page, ids[1]!), { timeout: 60_000 }).toBe('Fertig')
    await page.waitForTimeout(2500)
    expect(await stageOf(page, ids[2]!)).toBe('Backlog')
    expect(handed(fake!).some((h) => h.startsWith(ids[2]!))).toBe(false)
    await gotoPage(page, row)
    await expect(plate.getByTestId('order-chain-halted')).toBeVisible()
    await shot(page, 'b15-1-halted', plate)

    // ── ↵ Fortsetzen (VON HAND): QA starts on the coding branch with step 02's result as its Grundlage
    const resume = plate.getByTestId('order-resume')
    await expect(resume).toHaveAttribute('data-ready', '', { timeout: 10_000 })
    await resume.click()
    await expect.poll(() => statusKey(page, row), { timeout: 10_000 }).toBe('running')
    await expect.poll(() => stageOf(page, ids[2]!), { timeout: 60_000 }).toBe('Testfälle freigeben')
    expect(await propOf(page, ids[2]!, ['Branch'])).toBe(BRANCH)
    const step3 = await pageOf(page, ids[2]!)
    expect(textOf(blocksWithId(step3.content, `${ids[2]}-wait`)[0]!)).toContain('Aus Schritt 02')
    await gotoPage(page, ids[2]!)
    const approve3 = page.getByTestId('coding-approve')
    await expect(approve3).toBeVisible({ timeout: 20_000 })
    // the last step: its approval starts nothing more — no "starts the next step" line
    await expect(page.getByTestId('order-gate-next')).toHaveCount(0)
    await expect(approve3).not.toHaveAttribute('aria-disabled', 'true')
    await approve3.click()

    // ── 8. Fertig: each step with its result — the MR, the test cases, what Claude Code cost on this worker; W
    await expect.poll(async () => (await recordOf(page, row))?.state ?? null, { timeout: 60_000 }).toBe('done')
    expect(await statusKey(page, row)).toBe('done')
    // strict order: every stage of a step came after the step before it was done
    const order = handed(fake!)
    const lastOf = (id: string) => order.map((h) => h.startsWith(id)).lastIndexOf(true)
    const firstOf = (id: string) => order.findIndex((h) => h.startsWith(id))
    expect(lastOf(ids[0]!)).toBeLessThan(firstOf(ids[1]!))
    expect(lastOf(ids[1]!)).toBeLessThan(firstOf(ids[2]!))
    await gotoPage(page, row)
    const results = plate.getByTestId('order-result')
    await expect(results).toHaveCount(3)
    await expect(results.nth(1)).toContainText('merge_requests/7')
    await expect(results.nth(2)).toContainText('2')
    await shot(page, 'b15-1-done', plate)
    await plate.locator('.orp-code').focus()
    await page.keyboard.press('w')
    const sumId = `${row}-sum-${rec.chain.run}`.slice(0, 120)
    await expect.poll(async () => blocksWithId((await pageOf(page, row)).content, sumId).length, { timeout: 10_000 }).toBe(1)
    const sum = blocksWithId((await pageOf(page, row)).content, sumId)[0]!
    expect(sum.type).toBe('callout')
    expect(textOf(sum)).toContain('Session-Timeout beheben')
    // the request's own text is still the person's
    expect(textOf((await pageOf(page, row)).content)).toContain('prüfe, warum der Login nach 30 s abbricht')
    await shot(page, 'b15-1-summary', editorOf(page))
    // nothing else ever asked the AI
    expect(conn.other).toEqual([])
  })

  test('2 · ohne Server: „Prüfen lassen“ auf der Seite → plant sofort, ohne Server → der Zähler läuft ab → die BA-Freigabe mit dem nächsten Schritt gelesen ist der eine Druck → die Freigaben im Vorflug-Check (VON HAND) → Fertig', async ({ page }) => {
    test.setTimeout(360_000)
    let caseId = ''
    const conn = await fakeConnector(page.context(), mock!, () => caseId)
    ;({ caseId } = await setup(page, { approvals: 'all', servers: [ALL] }))
    plays(fake!)

    // ── on the page itself: ⋯ › Prüfen lassen — the first time makes the database (toast + Rückgängig); the page stays
    await gotoPage(page, caseId)
    const before = await pageOf(page, caseId)
    await page.locator('.tb').getByRole('button', { name: 'Seitenoptionen' }).click()
    await page.getByRole('menuitem', { name: de('cmd.send'), exact: true }).click()
    const made = page.locator('.toast', { hasText: de('created', { id: 'PA-1' }) })
    await expect(made).toBeVisible()
    await expect(made.getByRole('button', { name: /Rückgängig/ })).toBeVisible()
    const peek = page.locator('.peek')
    await expect(peek.getByTestId('order-plate')).toBeVisible()
    await shot(page, 'b15-2-send', peek)
    const db = (await orderDb(page))!
    const row = (await wsEval(page, (s, d) => (Object.values(s.pages) as AnyState[]).find((p) => p.databaseId === d && !p.trashed)!.id as string, db)) as string
    expect(await wsEval(page, (s, id) => s.pages[id].title as string, row)).toBe('Supportfall 4711')
    // it plans at once — without any server: none was picked, also not the one on for every AI call
    await expect.poll(() => statusKey(page, row), { timeout: 30_000 }).toBe('ready')
    expect(conn.planner).toHaveLength(1)
    expect(conn.planner[0]!.mcp_servers ?? []).toEqual([])
    expect(((conn.planner[0]!.tools ?? []) as AnyState[]).filter((t) => t.type === 'mcp_toolset')).toEqual([])
    expect(mock!.calls()).toEqual([])
    const after = await pageOf(page, caseId)
    expect({ plain: after.plain, title: after.title }).toEqual({ plain: before.plain, title: before.title })

    // ── the plate without a server: the KONTEXT lamp dim "ohne Server", no Kontext box, nothing marked FREMD
    await page.keyboard.press('Escape')
    await gotoPage(page, row)
    const plate = page.getByTestId('order-plate')
    await expect(plate.getByTestId('order-lamp-context')).toContainText(de('lamp.context.none'))
    await expect(plate.getByTestId('order-context')).toHaveCount(0)
    await expect(plate.getByTestId('order-tag-foreign')).toHaveCount(0)
    await expect(plate.getByTestId('order-plan-step')).toHaveCount(3)
    await shot(page, 'b15-2-ready', plate)
    await readPlan(page)
    const start = plate.getByTestId('order-start')
    await expect(start).toHaveAttribute('data-ready', '')
    await expect(start).not.toContainText('Server-Inhalt')
    await start.click()

    // ── the count runs out by itself: step 01 reaches the worker ~10 s after ↵ (nothing earlier)
    await expect(plate.getByTestId('order-countdown')).toBeVisible()
    const rec = (await recordOf(page, row))!
    const ids = ([...rec.chain.steps] as AnyState[]).sort((a, b) => a.n - b.n).map((st) => st.id as string)
    const pressed = Date.now()
    await page.waitForTimeout(3000)
    expect(handed(fake!)).toEqual([])
    await expect.poll(() => handed(fake!).some((h) => h.startsWith(ids[0]!)), { timeout: 30_000 }).toBe(true)
    expect(Date.now() - pressed).toBeGreaterThan(8000)

    // ── BA stops at its approval; the task panel shows step 02 as it will run — read whole, the approval is the one press
    await expect.poll(() => stageOf(page, ids[0]!), { timeout: 60_000 }).toBe('Spezifikation freigeben')
    await gotoPage(page, ids[0]!)
    const next = page.getByTestId('order-gate-next')
    await expect(next).toContainText('Session-Timeout beheben')
    await page.keyboard.press('Shift')
    await page.getByTestId('order-gate-next-fold').locator('summary').click()
    await page.getByTestId('order-gate-next-fold').locator('.orc-edge').scrollIntoViewIfNeeded()
    await expect(next).toHaveAttribute('data-seen', '')
    await shot(page, 'b15-2-gate-fold', page.getByTestId('coding-panel'))
    // a write to the task meanwhile (its icon — not part of its version) does not make the approval count as unseen
    await wsEval(page, (s, id) => s.updatePage(id, { icon: { type: 'emoji', value: '🔎' } }), ids[0]!)
    await page.waitForTimeout(800)
    await expect(next).toHaveAttribute('data-seen', '')
    const approve = page.getByTestId('coding-approve')
    await expect(approve).toHaveAttribute('data-ready', '')
    await approve.click()
    // no analysis card: Coding starts after BA's last stage and stops at its own plan approval
    await expect.poll(() => stageOf(page, ids[1]!), { timeout: 60_000 }).toBe('Plan freigeben')
    expect((await recordOf(page, row))!.chain.doneBy['1']).toBeTruthy()

    // ── Coding's approvals in the Vorflug-Check: each is VON HAND (it starts the worker), ⇧A leaves it
    await openLamp(page, 'gate')
    await expect(pfCard(page)).toHaveAttribute('data-kind', 'gate', { timeout: 20_000 })
    await expect(pfCard(page)).not.toHaveAttribute('aria-busy', 'true')
    expect(await pfCard(page).getAttribute('data-id')).toContain(ids[1]!)
    await expect(pfCard(page).getByTestId('pf-chip')).toHaveText('PA-1 · 2/3')
    await expect(pfCard(page)).toHaveAttribute('data-hand', '')
    await pfPress(page, 'Shift+A')
    await page.waitForTimeout(500)
    expect(await stageOf(page, ids[1]!)).toBe('Plan freigeben')
    await pfPress(page, 'a')
    await page.getByTestId('pf-confirm-key').press('Enter')
    await expect.poll(() => stageOf(page, ids[1]!), { timeout: 60_000 }).toBe('Review')
    // Review: approving it ends the step — the card names the next step (QA) and is VON HAND too
    await openLamp(page, 'gate')
    await expect(pfCard(page)).toHaveAttribute('data-kind', 'gate', { timeout: 20_000 })
    await expect(pfCard(page)).not.toHaveAttribute('aria-busy', 'true')
    expect(await pfCard(page).getAttribute('data-id')).toContain(ids[1]!)
    await expect(pfCard(page).getByTestId('pf-chain-next')).toContainText('Login-Timeout testen')
    await expect(pfCard(page)).toHaveAttribute('data-hand', '')
    await shot(page, 'b15-2-preflight-gate', pfCard(page))
    await pfPress(page, 'Shift+A')
    await page.waitForTimeout(500)
    expect(await stageOf(page, ids[1]!)).toBe('Review')
    await pfPress(page, 'a')
    await page.getByTestId('pf-confirm-key').press('Enter')
    // QA runs on the coding branch and stops at its own approval; the last one ends the chain
    await expect.poll(() => stageOf(page, ids[2]!), { timeout: 60_000 }).toBe('Testfälle freigeben')
    expect(await propOf(page, ids[2]!, ['Branch'])).toBe(BRANCH)
    await openLamp(page, 'gate')
    await expect(pfCard(page)).toHaveAttribute('data-kind', 'gate', { timeout: 20_000 })
    await expect(pfCard(page)).not.toHaveAttribute('aria-busy', 'true')
    expect(await pfCard(page).getAttribute('data-id')).toContain(ids[2]!)
    await pfPress(page, 'a')
    if (await page.getByTestId('pf-confirm').count()) await page.getByTestId('pf-confirm-key').press('Enter')
    await expect.poll(async () => (await recordOf(page, row))?.state ?? null, { timeout: 60_000 }).toBe('done')
    expect(await statusKey(page, row)).toBe('done')
    await gotoPage(page, row)
    await expect(plate.getByTestId('order-result')).toHaveCount(3)
    await shot(page, 'b15-2-done', plate)
    // no server was ever asked
    expect(mock!.calls()).toEqual([])
    for (const b of conn.planner) expect(b.mcp_servers ?? []).toEqual([])
    expect(conn.other).toEqual([])
  })

  test('3 · ohne Bestätigung (Freigaben „Plan und Review“): Budget, dann der Schalter → Worker weg: „plant und startet, sobald er zurück ist“ → er kommt: plant mit dem Server und startet selbst → eine Rückfrage fällt auf „Kette bereit“ zurück → Alle Ketten anhalten', async ({ page }) => {
    test.setTimeout(360_000)
    let caseId = ''
    const conn = await fakeConnector(page.context(), mock!, () => caseId)
    ;({ caseId } = await setup(page, { approvals: 'all', servers: [KB_TESTED] }))
    plays(fake!)
    const row = await writeRequest(page, caseId)
    const db = (await orderDb(page))!
    const plate = page.getByTestId('order-plate')

    // ── the settings: the server picked; "Ohne Bestätigung starten" needs a budget per chain first
    await plate.getByTestId('order-settings-key').first().click()
    const settings = page.getByTestId('order-settings')
    await settings.getByTestId('order-server-wissensbasis').check()
    const auto = settings.getByTestId('order-auto')
    await expect(auto.getByTestId('order-auto-budget')).toHaveText(de('mode.needsBudget'))
    await expect(auto.getByRole('switch')).toBeDisabled()
    await settings.getByTestId('order-settings-budget').fill('10')
    await settings.getByTestId('order-settings-budget').press('Enter')
    await expect.poll(() => wsEval(page, (s, id) => s.databases[id].orders?.budgetUsd ?? null, db)).toBe(10)
    await expect(auto.getByRole('switch')).toBeEnabled()
    // with Freigaben "Plan und Review" the Patchbay names no fuse: it switches on
    await auto.getByRole('switch').click()
    await expect(auto.getByTestId('order-auto-on')).toBeVisible({ timeout: 20_000 })
    await expect(auto.getByRole('switch')).toBeChecked()
    await shot(page, 'b15-3-settings-on', settings)
    await page.keyboard.press('Escape')
    await expect(settings).toHaveCount(0)

    // ── the worker is away when ↵ Planen is pressed: the press is kept — "plans and starts once the worker is back"
    await fake!.close()
    fake = null
    await expect(plate.getByTestId('order-lamp-worker')).not.toContainText('website-box', { timeout: 30_000 })
    await plate.getByTestId('order-plan').click()
    await expect(plate.getByTestId('order-pre')).toHaveAttribute('data-why', 'later', { timeout: 10_000 })
    await expect(plate.getByTestId('order-pre')).toContainText(lead('why.laterAuto'))
    await expect(plate.getByTestId('order-chip')).toHaveText(de('chip.worker'))
    expect(await statusKey(page, row)).toBe('plan')
    expect(conn.planner).toHaveLength(0)
    await shot(page, 'b15-3-later', plate)

    // ── the worker comes back: 5 s later it plans (with the server) and starts by itself — toast, the 10 s count
    fake = await startFakeWorker(PORT, WELCOME)
    fake.can = [...WORKER_CAN]
    plays(fake)
    await expect.poll(() => conn.planner.length, { timeout: 60_000 }).toBe(1)
    expect(conn.planner[0]!.mcp_servers.map((x: AnyState) => x.name)).toEqual(['wissensbasis'])
    expect(mock!.calls().map((c) => c.tool)).toEqual(['get_item'])
    await expect(page.locator('.toast', { hasText: de('auto.toast.started', { id: 'PA-1', s: 10 }).split(' · ')[0]! }).first()).toBeVisible({ timeout: 30_000 })
    await expect.poll(async () => (await recordOf(page, row))?.state ?? null, { timeout: 20_000 }).toBe('running')
    const rec = (await recordOf(page, row))!
    expect(rec.chain.budgetUsd).toBe(10)
    const ids = ([...rec.chain.steps] as AnyState[]).sort((a, b) => a.n - b.n).map((st) => st.id as string)
    await gotoPage(page, row)
    await expect(plate.getByTestId('order-countdown')).toBeVisible()
    await shot(page, 'b15-3-started', plate)
    // the count runs out: BA runs and stops at its approval (Freigaben "Plan und Review")
    await expect.poll(() => stageOf(page, ids[0]!), { timeout: 60_000 }).toBe('Spezifikation freigeben')

    // ── a second request whose plan asks something: it plans, but falls back to "Kette bereit" and says why
    conn.plans.push((_b, c) => ({ ...ownerPlan(caseId, c), questions: ['Soll die App-Anmeldung auch geprüft werden?'] }))
    await gotoPage(page, caseId)
    await page.locator('.tb').getByRole('button', { name: 'Seitenoptionen' }).click()
    await page.getByRole('menuitem', { name: de('cmd.send'), exact: true }).click()
    // the page already sits in PA-1 (running): that one opens — "Neuer Auftrag" makes another
    const already = page.locator('.toast', { hasText: de('already', { id: 'PA-1', status: de('status.running') }) })
    await expect(already).toBeVisible()
    await already.getByRole('button', { name: de('send.fresh') }).click()
    await expect.poll(() => conn.planner.length, { timeout: 30_000 }).toBe(2)
    const row2 = (await wsEval(page, (s, [d, r]) => (Object.values(s.pages) as AnyState[]).find((p) => p.databaseId === d && p.id !== r && !p.trashed)!.id as string, [db, row] as const)) as string
    await expect.poll(() => statusKey(page, row2), { timeout: 30_000 }).toBe('ready')
    await page.keyboard.press('Escape')
    await gotoPage(page, row2)
    await expect(plate.getByTestId('order-auto-fallback')).toHaveText(de('auto.fallback', { reasons: de('auto.why.open.one') }))
    const rec2 = (await recordOf(page, row2))!
    expect(rec2.state).toBe('draft')
    expect(rec2.draft.auto.reasons).toEqual([{ why: 'open', n: 1 }])
    // the consent outlived the first chain making the Business analysis and QA projects from their templates
    const consent = await page.evaluate((d) => localStorage.getItem(`one.orders.auto:local:local:${d}`), db)
    expect(JSON.parse(consent ?? 'null')).toMatchObject({ sig: expect.any(String) })
    expect(consent).not.toContain('lapsed')
    await shot(page, 'b15-3-fallback', plate)

    // ── "Alle Ketten anhalten" on #/coding: the running chain halts (sticky)
    await page.evaluate(() => (window.location.hash = '#/coding'))
    await page.getByTestId('order-halt-all').first().click()
    await expect.poll(() => statusKey(page, row), { timeout: 10_000 }).toBe('halted')
    await expect.poll(async () => (await recordOf(page, row))?.state ?? null, { timeout: 10_000 }).toBe('halted')
    expect(conn.other).toEqual([])
  })
})
