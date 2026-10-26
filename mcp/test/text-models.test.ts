import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkTextRequest, textModels, textRequest } from '../src/worker/text-models.ts'
import { codexArgs } from '../src/worker/codex.ts'

test('plain inference rejects tool/URL/path injection and oversize requests', () => {
  const good = { provider: 'local', model: 'atlas-flow:latest', messages: [{ role: 'user', content: 'Summarize this text' }], maxTokens: 256 }
  assert.deepEqual(checkTextRequest(good), good)
  for (const patch of [{ url: 'https://evil.test' }, { tools: [{name:'run_shell'}] }, { model: '../secret' }, { maxTokens: 0 }, { maxTokens: 20000 }, { messages: [{ role: 'tool', content: 'x' }] }, { messages: [{ role: 'user', content: 'x'.repeat(180001) }] }]) assert.throws(() => checkTextRequest({ ...good, ...patch }))
})

test('cloud catalogue is request-only; selected model reaches Ollama Cloud, worker key never leaves that fixed host', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'one-text-model-test-'))
  const file = join(dir, 'worker.json')
  const original = globalThis.fetch
  const calls: Array<{ url: string; body?: any; auth: string | null }> = []
  await writeFile(join(dir, 'ollama-cloud.json'), JSON.stringify({ apiKey: 'dummy-worker-only-key', model: 'configured-model', contextTokens: 65536 }), { mode: 0o600 })
  globalThis.fetch = (async (url: any, init: any = {}) => {
    const address = String(url)
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ url: address, body, auth: new Headers(init.headers).get('Authorization') })
    if (address.endsWith('/api/tags')) return Response.json({ models: [{ name: address.startsWith('https:') ? 'another-cloud-model' : 'local-model:latest', capabilities: ['completion'] }] })
    if (address.endsWith('/api/show')) return Response.json({ capabilities: ['completion'] })
    if (address === 'https://ollama.com/v1/chat/completions') return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Cloud answer' } }], usage: { prompt_tokens: 200, completion_tokens: 20 } })
    throw new Error('Unexpected transport')
  }) as typeof fetch
  try {
    const models = await textModels(file)
    assert.ok(models.some(m => m.provider === 'ollama' && m.model === 'another-cloud-model'))
    assert.equal(calls.filter(c => c.body?.messages).length, 0)
    const result = await textRequest(file, { provider: 'ollama', model: 'another-cloud-model', messages: [{ role: 'user', content: 'Selected text only' }], maxTokens: 256 }, new AbortController().signal)
    assert.equal(result.text, 'Cloud answer'); assert.equal(result.usd, null)
    assert.equal(result.outputTokens, 20)
    const inference = calls.filter(c => c.body?.messages)
    assert.equal(inference.length, 1)
    assert.equal(inference[0]!.body.model, 'another-cloud-model')
    assert.equal(inference[0]!.auth, 'Bearer dummy-worker-only-key')
    assert.ok(calls.filter(c => c.auth).every(c => c.url === 'https://ollama.com/v1/chat/completions'))
  } finally { globalThis.fetch = original; await rm(dir, { recursive: true, force: true }) }
})

test('text-only Codex runs ephemeral, read-only, without MCP, shell, browser or app tools', () => {
  const args = codexArgs({ agent: 'codex', cwd: '/tmp', prompt: 'text', readOnly: true, textOnly: true, maxSteps: 1, signal: new AbortController().signal, taskMcp: null, log: () => {} })
  assert.ok(args.includes('--ignore-user-config')); assert.ok(args.includes('--ephemeral')); assert.ok(args.includes('read-only')); assert.ok(args.includes('mcp_servers={}'))
  for (const feature of ['shell_tool', 'unified_exec', 'view_image', 'browser_use', 'computer_use', 'apps']) assert.ok(args.some((a, i) => a === feature && args[i-1] === '--disable'))
})
