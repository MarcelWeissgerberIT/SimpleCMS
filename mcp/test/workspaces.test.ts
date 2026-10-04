/**
 * The bridge's workspace resolution on its own (mcp/src/workspaces.ts): which connected tab a call's
 * `workspace` argument picks — or why none.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { describe as describeTab, resolveWorkspace, type Candidate } from '../src/workspaces.ts'

let seq = 0
const tab = (id: string | undefined, name: string, extra: Partial<Candidate> = {}): Candidate => ({
  info: { workspace: { ...(id ? { id } : {}), name, kind: id?.startsWith('team:') ? 'team' : 'local', readOnly: false }, mode: 'ask' },
  origin: 'https://getonecms.com',
  bound: !!id,
  seq: ++seq,
  ...extra,
})

const pick = (all: Candidate[], arg: unknown, last: Candidate | null = null) => {
  const r = resolveWorkspace(all, arg, last?.info.workspace ?? null)
  return r.ok ? r.target.info.workspace.id ?? r.target.info.workspace.name : r.error.split(':')[0]
}

describe('resolveWorkspace', () => {
  const personal = tab('local:p1', 'Personal')
  const acme = tab('team:a1', 'Acme Studio')
  const acme2 = tab('team:a2', 'acme studio')

  test('one connected: used without "workspace"', () => {
    assert.equal(pick([personal], undefined), 'local:p1')
    assert.equal(pick([personal], ''), 'local:p1')
    assert.equal(pick([personal], null), 'local:p1')
  })

  test('several connected: "workspace" is required', () => {
    assert.equal(pick([personal, acme], undefined), 'workspace_required')
  })

  test('by id first, then by name (case-insensitive, trimmed, inner spaces collapsed)', () => {
    assert.equal(pick([personal, acme], 'team:a1'), 'team:a1')
    assert.equal(pick([personal, acme], '  ACME   studio '), 'team:a1')
    assert.equal(pick([personal, acme], 'personal'), 'local:p1')
    // ids are exact
    assert.equal(pick([personal, acme], 'TEAM:A1'), 'workspace_unknown')
  })

  test('a shared name is ambiguous — the ids still work', () => {
    const r = resolveWorkspace([acme, acme2], 'Acme Studio')
    assert.equal(r.ok, false)
    assert.match(!r.ok ? r.error : '', /team:a1, team:a2/)
    assert.equal(pick([acme, acme2], 'team:a2'), 'team:a2')
  })

  test('unknown names list what is connected; id-shaped values match ids only', () => {
    const r = resolveWorkspace([personal, acme], 'Globex')
    assert.match(!r.ok ? r.error : '', /Connected: "Personal" \(local:p1\), "Acme Studio" \(team:a1\)/)
    const spoof = tab('local:x', 'team:a9')
    assert.equal(pick([spoof], 'team:a9'), 'workspace_unknown')
    assert.equal(pick([spoof], 'local:x'), 'local:x')
  })

  test('not a string, or far too long: refused', () => {
    assert.match(!resolveWorkspace([personal], 7).ok ? 'refused' : '', /refused/)
    assert.equal(resolveWorkspace([personal], 'x'.repeat(201)).ok, false)
  })

  test('the same id twice (two sites): ambiguous, never the first one', () => {
    const other = tab('team:a1', 'Acme Studio', { origin: 'http://localhost:5173' })
    assert.equal(pick([acme, other], 'team:a1'), 'workspace_ambiguous')
  })

  test('without "workspace", another workspace in the last one\'s place is a mismatch', () => {
    assert.equal(pick([acme], undefined, personal), 'workspace_mismatch')
    assert.equal(pick([personal], undefined, personal), 'local:p1')
    // naming it explicitly is fine
    assert.equal(pick([acme], 'team:a1', personal), 'team:a1')
    // older apps have no id: nothing to compare (the behaviour before workspaces)
    const old = tab(undefined, 'Old')
    assert.equal(pick([old], undefined, personal), 'Old')
  })

  test('the listing: no content, the mode in words, older apps flagged', () => {
    const viewer = tab('team:v1', 'Field Notes')
    viewer.info.workspace.readOnly = true
    assert.deepEqual(describeTab(viewer, true), {
      id: 'team:v1',
      name: 'Field Notes',
      kind: 'team',
      access: 'read-only',
      readOnly: true,
      mode: 'ask',
      changes: 'Refused: the person can only view this workspace.',
      site: 'https://getonecms.com',
      newest: true,
    })
    assert.match(describeTab(tab(undefined, 'Old'), false).note ?? '', /older One version/)
  })
})
