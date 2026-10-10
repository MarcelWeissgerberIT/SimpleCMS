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
