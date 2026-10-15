/**
 * The Patchbay's setup lamps — the pure model (B11, plan §1.11 / §3.7, §6 U7 · U26 · U27), run by the Playwright runner
 * in Node: features/patchbay/setup/{lamps,ghosts,keys,returnValue}.ts load without the store, i18n or CSS.
 *  - the lamp sequence for every state: no key; a key of another provider only (00 "needs Claude"); the server missing /
 *    off / its sign-in run out / its token refused; a test running (busy) and its trace; the profile inactive by name /
 *    host / tools; the database in the trash ("restore"); the draft lost (05 reopens MirrorSetup) or kept (05 opens the
 *    editor); the first run: runs not read yet, none, running, proposals open, failed, all decided; all green;
 *  - one lamp worked on per recipe ('next' or 'busy'), green lamps stay green, dark ones carry no action;
 *  - 0 recipes → the 4 lamps 00–03; 2 recipes → two sets with their own 04–06;
 *  - ghosts match the recipe (4 ghosts + 5 planned cables for mock-2's state; names, chips, keys = the lamps' `creates`);
 *    once every part exists the plan holds no ghost and no cable the model does not draw itself (mock 1's real mirror —
 *    the same keys as model.ts);
 *  - the return record's reader (ids only, this scope only) and the key labels.
 * Every name is fictional (Tessera, Nordlicht, tracker); hosts are *.example.
 */
import { test, expect } from './fixtures'
import { clockKey, ghostKey, isGhostId, lampNo } from '../../src/app/features/patchbay/setup/keys'
import { createsOf, keyLabel, lampsOf, pickServer, setOf, type KeyFacts, type LampFacts, type LampSet, type ProfileFacts, type RecipeSetup, type ServerFacts } from '../../src/app/features/patchbay/setup/lamps'
import { ghostsOf } from '../../src/app/features/patchbay/setup/ghosts'
import { readReturnValue } from '../../src/app/features/patchbay/setup/returnValue'
import { moduleKey, scheduleKey } from '../../src/app/features/patchbay/ref'
import type { SetupLamp } from '../../src/app/features/patchbay/types'
import { messages as setupMessages } from '../../src/app/features/patchbay/messages-setup'
import { TRACKER_READS, TRACKER_TOOLS, mock1, modelOf } from '../fixtures/patchbay'

/* ------------------------------------------------------------------ facts */

const KEY_OK: KeyFacts = { ok: true, last4: '4f2a' }
const TRIGGER = { type: 'schedule' as const, every: 'weekday' as const, at: '07:30', tz: 'Europe/Berlin' }

const server = (over: Partial<ServerFacts> = {}): ServerFacts => ({
  id: 'srvTracker',
  name: 'tracker',
  enabled: true,
  state: 'ok',
  testing: false,
  access: 'token',
  tools: [...TRACKER_TOOLS],
  reads: [...TRACKER_READS],
  ...over,
})

/** A recipe of profile IN-01 that nothing of is made yet (mock-2, Fri 16:21). */
function recipe(over: Partial<Omit<RecipeSetup, 'agent'>> & { agent?: Partial<RecipeSetup['agent']> } = {}): RecipeSetup {
  const { agent, ...rest } = over
  return {
    profileId: 'in-01',
    recipeId: 'mirror',
    name: 'Mirror a list',
    servers: [{ id: 'srvTracker', name: 'tracker' }],
    database: { id: null, name: 'Tessera Handoff' },
    report: { id: null, title: 'Tessera Handoff · Bericht' },
    runs: null,
    ...rest,
    agent: { id: null, name: 'Tessera-Spiegel', runner: 'browser', trigger: TRIGGER, write: 'stage', tools: [...TRACKER_READS], when: 'weekdays 07:30', notes: true, model: null, budgetUsd: 3, ...agent },
  }
}

/** The database and report made (04 green), the agent saved (05 green). */
const madeAll = (runs: RecipeSetup['runs'], agent: Partial<RecipeSetup['agent']> = {}) =>
  recipe({ database: { id: 'dbHandoff', name: 'Tessera Handoff' }, report: { id: 'pgBericht', title: 'Bericht' }, runs, agent: { id: 'agTessera', ...agent } })

const profile = (over: Partial<ProfileFacts> = {}): ProfileFacts => ({ id: 'in-01', name: 'IN-01', status: { active: true, server: 'tracker' }, unlocks: 6, recipes: [recipe()], ...over })
const facts = (over: Partial<LampFacts> = {}): LampFacts => ({ key: KEY_OK, servers: [server()], ...over })

const states = (set: LampSet) => set.lamps.map((l) => l.state).join(' ')
const lamp = (set: LampSet, n: number): SetupLamp => set.lamps[n]
const one = (p: ProfileFacts, f: LampFacts): LampSet => {
  const sets = lampsOf(p, f)
  expect(sets).toHaveLength(Math.max(1, p.recipes.length))
  return sets[0]
}

/** Exactly one lamp per set is worked on (next or busy) until all are green; dark lamps never carry an action. */
function wellFormed(set: LampSet): void {
  const current = set.lamps.filter((l) => l.state === 'next' || l.state === 'busy')
  if (set.done === set.lamps.length) {
    expect(current).toHaveLength(0)
    expect(set.next).toBeNull()
  } else {
    expect(current).toHaveLength(1)
    expect(set.next).toBe(current[0])
    // the one worked on is the first lamp that is not green
    expect(set.lamps.findIndex((l) => l.state !== 'ok')).toBe(current[0].n)
  }
  for (const l of set.lamps) {
    if (l.state === 'dark') expect(l.action, `lamp ${l.n} is dark`).toBeUndefined()
    expect(l.say.key).toMatch(/^features\.patchbay\.lamp\./)
    if (l.n >= 4) expect(l.recipe).toBe(set.recipe)
    else expect(l.recipe).toBeUndefined()
  }
  expect(set.lamps.map((l) => l.n)).toEqual(set.lamps.map((_, i) => i))
  expect(set.done).toBe(set.lamps.filter((l) => l.state === 'ok').length)
}

/* ------------------------------------------------------------------ */

test.describe('setup lamps — lampsOf (§1.11)', () => {
  test('mock-2 (Fri 16:21): 00–03 green, 04 next with "Create database", 05 / 06 dark — 4/7 done', () => {
    const set = one(profile(), facts())
    wellFormed(set)
    expect(states(set)).toBe('ok ok ok ok next dark dark')
    expect(set.done).toBe(4)
    expect(set.lamps.map((l) => l.id)).toEqual(['key', 'server', 'test', 'profile', 'database', 'agent', 'firstRun'])
    expect(lamp(set, 0).say).toEqual({ key: 'features.patchbay.lamp.key.ok', vars: { last4: '4f2a' } })
    expect(lamp(set, 1).say).toEqual({ key: 'features.patchbay.lamp.server.connected.token', vars: { server: 'tracker' } })
    expect(lamp(set, 2).say).toEqual({ key: 'features.patchbay.lamp.test.ok', vars: { n: 3, tools: 'query_issues · get_issue · whoami' } })
    expect(lamp(set, 3).say).toEqual({ key: 'features.patchbay.lamp.profile.ok.one', vars: { unlocked: 6, n: 1 } })
    expect(lamp(set, 4).say).toEqual({ key: 'features.patchbay.lamp.database.make', vars: { db: 'Tessera Handoff', report: 'Tessera Handoff · Bericht' } })
    expect(lamp(set, 4).action).toEqual({ kind: 'mirrorSetup', profile: 'in-01', recipe: 'mirror' })
    expect(keyLabel(lamp(set, 4))).toEqual({ key: 'features.patchbay.setup.key.database' })
    // green lamps open their step as a quiet link (§6 U27)
    expect(lamp(set, 0).action).toEqual({ kind: 'aiSetup', provider: 'anthropic' })
    expect(lamp(set, 1).action).toEqual({ kind: 'mcpSettings', server: 'srvTracker' })
    expect(lamp(set, 2).action).toEqual({ kind: 'mcpTest', server: 'srvTracker' })
    expect(lamp(set, 3).action).toEqual({ kind: 'integrations', profile: 'in-01' })
    for (const n of [0, 1, 2, 3]) expect(keyLabel(lamp(set, n))).toEqual({ key: 'features.patchbay.setup.key.open' })
    expect(keyLabel(lamp(set, 5))).toBeNull()
    // 05 says what the browser agent needs, while dark
    expect(lamp(set, 5).say).toEqual({ key: 'features.patchbay.lamp.agent.laterTab', vars: { agent: 'Tessera-Spiegel', when: 'weekdays 07:30' } })
    expect(lamp(set, 6).say.key).toBe('features.patchbay.lamp.firstRun.later')
    // what 04 and 05 make: the ghosts' keys
    expect(lamp(set, 4).creates).toEqual([ghostKey('in-01', 'mirror', 'database'), ghostKey('in-01', 'mirror', 'page')])
    expect(lamp(set, 5).creates).toEqual([ghostKey('in-01', 'mirror', 'agent'), clockKey(TRIGGER)])
    expect(lamp(set, 1).creates).toBeUndefined()
  })

  test('00: no key → next ("no Claude key"); a key of another provider only → next, it names Claude; the rest stays as it is', () => {
    const none = one(profile(), facts({ key: { ok: false, why: 'no_key', last4: '' } }))
    wellFormed(none)
    expect(states(none)).toBe('next ok ok ok dark dark dark')
    expect(lamp(none, 0).say.key).toBe('features.patchbay.lamp.key.none')
    expect(keyLabel(lamp(none, 0))).toEqual({ key: 'features.patchbay.setup.key.key' })
    const other = one(profile(), facts({ key: { ok: false, why: 'route', last4: '' } }))
    wellFormed(other)
    expect(lamp(other, 0).state).not.toBe('ok')
    expect(lamp(other, 0).say.key).toBe('features.patchbay.lamp.key.route')
    expect(lamp(other, 0).action).toEqual({ kind: 'aiSetup', provider: 'anthropic' })
    // a green key without a hint still says where it is
    expect(lamp(one(profile(), facts({ key: { ok: true, last4: '' } })), 0).say.key).toBe('features.patchbay.lamp.key.okNoHint')
  })

  test('01: no server (add one — its ghost), switched off, sign-in run out, token refused; a green lamp that falls back is next again', () => {
    const missing = one(profile({ status: { active: false, reason: 'noServers' } }), facts({ servers: [] }))
    wellFormed(missing)
    expect(states(missing)).toBe('ok next dark dark dark dark dark')
    expect(lamp(missing, 1).say).toEqual({ key: 'features.patchbay.lamp.server.none', vars: { profile: 'IN-01' } })
    expect(lamp(missing, 1).action).toEqual({ kind: 'mcpSettings', add: true })
    expect(keyLabel(lamp(missing, 1))).toEqual({ key: 'features.patchbay.setup.key.serverAdd' })
    expect(lamp(missing, 1).creates).toEqual([ghostKey('in-01', 'mirror', 'server')])
    expect(lamp(missing, 2).say.key).toBe('features.patchbay.lamp.test.noServer')
    expect(lamp(missing, 3).say).toEqual({ key: 'features.patchbay.lamp.profile.noServers', vars: { profile: 'IN-01' } })

    const off = one(profile({ status: { active: false, reason: 'disabled', server: 'tracker' } }), facts({ servers: [server({ enabled: false, state: 'off' })] }))
    wellFormed(off)
    expect(states(off)).toBe('ok next dark dark dark dark dark')
    expect(lamp(off, 1).say).toEqual({ key: 'features.patchbay.lamp.server.off', vars: { server: 'tracker' } })
    expect(lamp(off, 1).action).toEqual({ kind: 'mcpSettings', server: 'srvTracker' })
    expect(lamp(off, 3).say.key).toBe('features.patchbay.lamp.profile.disabled')

    // it was green (mock-2): the sign-in ran out → 01 falls back and is next again
    const expired = one(profile(), facts({ servers: [server({ state: 'expired', access: 'signedIn' })] }))
    wellFormed(expired)
    expect(states(expired)).toBe('ok next dark ok dark dark dark')
    expect(lamp(expired, 1).say.key).toBe('features.patchbay.lamp.server.expired')
    for (const state of ['refusedTest', 'refusedTab'] as const) {
      const refused = one(profile(), facts({ servers: [server({ state })] }))
      wellFormed(refused)
      expect(lamp(refused, 1).say.key).toBe('features.patchbay.lamp.server.refused')
      expect(lamp(refused, 2).say.key).toBe('features.patchbay.lamp.test.refused')
    }
    // an untested server is set up (not "connected"); signed in / no token say so
    expect(lamp(one(profile(), facts({ servers: [server({ state: 'untested', tools: null, reads: null, access: 'none' })] })), 1).say.key).toBe('features.patchbay.lamp.server.set.none')
    expect(lamp(one(profile(), facts({ servers: [server({ access: 'signedIn' })] })), 1).say.key).toBe('features.patchbay.lamp.server.connected.signedIn')
    // of several servers the lamps speak of the working one
    expect(pickServer([server({ id: 'a', name: 'tracker-old', enabled: false, state: 'off' }), server({ id: 'b', state: 'untested' }), server({ id: 'c' })])?.id).toBe('c')
    expect(pickServer([server({ id: 'a', enabled: false, state: 'off' }), server({ id: 'b', state: 'untested' })])?.id).toBe('b')
  })

  test('02: untested, failed, a test running (busy — no other lamp is next), tools the profile asks for missing; the trace "busy → ok"', () => {
    const untested = one(profile({ status: { active: false, reason: 'untested', server: 'tracker' } }), facts({ servers: [server({ state: 'untested', tools: null, reads: null })] }))
    wellFormed(untested)
    expect(states(untested)).toBe('ok ok next dark dark dark dark')
    expect(lamp(untested, 2).say).toEqual({ key: 'features.patchbay.lamp.test.untested', vars: { server: 'tracker' } })
    expect(lamp(untested, 2).action).toEqual({ kind: 'mcpTest', server: 'srvTracker' })
    expect(keyLabel(lamp(untested, 2))).toEqual({ key: 'features.patchbay.setup.key.test' })
    expect(lamp(untested, 3).say.key).toBe('features.patchbay.lamp.profile.untested')

    const failed = one(profile(), facts({ servers: [server({ state: 'failed' })] }))
    wellFormed(failed)
    expect(lamp(failed, 2).say.key).toBe('features.patchbay.lamp.test.failed')

    const busy = one(profile({ status: { active: false, reason: 'untested', server: 'tracker' } }), facts({ servers: [server({ state: 'untested', testing: true, tools: null, reads: null })] }))
    wellFormed(busy)
    expect(states(busy)).toBe('ok ok busy dark dark dark dark')
    expect(busy.next?.n).toBe(2)
    expect(busy.lamps.some((l) => l.state === 'next')).toBe(false)
    expect(lamp(busy, 2).say).toEqual({ key: 'features.patchbay.lamp.test.busy', vars: { server: 'tracker' } })
    // a re-test of a green server runs: busy again
    expect(lamp(one(profile(), facts({ servers: [server({ testing: true })] })), 2).state).toBe('busy')

    const tools = one(profile({ status: { active: false, reason: 'tools', server: 'tracker', missing: ['list_items'] } }), facts())
    wellFormed(tools)
    expect(states(tools)).toBe('ok ok next dark dark dark dark')
    expect(lamp(tools, 2).say).toEqual({ key: 'features.patchbay.lamp.test.missing', vars: { server: 'tracker', missing: 'list_items' } })
    expect(lamp(tools, 3).say).toEqual({ key: 'features.patchbay.lamp.profile.tools', vars: { profile: 'IN-01', server: 'tracker', missing: 'list_items' } })

    const at = Date.UTC(2026, 9, 9, 14, 19)
    const traced = one(profile(), facts({ traces: { test: at } }))
    expect(lamp(traced, 2).trace).toEqual({ from: 'busy', to: 'ok', at })
    // a trace only on a green lamp
    expect(lamp(one(profile(), facts({ traces: { test: at }, servers: [server({ state: 'failed' })] })), 2).trace).toBeUndefined()
    // a tested server without a reading tool
    expect(lamp(one(profile(), facts({ servers: [server({ tools: ['post_status'], reads: [] })] })), 2).say).toEqual({ key: 'features.patchbay.lamp.test.okNoReads.one', vars: { n: 1 } })
  })

  test('03: the profile inactive by name / host / tools / no conditions — its own sentence, Integrations opens it', () => {
    for (const reason of ['name', 'host', 'noConditions'] as const) {
      const set = one(profile({ status: { active: false, reason } }), facts({ servers: [] }))
      wellFormed(set)
      expect(lamp(set, 3).say).toEqual({ key: `features.patchbay.lamp.profile.${reason}`, vars: { profile: 'IN-01' } })
      expect(lamp(set, 3).state).toBe('dark')
    }
    // name / host match while the profile's tools are missing: 00–02 green would be odd — 02 is next and says so
    const tools = one(profile({ status: { active: false, reason: 'tools', server: 'tracker', missing: ['a', 'b'] } }), facts())
    expect(lamp(tools, 3).say.vars).toEqual({ profile: 'IN-01', server: 'tracker', missing: 'a, b' })
    // active: n unlocked · m recipes — no recipe, one, two
    expect(lampsOf(profile({ recipes: [] }), facts())[0].lamps[3].say).toEqual({ key: 'features.patchbay.lamp.profile.ok.none', vars: { unlocked: 6, n: 0 } })
    expect(lampsOf(profile({ recipes: [recipe(), recipe({ recipeId: 'mirror-2' })] }), facts())[0].lamps[3].say).toEqual({ key: 'features.patchbay.lamp.profile.ok', vars: { unlocked: 6, n: 2 } })
    const green = one(profile(), facts())
    expect(keyLabel(lamp(green, 3))).toEqual({ key: 'features.patchbay.setup.key.open' })
  })

  test('04: made → green with its report; in the trash → next, "restore" (MirrorSetup restores it)', () => {
    const made = one(profile({ recipes: [recipe({ database: { id: 'dbHandoff', name: 'Tessera Handoff' }, report: { id: 'pgBericht', title: 'Bericht' }, agent: { draft: 'agDraft' } })] }), facts())
    wellFormed(made)
    expect(states(made)).toBe('ok ok ok ok ok next dark')
    expect(lamp(made, 4).say).toEqual({ key: 'features.patchbay.lamp.database.ok', vars: { db: 'Tessera Handoff', report: 'Bericht' } })
    expect(lamp(made, 4).creates).toBeUndefined()

    const trashed = one(profile({ recipes: [recipe({ database: { id: 'dbHandoff', name: 'Tessera Handoff', trashed: true }, report: { id: 'pgBericht', title: 'Bericht' }, agent: { id: 'agTessera' } })] }), facts())
    wellFormed(trashed)
    expect(states(trashed)).toBe('ok ok ok ok next ok dark')
    expect(lamp(trashed, 4).say).toEqual({ key: 'features.patchbay.lamp.database.trashed', vars: { db: 'Tessera Handoff', report: 'Bericht' } })
    expect(lamp(trashed, 4).action).toEqual({ kind: 'mirrorSetup', profile: 'in-01', recipe: 'mirror' })
    expect(keyLabel(lamp(trashed, 4))).toEqual({ key: 'features.patchbay.setup.key.databaseOpen' })
    // a database in the trash is a ghost again on the rack
    expect(lamp(trashed, 4).creates).toEqual([ghostKey('in-01', 'mirror', 'database')])
  })

  test('05: the draft kept → the editor opens it; the draft lost → 05 is next and reopens MirrorSetup ("Use …"); saved → green', () => {
    const base = { database: { id: 'dbHandoff', name: 'Tessera Handoff' }, report: { id: 'pgBericht', title: 'Bericht' } }
    const kept = one(profile({ recipes: [recipe({ ...base, agent: { draft: 'agDraft' } })] }), facts())
    expect(lamp(kept, 5).state).toBe('next')
    expect(lamp(kept, 5).say).toEqual({ key: 'features.patchbay.lamp.agent.draftTab', vars: { agent: 'Tessera-Spiegel', when: 'weekdays 07:30' } })
    expect(lamp(kept, 5).action).toEqual({ kind: 'agentEditor', agent: 'agDraft' })
    expect(keyLabel(lamp(kept, 5))).toEqual({ key: 'features.patchbay.setup.key.agent' })

    const lost = one(profile({ recipes: [recipe({ ...base, agent: { draftLost: true } })] }), facts())
    wellFormed(lost)
    expect(states(lost)).toBe('ok ok ok ok ok next dark')
    expect(lamp(lost, 5).say).toEqual({ key: 'features.patchbay.lamp.agent.lost', vars: { agent: 'Tessera-Spiegel', when: 'weekdays 07:30' } })
    expect(lamp(lost, 5).action).toEqual({ kind: 'mirrorSetup', profile: 'in-01', recipe: 'mirror' })
    expect(keyLabel(lamp(lost, 5))).toEqual({ key: 'features.patchbay.setup.key.agentAgain' })

    const saved = one(profile({ recipes: [madeAll({ total: 0, open: 0 })] }), facts())
    expect(lamp(saved, 5).state).toBe('ok')
    expect(lamp(saved, 5).say.key).toBe('features.patchbay.lamp.agent.okTab')
    expect(lamp(saved, 5).action).toEqual({ kind: 'agentEditor', agent: 'agTessera' })
    // a server agent runs without this browser: no "only while open" sentence
    expect(lamp(one(profile({ recipes: [madeAll({ total: 0, open: 0 }, { runner: 'server' })] }), facts()), 5).say.key).toBe('features.patchbay.lamp.agent.ok')
    expect(lamp(saved, 5).creates).toBeUndefined()
  })

  test('06: runs not read yet (busy), none (run by hand), running, proposals open (review), failed, all decided (green)', () => {
    const reading = one(profile({ recipes: [madeAll(null)] }), facts())
    wellFormed(reading)
    expect(states(reading)).toBe('ok ok ok ok ok ok busy')
    expect(lamp(reading, 6).say.key).toBe('features.patchbay.lamp.firstRun.reading')

    const none = one(profile({ recipes: [madeAll({ total: 0, open: 0 })] }), facts())
    wellFormed(none)
    expect(states(none)).toBe('ok ok ok ok ok ok next')
    expect(lamp(none, 6).say.key).toBe('features.patchbay.lamp.firstRun.start')
    expect(lamp(none, 6).action).toEqual({ kind: 'runAgent', agent: 'agTessera' })
    expect(keyLabel(lamp(none, 6))).toEqual({ key: 'features.patchbay.setup.key.firstRun' })
    // apply mode: nothing to review — the result
    expect(lamp(one(profile({ recipes: [madeAll({ total: 0, open: 0 }, { write: 'apply' })] }), facts()), 6).say.key).toBe('features.patchbay.lamp.firstRun.startDirect')

    const running = one(profile({ recipes: [madeAll({ total: 1, open: 0, running: true })] }), facts())
    expect(lamp(running, 6).state).toBe('busy')
    expect(lamp(running, 6).say).toEqual({ key: 'features.patchbay.lamp.firstRun.running', vars: { agent: 'Tessera-Spiegel' } })

    const staged = one(profile({ recipes: [madeAll({ total: 1, open: 3 })] }), facts())
    wellFormed(staged)
    expect(states(staged)).toBe('ok ok ok ok ok ok next')
    expect(lamp(staged, 6).say).toEqual({ key: 'features.patchbay.lamp.firstRun.review', vars: { n: 3 } })
    expect(lamp(staged, 6).action).toEqual({ kind: 'review', agent: 'agTessera' })
    expect(keyLabel(lamp(staged, 6))).toEqual({ key: 'features.patchbay.setup.key.review' })
    expect(lamp(one(profile({ recipes: [madeAll({ total: 1, open: 1 })] }), facts()), 6).say.key).toBe('features.patchbay.lamp.firstRun.review.one')

    const failed = one(profile({ recipes: [madeAll({ total: 1, open: 0, failed: true })] }), facts())
    expect(lamp(failed, 6).state).toBe('next')
    expect(lamp(failed, 6).say.key).toBe('features.patchbay.lamp.firstRun.failed')

    const done = one(profile({ recipes: [madeAll({ total: 2, open: 0 })] }), facts())
    wellFormed(done)
    expect(states(done)).toBe('ok ok ok ok ok ok ok')
    expect(done.done).toBe(7)
    expect(done.next).toBeNull()
    expect(lamp(done, 6).say).toEqual({ key: 'features.patchbay.lamp.firstRun.ok', vars: { n: 2 } })
    expect(lamp(done, 6).action).toEqual({ kind: 'review', agent: 'agTessera' })
  })

  test('0 recipes → the 4 lamps 00–03; 2 recipes → two sets, each with its own 04–06 and one lamp worked on', () => {
    const none = lampsOf(profile({ recipes: [] }), facts())
    expect(none).toHaveLength(1)
    expect(none[0].recipe).toBeNull()
    expect(none[0].lamps.map((l) => l.id)).toEqual(['key', 'server', 'test', 'profile'])
    expect(states(none[0])).toBe('ok ok ok ok')
    wellFormed(none[0])
    const noneNoKey = lampsOf(profile({ recipes: [] }), facts({ key: { ok: false, why: 'no_key', last4: '' } }))[0]
    wellFormed(noneNoKey)
    expect(states(noneNoKey)).toBe('next ok ok ok')

    const two = lampsOf(profile({ recipes: [recipe(), { ...madeAll({ total: 1, open: 2 }), recipeId: 'mirror-2' }] }), facts())
    expect(two.map((s) => s.recipe)).toEqual(['mirror', 'mirror-2'])
    for (const s of two) wellFormed(s)
    expect(states(two[0])).toBe('ok ok ok ok next dark dark')
    expect(states(two[1])).toBe('ok ok ok ok ok ok next')
    // 00–03 are the same lamps in both sets; 04–06 carry their recipe
    expect(two[1].lamps.slice(0, 4)).toEqual(two[0].lamps.slice(0, 4))
    expect(two[1].lamps.slice(4).every((l) => l.recipe === 'mirror-2')).toBe(true)
    expect(two[0].lamps[4].action).toEqual({ kind: 'mirrorSetup', profile: 'in-01', recipe: 'mirror' })
    expect(setOf(two, 'mirror-2')).toBe(two[1])
    expect(setOf(two, null)).toBe(two[0])
    expect(setOf(two, 'gone')).toBe(two[0])
    expect(setOf([], 'mirror')).toBeNull()
  })

  test('a clock another agent already starts on is no ghost: 05 makes only the agent', () => {
    const r = recipe()
    const clock = clockKey(TRIGGER)!
    expect(clock).toBe(moduleKey({ kind: 'clock', schedule: scheduleKey(TRIGGER), agents: [] }))
    expect(createsOf(profile(), r, { servers: [server()], existing: new Set([clock]) }).agent).toEqual([ghostKey('in-01', 'mirror', 'agent')])
    expect(createsOf(profile(), r, { servers: [server()] }).agent).toEqual([ghostKey('in-01', 'mirror', 'agent'), clock])
    // a manual agent has no clock
    expect(clockKey({ type: 'manual' })).toBeNull()
  })
})

test.describe('setup ghosts — ghostsOf (§3.7, mock-2)', () => {
  test('mock-2: tracker and the inbox real, clock / agent / database / report ghosts, 5 planned cables — keys = the lamps’ creates', () => {
    const r = recipe()
    const plan = ghostsOf('in-01', r)
    expect(plan.ghosts).toBe(4)
    expect(plan.planned).toBe(5)
    const byKind = Object.fromEntries(plan.modules.map((m) => [m.kind, m]))
    expect(Object.keys(byKind).sort()).toEqual(['agent', 'clock', 'database', 'inbox', 'page', 'server'])
    expect(byKind.server.key).toBe(moduleKey({ kind: 'server', id: 'srvTracker', name: 'tracker' }))
    expect(byKind.server.tags).not.toContain('ghost')
    expect(byKind.inbox.key).toBe('inbox:notes')
    expect(byKind.inbox.tags).not.toContain('ghost')
    for (const k of ['clock', 'agent', 'database', 'page']) expect(byKind[k].tags, k).toContain('ghost')
    // every module carries the profile; the ghosts' ids are ghost ids
    expect(plan.modules.every((m) => m.profile === 'in-01' && m.tags.includes('profile'))).toBe(true)
    expect(isGhostId((byKind.database.ref as { id: string }).id)).toBe(true)
    // the keys the lamps name as what they make
    const set = one(profile({ recipes: [r] }), facts())
    expect(lamp(set, 4).creates).toEqual([byKind.database.key, byKind.page.key])
    expect(lamp(set, 5).creates).toEqual([byKind.agent.key, byKind.clock.key])
    // names: the recipe's (mirrorTitles fills RecipeFacts); chips: the lamps that touch them
    expect(plan.names[byKind.database.key]).toBe('Tessera Handoff')
    expect(plan.names[byKind.page.key]).toBe('Tessera Handoff · Bericht')
    expect(plan.names[byKind.agent.key]).toBe('Tessera-Spiegel')
    expect(plan.names[byKind.clock.key]).toBe('weekdays 07:30')
    expect(plan.names[byKind.server.key]).toBeUndefined()
    expect(plan.chips[byKind.server.key]).toEqual([1, 2])
    expect(plan.chips[byKind.database.key]).toEqual([4])
    expect(plan.chips[byKind.agent.key]).toEqual([5, 6])
    // the agent: 2U (3 jacks out), its knobs
    expect(byKind.agent.u).toBe(2)
    expect(byKind.agent.knobs).toEqual({ model: null, budgetUsd: 3 })
    expect(byKind.agent.inJacks.map((j) => j.role)).toEqual(['tools', 'start'])
    expect(byKind.agent.outJacks.map((j) => j.role)).toEqual(['writes', 'report', 'notes'])
    // the planned cables: READ → agent, clock → agent, agent → database (solid: a mirror writes its own database), report, notes
    expect(plan.edges.map((e) => [e.kind, e.from.split('.').pop(), e.to.split('.').pop()])).toEqual([
      ['reads', 'read', 'tools'],
      ['starts', 'start', 'start'],
      ['writes', 'writes', 'writes'],
      ['writes', 'report', 'writes'],
      ['writes', 'notes', 'writes'],
    ])
    expect(plan.edges.every((e) => e.planned && !e.can)).toBe(true)
    expect(plan.edges.map((e) => e.id)).toEqual(plan.edges.map((e) => `${e.from}>${e.to}`))
    // without notes (the profile does not unlock notify / the job names no notify_me): no inbox, 4 cables
    const quiet = ghostsOf('in-01', recipe({ agent: { notes: false } }))
    expect(quiet.modules.some((m) => m.kind === 'inbox')).toBe(false)
    expect(quiet.planned).toBe(4)
    // no server yet: a ghost server too (01 makes it)
    const bare = ghostsOf('in-01', recipe({ servers: [] }))
    expect(bare.ghosts).toBe(5)
    expect(bare.modules.find((m) => m.kind === 'server')?.key).toBe(ghostKey('in-01', 'mirror', 'server'))
  })

  test('every part made: no ghost, and no cable the model does not draw itself (mock 1’s mirror — the model’s own keys)', () => {
    const w = mock1()
    const model = modelOf(w)
    const keys = new Set(model.modules.map((m) => m.key))
    const edges = new Set(model.edges.map((e) => e.id))
    const a = w.ws.agents![w.ids.mirror]
    const r = recipe({
      database: { id: w.ids.handoff, name: 'Tessera Handoff' },
      report: { id: w.ids.bericht, title: 'Bericht' },
      runs: { total: 1, open: 0 },
      agent: { id: a.id, trigger: a.trigger, budgetUsd: a.maxRunUsd },
    })
    const plan = ghostsOf('in-01', r, { existing: keys, edges })
    expect(plan.ghosts).toBe(0)
    expect(plan.planned).toBe(0)
    // every module it names is one the model drew, by the same key
    for (const m of plan.modules) expect(keys.has(m.key), m.key).toBe(true)
    // the lamps make nothing any more
    const set = one(profile({ recipes: [r] }), facts({ existing: keys }))
    expect(set.lamps.some((l) => l.creates)).toBe(false)
    expect(states(set)).toBe('ok ok ok ok ok ok ok')
    // the same recipe without the model's edges: every cable would be planned — the ids are the model's
    const unwired = ghostsOf('in-01', r, { existing: keys })
    for (const e of unwired.edges) expect(edges.has(e.id), e.id).toBe(true)
    expect(unwired.planned).toBe(5)
  })
})

test.describe('words — every sentence and key label a lamp can show exists in EN and DE', () => {
  test('a matrix of states: each say / key label key is in messages-setup.ts in both languages, with the same braces', () => {
    const keys = new Set<string>()
    const keyFacts: KeyFacts[] = [KEY_OK, { ok: true, last4: '' }, { ok: false, why: 'no_key', last4: '' }, { ok: false, why: 'route', last4: '' }]
    const servers: ServerFacts[][] = [
      [],
      ...(['off', 'untested', 'ok', 'refusedTest', 'refusedTab', 'expired', 'failed'] as const).flatMap((state) =>
        (['signedIn', 'token', 'none'] as const).map((access) => [server({ state, access, enabled: state !== 'off' })]),
      ),
      [server({ testing: true })],
      [server({ reads: [], tools: ['post_status'] })],
      [server({ reads: [], tools: ['post_status', 'add_comment'] })],
      [server({ reads: ['get_issue'] })],
    ]
    const statuses: ProfileFacts['status'][] = [
      { active: true, server: 'tracker' },
      { active: false, reason: 'noConditions' },
      { active: false, reason: 'noServers' },
      { active: false, reason: 'name' },
      { active: false, reason: 'host' },
      { active: false, reason: 'disabled', server: 'tracker' },
      { active: false, reason: 'untested', server: 'tracker' },
      { active: false, reason: 'tools', server: 'tracker', missing: ['x'] },
    ]
    const runs: RecipeSetup['runs'][] = [null, { total: 0, open: 0 }, { total: 1, open: 1 }, { total: 2, open: 3 }, { total: 1, open: 0, running: true }, { total: 1, open: 0, failed: true }, { total: 1, open: 0 }, { total: 2, open: 0 }]
    const recipes: RecipeSetup[][] = [
      [],
      [recipe()],
      [recipe({ agent: { runner: 'server', write: 'apply' } })],
      [recipe({ database: { id: 'db', name: 'D', trashed: true }, report: { id: 'pg', title: 'R' } })],
      [recipe({ database: { id: 'db', name: 'D' } })],
      [recipe({ database: { id: 'db', name: 'D' }, report: { id: 'pg', title: 'R' }, agent: { draft: 'd' } })],
      [recipe({ database: { id: 'db', name: 'D' }, report: { id: 'pg', title: 'R' }, agent: { draft: 'd', runner: 'server' } })],
      [recipe({ database: { id: 'db', name: 'D' }, report: { id: 'pg', title: 'R' }, agent: { draftLost: true } })],
      ...runs.map((r) => [madeAll(r)]),
      ...runs.map((r) => [madeAll(r, { runner: 'server', write: 'apply' })]),
      [recipe(), recipe({ recipeId: 'mirror-2' })],
    ]
    for (const key of keyFacts)
      for (const srv of servers)
        for (const status of statuses)
          for (const rs of recipes)
            for (const set of lampsOf(profile({ status, recipes: rs }), facts({ key, servers: srv })))
              for (const l of set.lamps) {
                keys.add(l.say.key)
                const label = keyLabel(l)
                if (label) keys.add(label.key)
              }
    expect(keys.size).toBeGreaterThan(60)
    const braces = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
    for (const k of keys) {
      expect(setupMessages.en[k], `en ${k}`).toBeTruthy()
      expect(setupMessages.de[k], `de ${k}`).toBeTruthy()
      expect(braces(setupMessages.de[k]), k).toBe(braces(setupMessages.en[k]))
    }
    // German says "KI", never "AI"; neither language names a provider other than Claude
    for (const [k, v] of Object.entries(setupMessages.de)) expect(v, k).not.toMatch(/\bAI\b/)
    for (const lang of ['en', 'de'] as const) for (const [k, v] of Object.entries(setupMessages[lang])) expect(v, k).not.toMatch(/openrouter|openai|\bgpt\b/i)
  })
})

test.describe('the way back and the keys', () => {
  test('readReturnValue: ids of this member scope only — junk, another scope, a wrong id or lamp read as none', () => {
    const rec = { profileId: 'in-01', recipeId: 'mirror', next: 'test', scope: 'local:local', away: true, at: 5 }
    expect(readReturnValue(JSON.stringify(rec), 'local:local')).toEqual(rec)
    expect(readReturnValue(JSON.stringify({ ...rec, recipeId: undefined, away: undefined }), 'local:local')).toEqual({ profileId: 'in-01', next: 'test', scope: 'local:local', away: false, at: 5 })
    expect(readReturnValue(JSON.stringify(rec), 'cloud:W1:u:A')).toBeNull()
    expect(readReturnValue(JSON.stringify(rec), null)).toBeNull()
    expect(readReturnValue('{', 'local:local')).toBeNull()
    expect(readReturnValue(null, 'local:local')).toBeNull()
    expect(readReturnValue('[]', 'local:local')).toBeNull()
    expect(readReturnValue(JSON.stringify({ ...rec, next: 'nope' }), 'local:local')).toBeNull()
    expect(readReturnValue(JSON.stringify({ ...rec, profileId: 'IN 01 <b>' }), 'local:local')).toBeNull()
    expect(readReturnValue(JSON.stringify({ ...rec, recipeId: 5 }), 'local:local')).toBeNull()
    expect(readReturnValue(JSON.stringify({ ...rec, at: 'x', extra: '<script>' }), 'local:local')).toEqual({ ...rec, at: 0 })
  })

  test('lamp numbers and ghost keys pass the router’s module-key check', () => {
    expect([0, 4, 6].map(lampNo)).toEqual(['00', '04', '06'])
    const PB_MODULE = /^[a-z][a-zA-Z]{1,15}:[A-Za-z0-9_.:%~-]{1,400}$/
    for (const what of ['server', 'database', 'page', 'agent'] as const) expect(ghostKey('in-01', 'mirror-2', what)).toMatch(PB_MODULE)
    expect(ghostKey('in-01', 'mirror', 'database')).toBe('database:~in-01~mirror~database')
    expect(isGhostId('dbHandoff')).toBe(false)
  })
})
