import './helpers/noNet'
import { test, expect } from '@playwright/test'
import { flowChoices } from '../../src/app/features/ai/core/flowChoices'
import type { Route } from '../../src/shared/ai/types'
const choice = (m: string, p: Route['p'] = 'local', ok = true) => ({ route: { p, m }, ok })
const profiles = ['atlas-flow:latest', 'marcel-flow:latest', 'marcel-coder:latest', 'qwen3-coder:30b'].map(m => choice(m))
const mine = { id: 'host-1', model: 'atlas-flow:latest', mine: true }

test('the installed Atlas Flow profiles become one choice, with different models and providers retained', () => {
  const rows = [...profiles, choice('llama:8b'), choice('qwen3-coder:30b', 'ollama')]
  expect(flowChoices(rows, []).map(m => m.route)).toEqual([rows[0].route, rows[4].route, rows[5].route])
  expect(rows).toHaveLength(6) // never mutate the execution catalog
})
test('preserve the selected personal host or direct route; do not merge another owner’s host', () => {
  const own = choice('one-shared/host-1'), other = choice('one-shared/host-2')
  const rows = [...profiles, own, other]
  const shares = [mine, { ...mine, id: 'host-2', mine: false }]
  expect(flowChoices(rows, shares, own.route)).toEqual([own, other])
  expect(flowChoices(rows, shares, profiles[0].route)).toEqual([profiles[0], other])
})
test('no usable replacement: keep legacy choices and a blocked route’s reason', () => {
  expect(flowChoices(profiles.slice(1), [])).toEqual(profiles.slice(1))
  const blocked = [{ ...profiles[0], ok: false }, ...profiles.slice(1)]
  expect(flowChoices(blocked, [])).toEqual(blocked)
})
test('a disconnected personal worker still leaves the shared Atlas Flow choice', () => {
  const own = choice('one-shared/host-1')
  expect(flowChoices([own], [mine])).toEqual([own])
  expect(flowChoices(profiles, [{ ...mine, model: 'another-model' }])).toEqual([profiles[0]])
})
