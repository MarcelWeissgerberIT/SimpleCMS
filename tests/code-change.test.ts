import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  readChange,
  newChange,
  readProposal,
  applyRanges,
  lineDiff,
  packageText,
  validateFiles,
} from '../src/shared/codeChange/model.ts'
import { guardedAtlasCodeCall } from '../src/shared/mcp/atlasCode.ts'
const reference = {
  server: 'atlas',
  citation: {
    repo: 'r',
    snapshot: 's',
    commit: 'a'.repeat(40),
    path: 'src/Button.tsx',
    lines: [2, 3] as [number, number],
    digest: 'b'.repeat(64),
  },
}
const file = { id: 'f', reference, before: ['old', 'keep'], checkedAt: 1 }
const proposal = {
  id: 'p',
  at: 2,
  instruction: 'Update label',
  reason: 'Use clear label',
  checks: ['Check keyboard focus'],
  edits: [{ file: 'f', after: ['new', 'keep'] }],
  author: 'you' as const,
}
test('portable proposal roundtrip keeps base and acceptance separate', () => {
  const a = newChange('a', { analysis: 'a', revision: 'r', finding: 'f', title: 'Label' }, [reference])
  a.files = [file]
  a.proposals = [proposal]
  assert.deepEqual(readChange(JSON.stringify(a)), a)
  assert.equal(JSON.parse(packageText(a, proposal)).accepted, false)
  a.accepted = 'p'
  assert.equal(JSON.parse(packageText(a, proposal)).checks.tests, 'not-run')
})
test('range application preserves unrelated bytes, CRLF and terminal newline', () => {
  assert.equal(
    applyRanges('first\r\nold\r\nkeep\r\nlast\r\n', file, ['new', 'keep']),
    'first\r\nnew\r\nkeep\r\nlast\r\n',
  )
  assert.equal(applyRanges('first\nold\nkeep', file, ['new']), 'first\nnew')
  assert.throws(() => applyRanges('first\nchanged\nkeep', file, ['new']))
  assert.throws(() => applyRanges('first\r\nold\nkeep', file, ['new']))
})
test('no-op, foreign file and oversized changes are refused', () => {
  assert.throws(() => readProposal({ ...proposal, edits: [{ file: 'f', after: file.before }] }, [file]))
  assert.throws(() => readProposal({ ...proposal, edits: [{ file: 'other', after: ['x'] }] }, [file]))
  assert.throws(() => readProposal({ ...proposal, edits: [{ file: 'f', after: Array(161).fill('x') }] }, [file]))
})
test('scope refuses mixed snapshots, overlaps and traversal', () => {
  assert.throws(() => validateFiles([file, { ...file, id: 'g' }]))
  assert.throws(() =>
    validateFiles([
      file,
      {
        ...file,
        id: 'g',
        reference: { ...reference, citation: { ...reference.citation, snapshot: 'new', lines: [6, 7] } },
      },
    ]),
  )
  assert.throws(() =>
    validateFiles([{ ...file, reference: { ...reference, citation: { ...reference.citation, path: '../secret' } } }]),
  )
})
test('diff highlights actual changed rows and keeps context', () => {
  assert.deepEqual(
    lineDiff(['a', 'b', 'c'], ['a', 'new', 'c']).map((x) => [x.kind, x.text]),
    [
      ['same', 'a'],
      ['remove', 'b'],
      ['add', 'new'],
      ['same', 'c'],
    ],
  )
})
test('model tools cannot publish; explicit human path still checks repository permission', async () => {
  const calls: string[] = []
  const call = async (name: string) => {
    calls.push(name)
    return name === 'atlas_code_repos' ? { items: [{ id: 'r', modelProcessing: true }], next: null } : { ok: true }
  }
  const denied = (await guardedAtlasCodeCall('atlas_code_change_publish', { repo: 'r' }, call, () => true)) as any
  assert.equal(denied.oneNotExecuted, true)
  assert.deepEqual(calls, [])
  await guardedAtlasCodeCall('atlas_code_change_publish', { repo: 'r' }, call, () => true, 'code-change-publish')
  assert.deepEqual(calls, ['atlas_code_repos', 'atlas_code_change_publish', 'atlas_code_repos'])
})
