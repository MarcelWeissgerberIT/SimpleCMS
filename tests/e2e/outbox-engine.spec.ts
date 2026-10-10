/**
 * The Outbox's pure parts (no browser; run in Node by the Playwright runner). Slice 1a — contract and lock:
 *  - `outToolsOf`: the send tools of every profile that matches a server by name / host — never by `match.tools`,
 *    whatever the profile unlocks or the server's switch says; a union over profiles;
 *  - the toolset matrix (`toolsetFor`): no list · list · list minus OUT · a list of only OUT tools;
 *  - `checkIntegration` on `sends` / `reads`: every issue code (errors and warnings), the sanitizer's copy, the export;
 *  - placeholders (`placeholdersIn` / `placeholderProblem`) and the path grammar;
 *  - `mergeTestedTools` (a re-test never drops an OUT tool), `pickedTool` (never an OUT tool), the overview's OUT column.
 * Every server and tool is fictional (tracker.example.com).
 */
import { test, expect } from '@playwright/test'
import {
  ROUTE_KEY,
  ROUTE_PATH,
  SEND_LIMITS,
  checkIntegration,
  exportIntegration,
  outToolsOf,
  placeholderProblem,
  placeholdersIn,
  sameIntegration,
  sanitizeIntegration,
  type IntegrationIssue,
} from '../../src/app/store/integrations'
import type { IntegrationProfile, McpServerConfig } from '../../src/app/store/types'
import { LISTING_SHOWS_DISABLED, lockedOnly, mergeTestedTools, outLine, toolsetFor } from '../../src/app/features/ai/mcp-servers/lock'
import { pickedTool } from '../../src/app/features/ai/mcp-servers/codeword'
import { overviewRows } from '../../src/app/features/ai/mcp-servers/overview'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { canonicalJson } from '../../src/app/features/coding/protocol'
import { fillArgs, fillTemplate, placeholdersOf, cleanParams, SENT_AT } from '../../src/app/features/outbox/template'
import { pickPath, pickFields, diffFields, rowBaseline, rowChanges } from '../../src/app/features/outbox/fields'
import { next, type SlipEvent } from '../../src/app/features/outbox/machine'
import { addressSet, hiddenChars, linkTargets, personAdded, scanAddresses, sealOf, showHidden } from '../../src/app/features/outbox/seal'
import { outboxCounts } from '../../src/app/features/outbox/counts'
import { argsHashOf } from '../../src/app/features/outbox/hash'
import { SLIP_STATES, type Slip, type SlipState, type SourceRef } from '../../src/app/features/outbox/types'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const TRACKER = { name: 'tracker', url: 'https://tracker.example.com/mcp' }
const WIKI = { name: 'wiki', url: 'https://wiki.example.org/mcp' }

const REPLY = {
  id: 'reply',
  role: 'reply',
  label: { en: 'Reply in the ticket tool', de: 'Im Ticket-Tool antworten' },
  tool: 'add_comment',
  args: { ref: '{key}', visibility: 'team', body: '{draft}' },
  params: [{ name: 'draft', type: 'text', max: 4000, style: { de: 'Kurz, freundlich, du-Form' } }],
  check: { tool: 'get_item', args: { ref: '{key}' }, fields: ['status', 'comments.length'], latest: 'comments.-1', identity: 'ref' },
  confirm: { tool: 'list_comments', args: { ref: '{key}' }, find: 'items', match: [{ path: 'body', equals: '{draft}' }], capture: { id: 'id' } },
  after: [{ property: 'waiting', value: false }],
  via: ['worker', 'hand'],
}
const WORK = {
  id: 'work',
  role: 'work',
  label: 'Log work',
  tool: 'log_work',
  args: { ref: 'LDG-{key}', minutes: '{minutes}', at: '{sentAt}', ticket: '{key|number}' },
  params: [{ name: 'minutes', type: 'minutes', max: 600, round: 15 }],
  confirm: { tool: 'list_comments', args: { ref: '{key}', id: '{result.items.0.id}' }, match: [{ path: 'minutes', equals: '{minutes}' }] },
}

const profile = (extra: AnyState = {}): AnyState => ({
  schema: 'one.integration/1',
  id: 'tracker-out',
  name: 'Tracker out',
  match: { name: 'tracker' },
  unlocks: ['keys', 'sends'],
  reads: ['get_item', 'list_comments'],
  sends: [REPLY],
  ...extra,
})

/** Every issue the checker reports for `raw`. */
function issues(raw: unknown): IntegrationIssue[] {
  const out: IntegrationIssue[] = []
  checkIntegration(raw, (i) => out.push(i))
  return out
}
const errors = (raw: unknown) => issues(raw).filter((i) => (i.severity ?? 'error') === 'error')
const warnings = (raw: unknown) => issues(raw).filter((i) => i.severity === 'warning')
const codes = (list: IntegrationIssue[]) => list.map((i) => i.code)
const at = (list: IntegrationIssue[], code: string) => list.filter((i) => i.code === code).map((i) => i.path.join('.'))
const route = (r: AnyState) => profile({ sends: [r] })

test.describe('Outbox engine · slice 1a: contract and lock', () => {
  test('outToolsOf: name / host match only; ignores match.tools, unlocks and the switch; a union over profiles', () => {
    const byName = sanitizeIntegration(profile())!
    const byHost = sanitizeIntegration(profile({ id: 'by-host', match: { host: '*.example.com' }, unlocks: [], sends: [WORK] }))!
    // both conditions given: both must fit
    const both = sanitizeIntegration(profile({ id: 'both', match: { name: 'wiki', host: '*.example.com' }, sends: [{ ...REPLY, id: 'x', tool: 'delete_item' }] }))!
    expect(byName.sends?.map((r) => r.tool)).toEqual(['add_comment'])
    expect(outToolsOf([byName], TRACKER)).toEqual(['add_comment'])
    // unlocks play no part (byHost unlocks nothing)
    expect(outToolsOf([byName, byHost], TRACKER)).toEqual(['add_comment', 'log_work'])
    expect(outToolsOf([byName, byHost, both], TRACKER)).toEqual(['add_comment', 'log_work'])
    expect(outToolsOf([byName, byHost, both], WIKI)).toEqual([])
    expect(outToolsOf([both], { name: 'wiki', url: 'https://tracker.example.com/mcp' })).toEqual(['delete_item'])
    // the server's switch and tested tools are not even looked at
    const off = { ...TRACKER, enabled: false, tools: [] } as unknown as McpServerConfig
    expect(outToolsOf([byName], off)).toEqual(['add_comment'])
    // a duplicate tool across profiles counts once
    const again = sanitizeIntegration(profile({ id: 'again' }))!
    expect(outToolsOf([byName, again], TRACKER)).toEqual(['add_comment'])
    expect(outToolsOf(undefined, TRACKER)).toEqual([])
    // a tools-only profile: its sends are an error and the sanitizer leaves them out — it never locks (nor would the server)
    const toolsOnly = sanitizeIntegration(profile({ id: 'tools-only', match: { tools: ['get_item'] } }))!
    expect(toolsOnly.sends).toBeUndefined()
    expect(outToolsOf([toolsOnly], TRACKER)).toEqual([])
  })

  test('toolsetFor: no list · list · list minus OUT · only OUT tools; the prompt line', () => {
    expect(toolsetFor('tracker')).toEqual({ type: 'mcp_toolset', mcp_server_name: 'tracker' })
    expect(toolsetFor('tracker', null, [])).toEqual({ type: 'mcp_toolset', mcp_server_name: 'tracker' })
    expect(toolsetFor('tracker', null, ['add_comment', 'log_work'])).toEqual({ type: 'mcp_toolset', mcp_server_name: 'tracker', configs: { add_comment: { enabled: false }, log_work: { enabled: false } } })
    expect(toolsetFor('tracker', ['get_item', 'list_items'])).toEqual({
      type: 'mcp_toolset',
      mcp_server_name: 'tracker',
      default_config: { enabled: false },
      configs: { get_item: { enabled: true }, list_items: { enabled: true } },
    })
    expect(toolsetFor('tracker', ['get_item', 'add_comment'], ['add_comment'])).toEqual({ type: 'mcp_toolset', mcp_server_name: 'tracker', default_config: { enabled: false }, configs: { get_item: { enabled: true } } })
    // only OUT tools: nothing left — callers leave the server out (lockedOnly → []), the toolset alone switches all off
    expect(lockedOnly(['add_comment'], ['add_comment'])).toEqual([])
    expect(toolsetFor('tracker', ['add_comment'], ['add_comment'])).toEqual({ type: 'mcp_toolset', mcp_server_name: 'tracker', default_config: { enabled: false }, configs: {} })
    expect(lockedOnly(null, ['add_comment'])).toBeNull()
    expect(lockedOnly(undefined, [])).toBeNull()
    expect(outLine([])).toBe('')
    expect(outLine(['add_comment'])).toContain('switched off for you: add_comment')
    expect(outLine(['add_comment'])).toContain("from One's Outbox")
  })

  test('mergeTestedTools: a re-test keeps the OUT tools the server had; pickedTool never picks one', () => {
    expect(LISTING_SHOWS_DISABLED).toBe(false)
    const before = ['get_item', 'add_comment', 'search_items']
    // the listing under the lock left add_comment out: it stays; search_items (not OUT) is gone for real
    expect(mergeTestedTools(before, ['get_item', 'list_comments'], ['add_comment'])).toEqual(['get_item', 'list_comments', 'add_comment'])
    // an exact listing (one known to name switched-off tools) is taken as it is
    expect(mergeTestedTools(before, ['get_item'], ['add_comment'], true)).toEqual(['get_item'])
    // an OUT tool the server never had is not invented; no previous list
    expect(mergeTestedTools(['get_item'], ['get_item'], ['add_comment'])).toEqual(['get_item'])
    expect(mergeTestedTools(undefined, ['get_item', 'get_item'], ['add_comment'])).toEqual(['get_item'])

    const server = { id: 's1', name: 'tracker', url: TRACKER.url, token: '', enabled: true, prompt: '', tools: ['get_item', 'add_comment'], codeword: 'tr' } as McpServerConfig
    const out = (s: McpServerConfig) => (s.name === 'tracker' ? ['add_comment'] : [])
    expect(pickedTool('get_item 10668', [server], out)).toEqual({ server: 'tracker', tool: 'get_item' })
    expect(pickedTool('add_comment please post this', [server], out)).toBeNull()
    // without the lock's list it would be picked (the default keeps the old behaviour for callers that pass none)
    expect(pickedTool('add_comment hi', [server])).toEqual({ server: 'tracker', tool: 'add_comment' })
  })

  test('a valid profile with routes: no problems, a clean copy, the export round-trips and sameIntegration sees routes', () => {
    const raw = profile({ sends: [REPLY, WORK] })
    expect(issues(raw)).toEqual([])
    const p = sanitizeIntegration(raw)!
    expect(p.sends).toEqual([REPLY, WORK])
    expect(p.reads).toEqual(['get_item', 'list_comments'])
    const out = exportIntegration(p)
    expect(Object.keys(out)).toEqual(['schema', 'id', 'name', 'match', 'unlocks', 'sends', 'reads'])
    expect(sanitizeIntegration(JSON.parse(JSON.stringify(out)))).toEqual(p)
    expect(sameIntegration(p, sanitizeIntegration(profile({ sends: [REPLY] })))).toBe(false)
    expect(sameIntegration(p, sanitizeIntegration(profile({ sends: [REPLY, WORK], reads: ['get_item'] })))).toBe(false)
    expect(sameIntegration(p, { ...p, updatedAt: 5 } as IntegrationProfile)).toBe(true)
  })

  test('sendsNeedsName: routes need a name or host match — the sanitizer drops them, the profile stays', () => {
    const raw = profile({ match: { tools: ['get_item'] } })
    expect(at(errors(raw), 'sendsNeedsName')).toEqual(['sends'])
    const p = sanitizeIntegration(raw)!
    expect(p.id).toBe('tracker-out')
    expect(p.sends).toBeUndefined()
    // a host is enough
    expect(errors(profile({ match: { host: 'tracker.example.com' } }))).toEqual([])
  })

  test('placeholders: unknown, inside a text, {result.*} outside confirm, {check.*} anywhere, not here, undeclared', () => {
    const e = (args: AnyState, extra: AnyState = {}) => errors(route({ ...REPLY, args, ...extra }))
    const problem = (list: IntegrationIssue[]) => list.filter((i) => i.code === 'placeholder' || i.code === 'param').map((i) => `${i.code}:${i.vars?.value}:${i.vars?.why}@${i.path.join('.')}`)
    expect(problem(e({ ref: '{key}', body: '{foo|bar}' }))).toEqual(['placeholder:{foo|bar}:unknown@sends.0.args.body'])
    expect(problem(e({ ref: '{key}', body: 'Re: {draft}' }))).toEqual(['placeholder:{draft}:whole@sends.0.args.body'])
    expect(problem(e({ ref: '{key}', body: '{draft}', parent: '{result.id}' }))).toEqual(['placeholder:{result.id}:result@sends.0.args.parent'])
    expect(problem(e({ ref: '{key}', body: '{draft}', status: '{check.status}' }))).toEqual(['placeholder:{check.status}:check@sends.0.args.status'])
    expect(problem(e({ ref: '{key}', body: '{draft}', n: 'T-{key|number}' }))).toEqual(['placeholder:{key|number}:whole@sends.0.args.n'])
    expect(problem(e({ ref: '{key}', body: '{draft}', note: '{note}' }))).toEqual(['param:{note}:undeclared@sends.0.args.note'])
    // nested values are checked too
    expect(problem(e({ ref: '{key}', body: '{draft}', meta: { tags: ['{check.x}'] } }))).toEqual(['placeholder:{check.x}:check@sends.0.args.meta.tags.0'])
    // {sentAt} / a param in the pre-read: not here; {result.*} in confirm: fine; a bad result path
    expect(problem(errors(route({ ...REPLY, check: { ...REPLY.check, args: { ref: '{key}', at: '{sentAt}' } } })))).toEqual(['placeholder:{sentAt}:here@sends.0.check.args.at'])
    expect(problem(errors(route({ ...REPLY, check: { ...REPLY.check, args: { ref: '{key}', q: '{draft}' } } })))).toEqual(['placeholder:{draft}:here@sends.0.check.args.q'])
    expect(problem(errors(route({ ...REPLY, confirm: { ...REPLY.confirm, args: { ref: '{key}', after: '{result.items.-1.id}' } } })))).toEqual([])
    expect(problem(errors(route({ ...REPLY, confirm: { ...REPLY.confirm, match: [{ path: 'body', contains: '{draft} {nope}' }] } })))).toEqual([
      'placeholder:{draft}:whole@sends.0.confirm.match.0.contains',
      'param:{nope}:undeclared@sends.0.confirm.match.0.contains',
    ])
    // {key} may sit inside a text; braces that are no placeholder stay text
    expect(e({ ref: 'LDG-{key}', body: '{draft}', note: '{ not one }', json: '{"a":1}' })).toEqual([])

    expect(placeholdersIn('LDG-{key} / {key|number}').map((p) => [p.token, p.kind, p.whole])).toEqual([
      ['{key}', 'key', false],
      ['{key|number}', 'keyNumber', false],
    ])
    const [draft] = placeholdersIn('{draft}')
    expect(placeholderProblem(draft!, 'args', ['draft'])).toBe('')
    expect(placeholderProblem(draft!, 'args', [])).toBe('undeclared')
    expect(placeholderProblem(draft!, 'match', ['draft'])).toBe('')
    expect(placeholderProblem(draft!, 'confirm', ['draft'])).toBe('here')
    expect(placeholderProblem(placeholdersIn('{result.id}')[0]!, 'args', [])).toBe('result')
    expect(placeholderProblem(placeholdersIn('{result.items.12345}')[0]!, 'confirm', [])).toBe('path')
    expect(placeholderProblem(placeholdersIn('{check}')[0]!, 'confirm', [])).toBe('check')
  })

  test('params: bad name, reserved, draft must be text, one text, option needs values, values / style / round / max only where they fit', () => {
    const why = (params: AnyState[], args: AnyState = { ref: '{key}' }) =>
      errors(route({ ...REPLY, args, params, confirm: undefined }))
        .filter((i) => i.code === 'param' || i.code === 'range' || i.code === 'duplicate')
        .map((i) => `${i.code}:${i.vars?.why ?? ''}`)
    expect(why([{ name: 'Draft', type: 'text' }])).toEqual(['param:name'])
    expect(why([{ name: 'key', type: 'text' }])).toEqual(['param:reserved'])
    expect(why([{ name: 'draft', type: 'number' }])).toEqual(['param:type'])
    expect(why([{ name: 'minutes', type: 'number' }])).toEqual(['param:type'])
    expect(why([{ name: 'draft', type: 'text' }, { name: 'note', type: 'text' }])).toEqual(['param:texts'])
    expect(why([{ name: 'state', type: 'option' }])).toEqual(['param:values'])
    expect(why([{ name: 'state', type: 'option', values: [] }])).toEqual(['param:values'])
    expect(why([{ name: 'n', type: 'number', values: ['a'] }])).toEqual(['param:values'])
    expect(why([{ name: 'n', type: 'number', style: 'short' }])).toEqual(['param:style'])
    expect(why([{ name: 'n', type: 'number', round: 5 }])).toEqual(['param:round'])
    expect(why([{ name: 'state', type: 'option', values: ['Open'], max: 3 }])).toEqual(['param:max'])
    expect(why([{ name: 'draft', type: 'text', max: SEND_LIMITS.draftMax + 1 }])).toEqual(['range:'])
    expect(why([{ name: 'minutes', type: 'minutes', round: 0 }])).toEqual(['range:'])
    expect(why([{ name: 'n', type: 'number' }, { name: 'n', type: 'number' }])).toEqual(['duplicate:'])
    expect(why([{ name: 'state', type: 'option', values: ['Open', 'Done'] }, { name: 'n', type: 'number', max: 10 }])).toEqual([])
    // more than 8 params
    const nine = Array.from({ length: 9 }, (_, i) => ({ name: `p${i}`, type: 'number' }))
    expect(at(errors(route({ ...REPLY, args: { ref: '{key}' }, params: nine, confirm: undefined })), 'tooMany')).toEqual(['sends.0.params'])
  })

  test('checkIsSend, notInReads, path, via, afterValue, argKey, sizes and depth; the sanitizer keeps the route without the broken part', () => {
    // a pre-read that would send: refused, the route keeps its tool (and stays locked) without the check
    const sending = route({ ...REPLY, check: { ...REPLY.check, tool: 'add_comment' } })
    expect(at(errors(sending), 'checkIsSend')).toEqual(['sends.0.check.tool'])
    const kept = sanitizeIntegration(sending)!.sends![0]!
    expect(kept.tool).toBe('add_comment')
    expect(kept.check).toBeUndefined()
    // another route's send tool counts too
    expect(at(errors(profile({ sends: [{ ...REPLY, confirm: { ...REPLY.confirm, tool: 'log_work' } }, WORK] })), 'checkIsSend')).toEqual(['sends.0.confirm.tool'])

    // reads: a check tool missing from it, a send tool in it
    expect(errors(profile({ reads: ['get_item'] })).filter((i) => i.code === 'notInReads').map((i) => `${i.path.join('.')}:${i.vars?.why}`)).toEqual(['sends.0.confirm.tool:read'])
    expect(errors(profile({ reads: ['get_item', 'list_comments', 'add_comment'] })).filter((i) => i.code === 'notInReads').map((i) => `${i.path.join('.')}:${i.vars?.why}`)).toEqual(['sends.0.tool:send'])
    // without reads, any reading tool is fine
    expect(errors(profile({ reads: undefined }))).toEqual([])

    // paths
    expect(at(errors(route({ ...REPLY, check: { ...REPLY.check, fields: ['status', 'comments..x', '1abc'] } })), 'path')).toEqual(['sends.0.check.fields.1', 'sends.0.check.fields.2'])
    expect(errors(route({ ...REPLY, overwrites: 'body' })).filter((i) => i.code === 'path').map((i) => i.vars?.why)).toEqual(['overwrites'])
    expect(errors(route({ ...REPLY, overwrites: 'status' }))).toEqual([])
    expect(at(errors(route({ ...REPLY, confirm: { ...REPLY.confirm, capture: { id: 'items.-1.id', 'bad name': 'id' } } })), 'argKey')).toEqual(['sends.0.confirm.capture.bad name'])
    for (const ok of ['status', 'comments.-1.body', 'items.length', 'a.b.c.d.e.f.g.h', '_x.0']) expect(ROUTE_PATH.test(ok)).toBe(true)
    for (const bad of ['', '.a', 'a.', 'a..b', 'a.b.c.d.e.f.g.h.i', 'a.12345', 'a b', 'a[0]', '__proto__.x.y.z.1.2.3.4.5']) expect(ROUTE_PATH.test(bad)).toBe(false)
    for (const ok of ['10668', 'CNSX-4512', 'a.b:c#1']) expect(ROUTE_KEY.test(ok)).toBe(true)
    for (const bad of ['', '-1', 'a b', 'x'.repeat(65), 'a/b']) expect(ROUTE_KEY.test(bad)).toBe(false)

    // via
    const via = errors(route({ ...REPLY, via: ['worker', 'pigeon'] }))
    expect(via.filter((i) => i.code === 'via').map((i) => `${i.path.join('.')}:${i.vars?.value}`)).toEqual(['sends.0.via.1:pigeon'])
    expect(sanitizeIntegration(route({ ...REPLY, via: ['hand', 'pigeon'] }))!.sends![0]!.via).toEqual(['hand'])

    // the row patch takes plain values
    expect(at(errors(route({ ...REPLY, after: [{ property: 'waiting', value: { on: false } }, { property: 'status', value: null }] })), 'afterValue')).toEqual(['sends.0.after.0.value'])
    expect(sanitizeIntegration(route({ ...REPLY, after: [{ property: 'waiting', value: [1] }, { property: 'status', value: null }] }))!.sends![0]!.after).toEqual([{ property: 'status', value: null }])

    // argument names: never a prototype key (JSON can carry "__proto__" as an own key)
    const proto = JSON.parse('{"ref":"{key}","body":"{draft}","__proto__":{"polluted":true}}')
    expect(at(errors(route({ ...REPLY, args: proto })), 'argKey')).toEqual(['sends.0.args.__proto__'])
    const clean = sanitizeIntegration(route({ ...REPLY, args: proto }))!.sends![0]!.args
    expect(Object.keys(clean)).toEqual(['ref', 'body'])
    expect(({} as AnyState).polluted).toBeUndefined()

    // ≤ 4 KB as JSON (bytes, not characters), nested ≤ 4 levels
    expect(at(errors(route({ ...REPLY, args: { ref: '{key}', body: '{draft}', pad: 'x'.repeat(4100) } })), 'argsSize')).toEqual(['sends.0.args'])
    expect(at(errors(route({ ...REPLY, args: { ref: '{key}', body: '{draft}', pad: 'ü'.repeat(2100) } })), 'argsSize')).toEqual(['sends.0.args'])
    expect(errors(route({ ...REPLY, args: { ref: '{key}', body: '{draft}', a: { b: { c: { d: 1 } } } } }))).toEqual([])
    expect(at(errors(route({ ...REPLY, args: { ref: '{key}', body: '{draft}', a: { b: { c: { d: { e: 1 } } } } } })), 'argsDepth')).toEqual(['sends.0.args.a.b.c.d'])
    // a route whose arguments cannot be used is no route
    expect(sanitizeIntegration(route({ ...REPLY, args: { ref: '{key}', a: { b: { c: { d: { e: 1 } } } } } }))!.sends).toBeUndefined()

    // limits: routes, label length, duplicate ids and roles
    const many = Array.from({ length: SEND_LIMITS.routes + 1 }, (_, i) => ({ ...REPLY, id: `r${i}`, role: `role${i}` }))
    expect(at(errors(profile({ sends: many })), 'tooMany')).toEqual(['sends'])
    expect(sanitizeIntegration(profile({ sends: many }))!.sends).toHaveLength(SEND_LIMITS.routes)
    expect(at(errors(route({ ...REPLY, label: 'L'.repeat(81) })), 'tooLong')).toEqual(['sends.0.label'])
    const dup = profile({ sends: [REPLY, { ...REPLY }, { ...WORK, role: 'reply' }] })
    expect(errors(dup).filter((i) => i.code === 'duplicate').map((i) => i.path.join('.'))).toEqual(['sends.1.id', 'sends.1.role', 'sends.2.role'])
    expect(sanitizeIntegration(dup)!.sends!.map((r) => [r.id, r.role])).toEqual([
      ['reply', 'reply'],
      ['reply-2', undefined],
      ['work', undefined],
    ])
    // an empty list, a route without a tool
    expect(at(errors(profile({ sends: [] })), 'empty')).toEqual(['sends'])
    expect(at(errors(route({ ...REPLY, tool: 'add comment' })), 'tool')).toEqual(['sends.0.tool'])
  })

  test('warnings: matchToolIsSend, noConfirm (via the worker), sendsNeeds (unlocks sends and keys); unknown keys are reported, never fatal', () => {
    expect(warnings(profile({ match: { name: 'tracker', tools: ['get_item', 'add_comment'] } })).map((i) => `${i.code}@${i.path.join('.')}`)).toEqual(['matchToolIsSend@match.tools.1'])
    const { confirm: _c, ...noConfirm } = REPLY
    void _c
    expect(at(warnings(route(noConfirm)), 'noConfirm')).toEqual(['sends.0'])
    // by hand only: nothing to confirm
    expect(at(warnings(route({ ...noConfirm, via: ['hand'] })), 'noConfirm')).toEqual([])
    const needs = warnings(profile({ unlocks: ['upsert'] })).filter((i) => i.code === 'sendsNeeds')
    expect(needs.map((i) => [i.path.join('.'), i.vars?.features])).toEqual([['unlocks', 'sends,keys']])
    expect(warnings(profile({ unlocks: ['keys', 'sends'] })).filter((i) => i.code === 'sendsNeeds')).toEqual([])
    // a key a later version adds: reported in the editor, the route (and its lock) stays for the sanitizer
    const later = route({ ...REPLY, cooldown: 30 })
    expect(at(errors(later), 'unknownKey')).toEqual(['sends.0.cooldown'])
    expect(sanitizeIntegration(later)!.sends![0]!.tool).toBe('add_comment')
    // sends alone is not "unlocks nothing"
    expect(warnings(profile({ unlocks: [] })).some((i) => i.code === 'unlocksNothing')).toBe(false)
  })

  test('the overview: an OUT column per server, names from the profiles that match it by name / host', () => {
    const servers = [
      { id: 's1', name: 'tracker', url: TRACKER.url, token: '', enabled: true, prompt: '' },
      { id: 's2', name: 'wiki', url: WIKI.url, token: '', enabled: false, prompt: '' },
    ] as McpServerConfig[]
    const profiles = [sanitizeIntegration(profile({ sends: [REPLY, WORK] }))!]
    const rows = overviewRows(servers, [], profiles, null)
    expect(rows.map((r) => [r.name, r.out])).toEqual([
      ['tracker', ['add_comment', 'log_work']],
      ['wiki', []],
    ])
  })
})

/* ------------------------------------------------------------------ slice 1b: the Outbox's pure parts */

test.describe('Outbox 1b: templates, fields, states, the seal, counts (pure)', () => {
  const ctx = { key: '10668', params: { draft: 'Hi', minutes: 90 } }

  test('fillArgs builds values: the draft as one whole string, {key} inside a text, {key|number}, {sentAt} kept until the press', () => {
    const r = fillArgs(REPLY as never, { key: '10668', params: { draft: '"}, "x": 1' } })
    expect(r).toEqual({ ok: true, value: { ref: '10668', visibility: 'team', body: '"}, "x": 1' } })
    const w = fillArgs(WORK as never, { key: '10668', params: { minutes: 90 } })
    expect(w).toEqual({ ok: true, value: { ref: 'LDG-10668', minutes: 90, at: SENT_AT, ticket: 10668 } })
    expect(fillArgs(WORK as never, { key: '10668', params: { minutes: 90 }, sentAt: '2026-10-10T08:12:00.000Z' })).toMatchObject({ ok: true, value: { at: '2026-10-10T08:12:00.000Z' } })
    // {key|number}: digits only
    expect(fillArgs(WORK as never, { key: 'CNSX-4512', params: { minutes: 30 } })).toMatchObject({ ok: false, why: 'keyNumber' })
    // a draft inside a longer text, an unknown placeholder, {check.*}, {result.*} outside the read-back: refused at fill time
    expect(fillArgs({ args: { body: 'Re: {draft}' }, params: [{ name: 'draft', type: 'text' }] } as never, ctx)).toMatchObject({ ok: false, why: 'whole' })
    expect(fillArgs({ args: { x: '{nope}' } } as never, ctx)).toMatchObject({ ok: false, why: 'undeclared' })
    expect(fillArgs({ args: { x: '{Nope.x}' } } as never, ctx)).toMatchObject({ ok: false, why: 'unknown' })
    expect(fillArgs({ args: { x: '{check.status}' } } as never, ctx)).toMatchObject({ ok: false, why: 'check' })
    expect(fillArgs({ args: { x: '{result.id}' } } as never, ctx)).toMatchObject({ ok: false, why: 'result' })
    // the read-back: {result.<path>} filled from the send's result, also inside a text
    expect(fillTemplate({ ref: '{key}', id: '{result.items.0.id}', note: 'c-{result.items.-1.id}' }, 'confirm', { key: '10668', params: {}, result: { items: [{ id: 'a1' }, { id: 'b2' }] } })).toEqual({ ok: true, value: { ref: '10668', id: 'a1', note: 'c-b2' } })
    // braces that are no token stay text; nested values are copied
    expect(fillArgs({ args: { q: '{ x }', deep: { list: ['{key}', 2, null] } } } as never, ctx)).toEqual({ ok: true, value: { q: '{ x }', deep: { list: ['10668', 2, null] } } })
    expect(placeholdersOf(WORK.args)).toEqual(['{key}', '{minutes}', '{sentAt}', '{key|number}'])
  })

  test('typed params: text within its limit, minutes rounded to the step and bounded, options from the list', () => {
    expect(cleanParams(REPLY as never, {}, 'Hello')).toEqual({ ok: true, params: { draft: 'Hello' } })
    expect(cleanParams(REPLY as never, {}, 'x'.repeat(4001))).toEqual({ ok: false, problem: { why: 'tooLong', name: 'draft' } })
    expect(cleanParams(REPLY as never, {}, null)).toEqual({ ok: true, params: { draft: '' } })
    expect(cleanParams(WORK as never, { minutes: 98 }, undefined)).toEqual({ ok: true, params: { minutes: 105 } })
    expect(cleanParams(WORK as never, { minutes: '1,5' as never }, undefined)).toMatchObject({ ok: false })
    expect(cleanParams(WORK as never, { minutes: 640 }, undefined)).toMatchObject({ ok: false, problem: { why: 'param' } })
    expect(cleanParams(WORK as never, {}, undefined)).toMatchObject({ ok: false, problem: { name: 'minutes' } })
    const opt = { params: [{ name: 'status', type: 'option', values: ['Open', 'Done'] }] }
    expect(cleanParams(opt as never, { status: 'Done' }, undefined)).toEqual({ ok: true, params: { status: 'Done' } })
    expect(cleanParams(opt as never, { status: 'done' }, undefined)).toMatchObject({ ok: false })
  })

  test('canonicalJson + SHA-256: fixed vectors (the worker hashes the same bytes)', async () => {
    const vectors: Array<[unknown, string, string]> = [
      [{ b: 1, a: [true, null, 'x'] }, '{"a":[true,null,"x"],"b":1}', '54a65415ad370228851a1da4b31b6fd42dc58b19a50d35cae759325f7388ce64'],
      [{ é: '‮', z: 'a"b\n' }, '{"z":"a\\"b\\n","é":"‮"}', '447d88b8dd18229e860bdc8ab04b98e14c6577b99e63c4c4dcdaa30918023d77'],
      [{ a: undefined, c: { y: 2, x: [1, { k: 'v' }] } }, '{"c":{"x":[1,{"k":"v"}],"y":2}}', '35ef94395a80b82310a8fb8059bf3f1da0a0e7d18ddca50f5d64b7b00e38524e'],
      [{ n: 1e21, m: -0, f: 1.5, s: '' }, '{"f":1.5,"m":0,"n":1e+21,"s":""}', 'cf7e380a5185b004ec39c0b68176f08c8f1002cf5f0327c7a8f499dd66461f1c'],
      [{ ref: '10668', visibility: 'team', body: '"}, "x": 1' }, '{"body":"\\"}, \\"x\\": 1","ref":"10668","visibility":"team"}', 'ac69218e2c40f83b2cce4b1c48deb75f8e4b3a294deab0b2cec9cfae96d94a23'],
    ]
    for (const [v, text, sha] of vectors) {
      expect(canonicalJson(v)).toBe(text)
      expect(createHash('sha256').update(text, 'utf8').digest('hex')).toBe(sha)
      expect(await argsHashOf(v as Record<string, unknown>)).toBe(sha)
    }
    expect(() => canonicalJson({ x: Number.NaN })).toThrow()
    const cyc: Record<string, unknown> = {}
    cyc.self = cyc
    expect(() => canonicalJson(cyc)).toThrow()
  })

  test('paths: names, indexes from the end, length — never a prototype; pickFields / diffFields; the row baseline', () => {
    const rec = { ref: '10668', status: 'In Development', comments: [{ body: 'a' }, { body: 'b', by: 'J. Weber' }], meta: { tags: ['x'] } }
    expect(pickPath(rec, 'comments.-1.body')).toBe('b')
    expect(pickPath(rec, 'comments.0.body')).toBe('a')
    expect(pickPath(rec, 'comments.length')).toBe(2)
    expect(pickPath(rec, 'meta.tags.length')).toBe(1)
    expect(pickPath(rec, 'ref.length')).toBe(5)
    expect(pickPath(rec, 'comments.5.body')).toBeUndefined()
    expect(pickPath(rec, 'constructor')).toBeUndefined()
    expect(pickPath(rec, '__proto__.x')).toBeUndefined()
    expect(pickPath(rec, 'comments[0]')).toBeUndefined()
    expect(pickFields(rec, ['status', 'comments.length', 'missing'])).toEqual({ status: 'In Development', 'comments.length': '2', missing: '' })
    expect(diffFields({ status: 'A', n: '7' }, { status: 'A', n: '8', extra: 'x' })).toEqual([
      { field: 'n', before: '7', now: '8' },
      { field: 'extra', before: '', now: 'x' },
    ])
    const b = rowBaseline({ comments: { label: 'Comments', text: '7' }, srcStatus: { label: 'Source status', text: 'Open' }, owner: { label: 'Owner', text: 'J. Weber' } }, 'B6 or B7?')
    expect(b).toEqual({ fields: { comments: '7', srcStatus: 'Open' }, labels: { comments: 'Comments', srcStatus: 'Source status' }, latest: 'B6 or B7?' })
    // changes; a reply this device sent explains one more comment (and the newest one's time when it is that reply)
    const now = { comments: '8', srcStatus: 'Open', lastCommentAt: '2026-10-10T08:09' }
    const base = { comments: '7', srcStatus: 'Open', lastCommentAt: '2026-10-09T16:42' }
    expect(rowChanges(base, now).map((c) => c.field)).toEqual(['comments', 'lastCommentAt'])
    expect(rowChanges(base, now, { texts: ['Take B6.'], latest: 'Take  B6.' })).toEqual([])
    expect(rowChanges(base, now, { texts: ['Take B6.'], latest: 'B7 fits, thanks' }).map((c) => c.field)).toEqual(['lastCommentAt'])
    expect(rowChanges(base, { ...now, comments: '9' }, { texts: ['Take B6.'], latest: 'x' }).map((c) => c.field)).toEqual(['comments', 'lastCommentAt'])
  })

  test('the state machine: every allowed transition, and nothing else (no ready → sent but by hand)', () => {
    const allowed: Array<[SlipState, SlipEvent, SlipState]> = [
      ['missing', 'write', 'ready'],
      ['ready', 'hold', 'held'],
      ['held', 'release', 'ready'],
      ['ready', 'withdraw', 'withdrawn'],
      ['held', 'withdraw', 'withdrawn'],
      ['missing', 'withdraw', 'withdrawn'],
      ['failed', 'withdraw', 'withdrawn'],
      ['ready', 'press', 'sending'],
      ['failed', 'press', 'sending'],
      ['sending', 'ok', 'sent'],
      ['sending', 'failBefore', 'failed'],
      ['sending', 'failAfter', 'unclear'],
      ['sending', 'toolErrorAbsent', 'failed'],
      ['sending', 'toolErrorPresent', 'sent'],
      ['sending', 'toolErrorNoConfirm', 'failed'],
      ['sending', 'boot', 'unclear'],
      ['sent', 'readMatch', 'confirmed'],
      ['sent', 'readMismatch', 'unconfirmed'],
      ['unclear', 'settleArrived', 'sent'],
      ['unclear', 'settleMissing', 'ready'],
      ['ready', 'markSent', 'sent'],
    ]
    const events: SlipEvent[] = ['write', 'hold', 'release', 'withdraw', 'press', 'ok', 'failBefore', 'failAfter', 'toolErrorAbsent', 'toolErrorPresent', 'toolErrorNoConfirm', 'readMatch', 'readMismatch', 'settleArrived', 'settleMissing', 'markSent', 'boot']
    for (const from of SLIP_STATES)
      for (const ev of events) {
        const hit = allowed.find(([f, e]) => f === from && e === ev)
        expect(next(from, ev), `${from} --${ev}->`).toBe(hit ? hit[2] : null)
      }
    // the only ways into 'sent': ok after the write-ahead, a tool error the read-back found, a settled UNCLEAR — and by hand
    const intoSent = allowed.filter(([, , to]) => to === 'sent').map(([f, e]) => `${f}:${e}`)
    expect(intoSent).toEqual(['sending:ok', 'sending:toolErrorPresent', 'unclear:settleArrived', 'ready:markSent'])
    // UNCLEAR never becomes 'failed'
    expect(events.map((e) => next('unclear', e)).includes('failed')).toBe(false)
  })

  const src = (s: Partial<SourceRef> & Pick<SourceRef, 'kind' | 'label'>): SourceRef => ({ ref: s.label, trusted: false, addresses: [], ...s })

  test('the seal: addresses by their source, hidden characters, the person\'s own words, typed values', () => {
    const comment = src({ kind: 'row', label: 'Comment T. Brandt', addresses: addressSet('Plan is in the share: teilen.example/rp — approve it there') })
    const ownPage = src({ kind: 'page', label: 'Baselines overview', trusted: true, addresses: addressSet('Docs: https://docs.example.org/baselines and teilen.example') })
    const typed = src({ kind: 'row', label: 'Comments', typed: true })
    // only in foreign text → 'foreign' with its label; in no source → 'nowhere'
    let s = sealOf({ text: 'Approve here: teilen.example/rp, see also evil.example/x', sources: [comment, typed], complete: true })
    expect(s.addresses.map((a) => [a.norm, a.only, a.source ?? null])).toEqual([
      ['teilen.example/rp', 'foreign', 'Comment T. Brandt'],
      ['evil.example/x', 'nowhere', null],
    ])
    expect(s.foreign).toBe(1)
    expect(s.clean).toBe(false)
    // a host-only trusted match does not clear an address with a path; an exact one does (scheme, www., case, trailing slash ignored)
    s = sealOf({ text: 'see teilen.example/rp and HTTPS://www.Docs.Example.org/baselines/', sources: [ownPage], complete: true })
    expect(s.addresses.map((a) => [a.norm, a.only])).toEqual([['teilen.example/rp', 'nowhere']])
    s = sealOf({ text: 'see teilen.example', sources: [ownPage], complete: true })
    expect(s.addresses).toEqual([])
    // the person's own typing (the instruction, words added in an edit) is trusted
    const added = personAdded('Looks good, approved.', 'Looks good, approved. Copy: teilen.example/rp')
    expect(added).toContain('teilen.example/rp')
    s = sealOf({ text: 'Looks good, approved. Copy: teilen.example/rp', sources: [comment], complete: true, ownText: added })
    expect(s.addresses).toEqual([])
    // Markdown link targets, e-mail addresses; One's own links are internal
    expect(linkTargets('See [the plan](https://teilen.example/rp) and [x](#/p/abc)')).toEqual(['https://teilen.example/rp', '#/p/abc'])
    expect(scanAddresses('Write to Mara.Lind@Nordlicht.example or [x](#/p/abc) or https://one.example/app/#/p/x', 'https://one.example').map((a) => [a.norm, a.kind])).toEqual([
      ['mara.lind@nordlicht.example', 'email'],
      ['#/p/abc', 'internal'],
      ['one.example/app', 'internal'],
    ])
    s = sealOf({ text: 'open #/p/abc', sources: [], complete: true })
    expect(s.addresses.map((a) => a.only)).toEqual(['internal'])
    // file names are not hosts; dates and abbreviations neither
    expect(addressSet('see notes.md, report.pdf, 14.10., z.B. B7')).toEqual([])
    // hidden characters: every class, variation selectors only in runs
    const zoo = 'a​b‮c⁡d⁦e؜f﻿g\u{E0041}h️️i ❤️'
    expect(hiddenChars(zoo)).toEqual(['U+200B', 'U+202E', 'U+2061', 'U+2066', 'U+061C', 'U+FEFF', 'U+E0041', 'U+FE0F'])
    expect(showHidden('ok‮exe')).toBe('ok⟦U+202E⟧exe')
    expect(hiddenChars('I ❤️ it')).toEqual([])
    s = sealOf({ text: 'ok‮exe', sources: [typed], complete: true })
    expect(s.hidden).toEqual(['U+202E'])
    expect(s.clean).toBe(false)
    // typed values never shape free text; a typed-only slip with complete sources is clean; no sources: never clean
    expect(sealOf({ text: null, sources: [typed, comment], complete: true })).toMatchObject({ foreign: 0, clean: true })
    expect(sealOf({ text: 'Thanks!', sources: [typed], complete: true }).clean).toBe(true)
    expect(sealOf({ text: 'Thanks!', sources: [], complete: false }).clean).toBe(false)
    // ticks stay with their address across a recomputation
    const first = sealOf({ text: 'go to teilen.example/rp', sources: [comment], complete: true })
    first.addresses[0].ticked = true
    expect(sealOf({ text: 'please go to teilen.example/rp', sources: [comment], complete: true, previous: first }).addresses[0].ticked).toBe(true)
  })

  test('outboxCounts: open / clean / foreign / held / changed / unclear / missing / sent today — held wins over foreign', () => {
    const now = new Date(2026, 9, 10, 12, 0).getTime()
    const seal = (o: Partial<Slip['seal']> = {}) => ({ complete: true, foreign: 0, addresses: [], hidden: [], cross: false, clean: true, ...o })
    const mk = (state: SlipState, o: Partial<Slip> = {}): Slip => ({ state, seal: seal(), target: { dbId: 'db1' }, ...o }) as Slip
    const foreignSeal = seal({ foreign: 1, clean: false })
    const slips = [
      mk('ready'),
      mk('ready'),
      mk('ready', { seal: foreignSeal }),
      mk('ready', { seal: seal({ addresses: [{ text: 'x', norm: 'x', only: 'foreign', ticked: false }], clean: false }) }),
      mk('held', { seal: foreignSeal }),
      mk('ready', { lastCheck: { at: 1, from: 'row', changed: [{ field: 'comments', before: '7', now: '8' }] } }),
      mk('unclear'),
      mk('missing', { seal: seal({ complete: false, clean: false }) }),
      mk('sent', { receipt: { at: now - 1000 } as Slip['receipt'] }),
      mk('confirmed', { receipt: { at: now - 3600_000 } as Slip['receipt'] }),
      mk('sent', { receipt: { at: now - 86_400_000 } as Slip['receipt'] }),
      mk('withdrawn'),
      mk('ready', { target: { dbId: 'db2' } as Slip['target'] }),
    ]
    expect(outboxCounts(slips, 'db1', now)).toEqual({ open: 8, clean: 2, foreign: 2, held: 1, changed: 1, unclear: 1, missing: 1, sentToday: 2 })
    expect(outboxCounts(slips, null, now).open).toBe(9)
    // "send anyway" read the change: no longer CHANGED
    expect(outboxCounts([mk('ready', { lastCheck: { at: 1, from: 'row', changed: [{ field: 'n', before: '1', now: '2' }], ack: 2 } })], null, now)).toMatchObject({ changed: 0, clean: 1 })
  })
})

/* ------------------------------------------------------------------ T1-guard: who may reach what (static scan) */

test.describe('Outbox guard: a static look at the imports', () => {
  const root = fileURLToPath(new URL('../../src/app', import.meta.url))
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f)
      return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : []
    })
  const read = (p: string) => readFileSync(p, 'utf8')

  test('features/outbox never reaches the MCP attach / toolset / token code; the draft request has no MCP', () => {
    for (const f of files(join(root, 'features/outbox'))) {
      const src = read(f)
      for (const name of ['attachMcp', 'toolsetFor', 'tokenFor', 'getMcpToken', 'mcpParams'])
        expect(new RegExp(`\\b${name}\\b`).test(src), `${f} mentions ${name}`).toBe(false)
      expect(/\bnew Function\b|\beval\(/.test(src), `${f} evaluates code`).toBe(false)
    }
    const draft = read(join(root, 'features/outbox/draft.ts'))
    const calls = draft.match(/completeStructured\(\{[\s\S]*?\}\)/g) ?? []
    expect(calls.length).toBe(1)
    expect(calls[0]).toContain('mcp: false')
    expect(/streamCompletion|runAI\(/.test(draft)).toBe(false)
  })

  test('the MCP token is opened only where it may be; nothing outside the Outbox imports its internals', () => {
    for (const f of files(root)) {
      const rel = f.slice(root.length + 1).replace(/\\/g, '/')
      const src = read(f)
      if (/\bimport[^;]*\b(tokenFor|getMcpToken)\b[^;]*from/.test(src)) expect(['features/ai/mcp-servers/config.ts', 'features/ai/mcp-servers/oauth.ts', 'features/ai/mcp-servers/McpServers.tsx', 'features/ai/mcp-servers/checks.ts', 'store/secrets.ts']).toContain(rel)
      // only its public API (index) — and the strings aggregator (features/messages.ts) — from outside
      if (!rel.startsWith('features/outbox/')) expect(/from ['"][./]*(?:features\/)?outbox\/(?!index|messages['"])[a-zA-Z]/.test(src), `${rel} imports the Outbox's internals`).toBe(false)
    }
    // no sender exists in slice 1: nothing named fire / Arm in the Outbox
    for (const f of files(join(root, 'features/outbox'))) expect(/\bexport (async )?function fire\b|\bexport (class|interface|type|const) Arm\b|import[^;]*\b(fire|Arm)\b[^;]*from/.test(read(f)), f).toBe(false)
    // the bridge / MCP tools never reach the Outbox at all in slice 1
    for (const f of files(join(root, 'features/mcp'))) expect(/outbox/.test(read(f)), f).toBe(false)
  })
})
