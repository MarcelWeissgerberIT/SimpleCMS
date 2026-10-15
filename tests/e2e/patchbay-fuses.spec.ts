/**
 * The Patchbay ("Schaltplan") — B4: fuses, signatures, plain words, unknown parts, near misses, the lazy cache
 * (features/patchbay/fuses.ts, sig.ts, plain.ts, cache.ts, messages-fuses.ts), run by the Playwright runner in Node.
 * Fixtures: tests/fixtures/patchbay.ts (`mock1()`, `exits()`, `relays()`, `bigPatchbay()`) and
 * tests/fixtures/patchbay-fuses.ts (one small world per way out / decider). Plan §4 B4, §1.3, §1.9, §1.21, §2.6, §2.7,
 * §3.6, §6 A2 A4 A7 A13 A15 A16 A18 U11 U30 U31:
 *  - mock 1 → exactly F1 on „An Team-Chat“ → webhook, the path Mails → Inbox-Helfer → „Weiterleiten“ → An Team-Chat →
 *    Webhook, 3 steps, keys 1 / 2 / 3 offered;
 *  - each way out and each decider; declared reads never silence a write tool;
 *  - unknown parts never become a fuse and never "nothing"; near misses are listed and never counted;
 *  - the signature: canonical JSON, SHA-256 = WebCrypto, path keys, parts ≤ 24, lapse names the right module, book-
 *    keeping never changes it;
 *  - plain words EN + DE (German without pronouns), every message key in both languages;
 *  - the lazy cache: ids and hosts only, and the fuse count from eager inputs + cache = the count with every reading;
 *  - bigPatchbay(60): model + chains + fuses median ≤ 10 ms.
 * Every page and value is fictional.
 */
import { test, expect } from './fixtures'
import { buildModel } from '../../src/app/features/patchbay/model'
import { closedNearMiss, fuseCounts, fuseHints, nearSay, unknownSay, type FusedModel } from '../../src/app/features/patchbay/fuses'
import { allowedState, canon, pathKey, sha256Hex, sigInputOf, sigOf, sigWorld, MAX_PARTS } from '../../src/app/features/patchbay/sig'
import { describe as describeModule, fuseSay, plainOf, sayMsg, text } from '../../src/app/features/patchbay/plain'
import { lazyCacheOf } from '../../src/app/features/patchbay/cache'
import { messages } from '../../src/app/features/patchbay/messages-fuses'
import { moduleKey } from '../../src/app/features/patchbay/ref'
import { placeKey } from '../../src/app/features/patchbay/rules'
import type { Chain, ChainStep, FuseState, Model, ModelInput, MsgRef } from '../../src/app/features/patchbay/types'
import type { CustomAgent, Database, Kit } from '../../src/app/store/types'
import { sanitizeFuseSignoffs, signoffEntry } from '../../src/app/store/fuseSignoffs'
import {
  NO_LAZY,
  TRACKER_READS,
  agent,
  automation,
  bigPatchbay,
  database,
  dbPage,
  exits,
  inputOf,
  mailSettings,
  mock1,
  modelOf,
  page,
  profile,
  prop,
  relays,
  script,
  server,
  world,
  type PbWorld,
} from '../fixtures/patchbay'
import { ALPHA, TEAM, TRACKER, autofillWorld, ctxOf, hookWorld, inboxHelper, mailWorld, organiseWorld, pipelineWorld, pushWorld } from '../fixtures/patchbay-fuses'

/* ------------------------------------------------------------------ helpers */

const key = moduleKey
const P = 'features.patchbay'
const agentKey = (id: string) => key({ kind: 'agent', id })
const autKey = (db: string, id: string) => key({ kind: 'automation', db, id })
const hook = (host: string, method = 'POST') => `outbound:webhook:${host}:${method}`
const stepNode = (s: ChainStep) => (typeof s.to === 'string' ? s.to : `@${placeKey(s.to)}`)
const fusesTo = (m: FusedModel, decider: string, exit?: string): FuseState[] => m.fuses.filter((f) => f.chain.decider === decider && (!exit || f.chain.exit?.module === exit))
const fuseTo = (m: FusedModel, decider: string, exit: string): FuseState | undefined => fusesTo(m, decider, exit)[0]
const keyOf = (f: FuseState, n: 1 | 2 | 3) => f.keys.find((k) => k.n === n)
/** Build the rack of a world with its input changed first (signoffs, data rules, device facts). */
const modelWith = (w: PbWorld, change: (input: ModelInput) => ModelInput) => buildModel(change(inputOf(w)))
const narrow = (cls: string) => (input: ModelInput): ModelInput => ({ ...input, ai: { ...input.ai, device: { narrow: { anthropic: [cls] } } as ModelInput['ai']['device'] } })

/** The signature of a world's chain (fuse or not) — for the lapse cases. */
function sigFor(w: PbWorld, pick: (c: Chain) => boolean): { sig: string; parts: Record<string, string>; owners: Record<string, string[]> } {
  const input = inputOf(w)
  const m = buildModel(input)
  const chain = m.chains.find(pick)
  if (!chain) throw new Error('no such chain')
  const si = sigInputOf(chain, sigWorld(m as Model, input))
  return { ...sigOf(si), owners: si.owners }
}
const changedBetween = (a: { sig: string; parts: Record<string, string> }, b: { sig: string; parts: Record<string, string>; owners: Record<string, string[]> }) =>
  allowedState({ sig: a.sig, parts: a.parts, at: 1, updatedBy: null }, b, b.owners)

/** Every message ref a model's fuses and near misses carry (lamps, facts — label and value —, keys, mitigations). */
function refsOf(m: FusedModel): MsgRef[] {
  const out: MsgRef[] = []
  for (const f of m.fuses) {
    out.push(f.lamps.outside.say, f.lamps.private.say, f.lamps.out.say)
    for (const l of [f.lamps.outside, f.lamps.private, f.lamps.out]) if (l.detail) out.push(l.detail)
    for (const fa of f.facts) out.push(fa.say, { key: `${P}.fact.label.${fa.kind}` })
    for (const mi of f.mitigations) out.push(mi.say)
    for (const k of f.keys) for (const r of [k.label, k.what, k.note, k.refusal, k.team, k.asks]) if (r) out.push(r)
  }
  for (const n of m.nearMisses) if (n.chain.lamps) out.push(n.chain.lamps.outside.say, n.chain.lamps.private.say, n.chain.lamps.out.say, nearSay(n))
  for (const u of m.unknown) out.push(unknownSay(u))
  return out
}

/* ------------------------------------------------------------------ mock 1 */

test.describe('B4 · mock 1 — exactly F1', () => {
  test('F1 sits on „An Team-Chat“ → webhook: Mails → Inbox-Helfer → „Weiterleiten“ → An Team-Chat → Webhook, 3 steps, keys 1 / 2 / 3 offered', () => {
    const w = mock1()
    const m = modelOf(w)
    const helper = agentKey(w.ids.inboxHelper)
    const toChat = autKey(w.ids.mails, w.ids.toChat)
    expect(m.fuses).toHaveLength(1)
    const f1 = m.fuses[0]
    expect(f1.label).toBe('F1')
    // the glyph: on the cable from the automation's out jack into the webhook (tc.o → hook.i)
    expect(f1.at).toBe(`${toChat}.out>${hook('chat.example')}.out`)
    expect(f1.chain.source).toBe('rowTrigger:dbMails:created:-')
    expect([f1.chain.decider, ...f1.chain.steps.map(stepNode)]).toEqual([helper, `@${w.ids.mails}:${w.ids.forward}`, toChat, hook('chat.example')])
    expect(f1.chain.steps).toHaveLength(3)
    expect([f1.lamps.outside.on, f1.lamps.private.on, f1.lamps.out.on, f1.chain.gate]).toEqual([true, true, true, undefined])
    // identity: the path key is SHA-256 over the ids along the path (64 hex)
    expect(f1.key).toMatch(/^[0-9a-f]{64}$/)
    expect(f1.key).toBe(pathKey(f1.chain.key))
    expect(f1.keys.map((k) => [k.n, k.kind, k.offered])).toEqual([
      [1, 'proposals', true],
      [2, 'handOnly', true],
      [3, 'allow', true],
    ])
    expect(keyOf(f1, 1)).toMatchObject({ target: { agent: w.ids.inboxHelper }, note: { key: `${P}.key.proposalsLeft`, vars: { automation: toChat } } })
    expect(keyOf(f1, 2)).toMatchObject({ target: { db: w.ids.mails, prop: w.ids.forward }, label: { key: `${P}.key.handOnly`, vars: { db: w.ids.mails, prop: w.ids.forward } } })
    expect(keyOf(f1, 3)).toMatchObject({ target: { path: f1.key } })
    expect(f1.facts.map((x) => [x.kind, x.say.key.replace(`${P}.fact.`, '')])).toEqual([
      ['writeMode', 'write.apply'],
      ['reach', 'reach.everything'],
      ['trigger', 'trigger.field'],
      ['chain', 'chain'],
      ['browserAgent', 'browserAgent.local'],
    ])
    expect(f1.facts.find((x) => x.kind === 'trigger')?.say.vars).toEqual({ db: w.ids.mails, prop: w.ids.forward, method: 'POST' })
    expect(f1.mitigations.map((x) => x.kind)).toEqual(['directSplit', 'webImages'])
    // the pipeline's chain waits for Confirm: a near miss, never counted
    expect(m.nearMisses.map((n) => [n.why, n.chain.gate, n.chain.exit?.module])).toEqual([['gate', 'confirm', 'outbound:git:-:pr']])
    expect(fuseCounts(m)).toEqual({ open: 1, allowed: 0, unknown: 0 })
    // where the settings live: the agent and the automation say "On fuse F1"
    expect(fuseHints(m).map((h) => [h.kind, h.id, h.fuse.label])).toEqual([
      ['agent', w.ids.inboxHelper, 'F1'],
      ['automation', `${w.ids.mails}:${w.ids.toChat}`, 'F1'],
    ])
  })
})

/* ------------------------------------------------------------------ each way out */

test.describe('B4 · each way out (§1.4)', () => {
  test('MCP WRITE? on a stage agent → a fuse; key 1 is not offered (tools run in the AI’s loop); key 2 keeps the read tools', () => {
    const m = modelOf(exits())
    const stage = agentKey('agExStage')
    const alpha = key({ kind: 'server', id: 'srvAlpha', name: 'alpha' })
    const f = fuseTo(m, stage, alpha)!
    expect(f).toBeDefined()
    expect(f.facts[0].say.key).toBe(`${P}.fact.write.stage`)
    expect(keyOf(f, 1)).toMatchObject({ kind: 'proposals', offered: false, refusal: { key: `${P}.key.mcpNoReview` } })
    expect(keyOf(f, 2)).toMatchObject({ kind: 'cutTools', offered: true, target: { agent: 'agExStage', server: 'alpha', keep: ['list_items', 'search_web'] } })
    // a read tool that may carry data out stays connected — named, never fused
    expect(f.residual).toEqual(['search_web'])
    // the OUT tool (send_message) is locked: a mitigation, never a way out
    expect(f.mitigations.map((x) => x.kind)).toContain('outLock')
  })

  test('an OUT tool is no way out: an allow-list of reads + the OUT tool leaves no fuse; a write tool brings it back', () => {
    const base = exits()
    const only = (tools: string[]): FusedModel => {
      const w = exits()
      w.ws.agents!.agExStage = { ...w.ws.agents!.agExStage, mcpTools: { alpha: tools } }
      return modelOf(w)
    }
    const alpha = key({ kind: 'server', id: 'srvAlpha', name: 'alpha' })
    expect(fuseTo(only(['list_items', 'send_message']), agentKey('agExStage'), alpha)).toBeUndefined()
    expect(fuseTo(only(['list_items', 'create_item']), agentKey('agExStage'), alpha)).toBeDefined()
    expect(fuseTo(modelOf(base), agentKey('agExStage'), alpha)).toBeDefined()
  })

  test('autofill + an "every AI call" server’s write tool → a fuse: "Autofill by hand only" and "no longer for autofill (this device)"', () => {
    const m = modelOf(autofillWorld())
    const af = key({ kind: 'autofill', db: 'dbMails', prop: 'pMailSum' })
    const f = fuseTo(m, af, key({ kind: 'server', id: 'srvBeta', name: 'beta' }))!
    expect(f).toBeDefined()
    // reads its own mail (from outside) and the titles of the related Kontakte (private)
    expect([f.lamps.outside.say.key, f.lamps.private.say]).toEqual([`${P}.lamp.outside.mail`, { key: `${P}.lamp.private.related`, vars: { db: 'dbKontakte' } }])
    expect(keyOf(f, 1)).toMatchObject({ kind: 'autofillHand', offered: true, target: { db: 'dbMails', prop: 'pMailSum' } })
    expect(keyOf(f, 2)).toMatchObject({ kind: 'noAutofill', offered: true, device: true, target: { server: 'srvBeta' }, note: { key: `${P}.key.deviceOnly` } })
    expect(f.facts.map((x) => x.kind)).toEqual(expect.arrayContaining(['thisDevice', 'bulkCap']))
    // a locked database refuses key 1 with the reason (§6 A20)
    const locked = fuseTo(modelOf(autofillWorld({ locked: true })), af, key({ kind: 'server', id: 'srvBeta', name: 'beta' }))!
    expect(keyOf(locked, 1)).toMatchObject({ offered: false, refusal: { key: `${P}.key.locked` } })
  })

  test('an attached untested server without an allow-list → a fuse "tool list unknown" (fail closed, §6 A7)', () => {
    const m = modelOf(exits())
    const f = fuseTo(m, agentKey('agExApply'), key({ kind: 'server', id: 'srvGamma', name: 'gamma' }))!
    expect(f).toBeDefined()
    expect(f.lamps.out.say).toMatchObject({ key: `${P}.lamp.out.failClosed` })
    expect(f.facts.find((x) => x.kind === 'failClosed')?.say.key).toBe(`${P}.fact.failClosed`)
    // key 2 takes the whole server away (no read tool is known to keep)
    expect(keyOf(f, 2)).toMatchObject({ kind: 'cutTools', target: { agent: 'agExApply', server: 'gamma', keep: [] }, what: { key: `${P}.key.cutToolsAll` } })
    // an allow-list of read-named tools clears it
    const w = exits()
    w.ws.agents!.agExApply = { ...w.ws.agents!.agExApply, mcpTools: { gamma: ['list_rows', 'get_row'] } }
    expect(fuseTo(modelOf(w), agentKey('agExApply'), key({ kind: 'server', id: 'srvGamma', name: 'gamma' }))).toBeUndefined()
  })

  test('a server agent with a webhook trigger + its scope + WRITE? → a fuse (§6 A2); allowing it is for owners and admins', () => {
    const member = modelOf(hookWorld(TEAM('acNordlicht')))
    const srv = agentKey('agHook')
    const rt = key({ kind: 'server', id: null, name: 'alpha', runtime: true })
    const f = fuseTo(member, srv, rt)!
    expect(f).toBeDefined()
    expect(f.chain.source).toBe(key({ kind: 'incoming', hook: null, db: null, agent: 'agHook' }))
    expect(f.lamps.outside.say.key).toBe(`${P}.lamp.outside.hook`)
    expect(f.facts.map((x) => x.kind)).toContain('serverAgent')
    expect(keyOf(f, 1)).toMatchObject({ offered: false, refusal: { key: `${P}.key.mcpNoReview` } })
    expect(keyOf(f, 3)).toMatchObject({ kind: 'allow', offered: false, refusal: { key: `${P}.key.adminsOnlyNone` } })
    const owner = fuseTo(modelOf(hookWorld(TEAM('acNordlicht', 'owner', ['ai', 'governor', 'signoffs']))), srv, rt)!
    expect(keyOf(owner, 3)).toMatchObject({ offered: true })
    const oldServer = fuseTo(modelOf(hookWorld(TEAM('acNordlicht', 'admin'))), srv, rt)!
    expect(keyOf(oldServer, 3)).toMatchObject({ offered: false, refusal: { key: `${P}.key.serverOld` } })
    // a viewer: every key inert, with the reason
    const viewer = fuseTo(modelOf(hookWorld(TEAM('acNordlicht', 'viewer', ['signoffs']))), srv, rt)!
    expect(viewer.keys.every((k) => !k.offered && k.refusal?.key === `${P}.key.readOnly`)).toBe(true)
  })

  test('this device’s GitHub push → a fuse only with another server’s reads (it carries every page of a local workspace)', () => {
    const push = 'outbound:sync:nordlicht%2Fnotes:push'
    const helper = agentKey('agInbox')
    const plain = modelOf(pushWorld(false))
    expect(fuseTo(plain, helper, push)).toBeUndefined()
    expect(plain.nearMisses.find((n) => n.chain.exit?.module === push)?.why).toBe('noPrivate')
    const reads = modelOf(pushWorld(true))
    const f = fuseTo(reads, helper, push)!
    expect(f.lamps.private.say).toEqual({ key: `${P}.lamp.private.mcp`, vars: { server: key({ kind: 'server', id: 'srvTracker', name: 'tracker' }) } })
    expect(f.facts.map((x) => x.kind)).toEqual(expect.arrayContaining(['thisDevice', 'trigger']))
    expect(f.facts.find((x) => x.kind === 'trigger')?.say).toEqual({ key: `${P}.fact.trigger.sync`, vars: { n: 15 } })
    // a push is no field: key 2 is not offered at all; key 1 and 3 are
    expect(f.keys.map((k) => k.n)).toEqual([1, 3])
  })

  test('a local pipeline whose task autofill writes, approvals "none" → a fuse; approvals "review" → a near miss', () => {
    const af = key({ kind: 'autofill', db: 'dbCoding', prop: 'pCodingPlan' })
    const none = modelOf(pipelineWorld('none'))
    const f = fuseTo(none, af, 'outbound:git:-:push')!
    expect(f.chain.steps.map(stepNode)).toEqual(['pipeline:dbCoding', 'outbound:git:-:push'])
    expect(f.facts.map((x) => x.kind)).toContain('approvals')
    expect(f.facts.find((x) => x.kind === 'approvals')?.say.key).toBe(`${P}.fact.approvalsNone`)
    const review = modelOf(pipelineWorld('review'))
    expect(review.fuses).toEqual([])
    expect(review.nearMisses.map((n) => [n.why, n.chain.gate])).toEqual([['gate', 'afterApproval']])
  })
})

/* ------------------------------------------------------------------ each decider */

test.describe('B4 · each decider (§1.3 #1)', () => {
  test('a switched-off agent → its fuse says "runs only by hand" and sorts after the others (§6 A13)', () => {
    const m = modelOf(exits())
    const off = fusesTo(m, agentKey('agExOff'))
    expect(off.length).toBeGreaterThan(0)
    for (const f of off) expect(f.facts.map((x) => x.kind)).toContain('handRunOnly')
    // F-order: every switched-off decider's fuse after every other
    const labels = m.fuses.map((f) => [Number(f.label.slice(1)), f.chain.decider === agentKey('agExOff')] as const)
    const lastOn = Math.max(...labels.filter(([, o]) => !o).map(([n]) => n))
    const firstOff = Math.min(...labels.filter(([, o]) => o).map(([n]) => n))
    expect(firstOff).toBeGreaterThan(lastOn)
    // labels F1 … Fn in order, keys unique
    expect(m.fuses.map((f) => f.label)).toEqual(m.fuses.map((_, i) => `F${i + 1}`))
    expect(new Set(m.fuses.map((f) => f.key)).size).toBe(m.fuses.length)
  })

  test('the bridge in "apply" + a webhook automation on Mails → a fuse with key 1 "Bridge: ask before each write" (this browser)', () => {
    const m = modelOf(mailWorld([], { device: { bridge: { enabled: true, mode: 'apply' } } }))
    const f = fuseTo(m, key({ kind: 'bridge' }), hook('chat.example'))!
    expect(f).toBeDefined()
    expect(keyOf(f, 1)).toMatchObject({ kind: 'bridgeAsk', offered: true, device: true, target: { bridge: true } })
    expect(keyOf(f, 2)).toMatchObject({ kind: 'handOnly', offered: true, target: { db: 'dbMails', prop: 'pMailFwd' } })
    expect(f.facts.map((x) => x.kind)).toContain('thisDevice')
  })

  test('the bridge in "ask" → a near miss (a person checks first), never counted', () => {
    const m = modelOf(mailWorld([], { device: { bridge: { enabled: true, mode: 'ask' } } }))
    expect(m.fuses).toEqual([])
    expect(m.nearMisses.map((n) => [n.why, n.chain.gate, n.chain.decider])).toEqual([['gate', 'asks', key({ kind: 'bridge' })]])
    expect(fuseCounts(m).open).toBe(0)
  })

  test('mail organise → a fuse with key 1 "Sort mail by hand only" (this device); no MCP server ever joins it', () => {
    const m = modelOf(organiseWorld())
    const org = key({ kind: 'organise', db: 'dbMails' })
    const f = fuseTo(m, org, hook('sort.example'))!
    expect(f).toBeDefined()
    // the batch: the other mails of one request are private (§6 A6)
    expect(f.lamps.private.say).toEqual({ key: `${P}.lamp.private.otherRows`, vars: { db: 'dbMails' } })
    expect(f.keys.map((k) => [k.n, k.kind, k.offered, k.device ?? false])).toEqual([
      [1, 'organiseHand', true, true],
      [3, 'allow', true, false],
    ])
    // an "every AI call" server never reaches organise (organise.ts: mcp false)
    const w = organiseWorld()
    w.ws.settings.mcpServers = [server('srvBeta', 'beta', { scope: 'all', tools: ['get_record', 'update_record'], checkedAt: 1 })]
    expect(modelOf(w).edges.some((e) => e.to === `${org}.tools`)).toBe(false)
  })
})

/* ------------------------------------------------------------------ declared reads */

test.describe('B4 · declared reads never silence a write tool (§1.5, §6 A4)', () => {
  test('a wildcard profile declaring write tools as reads → the fuse stays; the fact names the profile; its signature moves', () => {
    const agentOn = (tools?: string[]) => inboxHelper({ mcpServers: ['tracker'], ...(tools ? { mcpTools: { tracker: tools } } : {}) })
    const before = mailWorld([agentOn()], { servers: [TRACKER()] })
    const wild = profile('wild', { name: 'Wildcard', match: { host: '*.example' }, reads: ['create_issue', 'update_issue', 'query_issues'] })
    const after = mailWorld([agentOn()], { servers: [TRACKER()], integrations: [wild] })
    const tracker = key({ kind: 'server', id: 'srvTracker', name: 'tracker' })
    const helper = agentKey('agInbox')
    const a = fuseTo(modelOf(before), helper, tracker)!
    const b = fuseTo(modelOf(after), helper, tracker)!
    expect(b.key).toBe(a.key)
    expect(b.facts.find((x) => x.kind === 'declaredRead')?.say).toEqual({ key: `${P}.fact.declaredRead`, vars: { profiles: 'wild' } })
    expect(b.sig).not.toBe(a.sig)
    expect(changedBetween(a as { sig: string; parts: Record<string, string> }, { sig: b.sig!, parts: b.parts!, owners: sigFor(after, (c) => c.key === b.chain.key).owners })?.changed).toEqual([tracker])
  })
})

/* ------------------------------------------------------------------ unknown parts */

test.describe('B4 · unknown parts — never a fuse, never "nothing" (§1.21, §6 A16 A18)', () => {
  test('another member’s browser agent: its servers are unknown here; the paths it can be seen on stay fuses', () => {
    const w = mailWorld([inboxHelper({ createdBy: 'acMara', updatedBy: 'acMara', mcpServers: ['alpha'] })], { servers: [ALPHA()], device: TEAM('acNordlicht', 'owner', ['signoffs']), lazy: { hooks: [] } })
    const m = modelOf(w)
    expect(m.unknown).toEqual([{ key: `otherBrowser:${agentKey('agInbox')}`, what: 'otherBrowser', module: agentKey('agInbox'), who: 'acMara' }])
    // no MCP fuse is guessed; the webhook path everyone can see is one
    expect(m.fuses.map((f) => f.chain.exit?.module)).toEqual([hook('chat.example')])
    // a key a non-creator presses makes the agent wait for its creator — the key says so
    expect(keyOf(m.fuses[0], 1)?.team).toEqual({ key: `${P}.key.confirmAfter`, vars: { creator: 'acMara' } })
    expect(fuseCounts(m)).toEqual({ open: 1, allowed: 0, unknown: 1 })
  })

  test('fields this build cannot read: an unknown part, no chain, no fuse', () => {
    const w = mailWorld([inboxHelper({ route: { unknown: 'shape' } as unknown as CustomAgent['route'] })])
    const m = modelOf(w)
    expect(m.unknown.map((u) => u.what)).toEqual(['unreadable'])
    expect(m.fuses).toEqual([])
    expect(fuseCounts(m)).toEqual({ open: 0, allowed: 0, unknown: 1 })
  })

  test('a runtime the viewer may not read, or not read yet: unknown parts, no fuse', () => {
    const forbidden = modelOf(hookWorld(TEAM('acNordlicht'), { hooks: [], runtime: 'forbidden' }))
    expect([forbidden.fuses, forbidden.unknown.map((u) => u.what)]).toEqual([[], ['runtime']])
    const notYet = modelOf(hookWorld(TEAM('acNordlicht'), { hooks: [], runtime: null }))
    expect([notYet.fuses, notYet.unknown.map((u) => u.what)]).toEqual([[], ['lazy']])
  })

  test('a lazy reading the cache lacks: an unscanned script, an Inbox never looked up — unknown parts', () => {
    const w = mock1()
    w.lazy = { ...NO_LAZY, scans: {}, inboxRead: false }
    const m = modelOf(w)
    expect(m.unknown.map((u) => [u.what, u.module])).toEqual([
      ['lazy', autKey(w.ids.mails, w.ids.toContact)],
      ['lazy', key({ kind: 'script', id: w.ids.weekly })],
      ['lazy', 'clippings:-'],
    ])
    // F1 does not depend on them: it is there all the same
    expect(m.fuses.map((f) => f.label)).toEqual(['F1'])
  })
})

/* ------------------------------------------------------------------ near misses */

test.describe('B4 · near misses — listed, never counted (§1.21, §6 U30)', () => {
  test('gate · data rule · no private data · closed on this device', () => {
    // gate: mock 1's pipeline waits for Confirm
    expect(modelOf(mock1()).nearMisses.map((n) => n.why)).toEqual(['gate'])
    // data rule: 'mail' withheld on this device — the mail rows are no source for the agent
    const reader = mailWorld([inboxHelper({ scope: { everything: false, pages: [], databases: ['dbMails'] } })])
    const held = modelWith(reader, narrow('mail'))
    expect(held.fuses).toEqual([])
    expect(held.nearMisses.map((n) => [n.why, n.chain.lamps?.outside.say.key])).toEqual([['dataRule', `${P}.lamp.outside.dataRule`]])
    // no private data: the GitHub push carries the pages anyway
    expect(modelOf(pushWorld(false)).nearMisses.map((n) => n.why)).toEqual(['noPrivate'])
    // closed on this device: the agent's server is switched off here (another device of the creator may have it on)
    const off = mailWorld([inboxHelper({ mcpServers: ['alpha'] })], { servers: [ALPHA({ enabled: false })] })
    const m = modelOf(off)
    const alpha = key({ kind: 'server', id: 'srvAlpha', name: 'alpha' })
    expect(fuseTo(m, agentKey('agInbox'), alpha)).toBeUndefined()
    const closed = m.nearMisses.find((n) => n.why === 'closedHere')!
    expect([closed.chain.decider, closed.chain.exit?.module, closed.chain.lamps?.out.say.key]).toEqual([agentKey('agInbox'), alpha, `${P}.lamp.out.closedHere`])
    expect(fuseCounts(m)).toEqual({ open: 1, allowed: 0, unknown: 0 })
    // after a device-only key the UI keeps the closed fuse as such a row
    const f = modelOf(autofillWorld()).fuses[0]
    expect(closedNearMiss(f)).toEqual({ key: f.key, chain: f.chain, why: 'closedHere' })
  })
})

/* ------------------------------------------------------------------ the signature */

test.describe('B4 · sig — canonical JSON, path keys, parts, lapse (§2.7, §6 A15 A21)', () => {
  test('canon: sorted keys, undefined dropped, refuses non-finite numbers and cycles', () => {
    expect(canon({ b: 1, a: [1, undefined, 'x'], c: undefined, d: { z: null, y: true } })).toBe('{"a":[1,null,"x"],"b":1,"d":{"y":true,"z":null}}')
    expect(canon({ a: 1, b: 2 })).toBe(canon({ b: 2, a: 1 }))
    const shared = { k: 1 }
    expect(canon([shared, shared])).toBe('[{"k":1},{"k":1}]')
    expect(() => canon({ n: NaN })).toThrow()
    expect(() => canon(Infinity)).toThrow()
    const loop: Record<string, unknown> = {}
    loop.self = loop
    expect(() => canon(loop)).toThrow()
    expect(() => canon({ f: () => 1 })).toThrow()
  })

  test('SHA-256: the same hex as WebCrypto; path keys 64 hex', async () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    for (const s of ['', 'abc', 'Weiterleiten · „Mails“ → ✓', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'x'.repeat(1000), canon(['pb1', 'rowTrigger:dbMails:created:->agent:agInbox'])]) {
      const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
      expect(sha256Hex(s)).toBe([...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join(''))
    }
    expect(pathKey('a>b')).toMatch(/^[0-9a-f]{64}$/)
    expect(pathKey('a>b')).toBe(sha256Hex(canon(['pb1', 'a>b'])))
  })

  test('parts: ≤ 24, named [a-z]\\d{0,2}, 16 hex — a long group folds its tail', () => {
    const check = (m: FusedModel) => {
      for (const f of m.fuses) {
        const names = Object.keys(f.parts!)
        expect(names.length).toBeLessThanOrEqual(MAX_PARTS)
        for (const n of names) expect(n).toMatch(/^[a-z]\d{0,2}$/)
        for (const v of Object.values(f.parts!)) expect(v).toMatch(/^[0-9a-f]{16}$/)
        expect(f.sig).toMatch(/^[0-9a-f]{64}$/)
      }
    }
    check(modelOf(exits()))
    check(modelOf(bigPatchbay(60)))
    // an agent with 12 servers (its limit) whose write starts an autofill holding 20 "every AI call" servers: 32 servers
    // on one path — the server group folds its tail into its last part
    const own = Array.from({ length: 12 }, (_, i) => server(`srvO${i}`, `nordo${i}`, { tools: ['list_rows', 'create_row'], checkedAt: 1 }))
    const all = Array.from({ length: 20 }, (_, i) => server(`srvA${i}`, `norda${i}`, { scope: 'all', tools: ['list_rows', 'create_row'], checkedAt: 1 }))
    const fill = database('dbFill', [prop('pFillNote', 'Notiz', 'text'), prop('pFillSum', 'Kurz', 'text', { autofill: { preset: 'summary', auto: true } })])
    const wide = modelOf(mailWorld([inboxHelper({ scope: { everything: false, pages: [], databases: ['dbFill'] }, mcpServers: own.map((x) => x.name) })], { servers: [...own, ...all], databases: [fill], pages: [dbPage('dbFill', 'Nordlicht Füllung')] }))
    check(wide)
    const f = wide.fuses.find((x) => x.chain.decider === agentKey('agInbox') && x.chain.steps.some((st) => st.to === key({ kind: 'autofill', db: 'dbFill', prop: 'pFillSum' })))!
    expect(Object.keys(f.parts!)).toHaveLength(MAX_PARTS)
    expect(Object.values(f.sigInput as Record<string, unknown>).some((v) => !!v && typeof v === 'object' && 'rest' in v)).toBe(true)
  })

  test('what changes the sig — and names the right module; bookkeeping never does', () => {
    const helper = agentKey('agInbox')
    const tracker = key({ kind: 'server', id: 'srvTracker', name: 'tracker' })
    const toTracker = (c: Chain) => c.decider === helper && c.exit?.module === tracker
    const toHook = (c: Chain) => c.decider === helper && c.exit?.module === hook('chat.example')
    const base = (over: Partial<CustomAgent> = {}) => mailWorld([inboxHelper({ mcpServers: ['tracker'], ...over })], { servers: [TRACKER()] })
    const a = sigFor(base(), toTracker)
    // the decider: write mode, enabled, tool list
    expect(changedBetween(a, sigFor(base({ write: 'stage' }), toTracker))).toMatchObject({ state: 'lapsed', changed: [helper] })
    expect(changedBetween(a, sigFor(base({ enabled: false }), toTracker))).toMatchObject({ state: 'lapsed', changed: [helper] })
    expect(changedBetween(a, sigFor(base({ mcpTools: { tracker: ['query_issues', 'create_issue'] } }), toTracker))).toMatchObject({ state: 'lapsed', changed: [helper] })
    // the same again: allowed
    expect(changedBetween(a, sigFor(base(), toTracker))).toMatchObject({ state: 'allowed', changed: [] })
    // a profile's reads on the server
    const declared = base()
    declared.ws.integrations = [profile('in-01', { match: { name: 'tracker' }, reads: [...TRACKER_READS] })]
    expect(changedBetween(a, sigFor(declared, toTracker))).toMatchObject({ state: 'lapsed', changed: [tracker] })
    // the webhook's path and a header value (multi-tenant hosts, §6 A15) — the display stays host + method
    const h = sigFor(base(), toHook)
    const hookWith = (url: string, headers: Record<string, string>) => {
      const w = base()
      const db = w.ws.databases.dbMails
      w.ws.databases.dbMails = { ...db, automations: [{ ...db.automations![0], actions: [{ type: 'webhook', url, method: 'POST', headers }] }] }
      return sigFor(w, toHook)
    }
    expect(changedBetween(h, hookWith('https://chat.example/other?room=team', { 'X-Room': 'team' }))?.changed).toEqual([autKey('dbMails', 'autToChat'), hook('chat.example')])
    expect(changedBetween(h, hookWith('https://chat.example/hook?room=team', { 'X-Room': 'ops' }))?.changed).toEqual([autKey('dbMails', 'autToChat'), hook('chat.example')])
    // a field's "only by hand" (autofill ignores it, so its path stays)
    const sumPath = (c: Chain) => c.decider === key({ kind: 'autofill', db: 'dbMails', prop: 'pMailSum' }) && c.exit?.module === hook('digest.example')
    const s1 = sigFor(autofillWorld({ hook: true }), sumPath)
    const ro = autofillWorld({ hook: true })
    ro.ws.databases.dbMails = { ...ro.ws.databases.dbMails, properties: ro.ws.databases.dbMails.properties.map((p) => (p.id === 'pMailSum' ? { ...p, agentReadOnly: true } : p)) }
    expect(changedBetween(s1, sigFor(ro, sumPath))?.changed).toEqual(['net:dbMails:pMailSum'])
    // a kit value's code
    const kitPath = (c: Chain) => c.decider === agentKey('agTesseraServer') && c.exit?.module === hook('relay.example')
    const k1 = sigFor(relays(), kitPath)
    const kitW = relays()
    kitW.ws.kit = { ...kitW.ws.kit!, propTypes: { ptPunkte: { ...(kitW.ws.kit as Kit).propTypes.ptPunkte, scripts: { value: 'row.Status = "fertig" ? 20 : 0' } } } }
    expect(changedBetween(k1, sigFor(kitW, kitPath))?.changed).toEqual([key({ kind: 'kit', db: 'dbTessera', prop: 'pTesseraPunkte', type: 'ptPunkte' })])
    // this device's approvals on a git way out
    const gitPath = (c: Chain) => c.exit?.module === 'outbound:git:-:push'
    expect(changedBetween(sigFor(pipelineWorld('none'), gitPath), sigFor(pipelineWorld('review'), gitPath))?.changed).toEqual(['outbound:git:-:push', 'pipeline:dbCoding'])
    // bookkeeping: an automation's lastRunAt / status, autofill fills, a repeating template's lastRunAt — the same sig
    const book = base()
    const db = book.ws.databases.dbMails
    const repeat = { freq: 'weekly', days: [1], time: '09:00', start: '2026-10-12', title: '{{name}}', dateProperty: null, lastRunAt: 99 } as unknown as NonNullable<NonNullable<Database['templates']>[number]['repeat']>
    book.ws.databases.dbMails = { ...db, automations: [{ ...db.automations![0], lastRunAt: 12345, lastStatus: 'error', lastMessage: 'down' }], templates: [{ id: 'tplWeek', name: 'Woche', content: null, properties: {}, repeat }] as Database['templates'] }
    const book2 = base()
    const db2 = book2.ws.databases.dbMails
    book2.ws.databases.dbMails = { ...db2, templates: [{ id: 'tplWeek', name: 'Woche', content: null, properties: {}, repeat: { ...repeat, lastRunAt: 7 } }] as Database['templates'] }
    expect(sigFor(book, toHook).sig).toBe(sigFor(book2, toHook).sig)
    const fills = (n: number) => {
      const w = autofillWorld({ hook: true })
      w.ws.databases.dbMails = { ...w.ws.databases.dbMails, properties: w.ws.databases.dbMails.properties.map((p) => (p.autofill ? { ...p, autofill: { ...p.autofill, fills: { [`r${n}`]: { at: n, hash: `h${n}` } } } } : p)) }
      return sigFor(w, sumPath).sig
    }
    expect(fills(1)).toBe(fills(2))
  })

  test('an allowance: allowed (not counted, key 3 withdraws), lapsed after a change (counted, names what changed)', () => {
    const w = mailWorld([inboxHelper()])
    const input = inputOf(w)
    const f1 = buildModel(input).fuses[0]
    const signed = { [f1.key]: { sig: f1.sig!, parts: f1.parts!, at: 1760000000000, updatedBy: null } }
    const allowed = buildModel({ ...input, signoffs: signed })
    expect(allowed.fuses[0].allowed).toEqual({ state: 'allowed', at: 1760000000000, by: null, changed: [] })
    expect(keyOf(allowed.fuses[0], 3)).toMatchObject({ kind: 'withdraw', label: { key: `${P}.key.withdraw` } })
    expect(fuseCounts(allowed)).toEqual({ open: 0, allowed: 1, unknown: 0 })
    expect(fuseHints(allowed)).toEqual([])
    // the agent switched to "everything + tracker": the path is the same, its decider changed
    const changed = mailWorld([inboxHelper({ maxRunUsd: 3, enabled: false })])
    const lapsed = buildModel({ ...inputOf(changed), signoffs: signed })
    const f = lapsed.fuses.find((x) => x.key === f1.key)!
    expect(f.allowed).toEqual({ state: 'lapsed', at: 1760000000000, by: null, changed: [agentKey('agInbox')] })
    expect(keyOf(f, 3)?.kind).toBe('allow')
    expect(fuseCounts(lapsed)).toEqual({ open: 1, allowed: 0, unknown: 0 })
  })

  test('merge B4 × B9: the sign-off store keeps every allowance sig.ts makes, and the model reads it back as allowed', () => {
    const worlds = [exits(), bigPatchbay(60), mock1()]
    let seen = 0
    for (const w of worlds) {
      const input = inputOf(w)
      const m = buildModel(input)
      const signed: Record<string, unknown> = {}
      for (const f of m.fuses) {
        // the writer's own check (store.ts signOffFuse) takes exactly what key 3 passes
        const entry = signoffEntry({ sig: f.sig, parts: f.parts, at: 1760000000000, updatedBy: null })
        expect(entry, f.label).not.toBeNull()
        signed[f.key] = entry
        seen++
      }
      // the reader (persistence, binding, backups) leaves out nothing of it
      const read = sanitizeFuseSignoffs(signed)
      expect(Object.keys(read).sort()).toEqual(m.fuses.map((f) => f.key).sort())
      const again = buildModel({ ...input, signoffs: read })
      for (const f of again.fuses) expect(f.allowed?.state, f.label).toBe('allowed')
      expect(fuseCounts(again).open).toBe(0)
    }
    expect(seen).toBeGreaterThan(10)
  })
})

/* ------------------------------------------------------------------ plain words */

/** mock 1, every strand (§3.6) — EN */
const MOCK1_EN = [
  'On every new row in „Mails“ (from outside), the agent „Inbox-Helfer“ starts. The agent „Inbox-Helfer“ may read everything, may write anywhere and can set „Weiterleiten“ in „Mails“. On fuse F1.',
  'Every weekday at 07:30, the agent „Tessera-Spiegel“ starts. The agent „Tessera-Spiegel“ reads „Tessera Handoff“, reads „tracker“ (3 read tools), proposes changes in „Tessera Handoff“, writes its report into „Bericht“ and leaves notes in the inbox.',
  'When „Weiterleiten“ changes in „Mails“, the automation „An Team-Chat“ starts. The automation „An Team-Chat“ sends the row out by webhook to chat.example. On fuse F1.',
  'On every new row in „Mails“ (from outside), the automation „Neue Mail → Kontakt“ starts. The automation „Neue Mail → Kontakt“ runs the script „Kontakt anlegen“ and writes „Kontakte“.',
  'On a press of the button on „Bericht“ (by hand), the script „Wochenbericht“ starts. The script „Wochenbericht“ reads „Tessera Handoff“ and writes „Bericht“.',
  'The pipeline „Coding · nordlicht“ works through the tasks in „Coding · nordlicht“ and can open merge requests (after approval).',
]
/** mock 1, every strand — DE (no pronouns: the kind noun and the name repeat) */
const MOCK1_DE = [
  'Bei jeder neuen Zeile in „Mails“ (von außen) startet der Agent „Inbox-Helfer“. Der Agent „Inbox-Helfer“ darf alles lesen, darf überall schreiben und kann „Weiterleiten“ in „Mails“ setzen. Auf Sicherung F1.',
  'Werktags um 07:30 startet der Agent „Tessera-Spiegel“. Der Agent „Tessera-Spiegel“ liest „Tessera Handoff“, liest „tracker“ (3 Lese-Werkzeuge), schlägt Änderungen in „Tessera Handoff“ vor, schreibt den Bericht in „Bericht“ und hinterlässt Notizen im Posteingang.',
  'Bei jeder Änderung von „Weiterleiten“ in „Mails“ startet die Automation „An Team-Chat“. Die Automation „An Team-Chat“ schickt die Zeile per Webhook an chat.example hinaus. Auf Sicherung F1.',
  'Bei jeder neuen Zeile in „Mails“ (von außen) startet die Automation „Neue Mail → Kontakt“. Die Automation „Neue Mail → Kontakt“ führt das Skript „Kontakt anlegen“ aus und schreibt „Kontakte“.',
  'Beim Druck auf den Knopf auf „Bericht“ (von Hand) startet das Skript „Wochenbericht“. Das Skript „Wochenbericht“ liest „Tessera Handoff“ und schreibt „Bericht“.',
  'Die Pipeline „Coding · nordlicht“ arbeitet die Aufgaben in „Coding · nordlicht“ ab und kann Merge-Requests anlegen (nach Freigabe).',
]
/** one strand per module kind: [world, module key, EN, DE] */
const KIND_STRANDS: Array<[string, string, string, string]> = [
  ['mock1', 'agent:agTessera', 'Every weekday at 07:30, the agent „Tessera-Spiegel“ starts. The agent „Tessera-Spiegel“ reads „Tessera Handoff“, reads „tracker“ (3 read tools), proposes changes in „Tessera Handoff“, writes its report into „Bericht“ and leaves notes in the inbox.', 'Werktags um 07:30 startet der Agent „Tessera-Spiegel“. Der Agent „Tessera-Spiegel“ liest „Tessera Handoff“, liest „tracker“ (3 Lese-Werkzeuge), schlägt Änderungen in „Tessera Handoff“ vor, schreibt den Bericht in „Bericht“ und hinterlässt Notizen im Posteingang.'],
  ['mock1', 'automation:dbMails:autToContact', 'On every new row in „Mails“ (from outside), the automation „Neue Mail → Kontakt“ starts. The automation „Neue Mail → Kontakt“ runs the script „Kontakt anlegen“ and writes „Kontakte“.', 'Bei jeder neuen Zeile in „Mails“ (von außen) startet die Automation „Neue Mail → Kontakt“. Die Automation „Neue Mail → Kontakt“ führt das Skript „Kontakt anlegen“ aus und schreibt „Kontakte“.'],
  ['mock1', 'script:scWeekly', 'On a press of the button on „Bericht“ (by hand), the script „Wochenbericht“ starts. The script „Wochenbericht“ reads „Tessera Handoff“ and writes „Bericht“.', 'Beim Druck auf den Knopf auf „Bericht“ (von Hand) startet das Skript „Wochenbericht“. Das Skript „Wochenbericht“ liest „Tessera Handoff“ und schreibt „Bericht“.'],
  ['mock1', 'pipeline:dbCoding', 'The pipeline „Coding · nordlicht“ works through the tasks in „Coding · nordlicht“ and can open merge requests (after approval).', 'Die Pipeline „Coding · nordlicht“ arbeitet die Aufgaben in „Coding · nordlicht“ ab und kann Merge-Requests anlegen (nach Freigabe).'],
  ['autofill', 'autofill:dbMails:pMailSum', 'On any change of a row in „Mails“ (from outside), the AI autofill „Zusammenfassung“ in „Mails“ starts. The AI autofill „Zusammenfassung“ in „Mails“ fills „Zusammenfassung“ directly, reads „beta“ (1 read tool) and can call 1 write tool of „beta“. On fuse F1.', 'Bei jeder Änderung einer Zeile in „Mails“ (von außen) startet das KI-Autofill „Zusammenfassung“ in „Mails“. Das KI-Autofill „Zusammenfassung“ in „Mails“ füllt „Zusammenfassung“ direkt, liest „beta“ (1 Lese-Werkzeug) und kann 1 Schreib-Werkzeug von „beta“ aufrufen. Auf Sicherung F1.'],
  ['organise', 'organise:dbMails', 'On every new row in „Mails“ (from outside), the mail sorting in „Mails“ starts. The mail sorting in „Mails“ sorts each new mail with the AI and sets „Kategorie“. On fuse F1.', 'Bei jeder neuen Zeile in „Mails“ (von außen) startet die Mail-Sortierung in „Mails“. Die Mail-Sortierung in „Mails“ sortiert jede neue Mail mit der KI und setzt „Kategorie“. Auf Sicherung F1.'],
  ['relays', 'kit:dbTessera:pTesseraPunkte', 'On any change of a row in „Tessera“ (also from other devices), the computed value „Punkte“ in „Tessera“ starts. The computed value „Punkte“ in „Tessera“ recomputes „Punkte“.', 'Bei jeder Änderung einer Zeile in „Tessera“ (auch von anderen Geräten) startet der berechnete Wert „Punkte“ in „Tessera“. Der berechnete Wert „Punkte“ in „Tessera“ berechnet „Punkte“ neu.'],
  ['exits', 'bridge:here', 'Through the bridge on this browser, Claude Desktop / Code may read everything and write anywhere without asking. On fuses F2, F6, F7, F8, F11.', 'Über die Brücke in diesem Browser darf Claude Desktop / Code alles lesen und ohne Rückfrage überall schreiben. Auf den Sicherungen F2, F6, F7, F8, F11.'],
  ['exits', 'button:pgExNotes:btnExHook', 'The button on „Notizen“ sends the row out by webhook to button.example (by hand).', 'Der Knopf auf „Notizen“ schickt die Zeile per Webhook an button.example hinaus (von Hand).'],
  ['exits', 'command:dbLeads:cmdExHook', 'The command „Melden“ in „Leads“ sends the row out by webhook to cmd.example (by hand).', 'Der Befehl „Melden“ in „Leads“ schickt die Zeile per Webhook an cmd.example hinaus (von Hand).'],
  ['exits', 'command:dbTickets:send%3Aalpha%3Areply', 'The command „Outbox · reply“ in „Tickets“ hands the row to an Outbox route — sent by hand.', 'Der Befehl „Ausgang · reply“ in „Tickets“ übergibt die Zeile einer Senderoute — gesendet von Hand.'],
  ['exits', 'sync:github', 'The GitHub sync on this device picks up pages from nordlicht/notes (from outside) and pushes every change to nordlicht/notes every 15 min.', 'Der GitHub-Sync auf diesem Gerät holt Seiten aus nordlicht/notes (von außen) und schiebt alle 15 Min. jede Änderung nach nordlicht/notes.'],
  ['exits', 'agent:agExOff', 'The agent „Ruhender Helfer“ is switched off and runs only by hand. The agent „Ruhender Helfer“ can write „Leads“. On fuse F14.', 'Der Agent „Ruhender Helfer“ ist ausgeschaltet und läuft nur von Hand. Der Agent „Ruhender Helfer“ kann „Leads“ schreiben. Auf Sicherung F14.'],
  ['exits', 'agent:agExHook', 'On every webhook delivery (from outside), the agent „Hook-Empfänger“ starts. The agent „Hook-Empfänger“ reads „Tickets“, reads „alpha“ (2 read tools), proposes changes in „Tickets“ and can call 1 write tool of „alpha“. On fuse F9.', 'Bei jeder Webhook-Lieferung (von außen) startet der Agent „Hook-Empfänger“. Der Agent „Hook-Empfänger“ liest „Tickets“, liest „alpha“ (2 Lese-Werkzeuge), schlägt Änderungen in „Tickets“ vor und kann 1 Schreib-Werkzeug von „alpha“ aufrufen. Auf Sicherung F9.'],
  ['kinds', 'clock:t:dbMeet:tplWoche', 'A repeating template of „Meetings“ creates new rows in „Meetings“.', 'Eine wiederkehrende Vorlage von „Meetings“ legt neue Zeilen in „Meetings“ an.'],
  ['kinds', 'incoming:hkLeads:-:dbLeads', 'The incoming webhook „hkLeads“ adds rows to „Leads“ (from outside).', 'Der eingehende Webhook „hkLeads“ legt Zeilen in „Leads“ an (von außen).'],
  ['kinds', 'sync:folder', 'The folder sync on this device picks up files from a folder.', 'Der Ordner-Sync auf diesem Gerät holt Dateien aus einem Ordner.'],
  ['kinds', 'clippings:inbxNord', 'Web pages shared or clipped into One land in „Ablage“ (from outside).', 'Geteilte oder abgelegte Webseiten landen in „Ablage“ (von außen).'],
  ['kinds', 'agent:agLeser', 'Every Monday at 09:00, the agent „Ablage-Leser“ starts. The agent „Ablage-Leser“ reads „Ablage“ and „Launch plan“.', 'Montags um 09:00 startet der Agent „Ablage-Leser“. Der Agent „Ablage-Leser“ liest „Ablage“ und „Launch plan“.'],
]
/** the plate's sentence: [world, label, EN, DE] */
const FUSE_SAYS: Array<[string, string, string, string]> = [
  ['mock1', 'F1', 'If the agent „Inbox-Helfer“ sets „Weiterleiten“ without review, the automation „An Team-Chat“ sends the row out by webhook. A mail with a hidden instruction can get what the agent read sent.', 'Setzt der Agent „Inbox-Helfer“ ohne Prüfung „Weiterleiten“, dann schickt die Automation „An Team-Chat“ die Zeile per Webhook hinaus. Eine Mail mit versteckter Anweisung kann so erreichen, dass gesendet wird, was der Agent gelesen hat.'],
  ['exits', 'F3', 'The agent „Mail-Sortierer“ can call write tools of „gamma“ — inside the AI’s tool loop, without review. A mail with a hidden instruction can get what the agent read sent.', 'Der Agent „Mail-Sortierer“ kann Schreib-Werkzeuge von „gamma“ aufrufen — in der Werkzeug-Schleife der KI, ohne Prüfung. Eine Mail mit versteckter Anweisung kann so erreichen, dass gesendet wird, was der Agent gelesen hat.'],
  ['exits', 'F5', 'If the AI autofill „Zusammenfassung“ in „Leads“ sets „Zusammenfassung“ without review, this device’s GitHub push carries the change to nordlicht/notes. A file pushed to the repository with a hidden instruction can get what the autofill read sent.', 'Setzt das KI-Autofill „Zusammenfassung“ in „Leads“ ohne Prüfung „Zusammenfassung“, dann trägt der GitHub-Push dieses Geräts die Änderung nach nordlicht/notes. Eine Datei aus dem Repository mit versteckter Anweisung kann so erreichen, dass gesendet wird, was das Autofill gelesen hat.'],
  ['exits', 'F9', 'The agent „Hook-Empfänger“ can call write tools of „alpha“ — inside the AI’s tool loop, without review. A webhook delivery with a hidden instruction can get what the agent read sent.', 'Der Agent „Hook-Empfänger“ kann Schreib-Werkzeuge von „alpha“ aufrufen — in der Werkzeug-Schleife der KI, ohne Prüfung. Eine Webhook-Lieferung mit versteckter Anweisung kann so erreichen, dass gesendet wird, was der Agent gelesen hat.'],
  ['exits', 'F11', 'If the bridge on this browser writes a task into „Coding · Tessera“ without review, the pipeline „Coding · Tessera“ can push to Git with nobody in between. A mail with a hidden instruction can get what the bridge read sent.', 'Schreibt die Brücke in diesem Browser ohne Prüfung eine Aufgabe in „Coding · Tessera“, dann kann die Pipeline „Coding · Tessera“ ohne einen Menschen dazwischen nach Git pushen. Eine Mail mit versteckter Anweisung kann so erreichen, dass gesendet wird, was die Brücke gelesen hat.'],
  ['autofill', 'F1', 'The AI autofill „Zusammenfassung“ in „Mails“ can call write tools of „beta“ — inside the AI’s tool loop, without review. A mail with a hidden instruction can get what the autofill read sent.', 'Das KI-Autofill „Zusammenfassung“ in „Mails“ kann Schreib-Werkzeuge von „beta“ aufrufen — in der Werkzeug-Schleife der KI, ohne Prüfung. Eine Mail mit versteckter Anweisung kann so erreichen, dass gesendet wird, was das Autofill gelesen hat.'],
  ['organise', 'F1', 'If the mail sorting in „Mails“ sets „Kategorie“ without review, the automation „Kategorie → Hook“ sends the row out by webhook. A mail with a hidden instruction can get what the mail sorting read sent.', 'Setzt die Mail-Sortierung in „Mails“ ohne Prüfung „Kategorie“, dann schickt die Automation „Kategorie → Hook“ die Zeile per Webhook hinaus. Eine Mail mit versteckter Anweisung kann so erreichen, dass gesendet wird, was die Mail-Sortierung gelesen hat.'],
]

const PRONOUNS = /\b(er|sie|es|ihn|ihm|ihr|ihre|ihren|ihrem|ihrer|ihres|sein|seine|seinen|seinem|seiner|seines)\b/i

function kindsWorld(): PbWorld {
  const repeat = { freq: 'weekly', days: [1], time: '09:00', start: '2026-10-12', title: '{{name}}', dateProperty: null } as unknown as NonNullable<NonNullable<Database['templates']>[number]['repeat']>
  return world({
    pages: [dbPage('dbMeet', 'Meetings'), dbPage('dbLeads', 'Leads'), page('inbxNord', { title: 'Ablage' }), page('pgPlan', { title: 'Launch plan' })],
    databases: [database('dbMeet', [], { templates: [{ id: 'tplWoche', name: 'Woche', content: null, properties: {}, repeat }] as Database['templates'] }), database('dbLeads', [])],
    agents: [agent('agLeser', 'Ablage-Leser', { write: 'none', scope: { everything: false, pages: ['inbxNord', 'pgPlan'], databases: [] }, trigger: { type: 'schedule', every: 'week', weekday: 1, at: '09:00', tz: 'Europe/Berlin' }, mcpServers: ['alpha'], mcpTools: { alpha: ['list_items'] } })],
    servers: [server('srvAlpha', 'alpha', { tools: ['list_items', 'create_item'], checkedAt: 1 })],
    device: { ...TEAM('acMara', 'owner'), sync: { github: { configured: false, auto: false, everyMin: 15, includePrivate: false, repo: null }, folder: { configured: true } } },
    lazy: { hooks: [{ id: 'hkLeads', db: 'dbLeads' }], inbox: 'inbxNord' },
  })
}

const WORLDS: Record<string, () => PbWorld> = { mock1, exits, relays, autofill: () => autofillWorld(), organise: organiseWorld, kinds: kindsWorld }

test.describe('B4 · plain words — "§ In plain words" / "§ Im Klartext" (§3.6, §6 U31)', () => {
  test('mock 1: every strand, EN and DE', () => {
    const w = mock1()
    const m = modelOf(w)
    const input = inputOf(w)
    expect(plainOf(m, input, ctxOf('en')).map((s) => text(s.parts))).toEqual(MOCK1_EN)
    expect(plainOf(m, input, ctxOf('de')).map((s) => text(s.parts))).toEqual(MOCK1_DE)
    // names are bold parts; nothing but text and the bold flag
    const parts = plainOf(m, input, ctxOf('de'))[0].parts
    expect(parts.filter((p) => p.b).map((p) => p.t)).toEqual(['Mails', 'Inbox-Helfer', 'Inbox-Helfer', 'Weiterleiten', 'Mails'])
  })

  test('each module kind, EN and DE', () => {
    for (const [name, mod, en, de] of KIND_STRANDS) {
      const w = WORLDS[name]()
      const m = modelOf(w)
      const input = inputOf(w)
      const pick = (lang: 'en' | 'de') => plainOf(m, input, ctxOf(lang)).find((s) => s.module === mod)
      expect(pick('en') && text(pick('en')!.parts), `${name} ${mod} EN`).toBe(en)
      expect(pick('de') && text(pick('de')!.parts), `${name} ${mod} DE`).toBe(de)
    }
  })

  test('the plate’s sentence, EN and DE', () => {
    for (const [name, label, en, de] of FUSE_SAYS) {
      const w = WORLDS[name]()
      const m = modelOf(w)
      const input = inputOf(w)
      const f = m.fuses.find((x) => x.label === label)!
      expect(text(fuseSay(f, m, input, ctxOf('en'))), `${name} ${label} EN`).toBe(en)
      expect(text(fuseSay(f, m, input, ctxOf('de'))), `${name} ${label} DE`).toBe(de)
    }
    // the threat's clause is the bold part ("what the agent read sent" / "gesendet wird, was der Agent gelesen hat")
    const w = mock1()
    const m = modelOf(w)
    expect(fuseSay(m.fuses[0], m, inputOf(w), ctxOf('de')).filter((p) => p.b).pop()?.t).toBe('gesendet wird, was der Agent gelesen hat')
  })

  test('module descriptions (aria-describedby) and message refs in words', () => {
    const w = mock1()
    const m = modelOf(w)
    const input = inputOf(w)
    const helper = agentKey(w.ids.inboxHelper)
    expect(describeModule(m, input, helper, ctxOf('en'))).toBe('Agent „Inbox-Helfer“ · on every new row in „Mails“ (from outside) · may read everything · may write anywhere · can set „Weiterleiten“ in „Mails“ · fuse F1')
    expect(describeModule(m, input, helper, ctxOf('de'))).toBe('Agent „Inbox-Helfer“ · bei jeder neuen Zeile in „Mails“ (von außen) · darf alles lesen · darf überall schreiben · kann „Weiterleiten“ in „Mails“ setzen · Sicherung F1')
    expect(describeModule(m, input, hook('chat.example'), ctxOf('en'))).toBe('Webhook · chat.example · sent by „An Team-Chat“ · fuse F1')
    expect(describeModule(m, input, key({ kind: 'server', id: w.ids.kanal, name: 'kanal' }), ctxOf('de'))).toBe('MCP-Server „kanal“ · Lesen ? · Schreiben? ? · kein Kabel')
    const f1 = m.fuses[0]
    const say = (r: MsgRef, lang: 'en' | 'de') => sayMsg(r, m, input, ctxOf(lang))
    expect([say(f1.lamps.outside.say, 'en'), say(f1.lamps.private.say, 'en'), say(f1.lamps.out.say, 'en')]).toEqual(['Rows of „Mails“ from outside, unchecked', 'Access: whole workspace (4 databases)', 'Webhook · chat.example (POST)'])
    expect([say(f1.lamps.outside.say, 'de'), say(f1.lamps.private.say, 'de'), say(f1.lamps.out.say, 'de')]).toEqual(['Zeilen von „Mails“ von außen, ungeprüft', 'Zugriff: ganzer Arbeitsbereich (4 Datenbanken)', 'Webhook · chat.example (POST)'])
    expect(f1.facts.map((x) => `${ctxOf('de').t(`${P}.fact.label.${x.kind}`)} ${say(x.say, 'de')}`)).toEqual(['Änderungen Direkt anwenden', 'Zugriff Alles', 'Auslöser Feld „Weiterleiten“ → POST', 'Kette 3 Schritte', 'Läuft nur, solange One in diesem Browser offen ist'])
    expect(f1.keys.map((k) => [say(k.label!, 'de'), k.what && say(k.what, 'de')])).toEqual([
      ['Auf Vorschläge stellen', 'Inbox-Helfer: Direkt anwenden → Vorschläge zur Prüfung'],
      ['„Weiterleiten“ nur von Hand', 'Mails: Agenten schreiben das Feld nie'],
      ['Weg zulassen', 'Name + Datum · erlischt, sobald sich etwas am Weg ändert'],
    ])
    expect(say(keyOf(f1, 1)!.note!, 'en')).toBe('Each proposal waits for you — applying it still fires „An Team-Chat“')
    // the taint lamp: "reads Tessera Handoff — written by Tessera-Spiegel from tracker"
    const tainted = m.chains.find((c) => c.why?.outside.some((s) => s.kind === 'tainted'))!
    const t = tainted.why!.outside.find((s) => s.kind === 'tainted' && s.place && 'db' in s.place && s.place.db === w.ids.handoff)!
    expect(sayMsg({ key: `${P}.lamp.outside.tainted`, vars: { place: placeKey(t.place!), writer: t.writer!, from: t.from! } }, m, input, ctxOf('en'))).toBe('reads Tessera Handoff — written by Tessera-Spiegel from tracker')
    expect(sayMsg({ key: `${P}.lamp.outside.tainted`, vars: { place: placeKey(t.place!), writer: t.writer!, from: t.from! } }, m, input, ctxOf('de'))).toBe('liest Tessera Handoff — von Tessera-Spiegel aus tracker geschrieben')
  })

  test('plurals use the .one twin', () => {
    const w = mock1()
    const m = modelOf(w)
    const input = inputOf(w)
    const say = (r: MsgRef, lang: 'en' | 'de') => sayMsg(r, m, input, ctxOf(lang))
    expect([1, 3].map((n) => say({ key: `${P}.fact.chain`, vars: { n } }, 'en'))).toEqual(['1 step', '3 steps'])
    expect([1, 3].map((n) => say({ key: `${P}.fact.chain`, vars: { n } }, 'de'))).toEqual(['1 Schritt', '3 Schritte'])
    expect([1, 2].map((n) => say({ key: `${P}.lamp.outside.more`, vars: { n } }, 'de'))).toEqual(['+ 1 weitere Quelle', '+ 2 weitere Quellen'])
    expect([1, 4].map((n) => say({ key: `${P}.lamp.private.everything`, vars: { n } }, 'en'))).toEqual(['Access: whole workspace (1 database)', 'Access: whole workspace (4 databases)'])
    // in a strand: "1 read tool" / "1 Lese-Werkzeug"
    const af = autofillWorld()
    const am = modelOf(af)
    expect(text(plainOf(am, inputOf(af), ctxOf('en'))[0].parts)).toContain('reads „beta“ (1 read tool) and can call 1 write tool of „beta“')
    expect(text(plainOf(am, inputOf(af), ctxOf('de'))[0].parts)).toContain('liest „beta“ (1 Lese-Werkzeug) und kann 1 Schreib-Werkzeug von „beta“ aufrufen')
  })

  test('German without pronouns: every strand, sentence and description of every world', () => {
    for (const [name, make] of Object.entries(WORLDS)) {
      const w = make()
      const m = modelOf(w)
      const input = inputOf(w)
      const ctx = ctxOf('de')
      const all = [...plainOf(m, input, ctx).map((s) => text(s.parts)), ...m.fuses.map((f) => text(fuseSay(f, m, input, ctx))), ...m.modules.map((x) => describeModule(m, input, x.key, ctx))]
      for (const s of all) expect(s, `${name}: ${s}`).not.toMatch(PRONOUNS)
      // no id leaks into the words (every name resolved)
      for (const s of all) expect(s, `${name}: ${s}`).not.toMatch(/\b(db|ag|aut|sc|srv|pg|p)[A-Z][A-Za-z]+\b/)
    }
  })

  test('every message key a fuse, a near miss or an unknown part names exists in EN and DE (.one twins included)', () => {
    const worlds = [...Object.values(WORLDS).map((make) => make()), hookWorld(TEAM('acNordlicht')), pushWorld(false), pipelineWorld('review'), mailWorld([inboxHelper({ mcpServers: ['alpha'] })], { servers: [ALPHA({ enabled: false })] })]
    let n = 0
    for (const w of worlds) {
      const m = modelOf(w)
      const input = inputOf(w)
      for (const r of refsOf(m)) {
        n++
        expect(messages.en[r.key], r.key).toBeDefined()
        expect(messages.de[r.key], r.key).toBeDefined()
        // every placeholder is filled from the ref's own vars (names resolved from ids)
        for (const lang of ['en', 'de'] as const) expect(sayMsg(r, m, input, ctxOf(lang)), `${r.key} ${lang}`).not.toMatch(/\{\w+\}/)
      }
    }
    expect(n).toBeGreaterThan(300)
    // the same keys in both languages; every .one has its plural
    expect(Object.keys(messages.de).sort()).toEqual(Object.keys(messages.en).sort())
    for (const k of Object.keys(messages.en)) if (k.endsWith('.one')) expect(messages.en[k.slice(0, -4)], k).toBeDefined()
  })

  test('the words of §1.1: no banned German words, "Ausgang" only for the Outbox module, "KI" never "AI"', () => {
    for (const [k, v] of Object.entries(messages.de)) {
      expect(v, k).not.toMatch(/[Vv]ertrauen|Prüfschritt|abnehmen|Abnahme|[Ff]remd|Trigger/)
      if (!k.startsWith(`${P}.module.outbox.`)) expect(v, k).not.toMatch(/Ausgang/)
      expect(v, k).not.toMatch(/\bAI\b/)
    }
  })
})

/* ------------------------------------------------------------------ the lazy cache */

/**
 * Three fuses, each resting on one lazy reading: Clippings (the Inbox lookup), a script's taint (its scan), a server
 * agent's MCP way out (the runtime). Titles never occur in ids, so the cache can be searched for them.
 */
function lazyWorld(): PbWorld {
  const mails = database('dbA1', [prop('pA1Flag', 'Markiert', 'checkbox')], { system: 'mails', automations: [automation('autA1', 'Übertrag-Lauf', { type: 'row_created' }, [{ type: 'run_script', scriptId: 'scX1' }]), automation('autA2', 'Übertrag-Zweit', { type: 'property_changed', propertyId: 'pA1Flag' }, [{ type: 'run_script', scriptId: 'scX1' }])] })
  return world({
    pages: [dbPage('dbA1', 'Mara Lind Post'), dbPage('dbB1', 'Tessera Übersicht'), dbPage('dbC1', 'Nordlicht Notizen'), page('inbxN1', { title: 'Nordlicht Ablage' })],
    databases: [mails, database('dbB1', [prop('pB1Note', 'Vermerk', 'text')]), database('dbC1', [])],
    scripts: [script('scX1', 'Übertrag', 'db(@[Tessera Übersicht](p:dbB1)).add(page.current.title)')],
    agents: [
      // write tools only: no read results of alpha come in — the lazy reading is each agent's only content from outside
      agent('agK1', 'Ablage-Leser', { write: 'apply', scope: { everything: false, pages: ['inbxN1'], databases: ['dbC1'] }, trigger: { type: 'schedule', every: 'day', at: '07:00', tz: 'Europe/Berlin' }, mcpServers: ['alpha'], mcpTools: { alpha: ['create_item'] } }),
      agent('agK2', 'Übersicht-Pflege', { write: 'apply', scope: { everything: false, pages: [], databases: ['dbB1', 'dbC1'] }, trigger: { type: 'schedule', every: 'day', at: '08:00', tz: 'Europe/Berlin' }, mcpServers: ['alpha'], mcpTools: { alpha: ['create_item'] } }),
      agent('agK3', 'Hook-Annahme', { runner: 'server', write: 'stage', trigger: { type: 'webhook' }, scope: { everything: false, pages: [], databases: ['dbB1'] }, mcpServers: ['alpha'], mcpTools: { alpha: ['create_item'] } }),
    ],
    servers: [ALPHA()],
    mail: mailSettings('dbA1'),
    lazy: { runtime: [{ name: 'alpha', host: 'alpha.example' }], inbox: 'inbxN1' },
  })
}

test.describe('B4 · the lazy cache (§1.2, §6 A16)', () => {
  test('ids and hosts only; the fuse count from eager inputs + the cache = the count with every reading', () => {
    const full = lazyWorld()
    const fullInput = inputOf(full)
    const all = buildModel(fullInput)
    const deciders = [...new Set(all.fuses.map((f) => f.chain.decider))].sort()
    expect(deciders).toEqual([agentKey('agK1'), agentKey('agK2'), agentKey('agK3')])
    expect(all.unknown).toEqual([])
    // the cache the route writes from what it read
    const scans = Object.fromEntries(fullInput.scripts.map((s) => [s.script.id, s.scan!]))
    const cache = lazyCacheOf({ scans, runtime: fullInput.runtime, hooks: fullInput.hooks, inbox: fullInput.inbox, inboxRead: true }, null, 1)
    const json = JSON.stringify(cache)
    for (const words of ['Mara Lind Post', 'Tessera Übersicht', 'Nordlicht Notizen', 'Nordlicht Ablage', 'Übertrag', 'Ablage-Leser', 'Markiert', 'Vermerk', 'page.current', '.add(', 'title']) expect(json, words).not.toContain(words)
    expect(cache).toMatchObject({ v: 1, runtime: [{ name: 'alpha', host: 'alpha.example' }], inbox: 'inbxN1', inboxRead: true })
    expect(Object.keys(cache.scripts)).toEqual(['scX1'])
    // a fresh device: nothing read, only the cache — the same fuses
    const cached = lazyWorld()
    cached.lazy = { ...NO_LAZY, scans: {}, runtime: null, inbox: null, inboxRead: false, cache }
    const fromCache = modelOf(cached)
    expect(fromCache.fuses.map((f) => f.key).sort()).toEqual(all.fuses.map((f) => f.key).sort())
    expect(fuseCounts(fromCache)).toEqual(fuseCounts(all))
    // nothing read and no cache: fewer fuses — and every missing reading is an unknown part, never "nothing"
    const bare = lazyWorld()
    bare.lazy = { ...NO_LAZY, scans: {}, runtime: null, inbox: null, inboxRead: false }
    const none = modelOf(bare)
    expect(none.fuses.length).toBeLessThan(all.fuses.length)
    expect(none.unknown.map((u) => u.what)).toEqual(['lazy', 'lazy', 'lazy'])
    expect(none.unknown.map((u) => u.module).sort()).toEqual([agentKey('agK3'), 'clippings:-', key({ kind: 'script', id: 'scX1' })].sort())
    // a scan cached for another version of the script is no reading
    const stale = lazyWorld()
    stale.ws.scripts!.scX1 = { ...stale.ws.scripts!.scX1, updatedAt: 2 }
    stale.lazy = { ...NO_LAZY, scans: {}, runtime: null, inbox: null, inboxRead: false, cache }
    expect(modelOf(stale).unknown.map((u) => u.module)).toContain(key({ kind: 'script', id: 'scX1' }))
  })

  test('a reading not taken keeps what the cache had; "forbidden" is kept as none', () => {
    const prev = lazyCacheOf({ scans: { s1: { at: 1, reads: [{ db: 'd1' }], writes: [], effects: ['http'], byName: false } }, runtime: [{ name: 'alpha', host: 'alpha.example' }], hooks: null, inbox: 'inbx1', inboxRead: true }, null, 1)
    const next = lazyCacheOf({ scans: null, runtime: 'forbidden', hooks: null, inbox: null, inboxRead: false }, prev, 2)
    expect(next).toEqual({ v: 1, scripts: prev.scripts, hooks: null, runtime: null, inbox: 'inbx1', inboxRead: true, at: 2 })
    // a scan carries places and flags only — whatever else an object holds is left out
    const dirty = lazyCacheOf({ scans: { s1: { at: 3, reads: [{ db: 'd1', note: 'Mara Lind' } as never], writes: [{ page: 'p1' }], effects: ['mail', 'spam' as never], byName: true, extra: 'x' } as never }, runtime: null, hooks: null, inbox: null, inboxRead: false }, null, 4)
    expect(dirty.scripts.s1).toEqual({ at: 3, reads: [{ db: 'd1' }], writes: [{ page: 'p1' }], effects: ['mail'], byName: true })
  })
})

/* ------------------------------------------------------------------ the budget */

test.describe('B4 · perf', () => {
  test('bigPatchbay(60): model + chains + fuses median ≤ 10 ms', () => {
    const input = inputOf(bigPatchbay(60))
    const m = buildModel(input)
    expect(m.fuses.length + m.nearMisses.length).toBeGreaterThan(0)
    for (let i = 0; i < 5; i++) buildModel(input)
    const times: number[] = []
    for (let i = 0; i < 25; i++) {
      const t = performance.now()
      buildModel(input)
      times.push(performance.now() - t)
    }
    times.sort((a, b) => a - b)
    const median = times[Math.floor(times.length / 2)]
    console.log(`[patchbay-fuses] bigPatchbay(60): ${m.counts.modules + m.counts.idle} modules, ${m.counts.cables} cables, ${m.chains.length} chains, ${m.fuses.length} fuses, ${m.nearMisses.length} near misses — build median ${median.toFixed(2)} ms`)
    expect(median).toBeLessThanOrEqual(10)
  })
})
