import { test, expect } from '@playwright/test'
import { resolveRoute, type RouteWorld } from '../../src/app/features/ai/core/resolve'
import { MODELS } from '../../src/shared/ai/models'
import type { Route } from '../../src/shared/ai/types'

const selected: Route = { p: 'local', m: 'atlas-flow:latest' }
const world: RouteWorld = { hasKey: () => true, shortlist: [], aiModel: 'claude-opus-5-5', info: route => ({ ...MODELS[0]!, route }) }
test('an explicit request provider cannot silently fall through to Claude when an action needs another class', () => {
  const result = resolveRoute({ cls: 'structure', chip: selected, caps: ['structured'], classes: [] }, world)
  expect(result).toMatchObject({ ok: false, code: 'capability', level: 'chip', route: selected })
})
test('stored defaults can still skip a class they do not support, without rewriting them', () => {
  const defaults = { default: [selected] }
  const result = resolveRoute({ cls: 'structure', caps: ['structured'], classes: [] }, { ...world, device: defaults })
  expect(result).toMatchObject({ ok: true, level: 'legacy', route: { p: 'anthropic', m: 'claude-opus-5-5' } })
  expect(defaults.default).toEqual([selected])
})
