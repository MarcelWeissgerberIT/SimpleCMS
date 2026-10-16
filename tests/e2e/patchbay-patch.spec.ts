/**
 * The Patchbay ("Schaltplan") — B15, the patch core (features/patchbay/patch.ts; plan §1.13, §1.14, §2.9, §6 A20 A22
 * A23), run by the Playwright runner in Node. Fixtures: tests/fixtures/patchbay.ts (`mock1()`) and
 * tests/fixtures/patchbay-patch.ts (the PatchCtx of a world, the world after writes, a recording sink).
 *  - every row of the matrix: what it writes (through which writer) and its EXACT inverse (the stored value);
 *  - every unplug: trigger → manual (the last start asks), automation off, its webhook / script / set_property action
 *    out, an own command (or one of its actions) out, mcpServers − s / narrowed to READ, scope − db, report off,
 *    outTools − tool;
 *  - refusals: a way out, another database, a locked database (re-wiring refused, a removal allowed), an untested
 *    server, targets in the trash in gone.ts' words, a mirror unplugged from its database, a mirror widened (asks), the
 *    default command (info), the OUT lock (non-admin with names / tools-only profile / full), viewers;
 *  - the "+F2" a WRITE? → agent plug opens (asked, in the preview); stored Unreadable fields survive; the last-start ask;
 *  - Undo: config fields only (bookkeeping is no change), "changed since", a locked database refuses putting back;
 *  - commitWrites: the writer frame (you~patchbay / you~undo), every boolean read, a refused write rolls back;
 *  - the automations reader (sanitizer, unreadable entries kept) and the lock rule (§1.14).
 * Every name is fictional (Nordlicht, Tessera, Mara Lind, Launch plan); every host `*.example`.
 */
import { test, expect, openApp, wsEval } from './fixtures'
import { acceptsRoles, canConnect, commitPlan, commitWrites, plan, targetsOf, undoPlan, withBookkeeping } from '../../src/app/features/patchbay/patch'
import { sayMsg } from '../../src/app/features/patchbay/plain'
import { messages as fuseMessages } from '../../src/app/features/patchbay/messages-fuses'
import { messages as agentMessages } from '../../src/app/features/agents/messages'
import { AGENT_LIMITS } from '../../src/app/store/agents'
import { buildModel } from '../../src/app/features/patchbay/model'
import { moduleKey, scheduleKey } from '../../src/app/features/patchbay/ref'
import { messages as patchMessages } from '../../src/app/features/patchbay/messages-patch'
import { messages as hintMessages } from '../../src/app/features/patchbay/messages-hint'
import { AUTOMATION_LIMITS, AUTOMATION_READ, lockRefusal, readAutomations, sanitizeAutomation, unreadableAutomations, unreadableCounts, webhookUrlOf } from '../../src/app/features/automations/read'
import { sanitizeAgent } from '../../src/app/store/agents'
import { sanitizeIntegrations } from '../../src/app/store/integrations'
import type { Patch, PatchPlan, PatchWrite, MsgRef } from '../../src/app/features/patchbay/types'
import type { Automation, CustomAgent, DbCommand, IntegrationProfile } from '../../src/app/store/types'
import { TRACKER_READS, automation, database, dbPage, exits, inputOf, mock1, modelOf, page, profile, prop, seedPatchbay, server, world, type PbWorld } from '../fixtures/patchbay'
import { TEAM } from '../fixtures/patchbay-fuses'
import { hasDefaultCommand, patchCtx, recordingSink, withWrites } from '../fixtures/patchbay-patch'

/* ------------------------------------------------------------------ helpers */

const P = 'features.patchbay'
const PP = `${P}.patch`
const k = moduleKey
const AG_INBOX = k({ kind: 'agent', id: 'agInbox' })
const AG_MIRROR = k({ kind: 'agent', id: 'agTessera' })
const TO_CHAT = k({ kind: 'automation', db: 'dbMails', id: 'autToChat' })
const TO_CONTACT = k({ kind: 'automation', db: 'dbMails', id: 'autToContact' })
const TRACKER = k({ kind: 'server', id: 'srvTracker', name: 'tracker' })
const KANAL = k({ kind: 'server', id: 'srvKanal', name: 'kanal' })
const ROWS_MAILS = k({ kind: 'rowTrigger', db: 'dbMails', event: 'created', prop: null })
const NET_FWD = 'net:dbMails:pMailFwd'
const CHAT_HOOK = 'outbound:webhook:chat.example:POST'
const MIRROR_CLOCK = k({ kind: 'clock', schedule: scheduleKey({ type: 'schedule', every: 'weekday', at: '07:30', tz: 'Europe/Berlin' }), agents: [] })

const plug = (from: Patch['from'], to: Patch['to']): Patch => ({ op: 'plug', from, to })
const unplugOf = (from: Patch['from'], to: Patch['to']): Patch => ({ op: 'unplug', from, to })
type Ok = Extract<PatchPlan, { writes: PatchWrite[] }>
type No = Extract<PatchPlan, { refused: MsgRef }>
function ok(p: PatchPlan): Ok {
  if ('refused' in p) throw new Error(`refused: ${JSON.stringify(p.refused)}`)
  return p
}
function no(p: PatchPlan): No {
  if (!('refused' in p)) throw new Error(`planned: ${JSON.stringify(p.writes)}`)
  return p
}
const planOn = (w: PbWorld, patch: Patch, over: Parameters<typeof patchCtx>[1] = {}) => plan(patch, patchCtx(w, over))
const agentWrite = (p: Ok, i = 0) => (p.writes[i] as Extract<PatchWrite, { w: 'agent' }>).agent
const agentInverse = (p: Ok, i = 0) => (p.inverse[i] as Extract<PatchWrite, { w: 'agent' }>).agent
const listWrite = (p: Ok, i = 0) => (p.writes[i] as Extract<PatchWrite, { w: 'automations' | 'commands' }>).list
const listInverse = (p: Ok, i = 0) => (p.inverse[i] as Extract<PatchWrite, { w: 'automations' | 'commands' }>).list
/** Only `keys` of an object changed between a and b (the rest deep-equal). */
function onlyChanged(a: object, b: object, keys: string[]) {
  const ra = a as Record<string, unknown>
  const rb = b as Record<string, unknown>
  for (const key of new Set([...Object.keys(ra), ...Object.keys(rb)])) if (!keys.includes(key)) expect(rb[key], key).toEqual(ra[key])
}
/** A mock-1 world with changes to its workspace parts. */
function mock1With(change: (w: PbWorld) => void): PbWorld {
  const w = mock1()
  w.ws = { ...w.ws, agents: { ...w.ws.agents }, databases: { ...w.ws.databases }, pages: { ...w.ws.pages } }
  change(w)
  return w
}

/* ------------------------------------------------------------------ the matrix */

test.describe('B15 · the matrix: what each cable writes, and its exact inverse', () => {
  test('clock → agent start: trigger = the schedule; inverse = the stored agent', () => {
    const w = mock1()
    const p = ok(planOn(w, plug({ module: MIRROR_CLOCK, role: 'start' }, { module: AG_INBOX, role: 'start' })))
    expect(p.writes.map((x) => x.w)).toEqual(['agent'])
    expect(agentWrite(p).trigger).toEqual({ type: 'schedule', every: 'weekday', at: '07:30', tz: 'Europe/Berlin' })
    onlyChanged(w.ws.agents!.agInbox, agentWrite(p), ['trigger'])
    expect(agentInverse(p)).toBe(w.ws.agents!.agInbox)
    // the preview holds the change (the same pure core as the app's input)
    expect(p.preview.agents.find((a) => a.agent.id === 'agInbox')?.agent.trigger.type).toBe('schedule')
  })

  test('row trigger / § 01 net flag → agent start: row_created / row_changed { db, prop }', () => {
    const w = mock1()
    const created = ok(planOn(w, plug({ module: ROWS_MAILS, role: 'start' }, { module: AG_MIRROR, role: 'start' })))
    expect(agentWrite(created).trigger).toEqual({ type: 'row_created', databaseId: 'dbMails' })
    expect(agentInverse(created)).toBe(w.ws.agents!.agTessera)
    const changed = ok(planOn(w, plug({ module: NET_FWD, role: 'start' }, { module: AG_MIRROR, role: 'start' })))
    expect(agentWrite(changed).trigger).toEqual({ type: 'row_changed', databaseId: 'dbMails', propertyId: 'pMailFwd' })
    // the same start again: nothing to do
    const again = no(planOn(w, plug({ module: ROWS_MAILS, role: 'start' }, { module: AG_INBOX, role: 'start' })))
    expect(again).toMatchObject({ refused: { key: `${PP}.already` }, info: true })
  })

  test('net flag → automation start (same database): its trigger; bookkeeping kept, inverse = the stored list', () => {
    const w = mock1With((w) => {
      const db = w.ws.databases.dbMails
      w.ws.databases.dbMails = { ...db, automations: db.automations!.map((a) => (a.id === 'autToContact' ? { ...a, lastRunAt: 42, lastStatus: 'ok' as const, lastMessage: 'ok' } : a)) }
    })
    const p = ok(planOn(w, plug({ module: NET_FWD, role: 'start' }, { module: TO_CONTACT, role: 'start' })))
    expect(p.writes).toHaveLength(1)
    expect(p.writes[0]).toMatchObject({ w: 'automations', db: 'dbMails' })
    const after = listWrite(p) as Automation[]
    expect(after.find((a) => a.id === 'autToContact')).toMatchObject({ trigger: { type: 'property_changed', propertyId: 'pMailFwd' }, lastRunAt: 42, lastStatus: 'ok' })
    expect(after.find((a) => a.id === 'autToChat')).toEqual((listInverse(p) as Automation[]).find((a) => a.id === 'autToChat'))
    expect(listInverse(p)).toEqual(readAutomations(w.ws.databases.dbMails.automations))
  })

  test('database rows → agent / script start: an own command; inverse = the stored command list (defaults kept)', () => {
    const w = mock1With((w) => {
      w.ws.databases.dbKontakte = { ...w.ws.databases.dbKontakte, commands: [{ id: 'new-entry', kind: 'default', hidden: true }] }
    })
    const toAgent = ok(planOn(w, plug({ module: k({ kind: 'database', id: 'dbKontakte' }), role: 'rows' }, { module: AG_MIRROR, role: 'start' })))
    expect(toAgent.writes[0]).toMatchObject({ w: 'commands', db: 'dbKontakte' })
    expect(listWrite(toAgent)).toEqual([{ id: 'new-entry', kind: 'default', hidden: true }, { id: 'cmdPatched', kind: 'agent', label: '', icon: null, config: { agentId: 'agTessera' } }])
    expect(listInverse(toAgent)).toEqual([{ id: 'new-entry', kind: 'default', hidden: true }])
    const toScript = ok(planOn(w, plug({ module: k({ kind: 'database', id: 'dbKontakte' }), role: 'rows' }, { module: k({ kind: 'script', id: 'scWeekly' }), role: 'start' })))
    expect((listWrite(toScript) as DbCommand[]).at(-1)).toEqual({ id: 'cmdPatched', kind: 'script', label: '', icon: null, config: { scriptId: 'scWeekly' } })
    // the command is drawn: Kontakte's command starts Tessera-Spiegel (by hand)
    const m = buildModel(toAgent.preview)
    expect(m.edges.some((e) => e.from === `${k({ kind: 'command', db: 'dbKontakte', command: 'cmdPatched' })}.start` && e.to === `${AG_MIRROR}.start` && e.byHand)).toBe(true)
  })

  test('server READ → agent tools: mcpServers += s, mcpTools[s] = READ; WRITE? → every tool (the allow-list goes)', () => {
    const w = mock1()
    const read = ok(planOn(w, plug({ module: TRACKER, role: 'read' }, { module: AG_INBOX, role: 'tools' })))
    expect(agentWrite(read)).toMatchObject({ mcpServers: ['tracker'], mcpTools: { tracker: TRACKER_READS } })
    onlyChanged(w.ws.agents!.agInbox, agentWrite(read), ['mcpServers', 'mcpTools'])
    expect(agentInverse(read)).toBe(w.ws.agents!.agInbox)
    // READ only adds no way out: nothing asked
    expect(read.asks).toBeUndefined()
    const write = ok(planOn(w, plug({ module: TRACKER, role: 'write' }, { module: AG_INBOX, role: 'tools' })))
    expect(agentWrite(write).mcpServers).toEqual(['tracker'])
    expect(agentWrite(write).mcpTools).toBeUndefined()
  })

  test('the preview fuse: WRITE? → Inbox-Helfer opens a new fuse — "+F2" is asked before, and is in the preview', () => {
    const w = mock1()
    const before = modelOf(w).fuses.map((f) => f.label)
    expect(before).toEqual(['F1'])
    const p = ok(planOn(w, plug({ module: TRACKER, role: 'write' }, { module: AG_INBOX, role: 'tools' })))
    expect(p.opens).toHaveLength(1)
    const after = buildModel(p.preview)
    const opened = after.fuses.find((f) => f.key === p.opens![0].key)!
    expect(opened.chain.decider).toBe(AG_INBOX)
    expect(opened.chain.exit).toMatchObject({ type: 'mcp', module: TRACKER })
    expect(p.opens![0].label).toBe(opened.label)
    expect(after.fuses.map((f) => f.label).sort()).toEqual(['F1', 'F2'])
    expect(p.asks).toContainEqual({ key: `${PP}.opensFuse`, vars: { f: opened.label } })
  })

  test('agent writes → database: scope += db; an everything scope has it already (info); a database below a scope page too', () => {
    const w = mock1()
    const p = ok(planOn(w, plug({ module: AG_MIRROR, role: 'writes' }, { module: k({ kind: 'database', id: 'dbKontakte' }), role: 'writes' })))
    expect(agentWrite(p).scope).toEqual({ everything: false, pages: [], databases: ['dbHandoff', 'dbKontakte'] })
    onlyChanged(w.ws.agents!.agTessera, agentWrite(p), ['scope'])
    expect(agentInverse(p)).toBe(w.ws.agents!.agTessera)
    expect(no(planOn(w, plug({ module: AG_INBOX, role: 'everything' }, { module: k({ kind: 'database', id: 'dbKontakte' }), role: 'writes' })))).toMatchObject({ info: true, refused: { key: `${PP}.everything`, vars: { agent: AG_INBOX } } })
    expect(no(planOn(w, plug({ module: AG_MIRROR, role: 'writes' }, { module: k({ kind: 'database', id: 'dbHandoff' }), role: 'writes' })))).toMatchObject({ info: true, refused: { key: `${PP}.already` } })
  })

  test('agent report → page: output = { pageId, mode }; inverse = the stored agent', () => {
    const w = mock1()
    const p = ok(planOn(w, plug({ module: AG_INBOX, role: 'report' }, { module: k({ kind: 'page', id: 'pgBericht' }), role: 'writes' })))
    expect(agentWrite(p).output).toEqual({ pageId: 'pgBericht', mode: 'append' })
    onlyChanged(w.ws.agents!.agInbox, agentWrite(p), ['output'])
    expect(agentInverse(p)).toBe(w.ws.agents!.agInbox)
  })

  test('automation out → script start: actions += run_script; inverse = the stored list', () => {
    const w = mock1()
    const p = ok(planOn(w, plug({ module: TO_CHAT, role: 'out' }, { module: k({ kind: 'script', id: 'scWeekly' }), role: 'start' })))
    const chat = (listWrite(p) as Automation[]).find((a) => a.id === 'autToChat')!
    expect(chat.actions).toEqual([{ type: 'webhook', url: 'https://chat.example/hook', method: 'POST', headers: { 'X-Room': 'team' } }, { type: 'run_script', scriptId: 'scWeekly' }])
    expect(listInverse(p)).toEqual(readAutomations(w.ws.databases.dbMails.automations))
  })

  test('a server tool → the Outbox (OUT lock): profile.outTools += tool through upsertIntegration; inverse = the stored profile', () => {
    const w = mock1()
    const p = ok(planOn(w, plug({ module: TRACKER, role: 'write', tool: 'create_issue' }, { module: k({ kind: 'outbox', profile: 'in-01', route: '', db: null }), role: 'send' })))
    // the stored profile as every reader takes it (sanitized), with the tool locked
    const stored = sanitizeIntegrations(w.ws.integrations).integrations[0]
    expect(p.writes).toEqual([{ w: 'integration', profile: { ...stored, outTools: ['create_issue'] }, replaces: 'in-01' }])
    expect((p.inverse[0] as Extract<PatchWrite, { w: 'integration' }>).profile).toEqual(stored)
    expect(p.inverse[0]).toMatchObject({ w: 'integration', replaces: 'in-01' })
    expect((p.inverse[0] as Extract<PatchWrite, { w: 'integration' }>).profile.outTools).toBeUndefined()
    // the preview locks it: the tool is OUT on the tracker
    expect(p.preview.servers.find((s) => s.server.id === 'srvTracker')?.out).toEqual(['create_issue'])
    expect(no(plan(plug({ module: TRACKER, role: 'write', tool: 'create_issue' }, { module: k({ kind: 'outbox', profile: 'in-01', route: '', db: null }), role: 'send' }), patchCtx(withWrites(w, p.writes))))).toMatchObject({ info: true })
  })

  test('the matrix helpers: canConnect / acceptsRoles / targetsOf agree with plan()', () => {
    expect(canConnect({ module: TRACKER, role: 'write' }, { module: AG_INBOX, role: 'tools' })).toBe(true)
    expect(canConnect({ module: TRACKER, role: 'write' }, { module: CHAT_HOOK, role: 'out' })).toBe(false)
    expect(canConnect({ module: TRACKER, role: 'write', tool: 'create_issue' }, { module: 'outbox:in-01:-', role: 'send' })).toBe(true)
    expect(acceptsRoles('agent', 'start').sort()).toEqual(['rows', 'start'])
    expect(acceptsRoles('agent', 'tools').sort()).toEqual(['read', 'write'])
    const m = modelOf(mock1())
    const targets = targetsOf({ module: ROWS_MAILS, role: 'start' }, m).map((t) => t.module)
    expect(targets).toEqual(expect.arrayContaining([AG_INBOX, AG_MIRROR, TO_CHAT, TO_CONTACT]))
    expect(targets).not.toContain(CHAT_HOOK)
  })
})

/* ------------------------------------------------------------------ unplug */

test.describe('B15 · unplug: the inverse of each cable', () => {
  test('clock / row trigger → agent: trigger → manual, and the last start of an enabled agent asks; a switched-off agent has no start cable', () => {
    const w = mock1()
    const p = ok(planOn(w, unplugOf({ module: MIRROR_CLOCK, role: 'start' }, { module: AG_MIRROR, role: 'start' })))
    expect(agentWrite(p).trigger).toEqual({ type: 'manual' })
    expect(p.asks).toEqual([{ key: `${PP}.lastStart`, vars: { agent: AG_MIRROR } }])
    expect(agentInverse(p)).toBe(w.ws.agents!.agTessera)
    const off = mock1With((w) => {
      w.ws.agents!.agInbox = { ...w.ws.agents!.agInbox, enabled: false }
    })
    // a switched-off agent has no drawn trigger cable: the row trigger → agent cable is gone (nothing to unplug)
    expect(no(planOn(off, unplugOf({ module: ROWS_MAILS, role: 'start' }, { module: AG_INBOX, role: 'start' })))).toMatchObject({ refused: { key: `${PP}.gone` } })
    const rowOff = ok(planOn(w, unplugOf({ module: ROWS_MAILS, role: 'start' }, { module: AG_INBOX, role: 'start' })))
    expect(agentWrite(rowOff).trigger).toEqual({ type: 'manual' })
    expect(rowOff.asks).toEqual([{ key: `${PP}.lastStart`, vars: { agent: AG_INBOX } }])
  })

  test('net flag → automation: switched off; its webhook unplugged → the action goes, the inverse keeps the headers', () => {
    const w = mock1()
    const off = ok(planOn(w, unplugOf({ module: NET_FWD, role: 'start' }, { module: TO_CHAT, role: 'start' })))
    expect((listWrite(off) as Automation[]).find((a) => a.id === 'autToChat')?.enabled).toBe(false)
    const hook = ok(planOn(w, unplugOf({ module: TO_CHAT, role: 'out' }, { module: CHAT_HOOK, role: 'out' })))
    expect((listWrite(hook) as Automation[]).find((a) => a.id === 'autToChat')?.actions).toEqual([])
    expect((listInverse(hook) as Automation[]).find((a) => a.id === 'autToChat')?.actions).toEqual([{ type: 'webhook', url: 'https://chat.example/hook', method: 'POST', headers: { 'X-Room': 'team' } }])
    // F1 is gone in the preview
    expect(buildModel(hook.preview).fuses).toEqual([])
  })

  test('a folded script and a set_property write: unplugging the write removes that action', () => {
    const w = mock1()
    const folded = ok(planOn(w, unplugOf({ module: TO_CONTACT, role: 'writes' }, { module: k({ kind: 'database', id: 'dbKontakte' }), role: 'writes' })))
    expect((listWrite(folded) as Automation[]).find((a) => a.id === 'autToContact')?.actions).toEqual([])
    const sets = world({
      pages: [dbPage('dbLaunch', 'Launch plan')],
      databases: [database('dbLaunch', [prop('pPhase', 'Phase', 'text'), prop('pOk', 'Freigabe', 'checkbox')], { automations: [automation('autOk', 'Phase → Freigabe', { type: 'property_changed', propertyId: 'pPhase' }, [{ type: 'set_property', propertyId: 'pOk', value: true }, { type: 'notify', message: 'Phase' }])] })],
    })
    const m = modelOf(sets)
    const e = m.edges.find((x) => x.from === `${k({ kind: 'automation', db: 'dbLaunch', id: 'autOk' })}.writes`)!
    const [toKey, toRole] = e.to.startsWith('net:') ? [e.to, 'start'] : [e.to.slice(0, e.to.lastIndexOf('.')), e.to.slice(e.to.lastIndexOf('.') + 1)]
    const p = ok(planOn(sets, { op: 'unplug', from: { module: k({ kind: 'automation', db: 'dbLaunch', id: 'autOk' }), role: 'writes' }, to: { module: toKey, role: toRole as 'writes' }, edge: e.id }))
    expect((listWrite(p) as Automation[])[0].actions).toEqual([{ type: 'notify', message: 'Phase' }])
  })

  test('an own command: removed (an "actions" command loses only that action); an Outbox route is the profile\'s', () => {
    const cmds: DbCommand[] = [
      { id: 'new-entry', kind: 'default', hidden: true },
      { id: 'cmdRun', kind: 'agent', label: '', icon: null, config: { agentId: 'agTessera' } },
      { id: 'cmdTwo', kind: 'actions', label: 'Melden', icon: null, config: { actions: [{ id: 'a1', type: 'webhook', url: 'https://cmd.example/ping', method: 'PUT' }, { id: 'a2', type: 'run_script', scriptId: 'scWeekly' }] } },
    ]
    const w = mock1With((w) => {
      w.ws.databases.dbKontakte = { ...w.ws.databases.dbKontakte, commands: cmds }
    })
    const run = ok(planOn(w, unplugOf({ module: k({ kind: 'command', db: 'dbKontakte', command: 'cmdRun' }), role: 'start' }, { module: AG_MIRROR, role: 'start' })))
    expect((listWrite(run) as DbCommand[]).map((c) => c.id)).toEqual(['new-entry', 'cmdTwo'])
    expect(listInverse(run)).toEqual(cmds)
    const hook = ok(planOn(w, unplugOf({ module: k({ kind: 'command', db: 'dbKontakte', command: 'cmdTwo' }), role: 'out' }, { module: 'outbound:webhook:cmd.example:PUT', role: 'out' })))
    expect((listWrite(hook) as DbCommand[]).find((c) => c.id === 'cmdTwo')?.config).toEqual({ actions: [{ id: 'a2', type: 'run_script', scriptId: 'scWeekly' }] })
    const route = world({
      pages: [dbPage('dbTickets', 'Tickets')],
      databases: [database('dbTickets', [])],
      servers: [server('srvAlpha', 'alpha', { tools: ['list_items', 'send_message'], checkedAt: 1 })],
      integrations: [profile('alpha', { match: { name: 'alpha' }, unlocks: ['sends'], sends: [{ id: 'reply', label: 'Antworten', tool: 'send_message', args: { text: '{draft}' }, params: [{ name: 'draft', type: 'text' }] }] })],
      sends: { dbTickets: [{ profile: 'alpha', route: 'reply', tool: 'send_message', server: 'alpha' }] },
    })
    expect(no(planOn(route, unplugOf({ module: k({ kind: 'command', db: 'dbTickets', command: 'send:alpha:reply' }), role: 'send' }, { module: k({ kind: 'outbox', profile: 'alpha', route: 'reply', db: null }), role: 'send' })))).toMatchObject({ refused: { key: `${PP}.inProfile` } })
  })

  test('server READ out → mcpServers − s; WRITE? out → narrowed to READ (none left: the server goes, said)', () => {
    const w = mock1With((w) => {
      w.ws.agents!.agInbox = { ...w.ws.agents!.agInbox, mcpServers: ['tracker'] }
    })
    const write = ok(planOn(w, unplugOf({ module: TRACKER, role: 'write' }, { module: AG_INBOX, role: 'tools' })))
    expect(agentWrite(write)).toMatchObject({ mcpServers: ['tracker'], mcpTools: { tracker: TRACKER_READS } })
    const read = ok(planOn(w, unplugOf({ module: TRACKER, role: 'read' }, { module: AG_INBOX, role: 'tools' })))
    expect(agentWrite(read).mcpServers).toEqual([])
    expect(agentWrite(read).mcpTools).toBeUndefined()
    // a server with write tools only: narrowing leaves nothing — the server goes, and the plan says so
    const writesOnly = mock1With((w) => {
      w.ws.settings = { ...w.ws.settings, mcpServers: [server('srvTracker', 'tracker', { tools: ['create_issue', 'post_status'], checkedAt: 1 })] }
      w.ws.agents!.agInbox = { ...w.ws.agents!.agInbox, mcpServers: ['tracker'] }
    })
    const gone = ok(planOn(writesOnly, unplugOf({ module: TRACKER, role: 'write' }, { module: AG_INBOX, role: 'tools' })))
    expect(agentWrite(gone).mcpServers).toEqual([])
    expect(gone.notes).toContainEqual({ key: `${P}.key.cutToolsAll`, vars: { agent: AG_INBOX, server: TRACKER } })
  })

  test('scope − db; report off; outTools − tool; an everything scope and the notes cable are changed in the editor', () => {
    const w = mock1With((w) => {
      w.ws.agents!.agTessera = { ...w.ws.agents!.agTessera, scope: { everything: false, pages: [], databases: ['dbHandoff', 'dbKontakte'] } }
      w.ws.integrations = [{ ...(w.ws.integrations as IntegrationProfile[])[0], outTools: ['create_issue', 'add_comment'] }]
    })
    const scope = ok(planOn(w, unplugOf({ module: AG_MIRROR, role: 'writes' }, { module: k({ kind: 'database', id: 'dbKontakte' }), role: 'writes' })))
    expect(agentWrite(scope).scope.databases).toEqual(['dbHandoff'])
    const report = ok(planOn(w, unplugOf({ module: AG_MIRROR, role: 'report' }, { module: k({ kind: 'page', id: 'pgBericht' }), role: 'writes' })))
    expect(agentWrite(report).output).toBeNull()
    const out = ok(planOn(w, unplugOf({ module: TRACKER, role: 'out', tool: 'create_issue' }, { module: 'outbox:in-01:-', role: 'send' })))
    expect((out.writes[0] as Extract<PatchWrite, { w: 'integration' }>).profile.outTools).toEqual(['add_comment'])
    expect(no(planOn(w, unplugOf({ module: AG_INBOX, role: 'everything' }, { module: 'everything:all', role: 'writes' })))).toMatchObject({ refused: { key: `${PP}.inEditor` }, open: { to: 'route', route: { name: 'agents', id: 'agInbox' } } })
    expect(no(planOn(w, unplugOf({ module: AG_MIRROR, role: 'notes' }, { module: 'inbox:notes', role: 'writes' })))).toMatchObject({ refused: { key: `${PP}.inEditor` } })
  })
})

/* ------------------------------------------------------------------ refusals */

test.describe('B15 · refusals', () => {
  test('no new way out: any cable onto an outbound module or the Outbox is refused with "↵ opens its editor"', () => {
    const w = mock1()
    const r = no(planOn(w, plug({ module: TO_CONTACT, role: 'out' }, { module: CHAT_HOOK, role: 'out' })))
    expect(r.refused).toEqual({ key: `${PP}.noOut` })
    expect(r.open).toEqual({ to: 'modal', modal: 'automations', databaseId: 'dbMails' })
    expect(no(planOn(w, plug({ module: AG_INBOX, role: 'writes' }, { module: 'outbound:git:-:pr', role: 'out' }))).refused.key).toBe(`${PP}.noOut`)
  })

  test('an automation lives in its database; agents never start on deleted rows', () => {
    const w = mock1With((w) => {
      w.ws.databases.dbKontakte = { ...w.ws.databases.dbKontakte, automations: [automation('autKontakt', 'Kontakt → Notiz', { type: 'row_created' }, [{ type: 'notify', message: 'neu' }])] }
    })
    expect(no(planOn(w, plug({ module: NET_FWD, role: 'start' }, { module: k({ kind: 'automation', db: 'dbKontakte', id: 'autKontakt' }), role: 'start' }))).refused).toEqual({ key: `${PP}.otherDb` })
    expect(no(planOn(w, plug({ module: k({ kind: 'rowTrigger', db: 'dbMails', event: 'deleted', prop: null }), role: 'start' }, { module: AG_MIRROR, role: 'start' }))).refused).toEqual({ key: `${PP}.noDeleted` })
  })

  test('a locked database: re-wiring and adds refused — switching off and removing allowed (§1.14, Q2)', () => {
    const w = mock1With((w) => {
      w.ws.databases.dbMails = { ...w.ws.databases.dbMails, locked: true }
      w.ws.databases.dbKontakte = { ...w.ws.databases.dbKontakte, locked: true }
    })
    expect(no(planOn(w, plug({ module: NET_FWD, role: 'start' }, { module: TO_CONTACT, role: 'start' }))).refused).toEqual({ key: `${P}.key.locked` })
    expect(no(planOn(w, plug({ module: TO_CHAT, role: 'out' }, { module: k({ kind: 'script', id: 'scWeekly' }), role: 'start' }))).refused).toEqual({ key: `${P}.key.locked` })
    expect(no(planOn(w, plug({ module: k({ kind: 'database', id: 'dbKontakte' }), role: 'rows' }, { module: AG_MIRROR, role: 'start' }))).refused).toEqual({ key: `${P}.key.locked` })
    // removals pass: the webhook action out, the automation off
    const hook = ok(planOn(w, unplugOf({ module: TO_CHAT, role: 'out' }, { module: CHAT_HOOK, role: 'out' })))
    expect((listWrite(hook) as Automation[]).find((a) => a.id === 'autToChat')?.actions).toEqual([])
    ok(planOn(w, unplugOf({ module: NET_FWD, role: 'start' }, { module: TO_CHAT, role: 'start' })))
  })

  test('an untested server: "test the server first" (and the MCP settings open on it)', () => {
    const w = mock1()
    const r = no(planOn(w, plug({ module: KANAL, role: 'read' }, { module: AG_INBOX, role: 'tools' })))
    expect(r.refused).toEqual({ key: `${PP}.testFirst`, vars: { server: KANAL } })
    expect(r.open).toEqual({ to: 'mcp', server: 'srvKanal' })
    expect(no(planOn(w, plug({ module: KANAL, role: 'write' }, { module: AG_INBOX, role: 'tools' }))).refused.key).toBe(`${PP}.testFirst`)
  })

  test('targets in the trash are named in gone.ts\' words; the editor\'s own checks run on the changed agent', () => {
    const w = mock1With((w) => {
      w.ws.pages.dbKontakte = { ...w.ws.pages.dbKontakte, trashed: true, trashedAt: 1 }
      w.ws.pages.pgArchiv = page('pgArchiv', { title: 'Archiv', trashed: true, trashedAt: 1 })
      w.ws.pages.dbAlt = dbPage('dbAlt', 'Alte Leads', { parentId: 'pgArchiv' })
      w.ws.databases.dbAlt = database('dbAlt', [])
    })
    expect(no(planOn(w, plug({ module: AG_MIRROR, role: 'writes' }, { module: k({ kind: 'database', id: 'dbKontakte' }), role: 'writes' }))).refused).toEqual({ key: 'features.agents.lost.trashed', vars: { title: 'Kontakte' } })
    expect(no(planOn(w, plug({ module: AG_MIRROR, role: 'writes' }, { module: k({ kind: 'database', id: 'dbAlt' }), role: 'writes' }))).refused).toEqual({ key: 'features.agents.lost.below', vars: { title: 'Alte Leads', parent: 'Archiv' } })
    expect(no(planOn(w, plug({ module: k({ kind: 'rowTrigger', db: 'dbKontakte', event: 'created', prop: null }), role: 'start' }, { module: AG_MIRROR, role: 'start' }))).refused).toEqual({ key: 'features.agents.lost.trashed', vars: { title: 'Kontakte' } })
    expect(no(planOn(w, plug({ module: AG_MIRROR, role: 'writes' }, { module: k({ kind: 'database', id: 'dbNirgends' }), role: 'writes' }))).refused).toEqual({ key: 'features.agents.lost.gone.database' })
    // the report page in the trash (a page the model knows: another agent's report)
    const r = mock1With((w) => {
      w.ws.pages.pgBericht = { ...w.ws.pages.pgBericht, trashed: true, trashedAt: 1 }
    })
    expect(no(planOn(r, plug({ module: AG_INBOX, role: 'report' }, { module: k({ kind: 'page', id: 'pgBericht' }), role: 'writes' }))).refused).toEqual({ key: 'features.agents.lost.trashed', vars: { title: 'Bericht' } })
    // the agent's own scope holds a page in the trash: the editor refuses saving the scope (its words)
    const scopeLost = mock1With((w) => {
      w.ws.pages.pgArchiv = page('pgArchiv', { title: 'Archiv', trashed: true, trashedAt: 1 })
      w.ws.agents!.agTessera = { ...w.ws.agents!.agTessera, scope: { everything: false, pages: ['pgArchiv'], databases: ['dbHandoff'] } }
    })
    const lost = no(planOn(scopeLost, plug({ module: AG_MIRROR, role: 'writes' }, { module: k({ kind: 'database', id: 'dbKontakte' }), role: 'writes' })))
    expect(lost.refused).toEqual({ key: 'features.agents.err.scopeTrashed.one', vars: { title: 'Archiv' } })
    expect(lost.open).toEqual({ to: 'route', route: { name: 'agents', id: 'agTessera' } })
    // …while a field the patch does not touch is no reason (the trigger patch passes)
    ok(planOn(scopeLost, plug({ module: ROWS_MAILS, role: 'start' }, { module: AG_MIRROR, role: 'start' })))
  })

  test('a mirror: never unplugged from its database (open the agent); widening its tools asks first', () => {
    const w = mock1()
    const off = no(planOn(w, unplugOf({ module: AG_MIRROR, role: 'writes' }, { module: k({ kind: 'database', id: 'dbHandoff' }), role: 'writes' })))
    expect(off).toMatchObject({ refused: { key: `${PP}.mirror`, vars: { agent: AG_MIRROR } }, open: { to: 'route', route: { name: 'agents', id: 'agTessera' } } })
    const widen = ok(planOn(w, plug({ module: TRACKER, role: 'write' }, { module: AG_MIRROR, role: 'tools' })))
    expect(widen.asks?.[0]).toEqual({ key: `${PP}.mirrorWiden`, vars: { agent: AG_MIRROR } })
    // its READ jack again: nothing to do (its list is the reads)
    expect(no(planOn(w, plug({ module: TRACKER, role: 'read' }, { module: AG_MIRROR, role: 'tools' })))).toMatchObject({ info: true })
    // narrowing a mirror's tools asks too
    expect(ok(planOn(w, unplugOf({ module: TRACKER, role: 'read' }, { module: AG_MIRROR, role: 'tools' }))).asks).toEqual([{ key: `${PP}.mirrorNarrow`, vars: { agent: AG_MIRROR } }])
  })

  test('the default "Run <agent> now" is there already: info, nothing written (and a switched-off default lets the command in)', () => {
    const w = mock1()
    // Inbox-Helfer watches Mails (its row trigger): its default command exists
    expect(hasDefaultCommand('dbMails', 'agInbox', w.ws as Parameters<typeof hasDefaultCommand>[2])).toBe(true)
    const r = no(planOn(w, plug({ module: k({ kind: 'database', id: 'dbMails' }), role: 'rows' }, { module: AG_INBOX, role: 'start' })))
    expect(r).toMatchObject({ info: true, refused: { key: `${PP}.hasDefault`, vars: { agent: AG_INBOX } } })
    const hidden = mock1With((w) => {
      w.ws.databases.dbMails = { ...w.ws.databases.dbMails, commands: [{ id: 'agent:agInbox', kind: 'default', hidden: true }] }
    })
    ok(planOn(hidden, plug({ module: k({ kind: 'database', id: 'dbMails' }), role: 'rows' }, { module: AG_INBOX, role: 'start' })))
  })

  test('the OUT lock: owners / admins only (named), a profile matching by name / address only, ≤ 20 tools', () => {
    const lock = plug({ module: TRACKER, role: 'write', tool: 'create_issue' }, { module: 'outbox:in-01:-', role: 'send' })
    const member = mock1With((w) => {
      w.device = { ...w.device, ...TEAM('acBen', 'member', ['ai', 'governor', 'signoffs']) }
    })
    expect(no(planOn(member, lock, { admins: ['Mara Lind', 'Tessa'] })).refused).toEqual({ key: `${PP}.outAdmins`, vars: { names: 'Mara Lind, Tessa' } })
    expect(no(planOn(member, lock)).refused).toEqual({ key: `${PP}.outAdminsNone` })
    const admin = mock1With((w) => {
      w.device = { ...w.device, ...TEAM('acMara', 'admin', ['ai', 'governor', 'signoffs']) }
    })
    ok(planOn(admin, lock))
    // a profile that matches by tools only locks nothing on the server (§6 A23)
    const toolsOnly = mock1With((w) => {
      w.ws.integrations = [profile('in-01', { name: 'IN-01', match: { tools: ['query_issues'] }, unlocks: ['notify'] })]
    })
    expect(no(planOn(toolsOnly, lock)).refused).toEqual({ key: `${PP}.outNoMatch` })
    const full = mock1With((w) => {
      w.ws.integrations = [{ ...(w.ws.integrations as IntegrationProfile[])[0], outTools: Array.from({ length: 20 }, (_, i) => `tool_${i}`) }]
    })
    expect(no(planOn(full, lock)).refused).toEqual({ key: `${PP}.outFull`, vars: { n: 20 } })
    expect(no(planOn(mock1(), plug({ module: TRACKER, role: 'write', tool: 'delete_everything' }, { module: 'outbox:in-01:-', role: 'send' }))).refused).toEqual({ key: `${PP}.unknownTool`, vars: { tool: 'delete_everything' } })
  })

  test('where an agent\'s tools live: a browser agent takes this device\'s servers (on its creator\'s device), a server agent the team server\'s', () => {
    const w = exits()
    const RT_ALPHA = k({ kind: 'server', id: null, name: 'alpha', runtime: true })
    const LOCAL_ALPHA = k({ kind: 'server', id: 'srvAlpha', name: 'alpha' })
    const HOOK_AGENT = k({ kind: 'agent', id: 'agExHook' })
    expect(no(planOn(w, plug({ module: LOCAL_ALPHA, role: 'read' }, { module: HOOK_AGENT, role: 'tools' }))).refused).toEqual({ key: `${PP}.notOnServer`, vars: { server: LOCAL_ALPHA } })
    expect(no(planOn(w, plug({ module: RT_ALPHA, role: 'read' }, { module: k({ kind: 'agent', id: 'agExStage' }), role: 'tools' }))).refused).toEqual({ key: `${PP}.notHere`, vars: { agent: k({ kind: 'agent', id: 'agExStage' }) } })
    // the server agent has every tool of its runtime server already
    expect(no(planOn(w, plug({ module: RT_ALPHA, role: 'read' }, { module: HOOK_AGENT, role: 'tools' })))).toMatchObject({ info: true, refused: { key: `${PP}.already` } })
    // a server agent's webhook trigger is replaced only after a confirm
    const clock = k({ kind: 'clock', schedule: scheduleKey({ type: 'schedule', every: 'day', at: '09:00', tz: 'Europe/Berlin' }), agents: [] })
    const p = ok(planOn(w, plug({ module: clock, role: 'start' }, { module: HOOK_AGENT, role: 'start' })))
    expect(p.asks?.[0]).toEqual({ key: `${PP}.replaceWebhook`, vars: { agent: HOOK_AGENT } })
    expect(agentWrite(p).trigger).toEqual({ type: 'schedule', every: 'day', at: '09:00', tz: 'Europe/Berlin' })
    // team: another member's browser agent — its servers are on its creator's device
    const team = mock1With((w) => {
      w.device = { ...w.device, ...TEAM('acBen', 'member', ['ai', 'governor', 'signoffs']) }
      w.ws.agents!.agInbox = { ...w.ws.agents!.agInbox, createdBy: 'acMara', updatedBy: 'acMara' }
    })
    expect(no(planOn(team, plug({ module: TRACKER, role: 'read' }, { module: AG_INBOX, role: 'tools' }))).refused).toEqual({ key: `${PP}.notHere`, vars: { agent: AG_INBOX } })
  })

  test('viewers and read-only workspaces: every patch is refused', () => {
    for (const ctx of [TEAM('acVera', 'viewer', ['ai', 'governor']).ctx, { ...TEAM('acBen', 'member').ctx, readOnly: true }]) {
      const w = mock1With((w) => {
        w.device = { ...w.device, ctx }
      })
      expect(no(planOn(w, plug({ module: MIRROR_CLOCK, role: 'start' }, { module: AG_INBOX, role: 'start' }))).refused).toEqual({ key: `${P}.key.readOnly` })
      expect(no(planOn(w, unplugOf({ module: TO_CHAT, role: 'out' }, { module: CHAT_HOOK, role: 'out' }))).refused).toEqual({ key: `${P}.key.readOnly` })
    }
  })

  test('team: a browser agent another member made → the write is planned, "<creator> must confirm" is said; private report pages refused', () => {
    const w = mock1With((w) => {
      w.device = { ...w.device, ...TEAM('acBen', 'member', ['ai', 'governor', 'signoffs']) }
      w.ws.agents!.agInbox = { ...w.ws.agents!.agInbox, createdBy: 'acMara', updatedBy: 'acMara' }
      w.ws.pages.pgPrivat = page('pgPrivat', { title: 'Notizen', private: true })
      w.ws.agents!.agTessera = { ...w.ws.agents!.agTessera, createdBy: 'acBen', updatedBy: 'acBen', output: { pageId: 'pgPrivat', mode: 'append' } }
    })
    const p = ok(planOn(w, plug({ module: MIRROR_CLOCK, role: 'start' }, { module: AG_INBOX, role: 'start' })))
    expect(p.notes).toEqual([{ key: `${P}.key.confirmAfter`, vars: { creator: 'acMara' } }])
    // after the write it waits for its creator (upsertAgent stamps the saver)
    expect(p.preview.agents.find((a) => a.agent.id === 'agInbox')?.awaitsConfirm).toBe(true)
    expect(no(planOn(w, plug({ module: AG_INBOX, role: 'report' }, { module: k({ kind: 'page', id: 'pgPrivat' }), role: 'writes' }))).refused).toEqual({ key: `${PP}.privateReport` })
  })
})

/* ------------------------------------------------------------------ stored fields, Undo, commit */

test.describe('B15 · stored fields, Undo and the commit', () => {
  test('stored Unreadable fields survive a patch (the write spreads the stored record; the sanitizer keeps them)', () => {
    const route = [{ p: 'futurecorp', m: 'x' }] as unknown as CustomAgent['route']
    const review = { v: 9, future: true } as unknown as CustomAgent['review']
    const w = mock1With((w) => {
      w.ws.agents!.agTessera = { ...w.ws.agents!.agTessera, route, review, applyOn: 'futurecorp:x' as unknown as CustomAgent['applyOn'] }
    })
    const p = ok(planOn(w, plug({ module: AG_MIRROR, role: 'writes' }, { module: k({ kind: 'database', id: 'dbKontakte' }), role: 'writes' })))
    const written = agentWrite(p)
    expect(written.route).toBe(route)
    expect(written.review).toBe(review)
    const stored = sanitizeAgent('agTessera', JSON.parse(JSON.stringify(written)))!
    expect(stored.route).toEqual(route)
    expect(stored.review).toEqual(review)
    expect(stored.applyOn).toEqual('futurecorp:x')
    expect(stored.scope.databases).toEqual(['dbHandoff', 'dbKontakte'])
  })

  test('Undo: the inverse while the target holds what was written — bookkeeping is no change; an outside edit is ("changed since")', () => {
    const w = mock1()
    const p = ok(planOn(w, unplugOf({ module: TO_CHAT, role: 'out' }, { module: CHAT_HOOK, role: 'out' })))
    const after = withWrites(w, p.writes)
    expect(undoPlan(p, patchCtx(after))).toEqual({ writes: p.inverse })
    // the engine's bookkeeping (lastRunAt / lastStatus / lastMessage) changes no config field (§6 A21)
    const kept = withWrites(after, [{ w: 'automations', db: 'dbMails', list: readAutomations(after.ws.databases.dbMails.automations).map((a) => ({ ...a, lastRunAt: 99, lastStatus: 'error' as const, lastMessage: 'POST → 500' })) }])
    expect(undoPlan(p, patchCtx(kept))).toEqual({ writes: p.inverse })
    // fix (ui-words): … and the Undo writes config only — the bookkeeping written since the patch survives it, for every
    // automation of the database (not only the patched one)
    const rec = recordingSink(w)
    expect(commitWrites(p.writes, { kind: 'you', via: 'patchbay' }, rec.sink, p.inverse)).toEqual({ ok: true })
    rec.automations.dbMails = readAutomations(rec.automations.dbMails).map((a) => (a.id === 'autToContact' ? { ...a, lastRunAt: 123456789, lastStatus: 'error' as const, lastMessage: 'Script failed' } : a))
    const undo = undoPlan(p, patchCtx(withWrites(w, [{ w: 'automations', db: 'dbMails', list: rec.automations.dbMails as Automation[] }])))
    expect('writes' in undo).toBe(true)
    expect(commitWrites((undo as { writes: PatchWrite[] }).writes, { kind: 'you', via: 'undo' }, rec.sink, p.writes)).toEqual({ ok: true })
    const back = readAutomations(rec.automations.dbMails)
    expect(back.find((a) => a.id === 'autToContact')).toMatchObject({ lastRunAt: 123456789, lastStatus: 'error', lastMessage: 'Script failed' })
    // the patched automation's action is back (the inverse's config)
    expect(back.find((a) => a.id === 'autToChat')?.actions.map((x) => x.type)).toEqual(['webhook'])
    // a commit too: bookkeeping since the plan (a run while the popover was open) is not written back
    const rec2 = recordingSink(w)
    rec2.automations.dbMails = readAutomations(rec2.automations.dbMails).map((a) => ({ ...a, lastRunAt: 7, lastStatus: 'ok' as const, lastMessage: '200' }))
    expect(commitWrites(p.writes, { kind: 'you', via: 'patchbay' }, rec2.sink, p.inverse)).toEqual({ ok: true })
    expect(readAutomations(rec2.automations.dbMails).map((a) => a.lastRunAt)).toEqual([7, 7])
    expect(withBookkeeping([{ ...readAutomations(w.ws.databases.dbMails.automations)[0], lastRunAt: 5 }], [])[0].lastRunAt).toBeUndefined()
    // someone renamed the automation since
    const edited = withWrites(after, [{ w: 'automations', db: 'dbMails', list: readAutomations(after.ws.databases.dbMails.automations).map((a) => (a.id === 'autToChat' ? { ...a, name: 'An Team-Chat (neu)' } : a)) }])
    expect(undoPlan(p, patchCtx(edited))).toEqual({ refused: { key: `${P}.key.changedSince` } })
    // an agent: the store's stamps (updatedAt / updatedBy) are no change; its trigger changed since is
    const a = ok(planOn(w, plug({ module: MIRROR_CLOCK, role: 'start' }, { module: AG_INBOX, role: 'start' })))
    const done = withWrites(w, a.writes, { me: 'acMara' })
    expect(undoPlan(a, patchCtx(done))).toEqual({ writes: a.inverse })
    const moved = withWrites(done, [{ w: 'agent', agent: { ...done.ws.agents!.agInbox, trigger: { type: 'manual' } } }])
    expect(undoPlan(a, patchCtx(moved))).toEqual({ refused: { key: `${P}.key.changedSince` } })
  })

  test('Undo on a database locked meanwhile: putting an automation\'s action back is an add — refused', () => {
    const w = mock1()
    const p = ok(planOn(w, unplugOf({ module: TO_CHAT, role: 'out' }, { module: CHAT_HOOK, role: 'out' })))
    const after = withWrites(w, p.writes)
    after.ws = { ...after.ws, databases: { ...after.ws.databases, dbMails: { ...after.ws.databases.dbMails, locked: true } } }
    expect(undoPlan(p, patchCtx(after))).toEqual({ refused: { key: `${P}.key.locked` } })
  })

  test('commitWrites: under the writer frame (you~patchbay, Undo you~undo), every boolean read, a refused write rolls back', () => {
    const w = mock1()
    const p = ok(planOn(w, plug({ module: MIRROR_CLOCK, role: 'start' }, { module: AG_INBOX, role: 'start' })))
    const rec = recordingSink(w)
    expect(commitWrites(p.writes, { kind: 'you', via: 'patchbay' }, rec.sink, p.inverse)).toEqual({ ok: true })
    expect(rec.log).toEqual([{ w: 'agent', writer: 'you~patchbay' }])
    expect(rec.agents.agInbox.trigger.type).toBe('schedule')
    expect(commitWrites(p.inverse, { kind: 'you', via: 'undo' }, rec.sink, p.writes)).toEqual({ ok: true })
    expect(rec.log.at(-1)).toEqual({ w: 'agent', writer: 'you~undo' })
    // the agent writer refused (upsertAgent returns nothing: read back) → not ok
    const refusing = recordingSink(w, { agent: true })
    expect(commitWrites(p.writes, { kind: 'you', via: 'patchbay' }, refusing.sink, p.inverse)).toEqual({ ok: false, refused: { key: `${PP}.failed` } })
    // two writes, the second refused: the first is put back (its inverse)
    const two: PatchWrite[] = [{ w: 'commands', db: 'dbKontakte', list: [] }, { w: 'automations', db: 'dbMails', list: [] }]
    const back: PatchWrite[] = [{ w: 'commands', db: 'dbKontakte', list: [{ id: 'x', kind: 'default' }] }, { w: 'automations', db: 'dbMails', list: [] }]
    const half = recordingSink(w, { automations: true })
    expect(commitWrites(two, { kind: 'you', via: 'patchbay' }, half.sink, back)).toEqual({ ok: false, refused: { key: `${PP}.failed` } })
    expect(half.log.map((x) => `${x.w}:${x.writer}`)).toEqual(['commands:you~patchbay', 'automations:you~patchbay', 'commands:you~patchbay'])
  })
})

/* ------------------------------------------------------------------ the automations reader + the lock rule */

test.describe('B15 · automations: the reader (sanitizer) and the lock rule (§1.14)', () => {
  test('readAutomations: known shapes kept, junk out, URLs with another scheme emptied, the same array → the same result', () => {
    const raw = [
      automation('a1', 'Gut', { type: 'property_changed', propertyId: 'p1', toValue: true }, [{ type: 'webhook', url: ' https://hooks.example/in ', method: 'PUT', headers: { 'X-Room': 'team', 'Bad Header': 'x', 'X-Line': 'a\nb' } }]),
      automation('a2', 'Gefährlich', { type: 'row_created' }, [{ type: 'webhook', url: 'javascript:alert(1)', method: 'DELETE' as 'POST' }]),
      { id: 'a3', name: 'Neuere Version', enabled: true, trigger: { type: 'row_moved' }, actions: [] },
      { id: 'a4', name: 'Neue Aktion', enabled: true, trigger: { type: 'row_created' }, actions: [{ type: 'send_sms', to: '+49' }] },
      'junk',
      { name: 'ohne id' },
      automation('a1', 'Doppelt', { type: 'row_deleted' }, []),
      automation('a5', 'Tippen', { type: 'row_created' }, [{ type: 'webhook', url: 'https://hoo', method: 'POST' }, { type: 'set_property', propertyId: '', value: null }, { type: 'run_script', scriptId: null }]),
    ]
    const list = readAutomations(raw)
    expect(list.map((a) => a.id)).toEqual(['a1', 'a2', 'a5'])
    expect(list[0].actions[0]).toEqual({ type: 'webhook', url: 'https://hooks.example/in', method: 'PUT', headers: { 'X-Room': 'team' } })
    expect(list[0].trigger).toEqual({ type: 'property_changed', propertyId: 'p1', toValue: true })
    expect(list[1].actions[0]).toEqual({ type: 'webhook', url: '', method: 'POST' })
    // what is being typed stays (the editor writes on each key)
    expect(list[2].actions[0]).toMatchObject({ url: 'https://hoo' })
    expect(webhookUrlOf('http')).toBe('http')
    expect(webhookUrlOf('data:text/html,x')).toBe('')
    expect(readAutomations(raw)).toBe(list)
    expect(readAutomations(list)).toBe(list)
    // a newer build's entries: kept by the writer, never read here
    expect(unreadableAutomations(raw).map((x) => x.id)).toEqual(['a3', 'a4'])
    expect(sanitizeAutomation({ id: 'x', trigger: { type: 'row_created' }, actions: 'nope' })).toBeNull()
  })

  test('fix (safety-data): nothing is ever cut — 26 actions and a long header token stay whole through the bookkeeping save; past the read bounds an automation is kept as it is, unread', () => {
    const steps = Array.from({ length: 25 }, (_, i): Automation['actions'][number] => ({ type: 'notify', message: `Schritt ${i + 1}` }))
    const token = `Bearer ${'t'.repeat(1500)}`
    const many = automation('aMany', 'Viele Schritte', { type: 'row_created' }, [...steps, { type: 'webhook', url: 'https://hooks.example/in', method: 'POST', headers: { Authorization: token } }])
    const longName = automation('aName', 'N'.repeat(AUTOMATION_READ.name + 1), { type: 'row_created' }, [])
    const tooMany = automation('aTooMany', 'Zu viele', { type: 'row_created' }, Array.from({ length: AUTOMATION_READ.actions + 1 }, (): Automation['actions'][number] => ({ type: 'notify', message: 'x' })))
    const odd = automation('aOdd', 'Neuer Wert', { type: 'property_changed', propertyId: 'p1', toValue: { colour: 'red' } as unknown as string }, [])
    const raw = JSON.parse(JSON.stringify([many, longName, tooMany, odd])) as unknown[]
    const list = readAutomations(raw)
    expect(list.map((a) => a.id)).toEqual(['aMany'])
    expect(list[0].actions).toHaveLength(26)
    expect(list[0].actions[25]).toEqual({ type: 'webhook', url: 'https://hooks.example/in', method: 'POST', headers: { Authorization: token } })
    // the engine's bookkeeping save (read → last* → read again) keeps every action and the whole token
    const after = readAutomations(list.map((a) => ({ ...a, lastRunAt: 9, lastStatus: 'ok' as const, lastMessage: 'POST → 200' })))
    expect(after[0].actions).toEqual(list[0].actions)
    // beyond the read bounds: kept as it is by the writer, never read (run or edited) here — named in the modal
    expect(unreadableAutomations(raw).map((x) => x.id)).toEqual(['aName', 'aTooMany', 'aOdd'])
    expect(unreadableCounts(raw)).toEqual({ newer: 1, limits: 2 })
    // a condition this build cannot read is never dropped (it would fire on every change)
    expect(sanitizeAutomation(odd)).toBeNull()
    // the editor's cap is below the reader's bound: what the editor makes is always read
    expect(AUTOMATION_LIMITS.actions).toBeLessThan(AUTOMATION_READ.actions)
    expect(AUTOMATION_LIMITS.name).toBeLessThan(AUTOMATION_READ.name)
    expect(AUTOMATION_LIMITS.url).toBeLessThan(AUTOMATION_READ.url)
    expect(AUTOMATION_LIMITS.message).toBeLessThan(AUTOMATION_READ.message)
  })

  test('fix (safety-data): an automation with 25 actions keeps them all through the engine\'s bookkeeping save in the app', async ({ page }) => {
    const w = mock1()
    // Tessera-Spiegel's 07:30 slot would run it on open — not this case's concern
    w.ws.agents = { ...w.ws.agents, agTessera: { ...w.ws.agents!.agTessera, updatedAt: Date.parse('2031-01-01T00:00:00Z') } }
    const db = w.ws.databases.dbMails!
    const steps = Array.from({ length: 25 }, (_, i): Automation['actions'][number] => ({ type: 'notify', message: `Schritt ${i + 1}` }))
    w.ws.databases.dbMails = { ...db, automations: [...(db.automations ?? []), automation('autMany', 'Viele Schritte', { type: 'row_created' }, steps)] }
    await openApp(page)
    await page.route(/\.example\//, (r) => r.fulfill({ status: 200, body: 'ok' }))
    await seedPatchbay(page, w)
    type Stored = { id: string; actions: unknown[]; lastRunAt: number | null }
    const many = () => wsEval(page, (s) => JSON.parse(JSON.stringify((s.databases.dbMails.automations as unknown as Stored[]).find((a) => a.id === 'autMany') ?? null)) as Stored | null)
    expect((await many())?.actions).toHaveLength(25)
    // a new mail row: the automations run here and the engine writes their bookkeeping through saveAutomations
    await wsEval(page, (s) => s.createPage({ parentId: 'dbMails', databaseId: 'dbMails', title: 'Neue Mail' }))
    await expect.poll(async () => (await many())?.lastRunAt ?? null, { timeout: 15_000 }).not.toBeNull()
    expect((await many())?.actions).toEqual(steps)
  })

  test('lockRefusal: off, a removed action, a removed automation pass — an add, a rename, a new trigger, switching on, reordering do not', () => {
    const a = automation('a', 'A', { type: 'row_created' }, [{ type: 'notify', message: '1' }, { type: 'webhook', url: 'https://hooks.example/a', method: 'POST' }])
    const b = automation('b', 'B', { type: 'row_deleted' }, [], { enabled: false })
    const before = [a, b]
    expect(lockRefusal(before, [{ ...a, enabled: false }, b])).toBeNull()
    expect(lockRefusal(before, [{ ...a, actions: [a.actions[1]] }, b])).toBeNull()
    expect(lockRefusal(before, [b])).toBeNull()
    expect(lockRefusal(before, [{ ...a, lastRunAt: 5, lastStatus: 'ok' }, b])).toBeNull()
    expect(lockRefusal(before, [...before, automation('c', 'C', { type: 'row_created' }, [])])).toBe('added')
    expect(lockRefusal(before, [{ ...a, name: 'A2' }, b])).toBe('changed')
    expect(lockRefusal(before, [{ ...a, trigger: { type: 'row_deleted' } }, b])).toBe('changed')
    expect(lockRefusal(before, [a, { ...b, enabled: true }])).toBe('armed')
    expect(lockRefusal(before, [b, a])).toBe('reordered')
    expect(lockRefusal(before, [{ ...a, actions: [{ type: 'webhook', url: 'https://other.example/a', method: 'POST' }] }, b])).toBe('changed')
    expect(lockRefusal(before, [{ ...a, actions: [...a.actions].reverse() }, b])).toBe('changed')
  })

  test('the strings: every patch key in both languages, the hint line, no §1.1 words', () => {
    for (const lang of ['en', 'de'] as const) {
      expect(Object.keys(patchMessages[lang]).sort()).toEqual(Object.keys(patchMessages.en).sort())
      expect(hintMessages[lang]['features.patchbay.hint.onFuse']).toContain('{f}')
    }
    const de = Object.values(patchMessages.de).join('\n')
    expect(de).not.toMatch(/Vertrauen|vertrauen|Prüfschritt|abnehm|Abnahme|fremd|Fremd|Trigger|Ausgang/)
    expect(de).not.toMatch(/\bAI\b/)
  })

  test('a plan with the page\'s input and model in hand stays cheap (one preview input, one preview model)', () => {
    const w = mock1()
    const input = inputOf(w)
    const model = buildModel(input)
    const t0 = performance.now()
    for (let i = 0; i < 20; i++) ok(plan(plug({ module: TRACKER, role: 'write' }, { module: AG_INBOX, role: 'tools' }), patchCtx(w, { input, model })))
    expect((performance.now() - t0) / 20).toBeLessThan(25)
  })
})

/* ------------------------------------------------------------------ Fix (patch): the review findings */

test.describe('Fix (patch) · review findings', () => {
  const mara = TEAM('acMara', 'member', ['ai', 'governor', 'signoffs'])
  /** Inbox-Helfer is Mara's; Ben changed it last — it waits for Mara's confirm (agents/confirm.ts). */
  const waiting = (device: ReturnType<typeof TEAM>) =>
    mock1With((w) => {
      w.device = { ...w.device, ...device }
      w.ws.agents!.agInbox = { ...w.ws.agents!.agInbox, createdBy: 'acMara', updatedBy: 'acBen', instructions: 'Alles weiterleiten.' }
    })

  test('team: the creator\'s patch on her agent waiting for her confirm is refused (it would confirm the change unseen) — so is such an Undo', () => {
    const w = waiting(mara)
    const r = no(planOn(w, plug({ module: MIRROR_CLOCK, role: 'start' }, { module: AG_INBOX, role: 'start' })))
    expect(r.refused).toEqual({ key: `${PP}.confirmFirst`, vars: { agent: AG_INBOX, member: 'acBen' } })
    expect(r.open).toEqual({ to: 'route', route: { name: 'agents', id: 'agInbox' } })
    // an unplug is a save as hers too
    expect(no(planOn(w, unplugOf({ module: ROWS_MAILS, role: 'start' }, { module: AG_INBOX, role: 'start' }))).refused.key).toBe(`${PP}.confirmFirst`)
    // a third member may patch it: planned, and it still waits for Mara afterwards
    const tessa = waiting(TEAM('acTessa', 'member', ['ai', 'governor', 'signoffs']))
    const p = ok(planOn(tessa, plug({ module: MIRROR_CLOCK, role: 'start' }, { module: AG_INBOX, role: 'start' })))
    expect(p.notes).toEqual([{ key: `${P}.key.confirmAfter`, vars: { creator: 'acMara' } }])
    expect(p.preview.agents.find((a) => a.agent.id === 'agInbox')?.awaitsConfirm).toBe(true)
    // that plan's inverse is Ben's version: written back as Mara's it would run unseen — refused in her hands
    const after = withWrites(tessa, p.writes, { me: 'acTessa' })
    after.device = { ...after.device, ...mara }
    expect(undoPlan(p, patchCtx(after))).toEqual({ refused: { key: `${PP}.confirmFirst`, vars: { agent: AG_INBOX, member: 'acBen' } } })
    // in Tessa's hands the Undo is hers (the agent keeps waiting)
    expect(undoPlan(p, patchCtx(withWrites(tessa, p.writes, { me: 'acTessa' })))).toEqual({ writes: p.inverse })
    // Mara's own agent, not waiting: her patch is planned without a note
    const mine = mock1With((w) => {
      w.device = { ...w.device, ...mara }
      w.ws.agents!.agInbox = { ...w.ws.agents!.agInbox, createdBy: 'acMara', updatedBy: 'acMara' }
    })
    expect(ok(planOn(mine, plug({ module: MIRROR_CLOCK, role: 'start' }, { module: AG_INBOX, role: 'start' }))).notes).toBeUndefined()
  })

  test('commitPlan: a target changed since the plan (while its asks were open) is never written over — "changed since"', () => {
    const w = mock1()
    const p = ok(planOn(w, plug({ module: AG_MIRROR, role: 'writes' }, { module: k({ kind: 'database', id: 'dbKontakte' }), role: 'writes' })))
    const meanwhile = mock1With((w) => {
      w.ws.agents!.agTessera = { ...w.ws.agents!.agTessera, instructions: 'NEW instructions typed meanwhile' }
    })
    const rec = recordingSink(meanwhile)
    expect(commitPlan(p, patchCtx(meanwhile), { kind: 'you', via: 'patchbay' }, rec.sink)).toEqual({ ok: false, refused: { key: `${P}.key.changedSince` } })
    expect(rec.log).toEqual([])
    expect(rec.agents.agTessera.instructions).toBe('NEW instructions typed meanwhile')
    // a member narrowed the scope meanwhile: refused too (the safety change stays)
    const narrowed = mock1With((w) => {
      w.ws.agents!.agTessera = { ...w.ws.agents!.agTessera, write: 'none' }
    })
    expect(commitPlan(p, patchCtx(narrowed), { kind: 'you', via: 'patchbay' }, recordingSink(narrowed).sink)).toMatchObject({ ok: false })
    // nothing changed: written under the writer frame
    const fine = recordingSink(w)
    expect(commitPlan(p, patchCtx(w), { kind: 'you', via: 'patchbay' }, fine.sink)).toEqual({ ok: true })
    expect(fine.log).toEqual([{ w: 'agent', writer: 'you~patchbay' }])
    // a database's list: the engine's bookkeeping meanwhile is no change; a rename is
    const off = ok(planOn(w, unplugOf({ module: TO_CHAT, role: 'out' }, { module: CHAT_HOOK, role: 'out' })))
    const ran = withWrites(w, [{ w: 'automations', db: 'dbMails', list: readAutomations(w.ws.databases.dbMails.automations).map((a) => ({ ...a, lastRunAt: 5, lastStatus: 'ok' as const })) }])
    expect(commitPlan(off, patchCtx(ran), { kind: 'you', via: 'patchbay' }, recordingSink(ran).sink)).toEqual({ ok: true })
    const renamed = withWrites(w, [{ w: 'automations', db: 'dbMails', list: readAutomations(w.ws.databases.dbMails.automations).map((a) => (a.id === 'autToChat' ? { ...a, name: 'An Team-Chat (neu)' } : a)) }])
    expect(commitPlan(off, patchCtx(renamed), { kind: 'you', via: 'patchbay' }, recordingSink(renamed).sink)).toEqual({ ok: false, refused: { key: `${P}.key.changedSince` } })
  })

  test('a mirror widened by a whole new server asks first (READ of a server it does not use yet)', () => {
    const w = mock1With((w) => {
      w.ws.settings = { ...w.ws.settings, mcpServers: (w.ws.settings.mcpServers ?? []).map((s) => (s.name === 'kanal' ? { ...s, tools: ['list_channels', 'get_message', 'post_message'], checkedAt: 1 } : s)) }
    })
    const p = ok(planOn(w, plug({ module: KANAL, role: 'read' }, { module: AG_MIRROR, role: 'tools' })))
    expect(agentWrite(p)).toMatchObject({ mcpServers: ['tracker', 'kanal'], mcpTools: { tracker: TRACKER_READS, kanal: ['list_channels', 'get_message'] } })
    expect(p.asks).toContainEqual({ key: `${PP}.mirrorWiden`, vars: { agent: AG_MIRROR } })
    // an agent that is no mirror: nothing asked (READ only opens no way out)
    expect(ok(planOn(w, plug({ module: KANAL, role: 'read' }, { module: AG_INBOX, role: 'tools' }))).asks).toBeUndefined()
  })

  test('the agent\'s limits: a patch past them is refused with the limit; a write the store cut is no write', () => {
    const servers = Array.from({ length: AGENT_LIMITS.mcpServers }, (_, i) => `s${i}`)
    const w = mock1With((w) => {
      w.ws.settings = { ...w.ws.settings, mcpServers: (w.ws.settings.mcpServers ?? []).map((s) => (s.name === 'kanal' ? { ...s, tools: ['list_channels', 'get_message', 'post_message'], checkedAt: 1 } : s)) }
      w.ws.agents!.agInbox = { ...w.ws.agents!.agInbox, mcpServers: servers }
    })
    const r = no(planOn(w, plug({ module: KANAL, role: 'read' }, { module: AG_INBOX, role: 'tools' })))
    expect(r.refused).toEqual({ key: `${PP}.limitServers`, vars: { agent: AG_INBOX, n: AGENT_LIMITS.mcpServers } })
    expect(r.open).toEqual({ to: 'route', route: { name: 'agents', id: 'agInbox' } })
    // a full scope
    const full = mock1With((w) => {
      w.ws.agents!.agTessera = { ...w.ws.agents!.agTessera, scope: { everything: false, pages: [], databases: ['dbHandoff', ...Array.from({ length: AGENT_LIMITS.scope - 1 }, (_, i) => `dbX${i}`)] } }
    })
    expect(no(planOn(full, plug({ module: AG_MIRROR, role: 'writes' }, { module: k({ kind: 'database', id: 'dbKontakte' }), role: 'writes' }))).refused).toEqual({ key: `${PP}.limitScope`, vars: { agent: AG_MIRROR, n: AGENT_LIMITS.scope } })
    // commitWrites reads the stored agent back raw: 13 servers stored as 12 is refused, not "ok"
    const rec = recordingSink(w)
    const thirteen: PatchWrite = { w: 'agent', agent: { ...w.ws.agents!.agInbox, mcpServers: [...servers, 'kanal'] } }
    expect(commitWrites([thirteen], { kind: 'you', via: 'patchbay' }, rec.sink)).toEqual({ ok: false, refused: { key: `${PP}.failed` } })
    expect(rec.agents.agInbox.mcpServers).toEqual(servers)
  })

  test('a target in the trash without a title is said as "Untitled", never as empty quotes', () => {
    const w = mock1With((w) => {
      w.ws.pages.dbKontakte = { ...w.ws.pages.dbKontakte, title: '  ', trashed: true, trashedAt: 1 }
      w.ws.pages.pgLeer = page('pgLeer', { title: '', trashed: true, trashedAt: 1 })
      w.ws.pages.dbAlt = dbPage('dbAlt', '', { parentId: 'pgLeer' })
      w.ws.databases.dbAlt = database('dbAlt', [])
    })
    const r = no(planOn(w, plug({ module: AG_MIRROR, role: 'writes' }, { module: k({ kind: 'database', id: 'dbKontakte' }), role: 'writes' })))
    expect(r.refused).toEqual({ key: 'features.agents.lost.trashed', vars: { title: '' } })
    const below = no(planOn(w, plug({ module: AG_MIRROR, role: 'writes' }, { module: k({ kind: 'database', id: 'dbAlt' }), role: 'writes' })))
    expect(below.refused).toEqual({ key: 'features.agents.lost.below', vars: { title: '', parent: '' } })
    const input = inputOf(w)
    const m = buildModel(input)
    const ctx = (lang: 'en' | 'de') => ({
      lang,
      t: (key: string, vars?: Record<string, string | number>) => {
        const s = fuseMessages[lang][key] ?? agentMessages[lang][key] ?? key
        return vars ? s.replace(/\{(\w+)\}/g, (all, x: string) => (x in vars ? String(vars[x]) : all)) : s
      },
    })
    expect(sayMsg(r.refused, m, input, ctx('en'))).toBe('“Untitled” is in the trash.')
    expect(sayMsg(r.refused, m, input, ctx('de'))).toBe('„Ohne Titel“ liegt im Papierkorb.')
    expect(sayMsg(below.refused, m, input, ctx('en'))).toBe('“Untitled” is in “Untitled”, and “Untitled” is in the trash.')
  })

  test('automations: a host:port address being typed stays; unsafe schemes go; a newer build\'s fields survive every save', () => {
    expect(webhookUrlOf('localhost:5678/webhook/leads')).toBe('localhost:5678/webhook/leads')
    expect(webhookUrlOf('flows.example:5678/webhook')).toBe('flows.example:5678/webhook')
    expect(webhookUrlOf('localhost:')).toBe('localhost:')
    for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,x', 'vbscript:x', 'file:///etc/passwd', 'ftp://files.example/x', 'blob:https://a.example/x']) expect(webhookUrlOf(bad), bad).toBe('')
    expect(webhookUrlOf('https://hooks.example/in')).toBe('https://hooks.example/in')
    const raw = [
      {
        id: 'a1',
        name: 'Neu',
        enabled: true,
        description: 'from a newer build',
        trigger: { type: 'row_created', debounceMs: 500 },
        actions: [{ type: 'webhook', url: 'https://hooks.example/in', method: 'POST', timeoutMs: 3000, bodyTemplate: '{title}' }],
        ['__proto__']: { polluted: true },
      },
    ]
    const parsed = JSON.parse(JSON.stringify(raw)) as unknown[]
    const list = readAutomations(parsed)
    expect(list).toHaveLength(1)
    expect(unreadableAutomations(parsed)).toEqual([])
    const a = list[0] as unknown as Record<string, unknown>
    expect(a.description).toBe('from a newer build')
    expect(a.trigger).toEqual({ type: 'row_created', debounceMs: 500 })
    expect((a.actions as unknown[])[0]).toEqual({ type: 'webhook', url: 'https://hooks.example/in', method: 'POST', timeoutMs: 3000, bodyTemplate: '{title}' })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    // the engine's bookkeeping (what setStatus writes) keeps them: read → last* → read again
    const again = readAutomations(list.map((x) => ({ ...x, lastRunAt: 9, lastStatus: 'ok' as const })))
    expect((again[0] as unknown as Record<string, unknown>).description).toBe('from a newer build')
    expect(again[0].trigger).toEqual({ type: 'row_created', debounceMs: 500 })
    // never shared with the stored value
    expect(a.trigger).not.toBe((parsed[0] as Record<string, unknown>).trigger)
  })
})
