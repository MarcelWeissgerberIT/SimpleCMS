import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitLocalToolContext } from '../../src/shared/ai/local-context.ts'
import { localChatMessages } from '../src/worker/local-chat.ts'

const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value))
test('local context keeps a large Atlas conversation closed and preserves its original task and run history', () => {
  const messages = [
    { role: 'system' as const, content: 'Keep all permissions and review requirements. '.repeat(70) },
    { role: 'user' as const, content: 'Read Atlas identity. Do not modify anything. Keep my attached source verbatim. '.repeat(50) },
    { role: 'assistant' as const, content: JSON.stringify([{ type: 'tool_use', id: 'discover', name: 'one_mcp_search', input: { query: 'atlas_whoami' } }]) },
    { role: 'user' as const, content: JSON.stringify([{ type: 'tool_result', tool_use_id: 'discover', content: 'Tool schema: ' + 'Ö🤖\\"'.repeat(1500) }]) },
    { role: 'assistant' as const, content: JSON.stringify([{ type: 'tool_use', id: 'identity', name: 'one_mcp_call', input: { server: 'atlas', name: 'atlas_whoami', arguments: {} } }]) },
    { role: 'user' as const, content: JSON.stringify([{ type: 'tool_result', tool_use_id: 'identity', content: 'Active tenant: one. ' + 'Other allowed projects. '.repeat(250) }]) },
  ]
  const before = structuredClone(messages), tools = [{ name: 'one_mcp_call', parameters: {} }]
  const packed = fitLocalToolContext(messages, next => size({ messages: next, tools }) <= 22000)
  assert.ok(size({ messages: packed, tools }) <= 22000)
  assert.deepEqual(messages, before)
  assert.deepEqual(packed.slice(0, 3), before.slice(0, 3))
  assert.deepEqual(packed[4], before[4])
  assert.equal(packed[5]!.content, before[5]!.content, 'preserve the newest result when older discovery can be excerpted')
  assert.match(packed[3]!.content, /Harness context excerpt/)
  const native = localChatMessages(packed)
  assert.equal(native[3].tool_call_id, 'discover')
  assert.equal(native[5].tool_call_id, 'identity')
  assert.match(native[5].content, /Active tenant: one/)
  assert.equal(fitLocalToolContext(before, () => true), before)
})

test('one-shot result envelopes retain ids and explicit tool errors when latest results must be shortened', () => {
  const messages = [
    { role: 'system' as const, content: 'System policy' },
    { role: 'user' as const, content: 'User task' },
    { role: 'assistant' as const, content: JSON.stringify({ content: '', tool_calls: [{ id: 'get', name: 'one_mcp_call', arguments: { server: 'atlas', name: 'atlas_get', arguments: { ref: 43 } } }] }) },
    { role: 'user' as const, content: JSON.stringify({ tool_result: { id: 'get', is_error: true, content: 'Source unavailable: ' + 'x'.repeat(20000) } }) },
  ]
  const packed = fitLocalToolContext(messages, next => size(next) <= 3000)
  const result = JSON.parse(packed[3]!.content).tool_result
  assert.equal(result.id, 'get'); assert.equal(result.is_error, true)
  assert.match(result.content, /Source unavailable/); assert.match(result.content, /Harness context excerpt/)
  assert.ok(size(packed) <= 3000)
  assert.deepEqual(packed[2], messages[2])
})

test('an oversized task or unrelated JSON cannot be silently removed to fit local context', () => {
  const task = [{ role: 'user' as const, content: JSON.stringify({ tool_result: { id: 'invented', content: 'x'.repeat(10000) } }) }]
  assert.throws(() => fitLocalToolContext(task, next => size(next) <= 2000), /fresh task or select a smaller/)
  assert.equal(task[0]!.content.length > 10000, true)
})
