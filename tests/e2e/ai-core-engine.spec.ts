/**
 * Multi-provider AI, slice 2 — the core's pure parts in Node (no browser): what a provider may receive (allowedFor, the
 * presets, the generation a rule needs, what a backup would loosen), redaction (src/shared/ai/redact.ts), purposes'
 * needs / may and the selection's provenance, and the route resolution (levels, routability, filters, the Jev Router's
 * pool). Test data is fictional.
 */
import './helpers/noNet'
import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { AI_POLICY_GEN, DATA_CLASSES, MEMBER_CLASSES, PRESETS, SHARED_CLASSES, allowedClasses, allowedFor, carryOver, loosens, policyKnown, presetOf, redactionFor, refusedClasses, requiredGen, sanitizeDeviceAI, seesEverything } from '../../src/shared/ai/policy'
import { chartFate, createRedactor, currentRedactor, redactDoc, redactPersonValue, withRedaction, type RedactNode } from '../../src/shared/ai/redact'
import { JEV_ROUTER } from '../../src/shared/ai/jev'
import { OWNER } from '../../src/shared/ai/owner'
import type { Caps, DeviceAI, ModelInfo, Route, ShortlistRow, WorkspaceAI } from '../../src/shared/ai/types'
import { MODELS, modelRow } from '../../src/shared/ai/models'
import { fieldLine } from '../../src/app/editor/workitem/markdown'
import { PAGE_DERIVED, PURPOSES, UNKNOWN_PURPOSE } from '../../src/app/features/ai/core/purposes'
import { classesOf, type SourceWorld } from '../../src/app/features/ai/core/sources'
import { backstop, resolveRoute, type ResolveInput, type RouteWorld } from '../../src/app/features/ai/core/resolve'
import { ROUTABLE } from '../../src/app/features/ai/core/routable'
import { routerView, shortlistInfo } from '../../src/app/features/ai/core/pool'
import type { Database, Page } from '../../src/app/store/types'
import { cleanMeta } from '../../src/app/features/recorder/journal/runs'

const OR = 'openrouter' as const
const CL = 'anthropic' as const
const ws = (providers: NonNullable<WorkspaceAI['policy']>['providers'], extra: Partial<WorkspaceAI> = {}): WorkspaceAI => ({ policy: { providers, restricted: [] }, ...extra })

test.describe('what a provider may receive (allowedFor)', () => {
  test('absent rules: Claude every class, OpenRouter / OpenAI none', () => {
    for (const c of DATA_CLASSES) {
      expect(allowedFor(CL, c, null, null)).toBe(true)
      expect(allowedFor(OR, c, null, null)).toBe(false)
      expect(allowedFor('openai', c, undefined, undefined)).toBe(false)
    }
    expect(seesEverything(CL, null, null)).toBe(true)
    expect(seesEverything(OR, null, null)).toBe(false)
    expect(allowedClasses(OR, null, null)).toEqual([])
  })

  test('shared classes come from the workspace; a device narrow beats them', () => {
    const w = ws({ openrouter: { allow: [...PRESETS.work] } })
    expect(allowedFor(OR, 'page', w, null)).toBe(true)
    expect(allowedFor(OR, 'people', w, null)).toBe(false)
    expect(allowedFor(OR, 'page', w, { narrow: { openrouter: ['page'] } })).toBe(false)
    // a Claude rule of the workspace limits Claude; without one Claude sees every shared class
    const c = ws({ anthropic: { allow: [...PRESETS.work] } })
    expect(allowedFor(CL, 'people', c, null)).toBe(false)
    expect(allowedFor(CL, 'page', c, null)).toBe(true)
    expect(allowedFor(CL, 'people', ws({ openrouter: { allow: ['public'] } }), null)).toBe(true)
    expect(allowedFor(CL, 'people', null, { narrow: { anthropic: ['people'] } })).toBe(false)
  })

  test('member classes: only the member opens them on their device; a workspace allow alone never; forbid and narrow beat the device allow', () => {
    expect(OWNER.memberClassesOwnedByMember).toBe(true)
    // the workspace cannot even store a member class in an allow list — and reading one in does not open it
    const w = { policy: { providers: { openrouter: { allow: ['public', 'selection', 'mail'] as never } }, restricted: [] } } as WorkspaceAI
    expect(allowedFor(OR, 'mail', w, null)).toBe(false)
    const dev: DeviceAI = { allow: { openrouter: ['mail', 'memory'] } }
    expect(allowedFor(OR, 'mail', null, dev)).toBe(true)
    expect(allowedFor(OR, 'private', null, dev)).toBe(false)
    expect(allowedFor(OR, 'mail', ws({ openrouter: { allow: ['public'], forbid: ['mail'] } }), dev)).toBe(false)
    expect(allowedFor(OR, 'mail', null, { ...dev, narrow: { openrouter: ['mail'] } })).toBe(false)
    // Claude: member classes as before (every one), unless forbidden or narrowed
    expect(allowedFor(CL, 'private', ws({ anthropic: { allow: ['public'] } }), null)).toBe(true)
    expect(allowedFor(CL, 'private', ws({ anthropic: { allow: [...SHARED_CLASSES], forbid: ['private'] } }), null)).toBe(false)
    expect(allowedFor(CL, 'memory', null, { narrow: { anthropic: ['memory'] } })).toBe(false)
  })

  test('refused / carry-over / redaction read the same rule', () => {
    const w = ws({ openrouter: { allow: [...PRESETS.marked] } })
    expect(refusedClasses(OR, ['selection', 'page', 'mail', 'selection'], w, null)).toEqual(['page', 'mail'])
    expect(carryOver(['selection', 'people'], OR, w, null)).toEqual(['people'])
    expect(redactionFor(OR, w, null)).toEqual({ people: true, transcript: true })
    expect(redactionFor(OR, ws({ openrouter: { allow: [...PRESETS.all] } }), null)).toEqual({ people: false, transcript: false })
    expect(redactionFor(CL, null, null)).toEqual({ people: false, transcript: false })
    // all shared classes but no member allow: not everything (member pages are filtered)
    expect(seesEverything(OR, ws({ openrouter: { allow: [...PRESETS.all] } }), null)).toBe(false)
    expect(seesEverything(OR, ws({ openrouter: { allow: [...PRESETS.all] } }), { allow: { openrouter: [...MEMBER_CLASSES] } })).toBe(true)
  })

  test('presets: shared classes only; a list names its preset', () => {
    expect(PRESETS.all).toEqual(SHARED_CLASSES)
    expect(PRESETS.work).toEqual(['public', 'structure', 'selection', 'page', 'rows', 'files', 'workspace'])
    expect(PRESETS.marked).toEqual(['public', 'structure', 'selection'])
    for (const id of ['all', 'work', 'marked'] as const) {
      expect(PRESETS[id].every((c) => (SHARED_CLASSES as readonly string[]).includes(c))).toBe(true)
      expect(presetOf([...PRESETS[id]].reverse())).toBe(id)
    }
    expect(presetOf([])).toBe('none')
    expect(presetOf(undefined)).toBe('none')
    expect(presetOf(['public', 'page'])).toBe('custom')
  })
})

test.describe('the policy generation a rule needs', () => {
  test('2 only for rules that limit Claude; OpenRouter-only rules and router pins need 1', () => {
    expect(requiredGen(null, null)).toBe(1)
    expect(requiredGen(null, { narrow: { anthropic: ['people'] } })).toBe(2)
    expect(requiredGen(ws({ anthropic: { allow: [...PRESETS.work] } }), null)).toBe(2)
    expect(requiredGen(ws({ anthropic: { allow: [...SHARED_CLASSES], forbid: ['mail'] } }), null)).toBe(2)
    // a Claude entry that still allows every shared class and forbids nothing limits nothing
    expect(requiredGen(ws({ anthropic: { allow: [...SHARED_CLASSES] } }), null)).toBe(1)
    expect(requiredGen(ws({ openrouter: { allow: [...PRESETS.marked], upstream: { deny: ['upstream-z'], noCollect: true, zdr: true } } }), { allow: { openrouter: ['mail'] }, narrow: { openrouter: ['page'] } })).toBe(1)
    expect(requiredGen(null, { routes: { write: [{ p: OR, m: JEV_ROUTER, effort: 'high' }] }, default: [{ p: OR, m: 'vendor-a/model-b' }] })).toBe(1)
    expect(requiredGen({ routes: { bulk: [{ p: OR, m: JEV_ROUTER }] } }, null)).toBe(1)
  })

  test('a build of generation 1 refuses rules stamped 2', () => {
    expect(policyKnown({ gen: 2 }, null, 1)).toBe(false)
    expect(policyKnown(null, { gen: 2 }, 1)).toBe(false)
    expect(policyKnown({ gen: 2 }, null, 2)).toBe(true)
    expect(policyKnown(null, null, 1)).toBe(true)
    expect(AI_POLICY_GEN).toBeGreaterThanOrEqual(1)
  })
})

test.describe('what a backup would loosen (loosens)', () => {
  const mine = ws(
    {
      anthropic: { allow: [...PRESETS.work], forbid: ['mail'] },
      openrouter: { allow: [...PRESETS.marked], upstream: { deny: ['Upstream-Z'], noCollect: true, zdr: true } },
    },
    { gen: 2, limits: { openrouter: { monthUsd: 10 } } },
  )
  mine.policy!.restricted = [{ root: 'pgnordlicht01', to: [CL] }]

  test('the same rules (or stricter) loosen nothing', () => {
    expect(loosens(mine, mine)).toEqual([])
    expect(loosens(mine, JSON.parse(JSON.stringify(mine)))).toEqual([])
    const stricter = ws({ anthropic: { allow: ['public'], forbid: ['mail', 'memory'] }, openrouter: { allow: ['public'], upstream: { deny: ['upstream-z', 'other'], noCollect: true, zdr: true } } }, { gen: 2, limits: { openrouter: { monthUsd: 5 } } })
    stricter.policy!.restricted = [{ root: 'pgnordlicht01', to: [CL] }]
    expect(loosens(mine, stricter)).toEqual([])
  })

  test('each kind of loosening is named', () => {
    const theirs = ws({ openrouter: { allow: [...PRESETS.work], upstream: { deny: [], noCollect: false, zdr: false } }, openai: { allow: ['public', 'page'] } }, { gen: 1, limits: { openrouter: { monthUsd: 50 } } })
    const items = loosens(mine, theirs)
    // Claude's rule gone: every shared class it withheld comes back; its forbid is gone
    expect(items).toContainEqual({ kind: 'allow', p: CL, cls: 'people' })
    expect(items).toContainEqual({ kind: 'allow', p: CL, cls: 'transcript' })
    expect(items).toContainEqual({ kind: 'forbid', p: CL, cls: 'mail' })
    // OpenRouter: page … workspace more; the deny list, data collection and ZDR relaxed; a higher limit
    expect(items).toContainEqual({ kind: 'allow', p: OR, cls: 'page' })
    expect(items).toContainEqual({ kind: 'upstream', p: OR, what: 'deny', name: 'Upstream-Z' })
    expect(items).toContainEqual({ kind: 'upstream', p: OR, what: 'noCollect' })
    expect(items).toContainEqual({ kind: 'upstream', p: OR, what: 'zdr' })
    expect(items).toContainEqual({ kind: 'limit', p: OR, from: 10, to: 50 })
    // a provider these rules gave nothing
    expect(items).toContainEqual({ kind: 'provider', p: 'openai', classes: ['public', 'page'] })
    expect(items).toContainEqual({ kind: 'gen', from: 2, to: 1 })
    expect(items).toContainEqual({ kind: 'restricted', root: 'pgnordlicht01' })
    // a limit removed
    expect(loosens(mine, { ...mine, limits: undefined })).toEqual([{ kind: 'limit', p: OR, from: 10, to: null }])
    // allowing mail for OpenRouter cannot be stored — a forbid removed can
    expect(loosens(ws({ openrouter: { allow: ['public'], forbid: ['mail'] } }), ws({ openrouter: { allow: ['public'] } }))).toEqual([{ kind: 'forbid', p: OR, cls: 'mail' }])
  })
})

test.describe('the device layer (settings.ai)', () => {
  test('roles per provider (the Jev Router allowed); router rows never in the shortlist; dynamic-priced rows kept', () => {
    const caps = { structured: true, tools: true, vision: false, pdf: false, mcp: false, mcpListing: false, cache: 'auto', effort: false, reasoning: false, web: false, notes: false, refusalFallback: false, context: 100000, maxOutput: 8000 }
    const d = sanitizeDeviceAI({
      roles: { openrouter: { fast: 'vendor-a/model-b', standard: JEV_ROUTER, deep: 'openrouter/auto' }, anthropic: { fast: 'claude-haiku-4-5', deep: 'gpt-6' }, demo: { fast: 'x' } },
      models: [
        { m: JEV_ROUTER, label: 'Jev Router', price: null, caps, at: '2026-10-12' },
        { m: 'vendor-a/model-b', label: 'Model B', price: null, caps, at: '2026-10-12' },
      ],
    })!
    expect(d.roles).toEqual({ openrouter: { fast: 'vendor-a/model-b', standard: JEV_ROUTER }, anthropic: { fast: 'claude-haiku-4-5' } })
    expect(d.models!.map((r) => r.m)).toEqual(['vendor-a/model-b'])
    expect(d.models![0].price).toBeNull()
  })
})

test.describe('redaction (src/shared/ai/redact.ts)', () => {
  const mention = (id: string, label: string, kind = 'person'): RedactNode => ({ type: 'mention', attrs: { id, label, kind } })
  const p = (...content: RedactNode[]): RedactNode => ({ type: 'paragraph', content })
  const text = (t: string): RedactNode => ({ type: 'text', text: t })
  const doc: RedactNode = {
    type: 'doc',
    content: [
      p(text('Kickoff with '), mention('pp_nora', 'Nora Lindqvist'), text(' and '), mention('pp_ivo', 'Ivo Brandt')),
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p(mention('pp_ivo', 'Ivo Brandt'))] }] }] },
      { type: 'columns', content: [{ type: 'column', content: [p(mention('pp_tamsin', 'Tamsin Ode'))] }] },
      { type: 'workItem', attrs: { itemId: 'wi_abcdefghij', people: ['pp_nora'], frozen: { people: ['Nora Lindqvist'], blockedBy: 0, related: 0 } }, content: [p(text('Send the plan to '), mention('pp_nora', 'Nora Lindqvist'))] },
      { type: 'meetingNotes', attrs: { title: 'Weekly', transcript: [{ t: 0, text: 'Nora: the budget is 40k' }], recordedBy: 'pp_nora' }, content: [p(text('Notes stay'))] },
      p(mention('pg_secret', 'Salaries 2027', 'page'), text(' · '), mention('pg_open', 'Roadmap', 'page')),
      { type: 'pageLink', attrs: { pageId: 'pg_secret' } },
      { type: 'syncedBlock', attrs: { syncId: 's1', sourcePageId: 'pg_secret' }, content: [p(text('copied private text'))] },
      { type: 'syncedBlock', attrs: { syncId: 's2', sourcePageId: 'pg_open' }, content: [p(text('copied open text'))] },
    ],
  }
  const json = (d: RedactNode) => JSON.stringify(d)

  test('people: numbered by first appearance, stable within one redactor, nested (tables, columns, tasks)', () => {
    const r = createRedactor()
    const out = redactDoc(doc, { people: true, transcript: false }, r)
    const s = json(out)
    for (const name of ['Nora Lindqvist', 'Ivo Brandt', 'Tamsin Ode']) expect(s).not.toContain(name)
    const labels: string[] = []
    const walk = (n: RedactNode) => {
      if (n.type === 'mention' && n.attrs?.kind === 'person') labels.push(String(n.attrs.label))
      n.content?.forEach(walk)
    }
    walk(out)
    expect(labels).toEqual(['Person 1', 'Person 2', 'Person 2', 'Person 3', 'Person 1'])
    expect(redactPersonValue('pp_ivo', r)).toBe('@Person 2')
    // a task's frozen owner names (a doc that left the workspace has no ids) are numbered by name
    const task = (out.content ?? []).find((n) => n.type === 'workItem')!
    expect((task.attrs?.frozen as { people: string[] }).people).toEqual(['Person 4'])
    expect(redactPersonValue('pp_new', r)).toBe('@Person 5')
    // the transcript stays when only people are redacted; the input is never changed
    expect(s).toContain('the budget is 40k')
    expect(json(doc)).toContain('Nora Lindqvist')
  })

  test('transcript: left out, the notes kept; nothing to redact = the same object', () => {
    const out = redactDoc(doc, { people: false, transcript: true }, createRedactor())
    expect(json(out)).not.toContain('the budget is 40k')
    expect(json(out)).toContain('Notes stay')
    expect(json(out)).toContain('Nora Lindqvist')
    expect(redactDoc(doc, { people: false, transcript: false }, createRedactor())).toBe(doc)
  })

  test('visible: a page the route may not see reads "[Page]"; its synced copies are left out', () => {
    const out = redactDoc(doc, { people: false, transcript: false, visible: (id) => id !== 'pg_secret', hidden: '[Seite]' }, createRedactor())
    const s = json(out)
    expect(s).not.toContain('pg_secret')
    expect(s).not.toContain('copied private text')
    expect(s).toContain('copied open text')
    expect(s).toContain('[Seite]')
    expect(s).toContain('pg_open')
  })

  test('charts (review #1): a live source the route may not read goes as its title or "[Page]"; a manual chart stays', () => {
    const chart = (source: Record<string, unknown>, title = 'Load by owner'): RedactNode => ({ type: 'chart', attrs: { spec: { kind: 'bar', title, source } } })
    const byOwner = chart({ kind: 'database', databaseId: 'db_tasks', x: 'p_owner', aggregate: 'count' })
    const byStage = chart({ kind: 'database', databaseId: 'db_tasks', x: 'p_stage', aggregate: 'count' })
    const mails = chart({ kind: 'database', databaseId: 'db_mails', x: 'p_label', aggregate: 'count' })
    const sheet = chart({ kind: 'sheet', pageId: 'pg_secret', sheetBlockId: 'sh1', ref: 'A1:B3' })
    const metric = chart({ kind: 'system', metric: 'activityByMember', range: '30d' })
    const manual = chart({ kind: 'manual', rows: [['Name', 'n'], ['Nora Lindqvist', 2]] })
    const base = { people: true, transcript: false, visible: (id: string) => id !== 'db_mails' && id !== 'pg_secret', hidden: '[Page]', rows: true, chartAxis: (_db: string, p: string) => p !== 'p_owner' }
    expect(chartFate(byOwner.attrs!.spec, base)).toBe('title')
    expect(chartFate(byStage.attrs!.spec, base)).toBe('keep')
    expect(chartFate(mails.attrs!.spec, base)).toBe('hidden')
    expect(chartFate(sheet.attrs!.spec, base)).toBe('hidden')
    expect(chartFate(metric.attrs!.spec, base)).toBe('title')
    expect(chartFate(manual.attrs!.spec, base)).toBe('keep')
    // fail closed: no rows for the route, or no axis check → a chart over a database goes as its title
    expect(chartFate(byStage.attrs!.spec, { ...base, rows: false })).toBe('title')
    expect(chartFate(byStage.attrs!.spec, { ...base, chartAxis: undefined })).toBe('title')
    const d: RedactNode = { type: 'doc', content: [byOwner, byStage, mails, sheet, metric, manual] }
    const out = redactDoc(d, base, createRedactor())
    const kinds = (out.content ?? []).map((n) => (n.type === 'chart' ? ((n.attrs!.spec as { source: { kind: string; rows?: unknown[] } }).source.kind + ((n.attrs!.spec as { source: { rows?: unknown[] } }).source.rows?.length ?? '')) : n.type))
    expect(kinds).toEqual(['manual0', 'database', 'paragraph', 'paragraph', 'manual0', 'manual2'])
    expect(json(out)).toContain('Load by owner')
    expect(json(out)).toContain('[Page]')
    expect(json(d)).toContain('p_owner')
  })

  test('task owners: "@Person n" inside withRedaction, named outside (positive control)', () => {
    const a = { status: 'todo', due: null, reminder: null, people: ['pp_nora', 'pp_ivo'], blockedBy: [], related: [] } as unknown as Parameters<typeof fieldLine>[0]
    const names: Record<string, string> = { pp_nora: 'Nora Lindqvist', pp_ivo: 'Ivo Brandt' }
    const labels = { person: (id: string) => names[id] ?? null }
    expect(fieldLine(a, labels)).toContain('Nora Lindqvist')
    const r = createRedactor()
    r.person('pp_ivo')
    const line = withRedaction(r, () => {
      const cur = currentRedactor()!
      return fieldLine(a, { ...labels, redact: (k) => cur.person(k) })
    })
    expect(line).toBe('Owner: @Person 2, @Person 1')
    expect(currentRedactor()).toBeNull()
  })

  test('recordedBy never reaches Markdown or plain text (guard, no change needed)', () => {
    const md = readFileSync(new URL('../../src/app/editor/schema/meetingNotes.ts', import.meta.url), 'utf8')
    const body = md.slice(md.indexOf('renderMarkdown('), md.indexOf('renderMarkdown(') + 900)
    expect(body).not.toContain('recordedBy')
    expect(readFileSync(new URL('../../src/app/store/plain.ts', import.meta.url), 'utf8')).not.toContain('recordedBy')
  })
})

test.describe('purposes: needs vs may (D-S2-27)', () => {
  test('the declaration table', () => {
    const t = (id: keyof typeof PURPOSES) => ({ needs: [...PURPOSES[id].needs], may: [...PURPOSES[id].may] })
    expect(t('menu.action')).toEqual({ needs: ['selection'], may: ['page', 'mcp'] })
    expect(t('menu.ask')).toEqual({ needs: ['selection'], may: ['page', 'memory', 'mcp'] })
    expect(t('menu.tasks')).toEqual({ needs: ['selection', 'people'], may: ['page', 'mcp'] })
    expect(t('palette.ask')).toEqual({ needs: [], may: ['page', 'memory', 'mcp'] })
    expect(t('workspace.ask')).toEqual({ needs: ['workspace'], may: ['mcp'] })
    expect(t('structure.transform')).toEqual({ needs: ['selection'], may: ['people', 'mcp'] })
    expect(t('meeting.summary')).toEqual({ needs: ['transcript'], may: ['mcp'] })
    expect(t('bulk.autofill')).toEqual({ needs: ['rows'], may: ['page', 'mcp'] })
    expect(t('bulk.kit')).toEqual({ needs: ['structure'], may: ['page', 'mcp'] })
    expect(t('bulk.mail')).toEqual({ needs: ['mail'], may: [] })
    expect(t('memory.propose').needs).toEqual(['memory'])
    expect(t('memory.example').needs).toEqual(['memory'])
    expect(t('setup.test')).toEqual({ needs: [], may: [] })
    expect(t('help.ask')).toEqual({ needs: ['public'], may: [] })
    expect(PURPOSES['setup.test'].pageless && PURPOSES['help.ask'].pageless && PURPOSES['write.instructions'].pageless).toBe(true)
    expect(PURPOSES['menu.action'].pageless).toBe(false)
    expect(PURPOSES['palette.ask'].pageless).toBe(true)
    // an unknown purpose needs every class (fail closed)
    expect(UNKNOWN_PURPOSE.needs).toEqual(DATA_CLASSES)
    // every declared class is a data class; nothing both needed and optional
    for (const [id, d] of Object.entries(PURPOSES)) {
      for (const c of [...d.needs, ...d.may]) expect(DATA_CLASSES, `${id}: ${c}`).toContain(c)
      expect(d.needs.filter((c) => (d.may as readonly string[]).includes(c)), id).toEqual([])
    }
  })

  test('a selection of a page brings its member classes only — never page or rows', () => {
    const page = (id: string, o: Partial<Page> = {}) => ({ id, title: id, parentId: null, content: { type: 'doc', content: [] }, ...o }) as unknown as Page
    const db = (id: string, system?: Database['system']) => ({ id, system, properties: [], views: [] }) as unknown as Database
    const w: SourceWorld = {
      pages: Object.fromEntries([page('vault', { private: true }), page('mails'), page('mail-1', { parentId: 'mails', databaseId: 'mails' }), page('memory'), page('mem-1', { parentId: 'memory', databaseId: 'memory' }), page('plain')].map((p) => [p.id, p])),
      databases: { mails: db('mails'), memory: db('memory', 'memory') },
      mailDb: 'mails',
      memo: new Map(),
    }
    const c = (...s: Parameters<typeof classesOf>[0]) => [...classesOf(s, w)].sort()
    expect(c({ page: 'vault', as: 'selection' })).toEqual(['private'])
    expect(c({ page: 'mail-1', as: 'selection' })).toEqual(['mail'])
    expect(c({ page: 'mem-1', as: 'selection' })).toEqual(['memory'])
    expect(c({ page: 'plain', as: 'selection' })).toEqual([])
    // the memory block: a selection of the memory database — `memory`, not its rows
    expect(c({ page: 'memory', as: 'selection' })).toEqual(['memory'])
    // the same pages whole (positive control)
    expect(c({ page: 'mail-1' })).toEqual(['mail', 'rows'])
    expect(c({ page: 'vault' })).toEqual(['page', 'private'])
    // memoised per request
    expect(w.memo!.has('mail-1')).toBe(true)
  })

  test('a Mails database is mail by its marker too — also once this device\'s sync points elsewhere (S2 review #8)', () => {
    const page = (id: string, o: Partial<Page> = {}) => ({ id, title: id, parentId: null, content: { type: 'doc', content: [] }, ...o }) as unknown as Page
    const db = (id: string, system?: Database['system']) => ({ id, system, properties: [], views: [] }) as unknown as Database
    const world = (mailDb: string | null): SourceWorld => ({
      pages: Object.fromEntries([page('old'), page('old-1', { parentId: 'old', databaseId: 'old' }), page('new'), page('new-1', { parentId: 'new', databaseId: 'new' }), page('tasks'), page('task-1', { parentId: 'tasks', databaseId: 'tasks' })].map((p) => [p.id, p])),
      databases: { old: db('old', 'mails'), new: db('new', 'mails'), tasks: db('tasks') },
      mailDb,
      memo: new Map(),
    })
    // the restored old Mails database: no longer the sync target, still mail
    expect([...classesOf([{ page: 'old-1' }], world('new'))].sort()).toEqual(['mail', 'rows'])
    expect([...classesOf([{ db: 'old' }], world(null))].sort()).toEqual(['mail', 'rows', 'structure'])
    // positive control: an ordinary database is rows only
    expect([...classesOf([{ page: 'task-1' }], world('new'))].sort()).toEqual(['rows'])
  })
})

/* ------------------------------------------------------------------ */
/* The route resolution                                                 */
/* ------------------------------------------------------------------ */

const CAPS: Caps = { structured: true, tools: true, vision: false, pdf: false, mcp: false, mcpListing: false, cache: 'auto', effort: false, reasoning: false, web: false, notes: false, refusalFallback: false, context: 128000, maxOutput: 16000 }
const sl = (m: string, price: [number, number] | null, caps: Partial<Caps> = {}): ShortlistRow => ({ m, label: m.split('/')[1]!.replace(/-/g, ' '), price: price ? { input: price[0], output: price[1], cacheRead: price[0], cacheWrite: price[0], source: 'catalogue', at: '2026-10-12' } : null, caps: { ...CAPS, ...caps }, at: '2026-10-12' })
const ROWS = [sl('vendor-a/swift-1', [0.1, 0.4]), sl('vendor-b/keen-2', [1, 3], { vision: { maxEdge: 1568, maxBytes: 5e6 } }), sl('vendor-c/plain-3', [0.5, 1.5], { structured: false })]
const JEV: Route = { p: OR, m: JEV_ROUTER, effort: 'medium' }

function worldOf(o: { ws?: WorkspaceAI | null; device?: DeviceAI | null; keys?: Route['p'][]; rows?: ShortlistRow[]; aiModel?: string } = {}): RouteWorld {
  const rows = o.rows ?? ROWS
  const keys = o.keys ?? ['anthropic', 'openrouter']
  return {
    ws: o.ws ?? null,
    device: o.device ?? null,
    aiModel: o.aiModel ?? 'claude-opus-5-5',
    hasKey: (p) => keys.includes(p),
    info: (route, pool) => {
      const r = modelRow(route)
      if (r) return { route, label: r.label, short: r.short, vendor: r.vendor, caps: r.caps, price: r.price } as ModelInfo
      if (route.p !== 'openrouter') return null
      if (route.m === JEV_ROUTER) return routerView(route, (pool ?? []).map((m) => rows.find((x) => x.m === m)!).filter(Boolean))
      const s = rows.find((x) => x.m === route.m)
      return s ? shortlistInfo(route, s) : null
    },
    shortlist: rows.map((r) => r.m),
  }
}
const ask = (o: Partial<ResolveInput> = {}): ResolveInput => ({ cls: 'write', caps: [], classes: ['selection'], ...o })
const allOR = (allow = [...PRESETS.all]) => ws({ openrouter: { allow } })
const memberAll: DeviceAI = { allow: { openrouter: [...MEMBER_CLASSES] } }

test.describe('levels (chip → device class → workspace class → device default → workspace default → legacy)', () => {
  const route = (r: ReturnType<typeof resolveRoute>) => (r.ok ? `${r.level}:${r.route.p}:${r.route.m}` : r.none ? 'none' : `${r.code}`)
  test('the first level with a rule wins; levels are never merged', () => {
    const device: DeviceAI = { routes: { bulk: [{ p: OR, m: 'vendor-a/swift-1' }] }, default: [{ p: CL, m: 'claude-sonnet-5-5' }] }
    const w = { ...allOR(), routes: { write: [{ p: OR, m: 'vendor-b/keen-2' }], '*': [{ p: OR, m: 'vendor-c/plain-3' }] } } as WorkspaceAI
    const world = worldOf({ ws: w, device: { ...device, ...memberAll } })
    expect(route(resolveRoute(ask({ cls: 'bulk', caps: ['structured'], classes: ['rows'] }), world))).toBe('device:openrouter:vendor-a/swift-1')
    expect(route(resolveRoute(ask({ cls: 'write' }), world))).toBe('workspace:openrouter:vendor-b/keen-2')
    expect(route(resolveRoute(ask({ cls: 'ask', classes: [] }), world))).toBe('default:anthropic:claude-sonnet-5-5')
    // the chip beats everything — for this request only
    expect(route(resolveRoute(ask({ cls: 'write', chip: { p: CL, m: 'claude-haiku-4-5' } }), world))).toBe('chip:anthropic:claude-haiku-4-5')
    // no device default: the workspace default, then legacy
    expect(route(resolveRoute(ask({ cls: 'ask', classes: [] }), worldOf({ ws: w, device: memberAll })))).toBe('workspace-default:openrouter:vendor-c/plain-3')
    expect(route(resolveRoute(ask({ cls: 'ask', classes: [] }), worldOf({ aiModel: 'claude-sonnet-5-5' })))).toBe('legacy:anthropic:claude-sonnet-5-5')
    // no rule, no Claude key: none (demo or no_key — the gate decides)
    expect(route(resolveRoute(ask(), worldOf({ keys: ['openrouter'] })))).toBe('none')
  })

  test('a provider that does not take the class yet: the next level, with a step', () => {
    expect(ROUTABLE.openrouter).toEqual(['write', 'ask', 'workspace', 'structure', 'vision', 'documents', 'bulk', 'meeting', 'memory', 'help'])
    expect(ROUTABLE.openai).toEqual([])
    const world = worldOf({ ws: allOR(), device: { default: [{ p: OR, m: 'vendor-a/swift-1' }], ...memberAll } })
    for (const cls of ['terminal', 'agents', 'outbox', 'scripts', 'generate', 'mcp-setup', 'gate'] as const) {
      const r = resolveRoute(ask({ cls, classes: [] }), world)
      expect(r.ok && r.level, cls).toBe('legacy')
      expect(r.steps, cls).toContainEqual({ k: 'fallthrough', from: 'openrouter:vendor-a/swift-1', code: 'later' })
    }
    const ok = resolveRoute(ask({ cls: 'bulk', classes: [] }), world)
    expect(ok.ok && ok.level).toBe('default')
  })
})

test.describe('filters on the winning rule (key · model · capability · data rule)', () => {
  test('each filter refuses with its code, step and fix; no fall-through to the next level', () => {
    const base = { ws: allOR(), device: { routes: { write: [{ p: OR, m: 'vendor-c/plain-3' }] }, default: [{ p: CL, m: 'claude-opus-5-5' }], ...memberAll } as DeviceAI }
    // 1 · no key on this device
    const k = resolveRoute(ask(), worldOf({ ...base, keys: ['anthropic'] }))
    expect(k).toMatchObject({ ok: false, code: 'no_key', level: 'device', fixes: [{ kind: 'step', step: 'key', provider: OR }] })
    expect(!k.ok && k.steps).toContainEqual({ k: 'nokey', from: 'openrouter:vendor-c/plain-3' })
    // 2 · a model gone from the shortlist
    const g = resolveRoute(ask(), worldOf({ ...base, rows: ROWS.slice(0, 2) }))
    expect(g).toMatchObject({ ok: false, code: 'model_gone', fixes: [{ kind: 'step', step: 'models', provider: OR }] })
    // 3 · capability: structured answers on a model without them
    const c = resolveRoute(ask({ caps: ['structured'] }), worldOf(base))
    expect(c).toMatchObject({ ok: false, code: 'capability', detail: 'structured', fixes: [{ kind: 'pick', need: 'structured' }] })
    // 4 · the data rule (first refused class)
    const d = resolveRoute(ask({ classes: ['selection', 'mail'] }), worldOf({ ...base, device: { ...base.device, allow: {} } }))
    expect(d).toMatchObject({ ok: false, code: 'policy', detail: 'mail', fixes: [{ kind: 'step', step: 'data', provider: OR, data: 'mail' }] })
    expect(!d.ok && d.steps).toContainEqual({ k: 'policy', from: 'openrouter:vendor-c/plain-3', cls: 'mail' })
    // passes: the route
    expect(resolveRoute(ask(), worldOf(base))).toMatchObject({ ok: true, route: { p: OR, m: 'vendor-c/plain-3' } })
  })

  test('a later pin of the same rule answers when the first is refused (a rule read from a later build)', () => {
    const device: DeviceAI = { routes: { write: [{ p: OR, m: 'vendor-c/plain-3' }, { p: CL, m: 'claude-sonnet-5-5' }] } }
    const r = resolveRoute(ask({ caps: ['structured'] }), worldOf({ ws: allOR(), device }))
    expect(r).toMatchObject({ ok: true, route: { p: CL, m: 'claude-sonnet-5-5' }, level: 'device' })
    expect(r.steps).toContainEqual({ k: 'capability', from: 'openrouter:vendor-c/plain-3', code: 'structured' })
  })

  test('the legacy level runs the data rule too: a Claude narrow refuses what it narrows', () => {
    const r = resolveRoute(ask({ cls: 'bulk', classes: ['mail'] }), worldOf({ device: { narrow: { anthropic: ['mail'] } } }))
    expect(r).toMatchObject({ ok: false, code: 'policy', detail: 'mail', level: 'legacy', fixes: [{ kind: 'step', step: 'data', provider: CL, data: 'mail' }] })
    // an addressed MCP server: Claude connects it (positive control), the router never
    expect(resolveRoute(ask({ cls: 'ask', caps: ['mcp'], classes: ['mcp'] }), worldOf())).toMatchObject({ ok: true, route: { p: CL } })
  })
})

test.describe('the Jev Router: a pool over the shortlist', () => {
  test('the pool = shortlist models passing filters 2–3 (capability per model); the bound = the most expensive pool row', () => {
    const world = worldOf({ ws: allOR(), device: { routes: { write: [JEV] }, ...memberAll } })
    const r = resolveRoute(ask(), world)
    expect(r).toMatchObject({ ok: true, route: JEV, pool: ['vendor-a/swift-1', 'vendor-b/keen-2', 'vendor-c/plain-3'] })
    expect(r.ok && r.info.price).toMatchObject({ input: 1, output: 3, source: 'bound' })
    // structured answers: the model without them leaves the pool
    const s = resolveRoute(ask({ caps: ['structured'] }), world)
    expect(s.ok && s.pool).toEqual(['vendor-a/swift-1', 'vendor-b/keen-2'])
    // a picture: only the vision model
    const v = resolveRoute(ask({ cls: 'write', caps: ['vision'] }), world)
    expect(v.ok && v.pool).toEqual(['vendor-b/keen-2'])
    expect(v.ok && v.info.caps.vision).toBeTruthy()
    // nothing fits (an addressed MCP server): refused, the fix is the model list
    expect(resolveRoute(ask({ caps: ['mcp'] }), world)).toMatchObject({ ok: false, code: 'capability', detail: 'pool', fixes: [{ kind: 'step', step: 'models', provider: OR }] })
    // the data rule is OpenRouter's (the router is an OpenRouter request)
    expect(resolveRoute(ask({ classes: ['selection', 'people'] }), worldOf({ ws: allOR([...PRESETS.marked]), device: { routes: { write: [JEV] } } }))).toMatchObject({ ok: false, code: 'policy', detail: 'people' })
    // the router is never a pool model, a refused slug never one
    const odd = worldOf({ ws: allOR(), device: { routes: { write: [JEV] }, ...memberAll }, rows: [...ROWS, sl('openrouter/auto', [1, 1]), sl(JEV_ROUTER, null)] })
    const o = resolveRoute(ask(), odd)
    expect(o.ok && o.pool).toEqual(['vendor-a/swift-1', 'vendor-b/keen-2', 'vendor-c/plain-3'])
  })

  test('a pool row without a price counts at the stated dynamic bound (never 0)', () => {
    const v = routerView(JEV, [sl('vendor-a/swift-1', [0.1, 0.4]), sl('vendor-d/flex-4', null)])
    expect(v.price!.input).toBeGreaterThan(1)
    expect(v.price!.source).toBe('bound')
    expect(routerView(JEV, []).price!.input).toBeGreaterThan(0)
  })
})

test.describe('the backstop (D-S2-5): page-derived text to a filtered route must say what it went through', () => {
  const base = { pageDerived: PAGE_DERIVED, redact: { people: true, transcript: true }, hidden: ['private', 'mail', 'memory', 'mcp'] as const, route: 'openrouter:vendor-a/swift-1' }
  const all = { people: true, transcript: true, visible: true }
  test('refused without applied; with it, it goes; never by purpose name', () => {
    expect(backstop({ ...base, classes: ['selection', 'page'], sees: 'filtered' })).toBe('selection')
    expect(backstop({ ...base, classes: ['selection', 'page'], sees: 'filtered', applied: all })).toBeNull()
    expect(backstop({ ...base, classes: ['page'], sees: 'filtered', applied: { ...all, people: false } })).toBe('people')
    expect(backstop({ ...base, classes: ['page'], sees: 'filtered', applied: { ...all, transcript: false } })).toBe('transcript')
    expect(backstop({ ...base, classes: ['page'], sees: 'filtered', applied: { ...all, visible: false } })).toBe('private')
    // built for another route
    expect(backstop({ ...base, classes: ['page'], sees: 'filtered', applied: { ...all, route: 'anthropic:claude-opus-5-5' } })).toBe('page')
    // public / structure only (help Ask, the test sentence, improving instructions): nothing page-derived
    expect(backstop({ ...base, classes: ['public'], sees: 'filtered' })).toBeNull()
    expect(backstop({ ...base, classes: [], sees: 'filtered' })).toBeNull()
    // a route that sees everything: the identity (today's Claude)
    expect(backstop({ ...base, classes: ['page', 'people'], sees: 'all' })).toBeNull()
  })
})

test.describe('the registry rows the gate reads', () => {
  test('Claude routes resolve to their registry rows', () => {
    for (const r of MODELS.filter((x) => x.route.p === 'anthropic' && x.selectable)) {
      const res = resolveRoute(ask({ chip: r.route }), worldOf())
      expect(res.ok && res.info.label).toBe(r.label)
    }
  })
})

test.describe('the recorder\'s run meta of AI runs (B7)', () => {
  test('route keys are kept (a model id with "/" and ":"), text is refused, aiAlso ≤ 3, role / group / parent by their grammar', () => {
    expect(cleanMeta({ ai: 'openrouter:openai/gpt-6-luna', aiAlso: ['openrouter:typesafe/jev-router'], role: 'main', group: 'grp_1', parent: 'run-2' })).toEqual({ ai: 'openrouter:openai/gpt-6-luna', aiAlso: ['openrouter:typesafe/jev-router'], role: 'main', group: 'grp_1', parent: 'run-2' })
    expect(cleanMeta({ ai: 'openrouter:z-ai/glm-5.3:free' })).toEqual({ ai: 'openrouter:z-ai/glm-5.3:free' })
    expect(cleanMeta({ ai: 'anthropic:claude-opus-5-5', seq: 3 })).toEqual({ ai: 'anthropic:claude-opus-5-5', seq: 3 })
    // page text, a person's name, an unknown provider, spaces: never kept
    expect(cleanMeta({ ai: 'Mira Kowalski says the budget is forty thousand' })).toBeUndefined()
    expect(cleanMeta({ ai: 'openrouter:has a space' })).toBeUndefined()
    expect(cleanMeta({ ai: 'mystery:model-x' })).toBeUndefined()
    expect(cleanMeta({ aiAlso: ['openrouter:a/b', 'openrouter:c/d', 'anthropic:claude-haiku-4-5', 'openrouter:e/f'] })?.aiAlso).toHaveLength(3)
    expect(cleanMeta({ aiAlso: ['not a route', 'openrouter:a/b'] })?.aiAlso).toEqual(['openrouter:a/b'])
    expect(cleanMeta({ role: 'boss' as never })).toBeUndefined()
    expect(cleanMeta({ role: 'decide' })).toEqual({ role: 'decide' })
    expect(cleanMeta({ group: 'has space', parent: 'x'.repeat(41) })).toBeUndefined()
  })
})
