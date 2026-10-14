/**
 * The Patchbay ("Schaltplan") — the pure parts, run by the Playwright runner. B1 (seams):
 *  - the #/patchbay route: parse and href (m = a module key, f = a fuse's path key, setup = a profile id; anything else
 *    is dropped), every module key round-trips through the address (lib/router.ts, features/patchbay/ref.ts);
 *  - the wiring inventory (features/patchbay/inventory.ts): what it counts on a fixture — agents, scripts, automations,
 *    own commands, repeating templates, live databases (a database in the trash, below a page in the trash, in a
 *    template or without a page never counts) — and that it never walks the page map (the pages sit behind a proxy that
 *    counts every key listing);
 *  - the seed workspace: the inventory computed here on the seeded state (pages behind the same proxy) equals what
 *    #/patchbay's readout and Workspace › Automation show in the app.
 * Every page and value is fictional.
 */
import { test, expect, openApp, wsEval } from './fixtures'
import { parseHash, routeHref } from '../../src/app/lib/router'
import { liveDatabases, wiringCount, wiringInventory, type WiringReaders } from '../../src/app/features/patchbay/inventory'
import { inventoryKeys, keyPart, kindOfKey, moduleKey, scheduleKey } from '../../src/app/features/patchbay/ref'
import { readAutomations } from '../../src/app/features/automations/read'
import type { Automation, CustomAgent, Database, DbCommand, ID, OneScript, Page } from '../../src/app/store/types'

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
