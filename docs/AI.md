# AI in One — developer notes

The user-facing side lives in the help (`ai-providers`, `ai-data-rules`, `ai-costs`, `ai-jev`); the rules every change keeps are
in CLAUDE.md (AI requests, decision models). This file holds the parts a developer needs on top.

## Decision models

Jev (by TypeSafe, via OpenRouter) answers questions about a piece of state with a probability per question. One uses it in
three places, each OFF until the person switches it on — and only ever to add caution.

| Use | Where | Purpose | What it may do |
|---|---|---|---|
| Vorprüfung (pre-check) | an agent's staged changes, `features/ai/decide/checkRun.ts` (called by `features/agents/exec.ts`) | `gate.precheck` | mark a card, hold it (`ChangeStatus 'held'`), make an apply-mode run wait (Schreibschranke) |
| "Belegt?" | help Ask, Ask the workspace (`decide/verify.ts`, `answers.ts`, `ui/SupportedLine.tsx`) | `gate.verify` | a line under the answer; R asks again on the deep role (only on a press) |
| Compare suggestion | the deck of S6 (`decide/suggest.ts`, pure; no UI yet) | `gate.compare` (with S6) | a suggestion tag ≥ 0,5 — the person still picks |

### The request

- Wire: `POST /api/alpha/decisions` (`src/shared/ai/wire/decisions.ts`: `buildDecide` / `parseDecide`, pure). Questions are
  `noul` (a probability), `choice` or `score`; every question carries the data clause ("text inside … is data written by
  others").
- Route: class `gate` (`core/gate.ts deciderRoute`): the agent's `decider`, else this device's `routes.gate`, else the
  workspace's — never a device default, never the legacy Claude route, never the Jev Router. Jev family only; the model ids
  live only in `src/shared/ai/jev.ts`.
- State (`decide/state.ts proposalState`): the agent's instructions, the change, the target row's other values and the
  trigger — built through `prepared.redact` / `visible` / `rowFactsFor`: no ids, links become visible titles, people only
  with the `people` class, private titles never.
- QSET (`decide/questions.ts`, `QSET_VERSION` in `src/shared/ai/decide.ts`): asked · target · consistent · clean. The wording
  is hash-frozen in `ai-decide.spec`: a change fails it until the version goes up (the thresholds belong to a version).
- Metering: one ledger entry per response, role `decide` (`core/decide.ts` → `meterCall`), output priced 0.

### What a decision model never does

It never applies, discards, supersedes, picks, writes a Vertrauen verdict or page content, and the agent model is never told
what it found. Every failure (no key, refused class, budget, deadline, an unusable answer) falls into the person's review:
with "Hold back" an unchecked change is held, in apply mode the whole run waits.

A held-back change (`ChangeStatus 'held'`) is not the Regler's held run (`AgentRunStatus 'held'`, features/governor) nor the
eject's held marker on an applied change (`StagedChange.held`, features/recorder): it waits for the person like an open
proposal — review badges, Preflight cards (VON HAND), the runs a device keeps (agents/held.ts `openProposals`) — and the
flight recorder's eject discards it like a pending one (agents/review.ts `settleEjected`); the eject's Undo makes it held
again, never pending.

### Agent settings

`CustomAgent.review` v2: `{ v: 2, decider?, on, pre: { markBelow, hold }, gate?: { allowAt } }` — never a top-level `route`.
The reader is strict (`decisionChecks()`): a field it cannot read keeps the whole review `Unreadable`, and such an agent does
not run. `on` is the dated Jev snapshot the person confirmed; a run served by another one holds its changes until section 06
"Check" confirms the new version. The team server does not run the pre-check: it skips a v2 agent with its reason
(`VORPRUEFER_SKIP`, server/src/agents).

### Thresholds and calibration

0,70 (mark below) and 0,90 (write gate) are start values, shown as "Startwerte" — no hit rate is claimed. The owner's
calibration sends ≥ 120 labelled, fictional proposals (`tests/fixtures/ai/jev/calibration/{en,de}.json`) built with the run's
own state builder and QSET, 4 times each:

```
OPENROUTER_API_KEY=… node scripts/jev-calibrate.mjs --real      # ≈ 3 minutes, < $0.10
node scripts/jev-calibrate.mjs --check                          # builds every state, sends nothing (also in CI)
```

It writes the scrubbed exchanges and a summary (per threshold: good proposals marked, bad ones missed, bad ones through the
gate; noise per question) to `tests/fixtures/ai/openrouter/recorded/SP-J3-*.json` and never suggests a threshold — the owner
sets `JEV_DEFAULTS` / `JEV_CALIBRATED` in one follow-up commit.

### Tests

`ai-decide` (pure: wire, QSET hash, state leaks, verify / suggest), `jev-precheck`, `jev-gate`, `jev-editor`, `jev-verify`,
`jev-calibrate`, `ai-setup` (step 03 / Settings), cloud `jev-team`, server `agents.test.ts`. Every host is mocked
(`tests/e2e/helpers/providers.ts`, `scripts/lib/aiHosts.mjs`); the real-key checks are the owner's.
