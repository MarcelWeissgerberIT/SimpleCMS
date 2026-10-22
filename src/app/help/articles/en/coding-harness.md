---
id: coding-harness
title: Coding harness, context and quality
section: ai
order: 21
keywords: local, ollama, coding, harness, atlas, memory, skills, methods, repair, qa, benchmark, evaluation, context, model comparison
related: coding-pipeline, workorders, custom-agents, mcp-bridge
summary: How One prepares coding packages, retrieves context, bounds QA repairs and evaluates local models.
---
One owns the request, its work packages and acceptance. The selected model works on one package at a time. A profile such as `marcel-flow` changes instructions, not model weights. Switching models retains the harness, tools and boundaries.

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
