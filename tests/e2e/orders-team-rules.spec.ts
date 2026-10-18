/**
 * Work orders in a team (Prüfaufträge B12, spec §3.10) — the pure rules (Node, no browser, no network):
 *  - requestedElsewhere: the worker device's "Auf anderem Gerät angefordert" card stands only for a Planen this device
 *    saw arrive from another device and has not pressed or planned since (≤ 24 h); never over a kept press, a chain being
 *    made or running here; a device that was away meanwhile: only a request it holds no record of, changed within a day;
 *  - ruleRefusal: a data rule's refusal of the planner — a member reads who can change a WORKSPACE rule, without the
 *    change key; an admin (or a local workspace) gets the fix keys; a member's own classes stay theirs;
 *  - the record keeps `asked` / `pressed` (times only); a record holding nothing else is none;
 *  - the team words: EN = DE keys, placeholders kept, never the banned names, the spec's member sentence.
 * The engine's side (a device without the worker link follows the request only) is orders-chain.spec's Node case.
 */
import { test as node, expect } from '@playwright/test'
import { requestedElsewhere, ruleRefusal } from '../../src/app/features/coding/orders/team'
import { bareRecord, readOrderRecord } from '../../src/app/features/coding/orders/record'
import { messages as team } from '../../src/app/features/coding/orders/teamMessages'
import type { OrderRecord } from '../../src/app/features/coding/orders/types'

const NOW = 1_760_000_000_000
const H = 3600_000
const row = (ago: number) => ({ updatedAt: NOW - ago })
const draftOf = (at: number) => ({ plan: { v: 1, summary: '', context: null, steps: [], questions: [], refused: null }, hash: 'h', at, run: 'run1', receipt: null, edited: false, source: { rev: 0, prov: {}, pins: {}, server: null, tools: [], left: [], calls: [] } }) as unknown as NonNullable<OrderRecord['draft']>

node.describe('orders in a team — the request from another device (Node)', () => {
  node('asked for: exact while this device saw the Planen arrive and has not answered it', () => {
    const asked: OrderRecord = { v: 1, state: 'draft', asked: { at: NOW - 60_000 } }
    expect(requestedElsewhere(asked, row(60_000), NOW)).toBe(true)
    // pressed here since (any outcome) or planned here since: answered
    expect(requestedElsewhere({ ...asked, pressed: NOW - 30_000 }, row(60_000), NOW)).toBe(false)
    expect(requestedElsewhere({ ...asked, draft: draftOf(NOW - 30_000) }, row(60_000), NOW)).toBe(false)
    // a plan from before the request: the newer request still asks (a follow-up)
    expect(requestedElsewhere({ ...asked, draft: draftOf(NOW - 2 * H) }, row(60_000), NOW)).toBe(true)
    // a press older than the request: asks
    expect(requestedElsewhere({ ...asked, pressed: NOW - 2 * H }, row(60_000), NOW)).toBe(true)
    // over a done or halted chain here (a follow-up from another device): asks
    expect(requestedElsewhere({ ...asked, state: 'done' }, row(60_000), NOW)).toBe(true)
    expect(requestedElsewhere({ ...asked, state: 'halted' }, row(60_000), NOW)).toBe(true)
    // 24 h: gone
    expect(requestedElsewhere({ v: 1, state: 'draft', asked: { at: NOW - 25 * H } }, row(25 * H), NOW)).toBe(false)
  })

  node('never over a kept press, a chain being made, interrupted or running here', () => {
    const asked = { at: NOW - 60_000 }
    expect(requestedElsewhere({ v: 1, state: 'draft', asked, want: { at: NOW - 10_000, mode: 'trigger' } }, row(1000), NOW)).toBe(false)
    for (const state of ['running', 'creating', 'interrupted'] as const) expect(requestedElsewhere({ v: 1, state, asked }, row(1000), NOW)).toBe(false)
  })

  node('nothing seen arrive: only a request this device holds no record of, changed within a day', () => {
    expect(requestedElsewhere(null, row(60_000), NOW)).toBe(true)
    expect(requestedElsewhere(null, row(25 * H), NOW)).toBe(false)
    // a record of its own press (a press that ended without a plan): never "asked elsewhere"
    expect(requestedElsewhere({ v: 1, state: 'draft', pressed: NOW - 60_000 }, row(1000), NOW)).toBe(false)
    expect(requestedElsewhere({ v: 1, state: 'discarded', draft: draftOf(NOW - H) }, row(1000), NOW)).toBe(false)
  })
})

node.describe('orders in a team — a data rule refused the planner (Node)', () => {
  const fix = (data?: string) => ({ kind: 'step', step: 'data', provider: 'anthropic', ...(data ? { data } : {}) })
  node('a member: the workspace rule is named, no change key; an admin or a local workspace: the fix keys', () => {
    expect(ruleRefusal('policy', fix('rows'), false)).toBe('member')
    expect(ruleRefusal('policy', fix('page'), false)).toBe('member')
    expect(ruleRefusal('policy', fix(), false)).toBe('member')
    expect(ruleRefusal('policy', fix('rows'), true)).toBe('fix')
    // the member's own classes are theirs to change (their device's rule)
    for (const own of ['private', 'mail', 'memory', 'mcp']) expect(ruleRefusal('policy', fix(own), false)).toBe('fix')
  })
  node('not a data rule: nothing to say here (the outcome line says it)', () => {
    expect(ruleRefusal('no_key', fix('rows'), false)).toBeNull()
    expect(ruleRefusal('key_in_text', null, false)).toBeNull()
    expect(ruleRefusal('policy', { kind: 'step', step: 'key' }, false)).toBeNull()
    expect(ruleRefusal('policy', null, false)).toBeNull()
    expect(ruleRefusal(undefined, fix('rows'), false)).toBeNull()
  })
})

node.describe('orders in a team — the record and the words (Node)', () => {
  node('the record keeps asked / pressed as times only; junk is dropped; a record holding nothing is none', () => {
    const rec = readOrderRecord({ v: 1, state: 'draft', asked: { at: NOW, by: 'device-b', text: 'x' }, pressed: NOW - 5 })
    expect(rec).toEqual({ v: 1, state: 'draft', asked: { at: NOW }, pressed: NOW - 5 })
    expect(readOrderRecord({ v: 1, state: 'draft', asked: { at: -1 }, pressed: 'yesterday' })).toEqual({ v: 1, state: 'draft' })
    expect(bareRecord({ v: 1, state: 'draft' })).toBe(true)
    expect(bareRecord({ v: 1, state: 'draft', asked: { at: NOW } })).toBe(false)
    expect(bareRecord({ v: 1, state: 'draft', pressed: NOW })).toBe(false)
    expect(bareRecord({ v: 1, state: 'discarded' })).toBe(false)
  })

  node('the team words: EN = DE keys, placeholders kept, never the banned names, the spec\'s sentences', () => {
    const en = team.en as Record<string, string>
    const de = team.de as Record<string, string>
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort())
    for (const k of Object.keys(en)) expect((de[k]!.match(/\{\w+\}/g) ?? []).sort()).toEqual((en[k]!.match(/\{\w+\}/g) ?? []).sort())
    for (const v of Object.values(de)) expect(v).not.toMatch(/Prüfung|Plan bereit|\bdanach\b|Freigeben/)
    expect(de['features.coding.order.why.ruleMember']).toBe('Regel des Arbeitsbereichs — eine Admin kann sie ändern')
    expect(de['features.coding.order.chip.asked']).toBe('angefordert')
    expect(de['features.coding.order.remote.asked']).toContain('Hier planen')
    // never a service, a vendor or a host
    for (const v of [...Object.values(en), ...Object.values(de)]) expect(v).not.toMatch(/https?:|\.com\b|\.io\b/)
  })
})
