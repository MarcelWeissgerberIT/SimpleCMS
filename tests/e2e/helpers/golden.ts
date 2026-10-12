/**
 * Golden request bodies at the network level (multi-provider S1, kept until S10 and after): what One sends to
 * api.anthropic.com for a real UI path, normalised only where a run differs by nature — message / tool ids (by order
 * of first appearance), workspace ids made in the test (seed ids are random: the caller passes them), the time of day
 * (the spec pins the browser's clock, so dates stay exact), and
 * base64 payloads (a digest, so a fixture stays small and still byte-exact). Keys are sorted when written.
 *
 * GOLDEN_WRITE=1 writes tests/fixtures/ai/anthropic/golden/<id>.json (once, from the unchanged code); otherwise the
 * captured requests must deep-equal the fixture.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
import type { CapturedRequest } from './providers'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'ai', 'anthropic', 'golden')

export interface NormaliseOptions {
  /** workspace ids (pages, databases, properties, options, views, files …) — replaced by <id#n> in order of first appearance */
  ids?: Iterable<string>
}

const ID_RE = /\b(?:toolu|srvtoolu|mcptoolu|msg)_[A-Za-z0-9_]+/g
// the browser's clock is pinned by the spec (dates stay exact); only the time of day moves while a test runs
const CLOCK_RES: Array<[RegExp, string]> = [
  [/(\d{4}-\d{2}-\d{2})[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g, '$1T<CLOCK>'],
  [/\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp][Mm])?\b/g, '<CLOCK>'],
]
const BASE64_RE = /^[A-Za-z0-9+/]{200,}={0,2}$/

/** One request body (or any JSON), normalised as described above. Sequence numbers are shared through `state`. */
export function normaliseBody(json: unknown, opts: NormaliseOptions = {}, state = newState(opts)): unknown {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return normaliseString(v, state)
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const out: AnyState = {}
      for (const k of Object.keys(v as AnyState).sort()) out[k] = walk((v as AnyState)[k])
      return out
    }
    return v
  }
  return walk(json)
}

interface State {
  seq: Map<string, string>
  counts: Map<string, number>
  ids: string[]
}

function newState(opts: NormaliseOptions): State {
  // longer ids first: one never replaces part of another
  const ids = [...new Set(opts.ids ?? [])].filter((x) => x.length >= 6).sort((a, b) => b.length - a.length)
  return { seq: new Map(), counts: new Map(), ids }
}

function numbered(state: State, raw: string, kind: string): string {
  const hit = state.seq.get(raw)
  if (hit) return hit
  const n = (state.counts.get(kind) ?? 0) + 1
  state.counts.set(kind, n)
  const label = `<${kind}#${n}>`
  state.seq.set(raw, label)
  return label
}

function normaliseString(s: string, state: State): string {
  if (BASE64_RE.test(s)) return `<base64 ${s.length} sha256:${createHash('sha256').update(s).digest('hex').slice(0, 32)}>`
  let out = s.replace(ID_RE, (m) => numbered(state, m, m.slice(0, m.indexOf('_'))))
  for (const id of state.ids) if (out.includes(id)) out = out.split(id).join(numbered(state, id, 'id'))
  for (const [re, to] of CLOCK_RES) out = out.replace(re, to)
  return out
}

/** Every request of a scenario, normalised with one shared numbering. */
export function normaliseRequests(requests: CapturedRequest[], opts: NormaliseOptions = {}): unknown[] {
  const state = newState(opts)
  return requests.map((r) => normaliseBody({ method: r.method, path: r.path, beta: r.beta, body: r.body }, opts, state))
}

/** Write (GOLDEN_WRITE=1) or compare the fixture of a scenario. */
export function expectGolden(id: string, requests: CapturedRequest[], opts: NormaliseOptions = {}): void {
  const got = normaliseRequests(requests, opts)
  const file = join(DIR, `${id}.json`)
  if (process.env.GOLDEN_WRITE === '1') {
    mkdirSync(DIR, { recursive: true })
    writeFileSync(file, `${JSON.stringify(got, null, 2)}\n`)
    return
  }
  expect(existsSync(file), `golden fixture ${id}.json (write it once with GOLDEN_WRITE=1 from the unchanged code)`).toBe(true)
  const want = JSON.parse(readFileSync(file, 'utf8'))
  expect(got, `golden ${id}`).toEqual(want)
}
