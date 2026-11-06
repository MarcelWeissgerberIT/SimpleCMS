import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { miniMaxInference, MINIMAX_PRICE } from '../src/worker/minimax-inference.ts'
import { miniMaxStatus, minimaxFile, readMiniMax, saveMiniMax } from '../src/worker/minimax-config.ts'
import { runLocal } from '../src/worker/local-agent.ts'
import { InferenceLimit } from '../src/worker/local-inference.ts'
import { cleanupAll, tempDir, makeRepo, writeConfig, repoEntry, startWorker, WS_LOCAL, FakeTab, task } from './worker-helpers.ts'

after(cleanupAll)
const config = { apiKey: 'mini_demo_key_for_fixture_only', contextTokens: 131072, effort: 'high' as const }
const usage = { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 500 } }
const packet = (message: any, finish_reason = message.tool_calls?.length ? 'tool_calls' : 'stop') => ({ choices: [{ message, finish_reason }], usage })
const call = (id: string, name: string, args: object) => ({ role: 'assistant', content: '', reasoning_content: `Reasoning for ${id}`, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
const request = () => ({ model: 'ignored', messages: [{ role: 'user', content: 'Test' }], tools: [{ type: 'function', function: { name: 'write_file', parameters: {} } }], contextTokens: 131072, outputTokens: 16384, signal: new AbortController().signal })

test('MiniMax uses the shared harness: complete tool IDs, reasoning history, repairs, verified completion and cost', async () => {
  const root = tempDir('minimax-tools')
  writeFileSync(join(root, 'feature.txt'), 'BROKEN')
  const answers = [call('r1', 'read_file', { path: 'feature.txt' }), call('e1', 'edit_file', { path: 'feature.txt', old_text: 'BROKEN', new_text: 'FIXED' }), call('f1', 'finish_task', { status: 'completed', summary: 'Repaired feature.txt', next: '' })]
  const bodies: any[] = []
  const transport: typeof fetch = async (url, init) => {
    assert.equal(String(url), 'https://api.minimax.io/v1/chat/completions')
    assert.equal((init!.headers as any).Authorization, `Bearer ${config.apiKey}`)
    assert.equal(init!.redirect, 'error')
    const body = JSON.parse(String(init!.body))
    assert.equal(body.model, 'MiniMax-M3.1-Flash')
    assert.equal(body.reasoning_effort, 'high')
    assert.equal(body.max_completion_tokens, 16384)
    bodies.push(body)
    return Response.json(packet(answers.shift()))
  }
  let checks = 0
  const logs: string[] = []
  const result = await runLocal({ agent: 'minimax', cwd: root, prompt: 'Repair the feature.', readOnly: false, completionRequired: true, maxSteps: 8, taskMcp: null,
    signal: new AbortController().signal, log: l => logs.push(l.s), inference: miniMaxInference(config, 1, transport), model: 'MiniMax-M3.1-Flash', outputTokens: 16384,
    // An unrelated Ollama setting cannot redirect or break this provider.
    env: { ONE_CODER_OLLAMA: 'https://not-a-local-ollama.example' },
    verify: async () => { checks++; return { ok: readFileSync(join(root, 'feature.txt'), 'utf8') === 'FIXED', output: 'Verified feature.txt' } },
  })
  assert.equal(result.ok, true, result.error)
  assert.equal(checks, 1)
  assert.match(result.text, /checks passed/)
  assert.equal(bodies[1].messages.find((m: any) => m.role === 'tool').tool_call_id, 'r1')
  assert.equal(bodies[1].messages.find((m: any) => m.role === 'assistant').reasoning_content, 'Reasoning for r1')
  assert.ok(bodies.flatMap(b => b.messages).every(m => !('tool_name' in m)))
  const expected = 3 * ((500 * MINIMAX_PRICE.input + 500 * MINIMAX_PRICE.cached + 100 * MINIMAX_PRICE.output) / 1e6)
  assert.ok(Math.abs(result.cost! - expected) < 1e-9)
  assert.ok(!JSON.stringify([logs, bodies]).includes(config.apiKey))
})

test('truncated or malformed model replies execute no file mutation; usage is still accounted', async () => {
  for (const variant of ['length', 'duplicate', 'arguments', 'missing-usage', 'read-only']) {
    const root = tempDir('minimax-refuse')
    const message = call('w1', 'write_file', { path: 'must-not-exist.txt', content: 'bad' })
    if (variant === 'duplicate') message.tool_calls.push(message.tool_calls[0]!)
    if (variant === 'arguments') message.tool_calls[0]!.function.arguments = '{'
    const data: any = packet(message, variant === 'length' ? 'length' : 'tool_calls')
    if (variant === 'missing-usage') delete data.usage
    let sends = 0
    const result = await runLocal({ agent: 'minimax', cwd: root, prompt: 'Inspect.', readOnly: variant === 'read-only', maxSteps: 3, taskMcp: null, signal: new AbortController().signal, log: () => {},
      inference: miniMaxInference(config, 1, async () => { sends++; return Response.json(data) }),
    })
    assert.equal(result.ok, false, variant)
    assert.equal(existsSync(join(root, 'must-not-exist.txt')), false, variant)
    assert.equal(sends, 1, 'no automatic retry of a provider request')
    assert.ok(result.cost! > 0, variant)
  }
})

test('budgets stop requests; rejected keys disclose no provider body; abort reaches the transport', async () => {
  let sends = 0
  const tiny = miniMaxInference(config, 0.000001, async () => { sends++; throw new Error('must not send') })
  await assert.rejects(tiny(request()), InferenceLimit)
  assert.equal(sends, 0)
  assert.equal(tiny.cost!(), 0)
  const denied = miniMaxInference(config, 1, async () => new Response(config.apiKey, { status: 401 }))
  await assert.rejects(denied(request()), /rejected the API key/)
  assert.equal(denied.cost!(), 0)
  const malformed = miniMaxInference(config, 1, async () => new Response('unexpected-private-provider-text-' + config.apiKey))
  await assert.rejects(malformed(request()), /^Error: MiniMax returned invalid JSON\. No tool call was executed\.$/)
  const controller = new AbortController()
  const inference = miniMaxInference(config, 1, async (_url, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })
    controller.abort(new Error('Stopped by fixture'))
  }))
  await assert.rejects(inference({ ...request(), signal: controller.signal }), /Stopped by fixture/)
  assert.ok(inference.cost!() > 0, 'uncertain transport retains a conservative estimate')
})

test('worker credential settings keep secrets on disk, preserve a blank key and remove it explicitly', () => {
  const workerFile = join(tempDir('minimax-key'), 'worker.json')
  saveMiniMax(workerFile, { apiKey: config.apiKey, contextTokens: 1000000, effort: 'max' })
  if (process.platform !== 'win32') assert.equal(statSync(minimaxFile(workerFile)).mode & 0o777, 0o600)
  assert.equal(readMiniMax(workerFile, {}).apiKey, config.apiKey)
  assert.equal(readMiniMax(workerFile, { MINIMAX_API_KEY: 'environment_key_for_fixture' }).apiKey, 'environment_key_for_fixture')
  assert.ok(!JSON.stringify(miniMaxStatus(workerFile)).includes(config.apiKey))
  saveMiniMax(workerFile, { apiKey: '', contextTokens: 65536, effort: 'low' })
  assert.equal(readMiniMax(workerFile, {}).apiKey, config.apiKey)
  assert.equal(readMiniMax(workerFile, {}).contextTokens, 65536)
  assert.throws(() => saveMiniMax(workerFile, { apiKey: 'short', contextTokens: 65536, effort: 'low' }), /Invalid/)
  assert.throws(() => saveMiniMax(workerFile, { apiKey: config.apiKey, contextTokens: 1000, effort: 'low' }), /supported/)
  saveMiniMax(workerFile, { remove: true })
  assert.equal(existsSync(minimaxFile(workerFile)), false)
})


test('the built worker routes MiniMax through One task MCP, host checks and its own cost ledger without a CLI', async () => {
  const repo = makeRepo()
  const file = writeConfig(repo, { workspace: WS_LOCAL.id, port: 47394, pollSec: 2, name: 'minimax-test', repos: [repoEntry(repo)] })
  saveMiniMax(file, { apiKey: config.apiKey, contextTokens: 131072, effort: 'high' })
  const shim = join(tempDir('minimax-transport'), 'fetch.mjs')
  writeFileSync(shim, `const original = globalThis.fetch; let n = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url) !== 'https://api.minimax.io/v1/chat/completions') return original(url, init);
    const b = JSON.parse(init.body);
    const tools = [['one_task_read',{request:'read'}],['write_file',{path:'feature.txt',content:'Built worker MiniMax fixture.'}],['finish_task',{status:'completed',summary:'Implemented with One context.',next:''}]];
    const [name,args] = tools[n++];
    return Response.json({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:'',reasoning_content:'Use One tools.',tool_calls:[{id:'call-'+n,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}],usage:{prompt_tokens:1000,completion_tokens:100}});
  };`)
  const worker = await startWorker(file, { NODE_OPTIONS: '--import=' + pathToFileURL(shim).href, CODEX_BIN: 'missing-codex', CLAUDE_BIN: 'missing-claude' })
  let tab: FakeTab | null = null
  try {
    tab = await FakeTab.connect(47394); tab.hello(WS_LOCAL); await tab.next('welcome')
    const outcome = await tab.run({ ...task({ kind: 'implement' }, { id: 'minimax_agent' }), agent: 'minimax' })
    assert.equal(outcome.status, 'ok', JSON.stringify(outcome))
    assert.ok(outcome.cost! > 0)
    assert.ok(outcome.git?.files.some(f => f.path === 'feature.txt'))
    assert.match(outcome.summary ?? '', /checks passed/)
    assert.ok(!JSON.stringify(outcome).includes(config.apiKey))
  } finally { tab?.close(); await worker.stop() }
})
