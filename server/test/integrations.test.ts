/**
 * Integration profiles on the team server (agents/integrations.ts, collab/admin-map.ts; docs/CLOUD.md § Meta document
 * schema → integrations, § Agents → Integration profiles): the meta document's `integrations` map is the owners' and
 * admins' (a member's write is put back, an admin's is stamped with the real writer); the server reads only id /
 * match.name / match.host / unlocks; a profile matches the runtime's MCP servers by name / host only (a tools-only
 * profile never matches here), and only then are upsert_rows and the state tools offered to server agents — the
 * prompt names only what is offered. Against a real server and the fake Messages API (never the real one); the MCP
 * servers are fictional addresses nobody calls.
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import * as Y from 'yjs'
import { globMatch, profileMatch, readProfiles, sanitizeProfile, serverUnlocks } from '../src/agents/integrations.ts'
import { toolsFor } from '../src/agents/tools.ts'
import { type FakeAnthropic, type FakeRequest, fakeAnthropic, say } from './fake-anthropic.ts'
import { type Client, type DocClient, flushed, openDoc, signIn, startServer, type TestServer, waitFor } from './helpers.ts'

const KEY = 'sk-ant-api03-TESTKEY-not-real-integrations-0123WXYZ'

const profile = (id: string, match: Record<string, unknown>, unlocks: string[], extra: Record<string, unknown> = {}) => ({ schema: 'one.integration/1', id, name: `Profile ${id}`, match, unlocks, ...extra })

function agentDef(id: string, name: string, extra: Record<string, unknown> = {}) {
  const at = Date.now()
  return { id, name, instructions: `Instructions of ${name}.`, trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: 'stage', output: null, mcpServers: [], runner: 'server', model: null, effort: null, maxRunUsd: 1, enabled: true, createdBy: null, createdAt: at, updatedAt: at, ...extra }
}

describe('integration profiles: the server reader and matching', () => {
  test('sanitizeProfile keeps id / name / host / unlocks; anything else is no profile', () => {
    assert.deepEqual(sanitizeProfile('tracker', profile('tracker', { name: 'Trac*', host: '*.Example.com', tools: ['list_items'] }, ['upsert', 'nope', 'agentState'])), {
      id: 'tracker',
      name: 'trac*',
      host: '*.example.com',
      unlocks: ['upsert', 'agentState'],
    })
    // the key must be the id, the schema must be right, the match must be an object
    assert.equal(sanitizeProfile('other', profile('tracker', { name: 'x' }, [])), null)
    assert.equal(sanitizeProfile('t', { ...profile('t', { name: 'x' }, []), schema: 'one.integration/2' }), null)
    assert.equal(sanitizeProfile('t', { ...profile('t', {}, []), match: 'tracker' }), null)
    assert.equal(sanitizeProfile('t', 'not an object'), null)
    // a glob with other characters, or only wildcards, is left out (the profile then has no server condition)
    assert.deepEqual(sanitizeProfile('t', profile('t', { name: 'a b', host: '**' }, ['upsert'])), { id: 't', unlocks: ['upsert'] })
  })

  test('globMatch: * and ?, case-insensitive, the whole text', () => {
    assert.equal(globMatch('trac*', 'tracker'), true)
    assert.equal(globMatch('*ker', 'TRACKER'), true)
    assert.equal(globMatch('tr?cker', 'tracker'), true)
    assert.equal(globMatch('tracker', 'tracker-2'), false)
    assert.equal(globMatch('*.example.com', 'api.example.com'), true)
    assert.equal(globMatch('*.example.com', 'example.com.evil.net'), false)
    assert.equal(globMatch('a*b*c', 'aXXbYYc'), true)
    assert.equal(globMatch('a*b*c', 'aXXbYY'), false)
  })

  test('profileMatch / serverUnlocks: name and host only — a tools-only profile never matches on the server', () => {
    const servers = [
      { name: 'tracker', url: 'https://tracker.example.com/mcp' },
      { name: 'wiki', url: 'https://wiki.example.org/mcp' },
    ]
    const byName = sanitizeProfile('a', profile('a', { name: 'track*' }, ['upsert']))!
    const byHost = sanitizeProfile('b', profile('b', { host: '*.example.org' }, ['agentState']))!
    const both = sanitizeProfile('c', profile('c', { name: 'wiki', host: '*.example.com' }, ['notify']))!
    const toolsOnly = sanitizeProfile('d', profile('d', { tools: ['list_items'] }, ['keys']))!
    assert.equal(profileMatch(byName, servers), 'tracker')
    assert.equal(profileMatch(byHost, servers), 'wiki')
    assert.equal(profileMatch(both, servers), null)
    assert.equal(profileMatch(toolsOnly, servers), null)
    assert.deepEqual([...serverUnlocks([byName, byHost, both, toolsOnly], servers)].sort(), ['agentState', 'upsert'])
    assert.deepEqual([...serverUnlocks([byName], [])], [])
  })

  test('toolsFor: upsert_rows and the state tools only while unlocked', () => {
    const names = (u?: { upsert: boolean; state: boolean }) => toolsFor('stage', u).map((t) => t.name)
    assert.deepEqual(names(), ['search_pages', 'read_page', 'list_databases', 'query_database', 'create_page', 'append_to_page', 'create_row', 'update_row', 'set_page_title'])
    assert.deepEqual(names({ upsert: true, state: false }).includes('upsert_rows'), true)
    assert.deepEqual(names({ upsert: false, state: true }).slice(-2), ['agent_state_get', 'agent_state_set'])
    assert.equal(toolsFor('none', { upsert: true, state: true }).some((t) => t.name === 'upsert_rows'), false)
  })

  test('readProfiles: the integrations map, broken entries ignored', () => {
    const doc = new Y.Doc()
    const map = doc.getMap<unknown>('integrations')
    map.set('ok', profile('ok', { name: 'tracker' }, ['upsert']))
    map.set('bad', { id: 'bad' })
    map.set('mismatch', profile('other', { name: 'x' }, []))
    assert.deepEqual(readProfiles(doc), [{ id: 'ok', name: 'tracker', unlocks: ['upsert'] }])
  })
})

describe('integration profiles on a running server', () => {
  let fake: FakeAnthropic
  let server: TestServer
  let ada: Client, bob: Client, cyd: Client
  let adaId: string, cydId: string
  let wsId: string
  let A: DocClient, B: DocClient, C: DocClient
  const open: DocClient[] = []

  const meta = async (client: Client) => {
    const d = openDoc(server, client, `ws:${wsId}`)
    open.push(d)
    await d.synced
    return d
  }
  const entry = (d: DocClient, id: string) => d.doc.getMap('integrations').get(id) as Record<string, unknown> | undefined
  const write = async (d: DocClient, id: string, value: Record<string, unknown> | null) => {
    const m = d.doc.getMap('integrations')
    if (value === null) m.delete(id)
    else m.set(id, value)
    await flushed(d)
  }
  const runs = async (agentId: string) => (await ada.get(`/api/workspaces/${wsId}/agent-runs?agentId=${agentId}&limit=50`)).body as any[]
  async function run(agentId: string, script: string): Promise<FakeRequest> {
    const before = fake.of(script).length
    const started = await ada.post(`/api/workspaces/${wsId}/agents/${agentId}/run`)
    assert.equal(started.status, 202, JSON.stringify(started.body))
    await waitFor(async () => (await runs(agentId)).some((r) => r.id === started.body.runId && r.status !== 'running'), 20_000, `run of ${agentId}`)
    const reqs = fake.of(script)
    assert.ok(reqs.length > before, 'a request reached the fake API')
    return reqs[before]!
  }
  const toolNames = (req: FakeRequest) => (req.body.tools as any[]).filter((t) => t.name).map((t) => t.name as string)

  before(async () => {
    fake = await fakeAnthropic()
    server = await startServer({ ANTHROPIC_BASE_URL: fake.url, AGENT_TICK_MS: '300', API_RATE_LIMIT: '1000' })
    ada = await signIn(server, 'ada@integrations.test')
    bob = await signIn(server, 'bob@integrations.test')
    cyd = await signIn(server, 'cyd@integrations.test')
    adaId = (await ada.get('/api/me')).body.user.id
    cydId = (await cyd.get('/api/me')).body.user.id
    wsId = (await ada.post('/api/workspaces', { name: 'Profiles Co' })).body.id
    for (const client of [bob, cyd]) {
      const invite = await ada.post(`/api/workspaces/${wsId}/invites`, { role: 'member' })
      assert.equal((await client.post(`/api/invites/${invite.body.link.split('#/invite/')[1]}/accept`)).status, 200)
    }
    assert.equal((await ada.patch(`/api/workspaces/${wsId}/members/${cydId}`, { role: 'admin' })).status, 200)
    ;[A, B, C] = await Promise.all([meta(ada), meta(bob), meta(cyd)])
    A.doc.getMap('agents').set('ag-mirror', agentDef('ag-mirror', 'Mirror agent'))
    await flushed(A)
    const put = await ada.json('PUT', `/api/workspaces/${wsId}/agent-runtime`, { claudeKey: KEY, mcpServers: [{ name: 'tracker', url: 'https://tracker.example.com/mcp' }], enabled: true })
    assert.equal(put.status, 200, JSON.stringify(put.body))
  })

  after(async () => {
    for (const d of open) d.destroy()
    await server.stop()
    await fake.close()
  })

  test('a member cannot add, change or remove a profile; the owner and an admin can (stamped with the real writer)', async () => {
    // a member's new profile is taken away again
    await write(B, 'sneaky', profile('sneaky', { name: '*' }, ['upsert']))
    await waitFor(() => entry(B, 'sneaky') === undefined && entry(A, 'sneaky') === undefined, 5000, 'member add put back')
    // the owner's: kept, updatedBy = the owner, whatever was claimed
    await write(A, 'tracker', profile('tracker', { tools: ['list_items'] }, ['upsert'], { updatedBy: 'someone-else' }))
    await waitFor(() => entry(B, 'tracker')?.updatedBy === adaId, 5000, 'owner stamped')
    // a member changes it: put back; removes it: back again
    await write(B, 'tracker', profile('tracker', { name: '*' }, ['upsert', 'agentState']))
    await waitFor(() => (entry(B, 'tracker')?.match as any)?.tools?.[0] === 'list_items', 5000, 'member change put back')
    await write(B, 'tracker', null)
    await waitFor(() => !!entry(B, 'tracker') && !!entry(A, 'tracker'), 5000, 'member removal put back')
    // an admin may
    await write(C, 'docs', profile('docs', { host: '*.example.org' }, ['agentState']))
    await waitFor(() => entry(A, 'docs')?.updatedBy === cydId, 5000, 'admin stamped')
    await write(C, 'docs', null)
    await waitFor(() => entry(A, 'docs') === undefined && entry(B, 'docs') === undefined, 5000, 'admin removal kept')
    assert.match(server.logs(), /integration profile change put back/)
  })

  test('server agents get upsert_rows and the state tools only from a profile that matches a runtime server by name / host', async () => {
    fake.script('Mirror agent', () => say('Nothing new.'))
    // only a tools-only profile (from the first test): nothing is unlocked on the server
    const r1 = await run('ag-mirror', 'Mirror agent')
    assert.equal(toolNames(r1).includes('upsert_rows'), false)
    assert.equal(toolNames(r1).includes('agent_state_get'), false)
    assert.doesNotMatch(r1.body.system, /upsert_rows/)
    assert.doesNotMatch(r1.body.system, /agent_state_get/)
    assert.match(r1.body.system, /A database's key \(list_databases marks it\) is unique per row/)

    // by name: upsert_rows
    await write(A, 'by-name', profile('by-name', { name: 'track*' }, ['upsert']))
    const r2 = await run('ag-mirror', 'Mirror agent')
    assert.equal(toolNames(r2).includes('upsert_rows'), true)
    assert.equal(toolNames(r2).includes('agent_state_get'), false)
    assert.match(r2.body.system, /use upsert_rows/)

    // by host: the state tools too
    await write(A, 'by-host', profile('by-host', { host: '*.example.com' }, ['agentState']))
    const r3 = await run('ag-mirror', 'Mirror agent')
    assert.deepEqual(toolNames(r3).slice(-2), ['agent_state_get', 'agent_state_set'])
    assert.match(r3.body.system, /agent_state_get \/ agent_state_set keep a small JSON state/)

    // a host that does not match unlocks nothing; removing the profiles locks them again
    await write(A, 'by-name', null)
    await write(A, 'by-host', profile('by-host', { host: '*.example.net' }, ['agentState', 'upsert']))
    const r4 = await run('ag-mirror', 'Mirror agent')
    assert.equal(toolNames(r4).some((n) => n === 'upsert_rows' || n.startsWith('agent_state')), false)
  })
})
