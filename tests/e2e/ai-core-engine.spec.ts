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
import { createRedactor, currentRedactor, redactDoc, redactPersonValue, withRedaction, type RedactNode } from '../../src/shared/ai/redact'
import { JEV_ROUTER } from '../../src/shared/ai/jev'
import { OWNER } from '../../src/shared/ai/owner'
import type { DeviceAI, WorkspaceAI } from '../../src/shared/ai/types'
import { fieldLine } from '../../src/app/editor/workitem/markdown'

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
