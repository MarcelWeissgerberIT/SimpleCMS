/**
 * The end-to-end box of the cloud relay (docs/CODING.md § Cloud worker → Encryption): the tab's WebCrypto box
 * (src/app/features/coding/relayBox.ts) and the worker's node:crypto box (mcp/src/worker/box.ts) open each
 * other's frames, agree on fixed test vectors, and refuse what the relay could try: another pairing, a
 * replayed or reordered box, a reflected box (the other direction), a tampered one, another key.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RELAY_BOX_INFO } from '../../src/app/features/coding/protocol.ts'
import * as tab from '../../src/app/features/coding/relayBox.ts'
import * as worker from '../src/worker/box.ts'

const PAIR = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8' // bytes 0..31
const TAB_NONCE = 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8' // bytes 32..63
const WORKER_NONCE = 'QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8' // bytes 64..95
const IV = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
/**
 * Fixed vectors, computed independently (Python: HKDF-SHA256 by hand with hmac + cryptography's AESGCM):
 * '{"type":"nudge"}' in pairing 7, seq 1, iv 01..0c — worker → tab (AAD "wt:7:1") and tab → worker ("tw:7:1").
 * Same ciphertext, another tag: only the AAD differs.
 */
const W2T = 'O/p6xrw/oROku6Mqx9QbCvXAHtgEobf7kSD6J2xjFSQ='
const T2W = 'O/p6xrw/oROku6Mqx9QbCupaLf4UGmG+pltroBe1kfQ='

test('both sides use the same HKDF info and accept the same key material', () => {
  assert.equal(tab.BOX_INFO, RELAY_BOX_INFO)
  assert.throws(() => worker.sessionKey('short', TAB_NONCE, WORKER_NONCE))
  assert.equal(worker.newNonce().length, 43)
  assert.equal(tab.newNonce().length, 43)
  assert.deepEqual([...tab.fromB64url(PAIR)], [...Array(32).keys()])
})

test('this device keeps the pairing secret as a non-extractable key: the same session as from the secret, never readable again', async () => {
  const kept = await tab.importPairKey(PAIR)
  assert.equal(kept.extractable, false)
  assert.equal(kept.algorithm.name, 'HKDF')
  await assert.rejects(crypto.subtle.exportKey('raw', kept))
  await assert.rejects(tab.importPairKey('short'))
  const t = new tab.BoxSession(await tab.sessionKey(kept, TAB_NONCE, WORKER_NONCE), 7, 'tab')
  const w = new worker.BoxSession(worker.sessionKey(PAIR, TAB_NONCE, WORKER_NONCE), 7, 'worker')
  assert.equal(await t.open(w.seal('{"type":"nudge"}', false, Buffer.from(IV))), '{"type":"nudge"}')
  assert.equal((await t.seal('{"type":"nudge"}', false, IV)).data, T2W, 'the fixed vector from the kept key')
  // the session keys themselves never leave WebCrypto either
  await assert.rejects(crypto.subtle.exportKey('raw', await tab.sessionKey(kept, TAB_NONCE, WORKER_NONCE)))
})

test('fixed vectors: the worker seals what the tab opens and the other way round', async () => {
  const wKey = worker.sessionKey(PAIR, TAB_NONCE, WORKER_NONCE)
  const tKey = await tab.sessionKey(PAIR, TAB_NONCE, WORKER_NONCE)
  const w = new worker.BoxSession(wKey, 7, 'worker')
  const t = new tab.BoxSession(tKey, 7, 'tab')
  const fromWorker = w.seal('{"type":"nudge"}', false, Buffer.from(IV))
  assert.deepEqual(fromWorker, { type: 'box', s: 7, seq: 1, iv: 'AQIDBAUGBwgJCgsM', data: fromWorker.data })
  assert.equal(fromWorker.data, W2T, `vector worker → tab: ${fromWorker.data}`)
  assert.equal(await t.open(fromWorker), '{"type":"nudge"}')
  const fromTab = await t.seal('{"type":"nudge"}', false, IV)
  assert.equal(fromTab.data, T2W, `vector tab → worker: ${fromTab.data}`)
  assert.equal(w.open(fromTab), '{"type":"nudge"}')
})

test('a long conversation in both directions, large frames and droppable events', async () => {
  const w = new worker.BoxSession(worker.sessionKey(PAIR, TAB_NONCE, WORKER_NONCE), 3)
  const t = new tab.BoxSession(await tab.sessionKey(PAIR, TAB_NONCE, WORKER_NONCE), 3, 'tab')
  const big = JSON.stringify({ type: 'req', id: 't1', op: 'intake-chunk', uploadId: 'u', data: 'x'.repeat(5_600_000) })
  const boxed = await t.seal(big)
  assert.equal(w.open(boxed), big)
  for (let i = 0; i < 20; i++) {
    const ev = w.seal(JSON.stringify({ type: 'event', i, text: 'äöü ✓' }), true)
    assert.equal(ev.k, 'e')
    assert.equal(JSON.parse(await t.open(ev)).i, i)
  }
  // the relay may drop events: a gap in seq is fine, going back is not
  w.seal('{"dropped":1}', true)
  assert.equal(await t.open(w.seal('{"after":"gap"}')), '{"after":"gap"}')
})

test('refused: another pairing, replay, reorder, reflection, tampering, another key', async () => {
  const wKey = worker.sessionKey(PAIR, TAB_NONCE, WORKER_NONCE)
  const w = new worker.BoxSession(wKey, 5)
  const t = new tab.BoxSession(await tab.sessionKey(PAIR, TAB_NONCE, WORKER_NONCE), 5, 'tab')
  const a = w.seal('{"n":1}')
  const b = w.seal('{"n":2}')
  await assert.rejects(t.open({ ...a, s: 6 }), /order/)
  assert.equal(await t.open(b), '{"n":2}')
  await assert.rejects(t.open(a), /order/, 'an older box after a newer one')
  await assert.rejects(t.open(b), /order/, 'the same box twice')
  // reflection: the worker's own box handed back to the worker (the other direction's AAD)
  const w2 = new worker.BoxSession(wKey, 5)
  assert.throws(() => w2.open(w.seal('{"n":3}')))
  // tampered ciphertext / iv
  const c = w.seal('{"n":4}')
  const flipped = Buffer.from(c.data, 'base64')
  flipped[0] = flipped[0]! ^ 1
  await assert.rejects(t.open({ ...c, data: flipped.toString('base64') }))
  await assert.rejects(t.open({ ...w.seal('{"n":5}'), iv: 'AAAAAAAAAAAAAAAA' }))
  // another pairing secret (another download, another device) or other nonces: nothing opens
  const other = new tab.BoxSession(await tab.sessionKey(tab.newNonce(), TAB_NONCE, WORKER_NONCE), 5, 'tab')
  await assert.rejects(other.open(w.seal('{"n":6}')))
  const fresh = new tab.BoxSession(await tab.sessionKey(PAIR, tab.newNonce(), WORKER_NONCE), 5, 'tab')
  await assert.rejects(fresh.open(w.seal('{"n":7}')))
  // shapes
  await assert.rejects(t.open({ s: 5, seq: 99, iv: 'short', data: 'AAAA' }), /bad box/)
  await assert.rejects(t.open({ s: 5, seq: 1.5, iv: 'AAAAAAAAAAAAAAAA', data: 'AAAA' }), /order/)
})
