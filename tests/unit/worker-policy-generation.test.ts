import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GEN } from '../../src/shared/ai/generations.ts'
import { AI_POLICY_GEN, policyKnown, requiredGen, sanitizeWorkspaceAI } from '../../src/shared/ai/policy.ts'
import { stampGen, stampDeviceGen } from '../../src/shared/ai/governor.ts'

test('worker data rules and routes stamp a generation older clients cannot enforce', () => {
  const ws = { policy: { providers: { local: { allow: ['selection'] as const } }, restricted: [] } }
  assert.equal(AI_POLICY_GEN, GEN.workerModels)
  assert.equal(requiredGen(ws), GEN.workerModels)
  assert.equal(stampGen(ws, null, 1), GEN.workerModels)
  const stored = sanitizeWorkspaceAI({ ...ws, gen: GEN.workerModels })!
  assert.equal(policyKnown(stored, null, GEN.budget), false)
  assert.equal(policyKnown(stored, null, GEN.workerModels), true)
  assert.equal(stampDeviceGen({ default: [{ p: 'ollama', m: 'cloud-model' }] }, null, 1), GEN.workerModels)
  assert.equal(requiredGen(undefined, { allow: { codex: ['private'] } }), GEN.workerModels)
  assert.equal(requiredGen(undefined, { narrow: { local: ['page'] } }), GEN.workerModels)
  assert.equal(requiredGen({ routes: { write: [{ p: 'minimax', m: 'MiniMax-M3.1-Flash' }] } }), GEN.workerModels)
  assert.equal(requiredGen(undefined, { default: [{ p: 'anthropic', m: 'claude-sonnet-5-5' }] }), 1)
})
