/**
 * The Patchbay's live core (B13 · plan §1.6, §1.7, §6 A24 / A25) — the run bus, the tally, the dot paths, the money,
 * the announcements. UI-free: the comets, windows and lamps are B14's.
 *
 * Node (the pure parts — live/runs.ts, legs.ts, core.ts, costs.ts, announce.ts — on the mock-1 rack of
 * tests/fixtures/patchbay.ts):
 *  - the tally: a run counts once per (writer kind, run id) — the AI menu's second note with meta adds nothing (and the AI
 *    menu is no module), mail organise / autofill's own run tell more without counting again; autofill's watch counts
 *    one per note without meta (its note with meta fills that slot, or — today's watch — is a fill of its own); an
 *    agent's review apply goes on, never starts; the day's record merges two writers' starts and skips a run another
 *    tab counted; the day rolls at local midnight;
 *  - the dot paths: a person flips „Weiterleiten“ → net → tc → hook; after Inbox-Helfer's write the hop agent → net
 *    comes first; Tessera-Spiegel's run: clock → agent → database (its start leg waits for the trigger, its write waits
 *    with it); legs follow each other 600 ms apart, ≤ 12 wait;
 *  - the LED: autofill's watch ends after 10 s idle, a run with an id on its end; red after an error, amber over its
 *    budget, "held" never red;
 *  - costsByModule: "≈" only for estimates, unpriced counted apart, the header = drawn modules only;
 *  - announcements: one start + one end per run, throttled (10 s per module, 3 s overall), none per tick.
 * Browser (the app, `?e2e`):
 *  - two tabs count into one record without losing a start; the ledger is not opened at boot; no live listener runs
 *    while the route is closed (the spy), they all go when it closes; the first write of a day drops older days; a wipe
 *    takes the record along;
 *  - mock 1 live: a person's write fires „An Team-Chat“ (the webhook answered by a local route) → net → tc → hook; an
 *    agent run through the recorder's seam → clock → agent → database; the tally counts each once.
 * Every name is fictional; every host is `*.example`.
 */
import { test, expect, openApp, waitForApp, wsEval } from './fixtures'
import type { Page as PwPage } from '@playwright/test'
import type { CostSource } from '../../src/shared/ai/types'
import type { Page } from '../../src/app/store/types'
import { formatWriterKey, type RunNote, type Writer } from '../../src/app/store/writer'
import { moduleKey, scheduleKey } from '../../src/app/features/patchbay/ref'
import { addToTally, dayOf, isTally, moduleOfKey, moduleOfWriter, nextMidnight, RunBook, startOfDay, sumRuns, type WriterLookups } from '../../src/app/features/patchbay/live/runs'
import { exitLegs, legIndex, startLegs, writeLegs } from '../../src/app/features/patchbay/live/legs'
import { IDLE_MS, LEG_CAP, LEG_MS, LiveCore, type LiveLeg } from '../../src/app/features/patchbay/live/core'
import { costsByModule, sumCosts, withEntry, type CostEntry } from '../../src/app/features/patchbay/live/costs'
import { Announcer, announcementText, OVERALL_MS, PER_MODULE_MS } from '../../src/app/features/patchbay/live/announce'
import { messages as liveMessages } from '../../src/app/features/patchbay/messages-live'
import { exits, mock1, modelOf, page as pbPage, seedPatchbay, type PbWorld } from '../fixtures/patchbay'

/* ------------------------------------------------------------------ keys of mock 1 */

const M = {
  toChat: moduleKey({ kind: 'automation', db: 'dbMails', id: 'autToChat' }),
  toContact: moduleKey({ kind: 'automation', db: 'dbMails', id: 'autToContact' }),
  inbox: moduleKey({ kind: 'agent', id: 'agInbox' }),
  mirror: moduleKey({ kind: 'agent', id: 'agTessera' }),
  hook: moduleKey({ kind: 'outbound', exit: 'webhook', host: 'chat.example', method: 'POST', by: [] }),
  handoff: moduleKey({ kind: 'database', id: 'dbHandoff' }),
  clock: moduleKey({ kind: 'clock', schedule: scheduleKey({ type: 'schedule', every: 'weekday', at: '07:30', tz: 'Europe/Berlin' }), agents: [] }),
  weekly: moduleKey({ kind: 'script', id: 'scWeekly' }),
}
const NET_FWD = 'net:dbMails:pMailFwd'
const E = {
  netToChat: `${NET_FWD}>${M.toChat}.start`,
  chatToHook: `${M.toChat}.out>${M.hook}.out`,
  inboxToNet: `${M.inbox}.writes>${NET_FWD}`,
  clockToMirror: `${M.clock}.start>${M.mirror}.start`,
  mirrorToHandoff: `${M.mirror}.writes>${M.handoff}.writes`,
}

const LOOK: WriterLookups = {
  taskDb: (task) => (task === 'rowTask1' ? 'dbCoding' : null),
  mailDb: () => 'dbMails',
  kitIn: (type, db) => (type === 'ptPunkte' && (db === null || db === 'dbTessera') ? 'kit:dbTessera:pTesseraPunkte' : null),
}

const note = (w: Writer, meta?: RunNote['meta'], end?: true): RunNote => ({ w, ...(meta ? { meta } : {}), ...(end ? { end } : {}) })

/** How many starts a book reads from these notes, per module. */
function starts(book: RunBook, notes: RunNote[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const n of notes) {
    const r = book.read(n)
    if (r?.start) out[r.module] = (out[r.module] ?? 0) + 1
  }
  return out
}

/** The English words of the live strings (Node: no translator module). */
const tEn = (key: string, vars: Record<string, string | number> = {}) => (liveMessages.en[key] ?? key).replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))

/* ================================================================== Node */

test.describe('B13 · the tally — runs.ts (§1.6, §6 A24 / A25)', () => {
  test('once per (writer kind, run id): a note that tells more adds nothing; the AI menu is no module', () => {
    const book = new RunBook(LOOK)
    const menu: Writer = { kind: 'ai', run: 'aiRun1', action: 'accept' }
    // the AI menu's apply: aiWriterOf notes the route with meta — twice for two accepts of one run
    expect(starts(book, [note(menu, { ai: 'p:m' }), note(menu, { ai: 'p:m' })])).toEqual({})
    // mail organise: the job's note, then noteMailAI's with meta — one run
    const organise: Writer = { kind: 'ai', run: 'orgRun1', action: 'mail_organise' }
    expect(starts(book, [note(organise), note(organise, { ai: 'p:m' }), note(organise, undefined, true)])).toEqual({ 'organise:dbMails': 1 })
    // autofill run by the person: its note, then writeProposal's per row with meta — one run
    const fill: Writer = { kind: 'autofill', db: 'dbLeads', prop: 'pLeadSummary', run: 'fill1', cause: 'you~ui' }
    expect(starts(book, [note(fill), note(fill, { ai: 'p:m' }), note(fill, { ai: 'p:m' }), note(fill, { ai: 'p:m' })])).toEqual({ 'autofill:dbLeads:pLeadSummary': 1 })
    // an automation, a script, the bridge, a sync, a coding task: once per run
    const au: Writer = { kind: 'automation', db: 'dbMails', id: 'autToChat', run: 'au1', cause: 'you~ui' }
    const sc: Writer = { kind: 'script', id: 'scWeekly', run: 'sc1' }
    const mcp: Writer = { kind: 'mcp', session: 's1', call: 'c1', tool: 'one_update_page' }
    const sync: Writer = { kind: 'sync', source: 'github', run: 'gh1' }
    const coding: Writer = { kind: 'coding', task: 'rowTask1', run: 'cd1' }
    expect(starts(book, [note(au), note(au), note(sc), note(sc), note(mcp, { tool: 'one_update_page' }), note(sync, { source: 'github' }), note(sync, { source: 'github' }), note(coding)])).toEqual({
      [M.toChat]: 1,
      [M.weekly]: 1,
      'bridge:here': 1,
      'sync:github': 1,
      'pipeline:dbCoding': 1,
    })
    // a run's end is no start; the terminal, an import, the person are no modules
    expect(book.read(note(au, undefined, true))).toMatchObject({ module: M.toChat, end: true, start: false })
    expect(starts(book, [note({ kind: 'terminal', run: 't1' }), note({ kind: 'import', run: 'i1', source: 'md' }), note({ kind: 'you', via: 'ui' })])).toEqual({})
  })

  test("an agent starts with the runner's seq; a review applying its proposals (no seq) goes on; a replay never starts", () => {
    const book = new RunBook(LOOK)
    const run1: Writer = { kind: 'agent', id: 'agTessera', run: 'r1' }
    expect(starts(book, [note(run1, { seq: 1 }), note(run1, { seq: 1 }), note(run1)])).toEqual({ [M.mirror]: 1 })
    // yesterday's run reviewed today (review.ts: noteRun(writer) — "the run goes on")
    expect(starts(book, [note({ kind: 'agent', id: 'agTessera', run: 'rYesterday' })])).toEqual({})
    expect(starts(book, [note({ kind: 'agent', id: 'agTessera', run: 'r2', remote: true }, { seq: 2 })])).toEqual({})
  })

  test("autofill's watch: one per note without meta; a note with meta fills that slot, or is a fill of its own", () => {
    const book = new RunBook(LOOK)
    const watch: Writer = { kind: 'autofill', db: 'dbLeads', prop: 'pLeadSummary', cause: 'agent:agInbox:r1' }
    // three fills that note first, each telling more after it
    expect(starts(book, [note(watch), note(watch), note(watch), note(watch, { ai: 'p:m' }), note(watch, { ai: 'p:m' }), note(watch, { ai: 'p:m' })])).toEqual({ 'autofill:dbLeads:pLeadSummary': 3 })
    // today's watch: writeProposal notes with meta only — each is a fill
    expect(starts(book, [note(watch, { ai: 'p:m' }), note(watch, { ai: 'p:m' })])).toEqual({ 'autofill:dbLeads:pLeadSummary': 2 })
  })

  test('which module a writer or a cause is — kit relays, folded scripts, pipelines, repeating clocks', () => {
    expect(moduleOfKey(formatWriterKey({ kind: 'agent', id: 'agInbox', run: 'r1', change: 'c2+c3' }), LOOK)).toBe(M.inbox)
    expect(moduleOfKey(formatWriterKey({ kind: 'automation', db: 'dbLaunch', id: 'autFreigabe', run: 'a1', cause: 'agent:agLaunchA:r9' }), LOOK)).toBe('automation:dbLaunch:autFreigabe')
    expect(moduleOfKey(formatWriterKey({ kind: 'autofill', db: 'dbLeads', prop: 'pLeadSummary' }), LOOK)).toBe('autofill:dbLeads:pLeadSummary')
    expect(moduleOfKey(formatWriterKey({ kind: 'kit', type: 'ptPunkte', cause: 'agent:agTesseraServer:r1@r' }), LOOK, { db: 'dbTessera' })).toBe('kit:dbTessera:pTesseraPunkte')
    expect(moduleOfKey(formatWriterKey({ kind: 'mcp', session: 's', call: 'c', tool: 'one_update_page' }), LOOK)).toBe('bridge:here')
    expect(moduleOfKey(formatWriterKey({ kind: 'coding', task: 'rowTask1', run: 'r' }), LOOK)).toBe('pipeline:dbCoding')
    for (const k of ['you~ui:e2e', 'editor:ed1', 'system:bookkeeping', 'team', 'member:acc1', 'unknown', '']) expect(moduleOfKey(k, LOOK)).toBeNull()
    // a script folded into its automation is the automation's
    expect(moduleOfWriter({ kind: 'script', id: 'scContact', run: 'r' }, { ...LOOK, foldOf: (id) => (id === 'scContact' ? M.toContact : null) })).toBe(M.toContact)
    // a repeating template's rows: its clock (the database is the write's)
    expect(moduleOfWriter({ kind: 'template', id: 'tplWeek', run: 'r', repeat: true }, LOOK, { db: 'dbMeet' })).toBe('clock:t:dbMeet:tplWeek')
    expect(moduleOfWriter({ kind: 'template', id: 'tplWeek', run: 'r' }, LOOK, { db: 'dbMeet' })).toBeNull()
  })

  test("the day's record: two writers merge, a run another tab counted is skipped, the day rolls at local midnight", () => {
    const a = addToTally(undefined, [
      { module: M.toChat, at: 10, seen: 'automation:a1' },
      { module: M.toChat, at: 20, seen: 'automation:a2' },
    ])
    // the other tab's update runs on the stored record (one transaction): its own run counts, the shared one not again
    const b = addToTally(a, [
      { module: M.toChat, at: 30, seen: 'automation:b1' },
      { module: M.toChat, at: 25, seen: 'automation:a2' },
      { module: 'autofill:dbLeads:pLeadSummary', at: 40 },
      { module: 'autofill:dbLeads:pLeadSummary', at: 41 },
    ])
    expect(b.n).toEqual({ [M.toChat]: 3, 'autofill:dbLeads:pLeadSummary': 2 })
    expect(b.last).toEqual({ [M.toChat]: 30, 'autofill:dbLeads:pLeadSummary': 41 })
    expect(isTally(b)).toBe(true)
    expect(isTally({ n: { x: -1 }, last: {} })).toBe(false)
    expect(addToTally({ junk: true }, []).n).toEqual({})
    // "RUNS TODAY n" sums the drawn modules only
    expect(sumRuns(b, [M.toChat])).toBe(3)
    expect(sumRuns(b, [M.toChat, M.toChat, 'agent:none'])).toBe(3)
    // seen keeps the newest 1000
    const many = addToTally(undefined, Array.from({ length: 1200 }, (_, i) => ({ module: M.toChat, at: i, seen: `automation:x${i}` })))
    expect(many.seen.length).toBe(1000)
    expect(many.n[M.toChat]).toBe(1200)
    // the local day: a second before midnight counts into that day, a second after into the next
    const eve = new Date(2026, 9, 12, 23, 59, 59).getTime()
    expect(dayOf(eve)).toBe('2026-10-12')
    expect(dayOf(eve + 2000)).toBe('2026-10-13')
    expect(nextMidnight(eve)).toBe(new Date(2026, 9, 13).getTime())
    expect(startOfDay(eve)).toBe(new Date(2026, 9, 12).getTime())
  })
})

test.describe('B13 · dot paths — legs.ts + core.ts on mock 1 (§1.7)', () => {
  const model = modelOf(mock1())
  const ix = legIndex(model)
  const T0 = 1_000_000

  test('a person flips „Weiterleiten“: net → tc → hook, 600 ms apart', () => {
    const legs: LiveLeg[] = []
    const core = new LiveCore({ onLeg: (l) => legs.push(l) })
    core.setModel(model)
    core.begin(M.toChat, 'run1', T0, { start: true, how: { from: null, via: 'row', place: { db: 'dbMails', prop: 'pMailFwd' } } })
    core.exit(M.toChat, 'run1', M.hook, T0 + 120)
    core.end(M.toChat, 'run1', T0 + 200)
    expect(legs.map((l) => l.edgeId)).toEqual([E.netToChat, E.chatToHook])
    expect(legs[1].at - legs[0].at).toBe(LEG_MS)
    // the pure lookups agree
    expect(startLegs(ix, M.toChat, { via: 'row', place: { db: 'dbMails', prop: 'pMailFwd' } })).toEqual([E.netToChat])
    expect(exitLegs(ix, M.toChat, M.hook)).toEqual([E.chatToHook])
  })

  test("after Inbox-Helfer's write the hop comes first: agent → net → tc → hook", () => {
    const legs: LiveLeg[] = []
    const core = new LiveCore({ onLeg: (l) => legs.push(l) })
    core.setModel(model)
    // the agent's write of the field lights its own cable into the flag
    core.begin(M.inbox, 'rIn', T0, { start: true, defer: true })
    core.write(M.inbox, 'rIn', [{ db: 'dbMails', props: ['pMailFwd'] }], T0 + 5)
    core.resolve(M.inbox, 'rIn', { via: 'row', place: { db: 'dbMails', prop: '+row' } }, T0 + 6)
    core.end(M.inbox, 'rIn', T0 + 10)
    // the new mail row started it (from outside: the row trigger), then its write went into the flag
    expect(legs.map((l) => l.edgeId)).toEqual([`rowTrigger:dbMails:created:-.start>${M.inbox}.start`, E.inboxToNet])
    // the automation it started (cause = the agent's writer key): writer → flag → automation, then the way out
    core.begin(M.toChat, 'run2', T0 + 1500, { start: true, how: { from: moduleOfKey('agent:agInbox:rIn', LOOK), via: 'row', place: { db: 'dbMails', prop: 'pMailFwd' } } })
    core.exit(M.toChat, 'run2', M.hook, T0 + 1600)
    expect(legs.slice(2).map((l) => l.edgeId)).toEqual([E.inboxToNet, E.netToChat, E.chatToHook])
    expect(legs.slice(2).map((l) => l.at - (T0 + 1500))).toEqual([0, 600, 1200])
  })

  test("Tessera-Spiegel's run: clock → agent → database — its write waits for the trigger; the clock FIRED", () => {
    const legs: LiveLeg[] = []
    const core = new LiveCore({ onLeg: (l) => legs.push(l) })
    core.setModel(model)
    core.begin(M.mirror, 'rM', T0, { start: true, defer: true })
    // the write comes before the run record says how it started (the recorder seam's step, a fast agent)
    core.write(M.mirror, 'rM', [{ db: 'dbHandoff', props: ['pHandoffStatus'] }], T0 + 1)
    expect(legs).toEqual([])
    core.resolve(M.mirror, 'rM', { via: 'clock' }, T0 + 2)
    expect(legs.map((l) => l.edgeId)).toEqual([E.clockToMirror, E.mirrorToHandoff])
    expect(core.snapshot().fired[M.clock]).toBe(T0 + 2)
    expect(core.snapshot().modules[M.mirror]).toMatchObject({ state: 'running', since: T0, run: 'rM' })
    expect(core.snapshot().hot.sort()).toEqual([E.clockToMirror, E.mirrorToHandoff].sort())
    // the report page and a new row: the cable to the page; nothing for a write of an undrawn place
    expect(writeLegs(ix, M.mirror, [{ page: 'pgBericht' }])).toEqual([`${M.mirror}.report>page:pgBericht.writes`])
    expect(writeLegs(ix, M.toChat, [{ page: 'pgBericht' }])).toEqual([])
    core.end(M.mirror, 'rM', T0 + 4000)
    expect(core.snapshot().modules[M.mirror].state).toBe('idle')
    expect(core.snapshot().hot).toEqual([])
    // the FIRED window closes after 60 s
    core.tick(T0 + 62_002)
    expect(core.snapshot().fired).toEqual({})
  })

  test('legs wait in order per run, at most 12 (the oldest go); a played leg leaves the queue', () => {
    const core = new LiveCore()
    core.setModel(model)
    for (let i = 0; i < 20; i++) {
      core.begin(M.toChat, `r${i}`, T0, { how: { via: 'row', place: { db: 'dbMails', prop: 'pMailFwd' } } })
      core.exit(M.toChat, `r${i}`, M.hook, T0)
    }
    expect(core.snapshot().legs.length).toBe(LEG_CAP)
    core.tick(T0 + LEG_MS * 3)
    expect(core.snapshot().legs.every((l) => l.at + LEG_MS > T0 + LEG_MS * 3)).toBe(true)
  })
})

test.describe('B13 · the LED — core.ts (§1.7, §6 A24)', () => {
  const T0 = 2_000_000

  test("autofill's watch never ends a run: its LED goes out after 10 s without a note or a write", () => {
    const model = modelOf(exits())
    const fill = moduleKey({ kind: 'autofill', db: 'dbLeads', prop: 'pLeadSummary' })
    expect(model.modules.some((m) => m.key === fill)).toBe(true)
    const core = new LiveCore()
    core.setModel(model)
    core.begin(fill, null, T0, { start: true })
    core.tick(T0 + IDLE_MS - 1)
    expect(core.snapshot().modules[fill].state).toBe('running')
    // a write of the watch at 5 s keeps it on until 15 s
    core.write(fill, null, [{ db: 'dbLeads', props: ['pLeadSummary'] }], T0 + 5000)
    core.tick(T0 + 5000 + IDLE_MS - 1)
    expect(core.snapshot().modules[fill].state).toBe('running')
    core.tick(T0 + 5000 + IDLE_MS)
    expect(core.snapshot().modules[fill]).toMatchObject({ state: 'idle', since: null })
    expect(core.nextDue()).not.toBeNull()
  })

  test('a run with an id ends on its end — a long silent run stays on; red after an error, amber over budget, held never red', () => {
    const model = modelOf(mock1())
    const core = new LiveCore()
    core.setModel(model)
    core.begin(M.mirror, 'r1', T0, { start: true })
    core.tick(T0 + 60_000)
    expect(core.snapshot().modules[M.mirror].state).toBe('running')
    core.end(M.mirror, 'r1', T0 + 61_000, 'error')
    expect(core.snapshot().modules[M.mirror].state).toBe('error')
    // the next run clears the lamp while it runs
    core.begin(M.mirror, 'r2', T0 + 70_000, { start: true })
    expect(core.snapshot().modules[M.mirror].state).toBe('running')
    core.end(M.mirror, 'r2', T0 + 71_000, 'budget')
    expect(core.snapshot().modules[M.mirror].state).toBe('budget')
    core.begin(M.mirror, 'r3', T0 + 80_000, {})
    core.end(M.mirror, 'r3', T0 + 81_000, 'held')
    expect(core.snapshot().modules[M.mirror].state).toBe('held')
    core.begin(M.mirror, 'r4', T0 + 90_000, {})
    core.end(M.mirror, 'r4', T0 + 91_000, 'staged', { proposals: 3 })
    expect(core.snapshot().modules[M.mirror]).toMatchObject({ state: 'idle', proposals: 3 })
    // a failed webhook action makes its run end red
    core.begin(M.toChat, 'a1', T0, { how: { via: 'row', place: { db: 'dbMails', prop: 'pMailFwd' } } })
    core.exit(M.toChat, 'a1', M.hook, T0 + 10, true)
    core.end(M.toChat, 'a1', T0 + 20)
    expect(core.snapshot().modules[M.toChat].state).toBe('error')
    // another tab's run: LED and window from its stored start, no dot
    core.begin(M.inbox, 'rOther', T0 + 100, { start: true, since: T0 - 4000, elsewhere: true })
    expect(core.snapshot().modules[M.inbox]).toMatchObject({ state: 'running', since: T0 - 4000, elsewhere: true })
    core.write(M.inbox, 'rOther', [{ db: 'dbMails', props: ['pMailFwd'] }], T0 + 200)
    expect(core.snapshot().legs.filter((l) => l.run.startsWith(M.inbox))).toEqual([])
  })
})

test.describe('B13 · money — costs.ts (§1.6)', () => {
  const entry = (source: string, usd: number | null, costSource: CostSource = 'reported'): CostEntry => ({ source, usd, costSource })

  test('per module and per run: "≈" only for an estimate, unpriced counted apart, the header = drawn modules only', () => {
    const model = modelOf(mock1())
    const drawn = model.modules.filter((m) => !m.idle).map((m) => m.key)
    const foldOf = (id: string) => model.modules.find((m) => m.folds?.script === id)?.key ?? null
    const entries = [
      entry('agent:agTessera:r1', 0.12),
      entry('agent:agTessera:r1', 0.09, 'estimate'),
      entry('agent:agTessera:r2', null, 'none'),
      entry('autofill:dbLeads:pLeadSummary:job1', null, 'none'),
      entry('autofill:dbLeads:pLeadSummary:job1', 0.4),
      entry('script:scWeekly:s1', 0.01),
      entry('script:scContact:s2', 0.03),
      entry('mail:m1', 0.02),
      entry('terminal:conv1:t1', 5),
      entry('outbox:draft1', 0.5),
      entry('ai:run1:accept', 0.7),
    ]
    const book = costsByModule(entries, { mailDb: 'dbMails', foldOf })
    const near = (c: { usd: number; estimate: boolean; unpriced: number } | undefined, usd: number, estimate: boolean, unpriced: number) => {
      expect(c?.usd).toBeCloseTo(usd, 9)
      expect(c).toMatchObject({ estimate, unpriced })
    }
    near(book.modules[M.mirror], 0.21, true, 1)
    near(book.runs['agent:agTessera:r1'], 0.21, true, 0)
    expect(book.runs['agent:agTessera:r2']).toEqual({ usd: 0, estimate: false, unpriced: 1 })
    expect(book.modules['autofill:dbLeads:pLeadSummary']).toEqual({ usd: 0.4, estimate: false, unpriced: 1 })
    expect(book.modules[M.weekly]).toEqual({ usd: 0.01, estimate: false, unpriced: 0 })
    // a folded script's money is its automation's
    expect(book.modules[M.toContact]).toEqual({ usd: 0.03, estimate: false, unpriced: 0 })
    expect(book.modules['organise:dbMails']).toEqual({ usd: 0.02, estimate: false, unpriced: 0 })
    // the terminal, the AI menu and a draft whose route is unknown are no module
    expect(book.elsewhere.usd).toBeCloseTo(6.2, 6)
    // the header: drawn modules only (mock 1 has no autofill and no organise on the rack)
    const head = sumCosts(book.modules, drawn)
    expect(head.usd).toBeCloseTo(0.25, 6)
    expect(head).toMatchObject({ estimate: true, unpriced: 1 })
    expect(sumCosts(book.modules, [M.weekly])).toEqual({ usd: 0.01, estimate: false, unpriced: 0 })
    // the meter adds one entry without touching the old book
    const more = withEntry(book, entry('agent:agTessera:r1', 0.05), { mailDb: 'dbMails', foldOf })
    expect(more.modules[M.mirror].usd).toBeCloseTo(0.26, 6)
    expect(book.modules[M.mirror].usd).toBeCloseTo(0.21, 6)
    // an Outbox route the caller knows
    expect(costsByModule([entry('outbox:slip1', 0.1)], { outbox: (id) => (id === 'slip1' ? 'outbox:in-01:reply' : null) }).modules['outbox:in-01:reply']).toEqual({ usd: 0.1, estimate: false, unpriced: 0 })
  })
})

test.describe('B13 · announcements — announce.ts + core.ts (§1.7, §6 U6)', () => {
  test('throttled: 10 s per module, 3 s overall; a quick end never swallows its start; at most two wait per module', () => {
    const a = new Announcer()
    const T = 5_000_000
    expect(a.nextAt()).toBeNull()
    a.push(M.toChat, 'start')
    // nothing said yet: due at once (the glue's timer must fire — a non-finite time would stop it)
    expect(a.nextAt()).toBe(0)
    // the run ends before anything was said: its start is still said first
    a.push(M.toChat, 'end')
    expect(a.take(T)).toMatchObject({ module: M.toChat, say: 'start' })
    a.push(M.mirror, 'start')
    expect(a.take(T + 1000)).toBeNull()
    expect(a.take(T + OVERALL_MS)).toMatchObject({ module: M.mirror, say: 'start' })
    expect(a.take(T + OVERALL_MS + 1)).toBeNull()
    expect(a.nextAt()).toBe(T + PER_MODULE_MS)
    expect(a.take(T + PER_MODULE_MS)).toMatchObject({ module: M.toChat, say: 'end' })
    // a module that runs every second: the first word and the newest wait, nothing piles up
    for (let i = 0; i < 6; i++) {
      a.push(M.weekly, 'start')
      a.push(M.weekly, i === 5 ? 'failed' : 'end')
    }
    expect(a.pending).toBe(2)
    expect(a.take(T + PER_MODULE_MS + OVERALL_MS)).toMatchObject({ module: M.weekly, say: 'start' })
    expect(a.take(T + 2 * PER_MODULE_MS)).toBeNull()
    expect(a.take(T + 2 * PER_MODULE_MS + OVERALL_MS)).toMatchObject({ module: M.weekly, say: 'failed' })
    expect(a.pending).toBe(0)
    expect(announcementText({ say: 'start' }, 'Inbox-Helfer', tEn)).toBe('Inbox-Helfer running')
    expect(announcementText({ say: 'end', proposals: 3 }, 'Inbox-Helfer', tEn)).toBe('Inbox-Helfer done · 3 proposals')
    expect(announcementText({ say: 'end', proposals: 1 }, 'Inbox-Helfer', tEn)).toBe('Inbox-Helfer done · 1 proposal')
    expect(announcementText({ say: 'end' }, 'Inbox-Helfer', tEn)).toBe('Inbox-Helfer done')
    expect(announcementText({ say: 'held' }, 'Inbox-Helfer', tEn)).toBe('Inbox-Helfer held')
    for (const k of Object.keys(liveMessages.en)) expect(liveMessages.de[k], k).toBeTruthy()
    expect(Object.values(liveMessages.de).join(' ')).not.toMatch(/\bAI\b|Trigger|Vertrauen/)
  })

  test('one start + one end per run — none per note, per write or per tick', () => {
    const model = modelOf(mock1())
    const core = new LiveCore()
    core.setModel(model)
    const said: Array<{ module: string; say: string }> = []
    let last = 0
    const T = 9_000_000
    const tick = (t: number) => {
      core.tick(t)
      const a = core.snapshot().announce
      if (a && a.id !== last) {
        last = a.id
        said.push({ module: a.module, say: a.say })
      }
    }
    core.begin(M.mirror, 'r1', T, { start: true, defer: true })
    expect(core.nextDue()).toBe(0)
    core.resolve(M.mirror, 'r1', { via: 'clock' }, T)
    for (let i = 0; i < 20; i++) {
      core.begin(M.mirror, 'r1', T + i * 100, { start: true })
      core.write(M.mirror, 'r1', [{ db: 'dbHandoff', props: ['pHandoffStatus'] }], T + i * 100 + 50)
    }
    for (let t = T; t < T + 4000; t += 100) tick(t)
    core.end(M.mirror, 'r1', T + 4000, 'staged', { proposals: 3 })
    // the running window ticks every second for a minute: nothing more is said
    for (let t = T + 4000; t <= T + 64_000; t += 250) tick(t)
    expect(said).toEqual([
      { module: M.mirror, say: 'start' },
      { module: M.mirror, say: 'end' },
    ])
    expect(core.snapshot().announce).toMatchObject({ say: 'end', proposals: 3 })
  })
})

/* ================================================================== browser */

type Seam = {
  start: () => void
  flush: () => Promise<void>
  tally: (day?: string) => Promise<{ n: Record<string, number>; last: Record<string, number>; seen: string[] }>
  pending: () => number
  stats: () => { loaded: boolean; active: number; calls: number }
  snapshot: () => { open: boolean; runs: Record<string, number>; modules: Record<string, { state: string }>; costs: Record<string, { usd: number; estimate: boolean; unpriced: number }>; runCosts: Record<string, unknown>; costsRead: boolean; announce: { module: string; say: string } | null } | null
  legLog: () => LiveLeg[]
  wipe: (scope?: string | null) => Promise<void>
}

const live = <R>(p: PwPage, fn: (s: Seam) => R | Promise<R>): Promise<R> =>
  p.evaluate(
    ({ src }) => {
      const s = (window as unknown as { __onePatchbayLive: unknown }).__onePatchbayLive
      // eslint-disable-next-line no-new-func
      return new Function('s', `return (${src})(s)`)(s)
    },
    { src: fn.toString() },
  ) as Promise<R>

const ledgerOpens = (p: PwPage) => p.evaluate(() => (window as unknown as { __oneLedger: { opens: () => number } }).__oneLedger.opens())

/** Run notes of one automation (each its own run), each flushed at once — the two tabs' updates interleave. */
async function fireRuns(p: PwPage, prefix: string, n: number, shared?: string): Promise<void> {
  await p.evaluate(
    async ({ prefix, n, shared }) => {
      const rec = (window as unknown as { __oneRecorder: { step: (s: unknown) => Promise<unknown> } }).__oneRecorder
      const bus = (window as unknown as { __onePatchbayLive: { flush: () => Promise<void> } }).__onePatchbayLive
      const ids = Array.from({ length: n }, (_, i) => `${prefix}${i}`)
      if (shared) ids.push(shared)
      for (const run of ids) {
        await rec.step({ writer: { kind: 'automation', db: 'dbNordlicht', id: 'autZaehler', run }, calls: [], note: true, end: true })
        await bus.flush()
      }
    },
    { prefix, n, shared },
  )
}

const COUNTER = 'automation:dbNordlicht:autZaehler'

test.describe('B13 · the run bus in the app — bus.ts, live.ts', () => {
  test('two tabs count into one record; the ledger stays shut at boot; nothing live runs while the route is closed', async ({ page, context, errors }) => {
    await openApp(page)
    const other = await context.newPage()
    errors.watch(other)
    await openApp(other)
    expect(await ledgerOpens(page)).toBe(0)
    for (const p of [page, other]) await live(p, (s) => s.start())
    expect(await live(page, (s) => s.stats())).toEqual({ loaded: false, active: 0, calls: 0 })

    // 30 runs in each tab at once (each flushed on its own, so the updates interleave) and one run both tabs note
    await Promise.all([fireRuns(page, 'a', 30, 'shared1'), fireRuns(other, 'b', 30, 'shared1')])
    const [mine, theirs] = await Promise.all([live(page, (s) => s.tally()), live(other, (s) => s.tally())])
    expect(mine.n[COUNTER]).toBe(61)
    expect(theirs.n[COUNTER]).toBe(61)
    expect(mine.seen.filter((x) => x === 'automation:shared1')).toHaveLength(1)
    // counting never opened the ledger (nor read the page map: the bus reads ids only)
    expect(await ledgerOpens(page)).toBe(0)
    expect(await ledgerOpens(other)).toBe(0)
    expect(await live(page, (s) => s.stats().loaded)).toBe(false)

    // the route opens: the live listeners come (their chunk loads now), today's money is read once
    await page.evaluate(() => (window.location.hash = '#/patchbay'))
    await expect.poll(() => live(page, (s) => s.stats().active)).toBeGreaterThan(5)
    await expect.poll(() => live(page, (s) => s.snapshot()?.costsRead ?? false)).toBe(true)
    expect(await ledgerOpens(page)).toBe(1)
    const runsOpen = async () => (await live(page, (s) => s.snapshot()?.runs ?? {}))[COUNTER] ?? 0
    await expect.poll(runsOpen).toBe(61)
    // a run noted here counts at once on the open page
    await fireRuns(page, 'c', 1)
    await expect.poll(runsOpen).toBe(62)

    // the route closes: every live listener goes; notes and writes call none of them
    await page.evaluate(() => (window.location.hash = '#/'))
    await expect.poll(() => live(page, (s) => s.stats().active)).toBe(0)
    const before = await live(page, (s) => s.stats().calls)
    const someId = await wsEval(page, (s) => (Object.values(s.pages) as Array<{ id: string; databaseId: string | null; trashed: boolean }>).find((p) => !p.databaseId && !p.trashed)!.id)
    await page.evaluate(async (id) => {
      const rec = (window as unknown as { __oneRecorder: { step: (s: unknown) => Promise<unknown> } }).__oneRecorder
      for (let i = 0; i < 5; i++) await rec.step({ writer: { kind: 'agent', id: 'agNordlicht', run: `rClosed${i}` }, note: { seq: i + 1 }, calls: [['updatePage', id, { icon: null }]], end: true })
    }, someId)
    await page.waitForTimeout(400)
    expect(await live(page, (s) => s.stats().calls)).toBe(before)
    expect(await live(page, (s) => s.snapshot()?.open)).toBe(false)
    // …while the tally still counted them (it is always on)
    await live(page, (s) => s.flush())
    expect((await live(page, (s) => s.tally())).n['agent:agNordlicht']).toBe(5)
    await other.close()
  })

  test('the first write of a day drops older days; a wipe takes the record along', async ({ page }) => {
    await openApp(page)
    await live(page, (s) => s.start())
    await fireRuns(page, 'd', 2)
    // an older day's record of this scope (and another scope's, which stays)
    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('one-patchbay')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const tx = req.result.transaction('kv', 'readwrite')
          tx.objectStore('kv').put({ v: 1, n: { x: 4 }, last: { x: 1 }, seen: [] }, 'local:local|runs|2026-01-02')
          tx.objectStore('kv').put({ v: 1, n: { x: 4 }, last: { x: 1 }, seen: [] }, 'cloud:W9:u:A|runs|2026-01-02')
          tx.oncomplete = () => {
            req.result.close()
            resolve()
          }
        }
      })
    })
    const keysNow = () =>
      page.evaluate(
        () =>
          new Promise<string[]>((resolve) => {
            const req = indexedDB.open('one-patchbay')
            req.onsuccess = () => {
              const k = req.result.transaction('kv', 'readonly').objectStore('kv').getAllKeys()
              k.onsuccess = () => {
                resolve((k.result as string[]).sort())
                req.result.close()
              }
            }
          }),
      )
    const today = await page.evaluate(() => {
      const d = new Date()
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })
    expect(await keysNow()).toEqual(['cloud:W9:u:A|runs|2026-01-02', 'local:local|runs|2026-01-02', `local:local|runs|${today}`])
    // this tab pruned today already: a new session (reload) prunes on its first write of the day
    await page.reload()
    await waitForApp(page)
    await live(page, (s) => s.start())
    await fireRuns(page, 'e', 1)
    await expect.poll(keysNow).toEqual(['cloud:W9:u:A|runs|2026-01-02', `local:local|runs|${today}`])
    expect((await live(page, (s) => s.tally())).n[COUNTER]).toBe(3)
    // the wipe (as B9 wires it: what waits goes, then the records)
    await live(page, (s) => s.wipe())
    expect((await live(page, (s) => s.tally())).n).toEqual({})
    expect(await keysNow()).toEqual(['cloud:W9:u:A|runs|2026-01-02'])
  })
})

/** Mock 1 as the browser seeds it: its rows, the agents that would run by themselves held still. */
function liveWorld(): PbWorld {
  const w = mock1()
  const now = Date.now()
  // Inbox-Helfer off (its cables stay: an agent is a decider whatever `enabled` says), „Neue Mail → Kontakt“ off —
  // the seeded mail row starts nobody; Tessera-Spiegel changed just now, so no schedule slot before it runs it
  w.ws.agents = {
    ...w.ws.agents,
    agInbox: { ...w.ws.agents!.agInbox, enabled: false },
    agTessera: { ...w.ws.agents!.agTessera, updatedAt: now },
  }
  const mails = w.ws.databases.dbMails
  w.ws.databases = { ...w.ws.databases, dbMails: { ...mails, automations: mails.automations!.map((a) => (a.id === 'autToContact' ? { ...a, enabled: false } : a)) } }
  const row = (id: string, db: string, title: string, properties: Page['properties']) => pbPage(id, { parentId: db, databaseId: db, title, properties })
  w.ws.pages = { ...w.ws.pages, rowMail1: row('rowMail1', 'dbMails', 'Angebot Nordlicht', { pMailFwd: false, pMailFrom: 'Mara Lind' }), rowHandoff1: row('rowHandoff1', 'dbHandoff', 'TESS-1', { pHandoffKey: 'TESS-1' }) }
  return w
}

test.describe('B13 · mock 1 live — the dot paths in the app', () => {
  test("a person's write fires „An Team-Chat“: net → tc → hook; an agent run through the seam: clock → agent → database", async ({ page }) => {
    const hooks: string[] = []
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, PUT, OPTIONS' }
    await page.context().route('https://chat.example/**', (route) => {
      const req = route.request()
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      hooks.push(req.method())
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: '{"ok":true}' })
    })
    await openApp(page)
    await seedPatchbay(page, liveWorld())
    await live(page, (s) => s.start())
    await page.evaluate(() => (window.location.hash = '#/patchbay'))
    await expect.poll(() => live(page, (s) => s.stats().active)).toBeGreaterThan(5)
    await expect.poll(() => page.evaluate(() => !!(window as unknown as { __onePatchbay?: { model: () => unknown } }).__onePatchbay?.model())).toBe(true)

    // the person flips „Weiterleiten“ (the test's writer is the person's) → the automation fires after its quiet time
    await wsEval(page, (s) => s.setRowProperty('rowMail1', 'pMailFwd', true))
    await expect.poll(() => hooks.length, { timeout: 10_000 }).toBe(1)
    await expect.poll(async () => (await live(page, (s) => s.legLog())).map((l) => l.edgeId)).toEqual([E.netToChat, E.chatToHook])
    const chat = await live(page, (s) => s.legLog())
    expect(chat[1].at - chat[0].at).toBe(600)
    expect(chat[0].run).toBe(chat[1].run)
    // the screen reader hears the start once (its end waits out the module's 10 s)
    await expect.poll(() => live(page, (s) => s.snapshot()?.announce ?? null)).toMatchObject({ module: M.toChat, say: 'start' })

    // an agent run through the recorder's seam: its note, its write, its end in one go
    await page.evaluate(async () => {
      const rec = (window as unknown as { __oneRecorder: { step: (s: unknown) => Promise<unknown> } }).__oneRecorder
      await rec.step({ writer: { kind: 'agent', id: 'agTessera', run: 'rLive1' }, note: { seq: 1 }, calls: [['setRowProperty', 'rowHandoff1', 'pHandoffStatus', 'offen']], end: true })
    })
    await expect.poll(async () => (await live(page, (s) => s.legLog())).slice(2).map((l) => l.edgeId)).toEqual([E.clockToMirror, E.mirrorToHandoff])
    // each run counted once (the automation's own `set` of lastRunAt / the bookkeeping writes count nothing)
    await live(page, (s) => s.flush())
    const tally = await live(page, (s) => s.tally())
    expect(tally.n).toMatchObject({ [M.toChat]: 1, [M.mirror]: 1 })
    expect(Object.values(tally.n).reduce((a, b) => a + b, 0)).toBe(2)
    await expect.poll(async () => (await live(page, (s) => s.snapshot()?.runs ?? {}))[M.mirror] ?? 0).toBe(1)

    // the run's money as the meter hears it (this tab): the module's today and the run's own
    await page.evaluate(() => {
      const ledger = (window as unknown as { __oneLedger: { meter: (e: unknown) => void; scope: () => string | null } }).__oneLedger
      ledger.meter({
        id: 'lgLive1',
        at: Date.now(),
        scope: ledger.scope(),
        purpose: 'agents.run',
        cls: 'workspace',
        source: 'agent:agTessera:rLive1',
        role: 'main',
        route: 'anthropic:fixture-model',
        served: { p: 'anthropic', model: 'fixture-model' },
        classes: ['page'],
        usage: { input: 1000, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, output: 200, reasoning: 0 },
        usd: 0.03,
        costSource: 'table',
        priceAt: '2026-10-12',
        mcpCalls: 0,
        outcome: 'ok',
      })
    })
    await expect.poll(() => live(page, (s) => JSON.stringify([s.snapshot()?.costs['agent:agTessera'] ?? null, s.snapshot()?.runCosts['agent:agTessera:rLive1'] ?? null]))).toBe(JSON.stringify([{ usd: 0.03, estimate: false, unpriced: 0 }, { usd: 0.03, estimate: false, unpriced: 0 }]))
  })
})
