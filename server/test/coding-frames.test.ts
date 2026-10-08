/**
 * The coding relay's frame checks (src/coding/frames.ts): only `key`, `box` and the relay's own control frames pass,
 * re-serialised without anything extra — and the constants it copies from the app's protocol (the server image
 * cannot import src/) stay in step with it. This test runs in the repo, never in the image.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as protocol from '../../src/app/features/coding/protocol.ts'
import * as frames from '../src/coding/frames.ts'

const NONCE = 'A'.repeat(43)
const IV = 'B'.repeat(16)
const DATA = 'Q'.repeat(40) + '=='

test('keep in step: paths, subprotocol, limits, close codes, nonce and iv shapes', () => {
  assert.equal(frames.RELAY_TAB_PATH, protocol.RELAY_TAB_PATH)
  assert.equal(frames.RELAY_WORKER_PATH, protocol.RELAY_WORKER_PATH)
  assert.equal(frames.WORKER_SUBPROTOCOL, protocol.WORKER_SUBPROTOCOL)
  assert.equal(frames.RELAY_MAX_FRAME, protocol.RELAY_MAX_FRAME)
  assert.equal(frames.RELAY_CLOSE_AUTH, protocol.RELAY_CLOSE_AUTH)
  assert.equal(frames.RELAY_CLOSE_FORBIDDEN, protocol.RELAY_CLOSE_FORBIDDEN)
  assert.equal(frames.RELAY_CLOSE_IDLE, protocol.RELAY_CLOSE_IDLE)
  assert.deepEqual([...frames.RELAY_CLOSE_TAB_CODES], [...protocol.RELAY_CLOSE_TAB_CODES])
  assert.equal(frames.RELAY_TAB_IDLE_MS, protocol.RELAY_TAB_IDLE_MS)
  assert.equal(frames.RELAY_NONCE.source, protocol.RELAY_NONCE.source)
  assert.equal(frames.RELAY_IV.source, protocol.RELAY_IV.source)
  // a boxed Import chunk (the largest frame either side makes) fits
  assert.ok(Math.ceil((protocol.RELAY_MAX_PLAIN + 16) / 3) * 4 + 200 < frames.RELAY_MAX_FRAME)
})

test('key and box frames pass, re-serialised without extra fields', () => {
  assert.deepEqual(frames.checkFrame(JSON.stringify({ type: 'key', s: 3, n: NONCE, extra: 'x' }), 'tab'), { kind: 'key', s: 3, text: JSON.stringify({ type: 'key', s: 3, n: NONCE }) })
  const box = { type: 'box', s: 2, seq: 9, iv: IV, data: DATA }
  assert.deepEqual(frames.checkFrame(JSON.stringify({ ...box, note: 'dropped' }), 'tab'), { kind: 'box', s: 2, droppable: false, text: JSON.stringify(box) })
  // the worker may mark an event as droppable; the mark does not travel on
  assert.deepEqual(frames.checkFrame(JSON.stringify({ ...box, k: 'e' }), 'worker'), { kind: 'box', s: 2, droppable: true, text: JSON.stringify(box) })
  assert.deepEqual(frames.checkFrame('{"type":"relay","op":"alive"}', 'tab'), { kind: 'alive' })
  assert.deepEqual(frames.checkFrame(JSON.stringify({ type: 'relay', op: 'close-tab', s: 4, code: 4003, reason: 'pair <script>' }), 'worker'), { kind: 'close-tab', s: 4, code: 4003, reason: 'pair script' })
})

test('everything else is refused', () => {
  const bad: Array<[unknown, 'tab' | 'worker']> = [
    // the protocol itself never travels in the clear
    [{ type: 'hello', app: 'one', version: '1', workspace: { id: 'team:x' } }, 'tab'],
    [{ type: 'req', id: 't1', op: 'git', taskId: 'x', verb: 'push' }, 'tab'],
    [{ type: 'req', id: 'w1', op: 'next', repos: [] }, 'worker'],
    [{ type: 'welcome', name: 'box' }, 'worker'],
    [{ type: 'nudge' }, 'tab'],
    // shapes
    [{ type: 'key', s: 0, n: NONCE }, 'tab'],
    [{ type: 'key', s: 1, n: 'short' }, 'tab'],
    [{ type: 'key', s: 1.5, n: NONCE }, 'worker'],
    [{ type: 'box', s: 1, seq: 0, iv: IV, data: DATA }, 'tab'],
    [{ type: 'box', s: 1, seq: 1, iv: 'x', data: DATA }, 'tab'],
    [{ type: 'box', s: 1, seq: 1, iv: IV, data: 'not base64 !' }, 'tab'],
    [{ type: 'box', s: 1, seq: 1, iv: IV, data: 'QQ==' }, 'tab'],
    [{ type: 'box', s: 1, seq: 1, iv: IV, data: DATA, k: 'e' }, 'tab'],
    [{ type: 'box', s: 1, seq: 1, iv: IV, data: DATA, k: 'x' }, 'worker'],
    // control frames of the wrong side or with a code the worker may not ask for
    [{ type: 'relay', op: 'alive' }, 'worker'],
    [{ type: 'relay', op: 'close-tab', s: 1, code: 4003 }, 'tab'],
    [{ type: 'relay', op: 'close-tab', s: 1, code: 1000 }, 'worker'],
    [{ type: 'relay', op: 'close-tab', s: 1, code: 4401 }, 'worker'],
    [{ type: 'relay', op: 'ready' }, 'worker'],
    [[1, 2], 'tab'],
    ['string', 'tab'],
    [null, 'worker'],
  ]
  for (const [frame, from] of bad) assert.equal(frames.checkFrame(JSON.stringify(frame), from), null, `${from}: ${JSON.stringify(frame)}`)
  assert.equal(frames.checkFrame('{not json', 'tab'), null)
  assert.equal(frames.checkFrame(JSON.stringify({ type: 'box', s: 1, seq: 1, iv: IV, data: 'A'.repeat(frames.RELAY_MAX_FRAME) }), 'tab'), null)
})
