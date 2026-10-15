/**
 * The Patchbay ("Schaltplan") — B3: reach and chains (features/patchbay/reach.ts, chains.ts, rules.ts), run by the
 * Playwright runner in Node. Fixtures: tests/fixtures/patchbay.ts (`relays()`, `exits()`, `mock1()`, `bigPatchbay()`, and
 * small worlds built here). Plan §2.5 / §1.3 / §6 A1 A3 A6 A9 A10 A11 A12 A13 A17:
 *  - full reachability: decider → field → kit value → automation → webhook; agent A → automation set_property → agent
 *    B's row trigger → field → automation → webhook — found however long, drawn as 3 steps + "+n";
 *  - taint: a mirror reading MCP writes its database → a local everything agent reading it has content from outside,
 *    "reads Tessera Handoff — written by Tessera-Spiegel from tracker"; Clippings and GitHub pick-ups are from outside,
 *    folder sync is not;
 *  - the engines' rules: a server agent's write starts no automation (a kit relay does), set_property and a script in
 *    run_script start no automation, an agent never starts an agent, set_property starts an agent's row trigger,
 *    autofill follows any local change and no remote one, a repeating clock starts row_created listeners, a field
 *    "only by hand" stops an agent's and the bridge's write (key 2's contract);
 *  - private data relative to the source and the exit; data rules (device rules only for deciders running here; 'mcp'
 *    withheld → no MCP source and no MCP exit); gates; loops; the bigPatchbay(60) budget.
 * Every page and value is fictional.
 */
import { test, expect } from './fixtures'
import { buildModel } from '../../src/app/features/patchbay/model'
import { analyseChains, startsOf, SHOWN_STEPS } from '../../src/app/features/patchbay/chains'
import { moduleKey } from '../../src/app/features/patchbay/ref'
import { placeKey } from '../../src/app/features/patchbay/rules'
import type { Chain, ChainStep, Model, ModelInput } from '../../src/app/features/patchbay/types'
import type { CustomAgent, Database, Page } from '../../src/app/store/types'
import {
  LOCAL_DEVICE,
  TRACKER_READS,
  TRACKER_TOOLS,
  agent,
  automation,
  bigPatchbay,
  database,
  dbPage,
  inputOf,
  mailSettings,
  mock1,
  modelOf,
  page,
  prop,
  relays,
  script,
  server,
  world,
  type PbWorld,
} from '../fixtures/patchbay'

/* ------------------------------------------------------------------ helpers */

const key = moduleKey
const stepNode = (s: ChainStep) => (typeof s.to === 'string' ? s.to : `@${placeKey(s.to)}`)
const agentKey = (id: string) => key({ kind: 'agent', id })
const autKey = (db: string, id: string) => key({ kind: 'automation', db, id })
const hook = (host: string, method = 'POST') => `outbound:webhook:${host}:${method}`
const chainsOf = (m: Model, decider: string) => m.chains.filter((c) => c.decider === decider)
const chainTo = (m: Model, decider: string, exit: string): Chain | undefined => m.chains.find((c) => c.decider === decider && c.exit?.module === exit)
/** Build the rack of a world with an input changed first (data rules, device facts). */
const modelWith = (w: PbWorld, change: (input: ModelInput) => ModelInput) => buildModel(change(inputOf(w)))

const TEAM = (me: string) => ({ ctx: { team: true, me, role: 'member' as const, readOnly: false, supports: ['ai', 'governor'] } })

/** A Mails database (this device's sync target) with „Weiterleiten“ → webhook (chat.example), and a report page. */
function mailWorld(agents: CustomAgent[], over: { servers?: ReturnType<typeof server>[]; pages?: Page[]; databases?: Database[]; device?: Partial<PbWorld['device']>; lazy?: Partial<PbWorld['lazy']> } = {}): PbWorld {
  const mails = database('dbMails', [prop('pMailFwd', 'Weiterleiten', 'checkbox')], {
    system: 'mails',
    automations: [automation('autToChat', 'An Team-Chat', { type: 'property_changed', propertyId: 'pMailFwd' }, [{ type: 'webhook', url: 'https://chat.example/hook', method: 'POST' }])],
  })
  return world({
    pages: [dbPage('dbMails', 'Mails'), page('pgReport', { title: 'Bericht' }), ...(over.pages ?? [])],
    databases: [mails, ...(over.databases ?? [])],
    agents,
    servers: over.servers ?? [],
    mail: mailSettings('dbMails'),
    device: over.device,
    lazy: over.lazy,
  })
}

const ALPHA = () => server('srvAlpha', 'alpha', { tools: ['list_items', 'create_item'], checkedAt: 1 })
const TRACKER = () => server('srvTracker', 'tracker', { tools: [...TRACKER_TOOLS], checkedAt: 1 })
const alphaKey = key({ kind: 'server', id: 'srvAlpha', name: 'alpha' })
const trackerKey = key({ kind: 'server', id: 'srvTracker', name: 'tracker' })

/* ------------------------------------------------------------------ full reachability */

test.describe('B3 · full reachability (§2.5, §6 A1)', () => {
  test('decider → field → kit value → automation → webhook: the server agent reaches the hook through the kit relay', () => {
    const w = relays()
    const m = modelOf(w)
    const srv = agentKey('agTesseraServer')
    const kit = key({ kind: 'kit', db: 'dbTessera', prop: 'pTesseraPunkte', type: 'ptPunkte' })
    const punkte = autKey('dbTessera', 'autPunkte')
    const c = chainTo(m, srv, hook('relay.example'))!
    expect(c.steps.map(stepNode)).toEqual(['@dbTessera:*', kit, '@dbTessera:pTesseraPunkte', punkte, hook('relay.example')])
    expect(c.via?.relay).toEqual([kit, punkte])
    expect([c.gate, c.lamps?.out.on, c.exit?.type]).toEqual([undefined, true, 'webhook'])
    // drawn: 3 steps, the rest "+2 steps" — and the exit still counts
    expect([c.shown, c.steps.length - c.shown]).toEqual([SHOWN_STEPS, 2])
    // the cables it lights: the agent's flag, the relay, the kit's flag, the automation's start, the hook
    expect(c.edges).toEqual([`${srv}.writes>net:dbTessera:*`, `net:dbTessera:*>${kit}.start`, `${kit}.writes>net:dbTessera:pTesseraPunkte`, `net:dbTessera:pTesseraPunkte>${punkte}.start`, `${punkte}.out>${hook('relay.example')}.out`])
  })

  test('agent A → set_property → agent B’s row trigger → field → automation → webhook: 7 steps, drawn 3 + "+4", counted', () => {
    const m = modelOf(relays())
    const a = agentKey('agLaunchA')
    const b = agentKey('agLaunchB')
    const freigabe = autKey('dbLaunch', 'autFreigabe')
    const versand = autKey('dbVersand', 'autVersand')
    const c = chainTo(m, a, hook('launch.example'))!
    expect(c.steps.map(stepNode)).toEqual(['@dbLaunch:pLaunchPhase', freigabe, '@dbLaunch:pLaunchFreigabe', b, '@dbVersand:pVersandFlag', versand, hook('launch.example')])
    expect([c.shown, c.steps.length]).toEqual([3, 7])
    expect(c.via?.relay).toEqual([freigabe, b, versand])
    expect(c.lamps?.out.on).toBe(true)
    // B has its own, shorter path to the same hook
    expect(chainTo(m, b, hook('launch.example'))?.steps.map(stepNode)).toEqual(['@dbVersand:pVersandFlag', versand, hook('launch.example')])
    // without the relay automation A reaches no hook at all
    const w = relays()
    w.ws.databases.dbLaunch = { ...w.ws.databases.dbLaunch, automations: [] }
    expect(chainsOf(modelOf(w), a)).toEqual([])
  })

  test('the analysis is deterministic and holds ids only', () => {
    const a = analyseChains(modelOf(relays()), inputOf(relays()))
    const b = analyseChains(modelOf(relays()), inputOf(relays()))
    expect(JSON.stringify(a.chains)).toBe(JSON.stringify(b.chains))
    for (const t of ['Tessera-Pflege', 'Launch-Planer', 'Launch-Versand', 'Punkte → Hook', 'Versandliste']) expect(JSON.stringify(a.chains)).not.toContain(t)
  })
})

/* ------------------------------------------------------------------ taint */

/** Tessera-Spiegel (tracker reads only, stage) writes Tessera Handoff + its report; Nordlicht-Assistent reads everything. */
function taintWorld(over: { device?: Partial<PbWorld['device']>; lazy?: Partial<PbWorld['lazy']>; pages?: Page[] } = {}): PbWorld {
  const handoff = database('dbHandoff', [prop('pHandoffStatus', 'Status', 'text')])
  const notes = database('dbNotes', [prop('pNotesFlag', 'Teilen', 'checkbox')], {
    automations: [automation('autShare', 'Teilen → Hook', { type: 'property_changed', propertyId: 'pNotesFlag' }, [{ type: 'webhook', url: 'https://share.example/in', method: 'POST' }])],
  })
  return world({
    pages: [dbPage('dbHandoff', 'Tessera Handoff'), dbPage('dbNotes', 'Notizen'), page('pgBericht', { title: 'Bericht' }), ...(over.pages ?? [])],
    databases: [handoff, notes],
    agents: [
      agent('agTessera', 'Tessera-Spiegel', { write: 'stage', scope: { everything: false, pages: [], databases: ['dbHandoff'] }, output: { pageId: 'pgBericht', mode: 'append' }, mcpServers: ['tracker'], mcpTools: { tracker: [...TRACKER_READS] }, mirrorOf: 'dbHandoff', trigger: { type: 'schedule', every: 'weekday', at: '07:30', tz: 'Europe/Berlin' } }),
      agent('agNordlicht', 'Nordlicht-Assistent', { write: 'apply', scope: { everything: true, pages: [], databases: [] }, trigger: { type: 'schedule', every: 'day', at: '06:00', tz: 'Europe/Berlin' } }),
    ],
    servers: [TRACKER()],
    device: over.device,
    lazy: over.lazy,
  })
}

test.describe('B3 · taint — places written from outside (§1.3 #2, §6 A3)', () => {
  test('the mirror reads MCP and writes Tessera Handoff → tainted; the everything agent reads it: "written by Tessera-Spiegel from tracker"', () => {
    const w = taintWorld()
    const m = modelOf(w)
    const a = analyseChains(m, inputOf(w))
    const mirror = agentKey('agTessera')
    const helper = agentKey('agNordlicht')
    // the mirror is fed from outside by its tracker reads; its database and report page are from outside now
    expect(a.fed.get(mirror)).toMatchObject({ kind: 'mcp', source: trackerKey, via: 'tools' })
    expect(a.outside.dbs.get('dbHandoff')).toEqual([{ kind: 'tainted', source: mirror, writer: mirror, from: trackerKey }])
    expect(a.outside.pages.get('pgBericht')).toEqual([{ kind: 'tainted', source: mirror, writer: mirror, from: trackerKey }])
    const c = chainTo(m, helper, hook('share.example'))!
    expect(c.source).toBe(mirror)
    expect(c.why?.outside[0]).toEqual({ kind: 'tainted', source: mirror, place: { db: 'dbHandoff' }, via: 'scope', writer: mirror, from: trackerKey })
    expect(c.lamps?.outside).toEqual({
      on: true,
      say: { key: 'features.patchbay.lamp.outside.tainted', vars: { source: mirror, db: 'dbHandoff', place: 'dbHandoff:*', writer: mirror, from: trackerKey } },
      detail: { key: 'features.patchbay.lamp.outside.more', vars: { n: 1 } },
    })
    expect(c.via?.taint).toEqual([{ db: 'dbHandoff' }, { page: 'pgBericht' }])
    // on the rack: the agent's "reads everything" tag and the mirror's cable carry the mark (its own writes never count)
    expect(m.modules.find((x) => x.key === helper)?.nets).toEqual([{ place: { everything: true }, tainted: true, writer: mirror }])
    expect(m.edges.find((e) => e.id === `${mirror}.writes>database:dbHandoff.writes`)?.tainted).toBe(true)
    expect(m.modules.find((x) => x.key === mirror)?.nets).toEqual([{ place: { db: 'dbHandoff' }, tainted: true, writer: helper }])
  })

  test('mock 1: Inbox-Helfer reads mail first; the Tessera taint is named as a further source', () => {
    const w = mock1()
    const m = modelOf(w)
    const helper = agentKey(w.ids.inboxHelper)
    const c = chainTo(m, helper, hook('chat.example'))!
    expect(c.key).toBe(`rowTrigger:dbMails:created:->${helper}>@dbMails:pMailFwd>${autKey('dbMails', 'autToChat')}>${hook('chat.example')}`)
    // direct content first (the mail that started it), then every place written from outside — never its own writes
    const mirror = agentKey(w.ids.mirror)
    expect(c.why?.outside.map((s) => [s.kind, s.via, s.place, s.writer ?? null, s.from ?? null])).toEqual([
      ['mail', 'trigger', { db: w.ids.mails }, null, null],
      ['tainted', 'scope', { db: w.ids.handoff }, mirror, key({ kind: 'server', id: w.ids.tracker, name: 'tracker' })],
      ['tainted', 'scope', { page: w.ids.bericht }, mirror, key({ kind: 'server', id: w.ids.tracker, name: 'tracker' })],
      // the folded „Kontakt anlegen“ copies each new mail into Kontakte
      ['tainted', 'scope', { db: w.ids.kontakte }, autKey(w.ids.mails, w.ids.toContact), 'rowTrigger:dbMails:created:-'],
      // Wochenbericht reads Tessera Handoff (which Inbox-Helfer may write too) into Bericht
      ['tainted', 'scope', { page: w.ids.bericht }, key({ kind: 'script', id: w.ids.weekly }), helper],
    ])
    expect(c.lamps?.outside.say).toMatchObject({ key: 'features.patchbay.lamp.outside.mail', vars: { db: 'dbMails' } })
  })

  test('Clippings and GitHub pick-ups are from outside; folder sync is not', () => {
    const clip = taintWorld({ pages: [page('inbxNordlicht', { title: 'Inbox' })], lazy: { inbox: 'inbxNordlicht' } })
    clip.ws.agents = { agNordlicht: clip.ws.agents!.agNordlicht }
    const helper = agentKey('agNordlicht')
    const cm = modelOf(clip)
    expect(chainTo(cm, helper, hook('share.example'))?.why?.outside.map((s) => [s.kind, s.source])).toEqual([['clippings', 'clippings:inbxNordlicht']])
    const sync = (github: boolean, folder: boolean) => {
      const w = taintWorld({ device: { sync: { github: { configured: github, auto: false, everyMin: 15, includePrivate: false, repo: github ? 'nordlicht/notes' : null }, folder: { configured: folder } } } })
      w.ws.agents = { agNordlicht: w.ws.agents!.agNordlicht }
      return chainTo(modelOf(w), helper, hook('share.example'))!
    }
    expect(sync(true, false).why?.outside.map((s) => [s.kind, s.source])).toEqual([['github', 'sync:github']])
    const folder = sync(false, true)
    expect(folder.why?.outside).toEqual([])
    expect(folder.lamps?.outside).toEqual({ on: false, say: { key: 'features.patchbay.lamp.outside.none' } })
    expect(folder.source).toBe(helper)
  })
})

/* ------------------------------------------------------------------ engine rules */

test.describe('B3 · the engines’ rules (§1.3)', () => {
  test('a server agent’s write starts no automation — unless a kit relay sits between', () => {
    const w = relays()
    w.ws.databases.dbTessera = {
      ...w.ws.databases.dbTessera,
      automations: [...(w.ws.databases.dbTessera.automations ?? []), automation('autStatus', 'Status → Hook', { type: 'property_changed', propertyId: 'pTesseraStatus' }, [{ type: 'webhook', url: 'https://status.example/in', method: 'POST' }])],
    }
    const m = modelOf(w)
    const srv = agentKey('agTesseraServer')
    expect(chainTo(m, srv, hook('status.example'))).toBeUndefined()
    expect(chainTo(m, srv, hook('relay.example'))).toBeDefined()
    expect(startsOf(m, inputOf(w), srv)).toEqual([key({ kind: 'kit', db: 'dbTessera', prop: 'pTesseraPunkte', type: 'ptPunkte' })])
    // without the kit's value property: nothing
    const plain = relays()
    plain.ws.kit = undefined
    expect(chainsOf(modelOf(plain), srv)).toEqual([])
  })

  test('set_property starts no automation but an agent’s row trigger; an agent never starts an agent directly', () => {
    const w = relays()
    w.ws.databases.dbLaunch = {
      ...w.ws.databases.dbLaunch,
      automations: [...(w.ws.databases.dbLaunch.automations ?? []), automation('autFreiHook', 'Freigabe → Hook', { type: 'property_changed', propertyId: 'pLaunchFreigabe' }, [{ type: 'webhook', url: 'https://freigabe.example/in', method: 'POST' }])],
    }
    w.ws.agents!.agLaunchC = agent('agLaunchC', 'Launch-Prüfer', { write: 'apply', scope: { everything: false, pages: [], databases: ['dbLaunch'] }, trigger: { type: 'row_changed', databaseId: 'dbLaunch', propertyId: 'pLaunchPhase' } })
    const m = modelOf(w)
    const input = inputOf(w)
    // the set_property automation starts agent B (its row trigger) — not the automation on the same field
    expect(startsOf(m, input, autKey('dbLaunch', 'autFreigabe'))).toEqual([agentKey('agLaunchB')])
    // agent A's write starts automations, never agent C (agents skip agent writers)
    expect(startsOf(m, input, agentKey('agLaunchA'))).toEqual([autKey('dbLaunch', 'autFreiHook'), autKey('dbLaunch', 'autFreigabe')])
    // A reaches the Freigabe hook by writing Freigabe itself — never through set_property
    expect(chainTo(m, agentKey('agLaunchA'), hook('freigabe.example'))?.steps.map(stepNode)).toEqual(['@dbLaunch:pLaunchFreigabe', autKey('dbLaunch', 'autFreiHook'), hook('freigabe.example')])
  })

  test('a script inside run_script starts no automation (paused); run by hand it does', () => {
    const a = database('dbAuftrag', [prop('pFertig', 'Fertig', 'checkbox'), prop('pArchiv', 'Archiv', 'checkbox')], {
      automations: [
        automation('autFertig', 'Fertig → Skript', { type: 'property_changed', propertyId: 'pFertig' }, [{ type: 'run_script', scriptId: 'scStatus' }]),
        automation('autArchiv', 'Archiv → Skript', { type: 'property_changed', propertyId: 'pArchiv' }, [{ type: 'run_script', scriptId: 'scStatus' }]),
      ],
    })
    const b = database('dbBestand', [prop('pBestandStatus', 'Status', 'text')], {
      automations: [automation('autBestand', 'Status → Hook', { type: 'property_changed', propertyId: 'pBestandStatus' }, [{ type: 'webhook', url: 'https://bestand.example/in', method: 'POST' }])],
    })
    const w = world({
      pages: [dbPage('dbAuftrag', 'Aufträge'), dbPage('dbBestand', 'Bestand')],
      databases: [a, b],
      scripts: [script('scStatus', 'Status setzen', 'for r in db(@[Bestand](p:dbBestand)) { r.set(Status: "fertig") }')],
      agents: [agent('agPlaner', 'Planer', { write: 'apply', scope: { everything: false, pages: [], databases: ['dbAuftrag'] }, trigger: { type: 'schedule', every: 'day', at: '08:00', tz: 'Europe/Berlin' } })],
    })
    const m = modelOf(w)
    const input = inputOf(w)
    const sc = key({ kind: 'script', id: 'scStatus' })
    expect(startsOf(m, input, autKey('dbAuftrag', 'autFertig'))).toEqual([sc])
    expect(startsOf(m, input, sc, { runScript: true })).toEqual([])
    expect(startsOf(m, input, sc)).toEqual([autKey('dbBestand', 'autBestand')])
    expect(chainsOf(m, agentKey('agPlaner'))).toEqual([])
  })

  test('autofill follows any local change of its row — never a remote (server agent) write', () => {
    const leads = database('dbLeads', [prop('pLeadNote', 'Notiz', 'text'), prop('pLeadSum', 'Zusammenfassung', 'text', { autofill: { preset: 'summary', auto: true, skipReview: true } })])
    const mk = (runner: 'browser' | 'server') =>
      world({
        pages: [dbPage('dbLeads', 'Leads')],
        databases: [leads],
        agents: [agent('agLeads', 'Lead-Pfleger', { runner, write: 'apply', scope: { everything: false, pages: [], databases: ['dbLeads'] }, trigger: { type: 'schedule', every: 'day', at: '08:00', tz: 'Europe/Berlin' }, createdBy: 'acMara' })],
        servers: [server('srvBeta', 'beta', { scope: 'all', tools: ['get_record', 'update_record'], checkedAt: 1 })],
        ...(runner === 'server' ? { device: TEAM('acMara'), lazy: { hooks: [], tokens: [] } } : {}),
      })
    const af = key({ kind: 'autofill', db: 'dbLeads', prop: 'pLeadSum' })
    const local = mk('browser')
    const lm = modelOf(local)
    expect(startsOf(lm, inputOf(local), agentKey('agLeads'))).toEqual([af])
    const c = chainTo(lm, agentKey('agLeads'), key({ kind: 'server', id: 'srvBeta', name: 'beta' }))!
    expect(c.steps.map(stepNode)).toEqual(['@dbLeads:*', af, key({ kind: 'server', id: 'srvBeta', name: 'beta' })])
    const remote = mk('server')
    const rm = modelOf(remote)
    expect(startsOf(rm, inputOf(remote), agentKey('agLeads'))).toEqual([])
    expect(chainsOf(rm, agentKey('agLeads'))).toEqual([])
  })

  test('a route this build can never run: the agent is no decider and carries no path onward', () => {
    const w = relays()
    // agent B's own pins name a provider this build cannot run browser agents on (RUNNABLE_PROVIDERS)
    w.ws.agents!.agLaunchB = { ...w.ws.agents!.agLaunchB, route: [{ p: 'openrouter', m: 'nordlicht/tessera-mini' }] }
    const m = modelOf(w)
    expect(chainsOf(m, agentKey('agLaunchB'))).toEqual([])
    expect(chainTo(m, agentKey('agLaunchA'), hook('launch.example'))).toBeUndefined()
    expect(startsOf(m, inputOf(w), agentKey('agLaunchB'))).toEqual([])
  })

  test('a repeating clock starts row_created listeners (automations, agents)', () => {
    const repeat = { freq: 'weekly', days: [1], time: '09:00', start: '2026-10-12', title: '{{name}}', dateProperty: null } as unknown as NonNullable<NonNullable<Database['templates']>[number]['repeat']>
    const meet = database('dbMeet', [], {
      templates: [{ id: 'tplWoche', name: 'Woche', content: null, properties: {}, repeat }] as Database['templates'],
      automations: [automation('autNeu', 'Neu → Hook', { type: 'row_created' }, [{ type: 'webhook', url: 'https://meet.example/new', method: 'POST' }])],
    })
    const w = world({ pages: [dbPage('dbMeet', 'Meetings')], databases: [meet], agents: [agent('agProtokoll', 'Protokoll', { write: 'stage', scope: { everything: false, pages: [], databases: ['dbMeet'] }, trigger: { type: 'row_created', databaseId: 'dbMeet' } })] })
    const m = modelOf(w)
    const clock = key({ kind: 'clock', schedule: '', agents: [], template: { db: 'dbMeet', id: 'tplWoche' } })
    expect(startsOf(m, inputOf(w), clock)).toEqual([agentKey('agProtokoll'), autKey('dbMeet', 'autNeu')])
  })

  test('a field "only by hand" stops an agent’s and the bridge’s write — the path closes (key 2’s contract)', () => {
    const helper = agentKey('agInbox')
    const w = mailWorld([agent('agInbox', 'Inbox-Helfer', { write: 'apply', scope: { everything: true, pages: [], databases: [] }, trigger: { type: 'row_created', databaseId: 'dbMails' } })], { device: { bridge: { enabled: true, mode: 'apply' } } })
    const bridge = key({ kind: 'bridge' })
    const open = modelOf(w)
    expect(chainTo(open, helper, hook('chat.example'))?.lamps?.out.on).toBe(true)
    expect(chainTo(open, bridge, hook('chat.example'))?.lamps?.out.on).toBe(true)
    w.ws.databases.dbMails = { ...w.ws.databases.dbMails, properties: w.ws.databases.dbMails.properties.map((p) => (p.id === 'pMailFwd' ? { ...p, agentReadOnly: true } : p)) }
    const closed = modelOf(w)
    expect(chainTo(closed, helper, hook('chat.example'))).toBeUndefined()
    expect(chainTo(closed, bridge, hook('chat.example'))).toBeUndefined()
    // the drawing follows: no flag from the agent into „Weiterleiten“ — a person's edit starts the automation
    expect(closed.nets.find((n) => n.key === 'net:dbMails:pMailFwd')).toBeUndefined()
  })
})

/* ------------------------------------------------------------------ private */

test.describe('B3 · private data, relative to the source and the exit (§1.3 #3, §6 A6 / A10)', () => {
  const mailAgent = (over: Partial<CustomAgent> = {}) =>
    agent('agLeser', 'Mail-Leser', { write: 'apply', scope: { everything: false, pages: ['pgReport'], databases: [] }, output: { pageId: 'pgReport', mode: 'append' }, trigger: { type: 'row_created', databaseId: 'dbMails' }, mcpServers: ['alpha'], mcpTools: { alpha: ['create_item'] }, ...over })
  const leser = agentKey('agLeser')

  test('the outside row and the report page only → off; with the mail database in scope its other rows → on', () => {
    const only = modelOf(mailWorld([mailAgent()], { servers: [ALPHA()] }))
    const c = chainTo(only, leser, alphaKey)!
    expect([c.lamps?.outside.on, c.lamps?.private, c.lamps?.out.on]).toEqual([true, { on: false, say: { key: 'features.patchbay.lamp.private.none' } }, true])
    // the same agent may read (and mark) Mails: an automation on Mails sends the row it chooses → "other rows of Mails"
    const rows = modelOf(mailWorld([mailAgent({ scope: { everything: false, pages: ['pgReport'], databases: ['dbMails'] } })], { servers: [ALPHA()] }))
    const hookChain = chainTo(rows, leser, hook('chat.example'))!
    expect(hookChain.why?.private).toEqual([{ kind: 'otherRows', place: { db: 'dbMails' } }])
    expect(hookChain.lamps?.private).toEqual({ on: true, say: { key: 'features.patchbay.lamp.private.otherRows', vars: { db: 'dbMails' } } })
    expect(chainTo(rows, leser, alphaKey)?.lamps?.private.on).toBe(true)
  })

  test('everything, another server’s reads and One memory each light it', () => {
    const all = modelOf(mailWorld([mailAgent({ scope: { everything: true, pages: [], databases: [] } })], { servers: [ALPHA()] }))
    expect(chainTo(all, leser, alphaKey)?.why?.private[0]).toEqual({ kind: 'everything', n: 1 })
    // reads of another server go out through alpha's write tool; alpha's own reads would go back to alpha
    const two = modelOf(mailWorld([mailAgent({ mcpServers: ['alpha', 'tracker'], mcpTools: { alpha: ['list_items', 'create_item'], tracker: [...TRACKER_READS] } })], { servers: [ALPHA(), TRACKER()] }))
    expect(chainTo(two, leser, alphaKey)?.why?.private).toEqual([{ kind: 'mcp', server: trackerKey }])
    const memory = modelOf(mailWorld([mailAgent()], { servers: [ALPHA()], databases: [database('dbMemory', [], { system: 'memory' })], pages: [dbPage('dbMemory', 'One-Gedächtnis')] }))
    expect(chainTo(memory, leser, alphaKey)?.why?.private).toEqual([{ kind: 'memory' }])
  })

  test('this device’s GitHub push carries every page of a local workspace: only other servers’ reads count', () => {
    const device = { sync: { github: { configured: true, auto: true, everyMin: 15, includePrivate: false, repo: 'nordlicht/notes' }, folder: { configured: false } } }
    const push = 'outbound:sync:nordlicht%2Fnotes:push'
    const plain = modelOf(mailWorld([mailAgent({ scope: { everything: true, pages: [], databases: [] }, mcpServers: [], mcpTools: undefined })], { device }))
    const c = chainTo(plain, leser, push)!
    expect([c.exit?.type, c.lamps?.outside.on, c.lamps?.private.on, c.lamps?.out.on]).toEqual(['sync', true, false, true])
    const reads = modelOf(mailWorld([mailAgent({ scope: { everything: true, pages: [], databases: [] }, mcpServers: ['tracker'], mcpTools: { tracker: [...TRACKER_READS] } })], { device, servers: [TRACKER()] }))
    expect(chainTo(reads, leser, push)?.why?.private).toEqual([{ kind: 'mcp', server: trackerKey }])
  })

  test('team: a private page in reach is named ("private page")', () => {
    const w = world({
      pages: [dbPage('dbTeam', 'Launch plan'), page('pgPrivat', { title: 'Mara privat', private: true }), page('pgReport', { title: 'Bericht' })],
      databases: [database('dbTeam', [])],
      agents: [agent('agMara', 'Mara-Helfer', { write: 'apply', createdBy: 'acMara', updatedBy: 'acMara', scope: { everything: false, pages: ['pgPrivat'], databases: [] }, output: { pageId: 'pgReport', mode: 'append' }, mcpServers: ['tracker', 'alpha'], mcpTools: { tracker: [...TRACKER_READS], alpha: ['create_item'] } })],
      servers: [TRACKER(), ALPHA()],
      device: TEAM('acMara'),
      lazy: { hooks: [], tokens: [] },
    })
    const c = chainTo(modelOf(w), agentKey('agMara'), alphaKey)!
    expect(c.why?.private).toEqual([
      { kind: 'named', place: { page: 'pgPrivat' }, private: true },
      { kind: 'mcp', server: trackerKey },
    ])
    expect(c.lamps?.private.detail).toEqual({ key: 'features.patchbay.lamp.private.privatePage', vars: { page: 'pgPrivat' } })
  })
})

/* ------------------------------------------------------------------ data rules */

test.describe('B3 · data rules (§1.3 #2, §6 A17)', () => {
  const reader = (over: Partial<CustomAgent> = {}) => agent('agLeser', 'Mail-Leser', { write: 'apply', scope: { everything: false, pages: [], databases: ['dbMails'] }, trigger: { type: 'row_created', databaseId: 'dbMails' }, mcpServers: ['tracker'], ...over })
  const narrow = (cls: 'mcp' | 'mail') => (input: ModelInput): ModelInput => ({ ...input, ai: { ...input.ai, device: { narrow: { anthropic: [cls] } } } })

  test('"mcp" withheld on this device: no MCP source and no MCP exit for a decider running here', () => {
    const w = mailWorld([reader()], { servers: [TRACKER()] })
    const open = modelOf(w)
    const leser = agentKey('agLeser')
    expect(chainTo(open, leser, trackerKey)?.lamps?.out.on).toBe(true)
    const m = modelWith(w, narrow('mcp'))
    const c = chainTo(m, leser, trackerKey)!
    expect([c.withheld, c.lamps?.out]).toEqual(['mcp', { on: false, say: { key: 'features.patchbay.lamp.out.dataRule', vars: { cls: 'mcp', server: trackerKey } } }])
    expect(c.why?.outside.find((s) => s.kind === 'mcp')).toMatchObject({ withheld: 'mcp' })
    // the hook path stays — its tracker reads are no private data any more
    expect(chainTo(m, leser, hook('chat.example'))?.why?.private).toEqual([{ kind: 'otherRows', place: { db: 'dbMails' } }])
  })

  test('"mail" withheld: the mail rows are no source for it — the lamp says why', () => {
    const w = mailWorld([reader({ mcpServers: [] })])
    const c = chainTo(modelWith(w, narrow('mail')), agentKey('agLeser'), hook('chat.example'))!
    expect(c.lamps?.outside).toMatchObject({ on: false, say: { key: 'features.patchbay.lamp.outside.dataRule', vars: { cls: 'mail', db: 'dbMails' } } })
    expect(c.source).toBe('rowTrigger:dbMails:created:-')
  })

  test('device rules only for deciders running here: a server agent keeps its MCP; a workspace rule holds for it', () => {
    const w = world({
      pages: [dbPage('dbTickets', 'Tickets')],
      databases: [database('dbTickets', [])],
      agents: [agent('agServer', 'Ticket-Wächter', { runner: 'server', write: 'apply', createdBy: 'acMara', scope: { everything: false, pages: [], databases: ['dbTickets'] }, mcpServers: ['tracker'] })],
      servers: [TRACKER()],
      device: TEAM('acNordlicht'),
      lazy: { hooks: [], tokens: [], runtime: [{ name: 'tracker', host: 'tracker.example' }] },
    })
    const srv = agentKey('agServer')
    const rt = key({ kind: 'server', id: null, name: 'tracker', runtime: true })
    expect(chainTo(modelWith(w, narrow('mcp')), srv, rt)?.lamps?.out.on).toBe(true)
    const forbid = (input: ModelInput): ModelInput => ({ ...input, ai: { ...input.ai, workspace: { policy: { providers: { anthropic: { allow: ['public', 'structure', 'selection', 'page', 'rows', 'files', 'workspace', 'people', 'transcript'], forbid: ['mcp'] } }, restricted: [] } } } })
    expect(chainTo(modelWith(w, forbid), srv, rt)?.withheld).toBe('mcp')
  })
})

/* ------------------------------------------------------------------ gates */

test.describe('B3 · gates — a person in between (§1.3)', () => {
  test('a stage agent’s proposals gate its writes; its MCP tools run in the loop, ungated', () => {
    const w = mailWorld([agent('agStage', 'Mail-Vorschlag', { write: 'stage', scope: { everything: false, pages: [], databases: ['dbMails'] }, trigger: { type: 'row_created', databaseId: 'dbMails' }, mcpServers: ['alpha'] })], { servers: [ALPHA()] })
    const m = modelOf(w)
    const c = chainTo(m, agentKey('agStage'), hook('chat.example'))!
    expect([c.gate, c.lamps?.out]).toEqual(['proposals', { on: false, say: { key: 'features.patchbay.lamp.out.gate.proposals', vars: { module: hook('chat.example'), host: 'chat.example', method: 'POST', via: autKey('dbMails', 'autToChat') } } }])
    expect(chainTo(m, agentKey('agStage'), alphaKey)?.gate).toBeUndefined()
  })

  test('script effects and the bridge in "ask" ask first; an Outbox route and a command webhook wait for a press', () => {
    const a = database('dbAuftrag', [prop('pFertig', 'Fertig', 'checkbox')], {
      automations: [automation('autFertig', 'Fertig → Senden', { type: 'property_changed', propertyId: 'pFertig' }, [{ type: 'run_script', scriptId: 'scSenden' }])],
      commands: [{ id: 'cmdMelden', kind: 'actions', label: 'Melden', icon: null, config: { actions: [{ id: 'c1', type: 'webhook', url: 'https://cmd.example/ping', method: 'POST' }] } }],
    })
    const w = world({
      pages: [dbPage('dbAuftrag', 'Aufträge')],
      databases: [a],
      scripts: [script('scSenden', 'Senden', 'http.post("https://script.example/in", { text: page.current.title })')],
      agents: [agent('agPlaner', 'Planer', { write: 'apply', scope: { everything: false, pages: [], databases: ['dbAuftrag'] } })],
      sends: { dbAuftrag: [{ profile: 'alpha', route: 'reply', tool: 'send_message', server: 'alpha' }] },
      device: { bridge: { enabled: true, mode: 'ask' } },
    })
    const m = modelOf(w)
    const planer = agentKey('agPlaner')
    expect(chainTo(m, planer, 'outbound:http:-:POST')?.gate).toBe('asks')
    expect(chainTo(m, planer, 'outbox:alpha:reply')?.gate).toBe('byHand')
    expect(chainTo(m, planer, hook('cmd.example'))?.gate).toBe('byHand')
    const bridge = key({ kind: 'bridge' })
    expect(chainTo(m, bridge, 'outbound:http:-:POST')?.gate).toBe('asks')
    expect(chainsOf(m, bridge).every((c) => !!c.gate)).toBe(true)
  })

  test('coding: an agent-written task waits for Confirm; otherwise the approvals decide per git stage, a team too (fix model)', () => {
    const stages = [
      { id: 'stQueue', kind: 'queue', auto: true },
      { id: 'stPush', kind: 'git', auto: true, gitAction: 'push' },
    ] as Database['pipeline']
    const mk = (device: Partial<PbWorld['device']> = {}, opts: { autofill?: boolean } = {}) =>
      world({
        pages: [dbPage('dbCoding', 'Coding · nordlicht')],
        databases: [database('dbCoding', [prop('pCodingNote', 'Notiz', 'text'), ...(opts.autofill ? [prop('pCodingSum', 'Plan', 'text', { autofill: { preset: 'summary', auto: true } })] : [])], { system: 'coding', pipeline: stages })],
        agents: [agent('agCoder', 'Aufgaben-Schreiber', { write: 'apply', createdBy: 'acMara', scope: { everything: false, pages: [], databases: ['dbCoding'] } })],
        device,
        lazy: device.ctx?.team ? { hooks: [], tokens: [] } : {},
      })
    const push = 'outbound:git:-:push'
    const coder = agentKey('agCoder')
    const af = key({ kind: 'autofill', db: 'dbCoding', prop: 'pCodingSum' })
    const local = (approvals: 'all' | 'review' | 'none', autofill = false) => modelOf(mk({ worker: { ...LOCAL_DEVICE.worker, approvals } }, { autofill }))
    // an agent's task waits for Confirm, whatever the approvals say
    expect(chainTo(local('none'), coder, push)?.gate).toBe('confirm')
    // autofill writes the task: the approvals decide per git stage (coding/tasks.ts skipsGate) — none = unattended; this
    // pipeline has no gate stage before the push at all, so "all" stops nowhere either
    expect(chainTo(local('none', true), af, push)?.gate).toBeUndefined()
    expect(chainTo(local('none', true), af, push)?.lamps?.out.on).toBe(true)
    expect(chainTo(local('all', true), af, push)?.gate).toBeUndefined()
    // the agent's write starts that autofill, which writes the task last: the agent's path no longer waits (the
    // pipeline's way out depends on who entered it — a Confirm entry never hides an unattended one)
    const relay = chainTo(local('none', true), coder, push)!
    expect([relay.gate, relay.steps.map(stepNode)]).toEqual([undefined, ['@dbCoding:*', af, 'pipeline:dbCoding', push]])
    // a team: the agent's write never carries trust (isAgentWriting) — and autofill's write on that row after it leaves
    // it untrusted; autofill writing a trusted task in the worker's tab keeps it trusted (coding/trust.ts): approvals
    const team = modelOf(mk({ ...TEAM('acMara'), worker: { ...LOCAL_DEVICE.worker, approvals: 'none', confirm: 'always' } }, { autofill: true }))
    expect([chainTo(team, coder, push)?.gate, chainTo(team, af, push)?.gate]).toEqual(['confirm', undefined])
  })

  test('a hand start is no gate: a switched-off agent pressed from a command reaches its way out unattended', () => {
    const w = mailWorld([agent('agOff', 'Ruhender Helfer', { enabled: false, write: 'apply', scope: { everything: false, pages: [], databases: ['dbMails'] } })])
    w.ws.databases.dbMails = { ...w.ws.databases.dbMails, commands: [{ id: 'cmdRun', kind: 'agent', label: 'Helfer starten', icon: null, config: { agentId: 'agOff' } }] }
    const m = modelOf(w)
    const off = agentKey('agOff')
    expect(m.edges.some((e) => e.to === `${off}.start` && e.byHand)).toBe(true)
    const c = chainTo(m, off, hook('chat.example'))!
    expect([c.gate, c.lamps?.outside.on, c.lamps?.private.on, c.lamps?.out.on]).toEqual([undefined, true, true, true])
  })
})

/* ------------------------------------------------------------------ loops */

test.describe('B3 · loops (↺)', () => {
  test('a loop is found once, marked on the chains that pass it, and the walk ends', () => {
    const kreis = database('dbKreis', [prop('pKreisNotiz', 'Notiz', 'text'), prop('pKreisStatus', 'Status', 'text')], {
      automations: [
        automation('autNotiz', 'Notiz → Status', { type: 'property_changed', propertyId: 'pKreisNotiz' }, [{ type: 'set_property', propertyId: 'pKreisStatus', value: 'neu' }]),
        automation('autStatus', 'Status → Hook', { type: 'property_changed', propertyId: 'pKreisStatus' }, [{ type: 'webhook', url: 'https://kreis.example/in', method: 'POST' }]),
      ],
    })
    const w = world({
      pages: [dbPage('dbKreis', 'Kreislauf')],
      databases: [kreis],
      agents: [
        agent('agKreis', 'Kreis-Agent', { write: 'apply', scope: { everything: false, pages: [], databases: ['dbKreis'] }, trigger: { type: 'row_changed', databaseId: 'dbKreis', propertyId: 'pKreisStatus' } }),
        agent('agZweiter', 'Zweiter', { write: 'apply', scope: { everything: false, pages: [], databases: ['dbKreis'] }, trigger: { type: 'schedule', every: 'day', at: '08:00', tz: 'Europe/Berlin' } }),
      ],
    })
    const m = modelOf(w)
    const loopAgent = agentKey('agKreis')
    expect(m.loops).toEqual([{ at: `${loopAgent}@dbKreis:pKreisStatus`, module: loopAgent, place: { db: 'dbKreis', prop: 'pKreisStatus' } }])
    const c = chainTo(m, loopAgent, hook('kreis.example'))!
    expect(c.loop).toEqual({ at: `${loopAgent}@dbKreis:pKreisStatus` })
    // the second agent passes the loop too: still one mark
    expect(chainTo(m, agentKey('agZweiter'), hook('kreis.example'))).toBeDefined()
    expect(new Set(m.loops?.map((l) => l.at)).size).toBe(m.loops?.length)
  })
})

/* ------------------------------------------------------------------ mock 1 and perf */

test.describe('B3 · mock 1 and the budget', () => {
  test('mock 1: Inbox-Helfer → „Weiterleiten“ → An Team-Chat → webhook, unattended; the pipeline waits for Confirm; nothing else', () => {
    const w = mock1()
    const m = modelOf(w)
    const helper = agentKey(w.ids.inboxHelper)
    expect(m.chains.map((c) => [c.decider, c.exit?.module, c.gate ?? null])).toEqual([
      [helper, hook('chat.example'), null],
      [helper, 'outbound:git:-:pr', 'confirm'],
    ])
    const f1 = m.chains[0]
    expect(f1.steps.length).toBe(3)
    expect([f1.lamps?.outside.on, f1.lamps?.private.on, f1.lamps?.out.on]).toEqual([true, true, true])
    expect(f1.lamps?.private.say).toEqual({ key: 'features.patchbay.lamp.private.everything', vars: { n: 4 } })
    expect(f1.exit).toEqual({ module: hook('chat.example'), type: 'webhook', edge: `${autKey(w.ids.mails, w.ids.toChat)}.out>${hook('chat.example')}.out` })
    expect(f1.edges?.[0]).toBe(`rowTrigger:dbMails:created:-.start>${helper}.start`)
  })

  test('bigPatchbay(60): reach + chains median ≤ 6 ms', () => {
    const w = bigPatchbay(60)
    const input = inputOf(w)
    const model = buildModel(input)
    expect(model.chains.length).toBeGreaterThan(0)
    for (let i = 0; i < 5; i++) analyseChains(model, input)
    const times: number[] = []
    for (let i = 0; i < 25; i++) {
      const t = performance.now()
      analyseChains(model, input)
      times.push(performance.now() - t)
    }
    times.sort((a, b) => a - b)
    const median = times[Math.floor(times.length / 2)]
    console.log(`[patchbay-chains] bigPatchbay(60): ${model.counts.modules + model.counts.idle} modules, ${model.counts.cables} cables, ${model.chains.length} chains — analysis median ${median.toFixed(2)} ms`)
    expect(median).toBeLessThanOrEqual(6)
  })
})
