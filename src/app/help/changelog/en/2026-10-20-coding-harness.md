---
id: 2026-10-20-coding-harness
date: 2026-10-20
order: 5
title: Coding packets, evaluations and QA repairs
summary: Targeted context, versioned methods and bounded repair sub-runs in the shared harness.
image: assets/shots/changelog/coding-harness.webp
alt: The new help article explains task packets, context and quality in the coding harness.
help: coding-harness, workorders, coding-pipeline
try: workorders
---
Worker **1.20.0** prepares compact task packets with a bounded source map and selected methods for the local, MiniMax and Ollama Cloud harness. `code_map`, `skill_list` and `skill_read` retrieve details. Existing glossary/context files supply terminology. Methods grant no permissions or vision capabilities.

Memory distinguishes model notes from tool observations, tracks file revisions and marks restored entries historical. A newly read revision supersedes older excerpts of the same source in normal search. Just-retrieved results retain a bounded excerpt through compaction. MCP tool checks report discovered, permitted tools; actual calls remain the execution evidence.

In **Work orders → Settings → Automatic QA repairs**, optionally allow **1** or **2** repair sub-runs; the default is **Off**. They use the confirmed Coding agent on the combined branch and require fresh QA afterward. Existing check files and recognized test configuration are protected. Identical findings, exhausted attempts and shared limits stop the run. The QA report retains findings and related Coding page links. No additional pipeline rows are created.

The new local suite, `node one-worker.mjs evaluate`, contains **24 synthetic cases**, including multi-file changes, source conflicts and resume. JSON reports include fixed suite hashes, receipts, timing, failures and false completions. This provides measurements, not proof of general frontier-model parity. English and German help explains operation, local/cloud routing and limits.
