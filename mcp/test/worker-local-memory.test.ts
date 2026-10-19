import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { LocalMemory, LocalProgress, localContext } from '../src/worker/local-memory.ts'
import { runLocal } from '../src/worker/local-agent.ts'
import { cleanupAll, tempDir } from './worker-helpers.ts'
import type { LocalInference, LocalInferenceRequest } from '../src/worker/local-inference.ts'
import { MemoryOAuth, memoryOAuthFetch } from '../src/worker/local-memory-oauth.ts'

after(cleanupAll)
const call = (name: string, args: object) => ({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name, arguments: args } }] } })
const final = { message: { role: 'assistant', content: 'Completed.' } }
const options = (root: string, inference: LocalInference) => ({ agent: 'local' as const, cwd: root, prompt: 'Implement the requested feature.', readOnly: false, maxSteps: 30, signal: new AbortController().signal, taskMcp: null, log: () => {}, env: {}, inference })

test('private task snapshots survive resume, isolate scopes and redact before persistence/retrieval', async () => {
  const directory = tempDir('task-memory')
  const opts = { directory, scope: 'workspace/repo/task/stage', resume: false }
  const clean = (s: string) => s.replaceAll('private-secret-value', '<secret>')
  const m = new LocalMemory(clean)
  await m.load(opts)
  m.setCheckpoint({ plan: 'Repair A', decisions: 'Keep B', remaining: 'Verify C', next: 'Read D' })
  const entry = m.remember('read_file:feature.ts', 'Source and private-secret-value')
  m.beginOperation('mcp_call_tool', { z: 1, a: 2 })
  m.finishOperation('mcp_call_tool', { a: 2, z: 1 }, 'remote receipt')
  m.addAtlasRef(123)
  await m.flush(opts)
  const file = join(directory, (await readdir(directory)).find(p => p.endsWith('.json'))!)
  assert.ok(!(await readFile(file, 'utf8')).includes('private-secret-value'))
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600)
  const resumed = new LocalMemory(clean)
  await resumed.load({ ...opts, resume: true })
  assert.match(resumed.summary(), /Read D/)
  assert.match(resumed.recall(entry.id).text, /<secret>/)
  assert.equal(resumed.search('feature')[0]?.id, entry.id)
  assert.equal(resumed.operation('mcp_call_tool', { a: 2, z: 1 })?.state, 'done')
  assert.deepEqual(resumed.atlasRefs(), [123])
  const other = new LocalMemory(clean)
  await other.load({ ...opts, scope: 'different-task', resume: true })
  assert.equal(other.search('').length, 0)
  assert.throws(() => other.recall(entry.id))
})

test('bounded Unicode snapshots remain readable and corrupt snapshots are preserved for repair', async () => {
  const opts = { directory: tempDir('memory-unicode'), scope: 'task', resume: true }
  const m = new LocalMemory(s => s)
  await m.load(opts)
  for (let i = 0; i < 110; i++) m.remember(`source-${i}`, '🧪'.repeat(7000))
  await m.flush(opts)
  const file = join(opts.directory, (await readdir(opts.directory)).find(p => p.endsWith('.json'))!)
  assert.ok((await stat(file)).size < 1_600_000)
  const next = new LocalMemory(s => s)
  await next.load(opts)
  assert.ok(next.search('source').length)
  await writeFile(file, '{broken')
  const corrupt = new LocalMemory(s => s)
  await assert.rejects(corrupt.load(opts))
  await corrupt.flush(opts)
  assert.equal(await readFile(file, 'utf8'), '{broken')
})

test('context compaction retains checkpoint and addressable source, but revokes stale edit permission', async () => {
  const root = tempDir('memory-compaction')
  const data = Array.from({ length: 70 }, (_, i) => `line-${i} ` + 'x'.repeat(220)).join('\n')
  for (const name of ['a', 'b', 'c', 'd']) await writeFile(join(root, name + '.txt'), data)
  let index = 0
  const requests: any[] = []
  let recalled = false
  const inference: LocalInference = async request => {
    requests.push(structuredClone(request.messages))
    const step = index++
    if (step === 0) return call('memory_checkpoint', { decisions: 'Preserve API', remaining: 'Patch a.txt', next: 'Read exact lines' })
    if (step <= 4) return call('read_file', { path: ['a', 'b', 'c', 'd'][step - 1] + '.txt' })
    if (step === 5) return call('edit_file', { path: 'a.txt', old_text: 'line-0 ', new_text: 'changed ' })
    if (step === 6) return call('memory_search', { query: 'read_file:a.txt' })
    if (step === 7) {
      const output = String(request.messages.at(-1)?.content)
      const id = output.match(/"id":"([a-f0-9]{20})"/)?.[1]
      assert.ok(id, output)
      return call('memory_recall', { id })
    }
    if (step === 8) { recalled = request.messages.at(-1)?.content.includes('line-0'); return final }
    return final
  }
  const result = await runLocal(options(root, inference))
  assert.equal(result.ok, true, result.error)
  assert.ok(requests.some(ms => ms.some((m: any) => m.content?.includes('Earlier tool history is archived'))))
  assert.ok(requests.some(ms => ms.some((m: any) => m.content?.includes('Preserve API'))))
  assert.ok(requests.some(ms => ms.some((m: any) => m.content?.includes('Read the current target lines'))))
  assert.equal(recalled, true)
  assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), data)
})

test('repeated failing tools stop with useful partial state before the global budget', async () => {
  const root = tempDir('memory-stall')
  let requests = 0
  const result = await runLocal(options(root, async () => { requests++; return call('read_file', { path: 'missing.ts' }) }))
  assert.equal(result.limited, true)
  assert.ok(requests <= 6)
  assert.match(result.error!, /No useful progress/)
  assert.match(result.text, /read_file:missing.ts/)
})

test('model changes retain the same host memory; Continue restores notes but fresh starts do not', async () => {
  const root = tempDir('memory-model-swap')
  const memory = { directory: join(root, 'private'), scope: 'same-task', resume: false }
  let first = true
  const one = await runLocal({ ...options(root, async () => first ? (first = false, call('memory_checkpoint', { decisions: 'Keep API', remaining: 'Run acceptance checks', next: 'Read feature.ts' })) : final), env: { ONE_CODER_MODEL: 'model-a' }, memory })
  assert.equal(one.ok, true, one.error)
  for (const resume of [true, false]) {
    let seen = false
    const result = await runLocal({ ...options(root, async request => { seen = JSON.stringify(request.messages).includes('Read feature.ts'); assert.equal(request.model, 'model-b'); return final }), env: { ONE_CODER_MODEL: 'model-b' }, memory: { ...memory, resume } })
    assert.equal(result.ok, true, result.error)
    assert.equal(seen, resume)
  }
})

test('context profiles are explicit and model-supplied truncation cannot execute writes', async () => {
  assert.equal(localContext({ ONE_CODER_CONTEXT: '65536' }).tokens, 65536)
  assert.throws(() => localContext({ ONE_CODER_CONTEXT: '999999' }))
  const root = tempDir('memory-token-guard')
  const result = await runLocal({ ...options(root, async (request: LocalInferenceRequest) => {
    assert.equal(request.contextTokens, 65536)
    return { ...call('write_file', { path: 'forbidden', content: 'no' }), inputTokens: 65000 }
  }), env: { ONE_CODER_CONTEXT: '65536' } })
  assert.equal(result.limited, true)
  await assert.rejects(stat(join(root, 'forbidden')))
  const p = new LocalProgress()
  for (let i = 0; i < 5; i++) p.record('same', {}, 'same', false)
  assert.equal(p.state(), 'stop')
})

test('OAuth credentials stay in a private owner file, require explicit sign-in and reject cross-origin fetches', async () => {
  const file = join(tempDir('memory-oauth'), 'credentials.json')
  const provider = new MemoryOAuth(file)
  await provider.load()
  provider.setRedirect('http://127.0.0.1:1234/callback')
  provider.saveCodeVerifier('one-session-verifier')
  assert.equal(provider.codeVerifier(), 'one-session-verifier')
  assert.throws(() => provider.redirectToAuthorization(new URL('https://atlas.example/authorize')), /Reconnect/)
  await provider.saveTokens({ access_token: 'private-access-token', refresh_token: 'private-refresh-token', token_type: 'Bearer' })
  const restored = new MemoryOAuth(file)
  await restored.load()
  assert.equal(restored.tokens()?.access_token, 'private-access-token')
  assert.deepEqual(restored.secrets(), ['private-access-token', 'private-refresh-token'])
  assert.equal(restored.redirectUrl, 'http://127.0.0.1:1234/callback')
  assert.throws(() => restored.codeVerifier())
  assert.notEqual(restored.state(), provider.state())
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600)
  assert.throws(() => memoryOAuthFetch('https://atlas.example')('https://elsewhere.example/token'))
  await restored.invalidateCredentials('tokens')
  assert.equal(restored.tokens(), undefined)
})
