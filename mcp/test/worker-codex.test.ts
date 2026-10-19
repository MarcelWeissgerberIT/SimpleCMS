import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { codexArgs, runCodex, type CodexRun } from '../src/worker/codex.ts'
import { sanitizeTask } from '../src/worker/worker.ts'
import { stageNeeds } from '../../src/app/features/coding/protocol.ts'
import { cleanupAll, fakeBin, makeRepo, pathWith, task, tempDir, FakeTab, repoEntry, startWorker, writeConfig, WS_LOCAL } from './worker-helpers.ts'

after(cleanupAll)
const options = (extra: Partial<CodexRun> = {}): CodexRun => ({ agent: 'codex', cwd: process.cwd(), prompt: 'A task that must only travel over stdin', readOnly: true, maxSteps: 10, taskMcp: null, signal: new AbortController().signal, log: () => {}, ...extra })
const program = `
import { writeFileSync } from 'node:fs';
const args=process.argv.slice(2);
if(args.includes('--help')){console.log('--ignore-user-config --oss --json');process.exit(0)}
let prompt='';for await(const c of process.stdin)prompt+=c;
if(process.env.CODEX_CAPTURE)writeFileSync(process.env.CODEX_CAPTURE,JSON.stringify({args,prompt}));
if(process.env.CODEX_HANG){setInterval(()=>{},1000)}else{
 if(args[args.indexOf('--sandbox')+1]==='workspace-write')writeFileSync('feature.txt','implemented');
 console.log(JSON.stringify({type:'item.completed',item:{id:'message',type:'agent_message',text:'Done by selected coding agent'}}));
 console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,output_tokens:10}}));
}
`

test('agent choices are explicit; unknown selections cannot fall back to Claude', () => {
  assert.equal(sanitizeTask({ ...task({ kind: 'plan' }), agent: 'wrong' }), null)
  for (const agent of ['codex', 'local'] as const) {
    assert.equal(sanitizeTask({ ...task({ kind: 'plan' }), agent })?.agent, agent)
    assert.ok(stageNeeds({ kind: 'implement', agent }).includes(`agent:${agent}`))
  }
  assert.ok(!stageNeeds({ kind: 'implement' }).some(s => s.startsWith('agent:')))
})
test('Codex keeps credentials/task text out of arguments and plans read-only', () => {
  const opts = options({ agent: 'codex', taskMcp: { command: '/node', args: ['/worker', 'task-mcp'], env: { ONE_WORKER_TASK_TOKEN: 'a-secret-token' } } })
  const args = codexArgs(opts)
  assert.ok(!args.includes('--oss'))
  assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only')
  assert.ok(!args.join(' ').includes('a-secret-token'))
  assert.ok(!args.join(' ').includes(opts.prompt))
  assert.ok(!codexArgs(options()).includes('--oss'))
})
test('runner passes the prompt over stdin, executes selected CLI, and cancels a running process', async () => {
  const dir = tempDir('codex-runner')
  const bin = fakeBin(join(dir, 'bin'), 'codex', program)
  const capture = join(dir, 'capture.json')
  const env = { ...process.env, ...pathWith(bin), CODEX_CAPTURE: capture, CODEX_BIN: '' }
  const result = await runCodex(options({ cwd: dir, readOnly: false, env }))
  assert.equal(result.ok, true, result.error)
  assert.equal(result.text, 'Done by selected coding agent')
  assert.equal(readFileSync(join(dir, 'feature.txt'), 'utf8'), 'implemented')
  const input = JSON.parse(readFileSync(capture, 'utf8'))
  assert.equal(input.prompt, options().prompt)
  assert.ok(!input.args.includes(options().prompt))
  const controller = new AbortController()
  const waiting = runCodex(options({ cwd: dir, env: { ...env, CODEX_HANG: '1' }, signal: controller.signal }))
  setTimeout(() => controller.abort(), 300)
  assert.equal((await waiting).stopped, true)
})
test('built worker routes a Codex implement stage without invoking Claude', async () => {
  const r = makeRepo()
  const bins = fakeBin(join(r.dir, 'codex-bin'), 'codex', program)
  const file = writeConfig(r, { workspace: WS_LOCAL.id, port: 47392, pollSec: 2, name: 'agent-test', repos: [repoEntry(r)] })
  const worker = await startWorker(file, { ...pathWith(bins), CODEX_BIN: '', CLAUDE_BIN: 'intentionally-missing-claude' })
  let tab: FakeTab | null = null
  try {
    tab = await FakeTab.connect(47392); tab.hello(WS_LOCAL); await tab.next('welcome')
    for (const agent of ['codex'] as const) {
      const outcome = await tab.run({ ...task({ kind: 'implement' }, { id: `agent_${agent}` }), agent })
      assert.equal(outcome.status, 'ok', JSON.stringify(outcome))
      assert.match(outcome.summary ?? '', /selected coding agent/)
      assert.ok(existsSync(join(r.worktrees, `agent_${agent}`)) || outcome.git?.files?.length)
    }
  } finally { tab?.close(); await worker.stop() }
})
