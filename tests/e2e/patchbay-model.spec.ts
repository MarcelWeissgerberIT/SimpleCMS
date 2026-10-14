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
 *    sign-off reader (B2 reads it, B9 fills it);
 *  - the device stores' wipe: `cloud:<ws>` takes every member's scope of that workspace along (cache.ts, run in a
 *    browser — bundled here with Vite's build API, nothing of the app involved).
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
    const ro = (k: string) => page.getByTestId(`patchbay-ro-${k}`)
    await expect(ro('agents')).toHaveText(String(inv.agents.length))
    await expect(ro('scripts')).toHaveText(String(inv.scripts.length))
    await expect(ro('automations')).toHaveText(String(inv.automations.length))
    await expect(ro('commands')).toHaveText(String(inv.commands.length))
    await expect(ro('repeating')).toHaveText(String(inv.repeating.length))
    await expect(ro('databases')).toHaveText(String(inv.databases.length))

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
    // B1: reads none as allowed (every fuse stays open) — the same answer every time, so B2's memo keeps its reference
    const stored = { ['a'.repeat(64)]: { sig: 'b'.repeat(64), parts: { a: 'c'.repeat(16) }, at: 1, updatedBy: null } }
    expect(signoffs.sanitizeFuseSignoffs(stored)).toEqual({})
    expect(signoffs.sanitizeFuseSignoffs(undefined)).toBe(signoffs.sanitizeFuseSignoffs(stored))
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
