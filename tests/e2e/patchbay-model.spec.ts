/**
 * The Patchbay ("Schaltplan") — the pure parts, run by the Playwright runner. B1 (seams):
 *  - the #/patchbay route: parse and href (m = a module key, f = a fuse's path key, setup = a profile id; anything else
 *    is dropped), every module key round-trips through the address (lib/router.ts, features/patchbay/ref.ts);
 *  - the wiring inventory (features/patchbay/inventory.ts): what it counts on a fixture — agents, scripts, automations,
 *    own commands, repeating templates, live databases (a database in the trash, below a page in the trash, in a
 *    template or without a page never counts) — and that it never walks the page map (the pages sit behind a proxy that
 *    counts every key listing);
 *  - the seed workspace: the inventory computed here on the seeded state (pages behind the same proxy) equals what
 *    #/patchbay's readout and Workspace › Automation show in the app;
 *  - the pure seams the parallel tracks build on load in Node (agents/saveChecks.ts, store/fuseSignoffs.ts,
 *    patchbay/cache.ts) — the editor's save checks as message refs from page facts (B15's patches run them), the
 *    sign-off reader (B2 reads it, B9 filled it);
 *  - the device stores' wipe: `cloud:<ws>` takes every member's scope of that workspace along (cache.ts, run in a
 *    browser — bundled here with Vite's build API, nothing of the app involved).
 * B2 (the graph core — model.ts, tools.ts, source.ts, scripts.ts, buttons.ts; fixtures tests/fixtures/patchbay.ts):
 *  - mock 1 → § 01 4 + 3 idle · § 02 6 · § 03 7, 15 cables · 3 dashed, the net-flag pair, the folded script;
 *  - wide reach: an everything agent in 40 databases ≤ 4 out cables, a named scope of 9 → 6 cables + "+3";
 *  - tool groups (heuristic, declared reads with no write word, OUT, untested, fail closed, residual);
 *  - what this device knows about agents (another member's browser agent, awaiting confirm, off, Unreadable,
 *    route-blocked, the runtime, webhook triggers); sources, relays and ways out; the script scan and the button index;
 *  - the wiring signature (typing and bookkeeping rebuild nothing, a renamed watched field once); the seed workspace.
 * Every page and value is fictional.
 */
import { test, expect, openApp, wsEval } from './fixtures'
import { parseHash, routeHref } from '../../src/app/lib/router'
import { liveDatabases, wiringCount, wiringInventory, type WiringReaders } from '../../src/app/features/patchbay/inventory'
import { inventoryKeys, keyPart, kindOfKey, moduleKey, scheduleKey } from '../../src/app/features/patchbay/ref'
import { readAutomations } from '../../src/app/features/automations/read'
import type { Automation, CustomAgent, Database, DbCommand, ID, OneScript, Page } from '../../src/app/store/types'
import type { PageFacts } from '../../src/app/features/patchbay/types'
import { messages as agentMessages } from '../../src/app/features/agents/messages'
import { build } from 'vite'
import type { IntegrationProfile, Kit, McpServerConfig } from '../../src/app/store/types'
import type { Model } from '../../src/app/features/patchbay/types'
import { buildModel } from '../../src/app/features/patchbay/model'
import { toolGroups, toolUse } from '../../src/app/features/patchbay/tools'
import { toModelInput } from '../../src/app/features/patchbay/source'
import { scanScript } from '../../src/app/features/patchbay/scripts'
import { ButtonIndex, buttonsIn } from '../../src/app/features/patchbay/buttons'
import {
  NODE_ENGINE,
  TRACKER_TOOLS,
  agent as pbAgent,
  automation as pbAutomation,
  bigPatchbay,
  buttonNode,
  database as pbDatabase,
  dbPage as pbDbPage,
  docOf,
  exits,
  inputOf,
  memoOf,
  mock1,
  modelOf,
  nodeReaders,
  page as pbPage,
  profile,
  prop,
  relays,
  server,
  sourceOf,
  wideScope,
  world,
  type PbWorld,
} from '../fixtures/patchbay'

/* ------------------------------------------------------------------ fixtures */

const page = (id: ID, over: Partial<Page> = {}): Page => ({
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
})

const dbPage = (id: ID, title: string, over: Partial<Page> = {}) => page(id, { kind: 'database', title, ...over })

const automation = (id: ID, name: string): Automation => ({ id, name, enabled: true, trigger: { type: 'row_created' } as Automation['trigger'], actions: [{ type: 'notify', message: name }] })

const database = (id: ID, over: Partial<Database> = {}): Database => ({ id, properties: [], views: [], ...over }) as Database

const agent = (id: ID, name: string): CustomAgent =>
  ({ id, name, instructions: 'Summarise the week.', trigger: { type: 'manual' }, scope: { everything: false, pages: [], databases: [] }, write: 'none', output: null, mcpServers: [], runner: 'browser', maxRunUsd: 0.5, enabled: true, createdBy: null, updatedBy: null, createdAt: 1, updatedAt: 1 }) as CustomAgent

const script = (id: ID, name: string): OneScript => ({ id, name, code: 'let n = 1', kind: 'script', createdBy: null, updatedBy: null, createdAt: 1, updatedAt: 1 })

/** Plain readers for Node (the app passes the areas' own: readAutomations · readDbCommands). */
const READ: WiringReaders = {
  automations: readAutomations,
  commands: (raw) => (Array.isArray(raw) ? (raw as DbCommand[]) : []),
}

/** The page map behind a proxy that counts every key listing (Object.keys / values / entries, for…in, spread). */
function watched(pages: Record<ID, Page>): { pages: Record<ID, Page>; walks: () => number } {
  let walks = 0
  const proxy = new Proxy(pages, {
    ownKeys(target) {
      walks++
      return Reflect.ownKeys(target)
    },
  })
  return { pages: proxy, walks: () => walks }
}

/* ------------------------------------------------------------------ route */

test.describe('route — #/patchbay', () => {
  test('parses the bare route and its three parameters; drops anything that is not one', () => {
    expect(parseHash('#/patchbay')).toEqual({ name: 'patchbay' })
    const f = 'a'.repeat(64)
    expect(parseHash(`#/patchbay?m=agent:agNordlicht&f=${f}&setup=in-01`)).toEqual({ name: 'patchbay', m: 'agent:agNordlicht', f, setup: 'in-01' })
    // a fuse key is 64 hex, a profile id lower case, a module key `<kind>:<parts>` — anything else is dropped
    expect(parseHash('#/patchbay?f=F1&setup=IN 01&m=<script>')).toEqual({ name: 'patchbay' })
    expect(parseHash(`#/patchbay?f=${'A'.repeat(64)}`)).toEqual({ name: 'patchbay' })
    expect(parseHash('#/patchbay/anything')).toEqual({ name: 'patchbay' })
  })

  test('href writes what parse reads', () => {
    expect(routeHref({ name: 'patchbay' })).toBe('#/patchbay')
    const r = { name: 'patchbay' as const, m: 'automation:dbTessera:autForward', f: 'b'.repeat(64), setup: 'tracker-cnsx' }
    expect(parseHash(routeHref(r))).toEqual(r)
    expect(routeHref({ name: 'patchbay', setup: 'in-01' })).toBe('#/patchbay?setup=in-01')
  })

  test('every module key passes through the address unchanged (ids, names with spaces, colons and umlauts)', () => {
    const keys = [
      moduleKey({ kind: 'agent', id: 'agInbox01' }),
      moduleKey({ kind: 'server', id: null, name: 'tracker: Mara Lind (team)', runtime: true }),
      moduleKey({ kind: 'rowTrigger', db: 'dbMails', event: 'changed', prop: '*' }),
      moduleKey({ kind: 'rowTrigger', db: 'dbMails', event: 'created', prop: null }),
      moduleKey({ kind: 'outbound', exit: 'webhook', host: 'chat.example', method: 'POST', by: [] }),
      moduleKey({ kind: 'clock', schedule: scheduleKey({ type: 'schedule', every: 'week', at: '07:30', weekday: 1, tz: 'Europe/Berlin' }), agents: ['agInbox01'] }),
      moduleKey({ kind: 'command', db: 'dbLaunch', command: 'send:in-01:reply' }),
      moduleKey({ kind: 'page', id: 'Bericht über Größe' }),
      inventoryKeys.repeating('dbMeetings', 'tplWeekly'),
    ]
    for (const m of keys) {
      expect(m).toMatch(/^[a-z][a-zA-Z]+:[A-Za-z0-9_.:%~-]+$/)
      expect(parseHash(routeHref({ name: 'patchbay', m })), m).toEqual({ name: 'patchbay', m })
    }
    // a part never carries a raw ':' — the parts split back
    expect(keyPart('a:b c')).toBe('a%3Ab%20c')
    expect(moduleKey({ kind: 'automation', db: 'dbTessera', id: 'autForward' })).toBe('automation:dbTessera:autForward')
    expect(inventoryKeys.automation('dbTessera', 'autForward')).toBe('automation:dbTessera:autForward')
    expect(kindOfKey('rowTrigger:dbMails:changed:%2A')).toBe('rowTrigger')
    expect(kindOfKey('nonsense')).toBeNull()
    // the same schedule is the same clock; another weekday is another
    const base = { type: 'schedule' as const, every: 'week' as const, at: '07:30', weekday: 1, tz: 'Europe/Berlin' }
    expect(scheduleKey(base)).toBe(scheduleKey({ ...base }))
    expect(scheduleKey(base)).not.toBe(scheduleKey({ ...base, weekday: 2 }))
  })
})

/* ------------------------------------------------------------------ inventory */

test.describe('wiring inventory — inventory.ts', () => {
  test('counts agents, scripts, automations, own commands, repeating templates and live databases', () => {
    const pages: Record<ID, Page> = {
      dbTessera: dbPage('dbTessera', 'Tessera'),
      dbLaunch: dbPage('dbLaunch', 'Launch plan'),
      binned: page('binned', { trashed: true, trashedAt: 2 }),
      dbBelow: dbPage('dbBelow', 'Below the trash', { parentId: 'binned' }),
      dbTrashed: dbPage('dbTrashed', 'In the trash', { trashed: true, trashedAt: 2 }),
      tplRoot: page('tplRoot', { template: { name: 'Nordlicht kit' } as Page['template'] }),
      dbInTemplate: dbPage('dbInTemplate', 'In a template', { parentId: 'tplRoot' }),
    }
    const repeat = { freq: 'weekly', days: [1], time: '09:00', start: '2026-10-12', title: '{{name}}', dateProperty: null } as unknown as NonNullable<Database['templates']>[number]['repeat']
    const databases: Record<ID, Database> = {
      dbTessera: database('dbTessera', {
        automations: [automation('autForward', 'To team chat'), automation('autContact', 'New mail → contact')],
        commands: [{ id: 'cmdExport', kind: 'actions', label: 'Export', icon: null, config: {} }, { id: 'new-entry', kind: 'default', hidden: true }] as DbCommand[],
      }),
      dbLaunch: database('dbLaunch', {
        templates: [{ id: 'tplWeekly', name: 'Weekly', properties: {}, repeat }, { id: 'tplOnce', name: 'Once', properties: {} }] as Database['templates'],
      }),
      dbBelow: database('dbBelow', { automations: [automation('autBelow', 'Never counted')] }),
      dbTrashed: database('dbTrashed', { automations: [automation('autTrashed', 'Never counted')] }),
      dbInTemplate: database('dbInTemplate', { automations: [automation('autTpl', 'Never counted')], templates: [{ id: 'tplT', name: 'T', properties: {}, repeat }] as Database['templates'] }),
      dbNoPage: database('dbNoPage', { automations: [automation('autOrphan', 'Never counted')] }),
    }
    const w = watched(pages)
    const inv = wiringInventory({ pages: w.pages, databases, agents: { agB: agent('agB', 'Weekly digest'), agA: agent('agA', 'Inbox helper') }, scripts: { scW: script('scW', 'Wochenbericht') } }, READ)
    expect(inv.agents.map((a) => a.name)).toEqual(['Inbox helper', 'Weekly digest'])
    expect(inv.scripts.map((s) => s.name)).toEqual(['Wochenbericht'])
    expect(inv.automations.map((a) => a.automation.id)).toEqual(['autForward', 'autContact'])
    expect(inv.commands.map((c) => c.command.id)).toEqual(['cmdExport'])
    expect(inv.repeating.map((r) => `${r.dbId}/${r.template.id}`)).toEqual(['dbLaunch/tplWeekly'])
    // live databases by title: Launch plan, Tessera
    expect(inv.databases.map((d) => d.id)).toEqual(['dbLaunch', 'dbTessera'])
    expect(wiringCount(inv)).toBe(2 + 1 + 2 + 1 + 1)
    // no page-map walk: lookups by id only (and the proxy does see a walk: the check checks something)
    expect(w.walks()).toBe(0)
    void Object.values(w.pages)
    expect(w.walks()).toBe(1)
  })

  test('liveness walks up the parents only, cycle-safe, and an empty workspace counts nothing', () => {
    const pages: Record<ID, Page> = {
      loopA: page('loopA', { parentId: 'loopB' }),
      loopB: page('loopB', { parentId: 'loopA' }),
      dbLoop: dbPage('dbLoop', 'Loop', { parentId: 'loopA' }),
    }
    const w = watched(pages)
    expect(liveDatabases(w.pages, { dbLoop: database('dbLoop') }).map((d) => d.id)).toEqual(['dbLoop'])
    expect(w.walks()).toBe(0)
    const empty = wiringInventory({ pages: {}, databases: {}, agents: undefined, scripts: undefined }, READ)
    expect(wiringCount(empty)).toBe(0)
    expect(empty.databases).toEqual([])
  })
})

/* ------------------------------------------------------------------ the seed workspace */

test.describe('wiring inventory — the seed workspace', () => {
  test('the inventory of the seeded workspace (no page-map walk) is what #/patchbay and Workspace › Automation show', async ({ page }) => {
    await openApp(page)
    const state = await wsEval(page, (s) => ({ pages: s.pages, databases: s.databases, agents: s.agents ?? {}, scripts: s.scripts ?? {}, functions: Object.keys(s.functions ?? {}).length, templates: (Object.values(s.pages) as Array<{ template?: unknown; trashed?: boolean }>).filter((p) => p.template && !p.trashed).length }))
    const w = watched(state.pages as Record<ID, Page>)
    const inv = wiringInventory({ pages: w.pages, databases: state.databases as Record<ID, Database>, agents: state.agents as Record<ID, CustomAgent>, scripts: state.scripts as Record<ID, OneScript> }, READ)
    expect(w.walks()).toBe(0)
    // the seed (store/seed.ts): one automation (Projects), one repeating template (Meetings), no agents or scripts yet
    expect(inv.agents).toHaveLength(0)
    expect(inv.scripts).toHaveLength(0)
    expect(inv.automations).toHaveLength(1)
    expect(inv.repeating).toHaveLength(1)
    expect(inv.commands).toHaveLength(0)
    const dbTitles = inv.databases.map((d) => (state.pages as Record<ID, Page>)[d.id].title)
    expect(dbTitles).toEqual(expect.arrayContaining(['Projects', 'Reading list', 'Content calendar', 'Meetings']))
    expect(inv.automations[0].dbId).toBe(inv.databases.find((d) => (state.pages as Record<ID, Page>)[d.id].title === 'Projects')!.id)

    // #/patchbay (lazy) shows the same numbers
    await page.evaluate(() => (window.location.hash = '#/patchbay'))
    await expect(page.getByTestId('patchbay-page')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Patchbay')
    await expect(page).toHaveTitle(/^Patchbay — /)
    // B6: the rack draws what runs by itself — Projects' automation and the Meetings template's clock, by their `?m=`
    // keys (inventoryKeys) — and the readout counts the modules on it; no fuse in the seed
    const mod = (key: string) => page.locator(`[data-testid="pb-module"][data-key="${key}"]`)
    await expect(mod(inventoryKeys.automation(inv.automations[0].dbId, inv.automations[0].automation.id))).toBeVisible()
    await expect(mod(inventoryKeys.repeating(inv.repeating[0].dbId, inv.repeating[0].template.id))).toBeVisible()
    const drawn = await page.getByTestId('pb-module').count()
    await expect(page.getByTestId('pb-ro-modules')).toHaveText(new RegExp(`^${drawn}\\b`))
    await expect(page.getByTestId('pb-ro-fuse-val')).toHaveText('none open')

    // Workspace › Automation counts the same, plus own functions and own templates (they do not run by themselves)
    await page.getByTestId('patchbay-as-list').click()
    await expect(page).toHaveURL(/#\/workspace\/automation$/)
    const total = wiringCount(inv) + state.functions + state.templates
    await expect(page.getByTestId('workspace-page')).toContainText(`${total} in all`)
  })

  test('openPatchbay-shaped links open the page with their parameters; the page reads German', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await page.evaluate(() => (window.location.hash = '#/patchbay?setup=in-01'))
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Schaltplan')
    await expect(page.getByTestId('patchbay-page')).toContainText('Was von allein läuft')
    await expect(page).toHaveURL(/#\/patchbay\?setup=in-01$/)
  })
})

/* ------------------------------------------------------------------ pure seams (B2 / B9 / B11 / B15 build on them) */

/** A plain translator over the agents' messages (shared/i18n is not Node-loadable: brand.ts reads import.meta.env). */
const tr = (lang: 'en' | 'de') => (key: string, vars?: Record<string, string | number>) =>
  (agentMessages[lang][key] ?? key).replace(/\{(\w+)\}/g, (m, k: string) => (vars && k in vars ? String(vars[k]) : m))

const draft = (over: Partial<CustomAgent> = {}): CustomAgent => ({ ...agent('agNordlicht', 'Nordlicht digest'), ...over }) as CustomAgent

const facts = (lang: 'en' | 'de' = 'en') => ({ serverOk: false, inCloud: false, lang, untitled: lang === 'de' ? 'Ohne Titel' : 'Untitled' })

/** Every issue is a message ref: a key and plain values (titles are data) — never a sentence. */
function refsOnly(issues: Record<string, Array<{ key: string; vars?: Record<string, unknown>; titles?: string[] }>>) {
  for (const [field, list] of Object.entries(issues)) {
    expect(list.length, field).toBeGreaterThan(0)
    for (const i of list) {
      expect(i.key).toMatch(/^features\.agents\.[a-zA-Z.]+$/)
      for (const v of Object.values(i.vars ?? {})) expect(['string', 'number']).toContain(typeof v)
    }
  }
}

test.describe('pure seams — they load in Node', () => {
  test('the save checks, the sign-off reader and the device stores import without the store, i18n or CSS', async () => {
    const checks = await import('../../src/app/features/agents/saveChecks')
    expect(typeof checks.agentSaveIssues).toBe('function')
    expect(typeof checks.savePagesOf).toBe('function')
    const signoffs = await import('../../src/app/store/fuseSignoffs')
    // B9: a clean map reads as itself (the same reference — B2's memo keeps it); nothing reads as one frozen {} every
    // time (the rules in full: patchbay-signoff-store.spec.ts)
    const stored = { ['a'.repeat(64)]: { sig: 'b'.repeat(64), parts: { a: 'c'.repeat(16) }, at: 1, updatedBy: null } }
    expect(signoffs.sanitizeFuseSignoffs(stored)).toBe(stored)
    expect(signoffs.sanitizeFuseSignoffs(undefined)).toEqual({})
    expect(signoffs.sanitizeFuseSignoffs(undefined)).toBe(signoffs.sanitizeFuseSignoffs(null))
    const cache = await import('../../src/app/features/patchbay/cache')
    expect([cache.PATCHBAY_DB, cache.PATCHBAY_STORE]).toEqual(['one-patchbay', 'kv'])
  })
})

test.describe('agent save checks — saveChecks.ts (the editor and the Patchbay run the same)', () => {
  test('a clean draft has none; every field answers with message refs, never text', async () => {
    const { agentSaveIssues } = await import('../../src/app/features/agents/saveChecks')
    expect(agentSaveIssues(draft({ scope: { everything: true, pages: [], databases: [] } }), { ...facts(), pages: {} })).toEqual({})
    const bad = agentSaveIssues(
      draft({ name: ' ', instructions: '', trigger: { type: 'schedule', every: 'day', at: '25:00', tz: 'Europe/Berlin' }, scope: { everything: false, pages: [], databases: [] }, runner: 'server', maxRunUsd: 80 }),
      { ...facts(), pages: {} },
    )
    expect(Object.keys(bad)).toEqual(['name', 'instructions', 'trigger', 'scope', 'budget', 'runner'])
    expect(bad.trigger?.[0].key).toBe('features.agents.err.time')
    expect(bad.budget?.[0]).toEqual({ key: 'features.agents.err.budget', vars: { min: '$0.01', max: '$50.00' } })
    refsOnly(bad)
    // the open placeholders are counted by the caller (mirror.ts placeholdersIn) and only block an enabled agent
    expect(agentSaveIssues(draft({ scope: { everything: true, pages: [], databases: [] } }), { ...facts(), pages: {}, placeholders: 2 }).instructions).toEqual([{ key: 'features.agents.mirror.err.placeholders', vars: { count: 2 } }])
    expect(agentSaveIssues(draft({ enabled: false, scope: { everything: true, pages: [], databases: [] } }), { ...facts(), pages: {}, placeholders: 2 })).toEqual({})
    // the budget field's text in the UI's language
    expect(agentSaveIssues(draft({ scope: { everything: true, pages: [], databases: [] } }), { ...facts('de'), pages: {}, budget: { text: '1.5' } })).toEqual({})
    expect(agentSaveIssues(draft({ scope: { everything: true, pages: [], databases: [] } }), { ...facts('de'), pages: {}, budget: { text: 'zwei' } }).budget).toEqual([{ key: 'features.agents.err.budgetNumber', vars: { example: '1,50' } }])
  })

  test('pages in the trash, below a page there, or gone for good — from page facts (the Patchbay’s PageFacts as they are)', async () => {
    const { agentSaveIssues, agentSaveTexts } = await import('../../src/app/features/agents/saveChecks')
    const pf = (id: ID, title: string, over: Partial<PageFacts> = {}): PageFacts => ({ id, title, kind: 'page', trashed: false, gone: false, inTemplate: false, private: false, ...over })
    const pages: Record<ID, PageFacts> = {
      pgAlpha: pf('pgAlpha', 'Alpha', { trashed: true, gone: true }),
      pgBeta: pf('pgBeta', 'Beta', { trashed: true, gone: true }),
      pgLaunch: pf('pgLaunch', 'Launch plan', { gone: true, root: { id: 'pgArchive', title: 'Archive' } }),
      dbTessera: pf('dbTessera', 'Tessera', { kind: 'database', gone: true, root: { id: 'pgArchive', title: 'Archive' } }),
      pgReport: pf('pgReport', '', { trashed: true, gone: true }),
    }
    const d = draft({
      scope: { everything: false, pages: ['pgAlpha', 'pgBeta', 'pgGone1', 'pgLaunch'], databases: ['dbGone2'] },
      trigger: { type: 'row_created', databaseId: 'dbTessera' },
      output: { pageId: 'pgReport', mode: 'append' },
    })
    const issues = agentSaveIssues(d, { ...facts(), pages, titles: { pgGone1: 'Mara Lind', dbGone2: 'Nordlicht' } })
    refsOnly(issues)
    expect(issues.trigger).toEqual([{ key: 'features.agents.err.databaseBelow', vars: { title: 'Tessera', parent: 'Archive' } }])
    expect(issues.output).toEqual([{ key: 'features.agents.err.outputTrashed', vars: { title: 'Untitled' } }])
    expect(issues.scope).toEqual([
      { key: 'features.agents.err.scopeGone.other', titles: ['Mara Lind', 'Nordlicht'] },
      { key: 'features.agents.err.scopeTrashed.other', titles: ['Alpha', 'Beta'] },
      { key: 'features.agents.err.scopeBelow', vars: { title: 'Launch plan', parent: 'Archive' } },
    ])
    // the words: a list is quoted and joined in the UI's language
    const words = agentSaveTexts(tr('de'), issues)
    expect(words.scope).toBe(
      '„Mara Lind“ und „Nordlicht“ gibt es nicht mehr — nimm sie aus „Darf nutzen“ heraus. ' +
        '„Alpha“ und „Beta“ liegen im Papierkorb — nimm sie aus „Darf nutzen“ heraus oder stell sie wieder her. ' +
        '„Launch plan“ liegt in „Archive“, und „Archive“ liegt im Papierkorb — nimm sie aus „Darf nutzen“ heraus oder stell „Archive“ wieder her.',
    )
    // a teammate's private pages are not on this device: a page missing here is not "gone" then
    expect(agentSaveIssues(draft({ scope: { everything: false, pages: ['pgGone1'], databases: [] } }), { ...facts(), pages: {}, seesAll: false })).toEqual({})
    // missing with an unknown title: named by what it was
    expect(agentSaveIssues(draft({ scope: { everything: false, pages: [], databases: ['dbGone2'] } }), { ...facts(), pages: {} }).scope).toEqual([{ key: 'features.agents.err.scopeGone.database' }])
  })

  test('savePagesOf reads the same facts from a page map (the editor’s way in) — the trash walk is cycle-safe', async () => {
    const { agentSaveIssues, agentSaveTexts, savePagesOf } = await import('../../src/app/features/agents/saveChecks')
    const map: Record<ID, Page> = {
      pgArchive: page('pgArchive', { title: 'Archive', trashed: true, trashedAt: 2 }),
      pgLaunch: page('pgLaunch', { title: 'Launch plan', parentId: 'pgArchive' }),
      pgLive: page('pgLive', { title: 'Tessera notes' }),
      loopA: page('loopA', { title: 'Loop', parentId: 'loopB' }),
      loopB: page('loopB', { parentId: 'loopA' }),
    }
    const d = draft({ scope: { everything: false, pages: ['pgLaunch', 'pgLive', 'loopA', 'pgArchive'], databases: [] } })
    expect(savePagesOf(map, d)).toEqual({
      pgLaunch: { title: 'Launch plan', trashed: false, gone: true, root: { id: 'pgArchive', title: 'Archive' } },
      pgLive: { title: 'Tessera notes', trashed: false, gone: false, root: null },
      loopA: { title: 'Loop', trashed: false, gone: false, root: null },
      pgArchive: { title: 'Archive', trashed: true, gone: true, root: null },
    })
    const words = agentSaveTexts(tr('en'), agentSaveIssues(d, { ...facts(), pages: savePagesOf(map, d) }))
    expect(words).toEqual({
      scope: '“Archive” is in the trash — remove it from “May use” or restore it. “Launch plan” is in “Archive”, and “Archive” is in the trash — remove it from “May use” or restore “Archive”.',
    })
  })
})

test.describe('device stores — cache.ts', () => {
  test('inPatchbayScope: a workspace scope holds its members’ scopes, never another workspace’s', async () => {
    const { inPatchbayScope, lazyKey, runsKey, setupKey } = await import('../../src/app/features/patchbay/cache')
    expect(inPatchbayScope(lazyKey('cloud:W1:u:A'), 'cloud:W1')).toBe(true)
    expect(inPatchbayScope(runsKey('cloud:W1:u:B', '2026-10-14'), 'cloud:W1')).toBe(true)
    expect(inPatchbayScope(setupKey('cloud:W1'), 'cloud:W1')).toBe(true)
    expect(inPatchbayScope(lazyKey('cloud:W10:u:A'), 'cloud:W1')).toBe(false)
    expect(inPatchbayScope(lazyKey('local:local'), 'cloud:W1')).toBe(false)
    // a member's scope holds only that member's
    expect(inPatchbayScope(lazyKey('cloud:W1:u:A'), 'cloud:W1:u:A')).toBe(true)
    expect(inPatchbayScope(lazyKey('cloud:W1:u:AB'), 'cloud:W1:u:A')).toBe(false)
    expect(inPatchbayScope(lazyKey('local:local'), null)).toBe(true)
  })

  test('wipePatchbay("cloud:<ws>") removes every member’s records of that workspace and nothing else', async ({ page }) => {
    const out = await build({ configFile: false, logLevel: 'silent', build: { write: false, minify: false, lib: { entry: 'src/app/features/patchbay/cache.ts', formats: ['iife'], name: 'PatchbayCache', fileName: 'cache' } } })
    const code = (Array.isArray(out) ? out[0] : out) as { output: Array<{ code: string }> }
    await openApp(page)
    await page.addScriptTag({ content: code.output[0].code })
    const left = await page.evaluate(async () => {
      type Cache = typeof import('../../src/app/features/patchbay/cache')
      const pb = (window as unknown as { PatchbayCache: Cache }).PatchbayCache
      const scopes = ['cloud:W1:u:A', 'cloud:W1:u:B', 'cloud:W10:u:A', 'local:local']
      for (const s of scopes) {
        await pb.writeCache(pb.lazyKey(s), { v: 1 })
        await pb.writeCache(pb.setupKey(s), { profileId: 'in-01' })
        pb.lsSet(pb.lsOrder(s), '[]')
      }
      await pb.writeCache(pb.runsKey('cloud:W1:u:B', '2026-10-14'), { n: {}, last: {} })
      pb.lsSet(pb.LS_SEEN, '1')
      await pb.wipePatchbay('cloud:W1')
      const all = await new Promise<string[]>((resolve, reject) => {
        const req = indexedDB.open(pb.PATCHBAY_DB)
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const tx = req.result.transaction(pb.PATCHBAY_STORE, 'readonly')
          const keys = tx.objectStore(pb.PATCHBAY_STORE).getAllKeys()
          keys.onsuccess = () => {
            resolve((keys.result as string[]).sort())
            req.result.close()
          }
        }
      })
      return { idb: all, ls: Object.keys(localStorage).filter((k) => k.startsWith('one.patchbay.')).sort() }
    })
    expect(left.idb).toEqual(['cloud:W10:u:A|lazy', 'cloud:W10:u:A|setup', 'local:local|lazy', 'local:local|setup'])
    expect(left.ls).toEqual(['one.patchbay.order:cloud:W10:u:A', 'one.patchbay.order:local:local', 'one.patchbay.seen'])
    // null = every scope (the local reset): the device's switches too
    const after = await page.evaluate(async () => {
      const pb = (window as unknown as { PatchbayCache: typeof import('../../src/app/features/patchbay/cache') }).PatchbayCache
      await pb.wipePatchbay(null)
      return { lazy: await pb.readCache(pb.lazyKey('local:local'), (v): v is unknown => v !== undefined), ls: Object.keys(localStorage).filter((k) => k.startsWith('one.patchbay.')) }
    })
    expect(after).toEqual({ lazy: null, ls: [] })
  })
})

/* ================================================================== B2 — the graph core (model.ts, tools.ts, source.ts) */

const keyOf = (ref: Parameters<typeof moduleKey>[0]) => moduleKey(ref)
const cols = (m: Model) => [1, 2, 3].map((col) => m.modules.filter((x) => x.col === col && !x.idle).length)
const mods = (m: Model, kind: string) => m.modules.filter((x) => x.kind === kind)
const edgesFrom = (m: Model, module: string) => m.edges.filter((e) => e.from.startsWith(`${module}.`))
const edgesInto = (m: Model, module: string) => m.edges.filter((e) => e.to.startsWith(`${module}.`))

test.describe('B2 · the rack of mock 1 — model.ts', () => {
  test('§ 01 4 + 3 idle · § 02 6 · § 03 7, 15 cables · 3 dashed, the net-flag pair, the folded script', () => {
    const w = mock1()
    const { ids } = w
    const m = modelOf(w)
    // "MODULES 17 · 3 idle" — Whole workspace added to the mock (§3.13)
    expect(m.counts).toEqual({ modules: 17, idle: 3, cables: 15, dashed: 3, planned: 0, ghosts: 0 })
    expect(cols(m)).toEqual([4, 6, 7])
    expect(m.modules.filter((x) => x.idle).map((x) => x.key)).toEqual([keyOf({ kind: 'server', id: ids.kanal, name: 'kanal' }), keyOf({ kind: 'server', id: ids.bildwerk, name: 'bildwerk' }), keyOf({ kind: 'server', id: ids.wiki, name: 'wiki' })])
    // dashed: the AI decides — Inbox-Helfer's „Weiterleiten“ and its whole workspace, the pipeline's merge requests
    const helper = keyOf({ kind: 'agent', id: ids.inboxHelper })
    const net = `net:${ids.mails}:${ids.forward}`
    expect(m.edges.filter((e) => e.can).map((e) => e.id).sort()).toEqual(
      [`${helper}.everything>everything:all.writes`, `${helper}.writes>${net}`, `pipeline:${ids.coding}.out>outbound:git:-:pr.out`].sort(),
    )
    // the mirror writes its own database on every run: solid
    const mirror = keyOf({ kind: 'agent', id: ids.mirror })
    expect(m.edges.find((e) => e.id === `${mirror}.writes>database:${ids.handoff}.writes`)?.can).toBeUndefined()
    // the net-flag pair „Mails · Weiterleiten“: Inbox-Helfer → § 03 flag · § 01 flag → An Team-Chat
    expect(m.nets).toHaveLength(1)
    const toChat = keyOf({ kind: 'automation', db: ids.mails, id: ids.toChat })
    expect(m.nets[0]).toEqual({ key: net, place: { db: ids.mails, prop: ids.forward }, writers: [`${helper}.writes>${net}`], listeners: [`${net}>${toChat}.start`] })
    // the single-use script is folded into „Neue Mail → Kontakt“ and writes Kontakte from there
    const toContact = keyOf({ kind: 'automation', db: ids.mails, id: ids.toContact })
    expect(m.modules.find((x) => x.key === toContact)?.folds).toEqual({ script: ids.contact })
    expect(m.modules.some((x) => x.key === keyOf({ kind: 'script', id: ids.contact }))).toBe(false)
    expect(edgesFrom(m, toContact).map((e) => e.to)).toEqual([`database:${ids.kontakte}.writes`])
    // Mails · new row: from outside (hatched) into both listeners; the webhook leaves An Team-Chat
    const rows = keyOf({ kind: 'rowTrigger', db: ids.mails, event: 'created', prop: null })
    expect(m.modules.find((x) => x.key === rows)?.tags).toContain('outside')
    expect(edgesFrom(m, rows).map((e) => [e.to, e.outside])).toEqual([[`${helper}.start`, true], [`${toContact}.start`, true]])
    expect(edgesFrom(m, toChat).map((e) => e.to)).toEqual(['outbound:webhook:chat.example:POST.out'])
    expect(m.modules.find((x) => x.key === 'outbound:webhook:chat.example:POST')?.tags).toEqual(['outbound'])
    expect(m.modules.find((x) => x.key === 'outbound:git:-:pr')?.tags).toEqual(['afterApproval'])
    // tracker: READ 3 (declared by IN-01: no "?"), WRITE? 4 (guessed), only READ plugged; IN-01 tags it
    const tracker = m.modules.find((x) => x.key === keyOf({ kind: 'server', id: ids.tracker, name: 'tracker' }))!
    expect(tracker.outJacks.map((j) => [j.role, j.count, !!j.guessed, j.plugged])).toEqual([
      ['read', 3, false, true],
      ['write', 4, true, false],
    ])
    expect(tracker.profile).toBe('in-01')
    // the mirror: 2U (three out jacks), knobs read-only, IN-01's tag on it and its database
    const mm = m.modules.find((x) => x.key === mirror)!
    expect([mm.u, mm.knobs, mm.profile, mm.outJacks.map((j) => j.role)]).toEqual([2, { model: null, budgetUsd: 0.4 }, 'in-01', ['writes', 'report', 'notes']])
    expect(m.modules.find((x) => x.key === `database:${ids.handoff}`)?.profile).toBe('in-01')
    expect(m.modules.find((x) => x.key === helper)?.u).toBe(1)
    // "EVERYTHING · 4 DB" — one cable, never one per database
    expect(m.modules.find((x) => x.key === helper)?.outJacks.find((j) => j.role === 'everything')?.count).toBe(4)
    // the flow behind the drawing (chains.ts walks it): Inbox-Helfer may write everything; two start on a new mail
    expect(m.flow?.writes[helper]?.map((x) => x.place)).toContainEqual({ everything: true })
    expect(m.flow?.listens[`${ids.mails}:+row`]?.map((l) => l.module)).toEqual([helper, toContact])
    // nothing unknown; the chains behind it are B3's (patchbay-chains.spec), the one fuse B4's (patchbay-fuses.spec)
    expect(m.unknown).toEqual([])
    expect(m.fuses.map((f) => [f.label, f.at])).toEqual([['F1', `${toChat}.out>outbound:webhook:chat.example:POST.out`]])
    expect(m.chains.map((c) => c.exit?.module)).toEqual(['outbound:webhook:chat.example:POST', 'outbound:git:-:pr'])
  })

  test('deterministic: the same world gives the same rack, keys only (no titles in the model)', () => {
    const a = modelOf(mock1())
    const b = modelOf(mock1())
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    for (const t of ['Inbox-Helfer', 'Tessera-Spiegel', 'An Team-Chat', 'Tessera Handoff', 'Wochenbericht', 'Kontakt anlegen', 'Weiterleiten']) expect(JSON.stringify(a)).not.toContain(t)
  })
})

test.describe('B2 · wide reach — "Whole workspace" and bus chips (§1.19)', () => {
  test('an everything agent in 40 databases has ≤ 4 out cables; a named scope of 9 → 6 cables + "+3"', () => {
    const wide = modelOf(wideScope(40))
    const agentKey = keyOf({ kind: 'agent', id: 'agNordlicht' })
    const out = edgesFrom(wide, agentKey)
    expect(out.length).toBeLessThanOrEqual(4)
    expect(out.map((e) => e.to)).toEqual(['everything:all.writes', 'net:dbNord01:dbNord01Flag', 'page:pgNordlichtReport.writes'])
    expect(wide.buses).toEqual([])
    const named = modelOf(wideScope(40, { named: 9 }))
    const cables = edgesFrom(named, agentKey).filter((e) => e.to.startsWith('database:'))
    expect(cables).toHaveLength(9)
    expect(cables.filter((e) => !e.bundle)).toHaveLength(6)
    expect(named.buses).toHaveLength(1)
    expect(named.buses[0]).toMatchObject({ jack: `${agentKey}.writes`, col: 3 })
    expect(named.buses[0].edges).toEqual(cables.slice(6).map((e) => e.id))
    // bundled cables still count
    expect(named.counts.cables).toBe(named.edges.length)
  })
})

test.describe('B2 · tool groups — tools.ts (§1.5)', () => {
  test('heuristic reads, declared reads (neutral names only), OUT subtracted, untested, residual risk', () => {
    const plain = toolGroups(TRACKER_TOOLS, [])
    expect([plain.tested, plain.read, plain.write, plain.guessedRead, plain.guessedWrite]).toEqual([true, ['query_issues', 'get_issue', 'whoami'], ['create_issue', 'update_issue', 'add_comment', 'post_status'], true, true])
    // a wildcard profile declares a write tool and a neutral one as reads: a declaration only confirms a name that reads
    // as one (fix rest — a READ word, no write or send word); both stay WRITE?, marked
    const wild = toolGroups(['issue_digest', 'create_issue', 'get_issue'], [], [{ id: 'wild', reads: ['issue_digest', 'create_issue'] }])
    expect([wild.read, wild.write, wild.declared, wild.guessedRead]).toEqual([['get_issue'], ['issue_digest', 'create_issue'], { issue_digest: ['wild'], create_issue: ['wild'] }, true])
    const declaredOnly = toolGroups(['get_issue'], [], [{ id: 'wild', reads: ['get_issue'] }])
    expect([declaredOnly.read, declaredOnly.guessedRead]).toEqual([['get_issue'], false])
    // sending names never become reads by a declaration (forward / share / notify / webhook …)
    const send = toolGroups(['list_items', 'forward_email', 'share_document', 'notify_channel', 'list_and_forward'], [], [{ id: 'in-02', reads: ['list_items', 'forward_email', 'share_document', 'notify_channel', 'list_and_forward'] }])
    expect([send.read, send.write, send.declared]).toEqual([['list_items', 'list_and_forward'], ['forward_email', 'share_document', 'notify_channel'], { forward_email: ['in-02'], share_document: ['in-02'], notify_channel: ['in-02'] }])
    // … a reading name with a send word keeps the heuristic's "?" (the declaration does not confirm it)
    expect(send.guessedRead).toBe(true)
    // OUT is never a read or a write: it is locked
    const out = toolGroups(TRACKER_TOOLS, ['post_status'])
    expect([out.write.includes('post_status'), out.out]).toEqual([false, ['post_status']])
    // never tested: nothing known
    expect(toolGroups(null, [])).toMatchObject({ tested: false, read: [], write: [] })
    // read tools that may carry data out
    expect(toolGroups(['search_web', 'fetch_url', 'get_issue', 'list_items'], []).residual).toEqual(['search_web', 'fetch_url'])
  })

  test('what a processor may call: no allow-list = every tool, [] = left out, an untested server without a list fails closed', () => {
    const g = toolGroups(TRACKER_TOOLS, ['post_status'])
    expect(toolUse(g, undefined)).toEqual({ leftOut: false, read: ['query_issues', 'get_issue', 'whoami'], write: ['create_issue', 'update_issue', 'add_comment'], failClosed: false })
    expect(toolUse(g, ['get_issue', 'post_status'])).toEqual({ leftOut: false, read: ['get_issue'], write: [], failClosed: false })
    expect(toolUse(g, []).leftOut).toBe(true)
    const untested = toolGroups(undefined, [])
    expect(toolUse(untested, undefined)).toEqual({ leftOut: false, read: null, write: null, failClosed: true })
    // an allow-list on an untested server is classed by name: only read names keep the write cable away
    expect(toolUse(untested, ['list_items'])).toEqual({ leftOut: false, read: ['list_items'], write: [], failClosed: false })
    expect(toolUse(untested, ['list_items', 'create_item']).write).toEqual(['create_item'])
  })

  test('on the rack: a declared write tool stays WRITE? (marked), an attached untested server without a list is cabled fail-closed', () => {
    const w = mock1()
    // a wildcard profile (every *.example server) declares a write tool a read: it stays WRITE?, marked
    w.ws.integrations = [...(w.ws.integrations ?? []), profile('wild', { match: { host: '*.example' }, reads: ['create_issue'] })]
    const tracker = modelOf(w).modules.find((x) => x.key === keyOf({ kind: 'server', id: w.ids.tracker, name: 'tracker' }))!
    expect(tracker.outJacks.find((j) => j.role === 'write')).toMatchObject({ count: 4, declaredRead: ['create_issue'] })
    const ex = exits()
    const m = modelOf(ex)
    const gamma = keyOf({ kind: 'server', id: ex.ids.gamma, name: 'gamma' })
    const toApply = m.edges.filter((e) => e.from.startsWith(`${gamma}.`))
    expect(toApply.map((e) => [e.kind, e.to, !!e.failClosed])).toEqual([
      ['reads', `${keyOf({ kind: 'agent', id: ex.ids.agentApply })}.tools`, false],
      ['out', `${keyOf({ kind: 'agent', id: ex.ids.agentApply })}.tools`, true],
    ])
    expect(m.modules.find((x) => x.key === gamma)?.outJacks.map((j) => [j.role, j.count, j.guessed])).toEqual([
      ['read', undefined, true],
      ['write', undefined, true],
    ])
    // OUT tools: a third jack, never cabled
    const alpha = m.modules.find((x) => x.key === keyOf({ kind: 'server', id: ex.ids.alpha, name: 'alpha' }))!
    expect(alpha.outJacks.find((j) => j.role === 'out')).toMatchObject({ count: 1, plugged: false })
  })
})

/** A world with one agent `a` (team or local) and the tracker server set up here. */
function oneAgent(a: CustomAgent, device: Partial<PbWorld['device']> = {}, lazy: Partial<PbWorld['lazy']> = {}): PbWorld {
  return world({
    pages: [pbDbPage('dbTessera', 'Tessera')],
    databases: [pbDatabase('dbTessera', [prop('pTesseraState', 'Status', 'text')])],
    agents: [a],
    servers: [server('srvTracker', 'tracker', { tools: [...TRACKER_TOOLS], checkedAt: 1 })],
    device,
    // team hooks are read by owners / admins only: the cases here say they hold none
    lazy: device.ctx?.team ? { hooks: [], tokens: [], ...lazy } : lazy,
  })
}
const TEAM = (me: string) => ({ ctx: { team: true, me, role: 'member' as const, readOnly: false, supports: ['ai', 'governor'] } })

test.describe('B2 · agents and this device — what is known here (§1.3, §1.21)', () => {
  const base = pbAgent('agTessera', 'Tessera-Leser', { write: 'apply', scope: { everything: false, pages: [], databases: ['dbTessera'] }, mcpServers: ['tracker'], createdBy: 'acMara', updatedBy: 'acMara' })
  const key = keyOf({ kind: 'agent', id: 'agTessera' })

  test('another member’s browser agent: its servers are unknown here — an unknown part, no server cable', () => {
    const m = modelOf(oneAgent(base, TEAM('acNordlicht')))
    expect(m.unknown).toEqual([{ key: `otherBrowser:${key}`, what: 'otherBrowser', module: key, who: 'acMara' }])
    expect(edgesInto(m, key).filter((e) => e.kind === 'reads' || e.kind === 'out')).toEqual([])
    expect(m.modules.find((x) => x.key === key)).toMatchObject({ blocked: 'notHere' })
    expect(m.modules.find((x) => x.key === key)?.tags).toContain('unknownHere')
  })

  test('on the creator’s device an agent another member changed is evaluated (and tagged: waits for its creator)', () => {
    const m = modelOf(oneAgent({ ...base, updatedBy: 'acTessera' }, TEAM('acMara')))
    expect(m.unknown).toEqual([])
    expect(m.modules.find((x) => x.key === key)?.tags).toContain('awaitsConfirm')
    expect(edgesInto(m, key).map((e) => e.kind).sort()).toEqual(['out', 'reads'])
  })

  test('switched off: no trigger cable, tagged "runs only by hand" — its wiring stays', () => {
    const m = modelOf(oneAgent({ ...base, enabled: false, trigger: { type: 'row_created', databaseId: 'dbTessera' } }))
    expect(m.modules.find((x) => x.key === key)?.tags).toEqual(expect.arrayContaining(['disabled', 'handRunOnly']))
    expect(edgesInto(m, key).some((e) => e.kind === 'starts')).toBe(false)
    expect(edgesFrom(m, key).length).toBeGreaterThan(0)
    expect(m.flow?.listens['dbTessera:+row']).toBeUndefined()
  })

  test('fields this build cannot read → an unknown part; a route it cannot run → blocked', () => {
    const unreadable = modelOf(oneAgent({ ...base, route: [{ p: 'futurecorp', m: 'x' }] as unknown as CustomAgent['route'] }))
    expect(unreadable.unknown.map((u) => u.what)).toEqual(['unreadable'])
    expect(unreadable.modules.find((x) => x.key === key)).toMatchObject({ blocked: 'unreadable' })
    const blocked = modelOf(oneAgent({ ...base, route: [{ p: 'openrouter', m: 'nordlicht/tessera-mini' }] }))
    expect(blocked.unknown).toEqual([])
    expect(blocked.modules.find((x) => x.key === key)).toMatchObject({ blocked: 'route' })
    expect(blocked.modules.find((x) => x.key === key)?.tags).toContain('blocked')
  })

  test('a server agent uses the runtime’s servers ("on the server"); a runtime it may not read, or not read yet, is unknown', () => {
    const srv = { ...base, runner: 'server' as const, createdBy: 'acMara' }
    const m = modelOf(oneAgent(srv, TEAM('acNordlicht'), { runtime: [{ name: 'tracker', host: 'tracker.example' }] }))
    const rt = keyOf({ kind: 'server', id: null, name: 'tracker', runtime: true })
    expect(m.modules.find((x) => x.key === rt)?.tags).toContain('server')
    // its tools as this device knows them (the server at the same host): READ and WRITE? cables
    expect(edgesFrom(m, rt).map((e) => e.kind).sort()).toEqual(['out', 'reads'])
    expect(m.unknown).toEqual([])
    expect(modelOf(oneAgent(srv, TEAM('acNordlicht'), { runtime: 'forbidden' })).unknown.map((u) => u.what)).toEqual(['runtime'])
    expect(modelOf(oneAgent(srv, TEAM('acNordlicht'))).unknown.map((u) => u.what)).toEqual(['lazy'])
  })

  test('a server agent with a webhook trigger: an incoming source, from outside, cabled straight to it', () => {
    const m = modelOf(oneAgent({ ...base, runner: 'server', trigger: { type: 'webhook' }, mcpServers: [] }, TEAM('acMara'), { hooks: [], tokens: [] }))
    const src = keyOf({ kind: 'incoming', hook: null, db: null, agent: 'agTessera' })
    expect(m.modules.find((x) => x.key === src)?.tags).toEqual(['outside', 'server'])
    expect(edgesFrom(m, src)).toMatchObject([{ kind: 'starts', to: `${key}.start`, outside: true }])
  })
})

test.describe('B2 · sources, relays and ways out (§1.4, §1.15)', () => {
  test('a repeating template clock writes new rows: a `+row` net where something listens, else the database', () => {
    const repeat = { freq: 'weekly', days: [1], time: '09:00', start: '2026-10-12', title: '{{name}}', dateProperty: null, lastRunAt: 5 } as unknown as NonNullable<NonNullable<Database['templates']>[number]['repeat']>
    const tpl = [{ id: 'tplWeekly', name: 'Woche', content: null, properties: {}, repeat }] as Database['templates']
    const listened = world({
      pages: [pbDbPage('dbLaunch', 'Launch plan')],
      databases: [pbDatabase('dbLaunch', [], { templates: tpl, automations: [pbAutomation('autNew', 'Neu → Hook', { type: 'row_created' }, [{ type: 'webhook', url: 'https://launch.example/new', method: 'POST' }])] })],
    })
    const m = modelOf(listened)
    const clock = keyOf({ kind: 'clock', schedule: '', agents: [], template: { db: 'dbLaunch', id: 'tplWeekly' } })
    expect(m.nets.map((n) => n.key)).toEqual(['net:dbLaunch:+row'])
    expect(edgesFrom(m, clock).map((e) => e.to)).toEqual(['net:dbLaunch:+row'])
    expect(m.edges.find((e) => e.from === 'net:dbLaunch:+row')?.to).toBe(`${keyOf({ kind: 'automation', db: 'dbLaunch', id: 'autNew' })}.start`)
    const alone = world({ pages: [pbDbPage('dbLaunch', 'Launch plan')], databases: [pbDatabase('dbLaunch', [], { templates: tpl })] })
    expect(edgesFrom(modelOf(alone), clock).map((e) => e.to)).toEqual(['database:dbLaunch.writes'])
  })

  test('autofill listens to any change of its row ((db, *)), a translation only to its source; a kit value relay starts on any change', () => {
    const m = modelOf(exits())
    const af = keyOf({ kind: 'autofill', db: 'dbLeads', prop: 'pLeadSummary' })
    expect(m.flow?.listens['dbLeads:*']?.map((l) => l.module)).toEqual([af])
    const tr = world({
      pages: [pbDbPage('dbTessera', 'Tessera')],
      databases: [pbDatabase('dbTessera', [prop('pTesseraEn', 'English', 'text', { autofill: { preset: 'translate', language: 'English', source: 'pTesseraDe', auto: true } }), prop('pTesseraDe', 'Deutsch', 'text')])],
    })
    expect(Object.keys(modelOf(tr).flow?.listens ?? {})).toEqual(['dbTessera:pTesseraDe'])
    const r = modelOf(relays())
    const kit = keyOf({ kind: 'kit', db: 'dbTessera', prop: 'pTesseraPunkte', type: 'ptPunkte' })
    expect(m.modules.length && r.modules.find((x) => x.key === kit)?.col).toBe(2)
    // the server agent's write (remote everywhere) starts no automation — only the relay, whose write does
    expect(edgesInto(r, kit)).toMatchObject([{ kind: 'relay', from: 'net:dbTessera:*' }])
    expect(r.nets.find((n) => n.key === 'net:dbTessera:*')?.writers).toEqual([`${keyOf({ kind: 'agent', id: 'agTesseraServer' })}.writes>net:dbTessera:*`])
    expect(edgesFrom(r, kit).map((e) => e.to)).toEqual(['net:dbTessera:pTesseraPunkte'])
    expect(r.edges.find((e) => e.from === 'net:dbTessera:pTesseraPunkte')?.to).toBe(`${keyOf({ kind: 'automation', db: 'dbTessera', id: 'autPunkte' })}.start`)
    // agent → automation → agent: set_property starts agent B's row trigger; agent A's write never starts B directly
    const a = keyOf({ kind: 'agent', id: 'agLaunchA' })
    const b = keyOf({ kind: 'agent', id: 'agLaunchB' })
    expect(edgesFrom(r, a).some((e) => e.to === 'net:dbLaunch:pLaunchFreigabe')).toBe(false)
    expect(r.nets.find((n) => n.key === 'net:dbLaunch:pLaunchFreigabe')?.writers).toEqual([`${keyOf({ kind: 'automation', db: 'dbLaunch', id: 'autFreigabe' })}.writes>net:dbLaunch:pLaunchFreigabe`])
    expect(r.edges.find((e) => e.from === 'net:dbLaunch:pLaunchFreigabe')?.to).toBe(`${b}.start`)
  })

  test('ways out: the Outbox by hand, git per action (commit stays local), script effects ask first, buttons and commands by hand', () => {
    const ex = exits()
    const m = modelOf(ex)
    const tagsOf = (k: string) => m.modules.find((x) => x.key === k)?.tags
    expect(tagsOf('outbox:alpha:reply')).toEqual(['byHand'])
    expect(m.modules.find((x) => x.key === 'outbox:alpha:reply')?.nets).toEqual([{ place: { external: 'alpha' } }])
    expect(m.modules.some((x) => x.key === 'outbound:git:-:commit')).toBe(false)
    // approvals "none" on this device: the push is unattended; a gate the approvals stop at before it: after approval —
    // the stages decide, not the level alone (fix model: this pipeline has no gate at all, so "review" passes too); a
    // team's Confirm is the chains' part (who wrote the task), the drawing follows this device's approvals
    expect(tagsOf('outbound:git:-:push')).toEqual(['outbound'])
    const review = { ...ex, device: { ...ex.device, worker: { ...ex.device.worker, approvals: 'review' as const } } }
    expect(modelOf(review).modules.find((x) => x.key === 'outbound:git:-:push')?.tags).toEqual(['outbound'])
    const gated = structuredClone(review)
    gated.ws.databases.dbExCoding = { ...gated.ws.databases.dbExCoding, pipeline: [{ id: 'exQueue', kind: 'queue', auto: true }, { id: 'exGate', kind: 'gate', auto: false }, { id: 'exPush', kind: 'git', auto: true, gitAction: 'push' }] }
    expect(modelOf(gated).modules.find((x) => x.key === 'outbound:git:-:push')?.tags).toEqual(['afterApproval'])
    const team = { ...ex, device: { ...ex.device, ctx: { ...ex.device.ctx, team: true, me: 'acMara' }, worker: { ...ex.device.worker, approvals: 'none' as const } }, lazy: { ...ex.lazy, hooks: [], tokens: [] } }
    expect(modelOf(team).modules.find((x) => x.key === 'outbound:git:-:push')?.tags).toEqual(['outbound'])
    expect(tagsOf('outbound:http:-:POST')).toEqual(['asksFirst'])
    expect(tagsOf('outbound:mail:-:-')).toEqual(['asksFirst'])
    expect(tagsOf('outbound:webhook:button.example:POST')).toEqual(['byHand'])
    expect(tagsOf('outbound:webhook:cmd.example:PUT')).toEqual(['byHand'])
    // a form posting to a webhook is a note on its database, never a source or a way out
    expect(inputOf(ex).databases.find((d) => d.id === 'dbLeads')?.formHooks).toBe(1)
    expect(m.modules.some((x) => x.key.includes('forms.example'))).toBe(false)
  })

  test('the bridge by its mode, this device’s GitHub sync (source + push), Clippings', () => {
    const ex = exits()
    const bridgeKey = keyOf({ kind: 'bridge' })
    const by = (mode: 'apply' | 'ask' | 'read') => modelOf({ ...ex, device: { ...ex.device, bridge: { enabled: true, mode } } })
    expect(edgesFrom(by('apply'), bridgeKey).find((e) => e.to === 'everything:all.writes')).toMatchObject({ can: true })
    expect(edgesFrom(by('ask'), bridgeKey).find((e) => e.to === 'everything:all.writes')).toMatchObject({ can: true, asksFirst: true })
    expect(edgesFrom(by('read'), bridgeKey)).toEqual([])
    expect(by('read').modules.find((x) => x.key === bridgeKey)?.tags).toContain('readonly')
    expect(modelOf({ ...ex, device: { ...ex.device, bridge: { enabled: false, mode: 'apply' } } }).modules.some((x) => x.key === bridgeKey)).toBe(false)
    const m = modelOf(ex)
    expect(m.modules.find((x) => x.key === 'sync:github')?.tags).toEqual(['outside', 'thisDevice'])
    expect(edgesFrom(m, 'sync:github').map((e) => [e.to, !!e.outside])).toEqual([
      ['everything:all.writes', true],
      ['outbound:sync:nordlicht%2Fnotes:push.out', false],
    ])
    const clip = world({ pages: [pbPage('inbxNordlicht', { title: 'Inbox' })], lazy: { inbox: 'inbxNordlicht' } })
    const cm = modelOf(clip)
    expect(cm.modules.find((x) => x.key === 'clippings:inbxNordlicht')?.tags).toEqual(['outside'])
    expect(cm.edges).toMatchObject([{ from: 'clippings:inbxNordlicht.writes', to: 'page:inbxNordlicht.writes', outside: true }])
  })

  test('the generators: bigPatchbay(60) is about 60 modules and 120 cables', () => {
    const big = modelOf(bigPatchbay(60))
    expect(big.counts.modules + big.counts.idle).toBeGreaterThanOrEqual(55)
    expect(big.counts.modules + big.counts.idle).toBeLessThanOrEqual(70)
    expect(big.counts.cables).toBeGreaterThanOrEqual(110)
    expect(big.counts.cables).toBeLessThanOrEqual(140)
  })
})

test.describe('B2 · the script scan and the button index (scripts.ts, buttons.ts)', () => {
  test('refs become reads, write members writes; page.current is the caller’s place; by-name refs and effects are named', () => {
    const scan = (code: string) => scanScript({ code, updatedAt: 7 }, NODE_ENGINE)
    expect(scan('let offen = db(@[Tessera Handoff](p:dbHandoff)).count\n@[Bericht](p:pgBericht).append("x")')).toEqual({ at: 7, reads: [{ page: 'dbHandoff' }], writes: [{ page: 'pgBericht' }], effects: [], byName: false })
    expect(scan('db(@[Kontakte](p:dbKontakte)).add(page.current.title, Quelle: "Mail")')).toMatchObject({ writes: [{ db: 'dbKontakte', prop: '+row' }], byName: false })
    expect(scan('page.current.set(Status: "fertig")')).toMatchObject({ writes: [], context: true })
    expect(scan('for r in db(@[Launch plan](p:dbLaunch)) { r.set(Phase: "2") }')).toMatchObject({ writes: [{ db: 'dbLaunch', prop: '*' }] })
    expect(scan('let t = db(@[Tessera](p:dbTessera))\nt.add("neu")')).toMatchObject({ writes: [{ db: 'dbTessera', prop: '+row' }] })
    expect(scan('db("Tessera").add("x")')).toMatchObject({ byName: true, writes: [] })
    expect(scan('http.post("https://script.example/in", { a: 1 })\nmail.send(to: "mara.lind@nordlicht.example", subject: "x", body: "y")')?.effects).toEqual(['mail', 'http'])
    expect(scan('let x = (')).toBeNull()
  })

  test('only buttons that run something count; the index reads a page again only when its contentRev moved', () => {
    const doc = docOf(
      buttonNode('b1', 'Run', [{ id: 'a', type: 'run_script', scriptId: 'scWeekly' }, { id: 'b', type: 'message', text: 'hi' }]),
      buttonNode('b2', 'Log', [{ id: 'c', type: 'insert_blocks', content: [] }]),
      { type: 'columns', content: [{ type: 'column', content: [buttonNode('b3', 'Ping', [{ id: 'd', type: 'webhook', url: 'https://button.example/x', method: 'PUT' }, { id: 'e', type: 'add_page', databaseId: 'dbLaunch' }])] }] },
    )
    expect(buttonsIn('pgNotes', doc)).toEqual([
      { page: 'pgNotes', block: 'b1', actions: [{ type: 'run_script', scriptId: 'scWeekly' }] },
      { page: 'pgNotes', block: 'b3', actions: [{ type: 'webhook', host: 'button.example', method: 'PUT' }, { type: 'add_page', target: 'dbLaunch' }] },
    ])
    const pages: Record<ID, Page> = { pgNotes: pbPage('pgNotes', { content: doc as Page['content'], contentRev: 1 }), pgPlain: pbPage('pgPlain', { content: docOf() as Page['content'] }) }
    const idx = new ButtonIndex()
    idx.begin(Object.keys(pages))
    expect(idx.list()).toBeNull()
    expect(idx.step(pages)).toBe(true)
    const first = idx.list()
    expect(first).toHaveLength(2)
    // the same revision: nothing read, the same list
    expect(idx.update({ ...pages, pgNotes: { ...pages.pgNotes, title: 'Renamed' } }, ['pgNotes'])).toBe(false)
    expect(idx.list()).toBe(first)
    // a new revision without buttons: gone
    expect(idx.update({ ...pages, pgNotes: { ...pages.pgNotes, content: docOf() as Page['content'], contentRev: 2 } }, ['pgNotes'])).toBe(true)
    expect(idx.list()).toEqual([])
  })
})

test.describe('B2 · the wiring signature — source.ts memo (§1.2, §6 A21)', () => {
  test('typing, an automation’s lastRunAt, autofill fills and a repeating lastRunAt rebuild nothing; a renamed watched field rebuilds once', () => {
    const w = mock1()
    const memo = memoOf(w)
    const src = sourceOf(w)
    const first = memo.read(src)
    expect(memo.stats()).toEqual({ builds: 1, pageChecks: 0 })
    let ws = src.ws
    const next = (patch: Partial<typeof ws>) => {
      ws = { ...ws, ...patch }
      return memo.read({ ...src, ws, now: src.now + 1000 })
    }
    // typing in a page nothing references: no page facts read again
    const scratch = pbPage('pgScratch', { title: 'Notizen' })
    expect(next({ pages: { ...ws.pages, pgScratch: scratch } })).toBe(first)
    expect(next({ pages: { ...ws.pages, pgScratch: { ...scratch, content: docOf() as Page['content'], contentRev: 2 } } })).toBe(first)
    expect(memo.stats()).toEqual({ builds: 1, pageChecks: 0 })
    // typing in the report page (referenced): its facts are read again — the same facts, the same input
    const bericht = ws.pages[w.ids.bericht]
    expect(next({ pages: { ...ws.pages, [w.ids.bericht]: { ...bericht, contentRev: 9, updatedAt: 99 } } })).toBe(first)
    expect(memo.stats()).toEqual({ builds: 1, pageChecks: 1 })
    // bookkeeping: an automation's run, a repeating template's run, autofill fills
    const mails = ws.databases[w.ids.mails]
    expect(next({ databases: { ...ws.databases, [w.ids.mails]: { ...mails, automations: mails.automations!.map((a) => ({ ...a, lastRunAt: 123, lastStatus: 'ok' as const, lastMessage: '200' })) } } })).toBe(first)
    const repeat = { freq: 'daily', time: '08:00', start: '2026-10-01', lastRunAt: 1 } as unknown as NonNullable<NonNullable<Database['templates']>[number]['repeat']>
    const handoff = ws.databases[w.ids.handoff]
    const withAutofill = { ...handoff, properties: [...handoff.properties, prop('pHandoffSum', 'Kurz', 'text', { autofill: { preset: 'summary', auto: true, fills: {} } })], templates: [{ id: 'tplDaily', name: 'Tag', content: null, properties: {}, repeat }] } as Database
    const second = next({ databases: { ...ws.databases, [w.ids.handoff]: withAutofill } })
    expect(second).not.toBe(first)
    expect(memo.stats().builds).toBe(2)
    const withFills = { ...withAutofill, properties: withAutofill.properties.map((p) => (p.autofill ? { ...p, autofill: { ...p.autofill, fills: { r1: { at: 5, hash: 'h' } } } } : p)), templates: withAutofill.templates!.map((t) => ({ ...t, repeat: { ...t.repeat!, lastRunAt: 999 } })) }
    expect(next({ databases: { ...ws.databases, [w.ids.handoff]: withFills } })).toBe(second)
    expect(memo.stats().builds).toBe(2)
    // a property rename on a watched field: one rebuild
    const mails2 = ws.databases[w.ids.mails]
    const renamed = next({ databases: { ...ws.databases, [w.ids.mails]: { ...mails2, properties: mails2.properties.map((p) => (p.id === w.ids.forward ? { ...p, name: 'Weiterleiten an Team' } : p)) } } })
    expect(renamed).not.toBe(second)
    expect(memo.stats().builds).toBe(3)
    // a referenced page renamed: its facts changed — one rebuild
    const b2 = ws.pages[w.ids.bericht]
    expect(next({ pages: { ...ws.pages, [w.ids.bericht]: { ...b2, title: 'Wochenbericht' } } })).not.toBe(renamed)
    expect(memo.stats().builds).toBe(4)
    // the row index said nothing referenced moved: the pages are not even looked at
    const checks = memo.stats().pageChecks
    expect(memo.read({ ...src, ws: { ...ws, pages: { ...ws.pages, [w.ids.bericht]: { ...ws.pages[w.ids.bericht], updatedAt: 5 } } } }, { pagesMoved: false })).toBe(memo.read({ ...src, ws }, { pagesMoved: false }))
    expect(memo.stats().pageChecks).toBe(checks)
  })

  test('this device’s facts and the lazy readings are part of the signature', () => {
    const w = mock1()
    const memo = memoOf(w)
    const src = sourceOf(w)
    const first = memo.read(src)
    expect(memo.read({ ...src, device: { ...src.device, bridge: { enabled: false, mode: 'ask' } }, now: src.now + 5 })).toBe(first)
    expect(memo.read({ ...src, device: { ...src.device, bridge: { enabled: true, mode: 'apply' } } })).not.toBe(first)
    const third = memo.read({ ...src, device: { ...src.device, bridge: { enabled: true, mode: 'apply' } } })
    expect(memo.read({ ...src, device: { ...src.device, bridge: { enabled: true, mode: 'apply' } }, lazy: { ...src.lazy, inbox: 'inbxNew' } })).not.toBe(third)
  })

  test('the input reads the page map by id only — never a walk', () => {
    const w = mock1()
    const watch = watched(w.ws.pages)
    const src = sourceOf(w)
    const input = toModelInput({ ...src, ws: { ...src.ws, pages: watch.pages } }, nodeReaders(w)).input
    expect(watch.walks()).toBe(0)
    expect(input.databases.map((d) => d.id)).toEqual(['dbCoding', 'dbHandoff', 'dbKontakte', 'dbMails'])
    // the referenced pages only: databases, the report page, the button's page
    expect(Object.keys(input.pages).sort()).toEqual(['dbCoding', 'dbHandoff', 'dbKontakte', 'dbMails', 'pgBericht'])
  })
})

test.describe('B2 · the seed workspace — a small rack without a fuse', () => {
  test('the seeded workspace: Projects’ automation, the Meetings clock, the "Add a project" button — no fuse, nothing unknown', async ({ page }) => {
    await openApp(page)
    const state = await wsEval(page, (s) => ({ pages: s.pages, databases: s.databases, agents: s.agents ?? {}, scripts: s.scripts ?? {}, integrations: s.integrations ?? [], kit: s.kit, mcpServers: s.settings.mcpServers ?? [] }))
    const pages = state.pages as Record<ID, Page>
    const buttons = Object.values(pages).flatMap((p) => (p.content && !p.trashed ? buttonsIn(p.id, p.content) : []))
    const w = world({ pages: Object.values(pages), databases: Object.values(state.databases as Record<ID, Database>), agents: Object.values(state.agents as Record<ID, CustomAgent>), scripts: Object.values(state.scripts as Record<ID, OneScript>), integrations: state.integrations as IntegrationProfile[], kit: state.kit as Kit, servers: state.mcpServers as McpServerConfig[], lazy: { buttons } })
    const watch = watched(w.ws.pages)
    const input = toModelInput({ ...sourceOf(w), ws: { ...w.ws, pages: watch.pages } }, nodeReaders(w)).input
    expect(watch.walks()).toBe(0)
    const m = buildModel(input)
    const title = (id: ID) => pages[id]?.title
    const projects = Object.keys(pages).find((id) => pages[id].kind === 'database' && title(id) === 'Projects')!
    const meetings = Object.keys(pages).find((id) => pages[id].kind === 'database' && title(id) === 'Meetings')!
    expect(m.fuses).toEqual([])
    expect(m.unknown).toEqual([])
    expect(m.counts.dashed).toBe(0)
    expect(m.counts.modules).toBeLessThanOrEqual(8)
    expect(mods(m, 'agent')).toEqual([])
    // Status → Done: a row trigger (a person's edit) starts the automation; its notify is a toast — no cable out
    const auto = mods(m, 'automation')
    expect(auto).toHaveLength(1)
    expect(edgesInto(m, auto[0].key).map((e) => e.from)).toEqual([expect.stringMatching(new RegExp(`^rowTrigger:${projects}:changed:`))])
    expect(edgesFrom(m, auto[0].key)).toEqual([])
    // the Meetings template's clock → Meetings (nobody listens to its new rows)
    expect(m.edges.find((e) => e.from.startsWith('clock:t:'))?.to).toBe(`database:${meetings}.writes`)
    // the "Add a project" button adds a row to Projects — by hand
    expect(m.edges.filter((e) => e.from.startsWith('button:')).map((e) => [e.to, e.byHand])).toEqual([[`database:${projects}.writes`, true]])
  })
})
