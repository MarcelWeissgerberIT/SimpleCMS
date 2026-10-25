---
id: coding-harness
title: Coding harness, context and quality
section: ai
order: 21
keywords: local, ollama, coding, harness, atlas, memory, skills, methods, repair, qa, benchmark, evaluation, context, model comparison
related: coding-pipeline, workorders, custom-agents, mcp-bridge
summary: How One prepares coding packages, retrieves context, bounds QA repairs and evaluates local models.
---
One owns the request, its work packages and acceptance. The selected model works on one package at a time. A profile such as `atlas-flow` changes instructions, not model weights. Switching models retains the harness, tools and boundaries.

## Task packet and methods
The shared harness for **Local · Ollama**, **MiniMax**, **Ollama Cloud** and **GitHub Copilot** prepares a bounded packet: project guidance, available terminology in `GLOSSARY.md`/`CONTEXT.md`, relevant file pointers, symbols, imports and selected versioned methods. The source map uses bounded lexical/symbol search, not a complete architecture graph. An excerpt does not count as a source read for subsequent editing.

`code_map` loads more orientation. `skill_list` and `skill_read` load small methods for implementation, diagnosis, contracts, sources, UI checks and acceptance review. They grant no permissions and execute no downloaded scripts. A UI method does not give a text model vision or screenshot judgment.

The run log shows packet size, methods and a **Harness receipt**: model, profile hash, context limit, declared model capabilities, rounds, tool failures, compactions and check runs. Declared capabilities are not a passed evaluation.

## Memory and Atlas
Tool observations and model notes are distinguished. File excerpts carry content hashes; a newer read supersedes older revisions of the same source in normal search. Restored entries are historical. An old receipt does not prove current tests passed. Resuming requires fresh source reads and checks.

Local task memory and Atlas shadow checkpoints remain bounded and task-scoped. Atlas needs an existing connection and explicit private-shadow consent. Atlas failures do not create retry loops. `mcp_check_tools` checks exact tools discovered and permitted in this stage; only a successful real call proves execution and account permission.

## Automatic QA repairs
Open **Work orders → Settings → Automatic QA repairs**. The default is **Off**. Optionally select **1** or **2**. The choice and Coding agent are pinned when the chain is confirmed. Changing the setting invalidates earlier automatic-start consent.

When final QA fails a check or returns a concrete `needs_rework` finding, the worker may start a repair sub-run with the confirmed Coding agent. It uses the already approved combined branch. The QA report retains the finding and associated Coding page links. No extra pipeline rows are created. Fresh QA follows each successful repair.

Existing tests, verification entry points and recognized test/dependency configuration are inventoried first. Changes prevent acceptance; new regression tests are allowed. This is a verification guard, not an OS sandbox. Shared step and known monetary limits span the sub-runs. Unmetered cloud tariffs remain unmetered. Identical recurring findings, missing progress or permissions, and exhausted attempts stop the run. A private journal prevents Retry from resetting attempts. The branch remains available for inspection.

## Choose local and cloud deliberately
**Local · Ollama** uses loopback inference. MiniMax and Ollama Cloud send selected context to their providers. Choosing BA, Coding and QA agents does not automatically change the actual planner's route: it uses workspace AI settings. MCP connections to Atlas may contact remote services even with local inference. No silent cloud-model fallback is introduced.

## Compare models
Worker **1.20.0** includes 24 synthetic CMS/repository evaluation cases. On the computer running Ollama:

```
node one-worker.mjs evaluate --limit 3 --cases module-integration,source-conflict,resume-package
node one-worker.mjs evaluate --limit 24 --repeats 3
```

Choose model and context through `ONE_CODER_MODEL` and `ONE_CODER_CONTEXT` (32768, 65536 or 131072) in this command's environment. Evaluations change no personal repository, attach no personal MCP and use no cloud inference. They consume local time and memory. Acceptance checks live outside the model's worktree; this is not OS isolation.

JSON output includes suite hash, model, context, passed cases, false completions, duration, steps and run receipts. Repeat the same cases under the same conditions before comparing models or contexts. Even 24 green cases do not establish general frontier-model parity. A failure is evidence, not a reason to weaken acceptance. The older ten-function suite remains available as `benchmark`.


## The harness opens doors: source quotation checks
The harness opens access to permitted sources and tools and coordinates small work packages. Models actively look for contradictions, inconsistencies and problems, group related findings, explain impact and recommend next steps. Binding domain decisions and acceptance remain with the team. A rejected proposal is a valid outcome; enthusiasm for AI is not a success criterion.

In the AI terminal, browser/server agents and the shared local coding adapter, `read_page` or `read_file` provides a receipt for the observed excerpt. `check_finding` compares exact quotations against receipts from this run. Starting with worker **1.28.0**, native coding clients get the same check through `one_task_source` and `one_task_check_finding`; `one_task_read` and personally granted MCP call results also provide receipts. The `checkWith` field identifies the matching checker.

The checker fetches no arbitrary URLs, grants no extra access and writes nothing. It verifies only that a quotation occurred in an observed excerpt. Missing, expired or invalidated receipts require reading again. Request narrower excerpts when output is shortened. Historical memory and model notes do not mint fresh source receipts.

**Supported quotations do not prove a semantic contradiction or approval.** Scope, versions, currentness, authority and meaning still need review. Reports separate findings, sources, context, impact, options and recommendations as proposals; the team decision remains open. A quotation check is neither an executed test nor automatic acceptance. Instructions require the checker, but free-form model responses are not thereby guaranteed truthful.

Update existing coding installations to worker 1.28.0 and start a new run. Running processes and saved reports are not changed retroactively.

## Actively retaining useful knowledge
The shared companion rule asks models to consult relevant Atlas decisions and constraints before new work. Durable knowledge should carry its source, version, meaning and recall trigger. A confirmed human decision is retained as a reference to the actual decision; proposals and open questions stay separate.

In the shared coding adapter — also used by MiniMax, Ollama Cloud and Copilot — `memory_knowledge` first checks an actual source quotation and persists the note locally. Authorized private Atlas sync is attempted immediately, rather than only at the end. Duplicate notes are deduplicated; at most three Atlas checkpoint writes occur per run. Failure stops further automatic attempts. Missing rights, connectivity or a reached limit remain visibly **ATLAS PENDING**. Saving memory grants no new access and replaces no binding team decision in Atlas.

Browser/server agents and native coding clients receive the same knowledge rule and use their explicitly granted Atlas tools. The shared adapter’s automatic private checkpoint transport is not a universal background service on those paths. Each person needs their own access and correct workspace/project association; private credentials and memories are not automatically shared.

## Share a local model with the team · worker 1.29.0+
In the target **cloud workspace → Settings → AI → Share a local model**, select your installed model and choose **Share with this workspace**. The hosting cloud worker must belong to your account and that workspace. There is no global workspace grant. The panel shows the name, model, availability and queue. **Stop sharing** also works while the host is offline; restarting cannot reactivate a server-disabled share.

Members select its entry under **Local · Ollama** for a text action without a worker of their own. One request runs at a time; at most twelve jobs including the running one and two per person are admitted. Existing personal worker jobs take priority over the next shared request. The route chip shows the queue position. Cancellation, lost membership, revocation and workspace changes stop requests. Waiting is bounded to eight minutes; inference to three. There is no automatic retry or cloud fallback.

The first shared channel supports **text, reviews and code proposals**: up to 22 KB input and 4,096 output tokens. It does not run a coding pipeline, execute tools or share repositories or Atlas tokens. Guests and other workspaces cannot use it. Selected context reaches the host computer. Browser and worker encrypt contents with a fresh key per request; the team relay sees metadata and forwards ciphertext. The host decrypts for inference. Restart rotates the host key; the key is not independently identity-verified. A compromised ONE web application or host is outside this transport protection. No prompts or answers are stored in the database; short-lived jobs and results live in memory. Local computation through the Frankfurt relay is not a fully local LAN deployment.

### Small demo comparison with Copilot
Use the synthetic participant demo containing intentionally broken C++ and TypeScript validation:

```sh
node /path/one-worker.mjs compare-demo --repo /path/ONE-Demo --output /path/comparison/report.json --model atlas-flow:latest --copilot-model auto
```

This command uses local Ollama and your signed-in Copilot CLI directly, with identical inputs, a 4,096-token output budget and unchanged tests. No customer data or model shell tools are used. Reports retain prompt/test hashes, actual model where reported, elapsed time, usage and real test results. `auto` is not a fixed model; pin an available Copilot model for repeatability. Testing the shared transport additionally requires a run through the workspace queue. Two small tasks do not establish full merge or general model quality, Angular build/browser behavior or customer-network access. Subscription quota and electricity are not reported as free.
