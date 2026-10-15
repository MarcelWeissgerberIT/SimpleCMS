/**
 * The Patchbay's fixtures (plan §4): the mock-1 workspace ("Mon 07:30", fuse F1) and the generators the specs of every
 * track build on — `bigPatchbay(n)` (perf), `wideScope(n)` (an everything agent in n databases), `relays()` (the kit
 * relay and the agent → automation → agent relay), `exits()` (one of each way out and of each decider).
 *
 * A world is plain data: the workspace parts the model reads (InputWorkspace), this device's facts (DeviceFacts) and
 * the lazy readings (LazyReadings). The same world goes two ways:
 *  - Node: `inputOf(world)` builds the ModelInput through the app's own pure core (features/patchbay/source.ts) with
 *    plain readers (NODE_READERS) — `modelOf(world)` builds the rack;
 *  - the browser: `seedPatchbay(page, world)` writes the workspace through the `?e2e` store hook (`you~ui:e2e`, one
 *    replaceAll — the seed's own wiring is replaced) and this device's switches into localStorage.
 *
 * Every name is fictional (Nordlicht, Tessera, Mara Lind, Launch plan; the person's own server names tracker / kanal /
 * bildwerk / wiki); every host is `*.example`. No service is named.
 */
import type { Page as PwPage } from '@playwright/test'
import type { Automation, CustomAgent, Database, DbCommand, ID, IntegrationProfile, Kit, McpServerConfig, OneScript, Page, PipelineStage, PropertyDef, Settings, View } from '../../src/app/store/types'
import type { ButtonInput, DatabaseInput, MailInput, ModelInput, ScriptScan } from '../../src/app/features/patchbay/types'
import { createInputMemo, toModelInput, type DeviceFacts, type InputReaders, type InputSource, type InputWorkspace, type LazyReadings } from '../../src/app/features/patchbay/source'
import { buildModel } from '../../src/app/features/patchbay/model'
import { scanScript, type ScanEngine } from '../../src/app/features/patchbay/scripts'
import { buttonsIn } from '../../src/app/features/patchbay/buttons'
import { readAutomations } from '../../src/app/features/automations/read'
import { routeBlock } from '../../src/app/features/agents/routeBlock'
import { valuePropsOf } from '../../src/app/features/kit/valueProps'
import { nextRun } from '../../src/app/features/templates/schedule'
import { parse, walk } from '../../src/app/features/script/lang'
import { needsCheck } from '../../src/app/features/script/runtime/check'
import { findInboxIn } from '../../src/app/lib/capture'

/* ------------------------------------------------------------------ worlds */

export interface PbWorld {
  ws: InputWorkspace
  device: DeviceFacts
  lazy: LazyReadings
  /** Outbox send routes per database (the Node stand-in for features/outbox routesFor) */
  sends?: Record<ID, DatabaseInput['sends']>
  /** fixed ids by role, for asserts */
  ids: Record<string, ID>
}

/** One Script's engine as the scan takes it (the language module itself, loaded in Node). */
export const NODE_ENGINE: ScanEngine = { parse: parse as unknown as ScanEngine['parse'], walk: walk as unknown as ScanEngine['walk'], needsCheck: needsCheck as unknown as ScanEngine['needsCheck'] }

/** This device, as a fresh local workspace has it: bridge off, no sync, worker offline, approvals 'review'. */
export const LOCAL_DEVICE: DeviceFacts = {
  ctx: { team: false, me: null, role: null, readOnly: false, supports: [] },
  bridge: { enabled: false, mode: 'ask' },
  sync: { github: { configured: false, auto: false, everyMin: 15, includePrivate: false, repo: null }, folder: { configured: false } },
  worker: { online: false, can: null, verdict: null, tools: null, approvals: 'review', confirm: 'agent' },
  testing: [],
  refused: [],
  kitTrust: null,
}

export const NO_LAZY: LazyReadings = { buttons: null, scans: null, runtime: null, hooks: null, inbox: null, cache: null }

/** Plain readers for Node (the app passes the areas' own through their index files). */
export function nodeReaders(world: Pick<PbWorld, 'sends'> = {}): InputReaders {
  return {
    automations: readAutomations,
    commands: (raw) => (Array.isArray(raw) ? (raw as DbCommand[]).filter((c) => c && typeof c === 'object' && typeof c.id === 'string') : []),
    pipeline: (db) => (Array.isArray(db.pipeline) ? db.pipeline.map((s) => ({ id: s.id, kind: s.kind, auto: s.auto, ...(s.gitAction ? { gitAction: s.gitAction } : {}), ...(s.hold ? { hold: true } : {}) })) : []),
    gitWarnings: () => ({ pushOff: [], prOff: [] }),
    sends: (dbId) => world.sends?.[dbId] ?? [],
    mail: (raw): MailInput | null => {
      if (!raw) return null
      const props = raw.props ?? {}
      const organiseProps = (['category', 'priority', 'needsReply', 'summary', 'project'] as const).map((r) => props[r]).filter((x): x is ID => !!x)
      return { databaseId: raw.databaseId ?? null, auto: raw.auto ?? 'open', everyMin: raw.everyMin ?? 15, organise: raw.organise?.enabled === true, organiseProps, relationDb: raw.organise?.relationDatabaseId ?? null }
    },
    servers: (settings) => (Array.isArray(settings.mcpServers) ? settings.mcpServers : []),
    serverState: (s) => (!s.enabled ? 'off' : s.checkedAt ? 'ok' : 'untested'),
    valueProps: (db, kit) => valuePropsOf(db, kit).map((v) => ({ prop: v.prop, type: { id: v.type.id }, code: v.code })),
    routeBlock: (a) => routeBlock(a),
    nextRun: (r, now) => nextRun(r, now)?.at ?? null,
    wsAI: () => null,
    deviceAI: () => null,
    route: () => null,
  }
}

const NOW = Date.UTC(2026, 9, 12, 5, 30) // Mon 12 Oct 2026, 07:30 in Berlin

/** The source of a world (the scans of its scripts and its buttons read here when the world does not bring them). */
export function sourceOf(world: PbWorld, now = NOW): InputSource {
  const lazy = { ...world.lazy }
  if (!lazy.scans) {
    const scans: Record<ID, ScriptScan> = {}
    for (const s of Object.values(world.ws.scripts ?? {})) {
      const scan = scanScript(s, NODE_ENGINE)
      if (scan) scans[s.id] = scan
    }
    lazy.scans = scans
  }
  if (!lazy.buttons) lazy.buttons = Object.values(world.ws.pages).flatMap((p): ButtonInput[] => (p.content && !p.trashed ? buttonsIn(p.id, p.content) : []))
  // the Inbox lookup the route makes on open (B4: unless the world says it never ran — `inboxRead: false`)
  if (lazy.inboxRead === undefined) {
    const pages = world.ws.pages
    lazy.inbox ??= findInboxIn(pages, (id) => !!pages[id]?.trashed)
    lazy.inboxRead = true
  }
  return { ws: world.ws, device: world.device, lazy, now }
}

/** The model input of a world (the app's pure core with plain readers). */
export const inputOf = (world: PbWorld, now = NOW): ModelInput => toModelInput(sourceOf(world, now), nodeReaders(world)).input

/** The rack of a world. */
export const modelOf = (world: PbWorld, now = NOW): ReturnType<typeof buildModel> => buildModel(inputOf(world, now))

/** A memo over a world's readers (the wiring-signature specs). */
export const memoOf = (world: PbWorld) => createInputMemo(nodeReaders(world))

/* ------------------------------------------------------------------ builders */

export function page(id: ID, over: Partial<Page> = {}): Page {
  return {
    id,
    kind: 'page',
    title: id,
    icon: null,
    cover: null,
    parentId: null,
    databaseId: null,
    properties: {},
    content: null,
    contentRev: 0,
    contentOrigin: null,
    favorite: false,
    trashed: false,
    trashedAt: null,
    createdAt: 1,
    updatedAt: 1,
    order: 0,
    settings: {} as Page['settings'],
    ...over,
  }
}

export const dbPage = (id: ID, title: string, over: Partial<Page> = {}): Page => page(id, { kind: 'database', title, ...over })

export const prop = (id: ID, name: string, type: PropertyDef['type'], over: Partial<PropertyDef> = {}): PropertyDef => ({ id, name, type, ...over })

export function database(id: ID, properties: PropertyDef[], over: Partial<Database> = {}): Database {
  return { id, properties: [prop(`${id}Title`, 'Name', 'title'), ...properties], views: [{ id: `${id}View`, name: 'Table', type: 'table' } as View], nextUniqueId: 1, ...over }
}

export function agent(id: ID, name: string, over: Partial<CustomAgent> = {}): CustomAgent {
  return {
    id,
    name,
    instructions: `${name}: do the job.`,
    trigger: { type: 'manual' },
    scope: { everything: false, pages: [], databases: [] },
    write: 'none',
    output: null,
    mcpServers: [],
    runner: 'browser',
    model: null,
    effort: null,
    maxRunUsd: 0.5,
    enabled: true,
    createdBy: null,
    updatedBy: null,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

export const automation = (id: ID, name: string, trigger: Automation['trigger'], actions: Automation['actions'], over: Partial<Automation> = {}): Automation => ({ id, name, enabled: true, trigger, actions, lastRunAt: null, lastStatus: null, lastMessage: null, ...over })

export const script = (id: ID, name: string, code: string, over: Partial<OneScript> = {}): OneScript => ({ id, name, code, kind: 'script', createdBy: null, updatedBy: null, createdAt: 1, updatedAt: 1, ...over })

export function server(id: ID, name: string, over: Partial<McpServerConfig> = {}): McpServerConfig {
  return { id, name, url: `https://${name}.example/mcp`, token: '', enabled: true, prompt: '', ...over }
}

export function profile(id: string, over: Partial<IntegrationProfile> = {}): IntegrationProfile {
  return { schema: 'one.integration/1', id, name: id.toUpperCase(), match: { name: id }, unlocks: [], ...over }
}

/** A button node running actions (for a page's content). */
export const buttonNode = (id: string, label: string, actions: unknown[]) => ({ type: 'button', attrs: { id, label, variant: 'signal', actions } })
export const docOf = (...content: unknown[]) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fixture' }] }, ...content] })

/** A world from parts (missing parts empty, this device local). */
export function world(parts: { pages?: Page[]; databases?: Database[]; agents?: CustomAgent[]; scripts?: OneScript[]; integrations?: IntegrationProfile[]; servers?: McpServerConfig[]; mail?: Settings['mail']; kit?: Kit; device?: Partial<DeviceFacts>; lazy?: Partial<LazyReadings>; sends?: PbWorld['sends']; ids?: Record<string, ID> }): PbWorld {
  return {
    ws: {
      pages: Object.fromEntries((parts.pages ?? []).map((p) => [p.id, p])),
      databases: Object.fromEntries((parts.databases ?? []).map((d) => [d.id, d])),
      agents: Object.fromEntries((parts.agents ?? []).map((a) => [a.id, a])),
      scripts: Object.fromEntries((parts.scripts ?? []).map((s) => [s.id, s])),
      integrations: parts.integrations ?? [],
      kit: parts.kit,
      settings: { mcpServers: parts.servers ?? [], ...(parts.mail ? { mail: parts.mail } : {}) },
    },
    device: { ...LOCAL_DEVICE, ...parts.device },
    lazy: { ...NO_LAZY, ...parts.lazy },
    sends: parts.sends,
    ids: parts.ids ?? {},
  }
}

/** The mail settings of a device whose sync writes into `dbId`. */
export function mailSettings(dbId: ID, over: Partial<NonNullable<Settings['mail']>> = {}): NonNullable<Settings['mail']> {
  return {
    clientId: '',
    from: '2026-10-01',
    labels: ['INBOX'],
    excludeSpamTrash: true,
    maxPerRun: 50,
    auto: 'interval',
    everyMin: 15,
    parentId: null,
    databaseId: dbId,
    props: {},
    organise: { enabled: false, categories: [], priority: false, needsReply: false, summary: false, relationDatabaseId: null },
    people: { enabled: false, freemail: [] },
    attachments: 'off',
    ...over,
  } as NonNullable<Settings['mail']>
}

/* ------------------------------------------------------------------ mock-1 */

export const TRACKER_TOOLS = ['query_issues', 'get_issue', 'whoami', 'create_issue', 'update_issue', 'add_comment', 'post_status']
export const TRACKER_READS = ['query_issues', 'get_issue', 'whoami']

const PIPELINE_STAGES: PipelineStage[] = [
  { id: 'stReady', kind: 'queue', auto: true },
  { id: 'stPlan', kind: 'plan', auto: true },
  { id: 'stReview', kind: 'gate', auto: false },
  { id: 'stShip', kind: 'git', auto: true, gitAction: 'pr' },
  { id: 'stDone', kind: 'done', auto: false },
]

/**
 * Mock 1 (plan §4 / §3.13): a Mails database (system 'mails', checkbox „Weiterleiten“, this device's sync target);
 * Inbox-Helfer (browser, apply, everything, new Mails row); the automation „An Team-Chat“ (Weiterleiten → webhook
 * `https://chat.example/hook` POST); „Neue Mail → Kontakt“ (new Mails row → run_script „Kontakt anlegen“, which writes
 * Kontakte — used only there, so folded); the tracker server (tested, 7 tools), profile IN-01 (`reads` 3, unlocks
 * notify); the Tessera mirror (Tessera Handoff, report page „Bericht“, agent „Tessera-Spiegel“ weekday 07:30, its
 * tools = the reads); script Wochenbericht + a button on Bericht; a coding pipeline with a `pr` stage; three unwired,
 * untested servers (kanal, bildwerk, wiki); bridge off, GitHub sync off.
 * → § 01 4 + 3 idle · § 02 6 · § 03 7 (Whole workspace added, §3.13) · 15 cables · 3 dashed.
 */
export function mock1(): PbWorld {
  const ids = {
    mails: 'dbMails',
    forward: 'pMailFwd',
    kontakte: 'dbKontakte',
    handoff: 'dbHandoff',
    bericht: 'pgBericht',
    coding: 'dbCoding',
    inboxHelper: 'agInbox',
    mirror: 'agTessera',
    toChat: 'autToChat',
    toContact: 'autToContact',
    weekly: 'scWeekly',
    contact: 'scContact',
    button: 'btnWeekly',
    tracker: 'srvTracker',
    kanal: 'srvKanal',
    bildwerk: 'srvBildwerk',
    wiki: 'srvWiki',
    profile: 'in-01',
  }
  const mails = database(ids.mails, [prop(ids.forward, 'Weiterleiten', 'checkbox'), prop('pMailFrom', 'Von', 'text'), prop('pMailDate', 'Datum', 'date')], {
    system: 'mails',
    automations: [
      automation(ids.toChat, 'An Team-Chat', { type: 'property_changed', propertyId: ids.forward }, [{ type: 'webhook', url: 'https://chat.example/hook', method: 'POST', headers: { 'X-Room': 'team' } }]),
      automation(ids.toContact, 'Neue Mail → Kontakt', { type: 'row_created' }, [{ type: 'run_script', scriptId: ids.contact }]),
    ],
  })
  const kontakte = database(ids.kontakte, [prop('pKontaktQuelle', 'Quelle', 'text')])
  const handoff = database(ids.handoff, [prop('pHandoffKey', 'Schlüssel', 'text', { key: true }), prop('pHandoffStatus', 'Status', 'text')])
  const coding = database(ids.coding, [prop('pCodingRepo', 'Repo', 'select', { options: [] }), prop('pCodingStage', 'Stage', 'select', { options: PIPELINE_STAGES.map((s, i) => ({ id: s.id, name: ['Ready', 'Plan', 'Review', 'Ship', 'Done'][i], color: 'gray' })) as PropertyDef['options'] })], {
    system: 'coding',
    pipeline: PIPELINE_STAGES,
  })
  return world({
    ids,
    pages: [
      dbPage(ids.mails, 'Mails'),
      dbPage(ids.kontakte, 'Kontakte'),
      dbPage(ids.handoff, 'Tessera Handoff'),
      dbPage(ids.coding, 'Coding · nordlicht'),
      page(ids.bericht, { title: 'Bericht', content: docOf(buttonNode(ids.button, 'Wochenbericht', [{ id: 'a1', type: 'run_script', scriptId: ids.weekly }])) as Page['content'], contentRev: 1 }),
    ],
    databases: [mails, kontakte, handoff, coding],
    agents: [
      agent(ids.inboxHelper, 'Inbox-Helfer', {
        instructions: 'Lies jede neue Mail. Soll das Team sie sehen, setze „Weiterleiten“.',
        trigger: { type: 'row_created', databaseId: ids.mails },
        scope: { everything: true, pages: [], databases: [] },
        write: 'apply',
        maxRunUsd: 0.2,
      }),
      agent(ids.mirror, 'Tessera-Spiegel', {
        instructions: 'Spiegle die offenen Einträge von tracker nach Tessera Handoff. Neue Kommentare: notify_me mit page_id = die Zeile.',
        trigger: { type: 'schedule', every: 'weekday', at: '07:30', tz: 'Europe/Berlin' },
        scope: { everything: false, pages: [], databases: [ids.handoff] },
        write: 'stage',
        output: { pageId: ids.bericht, mode: 'append' },
        mcpServers: ['tracker'],
        mcpTools: { tracker: [...TRACKER_READS] },
        mirrorOf: ids.handoff,
        model: null,
        maxRunUsd: 0.4,
      }),
    ],
    scripts: [
      script(ids.weekly, 'Wochenbericht', `let offen = db(@[Tessera Handoff](p:${ids.handoff})).count\n@[Bericht](p:${ids.bericht}).append("## Woche\\n{offen} offene Einträge")`),
      script(ids.contact, 'Kontakt anlegen', `db(@[Kontakte](p:${ids.kontakte})).add(page.current.title, Quelle: "Mail")`),
    ],
    servers: [
      server(ids.tracker, 'tracker', { tools: [...TRACKER_TOOLS], checkedAt: 1 }),
      server(ids.kanal, 'kanal'),
      server(ids.bildwerk, 'bildwerk'),
      server(ids.wiki, 'wiki'),
    ],
    integrations: [profile(ids.profile, { name: 'IN-01', match: { name: 'tracker' }, unlocks: ['notify', 'toolAllowList'], reads: [...TRACKER_READS], recipes: [{ kind: 'mirror', id: 'mirror' }] })],
    mail: mailSettings(ids.mails),
  })
}

/* ------------------------------------------------------------------ wideScope */

/**
 * An agent in a workspace of `n` databases (Nordlicht 1 … n): scope "everything" (default) or `named` databases
 * (Nordlicht 2 …), apply, a report page; one automation listens to a field of the first database (so the everything
 * agent has one flag).
 */
export function wideScope(n = 40, opts: { named?: number } = {}): PbWorld {
  const dbs: Database[] = []
  const pages: Page[] = [page('pgNordlichtReport', { title: 'Nordlicht Bericht' })]
  for (let i = 1; i <= n; i++) {
    const id = `dbNord${String(i).padStart(2, '0')}`
    dbs.push(database(id, [prop(`${id}Flag`, 'Markiert', 'checkbox')]))
    pages.push(dbPage(id, `Nordlicht ${i}`))
  }
  dbs[0] = { ...dbs[0], automations: [automation('autNordFlag', 'Markiert → Notiz', { type: 'property_changed', propertyId: `${dbs[0].id}Flag` }, [{ type: 'notify', message: 'Markiert' }])] }
  // a named scope leaves the first database (the one with a listener) out: its cables are database cables only
  const scope = opts.named ? { everything: false, pages: [], databases: dbs.slice(1, 1 + opts.named).map((d) => d.id) } : { everything: true, pages: [], databases: [] }
  return world({
    ids: { agent: 'agNordlicht', report: 'pgNordlichtReport' },
    pages,
    databases: dbs,
    agents: [agent('agNordlicht', 'Nordlicht-Assistent', { scope, write: 'apply', output: { pageId: 'pgNordlichtReport', mode: 'append' }, trigger: { type: 'schedule', every: 'day', at: '06:00', tz: 'Europe/Berlin' } })],
  })
}

/* ------------------------------------------------------------------ relays */

/**
 * The relays (§1.3, §6 A12): (1) a server agent writes Tessera; the kit value property „Punkte“ recomputes on any row
 * change (remote ones too) and its write starts the automation „Punkte → Hook“ (webhook relay.example); (2) agent A
 * (apply, Launch plan only) writes „Phase“ → the automation „Phase → Freigabe“ sets „Freigabe“ → agent B's row trigger
 * → B (apply, Versandliste only) writes „Versand“ → the automation „Versand → Hook“ sends the row (webhook
 * launch.example) — A reaches the hook only through the relay.
 */
export function relays(): PbWorld {
  const kit: Kit = {
    lists: {},
    propTypes: { ptPunkte: { id: 'ptPunkte', name: 'Punkte', base: 'number', scripts: { value: 'row.Status = "fertig" ? 10 : 0' }, createdAt: 1, updatedAt: 1 } },
    recordTypes: {},
  }
  const tessera = database('dbTessera', [prop('pTesseraStatus', 'Status', 'text'), prop('pTesseraPunkte', 'Punkte', 'number', { custom: 'ptPunkte' })], {
    automations: [automation('autPunkte', 'Punkte → Hook', { type: 'property_changed', propertyId: 'pTesseraPunkte' }, [{ type: 'webhook', url: 'https://relay.example/in', method: 'POST' }])],
  })
  const launch = database('dbLaunch', [prop('pLaunchPhase', 'Phase', 'text'), prop('pLaunchFreigabe', 'Freigabe', 'checkbox')], {
    automations: [automation('autFreigabe', 'Phase → Freigabe', { type: 'property_changed', propertyId: 'pLaunchPhase' }, [{ type: 'set_property', propertyId: 'pLaunchFreigabe', value: true }])],
  })
  const versand = database('dbVersand', [prop('pVersandFlag', 'Versand', 'checkbox')], {
    automations: [automation('autVersand', 'Versand → Hook', { type: 'property_changed', propertyId: 'pVersandFlag' }, [{ type: 'webhook', url: 'https://launch.example/send', method: 'POST' }])],
  })
  return world({
    ids: { tessera: 'dbTessera', launch: 'dbLaunch', versand: 'dbVersand', serverAgent: 'agTesseraServer', agentA: 'agLaunchA', agentB: 'agLaunchB', kitType: 'ptPunkte', punkte: 'pTesseraPunkte' },
    pages: [dbPage('dbTessera', 'Tessera'), dbPage('dbLaunch', 'Launch plan'), dbPage('dbVersand', 'Versandliste')],
    databases: [tessera, launch, versand],
    kit,
    agents: [
      agent('agTesseraServer', 'Tessera-Pflege', { runner: 'server', write: 'apply', scope: { everything: false, pages: [], databases: ['dbTessera'] }, trigger: { type: 'schedule', every: 'hour', at: '00:15', tz: 'Europe/Berlin' } }),
      agent('agLaunchA', 'Launch-Planer', { write: 'apply', scope: { everything: false, pages: [], databases: ['dbLaunch'] }, trigger: { type: 'schedule', every: 'day', at: '08:00', tz: 'Europe/Berlin' } }),
      agent('agLaunchB', 'Launch-Versand', { write: 'apply', scope: { everything: false, pages: [], databases: ['dbVersand'] }, trigger: { type: 'row_changed', databaseId: 'dbLaunch', propertyId: 'pLaunchFreigabe' } }),
    ],
  })
}

/* ------------------------------------------------------------------ exits */

/**
 * One of each way out (§1.4) and of each decider (§1.3): an automation webhook after an agent; an agent's MCP write
 * tools (tested, no allow-list); an attached untested server without an allow-list (fail closed); autofill (auto) with a
 * `scope: 'all'` server; a disabled agent; a server agent with a webhook trigger; mail organise; the bridge in 'apply';
 * a local pipeline (`push`, approvals none); this device's GitHub auto-push; an Outbox send route; a script with
 * `http.post` and `mail.send` (asks first); a button webhook; a command webhook; a form posting to a webhook (a note).
 */
export function exits(): PbWorld {
  const ids = {
    mails: 'dbExMails',
    leads: 'dbLeads',
    tickets: 'dbTickets',
    coding: 'dbExCoding',
    contacts: 'dbExContacts',
    notes: 'pgExNotes',
    agentApply: 'agExApply',
    agentStage: 'agExStage',
    agentOff: 'agExOff',
    agentHook: 'agExHook',
    autofill: 'pLeadSummary',
    script: 'scExSend',
    button: 'btnExHook',
    command: 'cmdExHook',
    alpha: 'srvAlpha',
    beta: 'srvBeta',
    gamma: 'srvGamma',
  }
  const mails = database(ids.mails, [prop('pExFwd', 'Weiterleiten', 'checkbox'), prop('pExCategory', 'Kategorie', 'select', { options: [] })], {
    system: 'mails',
    automations: [automation('autExHook', 'Weiterleiten → Hook', { type: 'property_changed', propertyId: 'pExFwd' }, [{ type: 'webhook', url: 'https://hooks.example/fwd?room=1', method: 'POST' }])],
  })
  const leads = database(ids.leads, [prop(ids.autofill, 'Zusammenfassung', 'text', { autofill: { preset: 'summary', auto: true, skipReview: true, fills: { r1: { at: 1, hash: 'x' } } } })], {
    views: [{ id: 'vLeadForm', name: 'Formular', type: 'form', form: { webhookUrl: 'https://forms.example/in' } } as View],
    commands: [{ id: ids.command, kind: 'actions', label: 'Melden', icon: null, config: { actions: [{ id: 'c1', type: 'webhook', url: 'https://cmd.example/ping', method: 'PUT' }] } }],
  })
  const tickets = database('dbTickets', [prop('pTicketKey', 'Key', 'text', { key: true })])
  const coding = database(ids.coding, [prop('pExRepo', 'Repo', 'select', { options: [] }), prop('pExStage', 'Stage', 'select', { options: [] })], {
    system: 'coding',
    pipeline: [
      { id: 'exQueue', kind: 'queue', auto: true },
      { id: 'exCommit', kind: 'git', auto: true, gitAction: 'commit' },
      { id: 'exPush', kind: 'git', auto: true, gitAction: 'push' },
    ],
  })
  const contacts = database(ids.contacts, [])
  return world({
    ids,
    pages: [
      dbPage(ids.mails, 'Mails'),
      dbPage(ids.leads, 'Leads'),
      dbPage(ids.tickets, 'Tickets'),
      dbPage(ids.coding, 'Coding · Tessera'),
      dbPage(ids.contacts, 'Kontakte'),
      page(ids.notes, { title: 'Notizen', content: docOf(buttonNode(ids.button, 'Ping', [{ id: 'b1', type: 'webhook', url: 'https://button.example/ping', method: 'POST' }, { id: 'b2', type: 'run_script', scriptId: ids.script }])) as Page['content'], contentRev: 1 }),
    ],
    databases: [mails, leads, tickets, coding, contacts],
    agents: [
      agent(ids.agentApply, 'Mail-Sortierer', { write: 'apply', scope: { everything: true, pages: [], databases: [] }, trigger: { type: 'row_created', databaseId: ids.mails }, mcpServers: ['alpha', 'gamma'] }),
      agent(ids.agentStage, 'Ticket-Leser', { write: 'stage', scope: { everything: false, pages: [], databases: [ids.tickets] }, mcpServers: ['alpha'], trigger: { type: 'schedule', every: 'day', at: '09:00', tz: 'Europe/Berlin' } }),
      agent(ids.agentOff, 'Ruhender Helfer', { enabled: false, write: 'apply', scope: { everything: false, pages: [], databases: [ids.leads] }, trigger: { type: 'row_created', databaseId: ids.leads } }),
      agent(ids.agentHook, 'Hook-Empfänger', { runner: 'server', write: 'stage', trigger: { type: 'webhook' }, scope: { everything: false, pages: [], databases: [ids.tickets] }, mcpServers: ['alpha'] }),
    ],
    scripts: [script(ids.script, 'Senden', 'http.post("https://script.example/in", { text: page.current.title })\nmail.send(to: "mara.lind@nordlicht.example", subject: "Hallo", body: "Test")')],
    servers: [
      server(ids.alpha, 'alpha', { tools: ['list_items', 'search_web', 'create_item', 'send_message'], checkedAt: 1 }),
      server(ids.beta, 'beta', { scope: 'all', tools: ['get_record', 'update_record'], checkedAt: 1 }),
      server(ids.gamma, 'gamma'),
    ],
    integrations: [profile('alpha', { match: { name: 'alpha' }, unlocks: ['sends'], sends: [{ id: 'reply', label: 'Antworten', tool: 'send_message', args: { text: '{draft}' }, params: [{ name: 'draft', type: 'text' }] }] })],
    mail: mailSettings(ids.mails, { props: { category: 'pExCategory' }, organise: { enabled: true, categories: ['Rechnung'], priority: false, needsReply: false, summary: false, relationDatabaseId: null } }),
    sends: { [ids.tickets]: [{ profile: 'alpha', route: 'reply', tool: 'send_message', server: 'alpha' }] },
    device: {
      bridge: { enabled: true, mode: 'apply' },
      sync: { github: { configured: true, auto: true, everyMin: 15, includePrivate: false, repo: 'nordlicht/notes' }, folder: { configured: false } },
      worker: { ...LOCAL_DEVICE.worker, approvals: 'none' },
      ctx: { ...LOCAL_DEVICE.ctx },
    },
    lazy: { runtime: [{ name: 'alpha', host: 'alpha.example' }] },
  })
}

/* ------------------------------------------------------------------ bigPatchbay */

/**
 * A large rack for the perf budgets (B3 / B4 / B7 / B17): about `n` modules and twice as many cables — `n / 6`
 * databases with a watched field and a webhook automation each, agents in apply / stage mode across them (schedules
 * and row triggers), tested servers with read and write tools, scripts behind buttons, autofill. Deterministic.
 */
export function bigPatchbay(n = 60): PbWorld {
  const k = Math.max(1, Math.round(n / 6))
  const pages: Page[] = [page('pgBigReport', { title: 'Nordlicht Übersicht' })]
  const databases: Database[] = []
  const agents: CustomAgent[] = []
  const scripts: OneScript[] = []
  const servers: McpServerConfig[] = []
  const buttons: unknown[] = []
  for (let i = 0; i < k; i++) {
    const db = `dbBig${i}`
    pages.push(dbPage(db, `Tessera ${i + 1}`))
    databases.push(
      database(db, [prop(`${db}Flag`, 'Prüfen', 'checkbox'), prop(`${db}Note`, 'Notiz', 'text', i % 3 === 0 ? { autofill: { preset: 'summary', auto: true } } : {})], {
        automations: [automation(`autBig${i}`, `Prüfen → Hook ${i + 1}`, { type: 'property_changed', propertyId: `${db}Flag` }, [{ type: 'webhook', url: `https://hook${i % 4}.example/in`, method: 'POST' }])],
      }),
    )
    agents.push(
      agent(`agBig${i}`, `Helfer ${i + 1}`, {
        write: i % 2 ? 'apply' : 'stage',
        scope: { everything: false, pages: [], databases: [db, `dbBig${(i + 1) % k}`] },
        trigger: i % 2 ? { type: 'row_created', databaseId: db } : { type: 'schedule', every: 'day', at: `0${i % 10}:00`.slice(-5), tz: 'Europe/Berlin' },
        output: { pageId: 'pgBigReport', mode: 'append' },
        mcpServers: [`srv${i % Math.max(1, Math.round(k / 2))}`],
      }),
    )
    if (i < Math.max(1, Math.round(k / 2))) servers.push(server(`srvBig${i}`, `srv${i}`, { tools: ['list_rows', 'get_row', 'search_rows', 'create_row', 'update_row'], checkedAt: 1 }))
    if (i % 2 === 0) {
      scripts.push(script(`scBig${i}`, `Bericht ${i + 1}`, `@[Nordlicht Übersicht](p:pgBigReport).append("Tessera ${i + 1}: {db(@[Tessera ${i + 1}](p:${db})).count}")`))
      buttons.push(buttonNode(`btnBig${i}`, `Bericht ${i + 1}`, [{ id: `b${i}`, type: 'run_script', scriptId: `scBig${i}` }]))
    }
  }
  pages[0] = { ...pages[0], content: docOf(...buttons) as Page['content'], contentRev: 1 }
  return world({ ids: { report: 'pgBigReport' }, pages, databases, agents, scripts, servers })
}

/* ------------------------------------------------------------------ the browser */

/**
 * Write a world into the app (`?e2e` store hook, as `you~ui:e2e`): ONE replaceAll of pages, databases, agents, scripts,
 * profiles and this device's MCP servers / mail settings (the seed's own wiring goes); the bridge switch into
 * localStorage `one.mcp`. Device facts the browser owns itself (sync, worker, cloud) stay as the context has them.
 */
export async function seedPatchbay(page: PwPage, w: PbWorld): Promise<void> {
  await page.evaluate((w) => {
    const hook = (window as unknown as { __one: { workspace: { getState: () => Record<string, unknown> & { replaceAll: (ws: unknown) => void } } } }).__one
    const s = hook.workspace.getState()
    const settings = { ...(s.settings as Record<string, unknown>), mcpServers: w.ws.settings.mcpServers ?? [], startPageId: null, lastPageId: null, ...(w.ws.settings.mail ? { mail: w.ws.settings.mail } : {}) }
    s.replaceAll({
      version: s.version,
      epoch: s.epoch,
      pages: w.ws.pages,
      databases: w.ws.databases,
      people: s.people,
      settings,
      recent: [],
      functions: s.functions ?? {},
      agents: w.ws.agents ?? {},
      scripts: w.ws.scripts ?? {},
      kit: w.ws.kit ?? s.kit,
      integrations: w.ws.integrations ?? [],
      look: s.look,
      ai: s.ai,
      governor: s.governor,
    })
    if (w.device.bridge.enabled) localStorage.setItem('one.mcp', JSON.stringify({ enabled: true, mode: w.device.bridge.mode, port: 51740 }))
  }, w)
}
