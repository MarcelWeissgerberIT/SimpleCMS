/**
 * The OpenRouter wire (multi-provider S2), pure, in Node — never a real host (helpers/noNet.ts first): the SSE parser
 * at every split point, the Chat Completions body for models and the Jev Router (golden snapshots), the body guard,
 * the stream parser and the error table over doc-derived fixtures (tests/fixtures/ai/openrouter/doc — each names its
 * ordocs source; none checked against a real response yet: "verify with a real key").
 */
import { NO_NET, netGuarded } from './helpers/noNet'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { createSSEParser, type SSEEvent } from '../../src/shared/ai/sse'

const fixture = <T = Record<string, unknown>>(name: string): T => JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/ai/openrouter/doc/${name}.json`, import.meta.url)), 'utf8')) as T

/** Every event (and comment) of a text fed in the given pieces. */
function parse(pieces: string[]): { events: SSEEvent[]; comments: string[] } {
  const events: SSEEvent[] = []
  const comments: string[] = []
  const p = createSSEParser(
    (e) => events.push(e),
    (c) => comments.push(c),
  )
  for (const x of pieces) p.feed(x)
  p.end()
  return { events, comments }
}

test.describe('sse', () => {
  test('the guard is on: a Node spec reaching the network fails (positive control)', async () => {
    expect(netGuarded()).toBe(true)
    await expect(fetch('https://openrouter.ai/api/v1/models')).rejects.toThrow(NO_NET)
  })

  test('every split point of a stream gives the same events (comments, CRLF, multi-line data, [DONE])', () => {
    const stream = fixture<{ source: string; sse: string }>('stream-text').sse
    const whole = parse([stream])
    expect(whole.events.length).toBeGreaterThan(3)
    expect(whole.comments).toEqual(['OPENROUTER PROCESSING'])
    expect(whole.events.at(-1)!.data).toBe('[DONE]')
    for (let i = 1; i < stream.length; i++) expect(parse([stream.slice(0, i), stream.slice(i)]), `split at ${i}`).toEqual(whole)
    // one character at a time
    expect(parse([...stream])).toEqual(whole)
    // the same stream with CRLF line ends, split anywhere (a CR and its LF in different pieces too)
    const crlf = stream.replace(/\n/g, '\r\n')
    for (let i = 1; i < crlf.length; i += 7) expect(parse([crlf.slice(0, i), crlf.slice(i)]), `CRLF split at ${i}`).toEqual(whole)
  })

  test('CRLF and lone CR line ends, a CR split from its LF, a BOM, fields and comments', () => {
    const crlf = ': keep-alive\r\nevent: note\r\nid: 7\r\ndata: one\r\ndata: two\r\n\r\ndata: three\r\r'
    const want = { events: [{ event: 'note', data: 'one\ntwo', id: '7' }, { data: 'three', id: '7' }], comments: ['keep-alive'] }
    expect(parse([crlf])).toEqual(want)
    expect(parse([crlf.slice(0, crlf.indexOf('\r\n') + 1), crlf.slice(crlf.indexOf('\r\n') + 1)])).toEqual(want)
    expect(parse(['﻿data: x\n\n'])).toEqual({ events: [{ data: 'x' }], comments: [] })
    // a field without a colon, a value without its space, retry and unknown fields
    expect(parse(['data\nretry: 300\nfoo: bar\ndata:y\n\n'])).toEqual({ events: [{ data: '\ny' }], comments: [] })
    // a blank line with no data dispatches nothing
    expect(parse(['event: ping\n\n\n']).events).toEqual([])
  })

  test('a trailing event without a blank line is dispatched on end()', () => {
    expect(parse(['data: {"a":1}\n\ndata: last']).events).toEqual([{ data: '{"a":1}' }, { data: 'last' }])
    expect(parse(['data: last\n']).events).toEqual([{ data: 'last' }])
  })
})
