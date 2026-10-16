/**
 * The Patchbay ("Schaltplan") — the model's review fixes (merge core, "Fix (model)"), run by the Playwright runner in
 * Node. Each case was a failing Node case first (a missed fuse, a false fuse or a missing unknown part); fixtures:
 * tests/fixtures/patchbay.ts + patchbay-fuses.ts. Every page and value is fictional, every host `*.example`.
 *  - pipelines: the git gate per git stage (coding/tasks.ts skipsGate: hold gates, "review" passes a gate right after a
 *    plan stage, no gate stage = nobody in between); Confirm by who wrote the task (team: trust carries in the worker's
 *    tab — coding/trust.ts); the worker's own writes (Stage moves, Test cases rows) start what listens to them;
 *  - team API tokens with write scope: content from outside everywhere; not read = an unknown part;
 *  - data rules per feature class: every routable pin of the winning rule (agents 'agents', autofill / organise
 *    'bulk'); MCP only on a provider MCP servers join (Claude);
 *  - runtime servers: tool lists only from this device's server at the same host, OUT from their own name + host; a
 *    stale (cached) runtime list names what it lacks as unknown;
 *  - scripts: a folded script's reads taint what it writes; refs by name = an unknown part + taint everywhere;
 *  - a browser agent's server not set up here (team) = an unknown part; a server agent the team server skips (a
 *    Vorprüfer) is no decider;
 *  - organise starts from the mail sync only; one data rule = one near-miss reason;
 *  - signatures: the outside sources are a part (a new source lapses an allowance); this device's kit trust is not.
 */
import { test, expect } from './fixtures'
import { buildModel } from '../../src/app/features/patchbay/model'
import { moduleKey } from '../../src/app/features/patchbay/ref'
import { CLAUDE_CODE_STAGES, claudeBeforeGit, placeKey, unattendedGit } from '../../src/app/features/patchbay/rules'
import { CLAUDE_KINDS } from '../../src/app/features/coding/protocol'
import { lazyCacheOf } from '../../src/app/features/patchbay/cache'
import { digest } from '../../src/app/features/patchbay/source'
import { messages } from '../../src/app/features/patchbay/messages-fuses'
import type { Chain, ChainStep, Model, ModelInput, PipelineInput } from '../../src/app/features/patchbay/types'
import type { CustomAgent, Database, PipelineStage } from '../../src/app/store/types'
import { LOCAL_DEVICE, TRACKER_READS, TRACKER_TOOLS, agent, automation, database, dbPage, inputOf, mailSettings, modelOf, page, profile, prop, relays, script, server, world, type PbWorld } from '../fixtures/patchbay'
import { TEAM, autofillWorld, organiseWorld, pipelineWorld } from '../fixtures/patchbay-fuses'

/* ------------------------------------------------------------------ helpers */

const key = moduleKey
const agentKey = (id: string) => key({ kind: 'agent', id })
const hook = (host: string, method = 'POST') => `outbound:webhook:${host}:${method}`
const stepNode = (s: ChainStep) => (typeof s.to === 'string' ? s.to : `@${placeKey(s.to)}`)
const chainTo = (m: Model, decider: string, exit: string): Chain | undefined => m.chains.find((c) => c.decider === decider && c.exit?.module === exit)
const fused = (m: Model, decider: string, exit: string) => m.fuses.some((f) => f.chain.decider === decider && f.chain.exit?.module === exit)
const OWNER = TEAM('acMara', 'owner', ['ai', 'governor', 'signoffs'])
const OR = { p: 'openrouter' as const, m: 'nordlicht/tessera-mini' }
const CLAUDE = { p: 'anthropic' as const, m: 'claude-sonnet-4-5' }
/** OpenRouter may receive the shared classes (the workspace's rule) */
const WS_OR = { policy: { providers: { openrouter: { allow: ['public', 'structure', 'selection', 'page', 'rows', 'files', 'workspace', 'people', 'transcript'] } }, restricted: [] } } as unknown as ModelInput['ai']['workspace']
const withAI = (w: PbWorld, ai: { workspace?: unknown; device?: unknown }) => {
  const input = inputOf(w)
  return buildModel({ ...input, ai: { workspace: (ai.workspace ?? null) as ModelInput['ai']['workspace'], device: (ai.device ?? null) as ModelInput['ai']['device'], route: null } })
}

/** A Mails database (this device's sync target) with its own fields and automations. */
function mails(agents: CustomAgent[], over: { mailProps?: Database['properties']; mailAutomations?: Database['automations']; mail?: Parameters<typeof mailSettings>[1]; pages?: PbWorld['ws']['pages'][string][]; databases?: Database[]; servers?: ReturnType<typeof server>[] } = {}): PbWorld {
  const db = database('dbMails', [prop('pMailFwd', 'Weiterleiten', 'checkbox'), ...(over.mailProps ?? [])], {
    system: 'mails',
    automations: over.mailAutomations ?? [automation('autToChat', 'An Team-Chat', { type: 'property_changed', propertyId: 'pMailFwd' }, [{ type: 'webhook', url: 'https://chat.example/hook', method: 'POST' }])],
  })
  return world({ pages: [dbPage('dbMails', 'Mails'), page('pgReport', { title: 'Bericht' }), ...(over.pages ?? [])], databases: [db, ...(over.databases ?? [])], agents, servers: over.servers ?? [], mail: mailSettings('dbMails', over.mail ?? {}) })
}
const reader = (over: Partial<CustomAgent> = {}) => agent('agLeser', 'Mail-Leser', { write: 'apply', scope: { everything: false, pages: [], databases: ['dbMails'] }, trigger: { type: 'row_created', databaseId: 'dbMails' }, ...over })

/** A coding database whose Plan autofill writes (it reads related mails) — the stages and this device's approvals given. */
function coding(stages: PipelineStage[], approvals: 'all' | 'review' | 'none', extra: { props?: Database['properties']; automations?: Database['automations']; databases?: Database[]; pages?: PbWorld['ws']['pages'][string][] } = {}): PbWorld {
  const w = pipelineWorld(approvals)
  const db = w.ws.databases.dbCoding
  w.ws.databases.dbCoding = { ...db, pipeline: stages, properties: [...db.properties, ...(extra.props ?? [])], automations: extra.automations ?? [] }
  for (const d of extra.databases ?? []) w.ws.databases[d.id] = d
  for (const p of extra.pages ?? []) w.ws.pages[p.id] = p
  return w
}
const AF = key({ kind: 'autofill', db: 'dbCoding', prop: 'pCodingPlan' })
const git = (action: string) => `outbound:git:-:${action}`

/** features/coding/schema.ts REVIEW_MERGE (ids only) */
const REVIEW_MERGE: PipelineStage[] = [
  { id: 'stBacklog', kind: 'queue', auto: false },
  { id: 'stReady', kind: 'queue', auto: true },
  { id: 'stPlan', kind: 'plan', auto: true },
  { id: 'stApprove', kind: 'gate', auto: false },
  { id: 'stImpl', kind: 'implement', auto: true },
  { id: 'stTest', kind: 'test', auto: true },
  { id: 'stShip', kind: 'git', auto: true, gitAction: 'pr' },
  { id: 'stAiReview', kind: 'doc', auto: true, output: 'review' },
  { id: 'stApproveMerge', kind: 'gate', auto: false, hold: true },
  { id: 'stPost', kind: 'git', auto: true, gitAction: 'comment' },
  { id: 'stMerge', kind: 'git', auto: true, gitAction: 'merge' },
  { id: 'stDone', kind: 'done', auto: false },
]

/* ------------------------------------------------------------------ pipelines */

test.describe('fix · pipelines: the git gate per stage, Confirm by who wrote the task, the worker\'s writes', () => {
  test('unattendedGit follows skipsGate: hold always stops, "review" passes a gate right after a plan stage, `next` is followed', () => {
    const s = (list: Array<Partial<PipelineInput['stages'][number]> & { id: string; kind: PipelineInput['stages'][number]['kind'] }>) => list.map((x) => ({ auto: true, ...x })) as PipelineInput['stages']
    expect([...unattendedGit(REVIEW_MERGE, 'review')]).toEqual(['pr'])
    expect([...unattendedGit(REVIEW_MERGE, 'all')]).toEqual([])
    expect([...unattendedGit(REVIEW_MERGE, 'none')].sort()).toEqual(['pr'])
    expect([...unattendedGit(s([{ id: 'q', kind: 'queue' }, { id: 'p', kind: 'git', gitAction: 'push' }]), 'all')]).toEqual(['push'])
    expect([...unattendedGit(s([{ id: 'q', kind: 'queue' }, { id: 'h', kind: 'gate', hold: true }, { id: 'p', kind: 'git', gitAction: 'push' }]), 'none')]).toEqual([])
    // `next` skips the gate: the push is reached around it
    expect([...unattendedGit(s([{ id: 'q', kind: 'queue', next: 'p' }, { id: 'g', kind: 'gate' }, { id: 'p', kind: 'git', gitAction: 'push' }]), 'all')]).toEqual(['push'])
    // commit and update-base stay local; a done stage ends the walk; a task created at a gate waits there
    expect([...unattendedGit(s([{ id: 'q', kind: 'queue' }, { id: 'c', kind: 'git', gitAction: 'commit' }, { id: 'd', kind: 'done' }, { id: 'p', kind: 'git', gitAction: 'push' }]), 'none')]).toEqual([])
    expect([...unattendedGit(s([{ id: 'g', kind: 'gate' }, { id: 'p', kind: 'git', gitAction: 'push' }]), 'none')]).toEqual([])
  })

  test('approvals "review" / "all" with no gate stage before the push: unattended (a fuse), the fact says no stop', () => {
    for (const level of ['review', 'all'] as const) {
      const m = modelOf(pipelineWorld(level))
      expect(fused(m, AF, git('push')), level).toBe(true)
      expect(m.fuses[0].facts.find((x) => x.kind === 'approvals')?.say.key).toBe('features.patchbay.fact.approvalsPass')
    }
  })

  test('"Review & merge" with approvals "review": the gate after the plan is passed — the PR ships unattended; the hold gate stops comment + merge', () => {
    const m = modelOf(coding(REVIEW_MERGE, 'review'))
    expect(chainTo(m, AF, git('pr'))?.gate).toBeUndefined()
    expect(fused(m, AF, git('pr'))).toBe(true)
    expect([chainTo(m, AF, git('comment'))?.gate, chainTo(m, AF, git('merge'))?.gate]).toEqual(['afterApproval', 'afterApproval'])
    // the drawing: pr outbound, comment / merge after approval
    const tags = (k: string) => m.modules.find((x) => x.key === k)?.tags
    expect([tags(git('pr')), tags(git('comment')), tags(git('merge'))]).toEqual([['outbound'], ['afterApproval'], ['afterApproval']])
    // "all": the approve gate stops the task — every git stage is after approval
    expect(modelOf(coding(REVIEW_MERGE, 'all')).fuses).toEqual([])
  })

  test('a gate marked "Always stop here" (hold) waits whatever the approvals say ("none" too)', () => {
    const m = modelOf(coding([{ id: 'stQueue', kind: 'queue', auto: true }, { id: 'stHold', kind: 'gate', auto: false, hold: true }, { id: 'stPush', kind: 'git', auto: true, gitAction: 'push' }], 'none'))
    const c = chainTo(m, AF, git('push'))!
    expect([c.gate, c.lamps?.out.on]).toEqual(['afterApproval', false])
    expect(m.fuses).toEqual([])
  })

  test('team: autofill changing a trusted task in the worker\'s tab keeps it trusted — the approvals decide; a new row, a hook or an agent waits for Confirm', () => {
    const w = pipelineWorld('none')
    w.device = { ...w.device, ...OWNER, worker: { ...w.device.worker, approvals: 'none', confirm: 'always' } }
    w.lazy = { ...w.lazy, hooks: [], tokens: [], runtime: [] }
    const m = modelOf(w)
    expect(fused(m, AF, git('push'))).toBe(true)
    expect(m.unknown).toEqual([])
    // an agent creating tasks (a new row: no trusted version) → Confirm, and autofill on that row leaves it waiting
    w.ws.agents = { agTask: agent('agTask', 'Aufgaben-Schreiber', { write: 'apply', createdBy: 'acMara', updatedBy: 'acMara', scope: { everything: false, pages: [], databases: ['dbCoding', 'dbMails'] }, trigger: { type: 'row_created', databaseId: 'dbMails' } }) }
    const a = modelOf(w)
    expect(chainTo(a, agentKey('agTask'), git('push'))?.gate).toBe('confirm')
    expect(fused(a, agentKey('agTask'), git('push'))).toBe(false)
  })

  test('the worker writes the task row: a Stage automation is reached from the decider upstream (approvals "all", a hold gate before the push)', () => {
    const w = coding([{ id: 'stQueue', kind: 'queue', auto: true }, { id: 'stPlan', kind: 'plan', auto: true }, { id: 'stGate', kind: 'gate', auto: false, hold: true }, { id: 'stPush', kind: 'git', auto: true, gitAction: 'push' }], 'all', {
      props: [prop('pStage', 'Stage', 'select', { options: [] })],
      automations: [automation('autStage', 'Stage → Chat', { type: 'property_changed', propertyId: 'pStage' }, [{ type: 'webhook', url: 'https://out.example/in', method: 'POST' }])],
    })
    const m = modelOf(w)
    expect(chainTo(m, AF, hook('out.example'))?.steps.map(stepNode)).toEqual(['pipeline:dbCoding', '@dbCoding:pStage', 'automation:dbCoding:autStage', hook('out.example')])
    expect(fused(m, AF, hook('out.example'))).toBe(true)
    // the git exit stays gated by the hold gate
    expect(chainTo(m, AF, git('push'))?.gate).toBe('afterApproval')
    // a task an agent wrote waits for Confirm: the worker writes nothing before it — the Stage path waits too (Stage is
    // "only by hand" here, so the agent cannot set it itself; the worker can)
    w.ws.agents = { agTask: agent('agTask', 'Aufgaben-Schreiber', { write: 'apply', scope: { everything: false, pages: [], databases: ['dbCoding', 'dbMails'] }, trigger: { type: 'row_created', databaseId: 'dbMails' } }) }
    w.ws.databases.dbCoding = { ...w.ws.databases.dbCoding, properties: w.ws.databases.dbCoding.properties.filter((p) => p.id !== 'pCodingPlan').map((p) => (p.id === 'pStage' ? { ...p, agentReadOnly: true } : p)) }
    const a = modelOf(w)
    expect(chainTo(a, agentKey('agTask'), hook('out.example'))?.gate).toBe('confirm')
  })

  test('a "testcases" doc stage writes new rows of the Test cases database: its row automation is reached', () => {
    const w = coding([{ id: 'stQueue', kind: 'queue', auto: true }, { id: 'stCases', kind: 'doc', auto: true, output: 'testcases' }, { id: 'stDone', kind: 'done', auto: false }], 'none', {
      databases: [database('dbCases', [], { system: 'testcases', automations: [automation('autCase', 'Neuer Fall → Chat', { type: 'row_created' }, [{ type: 'webhook', url: 'https://cases.example/in', method: 'POST' }])] })],
      pages: [dbPage('dbCases', 'Testfälle')],
    })
    const m = modelOf(w)
    expect(chainTo(m, AF, hook('cases.example'))?.steps.map(stepNode)).toEqual(['pipeline:dbCoding', '@dbCases:+row', 'automation:dbCases:autCase', hook('cases.example')])
    expect(fused(m, AF, hook('cases.example'))).toBe(true)
  })
})

/* ------------------------------------------------------------------ fix (safety-data): Claude Code in the worker */

/**
 * The review's probe p1: a local workspace — Mails is the mail sync's target; the automation „Mail → Aufgabe“ (new
 * mail) runs a script folded into it that adds a task to Coding; Coding runs queue → implement → push. No decider of
 * One's is on the path, yet Claude Code reads the mail's text in the task and chooses what the push carries.
 */
function workerWorld(stages: PipelineStage[], approvals: 'all' | 'review' | 'none', device: Partial<PbWorld['device']> = {}): PbWorld {
  return world({
    pages: [dbPage('dbMails', 'Mails'), dbPage('dbCoding', 'Coding · Nordlicht')],
    databases: [
      database('dbMails', [], { system: 'mails', automations: [automation('autTask', 'Mail → Aufgabe', { type: 'row_created' }, [{ type: 'run_script', scriptId: 'scTask' }])] }),
      database('dbCoding', [], { system: 'coding', pipeline: stages }),
    ],
    scripts: [script('scTask', 'Mail → Aufgabe', 'db(@[Coding](p:dbCoding)).add(page.current.title)')],
    mail: mailSettings('dbMails'),
    device: { ...device, worker: { ...LOCAL_DEVICE.worker, ...device.worker, approvals } },
  })
}
const IMPLEMENT_PUSH: PipelineStage[] = [
  { id: 'stQueue', kind: 'queue', auto: true },
  { id: 'stImpl', kind: 'implement', auto: true },
  { id: 'stPush', kind: 'git', auto: true, gitAction: 'push' },
]
const WORKER = key({ kind: 'pipeline', db: 'dbCoding', pipeline: 'coding' })

test.describe('fix (safety-data) · Claude Code in the coding worker', () => {
  test('outside content in a trusted task + a Claude Code stage before an unattended push: an unknown part on the pipeline — never a clean rack', () => {
    const m = modelOf(workerWorld(IMPLEMENT_PUSH, 'none'))
    expect(m.fuses).toEqual([])
    expect(m.unknown).toEqual([{ key: `worker:${WORKER}`, what: 'worker', module: WORKER }])
    expect(messages.en['features.patchbay.unknown.worker']).toContain('unknown here')
    expect(messages.de['features.patchbay.unknown.worker']).toContain('hier unbekannt')
    // approvals "review" passes no gate here either (there is none) — the push is still unattended
    expect(modelOf(workerWorld(IMPLEMENT_PUSH, 'review')).unknown.map((u) => u.what)).toEqual(['worker'])
  })

  test('nothing unknown where a person is in between or nothing comes from outside', () => {
    // a gate the approvals stop at before the push
    const gated: PipelineStage[] = [IMPLEMENT_PUSH[0], IMPLEMENT_PUSH[1], { id: 'stGate', kind: 'gate', auto: false }, IMPLEMENT_PUSH[2]]
    expect(modelOf(workerWorld(gated, 'review')).unknown).toEqual([])
    expect(modelOf(workerWorld(gated, 'none')).unknown.map((u) => u.what)).toEqual(['worker'])
    // no Claude Code stage before the push (the worker only pushes what is there)
    expect(modelOf(workerWorld([IMPLEMENT_PUSH[0], IMPLEMENT_PUSH[2], IMPLEMENT_PUSH[1]], 'none')).unknown).toEqual([])
    // a commit stays local
    expect(modelOf(workerWorld([IMPLEMENT_PUSH[0], IMPLEMENT_PUSH[1], { id: 'stCommit', kind: 'git', auto: true, gitAction: 'commit' }], 'none')).unknown).toEqual([])
    // the task rows hold nothing from outside: the automation runs on another database
    const own = workerWorld(IMPLEMENT_PUSH, 'none')
    own.ws.databases.dbMails = { ...own.ws.databases.dbMails, system: undefined }
    own.ws.settings = { mcpServers: [] }
    expect(modelOf(own).unknown).toEqual([])
    // only an agent writes the tasks: each waits for Confirm before the worker takes it (coding/trust.ts)
    const byAgent = workerWorld(IMPLEMENT_PUSH, 'none')
    byAgent.ws.databases.dbMails = { ...byAgent.ws.databases.dbMails, automations: [] }
    byAgent.ws.agents = { agTask: agent('agTask', 'Aufgaben-Schreiber', { write: 'apply', scope: { everything: false, pages: [], databases: ['dbCoding'] }, trigger: { type: 'row_created', databaseId: 'dbMails' } }) }
    const a = modelOf(byAgent)
    expect(a.unknown).toEqual([])
    expect(a.chains.find((c) => c.decider === agentKey('agTask') && c.exit?.module === git('push'))?.gate).toBe('confirm')
  })

  test('GitHub pick-ups: locally a sync-written task is trusted (unknown part); "Confirm always" or a team makes it wait (none)', () => {
    const sync = { github: { configured: true, auto: false, everyMin: 15, includePrivate: false, repo: 'nordlicht/notes' }, folder: { configured: false } }
    const w = workerWorld(IMPLEMENT_PUSH, 'none', { sync } as Partial<PbWorld['device']>)
    w.ws.databases.dbMails = { ...w.ws.databases.dbMails, system: undefined, automations: [] }
    w.ws.settings = { mcpServers: [] }
    expect(modelOf(w).unknown.map((u) => u.what)).toEqual(['worker'])
    const always = workerWorld(IMPLEMENT_PUSH, 'none', { sync, worker: { ...LOCAL_DEVICE.worker, confirm: 'always' } } as Partial<PbWorld['device']>)
    always.ws.databases.dbMails = { ...always.ws.databases.dbMails, system: undefined, automations: [] }
    always.ws.settings = { mcpServers: [] }
    expect(modelOf(always).unknown).toEqual([])
  })

  test('claudeBeforeGit: the stage kinds are coding\'s; a Claude Code stage must come before the outbound git step on an unattended walk', () => {
    expect([...CLAUDE_CODE_STAGES].sort()).toEqual([...CLAUDE_KINDS].sort())
    expect(claudeBeforeGit(IMPLEMENT_PUSH, 'none')).toBe(true)
    expect(claudeBeforeGit(REVIEW_MERGE, 'review')).toBe(true)
    expect(claudeBeforeGit(REVIEW_MERGE, 'all')).toBe(false)
    expect(claudeBeforeGit([IMPLEMENT_PUSH[0], { id: 'h', kind: 'gate', auto: false, hold: true }, IMPLEMENT_PUSH[1], IMPLEMENT_PUSH[2]], 'none')).toBe(false)
  })
})

/* ------------------------------------------------------------------ team API tokens */

function ticketWorld(lazy: Partial<PbWorld['lazy']>, device = OWNER): PbWorld {
  return world({
    pages: [dbPage('dbTickets', 'Tickets'), dbPage('dbPrivat', 'Privat')],
    databases: [
      database('dbTickets', [prop('pSend', 'Senden', 'checkbox')], { automations: [automation('autOut', 'Raus', { type: 'property_changed', propertyId: 'pSend' }, [{ type: 'webhook', url: 'https://out.example/in', method: 'POST' }])] }),
      database('dbPrivat', []),
    ],
    agents: [agent('agTri', 'Triage', { write: 'apply', scope: { everything: true, pages: [], databases: [] }, trigger: { type: 'row_created', databaseId: 'dbTickets' }, createdBy: 'acMara', updatedBy: 'acMara' })],
    device,
    lazy: { hooks: [], runtime: [], ...lazy },
  })
}

test.describe('fix · team API tokens (content from outside everywhere)', () => {
  test('a write token → a fuse through the agent its rows start; a read token or none → nothing; not read → an unknown part', () => {
    const tri = agentKey('agTri')
    const m = modelOf(ticketWorld({ tokens: [{ id: 'tkFlow', write: true }] }))
    expect(fused(m, tri, hook('out.example'))).toBe(true)
    const f = m.fuses.find((x) => x.chain.decider === tri)!
    expect(f.chain.why?.outside[0]).toMatchObject({ kind: 'api', source: 'incoming:api%3AtkFlow:-:-', via: 'trigger' })
    expect(f.lamps.outside.say.key).toBe('features.patchbay.lamp.outside.api')
    expect(m.modules.find((x) => x.key === 'incoming:api%3AtkFlow:-:-')?.tags).toContain('outside')
    expect(modelOf(ticketWorld({ tokens: [{ id: 'tkRead', write: false }] })).fuses).toEqual([])
    expect(modelOf(ticketWorld({ tokens: [] })).unknown).toEqual([])
    const unread = modelOf(ticketWorld({}))
    expect([unread.fuses, unread.unknown.map((u) => u.key)]).toEqual([[], ['lazy:incoming:-:-:-']])
    // a member reads 'forbidden': an unknown part, never "none"
    expect(modelOf(ticketWorld({ hooks: 'forbidden', tokens: 'forbidden' }, TEAM('acMara', 'member'))).unknown.map((u) => u.what)).toEqual(['hooks'])
  })

  test('a token never writes a member\'s private page; the lazy cache keeps ids and the write flag only', () => {
    const w = ticketWorld({ tokens: [{ id: 'tkFlow', write: true }] })
    w.ws.agents = { agPriv: agent('agPriv', 'Privat-Helfer', { write: 'apply', scope: { everything: false, pages: [], databases: ['dbPrivat', 'dbTickets'] }, trigger: { type: 'schedule', every: 'day', at: '07:00', tz: 'Europe/Berlin' }, createdBy: 'acMara', updatedBy: 'acMara' }) }
    w.ws.pages.dbPrivat = { ...w.ws.pages.dbPrivat, private: true }
    const srcs = modelOf(w).chains.find((c) => c.decider === agentKey('agPriv'))?.why?.outside ?? []
    expect(srcs.filter((s) => s.kind === 'api').map((s) => s.place)).toEqual([{ db: 'dbTickets' }])
    const cache = lazyCacheOf({ scans: null, runtime: null, hooks: [], tokens: [{ id: 'tkFlow', write: true, name: 'Nordlicht Flow' } as never], inbox: null, inboxRead: false }, null, 1)
    expect(cache.tokens).toEqual([{ id: 'tkFlow', write: true }])
    // a later reading not taken keeps the cache's tokens; the model counts from it
    expect(lazyCacheOf({ scans: null, runtime: null, hooks: null, inbox: null, inboxRead: false }, cache, 2).tokens).toEqual([{ id: 'tkFlow', write: true }])
    const cached = ticketWorld({ cache, tokens: null })
    expect(fused(modelOf(cached), agentKey('agTri'), hook('out.example'))).toBe(true)
  })
})

/* ------------------------------------------------------------------ data rules per class, MCP per provider */

test.describe('fix · the providers of a decider: every routable pin of its class\'s winning rule', () => {
  test('agents: OpenRouter is not routable for agents — the mail goes to Claude, the fuse stays', () => {
    const m = withAI(mails([reader()]), { device: { routes: { agents: [OR, CLAUDE] } } })
    expect(chainTo(m, agentKey('agLeser'), hook('chat.example'))?.lamps?.outside.on).toBe(true)
    expect(m.fuses.length).toBe(1)
  })

  test('autofill and organise are class "bulk": their own rule decides (OpenRouter may receive mail here → a fuse)', () => {
    const w = autofillWorld({ hook: true })
    w.ws.settings = { ...w.ws.settings, mcpServers: [] }
    const ai = { workspace: WS_OR, device: { narrow: { anthropic: ['mail'] }, allow: { openrouter: ['mail'] }, routes: { bulk: [{ p: 'openrouter', m: 'vendor/model-x' }] } } }
    expect(fused(withAI(w, ai), key({ kind: 'autofill', db: 'dbMails', prop: 'pMailSum' }), hook('digest.example'))).toBe(true)
    expect(fused(withAI(organiseWorld(), ai), key({ kind: 'organise', db: 'dbMails' }), hook('sort.example'))).toBe(true)
    // agents on OpenRouter, bulk on Claude: the autofill's mail goes to Claude
    const sum = mails([], { mailProps: [prop('pMailSum', 'Kurz', 'text', { autofill: { preset: 'summary', auto: true } }), prop('pMailRel', 'Kontakt', 'relation', { relationDatabaseId: 'dbKontakte' })], mailAutomations: [automation('autSum', 'Kurz → Chat', { type: 'property_changed', propertyId: 'pMailSum' }, [{ type: 'webhook', url: 'https://chat.example/hook', method: 'POST' }])], pages: [dbPage('dbKontakte', 'Kontakte')], databases: [database('dbKontakte', [])] })
    expect(chainTo(withAI(sum, { device: { routes: { agents: [OR], bulk: [CLAUDE] } } }), key({ kind: 'autofill', db: 'dbMails', prop: 'pMailSum' }), hook('chat.example'))?.lamps?.outside.on).toBe(true)
    // the other way round: bulk on OpenRouter that may not receive mail — withheld (a data-rule near miss)
    const held = withAI(sum, { device: { routes: { bulk: [OR] } } })
    expect(held.nearMisses.map((n) => [n.why, n.chain.decider])).toContainEqual(['dataRule', key({ kind: 'autofill', db: 'dbMails', prop: 'pMailSum' })])
  })

  test('a decider on a route MCP servers never join (not Claude) has no MCP source and no MCP way out', () => {
    const w = mails([], { mailProps: [prop('pMailSum', 'Kurz', 'text', { autofill: { preset: 'summary', auto: true } })], servers: [server('srvAlpha', 'alpha', { tools: ['list_items', 'create_item'], checkedAt: 1, scope: 'all' })] })
    const af = key({ kind: 'autofill', db: 'dbMails', prop: 'pMailSum' })
    const alpha = key({ kind: 'server', id: 'srvAlpha', name: 'alpha' })
    expect(chainTo(modelOf(w), af, alpha)).toBeDefined()
    const m = withAI(w, { workspace: WS_OR, device: { routes: { bulk: [OR] }, allow: { openrouter: ['mail', 'mcp', 'memory', 'private'] } } })
    expect(chainTo(m, af, alpha)).toBeUndefined()
    expect(m.chains.flatMap((c) => c.why?.outside ?? []).filter((s) => s.kind === 'mcp')).toEqual([])
  })

  test('"mcp" withheld closes an MCP-only path: one data rule, one near-miss reason', () => {
    const w = world({ pages: [dbPage('dbNotizen', 'Notizen')], databases: [database('dbNotizen', [])], agents: [agent('agMcp', 'Tracker-Helfer', { write: 'apply', scope: { everything: true, pages: [], databases: [] }, mcpServers: ['tracker'] })], servers: [server('srvTracker', 'tracker', { tools: [...TRACKER_TOOLS], checkedAt: 1 })] })
    const m = withAI(w, { device: { narrow: { anthropic: ['mcp'] } } })
    expect(m.fuses).toEqual([])
    expect(m.nearMisses.map((n) => [n.why, n.chain.decider])).toEqual([['dataRule', agentKey('agMcp')]])
  })
})

/* ------------------------------------------------------------------ servers */

test.describe('fix · servers the model cannot see whole', () => {
  const hookAgent = (servers: string[]) => agent('agHook', 'Hook', { runner: 'server', write: 'none', trigger: { type: 'webhook' }, createdBy: 'acMara', updatedBy: 'acMara', scope: { everything: false, pages: [], databases: ['dbPrivat'] }, mcpServers: servers })

  test('a runtime server never borrows the tool list or the OUT tools of a same-named server at another host', () => {
    const base = { pages: [dbPage('dbPrivat', 'Privat')], databases: [database('dbPrivat', [])], agents: [hookAgent(['tracker'])], device: OWNER }
    const rt = key({ kind: 'server', id: null, name: 'tracker', runtime: true })
    const readOnly = world({ ...base, servers: [server('srvT', 'tracker', { tools: ['query_issues', 'get_issue'], checkedAt: 1 })], lazy: { hooks: [], tokens: [], runtime: [{ name: 'tracker', host: 'tracker.corp.example' }] } })
    const m = modelOf(readOnly)
    expect(m.fuses.map((f) => [f.chain.decider, f.chain.exit?.module, f.lamps.out.say.key])).toEqual([[agentKey('agHook'), rt, 'features.patchbay.lamp.out.failClosed']])
    const sending = world({ ...base, servers: [server('srvT', 'tracker', { tools: ['query_issues', 'post_status'], checkedAt: 1 })], integrations: [profile('in-01', { match: { host: 'tracker.example' }, sends: [{ id: 'r1', name: 'Status', tool: 'post_status', args: {} }] as never })], lazy: { hooks: [], tokens: [], runtime: [{ name: 'tracker', host: 'tracker.corp.example' }] } })
    expect(modelOf(sending).fuses.map((f) => f.chain.exit?.module)).toEqual([rt])
    // the same host: its list is this server's (read tools only → no way out)
    const same = world({ ...base, servers: [server('srvT', 'tracker', { url: 'https://tracker.corp.example/mcp', tools: ['query_issues', 'get_issue'], checkedAt: 1 })], lazy: { hooks: [], tokens: [], runtime: [{ name: 'tracker', host: 'tracker.corp.example' }] } })
    expect(modelOf(same).fuses).toEqual([])
  })

  test('a runtime list from the lazy cache may be stale: a server it lacks is an unknown part; one read this session lacking it is none', () => {
    const base = { pages: [dbPage('dbPrivat', 'Privat')], databases: [database('dbPrivat', [])], agents: [hookAgent(['kanal'])], device: OWNER }
    const cached = modelOf(world({ ...base, lazy: { hooks: [], tokens: [], cache: { v: 1, scripts: {}, hooks: [], runtime: [], inbox: null, inboxRead: true, at: 1 } } }))
    expect(cached.unknown.map((u) => u.key)).toEqual([`lazy:${agentKey('agHook')}`])
    expect(modelOf(world({ ...base, lazy: { hooks: [], tokens: [], runtime: [] } })).unknown).toEqual([])
  })

  test('team: a browser agent\'s server not set up on this device of its creator is an unknown part (another browser may run it)', () => {
    const mk = (team: boolean) =>
      world({
        pages: [dbPage('dbMails', 'Mails'), dbPage('dbPrivat', 'Privat')],
        databases: [database('dbMails', [], { system: 'mails' }), database('dbPrivat', [])],
        agents: [agent('agA', 'Helfer', { scope: { everything: false, pages: [], databases: ['dbMails', 'dbPrivat'] }, trigger: { type: 'schedule', every: 'day', at: '07:00', tz: 'Europe/Berlin' }, mcpServers: ['kanal'], createdBy: team ? 'acMara' : null, updatedBy: team ? 'acMara' : null })],
        device: team ? { ...OWNER, worker: LOCAL_DEVICE.worker } : {},
        lazy: team ? { hooks: [], tokens: [], runtime: [] } : {},
      })
    expect(modelOf(mk(true)).unknown.map((u) => u.key)).toEqual([`elsewhere:${agentKey('agA')}`])
    // a local workspace runs it here only: left out, nothing unknown
    expect(modelOf(mk(false)).unknown).toEqual([])
    expect(messages.de['features.patchbay.unknown.elsewhere']).toBeTruthy()
  })

  test('a server agent with a Vorprüfer never runs on the team server: no decider, the module blocked', () => {
    const mk = (review?: unknown) =>
      world({
        pages: [dbPage('dbTickets', 'Tickets')],
        databases: [database('dbTickets', [])],
        agents: [agent('agSrv', 'Ticket-Wächter', { runner: 'server', write: 'apply', createdBy: 'acMara', trigger: { type: 'webhook' }, scope: { everything: true, pages: [], databases: [] }, mcpServers: ['tracker'], ...(review ? { review: review as never } : {}) })],
        device: OWNER,
        lazy: { hooks: [], tokens: [], runtime: [{ name: 'tracker', host: 'tracker.example' }] },
      })
    const srv = agentKey('agSrv')
    expect(modelOf(mk()).fuses.some((f) => f.chain.decider === srv)).toBe(true)
    const m = modelOf(mk({ v: 2, on: 'openrouter:typesafe/jev-1.13-20260917', pre: { markBelow: 0.7, hold: false }, gate: { allowAt: 0.9 } }))
    expect(m.chains.map((c) => c.decider)).not.toContain(srv)
    expect(m.modules.find((x) => x.key === srv)).toMatchObject({ blocked: 'server' })
    expect(m.modules.find((x) => x.key === srv)?.tags).toContain('blocked')
  })
})

/* ------------------------------------------------------------------ scripts */

function scriptWorld(code: string, onMails = false): PbWorld {
  return world({
    pages: [dbPage('dbMails', 'Mails'), dbPage('dbProj', 'Projekte'), dbPage('dbNotiz', 'Notizen'), dbPage('dbPrivat', 'Privat')],
    databases: [
      database('dbMails', [], { system: 'mails', ...(onMails ? { automations: [automation('autCopy', 'Neue Mail → Notiz', { type: 'row_created' }, [{ type: 'run_script', scriptId: 'scCopy' }])] } : {}) }),
      database('dbProj', [], onMails ? {} : { automations: [automation('autCopy', 'Neues Projekt → Notiz', { type: 'row_created' }, [{ type: 'run_script', scriptId: 'scCopy' }])] }),
      database('dbNotiz', [prop('pSend', 'Senden', 'checkbox')], { automations: [automation('autOut', 'Raus', { type: 'property_changed', propertyId: 'pSend' }, [{ type: 'webhook', url: 'https://out.example/in', method: 'POST' }])] }),
      database('dbPrivat', []),
    ],
    scripts: [script('scCopy', 'Mail → Notiz', code)],
    agents: [agent('agB', 'Notiz-Helfer', { write: 'apply', scope: { everything: false, pages: [], databases: ['dbNotiz', 'dbPrivat'] }, trigger: { type: 'row_created', databaseId: 'dbNotiz' } })],
    mail: mailSettings('dbMails'),
  })
}

test.describe('fix · scripts', () => {
  test('a script folded into its automation: what it reads taints what it writes, as when it is used twice', () => {
    const m = modelOf(scriptWorld('let m = db(@[Mails](p:dbMails)).first\ndb(@[Notizen](p:dbNotiz)).add(m.title, Quelle: "Mail")'))
    expect(m.modules.find((x) => x.key === 'automation:dbProj:autCopy')?.folds).toEqual({ script: 'scCopy' })
    expect(fused(m, agentKey('agB'), hook('out.example'))).toBe(true)
    expect(m.fuses[0].chain.why?.outside[0]).toMatchObject({ kind: 'tainted', place: { db: 'dbNotiz' }, writer: 'automation:dbProj:autCopy' })
  })

  test('refs by name: an unknown part on the module, and what it writes (fed from outside) is from outside everywhere', () => {
    const m = modelOf(scriptWorld('db("Notizen").add(page.current.title, Quelle: "Mail")', true))
    expect(m.unknown.map((u) => u.key)).toEqual(['byName:automation:dbMails:autCopy'])
    expect(fused(m, agentKey('agB'), hook('out.example'))).toBe(true)
    // not folded (used by a command too): the script module carries the unknown part
    const w = scriptWorld('db("Notizen").add("x")')
    w.ws.databases.dbProj = { ...w.ws.databases.dbProj, commands: [{ id: 'cmdCopy', kind: 'script', label: 'Kopieren', icon: null, config: { scriptId: 'scCopy' } }] }
    expect(modelOf(w).unknown.map((u) => u.key)).toEqual(['byName:script:scCopy'])
  })
})

/* ------------------------------------------------------------------ organise, signatures */

test.describe('fix · organise starts from the mail sync only; the signature', () => {
  test('an agent creating a Mails row never starts "Organise with Claude" — „only by hand“ holds', () => {
    const w = mails([reader()], {
      mailProps: [prop('pMailCat', 'Kategorie', 'select', { options: [], agentReadOnly: true })],
      mailAutomations: [automation('autCat', 'Kategorie → Chat', { type: 'property_changed', propertyId: 'pMailCat' }, [{ type: 'webhook', url: 'https://chat.example/hook', method: 'POST' }])],
      mail: { organise: { enabled: true, categories: ['Rechnung'], priority: false, needsReply: false, summary: false, relationDatabaseId: null }, props: { category: 'pMailCat' } } as never,
    })
    const m = modelOf(w)
    expect(chainTo(m, agentKey('agLeser'), hook('chat.example'))).toBeUndefined()
    // organise itself still sorts the synced mails: started by the mail rows' trigger only
    const org = key({ kind: 'organise', db: 'dbMails' })
    expect(m.edges.filter((e) => e.to === `${org}.start`).map((e) => e.from)).toEqual(['rowTrigger:dbMails:created:-.start'])
  })

  test('a new outside source reaching an allowed path lapses the allowance, naming the source', () => {
    const notes = database('dbNotizen', [prop('pNotizText', 'Text', 'text')])
    const a = reader({ scope: { everything: false, pages: [], databases: ['dbMails', 'dbNotizen'] } })
    const base = (agents: CustomAgent[], servers: ReturnType<typeof server>[] = []) => mails(agents, { pages: [dbPage('dbNotizen', 'Notizen')], databases: [notes], servers })
    const f = modelOf(base([a])).fuses[0]
    const signoffs = { [f.key]: { sig: f.sig!, parts: f.parts!, at: 1, updatedBy: null } }
    const w0 = base([a])
    w0.ws.fuseSignoffs = signoffs
    expect(modelOf(w0).fuses[0].allowed?.state).toBe('allowed')
    const mirror = agent('agMirror', 'Notiz-Spiegel', { write: 'apply', scope: { everything: false, pages: [], databases: ['dbNotizen'] }, trigger: { type: 'schedule', every: 'day', at: '07:00', tz: 'Europe/Berlin' }, mcpServers: ['tracker'], mcpTools: { tracker: [...TRACKER_READS] } })
    const w1 = base([a, mirror], [server('srvTracker', 'tracker', { tools: [...TRACKER_TOOLS], checkedAt: 1 })])
    w1.ws.fuseSignoffs = signoffs
    const leser = modelOf(w1).fuses.find((x) => x.key === f.key)!
    expect(leser.chain.why?.outside.some((s) => s.kind === 'tainted' && s.writer === agentKey('agMirror'))).toBe(true)
    expect(leser.allowed?.state).toBe('lapsed')
    expect(leser.allowed?.changed).toContain(agentKey('agMirror'))
  })

  test('this device\'s kit trust is no part of the signature: a shared allowance holds on a device that has not confirmed the code', () => {
    const code = 'row.Status = "fertig" ? 10 : 0'
    const mk = (kitTrust: Record<string, boolean>) => {
      const w = relays()
      w.ws.agents!.agTesseraServer = { ...w.ws.agents!.agTesseraServer, trigger: { type: 'webhook' }, createdBy: 'acMara' }
      w.device = { ...w.device, ctx: { team: true, me: 'acMara', role: 'owner', readOnly: false, supports: ['ai', 'governor', 'signoffs'] }, kitTrust }
      w.lazy = { ...w.lazy, hooks: [], tokens: [], runtime: [] }
      return w
    }
    const f = modelOf(mk({ [digest(code)]: true })).fuses.find((x) => x.chain.decider === agentKey('agTesseraServer'))!
    expect(f).toBeDefined()
    const b = mk({})
    b.ws.fuseSignoffs = { [f.key]: { sig: f.sig!, parts: f.parts!, at: 1, updatedBy: 'acMara' } }
    expect(modelOf(b).fuses.find((x) => x.key === f.key)?.allowed?.state).toBe('allowed')
  })
})

/* ------------------------------------------------------------------ fix (rest) */

test.describe('fix (rest) · kit value codes read beyond their row; declarations never make a sending tool a read', () => {
  /** „Letzte Mail“ on Projekte computes from the Mails database; Projekt-Helfer listens to it and may set „Senden“ (→ webhook). */
  function kitWorld(value: string) {
    const kit = { lists: {}, propTypes: { ptLast: { id: 'ptLast', name: 'Letzte Mail', base: 'text', scripts: { value }, createdAt: 1, updatedAt: 1 } }, recordTypes: {} }
    return world({
      pages: [dbPage('dbMails', 'Mails'), dbPage('dbProj', 'Projekte'), dbPage('dbPrivat', 'Privat')],
      databases: [
        database('dbMails', [], { system: 'mails' }),
        database('dbProj', [prop('pLast', 'Letzte Mail', 'text', { custom: 'ptLast' }), prop('pSend', 'Senden', 'checkbox')], { automations: [automation('autOut', 'Raus', { type: 'property_changed', propertyId: 'pSend' }, [{ type: 'webhook', url: 'https://out.example/in', method: 'POST' }])] }),
        database('dbPrivat', []),
      ],
      kit: kit as never,
      agents: [agent('agB', 'Projekt-Helfer', { write: 'apply', scope: { everything: false, pages: [], databases: ['dbProj', 'dbPrivat'] }, trigger: { type: 'row_changed', databaseId: 'dbProj', propertyId: 'pLast' } })],
      mail: mailSettings('dbMails'),
    })
  }
  const kitKey = key({ kind: 'kit', db: 'dbProj', prop: 'pLast', type: 'ptLast' })

  test('a value code that reads Mails taints its database: the agent listening to the field is fed — a fuse to the webhook', () => {
    const m = modelOf(kitWorld('db(@[Mails](p:dbMails)).first.title'))
    expect(m.modules.some((x) => x.key === kitKey)).toBe(true)
    expect(fused(m, agentKey('agB'), hook('out.example'))).toBe(true)
    const f = m.fuses.find((x) => x.chain.decider === agentKey('agB'))!
    expect(f.chain.why?.outside.some((s) => s.kind === 'tainted' && s.writer === kitKey)).toBe(true)
    expect(m.unknown.filter((u) => u.module === kitKey)).toEqual([])
    // the same value from its own row only: nothing from outside reaches Projekte
    expect(modelOf(kitWorld('row.Senden ? "ja" : "nein"')).fuses).toEqual([])
  })

  test('a value code not scanned here (nor in the lazy cache) or naming places by name is an unknown part on the relay', () => {
    const w = kitWorld('db(@[Mails](p:dbMails)).first.title')
    w.lazy = { ...w.lazy, kitScans: {} }
    expect(modelOf(w).unknown.map((u) => u.key)).toContain(`lazy:${kitKey}`)
    // … the lazy cache's scan (by the code's digest) counts like one made here
    const code = digest('db(@[Mails](p:dbMails)).first.title')
    w.lazy = { ...w.lazy, kitScans: null, cache: lazyCacheOf({ scans: null, kits: { [code]: { reads: [{ page: 'dbMails' }], byName: false } }, runtime: null, hooks: null, inbox: null, inboxRead: false }, null, 1) }
    const cached = modelOf(w)
    expect(cached.unknown.filter((u) => u.module === kitKey)).toEqual([])
    expect(fused(cached, agentKey('agB'), hook('out.example'))).toBe(true)
    // by name
    expect(modelOf(kitWorld('db("Mails").first.title')).unknown.map((u) => u.key)).toContain(`byName:${kitKey}`)
  })

  test('the lazy cache keeps kit scans by digest — ids and the flag only', () => {
    const dirty = lazyCacheOf({ scans: null, kits: { ['a'.repeat(16)]: { reads: [{ page: 'dbMails', title: 'Mara Lind' } as never], byName: 1 as never, extra: 'x' } as never, notADigest: { reads: [], byName: false } }, runtime: null, hooks: null, inbox: null, inboxRead: false }, null, 1)
    expect(dirty.kits).toEqual({ ['a'.repeat(16)]: { reads: [{ page: 'dbMails' }], byName: true } })
    // a reading not taken keeps the cache's own
    expect(lazyCacheOf({ scans: null, runtime: null, hooks: null, inbox: null, inboxRead: false }, dirty, 2).kits).toEqual(dirty.kits)
  })

  test('a profile declaring forward / share / notify tools reads: they stay ways out (WRITE?, marked)', () => {
    const mk = (reads: string[]) =>
      world({
        pages: [dbPage('dbMails', 'Mails'), dbPage('dbPrivat', 'Privat')],
        databases: [database('dbMails', [], { system: 'mails' }), database('dbPrivat', [])],
        agents: [agent('agA', 'Helfer', { write: 'none', scope: { everything: false, pages: [], databases: ['dbMails', 'dbPrivat'] }, trigger: { type: 'row_created', databaseId: 'dbMails' }, mcpServers: ['alpha'] })],
        servers: [server('srvAlpha', 'alpha', { tools: ['list_items', 'forward_email', 'share_document', 'notify_channel'], checkedAt: 1 })],
        integrations: [profile('in-02', { match: { name: 'alpha' }, reads })],
        mail: mailSettings('dbMails'),
      })
    const alpha = key({ kind: 'server', id: 'srvAlpha', name: 'alpha' })
    expect(fused(modelOf(mk(['list_items'])), agentKey('agA'), alpha)).toBe(true)
    const declared = modelOf(mk(['list_items', 'forward_email', 'share_document', 'notify_channel']))
    expect(fused(declared, agentKey('agA'), alpha)).toBe(true)
    expect(declared.modules.find((x) => x.key === alpha)?.outJacks.find((j) => j.role === 'write')).toMatchObject({ count: 3, declaredRead: ['forward_email', 'share_document', 'notify_channel'] })
  })
})

test('every new message key in both languages', () => {
  for (const k of ['lamp.outside.api', 'plain.fuse.src.api', 'name.incomingApi', 'unknown.byName', 'unknown.elsewhere', 'fact.approvalsPass']) {
    expect(messages.en[`features.patchbay.${k}`], k).toBeTruthy()
    expect(messages.de[`features.patchbay.${k}`], k).toBeTruthy()
  }
  expect(Object.keys(messages.de).sort()).toEqual(Object.keys(messages.en).sort())
})
