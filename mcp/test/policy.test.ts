import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { allowedOrigins, DEFAULT_ORIGINS, isAllowedHost, isAllowedOrigin, normalizeOrigin } from '../src/policy.ts'

describe('origin policy', () => {
  test('normalizes origins and keeps port wildcards', () => {
    assert.equal(normalizeOrigin('https://GetOneCMS.com:443/'), 'https://getonecms.com')
    assert.equal(normalizeOrigin('http://localhost:*'), 'http://localhost:*')
    assert.equal(normalizeOrigin('null'), null)
    assert.equal(normalizeOrigin('file:///Users/me'), null)
    assert.equal(normalizeOrigin('https://user:pw@getonecms.com'), null)
    assert.equal(normalizeOrigin('https://getonecms.com/app/'), null)
  })

  test('the defaults: getonecms.com, localhost and 127.0.0.1 on any port', () => {
    const allow = allowedOrigins(undefined)
    assert.deepEqual(allow, DEFAULT_ORIGINS)
    for (const ok of ['https://getonecms.com', 'http://localhost:5173', 'http://127.0.0.1:4510', 'http://localhost']) assert.equal(isAllowedOrigin(ok, allow), true, ok)
    for (const bad of ['https://evil.example', 'http://getonecms.com', 'https://getonecms.com.evil.example', 'https://www.getonecms.com', 'https://localhost:5173', 'http://127.0.0.2:80', 'null', '', undefined])
      assert.equal(isAllowedOrigin(bad, allow), false, String(bad))
  })

  test('ONE_ORIGINS adds exact origins and host:* wildcards; junk is reported', () => {
    const warnings: string[] = []
    const allow = allowedOrigins(' https://one.example.com/ ,http://box.lan:*, ftp://x, ', (m) => warnings.push(m))
    assert.equal(isAllowedOrigin('https://one.example.com', allow), true)
    assert.equal(isAllowedOrigin('https://one.example.com:8443', allow), false)
    assert.equal(isAllowedOrigin('http://box.lan:3000', allow), true)
    assert.equal(isAllowedOrigin('https://box.lan', allow), false)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0]!, /ftp:\/\/x/)
  })

  test('Host must be a loopback name with the bridge port', () => {
    assert.equal(isAllowedHost('127.0.0.1:47321', 47321), true)
    assert.equal(isAllowedHost('localhost:47321', 47321), true)
    assert.equal(isAllowedHost('[::1]:47321', 47321), true)
    assert.equal(isAllowedHost('LOCALHOST:47321', 47321), true)
    assert.equal(isAllowedHost('127.0.0.1:47322', 47321), false)
    assert.equal(isAllowedHost('evil.example:47321', 47321), false)
    assert.equal(isAllowedHost('127.0.0.1', 47321), false)
    assert.equal(isAllowedHost(undefined, 47321), false)
  })
})
