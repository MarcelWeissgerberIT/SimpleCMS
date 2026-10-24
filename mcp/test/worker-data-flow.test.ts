import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { sanitizeTask } from '../src/worker/worker.ts'
import { runStage } from '../src/worker/run.ts'
import { LocalMcp } from '../src/worker/local-mcp.ts'
import { cleanupAll, task } from './worker-helpers.ts'

after(cleanupAll)
test('worker preserves explicit boundaries and refuses a disallowed cloud model before touching the repository', async () => {
  const picked = sanitizeTask(task({kind:'implement'}, {agent:'copilot', dataFlow:{providers:['local'], mcpOrigins:[]}}))!
  assert.deepEqual(picked.dataFlow, {providers:['local'], mcpOrigins:[]})
  // No repo, CLI or network fixture: refusal must happen before accessing any of them.
  const outcome = await runStage({task:picked} as any)
  assert.equal(outcome.status,'refused')
  assert.match(outcome.error??'',/data-flow rule/)
  assert.equal(sanitizeTask(task({kind:'implement'}))?.dataFlow, undefined)
  assert.deepEqual(sanitizeTask({...task({kind:'implement'}),dataFlow:'invalid'})?.dataFlow, {providers:[],mcpOrigins:[]})
})
test('an explicit MCP boundary refuses remote origins and executable stdio configurations before connecting', async () => {
  const mcp = new LocalMcp(true, ['https://allowed.invalid'])
  try {
    await mcp.connect(['remote','process'], {}, new AbortController().signal, '', {
      remote:{type:'http',url:'https://forbidden.invalid/mcp',headers:{Authorization:'Bearer fake-token-not-live'}},
      process:{command:'definitely-not-a-program',args:[]},
    })
    assert.match(mcp.description(),/Unavailable: remote, process/)
    assert.deepEqual(mcp.catalog(),[])
  } finally { await mcp.close() }
})
