/**
 * The Outbox in e2e specs (features/outbox): a fictional mirror ("CNSX Handoff") of the fictional MCP server "tracker"
 * (tracker.example.com) with a key property, the mirror roles (link, source status, owner, comments, last comment, its
 * time, waiting on me) and an "Only by hand" field, its mirror agent (marked `mirrorOf`) and the tracker profile with
 * send routes — plus a mocked Claude API that answers drafts (structured output) and records every request body.
 * Never a real host: api.anthropic.com is routed, tracker.example.com is never called (popups are aborted).
 */
import type { BrowserContext, Page } from '@playwright/test'
import { wsEval } from '../fixtures'
import { REPLY_ROUTE, TRACKER_SERVER_OUTBOX, WORK_ROUTE, trackerSendsProfile } from './integrations'

export type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export const STATUS_ROUTE = {
  id: 'status',
  role: 'status',
  label: { en: 'Set status', de: 'Status setzen' },
  tool: 'update_item',
  args: { ref: '{key}', status: '{status}' },
  params: [{ name: 'status', type: 'option', values: ['In Development', 'Ready for ICM Integration', 'Done'] }],
  confirm: { tool: 'get_item', args: { ref: '{key}' }, match: [{ path: 'status', equals: '{status}' }] },
}

export interface Row {
  key: string
  title: string
  owner: string
  comments: number
  last: string
  at: string
  waiting?: boolean
}

export const ROWS: Row[] = [
  { key: '10668', title: 'Weber: which baseline for the release state?', owner: 'J. Weber', comments: 7, last: 'For the comparison: B6 or B7? Please confirm briefly.', at: '2026-10-09T16:42' },
  { key: '10642', title: 'Export filter drops umlauts in the CSV', owner: 'A. Krüger', comments: 4, last: 'Can you confirm the fix is in?', at: '2026-10-08T11:05' },
  { key: '10655', title: 'ICM interface v3: acceptance', owner: 'S. Okafor', comments: 2, last: 'Logs attached. If green, please move it on.', at: '2026-10-09T14:10' },
  { key: '10681', title: 'Comment on the rollout plan for plant south', owner: 'T. Brandt', comments: 5, last: 'Plan is in the share: teilen.example/rp — please approve it there.', at: '2026-10-09T18:27' },
  { key: '10679', title: 'Gateway: lower the log level in production', owner: 'M. Ilić', comments: 3, last: '@Marcel a quick take on the risk?', at: '2026-10-07T09:31' },
]

export interface Mirror {
  dbId: string
  rows: Record<string, string>
  props: Record<string, string>
  agentId: string
}

/** Settings (key, the tracker server), the profile, the mirror database, its agent. */
export async function seedMirrorDb(page: Page, opts: { routes?: AnyState[]; rows?: Row[]; profile?: AnyState } = {}): Promise<Mirror> {
  const routes = opts.routes ?? [REPLY_ROUTE, WORK_ROUTE, STATUS_ROUTE]
  return wsEval(
    page,
    (s, a) => {
      s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', mcpServers: [a.server] })
      s.upsertIntegration(a.profile)
      const id = () => Math.random().toString(36).slice(2, 12)
      const opt = (name: string) => ({ id: id(), name, color: 'gray' })
      const st = [opt('In Development'), opt('Ready for ICM Integration')]
      const props: Record<string, AnyState> = {
        title: { id: id(), name: 'Name', type: 'title' },
        key: { id: id(), name: 'Key', type: 'text', key: true },
        link: { id: id(), name: 'Link', type: 'url' },
        srcStatus: { id: id(), name: 'Source status', type: 'select', options: st },
        owner: { id: id(), name: 'Owner', type: 'text' },
        comments: { id: id(), name: 'Comments', type: 'number', numberFormat: 'number' },
        lastComment: { id: id(), name: 'Last comment', type: 'text' },
        lastCommentAt: { id: id(), name: 'Last comment at', type: 'date' },
        waiting: { id: id(), name: 'Waiting on me', type: 'checkbox' },
        myStatus: { id: id(), name: 'My status', type: 'select', options: [opt('Next')], agentReadOnly: true },
      }
      const dbId = s.createDatabase({ title: 'CNSX Handoff', properties: Object.values(props) })
      const rows: Record<string, string> = {}
      for (const r of a.rows) {
        const p: Record<string, unknown> = {}
        p[props.key.id] = r.key
        p[props.link.id] = `https://tracker.example.com/item/${r.key}`
        p[props.srcStatus.id] = st[0].id
        p[props.owner.id] = r.owner
        p[props.comments.id] = r.comments
        p[props.lastComment.id] = r.last
        p[props.lastCommentAt.id] = { start: r.at }
        p[props.waiting.id] = r.waiting !== false
        rows[r.key] = s.createRow(dbId, { title: r.title, properties: p })
      }
      const now = Date.now()
      s.upsertAgent({ id: 'mirror1', name: 'CNSX mirror', icon: null, instructions: 'Keep CNSX Handoff in step with the tracker.', trigger: { type: 'manual' }, scope: { everything: false, pages: [], databases: [dbId] }, write: 'stage', output: null, mcpServers: ['tracker'], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: true, createdAt: now, updatedAt: now, mirrorOf: dbId })
      return { dbId, rows, props: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v.id as string])), agentId: 'mirror1' }
    },
    { server: TRACKER_SERVER_OUTBOX, profile: opts.profile ?? trackerSendsProfile({}, routes), rows: opts.rows ?? ROWS },
  )
}

/** The page's Outbox test hook (?e2e). */
export const outbox = <R>(page: Page, fn: (o: AnyState, arg: AnyState) => R | Promise<R>, arg: AnyState = {}): Promise<R> =>
  page.evaluate(
    async ({ src, arg }) => {
      const o = (window as unknown as { __oneOutbox: AnyState }).__oneOutbox
      await o.useOutbox.getState()
      return new Function('o', 'arg', `return (${src})(o, arg)`)(o, arg)
    },
    { src: fn.toString(), arg },
  )

/** Wait until this tab's slips are loaded (startOutbox). */
export const outboxLoaded = (page: Page) => page.waitForFunction(() => (window as unknown as { __oneOutbox?: AnyState }).__oneOutbox?.useOutbox.getState().loaded === true)

/** A route's ref by id. */
export const routeRef = (routeId: string) => ({ profileId: 'tracker-out', routeId })

export interface ClaudeCall {
  body: AnyState
}

/**
 * api.anthropic.com → a structured answer `{"text": <draft>}` for every message request (`draft(body)` decides the
 * text), recorded. Streams (other features) get a short text.
 */
export async function mockDrafts(ctx: BrowserContext | Page, draft: (body: AnyState, n: number) => string): Promise<ClaudeCall[]> {
  const calls: ClaudeCall[] = []
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (req.method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [], has_more: false, first_id: null, last_id: null }) })
    const body = JSON.parse(req.postData() ?? '{}')
    calls.push({ body })
    const text = draft(body, calls.length)
    try {
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({ id: `msg_${calls.length}`, type: 'message', role: 'assistant', model: body.model ?? 'e2e-mock', content: [{ type: 'text', text: JSON.stringify({ text }) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 2000, output_tokens: 400 } }),
      })
    } catch {
      /* aborted */
    }
  })
  return calls
}

/** The tracker's item pages never load (a popup from "Copy & open" is captured and aborted); the addresses asked for. */
export async function blockTracker(ctx: BrowserContext): Promise<string[]> {
  const urls: string[] = []
  await ctx.route('https://tracker.example.com/**', (route) => {
    urls.push(route.request().url())
    return route.abort()
  })
  return urls
}

/** The row's stored value of a property. */
export const rowValue = (page: Page, rowId: string, propId: string) => wsEval(page, (s, a) => s.pages[a.rowId]?.properties[a.propId] ?? null, { rowId, propId })

/** A mirror run in short: the row's source fields move on (comments, last comment, its time). */
export const mirrorWrite = (page: Page, m: Mirror, key: string, v: { comments: number; last: string; at: string }) =>
  wsEval(
    page,
    (s, a) => {
      s.setRowProperty(a.row, a.p.comments, a.v.comments)
      s.setRowProperty(a.row, a.p.lastComment, a.v.last)
      s.setRowProperty(a.row, a.p.lastCommentAt, { start: a.v.at })
    },
    { row: m.rows[key], p: m.props, v },
  )

/** Versions of a page in this browser's history store (reason / by). */
export const versionsOf = (page: Page, pageId: string) =>
  page.evaluate(
    (id) =>
      new Promise<Array<{ reason: string; by?: string }>>((resolve, reject) => {
        const r = indexedDB.open('one-history')
        r.onerror = () => reject(r.error)
        r.onsuccess = () => {
          const db = r.result
          if (!db.objectStoreNames.contains('snapshots')) return resolve([])
          const q = db.transaction('snapshots').objectStore('snapshots').get(`idx:${id}`)
          q.onsuccess = () => {
            db.close()
            resolve(((q.result as Array<{ reason: string; by?: string }>) ?? []).map((m) => ({ reason: m.reason, ...(m.by ? { by: m.by } : {}) })))
          }
          q.onerror = () => reject(q.error)
        }
      }),
    pageId,
  )
