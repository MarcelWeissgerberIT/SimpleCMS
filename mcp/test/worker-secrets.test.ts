/**
 * worker 1.13.0: secrets never reach One — a credential variable's value and key-shaped text leave every text the worker
 * sends (log lines, tool lines and their edit hunks, sections, errors) through the Scrubber, before any cut to length;
 * and the auth line names which credential Claude Code uses by its last 4 characters only.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { editOf, toolLine } from '../src/worker/claude.ts'
import { Scrubber } from '../src/worker/scrub.ts'
import { claudeAuth, scrubSecretText, secretValues } from '../src/worker/secrets.ts'
import { scrubOutcome, secretLine } from '../src/worker/worker.ts'

const KEY = 'wsk_workshopKEY_abcdefghij9876'
const LIT = 'sk-ant-api03-AbCdEfGhIjKlMnOpQrSt_uv-1234'
const ENV = { ANTHROPIC_API_KEY: KEY, MY_SERVICE_TOKEN: 'tok_0123456789abcdef', SHORT_KEY: 'abc', PATH: '/usr/bin', EDITOR: 'nano-but-very-long-value' }

const clean = (s: string) => {
  assert.ok(!s.includes(KEY), `the env key in: ${s}`)
  assert.ok(!s.includes('sk-ant-'), `a key-shaped text in: ${s}`)
  // nor any long piece of either (a cut never leaves half a key)
  assert.ok(!s.includes(KEY.slice(0, 12)) && !s.includes(LIT.slice(0, 16)), `a piece of a key in: ${s}`)
}

describe('secret values', () => {
  test('named credentials and *KEY / *TOKEN / *SECRET / *PASSWORD variables of 12+ characters — nothing else', () => {
    const v = secretValues(ENV)
    assert.deepEqual(v.map((x) => x.name).sort(), ['ANTHROPIC_API_KEY', 'MY_SERVICE_TOKEN'])
    assert.equal(scrubSecretText(`a ${KEY} b`, v), 'a [secret ANTHROPIC_API_KEY] b')
    assert.equal(scrubSecretText(`x ${LIT} y`, v), 'x •••• y')
    // idempotent: the markers match no rule
    const once = scrubSecretText(`${KEY} ${LIT} tok_0123456789abcdef`, v)
    assert.equal(scrubSecretText(once, v), once)
    assert.equal(once, '[secret ANTHROPIC_API_KEY] •••• [secret MY_SERVICE_TOKEN]')
  })

  test('the Scrubber removes secrets before paths — from any text, also next to a path', () => {
    const sc = new Scrubber([['/work/repo', '<repo>']], { platform: 'linux', home: '/home/me', tmp: '/tmp', env: ENV, realpath: (p) => p })
    const s = sc.text(`ANTHROPIC_API_KEY=${KEY} in /work/repo/.env and ${LIT} at /home/me/x`)
    clean(s)
    assert.equal(s, 'ANTHROPIC_API_KEY=[secret ANTHROPIC_API_KEY] in <repo>/.env and •••• at ~/x')
  })

  test('a log line, a tool line, an edit hunk, a section and an error: none holds a key — scrubbed before the cut', () => {
    const sc = new Scrubber([], { platform: 'linux', home: '/home/me', tmp: '/tmp', env: ENV, realpath: (p) => p })
    const scrub = (s: string) => sc.text(s)
    // the key right across the tool line's 300-character cut
    const pad = 'x'.repeat(285)
    const line = toolLine('Bash', { command: `${pad} ${KEY} ${LIT}` }, scrub)
    clean(line)
    const edit = editOf('Edit', { file_path: `/home/me/${KEY}.txt`, old_string: `old ${LIT}`, new_string: `${'y\n'.repeat(1990)}KEY=${KEY}\n` }, scrub)!
    for (const t of [edit.path, ...edit.hunks.flatMap((h) => [h.old, h.new])]) clean(t)
    const out = scrubOutcome({ status: 'failed', error: `Claude Code exited: ${KEY}`, summary: `## Done\n${LIT}`, plan: `uses ${KEY}`, question: `ok with ${LIT}?` }, sc)
    for (const t of [out.error, out.summary, out.plan, out.question]) clean(t!)
    // the backstop of every log line: text, values, edit
    const l = secretLine({ t: 1, k: 'claude', s: `key ${KEY}`, c: 'x', v: { what: LIT, n: 3 }, e: { path: KEY, hunks: [{ old: LIT, new: KEY }] } }, secretValues(ENV))
    clean(JSON.stringify(l))
    assert.equal(l.v!.n, 3)
  })
})

describe('the auth line', () => {
  test('cloud provider → auth token → API key → sign-in token → the person\'s sign-in; never more than the last 4', () => {
    assert.deepEqual(claudeAuth({ CLAUDE_CODE_USE_BEDROCK: '1', ANTHROPIC_API_KEY: KEY }).v, { provider: 'Amazon Bedrock' })
    assert.equal(claudeAuth({ CLAUDE_CODE_USE_VERTEX: '0', ANTHROPIC_API_KEY: KEY }).code, 'authApiKey')
    const tok = claudeAuth({ ANTHROPIC_AUTH_TOKEN: 'tok_zzzzzzzzzzzz4321', ANTHROPIC_API_KEY: KEY })
    assert.deepEqual([tok.code, tok.v.last], ['authToken', '…4321'])
    const key = claudeAuth({ ANTHROPIC_API_KEY: KEY })
    assert.equal(key.code, 'authApiKey')
    assert.deepEqual(key.v, { name: 'ANTHROPIC_API_KEY', last: '…9876' })
    assert.equal(key.s, 'Claude Code bills: API key from ANTHROPIC_API_KEY · …9876')
    assert.ok(!JSON.stringify(key).includes(KEY.slice(0, -4)))
    assert.equal(claudeAuth({ CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-xxxxxxxxxxxx' }).code, 'authOAuthToken')
    assert.equal(claudeAuth({ ANTHROPIC_API_KEY: '  ' }).code, 'authLogin')
    // a short value: no characters at all
    assert.equal(claudeAuth({ ANTHROPIC_API_KEY: 'short' }).v.last, '…')
  })
})
