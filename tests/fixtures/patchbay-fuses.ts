/**
 * The fuse specs' worlds (B4, plan §4 B4) on top of tests/fixtures/patchbay.ts: one small world per way out and per
 * decider the plan names, and a translator over the Patchbay's fuse strings for plain.ts in Node. Fictional names only
 * (Nordlicht, Tessera, Mara Lind, Launch plan); every host `*.example`.
 */
import { messages } from '../../src/app/features/patchbay/messages-fuses'
import type { PlainCtx } from '../../src/app/features/patchbay/plain'
import type { CustomAgent, Database, McpServerConfig, Page, PipelineStage } from '../../src/app/store/types'
import { LOCAL_DEVICE, TRACKER_READS, TRACKER_TOOLS, agent, automation, database, dbPage, mailSettings, page, prop, server, world, type PbWorld } from './patchbay'

/** The fuse strings' translator (the app's `t` over messages-fuses.ts; English fallback, then the key). */
export function ctxOf(lang: 'en' | 'de'): PlainCtx {
  return {
    lang,
    t: (key, vars) => {
      const s = messages[lang][key] ?? messages.en[key] ?? key
      return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s
    },
  }
}

export const TEAM = (me: string, role: 'owner' | 'admin' | 'member' | 'viewer' = 'member', supports: string[] = ['ai', 'governor']) => ({ ctx: { team: true, me, role, readOnly: false, supports } })

export const ALPHA = (over: Partial<McpServerConfig> = {}) => server('srvAlpha', 'alpha', { tools: ['list_items', 'search_web', 'create_item', 'send_message'], checkedAt: 1, ...over })
export const BETA = (over: Partial<McpServerConfig> = {}) => server('srvBeta', 'beta', { scope: 'all', tools: ['get_record', 'update_record'], checkedAt: 1, ...over })
export const TRACKER = (over: Partial<McpServerConfig> = {}) => server('srvTracker', 'tracker', { tools: [...TRACKER_TOOLS], checkedAt: 1, ...over })

/** A Mails database (this device's sync target) with „Weiterleiten“ → webhook (chat.example), a report page. */
export function mailWorld(agents: CustomAgent[], over: { servers?: McpServerConfig[]; pages?: Page[]; databases?: Database[]; device?: Partial<PbWorld['device']>; lazy?: Partial<PbWorld['lazy']>; integrations?: PbWorld['ws']['integrations'] } = {}): PbWorld {
  const mails = database('dbMails', [prop('pMailFwd', 'Weiterleiten', 'checkbox')], {
    system: 'mails',
    automations: [automation('autToChat', 'An Team-Chat', { type: 'property_changed', propertyId: 'pMailFwd' }, [{ type: 'webhook', url: 'https://chat.example/hook?room=team', method: 'POST', headers: { 'X-Room': 'team' } }])],
  })
  return world({
    pages: [dbPage('dbMails', 'Mails'), page('pgReport', { title: 'Bericht' }), ...(over.pages ?? [])],
    databases: [mails, ...(over.databases ?? [])],
    agents,
    servers: over.servers ?? [],
    integrations: over.integrations,
    mail: mailSettings('dbMails'),
    device: over.device,
    lazy: over.lazy,
  })
}

/** The everything agent of mock 1 on a mail row (apply). */
export const inboxHelper = (over: Partial<CustomAgent> = {}) =>
  agent('agInbox', 'Inbox-Helfer', { write: 'apply', scope: { everything: true, pages: [], databases: [] }, trigger: { type: 'row_created', databaseId: 'dbMails' }, ...over })

/**
 * Autofill as the decider (§1.3 #1): „Zusammenfassung“ (auto) on Mails reads each mail and the titles of its related
 * Kontakte, and gets this device's "every AI call" server beta (a write tool) — `hook`: an automation also sends the
 * row when the summary changes.
 */
export function autofillWorld(opts: { hook?: boolean; locked?: boolean } = {}): PbWorld {
  const mails = database('dbMails', [prop('pMailKontakt', 'Kontakt', 'relation', { relationDatabaseId: 'dbKontakte' }), prop('pMailSum', 'Zusammenfassung', 'text', { autofill: { preset: 'summary', auto: true, fills: { r1: { at: 1, hash: 'x' } } } })], {
    system: 'mails',
    ...(opts.locked ? { locked: true } : {}),
    automations: opts.hook ? [automation('autSum', 'Zusammenfassung → Hook', { type: 'property_changed', propertyId: 'pMailSum' }, [{ type: 'webhook', url: 'https://digest.example/in', method: 'POST' }])] : [],
  })
  return world({
    pages: [dbPage('dbMails', 'Mails'), dbPage('dbKontakte', 'Kontakte')],
    databases: [mails, database('dbKontakte', [])],
    servers: [BETA()],
    mail: mailSettings('dbMails'),
  })
}

/** Mail organise as the decider: „Kategorie“ is set for each new mail; an automation sends the row when it changes. */
export function organiseWorld(): PbWorld {
  const mails = database('dbMails', [prop('pMailCat', 'Kategorie', 'select', { options: [] })], {
    system: 'mails',
    automations: [automation('autCat', 'Kategorie → Hook', { type: 'property_changed', propertyId: 'pMailCat' }, [{ type: 'webhook', url: 'https://sort.example/in', method: 'POST' }])],
  })
  return world({
    pages: [dbPage('dbMails', 'Mails')],
    databases: [mails],
    mail: mailSettings('dbMails', { props: { category: 'pMailCat' }, organise: { enabled: true, categories: ['Rechnung'], priority: false, needsReply: false, summary: false, relationDatabaseId: null } }),
  })
}

/** A local coding pipeline (push) whose tasks autofill writes (its summary reads related mails) — approvals decide. */
export function pipelineWorld(approvals: 'all' | 'review' | 'none'): PbWorld {
  const stages: PipelineStage[] = [
    { id: 'stQueue', kind: 'queue', auto: true },
    { id: 'stPush', kind: 'git', auto: true, gitAction: 'push' },
  ]
  const coding = database('dbCoding', [prop('pCodingMail', 'Mail', 'relation', { relationDatabaseId: 'dbMails' }), prop('pCodingPlan', 'Plan', 'text', { autofill: { preset: 'summary', auto: true } })], { system: 'coding', pipeline: stages })
  return world({
    pages: [dbPage('dbMails', 'Mails'), dbPage('dbCoding', 'Coding · nordlicht')],
    databases: [database('dbMails', [], { system: 'mails' }), coding],
    mail: mailSettings('dbMails'),
    device: { worker: { ...LOCAL_DEVICE.worker, approvals } },
  })
}

/** A server agent with a webhook trigger in a team (§6 A2): the delivery body is its task; the runtime's alpha is attached. */
export function hookWorld(device: Partial<PbWorld['device']>, lazy: Partial<PbWorld['lazy']> = { hooks: [], tokens: [], runtime: [{ name: 'alpha', host: 'alpha.example' }] }): PbWorld {
  return world({
    pages: [dbPage('dbTickets', 'Tickets')],
    databases: [database('dbTickets', [prop('pTicketKey', 'Key', 'text', { key: true })])],
    agents: [agent('agHook', 'Hook-Empfänger', { runner: 'server', write: 'stage', trigger: { type: 'webhook' }, createdBy: 'acMara', updatedBy: 'acMara', scope: { everything: false, pages: [], databases: ['dbTickets'] }, mcpServers: ['alpha'] })],
    servers: [ALPHA()],
    device,
    lazy,
  })
}

/** This device's GitHub auto-push, an everything agent on mail rows — with or without another server's reads. */
export function pushWorld(reads: boolean): PbWorld {
  return mailWorld([inboxHelper({ ...(reads ? { mcpServers: ['tracker'], mcpTools: { tracker: [...TRACKER_READS] } } : {}) })], {
    servers: reads ? [TRACKER()] : [],
    device: { sync: { github: { configured: true, auto: true, everyMin: 15, includePrivate: false, repo: 'nordlicht/notes' }, folder: { configured: false } } },
  })
}
