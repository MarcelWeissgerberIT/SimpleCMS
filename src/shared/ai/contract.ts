/**
 * The adapter contract cases (design § 20, K1–K28) as data: what each case proves, the fixtures it reads (names only —
 * `doc/<name>` = derived from the docs snapshot, `recorded/<spike>` = a real exchange, scrubbed) and what it expects.
 * tests/e2e/ai-adapters-contract.spec.ts runs every case against each adapter (OpenRouter with a stubbed fetch, and a
 * fake adapter that checks the harness itself). A case that only a real key can settle has a recorded twin that stays
 * `fixme` until the owner's spike transcripts exist; cases of later slices are reserved here as `fixme` too. K21–K27 are the
 * decisions surface (slice SJ: OpenRouter's alpha decisions API, the Jev family).
 */

export type CaseRun =
  /** run against the adapter (doc-derived), with a recorded twin pending the named spike */
  | { run: 'doc'; spike: string }
  /** run at parse level only (slice 2 has no tool loop) */
  | { run: 'parse' }
  /** not applicable to this provider — a variant case proves the opposite */
  | { run: 'variant'; of: string }
  /** reserved for a later slice */
  | { run: 'fixme'; why: string }

export interface ContractCase {
  id: string
  title: string
  fixtures: readonly string[]
  /** how the case runs for OpenRouter in slice 2 */
  openrouter: CaseRun
  expect: Readonly<Record<string, unknown>>
}

export const CONTRACT_CASES: readonly ContractCase[] = [
  { id: 'K1', title: 'text stream: deltas in order, one whole turn, usage', fixtures: ['doc/stream-text'], openrouter: { run: 'doc', spike: 'SP-R2' }, expect: { text: 'The launch plan is on track for Friday.', stop: 'end', reportedUsd: 0.000271 } },
  { id: 'K2', title: 'structured answer: a strict JSON schema, every parameter required', fixtures: ['doc/stream-json'], openrouter: { run: 'doc', spike: 'SP-R2' }, expect: { json: { rows: [{ Name: 'Tessera', Status: 'Open' }] }, strict: true, requireParameters: true } },
  { id: 'K3', title: 'one tool call streamed in fragments', fixtures: ['doc/stream-tools'], openrouter: { run: 'parse' }, expect: { call: { id: 'call_a1', name: 'search_pages', input: { query: 'launch' } } } },
  { id: 'K4', title: 'two tool calls in one answer, by index', fixtures: ['doc/stream-tools'], openrouter: { run: 'parse' }, expect: { calls: 2, stop: 'tool_calls' } },
  { id: 'K5', title: 'a tool-result round replayed natively to the same model', fixtures: [], openrouter: { run: 'fixme', why: 'S3: the neutral tool loop (SP-R4)' }, expect: {} },
  { id: 'K6', title: 'a refusal the model wrote is a stop reason, not an answer', fixtures: ['doc/stream-refusal'], openrouter: { run: 'doc', spike: 'SP-R2' }, expect: { stop: 'refusal' } },
  { id: 'K7', title: 'the budget ran out inside a tool call: the cut call is never emitted', fixtures: ['doc/stream-tool-cut'], openrouter: { run: 'parse' }, expect: { stop: 'max_tokens', calls: 0, text: 'Looking it up.' } },
  { id: 'K8', title: 'usage with cache reads and writes: the reported cost wins, nothing priced twice', fixtures: ['doc/stream-cache'], openrouter: { run: 'doc', spike: 'SP-R2' }, expect: { input: 500, cacheRead: 10000, cacheWrite: 1500, reportedUsd: 0.002125 } },
  { id: 'K9', title: 'the error matrix: every documented status / limit source / error type → one code, nothing billed', fixtures: ['doc/errors'], openrouter: { run: 'doc', spike: 'SP-R2' }, expect: { reach: 'refused' } },
  { id: 'K10', title: 'a mid-stream error frame (partial text kept) and a 200 holding only an error', fixtures: ['doc/stream-midstream-error', 'doc/stream-only-error'], openrouter: { run: 'doc', spike: 'SP-R2' }, expect: { mid: 'rate_limit', partial: 'The plan ', only: 'unavailable' } },
  { id: 'K11', title: 'SSE noise: keep-alive comments, CRLF, pieces split anywhere', fixtures: ['doc/stream-text'], openrouter: { run: 'doc', spike: 'SP-R2' }, expect: { text: 'The launch plan is on track for Friday.' } },
  { id: 'K12', title: 'another model or upstream served: substituted; outside the pins or denied → policy', fixtures: ['doc/stream-text'], openrouter: { run: 'doc', spike: 'SP-R2' }, expect: { step: 'substituted', denied: 'upstream:Nordwind' } },
  { id: 'K13', title: 'stopped mid-stream: the fetch is aborted, the turn so far kept, it went out (an estimate)', fixtures: ['doc/stream-text'], openrouter: { run: 'doc', spike: 'SP-R2' }, expect: { code: 'aborted', reach: 'sent' } },
  { id: 'K14', title: 'OUT lock: no body offers tools or MCP; every MCP server skipped as provider', fixtures: [], openrouter: { run: 'doc', spike: 'SP-R6' }, expect: { skipped: 'provider' } },
  { id: 'K15', title: 'a picture and a PDF go as parts; what the model cannot read is refused before sending', fixtures: [], openrouter: { run: 'doc', spike: 'SP-R5' }, expect: { vision: 'capability', pdf: 'capability' } },
  { id: 'K16', title: "cache 'none': no breakpoint in the body", fixtures: [], openrouter: { run: 'doc', spike: 'SP-R2' }, expect: { cacheControl: false } },
  { id: 'K17', title: 'a small answer budget on a mandatory reasoner: room for reasoning, effort clamped, an answer', fixtures: ['doc/stream-reasoning'], openrouter: { run: 'doc', spike: 'SP-R2' }, expect: { maxTokens: 1224, text: 'Launch: Friday.' } },
  { id: 'K18', title: "'content' arrives before the first text, reasoning or tool call", fixtures: ['doc/stream-text', 'doc/stream-reasoning', 'doc/stream-tools'], openrouter: { run: 'doc', spike: 'SP-R2' }, expect: {} },
  { id: 'K19', title: '529 after an MCP call: no second request', fixtures: [], openrouter: { run: 'variant', of: 'K19-or' }, expect: {} },
  { id: 'K19-or', title: 'no MCP is ever rendered for OpenRouter (a plan with servers changes nothing in the body)', fixtures: [], openrouter: { run: 'doc', spike: 'SP-R6' }, expect: { mcpServers: false } },
  { id: 'K20', title: 'neutralize(): a turn from another provider closes into <previous_steps>', fixtures: [], openrouter: { run: 'fixme', why: 'S3: conversations across providers' }, expect: {} },
  { id: 'K21', title: 'decisions: noul, choice and score parsed (the tutorial with its reported output tokens, the API example, another model\'s image answer)', fixtures: ['doc/decisions-tutorial', 'doc/decisions-api-example', 'doc/decisions-multimodal'], openrouter: { run: 'doc', spike: 'SP-J1' }, expect: { isBug: 0.96, team: 'payments', urgency: 1.99, output: 70, reportedUsd: 0.000019992, served: 'typesafe/jev-1.13-20260917', upstream: 'TypeSafe' } },
  { id: 'K22', title: "decisions: an unanswered question, noul 1.4 or a choice not offered → 'empty' (it went out: metered from its usage)", fixtures: ['doc/decisions-tutorial'], openrouter: { run: 'doc', spike: 'SP-J1' }, expect: { code: 'empty', reach: 'sent', reportedUsd: 0.000019992 } },
  { id: 'K23', title: 'decisions: the error matrix — every documented status → one code, nothing billed', fixtures: ['doc/decisions-errors'], openrouter: { run: 'doc', spike: 'SP-J1' }, expect: { reach: 'refused' } },
  { id: 'K24', title: 'decisions: stopped before sending → never sent; stopped while in flight → it went out (an estimate)', fixtures: ['doc/decisions-tutorial'], openrouter: { run: 'doc', spike: 'SP-J1' }, expect: { code: 'aborted', before: 'none', inFlight: 'sent' } },
  { id: 'K25', title: 'decisions: body safety — the pins, fallbacks off, the data rule; never session_id / trace / user / require_parameters; a pinned Jev version only', fixtures: ['doc/decisions-tutorial'], openrouter: { run: 'doc', spike: 'SP-J1' }, expect: { only: ['typesafe'], dataCollection: 'deny', refused: 'capability' } },
  { id: 'K26', title: "decisions: another snapshot served than the one confirmed → 'changed'; an operator outside the pins → 'upstream'", fixtures: ['doc/decisions-tutorial'], openrouter: { run: 'doc', spike: 'SP-J1' }, expect: { changed: 'changed', upstream: 'upstream' } },
  { id: 'K27', title: "decisions: a state over the cap → 'context' before anything is sent", fixtures: [], openrouter: { run: 'doc', spike: 'SP-J1' }, expect: { code: 'context', reach: 'none', posts: 0 } },
  {
    id: 'K28',
    title: 'Jev Router: its body, routed inside the pool, outside → policy, no reported cost, a 404 never sent again',
    fixtures: ['doc/stream-router', 'doc/errors'],
    openrouter: { run: 'doc', spike: 'SP-J4' },
    expect: { step: 'routed', outside: 'model:vendor-x/elsewhere', notFound: 'no_endpoint', posts: 1 },
  },
]

/** A decide request for a model outside the decision models this build asks (the Jev family) is refused before anything is sent. */
export const DECIDE_REFUSAL = { code: 'capability', detail: 'decisions', reach: 'none' } as const
