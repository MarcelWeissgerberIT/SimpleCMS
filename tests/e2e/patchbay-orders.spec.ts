/**
 * The Patchbay × work orders (Orders B10, spec §4): the planner module, its OPTIONAL tools jack, the chain edges
 * (the work order's next step, Then, stories), `pipelineGate('order')` from this device's consent, the planner as a
 * decider, the exec way out (`unattendedExec`), its fuses and near misses (a)(b)(c), keys 1–3 and the sig's parts.
 * The model cases run in Node (tests/fixtures/patchbay.ts `ordersWorld()`); the UI case seeds the same world.
 *
 * The person's own server for the planner is "kb" (the fixture Wissensbasis, `*.example`). Every name is fictional.
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp } from './fixtures'
import { buildModel } from '../../src/app/features/patchbay/model'
import { moduleKey } from '../../src/app/features/patchbay/ref'
import { THEN_KINDS, unattendedExec, reachesDone } from '../../src/app/features/patchbay/rules'
import { FOLLOW_UPS } from '../../src/app/features/coding/stages'
import type { Chain, Model, ModelInput } from '../../src/app/features/patchbay/types'
import type { Database, PipelineStage } from '../../src/app/store/types'
import { inputOf, modelOf, ordersWorld, profile, seedPatchbay, type OrdersWorldOpts, type PbWorld } from '../fixtures/patchbay'

/* ------------------------------------------------------------------ helpers */

const P = 'features.patchbay'
const PLANNER = moduleKey({ kind: 'planner', db: 'dbOrders' })
const pipe = (db: string, kind: 'coding' | 'spec' | 'qa') => moduleKey({ kind: 'pipeline', db, pipeline: kind })
const BA = pipe('dbOrdBA', 'spec')
const CODE = pipe('dbOrdCode', 'coding')
const QA = pipe('dbOrdQA', 'qa')
const KB = moduleKey({ kind: 'server', id: 'srvKb', name: 'kb' })
const EXEC = 'outbound:exec:-:code'
const PUSH = 'outbound:git:-:push'
const PR = 'outbound:git:-:pr'

const chainTo = (m: Model, decider: string, exit: string): Chain | undefined => m.chains.find((c) => c.decider === decider && c.exit?.module === exit)
const fuseTo = (m: Model, decider: string, exit: string) => m.fuses.find((f) => f.chain.decider === decider && f.chain.exit?.module === exit)
const nearTo = (m: Model, decider: string, exit: string) => m.nearMisses.find((n) => n.chain.decider === decider && n.chain.exit?.module === exit)
const plannerFuses = (m: Model) => m.fuses.filter((f) => f.chain.decider === PLANNER)
const modelWith = (w: PbWorld, change: (input: ModelInput) => ModelInput) => buildModel(change(inputOf(w)))
const narrow = (cls: 'mcp' | 'mail') => (input: ModelInput): ModelInput => ({ ...input, ai: { ...input.ai, device: { narrow: { anthropic: [cls] } } } })
const orders = (o: OrdersWorldOpts = {}) => modelOf(ordersWorld({ server: 'tested', ...o }))
/** The module a jack belongs to. */
const ownerOf = (m: Model, jack: string) => m.modules.find((x) => [...x.inJacks, ...x.outJacks].some((j) => j.key === jack))?.key
/** The edges from one module's jack to another's. */
const edgesBetween = (m: Model, from: string, to: string) => m.edges.filter((e) => ownerOf(m, e.from) === from && ownerOf(m, e.to) === to)

/* ------------------------------------------------------------------ the table's cases (§6 B10) */

test.describe('patchbay × work orders — the planner', () => {
  test('confirm (no consent here): no fuse — near miss (a) "only Kette starten ↵" in front of git push', () => {
    // approvals 'none': git push follows the planner's tasks with nobody in between but the chain's ↵
    const m = orders({ approvals: 'none' })
    expect(plannerFuses(m)).toEqual([])
    const push = chainTo(m, PLANNER, PUSH)!
    expect(push.gate).toBe('byHand')
    // the server's content and the linked pages are there; the way out waits for the chain's ↵ (the gate's words)
    expect([push.lamps?.outside.on, push.lamps?.private.on]).toEqual([true, true])
    expect(push.lamps?.out).toMatchObject({ on: false, say: { key: `${P}.lamp.out.gate.byHand` } })
    expect(nearTo(m, PLANNER, PUSH)).toMatchObject({ why: 'gate', say: { key: `${P}.near.plannerHand` } })
    // no exec way out without the consent (only the planner's auto paths draw it)
    expect(m.modules.some((x) => x.key === EXEC)).toBe(false)
    // with 'review' (git after the review gate) still no fuse — and not sentence (a): an approval stands before git too
    const review = orders()
    expect(plannerFuses(review)).toEqual([])
    expect(nearTo(review, PLANNER, PUSH)?.say?.key).not.toBe(`${P}.near.plannerHand`)
  })

  test('auto + server + approvals "review" = the exec fuse (the worker’s AI writes code unattended); git waits for approval', () => {
    const m = orders({ auto: true })
    const f = fuseTo(m, PLANNER, EXEC)!
    expect(f).toBeTruthy()
    expect(f.chain.exit?.type).toBe('exec')
    expect(f.chain.gate).toBeUndefined()
    expect(f.facts.map((x) => x.say.key)).toEqual(expect.arrayContaining([`${P}.fact.trigger.exec`, `${P}.fact.approvalsPass`, `${P}.fact.thisDevice`]))
    // the server's content is the outside source; linked pages are the private data
    expect(f.chain.why?.outside.some((x) => x.kind === 'mcp' && x.source === KB)).toBe(true)
    expect(f.chain.why?.private).toEqual(expect.arrayContaining([{ kind: 'linked' }]))
    // keys: 1 drops this device's consent · 2 the server's read tools (already so: refused, why named) · 3 sign-off
    expect(f.keys.map((k) => [k.n, k.kind, k.offered])).toEqual([
      [1, 'autoOff', true],
      [2, 'readTools', false],
      [3, 'allow', true],
    ])
    expect(f.keys[0]).toMatchObject({ target: { orders: 'dbOrders' }, device: true })
    expect(f.keys[1].refusal?.key).toBe(`${P}.key.readToolsAlready`)
    // git push stops at the review gate: no git fuse — near miss … but the planner's (b) is about exec only
    expect(fuseTo(m, PLANNER, PUSH)).toBeUndefined()
    expect(chainTo(m, PLANNER, PUSH)?.gate).toBe('afterApproval')
  })

  test('auto + server + approvals "none" = the git fuse (push and merge request with nobody in between)', () => {
    const m = orders({ auto: true, approvals: 'none' })
    const push = fuseTo(m, PLANNER, PUSH)!
    expect(push).toBeTruthy()
    expect(push.facts.map((x) => x.say.key)).toEqual(expect.arrayContaining([`${P}.fact.approvalsNone`, `${P}.fact.thisDevice`]))
    expect(fuseTo(m, PLANNER, PR)).toBeTruthy()
    expect(fuseTo(m, PLANNER, EXEC)).toBeTruthy()
  })

  test('no server: nothing from outside reaches the planner — no fuse, the lamp says why', () => {
    const m = orders({ auto: true, server: null, approvals: 'none' })
    expect(plannerFuses(m)).toEqual([])
    const c = chainTo(m, PLANNER, EXEC)!
    expect([c.lamps?.outside.on, c.lamps?.private.on, c.lamps?.out.on]).toEqual([false, true, true])
    // the tools jack is drawn all the same (OPTIONAL) — with no cable
    const tools = m.modules.find((x) => x.key === PLANNER)!.inJacks.find((j) => j.role === 'tools')!
    expect(tools.optional).toBe(true)
    expect(m.edges.some((e) => e.to === tools.key)).toBe(false)
  })

  test('mail-tainted requests = outside: an agent filing mails into the work orders taints the planner’s rows', () => {
    const m = orders({ auto: true, server: null, mailRows: true })
    const f = fuseTo(m, PLANNER, EXEC)!
    expect(f).toBeTruthy()
    expect(f.chain.why?.outside.some((x) => x.kind !== 'mcp')).toBe(true)
    expect(f.chain.why?.outside.some((x) => x.place && 'db' in x.place && x.place.db === 'dbOrders')).toBe(true)
  })
})

/* ------------------------------------------------------------------ the module, its cables */

test.describe('patchbay × work orders — module and cables', () => {
  test('the planner: started by hand ("Planen"), the request rows + linked pages as net tags, tools jack OPTIONAL', () => {
    const m = orders()
    const pl = m.modules.find((x) => x.key === PLANNER)!
    expect(pl.kind).toBe('planner')
    expect(pl.tags).toEqual(expect.arrayContaining(['asksFirst', 'thisDevice']))
    expect(pl.nets.map((n) => n.place)).toEqual(expect.arrayContaining([{ db: 'dbOrders' }, { external: '~linked' }]))
    const cmd = moduleKey({ kind: 'command', db: 'dbOrders', command: 'orders-plan' })
    expect(edgesBetween(m, cmd, PLANNER).map((e) => [e.kind, e.byHand])).toEqual([['starts', true]])
    // a READ cable from the picked server — never a write tool
    expect(edgesBetween(m, KB, PLANNER).map((e) => e.kind)).toEqual(['reads'])
    const auto = orders({ auto: true }).modules.find((x) => x.key === PLANNER)!
    expect(auto.tags).toEqual(expect.arrayContaining(['direct', 'thisDevice']))
  })

  test('an untested server is drawn whole: key 2 refuses with "test it first" and opens its connection test', () => {
    const m = orders({ auto: true, server: 'untested' })
    expect(edgesBetween(m, KB, PLANNER).length).toBe(1)
    const f = fuseTo(m, PLANNER, EXEC)!
    const k2 = f.keys.find((k) => k.n === 2)!
    expect([k2.kind, k2.offered, k2.refusal?.key]).toEqual(['readTools', false, `${P}.key.readToolsUntested`])
    expect(k2.open).toEqual({ to: 'mcp', server: 'srvKb' })
  })

  test('a server switched off or not picked: no READ cable', () => {
    const w = ordersWorld({ server: 'tested', auto: true })
    w.ws.settings.mcpServers = w.ws.settings.mcpServers!.map((s) => ({ ...s, enabled: false }))
    expect(edgesBetween(modelOf(w), KB, PLANNER)).toEqual([])
  })

  test('planner → projects: "KETTE ↵" by hand in confirm mode, a plain write with the consent', () => {
    const hand = orders()
    for (const p of [BA, CODE, QA]) expect(edgesBetween(hand, PLANNER, p).map((e) => [e.kind, e.byHand, e.tag])).toEqual([['writes', true, 'chainHand']])
    const auto = orders({ auto: true })
    for (const p of [BA, CODE, QA]) expect(edgesBetween(auto, PLANNER, p).map((e) => [e.kind, e.byHand, e.tag])).toEqual([['writes', undefined, undefined]])
  })

  test('chain edges: the next step (checkpoint after BA → by hand), Then and stories — after approval behind a stopping gate', () => {
    const m = orders()
    const next = (from: string, to: string) => edgesBetween(m, from, to).filter((e) => e.kind === 'chain')
    // BA → Coding: the work order's next step behind the checkpoint (by hand) and BA's "Then" (after approval) — one
    // cable; a person stands in between for both reasons
    expect(next(BA, CODE)).toHaveLength(1)
    expect(next(BA, CODE)[0]).toMatchObject({ tag: 'next', afterApproval: true })
    // BA → QA (Then): BA stops at its gate on 'review' → after approval
    expect(next(BA, QA)[0]).toMatchObject({ tag: 'next', afterApproval: true })
    // QA → Coding (Then)
    expect(next(QA, CODE)[0]).toMatchObject({ tag: 'next', afterApproval: true })
    // Coding hands on to nothing
    expect(m.edges.some((e) => e.kind === 'chain' && ownerOf(m, e.from) === CODE)).toBe(false)
    // without the checkpoint the next step is a plain hand-on after approval
    const free = orders({ checkpoint: false })
    expect(edgesBetween(free, BA, CODE).filter((e) => e.kind === 'chain')[0]).toMatchObject({ afterApproval: true })
    expect(edgesBetween(free, BA, CODE).filter((e) => e.kind === 'chain')[0].byHand).toBeUndefined()
    // approvals 'none': BA reaches done unattended — the hand-ons follow at once
    const none = orders({ approvals: 'none', checkpoint: false })
    expect(edgesBetween(none, BA, QA).filter((e) => e.kind === 'chain')[0].afterApproval).toBeUndefined()
  })

  test('stories: a BA stage writing stories hands on to the coding project (also without work orders)', () => {
    const w = ordersWorld({ stories: true, checkpoint: false })
    w.ws.databases.dbOrders = { ...w.ws.databases.dbOrders, orders: { ...(w.ws.databases.dbOrders.orders as NonNullable<Database['orders']>), kinds: ['spec'] } }
    const m = modelOf(w)
    // BA → Coding: Then + stories (one cable), the stories stage stands before the gate → unattended
    const e = edgesBetween(m, BA, CODE).filter((x) => x.kind === 'chain')
    expect(e).toHaveLength(1)
    expect(e[0].afterApproval).toBeUndefined()
  })

  test('THEN_KINDS is the coding area’s FOLLOW_UPS', () => {
    expect(THEN_KINDS).toEqual(FOLLOW_UPS)
  })

  test('unattendedExec / reachesDone: what a task reaches with nobody in between', () => {
    const code: PipelineStage[] = ordersWorld().ws.databases.dbOrdCode.pipeline!
    const stages = code.map((s) => ({ id: s.id, kind: s.kind, auto: s.auto, ...(s.gitAction ? { gitAction: s.gitAction } : {}) }))
    expect([...unattendedExec(stages, 'review')].sort()).toEqual(['implement', 'test'])
    expect([...unattendedExec(stages, 'all')]).toEqual([])
    expect(reachesDone(stages, 'review')).toBe(false)
    expect(reachesDone(stages, 'none')).toBe(true)
  })
})

/* ------------------------------------------------------------------ taint along the chain, near misses (b)(c) */

test.describe('patchbay × work orders — taint and near misses', () => {
  test('confirm mode: tasks the planner wrote by hand do not make the worker a decider of unknown origin', () => {
    // only Coding: the planner's tasks come in after the person's ↵ (approvals 'none' — git with nobody else in between)
    const w = ordersWorld({ server: 'tested', approvals: 'none' })
    w.ws.databases.dbOrders = { ...w.ws.databases.dbOrders, orders: { ...(w.ws.databases.dbOrders.orders as NonNullable<Database['orders']>), kinds: ['coding'] } }
    expect(modelOf(w).unknown.filter((u) => u.module === CODE)).toEqual([])
    // the chain's next step hands BA's work on with nobody in between: what the worker's AI then sends is not known here
    expect(orders({ approvals: 'none' }).unknown.filter((u) => u.module === CODE).map((u) => u.what)).toEqual(['worker'])
  })

  test('(b) auto + approvals "all": only an approval stands before the worker’s AI writes code', () => {
    const m = orders({ auto: true, approvals: 'all' })
    expect(plannerFuses(m)).toEqual([])
    const c = chainTo(m, PLANNER, EXEC)!
    expect(c.gate).toBe('afterApproval')
    expect(nearTo(m, PLANNER, EXEC)).toMatchObject({ why: 'gate', say: { key: `${P}.near.plannerApprove` } })
  })

  test('(c) a data rule withholding "mcp": the server’s content never reaches the planner', () => {
    const m = modelWith(ordersWorld({ server: 'tested', auto: true }), narrow('mcp'))
    expect(plannerFuses(m)).toEqual([])
    expect(m.nearMisses.find((n) => n.chain.decider === PLANNER && n.say?.key === `${P}.near.plannerRule`)).toBeTruthy()
  })

  test('a later build’s work-orders config: the planner is blocked and an unknown part, never read as safe', () => {
    const w = ordersWorld({ server: 'tested', auto: true })
    w.ws.databases.dbOrders = { ...w.ws.databases.dbOrders, orders: { v: 2 } as unknown as Database['orders'] }
    const m = modelOf(w)
    const pl = m.modules.find((x) => x.key === PLANNER)!
    expect(pl.blocked).toBe('unreadable')
    expect(m.unknown.some((u) => u.module === PLANNER)).toBe(true)
  })

  test('team workspaces: no consent is read — the planner always confirms by hand', () => {
    const w = ordersWorld({ server: 'tested', auto: true, approvals: 'none' })
    w.device = { ...w.device, ctx: { team: true, me: 'acc-mara', role: 'owner', readOnly: false, supports: ['ai', 'governor'] } }
    const m = modelOf(w)
    expect(plannerFuses(m)).toEqual([])
    expect(m.modules.some((x) => x.key === EXEC)).toBe(false)
  })
})

/* ------------------------------------------------------------------ sig parts */

test.describe('patchbay × work orders — sig parts', () => {
  const dOf = (w: PbWorld) => fuseTo(modelOf(w), PLANNER, EXEC)!.parts!
  test('d = planner (database, consent, kinds, checkpoint, server name + address + tested tools, profiles); x carries Approvals', () => {
    const base = ordersWorld({ server: 'tested', auto: true })
    const p0 = dOf(base)
    // the consent's sig
    const re = ordersWorld({ server: 'tested', auto: true })
    re.device = { ...re.device, orders: { ...re.device.orders!, auto: { dbOrders: { sig: 'b'.repeat(64), at: 2 } } } }
    expect(dOf(re).d).not.toBe(p0.d)
    // the server's address and tested tools
    const moved = ordersWorld({ server: 'tested', auto: true })
    moved.ws.settings.mcpServers = moved.ws.settings.mcpServers!.map((s) => ({ ...s, url: 'https://kb2.example/mcp' }))
    expect(dOf(moved).d).not.toBe(p0.d)
    const tools = ordersWorld({ server: 'tested', auto: true })
    tools.ws.settings.mcpServers = tools.ws.settings.mcpServers!.map((s) => ({ ...s, tools: ['list_articles', 'get_article'] }))
    expect(dOf(tools).d).not.toBe(p0.d)
    // a profile matching it
    const prof = ordersWorld({ server: 'tested', auto: true })
    prof.ws.integrations = [profile('kb-profil', { match: { name: 'kb' } })]
    expect(dOf(prof).d).not.toBe(p0.d)
    // the checkpoint
    expect(dOf(ordersWorld({ server: 'tested', auto: true, checkpoint: false })).d).not.toBe(p0.d)
    // the exec way out carries Approvals
    const all = ordersWorld({ server: 'tested', auto: true, approvals: 'none' })
    expect(dOf(all).x).not.toBe(p0.x)
    expect(dOf(all).d).toBe(p0.d)
  })
})

/* ------------------------------------------------------------------ UI (browser) */

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const pbModel = (page: Page) => page.evaluate(() => (window as unknown as { __onePatchbay: { model: () => { fuses: AnyState[] } | null } }).__onePatchbay.model())
const consent = (page: Page) => page.evaluate(() => (window as unknown as { __oneOrders: { auto(db: string): unknown } }).__oneOrders.auto('dbOrders'))

test.describe('patchbay × work orders — UI', () => {
  test('the planner on the rack, CHAIN ↵ and the band; the consent opens the exec fuse, key 1 drops it, Undo puts it back', async ({ page }) => {
    await openApp(page)
    await page.route(/\.example\//, (r) => r.fulfill({ status: 200, body: 'ok' }))
    await seedPatchbay(page, ordersWorld({ server: 'tested' }))
    await page.evaluate(() => (window.location.hash = '#/patchbay'))
    await expect(page.getByTestId('patchbay-page')).toBeVisible()
    const planner = page.locator(`[data-testid="pb-module"][data-key="${PLANNER}"]`)
    await expect(planner).toBeVisible()
    await expect(planner.locator('.pb-mod__kind')).toHaveText(/Planner · Work orders/i)
    await expect(planner.locator('[data-role="tools"]')).toHaveCount(1)
    await expect(planner.getByTestId('pb-planner-lamps')).toContainText(/Context/i)
    // the band: six lamps, 05 optional
    const band = page.getByTestId('pb-orders-band')
    await expect(band).toBeVisible()
    await expect(band.getByTestId('pb-lamp')).toHaveCount(6)
    await expect(band.locator('[data-testid="pb-lamp"][data-optional]')).toHaveCount(1)
    // the planner's cables to the projects say CHAIN ↵ (a person's ↵ starts each chain)
    await expect(page.locator('.pb-wlabel-t').filter({ hasText: /Chain ↵/ }).first()).toBeAttached()
    // confirm mode: no fuse of the planner
    await expect.poll(async () => ((await pbModel(page))?.fuses ?? []).filter((f) => f.chain.decider === PLANNER).length).toBe(0)
    // the consent (B11's switch; here the e2e seam) → the exec fuse
    await page.evaluate(() => (window as unknown as { __oneOrders: { setAuto(db: string, v: unknown): void } }).__oneOrders.setAuto('dbOrders', { sig: 'a'.repeat(64), at: Date.now() }))
    let key = ''
    await expect
      .poll(async () => {
        const f = ((await pbModel(page))?.fuses ?? []).find((x) => x.chain.decider === PLANNER && x.chain.exit?.module === EXEC)
        key = f?.key ?? ''
        return key
      })
      .not.toBe('')
    await page.locator(`[data-pb-fuse-tab="${key}"]`).first().click()
    const row1 = page.locator('#pb-fuse-panel .pb-fkey[data-n="1"]')
    await expect(row1).toHaveAttribute('data-kind', 'autoOff')
    await expect(page.locator('#pb-fuse-panel .pb-fkey[data-n="2"]')).toHaveAttribute('data-kind', 'readTools')
    await page.locator('#pb-fuse-panel [data-pb-key="1"]').click()
    await expect.poll(() => consent(page)).toBeNull()
    await page.locator('.toast').filter({ hasText: /closed/i }).last().getByRole('button', { name: /Undo/i }).click()
    await expect.poll(() => consent(page)).not.toBeNull()
  })
})
