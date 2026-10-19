import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { mkdirSync, readFileSync, existsSync, symlinkSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { localPath, runLocal } from '../src/worker/local-agent.ts'
import { cleanupAll, makeRepo, repoEntry, startWorker, writeConfig, WS_LOCAL, FakeTab, task, tempDir } from './worker-helpers.ts'

after(cleanupAll)
const mockOllama = async (readOnly = false) => {
  const bodies: any[] = []
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c
    const body = JSON.parse(raw); bodies.push(body)
    const count = body.messages.filter((m: any) => m.role === 'tool').length
    const call = (name: string, args: object) => ({ role: 'assistant', content: '', tool_calls: [{ function: { name, arguments: args } }] })
    const message = readOnly
      ? count === 0 ? call('write_file', { path: 'forbidden.txt', content: 'no' }) : { role: 'assistant', content: 'Read-only stage.' }
      : count === 0 ? call('write_file', { path: 'feature.txt', content: 'Local implementation.' }) : { role: 'assistant', content: 'Implemented with the local model.' }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ message }))
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  return { base, bodies, close: () => new Promise<void>(r => server.close(() => r())) }
}
test('local filesystem tools refuse parent traversal, .git, and symlinks escaping the worktree', async t => {
  const dir = tempDir('local-boundary'); const root = join(dir, 'work'); mkdirSync(root)
  const canonical = await realpath(root)
  await assert.rejects(localPath(canonical, '../outside'))
  await assert.rejects(localPath(canonical, '.GiT/config'))
  assert.equal(await localPath(canonical, 'src/new.py'), join(canonical, 'src/new.py'))
  try { symlinkSync(dir, join(root, 'escape'), 'dir') } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EPERM') return t.skip('OS does not permit test symlinks'); throw e }
  await assert.rejects(localPath(canonical, 'escape/outside.txt'))
})
test('local inference writes in its worktree; read-only stages never get a write tool and refuse forged writes', async () => {
  const root = tempDir('local-run')
  for (const readOnly of [false, true]) {
    const mock = await mockOllama(readOnly)
    try {
      const result = await runLocal({ agent: 'local', cwd: root, prompt: 'Implement.', readOnly, maxSteps: 4, taskMcp: null, signal: new AbortController().signal, log: () => {}, env: { ONE_CODER_OLLAMA: mock.base } })
      assert.equal(result.ok, true, result.error)
      assert.equal(mock.bodies[0].tools.some((t: any) => t.function.name === 'write_file'), !readOnly)
      assert.equal(existsSync(join(root, 'forbidden.txt')), false)
      if (!readOnly) assert.equal(readFileSync(join(root, 'feature.txt'), 'utf8'), 'Local implementation.')
    } finally { await mock.close() }
  }
})
test('built worker executes the chosen local agent without Claude or Codex CLI', async () => {
  const mock = await mockOllama()
  const r = makeRepo()
  const file = writeConfig(r, { workspace: WS_LOCAL.id, port: 47393, pollSec: 2, name: 'local-test', repos: [repoEntry(r)] })
  const worker = await startWorker(file, { ONE_CODER_OLLAMA: mock.base, CODEX_BIN: 'missing-codex', CLAUDE_BIN: 'missing-claude' })
  let tab: FakeTab | null = null
  try {
    tab = await FakeTab.connect(47393); tab.hello(WS_LOCAL); await tab.next('welcome')
    const outcome = await tab.run({ ...task({ kind: 'implement' }, { id: 'local_agent' }), agent: 'local' })
    assert.equal(outcome.status, 'ok', JSON.stringify(outcome))
    assert.match(outcome.summary ?? '', /local model/)
    assert.ok(outcome.git?.files.some(f => f.path === 'feature.txt'))
    assert.ok(mock.bodies[0].tools.some((t: any) => t.function.name === 'one_task_read'))
    assert.ok(!mock.bodies[0].tools.some((t: any) => t.function.name === 'one_task_permission'))
  } finally { tab?.close(); await worker.stop(); await mock.close() }
})
