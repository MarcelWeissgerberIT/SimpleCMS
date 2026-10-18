/**
 * A mock MCP server for the Outbox's tests (written in slice 1b so the shapes are fixed early; slice 2's worker specs
 * and mcp/test use it): the real SDK `McpServer` over Streamable HTTP on 127.0.0.1:<random>. Fictional data only.
 *
 * Tools (input schemas; readOnlyHint on the reads): get_item · list_comments (read) · add_comment · update_item ·
 * log_work (write). Every call is recorded as { tool, args, authSha256, session } — the token itself never.
 * State: a small record per key { ref, title, status, comments[] }.
 *
 * Control endpoints (plain HTTP on the same port):
 *   GET  /__calls                      the recorded calls
 *   POST /__reset                      fresh state, no calls, no faults
 *   POST /__mutate  {ref, body, by}    a foreign comment arrives
 *   POST /__delay?tool=&ms=            that tool answers late
 *   POST /__error?tool=                that tool answers isError
 *   POST /__drop?tool=                 that tool runs, then the response is cut
 *   POST /__elicit                     the next tool call first asks the client to elicit (it must refuse)
 *
 *   const mock = await startMockMcp()   → { url, port, calls(), state, reset(), close() }
 */
import http from 'node:http'
import { createHash, randomUUID } from 'node:crypto'

const SDK = (p) => new URL(`../../mcp/node_modules/${p}`, import.meta.url).href
const { McpServer } = await import(SDK('@modelcontextprotocol/sdk/dist/esm/server/mcp.js'))
const { StreamableHTTPServerTransport } = await import(SDK('@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.js'))
const { z } = await import(SDK('zod/index.js'))

/** The fictional records the tests start from. */
export function freshState() {
  const item = (ref, title, status, comments) => ({ ref, title, status, comments })
  return {
    next: 88213,
    items: {
      10668: item('10668', 'Weber: which baseline for the release state?', 'In Development', [
        { id: '88200', body: 'For the comparison: B6 or B7? Please confirm briefly.', by: 'J. Weber', at: '2026-10-09T16:42:00Z', kind: 'comment' },
      ]),
      10642: item('10642', 'Export filter drops umlauts in the CSV', 'In Development', [{ id: '88190', body: 'Can you confirm the fix is in?', by: 'A. Krüger', at: '2026-10-08T11:05:00Z', kind: 'comment' }]),
      10681: item('10681', 'Comment on the rollout plan for plant south', 'Review', [{ id: '88201', body: 'Plan is in the share: teilen.example/rp — please approve it there.', by: 'T. Brandt', at: '2026-10-09T18:27:00Z', kind: 'comment' }]),
      // the support case the work orders' acceptance reads through the person's own server "wissensbasis" (orders-acceptance.spec)
      4711: item('4711', 'Supportfall 4711 (Nordlicht): Login bricht nach 30 s ab', 'Offen', [
        { id: '88202', body: 'Tessera meldet: nach 30 Sekunden ist die Anmeldung weg, die Eingaben sind verloren. Vermutlich das Session-Timeout im Gateway (30 s).', by: 'Mara Lind', at: '2026-10-12T09:14:00Z', kind: 'comment' },
      ]),
    },
  }
}

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : undefined)
      } catch {
        resolve(undefined)
      }
    })
  })

export async function startMockMcp({ port = 0 } = {}) {
  let state = freshState()
  let calls = []
  let faults = { delay: {}, error: {}, drop: {}, elicit: false }
  const sessions = new Map()

  const sha = (h) => {
    const m = /^Bearer\s+(.+)$/i.exec(String(h ?? ''))
    return m ? createHash('sha256').update(m[1]).digest('hex') : null
  }
  const text = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }], structuredContent: v })

  function makeServer(sessionOf) {
    const server = new McpServer({ name: 'tracker-mock', version: '1.0.0' }, { capabilities: { tools: {} } })
    const run = (tool, fn) => async (args, extra) => {
      const hit = { tool, args, authSha256: sha(extra?.requestInfo?.headers?.authorization), session: sessionOf() ?? null }
      calls.push(hit)
      if (faults.elicit) {
        faults.elicit = false
        try {
          await server.server.elicitInput({ message: 'Please confirm', requestedSchema: { type: 'object', properties: { ok: { type: 'boolean' } } } })
          hit.elicit = 'answered'
        } catch {
          hit.elicit = 'refused'
        }
      }
      const ms = faults.delay[tool]
      if (ms) await new Promise((r) => setTimeout(r, ms))
      if (faults.error[tool]) return { isError: true, content: [{ type: 'text', text: `${tool} failed (mock)` }] }
      const out = fn(args)
      if (faults.drop[tool]) hit.dropped = true
      return out
    }
    const item = (ref) => state.items[ref] ?? null
    server.registerTool('get_item', { description: 'Read an item (fictional tracker).', inputSchema: { ref: z.string() }, annotations: { readOnlyHint: true } }, run('get_item', ({ ref }) => {
      const it = item(ref)
      return it ? text(it) : { isError: true, content: [{ type: 'text', text: 'no such item' }] }
    }))
    server.registerTool('list_comments', { description: 'List the comments of an item.', inputSchema: { ref: z.string() }, annotations: { readOnlyHint: true } }, run('list_comments', ({ ref }) => text({ items: item(ref)?.comments ?? [] })))
    server.registerTool('add_comment', { description: 'Add a comment to an item.', inputSchema: { ref: z.string(), body: z.string(), visibility: z.string().optional() }, annotations: { readOnlyHint: false, destructiveHint: false } }, run('add_comment', ({ ref, body }) => {
      const it = item(ref)
      if (!it) return { isError: true, content: [{ type: 'text', text: 'no such item' }] }
      const c = { id: String(state.next++), body, by: 'me', at: new Date().toISOString(), kind: 'comment' }
      it.comments.push(c)
      return text({ id: c.id })
    }))
    server.registerTool('update_item', { description: 'Change an item.', inputSchema: { ref: z.string(), status: z.string() }, annotations: { readOnlyHint: false, destructiveHint: true } }, run('update_item', ({ ref, status }) => {
      const it = item(ref)
      if (!it) return { isError: true, content: [{ type: 'text', text: 'no such item' }] }
      it.status = status
      return text({ ref, status })
    }))
    server.registerTool('log_work', { description: 'Book time on an item.', inputSchema: { ref: z.string(), minutes: z.number() }, annotations: { readOnlyHint: false } }, run('log_work', ({ ref, minutes }) => {
      const it = item(ref)
      if (!it) return { isError: true, content: [{ type: 'text', text: 'no such item' }] }
      const c = { id: String(state.next++), body: `${minutes} min`, by: 'me', at: new Date().toISOString(), kind: 'work', minutes }
      it.comments.push(c)
      return text({ id: c.id })
    }))
    return server
  }

  async function handleMcp(req, res, body) {
    const sid = req.headers['mcp-session-id']
    let transport = sid ? sessions.get(sid) : undefined
    if (!transport) {
      if (sid || body?.method !== 'initialize') return json(res, 400, { jsonrpc: '2.0', error: { code: -32000, message: 'No session' }, id: null })
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), onsessioninitialized: (id) => sessions.set(id, transport) })
      const server = makeServer(() => transport.sessionId)
      await server.connect(transport)
    }
    // a dropped response: the tool runs, the socket closes before the answer
    const tool = body?.method === 'tools/call' ? body?.params?.name : null
    if (tool && faults.drop[tool]) {
      res.end = () => {
        req.socket.destroy()
        return res
      }
      res.write = () => true
    }
    await transport.handleRequest(req, res, body)
  }

  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    try {
      if (url.pathname === '/__calls') return json(res, 200, calls)
      if (url.pathname === '/__reset') {
        state = freshState()
        calls = []
        faults = { delay: {}, error: {}, drop: {}, elicit: false }
        return json(res, 200, { ok: true })
      }
      if (url.pathname === '/__mutate') {
        const b = (await readBody(req)) ?? {}
        const it = state.items[b.ref]
        if (!it) return json(res, 404, { error: 'no such item' })
        it.comments.push({ id: String(state.next++), body: String(b.body ?? ''), by: String(b.by ?? 'someone'), at: new Date().toISOString(), kind: 'comment' })
        return json(res, 200, it)
      }
      if (url.pathname === '/__delay') {
        faults.delay[url.searchParams.get('tool') ?? ''] = Number(url.searchParams.get('ms') ?? 0)
        return json(res, 200, { ok: true })
      }
      if (url.pathname === '/__error') {
        faults.error[url.searchParams.get('tool') ?? ''] = true
        return json(res, 200, { ok: true })
      }
      if (url.pathname === '/__drop') {
        faults.drop[url.searchParams.get('tool') ?? ''] = true
        return json(res, 200, { ok: true })
      }
      if (url.pathname === '/__elicit') {
        faults.elicit = true
        return json(res, 200, { ok: true })
      }
      if (url.pathname === '/mcp') {
        if (req.method === 'DELETE' || req.method === 'GET') {
          const t = sessions.get(String(req.headers['mcp-session-id'] ?? ''))
          if (!t) return json(res, 400, { error: 'no session' })
          return t.handleRequest(req, res)
        }
        return handleMcp(req, res, await readBody(req))
      }
      json(res, 404, { error: 'not found' })
    } catch (e) {
      if (!res.headersSent) json(res, 500, { error: String(e?.message ?? e) })
    }
  })
  await new Promise((r) => srv.listen(port, '127.0.0.1', r))
  const actual = srv.address().port
  return {
    port: actual,
    url: `http://127.0.0.1:${actual}/mcp`,
    calls: () => calls,
    get state() {
      return state
    },
    reset: () => {
      state = freshState()
      calls = []
      faults = { delay: {}, error: {}, drop: {}, elicit: false }
    },
    close: () =>
      new Promise((r) => {
        for (const t of sessions.values()) void t.close?.()
        srv.closeAllConnections?.()
        srv.close(() => r())
      }),
  }
}
