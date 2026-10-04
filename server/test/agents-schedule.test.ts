/**
 * Custom agents — the pieces that need a fake clock (docs/CLOUD.md § Agents › Schedules): slots in a
 * time zone across DST changes, one run per slot across restarts (state in SQLite), a slot missed
 * during downtime runs once; plus the server's own sanitizer of agent definitions and the pricing.
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import * as Y from 'yjs'
import { costOf } from '../src/agents/pricing.ts'
import { readAgents, sanitizeAgent } from '../src/agents/sanitize.ts'
import { decideSlot, slotAt, zonedTime } from '../src/agents/schedule.ts'
import { dueSchedules } from '../src/agents/service.ts'
import { AgentStore } from '../src/agents/store.ts'
import type { CustomAgent, ScheduleTrigger } from '../src/agents/types.ts'
import { Keyring } from '../src/crypto/keyring.ts'
import { openDb } from '../src/db/index.ts'
import { Repo } from '../src/repo.ts'
import { tempDir } from './helpers.ts'

const Z = (iso: string) => Date.parse(iso)
const daily = (at: string, tz = 'Europe/Berlin'): ScheduleTrigger => ({ type: 'schedule', every: 'day', at, tz })

function agent(id: string, trigger: CustomAgent['trigger'], at: number, extra: Partial<CustomAgent> = {}): CustomAgent {
  return { id, name: id, instructions: '', trigger, scope: { everything: true, pages: [], databases: [] }, write: 'none', output: null, mcpServers: [], runner: 'server', model: null, effort: null, maxRunUsd: 1, enabled: true, createdBy: null, createdAt: at, updatedAt: at, ...extra }
}

describe('schedule slots (Intl, DST-safe)', () => {
  test('daily 08:00 Europe/Berlin is 07:00Z in winter and 06:00Z in summer — across both DST changes', () => {
    // 2026-03-29: clocks go 02:00 CET → 03:00 CEST
    assert.equal(slotAt(daily('08:00'), Z('2026-03-28T12:00:00Z')), Z('2026-03-28T07:00:00Z'))
    assert.equal(slotAt(daily('08:00'), Z('2026-03-29T05:59:00Z')), Z('2026-03-28T07:00:00Z'))
    assert.equal(slotAt(daily('08:00'), Z('2026-03-29T06:00:00Z')), Z('2026-03-29T06:00:00Z'))
    // 2026-10-25: clocks go 03:00 CEST → 02:00 CET
    assert.equal(slotAt(daily('08:00'), Z('2026-10-24T06:30:00Z')), Z('2026-10-24T06:00:00Z'))
    assert.equal(slotAt(daily('08:00'), Z('2026-10-25T06:30:00Z')), Z('2026-10-24T06:00:00Z'))
    assert.equal(slotAt(daily('08:00'), Z('2026-10-25T07:00:00Z')), Z('2026-10-25T07:00:00Z'))
  })

  test('a wall time skipped by DST fires after the jump; a doubled one fires once, at its first occurrence', () => {
    // 02:30 does not exist on 2026-03-29 in Berlin → 03:30 CEST = 01:30Z
    assert.equal(zonedTime(2026, 3, 29, 2, 30, 'Europe/Berlin'), Z('2026-03-29T01:30:00Z'))
    assert.equal(slotAt(daily('02:30'), Z('2026-03-29T01:29:00Z')), Z('2026-03-28T01:30:00Z'))
    assert.equal(slotAt(daily('02:30'), Z('2026-03-29T01:30:00Z')), Z('2026-03-29T01:30:00Z'))
    // 02:30 happens twice on 2026-10-25 (CEST 00:30Z, then CET 01:30Z): only the first is a slot
    assert.equal(zonedTime(2026, 10, 25, 2, 30, 'Europe/Berlin'), Z('2026-10-25T00:30:00Z'))
    assert.equal(slotAt(daily('02:30'), Z('2026-10-25T01:45:00Z')), Z('2026-10-25T00:30:00Z'))
  })

  test('hourly, weekdays, weekly and monthly (short months fire on their last day)', () => {
    const hourly: ScheduleTrigger = { type: 'schedule', every: 'hour', at: '00:15', tz: 'Europe/Berlin' }
    assert.equal(slotAt(hourly, Z('2026-10-25T00:20:00Z')), Z('2026-10-25T00:15:00Z'))
    assert.equal(slotAt(hourly, Z('2026-10-25T01:14:59Z')), Z('2026-10-25T00:15:00Z'))
    assert.equal(slotAt(hourly, Z('2026-10-25T01:15:00Z')), Z('2026-10-25T01:15:00Z'))
    // Saturday 2026-10-10 → Friday's slot
    const weekdays: ScheduleTrigger = { type: 'schedule', every: 'weekday', at: '09:00', tz: 'UTC' }
    assert.equal(slotAt(weekdays, Z('2026-10-10T12:00:00Z')), Z('2026-10-09T09:00:00Z'))
    // weekly on Monday (1) in New York
    const weekly: ScheduleTrigger = { type: 'schedule', every: 'week', at: '07:30', weekday: 1, tz: 'America/New_York' }
    assert.equal(slotAt(weekly, Z('2026-10-08T00:00:00Z')), Z('2026-10-05T11:30:00Z'))
    // day 31 in February → 28th
    const monthly: ScheduleTrigger = { type: 'schedule', every: 'month', at: '06:00', day: 31, tz: 'UTC' }
    assert.equal(slotAt(monthly, Z('2027-03-01T00:00:00Z')), Z('2027-02-28T06:00:00Z'))
    assert.equal(slotAt(monthly, Z('2027-03-31T06:00:00Z')), Z('2027-03-31T06:00:00Z'))
  })

  test('decideSlot: new or edited agents never fire a slot that already passed; the runtime switch counts too', () => {
    const base = { sig: 'a', enabledAt: 0 }
    assert.equal(decideSlot({ ...base, slot: null, state: undefined, agentUpdatedAt: 0 }), 'none')
    assert.equal(decideSlot({ ...base, slot: 100, state: undefined, agentUpdatedAt: 150 }), 'mark')
    assert.equal(decideSlot({ ...base, slot: 200, state: undefined, agentUpdatedAt: 150 }), 'run')
    assert.equal(decideSlot({ ...base, slot: 200, state: { lastSlot: 200, sig: 'a', seenAt: 201 }, agentUpdatedAt: 150 }), 'none')
    assert.equal(decideSlot({ ...base, slot: 300, state: { lastSlot: 200, sig: 'a', seenAt: 201 }, agentUpdatedAt: 150 }), 'run')
    // another schedule: starts over from the edit
    assert.equal(decideSlot({ ...base, slot: 300, state: { lastSlot: 200, sig: 'b', seenAt: 201 }, agentUpdatedAt: 310 }), 'mark')
    assert.equal(decideSlot({ slot: 300, state: { lastSlot: 200, sig: 'a', seenAt: 201 }, sig: 'a', agentUpdatedAt: 150, enabledAt: 350 }), 'mark')
  })
})

describe('scheduler with a fake clock: one run per slot, restarts, downtime', () => {
  test('daily 08:00 Europe/Berlin over a DST change, a restart and two days of downtime', () => {
    const dir = tempDir()
    const file = join(dir, 'one.sqlite')
    const dataKey = randomBytes(32)
    let db = openDb(file)
    const repo = new Repo(db, randomBytes(32), new Keyring(db, dataKey))
    const user = repo.createUser('sched@example.com')
    const ws = repo.createWorkspace(user.id, 'Sched', null)
    const store = () => new AgentStore(db, new Keyring(db, dataKey), (s) => s)
    let agents = [agent('a1', daily('08:00'), Z('2026-03-27T12:00:00Z'))]
    const W = { id: ws.id, enabledAt: 0 }
    let s = store()
    const fire = (iso: string) => dueSchedules(s, Z(iso), W, agents).map((d) => new Date(d.slot).toISOString())

    assert.deepEqual(fire('2026-03-27T12:00:30Z'), [], 'created after today’s slot: nothing (recorded only)')
    assert.deepEqual(fire('2026-03-28T06:59:30Z'), [])
    assert.deepEqual(fire('2026-03-28T07:00:10Z'), ['2026-03-28T07:00:00.000Z'])
    assert.deepEqual(fire('2026-03-28T07:00:40Z'), [], 'the same slot never twice')

    // restart: a new process (new store over the same file) does not run the slot again
    db.close()
    db = openDb(file)
    s = store()
    assert.deepEqual(fire('2026-03-28T07:05:00Z'), [])

    // DST: Sunday 08:00 CEST = 06:00Z
    assert.deepEqual(fire('2026-03-29T05:59:30Z'), [])
    assert.deepEqual(fire('2026-03-29T06:00:05Z'), ['2026-03-29T06:00:00.000Z'])

    // downtime over two slots: the latest one runs once when the server is back
    assert.deepEqual(fire('2026-03-31T12:00:00Z'), ['2026-03-31T06:00:00.000Z'])
    assert.deepEqual(fire('2026-03-31T12:00:30Z'), [])

    // the schedule changes at 13:00: today's 09:00 slot is not caught up, tomorrow's runs
    agents = [agent('a1', daily('09:00'), Z('2026-03-27T12:00:00Z'), { updatedAt: Z('2026-03-31T13:00:00Z') })]
    assert.deepEqual(fire('2026-03-31T13:00:30Z'), [])
    assert.deepEqual(fire('2026-04-01T07:00:05Z'), ['2026-04-01T07:00:00.000Z'])

    // switched off, browser runner, or another trigger: never
    agents = [agent('a1', daily('09:00'), 0, { enabled: false }), agent('a2', daily('09:00'), 0, { runner: 'browser' }), agent('a3', { type: 'manual' }, 0)]
    assert.deepEqual(fire('2026-04-02T07:00:05Z'), [])
    db.close()
  })
})

describe('agent definitions are sanitized on the server', () => {
  test('unknown fields dropped, strings clamped, enums defaulted, broken entries ignored', () => {
    const a = sanitizeAgent('ag-1', {
      id: 'ag-1',
      name: 'x'.repeat(500),
      instructions: 'y'.repeat(9000),
      trigger: { type: 'schedule', every: 'fortnight', at: '25:99', tz: 'Mars/Olympus', extra: true },
      scope: { everything: 'yes', pages: ['p1', 'bad id!', 'p1'], databases: 'nope' },
      write: 'delete-everything',
      output: { pageId: 'out-1', mode: 'sideways' },
      mcpServers: ['atlas', 'Bad Name', 'atlas'],
      runner: 'server',
      model: 'gpt-4',
      effort: 'max',
      maxRunUsd: 1e9,
      enabled: true,
      evil: '<script>',
      createdBy: 'acc-ada',
      updatedBy: 'acc-bob',
      createdAt: 5,
    })!
    assert.equal(a.name.length, 200)
    assert.equal(a.instructions.length, 8000)
    assert.deepEqual(a.trigger, { type: 'schedule', every: 'day', at: '09:00', tz: 'UTC' })
    assert.deepEqual(a.scope, { everything: false, pages: ['p1'], databases: [] })
    assert.equal(a.write, 'stage')
    assert.deepEqual(a.output, { pageId: 'out-1', mode: 'append' })
    assert.deepEqual(a.mcpServers, ['atlas'])
    assert.equal(a.model, null)
    assert.equal(a.effort, null)
    assert.equal(a.maxRunUsd, 50)
    assert.equal(a.updatedAt, 5)
    // who saved it last is kept (the app's browser runner waits for the creator's confirmation)
    assert.equal(a.createdBy, 'acc-ada')
    assert.equal(a.updatedBy, 'acc-bob')
    assert.equal(sanitizeAgent('ag-5', { name: 'Old', runner: 'server' })!.updatedBy, null)
    assert.equal('evil' in a, false)
    // ignored: not an object, mismatched id, a row trigger without a database
    assert.equal(sanitizeAgent('ag-2', 'nope'), null)
    assert.equal(sanitizeAgent('ag-3', { id: 'other' }), null)
    assert.equal(sanitizeAgent('ag-4', { trigger: { type: 'row_created' } }), null)
    assert.equal(sanitizeAgent('bad id!', {}), null)
    // readAgents never throws on a broken map
    const doc = new Y.Doc()
    doc.getMap('agents').set('ok-1', { name: 'Fine', runner: 'server', enabled: true })
    doc.getMap('agents').set('ok-2', 42)
    doc.getMap('agents').set('ok-3', null)
    assert.deepEqual(readAgents(doc).map((x) => x.id), ['ok-1'])
  })

  test('cost estimates per model (unknown models are priced like the most expensive one)', () => {
    assert.equal(costOf('claude-opus-5-5', { input_tokens: 1_000_000, output_tokens: 0 }).usd, 4)
    assert.equal(costOf('claude-opus-5-5', { input_tokens: 0, output_tokens: 1_000_000 }).usd, 20)
    assert.equal(costOf('claude-opus-5-5', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 }).usd, 0.2)
    assert.equal(costOf('claude-sonnet-5-5', { input_tokens: 1_000_000, output_tokens: 0 }).usd, 2)
    assert.equal(costOf('claude-future-9', { input_tokens: 1_000_000, output_tokens: 0 }).usd, 10)
  })
})
